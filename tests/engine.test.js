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

// ---------------------------------------------------------------- 소站 문제 풀 · 하루 계획 (개편 단계 2–3)
const allItems = E.poolItems(ALL);
const plan = (d, t, ctx) => E.buildPlan(d, ALL, t, ctx);
const tasks = (p, blk) => p.blocks.filter(b => !blk || b.key === blk).flatMap(b => b.tasks);
const itemIds = p => tasks(p).filter(t => t.item).map(t => t.item);
const held = new Set(ALL.pool.papers.filter(p => p.held).map(p => p.n));

test('pool: 소站 TPO独家 문항만, 메타데이터만 (공개 번들에 원문 없음)', () => {
  assert.ok(allItems.length > 300);
  for (const s of ALL.pool.sets) {
    assert.ok(/^(Z\d+|FIB)-/.test(s.id), s.id);
    for (const k of ['passage', 'script', 'choices', 'stem']) assert.ok(!(k in s), s.id + ' has ' + k);
    for (const q of s.qs) for (const k of ['stem', 'choices', 'answer', 'whyZh']) assert.ok(!(k in q), q.id + ' has ' + k);
  }
  for (const o of ALL.originals) for (const k of ['stem', 'options', 'passage', 'ctest', 'evidence']) assert.ok(!(k in o), o.id + ' has ' + k);
  assert.ok(!('items' in ALL), 'AI 연습 문제(items) 번들에서 제거');
});

test('(a) block minutes follow the weights; custom total and fixed weights', () => {
  const d = blank(); d.settings.minutes = 60; d.settings.examDate = '2026-11-14';
  const p = plan(d, T0);
  const m = Object.fromEntries(p.blocks.map(b => [b.key, b.minutes]));
  assert.deepStrictEqual(m, { vocab: 6, listen: 18, read: 9, speak: 9, write: 12, wrap: 6 });
  assert.deepStrictEqual(p.blocks.map(b => b.key), ['vocab', 'listen', 'read', 'speak', 'write', 'wrap']);
  d.settings.minutes = 95; d.settings.weights = { listen: 40 };
  const w = E.weights(d);
  assert.strictEqual(w.listen, 40);
  assert.ok(Math.abs(Object.values(w).reduce((s, x) => s + x, 0) - 100) < 1e-9);
  assert.strictEqual(plan(d, T0).blocks.find(b => b.key === 'listen').minutes, 38);
  // Each block's tasks fit its time (within one task).
  d.settings.weights = {};
  for (const b of plan(d, T0, { speak: { lr: 'x', interview: 'y' }, write: { task: 'w', kind: 'discussion' } }).blocks) {
    const used = b.tasks.reduce((s, t) => s + t.min, 0);
    assert.ok(used <= b.minutes + 6, b.key + ' ' + used + ' > ' + b.minutes);
  }
});

test('(b) "안 들렸다" → 받아쓰기 대기열 (다음 날 ② 리스닝); 처리하면 빠진다', () => {
  const d = blank(); d.settings.examDate = '2026-11-14';
  const L = allItems.find(i => i.sec === 'L' && i.kind === 'lecture' && !i.held);
  d.attempts.push(att(L.skill, 'transfer', false, day(0), { item: L.id, q: 1, cause: 'sound' }));
  d.attempts.push(att('ACT', 'original', false, day(0) + 1, { ref: 'T3-L1', stuck: 'sound' }));   // 옛 기록 형식(stuck)도 같은 원인
  const q = E.causeQueues(d, day(1));
  assert.strictEqual(q.dictation.length, 2);
  const p = plan(d, day(1));
  const dict = tasks(p, 'listen').filter(t => t.type === 'dictation');
  assert.strictEqual(dict.length, 2);
  assert.strictEqual(dict[0].of, L.id);
  d.followups = { [dict[0].key]: day(1) + 5, [dict[1].key]: day(1) + 6 };
  assert.strictEqual(E.causeQueues(d, day(2)).dictation.length, 0);
  // other causes route elsewhere
  d.attempts.push(att('TARGET', 'transfer', false, day(2), { item: 'x', cause: 'memory' }), att('AUDIT', 'transfer', false, day(2) + 1, { item: 'y', cause: 'judge' }), att('TARGET', 'transfer', false, day(2) + 2, { item: 'z', cause: 'time' }));
  const q2 = E.causeQueues(d, day(3));
  assert.deepStrictEqual([q2.twoPass.length, q2.judge.length, q2.timed.length], [1, 1, 1]);
});

