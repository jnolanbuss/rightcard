import { chromium } from 'playwright-core';
const URL = process.argv[2] || 'http://127.0.0.1:8788/rightcard/';
const SHOTS = process.env.SHOTS || '/tmp/shots';
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
  geolocation: { latitude: 27.47, longitude: -82.56, accuracy: 20 }, permissions: ['geolocation', 'clipboard-read', 'clipboard-write'], acceptDownloads: true });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('dialog', (d) => d.accept());
const results = [];
const check = (name, ok, extra = '') => { results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`); };
const text = async () => page.locator('main').innerText();

await page.goto(URL);
await page.waitForSelector('main h1');
check('loads, 4 tabs', (await page.locator('.tabs button').count()) === 4);
check('profile switch shows Nolan & Brittany', (await page.locator('#profile').innerText()).includes('Nolan') && (await page.locator('#profile').innerText()).includes('Brittany'));
check('web says no background notifications on its own', (await text()).includes('not available on the website'));
check('Find where I am button', (await text()).includes('Find where I am'));
await page.screenshot({ path: SHOTS + '/1-home.png', fullPage: true });

// Publix flow
await page.locator('#store-results [data-action=pick-store]:has-text("Publix")').click();
let t = await text();
check('Publix → Demo Grocery Card 6%', t.toLowerCase().includes('use this card') && t.includes('Demo Grocery Card') && t.includes('6%'));
check('unconfirmed note shown', t.includes("We're guessing Publix"));
await page.fill('#amount', '100');
t = await text();
check('amount → estimate $6.00', t.includes('Estimated rewards on $100: $6.00'), t.match(/Estimated[^\n]*/)?.[0]);
await page.screenshot({ path: SHOTS + '/2-publix.png', fullPage: true });
// log purchase
await page.locator('[data-action=log-purchase]').click();
await page.locator('[data-action=clear-selection]').click();

// Category flow per person
await page.locator('#profile >> text=Nolan').click();
await page.locator('[data-action=pick-category][data-cat=restaurants]').click();
check('Nolan restaurants → Dining Points', (await text()).includes('Demo Dining Points Card'));
await page.locator('#profile >> text=Brittany').click();
check('Brittany restaurants → not Dining Points', !(await page.locator('#result .use + .cardface').innerText()).includes('Dining'));
await page.locator('[data-action=clear-selection]').click();

// Target offer, size dependence
await page.locator('#store-search').fill('targ');
await page.locator('#store-results [data-action=pick-store]:has-text("Target")').click();
t = await text();
check('Target shows amount-dependence / offer note', t.includes('depends on how much you spend') || t.includes('Depends on amount'), '');
await page.locator('[data-action=clear-selection]').click();

// My Cards: validation
await page.locator('.tabs [data-tab=cards]').click();
check('demo banner visible', (await text()).includes('are made up'));
await page.locator('[data-action=new-card]').click();
await page.locator('#sheet [data-bind=name]').fill('4111 1111 1111 1111');
await page.locator('#sheet [data-action=sheet-save]').click();
check('rejects card number as name', (await page.locator('#sheet').innerText()).includes('looks like a card number'));
await page.locator('#sheet [data-bind=name]').fill('Our Costco Card');
await page.locator('#sheet [data-bind=last4]').fill('12a4');
const l4 = await page.locator('#sheet [data-bind=last4]').inputValue();
check('last4 strips non-digits', l4 === '124', l4);
await page.locator('#sheet [data-action=sheet-save]').click();
check('rejects 3-digit last4', (await page.locator('#sheet').innerText()).includes('exactly 4 numbers'));
await page.locator('#sheet [data-bind=last4]').fill('4242');
await page.locator('#sheet [data-action=add-rule]').click();
await page.locator('#sheet [data-action=toggle-cap]').click();
await page.screenshot({ path: SHOTS + '/3-editor.png', fullPage: false });
await page.locator('#sheet [data-action=sheet-save]').click();
t = await text();
check('card saved with last4', t.includes('Our Costco Card') && t.includes('4242'));
await page.locator('[data-action=remove-demo]').first().click();
t = await text();
check('remove demo cards', !t.includes('Demo Grocery') && t.includes('Our Costco Card'));

// Stores: set locations, find nearby → ask
await page.locator('.tabs [data-tab=stores]').click();
for (const name of ['Publix', 'Target']) {
  await page.locator(`#stores-list >> text=${name}`).first().click();
  await page.locator('#sheet [data-action=store-here]').click();
  await page.waitForFunction(() => document.querySelector('#sheet').innerText.includes('Saved: 27.47'));
  await page.locator('#sheet [data-action=sheet-save]').click();
}
await page.locator('.tabs [data-tab=best]').click();
await page.locator('[data-action=find-nearby]').click();
await page.waitForFunction(() => document.querySelector('main h1').innerText.includes('Which store'));
t = await text();
check('find nearby with 2 close stores → asks which', t.includes('Which store are you at?') && t.includes('Publix') && t.includes('Target'));
await page.screenshot({ path: SHOTS + '/4-which.png', fullPage: true });
await page.locator('main [data-action=pick-store] >> text=Publix').click();
// confirm category
await page.locator('[data-action=open-confirm]').click();
await page.locator('#sheet [data-action=confirm-cat][data-cat=groceries]').click();
check('confirmed category note', (await text()).includes('Past purchases at Publix counted as Groceries (1 time)'));

