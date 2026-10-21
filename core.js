// RightCard core logic — a faithful JavaScript port of RightCardCore (Swift).
// Pure functions, no DOM. Used by app.js in the browser and by tests under Node.

export const CATEGORIES = [
  { id: 'groceries', name: 'Groceries', icon: '🛒' },
  { id: 'restaurants', name: 'Restaurants', icon: '🍽️' },
  { id: 'gas', name: 'Gas', icon: '⛽' },
  { id: 'evCharging', name: 'EV Charging', icon: '🔌' },
  { id: 'entertainment', name: 'Entertainment', icon: '🎟️' },
  { id: 'travel', name: 'Travel', icon: '✈️' },
  { id: 'amazon', name: 'Amazon', icon: '📦' },
  { id: 'utilities', name: 'Utilities', icon: '💡' },
  { id: 'other', name: 'Everything Else', icon: '💳' },
];
export const catName = (id) => (CATEGORIES.find((c) => c.id === id) || { name: id }).name;
export const catIcon = (id) => (CATEGORIES.find((c) => c.id === id) || { icon: '💳' }).icon;

export const NETWORKS = { visa: 'Visa', mastercard: 'Mastercard', amex: 'American Express', discover: 'Discover', other: 'Other / Not sure' };

export const uid = () =>
  (globalThis.crypto && crypto.randomUUID ? crypto.randomUUID() : 'id-' + Math.random().toString(36).slice(2) + Date.now().toString(36));

// ---------- Formatting ----------
export function money(v) {
  const cents = Math.round(v * 100);
  const neg = cents < 0;
  const abs = Math.abs(cents);
  const dollars = Math.floor(abs / 100), rem = abs % 100;
  const grouped = dollars.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const body = rem === 0 && dollars >= 100 ? `$${grouped}` : `$${grouped}.${rem.toString().padStart(2, '0')}`;
  return neg ? '-' + body : body;
}
export function num(v) {
  const r = Math.round(v * 100) / 100;
  return Number.isInteger(r) ? String(r) : String(r);
}

// ---------- Reward units ----------
export function dollarsPerDollar(unit, rate) {
  if (unit && unit.type === 'points') return (rate * unit.cpp) / 100;
  return rate / 100;
}
export function rateDescription(card, rate) {
  if (card.unit && card.unit.type === 'points') {
    const pct = dollarsPerDollar(card.unit, rate) * 100;
    return `${num(rate)}x ${card.unit.name || 'points'} (≈${num(pct)}%)`;
  }
  return `${num(rate)}%`;
}

// ---------- Reset periods ----------
const toDate = (d) => (d instanceof Date ? d : new Date(d));

export function periodID(reset, date) {
  const d = toDate(date);
  const y = d.getFullYear(), m = d.getMonth() + 1;
  switch (reset.type) {
    case 'never': return 'all';
    case 'monthly': return `${y}-M${m}`;
    case 'quarterly': return `${y}-Q${Math.floor((m - 1) / 3) + 1}`;
    case 'calendarYear': return `${y}`;
    case 'anniversaryYear': {
      const s = Math.min(Math.max(reset.startMonth || 1, 1), 12);
      return `A${m >= s ? y : y - 1}-${s}`;
    }
    default: return 'all';
  }
}
export function nextReset(reset, date) {
  const d = toDate(date);
  const y = d.getFullYear(), m = d.getMonth() + 1;
  switch (reset.type) {
    case 'monthly': return m === 12 ? new Date(y + 1, 0, 1) : new Date(y, m, 1);
    case 'quarterly': {
      const nq = (Math.floor((m - 1) / 3) + 1) * 3 + 1;
      return nq > 12 ? new Date(y + 1, 0, 1) : new Date(y, nq - 1, 1);
    }
    case 'calendarYear': return new Date(y + 1, 0, 1);
    case 'anniversaryYear': {
      const s = Math.min(Math.max(reset.startMonth || 1, 1), 12);
      return new Date(m >= s ? y + 1 : y, s - 1, 1);
    }
    default: return null;
  }
}
export const RESET_LABELS = { never: 'Never resets', monthly: 'Every month', quarterly: 'Every quarter', calendarYear: 'Every year (Jan 1)', anniversaryYear: 'Every year (other month)' };

