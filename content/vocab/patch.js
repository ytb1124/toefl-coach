// ===== TOEFL 교정 코치 연동 패치 =====
// 이 코드는 원본 단어 페이지(content/vocab/source.html)의 스크립트 안, 초기화 직전에 그대로 삽입된다.
// 원본의 '오늘 암기 시작' 흐름(노출 → 6개 묶음 → 간격 회상 → 최종 재시험)은 손대지 않고,
// 홈 화면 · 세트 나누기 · 이어하기만 코치 화면과 연결한다.

// 세트 750 (2026-11-01 사용자 구성, content/vocab/set750.json): 예전 30개 세트 계획(v1 키)은 지우지 않고 그대로 두고,
// 새 계획(v2 키)을 50개씩 15세트로 만든다. 단어별 학습 기록(srs·meta)은 그대로 이어서 쓴다.
const SET750 = /*__SET750__*/null;
const CHUNK_PLAN_KEY = 'toefl-vocab-chunk-plan-v2';
const CHUNK_SIZE = 50;
const ADDED_DAY = ALL_DAYS.length + 1;  // 단어장에 없던 단어(통합 문서1)는 'Day 31'로 덧붙인다. 기존 단어의 순번(기록 압축에 쓰임)은 바뀌지 않는다.
if (SET750) {
  const have = new Set(WORDS.map(w => w.en.toLowerCase()));
  SET750.added.forEach(a => { if (!have.has(a.en.toLowerCase())) WORDS.push({ en: a.en, ko: a.ko, cl: null, day: ADDED_DAY, added: true }); });
  ALL_DAYS.push(ADDED_DAY);
}

function readChunkPlan() { try { const p = JSON.parse(localStorage.getItem(CHUNK_PLAN_KEY)); return p && Array.isArray(p.words) ? p : null; } catch (e) { return null; } }
// 처음 열 때 한 번 만든다. base = 그때까지의 직접 입력 틀린 횟수 (세트를 나누기 전 기록은 '자주 틀린 단어' 셈에서 뺀다).
function loadChunkPlan() {
  const p = readChunkPlan(); if (p || !SET750) return p;
  const words = SET750.sets.flat(), base = {};
  words.forEach(en => { const m = wordMeta[en]; base[en] = m && m.failures ? Number(m.failures.typed || 0) : 0; });
  const plan = { createdAt: Date.now(), locked: true, version: 2, sourceQuizMode: 'flash', size: CHUNK_SIZE, words, base, done: {}, last: null };
  saveChunkPlan(plan);
  const s = loadSession(); if (s && s.sameDayState && s.sameDayState.chunk) clearSession();  // 예전 세트의 진행 중 세션만 정리 (단어 기록은 남음)
  return plan;
}
function saveChunkPlan(plan) { localStorage.setItem(CHUNK_PLAN_KEY, JSON.stringify(plan)); }
function chunkToday() { const d = new Date(Date.now() - 4 * 3600000);   // 하루는 새벽 4시에 바뀐다 (dayKey와 같게)
 return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }

// 복습 단어 = 원본의 '복습 단어 모드'와 같은 기준(찍음 tier, 마스터 아님). 전체 Day 기준, 교재 순서.
function reviewWordsFor(qMode) {
  const ns = srsState[qMode] || {};
  return WORDS.filter(w => ns[w.en] && ns[w.en].tier === 'guess' && !isMastered(qMode, w.en));
}
function reviewCounts() { const o = {}; QUIZ_MODES.forEach(m => { o[m] = reviewWordsFor(m).length; }); return o; }
function bestReviewMode() {
  const c = reviewCounts();
  return c.flash ? 'flash' : QUIZ_MODES.slice().sort((a, b) => c[b] - c[a])[0];
}
// 세트 계획은 loadChunkPlan이 세트 750으로 한 번 만들고 영구 고정한다 (다시 만들지 않음).
function createChunkPlan() { return loadChunkPlan(); }
function chunkCount(plan) { return Math.ceil(plan.words.length / plan.size); }
function chunkWords(plan, i) { return plan.words.slice(i * plan.size, (i + 1) * plan.size).map(en => WORDS.find(w => w.en === en)).filter(Boolean); }
function nextChunkIndex(plan) { for (let i = 0; i < chunkCount(plan); i++) if (!plan.done[i]) return i; return null; }

