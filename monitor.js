#!/usr/bin/env node
/**
 * BFI IMAX Ticket Monitor — Playwright Edition
 * Uses a real Chromium browser to bypass anti-bot detection.
 * Sends instant push notifications to Android via ntfy.sh.
 *
 * SETUP:
 *   1. npm install playwright
 *   2. npx playwright install chromium
 *   3. Edit CONFIG below (especially ntfyTopic)
 *   4. Install "ntfy" app on Android, subscribe to your topic
 *   5. node monitor.js
 */

const { chromium } = require('playwright');
const fetch = require('node-fetch');

// ─────────────────────────────────────────────────────────────────────────────
// ⚙️  CONFIG — Edit these values before running
// ─────────────────────────────────────────────────────────────────────────────
const CONFIG = {
  /**
   * Your unique ntfy.sh topic.
   * Keep it secret — it's your notification channel.
   * Example: "joel-bfi-tickets-9283"
   */
  ntfyTopic: 'bfi-odyssey-monitor-CHANGE-ME',

  /** Check interval in minutes */
  intervalMinutes: 5,

  /** Films to watch — add more objects to monitor multiple films */
  films: [
    {
      name: 'The Odyssey — BFI IMAX',
      articleId: 'A0A2A7B6-689F-40DA-A1E4-22F7A5B3E99A',
      // Direct link sent in the notification
      bookingBaseUrl:
        'https://whatson.bfi.org.uk/imax/Online/default.asp?doWork::WScontent::loadArticle=Load&BOparam::WScontent::loadArticle::article_id=A0A2A7B6-689F-40DA-A1E4-22F7A5B3E99A',
    },
  ],

  /** Run browser headless (true = invisible, false = shows window) */
  headless: true,
};
// ─────────────────────────────────────────────────────────────────────────────

const BASE_URL = 'https://whatson.bfi.org.uk/imax/Online/';
const ARTICLE_URL = (id) =>
  `${BASE_URL}default.asp?doWork::WScontent::loadArticle=Load&BOparam::WScontent::loadArticle::article_id=${id}`;
const PAGE_URL = (token, page, id) =>
  `${BASE_URL}default.asp?sToken=${encodeURIComponent(token)}&BOset::WScontent::SearchResultsInfo::current_page=${page}&doWork::WScontent::getPage=&BOparam::WScontent::getPage::article_id=${id}`;

// Track notified screenings to avoid spam
const notified = new Set();

// ── Utilities ────────────────────────────────────────────────────────────────