// ---------- Accounts & limits ----------
export const accountKey = (card, personID) => (card.accountMode === 'separate' ? personID : 'shared');

export function spentThisPeriod(rule, key, date) {
  if (!rule.cap) return 0;
  const t = (rule.trackedSpend || {})[key];
  if (!t) return 0;
  return t.periodID === periodID(rule.cap.reset, date) ? t.amount : 0;
}
export function remaining(rule, key, date) {
  if (!rule.cap) return null;
  return Math.max(0, rule.cap.limit - spentThisPeriod(rule, key, date));
}
function rotatingInWindow(rot, date) {
  const d = toDate(date);
  if (rot.from && d < toDate(rot.from)) return false;
  if (rot.until && d > toDate(rot.until)) return false;
  return true;
}

// ---------- Name matching / search ----------
export const normalize = (s) => (s || '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
export function nameMatches(a, b) {
  const x = normalize(a), y = normalize(b);
  if (!x || !y) return false;
  return x === y || x.includes(y) || y.includes(x);
}
export function searchStores(query, stores) {
  const q = normalize(query);
  const byName = (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
  if (!q) return [...stores].sort(byName);
  return stores
    .filter((s) => normalize(s.name).includes(q))
    .sort((a, b) => {
      const ap = normalize(a.name).startsWith(q), bp = normalize(b.name).startsWith(q);
      if (ap !== bp) return ap ? -1 : 1;
      return byName(a, b);
    });
}

// ---------- Offers ----------
export function offerLive(o, date) {
  const d = toDate(date);
  if (o.startDate && d < toDate(o.startDate)) return false;
  return d <= toDate(o.expires);
}
export function offerReward(o, amount) {
  if (amount < (o.minSpend || 0)) return 0;
  const raw = o.kind === 'percent' ? (amount * o.value) / 100 : o.value;
  return o.maxReward != null ? Math.min(raw, o.maxReward) : raw;
}
export function offerDescription(o) {
  let s = o.kind === 'percent' ? `${num(o.value)}% back at ${o.merchantName}` : `${money(o.value)} back at ${o.merchantName}`;
  if (o.minSpend > 0) s += ` on ${money(o.minSpend)}+`;
  if (o.maxReward != null) s += ` (up to ${money(o.maxReward)})`;
  return s;
}

// ---------- Store category ----------
/** @returns {{category:string, confidence:{type:'manual'|'confirmed'|'mixed'|'unconfirmed', count?:number, categories?:string[]}}} */
export function effectiveCategory(store) {
  const conf = store.confirmations || [];
  if (!conf.length) return { category: store.suggestedCategory, confidence: { type: 'unconfirmed' } };
  const counts = {};
  for (const c of conf) counts[c.category] = (counts[c.category] || 0) + 1;
  const keys = Object.keys(counts);
  if (keys.length === 1) return { category: keys[0], confidence: { type: 'confirmed', count: counts[keys[0]] } };
  const latest = [...conf].sort((a, b) => toDate(b.date) - toDate(a.date))[0].category;
  let top = keys[0];
  for (const k of keys) {
    if (counts[k] > counts[top] || (counts[k] === counts[top] && k === latest)) top = k;
  }
  return { category: top, confidence: { type: 'mixed', categories: keys.sort() } };
}
export const storeAccepts = (store, network) => !store.acceptedNetworks || !store.acceptedNetworks.length || store.acceptedNetworks.includes(network);

// ---------- Rewards engine ----------
function fmtDate(d) { return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`; }

function chooseRule(card, ctx, amount) {
  const key = accountKey(card, ctx.personID);
  const unit = card.unit;
  const cautions = [];
  const base = {
    rule: null, reward: (amount || 0) * dollarsPerDollar(unit, card.baseRate), crosses: false, remaining: null,
    marginalRate: card.baseRate, notes: [`${rateDescription(card, card.baseRate)} on everything`], cautions: [],
  };
  let best = null;
  for (const rule of card.bonusRules || []) {
    if (!rule.categories.includes(ctx.category)) continue;
    if (ctx.store && (rule.excludedMerchants || []).some((m) => nameMatches(m, ctx.store.name))) {
      cautions.push(`${ctx.store.name} is excluded from this card's ${rateDescription(card, rule.rate)} ${catName(ctx.category)} bonus.`);
      continue;
    }
    if (rule.rotating) {
      if (!rotatingInWindow(rule.rotating, ctx.date)) { cautions.push(`The ${rateDescription(card, rule.rate)} rotating bonus isn't running right now.`); continue; }
      if (!rule.rotating.activated) { cautions.push(`Activate this card's ${rateDescription(card, rule.rate)} rotating bonus to earn it. Until then it earns the regular rate.`); continue; }
    }
    const fallback = rule.rateAfterCap != null ? rule.rateAfterCap : card.baseRate;
    const rem = remaining(rule, key, ctx.date);
    const cc = [];
    let notes = [`${rateDescription(card, rule.rate)} on ${catName(ctx.category)}` + (rule.rotating ? ' (rotating bonus, activated)' : '')];
    let marginal, reward = 0, crosses = false;
    if (rem != null) {
      marginal = rem > 0 ? rule.rate : fallback;
      const nr = nextReset(rule.cap.reset, ctx.date);
      const resetText = nr ? ` It resets ${fmtDate(nr)}.` : '';
      if (rem <= 0) {
        cc.push(`Bonus limit used up for this period, so it earns ${rateDescription(card, fallback)}.${resetText}`);
        notes = [`${rateDescription(card, fallback)} (bonus limit used up)`];
      } else {
        notes.push(`${money(rem)} of bonus spending left` + (card.accountMode === 'shared' && card.availableTo.length > 1 ? ' (shared by everyone on this account)' : ''));
      }
      if (amount != null) {
        const bonusPortion = Math.min(amount, rem);
        const rest = amount - bonusPortion;
        reward = bonusPortion * dollarsPerDollar(unit, rule.rate) + rest * dollarsPerDollar(unit, fallback);
        if (rest > 0 && bonusPortion > 0) {
          crosses = true;
          cc.push(`Only ${money(bonusPortion)} earns ${rateDescription(card, rule.rate)}; the other ${money(rest)} earns ${rateDescription(card, fallback)}.`);
        }
      }
    } else {
      marginal = rule.rate;
      if (amount != null) reward = amount * dollarsPerDollar(unit, rule.rate);
    }
    const cand = { rule, reward, crosses, remaining: rem, marginalRate: marginal, notes, cautions: cc };
    const better = !best || (amount != null ? cand.reward > best.reward : cand.marginalRate > best.marginalRate);
    if (better) best = cand;
  }
  if (best) {
    const beats = amount != null ? best.reward >= base.reward : best.marginalRate >= base.marginalRate;
    if (beats) { best.cautions = [...cautions, ...best.cautions]; return best; }
  }
  base.cautions = cautions;
  return base;
}

