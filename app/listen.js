/* 리스닝 오답 다시 풀기 — 소站 TPO独家 모의고사에서 틀린 세트를 원본 음원으로 다시 푼다.
 * 데이터 (원본 저작물이라 공개 저장소에 없음):
 *   로컬 서버(start.command) → private/zhan/listen.js·audio/ (gitignore, tools/zhan.py가 생성)
 *   그 밖(공개 사이트·휴대폰) → 비공개 저장소 ytb1124/toefl-coach-private를 GitHub API로, 기기마다 넣은 읽기 전용 토큰으로 읽는다.
 *   토큰은 이 기기 localStorage 'toefl-gh-token'에만 둔다 (동기화하지 않음). 음원은 Cache API에 보관해 두 번째부터 바로 재생.
 * 기록 키 'toefl-listen-v1' (Sync로 기기 동기화). Routes: #/listen · #/listen/<setId>
 * 순수 로직(ListenCore)은 node 테스트에서도 쓴다 (tests/listen.test.js). */
(function (root) {
  'use strict';

  // ---------- pure logic ----------
  // Latest result of each originally-wrong question: the newer of this tab's last try and
  // `hist(q)` = the same question re-solved in '오늘 훈련' ({ok, at} from the linked original, or null).
  function latest(set, rec, hist) {
    const tries = (rec && rec.tries) || [];
    const last = tries[tries.length - 1];
    return set.qs.filter(q => q.wrong).map(q => {
      const i = set.qs.indexOf(q);
      const mine = last ? { ok: last.ans[i] === q.answer, at: last.at } : null;
      const h = hist ? hist(q) : null;
      return !mine ? h : !h ? mine : (h.at > mine.at ? h : mine);
    });
  }
  // fixed = every originally-wrong question is right on its latest result · again = any is wrong · new = none tried yet.
  function status(set, rec, hist) {
    const r = latest(set, rec, hist);
    if (r.some(x => x && !x.ok)) return 'again';
    return r.length && r.every(x => x && x.ok) ? 'fixed' : 'new';
  }
  // Queue: still-wrong sets (oldest result first), then untried sets (newest test first), then fixed ones (oldest result first).
  function queue(sets, recs, testOrder, hist) {
    const st = s => status(s, recs[s.id], hist);
    const last = s => Math.max(0, ...latest(s, recs[s.id], hist).map(x => (x ? x.at : 0)));
    const rank = { again: 0, new: 1, fixed: 2 };
    const tpos = s => -(testOrder.indexOf(s.test));
    return sets.slice().sort((a, b) => rank[st(a)] - rank[st(b)] || (st(a) === 'new' ? tpos(a) - tpos(b) : last(a) - last(b)));
  }
  // Index of the script line being spoken at time t (lines carry `at` seconds or null).
  function lineAt(lines, t) {
    let k = -1;
    lines.forEach((l, i) => { if (l.at != null && l.at <= t + 0.05) k = i; });
    return k;
  }
  const Core = { status, queue, lineAt, latest };
  if (typeof module !== 'undefined' && module.exports) { module.exports = Core; return; }
  root.ListenCore = Core;

  // ---------- UI ----------
  const KEY = 'toefl-listen-v1';
  const REPO = 'ytb1124/toefl-coach-private';
  const API = 'https://api.github.com/repos/' + REPO + '/contents/';
  const TOKEN_KEY = 'toefl-gh-token';
  const AUDIO_CACHE = 'toefl-listen-audio-v1';
  const KIND = { reply: 'Listen & Reply', conversation: '대화', announcement: '공지', lecture: '강의', other: '기타' };
  const L = 'ABCDEFGHI';

  // ---------- 소站 비공개 자료 불러오기 (리스닝 탭·리딩 탭 공용, window.ZhanData) ----------
  // 로컬 서버(이 Mac, 같은 와이파이의 휴대폰)면 private/zhan/<name>.js, 아니면 이 기기에 넣은 읽기 전용 토큰으로 비공개 저장소의 <name>.json.
  const ZhanData = root.ZhanData = (() => {
    const localHost = /^(localhost|127\.0\.0\.1|\[::1\]|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(location.hostname);
    const token = () => { try { return localStorage.getItem(TOKEN_KEY) || ''; } catch (e) { return ''; } };
    const ghFetch = path => fetch(API + path.split('/').map(encodeURIComponent).join('/'), { headers: { Authorization: 'Bearer ' + token(), Accept: 'application/vnd.github.raw+json' }, cache: 'no-store' })
      .then(r => { if (!r.ok) throw new Error(r.status === 401 ? '토큰이 맞지 않거나 만료됐습니다 (401)' : r.status === 404 ? '저장소를 볼 권한이 없습니다 (404) — 토큰의 저장소 선택을 확인하세요' : 'GitHub 응답 ' + r.status); return r; });
    const state = {};   // name → {loaded: null|true|false, remote, err}
    // name: 'listen' | 'reading' → window[global]
    function load(name, global, then) {
      const st = state[name] || (state[name] = { loaded: null, remote: false, err: null });
      if (root[global]) { st.loaded = true; return then(); }
      if (st.loaded === false) return then();
      const fromGitHub = () => {
        if (!token()) { st.loaded = false; return then(); }
        ghFetch(name + '.json').then(r => r.json()).then(z => { root[global] = z; st.remote = true; st.loaded = true; st.err = null; then(); })
          .catch(e => { st.loaded = false; st.err = e.message; then(); });
      };
      if (!localHost) return fromGitHub();
      const s = document.createElement('script');
      s.src = 'private/zhan/' + name + '.js?t=' + Date.now();
      s.onload = () => { st.loaded = !!root[global]; then(); };
      s.onerror = fromGitHub;
      document.head.append(s);
    }
    const info = name => state[name] || { loaded: null, remote: false, err: null };
    const reset = () => { for (const k in state) if (state[k].loaded === false) state[k].loaded = null; };
    // 토큰 입력 카드 (기기마다 한 번). onOk: 다시 불러오기를 시도하고 성공하면 호출.
    function tokenCard(h, { title, lead, retry }) {
      const input = h('input', { type: 'password', autocomplete: 'off', class: 'idea-ex', placeholder: 'github_pat_…' });
      const errs = Object.values(state).map(s => s.err).filter(Boolean);
      const msg = h('p', { class: 'small', role: 'status' }, errs.length ? '불러오기 실패: ' + errs[0] : '');
      const ok = h('button', { class: 'primary', onclick: () => {
        const v = input.value.trim(); if (!v) return;
        try { localStorage.setItem(TOKEN_KEY, v); } catch (e) { msg.textContent = '저장 실패: ' + e.message; return; }
        input.value = ''; reset(); msg.textContent = '확인하는 중…';
        retry(okd => { if (!okd) { try { localStorage.removeItem(TOKEN_KEY); } catch (e) { /* ignore */ } const e2 = Object.values(state).map(s => s.err).filter(Boolean)[0]; msg.textContent = '불러오기 실패: ' + (e2 || '알 수 없음'); } });
      } }, '토큰 저장하고 불러오기');
      return [h('h1', null, title), h('section', { class: 'card' },
        h('p', null, lead),
        h('p', { class: 'small muted' }, `독점 TPO 원본 자료는 저작물이라 공개 사이트에 두지 않고 비공개 저장소 ${REPO}에만 있습니다. 토큰은 이 기기 브라우저에만 저장되고 동기화되지 않습니다 (기기마다 한 번, 리스닝·리딩 공용). 학습 기록은 동기화됩니다.`),
        h('details', null, h('summary', { class: 'small' }, '토큰 만드는 법 (읽기 전용, 이 저장소 하나만)'),
          h('ol', { class: 'small' },
            h('li', null, 'github.com → 오른쪽 위 프로필 → Settings → 맨 아래 Developer settings'),
            h('li', null, 'Personal access tokens → Fine-grained tokens → Generate new token'),
            h('li', null, `Repository access: Only select repositories → ${REPO} 를 실제로 선택`),
            h('li', null, 'Permissions → Repository permissions → + Add permissions → Contents 체크 → Read-only'),
            h('li', null, 'Generate token → 나온 github_pat_… 를 복사해 아래에 붙여넣기'))),
        input, ok, msg,
        h('p', { class: 'small muted' }, 'Mac에서 start.command로 열면 토큰 없이 로컬 파일로 열립니다.'))];
    }
    const sourceLine = (h, name) => h('p', { class: 'small muted' }, info(name).remote
      ? ['비공개 GitHub 저장소에서 불러옴 · ', h('a', { href: 'javascript:void 0', onclick: () => { try { localStorage.removeItem(TOKEN_KEY); } catch (e) { /* ignore */ } location.reload(); } }, '이 기기에서 토큰 지우기')]
      : '이 Mac의 로컬 파일에서 불러옴');
    return { REPO, localHost, token, ghFetch, load, info, tokenCard, sourceLine };
  })();

  root.ListenApp = { create(env) {
    const { h, go, storage, toast } = env;
    const link = env.link || { info: () => null, log: () => {} };
    const ensureData = then => ZhanData.load('listen', 'ZHAN', then);
    const remoteMode = () => ZhanData.info('listen').remote;
    const ghFetch = ZhanData.ghFetch;
    // '오늘 훈련'의 원본 오답 문제에서 같은 문항의 소站 원본 음원을 찾아 준다 (없으면 조용히 아무것도 안 함).
    function origSource(origId, cb) {
      if (ZhanData.info('listen').loaded === false) return;
      ensureData(() => {
        if (!root.ZHAN) return;
        for (const set of root.ZHAN.sets) {
          const q = set.qs.find(x => x.orig === origId);
          if (!q) continue;
          const path = set.kind === 'reply' ? q.audio : set.audio;
          if (path) fetchAudio(path).then(() => cb(src(path))).catch(() => {});
          return;
        }
      });
    }
    // Audio: local mode plays the file path; remote mode plays a blob URL fetched once (Cache API keeps it across visits).
    const urls = {};
    async function fetchAudio(path) {
      if (!remoteMode() || urls[path]) return;
      const key = API + path;
      let res = null, cache = null;
      try { cache = await caches.open(AUDIO_CACHE); res = await cache.match(key); } catch (e) { /* no Cache API */ }
      if (!res) {
        const r = await ghFetch(path.replace(/^private\/zhan\//, ''));
        const buf = await r.arrayBuffer();
        res = new Response(buf, { headers: { 'Content-Type': 'audio/mpeg' } });
        if (cache) try { await cache.put(key, res.clone()); } catch (e) { /* quota */ }
      }
      urls[path] = URL.createObjectURL(new Blob([await res.arrayBuffer()], { type: 'audio/mpeg' }));
    }
    const src = path => remoteMode() ? urls[path] : path;
    const ready = paths => paths.every(p => !remoteMode() || urls[p]);
    function load() { try { const d = JSON.parse(storage.getItem(KEY) || 'null'); if (d && d.v) return Object.assign({ v: 1, sets: {}, prefs: {} }, d); } catch (e) { /* fresh */ } return { v: 1, sets: {}, prefs: {} }; }
    function save(mut) { const d = load(); mut(d); try { storage.setItem(KEY, JSON.stringify(d)); } catch (e) { toast('저장 실패: ' + e.message); } return d; }

    let audio = null, cur = null;
    function stop() { if (audio) { audio.pause(); audio.src = ''; audio = null; } }
    window.addEventListener('hashchange', stop);
    const rate = () => load().prefs.rate || 1;
    function player(path, opts = {}) {
      stop();
      audio = new Audio(src(path));
      audio.__path = path;
      audio.playbackRate = rate();
      audio.preservesPitch = true;
      if (opts.onEnded) audio.addEventListener('ended', opts.onEnded);
      if (opts.onTime) audio.addEventListener('timeupdate', () => opts.onTime(audio.currentTime));
      return audio;
    }
    function speedToggle() {
      const box = h('span', { class: 'row tight speed' });
      const draw = () => { box.innerHTML = ''; [1, 1.25].forEach(r => box.append(h('button', { class: 'word' + (rate() === r ? ' sel' : ''), onclick: () => { save(d => { d.prefs.rate = r; }); if (audio) audio.playbackRate = r; draw(); } }, r + '×'))); };
      draw(); return box;
    }
    const back = (hash, label) => h('a', { class: 'small', href: hash }, '← ' + label);
    // 앱 '오늘 훈련'의 같은 원본 오답: 능력 + 지금까지 다시 푼 기록 (이번 풀이 포함)
    const hist = q => { const i = q.orig ? link.info(q.orig) : null; return i && i.n ? { ok: i.lastOk, at: i.lastAt } : null; };
    function origLine(id) {
      const i = link.info(id); if (!i) return null;
      return h('p', { class: 'small muted' }, i.skill ? h('span', { class: 'chip' }, i.skill) : null, ` 오늘 훈련 원본 ${id} · 다시 푼 기록 ${i.ok}/${i.n} 맞힘`);
    }
    const chipFor = st => h('span', { class: 'chip ' + ({ new: '', fixed: 'src-tutor', again: 'rc-repeat' })[st] }, ({ new: '아직 안 풂', fixed: '다시 풀어 맞힘', again: '또 틀림' })[st]);

    function view(main, parts, rerender) {
      stop();
      main.classList.add('listen');
      ensureData(() => {
        if (!root.ZHAN) return missing(main);
        const [id] = parts;
        const Z = root.ZHAN;
        cur = cur && cur.id === id ? cur : null;
        if (id && Z.sets.some(s => s.id === id)) return viewSet(main, Z, Z.sets.find(s => s.id === id), rerender);
        viewList(main, Z);
      });
    }
    function missing(main) {
      main.append(...ZhanData.tokenCard(h, { title: '리스닝 오답 다시 풀기', lead: '이 기기에 GitHub 토큰을 한 번 넣으면 원본 음원으로 풀 수 있습니다.',
        retry: done => ensureData(() => { done(!!root.ZHAN); if (root.ZHAN) { toast('연결했습니다'); main.innerHTML = ''; view(main, [], null); } }) }));
    }

    // ---------- list ----------
    function viewList(main, Z) {
      const d = load();
      main.append(ZhanData.sourceLine(h, 'listen'));
      const order = Z.tests.map(t => t.id);
      const q = queue(Z.sets, d.sets, order, hist);
      const counts = { new: 0, again: 0, fixed: 0 };
      Z.sets.forEach(s => counts[status(s, d.sets[s.id], hist)]++);
      const wrongTotal = Z.sets.reduce((n, s) => n + s.qs.filter(x => x.wrong).length, 0);
      main.append(h('section', { class: 'card hero' },
        h('h1', null, '리스닝 오답 다시 풀기'),
        h('p', { class: 'muted' }, `독점 TPO ${Z.tests.length}회에서 틀린 ${wrongTotal}문항이 들어 있는 ${Z.sets.length}세트. 원본 음원으로 시험처럼 한 번 듣고 풀고, 끝나면 스크립트·해설을 봅니다.`),
        h('p', { class: 'small' }, `또 틀림 ${counts.again} · 아직 안 풂 ${counts.new} · 다시 풀어 맞힘 ${counts.fixed}`),
        h('p', { class: 'small muted' }, '오늘 훈련에서 같은 원본 문제를 다시 푼 기록도 함께 셉니다 (가장 최근 결과 기준).'),
        q.length ? h('button', { class: 'primary', onclick: () => go('#/listen/' + q[0].id) }, `다음 세트: ${q[0].title} (${testName(Z, q[0].test)})`) : null,
        h('p', { class: 'small' }, h('a', { href: '#/ko' }, '한국어로 풀어 보기 →'), h('span', { class: 'muted' }, ' 틀린 이유가 영어인지 판단인지 가르기'))));
      for (const t of Z.tests.slice().reverse()) {
        const sets = Z.sets.filter(s => s.test === t.id);
        main.append(h('section', { class: 'card' },
          h('h2', null, t.name, h('span', { class: 'muted small' }, ` ${t.date} · ${t.correct}/${t.total} · ${t.score}점`)),
          h('ul', { class: 'olist' }, sets.map(s => h('li', { onclick: () => go('#/listen/' + s.id) },
            h('div', null, h('b', null, s.title), ' ', h('span', { class: 'muted small' }, `Module ${s.module} · ${KIND[s.kind]}`), ' ', chipFor(status(s, d.sets[s.id], hist))),
            h('div', { class: 'small muted' }, `틀린 문항 ${s.qs.filter(x => x.wrong).length}/${s.qs.length}`, appLine(s)))))));
      }
    }
    function appLine(s) {
      const linked = s.qs.filter(x => x.orig).map(x => link.info(x.orig)).filter(Boolean);
      const tried = linked.filter(i => i.n);
      return tried.length ? ` · 오늘 훈련 기록 포함 다시 푼 ${tried.length}문항 중 최근 맞힘 ${tried.filter(i => i.lastOk).length}` : '';
    }
    const testName = (Z, id) => (Z.tests.find(t => t.id === id) || {}).name || id;

    // ---------- one set: listen → answer → review ----------
    function viewSet(main, Z, set, rerender) {
      if (!cur) cur = { id: set.id, phase: set.kind === 'reply' ? 'q' : 'listen', qi: 0, ans: [] };
      const paths = [set.audio].concat(set.qs.map(q => q.audio)).filter(Boolean);
      if (!ready(paths)) {
        const msg = h('p', { class: 'muted' }, `음원 불러오는 중… (${paths.filter(p => urls[p]).length}/${paths.length})`);
        main.append(back('#/listen', '목록'), h('section', { class: 'card' }, msg));
        const id = set.id;
        (async () => { for (const p of paths) { await fetchAudio(p); msg.textContent = `음원 불러오는 중… (${paths.filter(x => urls[x]).length}/${paths.length})`; } })()
          .then(() => { if ((location.hash || '').endsWith('/' + id)) { main.innerHTML = ''; viewSet(main, Z, set, rerender); } })
          .catch(e => { msg.textContent = '음원 불러오기 실패: ' + e.message; });
        return;
      }
      const reply = set.kind === 'reply';
      const card = h('section', { class: 'card' });
      main.append(h('div', { class: 'swbar' }, back('#/listen', '목록'), h('span', { class: 'small muted' }, `${testName(Z, set.test)} · Module ${set.module} · ${set.title}`), speedToggle()), card);
      const redraw = () => { stop(); main.innerHTML = ''; viewSet(main, Z, set, rerender); };

      if (cur.phase === 'listen') {
        const bar = h('progress', { max: 1, value: 0, class: 'lprog' });
        const btn = h('button', { class: 'primary' }, '▶ 듣기 시작');
        const next = h('button', { class: 'ghost wide', disabled: true, onclick: () => { cur.phase = 'q'; redraw(); } }, '문제 풀기 →');
        btn.onclick = () => {
          const a = player(set.audio, { onEnded: () => { next.disabled = false; next.className = 'primary'; btn.textContent = '다 들었음'; }, onTime: t => { if (a.duration) bar.value = t / a.duration; } });
          a.play().catch(e => toast('재생 실패: ' + e.message));
          btn.disabled = true; btn.textContent = '듣는 중… (시험처럼 한 번만)';
          setTimeout(() => { next.disabled = false; }, 15000);   // 끝까지 못 들었을 때 넘어갈 수 있게
        };
        card.append(h('p', { class: 'small muted' }, `${KIND[set.kind]} · 문항 ${set.qs.length}개 (이 중 시험에서 틀린 것 ${set.qs.filter(q => q.wrong).length}개). 메모하면서 한 번 듣고, 다 들은 뒤 문제가 나옵니다.`),
          btn, bar, next);
        return;
      }

      if (cur.phase === 'q') {
        const q = set.qs[cur.qi];
        card.append(h('p', { class: 'small muted' }, `문항 ${cur.qi + 1} / ${set.qs.length}`));
        if (reply) {
          const play = h('button', { class: 'ghost' }, '▶ 다시 듣기');
          const go1 = () => { const a = player(q.audio); a.play().catch(e => toast('재생 실패: ' + e.message)); };
          play.onclick = go1;
          card.append(h('p', null, h('b', null, 'Choose the best response.'), ' 들은 말에 가장 알맞은 대답을 고르세요.'), play);
          setTimeout(go1, 200);
        } else card.append(h('p', { class: 'stem' }, q.stem));
        card.append(h('div', { class: 'opts' }, q.choices.map((c, i) => h('button', { class: 'opt', onclick: () => {
          cur.ans[cur.qi] = i;
          if (cur.qi + 1 < set.qs.length) { cur.qi++; redraw(); return; }
          const ok = set.qs.filter((x, k) => cur.ans[k] === x.answer).length;
          set.qs.forEach((x, k) => { if (x.orig) link.log(x.orig, cur.ans[k] === x.answer, x.choices[cur.ans[k]]); });
          save(d => { const r = d.sets[set.id] || { tries: [] }; r.tries.push({ at: Date.now(), ans: cur.ans.slice(), ok, n: set.qs.length }); d.sets[set.id] = r; });
          cur.phase = 'review'; redraw();
        } }, h('b', null, L[i]), ' ', c))));
        return;
      }

      // review
      const ok = set.qs.filter((x, k) => cur.ans[k] === x.answer).length;
      const fixed = set.qs.every((x, k) => !x.wrong || cur.ans[k] === x.answer);
      card.append(h('h2', null, `${ok} / ${set.qs.length}`, ' ', h('span', { class: 'small ' + (fixed ? 'good-text' : 'warn') }, fixed ? '시험에서 틀린 문항을 이번엔 모두 맞힘' : '시험에서 틀린 문항을 또 틀림')));
      set.qs.forEach((q, k) => {
        const mine = cur.ans[k];
        card.append(h('div', { class: 'fb ' + (mine === q.answer ? 'good' : 'bad') },
          h('p', null, h('b', null, `Q${k + 1}. `), reply ? h('span', null, h('span', { class: 'muted' }, '들은 말: '), q.stem) : q.stem),
          h('ul', { class: 'lchoices' }, q.choices.map((c, i) => h('li', { class: i === q.answer ? 'right' : i === mine ? 'wrong' : '' },
            h('b', null, L[i]), ' ', c,
            i === q.answer ? h('span', { class: 'chip src-tutor' }, '정답') : null,
            i === mine && i !== q.answer ? h('span', { class: 'chip rc-repeat' }, '이번 내 답') : null,
            q.wrong && i === q.my ? h('span', { class: 'chip' }, '시험 때 내 답') : null))),
          q.orig ? origLine(q.orig) : null,
          q.whyKo ? h('p', { class: 'small' }, q.whyKo) : null,
          q.point ? h('p', { class: 'rule small' }, '다음엔 → ', q.point) : null,
          reply && q.audio ? h('button', { class: 'ghost small', onclick: () => player(q.audio).play() }, '▶ 다시 듣기') : null));
      });
      if (!reply) {
        const lines = set.script.map((l, i) => h('p', { class: 'tline' + (l.at != null ? ' seek' : ''), 'data-i': i, onclick: l.at != null ? () => { if (!audio || audio.__path !== set.audio) start(); audio.currentTime = l.at; audio.play(); } : null },
          l.sp && l.sp !== 'N' ? h('b', { class: 'sp' }, l.sp + ': ') : null, l.t));
        const box = h('div', { class: 'passage tscript' }, lines);
        const start = () => {
          const a = player(set.audio, { onTime: t => { const k = lineAt(set.script, t); lines.forEach((el, i) => el.classList.toggle('now', i === k)); } });
          return a;
        };
        const hasTime = set.script.some(l => l.at != null);
        card.append(h('h3', null, '스크립트'),
          h('div', { class: 'row' }, h('button', { class: 'ghost', onclick: () => { start().play(); } }, '▶ 스크립트 보며 다시 듣기'), h('button', { class: 'ghost', onclick: stop }, '■ 멈춤')),
          h('p', { class: 'small muted' }, hasTime ? '줄을 누르면 그 부분부터 재생됩니다. 지금 나오는 줄이 표시됩니다.' : '이 세트의 스크립트에는 시간 표시가 없어 줄 이동은 안 됩니다.'), box);
      }
      const d = load(), order = root.ZHAN.tests.map(t => t.id);
      const nxt = queue(root.ZHAN.sets, d.sets, order, hist).find(s => s.id !== set.id);
      card.append(h('div', { class: 'row' },
        h('button', { class: 'ghost', onclick: () => { cur = null; redraw(); } }, '같은 세트 다시 풀기'),
        nxt ? h('button', { class: 'primary', onclick: () => { cur = null; go('#/listen/' + nxt.id); } }, '다음 세트 →') : null));
    }
    return { view, origSource, rate, busy: () => !!(cur && cur.phase !== 'review' && audio && !audio.paused) };
  } };
})(typeof window !== 'undefined' ? window : globalThis);
