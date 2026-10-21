import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as C from '../core.js';

const nolan = C.NOLAN, brittany = C.BRITTANY;
const date = (y, m, d, h = 12, mi = 0) => new Date(y, m - 1, d, h, mi);
const oct20 = date(2026, 10, 20);
const close = (a, b, eps = 1e-4) => assert.ok(Math.abs(a - b) < eps, `${a} ≉ ${b}`);
const people = () => [{ id: nolan, name: 'Nolan' }, { id: brittany, name: 'Brittany' }];
const H = (cards, stores = []) => ({ schema: 1, people: people(), cards, stores, settings: {} });

const rule = (o) => ({ id: C.uid(), categories: [], rate: 0, cap: null, rateAfterCap: null, rotating: null, excludedMerchants: [], trackedSpend: {}, ...o });
const card = (o) => ({ id: C.uid(), name: 'Card', last4: null, colorHex: '#2E6BE6', network: 'other', unit: { type: 'cash' }, baseRate: 1, bonusRules: [], fees: [], offers: [], availableTo: [nolan, brittany], accountMode: 'shared', archived: false, isDemo: false, ...o });
const store = (name, cat, loc = null, radius = 150) => ({ id: C.uid(), name, suggestedCategory: cat, location: loc, radius, acceptedNetworks: [], surchargePercent: 0, confirmations: [] });
const grocery = (mode = 'shared', limit = 6000) => card({ name: 'Grocery', accountMode: mode, bonusRules: [rule({ categories: ['groceries'], rate: 6, cap: { limit, reset: { type: 'calendarYear' } }, rateAfterCap: 1 })] });
const flat2 = () => card({ id: 'flat2', name: 'Flat 2', baseRate: 2, accountMode: 'separate' });
const ctx = (o) => ({ personID: nolan, category: 'other', store: null, amount: null, date: oct20, ...o });

// ---- People & eligibility
test('different cards per person', () => {
  const nolanOnly = card({ name: 'Nolan Dining', availableTo: [nolan], bonusRules: [rule({ categories: ['restaurants'], rate: 5 })] });
  const n = C.recommend([nolanOnly, flat2()], ctx({ category: 'restaurants' }));
  const b = C.recommend([nolanOnly, flat2()], ctx({ personID: brittany, category: 'restaurants' }));
  assert.equal(n.best.cardName, 'Nolan Dining');
  assert.equal(n.nextBest.cardName, 'Flat 2');
  assert.equal(b.best.cardName, 'Flat 2');
  assert.equal(b.nextBest, null);
  assert.ok(b.ineligible.some((i) => i.cardName === 'Nolan Dining' && i.reason.includes('Not available')));
});

test('archived card excluded', () => {
  const g = grocery(); g.archived = true;
  const r = C.recommend([g, flat2()], ctx({ category: 'groceries' }));
  assert.equal(r.best.cardName, 'Flat 2');
  assert.ok(r.ineligible.some((i) => i.reason === 'Archived'));
});

// ---- Shared vs separate limits
test('shared account limit is not double counted', () => {
  let d = H([grocery('shared')]);
  const c = d.cards[0], r = c.bonusRules[0];
  d = C.recordSpend(d, c.id, r.id, nolan, 4000, oct20);
  d = C.recordSpend(d, c.id, r.id, brittany, 1500, oct20);
  const rr = d.cards[0].bonusRules[0];
  assert.equal(Object.keys(rr.trackedSpend).length, 1);
  assert.equal(C.remaining(rr, C.accountKey(d.cards[0], nolan), oct20), 500);
  assert.equal(C.remaining(rr, C.accountKey(d.cards[0], brittany), oct20), 500);
});

test('separate accounts track limits per person', () => {
  let d = H([grocery('separate'), flat2()]);
  d = C.recordSpend(d, d.cards[0].id, d.cards[0].bonusRules[0].id, nolan, 6000, oct20);
  const c = d.cards[0];
  assert.equal(C.remaining(c.bonusRules[0], C.accountKey(c, nolan), oct20), 0);
  assert.equal(C.remaining(c.bonusRules[0], C.accountKey(c, brittany), oct20), 6000);
  assert.equal(C.recommendForCategory(d, nolan, 'groceries', null, oct20).best.cardName, 'Flat 2');
  assert.equal(C.recommendForCategory(d, brittany, 'groceries', null, oct20).best.cardName, 'Grocery');
});

