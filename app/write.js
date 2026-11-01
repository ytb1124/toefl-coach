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
  const Core = { roles, sentences, wordCount, structure, requirements, topCats, BS_SEC, EMAIL_SEC, AD_SEC, PLAN_SEC };
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
    return { run, fix, bs, today, room, stopAll };
  } };
})(typeof window !== 'undefined' ? window : globalThis);
