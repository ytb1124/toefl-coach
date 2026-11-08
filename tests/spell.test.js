const test = require('node:test');
const assert = require('node:assert');
require('../app/spell.js');
const S = globalThis.SpellDrill;

test('isRight ignores case, spaces and final period; fix needs the full sentence', () => {
  const sp = S.ITEMS.find(i => i.id === 'information');
  assert.ok(S.isRight(sp, ' Information '));
  assert.ok(!S.isRight(sp, 'imformation'));
  const fx = S.ITEMS.find(i => i.id === 'f-forward');
  assert.ok(S.isRight(fx, 'i look forward to meeting you'));
  assert.ok(!S.isRight(fx, 'I look forward to meet you.'));
});

test('grade moves boxes and wrong answers reset to box 0 due today', () => {
  const it = S.ITEMS[0], rec = { items: {} }, t = 1e12;
  S.grade(rec, it, true, t); S.grade(rec, it, true, t);
  assert.strictEqual(rec.items[it.id].box, 1);
  assert.strictEqual(rec.items[it.id].due, t + S.GAP[1] * 86400000);
  S.grade(rec, it, false, t);
  assert.strictEqual(rec.items[it.id].box, 0);
  assert.strictEqual(rec.items[it.id].wrong, 1);
});

test('pick serves due items first, then new ones with my own errors before common', () => {
  const rec = { items: {} }, t = 1e12;
  S.grade(rec, S.ITEMS[3], false, t - 1);
  const got = S.pick(rec, t, 5);
  assert.strictEqual(got[0].id, S.ITEMS[3].id);
  assert.ok(got.slice(1).every(i => i.src !== 'common'));
  assert.strictEqual(new Set(S.ITEMS.map(i => i.id)).size, S.ITEMS.length);
});
