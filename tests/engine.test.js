// Run: node --test tests/
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const E = require('../app/engine.js');

const src = fs.readFileSync(path.join(__dirname, '../app/content.js'), 'utf8');
const ALL = JSON.parse(src.slice(src.indexOf('{'), src.lastIndexOf('}') + 1));
// Fixed fixture: the TPO2–4 baseline, so these engine tests don't shift every time a new mock test is added.
const BASE = new Set(['TPO2', 'TPO3', 'TPO4']);
const C = Object.assign({}, ALL, { tests: ALL.tests.filter(t => BASE.has(t.id)), originals: ALL.originals.filter(o => BASE.has(o.test)) });
const T0 = new Date(2026, 9, 18, 9).getTime(); // 2026-10-18
const day = n => T0 + n * E.DAY;
const blank = () => ({ settings: { examDate: '2026-10-26', minutes: 40 }, attempts: [], flags: {} });
const att = (skill, tier, correct, at, extra) => Object.assign({ skill, tier, correct, at, sid: 's' + Math.floor(at / E.DAY), conf: 2 }, extra);

test('content: 69 originals and evidence counts sum correctly', () => {
  assert.strictEqual(C.originals.length, 69);
  const primary = C.skills.reduce((s, sk) => s + E.evidence(sk.id, C.originals, C.tests).primary, 0);
  assert.strictEqual(primary, 69); // TPO3 L10–L16은 소站 공식 기록으로 채움 (UNKNOWN 없음)
  assert.strictEqual(E.evidence('ACT', C.originals, C.tests).primary, 9);
  assert.deepStrictEqual(E.evidence('FORM', C.originals, C.tests).tests, ['TPO2', 'TPO3']);
});

test('daysLeft and first interval scale with the exam date', () => {
  assert.strictEqual(E.daysLeft('2026-10-26', T0), 8);
  assert.strictEqual(E.firstInterval(8), 2);
  assert.strictEqual(E.firstInterval(1), 1);
  assert.strictEqual(E.firstInterval(30), 3);
});

test('state machine: originals → guided → transfer → improved', () => {
  const d = blank();
  ['T3-R1', 'T3-R2', 'T3-R3'].forEach((ref, i) => d.attempts.push(att('FORM', 'original', true, day(0) + i, { ref })));
  assert.strictEqual(E.replaySkill('FORM', d, C, day(0)).state, 'UNDERSTOOD');
  d.attempts.push(att('FORM', 'guided', true, day(0) + 10), att('FORM', 'guided', true, day(0) + 11));
  assert.strictEqual(E.replaySkill('FORM', d, C, day(0)).state, 'VERIFYING');
  // 4 correct transfers in ONE session is not enough (needs ≥2 sessions)
  for (let i = 0; i < 4; i++) d.attempts.push(att('FORM', 'transfer', true, day(0) + 20 + i));
  assert.strictEqual(E.replaySkill('FORM', d, C, day(0)).state, 'VERIFYING');
  d.attempts.push(att('FORM', 'transfer', true, day(1)));
  const st = E.replaySkill('FORM', d, C, day(1));
  assert.strictEqual(st.state, 'IMPROVED');
  assert.strictEqual(st.dueAt, E.dayStart('2026-10-19') + 2 * E.DAY);
});

test('hinted or original attempts never count toward mastery', () => {
  const d = blank();
  for (let i = 0; i < 6; i++) d.attempts.push(att('TARGET', 'transfer', true, day(i % 2), { hinted: true }));
  for (let i = 0; i < 6; i++) d.attempts.push(att('TARGET', 'original', true, day(0) + i, { ref: 'x' + i }));
  assert.notStrictEqual(E.replaySkill('TARGET', d, C, day(2)).state, 'IMPROVED');
});

test('confident miss blocks improvement', () => {
  const d = blank();
  d.attempts.push(att('ACT', 'transfer', false, day(0), { conf: 3 }));
  for (let i = 1; i <= 4; i++) d.attempts.push(att('ACT', 'transfer', true, day(i % 2) + i));
  assert.strictEqual(E.replaySkill('ACT', d, C, day(2)).state, 'VERIFYING');
});

