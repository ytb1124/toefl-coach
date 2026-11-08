const test = require('node:test');
const assert = require('node:assert');
const D = require('../app/dups.js');

const mc = (id, nt, n) => ({ id, cat: 'L1', nt, n, qs: [{ ans: 'A', opts: ['a', 'b', 'c', 'd'] }] });
const build = { id: 'W', cat: 'W1', nt: 2, n: 2, answer: 'Do you know if she included the schedule?' };

test('modeOf: 문제 종류', () => {
  assert.strictEqual(D.modeOf(mc('a', 2, 2)), 'mc');
  assert.strictEqual(D.modeOf(build), 'build');
  assert.strictEqual(D.modeOf({ cat: 'S2' }), 'speak');
  assert.strictEqual(D.modeOf({ cat: 'R1' }), 'view');
});
test('checkBuild: 대소문자·문장부호·공백 무시', () => {
  assert.ok(D.checkBuild('do you know if she included the schedule', build.answer));
  assert.ok(D.checkBuild('  Do you know, if she included the SCHEDULE?? ', build.answer));
  assert.ok(!D.checkBuild('Do you know if she included schedule', build.answer));
});
test('status: 안 풂 / 또 틀림 / 맞힘, 말하기는 한 번이면 끝냄', () => {
  const g = mc('a', 2, 2);
  assert.strictEqual(D.status(g, undefined), 'new');
  assert.strictEqual(D.status(g, { tries: [{ at: 1, ok: 0, n: 1 }] }), 'again');
  assert.strictEqual(D.status(g, { tries: [{ at: 1, ok: 0, n: 1 }, { at: 2, ok: 1, n: 1 }] }), 'fixed');
  assert.strictEqual(D.status({ cat: 'S2' }, { tries: [{ at: 1, done: true }] }), 'fixed');
});
test('queue: 또 틀림 → 많이 반복된 새 문제 → 다시 푼 것', () => {
  const a = mc('a', 2, 2), b = mc('b', 4, 4), c = mc('c', 3, 3), d = mc('d', 2, 3);
  const recs = { a: { tries: [{ at: 5, ok: 1, n: 1 }] }, d: { tries: [{ at: 9, ok: 0, n: 1 }] } };
  assert.deepStrictEqual(D.queue([a, b, c, d], recs).map(x => x.id), ['d', 'b', 'c', 'a']);
});
test('queue: 섹션 필터', () => {
  const l = mc('l', 2, 2), w = Object.assign({}, build);
  assert.deepStrictEqual(D.queue([l, w], {}, { cat: 'W1' }).map(x => x.id), ['W']);
  assert.strictEqual(D.queue([l, w], {}, { cat: 'all' }).length, 2);
});
test('counts', () => {
  const a = mc('a', 2, 2), b = mc('b', 2, 2);
  assert.deepStrictEqual(D.counts([a, b], { a: { tries: [{ at: 1, ok: 0, n: 1 }] } }), { new: 1, again: 1, fixed: 0 });
});
