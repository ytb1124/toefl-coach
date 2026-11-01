/* 말하기 — 소站 TPO独家 Listen & Repeat · Interview (오늘 계획 ④ · 연습실).
 * 받아쓰기: 로컬 서버(tools/serve.py, start.command)의 Whisper (/stt). 없으면(공개 사이트·휴대폰) '내 녹음 ↔ 원문 번갈아 듣고 놓친 단어 직접 탭'.
 * 시간: L&R 문장마다 소站 limitTime(8/10/12초), Interview 45초 타이머만 (docs/exam-rules.md). Interview 질문 음성은 소站에 없어 Kokoro로 만든 것 (표시함).
 * 기록: 주 기록(toeflcoach.v1)의 speak[] (지표용) + 빠뜨린 L&R 문장은 attempts에 cause 'omit'으로 남겨 다음 날 쉐도잉으로 이어진다.
 * 순수 로직(SpeakCore)은 node 테스트에서도 쓴다 (tests/speak.test.js). */
(function (root) {
  'use strict';

  // ---------- pure ----------
  // Speech stats from Whisper word timestamps: words per minute (speaking span only) and pauses ≥ gap seconds.
  function speechStats(words, gap) {
    gap = gap || 0.8;
    const ws = (words || []).filter(w => /\w/.test(w.w));
    if (!ws.length) return { words: 0, wpm: null, pauses: 0, longest: 0 };
    let pauses = 0, longest = 0;
    for (let i = 1; i < ws.length; i++) { const g = ws[i].start - ws[i - 1].end; if (g >= gap) pauses++; longest = Math.max(longest, g); }
    const span = ws[ws.length - 1].end - ws[0].start;
    return { words: ws.length, wpm: span > 0 ? Math.round(ws.length / (span / 60)) : null, pauses, longest: Math.round(longest * 10) / 10 };
  }
  const Core = { speechStats };
  if (typeof module !== 'undefined' && module.exports) { module.exports = Core; return; }
  root.SpeakCore = Core;

  // ---------- UI ----------
  root.SpeakApp = { create(env) {
    const { h, toast } = env;
    const ap = (el, ...kids) => el.append(...kids.flat(Infinity).filter(x => x != null && x !== false));
    const rc = (el, ...kids) => el.replaceChildren(...kids.flat(Infinity).filter(x => x != null && x !== false));
    const ZD = () => root.ZhanData;
    const PC = () => root.PracticeCore;
    const ensure = then => ZD().loadAll([['pool', 'ZHAN_POOL']], then);
    const sets = kind => ((root.ZHAN_POOL && root.ZHAN_POOL.sets) || []).filter(s => s.kind === kind && !s.held);
    let stt = null;   // null = not checked · true/false
    function sttReady() {
      if (stt != null) return Promise.resolve(stt);
      return fetch('stt/health', { cache: 'no-store' }).then(r => r.ok ? r.json() : { ok: false }).then(j => (stt = !!j.ok)).catch(() => (stt = false));
    }
    const transcribe = blob => fetch('stt', { method: 'POST', body: blob, headers: { 'Content-Type': blob.type || 'audio/webm' } })
      .then(r => { if (!r.ok) throw new Error('받아쓰기 실패 ' + r.status); return r.json(); });
    let stream = null;
    const mic = () => stream ? Promise.resolve(stream) : navigator.mediaDevices.getUserMedia({ audio: true }).then(s => (stream = s));
    function record(sec, onTick) {
      return mic().then(s => new Promise(res => {
        const rec = new MediaRecorder(s); const chunks = [];
        rec.ondataavailable = e => chunks.push(e.data);
        let left = sec; onTick && onTick(left);
        let ended = false;
        const finish = () => { if (ended) return; ended = true; clearInterval(t); res(new Blob(chunks, { type: rec.mimeType || 'audio/webm' })); };
        rec.onstop = finish;
        // 시간이 끝나면 멈춘다. 녹음기가 'stop'을 끝내 알리지 않아도 2초 뒤에는 있는 것으로 넘어간다 (화면이 멈추지 않게).
        const t = setInterval(() => { left--; if (left >= 0) onTick && onTick(left); if (left <= 0 && rec.state === 'recording') rec.stop(); if (left <= -2) finish(); }, 1000);
        rec.start();
        record.stop = () => { if (rec.state === 'recording') rec.stop(); };
      }));
    }
    let cur = null;
    // 화면을 떠나면(건너뛰기·나가기·다른 탭) 진행 중인 흐름을 끊는다: gen이 바뀌면 L&R 다음 문장·채점·기록이 이어지지 않는다.
    let gen = 0, ivTimer = null;
    const stopAll = () => {
      gen++; spaceHandler = null;
      if (ivTimer) { clearInterval(ivTimer); ivTimer = null; }
      if (cur) try { cur.pause(); } catch (e) { /* gone */ } cur = null; if (record.stop) record.stop();
    };
    window.addEventListener('hashchange', () => { stopAll(); if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; } });
    const play = path => ZD().audioUrl(path).then(u => new Promise((res, rej) => { const a = new Audio(u); cur = a; a.onended = res; a.onerror = () => rej(new Error('재생 실패')); a.play().catch(rej); }));
    const playBlob = blob => new Promise(res => { const a = new Audio(URL.createObjectURL(blob)); cur = a; a.onended = res; a.play(); });
    const beep = () => { try { const c = new AudioContext(); const o = c.createOscillator(); o.frequency.value = 880; o.connect(c.destination); o.start(); o.stop(c.currentTime + 0.15); } catch (e) { /* no audio */ } };
    const big = (label, onclick) => h('button', { class: 'primary big', onclick }, label);
    // Space key = the big button (one key drives the whole flow)
    let spaceHandler = null;
    window.addEventListener('keydown', e => { if (e.code === 'Space' && spaceHandler && !/^(INPUT|TEXTAREA)$/.test((document.activeElement || {}).tagName)) { e.preventDefault(); spaceHandler(); } });

    // ---- Listen & Repeat: 듣기 → (삐) 녹음 limit초 → 자동 다음. 끝나면 문장별 일치율, 틀린 문장만 다시. ----
    function lr(main, task, done) {
      ensure(() => {
        const set = task.set ? sets('lr').find(s => s.id === task.set) : null;
        if (!set) { noData(main, done); return; }
        ap(main, h('p', { class: 'kicker' }, '④ 말하기 · Listen & Repeat · ', h('span', { class: 'muted' }, set.src)));
        const box = h('section', { class: 'card' }); ap(main, box);
        ap(box, h('p', { class: 'muted small' }, set.intro || ''),
          h('p', { class: 'small' }, '스페이스바(또는 큰 버튼) 한 번이면 끝까지 갑니다: 문장 듣기 → 삐 → 따라 말하기(소站 응답 시간 8/10/12초, 다 말했으면 스페이스바로 일찍 끝내기) → 다음 문장.'));
        const status = h('p', { class: 'listening-status' });
        const results = [];
        let qs = set.qs.slice();
        const runRound = () => new Promise(resolve => {
          let i = 0;
          const g = gen;
          const step = () => {
            if (g !== gen) { resolve(null); return; }   // 화면을 떠남: 아무것도 기록하지 않는다
            if (i >= qs.length) { spaceHandler = null; resolve(true); return; }
            const q = qs[i];
            status.textContent = `${i + 1} / ${qs.length} · 듣는 중…`;
            spaceHandler = null;
            play(q.audio).then(() => {
              if (g !== gen) throw new Error('left');
              beep();
              spaceHandler = () => record.stop && record.stop();
              return record(q.limit || 10, left => { status.textContent = `${i + 1} / ${qs.length} · 따라 말하기 ${left}초`; });
            }).then(blob => { if (g !== gen) return resolve(null); results.push({ q, blob }); i++; step(); })
              .catch(e => { if (g !== gen) return resolve(null); status.textContent = '오류: ' + e.message + ' (마이크 권한을 확인하세요)'; spaceHandler = null; resolve(false); });
          };
          step();
        });
        const startBtn = big('▶ 시작 (스페이스바)', () => go());
        const go = () => { startBtn.remove(); spaceHandler = null; runRound().then(after); };
        // 녹음이 중간에 실패하면 (마이크 없음·거부) 채점·기록하지 않고 다시 하기/넘어가기만 보여 준다
        function after(completed) {
          if (completed === null) return;   // 화면을 떠남
          if (completed && results.length) return review();
          ap(box, h('p', { class: 'notice' }, '녹음을 하지 못해 이 세트는 기록하지 않았습니다. 마이크를 연결하거나 브라우저의 마이크 권한을 허용한 뒤 다시 하세요.'),
            h('div', { class: 'row' }, h('button', { class: 'ghost', onclick: () => { results.length = 0; rc(main); lr(main, task, done); } }, '다시 하기'),
              h('button', { class: 'primary', onclick: () => done({ skipped: true }) }, '넘어가기')));
        }
        spaceHandler = go;
        ap(box, status, startBtn);
        function review() {
          status.textContent = '채점 중…';
          sttReady().then(ok => {
            const list = h('div');
            ap(box, h('h3', null, '결과'), list);
            const out = [];
            const finish = () => {
              const missed = out.filter(r => r.pct !== 100);
              const pct = out.length ? Math.round(out.reduce((s, r) => s + (r.pct || 0), 0) / out.length) : null;
              env.logSpeak({ kind: 'lr', set: set.id, pct, n: out.length, stt: ok, missed: missed.map(r => r.q.id) });
              for (const r of missed) env.log({ item: r.q.id, skill: null, tier: 'speak', correct: false, cause: 'omit', missed: r.missedWords });
              status.textContent = ok ? `평균 단어 일치율 ${pct}%` : '받아쓰기 없음: 놓친 단어를 직접 표시했습니다.';
              ap(box, missed.length ? h('button', { class: 'ghost', onclick: () => { qs = missed.map(r => r.q); results.length = 0; list.remove(); runRound().then(after); } }, `틀린 문장 ${missed.length}개만 다시`) : h('p', { class: 'verdict good' }, '모든 문장을 빠짐없이 따라 말했습니다.'),
                h('button', { class: 'primary', onclick: () => done({}) }, '다음'));
            };
            let k = 0;
            const nextOne = () => {
              if (k >= results.length) return finish();
              const { q, blob } = results[k++];
              const row = h('div', { class: 'fb' });
              ap(list, row);
              const rowBase = [h('div', { class: 'row' }, h('button', { class: 'ghost small', onclick: () => playBlob(blob) }, '▶ 내 녹음'), h('button', { class: 'ghost small', onclick: () => play(q.audio) }, '▶ 원문'))];
              if (ok) {
                transcribe(blob).then(r => {
                  const a = PC().align(q.text, r.text);
                  const res = { q, pct: a.pct, missedWords: a.words.filter(w => !w.ok).map(w => w.w) };
                  out.push(res);
                  ap(row, h('p', { class: 'aligned' }, a.words.map(w => h('span', { class: w.ok ? 'ok' : 'miss' }, w.w + ' ')), h('b', null, ` ${a.pct}%`)),
                    h('p', { class: 'small muted' }, '들린 대로: ', r.text || '(소리 없음)'), ...rowBase);
                  nextOne();
                }).catch(e => { stt = false; ap(row, h('p', { class: 'small' }, e.message)); k--; list.lastChild.remove(); review2(); });
              } else {
                // No STT: alternate my recording and the original, tap the words I missed.
                const missedW = new Set();
                const res = { q, pct: 100, missedWords: [] };
                out.push(res);
                const toks = PC().words(q.text);
                ap(row, h('p', { class: 'small muted' }, '내 녹음 ↔ 원문을 번갈아 듣고, 빠뜨리거나 틀린 단어를 누르세요.'), ...rowBase,
                  h('p', { class: 'aligned' }, toks.map(w => h('span', { class: 'ok tap', onclick: e => {
                    if (missedW.has(w)) { missedW.delete(w); e.currentTarget.className = 'ok tap'; } else { missedW.add(w); e.currentTarget.className = 'miss tap'; }
                    res.missedWords = [...missedW]; res.pct = Math.round(100 * (toks.length - missedW.size) / toks.length);
                  } }, w + ' '))));
                nextOne();
              }
            };
            const review2 = () => { ok = false; nextOne(); };
            if (!ok) ap(list, h('p', { class: 'small muted' }, '이 기기에서는 Whisper 받아쓰기를 쓸 수 없습니다 (Mac의 start.command로 열면 자동 채점).'));
            nextOne();
          });
        }
      });
    }

    // ---- Interview: 질문 듣기 → 45초 타이머만 (녹음·받아쓰기·비교 없음, 2026-11-02 사용자 요청). ----
    function interview(main, task, done) {
      ensure(() => {
        const set = sets('interview').find(s => s.qs.some(q => q.id === task.q));
        const q = set && set.qs.find(x => x.id === task.q);
        if (!q) { noData(main, done); return; }
        const limit = q.limit || 45;
        const qAudio = q.audio || `private/zhan/kokoro/${q.id}.mp3`;
        ap(main, h('p', { class: 'kicker' }, '④ 말하기 · Interview · ', h('span', { class: 'muted' }, set.src)));
        const box = h('section', { class: 'card' }); ap(main, box);
        ap(box, h('p', { class: 'small' }, `질문을 듣고 삐 소리 뒤에 ${limit}초 동안 소리 내어 답하세요. 준비 시간 없이 바로 시작합니다 (소站 규칙).`),
          q.audio && !q.audioSrc ? null : h('p', { class: 'small muted' }, '질문 음성: 원본 음원 아님 (Kokoro 생성) — 소站 자료에 질문 음성이 없습니다.'));
        const status = h('p', { class: 'listening-status' });
        const clock = h('p', { class: 'stem', style: 'font-size:2.4rem;font-variant-numeric:tabular-nums;margin:8px 0' });
        const startBtn = big('▶ 질문 듣고 시작 (스페이스바)', () => run());
        spaceHandler = () => run();
        ap(box, status, clock, startBtn);
        let started = false;
        const g = gen;
        function run() {
          if (started) return; started = true; startBtn.remove(); spaceHandler = null;
          status.textContent = '질문 듣는 중…';
          play(qAudio).catch(() => { status.textContent = '질문 음성을 재생하지 못했습니다 — 글로 읽고 답하세요.'; ap(box, h('p', { class: 'stem' }, q.text)); })
            .then(() => { if (g === gen) answer(); });
        }
        function answer() {
          beep();
          let left = limit;
          const tick = () => { clock.textContent = `${left}초`; status.textContent = '말하는 중 — 다 말했으면 스페이스바'; };
          tick();
          const end = () => { if (!ivTimer || g !== gen) return; clearInterval(ivTimer); ivTimer = null; spaceHandler = null; finish(); };
          ivTimer = setInterval(() => { left--; if (left <= 0) { clock.textContent = '0초'; end(); } else tick(); }, 1000);
          spaceHandler = end;
        }
        function finish() {
          status.textContent = '끝';
          env.logSpeak({ kind: 'interview', q: q.id, timerOnly: true });   // 오늘 계획에서 '한 문제'로 세기 위한 기록만
          ap(box, h('p', { class: 'stem' }, q.text), h('button', { class: 'primary', onclick: () => done({}) }, '다음'));
        }
      });
    }

    // ---- 쉐도잉 (L&R에서 빠뜨린 문장, 다음 날 ②) ----
    function shadow(main, task, done) {
      ensure(() => {
        let q = null;
        for (const s of sets('lr')) { q = s.qs.find(x => x.id === task.of) || q; }
        ap(main, h('p', { class: 'kicker' }, '② 쉐도잉 · 전에 L&R에서 빠뜨린 문장'));
        const box = h('section', { class: 'card' }); ap(main, box);
        if (!q) { ap(box, h('p', { class: 'muted' }, '문장을 찾지 못했습니다.'), h('button', { class: 'primary', onclick: () => done({ followup: task.key }) }, '넘어가기')); return; }
        ap(box, h('p', { class: 'stem' }, q.text), h('p', { class: 'small muted' }, '소리와 동시에 3번 따라 말하세요. 빠뜨렸던 단어에 힘을 주세요.'),
          task.missed && task.missed.length ? h('p', { class: 'small' }, '전에 빠뜨린 단어: ', h('b', null, task.missed.join(', '))) : null,
          h('button', { class: 'ghost', onclick: () => play(q.audio).catch(e => toast(e.message)) }, '▶ 듣기'),
          h('button', { class: 'primary', onclick: () => done({ followup: task.key }) }, '3번 했어요'));
      });
    }

    function noData(main, done) {
      ap(main, h('section', { class: 'card' }, h('p', { class: 'notice' }, '소站 말하기 자료를 불러오지 못했습니다 (비공개 자료). Mac에서 start.command로 열거나 토큰을 넣으세요.'),
        h('button', { class: 'primary', onclick: () => done({ skipped: true }) }, '넘어가기')));
    }

    // 오늘 계획용: 아직 안 한 소站 L&R 세트 1개와 Interview 질문 1개 (공개 메타데이터만으로 고른다).
    function today(content, speakLog) {
      const done = new Set((speakLog || []).map(r => r.set || r.q));
      const meta = content.pool.sets.filter(s => !s.held);
      const lrSet = meta.filter(s => s.kind === 'lr').find(s => !done.has(s.id)) || meta.filter(s => s.kind === 'lr')[0];
      const ivQ = meta.filter(s => s.kind === 'interview').flatMap(s => s.qs).find(q => !done.has(q.id));
      // 안 한 것 전부 (오늘 계획이 남은 날로 나눠 하루 몫을 정한다)
      const lrLeft = meta.filter(s => s.kind === 'lr' && !done.has(s.id)).map(s => s.id);
      const ivLeft = meta.filter(s => s.kind === 'interview').flatMap(s => s.qs).filter(q => !done.has(q.id)).map(q => q.id);
      return { lr: lrSet ? lrSet.id : null, interview: ivQ ? ivQ.id : null, lrLeft, ivLeft };
    }
    // 연습실 목록
    function room(main, content, go) {
      const meta = content.pool.sets.filter(s => !s.held);
      ap(main, h('h1', null, '말하기 (소站 독점 TPO)'),
        h('section', { class: 'card' }, h('h2', null, 'Listen & Repeat'), h('div', { class: 'row wrap' }, meta.filter(s => s.kind === 'lr').map(s => h('button', { class: 'ghost', onclick: () => go('#/speak/lr/' + s.id) }, `독점 TPO ${s.paper}`)))),
        h('section', { class: 'card' }, h('h2', null, 'Interview'), h('div', { class: 'row wrap' }, meta.filter(s => s.kind === 'interview').map(s => h('button', { class: 'ghost', onclick: () => go('#/speak/iv/' + s.qs[0].id) }, `독점 TPO ${s.paper}`)))));
    }

    return { lr, interview, shadow, today, room, sttReady, stopAll };
  } };
})(typeof window !== 'undefined' ? window : globalThis);