// ---- Limits
test('exhausted limit falls back with reset date', () => {
  let d = H([grocery(), flat2()]);
  d = C.setSpend(d, d.cards[0].id, d.cards[0].bonusRules[0].id, nolan, 6000, oct20);
  const r = C.recommendForCategory(d, brittany, 'groceries', 100, oct20);
  assert.equal(r.best.cardName, 'Flat 2');
  const g = r.ranked.find((e) => e.cardName === 'Grocery');
  close(g.netValue, 1);
  assert.equal(g.headlineRate, '1%');
  assert.equal(g.usesBonusRate, false);
  assert.ok(g.cautions.some((c) => c.includes('Bonus limit used up') && c.includes('1/1/2027')));
});

test('purchase crossing a limit splits the rate', () => {
  let d = H([grocery()]);
  d = C.setSpend(d, d.cards[0].id, d.cards[0].bonusRules[0].id, nolan, 5900, oct20);
  const e = C.estimate(d.cards[0], ctx({ category: 'groceries', amount: 300 })).estimate;
  close(e.netValue, 8); // $100*6% + $200*1%
  assert.equal(e.crossesBonusLimit, true);
  assert.equal(e.bonusRemaining, 100);
  assert.ok(e.cautions.some((c) => c.includes('Only $100 earns 6%')));
});

test('limit resets in a new period', () => {
  let d = H([grocery()]);
  d = C.setSpend(d, d.cards[0].id, d.cards[0].bonusRules[0].id, nolan, 6000, oct20);
  assert.equal(C.remaining(d.cards[0].bonusRules[0], 'shared', date(2027, 1, 2)), 6000);
});

test('size dependence disclosed when no amount, and resolved with amount', () => {
  let d = H([grocery(), flat2()]);
  d = C.setSpend(d, d.cards[0].id, d.cards[0].bonusRules[0].id, nolan, 5950, oct20);
  const r = C.recommendForCategory(d, nolan, 'groceries', null, oct20);
  assert.equal(r.best.cardName, 'Grocery');
  assert.equal(r.dependsOnAmount, true);
  assert.match(r.amountNote, /Flat 2/);
  const r2 = C.recommendForCategory(d, nolan, 'groceries', 500, oct20);
  assert.equal(r2.best.cardName, 'Flat 2');
  assert.equal(r2.dependsOnAmount, false);
});

test('no size disclosure when there is a clear winner', () => {
  const r = C.recommend([grocery(), flat2()], ctx({ category: 'groceries' }));
  assert.equal(r.best.cardName, 'Grocery');
  assert.equal(r.dependsOnAmount, false);
  assert.equal(r.amountNote, null);
});

// ---- Offers
const offerCard = (expires, o = {}) => card({ name: 'Offer Card', offers: [{ id: C.uid(), merchantName: 'Target', kind: 'percent', value: 10, minSpend: 50, maxReward: 15, startDate: null, expires: expires.toISOString(), stacks: true, enrolled: true, enrolledPeople: [], ...o }] });

test('live offer stacks, respects max and minimum', () => {
  const t = store('Target', 'other');
  const oc = offerCard(date(2026, 11, 30));
  const r = C.recommend([oc, flat2()], ctx({ store: t, amount: 100 }));
  assert.equal(r.best.cardName, 'Offer Card');
  close(r.best.netValue, 11);
  close(C.estimate(oc, ctx({ store: t, amount: 300 })).estimate.netValue, 18);
  const r40 = C.recommend([oc, flat2()], ctx({ store: t, amount: 40 }));
  assert.equal(r40.best.cardName, 'Flat 2');
  assert.ok(r40.ranked.find((e) => e.cardName === 'Offer Card').cautions.some((c) => c.includes('Spend $10.00 more')));
});

test('expired offer ignored', () => {
  const r = C.recommend([offerCard(date(2026, 10, 1)), flat2()], ctx({ store: store('Target', 'other'), amount: 100 }));
  assert.equal(r.best.cardName, 'Flat 2');
  const e = r.ranked.find((x) => x.cardName === 'Offer Card');
  close(e.netValue, 1);
  assert.ok(e.cautions.some((c) => c.startsWith('Offer expired')));
});

test('not-enrolled offer ignored', () => {
  const e = C.estimate(offerCard(date(2026, 12, 1), { enrolled: false }), ctx({ store: store('Target', 'other'), amount: 100 })).estimate;
  close(e.netValue, 1);
  assert.ok(e.cautions.some((c) => c.includes('not added')));
});

