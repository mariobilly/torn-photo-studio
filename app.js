(() => {
'use strict';

/* =========================================================================
   Torn Photo Studio
   Sequence of photos -> torn paper cutout + paper scan look -> PNG / ZIP / MP4 / GIF
   ========================================================================= */

const $ = id => document.getElementById(id);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const easeOut = t => 1 - Math.pow(1 - t, 3);
const easeInOut = t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const clone = o => JSON.parse(JSON.stringify(o));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const esc = s => String(s).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
const PREVIEW_LONG = 1200;
const M = 0.1; // overscan margin around the photo, so shifted strips never show an empty edge

/* ---------- settings ---------- */
const DEFAULTS = {
  frame: { aspect: '4:5', size: 1440, border: 0.05, zoom: 1 },
  bg: { type: 'paper', color: '#f4f2ec' },
  photo: { brightness: 0.02, contrast: 1.06, saturation: 1.05, warmth: 0.1 },
  scan: { on: true, opacity: 0.55, grain: 0.45, grainSize: 1.5, fibers: 0.4, stains: 0.35, custom: false },
  cut: {
    on: true, layout: 'grid', columns: 3, rows: 1, angle: 0, ripGap: 0.04, missing: 0, seed: 7, mix: false, mixFit: 'frame',
    rotation: 0.3, sizeVar: 0.35, widthVar: 0.33, heightVar: 0.22, uvShift: 0.15, colorVar: 0.35,
    tearSize: 0.2, chunkSize: 0.3, roughness: 1.92, whiteEdge: 0.04, unevenness: 0.43, direction: 0.75, core: 0.35,
    shadow: 0.25, edge: '#f7f5ef',
  },
  hole: { on: false, size: 0.3, x: 0.5, y: 0.5, ragged: 0.5 },
  motion: { boil: true, fps: 8, loop: 6, keys: [], wobble: 0.25 },
  text: { on: true, font: 'Anton', size: 0.1, color: '#ffd21f', pos: 'top', outline: 0.2, shadow: 0.35, label: false, labelColor: '#141210', onPaper: false, anim: 'stamp' },
  seq: { transition: 'strips', trDur: 0.7, kb: 0.06, exit: true, exitDur: 0.45, cover: null },
  music: { on: true, volume: 0.9, start: 0, bpm: 0, offset: 0, sync: false, beats: 4, onBeat: false, div: 1, bump: 0, fade: 1.5,
    tears: 'hits', sens: 0.5, punch: 0.5, spread: 0.3, shake: 0.2, flash: 0.15, pop: 0.5 },
};
const LOOK = ['frame', 'bg', 'photo', 'scan', 'cut', 'hole', 'motion', 'text'];

function merge(base, over) {
  const o = clone(base);
  if (!over || typeof over !== 'object') return o;
  for (const s in o) {
    if (!over[s] || typeof over[s] !== 'object') continue;
    for (const k in o[s]) if (k in over[s]) o[s][k] = Array.isArray(over[s][k]) ? over[s][k].slice() : over[s][k];
  }
  return o;
}

const PRESETS = [
  ['Torn strips', {}],
  ['Collage grid', { frame: { border: 0.07 }, cut: { columns: 3, rows: 3, rotation: 1.4, sizeVar: 0.55, widthVar: 0.25, heightVar: 0.25, uvShift: 0.3, whiteEdge: 0.07, tearSize: 0.35, shadow: 0.45 } }],
  ['Diagonal tear', { cut: { columns: 4, rows: 1, angle: 16, widthVar: 0.25, heightVar: 0.1, uvShift: 0.2, whiteEdge: 0.05, tearSize: 0.3 } }],
  ['Ripped in half', { cut: { layout: 'half', angle: -5, ripGap: 0.05, rotation: 0.6, tearSize: 0.7, chunkSize: 0.45, whiteEdge: 0.09, unevenness: 0.6, direction: 0.9, shadow: 0.45 } }],
  ['Torn hole', { cut: { columns: 1, rows: 1, rotation: 0, widthVar: 0, heightVar: 0, sizeVar: 0 }, hole: { on: true, size: 0.34, y: 0.56 } }],
  ['Shredded rows', { cut: { columns: 1, rows: 7, rotation: 0.35, widthVar: 0.12, heightVar: 0.3, uvShift: 0.22, whiteEdge: 0.035, tearSize: 0.15, roughness: 2.4 } }],
  ['Cork board scrap', { frame: { border: 0.12 }, bg: { type: 'cork' }, cut: { columns: 2, rows: 2, rotation: 2.6, sizeVar: 0.8, widthVar: 0.5, heightVar: 0.5, uvShift: 0.4, whiteEdge: 0.12, unevenness: 0.7, tearSize: 0.75, chunkSize: 0.55, shadow: 0.6, colorVar: 0.5 } }],
  ['Cardboard zine', { frame: { border: 0.1 }, bg: { type: 'cardboard' }, cut: { columns: 3, rows: 2, rotation: 1.2, uvShift: 0.25, whiteEdge: 0.06, shadow: 0.5 }, text: { label: true, color: '#141210', labelColor: '#ffd21f', outline: 0, shadow: 0 } }],
  ['Dark desk', { frame: { border: 0.14 }, bg: { type: 'desk' }, scan: { opacity: 0.35 }, cut: { rotation: 1.5, shadow: 0.8, whiteEdge: 0.05 } }],
  ['Missing pieces', { cut: { columns: 5, rows: 4, missing: 0.14, rotation: 0.8, uvShift: 0.2, whiteEdge: 0.05, tearSize: 0.3 } }],
  ['Clean scan', { cut: { on: false }, frame: { border: 0.08 } }],
];

const store = {
  get(k) { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* storage unavailable */ } },
};
let G = merge(DEFAULTS, store.get('torn-settings-v2'));
if (G.music.onBeat && G.music.tears === 'hits') { G.music.tears = 'beat'; G.music.onBeat = false; }
let S = G;
function composeS(look) { const o = Object.assign({}, G); for (const k of LOOK) if (look[k]) o[k] = look[k]; return o; }
const lookFor = k => (clips[k] && clips[k].look ? composeS(clips[k].look) : G);
const editS = () => lookFor(sel);
let userPresets = store.get('torn-user-presets') || {};

/* ---------- noise ---------- */
function hash(n, s) {
  let h = Math.imul(n | 0, 0x27d4eb2d) ^ Math.imul(s | 0, 0x165667b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function ikey(...a) { let h = 0x811c9dc5; for (const v of a) h = Math.imul(h ^ (v | 0), 16777619); return h >>> 0; }
function vnoise(s, x) { const i = Math.floor(x), f = x - i, u = f * f * (3 - 2 * f); return (hash(i, s) * (1 - u) + hash(i + 1, s) * u) * 2 - 1; }
function fbm(s, x, oct) { let a = 1, sum = 0, n = 0, fr = 1; for (let o = 0; o < oct; o++) { sum += a * vnoise(s + o * 1013, x * fr); n += a; a *= 0.5; fr *= 2.07; } return sum / n; }
function rng(seed) { let t = (seed >>> 0) + 0x9e3779b9; return () => { t += 0x6d2b79f5; let r = Math.imul(t ^ (t >>> 15), 1 | t); r ^= r + Math.imul(r ^ (r >>> 7), 61 | r); return ((r ^ (r >>> 14)) >>> 0) / 4294967296; }; }

/* ---------- clips ---------- */
// media: id -> { img, blob, thumb, sample }
const media = new Map();
let clips = []; // { id, name, dur, caption, seed, sample }
let sel = 0;

function makeSample(v) {
  const c = document.createElement('canvas'); c.width = 1200; c.height = 1500;
  const x = c.getContext('2d');
  const grad = (stops, y1 = 1500) => { const g = x.createLinearGradient(0, 0, 0, y1); stops.forEach(([p, col]) => g.addColorStop(p, col)); return g; };
  if (v === 0) {
    x.fillStyle = grad([[0, '#2f6fb2'], [0.55, '#7fb6de'], [1, '#c9e2f0']]); x.fillRect(0, 0, 1200, 1500);
    const g = x.createRadialGradient(760, 620, 20, 760, 620, 330);
    g.addColorStop(0, '#fff3c4'); g.addColorStop(0.45, '#ffc861'); g.addColorStop(1, 'rgba(255,170,70,0)');
    x.fillStyle = g; x.fillRect(0, 0, 1200, 1500);
    x.fillStyle = '#ffb347'; x.beginPath(); x.arc(760, 620, 170, 0, Math.PI * 2); x.fill();
    x.fillStyle = 'rgba(255,255,255,.35)';
    for (let i = 0; i < 6; i++) x.fillRect(560, 670 + i * 24, 400, 8 + i * 2);
    [['#e0578a', 950, 140], ['#b83b6d', 1060, 110], ['#6a2350', 1180, 90], ['#2a1233', 1320, 70]].forEach(([col, base, amp], k) => {
      x.fillStyle = col; x.beginPath(); x.moveTo(0, 1500);
      for (let px = 0; px <= 1200; px += 10) x.lineTo(px, base - amp * (0.6 + 0.4 * Math.sin(px / (160 + k * 50) + k * 2)) - 40 * Math.sin(px / 57 + k));
      x.lineTo(1200, 1500); x.fill();
    });
    x.fillStyle = '#fdf6e3'; x.font = '500 34px "JetBrains Mono", Consolas, monospace'; x.textBaseline = 'top';
    x.fillText('ROLL 07 · FRAME 12', 150, 1420);
  } else if (v === 1) {
    x.fillStyle = grad([[0, '#0b1030'], [0.6, '#2b1b5a'], [1, '#ff5e7e']]); x.fillRect(0, 0, 1200, 1500);
    x.fillStyle = '#fff2d6'; x.beginPath(); x.arc(860, 330, 110, 0, Math.PI * 2); x.fill();
    x.fillStyle = '#2b1b5a'; x.beginPath(); x.arc(905, 300, 100, 0, Math.PI * 2); x.fill();
    const R = rng(3);
    for (let i = 0; i < 90; i++) { x.fillStyle = `rgba(255,255,255,${0.3 + R() * 0.6})`; x.fillRect(R() * 1200, R() * 700, 3, 3); }
    let px = 0;
    while (px < 1200) {
      const w = 80 + R() * 110, h = 260 + R() * 520;
      x.fillStyle = '#120c26'; x.fillRect(px, 1180 - h, w, h + 400);
      for (let wy = 1180 - h + 20; wy < 1160; wy += 34) for (let wx = px + 12; wx < px + w - 18; wx += 26) if (R() < 0.45) { x.fillStyle = R() < 0.7 ? '#ffd27a' : '#7ae2ff'; x.fillRect(wx, wy, 12, 16); }
      px += w + 6;
    }
    x.fillStyle = '#1a1033'; x.fillRect(0, 1180, 1200, 320);
    x.fillStyle = '#ff5e7e'; for (let i = 0; i < 7; i++) x.fillRect(560 - i * 18, 1200 + i * 44, 80 + i * 36, 12 + i * 3);
  } else {
    x.fillStyle = grad([[0, '#f6a04d'], [1, '#e2552d']]); x.fillRect(0, 0, 1200, 1500);
    x.fillStyle = '#1f6f6b'; x.fillRect(0, 980, 1200, 520);
    x.save(); x.translate(600, 700);
    x.fillStyle = '#16120f'; x.beginPath(); x.arc(0, 0, 430, 0, Math.PI * 2); x.fill();
    x.strokeStyle = 'rgba(255,255,255,.08)'; x.lineWidth = 2;
    for (let r = 160; r < 420; r += 9) { x.beginPath(); x.arc(0, 0, r, 0, Math.PI * 2); x.stroke(); }
    x.fillStyle = '#f2d15c'; x.beginPath(); x.arc(0, 0, 140, 0, Math.PI * 2); x.fill();
    x.fillStyle = '#16120f'; x.beginPath(); x.arc(0, 0, 14, 0, Math.PI * 2); x.fill();
    x.fillStyle = '#16120f'; x.font = '84px Anton, Impact, sans-serif'; x.textAlign = 'center'; x.fillText('SIDE B', 0, -30);
    x.restore();
    x.fillStyle = '#fdf6e3'; x.font = '500 40px "JetBrains Mono", Consolas, monospace'; x.textBaseline = 'top';
    x.fillText('SAMPLE — ADD YOUR OWN PHOTOS', 150, 1300);
  }
  return c;
}
const SAMPLE_CAPTIONS = ['Torn photo effect', 'Made right in the browser', ''];

function makeThumb(img) {
  const c = document.createElement('canvas'); c.width = 128; c.height = 160;
  const x = c.getContext('2d');
  const sw = img.naturalWidth || img.width, sh = img.naturalHeight || img.height;
  const sc = Math.max(128 / sw, 160 / sh);
  x.drawImage(img, (128 - sw * sc) / 2, (160 - sh * sc) / 2, sw * sc, sh * sc);
  return c.toDataURL('image/jpeg', 0.8);
}
function loadImage(blob) {
  return new Promise((res, rej) => {
    const url = URL.createObjectURL(blob);
    const im = new Image();
    im.onload = () => res(im);
    im.onerror = () => { URL.revokeObjectURL(url); rej(new Error('unreadable')); };
    im.src = url;
  });
}
function sampleClips() {
  return [0, 1, 2].map(v => {
    const id = 'sample-' + v;
    const img = makeSample(v);
    media.set(id, { img, blob: null, thumb: makeThumb(img), sample: v });
    return normClip({ id, name: ['Sunset poster', 'Night city', 'Side B'][v], dur: 3, caption: SAMPLE_CAPTIONS[v], seed: v * 97, sample: v });
  });
}
const img = c => media.get(c.id)?.img;
const CLIP_DEFAULTS = { name: 'Photo', dur: 3, beats: 4, caption: '', seed: 0, sample: null, fx: 0.5, fy: 0.5, zoom: 1 };
const normClip = m => ({ ...CLIP_DEFAULTS, ...m, look: m.look ? lookOf(merge(DEFAULTS, m.look)) : null, dur: clamp(+m.dur || 3, 0.5, 10), beats: clamp(Math.round(+m.beats || 4), 1, 64), seed: m.seed | 0 });

/* ---------- persistence (IndexedDB for photos, localStorage for the rest) ---------- */
let idb = null;
function openIDB() {
  return new Promise(res => {
    try {
      const rq = indexedDB.open('torn-studio', 1);
      rq.onupgradeneeded = () => rq.result.createObjectStore('blobs');
      rq.onsuccess = () => res(rq.result);
      rq.onerror = () => res(null);
    } catch (e) { res(null); }
  });
}
function idbDo(mode, fn) {
  return new Promise(res => {
    if (!idb) return res(null);
    try {
      const tx = idb.transaction('blobs', mode), os = tx.objectStore('blobs');
      const rq = fn(os);
      tx.oncomplete = () => res(rq ? rq.result : null);
      tx.onerror = () => res(null);
    } catch (e) { res(null); }
  });
}
let persistTimer;
function persistClips() {
  clearTimeout(persistTimer);
  persistTimer = setTimeout(async () => {
    store.set('torn-clips-v2', { clips: clips.map(c => ({ ...c })), sel });
    if (!idb) return;
    const keys = (await idbDo('readonly', os => os.getAllKeys())) || [];
    const want = new Set(clips.filter(c => c.sample == null).map(c => c.id));
    for (const id of want) if (!keys.includes(id)) { const m = media.get(id); if (m && m.blob) await idbDo('readwrite', os => os.put(m.blob, id)); }
    for (const k of keys) if (!want.has(k) && !String(k).startsWith('__')) await idbDo('readwrite', os => os.delete(k));
  }, 500);
}
async function restoreClips() {
  const saved = store.get('torn-clips-v2');
  if (!saved || !Array.isArray(saved.clips) || !saved.clips.length) return false;
  const out = [];
  for (const m of saved.clips) {
    if (m.sample != null) { if (media.has('sample-' + m.sample)) out.push({ ...m, id: 'sample-' + m.sample }); continue; }
    const blob = await idbDo('readonly', os => os.get(m.id));
    if (!blob) continue;
    try { const im = await loadImage(blob); media.set(m.id, { img: im, blob, thumb: makeThumb(im), sample: null }); out.push(m); } catch (e) { /* skip unreadable */ }
  }
  if (!out.length) return false;
  clips = out.map(normClip);
  sel = clamp(saved.sel | 0, 0, clips.length - 1);
  return true;
}

/* ---------- geometry ---------- */
function aspectRatio() {
  if (G.frame.aspect === 'photo') {
    const im = clips[0] && img(clips[0]);
    return im ? (im.naturalWidth || im.width) / (im.naturalHeight || im.height) : 0.8;
  }
  const [a, b] = G.frame.aspect.split(':').map(Number);
  return a / b;
}
function dims(n, mode = 'long') {
  const ar = aspectRatio();
  let W, H;
  if ((mode === 'long') === (ar >= 1)) { W = n; H = n / ar; } else { H = n; W = n * ar; }
  return [Math.max(2, Math.round(W / 2) * 2), Math.max(2, Math.round(H / 2) * 2)];
}
function photoRect(W, H) {
  const b = Math.round(S.frame.border * Math.min(W, H));
  return { x: b, y: b, w: W - 2 * b, h: H - 2 * b };
}

/* ---------- caches ---------- */
function lru(map, key, make, max) {
  let v = map.get(key);
  if (v) { map.delete(key); map.set(key, v); return v; }
  v = make(); map.set(key, v);
  while (map.size > max) map.delete(map.keys().next().value);
  return v;
}
const photoCache = new Map(), texCache = new Map(), bgCache = new Map();
let customBg = null, customTex = null, customBgId = 0, customTexId = 0;

function lruPhoto(key, make, max) {
  const v = make(); photoCache.set(key, v);
  while (photoCache.size > max) photoCache.delete(photoCache.keys().next().value);
  return v;
}
function getPhoto(clip, P) {
  const p = S.photo, im = img(clip);
  const key = [clip.id, P.w, P.h, S.frame.zoom, clip.zoom, clip.fx, clip.fy, p.brightness, p.contrast, p.saturation, p.warmth].join('|');
  const hit = photoCache.get(key);
  if (hit) { photoCache.delete(key); photoCache.set(key, hit); return hit; }
  const made = lruPhoto(key, () => {
    const mx = Math.round(P.w * M), my = Math.round(P.h * M);
    const w = P.w + 2 * mx, h = P.h + 2 * my;
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const x = c.getContext('2d', { willReadFrequently: true });
    const sw = im.naturalWidth || im.width, sh = im.naturalHeight || im.height;
    const sc = Math.max(w / sw, h / sh) * S.frame.zoom * (clip.zoom || 1);
    x.imageSmoothingQuality = 'high';
    x.drawImage(im, (w - sw * sc) * (clip.fx ?? 0.5), (h - sh * sc) * (clip.fy ?? 0.5), sw * sc, sh * sc);
    const { brightness: b, contrast: k, saturation: sa, warmth: wa } = p;
    if (b !== 0 || k !== 1 || sa !== 1 || wa !== 0) {
      const id = x.getImageData(0, 0, w, h), d = id.data;
      const off = 128 * (1 - k) + b * 255, wr = wa * 14, wb = -wa * 16;
      for (let i = 0; i < d.length; i += 4) {
        let R = d[i], G = d[i + 1], B = d[i + 2];
        const l = 0.299 * R + 0.587 * G + 0.114 * B;
        R = l + (R - l) * sa; G = l + (G - l) * sa; B = l + (B - l) * sa;
        d[i] = R * k + off + wr; d[i + 1] = G * k + off; d[i + 2] = B * k + off + wb;
      }
      x.putImageData(id, 0, 0);
    }
    return c;
  }, 40);
  // keep memory bounded: drop the oldest photos while the cache holds more than ~80 megapixels
  let px = 0; for (const c of photoCache.values()) px += c.width * c.height;
  for (const k of photoCache.keys()) { if (px <= 8e7 || photoCache.size <= 2) break; const c = photoCache.get(k); px -= c.width * c.height; photoCache.delete(k); }
  return made;
}

function getTexture(W, H, U) {
  const s = S.scan, useCustom = s.custom && customTex;
  const key = [W, H, useCustom ? 'c' + customTexId : '', s.grain, s.grainSize, s.fibers, s.stains].join('|');
  return lru(texCache, key, () => {
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const x = c.getContext('2d', { willReadFrequently: true });
    if (useCustom) {
      const sw = customTex.naturalWidth, sh = customTex.naturalHeight, sc = Math.max(W / sw, H / sh);
      x.drawImage(customTex, (W - sw * sc) / 2, (H - sh * sc) / 2, sw * sc, sh * sc);
      const id = x.getImageData(0, 0, W, H), d = id.data;
      let mean = 0;
      for (let i = 0; i < d.length; i += 4) mean += 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      mean /= d.length / 4;
      for (let i = 0; i < d.length; i += 4) { const v = 128 + (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2] - mean) * 1.3; d[i] = d[i + 1] = d[i + 2] = v; }
      x.putImageData(id, 0, 0);
      return c;
    }
    x.fillStyle = 'rgb(128,128,128)'; x.fillRect(0, 0, W, H);
    const gw = Math.ceil(W / s.grainSize), gh = Math.ceil(H / s.grainSize);
    const g = document.createElement('canvas'); g.width = gw; g.height = gh;
    const gx = g.getContext('2d'), id = gx.createImageData(gw, gh), d = id.data, amp = s.grain * 90;
    for (let i = 0; i < d.length; i += 4) { const v = 128 + (Math.random() + Math.random() - 1) * amp; d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = 255; }
    gx.putImageData(id, 0, 0);
    x.imageSmoothingEnabled = s.grainSize > 1; x.drawImage(g, 0, 0, W, H);
    const R = rng(4242);
    const n = Math.round(10 + s.stains * 30);
    for (let i = 0; i < n; i++) {
      const cx = R() * W, cy = R() * H, rad = (60 + R() * 380) * U, light = R() < 0.5, a = s.stains * (0.06 + R() * 0.12);
      const gr = x.createRadialGradient(cx, cy, 0, cx, cy, rad);
      gr.addColorStop(0, light ? `rgba(255,255,255,${a})` : `rgba(60,40,20,${a})`);
      gr.addColorStop(1, 'rgba(128,128,128,0)');
      x.fillStyle = gr; x.fillRect(cx - rad, cy - rad, rad * 2, rad * 2);
    }
    const vg = x.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.hypot(W, H) * 0.6);
    vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, `rgba(40,30,20,${s.stains * 0.35})`);
    x.fillStyle = vg; x.fillRect(0, 0, W, H);
    const fn = Math.round(s.fibers * 900 * (W * H) / 2e6);
    x.lineCap = 'round';
    for (let i = 0; i < fn; i++) {
      const px = R() * W, py = R() * H, len = (8 + R() * 50) * U, a = R() * Math.PI * 2;
      x.strokeStyle = R() < 0.6 ? `rgba(255,255,255,${0.15 + R() * 0.3})` : `rgba(30,20,10,${0.08 + R() * 0.15})`;
      x.lineWidth = (0.4 + R() * 0.9) * U;
      x.beginPath(); x.moveTo(px, py);
      x.quadraticCurveTo(px + Math.cos(a + 0.8) * len * 0.5, py + Math.sin(a + 0.8) * len * 0.5, px + Math.cos(a) * len, py + Math.sin(a) * len);
      x.stroke();
    }
    return c;
  }, 3);
}