test('(c) AI 문항이 계획에 없음: every planned item is a 소站 pool item', () => {
  const idx = E.poolIndex(ALL);
  const d = blank(); d.settings.examDate = '2026-11-14'; d.settings.minutes = 120;
  for (let n = 0; n < 5; n++) {
    const p = plan(d, day(n));
    for (const id of itemIds(p)) { assert.ok(idx[id], 'not in pool: ' + id); assert.ok(!/^(AC|F|W|B|C|A|T)-T/.test(id)); }
    for (const id of itemIds(p)) d.attempts.push(att(idx[id].skill, 'transfer', true, day(n) + 1, { item: id }));
  }
});

test('(d) 보류 회차(모의 모듈용)는 일상 계획에 없음', () => {
  assert.strictEqual(held.size, 2);
  const idx = E.poolIndex(ALL);
  const d = blank(); d.settings.examDate = '2026-11-14'; d.settings.minutes = 180;
  for (let n = 0; n < 12; n++) {
    const p = plan(d, day(n));
    for (const id of itemIds(p)) { assert.ok(!held.has(idx[id].paper), 'held paper served: ' + id); d.attempts.push(att(idx[id].skill, 'transfer', true, day(n) + 1, { item: id })); }
  }
  assert.ok(E.freshPool(ALL, d).every(i => !held.has(i.paper)));
});

// 사용자 학습 기록이라 비공개 저장소에만 둔다 (private/zhan/fixtures). 없으면 건너뜀.
const LEGACY = path.join(__dirname, '../private/zhan/fixtures/legacy-record.json');
test('(e) 옛 기록(사용자 내보내기 2026-11-01 형식)으로 계획 생성 — 오류 없음, 기록은 그대로', { skip: !fs.existsSync(LEGACY) && '비공개 fixture 없음' }, () => {
  const rec = JSON.parse(fs.readFileSync(LEGACY, 'utf8'));
  const before = JSON.stringify(rec.attempts);
  const d = E.migrateRecord(rec);
  assert.ok(d.legacySession && d.session === null, 'old v1 session kept aside, not rendered');
  const now = new Date(2026, 10, 1, 9).getTime();
  const p = plan(d, now, { vocab: { hard: 12, due: 30 } });
  assert.strictEqual(p.v, 2);
  assert.ok(tasks(p).length > 5);
  assert.ok(E.skillTable(d, ALL, now).length === 8);
  assert.ok(E.metrics(d).activity.attempts === rec.attempts.length);
  assert.ok(E.legacyAttempts(d, ALL) > 100, 'old AI-item attempts are still in the log');
  assert.strictEqual(JSON.stringify(d.attempts), before, 'attempt log untouched');
  // verify pool skips removed AI items without throwing
  assert.ok(Array.isArray(E.verifyPool(ALL, d, now, 3)));
});

test('new questions: never in app, 소站-wrong sets last; answered items are not served again', () => {
  const d = blank();
  const f = E.freshPool(ALL, d);
  const firstWrong = f.findIndex(i => i.z === -1);
  assert.ok(firstWrong === -1 || f.slice(firstWrong).every(i => i.z === -1));
  d.attempts.push(att(f[0].skill, 'transfer', true, day(0), { item: f[0].id }));
  assert.ok(!E.freshPool(ALL, d).some(i => i.id === f[0].id));
  const seen = new Map([[f[1].id, day(0)]]);   // solved in the 리딩·리스닝 tabs
  assert.ok(!E.freshPool(ALL, d, { seen: E.seenItems(d, seen) }).some(i => i.id === f[1].id));
});