// Settings: export/import
await page.locator('.tabs [data-tab=settings]').click();
check('settings says not synced', (await text()).includes('not synced'));
check('settings explains Shortcuts + Safari', (await text()).includes('Run Immediately') && (await text()).includes('Links open in Safari'));
check('settings privacy note: location stays on phone', (await text()).includes('never sent or saved anywhere'));
const [dl] = await Promise.all([page.waitForEvent('download'), page.locator('[data-action=export]').click()]);
const path = await dl.path();
const fs = await import('node:fs');
const exported = JSON.parse(fs.readFileSync(path, 'utf8'));
check('export file valid', exported.app === 'RightCard' && exported.data.cards.some((c) => c.name === 'Our Costco Card'), dl.suggestedFilename());
await page.locator('[data-action=reset-demo]').click();
await page.setInputFiles('#import-file', path);
await page.waitForTimeout(300);
await page.locator('.tabs [data-tab=cards]').click();
check('import restores setup', (await text()).includes('Our Costco Card'));

// persistence across reload
await page.reload(); await page.waitForSelector('main h1');
await page.locator('.tabs [data-tab=cards]').click();
check('persists across reload (localStorage)', (await text()).includes('Our Costco Card'));

// PWA bits
const sw = await page.evaluate(async () => { const r = await navigator.serviceWorker.getRegistration(); return !!(r && (r.active || r.installing || r.waiting)); });
check('service worker registered', sw);
const man = await page.evaluate(async () => (await fetch('manifest.json')).json());
check('manifest ok', man.display === 'standalone' && man.icons.length >= 3);
// offline
await ctx.setOffline(true);
await page.reload(); await page.waitForSelector('main h1');
check('loads offline from cache', (await page.locator('.brand').innerText()) === 'RightCard');
await ctx.setOffline(false);

// dark mode screenshot
await page.emulateMedia({ colorScheme: 'dark' });
await page.locator('.tabs [data-tab=best]').click();
await page.waitForTimeout(500);
check('on open: saved stores here → asks which (auto "Find where I am")', (await text()).includes('Which store are you at?'));
await page.locator('main [data-action=clear-selection]').first().click();
await page.locator('[data-action=pick-category][data-cat=groceries]').click();
await page.screenshot({ path: SHOTS + '/5-dark.png', fullPage: true });


