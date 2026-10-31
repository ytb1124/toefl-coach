/* Sync: a localStorage-shaped key/value store that follows the learner across devices.
 *
 * Two cloud backends, picked automatically:
 *  - claude.ai viewer  → the `db` capability, in the viewer's private subtree (data/users/<id>/…).
 *                         No setup; any device signed in to claude.ai sees the same records.
 *  - anywhere else      → jsonbin.io (e.g. the GitHub Pages copy). Each device enters one "sync code"
 *                         once (it holds the jsonbin key and the bin ids); after that it syncs on its own.
 * Without either, values stay in this browser's localStorage.
 *
 * API: Sync.ready · getItem/setItem/removeItem · status() · onChange(fn) · flush() · Sync.jsonbin.*
 */
(function () {
  'use strict';
  const SYNCED = k => k === 'toeflcoach.v1' || k.startsWith('toefl-vocab') || k.startsWith('toefl-sw') || k.startsWith('toefl-listen') || k.startsWith('toefl-read');
  const META = 'sync:meta';            // this device: { key: {t, dirty} }
  const BIN_CFG = 'sync:jsonbin';      // this device: { k: key, b: {main, srs, meta, misc} }
  const mem = new Map();
  let meta = {};
  let mode = 'local', lastError = null;
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

  // Remote values ({key: {t, v}}) replace local ones only when newer than what this device has.
  function applyRemote(remote, fromLive) {
    const changed = [];
    for (const [k, r] of Object.entries(remote)) {
      if (!SYNCED(k)) continue;
      const local = meta[k];
      if (local && local.t >= r.t) continue;
      if (r.v == null) { mem.delete(k); ls.del(k); } else { mem.set(k, r.v); ls.set(k, r.v); }
      meta[k] = { t: r.t, dirty: false };
      changed.push(k);
    }
    if (changed.length) { saveMeta(); if (fromLive) changed.forEach(k => emit('remote', k)); }
    return changed;
  }
  function markUnsyncedLocalKeys() {
    for (const k of mem.keys()) if (SYNCED(k) && !meta[k]) meta[k] = { t: Date.now(), dirty: true };
    saveMeta();
  }
  const errText = e => (e && (e.code || e.message)) || String(e);

  // =====================================================================
  // Backend 1: claude.ai db
  // =====================================================================
  const CHUNK_CHARS = 60000;           // ≤ ~180 KB even for 3-byte UTF-8 text (doc limit 256 KiB)
  let col = null;
  const known = new Map();             // key -> number of chunk docs stored remotely
  const docId = (key, i) => key.replace(/[^A-Za-z0-9_.~:@+-]/g, '_') + '~' + i;
  function assembleDocs(docs) {
    const byKey = {};
    for (const d of docs) { const b = d.data(); if (b && typeof b.k === 'string') (byKey[b.k] = byKey[b.k] || []).push(b); }
    const out = {};
    for (const [k, parts] of Object.entries(byKey)) {
      const ts = [...new Set(parts.map(p => p.t))].sort((a, b) => b - a);   // newest complete write wins
      for (const t of ts) {
        const set = parts.filter(p => p.t === t).sort((a, b) => a.i - b.i);
        const n = set[0].n;
        if (n === 0) { out[k] = { t, v: null }; break; }
        if (set.length === n && set.every((p, i) => p.i === i)) { out[k] = { t, v: set.map(p => p.v).join('') }; break; }
      }
    }
    return out;
  }
  async function writeDb(keys) {
    for (const k of keys) {
      const m = meta[k]; if (!m || !m.dirty) continue;
      const t = m.t, v = mem.has(k) ? mem.get(k) : null;
      const parts = [];
      if (v != null) for (let i = 0; i < v.length; i += CHUNK_CHARS) parts.push(v.slice(i, i + CHUNK_CHARS));
      if (v === '') parts.push('');
      const n = parts.length;
      for (let i = 0; i < n; i++) await col.doc(docId(k, i)).set({ k, i, n, t, v: parts[i] });
      if (n === 0) await col.doc(docId(k, 0)).set({ k, i: 0, n: 0, t, v: '' });   // deletion marker
      const before = known.get(k) || 0;
      for (let i = Math.max(n, 1); i < before; i++) await col.doc(docId(k, i)).delete();
      known.set(k, Math.max(n, 1));
      if (meta[k] && meta[k].t === t) { meta[k].dirty = false; saveMeta(); }
    }
  }
  async function connectDb() {
    const claude = window.claude;
    if (!claude || typeof claude.use !== 'function') return false;
    const [d, u] = await Promise.all([claude.use('db'), claude.use('user')]);
    if (!d || !u) return false;
    const id = await u.id();
    if (!id) return false;
    col = d.collection('data/users/' + id);
    const snap = await col.get();
    snap.docs.forEach(doc => { const b = doc.data(); if (b && b.k) known.set(b.k, Math.max(known.get(b.k) || 0, (b.i || 0) + 1)); });
    applyRemote(assembleDocs(snap.docs), false);
    mode = 'cloud';
    markUnsyncedLocalKeys();
    col.onSnapshot(s => { if (!s.metadata.hasPendingWrites) applyRemote(assembleDocs(s.docs), true); }, e => { lastError = e.code; emit('status'); });
    return true;
  }

  // =====================================================================
  // Backend 2: jsonbin.io (free plan: 100 KB per request, so values are gzipped and split over 4 bins)
  // =====================================================================
  const API = 'https://api.jsonbin.io/v3/b';
  const BINS = ['main', 'srs', 'meta', 'misc'];
  const binFor = k => k === 'toeflcoach.v1' ? 'main' : k === 'toefl-vocab-srs-v5' ? 'srs' : k === 'toefl-vocab-word-meta-v1' ? 'meta' : 'misc';
  const LIMIT = 100 * 1024;
  let cfg = null;
  try { cfg = JSON.parse(ls.get(BIN_CFG) || 'null'); } catch (e) { cfg = null; }

  function b64(bytes) { let s = ''; for (let i = 0; i < bytes.length; i += 8192) s += String.fromCharCode(...bytes.subarray(i, i + 8192)); return btoa(s); }
  function unb64(str) { const s = atob(str), a = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) a[i] = s.charCodeAt(i); return a; }
  async function gzip(obj) {
    const bytes = new TextEncoder().encode(JSON.stringify(obj));
    if (typeof CompressionStream === 'undefined') return { v: 1, j: obj };
    const out = new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer());
    return { v: 1, z: b64(out) };
  }
  async function gunzip(rec) {
    if (!rec) return {};
    if (rec.j) return rec.j;
    if (typeof rec.z !== 'string') return {};
    const text = await new Response(new Blob([unb64(rec.z)]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
    return JSON.parse(text);
  }
  async function binError(res) {
    let msg = '';
    try { const j = await res.json(); msg = j.message || ''; } catch (e) { /* not json */ }
    const why = res.status === 401 ? '키가 올바르지 않습니다' : res.status === 404 ? '저장소(bin)를 찾을 수 없습니다' : res.status === 429 ? 'jsonbin 요청 한도에 걸렸습니다' : res.status === 403 ? '용량 또는 권한 문제입니다' : 'jsonbin 오류';
    const e = new Error(`${why} (${res.status}${msg ? ': ' + msg : ''})`); e.status = res.status; return e;
  }
  async function binGet(key, id) {
    const res = await fetch(`${API}/${id}/latest`, { headers: { 'X-Master-Key': key, 'X-Bin-Meta': 'false' } });
    if (!res.ok) throw await binError(res);
    return gunzip(await res.json());
  }
  async function binPayload(name) {
    const keys = {};
    for (const k of Object.keys(meta)) if (SYNCED(k) && binFor(k) === name) keys[k] = { t: meta[k].t, v: mem.has(k) ? mem.get(k) : null };
    const body = await gzip({ keys });
    const size = new Blob([JSON.stringify(body)]).size;
    if (size > LIMIT) { const e = new Error(`동기화할 기록이 jsonbin 무료 한도(100KB)를 넘었습니다 (${name}: ${Math.round(size / 1024)}KB)`); e.status = 413; throw e; }
    return body;
  }
  async function writeBins(keys, keepalive) {
    const names = [...new Set(keys.filter(k => meta[k] && meta[k].dirty).map(binFor))];
    for (const name of names) {
      const sent = Object.fromEntries(Object.keys(meta).filter(k => binFor(k) === name).map(k => [k, meta[k].t]));
      const body = JSON.stringify(await binPayload(name));
      const res = await fetch(`${API}/${cfg.b[name]}`, { method: 'PUT', keepalive: !!keepalive && body.length < 60000,
        headers: { 'Content-Type': 'application/json', 'X-Master-Key': cfg.k }, body });
      if (!res.ok) throw await binError(res);
      for (const [k, t] of Object.entries(sent)) if (meta[k] && meta[k].t === t) meta[k].dirty = false;
      saveMeta();
    }
  }
  let lastPull = 0;
  async function pullBins(fromLive) {
    const all = {};
    for (const name of BINS) Object.assign(all, (await binGet(cfg.k, cfg.b[name])).keys || {});
    lastPull = Date.now();
    return applyRemote(all, fromLive);
  }
  async function connectBins() {
    if (!cfg || !cfg.k || !cfg.b) return false;
    await pullBins(false);
    mode = 'jsonbin';
    markUnsyncedLocalKeys();
    document.addEventListener('visibilitychange', () => {
      // Coming back to this tab: pick up what another device saved meanwhile.
      if (document.visibilityState === 'visible' && Date.now() - lastPull > 30000 && !Object.values(meta).some(m => m.dirty)) {
        pullBins(true).catch(e => { lastError = errText(e); emit('status'); });
      }
    });
    return true;
  }

  // =====================================================================
  // writes: debounced, one at a time
  // =====================================================================
  let timer = null, chain = Promise.resolve(), pending = 0;
  const debounceMs = () => mode === 'jsonbin' ? 60000 : 1500;   // jsonbin: save requests, flush on leave
  function schedule() { clearTimeout(timer); timer = setTimeout(() => flush(), debounceMs()); }
  function flush(keepalive) {
    clearTimeout(timer);
    if (mode === 'local') return Promise.resolve();
    const dirty = Object.keys(meta).filter(k => meta[k].dirty);
    if (!dirty.length) return chain;
    pending++; emit('status');
    chain = chain.then(async () => {
      try {
        if (mode === 'cloud') await writeDb(dirty); else await writeBins(dirty, keepalive);
        lastError = null;
      } catch (e) {
        lastError = errText(e);
        console.error('sync write failed', e);
        if (!e.status || e.status === 429 || e.status >= 500 || e.code === 'unavailable') setTimeout(schedule, 8000 + Math.random() * 4000);
      }
    }).finally(() => { pending--; emit('status'); });
    return chain;
  }
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(true); });
  window.addEventListener('pagehide', () => flush(true));

  // =====================================================================
  // public
  // =====================================================================
  function setItem(k, v) {
    v = String(v);
    if (mem.get(k) === v) return;
    mem.set(k, v); ls.set(k, v);
    if (!SYNCED(k)) return;
    meta[k] = { t: Date.now(), dirty: true }; saveMeta();
    if (mode !== 'local') schedule();
  }
  function getItem(k) { return mem.has(k) ? mem.get(k) : (SYNCED(k) ? null : ls.get(k)); }
  function removeItem(k) {
    mem.delete(k); ls.del(k);
    if (!SYNCED(k)) return;
    meta[k] = { t: Date.now(), dirty: true }; saveMeta();
    if (mode !== 'local') schedule();
  }

  async function connect() {
    try {
      if (await connectDb()) { flush(); return; }
      if (await connectBins()) { flush(); return; }
    } catch (e) {
      lastError = errText(e);
      console.error('sync connect failed', e);
    }
  }
  const ready = Promise.race([connect(), new Promise(r => setTimeout(r, 12000))]).then(() => emit('status'));

  // ---------- jsonbin setup (one sync code per learner, entered once per device) ----------
  const CODE_PREFIX = 'TCSYNC1.';
  function encodeCode(c) { return CODE_PREFIX + btoa(unescape(encodeURIComponent(JSON.stringify({ k: c.k, b: c.b })))); }
  function decodeCode(code) {
    const s = String(code || '').trim();
    if (!s.startsWith(CODE_PREFIX)) throw new Error('동기화 코드 형식이 아닙니다 (TCSYNC1.으로 시작해야 합니다).');
    const c = JSON.parse(decodeURIComponent(escape(atob(s.slice(CODE_PREFIX.length)))));
    if (!c.k || !c.b || BINS.some(n => !c.b[n])) throw new Error('동기화 코드가 잘렸거나 손상되었습니다.');
    return c;
  }
  const jsonbin = {
    available: () => mode !== 'cloud',
    configured: () => !!cfg,
    code: () => cfg ? encodeCode(cfg) : null,
    // Existing sync code: check it can be read, save it, and reload so the page boots from the shared records.
    async connectWithCode(code) {
      const c = decodeCode(code);
      for (const name of BINS) await binGet(c.k, c.b[name]);
      // This device adopts the shared records: drop its own copies so nothing local (even a newer
      // timestamp from a blank start) can overwrite them on the first pull.
      for (const k of [...mem.keys()]) if (SYNCED(k)) { mem.delete(k); ls.del(k); }
      meta = {}; saveMeta();
      ls.set(BIN_CFG, JSON.stringify(c));
      return true;
    },
    // First device: create the 4 bins from this device's current records and return the sync code.
    async createWithKey(key) {
      key = String(key || '').trim();
      if (!key) throw new Error('jsonbin 키를 입력하세요.');
      markUnsyncedLocalKeys();
      const b = {};
      for (const name of BINS) {
        const body = JSON.stringify(await binPayload(name));
        const res = await fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Master-Key': key, 'X-Bin-Private': 'true', 'X-Bin-Name': 'toefl-coach-' + name }, body });
        if (!res.ok) throw await binError(res);
        b[name] = (await res.json()).metadata.id;
      }
      const c = { k: key, b };
      ls.set(BIN_CFG, JSON.stringify(c));
      for (const k of Object.keys(meta)) meta[k].dirty = false;
      saveMeta();
      return encodeCode(c);
    },
    disconnect() { ls.del(BIN_CFG); },
  };

  window.Sync = {
    ready, getItem, setItem, removeItem, flush, jsonbin,
    onChange(fn) { listeners.push(fn); },
    status() {
      const dirty = Object.values(meta).some(m => m.dirty);
      if (mode === 'local') return { mode, label: cfg ? '동기화 연결 실패 · 이 기기에만 저장' : '이 기기에만 저장', error: lastError };
      const where = mode === 'cloud' ? 'claude.ai' : 'jsonbin';
      const label = lastError ? '동기화 오류 · 다시 시도 중' : pending ? '저장 중…' : dirty ? '변경 사항 곧 저장' : '모든 기기와 동기화됨';
      return { mode, label, where, error: lastError };
    },
  };
})();