test('non-stacking offer takes the larger', () => {
  const ns = card({ name: 'NS', baseRate: 5, availableTo: [nolan], offers: [{ id: 'o', merchantName: 'Target', kind: 'flat', value: 3, minSpend: 0, maxReward: null, startDate: null, expires: date(2026, 12, 1).toISOString(), stacks: false, enrolled: true, enrolledPeople: [] }] });
  const t = store('Target', 'other');
  close(C.estimate(ns, ctx({ store: t, amount: 100 })).estimate.netValue, 5);
  close(C.estimate(ns, ctx({ store: t, amount: 40 })).estimate.netValue, 3);
});

test('only the best offer counts; per-person enrollment', () => {
  const mk = (v, people) => ({ id: C.uid(), merchantName: 'Publix', kind: 'flat', value: v, minSpend: 0, maxReward: null, startDate: null, expires: date(2026, 12, 1).toISOString(), stacks: true, enrolled: true, enrolledPeople: people });
  const c = card({ name: 'Two', baseRate: 0, accountMode: 'separate', offers: [mk(5, []), mk(8, [brittany])] });
  const p = store('Publix', 'groceries');
  close(C.estimate(c, ctx({ category: 'groceries', store: p, amount: 50 })).estimate.netValue, 5);
  close(C.estimate(c, ctx({ personID: brittany, category: 'groceries', store: p, amount: 50 })).estimate.netValue, 8);
});

// ---- Rotating
const rot = (activated, from = date(2026, 10, 1), until = date(2026, 12, 31, 23, 59)) =>
  card({ name: 'Rotating', bonusRules: [rule({ categories: ['gas'], rate: 5, cap: { limit: 1500, reset: { type: 'quarterly' } }, rotating: { activated, from: from.toISOString(), until: until.toISOString() } })] });

test('inactive rotating category falls back', () => {
  const r = C.recommend([rot(false), flat2()], ctx({ personID: brittany, category: 'gas', amount: 40 }));
  assert.equal(r.best.cardName, 'Flat 2');
  const e = r.ranked.find((x) => x.cardName === 'Rotating');
  close(e.netValue, 0.4);
  assert.ok(e.cautions.some((c) => c.includes('Activate')));
});
test('activated rotating category wins', () => {
  const r = C.recommend([rot(true), flat2()], ctx({ personID: brittany, category: 'gas', amount: 40 }));
  assert.equal(r.best.cardName, 'Rotating');
  close(r.best.netValue, 2);
});
test('rotating outside its window falls back', () => {
  const e = C.estimate(rot(true, date(2026, 7, 1), date(2026, 9, 30, 23, 59)), ctx({ category: 'gas', amount: 100 })).estimate;
  close(e.netValue, 1);
  assert.ok(e.cautions.some((c) => c.includes("isn't running")));
});

// ---- Points & fees
test('points use editable cents-per-point', () => {
  const pts = card({ name: 'Points', availableTo: [nolan], unit: { type: 'points', name: 'points', cpp: 1.25 }, bonusRules: [rule({ categories: ['restaurants'], rate: 4 })] });
  const e = C.estimate(pts, ctx({ category: 'restaurants', amount: 100 })).estimate;
  close(e.netValue, 5);
  assert.equal(e.headlineRate, '4x points (≈5%)');
  pts.unit.cpp = 0.5;
  const r = C.recommend([pts, card({ name: 'Three', baseRate: 3, availableTo: [nolan] })], ctx({ category: 'restaurants', amount: 100 }));
  assert.equal(r.best.cardName, 'Three');
  close(r.nextBest.netValue, 2);
});

test('transaction fees reduce value and change ranking', () => {
  const t5 = card({ name: 'Travel 5', availableTo: [nolan], bonusRules: [rule({ categories: ['travel'], rate: 5 })], fees: [{ id: 'f', label: 'Foreign transaction fee', percent: 3, flat: 0, categories: ['travel'] }] });
  const t3 = card({ name: 'Travel 3 no fee', availableTo: [nolan], bonusRules: [rule({ categories: ['travel'], rate: 3 })] });
  const r = C.recommend([t5, t3], ctx({ category: 'travel', amount: 200 }));
  assert.equal(r.best.cardName, 'Travel 3 no fee');
  const e = r.ranked.find((x) => x.cardName === 'Travel 5');
  close(e.feeValue, 6); close(e.netValue, 4);
  assert.equal(C.recommend([t5, t3], ctx({ category: 'travel' })).best.cardName, 'Travel 3 no fee');
});

