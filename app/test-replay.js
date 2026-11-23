// Replays real iPad (hi-IN) mic output against the real script, word by word.
// Run: node app/test-replay.js
var C = require('./core.js'); var fails = 0;
function replay(name, script, heard, wantEndWithin) {
  var T = C.tokenizeScript(script).tokens, words = heard.split(/\s+/), pos = 0;
  for (var i = 2; i <= words.length; i++) {
    var all = C.tokenizeSpeech(words.slice(0, i).join(' '));
    var r = C.locate(T, all.slice(-8), pos);
    if (r) pos = r.pos;
  }
  var ok = pos >= T.length - wantEndWithin;
  console.log((ok ? 'PASS ' : 'FAIL ') + name + ' pos=' + pos + ' of ' + T.length);
  if (!ok) fails++;
}
var S07 = 'Ek rejection mila, aur usi ke saath self-doubt bhi aa gaya?\nAB Chahe wo job ho, client ho, ya koi rishta.\nI KNOW, jab aapne dil se koshish ki ho, toh ek "na" BHI KITNA chubhta hai.\nLekin har "na" ko apni kaabiliyat ka faisla mat banao.\nAgar sach mein koi kami hai, toh use sudhaaro aur aage badho.\nApne lomdi or angoor wali story to suni hi hogi - kami angoor mei to thi hi nahi..';
// 2026-11-23 iPad log, script 07: last line ends "to thi hi nahi" (heard as "कस में तो थी ही नहीं")
replay('07 real read reaches the end', S07, 'प्रोम को एक रे मिला और उसी के साथ तुम्हें आ गया अब चाहे वो जॉब वो क्लाइंट हो या कोई रिश्ता हो जब आपने दिल से कोशिश की तो एक नवा भी कितना चाहता है लेकिन तुम्हारे हर को अपनी कबित बनाने साला मत बना अगर सच में कोई कमी है तो उसे सुधार और आगे बढ़ो आपने कि की स्टोरी तो सुनी होगी कस में कभी नहीं कस में तो थी ही नहीं', 1);
var S08 = 'Ek video pe din bhar mehnat ki, aur views umeed se bahut kam aaye?\nHaan, aisa aksar hota hai.\nJo log kuch bada banane nikalte hain, unke saath aisa aksar hota hai.\nSuccess koi ek seedhi nahi, poori seedhiyon ka safar hai.\nHar video ko ek seedhi samjho, aur 100 seedhiyan chadho.\nHar ek seedhi se kuch seekho, aur dekho log kahan reh gaye aur aap kitni aage aa gaye.\nJo tikta hai, wahi banta hai.';
replay('08 real read reaches the end', S08, 'प्रमोटर को एक वीडियो पर दिन भर मेहनत भी और उम्मीद से कमाए हा अक्सर होता है जो लोग कुछ बड़ा नहीं निकलते हैं जो लोग कुछ बड़ा करने निकलते हैं उनके साथ अक्सर होता है को एक नहीं है पूरी सीढ़ियों सफ़र है हर वीडियो को एक और सीधी चढ़ा हर एक सीधी से ख़ुद को और देखो लोग कहाँ रहे हैं और आप कितनी आ गए जो टिकता है वही बनता है', 1);
// commands that must work while reading
function cmd(name, heard, phrase, want) {
  var got = C.endsWithStrong(C.tokenizeSpeech(heard).slice(-8), phrase);
  console.log((got === want ? 'PASS ' : 'FAIL ') + name + ' got=' + got); if (got !== want) fails++;
}
cmd('restart mid-script (Hindi mic)', 'तो उसे सुधार और आगे बढ़ो प्रमोटर रीस्टार्ट', 'prompter restart, phir se shuru', true);
cmd('restart mid-script (cut prom)', 'सुनी होगी प्रोम रीस्टार्ट', 'prompter restart, phir se shuru', true);
cmd('restart mid-script (English mic)', 'and that is all prompter restart', 'prompter restart, phir se shuru', true);
cmd('weak phrase ignored mid-script', 'aur phir se shuru karo', 'prompter restart, phir se shuru', false);
cmd('next script', 'प्रमोटर नेक्स्ट', 'prompter next, agli script', true);
cmd('previous script', 'प्रोम को प्रीवियस', 'prompter previous, pichli script', true);
cmd('restart is not next', 'प्रमोटर रीस्टार्ट', 'prompter next, agli script', false);
cmd('go is not restart', 'प्रमोटर गो', 'prompter restart, phir se shuru', false);
cmd('script words do not restart', 'tum ready nahi ho kabhi time sahi nahi lagta', 'prompter restart, phir se shuru', false);
console.log(fails ? '\n' + fails + ' FAILED' : '\nALL PASSED'); process.exit(fails ? 1 : 0);
