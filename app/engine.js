/* Learning engine — pure functions, no DOM. Works in the browser (window.Engine) and in Node (require). */
(function (root) {
  'use strict';

  const DAY = 86400000;
  // Mastery-relevant tiers: only new questions answered without hints.
  const MASTERY_TIERS = ['transfer', 'mixed', 'delayed', 'verify-twin'];
  const STATE_LABEL = {
    NEW: '새로움', UNDERSTOOD: '이해함', PRACTICING: '훈련 중', VERIFYING: '검증 중',
    IMPROVED: '개선됨', RETAINED: '유지됨', RELAPSED: '재발',
  };
  const STATE_FACTOR = { NEW: 1.0, UNDERSTOOD: 1.0, PRACTICING: 1.0, VERIFYING: 0.9, IMPROVED: 0.3, RETAINED: 0.15, RELAPSED: 1.5 };
  // Expected minutes per step, used to fit the session into the daily budget.
  const MINUTES = { ctest: 0.6, mc: 1.6, insert: 2, reply: 0.6, listen: 4, original: 2, move: 0.7 };

  // ---------- dates ----------
  // 하루는 새벽 4시에 바뀐다: 00:00–03:59는 전날로 친다.
  const DAY_HOUR = 4;
  function dayStr(t) {
    const d = new Date(new Date(t).getTime() - DAY_HOUR * 3600000);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function dayStart(str) { const [y, m, d] = str.split('-').map(Number); return new Date(y, m - 1, d, DAY_HOUR).getTime(); }
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
    // 숙달 판정은 소站 새 문제로만: 없어진 AI 연습 문제의 시도는 기록에 남지만 판정에서 뺀다 (legacyAttempts로 셀 수 있음).
    const idx = content.pool ? poolIndex(content) : null;
    const events = data.attempts.filter(a => a.skill === skillId && !isLegacy(a, idx)).concat(realTest).sort((a, b) => a.at - b.at);
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

  // ---------- practice pool: 소站 TPO独家 문항 (content.pool = 공개 메타데이터; 원문은 비공개 ZHAN_POOL) ----------
  // Unit of practice ('item'): a reading set (C-Test passage, daily/academic passage), a listening set
  // (conversation/announcement/lecture), or one Listen & Reply question (each has its own audio).
  // 예상 시간 (2026-11-01 사용자 기준): C-Test 3분 · 일상 지문 문항당 1분+1분 · 학술 지문 문항당 1분+읽기 3분 · 응답 문항당 0.5분
  // · 대화/안내/강의 = 음원 길이(pool의 dur, 초) + 문항당 20초 (소站 화면). dur가 없으면 아래 세트 값.
  const ITEM_MIN = { ctest: 3, daily: 1, academic: 1, reply: 0.5, conversation: 1.5, announcement: 1.5, lecture: 3 };
  const Q_SEC = 20;
  const poolCache = new WeakMap();
  function dominant(qs) {
    const c = {}; for (const q of qs) if (q.skill) c[q.skill] = (c[q.skill] || 0) + 1;
    return Object.keys(c).sort((a, b) => c[b] - c[a])[0] || null;
  }
  function poolItems(content) {
    const pool = content.pool;
    if (!pool) return [];
    if (poolCache.has(pool)) return poolCache.get(pool);
    const out = [];
    for (const s of pool.sets) {
      if (s.sec !== 'R' && s.sec !== 'L') continue;
      const base = { sec: s.sec, kind: s.kind, paper: s.paper, held: !!s.held, zdate: s.zdate || null, set: s.id };
      if (s.kind === 'reply') {
        for (const q of s.qs) out.push(Object.assign({}, base, { id: q.id, skill: q.skill, skills: [q.skill], qs: [q], z: q.z || 0, minutes: ITEM_MIN.reply }));
      } else {
        const skills = [...new Set(s.qs.map(q => q.skill).filter(Boolean))];
        const z = s.qs.some(q => q.z === -1) ? -1 : s.qs.some(q => q.z === 1) ? 1 : 0;
        const m = s.kind === 'daily' || s.kind === 'academic' ? ITEM_MIN[s.kind] * s.qs.length + (s.kind === 'academic' ? 3 : 1)
          : s.sec === 'L' && s.dur ? Math.round((s.dur + Q_SEC * s.qs.length) / 6) / 10 : (ITEM_MIN[s.kind] || 2);
        out.push(Object.assign({}, base, { id: s.id, skill: dominant(s.qs), skills, qs: s.qs, z, minutes: m }));
      }
    }
    poolCache.set(pool, out);
    return out;
  }
  function itemMinutes(item) { return item.minutes || 1.5; }
  // 옛 AI 연습 문제의 시도: 옛 연습 tier인데 지금 풀에 없는 문항 (말하기·쓰기·모의 모듈 기록은 해당 없음)
  const OLD_TIERS = ['guided', 'transfer', 'mixed', 'delayed', 'repeat', 'verify'];
  const isLegacy = (a, idx) => !!(idx && a.item && OLD_TIERS.includes(a.tier) && !idx[a.item]);
  const idxCache = new WeakMap();
  function poolIndex(content) {
    if (content.pool && idxCache.has(content.pool)) return idxCache.get(content.pool);
    const m = {}; for (const i of poolItems(content)) m[i.id] = i;
    if (content.pool) idxCache.set(content.pool, m);
    return m;
  }

  function seenItems(data, extra) {
    const m = new Map();
    for (const a of data.attempts) if (a.item && a.tier !== 'original') m.set(a.item, Math.max(m.get(a.item) || 0, a.at));
    if (extra) for (const [id, at] of extra) m.set(id, Math.max(m.get(id) || 0, at || 0));
    return m;
  }

  // New questions for a skill: never answered in this app, not held back for the mock modules, not flagged.
  // Order: sets I never answered on 소站 first, then those I got right there longest ago; sets I got wrong
  // on 소站 are my original errors (re-solved elsewhere), so they come last.
  function freshPool(content, data, opts) {
    const o = opts || {};
    const seen = o.seen || seenItems(data);
    const flagged = data.flags || {};
    const rank = i => (i.z === -1 ? 2 : i.z === 1 ? 1 : 0);
    return poolItems(content)
      .filter(i => !i.held && !seen.has(i.id) && !flagged[i.id] && !(o.exclude && o.exclude.has(i.id)))
      .filter(i => (!o.skill || i.skills.includes(o.skill)) && (!o.sec || i.sec === o.sec) && (!o.kinds || o.kinds.includes(i.kind)))
      .sort((a, b) => rank(a) - rank(b) || (a.zdate || '').localeCompare(b.zdate || '') || a.paper - b.paper || (a.id < b.id ? -1 : 1));
  }

  // Kept for callers: new items for a skill (section alternates with where the latest real errors were).
  function pickItems(content, data, skillId, tier, n, exclude) {
    const fresh = freshPool(content, data, { skill: skillId, exclude });
    return interleaveBySection(fresh, latestSection(content, skillId)).slice(0, n).map(i => ({ item: i, repeat: false }));
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
  function interleaveBySection(items, first) {
    const L = items.filter(i => i.sec === 'L'); const R = items.filter(i => i.sec !== 'L');
    const [a, b] = first === 'L' ? [L, R] : [R, L];
    const out = [];
    for (let k = 0; k < Math.max(a.length, b.length); k++) { if (a[k]) out.push(a[k]); if (b[k]) out.push(b[k]); }
    return out;
  }

  // ---------- every original error, spread over the days left ----------
  // fresh = never re-solved or diagnosed (here or in the 리딩·리스닝 tabs), newest test first · again = latest full re-solve was wrong (not today).
  function originalQueue(content, data, now) {
    const dates = testDates(content.tests);
    const last = {};
    for (const a of data.attempts) if (a.tier === 'original' && a.ref && (!last[a.ref] || a.at > last[a.ref].at)) last[a.ref] = a;
    const origs = content.originals.filter(analyzable);
    const fresh = origs.filter(o => !last[o.id])
      .sort((a, b) => (dates[b.test] || '').localeCompare(dates[a.test] || '') || (b.my != null) - (a.my != null));
    const again = origs.filter(o => last[o.id] && !last[o.id].diag && last[o.id].correct === false && last[o.id].at < dayStart(dayStr(now)))
      .sort((a, b) => last[a.id].at - last[b.id].at);
    return { fresh, again, total: origs.length };
  }
  function originalQuota(nFresh, nAgain, left, cap) {
    const days = left == null ? 7 : Math.max(1, left - 1);
    const needFresh = Math.min(nFresh, Math.ceil(nFresh / days));
    const again = Math.min(nAgain, Math.max(1, Math.round(cap / 3)));
    return { again, fresh: Math.max(0, Math.min(Math.max(cap - again, needFresh), needFresh)) };
  }

  // ---------- "did I know it, or was it luck?": things answered right a few days ago ----------
  // Latest run of each item / original that ended correct, ≥ gap days ago, and not yet confirmed.
  function verifyPool(content, data, now, gap) {
    const cutoff = dayStart(dayStr(now)) - (gap - 1) * DAY;
    const runs = {};
    for (const a of data.attempts) {
      const key = a.item ? 'i:' + a.item : a.tier === 'original' && a.ref && !a.diag ? 'o:' + a.ref : null;
      if (!key || a.tier === 'guided' || a.twin) continue;
      const d = dayStr(a.at);
      const r = runs[key];
      if (!r || d > r.day) runs[key] = { day: d, at: a.at, list: [a] };
      else if (d === r.day) { r.list.push(a); r.at = Math.max(r.at, a.at); }
    }
    const confirmed = new Set(data.attempts.filter(a => a.verify && a.correct && a.conf >= 2).map(a => a.verifyOf || (a.item ? 'i:' + a.item : 'o:' + a.ref)));
    const items = poolIndex(content);
    const origs = Object.fromEntries(content.originals.map(o => [o.id, o]));
    const flagged = data.flags || {};
    const out = [];
    for (const [key, r] of Object.entries(runs)) {
      if (confirmed.has(key) || r.at >= cutoff || !r.list.every(a => a.correct)) continue;
      const id = key.slice(2);
      const conf = Math.min(...r.list.map(a => a.conf || 2));
      if (key[0] === 'i') {
        const it = items[id];
        if (!it || flagged[id]) continue;     // old AI practice items no longer exist → skipped (their attempts stay in the log)
        out.push({ kind: 'item', key, id, skill: it.skill, type: it.kind, sec: it.sec, conf, at: r.at });
      } else if (origs[id] && analyzable(origs[id])) {
        const o = origs[id];
        out.push({ kind: 'original', key, id, skill: o.skill, type: origKind(o), sec: o.sec, conf, at: r.at });
      }
    }
    return out.sort((a, b) => a.conf - b.conf || a.at - b.at);
  }
  // Pool kind that matches an original error (for twins).
  function origKind(o) {
    if (o.ctest || /c-test/i.test(o.qtype || '')) return 'ctest';
    if (o.sec === 'L') return /reply|response/i.test((o.qtype || '') + ' ' + (o.set || '')) ? 'reply' : /lecture|talk/i.test((o.qtype || '') + ' ' + (o.set || '')) ? 'lecture' : 'conversation';
    return /academic|passage/i.test((o.qtype || '') + ' ' + (o.set || '')) ? 'academic' : 'daily';
  }
  // Twin check: instead of re-asking the same question, a new 소站 question of the same skill and type.
  // If the pool has none left, the same question again (only when ≥ 3 days have passed).
  function twinFor(v, content, data, now, exclude) {
    const seen = seenItems(data);
    let pool = freshPool(content, data, { seen, skill: v.skill, kinds: [v.type], exclude });
    if (!pool.length) pool = freshPool(content, data, { seen, skill: v.skill, sec: v.sec, exclude });
    if (pool.length) return { twin: true, item: pool[0] };
    if (v.at <= dayStart(dayStr(now)) - 2 * DAY) return { twin: false, item: v.kind === 'item' ? poolIndex(content)[v.id] : null, ref: v.kind === 'original' ? v.id : null };
    return null;
  }

  // ---------- why a wrong answer happened → what comes next (모든 화면 공통) ----------
  // cause: sound 안 들렸다 · memory 들었는데 잊었다 · vocab 뜻을 몰랐다 · judge 선택지에서 헷갈렸다 ·
  //        time (리딩) 시간 부족 · omit (L&R) 빠뜨림 · grammar (말하기·쓰기) 문법 · structure (쓰기) 구조·아이디어
  // Old records used `stuck` (sound/memory/judge/vocab) for listening — read as the same cause.
  const CAUSES = ['sound', 'memory', 'vocab', 'judge', 'time', 'omit', 'grammar', 'structure'];
  function causeOf(a) { return a.cause || a.stuck || null; }
  // Queues for the next days, from wrong answers with a cause that have not been followed up yet.
  function causeQueues(data, now, extra) {
    const done = data.followups || {};   // key → at (dictation done, two-pass listen done, …)
    const q = { dictation: [], twoPass: [], judge: [], timed: [], shadow: [], fix: [], outline: [] };
    const seenKey = new Set();
    const list = data.attempts.concat((extra && extra.attempts) || []).filter(a => !a.correct && causeOf(a)).sort((a, b) => a.at - b.at);
    for (const a of list) {
      const target = a.item || a.ref; if (!target) continue;
      const c = causeOf(a);
      const route = c === 'sound' ? 'dictation' : c === 'memory' ? 'twoPass' : c === 'judge' ? 'judge' : c === 'time' ? 'timed' : c === 'omit' ? 'shadow' : c === 'grammar' ? 'fix' : c === 'structure' ? 'outline' : null;
      if (!route) continue;
      const key = route + ':' + target + (a.q != null ? '#' + a.q : '');
      if (seenKey.has(key) || (done[key] && done[key] >= a.at)) continue;
      seenKey.add(key);
      q[route].push({ key, item: a.item || null, ref: a.ref || null, q: a.q == null ? null : a.q, skill: a.skill, at: a.at, missed: a.missed, cats: a.cats });
    }
    return q;
  }

  // ---------- daily plan: 5 blocks, minutes = total × weight ----------
  // 단어는 2026-11-01부터 오늘 계획에서 뺐다 (단어 탭에서 따로). 예전 단어 비중 10은 나머지에 비례해 나눴다.
  const BLOCKS = ['listen', 'read', 'speak', 'write', 'wrap'];
  const BASE_WEIGHTS = { listen: 33, read: 17, speak: 17, write: 22, wrap: 11 };
  function weekKey(t) {
    const d = new Date(dayStart(dayStr(t))); const day = (d.getDay() + 6) % 7; d.setDate(d.getDate() - day + 3);
    const y = d.getFullYear(); const w1 = new Date(y, 0, 4);
    return y + '-W' + String(1 + Math.round(((d - w1) / DAY - 3 + ((w1.getDay() + 6) % 7)) / 7)).padStart(2, '0');
  }
  // Weights in percent. settings.weights: values the learner fixed (those never auto-change).
  // data.weightAuto = {week, adj}: once a week, an area whose leading indicator did not improve gets +5%p.
  function weights(data) {
    const fixed = (data.settings && data.settings.weights) || {};
    const adj = (data.weightAuto && data.weightAuto.adj) || {};
    const w = {};
    for (const k of BLOCKS) w[k] = fixed[k] != null ? +fixed[k] : BASE_WEIGHTS[k] + (adj[k] || 0);
    const free = BLOCKS.filter(k => fixed[k] == null);
    const sum = BLOCKS.reduce((s, k) => s + w[k], 0);
    if (sum !== 100 && free.length) {
      const fixedSum = BLOCKS.filter(k => fixed[k] != null).reduce((s, k) => s + w[k], 0);
      const freeSum = free.reduce((s, k) => s + w[k], 0) || 1;
      for (const k of free) w[k] = Math.max(0, (100 - fixedSum) * w[k] / freeSum);
    }
    return w;
  }
  // indicators: {area: {now, prev, higherIsBetter}} for the last 7 days vs the 7 before (null = not enough data).
  function weeklyAdjust(data, now, indicators) {
    const wk = weekKey(now);
    const cur = data.weightAuto || { week: null, adj: {} };
    if (cur.week === wk) return cur;
    const fixed = (data.settings && data.settings.weights) || {};
    const adj = Object.assign({}, cur.adj);
    const notImproved = [];
    for (const k of ['listen', 'read', 'speak', 'write']) {
      const ind = indicators && indicators[k];
      if (fixed[k] != null || !ind || ind.now == null || ind.prev == null) continue;
      const better = ind.higherIsBetter === false ? ind.now < ind.prev : ind.now > ind.prev;
      if (!better) { adj[k] = Math.min(20, (adj[k] || 0) + 5); notImproved.push(k); }
    }
    return { week: wk, adj, raised: notImproved, at: now };
  }
  // Accuracy of new questions (R / L) in a window of days ending today — the leading indicator for those areas.
  function areaAccuracy(data, content, now, sec, fromDay, toDay) {
    const idx = poolIndex(content);
    const t0 = dayStart(dayStr(now)) - fromDay * DAY; const t1 = dayStart(dayStr(now)) - toDay * DAY;
    const xs = data.attempts.filter(a => a.item && idx[a.item] && idx[a.item].sec === sec && ['transfer', 'mixed', 'delayed'].includes(a.tier) && a.at >= t0 && a.at < t1);
    return xs.length >= 5 ? xs.filter(a => a.correct).length / xs.length : null;
  }

  // ctx (from the UI, all optional): seen (Map item→at from the 리딩·리스닝 tabs), vocab {hard, due},
  // speak {lrSets:[ids], interview:[ids]}, write {tasks:[{id,kind}], errorCats:[cat]}, extraAttempts.
  function buildPlan(data, content, now, ctx) {
    ctx = ctx || {};
    const minutes = Math.max(10, +((data.settings && data.settings.minutes) || 60));
    const left = daysLeft(data.settings && data.settings.examDate, now);
    const w = weights(data);
    const mins = Object.fromEntries(BLOCKS.map(k => [k, Math.round(minutes * w[k] / 100)]));
    const seen = seenItems(data, ctx.seen);
    const used = new Set();
    const table = skillTable(data, content, now);
    const prio = Object.fromEntries(table.map(r => [r.skill.id, r.pr]));
    const cq = causeQueues(data, now, { attempts: ctx.extraAttempts });
    const blocks = Object.fromEntries(BLOCKS.map(k => [k, { key: k, minutes: mins[k], tasks: [], carried: 0 }]));
    const take = (blk, task, m) => { const b = blocks[blk]; b.tasks.push(Object.assign({ min: m }, task)); if (task.item) used.add(task.item); };
    const room = blk => blocks[blk].minutes - blocks[blk].tasks.reduce((s, t) => s + (t.min || 0), 0);
    // Within a block, the skill with the longest queue / most frequent errors comes first.
    const byPrio = (a, b) => (prio[b.skill] || 0) - (prio[a.skill] || 0);
    const freshOf = o => freshPool(content, data, Object.assign({ seen, exclude: used }, o));

    // 0. Carry over unfinished tasks from an earlier day's plan (same block, first).
    const prev = data.plan;
    if (prev && prev.date && prev.date < dayStr(now) && prev.blocks) {
      for (const b of prev.blocks) {
        if (!blocks[b.key]) continue;
        const rest = (b.tasks || []).slice(b.cursor || 0).filter(t => !t.carriedFrom || t.carriedFrom >= dayStr(now - 3 * DAY));
        const fu = data.followups || {};
        for (const t of rest) {
          if (t.item && (seen.has(t.item) || used.has(t.item))) continue;
          // 다른 화면에서 이미 한 것은 넘기지 않는다 (원본 진단·다시 확인, 받아쓰기 등 후속 훈련)
          if (t.ref && data.attempts.some(a => a.ref === t.ref && a.tier === 'original' && a.at >= prev.createdAt)) continue;
          if (t.key && fu[t.key] && fu[t.key] >= prev.createdAt) continue;
          take(b.key, Object.assign({}, t, { carriedFrom: t.carriedFrom || prev.date }), t.min || 1); blocks[b.key].carried++;
        }
      }
    }

    // 완주 할당 (2026-11-01): 종류마다 오늘 몫 = ⌈(안 푼 문제 + 넘어온 것) ÷ 남은 날⌉ − 넘어온 것.
    // 시험일까지 풀 전체(모의 모듈용 보류 회차 제외)를 한 번씩 풀도록 하루 양을 정한다. 하루 시간이 모자라면 계획의 예상 시간(need)이 설정보다 커진다.
    const D = Math.max(1, left == null ? 14 : left);
    const kindOf = t => t.item && poolIndex(content)[t.item] ? poolIndex(content)[t.item].kind : t.type === 'write' ? t.kind : t.type;
    const carriedN = kinds => Object.values(blocks).reduce((n, b) => n + b.tasks.filter(t => t.carriedFrom && kinds.includes(kindOf(t))).length, 0);
    const share = (n, kinds) => { const c = carriedN(kinds); return Math.max(0, Math.ceil((n + c) / D) - c); };
    const cover = {};
    const takeQuota = (blk, list, kinds, label, mk) => { const q = share(list.length, kinds); cover[label] = { left: list.length, today: Math.min(q, list.length) }; list.slice(0, q).forEach(x => mk(x)); };

    // ② 리스닝: 받아쓰기→쉐도잉 대기열 · 2단계 듣기 · 강의/대화/안내 · 응답 문제.
    for (const d of cq.dictation.slice(0, 3)) take('listen', { type: 'dictation', item: null, of: d.item, ref: d.ref, q: d.q, key: d.key, skill: d.skill }, 4);
    for (const d of cq.shadow.slice(0, 3)) take('listen', { type: 'shadow', of: d.item, key: d.key, missed: d.missed }, 1.5);
    for (const d of cq.twoPass.slice(0, 1)) take('listen', { type: 'twopass', of: d.item, ref: d.ref, key: d.key, skill: d.skill }, 5);
    const lsets = freshOf({ sec: 'L', kinds: ['lecture', 'conversation', 'announcement'] }).sort((a, b) => (b.kind === 'lecture') - (a.kind === 'lecture') || byPrio(a, b));
    takeQuota('listen', lsets, ['lecture', 'conversation', 'announcement'], 'L 대화·안내·강의', it => take('listen', { type: 'item', item: it.id, tier: 'transfer', skill: it.skill, exam: true }, it.minutes));
    takeQuota('listen', freshOf({ sec: 'L', kinds: ['reply'] }).sort(byPrio), ['reply'], 'L 응답', it => take('listen', { type: 'item', item: it.id, tier: 'transfer', skill: it.skill, exam: true }, it.minutes));

    // ③ 리딩: 학술 지문 timed reading(wpm) · C-Test · 일상 지문.
    takeQuota('read', freshOf({ sec: 'R', kinds: ['academic'] }).sort(byPrio), ['academic'], 'R 학술 지문', it => take('read', { type: 'item', item: it.id, tier: 'transfer', skill: it.skill, timed: true, exam: true }, it.minutes));
    takeQuota('read', freshOf({ sec: 'R', kinds: ['ctest'] }).sort(byPrio), ['ctest'], 'R C-Test', it => take('read', { type: 'item', item: it.id, tier: 'transfer', skill: it.skill, exam: true }, it.minutes));
    takeQuota('read', freshOf({ sec: 'R', kinds: ['daily'] }).sort(byPrio), ['daily'], 'R 일상 지문', it => take('read', { type: 'item', item: it.id, tier: 'transfer', skill: it.skill, exam: true }, it.minutes));

    // ④ 말하기: Listen & Repeat 세트 · Interview 문제 4/3/2 (ctx.speak.lrLeft/ivLeft = 안 한 것, 없으면 오늘 것 하나).
    const sp = ctx.speak || {};
    const lrLeft = sp.lrLeft || (sp.lr ? [sp.lr] : []), ivLeft = sp.ivLeft || (sp.interview ? [sp.interview] : []);
    takeQuota('speak', lrLeft, ['lr'], 'S Listen & Repeat', id => take('speak', { type: 'lr', set: id }, 3));
    takeQuota('speak', ivLeft, ['interview'], 'S Interview', id => take('speak', { type: 'interview', q: id, rounds: [45, 34, 23] }, 4));

    // ⑤ 쓰기: 2분 계획 카드 → 이메일·토론 · Build a Sentence · 구조 원인이면 개요 드릴 · 반복 오류 고쳐 쓰기.
    const wr = ctx.write || {};
    const wLeft = wr.left || {};
    if (!wr.left && wr.task) wLeft[wr.kind] = [wr.task];
    takeQuota('write', wLeft.email || [], ['email'], 'W Email', id => take('write', { type: 'write', task: id, kind: 'email', plan: true }, 9));
    takeQuota('write', wLeft.discussion || [], ['discussion'], 'W Discussion', id => take('write', { type: 'write', task: id, kind: 'discussion', plan: true }, 12));
    takeQuota('write', wLeft.bs || [], ['bs'], 'W Build a Sentence', id => take('write', { type: 'bs', set: id }, 7));
    if (cq.outline.length) take('write', { type: 'outline', n: 3, key: cq.outline[0].key }, 6);
    const fixCats = [...new Set((wr.errorCats || []).concat(cq.fix.flatMap(f => f.cats || [])))].slice(0, 3);
    if (fixCats.length) take('write', { type: 'fix', cats: fixCats, key: cq.fix.length ? cq.fix[0].key : undefined }, 4);
    for (const k of ['listen', 'read', 'speak', 'write']) blocks[k].minutes = Math.round(blocks[k].tasks.reduce((s, t) => s + (t.min || 0), 0));
    // 마무리는 남은 시간 (최소 비중만큼).
    const solveMin = ['listen', 'read', 'speak', 'write'].reduce((s, k) => s + blocks[k].minutes, 0);
    blocks.wrap.minutes = Math.max(Math.round(minutes * w.wrap / 100), minutes - solveMin);

    // ⑥ 마무리: 섞어 풀기 · 다시 확인(전에 맞힌 문제 → 쌍둥이) · 원본 빠른 진단 카드.
    const nearExam = left != null && left <= 4;
    const oq = originalQueue(content, data, now);
    const diagCap = Math.max(4, Math.round(blocks.wrap.minutes * 0.5 / 1));
    const quota = originalQuota(oq.fresh.length, oq.again.length, left, diagCap);
    const vPool = verifyPool(content, data, now, nearExam ? 1 : 3);
    // 'judge' cause → a new question of the same skill + a twin check.
    for (const j of cq.judge.slice(0, 2)) {
      const it = freshOf({ skill: j.skill })[0];
      if (it) take('wrap', { type: 'item', item: it.id, tier: 'mixed', skill: j.skill, exam: true, because: 'judge', key: j.key }, it.minutes);
    }
    // Retention: improved skills that are due get one new question of that skill.
    for (const r of table.filter(r => ['IMPROVED', 'RETAINED'].includes(r.st.state) && r.due).slice(0, 2)) {
      const it = freshOf({ skill: r.skill.id })[0];
      if (it) take('wrap', { type: 'item', item: it.id, tier: 'delayed', skill: r.skill.id, exam: true }, Math.min(it.minutes, 3));
    }
    let nVerify = 0;
    for (const v of vPool) {
      if (nVerify >= 3) break;
      const t = twinFor(v, content, data, now, used);
      if (!t) continue;
      nVerify++;
      if (t.item) take('wrap', { type: 'item', item: t.item.id, tier: t.twin ? 'verify-twin' : 'verify', skill: v.skill, verifyOf: v.key, exam: true }, Math.min(itemMinutes(t.item), 3));
      else take('wrap', { type: 'original', ref: t.ref, verify: true, verifyOf: v.key, skill: v.skill }, 2);
    }
    for (const o of oq.again.slice(0, quota.again).concat(oq.fresh.slice(0, quota.fresh))) take('wrap', { type: 'diag', ref: o.id, skill: o.skill, again: oq.again.includes(o) || undefined }, 1);
    const mixedFrom = table.slice().sort((a, b) => b.pr - a.pr);
    for (const r of mixedFrom) {
      if (room('wrap') < 1.5) break;
      const it = freshOf({ skill: r.skill.id, kinds: ['daily', 'reply', 'conversation', 'announcement'] })[0];
      if (it && it.minutes <= room('wrap') + 1) take('wrap', { type: 'item', item: it.id, tier: 'mixed', skill: r.skill.id, exam: true }, it.minutes);
    }

    const out = BLOCKS.map(k => Object.assign(blocks[k], { cursor: 0, done: false, weight: Math.round(w[k]) }));
    const need = Math.round(out.reduce((s, b) => s + b.tasks.reduce((x, t) => x + (t.min || 0), 0), 0));
    return {
      v: 3,
      id: 'p' + now.toString(36),
      date: dayStr(now),
      createdAt: now,
      minutes,
      daysLeft: left,
      need,
      cover,
      blocks: out,
      originals: { total: oq.total, left: oq.fresh.length, again: oq.again.length, today: blocks.wrap.tasks.filter(t => t.type === 'diag').length },
      freshLeft: freshPool(content, data, { seen }).length,
      held: (content.pool && content.pool.papers || []).filter(p => p.held).map(p => ({ paper: p.n, date: p.held })),
      queues: { dictation: cq.dictation.length, twoPass: cq.twoPass.length, judge: cq.judge.length, timed: cq.timed.length, shadow: cq.shadow.length, fix: cq.fix.length, outline: cq.outline.length },
    };
  }

  function legacyAttempts(data, content) {
    const idx = poolIndex(content);
    return data.attempts.filter(a => isLegacy(a, idx)).length;
  }

  // ---------- 변화 탭 지표 (OVERHAUL.md 측정 표): 최근 7일 vs 그 전 7일, 기록이 적으면 null ----------
  function areaMetrics(data, content, now, extra) {
    const t = dayStart(dayStr(now)) + DAY;
    const win = (list, from, to) => (list || []).filter(x => x.at >= t - from * DAY && x.at < t - to * DAY);
    const avg = (xs, f, min) => { const v = xs.map(f).filter(x => x != null && !isNaN(x)); return v.length >= (min || 1) ? Math.round(10 * v.reduce((a, b) => a + b, 0) / v.length) / 10 : null; };
    const pct = (xs, min) => xs.length >= (min || 3) ? Math.round(100 * xs.filter(a => a.correct).length / xs.length) : null;
    const idx = poolIndex(content);
    const newQ = sec => a => a.item && idx[a.item] && idx[a.item].sec === sec && ['transfer', 'mixed', 'delayed', 'verify-twin'].includes(a.tier);
    const ctest = a => a.item && idx[a.item] && idx[a.item].kind === 'ctest' && a.tier !== 'mock';
    const two = (f) => ({ now: f(7, 0), prev: f(14, 7) });
    const mockLast = sec => { const m = (data.mock || []).filter(x => x.sec === sec).slice(-1)[0]; return m ? { pct: m.total ? Math.round(100 * m.correct / m.total) : null, n: m.total, paper: m.paper, at: m.at } : null; };
    const speak = data.speak || [], writing = data.writing || [];
    const lr = x => x.kind === 'lr' && x.stt;
    const iv = x => x.kind === 'interview' && x.stt && (x.rounds || []).length;
    const essays = x => x.kind === 'email' || x.kind === 'discussion';
    const ex = extra || {};
    return {
      L: { dictation: two((a, b) => avg(win(data.dictation, a, b), x => x.pct)), newQ: two((a, b) => pct(win(data.attempts, a, b).filter(newQ('L')))), mock: mockLast('L') },
      R: { wpm: two((a, b) => avg(win(data.readSpeed, a, b).filter(x => x.wpm && x.wpm < 1000), x => x.wpm)), newQ: two((a, b) => pct(win(data.attempts, a, b).filter(newQ('R')))),
        ctest: two((a, b) => pct(win(data.attempts, a, b).filter(ctest), 10)), mock: mockLast('R') },
      V: { frequent: ex.vocabNow == null ? null : { now: ex.vocabNow, prev: ex.vocabPrev == null ? null : ex.vocabPrev }, known: ex.knownRatio == null ? null : ex.knownRatio },
      S: { lr: two((a, b) => avg(win(speak, a, b).filter(lr), x => x.pct)),
        wpm: two((a, b) => avg(win(speak, a, b).filter(iv), x => avg(x.rounds, r => r.wpm))),
        pauses: two((a, b) => avg(win(speak, a, b).filter(iv), x => avg(x.rounds, r => r.pauses))) },
      W: { planSec: two((a, b) => avg(win(writing, a, b).filter(x => x.planMs), x => Math.round(x.planMs / 1000))),
        structure: two((a, b) => avg(win(writing, a, b).filter(essays).filter(x => x.structure), x => Math.round(100 * x.structure.filter(c => c[1]).length / x.structure.length))),
        errors: two((a, b) => avg(win(writing, a, b).filter(essays), x => (x.cats || []).length)) },
    };
  }
  // 주간 비중 자동 조정용 선행 지표 (영역별 하나): 리스닝 새 문제 정답률, 리딩 새 문제 정답률, 단어 자주 틀린 수(낮을수록 좋음), 말하기 L&R 일치율, 쓰기 구조 체크.
  function weeklyIndicatorsFrom(m) {
    return { listen: m.L.newQ, read: m.R.newQ, vocab: m.V.frequent && Object.assign({ higherIsBetter: false }, m.V.frequent), speak: m.S.lr, write: m.W.structure };
  }

  // Old plan/session records (v1 'session' with steps of removed AI items) are kept as-is under
  // data.legacySession and never rendered; nothing in the attempt log is touched.
  function migrateRecord(d) {
    if (d.session && d.session.steps && !d.legacySession) { d.legacySession = d.session; d.session = null; }
    if (!d.followups) d.followups = {};
    return d;
  }

  // ---------- metrics (activity vs accuracy vs retention vs transfer vs recurrence) ----------
  // content를 주면 없어진 AI 연습 문제의 시도는 정답률 지표에서 뺀다 (활동량에는 남김).
  function metrics(data, content) {
    const idx = content && content.pool ? poolIndex(content) : null;
    const ALL = data.attempts;
    const A = idx ? ALL.filter(a => !isLegacy(a, idx)) : ALL;
    const pct = (xs) => xs.length ? Math.round(100 * xs.filter(x => x.correct).length / xs.length) : null;
    const transfer = A.filter(a => (a.tier === 'transfer' || a.tier === 'mixed') && !a.hinted);
    const delayed = A.filter(a => a.tier === 'delayed');
    const originals = A.filter(a => a.tier === 'original' && !a.diag);
    const verify = A.filter(a => a.verify || a.tier === 'verify' || a.tier === 'verify-twin');
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
      stuck: Object.fromEntries(CAUSES.map(c => [c, A.filter(a => causeOf(a) === c).length])),
      reheard: count('reheard', ['clear', 'still']),
      recur: count('recur', ['same', 'rulefail', 'other', 'unknown']),
      activity: { attempts: ALL.length, days: new Set(ALL.map(a => dayStr(a.at))).size, ms: ALL.reduce((s, a) => s + (a.ms || 0), 0), legacy: ALL.length - A.length },
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

  const api = { testMatrix, recencyMap, dayStr, dayStart, daysLeft, firstInterval, evidence, replaySkill, priority, skillTable, metrics,
    permutation, checkTyped, pickItems, poolItems, poolIndex, freshPool, seenItems, originalQueue, originalQuota, verifyPool, twinFor, origKind,
    causeQueues, causeOf, legacyAttempts, areaMetrics, weeklyIndicatorsFrom, CAUSES, buildPlan, weights, weeklyAdjust, weekKey, areaAccuracy, migrateRecord, BLOCKS, BASE_WEIGHTS,
    STATE_LABEL, MASTERY_TIERS, DAY };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Engine = api;
})(typeof window !== 'undefined' ? window : globalThis);