test('delayed miss after improvement → relapse; two correct → verifying again', () => {
  const d = blank();
  for (let i = 0; i < 5; i++) d.attempts.push(att('BIND', 'transfer', true, day(i < 2 ? 0 : 1) + i));
  assert.strictEqual(E.replaySkill('BIND', d, C, day(1)).state, 'IMPROVED');
  d.attempts.push(att('BIND', 'delayed', false, day(3)));
  assert.strictEqual(E.replaySkill('BIND', d, C, day(3)).state, 'RELAPSED');
  d.attempts.push(att('BIND', 'transfer', true, day(3) + 1), att('BIND', 'transfer', true, day(3) + 2));
  assert.strictEqual(E.replaySkill('BIND', d, C, day(3)).state, 'VERIFYING');
});

test('delayed success → retained with doubled interval', () => {
  const d = blank();
  d.settings.examDate = '2026-11-20';
  for (let i = 0; i < 5; i++) d.attempts.push(att('WORD', 'transfer', true, day(i < 2 ? 0 : 1) + i));
  const a = E.replaySkill('WORD', d, C, day(1));
  d.attempts.push(att('WORD', 'delayed', true, day(4)));
  const b = E.replaySkill('WORD', d, C, day(4));
  assert.strictEqual(b.state, 'RETAINED');
  assert.strictEqual(b.interval, a.interval * 2);
});

test('first session: two focus skills with originals, move, guided and transfer; no unknown originals', () => {
  const s = E.buildSession(blank(), C, T0);
  assert.strictEqual(s.focus.length, 2);
  for (const f of s.focus) {
    const block = s.steps.filter(x => x.block === f);
    assert.ok(block.some(x => x.type === 'original'), f + ' has originals');
    assert.ok(block.some(x => x.type === 'move'));
    assert.ok(block.some(x => x.tier === 'guided'));
    assert.ok(block.filter(x => x.tier === 'transfer').length >= 2);
  }
  assert.ok(!s.steps.some(x => x.ref === 'T3-L10'));
  assert.strictEqual(s.steps[s.steps.length - 1].type, 'end');
  const ids = s.steps.filter(x => x.item).map(x => x.item);
  assert.strictEqual(new Set(ids).size, ids.length, 'no item twice');
});

test('final day: no focus skills, mixed practice only', () => {
  const d = blank(); d.settings.examDate = '2026-10-19';
  const s = E.buildSession(d, C, T0);
  assert.strictEqual(s.focus.length, 0);
  assert.ok(s.steps.filter(x => x.tier === 'mixed').length >= 4);
});

test('transfer items already seen are not served again as transfer', () => {
  const d = blank();
  const s1 = E.buildSession(d, C, T0);
  for (const st of s1.steps.filter(x => x.item && x.tier !== 'guided')) {
    d.attempts.push(att(st.skill, st.tier, true, T0 + 1, { item: st.item }));
  }
  const s2 = E.buildSession(d, C, day(1));
  const firstIds = new Set(s1.steps.filter(x => x.item && x.tier !== 'guided').map(x => x.item));
  for (const st of s2.steps.filter(x => x.item && ['transfer', 'mixed', 'delayed'].includes(x.tier))) {
    assert.ok(!firstIds.has(st.item), 'repeat served as transfer: ' + st.item);
  }
});

test('flagged items are excluded', () => {
  const d = blank();
  const s1 = E.buildSession(d, C, T0);
  const first = s1.steps.find(x => x.tier === 'transfer');
  d.flags[first.item] = 'two answers';
  const s2 = E.buildSession(d, C, T0);
  assert.ok(!s2.steps.some(x => x.item === first.item));
});

test('checkTyped accepts the completion or the full word', () => {
  assert.ok(E.checkTyped('ves', 'invol', 'involves'));
  assert.ok(E.checkTyped(' Involves ', 'invol', 'involves'));
  assert.ok(!E.checkTyped('ved', 'invol', 'involves'));
});

