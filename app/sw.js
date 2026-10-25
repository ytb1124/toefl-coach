/* 스피킹·라이팅 파트 — 튜터 피드백(Taebin TOEFL Classes.pdf)에서 반복된 오류로 만든 별도 훈련.
 * 기록은 'toefl-sw-v1' 한 키에만 저장한다 (오늘 훈련 'toeflcoach.v1'·단어 'toefl-vocab-*'와 분리, Sync로 기기 동기화).
 * Routes: #/sw · #/sw/drill · #/sw/lr[/id] · #/sw/bs · #/sw/iv[/id] · #/sw/em[/id] · #/sw/ad[/id] · #/sw/log */
(function () {
  'use strict';
  const KEY = 'toefl-sw-v1';
  const LOG_MAX = 80;

  window.SWApp = { create(env) {
    const { h, toast, go, storage } = env;
    const C = window.CONTENT, S = C.sw, K = window.SWCore;
    const CAT = S.cats;
    const byId = list => Object.fromEntries(list.map(x => [x.id, x]));
    const LR = byId(S.lr), IV = byId(S.interview), EM = byId(S.email), AD = byId(S.discussion), BS = byId(S.buildSentence);
    const now = () => Date.now();
    const today = () => new Date().toDateString();
    const isToday = t => t && new Date(t).toDateString() === today();
    const fmtDate = t => { const d = new Date(t); return (d.getMonth() + 1) + '/' + d.getDate(); };
    const mmss = s => (s < 0 ? '+' : '') + Math.floor(Math.abs(s) / 60) + ':' + String(Math.floor(Math.abs(s) % 60)).padStart(2, '0');
    const srcChip = src => h('span', { class: 'chip ' + (/^튜터/.test(src) ? 'src-tutor' : 'src-ai'), title: /^튜터/.test(src) ? 'PDF에 튜터가 직접 교정·출제한 내용' : 'AI가 만든 연습 (튜터 확인 없음)' }, src);
    const catChip = c => h('span', { class: 'chip cat' }, (CAT[c] || { label: c }).label);

    // ---------- storage ----------
    function blank() { return { v: 1, g: {}, lr: {}, bs: {}, log: [], drafts: {}, prefs: {} }; }
    function load() {
      try { const d = JSON.parse(storage.getItem(KEY) || 'null'); if (d && d.v) return Object.assign(blank(), d); } catch (e) { /* fresh */ }
      return blank();
    }
    function save(mutate) {
      const d = load(); mutate(d);
      if (d.log.length > LOG_MAX) d.log = d.log.slice(-LOG_MAX);
      try { storage.setItem(KEY, JSON.stringify(d)); } catch (e) { toast('저장 실패: ' + e.message); }
      return d;
    }

    // ---------- cleanup on navigation (audio, mic, timers) ----------
    let cleanups = [];
    function cleanup() { cleanups.forEach(f => { try { f(); } catch (e) { /* ignore */ } }); cleanups = []; }
    window.addEventListener('hashchange', cleanup);
    const later = fn => cleanups.push(fn);
    function every(ms, fn) { const t = setInterval(fn, ms); later(() => clearInterval(t)); return t; }

    // ---------- audio: play one line of a built audio set ----------
    const audioEls = {};
    function playLine(setId, line, fallbackText, onEnded) {
      const meta = C.audio[setId];
      const cues = meta ? meta.cues.filter(c => c.line === line) : [];
      if (!meta || !cues.length) return speak(fallbackText, onEnded);
      const a = audioEls[setId] || (audioEls[setId] = new Audio(meta.src));
      const start = Math.max(0, cues[0].start - 0.05), end = cues[cues.length - 1].end + 0.15;
      a.pause(); a.currentTime = start;
      const tick = () => { if (a.currentTime >= end) { a.pause(); a.removeEventListener('timeupdate', tick); onEnded && onEnded(); } };
      a.addEventListener('timeupdate', tick);
      a.onerror = () => { a.removeEventListener('timeupdate', tick); speak(fallbackText, onEnded); };
      a.play().catch(() => { a.removeEventListener('timeupdate', tick); speak(fallbackText, onEnded); });
      later(() => { a.pause(); a.removeEventListener('timeupdate', tick); });
    }
    function speak(text, onEnded) {
      try {
        speechSynthesis.cancel();
        const u = new SpeechSynthesisUtterance(text); u.lang = 'en-US'; u.rate = 0.95; u.onend = () => onEnded && onEnded();
        speechSynthesis.speak(u); later(() => speechSynthesis.cancel());
      } catch (e) { toast('음성을 재생할 수 없습니다'); onEnded && onEnded(); }
    }

    // ---------- microphone: recording + (optional) browser speech recognition ----------
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    const canRecord = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.MediaRecorder);
    function Mic(onText) {
      let rec = null, stream = null, sr = null, chunks = [], finalText = '', interim = '', want = false;
      async function start() {
        if (canRecord) {
          try {
            stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            rec = new MediaRecorder(stream); chunks = [];
            rec.ondataavailable = e => e.data && e.data.size && chunks.push(e.data);
            rec.start();
          } catch (e) { rec = null; if (stream) stream.getTracks().forEach(t => t.stop()); stream = null; }
        }
        if (SR) {
          try {
            sr = new SR(); sr.lang = 'en-US'; sr.continuous = true; sr.interimResults = true;
            sr.onresult = e => {
              interim = '';
              for (let k = e.resultIndex; k < e.results.length; k++) {
                const r = e.results[k];
                if (r.isFinal) finalText += r[0].transcript + ' '; else interim += r[0].transcript;
              }
              onText && onText((finalText + interim).trim());
            };
            sr.onend = () => { if (want) try { sr.start(); } catch (e) { /* ended */ } };
            want = true; sr.start();
          } catch (e) { sr = null; }
        }
        later(abort);
        return { recording: !!rec, recognizing: !!sr };
      }
      function stop() {
        want = false;
        if (sr) try { sr.stop(); } catch (e) { /* ignore */ }
        return new Promise(res => {
          const done = url => setTimeout(() => res({ url, text: (finalText + ' ' + interim).replace(/\s+/g, ' ').trim() }), 450);
          if (rec && rec.state !== 'inactive') {
            rec.onstop = () => {
              const url = chunks.length ? URL.createObjectURL(new Blob(chunks, { type: rec.mimeType || 'audio/webm' })) : null;
              if (stream) stream.getTracks().forEach(t => t.stop());
              done(url);
            };
            rec.stop();
          } else done(null);
        });
      }
      function abort() { want = false; try { sr && sr.abort(); } catch (e) { /* ignore */ } try { rec && rec.state !== 'inactive' && rec.stop(); } catch (e) { /* ignore */ } if (stream) stream.getTracks().forEach(t => t.stop()); }
      return { start, stop, abort };
    }
    const micNote = () => h('p', { class: 'small muted' }, SR
      ? '말하는 동안 브라우저 음성인식이 받아씁니다. 관사·전치사 같은 작은 단어는 음성인식이 틀릴 수 있으니, 내가 실제로 말한 대로 고친 뒤 채점하세요.'
      : canRecord ? '이 브라우저는 자동 받아쓰기를 지원하지 않습니다. 녹음을 들어 보고 말한 그대로 적으세요 (Chrome·Safari는 자동 받아쓰기 가능).'
        : '이 화면에서는 마이크를 쓸 수 없습니다. 소리 내어 말한 뒤 말한 그대로 적으세요.');

    // ---------- shared rendering helpers ----------
    function diffView(ops, { from, to } = {}) {
      // ops from K.diff(target, said); from/to = raw word arrays for display
      const W = (arr, k, fallback) => (arr && arr[k] != null ? arr[k] : fallback);
      return h('p', { class: 'diff' }, ops.map(o => {
        if (o.op === 'eq') return [h('span', null, to ? W(to, o.j, o.b) : W(from, o.i, o.b)), ' '];
        if (o.op === 'del') return [h('del', { title: '빠짐' }, W(from, o.i, o.a)), ' '];
        if (o.op === 'ins') return [h('ins', { title: '추가됨' }, W(to, o.j, o.b)), ' '];
        return [h('del', null, W(from, o.i, o.a)), h('ins', null, W(to, o.j, o.b)), ' '];
      }));
    }
    // Word diff of two texts keeping original spelling/punctuation for display.
    function textDiff(a, b) {
      const ra = String(a).match(/\S+/g) || [], rb = String(b).match(/\S+/g) || [];
      const key = w => K.norm(w) || w;
      return diffView(K.diff(ra.map(key), rb.map(key)), { from: ra, to: rb });
    }
    function marked(text, flags) {
      const out = []; let pos = 0;
      for (const f of flags) {
        if (f.index < pos) continue;
        out.push(text.slice(pos, f.index), h('mark', { class: f.level === 'tip' ? 'tipmark' : '', title: f.msg }, text.slice(f.index, f.index + f.match.length)));
        pos = f.index + f.match.length;
      }
      out.push(text.slice(pos));
      return h('div', { class: 'markedtext' }, out);
    }
    function flagList(flags) {
      if (!flags.length) return h('p', { class: 'good-text' }, '✓ 내 반복 오류 패턴은 발견되지 않았습니다. (모든 오류를 잡는 검사는 아닙니다)');
      return h('ul', { class: 'flags' }, flags.map(f => h('li', { class: f.level === 'tip' ? 'tip' : '' },
        catChip(f.cat), ' ', h('b', null, '“' + f.match + '”'), ' → ', f.msg)));
    }
    function catCounts(flags) { const c = {}; flags.filter(f => f.level !== 'tip').forEach(f => { c[f.cat] = (c[f.cat] || 0) + 1; }); return c; }
    function copyBtn(getText, label) {
      const btn = h('button', { class: 'ghost', onclick: async () => {
        try { await navigator.clipboard.writeText(getText()); toast('복사했습니다'); }
        catch (e) { const ta = h('textarea', { class: 'databox', rows: 6 }); ta.value = getText(); btn.after(ta); ta.select(); toast('복사 권한이 없어 아래 칸에 넣었습니다 — 직접 복사하세요'); }
      } }, label);
      return btn;
    }
    function guideList(lines) { return h('ol', { class: 'guide' }, lines.map(l => h('li', null, l))); }
    const back = (hash, label) => h('a', { class: 'small', href: hash }, '← ' + label);
    // DOM append that skips null/false and flattens arrays (native append would print "null")
    const put = (el, ...kids) => { el.append(...kids.flat(Infinity).filter(k => k != null && k !== false)); return el; };

    // =====================================================================
    // HOME
    // =====================================================================
    function home(main) {
      const d = load(), t = now();
      const queue = K.drillQueue(S.grammar, d.g, t);
      const drilledToday = Object.values(d.g).filter(c => isToday(c.last)).length;
      const lrToday = Object.values(d.lr).flat().some(r => isToday(r.at));
      const nextLr = S.lr.slice().sort((a, b) => lrRank(d, a) - lrRank(d, b))[0];
      const rot = ['iv', 'em', 'ad'][Math.floor(new Date().setHours(0, 0, 0, 0) / 864e5) % 3];
      const rotName = { iv: '인터뷰 1세트 (4문항)', em: '이메일 1개 (7분)', ad: '토론 글 1개 (10분)' }[rot];
      const rotDone = d.log.some(l => l.kind === rot && isToday(l.at));
      const rotNext = nextPrompt(d, rot);

      put(main, h('section', { class: 'card hero' },
        h('h1', null, '스피킹·라이팅'),
        h('p', { class: 'muted' }, '튜터 피드백(8/10–10/22)에서 반복된 오류로 만든 훈련입니다. 오늘 훈련·단어 기록과는 따로 저장됩니다.'),
        h('h2', { class: 'mt' }, '오늘 추천 순서'),
        h('ol', { class: 'routine' },
          routineItem('Listen & Repeat 1세트', lrToday, nextLr ? `다음: ${nextLr.title}` : '', '#/sw/lr/' + nextLr.id, '튜터: “Focus most of your energy practicing here.”'),
          routineItem(`교정 문장 ${queue.length}개`, queue.length === 0 && drilledToday > 0, drilledToday ? `오늘 ${drilledToday}개 함` : '내 실수 문장을 고쳐 쓰기', '#/sw/drill'),
          routineItem(rotName, rotDone, rotNext ? rotNext.label : '', rotNext ? `#/sw/${rot}/${rotNext.id}` : `#/sw/${rot}`, '날마다 인터뷰 → 이메일 → 토론 순서로 바뀝니다'))));

      put(main, weakCard(d));

      const lrDone = S.lr.filter(s => (d.lr[s.id] || []).length).length;
      const mastered = Object.values(d.g).filter(c => c.box >= K.MASTER).length;
      const bsOk = Object.values(d.bs).filter(b => b.lastOk).length;
      const count = k => d.log.filter(l => l.kind === k).length;
      put(main, h('section', { class: 'sw-tiles' },
        tile('#/sw/lr', '스피킹', 'Listen & Repeat', `${lrDone}/${S.lr.length}세트 해 봄`),
        tile('#/sw/iv', '스피킹', '인터뷰 (45초)', `${count('iv')}개 답변`),
        tile('#/sw/drill', '공통', '교정 문장', `${mastered}/${S.grammar.length} 마스터`),
        tile('#/sw/bs', '라이팅', 'Build a Sentence', `${bsOk}/${S.buildSentence.length} 맞힘`),
        tile('#/sw/em', '라이팅', '이메일 (7분)', `${count('em')}개 씀`),
        tile('#/sw/ad', '라이팅', '토론 (10분)', `${count('ad')}개 씀`)));

      put(main, h('details', { class: 'card' }, h('summary', null, '튜터 전략 모음 (PREP · STAR · 이메일 · 토론 템플릿)'),
        h('h3', null, '인터뷰 — 의견 질문: PREP'), guideList(S.guides.prep),
        h('h3', null, '인터뷰 — 경험 질문: STAR'), guideList(S.guides.star),
        h('h3', null, '이메일'), guideList(S.guides.email),
        h('h3', null, '토론'), guideList(S.guides.discussion),
        h('h3', null, '내 토론 템플릿'), h('pre', { class: 'template' }, S.guides.template)));
      put(main, h('p', { class: 'small' }, h('a', { href: '#/sw/log' }, '내가 쓴 글·답변 기록 보기 →')));
    }
    function routineItem(title, done, sub, hash, note) {
      return h('li', { class: done ? 'done' : '' }, h('a', { href: hash }, h('b', null, (done ? '✓ ' : '') + title)),
        sub ? h('span', { class: 'muted small' }, ' · ' + sub) : null, note ? h('div', { class: 'small muted' }, note) : null);
    }
    function tile(hash, kicker, title, sub) { return h('a', { class: 'tile sw-tile', href: hash }, h('div', { class: 'tl' }, kicker), h('div', { class: 'sw-tt' }, title), h('div', { class: 'ts muted' }, sub)); }
    function lrRank(d, s) { const r = d.lr[s.id] || []; if (!r.length) return S.lr.indexOf(s) - 100; const last = r[r.length - 1]; return avg(last.scores) * 10 + (isToday(last.at) ? 100 : 0); }
    const avg = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
    function nextPrompt(d, kind) {
      const list = kind === 'iv' ? S.interview : kind === 'em' ? S.email : S.discussion;
      const n = id => d.log.filter(l => l.kind === kind && l.pid === id).length;
      const p = list.slice().sort((a, b) => n(a.id) - n(b.id))[0];
      return p && { id: p.id, label: kind === 'iv' ? p.title : kind === 'em' ? 'To ' + p.to + ' · ' + p.subject : (p.prof.text.split(/[.?]/)[0].slice(0, 60) + '…') };
    }
    function weakCard(d) {
      const tutor = {}, mine = {};
      S.grammar.filter(g => /^튜터/.test(g.src)).forEach(g => { tutor[g.cat] = (tutor[g.cat] || 0) + 1; });
      const since = now() - 14 * K.DAY;
      for (const [id, c] of Object.entries(d.g)) { const g = S.grammar.find(x => x.id === id); if (g && c.bad) mine[g.cat] = (mine[g.cat] || 0) + c.bad; }
      d.log.filter(l => l.at >= since).forEach(l => Object.entries(l.cats || {}).forEach(([k, v]) => { mine[k] = (mine[k] || 0) + v; }));
      const keys = Object.keys(CAT).filter(k => tutor[k] || mine[k]).sort((a, b) => ((mine[b] || 0) * 2 + (tutor[b] || 0)) - ((mine[a] || 0) * 2 + (tutor[a] || 0))).slice(0, 7);
      const max = Math.max(1, ...keys.map(k => (tutor[k] || 0) + (mine[k] || 0)));
      const anyMine = Object.keys(mine).length > 0;
      return h('section', { class: 'card' }, h('h2', null, '내 반복 오류'),
        h('p', { class: 'small muted' }, '회색 = 튜터가 PDF에서 교정한 문장 수 (확인된 사실) · 색 = 내가 이 앱에서 틀린 횟수 + 최근 14일 글·답변 검사에서 걸린 횟수' + (anyMine ? '' : ' (아직 기록 없음)')),
        keys.map(k => h('div', { class: 'hbar sw-hbar' }, h('span', null, CAT[k].label),
          h('span', { class: 'hb stack' }, h('i', { class: 'tutor', style: `width:${100 * (tutor[k] || 0) / max}%` }), h('i', { class: 'mine', style: `width:${100 * (mine[k] || 0) / max}%` })),
          h('span', { class: 'small' }, `${tutor[k] || 0}${mine[k] ? ' · ' + mine[k] : ''}`))),
        h('details', null, h('summary', { class: 'small' }, '유형별 규칙 보기'), h('ul', { class: 'small' }, keys.map(k => h('li', null, h('b', null, CAT[k].label), ' — ', CAT[k].tip)))));
    }

    // =====================================================================
    // 교정 문장 (correction drill, spaced review)
    // =====================================================================
    let drill = null;
    function viewDrill(main) {
      if (!drill || drill.done) {
        const d = load();
        const q = K.drillQueue(S.grammar, d.g, now());
        if (!q.length) {
          put(main, back('#/sw', '스피킹·라이팅'), h('section', { class: 'card' }, h('h1', null, '오늘 교정 문장 완료'),
            h('p', null, '오늘 복습할 문장이 없습니다. 틀린 문장은 다음 날, 맞힌 문장은 1·3·7·14·30일 간격으로 다시 나옵니다.'),
            h('button', { class: 'ghost', onclick: () => { drill = { list: S.grammar.slice().sort(() => Math.random() - 0.5).slice(0, 10), idx: 0, res: [], retry: [], extra: true }; render(); } }, '그래도 10문장 더 (기록은 남지만 일정은 그대로)')));
          return;
        }
        drill = { list: q, idx: 0, res: [], retry: [] };
      }
      const all = drill.list.concat(drill.retry);
      if (drill.idx >= all.length) return drillEnd(main);
      const g = all[drill.idx], isRetry = drill.idx >= drill.list.length;
      const card = h('section', { class: 'card' });
      put(main, h('div', { class: 'swbar' }, back('#/sw', '나가기'), h('span', { class: 'small muted' }, `${drill.idx + 1} / ${all.length}${isRetry ? ' · 다시 한 번' : ''}`)), card);
      const input = h('textarea', { class: 'answer', rows: 3, spellcheck: 'false', autocapitalize: 'off', autocomplete: 'off' });
      input.value = g.wrong;
      const fb = h('div');
      const submit = h('button', { class: 'primary', onclick: check }, '확인');
      put(card, h('div', { class: 'row tight' }, catChip(g.cat), srcChip(g.src)),
        h('p', { class: 'stem' }, '틀린 부분을 고쳐 쓰세요'), h('p', { class: 'wrongline' }, g.wrong), input,
        h('p', { class: 'small muted' }, '힌트: ' + CAT[g.cat].tip), submit, fb);
      input.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if (!submit.disabled) check(); } });
      setTimeout(() => input.focus(), 30);
      function check() {
        const ok = K.matchAnswer(input.value, g.answers);
        submit.disabled = true; input.readOnly = true;
        const prev = load().g[g.id];
        const record = correct => {
          if (isRetry || drill.extra) return;
          save(d => { d.g[g.id] = K.review(prev, correct, now()); });
        };
        const answer = ok ? g.answers.find(a => K.norm(a) === K.norm(input.value)) : K.nearest(input.value, g.answers);
        put(fb, h('div', { class: 'fb ' + (ok ? 'good' : 'bad') },
          h('p', { class: 'rule' }, ok ? '✓ 맞았습니다' : '✗ 다시 보기'),
          ok ? null : [h('p', { class: 'small muted' }, '내 답 → 정답 (빨강 = 빼기, 초록 = 넣기)'), textDiff(input.value, answer)],
          h('p', null, h('span', { class: 'lbl' }, '정답'), ' ', g.answers[0]),
          g.answers.length > 1 ? h('p', { class: 'small muted' }, '다른 정답: ' + g.answers.slice(1).join(' / ')) : null,
          g.note ? h('p', { class: 'small' }, g.note) : null));
        drill.res.push({ id: g.id, ok, retry: isRetry });
        record(ok);
        if (!ok && !isRetry) drill.retry.push(g);
        const nextBtn = h('button', { class: 'primary', onclick: () => { drill.idx++; render(); } }, '다음');
        put(fb, nextBtn);
        if (!ok) put(fb, h('button', { class: 'link small', onclick: e => {
          const r = drill.res[drill.res.length - 1]; r.ok = true;
          if (!isRetry) { drill.retry.pop(); record(true); }
          e.target.replaceWith(h('span', { class: 'small muted' }, '맞음으로 처리했습니다'));
        } }, '내 답도 맞는 표현이에요 (맞음 처리)'));
        setTimeout(() => nextBtn.focus(), 30);
      }
    }
    function drillEnd(main) {
      const first = drill.res.filter(r => !r.retry);
      const ok = first.filter(r => r.ok).length;
      const wrongCats = {};
      first.filter(r => !r.ok).forEach(r => { const c = S.grammar.find(g => g.id === r.id).cat; wrongCats[c] = (wrongCats[c] || 0) + 1; });
      drill.done = true;
      put(main, back('#/sw', '스피킹·라이팅'), h('section', { class: 'card' }, h('h1', null, `교정 문장 ${ok} / ${first.length}`),
        Object.keys(wrongCats).length ? [h('p', null, '틀린 유형:'), h('ul', null, Object.entries(wrongCats).map(([c, n]) => h('li', null, h('b', null, CAT[c].label + ` ${n}개`), ' — ', CAT[c].tip)))]
          : h('p', null, '모두 맞았습니다.'),
        h('p', { class: 'small muted' }, drill.extra ? '추가 연습이라 복습 일정은 바뀌지 않았습니다.' : '틀린 문장은 내일 다시 나옵니다.'),
        h('a', { class: 'primary as-btn', href: '#/sw' }, '스피킹·라이팅 홈으로')));
    }

    // =====================================================================
    // Listen & Repeat
    // =====================================================================
    let lr = null;
    function viewLrList(main) {
      const d = load();
      put(main, back('#/sw', '스피킹·라이팅'), h('h1', null, 'Listen & Repeat'),
        h('p', { class: 'muted small' }, '7문장, 점점 길어집니다. 듣고 바로 똑같이 따라 말하기 — 뜻이 아니라 소리를 그대로. 문장마다 튜터처럼 0–5점으로 채점합니다.'),
        S.lr.map(s => {
          const r = d.lr[s.id] || [], last = r[r.length - 1];
          return h('a', { class: 'card listrow', href: '#/sw/lr/' + s.id }, h('div', null, h('b', null, s.title), ' ', srcChip(s.src)),
            h('div', { class: 'small muted' }, last ? `${r.length}회 · 최근 ${fmtDate(last.at)}: ${last.scores.map(x => '0' + x).join(' ')}` : '아직 안 함'));
        }));
    }
    function viewLr(main, id) {
      const set = LR[id];
      if (!set) return go('#/sw/lr');
      if (!lr || lr.id !== id || lr.finished) lr = { id, idx: 0, scores: [], cats: {}, exam: null, saidLog: [] };
      if (lr.exam === null) {
        put(main, back('#/sw/lr', '세트 목록'), h('section', { class: 'card' }, h('h1', null, set.title), srcChip(set.src),
          h('p', null, '실전처럼 한 번만 듣고 따라 말할까요, 연습으로 여러 번 들을까요?'),
          micNote(),
          h('button', { class: 'primary', onclick: () => { lr.exam = true; render(); } }, '실전 (문장당 1회 듣기)'),
          h('button', { class: 'ghost wide', onclick: () => { lr.exam = false; render(); } }, '연습 (다시 듣기 가능)')));
        return;
      }
      if (lr.idx >= set.sentences.length) return lrEnd(main, set);
      const i = lr.idx, raw = set.sentences[i], target = raw.replace(/\s*\/\s*/g, ' ');
      const card = h('section', { class: 'card' });
      put(main, h('div', { class: 'swbar' }, back('#/sw/lr', '나가기'), h('span', { class: 'small muted' }, `${set.title} · 문장 ${i + 1} / ${set.sentences.length}${lr.exam ? ' · 실전' : ' · 연습'}`)), card);
      let plays = 0, heard = false;
      const said = h('textarea', { class: 'answer', rows: 2, spellcheck: 'false', autocapitalize: 'off', placeholder: '내가 말한 그대로 (음성인식 결과를 고치거나 직접 입력)' });
      const status = h('p', { class: 'small muted' });
      const recBox = h('div');
      const playBtn = h('button', { class: 'play big', onclick: play }, '▶');
      const micBtn = h('button', { class: 'ghost wide', disabled: true, onclick: toggleMic }, '🎙 따라 말하기 시작');
      const scoreBtn = h('button', { class: 'primary', disabled: true, onclick: score }, '채점');
      const out = h('div');
      put(card, h('div', { class: 'lr-play' }, playBtn, h('div', null, h('b', null, '듣기'), h('div', { class: 'small muted' }, lr.exam ? '한 번만 들을 수 있습니다' : '여러 번 들을 수 있습니다 (실전은 1회)'))),
        micBtn, status, recBox, said, scoreBtn, out);
      said.addEventListener('input', () => { scoreBtn.disabled = !said.value.trim(); });
      function play() {
        if (lr.exam && plays >= 1) return;
        plays++; playBtn.disabled = true; playBtn.textContent = '♪';
        playLine('SW-' + set.id, i, target, () => {
          heard = true; playBtn.textContent = '▶'; playBtn.disabled = lr.exam && plays >= 1;
          micBtn.disabled = false; status.textContent = '바로 따라 말하세요.';
          if (!SR && !canRecord) said.focus();
        });
      }
      let mic = null;
      async function toggleMic() {
        if (!mic) {
          mic = Mic(t => { said.value = t; scoreBtn.disabled = !t; });
          const st = await mic.start();
          if (!st.recording && !st.recognizing) { mic = null; status.textContent = '마이크를 쓸 수 없습니다 (권한을 확인하세요). 말한 그대로 적어 주세요.'; micBtn.disabled = true; said.focus(); return; }
          micBtn.textContent = '■ 말하기 끝'; micBtn.classList.add('rec'); status.textContent = st.recognizing ? '듣는 중… 다 말했으면 끝을 누르세요.' : '녹음 중… (자동 받아쓰기는 지원되지 않음)';
        } else {
          micBtn.disabled = true; status.textContent = '정리 중…';
          const r = await mic.stop(); mic = null;
          micBtn.textContent = '🎙 다시 말하기'; micBtn.classList.remove('rec'); micBtn.disabled = false;
          if (r.text) said.value = r.text;
          status.textContent = r.text ? '받아쓴 내용을 확인하고, 내가 실제로 말한 대로 고친 뒤 채점하세요.' : '말한 그대로 적어 주세요.';
          recBox.innerHTML = '';
          if (r.url) put(recBox, h('audio', { controls: true, src: r.url, class: 'myrec' }));
          scoreBtn.disabled = !said.value.trim();
        }
      }
      function score() {
        if (mic) return;
        const r = K.lrScore(target, said.value);
        lr.scores[i] = r.score; lr.saidLog[i] = said.value;
        Object.entries(r.cats).forEach(([k, v]) => { lr.cats[k] = (lr.cats[k] || 0) + v; });
        scoreBtn.remove(); said.readOnly = true; micBtn.disabled = true;
        put(out, h('div', { class: 'fb ' + (r.score >= 4 ? 'good' : 'bad') },
          h('p', { class: 'lr-score' }, '0' + r.score, h('span', { class: 'muted small' }, ' / 05')),
          h('p', { class: 'small muted' }, '원문 기준: 빨강 = 빠뜨림, 초록 = 다르게 말함·덧붙임'),
          diffView(r.ops, { from: target.split(/\s+/).length === K.tokens(target).length ? target.split(/\s+/) : null }),
          Object.keys(r.cats).length ? h('ul', { class: 'small' }, Object.entries(r.cats).map(([k, v]) => h('li', null, K.LR_CAT[k] + (v > 1 ? ` ×${v}` : '')))) : null,
          h('p', { class: 'small' }, h('span', { class: 'lbl' }, '덩어리'), ' ', raw.split(/\s*\/\s*/).join('  ▏ ')),
          h('button', { class: 'ghost', onclick: () => playLine('SW-' + set.id, i, target) }, '▶ 원문 다시 듣기'),
          h('button', { class: 'primary', onclick: () => { lr.idx++; render(); } }, i + 1 < set.sentences.length ? '다음 문장' : '결과 보기')));
      }
    }
    function lrEnd(main, set) {
      if (!lr.finished) { lr.finished = true; save(d => { (d.lr[set.id] = d.lr[set.id] || []).push({ at: now(), scores: lr.scores, cats: lr.cats, exam: lr.exam }); }); }
      const tops = Object.entries(lr.cats).sort((a, b) => b[1] - a[1]);
      const longAvg = avg(lr.scores.slice(4)), shortAvg = avg(lr.scores.slice(0, 4));
      put(main, back('#/sw/lr', '세트 목록'), h('section', { class: 'card' }, h('h1', null, set.title + ' 결과'),
        h('ol', { class: 'scores' }, lr.scores.map((s, k) => h('li', null, h('b', null, '0' + s), ' ', h('span', { class: 'small muted' }, set.sentences[k].replace(/\s*\/\s*/g, ' '))))),
        h('p', null, `1–4번 평균 ${shortAvg.toFixed(1)} · 5–7번(긴 문장) 평균 ${longAvg.toFixed(1)}`),
        tops.length ? [h('p', null, '이번 세트에서 많았던 것:'), h('ul', null, tops.map(([k, v]) => h('li', null, K.LR_CAT[k] + ` ${v}회`)))] : h('p', null, '모두 정확했습니다.'),
        h('p', { class: 'small muted' }, longAvg < shortAvg - 0.5 ? '긴 문장에서 점수가 떨어집니다 — 덩어리(▏)마다 리듬째 기억하고, 마지막 덩어리를 먼저 반복해 보세요.' : '튜터: chunking + 다양한 억양으로 반복.'),
        h('a', { class: 'primary as-btn', href: '#/sw/lr' }, '다른 세트'),
        h('button', { class: 'ghost wide', onclick: () => { lr = null; render(); } }, '이 세트 다시')));
    }

    // =====================================================================
    // Build a Sentence
    // =====================================================================
    let bs = null;
    function viewBs(main) {
      if (!bs || bs.done) {
        const d = load();
        const rank = b => { const r = d.bs[b.id]; return !r ? 0 : r.lastOk ? 2 + (r.ok || 0) : 1; };
        const list = S.buildSentence.slice().sort((a, b) => rank(a) - rank(b) || (Math.random() - 0.5)).slice(0, 10);
        bs = { list, idx: 0, ok: 0, start: now(), placed: [] };
      }
      if (bs.idx >= bs.list.length) return bsEnd(main);
      const q = bs.list[bs.idx];
      const left = 7 * 60 - (now() - bs.start) / 1000;
      const clock = h('span', { class: 'small muted' }, '⏱ ' + mmss(left));
      every(1000, () => { const l = 7 * 60 - (now() - bs.start) / 1000; clock.textContent = '⏱ ' + mmss(l) + (l < 0 ? ' 초과' : ''); clock.classList.toggle('warn', l < 0); });
      put(main, h('div', { class: 'swbar' }, back('#/sw', '나가기'), h('span', { class: 'small muted' }, `${bs.idx + 1} / ${bs.list.length}`), clock));
      const tiles = K.shuffle(q.answer.concat(q.extra || []), q.id);
      const used = new Array(tiles.length).fill(false);
      let placed = [];
      const card = h('section', { class: 'card' });
      put(main, card);
      const sentence = h('p', { class: 'bs-sentence' }), pool = h('div', { class: 'bs-pool' }), fb = h('div');
      const checkBtn = h('button', { class: 'primary', disabled: true, onclick: check }, '확인');
      put(card, h('div', { class: 'row tight' }, srcChip(q.src), h('span', { class: 'chip cat' }, q.point)),
        h('p', { class: 'bs-ctx' }, h('span', { class: 'lbl' }, 'A'), ' ', q.context),
        h('p', { class: 'small muted' }, 'B의 대답을 완성하세요. 타일을 누르면 빈칸에 들어가고, 빈칸을 누르면 빠집니다. 쓰지 않는 단어가 하나 있을 수 있습니다.'),
        sentence, pool, checkBtn, fb);
      let locked = false;
      function draw() {
        sentence.innerHTML = '';
        let k = 0;
        for (const part of q.template.split(/(_)/)) {
          if (part !== '_') { if (part) put(sentence, part); continue; }
          const slot = k++, t = placed[slot];
          put(sentence, h('button', { class: 'bs-slot' + (t != null ? ' filled' : ''), disabled: locked, onclick: () => { if (t == null) return; used[t] = false; placed[slot] = null; draw(); } }, t != null ? tiles[t] : '　'));
        }
        pool.innerHTML = '';
        tiles.forEach((w, t) => put(pool, h('button', { class: 'word bs-tile', disabled: locked || used[t], onclick: () => {
          const slot = [...Array(q.answer.length).keys()].find(s => placed[s] == null);
          if (slot == null) return; placed[slot] = t; used[t] = true; draw();
        } }, w)));
        checkBtn.disabled = locked || placed.filter(x => x != null).length !== q.answer.length;
      }
      draw();
      function check() {
        locked = true; draw();
        const mine = placed.map(t => tiles[t]);
        const ok = K.bsCorrect(q.answer, mine);
        if (ok) bs.ok++;
        save(d => { const r = d.bs[q.id] || { ok: 0, bad: 0 }; r[ok ? 'ok' : 'bad']++; r.lastOk = ok; r.last = now(); d.bs[q.id] = r; });
        let k = 0; const answerText = q.template.replace(/_/g, () => q.answer[k++]);
        put(fb, h('div', { class: 'fb ' + (ok ? 'good' : 'bad') }, h('p', { class: 'rule' }, ok ? '✓ 정답 (1점)' : '✗ 0점 — 한 칸이라도 틀리면 0점'),
          h('p', null, h('span', { class: 'lbl' }, '정답'), ' ', answerText.charAt(0).toUpperCase() + answerText.slice(1)),
          (q.extra || []).length ? h('p', { class: 'small muted' }, '남는 단어: ' + q.extra.join(', ')) : null,
          h('p', { class: 'small' }, q.point),
          h('button', { class: 'primary', onclick: () => { bs.idx++; render(); } }, '다음')));
      }
    }
    function bsEnd(main) {
      bs.done = true;
      const secs = (now() - bs.start) / 1000;
      put(main, back('#/sw', '스피킹·라이팅'), h('section', { class: 'card' }, h('h1', null, `Build a Sentence ${bs.ok} / ${bs.list.length}`),
        h('p', null, `걸린 시간 ${mmss(secs)} (실전 10문제 7분)`),
        h('p', { class: 'small muted' }, '자주 나오는 문법: 부정문, 의문문 도치, wh-의문문의 조동사, 간접의문문(도치 취소), 관계절.'),
        h('button', { class: 'primary', onclick: () => { bs = null; render(); } }, '10문제 더'),
        h('a', { class: 'ghost wide as-btn', href: '#/sw' }, '스피킹·라이팅 홈으로')));
    }

    // =====================================================================
    // Interview (45 seconds)
    // =====================================================================
    let iv = null;
    function viewIvList(main) {
      const d = load();
      put(main, back('#/sw', '스피킹·라이팅'), h('h1', null, '인터뷰'),
        h('p', { class: 'muted small' }, '질문 4개, 각 45초. 최소 30초는 말하기. 의견 질문은 PREP, 경험 질문은 STAR (과거형!).'),
        S.interview.map(s => {
          const n = d.log.filter(l => l.kind === 'iv' && l.pid === s.id).length;
          return h('a', { class: 'card listrow', href: '#/sw/iv/' + s.id }, h('div', null, h('b', null, s.title), ' ', srcChip(s.src)),
            h('div', { class: 'small muted' }, n ? `${n}개 답변함` : '아직 안 함'));
        }));
    }
    function viewIv(main, id) {
      const set = IV[id];
      if (!set) return go('#/sw/iv');
      if (!iv || iv.id !== id) iv = { id, qi: 0, phase: 'ready' };
      if (iv.qi >= set.qs.length) {
        put(main, back('#/sw/iv', '세트 목록'), h('section', { class: 'card' }, h('h1', null, set.title + ' 끝'),
          h('p', null, '4문항을 모두 답했습니다. 기록 탭에서 다시 볼 수 있습니다.'),
          h('a', { class: 'primary as-btn', href: '#/sw/log' }, '기록 보기'), h('button', { class: 'ghost wide', onclick: () => { iv = null; render(); } }, '이 세트 다시')));
        return;
      }
      const q = set.qs[iv.qi], prefs = load().prefs;
      const card = h('section', { class: 'card' });
      put(main, h('div', { class: 'swbar' }, back('#/sw/iv', '나가기'), h('span', { class: 'small muted' }, `${set.title} · ${iv.qi + 1} / ${set.qs.length}`)), card);
      const showText = prefs.ivText !== false;
      const qText = h('p', { class: 'stem' + (showText ? '' : ' hidden-q') }, q.q);
      const toggle = h('label', { class: 'small muted check' }, h('input', { type: 'checkbox', checked: showText, onchange: e => { save(d => { d.prefs.ivText = e.target.checked; }); qText.classList.toggle('hidden-q', !e.target.checked); } }), ' 질문 글자 보기');
      put(card, h('div', { class: 'row tight' }, h('span', { class: 'chip cat' }, q.type), srcChip(set.src)), qText, toggle);
      if (iv.phase === 'ready') {
        put(card, micNote(), h('button', { class: 'primary', onclick: () => {
          iv.phase = 'listen'; render();
        } }, '▶ 질문 듣기 → 바로 45초 시작'));
        return;
      }
      if (iv.phase === 'listen') {
        put(card, h('p', { class: 'muted' }, '질문을 듣는 중…'));
        playLine('SW-' + set.id, iv.qi, q.q, () => { if (iv.phase === 'listen') { iv.phase = 'speak'; render(); } });
        return;
      }
      if (iv.phase === 'speak') {
        const t0 = now();
        const big = h('div', { class: 'countdown' }, '0:45');
        const live = h('p', { class: 'small muted live' });
        const mic = Mic(t => { live.textContent = t; });
        let stopping = false;
        const stop = async () => {
          if (stopping) return; stopping = true;
          const secs = Math.min(45, (now() - t0) / 1000);
          const r = await mic.stop();
          iv.result = { secs, text: r.text, url: r.url }; iv.phase = 'review'; render();
        };
        put(card, h('p', { class: 'small' }, q.type === 'STAR' ? 'S 상황 → T 할 일 → A 한 일 → R 결과 (과거형)' : 'P 결론 → R 이유 → E 예시 → P 결론'), big, live,
          h('button', { class: 'primary', onclick: stop }, '■ 답변 끝'));
        mic.start().then(st => { if (!st.recording && !st.recognizing) live.textContent = '녹음·받아쓰기를 쓸 수 없습니다. 소리 내어 말하고, 끝나면 말한 내용을 적어 주세요.'; });
        every(250, () => { const left = 45 - (now() - t0) / 1000; big.textContent = mmss(Math.max(0, left)); big.classList.toggle('warn', left <= 10); if (left <= 0) stop(); });
        return;
      }
      // review
      const r = iv.result;
      const ta = h('textarea', { class: 'answer', rows: 5, spellcheck: 'false', placeholder: '내가 말한 내용 (음성인식 결과를 고치거나 직접 적기)' });
      ta.value = r.text || '';
      const out = h('div');
      const checks = (q.type === 'STAR' ? S.guides.star : S.guides.prep).map(l => h('label', { class: 'check' }, h('input', { type: 'checkbox' }), ' ', l));
      checks.push(h('label', { class: 'check' }, h('input', { type: 'checkbox' }), ' 첫 문장에서 입장(또는 상황)을 분명히 말했다'));
      put(card, h('p', null, h('b', null, `말한 시간 ${Math.round(r.secs)}초`), r.secs < 30 ? h('span', { class: 'warn' }, ' — 30초 이상 말하기') : ' ✓'),
        r.url ? h('audio', { controls: true, src: r.url, class: 'myrec' }) : null,
        h('p', { class: 'small muted' }, '녹음은 이 화면에서만 들을 수 있고 저장되지 않습니다. 글로 적은 내용만 기록됩니다.'),
        ta, h('button', { class: 'ghost', onclick: analyse }, '내 반복 오류 검사'), out,
        h('h3', null, '셀프 체크'), h('div', { class: 'checks' }, checks),
        q.plan ? h('details', null, h('summary', { class: 'small' }, '튜터 수업 메모 보기'), h('p', { class: 'small' }, q.plan)) : null,
        h('button', { class: 'primary', onclick: () => {
          const flags = K.scan(ta.value, S.scan, 'iv');
          save(d => { d.log.push({ kind: 'iv', pid: set.id, qi: iv.qi, q: q.q, at: now(), secs: Math.round(r.secs), text: ta.value.trim(), words: K.wordCount(ta.value), cats: catCounts(flags), checks: checks.filter(c => c.querySelector('input').checked).length + '/' + checks.length }); });
          iv.qi++; iv.phase = 'ready'; iv.result = null; render();
        } }, iv.qi + 1 < set.qs.length ? '저장하고 다음 질문' : '저장하고 끝'));
      function analyse() { const flags = K.scan(ta.value, S.scan, 'iv'); out.innerHTML = ''; put(out, marked(ta.value, flags), flagList(flags)); }
      if (ta.value) analyse();
    }

    // =====================================================================
    // Writing: Email (7 min) · Academic Discussion (10 min)
    // =====================================================================
    const W = {
      em: { name: '이메일', min: 7, words: [100, 130], list: () => S.email, get: id => EM[id] },
      ad: { name: '토론', min: 10, words: [120, 140], list: () => S.discussion, get: id => AD[id] },
    };
    let wr = null;
    function viewWList(main, kind) {
      const d = load(), cfg = W[kind];
      put(main, back('#/sw', '스피킹·라이팅'), h('h1', null, cfg.name + ` (${cfg.min}분)`),
        h('p', { class: 'muted small' }, kind === 'em' ? '요구사항 3개 모두 + 각각 설명 한 문장. 100–130단어, 2–3문단, 정중하게.' : '교수 질문에 정확히 답하고, 구체적 예시와 "그래서?" 한 문장. 120–140단어.'),
        cfg.list().map(p => {
          const n = d.log.filter(l => l.kind === kind && l.pid === p.id).length;
          const title = kind === 'em' ? `To ${p.to} · ${p.subject}` : p.prof.text.split(/(?<=[.?])\s/).filter(s => /\?/.test(s))[0] || p.prof.text.slice(0, 80);
          return h('a', { class: 'card listrow', href: `#/sw/${kind}/${p.id}` }, h('div', null, h('b', null, title)),
            h('div', { class: 'small muted' }, srcChip(p.src), p.date ? ` 수업 ${p.date}` : '', p.tutor ? ' · 튜터 교정본 있음' : p.fix ? ' · AI 교정본 있음' : p.mine ? ' · 당시 내 글 있음' : '', n ? ` · ${n}번 씀` : ''));
        }));
    }
    function promptBlock(kind, p) {
      if (kind === 'em') return h('div', { class: 'passage' }, h('p', null, p.scenario),
        h('p', null, h('b', null, `Write an email to ${p.to}. In your email, do the following:`)), h('ul', null, p.tasks.map(t => h('li', null, t))),
        h('p', { class: 'small muted' }, `To: ${p.to} · Subject: ${p.subject}`));
      return h('div', { class: 'passage' }, h('p', null, h('b', null, p.prof.name + ': '), p.prof.text),
        p.students.map(s => h('p', { class: 'student' }, h('b', null, s.name + ': '), s.text)));
    }
    function viewW(main, kind, id) {
      const cfg = W[kind], p = cfg.get(id);
      if (!p) return go('#/sw/' + kind);
      if (!wr || wr.key !== kind + id) wr = { key: kind + id, phase: 'intro' };
      const card = h('section', { class: 'card' });
      put(main, h('div', { class: 'swbar' }, back('#/sw/' + kind, '목록'), h('span', { class: 'small muted' }, cfg.name)), card);
      put(card, h('div', { class: 'row tight' }, srcChip(p.src), p.src === 'AI 재구성' ? h('span', { class: 'small muted' }, 'PDF에 문제 원문이 없어 내 글을 바탕으로 다시 쓴 문제') : null), promptBlock(kind, p));
      if (p.note) put(card, h('p', { class: 'hint small' }, p.note));
      const draft = load().drafts[wr.key] || '';
      if (wr.phase === 'intro') {
        put(card, h('button', { class: 'primary', onclick: () => { wr.phase = 'write'; wr.start = now(); render(); } }, `시작 (${cfg.min}:00 타이머)`),
          draft ? h('button', { class: 'ghost wide', onclick: () => { wr.phase = 'write'; wr.start = now(); wr.resume = true; render(); } }, '저장된 초안 이어 쓰기') : null,
          kind === 'ad' ? h('details', null, h('summary', { class: 'small' }, '내 토론 템플릿'), h('pre', { class: 'template' }, S.guides.template)) : null);
        return;
      }
      if (wr.phase === 'write') {
        const ta = h('textarea', { class: 'essay', rows: 14, spellcheck: 'false', autocorrect: 'off', autocapitalize: 'sentences', placeholder: kind === 'em' ? `Dear ${p.to},` : '' });
        ta.value = wr.resume ? draft : (wr.text || '');
        const wc = h('span', { class: 'small' }), clock = h('span', { class: 'small' });
        const bar = h('div', { class: 'writebar' }, clock, wc);
        const upd = () => { const n = K.wordCount(ta.value); wc.textContent = `${n}단어 (목표 ${cfg.words[0]}–${cfg.words[1]})`; wc.className = 'small ' + (n >= cfg.words[0] ? 'good-text' : ''); };
        let saveT = null;
        ta.addEventListener('input', () => { upd(); wr.text = ta.value; clearTimeout(saveT); saveT = setTimeout(() => save(d => { d.drafts[wr.key] = ta.value; }), 800); });
        later(() => { clearTimeout(saveT); if (wr && wr.phase === 'write' && ta.value) save(d => { d.drafts[wr.key] = ta.value; }); });
        const tick = () => { const left = cfg.min * 60 - (now() - wr.start) / 1000; clock.textContent = left >= 0 ? '⏱ ' + mmss(left) : `⏱ 시간 종료 ${mmss(left)} 초과 (실전이면 여기서 제출)`; clock.className = 'small ' + (left < 60 ? 'warn' : ''); };
        tick(); upd(); every(1000, tick);
        put(card, bar, ta, h('p', { class: 'small muted' }, '시험처럼 맞춤법 밑줄이 꺼져 있습니다. 제출 후 검토 단계에서 켜집니다.'),
          h('button', { class: 'primary', onclick: () => {
            wr.text = ta.value; wr.secs = (now() - wr.start) / 1000; wr.phase = 'review';
            save(d => { d.drafts[wr.key] = ta.value; d.log.push({ kind, pid: p.id, at: now(), secs: Math.round(wr.secs), text: ta.value, words: K.wordCount(ta.value), cats: catCounts(K.scan(ta.value, S.scan, kind)) }); wr.logAt = d.log[d.log.length - 1].at; });
            render();
          } }, '제출하고 검토'));
        setTimeout(() => ta.focus(), 30);
        return;
      }
      // review
      const ta = h('textarea', { class: 'essay', rows: 12, spellcheck: 'true' });
      ta.value = wr.text || '';
      const out = h('div');
      const tasks = (kind === 'em' ? p.tasks : ['교수 질문에 정확히 답했다 (주제 문장이 질문의 핵심 명사와 맞음)', '다른 학생 의견을 반복하지 않고 내 내용을 더했다', '이름·장소·숫자가 있는 구체적 예시가 있다', '"그래서 어떻게 되는가" 문장이 있다'])
        .map(t => h('label', { class: 'check' }, h('input', { type: 'checkbox' }), ' ', t));
      put(card, h('h2', null, '검토'), out,
        h('h3', null, kind === 'em' ? '요구사항 3개를 모두 썼나요?' : '셀프 체크'), h('div', { class: 'checks' }, tasks),
        h('h3', null, '고쳐 쓰기 (맞춤법 밑줄 켜짐)'), h('p', { class: 'small muted' }, '실전 마지막 1분 검토 연습: 철자 → 수일치 → 전치사 순서로.'), ta,
        h('div', { class: 'row' }, h('button', { class: 'ghost', onclick: () => { wr.text = ta.value; analyse(); save(d => { d.drafts[wr.key] = ta.value; const l = d.log.find(x => x.at === wr.logAt); if (l) { l.text2 = ta.value; } }); toast('다시 검사했습니다'); } }, '다시 검사'),
          copyBtn(() => `[${kind === 'em' ? 'TOEFL Email' : 'TOEFL Academic Discussion'}] ${p.id}\n\n${kind === 'em' ? p.scenario + '\nTasks:\n- ' + p.tasks.join('\n- ') : p.prof.name + ': ' + p.prof.text}\n\n--- My answer (${K.wordCount(ta.value)} words) ---\n${ta.value}`, '튜터·Claude에게 보낼 글 복사')));
      if (p.tutor) put(card, h('details', { class: 'card inner' }, h('summary', null, '그때 튜터가 고친 곳 (당시 내 글 → 튜터 교정본)'),
        h('p', { class: 'small muted' }, '빨강 = 튜터가 뺀 것, 초록 = 튜터가 넣은 것'), textDiff(p.mine, p.tutor)));
      else if (p.fix) put(card, h('details', { class: 'card inner' }, h('summary', null, '그때 내 글 → AI 교정본 (튜터 확인 없음)'),
        h('p', { class: 'small muted' }, '빨강 = 뺀 것, 초록 = 넣은 것'), textDiff(p.mine, p.fix),
        h('p', { class: 'small muted' }, '당시 내 글의 반복 오류 검사 결과:'), flagList(K.scan(p.mine, S.scan, kind))));
      else if (p.mine) put(card, h('details', { class: 'card inner' }, h('summary', null, '그때 내가 쓴 글 (PDF에 튜터 교정본 없음)'), h('pre', { class: 'essaytext' }, p.mine),
        h('p', { class: 'small muted' }, '내 반복 오류 검사 결과:'), flagList(K.scan(p.mine, S.scan, kind))));
      put(card, h('button', { class: 'primary', onclick: () => { save(d => { delete d.drafts[wr.key]; }); wr = null; go('#/sw/' + kind); } }, '끝내기 (초안 지우기)'),
        h('button', { class: 'ghost wide', onclick: () => { save(d => { delete d.drafts[wr.key]; }); wr = { key: kind + id, phase: 'intro' }; render(); } }, '같은 문제 처음부터 다시'));
      function analyse() {
        const text = ta.value, flags = K.scan(text, S.scan, kind);
        const n = K.wordCount(text), paras = K.paragraphs(text);
        const has = re => re.test(text);
        const auto = kind === 'em' ? [
          [n >= cfg.words[0], `단어 수 ${n} (목표 ${cfg.words[0]}–${cfg.words[1]})`],
          [paras >= 3, `문단 ${paras}개 (인사·본문·맺음 포함 3개 이상 권장)`],
          [has(/^\s*(Dear|Hi|Hello)\b/i), '받는 사람 인사 (Dear …,)'],
          [has(/(Best regards|Sincerely|Kind regards|Best wishes|Thank you)/i), '맺음말 (Best regards, …)'],
          [has(/(would it be possible|please let me know|I would appreciate|I would be grateful|could you|would you)/i), '정중한 요청 표현'],
        ] : [
          [n >= cfg.words[0], `단어 수 ${n} (목표 ${cfg.words[0]}–${cfg.words[1]})`],
          [has(/\b(I believe|I think|I lean toward|I agree|I disagree|In my opinion|I strongly)/i), '입장 문장'],
          [has(/\b(For example|For instance|such as)\b/i), '예시 표시 (For example …)'],
          [has(/\bbecause\b|\bThis is because\b/i), '이유 (because …)'],
          [p.students.some(s => text.includes(s.name)), '다른 학생 언급 (토론 참여)'],
        ];
        const tm = (wr.secs || 0);
        out.innerHTML = '';
        put(out, h('p', { class: 'small' }, `쓴 시간 ${mmss(tm)} / ${cfg.min}:00`, tm > cfg.min * 60 ? h('span', { class: 'warn' }, ' (시간 초과)') : ''),
          h('ul', { class: 'autochk' }, auto.map(([ok, label]) => h('li', { class: ok ? 'ok' : 'no' }, (ok ? '✓ ' : '✗ ') + label))),
          h('h3', null, '내 반복 오류 검사'), marked(text, flags), flagList(flags));
      }
      analyse();
    }

    // =====================================================================
    // 기록
    // =====================================================================
    function viewLog(main) {
      const d = load();
      const name = { iv: '인터뷰', em: '이메일', ad: '토론' };
      const title = l => l.kind === 'iv' ? l.q : l.kind === 'em' ? (EM[l.pid] ? 'To ' + EM[l.pid].to + ' · ' + EM[l.pid].subject : l.pid) : (AD[l.pid] ? AD[l.pid].prof.name : l.pid);
      put(main, back('#/sw', '스피킹·라이팅'), h('h1', null, '기록'),
        h('p', { class: 'small muted' }, `최근 ${LOG_MAX}개까지 저장 (녹음 파일은 저장하지 않음).`),
        d.log.length ? d.log.slice().reverse().map(l => h('details', { class: 'card' },
          h('summary', null, h('b', null, name[l.kind]), ` ${fmtDate(l.at)} · ${l.words}단어${l.secs != null ? ' · ' + mmss(l.secs) : ''} · `, h('span', { class: 'muted' }, title(l)),
            Object.keys(l.cats || {}).length ? h('div', { class: 'small' }, Object.entries(l.cats).map(([k, v]) => [catChip(k), ` ${v} `])) : null),
          h('pre', { class: 'essaytext' }, l.text2 || l.text || '(내용 없음)'),
          l.text2 && l.text2 !== l.text ? h('details', null, h('summary', { class: 'small' }, '처음 제출본과 비교'), textDiff(l.text, l.text2)) : null))
          : h('p', { class: 'muted' }, '아직 기록이 없습니다.'));
    }

    // ---------- router ----------
    let renderFn = null;
    const render = () => renderFn && renderFn();
    function view(main, parts, rerender) {
      cleanup();
      renderFn = rerender;
      const [mode, id] = parts;
      main.classList.add('sw');
      if (!S) { put(main, h('p', null, '스피킹·라이팅 콘텐츠가 없습니다 (tools/build.py를 다시 실행하세요).')); return; }
      if (mode === 'drill') return viewDrill(main);
      if (mode === 'lr') return id ? viewLr(main, id) : viewLrList(main);
      if (mode === 'bs') return viewBs(main);
      if (mode === 'iv') return id ? viewIv(main, id) : viewIvList(main);
      if (mode === 'em' || mode === 'ad') return id ? viewW(main, mode, id) : viewWList(main, mode);
      if (mode === 'log') return viewLog(main);
      return home(main);
    }
    // true while something unsaved is on screen (writing, speaking) — the shell then skips remote re-renders
    function busy() { return !!((wr && wr.phase === 'write') || (iv && (iv.phase === 'speak' || iv.phase === 'review'))); }
    return { view, busy };
  } };
})();
