/* Merge two copies of the library (this device and the Drive file).
 * Each folder/script carries _m (last change time). Deletions are kept as tombstones in `deleted`
 * ({ id: time }) so a delete on one device removes the item on the others.
 * Newest change wins per item. Works in the browser (window.Merge) and in Node.
 */
(function (root) {
  'use strict';
  var KEEP_TOMBSTONES = 90 * 24 * 3600 * 1000;

  function stamp(r) { return (r && (r._m || r.updatedAt || r.createdAt)) || 0; }
  function empty() { return { v: 1, folders: {}, scripts: {}, global: {}, globalAt: 0, deleted: {} }; }
  function norm(d) {
    d = d || {};
    return { v: 1, folders: d.folders || {}, scripts: d.scripts || {}, global: d.global || {}, globalAt: d.globalAt || 0, deleted: d.deleted || {} };
  }

  function merge(local, remote, nowTs) {
    var L = norm(local), R = norm(remote), out = empty(), now = nowTs || Date.now();
    Object.keys(L.deleted).concat(Object.keys(R.deleted)).forEach(function (id) {
      var t = Math.max(L.deleted[id] || 0, R.deleted[id] || 0);
      if (now - t < KEEP_TOMBSTONES) out.deleted[id] = t;
    });
    ['folders', 'scripts'].forEach(function (kind) {
      var ids = {};
      Object.keys(L[kind]).forEach(function (id) { ids[id] = 1; });
      Object.keys(R[kind]).forEach(function (id) { ids[id] = 1; });
      Object.keys(ids).forEach(function (id) {
        var a = L[kind][id], b = R[kind][id];
        var win = !b ? a : !a ? b : (stamp(a) >= stamp(b) ? a : b);
        var del = Math.max(L.deleted[id] || 0, R.deleted[id] || 0);
        if (del && del >= stamp(win)) return;
        out[kind][id] = JSON.parse(JSON.stringify(win));
      });
    });
    // items whose parent folder is gone move to the top level
    Object.keys(out.folders).forEach(function (id) {
      var f = out.folders[id];
      if (f.parentId && !out.folders[f.parentId]) f.parentId = null;
    });
    // break folder cycles (two devices moved folders into each other)
    Object.keys(out.folders).forEach(function (id) {
      var seen = {}, f = out.folders[id];
      while (f && f.parentId) {
        if (seen[f.id]) { f.parentId = null; break; }
        seen[f.id] = 1; f = out.folders[f.parentId];
      }
    });
    Object.keys(out.scripts).forEach(function (id) {
      var s = out.scripts[id];
      if (s.folderId && !out.folders[s.folderId]) s.folderId = null;
    });
    if (R.globalAt > L.globalAt) { out.global = R.global; out.globalAt = R.globalAt; }
    else { out.global = L.global; out.globalAt = L.globalAt; }
    return out;
  }

  // stable comparison so key order does not matter
  function canon(d) {
    d = norm(d);
    function sortObj(o) {
      if (Array.isArray(o)) return o.map(sortObj);
      if (o && typeof o === 'object') { var r = {}; Object.keys(o).sort().forEach(function (k) { r[k] = sortObj(o[k]); }); return r; }
      return o;
    }
    return JSON.stringify(sortObj(d));
  }
  function same(a, b) { return canon(a) === canon(b); }

  var api = { merge: merge, same: same, empty: empty, stamp: stamp };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Merge = api;
})(this);
