const test = require('node:test');
const assert = require('node:assert');
const { diagnose } = require('../app/kotrial.js');

test('diagnose: exam-wrong question right in Korean → English comprehension', () => {
  assert.strictEqual(diagnose({ wrong: true, answer: 2 }, 2), 'eng');
});
test('diagnose: exam-wrong question wrong in Korean → judgment', () => {
  assert.strictEqual(diagnose({ wrong: true, answer: 2 }, 1), 'judge');
});
test('diagnose: skips exam-right, vocab and unanswered questions', () => {
  assert.strictEqual(diagnose({ wrong: false, answer: 0 }, 1), null);
  assert.strictEqual(diagnose({ wrong: true, vocab: true, answer: 0 }, 0), null);
  assert.strictEqual(diagnose({ wrong: true, answer: 0 }, undefined), null);
});
