// Run: node --test tests/
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const K = require('../app/swcore.js');

const SW = JSON.parse(fs.readFileSync(path.join(__dirname, '../content/sw.json'), 'utf8'));
const T0 = new Date(2026, 9, 22, 9).getTime();

test('tokens: digits, times, contractions and punctuation normalize like the TTS script', () => {
  assert.deepStrictEqual(K.tokens('Quiet hours begin at 10 each night.'), 'quiet hours begin at ten each night'.split(' '));
  assert.deepStrictEqual(K.tokens('Hot meals are served until 2:30'), 'hot meals are served until two thirty'.split(' '));
  assert.deepStrictEqual(K.tokens("I don't know — it's the 3rd floor"), 'i do not know it is the third floor'.split(' '));
  assert.strictEqual(K.norm('Almost 100,000 people'), K.norm('almost 100000 people'));
});

test('matchAnswer ignores case, punctuation and hyphens but not words', () => {
  const ans = ['Online classes are more helpful than in-person classes.'];
  assert.ok(K.matchAnswer('online classes are more helpful than in person classes', ans));
  assert.ok(!K.matchAnswer('Online classes are helpful than in-person classes.', ans));
  assert.ok(!K.matchAnswer('', ans));
});

test('every tutor wrong sentence fails its own answers, and every answer passes', () => {
  for (const g of SW.grammar) {
    assert.ok(!K.matchAnswer(g.wrong, g.answers), g.id);
    for (const a of g.answers) assert.ok(K.matchAnswer(a, g.answers), g.id);
  }
});

test('review: Leitner boxes — right moves up, wrong drops to box 1 due tomorrow', () => {
  let c = K.review(undefined, true, T0);
  assert.strictEqual(c.box, 1); assert.strictEqual(c.due, T0 + K.DAY);
  c = K.review(c, true, T0); assert.strictEqual(c.box, 2); assert.strictEqual(c.due, T0 + 3 * K.DAY);
  c = K.review(c, false, T0); assert.strictEqual(c.box, 1); assert.strictEqual(c.bad, 1); assert.strictEqual(c.due, T0 + K.DAY);
});

test('drillQueue: due reviews first, then at most 6 new, 10 total; mastered and not-due are skipped', () => {
  const items = Array.from({ length: 20 }, (_, i) => ({ id: 'X' + i }));
  const cards = {
    X0: { box: 1, due: T0 - 2 * K.DAY }, X1: { box: 2, due: T0 - K.DAY }, X2: { box: 3, due: T0 + K.DAY }, X3: { box: K.MASTER, due: T0 - K.DAY },
  };
  const q = K.drillQueue(items, cards, T0).map(i => i.id);
  assert.deepStrictEqual(q.slice(0, 2), ['X0', 'X1']);
  assert.ok(!q.includes('X2') && !q.includes('X3'));
  assert.strictEqual(q.length, 8); // 2 due + 6 new
});

test('drillQueue: new items come newest tutor correction first; a second call continues with the next new items', () => {
  const items = [{ id: 'A', src: 'AI 변형' }, { id: 'B', src: '튜터 9/15' }, { id: 'C', src: '튜터 10/28' }, { id: 'D', src: '튜터 10/2' }];
  assert.deepStrictEqual(K.drillQueue(items, {}, T0, 10, 2).map(i => i.id), ['C', 'D']);
  const cards = { C: { box: 1, due: T0 + K.DAY }, D: { box: 1, due: T0 + K.DAY } };
  assert.deepStrictEqual(K.drillQueue(items, cards, T0, 10, 2).map(i => i.id), ['B', 'A']);
});

test('drillQueue: a backlog of due reviews still leaves 4 slots for new items; without new items, all 10 are reviews', () => {
  const items = Array.from({ length: 30 }, (_, i) => ({ id: 'X' + i }));
  const cards = Object.fromEntries(items.slice(0, 15).map((x, i) => [x.id, { box: 1, due: T0 - i }]));
  const q = K.drillQueue(items, cards, T0);
  assert.strictEqual(q.length, 10);
  assert.strictEqual(q.filter(i => !cards[i.id]).length, 4);
  const allDue = Object.fromEntries(items.map(x => [x.id, { box: 1, due: T0 - 1 }]));
  assert.strictEqual(K.drillQueue(items, allDue, T0).length, 10);
});