function getBackground(W, H, U) {
  const b = S.bg;
  const key = [W, H, b.type, b.color, b.type === 'custom' ? customBgId : 0].join('|');
  return lru(bgCache, key, () => {
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const x = c.getContext('2d');
    const R = rng(99);
    const specks = (n, colors, rMin, rMax) => { for (let i = 0; i < n; i++) { x.fillStyle = colors[(R() * colors.length) | 0]; x.beginPath(); x.arc(R() * W, R() * H, (rMin + R() * (rMax - rMin)) * U, 0, Math.PI * 2); x.fill(); } };
    const blotches = (n, light, dark, rMax) => {
      for (let i = 0; i < n; i++) {
        const cx = R() * W, cy = R() * H, rad = (80 + R() * rMax) * U, g = x.createRadialGradient(cx, cy, 0, cx, cy, rad);
        g.addColorStop(0, R() < 0.5 ? light : dark); g.addColorStop(1, 'rgba(0,0,0,0)');
        x.fillStyle = g; x.fillRect(cx - rad, cy - rad, rad * 2, rad * 2);
      }
    };
    switch (b.type) {
      case 'cardboard': {
        x.fillStyle = '#b88d5c'; x.fillRect(0, 0, W, H);
        blotches(30, 'rgba(255,230,190,.12)', 'rgba(90,55,20,.12)', 300);
        for (let px = 0; px < W; px += 16 * U) { x.fillStyle = 'rgba(70,40,10,.05)'; x.fillRect(px, 0, 8 * U, H); }
        x.lineCap = 'round';
        for (let i = 0; i < W * H / 900; i++) { x.strokeStyle = R() < 0.5 ? 'rgba(80,50,20,.18)' : 'rgba(240,210,160,.18)'; x.lineWidth = 0.8 * U; const px = R() * W, py = R() * H, a = R() * Math.PI; x.beginPath(); x.moveTo(px, py); x.lineTo(px + Math.cos(a) * 12 * U, py + Math.sin(a) * 12 * U); x.stroke(); }
        break;
      }
      case 'cork':
        x.fillStyle = '#b5854f'; x.fillRect(0, 0, W, H);
        blotches(24, 'rgba(255,220,170,.12)', 'rgba(80,45,15,.14)', 250);
        specks(W * H / 60, ['#8a5a2b', '#6d4420', '#d4a56a', '#c49058', '#9c6a37'], 0.6, 3.2);
        break;
      case 'concrete':
        x.fillStyle = '#9d9b95'; x.fillRect(0, 0, W, H);
        blotches(45, 'rgba(255,255,255,.14)', 'rgba(40,40,40,.14)', 420);
        specks(W * H / 300, ['rgba(40,40,40,.5)', 'rgba(255,255,255,.35)', 'rgba(70,70,65,.4)'], 0.4, 2);
        break;
      case 'desk': {
        x.fillStyle = '#2a201a'; x.fillRect(0, 0, W, H);
        for (let i = 0; i < 260; i++) {
          const y0 = R() * H, a = (2 + R() * 10) * U, f = 200 + R() * 500;
          x.strokeStyle = R() < 0.5 ? `rgba(90,65,45,${0.15 + R() * 0.25})` : `rgba(10,6,4,${0.2 + R() * 0.3})`;
          x.lineWidth = (0.6 + R() * 2.5) * U;
          x.beginPath();
          for (let px = 0; px <= W; px += 12 * U) { const yy = y0 + Math.sin(px / (f * U) + i) * a; px ? x.lineTo(px, yy) : x.moveTo(px, yy); }
          x.stroke();
        }
        const vg = x.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.2, W / 2, H / 2, Math.hypot(W, H) * 0.65);
        vg.addColorStop(0, 'rgba(255,220,170,.08)'); vg.addColorStop(1, 'rgba(0,0,0,.55)');
        x.fillStyle = vg; x.fillRect(0, 0, W, H);
        break;
      }
      case 'custom':
        if (customBg) {
          const sw = customBg.naturalWidth, sh = customBg.naturalHeight, sc = Math.max(W / sw, H / sh);
          x.drawImage(customBg, (W - sw * sc) / 2, (H - sh * sc) / 2, sw * sc, sh * sc);
          break;
        }
      // falls through to paper when no image is chosen yet
      default:
        x.fillStyle = b.color; x.fillRect(0, 0, W, H);
    }
    return c;
  }, 3);
}

/* ---------- pieces ---------- */
function seedFor(k, f) {
  const m = S.motion, base = clips[k] ? clips[k].seed : 0;
  let s = S.cut.seed;
  const md = (a, n) => ((a % n) + n) % n;
  if (m.boil || (song && G.music.on && G.music.tears !== 'rate')) s = m.keys.length ? m.keys[md(f, m.keys.length)] : S.cut.seed + (m.loop > 0 ? md(f, m.loop) : f) * 101;
  return (s + base) >>> 0;
}
function frameAt(t) {
  if (song && G.music.on && G.music.tears === 'hits') return lastHitIndex(G.music.start + t) + 1;
  if (song && G.music.on && G.music.tears === 'beat') return Math.floor((G.music.start + t - beatPhase()) / spb() * G.music.div + 1e-6);
  return Math.floor(t * G.motion.fps + 1e-6);
}

function buildPieces(P, seed, f, H, U, intro, k, exit, react) {
  const c = S.cut;
  const C = { x: P.x + P.w / 2, y: P.y + P.h / 2 };
  const introAt = (idx, n, rnd) => {
    if (intro == null) return { dy: 0, da: 0, alpha: 1 };
    const st = n > 1 ? (idx / (n - 1)) * 0.55 : 0;
    const e = clamp((intro - st) / 0.45, 0, 1), ee = easeOut(e);
    return { dy: -(1 - ee) * H * 0.14, da: (1 - ee) * 0.12 * (rnd - 0.5) * 2, alpha: clamp(e * 2.5, 0, 1) };
  };
  const exitAt = (idx, n, qx) => {
    if (exit == null) return { dx: 0, dy: 0, da: 0, alpha: 1 };
    const st = n > 1 ? (idx / (n - 1)) * 0.35 : 0;
    const q = clamp((exit - st) / 0.65, 0, 1), e = q * q, r1 = hash(idx, 901 + k), r2 = hash(idx, 902 + k);
    return {
      dx: (qx >= 0 ? 1 : -1) * (0.3 + r1) * P.w * 0.35 * e,
      dy: (0.4 + r2) * H * 0.55 * e - q * (1 - q) * H * 0.12,
      da: (r1 - 0.5) * 1.3 * e,
      alpha: 1 - clamp((q - 0.55) / 0.45, 0, 1),
    };
  };
  if (!c.on) {
    const ia = introAt(0, 1, 0.5), ex = exitAt(0, 1, 0);
    const pc0 = { x: C.x, y: C.y };
    return [{ flat: true, pc0, pc: { x: C.x + ex.dx, y: C.y + ia.dy + ex.dy }, ang: ia.da + ex.da, aj: ia.da + ex.da, s: 1, hw: P.w / 2, hh: P.h / 2, q: { x: 0, y: 0 }, edges: [], ux: 0, uy: 0, src: k, alpha: ia.alpha * ex.alpha }];
  }
  const R = rng(seed * 7919 + 13), rs = () => (R() - 0.5) * 2;
  const WR = rng(ikey(f, 4242)), ws = () => (WR() - 0.5) * 2;
  const IR = rng(ikey(seed, 555));
  const half = c.layout === 'half';
  const cols = half ? 2 : c.columns, rows = half ? 1 : c.rows;
  const th = c.angle * Math.PI / 180, ct = Math.cos(th), st = Math.sin(th);
  const Ex = Math.abs(P.w * ct) + Math.abs(P.h * st), Ey = Math.abs(P.w * st) + Math.abs(P.h * ct);
  const cw = Ex / cols, ch = Ey / rows, n = cols * rows;
  const wob = S.motion.wobble;
  const edgeInfo = (key, sgn, big) => {
    const fibLow = hash(key, 99) < 0.5;
    const isFib = (sgn > 0) === fibLow;
    return { key, sgn, big, wm: isFib ? 1 : 1 - c.direction * 0.9 };
  };
  const out = [];
  let idx = 0;
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++, idx++) {
    let x0 = -Ex / 2 + i * cw, x1 = x0 + cw, y0 = -Ey / 2 + j * ch, y1 = y0 + ch;
    const wv = c.widthVar * 0.16, hv = c.heightVar * 0.16;
    x0 += rs() * wv * cw; x1 += rs() * wv * cw;
    y0 += rs() * hv * ch; y1 += rs() * hv * ch;
    const gx = -Ex / 2 + (i + 0.5) * cw, gy = -Ey / 2 + (j + 0.5) * ch;
    const cell = { x: Math.round(C.x + gx * ct - gy * st - cw / 2), y: Math.round(C.y + gx * st + gy * ct - ch / 2), w: Math.round(cw), h: Math.round(ch) };
    let qx = (x0 + x1) / 2, qy = (y0 + y1) / 2;
    const hw = Math.abs(x1 - x0) / 2, hh = Math.abs(y1 - y0) / 2;
    let aj = rs() * c.rotation * Math.PI / 180;
    const s = 1 + rs() * c.sizeVar * 0.06;
    const ux = rs() * c.uvShift * 0.06 * P.w, uy = rs() * c.uvShift * 0.06 * P.h;
    const hue = R() * 360, lum = R() - 0.5, amt = 0.3 + R() * 0.7, z = R();
    const gone = !half && R() < c.missing;
    const edges = [
      edgeInfo(ikey(seed, 2, j, i), -1, false),
      edgeInfo(ikey(seed, 1, i + 1, j), 1, half && i === 0),
      edgeInfo(ikey(seed, 2, j + 1, i), 1, false),
      edgeInfo(ikey(seed, 1, i, j), -1, half && i === 1),
    ];
    // wobble and intro use their own streams so they never shift the layout
    const wdx = ws() * wob * 5 * U, wdy = ws() * wob * 5 * U, wda = ws() * wob * 0.5 * Math.PI / 180;
    const ia = introAt(idx, n, IR());
    if (gone) continue;
    if (half) { const sd = i === 0 ? -1 : 1; qx += sd * c.ripGap * Ex * 0.5; aj += sd * c.ripGap * 0.35; }
    const pc0 = { x: C.x + qx * ct - qy * st, y: C.y + qx * st + qy * ct };
    const ex = exitAt(idx, n, qx);
    let rdx = 0, rdy = 0, rda = 0;
    if (react) {
      const RR = rng(ikey(react.tick, idx, 313)), sh = react.shake;
      rdx = (RR() - 0.5) * 2 * sh * 14 * U; rdy = (RR() - 0.5) * 2 * sh * 14 * U; rda = (RR() - 0.5) * 2 * sh * 1.5 * Math.PI / 180;
      const nx = qx / (Ex / 2), ny = qy / (Ey / 2), sp = react.spread;
      rdx += (nx * ct - ny * st) * sp * P.w * 0.05; rdy += (nx * st + ny * ct) * sp * P.h * 0.05;
    }
    const ajT = aj + wda + ia.da + ex.da + rda;
    out.push({
      pc0, pc: { x: pc0.x + wdx + ex.dx + rdx, y: pc0.y + wdy + ia.dy + ex.dy + rdy }, ang: th + ajT, aj: ajT, s, hw, hh, q: { x: qx, y: qy },
      edges, ux, uy, hue, lum, amt, z, alpha: ia.alpha * ex.alpha,
      src: c.mix && clips.length > 1 ? (k + idx) % clips.length : k, cell,
    });
  }
  return out.sort((a, b) => a.z - b.z);
}

function pieceGeom(p, U) {
  const cs = Math.cos(p.ang) * p.s, sn = Math.sin(p.ang) * p.s, hw = p.hw, hh = p.hh;
  const T = (lx, ly, arr) => arr.push(p.pc.x + lx * cs - ly * sn, p.pc.y + lx * sn + ly * cs);
  if (p.flat) { const r = []; T(-hw, -hh, r); T(hw, -hh, r); T(hw, hh, r); T(-hw, hh, r); return { outer: r, inner: r, mid: r, fib: [] }; }
  const c = S.cut;
  const step = Math.max(1.2, 1.8 * U);
  const tearWl = (25 + c.chunkSize * 300) * U, roughWl = 4.5 * U, wWl = 35 * U;
  const roughAmp = c.roughness * 1.3 * U, whiteBase = c.whiteEdge * 90 * U;
  const outer = [], inner = [], mid = [], fib = [];
  const corners = [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]];
  const NR = [[0, -1], [1, 0], [0, 1], [-1, 0]];
  const FR = rng(p.edges[0].key ^ 0x5bd1e995);
  for (let e = 0; e < 4; e++) {
    const [ax, ay] = corners[e], [bx, by] = corners[(e + 1) % 4], [nx, ny] = NR[e];
    const E = p.edges[e], horiz = e % 2 === 0;
    const tearAmp = c.tearSize * 16 * U * (E.big ? 3.2 : 1), wl = E.big ? tearWl * 1.6 : tearWl;
    const len = Math.hypot(bx - ax, by - ay), n = Math.max(2, Math.ceil(len / step));
    const salt = E.sgn > 0 ? 17 : 29;
    for (let i = 0; i < n; i++) {
      const t = i / n, lx = ax + (bx - ax) * t, ly = ay + (by - ay) * t;
      const u = horiz ? p.q.x + lx : p.q.y + ly; // grid coordinate: neighbours share the same tear shape
      const D = fbm(E.key, u / wl, 3) * tearAmp + fbm(E.key + 1, u / roughWl, 3) * roughAmp;
      const o = D * E.sgn;
      const w = whiteBase * E.wm * Math.max(0, 1 + c.unevenness * 1.8 * fbm(E.key + salt, u / wWl, 2));
      const ri = Math.abs(fbm(E.key + salt + 2, u / roughWl, 2)) * roughAmp * 0.5;
      const iD = o - w - ri, mD = iD + w * c.core * 0.5;
      T(lx + nx * o, ly + ny * o, outer);
      T(lx + nx * iD, ly + ny * iD, inner);
      T(lx + nx * mD, ly + ny * mD, mid);
      if (c.roughness > 0 && FR() < 0.045 * c.roughness * E.wm) {
        const L = (1 + FR() * 4) * U * (0.5 + c.roughness * 0.4), sk = (FR() - 0.5) * 1.2;
        T(lx + nx * o, ly + ny * o, fib);
        T(lx + nx * (o + L) + ny * sk * L, ly + ny * (o + L) - nx * sk * L, fib);
      }
    }
  }
  return { outer, inner, mid, fib };
}

function buildHole(P, seed, U) {
  const h = S.hole, c = S.cut, key = ikey(seed, 77);
  const cx = P.x + h.x * P.w, cy = P.y + h.y * P.h, r = h.size * Math.min(P.w, P.h) / 2;
  const n = Math.max(120, Math.round(2 * Math.PI * r / (1.8 * U)));
  const N1 = 5 + Math.round(h.ragged * 8), N2 = Math.max(8, Math.round(2 * Math.PI * r / (4.5 * U)));
  const per = (s, t, N, oct) => fbm(s, t * N, oct) * (1 - t) + fbm(s, t * N - N, oct) * t; // loops seamlessly
  const white = Math.max(2 * U, c.whiteEdge * 110 * U);
  const core = [], rim = [];
  for (let i = 0; i < n; i++) {
    const t = i / n, a = t * Math.PI * 2;
    const rc = r * (1 + per(key, t, N1, 3) * h.ragged * 0.4) + per(key + 1, t, N2, 2) * c.roughness * 1.3 * U;
    const w = white * Math.max(0.15, 1 + c.unevenness * 1.5 * per(key + 3, t, N1 * 2, 2));
    core.push(cx + Math.cos(a) * rc, cy + Math.sin(a) * rc);
    rim.push(cx + Math.cos(a) * (rc + w), cy + Math.sin(a) * (rc + w));
  }
  return { core, rim };
}

