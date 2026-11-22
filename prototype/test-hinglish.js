// Hinglish (Roman script) tracking against Hindi speech recognition output (Devanagari).
// Run: node prototype/test-hinglish.js
var C = require('./core.js');
var fails = 0;
function check(name, got, want, tol) {
  tol = tol || 0;
  var ok = Math.abs(got - want) <= tol;
  if (!ok) fails++;
  console.log((ok ? 'PASS ' : 'FAIL ') + name + '  got=' + got + ' want=' + want + (tol ? ' ±' + tol : ''));
}
function speak(T, text, pos) {
  var heard = [];
  text.split(/\s+/).forEach(function (w) {
    heard = heard.concat(C.tokenizeSpeech(w));
    var r = C.locate(T, heard, pos);
    if (r) pos = r.pos;
  });
  return pos;
}
function after(T, phrase) {
  var P = C.tokenizeSpeech(phrase);
  for (var i = 0; i + P.length <= T.length; i++) {
    var ok = true;
    for (var j = 0; j < P.length; j++) if (T[i + j].t !== P[j].t) { ok = false; break; }
    if (ok) return i + P.length;
  }
  throw new Error('not in script: ' + phrase);
}

// Transliteration spot checks (key = loose sound-alike form used for matching)
[['गाड़ी', 'gaadi'], ['टेंशन', 'tension'], ['सेलिब्रेशन', 'celebration'], ['हाइलाइट', 'highlight'],
 ['इंस्टाग्राम', 'instagram'], ['कंपेयर', 'compare'], ['प्रोग्रेस', 'progress'], ['फेलियर', 'failure'],
 ['अचीवमेंट्स', 'achievements'], ['खुशी', 'khushi'], ['स्ट्रगल', 'struggle'], ['बिहाइंड', 'behind'],
 ['पढ़ना', 'padhna'], ['स्टूडेंट्स', 'students'], ['नींद', 'neend'], ['ज़िंदगी', 'zindagi']].forEach(function (p) {
  var a = C.tokenizeSpeech(p[0])[0], b = C.tokenizeSpeech(p[1])[0];
  var s = C.sim(a, b);
  if (s < 0.6) fails++;
  console.log((s >= 0.6 ? 'PASS ' : 'FAIL ') + 'translit ' + p[0] + ' -> ' + a.t + ' [' + a.key + '] vs ' + p[1] + ' [' + b.key + '] sim=' + s.toFixed(2));
});

// ---- Script 1 (Tarun's) ----
var s1 = C.tokenizeScript("Instagram pe sabki highlight reel dikhti hai. Nayi gaadi, naya ghar, celebration. Unki EMI, unki tension, " +
  "unke struggle wale din nahi dikhte.\nAur aap apne behind-the-scenes ko unki highlight reel se compare kar rahe ho.\n" +
  "Kisi aur ki progress aapki failure nahi hai.\nunki achievements ke liye khushi manao, lekin apni achievemnts ke liye jaan laga do…").tokens;

var p = speak(s1, 'इंस्टाग्राम पे सबकी हाइलाइट रील दिखती है नई गाड़ी नया घर सेलिब्रेशन उनकी ईएमआई उनकी टेंशन उनके स्ट्रगल वाले दिन नहीं दिखते', 0);
check('S1 line 1-3 (Devanagari)', p, after(s1, 'din nahi dikhte'));
var p2 = speak(s1, 'दोस्तों ये बात बहुत जरूरी है ध्यान से सुनना', p);
check('S1 ad-lib holds', p2, p, 1);
var p3 = speak(s1, 'और आप अपने बिहाइंड द सींस को उनकी हाइलाइट रील से कंपेयर कर रहे हो', p2);
check('S1 back on track', p3, after(s1, 'compare kar rahe ho'));
var p4 = speak(s1, 'किसी और की प्रोग्रेस आपकी फेलियर नहीं है', p3);
check('S1 progress line', p4, after(s1, 'failure nahi hai'));
var p5 = speak(s1, 'किसी और की प्रोग्रेस आपकी फेलियर नहीं है', p4);
check('S1 repeat stays', p5, p4, 1);
var p6 = speak(s1, 'किसी दूसरे की प्रोग्रेस आपका फेलियर नहीं है', p5);
check('S1 reworded repeat stays', p6, p4, 1);
var p7 = speak(s1, 'उनकी अचीवमेंट्स के लिए खुशी मनाओ लेकिन अपनी अचीवमेंट्स के लिए जान लगा दो', p6);
check('S1 reaches end', p7, s1.length);
// mixed output: recognizer sometimes writes English words in Latin
var p8 = speak(s1, 'Instagram पे सबकी highlight reel दिखती है नई गाड़ी', 0);
check('S1 mixed Latin + Devanagari', p8, after(s1, 'Nayi gaadi'));
// Roman output (en-IN recognizer)
var p9 = speak(s1, 'instagram pe sabki highlight reel dikhti hai nai gadi naya ghar', 0);
check('S1 Roman recognizer output', p9, after(s1, 'naya ghar'));

