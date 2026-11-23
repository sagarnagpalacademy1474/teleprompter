/* Prompter screen: voice tracking, fixed-speed scroll, takes and voice commands.
 * Prompter.open({ script, settings, onClose(adjusted, script), nav })  settings = effective values from Settings.resolve
 * nav (optional) moves between scripts of the same folder without leaving the prompter (the mic stays on):
 *   { step(dir, id) -> {script, settings} | null, get(id) -> same, list() -> [{id, title}],
 *     leave(oldScript, adjusted), shown(newScript) }
 */
(function (root) {
  'use strict';
  var Core = root.PrompterCore;
  // Test logging was removed before going live (Tarun's rule, 2026-11-22). Kept as a no-op hook.
  var Log = { line: function () {}, flush: function () {} };
  var SR = root.SpeechRecognition || root.webkitSpeechRecognition;
  var $ = function (id) { return document.getElementById(id); };
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  var S = {}, script = null, onClose = null, adjusted = {}, nav = null;
  var T = [], words = [], spans = [];
  var pos = 0, mode = 'ready', take = 1, y = 0, targetY = 0;
  var lastHeardAt = 0, endPending = false, wakeLock = null, ovMic = false, isOpen = false;

  function buildText() {
    var tk = Core.tokenizeScript(script.body);
    T = tk.tokens; words = tk.words;
    var html = [], wi = 0;
    script.body.split(/(\s+)/).forEach(function (part) {
      if (!part) return;
      if (/^\s+$/.test(part)) { html.push(/\n\s*\n/.test(part) ? '<br><br>' : (/\n/.test(part) ? '<br>' : ' ')); return; }
      html.push('<span class="w" data-i="' + wi + '">' + esc(part) + '</span>'); wi++;
    });
    $('pText').innerHTML = html.join('');
    applyLook();
    spans = Array.prototype.slice.call($('pText').querySelectorAll('.w'));
  }
  function applyLook() {
    var el = $('pText');
    el.style.fontSize = S.fontSize + 'px';
    el.style.lineHeight = S.lineHeight;
    el.style.padding = '0 ' + S.margin + '%';
    $('pStage').classList.toggle('mirror', !!S.mirror);
    $('prompter').dataset.theme = S.theme || 'dark';
    $('pReadline').style.top = S.readingLine + '%';
    $('pDebug').classList.toggle('hidden', !S.showDebug);
  }

  function curWordIdx() { return pos > 0 ? T[Math.min(pos, T.length) - 1].w : -1; }
  function paint() {
    var cw = curWordIdx();
    for (var i = 0; i < spans.length; i++) {
      var c = i < cw ? 'w read' : (i === cw ? 'w cur' : 'w');
      if (spans[i].className !== c) spans[i].className = c;
    }
    var nextW = pos < T.length ? T[pos].w : (spans.length - 1);
    var sp = spans[Math.max(0, nextW)];
    if (sp && S.scrollMode === 'voice') {
      var lineY = $('prompter').clientHeight * S.readingLine / 100;
      targetY = sp.offsetTop - lineY + sp.offsetHeight * 0.5;
    }
  }

  function setMode(m) {
    if (m !== mode) Log.line('mode', mode + '->' + m + ' pos=' + pos + ' take=' + take);
    mode = m;
    var label = { ready: 'Ready', countdown: 'Starting', running: 'Running', paused: 'Paused' }[m];
    if (m === 'ready' && S.scrollMode === 'voice') {
      var hints = [];
      if (S.startMode.indexOf('wake') >= 0) hints.push('say ' + S.wakePhrase.split(',').map(function (x) { return '"' + x.trim() + '"'; }).join(' or '));
      if (S.startMode.indexOf('firstline') >= 0) hints.push('read line 1');
      if (hints.length) label += ': ' + hints.join(' or ');
    }
    $('pMode').textContent = label;
    $('pMode').className = 'pill ' + (m === 'countdown' ? 'count' : m);
    $('pPlay').textContent = m === 'running' ? 'Pause' : 'Start';
    $('pControls').classList.toggle('dim', m === 'running' || m === 'countdown');
    resetHeard();
  }
  function setTake(n) { take = n; $('pTake').textContent = 'Take ' + take; }

  function goTop() {
    pos = 0; endPending = false; paint();
    if (S.scrollMode === 'manual') targetY = y = -($('prompter').clientHeight * S.readingLine / 100);
  }
  var countTimer = null;
  function startTake(withCountdown) {
    if (!withCountdown) { setMode('running'); return; }
    setMode('countdown');
    var n = 3;
    showOverlay(String(n), 'Take ' + take);
    clearInterval(countTimer);
    countTimer = setInterval(function () {
      n--;
      if (mode !== 'countdown') { clearInterval(countTimer); hideOverlay(); return; }
      if (n > 0) { showOverlay(String(n), 'Take ' + take); return; }
      clearInterval(countTimer); hideOverlay(); setMode('running');
    }, 800);
  }
  function finishTake() {
    showOverlay('✓', 'Take ' + take + ' done. Back to the top for the next take.');
    setTake(take + 1);
    setMode('ready');
    setTimeout(function () { if (isOpen) { goTop(); hideOverlay(); } }, 1400);
  }
  function restartTake() {
    if (mode === 'running' || mode === 'paused' || pos > 0) setTake(take + 1);
    goTop(); startTake(true);
  }
  function togglePlay() {
    if (mode === 'running') setMode('paused');
    else if (mode === 'ready' || mode === 'paused') startTake(mode === 'ready');
  }
  function showOverlay(big, msg) { $('pOvBig').textContent = big; $('pOvMsg').textContent = msg || ''; $('pOverlay').classList.remove('hidden'); }
  function hideOverlay() { $('pOverlay').classList.add('hidden'); }

  /* ---------------- Speech ---------------- */
  var rec = null, listening = false;
  var base = [], sessFinal = [], sessAll = [];
  var mark = 0, prevLen = 0, utterStart = 0;
  var diag = { events: 0, raw: '', err: '', lang: '', restarts: 0 };

  function heardAll() { return base.concat(sessAll); }
  function resetHeard() { mark = heardAll().length; utterStart = mark; prevLen = mark; }

  function micOn() {
    if (!SR) { showOverlay('!', 'Speech recognition is not available in this browser. Use Safari on iPad, or Chrome.'); setTimeout(hideOverlay, 3000); return; }
    if (listening) return;
    listening = true; diag.lang = ''; diag.err = ''; startRec(); updateMic(); renderDiag();
  }
  function micOff() { listening = false; if (rec) try { rec.stop(); } catch (e) {} updateMic(); }
  function updateMic() {
    $('pMic').textContent = listening ? 'Mic on' : 'Mic off';
    $('pMic').className = 'pill ' + (listening ? 'on' : 'off');
    $('pMicBtn').textContent = listening ? 'Mic off' : 'Mic on';
  }

  function startRec() {
    rec = new SR();
    rec.lang = diag.lang || S.lang; rec.continuous = true; rec.interimResults = true; rec.maxAlternatives = 1;
    diag.lang = rec.lang;
    rec.onstart = function () { renderDiag(); Log.line('rec_start', rec.lang); };
    rec.onresult = function (e) {
      var fin = [], all = [], raw = [], newest = [];
      diag.events++;
      for (var j = (e.resultIndex || 0); j < e.results.length; j++) newest.push((e.results[j].isFinal ? 'F:' : 'i:') + e.results[j][0].transcript);
      Log.line('heard', newest.join(' | '));
      for (var i = 0; i < e.results.length; i++) {
        raw.push(e.results[i][0].transcript);
        var toks = Core.tokenizeSpeech(e.results[i][0].transcript);
        if (e.results[i].isFinal) fin = fin.concat(toks);
        all = all.concat(toks);
      }
      sessFinal = fin; sessAll = all;
      diag.raw = raw.join(' ').slice(-140); diag.err = '';
      onSpeech();
    };
    rec.onerror = function (e) {
      diag.err = e.error + (e.message ? ' (' + e.message + ')' : ''); renderDiag();
      Log.line('rec_error', diag.err);
      if (e.error === 'language-not-supported' && rec.lang !== 'en-IN') {
        diag.lang = 'en-IN';
        showOverlay('!', 'This device cannot listen in ' + S.lang + '. Switched the mic to English (India).');
        setTimeout(hideOverlay, 4000);
        return;
      }
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        listening = false; updateMic();
        showOverlay('!', 'Microphone permission was denied. Allow it in the browser settings and tap Mic on again.');
        setTimeout(hideOverlay, 3500);
      }
    };
    rec.onend = function () {
      Log.line('rec_end');
      base = base.concat(sessFinal); sessFinal = []; sessAll = [];
      if (base.length > 600) { var cut = base.length - 300; base = base.slice(cut); mark = Math.max(0, mark - cut); utterStart = Math.max(0, utterStart - cut); prevLen = Math.max(0, prevLen - cut); }
      if (listening) {
        diag.restarts++;
        var r0 = rec;
        setTimeout(function () {
          if (!listening) return;
          if (diag.lang !== r0.lang) { startRec(); return; }
          try { r0.start(); } catch (err) { startRec(); }
        }, diag.err ? 600 : 120);
      }
    };
    try { rec.start(); } catch (e) {}
  }

  function onSpeech() {
    var now = performance.now();
    var all = heardAll();
    if (all.length < mark) mark = base.length;
    if (utterStart > all.length) utterStart = mark;
    if (now - lastHeardAt > 1200) utterStart = Math.max(mark, prevLen);
    lastHeardAt = now;
    prevLen = all.length;

    var utter = all.slice(Math.max(mark, utterStart));
    var tail = all.slice(Math.max(mark, all.length - 8));
    lastTail = tail; renderDiag();
    if (S.scrollMode !== 'voice' || !isOpen) return;

    if (mode === 'countdown') return;
    // "prompter ..." commands work at any time, even in the middle of a script;
    // the other phrases ("phir se shuru") only when said on their own after a pause.
    if (S.restartPhrase && (Core.endsWithStrong(tail, S.restartPhrase) || Core.isPhrase(utter, S.restartPhrase))) { Log.line('cmd', 'restart'); restartTake(); return; }
    if (mode === 'running') {
      if (S.stopPhrase && (Core.endsWithStrong(tail, S.stopPhrase) || Core.isPhrase(utter, S.stopPhrase))) { Log.line('cmd', 'pause'); setMode('paused'); return; }
    } else if (mode === 'ready' || mode === 'paused') {
      if (nav && S.nextPhrase && Core.endsWithPhrase(tail, S.nextPhrase)) { Log.line('cmd', 'next'); switchScript(1); return; }
      if (nav && S.prevPhrase && Core.endsWithPhrase(tail, S.prevPhrase)) { Log.line('cmd', 'prev'); switchScript(-1); return; }
      var wakeAllowed = mode === 'paused' || S.startMode.indexOf('wake') >= 0;
      if (S.wakePhrase && wakeAllowed && Core.endsWithPhrase(tail, S.wakePhrase)) { Log.line('cmd', 'wake'); startTake(mode === 'ready'); return; }
      if (mode === 'ready' && (S.startMode === 'firstline' || S.startMode === 'wake+firstline')) {
        var r0 = Core.locate(T, tail, 0, { window: [0, 15] });
        if (r0 && r0.score >= 2.6) { Log.line('cmd', 'firstline score=' + r0.score.toFixed(2)); setMode('running'); pos = r0.pos; paint(); }
      }
      return;
    }
    if (mode !== 'running') return;
    var r = Core.locate(T, tail, pos);
    Log.line('match', 'tail="' + tail.map(function (t) { return t.t; }).join(' ') + '" ' +
      (r ? 'pos ' + pos + '->' + r.pos + ' word="' + (words[T[r.end].w] || '') + '" score=' + r.score.toFixed(2) : 'hold pos=' + pos));
    if (r) { pos = r.pos; paint(); if (pos >= T.length - 1) endPending = true; }
  }

  var lastTail = [];
  function renderDiag() {
    if (!S.showDebug || !isOpen) return;
    $('pDebug').innerHTML =
      '<div><b>Mic</b> ' + (listening ? 'on' : 'off') + ' · ' + esc(diag.lang || S.lang) + ' · results ' + diag.events +
      ' · restarts ' + diag.restarts + (diag.err ? ' · <span class="err">error: ' + esc(diag.err) + '</span>' : '') + '</div>' +
      '<div><b>Mic wrote</b> ' + esc(diag.raw || '(nothing yet)') + '</div>' +
      '<div><b>Matching as</b> ' + esc(lastTail.map(function (t) { return t.t; }).join(' ')) + '</div>';
  }

  /* ---------------- Loop ---------------- */
  var lastFrame = 0;
  function frame(ts) {
    if (!isOpen) { lastFrame = 0; return; }
    var dt = lastFrame ? Math.min(0.1, (ts - lastFrame) / 1000) : 0; lastFrame = ts;
    if (S.scrollMode === 'manual') {
      if (mode === 'running') targetY += S.speed * dt;
      var maxY = $('pText').scrollHeight - $('prompter').clientHeight * S.readingLine / 100;
      if (targetY > maxY && mode === 'running') { targetY = maxY; finishTake(); }
      y = targetY;
    } else {
      y += (targetY - y) * Math.min(1, dt * 6);
      var now = performance.now();
      if (mode === 'running' && pos >= T.length - 3 && (endPending ? now - lastHeardAt > 2000 : now - lastHeardAt > 3500)) finishTake();
    }
    $('pText').style.transform = 'translate3d(0,' + (-y).toFixed(1) + 'px,0)';
    requestAnimationFrame(frame);
  }

  function bumpFont(d) {
    S.fontSize = Math.max(24, Math.min(140, S.fontSize + d));
    adjusted.fontSize = S.fontSize;
    applyLook(); paint();
    $('pFontVal').textContent = S.fontSize;
  }

  /* ---------------- Scripts in the same folder ---------------- */
  function load(sc, settings) {
    var oldLang = S.lang;
    script = sc; S = Object.assign({}, settings); adjusted = {};
    $('pTitle').textContent = script.title;
    $('pFontVal').textContent = S.fontSize;
    buildText(); setTake(1); endPending = false;
    Log.line('session', { build: root.BUILD, core: Core.VERSION, ua: navigator.userAgent, lang: S.lang, start: S.startMode, wake: S.wakePhrase, restart: S.restartPhrase, mode: S.scrollMode, title: script.title });
    Log.line('script', script.body.replace(/\s+/g, ' ').slice(0, 3000));
    y = 0; goTop(); y = targetY;
    mode = ''; setMode('ready');
    // a script in another language: restart the mic in that language
    if (listening && rec && oldLang && oldLang !== S.lang) { diag.lang = ''; try { rec.stop(); } catch (e) {} }
    updateNav(); closeList();
  }
  function updateNav() {
    var has = !!nav;
    ['pPrev', 'pNext', 'pListBtn'].forEach(function (id) { $(id).classList.toggle('hidden', !has); });
    if (!has) return;
    $('pPrev').disabled = !nav.step(-1, script.id);
    $('pNext').disabled = !nav.step(1, script.id);
  }
  function switchScript(dir, id) {
    if (!nav || mode === 'running' || mode === 'countdown') return;
    var n = id ? nav.get(id) : nav.step(dir, script.id);
    if (!n) {
      showOverlay(dir > 0 ? '⏭' : '⏮', dir > 0 ? 'This is the last script in this folder.' : 'This is the first script in this folder.');
      setTimeout(hideOverlay, 1600); return;
    }
    if (n.script.id === script.id) { closeList(); return; }
    nav.leave(script, adjusted);
    load(n.script, n.settings);
    if (nav.shown) nav.shown(n.script);
    showOverlay('▶', n.script.title);
    setTimeout(function () { if (mode === 'ready') hideOverlay(); }, 1300);
  }
  function openList() {
    if (!nav) return;
    var el = $('pList');
    el.innerHTML = '<div class="phead">Scripts in this folder</div>' + nav.list().map(function (x) {
      return '<button data-id="' + esc(x.id) + '"' + (x.id === script.id ? ' class="on"' : '') + '>' + esc(x.title) + '</button>';
    }).join('');
    el.classList.remove('hidden');
    var on = el.querySelector('.on'); if (on) on.scrollIntoView({ block: 'center' });
  }
  function closeList() { $('pList').classList.add('hidden'); }

  /* ---------------- Open / close ---------------- */
  function open(opts) {
    onClose = opts.onClose; nav = opts.nav || null; S = {};
    isOpen = true;
    $('prompter').classList.remove('hidden');
    document.body.classList.add('prompting');
    load(opts.script, opts.settings);
    updateMic(); renderDiag();
    requestAnimationFrame(frame);
    if (navigator.wakeLock) navigator.wakeLock.request('screen').then(function (l) { wakeLock = l; }).catch(function () {});
    if (S.scrollMode === 'voice' && S.startMode === 'auto') startTake(true);
    if (S.scrollMode === 'voice' && SR && !listening) { ovMic = true; showOverlay('🎙', 'Tap anywhere to turn on the microphone. After that it stays hands free.'); }
    else hideOverlay();
  }
  function close() {
    if (!isOpen) return;
    Log.line('close'); Log.flush();
    micOff(); clearInterval(countTimer);
    isOpen = false; mode = 'ready';
    if (wakeLock) { try { wakeLock.release(); } catch (e) {} wakeLock = null; }
    $('prompter').classList.add('hidden'); document.body.classList.remove('prompting'); hideOverlay();
    closeList();
    var cb = onClose; onClose = null;
    if (cb) cb(adjusted, script);
  }

  function wire() {
    $('pBack').onclick = function () { close(); };
    $('pMicBtn').onclick = function () { if (listening) micOff(); else { hideOverlay(); ovMic = false; micOn(); } };
    $('pPlay').onclick = togglePlay;
    $('pRestart').onclick = restartTake;
    $('pFontDown').onclick = function () { bumpFont(-4); };
    $('pFontUp').onclick = function () { bumpFont(4); };
    $('pPrev').onclick = function () { switchScript(-1); };
    $('pNext').onclick = function () { switchScript(1); };
    $('pListBtn').onclick = function () { if ($('pList').classList.contains('hidden')) openList(); else closeList(); };
    $('pList').onclick = function (e) { var b = e.target.closest('button[data-id]'); if (b) switchScript(0, b.dataset.id); };
    $('pOverlay').onclick = function () {
      if (mode === 'countdown') return;
      hideOverlay(); closeList();
      if (ovMic) { ovMic = false; micOn(); }
    };
    $('pText').addEventListener('click', function (e) {
      var w = e.target.closest('.w'); if (!w) return;
      var wi = +w.dataset.i;
      for (var i = 0; i < T.length; i++) if (T[i].w >= wi) { pos = i; break; }
      endPending = false; resetHeard(); paint();
    });
    document.addEventListener('keydown', function (e) {
      if (!isOpen) return;
      if (e.code === 'Space') { e.preventDefault(); togglePlay(); }
      else if (e.key === 'r' || e.key === 'R') restartTake();
      else if (e.key === 'Escape') { if (!$('pList').classList.contains('hidden')) closeList(); else close(); }
      else if (e.key === 'PageDown' || e.key === 'ArrowRight') { e.preventDefault(); switchScript(1); }
      else if (e.key === 'PageUp' || e.key === 'ArrowLeft') { e.preventDefault(); switchScript(-1); }
    });
    window.addEventListener('resize', function () { if (isOpen) paint(); });
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible' && wakeLock === null && navigator.wakeLock && isOpen)
        navigator.wakeLock.request('screen').then(function (l) { wakeLock = l; }).catch(function () {});
    });
  }

  root.Prompter = { open: open, close: close, wire: wire, isOpen: function () { return isOpen; }, hasSpeech: !!SR };
})(this);