function addPoly(x, pts) { x.moveTo(pts[0], pts[1]); for (let i = 2; i < pts.length; i += 2) x.lineTo(pts[i], pts[i + 1]); x.closePath(); }
const shadeCache = {};
function coreColor(hex, amt) {
  const k = hex + amt;
  if (shadeCache[k]) return shadeCache[k];
  const n = parseInt(hex.slice(1), 16), f = 1 - amt * 0.16;
  return (shadeCache[k] = `rgb(${((n >> 16) & 255) * f | 0},${((n >> 8) & 255) * f | 0},${(n & 255) * (f - amt * 0.03) | 0})`);
}

function drawPiece(x, p, photo, P, U, hole, W, H) {
  const c = S.cut, g = pieceGeom(p, U);
  const mx = Math.round(P.w * M), my = Math.round(P.h * M);
  x.save();
  x.globalAlpha = p.alpha;
  if (hole) { x.beginPath(); x.rect(0, 0, W, H); addPoly(x, hole.core); x.clip('evenodd'); }
  if (!p.flat) {
    if (c.shadow > 0) { x.shadowColor = `rgba(25,18,10,${(c.shadow * 0.55).toFixed(3)})`; x.shadowBlur = c.shadow * 16 * U; x.shadowOffsetY = c.shadow * 3 * U; }
    x.fillStyle = c.edge; x.beginPath(); addPoly(x, g.outer); x.fill();
    x.shadowColor = 'transparent'; x.shadowBlur = 0; x.shadowOffsetY = 0;
    if (g.fib.length) {
      x.strokeStyle = c.edge; x.lineWidth = 0.7 * U; x.lineCap = 'round'; x.beginPath();
      for (let i = 0; i < g.fib.length; i += 4) { x.moveTo(g.fib[i], g.fib[i + 1]); x.lineTo(g.fib[i + 2], g.fib[i + 3]); }
      x.stroke();
    }
    if (c.core > 0) { x.fillStyle = coreColor(c.edge, c.core); x.beginPath(); addPoly(x, g.mid); x.fill(); }
  } else if (hole) {
    x.fillStyle = c.edge; x.beginPath(); addPoly(x, g.outer); x.fill();
  }
  x.save();
  x.beginPath(); addPoly(x, g.inner); x.clip();
  if (hole) { x.beginPath(); x.rect(0, 0, W, H); addPoly(x, hole.rim); x.clip('evenodd'); }
  x.translate(p.pc.x, p.pc.y); x.rotate(p.aj); x.scale(p.s, p.s); x.translate(-p.pc0.x, -p.pc0.y);
  x.drawImage(photo, P.x - mx + p.ux, P.y - my + p.uy);
  x.setTransform(1, 0, 0, 1, 0, 0);
  if (!p.flat && c.colorVar > 0) {
    x.globalCompositeOperation = 'soft-light';
    x.globalAlpha = p.alpha * Math.min(1, c.colorVar * p.amt * 0.9);
    x.fillStyle = `hsl(${p.hue.toFixed(0)} 55% ${(50 + p.lum * 44).toFixed(0)}%)`;
    x.fillRect(0, 0, W, H);
  }
  x.restore();
  x.restore();
}

/* ---------- text ---------- */
function tornBox(x0, y0, x1, y1, key, U, amp) {
  const pts = [], step = 3 * U, cs = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]], NR = [[0, -1], [1, 0], [0, 1], [-1, 0]];
  for (let e = 0; e < 4; e++) {
    const [ax, ay] = cs[e], [bx, by] = cs[(e + 1) % 4], [nx, ny] = NR[e];
    const len = Math.hypot(bx - ax, by - ay), n = Math.max(2, Math.ceil(len / step));
    for (let i = 0; i < n; i++) {
      const t = i / n, u = (e % 2 ? ay + (by - ay) * t : ax + (bx - ax) * t);
      const d = fbm(key + e, u / (40 * U), 3) * amp * (e % 2 ? 0.5 : 1) + fbm(key + e + 9, u / (4 * U), 2) * 1.6 * U;
      pts.push(ax + (bx - ax) * t + nx * d, ay + (by - ay) * t + ny * d);
    }
  }
  return pts;
}
function wrapLines(x, text, maxW) {
  const out = [];
  for (const para of String(text).split('\n')) {
    const words = para.split(/\s+/).filter(Boolean);
    let line = '';
    for (const w of words) {
      const test = line ? line + ' ' + w : w;
      if (line && x.measureText(test).width > maxW) { out.push(line); line = w; } else line = test;
    }
    out.push(line);
  }
  while (out.length && !out[out.length - 1]) out.pop();
  return out;
}
let capPop = 0;
// t: seconds since the caption started (Infinity = fully shown); out: 0..1 fade for the clip's exit
function drawCaption(x, W, H, U, text, seed, t = Infinity, out = 1) {
  const T = S.text, anim = T.anim || 'fade';
  if (!T.on || !text || !text.trim() || out <= 0) return;
  if (anim !== 'none' && t < 0) return;
  const fs = T.size * Math.min(W, H) * 1.1;
  x.save();
  x.setTransform(1, 0, 0, 1, 0, 0);
  x.globalCompositeOperation = 'source-over';
  x.font = `${fs.toFixed(1)}px "${T.font}", Impact, "Arial Narrow", sans-serif`;
  x.textAlign = 'left'; x.textBaseline = 'alphabetic'; x.lineJoin = 'round';
  const tall = T.font === 'Anton' || T.font === 'Bebas Neue';
  // tall formats (Reels, TikTok, Shorts): keep text clear of the app's own buttons and labels
  const story = W / H < 0.7;
  const lines = wrapLines(x, text, W * (story ? 0.7 : 0.84));
  const lh = fs * (tall ? 1.02 : 1.18);
  const blockH = lines.length * lh;
  const b = S.frame.border * Math.min(W, H);
  const y0 = T.pos === 'top' ? Math.max(b + H * 0.06, story ? H * 0.15 : 0)
    : T.pos === 'bottom' ? Math.min(H - b - H * 0.06, story ? H * 0.77 : H) - blockH : (H - blockH) / 2;
  if (capPop > 0.01) { const sc = 1 + capPop * 0.15, cy = y0 + blockH / 2; x.translate(W / 2, cy); x.scale(sc, sc); x.translate(-W / 2, -cy); }
  const paint = (str, px, py) => {
    if (T.shadow > 0) { x.shadowColor = `rgba(0,0,0,${(0.55 * T.shadow).toFixed(3)})`; x.shadowBlur = fs * 0.16 * T.shadow; x.shadowOffsetY = fs * 0.04 * T.shadow; }
    if (T.outline > 0) { x.strokeStyle = '#111'; x.lineWidth = fs * 0.12 * T.outline; x.strokeText(str, px, py); x.shadowColor = 'transparent'; }
    x.fillStyle = T.color; x.fillText(str, px, py);
    x.shadowColor = 'transparent';
  };
  const space = x.measureText(' ').width;
  let charsLeft = anim === 'type' ? Math.floor(t / 0.045) : Infinity;
  let wordIdx = 0;
  lines.forEach((line, i) => {
    const words = line.split(' '), firstWord = wordIdx;
    wordIdx += words.length;
    let la = out, dy = 0, shown = line;
    if (anim === 'fade') la *= clamp(t / 0.4, 0, 1);
    if (anim === 'rise') { const e = clamp((t - i * 0.12) / 0.45, 0, 1); la *= e; dy = (1 - easeOut(e)) * fs * 0.7; }
    if (anim === 'type') { if (charsLeft <= 0) return; shown = line.slice(0, charsLeft); charsLeft -= line.length + 1; }
    if (anim === 'stamp' && t < firstWord * 0.13) return;
    if (la <= 0) return;
    const y = y0 + lh * i + fs * (tall ? 0.86 : 0.8) + dy;
    const tw = x.measureText(line).width, left = W / 2 - tw / 2; // full-line layout so typing never shifts
    x.globalAlpha = la;
    if (T.label) {
      const px = fs * 0.28;
      const pts = tornBox(left - px, y - fs * (tall ? 0.86 : 0.78) - fs * 0.1, left + tw + px, y + fs * 0.16, ikey(seed, 31, i), U, fs * 0.05);
      x.save();
      x.translate(W / 2, y); x.rotate(((i % 2 ? 1 : -1) * 1.1 + hash(i, seed) - 0.5) * Math.PI / 180); x.translate(-W / 2, -y);
      x.shadowColor = 'rgba(0,0,0,.35)'; x.shadowBlur = 8 * U; x.shadowOffsetY = 2 * U;
      x.fillStyle = T.labelColor; x.beginPath(); addPoly(x, pts); x.fill();
      x.restore();
    }
    if (anim === 'stamp') {
      let cx = left;
      words.forEach((w, j) => {
        const ww = x.measureText(w).width;
        const e = clamp((t - (firstWord + j) * 0.13) / 0.2, 0, 1);
        if (e > 0) {
          const sc = 1 + 0.6 * Math.pow(1 - e, 3), mx = cx + ww / 2, my = y - fs * 0.35;
          x.save();
          x.translate(mx, my); x.scale(sc, sc); x.translate(-mx, -my);
          x.globalAlpha = la * Math.min(1, e * 3);
          paint(w, cx, y);
          x.restore();
        }
        cx += ww + space;
      });
    } else paint(shown, left, y);
  });
  x.restore();
}

/* ---------- frame rendering ---------- */
const CAM_ID = [1, 0, 0, 1, 0, 0];
let cam = CAM_ID;
function camFor(k, lt, W, H) {
  const kb = S.seq.kb, c = clips[k];
  if (!kb || lt == null || !c) return CAM_ID;
  const pr = clamp(lt / cdur(c), 0, 1), zin = hash(c.seed | 0, 71) < 0.6;
  const z = 1 + kb * (zin ? pr : 1 - pr);
  const a = hash(c.seed | 0, 72) * Math.PI * 2, m = (z - 1) * 0.4;
  return [z, 0, 0, z, W / 2 - z * W / 2 + Math.cos(a) * m * W, H / 2 - z * H / 2 + Math.sin(a) * m * H];
}
function resetCtx(x) {
  x.setTransform(cam[0], cam[1], cam[2], cam[3], cam[4], cam[5]); x.globalAlpha = 1; x.globalCompositeOperation = 'source-over';
  x.shadowColor = 'transparent'; x.shadowBlur = 0; x.shadowOffsetY = 0;
}
function drawScan(x, W, H, U) {
  if (!S.scan.on || S.scan.opacity <= 0) return;
  x.globalCompositeOperation = 'overlay'; x.globalAlpha = S.scan.opacity;
  x.drawImage(getTexture(W, H, U), 0, 0);
  x.globalCompositeOperation = 'source-over'; x.globalAlpha = 1;
}
function drawBlank(x, W, H) {
  const U = Math.min(W, H) / 1000;
  resetCtx(x); x.drawImage(getBackground(W, H, U), 0, 0); drawScan(x, W, H, U);
}
// o: { lt: seconds into the clip, intro: 0..1 strips dropping in, exit: 0..1 strips flying off, capStart: when the caption starts }
function drawClip(x, W, H, k, f, o) {
  o = o || {};
  const clip = clips[k];
  if (!clip) return drawBlank(x, W, H);
  const prevS = S;
  S = o.look || lookFor(k);
  const U = Math.min(W, H) / 1000, P = photoRect(W, H);
  cam = camFor(k, o.lt, W, H);
  try {
    resetCtx(x);
    x.drawImage(getBackground(W, H, U), 0, 0);
    const seed = seedFor(k, f);
    const hole = S.hole.on ? buildHole(P, seed, U) : null;
    const perStrip = S.cut.on && S.cut.mix && S.cut.mixFit === 'strip';
    for (const p of buildPieces(P, seed, f, H, U, o.intro, k, o.exit, o.react)) {
      const PP = perStrip && p.cell ? p.cell : P;
      drawPiece(x, p, getPhoto(clips[p.src] || clip, PP), PP, U, hole, W, H);
    }
    if (o.react && o.react.flash > 0.01) {
      x.save(); x.globalCompositeOperation = 'screen'; x.globalAlpha = Math.min(0.6, o.react.flash * 0.6);
      x.fillStyle = '#ffffff'; x.fillRect(0, 0, W, H); x.restore();
    }
    capPop = o.react ? o.react.pop : 0;
    const capT = o.lt == null ? Infinity : o.lt - (o.capStart || 0);
    const capOut = o.exit == null ? 1 : 1 - clamp(o.exit * 1.8, 0, 1);
    if (S.text.onPaper) drawCaption(x, W, H, U, clip.caption, seed, capT, capOut);
    drawScan(x, W, H, U);
    if (!S.text.onPaper) drawCaption(x, W, H, U, clip.caption, seed, capT, capOut);
  } finally { cam = CAM_ID; S = prevS; capPop = 0; }
}
function drawOriginal(x, W, H, k) {
  const clip = clips[k];
  if (!clip) return drawBlank(x, W, H);
  const prevS = S; S = lookFor(k);
  const U = Math.min(W, H) / 1000, P = photoRect(W, H), im = img(clip);
  resetCtx(x); x.drawImage(getBackground(W, H, U), 0, 0);
  const sw = im.naturalWidth || im.width, sh = im.naturalHeight || im.height, sc = Math.max(P.w / sw, P.h / sh) * S.frame.zoom * (clip.zoom || 1);
  x.save(); x.beginPath(); x.rect(P.x, P.y, P.w, P.h); x.clip();
  x.drawImage(im, P.x + (P.w - sw * sc) * (clip.fx ?? 0.5), P.y + (P.h - sh * sc) * (clip.fy ?? 0.5), sw * sc, sh * sc);
  x.restore();
  S = prevS;
}

const synced = () => !!(song && S.music.on && S.music.sync);
const spb = () => 60 / (S.music.bpm || (song && song.bpm) || 120);
const cdur = c => (synced() ? c.beats * spb() : c.dur);
const starts = () => { let a = 0; return clips.map(c => { const s = a; a += cdur(c); return s; }); };
const totalDur = () => clips.reduce((a, c) => a + cdur(c), 0);
function locate(t) {
  const st = starts();
  for (let i = 0; i < clips.length; i++) if (t < st[i] + cdur(clips[i])) return { k: i, lt: Math.max(0, t - st[i]) };
  const k = clips.length - 1;
  return { k, lt: cdur(clips[k]) };
}
const bufs = {};
function buf(name, W, H) {
  const c = bufs[name] || (bufs[name] = document.createElement('canvas'));
  if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }
  return c;
}
// beat bump: the whole frame punches in on every beat and settles
function beatPulse(t) {
  if (!(song && S.music.on && S.music.bump > 0)) return 0;
  const b = (S.music.start + t - beatPhase()) / spb();
  if (b < 0) return 0;
  return S.music.bump * Math.exp(-(b - Math.floor(b)) * 7);
}
function renderAt(x, W, H, t, loop) {
  const r = reactAt(t);
  const p = Math.max(beatPulse(t) * 0.05, r ? r.punch * 0.07 : 0);
  if (p < 0.0005) return renderSeq(x, W, H, t, loop);
  const B = buf('bump', W, H);
  renderSeq(B.getContext('2d'), W, H, t, loop);
  resetCtx(x);
  const s = 1 + p;
  x.drawImage(B, W * (1 - s) / 2, H * (1 - s) / 2, W * s, H * s);
}
function renderSeq(x, W, H, t, loop) {
  if (!clips.length) return drawBlank(x, W, H);
  const { k, lt } = locate(t), f = frameAt(t);
  const dur = cdur(clips[k]), tr = S.seq.transition, d = Math.min(S.seq.trDur, dur * 0.8);
  const exD = S.seq.exit && (tr === 'strips' || tr === 'cut') ? Math.min(S.seq.exitDur, dur * 0.4) : 0;
  const o = { react: reactAt(t), lt, capStart: tr === 'strips' ? d * 0.55 : 0.1, exit: exD > 0 && lt > dur - exD ? (lt - (dur - exD)) / exD : null };
  if (tr === 'cut' || d <= 0 || lt >= d) return drawClip(x, W, H, k, f, o);
  const p = lt / d;
  if (tr === 'strips') return drawClip(x, W, H, k, f, { ...o, intro: p });
  const prev = k > 0 ? k - 1 : loop ? clips.length - 1 : -1;
  const e = easeInOut(p);
  const A = buf('a', W, H), B = buf('b', W, H);
  if (prev >= 0) drawClip(A.getContext('2d'), W, H, prev, f, { lt: cdur(clips[prev]), react: o.react }); else drawBlank(A.getContext('2d'), W, H);
  drawClip(B.getContext('2d'), W, H, k, f, o);
  resetCtx(x);
  if (tr === 'crossfade') { x.drawImage(A, 0, 0); x.globalAlpha = e; x.drawImage(B, 0, 0); x.globalAlpha = 1; }
  else { const off = Math.round(e * W); x.drawImage(A, -off, 0); x.drawImage(B, W - off, 0); }
}

