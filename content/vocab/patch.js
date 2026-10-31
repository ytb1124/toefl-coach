// ===== TOEFL 교정 코치 연동 패치 =====
// 이 코드는 원본 단어 페이지(content/vocab/source.html)의 스크립트 안, 초기화 직전에 그대로 삽입된다.
// 원본의 '오늘 암기 시작' 흐름(노출 → 6개 묶음 → 간격 회상 → 최종 재시험)은 손대지 않고,
// 홈 화면 · 세트 나누기 · 이어하기만 코치 화면과 연결한다.

const CHUNK_PLAN_KEY = 'toefl-vocab-chunk-plan-v1';
const CHUNK_SIZE = 30;

function loadChunkPlan() { try { const p = JSON.parse(localStorage.getItem(CHUNK_PLAN_KEY)); return p && Array.isArray(p.words) ? p : null; } catch (e) { return null; } }
function saveChunkPlan(plan) { localStorage.setItem(CHUNK_PLAN_KEY, JSON.stringify(plan)); }
function chunkToday() { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }

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
// 세트 목록은 한 번만 만들고 영구 고정한다: 이미 있으면 절대 다시 만들지 않는다.
// 이후 단어가 마스터되거나 새로 찍음으로 분류돼도 세트의 단어는 바뀌지 않는다.
function createChunkPlan(qMode = bestReviewMode()) {
  const existing = loadChunkPlan();
  if (existing) return existing;
  const words = reviewWordsFor(qMode);
  if (!words.length) return null;
  const plan = { createdAt: Date.now(), locked: true, sourceQuizMode: qMode, size: CHUNK_SIZE, words: words.map(w => w.en), done: {}, last: null };
  saveChunkPlan(plan);
  return plan;
}
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
function frequentWords() {
  return WORDS.map(w => [w, frequentInfo(w.en)]).filter(([, i]) => i.candidate || i.hard)
    .sort((x, y) => (y[1].candidate - x[1].candidate) || y[1].ratio - x[1].ratio || y[1].weighted - x[1].weighted).map(([w]) => w);
}
const baseBuildSession = buildSession;
buildSession = function (size, qMode, srcMode) {
  if (srcMode === 'frequent') return frequentWords().slice(0, size);
  return baseBuildSession(size, qMode, srcMode);
};
// '자주 틀린 단어' 범위로 오늘 암기(같은 날 반복)를 시작한다 — 풀이 방식은 세트와 똑같다.
function startFrequentSession() {
  const candidates = frequentWords().filter(w => !getTodayLearningMeta(w.en).todayMastered).slice(0, CHUNK_SIZE);
  if (!candidates.length) { alert('오늘 할 자주 틀린 단어가 없습니다.'); return false; }
  learningGoalMode = 'same_day'; quizMode = 'typed'; sessionQueue = candidates; sessionIdx = 0;
  sessionStats = {sure:0, vague:0, guess:0, quickRepairs:0, quickRepairSuccess:0, stopped:[]};
  learningState = null; delayedRetries = []; finalReviewQueue = []; finalReviewActive = false;
  sameDayState = {targets: candidates.map(w => w.en), sourceMode: 'frequent', sourceQuizMode: 'flash', chunk: null, nextNewIndex: 0, activityIndex: 0, pending: [], finalQueue: [], current: null, lastEns: [], phase: 'encoding', stats: {firstRecallSuccess:0, quick:0, deep:0, memory:0}};
  candidates.forEach(w => resetTodayLearningIfNeeded(w.en)); saveMeta(); saveSession(); renderCard();
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
  hardCount() { return frequentWords().filter(w => frequentInfo(w.en).candidate).length; },
  startHard: startFrequentSession,
  frequentList() { return frequentWords().map(w => Object.assign({ en: w.en, ko: getCoreMeaning(w), day: w.day, cl: w.cl || null }, frequentInfo(w.en))); },
  // '뜻을 몰랐다'로 킵한 단어가 단어장에 있으면 자주 틀린 단어 후보로 (틀린 날 하나로 셈)
  flagWrong(word) { const hit = __api.lookup(word); if (!hit) return null; const m = getWordMeta(hit.en); m.keepFlagAt = dayKey(); saveMeta(); return hit.en; },
  // 단어장에 있는 단어면 그 상태 ('master' | 'review' | 'new' | 'hard'), 없으면 null
  wordStatus(word) { const hit = __api.lookup(word); return hit ? getGlobalStatus(hit.en) : null; },
  clusters() { return [...new Set(WORDS.map(w => w.cl).filter(Boolean))]; },
  plan: loadChunkPlan,
  createPlan: createChunkPlan,
  chunkCount, nextChunkIndex,
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