// '오늘 암기 시작'(startSameDaySession)과 같은 초기화를, 대상만 세트의 30개로 바꿔 실행한다.
function startChunkSession(i) {
  const plan = loadChunkPlan(); if (!plan) return false;
  const candidates = chunkWords(plan, i).filter(w => !getTodayLearningMeta(w.en).todayMastered);
  if (!candidates.length) { alert('세트 ' + (i + 1) + '의 단어는 오늘 이미 모두 완료했습니다.'); return false; }
  plan.last = i; saveChunkPlan(plan);
  const selectedQuizMode = plan.sourceQuizMode || 'flash';
  learningGoalMode = 'same_day'; quizMode = 'typed'; sessionQueue = candidates; sessionIdx = 0;
  sessionStats = {sure:0, vague:0, guess:0, quickRepairs:0, quickRepairSuccess:0, stopped:[]};
  learningState = null; delayedRetries = []; finalReviewQueue = []; finalReviewActive = false;
  sameDayState = {targets: candidates.map(w => w.en), sourceMode: 'review', sourceQuizMode: selectedQuizMode, chunk: {index: i, total: chunkCount(plan)}, nextNewIndex: 0, activityIndex: 0, pending: [], finalQueue: [], current: null, lastEns: [], phase: 'encoding', stats: {firstRecallSuccess:0, quick:0, deep:0, memory:0}};
  candidates.forEach(w => resetTodayLearningIfNeeded(w.en)); saveMeta(); saveSession(); renderCard();
  if (__hooks.started) __hooks.started('set' + i, '세트 ' + (i + 1));
  return true;
}
function markChunkDone() {
  const c = sameDayState && sameDayState.chunk; if (!c) return null;
  const plan = loadChunkPlan(); if (!plan) return null;
  if (!plan.done[c.index]) { plan.done[c.index] = chunkToday(); saveChunkPlan(plan); }
  return plan;
}

// 원본 홈 화면 대신 코치의 '단어' 화면으로 돌아간다 (나가기, 홈으로 버튼 모두 이 함수를 부른다).
renderHome = function () {
  learningScreenActive = false; currentSpeechText = ''; keyMap = {};
  try { speechSynthesis.cancel(); } catch (e) { /* no speech */ }
  __hooks.home();
};

// 세트로 시작한 세션이 끝나면 완료로 표시하고 '다음 세트' 버튼을 붙인다. 요약 화면 자체는 원본 그대로.
const renderBaseSameDaySummary = renderSameDaySummary;
renderSameDaySummary = function () {
  const chunk = sameDayState && sameDayState.chunk;
  const plan = markChunkDone();
  if (__hooks.finished) __hooks.finished();  // 스톱워치: 이 세트(또는 자주 틀린 단어) 시간 기록
  renderBaseSameDaySummary();
  if (!chunk || !plan) return;
  const wrap = app.firstElementChild; if (!wrap) return;
  wrap.insertBefore(el('div', 'font-size:14px;font-weight:600;color:#0F6E56;margin-bottom:12px', '세트 ' + (chunk.index + 1) + ' / ' + chunkCount(plan) + ' 완료 · 지금까지 ' + Object.keys(plan.done).length + '세트'), wrap.children[1] || null);
  const next = nextChunkIndex(plan);
  if (next != null) {
    const b = el('button', 'padding:12px 24px;border:1px solid #0F6E56;border-radius:8px;background:#e8f5ee;color:#0F6E56;margin-left:8px;cursor:pointer', '다음 세트 ' + (next + 1) + ' 시작');
    b.onclick = () => { learningGoalMode = 'standard'; sameDayState = null; clearSession(); startChunkSession(next); };
    wrap.appendChild(b);
  }
  __hooks.changed();
};

// 원본 홈의 '이어서 학습하기' 버튼과 같은 복원.
function resumeSession() {
  const resumable = loadSession(); if (!resumable) return false;
  sessionQueue = resumable.ens.map(en => WORDS.find(w => w.en === en)).filter(Boolean);
  if (Array.isArray(resumable.selectedDays) && resumable.selectedDays.length) {
    selectedDays = new Set(resumable.selectedDays.filter(day => ALL_DAYS.includes(day)));
    saveSelectedDays();
  }
  sessionIdx = resumable.idx; quizMode = resumable.quizMode; sourceMode = resumable.sourceMode; sessionStats = Object.assign({sure:0,vague:0,guess:0,quickRepairs:0,quickRepairSuccess:0,stopped:[]},resumable.stats||{});
  hardStage = resumable.hardStage || 'recognition';
  learningState = resumable.learningState || null;
  learningWords = Array.isArray(resumable.learningWords) ? resumable.learningWords : [];
  delayedRetries = Array.isArray(resumable.delayedRetries) ? resumable.delayedRetries : [];
  finalReviewQueue = Array.isArray(resumable.finalReviewQueue) ? resumable.finalReviewQueue : [];
  finalReviewActive = !!resumable.finalReviewActive;
  firstExposureMode = !!resumable.firstExposureMode;
  exposureSeen = Array.isArray(resumable.exposureSeen) ? resumable.exposureSeen : [];
  learningGoalMode = resumable.learningGoalMode || 'standard';
  sameDayState = resumable.sameDayState || null;
  renderCard();
  if (__hooks.started) { const c = sameDayState && sameDayState.chunk; __hooks.started(c ? 'set' + c.index : 'freq', c ? '세트 ' + (c.index + 1) : '자주 틀린 단어'); }
  return true;
}