/* ---------- music ---------- */
let song = null; // { buffer, blob, name, bpm, phase, peaks }
let ac = null, srcNode = null, gainNode = null, audioT0 = 0;
const beatPhase = () => (song ? song.phase : 0) + S.music.offset;
function snapToBeat(t) { const b = spb(), ph = beatPhase(); return Math.max(0, ph + Math.round((t - ph) / b) * b); }
function audioCtx() {
  if (!ac) { const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return null; ac = new AC(); }
  if (ac.state === 'suspended') ac.resume();
  return ac;
}
function stopAudio() {
  if (srcNode) { try { srcNode.stop(); } catch (e) { /* already stopped */ } srcNode.disconnect(); srcNode = null; }
  if (gainNode) { gainNode.disconnect(); gainNode = null; }
}
function startAudio(t) {
  stopAudio();
  if (!(song && S.music.on)) return;
  const a = audioCtx(); if (!a) return;
  if (a.state !== 'running') { a.resume().then(() => { if (playing && !srcNode) startAudio(T); }, () => {}); return; }
  const off = S.music.start + t;
  if (off >= song.buffer.duration) return;
  srcNode = a.createBufferSource(); srcNode.buffer = song.buffer;
  gainNode = a.createGain();
  srcNode.connect(gainNode); gainNode.connect(a.destination);
  const now = a.currentTime, v = S.music.volume, tot = totalDur(), fs = tot - S.music.fade;
  gainNode.gain.setValueAtTime(0, now); gainNode.gain.linearRampToValueAtTime(v, now + 0.03);
  if (S.music.fade > 0) {
    if (t < fs) gainNode.gain.setValueAtTime(v, now + (fs - t));
    else gainNode.gain.setValueAtTime(v * clamp((tot - t) / S.music.fade, 0, 1), now + 0.031);
    gainNode.gain.linearRampToValueAtTime(0, now + Math.max(0.04, tot - t));
  }
  srcNode.start(now, off);
  audioT0 = now - t;
}
async function analyzeBeats(buffer) {
  const sr = 11025, hop = 128;
  const oac = new OfflineAudioContext(1, Math.max(1, Math.ceil(buffer.duration * sr)), sr);
  const src = oac.createBufferSource(); src.buffer = buffer;
  const lp = oac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 200;
  const g = oac.createGain(); g.gain.value = 0.4;
  src.connect(lp); lp.connect(oac.destination); src.connect(g); g.connect(oac.destination);
  src.start();
  const d = (await oac.startRendering()).getChannelData(0);
  const n = Math.floor(d.length / hop);
  if (n < 64) return { bpm: 120, phase: 0 };
  const le = new Float32Array(n), on = new Float32Array(n), avg = new Float32Array(n);
  for (let i = 0; i < n; i++) { let e = 0; const o = i * hop; for (let j = 0; j < hop * 2 && o + j < d.length; j++) e += d[o + j] * d[o + j]; le[i] = Math.log(1 + 1000 * e); }
  for (let i = 1; i < n; i++) on[i] = Math.max(0, le[i] - le[i - 1]);
  let acc = 0; const w = 26;
  for (let i = 0; i < n; i++) { acc += on[i]; if (i >= w) acc -= on[i - w]; avg[i] = acc / Math.min(i + 1, w); }
  for (let i = 0; i < n; i++) on[i] = Math.max(0, on[i] - avg[i]);
  const fps = sr / hop;
  const pk = x => { const i = Math.round(x); return i < 1 || i + 1 >= n ? 0 : Math.max(on[i - 1], on[i], on[i + 1]); };
  const at = x => { const i = Math.floor(x); if (i < 0 || i + 1 >= n) return 0; const f = x - i; return on[i] * (1 - f) + on[i + 1] * f; };
  const comb = (bpm, fn, step) => {
    const per = fps * 60 / bpm; let best = -1, bestPh = 0;
    for (let ph = 0; ph < per; ph += step) { let s = 0, c = 0; for (let x = ph; x < n; x += per) { s += fn(x); c++; } s /= Math.max(1, c); if (s > best) { best = s; bestPh = ph; } }
    return { s: best, ph: bestPh };
  };
  const prior = bpm => Math.exp(-0.5 * Math.pow(Math.log2(bpm / 118) / 0.9, 2));
  let best = { v: -1, bpm: 120 };
  for (let bpm = 70; bpm <= 180; bpm += 0.5) { const r = comb(bpm, pk, 1); const v = r.s * prior(bpm); if (v > best.v) best = { v, bpm }; }
  let fine = { v: -1, bpm: best.bpm, ph: 0 };
  for (let bpm = best.bpm - 0.6; bpm <= best.bpm + 0.6; bpm += 0.02) { const r = comb(bpm, at, 0.25); if (r.s > fine.v) fine = { v: r.s, bpm, ph: r.ph }; }
  return { bpm: Math.round(fine.bpm * 100) / 100, phase: (fine.ph + 0.5) / fps };
}
async function analyzeFeatures(buffer) {
  const sr = 11025, hop = 110, fps = sr / hop;
  const len = Math.max(1, Math.ceil(buffer.duration * sr));
  const render = async setup => {
    const oac = new OfflineAudioContext(1, len, sr), src = oac.createBufferSource();
    src.buffer = buffer; setup(oac, src).connect(oac.destination); src.start();
    return (await oac.startRendering()).getChannelData(0);
  };
  const filt = (type, hz) => (o, s) => { const f = o.createBiquadFilter(); f.type = type; f.frequency.value = hz; s.connect(f); return f; };
  const [lo, full, hi] = await Promise.all([render(filt('lowpass', 150)), render((o, s) => s), render(filt('highpass', 4000))]);
  const n = Math.max(2, Math.floor(full.length / hop));
  const rms = d => { const o = new Float32Array(n); for (let i = 0; i < n; i++) { let e = 0; const b = i * hop; for (let j = 0; j < hop; j++) { const v = d[b + j] || 0; e += v * v; } o[i] = Math.sqrt(e / hop); } return o; };
  const norm = a => { const q = Float32Array.from(a).sort(); const p = q[Math.floor(q.length * 0.95)] || 1e-6; for (let i = 0; i < a.length; i++) a[i] = Math.min(1.25, a[i] / p); return a; };
  const bass = norm(rms(lo)), energy = norm(rms(full)), high = norm(rms(hi));
  const on = new Float32Array(n);
  for (let i = 1; i < n; i++) on[i] = Math.max(0, bass[i] - bass[i - 1]) + 0.6 * Math.max(0, energy[i] - energy[i - 1]) + 0.3 * Math.max(0, high[i] - high[i - 1]);
  // envelopes: instant attack, smooth release, so visuals jump on a hit and settle
  const env = (a, rel) => { const k = Math.exp(-1 / (rel * fps)), o = new Float32Array(n); for (let i = 0; i < n; i++) o[i] = i && a[i] < o[i - 1] ? o[i - 1] * k + a[i] * (1 - k) : a[i]; return o; };
  return { fps, n, bass: env(bass, 0.12), energy: env(energy, 0.2), high: env(high, 0.06), on, hits: null, hitsSens: -1 };
}
function getHits() {
  const F = song && song.fx;
  if (!F) return [];
  const sens = G.music.sens;
  if (F.hitsSens === sens) return F.hits;
  const on = F.on, n = F.n, w = Math.round(F.fps * 0.4), k = 0.6 + (1 - sens) * 2.4, gap = Math.round(F.fps * 0.09);
  const p1 = new Float64Array(n + 1), p2 = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) { p1[i + 1] = p1[i] + on[i]; p2[i + 1] = p2[i] + on[i] * on[i]; }
  const hits = []; let last = -1e9;
  for (let i = 1; i < n - 1; i++) {
    const a = Math.max(0, i - w), b = Math.min(n, i + w + 1), c = b - a, m = (p1[b] - p1[a]) / c, v = Math.max(0, (p2[b] - p2[a]) / c - m * m);
    if (on[i] > m + k * Math.sqrt(v) + 0.02 && on[i] >= on[i - 1] && on[i] >= on[i + 1] && i - last >= gap) { hits.push(i / F.fps); last = i; }
  }
  F.hits = hits; F.hitsSens = sens;
  return hits;
}
function lastHitIndex(sec) {
  const h = getHits(); let lo = 0, hi = h.length - 1, r = -1;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (h[m] <= sec) { r = m; lo = m + 1; } else hi = m - 1; }
  return r;
}
// what the music is doing at sequence time t
function fxAt(t) {
  const F = song && G.music.on && song.fx;
  if (!F) return null;
  const sec = G.music.start + t, xi = sec * F.fps, i = Math.floor(xi);
  if (i < 0 || i + 1 >= F.n) return { bass: 0, energy: 0, high: 0, hit: 0 };
  const f = xi - i, L = a => a[i] * (1 - f) + a[i + 1] * f;
  const h = lastHitIndex(sec), hits = getHits();
  return { bass: L(F.bass), energy: L(F.energy), high: L(F.high), hit: h >= 0 ? Math.exp(-(sec - hits[h]) * 9) : 0 };
}
function reactAt(t) {
  const F = fxAt(t), m = G.music;
  if (!F) return null;
  return { shake: m.shake * F.energy, spread: m.spread * F.bass, flash: m.flash * F.hit, pop: m.pop * F.hit, punch: m.punch * (0.6 * F.hit + 0.4 * F.bass), tick: Math.floor(t * 30) };
}
function drawMeter(t) {
  const c = $('meter');
  if (!c || !song || c.closest('[hidden]')) return;
  const x = c.getContext('2d'), W = c.width, H = c.height, F = fxAt(t) || { bass: 0, energy: 0, high: 0, hit: 0 };
  const css = getComputedStyle(document.documentElement), accent = css.getPropertyValue('--accent').trim() || '#f0c24b';
  x.clearRect(0, 0, W, H);
  const bars = [['BASS', F.bass], ['LOUD', F.energy], ['HIGHS', F.high], ['HIT', F.hit]];
  const bw = W / bars.length;
  x.font = '600 18px "JetBrains Mono", Consolas, monospace'; x.textBaseline = 'middle';
  bars.forEach(([name, v], i) => {
    const x0 = i * bw + 6, w = bw - 12, fill = clamp(v / 1.1, 0, 1);
    x.fillStyle = 'rgba(236,231,222,.08)'; x.fillRect(x0, 34, w, 18);
    x.fillStyle = name === 'HIT' ? '#ffffff' : accent; x.globalAlpha = name === 'HIT' ? 0.25 + 0.75 * fill : 1;
    x.fillRect(x0, 34, w * fill, 18); x.globalAlpha = 1;
    x.fillStyle = 'rgba(236,231,222,.7)'; x.fillText(name, x0, 16);
  });
}

function wavePeaks(buffer, cols) {
  const d = buffer.getChannelData(0), per = Math.max(1, Math.floor(d.length / cols)), out = new Float32Array(cols);
  const stride = Math.max(1, Math.floor(per / 64));
  for (let c = 0; c < cols; c++) { let m = 0; for (let i = c * per; i < (c + 1) * per && i < d.length; i += stride) { const v = Math.abs(d[i]); if (v > m) m = v; } out[c] = m; }
  return out;
}
async function loadMusic(blob, name, quiet) {
  if (!quiet) status('Reading music…');
  try {
    const ab = await blob.arrayBuffer();
    const buffer = await new OfflineAudioContext(2, 44100, 44100).decodeAudioData(ab);
    if (!quiet) status('Finding the beat…');
    const { bpm, phase } = await analyzeBeats(buffer);
    const fx = await analyzeFeatures(buffer);
    song = { buffer, blob, name: name || 'Music', bpm, phase, peaks: wavePeaks(buffer, 576), fx };
    if (!quiet) {
      S.music.bpm = 0; S.music.offset = 0; S.music.on = true;
      S.music.start = snapToBeat(Math.min(S.music.start, Math.max(0, buffer.duration - 1)));
      store.set('torn-music', { name: song.name });
      idbDo('readwrite', os => os.put(blob, '__music'));
      status(`Loaded ${song.name} · ${bpm.toFixed(1)} BPM`);
    }
    syncPanel(); changed('music');
    return true;
  } catch (e) {
    status('Could not read that audio file. Try MP3, WAV, M4A or OGG.');
    return false;
  }
}
function removeMusic() {
  if (playing) stopAudio();
  song = null;
  store.set('torn-music', null);
  idbDo('readwrite', os => os.delete('__music'));
  syncPanel(); changed('music'); status('Music removed');
}
function refreshMusicUI() {
  const has = !!song;
  if (!$('musicName')) return;
  $('musicName').textContent = has ? song.name : 'No music yet. Add a song to sync cuts and tears to its beat.';
  $('wave').hidden = !has; $('bpmRow').hidden = !has; $('musicRemove').hidden = !has;
  $('musicAdd').textContent = has ? 'Replace music' : 'Add music';
  if (has) {
    const bpm = S.music.bpm || song.bpm;
    if (document.activeElement !== $('bpmIn')) $('bpmIn').value = bpm.toFixed(1);
    $('musicFacts').innerHTML = `<span><b>${fmtT(song.buffer.duration)}</b> song</span><span><b>${song.bpm.toFixed(1)}</b> BPM detected</span><span>sequence <b>${fmtT(totalDur())}</b></span>`;
    const st = inputs['music.start']; if (st) { st.max = Math.max(0.01, song.buffer.duration - 0.5).toFixed(2); st._sync(S.music.start); }
  } else $('musicFacts').innerHTML = '';
  drawWave();
}
function drawWave() {
  const c = $('wave');
  if (!c || !song || c.hidden) return;
  const x = c.getContext('2d'), W = c.width, H = c.height, dur = song.buffer.duration;
  const css = getComputedStyle(document.documentElement);
  const accent = css.getPropertyValue('--accent').trim() || '#f0c24b', line = css.getPropertyValue('--faint').trim() || '#5f5a53';
  x.clearRect(0, 0, W, H);
  const s0 = S.music.start / dur * W, s1 = Math.min(W, (S.music.start + totalDur()) / dur * W);
  x.fillStyle = 'rgba(240,194,75,.14)'; x.fillRect(s0, 0, s1 - s0, H);
  const b = spb(), ph = beatPhase();
  const pxPerBeat = b / dur * W;
  if (pxPerBeat > 2.5) {
    for (let i = Math.ceil(-ph / b), t = ph + i * b; t < dur; i++, t = ph + i * b) {
      const px = Math.round(t / dur * W) + 0.5;
      x.strokeStyle = i % 4 === 0 ? 'rgba(236,231,222,.28)' : 'rgba(236,231,222,.1)';
      x.beginPath(); x.moveTo(px, 0); x.lineTo(px, H); x.stroke();
    }
  }
  const mid = H / 2;
  for (let i = 0; i < song.peaks.length; i++) {
    const px = i / song.peaks.length * W, h = Math.max(1, song.peaks[i] * (H * 0.9));
    x.fillStyle = px >= s0 && px <= s1 ? accent : line;
    x.fillRect(px, mid - h / 2, Math.max(1, W / song.peaks.length - 0.5), h);
  }
  x.fillStyle = 'rgba(255,255,255,.7)';
  for (const h of getHits()) x.fillRect(Math.round(h / dur * W), H - 7, 1.5, 7);
  if (playing || view === 'time') { const px = (S.music.start + T) / dur * W; x.fillStyle = '#ffffff'; x.fillRect(px, 0, 2, H); }
  drawMeter(view === 'time' ? T : (starts()[sel] || 0));
}
function wireMusicUI() {
  $('musicAdd').onclick = () => $('fileMusic').click();
  $('musicRemove').onclick = removeMusic;
  $('bpmIn').onchange = () => { const v = +$('bpmIn').value; if (v >= 40 && v <= 240) { S.music.bpm = v; changed('music'); } else refreshMusicUI(); };
  $('bpmAuto').onclick = () => { S.music.bpm = 0; S.music.offset = 0; syncPanel(); changed('music'); status(`Tempo reset to the detected ${song.bpm.toFixed(1)} BPM`); };
  let taps = [];
  $('tapBtn').onclick = () => {
    const now = performance.now() / 1000;
    taps = taps.filter(t => now - t < 3).concat(now);
    if (taps.length >= 4) { const iv = (taps[taps.length - 1] - taps[0]) / (taps.length - 1); S.music.bpm = Math.round(600 / iv) / 10; changed('music'); status(`Tapped ${S.music.bpm.toFixed(1)} BPM`); }
    else status(`Keep tapping (${taps.length})…`);
  };
  $('wave').onclick = e => {
    const r = $('wave').getBoundingClientRect();
    let t = (e.clientX - r.left) / r.width * song.buffer.duration;
    if (synced()) t = snapToBeat(t);
    S.music.start = clamp(t, 0, Math.max(0, song.buffer.duration - 0.5));
    syncPanel(); changed('music');
  };
  $('fileMusic').onchange = e => { const f = e.target.files[0]; e.target.value = ''; if (f) loadMusic(f, f.name.replace(/\.[^.]+$/, '')); };
}
async function renderSongMix(tot, sr) {
  const oac = new OfflineAudioContext(2, Math.max(1, Math.ceil(tot * sr)), sr);
  const src = oac.createBufferSource(); src.buffer = song.buffer;
  const g = oac.createGain(); src.connect(g); g.connect(oac.destination);
  const v = S.music.volume;
  g.gain.setValueAtTime(0, 0); g.gain.linearRampToValueAtTime(v, 0.02);
  if (S.music.fade > 0) { g.gain.setValueAtTime(v, Math.max(0.03, tot - S.music.fade)); g.gain.linearRampToValueAtTime(0, tot); }
  src.start(0, Math.min(S.music.start, song.buffer.duration));
  return oac.startRendering();
}
async function pickAudioConfig(sr) {
  if (typeof AudioEncoder === 'undefined') return null;
  for (const [codec, mux] of [['mp4a.40.2', 'aac'], ['opus', 'opus']]) {
    const cfg = { codec, sampleRate: sr, numberOfChannels: 2, bitrate: 192000 };
    try { const r = await AudioEncoder.isConfigSupported(cfg); if (r.supported) return { cfg, mux }; } catch (e) { /* next */ }
  }
  return null;
}
async function encodeSong(muxer, ab, cfg) {
  let err = null;
  const enc = new AudioEncoder({ output: (chunk, meta) => muxer.addAudioChunk(chunk, meta), error: e => { err = e; } });
  enc.configure(cfg);
  const ch = ab.numberOfChannels, n = ab.length, sr = ab.sampleRate, F = 1024;
  const chans = [...Array(ch)].map((_, i) => ab.getChannelData(i));
  for (let i = 0; i < n; i += F) {
    if (err) throw err;
    const m = Math.min(F, n - i), data = new Float32Array(m * ch);
    for (let c = 0; c < ch; c++) data.set(chans[c].subarray(i, i + m), c * m);
    const ad = new AudioData({ format: 'f32-planar', sampleRate: sr, numberOfFrames: m, numberOfChannels: ch, timestamp: Math.round(i / sr * 1e6), data });
    enc.encode(ad); ad.close();
    if (enc.encodeQueueSize > 64) await sleep(0);
  }
  await enc.flush(); enc.close();
  if (err) throw err;
}

/* ---------- preview ---------- */
const cv = $('cv'), ctx = cv.getContext('2d');
let view = 'still'; // 'still' shows the selected clip fully assembled; 'time' shows the sequence at T
let T = 0, playing = false, comparing = false, pending = false;

function renderView(x, W, H) {
  if (comparing) return drawOriginal(x, W, H, view === 'time' && clips.length ? locate(T).k : sel);
  if (view === 'still') return drawClip(x, W, H, sel, 0, null);
  return renderAt(x, W, H, T, true);
}
let safeOn = false;
function drawSafe(x, W, H) {
  const U = Math.min(W, H) / 1000, ar = W / H;
  x.save(); x.setTransform(1, 0, 0, 1, 0, 0); x.globalAlpha = 1; x.globalCompositeOperation = 'source-over';
  const zone = (x0, y0, w, h, label) => {
    x.fillStyle = 'rgba(229,107,90,.30)'; x.fillRect(x0, y0, w, h);
    x.strokeStyle = 'rgba(255,140,120,.95)'; x.lineWidth = 2 * U; x.setLineDash([10 * U, 7 * U]);
    x.strokeRect(x0 + U, y0 + U, w - 2 * U, h - 2 * U); x.setLineDash([]);
    if (label && w > 180 * U && h > 40 * U) { x.fillStyle = '#fff'; x.font = `600 ${Math.round(22 * U)}px "JetBrains Mono", Consolas, monospace`; x.fillText(label, x0 + 14 * U, y0 + 34 * U); }
  };
  const safeBox = (m, label) => {
    x.strokeStyle = 'rgba(255,140,120,.95)'; x.lineWidth = 2 * U; x.setLineDash([10 * U, 7 * U]);
    x.strokeRect(W * m, H * m, W * (1 - 2 * m), H * (1 - 2 * m)); x.setLineDash([]);
    x.fillStyle = '#fff'; x.font = `600 ${Math.round(20 * U)}px "JetBrains Mono", Consolas, monospace`; x.fillText(label, W * m + 12 * U, H * m + 30 * U);
  };
  if (ar < 0.7) {
    zone(0, 0, W, H * 0.14, 'Top: account and title');
    zone(0, H * 0.78, W, H * 0.22, 'Bottom: caption and buttons');
    zone(W * 0.84, H * 0.40, W * 0.16, H * 0.38, '');
    x.save(); x.translate(W * 0.92, H * 0.59); x.rotate(-Math.PI / 2); x.fillStyle = '#fff'; x.textAlign = 'center';
    x.font = `600 ${Math.round(22 * U)}px "JetBrains Mono", Consolas, monospace`; x.fillText('Like / comment / share', 0, 8 * U); x.restore();
  } else if (ar < 0.95) {
    const side = (W - H * 0.75) / 2;
    if (side > 1) { zone(0, 0, side, H, ''); zone(W - side, 0, side, H, ''); }
    safeBox(0.05, 'Profile grid shows the 3:4 middle');
  } else if (ar > 1.4) {
    safeBox(0.05, 'Title safe area');
    zone(W * 0.84, H * 0.86, W * 0.14, H * 0.1, 'Timestamp');
  } else safeBox(0.05, 'Title safe area');
  x.restore();
}
function draw() {
  const [W, H] = dims(PREVIEW_LONG);
  if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
  renderView(ctx, W, H);
  if (safeOn && !comparing) drawSafe(ctx, W, H);
}
function requestRender() {
  if (pending || playing) return;
  pending = true;
  requestAnimationFrame(() => { pending = false; draw(); });
}