/** @returns {{estimate?:object, ineligible?:{cardID,cardName,reason}}} */
export function estimate(card, ctx) {
  if (card.archived) return { ineligible: { cardID: card.id, cardName: card.name, reason: 'Archived' } };
  if (!card.availableTo.includes(ctx.personID)) return { ineligible: { cardID: card.id, cardName: card.name, reason: 'Not available to this person' } };
  if (ctx.store && !storeAccepts(ctx.store, card.network)) {
    return { ineligible: { cardID: card.id, cardName: card.name, reason: `${ctx.store.name} doesn't take ${NETWORKS[card.network] || card.network}` } };
  }
  const amount = ctx.amount ?? null;
  const choice = chooseRule(card, ctx, amount);
  const reasons = [...choice.notes];
  const cautions = [...choice.cautions];

  const fees = (card.fees || []).filter((f) => (!f.categories || !f.categories.length || f.categories.includes(ctx.category)) && (f.percent > 0 || f.flat > 0));
  const surcharge = (ctx.store && ctx.store.surchargePercent) || 0;
  const pctFees = fees.reduce((a, f) => a + (f.percent || 0), 0) + surcharge;
  for (const f of fees) cautions.push(`Fee: ${f.label}` + (f.percent > 0 ? ` ${num(f.percent)}%` : '') + (f.flat > 0 ? ` + ${money(f.flat)}` : ''));
  if (surcharge > 0) cautions.push(`${ctx.store.name} adds a ${num(surcharge)}% credit card surcharge.`);

  let offerValue = null, offerMarginal = 0;
  if (ctx.store) {
    let bestOffer = null;
    for (const o of card.offers || []) {
      if (!nameMatches(o.merchantName, ctx.store.name)) continue;
      if (!offerLive(o, ctx.date)) {
        if (toDate(ctx.date) > toDate(o.expires)) cautions.push(`Offer expired: ${offerDescription(o)}.`);
        continue;
      }
      if (!o.enrolled) { cautions.push(`Offer not added to card yet: ${offerDescription(o)}.`); continue; }
      if (o.enrolledPeople && o.enrolledPeople.length && !o.enrolledPeople.includes(ctx.personID)) continue;
      if (amount != null) {
        const v = offerReward(o, amount);
        if (amount < (o.minSpend || 0)) cautions.push(`Spend ${money(o.minSpend - amount)} more to unlock: ${offerDescription(o)}.`);
        if (!bestOffer || v > bestOffer.v) bestOffer = { o, v };
      } else if (!(o.minSpend > 0) && o.kind === 'percent') {
        const v = o.value / 100;
        if (!bestOffer || v > bestOffer.v) bestOffer = { o, v };
      } else {
        cautions.push(`Depends on amount: ${offerDescription(o)}.`);
      }
    }
    if (bestOffer) {
      const { o, v } = bestOffer;
      if (amount != null) { offerValue = v; if (v > 0) reasons.push(`Plus offer: ${offerDescription(o)}`); }
      else { offerMarginal = v; reasons.push(`Plus offer: ${offerDescription(o)}` + (o.maxReward != null ? ' — limited' : '')); }
      if (!o.stacks) {
        cautions.push("This offer doesn't stack: you get the offer or the card's normal rewards, whichever is more.");
        if (amount != null) offerValue = Math.max(0, offerValue - choice.reward);
        else offerMarginal = Math.max(0, offerMarginal - dollarsPerDollar(card.unit, choice.marginalRate));
      }
    }
  }

  const est = {
    cardID: card.id, cardName: card.name, colorHex: card.colorHex, last4: card.last4 || null, isDemo: !!card.isDemo,
    headlineRate: rateDescription(card, choice.marginalRate),
    marginalValuePerDollar: dollarsPerDollar(card.unit, choice.marginalRate) + offerMarginal - pctFees / 100,
    rewardValue: null, offerValue: null, feeValue: null, netValue: null, effectivePercent: null,
    bonusRemaining: choice.remaining, crossesBonusLimit: choice.crosses,
    usesBonusRate: !!choice.rule && (choice.remaining == null || choice.remaining > 0),
    reasons, cautions,
  };
  if (amount != null) {
    const feeValue = fees.reduce((a, f) => a + (amount * (f.percent || 0)) / 100 + (f.flat || 0), 0) + (amount * surcharge) / 100;
    const net = choice.reward + (offerValue || 0) - feeValue;
    Object.assign(est, { rewardValue: choice.reward, offerValue, feeValue, netValue: net, effectivePercent: amount > 0 ? (net / amount) * 100 : 0 });
  }
  return { estimate: est };
}

