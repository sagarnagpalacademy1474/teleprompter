/* Local data store: folders, scripts and global settings.
 * Everything lives in memory for instant reads and is written through to IndexedDB
 * (localStorage as a fallback). Phase 3 adds Google Drive sync on top of this.
 *
 * folder: { id, name, parentId|null, settings:{}, createdAt, updatedAt }
 * script: { id, title, body, folderId|null, settings:{}, createdAt, updatedAt, openedAt }
 */
(function (root) {
  'use strict';
  var DB_NAME = 'teleprompter', DB_VER = 1;
  var state = { folders: {}, scripts: {}, global: {} };
  var db = null, listeners = [];

  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
  function now() { return Date.now(); }

  function openDb() {
    return new Promise(function (resolve) {
      if (!root.indexedDB) return resolve(null);
      var req;
      try { req = indexedDB.open(DB_NAME, DB_VER); } catch (e) { return resolve(null); }
      req.onupgradeneeded = function () {
        var d = req.result;
        ['folders', 'scripts'].forEach(function (n) { if (!d.objectStoreNames.contains(n)) d.createObjectStore(n, { keyPath: 'id' }); });
        if (!d.objectStoreNames.contains('kv')) d.createObjectStore('kv');
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { resolve(null); };
      req.onblocked = function () { resolve(null); };
    });
  }
  function readAll(name) {
    return new Promise(function (resolve) {
      var out = [], tx = db.transaction(name, 'readonly'), st = tx.objectStore(name), cur = st.openCursor();
      cur.onsuccess = function () { var c = cur.result; if (c) { out.push(c.value); c.continue(); } else resolve(out); };
      cur.onerror = function () { resolve(out); };
    });
  }
  function readKv(key) {
    return new Promise(function (resolve) {
      var r = db.transaction('kv', 'readonly').objectStore('kv').get(key);
      r.onsuccess = function () { resolve(r.result); }; r.onerror = function () { resolve(undefined); };
    });
  }

  var LS_KEY = 'tp_app_v1';
  function lsSave() { try { localStorage.setItem(LS_KEY, JSON.stringify(state)); } catch (e) {} }

  function persist(kind, obj, del) {
    if (db) {
      try {
        if (kind === 'global') db.transaction('kv', 'readwrite').objectStore('kv').put(state.global, 'global');
        else {
          var st = db.transaction(kind, 'readwrite').objectStore(kind);
          if (del) st.delete(obj.id); else st.put(obj);
        }
      } catch (e) { lsSave(); }
    } else lsSave();
    listeners.forEach(function (fn) { try { fn(kind, obj, del); } catch (e) {} });
  }

  var Store = {
    init: function () {
      return openDb().then(function (d) {
        db = d;
        if (!db) {
          try { var s = JSON.parse(localStorage.getItem(LS_KEY) || 'null'); if (s) state = s; } catch (e) {}
          return;
        }
        return Promise.all([readAll('folders'), readAll('scripts'), readKv('global')]).then(function (r) {
          r[0].forEach(function (f) { state.folders[f.id] = f; });
          r[1].forEach(function (s) { state.scripts[s.id] = s; });
          state.global = r[2] || {};
        });
      });
    },
    onChange: function (fn) { listeners.push(fn); },
    isEmpty: function () { return !Object.keys(state.folders).length && !Object.keys(state.scripts).length; },

    // ---- global settings ----
    getGlobal: function () { return state.global; },
    setGlobal: function (g) { state.global = g; persist('global', g); },

    // ---- folders ----
    folder: function (id) { return id ? state.folders[id] || null : null; },
    folders: function (parentId) {
      parentId = parentId || null;
      return Object.values(state.folders).filter(function (f) { return (f.parentId || null) === parentId; })
        .sort(function (a, b) { return a.name.localeCompare(b.name); });
    },
    allFolders: function () { return Object.values(state.folders); },
    createFolder: function (name, parentId) {
      var f = { id: uid(), name: name || 'New folder', parentId: parentId || null, settings: {}, createdAt: now(), updatedAt: now() };
      state.folders[f.id] = f; persist('folders', f); return f;
    },
    updateFolder: function (id, patch) {
      var f = state.folders[id]; if (!f) return null;
      Object.assign(f, patch, { updatedAt: now() }); persist('folders', f); return f;
    },
    // folder chain from the root down to `id`
    path: function (id) {
      var out = [], f = this.folder(id), guard = 0;
      while (f && guard++ < 50) { out.unshift(f); f = this.folder(f.parentId); }
      return out;
    },
    isInside: function (id, ancestorId) { return this.path(id).some(function (f) { return f.id === ancestorId; }); },
    // delete a folder and everything inside it
    deleteFolder: function (id) {
      var self = this;
      self.folders(id).forEach(function (c) { self.deleteFolder(c.id); });
      self.scripts(id).forEach(function (s) { self.deleteScript(s.id); });
      var f = state.folders[id]; if (!f) return;
      delete state.folders[id]; persist('folders', f, true);
    },
    countInside: function (id) {
      var self = this, n = { folders: 0, scripts: self.scripts(id).length };
      self.folders(id).forEach(function (c) { var m = self.countInside(c.id); n.folders += 1 + m.folders; n.scripts += m.scripts; });
      return n;
    },

    // ---- scripts ----
    script: function (id) { return state.scripts[id] || null; },
    scripts: function (folderId) {
      folderId = folderId || null;
      return Object.values(state.scripts).filter(function (s) { return (s.folderId || null) === folderId; })
        .sort(function (a, b) { return b.updatedAt - a.updatedAt; });
    },
    allScripts: function () { return Object.values(state.scripts).sort(function (a, b) { return b.updatedAt - a.updatedAt; }); },
    createScript: function (fields) {
      var s = Object.assign({ id: uid(), title: 'Untitled script', body: '', folderId: null, settings: {}, createdAt: now(), updatedAt: now(), openedAt: 0 }, fields || {});
      state.scripts[s.id] = s; persist('scripts', s); return s;
    },
    updateScript: function (id, patch, quiet) {
      var s = state.scripts[id]; if (!s) return null;
      Object.assign(s, patch); if (!quiet) s.updatedAt = now();
      persist('scripts', s); return s;
    },
    deleteScript: function (id) {
      var s = state.scripts[id]; if (!s) return;
      delete state.scripts[id]; persist('scripts', s, true);
    },
    search: function (q) {
      q = q.toLowerCase().trim(); if (!q) return [];
      return this.allScripts().filter(function (s) { return (s.title + ' ' + s.body).toLowerCase().indexOf(q) >= 0; });
    }
  };
  root.Store = Store;
})(this);