// ================= Store links (?store=) =================
const fresh = async (opts = {}) => {
  const c = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
    geolocation: { latitude: 27.47, longitude: -82.56, accuracy: 20 }, permissions: ['geolocation', 'clipboard-read', 'clipboard-write'], ...opts });
  const p = await c.newPage();
  p.on('pageerror', (e) => errors.push(e.message));
  p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  return { c, p, txt: () => p.locator('main').innerText() };
};
const base = new globalThis.URL(URL);
const pageURL = base.origin + base.pathname;
{
  const { c, p, txt } = await fresh();
  await p.goto(pageURL + '?store=Publix'); await p.waitForSelector('main h1');
  let t = await txt();
  check('?store=Publix → Best Card for Publix', t.startsWith('Publix') && t.toLowerCase().includes('use this card') && t.includes('Demo Grocery Card'), t.slice(0, 60));
  check('store link cleaned from address bar', !p.url().includes('store='), p.url());
  await p.screenshot({ path: SHOTS + '/6-link-publix.png', fullPage: true });
  await p.goto(pageURL + '?store=tesla%20SUPERCHARGER'); await p.waitForSelector('main h1');
  t = await txt();
  check('?store= case-insensitive name', t.startsWith('Tesla Supercharger') && t.toLowerCase().includes('use this card'));
  await p.goto(pageURL + '?store=store-target'); await p.waitForSelector('main h1');
  check('?store=<id> works', (await txt()).startsWith('Target'));
  await p.goto(pageURL + "?store=Detwiler's%20Farm%20Market"); await p.waitForSelector('main h1');
  check('?store= encoded name with apostrophe + spaces', (await txt()).startsWith("Detwiler's Farm Market"));
  await p.goto(pageURL + '?store=Nowhere%20%26%20Co'); await p.waitForSelector('main h1');
  t = await txt();
  check('unknown store → friendly message + picker, no answer', t.includes('We couldn’t find a saved store called “Nowhere & Co”') && t.includes('Where are you shopping?') && !t.toLowerCase().includes('use this card'), t.slice(0, 160));
  await p.screenshot({ path: SHOTS + '/7-link-nomatch.png', fullPage: true });
  // duplicate names → existing "which one" prompt
  await p.evaluate(() => { const d = JSON.parse(localStorage.getItem('rightcard.data.v1')); d.data.stores.push({ ...d.data.stores.find((s) => s.name === 'Costco'), id: 'store-costco-2', name: 'COSTCO' }); localStorage.setItem('rightcard.data.v1', JSON.stringify(d)); });
  await p.goto(pageURL + '?store=costco'); await p.waitForSelector('main h1');
  t = await txt();
  check('duplicate store names → asks which one', t.includes('Which store are you at?') && t.includes('More than one saved store has that name'), t.slice(0, 120));
  // Copy Shortcut link
  await p.goto(pageURL); await p.waitForSelector('main h1');
  await p.locator('.tabs [data-tab=stores]').click();
  const n = await p.locator('[data-action=copy-link]').count();
  const rows = await p.locator('.store-row').count();
  check('Copy Shortcut link on every saved store', n > 0 && n === rows, `${n}/${rows}`);
  check('copy button has accessible label', (await p.locator('[data-action=copy-link]').first().getAttribute('aria-label')).startsWith('Copy Shortcut link for '));
  await p.locator('.store-row:has-text("Detwiler") [data-action=copy-link]').click();
  const clip = await p.evaluate(() => navigator.clipboard.readText());
  check('copied link = page origin + path + ?store=name', clip === pageURL + "?store=Detwiler's%20Farm%20Market", clip);
  await p.goto(clip); await p.waitForSelector('main h1');
  check('copied link opens that store', (await txt()).startsWith("Detwiler's Farm Market"));
  await p.locator('.tabs [data-tab=stores]').click();
  await p.locator('[data-action=copy-link][data-id=store-costco-2]').click();
  const clip2 = await p.evaluate(() => navigator.clipboard.readText());
  check('duplicate-name store link uses its id', clip2 === pageURL + '?store=store-costco-2', clip2);
  await p.screenshot({ path: SHOTS + '/8-stores-light.png', fullPage: true });
  await p.emulateMedia({ colorScheme: 'dark' });
  await p.screenshot({ path: SHOTS + '/9-stores-dark.png', fullPage: true });
  const contrast = await p.evaluate(() => { const b = document.querySelector('.copy-link'); const cs = getComputedStyle(b); return [cs.color, cs.backgroundColor]; });
  check('copy button themed in dark mode', contrast[0] !== contrast[1] && contrast[0].includes('238'), contrast.join(' on '));
  // offline + query string served from the cached app shell
  await p.goto(pageURL); await p.waitForSelector('main h1');
  await p.evaluate(async () => { await navigator.serviceWorker.ready; });
  await p.reload(); await p.waitForSelector('main h1');
  await c.setOffline(true);
  await p.goto(pageURL + '?store=Publix'); await p.waitForSelector('main h1');
  check('offline: ?store= link still opens (SW ignores query)', (await txt()).startsWith('Publix'));
  const placesOffline = await p.evaluate(async () => (await (await fetch('places-bradenton.json')).json()).places.length);
  check('offline: places directory precached', placesOffline > 100, String(placesOffline));
  await c.setOffline(false);
  await c.close();
}

