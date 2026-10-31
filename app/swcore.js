/* Speaking·Writing core — pure logic (no DOM): answer matching, word diff, L&R scoring, error scanner, review schedule.
 * Loaded in the browser as window.SWCore and in node (tests) via require. */
(function (root) {
  'use strict';
  const DAY = 86400000;
  // Leitner boxes for the correction drill: box n → next review after INTERVAL[n] days. Box 6 = 마스터.
  const INTERVAL = [0, 1, 3, 7, 14, 30, 60];
  const MASTER = 6;

  // ---------- normalization ----------
  const ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve',
    'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
  const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
  const ORD = { '1st': 'first', '2nd': 'second', '3rd': 'third', '4th': 'fourth', '5th': 'fifth', '6th': 'sixth', '7th': 'seventh', '8th': 'eighth', '9th': 'ninth', '10th': 'tenth' };
  function numWords(n) {
    if (n < 20) return ONES[n];
    if (n < 100) return TENS[Math.floor(n / 10)] + (n % 10 ? ' ' + ONES[n % 10] : '');
    if (n < 1000) return ONES[Math.floor(n / 100)] + ' hundred' + (n % 100 ? ' ' + numWords(n % 100) : '');
    return String(n);
  }
  const CONTRACT = { "don't": 'do not', "doesn't": 'does not', "didn't": 'did not', "can't": 'cannot', "won't": 'will not', "isn't": 'is not',
    "aren't": 'are not', "wasn't": 'was not', "weren't": 'were not', "i'm": 'i am', "it's": 'it is', "you're": 'you are', "we're": 'we are',
    "they're": 'they are', "i'll": 'i will', "you'll": 'you will', "we'll": 'we will', "i've": 'i have', "i'd": 'i would', "that's": 'that is',
    "there's": 'there is', "let's": 'let us', "haven't": 'have not', "hasn't": 'has not', "shouldn't": 'should not', "couldn't": 'could not', "wouldn't": 'would not' };

  // Lowercase word tokens; digits → words (speech recognition writes "10", the script says "ten"); contractions expanded.
  function tokens(s) {
    let t = String(s || '').toLowerCase().replace(/[’‘]/g, "'").replace(/[“”]/g, '"').replace(/[é]/g, 'e');
    t = t.replace(/\b(\d{1,2}):(\d{2})\b/g, (m, a, b) => numWords(+a) + (+b ? ' ' + numWords(+b) : ''));
    t = t.replace(/\b(\d+)(st|nd|rd|th)\b/g, m => ORD[m] || m);
    t = t.replace(/\b(\d{1,3}),(\d{3})\b/g, '$1$2');
    t = t.replace(/\b\d+\b/g, m => (+m < 1000 ? numWords(+m) : m));
    t = t.replace(/[-–—/]/g, ' ').replace(/[^a-z0-9' ]+/g, ' ');
    const out = [];
    for (const w of t.split(/\s+/)) {
      if (!w) continue;
      const bare = w.replace(/^'+|'+$/g, '');
      if (!bare) continue;
      if (CONTRACT[bare]) out.push(...CONTRACT[bare].split(' ')); else out.push(bare);
    }
    return out;
  }
  const norm = s => tokens(s).join(' ');

  // ---------- correction drill ----------
  function matchAnswer(input, answers) {
    const n = norm(input);
    return !!n && answers.some(a => norm(a) === n);
  }
  function nearest(input, answers) {
    let best = answers[0], bestCost = Infinity;
    for (const a of answers) { const c = diff(a, input).filter(o => o.op !== 'eq').length; if (c < bestCost) { best = a; bestCost = c; } }
    return best;
  }
  // card = {box, due, ok, bad}; returns the updated card
  function review(card, correct, now) {
    const c = Object.assign({ box: 0, due: 0, ok: 0, bad: 0 }, card);
    if (correct) { c.box = Math.min(MASTER, c.box + 1); c.ok++; } else { c.box = 1; c.bad++; }
    c.due = now + INTERVAL[c.box] * DAY;
    c.last = now; c.lastOk = !!correct;
    return c;
  }
  // Tutor correction date from src ('튜터 10/28' → 1028); AI items and undated sources → 0.
  const srcDate = src => { const m = /^튜터\s+(\d{1,2})\/(\d{1,2})/.exec(src || ''); return m ? +m[1] * 100 + +m[2] : 0; };
  // Today's queue: due reviews first (oldest due first), then new items — newest tutor corrections first, else content order.
  // A backlog of due reviews never takes every slot: up to minNew slots stay for new items, so new sentences keep coming.
  function drillQueue(items, cards, now, size, maxNew, minNew) {
    size = size || 10; maxNew = maxNew == null ? 6 : maxNew; minNew = minNew == null ? 4 : minNew;
    const due = items.filter(i => cards[i.id] && cards[i.id].box < MASTER && cards[i.id].due <= now)
      .sort((a, b) => cards[a.id].due - cards[b.id].due);
    const fresh = items.filter(i => !cards[i.id]).sort((a, b) => srcDate(b.src) - srcDate(a.src));
    const q = due.slice(0, size - Math.min(minNew, maxNew, fresh.length));
    for (const i of fresh) { if (q.length >= size || q.filter(x => !cards[x.id]).length >= maxNew) break; q.push(i); }
    return q;
  }

  // ---------- word diff (LCS) ----------
  // ops: {op:'eq'|'del'|'ins'|'sub', a (target word), b (said word), i (target index), j (said index)}
  function diff(target, said) {
    const A = Array.isArray(target) ? target : tokens(target), B = Array.isArray(said) ? said : tokens(said);
    const n = A.length, m = B.length;
    const L = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = A[i] === B[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
    const raw = [];
    let i = 0, j = 0;
    while (i < n || j < m) {
      if (i < n && j < m && A[i] === B[j]) { raw.push({ op: 'eq', a: A[i], b: B[j], i, j }); i++; j++; }
      else if (j < m && (i >= n || L[i][j + 1] > L[i + 1][j])) { raw.push({ op: 'ins', b: B[j], i, j }); j++; }
      else { raw.push({ op: 'del', a: A[i], i }); i++; }
    }
    // adjacent del+ins (either order) → one substitution
    const ops = [];
    for (let k = 0; k < raw.length; k++) {
      const x = raw[k], y = raw[k + 1];
      if (y && ((x.op === 'del' && y.op === 'ins') || (x.op === 'ins' && y.op === 'del'))) {
        const d = x.op === 'del' ? x : y, s = x.op === 'ins' ? x : y;
        ops.push({ op: 'sub', a: d.a, b: s.b, i: d.i, j: s.j }); k++;
      } else ops.push(x);
    }
    return ops;
  }

  // ---------- Listen & Repeat ----------
  const SMALL = new Set(('a an the in on at for of to about by with from into onto until during before after over under near around ' +
    'and or but so if as than that this these those each every all some any its their your our his her my ' +
    'can may might must should will would could shall is are was were be been am do does did has have had not no').split(' '));
  const LR_CAT = {
    small: '작은 단어 (관사·전치사·조동사)',
    plural: '복수 -s · 동사 형태',
    swap: '다른 단어로 바꿔 말함 / 잘못 들음',
    drop: '수식어·내용어 빠짐',
    extra: '없는 단어를 덧붙임',
    end: '문장 끝을 놓침',
  };
  const stem = w => w.replace(/(ies|es|s|ed|ing)$/, '');
  // Score 0–5 the way the tutor did: exact 5 · one change 4 · several 3 · many / unfinished 2 · little 1 · nothing 0.
  // A "change" is one place where the repeat differs: adjacent wrong words count once ("in kitchen area" → "in the common kitchen area" = 1).
  function lrScore(target, said) {
    const A = tokens(target), B = tokens(said);
    if (!B.length) return { score: 0, ops: [], cats: {}, errors: A.length };
    const ops = diff(A, B);
    const cats = {};
    const add = k => { cats[k] = (cats[k] || 0) + 1; };
    // trailing run of missing target words = unfinished sentence
    let tail = 0;
    for (let k = ops.length - 1; k >= 0 && ops[k].op === 'del'; k--) tail++;
    const unfinished = tail >= 2;
    const body = unfinished ? ops.slice(0, ops.length - tail) : ops;
    let errors = 0, inRun = false;
    body.forEach(o => {
      if (o.op === 'eq') { inRun = false; return; }
      if (!inRun) errors++;
      inRun = true;
      if (o.op === 'ins') return add(SMALL.has(o.b) ? 'small' : 'extra');
      if (o.op === 'sub' && stem(o.a) === stem(o.b)) return add('plural');
      if (SMALL.has(o.a)) return add('small');
      add(o.op === 'sub' ? 'swap' : 'drop');
    });
    if (unfinished) { add('end'); errors++; }
    const matched = ops.filter(o => o.op === 'eq').length;
    let score = errors === 0 ? 5 : errors === 1 ? 4 : errors <= 3 ? 3 : 2;
    if (unfinished) score = Math.min(score, 2);
    if (matched / A.length < 0.4) score = Math.min(score, 1);
    return { score, ops, cats, errors };
  }

  // ---------- error scanner (my recurring mistakes) ----------
  // rules: [{re, flags?, cat, msg, fix?, level?, only?}] from content/sw.json; returns [{cat, msg, fix, level, index, match}]
  function scan(text, rules, kind) {
    const out = [];
    const src = String(text || '').replace(/[’‘]/g, "'");
    for (const r of rules) {
      if (r.only && kind && r.only.indexOf(kind) < 0) continue;
      const re = new RegExp(r.re, (r.flags || 'i').replace('g', '') + 'g');
      let m;
      while ((m = re.exec(src))) {
        out.push({ cat: r.cat, msg: r.msg, fix: r.fix || null, level: r.level || 'error', index: m.index, match: m[0] });
        if (!m[0].length) re.lastIndex++;
      }
    }
    // one flag per text span: keep the first rule that matched there
    out.sort((a, b) => a.index - b.index);
    return out.filter((f, k) => !out.slice(0, k).some(g => g.index === f.index && g.match === f.match));
  }

  // ---------- idea switch: did my idea just repeat a classmate? ----------
  // Content words of `mine` that also appear in the classmates' posts but not in the professor's question
  // (question words are the shared topic, not a repeated idea). Light stemming so "economies" meets "economy".
  const GENERIC = new Set(('think believe agree disagree because also really very more most much many people person thing things ' +
    'good better best great important help helps make makes made other others even such example instance while however ' +
    'which what when where would could should will have been being there their them they this that these those your ' +
    'just only with from into about like well than then some every overall way ways lot lots get gets can actually time create live need needs give gives bring keep').split(' '));
  const wroot = w => w.replace(/(ies|ied)$/, 'y').replace(/(ing|ed|es|s)$/, '').replace(/e$/, '');
  function ideaOverlap(mine, posts, question) {
    const skip = new Set(tokens(question).map(wroot));
    const theirs = new Set([].concat(posts || []).flatMap(p => tokens(p)).map(wroot));
    const out = [], seen = new Set();
    for (const w of tokens(mine)) {
      const r = wroot(w);
      if (w.length < 4 || GENERIC.has(w) || GENERIC.has(r) || skip.has(r) || seen.has(r) || !theirs.has(r)) continue;
      seen.add(r); out.push(w);
    }
    return out;
  }

  // ---------- writing stats ----------
  function wordCount(text) { return (String(text || '').match(/[A-Za-z0-9][A-Za-z0-9'’-]*/g) || []).length; }
  function paragraphs(text) { return String(text || '').split(/\n\s*\n/).map(p => p.trim()).filter(Boolean).length; }

  // ---------- build a sentence ----------
  function bsCorrect(answer, placed) { return norm(answer.join(' ')) === norm(placed.join(' ')); }

  // Deterministic shuffle (seeded) so a question's tiles keep their order across re-renders.
  function shuffle(list, seed) {
    const a = list.slice();
    let s = 0;
    for (const ch of String(seed)) s = (s * 31 + ch.charCodeAt(0)) >>> 0;
    for (let i = a.length - 1; i > 0; i--) { s = (s * 1103515245 + 12345) >>> 0; const j = s % (i + 1); [a[i], a[j]] = [a[j], a[i]]; }
    if (a.length > 1 && a.every((x, i) => x === list[i])) a.push(a.shift());
    return a;
  }

  const API = { DAY, INTERVAL, MASTER, tokens, norm, matchAnswer, nearest, review, drillQueue, diff, lrScore, LR_CAT, scan, ideaOverlap, wordCount, paragraphs, bsCorrect, shuffle };
  if (typeof module !== 'undefined' && module.exports) module.exports = API; else root.SWCore = API;
})(typeof window !== 'undefined' ? window : globalThis);
