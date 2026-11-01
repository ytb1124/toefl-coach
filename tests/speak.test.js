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
