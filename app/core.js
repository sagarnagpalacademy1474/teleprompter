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

  /* ---------- Devanagari -> Roman (rule based, tuned to how Hinglish is usually typed) ---------- */
  var CONS = {
    'क': 'k', 'ख': 'kh', 'ग': 'g', 'घ': 'gh', 'ङ': 'n',
    'च': 'ch', 'छ': 'chh', 'ज': 'j', 'झ': 'jh', 'ञ': 'n',
    'ट': 't', 'ठ': 'th', 'ड': 'd', 'ढ': 'dh', 'ण': 'n',
    'त': 't', 'थ': 'th', 'द': 'd', 'ध': 'dh', 'न': 'n',
    'प': 'p', 'फ': 'ph', 'ब': 'b', 'भ': 'bh', 'म': 'm',
    'य': 'y', 'र': 'r', 'ल': 'l', 'ळ': 'l', 'व': 'v',
    'श': 'sh', 'ष': 'sh', 'स': 's', 'ह': 'h',
    // precomposed nukta letters
    'क़': 'q', 'ख़': 'kh', 'ग़': 'g', 'ज़': 'z', 'ड़': 'd', 'ढ़': 'dh', 'फ़': 'f', 'य़': 'y'
  };
  var NUKTA = { k: 'q', kh: 'kh', g: 'g', j: 'z', d: 'd', dh: 'dh', ph: 'f', y: 'y' }; // ड़ is usually typed "d" (gaadi, padhai)
  var VOW = { 'अ': 'a', 'आ': 'aa', 'इ': 'i', 'ई': 'ii', 'उ': 'u', 'ऊ': 'uu', 'ऋ': 'ri',
    'ए': 'e', 'ऐ': 'ai', 'ओ': 'o', 'औ': 'au', 'ऑ': 'o', 'ऍ': 'e' };
  var MATRA = { 'ा': 'aa', 'ि': 'i', 'ी': 'ii', 'ु': 'u', 'ू': 'uu', 'ृ': 'ri',
    'े': 'e', 'ै': 'ai', 'ो': 'o', 'ौ': 'au', 'ॉ': 'o', 'ॅ': 'e' };

  function deva2roman(word) {
    var out = '', pending = false, i, ch;
    for (i = 0; i < word.length; i++) {
      ch = word[i];
      if (CONS[ch] !== undefined) {
        if (pending) out += 'a';
        out += CONS[ch]; pending = true;
      } else if (ch === '़') {           // nukta: change the previous consonant
        var m = out.match(/(kh|ph|dh|[kgjdy])$/);
        if (m) out = out.slice(0, -m[1].length) + NUKTA[m[1]];
      } else if (MATRA[ch] !== undefined) {
        out += MATRA[ch]; pending = false;
      } else if (ch === '्') {            // virama: no vowel
        pending = false;
      } else if (VOW[ch] !== undefined) {
        if (pending) out += 'a';
        out += VOW[ch]; pending = false;
      } else if (ch === 'ं' || ch === 'ँ') { // anusvara / chandrabindu
        if (pending) out += 'a';
        out += 'n'; pending = false;
      } else if (ch === 'ः') {
        if (pending) out += 'a';
        out += 'h'; pending = false;
      } else if (ch >= '०' && ch <= '९') {
        if (pending) out += 'a';
        out += String(ch.charCodeAt(0) - 0x966); pending = false;
      } else {
        if (pending) out += 'a';
        pending = false;
        out += ch;
      }
    }
    // final inherent vowel is silent in Hindi ("ghar", not "ghara"), except one-letter words
    if (pending && out.length <= 2) out += 'a';
    return out;
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
    var n = normWord(String(raw).replace(/[।॥]/g, ''));
    if (/[ऀ-ॿ]/.test(n)) n = normWord(deva2roman(n));
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
    return [ALIAS[n] || n];
  }
  // Hinglish spellings of the same word ("mei", "men", "mein" are all में)
  var ALIAS = { mei: 'mein', men: 'mein', mai: 'main', nahin: 'nahi', nai: 'nahi', nhi: 'nahi' };

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
      .replace(/igh/g, 'i').replace(/ght/g, 't')      // English spellings: highlight, night
      .replace(/[ts]ion/g, 'shn')                    // tension / टेंशन, celebration / सेलिब्रेशन
      .replace(/([aeiou]{2})n$/, '$1')                 // nasal endings: nahiin/nahi, hain/hai
      .replace(/ph/g, 'f').replace(/ck/g, 'k').replace(/q/g, 'k').replace(/c(?=[eiy])/g, 's').replace(/c/g, 'k')
      .replace(/z/g, 'j').replace(/w/g, 'v').replace(/x/g, 'ks').replace(/n(?=[pb])/g, 'm')
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
    'hai hain ka ki ke ko se me mein pe par aur ye yeh vo wo to bhi na ho').split(' ').forEach(function (w) { STOP[w] = 1; });

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
  // Command phrases. `phrase` may hold several alternatives separated by commas
  // ("prompter go, chalo shuru"). Matching is forgiving about how the mic splits words:
  // "prompter go", "prompt er go" and "prompterGo" all count.
  function alternatives(phrase) {
    return String(phrase || '').split(',').map(function (p) { return tokenizeSpeech(p); })
      .filter(function (P) { return P.length; });
  }
  function joined(toks, f) { return toks.map(function (t) { return t[f]; }).join(''); }
  // Voiced/unvoiced pairs sound alike to the Hindi recognizer: "go" comes back as "को" (ko).
  function devoice(k) { return k.replace(/g/g, 'k').replace(/d/g, 't').replace(/b/g, 'p'); }
  function looseSim(a, b) {
    var s = sim(a, b);
    var ka = devoice(a.key), kb = devoice(b.key), L = Math.max(ka.length, kb.length);
    if (ka === kb && ka) return Math.max(s, 0.85);
    return Math.max(s, L >= 4 ? 1 - lev(ka, kb) / L : 0);
  }
  function phraseSim(toks, P) {
    if (toks.length === P.length) {
      var all = true;
      for (var i = 0; i < P.length; i++) {
        var ok = looseSim(toks[i], P[i]) >= 0.6;
        // a long command word cut short by the mic ("prompter" -> "प्रोम"): accept a clear prefix of it
        if (!ok && i < P.length - 1 && P[i].t.length >= 6) {
          var ks0 = devoice(toks[i].key), kp0 = devoice(P[i].key);
          ok = ks0.length >= 3 && kp0.indexOf(ks0) === 0;
        }
        // the last command word may come back glued to the next sound ("go" -> "गोम्स"):
        // accept a spoken word that starts with the command word's sound, for short command words
        if (!ok && i === P.length - 1 && P[i].t.length <= 3 && i > 0) {
          var kp = devoice(P[i].key), ks = devoice(toks[i].key);
          ok = kp.length > 0 && ks.indexOf(kp) === 0;
        }
        if (!ok) { all = false; break; }
      }
      if (all) return 1;
    }
    var a = joined(toks, 't'), b = joined(P, 't');
    var ka = joined(toks, 'key'), kb = joined(P, 'key');
    if (ka === kb && a.length) return 0.9;
    var L = Math.max(a.length, b.length), KL = Math.max(ka.length, kb.length);
    var textSim = L ? 1 - lev(a, b) / L : 0;
    // sound-alike skeletons: "promoter go" / "pramotar go" vs "prompter go" differ by one letter
    var keySim = KL >= 4 ? 1 - lev(ka, kb) / KL : 0;
    return Math.max(textSim, keySim);
  }
  function matchesAt(toks, P) {
    if (phraseSim(toks, P) >= 0.75) return true;
    // one stray short sound in between ("prompter previous" -> "प्रोम को प्रीवियस")
    if (toks.length === P.length + 1 && P.length >= 2) {
      for (var i = 1; i < toks.length - 1; i++) {
        if (toks[i].t.length <= 2 && phraseSim(toks.slice(0, i).concat(toks.slice(i + 1)), P) >= 0.75) return true;
      }
    }
    return false;
  }

  function endsWithPhrase(spoken, phrase) {
    return alternatives(phrase).some(function (P) {
      for (var k = Math.max(1, P.length - 1); k <= P.length + 2; k++) {
        if (spoken.length < k) break;
        if (matchesAt(spoken.slice(-k), P)) return true;
      }
      return false;
    });
  }

  function isPhrase(spoken, phrase) {
    return spoken.length > 0 && spoken.length <= 8 && alternatives(phrase).some(function (P) {
      return spoken.length <= P.length + 2 && matchesAt(spoken, P);
    });
  }

  // Only the alternatives that start with "prompter": distinctive enough to be heard
  // in the middle of reading a script, so they work at any time.
  function strongAlternatives(phrase) {
    return String(phrase || '').split(',').filter(function (p) { return /^\s*prompter\b/i.test(p); }).join(',');
  }
  function endsWithStrong(spoken, phrase) {
    var st = strongAlternatives(phrase);
    return !!st && endsWithPhrase(spoken, st);
  }

  // Does any alternative appear in the script? (warn the user)
  function scriptContainsPhrase(tokens, phrase) {
    return alternatives(phrase).some(function (P) {
      outer: for (var i = 0; i + P.length <= tokens.length; i++) {
        for (var j = 0; j < P.length; j++) if (sim(tokens[i + j], P[j]) < 0.6) continue outer;
        return true;
      }
      return false;
    });
  }

  var VERSION = '2026-11-23.2';
  var api = {
    VERSION: VERSION,
    tokenizeScript: tokenizeScript, tokenizeSpeech: tokenizeSpeech, locate: locate,
    endsWithPhrase: endsWithPhrase, endsWithStrong: endsWithStrong, isPhrase: isPhrase, scriptContainsPhrase: scriptContainsPhrase,
    normWord: normWord, phoneticKey: phoneticKey, deva2roman: deva2roman, sim: sim, DEFAULTS: DEFAULTS
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PrompterCore = api;
})(this);
