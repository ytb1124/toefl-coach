/* 단어 킵: 문제를 풀다가 모르는 영어 단어를 드래그(길게 눌러) 선택하면 '단어 킵' 버튼이 뜨고, 누르면 문장과 함께 저장한다.
 * 목록은 '단어' 탭 → 킵한 단어 (#/keep). 기록 키 'toefl-keep-v1' (Sync로 기기 동기화).
 * 단어장(app/vocab.js)에 있는 단어면 뜻을 자동으로 채운다. */
(function (root) {
  const KEY = 'toefl-keep-v1';

  // 선택한 글자 → 저장할 단어 (영어 1~4단어, 앞뒤 문장부호 제거). 아니면 null.
  function cleanWord(text) {
    const t = String(text || '').replace(/[’‘]/g, "'").replace(/\s+/g, ' ').trim()
      .replace(/^[^A-Za-z]+|[^A-Za-z]+$/g, '');
    if (!t || t.length > 40 || !/^[A-Za-z][A-Za-z' -]*$/.test(t) || t.split(' ').length > 4) return null;
    return t;
  }

  // 단어가 들어 있는 문장 하나 (너무 길면 단어 주변만)
  function sentenceAround(text, word) {
    // 문장 넣기 표시(■A, [A])는 지우고 본다
    const flat = String(text || '').replace(/\s*(■\s?[A-D]|\[[A-D]\])\s*/g, ' ').replace(/\s+/g, ' ').trim();
    const parts = flat.split(/(?<=[.!?])\s+/);
    const low = word.toLowerCase();
    let s = parts.find(p => p.toLowerCase().includes(low)) || '';
    if (s.length > 240) {
      const i = s.toLowerCase().indexOf(low);
      s = (i > 100 ? '…' : '') + s.slice(Math.max(0, i - 100), i + word.length + 100) + (i + word.length + 100 < s.length ? '…' : '');
    }
    return s;
  }

  root.KeepWords = { cleanWord, sentenceAround, create(env) {
    const { h, storage, toast } = env;
    const lookup = env.lookup || (() => null);
    const load = () => { try { const d = JSON.parse(storage.getItem(KEY)); return d && Array.isArray(d.words) ? d : { words: [] }; } catch (e) { return { words: [] }; } };
    const save = d => storage.setItem(KEY, JSON.stringify(d));
    const count = () => load().words.filter(w => !w.done).length;

    function add(word, ctx) {
      const d = load();
      const old = d.words.find(x => x.w.toLowerCase() === word.toLowerCase());
      if (old) {
        if (old.done) { old.done = false; save(d); toast(`'${word}' 다시 외울 단어로 옮겼습니다`); }
        else toast(`'${word}'는 이미 킵한 단어입니다`);
        return;
      }
      const hit = lookup(word);
      d.words.unshift({ w: word, ko: hit ? hit.ko : '', ctx, from: location.hash || '#/', at: Date.now(), done: false });
      save(d);
      toast(hit ? `'${word}' 킵했습니다 · ${hit.ko}` : `'${word}' 킵했습니다 · 뜻은 '단어' 탭에서 적을 수 있습니다`);
    }

    // ---- 선택하면 뜨는 버튼 ----
    let btn = null, picked = null, timer = null;
    function hide() { if (btn) btn.hidden = true; picked = null; }
    function check() {
      const sel = document.getSelection();
      const ae = document.activeElement;
      if (!sel || sel.isCollapsed || !sel.rangeCount || (ae && /^(INPUT|TEXTAREA)$/.test(ae.tagName))) return hide();
      const word = cleanWord(sel.toString());
      const box = sel.anchorNode && (sel.anchorNode.nodeType === 1 ? sel.anchorNode : sel.anchorNode.parentElement);
      if (!word || !box || !box.closest('main') || box.closest('.keep-list')) return hide();
      const para = box.closest('p, li, td, .passage, .script, section') || box;
      picked = { word, ctx: sentenceAround(para.innerText || para.textContent, word) };
      const r = sel.getRangeAt(0).getBoundingClientRect();
      btn.textContent = `+ 단어 킵: ${word}`;
      btn.hidden = false;
      const w = btn.offsetWidth;
      btn.style.left = Math.max(8, Math.min(window.innerWidth - w - 8, r.left + r.width / 2 - w / 2)) + 'px';
      // 휴대폰은 선택 메뉴가 위에 뜨므로 버튼은 아래에
      const below = r.bottom + 10;
      btn.style.top = (below + 44 < window.innerHeight ? below : Math.max(8, r.top - 50)) + 'px';
    }
    function mount() {
      if (btn) return;
      btn = h('button', { class: 'keep-pop', hidden: true, type: 'button',
        onmousedown: e => e.preventDefault(),   // 누르는 순간 선택이 풀리지 않게
        onclick: () => { if (picked) add(picked.word, picked.ctx); const s = document.getSelection(); if (s) s.removeAllRanges(); hide(); } });
      document.body.append(btn);
      document.addEventListener('selectionchange', () => { clearTimeout(timer); timer = setTimeout(check, 250); });
      window.addEventListener('scroll', () => { if (btn && !btn.hidden) check(); }, { passive: true });
      window.addEventListener('hashchange', hide);
    }

    // ---- 목록 (#/keep) ----
    let showDone = false;
    function view(main, rerender) {
      const d = load();
      const list = d.words.filter(w => !!w.done === showDone);
      const learning = d.words.filter(w => !w.done).length, done = d.words.length - learning;
      const update = (w, patch) => { const dd = load(); const x = dd.words.find(y => y.w === w.w); if (x) { Object.assign(x, patch); save(dd); } };
      const mark = (ctx, word) => {
        const i = ctx.toLowerCase().indexOf(word.toLowerCase());
        return i < 0 ? ctx : [ctx.slice(0, i), h('b', null, ctx.slice(i, i + word.length)), ctx.slice(i + word.length)];
      };
      main.append(
        h('p', null, h('a', { href: '#/vocab', class: 'small' }, '← 단어 암기')),
        h('h1', null, '킵한 단어'),
        h('p', { class: 'muted small' }, '문제를 풀다가 모르는 영어 단어를 드래그하거나 길게 눌러 선택하면 "+ 단어 킵" 버튼이 나옵니다. 누르면 그 문장과 함께 여기에 모입니다. 단어장에 있는 단어는 뜻이 자동으로 채워집니다.'),
        h('div', { class: 'keep-tabs' },
          h('button', { class: 'chip' + (showDone ? '' : ' on'), onclick: () => { showDone = false; rerender(); } }, `외우는 중 ${learning}`),
          h('button', { class: 'chip' + (showDone ? ' on' : ''), onclick: () => { showDone = true; rerender(); } }, `외운 단어 ${done}`)),
        list.length ? h('ul', { class: 'keep-list' }, list.map(w => h('li', { class: 'card' },
          h('div', { class: 'keep-head' }, h('strong', { class: 'keep-word' }, w.w),
            h('input', { class: 'keep-ko', value: w.ko || '', placeholder: '뜻 메모', 'aria-label': `${w.w} 뜻`,
              onchange: e => update(w, { ko: e.target.value.trim() }) })),
          w.ctx ? h('p', { class: 'keep-ctx' }, mark(w.ctx, w.w)) : null,
          h('div', { class: 'keep-foot small muted' },
            h('span', null, new Date(w.at).toLocaleDateString('ko-KR', { month: 'numeric', day: 'numeric' }), ' · ', h('a', { href: w.from }, '찾은 곳')),
            h('span', null,
              h('button', { class: 'link small', onclick: () => { update(w, { done: !w.done }); rerender(); } }, w.done ? '다시 외우기' : '외웠어요'),
              ' · ',
              h('button', { class: 'link small', onclick: () => { const dd = load(); dd.words = dd.words.filter(y => y.w !== w.w); save(dd); toast(`'${w.w}' 삭제했습니다`); rerender(); } }, '삭제'))))))
          : h('p', { class: 'notice' }, showDone ? '외운 단어가 아직 없습니다.' : '킵한 단어가 없습니다. 지문이나 스크립트에서 모르는 단어를 선택해 보세요.'));
    }

    return { mount, view, count, add };
  } };
})(typeof window !== 'undefined' ? window : globalThis);
