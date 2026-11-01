/* 해커스 모범답안 라벨 재구성 (쓰기 Task 2 Email · Task 3 Academic Discussion, 2026-11-02 사용자 결정).
 * 자료: 해커스 Updated TOEFL Writing '20일 완성 모범 답안' (p.322–341 Email, p.344–383 Discussion) 전사본 —
 *   저작물이라 비공개 저장소에만 (private/zhan/hackers.js · hackers.json, tools/hackers.py가 만든다).
 * 한 문제 = ① 읽기 (라벨·굵은 표현 표시) → ② 가리고 쓰기 (라벨+아웃라인만 보고, 굵은 표현은 그대로, 나머지는 짧은 문장) → ③ 비교
 *   → ④ 실전 다시 쓰기 (문제만 보고 실전 시간 Email 7분 · Discussion 10분, 처음부터 다시) → 비교.
 * Day가 3의 배수인 문제는 '처음 보는 문제' (모범답안을 읽지 않고 문제만 보고 실전 시간에 쓴 뒤 비교).
 * 기준: 라벨 다 채움 · 110단어(Email 100) 이상 · 문법 오류 2개 이하. 기록은 주 기록 writing[]에 kind 'hk' (mode recon·cold·final).
 * 순수 로직(HackersCore)은 node 테스트에서도 쓴다 (tests/hackers.test.js). */