function log(msg, level = 'INFO') {
  const ts = new Date().toLocaleString('en-GB', { timeZone: 'Europe/London' });
  const prefix = level === 'ALERT' ? '🎟️  ' : level === 'ERROR' ? '❌ ' : level === 'WARN' ? '⚠️  ' : '   ';
  console.log(`[${ts}] ${prefix}[${level}] ${msg}`);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ── Core scraping via Playwright ──────────────────────────────────────────────

async function getScreenings(page, film) {
  const { name, articleId, bookingBaseUrl } = film;

  log(`Checking: ${name}`);

  try {
    await page.goto(ARTICLE_URL(articleId), { waitUntil: 'domcontentloaded', timeout: 30000 });
  } catch (e) {
    log(`Failed to load page for "${name}": ${e.message}`, 'ERROR');
    return [];
  }

  // Extract articleContext from the page
  const ctx = await page.evaluate(() => {
    if (typeof articleContext === 'undefined') return null;
    return {
      sToken: articleContext.sToken,
      totalPages: articleContext.pagination
        ? parseInt(articleContext.pagination.total_pages)
        : 1,
      searchResults: articleContext.searchResults || [],
    };
  });

  if (!ctx) {
    log(`No articleContext found for "${name}" — site may have changed`, 'WARN');
    return [];
  }

  log(`${name} — ${ctx.totalPages} page(s) of screenings`);

  const allResults = [...ctx.searchResults];

  // Paginate through remaining pages
  for (let p = 2; p <= ctx.totalPages; p++) {
    await sleep(800);
    try {
      await page.goto(PAGE_URL(ctx.sToken, p, articleId), {
        waitUntil: 'domcontentloaded',
        timeout: 30000,
      });

      const pageCtx = await page.evaluate(() => {
        if (typeof articleContext === 'undefined') return null;
        return { searchResults: articleContext.searchResults || [] };
      });

      if (pageCtx) allResults.push(...pageCtx.searchResults);
    } catch (e) {
      log(`Error fetching page ${p} for "${name}": ${e.message}`, 'WARN');
    }
  }

  // Filter for available screenings
  const available = [];
  for (const r of allResults) {
    try {
      const screeningId = r[0];
      const date = r[7];
      const status = r[15]; // 'S' = sold out, 'L' = limited, 'G' = good
      const availNum = parseInt(r[16], 10);
      const relPath = r[18] || '';
      const bookingUrl = relPath.startsWith('http') ? relPath : BASE_URL + relPath;

      if (status !== 'S' && !isNaN(availNum) && availNum > 0) {
        available.push({ film: name, screeningId, date, status, availNum, bookingUrl });
      }
    } catch (_) {}
  }

  return available;
}

// ── Notifications ─────────────────────────────────────────────────────────────

async function sendNotification(screening) {
  const { film, date, availNum, status, bookingUrl } = screening;
  const statusLabel =
    status === 'L' ? 'Limited seats' : status === 'G' ? 'Good availability' : `Status: ${status}`;

  const title = `TICKETS AVAILABLE — ${film}`;
  const body = `${statusLabel} — ${availNum} seat(s)\n📅 ${date}\n\nTap to book NOW!`;

  log(`📱 Sending push notification: ${film} | ${date} | ${availNum} seats`, 'ALERT');

  try {
    const res = await fetch(`https://ntfy.sh/${CONFIG.ntfyTopic}`, {
      method: 'POST',
      headers: {
        Title: title,
        Priority: 'urgent',
        Tags: 'loudspeaker,ticket',
        Click: bookingUrl,
        'Content-Type': 'text/plain',
        'X-Actions': `view, Open booking page, ${bookingUrl}`,
      },
      body,
    });
    if (res.ok) {
      log(`Push sent successfully ✓`);
    } else {
      log(`ntfy returned HTTP ${res.status}`, 'WARN');
    }
  } catch (e) {
    log(`Failed to send notification: ${e.message}`, 'ERROR');
  }
}

// ── Main loop ─────────────────────────────────────────────────────────────────

async function runCheck(browser) {
  const context = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  });
  const page = await context.newPage();

  log('─'.repeat(55));
  log('Running availability check...');

  let anyAvailable = false;

  for (const film of CONFIG.films) {
    const available = await getScreenings(page, film);

    if (available.length === 0) {
      log(`"${film.name}" — All sold out 😔`);
    } else {
      anyAvailable = true;
      for (const s of available) {
        log(`AVAILABLE: ${s.film} | ${s.date} | ${s.availNum} seats`, 'ALERT');
        log(`   Book here: ${s.bookingUrl}`);

        if (!notified.has(s.screeningId)) {
          notified.add(s.screeningId);
          await sendNotification(s);
        } else {
          log(`   (Already notified for this screening, skipping)`);
        }
      }
    }
  }

  if (!anyAvailable) {
    log('No tickets available this check. Will keep watching...');
  }

  await context.close();
  log(`Next check in ${CONFIG.intervalMinutes} minute(s)...`);
}

async function main() {
  console.log('');
  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║       BFI IMAX TICKET MONITOR  v2 (Playwright)           ║');
  console.log('╚══════════════════════════════════════════════════════════╝');
  console.log('');

  if (CONFIG.ntfyTopic.includes('CHANGE-ME')) {
    console.log('⚠️  WARNING: You must set a unique ntfy topic!');
    console.log('   Edit CONFIG.ntfyTopic in monitor.js, e.g.:');
    console.log('   ntfyTopic: "joel-bfi-tickets-7382"');
    console.log('');
    console.log('   Then install the ntfy app on Android and subscribe to that topic.');
    console.log('');
    process.exit(1);
  }

  console.log(`📡 ntfy topic  : https://ntfy.sh/${CONFIG.ntfyTopic}`);
  console.log(`⏱️  Check every : ${CONFIG.intervalMinutes} minutes`);
  console.log(`🎬 Monitoring  : ${CONFIG.films.map((f) => f.name).join(', ')}`);
  console.log('');
  console.log('Press Ctrl+C to stop.');
  console.log('');

  log('Launching browser...');
  const browser = await chromium.launch({ headless: CONFIG.headless });

  // First check immediately
  await runCheck(browser);

  // Then repeat on interval
  const intervalMs = CONFIG.intervalMinutes * 60 * 1000;
  setInterval(() => runCheck(browser), intervalMs);
}

main().catch((e) => {
  console.error('Fatal error:', e);
  process.exit(1);
});