test('twins: a right answer is re-checked with a new 소站 question of the same skill and type', () => {
  const d = blank(); d.settings.examDate = '2026-11-14';
  const it = E.freshPool(ALL, d, { kinds: ['daily'] })[0];
  d.attempts.push(att(it.skill, 'transfer', true, day(0), { item: it.id, conf: 1 }));
  assert.strictEqual(E.verifyPool(ALL, d, day(2), 3).length, 0, 'too soon');
  const v = E.verifyPool(ALL, d, day(3), 3)[0];
  assert.strictEqual(v.id, it.id);
  const t = E.twinFor(v, ALL, d, day(3));
  assert.ok(t.twin && t.item.id !== it.id && t.item.kind === 'daily' && t.item.skills.includes(it.skill));
  const p = plan(d, day(3));
  const tw = tasks(p, 'wrap').find(x => x.tier === 'verify-twin');
  assert.ok(tw && tw.verifyOf === 'i:' + it.id);
  d.attempts.push(att(it.skill, 'verify-twin', true, day(3) + 1, { item: tw.item, conf: 2, verify: true, verifyOf: tw.verifyOf }));
  assert.ok(!E.verifyPool(ALL, d, day(6), 3).some(x => x.id === it.id), 'confirmed by its twin');
});

test('originals: quick diagnosis cards cover every original before the exam; diag is not a re-solve', () => {
  const d = blank(); d.settings.minutes = 60; d.settings.examDate = '2026-11-14';
  const T = new Date(2026, 10, 1, 9).getTime();
  const seen = new Set();
  for (let n = 0; n < 12; n++) {
    const p = plan(d, T + n * E.DAY);
    for (const t of tasks(p, 'wrap').filter(x => x.type === 'diag')) { seen.add(t.ref); d.attempts.push(att(t.skill, 'original', null, T + n * E.DAY + 1, { ref: t.ref, diag: true })); }
  }
  const all = ALL.originals.filter(o => o.skill !== 'UNKNOWN').map(o => o.id);
  assert.deepStrictEqual(all.filter(id => !seen.has(id)), []);
  assert.strictEqual(E.originalQueue(ALL, d, T + 13 * E.DAY).again.length, 0, 'diagnosed ≠ wrong');
  assert.strictEqual(E.metrics(d).originalRedo.n, 0, 'diag cards are not counted as re-solves');
});

test('unfinished blocks carry over to the next day (first in the same block)', () => {
  const d = blank(); d.settings.examDate = '2026-11-14';
  const p1 = plan(d, day(0));
  const lb = p1.blocks.find(b => b.key === 'listen'); lb.cursor = 1;
  d.plan = p1;
  const p2 = plan(d, day(1));
  const l2 = p2.blocks.find(b => b.key === 'listen');
  assert.ok(l2.carried >= 1);
  assert.strictEqual(l2.tasks[0].item, lb.tasks[1].item);
  assert.strictEqual(l2.tasks[0].carriedFrom, p1.date);
});

test('weekly auto weights: an area whose indicator did not improve gets +5%p, once a week, not if fixed', () => {
  const d = blank();
  const ind = { listen: { now: 0.6, prev: 0.6 }, read: { now: 0.8, prev: 0.6 }, vocab: { now: 30, prev: 20, higherIsBetter: false } };
  const a = E.weeklyAdjust(d, T0, ind);
  assert.deepStrictEqual(a.adj, { listen: 5, vocab: 5 });
  d.weightAuto = a;
  assert.strictEqual(E.weeklyAdjust(d, T0 - E.DAY, ind), a, 'same week (Sat) → unchanged');
  const w = E.weights(d);
  assert.ok(w.listen > 30 && Math.abs(Object.values(w).reduce((s, x) => s + x, 0) - 100) < 1e-9);
  d.settings.weights = { listen: 30 };
  assert.ok(!('listen' in E.weeklyAdjust(Object.assign({}, d, { weightAuto: null }), T0, ind).adj));
});

