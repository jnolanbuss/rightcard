// RightCard web companion — UI layer. All logic lives in core.js (tested with node --test).
// Data is stored only in this browser (localStorage). No server, no sync, no background location.
import * as C from './core.js';

const KEY = 'rightcard.data.v1';
const PKEY = 'rightcard.person';
const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const COLORS = [['Blue', '#2E6BE6'], ['Green', '#1E8E5A'], ['Red', '#B23A48'], ['Purple', '#7A4FD6'], ['Orange', '#D9731A'], ['Teal', '#127C86'], ['Gold', '#C9A227'], ['Black', '#1C1C1E'], ['Silver', '#A7ADB5'], ['Pink', '#D94F8A']];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

// ---------------- State ----------------
function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return C.importJSON(raw);
  } catch (e) { console.warn('RightCard: stored data unreadable, starting with demo data', e); }
  return C.demoHousehold();
}
let data = load();
function save() {
  try { localStorage.setItem(KEY, C.exportJSON(data)); }
  catch (e) { toast("Couldn't save on this device: " + e.message); }
}
const ui = {
  tab: 'best',
  personID: localStorage.getItem(PKEY) || data.settings.deviceOwnerID || data.people[0].id,
  selection: { type: 'none' },
  amountText: '',
  search: '',
  storeSearch: '',
  geo: { available: 'geolocation' in navigator, permission: 'prompt' },
  locating: false,
};
let sheet = null; // { kind, draft, isNew, error }

function fixPerson() {
  if (!data.people.some((p) => p.id === ui.personID)) ui.personID = data.people[0].id;
}
fixPerson();

// ---------------- Helpers ----------------
function parseAmount(t) {
  const v = parseFloat(String(t).replace(/[$,\s]/g, ''));
  return Number.isFinite(v) && v > 0 ? v : null;
}
function readableText(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  const v = m ? parseInt(m[1], 16) : 0x2e6be6;
  const lin = (c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const L = 0.2126 * lin(((v >> 16) & 255) / 255) + 0.7152 * lin(((v >> 8) & 255) / 255) + 0.0722 * lin((v & 255) / 255);
  return 1.05 / (L + 0.05) >= (L + 0.05) / 0.05 ? '#ffffff' : '#000000';
}
function cardFace(c, compact = false) {
  const fg = readableText(c.colorHex);
  const label = `${c.cardName || c.name}${c.isDemo ? ', demo card' : ''}${c.last4 ? ', ending in ' + c.last4 : ''}`;
  return `<div class="cardface${compact ? ' compact' : ''}" role="img" aria-label="${esc(label)}"
    style="background: linear-gradient(160deg, ${esc(c.colorHex)}, color-mix(in srgb, ${esc(c.colorHex)} 70%, #000)); color:${fg}">
    <div class="cn">${esc(c.cardName || c.name)}${c.isDemo ? '<span class="demo">DEMO</span>' : ''}</div>
    ${c.last4 ? `<div class="l4">•••• ${esc(c.last4)}</div>` : '<div></div>'}
  </div>`;
}
const personName = (id) => (data.people.find((p) => p.id === id) || { name: '?' }).name;
const toInputDate = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const fromInputDate = (v, endOfDay = false) => {
  if (!v) return null;
  const [y, m, d] = v.split('-').map(Number);
  return (endOfDay ? new Date(y, m - 1, d, 23, 59, 59) : new Date(y, m - 1, d)).toISOString();
};
let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 3500);
}
function banner(text, kind = 'info', icon = 'ℹ️') {
  return `<div class="banner ${kind}"><span class="bi" aria-hidden="true">${icon}</span><div>${text}</div></div>`;
}
function catGrid(action, extra = '') {
  return `<div class="grid">${C.CATEGORIES.map((c) => `<button class="btn" data-action="${action}" data-cat="${c.id}" ${extra}><span class="ic" aria-hidden="true">${c.icon}</span>${esc(c.name)}</button>`).join('')}</div>`;
}

// ---------------- Render ----------------
function render() {
  fixPerson();
  $('#profile').innerHTML = data.people.map((p) =>
    `<button role="radio" aria-checked="${p.id === ui.personID}" data-action="person" data-id="${esc(p.id)}">${esc(p.name)}</button>`).join('');
  document.querySelectorAll('.tabs button').forEach((b) => {
    if (b.dataset.tab === ui.tab) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
  });
  const views = { best: viewBest, cards: viewCards, stores: viewStores, settings: viewSettings };
  $('#main').innerHTML = views[ui.tab]();
}

