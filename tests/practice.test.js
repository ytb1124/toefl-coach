// Run: node --test tests/*.test.js
const test = require('node:test');
const assert = require('node:assert');
const P = require('../app/practice.js');

test('align marks missed reference words and extras (받아쓰기·L&R 공용)', () => {
  const a = P.align('Start by taking a map from the front desk.', 'start taking the map from desk');
  assert.deepStrictEqual(a.words.filter(w => !w.ok).map(w => w.w), ['by', 'a', 'the', 'front']);
  assert.deepStrictEqual(a.extra, ['the']);
  assert.strictEqual(a.total, 9); assert.strictEqual(a.ok, 5); assert.strictEqual(a.pct, 56);
  assert.strictEqual(P.align("It's the station’s bike", "it's the station's bike").pct, 100);
});

test('C-Test answer accepts the missing letters or the full word', () => {
  assert.ok(P.ctestOk('mple', 'exa', 'mple'));
  assert.ok(P.ctestOk(' Example ', 'exa', 'mple'));
  assert.ok(!P.ctestOk('mpel', 'exa', 'mple'));
  assert.ok(!P.ctestOk('', 'exa', 'mple'));
});

test('evidence lines and replay span from script timestamps', () => {
  const lines = [{ sp: 'N', t: 'Narration line.', at: 0 }, { sp: 'M', t: 'Did you pack the blue umbrella for the trip?', at: 2.4 }, { sp: 'W', t: 'It is in the car.', at: 5.1 }];
  const idx = P.evidenceLines(lines, ['pack the blue umbrella']);
  assert.deepStrictEqual(idx, [1]);
  assert.deepStrictEqual(P.lineSpan(lines, idx), [2.2, 5.2]);
  assert.strictEqual(P.lineSpan([{ t: 'x', at: null }], [0]), null);
  assert.deepStrictEqual(P.lineSpan(lines, [2]), [4.9, null]);
});

test('wpm and passage markers', () => {
  assert.strictEqual(P.wpm(200, 60000), 200);
  assert.strictEqual(P.wpm(10, 0), null);
  assert.strictEqual(P.showPassage('A [[iA]]B [[sB]]C'), 'A  ■A B [B] C');
});

test('sentenceTarget: only the evidence sentence(s) of a paragraph line, with sentence times', () => {
  const lines = [
    { sp: 'N', t: 'Listen to a talk.', at: 0 },
    { sp: 'M', t: 'One. Two has the key idea. Three. Four.', at: 3, ss: [{ t: 'One.', at: 3 }, { t: 'Two has the key idea.', at: 4 }, { t: 'Three.', at: 7 }, { t: 'Four.', at: 8 }] },
    { sp: 'M', t: 'Next part.', at: 10 },
  ];
  const r = P.sentenceTarget(lines, [1], ['the key idea'], 3);
  assert.deepStrictEqual(r.sents, ['Two has the key idea.']);
  assert.deepStrictEqual(r.span, [3.8, 7.1]);
  const all = P.sentenceTarget(lines, [1], [], 3);   // no evidence → first 3 sentences of the line
  assert.deepStrictEqual(all.sents, ['One.', 'Two has the key idea.', 'Three.']);
  assert.deepStrictEqual(all.span, [2.8, 8.1]);
  const plain = P.sentenceTarget(lines, [2], ['next part'], 3);   // no ss → whole line, end = to the end
  assert.deepStrictEqual(plain.sents, ['Next part.']); assert.strictEqual(plain.span[1], null);
});
