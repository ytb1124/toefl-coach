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
const d = { settings: { examDate: exam, minutes: 60 }, attempts: [], flags: {} };
const ITEM = E.poolIndex(C);

console.log(`exam ${exam}\n일\t블록 분(단어/L/R/S/W/마무리)\t새 문제 정답\t진단 카드\t상태 변화`);
for (let k = 0; k < days; k++) {
  const now = start + k * E.DAY;
  const before = Object.fromEntries(E.skillTable(d, C, now).map(r => [r.skill.id, r.st.state]));
  const s = E.buildPlan(d, C, now);
  let t = 0, c = 0, nq = 0, diag = 0;
  for (const b of s.blocks) for (const st of b.tasks) {
    const at = now + (++t) * 60000;
    if (st.type === 'diag') { diag++; d.attempts.push({ at, sid: s.id, ref: st.ref, skill: st.skill, tier: 'original', diag: true, correct: null }); }
    if (st.type !== 'item' || !ITEM[st.item]) continue;
    const it = ITEM[st.item];
    it.qs.forEach((q, qi) => {
      const skill = q.skill || it.skill;
      const ok = rnd() < (p[skill] || 0.6);
      c += ok; nq++;
      d.attempts.push({ at: at + qi, sid: s.id, item: it.id, q: qi, skill, tier: st.tier, correct: ok, conf: ok ? 2 : (rnd() < 0.2 ? 3 : 1) });
    });
  }
  for (const r of E.skillTable(d, C, now)) if (r.st.recent.length) p[r.skill.id] = Math.min(0.93, p[r.skill.id] + 0.02);
  for (const b of s.blocks) { b.cursor = b.tasks.length; b.done = true; }
  d.plan = s;
  const after = E.skillTable(d, C, now + 3600000);
  const changes = after.filter(r => before[r.skill.id] !== r.st.state).map(r => `${r.skill.id}:${E.STATE_LABEL[r.st.state]}`);
  console.log([`${k + 1} (D-${s.daysLeft})`, s.blocks.map(b => b.minutes).join('/'), `${c}/${nq}`, diag, changes.join(' ') || '-'].join('\t'));
}