// ----- Best Card
function viewBest() {
  const amount = parseAmount(ui.amountText);
  const scr = C.bestCardScreen(data, ui.personID, ui.selection, amount, ui.geo, new Date());
  if (scr.recommendation) {
    return `<div class="row"><h1>${esc(scr.title)}</h1><span class="spacer"></span>
        <button class="link" data-action="clear-selection" aria-label="Change store or category">Change</button></div>
      <div class="amount"><label for="amount">Amount</label>
        <input id="amount" inputmode="decimal" placeholder="$0.00" autocomplete="off" value="${esc(ui.amountText)}" aria-label="Purchase amount in dollars (optional)"></div>
      <div id="result" aria-live="polite">${resultHTML(scr.recommendation, amount)}</div>`;
  }
  if (scr.storeChoices.length) {
    return `<h1>${esc(scr.title)}</h1><p class="muted">Several saved stores are close together. Which one are you at?</p>
      <div class="stack">${scr.storeChoices.map((s) => `<button class="btn" data-action="pick-store" data-id="${esc(s.id)}"><span aria-hidden="true">${C.catIcon(C.effectiveCategory(s).category)}</span>${esc(s.name)}</button>`).join('')}</div>
      <button class="link" data-action="clear-selection">None of these</button>`;
  }
  return `<h1>Where are you shopping?</h1>
    <input id="store-search" class="search" type="search" placeholder="Search your stores" aria-label="Search your saved stores" value="${esc(ui.search)}" autocomplete="off">
    <div id="store-results" style="margin-top:10px">${storeResultsHTML()}</div>
    <h2>Or pick what you're buying</h2>
    ${catGrid('pick-category')}
    <h2>Find nearby</h2>
    ${scr.geo.canFindNearby ? `<button class="btn plain" data-action="find-nearby" ${ui.locating ? 'disabled' : ''}>${ui.locating ? 'Checking your location…' : '📍 Find nearby saved store'}</button>` : ''}
    ${banner(esc(scr.geo.message), scr.geo.canFindNearby ? 'info' : 'warn', scr.geo.canFindNearby ? 'ℹ️' : '🚫')}`;
}
function storeResultsHTML() {
  const res = C.searchStores(ui.search, data.stores).slice(0, ui.search ? 30 : 12);
  if (!res.length) return `<p class="muted">No saved store matches. Add it in Saved Stores, or tap a category.</p>`;
  return `<div class="list">${res.map((s) => `<button class="item" data-action="pick-store" data-id="${esc(s.id)}">
      <span class="ic" aria-hidden="true">${C.catIcon(C.effectiveCategory(s).category)}</span><span class="spacer">${esc(s.name)}</span><span class="chev" aria-hidden="true">›</span></button>`).join('')}</div>`;
}
function resultHTML(rec, amount) {
  const best = rec.best;
  if (!best) return banner(`No card is available for ${esc(personName(ui.personID))}. Add one in My Cards.`, 'warn', '💳');
  let h = `<div class="use">Use this card</div>${cardFace(best)}
    <div class="rate">${esc(best.headlineRate)} <small>back</small></div>`;
  if (amount != null && best.netValue != null) {
    h += `<div class="est">Estimated rewards on ${C.money(amount)}: ${C.money(best.netValue)}</div>`;
    if (best.feeValue > 0) h += `<p class="muted small">Includes ${C.money(best.feeValue)} in fees.</p>`;
  }
  h += `<h3>Why this card</h3><ul class="why">${best.reasons.map((r) => `<li class="r">${esc(r)}</li>`).join('')}${best.cautions.map((c) => `<li class="c">${esc(c)}</li>`).join('')}</ul>`;
  if (rec.amountNote) h += banner(esc(rec.amountNote), 'warn', '💲');
  if (rec.categoryNote) h += banner(esc(rec.categoryNote + (rec.alternativeCategoryNote ? ' ' + rec.alternativeCategoryNote : '')), 'info', '❓');
  if (rec.nextBest) {
    const n = rec.nextBest;
    h += `<h3 class="muted">Next best</h3><div class="next">${cardFace(n, true)}<div><div style="font-weight:750;font-size:20px">${esc(n.headlineRate)}</div>
      ${amount != null && n.netValue != null ? `<div class="muted">${C.money(n.netValue)}</div>` : ''}</div></div>`;
  }
  if (ui.selection.type === 'store') {
    h += `<div style="margin-top:16px"><button class="btn plain" data-action="open-confirm">✔︎ How did this show up on your statement?</button></div>`;
  }
  if (amount != null && best.bonusRemaining != null) {
    h += `<div style="margin-top:10px"><button class="btn" data-action="log-purchase">＋ I paid ${C.money(amount)} with ${esc(best.cardName)}</button>
      <p class="hint">Counts this purchase toward the card's bonus limit.</p></div>`;
  }
  h += `<p class="muted small" style="margin-top:16px">Pay by picking this card yourself in Apple Wallet. RightCard can't switch Wallet cards or make payments.</p>`;
  return h;
}

// ----- My Cards
function viewCards() {
  const active = data.cards.filter((c) => !c.archived), archived = data.cards.filter((c) => c.archived);
  const row = (c) => `<button class="item" data-action="edit-card" data-id="${esc(c.id)}" aria-label="Edit ${esc(c.name)}">
      <div style="width:150px">${cardFace(c, true)}</div>
      <div class="spacer"><div style="font-weight:650">${esc(c.availableTo.map(personName).join(' & '))}</div>
        ${c.availableTo.length > 1 ? `<div class="sub">${c.accountMode === 'shared' ? 'One shared account' : 'Separate accounts'}</div>` : ''}
        <div class="sub">${esc(C.rateDescription(c, c.baseRate))} base${c.bonusRules.length ? ` · ${c.bonusRules.length} bonus` : ''}</div></div>
      <span class="chev" aria-hidden="true">›</span></button>`;
  let h = `<div class="row"><h1>My Cards</h1><span class="spacer"></span><button class="btn primary inline" data-action="new-card">＋ Add card</button></div>`;
  if (data.cards.some((c) => c.isDemo)) {
    h += banner('Cards marked <b>DEMO</b> are made up so you can try the app. They are not real cards or real terms. Add your own cards, then remove the demos.', 'warn', '🎭')
      + `<button class="btn danger" data-action="remove-demo">Remove all demo cards</button>`;
  }
  h += `<h2>Cards</h2>` + (active.length ? `<div class="list">${active.map(row).join('')}</div>` : `<p class="muted">No cards yet. Tap “Add card”.</p>`);
  if (archived.length) h += `<h2>Archived</h2><div class="list">${archived.map(row).join('')}</div>`;
  h += `<p class="muted small" style="margin-top:16px">RightCard stores only a nickname and, if you want, the last 4 digits. Never enter a full card number, security code, or bank password.</p>`;
  return h;
}

