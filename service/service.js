/*
 * Runs inside TizenBrew's Node service on the TV.
 *
 * Module pages cannot call the TV's own API directly (no CORS headers, and the
 * `tizen` global is undefined inside a TizenBrew module), so everything goes
 * through here:
 *
 *   GET  /diag                 -> every reachability attempt, with real errors
 *   GET  /resolve              -> for each app, the appId the TV acknowledges
 *   POST /launch/<appId>       -> open that app
 *   GET  /installed            -> raw output of the TV's app list endpoint
 */
var http = require('http');

var PORT = 8099;
var API_PORT = 8001;
var ORIGINS = ['http://127.0.0.1:8081', 'http://localhost:8081'];
var DEVICE_IP = null;

var APPS = [
  { key: 'netflix',  name: 'Netflix',          ids: ['3201907018807', '11101200001'] },
  { key: 'youtube',  name: 'YouTube',          ids: ['111299001912'] },
  { key: 'prime',    name: 'Prime Video',      ids: ['3201910019365', '3201512006785'] },
  { key: 'disney',   name: 'Disney+',          ids: ['3202204027038', '3202009021709', '3201901017640'] },
  { key: 'wvc',      name: 'Web Video Caster', ids: ['3201809017266'] },
  { key: 'tiktok',   name: 'TikTok',           ids: ['3202008021577'] }
];

function send(req, res, code, body) {
  var origin = req.headers.origin || '';
  res.writeHead(code, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': ORIGINS.indexOf(origin) === -1 ? ORIGINS[0] : origin,
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  });
  res.end(JSON.stringify(body));
}

// TizenBrew's own proxy answers with the device IP on any non-/module path.
function findDeviceIP(cb) {
  if (DEVICE_IP) return cb(DEVICE_IP);
  var r = http.get({ host: '127.0.0.1', port: 8081, path: '/' }, function (resp) {
    var t = '';
    resp.on('data', function (c) { t += c; });
    resp.on('end', function () {
      var ip = (t || '').trim();
      if (/^\d+\.\d+\.\d+\.\d+$/.test(ip)) { DEVICE_IP = ip; cb(ip); }
      else cb(null);
    });
  });
  r.on('error', function () { cb(null); });
}

function call(host, method, path, cb) {
  var r = http.request({ host: host, port: API_PORT, method: method, path: path }, function (resp) {
    var t = '';
    resp.on('data', function (c) { t += c; });
    resp.on('end', function () { cb(null, resp.statusCode, t); });
  });
  r.setTimeout(4000, function () { r.destroy(); cb({ code: 'ETIMEDOUT' }); });
  r.on('error', function (e) { cb({ code: e.code || String(e) }); });
  r.end();
}

function targets(cb) {
  findDeviceIP(function (ip) {
    cb(ip && ip !== '127.0.0.1' ? ['127.0.0.1', ip] : ['127.0.0.1']);
  });
}

// First host that answers anything at all wins.
function pickHost(cb) {
  targets(function (list) {
    var i = 0;
    (function next() {
      if (i >= list.length) return cb(null);
      var host = list[i++];
      call(host, 'GET', '/api/v2/', function (e) {
        if (!e) return cb(host);
        next();
      });
    })();
  });
}

var server = http.createServer(function (req, res) {
  var url = req.url.split('?')[0];
  if (req.method === 'OPTIONS') return send(req, res, 200, {});

  if (req.method === 'GET' && url === '/diag') {
    return targets(function (list) {
      var todo = [];
      list.forEach(function (host) {
        ['/api/v2/', '/api/v2/applications/3201907018807'].forEach(function (p) {
          todo.push({ host: host, path: p });
        });
      });
      var out = [], pending = todo.length;
      if (!pending) return send(req, res, 200, { deviceIp: DEVICE_IP, attempts: [] });
      todo.forEach(function (t, idx) {
        out[idx] = { host: t.host, path: t.path };
        call(t.host, 'GET', t.path, function (e, code, body) {
          out[idx].ok = !e;
          out[idx].status = code || null;
          out[idx].error = e ? e.code : null;
          out[idx].body = e ? null : String(body).slice(0, 120);
          if (--pending === 0) send(req, res, 200, { deviceIp: DEVICE_IP, attempts: out });
        });
      });
    });
  }

  if (req.method === 'GET' && url === '/resolve') {
    return pickHost(function (host) {
      if (!host) return send(req, res, 200, { _error: 'nothing answered on port ' + API_PORT });
      var out = {}, pending = APPS.length;
      function finish() { if (--pending === 0) send(req, res, 200, out); }
      APPS.forEach(function (app) {
        var i = 0;
        (function next() {
          if (i >= app.ids.length) {
            out[app.key] = { name: app.name, appId: null, found: false };
            return finish();
          }
          var id = app.ids[i++];
          call(host, 'GET', '/api/v2/applications/' + encodeURIComponent(id), function (e, code) {
            if (e) {
              out[app.key] = { name: app.name, appId: null, found: false, error: e.code };
              return finish();
            }
            if (code === 200) {
              out[app.key] = { name: app.name, appId: id, found: true, host: host };
              return finish();
            }
            if (code === 401 || code === 403) {
              out[app.key] = { name: app.name, appId: null, found: false, error: 'HTTP ' + code };
              return finish();
            }
            next();
          });
        })();
      });
    });
  }

  if (req.method === 'GET' && url === '/installed') {
    return pickHost(function (host) {
      if (!host) return send(req, res, 502, { ok: false, error: 'nothing answered on ' + API_PORT });
      call(host, 'GET', '/api/v2/applications?visible=true', function (e, code, body) {
        send(req, res, 200, { ok: !e, host: host, status: code || null, error: e ? e.code : null, body: String(body || '').slice(0, 3000) });
      });
    });
  }

  var m = /^\/launch\/([^\/]+)$/.exec(url);
  if (req.method === 'POST' && m) {
    var appId = decodeURIComponent(m[1]);
    var known = APPS.some(function (a) { return a.ids.indexOf(appId) !== -1; });
    if (!known) return send(req, res, 403, { ok: false, error: 'appId not in the launcher config' });
    return pickHost(function (host) {
      if (!host) return send(req, res, 502, { ok: false, error: 'nothing answered on ' + API_PORT });
      call(host, 'POST', '/api/v2/applications/' + encodeURIComponent(appId), function (e, code) {
        if (e) return send(req, res, 502, { ok: false, error: e.code });
        if (code === 200) return send(req, res, 200, { ok: true, host: host });
        send(req, res, 200, { ok: false, error: 'TV answered HTTP ' + code, host: host });
      });
    });
  }

  send(req, res, 404, { ok: false, error: 'no such route' });
});

server.listen(PORT, '127.0.0.1');
