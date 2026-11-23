/* App shell: routing, library (folders + scripts), editor, settings screens, dialogs. */
(function (root) {
  'use strict';
  var Store = root.Store, Settings = root.Settings, Prompter = root.Prompter, Core = root.PrompterCore;
  var $ = function (id) { return document.getElementById(id); };
  var view = $('view');
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function go(hash) { if (location.hash === hash) render(); else location.hash = hash; }

  /* ---------------- helpers ---------------- */
  function wordCount(t) { return (String(t).match(/\S+/g) || []).length; }
  function readTime(t) { var m = wordCount(t) / 140; return m < 1 ? Math.max(1, Math.round(m * 60)) + ' sec' : (Math.round(m * 10) / 10) + ' min'; }
  function ago(ts) {
    if (!ts) return '';
    var s = (Date.now() - ts) / 1000;
    if (s < 60) return 'just now';
    if (s < 3600) return Math.floor(s / 60) + ' min ago';
    if (s < 86400) return Math.floor(s / 3600) + ' h ago';
    var d = new Date(ts); return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  }
  function firstLine(body) { return String(body || '').trim().split(/\n/)[0].slice(0, 140); }
  function langLabel(v) { var d = Settings.DEFS.filter(function (x) { return x.key === 'lang'; })[0]; var o = d.options.filter(function (x) { return x[0] === v; })[0]; return o ? o[1] : v; }

  function toast(msg) {
    var t = document.createElement('div'); t.className = 'toast'; t.textContent = msg;
    document.body.appendChild(t); setTimeout(function () { t.remove(); }, 2200);
  }

  /* ---------------- dialogs ---------------- */
  function modal(opts) {
    var bg = document.createElement('div'); bg.className = 'modal-bg';
    bg.innerHTML = '<div class="modal' + (opts.wide ? ' wide' : '') + '"><h2>' + esc(opts.title) + '</h2><div class="mbody"></div><div class="btns"></div></div>';
    var body = bg.querySelector('.mbody'), btns = bg.querySelector('.btns');
    if (typeof opts.body === 'string') body.innerHTML = opts.body; else if (opts.body) body.appendChild(opts.body);
    function close() { bg.remove(); document.removeEventListener('keydown', onKey); }
    function onKey(e) { if (e.key === 'Escape') close(); if (e.key === 'Enter' && opts.enterOk && e.target.tagName !== 'TEXTAREA') { var b = btns.querySelector('.primary'); if (b) b.click(); } }
    (opts.buttons || [{ label: 'Close' }]).forEach(function (b) {
      var el = document.createElement('button'); el.textContent = b.label; if (b.cls) el.className = b.cls;
      el.onclick = function () { if (b.onClick && b.onClick(body) === false) return; close(); };
      btns.appendChild(el);
    });
    bg.addEventListener('mousedown', function (e) { if (e.target === bg) close(); });
    document.addEventListener('keydown', onKey);
    document.body.appendChild(bg);
    var inp = body.querySelector('input,select'); if (inp) setTimeout(function () { inp.focus(); if (inp.select) inp.select(); }, 30);
    return { close: close, body: body };
  }
  function askText(title, value, okLabel, cb) {
    modal({ title: title, enterOk: true, body: '<input type="text" id="askInp" value="' + esc(value || '') + '">',
      buttons: [{ label: 'Cancel' }, { label: okLabel || 'Save', cls: 'primary', onClick: function (b) {
        var v = b.querySelector('#askInp').value.trim(); if (!v) return false; cb(v); } }] });
  }
  function confirmBox(title, html, okLabel, cb) {
    modal({ title: title, body: '<p class="muted" style="margin:0;line-height:1.5">' + html + '</p>',
      buttons: [{ label: 'Cancel' }, { label: okLabel, cls: 'primary danger', onClick: function () { cb(); } }] });
  }
  // folder picker; excludeId hides a folder and its sub-folders (moving a folder into itself)
  function folderOptions(selected, excludeId, rootLabel) {
    var out = ['<option value="">' + esc(rootLabel || 'No folder (top level)') + '</option>'];
    (function walk(pid, depth) {
      Store.folders(pid).forEach(function (f) {
        if (excludeId && (f.id === excludeId)) return;
        out.push('<option value="' + f.id + '"' + (f.id === selected ? ' selected' : '') + '>' + '   '.repeat(depth) + esc(f.name) + '</option>');
        walk(f.id, depth + 1);
      });
    })(null, 0);
    return out.join('');
  }
  function moveDialog(kind, item) {
    var cur = kind === 'script' ? item.folderId : item.parentId;
    modal({ title: 'Move "' + (item.title || item.name) + '"', body: '<select id="mvSel">' + folderOptions(cur, kind === 'folder' ? item.id : null) + '</select>',
      buttons: [{ label: 'Cancel' }, { label: 'Move', cls: 'primary', onClick: function (b) {
        var to = b.querySelector('#mvSel').value || null;
        if (kind === 'script') Store.updateScript(item.id, { folderId: to });
        else Store.updateFolder(item.id, { parentId: to });
        toast('Moved'); render();
      } }] });
  }
  function popMenu(anchor, items) {
    closeMenus();
    var m = document.createElement('div'); m.className = 'menu';
    items.forEach(function (it) {
      var b = document.createElement('button'); b.textContent = it.label; if (it.danger) b.className = 'danger';
      b.onclick = function (e) { e.stopPropagation(); closeMenus(); it.onClick(); };
      m.appendChild(b);
    });
    document.body.appendChild(m);
    var r = anchor.getBoundingClientRect();
    var left = Math.min(r.right - m.offsetWidth, window.innerWidth - m.offsetWidth - 8);
    var top = r.bottom + 4; if (top + m.offsetHeight > window.innerHeight - 8) top = r.top - m.offsetHeight - 4;
    m.style.left = Math.max(8, left) + 'px'; m.style.top = Math.max(8, top) + 'px';
    setTimeout(function () { document.addEventListener('click', closeMenus, { once: true }); }, 0);
  }
  function closeMenus() { document.querySelectorAll('.menu').forEach(function (m) { m.remove(); }); }

  function settingsDialog(level, item) {
    var holder = document.createElement('div');
    var intro = level === 'folder'
      ? 'These apply to every script in "' + item.name + '" and its sub-folders, unless a sub-folder or script changes them.'
      : 'These apply only to this script. Anything you do not change comes from its folder or the global settings.';
    holder.innerHTML = '<p class="muted" style="margin:0 0 12px;line-height:1.5">' + esc(intro) + '</p><div class="sform"></div>';
    var parentFolder = level === 'folder' ? item.parentId : item.folderId;
    var inherited = Settings.resolve(parentFolder, null);
    Settings.renderForm(holder.querySelector('.sform'), {
      level: level, own: item.settings, inherited: inherited,
      onChange: function (own) {
        if (level === 'folder') Store.updateFolder(item.id, { settings: own }); else Store.updateScript(item.id, { settings: own }, true);
      }
    });
    modal({ title: (level === 'folder' ? 'Folder settings: ' : 'Script settings: ') + (item.name || item.title), wide: true, body: holder,
      buttons: [{ label: 'Done', cls: 'primary', onClick: function () { render(); } }] });
  }

  /* ---------------- library ---------------- */
  function crumbs(folderId) {
    var parts = ['<a href="#/">All scripts</a>'];
    Store.path(folderId).forEach(function (f, i, arr) {
      parts.push('<span class="sep">/</span>' + (i === arr.length - 1 ? '<span>' + esc(f.name) + '</span>' : '<a href="#/f/' + f.id + '">' + esc(f.name) + '</a>'));
    });
    return '<div class="crumbs">' + parts.join('') + '</div>';
  }
  function scriptRow(s, showPath) {
    var eff = Settings.resolve(s.folderId, s).values, n = Settings.overrideCount(s.settings);
    var where = showPath && s.folderId ? Store.path(s.folderId).map(function (f) { return f.name; }).join(' / ') + ' · ' : '';
    return '<div class="row" data-open="' + s.id + '"><div class="meta"><div class="title">' + esc(s.title) +
      (n ? '<span class="badge">' + n + ' own setting' + (n > 1 ? 's' : '') + '</span>' : '') + '</div>' +
      '<div class="preview">' + esc(firstLine(s.body) || 'Empty script') + '</div>' +
      '<div class="info">' + esc(where) + wordCount(s.body) + ' words · ~' + readTime(s.body) + ' · ' + esc(langLabel(eff.lang)) + ' · edited ' + ago(s.updatedAt) + '</div></div>' +
      '<button class="primary" data-play="' + s.id + '" title="Open prompter">&#9654;</button>' +
      '<button class="icon ghost" data-smenu="' + s.id + '" aria-label="More">&#8943;</button></div>';
  }
  function renderLibrary(folderId) {
    var f = folderId ? Store.folder(folderId) : null;
    if (folderId && !f) return go('#/');
    var subs = Store.folders(folderId), scripts = Store.scripts(folderId);
    var n = f ? Settings.overrideCount(f.settings) : 0;
    var html = [folderId ? crumbs(folderId) : ''];
    html.push('<div class="lib-head"><h1>' + (f ? '&#128193; ' + esc(f.name) : 'All scripts') + (n ? '<span class="badge">' + n + ' own setting' + (n > 1 ? 's' : '') + '</span>' : '') + '</h1><div class="actions">' +
      '<button class="primary" id="newScript">+ Script</button><button id="newFolder">+ Folder</button>' +
      (f ? '<button id="folderSettings">Folder settings</button><button class="icon" id="folderMenu" aria-label="Folder actions">&#8943;</button>' : '') +
      '</div></div>');
    if (subs.length) {
      html.push('<div class="section-title">Folders</div><div class="folders">');
      subs.forEach(function (sf) {
        var c = Store.countInside(sf.id), on = Settings.overrideCount(sf.settings);
        html.push('<div class="card" data-folder="' + sf.id + '"><span class="ico">&#128193;</span><div class="meta"><div class="name">' + esc(sf.name) + '</div>' +
          '<div class="sub">' + c.scripts + ' script' + (c.scripts === 1 ? '' : 's') + (c.folders ? ' · ' + c.folders + ' folder' + (c.folders === 1 ? '' : 's') : '') + (on ? ' · own settings' : '') + '</div></div>' +
          '<button class="icon ghost" data-fmenu="' + sf.id + '" aria-label="More">&#8943;</button></div>');
      });
      html.push('</div>');
    }
    if (scripts.length || !subs.length) html.push('<div class="section-title">Scripts</div>');
    if (scripts.length) html.push('<div class="list">' + scripts.map(function (s) { return scriptRow(s); }).join('') + '</div>');
    else if (!subs.length) html.push('<div class="empty">No scripts here yet. Tap <b>+ Script</b> to write or paste one.</div>');
    view.innerHTML = html.join('');

    $('newScript').onclick = function () {
      var s = Store.createScript({ folderId: folderId || null });
      go('#/s/' + s.id);
    };
    $('newFolder').onclick = function () {
      askText(f ? 'New folder inside "' + f.name + '"' : 'New folder', '', 'Create', function (name) { Store.createFolder(name, folderId || null); render(); });
    };
    if (f) {
      $('folderSettings').onclick = function () { settingsDialog('folder', f); };
      $('folderMenu').onclick = function (e) { e.stopPropagation(); folderMenu(e.currentTarget, f); };
    }
    wireLists();
  }
  function folderMenu(anchor, f) {
    popMenu(anchor, [
      { label: 'Rename', onClick: function () { askText('Rename folder', f.name, 'Save', function (v) { Store.updateFolder(f.id, { name: v }); render(); }); } },
      { label: 'Folder settings', onClick: function () { settingsDialog('folder', f); } },
      { label: 'Move', onClick: function () { moveDialog('folder', f); } },
      { label: 'Delete', danger: true, onClick: function () {
        var c = Store.countInside(f.id);
        confirmBox('Delete "' + f.name + '"?', 'This deletes the folder' + (c.scripts || c.folders ? ' and everything inside it: <b>' + c.scripts + ' script' + (c.scripts === 1 ? '' : 's') + '</b>' + (c.folders ? ' and <b>' + c.folders + ' sub-folder' + (c.folders === 1 ? '' : 's') + '</b>' : '') : '') + '. This cannot be undone.', 'Delete', function () {
          var parent = f.parentId; Store.deleteFolder(f.id); toast('Folder deleted');
          if (location.hash.indexOf(f.id) >= 0) go(parent ? '#/f/' + parent : '#/'); else render();
        });
      } }
    ]);
  }
  function scriptMenu(anchor, s) {
    popMenu(anchor, [
      { label: 'Open prompter', onClick: function () { go('#/p/' + s.id); } },
      { label: 'Edit', onClick: function () { go('#/s/' + s.id); } },
      { label: 'Script settings', onClick: function () { settingsDialog('script', s); } },
      { label: 'Move', onClick: function () { moveDialog('script', s); } },
      { label: 'Duplicate', onClick: function () {
        Store.createScript({ title: s.title + ' (copy)', body: s.body, folderId: s.folderId, settings: JSON.parse(JSON.stringify(s.settings || {})) });
        toast('Duplicated'); render();
      } },
      { label: 'Delete', danger: true, onClick: function () {
        confirmBox('Delete "' + s.title + '"?', 'This script will be deleted. This cannot be undone.', 'Delete', function () { Store.deleteScript(s.id); toast('Script deleted'); render(); });
      } }
    ]);
  }
  function wireLists() {
    view.onclick = function (e) {
      var t = e.target.closest('[data-play],[data-smenu],[data-fmenu],[data-open],[data-folder]');
      if (!t) return;
      if (t.dataset.play) { e.stopPropagation(); go('#/p/' + t.dataset.play); }
      else if (t.dataset.smenu) { e.stopPropagation(); scriptMenu(t, Store.script(t.dataset.smenu)); }
      else if (t.dataset.fmenu) { e.stopPropagation(); folderMenu(t, Store.folder(t.dataset.fmenu)); }
      else if (t.dataset.open) go('#/s/' + t.dataset.open);
      else if (t.dataset.folder) go('#/f/' + t.dataset.folder);
    };
  }

  /* ---------------- search ---------------- */
  function renderSearch(q) {
    var res = Store.search(q);
    view.innerHTML = '<div class="crumbs"><a href="#/">All scripts</a><span class="sep">/</span><span>Search</span></div>' +
      '<div class="lib-head"><h1>Results for "' + esc(q) + '"</h1></div>' +
      (res.length ? '<div class="list">' + res.map(function (s) { return scriptRow(s, true); }).join('') + '</div>' : '<div class="empty">No scripts match.</div>');
    wireLists();
  }

  /* ---------------- editor ---------------- */
  var saveTimer = null;
  // previous / next script in the same folder
  function edNavHtml(s) {
    var list = Store.scripts(s.folderId), i = list.map(function (x) { return x.id; }).indexOf(s.id);
    if (list.length < 2 || i < 0) return '';
    var p = list[i - 1], n = list[i + 1];
    return '<div class="ed-nav">' +
      (p ? '<button class="ghost" data-ednav="' + p.id + '" title="Previous script">&#8249; ' + esc(p.title) + '</button>' : '<span></span>') +
      '<span class="muted">' + (i + 1) + ' of ' + list.length + '</span>' +
      (n ? '<button class="ghost" data-ednav="' + n.id + '" title="Next script">' + esc(n.title) + ' &#8250;</button>' : '<span></span>') + '</div>';
  }
  function renderEditor(id) {
    var s = Store.script(id); if (!s) return go('#/');
    var back = s.folderId ? '#/f/' + s.folderId : '#/';
    var n = Settings.overrideCount(s.settings);
    view.innerHTML = crumbs(s.folderId) +
      '<div class="ed-bar"><input type="text" class="ed-title grow" id="edTitle" value="' + esc(s.title) + '" placeholder="Script title">' +
      '<button id="edSettings">Script settings' + (n ? ' (' + n + ')' : '') + '</button>' +
      '<button class="icon" id="edMenu" aria-label="More">&#8943;</button>' +
      '<button class="primary" id="edPlay">&#9654; Start prompter</button></div>' +
      edNavHtml(s) +
      '<div class="ed-meta"><span class="muted">Folder</span><select id="edFolder">' + folderOptions(s.folderId) + '</select>' +
      '<span class="muted" id="edLang"></span></div>' +
      '<textarea id="edBody" spellcheck="false" placeholder="Write or paste your script here">' + esc(s.body) + '</textarea>' +
      '<div class="ed-foot"><span id="edCount"></span><span id="edSaved">Saved</span></div>' +
      '<div id="edWarn"></div>';
    function stats() {
      var b = $('edBody').value;
      $('edCount').textContent = wordCount(b) + ' words · about ' + readTime(b) + ' to read';
      var eff = Settings.resolve($('edFolder').value || null, Store.script(id)).values;
      $('edLang').textContent = 'Voice: ' + langLabel(eff.lang);
      var toks = Core.tokenizeScript(b).tokens, warn = [];
      [['wakePhrase', 'wake'], ['restartPhrase', 'restart'], ['stopPhrase', 'pause']].forEach(function (p) {
        if (eff[p[0]] && Core.scriptContainsPhrase(toks, eff[p[0]])) warn.push('A ' + p[1] + ' phrase ("' + esc(eff[p[0]]) + '") appears in this script. Change it in Script settings so it does not trigger while you read.');
      });
      $('edWarn').innerHTML = warn.map(function (w) { return '<p class="muted" style="color:var(--warn)">' + w + '</p>'; }).join('');
    }
    var shown = { title: s.title, body: s.body, folderId: s.folderId || null };
    function save() {
      clearTimeout(saveTimer);
      if (!Store.script(id) || !$('edBody')) return;
      var patch = { title: $('edTitle').value.trim() || 'Untitled script', body: $('edBody').value, folderId: $('edFolder').value || null };
      // only write what the user changed here, so a newer copy from another device is not overwritten
      if (patch.title !== shown.title || patch.body !== shown.body || patch.folderId !== shown.folderId) { Store.updateScript(id, patch); shown = patch; }
      $('edSaved').textContent = 'Saved';
    }
    function later() { $('edSaved').textContent = 'Saving...'; clearTimeout(saveTimer); saveTimer = setTimeout(save, 600); stats(); }
    $('edTitle').oninput = later; $('edBody').oninput = later;
    $('edFolder').onchange = function () { save(); stats(); };
    $('edSettings').onclick = function () { save(); settingsDialog('script', Store.script(id)); };
    $('edPlay').onclick = function () { save(); go('#/p/' + id); };
    view.querySelectorAll('[data-ednav]').forEach(function (b) { b.onclick = function () { save(); go('#/s/' + b.dataset.ednav); }; });
    $('edMenu').onclick = function (e) {
      e.stopPropagation(); save();
      popMenu(e.currentTarget, [
        { label: 'Duplicate', onClick: function () { var c = Store.createScript({ title: s.title + ' (copy)', body: $('edBody').value, folderId: s.folderId, settings: JSON.parse(JSON.stringify(s.settings || {})) }); go('#/s/' + c.id); } },
        { label: 'Delete', danger: true, onClick: function () { confirmBox('Delete "' + s.title + '"?', 'This script will be deleted. This cannot be undone.', 'Delete', function () { Store.deleteScript(id); toast('Script deleted'); go(back); }); } }
      ]);
    };
    stats();
    if (!s.body) $('edBody').focus();
    leaveEditor = save;
  }
  var leaveEditor = null;

  /* ---------------- global settings ---------------- */
  function renderSettings() {
    view.innerHTML = '<div class="crumbs"><a href="#/">All scripts</a><span class="sep">/</span><span>Settings</span></div>' +
      '<div class="lib-head"><h1>Global settings</h1></div>' +
      '<p class="muted" style="line-height:1.5;margin-top:-6px">These are the defaults for every script. A folder or a single script can change any of them for itself.</p>' +
      '<div class="drive-box" id="driveBox"></div>' +
      '<div id="gform"></div><p class="muted">Version ' + esc(root.BUILD) + (Core.VERSION !== root.BUILD ? ' (old files cached: reload the page)' : '') + '</p>';
    Settings.renderForm($('gform'), {
      level: 'global', own: Settings.defaultsMerged(), inherited: { values: Settings.defaults(), source: {} },
      onChange: function (own) { Store.setGlobal(own); }
    });
    drawDriveBox();
  }

  /* ---------------- Drive sync UI ---------------- */
  function syncLabel(st) {
    if (!st.connected) return 'Drive';
    return { ok: 'Synced', syncing: 'Syncing', 'needs-tap': 'Tap to sync', error: 'Sync error', off: 'Drive' }[st.state] || 'Drive';
  }
  function drawSyncBtn() {
    var st = root.Sync.status(), b = $('syncBtn');
    b.dataset.s = st.connected ? st.state : 'off';
    $('syncTxt').textContent = syncLabel(st);
    b.title = st.error || (st.lastSync ? 'Last synced ' + ago(st.lastSync) : 'Google Drive sync');
  }
  function connectDrive() {
    root.Sync.connect().then(function () { drawDriveBox(); }, function (e) { toast(e.message); drawDriveBox(); });
  }
  function drawDriveBox() {
    var box = $('driveBox'); if (!box) return;
    var st = root.Sync.status(), h = ['<h3>Google Drive sync</h3>'];
    if (!st.hasClientId) {
      h.push('<div class="muted">Sync keeps your scripts, folders and settings the same on iPad, laptop and phone. It needs a Google sign-in client ID, which is being set up.</div>');
    } else if (!st.connected) {
      h.push('<div>Not connected. Your scripts are saved only on this device.</div><div class="muted">The app gets access only to the one file it creates in a "Teleprompter" folder in your Drive, not to the rest of your Drive.</div>');
      h.push('<div class="btns"><button class="primary" id="drvConnect">Connect Google Drive</button></div>');
    } else {
      h.push('<div>Connected. ' + (st.state === 'syncing' ? 'Syncing now...' : st.lastSync ? 'Last synced ' + ago(st.lastSync) + '.' : '') + '</div>');
      if (st.state === 'needs-tap') h.push('<div class="muted">Google sign-in has expired on this device. Tap Sync now to continue.</div>');
      if (st.state === 'error') h.push('<div class="err">' + esc(st.error) + '</div>');
      h.push('<div class="btns"><button class="primary" id="drvSync">Sync now</button>' +
        (st.fileId ? '<a class="button-like" target="_blank" rel="noopener" href="https://drive.google.com/file/d/' + esc(st.fileId) + '/view"><button>Open file in Drive</button></a>' : '') +
        '<button id="drvOff">Disconnect this device</button></div>');
    }
    h.push('<details style="margin-top:10px"><summary class="muted">Advanced: sign-in client ID</summary><input type="text" id="drvCid" placeholder="xxxx.apps.googleusercontent.com" value="' + esc(st.clientId) + '"></details>');
    box.innerHTML = h.join('');
    var c = $('drvConnect'); if (c) c.onclick = connectDrive;
    c = $('drvSync'); if (c) c.onclick = connectDrive;
    c = $('drvOff'); if (c) c.onclick = function () {
      confirmBox('Disconnect Google Drive?', 'This device stops syncing. Your scripts stay on this device and in Drive.', 'Disconnect', function () { root.Sync.disconnect(); drawDriveBox(); });
    };
    $('drvCid').onchange = function () { root.Sync.setClientId(this.value); drawDriveBox(); };
  }

  /* ---------------- prompter route ---------------- */
  // keep a font size changed with A-/A+ in the prompter for that script
  function saveAdjusted(sc, adjusted) {
    var s = Store.script(sc.id); if (!s || !adjusted.fontSize) return;
    var cur = Settings.resolve(s.folderId, s).values.fontSize;
    if (cur === adjusted.fontSize) return;
    Store.updateScript(s.id, { settings: Object.assign({}, s.settings, { fontSize: adjusted.fontSize }) }, true);
    toast('Font size ' + adjusted.fontSize + 'px saved for "' + s.title + '"');
  }
  // the playable scripts of a folder, in the order the folder shows them
  function playable(folderId) { return Store.scripts(folderId).filter(function (x) { return x.body.trim(); }); }
  function folderNav(folderId) {
    function pack(x) { return x ? { script: x, settings: Settings.resolve(x.folderId, x).values } : null; }
    return {
      step: function (dir, id) {
        var list = playable(folderId), i = list.map(function (x) { return x.id; }).indexOf(id);
        return i < 0 ? null : pack(list[i + dir]);
      },
      get: function (id) { return pack(Store.script(id)); },
      list: function () { return playable(folderId).map(function (x) { return { id: x.id, title: x.title }; }); },
      leave: function (sc, adjusted) { saveAdjusted(sc, adjusted); },
      // keep the address and the editor underneath on the script being shown
      shown: function (sc) {
        Store.updateScript(sc.id, { openedAt: Date.now() }, true);
        history.replaceState(null, '', '#/p/' + sc.id);
        renderEditor(sc.id);
      }
    };
  }
  function openPrompter(id) {
    var s = Store.script(id); if (!s) return go('#/');
    if (!s.body.trim()) { toast('This script is empty'); return go('#/s/' + id); }
    Store.updateScript(id, { openedAt: Date.now() }, true);
    renderEditor(id); // keep the editor underneath
    Prompter.open({ script: s, settings: Settings.resolve(s.folderId, s).values, nav: folderNav(s.folderId),
      onClose: function (adjusted, cur) {
        saveAdjusted(cur, adjusted);
        if (/^#\/p\//.test(location.hash)) history.replaceState(null, '', '#/s/' + cur.id);
        render();
      } });
  }

  /* ---------------- router ---------------- */
  function render() {
    closeMenus();
    if (leaveEditor) { try { leaveEditor(); } catch (e) {} leaveEditor = null; }
    var h = location.hash || '#/', m;
    if (Prompter.isOpen() && !/^#\/p\//.test(h)) Prompter.close();
    if ((m = h.match(/^#\/f\/(\w+)/))) renderLibrary(m[1]);
    else if ((m = h.match(/^#\/s\/(\w+)/))) renderEditor(m[1]);
    else if ((m = h.match(/^#\/p\/(\w+)/))) { if (!Prompter.isOpen()) openPrompter(m[1]); }
    else if (h === '#/settings') renderSettings();
    else if ((m = h.match(/^#\/search\/(.*)/))) renderSearch(decodeURIComponent(m[1]));
    else renderLibrary(null);
    if (!/^#\/search/.test(h)) $('search').value = '';
    window.scrollTo(0, 0);
  }

  /* ---------------- first run ---------------- */
  var SAMPLES = [
    { title: 'Three study habits (English)', lang: 'en-IN', body: "Hello everyone and welcome back to the channel. Today we are going to talk about three simple habits that can change the way you study.\n\nThe first habit is planning your day the night before. When you plan ahead, you wake up with a clear goal.\n\nThe second habit is taking short breaks every 45 minutes. Your brain needs rest to remember what you learned.\n\nThe third habit is revising before you sleep. Start with these three habits and see the difference in just two weeks. Thanks for watching, see you in the next video." },
    { title: 'Highlight reel (Hinglish)', lang: 'hi-IN', body: "Instagram pe sabki highlight reel dikhti hai. Nayi gaadi, naya ghar, celebration. Unki EMI, unki tension, unke struggle wale din nahi dikhte.\nAur aap apne behind-the-scenes ko unki highlight reel se compare kar rahe ho.\nKisi aur ki progress aapki failure nahi hai.\nUnki achievements ke liye khushi manao, lekin apni achievements ke liye jaan laga do…" },
    { title: 'Exam se pehle raat (Hinglish)', lang: 'hi-IN', body: "Exam se pehle raat ko sabse badi galti jo students karte hain, wo hai poori raat jaag kar padhna. Aapka dimaag thaka hua hota hai, aur jo padha hai wo bhi yaad nahi rehta.\n\nIsliye exam se ek din pehle sirf revision karo, naya chapter mat uthao. Raat ko kam se kam saat ghante ki neend lo. Subah halka breakfast karo aur paani peete raho.\n\nYaad rakhna, fresh dimaag hi aapka sabse bada hathiyaar hai." }
  ];
  // Samples get fixed ids and a very old change time, so seeding a new device never
  // overwrites (or duplicates) the copies that are already in Drive.
  function seed() {
    var f = Store.createFolder('Samples', null, 'samples');
    // carry over phrases the prototype saved on this device
    try {
      var p = JSON.parse(localStorage.getItem('tp_proto_v1') || 'null');
      if (p) {
        var g = {};
        ['wakePhrase', 'restartPhrase', 'stopPhrase', 'fontSize', 'lineHeight', 'margin', 'readingLine', 'mirror', 'startMode'].forEach(function (k) { if (p[k] !== undefined) g[k] = p[k]; });
        if (g.wakePhrase === 'prompter go' || g.wakePhrase === 'prompter go, chalo shuru') delete g.wakePhrase;
        if (g.restartPhrase === 'prompter restart') delete g.restartPhrase;
        if (g.stopPhrase === 'prompter pause') delete g.stopPhrase;
        Store.setGlobal(g);
      }
    } catch (e) {}
    var t = Date.now();
    SAMPLES.forEach(function (s, i) {
      Store.createScript({ id: 'sample' + (i + 1), title: s.title, body: s.body, folderId: f.id, settings: s.lang !== 'en-IN' ? { lang: s.lang } : {}, createdAt: t - i * 1000, updatedAt: t - i * 1000 });
    });
    var d = Store.exportAll();
    Object.keys(d.folders).concat(Object.keys(d.scripts)).forEach(function (id) { (d.folders[id] || d.scripts[id])._m = 1; });
    d.globalAt = Object.keys(d.global).length ? 1 : 0;
    return Store.replaceAll(d);
  }

  /* ---------------- boot ---------------- */
  Settings.defaultsMerged = function () { return Object.assign(Settings.defaults(), Store.getGlobal()); };
  root.Log.setEnabled(function () { return Settings.defaultsMerged().sendLogs !== false; });
  Prompter.wire();
  $('brand').onclick = function () { go('#/'); };
  $('gear').onclick = function () { go('#/settings'); };
  $('syncBtn').onclick = function () {
    var st = root.Sync.status();
    if (st.connected && st.state === 'needs-tap') connectDrive(); else if (st.connected && st.state !== 'error') root.Sync.syncNow(); else go('#/settings');
  };
  root.Sync.onStatus(function () {
    drawSyncBtn();
    if (location.hash === '#/settings' && !document.querySelector('#drvCid:focus')) drawDriveBox();
    if (root.Sync.pendingRender && root.Sync.status().state === 'ok') {
      var a = document.activeElement;
      if (!Prompter.isOpen() && !document.querySelector('.modal-bg') && !(a && /INPUT|TEXTAREA|SELECT/.test(a.tagName))) { root.Sync.pendingRender = false; render(); }
    }
  });
  drawSyncBtn();
  var sTimer = null;
  $('search').oninput = function () {
    clearTimeout(sTimer);
    var q = this.value;
    sTimer = setTimeout(function () { if (q.trim()) history.replaceState(null, '', '#/search/' + encodeURIComponent(q)), renderSearch(q); else go('#/'); }, 200);
  };
  window.addEventListener('hashchange', render);
  window.addEventListener('pagehide', function () { if (leaveEditor) leaveEditor(); });
  Store.init().then(function () {
    return Store.isEmpty() && !Object.keys(Store.exportAll().deleted).length && !localStorage.getItem('tp_seeded') ? (localStorage.setItem('tp_seeded', '1'), seed()) : null;
  }).then(function () {
    render();
    if (root.Sync) root.Sync.start(function () {
      // data changed from another device: redraw, but never under the user's typing or an open prompter
      var a = document.activeElement;
      if (Prompter.isOpen() || document.querySelector('.modal-bg') || (a && /INPUT|TEXTAREA|SELECT/.test(a.tagName) && a.id !== 'search')) { root.Sync.pendingRender = true; return; }
      render();
    });
  });
})(this);
