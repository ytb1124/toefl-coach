/* UI — one clear action per screen. Views: 오늘 / 세션 / 변화 / Skill 상세 / 원본 오답 / 설정 */
(function () {
  'use strict';
  const C = window.CONTENT;
  const E = window.Engine;
  let D = Store.blank(); // replaced by the synced record once Sync is ready (see boot at the bottom)
  const app = document.getElementById('app');
  const SKILL = Object.fromEntries(C.skills.map(s => [s.id, s]));
  const ITEM = Object.fromEntries(C.items.map(i => [i.id, i]));
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
    const audio = new Audio(meta ? meta.src : '');
    audio.preload = 'auto';
    const bar = h('div', { class: 'bar' }, h('div', { class: 'fill' }));
    const time = h('span', { class: 'time' }, meta && meta.dur ? fmtSec(meta.dur) : '');
    const info = h('span', { class: 'muted small' });
    const btn = h('button', { class: 'play', 'aria-label': '재생' }, '▶');
    const wrap = h('div', { class: 'player' }, btn, h('div', { class: 'pbody' }, bar, h('div', { class: 'prow' }, time, info)));
    function fmtSec(s) { s = Math.round(s); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); }
    function refresh() {
      const left = maxPlays - plays;
      if (maxPlays === Infinity) info.textContent = plays ? `${plays}회 들음 · 다시 듣기 가능` : '연습 모드 · 다시 듣기 가능';
      else info.textContent = left > 0 ? '실전 조건 · 1회만 재생' : '재생 완료 (실전 조건)';
      btn.disabled = maxPlays === Infinity ? false : (!audio.paused || left <= 0);
    }
    btn.onclick = () => {
      if (!meta) return;
      if (!audio.paused) { audio.pause(); btn.textContent = '▶'; return; }
      if (audio.ended || audio.currentTime === 0) { if (plays >= maxPlays) return; plays++; opts.onPlay && opts.onPlay(plays); }
      audio.play().catch(() => { info.textContent = '재생 실패 — audio 폴더를 확인하세요'; });
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
  window.addEventListener('hashchange', render);
  function render() {
    stopAudio();
    const [, view, arg] = (location.hash || '#/').split('/');
    app.innerHTML = '';
    window.scrollTo(0, 0);
    if (view !== 'vocab' && V) { V.deactivate(); vocabMode = 'home'; }
    if (view === 'session') return viewSession();
    app.append(nav(view || ''));
    const main = h('main', { class: 'page' });
    app.append(main);
    if (view === 'progress') viewProgress(main);
    else if (view === 'skill') viewSkill(main, arg);
    else if (view === 'orig') viewOriginal(main, arg);
    else if (view === 'settings') viewSettings(main);
    else if (view === 'tests') viewTests(main);
    else if (view === 'vocab') viewVocab(main);
    else if (view === 'sw') swApp().view(main, (location.hash || '').split('/').slice(2), render);
    else if (view === 'listen') listenApp().view(main, (location.hash || '').split('/').slice(2), render);
    else if (view === 'read') readApp().view(main, (location.hash || '').split('/').slice(2));
    else viewToday(main);
  }
  function nav(cur) {
    const link = (hash, label, key) => h('a', { href: hash, class: cur === key ? 'on' : '' }, label);
    return h('header', { class: 'nav' }, h('div', { class: 'brandbox' }, h('span', { class: 'brand' }, 'TOEFL 교정 코치'), syncLabel()),
      h('nav', null, link('#/', '오늘', ''), link('#/vocab', '단어', 'vocab'), link('#/read', '리딩', 'read'), link('#/listen', '리스닝', 'listen'), link('#/sw', '말하기·쓰기', 'sw'), link('#/progress', '변화', 'progress'), link('#/tests', 'TPO', 'tests'), link('#/settings', '설정', 'settings')));
  }

  // ---------- sync status ----------
  function syncLabel() {
    const st = window.Sync ? Sync.status() : { mode: 'local', label: '이 기기에만 저장' };
    const title = st.mode === 'cloud' ? 'claude.ai 계정에 저장되어 어느 기기에서 열어도 이어집니다' : st.mode === 'jsonbin' ? 'jsonbin에 저장되어 동기화 코드를 넣은 모든 기기에서 이어집니다' : '설정 → 기기 동기화에서 연결할 수 있습니다';
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
        h('p', { class: 'small muted' }, '다른 기기에서는 이 페이지의 설정 → 기기 동기화에 아래 동기화 코드를 한 번 붙여넣으면 같은 기록으로 이어집니다. 코드에는 jsonbin 키가 들어 있으니 다른 사람에게 보내지 마세요.'),
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
      h('p', { class: 'small muted' }, 'jsonbin.io에 로그인 → API Keys에서 X-Master-Key를 복사해 넣으세요. 이 기기의 지금 기록으로 저장소를 만들고, 다른 기기에 넣을 동기화 코드를 보여 줍니다.'),
      keyIn,
      h('button', { class: 'ghost', onclick: e => {
        const b = e.currentTarget; b.disabled = true; msg.textContent = '저장소를 만드는 중…';
        J.createWithKey(keyIn.value).then(code => {
          msg.textContent = '';
          keyIn.value = '';
          created.replaceChildren(h('div', { class: 'fb good' },
            h('p', null, h('b', null, '연결했습니다.'), ' 다른 기기에서는 설정 → 기기 동기화에 이 코드를 한 번 붙여넣으세요.'),
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
  const readApp = () => RD || (RD = ReadApp.create({ h, toast, go, storage: window.Sync || localStorage, link: origLink }));

  // ---------- VOCAB: the original word page's '오늘 암기' flow, run unchanged (app/vocab.js) ----------
  let V = null, vocabMode = 'home';
  const vocabStage = h('div', { class: 'vocab-stage' });
  function vocabApp() {
    if (!V && window.VocabApp) {
      V = VocabApp.create(vocabStage, window.Sync || localStorage, {
        home: () => { vocabMode = 'home'; if (V && (location.hash || '').startsWith('#/vocab')) render(); },
        toast,
        changed: () => {},
      });
    }
    return V;
  }
  function vocabFlow(startFn) { if (startFn()) { vocabMode = 'flow'; render(); } }

  function viewVocab(main) {
    const api = vocabApp();
    if (!api) { main.append(h('p', { class: 'notice' }, '단어 모듈을 불러오지 못했습니다. 새로고침해 주세요.')); return; }
    if (vocabMode === 'flow') {
      main.classList.add('vocab-flow');
      main.append(h('button', { class: 'link small', onclick: () => { api.deactivate(); vocabMode = 'home'; render(); } }, '← 세트 목록 (진행 상황은 저장됩니다)'), vocabStage);
      return;
    }
    main.append(h('h1', null, '단어 암기'),
      h('p', { class: 'muted small' }, `원본 단어장(${api.wordCount().toLocaleString()}개)의 '오늘 암기 시작'과 같은 방식으로 복습 단어를 30개씩 암기합니다: 먼저 의미 연결 → 6개 묶음 → 간격을 둔 철자 회상 → 최종 재시험.`));
    if (!api.hasData()) { main.append(vocabImportCard(api, true)); return; }

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
        h('h2', null, `고정 단어 ${plan.words.length.toLocaleString()}개 · ${total}세트`, h('span', { class: 'muted small' }, `${done} / ${total}세트 완료`)),
        h('div', { class: 'meter' }, h('div', { style: `width:${total ? 100 * done / total : 0}%` })),
        h('p', { class: 'muted small' }, `이 ${plan.words.length.toLocaleString()}개는 영구 고정되어 더해지거나 빠지지 않습니다 (${E.dayStr(plan.createdAt).replace(/-/g, '.')} 고정). 세트를 끝내면 날짜가 기록되고, 아무 세트나 눌러 다시 할 수 있어요.`));
      if (!r && next != null) sec.append(h('button', { class: 'primary', onclick: () => vocabFlow(() => api.start(next)) }, `세트 ${next + 1} 암기 시작 (${api.chunkWords(next).length}개)`));
      if (next == null) sec.append(h('p', { class: 'rule' }, '모든 세트를 한 번씩 끝냈습니다. 세트를 눌러 다시 복습할 수 있습니다.'));
      const grid = h('div', { class: 'setgrid' });
      for (let i = 0; i < total; i++) {
        const d = plan.done[i];
        grid.append(h('button', { class: 'setb' + (d ? ' done' : '') + (i === next ? ' next' : ''), title: api.chunkWords(i).map(w => w.en).join(', '),
          onclick: () => vocabFlow(() => api.start(i)) }, h('b', null, `세트 ${i + 1}`), h('span', null, d ? d.slice(5).replace('-', '/') + ' 완료' : `${api.chunkWords(i).length}개`)));
      }
      sec.append(grid);
      if (next != null) sec.append(h('details', null, h('summary', null, `세트 ${next + 1} 단어 미리 보기`),
        h('ul', { class: 'wordlist' }, api.chunkWords(next).map(w => h('li', null, h('b', null, w.en), ' ', h('span', { class: 'muted' }, w.ko))))));
      main.append(sec);
    }
    main.append(h('details', { class: 'card' }, h('summary', null, '단어장 기록 다시 가져오기'), vocabImportCard(api, false)));
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

  // ---------- TODAY ----------
  function whyLine(r) {
    const ev = r.ev, st = r.st;
    const parts = [`원본 오답 ${ev.primary}개` + (ev.secondary ? ` (+관련 ${ev.secondary})` : '') + ` · ${ev.tests.join('·')}`];
    if (st.recent.length) parts.push(`새 문제 ${st.recent.filter(a => a.correct).length}/${st.recent.length}`);
    else parts.push('새 문제 기록 없음');
    if (st.state === 'RELAPSED') parts.push('개선 후 다시 틀림');
    return parts.join(' · ');
  }

  function viewToday(main) {
    const left = E.daysLeft(D.settings.examDate, now());
    if (!D.settings.examDate) {
      const date = h('input', { type: 'date', min: E.dayStr(now()) });
      const mins = h('select', null, [30, 40, 45, 60].map(m => h('option', { value: m, selected: m === D.settings.minutes }, m + '분')));
      main.append(h('section', { class: 'card hero' },
        h('h1', null, '시험 날짜를 알려주세요'),
        h('p', { class: 'muted' }, '남은 날에 맞춰 복습 간격과 새 문제 비중을 매일 다시 계산합니다.'),
        h('label', { class: 'field' }, '시험일', date),
        h('label', { class: 'field' }, '하루 학습 시간', mins),
        h('button', { class: 'primary', onclick: () => {
          if (!date.value) { date.focus(); return; }
          D.settings.examDate = date.value; D.settings.minutes = +mins.value; save(); render();
        } }, '계획 만들기')));
      return;
    }

    main.append(h('p', { class: 'dday' }, left > 0 ? `D-${left}` : left === 0 ? 'D-day' : '시험일 지남', h('span', { class: 'muted' }, ` · ${fmtDate(E.dayStart(D.settings.examDate))} 시험 · 하루 ${D.settings.minutes}분`)));

    const s = D.session;
    const today = E.dayStr(now());
    if (s && s.date === today && !s.done) {
      const total = s.steps.length - 1;
      main.append(h('section', { class: 'card hero' },
        h('h1', null, '이어서 하기'),
        h('p', { class: 'muted' }, `${Math.min(s.cursor + 1, total)} / ${total} 단계 · 저장된 곳부터 다시 시작합니다.`),
        focusList(s), h('button', { class: 'primary', onclick: () => go('#/session') }, '이어하기')));
    } else if (s && s.date === today && s.done) {
      main.append(h('section', { class: 'card hero' },
        h('h1', null, '오늘 훈련 완료'),
        h('p', { class: 'muted' }, '내일 계획은 오늘 결과로 다시 계산됩니다. 더 하고 싶다면 새 문제로만 구성된 추가 세트를 풀 수 있어요.'),
        h('button', { class: 'ghost', onclick: () => startSession(true) }, '추가 세트 시작')));
    } else {
      const plan = E.buildSession(D, C, now());
      const table = E.skillTable(D, C, now());
      const row = id => table.find(r => r.skill.id === id);
      main.append(h('section', { class: 'card hero' },
        h('h1', null, '오늘의 훈련'),
        h('p', { class: 'muted' }, `약 ${Math.max(plan.estMinutes, 10)}분 · ${plan.steps.filter(x => x.type === 'item').length}문항` +
          (left != null && left <= 4 ? ' · 시험 직전: 새 유형 대신 섞어 풀기 비중↑' : '')),
        plan.focus.length ? h('ol', { class: 'focus' }, plan.focus.map(id => h('li', null,
          h('div', { class: 'fname' }, SKILL[id].name, ' ', chip(row(id).st.state)),
          h('div', { class: 'muted small' }, whyLine(row(id)))))) : h('p', null, '오늘은 섞어 풀기로 전체 점검만 합니다.'),
        plan.retention.length ? h('p', { class: 'small' }, '+ 유지 확인: ', plan.retention.map(id => SKILL[id].name).join(', ')) : null,
        h('button', { class: 'primary', onclick: () => startSession(false) }, '시작하기')));
      if (plan.freshLeft < 25) main.append(h('p', { class: 'notice' }, `처음 보는 새 문제가 ${plan.freshLeft}개 남았습니다. 소진되면 이미 푼 문제가 "다시 풀기"로 나오며 전이 지표에서는 빠집니다. content/items_*.json에 문제를 추가하면 늘어납니다.`));
    }

    // Compact state list — "am I actually improving?"
    const table = E.skillTable(D, C, now()).sort((a, b) => b.pr - a.pr);
    main.append(h('section', { class: 'card' },
      h('h2', null, '지금 상태', h('a', { href: '#/progress', class: 'more' }, '자세히')),
      h('ul', { class: 'skills' }, table.map(r => h('li', { onclick: () => go('#/skill/' + r.skill.id) },
        h('span', { class: 'sname' }, r.skill.name), chip(r.st.state), dots(r.st.recent))))));

    if (Store.lastError) main.append(h('p', { class: 'notice' }, '이 브라우저에 기록을 저장하지 못하고 있습니다 (사생활 보호 모드 등). 설정 → 내보내기로 백업하세요. ', Store.lastError));
    if (D.attempts.length >= 20 && (!D.lastBackup || now() - D.lastBackup > 7 * E.DAY)) {
      main.append(h('p', { class: 'notice' }, '학습 기록을 7일 넘게 백업하지 않았어요. ', h('a', { href: '#/settings' }, '내보내기')));
    }
  }

  function focusList(s) {
    return s.focus.length ? h('ol', { class: 'focus' }, s.focus.map(id => h('li', null, h('div', { class: 'fname' }, SKILL[id].name)))) : null;
  }

  function startSession(extra) {
    const s = E.buildSession(D, C, now());
    if (extra) { // extra set: transfer-only practice, no originals/move cards
      s.steps = s.steps.filter(x => x.type === 'item' && x.tier !== 'guided' || x.type === 'mixedIntro' || x.type === 'end');
      s.extra = true;
    }
    s.before = Object.fromEntries(E.skillTable(D, C, now()).map(r => [r.skill.id, r.st.state]));
    D.session = s; save(); go('#/session');
  }

  // ---------- SESSION ----------
  function viewSession() {
    const s = D.session;
    if (!s) { go('#/'); return; }
    const step = s.steps[s.cursor];
    const total = s.steps.length - 1;
    const top = h('div', { class: 'stop' },
      h('button', { class: 'link', onclick: () => { save(); go('#/'); } }, '← 나가기 (자동 저장)'),
      h('span', { class: 'muted small' }, step.type === 'end' ? '완료' : `${s.cursor + 1} / ${total}`));
    const prog = h('div', { class: 'progress' }, h('div', { style: `width:${100 * s.cursor / total}%` }));
    const main = h('main', { class: 'page session' });
    app.append(top, prog, main);
    if (step.type === 'original') stepOriginal(main, step);
    else if (step.type === 'move') stepMove(main, step);
    else if (step.type === 'item') stepItem(main, step);
    else if (step.type === 'mixedIntro') stepMixedIntro(main);
    else stepEnd(main);
  }
  function next() {
    const s = D.session; s.cursor = Math.min(s.cursor + 1, s.steps.length - 1); s.sub = null; save(); render();
  }
  function tierLabel(tier) {
    return { guided: '연습 · 단계별 안내', transfer: '새 문제 · 실전 조건', mixed: '섞어 풀기 · 새 문제', delayed: '유지 확인 · 새 문제', repeat: '유지 확인 · 다시 풀기 (전이 지표 제외)' }[tier] || '';
  }
  function logAttempt(a) {
    const rec = Object.assign({ at: now(), sid: D.session ? D.session.id : null }, a);
    D.attempts.push(rec);
    save();
    return rec;
  }

  // ---------- my own rules (old-site strength #1) ----------
  function myRules(skill) {
    return C.originals.filter(o => o.skill === skill && D.origState[o.id] && D.origState[o.id].myRule)
      .map(o => ({ id: o.id, rule: D.origState[o.id].myRule, at: D.origState[o.id].at })).sort((a, b) => b.at - a.at);
  }
  function ruleLine(skill) {
    const r = myRules(skill)[0];
    return r ? h('p', { class: 'rule mine' }, '내 규칙 → ', r.rule, h('span', { class: 'muted small' }, ` (${r.id})`))
      : h('p', { class: 'rule' }, '다음엔 → ', SKILL[skill].warning);
  }

  // ---------- replay only the key sentence(s) ----------
  function segmentButton(audioId, seg, onEnd) {
    const meta = C.audio[audioId];
    if (!meta || !seg) return null;
    const fmt = s => Math.floor(s / 60) + ':' + String(Math.floor(s % 60)).padStart(2, '0');
    const a = new Audio(meta.src);
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
  const STUCK = [['sound', '안 들렸다', '소리 인식'], ['memory', '들었는데 잊었다', '기억 유지'], ['judge', '기억했지만 선택지에서 헷갈렸다', '선택 판단'], ['vocab', '들었지만 뜻을 몰랐다', '어휘·표현']];
  const RECUR = [['same', '같은 원인으로 또 틀림'], ['rulefail', '규칙은 알았는데 적용 못함'], ['other', '다른 원인'], ['unknown', '모르겠음']];
  function wrongFollowup(rec, opts, onDone) {
    const wrap = h('div', { class: 'follow' });
    const stage2 = () => {
      if (!opts.askRecur) return onDone();
      const rules = myRules(rec.skill);
      wrap.append(h('div', { class: 'ask' },
        h('p', { class: 'stem' }, '이번 오답은?'),
        rules.length ? h('p', { class: 'small' }, '내가 정한 규칙: ', h('b', null, rules[0].rule)) : h('p', { class: 'small muted' }, '이 능력에 아직 내 규칙이 없습니다 (원본 오답을 확인할 때 만들 수 있어요).'),
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

  // --- original error step ---
  function stepOriginal(main, step) {
    const o = ORIG[step.ref];
    main.append(h('p', { class: 'kicker' }, `원본 오답 · ${o.test} · ${o.sec === 'R' ? 'Reading' : 'Listening'} · ${o.set}`));
    main.append(h('p', { class: 'muted small' }, '먼저 다시 판단해 보세요. 원본은 답을 기억해서 맞힐 수 있으므로 숙달 판정에는 쓰지 않습니다.'));
    renderOriginalCard(main, o, true, () => next());
  }

  function renderOriginalCard(main, o, live, onDone) {
    const edit = D.edits[o.id] || {};
    const myVal = edit.my !== undefined ? edit.my : o.my;
    const box = h('section', { class: 'card' });
    main.append(box);
    if (o.audio) {
      const p = Player(o.audio, { onPlay: () => {} });
      activePlayers.push(p);
      const note = h('div', { class: 'small muted' }, C.audio[o.audio].note || '기록된 스크립트로 만든 음성입니다 (원본 음원 아님).');
      box.append(note, p);
      // 소站 원본 음원이 이 기기에서 열리면 (로컬 파일 또는 GitHub 토큰) 재구성 음성 대신 원본을 보여 준다
      if (o.sec === 'L' && window.ListenApp) listenApp().origSource(o.id, src => {
        if (!box.isConnected) return;
        const a = h('audio', { controls: true, preload: 'auto', src, class: 'orig-audio' });
        a.playbackRate = listenApp().rate();
        activePlayers.push({ stop: () => a.pause() });
        p.stop(); p.style.display = 'none';
        note.replaceChildren('소站 원본 음원 (세트 전체) · ', h('a', { href: 'javascript:void 0', onclick: () => { a.pause(); a.remove(); p.style.display = ''; note.textContent = '기록된 스크립트로 만든 음성입니다 (원본 음원 아님).'; } }, '재구성 음성으로 듣기'));
        note.after(a);
      });
    }
    if (o.passage) box.append(h('div', { class: 'passage' }, para(o.passage)));
    let answer = null;
    const t0 = now();
    const check = h('button', { class: 'primary', disabled: true }, '확인');
    let blank = null;
    if (o.ctest) {
      const [a, b] = o.ctest.text.split('{{}}');
      blank = letterBlank(o.ctest.prefix, o.ctest.answer, { readOnly: !live,
        onChange: v => { answer = v; check.disabled = !v; }, onEnter: () => { if (!check.disabled) check.click(); } });
      box.append(h('p', { class: 'ctest' }, a, blank.el, b));
      if (live) setTimeout(() => blank.focus(), 50);
    } else {
      box.append(h('p', { class: 'stem' }, o.stem));
      box.append(h('div', { class: 'opts' }, o.options.map((t, i) => h('button', { class: 'opt', onclick: e => {
        answer = i; box.querySelectorAll('.opt').forEach(x => x.classList.remove('sel')); e.currentTarget.classList.add('sel'); check.disabled = false;
      } }, h('b', null, LETTERS[i]), ' ', t))));
    }
    if (!live) { box.append(originalFeedback(o, null, myVal)); return; }
    check.onclick = () => {
      const correct = o.ctest ? E.checkTyped(answer, o.ctest.prefix, o.ctest.answer) : answer === o.correct;
      const rec = logAttempt({ ref: o.id, skill: o.skill, tier: 'original', correct, answer, ms: now() - t0 });
      check.remove();
      box.querySelectorAll('input,.opt').forEach(x => x.disabled = true);
      if (blank) blank.mark(correct);
      if (!o.ctest) box.querySelectorAll('.opt').forEach((x, i) => { if (i === o.correct) x.classList.add('right'); else if (i === answer) x.classList.add('wrong'); });
      const holdBack = !correct && !!o.audio;
      box.append(originalFeedback(o, { answer, correct }, myVal, holdBack));
      if (holdBack) box.append(wrongFollowup(rec, { audio: o.audio, seg: o.seg }, () => box.append(evidenceBlock(o.evidence, o.audio), causeConfirm(o, onDone))));
      else box.append(causeConfirm(o, onDone));
    };
    box.append(check);
  }

  function evidenceBlock(evidence, audioId) {
    return h('div', { class: 'fb' }, evidence ? h('p', null, h('span', { class: 'lbl' }, '근거'), ' ', h('q', null, evidence)) : null,
      audioId ? transcript(audioId, [evidence]) : null);
  }

  function originalFeedback(o, now_, myVal, holdBack) {
    const optText = v => v == null ? '기록 없음' : o.ctest ? String(v) : `${LETTERS[v]}. ${o.options[v]}`;
    const right = o.ctest ? o.ctest.answer : `${LETTERS[o.correct]}. ${o.options[o.correct]}`;
    const rows = [
      ['당시 내 답', optText(myVal), D.edits[o.id] && D.edits[o.id].my !== undefined ? '사용자 수정' : '기록'],
      now_ ? ['지금 내 답', o.ctest ? (now_.answer || '(빈칸)') : optText(now_.answer), now_.correct ? '정답' : '오답'] : null,
      ['정답', right, ''],
    ].filter(Boolean);
    return h('div', { class: 'fb' },
      h('table', { class: 'cmp' }, rows.map(r => h('tr', null, h('th', null, r[0]), h('td', null, r[1]), h('td', { class: 'tag' }, r[2])))),
      o.evidence && !holdBack ? h('p', null, h('span', { class: 'lbl' }, '근거'), ' ', h('q', null, o.evidence)) : null,
      h('p', null, h('span', { class: 'lbl' }, '결정적 차이'), ' ', o.diff),
      o.trap && o.trap !== 'UNKNOWN' ? h('p', null, h('span', { class: 'lbl ai' }, '왜 그럴듯했나 · AI 추정'), ' ', o.trap) : null,
      h('p', { class: 'rule' }, '다음엔 → ', o.rule),
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
      h('p', { class: 'small muted' }, '이 분석이 당시 내 경우와 맞나요? (사용자가 확인한 원인과 AI 추정은 따로 저장됩니다)'),
      note,
      h('p', { class: 'small' }, h('b', null, '내 규칙'), ' — 다음에 이 유형이 나오면 나는 무엇을 할까? 내 말로 한 줄. 새 문제를 틀릴 때마다 이 규칙을 보여주고 "같은 원인인지" 묻습니다.'),
      rule,
      h('button', { class: 'link small', onclick: () => { rule.value = o.rule; } }, 'AI 규칙을 출발점으로 가져오기'),
      h('div', { class: 'row' },
        h('button', { class: 'ghost', onclick: () => pick('confirm') }, '맞아요'),
        h('button', { class: 'ghost', onclick: () => pick('other') }, '다른 이유'),
        h('button', { class: 'ghost', onclick: () => pick('unknown') }, '기억 안 나요')));
  }

  // --- move card ---
  function stepMove(main, step) {
    const sk = SKILL[step.skill];
    main.append(h('p', { class: 'kicker' }, '이번 훈련의 판단 순서'),
      h('section', { class: 'card move' },
        h('h1', null, sk.name),
        h('p', null, sk.oneLine),
        h('ol', null, sk.move.map(m => h('li', null, m))),
        h('p', { class: 'warn' }, sk.warning),
        myRules(step.skill).length ? h('div', { class: 'mine-list' }, h('p', { class: 'small' }, h('b', null, '내가 만든 규칙')),
          h('ul', null, myRules(step.skill).slice(0, 4).map(r => h('li', null, r.rule)))) : null),
      h('button', { class: 'primary', onclick: next }, '이 순서로 풀어볼게요'));
  }

  function stepMixedIntro(main) {
    main.append(h('section', { class: 'card move' },
      h('h1', null, '섞어 풀기'),
      h('p', null, '서로 다른 유형이 섞여 나옵니다. 문제마다 "이건 어떤 함정이 있는 문제인가"를 먼저 스스로 판단하세요. 실전과 같은 조건입니다.')),
      h('button', { class: 'primary', onclick: next }, '시작'));
  }

  // --- practice item step ---
  function stepItem(main, step) {
    const it = ITEM[step.item];
    if (!it) { next(); return; }
    const s = D.session;
    const sub = s.sub || (s.sub = { phase: 'start', si: 0, qi: 0, plays: 0, notes: '', hinted: false });
    const tier = step.tier;
    const exam = tier !== 'guided';
    main.append(h('p', { class: 'kicker' }, SKILL[it.skill].name, ' · ', h('span', { class: 'muted' }, tierLabel(tier))));
    const box = h('section', { class: 'card' });
    main.append(box);

    // Stimulus
    const needsAudio = !!it.audio;
    if (needsAudio) {
      const p = Player(it.audio, { maxPlays: exam ? 1 : Infinity, plays: sub.plays,
        onPlay: n => { sub.plays = n; save(); },
        onEnded: () => { if (sub.phase === 'start') { sub.phase = 'listened'; save(); render(); } },
        onError: () => {} });
      activePlayers.push(p);
      box.append(p);
      if (it.kind === 'listen') {
        box.append(h('textarea', { class: 'notes', rows: 3, placeholder: '노트 (실전처럼 대상 → 특징 2단어씩)', oninput: e => { sub.notes = e.target.value; save(); } }, sub.notes));
      }
      if (sub.phase === 'start') {
        box.append(h('p', { class: 'muted small' }, exam ? '끝까지 들으면 문제가 나옵니다. 실전처럼 한 번만 재생됩니다.' : '끝까지 들으면 문제가 나옵니다.'),
          h('button', { class: 'link small', onclick: () => { sub.phase = 'listened'; save(); render(); } }, '음원이 재생되지 않으면 건너뛰기'));
        return;
      }
    }
    if (it.passage && it.kind !== 'insert') box.append(h('div', { class: 'passage' }, para(it.passage)));

    const steps = exam ? [] : (it.steps || []).slice();
    if (it.kind === 'ctest' && it.skill === 'FORM' && !exam) steps.unshift({ type: 'slot', answer: it.ctest.slot, explain: it.hint });
    if (sub.phase === 'start' || sub.phase === 'listened') sub.phase = steps.length ? 'steps' : 'qs';

    if (sub.phase === 'steps') return renderScaffold(box, it, steps[sub.si], () => {
      sub.si++; if (sub.si >= steps.length) { sub.phase = 'qs'; sub.si = 0; } save(); render();
    });
    if (sub.phase === 'qs') {
      if (it.kind === 'ctest') return renderCtest(box, it, step, sub);
      return renderQuestion(box, it, step, sub);
    }
    if (sub.phase === 'after') {
      const after = (!exam && it.stepsAfter) || [];
      if (sub.si < after.length) return renderScaffold(box, it, after[sub.si], () => { sub.si++; save(); render(); });
      sub.phase = 'done';
    }
    // done
    box.append(h('p', { class: 'muted' }, '이 문항 완료.'));
    if (it.audio) box.append(transcript(it.audio, (it.qs || []).map(q => q.evidence)));
    box.append(flagLink(it));
    main.append(h('button', { class: 'primary', onclick: next }, '다음'));
  }

  // In-page form instead of prompt(): the artifact viewer blocks browser dialogs.
  function flagLink(it) {
    if (D.flags[it.id]) return h('p', { class: 'small muted' }, '신고됨 — 이 문항은 지표에서 제외됩니다');
    const wrap = h('div', { class: 'flag' });
    const open = h('button', { class: 'link small muted', onclick: () => {
      const inp = h('input', { id: 'flag-' + it.id, placeholder: '문제점 (정답이 둘, 근거 부족 등)' });
      open.replaceWith(h('div', { class: 'row' }, inp, h('button', { class: 'ghost', onclick: () => {
        if (!inp.value.trim()) { inp.focus(); return; }
        D.flags[it.id] = inp.value.trim(); save();
        wrap.replaceChildren(h('p', { class: 'small muted' }, '신고됨 — 이 문항은 지표에서 제외됩니다'));
      } }, '신고')));
      inp.focus();
    } }, '문제 오류 신고');
    wrap.append(open);
    return wrap;
  }

  // Two-step button instead of confirm(): first press arms it, second press acts.
  function confirmButton(label, armedLabel, cls, onConfirm) {
    let armed = false;
    const b = h('button', { class: cls, onclick: () => {
      if (!armed) { armed = true; b.textContent = armedLabel; b.classList.add('armed'); setTimeout(() => { if (armed) { armed = false; b.textContent = label; b.classList.remove('armed'); } }, 6000); return; }
      onConfirm();
    } }, label);
    return b;
  }

  // Scaffold steps (guided only): slot · choice · tag · pick · match · act
  function renderScaffold(box, it, st, onDone) {
    const wrap = h('div', { class: 'scaffold' });
    box.append(wrap);
    const done = h('button', { class: 'primary', disabled: true }, '확인');
    let checkFn = null;
    const showExplain = ok => {
      done.remove();
      wrap.append(h('div', { class: 'fb ' + (ok ? 'good' : 'bad') }, h('p', null, ok ? '✓ 맞아요. ' : '✗ 다시 보세요. ', st.explain || '')),
        h('button', { class: 'primary', onclick: onDone }, '다음 단계'));
    };
    if (it.kind === 'ctest' && it.ctest) {
      const [a, b] = it.ctest.text.split('{{}}');
      wrap.append(h('p', { class: 'ctest' }, a, letterBlank(it.ctest.prefix, it.ctest.answer, { readOnly: true }).el, b));
    }
    if (it.kind === 'insert') wrap.append(h('div', { class: 'insert-s' }, it.insert), h('div', { class: 'passage' }, para(it.passage.replace(/■[A-D]/g, m => '[' + m.slice(1) + ']'))));
    const single = (prompt, options, answer) => {
      let sel = null;
      wrap.append(h('p', { class: 'stem' }, prompt), h('div', { class: 'opts' }, options.map((t, i) => h('button', { class: 'opt', onclick: e => {
        sel = i; wrap.querySelectorAll('.opt').forEach(x => x.classList.remove('sel')); e.currentTarget.classList.add('sel'); done.disabled = false;
      } }, t))));
      checkFn = () => { wrap.querySelectorAll('.opt').forEach((x, i) => { x.disabled = true; if (i === answer) x.classList.add('right'); else if (i === sel) x.classList.add('wrong'); }); return sel === answer; };
    };
    if (st.type === 'slot') single('먼저 빈칸의 자리는? (단어를 떠올리기 전에)', C.slotOptions, st.answer);
    else if (st.type === 'act') single('들은 문장의 기능은?', C.actOptions, st.answer);
    else if (st.type === 'choice') single(st.prompt, st.options, st.answer);
    else if (st.type === 'tag') {
      const q = it.qs[0];
      const perm = E.permutation(q.options.length, it.id + '#0', q.fixed);
      wrap.append(h('p', { class: 'stem' }, q.prompt), h('p', { class: 'small muted' }, st.prompt));
      const sel = {};
      perm.forEach((oi, k) => {
        wrap.append(h('div', { class: 'tagrow' }, h('div', null, h('b', null, LETTERS[k]), ' ', q.options[oi]),
          h('div', { class: 'tags' }, st.tags.map((t, ti) => h('button', { class: 'tagb', 'data-o': oi, 'data-t': ti, onclick: e => {
            sel[oi] = ti; e.currentTarget.parentNode.querySelectorAll('.tagb').forEach(x => x.classList.remove('sel')); e.currentTarget.classList.add('sel');
            done.disabled = Object.keys(sel).length < perm.length;
          } }, t)))));
      });
      checkFn = () => {
        let ok = true;
        wrap.querySelectorAll('.tagb').forEach(b => {
          const oi = +b.dataset.o, ti = +b.dataset.t; b.disabled = true;
          if (st.answer[oi] === ti) b.classList.add('right'); else if (sel[oi] === ti) { b.classList.add('wrong'); ok = false; }
        });
        return ok;
      };
    } else if (st.type === 'pick') {
      wrap.append(h('p', { class: 'stem' }, st.prompt));
      const picked = new Set();
      const words = st.sentence.split(/\s+/);
      wrap.append(h('p', { class: 'pick' }, words.map(w => h('button', { class: 'word', onclick: e => {
        const k = w.toLowerCase().replace(/[^a-z']/g, '');
        if (picked.has(k)) { picked.delete(k); e.currentTarget.classList.remove('sel'); } else { picked.add(k); e.currentTarget.classList.add('sel'); }
        done.disabled = !picked.size;
      } }, w))));
      checkFn = () => {
        const ans = new Set(st.answer.map(x => x.toLowerCase()));
        wrap.querySelectorAll('.word').forEach(b => { b.disabled = true; const k = b.textContent.toLowerCase().replace(/[^a-z']/g, ''); if (ans.has(k)) b.classList.add('right'); else if (picked.has(k)) b.classList.add('wrong'); });
        return [...picked].some(k => ans.has(k)) && [...picked].every(k => ans.has(k));
      };
    } else if (st.type === 'match') {
      wrap.append(h('p', { class: 'stem' }, st.prompt));
      const sel = {};
      st.rows.forEach((r, ri) => wrap.append(h('div', { class: 'tagrow' }, h('div', null, r),
        h('div', { class: 'tags' }, st.entities.map((en, ei) => h('button', { class: 'tagb', 'data-r': ri, 'data-e': ei, onclick: e => {
          sel[ri] = ei; e.currentTarget.parentNode.querySelectorAll('.tagb').forEach(x => x.classList.remove('sel')); e.currentTarget.classList.add('sel');
          done.disabled = Object.keys(sel).length < st.rows.length;
        } }, en))))));
      checkFn = () => {
        let ok = true;
        wrap.querySelectorAll('.tagb').forEach(b => { const ri = +b.dataset.r, ei = +b.dataset.e; b.disabled = true; if (st.answer[ri] === ei) b.classList.add('right'); else if (sel[ri] === ei) { b.classList.add('wrong'); ok = false; } });
        return ok;
      };
    }
    done.onclick = () => showExplain(checkFn());
    wrap.append(done);
  }

  function confRow(onPick) {
    let v = null;
    const row = h('div', { class: 'conf' }, h('span', { class: 'small muted' }, '확신도'), CONF.map(([k, label]) => h('button', { class: 'tagb', onclick: e => {
      v = +k; row.querySelectorAll('.tagb').forEach(x => x.classList.remove('sel')); e.currentTarget.classList.add('sel'); onPick(v);
    } }, label)));
    return row;
  }

  function trapKey(why) {
    if (!why) return null;
    if (why.startsWith('↗')) return 'off-target';
    if (why.startsWith('✗')) return 'unsupported';
    return 'other:' + why.slice(0, 14);
  }

  function sameTrapCount(skill, key) {
    return D.attempts.filter(a => a.skill === skill && a.trap === key && !a.correct).length;
  }

  // C-Test blank as on the real test: the prefix, then one underlined cell per missing letter.
  // Typing fills cells left to right; Backspace steps back; arrows move; pasting fills from the caret.
  // Returns { el, value(), focus(), disable(), mark(ok) }; value() is the typed completion (prefix excluded).
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
        changed();
        if (letters) (cells[j] || cells[n - 1]).focus();
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

  function renderCtest(box, it, step, sub) {
    const exam = step.tier !== 'guided';
    const [a, b] = it.ctest.text.split('{{}}');
    let val = ''; let conf = null; const t0 = now();
    const check = h('button', { class: 'primary', disabled: true }, '확인');
    const upd = () => { check.disabled = !val.trim() || conf == null; };
    const blank = letterBlank(it.ctest.prefix, it.ctest.answer, { onChange: v => { val = v; upd(); }, onEnter: () => { if (!check.disabled) check.click(); } });
    box.append(h('p', { class: 'ctest' }, a, blank.el, b));
    if (!exam && it.hint && it.skill !== 'FORM') box.append(h('button', { class: 'link small', onclick: e => { sub.hinted = true; e.target.replaceWith(h('p', { class: 'hint' }, it.hint)); } }, '힌트'));
    box.append(confRow(v => { conf = v; upd(); }), check);
    setTimeout(() => blank.focus(), 50);
    check.onclick = () => {
      const correct = E.checkTyped(val, it.ctest.prefix, it.ctest.answer);
      const rec = logAttempt({ item: it.id, q: 0, ref: it.id + '#0', skill: it.skill, tier: step.tier, correct, conf, hinted: sub.hinted, answer: val, ms: now() - t0 });
      blank.disable(); blank.mark(correct); check.remove(); box.querySelector('.conf').remove();
      box.append(h('div', { class: 'fb ' + (correct ? 'good' : 'bad') },
        h('p', null, correct ? '✓ 정답 ' : '✗ ', h('b', null, it.ctest.answer), correct ? '' : `  (내 답: ${it.ctest.prefix}${val.trim().replace(new RegExp('^' + it.ctest.prefix, 'i'), '')})`),
        h('p', null, it.explain || ''),
        !correct && it.skill === 'FORM' ? h('p', { class: 'rule' }, '자리부터: ', C.slotOptions[it.ctest.slot]) : null,
        !correct ? ruleLine(it.skill) : null));
      sub.phase = 'after'; sub.si = 0; save();
      const nextBtn = () => box.append(flagLink(it), h('button', { class: 'primary', onclick: next }, '다음'));
      if (!correct && exam) box.append(wrongFollowup(rec, { askRecur: true }, nextBtn)); else nextBtn();
    };
  }

  function renderQuestion(box, it, step, sub) {
    const q = it.qs[sub.qi];
    const perm = E.permutation(q.options.length, it.id + '#' + sub.qi, q.fixed || it.kind === 'insert');
    let sel = null; let conf = null; const t0 = now();
    if (it.qs.length > 1) box.append(h('p', { class: 'muted small' }, `질문 ${sub.qi + 1} / ${it.qs.length}`));
    const check = h('button', { class: 'primary', disabled: true }, '확인');
    const upd = () => { check.disabled = sel == null || conf == null; };

    if (it.kind === 'insert') {
      box.append(h('p', { class: 'stem' }, 'Where would the following sentence best fit?'), h('div', { class: 'insert-s' }, it.insert));
      const pas = h('div', { class: 'passage' });
      const parts = it.passage.split(/(■[A-D])/);
      pas.append(h('p', null, parts.map(p => {
        const m = p.match(/^■([A-D])$/);
        if (!m) return p;
        const idx = 'ABCD'.indexOf(m[1]);
        return h('button', { class: 'sq', 'data-i': idx, onclick: e => {
          sel = idx; pas.querySelectorAll('.sq').forEach(x => { x.classList.remove('sel'); x.textContent = '■'; });
          e.currentTarget.classList.add('sel'); e.currentTarget.textContent = '■ ' + it.insert + ' ';
          upd();
        } }, '■');
      })));
      box.append(pas);
    } else {
      box.append(h('p', { class: 'stem' }, q.prompt));
      box.append(h('div', { class: 'opts' }, perm.map((oi, k) => h('button', { class: 'opt', 'data-i': oi, onclick: e => {
        sel = oi; box.querySelectorAll('.opt').forEach(x => x.classList.remove('sel')); e.currentTarget.classList.add('sel'); upd();
      } }, h('b', null, LETTERS[k]), ' ', q.options[oi]))));
    }
    box.append(confRow(v => { conf = v; upd(); }), check);

    check.onclick = () => {
      const correct = sel === q.answer;
      const skill = q.skill || it.skill;
      const key = correct ? null : trapKey(q.why[sel]);
      const prior = key ? sameTrapCount(skill, key) : 0;
      const rec = logAttempt({ item: it.id, q: sub.qi, ref: it.id + '#' + sub.qi, skill, tier: step.tier, correct, conf, hinted: sub.hinted, answer: sel, trap: key, plays: sub.plays, ms: now() - t0 });
      check.remove(); box.querySelector('.conf').remove();
      box.querySelectorAll('.opt,.sq').forEach(x => { x.disabled = true; const i = +x.dataset.i; if (i === q.answer) x.classList.add('right'); else if (i === sel) x.classList.add('wrong'); });
      const L = i => it.kind === 'insert' ? LETTERS[i] : LETTERS[perm.indexOf(i)];
      const optLine = i => it.kind === 'insert' ? L(i) : `${L(i)}. ${q.options[i]}`;
      const whyOk = w => (w || '').replace(/^✓\s*/, '').trim();
      box.append(h('div', { class: 'fb ' + (correct ? 'good' : 'bad') },
        h('p', null, correct ? '✓ 정답' : `✗ 내 답 ${L(sel)} · 정답 ${L(q.answer)}`),
        !correct ? h('p', null, h('span', { class: 'lbl' }, '내 답'), ' ', optLine(sel), h('br'), h('span', { class: 'why' }, q.why[sel])) : null,
        h('p', null, h('span', { class: 'lbl' }, '정답'), ' ', optLine(q.answer), whyOk(q.why[q.answer]) ? [h('br'), h('span', { class: 'why' }, whyOk(q.why[q.answer]))] : null),
        q.evidence && (correct || !it.audio) ? h('p', null, h('span', { class: 'lbl' }, '근거'), ' ', h('q', null, q.evidence)) : null,
        !correct && prior > 0 ? h('p', { class: 'warn' }, `같은 함정(${key === 'off-target' ? '사실이지만 표적 밖' : key === 'unsupported' ? '근거 없는 요소' : '같은 오답 유형'}) ${prior + 1}번째`) : null,
        !correct ? ruleLine(skill) : null,
        it.explain && !correct ? h('p', { class: 'muted small' }, it.explain) : null));
      const last = sub.qi >= it.qs.length - 1;
      const nextBtn = () => box.append(h('button', { class: 'primary', onclick: () => {
        if (!last) { sub.qi++; save(); render(); return; }
        // Nothing left to show for a text item → go straight to the next step.
        if (!it.audio && !(step.tier === 'guided' && it.stepsAfter)) { next(); return; }
        sub.phase = 'after'; sub.si = 0; save(); render();
      } }, last ? '다음' : '다음 질문'));
      if (correct) nextBtn();
      else box.append(wrongFollowup(rec, { audio: it.audio, seg: q.seg, askRecur: step.tier !== 'guided' }, () => {
        if (it.audio && q.evidence) box.append(evidenceBlock(q.evidence, null));
        nextBtn();
      }));
    };
  }

  function stepEnd(main) {
    const s = D.session;
    const mine = D.attempts.filter(a => a.sid === s.id);
    const scored = mine.filter(a => E.MASTERY_TIERS.includes(a.tier) && !a.hinted);
    const after = Object.fromEntries(E.skillTable(D, C, now()).map(r => [r.skill.id, r]));
    const changes = Object.keys(after).filter(k => s.before && s.before[k] && s.before[k] !== after[k].st.state);
    main.append(h('section', { class: 'card hero' },
      h('h1', null, '오늘 세션 끝'),
      h('p', null, `새 문제 ${scored.filter(a => a.correct).length} / ${scored.length} 정답` + (mine.filter(a => a.tier === 'original').length ? ` · 원본 오답 ${mine.filter(a => a.tier === 'original').length}개 확인` : '')),
      changes.length ? h('ul', { class: 'changes' }, changes.map(k => h('li', null, SKILL[k].name, ': ', chip(s.before[k]), ' → ', chip(after[k].st.state)))) :
        h('p', { class: 'muted' }, '상태 변화 없음 — 개선 판정에는 새 문제 5개 중 4개 이상, 2번 이상의 세션이 필요합니다.'),
      (() => {
        const due = Object.values(after).filter(r => r.st.dueAt && ['IMPROVED', 'RETAINED'].includes(r.st.state));
        return due.length ? h('p', { class: 'small' }, '유지 확인 예정: ', due.map(r => `${r.skill.name} (${fmtDate(r.st.dueAt)})`).join(', ')) : null;
      })(),
      h('button', { class: 'primary', onclick: () => { s.done = true; save(); go('#/'); } }, '완료')));
  }

  // ---------- PROGRESS ----------
  function metricTile(label, val, sub, enough) {
    return h('div', { class: 'tile' }, h('div', { class: 'tl' }, label), h('div', { class: 'tv' }, enough ? val : '—'), h('div', { class: 'ts muted' }, enough ? sub : sub + ' · 데이터 부족'));
  }
  function viewProgress(main) {
    const m = E.metrics(D);
    main.append(h('h1', null, '내가 실제로 나아지고 있나'));
    main.append(h('p', { class: 'muted small' }, '활동량은 실력이 아닙니다. 실력 판단은 처음 보는 문제(새 문제·지연 확인)로만 합니다.'));
    main.append(h('div', { class: 'tiles' },
      metricTile('새 문제 정답률', m.transfer.pct + '%', `${m.transfer.n}문항 · 전이`, m.transfer.n >= 5),
      metricTile('지연 확인 유지율', m.retention.pct + '%', `${m.retention.n}문항 · 유지`, m.retention.n >= 3),
      metricTile('같은 함정 재발', m.recurrence.repeats + '회', `함정 오답 ${m.recurrence.trapMisses}회 중`, m.transfer.n >= 5),
      metricTile('확신하고 틀림', m.confidentMiss.n + '회', `새 문제 ${m.confidentMiss.of}개 중`, m.transfer.n >= 5),
      metricTile('원본 재정답 (참고)', m.originalRedo.pct + '%', `${m.originalRedo.n}개 · 기억일 수 있음`, m.originalRedo.n >= 1),
      metricTile('활동', m.activity.attempts + '문항', `${m.activity.days}일 · ${Math.round(m.activity.ms / 60000)}분`, true)));

    // Old-site strengths: my own recurrence verdicts + where listening breaks down.
    const rc = m.recur, nRc = Object.values(rc).reduce((a, b) => a + b, 0);
    const st = m.stuck, nSt = Object.values(st).reduce((a, b) => a + b, 0);
    const bar = (label, n, of) => h('div', { class: 'hbar' }, h('span', null, label), h('div', { class: 'hb' }, h('div', { style: `width:${of ? 100 * n / of : 0}%` })), h('b', null, n));
    main.append(h('section', { class: 'card' }, h('h2', null, '새 문제를 틀렸을 때 — 내 판정'),
      nRc ? [bar('같은 원인으로 또', rc.same, nRc), bar('규칙 알았지만 적용 실패', rc.rulefail, nRc), bar('다른 원인', rc.other, nRc), bar('모르겠음', rc.unknown, nRc),
        h('p', { class: 'small muted' }, '"같은 원인"이 줄고 "적용 실패"가 남아 있다면 규칙은 이해했고 실전 적용 연습이 더 필요하다는 뜻입니다.')]
        : h('p', { class: 'muted small' }, '아직 기록 없음 — 새 문제를 틀리면 "같은 원인인지" 묻습니다.')),
      h('section', { class: 'card' }, h('h2', null, '리스닝 오답 — 어디서 막혔나'),
        nSt ? [STUCK.map(([k, label, tag]) => bar(`${label} (${tag})`, st[k], nSt)),
          h('p', { class: 'small muted' }, `근거 구간을 다시 들었을 때: 들린다 ${m.reheard.clear} · 여전히 안 들린다 ${m.reheard.still}. "안 들렸다 + 다시 들어도 안 들림"이 많으면 소리 인식, "잊었다"가 많으면 노트·기억 유지가 우선입니다.`)]
          : h('p', { class: 'muted small' }, '아직 기록 없음 — 리스닝 문제를 틀리면 어디서 막혔는지 묻습니다.')));

    const table = E.skillTable(D, C, now());
    main.append(h('section', { class: 'card' }, h('h2', null, '능력별 상태'),
      h('table', { class: 'grid' },
        h('tr', null, h('th', null, '능력'), h('th', null, '상태'), h('th', null, '새 문제 (최근 8)'), h('th', null, '원본 확인')),
        table.map(r => h('tr', { onclick: () => go('#/skill/' + r.skill.id) },
          h('td', null, r.skill.name), h('td', null, chip(r.st.state)),
          h('td', null, dots(r.st.recent), ' ', r.st.recent.length ? `${r.st.recent.filter(a => a.correct).length}/${r.st.recent.length}` : ''),
          h('td', null, `${r.st.reviewed}/${r.st.originals}`))))));

    main.append(h('section', { class: 'card' }, h('h2', null, 'TPO 기록 (확인된 수치 · 공식 점수 환산 아님)'),
      h('table', { class: 'grid' }, h('tr', null, h('th', null, ''), h('th', null, 'Reading'), h('th', null, 'C-Test'), h('th', null, 'Listening'), h('th', null, '오답')),
        C.tests.map(t => h('tr', null, h('td', null, `${t.id} (${t.date.slice(5)})`),
          h('td', null, frac(t.reading)), h('td', null, frac(t.ctest)), h('td', null, t.listening ? frac(t.listening) : '분모 미상'), h('td', null, t.errors)))),
      h('p', { class: 'small muted' }, '다음 TPO를 풀면 오답을 같은 8개 능력으로 분류해 content/originals.json에 추가하세요. 앱 안의 새 문제 결과와 실제 TPO 결과가 같은 방향인지가 최종 검증입니다.')));
  }
  function frac(x) { return x ? `${x[0]}/${x[1]} (${Math.round(100 * x[0] / x[1])}%)` : '—'; }

  // ---------- TPO reports (date / test) ----------
  function viewTests(main) {
    const tests = C.tests.slice().sort((a, b) => a.date.localeCompare(b.date));
    const matrix = E.testMatrix(C);
    const table = Object.fromEntries(E.skillTable(D, C, now()).map(r => [r.skill.id, r]));
    main.append(h('h1', null, '모의고사별 오답'),
      h('p', { class: 'muted small' }, '능력별 주 오답 개수. 회차마다 문항 수가 달라서 개수만으로 실력 변화를 단정할 수 없습니다 — 같은 능력에서 2회 이상 연속 줄어드는지를 보세요.'));
    main.append(h('section', { class: 'card scroll' }, h('table', { class: 'grid matrix' },
      h('tr', null, h('th', null, '능력'), tests.map(t => h('th', null, t.id, h('br'), h('span', { class: 'muted' }, t.date.slice(5))))),
      matrix.map(r => h('tr', null, h('td', null, SKILL[r.skill].name, ' ', chip(table[r.skill].st.state)),
        r.counts.map((n, i) => h('td', { class: 'num' + (n && i && r.counts[i - 1] ? ' hot' : '') + (!n && i && r.counts[i - 1] ? ' cool' : '') }, n || '·')))),
      h('tr', null, h('td', { class: 'muted' }, '합계 (분석 불가 포함)'), tests.map(t => h('td', { class: 'num' }, C.originals.filter(o => o.test === t.id).length))))));
    const relapsed = Object.values(table).filter(r => r.st.realRelapses && r.st.realRelapses.length);
    if (relapsed.length) main.append(h('p', { class: 'notice' }, '개선 판정 이후 실제 모의고사에서 다시 틀린 능력: ',
      relapsed.map(r => `${r.skill.name} (${r.st.realRelapses.join(', ')})`).join(' · '), ' → 오늘 훈련에 다시 포함됩니다.'));
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
        rep.next ? h('p', { class: 'rule' }, '다음 훈련 → ', rep.next) : null,
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
      h('section', { class: 'card move' }, h('h2', null, '판단 순서'), h('ol', null, sk.move.map(m => h('li', null, m))), h('p', { class: 'warn' }, sk.warning)),
      h('section', { class: 'card' }, h('h2', null, '근거와 현재 기록'),
        h('p', null, `원본 오답: 주 ${r.ev.primary}개 · 관련 ${r.ev.secondary}개 · ${r.ev.tests.join(', ')}`),
        h('p', null, '새 문제 (최근): ', dots(r.st.recent), ` 누적 ${r.st.mastery}문항`),
        r.st.dueAt ? h('p', null, `다음 유지 확인: ${fmtDate(r.st.dueAt)}`) : null,
        h('p', { class: 'small muted' }, '개선 판정: 힌트 없이 새 문제 최근 5개 중 4개 이상 + 2개 이상의 세션 + 확신 오답 없음. 이후 지연 확인을 통과하면 "유지됨".')));
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
      h('p', { class: 'small muted' }, '원본 데이터는 보존되고, 수정 내용은 따로 저장되어 화면에 "사용자 수정"으로 표시됩니다.'),
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
    const mins = h('input', { id: 'set-mins', type: 'number', min: 15, max: 120, step: 5, value: D.settings.minutes });
    const msg = h('p', { class: 'small', role: 'status' });
    const box = h('textarea', { id: 'data-box', class: 'databox', rows: 5, placeholder: '내보낸 기록(JSON)을 여기에 붙여넣거나, 파일을 선택하세요.' });
    const offerImport = text => {
      try {
        const d = Store.parseImport(text);
        msg.replaceChildren(`가져올 기록: 시도 ${d.attempts.length}건. 현재 기록(${D.attempts.length}건)을 대체합니다. `,
          confirmButton('가져오기 실행', '한 번 더 누르면 대체됩니다', 'ghost', () => { D = d; save(); render(); }));
      } catch (err) { msg.textContent = '가져오기 실패: ' + err.message + ' — 이 앱의 "내보내기"로 만든 JSON인지 확인하세요.'; }
    };
    const file = h('input', { id: 'data-file', type: 'file', accept: 'application/json', hidden: true, onchange: async e => {
      const f = e.target.files[0]; if (f) offerImport(await f.text());
    } });
    main.append(h('h1', null, '설정'),
      h('section', { class: 'card' },
        h('label', { class: 'field' }, '시험일', date),
        h('label', { class: 'field' }, '하루 학습 시간(분)', mins),
        h('button', { class: 'primary', onclick: () => {
          D.settings.examDate = date.value || null; D.settings.minutes = Math.max(15, +mins.value || 40);
          if (D.session && !D.session.done && D.session.cursor === 0) D.session = null;
          save(); go('#/');
        } }, '저장')),
      syncCard(),
      h('section', { class: 'card' }, h('h2', null, '데이터'),
        h('p', { class: 'small muted' }, `학습 기록은 이 브라우저에만 저장됩니다 (시도 ${D.attempts.length}건). 다른 기기·브라우저로 옮기거나 백업할 때는 내보내기한 내용을 복사해 두었다가 거기서 가져오기에 붙여넣으세요.`),
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
        h('p', { class: 'small muted' }, '진행 중인 오늘 세션을 버리고 현재 기록으로 다시 계획합니다. 이미 푼 기록은 유지됩니다.'),
        h('button', { class: 'ghost', onclick: () => { D.session = null; save(); go('#/'); } }, '다시 계획')),
      h('section', { class: 'card' }, h('h2', null, '초기화'),
        h('p', { class: 'small muted' }, '모든 학습 기록을 지웁니다. 되돌릴 수 없으니 먼저 내보내기를 하세요.'),
        confirmButton('모든 기록 지우기', '한 번 더 누르면 모두 지워집니다', 'danger', () => { D = Store.blank(); save(); go('#/'); })),
      h('p', { class: 'small muted' }, `콘텐츠 빌드: ${C.builtAt} · 원본 오답 ${C.originals.length} · 새 문제 ${C.items.length} · 음원 ${Object.keys(C.audio).length}`));
  }

  // ---------- boot: wait for the synced record (claude.ai) before the first real render ----------
  app.append(h('main', { class: 'page' }, h('p', { class: 'muted' }, '기록을 불러오는 중…')));
  const boot = () => { D = Store.load(); render(); };
  if (window.Sync) {
    Sync.ready.then(boot);
    Sync.onChange((what, key) => {
      if (what === 'status') { const el = document.getElementById('sync-label'); if (el) el.replaceWith(syncLabel()); return; }
      if (what !== 'remote') return;
      const view = (location.hash || '#/').split('/')[1];
      if (key === 'toeflcoach.v1' && view !== 'session') { D = Store.load(); if (view !== 'sw') render(); }
      if (key.startsWith('toefl-sw') && view === 'sw' && !swApp().busy()) render();
      if (key.startsWith('toefl-vocab') && vocabMode !== 'flow') { if (V) V.deactivate(); V = null; if (view === 'vocab') render(); }
    });
  } else boot();
})();
