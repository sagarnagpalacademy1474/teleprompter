/* Settings: definitions, the global -> folder -> sub-folder -> script inheritance, and the settings form.
 * A level stores only the values it overrides; everything else comes from the level above.
 */
(function (root) {
  'use strict';

  var DEFS = [
    { key: 'scrollMode', group: 'Scrolling', label: 'Scroll mode', type: 'select', def: 'voice',
      options: [['voice', 'Voice tracking'], ['manual', 'Fixed speed']] },
    { key: 'speed', group: 'Scrolling', label: 'Fixed speed', type: 'range', def: 60, min: 10, max: 300, step: 5, unit: ' px/s' },

    { key: 'lang', group: 'Voice', label: 'Speech language', type: 'select', def: 'en-IN',
      options: [['en-IN', 'English (India)'], ['en-US', 'English (US)'], ['en-GB', 'English (UK)'], ['hi-IN', 'Hinglish / Hindi (Roman script)']] },
    { key: 'startMode', group: 'Voice', label: 'Take starts by', type: 'select', def: 'wake+firstline',
      options: [['wake+firstline', 'Wake phrase or first line'], ['wake', 'Wake phrase only'], ['firstline', 'Speaking the first line'], ['auto', 'Immediately on open']] },
    { key: 'wakePhrase', group: 'Voice', label: 'Wake phrases (comma separated)', type: 'text', def: 'prompter go, chalo shuru, shuru karte hain' },
    { key: 'restartPhrase', group: 'Voice', label: 'Restart phrases (new take)', type: 'text', def: 'prompter restart, phir se shuru' },
    { key: 'stopPhrase', group: 'Voice', label: 'Pause phrases', type: 'text', def: 'prompter pause, ruk jao prompter' },

    { key: 'fontSize', group: 'Text', label: 'Font size', type: 'range', def: 56, min: 24, max: 140, step: 2, unit: 'px' },
    { key: 'lineHeight', group: 'Text', label: 'Line spacing', type: 'range', def: 1.45, min: 1, max: 2.2, step: 0.05, unit: '' },
    { key: 'margin', group: 'Text', label: 'Side margin', type: 'range', def: 8, min: 0, max: 30, step: 1, unit: '%' },
    { key: 'readingLine', group: 'Text', label: 'Reading line', type: 'range', def: 30, min: 10, max: 70, step: 1, unit: '% from top' },
    { key: 'mirror', group: 'Text', label: 'Mirror text', type: 'toggle', def: false },
    { key: 'theme', group: 'Text', label: 'Colours', type: 'select', def: 'dark',
      options: [['dark', 'White on black'], ['light', 'Black on white'], ['yellow', 'Yellow on black']] },

    { key: 'showDebug', group: 'Testing', label: 'Show what the mic hears', type: 'toggle', def: true }
  ];
  // Only on the global settings screen
  var GLOBAL_ONLY = [
    { key: 'sendLogs', group: 'Testing', label: 'Send test logs to Claude', type: 'toggle', def: true }
  ];

  function defaults() {
    var o = {};
    DEFS.concat(GLOBAL_ONLY).forEach(function (d) { o[d.key] = d.def; });
    return o;
  }

  // Effective settings for a script (or for a folder when scriptId is null).
  // Returns { values, source } where source[key] = 'Default' | 'Global' | folder name | 'This script'.
  function resolve(folderId, script) {
    var values = defaults(), source = {};
    Object.keys(values).forEach(function (k) { source[k] = 'Default'; });
    function apply(obj, label) {
      Object.keys(obj || {}).forEach(function (k) {
        if (obj[k] !== undefined && obj[k] !== null && k in values) { values[k] = obj[k]; source[k] = label; }
      });
    }
    apply(root.Store.getGlobal(), 'Global');
    root.Store.path(folderId).forEach(function (f) { apply(f.settings, 'Folder "' + f.name + '"'); });
    if (script) apply(script.settings, 'This script');
    return { values: values, source: source };
  }

  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function fmt(d, v) {
    if (d.type === 'toggle') return v ? 'On' : 'Off';
    if (d.type === 'select') { var o = d.options.filter(function (x) { return x[0] === v; })[0]; return o ? o[1] : v; }
    if (d.type === 'range') return v + (d.unit || '');
    return v;
  }

  /* Render a settings form.
   * opts: { level: 'global'|'folder'|'script', own: {...}, inherited: {values, source}, onChange(newOwn) }
   * For global every setting is editable. For folder/script each row shows the inherited value
   * and its source, with "Change for this ..." to override and "Use inherited" to go back.
   */
  function renderForm(el, opts) {
    var own = Object.assign({}, opts.own || {});
    var defs = opts.level === 'global' ? DEFS.concat(GLOBAL_ONLY) : DEFS;
    var levelName = opts.level === 'folder' ? 'this folder' : 'this script';

    function control(d, v, disabled) {
      var dis = disabled ? ' disabled' : '';
      if (d.type === 'select') return '<select data-k="' + d.key + '"' + dis + '>' + d.options.map(function (o) {
        return '<option value="' + esc(o[0]) + '"' + (o[0] === v ? ' selected' : '') + '>' + esc(o[1]) + '</option>'; }).join('') + '</select>';
      if (d.type === 'range') return '<div class="range"><input type="range" data-k="' + d.key + '" min="' + d.min + '" max="' + d.max + '" step="' + d.step + '" value="' + v + '"' + dis + '><span class="val">' + esc(fmt(d, v)) + '</span></div>';
      if (d.type === 'toggle') return '<label class="switch"><input type="checkbox" data-k="' + d.key + '"' + (v ? ' checked' : '') + dis + '><span></span></label>';
      return '<input type="text" data-k="' + d.key + '" value="' + esc(v) + '"' + dis + '>';
    }

    function draw() {
      var groups = {}, html = [];
      defs.forEach(function (d) { (groups[d.group] = groups[d.group] || []).push(d); });
      Object.keys(groups).forEach(function (g) {
        html.push('<div class="set-group"><h3>' + esc(g) + '</h3>');
        groups[g].forEach(function (d) {
          var overridden = opts.level === 'global' ? true : (d.key in own);
          var v = d.key in own ? own[d.key] : opts.inherited.values[d.key];
          html.push('<div class="set-row' + (overridden ? ' own' : ' inh') + '"><div class="set-label">' + esc(d.label));
          if (opts.level !== 'global') {
            html.push(overridden
              ? '<div class="set-src">Set for ' + levelName + ' · <button class="link" data-reset="' + d.key + '">Use inherited</button></div>'
              : '<div class="set-src">From ' + esc(opts.inherited.source[d.key]) + ' · <button class="link" data-own="' + d.key + '">Change for ' + levelName + '</button></div>');
          }
          html.push('</div><div class="set-ctl">' + control(d, v, !overridden) + '</div></div>');
        });
        html.push('</div>');
      });
      el.innerHTML = html.join('');
    }
    draw();

    el.oninput = el.onchange = function (e) {
      var k = e.target.dataset && e.target.dataset.k; if (!k) return;
      var d = defs.filter(function (x) { return x.key === k; })[0];
      var v = d.type === 'toggle' ? e.target.checked : (d.type === 'range' ? parseFloat(e.target.value) : e.target.value);
      own[k] = v;
      var val = e.target.parentNode.querySelector('.val'); if (val) val.textContent = fmt(d, v);
      opts.onChange(Object.assign({}, own));
    };
    el.onclick = function (e) {
      var t = e.target;
      if (t.dataset.own) { own[t.dataset.own] = opts.inherited.values[t.dataset.own]; opts.onChange(Object.assign({}, own)); draw(); }
      else if (t.dataset.reset) { delete own[t.dataset.reset]; opts.onChange(Object.assign({}, own)); draw(); }
    };
  }

  function overrideCount(settings) { return Object.keys(settings || {}).length; }

  root.Settings = { DEFS: DEFS, GLOBAL_ONLY: GLOBAL_ONLY, defaults: defaults, resolve: resolve, renderForm: renderForm, overrideCount: overrideCount };
})(this);