// ---- Script 2 (new) ----
var s2text = "Exam se pehle raat ko sabse badi galti jo students karte hain, wo hai poori raat jaag kar padhna. " +
  "Aapka dimaag thaka hua hota hai, aur jo padha hai wo bhi yaad nahi rehta. " +
  "Isliye exam se ek din pehle sirf revision karo, naya chapter mat uthao. " +
  "Raat ko kam se kam saat ghante ki neend lo. Subah halka breakfast karo aur paani peete raho. " +
  "Yaad rakhna, fresh dimaag hi aapka sabse bada hathiyaar hai.";
var s2 = C.tokenizeScript(s2text).tokens;
var q = speak(s2, 'एग्जाम से पहले रात को सबसे बड़ी गलती जो स्टूडेंट्स करते हैं वो है पूरी रात जाग कर पढ़ना', 0);
check('S2 line 1', q, after(s2, 'jaag kar padhna'));
var q2 = speak(s2, 'आपका दिमाग थका हुआ होता है और जो पढ़ा है वो भी याद नहीं रहता', q);
check('S2 line 2', q2, after(s2, 'yaad nahi rehta'));
var q3 = speak(s2, 'और हां ये मैं अपने एक्सपीरियंस से बोल रहा हूं', q2);
check('S2 ad-lib holds', q3, q2, 1);
var q4 = speak(s2, 'इसलिए एग्जाम से एक दिन पहले सिर्फ रिवीजन करो नया चैप्टर मत उठाओ', q3);
check('S2 line 3', q4, after(s2, 'mat uthao'));
var q5 = speak(s2, 'सुबह हल्का ब्रेकफास्ट करो और पानी पीते रहो', q4);
check('S2 skipped a sentence', q5, after(s2, 'peete raho'));
var q6 = speak(s2, 'रात को कम से कम सात घंटे की नींद लो', q5);
check('S2 went back a sentence', q6, after(s2, 'neend lo'));
var q7 = speak(s2, 'सुबह हल्का ब्रेकफास्ट करो और पानी पीते रहो याद रखना फ्रेश दिमाग ही आपका सबसे बड़ा हथियार है', q6);
check('S2 reaches end', q7, s2.length);

// ---- Commands heard through the Hindi mic ----
var WAKE = 'prompter go, chalo shuru, chalo shuru karte hain, shuru karte hain', RESTART = 'prompter restart, phir se shuru';
[['प्रोम को', 1], ['प्रोम गो', 1], ['प्रो को', 0], ['प्रमोटर को', 1], ['प्रमोटर गोम्स', 1], ['प्रोम', 0], ['प्रमोटर', 0], ['चलो शुरू करते हैं', 1], ['शुरू करते हैं', 1], ['प्रमोटर गो', 1], ['प्रोमोटर गो', 1], ['promoter go', 1], ['pramotar go', 1], ['प्रॉम्प्टर गो', 1], ['प्रोम्प्टर गो', 1], ['प्रॉम्प्टरगो', 1], ['ओके प्रॉम्प्टर गो', 1], ['prompter go', 1], ['prompt er go', 1],
 ['चलो शुरू', 1], ['तो चलो शुरू करते', 1], ['इंस्टाग्राम पे सबकी', 0], ['गो', 0], ['चलो', 0]].forEach(function (c) {
  var got = C.endsWithPhrase(C.tokenizeSpeech(c[0]), WAKE) ? 1 : 0;
  check('wake "' + c[0] + '"', got, c[1]);
});
[['प्रॉम्प्टर रीस्टार्ट', 1], ['प्रोम्प्टर री स्टार्ट', 1], ['फिर से शुरू', 1], ['फिर से शुरू करो यार अभी', 0], ['किसी और की प्रोग्रेस', 0]].forEach(function (c) {
  var got = C.isPhrase(C.tokenizeSpeech(c[0]), RESTART) ? 1 : 0;
  check('restart "' + c[0] + '"', got, c[1]);
});
check('wake not in script 1', C.scriptContainsPhrase(s1, WAKE) ? 1 : 0, 0);
check('wake not in script 2', C.scriptContainsPhrase(s2, WAKE) ? 1 : 0, 0);

// ---- Real iPad output (from Tarun's test log, 2026-11-22) ----
var real = speak(s1, 'पे सब की ली रील रखती है नई गाड़ी नवा घर', 0);
check('real iPad line 1 (Instagram dropped, highlight heard as ली)', real, after(s1, 'naya ghar'), 1);

console.log(fails ? '\n' + fails + ' FAILED' : '\nALL PASSED');
process.exit(fails ? 1 : 0);