test('L&R 빠뜨림(omit) → 다음 날 ② 쉐도잉; 말하기 문법(grammar) → 고쳐 쓰기 대기열', () => {
  const d = blank(); d.settings.examDate = '2026-11-14';
  d.attempts.push(att(null, 'speak', false, day(0), { item: 'Z4-S-A1-Q2', cause: 'omit', missed: ['the'] }));
  d.attempts.push(att(null, 'speak', false, day(0) + 1, { item: 'Z4-S-A2-Q1', cause: 'grammar', cats: ['TENSE'] }));
  const q = E.causeQueues(d, day(1));
  assert.strictEqual(q.shadow.length, 1); assert.deepStrictEqual(q.shadow[0].missed, ['the']);
  assert.strictEqual(q.fix.length, 1);
  const sh = tasks(plan(d, day(1)), 'listen').filter(t => t.type === 'shadow');
  assert.strictEqual(sh.length, 1); assert.strictEqual(sh[0].of, 'Z4-S-A1-Q2');
  assert.strictEqual(E.replaySkill('ACT', d, ALL, day(1)).mastery, 0, 'speak attempts never count toward reading/listening mastery');
});

test('변화 지표: 최근 7일 vs 그 전 7일, 영역별 (기록 적으면 null)', () => {
  const d = blank();
  const L = allItems.find(i => i.sec === 'L' && i.kind === 'lecture');
  for (let i = 0; i < 4; i++) d.attempts.push(att(L.skill, 'transfer', i < 3, day(10) + i, { item: L.id, q: i }));
  for (let i = 0; i < 3; i++) d.attempts.push(att(L.skill, 'transfer', false, day(2) + i, { item: L.id, q: i }));
  d.dictation = [{ at: day(10), pct: 80 }, { at: day(9), pct: 60 }];
  d.readSpeed = [{ at: day(10), wpm: 180 }, { at: day(10), wpm: 5000 }];
  d.speak = [{ at: day(10), kind: 'lr', stt: true, pct: 90 }, { at: day(10), kind: 'interview', stt: true, rounds: [{ wpm: 100, pauses: 4 }, { wpm: 120, pauses: 2 }] }];
  d.writing = [{ at: day(10), kind: 'discussion', planMs: 95000, structure: [['a', true], ['b', false]], cats: ['TENSE'] }];
  d.mock = [{ at: day(10), sec: 'L', correct: 30, total: 40, paper: 2 }];
  const m = E.areaMetrics(d, ALL, day(10), { vocabNow: 40, vocabPrev: 50, knownRatio: 0.7 });
  assert.deepStrictEqual(m.L.newQ, { now: 75, prev: 0 });
  assert.deepStrictEqual(m.L.dictation, { now: 70, prev: null });
  assert.strictEqual(m.R.wpm.now, 180, 'implausible wpm (clicked through) ignored');
  assert.strictEqual(m.S.lr.now, 90); assert.strictEqual(m.S.wpm.now, 110); assert.strictEqual(m.S.pauses.now, 3);
  assert.strictEqual(m.W.planSec.now, 95); assert.strictEqual(m.W.structure.now, 50); assert.strictEqual(m.W.errors.now, 1);
  assert.strictEqual(m.L.mock.pct, 75);
  const ind = E.weeklyIndicatorsFrom(m);
  assert.deepStrictEqual(ind.vocab, { higherIsBetter: false, now: 40, prev: 50 });
  assert.deepStrictEqual(E.weeklyAdjust(blank(), day(10), ind).raised, []);   // listen improved, vocab improved; others lack data
});

test('carry-over skips work already done elsewhere (원본 진단, 후속 훈련)', () => {
  const d = blank(); d.settings.examDate = '2026-11-14';
  const p1 = plan(d, day(0));
  const w = p1.blocks.find(b => b.key === 'wrap');
  const diag = w.tasks.find(t => t.type === 'diag');
  d.attempts.push(att(diag.skill, 'original', null, day(0) + 10, { ref: diag.ref, diag: true }));
  d.plan = p1;
  const p2 = plan(d, day(1));
  assert.ok(!tasks(p2, 'wrap').some(t => t.type === 'diag' && t.ref === diag.ref && t.carriedFrom));
});
