// Simulates speech word by word and checks where the tracker ends up.
// Run: node test-core.js
var C = require('./core.js');

var script = "Hello everyone and welcome back to the channel. Today we are going to talk about three simple habits " +
  "that can change the way you study. The first habit is planning your day the night before. " +
  "When you plan ahead, you wake up with a clear goal. The second habit is taking short breaks every 45 minutes. " +
  "Your brain needs rest to remember what you learned. The third habit is revising before you sleep. " +
  "Start with these three habits and see the difference in just two weeks. Thanks for watching, see you in the next video.";

var S = C.tokenizeScript(script);
var T = S.tokens;

function speak(text, pos) {
  var heard = [];
  var words = text.split(/\s+/);
  for (var i = 0; i < words.length; i++) {
    heard = heard.concat(C.tokenizeSpeech(words[i]));
    var r = C.locate(T, heard, pos);
    if (r) pos = r.pos;
  }
  return pos;
}
function idxAfter(phrase) {
  // token index right after the first occurrence of phrase in script
  var P = C.tokenizeSpeech(phrase);
  for (var i = 0; i + P.length <= T.length; i++) {
    var ok = true;
    for (var j = 0; j < P.length; j++) if (T[i + j].t !== P[j].t) { ok = false; break; }
    if (ok) return i + P.length;
  }
  throw new Error('not in script: ' + phrase);
}

var fails = 0;
function check(name, got, want, tol) {
  tol = tol || 0;
  var ok = Math.abs(got - want) <= tol;
  if (!ok) fails++;
  console.log((ok ? 'PASS ' : 'FAIL ') + name + '  got=' + got + ' want=' + want + (tol ? ' ±' + tol : ''));
}

// 1. Exact reading
var p = speak("hello everyone and welcome back to the channel today we are going to talk about three simple habits", 0);
check('exact reading', p, idxAfter('three simple habits'));

// 2. Ad-lib: extra lines that are not in the script -> should hold still
var p2 = speak("so guys before we start make sure you hit subscribe and drink some water okay", p);
check('ad-lib holds position', p2, p, 2);

// 3. Back on script after ad-lib
var p3 = speak("that can change the way you study the first habit is planning your day", p2);
check('back on track after ad-lib', p3, idxAfter('planning your day'));

// 4. Changed words (paraphrase)
var p4 = speak("the night before when you plan in advance you get up with a clear goal", p3);
check('changed words', p4, idxAfter('with a clear goal'), 1);

// 5. Repeat the same line 2 more times -> stays at that line, does not run ahead
var p5 = speak("the second habit is taking short breaks every 45 minutes", p4);
check('second habit line', p5, idxAfter('every 45 minutes'));
var p6 = speak("the second habit is taking short breaks every 45 minutes", p5);
check('repeat 1 stays', p6, idxAfter('every 45 minutes'), 1);
var p7 = speak("okay let me say that again the second habit is to take small breaks after every 45 minutes", p6);
check('repeat 2 (reworded) stays', p7, idxAfter('every 45 minutes'), 1);

// 6. Skip a sentence and continue
var p8 = speak("the third habit is revising before you sleep", p7);
check('skipped a sentence', p8, idxAfter('revising before you sleep'));

// 7. Go back to an earlier line (redo from habit one)
var p9 = speak("the first habit is planning your day the night before", p8);
check('jump back to earlier line', p9, idxAfter('the night before'));

// 8. Finish the script
var p10 = speak("start with these three habits and see the difference in just two weeks thanks for watching see you in the next video",
  idxAfter('revising before you sleep'));
check('reaches end', p10, T.length);

// 9. Number formats
check('numbers expand', C.tokenizeSpeech('45').map(function (t) { return t.t; }).join(' ') === 'forty five' ? 1 : 0, 1);

// 10. Wake / command phrases
check('wake phrase detected', C.endsWithPhrase(C.tokenizeSpeech('okay prompter go'), 'prompter go') ? 1 : 0, 1);
check('wake phrase near-miss teleprompter go accepted', C.endsWithPhrase(C.tokenizeSpeech('teleprompter go'), 'prompter go') ? 1 : 0, 1);
check('wake phrase not triggered by normal speech', C.endsWithPhrase(C.tokenizeSpeech('we are going to talk about'), 'prompter go') ? 1 : 0, 0);
check('phrase not in script', C.scriptContainsPhrase(T, 'prompter go') ? 1 : 0, 0);
check('phrase in script warns', C.scriptContainsPhrase(T, 'see you') ? 1 : 0, 1);

// 11. Roman Hinglish spelling variations
var h = C.tokenizeScript("aaj hum baat karenge ki padhai kaise karni chahiye");
var hp = 0, heard = [];
"aj ham bat karenge ki padhayi kese karni chahie".split(' ').forEach(function (w) {
  heard = heard.concat(C.tokenizeSpeech(w)); var r = C.locate(h.tokens, heard, hp); if (r) hp = r.pos;
});
check('hinglish spelling variants', hp, h.tokens.length, 1);

console.log(fails ? '\n' + fails + ' FAILED' : '\nALL PASSED');
process.exit(fails ? 1 : 0);