export const PROBE_AMOUNTS = [5, 10, 20, 35, 50, 75, 100, 150, 200, 300, 500, 750, 1000, 1500, 2000, 3000, 5000, 10000];

function rank(cards, ctx) {
  const list = [], bad = [];
  for (const c of cards) {
    const r = estimate(c, ctx);
    if (r.estimate) list.push(r.estimate);
    if (r.ineligible) bad.push(r.ineligible);
  }
  const val = (e) => (ctx.amount != null ? e.netValue || 0 : e.marginalValuePerDollar);
  list.sort((a, b) => {
    const d = val(b) - val(a);
    if (Math.abs(d) > 1e-9) return d;
    return a.cardName.localeCompare(b.cardName, undefined, { sensitivity: 'base' });
  });
  return { list, bad };
}

/**
 * ctx: {personID, category, store?, amount?, date}
 * confidence: {type:'manual'|'confirmed'|'mixed'|'unconfirmed', ...}
 */
export function recommend(cards, ctx, confidence = { type: 'manual' }) {
  ctx = { amount: null, store: null, date: new Date(), ...ctx };
  const { list, bad } = rank(cards, ctx);
  const rec = {
    category: ctx.category, confidence, ranked: list, ineligible: bad,
    best: list[0] || null, nextBest: list[1] || null,
    dependsOnAmount: false, amountNote: null, categoryNote: null, alternativeCategoryNote: null,
  };
  if (ctx.amount == null && rec.best) {
    for (const probe of PROBE_AMOUNTS) {
      const r = rank(cards, { ...ctx, amount: probe }).list;
      const winner = r[0];
      const bestThere = r.find((e) => e.cardID === rec.best.cardID);
      if (winner && winner.cardID !== rec.best.cardID && (winner.netValue || 0) - ((bestThere && bestThere.netValue) || 0) > 0.005) {
        rec.dependsOnAmount = true;
        rec.amountNote = `The best card depends on how much you spend. At about ${money(probe)}, ${winner.cardName} earns more. Enter the amount for an exact answer.`;
        break;
      }
    }
  }
  if (ctx.store) {
    const s = ctx.store;
    if (confidence.type === 'confirmed') {
      const n = confidence.count;
      rec.categoryNote = `Past purchases at ${s.name} counted as ${catName(ctx.category)} (${n} time${n === 1 ? '' : 's'}). It usually stays the same, but isn't guaranteed.`;
    } else if (confidence.type === 'mixed') {
      rec.categoryNote = `Past purchases at ${s.name} were counted differently (${confidence.categories.map(catName).join(', ')}). We're using ${catName(ctx.category)}.`;
    } else if (confidence.type === 'unconfirmed') {
      rec.categoryNote = `We're guessing ${s.name} counts as ${catName(ctx.category)}. Card companies decide how a store is coded, and it can differ. After you shop, check your statement and confirm it here.`;
    }
    if (confidence.type === 'unconfirmed' || confidence.type === 'mixed') {
      const alt = ctx.category === 'other' ? 'groceries' : 'other';
      const r = rank(cards, { ...ctx, category: alt }).list;
      if (r[0] && rec.best && r[0].cardID !== rec.best.cardID) {
        rec.alternativeCategoryNote = `If it's counted as ${catName(alt)} instead, ${r[0].cardName} would be best.`;
      }
    }
  }
  return rec;
}

