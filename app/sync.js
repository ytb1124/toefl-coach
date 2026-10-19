/* Sync: a localStorage-shaped key/value store that follows the learner across devices.
 *
 * In the claude.ai viewer it keeps every value in the claude.ai `db` capability, under the viewer's own
 * private subtree (data/users/<id>/…), so any device signed in to claude.ai sees the same records with no
 * extra login. Values over the 256 KiB document limit are split into chunk documents.
 * Opened anywhere else (local file / local server) it falls back to plain localStorage.
 *
 * API: Sync.ready (Promise) · getItem/setItem/removeItem · status() · onChange(fn) · flush()
 */
(function () {
  'use strict';
  const SYNCED = k => k === 'toeflcoach.v1' || k.startsWith('toefl-vocab');
  const CHUNK_CHARS = 60000;           // ≤ ~180 KB even for 3-byte UTF-8 text
  const DEBOUNCE_MS = 1500;
  const META = 'sync:meta';            // local: { key: {t, dirty} }
  const mem = new Map();
  let meta = {};
  let db = null, col = null, mode = 'local', lastError = null;
  const listeners = [];
  const emit = (what, key) => listeners.forEach(fn => { try { fn(what, key); } catch (e) { console.error(e); } });

  const ls = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); return true; } catch (e) { return false; } },
    del(k) { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } },
    keys() { try { return Object.keys(localStorage); } catch (e) { return []; } },
  };
  function saveMeta() { ls.set(META, JSON.stringify(meta)); }
  try { meta = JSON.parse(ls.get(META) || '{}') || {}; } catch (e) { meta = {}; }
  for (const k of ls.keys()) if (SYNCED(k)) mem.set(k, ls.get(k));

  const docId = (key, i) => key.replace(/[^A-Za-z0-9_.~:@+-]/g, '_') + '~' + i;

  // ---------- remote → local ----------
  function assemble(docs) {
    const byKey = {};
    for (const d of docs) {
      const b = d.data(); if (!b || typeof b.k !== 'string') continue;
      (byKey[b.k] = byKey[b.k] || []).push(b);
    }
    const out = {};
    for (const [k, parts] of Object.entries(byKey)) {
      // The newest complete write wins (every chunk of one write carries the same t and n).
      const ts = [...new Set(parts.map(p => p.t))].sort((a, b) => b - a);
      for (const t of ts) {
        const set = parts.filter(p => p.t === t).sort((a, b) => a.i - b.i);
        const n = set[0].n;
        if (n === 0) { out[k] = { t, v: null }; break; }       // deleted
        if (set.length === n && set.every((p, i) => p.i === i)) { out[k] = { t, v: n === 0 ? null : set.map(p => p.v).join('') }; break; }
      }
    }
    return out;
  }
  function applyRemote(remote, fromLive) {
    const changed = [];
    for (const [k, r] of Object.entries(remote)) {
      const local = meta[k];
      if (local && local.dirty && local.t >= r.t) continue;          // our unsent edit is newer
      if (local && local.t >= r.t) continue;                          // already have it
      if (r.v == null) { mem.delete(k); ls.del(k); } else { mem.set(k, r.v); ls.set(k, r.v); }
      meta[k] = { t: r.t, dirty: false };
      changed.push(k);
    }
    if (changed.length) { saveMeta(); if (fromLive) changed.forEach(k => emit('remote', k)); }
    return changed;
  }

  // ---------- local → remote ----------
  const known = new Map();   // key -> number of chunk docs currently stored remotely
  let timer = null, chain = Promise.resolve(), pending = 0;
  function schedule() { clearTimeout(timer); timer = setTimeout(flush, DEBOUNCE_MS); }
  function flush() {
    clearTimeout(timer);
    if (mode !== 'cloud') return Promise.resolve();
    const dirty = Object.keys(meta).filter(k => meta[k].dirty);
    if (!dirty.length) return chain;
    pending++; emit('status');
    chain = chain.then(async () => {
      for (const k of dirty) {
        const m = meta[k]; if (!m || !m.dirty) continue;
        const t = m.t, v = mem.has(k) ? mem.get(k) : null;
        const parts = [];
        if (v != null) for (let i = 0; i < v.length; i += CHUNK_CHARS) parts.push(v.slice(i, i + CHUNK_CHARS));
        if (v === '') parts.push('');
        const n = parts.length;
        try {
          for (let i = 0; i < n; i++) await col.doc(docId(k, i)).set({ k, i, n, t, v: parts[i] });
          if (n === 0) await col.doc(docId(k, 0)).set({ k, i: 0, n: 0, t, v: '' });   // tombstone
          const before = known.get(k) || 0;
          for (let i = Math.max(n, 1); i < before; i++) await col.doc(docId(k, i)).delete();
          known.set(k, Math.max(n, 1));
          if (meta[k] && meta[k].t === t) { meta[k].dirty = false; saveMeta(); }
          lastError = null;
        } catch (e) {
          lastError = (e && (e.code || e.message)) || String(e);
          console.error('sync write failed', k, e);
          if (e && (e.code === 'unavailable' || e.code === 'resource_exhausted')) setTimeout(schedule, 4000 + Math.random() * 3000);
          break;
        }
      }
    }).finally(() => { pending--; emit('status'); });
    return chain;
  }

  // ---------- public ----------
  function setItem(k, v) {
    v = String(v);
    if (mem.get(k) === v) return;
    mem.set(k, v);
    ls.set(k, v);
    if (!SYNCED(k)) return;
    meta[k] = { t: Date.now(), dirty: true }; saveMeta();
    if (mode === 'cloud') schedule();
  }
  function getItem(k) { return mem.has(k) ? mem.get(k) : (SYNCED(k) ? null : ls.get(k)); }
  function removeItem(k) {
    mem.delete(k); ls.del(k);
    if (!SYNCED(k)) return;
    meta[k] = { t: Date.now(), dirty: true }; saveMeta();
    if (mode === 'cloud') schedule();
  }

  async function connect() {
    const claude = window.claude;
    if (!claude || typeof claude.use !== 'function') return;          // not inside the claude.ai viewer
    try {
      const [d, u] = await Promise.all([claude.use('db'), claude.use('user')]);
      if (!d || !u) return;
      const id = await u.id();
      if (!id) return;
      db = d; col = db.collection('data/users/' + id);
      const snap = await col.get();
      snap.docs.forEach(doc => { const b = doc.data(); if (b && b.k) known.set(b.k, Math.max(known.get(b.k) || 0, (b.i || 0) + 1)); });
      applyRemote(assemble(snap.docs), false);
      mode = 'cloud';
      // Keys edited on this device while it was offline, or first-time upload from an existing browser.
      for (const k of mem.keys()) if (SYNCED(k) && !meta[k]) meta[k] = { t: Date.now(), dirty: true };
      saveMeta();
      flush();
      col.onSnapshot(s => { if (!s.metadata.hasPendingWrites) applyRemote(assemble(s.docs), true); }, e => { lastError = e.code; emit('status'); });
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); });
      window.addEventListener('pagehide', () => flush());
    } catch (e) {
      lastError = (e && (e.code || e.message)) || String(e);
      console.error('sync connect failed', e);
    }
  }

  const ready = Promise.race([connect(), new Promise(r => setTimeout(r, 12000))]).then(() => { emit('status'); });

  window.Sync = {
    ready, getItem, setItem, removeItem, flush,
    onChange(fn) { listeners.push(fn); },
    status() {
      if (mode !== 'cloud') return { mode, label: '이 기기에만 저장', error: lastError };
      const dirty = Object.values(meta).some(m => m.dirty);
      return { mode, label: lastError ? '동기화 오류 · 다시 시도 중' : (pending || dirty) ? '저장 중…' : '모든 기기와 동기화됨', error: lastError };
    },
  };
})();