test('lrScore matches the tutor scale on real feedback cases', () => {
  const t = 'Cooking is allowed only in the common kitchen area.';
  assert.strictEqual(K.lrScore(t, t).score, 5);
  const one = K.lrScore(t, 'Cooking is allowed only in the kitchen area');           // dropped modifier
  assert.strictEqual(one.score, 4); assert.deepStrictEqual(one.cats, { drop: 1 });
  const prep = K.lrScore('Please silence your phones before the lecture.', 'Please silence your phones at the lecture');
  assert.strictEqual(prep.score, 4); assert.deepStrictEqual(prep.cats, { small: 1 });
  const plural = K.lrScore('Please place your empty trays on the cart by the exit.', 'please place your empty tray on the cart by the exit');
  assert.deepStrictEqual(plural.cats, { plural: 1 });
  const cut = K.lrScore('Students who miss a quiz must contact the teaching assistant within one week.', 'Students who miss a quiz must contact the teaching');
  assert.ok(cut.score <= 2 && cut.cats.end, JSON.stringify(cut));
  assert.strictEqual(K.lrScore(t, '').score, 0);
  const run = K.lrScore(t, 'Cooking is allowed only in kitchen area');               // "the common" missing = one change (tutor: 04)
  assert.strictEqual(run.score, 4); assert.strictEqual(run.errors, 1);
  assert.strictEqual(K.lrScore('Quiet hours begin at ten each night.', 'Quiet hours begin at ten at each night').score, 4); // tutor 9/15: 04
  assert.deepStrictEqual(cut.cats.end, 1);
});

test('scan finds the tutor-corrected mistakes and stays quiet on the corrected versions', () => {
  const hits = s => K.scan(s, SW.scan).filter(f => f.level !== 'tip').map(f => f.cat);
  assert.deepStrictEqual(hits('In the past, when I feel boring, I read books.').sort(), ['EDING', 'TENSE']);
  assert.deepStrictEqual(hits('It was very useful than traditional classes.'), ['COMP']);
  assert.deepStrictEqual(hits('I am writing to inform about our next meeting.'), ['OBJ']);
  assert.deepStrictEqual(hits('Genetic engineering is directly related with saving people.'), ['PREP']);
  assert.deepStrictEqual(hits('Every student have different backgrounds.'), ['SVA']);
  assert.deepStrictEqual(hits('While both made valid points, but I believe it.'), ['LINK']);
  for (const clean of ['When I feel bored, I usually read books.', 'It was much more useful than traditional classes.', 'I am writing to inform you about our next meeting.',
    'Every student has a different background.', 'The lecture was boring.', 'I was inspired.', 'I usually study at a cafe.'])
    assert.deepStrictEqual(hits(clean), [], clean);
});

test('scan: tutor corrected versions of my essays have fewer flags than my originals', () => {
  for (const p of SW.discussion.concat(SW.email).filter(p => p.tutor && p.mine)) {
    const n = s => K.scan(s, SW.scan, 'ad').filter(f => f.level !== 'tip').length;
    assert.ok(n(p.tutor) < n(p.mine) || n(p.mine) === 0, `${p.id}: mine ${n(p.mine)} tutor ${n(p.tutor)}`);
  }
});

test('build a sentence: answers are a permutation of tiles; shuffle is deterministic and not the answer order', () => {
  for (const b of SW.buildSentence) {
    const tiles = b.answer.concat(b.extra || []);
    const s1 = K.shuffle(tiles, b.id), s2 = K.shuffle(tiles, b.id);
    assert.deepStrictEqual(s1, s2);
    assert.deepStrictEqual(s1.slice().sort(), tiles.slice().sort());
    assert.notDeepStrictEqual(s1, tiles, b.id);
    assert.ok(K.bsCorrect(b.answer, b.answer.slice()));
  }
});

test('wordCount and paragraphs', () => {
  assert.strictEqual(K.wordCount("Dear Sam,\n\nI hope this email finds you well. It's 7 pm."), 12);
  assert.strictEqual(K.paragraphs('a\n\nb\n\n\nc'), 3);
});
