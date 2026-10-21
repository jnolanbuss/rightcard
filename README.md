# RightCard — web companion (installable PWA)

A build-free website (plain HTML, CSS, and JS modules) that you can add to the iPhone Home Screen. The logic in `core.js` is a port of the Swift `RightCardCore` package.

## What works on the web
- Four tabs: **Best Card**, **My Cards**, **Saved Stores**, **Settings**. A Nolan / Brittany switch is always at the top.
- **Manual flow first:** search your saved stores, or tap a category button. You get one large "Use this card" with the card's color, name, and optional last 4 digits. Below it: why it was picked, an estimate if you enter an amount, the next-best card, a note when the best card depends on purchase size, and a note when the store's category isn't confirmed.
- **Card editor:** add, edit, archive, restore, and delete cards. Each card can have:
  - which people can use it, and whether it's one shared account or separate accounts
  - cash back or points (with your own ¢/point value) and a base rate
  - bonus categories with limits, reset periods, spending entered so far, and rate after the limit
  - rotating categories with an "I activated it" switch and dates
  - excluded stores, store offers (expiry, minimum, maximum, stacking, who added it), transaction fees, network, and the source and date you checked the terms
- Only a nickname and the last 4 digits are stored. The last 4 must be exactly 4 digits, and names containing long digit runs (card numbers) are rejected.
- **Store editor:** suggested category (marked as a guess), a history of confirmed categories, optional location, accepted networks, and credit card surcharge.
- **Find where I am**: when the app opens (you can turn that off in Settings) or when you tap the button, it checks your location **once, in the foreground only**. It looks for one of your saved stores, or a place in the built-in **Bradenton-area places list**, within about 150 m (500 ft), and opens that store's best card. If several are close, it asks which one you're at. If location is off or blocked, you pick the store or category yourself, as before. Your location never leaves the phone.
- **Built-in places list** (`places-bradenton.json`): 1,069 named gas stations, grocery stores, warehouse clubs, convenience stores, pharmacies, department and other stores, restaurants, fast food, cafés, and EV chargers within 25 km of the Bradenton area, from OpenStreetMap. Each place gets a *likely* category in plain words ("Looks like a gas station"). That's only a hint: card companies decide how a store is classified. A confirmed category from your past purchases at a saved store always wins. If a place has the same name as one of your saved stores (like "Publix"), RightCard uses your saved store. The store search covers the places list too, nearest first once your location is known. Tap **Save to my stores** to keep a place. The list loads in the background and is cached for offline use.
- **Store links**: `…/rightcard/?store=<store name or id>` opens straight to that store's best card. Each saved store has a **Copy Shortcut link** button.
- **Export / import** a JSON setup file, sent with AirDrop or Messages, to copy everything to the other phone.
- Works **offline** after the first visit (service worker, which also caches the places list and serves `?store=` links from the cached app). Supports light and dark mode, large tap targets, and labels for VoiceOver.

## Arrival notifications via iPhone Shortcuts
The website can't watch your location in the background, so it can't alert you by itself. The free **Shortcuts** app can do it:
1. In RightCard, go to **Saved Stores** and tap **Copy Shortcut link** under the store.
2. Open **Shortcuts** → **Automation** tab → **+** / **New Automation** → **Arrive**.
3. Tap **Choose** next to Location, find the store, and adjust the circle if you want. Pick **Run Immediately** (not "Run After Confirmation"), then tap **Next**.
4. Add **Show Notification** and type something like "At Publix: open RightCard". Then add **Open URLs** and paste the link.
5. Tap **Done**. Repeat for each store you visit often.

How it behaves: when you arrive, iOS runs the automation and opens the link **in Safari** (Open URLs always uses Safari, not the Home Screen app), right to that store's best card. Location-triggered automations can fire a little late or not at all if location access is limited, so this is a convenience, not a guarantee.

Link format: `https://jnolanbuss.github.io/rightcard/?store=Publix`. The store can be its name (any capitalization; spaces as `%20`, `&` as `%26`) or its id. If no saved store has that name, RightCard says so and shows the normal picker. It never guesses. If two saved stores have the same name, it asks which one. The **Copy Shortcut link** button uses the store's name, or its id when two stores share a name. Renaming a store changes its link, so copy it again afterward.

