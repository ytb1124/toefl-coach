/* 쓰기 — 소站 TPO独家 Build a Sentence (6분 50초, docs/exam-rules.md) · 반복 오류 고쳐 쓰기 (오늘 계획 ⑤ · 연습실).
 * Email·Academic Discussion 쓰기·계획 카드·개요 드릴은 2026-11-02에 없앴다 (해커스 모범답안 훈련으로 대체 예정).
 * 예전에 쓴 글은 주 기록 writing[]에 그대로 남고 내보낼 수 있다. 구조·문장 역할 함수(WriteCore)는 옛 기록 지표용으로 남긴다.
 * 순수 로직(WriteCore)은 node 테스트에서도 쓴다 (tests/write.test.js). */
(function (root) {
  'use strict';

  // ---------- pure ----------
  const ROLE_RE = [
    ['입장', /\b(I (strongly |firmly |personally |also )?(believe|think|agree|disagree|support|feel|prefer|lean)|in my (opinion|view)|from my (perspective|point of view)|my (view|position) is|I('m| am) (in favor|convinced))\b/i],
    ['예시', /\b(for (example|instance)|such as|take [^.]{0,40} as an example|in my (experience|case)|when I was|last (year|month|semester|summer|week)|a (friend|classmate|study|survey) of)\b/i],
    ['대조', /\b(while|although|though|however|on the other hand|unlike|admittedly|whereas|in contrast|some (people|may|might) (argue|say|think)|[A-Z][a-z]+ (argues|says|thinks|mentions|suggests) that)\b/i],
    ['맺음', /\b(therefore|thus|in conclusion|overall|that is why|that's why|for these reasons|to sum up|all in all|in short)\b/i],
    ['이유', /\b(because|since|the (main|primary|first|second|biggest) (reason|benefit|problem|issue)|one reason|this is because|due to|this (means|allows|helps|leads)|as a result)\b/i],
  ];
  const sentences = t => String(t || '').replace(/\s+/g, ' ').match(/[^.!?]+[.!?]+["')\]]*|[^.!?]+$/g)?.map(s => s.trim()).filter(Boolean) || [];
  function roles(text) {
    return sentences(text).map(s => { const r = ROLE_RE.find(([, re]) => re.test(s)); return { s, role: r ? r[0] : null }; });
  }
  const wordCount = t => (String(t || '').match(/[A-Za-z0-9'’-]+/g) || []).length;
  // Concrete example = names a person/place/number (누가·어디서·숫자).
  const concrete = s => /\d|\b(my|I)\b|\b[A-Z][a-z]+\b(?<!^\w+)/.test(s);
  function structure(text, kind) {
    const r = roles(text);
    const re = k => ROLE_RE.find(([n]) => n === k)[1];
    const has = k => r.some(x => re(k).test(x.s));
    const checks = kind === 'email'
      ? [['인사·목적', /\b(dear|hello|hi)\b/i.test(text) && /\b(writing|I am|I'm)\b/i.test(text)], ['요청·제안', /\b(would you|could you|I would like|please|I hope)\b/i.test(text)], ['맺음 인사', /\b(best|sincerely|regards|thank you)\b/i.test(text)], ['100단어 이상', wordCount(text) >= 100]]
      : [['입장', has('입장')], ['이유', has('이유')], ['구체 예시 (누가·어디서·숫자)', r.some(x => re('예시').test(x.s) && concrete(x.s))], ['다른 학생과의 차이', has('대조')], ['100단어 이상', wordCount(text) >= 100]];
    return { roles: r, checks, score: checks.filter(c => c[1]).length, of: checks.length };
  }
  // Email requirements: the bullet lines of the prompt ("- Thank her…").
  const requirements = prompt => String(prompt || '').split('\n').map(l => l.trim()).filter(l => /^[-•·]/.test(l)).map(l => l.replace(/^[-•·]\s*/, ''));
  // Most frequent error categories over texts (SWCore.scan flags) → top n.
  function topCats(flagLists, n) {
    const c = {};
    for (const fl of flagLists) for (const f of fl) if (f.level !== 'info') c[f.cat] = (c[f.cat] || 0) + 1;
    return Object.keys(c).sort((a, b) => c[b] - c[a]).slice(0, n || 3);
  }
  const BS_SEC = 410, EMAIL_SEC = 420, AD_SEC = 600, PLAN_SEC = 120, OUTLINE_SEC = 600;

  // ---- 실전 쓰기 점검 (2026-11-07): FM-TOEFL 54에서 점수를 잃은 것(요구사항 누락·짧은 글·구체성 없음·결론의 새 주장)을 규칙으로 잡는다. 점수를 매기지 않는다. ----
  const STOP = new Set('the a an and or but to of in on at for with from by is are was were be been it this that these those i you he she we they my your his her our their me him them as so if then than not no do does did can could would should will have has had about into over after before when what which who how why there here also very more most some any each every'.split(' '));
  const stem = w => w.toLowerCase().replace(/(ing|ed|es|s)$/, '');
  const contentWords = t => [...new Set((String(t || '').match(/[A-Za-z]{4,}/g) || []).map(stem).filter(w => w.length >= 3 && !STOP.has(w)))];
  function liveCheck(text, kind, reqs) {
    const sents = sentences(text);
    const n = wordCount(text);
    const min = kind === 'email' ? 100 : 120;
    const checks = [{ id: 'len', ok: n >= min, label: `단어 ${n}개 (목표 ${min}개 이상)`, tip: '짧으면 요구사항마다 한 문장을 더하세요.' }];
    const textStems = new Set(contentWords(text));
    for (const r of (reqs || []).filter(Boolean)) {
      const kw = contentWords(r);
      const hit = kw.filter(w => textStems.has(w));
      const ok = kw.length ? hit.length >= Math.max(1, Math.ceil(kw.length * 0.4)) : null;
      checks.push({ id: 'req', ok, label: `요구사항: ${r.length > 60 ? r.slice(0, 57) + '…' : r}`, tip: `이 요구를 답하는 문장이 보이지 않습니다. 핵심어 예: ${kw.slice(0, 4).join(', ')}` });
    }
    const st = structure(text, kind);
    for (const [name, ok] of st.checks) if (!/단어 이상/.test(name)) checks.push({ id: 'struct', ok, label: name, tip: '이 요소가 글에서 보이지 않습니다.' });
    // 결론에 새 주장: 마지막 문장의 내용어(5자 이상)가 앞 글에 거의 없으면 경고
    if (sents.length >= 4) {
      const last = sents[sents.length - 1];
      const before = new Set(contentWords(sents.slice(0, -1).join(' ')));
      const fresh = contentWords(last).filter(w => w.length >= 5 && !before.has(w));
      checks.push({ id: 'newclaim', ok: fresh.length < 3, label: '결론에 새 주장 없음', tip: `마지막 문장에 새 단어가 많습니다 (${fresh.slice(0, 4).join(', ')}). 앞에서 한 말을 정리만 하세요.` });
    }
    // 같은 단어 3번 이상 반복 (어휘 다양성)
    const cnt = {};
    for (const w of (String(text).toLowerCase().match(/[a-z]{5,}/g) || [])) if (!STOP.has(w)) cnt[w] = (cnt[w] || 0) + 1;
    const rep = Object.keys(cnt).filter(w => cnt[w] >= 4);
    checks.push({ id: 'repeat', ok: rep.length === 0, label: rep.length ? `같은 단어 반복: ${rep.slice(0, 3).join(', ')}` : '단어 반복 없음', tip: '동의어나 대명사로 바꾸세요.' });
    return { words: n, checks, passed: checks.filter(c => c.ok === true).length, total: checks.filter(c => c.ok != null).length };
  }
  const Core = { roles, sentences, wordCount, structure, requirements, topCats, liveCheck, BS_SEC, EMAIL_SEC, AD_SEC, PLAN_SEC };
  if (typeof module !== 'undefined' && module.exports) { module.exports = Core; return; }
  root.WriteCore = Core;

  // ---------- UI ----------
  root.WriteApp = { create(env) {
    const { h, toast } = env;
    const ap = (el, ...kids) => el.append(...kids.flat(Infinity).filter(x => x != null && x !== false));
    const rc = (el, ...kids) => el.replaceChildren(...kids.flat(Infinity).filter(x => x != null && x !== false));
    const ZD = () => root.ZhanData;
    const ensure = then => ZD().loadAll([['pool', 'ZHAN_POOL']], then);
    const sets = kind => ((root.ZHAN_POOL && root.ZHAN_POOL.sets) || []).filter(s => s.kind === kind && !s.held);
    const scanRules = () => env.scanRules();
    const scan = (t, kind) => root.SWCore ? root.SWCore.scan(t, scanRules(), kind) : [];
    let timers = [];
    const stopAll = () => { timers.forEach(clearInterval); timers = []; };
    window.addEventListener('hashchange', stopAll);
    function countdown(sec, onEnd) {
      let left = sec, hidden = false;
      const t = h('span', { class: 'cd-time' });
      const draw = () => { t.textContent = hidden ? '' : (left < 0 ? '+' : '') + Math.floor(Math.abs(left) / 60) + ':' + String(Math.abs(left) % 60).padStart(2, '0'); };
      const b = h('button', { class: 'link small', onclick: () => { hidden = !hidden; b.textContent = hidden ? 'Show Time' : 'Hide Time'; draw(); } }, 'Hide Time');
      const el = h('div', { class: 'cdown' }, t, ' ', b); draw();
      const id = setInterval(() => { left--; draw(); if (left === 0 && onEnd) onEnd(); }, 1000); timers.push(id);
      el.stop = () => clearInterval(id); el.left = () => left;
      return el;
    }
    // ---- 집중 첨삭: 상위 2~3범주만 고쳐 쓰기 (내가 쓴 글·말한 답에서 걸린 문장) ----
    function fix(main, task, done) {
      const cats = task.cats && task.cats.length ? task.cats : topCats(env.writingLog().filter(w => w.text).map(w => scan(w.text, w.kind)), 3);
      ap(main, h('p', { class: 'kicker' }, '⑤ 쓰기 · 반복 오류 고쳐 쓰기'));
      const box = h('section', { class: 'card' }); ap(main, box);
      if (!cats.length) { ap(box, h('p', { class: 'muted' }, '아직 반복 오류 기록이 없습니다.'), h('button', { class: 'primary', onclick: () => done({}) }, '다음')); return; }
      const catName = c => (env.cats()[c] || {}).label || c;
      ap(box, h('p', null, '오늘 범주: ', cats.map(catName).join(' · ')));
      const items = [];
      for (const w of env.writingLog().slice().reverse()) {
        if (!w.text) continue;
        for (const s of sentences(w.text)) {
          const fl = scan(s, w.kind).filter(f => cats.includes(f.cat));
          if (fl.length && items.length < 6 && !items.some(x => x.s === s)) items.push({ s, fl, kind: w.kind });
        }
      }
      if (!items.length) for (const g of env.tutorGrammar(cats).slice(0, 5)) items.push({ s: g.wrong, fl: [{ cat: g.cat, msg: '튜터 교정 문장 (' + g.src + ')' }], kind: 'tutor', answers: g.answers });
      let fixed = 0;
      for (const it of items) {
        const ta = h('textarea', { rows: 2 }, it.s);
        const msg = h('p', { class: 'small' });
        ap(box, h('div', { class: 'fb' }, h('p', null, h('b', null, catName(it.fl[0].cat)), ' — ', it.fl[0].msg), h('p', { class: 'muted' }, it.s), ta,
          h('button', { class: 'ghost small', onclick: () => {
            const still = scan(ta.value, it.kind === 'tutor' ? 'email' : it.kind).filter(f => cats.includes(f.cat));
            const same = ta.value.trim() === it.s.trim();
            msg.textContent = same ? '아직 그대로입니다.' : still.length ? '아직 같은 범주가 걸립니다: ' + still.map(f => f.match).join(', ') : '같은 범주 오류가 사라졌습니다.' + (it.answers ? ' 튜터 교정: ' + it.answers[0] : '');
            if (!same && !still.length) fixed++;
          } }, '확인'), msg));
      }
      ap(box, h('button', { class: 'primary', onclick: () => { env.logWriting({ kind: 'fix', cats, n: items.length, fixed }); done({ followup: task.key }); } }, '다음'));
    }

    // ---- Build a Sentence (소站 10문항, 6분 50초 하나, Next만, 답 없이 넘어가기 가능) ----
    function bs(main, setId, done) {
      ensure(() => {
        const set = sets('bs').find(s => s.id === setId) || sets('bs')[0];
        if (!set) return noData(main, done);
        ap(main, h('p', { class: 'kicker' }, '쓰기 · Build a Sentence · ', h('span', { class: 'muted' }, set.src)));
        const box = h('section', { class: 'card' }); ap(main, box);
        const res = []; let i = 0; let ended = false;
        const cd = countdown(BS_SEC, () => finish());
        const area = h('div');
        ap(box, h('div', { class: 'qhead' }, h('span', { class: 'small muted' }, '타일을 눌러 빈칸을 채우세요 (다시 누르면 뺌).'), cd), area);
        const one = () => {
          if (i >= set.qs.length) return finish();
          const q = set.qs[i];
          const tiles = q.answer.concat(q.extra).map((t, k) => ({ t, k })).sort((a, b) => (a.t.length * 7 + a.k * 13) % 11 - (b.t.length * 7 + b.k * 13) % 11);
          const placed = [];
          const slots = h('p', { class: 'bs-line' }); const pool = h('div', { class: 'row wrap' });
          const draw = () => {
            let n = 0;
            rc(slots, ...q.template.split(/(_)/).map(part => part === '_' ? h('span', { class: 'slot' }, ' ', placed[n++] ? placed[n - 1].t : '____', ' ') : part));
            rc(pool, ...tiles.map(x => h('button', { class: 'tagb' + (placed.includes(x) ? ' sel' : ''), onclick: () => { const j = placed.indexOf(x); if (j >= 0) placed.splice(j, 1); else if (placed.length < q.answer.length) placed.push(x); draw(); } }, x.t)));
          };
          draw();
          rc(area, h('p', { class: 'small muted' }, `${i + 1} / ${set.qs.length}`), q.first ? null : h('p', null, q.context || '(앞 말풍선 기록 없음)'), slots, pool,
            h('button', { class: 'primary', onclick: () => { const mine = placed.map(x => x.t); res.push({ q, mine, ok: mine.join(' ') === q.answer.join(' ') }); i++; one(); } }, i < set.qs.length - 1 ? 'Next' : '제출'));
        };
        const finish = () => {
          if (ended) return; ended = true; cd.stop();
          for (const q of set.qs.slice(res.length)) res.push({ q, mine: [], ok: false, timeout: true });
          env.logWriting({ kind: 'bs', task: set.id, correct: res.filter(r => r.ok).length, total: res.length, ms: (BS_SEC - cd.left()) * 1000 });
          rc(area, h('p', null, `${res.filter(r => r.ok).length} / ${res.length} 정답`),
            res.filter(r => !r.ok).map(r => h('div', { class: 'fb bad' }, h('p', null, h('b', null, r.q.template.split('_').reduce((s, part, k) => s + (k ? r.q.answer[k - 1] : '') + part, ''))),
              h('p', { class: 'small muted' }, '내 답: ', r.mine.length ? r.mine.join(' / ') : '— (답 안 함)'), r.q.whyKo ? h('p', { class: 'small' }, r.q.whyKo) : null)),
            h('button', { class: 'primary', onclick: () => done({}) }, '다음'));
        };
        one();
      });
    }

    // ---- 실전 쓰기 점검: 문제를 붙여 넣고(또는 그냥 쓰고) 타이머로 쓴 뒤 체크리스트 + Claude용 복사 ----
    function live(main, kind) {
      kind = kind === 'discussion' ? 'discussion' : 'email';
      const sec = kind === 'email' ? EMAIL_SEC : AD_SEC;
      ap(main, h('p', { class: 'kicker' }, '쓰기 · 실전 쓰기 점검'));
      const box = h('section', { class: 'card' }); ap(main, box);
      const prompt = h('textarea', { rows: 5, placeholder: '문제(지시문·교수/학생 글)를 붙여 넣으세요. 비워 두어도 됩니다.' });
      const reqs = h('textarea', { rows: 3, placeholder: kind === 'email' ? '요구사항 한 줄에 하나 (예: Explain the problem with the direct deposit)' : '(Discussion은 비워 두세요)' });
      const kindRow = h('div', { class: 'row' }, ['email', 'discussion'].map(k => h('button', { class: k === kind ? 'primary' : 'ghost', onclick: () => { stopAll(); rc(main); live(main, k); } }, k === 'email' ? 'Email (7분)' : 'Academic Discussion (10분)')));
      const area = h('textarea', { rows: 14, spellcheck: 'true', placeholder: '시작을 누르면 타이머가 돕니다. 철자 틀린 단어는 빨간 밑줄로 보입니다.' });
      area.disabled = true;
      const out = h('div');
      let cd = null, started = null;
      const startBtn = h('button', { class: 'primary', onclick: () => {
        started = Date.now(); area.disabled = false; area.focus(); startBtn.remove();
        cd = countdown(sec, () => toast('시간 종료 — 마무리하고 제출하세요')); head.append(cd);
      } }, '▶ 시작');
      const head = h('div', { class: 'qhead' }, h('span', { class: 'small muted' }, `${kind === 'email' ? 'Email 7분' : 'Discussion 10분'} · 다 쓰면 제출하세요. 마지막 60초는 철자·시제 검토.`));
      const submit = h('button', { class: 'primary', onclick: () => {
        const text = area.value.trim();
        if (!text) { toast('먼저 글을 쓰세요'); return; }
        if (cd) cd.stop();
        const rq = reqs.value.split('\n').map(s => s.trim()).filter(Boolean);
        const r = liveCheck(text, kind, rq);
        const flags = scan(text, kind).filter(f => f.level !== 'info');
        const md = `# ${kind === 'email' ? 'Email' : 'Academic Discussion'} 실전 (${new Date().toLocaleString()})\n\n## 문제\n${prompt.value.trim() || '(없음)'}\n\n## 요구사항\n${rq.join('\n') || '(없음)'}\n\n## 내 글 (${r.words}단어, ${started ? Math.round((Date.now() - started) / 1000) + '초' : '시간 미측정'})\n${text}\n`;
        env.logWriting({ kind: 'live', mode: kind, task: 'live-' + Date.now().toString(36), text, words: r.words, passed: r.passed, total: r.total, structure: structure(text, kind).checks, cats: [...new Set(flags.map(f => f.cat))], plan: [], ms: started ? Date.now() - started : null });
        rc(out, h('h3', null, `체크 ${r.passed} / ${r.total}`),
          h('ul', { class: 'small' }, r.checks.map(c => h('li', { class: c.ok === false ? 'miss' : 'ok' }, (c.ok === false ? '✗ ' : c.ok ? '✓ ' : '· ') + c.label + (c.ok === false ? ' — ' + c.tip : '')))),
          flags.length ? h('div', null, h('h4', null, '문법·표현 의심'), h('ul', { class: 'small' }, flags.slice(0, 12).map(f => h('li', null, (f.match ? '“' + f.match + '” ' : '') + (f.msg || f.cat))))) : h('p', { class: 'small muted' }, '규칙으로 잡히는 문법 오류는 없습니다.'),
          h('div', { class: 'row' }, h('button', { class: 'ghost', onclick: () => { try { navigator.clipboard.writeText(md).then(() => toast('복사했습니다 — Claude에게 붙여 넣으세요')); } catch (e) { toast('복사 실패'); } } }, 'Claude에게 보낼 글 복사')));
      } }, '제출·점검');
      ap(box, kindRow, h('label', { class: 'small muted' }, '문제'), prompt, kind === 'email' ? h('label', { class: 'small muted' }, '요구사항 (요구 누락 점검용)') : null, kind === 'email' ? reqs : null, head, startBtn, area, h('div', { class: 'row' }, submit), out);
    }

    function noData(main, done) {
      ap(main, h('section', { class: 'card' }, h('p', { class: 'notice' }, '소站 쓰기 자료를 불러오지 못했습니다 (비공개 자료). Mac에서 start.command로 열거나 토큰을 넣으세요.'),
        h('button', { class: 'primary', onclick: () => done({ skipped: true }) }, '넘어가기')));
    }

    // 오늘 계획용 (공개 메타데이터만): 안 푼 BS 세트, 반복 오류 상위 범주.
    function today(content, D) {
      const log = (D && D.writing) || [];
      const done = new Set(log.map(w => w.task));
      const meta = content.pool.sets.filter(s => !s.held);
      const cats = topCats(log.filter(w => w.cats).map(w => w.cats.map(c => ({ cat: c }))), 3);
      const bsDone = new Set(log.filter(w => w.kind === 'bs').map(w => w.task || w.set));
      const HK = root.HackersCore;
      return { errorCats: cats, left: { bs: meta.filter(s => s.kind === 'bs' && !done.has(s.id) && !bsDone.has(s.id)).map(s => s.id), hkD: HK ? HK.left(log, 'D') : [], hkE: HK ? HK.left(log, 'E') : [] } };
    }
    function room(main, content, go) {
      const meta = content.pool.sets.filter(s => !s.held);
      const btns = (kind, label) => h('section', { class: 'card' }, h('h2', null, label), h('div', { class: 'row wrap' }, meta.filter(s => s.kind === kind).map(s => h('button', { class: 'ghost', onclick: () => go(`#/write/${kind}/${s.id}`) }, `독점 TPO ${s.paper}`))));
      ap(main, h('h1', null, '쓰기 (소站 독점 TPO)'),
        btns('bs', 'Build a Sentence (10문항 · 6분 50초)'),
        h('section', { class: 'card' }, h('h2', null, '실전 쓰기 점검 (Email · Discussion)'), h('p', { class: 'small muted' }, '타이머로 쓰고 → 요구사항·단어 수·예시·결론·철자를 점검 → Claude에게 보낼 글 복사.'),
          h('div', { class: 'row wrap' }, h('button', { class: 'primary', onclick: () => go('#/write/live/email') }, 'Email 7분'), h('button', { class: 'primary', onclick: () => go('#/write/live/discussion') }, 'Discussion 10분'))),
        h('section', { class: 'card' }, h('h2', null, '드릴'), h('div', { class: 'row wrap' },
          h('button', { class: 'ghost', onclick: () => go('#/write/fix') }, '반복 오류 고쳐 쓰기'))),
        h('section', { class: 'card' }, h('h2', null, '쓴 글 내보내기'), h('p', { class: 'small muted' }, `기록된 글 ${env.writingLog().filter(w => w.text).length}편 — Claude에게 첨삭을 맡길 때 이 파일을 주세요.`),
          h('button', { class: 'ghost', onclick: () => exportWritings() }, '파일로 저장 (Markdown)')));
    }
    function exportWritings() {
      const ws = env.writingLog().filter(w => w.text);
      const md = ['# 내가 쓴 글 (toefl-coach)', ''].concat(ws.map(w => [`## ${new Date(w.at).toLocaleString()} · ${w.kind} · ${w.task}`, '', '계획: ' + (w.plan || []).map(f => f.join(': ')).join(' / '), '', w.text, '', `구조: ${(w.structure || []).map(c => (c[1] ? '✓' : '✗') + c[0]).join(' ')} · 오류 범주: ${(w.cats || []).join(', ') || '없음'}`, ''].join('\n'))).join('\n');
      try {
        const a = h('a', { href: URL.createObjectURL(new Blob([md], { type: 'text/markdown' })), download: `writing-${new Date().toISOString().slice(0, 10)}.md` });
        document.body.append(a); a.click(); a.remove();
      } catch (e) { toast('저장 실패: ' + e.message); }
    }

    function run(main, task, done) {
      if (task.type === 'fix') fix(main, task, done);
    }
    return { run, fix, bs, live, today, room, stopAll };
  } };
})(typeof window !== 'undefined' ? window : globalThis);