let lastTs = 0, raf = 0;
function loop(ts) {
  raf = requestAnimationFrame(loop);
  const dt = lastTs ? Math.min(0.1, (ts - lastTs) / 1000) : 0;
  lastTs = ts;
  const tot = totalDur();
  if (srcNode && ac) {
    T = ac.currentTime - audioT0;
    if (T >= tot) { T = 0; startAudio(0); }
  } else T = tot > 0 ? (T + dt) % tot : 0;
  if (T < 0) T = 0;
  const k = locate(T).k;
  if (k !== sel) { sel = k; updateClipPanel(); markSelected(true); }
  draw();
  updateTime();
  drawWave();
}
function setPlaying(on) {
  if (on && !clips.length) return;
  playing = on;
  const b = $('playBtn');
  b.setAttribute('aria-label', on ? 'Pause' : 'Play sequence');
  b.innerHTML = on
    ? '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M4 2.5h3v11H4zM9 2.5h3v11H9z"/></svg>'
    : '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M4 2.5v11l9-5.5z"/></svg>';
  cancelAnimationFrame(raf);
  if (on) {
    if (view === 'still') T = starts()[sel] || 0;
    view = 'time'; lastTs = 0; startAudio(T); raf = requestAnimationFrame(loop);
  } else { stopAudio(); requestRender(); drawWave(); }
}

/* ---------- cover frame ---------- */
function coverRef() {
  const c = G.seq.cover;
  if (!c) return null;
  if (c.clip) { const k = clips.findIndex(x => x.id === c.clip); return k >= 0 ? { k } : null; }
  return clips.length ? { t: clamp(c.t, 0, Math.max(0, totalDur() - 0.001)) } : null;
}
function renderCover(x, W, H) {
  const c = coverRef();
  if (!c) return renderView(x, W, H);
  if (c.k != null) drawClip(x, W, H, c.k, 0, null); else renderAt(x, W, H, c.t, false);
}
function updateCoverUI() {
  const c = coverRef();
  $('coverInfo').hidden = !c;
  if (c) $('coverText').textContent = c.k != null ? `Cover: clip ${c.k + 1}` : `Cover: ${fmtT(c.t)}`;
}
$('coverBtn').onclick = () => {
  if (!clips.length) return;
  if (playing) setPlaying(false);
  G.seq.cover = view === 'still' ? { clip: clips[sel].id } : { t: T };
  store.set('torn-settings-v2', G); pushHistory(); updateCoverUI();
  status(view === 'still' ? `Clip ${sel + 1} is now the cover` : `The frame at ${fmtT(T)} is now the cover`);
};
$('coverClear').onclick = () => { G.seq.cover = null; store.set('torn-settings-v2', G); pushHistory(); updateCoverUI(); status('Cover cleared'); };
$('safeBtn').onclick = () => { safeOn = !safeOn; $('safeBtn').setAttribute('aria-pressed', safeOn); if (playing) draw(); else requestRender(); };

/* ---------- time + strip UI ---------- */
const fmtT = t => { const m = Math.floor(t / 60), s = t - m * 60; return String(m).padStart(2, '0') + ':' + s.toFixed(1).padStart(4, '0'); };
function updateTime() {
  updateCoverUI();
  const tot = totalDur(), t = view === 'still' ? (starts()[sel] || 0) : T;
  $('time').innerHTML = `<b>${fmtT(t)}</b> / ${fmtT(tot)}`;
  const sc = $('scrub'); sc.max = Math.max(0.01, tot).toFixed(2); sc.value = t.toFixed(2);
  sc.style.setProperty('--p', (tot ? t / tot * 100 : 0) + '%');
  const cards = $('strip').querySelectorAll('.card[data-id]');
  const { k, lt } = clips.length ? locate(t) : { k: -1, lt: 0 };
  cards.forEach((el, i) => { el.querySelector('.prog').style.width = view === 'time' && i === k ? (lt / cdur(clips[k]) * 100) + '%' : '0'; });
}
const PX_PER_S = 26;
const durLabel = c => (synced() ? `${c.beats} beat${c.beats > 1 ? 's' : ''}` : c.dur.toFixed(1) + 's');
function buildStrip() {
  const ol = $('strip');
  ol.innerHTML = '';
  clips.forEach((c, i) => {
    const li = document.createElement('li');
    li.className = 'card' + (i === sel ? ' sel' : '');
    li.dataset.id = c.id; li.draggable = true;
    li.style.width = Math.max(72, Math.round(cdur(c) * PX_PER_S)) + 'px';
    li.innerHTML = `<button class="thumb" type="button" aria-label="Select clip ${i + 1}: ${esc(c.name)}"><img src="${media.get(c.id).thumb}" alt=""></button>
      <span class="num">${String(i + 1).padStart(2, '0')}</span><span class="dur">${durLabel(c)}</span>${c.caption.trim() ? '<span class="cap" title="Has caption">T</span>' : ''}${c.look ? '<span class="lk" title="Has its own look">L</span>' : ''}
      <button class="rm" type="button" aria-label="Remove clip ${i + 1}" title="Remove"><svg viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.6"><path d="m2 2 6 6M8 2 2 8"/></svg></button>
      <i class="prog"></i>`;
    li.querySelector('.thumb').onclick = () => selectClip(i);
    li.querySelector('.rm').onclick = e => { e.stopPropagation(); removeClip(i); };
    ol.append(li);
  });
  const add = document.createElement('li');
  add.innerHTML = '<button class="card add" type="button"><span><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M8 3v10M3 8h10"/></svg>Add photos</span></button>';
  add.firstChild.onclick = () => $('fileAdd').click();
  ol.append(add);
  updateTime();
}
function markSelected(scroll) {
  $('strip').querySelectorAll('.card[data-id]').forEach((el, i) => {
    el.classList.toggle('sel', i === sel);
    if (scroll && i === sel) el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  });
}

/* ---------- clip operations ---------- */
function selectClip(i) {
  if (!clips.length) return;
  sel = clamp(i, 0, clips.length - 1);
  if (playing) { T = starts()[sel]; } else view = 'still';
  markSelected(true); updateClipPanel(); updateTime(); requestRender(); persistClips();
}
function structural() {
  sel = clamp(sel, 0, Math.max(0, clips.length - 1));
  if (!clips.length) setPlaying(false);
  buildStrip(); updateClipPanel(); persistClips(); pushHistory();
  photoCache.clear();
  requestRender();
}
function removeClip(i) {
  if (!clips[i]) return;
  const name = clips[i].name;
  clips.splice(i, 1);
  if (sel >= i && sel > 0) sel--;
  structural();
  status(`Removed ${name}. Press Ctrl+Z to undo.`);
}
function moveClip(from, to) {
  if (to < 0 || to >= clips.length || from === to) return;
  const [c] = clips.splice(from, 1);
  clips.splice(to, 0, c);
  sel = to; structural();
}
async function addFiles(fileList, at) {
  const files = [...fileList].filter(f => f.type.startsWith('image/'));
  if (!files.length) { status('Those files are not images. Use JPG, PNG, WebP or GIF.'); return; }
  status(`Loading ${files.length} photo${files.length > 1 ? 's' : ''}…`);
  const added = [];
  for (const f of files) {
    try {
      const im = await loadImage(f);
      const id = uid();
      media.set(id, { img: im, blob: f, thumb: makeThumb(im), sample: null });
      added.push(normClip({ id, name: f.name.replace(/\.[^.]+$/, '') || 'Photo', dur: 3, beats: S.music.beats, caption: '', seed: (Math.random() * 1000) | 0, sample: null }));
    } catch (e) { /* skip unreadable file */ }
  }
  if (!added.length) { status('Could not read those images.'); return; }
  const onlySamples = clips.length && clips.every(c => c.sample != null);
  if (onlySamples) { clips = added; sel = 0; }
  else { const pos = at == null ? clips.length : at; clips.splice(pos, 0, ...added); sel = pos; }
  view = 'still';
  structural();
  status(`Added ${added.length} photo${added.length > 1 ? 's' : ''}${onlySamples ? ' (sample clips removed)' : ''}`);
}
async function replaceClip(file) {
  const c = clips[sel];
  if (!c || !file) return;
  try {
    const im = await loadImage(file);
    const id = uid();
    media.set(id, { img: im, blob: file, thumb: makeThumb(im), sample: null });
    clips[sel] = { ...c, id, name: file.name.replace(/\.[^.]+$/, '') || c.name, sample: null };
    structural(); status('Photo replaced');
  } catch (e) { status('Could not read that image.'); }
}

function updateClipPanel() {
  const c = clips[sel], has = !!c;
  $('clipTitle').textContent = has ? `Clip ${sel + 1} of ${clips.length}` : 'No clips yet';
  ['clipCaption', 'clipDur', 'clipBeats', 'clipZoom', 'clipFrameReset', 'clipSeed', 'clipSeedShuffle', 'clipReplace', 'clipDup', 'clipRemove'].forEach(id => { $(id).disabled = !has; });
  $('clipLeft').disabled = !has || sel === 0;
  $('clipLook').disabled = !has;
  $('clipRight').disabled = !has || sel === clips.length - 1;
  activate();
  if (!has) return;
  if (document.activeElement !== $('clipCaption')) $('clipCaption').value = c.caption;
  $('clipDur').value = c.dur; $('clipDurOut').textContent = c.dur.toFixed(1) + ' s'; setFill($('clipDur'));
  $('clipDurRow').hidden = synced(); $('clipBeatsRow').hidden = !synced();
  $('clipBeats').value = c.beats; $('clipBeatsOut').textContent = `${c.beats} (${(c.beats * spb()).toFixed(2)} s)`; setFill($('clipBeats'));
  $('clipSeed').value = c.seed;
  $('clipZoom').value = c.zoom; $('clipZoomOut').textContent = c.zoom.toFixed(2) + '×'; setFill($('clipZoom'));
}
function clipEdited(refreshStrip) {
  if (refreshStrip) buildStrip();
  persistClips(); pushHistory(); requestRender();
}
$('clipCaption').addEventListener('input', e => {
  if (!clips[sel]) return;
  const had = !!clips[sel].caption.trim();
  clips[sel].caption = e.target.value;
  clipEdited(had !== !!e.target.value.trim());
});
$('clipDur').addEventListener('input', e => {
  if (!clips[sel]) return;
  clips[sel].dur = +e.target.value; $('clipDurOut').textContent = clips[sel].dur.toFixed(1) + ' s'; setFill(e.target);
  const card = $('strip').children[sel];
  if (card) { card.style.width = Math.max(72, Math.round(cdur(clips[sel]) * PX_PER_S)) + 'px'; card.querySelector('.dur').textContent = durLabel(clips[sel]); }
  updateTime(); clipEdited(false);
});
$('clipBeats').addEventListener('input', e => {
  if (!clips[sel]) return;
  clips[sel].beats = +e.target.value; setFill(e.target);
  $('clipBeatsOut').textContent = `${clips[sel].beats} (${(clips[sel].beats * spb()).toFixed(2)} s)`;
  const card = $('strip').children[sel];
  if (card) { card.style.width = Math.max(72, Math.round(cdur(clips[sel]) * PX_PER_S)) + 'px'; card.querySelector('.dur').textContent = durLabel(clips[sel]); }
  updateTime(); drawWave(); clipEdited(false);
});
$('clipSeed').addEventListener('input', e => { if (!clips[sel]) return; clips[sel].seed = clamp(e.target.value | 0, 0, 9999); clipEdited(false); });
$('clipSeedShuffle').onclick = () => { if (!clips[sel]) return; clips[sel].seed = (Math.random() * 10000) | 0; updateClipPanel(); clipEdited(false); };
/* framing: drag the preview to move the photo, scroll to zoom */
function framingRange(c) {
  const [W, H] = dims(PREVIEW_LONG), prevS = S;
  S = lookFor(sel);
  const P = photoRect(W, H);
  S = prevS;
  const im = img(c), sw = im.naturalWidth || im.width, sh = im.naturalHeight || im.height;
  const w = P.w * (1 + 2 * M), h = P.h * (1 + 2 * M), sc = Math.max(w / sw, h / sh) * lookFor(sel).frame.zoom * c.zoom;
  return { rx: sw * sc - w, ry: sh * sc - h, scale: W / cv.getBoundingClientRect().width };
}
function setFraming(c, patch) {
  Object.assign(c, patch);
  c.fx = clamp(c.fx, 0, 1); c.fy = clamp(c.fy, 0, 1); c.zoom = clamp(c.zoom, 1, 4);
  $('clipZoom').value = c.zoom; $('clipZoomOut').textContent = c.zoom.toFixed(2) + '×'; setFill($('clipZoom'));
  requestRender();
}
let drag = null;
cv.style.touchAction = 'none';
cv.addEventListener('pointerdown', e => {
  const c = clips[sel];
  if (!c || playing || comparing || e.button !== 0) return;
  if (view !== 'still') { view = 'still'; updateTime(); }
  const r = framingRange(c);
  drag = { id: e.pointerId, x: e.clientX, y: e.clientY, fx: c.fx, fy: c.fy, r };
  cv.setPointerCapture(e.pointerId); cv.classList.add('dragging');
});
cv.addEventListener('pointermove', e => {
  if (!drag || e.pointerId !== drag.id) return;
  const c = clips[sel], dx = (e.clientX - drag.x) * drag.r.scale, dy = (e.clientY - drag.y) * drag.r.scale;
  setFraming(c, { fx: drag.r.rx > 0 ? drag.fx - dx / drag.r.rx : c.fx, fy: drag.r.ry > 0 ? drag.fy - dy / drag.r.ry : c.fy });
});
const endDrag = () => { if (!drag) return; drag = null; cv.classList.remove('dragging'); persistClips(); pushHistory(); };
cv.addEventListener('pointerup', endDrag);
cv.addEventListener('pointercancel', endDrag);
cv.addEventListener('wheel', e => {
  const c = clips[sel];
  if (!c || playing) return;
  e.preventDefault();
  if (view !== 'still') { view = 'still'; updateTime(); }
  setFraming(c, { zoom: c.zoom * Math.exp(-e.deltaY * 0.0015) });
  clearTimeout(cv._wt); cv._wt = setTimeout(() => { persistClips(); pushHistory(); }, 300);
}, { passive: false });
$('clipZoom').addEventListener('input', e => { const c = clips[sel]; if (!c) return; if (view !== 'still') view = 'still'; setFraming(c, { zoom: +e.target.value }); persistClips(); pushHistory(); });
$('clipFrameReset').onclick = () => { const c = clips[sel]; if (!c) return; setFraming(c, { fx: 0.5, fy: 0.5, zoom: 1 }); persistClips(); pushHistory(); status('Framing reset'); };
$('clipLook').onchange = e => {
  const c = clips[sel]; if (!c) return;
  c.look = e.target.value === 'own' ? lookOf(G) : null;
  lookChanged(c.look ? `Clip ${sel + 1} now has its own look. The panels below edit only this clip.` : `Clip ${sel + 1} uses the sequence look again`);
};
$('clipLeft').onclick = () => moveClip(sel, sel - 1);
$('clipRight').onclick = () => moveClip(sel, sel + 1);
$('clipRemove').onclick = () => removeClip(sel);
$('clipReplace').onclick = () => $('fileReplace').click();
$('clipDup').onclick = () => { const c = clips[sel]; if (!c) return; clips.splice(sel + 1, 0, { ...c, seed: (c.seed + 211) % 10000 }); sel++; structural(); };
$('fileAdd').onchange = e => { addFiles(e.target.files); e.target.value = ''; };
$('fileReplace').onchange = e => { replaceClip(e.target.files[0]); e.target.value = ''; };
$('addBtn').onclick = () => $('fileAdd').click();

/* reorder by dragging cards */
let dragId = null;
const strip = $('strip');
strip.addEventListener('dragstart', e => {
  const li = e.target.closest('.card[data-id]');
  if (!li) return;
  dragId = li.dataset.id;
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/x-clip', dragId);
});
strip.addEventListener('dragover', e => {
  if (!dragId) return;
  const li = e.target.closest('.card[data-id]');
  e.preventDefault();
  strip.querySelectorAll('.drop-before,.drop-after').forEach(el => el.classList.remove('drop-before', 'drop-after'));
  if (li) { const r = li.getBoundingClientRect(); li.classList.add(e.clientX < r.left + r.width / 2 ? 'drop-before' : 'drop-after'); }
});
strip.addEventListener('drop', e => {
  if (!dragId) return;
  e.preventDefault(); e.stopPropagation();
  const li = e.target.closest('.card[data-id]');
  const from = clips.findIndex(c => c.id === dragId);
  if (li && from >= 0) {
    let to = clips.findIndex(c => c.id === li.dataset.id);
    if (li.classList.contains('drop-after')) to++;
    if (from < to) to--;
    moveClip(from, clamp(to, 0, clips.length - 1));
  }
  dragId = null;
  strip.querySelectorAll('.drop-before,.drop-after').forEach(el => el.classList.remove('drop-before', 'drop-after'));
});
strip.addEventListener('dragend', () => { dragId = null; strip.querySelectorAll('.drop-before,.drop-after').forEach(el => el.classList.remove('drop-before', 'drop-after')); });

