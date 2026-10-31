/* 한국어로 풀어 보기 — 시험에서 틀린 독점 TPO 리딩·리스닝 세트를 한국어 번역으로 풀어, 오답의 원인을 가른다.
 * 시험 때 틀린 문제를 한국어로 맞히면 → 영어 이해 문제, 한국어로도 틀리면 → 판단 문제. 어휘 문제는 영어 단어를 묻는 것이라 진단에서 뺀다.
 * 자료는 리스닝·리딩 탭과 같은 비공개 경로 (window.ZhanData): private/zhan/kotrial.js 또는 비공개 저장소의 kotrial.json (tools/zhan_ko.py).
 * 기록 키 'toefl-ko-v1' (Sync로 기기 동기화). 오늘 훈련의 원본 기록에는 넣지 않는다 (영어로 푼 기록과 섞지 않음). Routes: #/ko · #/ko/<setId> */
(function (root) {
  'use strict';
  const KEY = 'toefl-ko-v1';
  const L = 'ABCDEFGHI';
  const KIND = { daily: '일상 지문', academic: '학술 지문', conversation: '대화', announcement: '공지', lecture: '강의' };

  // 진단: 시험에서 틀린 문항(어휘 제외)의 이번 한국어 풀이 결과 → 'eng' 영어 이해 문제 · 'judge' 판단 문제 · null 아직 안 풂
  function diagnose(q, ans) {
    if (!q.wrong || q.vocab) return null;
    if (ans == null) return null;
    return ans === q.answer ? 'eng' : 'judge';
  }
  const Core = { diagnose };
  if (typeof module !== 'undefined' && module.exports) { module.exports = Core; return; }

  root.KoTrialApp = { create(env) {
    const { h, go, storage, toast } = env;
    const Z = () => root.ZHAN_KO;
    const ensureData = then => root.ZhanData.load('kotrial', 'ZHAN_KO', then);
    function load() { try { const d = JSON.parse(storage.getItem(KEY) || 'null'); if (d && d.v) return Object.assign({ v: 1, sets: {} }, d); } catch (e) { /* fresh */ } return { v: 1, sets: {} }; }
    function save(mut) { const d = load(); mut(d); try { storage.setItem(KEY, JSON.stringify(d)); } catch (e) { toast('저장 실패: ' + e.message); } return d; }
    const lastTry = (d, id) => { const r = d.sets[id]; return r && r.tries.length ? r.tries[r.tries.length - 1] : null; };
    const back = (hash, label) => h('a', { class: 'small', href: hash }, '← ' + label);
    const DX = { eng: ['영어 이해 문제', 'src-tutor'], judge: ['판단 문제', 'rc-repeat'] };
    const dxChip = k => k ? h('span', { class: 'chip ' + DX[k][1] }, DX[k][0]) : null;
    const tally = (d, sets) => {
      const c = { eng: 0, judge: 0, open: 0 };
      sets.forEach(s => { const t = lastTry(d, s.id); s.qs.forEach((q, i) => { if (!q.wrong || q.vocab) return; const k = diagnose(q, t ? t.ans[i] : null); c[k || 'open']++; }); });
      return c;
    };

    let cur = null;
    function view(main, parts) {
      main.classList.add('listen', 'read');
      ensureData(() => {
        if (!Z()) return main.append(...root.ZhanData.tokenCard(h, { title: '한국어로 풀어 보기', lead: '이 기기에 GitHub 토큰을 한 번 넣으면 번역 지문으로 풀 수 있습니다 (리스닝·리딩 탭과 같은 토큰).',
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
      const d = load(), sets = Z().sets, c = tally(d, sets);
      const next = sets.find(s => !lastTry(d, s.id));
      main.append(h('section', { class: 'card hero' },
        h('h1', null, '한국어로 풀어 보기'),
        h('p', { class: 'muted' }, `${sets[0].testName}에서 틀린 문제가 있는 리딩·리스닝 세트를 한국어로 풉니다. 시험에서 틀린 문제를 한국어로 맞히면 영어가 원인, 한국어로도 틀리면 문제를 푸는 판단이 원인입니다.`),
        h('p', { class: 'small' }, `영어 이해 문제 ${c.eng} · 판단 문제 ${c.judge} · 아직 안 풂 ${c.open}`),
        h('p', { class: 'small muted' }, '리스닝은 스크립트 번역을 한 번 읽고 문제로 넘어갑니다 (문제를 풀 때는 스크립트가 안 보임). 보기 순서는 매번 섞입니다. 영어로 다시 풀어 본 적이 있으면 답을 기억할 수 있으니, 기억이 아니라 내용으로 고르세요.'),
        next ? h('button', { class: 'primary', onclick: () => go('#/ko/' + next.id) }, `다음 세트: ${next.title}`) : null));
      for (const sec of ['R', 'L']) {
        const list = sets.filter(s => s.sec === sec);
        main.append(h('section', { class: 'card' }, h('h2', null, sec === 'R' ? '리딩' : '리스닝'),
          h('ul', { class: 'olist' }, list.map(s => {
            const t = lastTry(d, s.id);
            const dx = s.qs.map((q, i) => diagnose(q, t ? t.ans[i] : null)).filter(Boolean);
            return h('li', { onclick: () => go('#/ko/' + s.id) },
              h('div', null, h('b', null, s.title), ' ', h('span', { class: 'muted small' }, `Module ${s.module} · ${KIND[s.kind] || s.kind}`), ' ',
                t ? null : h('span', { class: 'chip' }, '아직 안 풂')),
              h('div', { class: 'small muted' }, `시험에서 틀린 문항 ${s.qs.filter(q => q.wrong).length}/${s.qs.length}`,
                t ? ` · 한국어 ${t.ok}/${t.n} · 영어 이해 ${dx.filter(x => x === 'eng').length} · 판단 ${dx.filter(x => x === 'judge').length}` : ''));
          }))));
      }
    }

    // ---------- text: paragraphs, [[iA]] insert positions (■A) ----------
    function passage(text, marks) {
      const box = h('div', { class: 'passage rpassage' });
      for (const para of text.split(/\n\n+/)) {
        const p = h('p');
        para.split('\n').forEach((line, li) => {
          if (li) p.append(h('br'));
          for (const part of line.split(/(\[\[[is][A-Z]\]\])/)) {
            const m = /^\[\[([is])([A-Z])\]\]$/.exec(part);
            if (m) p.append(h('b', { class: 'imark' + (marks && marks[m[1] + m[2]] ? ' ' + marks[m[1] + m[2]] : '') }, m[1] === 'i' ? '■' + m[2] : '[' + m[2] + ']'));
            else if (part) p.append(part);
          }
        });
        box.append(p);
      }
      return box;
    }
    function script(set) {
      const voices = [...new Set(set.script.map(l => l.sp).filter(sp => sp !== 'N'))];
      const label = sp => sp === 'N' || voices.length < 2 ? null : /^W/.test(sp) ? '여' : /^M/.test(sp) ? '남' : sp;
      return h('div', { class: 'passage tscript' }, set.script.map(l => h('p', { class: 'tline' + (l.sp === 'N' ? ' muted' : '') }, label(l.sp) ? h('b', { class: 'sp' }, label(l.sp) + ': ') : null, l.t)));
    }
    // 보기 순서 섞기 (문장 삽입 ■A… 은 위치라 그대로)
    const shuffled = q => {
      const idx = q.choices.map((_, i) => i);
      if (q.type === 'insert') return idx;
      for (let i = idx.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [idx[i], idx[j]] = [idx[j], idx[i]]; }
      return idx;
    };

    // ---------- one set ----------
    function viewSet(main, set) {
      if (!cur) cur = { id: set.id, phase: set.sec === 'L' ? 'read' : 'q', qi: 0, ans: [], perm: set.qs.map(shuffled) };
      const redraw = () => { main.innerHTML = ''; viewSet(main, set); window.scrollTo(0, 0); };
      main.append(h('div', { class: 'swbar' }, back('#/ko', '목록'), h('span', { class: 'small muted' }, `한국어 · ${set.testName} · Module ${set.module} · ${set.title}`)));
      const card = h('section', { class: 'card' });
      main.append(card);

      if (cur.phase === 'read') {
        card.append(h('p', { class: 'small muted' }, `${KIND[set.kind] || set.kind} · 문항 ${set.qs.length}개 (시험에서 틀린 것 ${set.qs.filter(q => q.wrong).length}개). 시험에서 한 번 듣듯이 한 번 읽으세요. 문제를 풀 때는 스크립트가 보이지 않습니다.`),
          script(set), h('button', { class: 'primary', onclick: () => { cur.phase = 'q'; redraw(); } }, '다 읽었음 → 문제 풀기'));
        return;
      }

      if (cur.phase === 'q') {
        const q = set.qs[cur.qi];
        if (set.sec === 'R') card.append(passage(set.passage));
        card.append(h('p', { class: 'small muted' }, `문항 ${cur.qi + 1} / ${set.qs.length}`),
          h('p', { class: 'stem' }, q.stem),
          q.sentence ? h('p', { class: 'insert-s' }, h('b', null, '넣을 문장: '), q.sentence) : null,
          h('div', { class: 'opts' }, cur.perm[cur.qi].map((i, pos) => h('button', { class: 'opt', onclick: () => {
            cur.ans[cur.qi] = i;
            if (cur.qi + 1 < set.qs.length) { cur.qi++; redraw(); return; }
            const ok = set.qs.filter((x, k) => cur.ans[k] === x.answer).length;
            save(d => { const r = d.sets[set.id] || { tries: [] }; r.tries.push({ at: Date.now(), ans: cur.ans.slice(), ok, n: set.qs.length }); d.sets[set.id] = r; });
            cur.phase = 'review'; redraw();
          } }, h('b', null, L[pos]), ' ', q.choices[i]))));
        return;
      }

      // review: 원래 보기 순서(A–D)로, 시험 때(영어) 답과 나란히
      const ok = set.qs.filter((x, k) => cur.ans[k] === x.answer).length;
      const dx = set.qs.map((q, k) => diagnose(q, cur.ans[k]));
      card.append(h('h2', null, `${ok} / ${set.qs.length}`, ' ',
        h('span', { class: 'small muted' }, `시험에서 틀린 문항: 영어 이해 문제 ${dx.filter(x => x === 'eng').length} · 판단 문제 ${dx.filter(x => x === 'judge').length}`)),
        h('p', { class: 'small muted' }, '보기는 원래 시험 순서(A–D)로 다시 보여 줍니다.'));
      if (set.sec === 'R') {
        const marks = {};
        set.qs.forEach(q => { if (q.type === 'insert' && q.choices[q.answer]) marks['i' + q.choices[q.answer].replace(/[■[\]]/g, '')] = 'right'; });
        card.append(passage(set.passage, marks));
      }
      set.qs.forEach((q, k) => {
        const mine = cur.ans[k], right = mine === q.answer;
        card.append(h('div', { class: 'fb ' + (right ? 'good' : 'bad') },
          h('p', null, h('b', null, `Q${k + 1}. `), q.stem, ' ', q.wrong ? (q.vocab ? h('span', { class: 'chip' }, '어휘 문제 · 진단 제외') : dxChip(dx[k])) : h('span', { class: 'chip' }, '시험 때 맞힘')),
          h('p', { class: 'small muted' }, q.stemEn),
          q.sentence ? h('p', { class: 'small' }, h('b', null, '넣을 문장: '), q.sentence) : null,
          h('ul', { class: 'lchoices' }, q.choices.map((c, i) => h('li', { class: i === q.answer ? 'right' : i === mine ? 'wrong' : '' },
            h('b', null, L[i]), ' ', c,
            i === q.answer ? h('span', { class: 'chip src-tutor' }, '정답') : null,
            i === mine && i !== q.answer ? h('span', { class: 'chip rc-repeat' }, '이번 내 답') : null,
            q.wrong && i === q.my ? h('span', { class: 'chip' }, '시험 때 내 답 (영어)') : null))),
          dx[k] === 'eng' ? h('p', { class: 'rule small' }, '한국어로는 맞혔으니 영어 지문·음성에서 이 내용을 놓친 것. 영어 원문에서 해당 문장을 다시 확인하세요.') : null,
          dx[k] === 'judge' ? h('p', { class: 'rule small' }, '한국어로도 틀렸으니 영어보다 정답을 고르는 판단이 원인. 아래 해설의 판단 기준을 익히세요.') : null,
          q.wrong && q.whyKo ? h('p', { class: 'small' }, q.whyKo) : null,
          q.wrong && q.point ? h('p', { class: 'rule small' }, '다음엔 → ', q.point) : null));
      });
      if (set.sec === 'L') card.append(h('h3', null, '스크립트 (번역)'), script(set));
      const d = load(), nxt = Z().sets.find(s => s.id !== set.id && !lastTry(d, s.id));
      card.append(h('div', { class: 'row' },
        h('a', { class: 'ghost', href: (set.sec === 'R' ? '#/read/' : '#/listen/') + set.id }, '영어 원문으로 풀기'),
        h('button', { class: 'ghost', onclick: () => { cur = null; redraw(); } }, '다시 풀기'),
        nxt ? h('button', { class: 'primary', onclick: () => { cur = null; go('#/ko/' + nxt.id); } }, '다음 세트 →') : null));
    }
    return { view };
  } };
})(typeof window !== 'undefined' ? window : globalThis);
