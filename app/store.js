/* Persistence: one localStorage record + a daily safety copy + JSON export/import. */
(function () {
  'use strict';
  const KEY = 'toeflcoach.v1';
  const DAILY = 'toeflcoach.v1.daily';
  const VERSION = 1;

  function blank() {
    return {
      v: VERSION,
      settings: { examDate: null, minutes: 40 },
      attempts: [],        // append-only log; every derived value is recomputed from it
      origState: {},       // { originalId: { cause: 'confirm'|'other'|'unknown', note, at } }
      edits: {},           // user corrections to original records { originalId: { my, note, at } }
      flags: {},           // items the user reported as broken — excluded from metrics
      session: null,
      lastBackup: null,
      createdAt: Date.now(),
    };
  }

  function migrate(d) {
    const b = blank();
    for (const k of Object.keys(b)) if (d[k] === undefined) d[k] = b[k];
    d.settings = Object.assign(b.settings, d.settings);
    d.v = VERSION;
    return d;
  }

  function read(key) {
    try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : null; } catch (e) { return null; }
  }

  function load() {
    const d = read(KEY);
    if (d && d.v) return migrate(d);
    const daily = read(DAILY);
    if (daily && daily.data && daily.data.v) return migrate(daily.data);
    return blank();
  }

  let warned = false;
  function save(d) {
    try {
      const prev = read(DAILY);
      const today = new Date().toDateString();
      if (!prev || prev.day !== today) {
        const cur = localStorage.getItem(KEY);
        if (cur) localStorage.setItem(DAILY, JSON.stringify({ day: today, data: JSON.parse(cur) }));
      }
      localStorage.setItem(KEY, JSON.stringify(d));
      return true;
    } catch (e) {
      if (!warned) { warned = true; alert('저장에 실패했습니다. 설정 → 내보내기로 백업해 주세요.\n' + e.message); }
      return false;
    }
  }

  function exportBlob(d) {
    return new Blob([JSON.stringify(Object.assign({ exportedAt: new Date().toISOString(), app: 'toefl-coach' }, d), null, 1)],
      { type: 'application/json' });
  }

  function parseImport(text) {
    const d = JSON.parse(text);
    if (d.app !== 'toefl-coach' || !Array.isArray(d.attempts)) throw new Error('이 앱에서 내보낸 파일이 아닙니다.');
    delete d.app; delete d.exportedAt;
    return migrate(d);
  }

  window.Store = { load, save, blank, exportBlob, parseImport };
})();