// ----- Saved Stores
function viewStores() {
  const list = C.searchStores(ui.storeSearch, data.stores);
  let h = `<div class="row"><h1>Saved Stores</h1><span class="spacer"></span><button class="btn primary inline" data-action="new-store">＋ Add store</button></div>
    <input id="stores-search" class="search" type="search" placeholder="Search stores" aria-label="Search stores" value="${esc(ui.storeSearch)}">
    <div id="stores-list" style="margin-top:10px">${storesListHTML(list)}</div>
    ${banner('Store categories are guesses until you confirm them. A store’s name doesn’t prove how the card company will code the purchase.', 'info', '❓')}
    ${banner('Locations are optional and only used by “Find nearby” while the site is open. The website can’t alert you when you arrive.', 'info', '📍')}`;
  return h;
}
function storesListHTML(list) {
  if (!list.length) return `<p class="muted">No stores match.</p>`;
  return `<div class="list">${list.map((s) => {
    const eff = C.effectiveCategory(s);
    const conf = eff.confidence.type === 'confirmed' ? '✔︎ confirmed' : eff.confidence.type === 'mixed' ? 'mixed history' : 'guess, unconfirmed';
    return `<button class="item" data-action="edit-store" data-id="${esc(s.id)}" aria-label="Edit ${esc(s.name)}">
      <span class="ic" aria-hidden="true">${C.catIcon(eff.category)}</span>
      <span class="spacer"><div style="font-weight:650">${esc(s.name)}</div><div class="sub">${esc(C.catName(eff.category))} · ${conf}</div>
      <div class="sub">${s.location ? 'Location saved' : 'No location'}</div></span><span class="chev" aria-hidden="true">›</span></button>`;
  }).join('')}</div>`;
}