**Important: Safari and the Home Screen app keep separate data.** On iPhone, a Home Screen web app has its own storage, separate from Safari (WebKit design), and links from Shortcuts open in Safari. So set up your cards and stores in Safari too. The easiest way is Settings → Export setup in the Home Screen app, then Import setup in Safari. Starter stores (Publix, Target, Costco…) work in both right away.

## What does NOT work on the web
- **No background location.** The site only checks location while it's open. Arrival alerts come from iPhone Shortcuts (above) or the native iOS app in `../RightCardApp`, which must be built with Xcode on a Mac. The site doesn't fake notifications.
- **No syncing.** Data is saved only in that phone's browser storage (`localStorage`). Use Export / Import to copy it between phones.
- Clearing Safari's website data deletes RightCard's data. Export a backup now and then. WebKit may also remove data for websites you haven't visited in a while; per WebKit, web apps added to the Home Screen are treated differently, but keep a backup anyway.
- RightCard doesn't switch Apple Wallet cards or process payments.

## Add to Home Screen (iPhone, Safari)
1. Open the link in **Safari**. (On iOS 16.4 and later, other browsers' Share menus can also add to the Home Screen.)
2. Tap the **Share** button: the square with an up arrow, in the toolbar (or under the ••• menu on newer iOS).
3. Scroll down and tap **Add to Home Screen**. If you see **Open as Web App**, leave it on.
4. Keep the name "RightCard" and tap **Add**.
5. Open RightCard from the Home Screen icon. It opens full screen, without the Safari address bar.
6. On each phone: **Settings → This phone belongs to** → pick yourself.
7. To copy your setup: on phone 1, **Settings → Export setup** → AirDrop or Messages. On phone 2, save the file to Files, then **Settings → Import setup from file**.

## Privacy
Location is used only in the foreground, only on the phone, to compare against saved stores and the bundled places list. No location is sent to any server or saved. The places file is the same static file for everyone.

## Refreshing the places list
```bash
node scripts/fetch-places.mjs   # Overpass API (falls back to overpass.kumi.systems), ~30 s
```
It queries OpenStreetMap through the free Overpass API around a rounded Bradenton-area point (27.47, -82.53; not a street address), with a 25 km radius. It keeps named places only (points and building centers) with name, brand, kind, address when tagged, and lat/lon. It removes duplicates and writes `places-bradenton.json`. Bump `CACHE` in `sw.js` afterward. Data © OpenStreetMap contributors, ODbL 1.0.

## Tests
```bash
cd web
npm test        # = TZ=America/New_York node --test tests/
# Headless Chrome screen checks (needs playwright-core and Chrome; serve the folder under a sub-path):
#   mkdir -p /tmp/sub && ln -sfn "$PWD" /tmp/sub/rightcard && (cd /tmp/sub && python3 -m http.server 8788 &)
#   npm i --no-save playwright-core && node scripts/screen-checks.mjs http://127.0.0.1:8788/rightcard/
```
Store-link tests cover: matching by id, by name in any capitalization, URL-encoded names with spaces, `&`, `'`, and `+`, no match (never a partial guess), duplicate names (asks which), and links that round-trip under the GitHub Pages sub-path. Places tests cover: the nearest single match, several in range (asks which, nearest first), none in range, a saved store and its confirmed category winning over the map, category mapping, directory search, and the bundled file's format.

`tests/core.test.js` mirrors the Swift tests: different cards per person, shared vs separate limits, used-up limits, purchases crossing a limit, period resets, purchase-size dependence, offers (live, expired, not enrolled, minimum and maximum, non-stacking, per-person), rotating categories (inactive, active, out of window), points valuation, fees, network eligibility, excluded merchants, category uncertainty and confirmation, demo data, nearby / ambiguous / denied location, last-4 validation, card-number rejection, add/edit/archive/delete, export/import, and immutability.

## Hosting
Any static file host works: GitHub Pages, Netlify, or Cloudflare Pages. There's no build step. Serve this folder over **HTTPS** (needed for the service worker and location). The site contains no personal data; your cards live only on your phones.
