/* TEST-ONLY logging. Sends mic results, matches, mode changes and errors to a private Google Sheet
 * (through a Google Form) so Claude can see what the iPad heard against the script.
 * MUST be removed before the app is finalized or deployed to Cloud Run (Tarun's instruction, 2026-11-22).
 */
(function (root) {
  'use strict';
  var LOG_URL = 'https://docs.google.com/forms/d/e/1FAIpQLScsDbEAiqqVBCB9FCTZHlUB19egytCcdDsVgIRAecCd7GCYgg/formResponse';
  var LOG_FIELD = 'entry.1536478842';
  var sid = Math.random().toString(36).slice(2, 8), seq = 0, buf = [], t0 = Date.now(), timer = null;
  var enabled = function () { return true; };

  function line(ev, data) {
    if (!enabled()) return;
    buf.push(((Date.now() - t0) / 1000).toFixed(2) + ' ' + ev + (data !== undefined ? ' ' + (typeof data === 'string' ? data : JSON.stringify(data)) : ''));
    if (!timer) timer = setTimeout(flush, 4000);
    if (buf.length > 150) flush();
  }
  function flush(useBeacon) {
    clearTimeout(timer); timer = null;
    if (!buf.length) return;
    var body = 'sid=' + sid + ' seq=' + (seq++) + ' at=' + new Date().toISOString() + '\n' + buf.join('\n');
    buf = [];
    var params = new URLSearchParams(); params.append(LOG_FIELD, body.slice(0, 40000));
    try {
      if (useBeacon && navigator.sendBeacon) navigator.sendBeacon(LOG_URL, params);
      else fetch(LOG_URL, { method: 'POST', mode: 'no-cors', body: params }).catch(function () {});
    } catch (e) {}
  }
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'hidden') flush(true); });
  window.addEventListener('pagehide', function () { flush(true); });

  root.Log = { line: line, flush: flush, sid: sid, setEnabled: function (fn) { enabled = fn; } };
})(this);