// ===== 자주 틀린 단어 (개편 2026-11) =====
// 기존 기록(failures·tier·spacedRecall 등)은 그대로 두고 새 필드만 더한다:
//   m.vagueCount{모드}: '애매'도 틀린 쪽 신호로 따로 셈 · m.wrongDates / m.okDates: 모드와 관계없이 틀린 날·맞힌 날 · m.keepFlagAt: 문제 풀이 중 '뜻을 몰랐다'로 킵한 날
// 범위: 틀린 횟수(직접 입력은 2배) 2회 이상 또는 틀린 날 2일 이상(또는 '뜻을 몰랐다'로 킵), 틀린 비율 순.
// 마지막으로 틀린 날 뒤에 서로 다른 2일 연속으로 맞히면 빠진다. 기존 '고질 오답'(7일 중 3일)은 그대로 두고 목록에서 함께 표시.
const baseRecordAttempt = recordAttempt;
recordAttempt = function (qMode, en, tier, responseMs = null) {
  baseRecordAttempt(qMode, en, tier, responseMs);
  const m = getWordMeta(en), today = dayKey();
  m.vagueCount = Object.assign({flash:0,quiz_ko:0,quiz_en:0,typed:0}, m.vagueCount);
  if (tier === 'vague') m.vagueCount[qMode]++;
  if (tier === 'guess') addDate(m.wrongDates || (m.wrongDates = []), today);
  if (tier === 'sure') addDate(m.okDates || (m.okDates = []), today);
  saveMeta();
};
function addDate(list, d) { if (!list.includes(d)) list.push(d); list.sort(); if (list.length > 40) list.splice(0, list.length - 40); }
const MODE_LABEL = {typed: '직접 입력', flash: '카드', quiz_ko: '뜻 고르기', quiz_en: '동의어 고르기'};
function nextDay(d) { const t = new Date(d + 'T00:00:00'); t.setDate(t.getDate() + 1); return t.toLocaleDateString('en-CA'); }
function frequentInfo(en) {
  const m = getWordMeta(en), f = m.failures, a = m.attempts, v = Object.assign({flash:0,quiz_ko:0,quiz_en:0,typed:0}, m.vagueCount);
  const weighted = f.flash + f.quiz_ko + f.quiz_en + 2 * f.typed;
  const tries = a.flash + a.quiz_ko + a.quiz_en + 2 * a.typed;
  const wrongDays = [...new Set((m.wrongDates || []).concat(m.spacedRecall.failureDates || [], m.keepFlagAt ? [m.keepFlagAt] : []))].sort();
  const lastWrong = wrongDays[wrongDays.length - 1] || '';
  const okAfter = [...new Set((m.okDates || []).concat(m.spacedRecall.successfulDates || []))].filter(d => d > lastWrong).sort();
  const exited = okAfter.some((d, i) => i > 0 && nextDay(okAfter[i - 1]) === d);
  const candidate = (weighted >= 2 || wrongDays.length >= 2 || !!m.keepFlagAt) && !exited;
  const top = Object.keys(f).sort((x, y) => (y === 'typed' ? 2 : 1) * f[y] - (x === 'typed' ? 2 : 1) * f[x])[0];
  const vague = v.flash + v.quiz_ko + v.quiz_en + v.typed;
  const parts = [];
  if (f[top]) parts.push(MODE_LABEL[top] + ' ' + f[top] + '회 틀림');
  if (wrongDays.length) parts.push(wrongDays.length + '일');
  if (vague) parts.push('애매 ' + vague);
  if (m.keepFlagAt) parts.push('문제 풀다 모름');
  return { candidate, weighted, ratio: tries ? weighted / tries : (m.keepFlagAt ? 1 : 0), days: wrongDays.length, vague, hard: !!m.hard, exited, label: parts.join(' · ') };
}
// 범위(사용자 요청 2026-11-01): ① 세트 750에서 세트를 나눈 뒤 직접 입력으로 3회 이상 틀린 단어(나누기 전 횟수는 plan.base로 뺌)
// ② 문제를 풀다 '뜻을 몰랐다'로 킵한 단어. 마지막 틀린 날 뒤 서로 다른 2일 연속 맞히면 빠진다. 많이 틀린 순.
const FREQUENT_MIN_SET_FAILS = 3;
const FREQUENT_SESSION_SIZE = 30;
function setFails(en, plan = loadChunkPlan()) {
  if (!plan || !plan.base || !(en in plan.base)) return 0;
  return Math.max(0, Number(getWordMeta(en).failures.typed || 0) - plan.base[en]);
}
function frequentWords() {
  const plan = loadChunkPlan();
  return WORDS.map(w => [w, frequentInfo(w.en), setFails(w.en, plan)])
    .filter(([w, i, n]) => (n >= FREQUENT_MIN_SET_FAILS || getWordMeta(w.en).keepFlagAt) && !i.exited)
    .sort((x, y) => y[2] - x[2] || y[1].ratio - x[1].ratio).map(([w]) => w);
}
// 킵에서 덧붙인 단어(keptOnly)는 기기마다 다르므로 Day 목록에 넣지 않고, 순번으로 압축하는 기록(내보내기·클라우드)에서도 뺀다
// — 순번이 기기마다 달라 다른 단어 기록으로 들어가는 것을 막는다. 그 단어의 기록은 이 기기에만 남는다.
const KEPT_DAY = ADDED_DAY + 1;
function withoutKeptOnly(fn) {
  return function (...args) {
    const i = WORDS.findIndex(w => w.keptOnly);
    if (i < 0) return fn.apply(this, args);
    const tail = WORDS.splice(i);
    try { return fn.apply(this, args); } finally { WORDS.push(...tail); }
  };
}
packWordMeta = withoutKeptOnly(packWordMeta);
packCloudState = withoutKeptOnly(packCloudState);
const baseBuildSession = buildSession;
buildSession = function (size, qMode, srcMode) {
  if (srcMode === 'frequent') return frequentWords().slice(0, size);
  return baseBuildSession(size, qMode, srcMode);
};
// '자주 틀린 단어' 범위로 오늘 암기(같은 날 반복)를 시작한다 — 풀이 방식은 세트와 똑같다.
function startFrequentSession() {
  const candidates = frequentWords().filter(w => !getTodayLearningMeta(w.en).todayMastered).slice(0, FREQUENT_SESSION_SIZE);
  if (!candidates.length) { alert('오늘 할 자주 틀린 단어가 없습니다.'); return false; }
  learningGoalMode = 'same_day'; quizMode = 'typed'; sessionQueue = candidates; sessionIdx = 0;
  sessionStats = {sure:0, vague:0, guess:0, quickRepairs:0, quickRepairSuccess:0, stopped:[]};
  learningState = null; delayedRetries = []; finalReviewQueue = []; finalReviewActive = false;
  sameDayState = {targets: candidates.map(w => w.en), sourceMode: 'frequent', sourceQuizMode: 'flash', chunk: null, nextNewIndex: 0, activityIndex: 0, pending: [], finalQueue: [], current: null, lastEns: [], phase: 'encoding', stats: {firstRecallSuccess:0, quick:0, deep:0, memory:0}};
  candidates.forEach(w => resetTodayLearningIfNeeded(w.en)); saveMeta(); saveSession(); renderCard();
  if (__hooks.started) __hooks.started('freq', '자주 틀린 단어');
  return true;
}