test('flat fee makes best card depend on amount', () => {
  const fc = card({ name: 'Fee Card', baseRate: 5, availableTo: [nolan], fees: [{ id: 'f', label: 'Processing fee', percent: 0, flat: 1, categories: [] }] });
  const r = C.recommend([fc, flat2()], ctx({ category: 'utilities' }));
  assert.equal(r.best.cardName, 'Fee Card');
  assert.equal(r.dependsOnAmount, true);
});

// ---- Eligibility
test('store network acceptance', () => {
  const costco = store('Costco', 'groceries'); costco.acceptedNetworks = ['visa'];
  const g = grocery(); g.network = 'amex';
  const f = flat2(); f.network = 'visa';
  const r = C.recommend([g, f], ctx({ category: 'groceries', store: costco }));
  assert.equal(r.best.cardName, 'Flat 2');
  assert.equal(r.ranked.length, 1);
  assert.match(r.ineligible[0].reason, /doesn't take American Express/);
});

test('excluded merchant gets base rate', () => {
  const g = grocery(); g.bonusRules[0].excludedMerchants = ['Walmart'];
  const e = C.estimate(g, ctx({ category: 'groceries', store: store('Walmart', 'groceries'), amount: 100 })).estimate;
  close(e.netValue, 1);
  assert.ok(e.cautions.some((c) => c.includes('excluded')));
});

// ---- Category uncertainty
test('unconfirmed store category shows uncertainty; confirmation overrides', () => {
  let d = H([grocery(), flat2()], [store('Costco', 'groceries')]);
  let r = C.recommendForStore(d, nolan, d.stores[0], null, oct20);
  assert.equal(r.confidence.type, 'unconfirmed');
  assert.match(r.categoryNote, /guessing/);
  assert.equal(r.alternativeCategoryNote, "If it's counted as Everything Else instead, Flat 2 would be best.");
  d = C.confirmCategory(d, d.stores[0].id, 'other', null, oct20);
  r = C.recommendForStore(d, nolan, d.stores[0], null, oct20);
  assert.deepEqual(r.confidence, { type: 'confirmed', count: 1 });
  assert.equal(r.category, 'other');
  assert.equal(r.best.cardName, 'Flat 2');
  assert.equal(r.alternativeCategoryNote, null);
});

test('mixed confirmations disclosed, tie goes to most recent', () => {
  const s = store('Target', 'other');
  s.confirmations = [{ id: 'a', date: date(2026, 9, 1).toISOString(), category: 'groceries' }, { id: 'b', date: date(2026, 10, 1).toISOString(), category: 'other' }];
  const eff = C.effectiveCategory(s);
  assert.equal(eff.category, 'other');
  assert.equal(eff.confidence.type, 'mixed');
  assert.deepEqual(new Set(eff.confidence.categories), new Set(['groceries', 'other']));
});

// ---- Demo data
test('demo data is fictional, labeled, location-free, and sensible', () => {
  const d = C.demoHousehold(oct20);
  assert.ok(d.cards.every((c) => c.isDemo && c.name.startsWith('Demo')));
  assert.ok(d.stores.every((s) => s.location === null));
  const names = d.stores.map((s) => s.name).join('|');
  for (const n of ['Publix', "Detwiler's", 'Costco', 'Target', 'Walmart', 'Amazon', 'Tesla Supercharger', 'Restaurant', 'Gas Station']) assert.ok(names.includes(n), n);
  assert.ok(d.stores.every((s) => C.effectiveCategory(s).confidence.type === 'unconfirmed'));
  const publix = d.stores.find((s) => s.name === 'Publix');
  const r = C.recommendForStore(d, brittany, publix, null, oct20);
  assert.equal(r.best.cardName, 'Demo Grocery Card');
  assert.equal(r.best.headlineRate, '6%');
  assert.equal(C.recommendForCategory(d, brittany, 'gas', 40, oct20).best.cardName, 'Demo Grocery Card');
  assert.equal(C.recommendForCategory(d, nolan, 'restaurants', null, oct20).best.cardName, 'Demo Dining Points Card');
  assert.notEqual(C.recommendForCategory(d, brittany, 'restaurants', null, oct20).best.cardName, 'Demo Dining Points Card');
});

// ---- Foreground geolocation
const base = { lat: 27.48, lon: -82.55 };
const off = (n, e = 0) => ({ lat: base.lat + n / 111320, lon: base.lon + e / (111320 * Math.cos((base.lat * Math.PI) / 180)) });

test('haversine', () => close(C.distanceMeters(base, off(1000)), 1000, 5));

test('nearby: none / one / ask which store when several are close', () => {
  const a = store('A', 'other', off(0)), b = store('B', 'other', off(120)), c = store('C', 'other', off(3000));
  const all = [a, b, c, store('NoLoc', 'other')];
  assert.deepEqual(C.nearbyDecision(off(-1000), 30, all), { type: 'none' });
  assert.deepEqual(C.nearbyDecision(off(3000), 20, all), { type: 'one', storeID: c.id });
  const ask = C.nearbyDecision(off(60), 30, all);
  assert.equal(ask.type, 'ask');
  assert.deepEqual(new Set(ask.storeIDs), new Set([a.id, b.id]));
});

test('location denied: manual search + category buttons still recommend; no background claims', () => {
  const d = C.demoHousehold(oct20);
  let s = C.bestCardScreen(d, nolan, { type: 'none' }, null, { available: true, permission: 'denied' }, oct20);
  assert.equal(s.geo.canFindNearby, false);
  assert.equal(s.showManualPicker, true);
  assert.equal(s.recommendation, null);
  assert.match(s.geo.message, /not available on the website/);
  const hits = C.searchStores('detwilers', d.stores);
  assert.equal(hits[0].name, "Detwiler's Farm Market");
  s = C.bestCardScreen(d, nolan, { type: 'store', storeID: hits[0].id }, 80, { available: true, permission: 'denied' }, oct20);
  assert.equal(s.recommendation.best.cardName, 'Demo Grocery Card');
  s = C.bestCardScreen(d, nolan, { type: 'category', category: 'restaurants' }, null, { available: false, permission: 'unknown' }, oct20);
  assert.equal(s.recommendation.best.cardName, 'Demo Dining Points Card');
  const g = C.geoStatus(true, 'granted');
  assert.equal(g.canFindNearby, true);
  assert.match(g.message, /only when you tap it/);
});

test('ambiguous selection screen lists choices', () => {
  const d = C.demoHousehold(oct20);
  const s = C.bestCardScreen(d, nolan, { type: 'choose', storeIDs: [d.stores[0].id, d.stores[1].id] }, null, undefined, oct20);
  assert.equal(s.title, 'Which store are you at?');
  assert.equal(s.storeChoices.length, 2);
});

// ---- Validation & household edits
test('last-4 validation', () => {
  assert.equal(C.normalizeLast4(' 1234 '), '1234');
  assert.equal(C.normalizeLast4(''), null);
  assert.equal(C.normalizeLast4(null), null);
  for (const bad of ['123', '12345', '12a4', '١٢٣٤']) assert.throws(() => C.normalizeLast4(bad), (e) => e.code === 'last4');
});

test('rejects card numbers and invalid cards', () => {
  const d = H([]);
  assert.throws(() => C.upsertCard(d, card({ name: '4111 1111 1111 1111' })), (e) => e.code === 'cardNumber');
  assert.throws(() => C.upsertCard(d, card({ name: '4111-1111-1111-1111' })), (e) => e.code === 'cardNumber');
  assert.throws(() => C.upsertCard(d, card({ name: '  ' })), (e) => e.code === 'name');
  assert.throws(() => C.upsertCard(d, card({ name: 'X', availableTo: [] })), (e) => e.code === 'people');
  assert.doesNotThrow(() => C.upsertCard(d, card({ name: 'Costco 2% card', last4: '4242' })));
});

test('add / edit / archive / restore / delete', () => {
  let d = H([]);
  const c = card({ name: 'My Card', availableTo: [nolan] });
  d = C.upsertCard(d, c);
  d = C.upsertCard(d, { ...c, name: 'Renamed' });
  assert.equal(d.cards.length, 1);
  assert.equal(d.cards[0].name, 'Renamed');
  d = C.setArchived(d, c.id, true);
  assert.equal(C.cardsFor(d, nolan).length, 0);
  assert.equal(C.cardsFor(d, nolan, true).length, 1);
  d = C.setArchived(d, c.id, false);
  assert.equal(C.cardsFor(d, nolan).length, 1);
  d = C.deleteCard(d, c.id);
  assert.equal(d.cards.length, 0);
});

test('replace demo cards', () => {
  let d = C.demoHousehold(oct20);
  d = C.upsertCard(d, card({ name: 'Our Real Card' }));
  d = C.removeDemoCards(d);
  assert.deepEqual(d.cards.map((c) => c.name), ['Our Real Card']);
});

test('logging a purchase goes to the right bucket', () => {
  let d = C.demoHousehold(oct20);
  d = C.logPurchase(d, 'demo-grocery', brittany, 'groceries', 250, oct20);
  d = C.logPurchase(d, 'demo-grocery', nolan, 'groceries', 100, oct20);
  const g = d.cards.find((c) => c.id === 'demo-grocery');
  assert.equal(C.spentThisPeriod(g.bonusRules[0], 'shared', oct20), 350);
  d = C.logPurchase(d, 'demo-grocery', nolan, 'gas', 40, oct20);
  assert.deepEqual(d.cards.find((c) => c.id === 'demo-grocery').bonusRules[1].trackedSpend, {});
});

test('reset periods', () => {
  const d = date(2026, 11, 15);
  assert.equal(C.periodID({ type: 'quarterly' }, d), '2026-Q4');
  assert.equal(C.periodID({ type: 'monthly' }, d), '2026-M11');
  assert.equal(C.periodID({ type: 'anniversaryYear', startMonth: 3 }, date(2027, 2, 1)), 'A2026-3');
  assert.equal(C.nextReset({ type: 'quarterly' }, d).getTime(), date(2027, 1, 1, 0, 0).getTime());
  assert.equal(C.nextReset({ type: 'anniversaryYear', startMonth: 3 }, d).getTime(), date(2027, 3, 1, 0, 0).getTime());
  assert.equal(C.nextReset({ type: 'never' }, d), null);
});

test('export / import round trip; import rejects bad files and card numbers', () => {
  let d = C.demoHousehold(oct20);
  d = C.confirmCategory(d, d.stores[0].id, 'groceries', 'demo-grocery', oct20);
  const back = C.importJSON(C.exportJSON(d));
  assert.deepEqual(back, d);
  assert.throws(() => C.importJSON('not json'), (e) => e.code === 'import');
  assert.throws(() => C.importJSON('{"foo":1}'), (e) => e.code === 'import');
  const evil = structuredClone(d); evil.cards[0].name = '4111111111111111';
  assert.throws(() => C.importJSON(JSON.stringify(evil)), (e) => e.code === 'cardNumber');
});

test('formatting', () => {
  assert.equal(C.money(6), '$6.00');
  assert.equal(C.money(1500), '$1,500');
  assert.equal(C.money(12.5), '$12.50');
  assert.equal(C.num(3.75), '3.75');
});

test('mutations never modify the input object', () => {
  const d = C.demoHousehold(oct20);
  const snap = JSON.stringify(d);
  C.logPurchase(d, 'demo-grocery', nolan, 'groceries', 100, oct20);
  C.removeDemoCards(d);
  C.confirmCategory(d, d.stores[0].id, 'other', null, oct20);
  assert.equal(JSON.stringify(d), snap);
});

// ---- Store links (?store=) for iPhone Shortcuts
const linkStores = () => [
  { ...store('Publix', 'groceries'), id: 'store-publix' },
  { ...store("Detwiler's Farm Market", 'groceries'), id: 'store-detwilers' },
  { ...store('Tom & Jerry Diner', 'restaurants'), id: 'store-tj' },
  { ...store('Costco', 'groceries'), id: 'store-costco-a' },
  { ...store('costco', 'groceries'), id: 'store-costco-b' },
];
const fromURL = (url) => C.resolveStoreParam(C.storeParamFromSearch(new URL(url).search), linkStores());

test('store link: matches by id', () => {
  assert.deepEqual(C.resolveStoreParam('store-publix', linkStores()), { type: 'store', storeID: 'store-publix' });
  assert.deepEqual(fromURL('https://x.test/rightcard/?store=store-tj'), { type: 'store', storeID: 'store-tj' });
});
test('store link: matches name ignoring case and extra spaces', () => {
  for (const q of ['publix', 'PUBLIX', '  Publix ', 'pUbLiX']) assert.deepEqual(C.resolveStoreParam(q, linkStores()), { type: 'store', storeID: 'store-publix' }, q);
  assert.deepEqual(C.resolveStoreParam('detwilers farm market', linkStores()), { type: 'store', storeID: 'store-detwilers' }); // punctuation-insensitive
});
test('store link: URL-encoded names with spaces, &, apostrophes, and +', () => {
  assert.deepEqual(fromURL('https://x.test/rightcard/?store=Tom%20%26%20Jerry%20Diner'), { type: 'store', storeID: 'store-tj' });
  assert.deepEqual(fromURL('https://x.test/rightcard/?store=tom+%26+jerry+diner'), { type: 'store', storeID: 'store-tj' });
  assert.deepEqual(fromURL("https://x.test/rightcard/?store=Detwiler's%20Farm%20Market"), { type: 'store', storeID: 'store-detwilers' });
  assert.deepEqual(fromURL('https://x.test/rightcard/?store=Detwiler%27s%20Farm%20Market&x=1'), { type: 'store', storeID: 'store-detwilers' });
  // a value that is still encoded (double-encoded by an app) is decoded once more
  assert.deepEqual(C.resolveStoreParam('Tom%20%26%20Jerry%20Diner', linkStores()), { type: 'store', storeID: 'store-tj' });
});
test('store link: no match never returns a store (no partial guesses)', () => {
  for (const q of ['Pub', 'Publix Pharmacy', 'Whole Foods', 'Tom', '%%%', '']) {
    assert.equal(C.resolveStoreParam(q, linkStores()).type, 'none', q);
  }
  assert.equal(fromURL('https://x.test/rightcard/?store=Trader%20Joe%27s').query, "Trader Joe's");
  assert.equal(C.storeParamFromSearch('?foo=1'), null);
  assert.equal(C.resolveStoreParam(null, linkStores()).type, 'none');
  assert.equal(C.resolveStoreParam('Publix', []).type, 'none');
});
test('store link: duplicate names ask which store (existing ambiguous prompt)', () => {
  assert.deepEqual(C.resolveStoreParam('COSTCO', linkStores()), { type: 'choose', storeIDs: ['store-costco-a', 'store-costco-b'] });
  const scr = C.bestCardScreen(H([flat2()], linkStores()), nolan, C.resolveStoreParam('costco', linkStores()), null);
  assert.equal(scr.storeChoices.length, 2);
  assert.equal(scr.recommendation, null);
});
test('store link: starter store names from demo data open the Best Card result', () => {
  const d = C.demoHousehold(oct20);
  const sel = C.resolveStoreParam('tesla supercharger', d.stores);
  assert.deepEqual(sel, { type: 'store', storeID: 'store-tesla' });
  const scr = C.bestCardScreen(d, nolan, sel, null, undefined, oct20);
  assert.equal(scr.title, 'Tesla Supercharger');
  assert.ok(scr.recommendation && scr.recommendation.best);
});
test('store link: building links keeps the GitHub Pages sub-path and round-trips', () => {
  const all = linkStores();
  const page = 'https://jnolanbuss.github.io/rightcard/?store=old#x';
  const tj = C.storeLink(page, all[2], all);
  assert.equal(tj, 'https://jnolanbuss.github.io/rightcard/?store=Tom%20%26%20Jerry%20Diner');
  assert.equal(C.storeLink('https://jnolanbuss.github.io/rightcard/index.html', all[1], all), "https://jnolanbuss.github.io/rightcard/index.html?store=Detwiler's%20Farm%20Market");
  // duplicate names fall back to the id so the link is never ambiguous
  assert.equal(C.storeLink(page, all[3], all), 'https://jnolanbuss.github.io/rightcard/?store=store-costco-a');
  for (const s of all) assert.deepEqual(fromURL(C.storeLink(page, s, all)), { type: 'store', storeID: s.id }, s.name);
});

// ---- Nearby places directory
const home = { lat: 27.4700, lon: -82.5300 };
const mv = (m, dir = 'n') => (dir === 'n' ? { lat: home.lat + m / 111320, lon: home.lon } : { lat: home.lat, lon: home.lon + m / (111320 * Math.cos(home.lat * Math.PI / 180)) });
const place = (id, n, k, at, extra = {}) => ({ id, n, k, la: at.lat, lo: at.lon, ...extra });
const dir = () => [
  place('osm-n1', 'Sunshine Fuel', 'gas', mv(40)),
  place('osm-n2', 'Corner Cafe', 'cafe', mv(120, 'e')),
  place('osm-n3', 'Far Market', 'grocery', mv(900)),
  place('osm-n4', 'Publix', 'grocery', mv(400, 'e'), { a: '1 Main St, Bradenton' }),
];

test('places: nearest single match within ~150 m', () => {
  const r = C.whereAmI(mv(30), 10, [], dir().filter((p) => p.id !== 'osm-n2'));
  assert.equal(r.type, 'one');
  assert.equal(r.storeID, 'osm-n1');
  assert.equal(r.stores[0].suggestedCategory, 'gas');
  assert.equal(r.stores[0].name, 'Sunshine Fuel');
});
test('places: several within range → ask, nearest first', () => {
  const r = C.whereAmI(home, 10, [], dir());
  assert.equal(r.type, 'ask');
  assert.deepEqual(r.storeIDs, ['osm-n1', 'osm-n2']);
  const scr = C.bestCardScreen({ ...H([flat2()], r.stores) }, nolan, { type: 'choose', storeIDs: r.storeIDs }, null);
  assert.deepEqual(scr.storeChoices.map((s) => s.name), ['Sunshine Fuel', 'Corner Cafe']);
});
test('places: none in range', () => {
  assert.equal(C.whereAmI(mv(2000), 10, [], dir()).type, 'none');
  assert.equal(C.whereAmI(home, 10, [], []).type, 'none');
  // poor GPS accuracy only widens the range a little (capped at +100 m)
  assert.equal(C.whereAmI(mv(700, 'e'), 5000, [], dir()).type, 'none');
});
test('places: saved store at the spot (and its confirmed category) wins over the directory', () => {
  const saved = { ...store('Publix', 'groceries'), id: 'store-publix', confirmations: [{ id: 'c1', date: oct20.toISOString(), category: 'other', cardID: null }] };
  const r = C.whereAmI(mv(400, 'e'), 10, [saved], dir());
  assert.deepEqual([r.type, r.storeID, r.stores.length], ['one', 'store-publix', 0]);
  const rec = C.recommendForStore(H([grocery(), flat2()], [saved]), nolan, saved, null, oct20);
  assert.equal(rec.category, 'other'); // confirmed from past purchases, not the map guess
  // a saved store with its own location is found too, merged with directory hits
  const mine = { ...store('My Gym', 'other', mv(60, 'e')), id: 'my-gym' };
  const r2 = C.whereAmI(home, 10, [mine], dir());
  assert.equal(r2.type, 'ask');
  assert.deepEqual(r2.storeIDs, ['osm-n1', 'my-gym', 'osm-n2']);
});
test('places: category mapping is a plain-language likely category', () => {
  const m = (k) => C.placeKindInfo(k);
  assert.deepEqual([m('gas').category, m('gas').looksLike], ['gas', 'Looks like a gas station']);
  assert.equal(m('ev').category, 'evCharging');
  assert.equal(m('ev').looksLike, 'Looks like an EV charger');
  assert.equal(m('grocery').category, 'groceries');
  for (const k of ['restaurant', 'fastfood', 'cafe']) assert.equal(m(k).category, 'restaurants', k);
  for (const k of ['convenience', 'warehouse', 'department', 'variety', 'mall', 'general', 'clothes', 'electronics', 'hardware', 'pharmacy']) assert.equal(m(k).category, 'other', k);
  assert.equal(m('unknown-kind').category, 'other');
  const st = C.placeToStore(dir()[0]);
  const rec = C.recommendForStore(H([flat2()], [st]), nolan, st, null, oct20);
  assert.match(rec.categoryNote, /^Looks like a gas station, so we're using Gas\./);
  assert.match(rec.categoryNote, /Card companies decide how a store is classified/);
});
test('places: search by name or brand, nearest first when location is known', () => {
  const ps = [place('a', 'Publix', 'grocery', mv(3000)), place('b', 'Publix', 'grocery', mv(500)), place('c', 'Speedway 123', 'gas', mv(100), { b: 'Speedway' }), place('d', 'Publix Pharmacy', 'pharmacy', mv(800))];
  assert.deepEqual(C.searchPlaces('publix', ps, home).map((p) => p.id), ['b', 'd', 'a']);
  assert.ok(C.searchPlaces('publix', ps, home)[0].distance < 600);
  assert.deepEqual(C.searchPlaces('speedway', ps).map((p) => p.id), ['c']);
  assert.deepEqual(C.searchPlaces('p', ps), []); // too short
});
test('places: bundled directory file is well-formed', async () => {
  const fs = await import('node:fs');
  const j = JSON.parse(fs.readFileSync(new URL('../places-bradenton.json', import.meta.url), 'utf8'));
  assert.ok(j.places.length > 100);
  const ids = new Set();
  for (const p of j.places) {
    assert.ok(p.n && typeof p.la === 'number' && typeof p.lo === 'number' && C.PLACE_KINDS[p.k], JSON.stringify(p));
    assert.ok(!ids.has(p.id)); ids.add(p.id);
  }
});