/* ---------- controls ---------- */
const Rg = (k, label, min, max, step, dec = 2, extra = {}) => ({ k, label, type: 'range', min, max, step, dec, ...extra });
const isGrid = () => S.cut.layout === 'grid';
const SCHEMA = [
  { id: 'frame', title: 'Canvas', items: [
    { k: 'aspect', label: 'Format', type: 'chips', options: [['4:5', 'Instagram 4:5'], ['9:16', 'Story 9:16'], ['16:9', 'YouTube 16:9'], ['1:1', 'Square'], ['3:4', '3:4'], ['photo', 'Match photo']] },
    { k: 'size', label: 'Image export size', type: 'select', num: true, options: [[1080, '1080 px'], [1440, '1440 px'], [2048, '2048 px'], [3840, '3840 px']] },
    Rg('border', 'Border', 0, 0.25, 0.005),
    Rg('zoom', 'Photo zoom', 1, 2.5, 0.01),
  ] },
  { id: 'bg', title: 'Background', items: [
    { k: 'type', label: 'Surface', type: 'select', options: [['paper', 'Paper'], ['cardboard', 'Cardboard'], ['cork', 'Cork board'], ['concrete', 'Concrete'], ['desk', 'Dark desk'], ['custom', 'My image']] },
    { k: 'color', label: 'Paper color', type: 'color', show: () => S.bg.type === 'paper' || (S.bg.type === 'custom' && !customBg) },
    { type: 'button', label: 'Choose background image', action: () => $('fileBg').click(), show: () => S.bg.type === 'custom' },
  ] },
  { id: 'photo', title: 'Photo', items: [
    Rg('brightness', 'Brightness', -0.3, 0.3, 0.01), Rg('contrast', 'Contrast', 0.5, 1.6, 0.01),
    Rg('saturation', 'Saturation', 0, 1.8, 0.01), Rg('warmth', 'Warmth', -1, 1, 0.01),
  ] },
  { id: 'scan', title: 'Paper scan', toggle: true, items: [
    Rg('opacity', 'Opacity', 0, 1, 0.01), Rg('grain', 'Grain', 0, 1, 0.01), Rg('grainSize', 'Grain size', 1, 4, 0.5, 1),
    Rg('fibers', 'Fibers', 0, 1, 0.01), Rg('stains', 'Stains and falloff', 0, 1, 0.01),
    { type: 'button', label: 'Load my own paper scan', action: () => $('fileTex').click() },
    { k: 'custom', label: 'Use my paper scan', type: 'toggle', show: () => !!customTex },
  ] },
  { id: 'cut', title: 'Paper cutout', toggle: true, items: [
    { k: 'layout', label: 'Layout', type: 'select', options: [['grid', 'Strips and grid'], ['half', 'Ripped in half']] },
    Rg('columns', 'Columns', 1, 8, 1, 0, { show: isGrid }), Rg('rows', 'Rows', 1, 8, 1, 0, { show: isGrid }),
    Rg('angle', 'Cut angle', -45, 45, 1, 0, { unit: '°' }),
    Rg('ripGap', 'Rip gap', 0, 0.15, 0.005, 3, { show: () => !isGrid() }),
    Rg('missing', 'Missing pieces', 0, 0.6, 0.01, 2, { show: isGrid }),
    Rg('seed', 'Seed', 0, 999, 1, 0),
    { k: 'mix', label: 'Mix photos from the sequence', type: 'toggle' },
    { k: 'mixFit', label: 'Each mixed photo fills', type: 'select', options: [['frame', 'The whole frame'], ['strip', 'Its own strip']], show: () => S.cut.mix },
    { group: 'Variation' },
    Rg('rotation', 'Rotation', 0, 6, 0.05, 1, { unit: '°' }), Rg('sizeVar', 'Size variation', 0, 1, 0.01),
    Rg('widthVar', 'Width variation', 0, 1, 0.01), Rg('heightVar', 'Height variation', 0, 1, 0.01),
    Rg('uvShift', 'UV shift', 0, 1, 0.01), Rg('colorVar', 'Color variation', 0, 1, 0.01),
    { group: 'Edges' },
    Rg('tearSize', 'Tear size', 0, 1, 0.01), Rg('chunkSize', 'Chunk size', 0, 1, 0.01),
    Rg('roughness', 'Roughness', 0, 4, 0.01), Rg('whiteEdge', 'White edge', 0, 0.3, 0.005, 3),
    Rg('unevenness', 'Unevenness', 0, 1, 0.01), Rg('direction', 'Tear direction (one-sided fibers)', 0, 1, 0.01),
    Rg('core', 'Paper core tone', 0, 1, 0.01), Rg('shadow', 'Shadow', 0, 1, 0.01),
    { k: 'edge', label: 'Paper edge color', type: 'color' },
  ] },
  { id: 'hole', title: 'Torn hole', toggle: true, items: [
    Rg('size', 'Size', 0.05, 0.9, 0.01), Rg('x', 'Position X', 0, 1, 0.01), Rg('y', 'Position Y', 0, 1, 0.01), Rg('ragged', 'Raggedness', 0, 1, 0.01),
  ] },
  { id: 'motion', title: 'Motion', items: [
    { k: 'boil', label: 'Animate the tears (seed boil)', type: 'toggle' },
    Rg('fps', 'Tear changes per second', 1, 24, 1, 0),
    Rg('loop', 'Loop length in frames (0 = endless)', 0, 24, 1, 0, { show: () => !S.motion.keys.length }),
    { type: 'keys', label: 'Seed keyframes' },
    Rg('wobble', 'Stop-motion wobble', 0, 1, 0.01),
  ] },
  { id: 'text', title: 'Text', toggle: true, items: [
    { k: 'font', label: 'Font', type: 'select', options: [['Anton', 'Anton'], ['Archivo Black', 'Archivo Black'], ['Bebas Neue', 'Bebas Neue'], ['Permanent Marker', 'Marker'], ['Special Elite', 'Typewriter']] },
    Rg('size', 'Size', 0.03, 0.2, 0.005, 3),
    { k: 'color', label: 'Text color', type: 'color' },
    { k: 'pos', label: 'Position', type: 'select', options: [['top', 'Top'], ['middle', 'Middle'], ['bottom', 'Bottom']] },
    { k: 'anim', label: 'Animation', type: 'select', options: [['stamp', 'Stamp word by word'], ['type', 'Typewriter'], ['rise', 'Rise up'], ['fade', 'Fade in'], ['none', 'No animation']] },
    Rg('outline', 'Outline', 0, 1, 0.01), Rg('shadow', 'Shadow', 0, 1, 0.01),
    { k: 'label', label: 'Torn paper label behind text', type: 'toggle' },
    { k: 'labelColor', label: 'Label color', type: 'color', show: () => S.text.label },
    { k: 'onPaper', label: 'Print text under the paper texture', type: 'toggle' },
    { type: 'note', text: 'Write the words for each photo in the Caption box at the top of this panel.' },
  ] },
  { id: 'seq', title: 'Sequence', items: [
    { k: 'transition', label: 'Transition', type: 'select', options: [['strips', 'Strips drop in'], ['crossfade', 'Crossfade'], ['slide', 'Slide'], ['cut', 'Hard cut']] },
    Rg('trDur', 'Transition length (s)', 0, 2, 0.05),
    Rg('kb', 'Slow zoom and pan (Ken Burns)', 0, 0.3, 0.005, 3),
    { k: 'exit', label: 'Tear apart at the end of each clip', type: 'toggle', show: () => ['strips', 'cut'].includes(S.seq.transition) },
    Rg('exitDur', 'Tear-apart length (s)', 0.2, 1.5, 0.05, 2, { show: () => S.seq.exit && ['strips', 'cut'].includes(S.seq.transition) }),
    { group: 'Looks per clip' },
    { type: 'button', label: 'Give every clip a random look', action: () => randomLooks() },
    { type: 'button', label: 'Use the sequence look on every clip', action: () => clearLooks(), show: () => clips.some(c => c.look) },
  ] },
  { id: 'music', title: 'Music', toggle: true, items: [
    { type: 'music' },
    Rg('volume', 'Volume', 0, 1, 0.01, 2, { show: () => !!song }),
    Rg('start', 'Song starts at (s)', 0, 600, 0.01, 2, { show: () => !!song, after: inp => { if (synced()) { S.music.start = snapToBeat(S.music.start); inp._sync(S.music.start); } drawWave(); } }),
    Rg('offset', 'Beat offset (s)', -0.5, 0.5, 0.005, 3, { show: () => !!song, after: () => drawWave() }),
    { k: 'sync', label: 'Cut clips on the beat', type: 'toggle', show: () => !!song },
    Rg('beats', 'Beats per new clip', 1, 16, 1, 0, { show: () => !!song && S.music.sync }),
    { type: 'button', label: 'Set every clip to this many beats', show: () => !!song && S.music.sync, action: () => { clips.forEach(c => { c.beats = S.music.beats; }); changed('music'); persistClips(); status(`Every clip is now ${S.music.beats} beats long`); } },
    { type: 'meter', show: () => !!song },
    { k: 'tears', label: 'Tears change', type: 'select', options: [['hits', 'On hits in the music'], ['beat', 'On the beat grid'], ['rate', 'At a steady rate']], show: () => !!song },
    { k: 'div', label: 'Beat grid rate', type: 'select', num: true, options: [[0.5, 'Every 2 beats'], [1, 'Every beat'], [2, 'Twice per beat'], [4, '4 times per beat']], show: () => !!song && S.music.tears === 'beat' },
    Rg('sens', 'Hit sensitivity', 0, 1, 0.01, 2, { show: () => !!song, after: () => drawWave() }),
    Rg('punch', 'Punch: zoom on kicks and bass', 0, 1, 0.01, 2, { show: () => !!song }),
    Rg('spread', 'Spread: strips pull apart with the bass', 0, 1, 0.01, 2, { show: () => !!song }),
    Rg('shake', 'Shake: strips jitter when it gets loud', 0, 1, 0.01, 2, { show: () => !!song }),
    Rg('flash', 'Flash on hits', 0, 1, 0.01, 2, { show: () => !!song }),
    Rg('pop', 'Caption pop on hits', 0, 1, 0.01, 2, { show: () => !!song }),
    Rg('bump', 'Beat-grid bump', 0, 1, 0.01, 2, { show: () => !!song }),
    Rg('fade', 'Fade out at the end (s)', 0, 5, 0.1, 1, { show: () => !!song }),
  ] },
];

const inputs = {}, conds = [];
function setFill(el) { const p = (el.value - el.min) / (el.max - el.min) * 100; el.style.setProperty('--p', p + '%'); }
const fmtVal = (it, v) => (+v).toFixed(it.dec ?? 2) + (it.unit || '');
const ICON_RESET = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3 8a5 5 0 1 0 1.5-3.5M3 2.5V5h2.5"/></svg>';

function buildPanel() {
  const host = $('sections');
  host.innerHTML = '';
  for (const sec of SCHEMA) {
    const el = document.createElement('section');
    el.className = 'sec'; el.dataset.sec = sec.id;
    const head = document.createElement('header');
    head.innerHTML = `<h2>${sec.title}</h2><button class="mini" type="button" title="Reset ${sec.title}" aria-label="Reset ${sec.title}">${ICON_RESET}</button>`;
    head.querySelector('button').onclick = () => {
      const own = clips[sel] && clips[sel].look && LOOK.includes(sec.id) ? clips[sel].look : G;
      const keep = { on: own[sec.id].on, aspect: G.frame.aspect, size: G.frame.size };
      own[sec.id] = clone(DEFAULTS[sec.id]);
      if (sec.toggle) own[sec.id].on = keep.on;
      if (sec.id === 'frame') { G.frame.aspect = keep.aspect; G.frame.size = keep.size; }
      activate(true); changed(sec.id);
    };
    if (sec.toggle) {
      const sw = document.createElement('label'); sw.className = 'switch';
      sw.innerHTML = `<input type="checkbox" id="on-${sec.id}" aria-label="Turn ${sec.title} on or off"><span></span>`;
      head.append(sw);
      const cb = sw.querySelector('input');
      cb.onchange = () => { S[sec.id].on = cb.checked; el.classList.toggle('off', !cb.checked); changed(sec.id); };
      inputs[sec.id + '.on'] = cb;
    }
    el.append(head);
    const body = document.createElement('div'); body.className = 'body';
    for (const it of sec.items) body.append(buildItem(sec, it));
    el.append(body);
    host.append(el);
  }
}
function buildItem(sec, it) {
  if (it.group) { const g = document.createElement('div'); g.className = 'group'; g.textContent = it.group; return g; }
  const wrap = document.createElement('div');
  wrap.className = 'ctl';
  if (it.show) conds.push([wrap, it.show]);
  const id = it.k ? `c-${sec.id}-${it.k}` : '';
  const path = sec.id + '.' + it.k;
  const set = v => { if (sec.id === 'frame' && (it.k === 'aspect' || it.k === 'size')) G.frame[it.k] = v; else S[sec.id][it.k] = v; changed(sec.id); };
  switch (it.type) {
    case 'range': {
      wrap.innerHTML = `<label for="${id}">${it.label}</label><output for="${id}"></output><input type="range" id="${id}" min="${it.min}" max="${it.max}" step="${it.step}">`;
      const inp = wrap.querySelector('input'), out = wrap.querySelector('output');
      inp.oninput = () => { out.textContent = fmtVal(it, inp.value); setFill(inp); set(+inp.value); if (it.after) it.after(inp); };
      inp._sync = v => { inp.value = v; out.textContent = fmtVal(it, v); setFill(inp); };
      inputs[path] = inp;
      break;
    }
    case 'select': {
      wrap.innerHTML = `<label for="${id}">${it.label}</label><select id="${id}">${it.options.map(([v, t]) => `<option value="${v}">${t}</option>`).join('')}</select>`;
      const inp = wrap.querySelector('select');
      inp.onchange = () => {
        set(it.num ? +inp.value : inp.value);
        if (sec.id === 'text' && it.k === 'font') loadFont(inp.value);
        if (sec.id === 'bg' && inp.value === 'custom' && !customBg) $('fileBg').click();
      };
      inp._sync = v => { inp.value = v; };
      inputs[path] = inp;
      break;
    }
    case 'color': {
      wrap.innerHTML = `<label for="${id}">${it.label}</label><input type="color" id="${id}">`;
      const inp = wrap.querySelector('input');
      inp.oninput = () => set(inp.value);
      inp._sync = v => { inp.value = v; };
      inputs[path] = inp;
      break;
    }
    case 'toggle': {
      wrap.innerHTML = `<label for="${id}">${it.label}</label><span class="switch"><input type="checkbox" id="${id}"><span></span></span>`;
      const inp = wrap.querySelector('input');
      inp.onchange = () => set(inp.checked);
      inp._sync = v => { inp.checked = !!v; };
      inputs[path] = inp;
      break;
    }
    case 'chips': {
      wrap.classList.add('stack');
      wrap.innerHTML = `<span class="lbl">${it.label}</span><div class="chips" role="group" aria-label="${it.label}">${it.options.map(([v, t]) => `<button class="chip" type="button" data-v="${v}" aria-pressed="false">${t}</button>`).join('')}</div>`;
      const box = wrap.querySelector('.chips');
      box.onclick = e => { const b = e.target.closest('.chip'); if (b) { set(b.dataset.v); box._sync(b.dataset.v); } };
      box._sync = v => box.querySelectorAll('.chip').forEach(b => b.setAttribute('aria-pressed', b.dataset.v === v));
      inputs[path] = box;
      break;
    }
    case 'button': {
      wrap.classList.add('stack');
      wrap.innerHTML = `<button class="btn sm" type="button">${it.label}</button>`;
      wrap.querySelector('button').onclick = it.action;
      break;
    }
    case 'note': {
      wrap.classList.add('stack');
      wrap.innerHTML = `<p class="note">${it.text}</p>`;
      break;
    }
    case 'meter': {
      wrap.classList.add('stack');
      wrap.innerHTML = `<span class="lbl">Audio reactive</span>
        <canvas id="meter" width="576" height="60" aria-label="Live levels the visuals react to: bass, loudness, highs and hits"></canvas>
        <p class="note">The bars show what drives the visuals at the playhead. Ticks under the waveform mark detected hits.</p>`;
      break;
    }
    case 'music': {
      wrap.classList.add('stack');
      wrap.innerHTML = `<div class="music">
          <p class="mname" id="musicName">No music yet</p>
          <canvas id="wave" width="576" height="104" aria-label="Song waveform. Beats are marked; the highlighted part plays under the sequence. Click to choose where the song starts." hidden></canvas>
          <div class="facts" id="musicFacts"></div>
          <div class="row" id="bpmRow" hidden><label for="bpmIn">Tempo</label><input type="number" id="bpmIn" min="40" max="240" step="0.1"><span class="note">BPM</span>
            <button class="btn sm" type="button" id="tapBtn" title="Tap along with the beat to set the tempo">Tap</button><button class="btn sm" type="button" id="bpmAuto">Detect</button></div>
          <div class="row"><button class="btn sm" type="button" id="musicAdd">Add music</button><button class="btn sm danger" type="button" id="musicRemove" hidden>Remove</button></div>
        </div>`;
      break;
    }
    case 'keys': {
      wrap.classList.add('stack');
      wrap.innerHTML = `<span class="lbl">${it.label}</span><div class="chips" id="keyChips"></div>
        <div class="row" style="display:flex;gap:6px"><button class="btn sm" type="button" id="keyAdd">Add current seed</button><button class="btn sm" type="button" id="keyClear">Clear</button></div>
        <p class="note">With keyframes set, the animation steps through exactly these seeds instead of random ones.</p>`;
      wrap.querySelector('#keyAdd').onclick = () => { S.motion.keys.push(S.cut.seed); syncKeys(); changed(); };
      wrap.querySelector('#keyClear').onclick = () => { S.motion.keys = []; syncKeys(); changed(); };
      break;
    }
  }
  return wrap;
}
function syncKeys() {
  const box = $('keyChips');
  if (!box) return;
  box.innerHTML = S.motion.keys.length
    ? S.motion.keys.map((k, i) => `<span class="chip key">${k}<button type="button" data-i="${i}" aria-label="Remove keyframe ${k}">×</button></span>`).join('')
    : '<span class="note">No keyframes. Random seeds are used.</span>';
  box.querySelectorAll('button').forEach(b => { b.onclick = () => { S.motion.keys.splice(+b.dataset.i, 1); syncKeys(); changed(); }; });
}
function syncPanel() {
  for (const path in inputs) {
    const [s, k] = path.split('.'), inp = inputs[path], v = s === 'frame' && (k === 'aspect' || k === 'size') ? G.frame[k] : S[s][k];
    if (k === 'on') { inp.checked = !!v; inp.closest('.sec').classList.toggle('off', !v); }
    else if (inp._sync) inp._sync(v);
  }
  for (const [el, fn] of conds) el.hidden = !fn();
  syncKeys();
  refreshMusicUI();
}

let saveTimer;
function changed(secId) {
  for (const [el, fn] of conds) el.hidden = !fn();
  if (secId === 'music') { buildStrip(); updateClipPanel(); refreshMusicUI(); }
  if (playing && (secId === 'music' || secId === 'seq')) startAudio(T);
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => store.set('torn-settings-v2', G), 300);
  if (S !== G) persistClips();
  if ($('preset').value.startsWith('b:') || $('preset').value.startsWith('u:')) { $('preset').value = ''; $('delPreset').disabled = true; }
  pushHistory();
  updateTime();
  requestRender();
}

/* ---------- presets ---------- */
function lookOf(s) { const o = {}; for (const k of LOOK) o[k] = clone(s[k]); delete o.frame.aspect; delete o.frame.size; return o; }
function applyLook(look) {
  const m = merge(DEFAULTS, look), c = clips[sel];
  if (c && c.look) c.look = lookOf(m);
  else for (const k of LOOK) { if (k === 'frame') { m.frame.aspect = G.frame.aspect; m.frame.size = G.frame.size; } G[k] = m[k]; }
  activate(true); changed(); loadFont(S.text.font);
}
// switch the panel to the selected clip's look (or the sequence look)
let editKey = null;
function activate(force) {
  const c = clips[sel], key = c && c.look ? c.look : G;
  if (!force && key === editKey) return;
  editKey = key; S = editS();
  syncPanel(); updateLookUI();
}
function updateLookUI() {
  const c = clips[sel], own = !!(c && c.look);
  $('clipLook').value = own ? 'own' : 'seq';
  $('lookBar').hidden = !own;
  if (own) $('lookBar').textContent = `Editing the look of clip ${sel + 1} only. The other clips are not affected.`;
  $('presetLbl').textContent = own ? 'Look preset · this clip only' : 'Look preset · all clips';
}
function lookChanged(msg) { activate(true); buildStrip(); persistClips(); pushHistory(); requestRender(); if (msg) status(msg); }
function randomLooks() {
  const pool = PRESETS.filter(p => p[0] !== 'Clean scan').map(p => p[1]);
  for (let i = pool.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; [pool[i], pool[j]] = [pool[j], pool[i]]; }
  clips.forEach((c, i) => { const l = lookOf(merge(DEFAULTS, pool[i % pool.length])); l.text = clone(G.text); l.motion = clone(G.motion); c.look = l; });
  lookChanged(`Gave ${clips.length} clips a random look. Select a clip to fine-tune it.`);
}
function clearLooks() { clips.forEach(c => { c.look = null; }); lookChanged('Every clip now uses the sequence look'); }
function buildPresets(selected = '') {
  const u = Object.keys(userPresets);
  $('preset').innerHTML = '<option value="">Custom look</option><optgroup label="Built-in">' +
    PRESETS.map((p, i) => `<option value="b:${i}">${p[0]}</option>`).join('') + '</optgroup>' +
    (u.length ? '<optgroup label="My presets">' + u.map(n => `<option value="u:${esc(n)}">${esc(n)}</option>`).join('') + '</optgroup>' : '');
  $('preset').value = selected;
  $('delPreset').disabled = !selected.startsWith('u:');
}
$('preset').onchange = e => {
  const v = e.target.value;
  if (!v) return;
  applyLook(v.startsWith('b:') ? PRESETS[+v.slice(2)][1] : userPresets[v.slice(2)]);
  $('preset').value = v;
  $('delPreset').disabled = !v.startsWith('u:');
};
$('savePreset').onclick = () => {
  openDlg(`<h3>Save preset</h3><p>Saves the current look (everything except the canvas format and sequence timing) in this browser.</p>
    <label class="lbl" for="presetName">Preset name</label><input type="text" id="presetName" maxlength="40" placeholder="e.g. Zine cover">
    <p id="presetErr" hidden style="color:var(--danger)">Type a name for the preset.</p>
    <div class="row"><button class="btn" type="button" data-close>Cancel</button><button class="btn primary" type="button" id="presetOk">Save preset</button></div>`);
  const inp = $('presetName'); inp.focus();
  const ok = () => {
    const n = inp.value.trim();
    if (!n) { $('presetErr').hidden = false; return; }
    userPresets[n] = lookOf(S); store.set('torn-user-presets', userPresets);
    buildPresets('u:' + n); dlg.close(); status(`Saved preset “${n}”`);
  };
  $('presetOk').onclick = ok;
  inp.onkeydown = e => { if (e.key === 'Enter') ok(); };
};
$('delPreset').onclick = () => {
  const v = $('preset').value;
  if (!v.startsWith('u:')) return;
  const n = v.slice(2);
  openDlg(`<h3>Delete preset</h3><p>Delete “${esc(n)}”? This cannot be undone.</p>
    <div class="row"><button class="btn" type="button" data-close>Keep it</button><button class="btn primary" type="button" id="delOk">Delete preset</button></div>`);
  $('delOk').onclick = () => { delete userPresets[n]; store.set('torn-user-presets', userPresets); buildPresets(''); dlg.close(); status('Preset deleted'); };
};
$('copyPreset').onclick = () => {
  const code = 'torn:' + btoa(unescape(encodeURIComponent(JSON.stringify(lookOf(S)))));
  const show = () => {
    openDlg(`<h3>Preset code</h3><p>Copy this code and share it. Anyone can load it with “Load preset code”.</p>
      <textarea id="codeOut" readonly aria-label="Preset code">${code}</textarea><div class="row"><button class="btn" type="button" data-close>Close</button></div>`);
    $('codeOut').select();
  };
  if (navigator.clipboard) navigator.clipboard.writeText(code).then(() => status('Preset code copied'), show); else show();
};
$('pastePreset').onclick = () => {
  openDlg(`<h3>Load preset code</h3><p>Paste a code that starts with <code>torn:</code>.</p>
    <textarea id="codeIn" aria-label="Preset code" placeholder="torn:eyJmcmFtZSI6..."></textarea>
    <p id="codeErr" hidden style="color:var(--danger)">That code is not a valid preset. Check that it was copied in full.</p>
    <div class="row"><button class="btn" type="button" data-close>Cancel</button><button class="btn primary" type="button" id="codeApply">Apply preset</button></div>`);
  $('codeIn').focus();
  $('codeApply').onclick = () => {
    try {
      const raw = $('codeIn').value.trim().replace(/^torn:/, '');
      const obj = JSON.parse(raw.startsWith('{') ? raw : decodeURIComponent(escape(atob(raw))));
      applyLook(obj); buildPresets(''); dlg.close(); status('Preset loaded');
    } catch (e) { $('codeErr').hidden = false; }
  };
};