// ----- Settings
function viewSettings() {
  const s = data.settings || {};
  return `<h1>Settings</h1>
  <fieldset><legend>People</legend>
    <label class="field"><span>This phone belongs to</span>
      <select data-setting="owner" aria-label="This phone belongs to">
        <option value="">Not set</option>${data.people.map((p) => `<option value="${esc(p.id)}" ${s.deviceOwnerID === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}
      </select></label>
    ${data.people.map((p, i) => `<label class="field"><span>Name ${i + 1}</span><input type="text" data-setting="name" data-id="${esc(p.id)}" value="${esc(p.name)}" aria-label="Name for person ${i + 1}"></label>`).join('')}
    <p class="hint">The phone's owner is picked automatically when the app opens. Switch anytime at the top.</p>
  </fieldset>

  <fieldset><legend>Arrival notifications</legend>
    ${banner('<b>Not available on the website.</b> iPhone web apps can’t watch your location in the background, so RightCard on the web can’t notify you when you arrive at a store. That needs the native iPhone app (built with Xcode on a Mac). Use the store search, the category buttons, or “Find nearby” while the app is open.', 'warn', '🔕')}
  </fieldset>

  <fieldset><legend>Your data</legend>
    ${banner('Everything is saved only in this browser on this phone. It is <b>not synced</b> between your two iPhones, and nothing is sent to a server. To copy your setup to the other phone, use <b>Export</b> here and send the file (AirDrop or Messages), then <b>Import</b> it on the other phone.', 'info', '📱')}
    <button class="btn" data-action="export">⬆︎ Export setup (share file)</button>
    <button class="btn" data-action="import">⬇︎ Import setup from file</button>
    <input type="file" id="import-file" accept=".json,application/json,text/plain" hidden>
    <p class="hint">Importing replaces the cards, stores, and names on this phone. “This phone belongs to” stays as it is. Export a backup now and then. Clearing Safari website data deletes RightCard’s data.</p>
  </fieldset>

  <fieldset><legend>Demo data</legend>
    <button class="btn" data-action="remove-demo" ${data.cards.some((c) => c.isDemo) ? '' : 'disabled'}>Remove demo cards</button>
    <button class="btn plain" data-action="reset-demo">Reset everything to demo data</button>
    <button class="btn danger" data-action="wipe">Delete all cards and stores</button>
  </fieldset>

  <fieldset><legend>About</legend>
    <p class="small">RightCard suggests a card. You pay by choosing that card yourself in Apple Wallet. It can't switch Wallet cards or make payments.</p>
    <p class="small">How a purchase is categorized is decided by the card company and the store's payment setup, not the store's name. Estimates may be wrong.</p>
    <p class="small">Demo cards are fictional. RightCard doesn't include any real card's terms.</p>
  </fieldset>`;
}

// ---------------- Sheets (editors) ----------------
const dlg = () => $('#sheet');
function openSheet(s) {
  sheet = s;
  renderSheet();
  if (!dlg().open) dlg().showModal();
  dlg().scrollTop = 0;
}
function closeSheet() {
  sheet = null;
  if (dlg().open) dlg().close();
  render();
}
function renderSheet() {
  const scroll = dlg().scrollTop;
  const map = { card: sheetCard, store: sheetStore, confirm: sheetConfirm };
  dlg().innerHTML = map[sheet.kind]();
  dlg().scrollTop = scroll;
}
function head(title, saveLabel = 'Save') {
  return `<div class="sheet-head"><button class="link" data-action="sheet-cancel">Cancel</button><h2>${esc(title)}</h2>
    ${saveLabel ? `<button class="link" data-action="sheet-save" style="font-weight:800">${saveLabel}</button>` : '<span style="width:60px"></span>'}</div>`;
}
const field = (label, input, hint = '') => `<label class="field"><span>${label}</span>${input}</label>${hint ? `<p class="hint">${hint}</p>` : ''}`;
const numIn = (path, v, aria, extra = '') => `<input class="num" inputmode="decimal" data-bind="${path}" data-type="number" value="${v ?? ''}" aria-label="${esc(aria)}" ${extra}>`;
const optNumIn = (path, v, aria, ph = 'None') => `<input class="num" inputmode="decimal" data-bind="${path}" data-type="optnumber" value="${v ?? ''}" placeholder="${ph}" aria-label="${esc(aria)}">`;
const chk = (path, v, aria) => `<input type="checkbox" data-bind="${path}" data-type="bool" ${v ? 'checked' : ''} aria-label="${esc(aria)}">`;
const chip = (action, attrs, label, pressed) => `<button type="button" class="chip" data-action="${action}" ${attrs} aria-pressed="${!!pressed}">${label}</button>`;

function sheetCard() {
  const c = sheet.draft;
  const pts = c.unit.type === 'points';
  const unitSuffix = pts ? 'x' : '%';
  const both = c.availableTo.length > 1;
  let h = head(sheet.isNew ? 'Add Card' : 'Edit Card') + `<div class="sheet-body">`;
  if (sheet.error) h += banner(esc(sheet.error), 'warn', '⚠️');
  if (c.isDemo) h += banner('This is a fictional demo card. Rename it (without “Demo”) to make it yours, or delete it.', 'warn', '🎭');
  h += `<fieldset><legend>Card</legend>
    ${field('Nickname', `<input type="text" data-bind="name" data-type="text" value="${esc(c.name)}" placeholder="e.g. Grocery Card" aria-label="Card nickname" autocapitalize="words">`)}
    ${field('Last 4 digits', `<input class="num" inputmode="numeric" maxlength="4" data-bind="last4" data-type="last4" value="${esc(c.last4 || '')}" placeholder="Optional" aria-label="Last 4 digits, optional" autocomplete="off">`)}
    <div class="swatches" role="group" aria-label="Card color">${COLORS.map(([n, hex]) => `<button type="button" class="swatch" style="background:${hex}" data-action="color" data-hex="${hex}" aria-label="${n}" aria-pressed="${c.colorHex === hex}"></button>`).join('')}</div>
    <p class="hint">Only a nickname and optional last 4 digits. Never a full card number or security code.</p></fieldset>`;
  h += `<fieldset><legend>Who uses it</legend>
    <div class="chips">${data.people.map((p) => chip('toggle-person', `data-id="${esc(p.id)}"`, esc(p.name), c.availableTo.includes(p.id))).join('')}</div>
    ${both ? field('Account', `<select data-bind="accountMode" data-type="text" aria-label="Account type"><option value="shared" ${c.accountMode === 'shared' ? 'selected' : ''}>One shared account</option><option value="separate" ${c.accountMode === 'separate' ? 'selected' : ''}>Separate accounts</option></select>`,
      c.accountMode === 'shared' ? 'One shared account: you both use the same account, so bonus limits are shared.' : 'Separate accounts: you each have your own account of this card, so each of you has your own bonus limits.') : ''}
  </fieldset>`;
  h += `<fieldset><legend>Rewards</legend>
    ${field('Earns points or miles', `<input type="checkbox" data-action="toggle-points" ${pts ? 'checked' : ''} aria-label="Earns points or miles">`)}
    ${pts ? field('Points name', `<input type="text" data-bind="unit.name" data-type="text" value="${esc(c.unit.name)}" aria-label="Points name">`) + field('Each point is worth (¢)', numIn('unit.cpp', c.unit.cpp, 'Cents per point'), 'Your own estimate. Change it any time.') : ''}
    ${field(pts ? 'Everywhere else (x)' : 'Cash back everywhere else (%)', numIn('baseRate', c.baseRate, 'Base rate'))}
  </fieldset>`;
  h += `<fieldset><legend>Bonus categories</legend>${c.bonusRules.map((r, i) => ruleHTML(c, r, i, unitSuffix)).join('')}
    <button class="btn plain" data-action="add-rule">＋ Add bonus category</button></fieldset>`;
  h += `<fieldset><legend>Store offers</legend>${c.offers.map((o, i) => offerHTML(c, o, i)).join('')}
    <button class="btn plain" data-action="add-offer">＋ Add store offer</button>
    <p class="hint">Most card offers must be added in the card's app first, and are earned on top of normal rewards.</p></fieldset>`;
  h += `<fieldset><legend>Transaction fees</legend>${c.fees.map((f, i) => feeHTML(f, i)).join('')}
    <button class="btn plain" data-action="add-fee">＋ Add fee</button></fieldset>`;
  h += `<fieldset><legend>Details</legend>
    ${field('Network', `<select data-bind="network" data-type="text" aria-label="Card network">${Object.entries(C.NETWORKS).map(([k, v]) => `<option value="${k}" ${c.network === k ? 'selected' : ''}>${v}</option>`).join('')}</select>`)}
    ${field('Where you got the terms', `<input type="text" data-bind="termsSource" data-type="opttext" value="${esc(c.termsSource || '')}" placeholder="Optional URL" aria-label="Where you got the terms">`)}
    ${field('Terms last checked', `<input type="date" data-bind="termsLastVerified" data-type="date" value="${toInputDate(c.termsLastVerified)}" aria-label="Terms last checked">`)}
  </fieldset>`;
  if (!sheet.isNew) {
    h += `<button class="btn plain" data-action="card-archive">${c.archived ? 'Restore card' : 'Archive card'}</button>
      <button class="btn danger" data-action="card-delete">Delete card</button>`;
  }
  return h + `</div>`;
}
function ruleHTML(c, r, i, unit) {
  const p = `bonusRules.${i}`;
  let h = `<div class="sub-block"><div class="row"><h3 class="spacer">Bonus ${i + 1}</h3><button class="link" data-action="remove-rule" data-i="${i}" aria-label="Remove bonus ${i + 1}">Remove</button></div>
    <div class="chips" role="group" aria-label="Categories for bonus ${i + 1}">${C.CATEGORIES.map((k) => chip('rule-cat', `data-i="${i}" data-cat="${k.id}"`, `${k.icon} ${esc(k.name)}`, r.categories.includes(k.id))).join('')}</div>
    ${field(`Rate (${unit})`, numIn(`${p}.rate`, r.rate, 'Bonus rate'))}
    ${field('Has a spending limit', `<input type="checkbox" data-action="toggle-cap" data-i="${i}" ${r.cap ? 'checked' : ''} aria-label="Has a spending limit">`)}`;
  if (r.cap) {
    h += field('Limit ($)', numIn(`${p}.cap.limit`, r.cap.limit, 'Spending limit in dollars'))
      + field('Resets', `<select data-bind="${p}.cap.reset.type" data-type="text" data-rerender="1" aria-label="Limit resets">${Object.entries(C.RESET_LABELS).map(([k, v]) => `<option value="${k}" ${r.cap.reset.type === k ? 'selected' : ''}>${v}</option>`).join('')}</select>`);
    if (r.cap.reset.type === 'anniversaryYear') {
      h += field('Year starts in', `<select data-bind="${p}.cap.reset.startMonth" data-type="number" aria-label="Year starts in month">${MONTHS.map((m, mi) => `<option value="${mi + 1}" ${(r.cap.reset.startMonth || 1) === mi + 1 ? 'selected' : ''}>${m}</option>`).join('')}</select>`);
    }
    h += field(`Rate after limit (${unit})`, optNumIn(`${p}.rateAfterCap`, r.rateAfterCap, 'Rate after limit', 'Base'));
    const keys = c.accountMode === 'separate' && c.availableTo.length > 1 ? c.availableTo.map((id) => [id, `${personName(id)} spent so far ($)`])
      : [[c.accountMode === 'separate' ? c.availableTo[0] : 'shared', c.availableTo.length > 1 ? 'Spent together so far ($)' : 'Spent so far ($)']];
    for (const [k, label] of keys) {
      const now = new Date();
      h += field(label, `<input class="num" inputmode="decimal" data-spend="${i}" data-key="${esc(k)}" value="${C.spentThisPeriod(r, k, now) || ''}" placeholder="0" aria-label="${esc(label)}">`);
    }
    h += `<p class="hint">Copy this from your card's app. It resets automatically when the period ends.</p>`;
  }
  h += field('Rotating / changes each period', `<input type="checkbox" data-action="toggle-rotating" data-i="${i}" ${r.rotating ? 'checked' : ''} aria-label="Rotating category">`);
  if (r.rotating) {
    h += field('I activated it', chk(`${p}.rotating.activated`, r.rotating.activated, 'I activated it'))
      + field('Starts', `<input type="date" data-bind="${p}.rotating.from" data-type="date" value="${toInputDate(r.rotating.from)}" aria-label="Rotating starts">`)
      + field('Ends', `<input type="date" data-bind="${p}.rotating.until" data-type="enddate" value="${toInputDate(r.rotating.until)}" aria-label="Rotating ends">`)
      + `<p class="hint">If not activated, RightCard uses the card's normal rate.</p>`;
  }
  h += field("Stores that don't count", `<input type="text" data-bind="${p}.excludedMerchants" data-type="list" value="${esc((r.excludedMerchants || []).join(', '))}" placeholder="e.g. Walmart, Target" aria-label="Stores that don't count">`);
  return h + `</div>`;
}
function offerHTML(c, o, i) {
  const p = `offers.${i}`;
  const expired = o.expires && new Date(o.expires) < new Date();
  let h = `<div class="sub-block"><div class="row"><h3 class="spacer">Offer ${i + 1}${expired ? ' <span class="demo">EXPIRED</span>' : ''}</h3><button class="link" data-action="remove-offer" data-i="${i}">Remove</button></div>
    ${field('Store', `<input type="text" data-bind="${p}.merchantName" data-type="text" value="${esc(o.merchantName)}" placeholder="e.g. Target" aria-label="Offer store">`)}
    ${field('Type', `<select data-bind="${p}.kind" data-type="text" aria-label="Offer type"><option value="percent" ${o.kind === 'percent' ? 'selected' : ''}>% back</option><option value="flat" ${o.kind === 'flat' ? 'selected' : ''}>$ back</option></select>`)}
    ${field('Amount (% or $)', numIn(`${p}.value`, o.value, 'Offer amount'))}
    ${field('Minimum spend ($)', numIn(`${p}.minSpend`, o.minSpend, 'Minimum spend'))}
    ${field('Most you can earn ($)', optNumIn(`${p}.maxReward`, o.maxReward, 'Maximum reward', 'No max'))}
    ${field('Starts (optional)', `<input type="date" data-bind="${p}.startDate" data-type="date" value="${toInputDate(o.startDate)}" aria-label="Offer starts">`)}
    ${field('Expires', `<input type="date" data-bind="${p}.expires" data-type="enddate" value="${toInputDate(o.expires)}" aria-label="Offer expires">`)}
    ${field('Added to my card', chk(`${p}.enrolled`, o.enrolled, 'Added to my card'))}
    ${field('Earned on top of normal rewards', chk(`${p}.stacks`, o.stacks, 'Earned on top of normal rewards'))}`;
  if (c.accountMode === 'separate' && c.availableTo.length > 1) {
    h += `<p class="hint">Added on whose card:</p><div class="chips">${c.availableTo.map((id) => chip('offer-person', `data-i="${i}" data-id="${esc(id)}"`, esc(personName(id)), !o.enrolledPeople.length || o.enrolledPeople.includes(id))).join('')}</div>`;
  }
  return h + `</div>`;
}
function feeHTML(f, i) {
  const p = `fees.${i}`;
  return `<div class="sub-block"><div class="row"><h3 class="spacer">Fee ${i + 1}</h3><button class="link" data-action="remove-fee" data-i="${i}">Remove</button></div>
    ${field('Name', `<input type="text" data-bind="${p}.label" data-type="text" value="${esc(f.label)}" placeholder="e.g. Foreign transaction fee" aria-label="Fee name">`)}
    ${field('Percent (%)', numIn(`${p}.percent`, f.percent, 'Fee percent'))}
    ${field('Flat ($)', numIn(`${p}.flat`, f.flat, 'Flat fee'))}
    <p class="hint">Applies to (leave all off for every purchase):</p>
    <div class="chips">${C.CATEGORIES.map((k) => chip('fee-cat', `data-i="${i}" data-cat="${k.id}"`, esc(k.name), (f.categories || []).includes(k.id))).join('')}</div></div>`;
}