const __api = {
  hasData() { return QUIZ_MODES.some(m => Object.keys(srsState[m] || {}).length > 0); },
  wordCount() { return WORDS.length; },
  // 단어 킵: 단어장에 있는 단어면 핵심 뜻 (복수·과거·진행형은 원형으로도 찾아 본다)
  lookup(word) {
    const w = String(word || '').toLowerCase().trim();
    const tries = [w, w.replace(/ies$/, 'y'), w.replace(/es$/, ''), w.replace(/s$/, ''), w.replace(/ied$/, 'y'), w.replace(/ed$/, ''), w.replace(/d$/, ''), w.replace(/ing$/, ''), w.replace(/ing$/, 'e'), w.replace(/ly$/, '')];
    for (const t of tries) { const hit = WORDS.find(x => x.en.toLowerCase() === t); if (hit) return { en: hit.en, ko: getCoreMeaning(hit) }; }
    return null;
  },
  reviewCounts, bestReviewMode,
  // 자주 틀린 단어
  hardCount() { return frequentWords().length; },
  startHard: startFrequentSession,
  frequentList() {
    const plan = loadChunkPlan();
    return frequentWords().map(w => {
      const n = setFails(w.en, plan), kept = !!getWordMeta(w.en).keepFlagAt;
      return Object.assign(frequentInfo(w.en), { en: w.en, ko: getCoreMeaning(w), day: w.day, cl: w.cl || null, added: !!w.added, setFails: n, kept,
        label: [n >= FREQUENT_MIN_SET_FAILS ? '세트에서 ' + n + '회 틀림' : '', kept ? '문제 풀다 모름' : ''].filter(Boolean).join(' · ') });
    });
  },
  // 킵 목록 중 단어장에 없는 단어를 WORDS 끝에 덧붙인다 (사용자 요청 2026-11-03: 750개에 없어도 자주 틀린 단어로 훈련).
  // 뜻이 있는 것만 (직접 입력은 뜻을 보고 영어를 쓴다). 뜻을 고치면 따라간다. 돌려주는 값 = 뜻이 없어 빠진 개수.
  syncKept(list) {
    let noKo = 0;
    (list || []).filter(k => !k.done).forEach(k => {
      const ko = String(k.ko || '').trim(), extra = WORDS.find(w => w.keptOnly && w.en.toLowerCase() === k.w.toLowerCase());
      if (extra) { if (ko) extra.ko = ko; return; }
      if (__api.lookup(k.w)) return;
      if (!ko) { noKo++; return; }
      WORDS.push({ en: k.w, ko, cl: null, day: KEPT_DAY, added: true, keptOnly: true });
    });
    return noKo;
  },
  // 킵 목록 중 단어장에 있는데 아직 표시가 없는 단어를 '문제 풀다 모름'으로 (단어장에 새로 들어온 단어 포함)
  flagKept(list) {
    let n = 0;
    (list || []).forEach(k => { const hit = __api.lookup(k.w); if (!hit) return; const m = getWordMeta(hit.en); if (m.keepFlagAt) return; m.keepFlagAt = k.at ? dayKey(k.at) : dayKey(); n++; });
    if (n) saveMeta();
    return n;
  },
  setGroups(i) { const p = loadChunkPlan(); if (!p || !SET750) return null; const c = {}; chunkWords(p, i).forEach(w => { const g = SET750.group[w.en] || '?'; c[g] = (c[g] || 0) + 1; }); return c; },
  // '뜻을 몰랐다'로 킵한 단어가 단어장에 있으면 자주 틀린 단어 후보로 (틀린 날 하나로 셈)
  flagWrong(word) { const hit = __api.lookup(word); if (!hit) return null; const m = getWordMeta(hit.en); m.keepFlagAt = dayKey(); saveMeta(); return hit.en; },
  // 단어장에 있는 단어면 그 상태 ('master' | 'review' | 'new' | 'hard'), 없으면 null
  wordStatus(word) { const hit = __api.lookup(word); return hit ? getGlobalStatus(hit.en) : null; },
  clusters() { return [...new Set(WORDS.map(w => w.cl).filter(Boolean))]; },
  plan: loadChunkPlan,
  createPlan: createChunkPlan,
  chunkCount, nextChunkIndex,
  remaining() { const p = loadChunkPlan(); if (!p) return null; let n = 0; for (let i = 0; i < chunkCount(p); i++) if (!p.done[i]) n += chunkWords(p, i).length; return n; },
  chunkWords(i) { const p = loadChunkPlan(); return p ? chunkWords(p, i).map(w => ({ en: w.en, ko: getCoreMeaning(w) })) : []; },
  start: startChunkSession,
  resume: resumeSession,
  resumable() {
    const s = loadSession(); if (!s) return null;
    const st = s.sameDayState;
    if (s.learningGoalMode === 'same_day' && st && Array.isArray(st.targets)) {
      const done = st.targets.filter(en => getTodayLearningMeta(en).todayMastered).length;
      return { chunk: st.chunk || null, done, total: st.targets.length };
    }
    return { chunk: null, done: s.idx, total: s.ens.length };
  },
  discardSession() { learningGoalMode = 'standard'; sameDayState = null; clearSession(); },
  importCode(str) { return importDataStr(str); },
  exportCode() { return exportData(); },
  deactivate() { learningScreenActive = false; keyMap = {}; currentSpeechText = ''; try { speechSynthesis.cancel(); } catch (e) { /* no speech */ } },
};
