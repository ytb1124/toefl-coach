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
function createChunkPlan(qMode = bestReviewMode()) {
  const words = reviewWordsFor(qMode);
  if (!words.length) return null;
  const plan = { createdAt: Date.now(), sourceQuizMode: qMode, size: CHUNK_SIZE, words: words.map(w => w.en), done: {}, last: null };
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

const __api = {
  hasData() { return QUIZ_MODES.some(m => Object.keys(srsState[m] || {}).length > 0); },
  wordCount() { return WORDS.length; },
  reviewCounts, bestReviewMode,
  plan: loadChunkPlan,
  createPlan: createChunkPlan,
  resetPlan() { localStorage.removeItem(CHUNK_PLAN_KEY); },
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
