/* 리딩 오답 다시 풀기 — 소站 TPO独家 모의고사에서 틀린 리딩 세트(C-Test·일상 지문·학술 지문)를 원문 그대로 다시 푼다.
 * 자료는 리스닝 탭과 같은 비공개 경로 (window.ZhanData, app/listen.js): private/zhan/reading.js 또는 비공개 저장소의 reading.json.
 * 기록 키 'toefl-read-v1' (Sync로 기기 동기화). Routes: #/read · #/read/<setId>
 * 또 틀림/안 풂/맞힘 판정과 순서는 ListenCore와 같은 규칙 (오늘 훈련의 같은 원본 문제 기록 포함). */
(function (root) {
  'use strict';
  const KEY = 'toefl-read-v1';
  const KIND = { ctest: 'C-Test', daily: '일상 지문', academic: '학술 지문' };
  const L = 'ABCDEFGHI';
  // C-Test는 입력을 소문자로 정규화해 정답(빠진 글자)과 그대로 비교한다 → ListenCore의 ans === answer 비교를 그대로 쓴다.
  const normTyped = v => String(v || '').trim().toLowerCase();

  root.ReadApp = { create(env) {
    const { h, go, storage, toast } = env;
    const link = env.link || { info: () => null, log: () => {} };
    const Z = () => root.ZHAN_READ;
    const ensureData = then => root.ZhanData.load('reading', 'ZHAN_READ', then);
    const { status, queue } = root.ListenCore;
    const answerKey = q => (q.type === 'ctest' ? normTyped(q.answer) : q.answer);
    const setsForCore = () => Z().sets.map(s => Object.assign({}, s, { qs: s.qs.map(q => Object.assign({}, q, { answer: answerKey(q) })) }));

    function load() { try { const d = JSON.parse(storage.getItem(KEY) || 'null'); if (d && d.v) return Object.assign({ v: 1, sets: {} }, d); } catch (e) { /* fresh */ } return { v: 1, sets: {} }; }
    function save(mut) { const d = load(); mut(d); try { storage.setItem(KEY, JSON.stringify(d)); } catch (e) { toast('저장 실패: ' + e.message); } return d; }
    const hist = q => { const i = q.orig ? link.info(q.orig) : null; return i && i.n ? { ok: i.lastOk, at: i.lastAt } : null; };
    const back = (hash, label) => h('a', { class: 'small', href: hash }, '← ' + label);
    const chipFor = st => h('span', { class: 'chip ' + ({ new: '', fixed: 'src-tutor', again: 'rc-repeat' })[st] }, ({ new: '아직 안 풂', fixed: '다시 풀어 맞힘', again: '또 틀림' })[st]);
    const testName = id => (Z().tests.find(t => t.id === id) || {}).name || id;
    function origLine(id) {
      const i = link.info(id); if (!i) return null;
      return h('p', { class: 'small muted' }, i.skill ? h('span', { class: 'chip' }, i.skill) : null, ` 오늘 훈련 원본 ${id} · 다시 푼 기록 ${i.ok}/${i.n} 맞힘`);
    }

    let cur = null;
    function view(main, parts) {
      main.classList.add('listen', 'read');
      ensureData(() => {
        if (!Z()) return main.append(...root.ZhanData.tokenCard(h, { title: '리딩 오답 다시 풀기', lead: '이 기기에 GitHub 토큰을 한 번 넣으면 원문 지문으로 풀 수 있습니다 (리스닝 탭에 넣은 토큰과 같음).',
          retry: done => ensureData(() => { done(!!Z()); if (Z()) { toast('연결했습니다'); main.innerHTML = ''; view(main, []); } }) }));
        const [id] = parts;
        cur = cur && cur.id === id ? cur : null;
        const set = id && Z().sets.find(s => s.id === id);
        if (set) return viewSet(main, set);
        viewList(main);
      });
    }

    // ---------- list ----------
    function viewList(main) {
      const d = load(), order = Z().tests.map(t => t.id), core = setsForCore();
      const st = s => status(core.find(x => x.id === s.id), d.sets[s.id], hist);
      const q = queue(core, d.sets, order, hist);
      const counts = { new: 0, again: 0, fixed: 0 };
      Z().sets.forEach(s => counts[st(s)]++);
      const wrongTotal = Z().sets.reduce((n, s) => n + s.qs.filter(x => x.wrong).length, 0);
      main.append(root.ZhanData.sourceLine(h, 'reading'), h('section', { class: 'card hero' },
        h('h1', null, '리딩 오답 다시 풀기'),
        h('p', { class: 'muted' }, `소站 TPO独家 ${Z().tests.length}회에서 틀린 ${wrongTotal}문항이 들어 있는 ${Z().sets.length}세트 (C-Test·일상·학술). 원문 지문으로 다시 풀고, 끝나면 해설을 봅니다.`),
        h('p', { class: 'small' }, `또 틀림 ${counts.again} · 아직 안 풂 ${counts.new} · 다시 풀어 맞힘 ${counts.fixed}`),
        h('p', { class: 'small muted' }, '오늘 훈련에서 같은 원본 문제를 다시 푼 기록도 함께 셉니다 (가장 최근 결과 기준).'),
        q.length ? h('button', { class: 'primary', onclick: () => go('#/read/' + q[0].id) }, `다음 세트: ${q[0].title} (${testName(q[0].test)})`) : null));
      for (const t of Z().tests.slice().reverse()) {
        const sets = Z().sets.filter(s => s.test === t.id);
        main.append(h('section', { class: 'card' },
          h('h2', null, t.name, h('span', { class: 'muted small' }, ` ${t.date} · ${t.correct}/${t.total}`)),
          h('ul', { class: 'olist' }, sets.map(s => h('li', { onclick: () => go('#/read/' + s.id) },
            h('div', null, h('b', null, s.title), ' ', h('span', { class: 'muted small' }, `Module ${s.module} · ${KIND[s.kind]}`), ' ', chipFor(st(s))),
            h('div', { class: 'small muted' }, `틀린 문항 ${s.qs.filter(x => x.wrong).length}/${s.qs.length}`))))));
      }
    }

    // ---------- passage: paragraphs, [[iA]] insert positions (■A), [[sA]] sentence labels ([A]), 【n】 C-Test blanks ----------
    function passage(set, blank, marks) {
      const box = h('div', { class: 'passage rpassage' });
      for (const para of set.passage.split(/\n\n+/)) {
        const p = h('p');
        for (const part of para.split(/(【\d+】|\[\[[is][A-Z]\]\])/)) {
          let m;
          if ((m = /^【(\d+)】$/.exec(part))) p.append(blank ? blank(+m[1]) : h('span', { class: 'blank' }, '____'));
          else if ((m = /^\[\[([is])([A-Z])\]\]$/.exec(part))) p.append(h('b', { class: 'imark' + (marks && marks[m[1] + m[2]] ? ' ' + marks[m[1] + m[2]] : '') }, m[1] === 'i' ? '■' + m[2] : '[' + m[2] + ']'));
          else if (part) p.append(part);
        }
        box.append(p);
      }
      return box;
    }

    // ---------- one set ----------
    function viewSet(main, set) {
      if (!cur) cur = { id: set.id, phase: 'q', qi: 0, ans: [] };
      const redraw = () => { main.innerHTML = ''; viewSet(main, set); window.scrollTo(0, 0); };
      main.append(h('div', { class: 'swbar' }, back('#/read', '목록'), h('span', { class: 'small muted' }, `${testName(set.test)} · Module ${set.module} · ${set.title}`)));
      const card = h('section', { class: 'card' });
      main.append(card);
      const finish = () => {
        const core = setsForCore().find(x => x.id === set.id);
        const ok = core.qs.filter((x, k) => cur.ans[k] === x.answer).length;
        set.qs.forEach((x, k) => {
          if (!x.orig) return;
          const right = cur.ans[k] === core.qs[k].answer;
          link.log(x.orig, right, x.type === 'ctest' ? x.prefix + (cur.ans[k] || '') : x.choices[cur.ans[k]]);
        });
        save(d => { const r = d.sets[set.id] || { tries: [] }; r.tries.push({ at: Date.now(), ans: cur.ans.slice(), ok, n: set.qs.length }); d.sets[set.id] = r; });
        cur.phase = 'review'; redraw();
      };

      if (cur.phase === 'q' && set.kind === 'ctest') {
        const inputs = {};
        card.append(h('p', { class: 'small muted' }, `C-Test · 빈칸 ${set.qs.length}개 (시험에서 틀린 것 ${set.qs.filter(q => q.wrong).length}개). 빠진 글자를 채우세요.`),
          passage(set, n => {
            const q = set.qs[n - 1];
            const inp = h('input', { class: 'cblank', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', size: Math.max(3, q.answer.length + 1), 'aria-label': `빈칸 ${n}` });
            inputs[n] = inp;
            return h('span', { class: 'cword' }, inp);   // 앞 글자는 지문에 이미 있음
          }),
          h('button', { class: 'primary', onclick: () => { cur.ans = set.qs.map(q => normTyped(inputs[q.n].value)); finish(); } }, '채점'));
        setTimeout(() => inputs[1] && inputs[1].focus(), 50);
        return;
      }

      if (cur.phase === 'q') {
        const q = set.qs[cur.qi];
        card.append(passage(set),
          h('p', { class: 'small muted' }, `문항 ${cur.qi + 1} / ${set.qs.length}`),
          h('p', { class: 'stem' }, q.stem),
          q.sentence ? h('p', { class: 'insert-s' }, h('b', null, '넣을 문장: '), q.sentence) : null,
          h('div', { class: 'opts' }, q.choices.map((c, i) => h('button', { class: 'opt', onclick: () => {
            cur.ans[cur.qi] = i;
            if (cur.qi + 1 < set.qs.length) { cur.qi++; redraw(); } else finish();
          } }, h('b', null, L[i]), ' ', c))));
        return;
      }

      // review
      const core = setsForCore().find(x => x.id === set.id);
      const ok = core.qs.filter((x, k) => cur.ans[k] === x.answer).length;
      const fixed = core.qs.every((x, k) => !x.wrong || cur.ans[k] === x.answer);
      card.append(h('h2', null, `${ok} / ${set.qs.length}`, ' ', h('span', { class: 'small ' + (fixed ? 'good-text' : 'warn') }, fixed ? '시험에서 틀린 문항을 이번엔 모두 맞힘' : '시험에서 틀린 문항을 또 틀림')));
      if (set.kind === 'ctest') {
        card.append(passage(set, n => {
          const q = set.qs[n - 1], mine = cur.ans[n - 1], right = mine === normTyped(q.answer);
          return h('span', { class: 'cword ' + (right ? 'ok' : 'no') }, right ? h('b', null, q.answer) : [h('s', null, mine || '∅'), h('b', null, q.answer)]);
        }));
      } else {
        const marks = {};
        set.qs.forEach(q => { if (q.type !== 'mc' && q.choices[q.answer]) marks[(q.type === 'insert' ? 'i' : 's') + q.choices[q.answer].replace(/[■[\]]/g, '')] = 'right'; });
        card.append(passage(set, null, marks));
      }
      set.qs.forEach((q, k) => {
        const mine = cur.ans[k], right = mine === core.qs[k].answer;
        if (set.kind === 'ctest' && !q.wrong && right) return;   // C-Test: 맞힌 빈칸은 지문에서 이미 보임
        const body = q.type === 'ctest'
          ? h('p', null, h('b', null, `빈칸 ${q.n}. `), q.prefix, h('b', null, q.answer),
            h('span', { class: 'muted small' }, ` · 이번 ${mine ? q.prefix + mine : '(빈칸)'}`, q.wrong ? ` · 시험 때 ${q.my ? q.prefix + q.my : '(빈칸)'}` : ''))
          : [h('p', null, h('b', null, `Q${k + 1}. `), q.stem), q.sentence ? h('p', { class: 'small' }, h('b', null, '넣을 문장: '), q.sentence) : null,
            h('ul', { class: 'lchoices' }, q.choices.map((c, i) => h('li', { class: i === q.answer ? 'right' : i === mine ? 'wrong' : '' },
              h('b', null, L[i]), ' ', c,
              i === q.answer ? h('span', { class: 'chip src-tutor' }, '정답') : null,
              i === mine && i !== q.answer ? h('span', { class: 'chip rc-repeat' }, '이번 내 답') : null,
              q.wrong && i === q.my ? h('span', { class: 'chip' }, '시험 때 내 답') : null)))];
        card.append(h('div', { class: 'fb ' + (right ? 'good' : 'bad') }, body,
          q.orig ? origLine(q.orig) : null,
          q.whyKo ? h('p', { class: 'small' }, q.whyKo) : null,
          q.point ? h('p', { class: 'rule small' }, '다음엔 → ', q.point) : null,
          !q.whyKo && q.whyZh ? h('details', null, h('summary', { class: 'small' }, q.wrong ? '해설 (중국어 원문, 한국어 해설 없음)' : '해설 (중국어 원문 — 시험에서 맞힌 문항)'), h('pre', { class: 'essaytext small' }, q.whyZh)) : null));
      });
      const d = load();
      const nxt = queue(setsForCore(), d.sets, Z().tests.map(t => t.id), hist).find(s => s.id !== set.id);
      card.append(h('div', { class: 'row' },
        h('button', { class: 'ghost', onclick: () => { cur = null; redraw(); } }, '같은 세트 다시 풀기'),
        nxt ? h('button', { class: 'primary', onclick: () => { cur = null; go('#/read/' + nxt.id); } }, '다음 세트 →') : null));
    }
    return { view };
  } };
})(typeof window !== 'undefined' ? window : globalThis);