export function recommendForStore(data, personID, store, amount, date = new Date()) {
  const eff = effectiveCategory(store);
  return recommend(data.cards, { personID, category: eff.category, store, amount, date }, eff.confidence);
}
export function recommendForCategory(data, personID, category, amount, date = new Date()) {
  return recommend(data.cards, { personID, category, store: null, amount, date }, { type: 'manual' });
}

// ---------- Validation ----------
export class ValidationError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}
export function normalizeLast4(raw) {
  if (raw == null) return null;
  const t = String(raw).trim();
  if (!t) return null;
  if (!/^[0-9]{4}$/.test(t)) throw new ValidationError('last4', 'Last four digits must be exactly 4 numbers, or leave it blank.');
  return t;
}
export function containsLongDigitRun(s, threshold = 8) {
  let run = 0;
  for (const ch of String(s)) {
    if (ch >= '0' && ch <= '9') { run++; if (run >= threshold) return true; }
    else if (ch === ' ' || ch === '-') continue;
    else run = 0;
  }
  return false;
}
export function validateCard(card) {
  const c = structuredClone(card);
  c.name = (c.name || '').trim();
  if (!c.name) throw new ValidationError('name', 'Give the card a name.');
  if (containsLongDigitRun(c.name)) throw new ValidationError('cardNumber', 'That looks like a card number. Use a nickname instead — RightCard never stores card numbers.');
  c.last4 = normalizeLast4(c.last4);
  if (!c.availableTo || !c.availableTo.length) throw new ValidationError('people', 'Choose at least one person who can use this card.');
  if (!(c.baseRate >= 0)) throw new ValidationError('negative', "Base rate can't be negative.");
  for (const r of c.bonusRules || []) {
    if (!(r.rate >= 0)) throw new ValidationError('negative', "Bonus rate can't be negative.");
    if (r.cap && !(r.cap.limit >= 0)) throw new ValidationError('negative', "Bonus limit can't be negative.");
  }
  if (c.unit && c.unit.type === 'points' && !(c.unit.cpp >= 0)) throw new ValidationError('negative', "Point value can't be negative.");
  return c;
}