test('permutation is deterministic and a real permutation', () => {
  const p = E.permutation(4, 'T-T1#0');
  assert.deepStrictEqual(p, E.permutation(4, 'T-T1#0'));
  assert.deepStrictEqual(p.slice().sort(), [0, 1, 2, 3]);
  assert.deepStrictEqual(E.permutation(4, 'x', true), [0, 1, 2, 3]);
});

test('recency follows test dates (newest 1.0)', () => {
  const m = E.recencyMap(C.tests);
  assert.strictEqual(m.TPO4, 1); assert.strictEqual(m.TPO3, 0.85); assert.ok(Math.abs(m.TPO2 - 0.7) < 1e-9);
});

test('a real mock-test error after improvement → relapse (and its originals are scheduled first)', () => {
  const d = blank();
  for (let i = 0; i < 5; i++) d.attempts.push(att('BIND', 'transfer', true, day(i < 2 ? 0 : 1) + i));
  const C2 = Object.assign({}, C, {
    tests: C.tests.concat([{ id: 'TPO9', date: '2026-10-21', reading: null, listening: [20, 30], ctest: null, errors: 1 }]),
    originals: C.originals.concat([{ id: 'TPO9-L1', test: 'TPO9', sec: 'L', skill: 'BIND', skills2: [], my: 0, correct: 1, options: ['a', 'b'], diff: 'x', rule: 'x', causeAI: 'x' }]),
  });
  assert.strictEqual(E.replaySkill('BIND', d, C2, day(2)).state, 'IMPROVED');
  const st = E.replaySkill('BIND', d, C2, day(4));
  assert.strictEqual(st.state, 'RELAPSED');
  assert.deepStrictEqual(st.realRelapses, ['TPO9-L1']);
  const s = E.buildSession(d, C2, day(4));
  const firstOrig = s.steps.find(x => x.type === 'original' && x.skill === 'BIND');
  if (s.focus.includes('BIND')) assert.strictEqual(firstOrig.ref, 'TPO9-L1');
});

test('testMatrix counts primary errors per test in date order', () => {
  const m = E.testMatrix(C);
  const act = m.find(r => r.skill === 'ACT');
  assert.deepStrictEqual(act.counts, [0, 7, 2]);
});

test('metrics count my recurrence verdicts and listening stuck points', () => {
  const d = blank();
  d.attempts.push(att('BIND', 'transfer', false, day(0), { stuck: 'memory', reheard: 'clear', recur: 'same' }));
  d.attempts.push(att('ACT', 'transfer', false, day(0) + 1, { stuck: 'sound', reheard: 'still', recur: 'rulefail' }));
  const m = E.metrics(d);
  assert.strictEqual(m.stuck.memory, 1); assert.strictEqual(m.stuck.sound, 1);
  assert.strictEqual(m.reheard.still, 1); assert.strictEqual(m.recur.same, 1); assert.strictEqual(m.recur.rulefail, 1);
});

test('transfer picks alternate sections, starting where the latest real errors were', () => {
  const items = ['r1', 'r2', 'l1', 'l2'].map(id => ({ id, skill: 'ROLE', tier: 'transfer', qa: 'pass', audio: id[0] === 'l' ? 'a' : undefined }));
  const base = { tests: [{ id: 'X1', date: '2026-10-01' }, { id: 'X2', date: '2026-10-05' }], items };
  const pick = originals => E.pickItems(Object.assign({}, base, { originals }), blank(), 'ROLE', 'transfer', 4, new Set()).map(x => x.item.id);
  assert.deepStrictEqual(pick([{ test: 'X1', sec: 'R', skill: 'ROLE' }, { test: 'X2', sec: 'L', skill: 'ROLE' }]), ['l1', 'r1', 'l2', 'r2']);
  assert.deepStrictEqual(pick([{ test: 'X2', sec: 'R', skill: 'ROLE' }]), ['r1', 'l1', 'r2', 'l2']);
});
