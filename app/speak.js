/* 말하기 — 소站 TPO独家 Listen & Repeat · Interview (오늘 계획 ④ · 연습실).
 * 받아쓰기: 로컬 서버(tools/serve.py, start.command)의 Whisper (/stt). 없으면(공개 사이트·휴대폰) '내 녹음 ↔ 원문 번갈아 듣고 놓친 단어 직접 탭'.
 * 시간: L&R 문장마다 소站 limitTime(8/10/12초), Interview 45초 (docs/exam-rules.md). Interview 질문 음성은 소站에 없어 Kokoro로 만든 것 (표시함).
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
  // 4/3/2: the same answer three times with shorter limits (45s → 34s → 23s, ratio 4:3:2).
  const ROUNDS = base => [base, Math.round(base * 3 / 4), Math.round(base / 2)];
  const Core = { speechStats, ROUNDS };
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
    const stopAll = () => { if (cur) try { cur.pause(); } catch (e) { /* gone */ } cur = null; if (record.stop) record.stop(); };
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
          const step = () => {
            if (i >= qs.length) { spaceHandler = null; resolve(); return; }
            const q = qs[i];
            status.textContent = `${i + 1} / ${qs.length} · 듣는 중…`;
            spaceHandler = null;
            play(q.audio).then(() => {
              beep();
              spaceHandler = () => record.stop && record.stop();
              return record(q.limit || 10, left => { status.textContent = `${i + 1} / ${qs.length} · 따라 말하기 ${left}초`; });
            }).then(blob => { results.push({ q, blob }); i++; step(); })
              .catch(e => { status.textContent = '오류: ' + e.message + ' (마이크 권한을 확인하세요)'; spaceHandler = null; resolve(); });
          };
          step();
        });
        const startBtn = big('▶ 시작 (스페이스바)', () => go());
        const go = () => { startBtn.remove(); spaceHandler = null; runRound().then(review); };
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
              ap(box, missed.length ? h('button', { class: 'ghost', onclick: () => { qs = missed.map(r => r.q); results.length = 0; list.remove(); runRound().then(review); } }, `틀린 문장 ${missed.length}개만 다시`) : h('p', { class: 'verdict good' }, '모든 문장을 빠짐없이 따라 말했습니다.'),
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

    // ---- Interview 4/3/2: 같은 질문에 45초 → 34초 → 23초. 받아쓰기로 말 속도·멈춤·반복 오류 범주. ----
    function interview(main, task, done) {
      ensure(() => {
        const set = sets('interview').find(s => s.qs.some(q => q.id === task.q));
        const q = set && set.qs.find(x => x.id === task.q);
        if (!q) { noData(main, done); return; }
        const rounds = task.rounds || ROUNDS(q.limit || 45);
        const qAudio = q.audio || `private/zhan/kokoro/${q.id}.mp3`;
        ap(main, h('p', { class: 'kicker' }, '④ 말하기 · Interview 4/3/2 · ', h('span', { class: 'muted' }, set.src)));
        const box = h('section', { class: 'card' }); ap(main, box);
        ap(box, h('p', { class: 'small' }, `같은 질문에 세 번 답합니다: ${rounds.join('초 → ')}초. 준비 시간 없이 바로 시작합니다 (소站 규칙). 내용은 같게, 더 짧고 매끄럽게.`),
          q.audio && !q.audioSrc ? null : h('p', { class: 'small muted' }, '질문 음성: 원본 음원 아님 (Kokoro 생성) — 소站 자료에 질문 음성이 없습니다.'));
        const status = h('p', { class: 'listening-status' });
        const out = [];
        const startBtn = big('▶ 질문 듣고 시작 (스페이스바)', () => run());
        spaceHandler = () => run();
        ap(box, status, startBtn);
        let started = false;
        function run() {
          if (started) return; started = true; startBtn.remove(); spaceHandler = null;
          status.textContent = '질문 듣는 중…';
          play(qAudio).catch(() => { status.textContent = '질문 음성을 재생하지 못했습니다 — 글로 읽고 답하세요.'; ap(box, h('p', { class: 'stem' }, q.text)); })
            .then(() => roundN(0));
        }
        function roundN(r) {
          if (r >= rounds.length) return review();
          beep();
          spaceHandler = () => record.stop && record.stop();
          record(rounds[r], left => { status.textContent = `${r + 1}회차 (${rounds[r]}초) · 남은 시간 ${left}초 — 다 말했으면 스페이스바`; })
            .then(blob => { out.push({ sec: rounds[r], blob }); spaceHandler = null; status.textContent = r + 1 < rounds.length ? '잠깐 숨 고르고 다음 회차…' : ''; setTimeout(() => roundN(r + 1), 1500); })
            .catch(e => { status.textContent = '오류: ' + e.message + ' (마이크 권한을 확인하세요)'; });
        }
        function review() {
          ap(box, h('p', { class: 'stem' }, q.text));
          sttReady().then(ok => {
            const rows = h('div'); ap(box, h('h3', null, '결과'), rows);
            const stats = [];
            const next = k => {
              if (k >= out.length) return finish();
              const r = out[k];
              const row = h('div', { class: 'fb' }, h('p', null, h('b', null, `${k + 1}회차 (${r.sec}초)`), ' ', h('button', { class: 'ghost small', onclick: () => playBlob(r.blob) }, '▶ 내 녹음')));
              ap(rows, row);
              if (!ok) { next(k + 1); return; }
              transcribe(r.blob).then(t => {
                const st = speechStats(t.words);
                const flags = root.SWCore && env.scanRules ? root.SWCore.scan(t.text, env.scanRules(), 'interview') : [];
                stats.push(Object.assign({ sec: r.sec, cats: [...new Set(flags.map(f => f.cat))] }, st));
                ap(row, h('p', { class: 'small' }, `${st.words}단어 · ${st.wpm || '—'} wpm · 0.8초 이상 멈춤 ${st.pauses}번 (가장 긴 ${st.longest}초)`),
                  h('p', null, t.text || '(소리 없음)'),
                  flags.length ? h('ul', { class: 'small' }, flags.slice(0, 6).map(f => h('li', null, h('b', null, f.match), ' — ', f.msg))) : null);
                next(k + 1);
              }).catch(e => { ap(row, h('p', { class: 'small' }, e.message)); next(k + 1); });
            };
            const finish = () => {
              env.logSpeak({ kind: 'interview', q: q.id, stt: ok, rounds: stats });
              const cats = [...new Set(stats.flatMap(s => s.cats))];
              if (cats.length) env.log({ item: q.id, skill: null, tier: 'speak', correct: false, cause: 'grammar', cats });
              if (!ok) ap(box, h('p', { class: 'small muted' }, '이 기기에서는 받아쓰기를 쓸 수 없어 녹음만 남았습니다 (Mac의 start.command로 열면 받아쓰기·말 속도·문법 범주를 봅니다).'));
              if (q.model) ap(box, h('details', null, h('summary', null, '소站 제공 답안 (모범 답안)'), h('p', null, q.model)));
              ap(box, h('button', { class: 'primary', onclick: () => done({}) }, '다음'));
            };
            next(0);
          });
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
        h('section', { class: 'card' }, h('h2', null, 'Interview 4/3/2'), h('div', { class: 'row wrap' }, meta.filter(s => s.kind === 'interview').map(s => h('button', { class: 'ghost', onclick: () => go('#/speak/iv/' + s.qs[0].id) }, `독점 TPO ${s.paper}`)))));
    }

    return { lr, interview, shadow, today, room, sttReady, stopAll };
  } };
})(typeof window !== 'undefined' ? window : globalThis);