// ---------- Household mutations (return new data objects; never mutate input) ----------
const clone = (x) => structuredClone(x);

export function upsertCard(data, card) {
  const c = validateCard(card);
  const d = clone(data);
  const i = d.cards.findIndex((x) => x.id === c.id);
  if (i >= 0) d.cards[i] = c; else d.cards.push(c);
  return d;
}
export function setArchived(data, id, archived) {
  const d = clone(data);
  const c = d.cards.find((x) => x.id === id);
  if (c) c.archived = archived;
  return d;
}
export function deleteCard(data, id) {
  const d = clone(data);
  d.cards = d.cards.filter((c) => c.id !== id);
  for (const s of d.stores) for (const c of s.confirmations || []) if (c.cardID === id) c.cardID = null;
  return d;
}
export function removeDemoCards(data) {
  const d = clone(data);
  d.cards = d.cards.filter((c) => !c.isDemo);
  return d;
}
export const cardsFor = (data, personID, includeArchived = false) =>
  data.cards.filter((c) => c.availableTo.includes(personID) && (includeArchived || !c.archived));

export function recordSpend(data, cardID, ruleID, personID, amount, date) {
  const d = clone(data);
  const card = d.cards.find((c) => c.id === cardID);
  const rule = card && card.bonusRules.find((r) => r.id === ruleID);
  if (!rule || !rule.cap || !(amount > 0)) return d;
  const key = accountKey(card, personID);
  const cur = spentThisPeriod(rule, key, date);
  rule.trackedSpend = rule.trackedSpend || {};
  rule.trackedSpend[key] = { amount: cur + amount, periodID: periodID(rule.cap.reset, date) };
  return d;
}
export function setSpend(data, cardID, ruleID, personID, amount, date) {
  const d = clone(data);
  const card = d.cards.find((c) => c.id === cardID);
  const rule = card && card.bonusRules.find((r) => r.id === ruleID);
  if (!rule || !rule.cap) return d;
  rule.trackedSpend = rule.trackedSpend || {};
  rule.trackedSpend[accountKey(card, personID)] = { amount: Math.max(0, amount), periodID: periodID(rule.cap.reset, date) };
  return d;
}
export function logPurchase(data, cardID, personID, category, amount, date) {
  const card = data.cards.find((c) => c.id === cardID);
  if (!card) return data;
  const rule = card.bonusRules.find((r) => r.cap && r.categories.includes(category) && (!r.rotating || (r.rotating.activated && rotatingInWindow(r.rotating, date))));
  return rule ? recordSpend(data, cardID, rule.id, personID, amount, date) : data;
}
export function upsertStore(data, store) {
  const d = clone(data);
  const s = clone(store);
  s.name = (s.name || '').trim();
  if (!s.name) throw new ValidationError('name', 'Give the store a name.');
  s.radius = Math.min(Math.max(s.radius || 150, 50), 1000);
  const i = d.stores.findIndex((x) => x.id === s.id);
  if (i >= 0) d.stores[i] = s; else d.stores.push(s);
  return d;
}
export function deleteStore(data, id) {
  const d = clone(data);
  d.stores = d.stores.filter((s) => s.id !== id);
  return d;
}
export function confirmCategory(data, storeID, category, cardID, date) {
  const d = clone(data);
  const s = d.stores.find((x) => x.id === storeID);
  if (s) (s.confirmations = s.confirmations || []).push({ id: uid(), date: toDate(date).toISOString(), category, cardID: cardID || null });
  return d;
}

// ---------- Geolocation (foreground only) ----------
export function distanceMeters(a, b) {
  const R = 6371000, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}
