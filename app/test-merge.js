// node app/test-merge.js
const M = require('./merge.js');
let fail = 0; const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fail++; };
const now = 10_000_000;
const sc = (id, title, m, folderId = null) => ({ id, title, body: title, folderId, settings: {}, _m: m });
const fo = (id, name, m, parentId = null) => ({ id, name, parentId, settings: {}, _m: m });

// 1. both sides add different scripts
let r = M.merge({ scripts: { a: sc('a', 'A', 1) } }, { scripts: { b: sc('b', 'B', 2) } }, now);
ok(r.scripts.a && r.scripts.b, 'union of new scripts');
// 2. same script edited on both: newest wins
r = M.merge({ scripts: { a: sc('a', 'iPad edit', 5) } }, { scripts: { a: sc('a', 'laptop edit', 7) } }, now);
ok(r.scripts.a.title === 'laptop edit', 'newest edit wins');
// 3. delete on one device beats an older copy on the other
r = M.merge({ scripts: {}, deleted: { a: 9 } }, { scripts: { a: sc('a', 'A', 5) } }, now);
ok(!r.scripts.a && r.deleted.a === 9, 'delete propagates');
// 4. edit after the delete keeps the script
r = M.merge({ scripts: {}, deleted: { a: 4 } }, { scripts: { a: sc('a', 'A', 6) } }, now);
ok(!!r.scripts.a, 'edit newer than delete survives');
// 5. script in a deleted folder moves to top level
r = M.merge({ folders: {}, deleted: { f: 9 } }, { folders: { f: fo('f', 'F', 3) }, scripts: { a: sc('a', 'A', 10, 'f') } }, now);
ok(!r.folders.f && r.scripts.a.folderId === null, 'orphan script goes to top level');
// 6. folder cycle is broken
r = M.merge({ folders: { x: fo('x', 'X', 5, 'y'), y: fo('y', 'Y', 1) } }, { folders: { y: fo('y', 'Y', 6, 'x'), x: fo('x', 'X', 1) } }, now);
ok(!(r.folders.x.parentId === 'y' && r.folders.y.parentId === 'x'), 'folder cycle broken');
// 7. global settings: newer wins
r = M.merge({ global: { fontSize: 60 }, globalAt: 3 }, { global: { fontSize: 80 }, globalAt: 4 }, now);
ok(r.global.fontSize === 80, 'newer global settings win');
// 8. seeded samples (_m 1) never overwrite edited copies
r = M.merge({ scripts: { sample1: sc('sample1', 'orig', 1) } }, { scripts: { sample1: sc('sample1', 'edited', 50) } }, now);
ok(r.scripts.sample1.title === 'edited', 'fresh device seed does not overwrite');
// 9. old tombstones are dropped
r = M.merge({ deleted: { a: 1 } }, {}, 1 + 91 * 86400000);
ok(!('a' in r.deleted), 'tombstones older than 90 days pruned');
// 10. same() ignores key order and extra file fields
ok(M.same({ scripts: { a: { x: 1, y: 2 } } }, { app: 'teleprompter', scripts: { a: { y: 2, x: 1 } } }), 'same() ignores key order');
// 11. merge is idempotent
const L = { scripts: { a: sc('a', 'A', 3) }, folders: { f: fo('f', 'F', 2) }, deleted: { z: 5 }, global: { mirror: true }, globalAt: 2 };
ok(M.same(M.merge(L, L, now), L), 'merge(L, L) == L');
console.log(fail ? fail + ' FAILED' : '\nALL PASSED'); process.exit(fail ? 1 : 0);
