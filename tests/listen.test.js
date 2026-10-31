// Run: node --test tests/listen.test.js
const test = require('node:test');
const assert = require('node:assert');
const L = require('../app/listen.js');

const set = { id: 'S1', test: 'Z7', qs: [{ wrong: true, answer: 1 }, { wrong: false, answer: 0 }, { wrong: true, answer: 2 }] };

test('status: new → again → fixed only when every originally-wrong question is right on the latest try', () => {
  assert.strictEqual(L.status(set, undefined), 'new');
  assert.strictEqual(L.status(set, { tries: [{ at: 1, ans: [1, 3, 0] }] }), 'again');
  assert.strictEqual(L.status(set, { tries: [{ at: 1, ans: [1, 3, 2] }] }), 'fixed', 'a miss on an originally-right question does not block "fixed"');
  assert.strictEqual(L.status(set, { tries: [{ at: 1, ans: [1, 0, 2] }, { at: 2, ans: [0, 0, 2] }] }), 'again', 'latest try counts');
});

test('queue: still-wrong first, then untried (newest test first), then fixed', () => {
  const mk = (id, test) => Object.assign({}, set, { id, test });
  const sets = [mk('a', 'Z2'), mk('b', 'Z7'), mk('c', 'Z2'), mk('d', 'Z7')];
  const recs = { c: { tries: [{ at: 5, ans: [1, 0, 2] }] }, d: { tries: [{ at: 9, ans: [0, 0, 0] }] } };
  assert.deepStrictEqual(L.queue(sets, recs, ['Z2', 'Z7']).map(s => s.id), ['d', 'b', 'a', 'c']);
});

test('lineAt follows timestamps and ignores lines without one', () => {
  const lines = [{ at: 0.1 }, { at: 5 }, { at: null }, { at: 19.2 }];
  assert.strictEqual(L.lineAt(lines, 0), -1, 'before the first line');
  assert.strictEqual(L.lineAt(lines, 0.2), 0);
  assert.strictEqual(L.lineAt(lines, 10), 1);
  assert.strictEqual(L.lineAt(lines, 20), 3);
  assert.strictEqual(L.lineAt([{ at: null }], 3), -1);
});

test('status/queue count the same question re-solved in 오늘 훈련 (newest result wins)', () => {
  const s2 = { id: 'S2', test: 'Z7', qs: [{ wrong: true, answer: 1, orig: 'O1' }, { wrong: true, answer: 0, orig: 'O2' }] };
  const hist = h => q => h[q.orig] || null;
  assert.strictEqual(L.status(s2, undefined, hist({})), 'new');
  assert.strictEqual(L.status(s2, undefined, hist({ O1: { ok: true, at: 5 } })), 'new', 'one tried right, one untried');
  assert.strictEqual(L.status(s2, undefined, hist({ O1: { ok: true, at: 5 }, O2: { ok: true, at: 6 } })), 'fixed');
  assert.strictEqual(L.status(s2, undefined, hist({ O1: { ok: false, at: 5 } })), 'again');
  const rec = { tries: [{ at: 10, ans: [1, 0] }] };
  assert.strictEqual(L.status(s2, rec, hist({ O1: { ok: false, at: 5 } })), 'fixed', 'this tab\'s newer try wins');
  assert.strictEqual(L.status(s2, rec, hist({ O1: { ok: false, at: 20 } })), 'again', 'newer 오늘 훈련 miss wins');
});