// ================= Nearby places directory =================
{
  // The Sandbar: several places within ~150 m → pick list
  const { c, p, txt } = await fresh({ geolocation: { latitude: 27.525765, longitude: -82.736977, accuracy: 15 } });
  await p.goto(pageURL); await p.waitForSelector('main h1');
  await p.waitForFunction(() => document.querySelector('main h1').innerText.includes('Which store'), null, { timeout: 15000 }).catch(() => {});
  let t = await txt();
  check('on open: several places in range → asks which', t.includes('Which store are you at?') && t.includes('The Sandbar Restaurant') && t.includes('Looks like a restaurant'), t.slice(0, 200));
  await p.screenshot({ path: SHOTS + '/10-which-place.png', fullPage: true });
  await p.locator('main [data-action=pick-store]:has-text("The Sandbar Restaurant")').click();
  t = await txt();
  check('pick place → Best Card with likely-category note', t.startsWith('The Sandbar Restaurant') && t.toLowerCase().includes('use this card') && t.includes("Looks like a restaurant, so we're using Restaurants") && t.includes('Card companies decide how a store is classified'), t.slice(0, 80));
  await p.locator('[data-action=save-place]').click();
  await p.locator('.tabs [data-tab=stores]').click();
  check('save place → appears in Saved Stores with link button', (await p.locator('.store-row:has-text("The Sandbar Restaurant") [data-action=copy-link]').count()) === 1);
  await c.close();
}
{
  // Lone gas station → opens directly
  const { c, p, txt } = await fresh({ geolocation: { latitude: 27.265263, longitude: -82.527393, accuracy: 10 } });
  await p.goto(pageURL); await p.waitForSelector('main h1');
  await p.waitForFunction(() => document.querySelector('main h1').innerText.includes('7-Eleven'), null, { timeout: 15000 }).catch(() => {});
  const t = await txt();
  check('on open: one place in range → opens its Best Card', t.startsWith('7-Eleven') && t.includes('Looks like a gas station') && t.toLowerCase().includes('use this card'), t.slice(0, 120));
  await p.screenshot({ path: SHOTS + '/11-gas.png', fullPage: true });
  await c.close();
}
{
  // A Publix from the map → the saved starter "Publix" (so confirmed categories win)
  const { c, p, txt } = await fresh({ geolocation: { latitude: 27.297109, longitude: -82.40138, accuracy: 10 } });
  await p.goto(pageURL); await p.waitForSelector('main h1');
  await p.waitForFunction(() => document.querySelector('main h1').innerText.startsWith('Publix'), null, { timeout: 15000 }).catch(() => {});
  const t = await txt();
  check('map Publix → uses saved Publix store (confirm button present)', t.startsWith('Publix') && (await p.locator('[data-action=open-confirm]').count()) === 1, t.slice(0, 80));
  await c.close();
}
{
  // Nothing nearby + search the directory
  const { c, p, txt } = await fresh();
  await p.goto(pageURL); await p.waitForSelector('main h1');
  await p.waitForTimeout(800);
  check('on open: nothing in range → normal picker', (await txt()).includes('Where are you shopping?'));
  await p.locator('#store-search').fill('wawa');
  await p.waitForSelector('[data-action=pick-place]', { timeout: 10000 }).catch(() => {});
  const t = await p.locator('#store-results').innerText();
  check('search finds directory places, nearest first with distance', t.includes('Wawa') && /m away|mi away/.test(t), t.slice(0, 160));
  await p.locator('[data-action=pick-place]').first().click();
  check('pick searched place → Best Card', (await txt()).startsWith('Wawa') && (await txt()).toLowerCase().includes('use this card'));
  await c.close();
}
{
  // Location denied → manual fallback, no errors
  const { c, p, txt } = await fresh({ permissions: [] });
  await p.goto(pageURL); await p.waitForSelector('main h1');
  await p.waitForTimeout(800);
  const t = await txt();
  check('location denied/not granted → manual picker still works', t.includes('Where are you shopping?') && t.includes('Or pick what you\'re buying'));
  await p.locator('#store-results [data-action=pick-store]:has-text("Publix")').click();
  check('manual pick works without location', (await txt()).startsWith('Publix'));
  await c.close();
}
check('no JS errors', errors.length === 0, errors.join(' | '));
console.log(results.join('\n'));
console.log(`\n${results.filter((r) => r.startsWith('PASS')).length}/${results.length} passed`);
await browser.close();