(function (root) {
  'use strict';

  // ---------- pure ----------
  const pad = n => String(n).padStart(2, '0');
  const IDS = { E: Array.from({ length: 20 }, (_, i) => 'HE' + pad(i + 1)), D: Array.from({ length: 20 }, (_, i) => 'HD' + pad(i + 1)) };
  const typeOf = id => (/^HE/.test(id) ? 'E' : 'D');
  const dayOf = id => Number(String(id).slice(2));
  const isCold = id => dayOf(id) % 3 === 0;
  // 시간(초): 재구성은 읽기 목표 + 쓰기, 처음 보는 문제는 실전 시간 (Email 7분 · Discussion 10분).
  const TIME = { E: { read: 60, write: 300, cold: 420, words: 100 }, D: { read: 120, write: 480, cold: 600, words: 110 } };
  const MAX_ERRORS = 2;
  const norm = s => String(s || '').toLowerCase().replace(/[’‘]/g, "'").replace(/[“”]/g, '"').replace(/[^a-z0-9' ]+/g, ' ').replace(/\s+/g, ' ').trim();
  const wordCount = t => (String(t || '').match(/[A-Za-z0-9][A-Za-z0-9'’-]*/g) || []).length;
  // 굵은 표현이 내 글에 그대로 있나 (대소문자·문장부호 무시). 굵은 덩어리가 여러 문장이면 문장마다 따로 본다.
  // 문장 첫 단어가 아닌 대문자 단어(이름·학교 등, 'I' 제외)는 내 글에서 아무 단어나 와도 된다.
  const chunks = b => String(b || '').split(/(?<=[.!?])\s+/).map(x => x.trim()).filter(x => norm(x));
  function chunkRe(c) {
    const words = c.split(/\s+/).filter(w => norm(w));
    const parts = words.map((w, i) => i > 0 && /^[A-Z]/.test(w) && w !== 'I' && !/^I'/.test(w) ? "[a-z0-9']+" : norm(w).replace(/ /g, ' ').replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    return new RegExp('(^| )' + parts.join(' ') + '( |$)');
  }
  function boldHits(text, bold) {
    const t = norm(text);
    // 한 단어짜리 굵은 표현(because, would…)은 화면에만 표시하고 적중률에는 넣지 않는다.
    return (bold || []).flatMap(chunks).filter(b => norm(b).split(' ').length >= 2).map(b => ({ b, ok: chunkRe(b).test(t) }));
  }
  // 텍스트에서 굵은/밑줄 구간 찾기 → [{t, b?, u?}] (차례대로, 겹치면 굵은 쪽).
  function spans(text, bold, underline) {
    const marks = [];
    const find = (list, kind) => { let from = 0; for (const s of list || []) { const i = text.indexOf(s, from); if (i < 0) continue; marks.push({ a: i, z: i + s.length, kind }); from = i + s.length; } };
    find(bold, 'b'); find(underline, 'u');
    marks.sort((x, y) => x.a - y.a || (x.kind === 'b' ? -1 : 1));
    const out = []; let at = 0;
    for (const m of marks) {
      if (m.a < at) continue;
      if (m.a > at) out.push({ t: text.slice(at, m.a) });
      out.push({ t: text.slice(m.a, m.z), [m.kind]: true }); at = m.z;
    }
    if (at < text.length) out.push({ t: text.slice(at) });
    return out;
  }
  function verdict(type, r) {
    const checks = [['라벨 다 채움', r.labelsOk === r.labelsTotal], [`${TIME[type].words}단어 이상`, r.words >= TIME[type].words], [`문법 오류 ${MAX_ERRORS}개 이하`, r.errors != null && r.errors <= MAX_ERRORS]];
    return { checks, pass: checks.every(c => c[1]) };
  }
  // 다음에 할 문제: 아직 기록 없는 것, Day 순서.
  function left(log, type) {
    const done = new Set((log || []).filter(w => w.kind === 'hk').map(w => w.task));
    return IDS[type].filter(id => !done.has(id));
  }
  const Core = { IDS, typeOf, dayOf, isCold, TIME, MAX_ERRORS, norm, wordCount, boldHits, spans, verdict, left };
  if (typeof module !== 'undefined' && module.exports) { module.exports = Core; return; }
  root.HackersCore = Core;

  // ---------- UI ----------
  root.HackersApp = { create(env) {
    const { h, toast } = env;
    const ap = (el, ...kids) => el.append(...kids.flat(Infinity).filter(x => x != null && x !== false));
    const rc = (el, ...kids) => el.replaceChildren(...kids.flat(Infinity).filter(x => x != null && x !== false));
    const ensure = then => root.ZhanData.loadAll([['hackers', 'HACKERS']], then);
    const item = id => ((root.HACKERS && root.HACKERS.items) || []).find(x => x.id === id);
    const scan = (t, type) => root.SWCore ? root.SWCore.scan(t, env.scanRules(), type === 'E' ? 'em' : 'ad').filter(f => f.level !== 'info' && f.level !== 'tip') : [];
    let timers = [];
    const stopAll = () => { timers.forEach(clearInterval); timers = []; };
    window.addEventListener('hashchange', stopAll);
    const mmss = s => (s < 0 ? '+' : '') + Math.floor(Math.abs(s) / 60) + ':' + String(Math.abs(s) % 60).padStart(2, '0');
    // up=true: 0부터 올라감 (읽기). 아니면 sec부터 내려가고 0을 넘으면 +로 계속 (멈추지 않음).
    function clock(sec, up) {
      let n = up ? 0 : sec, hidden = false;
      const t = h('span', { class: 'cd-time' });
      const draw = () => { t.textContent = hidden ? '' : up ? `${mmss(n)} / 목표 ${mmss(sec)}` : mmss(n); t.classList.toggle('warn', up ? n > sec : n < 30); };
      const b = h('button', { class: 'link small', onclick: () => { hidden = !hidden; b.textContent = hidden ? 'Show Time' : 'Hide Time'; draw(); } }, 'Hide Time');
      const el = h('div', { class: 'cdown' }, t, ' ', b); draw();
      const id = setInterval(() => { n += up ? 1 : -1; draw(); }, 1000); timers.push(id);
      el.stop = () => clearInterval(id);
      return el;
    }
    const marked = (text, it) => spans(text, it.bold, it.underline).map(s => s.b ? h('b', { class: 'hk-b' }, s.t) : s.u ? h('u', null, s.t) : s.t);
    const modelBox = (it, plain) => h('div', { class: 'passage hk-model' },
      it.greeting ? h('p', null, it.greeting) : null,
      h('p', null, it.parts.map(p => [h('span', { class: 'chip hk-label' }, p.label), ' ', plain ? p.text : marked(p.text, it), ' '])),
      it.signoff ? h('p', null, it.signoff, h('br'), it.name) : null);
    function promptBox(it) {
      if (typeOf(it.id) === 'E') return h('div', { class: 'passage' }, h('p', null, it.situation), h('p', null, h('b', null, it.instruction)), h('ul', null, it.tasks.map(t => h('li', null, t))));
      return h('div', { class: 'passage' }, h('p', null, h('b', null, it.prof.name + ': '), it.prof.text),
        it.students.map(s => h('p', { class: 'student' }, h('b', null, s.name + ': '), s.text)));
    }
    function outlineBox(it) {
      if (typeOf(it.id) === 'E') return h('ul', { class: 'hk-outline' }, it.outline.map(o => h('li', null, o.en)));
      const side = it.outline.find(o => o.chosen) || it.outline[0];
      return h('div', null, h('p', { class: 'small' }, h('b', null, side.side)), h('ul', { class: 'hk-outline' }, side.lines.map(o => h('li', null, o.en))));
    }
    const labelRow = it => h('p', { class: 'small' }, '라벨 순서: ', it.parts.map((p, i) => [i ? ' → ' : '', h('span', { class: 'chip hk-label' }, p.label)]));
    function noData(main, done) {
      ap(main, h('section', { class: 'card' }, h('p', { class: 'notice' }, '해커스 자료를 불러오지 못했습니다 (비공개 자료). Mac에서 start.command로 열거나 토큰을 넣으세요.'),
        h('button', { class: 'primary', onclick: () => done({ skipped: true }) }, '넘어가기')));
    }

    // ---- 한 문제 ----
    function run(main, task, done) {
      ensure(() => {
        const it = item(task.task || task.id);
        if (!it) return noData(main, done);
        const type = typeOf(it.id), T = TIME[type], cold = isCold(it.id);
        const name = type === 'E' ? 'Write an Email' : 'Academic Discussion';
        ap(main, h('p', { class: 'kicker' }, `⑤ 쓰기 · 해커스 ${name} Day ${dayOf(it.id)} · ${it.title} · `, h('span', { class: 'muted' }, cold ? '처음 보는 문제 (실전)' : '라벨 재구성')));
        const card = h('section', { class: 'card' }); ap(main, card);
        const t0 = Date.now();
        if (cold) return write(null, 'cold');
        // ① 읽기
        const ck = clock(T.read, true);
        rc(card, h('div', { class: 'qhead' }, h('h3', null, '① 읽기'), ck),
          h('p', { class: 'small muted' }, '라벨 순서와 굵은 표현을 눈에 넣으세요. 굵은 표현은 쓸 때 그대로 씁니다.'),
          promptBox(it), h('h4', null, '모범 답안'), modelBox(it),
          h('button', { class: 'primary', onclick: () => { ck.stop(); write(Date.now() - t0, 'recon'); } }, '가리고 쓰기'));

        // ② 쓰기 (recon) · 처음 보는 문제 (cold) · ④ 실전 다시 쓰기 (final): cold·final은 문제만, 실전 시간.
        function write(readMs, stage) {
          const exam = stage !== 'recon';
          const sec = exam ? T.cold : T.write;
          const title = stage === 'final' ? '④ 실전 다시 쓰기' : stage === 'cold' ? '실전 쓰기' : '② 가리고 쓰기';
          const ck2 = clock(sec);
          const ta = h('textarea', { class: 'essay', rows: 12, spellcheck: 'false', autocorrect: 'off', placeholder: type === 'E' ? (it.greeting || 'Dear …,') : '' });
          const wc = h('span', { class: 'small muted' }, `0 / ${T.words}단어`);
          ta.oninput = () => { const n = wordCount(ta.value); wc.textContent = `${n} / ${T.words}단어`; wc.classList.toggle('good-text', n >= T.words); };
          const t1 = Date.now();
          rc(card, h('div', { class: 'qhead' }, h('h3', null, title), ck2),
            h('p', { class: 'small muted' }, stage === 'final' ? `이제 문제만 보고 처음부터 다시 씁니다. 실전처럼 ${sec / 60}분. 마지막 1분은 전치사·관사·수일치·철자만 보세요.`
              : exam ? `문제만 보고 ${sec / 60}분 안에 쓰세요. 마지막 1분은 전치사·관사·수일치·철자만 보세요.`
              : '굵은 표현은 그대로, 나머지는 짧은 문장으로. 라벨 하나에 1–2문장.'),
            promptBox(it), exam ? null : [labelRow(it), outlineBox(it)],
            ta, h('div', { class: 'row' }, wc),
            h('button', { class: 'primary', onclick: () => {
              if (!ta.value.trim()) { toast('답을 써야 비교할 수 있습니다'); return; }
              ck2.stop(); compare(ta.value, readMs, Date.now() - t1, stage);
            } }, '제출하고 비교'));
          setTimeout(() => ta.focus(), 30);
        }

        // ③ 비교 (④ 다음에도 같은 화면)
        function compare(text, readMs, writeMs, stage) {
          const hits = boldHits(text, it.bold), flags = scan(text, type), words = wordCount(text);
          const labelBoxes = it.parts.map(p => h('input', { type: 'checkbox' }));
          const err = h('input', { type: 'number', min: 0, max: 20, class: 'hk-num', value: '' });
          const fix = h('textarea', { rows: 2, placeholder: '틀린 문장 하나를 고쳐 쓰기 (선택)' });
          const out = h('div');
          const saveBtn = h('button', { class: 'primary', onclick: () => save() }, '저장');
          rc(card, h('h3', null, stage === 'final' ? '④ 실전 다시 쓰기 · 비교' : '③ 비교'),
            h('p', null, `${words}단어 (목표 ${T.words}) · 굵은 표현 ${hits.filter(x => x.ok).length}/${hits.length} · 쓰기 ${mmss(Math.round(writeMs / 1000))}`),
            h('div', { class: 'compare' },
              h('div', null, h('p', { class: 'small muted' }, '내 글'), h('pre', { class: 'essaytext' }, text)),
              h('div', null, h('p', { class: 'small muted' }, '해커스 모범 답안'), modelBox(it))),
            h('h4', null, '굵은 표현 (그대로 썼나)'),
            h('ul', { class: 'small hk-hits' }, hits.map(x => h('li', { class: x.ok ? 'ok' : 'miss' }, (x.ok ? '✓ ' : '✗ ') + x.b))),
            h('h4', null, '라벨 (내 글에 그 역할의 문장이 있으면 체크)'),
            h('div', { class: 'checks' }, it.parts.map((p, i) => h('label', { class: 'check' }, labelBoxes[i], ' ', h('span', { class: 'chip hk-label' }, p.label)))),
            h('h4', null, '문법 오류'),
            flags.length ? [h('p', { class: 'small muted' }, '자동 검사 (규칙 기반, 틀릴 수 있음):'), h('ul', { class: 'small' }, flags.slice(0, 8).map(f => h('li', null, h('b', null, f.match), ' — ', f.msg, f.fix ? ` → ${f.fix}` : '')))]
              : h('p', { class: 'small muted' }, '자동 검사에 걸린 곳은 없습니다.'),
            h('label', { class: 'field' }, '모범답안과 비교해서 찾은 내 문법 오류 수', err),
            fix, out, saveBtn);
          function save() {
              if (err.value === '') { toast('문법 오류 수를 적어 주세요 (없으면 0)'); return; }
              const r = { words, errors: Number(err.value), labelsOk: labelBoxes.filter(b => b.checked).length, labelsTotal: labelBoxes.length };
              const v = verdict(type, r);
              env.logWriting({ kind: 'hk', task: it.id, type, mode: stage, text, fix: fix.value.trim() || undefined, words,
                bold: [hits.filter(x => x.ok).length, hits.length], labels: [r.labelsOk, r.labelsTotal], errors: r.errors, flags: flags.length, readMs, ms: writeMs, pass: v.pass });
              rc(out, h('ul', null, v.checks.map(([k, ok]) => h('li', { class: ok ? 'ok' : 'miss' }, (ok ? '✓ ' : '✗ ') + k))));
              saveBtn.remove();
              if (stage === 'final') ap(card, h('button', { class: 'primary', onclick: () => done({}) }, '다음'));
              else ap(card, h('button', { class: 'primary', onclick: () => { window.scrollTo(0, 0); write(null, 'final'); } }, `④ 실전 다시 쓰기 (${T.cold / 60}분)`),
                h('button', { class: 'link small', onclick: () => done({}) }, '이번엔 건너뛰고 다음'));
          }
        }
      });
    }

    // ---- 목록 (#/hk) ----
    function room(main, go) {
      const log = env.writingLog().filter(w => w.kind === 'hk');
      const last = id => log.filter(w => w.task === id).slice(-1)[0];
      const grid = type => h('div', { class: 'row wrap' }, IDS[type].map(id => {
        const r = last(id);
        return h('button', { class: 'ghost' + (r ? ' sel' : ''), title: isCold(id) ? '처음 보는 문제 (실전)' : '라벨 재구성', onclick: () => go('#/hk/' + id) },
          `Day ${dayOf(id)}${isCold(id) ? ' ★' : ''}${r ? (r.pass ? ' ✓' : ' △') : ''}`);
      }));
      const recent = log.slice(-10);
      const avg = f => recent.length ? Math.round(recent.reduce((s, w) => s + f(w), 0) / recent.length * 10) / 10 : '—';
      ap(main, h('h1', null, '해커스 모범답안 재구성'),
        h('section', { class: 'card' },
          h('p', { class: 'small' }, '① 읽기 → ② 가리고 쓰기 (라벨·아웃라인만 보고, 굵은 표현은 그대로, 나머지는 짧은 문장) → ③ 비교 → ④ 실전 다시 쓰기 (문제만, 실전 시간) → 비교. ★ = 처음 보는 문제 (모범답안 없이 실전 시간에 쓰고 비교, 그다음 ④).'),
          h('p', { class: 'small muted' }, `기준: 라벨 다 채움 · Discussion 110단어 / Email 100단어 이상 · 문법 오류 ${MAX_ERRORS}개 이하. ✓ 기준 통과 · △ 미통과.`),
          h('p', { class: 'small' }, `최근 ${recent.length}편 평균: ${avg(w => w.words)}단어 · 굵은 표현 ${avg(w => w.bold[1] ? 100 * w.bold[0] / w.bold[1] : 0)}% · 오류 ${avg(w => w.errors)}개`)),
        h('section', { class: 'card' }, h('h2', null, 'Academic Discussion (재구성 8분 · ★·④ 10분)'), grid('D')),
        h('section', { class: 'card' }, h('h2', null, 'Write an Email (재구성 5분 · ★·④ 7분)'), grid('E')));
    }
    return { run, room, stopAll };
  } };
})(typeof window !== 'undefined' ? window : globalThis);