/** Saved stores whose area contains the fix (radius + GPS accuracy, accuracy capped at 500 m), nearest first. */
export function storesNear(point, accuracy, stores) {
  const acc = Math.min(Math.max(accuracy || 0, 0), 500);
  return stores
    .filter((s) => s.location && distanceMeters(s.location, point) <= (s.radius || 150) + acc)
    .sort((a, b) => distanceMeters(a.location, point) - distanceMeters(b.location, point));
}
/** Result of "Find nearby saved store": none / one / ask which. */
export function nearbyDecision(point, accuracy, stores) {
  const near = storesNear(point, accuracy, stores);
  if (!near.length) return { type: 'none' };
  if (near.length === 1) return { type: 'one', storeID: near[0].id };
  return { type: 'ask', storeIDs: near.map((s) => s.id) };
}

// ---------- Screen state (manual flow is primary) ----------
export function geoStatus(geoAvailable, permission) {
  // permission: 'granted' | 'denied' | 'prompt' | 'unknown'
  const bg = 'Arrival notifications are not available on the website. They need the native iPhone app.';
  if (!geoAvailable) return { canFindNearby: false, message: `This browser can't share location. Pick a store or category below. ${bg}` };
  if (permission === 'denied') return { canFindNearby: false, message: `Location is blocked for this site, so "Find nearby" is off. Pick a store or category below. ${bg}` };
  return { canFindNearby: true, message: `"Find nearby" checks your location only when you tap it, while the site is open. ${bg}` };
}

export function bestCardScreen(data, personID, selection, amount, geo = { available: true, permission: 'prompt' }, now = new Date()) {
  const person = data.people.find((p) => p.id === personID);
  const base = { personName: person ? person.name : '?', geo: geoStatus(geo.available, geo.permission), showManualPicker: true, recommendation: null, storeChoices: [] };
  if (!selection || selection.type === 'none') return { ...base, title: 'Where are you shopping?' };
  if (selection.type === 'choose') {
    return { ...base, title: 'Which store are you at?', storeChoices: selection.storeIDs.map((id) => data.stores.find((s) => s.id === id)).filter(Boolean) };
  }
  if (selection.type === 'store') {
    const s = data.stores.find((x) => x.id === selection.storeID);
    if (!s) return { ...base, title: 'Where are you shopping?' };
    return { ...base, title: s.name, showManualPicker: false, recommendation: recommendForStore(data, personID, s, amount, now) };
  }
  if (selection.type === 'category') {
    return { ...base, title: catName(selection.category), showManualPicker: false, recommendation: recommendForCategory(data, personID, selection.category, amount, now) };
  }
  return { ...base, title: 'Where are you shopping?' };
}

// ---------- Import / export ----------
export const SCHEMA = 1;
export function exportJSON(data) {
  return JSON.stringify({ app: 'RightCard', schema: SCHEMA, exportedAt: new Date().toISOString(), data }, null, 2);
}
export function importJSON(text) {
  let obj;
  try { obj = JSON.parse(text); } catch { throw new ValidationError('import', "That file isn't valid RightCard data."); }
  const data = obj && obj.app === 'RightCard' ? obj.data : obj;
  if (!data || !Array.isArray(data.people) || !Array.isArray(data.cards) || !Array.isArray(data.stores)) {
    throw new ValidationError('import', "That file isn't valid RightCard data.");
  }
  for (const c of data.cards) validateCard(c); // also rejects card numbers sneaking in
  data.settings = data.settings || {};
  return data;
}

// ---------- Demo data (FICTIONAL) ----------
export const NOLAN = 'person-nolan';
export const BRITTANY = 'person-brittany';

