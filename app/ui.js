/* UI — one clear action per screen. Views: 오늘 / 세션 / 변화 / Skill 상세 / 원본 오답 / 설정 */
(function () {
  'use strict';
  const C = window.CONTENT;
  const E = window.Engine;
  let D = Store.blank(); // replaced by the synced record once Sync is ready (see boot at the bottom)
  const app = document.getElementById('app');
  const SKILL = Object.fromEntries(C.skills.map(s => [s.id, s]));
  const ORIG = Object.fromEntries(C.originals.map(o => [o.id, o]));
  const LETTERS = 'ABCD';
  const CONF = [['1', '찍음'], ['2', '보통'], ['3', '확신']];

  // ---------- tiny DOM helper ----------
  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (k === 'html') el.innerHTML = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const k of kids.flat(Infinity)) if (k != null && k !== false) el.append(k.nodeType ? k : document.createTextNode(String(k)));
    return el;
  }
  const save = () => Store.save(D);
  const now = () => Date.now();
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  function fmtDate(t) { const d = new Date(t); return (d.getMonth() + 1) + '월 ' + d.getDate() + '일'; }
  function chip(state) { return h('span', { class: 'chip st-' + state }, E.STATE_LABEL[state]); }
  function dots(list) {
    return h('span', { class: 'dots', title: '새 문제 결과 (오래된 → 최근)' },
      list.length ? list.map(a => h('i', { class: a.correct ? 'ok' : 'no' })) : h('span', { class: 'muted' }, '아직 없음'));
  }
  function para(text) { return String(text).split('\n').map(line => h('p', null, line)); }

  // ---------- audio player ----------
  function Player(audioId, opts) {
    const meta = C.audio[audioId];
    const maxPlays = opts.maxPlays || Infinity;
    let plays = opts.plays || 0;
    const audio = new Audio(meta && !meta.private ? meta.src : '');
    audio.preload = 'auto';
    // 재구성 음성(원본 오답 스크립트)은 비공개 자료: 로컬 파일 또는 토큰으로 받은 blob
    if (meta && meta.private && window.ZhanData) ZhanData.audioUrl(meta.src).then(u => { audio.src = u; }).catch(() => { info.textContent = '음원은 비공개 자료라 이 기기에서 불러오지 못했습니다'; });
    const bar = h('div', { class: 'bar' }, h('div', { class: 'fill' }));
    const time = h('span', { class: 'time' }, meta && meta.dur ? fmtSec(meta.dur) : '');
    const info = h('span', { class: 'muted small' });
    const btn = h('button', { class: 'play', 'aria-label': '재생' }, '▶');
    const wrap = h('div', { class: 'player' }, btn, h('div', { class: 'pbody' }, bar, h('div', { class: 'prow' }, time, info)));
    function fmtSec(s) { s = Math.round(s); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); }
    function refresh() {
      const left = maxPlays - plays;
      if (maxPlays === Infinity) info.textContent = plays ? `${plays}회 들음 · 다시 듣기 가능` : '연습 모드 · 다시 듣기 가능';
      else info.textContent = left > 0 ? '실전처럼 한 번만 재생' : '재생이 끝났습니다 (실전처럼 한 번만)';
      btn.disabled = maxPlays === Infinity ? false : (!audio.paused || left <= 0);
    }
    btn.onclick = () => {
      if (!meta) return;
      if (!audio.paused) { audio.pause(); btn.textContent = '▶'; return; }
      if (audio.ended || audio.currentTime === 0) { if (plays >= maxPlays) return; plays++; opts.onPlay && opts.onPlay(plays); }
      audio.play().catch(() => { info.textContent = '재생하지 못했습니다. audio 폴더를 확인하세요'; });
      btn.textContent = maxPlays === Infinity ? '❚❚' : '♪';
      refresh(); // exam condition: button stays disabled while playing (no pause / re-listen)
    };
    audio.ontimeupdate = () => { if (audio.duration) bar.firstChild.style.width = (100 * audio.currentTime / audio.duration) + '%'; time.textContent = fmtSec(audio.currentTime) + ' / ' + fmtSec(audio.duration || 0); };
    audio.onended = () => { btn.textContent = '▶'; audio.currentTime = 0; refresh(); opts.onEnded && opts.onEnded(plays); };
    audio.onerror = () => { info.textContent = '음원을 불러오지 못했습니다'; opts.onError && opts.onError(); };
    if (!meta) info.textContent = '음원 없음';
    refresh();
    wrap.stop = () => { audio.pause(); };
    return wrap;
  }
  let activePlayers = [];
  function stopAudio() { activePlayers.forEach(p => p.stop && p.stop()); activePlayers = []; }

  function transcript(audioId, highlight) {
    const meta = C.audio[audioId];
    if (!meta) return null;
    const hl = (highlight || []).filter(Boolean).flatMap(e => e.split(/…|\.\.\./)).map(s => s.trim()).filter(s => s.length > 8);
    const lines = meta.lines.map(l => {
      let t = esc(l.t);
      for (const frag of hl) { const i = t.toLowerCase().indexOf(esc(frag).toLowerCase()); if (i >= 0) t = t.slice(0, i) + '<mark>' + t.slice(i, i + esc(frag).length) + '</mark>' + t.slice(i + esc(frag).length); }
      const who = { N: 'Narrator', W: 'Woman', M: 'Man', W2: 'Woman', M2: 'Man' }[l.v] || '';
      return h('p', { html: `<b class="who">${who}</b> ${t}` });
    });
    return h('details', { class: 'transcript' }, h('summary', null, '스크립트 보기'), meta.note ? h('p', { class: 'muted small' }, meta.note) : null, lines);
  }

  // ---------- routing ----------
  function go(hash) { location.hash = hash; }
  // 화면마다 등록된 정리 리스너(타이머·오디오 멈춤)가 먼저 돌고 나서 새 화면을 그린다.
  // 바로 그리면, 나중에 등록된 정리 리스너가 방금 만든 새 화면의 타이머를 지운다 (쓰기 타이머가 멈추던 버그).
  window.addEventListener('hashchange', () => setTimeout(render, 0));
  function render() {
    stopAudio();
    if (P) P.stopAll();
    if (SP) SP.stopAll();
    if (WR) WR.stopAll();
    if (HK) HK.stopAll();
    const [, view, arg, arg2] = (location.hash || '#/').split('/');
    app.innerHTML = '';
    window.scrollTo(0, 0);
    if (view !== 'vocab' && V) { V.deactivate(); vocabMode = 'home'; }
    if (view === 'do' || view === 'session') return viewDo();
    app.append(nav(view || ''));
    const main = h('main', { class: 'page' });
    app.append(main);
    if (view === 'progress') viewProgress(main);
    else if (view === 'skill') viewSkill(main, arg);
    else if (view === 'orig') viewOriginal(main, arg);
    else if (view === 'settings') viewSettings(main);
    else if (view === 'tests') viewTests(main);
    else if (view === 'room') viewRoom(main, arg, arg2);
    else if (view === 'wrong') viewWrong(main);
    else if (view === 'write') {
      const back = () => go('#/write');
      if (arg === 'bs' && arg2) write().bs(main, decodeURIComponent(arg2), back);
      else if (arg === 'fix') write().fix(main, {}, back);
      else write().room(main, C, go);
    }
    else if (view === 'hk') {
      if (arg) hackers().run(main, { task: decodeURIComponent(arg) }, () => go('#/hk'));
      else hackers().room(main, go);
    }
    else if (view === 'speak') {
      if (arg === 'lr' && arg2) speak().lr(main, { set: decodeURIComponent(arg2) }, () => go('#/speak'));
      else if (arg === 'iv' && arg2) speak().interview(main, { q: decodeURIComponent(arg2) }, () => go('#/speak'));
      else speak().room(main, C, go);
    }
    else if (view === 'mock') viewMock(main, arg, arg2);
    else if (view === 'vocab') viewVocab(main);
    else if (view === 'sw') swApp().view(main, (location.hash || '').split('/').slice(2), render);
    else if (view === 'listen') listenApp().view(main, (location.hash || '').split('/').slice(2), render);
    else if (view === 'read') readApp().view(main, (location.hash || '').split('/').slice(2));
    else if (view === 'ko') koApp().view(main, (location.hash || '').split('/').slice(2));
    else if (view === 'keep') keepApp().view(main, render);
    else viewToday(main);
  }
  // 탭 5개: 오늘 · 연습실 · 오답 · 변화 · 설정 (단어·리딩·리스닝·말하기·쓰기 화면은 연습실/오답에서 들어감)
  const TAB_OF = { '': '', do: '', room: 'room', speak: 'room', write: 'room', vocab: 'room', sw: 'room', keep: 'room', mock: 'room', wrong: 'wrong', tests: 'wrong', read: 'wrong', listen: 'wrong', ko: 'wrong', skill: 'wrong', orig: 'wrong', progress: 'progress', settings: 'settings' };
  function nav(cur) {
    const tab = TAB_OF[cur] != null ? TAB_OF[cur] : cur;
    const link = (hash, label, key) => h('a', { href: hash, class: tab === key ? 'on' : '' }, label);
    return h('header', { class: 'nav' }, h('div', { class: 'brandbox' }, h('span', { class: 'brand' }, 'TOEFL 교정 코치'), syncLabel()),
      h('nav', null, link('#/', '오늘', ''), link('#/room', '연습실', 'room'), link('#/wrong', '오답', 'wrong'), link('#/progress', '변화', 'progress'), link('#/settings', '설정', 'settings')));
  }

  // ---------- sync status ----------
  function syncLabel() {
    const st = window.Sync ? Sync.status() : { mode: 'local', label: '이 기기에만 저장' };
    const title = st.mode === 'cloud' ? 'claude.ai 계정에 저장되어 어느 기기에서 열어도 이어집니다' : st.mode === 'jsonbin' ? 'jsonbin에 저장되어 동기화 코드를 넣은 모든 기기에서 이어집니다' : '설정의 기기 동기화에서 연결할 수 있습니다';
    return h('a', { href: '#/settings', class: 'sync sync-' + st.mode + (st.error ? ' sync-err' : ''), id: 'sync-label', title }, st.label);
  }

  // ---------- device sync settings (jsonbin, outside claude.ai) ----------
  function copyButton(getText, label) {
    return h('button', { class: 'ghost', onclick: async e => {
      const b = e.currentTarget;
      try { await navigator.clipboard.writeText(getText()); b.textContent = '복사됨'; } catch (err) { b.textContent = '아래 칸을 길게 눌러 복사하세요'; }
    } }, label);
  }
  function syncCard() {
    const J = window.Sync && Sync.jsonbin;
    if (!J) return null;
    const st = Sync.status();
    if (st.mode === 'cloud') return h('section', { class: 'card' }, h('h2', null, '기기 동기화'),
      h('p', { class: 'small muted' }, 'claude.ai 계정에 저장되어, claude.ai에 로그인된 모든 기기에서 이어집니다. 따로 설정할 것이 없습니다.'));
    const msg = h('p', { class: 'small', role: 'status' });
    if (J.configured()) {
      const code = J.code();
      return h('section', { class: 'card' }, h('h2', null, '기기 동기화', h('span', { class: 'muted small' }, 'jsonbin')),
        h('p', { class: 'small' }, '상태: ', h('b', null, st.label), st.error ? h('span', { class: 'warn' }, ' · ' + st.error) : null),
        h('p', { class: 'small muted' }, '다른 기기에서 설정의 기기 동기화에 아래 동기화 코드를 한 번 붙여넣으면 같은 기록으로 이어집니다. 코드에는 jsonbin 키가 들어 있으니 다른 사람에게 보내지 마세요.'),
        h('details', null, h('summary', null, '동기화 코드 보기'), h('textarea', { id: 'sync-code-out', class: 'databox', rows: 3, readonly: true }, code), copyButton(() => code, '코드 복사')),
        h('div', { class: 'row' },
          h('button', { class: 'ghost', onclick: () => Sync.flush().then(() => { msg.textContent = Sync.status().error ? '저장 실패: ' + Sync.status().error : '저장했습니다.'; }) }, '지금 저장'),
          confirmButton('이 기기 연결 해제', '한 번 더 누르면 이 기기만 연결이 끊깁니다 (기록은 남음)', 'link small', () => { J.disconnect(); location.reload(); })),
        msg);
    }
    const codeIn = h('textarea', { id: 'sync-code-in', class: 'databox', rows: 3, placeholder: 'TCSYNC1.…' });
    const keyIn = h('input', { id: 'sync-key', type: 'password', autocomplete: 'off', placeholder: 'jsonbin X-Master-Key' });
    const created = h('div');
    return h('section', { class: 'card' }, h('h2', null, '기기 동기화'),
      h('p', { class: 'small muted' }, '지금은 이 브라우저에만 저장됩니다. jsonbin.io를 연결하면 휴대폰·다른 컴퓨터에서도 같은 기록으로 이어집니다. 기기마다 한 번만 하면 됩니다.'),
      h('h3', null, '다른 기기에서 이미 설정했다면'),
      codeIn,
      h('p', { class: 'warn small' }, '연결하면 이 기기에 있던 기록은 공유 기록으로 대체됩니다.'),
      h('button', { class: 'ghost', onclick: e => {
        const b = e.currentTarget; b.disabled = true; msg.textContent = '확인하는 중…';
        J.connectWithCode(codeIn.value).then(() => location.reload()).catch(err => { b.disabled = false; msg.textContent = '연결 실패: ' + err.message; });
      } }, '동기화 코드로 연결'),
      h('h3', null, '처음 설정하는 기기라면'),
      h('p', { class: 'small muted' }, 'jsonbin.io에 로그인한 뒤 API Keys에서 X-Master-Key를 복사해 넣으세요. 이 기기에 있는 기록으로 저장소를 만들고, 다른 기기에 넣을 동기화 코드를 보여 줍니다.'),
      keyIn,
      h('button', { class: 'ghost', onclick: e => {
        const b = e.currentTarget; b.disabled = true; msg.textContent = '저장소를 만드는 중…';
        J.createWithKey(keyIn.value).then(code => {
          msg.textContent = '';
          keyIn.value = '';
          created.replaceChildren(h('div', { class: 'fb good' },
            h('p', null, h('b', null, '연결했습니다.'), ' 다른 기기에서는 설정의 기기 동기화에 이 코드를 한 번 붙여넣으세요.'),
            h('textarea', { id: 'sync-code-new', class: 'databox', rows: 3, readonly: true }, code),
            h('div', { class: 'row' }, copyButton(() => code, '코드 복사'), h('button', { class: 'primary', onclick: () => location.reload() }, '완료'))));
        }).catch(err => { b.disabled = false; msg.textContent = '만들기 실패: ' + err.message; });
      } }, '저장소 만들고 연결'),
      created, msg);
  }

  // ---------- toast (the viewer blocks alert()) ----------
  const toastBox = h('div', { class: 'toast', role: 'status', hidden: true });
  document.body.append(toastBox);
  let toastTimer = null;
  function toast(msg) { toastBox.textContent = msg; toastBox.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { toastBox.hidden = true; }, 4000); }

  // ---------- SPEAKING·WRITING: separate part with its own record 'toefl-sw-v1' (app/sw.js) ----------
  let SW = null;
  const swApp = () => SW || (SW = SWApp.create({ h, toast, go, storage: window.Sync || localStorage }));

  // ---------- LISTENING: 소站 TPO独家 오답 세트를 원본 음원으로 다시 풀기 (app/listen.js, 데이터는 로컬 전용) ----------
  let LS = null;
  // link: the same wrong questions exist as '오늘 훈련' originals (sec L) — show their skill/history and log listening-tab answers as original attempts.
  const origLink = {
    info(id) {
      const o = ORIG[id]; if (!o) return null;
      const A = D.attempts.filter(a => a.tier === 'original' && a.ref === id);
      const last = A.reduce((m, a) => (!m || a.at > m.at ? a : m), null);
      return { skill: SKILL[o.skill] ? SKILL[o.skill].name : null, n: A.length, ok: A.filter(a => a.correct).length, lastOk: last ? last.correct : null, lastAt: last ? last.at : 0 };
    },
    log(id, correct, choiceText) {
      const o = ORIG[id]; if (!o) return;
      const norm = t => String(t || '').toLowerCase().replace(/[^a-z]/g, '');
      const i = (o.options || []).findIndex(t => norm(t) === norm(choiceText));
      // C-Test 원본은 입력한 단어 그대로, 객관식은 같은 보기 문장의 인덱스로 남긴다
      logAttempt({ ref: id, skill: o.skill, tier: 'original', correct, answer: o.ctest ? String(choiceText || '') : i >= 0 ? i : null, src: o.sec === 'R' ? 'read' : 'listen' });
    },
  };
  const listenApp = () => LS || (LS = ListenApp.create({ h, toast, go, storage: window.Sync || localStorage, link: origLink }));
  let RD = null;
  const readApp = () => RD || (RD = ReadApp.create({ h, toast, go, storage: window.Sync || localStorage, link: origLink, letterBlank }));
  // 단어 킵: 어느 화면에서든 영어 단어를 선택해 저장 (app/keep.js). 단어장에 있으면 뜻을 채운다.
  let KP = null;
  const keepApp = () => KP || (KP = KeepWords.create({ h, toast, storage: window.Sync || localStorage,
    lookup: w => { const api = vocabApp(); return api && api.lookup ? api.lookup(w) : null; } }));
  let KO = null;
  const koApp = () => KO || (KO = KoTrialApp.create({ h, toast, go, storage: window.Sync || localStorage }));

  // ---------- PRACTICE: 소站 문제 풀이 (app/practice.js) ----------
  let P = null;
  const practice = () => P || (P = PracticeApp.create({ h, toast, save, letterBlank, skill: id => SKILL[id], log: a => logAttempt(a),
    keep: (w, sent) => { keepApp().add(w, sent); const v = vocabApp(); if (v && v.flagWrong) v.flagWrong(w); },
    rules: { get: skill => myRules(skill), add: (skill, rule, rec) => { D.skillRules = D.skillRules || []; D.skillRules.push({ skill, rule, at: now(), from: rec && (rec.item || rec.ref) }); save(); } },
    logDictation: r => { D.dictation = D.dictation || []; D.dictation.push(Object.assign({ at: now() }, r)); save(); },
    origPool: ref => (ORIG[ref] && ORIG[ref].zq) || null,
    origEvidence: ref => (ORIG[ref] && ORIG[ref].evidence) || null,
    // 받아쓰기 대상 = 재생 구간(o.seg)에 들어가는 문장만 (구간이 없으면 세트 전체를 처음부터)
    origAudio: ref => { const o = ORIG[ref]; const m = o && o.audio && C.audio[o.audio]; if (!m || !m.lines) return null;
      const cues = o.seg ? (m.cues || []).filter(c => c.end > o.seg[0] + 0.1 && c.start < o.seg[1] - 0.1) : [];
      const lines = cues.length ? cues.map(c => ({ sp: (m.lines[c.line] || {}).v, t: c.t })) : m.lines.map(l => ({ sp: l.v, t: l.t }));
      return { lines, path: m.src, span: cues.length ? o.seg : null }; } }));

  // ---------- SPEAKING: 소站 L&R · Interview (app/speak.js) ----------
  let SP = null;
  const speak = () => SP || (SP = SpeakApp.create({ h, toast, log: a => logAttempt(a), scanRules: () => C.sw.scan,
    logSpeak: r => { D.speak = D.speak || []; D.speak.push(Object.assign({ at: now() }, r)); save(); } }));

  // ---------- WRITING: 소站 BS · 반복 오류 고쳐 쓰기 (app/write.js) ----------
  let WR = null;
  const write = () => WR || (WR = WriteApp.create({ h, toast, log: a => logAttempt(a), scanRules: () => C.sw.scan, cats: () => C.sw.cats,
    tutorGrammar: cats => C.sw.grammar.filter(g => /^튜터/.test(g.src || '') && cats.includes(g.cat)),
    writingLog: () => D.writing || [],
    logWriting: r => { D.writing = D.writing || []; D.writing.push(Object.assign({ at: now() }, r)); save(); } }));
  // 해커스 모범답안 라벨 재구성 (app/hackers.js, 기록은 같은 writing[]에 kind 'hk')
  let HK = null;
  const hackers = () => HK || (HK = HackersApp.create({ h, toast, scanRules: () => C.sw.scan, writingLog: () => D.writing || [],
    logWriting: r => { D.writing = D.writing || []; D.writing.push(Object.assign({ at: now() }, r)); save(); } }));

  // ---------- VOCAB: the original word page's '오늘 암기' flow, run unchanged (app/vocab.js) ----------
  let V = null, vocabMode = 'home', vocabReturn = null;
  const vocabStage = h('div', { class: 'vocab-stage' });
  function vocabApp() {
    if (!V && window.VocabApp) {
      V = VocabApp.create(vocabStage, window.Sync || localStorage, {
        home: () => { VSW.pause(); vocabMode = 'home'; if (vocabReturn && (location.hash || '').startsWith('#/vocab')) { const r = vocabReturn; vocabReturn = null; go(r); return; } if (V && (location.hash || '').startsWith('#/vocab')) render(); },
        toast,
        changed: () => {},
        started: (key, label) => { VSW.start(key, label); setTimeout(() => { const m = document.querySelector('.vocab-flow'); if (vocabMode === 'flow' && m && !m.querySelector('.stopwatch')) { const w = VSW.widget(); if (w) m.append(w); } }); },
        finished: () => VSW.finish(),
      });
    }
    return V;
  }

  // 단어 세트 스톱워치 (우측 상단): 세트마다 걸린 시간, 일시정지 가능. 세트 목록으로 나가면 멈춘다.
  // 기록 키 toefl-vocab-timer-v1 = { cur: {key, label, acc, since}, times: {set0: ms, …, freq: ms} } (Sync로 기기 간 공유).
  const VSW = (() => {
    const KEY = 'toefl-vocab-timer-v1', store = () => window.Sync || localStorage;
    const load = () => { try { return JSON.parse(store().getItem(KEY)) || { cur: null, times: {} }; } catch (e) { return { cur: null, times: {} }; } };
    const save = s => { try { store().setItem(KEY, JSON.stringify(s)); } catch (e) { /* storage off */ } };
    const ms = c => c ? c.acc + (c.since ? Date.now() - c.since : 0) : 0;
    const fmt = t => { const s = Math.floor(t / 1000), h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60; return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(s % 60).padStart(2, '0'); };
    let tick = null;
    return {
      fmt, times: () => load().times,
      start(key, label) { const s = load(); if (!s.cur || s.cur.key !== key) s.cur = { key, label, acc: 0, since: Date.now() }; else if (!s.cur.since) s.cur.since = Date.now(); save(s); },
      pause() { const s = load(); if (s.cur && s.cur.since) { s.cur.acc = ms(s.cur); s.cur.since = null; save(s); } },
      toggle() { const s = load(); if (!s.cur) return; if (s.cur.since) { s.cur.acc = ms(s.cur); s.cur.since = null; } else s.cur.since = Date.now(); save(s); },
      finish() { const s = load(); if (!s.cur) return; s.times[s.cur.key] = ms(s.cur); s.cur = null; save(s); },
      widget() {
        if (tick) clearInterval(tick);
        const s0 = load(); if (!s0.cur) return null;
        const time = h('b', { class: 'sw-time' }), btn = h('button', { class: 'ghost small', onclick: () => { VSW.toggle(); draw(); } });
        const box = h('div', { class: 'stopwatch', role: 'timer' }, h('span', { class: 'muted small' }, s0.cur.label), time, btn);
        const draw = () => { const s = load(); if (!box.isConnected && tick && box.dataset.on) { clearInterval(tick); tick = null; return; } box.dataset.on = 1;
          if (!s.cur) { box.remove(); return; } time.textContent = fmt(ms(s.cur)); btn.textContent = s.cur.since ? '일시정지' : '계속'; box.classList.toggle('paused', !s.cur.since); };
        draw(); tick = setInterval(draw, 500);
        return box;
      },
    };
  })();
  function vocabFlow(startFn) { if (startFn()) { vocabMode = 'flow'; render(); } }

  function viewVocab(main) {
    const api = vocabApp();
    if (!api) { main.append(h('p', { class: 'notice' }, '단어 모듈을 불러오지 못했습니다. 새로고침해 주세요.')); return; }
    if (vocabMode === 'flow') {
      main.classList.add('vocab-flow');
      main.append(h('button', { class: 'link small', onclick: () => { VSW.pause(); api.deactivate(); vocabMode = 'home'; render(); } }, '← 세트 목록 (진행 상황은 저장됩니다)'), vocabStage);
      const sw = VSW.widget(); if (sw) main.append(sw);
      return;
    }
    main.append(h('h1', null, '단어 암기'),
      h('p', { class: 'muted small' }, '고른 750개 단어를 50개씩 15세트로 외웁니다. 원본 단어장의 \'오늘 암기 시작\'과 같은 방식(뜻 연결하기 → 6개씩 묶어 익히기 → 시간을 두고 철자 떠올리기 → 마지막 재시험)입니다.'));
    const kept = keepApp().count();
    main.append(h('section', { class: 'card keep-card', onclick: () => go('#/keep') },
      h('strong', null, `킵한 단어 ${kept}개 →`),
      h('p', { class: 'muted small' }, '문제를 풀다가 모르는 단어를 선택해 저장한 목록입니다.')));
    if (!api.hasData()) { main.append(vocabImportCard(api, true)); return; }
    let keptNoKo = 0;
    if (keepApp().words) { if (api.syncKept) keptNoKo = api.syncKept(keepApp().words()); if (api.flagKept) api.flagKept(keepApp().words()); }

    main.append(frequentCard(api, keptNoKo));
    const r = api.resumable();
    if (r) {
      main.append(h('section', { class: 'card hero' },
        h('h2', null, r.chunk ? `세트 ${r.chunk.index + 1} 진행 중` : '진행 중인 암기'),
        h('p', { class: 'muted small' }, `오늘 완료 ${r.done} / ${r.total}개 · 저장된 곳부터 이어집니다.`),
        h('button', { class: 'primary', onclick: () => vocabFlow(() => api.resume()) }, '이어서 하기'),
        confirmButton('진행 중인 세트 그만두기', '한 번 더 누르면 진행 상태를 버립니다 (단어별 기록은 남음)', 'link small', () => { api.discardSession(); render(); })));
    }

    const plan = api.plan();
    if (!plan) {
      const counts = api.reviewCounts(), mode = api.bestReviewMode(), n = counts[mode];
      main.append(h('section', { class: 'card' + (r ? '' : ' hero') },
        h('h2', null, `복습 단어 ${n.toLocaleString()}개`),
        h('p', { class: 'muted small' }, `단어장에서 '찍음'(거의 모름)으로 분류되고 아직 마스터하지 않은 단어입니다. 교재 순서로 30개씩 ${Math.ceil(n / 30)}세트로 나눕니다. (기준 형식: ${mode})`),
        n ? h('p', { class: 'warn small' }, `한 번 나누면 이 ${n.toLocaleString()}개로 영구 고정됩니다. 이후 단어가 더해지거나 빠지지 않고, 다시 나눌 수도 없습니다.`) : null,
        n ? confirmButton(`이 ${n.toLocaleString()}개로 고정하고 30개씩 ${Math.ceil(n / 30)}세트로 나누기`, '한 번 더 누르면 고정합니다 (되돌릴 수 없음)', 'primary', () => { api.createPlan(mode); render(); })
          : h('p', { class: 'notice' }, '복습 단어가 없습니다. 가져온 기록에 찍음으로 분류된 단어가 있는지 확인하세요.')));
    } else {
      const total = api.chunkCount(plan), done = Object.keys(plan.done).length, next = api.nextChunkIndex(plan);
      const sec = h('section', { class: 'card' + (r ? '' : ' hero') },
        h('h2', null, `단어 ${plan.words.length.toLocaleString()}개 · ${plan.size}개씩 ${total}세트`, h('span', { class: 'muted small' }, ` ${done} / ${total}세트 완료`)),
        h('div', { class: 'meter' }, h('div', { style: `width:${total ? 100 * done / total : 0}%` })),
        h('p', { class: 'muted small' }, `세트마다 예전 세트에서 2회 이상 틀린 단어 16 · 예전에 안 한 세트 단어 16 · 새로 넣은 단어 16~17 · 다시 넣은 아는 단어 1~2개가 고르게 섞여 있습니다 (${E.dayStr(plan.createdAt).replace(/-/g, '.')} 시작). 세트를 끝내면 날짜가 기록되고, 아무 세트나 눌러 다시 할 수 있어요.`));
      if (!r && next != null) sec.append(h('button', { class: 'primary', onclick: () => vocabFlow(() => api.start(next)) }, `세트 ${next + 1} 암기 시작 (${api.chunkWords(next).length}개)`));
      if (next == null) sec.append(h('p', { class: 'rule' }, '모든 세트를 한 번씩 끝냈습니다. 세트를 눌러 다시 복습할 수 있습니다.'));
      const grid = h('div', { class: 'setgrid' });
      for (let i = 0; i < total; i++) {
        const d = plan.done[i];
        grid.append(h('button', { class: 'setb' + (d ? ' done' : '') + (i === next ? ' next' : ''), title: api.chunkWords(i).map(w => w.en).join(', '),
          onclick: () => vocabFlow(() => api.start(i)) }, h('b', null, `세트 ${i + 1}`), h('span', null, d ? d.slice(5).replace('-', '/') + ' 완료' : `${api.chunkWords(i).length}개`),
          VSW.times()['set' + i] ? h('span', { class: 'muted small' }, '⏱ ' + VSW.fmt(VSW.times()['set' + i])) : null));
      }
      sec.append(grid);
      if (next != null) sec.append(h('details', null, h('summary', null, `세트 ${next + 1} 단어 미리 보기`),
        h('ul', { class: 'wordlist' }, api.chunkWords(next).map(w => h('li', null, h('b', null, w.en), ' ', h('span', { class: 'muted' }, w.ko))))));
      main.append(sec);
    }
    main.append(h('details', { class: 'card' }, h('summary', null, '단어 기록 내보내기 (파일 저장)'), vocabExportCard(api)));
    main.append(h('details', { class: 'card' }, h('summary', null, '단어장 기록 다시 가져오기'), vocabImportCard(api, false)));
  }

  // 자주 틀린 단어: 평소와 같은 풀이(같은 날 반복)로 범위만 바뀐다. 출처(단어장 Day / 문제 풀다 킵)·주제(단어장 분류) 필터.
  let freqFilter = { src: 'all' };
  function frequentCard(api, keptNoKo) {
    if (!api.frequentList) return null;
    const all = api.frequentList();
    const srcOf = w => w.kept ? 'tpo' : 'set';
    const list = all.filter(w => freqFilter.src === 'all' || (freqFilter.src === 'tpo' ? w.kept : w.setFails >= 3));
    const nSet = all.filter(w => w.setFails >= 3).length, nTpo = all.filter(w => w.kept).length;
    const sel = h('select', { onchange: e => { freqFilter.src = e.target.value; render(); } }, [['all', `전체 ${all.length}`], ['set', `세트에서 3회 이상 틀림 ${nSet}`], ['tpo', `킵한 단어 ${nTpo}`]].map(([v, l]) => h('option', { value: v, selected: freqFilter.src === v }, l)));
    return h('section', { class: 'card' },
      h('h2', null, `자주 틀린 단어 ${all.length}개`),
      h('p', { class: 'small muted' }, '세트를 공부하면서 직접 입력으로 3회 이상 틀린 단어와 킵한 단어(단어장에 없는 단어 포함)입니다. 세트를 나누기 전에 틀린 횟수는 세지 않습니다. 마지막으로 틀린 날 뒤 서로 다른 2일 연속으로 맞히면 빠집니다.'),
      keptNoKo ? h('p', { class: 'small notice' }, `단어장에 없는 킵 단어 ${keptNoKo}개는 뜻이 없어 빠졌습니다. `, h('a', { href: '#/keep' }, '킵한 단어'), '에서 뜻을 적으면 들어옵니다.') : null,
      all.length ? h('div', { class: 'row wrap' }, sel, h('button', { class: 'primary', onclick: () => vocabFlow(() => api.startHard()) }, '자주 틀린 단어 전부 암기 시작'))
        : h('p', { class: 'muted small' }, '아직 없습니다. 세트를 공부하면 여기에 모입니다.'),
      list.length ? h('details', null, h('summary', null, `목록 ${list.length}개`),
        h('ul', { class: 'wordlist' }, list.slice(0, 300).map(w => h('li', null, h('b', null, w.en), ' ', h('span', { class: 'muted' }, w.ko), ' ',
          h('span', { class: 'small' }, w.label || ''), w.kept ? h('span', { class: 'chip' }, '문제에서') : null)))) : null);
  }

  // The same code the import box accepts, saved as a file (Safari keeps its storage out of reach of other apps).
  function vocabExportCard(api) {
    const msg = h('p', { class: 'small', role: 'status' });
    const name = () => `vocab-export-${E.dayStr(now())}.txt`;
    const save = () => {
      try {
        const a = h('a', { href: URL.createObjectURL(new Blob([api.exportCode()], { type: 'text/plain' })), download: name() });
        document.body.append(a); a.click(); a.remove();
        msg.textContent = `${name()} 을(를) 다운로드 폴더에 저장했습니다.`;
      } catch (e) { msg.textContent = '저장 실패: ' + e.message; }
    };
    const copy = async () => {
      try { await navigator.clipboard.writeText(api.exportCode()); msg.textContent = '코드를 복사했습니다.'; }
      catch (e) { msg.textContent = '복사 실패: ' + e.message; }
    };
    return h('section', null,
      h('p', { class: 'muted small' }, '단어별 학습 기록(찍음/애매/마스터, 틀린 횟수·날짜)을 코드 파일로 저장합니다. 다른 브라우저의 "단어장 기록 다시 가져오기"에 붙여넣으면 그대로 옮겨집니다. 기록은 바뀌지 않습니다.'),
      h('div', { class: 'row' }, h('button', { class: 'primary', onclick: save }, '파일로 저장'), h('button', { class: 'ghost', onclick: copy }, '코드 복사')),
      msg);
  }

  function vocabImportCard(api, first) {
    const box = h('textarea', { id: 'vocab-import', class: 'databox', rows: 5, placeholder: '기존 단어장의 "내보내기 코드 생성"으로 만든 코드를 여기에 붙여넣으세요.' });
    const msg = h('p', { class: 'small', role: 'status' });
    const run = () => {
      const code = box.value.trim();
      if (!code) { msg.textContent = '먼저 코드를 붙여넣으세요.'; return; }
      if (!api.importCode(code)) { msg.textContent = '코드를 읽지 못했습니다. 코드가 처음부터 끝까지 빠짐없이 붙여넣어졌는지 확인하세요 (끝이 조금만 잘려도 읽을 수 없습니다).'; return; }
      toast('단어 기록을 가져왔습니다.'); render();
    };
    return h('section', { class: first ? 'card hero' : '' },
      first ? h('h2', null, '기존 단어장 기록 가져오기') : null,
      h('p', { class: 'muted small' }, '기존 단어장(taebin.link/toefl-voca)의 홈에서 "내보내기 코드 생성"을 누르고 나온 코드를 통째로 복사해 붙여넣으세요. 찍음/애매/마스터 분류와 단어별 학습 기록이 그대로 옮겨지고, 이후에는 claude.ai에 저장되어 어느 기기에서 열어도 이어집니다.'),
      !first ? h('p', { class: 'warn small' }, '가져오면 지금 이 앱의 단어 기록을 대체합니다.') : null,
      box, msg,
      first ? h('button', { class: 'primary', onclick: run }, '가져오기') : confirmButton('가져오기 (대체)', '한 번 더 누르면 대체합니다', 'ghost', run));
  }

  // ---------- TODAY: 하루 계획 (6블록, 블록 시간 = 하루 총 시간 × 비중) ----------
  const BLOCK = { vocab: ['①', '단어'], listen: ['②', '리스닝'], read: ['③', '리딩'], speak: ['④', '말하기'], write: ['⑤', '쓰기'], wrap: ['⑥', '마무리'] };
  const TASK_LABEL = t => ({
    vocab: t.mode === 'hard' ? `자주 틀린 단어${t.n ? ' ' + t.n + '개' : ''}` : '오늘 복습 단어',
    dictation: '받아쓰기 → 쉐도잉', twopass: '2단계 듣기',
    item: (practice().KIND[(POOL()[t.item] || {}).kind] || '문제') + (/^verify/.test(t.tier) ? ' · 다시 확인' : t.tier === 'delayed' ? ' · 유지 확인' : ''),
    lr: 'Listen & Repeat', interview: 'Interview (45초)', bs: 'Build a Sentence', hk: `해커스 ${t.kind === 'hkE' ? 'Email' : 'Discussion'} Day ${Number(String(t.task || '').slice(2))}${Number(String(t.task || '').slice(2)) % 3 === 0 ? ' · 처음 보는 문제' : ' · 라벨 재구성'}`, shadow: '쉐도잉 (L&R에서 빠뜨린 문장)', write: '계획 카드 → ' + (t.kind === 'email' ? 'Email' : 'Academic Discussion'),
    outline: `개요 드릴 ${t.n || 3}개`, fix: '반복 오류 고쳐 쓰기', diag: '원본 빠른 진단', original: '다시 확인 · 원본',
  })[t.type] || t.type;
  let poolIdx = null;
  const POOL = () => poolIdx || (poolIdx = E.poolIndex(C));

  // 리딩·리스닝 오답 탭에서 이미 다시 푼 세트 → 새 문제에서 뺀다 (같은 회차·모듈·순서의 소站 세트).
  function tabSeen() {
    const m = new Map();
    const bySlot = {};
    for (const s of C.pool.sets) bySlot[`${s.sec}:${s.paper}:${s.module}:${s.task}`] = s;
    const scan = (key, sec, re) => {
      let d = null; try { d = JSON.parse((window.Sync || localStorage).getItem(key) || 'null'); } catch (e) { /* none */ }
      for (const [id, rec] of Object.entries((d && d.sets) || {})) {
        const mm = id.match(re); const tries = (rec && rec.tries) || [];
        if (!mm || !tries.length) continue;
        const s = bySlot[`${sec}:${mm[1]}:${mm[2]}:${mm[3]}`];
        if (s && s.kind !== 'reply') m.set(s.id, Math.max(...tries.map(t => t.at || 0)));
      }
    };
    scan('toefl-listen-v1', 'L', /^Z(\d+)-M(\d+)-T(\d+)$/);
    scan('toefl-read-v1', 'R', /^Z(\d+)-R-M(\d+)-T(\d+)$/);
    return m;
  }
  function planCtx() {
    const api = vocabApp();
    const vc = api && api.hasData() ? { hard: api.hardCount ? api.hardCount() : 0, due: api.remaining ? api.remaining() : api.reviewCounts ? api.reviewCounts()[api.bestReviewMode()] : null } : {};
    return { seen: tabSeen(), vocab: vc, speak: speak().today(C, D.speak), write: window.WriteApp ? write().today(C, D) : {} };
  }
  // 주 1회 비중 자동 조정: 선행 지표가 지난주보다 오르지 않은 영역 +5%p (설정에서 고정한 영역은 제외).
  // 변화 지표 (엔진 areaMetrics) + 단어 지표: 자주 틀린 단어 수(오늘 vs 7일 전 기록), 틀린 세트 지문의 아는 단어 비율.
  function vocabNumbers() {
    const api = vocabApp();
    if (!api || !api.hasData || !api.hasData() || !api.hardCount) return {};
    const nowN = api.hardCount();
    const hist = D.vocabHist || {};
    const weekAgo = Object.keys(hist).filter(d => d <= E.dayStr(now() - 7 * E.DAY)).sort().pop();
    let known = null;
    if (window.ZHAN_POOL && api.wordStatus) {
      // 앱에서 틀린 소站 세트의 지문·스크립트에 나온 단어 중 단어장에 있는 것 → 마스터 비율
      const wrongSets = new Set(D.attempts.filter(a => a.item && a.correct === false).map(a => POOL()[a.item] && POOL()[a.item].set).filter(Boolean));
      const words = new Set();
      for (const st of ZHAN_POOL.sets) if (wrongSets.has(st.id)) for (const w of String(st.passage || (st.script || []).map(l => l.t).join(' ')).toLowerCase().match(/[a-z]{4,}/g) || []) words.add(w);
      let inBook = 0, mastered = 0;
      for (const w of words) { const st = api.wordStatus(w); if (st) { inBook++; if (st === 'master') mastered++; } }
      if (inBook >= 10) known = Math.round(100 * mastered / inBook);
    }
    return { vocabNow: nowN, vocabPrev: weekAgo ? hist[weekAgo] : null, knownRatio: known };
  }
  const metricsNow = () => E.areaMetrics(D, C, now(), vocabNumbers());
  function weeklyIndicators() { return E.weeklyIndicatorsFrom(metricsNow()); }
  function todayPlan() {
    const today = E.dayStr(now());
    if (D.plan && D.plan.date === today && D.plan.v === 3 && D.plan.rev === 2) return D.plan;
    const wa = E.weeklyAdjust(D, now(), weeklyIndicators());
    if (!D.weightAuto || wa.week !== D.weightAuto.week) D.weightAuto = wa;
    const vn = vocabNumbers();
    if (vn.vocabNow != null) { D.vocabHist = D.vocabHist || {}; D.vocabHist[today] = vn.vocabNow; }
    const p = E.buildPlan(D, C, now(), planCtx());
    p.before = Object.fromEntries(E.skillTable(D, C, now()).map(r => [r.skill.id, r.st.state]));
    D.plan = p; save();
    return p;
  }

  function viewToday(main) {
    const left = E.daysLeft(D.settings.examDate, now());
    if (!D.settings.examDate) {
      const date = h('input', { type: 'date', min: E.dayStr(now()) });
      const mins = h('input', { type: 'number', min: 10, max: 300, step: 5, value: D.settings.minutes || 60 });
      main.append(h('section', { class: 'card hero' },
        h('h1', null, '시험 날짜를 알려주세요'),
        h('p', { class: 'muted' }, '남은 날짜에 맞춰 날마다 계획을 다시 짭니다.'),
        h('label', { class: 'field' }, '시험일', date),
        h('label', { class: 'field' }, '하루 총 시간(분)', mins),
        h('button', { class: 'primary', onclick: () => {
          if (!date.value) { date.focus(); return; }
          D.settings.examDate = date.value; D.settings.minutes = Math.max(10, +mins.value || 60); save(); render();
        } }, '계획 만들기')));
      return;
    }
    const p = todayPlan();
    main.append(h('p', { class: 'dday' }, left > 0 ? `D-${left}` : left === 0 ? 'D-day' : '시험일 지남', h('span', { class: 'muted' }, ` · ${fmtDate(E.dayStart(D.settings.examDate))} 시험 · 하루 ${p.minutes}분`)));
    if (p.cover) main.append(h('section', { class: 'card' },
      h('h2', null, `시험 전까지 전 문제 한 번씩 · 오늘 예상 ${p.need}분`, p.need > p.minutes ? h('span', { class: 'chip' }, `설정 ${p.minutes}분보다 ${p.need - p.minutes}분 많음`) : null),
      h('p', { class: 'small muted' }, '종류마다 남은 문제를 남은 날로 나눠 오늘 몫을 정합니다 (모의 모듈용 회차 제외). 못 한 것은 다음 날로 넘어가 그날 몫에 포함됩니다.'),
      h('ul', { class: 'cover' }, Object.entries(p.cover).filter(([, c]) => c.left).map(([k, c]) => h('li', null, h('b', null, k), ` 오늘 ${c.today} · 남은 ${c.left}`)))));
    const cur = p.blocks.findIndex(b => !b.done);
    const allDone = cur < 0;
    main.append(h('section', { class: 'card hero' },
      h('h1', null, allDone ? '오늘 계획 완료' : '오늘의 계획'),
      h('ol', { class: 'blocks' }, p.blocks.map((b, i) => h('li', { class: (b.done ? 'done' : '') + (i === cur ? ' cur' : '') },
        h('div', { class: 'bname' }, `${BLOCK[b.key][0]} ${BLOCK[b.key][1]}`, h('span', { class: 'muted small' }, p.cover ? ` ${b.minutes}분` : ` ${b.minutes}분 · ${b.weight}%`),
          b.carried ? h('span', { class: 'chip' }, `어제에서 ${b.carried}개`) : null, b.done ? h('span', { class: 'chip st-IMPROVED' }, '완료') : null),
        h('div', { class: 'small muted' }, b.tasks.length ? b.tasks.map(TASK_LABEL).filter((x, k, a) => a.indexOf(x) === k).join(' · ') + (b.cursor ? ` (${b.cursor}/${b.tasks.length})` : '') : '오늘은 없음')))),
      p.originals.left ? h('p', { class: 'small' }, `원본 오답: 오늘 진단 ${p.originals.today}개 · 아직 안 본 원본 ${p.originals.left}/${p.originals.total}개를 시험 전까지 나눠서`) : null,
      p.held && p.held.length ? h('p', { class: 'small muted' }, '모의 모듈용으로 남겨 둔 회차: ' + p.held.map(x => `독점 TPO ${x.paper} (${x.date.slice(5).replace('-', '/')})`).join(', ')) : null,
      allDone ? h('p', { class: 'muted' }, '내일 계획은 오늘 결과로 다시 계산됩니다. 더 하고 싶으면 연습실에서 고르세요.')
        : h('button', { class: 'primary', onclick: () => go('#/do') }, cur === 0 && !p.blocks[0].cursor ? '시작하기' : '이어서 하기')));
    if (p.freshLeft < 40) main.append(h('p', { class: 'notice' }, `아직 안 푼 소站 새 문제가 ${p.freshLeft}개 남았습니다.`));
    const table = E.skillTable(D, C, now()).sort((a, b) => b.pr - a.pr);
    main.append(h('section', { class: 'card' },
      h('h2', null, '지금 상태', h('a', { href: '#/progress', class: 'more' }, '자세히')),
      h('ul', { class: 'skills' }, table.map(r => h('li', { onclick: () => go('#/skill/' + r.skill.id) },
        h('span', { class: 'sname' }, r.skill.name), chip(r.st.state), dots(r.st.recent))))));
    if (Store.lastError) main.append(h('p', { class: 'notice' }, '이 브라우저에 기록을 저장하지 못하고 있습니다 (사생활 보호 모드 등). 설정의 내보내기로 백업하세요. ', Store.lastError));
    if (D.attempts.length >= 20 && (!D.lastBackup || now() - D.lastBackup > 7 * E.DAY)) {
      main.append(h('p', { class: 'notice' }, '학습 기록을 7일 넘게 백업하지 않았어요. ', h('a', { href: '#/settings' }, '내보내기')));
    }
  }

  // ---------- 계획 실행 (#/do): 블록 순서대로, 블록 안의 할 일을 하나씩 ----------
  function viewDo() {
    const p = D.plan;
    if (!p || p.v !== 3 || p.date !== E.dayStr(now())) { go('#/'); return; }
    const bi = p.blocks.findIndex(b => !b.done);
    if (bi < 0) { go('#/'); return; }
    const b = p.blocks[bi];
    const main = h('main', { class: 'page session' });
    app.append(h('header', { class: 'nav slim' },
      h('button', { class: 'link', onclick: () => { save(); go('#/'); } }, '← 나가기 (자동 저장)'),
      h('span', { class: 'muted small' }, `${BLOCK[b.key][0]} ${BLOCK[b.key][1]} · ${b.minutes}분 · ${Math.min(b.cursor + 1, b.tasks.length)}/${b.tasks.length}`)), main);
    const advance = () => { b.cursor++; if (b.cursor >= b.tasks.length) b.done = true; save(); render(); };
    const skipBlock = h('button', { class: 'link small', onclick: () => { b.done = true; b.skipped = true; save(); render(); } }, '이 블록은 내일로 넘기기');
    if (b.cursor >= b.tasks.length) {
      main.append(h('section', { class: 'card hero' }, h('h1', null, `${BLOCK[b.key][1]} 블록`), h('p', { class: 'muted' }, b.tasks.length ? '이 블록의 할 일을 마쳤습니다.' : '오늘 이 블록에는 할 일이 없습니다.'),
        h('button', { class: 'primary', onclick: () => { b.done = true; save(); render(); } }, '다음 블록')));
      return;
    }
    const t = b.tasks[b.cursor];
    runTask(main, t, res => {
      if (res && res.followup) { D.followups = D.followups || {}; D.followups[res.followup] = now(); }
      if ((t.because === 'judge' || t.because === 'timed') && t.key) { D.followups = D.followups || {}; D.followups[t.key] = now(); }
      advance();
    });
    main.append(h('div', { class: 'row' }, h('button', { class: 'link small', onclick: () => { practice().stopAll(); advance(); } }, '이 할 일 건너뛰기'), skipBlock));
  }

  function runTask(main, t, done) {
    if (t.type === 'item') {
      const meta = POOL()[t.item];
      if (!meta) { done(); return; }
      practice().renderItem(main, Object.assign({}, t, { tier: t.tier || 'transfer' }), meta, done);
    } else if (t.type === 'dictation') practice().dictation(main, t, done);
    else if (t.type === 'twopass') practice().twoPass(main, t, done);
    else if (t.type === 'diag') stepDiag(main, t, done);
    else if (t.type === 'original') {
      const o = ORIG[t.ref]; if (!o) { done(); return; }
      main.append(h('p', { class: 'kicker' }, `다시 확인 · 전에 맞힌 원본 오답 · ${o.test} · ${o.set}`),
        h('p', { class: 'muted small' }, '같은 능력의 새 소站 문제가 남지 않아 같은 문제로 확인합니다. 근거를 찾아 다시 풀고, 솔직하게 확신도를 고르세요.'));
      renderOriginalCard(main, o, true, done, { verify: true, verifyOf: t.verifyOf });
    } else if (t.type === 'vocab') {
      const api = vocabApp();
      main.append(h('section', { class: 'card hero' }, h('h1', null, t.mode === 'hard' ? '① 자주 틀린 단어' : '① 오늘 복습 단어'),
        h('p', { class: 'muted' }, t.mode === 'hard' ? '여러 번 틀린 단어부터 평소와 같은 방식(카드·뜻 고르기·직접 입력)으로 풉니다.' : '단어 탭의 오늘 복습을 그대로 합니다.'),
        api && api.startHard && t.mode === 'hard' ? h('button', { class: 'primary', onclick: () => { if (api.startHard()) { vocabMode = 'flow'; vocabReturn = '#/do'; go('#/vocab'); } } }, '자주 틀린 단어 시작')
          : h('button', { class: 'primary', onclick: () => { vocabReturn = '#/do'; go('#/vocab'); } }, '단어 탭으로'),
        h('button', { class: 'ghost', onclick: () => done() }, '다 했어요')));
    } else if (t.type === 'lr') speak().lr(main, t, done);
    else if (t.type === 'interview') speak().interview(main, t, done);
    else if (t.type === 'shadow') speak().shadow(main, t, done);
    else if (window.WriteApp && t.type === 'bs') write().bs(main, t.set, done);
    else if (window.HackersApp && t.type === 'hk') hackers().run(main, t, done);
    else if (window.WriteApp && t.type === 'fix') write().run(main, t, done);
    else if (t.type === 'write' || t.type === 'outline') {   // 없앤 Email·Discussion·개요 드릴 (예전 계획에 남은 것)
      main.append(h('section', { class: 'card' }, h('h1', null, TASK_LABEL(t)), h('p', { class: 'muted' }, 'Email·Discussion·개요 드릴은 없어졌습니다.'), h('button', { class: 'primary', onclick: () => done({ skipped: true }) }, '넘어가기')));
    }
    else {
      main.append(h('section', { class: 'card' }, h('h1', null, TASK_LABEL(t)), h('p', { class: 'muted' }, '말하기·쓰기 탭에서 하세요.'),
        h('button', { class: 'ghost', onclick: () => go('#/sw') }, '말하기·쓰기 탭'), h('button', { class: 'primary', onclick: () => done() }, '다 했어요')));
    }
  }

  // ---------- 원본 빠른 진단 카드: 근거 문장 찾기 → 원인 1개 → 다음 (끝까지 다시 풀기는 '다시 확인' 표본만) ----------
  const DIAG_CAUSE = [['sound', '안 들렸다', 'L'], ['memory', '들었는데 잊었다', 'L'], ['vocab', '뜻을 몰랐다', 'RL'], ['judge', '선택지에서 헷갈렸다', 'RL'], ['time', '시간 부족', 'R']];
  function stepDiag(main, t, done) {
    const o = ORIG[t.ref]; if (!o) { done(); return; }
    main.append(h('p', { class: 'kicker' }, `원본 빠른 진단 · ${o.test} · ${o.sec === 'R' ? 'Reading' : 'Listening'} · ${o.set}`));
    const box = h('section', { class: 'card' }); main.append(box);
    const hasText = !!(o.options || o.ctest);
    if (!hasText) box.append(h('p', { class: 'notice' }, '이 기기에서는 원문(비공개 자료)을 불러올 수 없습니다. 기록된 판단만 보고 원인을 고르세요.'));
    if (o.passage) box.append(h('details', null, h('summary', null, '지문 보기'), h('div', { class: 'passage' }, para(o.passage))));
    if (o.audio && C.audio[o.audio] && C.audio[o.audio].lines) box.append(h('details', null, h('summary', null, '스크립트 보기'), C.audio[o.audio].lines.map(l => h('p', null, l.t))));
    if (o.ctest) box.append(h('p', { class: 'ctest' }, o.ctest.text.replace('{{}}', `[${o.ctest.answer}]`)));
    else if (o.stem) box.append(h('p', { class: 'stem' }, o.stem), h('ul', null, (o.options || []).map((x, i) => h('li', { class: i === o.correct ? 'right' : i === o.my ? 'wrong' : '' }, `${LETTERS[i]}. ${x}`, i === o.correct ? ' ← 정답' : i === o.my ? ' ← 그때 내 답' : ''))));
    const ev = h('div', { hidden: true }, o.evidence ? h('p', null, h('span', { class: 'lbl' }, '근거'), ' ', h('q', null, o.evidence)) : h('p', { class: 'muted small' }, '근거 기록 없음'),
      o.diff ? h('p', null, h('span', { class: 'lbl' }, '결정적 차이'), ' ', o.diff) : null, h('p', { class: 'rule' }, '다음엔: ', o.rule));
    const step2 = h('div', { hidden: true }, h('p', { class: 'stem' }, '원인 1개만 고르세요'),
      h('div', { class: 'row' }, DIAG_CAUSE.filter(c => c[2].includes(o.sec)).map(([k, l]) => h('button', { class: 'tagb', onclick: () => {
        logAttempt({ ref: o.id, skill: o.skill, tier: 'original', diag: true, correct: null, cause: k });
        done();
      } }, l))));
    box.append(h('p', { class: 'small muted' }, '1) 지문/스크립트에서 정답의 근거 문장을 먼저 찾아 보세요.'),
      h('button', { class: 'ghost', onclick: e => { e.currentTarget.remove(); ev.hidden = false; step2.hidden = false; } }, '찾았어요 → 근거 확인'), ev, step2);
  }

  // ---------- 연습실: 영역별로 직접 고르기 ----------
  const ROOM = [
    ['read', '리딩', [['ctest', 'C-Test (소站 + Fill in the blank 자료)'], ['daily', '일상 지문'], ['academic', '학술 지문']]],
    ['listen', '리스닝', [['reply', '응답 고르기'], ['conversation', '대화'], ['announcement', '공지'], ['lecture', '강의']]],
  ];
  function viewRoom(main, arg, arg2) {
    if (arg === 'item' && arg2) {
      const meta = POOL()[decodeURIComponent(arg2)];
      if (!meta) { go('#/room'); return; }
      main.append(h('p', { class: 'kicker' }, h('a', { href: '#/room/' + (meta.sec === 'L' ? 'listen' : 'read') + '/' + meta.kind }, '← 목록')));
      practice().renderItem(main, { type: 'item', item: meta.id, tier: 'transfer', exam: true }, meta, () => go('#/room/' + (meta.sec === 'L' ? 'listen' : 'read') + '/' + meta.kind));
      return;
    }
    if ((arg === 'read' || arg === 'listen') && arg2) {
      const kind = arg2; const sec = arg === 'read' ? 'R' : 'L';
      const fresh = E.freshPool(C, D, { seen: E.seenItems(D, tabSeen()), sec, kinds: [kind] });
      main.append(h('p', { class: 'kicker' }, h('a', { href: '#/room' }, '← 연습실')), h('h1', null, practice().KIND[kind]),
        h('p', { class: 'muted small' }, `아직 안 푼 소站 문제 ${fresh.length}개 (모의 모듈용 보류 회차 제외). 위에서부터 추천 순서입니다.`),
        h('ul', { class: 'olist' }, fresh.slice(0, 60).map(i => h('li', { onclick: () => go('#/room/item/' + encodeURIComponent(i.id)) },
          h('div', null, h('b', null, i.paper ? `독점 TPO ${i.paper}` : 'Fill in the blank'), ' · ', SKILL[i.skill] ? SKILL[i.skill].name : '', ' · ', `${i.qs.length}문항`, i.z === -1 ? h('span', { class: 'chip' }, '소站에서 틀림') : null)))));
      return;
    }
    main.append(h('h1', null, '연습실'), h('p', { class: 'muted small' }, '오늘 계획과 따로, 영역별로 골라 풉니다. 여기서 푼 문제도 새 문제 기록에 들어갑니다.'));
    for (const [sec, name, kinds] of ROOM) {
      main.append(h('section', { class: 'card' }, h('h2', null, name), h('div', { class: 'row wrap' }, kinds.map(([k, l]) => h('button', { class: 'ghost', onclick: () => go(`#/room/${sec}/${k}`) }, l)))));
    }
    main.append(h('section', { class: 'card' }, h('h2', null, '말하기 · 쓰기'), h('div', { class: 'row wrap' },
      h('button', { class: 'ghost', onclick: () => go('#/speak') }, '말하기: Listen & Repeat · Interview'),
      h('button', { class: 'ghost', onclick: () => go('#/hk') }, '쓰기: 해커스 모범답안 재구성 (Email · Discussion)'),
      h('button', { class: 'ghost', onclick: () => go('#/write') }, '쓰기: Build a Sentence · 반복 오류 고쳐 쓰기'),
      h('button', { class: 'ghost', onclick: () => go('#/sw') }, '튜터 교정 문장·반복 오류 (말하기·쓰기 탭)'))),
    h('section', { class: 'card' }, h('h2', null, '단어'), h('div', { class: 'row wrap' }, h('button', { class: 'ghost', onclick: () => go('#/vocab') }, '단어 암기'), h('button', { class: 'ghost', onclick: () => go('#/keep') }, `킵한 단어 ${keepApp().count()}개`))),
    h('section', { class: 'card' }, h('h2', null, '모의 모듈'), h('p', { class: 'small muted' }, '보류 회차(독점 TPO 2·3)로 실전처럼 리딩·리스닝 모듈을 풉니다.'), h('button', { class: 'ghost', onclick: () => go('#/mock') }, '모의 모듈')));
  }

  // ---------- 모의 모듈: 보류 회차(독점 TPO 2·3)의 리딩·리스닝을 소站 순서대로 (기록 tier 'mock', 숙달 판정에는 넣지 않음) ----------
  function mockSets(paper, sec) {
    return C.pool.sets.filter(s => s.paper === paper && s.sec === sec).sort((a, b) => a.module - b.module || a.task - b.task)
      .flatMap(s => s.kind === 'reply' ? s.qs.map(q => q.id) : [s.id]).filter(id => POOL()[id] || true);
  }
  function viewMock(main, arg, arg2) {
    const papers = (C.pool.papers || []).filter(p => p.held);
    if (!arg) {
      main.append(h('p', { class: 'kicker' }, h('a', { href: '#/room' }, '← 연습실')), h('h1', null, '모의 모듈'),
        h('p', { class: 'muted small' }, '일상 훈련에서 빼 둔 회차입니다. 소站 순서대로 실전 조건으로 풉니다 (리딩 모듈 1 약 11분 30초 카운트다운, 리스닝 문항마다 20초 — docs/exam-rules.md). 모듈 2는 적응형이라 소站에서 받은 모듈 2 세트를 모두 이어서 풉니다 (시간 미확인).'),
        ...papers.map(p => h('section', { class: 'card' }, h('h2', null, `${p.name} · ${p.held.slice(5).replace('-', '/')} 예정`),
          h('div', { class: 'row wrap' }, h('button', { class: 'ghost', onclick: () => go(`#/mock/R/${p.n}`) }, '리딩 모듈'), h('button', { class: 'ghost', onclick: () => go(`#/mock/L/${p.n}`) }, '리스닝 모듈')),
          (() => { const r = (D.mock || []).filter(x => x.paper === p.n); return r.length ? h('p', { class: 'small' }, r.map(x => `${x.sec} ${x.correct}/${x.total} (${E.dayStr(x.at).slice(5)})`).join(' · ')) : null; })())));
      return;
    }
    const sec = arg, paper = +arg2;
    const ids = mockSets(paper, sec);
    const st = D.mockRun && D.mockRun.paper === paper && D.mockRun.sec === sec ? D.mockRun : (D.mockRun = { paper, sec, i: 0, correct: 0, total: 0, startedAt: now() });
    if (st.i >= ids.length) {
      (D.mock = D.mock || []).push({ at: now(), paper, sec, correct: st.correct, total: st.total, ms: now() - st.startedAt });
      D.mockRun = null; save();
      main.append(h('section', { class: 'card hero' }, h('h1', null, `모의 모듈 끝 · ${sec === 'R' ? '리딩' : '리스닝'}`), h('p', null, `${st.correct} / ${st.total} 정답`), h('button', { class: 'primary', onclick: () => go('#/mock') }, '모의 모듈 목록')));
      return;
    }
    if (sec === 'R' && st.i === 0 && !st.cdStarted) { st.cdStarted = now(); save(); }
    const left = sec === 'R' ? 690 - Math.round((now() - (st.cdStarted || now())) / 1000) : null;
    main.append(h('p', { class: 'kicker' }, `모의 모듈 · 독점 TPO ${paper} · ${sec === 'R' ? '리딩' : '리스닝'} · ${st.i + 1}/${ids.length}`,
      left != null ? h('span', { class: 'muted small' }, left > 0 ? ` · 모듈 1 남은 시간 약 ${Math.floor(left / 60)}분 ${left % 60}초` : ' · 모듈 1 시간 종료 (계속 풀어도 기록은 남음)') : null));
    const id = ids[st.i]; const meta = POOL()[id] || E.poolItems(Object.assign({}, C, { pool: { sets: C.pool.sets.filter(s => s.paper === paper) } })).find(x => x.id === id);
    if (!meta) { st.i++; save(); render(); return; }
    practice().renderItem(main, { type: 'item', item: id, tier: 'mock', exam: true }, meta, res => { st.i++; st.correct += (res && res.correct) || 0; st.total += (res && res.answers) || 0; save(); render(); });
  }

  // ---------- 오답: 원인별 대기열 + TPO 회차 기록 + 한국어로 풀어 보기 ----------
  function viewWrong(main) {
    const q = E.causeQueues(D, now(), { content: C });
    const by = {}; for (const a of D.attempts) { const c = E.causeOf(a); if (c && a.correct === false) by[c] = (by[c] || 0) + 1; }
    const names = { sound: '안 들렸다', memory: '들었는데 잊었다', vocab: '뜻을 몰랐다', judge: '선택지에서 헷갈렸다', time: '시간 부족', omit: '빠뜨림 (L&R)', grammar: '문법', structure: '구조·아이디어' };
    main.append(h('h1', null, '오답'),
      h('section', { class: 'card' }, h('h2', null, '원인별 대기열 (다음 계획에 들어감)'),
        h('ul', null,
          h('li', null, `받아쓰기 → 쉐도잉 ${q.dictation.length}개 (안 들렸다)`),
          h('li', null, `2단계 듣기 ${q.twoPass.length}개 (들었는데 잊었다)`),
          h('li', null, `같은 능력 새 문제 + 쌍둥이 ${q.judge.length}개 (헷갈렸다)`)),
        h('p', { class: 'small muted' }, '지금까지 고른 원인: ' + (Object.keys(by).length ? Object.entries(by).map(([k, n]) => `${names[k] || k} ${n}`).join(' · ') : '아직 없음'))),
      h('section', { class: 'card' }, h('h2', null, '모의고사 오답'), h('div', { class: 'row wrap' },
        h('button', { class: 'ghost', onclick: () => go('#/tests') }, 'TPO 회차 기록'),
        h('button', { class: 'ghost', onclick: () => go('#/read') }, '리딩 오답 다시 풀기'),
        h('button', { class: 'ghost', onclick: () => go('#/listen') }, '리스닝 오답 다시 풀기'),
        h('button', { class: 'ghost', onclick: () => go('#/sw/bsz') }, 'Build a Sentence 오답'),
        h('button', { class: 'ghost', onclick: () => go('#/ko') }, '한국어로 풀어 보기'))),
      h('section', { class: 'card' }, h('h2', null, '능력별 원본 오답'), h('ul', { class: 'skills' }, E.skillTable(D, C, now()).map(r => h('li', { onclick: () => go('#/skill/' + r.skill.id) },
        h('span', { class: 'sname' }, r.skill.name), chip(r.st.state), h('span', { class: 'muted small' }, `${r.ev.primary}개`))))));
  }

  function logAttempt(a) {
    const rec = Object.assign({ at: now(), sid: D.plan ? D.plan.id : null }, a);
    D.attempts.push(rec);
    save();
    return rec;
  }

  // ---------- my own rules (old-site strength #1) ----------
  function myRules(skill) {
    return C.originals.filter(o => o.skill === skill && D.origState[o.id] && D.origState[o.id].myRule)
      .map(o => ({ id: o.id, rule: D.origState[o.id].myRule, at: D.origState[o.id].at }))
      .concat((D.skillRules || []).filter(r => r.skill === skill).map(r => ({ id: r.from || '', rule: r.rule, at: r.at }))).sort((a, b) => b.at - a.at);
  }
  function ruleLine(skill) {
    const r = myRules(skill)[0];
    return r ? h('p', { class: 'rule mine' }, '내 규칙: ', r.rule, h('span', { class: 'muted small' }, ` (${r.id})`))
      : h('p', { class: 'rule' }, '다음엔: ', SKILL[skill].warning);
  }

  // ---------- replay only the key sentence(s) ----------
  function segmentButton(audioId, seg, onEnd) {
    const meta = C.audio[audioId];
    if (!meta || !seg) return null;
    const fmt = s => Math.floor(s / 60) + ':' + String(Math.floor(s % 60)).padStart(2, '0');
    const a = new Audio(meta.private ? '' : meta.src);
    if (meta.private && window.ZhanData) ZhanData.audioUrl(meta.src).then(u => { a.src = u; }).catch(() => {});
    activePlayers.push({ stop: () => a.pause() });
    const b = h('button', { class: 'ghost seg', onclick: () => {
      a.currentTime = seg[0]; a.play();
      const stop = () => { if (a.currentTime >= seg[1]) { a.pause(); a.removeEventListener('timeupdate', stop); onEnd && onEnd(); } };
      a.addEventListener('timeupdate', stop);
    } }, `▶ 근거 구간만 다시 듣기 (${fmt(seg[0])}–${fmt(seg[1])})`);
    return b;
  }
  function segmentText(audioId, seg) {
    const cues = (C.audio[audioId] || {}).cues || [];
    return cues.filter(c => c.end > seg[0] + 0.1 && c.start < seg[1] - 0.1).map(c => c.t).join(' ');
  }

  // After a wrong answer: (listening) where did it break down? → replay the key part → (new questions) did the same cause recur?
  const STUCK = [['sound', '안 들렸다', '소리 듣기'], ['memory', '들었는데 잊었다', '기억하기'], ['judge', '기억했지만 선택지에서 헷갈렸다', '선택지 고르기'], ['vocab', '들었지만 뜻을 몰랐다', '어휘·표현']];
  const RECUR = [['same', '네, 같은 실수를 또 했다'], ['rulefail', '규칙은 아는데 풀 때 못 썼다'], ['other', '아니요, 다른 이유로 틀렸다'], ['unknown', '잘 모르겠다']];
  function wrongFollowup(rec, opts, onDone) {
    const wrap = h('div', { class: 'follow' });
    const stage2 = () => {
      if (!opts.askRecur) return onDone();
      const rules = myRules(rec.skill);
      wrap.append(h('div', { class: 'ask' },
        h('p', { class: 'stem' }, SKILL[rec.skill] ? `이번에도 '${SKILL[rec.skill].name}'에서 틀렸나요?` : '이번에도 같은 실수로 틀렸나요?'),
        SKILL[rec.skill] && SKILL[rec.skill].warning ? h('p', { class: 'small' }, '이 능력에서 자주 하는 실수: ', h('b', null, SKILL[rec.skill].warning)) : null,
        rules.length ? h('p', { class: 'small' }, '내가 전에 정한 규칙: ', h('b', null, rules[0].rule)) : h('p', { class: 'small muted' }, '이 능력에는 아직 내가 정한 규칙이 없습니다. 원본 오답을 확인할 때 만들 수 있습니다.'),
        h('div', { class: 'row' }, RECUR.map(([k, label]) => h('button', { class: 'tagb', onclick: e => {
          rec.recur = k; save(); e.currentTarget.parentNode.querySelectorAll('.tagb').forEach(x => { x.disabled = true; }); e.currentTarget.classList.add('sel'); onDone();
        } }, label)))));
    };
    if (!opts.audio) { stage2(); return wrap; }
    const ask = h('div', { class: 'ask' }, h('p', { class: 'stem' }, '어디서 막혔나요?'),
      h('div', { class: 'row' }, STUCK.map(([k, label]) => h('button', { class: 'tagb', onclick: e => {
        rec.stuck = k; save();
        ask.querySelectorAll('.tagb').forEach(x => { x.disabled = true; }); e.currentTarget.classList.add('sel');
        const seg = opts.seg;
        if (!seg) { stage2(); return; }
        const text = h('p', { class: 'segtext', hidden: true }, segmentText(opts.audio, seg));
        const after = h('div', { class: 'row', hidden: true }, [['clear', '다시 들으니 들린다'], ['still', '여전히 안 들린다']].map(([kk, l]) => h('button', { class: 'tagb', onclick: ev => {
          rec.reheard = kk; save(); after.querySelectorAll('.tagb').forEach(x => { x.disabled = true; }); ev.currentTarget.classList.add('sel'); text.hidden = false; stage2();
        } }, l)));
        wrap.append(h('div', { class: 'ask' }, h('p', { class: 'small muted' }, '스크립트를 보기 전에, 답을 결정한 부분만 다시 들어 보세요.'),
          segmentButton(opts.audio, seg, () => { after.hidden = false; }), after, text));
      } }, label))));
    wrap.append(ask);
    return wrap;
  }

  function renderOriginalCard(main, o, live, onDone, opts = {}) {
    if (!o.options && !o.ctest) {
      main.append(h('section', { class: 'card' }, h('p', { class: 'notice' }, '이 원본 오답의 원문(지문·보기)은 비공개 자료라 이 기기에서 불러오지 못했습니다. Mac에서 start.command로 열거나, 설정에서 GitHub 토큰을 넣으세요.'),
        h('p', { class: 'rule' }, '다음엔: ', o.rule), live ? h('button', { class: 'primary', onclick: onDone }, '넘어가기') : null));
      return;
    }
    const edit = D.edits[o.id] || {};
    const myVal = edit.my !== undefined ? edit.my : o.my;
    const box = h('section', { class: 'card' });
    main.append(box);
    // 재구성 음성(audioSets)이 없는 리스닝 원본은 소站 원본 음원만 쓴다 (불러올 수 있는 기기에서)
    if (o.audio || o.sec === 'L') {
      const p = o.audio ? Player(o.audio, { onPlay: () => {} }) : null;
      if (p) activePlayers.push(p);
      const note = h('div', { class: 'small muted' }, o.audio ? (C.audio[o.audio].note || '기록된 스크립트로 Kokoro가 만든 음성입니다 (원본 음원 아님).')
        : '원본 음원은 독점 TPO 자료를 불러올 수 있는 기기에서만 재생됩니다.');
      box.append(note);
      if (p) box.append(p);
      // 소站 원본 음원이 이 기기에서 열리면 (로컬 파일 또는 GitHub 토큰) 재구성 음성 대신 원본을 보여 준다
      if (o.sec === 'L' && window.ListenApp) listenApp().origSource(o.id, src => {
        if (!box.isConnected) return;
        const a = h('audio', { controls: true, preload: 'auto', src, class: 'orig-audio' });
        a.playbackRate = listenApp().rate();
        activePlayers.push({ stop: () => a.pause() });
        if (!p) { note.textContent = '원본 음원 (세트 전체)'; note.after(a); return; }
        p.stop(); p.style.display = 'none';
        note.replaceChildren('원본 음원 (세트 전체) · ', h('a', { href: 'javascript:void 0', onclick: () => { a.pause(); a.remove(); p.style.display = ''; note.textContent = '기록된 스크립트로 Kokoro가 만든 음성입니다 (원본 음원 아님).'; } }, '재구성 음성(Kokoro)으로 듣기'));
        note.after(a);
      });
    }
    if (o.passage) box.append(h('div', { class: 'passage' }, para(o.passage)));
    let answer = null; let conf = null;
    const t0 = now();
    const check = h('button', { class: 'primary', disabled: true }, '확인');
    const upd = () => { check.disabled = (o.ctest ? !answer : answer == null) || conf == null; };
    let blank = null;
    if (o.ctest) {
      const [a, b] = o.ctest.text.split('{{}}');
      blank = letterBlank(o.ctest.prefix, o.ctest.answer, { readOnly: !live,
        onChange: v => { answer = v; upd(); }, onEnter: () => { if (!check.disabled) check.click(); } });
      box.append(h('p', { class: 'ctest' }, a, blank.el, b));
      if (live) setTimeout(() => blank.focus(), 50);
    } else {
      box.append(h('p', { class: 'stem' }, o.stem));
      box.append(h('div', { class: 'opts' }, o.options.map((t, i) => h('button', { class: 'opt', onclick: e => {
        answer = i; box.querySelectorAll('.opt').forEach(x => x.classList.remove('sel')); e.currentTarget.classList.add('sel'); upd();
      } }, h('b', null, LETTERS[i]), ' ', t))));
    }
    if (!live) { box.append(originalFeedback(o, null, myVal)); return; }
    check.onclick = () => {
      const correct = o.ctest ? E.checkTyped(answer, o.ctest.prefix, o.ctest.answer) : answer === o.correct;
      const rec = logAttempt({ ref: o.id, skill: o.skill, tier: 'original', correct, answer, conf, verify: opts.verify || undefined, verifyOf: opts.verifyOf, ms: now() - t0 });
      check.remove(); box.querySelector('.conf')?.remove();
      if (opts.verify) box.append(verifyVerdict(correct, conf));
      box.querySelectorAll('input,.opt').forEach(x => x.disabled = true);
      if (blank) blank.mark(correct);
      if (!o.ctest) box.querySelectorAll('.opt').forEach((x, i) => { if (i === o.correct) x.classList.add('right'); else if (i === answer) x.classList.add('wrong'); });
      const holdBack = !correct && !!o.audio;
      box.append(originalFeedback(o, { answer, correct }, myVal, holdBack));
      if (holdBack) box.append(wrongFollowup(rec, { audio: o.audio, seg: o.seg }, () => box.append(evidenceBlock(o.evidence, o.audio), causeConfirm(o, onDone))));
      else if (opts.verify && correct) box.append(h('button', { class: 'primary', onclick: onDone }, '다음'));
      else box.append(causeConfirm(o, onDone));
    };
    box.append(confRow(v => { conf = v; upd(); }), check);
  }

  function evidenceBlock(evidence, audioId) {
    return h('div', { class: 'fb' }, evidence ? h('p', null, h('span', { class: 'lbl' }, '근거'), ' ', h('q', null, evidence)) : null,
      audioId ? transcript(audioId, [evidence]) : null);
  }

  function originalFeedback(o, now_, myVal, holdBack) {
    const optText = v => v == null ? '기록 없음' : o.ctest ? String(v) : `${LETTERS[v]}. ${o.options[v]}`;
    const right = o.ctest ? o.ctest.answer : `${LETTERS[o.correct]}. ${o.options[o.correct]}`;
    const rows = [
      ['당시 내 답', optText(myVal), D.edits[o.id] && D.edits[o.id].my !== undefined ? '직접 수정' : '기록'],
      now_ ? ['지금 내 답', o.ctest ? (now_.answer || '(빈칸)') : optText(now_.answer), now_.correct ? '정답' : '오답'] : null,
      ['정답', right, ''],
    ].filter(Boolean);
    return h('div', { class: 'fb' },
      h('table', { class: 'cmp' }, rows.map(r => h('tr', null, h('th', null, r[0]), h('td', null, r[1]), h('td', { class: 'tag' }, r[2])))),
      o.evidence && !holdBack ? h('p', null, h('span', { class: 'lbl' }, '근거'), ' ', h('q', null, o.evidence)) : null,
      h('p', null, h('span', { class: 'lbl' }, '결정적 차이'), ' ', o.diff),
      o.trap && o.trap !== 'UNKNOWN' ? h('p', null, h('span', { class: 'lbl ai' }, '왜 그럴듯했나 · AI 추정'), ' ', o.trap) : null,
      h('p', { class: 'rule' }, '다음엔: ', o.rule),
      (o.gaps || []).length ? h('p', { class: 'muted small' }, '기록 없음: ', o.gaps.join(' / ')) : null,
      o.audio && !holdBack ? transcript(o.audio, [o.evidence]) : null);
  }

  function causeConfirm(o, onDone) {
    const prev = D.origState[o.id];
    const note = h('textarea', { placeholder: '실제로 어떻게 생각했는지 (선택)', rows: 2 }, prev && prev.note || '');
    const rule = h('textarea', { class: 'myrule', placeholder: '예: ' + o.rule, rows: 2 }, prev && prev.myRule || '');
    const pick = cause => { D.origState[o.id] = { cause, note: note.value.trim(), myRule: rule.value.trim(), at: now() }; save(); onDone(); };
    return h('div', { class: 'cause' },
      h('p', null, h('span', { class: 'lbl ai' }, 'AI 추정 원인'), ' ', o.causeAI),
      h('p', { class: 'small muted' }, '이 분석이 그때 내 생각과 맞나요? (내가 확인한 원인과 AI 추정은 따로 저장됩니다)'),
      note,
      h('p', { class: 'small' }, h('b', null, '내 규칙'), ' — 다음에 이런 문제가 나오면 무엇을 할지 내 말로 한 줄 적으세요. 새 문제를 틀릴 때마다 이 규칙을 보여 주고, 같은 원인으로 틀렸는지 묻습니다.'),
      rule,
      h('button', { class: 'link small', onclick: () => { rule.value = o.rule; } }, 'AI 규칙을 가져와 고쳐 쓰기'),
      h('div', { class: 'row' },
        h('button', { class: 'ghost', onclick: () => pick('confirm') }, '맞아요'),
        h('button', { class: 'ghost', onclick: () => pick('other') }, '다른 이유'),
        h('button', { class: 'ghost', onclick: () => pick('unknown') }, '기억 안 나요')));
  }

  // Re-check result: was the earlier right answer real knowledge?
  function verifyVerdict(correct, conf) {
    return correct && conf >= 2 ? h('p', { class: 'verdict good' }, '알고 맞힘으로 확인 — 이 문제는 다시 확인하지 않습니다.')
      : correct ? h('p', { class: 'verdict' }, '맞혔지만 찍음 — 아직 아는 것으로 보지 않고, 며칠 뒤 다시 확인합니다.')
      : h('p', { class: 'verdict bad' }, '전에 맞힌 것은 확실한 실력이 아니었습니다 — 오답으로 다시 나옵니다.');
  }

  function confirmButton(label, armedLabel, cls, onConfirm) {
    let armed = false;
    const b = h('button', { class: cls, onclick: () => {
      if (!armed) { armed = true; b.textContent = armedLabel; b.classList.add('armed'); setTimeout(() => { if (armed) { armed = false; b.textContent = label; b.classList.remove('armed'); } }, 6000); return; }
      onConfirm();
    } }, label);
    return b;
  }

  // Scaffold steps (guided only): slot · choice · tag · pick · match · act
  function confRow(onPick) {
    let v = null;
    const row = h('div', { class: 'conf' }, h('span', { class: 'small muted' }, '얼마나 확신했나요'), CONF.map(([k, label]) => h('button', { class: 'tagb', onclick: e => {
      v = +k; row.querySelectorAll('.tagb').forEach(x => x.classList.remove('sel')); e.currentTarget.classList.add('sel'); onPick(v);
    } }, label)));
    return row;
  }

  function letterBlank(prefix, answer, { onChange, onEnter, readOnly } = {}) {
    const n = Math.max(1, answer.length - prefix.length);
    const cells = Array.from({ length: n }, (_, j) => h('input', {
      class: 'cw-slot', type: 'text', inputmode: 'text', autocomplete: 'off', autocapitalize: 'none', autocorrect: 'off',
      spellcheck: 'false', 'aria-label': `${prefix}, ${j + 1}번째 글자`, disabled: !!readOnly }));
    const value = () => cells.map(c => c.value).join('');
    const changed = () => onChange && onChange(value());
    cells.forEach((c, k) => {
      c.addEventListener('input', () => {
        // Usually one letter; a burst (autocomplete, mobile keyboard) spills into the following cells.
        const typed = c.value.replace(/[^a-z]/gi, '');
        const prev = c._prev || '';
        const letters = typed.length > 1 && prev && typed.startsWith(prev) ? typed.slice(prev.length) : typed;
        let j = k;
        for (const ch of [...letters].slice(0, n - k)) { cells[j].value = ch; j++; }
        if (!letters) c.value = '';
        if (letters) (cells[j] || cells[n - 1]).focus();
        changed();   // 포커스 이동 뒤에: onChange가 다음 빈칸으로 옮길 수 있게
      });
      c.addEventListener('beforeinput', () => { c._prev = c.value; });
      c.addEventListener('focus', () => c.select());
      c.addEventListener('keydown', e => {
        if (e.key === 'Backspace' && !c.value && k > 0) { e.preventDefault(); cells[k - 1].value = ''; cells[k - 1].focus(); changed(); }
        else if (e.key === 'ArrowLeft') { e.preventDefault(); cells[k - 1]?.focus(); }
        else if (e.key === 'ArrowRight') { e.preventDefault(); cells[k + 1]?.focus(); }
        else if (e.key === 'Enter') { e.preventDefault(); onEnter && onEnter(); }
      });
      c.addEventListener('paste', e => {
        e.preventDefault();
        let text = (e.clipboardData.getData('text') || '').trim().replace(/[^a-z]/gi, ''); let pos = k;
        if (text.toLowerCase().startsWith(prefix.toLowerCase()) && text.length === answer.length) { text = text.slice(prefix.length); pos = 0; }
        [...text].slice(0, n - pos).forEach((ch, j) => { cells[pos + j].value = ch; });
        changed(); cells[Math.min(n - 1, pos + text.length)].focus();
      });
    });
    const el = h('span', { class: 'cw' }, h('span', { class: 'cw-pre' }, prefix), h('span', { class: 'cw-slots' }, cells));
    return {
      el, value,
      focus: () => (cells.find(c => !c.value) || cells[n - 1]).focus(),
      disable: () => cells.forEach(c => { c.disabled = true; }),
      mark: ok => el.classList.add(ok ? 'ok' : 'bad'),
    };
  }

  // ---------- PROGRESS ----------
  function metricTile(label, val, sub, enough) {
    return h('div', { class: 'tile' }, h('div', { class: 'tl' }, label), h('div', { class: 'tv' }, enough ? val : '—'), h('div', { class: 'ts muted' }, enough ? sub : sub + ' · 기록 부족'));
  }
  function viewProgress(main) {
    const m = E.metrics(D, C);
    main.append(h('h1', null, '실력이 실제로 늘고 있을까'));
    // 영역별 지표: 최근 7일 vs 그 전 7일 (OVERHAUL.md 측정 표). 실전에 가까운 지표는 모의 모듈.
    const am = metricsNow();
    const cmp = (x, unit, lowerBetter) => {
      if (!x || x.now == null) return h('span', { class: 'muted' }, '기록 부족');
      const d = x.prev == null ? null : Math.round((x.now - x.prev) * 10) / 10;
      const good = d == null || d === 0 ? '' : (lowerBetter ? d < 0 : d > 0) ? ' good' : ' bad';
      return h('span', null, h('b', null, x.now + unit), d == null ? h('span', { class: 'muted small' }, ' (지난주 기록 없음)') : h('span', { class: 'small' + good }, ` (지난주 ${x.prev}${unit}, ${d > 0 ? '+' : ''}${d})`));
    };
    const mock = x => x ? h('span', null, h('b', null, x.pct + '%'), h('span', { class: 'muted small' }, ` 독점 TPO ${x.paper} · ${fmtDate(x.at)}`)) : h('span', { class: 'muted' }, '아직 없음');
    const row = (area, items) => h('tr', null, h('th', null, area), h('td', null, items[0].map(([l, v]) => h('div', null, h('span', { class: 'muted small' }, l + ' '), v))), h('td', null, items[1]));
    main.append(h('section', { class: 'card scroll' }, h('h2', null, '영역별 지표 (최근 7일 · 괄호는 그 전 7일)'),
      h('table', { class: 'grid' },
        h('tr', null, h('th', null, ''), h('th', null, '매일 지표'), h('th', null, '실전에 가까운 지표')),
        row('리스닝', [[['받아쓰기 단어 정확도', cmp(am.L.dictation, '%')], ['새 문제 정답률', cmp(am.L.newQ, '%')]], h('div', null, h('span', { class: 'muted small' }, '모의 모듈 L '), mock(am.L.mock))]),
        row('리딩', [[['새 문제 정답률', cmp(am.R.newQ, '%')], ['C-Test 정답률', cmp(am.R.ctest, '%')]], h('div', null, h('span', { class: 'muted small' }, '모의 모듈 R '), mock(am.R.mock))]),
        row('단어', [[['자주 틀린 단어 수', cmp(am.V.frequent, '개', true)]], h('div', null, h('span', { class: 'muted small' }, '틀린 세트 지문의 아는 단어 비율 '), am.V.known == null ? h('span', { class: 'muted' }, '기록 부족') : h('b', null, am.V.known + '%'))]),
        row('말하기', [[['L&R 단어 일치율', cmp(am.S.lr, '%')]], h('span', { class: 'muted' }, '—')]),   // Interview는 45초 타이머만이라 말 속도·멈춤 기록이 없다
        row('쓰기', [[['해커스 단어 수', cmp(am.W.words, '단어')], ['굵은 표현 적중', cmp(am.W.bold, '%')], ['문법 오류', cmp(am.W.errors, '개', true)]], h('span', { class: 'muted' }, '—')])),
      h('p', { class: 'small muted' }, '주 1회 비중 자동 조정은 영역마다 하나의 지표를 봅니다: 리스닝·리딩 새 문제 정답률, 단어 자주 틀린 단어 수, 말하기 L&R 일치율, 쓰기 굵은 표현 적중률. 그 지표가 지난주보다 오르지 않으면 그 영역 +5%p (설정에서 고정한 영역 제외).')));
    main.append(h('p', { class: 'muted small' }, '많이 풀었다고 실력이 는 것은 아닙니다. 실력은 처음 보는 문제(새 문제·유지 확인)로만 판단합니다.'));
    main.append(h('div', { class: 'tiles' },
      metricTile('새 문제 정답률', m.transfer.pct + '%', `${m.transfer.n}문항`, m.transfer.n >= 5),
      metricTile('유지 확인 정답률', m.retention.pct + '%', `${m.retention.n}문항`, m.retention.n >= 3),
      metricTile('같은 함정에 또 걸림', m.recurrence.repeats + '회', `함정 오답 ${m.recurrence.trapMisses}회 중`, m.transfer.n >= 5),
      metricTile('확신하고 틀림', m.confidentMiss.n + '회', `새 문제 ${m.confidentMiss.of}개 중`, m.transfer.n >= 5),
      metricTile('다시 확인: 알고 맞힘', m.verify.n ? Math.round(100 * m.verify.known / m.verify.n) + '%' : '—', `${m.verify.n}개 중 · 찍어서 맞힘 ${m.verify.guessed} · 틀림 ${m.verify.lost}`, m.verify.n >= 1),
      metricTile('원본 다시 맞힘 (참고)', m.originalRedo.pct + '%', `${m.originalRedo.n}개 · 답을 기억했을 수 있음`, m.originalRedo.n >= 1),
      metricTile('활동', m.activity.attempts + '문항', `${m.activity.days}일 · ${Math.round(m.activity.ms / 60000)}분` + (m.activity.legacy ? ` · 옛 AI 문제 ${m.activity.legacy}건은 정답률에서 뺌` : ''), true)));

    // Old-site strengths: my own recurrence verdicts + where listening breaks down.
    const rc = m.recur, nRc = Object.values(rc).reduce((a, b) => a + b, 0);
    const st = m.stuck, nSt = Object.values(st).reduce((a, b) => a + b, 0);
    const bar = (label, n, of) => h('div', { class: 'hbar' }, h('span', null, label), h('div', { class: 'hb' }, h('div', { style: `width:${of ? 100 * n / of : 0}%` })), h('b', null, n));
    main.append(h('section', { class: 'card' }, h('h2', null, '새 문제를 틀렸을 때 내가 고른 원인'),
      nRc ? [bar('같은 실수를 또', rc.same, nRc), bar('규칙은 아는데 못 씀', rc.rulefail, nRc), bar('다른 이유', rc.other, nRc), bar('모르겠음', rc.unknown, nRc),
        h('p', { class: 'small muted' }, '"같은 원인"은 줄었는데 "적용 못함"이 남아 있다면, 규칙은 이해했으니 실전에서 적용하는 연습이 더 필요하다는 뜻입니다.')]
        : h('p', { class: 'muted small' }, '아직 기록이 없습니다. 새 문제를 틀리면 같은 원인으로 틀렸는지 묻습니다.')),
      h('section', { class: 'card' }, h('h2', null, '리스닝 오답: 어디서 막혔나'),
        nSt ? [STUCK.map(([k, label, tag]) => bar(`${label} (${tag})`, st[k], nSt)),
          h('p', { class: 'small muted' }, `근거 구간을 다시 들었을 때: 들린다 ${m.reheard.clear} · 여전히 안 들린다 ${m.reheard.still}. "안 들렸다"인데 다시 들어도 안 들리는 경우가 많으면 소리 듣기를, "잊었다"가 많으면 노트와 기억하기를 먼저 연습하세요.`)]
          : h('p', { class: 'muted small' }, '아직 기록이 없습니다. 리스닝 문제를 틀리면 어디서 막혔는지 묻습니다.')));

    const table = E.skillTable(D, C, now());
    main.append(h('section', { class: 'card' }, h('h2', null, '능력별 상태'),
      h('table', { class: 'grid' },
        h('tr', null, h('th', null, '능력'), h('th', null, '상태'), h('th', null, '새 문제 (최근 8)'), h('th', null, '원본 확인')),
        table.map(r => h('tr', { onclick: () => go('#/skill/' + r.skill.id) },
          h('td', null, r.skill.name), h('td', null, chip(r.st.state)),
          h('td', null, dots(r.st.recent), ' ', r.st.recent.length ? `${r.st.recent.filter(a => a.correct).length}/${r.st.recent.length}` : ''),
          h('td', null, `${r.st.reviewed}/${r.st.originals}`))))));

    main.append(h('section', { class: 'card' }, h('h2', null, 'TPO 기록 (확인된 숫자만 · 공식 점수로 환산하지 않음)'),
      h('table', { class: 'grid' }, h('tr', null, h('th', null, ''), h('th', null, 'Reading'), h('th', null, 'C-Test'), h('th', null, 'Listening'), h('th', null, '오답')),
        C.tests.map(t => h('tr', null, h('td', null, `${t.id} (${t.date.slice(5)})`),
          h('td', null, frac(t.reading)), h('td', null, frac(t.ctest)), h('td', null, t.listening ? frac(t.listening) : '전체 문항 수 모름'), h('td', null, t.errors)))),
      h('p', { class: 'small muted' }, '다음 TPO를 풀면 오답을 같은 8개 능력으로 분류해 content/originals.json에 추가하세요. 앱의 새 문제 결과와 실제 TPO 결과가 같은 방향으로 움직이는지가 가장 확실한 확인입니다.')));
  }
  function frac(x) { return x ? `${x[0]}/${x[1]} (${Math.round(100 * x[0] / x[1])}%)` : '—'; }

  // ---------- TPO reports (date / test) ----------
  function viewTests(main) {
    const tests = C.tests.slice().sort((a, b) => a.date.localeCompare(b.date));
    const matrix = E.testMatrix(C);
    const table = Object.fromEntries(E.skillTable(D, C, now()).map(r => [r.skill.id, r]));
    main.append(h('h1', null, '모의고사별 오답'),
      h('p', { class: 'muted small' }, '능력별 오답 개수입니다 (주 능력 기준). 회차마다 문항 수가 달라 개수만으로 실력 변화를 단정할 수 없으니, 같은 능력의 오답이 2회 이상 연속으로 줄어드는지 보세요.'));
    main.append(h('section', { class: 'card scroll' }, h('table', { class: 'grid matrix' },
      h('tr', null, h('th', null, '능력'), tests.map(t => h('th', null, t.id, h('br'), h('span', { class: 'muted' }, t.date.slice(5))))),
      matrix.map(r => h('tr', null, h('td', null, SKILL[r.skill].name, ' ', chip(table[r.skill].st.state)),
        r.counts.map((n, i) => h('td', { class: 'num' + (n && i && r.counts[i - 1] ? ' hot' : '') + (!n && i && r.counts[i - 1] ? ' cool' : '') }, n || '·')))),
      h('tr', null, h('td', { class: 'muted' }, '합계 (분석 불가 포함)'), tests.map(t => h('td', { class: 'num' }, C.originals.filter(o => o.test === t.id).length))))));
    const relapsed = Object.values(table).filter(r => r.st.realRelapses && r.st.realRelapses.length);
    if (relapsed.length) main.append(h('p', { class: 'notice' }, '"개선"이 된 뒤 실제 모의고사에서 다시 틀린 능력: ',
      relapsed.map(r => `${r.skill.name} (${r.st.realRelapses.join(', ')})`).join(' · '), '. 오늘 훈련에 다시 넣습니다.'));
    for (const t of tests.slice().reverse()) {
      const rep = t.report || {};
      const list = C.originals.filter(o => o.test === t.id);
      const tag = k => ({ repeat: '재발', new: '새 패턴', improved: '개선 신호' })[k];
      main.append(h('section', { class: 'card' },
        h('h2', null, `${t.id} · ${t.date}`, h('span', { class: 'muted small' }, `오답 ${list.length}`)),
        h('p', { class: 'small muted' }, ['reading', 'ctest', 'listening'].map(k => t[k] ? `${({ reading: 'Reading', ctest: 'C-Test', listening: 'Listening' })[k]} ${frac(t[k])}` : null).filter(Boolean).join(' · ') || '성적 기록 없음'),
        rep.headline ? h('p', { class: 'headline' }, rep.headline) : null,
        (rep.findings || []).length ? h('ul', { class: 'findings' }, rep.findings.map(f => h('li', null,
          h('b', null, f.skill ? SKILL[f.skill].name : '기타'), tag(f.recurrence) ? h('span', { class: 'chip rc-' + f.recurrence }, tag(f.recurrence)) : null, ' ', f.text))) : null,
        rep.next ? h('p', { class: 'rule' }, '다음 훈련: ', rep.next) : null,
        h('details', null, h('summary', null, `오답 ${list.length}개 보기`),
          h('ul', { class: 'olist' }, list.map(o => h('li', { onclick: () => go('#/orig/' + o.id) },
            h('div', null, h('b', null, o.id), ' ', o.set, ' · ', h('span', { class: 'muted' }, o.qtype), ' ', SKILL[o.skill] ? h('span', { class: 'chip' }, SKILL[o.skill].name) : h('span', { class: 'chip' }, '분석 불가')),
            h('div', { class: 'small muted' }, o.diff || (o.gaps || []).join(' '))))))));
    }
    main.append(h('p', { class: 'small muted' }, '새 모의고사 추가: 틀린 문제 캡처를 tpo오답/<날짜>_<회차>/ 폴더에 넣고 Claude에게 "<회차> 오답 분석해서 추가해줘"라고 요청하세요 (절차: toefl-coach/CLAUDE.md).'));
  }

  // ---------- SKILL DETAIL ----------
  function viewSkill(main, id) {
    const sk = SKILL[id]; if (!sk) return go('#/progress');
    const r = E.skillTable(D, C, now()).find(x => x.skill.id === id);
    main.append(h('p', { class: 'kicker' }, h('a', { href: '#/progress' }, '← 변화')),
      h('h1', null, sk.name, ' ', chip(r.st.state)),
      h('p', null, sk.oneLine),
      h('section', { class: 'card move' }, h('h2', null, '풀이 순서'), h('ol', null, sk.move.map(m => h('li', null, m))), h('p', { class: 'warn' }, sk.warning)),
      h('section', { class: 'card' }, h('h2', null, '근거와 현재 기록'),
        h('p', null, `원본 오답: 주 원인 ${r.ev.primary}개 · 관련 ${r.ev.secondary}개 · ${r.ev.tests.join(', ')}`),
        h('p', null, '새 문제 (최근): ', dots(r.st.recent), ` 누적 ${r.st.mastery}문항`),
        r.st.dueAt ? h('p', null, `다음 유지 확인: ${fmtDate(r.st.dueAt)}`) : null,
        h('p', { class: 'small muted' }, '"개선" 기준: 힌트 없이 최근 새 문제 5개 중 4개 이상 맞힘, 2번 이상의 훈련에 걸쳐 풂, 확신하고 틀린 문제 없음. 그 뒤 유지 확인까지 통과하면 "유지됨"이 됩니다.')));
    const list = C.originals.filter(o => o.skill === id || (o.skills2 || []).includes(id));
    main.append(h('section', { class: 'card' }, h('h2', null, `원본 오답 ${list.length}개`),
      h('ul', { class: 'olist' }, list.map(o => {
        const st = D.origState[o.id];
        return h('li', { onclick: () => go('#/orig/' + o.id) },
          h('div', null, h('b', null, o.id), ' ', o.set, ' · ', h('span', { class: 'muted' }, o.qtype), o.skill !== id ? h('span', { class: 'chip' }, '관련') : null),
          h('div', { class: 'small muted' }, o.diff),
          h('div', { class: 'small' }, st ? ({ confirm: '원인 확인함', other: '다른 이유로 표시', unknown: '원인 기억 안 남' })[st.cause] : '아직 확인 안 함'));
      }))));
  }

  // ---------- ORIGINAL (read + edit) ----------
  function viewOriginal(main, id) {
    const o = ORIG[id]; if (!o) return go('#/progress');
    main.append(h('p', { class: 'kicker' }, h('a', { href: '#/skill/' + (o.skill === 'UNKNOWN' ? 'TARGET' : o.skill) }, '← ' + (SKILL[o.skill] ? SKILL[o.skill].name : '목록'))),
      h('h1', null, `${o.id} · ${o.set}`), h('p', { class: 'muted' }, `${o.test} · ${o.qtype}`));
    if (o.skill === 'UNKNOWN') { main.append(h('p', null, (o.gaps || []).join(' '))); return; }
    renderOriginalCard(main, o, false);
    const st = D.origState[o.id];
    const edit = D.edits[o.id] || {};
    const sel = o.options ? h('select', null, h('option', { value: '' }, '(변경 없음)'), h('option', { value: 'null' }, '기록 없음'),
      o.options.map((t, i) => h('option', { value: i, selected: edit.my === i }, LETTERS[i] + '. ' + t)))
      : h('input', { placeholder: '당시 입력한 단어', value: edit.my || '' });
    const note = h('textarea', { rows: 2, placeholder: '메모 / 실제 사고 과정' }, (st && st.note) || edit.note || '');
    main.append(h('section', { class: 'card' }, h('h2', null, '기록 수정'),
      h('p', { class: 'small muted' }, '원본 기록은 그대로 두고, 고친 내용은 따로 저장해 화면에 "직접 수정"으로 표시합니다.'),
      st ? h('p', null, '확인한 원인: ', ({ confirm: 'AI 분석과 같음', other: '다른 이유', unknown: '기억 안 남' })[st.cause]) : null,
      h('label', { class: 'field' }, '당시 내 답', sel), note,
      h('button', { class: 'ghost', onclick: () => {
        const v = sel.value;
        const e = D.edits[o.id] || {};
        if (o.options) { if (v !== '') e.my = v === 'null' ? null : +v; } else if (sel.value.trim()) e.my = sel.value.trim();
        e.note = note.value.trim(); e.at = now(); D.edits[o.id] = e;
        if (D.origState[o.id]) D.origState[o.id].note = e.note;
        save(); render();
      } }, '저장')));
  }

  // ---------- SETTINGS ----------
  function viewSettings(main) {
    const date = h('input', { id: 'set-date', type: 'date', value: D.settings.examDate || '' });
    const mins = h('input', { id: 'set-mins', type: 'number', min: 10, max: 300, step: 5, value: D.settings.minutes || 60 });
    const w = E.weights(D); const fixed = D.settings.weights || {};
    const wIn = Object.fromEntries(E.BLOCKS.map(k => [k, h('input', { type: 'number', min: 0, max: 80, step: 5, value: fixed[k] != null ? fixed[k] : '', placeholder: '자동 ' + Math.round(w[k]) })]));
    const auto = D.weightAuto && D.weightAuto.raised && D.weightAuto.raised.length ? `이번 주 자동 조정: ${D.weightAuto.raised.map(k => BLOCK[k][1]).join('·')} +5%p (지난주보다 지표가 오르지 않음)` : '자동 조정: 아직 없음 (주 1회, 지표가 오르지 않은 영역 +5%p)';
    const msg = h('p', { class: 'small', role: 'status' });
    const box = h('textarea', { id: 'data-box', class: 'databox', rows: 5, placeholder: '내보낸 기록(JSON)을 여기에 붙여넣거나, 파일을 선택하세요.' });
    const offerImport = text => {
      try {
        const d = Store.parseImport(text);
        msg.replaceChildren(`가져올 기록: 시도 ${d.attempts.length}건. 현재 기록(${D.attempts.length}건)을 대체합니다. `,
          confirmButton('가져오기 실행', '한 번 더 누르면 대체됩니다', 'ghost', () => { D = d; save(); render(); }));
      } catch (err) { msg.textContent = '가져오기 실패: ' + err.message + '. 이 앱의 "내보내기"로 만든 JSON인지 확인하세요.'; }
    };
    const file = h('input', { id: 'data-file', type: 'file', accept: 'application/json', hidden: true, onchange: async e => {
      const f = e.target.files[0]; if (f) offerImport(await f.text());
    } });
    main.append(h('h1', null, '설정'),
      h('section', { class: 'card' },
        h('label', { class: 'field' }, '시험일', date),
        h('label', { class: 'field' }, '하루 총 시간(분, 자유 입력)', mins),
        h('h3', null, '영역 비중 (%)'),
        h('p', { class: 'small muted' }, '비워 두면 기본값 + 주간 자동 조정. 숫자를 넣으면 그 영역은 고정되고 나머지가 100%에 맞춰집니다.'),
        h('div', { class: 'wgrid' }, E.BLOCKS.map(k => h('label', { class: 'field' }, `${BLOCK[k][0]} ${BLOCK[k][1]}`, wIn[k]))),
        h('p', { class: 'small muted' }, auto),
        h('button', { class: 'primary', onclick: () => {
          D.settings.examDate = date.value || null; D.settings.minutes = Math.max(10, Math.min(300, +mins.value || 60));
          const ws = {}; for (const k of E.BLOCKS) if (wIn[k].value !== '') ws[k] = Math.max(0, Math.min(80, +wIn[k].value));
          D.settings.weights = ws;
          if (D.plan && !D.plan.blocks.some(b => b.cursor || b.done)) D.plan = null;   // 아직 시작 안 한 오늘 계획은 새 설정으로 다시
          save(); go('#/');
        } }, '저장')),
      syncCard(),
      h('section', { class: 'card' }, h('h2', null, '데이터'),
        h('p', { class: 'small muted' }, `학습 기록은 이 브라우저에만 저장됩니다 (시도 ${D.attempts.length}건). 다른 기기나 브라우저로 옮기거나 백업하려면, 내보내기로 복사한 내용을 그쪽의 가져오기 칸에 붙여넣으세요.`),
        h('div', { class: 'row' },
          h('button', { class: 'ghost', onclick: async () => {
            const json = JSON.stringify(Object.assign({ exportedAt: new Date().toISOString(), app: 'toefl-coach' }, D));
            box.value = json;
            try {
              await navigator.clipboard.writeText(json);
              msg.textContent = '기록을 클립보드에 복사했습니다. 메모 앱 등에 붙여넣어 보관하세요.';
            } catch (e) {
              box.focus(); box.select();
              msg.textContent = '아래 칸의 내용을 전체 선택해 복사해 두세요.';
            }
            // Locally the file download also works; inside the artifact viewer it is ignored.
            try {
              const a = h('a', { href: URL.createObjectURL(Store.exportBlob(D)), download: `toefl-coach-${E.dayStr(now())}.json` });
              document.body.append(a); a.click(); a.remove();
            } catch (e) { /* download blocked */ }
            D.lastBackup = now(); save();
          } }, '내보내기 (복사)'),
          h('button', { class: 'ghost', onclick: () => box.value.trim() ? offerImport(box.value) : (msg.textContent = '먼저 아래 칸에 내보낸 기록을 붙여넣으세요.') }, '붙여넣은 기록 가져오기'),
          h('button', { class: 'ghost', onclick: () => file.click() }, '파일에서 가져오기'), file),
        box, msg,
        D.lastBackup ? h('p', { class: 'small muted' }, '마지막 내보내기: ' + new Date(D.lastBackup).toLocaleString()) : null),
      h('section', { class: 'card' }, h('h2', null, '오늘 계획 다시 만들기'),
        h('p', { class: 'small muted' }, '오늘 계획을 지금까지의 기록으로 다시 짭니다. 이미 푼 기록은 그대로 남고, 끝내지 못한 할 일은 버려집니다.'),
        h('button', { class: 'ghost', onclick: () => { D.plan = null; save(); go('#/'); } }, '다시 계획')),
      h('section', { class: 'card' }, h('h2', null, '초기화'),
        h('p', { class: 'small muted' }, '모든 학습 기록을 지웁니다. 되돌릴 수 없으니 먼저 내보내기를 하세요.'),
        confirmButton('모든 기록 지우기', '한 번 더 누르면 모두 지워집니다', 'danger', () => { D = Store.blank(); save(); go('#/'); })),
      h('p', { class: 'small muted' }, `콘텐츠 빌드: ${C.builtAt} · 원본 오답 ${C.originals.length} · 소站 문제 ${E.poolItems(C).length}단위 · 옛 AI 문제 기록 ${E.legacyAttempts(D, C)}건 (숙달 판정 제외, 기록은 보존)`));
  }

  // ---------- boot: wait for the synced record (claude.ai) before the first real render ----------
  app.append(h('main', { class: 'page' }, h('p', { class: 'muted' }, '기록을 불러오는 중…')));
  // 비공개 원문(원본 오답 지문·보기, 재구성 스크립트, 소站 쓰기 문제 문장)을 공개 메타데이터에 합친다.
  function mergePrivate() {
    const Z = window.ZHAN_ORIG; if (!Z) return;
    for (const o of C.originals) Object.assign(o, Z.originals[o.id] || {});
    for (const [sid, a] of Object.entries(Z.audio || {})) if (C.audio[sid]) Object.assign(C.audio[sid], a);
    for (const [kind, m] of Object.entries(Z.sw || {})) for (const it of (C.sw[kind] || [])) Object.assign(it, m[it.id] || {});
  }
  const boot = () => {
    D = E.migrateRecord(Store.load());
    keepApp().mount();
    const go2 = () => { mergePrivate(); render(); };
    if (window.ZhanData) ZhanData.loadAll([['orig', 'ZHAN_ORIG']], go2); else go2();
  };
  if (window.Sync) {
    Sync.ready.then(boot);
    Sync.onChange((what, key) => {
      if (what === 'status') { const el = document.getElementById('sync-label'); if (el) el.replaceWith(syncLabel()); return; }
      if (what !== 'remote') return;
      const view = (location.hash || '#/').split('/')[1];
      // 다른 기기 기록이 오면 목록·현황 화면만 다시 그린다. 문제를 푸는 중이거나 글을 쓰는 화면은 그대로 둔다 (쓰던 글·풀던 문제가 날아가지 않게).
      const [, , arg] = (location.hash || '#/').split('/');
      const idle = ['', 'wrong', 'progress', 'settings'].includes(view) || (view === 'room' && arg !== 'item');
      if (key === 'toeflcoach.v1' && view !== 'do') { D = E.migrateRecord(Store.load()); if (idle) render(); }
      if (key.startsWith('toefl-sw') && view === 'sw' && !swApp().busy()) render();
      if (key.startsWith('toefl-keep') && view === 'keep') render();
      if (key.startsWith('toefl-vocab') && vocabMode !== 'flow') { if (V) V.deactivate(); V = null; if (view === 'vocab') render(); }
    });
  } else boot();
})();