/* ---------- templates ---------- */
const TEMPLATES = [
  { name: '3-photo reel', desc: 'Vertical reel. Strips drop in, words stamp on, then the strips tear away.', aspect: '9:16', look: 'Torn strips',
    seq: { transition: 'strips', trDur: 0.6, kb: 0.08, exit: true, exitDur: 0.45 }, text: { anim: 'stamp', pos: 'top', size: 0.11 }, dur: 2.5, beats: 4,
    captions: ['Your title here', 'Second line', 'Last word'] },
  { name: 'Beat montage', desc: 'Hard cuts every two beats. Tears swap on every hit, the frame punches on kicks and strips spread with the bass. Add music first.', aspect: '9:16', look: 'Diagonal tear',
    seq: { transition: 'cut', trDur: 0, kb: 0.04, exit: false }, music: { sync: true, beats: 2, tears: 'hits', punch: 0.7, spread: 0.35, shake: 0.25, flash: 0.2, pop: 0.6, bump: 0 }, text: { anim: 'stamp', pos: 'middle' }, dur: 0.9, beats: 2 },
  { name: 'Zine slideshow', desc: 'Cardboard backdrop, torn yellow labels typed on, slow crossfades.', aspect: '4:5', look: 'Cardboard zine',
    seq: { transition: 'crossfade', trDur: 0.8, kb: 0.05, exit: false }, text: { anim: 'type', pos: 'bottom' }, dur: 3.5, beats: 8,
    captions: ['Issue 01', 'Collected moments', 'The end'] },
  { name: 'Story teaser', desc: 'Every photo ripped in half, captions rise from the bottom.', aspect: '9:16', look: 'Ripped in half',
    seq: { transition: 'strips', trDur: 0.7, kb: 0.06, exit: true, exitDur: 0.5 }, text: { anim: 'rise', pos: 'bottom' }, dur: 3, beats: 4,
    captions: ['Coming soon'] },
  { name: 'Photo dump', desc: 'Square collage grid that mixes all your photos, with quick crossfades.', aspect: '1:1', look: 'Collage grid', cut: { mix: true },
    seq: { transition: 'crossfade', trDur: 0.4, kb: 0.03, exit: false }, text: { anim: 'fade', pos: 'middle' }, dur: 2, beats: 4 },
  { name: 'YouTube intro', desc: 'Wide 16:9 frame, diagonal tears and a big title stamped in the middle.', aspect: '16:9', look: 'Diagonal tear',
    seq: { transition: 'strips', trDur: 0.7, kb: 0.05, exit: true, exitDur: 0.4 }, text: { anim: 'stamp', pos: 'middle', size: 0.14 }, dur: 3, beats: 8,
    captions: ['Channel name'] },
];
function applyTemplate(t) {
  commitHistory();
  const preset = PRESETS.find(p => p[0] === t.look);
  const m = merge(DEFAULTS, preset ? preset[1] : {});
  for (const k of LOOK) G[k] = m[k];
  G.frame.aspect = t.aspect;
  Object.assign(G.seq, t.seq);
  if (t.music) Object.assign(G.music, t.music);
  if (t.text) Object.assign(G.text, t.text);
  if (t.cut) Object.assign(G.cut, t.cut);
  const blank = clips.every(c => !c.caption.trim());
  clips.forEach((c, i) => {
    c.look = null; c.dur = t.dur; c.beats = t.beats;
    if (blank && t.captions && t.captions[i]) c.caption = t.captions[i];
  });
  editKey = null; activate(true);
  buildStrip(); updateClipPanel(); persistClips(); changed('music'); loadFont(G.text.font);
  status(`Applied “${t.name}” to ${clips.length} photo${clips.length > 1 ? 's' : ''}.${blank && t.captions ? ' Edit the sample captions in the Clip panel.' : ''}${t.music && !song ? ' Add music to cut on the beat.' : ''}`);
}
function openTemplates() {
  const ar = a => { const [w, h] = a.split(':').map(Number); return `${w} / ${h}`; };
  openDlg(`<h3>Templates</h3>
    <p>A template sets the format, look, timing, transitions and caption style for all ${clips.length} photos. Your photos stay in their order, and Ctrl+Z undoes it.</p>
    <div class="tpls">${TEMPLATES.map((t, i) => `<button class="tpl" type="button" data-i="${i}">
      <span class="tpl-shape" style="aspect-ratio:${ar(t.aspect)}"></span>
      <span class="tpl-txt"><b>${esc(t.name)}</b><span>${esc(t.desc)}</span><i>${t.aspect} · ${t.music ? t.beats + ' beats' : t.dur + ' s'} per photo · ${esc(t.look)}</i></span></button>`).join('')}</div>
    <div class="row"><button class="btn" type="button" data-close>Close</button></div>`);
  dlgBody.querySelectorAll('.tpl').forEach(b => { b.onclick = () => { applyTemplate(TEMPLATES[+b.dataset.i]); dlg.close(); }; });
}
$('tplBtn').onclick = () => { if (playing) setPlaying(false); openTemplates(); };

/* ---------- undo / redo ---------- */
const hist = [], redo = [];
let lastSnap = '', histTimer = 0;
const snapshot = () => JSON.stringify({ S: G, clips, sel });
function commitHistory() {
  clearTimeout(histTimer); histTimer = 0;
  const s = snapshot();
  if (s === lastSnap) return;
  hist.push(lastSnap); if (hist.length > 150) hist.shift();
  lastSnap = s; redo.length = 0; updUndo();
}
function pushHistory() { clearTimeout(histTimer); histTimer = setTimeout(commitHistory, 350); }
function restoreSnap(s) {
  const o = JSON.parse(s);
  G = merge(DEFAULTS, o.S);
  clips = o.clips.filter(c => media.has(c.id));
  sel = clamp(o.sel, 0, Math.max(0, clips.length - 1));
  lastSnap = s;
  activate(true); buildStrip(); updateClipPanel(); persistClips(); photoCache.clear();
  store.set('torn-settings-v2', G); loadFont(S.text.font);
  $('preset').value = ''; updUndo(); requestRender();
}
function undo() { if (histTimer) commitHistory(); if (!hist.length) return; redo.push(lastSnap); restoreSnap(hist.pop()); status('Undone'); }
function redoFn() { if (!redo.length) return; hist.push(lastSnap); restoreSnap(redo.pop()); status('Redone'); }
function updUndo() { $('undoBtn').disabled = !hist.length; $('redoBtn').disabled = !redo.length; }
$('undoBtn').onclick = undo;
$('redoBtn').onclick = redoFn;

/* ---------- fonts ---------- */
function loadFont(name) {
  if (!document.fonts || !document.fonts.load) return;
  document.fonts.load(`64px "${name}"`).then(() => requestRender(), () => {});
}

