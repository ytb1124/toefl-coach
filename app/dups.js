/* FM-TOEFL 중복 문제 풀기 — 2026 真题 54회 전사본에서 2회 이상 반복 출제된 문제(리스닝·리딩·쓰기 BS·말하기)만 모아 푼다.
 * 자료(원본 저작물)는 비공개: private/zhan/dups.js 또는 비공개 저장소의 dups.json (ZhanData 'dups'). 음성은 전사 스크립트를 Kokoro로 만든 것 (원본 음원 아님).
 * 기록 키 'toefl-dups-v1' (Sync로 기기 동기화). Routes: #/dups · #/dups/<groupId>
 * 순수 로직(DupCore)은 node 테스트에서도 쓴다 (tests/dups.test.js). */
(function (root) {
  'use strict';

  // ---------- pure logic ----------
  const CATS = [
    ['L1', '리스닝 Task 1', 'L'], ['L2', '리스닝 대화', 'L'], ['L3', '리스닝 안내·강의', 'L'],
    ['R2', '리딩 일상', 'R'], ['R3', '리딩 학술', 'R'], ['R1', 'C-Test (보기만)', 'R'],
    ['W1', '쓰기 BS', 'W'], ['S2', '말하기 질문', 'S'], ['S3', '말하기 세트', 'S'],
  ];
  const norm = s => String(s || '').toLowerCase().replace(/[’‘]/g, "'").replace(/[^a-z0-9' ]+/g, ' ').replace(/\s+/g, ' ').trim();
  // 풀 수 있는 종류: 객관식(MC) / 문장 쓰기(build) / 말하기(speak, 자가 체크) / 보기만(view)
  const modeOf = g => g.qs ? 'mc' : g.cat === 'W1' ? 'build' : g.cat === 'S2' || g.cat === 'S3' ? 'speak' : 'view';
  const tries = rec => (rec && rec.tries) || [];
  // 객관식·쓰기: 마지막 시도에서 전부 맞으면 fixed, 하나라도 틀리면 again, 안 풀었으면 new. 말하기·보기만: 한 번이라도 했으면 fixed.
  function status(g, rec) {
    const t = tries(rec), last = t[t.length - 1];
    if (!last) return 'new';
    const m = modeOf(g);
    if (m === 'speak' || m === 'view') return 'fixed';
    return last.ok === last.n ? 'fixed' : 'again';
  }
  // 자동으로 나오는 순서: 아직 안 푼 문제만, 많이 반복된 것부터. 한 번 푼 문제는 (틀렸어도) 다시 나오지 않는다.
  // 틀린 문제는 목록의 '틀린 것'에서 사용자가 골라 다시 푼다.
  function queue(groups, recs, filter) {
    return groups.filter(g => (!filter || !filter.cat || filter.cat === 'all' || g.cat === filter.cat) && status(g, recs[g.id]) === 'new')
      .sort((a, b) => b.nt - a.nt || b.n - a.n || (a.id < b.id ? -1 : 1));
  }
  const checkBuild = (typed, answer) => norm(typed) === norm(answer);
  const counts = (groups, recs) => {
    const c = { new: 0, again: 0, fixed: 0 };
    groups.forEach(g => { c[status(g, recs[g.id])]++; });
    return c;
  };
  const Core = { CATS, norm, modeOf, status, queue, checkBuild, counts };
  if (typeof module !== 'undefined' && module.exports) { module.exports = Core; return; }
  root.DupCore = Core;

  // ---------- UI ----------
  const KEY = 'toefl-dups-v1';
  const L = 'ABCD';
  const AUDIO_DIR = 'private/zhan/dups_audio/';
  const catName = id => (CATS.find(c => c[0] === id) || [])[1] || id;
  const place = w => w.replace(/^T0?(\d+) ([LRWS]) /, 'T$1 ').replace(/ \[Interview$/, '');

  root.DupApp = { create(env) {
    const { h, go, storage, toast } = env;
    const Z = () => root.ZHAN_DUPS;
    const ensureData = then => root.ZhanData.load('dups', 'ZHAN_DUPS', then);
    let cur = null;           // 풀이 중인 그룹의 진행 상태
    let filterCat = 'all';
    let filterSt = 'new';   // 목록: new 안 푼 것 · again 틀린 것 · fixed 맞힌 것

    function load() { try { const d = JSON.parse(storage.getItem(KEY) || 'null'); if (d && d.v) return Object.assign({ v: 1, g: {} }, d); } catch (e) { /* fresh */ } return { v: 1, g: {} }; }
    function save(mut) { const d = load(); mut(d); try { storage.setItem(KEY, JSON.stringify(d)); } catch (e) { toast('저장 실패: ' + e.message); } return d; }
    const record = (g, extra) => save(d => { const r = d.g[g.id] || { tries: [] }; r.tries.push(Object.assign({ at: Date.now() }, extra)); d.g[g.id] = r; });
    const chipFor = st => h('span', { class: 'chip ' + ({ new: '', fixed: 'src-tutor', again: 'rc-repeat' })[st] }, ({ new: '아직 안 풂', fixed: '다시 풀어 맞힘', again: '또 틀림' })[st]);
    const back = (hash, label) => h('a', { class: 'small', href: hash }, '← ' + label);
    const wheres = g => g.where.map(place).join(' · ');

    // 음성: 전사 스크립트를 Kokoro로 만든 재구성 (원본 음원 아님)
    function audioBox(file) {
      const a = h('audio', { controls: true, preload: 'auto', class: 'orig-audio' });
      const note = h('p', { class: 'small muted' }, '음성은 전사 스크립트를 Kokoro로 만든 재구성입니다 (원본 음원 아님).');
      root.ZhanData.audioUrl(AUDIO_DIR + file + '.mp3').then(u => { a.src = u; }).catch(() => { note.textContent = '음성 파일을 이 기기에서 불러오지 못했습니다. 아래 스크립트를 읽어 주세요.'; });
      return h('div', null, a, note);
    }

    function view(main, parts) {
      main.classList.add('listen', 'read');
      ensureData(() => {
        if (!Z()) return main.append(...root.ZhanData.tokenCard(h, { title: 'FM-TOEFL 중복 문제', lead: '이 기기에 GitHub 토큰을 한 번 넣으면 중복 문제를 풀 수 있습니다 (리스닝·리딩 탭에 넣은 토큰과 같음).',
          retry: done => ensureData(() => { done(!!Z()); if (Z()) { toast('연결했습니다'); main.innerHTML = ''; view(main, []); } }) }));
        const [id] = parts;
        const g = id && Z().groups.find(x => x.id === decodeURIComponent(id));
        if (g) { if (!cur || cur.id !== g.id) cur = { id: g.id, phase: 'q', qi: 0, ans: [], typed: '' }; return viewGroup(main, g); }
        cur = null;
        viewList(main);
      });
    }

    // ---------- list ----------
    function viewList(main) {
      const d = load(), all = Z().groups;
      const groups = filterCat === 'all' ? all : all.filter(g => g.cat === filterCat);
      const c = counts(groups, d.g);
      const first = queue(all, d.g, { cat: filterCat })[0];
      main.append(root.ZhanData.sourceLine(h, 'dups'), h('section', { class: 'card hero' },
        h('h1', null, 'FM-TOEFL 중복 문제'),
        h('p', { class: 'muted' }, `2026 真题 54회 전사본에서 2회 이상 나온 문제 ${all.length}개 (많이 반복된 것부터). 한 번 푼 문제는 자동으로 다시 나오지 않고, 틀린 문제는 '틀린 것'에서 골라 다시 풉니다.`),
        h('p', { class: 'small' }, `아직 안 풂 ${c.new} · 틀림 ${c.again} · 맞힘 ${c.fixed}`),
        first ? h('button', { class: 'primary', onclick: () => go('#/dups/' + first.id) }, `다음 문제: ${catName(first.cat)} · ${first.nt}회차에 출제`) : h('p', { class: 'small good-text' }, '안 푼 문제를 모두 풀었습니다.')));
      main.append(h('section', { class: 'card' },
        h('div', { class: 'row wrap' }, [['all', '전체']].concat(CATS.map(x => [x[0], x[1]])).map(([id, name]) => {
          const n = id === 'all' ? all.length : all.filter(g => g.cat === id).length;
          return h('button', { class: id === filterCat ? 'primary' : 'ghost', onclick: () => { filterCat = id; main.innerHTML = ''; viewList(main); } }, `${name} ${n}`);
        }))));
      const stTabs = [['new', '안 푼 것', c.new], ['again', '틀린 것', c.again], ['fixed', '맞힌 것', c.fixed]];
      main.append(h('section', { class: 'card' }, h('div', { class: 'row wrap' }, stTabs.map(([id, name, n]) =>
        h('button', { class: id === filterSt ? 'primary' : 'ghost', onclick: () => { filterSt = id; main.innerHTML = ''; viewList(main); } }, `${name} ${n}`)))));
      const sorted = groups.filter(g => status(g, d.g[g.id]) === filterSt).sort((a, b) => b.nt - a.nt || b.n - a.n || (a.id < b.id ? -1 : 1));
      main.append(h('section', { class: 'card' }, sorted.length ? '' : h('p', { class: 'small muted' }, '해당하는 문제가 없습니다.'), h('ul', { class: 'olist' }, sorted.map(g => h('li', { onclick: () => go('#/dups/' + g.id) },
        h('div', null, h('b', null, `${g.nt}회차`), ' ', h('span', { class: 'muted small' }, catName(g.cat)), ' ', chipFor(status(g, d.g[g.id]))),
        h('div', { class: 'small muted' }, preview(g)))))));
    }
    function preview(g) {
      const t = g.script || g.passage || g.question || g.prompt || g.answer || '';
      const hidden = g.cat === 'W1' ? (g.speaker || g.chips) : (g.cat.startsWith('L') ? '(듣고 푸는 문제)' : t);
      return (hidden.length > 90 ? hidden.slice(0, 89) + '…' : hidden);
    }

    // ---------- one group ----------
    function viewGroup(main, g) {
      if (!cur || cur.id !== g.id) cur = { id: g.id, phase: 'q', qi: 0, ans: [], typed: '' };   // 다시 풀기는 cur를 비우고 다시 그린다
      const redraw = () => { main.innerHTML = ''; viewGroup(main, g); window.scrollTo(0, 0); };
      const nextGroup = () => { const d = load(); return queue(Z().groups, d.g, { cat: filterCat }).find(x => x.id !== g.id); };
      main.append(h('div', { class: 'swbar' }, back('#/dups', '목록'), h('span', { class: 'small muted' }, `${catName(g.cat)} · ${g.nt}회차 출제`)));
      const card = h('section', { class: 'card' });
      main.append(card);
      const m = modeOf(g);
      const footer = () => {
        const nx = nextGroup();
        const wrong = status(g, load().g[g.id]) === 'again';
        return h('div', { class: 'row' },
          wrong ? h('button', { class: 'primary', onclick: () => { cur = null; redraw(); } }, '바로 다시 풀기') : '',
          h('button', { class: 'ghost', onclick: () => { cur = null; go('#/dups'); } }, '목록으로'),
          nx ? h('button', { class: wrong ? 'ghost' : 'primary', onclick: () => { cur = null; go('#/dups/' + nx.id); } }, '다음 안 푼 문제 →') : '');
      };
      const appears = () => h('p', { class: 'small muted' }, `나온 곳: ${wheres(g)}${g.partial ? ' (일부 출현은 전사가 잘려 있음)' : ''}`);

      if (m === 'mc') return viewMc(card, g, cur, redraw, footer, appears);
      if (m === 'build') return viewBuild(card, g, cur, redraw, footer, appears);
      if (m === 'speak') return viewSpeak(card, g, cur, redraw, footer, appears);
      // view only (C-Test)
      card.append(h('p', { class: 'small muted' }, 'C-Test는 빈칸 위치가 전사에 없어 풀이 대신 지문과 빠진 글자만 보여 줍니다.'),
        h('div', { class: 'passage rpassage' }, h('p', null, g.passage)),
        h('p', null, h('b', null, '빠진 글자: '), g.answer || '(기록 없음)'), appears(),
        h('button', { class: 'primary', onclick: () => { record(g, { seen: true }); toast('기록했습니다'); } }, '봤어요'));
    }

    function passageBox(g) {
      return h('div', { class: 'passage rpassage' }, g.passage.split(/\n+/).filter(Boolean).map(p => h('p', null, p)));
    }

    function viewMc(card, g, st, redraw, footer, appears) {
      const listening = !!g.script;
      const qs = g.qs;
      if (st.phase === 'q') {
        const q = qs[st.qi];
        if (listening) card.append(audioBox(g.id));
        else card.append(passageBox(g));
        card.append(h('p', { class: 'small muted' }, `문항 ${st.qi + 1} / ${qs.length}`),
          q.q ? h('p', { class: 'stem' }, q.q) : h('p', { class: 'small muted' }, '들려 주는 문장에 가장 알맞은 응답을 고르세요.'),
          h('div', { class: 'opts' }, q.opts.map((c, i) => h('button', { class: 'opt', onclick: () => {
            st.ans[st.qi] = i;
            if (st.qi + 1 < qs.length) { st.qi++; redraw(); return; }
            const ok = qs.filter((x, k) => st.ans[k] === L.indexOf(x.ans)).length;
            record(g, { ans: st.ans.slice(), ok, n: qs.length });
            st.phase = 'review'; redraw();
          } }, h('b', null, L[i]), ' ', c))));
        return;
      }
      const ok = qs.filter((x, k) => st.ans[k] === L.indexOf(x.ans)).length;
      card.append(h('h2', null, `${ok} / ${qs.length}`, ' ', h('span', { class: 'small ' + (ok === qs.length ? 'good-text' : 'warn') }, ok === qs.length ? '모두 맞힘' : '틀린 문항이 있음')));
      if (listening) {
        card.append(audioBox(g.id), h('p', { class: 'small muted' }, '전사된 스크립트 (화자 구분 없음)'), h('div', { class: 'passage' }, h('p', null, g.script)));
      } else card.append(passageBox(g));
      qs.forEach((q, k) => {
        const mine = st.ans[k], right = mine === L.indexOf(q.ans);
        card.append(h('div', { class: 'fb ' + (right ? 'good' : 'bad') },
          q.q ? h('p', null, h('b', null, `Q${k + 1}. `), q.q) : '',
          h('ul', { class: 'lchoices' }, q.opts.map((c, i) => h('li', { class: i === L.indexOf(q.ans) ? 'right' : i === mine ? 'wrong' : '' },
            h('b', null, L[i]), ' ', c,
            i === L.indexOf(q.ans) ? h('span', { class: 'chip src-tutor' }, '정답') : '',
            i === mine && i !== L.indexOf(q.ans) ? h('span', { class: 'chip rc-repeat' }, '내 답') : '')))));
      });
      card.append(appears(), footer());
    }

    function viewBuild(card, g, st, redraw, footer, appears) {
      if (st.phase === 'q') {
        const input = h('input', { type: 'text', class: 'idea-ex', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', placeholder: '완성한 문장을 쓰세요' });
        const go2 = () => { st.typed = input.value; const ok = checkBuild(st.typed, g.answer); record(g, { typed: st.typed, ok: ok ? 1 : 0, n: 1 }); st.phase = 'review'; redraw(); };
        input.addEventListener('keydown', e => { if (e.key === 'Enter') go2(); });
        card.append(h('p', { class: 'small muted' }, 'Build a Sentence — 조각을 모두 써서 하나의 문장을 만드세요.'),
          g.speaker ? h('p', { class: 'stem' }, g.speaker) : '',
          h('p', null, h('b', null, '조각: '), g.chips), input,
          h('button', { class: 'primary', onclick: go2 }, '확인'));
        setTimeout(() => input.focus(), 50);
        return;
      }
      const ok = checkBuild(st.typed, g.answer);
      card.append(h('h2', null, ok ? '맞음' : '다름', ' ', h('span', { class: 'small muted' }, '(대소문자·문장부호는 무시하고 비교)')),
        h('div', { class: 'fb ' + (ok ? 'good' : 'bad') }, h('p', null, h('b', null, '정답: '), g.answer), h('p', { class: 'small' }, h('b', null, '내 답: '), st.typed || '(비어 있음)')),
        appears(), footer());
    }

    // 말하기: 질문을 듣고 45초 안에 소리 내어 답한 뒤 '했어요'로 기록 (녹음·채점 없음 — 연습실 말하기 방의 Interview에서 녹음 분석)
    function viewSpeak(card, g, st, redraw, footer, appears) {
      const qs = g.cat === 'S3' ? g.questions : [g.question];
      const text = qs[st.qi];
      const file = g.cat === 'S3' ? g.id + '_q' + st.qi : g.id;
      let left = 45, timer = null;
      const clock = h('span', { class: 'small muted' }, '45초');
      const stop = () => { if (timer) clearInterval(timer); timer = null; };
      if (st.phase === 'q') {
        if (g.cat === 'S3' && st.qi === 0) card.append(h('p', { class: 'small' }, g.prompt));
        card.append(h('p', { class: 'small muted' }, `질문 ${st.qi + 1} / ${qs.length}`), audioBox(file), h('p', { class: 'stem' }, text), clock,
          h('div', { class: 'row' },
            h('button', { class: 'ghost', onclick: () => { stop(); left = 45; clock.textContent = '45초'; timer = setInterval(() => { left--; clock.textContent = left + '초'; if (left <= 0) { stop(); clock.textContent = '끝'; } }, 1000); } }, '45초 타이머 시작'),
            h('button', { class: 'primary', onclick: () => {
              stop();
              if (st.qi + 1 < qs.length) { st.qi++; redraw(); return; }
              record(g, { done: true }); st.phase = 'review'; redraw();
            } }, st.qi + 1 < qs.length ? '답했어요 → 다음 질문' : '답했어요')));
        return;
      }
      card.append(h('h2', null, '끝냄'), h('p', { class: 'small muted' }, '이 질문은 여러 회차에서 반복됩니다. 같은 답의 뼈대(이유 → 예시 → 결과)로 다시 말해 보세요.'),
        appears(), footer());
    }

    return { view };
  } };
})(typeof window !== 'undefined' ? window : globalThis);
