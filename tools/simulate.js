// Simulate N days of the daily loop with a toy learner model to see how the curriculum adapts.
// Usage: node tools/simulate.js [days=14] [seed=1]
const E = require('../app/engine.js');
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '../app/content.js'), 'utf8');
const C = JSON.parse(src.slice(src.indexOf('{'), src.lastIndexOf('}') + 1));

const days = +(process.argv[2] || 14);
let seed = +(process.argv[3] || 1);
const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);

// Toy model (assumption, not data): starting accuracy on new items, +6%p per day the skill is trained.
const p = { FORM: 0.7, WORD: 0.6, TARGET: 0.6, AUDIT: 0.6, ROLE: 0.6, BIND: 0.55, ACT: 0.75, CATCH: 0.6 };
const start = new Date(2026, 9, 18, 9).getTime();
const exam = E.dayStr(start + days * E.DAY);
const d = { settings: { examDate: exam, minutes: 40 }, attempts: [], flags: {} };
const ITEM = Object.fromEntries(C.items.map(i => [i.id, i]));

console.log(`exam ${exam}\n일\t유지 확인\t집중\t섞어\t새 문제 정답\t상태 변화`);
for (let k = 0; k < days; k++) {
  const now = start + k * E.DAY;
  const before = Object.fromEntries(E.skillTable(d, C, now).map(r => [r.skill.id, r.st.state]));
  const s = E.buildSession(d, C, now);
  let t = 0, c = 0;
  for (const st of s.steps) {
    const at = now + (++t) * 60000;
    if (st.type === 'original') d.attempts.push({ at, sid: s.id, ref: st.ref, skill: st.skill, tier: 'original', correct: rnd() < 0.8 });
    if (st.type !== 'item') continue;
    const it = ITEM[st.item];
    (it.qs || [{}]).forEach((q, qi) => {
      const skill = q.skill || it.skill;
      const ok = rnd() < p[skill];
      if (st.tier !== 'guided') { c += ok; }
      d.attempts.push({ at: at + qi, sid: s.id, item: it.id, q: qi, skill, tier: st.tier, correct: ok, conf: ok ? 2 : (rnd() < 0.2 ? 3 : 1) });
    });
  }
  for (const f of s.focus) p[f] = Math.min(0.93, p[f] + 0.06);
  const after = E.skillTable(d, C, now + 3600000);
  const changes = after.filter(r => before[r.skill.id] !== r.st.state).map(r => `${r.skill.id}:${E.STATE_LABEL[r.st.state]}`);
  const scored = s.steps.filter(x => x.type === 'item' && x.tier !== 'guided');
  const nq = scored.reduce((n, x) => n + (ITEM[x.item].qs ? ITEM[x.item].qs.length : 1), 0);
  console.log([`${k + 1} (D-${s.daysLeft})`, s.retention.join(',') || '-', s.focus.join('+') || '-',
    s.steps.filter(x => x.tier === 'mixed').length, `${c}/${nq}`, changes.join(' ') || '-'].join('\t'));
}
