// Run: node --test tests/*.test.js
const test = require('node:test');
const assert = require('node:assert');
const P = require('../app/practice.js');

test('align marks missed reference words and extras (받아쓰기·L&R 공용)', () => {
  const a = P.align('Begin by choosing a bike from the station.', 'begin choosing the bike from station');
  assert.deepStrictEqual(a.words.filter(w => !w.ok).map(w => w.w), ['by', 'a', 'the']);
  assert.deepStrictEqual(a.extra, ['the']);
  assert.strictEqual(a.total, 8); assert.strictEqual(a.ok, 5); assert.strictEqual(a.pct, 63);
  assert.strictEqual(P.align("It's the station’s bike", "it's the station's bike").pct, 100);
});

test('C-Test answer accepts the missing letters or the full word', () => {
  assert.ok(P.ctestOk('mple', 'exa', 'mple'));
  assert.ok(P.ctestOk(' Example ', 'exa', 'mple'));
  assert.ok(!P.ctestOk('mpel', 'exa', 'mple'));
  assert.ok(!P.ctestOk('', 'exa', 'mple'));
});

test('evidence lines and replay span from script timestamps', () => {
  const lines = [{ sp: 'N', t: 'Listen to a conversation.', at: 0 }, { sp: 'M', t: 'I hope you remembered to bring the tickets.', at: 2.4 }, { sp: 'W', t: 'I thought you had them.', at: 5.1 }];
  const idx = P.evidenceLines(lines, ['remembered to bring the tickets']);
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
