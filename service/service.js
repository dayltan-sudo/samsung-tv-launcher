/*
 * Runs inside TizenBrew's Node service on the TV.
 *
 * Module pages cannot call the TV's own API directly (no CORS headers, and the
 * `tizen` global is undefined inside a TizenBrew module), so everything goes
 * through here:
 *
 *   GET  /resolve              -> for each app, the first candidate appId the TV reports
 *   POST /launch/<appId>       -> open that app
 *   GET  /installed            -> whatever the TV's own app list endpoint returns
 *   GET  /debug                -> resolution table, for when a tile says not found
 */
var http = require('http');

var PORT = 8099;
var TV_API = { host: '127.0.0.1', port: 8001 };
var ORIGINS = ['http://127.0.0.1:8081', 'http://localhost:8081'];

// Candidate app ids, newest first. Samsung changed ids around 2020, and the
// same app can have a different id per store region, so each entry is a list
// and the first one the TV recognises wins.
var APPS = [
  { key: 'netflix',  name: 'Netflix',    ids: ['3201907018807', '11101200001'] },
  { key: 'youtube',  name: 'YouTube',    ids: ['111299001912'] },
  { key: 'prime',    name: 'Prime Video', ids: ['3201910019365', '3201512006785'] },
  { key: 'disney',   name: 'Disney+',    ids: ['3202204027038', '3202009021709', '3201901017640'] },
  { key: 'wvc',      name: 'Web Video Caster', ids: ['3201809017266', '3201907018807'] },
  { key: 'tiktok',   name: 'TikTok',     ids: ['3202008021577'] }
];

function send(req, res, code, body) {
  var origin = req.headers.origin || '';
  var headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': ORIGINS.indexOf(origin) === -1 ? ORIGINS[0] : origin,
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  };
  res.writeHead(code, headers);
  res.end(JSON.stringify(body));
}

function tvApi(method, path, cb) {
  var r = http.request({ host: TV_API.host, port: TV_API.port, method: method, path: path, timeout: 4000 }, function (resp) {
    var text = '';
    resp.on('data', function (c) { text += c; });
    resp.on('end', function () {
      var json = null;
      try { json = JSON.parse(text); } catch (e) {}
      cb(null, resp.statusCode, json, text);
    });
  });
  r.on('error', function (e) { cb(e); });
  r.on('timeout', function () { r.destroy(); cb(new Error('timeout')); });
  r.end();
}

function probe(appId, cb) {
  tvApi('GET', '/api/v2/applications/' + encodeURIComponent(appId), function (e, code, json) {
    if (e) return cb(e);
    cb(null, code === 200, code, json);
  });
}

var server = http.createServer(function (req, res) {
  var url = req.url.split('?')[0];

  if (req.method === 'OPTIONS') return send(req, res, 200, {});

  if (req.method === 'GET' && url === '/resolve') {
    var out = {}, pending = APPS.length;
    APPS.forEach(function (app) {
      var i = 0;
      (function next() {
        if (i >= app.ids.length) {
          out[app.key] = { name: app.name, appId: null, found: false };
          if (--pending === 0) send(req, res, 200, out);
          return;
        }
        var id = app.ids[i++];
        probe(id, function (e, ok, code, json) {
          if (ok) {
            out[app.key] = { name: app.name, appId: id, found: true, version: (json && json.version) || '' };
            if (--pending === 0) send(req, res, 200, out);
          } else if (e) {
            out[app.key] = { name: app.name, appId: null, found: false, error: 'TV API unreachable' };
            if (--pending === 0) send(req, res, 200, out);
          } else {
            next();
          }
        });
      })();
    });
    return;
  }

  if (req.method === 'GET' && url === '/installed') {
    return tvApi('GET', '/api/v2/applications?visible=true', function (e, code, json, text) {
      if (e) return send(req, res, 502, { ok: false, error: 'TV API unreachable' });
      send(req, res, 200, { ok: true, code: code, body: json || text });
    });
  }

  if (req.method === 'GET' && url === '/debug') {
    return send(req, res, 200, { apps: APPS, port: PORT });
  }

  var m = /^\/launch\/([^\/]+)$/.exec(url);
  if (req.method === 'POST' && m) {
    var appId = decodeURIComponent(m[1]);
    var known = APPS.some(function (a) { return a.ids.indexOf(appId) !== -1; });
    if (!known) return send(req, res, 403, { ok: false, error: 'appId not in the launcher config' });
    return tvApi('POST', '/api/v2/applications/' + encodeURIComponent(appId), function (e, code) {
      if (e) return send(req, res, 502, { ok: false, error: 'TV API unreachable' });
      if (code === 200) return send(req, res, 200, { ok: true });
      if (code === 404) return send(req, res, 200, { ok: false, error: 'App is not installed' });
      send(req, res, 502, { ok: false, error: 'TV refused to open the app (' + code + ')' });
    });
  }

  send(req, res, 404, { ok: false, error: 'no such route' });
});

server.listen(PORT, '127.0.0.1');