function sheetStore() {
  const s = sheet.draft;
  let h = head(sheet.isNew ? 'Add Store' : 'Edit Store') + `<div class="sheet-body">`;
  if (sheet.error) h += banner(esc(sheet.error), 'warn', '⚠️');
  h += `<fieldset><legend>Store</legend>
    ${field('Name', `<input type="text" data-bind="name" data-type="text" value="${esc(s.name)}" aria-label="Store name" autocapitalize="words">`)}
    ${field('Usually counts as', `<select data-bind="suggestedCategory" data-type="text" aria-label="Usually counts as">${C.CATEGORIES.map((k) => `<option value="${k.id}" ${s.suggestedCategory === k.id ? 'selected' : ''}>${k.icon} ${esc(k.name)}</option>`).join('')}</select>`)}
    ${s.note ? `<p class="hint">${esc(s.note)}</p>` : ''}
    <p class="hint">This is a guess. Card companies decide how a store is coded, so confirm it after you shop.</p></fieldset>`;
  h += `<fieldset><legend>Location (optional, for “Find nearby”)</legend>
    ${s.location ? `<p class="small">Saved: ${s.location.lat.toFixed(5)}, ${s.location.lon.toFixed(5)}</p>` : '<p class="small muted">No location saved.</p>'}
    <button class="btn plain" data-action="store-here">📍 Use my current location (stand in the store)</button>
    ${s.location ? `<button class="link" data-action="store-clear-loc" style="color:var(--danger)">Remove location</button>` : ''}
    ${field('Nearby range (meters)', numIn('radius', s.radius, 'Nearby range in meters'), 'How close you need to be for “Find nearby” to match this store (50–1000 m).')}
  </fieldset>`;
  h += `<fieldset><legend>How it's been counted</legend>
    ${(s.confirmations || []).length ? (s.confirmations.slice().sort((a, b) => new Date(b.date) - new Date(a.date)).map((c) =>
      `<div class="field"><span>${esc(C.catName(c.category))} <span class="muted small">${new Date(c.date).toLocaleDateString()}</span></span><button class="link" data-action="remove-conf" data-id="${esc(c.id)}" aria-label="Remove this record">Remove</button></div>`).join('')) : '<p class="small muted">Nothing confirmed yet.</p>'}
    <div class="field"><span>Add</span><select id="conf-cat" aria-label="Category to record">${C.CATEGORIES.map((k) => `<option value="${k.id}">${esc(k.name)}</option>`).join('')}</select><button class="link" data-action="add-conf">Add</button></div>
  </fieldset>`;
  h += `<fieldset><legend>More</legend>
    <p class="hint">Cards this store accepts (leave all off if you're not sure):</p>
    <div class="chips">${Object.entries(C.NETWORKS).filter(([k]) => k !== 'other').map(([k, v]) => chip('store-net', `data-net="${k}"`, v, (s.acceptedNetworks || []).includes(k))).join('')}</div>
    ${field('Credit card surcharge (%)', numIn('surchargePercent', s.surchargePercent, 'Credit card surcharge percent'))}
  </fieldset>`;
  if (!sheet.isNew) h += `<button class="btn danger" data-action="store-delete">Delete store</button>`;
  return h + `</div>`;
}
function sheetConfirm() {
  return head('Confirm category', null) + `<div class="sheet-body">
    <p class="muted">Check your card's app or statement. What category did this purchase get? We'll remember it for next time.</p>
    ${catGrid('confirm-cat')}</div>`;
}

