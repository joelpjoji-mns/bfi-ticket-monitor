# 🎬 BFI IMAX Ticket Monitor

Instantly notifies your **Android phone** the moment BFI IMAX tickets become available — no lag, no missed releases.

Currently monitoring: **The Odyssey (Christopher Nolan)** at BFI IMAX

---

## Quick Start

### Step 1 — Install the ntfy app on Android
1. Install **[ntfy](https://play.google.com/store/apps/details?id=io.heckel.ntfy)** from the Play Store (free)
2. Open the app → tap **+** → Subscribe to topic
3. Enter a **unique topic name** you'll choose in Step 3 (e.g. `joel-bfi-7382`)

### Step 2 — Install dependencies (one time)
```bash
cd bfi-ticket-monitor
npm install
npx playwright install chromium
```

### Step 3 — Configure your topic
Open `monitor.js` and change this line:
```js
ntfyTopic: 'bfi-odyssey-monitor-CHANGE-ME',
```
to something unique and personal:
```js
ntfyTopic: 'joel-bfi-odyssey-7382',   // make this up yourself!
```
> ⚠️ Keep this secret — anyone who knows your topic can send you notifications.

### Step 4 — Run it
```bash
node monitor.js
```

Leave it running in the background. You'll get an **instant push notification** on your phone the moment a seat becomes available, with a button to open the booking page directly.

---

## How it works

- Uses **Playwright** (a real Chromium browser) to visit the BFI IMAX booking site every 5 minutes
- Reads the embedded `articleContext.searchResults` data to find screening availability
- When status is NOT `'S'` (sold out) and `availNum > 0`, sends a push notification via **ntfy.sh**
- Tracks already-notified screenings to avoid duplicate alerts

## Files

| File | Purpose |
|------|---------|
| `monitor.js` | Main monitor script |
| `README.md` | This file |

## Adding more films

In `monitor.js`, add more entries to the `CONFIG.films` array:
```js
films: [
  {
    name: 'The Odyssey — BFI IMAX',
    articleId: 'A0A2A7B6-689F-40DA-A1E4-22F7A5B3E99A',
    bookingBaseUrl: 'https://whatson.bfi.org.uk/imax/Online/...',
  },
  // Add another film here
],
```

## ntfy notification details

When tickets are found, you'll receive:
- 🔴 **Urgent priority** notification (bypasses Do Not Disturb)
- Title: `TICKETS AVAILABLE — The Odyssey — BFI IMAX`
- Body: seat count + date
- Tap to **open booking page instantly**
