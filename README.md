# 🎬 BFI IMAX Ticket Monitor

Instantly notifies your **Android phone** the moment BFI IMAX tickets become available — no lag, no missed releases.

Currently monitoring: **The Odyssey (Christopher Nolan)** at BFI IMAX

---

## 🚀 Features
- **Zero Lag Notifications:** Get instant push notifications directly to your phone via [ntfy.sh](https://ntfy.sh) the second tickets become available.
- **Bypasses Bot Protection:** Uses a real Chromium browser via Playwright to seamlessly load the booking page, preserving session state to navigate past BFI's anti-bot protections without getting blocked (no HTTP 403 errors).
- **Fully Automated via GitHub Actions:** Runs completely in the cloud. Scheduled to check all pages of ticket availability every 5 minutes, 24/7. No need to keep your laptop running.
- **Smart Filtering:** Accurately parses the `articleContext` object on the page to determine ticket availability (`availNum`), only alerting you when the status is not sold out (`'S'`) and there are actual seats left to book.
- **Direct Booking Link:** The notification includes a direct click-through link straight to the booking page. 

---

## 🛠 Quick Start

### Step 1 — Setup Notifications on Android
1. Install **[ntfy](https://play.google.com/store/apps/details?id=io.heckel.ntfy)** from the Google Play Store (it's free and requires no account).
2. Open the app → tap **+** (Subscribe to topic).
3. Enter your **unique topic name** (this acts as your secret channel). For example: `yourname-bfi-7382`.

### Step 2 — Fork or Clone this Repository
If you're running this on GitHub Actions (recommended), simply fork this repository to your own account. It can be a private repository!

If running locally:
```bash
git clone https://github.com/joelpjoji-mns/bfi-ticket-monitor.git
cd bfi-ticket-monitor
npm install
npx playwright install chromium
```

### Step 3 — Configure Your Secret Topic
#### If using GitHub Actions:
1. Go to your repository **Settings** → **Secrets and variables** → **Actions**.
2. Click **New repository secret**.
3. Name: `NTFY_TOPIC`
4. Secret: Enter the unique topic name you chose in Step 1 (e.g., `yourname-bfi-7382`).
5. Click **Add secret**.
6. Navigate to the **Actions** tab in your repo and enable workflows. You can manually trigger it to test, and it will run automatically every 5 minutes thereafter.

#### If running locally:
Create a `.env` file or export the variable in your terminal before running:
```bash
export NTFY_TOPIC="yourname-bfi-7382"
node check.js
```

---

## ⚙️ How It Works Under the Hood

The BFI IMAX booking system loads its availability data dynamically via JavaScript into an object called `articleContext`. Directly scraping the HTML with tools like `curl` or `node-fetch` fails on paginated results due to 403 Forbidden errors (bot protection).

To solve this, the script utilizes a hybrid approach:
1. **Playwright Initialization:** It launches a headless Chromium browser to visit the first page of the film's screenings. This establishes a valid session and acquires the necessary `sToken` and cookies.
2. **Dynamic Waiting:** It intelligently waits for the `articleContext.searchResults` to be fully populated by the site's JavaScript, handling cases where pages take slightly longer to load.
3. **Session Preservation:** It iterates through all paginated pages within the same browser context, keeping the session alive and preventing the server from rejecting the requests.
4. **Parsing and Alerting:** It extracts the screening date, availability status, and seat count. If tickets are found, it triggers a POST request to `ntfy.sh`, delivering the alert to your device instantly.

## 📝 Adding More Films
Want to monitor other films? Open `check.js` and add another entry to the `FILMS` array:

```javascript
const FILMS = [
  {
    name: 'The Odyssey — BFI IMAX',
    articleId: 'A0A2A7B6-689F-40DA-A1E4-22F7A5B3E99A', // You can find this in the URL of the film's booking page
  },
  {
    name: 'Another Movie — BFI IMAX',
    articleId: 'YOUR-NEW-ARTICLE-ID',
  }
];
```

## 📜 License
This project is open-source and free to use. 
