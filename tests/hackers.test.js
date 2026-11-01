// Run: node --test tests/*.test.js
const test = require('node:test');
const assert = require('node:assert');
const K = require('../app/hackers.js');

test('ids: 20 Email + 20 Discussion; every 3rd day is a cold (unseen) prompt', () => {
  assert.strictEqual(K.IDS.E.length, 20); assert.strictEqual(K.IDS.D[0], 'HD01');
  assert.deepStrictEqual(K.IDS.D.filter(K.isCold).map(K.dayOf), [3, 6, 9, 12, 15, 18]);
  assert.strictEqual(K.typeOf('HE07'), 'E'); assert.strictEqual(K.typeOf('HD07'), 'D');
});

test('bold expressions are found ignoring case and punctuation, but not inside other words', () => {
  const hits = K.boldHits("i hope this email finds you well! I'm writing to request info.", ['I hope this email finds you well.', "I am writing to request", 'Thank you very much']);
  assert.deepStrictEqual(hits.map(x => x.ok), [true, false, false]);
  assert.deepStrictEqual(K.boldHits('reasonable choices', ['reason able']).map(x => x.ok), [false]);
});

test('spans: bold wins over overlapping underline, text is preserved', () => {
  const t = 'This is mainly because libraries offer a calm setting.';
  const s = K.spans(t, ['This is mainly because'], ['mainly because libraries', 'calm setting']);
  assert.strictEqual(s.map(x => x.t).join(''), t);
  assert.deepStrictEqual(s.filter(x => x.b).map(x => x.t), ['This is mainly because']);
  assert.deepStrictEqual(s.filter(x => x.u).map(x => x.t), ['calm setting']);
});

test('verdict: labels all filled, word target (D 110 / E 100), errors ≤ 2', () => {
  assert.ok(K.verdict('D', { words: 110, errors: 2, labelsOk: 5, labelsTotal: 5 }).pass);
  assert.ok(!K.verdict('D', { words: 105, errors: 0, labelsOk: 5, labelsTotal: 5 }).pass);
  assert.ok(K.verdict('E', { words: 100, errors: 0, labelsOk: 6, labelsTotal: 6 }).pass);
  assert.ok(!K.verdict('E', { words: 120, errors: 3, labelsOk: 6, labelsTotal: 6 }).pass);
});

test('left: items without a hk record, in day order', () => {
  const log = [{ kind: 'hk', task: 'HD01' }, { kind: 'bs', task: 'HD02' }, { kind: 'hk', task: 'HE03' }];
  assert.deepStrictEqual(K.left(log, 'D').slice(0, 2), ['HD02', 'HD03']);
  assert.strictEqual(K.left(log, 'E').length, 19);
});

test('bold: multi-sentence chunks split; names in a bold chunk match any name', () => {
  const hits = K.boldHits('I hope this email finds you well. My name is Taebin Yoo, and I am a student.', ['I hope this email finds you well. My name is Jane Smith, and I am']);
  assert.deepStrictEqual(hits.map(x => [x.b, x.ok]), [['I hope this email finds you well.', true], ['My name is Jane Smith, and I am', true]]);
  assert.deepStrictEqual(K.boldHits("I'm writing to invite you", ["I'm writing to invite you"]).map(x => x.ok), [true]);
});

test('one-word bold chunks are not scored', () => {
  assert.deepStrictEqual(K.boldHits('because of rain', ['because', 'Without', 'According to research,']).map(x => x.b), ['According to research,']);
});
