/* 스펠링·교정 타이핑 드릴 (#/spell): 내가 쓴 글·튜터 교정에서 반복된 오류를 매일 직접 쳐서 고친다.
 * 기록 키 'toefl-spell-v1' (Sync로 기기 동기화). 상자(0~4) 간격 반복: 틀리면 0으로, 맞히면 다음 상자.
 * 항목 종류: spell = 뜻·문장 빈칸에 단어 쓰기 / fix = 틀린 문장을 올바르게 다시 쓰기. */
(function (root) {
  const KEY = 'toefl-spell-v1';
  const DAY = 86400000;
  const GAP = [0, 1, 2, 4, 7];   // 상자별 다음 복습까지 일수

  const S = (id, w, ko, sent, src) => ({ id, type: 'spell', w, ko, sent, src: src || 'mine' });
  const F = (id, bad, good, note, src) => ({ id, type: 'fix', bad, good, note, src: src || 'mine' });
  // mine = 내가 쓴 글에서 실제로 틀린 단어/표현, tutor = 튜터 교정, common = 자주 틀리는 일반 단어(내 오류 아님)
  const ITEMS = [
    S('information', 'information', '정보', 'You can find more ___ on the website.'),
    S('language', 'language', '언어', 'Learning a foreign ___ takes time.'),
    S('perspective', 'perspective', '관점', 'I see the issue from a different ___.'),
    S('foster', 'foster', '키우다, 촉진하다', 'Group projects ___ teamwork.'),
    S('prioritize', 'prioritize', '우선순위를 두다', 'Students should ___ their assignments.'),
    S('healthy', 'healthy', '건강한', 'Eating a ___ diet is important.'),
    S('resources', 'resources', '자원, 자료', 'The library offers many learning ___.'),
    S('kindergarten', 'kindergarten', '유치원', 'My sister teaches at a ___.'),
    S('engaging', 'engaging', '흥미를 끄는', 'The professor gave an ___ lecture.'),
    S('blankets', 'blankets', '담요', 'Volunteers collected warm ___ for the shelter.'),
    S('refrigerator', 'refrigerator', '냉장고', 'Please keep the samples in the ___.'),
    S('inconvenience', 'inconvenience', '불편', 'We apologize for any ___ this may cause.'),
    F('f-motivate', 'Teachers should motivate to students.', 'Teachers should motivate students.', 'motivate는 바로 목적어: motivate 사람 (to 없음)'),
    F('f-forward', 'I look forward to meet you.', 'I look forward to meeting you.', 'look forward to + -ing'),
    F('f-guides', 'Student guide will be waiting at each entrance.', 'Student guides will be waiting near each entrance.', '복수 + near each entrance', 'tutor'),
    F('f-id', 'You need to bring valid ID.', 'You need to bring a valid ID.', '셀 수 있는 명사 ID 앞엔 a', 'tutor'),
    F('f-checkups', 'Regular check-up are important.', 'Regular check-ups are important.', '복수형 check-ups', 'tutor'),
    S('environment', 'environment', '환경', 'We should protect the ___.', 'common'),
    S('necessary', 'necessary', '필요한', 'It is ___ to submit the form today.', 'common'),
    S('definitely', 'definitely', '분명히', 'I will ___ attend the meeting.', 'common'),
    S('opportunity', 'opportunity', '기회', 'This is a great ___ to learn.', 'common'),
    S('responsibility', 'responsibility', '책임', 'Teachers have a ___ to guide students.', 'common'),
    S('especially', 'especially', '특히', 'It is ___ useful for beginners.', 'common'),
    S('recommend', 'recommend', '추천하다', 'I ___ that you visit the lab.', 'common'),
    S('convenient', 'convenient', '편리한', 'Online classes are ___ for busy students.', 'common'),
    S('communicate', 'communicate', '소통하다', 'It helps us ___ clearly.', 'common'),
    S('advantage', 'advantage', '장점', 'One ___ of this plan is lower cost.', 'common'),
    S('difficult', 'difficult', '어려운', 'The exam was ___ for everyone.', 'common'),
    S('equipment', 'equipment', '장비', 'The lab provides all the ___.', 'common'),
    S('assignment', 'assignment', '과제', 'The ___ is due on Friday.', 'common'),
    S('schedule', 'schedule', '일정', 'Please check the class ___.', 'common'),
  ];

  const norm = t => String(t || '').toLowerCase().replace(/[’‘]/g, "'").replace(/\s+/g, ' ').trim().replace(/[.!?]+$/, '');
  const answerOf = it => it.type === 'spell' ? it.w : it.good;
  const isRight = (it, typed) => norm(typed) === norm(answerOf(it));

  function pick(rec, now, limit, items) {
    const all = items || ITEMS;
    const st = id => rec.items[id] || { box: -1, due: 0 };
    const due = all.filter(it => st(it.id).box >= 0 && st(it.id).due <= now);
    const fresh = all.filter(it => st(it.id).box < 0);
    const rank = { mine: 0, tutor: 1, common: 2 };
    due.sort((a, b) => st(a.id).due - st(b.id).due || st(a.id).box - st(b.id).box);
    fresh.sort((a, b) => rank[a.src] - rank[b.src]);
    return due.concat(fresh).slice(0, limit);
  }

  function grade(rec, it, ok, now) {
    const cur = rec.items[it.id] || { box: -1, due: 0, right: 0, wrong: 0 };
    const box = ok ? Math.min(4, cur.box + 1) : 0;
    rec.items[it.id] = { box, due: now + GAP[box] * DAY, right: cur.right + (ok ? 1 : 0), wrong: cur.wrong + (ok ? 0 : 1), last: now };
    return rec;
  }

  root.SpellDrill = { ITEMS, norm, isRight, pick, grade, GAP, create(env) {
    const { h, storage, toast } = env;
    const load = () => { try { const d = JSON.parse(storage.getItem(KEY)); return d && d.items ? d : { items: {}, log: [] }; } catch (e) { return { items: {}, log: [] }; } };
    const save = d => storage.setItem(KEY, JSON.stringify(d));
    const dueCount = () => pick(load(), Date.now(), ITEMS.length).length;
    const doneToday = () => { const t = new Date().setHours(0, 0, 0, 0); return (load().log || []).filter(l => l.at >= t).length; };

    function view(main, rerender) {
      const SIZE = 10;
      let queue = pick(load(), Date.now(), SIZE), i = 0, right = 0, wrong = [];
      const box = h('div');
      main.append(
        h('p', null, h('a', { href: '#/', class: 'small' }, '← 오늘')),
        h('h1', null, '스펠링·교정 드릴'),
        h('p', { class: 'muted small' }, '내가 쓴 글에서 실제로 틀린 단어(내 오류), 튜터가 고쳐 준 문장, 자주 틀리는 단어를 직접 쳐서 외웁니다. 틀리면 정답을 한 번 더 쳐야 넘어가고, 내일 다시 나옵니다.'),
        box);

      function next() {
        if (i >= queue.length) return summary();
        const it = queue[i];
        const input = h('input', { type: 'text', autocomplete: 'off', autocapitalize: 'off', spellcheck: false, class: 'spell-in', 'aria-label': '답' });
        const msg = h('div', { class: 'small', style: 'min-height:1.6em;margin-top:8px' });
        const tag = { mine: '내 오류', tutor: '튜터 교정', common: '자주 틀림' }[it.src];
        let stage = 'ask';
        const prompt = it.type === 'spell'
          ? [h('p', { class: 'spell-q' }, it.sent), h('p', { class: 'muted' }, `뜻: ${it.ko} · 첫 글자 ${it.w[0]} · ${it.w.length}글자`)]
          : [h('p', { class: 'muted small' }, '틀린 문장을 올바르게 고쳐 쓰세요'), h('p', { class: 'spell-q' }, it.bad)];
        const submit = () => {
          const typed = input.value;
          if (stage === 'ask') {
            if (!typed.trim()) return;
            const ok = isRight(it, typed);
            const d = grade(load(), it, ok, Date.now());
            d.log = (d.log || []).concat({ id: it.id, ok, at: Date.now() }).slice(-400);
            save(d);
            if (ok) { right++; msg.textContent = '정답'; msg.style.color = 'var(--good)'; setTimeout(() => { i++; next(); }, 450); }
            else {
              wrong.push(it); stage = 'retype'; input.value = '';
              msg.replaceChildren(h('b', null, answerOf(it)), it.note ? '  — ' + it.note : '', h('br'), '정답을 그대로 한 번 더 치세요.');
              msg.style.color = 'var(--bad, #b3261e)';
            }
          } else if (isRight(it, typed)) { i++; next(); }
          else { input.value = ''; toast('정답과 똑같이 쳐 보세요'); }
        };
        input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); submit(); } });
        box.replaceChildren(
          h('div', { class: 'card' },
            h('div', { class: 'small muted' }, `${i + 1} / ${queue.length} · `, h('span', { class: 'chip' }, tag)),
            ...prompt, input, msg,
            h('div', { class: 'row' }, h('button', { class: 'primary', onclick: submit }, '확인'))));
        input.focus();
      }

      function summary() {
        const remaining = pick(load(), Date.now(), ITEMS.length).length;
        box.replaceChildren(h('div', { class: 'card' },
          h('h2', null, `${right} / ${queue.length} 정답`),
          wrong.length ? h('div', null, h('p', { class: 'small muted' }, '틀린 것 (내일 다시 나옵니다)'),
            h('ul', null, wrong.map(it => h('li', null, answerOf(it))))) : h('p', null, '전부 맞았습니다.'),
          h('div', { class: 'row wrap' },
            remaining ? h('button', { class: 'primary', onclick: () => { queue = pick(load(), Date.now(), SIZE); i = 0; right = 0; wrong = []; next(); } }, `${Math.min(SIZE, remaining)}개 더`) : null,
            h('button', { class: 'ghost', onclick: () => { location.hash = '#/'; } }, '끝'))));
      }

      if (!queue.length) box.replaceChildren(h('p', { class: 'notice' }, '오늘 복습할 항목이 없습니다. 내일 다시 오세요.'));
      else next();
    }

    return { view, dueCount, doneToday };
  } };
})(typeof window !== 'undefined' ? window : globalThis);
