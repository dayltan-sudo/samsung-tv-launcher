/* My Home - a six tile launcher that opens the TV's own apps.
 * All TV access goes through the module service on 127.0.0.1:8099. */
(function () {
  var SERVICE = 'http://127.0.0.1:8099';
  var order = ['netflix', 'youtube', 'prime', 'disney', 'wvc', 'tiktok'];
  var colours = {
    netflix: ['#2b0d0d', '#e50914', 'N'],
    youtube: ['#26060a', '#ff0033', 'Y'],
    prime: ['#071a2b', '#00a8e1', 'P'],
    disney: ['#0a1430', '#1f6fff', 'D'],
    wvc: ['#0d2419', '#2ecc71', 'W'],
    tiktok: ['#101014', '#25f4ee', 'T']
  };
  var state = { tiles: [], index: 0, apps: {} };

  function el(id) { return document.getElementById(id); }

  function clock() {
    var d = new Date();
    var h = d.getHours(), m = d.getMinutes();
    el('clock').textContent = (h < 10 ? '0' : '') + h + ':' + (m < 10 ? '0' : '') + m;
  }

  function status(msg, isErr) {
    var s = el('status');
    s.textContent = msg || '';
    s.className = isErr ? 'err' : '';
  }

  function buildGrid() {
    var grid = el('grid');
    grid.innerHTML = '';
    state.tiles = [];
    order.forEach(function (key, i) {
      var c = colours[key] || ['#16191d', '#888', '?'];
      var t = document.createElement('div');
      t.className = 'tile';
      t.style.background = 'linear-gradient(160deg, ' + c[0] + ' 0%, #101317 78%)';
      t.innerHTML = '<span class="badge">' + c[2] + '</span>' +
        '<span class="name">' + (state.apps[key] ? state.apps[key].name : key) + '</span>' +
        '<span class="sub">loading</span>';
      t.dataset.key = key;
      t.addEventListener('click', function () { state.index = i; focus(); launch(); });
      grid.appendChild(t);
      state.tiles.push(t);
    });
  }

  function focus() {
    state.tiles.forEach(function (t, i) {
      t.classList.toggle('focused', i === state.index);
    });
  }

  function paint() {
    state.tiles.forEach(function (t) {
      var key = t.dataset.key;
      var a = state.apps[key];
      var sub = t.querySelector('.sub');
      var name = t.querySelector('.name');
      if (!a) { sub.textContent = 'checking'; return; }
      name.textContent = a.name;
      if (a.found) {
        t.classList.remove('missing');
        sub.textContent = a.version ? 'installed ' + a.version : 'installed';
      } else {
        t.classList.add('missing');
        sub.textContent = a.error ? ('error: ' + a.error) : 'app id not found';
      }
    });
  }

  function resolve() {
    status('Checking installed apps...');
    fetch(SERVICE + '/resolve').then(function (r) { return r.json(); }).then(function (data) {
      if (data._error) { status('Service reports: ' + data._error, true); return diagnose(); }
      delete data._error;
      state.apps = data;
      paint();
      var missing = order.filter(function (k) { return data[k] && !data[k].found; });
      var found = order.filter(function (k) { return data[k] && data[k].found; });
      if (!found.length) { status('No app could be checked. Running diagnostics...', true); return diagnose(); }
      if (missing.length) status('Not found: ' + missing.join(', '));
      else status('');
    }).catch(function (e) {
      status('Could not reach the launcher service on 127.0.0.1:8099\n' + e, true);
    });
  }

  function diagnose() {
    fetch(SERVICE + '/diag').then(function (r) { return r.json(); }).then(function (d) {
      var lines = ['device ip: ' + (d.deviceIp || 'unknown')];
      (d.attempts || []).forEach(function (a) {
        lines.push(a.host + a.path + ' -> ' + (a.ok ? ('HTTP ' + a.status) : (a.error || 'failed')));
      });
      status(lines.join('\n'), true);
    }).catch(function (e) { status('Diagnostics failed: ' + e, true); });
  }

  function launch() {
    var key = order[state.index];
    var a = state.apps[key];
    if (!a || !a.found) {
      status(a ? (a.name + ': no working app id.\nPress Back then open TizenBrew and report this tile.') : 'Still checking, try again.', true);
      return;
    }
    var tile = state.tiles[state.index];
    tile.classList.add('launching');
    status('Opening ' + a.name + '...');
    fetch(SERVICE + '/launch/' + encodeURIComponent(a.appId), { method: 'POST' })
      .then(function (r) { return r.json(); })
      .then(function (res) {
        tile.classList.remove('launching');
        if (res.ok) status('');
        else status(a.name + ': ' + (res.error || 'failed'), true);
      })
      .catch(function (e) {
        tile.classList.remove('launching');
        status('Launch failed: ' + e, true);
      });
  }

  function move(dx, dy) {
    var cols = 3;
    var i = state.index;
    var col = i % cols, row = Math.floor(i / cols);
    col = Math.min(cols - 1, Math.max(0, col + dx));
    row = Math.min(1, Math.max(0, row + dy));
    var next = row * cols + col;
    if (next !== i && next < state.tiles.length) { state.index = next; focus(); }
  }

  function onKey(e) {
    var k = e.key || '';
    // Tizen sends the remote's Back key as keyCode 10009.
    if (e.keyCode === 10009 || k === 'XF86Back' || k === 'GoBack' || k === 'BrowserBack') {
      // TizenBrew opened this page with location.href, so history.back()
      // returns to its own module list.
      try { window.history.back(); } catch (err) {}
      e.preventDefault();
      return;
    }
    if (k === 'ArrowLeft') { move(-1, 0); e.preventDefault(); }
    else if (k === 'ArrowRight') { move(1, 0); e.preventDefault(); }
    else if (k === 'ArrowUp') { move(0, -1); e.preventDefault(); }
    else if (k === 'ArrowDown') { move(0, 1); e.preventDefault(); }
    else if (k === 'Enter') { launch(); e.preventDefault(); }
  }

  document.addEventListener('keydown', onKey);
  clock();
  setInterval(clock, 15000);
  buildGrid();
  focus();
  resolve();
})();
