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
- **Find nearby saved store** (optional): uses the browser's location **only when you tap it, while the site is open**. If several saved stores are close, it asks which one you're at.
- **Export / import** a JSON setup file, sent with AirDrop or Messages, to copy everything to the other phone.
- Works **offline** after the first visit (service worker). Supports light and dark mode, large tap targets, and labels for VoiceOver.

## What does NOT work on the web
- **No arrival notifications.** iPhone web apps can't monitor location in the background, so the site can't alert you when you arrive at a store. That needs the native iOS app in `../RightCardApp`, which must be built with Xcode on a Mac. The site doesn't fake these notifications.
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

## Tests
```bash
cd web
npm test        # = TZ=America/New_York node --test tests/
```
`tests/core.test.js` mirrors the Swift tests: different cards per person, shared vs separate limits, used-up limits, purchases crossing a limit, period resets, purchase-size dependence, offers (live, expired, not enrolled, minimum and maximum, non-stacking, per-person), rotating categories (inactive, active, out of window), points valuation, fees, network eligibility, excluded merchants, category uncertainty and confirmation, demo data, nearby / ambiguous / denied location, last-4 validation, card-number rejection, add/edit/archive/delete, export/import, and immutability.

## Hosting
Any static file host works: GitHub Pages, Netlify, or Cloudflare Pages. There's no build step. Serve this folder over **HTTPS** (needed for the service worker and location). The site contains no personal data; your cards live only on your phones.
