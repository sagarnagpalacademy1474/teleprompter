/* Google Drive sync.
 * Signs in with Google Identity Services (scope drive.file: the app sees only files it created),
 * keeps the whole library in one JSON file "Teleprompter data.json" inside a Drive folder "Teleprompter",
 * and merges it with this device's copy (merge.js). Drive keeps old versions of the file, so a bad
 * sync can be rolled back from Drive's "Manage versions".
 */
(function (root) {
  'use strict';
  // OAuth client id from Google Cloud Console (Web application). Can also be set in Settings.
  var DEFAULT_CLIENT_ID = '404064630931-ci6eob8ui78pvki7khfa4e75v36nhd3e.apps.googleusercontent.com';
  var SCOPE = 'https://www.googleapis.com/auth/drive.file';
  var FILE_NAME = 'Teleprompter data.json', FOLDER_NAME = 'Teleprompter';
  var LS = 'tp_sync_v1';
  var API = 'https://www.googleapis.com/drive/v3/files', UP = 'https://www.googleapis.com/upload/drive/v3/files';

  var cfg = load();            // { clientId, connected, email, fileId, folderId, token, exp, lastSync, remoteVersion }
  var state = 'off';           // off | needs-tap | syncing | ok | error
  var lastError = '', dirty = false, busy = false, again = false, tokenClient = null, onRemote = null, timer = null, listeners = [];

  function load() { try { return JSON.parse(localStorage.getItem(LS) || '{}'); } catch (e) { return {}; } }
  function save() { try { localStorage.setItem(LS, JSON.stringify(cfg)); } catch (e) {} }
  function clientId() { return cfg.clientId || DEFAULT_CLIENT_ID; }
  function setState(s, err) { state = s; lastError = err || ''; listeners.forEach(function (fn) { try { fn(); } catch (e) {} }); }
  function tokenOk() { return cfg.token && cfg.exp && Date.now() < cfg.exp - 60000; }

  /* ---------- sign in ---------- */
  function loadGis() {
    if (root.google && google.accounts && google.accounts.oauth2) return Promise.resolve();
    return new Promise(function (resolve, reject) {
      var s = document.createElement('script'); s.src = 'https://accounts.google.com/gsi/client'; s.async = true;
      s.onload = function () { resolve(); }; s.onerror = function () { reject(new Error('Could not load Google sign-in')); };
      document.head.appendChild(s);
    });
  }
  // Must be called from a tap (Safari blocks the sign-in popup otherwise).
  function signIn() {
    if (!clientId()) return Promise.reject(new Error('Google sign-in is not set up yet (no client ID).'));
    return loadGis().then(function () {
      return new Promise(function (resolve, reject) {
        tokenClient = google.accounts.oauth2.initTokenClient({
          client_id: clientId(), scope: SCOPE, hint: cfg.email || undefined,
          callback: function (r) {
            if (r.error) return reject(new Error(r.error_description || r.error));
            cfg.token = r.access_token; cfg.exp = Date.now() + (r.expires_in || 3600) * 1000; cfg.connected = true; save();
            resolve();
          },
          error_callback: function (e) { reject(new Error(e && e.type === 'popup_closed' ? 'Sign-in window was closed' : (e && (e.message || e.type)) || 'Sign-in failed')); }
        });
        tokenClient.requestAccessToken({ prompt: cfg.connected ? '' : 'consent' });
      });
    });
  }

  /* ---------- Drive calls ---------- */
  function api(url, opts) {
    opts = opts || {};
    opts.headers = Object.assign({ Authorization: 'Bearer ' + cfg.token }, opts.headers || {});
    return fetch(url, opts).then(function (r) {
      if (r.status === 401) { cfg.token = null; save(); throw Object.assign(new Error('Google sign-in expired'), { auth: true }); }
      if (!r.ok) return r.text().then(function (t) { var e = new Error('Drive error ' + r.status + ': ' + t.slice(0, 200)); e.status = r.status; throw e; });
      return r.status === 204 ? null : (opts.raw ? r.text() : r.json());
    });
  }
  function q(s) { return encodeURIComponent(s); }
  function findOrCreateFolder() {
    if (cfg.folderId) return Promise.resolve(cfg.folderId);
    return api(API + '?q=' + q("name='" + FOLDER_NAME + "' and mimeType='application/vnd.google-apps.folder' and trashed=false") + '&fields=files(id)&spaces=drive')
      .then(function (r) {
        if (r.files.length) return r.files[0].id;
        return api(API + '?fields=id', { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: FOLDER_NAME, mimeType: 'application/vnd.google-apps.folder' }) }).then(function (f) { return f.id; });
      }).then(function (id) { cfg.folderId = id; save(); return id; });
  }
  function findFile() {
    if (cfg.fileId) {
      return api(API + '/' + cfg.fileId + '?fields=id,version,trashed').then(function (f) { return f.trashed ? null : f; })
        .catch(function (e) { if (e.status === 404) { cfg.fileId = null; save(); return findFile(); } throw e; });
    }
    return api(API + '?q=' + q("name='" + FILE_NAME + "' and trashed=false") + '&fields=files(id,version,modifiedTime)&orderBy=modifiedTime desc&spaces=drive')
      .then(function (r) { var f = r.files[0] || null; if (f) { cfg.fileId = f.id; save(); } return f; });
  }
  function download(id) { return api(API + '/' + id + '?alt=media', { raw: true }).then(function (t) { try { return JSON.parse(t); } catch (e) { throw new Error('The Drive file is not valid JSON'); } }); }
  function upload(data) {
    var body = JSON.stringify(data);
    if (cfg.fileId) return api(UP + '/' + cfg.fileId + '?uploadType=media&fields=id,version', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: body });
    return findOrCreateFolder().then(function (folderId) {
      var b = 'tp' + Math.random().toString(36).slice(2);
      var meta = { name: FILE_NAME, parents: [folderId], mimeType: 'application/json' };
      var multipart = '--' + b + '\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n' + JSON.stringify(meta) +
        '\r\n--' + b + '\r\nContent-Type: application/json\r\n\r\n' + body + '\r\n--' + b + '--';
      return api(UP + '?uploadType=multipart&fields=id,version', { method: 'POST', headers: { 'Content-Type': 'multipart/related; boundary=' + b }, body: multipart })
        .then(function (f) { cfg.fileId = f.id; save(); return f; });
    });
  }

  /* ---------- one sync round ---------- */
  function syncNow() {
    if (!cfg.connected) return Promise.resolve();
    if (busy) { again = true; return Promise.resolve(); }
    if (!tokenOk()) { setState('needs-tap'); return Promise.resolve(); }
    busy = true; again = false; setState('syncing');
    var wasDirty = dirty; dirty = false;
    return findFile().then(function (f) {
      if (f && String(f.version) === String(cfg.remoteVersion) && !wasDirty) return null; // nothing new anywhere
      return (f ? download(f.id) : Promise.resolve(null)).then(function (remote) {
        var local = root.Store.exportAll();
        var merged = root.Merge.merge(local, remote || {});
        var localChanged = !root.Merge.same(merged, local);
        var remoteChanged = !remote || !root.Merge.same(merged, remote);
        var p = Promise.resolve(f);
        if (remoteChanged) p = upload(Object.assign({ app: 'teleprompter', savedAt: new Date().toISOString() }, merged));
        return p.then(function (nf) {
          if (nf) cfg.remoteVersion = nf.version;
          if (!localChanged) return;
          // edits made while we were talking to Drive must not be lost: merge them in again
          var now = root.Store.exportAll();
          if (!root.Merge.same(now, local)) { merged = root.Merge.merge(now, merged); dirty = true; }
          return root.Store.replaceAll(merged).then(function () { if (onRemote) onRemote(); });
        });
      });
    }).then(function () {
      cfg.lastSync = Date.now(); save(); busy = false; setState('ok');
      if (again || dirty) schedule(500);
    }, function (e) {
      busy = false; if (wasDirty) dirty = true;
      if (e.auth) setState('needs-tap'); else setState('error', e.message);
      if (root.Log) root.Log.line('sync_error', e.message);
    });
  }
  function schedule(ms) { clearTimeout(timer); timer = setTimeout(syncNow, ms); }

  /* ---------- public ---------- */
  var Sync = {
    pendingRender: false,
    start: function (onRemoteChange) {
      onRemote = onRemoteChange;
      root.Store.onChange(function () { if (!cfg.connected) return; dirty = true; schedule(2500); });
      document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') syncNow(); });
      setInterval(function () { if (document.visibilityState === 'visible') syncNow(); }, 45000);
      if (cfg.connected) { setState(tokenOk() ? 'ok' : 'needs-tap'); syncNow(); }
    },
    // From a tap: sign in if needed, then sync.
    connect: function () {
      return (tokenOk() ? Promise.resolve() : signIn()).then(function () { dirty = true; return syncNow(); }, function (e) { setState(cfg.connected ? 'needs-tap' : 'off', ''); throw e; });
    },
    disconnect: function () {
      if (cfg.token && root.google && google.accounts) try { google.accounts.oauth2.revoke(cfg.token); } catch (e) {}
      cfg = { clientId: cfg.clientId }; save(); setState('off');
    },
    syncNow: syncNow,
    status: function () { return { state: state, error: lastError, connected: !!cfg.connected, lastSync: cfg.lastSync || 0, fileId: cfg.fileId || '', hasClientId: !!clientId(), clientId: cfg.clientId || '' }; },
    setClientId: function (id) { cfg.clientId = (id || '').trim(); save(); setState(state); },
    onStatus: function (fn) { listeners.push(fn); }
  };
  root.Sync = Sync;
})(this);
