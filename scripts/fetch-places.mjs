#!/usr/bin/env node
// Refreshes places-bradenton.json: named stores, gas stations, and restaurants near Bradenton, FL,
// from OpenStreetMap via the free Overpass API. Data © OpenStreetMap contributors (ODbL 1.0).
//
//   node scripts/fetch-places.mjs            # writes ../places-bradenton.json
//   node scripts/fetch-places.mjs --lat 27.47 --lon -82.53 --km 25 --out places-bradenton.json
//
// The center is a rounded, approximate point for the Bradenton area (not a street address),
// so the public file doesn't reveal anyone's home. 25 km reaches Bradenton, Sarasota,
// Lakewood Ranch, Palmetto, Anna Maria, and Holmes Beach.
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const LAT = +arg('lat', 27.47), LON = +arg('lon', -82.53), KM = +arg('km', 25);
const OUT = resolve(dirname(fileURLToPath(import.meta.url)), '..', arg('out', 'places-bradenton.json'));
const UA = 'RightCard-places-generator/1.0 (personal household rewards app; https://github.com/jnolanbuss/rightcard)';
const ENDPOINTS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];

// OSM tag -> friendly kind. Kinds are mapped to app categories in core.js (placeCategory).
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
// One bounding-box query (much faster on Overpass than many "around" filters); trimmed to KM below.
const dLat = KM / 111.32, dLon = KM / (111.32 * Math.cos((LAT * Math.PI) / 180));
const bbox = [LAT - dLat, LON - dLon, LAT + dLat, LON + dLon].map((v) => v.toFixed(4)).join(',');
const vals = (key) => Object.keys(KINDS).filter((kv) => kv.startsWith(key + '=')).map((kv) => kv.split('=')[1]).join('|');
const query = `[out:json][timeout:180];
(
  nwr["amenity"~"^(${vals('amenity')})$"]["name"](${bbox});
  nwr["shop"~"^(${vals('shop')})$"]["name"](${bbox});
);
out center tags;`;
const distKm = (la, lo) => { const R = 6371, x = ((lo - LON) * Math.PI / 180) * Math.cos(((la + LAT) / 2) * Math.PI / 180), y = (la - LAT) * Math.PI / 180; return R * Math.hypot(x, y); };

async function fetchOverpass() {
  let lastErr;
  for (const url of ENDPOINTS) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await fetch(url, { method: 'POST', headers: { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'data=' + encodeURIComponent(query) });
        if (res.ok) {
          const j = await res.json();
          if (j.remark) console.error(`Overpass remark: ${j.remark}`);
          if (j.remark && /timed out|runtime error|out of memory/i.test(j.remark)) { lastErr = new Error(j.remark); continue; }
          console.error(`Fetched ${j.elements.length} elements from ${url}`); return j;
        }
        lastErr = new Error(`${url} -> HTTP ${res.status}`);
        console.error(lastErr.message);
        if (res.status === 429 || res.status === 504) await new Promise((ok) => setTimeout(ok, 5000));
      } catch (e) { lastErr = e; console.error(`${url} -> ${e.message}`); }
    }
  }
  throw lastErr;
}

const kindOf = (t) => { for (const [kv, kind] of Object.entries(KINDS)) { const [k, v] = kv.split('='); if (t[k] === v) return kind; } return null; };
const json = await fetchOverpass();
const seen = new Map();
for (const el of json.elements) {
  const t = el.tags || {};
  const name = (t.name || '').trim();
  const lat = el.lat ?? el.center?.lat, lon = el.lon ?? el.center?.lon;
  const k = kindOf(t);
  if (!name || lat == null || lon == null || !k || distKm(lat, lon) > KM) continue;
  const addr = [[t['addr:housenumber'], t['addr:street']].filter(Boolean).join(' '), t['addr:city']].filter(Boolean).join(', ');
  const p = { id: `osm-${el.type[0]}${el.id}`, n: name, k, la: +lat.toFixed(6), lo: +lon.toFixed(6) };
  if (t.brand && t.brand !== name) p.b = t.brand;
  if (addr) p.a = addr;
  // Dedupe: same name + kind within ~60 m (e.g. a shop mapped as both a point and a building).
  const key = `${name.toLowerCase()}|${k}|${lat.toFixed(3)}|${lon.toFixed(3)}`;
  const prev = seen.get(key);
  if (!prev || (!prev.a && p.a)) seen.set(key, p);
}
const places = [...seen.values()].sort((a, b) => a.n.localeCompare(b.n) || a.id.localeCompare(b.id));
const counts = {};
for (const p of places) counts[p.k] = (counts[p.k] || 0) + 1;
writeFileSync(OUT, JSON.stringify({
  source: 'OpenStreetMap contributors via Overpass API (ODbL 1.0, https://www.openstreetmap.org/copyright)',
  generated: new Date().toISOString(), center: { lat: LAT, lon: LON, note: 'approximate Bradenton-area point' }, radiusKm: KM,
  counts, places,
}) + '\n');
console.log(`Wrote ${places.length} places to ${OUT}`);
console.log(counts);
