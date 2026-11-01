/* 연습 문제 풀이 — 소站 TPO独家 문항을 실전 조건으로 푼다 (오늘 계획·연습실 공용).
 * 원문은 비공개 자료 window.ZHAN_POOL (ZhanData 'pool': 로컬 private/zhan/pool.js 또는 비공개 저장소 pool.json).
 * 공개 번들에는 메타데이터(id·영역·유형·능력)만 있다. 시험 화면 규칙: docs/exam-rules.md.
 * 틀린 문제는 원인(안 들렸다/잊었다/뜻 몰랐다/헷갈렸다/시간 부족)을 고르면 바로 할 일을 보여 주고, 다음 날 계획으로 이어진다 (Engine.causeQueues).
 * 순수 로직(PracticeCore)은 node 테스트에서도 쓴다 (tests/practice.test.js). */
(function (root) {
  'use strict';

  // ---------- pure ----------
  const words = t => (String(t || '').toLowerCase().replace(/[’‘]/g, "'").match(/[a-z0-9]+(?:'[a-z]+)?/g) || []);
  // Word alignment (LCS): every reference word is ok / missing; hyp words not in the reference are extra.
  function align(ref, hyp) {
    const R = words(ref), H = words(hyp);
    const n = R.length, m = H.length;
    const L = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = R[i] === H[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
    const out = []; const extra = [];
    let i = 0, j = 0;
    while (i < n && j < m) {
      if (R[i] === H[j]) { out.push({ w: R[i], ok: true }); i++; j++; }
      else if (L[i + 1][j] >= L[i][j + 1]) { out.push({ w: R[i], ok: false }); i++; }
      else { extra.push(H[j]); j++; }
    }
    while (i < n) out.push({ w: R[i++], ok: false });
    while (j < m) extra.push(H[j++]);
    const ok = out.filter(x => x.ok).length;
    return { words: out, extra, ok, total: n, pct: n ? Math.round(100 * ok / n) : null };
  }
  const wpm = (nWords, ms) => (ms > 0 ? Math.round(nWords / (ms / 60000)) : null);
  function ctestOk(input, prefix, answer) {
    const s = String(input || '').trim().toLowerCase().replace(/[^a-z'-]/g, '');
    const a = String(answer || '').toLowerCase();
    return !!s && (s === a || s === (String(prefix || '').toLowerCase() + a));
  }
  // Passage markers → display text: [[iA]] insert position ■A, [[sA]] sentence tag [A].
  const showPassage = t => String(t || '').replace(/\[\[i([A-Z])\]\]/g, ' ■$1 ').replace(/\[\[s([A-Z])\]\]/g, '[$1] ');
  // Script lines that contain an evidence phrase (index list), for "근거 구간 다시 듣기" and dictation.
  function evidenceLines(lines, evidence) {
    const norm = s => ' ' + words(s).join(' ') + ' ';
    const out = [];
    for (const e of evidence || []) {
      const w = norm(e);
      lines.forEach((l, i) => { if (w.trim() && norm(l.t).includes(w) && !out.includes(i)) out.push(i); });
    }
    return out.sort((a, b) => a - b);
  }
  // [start, end] seconds of lines (needs `at` timestamps); end = next line's start or null (to the end).
  function lineSpan(lines, idx) {
    if (!idx.length) return null;
    const a = lines[idx[0]], b = lines[idx[idx.length - 1] + 1];
    if (!a || a.at == null) return null;
    const r2 = x => Math.round(x * 100) / 100;
    return [r2(Math.max(0, a.at - 0.2)), b && b.at != null ? r2(b.at + 0.1) : null];
  }
  const Core = { words, align, wpm, ctestOk, showPassage, evidenceLines, lineSpan };
  if (typeof module !== 'undefined' && module.exports) { module.exports = Core; return; }
  root.PracticeCore = Core;

  // ---------- UI ----------
  const L = 'ABCDEFGHI';
  const KIND = { ctest: 'C-Test', daily: '일상 지문', academic: '학술 지문', reply: '응답 고르기', conversation: '대화', announcement: '공지', lecture: '강의' };
  const TIER = { transfer: '새 문제 · 실전 조건', mixed: '섞어 풀기 · 새 문제', delayed: '유지 확인 · 새 문제', 'verify-twin': '다시 확인 · 같은 능력의 새 문제 (쌍둥이)', verify: '다시 확인 · 전에 맞힌 문제 (새 문제 정답률 제외)', practice: '연습실 · 새 문제' };
  // 원인 → 바로 할 일 (모든 화면 공통). sec: 어느 영역에서 고를 수 있는지.
  const CAUSE = [
    ['sound', '안 들렸다', 'L', '스크립트만 보여 줍니다. 내일 이 부분을 받아쓰기 → 쉐도잉합니다.'],
    ['memory', '들었는데 잊었다', 'L', '근거 구간만 다시 들어 보세요. 내일 이 세트를 2단계로 다시 듣습니다.'],
    ['vocab', '뜻을 몰랐다', 'RL', '모르는 단어를 눌러 단어장(킵)에 넣으세요. 자주 틀린 단어 후보가 됩니다.'],
    ['judge', '선택지에서 헷갈렸다', 'RL', '이 문제가 노리는 실수를 또 했는지 고르고, 다음에 할 행동을 한 줄로 적으세요. 같은 능력의 새 문제와 비슷한 문제로 다시 확인합니다.'],
    ['time', '시간이 부족했다', 'R', '내일 학술 지문 timed reading이 먼저 나옵니다.'],
  ];
  const RECUR = [['same', '네, 같은 실수를 또 했다'], ['rulefail', '규칙은 아는데 풀 때 못 썼다'], ['other', '아니요, 다른 이유로 틀렸다'], ['unknown', '잘 모르겠다']];
  const CONF = [[1, '찍음'], [2, '보통'], [3, '확신']];

  root.PracticeApp = { create(env) {
    const { h, toast } = env;
    const ap = (el, ...kids) => el.append(...kids.flat(Infinity).filter(x => x != null && x !== false));
    const rc = (el, ...kids) => el.replaceChildren(...kids.flat(Infinity).filter(x => x != null && x !== false));
    const ZD = () => root.ZhanData;
    const ensure = then => ZD().loadAll([['pool', 'ZHAN_POOL']], then);
    let index = null;
    function lookup(id) {
      const P = root.ZHAN_POOL; if (!P) return null;
      if (!index) { index = {}; for (const s of P.sets) { index[s.id] = { set: s, qs: s.qs }; if (s.kind === 'reply') for (const q of s.qs) index[q.id] = { set: s, qs: [q] }; } }
      return index[id] || null;
    }
    let playing = [];
    const stopAll = () => { playing.forEach(a => { try { a.pause(); } catch (e) { /* gone */ } }); playing = []; };
    window.addEventListener('hashchange', stopAll);
    // 새로 재생하기 전에 이 화면에서 재생 중인 소리를 모두 멈춘다 (버튼을 여러 번 눌러도 겹치지 않게)
    function audioEl(path) {
      stopAll();
      return ZD().audioUrl(path).then(url => { const a = new Audio(url); a.preload = 'auto'; playing.push(a); return a; });
    }
    const para = t => String(t || '').split(/\n+/).filter(Boolean).map(x => h('p', null, x));
    const who = sp => (sp === 'N' ? 'Narrator' : sp);
    const scriptBox = (lines, hl) => h('div', { class: 'script' }, (lines || []).map((l, i) => h('p', { class: (hl || []).includes(i) ? 'hl' : '' }, h('b', { class: 'who' }, who(l.sp)), ' ', l.t)));
    const why = q => q.whyKo ? h('p', null, h('span', { class: 'lbl' }, '해설'), ' ', q.whyKo, h('span', { class: 'muted small' }, ' (소站 해설 · AI 번역)'))
      : q.whyZh ? h('details', null, h('summary', { class: 'small' }, '소站 해설 (중국어 원문 · 한국어 번역 없음)'), h('p', { class: 'small' }, q.whyZh)) : h('p', { class: 'muted small' }, '해설 기록 없음');
    const evidence = q => (q.evidence || []).length ? h('p', null, h('span', { class: 'lbl' }, '근거'), ' ', q.evidence.map(e => h('q', null, e)).reduce((a, b) => a.concat([' · ', b]), []).slice(1)) : null;
    function confRow(onPick) {
      const row = h('div', { class: 'row conf' }, h('span', { class: 'small muted' }, '확신도'),
        CONF.map(([v, l]) => h('button', { class: 'tagb', onclick: e => { row.querySelectorAll('.tagb').forEach(x => x.classList.remove('sel')); e.currentTarget.classList.add('sel'); onPick(v); } }, l)));
      return row;
    }
    // Tappable words: '뜻을 몰랐다' → add to 단어 킵 with the sentence.
    function tappable(text, onWord) {
      return h('p', { class: 'tapwords' }, String(text).split(/(\s+)/).map(tok => /\w/.test(tok)
        ? h('span', { class: 'tw', onclick: e => { const w = tok.replace(/^[^A-Za-z]+|[^A-Za-z'-]+$/g, ''); if (!w) return; e.currentTarget.classList.add('kept'); onWord(w, text); } }, tok) : tok));
    }

    // '이번에도 같은 실수?' 질문: 무엇과 같은지(이 문제의 능력·대표 실수·내 규칙)를 먼저 보여 준다.
    function recurAsk(sk, rules) {
      return h('div', null,
        h('p', { class: 'stem' }, sk.name ? `이번에도 '${sk.name}'에서 틀렸나요?` : '이번에도 같은 실수로 틀렸나요?'),
        sk.warning ? h('p', { class: 'small' }, '이 능력에서 자주 하는 실수: ', h('b', null, sk.warning)) : null,
        rules.length ? h('p', { class: 'small' }, '내가 전에 정한 규칙: ', h('b', null, rules[0].rule)) : h('p', { class: 'small muted' }, '이 능력에는 아직 내가 정한 규칙이 없습니다 (아래에 적을 수 있어요).'));
    }

    // After a wrong answer: pick the cause → the immediate action. rec = the logged attempt.
    // ctx.ctest: C-Test에는 선택지가 없어 '선택지에서 헷갈렸다'를 빼고 보여 준다.
    function causePanel(rec, ctx) {
      const wrap = h('div', { class: 'ask cause-pick' });
      const act = h('div');
      const pick = (k, e) => {
        rec.cause = k; env.save();
        wrap.querySelectorAll('.tagb').forEach(x => { x.disabled = true; }); e.currentTarget.classList.add('sel');
        const c = CAUSE.find(x => x[0] === k);
        rc(act, h('p', { class: 'small muted' }, c[3]));
        if (k === 'sound') ap(act, ctx.lines ? scriptBox(ctx.lines, ctx.hl) : ctx.passage ? h('div', { class: 'passage' }, para(ctx.passage)) : null);
        else if (k === 'memory') {
          const span = ctx.lines && ctx.audio ? lineSpan(ctx.lines, ctx.hl || []) : null;
          const b = h('button', { class: 'ghost', onclick: () => {
            b.disabled = true;
            audioEl(ctx.audio).then(a => {
              if (span) { a.currentTime = span[0]; a.ontimeupdate = () => { if (span[1] != null && a.currentTime >= span[1]) { a.pause(); after(); } }; }
              a.onended = after; a.play();
            }).catch(err => { b.textContent = '재생 실패: ' + err.message; after(); });
          } }, span ? '▶ 근거 구간만 다시 듣기' : '▶ 다시 듣기 (이 세트는 문장 시각 기록이 없어 처음부터)');
          const after = () => { if (!act.querySelector('.script')) ap(act, scriptBox(ctx.lines, ctx.hl)); };
          ap(act, ctx.audio ? b : null);
          if (!ctx.audio) after();
        } else if (k === 'vocab') {
          const lines = ctx.lines ? ctx.lines.map(l => l.t) : String(ctx.passage || '').split(/\n+/);
          const idx = ctx.hl && ctx.hl.length ? ctx.hl : lines.map((_, i) => i);
          rec.vocabWords = rec.vocabWords || [];
          ap(act, h('p', { class: 'small' }, '모르는 단어를 누르세요 (여러 개 가능):'),
            idx.slice(0, 12).map(i => tappable(lines[i], (w, sent) => { env.keep(w, sent); rec.vocabWords.push(w); env.save(); })));
        } else if (k === 'judge') {
          const rules = env.rules.get(rec.skill);
          const sk = (env.skill && env.skill(rec.skill)) || {};
          const ta = h('textarea', { class: 'myrule', rows: 2, placeholder: sk.warning ? '예: ' + sk.warning : '예: 정답 근거 문장을 찾은 뒤에 보기를 고른다' }, '');
          ap(act, recurAsk(sk, rules),
            h('div', { class: 'row' }, RECUR.map(([kk, l]) => h('button', { class: 'tagb', onclick: ev => { rec.recur = kk; env.save(); ev.currentTarget.parentNode.querySelectorAll('.tagb').forEach(x => x.classList.remove('sel')); ev.currentTarget.classList.add('sel'); } }, l))),
            h('p', { class: 'small', style: 'margin-top:14px' }, h('b', null, '내 규칙'), ' — 다음에 이런 문제를 만나면 무엇을 할지 내 말로 한 줄 (선택)'),
            ta, h('button', { class: 'link small', onclick: ev => { const v = ta.value.trim(); if (!v) return; env.rules.add(rec.skill, v, rec); ev.currentTarget.textContent = '저장했습니다'; } }, '내 규칙 저장'));
        }
      };
      ap(wrap, h('p', { class: 'stem' }, '왜 틀렸나요?'),
        h('div', { class: 'row' }, CAUSE.filter(c => c[2].includes(ctx.sec) && !(ctx.ctest && c[0] === 'judge')).map(([k, l]) => h('button', { class: 'tagb', onclick: e => pick(k, e) }, l))), act);
      return wrap;
    }

    function header(main, meta, task) {
      ap(main, h('p', { class: 'kicker' }, (meta.sec === 'L' ? '리스닝' : '리딩') + ' · ' + (KIND[meta.kind] || meta.kind),
        ' · ', h('span', { class: 'muted' }, TIER[task.tier] || '')),
      h('p', { class: 'muted small' }, (lookup(meta.id) || {}).set ? lookup(meta.id).set.src : ''));
    }
    const logQ = (meta, task, i, q, correct, conf, answer, t0) => env.log({ item: meta.id, q: i, ref: meta.id + '#' + i, skill: q.skill || meta.skill, tier: task.tier, correct, conf, answer,
      verify: /^verify/.test(task.tier) || undefined, verifyOf: task.verifyOf, exam: true, ms: Date.now() - t0 });

    // ---- main entry: one practice item (task from the plan or the 연습실) ----
    function renderItem(main, task, meta, onDone) {
      ensure(() => {
        const full = lookup(meta.id);
        if (!full) { ap(main, ...ZD().tokenCard(h, { title: '소站 문제를 불러올 수 없습니다', lead: '이 기기에 GitHub 토큰을 넣으면 독점 TPO 원문으로 풉니다.', retry: ok => ensure(() => { ok(!!root.ZHAN_POOL); if (root.ZHAN_POOL) { index = null; rc(main, ); renderItem(main, task, meta, onDone); } }) }),
          h('button', { class: 'ghost', onclick: () => onDone({ skipped: true }) }, '이 문제 건너뛰기')); return; }
        header(main, meta, task);
        if (meta.sec === 'L') listening(main, task, meta, full, onDone);
        else if (meta.kind === 'ctest') ctest(main, task, meta, full, onDone);
        else reading(main, task, meta, full, onDone);
      });
    }

    // 남은 시간 카운트다운 (소站처럼 오른쪽 위 표시, 'Hide Time'으로 숨기기). onEnd: 0이 되면.
    function countdown(sec, onEnd) {
      let left = sec, hidden = false, timer = null;
      const t = h('span', { class: 'cd-time' });
      const fmt = x => '00:' + String(Math.floor(x / 60)).padStart(2, '0') + ':' + String(x % 60).padStart(2, '0');
      const draw = () => { t.textContent = hidden ? '' : fmt(left); };
      const btn = h('button', { class: 'link small', onclick: () => { hidden = !hidden; btn.textContent = hidden ? 'Show Time' : 'Hide Time'; draw(); } }, 'Hide Time');
      const el = h('div', { class: 'cdown' }, t, ' ', btn);
      draw();
      el.start = () => { timer = setInterval(() => { left--; draw(); if (left <= 0) { clearInterval(timer); onEnd && onEnd(); } }, 1000); };
      el.stop = () => clearInterval(timer);
      el.left = () => left;
      return el;
    }

    // Listening (docs/exam-rules.md, 소站 화면): 대화·공지·강의는 음성 동안 문항 없음 → 끝나면 문항 하나씩 20초.
    // 응답 고르기는 질문 문장을 글로 보여 주지 않고, 보기는 재생 중에도 보이며 Next는 음성이 끝난 뒤. 답 없이는 못 넘어가고,
    // 시간이 끝나면 자동으로 다음 문항. 다시 듣기·이전 문항·음성 진행바 없음.
    const Q_SEC = 20;
    function listening(main, task, meta, full, onDone) {
      const box = h('section', { class: 'card' }); ap(main, box);
      const set = full.set, qs = full.qs, reply = meta.kind === 'reply';
      const path = reply ? qs[0].audio : set.audio;
      const notes = reply ? null : h('textarea', { class: 'notes', rows: 4, placeholder: '노트 (대상·특징을 짧게)' });
      const status = h('p', { class: 'listening-status' }, '준비되면 시작을 누르세요.');
      const start = h('button', { class: 'primary' }, '▶ 듣기 시작');
      const answers = [];
      const stage = h('div');
      ap(box, h('p', { class: 'muted small' }, reply ? '실전 조건: 들은 말에 알맞은 응답을 고릅니다. 질문 문장은 글로 나오지 않고, 음성은 한 번만 나옵니다. 음성이 끝나면 20초 안에 답하세요.'
        : '실전 조건: 음성은 한 번만, 끝까지 재생된 뒤 문제가 하나씩 나옵니다 (문항마다 20초). 다시 듣기·이전 문항 없음.'), status, start, stage, notes);
      const fail = msg => { status.textContent = msg; start.disabled = false; start.style.display = ''; ap(box, h('button', { class: 'link small', onclick: () => onDone({ skipped: true }) }, '이 문제 건너뛰기 (기록하지 않음)')); };
      // One question screen. audioEnded: Promise that resolves when the (reply) audio has ended (Next stays off until then).
      function ask(i, audioEnded, next) {
        const q = qs[i]; let sel = null; const t0 = Date.now(); let done = false;
        const nextBtn = h('button', { class: 'primary', disabled: true }, i < qs.length - 1 ? 'Next' : '제출');
        const msg = h('p', { class: 'small warn', hidden: true }, '답을 골라야 넘어갈 수 있습니다.');
        const finish = timeout => {
          if (done) return; done = true; cd.stop();
          const rec = logQ(meta, task, reply ? 0 : i, q, sel === q.answer, timeout && sel == null ? 1 : 2, sel, t0);
          if (timeout) rec.timeout = true;
          answers.push({ q, sel, rec }); next();
        };
        const cd = countdown(Q_SEC, () => finish(true));
        rc(stage, h('div', { class: 'qhead' }, h('span', { class: 'small muted' }, `${i + 1} / ${qs.length}`), cd),
          reply ? null : h('p', { class: 'stem' }, q.stem),
          h('div', { class: 'opts' }, q.choices.map((c, k) => h('button', { class: 'opt', onclick: e => { sel = k; msg.hidden = true; stage.querySelectorAll('.opt').forEach(x => x.classList.remove('sel')); e.currentTarget.classList.add('sel'); } }, c))),
          msg, nextBtn);
        nextBtn.onclick = () => { if (sel == null) { msg.hidden = false; return; } finish(false); };
        cd.hidden = true;
        audioEnded.then(() => { nextBtn.disabled = false; cd.hidden = false; cd.start(); });
      }
      start.onclick = () => {
        start.disabled = true; status.textContent = '불러오는 중…';
        audioEl(path).then(a => {
          const ended = new Promise(res => { a.onended = res; });
          a.onerror = () => fail('음원을 재생하지 못했습니다');
          return a.play().then(() => {
            start.style.display = 'none'; status.textContent = '♪ 듣는 중…';
            if (reply) { ask(0, ended.then(() => { status.textContent = ''; }), review); return; }
            ended.then(() => { status.textContent = ''; let i = 0; const go = () => { if (i < qs.length) { ask(i, Promise.resolve(), () => { i++; go(); }); } else review(); }; go(); });
          });
        }).catch(e => fail(e.message));
      };
      function review() {
        rc(stage, );
        const lines = set.script || (reply ? [{ sp: '', t: qs[0].stem }] : []);
        ap(box, h('h3', null, '결과'));
        for (const { q, sel, rec } of answers) {
          const ok = sel === q.answer;
          const hl = evidenceLines(lines, q.evidence);
          ap(box, h('div', { class: 'fb ' + (ok ? 'good' : 'bad') },
            h('p', { class: 'stem' }, (ok ? '✓ ' : '✗ ') + (q.stem || '')),
            h('p', null, '내 답: ', sel == null ? '— (시간 초과)' : `${L[sel]}. ${q.choices[sel]}`, ' · 정답: ', `${L[q.answer]}. ${q.choices[q.answer]}`),
            ok ? null : causePanel(rec, { sec: 'L', lines, hl, audio: path }),
            evidence(q), why(q)));
        }
        ap(box, h('details', { class: 'transcript' }, h('summary', null, '스크립트 보기'), scriptBox(lines, [])));
        ap(main, h('button', { class: 'primary', onclick: () => onDone({ answers: answers.length, correct: answers.filter(a => a.sel === a.q.answer).length }) }, '다음'));
      }
    }

    // Reading (daily/academic): timed reading (academic: read → '다 읽음' → wpm) → questions with the passage → review.
    function reading(main, task, meta, full, onDone) {
      const box = h('section', { class: 'card' }); ap(main, box);
      const set = full.set, qs = full.qs;
      const text = showPassage(set.passage);
      const t0 = Date.now();
      if (task.timed) {
        const nWords = words(set.passage.replace(/\[\[[is][A-Z]\]\]/g, '')).length;
        ap(box, h('p', { class: 'muted small' }, `Timed reading: 지문을 다 읽으면 '다 읽음'을 누르세요 (${nWords}단어). 읽는 속도(wpm)를 기록한 뒤 문제가 나옵니다.`),
          h('div', { class: 'passage' }, para(text)),
          h('button', { class: 'primary', onclick: e => {
            const ms = Date.now() - t0; const v = wpm(nWords, ms);
            env.logSpeed({ item: meta.id, words: nWords, ms, wpm: v });
            e.currentTarget.remove(); rc(box, h('p', { class: 'small' }, `읽기 속도 ${v} wpm (${Math.round(ms / 1000)}초)`)); questions();
          } }, '다 읽음'));
      } else questions();
      // 소站 화면: 왼쪽 지문 + 문항 하나씩, Next만 (Back 없음), 답 없이 넘어가기 가능.
      function questions() {
        const sel = {}; let i = 0;
        const pass = h('div', { class: 'passage' }, para(text));
        const qcol = h('div', { class: 'qcol' });
        ap(box, h('div', { class: 'split' }, pass, qcol));
        const one = () => {
          const q = qs[i];
          const nextBtn = h('button', { class: 'primary' }, i < qs.length - 1 ? 'Next' : '제출');
          rc(qcol, h('p', { class: 'small muted' }, `${i + 1} / ${qs.length}`), h('p', { class: 'stem' }, q.stem),
            q.type === 'insert' && q.sentence ? h('p', { class: 'insert-s' }, h('b', null, '넣을 문장: '), q.sentence) : null,
            h('div', { class: 'opts' }, q.choices.map((c, k) => h('button', { class: 'opt', onclick: e => { sel[i] = k; qcol.querySelectorAll('.opt').forEach(x => x.classList.remove('sel')); e.currentTarget.classList.add('sel'); } }, c))),
            nextBtn);
          nextBtn.onclick = () => { i++; if (i < qs.length) one(); else finish(); };
        };
        const finish = () => {
          rc(qcol, );
          const recs = qs.map((q, k) => logQ(meta, task, k, q, sel[k] === q.answer, 2, sel[k] == null ? null : sel[k], t0));
          ap(box, h('h3', null, '결과'));
          qs.forEach((q, k) => {
            const ok = sel[k] === q.answer;
            ap(box, h('div', { class: 'fb ' + (ok ? 'good' : 'bad') }, h('p', { class: 'stem' }, (ok ? '✓ ' : '✗ ') + `${k + 1}. ` + q.stem),
              h('p', null, '내 답: ', sel[k] == null ? '— (답 안 함)' : q.choices[sel[k]], ' · 정답: ', q.choices[q.answer]),
              ok ? null : causePanel(recs[k], { sec: 'R', passage: set.passage.replace(/\[\[[is][A-Z]\]\]/g, '') }), evidence(q), why(q)));
          });
          ap(main, h('button', { class: 'primary', onclick: () => onDone({ answers: qs.length, correct: recs.filter(r => r.correct).length }) }, '다음'));
        };
        one();
      }
    }

    // C-Test: type the missing letters (first letters shown) → per-blank result.
    function ctest(main, task, meta, full, onDone) {
      const box = h('section', { class: 'card' }); ap(main, box);
      const set = full.set, qs = full.qs;
      const submit = h('button', { class: 'primary' }, '제출');
      const inputs = {};
      const t0 = Date.now();
      // 빈칸마다 빠진 글자 수만큼 칸 (앞 글자는 지문에 있음). 한 빈칸을 다 채우면 다음 빈칸으로.
      const next = i => () => { const b = inputs[i + 1]; if (b && inputs[i].value().length === qs[i].answer.length) b.focus(); };
      const parts = set.passage.split(/(【\d+】)/);
      const p = h('p', { class: 'ctest-passage' });
      for (const part of parts) {
        const m = part.match(/^【(\d+)】$/);
        if (!m) { p.append(part); continue; }
        const q = qs[+m[1] - 1];
        const i = +m[1] - 1;
        const b = inputs[i] = env.letterBlank('', q.answer, { onChange: next(i), onEnter: () => submit.click() });
        p.append(b.el);
      }
      ap(box, h('p', { class: 'muted small' }, set.src === 'Fill in the blank 자료' ? '출처: Fill in the blank 자료 · 빈칸의 나머지 글자를 입력하세요.' : '빈칸의 나머지 글자를 입력하세요 (앞 글자는 지문에 있음).'), p);
      ap(box, submit);
      setTimeout(() => inputs[0] && inputs[0].focus(), 50);
      submit.onclick = () => {
        submit.remove();
        const recs = qs.map((q, i) => {
          const v = inputs[i].value(); const ok = ctestOk(v, q.prefix, q.answer);
          inputs[i].disable(); inputs[i].mark(ok);
          return env.log({ item: meta.id, q: i, ref: meta.id + '#' + i, skill: q.skill, tier: task.tier, correct: ok, answer: v, conf: 2, verify: /^verify/.test(task.tier) || undefined, verifyOf: task.verifyOf, exam: true, ms: Date.now() - t0 });
        });
        const wrong = qs.map((q, i) => [q, i]).filter(([, i]) => !recs[i].correct);
        ap(box, h('p', { class: 'small' }, `${qs.length - wrong.length} / ${qs.length} 정답`));
        for (const [q, i] of wrong) {
          ap(box, h('div', { class: 'fb bad' }, h('p', null, `${i + 1}. `, h('b', null, q.prefix + q.answer), q.glossKo ? ` (${q.glossKo})` : '', ' · 내 답: ', recs[i].answer ? q.prefix + recs[i].answer : '(비워 둠)'),
            causePanel(recs[i], { sec: 'R', ctest: true, passage: set.passage.replace(/【(\d+)】/g, (m, n) => qs[n - 1].answer) })));
        }
        if (set.noteKo) ap(box, h('p', null, h('span', { class: 'lbl' }, '해설'), ' ', set.noteKo));
        else if (qs[0] && (qs[0].whyKo || qs[0].whyZh)) ap(box, why(qs[0]));
        ap(main, h('button', { class: 'primary', onclick: () => onDone({ answers: qs.length, correct: qs.length - wrong.length }) }, '다음'));
      };
    }

    // ---- 받아쓰기 → 쉐도잉 (원인 '안 들렸다'의 다음 날) ----
    // target: {path, lines(index list) of a pool set or a reply prompt}. Listening is unlimited here (practice, not exam).
    function dictation(main, task, onDone) {
      ensure(() => {
        const full = task.of ? lookup(task.of) : null;
        ap(main, h('p', { class: 'kicker' }, '받아쓰기 → 쉐도잉 · 전에 "안 들렸다"고 고른 부분'));
        const box = h('section', { class: 'card' }); ap(main, box);
        let lines, path, span = null;
        if (full) {
          const set = full.set;
          if (set.kind === 'reply') { const q = full.qs[0]; lines = [{ sp: '', t: q.stem }]; path = q.audio; }
          else {
            const q = full.qs[task.q || 0] || full.qs[0];
            let hl = evidenceLines(set.script, q.evidence);
            if (!hl.length) hl = set.script.map((l, i) => i).filter(i => set.script[i].sp !== 'N').slice(0, 2);
            if (!hl.length) hl = set.script.length > 1 ? [1] : [0];   // 내레이터만 있는 공지: 도입 문장 다음 줄
            // 재생 구간(첫 근거 줄 ~ 마지막 근거 줄)과 받아쓰기 대상 줄을 똑같이: 사이 줄도 포함
            hl = Array.from({ length: Math.max(...hl) - Math.min(...hl) + 1 }, (_, k) => Math.min(...hl) + k);
            lines = hl.map(i => set.script[i]); path = set.audio; span = lineSpan(set.script, hl);
          }
        } else if (task.ref && env.origAudio) {
          const r = env.origAudio(task.ref);
          if (r) { lines = r.lines; path = r.path; span = r.span; }
        }
        if (!lines || !lines.length || !path) {
          ap(box, h('p', { class: 'muted' }, '이 문제는 받아쓰기 자료(스크립트·음원)를 찾지 못했습니다.'), h('button', { class: 'primary', onclick: () => onDone({ followup: task.key }) }, '넘어가기'));
          return;
        }
        const target = lines.map(l => l.t).join(' ');
        const play = h('button', { class: 'ghost' }, span ? '▶ 이 부분 듣기' : '▶ 듣기 (처음부터 — 문장 시각 기록 없음)');
        play.onclick = () => audioEl(path).then(a => { if (span) { a.currentTime = span[0]; a.ontimeupdate = () => { if (span[1] != null && a.currentTime >= span[1]) a.pause(); }; } a.play(); }).catch(e => toast(e.message));
        const ta = h('textarea', { rows: 3, placeholder: `들은 대로 적기 (${words(target).length}단어)` });
        const res = h('div');
        ap(box, h('p', { class: 'muted small' }, '몇 번이든 들어도 됩니다. 들리는 대로 적고 확인하세요.'), play, ta,
          h('button', { class: 'primary', onclick: e => {
            const a = align(target, ta.value);
            env.logDictation({ key: task.key, item: task.of || null, ref: task.ref || null, ok: a.ok, total: a.total, pct: a.pct });
            e.currentTarget.remove();
            ap(res, h('p', null, `단어 정확도 ${a.pct}% (${a.ok}/${a.total})`),
              h('p', { class: 'aligned' }, a.words.map(x => h('span', { class: x.ok ? 'ok' : 'miss' }, x.w + ' '))),
              h('p', { class: 'small muted' }, '빨간 단어가 못 들은 부분입니다. 이제 쉐도잉: 문장을 보며 소리와 동시에 3번 따라 말하세요.'),
              h('div', { class: 'script' }, lines.map(l => h('p', null, l.t))),
              h('button', { class: 'primary', onclick: () => onDone({ followup: task.key }) }, '쉐도잉 3번 했어요'));
          } }, '확인'), res);
      });
    }

    // ---- 2단계 듣기 (원인 '들었는데 잊었다'의 다음 날): 1) 노트 없이 큰 흐름 2) 노트하며 다시 → 틀렸던 문제 다시 ----
    function twoPass(main, task, onDone) {
      ensure(() => {
        const full = task.of ? lookup(task.of) : null;
        ap(main, h('p', { class: 'kicker' }, '2단계 듣기 · 전에 "들었는데 잊었다"고 고른 세트'));
        const box = h('section', { class: 'card' }); ap(main, box);
        if (!full || !full.set.audio) { ap(box, h('p', { class: 'muted' }, '이 세트의 음원을 찾지 못했습니다.'), h('button', { class: 'primary', onclick: () => onDone({ followup: task.key }) }, '넘어가기')); return; }
        const set = full.set; let pass = 0;
        const notes = h('textarea', { class: 'notes', rows: 5, placeholder: '2회차: 대상 → 특징/이유를 짧게' });
        const btn = h('button', { class: 'primary' }, '▶ 1회차: 노트 없이 흐름만 듣기');
        const st = h('p', { class: 'small muted' });
        btn.onclick = () => { btn.disabled = true; audioEl(set.audio).then(a => { a.onended = () => { pass++; btn.disabled = false; if (pass === 1) { btn.textContent = '▶ 2회차: 노트하며 듣기'; ap(box, notes); } else { btn.remove(); again(); } }; a.play(); st.textContent = '듣는 중…'; }).catch(e => toast(e.message)); };
        ap(box, st, btn);
        function again() {
          const q = full.qs[task.q || 0] || full.qs[0];
          let sel = null;
          ap(box, h('p', { class: 'stem' }, q.stem), h('div', { class: 'opts' }, q.choices.map((c, k) => h('button', { class: 'opt', onclick: e => {
            sel = k; box.querySelectorAll('.opt').forEach(x => { x.disabled = true; }); e.currentTarget.classList.add(k === q.answer ? 'right' : 'wrong');
            ap(box, h('p', null, k === q.answer ? '맞혔습니다 (다시 푼 문제라 새 문제 정답률에는 넣지 않음)' : `정답은 ${L[q.answer]}`), evidence(q), scriptBox(set.script, evidenceLines(set.script, q.evidence)),
              h('button', { class: 'primary', onclick: () => onDone({ followup: task.key }) }, '다음'));
          } }, h('b', null, L[k]), ' ', c))));
        }
      });
    }

    return { ensure, lookup, renderItem, dictation, twoPass, KIND, TIER, stopAll, available: () => !!root.ZHAN_POOL };
  } };
})(typeof window !== 'undefined' ? window : globalThis);