/* ---------- output: saving files ---------- */
async function saveBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = name; document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
  status('Saved ' + name);
}
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(u8) { let c = 0xffffffff; for (let i = 0; i < u8.length; i++) c = CRC[(c ^ u8[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
async function makeZip(files) {
  const parts = [], central = [];
  let offset = 0;
  const enc = new TextEncoder();
  for (const f of files) {
    const data = new Uint8Array(await f.blob.arrayBuffer()), name = enc.encode(f.name), crc = crc32(data);
    const h = new DataView(new ArrayBuffer(30));
    h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(8, 0, true); h.setUint16(12, 33, true);
    h.setUint32(14, crc, true); h.setUint32(18, data.length, true); h.setUint32(22, data.length, true); h.setUint16(26, name.length, true);
    parts.push(h, name, data);
    const c = new DataView(new ArrayBuffer(46));
    c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(14, 33, true);
    c.setUint32(16, crc, true); c.setUint32(20, data.length, true); c.setUint32(24, data.length, true); c.setUint16(28, name.length, true);
    c.setUint32(42, offset, true);
    central.push(c, name);
    offset += 30 + name.length + data.length;
  }
  const size = central.reduce((a, p) => a + p.byteLength, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
  end.setUint32(12, size, true); end.setUint32(16, offset, true);
  return new Blob([...parts, ...central, end], { type: 'application/zip' });
}
const toBlob = (c, type = 'image/png', q) => new Promise(r => c.toBlob(r, type, q));
const safeName = s => (s || 'photo').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').slice(0, 40) || 'photo';

/* ---------- export dialog ---------- */
const dlg = $('dlg'), dlgBody = $('dlgBody');
function openDlg(html) { dlgBody.innerHTML = html; if (!dlg.open) dlg.showModal(); }
dlg.addEventListener('click', e => { if (e.target.closest('[data-close]') || (e.target === dlg && !job)) dlg.close(); });
dlg.addEventListener('cancel', e => { if (job) e.preventDefault(); });

let job = null;
const canMP4 = () => typeof VideoEncoder !== 'undefined' && typeof VideoFrame !== 'undefined' && typeof Mp4Muxer !== 'undefined';
const canRec = () => typeof MediaRecorder !== 'undefined' && !!HTMLCanvasElement.prototype.captureStream;
let exTab = 'video';
const exOpts = Object.assign({ vres: 1080, vfps: 30, gsize: 720, gfps: 12, cn: 3, cper: 1, csrc: 'seq', csize: 1080, formats: [], pngWhat: 'cover' }, store.get('torn-export') || {});
const FORMATS = [['9:16', '9:16 Reels'], ['4:5', '4:5 Feed'], ['1:1', '1:1 Square'], ['16:9', '16:9 YouTube'], ['photo', 'Match photo']];
function exFormats() {
  const f = (exOpts.formats || []).filter(v => FORMATS.some(o => o[0] === v));
  return f.length ? f : [G.frame.aspect];
}
function carouselDims() {
  let [w, h] = dims(exOpts.csize, 'short');
  const maxW = 16000;
  if (w * exOpts.cn > maxW) { const k = maxW / (w * exOpts.cn); w = Math.floor(w * k / 2) * 2; h = Math.floor(h * k / 2) * 2; }
  return [w, h];
}

function openExport() {
  if (!clips.length) { status('Add at least one photo before exporting.'); return; }
  if (playing) setPlaying(false);
  commitHistory();
  const tabs = [['video', 'Video'], ['gif', 'GIF'], ['png', 'Image'], ['zip', 'Batch ZIP'], ['carousel', 'Carousel']];
  openDlg(`<h3>Export</h3>
    <div class="tabs" role="tablist">${tabs.map(([k, t]) => `<button type="button" role="tab" data-tab="${k}" aria-selected="${k === exTab}">${t}</button>`).join('')}</div>
    <div id="exPane"></div>
    <div class="progress" id="exProg" hidden><i></i></div>
    <p id="exMsg" hidden></p>
    <div class="row"><button class="btn" type="button" id="exCancel">Close</button><button class="btn primary" type="button" id="exGo">Export</button></div>`);
  dlgBody.querySelector('.tabs').onclick = e => { const b = e.target.closest('[data-tab]'); if (b && !job) { exTab = b.dataset.tab; openExport(); } };
  $('exCancel').onclick = () => { if (job) { job.cancelled = true; } else dlg.close(); };
  renderExPane();
}
function renderExPane() {
  const tot = totalDur(), n = clips.length;
  const pane = $('exPane');
  const sel_ = (id, opts, v) => `<select id="${id}">${opts.map(([a, b]) => `<option value="${a}"${+a === +v ? ' selected' : ''}>${b}</option>`).join('')}</select>`;
  if (exTab === 'video') {
    const [W, H] = dims(exOpts.vres, 'short');
    const how = canMP4() ? 'MP4 (H.264), rendered frame by frame, faster than real time' : canRec() ? 'WebM, recorded in real time (this browser has no WebCodecs)' : 'This browser cannot export video. Try Chrome or Edge';
    pane.innerHTML = `<div class="opts">
      <label>Resolution ${sel_('exRes', [[720, '720p'], [1080, '1080p (Full HD)'], [1440, '1440p (2K)'], [2160, '2160p (4K)']], exOpts.vres)}</label>
      <label>Frame rate ${sel_('exFps', [[24, '24 fps'], [30, '30 fps'], [60, '60 fps']], exOpts.vfps)}</label></div>
      <span class="lbl">Formats</span>
      <div class="chips" id="exFmts">${FORMATS.filter(([v]) => v !== 'photo' || G.frame.aspect === 'photo').map(([v, t]) => `<button class="chip" type="button" data-v="${v}" aria-pressed="${exFormats().includes(v)}">${t}</button>`).join('')}</div>
      <div class="facts">${exFormats().length > 1 ? `<span><b>${exFormats().length}</b> videos in one ZIP${G.seq.cover ? ', each with a cover PNG' : ''}</span>` : `<span><b>${W}×${H}</b></span>`}<span><b>${fmtT(tot)}</b> long</span><span><b>${n}</b> clip${n > 1 ? 's' : ''}</span><span><b>${Math.round(tot * exOpts.vfps)}</b> frames each</span></div>
      <p>${how}. ${song && S.music.on ? `Includes the music “${esc(song.name)}”.` : 'No music (add a song in the Music section).'}</p>`;
    $('exGo').disabled = !canMP4() && !canRec();
    $('exFmts').onclick = e => {
      const b = e.target.closest('.chip'); if (!b) return;
      let f = exFormats().slice();
      f = f.includes(b.dataset.v) ? f.filter(v => v !== b.dataset.v) : f.concat(b.dataset.v);
      if (!f.length) return;
      exOpts.formats = f; store.set('torn-export', exOpts); renderExPane();
    };
  } else if (exTab === 'gif') {
    const [W, H] = dims(exOpts.gsize, 'long');
    pane.innerHTML = `<div class="opts">
      <label>Size ${sel_('exGSize', [[360, '360 px'], [480, '480 px'], [720, '720 px'], [1080, '1080 px']], exOpts.gsize)}</label>
      <label>Frame rate ${sel_('exGFps', [[8, '8 fps'], [10, '10 fps'], [12, '12 fps'], [15, '15 fps'], [20, '20 fps']], exOpts.gfps)}</label></div>
      <div class="facts"><span><b>${W}×${H}</b></span><span><b>${fmtT(tot)}</b> long</span><span><b>${Math.round(tot * exOpts.gfps)}</b> frames</span></div>
      <p>GIFs loop forever and use 256 colors per frame. Large sizes make big files; 480 or 720 px suits most chats.</p>`;
    $('exGo').disabled = typeof gifenc === 'undefined';
  } else if (exTab === 'png') {
    const [W, H] = dims(G.frame.size);
    const what = view === 'time' ? `the frame at ${fmtT(T)}` : `clip ${sel + 1} (${esc(clips[sel].name)})`;
    const cov = coverRef();
    pane.innerHTML = `<div class="opts"><label>Export <select id="exPng">
        <option value="view"${!cov || exOpts.pngWhat !== 'cover' ? ' selected' : ''}>What the preview shows: ${what}</option>
        ${cov ? `<option value="cover"${exOpts.pngWhat === 'cover' ? ' selected' : ''}>The cover frame (${cov.k != null ? 'clip ' + (cov.k + 1) : fmtT(cov.t)})</option>` : ''}</select></label></div>
      <div class="facts"><span><b>${W}×${H}</b> PNG</span></div>
      <p>${cov ? '' : 'Tip: use Set cover under the preview to pick a cover frame for Reels and TikTok. '}Change the size under Canvas → Image export size.</p>`;
    const ep = $('exPng'); ep.onchange = () => { exOpts.pngWhat = ep.value; store.set('torn-export', exOpts); };
    $('exGo').disabled = false;
  } else if (exTab === 'carousel') {
    const [w, h] = carouselDims();
    pane.innerHTML = `<div class="opts">
      <label>Slides ${sel_('exCn', [2, 3, 4, 5, 6, 7, 8, 9, 10].map(v => [v, v + ' slides']), exOpts.cn)}</label>
      <label>Strips per slide ${sel_('exCper', [[1, '1 strip'], [2, '2 strips'], [3, '3 strips'], [4, '4 strips']], exOpts.cper)}</label>
      <label>Photos <select id="exCsrc"><option value="seq"${exOpts.csrc === 'seq' ? ' selected' : ''}>Your photos, one per strip</option><option value="photo"${exOpts.csrc === 'photo' ? ' selected' : ''}>Selected photo as a panorama</option></select></label>
      <label>Slide size ${sel_('exCsize', [[720, '720 px'], [1080, '1080 px'], [1440, '1440 px']], exOpts.csize)}</label></div>
      <div class="facts"><span><b>${exOpts.cn}</b> slides</span><span><b>${w}×${h}</b> each</span><span>panorama <b>${w * exOpts.cn}×${h}</b></span></div>
      <p>One long torn collage, cut into slides so the tears carry on from one slide to the next as people swipe. Uses the canvas format (Instagram carousels suit 4:5) and the look of the selected clip. ${exOpts.csrc === 'photo' ? 'A wide panorama photo works best.' : `Your ${n} photo${n > 1 ? 's repeat' : ' repeats'} in order if there are more strips than photos.`}</p>`;
    $('exGo').disabled = false;
    const cs = $('exCsrc'); cs.onchange = () => { exOpts.csrc = cs.value; store.set('torn-export', exOpts); renderExPane(); };
  } else {
    const [W, H] = dims(G.frame.size);
    pane.innerHTML = `<div class="facts"><span><b>${n}</b> PNG${n > 1 ? 's' : ''}</span><span><b>${W}×${H}</b></span></div>
      <p>Applies the current look to every photo in the sequence and packs them into one ZIP file, numbered in sequence order.</p>`;
    $('exGo').disabled = false;
  }
  const hook = (id, key) => { const el = $(id); if (el) el.onchange = () => { exOpts[key] = +el.value; store.set('torn-export', exOpts); renderExPane(); }; };
  hook('exRes', 'vres'); hook('exFps', 'vfps'); hook('exGSize', 'gsize'); hook('exGFps', 'gfps');
  hook('exCn', 'cn'); hook('exCper', 'cper'); hook('exCsize', 'csize');
  $('exGo').onclick = runExport;
}
function progress(p, msg) {
  const bar = $('exProg'); if (!bar) return;
  bar.hidden = false; bar.firstChild.style.width = (clamp(p, 0, 1) * 100).toFixed(1) + '%';
  if (msg) { $('exMsg').hidden = false; $('exMsg').textContent = msg; }
}
async function runExport() {
  if (job) return;
  job = { cancelled: false };
  $('exGo').disabled = true; $('exCancel').textContent = 'Cancel';
  dlgBody.querySelectorAll('.tabs button, #exPane select').forEach(b => { b.disabled = true; });
  const t0 = performance.now();
  try {
    let blob, name, kind, prev = null;
    const base = safeName(clips.length === 1 ? clips[0].name : 'torn-sequence');
    if (exTab === 'video') {
      const fm = exFormats(), keep = G.frame.aspect, outs = [], ext = canMP4() ? 'mp4' : 'webm';
      try {
        for (let i = 0; i < fm.length; i++) {
          G.frame.aspect = fm[i];
          const [W, H] = dims(exOpts.vres, 'short'), tag = fm[i] === 'photo' ? 'photo' : fm[i].replace(':', 'x');
          if (fm.length > 1) { progress(0, `Video ${i + 1} of ${fm.length} (${fm[i]})…`); await sleep(0); }
          const b = canMP4() ? await exportMP4(W, H, exOpts.vfps) : await exportRealtime(W, H, exOpts.vfps);
          outs.push({ name: `${base}-${tag}-${exOpts.vres}p.${ext}`, blob: b });
          if (fm.length > 1 && coverRef()) { const c = buf('export', W, H); renderCover(c.getContext('2d'), W, H); outs.push({ name: `${base}-${tag}-cover.png`, blob: await toBlob(c) }); }
        }
      } finally { G.frame.aspect = keep; }
      if (outs.length === 1) { blob = outs[0].blob; name = outs[0].name; kind = 'video'; }
      else { progress(1, 'Packing ZIP…'); blob = await makeZip(outs); name = `${base}-${fm.length}-formats.zip`; kind = 'zip'; }
    } else if (exTab === 'gif') {
      const [W, H] = dims(exOpts.gsize, 'long');
      blob = await exportGIF(W, H, exOpts.gfps); name = `${base}.gif`; kind = 'image';
    } else if (exTab === 'png') {
      const [W, H] = dims(G.frame.size);
      const c = buf('export', W, H);
      progress(0.3, 'Rendering…'); await sleep(20);
      const cover = exOpts.pngWhat === 'cover' && coverRef();
      if (cover) renderCover(c.getContext('2d'), W, H); else renderView(c.getContext('2d'), W, H);
      blob = await toBlob(c); name = cover ? `${base}-cover.png` : `${safeName(clips[sel].name)}-torn.png`; kind = 'image';
    } else if (exTab === 'carousel') {
      const r = await exportCarousel();
      blob = r.zip; name = `${base}-carousel-${exOpts.cn}-slides.zip`; kind = 'zip'; prev = r.preview;
    } else {
      const [W, H] = dims(G.frame.size);
      const c = buf('export', W, H), files = [];
      for (let i = 0; i < clips.length; i++) {
        if (job.cancelled) throw new Error('cancelled');
        progress(i / clips.length, `Rendering photo ${i + 1} of ${clips.length}…`);
        await sleep(0);
        drawClip(c.getContext('2d'), W, H, i, 0, null);
        files.push({ name: `${String(i + 1).padStart(2, '0')}-${safeName(clips[i].name)}.png`, blob: await toBlob(c) });
      }
      progress(1, 'Packing ZIP…');
      blob = await makeZip(files); name = `${base}-${files.length}-photos.zip`; kind = 'zip';
    }
    const secs = ((performance.now() - t0) / 1000).toFixed(1);
    showResult(kind, blob, name, secs, prev);
  } catch (e) {
    if (e && e.message === 'cancelled') { progress(0, 'Export cancelled.'); }
    else { progress(0, 'Export failed: ' + (e && e.message ? e.message : e) + '. Try a smaller size or frame rate.'); console.error(e); }
    $('exCancel').textContent = 'Close';
    dlgBody.querySelectorAll('.tabs button, #exPane select').forEach(b => { b.disabled = false; });
    $('exGo').disabled = false;
  } finally {
    job = null;
    for (const k of [...photoCache.keys()]) if (photoCache.size > 4) photoCache.delete(k);
    delete bufs.export; delete bufs.a; delete bufs.b;
    requestRender();
  }
}
let lastUrl = null;
function showResult(kind, blob, name, secs, prev) {
  if (lastUrl) URL.revokeObjectURL(lastUrl);
  const url = lastUrl = URL.createObjectURL(blob);
  const mb = (blob.size / 1048576).toFixed(blob.size > 1048576 ? 1 : 2);
  const preview = kind === 'video' ? `<video src="${url}" controls autoplay loop muted playsinline></video>`
    : kind === 'image' ? `<img src="${url}" alt="Exported result">`
    : prev ? `<img src="${URL.createObjectURL(prev)}" alt="Carousel panorama with slide cuts marked">` : `<p style="padding:24px">${esc(name)}</p>`;
  openDlg(`<h3>Export ready</h3><div class="media">${preview}</div>
    <div class="facts"><span><b>${esc(name)}</b></span><span><b>${mb} MB</b></span><span>made in ${secs} s</span></div>
    <p>If Download does nothing, right-click the preview and choose Save.</p>
    <div class="row"><button class="btn" type="button" id="exBack">Export something else</button><button class="btn" type="button" data-close>Close</button><button class="btn primary" type="button" id="dl">Download</button></div>`);
  $('dl').onclick = () => saveBlob(blob, name);
  $('exBack').onclick = openExport;
}

async function exportCarousel() {
  const n = exOpts.cn, per = exOpts.cper, [w, h] = carouselDims(), W = w * n;
  const base = lookFor(sel);
  const look = Object.assign({}, base, {
    cut: { ...base.cut, on: true, layout: 'grid', columns: n * per, rows: 1, missing: 0, mix: exOpts.csrc === 'seq', mixFit: 'strip' },
    text: { ...base.text, on: false }, hole: { ...base.hole, on: false },
  });
  progress(0.1, 'Rendering the panorama…'); await sleep(20);
  const wide = buf('carousel', W, h);
  drawClip(wide.getContext('2d'), W, h, exOpts.csrc === 'seq' ? 0 : sel, 0, { look });
  const files = [{ name: '00-panorama.png', blob: await toBlob(wide) }];
  const slide = buf('export', w, h), sx = slide.getContext('2d');
  for (let i = 0; i < n; i++) {
    if (job.cancelled) throw new Error('cancelled');
    progress(0.2 + 0.7 * i / n, `Cutting slide ${i + 1} of ${n}…`); await sleep(0);
    sx.setTransform(1, 0, 0, 1, 0, 0); sx.clearRect(0, 0, w, h); sx.drawImage(wide, -i * w, 0);
    files.push({ name: `${String(i + 1).padStart(2, '0')}-slide.png`, blob: await toBlob(slide) });
  }
  // small preview with the slide cuts marked
  const pw = Math.min(1600, W), ph = Math.round(h * pw / W), pc = document.createElement('canvas'); pc.width = pw; pc.height = ph;
  const px = pc.getContext('2d'); px.drawImage(wide, 0, 0, pw, ph);
  px.strokeStyle = 'rgba(240,194,75,.95)'; px.setLineDash([6, 5]); px.lineWidth = 2;
  for (let i = 1; i < n; i++) { const x = Math.round(i * pw / n) + 0.5; px.beginPath(); px.moveTo(x, 0); px.lineTo(x, ph); px.stroke(); }
  progress(1, 'Packing ZIP…');
  delete bufs.carousel;
  return { zip: await makeZip(files), preview: await toBlob(pc) };
}
async function exportMP4(W, H, fps) {
  const tot = totalDur(), N = Math.max(1, Math.round(tot * fps));
  const bitrate = Math.min(60e6, Math.round(W * H * fps * 0.12));
  const tries = [['avc1.640034', 'avc'], ['avc1.640033', 'avc'], ['avc1.640028', 'avc'], ['avc1.4d0034', 'avc'], ['avc1.42e034', 'avc'], ['vp09.00.50.08', 'vp9'], ['vp09.00.40.08', 'vp9']];
  let config = null, mux = 'avc';
  for (const [codec, m] of tries) {
    const cfg = { codec, width: W, height: H, bitrate, framerate: fps };
    if (m === 'avc') cfg.avc = { format: 'avc' };
    try { const s = await VideoEncoder.isConfigSupported(cfg); if (s.supported) { config = cfg; mux = m; break; } } catch (e) { /* try next */ }
  }
  if (!config) throw new Error(`this browser cannot encode ${W}×${H} video`);
  const withSong = song && S.music.on, SR = 48000;
  const acfg = withSong ? await pickAudioConfig(SR) : null;
  const target = new Mp4Muxer.ArrayBufferTarget();
  const muxer = new Mp4Muxer.Muxer({ target, video: { codec: mux, width: W, height: H, frameRate: fps },
    audio: acfg ? { codec: acfg.mux, numberOfChannels: 2, sampleRate: SR } : undefined, fastStart: 'in-memory', firstTimestampBehavior: 'offset' });
  if (acfg) { progress(0, 'Mixing music…'); await encodeSong(muxer, await renderSongMix(tot, SR), acfg.cfg); }
  else if (withSong) status('This browser cannot encode audio, so the video has no music.');
  let err = null;
  const encoder = new VideoEncoder({ output: (chunk, meta) => muxer.addVideoChunk(chunk, meta), error: e => { err = e; } });
  encoder.configure(config);
  const c = buf('export', W, H), x = c.getContext('2d');
  try {
    for (let i = 0; i < N; i++) {
      if (job.cancelled) throw new Error('cancelled');
      if (err) throw err;
      renderAt(x, W, H, i / fps, false);
      const frame = new VideoFrame(c, { timestamp: Math.round(i * 1e6 / fps), duration: Math.round(1e6 / fps) });
      encoder.encode(frame, { keyFrame: i % (fps * 2) === 0 });
      frame.close();
      while (encoder.encodeQueueSize > 4) await sleep(2);
      if (i % 4 === 0) { progress(i / N, `Rendering frame ${i + 1} of ${N}…`); await sleep(0); }
    }
    progress(1, 'Finishing video…');
    await encoder.flush();
    if (err) throw err;
  } finally { if (encoder.state !== 'closed') encoder.close(); }
  muxer.finalize();
  return new Blob([target.buffer], { type: 'video/mp4' });
}
async function exportRealtime(W, H, fps) {
  const tot = totalDur();
  const c = buf('export', W, H), x = c.getContext('2d');
  renderAt(x, W, H, 0, false);
  const types = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm', 'video/mp4'];
  const type = types.find(t => MediaRecorder.isTypeSupported(t)) || '';
  const stream = c.captureStream(fps);
  let rtSrc = null;
  if (song && S.music.on) {
    const a = audioCtx(), dest = a.createMediaStreamDestination(), g = a.createGain();
    rtSrc = a.createBufferSource(); rtSrc.buffer = song.buffer; rtSrc.connect(g); g.connect(dest); g.gain.value = S.music.volume;
    dest.stream.getAudioTracks().forEach(t => stream.addTrack(t));
    rtSrc.start(a.currentTime + 0.05, S.music.start);
  }
  const rec = new MediaRecorder(stream, type ? { mimeType: type, videoBitsPerSecond: Math.min(40e6, W * H * fps * 0.2) } : undefined);
  const chunks = [];
  rec.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
  const done = new Promise(r => { rec.onstop = r; });
  rec.start(250);
  const start = performance.now();
  await new Promise((res, rej) => {
    const tick = () => {
      if (job.cancelled) { rec.stop(); return rej(new Error('cancelled')); }
      const t = (performance.now() - start) / 1000;
      if (t >= tot) { rec.stop(); return res(); }
      renderAt(x, W, H, t, false);
      progress(t / tot, `Recording in real time: ${fmtT(t)} of ${fmtT(tot)}…`);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  await done;
  if (rtSrc) { try { rtSrc.stop(); } catch (e) { /* ended */ } }
  return new Blob(chunks, { type: rec.mimeType || 'video/webm' });
}
async function exportGIF(W, H, fps) {
  const { GIFEncoder, quantize, applyPalette } = gifenc;
  const tot = totalDur(), N = Math.max(1, Math.round(tot * fps));
  const gif = GIFEncoder();
  const c = buf('export', W, H), x = c.getContext('2d', { willReadFrequently: true });
  const delay = Math.round(1000 / fps);
  for (let i = 0; i < N; i++) {
    if (job.cancelled) throw new Error('cancelled');
    renderAt(x, W, H, i / fps, false);
    const { data } = x.getImageData(0, 0, W, H);
    const palette = quantize(data, 256);
    gif.writeFrame(applyPalette(data, palette), W, H, { palette, delay, repeat: 0 });
    progress((i + 1) / N, `Encoding frame ${i + 1} of ${N}…`);
    await sleep(0);
  }
  gif.finish();
  return new Blob([gif.bytes()], { type: 'image/gif' });
}

/* ---------- misc wiring ---------- */
let stTimer;
function status(t) { $('status').textContent = t; clearTimeout(stTimer); if (t) stTimer = setTimeout(() => { $('status').textContent = ''; }, 4000); }

$('exportBtn').onclick = openExport;
$('playBtn').onclick = () => setPlaying(!playing);
$('shuffleBtn').onclick = () => { S.cut.seed = (Math.random() * 1000) | 0; syncPanel(); changed(); };
$('scrub').addEventListener('input', e => {
  if (playing) setPlaying(false);
  view = 'time'; T = +e.target.value;
  const k = locate(T).k;
  if (k !== sel) { sel = k; updateClipPanel(); markSelected(true); }
  updateTime(); requestRender();
});
const setCompare = on => { if (comparing === on) return; comparing = on; $('badge').hidden = !on; $('compareBtn').setAttribute('aria-pressed', on); if (playing) draw(); else requestRender(); };
const cb = $('compareBtn');
cb.addEventListener('pointerdown', e => { e.preventDefault(); cb.setPointerCapture(e.pointerId); setCompare(true); });
['pointerup', 'pointercancel', 'lostpointercapture'].forEach(ev => cb.addEventListener(ev, () => setCompare(false)));
cb.addEventListener('keydown', e => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); setCompare(true); } });
cb.addEventListener('keyup', () => setCompare(false));

$('fileBg').onchange = async e => {
  const f = e.target.files[0]; e.target.value = '';
  if (!f) return;
  try { customBg = await loadImage(f); customBgId++; S.bg.type = 'custom'; syncPanel(); changed(); status('Background image loaded'); }
  catch (err) { status('Could not read that image.'); }
};
$('fileTex').onchange = async e => {
  const f = e.target.files[0]; e.target.value = '';
  if (!f) return;
  try { customTex = await loadImage(f); customTexId++; S.scan.custom = true; S.scan.on = true; syncPanel(); changed(); status('Paper scan loaded'); }
  catch (err) { status('Could not read that image.'); }
};

// file drop anywhere adds photos
let dragDepth = 0;
const hasFiles = e => [...(e.dataTransfer?.types || [])].includes('Files');
window.addEventListener('dragenter', e => { if (hasFiles(e)) { dragDepth++; document.body.classList.add('drag-on'); } });
window.addEventListener('dragleave', e => { if (hasFiles(e) && --dragDepth <= 0) { dragDepth = 0; document.body.classList.remove('drag-on'); } });
window.addEventListener('dragover', e => { if (hasFiles(e)) e.preventDefault(); });
window.addEventListener('drop', e => {
  if (!hasFiles(e)) return;
  e.preventDefault(); dragDepth = 0; document.body.classList.remove('drag-on');
  const files = [...e.dataTransfer.files];
  const audio = files.find(f => f.type.startsWith('audio/'));
  if (audio) loadMusic(audio, audio.name.replace(/\.[^.]+$/, ''));
  if (files.some(f => f.type.startsWith('image/'))) addFiles(files);
  else if (!audio) status('Drop photos or a music file.');
});
window.addEventListener('paste', e => {
  const files = [...(e.clipboardData?.files || [])].filter(f => f.type.startsWith('image/'));
  if (files.length) { e.preventDefault(); addFiles(files); }
});
window.addEventListener('keydown', e => {
  const el = e.target instanceof Element ? e.target : document.body;
  const typing = el.matches('input[type="text"], input[type="number"], textarea, select');
  if ((e.ctrlKey || e.metaKey) && !typing) {
    const k = e.key.toLowerCase();
    if (k === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
    else if ((k === 'z' && e.shiftKey) || k === 'y') { e.preventDefault(); redoFn(); }
    return;
  }
  if (typing || dlg.open || e.altKey || e.ctrlKey || e.metaKey) return;
  const onRange = el.matches('input[type="range"]');
  if (e.key === ' ' && !el.matches('button')) { e.preventDefault(); setPlaying(!playing); }
  else if (e.key === 'r' || e.key === 'R') $('shuffleBtn').click();
  else if (e.key === 'b' || e.key === 'B') { if (!e.repeat) setCompare(true); }
  else if (!onRange && e.key === 'ArrowLeft') selectClip(sel - 1);
  else if (!onRange && e.key === 'ArrowRight') selectClip(sel + 1);
  else if ((e.key === 'Delete' || e.key === 'Backspace') && !onRange && clips.length) { e.preventDefault(); removeClip(sel); }
});
window.addEventListener('keyup', e => { if (e.key === 'b' || e.key === 'B') setCompare(false); });
window.addEventListener('blur', () => setCompare(false));

/* ---------- boot ---------- */
async function boot() {
  buildPanel(); wireMusicUI(); syncPanel(); buildPresets(''); refreshMusicUI();
  clips = sampleClips();
  buildStrip(); updateClipPanel(); draw();
  loadFont(S.text.font);
  idb = await openIDB();
  const restored = await restoreClips();
  const mus = store.get('torn-music');
  if (mus) { const blob = await idbDo('readonly', os => os.get('__music')); if (blob) await loadMusic(blob, mus.name, true); }
  if (restored) { buildStrip(); updateClipPanel(); status(`Restored ${clips.length} clip${clips.length > 1 ? 's' : ''} from last time`); }
  lastSnap = snapshot(); updUndo();
  requestRender();
  if (document.fonts && document.fonts.ready) {
    await document.fonts.ready;
    // samples are drawn with display fonts: redraw them once the fonts have arrived
    for (const v of [0, 1, 2]) { const id = 'sample-' + v, m = media.get(id); if (m) { m.img = makeSample(v); m.thumb = makeThumb(m.img); } }
    photoCache.clear(); buildStrip(); requestRender();
  }
}
boot();
})();
