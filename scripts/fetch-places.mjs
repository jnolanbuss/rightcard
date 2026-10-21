#!/usr/bin/env node
// Refreshes the bundled places directory: named stores, gas stations, restaurants, etc. along the
// North Port → Sarasota → Bradenton → Tampa/Brandon corridor (St. Petersburg/Clearwater come along
// because they fall inside the box), from OpenStreetMap via the free Overpass API.
// Data © OpenStreetMap contributors (ODbL 1.0).
//
//   node scripts/fetch-places.mjs
//   node scripts/fetch-places.mjs --south 26.98 --west -82.87 --north 28.20 --east -82.05
//
// Output (all static files):
//   places/index.json          list of data tiles, counts, source info (small; precached)
//   places/t_<row>_<col>.json  one file per 0.25° × 0.25° grid tile, compact rows (loaded on demand)
//   places-bradenton.json      legacy single file (old 25 km Bradenton-area circle), for older app versions
//
// The box is a region, not anyone's address. Queries go tile by tile, one at a time, with a pause
// between them, to stay polite to the shared Overpass servers and avoid timeouts.
import { writeFileSync, readFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? +process.argv[i + 1] : d; };
const BOX = { south: arg('south', 26.98), west: arg('west', -82.87), north: arg('north', 28.20), east: arg('east', -82.05) };
const TILE = 0.25; // degrees; must match PLACE_TILE_DEG in core.js
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const UA = 'RightCard-places-generator/1.1 (personal household rewards app; https://github.com/jnolanbuss/rightcard)';
const ENDPOINTS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];
const PAUSE_MS = 3000;
// Raw tile responses are cached for a day in the temp folder so an interrupted run can resume.
const CACHE_DIR = resolve(tmpdir(), 'rightcard-overpass-cache');
mkdirSync(CACHE_DIR, { recursive: true });
const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));

// OSM tag -> friendly kind. Kinds are mapped to app categories in core.js (PLACE_KINDS).
const KINDS = {
  'amenity=fuel': 'gas',
  'amenity=charging_station': 'ev',
  'shop=supermarket': 'grocery', 'shop=grocery': 'grocery', 'shop=greengrocer': 'grocery',
  'shop=convenience': 'convenience', 'shop=wholesale': 'warehouse',
  'shop=department_store': 'department', 'shop=variety_store': 'variety', 'shop=mall': 'mall', 'shop=general': 'general',
  'shop=clothes': 'clothes', 'shop=electronics': 'electronics', 'shop=hardware': 'hardware', 'shop=doityourself': 'hardware',
  'shop=chemist': 'pharmacy', 'amenity=pharmacy': 'pharmacy',
  'amenity=restaurant': 'restaurant', 'amenity=fast_food': 'fastfood', 'amenity=cafe': 'cafe',
};
const KIND_LIST = [...new Set(Object.values(KINDS))];
const vals = (key) => Object.keys(KINDS).filter((kv) => kv.startsWith(key + '=')).map((kv) => kv.split('=')[1]).join('|');
const queryFor = (s, w, n, e) => `[out:json][timeout:180];
(
  nwr["amenity"~"^(${vals('amenity')})$"]["name"](${s},${w},${n},${e});
  nwr["shop"~"^(${vals('shop')})$"]["name"](${s},${w},${n},${e});
);
out center tags;`;

async function overpass(query, label) {
  let lastErr;
  for (let round = 0; round < 3; round++) {
    for (const url of ENDPOINTS) {
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(200000), method: 'POST', headers: { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'data=' + encodeURIComponent(query) });
        if (res.ok) {
          const j = await res.json();
          if (j.remark && /timed out|runtime error|out of memory/i.test(j.remark)) { lastErr = new Error(j.remark); console.error(`${label}: ${url} remark: ${j.remark}`); continue; }
          console.error(`${label}: ${j.elements.length} elements from ${new URL(url).host}`);
          return j;
        }
        lastErr = new Error(`${url} -> HTTP ${res.status}`);
        console.error(`${label}: ${lastErr.message}`);
        if (res.status === 429 || res.status === 504) await sleep(15000 * (round + 1));
      } catch (e) { lastErr = e; console.error(`${label}: ${url} -> ${e.message}`); }
    }
  }
  throw lastErr;
}

const kindOf = (t) => { for (const [kv, kind] of Object.entries(KINDS)) { const [k, v] = kv.split('='); if (t[k] === v) return kind; } return null; };
const inBox = (la, lo) => la >= BOX.south && la <= BOX.north && lo >= BOX.west && lo <= BOX.east;
const tileOf = (la, lo) => [Math.floor(la / TILE), Math.floor(lo / TILE)];

