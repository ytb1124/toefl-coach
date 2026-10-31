/* Learning engine — pure functions, no DOM. Works in the browser (window.Engine) and in Node (require). */
(function (root) {
  'use strict';

  const DAY = 86400000;
  // Mastery-relevant tiers: only new questions answered without hints.
  const MASTERY_TIERS = ['transfer', 'mixed', 'delayed'];
  const STATE_LABEL = {
    NEW: '새로움', UNDERSTOOD: '이해함', PRACTICING: '훈련 중', VERIFYING: '검증 중',
    IMPROVED: '개선됨', RETAINED: '유지됨', RELAPSED: '재발',
  };
  const STATE_FACTOR = { NEW: 1.0, UNDERSTOOD: 1.0, PRACTICING: 1.0, VERIFYING: 0.9, IMPROVED: 0.3, RETAINED: 0.15, RELAPSED: 1.5 };
  // Expected minutes per step, used to fit the session into the daily budget.
  const MINUTES = { ctest: 0.6, mc: 1.6, insert: 2, reply: 0.6, listen: 4, original: 2, move: 0.7 };

  // ---------- dates ----------
  function dayStr(t) {
    const d = new Date(t);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function dayStart(str) { const [y, m, d] = str.split('-').map(Number); return new Date(y, m - 1, d).getTime(); }
  function daysLeft(examDate, now) {
    if (!examDate) return null;
    return Math.round((dayStart(examDate) - dayStart(dayStr(now))) / DAY);
  }
  function firstInterval(left) {
    if (left == null) return 2;
    return Math.max(1, Math.min(3, Math.round(left / 4)));
  }

  // ---------- evidence from the original errors ----------
  function analyzable(o) { return o.skill !== 'UNKNOWN'; }

  // Most recent test 1.0, then 0.85, 0.7, … (floor 0.5): recent errors say more about today's ability.
  function recencyMap(tests) {
    const m = {};
    (tests || []).slice().sort((a, b) => b.date.localeCompare(a.date)).forEach((t, i) => { m[t.id] = Math.max(0.5, 1 - 0.15 * i); });
    return m;
  }
  function testDates(tests) { const m = {}; for (const t of tests || []) m[t.id] = t.date; return m; }

  function evidence(skillId, originals, tests) {
    const RECENCY = recencyMap(tests);
    let w = 0; const seen = new Set(); let primary = 0; let secondary = 0;
    for (const o of originals) {
      if (!analyzable(o)) continue;
      let k = 0;
      if (o.skill === skillId) { k = 1; primary++; } else if ((o.skills2 || []).includes(skillId)) { k = 0.5; secondary++; }
      // An error whose own answer was never recorded tells us less about the cause → half weight.
      if (k && o.my == null) k *= 0.5;
      if (k) { w += k * (RECENCY[o.test] || 1); seen.add(o.test); }
    }
    if (seen.size > 1) w += 0.5 * (seen.size - 1);
    return { weight: +w.toFixed(2), primary, secondary, tests: [...seen].sort() };
  }

  // ---------- state machine (replayed from the attempt log, so derived values never go stale) ----------
  function replaySkill(skillId, data, content, now) {
    const examDate = data.settings && data.settings.examDate;
    const origs = content.originals.filter(o => o.skill === skillId && analyzable(o));
    const needReviewed = Math.min(3, origs.length);
    const reviewed = new Set();
    // A real mock-test error is an event too: if it happens after the skill was judged improved, that is a relapse.
    const dates = testDates(content.tests);
    const realTest = origs.filter(o => dates[o.test]).map(o => ({ tier: 'realtest', ref: o.id, test: o.test, at: dayStart(dates[o.test]) + DAY / 2 })).filter(e => !now || e.at <= now);
    const events = data.attempts.filter(a => a.skill === skillId).concat(realTest).sort((a, b) => a.at - b.at);
    const realRelapses = [];
    let state = 'NEW'; let interval = 0; let dueAt = null; let since = null;
    const mastery = []; const guided = []; let relapseStreak = 0;
    const set = (s, at) => { if (s !== state) { state = s; since = at; } };

    for (const a of events) {
      if (a.tier === 'realtest') {
        if (state === 'IMPROVED' || state === 'RETAINED') { set('RELAPSED', a.at); relapseStreak = 0; dueAt = null; realRelapses.push(a.ref); }
        continue;
      }
      if (a.tier === 'original') {
        reviewed.add(a.ref);
        if (state === 'NEW' && reviewed.size >= needReviewed) set('UNDERSTOOD', a.at);
        continue;
      }
      if (a.tier === 'guided') {
        guided.push(a);
        if (['NEW', 'UNDERSTOOD'].includes(state)) set('PRACTICING', a.at);
        const g3 = guided.slice(-3);
        if (state === 'PRACTICING' && g3.length >= 2 && g3.filter(x => x.correct).length >= 2) set('VERIFYING', a.at);
        continue;
      }
      if (!MASTERY_TIERS.includes(a.tier) || a.hinted) continue;
      mastery.push(a);
      const left = daysLeft(examDate, a.at);
      const schedule = (iv) => {
        interval = iv;
        let due = dayStart(dayStr(a.at)) + iv * DAY;
        if (examDate) due = Math.min(due, Math.max(dayStart(examDate) - DAY, dayStart(dayStr(a.at)) + DAY));
        dueAt = due;
      };

      if (state === 'IMPROVED' || state === 'RETAINED') {
        if (a.tier === 'delayed') {
          if (a.correct) { set('RETAINED', a.at); schedule(Math.max(1, interval * 2)); }
          else { set('RELAPSED', a.at); relapseStreak = 0; dueAt = null; }
        } else {
          const last3 = mastery.slice(-3);
          if (!a.correct && last3.filter(x => !x.correct).length >= 2) { set('RELAPSED', a.at); relapseStreak = 0; dueAt = null; }
        }
        continue;
      }
      if (state === 'RELAPSED') {
        relapseStreak = a.correct ? relapseStreak + 1 : 0;
        if (relapseStreak >= 2) set('VERIFYING', a.at);
        continue;
      }
      // NEW / UNDERSTOOD / PRACTICING / VERIFYING: transfer evidence decides.
      if (state === 'NEW' || state === 'UNDERSTOOD') set('VERIFYING', a.at);
      const last5 = mastery.slice(-5);
      const correct = last5.filter(x => x.correct).length;
      const sessions = new Set(last5.map(x => x.sid)).size;
      const confidentMiss = last5.some(x => !x.correct && x.conf >= 3);
      if (last5.length >= 4 && correct >= 4 && sessions >= 2 && !confidentMiss) {
        set('IMPROVED', a.at); schedule(firstInterval(left));
      } else if (last5.length === 5 && correct <= 2 && state === 'VERIFYING') {
        set('PRACTICING', a.at);
      }
    }
    const recent = mastery.slice(-8);
    const p = (recent.filter(x => x.correct).length + 1) / (recent.length + 2);
    return {
      state, since, dueAt, interval,
      reviewed: reviewed.size, originals: origs.length,
      mastery: mastery.length, recent, p,
      guidedCount: guided.length, realRelapses,
    };
  }

  function priority(skill, ev, st) {
    return +(ev.weight * (1 - st.p) * (skill.gain || 1) * STATE_FACTOR[st.state]).toFixed(3);
  }

  function skillTable(data, content, now) {
    return content.skills.map(skill => {
      const ev = evidence(skill.id, content.originals, content.tests);
      const st = replaySkill(skill.id, data, content, now);
      return { skill, ev, st, pr: priority(skill, ev, st), due: st.dueAt != null && st.dueAt <= dayStart(dayStr(now)) };
    });
  }

  // ---------- item pools ----------
  function seenItems(data, tiers) {
    const m = new Map();
    for (const a of data.attempts) if (a.item && (!tiers || tiers.includes(a.tier))) m.set(a.item, Math.max(m.get(a.item) || 0, a.at));
    return m;
  }

  // Section ('R' | 'L') where this skill's errors in the most recent mock test that had any were concentrated.
  function latestSection(content, skillId) {
    const dates = testDates(content.tests || []);
    const origs = (content.originals || []).filter(o => o.skill === skillId && dates[o.test]);
    if (!origs.length) return 'R';
    const last = origs.reduce((m, o) => (dates[o.test] > m ? dates[o.test] : m), '');
    const recent = origs.filter(o => dates[o.test] === last);
    return recent.filter(o => o.sec === 'L').length > recent.length / 2 ? 'L' : 'R';
  }

  // Alternate reading / listening items, starting with `first`, so a skill tested in both sections
  // isn't drilled only in whichever section happens to come first in the item files.
  function interleaveBySection(items, first) {
    const L = items.filter(i => i.audio); const R = items.filter(i => !i.audio);
    const [a, b] = first === 'L' ? [L, R] : [R, L];
    const out = [];
    for (let k = 0; k < Math.max(a.length, b.length); k++) { if (a[k]) out.push(a[k]); if (b[k]) out.push(b[k]); }
    return out;
  }

  function pickItems(content, data, skillId, tier, n, exclude) {
    const flagged = data.flags || {};
    const pool = content.items.filter(i => i.skill === skillId && i.tier === tier && i.qa === 'pass' && !flagged[i.id] && !exclude.has(i.id));
    const seen = seenItems(data, tier === 'guided' ? ['guided'] : MASTERY_TIERS.concat(['repeat']));
    const fresh = interleaveBySection(pool.filter(i => !seen.has(i.id)), latestSection(content, skillId));
    const out = fresh.slice(0, n).map(i => ({ item: i, repeat: false }));
    if (out.length < n && tier === 'guided') {
      // Guided items may be reused (they only scaffold, never count for mastery).
      const old = pool.filter(i => seen.has(i.id)).sort((a, b) => seen.get(a.id) - seen.get(b.id));
      for (const i of old) { if (out.length >= n) break; out.push({ item: i, repeat: true }); }
    }
    return out;
  }

  function oldestSeenTransfer(content, data, skillId, exclude) {
    const seen = seenItems(data, MASTERY_TIERS.concat(['repeat']));
    const pool = content.items.filter(i => i.skill === skillId && i.tier === 'transfer' && seen.has(i.id) && !exclude.has(i.id))
      .sort((a, b) => seen.get(a.id) - seen.get(b.id));
    return pool[0] || null;
  }

  function itemMinutes(item) { return (MINUTES[item.kind] || 1.5) * (item.kind === 'listen' ? 1 : (item.qs ? item.qs.length : 1)); }

  // ---------- every original error, spread over the days left ----------
  // fresh = never re-solved (here or in the 리딩·리스닝 tabs), newest test first · again = latest re-solve was wrong (not today).
  function originalQueue(content, data, now) {
    const dates = testDates(content.tests);
    const last = {};
    for (const a of data.attempts) if (a.tier === 'original' && a.ref && (!last[a.ref] || a.at > last[a.ref].at)) last[a.ref] = a;
    const origs = content.originals.filter(analyzable);
    const fresh = origs.filter(o => !last[o.id])
      .sort((a, b) => (dates[b.test] || '').localeCompare(dates[a.test] || '') || (b.my != null) - (a.my != null));
    const again = origs.filter(o => last[o.id] && !last[o.id].correct && last[o.id].at < dayStart(dayStr(now)))
      .sort((a, b) => last[a.id].at - last[b.id].at);
    return { fresh, again, total: origs.length };
  }
  // How many originals today: enough to finish every unseen one by the day before the exam, capped at ~45% of the daily time.
  function originalQuota(nFresh, nAgain, left, minutes) {
    const cap = Math.max(4, Math.round(minutes * 0.45 / MINUTES.original));
    const days = left == null ? 7 : Math.max(1, left - 1);
    // Unseen ones first (they must all be covered); still-wrong ones get at least 2 and whatever room is left.
    const needFresh = Math.min(nFresh, Math.ceil(nFresh / days));
    const again = Math.min(nAgain, Math.max(2, cap - needFresh));
    return { again, fresh: Math.max(0, Math.min(cap - again, needFresh)) };
  }

  // ---------- "did I know it, or was it luck?": re-ask questions answered right a few days ago ----------
  const VERIFY_RATIO = 0.25; // one re-check per four other questions
  // Latest run of each item / original that ended correct, ≥ gap days ago, and not yet confirmed (correct + 보통/확신 on a re-check).
  function verifyPool(content, data, now, gap) {
    const cutoff = dayStart(dayStr(now)) - (gap - 1) * DAY;
    const runs = {};   // key → attempts of the latest day
    for (const a of data.attempts) {
      const key = a.item ? 'i:' + a.item : a.tier === 'original' && a.ref ? 'o:' + a.ref : null;
      if (!key || a.tier === 'guided') continue;
      const d = dayStr(a.at);
      const r = runs[key];
      if (!r || d > r.day) runs[key] = { day: d, at: a.at, list: [a] };
      else if (d === r.day) { r.list.push(a); r.at = Math.max(r.at, a.at); }
    }
    const confirmed = new Set(data.attempts.filter(a => a.verify && a.correct && a.conf >= 2).map(a => a.item ? 'i:' + a.item : 'o:' + a.ref));
    const items = Object.fromEntries(content.items.map(i => [i.id, i]));
    const origs = Object.fromEntries(content.originals.map(o => [o.id, o]));
    const flagged = data.flags || {};
    const out = [];
    for (const [key, r] of Object.entries(runs)) {
      if (confirmed.has(key) || r.at >= cutoff || !r.list.every(a => a.correct)) continue;
      const id = key.slice(2);
      const conf = Math.min(...r.list.map(a => a.conf || 2));
      if (key[0] === 'i') {
        const it = items[id];
        if (!it || it.tier !== 'transfer' || flagged[id]) continue;
        out.push({ kind: 'item', id, skill: it.skill, minutes: itemMinutes(it), conf, at: r.at });
      } else if (origs[id] && analyzable(origs[id])) {
        out.push({ kind: 'original', id, skill: origs[id].skill, minutes: MINUTES.original, conf, at: r.at });
      }
    }
    // Guesses (찍음) first, then the oldest.
    return out.sort((a, b) => a.conf - b.conf || a.at - b.at);
  }

  // ---------- daily session ----------
  function buildSession(data, content, now) {
    const minutes = (data.settings && data.settings.minutes) || 40;
    const left = daysLeft(data.settings && data.settings.examDate, now);
    const table = skillTable(data, content, now);
    const used = new Set();
    const steps = [];
    let budget = 0;
    const add = (s, m) => { steps.push(s); budget += m; };
    const reviewedOrig = new Set(data.attempts.filter(a => a.tier === 'original').map(a => a.ref));
    const dates = testDates(content.tests);

    // 1. Retention checks for improved skills that are due.
    const dueSkills = table.filter(r => ['IMPROVED', 'RETAINED'].includes(r.st.state) && r.due).sort((a, b) => a.st.dueAt - b.st.dueAt);
    for (const r of dueSkills.slice(0, 3)) {
      let pick = pickItems(content, data, r.skill.id, 'transfer', 1, used)[0];
      let tier = 'delayed';
      if (!pick) { const it = oldestSeenTransfer(content, data, r.skill.id, used); if (it) { pick = { item: it }; tier = 'repeat'; } }
      if (!pick) continue;
      used.add(pick.item.id);
      add({ type: 'item', skill: r.skill.id, item: pick.item.id, tier, block: 'retention' }, itemMinutes(pick.item));
    }

    // 2. Focus skills.
    const finalDay = left != null && left <= 1;
    const nearExam = left != null && left <= 4;
    // A skill with no unseen transfer questions cannot produce new evidence today → not a focus skill.
    const fresh = id => pickItems(content, data, id, 'transfer', 1, used).length > 0;
    let candidates = table.filter(r => !['IMPROVED', 'RETAINED'].includes(r.st.state) && fresh(r.skill.id)).sort((a, b) => b.pr - a.pr);
    if (nearExam) candidates = candidates.filter((r, i) => r.st.state !== 'NEW' || i === 0);
    let nFocus = finalDay ? 0 : (minutes >= 60 ? 3 : 2);
    let focus = candidates.slice(0, nFocus);
    // Spread fatigue: avoid two listening-only skills when a reading skill is nearly as urgent.
    if (focus.length === 2 && focus.every(r => r.skill.area === 'L')) {
      const alt = candidates.find(r => r.skill.area !== 'L');
      if (alt && alt.pr >= 0.85 * focus[1].pr) focus[1] = alt;
    }
    const focusIds = focus.map(r => r.skill.id);

    // Every original error is re-solved before the exam: reserve today's share of the time now,
    // so focus blocks fit around it (originals shown inside a focus block count toward the share).
    const oq = originalQueue(content, data, now);
    const quota = originalQuota(oq.fresh.length, oq.again.length, left, minutes);
    let freshShown = 0;
    const reserved = (quota.fresh + quota.again) * MINUTES.original;
    budget += reserved;

    const perFocus = Math.max(8, (minutes - budget - (nearExam ? 8 : 5)) / Math.max(1, focus.length));
    for (const r of focus) {
      const sid = r.skill.id; let b = 0;
      const blockAdd = (s, m) => { add(s, m); b += m; };
      const st = r.st.state;
      // a. Original errors: confirm what went wrong (only analyzable, not yet reviewed).
      const origs = content.originals.filter(o => o.skill === sid && analyzable(o) && !reviewedOrig.has(o.id))
        .sort((a, b) => (dates[b.test] || '').localeCompare(dates[a.test] || '') || (b.my != null) - (a.my != null));
      const nOrig = st === 'NEW' ? 3 : st === 'RELAPSED' ? 2 : (st === 'UNDERSTOOD' || st === 'PRACTICING' ? 1 : 0);
      for (const o of origs.slice(0, nOrig)) {
        // Already paid for by the reserved share, unless the share is used up.
        blockAdd({ type: 'original', skill: sid, ref: o.id, block: sid }, freshShown < quota.fresh ? 0 : MINUTES.original);
        b += MINUTES.original; freshShown++;
      }
      // b. The move (procedure) card.
      if (['NEW', 'UNDERSTOOD', 'PRACTICING', 'RELAPSED'].includes(st)) blockAdd({ type: 'move', skill: sid, block: sid }, MINUTES.move);
      // c. Guided practice.
      const nGuided = ['NEW', 'UNDERSTOOD', 'PRACTICING'].includes(st) ? 2 : (st === 'RELAPSED' ? 1 : 0);
      for (const g of pickItems(content, data, sid, 'guided', nGuided, used)) {
        used.add(g.item.id); blockAdd({ type: 'item', skill: sid, item: g.item.id, tier: 'guided', block: sid }, itemMinutes(g.item));
      }
      // d. Transfer: new questions, no scaffolds — the evidence that counts.
      for (const t of pickItems(content, data, sid, 'transfer', 5, used)) {
        if (b + itemMinutes(t.item) > perFocus && steps.filter(s => s.block === sid && s.tier === 'transfer').length >= 2) break;
        used.add(t.item.id); blockAdd({ type: 'item', skill: sid, item: t.item.id, tier: 'transfer', block: sid }, itemMinutes(t.item));
      }
    }

    // 3. The rest of today's original errors (all skills, not just focus): still-wrong ones, then unseen ones.
    const shownOrig = new Set(steps.filter(x => x.type === 'original').map(x => x.ref));
    const origBlock = oq.again.slice(0, quota.again)
      .concat(oq.fresh.filter(o => !shownOrig.has(o.id)).slice(0, Math.max(0, quota.fresh - freshShown)));
    if (origBlock.length) {
      steps.push({ type: 'origIntro', n: origBlock.length });
      for (const o of origBlock) steps.push({ type: 'original', skill: o.skill, ref: o.id, block: 'orig', again: reviewedOrig.has(o.id) || undefined });
    }
    // Replace the reservation with what was actually scheduled (focus-block originals inside the share were added at 0).
    budget += (origBlock.length + Math.min(freshShown, quota.fresh)) * MINUTES.original - reserved;

    // 4. Interleaved mixed block (different skills shuffled together).
    const nMixed = finalDay ? 8 : nearExam ? 6 : 3;
    const mixedFrom = table.slice().sort((a, b) => (focusIds.includes(a.skill.id) - focusIds.includes(b.skill.id)) || b.pr - a.pr);
    const mixed = [];
    for (let round = 0; mixed.length < nMixed && round < 3; round++) {
      for (const r of mixedFrom) {
        if (mixed.length >= nMixed || budget > minutes + 3) break;
        const t = pickItems(content, data, r.skill.id, 'transfer', 1, used)[0];
        if (!t || t.item.kind === 'listen' && budget + 4 > minutes) continue;
        used.add(t.item.id); mixed.push(t.item); budget += itemMinutes(t.item);
      }
    }
    // Pool exhausted: fill with the oldest already-seen questions, logged as 'repeat' (retention only, never transfer).
    const repeats = [];
    for (const r of mixedFrom) {
      if (mixed.length + repeats.length >= nMixed || budget > minutes) break;
      const it = oldestSeenTransfer(content, data, r.skill.id, used);
      if (!it || it.kind === 'listen') continue;
      used.add(it.id); repeats.push(it); budget += itemMinutes(it);
    }
    // 5. Re-checks: questions answered right ≥ 3 days ago (1 day near the exam), mixed in so they don't stand out.
    const counted = steps.filter(x => x.type === 'item' && x.tier !== 'guided' || x.type === 'original').length + mixed.length + repeats.length;
    const gap = nearExam ? 1 : 3;
    const vPool = verifyPool(content, data, now, gap).filter(v => v.kind === 'original' ? !steps.some(x => x.ref === v.id) : !used.has(v.id));
    const nVerify = Math.min(vPool.length, Math.max(1, Math.round(counted * VERIFY_RATIO)), 6);
    const verify = [];
    // Spread over skills: one per skill per round.
    for (let round = 0; verify.length < nVerify && round < 6; round++) {
      const taken = new Set();
      for (const v of vPool) {
        if (verify.length >= nVerify) break;
        if (verify.includes(v) || taken.has(v.skill)) continue;
        taken.add(v.skill); verify.push(v); budget += v.minutes;
      }
    }
    const mixedSteps = mixed.map(it => ({ type: 'item', skill: it.skill, item: it.id, tier: 'mixed', block: 'mixed' }))
      .concat(repeats.map(it => ({ type: 'item', skill: it.skill, item: it.id, tier: 'repeat', block: 'mixed' })));
    // Deterministic interleave: re-checks slot in after every few mixed questions.
    verify.forEach((v, k) => {
      const s = v.kind === 'item' ? { type: 'item', skill: v.skill, item: v.id, tier: 'verify', block: 'mixed' } : { type: 'original', skill: v.skill, ref: v.id, verify: true, block: 'mixed' };
      const pos = Math.min(mixedSteps.length, Math.round((k + 1) * (mixedSteps.length + verify.length) / (verify.length + 1)));
      mixedSteps.splice(pos, 0, s);
    });
    if (mixedSteps.length) steps.push({ type: 'mixedIntro' }, ...mixedSteps);
    steps.push({ type: 'end' });

    return {
      id: 's' + now.toString(36),
      date: dayStr(now),
      createdAt: now,
      focus: focusIds,
      retention: steps.filter(x => x.block === 'retention').map(x => x.skill),
      originals: { total: oq.total, left: oq.fresh.length, again: oq.again.length, today: steps.filter(x => x.type === 'original' && !x.verify).length },
      verifyCount: verify.length,
      freshLeft: content.items.filter(i => i.tier === 'transfer' && !seenItems(data, MASTERY_TIERS.concat(['repeat'])).has(i.id) && !(data.flags || {})[i.id]).length,
      daysLeft: left,
      estMinutes: Math.round(budget),
      steps,
      cursor: 0,
      sub: null,
      done: false,
    };
  }

  // ---------- metrics (activity vs accuracy vs retention vs transfer vs recurrence) ----------
  function metrics(data) {
    const A = data.attempts;
    const pct = (xs) => xs.length ? Math.round(100 * xs.filter(x => x.correct).length / xs.length) : null;
    const transfer = A.filter(a => (a.tier === 'transfer' || a.tier === 'mixed') && !a.hinted);
    const delayed = A.filter(a => a.tier === 'delayed');
    const originals = A.filter(a => a.tier === 'original');
    const verify = A.filter(a => a.verify);
    const days = new Set(A.map(a => dayStr(a.at)));
    const trapPicks = A.filter(a => a.trap && !a.correct);
    const sameTrapRepeats = (() => {
      const byKey = {}; let rep = 0;
      for (const a of A.slice().sort((x, y) => x.at - y.at)) {
        if (!a.trap || a.correct) continue;
        const k = a.skill + ':' + a.trap;
        byKey[k] = (byKey[k] || 0) + 1;
        if (byKey[k] > 1) rep++;
      }
      return rep;
    })();
    const count = (key, vals) => Object.fromEntries(vals.map(v => [v, A.filter(a => a[key] === v).length]));
    return {
      stuck: count('stuck', ['sound', 'memory', 'judge', 'vocab']),
      reheard: count('reheard', ['clear', 'still']),
      recur: count('recur', ['same', 'rulefail', 'other', 'unknown']),
      activity: { attempts: A.length, days: days.size, ms: A.reduce((s, a) => s + (a.ms || 0), 0) },
      originalRedo: { n: originals.length, pct: pct(originals) },
      // Re-checks of questions answered right before: 알고 맞힘 (right, 보통/확신) · 찍어서 맞힘 (right, 찍음) · 틀림 (the earlier right answer didn't hold).
      verify: { n: verify.length, known: verify.filter(a => a.correct && a.conf >= 2).length, guessed: verify.filter(a => a.correct && !(a.conf >= 2)).length, lost: verify.filter(a => !a.correct).length },
      transfer: { n: transfer.length, pct: pct(transfer) },
      retention: { n: delayed.length, pct: pct(delayed) },
      confidentMiss: { n: transfer.filter(a => !a.correct && a.conf >= 3).length, of: transfer.length },
      recurrence: { trapMisses: trapPicks.length, repeats: sameTrapRepeats },
    };
  }

  // Deterministic shuffle (seeded by id) so options never sit in the authored order.
  function permutation(n, seedStr, fixed) {
    const idx = [...Array(n).keys()];
    if (fixed) return idx;
    let h = 2166136261;
    for (const c of seedStr) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); }
    for (let i = n - 1; i > 0; i--) {
      h ^= h << 13; h ^= h >>> 17; h ^= h << 5;
      const j = Math.abs(h) % (i + 1);
      [idx[i], idx[j]] = [idx[j], idx[i]];
    }
    return idx;
  }

  function checkTyped(input, prefix, answer) {
    const s = (input || '').trim().toLowerCase().replace(/[^a-z-]/g, '');
    const a = answer.toLowerCase();
    return s === a || prefix.toLowerCase() + s === a;
  }

  // Errors per skill for each recorded test (primary skill), oldest → newest, for the TPO report view.
  function testMatrix(content) {
    const tests = content.tests.slice().sort((a, b) => a.date.localeCompare(b.date));
    return content.skills.map(sk => ({ skill: sk.id, counts: tests.map(t => content.originals.filter(o => o.test === t.id && o.skill === sk.id).length) }));
  }

  const api = { testMatrix, recencyMap, dayStr, dayStart, daysLeft, firstInterval, evidence, replaySkill, priority, skillTable, buildSession, metrics,
    permutation, checkTyped, pickItems, originalQueue, originalQuota, verifyPool, STATE_LABEL, MASTERY_TIERS, DAY };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Engine = api;
})(typeof window !== 'undefined' ? window : globalThis);
