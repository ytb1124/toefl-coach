// Run: node --test tests/*.test.js
const test = require('node:test');
const assert = require('node:assert');
const W = require('../app/write.js');

test('sentence roles (규칙 기반): 입장·이유·예시·대조·맺음', () => {
  const r = W.roles('I strongly believe that cities should ban cars. This is because traffic kills people. For example, my hometown Busan had 120 accidents last year. While Paul argues that cars help business, buses can do that too. Therefore, a ban makes sense.');
  assert.deepStrictEqual(r.map(x => x.role), ['입장', '이유', '예시', '대조', '맺음']);
});

test('discussion structure check needs a concrete example and a contrast', () => {
  const s = W.structure('I think remote work is better because it saves time.', 'discussion');
  const m = Object.fromEntries(s.checks);
  assert.ok(m['입장'] && m['이유']);
  assert.ok(!m['구체 예시 (누가·어디서·숫자)'] && !m['다른 학생과의 차이'] && !m['100단어 이상']);
});

test('email requirements come from the prompt bullets; top error categories', () => {
  assert.deepStrictEqual(W.requirements('Write an email.\n- Thank her.\n- Explain why.\n- Request more.'), ['Thank her.', 'Explain why.', 'Request more.']);
  assert.deepStrictEqual(W.topCats([[{ cat: 'TENSE' }, { cat: 'ART' }], [{ cat: 'TENSE' }], [{ cat: 'ART', level: 'info' }]], 2), ['TENSE', 'ART']);
  assert.strictEqual(W.wordCount("It's a well-known fact, isn't it?"), 6);
});

test('소站 writing times', () => {
  assert.deepStrictEqual([W.BS_SEC, W.EMAIL_SEC, W.AD_SEC, W.PLAN_SEC], [410, 420, 600, 120]);
});