// Query the box tile by tile on the same grid as the data tiles.
const [r0, c0] = tileOf(BOX.south, BOX.west), [r1, c1] = tileOf(BOX.north, BOX.east);
const byOsm = new Map(); // OSM id -> element (dedupes across query tiles)
for (let r = r0; r <= r1; r++) {
  for (let c = c0; c <= c1; c++) {
    const s = Math.max(r * TILE, BOX.south), n = Math.min((r + 1) * TILE, BOX.north);
    const w = Math.max(c * TILE, BOX.west), e = Math.min((c + 1) * TILE, BOX.east);
    if (s >= n || w >= e) continue;
    const q = queryFor(s.toFixed(4), w.toFixed(4), n.toFixed(4), e.toFixed(4));
    const cacheFile = resolve(CACHE_DIR, `${r}_${c}_${Buffer.from(q).toString('base64url').slice(-24)}.json`);
    let j;
    if (existsSync(cacheFile) && Date.now() - JSON.parse(readFileSync(cacheFile, 'utf8')).fetchedAt < 86400000) {
      j = JSON.parse(readFileSync(cacheFile, 'utf8'));
      console.error(`tile ${r},${c}: ${j.elements.length} elements (cached)`);
    } else {
      j = await overpass(q, `tile ${r},${c}`);
      writeFileSync(cacheFile, JSON.stringify({ fetchedAt: Date.now(), elements: j.elements }));
      await sleep(PAUSE_MS);
    }
    for (const el of j.elements) byOsm.set(`${el.type}${el.id}`, el);
  }
}

// Normalize, drop unnamed / out-of-box, dedupe (same name + kind within ~100 m, e.g. point + building).
const seen = new Map();
for (const el of byOsm.values()) {
  const t = el.tags || {};
  const name = (t.name || '').trim();
  const lat = el.lat ?? el.center?.lat, lon = el.lon ?? el.center?.lon;
  const k = kindOf(t);
  if (!name || lat == null || lon == null || !k || !inBox(lat, lon)) continue;
  const addr = [[t['addr:housenumber'], t['addr:street']].filter(Boolean).join(' '), t['addr:city']].filter(Boolean).join(', ');
  const p = { id: `osm-${el.type[0]}${el.id}`, n: name, k, la: +lat.toFixed(6), lo: +lon.toFixed(6) };
  if (t.brand && t.brand !== name) p.b = t.brand;
  if (addr) p.a = addr;
  const key = `${name.toLowerCase()}|${k}|${lat.toFixed(3)}|${lon.toFixed(3)}`;
  const prev = seen.get(key);
  if (!prev || (!prev.a && p.a)) seen.set(key, p);
}
const places = [...seen.values()].sort((a, b) => a.n.localeCompare(b.n) || a.id.localeCompare(b.id));

// Write tiles (compact rows: [id, name, kindIndex, lat, lon, brand|0, address|0]).
const dir = resolve(ROOT, 'places');
if (existsSync(dir)) rmSync(dir, { recursive: true });
mkdirSync(dir);
const tiles = new Map();
for (const p of places) {
  const key = tileOf(p.la, p.lo).join('_');
  if (!tiles.has(key)) tiles.set(key, []);
  tiles.get(key).push([p.id, p.n, KIND_LIST.indexOf(p.k), p.la, p.lo, p.b || 0, p.a || 0]);
}
const tileInfo = [];
let bytes = 0;
for (const [key, rows] of [...tiles.entries()].sort()) {
  const body = JSON.stringify({ v: 1, tile: key, kinds: KIND_LIST, places: rows });
  writeFileSync(resolve(dir, `t_${key}.json`), body);
  bytes += body.length;
  tileInfo.push({ key, count: rows.length, bytes: body.length });
}
const counts = {};
for (const p of places) counts[p.k] = (counts[p.k] || 0) + 1;
const source = 'OpenStreetMap contributors via Overpass API (ODbL 1.0, https://www.openstreetmap.org/copyright)';
writeFileSync(resolve(dir, 'index.json'), JSON.stringify({
  v: 1, source, generated: new Date().toISOString(), tileDeg: TILE, box: BOX,
  region: 'North Port to Tampa/Brandon (incl. St. Petersburg/Clearwater)', total: places.length, counts, tiles: tileInfo,
}, null, 1) + '\n');

// Legacy file for app versions before tiling: the old 25 km circle around a rounded Bradenton-area point.
const C = { lat: 27.47, lon: -82.53 }, KM = 25;
const distKm = (la, lo) => 6371 * Math.hypot(((lo - C.lon) * Math.PI / 180) * Math.cos(((la + C.lat) / 2) * Math.PI / 180), (la - C.lat) * Math.PI / 180);
const legacy = places.filter((p) => distKm(p.la, p.lo) <= KM);
const lc = {};
for (const p of legacy) lc[p.k] = (lc[p.k] || 0) + 1;
writeFileSync(resolve(ROOT, 'places-bradenton.json'), JSON.stringify({ source, generated: new Date().toISOString(), center: { ...C, note: 'approximate Bradenton-area point' }, radiusKm: KM, counts: lc, places: legacy }) + '\n');

console.log(`Wrote ${places.length} places in ${tileInfo.length} tiles (${(bytes / 1024).toFixed(0)} KB total, largest ${(Math.max(...tileInfo.map((t) => t.bytes)) / 1024).toFixed(0)} KB); legacy file ${legacy.length} places.`);
console.log(counts);
