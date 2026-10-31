const test = require('node:test');
const assert = require('node:assert');
require('../app/keep.js');
const K = globalThis.KeepWords;

test('cleanWord keeps 1–4 English words and strips punctuation', () => {
  assert.strictEqual(K.cleanWord(' luciferase, '), 'luciferase');
  assert.strictEqual(K.cleanWord('“bioluminescent”'), 'bioluminescent');
  assert.strictEqual(K.cleanWord('account for'), 'account for');
  assert.strictEqual(K.cleanWord('one two three four five'), null);
  assert.strictEqual(K.cleanWord('정답'), null);
  assert.strictEqual(K.cleanWord('12'), null);
});

test('sentenceAround returns the sentence that holds the word', () => {
  const t = 'Glaciers reflect sunlight. The enzyme luciferase catalyzes the reaction. It is useful.';
  assert.strictEqual(K.sentenceAround(t, 'catalyzes'), 'The enzyme luciferase catalyzes the reaction.');
  assert.strictEqual(K.sentenceAround(t, 'absent'), '');
  assert.strictEqual(K.sentenceAround('to develop new technologies.■A The enzyme luciferase works. ■B Next.', 'luciferase'), 'The enzyme luciferase works.');
});
