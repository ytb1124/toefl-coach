// Run: node --test tests/*.test.js
const test = require('node:test');
const assert = require('node:assert');
const S = require('../app/speak.js');

test('speech stats: wpm over the speaking span, pauses ≥ 0.8s', () => {
  const w = [{ w: 'I', start: 0, end: 0.2 }, { w: 'like', start: 0.3, end: 0.6 }, { w: 'it', start: 1.6, end: 1.8 }, { w: '.', start: 1.8, end: 1.8 }, { w: 'Yes', start: 2.0, end: 3.0 }];
  const s = S.speechStats(w);
  assert.strictEqual(s.words, 4);
  assert.strictEqual(s.pauses, 1);
  assert.strictEqual(s.longest, 1);
  assert.strictEqual(s.wpm, 80);
  assert.deepStrictEqual(S.speechStats([]), { words: 0, wpm: null, pauses: 0, longest: 0 });
});

test('interview feedback: flags short, example-less, result-less answers; passes a complete one', () => {
  const bad = S.interviewFeedback('I like it. Um, um, um, um. It is good.', [], 45);
  assert.strictEqual(bad.checks.find(c => c.id === 'len').ok, false);
  assert.strictEqual(bad.checks.find(c => c.id === 'example').ok, false);
  assert.strictEqual(bad.checks.find(c => c.id === 'filler').ok, false);
  const txt = 'I prefer studying alone because I can focus. For example, when I studied for the TOEFL, I turned off my phone and finished a full test every day. As a result, my score improved. That\'s why I prefer studying alone.';
  const words = txt.split(/\s+/).map((w, i) => ({ w, start: i * 0.4, end: i * 0.4 + 0.3 }));
  const good = S.interviewFeedback(txt, words, 20);
  assert.strictEqual(good.checks.find(c => c.id === 'reason').ok, true);
  assert.strictEqual(good.checks.find(c => c.id === 'example').ok, true);
  assert.strictEqual(good.checks.find(c => c.id === 'result').ok, true);
  assert.strictEqual(good.checks.find(c => c.id === 'filler').ok, true);
});
