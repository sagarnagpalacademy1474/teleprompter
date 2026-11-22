/* Teleprompter core: text normalization + voice position matching.
 * No AI. Plain fuzzy alignment of the last few spoken words against the script.
 * Works in the browser (window.PrompterCore) and in Node (module.exports).
 */
(function (root) {
  'use strict';

  var ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
    'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
  var TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];

  function numToWords(n) {
    if (n < 20) return [ONES[n]];
    if (n < 100) return n % 10 ? [TENS[Math.floor(n / 10)], ONES[n % 10]] : [TENS[n / 10]];
    if (n < 1000) {
      var rest = n % 100;
      return [ONES[Math.floor(n / 100)], 'hundred'].concat(rest ? numToWords(rest) : []);
    }
    if (n < 10000 && n >= 1100 && n % 100 !== 0 && Math.floor(n / 100) % 10 !== 0) {
      // years like 1998 -> nineteen ninety eight
      return numToWords(Math.floor(n / 100)).concat(numToWords(n % 100));
    }
    if (n < 1000000) {
      var r = n % 1000;
      return numToWords(Math.floor(n / 1000)).concat(['thousand']).concat(r ? numToWords(r) : []);
    }
    return [String(n)];
  }

  // Lowercase, strip accents/punctuation. Keeps a-z, 0-9 and Devanagari.
  function normWord(w) {
    w = String(w).toLowerCase();
    if (w.normalize) w = w.normalize('NFKD').replace(/[̀-ͯ]/g, '');
    w = w.replace(/[’'`]/g, '');
    return w.replace(/[^a-z0-9ऀ-ॿ]/g, '');
  }

  // Split a raw word into one or more normalized tokens (numbers expand).
  function expand(raw) {
    var n = normWord(raw);
    if (!n) return [];
    if (/^\d+$/.test(n) && n.length <= 6) return numToWords(parseInt(n, 10));
    var m = n.match(/^(\d+)(st|nd|rd|th|s)$/);
    if (m) return numToWords(parseInt(m[1], 10));
    if (/\d/.test(n) && /[a-z]/.test(n)) {
      // e.g. "5g", "covid19": split letters / digits
      var out = [];
      n.replace(/[a-z]+|\d+/g, function (p) { out = out.concat(/\d/.test(p) && p.length <= 6 ? numToWords(+p) : [p]); return p; });
      return out;
    }
    return [n];
  }

  // Script -> { words: [raw display words], tokens: [{t, key, w}] } where w = display word index.
  function tokenizeScript(text) {
    var words = String(text).split(/\s+/).filter(Boolean);
    var tokens = [];
    words.forEach(function (raw, wi) {
      // hyphenated words become separate tokens ("well-known" -> well known)
      raw.split(/[-–—/]+/).forEach(function (part) {
        expand(part).forEach(function (t) { tokens.push({ t: t, key: phoneticKey(t), w: wi }); });
      });
    });
    return { words: words, tokens: tokens };
  }

  function tokenizeSpeech(text) {
    var out = [];
    String(text).split(/[\s\-–—/]+/).forEach(function (raw) {
      expand(raw).forEach(function (t) { out.push({ t: t, key: phoneticKey(t) }); });
    });
    return out;
  }

  // Loose sound-alike key so small spelling / recognition differences match.
  function phoneticKey(w) {
    return w
      .replace(/ph/g, 'f').replace(/ck/g, 'k').replace(/q/g, 'k').replace(/c(?=[eiy])/g, 's').replace(/c/g, 'k')
      .replace(/z/g, 's').replace(/w/g, 'v').replace(/x/g, 'ks')
      .replace(/(.)\1+/g, '$1')         // collapse doubles: "aaj" -> "aj"
      .replace(/(?!^)[aeiouy]+/g, '')   // drop vowels except the first letter
      .replace(/h(?![aeiou])/g, '');
  }

  function lev(a, b) {
    if (a === b) return 0;
    var m = a.length, n = b.length;
    if (!m) return n; if (!n) return m;
    var prev = new Array(n + 1), cur = new Array(n + 1), i, j;
    for (j = 0; j <= n; j++) prev[j] = j;
    for (i = 1; i <= m; i++) {
      cur[0] = i;
      for (j = 1; j <= n; j++) {
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      }
      var tmp = prev; prev = cur; cur = tmp;
    }
    return prev[n];
  }

  var STOP = {};
  ('the a an to and of is in it i you we he she they this that for on at be are was so or as with my your our ' +
    'hai ka ki ke ko se me mein ye vo to bhi na').split(' ').forEach(function (w) { STOP[w] = 1; });

  // Similarity of two tokens in [0,1].
  function sim(a, b) {
    if (a.t === b.t) return 1;
    if (a.key && a.key === b.key) return 0.9;
    var L = Math.max(a.t.length, b.t.length);
    if (L < 4) return 0;
    var s = 1 - lev(a.t, b.t) / L;
    return s >= 0.7 ? s * 0.85 : 0;
  }

  function weight(tok) { return STOP[tok.t] ? 0.4 : 1; }

  // Weighted fuzzy LCS between spoken S and script slice T[from..to]; requires the
  // script token at `to` to match one of the last two spoken tokens.
  function alignScore(S, T, from, to) {
    var m = S.length, n = to - from + 1;
    var endOk = sim(S[m - 1], T[to]) > 0 || (m > 1 && sim(S[m - 2], T[to]) > 0);
    if (!endOk) return 0;
    var dp = [], i, j;
    for (i = 0; i <= m; i++) { dp.push(new Array(n + 1).fill(0)); }
    for (i = 1; i <= m; i++) {
      for (j = 1; j <= n; j++) {
        var s = sim(S[i - 1], T[from + j - 1]);
        var best = Math.max(dp[i - 1][j], dp[i][j - 1]);
        if (s > 0) best = Math.max(best, dp[i - 1][j - 1] + s * weight(T[from + j - 1]));
        dp[i][j] = best;
      }
    }
    return dp[m][n];
  }

  var DEFAULTS = {
    tail: 6,          // how many recent spoken tokens to use
    back: 60,         // how far back to look (repeats)
    ahead: 45,        // how far forward to look (skipped lines)
    minScore: 2.6,    // minimum weighted matches to move at all
    farAhead: 12,     // forward jumps beyond this need a stronger match
    farScore: 3.6
  };

  /* Find where the speaker is.
   * tokens: script tokens; spoken: recent spoken tokens; pos: index of next expected token.
   * Returns {pos: newNextIndex, end: matchedIndex, score} or null (no confident match: hold still).
   */
  function locate(tokens, spoken, pos, opts) {
    opts = Object.assign({}, DEFAULTS, opts || {});
    var S = spoken.slice(-opts.tail);
    if (S.length < 2 || !tokens.length) return null;
    var lo = Math.max(0, pos - opts.back), hi = Math.min(tokens.length - 1, pos + opts.ahead);
    if (opts.window) { lo = Math.max(lo, opts.window[0]); hi = Math.min(hi, opts.window[1]); }
    var best = null;
    for (var e = lo; e <= hi; e++) {
      var from = Math.max(0, e - S.length - 3);
      var sc = alignScore(S, tokens, from, e);
      if (sc <= 0) continue;
      var d = e - pos;                       // 0 = speaker just said the next expected word
      var need = Math.min(opts.minScore, S.length * 0.75);
      if (d > opts.farAhead) need = Math.max(need, opts.farScore);
      if (sc < need) continue;
      var rank = sc - 0.015 * Math.abs(d) - (d < -2 ? 0.3 : 0); // prefer nearby, slight bias forward
      if (!best || rank > best.rank) best = { pos: e + 1, end: e, score: sc, rank: rank };
    }
    return best;
  }

  // Does the end of `spoken` equal `phrase` (fuzzy)? Used for wake / command phrases.
  function endsWithPhrase(spoken, phrase) {
    var P = tokenizeSpeech(phrase);
    if (!P.length || spoken.length < P.length) return false;
    var tail = spoken.slice(-P.length);
    for (var i = 0; i < P.length; i++) if (sim(tail[i], P[i]) < 0.6) return false;
    return true;
  }

  function isPhrase(spoken, phrase) {
    var P = tokenizeSpeech(phrase);
    return spoken.length === P.length && endsWithPhrase(spoken, phrase);
  }

  // Does the phrase appear anywhere in the script? (warn the user)
  function scriptContainsPhrase(tokens, phrase) {
    var P = tokenizeSpeech(phrase);
    outer: for (var i = 0; i + P.length <= tokens.length; i++) {
      for (var j = 0; j < P.length; j++) if (sim(tokens[i + j], P[j]) < 0.6) continue outer;
      return true;
    }
    return false;
  }

  var api = {
    tokenizeScript: tokenizeScript, tokenizeSpeech: tokenizeSpeech, locate: locate,
    endsWithPhrase: endsWithPhrase, isPhrase: isPhrase, scriptContainsPhrase: scriptContainsPhrase,
    normWord: normWord, phoneticKey: phoneticKey, sim: sim, DEFAULTS: DEFAULTS
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PrompterCore = api;
})(this);