// ---------------- Draft binding ----------------
function setPath(obj, path, value) {
  const parts = path.split('.');
  let o = obj;
  for (let i = 0; i < parts.length - 1; i++) o = o[parts[i]];
  o[parts.at(-1)] = value;
}
function coerce(type, el) {
  const v = el.type === 'checkbox' ? el.checked : el.value;
  switch (type) {
    case 'number': { const n = parseFloat(String(v).replace(/[$,%\s]/g, '')); return Number.isFinite(n) ? n : 0; }
    case 'optnumber': { const n = parseFloat(String(v).replace(/[$,%\s]/g, '')); return Number.isFinite(n) ? n : null; }
    case 'bool': return !!v;
    case 'date': return fromInputDate(v);
    case 'enddate': return fromInputDate(v, true);
    case 'list': return String(v).split(',').map((x) => x.trim()).filter(Boolean);
    case 'opttext': return String(v).trim() || null;
    case 'last4': {
      const digits = String(v).replace(/[^0-9]/g, '').slice(0, 4);
      if (digits !== v) el.value = digits;
      return digits || null;
    }
    default: return v;
  }
}
function onSheetInput(e) {
  if (!sheet) return;
  const el = e.target;
  if (el.dataset.bind) {
    setPath(sheet.draft, el.dataset.bind, coerce(el.dataset.type, el));
    if (el.dataset.rerender || el.tagName === 'SELECT' && e.type === 'change') {
      if (el.dataset.bind.endsWith('cap.reset.type') && sheet.draft) {
        const i = +el.dataset.bind.split('.')[1];
        const r = sheet.draft.bonusRules[i];
        if (r.cap.reset.type === 'anniversaryYear' && !r.cap.reset.startMonth) r.cap.reset.startMonth = 1;
      }
      renderSheet();
    }
  } else if (el.dataset.spend != null) {
    const r = sheet.draft.bonusRules[+el.dataset.spend];
    const n = parseFloat(String(el.value).replace(/[$,\s]/g, ''));
    r.trackedSpend = r.trackedSpend || {};
    r.trackedSpend[el.dataset.key] = { amount: Number.isFinite(n) ? Math.max(0, n) : 0, periodID: C.periodID(r.cap.reset, new Date()) };
  }
}

const newRule = () => ({ id: C.uid(), categories: ['groceries'], rate: 3, cap: null, rateAfterCap: null, rotating: null, excludedMerchants: [], trackedSpend: {} });
const toggleIn = (arr, v) => (arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);