export function demoCards(now = new Date()) {
  const d = toDate(now);
  const qStartMonth = Math.floor(d.getMonth() / 3) * 3;
  const qStart = new Date(d.getFullYear(), qStartMonth, 1);
  const qEnd = new Date(d.getFullYear(), qStartMonth + 3, 1, 0, 0, -1);
  const in30 = new Date(d.getTime() + 30 * 86400000);
  return [
    { id: 'demo-grocery', name: 'Demo Grocery Card', last4: null, colorHex: '#1E8E5A', network: 'amex', unit: { type: 'cash' }, baseRate: 1,
      bonusRules: [
        { id: 'demo-grocery-r1', categories: ['groceries'], rate: 6, cap: { limit: 6000, reset: { type: 'calendarYear' } }, rateAfterCap: 1, rotating: null, excludedMerchants: [], trackedSpend: {} },
        { id: 'demo-grocery-r2', categories: ['gas', 'evCharging'], rate: 3, cap: null, rateAfterCap: null, rotating: null, excludedMerchants: [], trackedSpend: {} },
      ], fees: [], offers: [], availableTo: [NOLAN, BRITTANY], accountMode: 'shared', archived: false, isDemo: true },
    { id: 'demo-everyday', name: 'Demo Everyday Card', last4: null, colorHex: '#2E6BE6', network: 'visa', unit: { type: 'cash' }, baseRate: 2,
      bonusRules: [], fees: [],
      offers: [{ id: 'demo-offer-target', merchantName: 'Target', kind: 'percent', value: 10, minSpend: 50, maxReward: 15, startDate: null, expires: in30.toISOString(), stacks: true, enrolled: true, enrolledPeople: [] }],
      availableTo: [NOLAN, BRITTANY], accountMode: 'separate', archived: false, isDemo: true },
    { id: 'demo-dining', name: 'Demo Dining Points Card', last4: null, colorHex: '#B23A48', network: 'mastercard', unit: { type: 'points', name: 'points', cpp: 1.25 }, baseRate: 1,
      bonusRules: [
        { id: 'demo-dining-r1', categories: ['restaurants'], rate: 4, cap: null, rateAfterCap: null, rotating: null, excludedMerchants: [], trackedSpend: {} },
        { id: 'demo-dining-r2', categories: ['travel', 'entertainment'], rate: 3, cap: null, rateAfterCap: null, rotating: null, excludedMerchants: [], trackedSpend: {} },
      ], fees: [], offers: [], availableTo: [NOLAN], accountMode: 'separate', archived: false, isDemo: true },
    { id: 'demo-rotating', name: 'Demo Rotating 5% Card', last4: null, colorHex: '#7A4FD6', network: 'discover', unit: { type: 'cash' }, baseRate: 1,
      bonusRules: [
        { id: 'demo-rotating-r1', categories: ['amazon', 'gas'], rate: 5, cap: { limit: 1500, reset: { type: 'quarterly' } }, rateAfterCap: null,
          rotating: { activated: false, from: qStart.toISOString(), until: qEnd.toISOString() }, excludedMerchants: [], trackedSpend: {} },
      ], fees: [], offers: [], availableTo: [BRITTANY], accountMode: 'separate', archived: false, isDemo: true },
  ];
}

export function starterStores() {
  const s = (id, name, cat, note = null) => ({ id, name, suggestedCategory: cat, location: null, radius: 150, acceptedNetworks: [], surchargePercent: 0, confirmations: [], isStarter: true, note });
  return [
    s('store-publix', 'Publix', 'groceries'),
    s('store-detwilers', "Detwiler's Farm Market", 'groceries'),
    s('store-costco', 'Costco', 'groceries', 'Warehouse clubs are often not counted as groceries, and some only accept certain card networks. Confirm after your first visit.'),
    s('store-target', 'Target', 'other', 'Superstores are often counted as general shopping, not groceries. Confirm after your first visit.'),
    s('store-walmart', 'Walmart', 'other', 'Superstores are often counted as general shopping, not groceries. Confirm after your first visit.'),
    s('store-amazon', 'Amazon (online)', 'amazon'),
    s('store-tesla', 'Tesla Supercharger', 'evCharging', 'EV charging may be counted as gas, EV charging, or something else depending on the card. Confirm after your first charge.'),
    s('store-restaurant', 'Favorite Restaurant (rename me)', 'restaurants'),
    s('store-gas', 'Gas Station (rename me)', 'gas'),
  ];
}

export function demoHousehold(now = new Date()) {
  return {
    schema: SCHEMA,
    people: [{ id: NOLAN, name: 'Nolan' }, { id: BRITTANY, name: 'Brittany' }],
    cards: demoCards(now),
    stores: starterStores(),
    settings: { deviceOwnerID: null },
  };
}