// ---------------- Actions ----------------
const actions = {
  person: (el) => { ui.personID = el.dataset.id; localStorage.setItem(PKEY, ui.personID); render(); },
  tab: (el) => { ui.tab = el.dataset.tab; render(); $('#main').focus(); window.scrollTo(0, 0); },
  'pick-store': (el) => {
    ui.selection = { type: 'store', storeID: el.dataset.id };
    data.stores.find((s) => s.id === el.dataset.id).lastVisited = new Date().toISOString();
    save(); render(); window.scrollTo(0, 0);
  },
  'pick-category': (el) => { ui.selection = { type: 'category', category: el.dataset.cat }; render(); window.scrollTo(0, 0); },
  'clear-selection': () => { ui.selection = { type: 'none' }; ui.amountText = ''; render(); },
  'find-nearby': findNearby,
  'open-confirm': () => openSheet({ kind: 'confirm' }),
  'confirm-cat': (el) => {
    const rec = C.recommendForStore(data, ui.personID, data.stores.find((s) => s.id === ui.selection.storeID), null);
    data = C.confirmCategory(data, ui.selection.storeID, el.dataset.cat, rec.best && rec.best.cardID, new Date());
    save(); closeSheet(); toast(`Saved: counted as ${C.catName(el.dataset.cat)}.`);
  },
  'log-purchase': () => {
    const amount = parseAmount(ui.amountText);
    const scr = C.bestCardScreen(data, ui.personID, ui.selection, amount, ui.geo);
    const best = scr.recommendation && scr.recommendation.best;
    if (!best || amount == null) return;
    data = C.logPurchase(data, best.cardID, ui.personID, scr.recommendation.category, amount, new Date());
    save(); ui.amountText = ''; render(); toast(`Added ${C.money(amount)} to ${best.cardName}'s bonus limit.`);
  },
  // cards
  'new-card': () => openSheet({ kind: 'card', isNew: true, draft: { id: C.uid(), name: '', last4: null, colorHex: '#2E6BE6', network: 'other', unit: { type: 'cash' }, baseRate: 1, bonusRules: [], fees: [], offers: [], availableTo: [ui.personID], accountMode: 'shared', archived: false, isDemo: false, termsSource: null, termsLastVerified: null } }),
  'edit-card': (el) => openSheet({ kind: 'card', isNew: false, draft: structuredClone(data.cards.find((c) => c.id === el.dataset.id)) }),
  color: (el) => { sheet.draft.colorHex = el.dataset.hex; renderSheet(); },
  'toggle-person': (el) => { sheet.draft.availableTo = toggleIn(sheet.draft.availableTo, el.dataset.id); renderSheet(); },
  'toggle-points': () => { const d = sheet.draft; d.unit = d.unit.type === 'points' ? { type: 'cash' } : { type: 'points', name: 'points', cpp: 1 }; renderSheet(); },
  'add-rule': () => { sheet.draft.bonusRules.push(newRule()); renderSheet(); },
  'remove-rule': (el) => { sheet.draft.bonusRules.splice(+el.dataset.i, 1); renderSheet(); },
  'rule-cat': (el) => { const r = sheet.draft.bonusRules[+el.dataset.i]; r.categories = toggleIn(r.categories, el.dataset.cat); renderSheet(); },
  'toggle-cap': (el) => { const r = sheet.draft.bonusRules[+el.dataset.i]; r.cap = r.cap ? null : { limit: 1500, reset: { type: 'quarterly' } }; renderSheet(); },
  'toggle-rotating': (el) => {
    const r = sheet.draft.bonusRules[+el.dataset.i];
    const now = new Date();
    r.rotating = r.rotating ? null : { activated: false, from: new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString(), until: new Date(now.getFullYear(), now.getMonth() + 3, now.getDate(), 23, 59, 59).toISOString() };
    renderSheet();
  },
  'add-offer': () => { sheet.draft.offers.push({ id: C.uid(), merchantName: '', kind: 'percent', value: 5, minSpend: 0, maxReward: null, startDate: null, expires: new Date(Date.now() + 30 * 86400000).toISOString(), stacks: true, enrolled: true, enrolledPeople: [] }); renderSheet(); },
  'remove-offer': (el) => { sheet.draft.offers.splice(+el.dataset.i, 1); renderSheet(); },
  'offer-person': (el) => {
    const d = sheet.draft, o = d.offers[+el.dataset.i];
    let set = o.enrolledPeople.length ? o.enrolledPeople : [...d.availableTo];
    set = toggleIn(set, el.dataset.id);
    o.enrolledPeople = set.length === d.availableTo.length && d.availableTo.every((x) => set.includes(x)) ? [] : set;
    renderSheet();
  },
  'add-fee': () => { sheet.draft.fees.push({ id: C.uid(), label: '', percent: 3, flat: 0, categories: [] }); renderSheet(); },
  'remove-fee': (el) => { sheet.draft.fees.splice(+el.dataset.i, 1); renderSheet(); },
  'fee-cat': (el) => { const f = sheet.draft.fees[+el.dataset.i]; f.categories = toggleIn(f.categories || [], el.dataset.cat); renderSheet(); },
  'card-archive': () => { data = C.setArchived(data, sheet.draft.id, !sheet.draft.archived); save(); closeSheet(); },
  'card-delete': () => {
    if (!confirm(`Delete “${sheet.draft.name}”? This removes the card and its tracked spending. (Archive keeps it hidden instead.)`)) return;
    data = C.deleteCard(data, sheet.draft.id); save(); closeSheet();
  },
  'remove-demo': () => {
    if (!confirm('Remove all DEMO cards?')) return;
    data = C.removeDemoCards(data); save(); render(); toast('Demo cards removed.');
  },
  // stores
  'new-store': () => openSheet({ kind: 'store', isNew: true, draft: { id: C.uid(), name: '', suggestedCategory: 'groceries', location: null, radius: 150, acceptedNetworks: [], surchargePercent: 0, confirmations: [], isStarter: false, note: null } }),
  'edit-store': (el) => openSheet({ kind: 'store', isNew: false, draft: structuredClone(data.stores.find((s) => s.id === el.dataset.id)) }),
  'store-here': () => {
    getPosition().then((pos) => {
      if (!pos || !sheet) return;
      sheet.draft.location = { lat: pos.coords.latitude, lon: pos.coords.longitude };
      renderSheet(); toast(`Location saved (±${Math.round(pos.coords.accuracy)} m).`);
    });
  },
  'store-clear-loc': () => { sheet.draft.location = null; renderSheet(); },
  'store-net': (el) => { sheet.draft.acceptedNetworks = toggleIn(sheet.draft.acceptedNetworks || [], el.dataset.net); renderSheet(); },
  'add-conf': () => { sheet.draft.confirmations = [...(sheet.draft.confirmations || []), { id: C.uid(), date: new Date().toISOString(), category: $('#conf-cat').value, cardID: null }]; renderSheet(); },
  'remove-conf': (el) => { sheet.draft.confirmations = sheet.draft.confirmations.filter((c) => c.id !== el.dataset.id); renderSheet(); },
  'store-delete': () => {
    if (!confirm(`Delete “${sheet.draft.name}”?`)) return;
    data = C.deleteStore(data, sheet.draft.id);
    if (ui.selection.storeID === sheet.draft.id) ui.selection = { type: 'none' };
    save(); closeSheet();
  },
  // sheet buttons
  'sheet-cancel': () => closeSheet(),
  'sheet-save': () => {
    try {
      if (sheet.kind === 'card') {
        const d = structuredClone(sheet.draft);
        d.offers = d.offers.filter((o) => o.merchantName.trim());
        d.bonusRules = d.bonusRules.filter((r) => r.categories.length);
        if (d.isDemo && !sheet.isNew) d.isDemo = d.name.trim().startsWith('Demo');
        data = C.upsertCard(data, d);
      } else if (sheet.kind === 'store') {
        data = C.upsertStore(data, sheet.draft);
      }
      save(); closeSheet(); toast('Saved.');
    } catch (e) {
      sheet.error = e.message; renderSheet(); dlg().scrollTop = 0;
    }
  },
  // settings
  export: exportData,
  import: () => $('#import-file').click(),
  'reset-demo': () => {
    if (!confirm('Replace everything on this phone with demo data?')) return;
    const owner = data.settings.deviceOwnerID;
    data = C.demoHousehold(); data.settings.deviceOwnerID = owner;
    ui.selection = { type: 'none' }; save(); render(); toast('Reset to demo data.');
  },
  wipe: () => {
    if (!confirm('Delete all cards and stores on this phone? Export first if you want a backup.')) return;
    data = { ...data, cards: [], stores: [] }; ui.selection = { type: 'none' }; save(); render();
  },
};

// ---------------- Geolocation (foreground, on tap only) ----------------
function getPosition() {
  if (!('geolocation' in navigator)) { toast("This browser can't share location."); return Promise.resolve(null); }
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (pos) => { ui.geo.permission = 'granted'; resolve(pos); },
      (err) => {
        if (err.code === 1) { ui.geo.permission = 'denied'; toast('Location is blocked for this site. Turn it on in iPhone Settings → Privacy & Security → Location Services → Safari Websites, or pick a store below.'); }
        else toast("Couldn't get your location. Pick a store or category instead.");
        resolve(null);
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 });
  });
}
async function findNearby() {
  if (!data.stores.some((s) => s.location)) {
    toast('None of your saved stores has a location yet. Add one in Saved Stores.');
    return;
  }
  ui.locating = true; render();
  const pos = await getPosition();
  ui.locating = false;
  if (!pos) { render(); return; }
  const d = C.nearbyDecision({ lat: pos.coords.latitude, lon: pos.coords.longitude }, pos.coords.accuracy, data.stores);
  if (d.type === 'none') toast('No saved store nearby. Search below or tap a category.');
  else if (d.type === 'one') ui.selection = { type: 'store', storeID: d.storeID };
  else ui.selection = { type: 'choose', storeIDs: d.storeIDs };
  render();
}

// ---------------- Export / import ----------------
async function exportData() {
  const text = C.exportJSON(data);
  const d = new Date();
  const name = `RightCard-setup-${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}.json`;
  const file = new File([text], name, { type: 'application/json' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: 'RightCard setup' }); return; }
    catch (e) { if (e.name === 'AbortError') return; }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(file); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  toast('Setup file downloaded.');
}
async function importFile(file) {
  try {
    const imported = C.importJSON(await file.text());
    if (!confirm(`Replace this phone's RightCard setup with ${imported.cards.length} cards and ${imported.stores.length} stores from the file?`)) return;
    imported.settings = { ...imported.settings, deviceOwnerID: data.settings.deviceOwnerID ?? null };
    data = imported; ui.selection = { type: 'none' }; save(); render(); toast('Setup imported.');
  } catch (e) { toast(e.message); }
}

// ---------------- Wiring ----------------
document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action], [data-tab]');
  if (!el) return;
  if (el.dataset.tab && !el.dataset.action) return actions.tab(el);
  const fn = actions[el.dataset.action];
  if (fn) { if (el.tagName !== 'INPUT') e.preventDefault(); fn(el); }
});
document.addEventListener('input', (e) => {
  const el = e.target;
  if (el.id === 'amount') { ui.amountText = el.value; const scr = C.bestCardScreen(data, ui.personID, ui.selection, parseAmount(el.value), ui.geo); if (scr.recommendation) $('#result').innerHTML = resultHTML(scr.recommendation, parseAmount(el.value)); return; }
  if (el.id === 'store-search') { ui.search = el.value; $('#store-results').innerHTML = storeResultsHTML(); return; }
  if (el.id === 'stores-search') { ui.storeSearch = el.value; $('#stores-list').innerHTML = storesListHTML(C.searchStores(ui.storeSearch, data.stores)); return; }
  if (dlg().contains(el)) onSheetInput(e);
});
document.addEventListener('change', (e) => {
  const el = e.target;
  if (el.id === 'import-file' && el.files[0]) { importFile(el.files[0]); el.value = ''; return; }
  if (el.dataset.setting === 'owner') { data.settings.deviceOwnerID = el.value || null; save(); return; }
  if (el.dataset.setting === 'name') {
    const p = data.people.find((x) => x.id === el.dataset.id);
    if (p && el.value.trim()) { p.name = el.value.trim(); save(); render(); }
    return;
  }
  if (dlg().contains(el) && (el.tagName === 'SELECT' || el.type === 'checkbox')) onSheetInput(e);
});
dlg().addEventListener('close', () => { if (sheet) { sheet = null; render(); } });

if (navigator.permissions && navigator.permissions.query) {
  navigator.permissions.query({ name: 'geolocation' }).then((st) => {
    ui.geo.permission = st.state; if (ui.tab === 'best') render();
    st.onchange = () => { ui.geo.permission = st.state; if (ui.tab === 'best' && !sheet) render(); };
  }).catch(() => {});
}
if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch((e) => console.warn('SW registration failed', e)));
}
if (!localStorage.getItem(PKEY) && data.settings.deviceOwnerID) ui.personID = data.settings.deviceOwnerID;
save();
render();
