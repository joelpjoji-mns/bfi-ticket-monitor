#!/usr/bin/env node
/**
 * BFI IMAX Ticket Check — GitHub Actions one-shot runner
 *
 * Scans all 19 pages (95 screenings) for The Odyssey at BFI IMAX.
 * Uses Playwright throughout — session stays intact, no 403s.
 * Waits for articleContext.searchResults to be populated before reading each page.
 *
 * Required env vars:
 *   NTFY_TOPIC — your ntfy.sh topic (set as a GitHub Secret)
 */

const { chromium } = require('playwright');
const fetch = require('node-fetch');

const NTFY_TOPIC = process.env.NTFY_TOPIC;
if (!NTFY_TOPIC) {
  console.error('ERROR: NTFY_TOPIC environment variable is not set.');
  process.exit(1);
}

const BASE_URL = 'https://whatson.bfi.org.uk/imax/Online/';

const FILMS = [
  {
    name: 'The Odyssey — BFI IMAX',
    articleId: 'A0A2A7B6-689F-40DA-A1E4-22F7A5B3E99A',
  },
  // Add more films here later:
  // { name: 'Another Film', articleId: 'XXXX' },
];

// ── Logging ───────────────────────────────────────────────────────────────────

function log(msg) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

// ── Notification ──────────────────────────────────────────────────────────────

async function sendNotification(screening) {
  const { film, date, availNum, status, bookingUrl } = screening;
  const statusLabel =
    status === 'L' ? 'Limited seats' : status === 'G' ? 'Good availability' : `Status: ${status}`;

  log(`📱 Sending notification: ${film} | ${date} | ${availNum} seat(s)`);

  try {
    const res = await fetch(`https://ntfy.sh/${NTFY_TOPIC}`, {
      method: 'POST',
      headers: {
        Title: `TICKETS AVAILABLE — ${film}`,
        Priority: 'urgent',
        Tags: 'loudspeaker,ticket',
        Click: bookingUrl,
        'X-Actions': `view, Open booking page, ${bookingUrl}`,
        'Content-Type': 'text/plain',
      },
      body: `${statusLabel} — ${availNum} seat(s)\n📅 ${date}\n\nBook NOW before they sell out!`,
    });
    log(res.ok ? '✅ Notification sent' : `⚠️ ntfy HTTP ${res.status}`);
  } catch (e) {
    log(`⚠️ Notification failed: ${e.message}`);
  }
}

// ── Extract available screenings ──────────────────────────────────────────────

function extractAvailable(results, filmName) {
  const available = [];
  for (const r of results) {
    try {
      const screeningId = r[0];
      const date        = r[7];
      const status      = r[15]; // 'S' = sold out, 'L' = limited, 'G' = good
      const availNum    = parseInt(r[16], 10);
      const relPath     = r[18] || '';
      const bookingUrl  = relPath.startsWith('http') ? relPath : BASE_URL + relPath;

      if (status !== 'S' && !isNaN(availNum) && availNum > 0) {
        available.push({ film: filmName, screeningId, date, status, availNum, bookingUrl });
      }
    } catch (_) {}
  }
  return available;
}

// ── Read a single page's screenings via Playwright ────────────────────────────

async function readPage(page, url, pageNum) {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

  // Wait up to 8s for articleContext.searchResults to be populated by JS
  const results = await page.waitForFunction(() => {
    return (
      typeof articleContext !== 'undefined' &&
      Array.isArray(articleContext.searchResults) &&
      articleContext.searchResults.length > 0
    );
  }, { timeout: 8000 })
    .then(() => page.evaluate(() => articleContext.searchResults))
    .catch(() => {
      // Timeout — page genuinely has 0 results (e.g. empty calendar page)
      return [];
    });

  log(`Page ${pageNum}: ${results.length} screenings`);
  return results;
}

// ── Main film check ───────────────────────────────────────────────────────────

async function checkFilm(page, film) {
  const { name, articleId } = film;
  const page1Url = `${BASE_URL}default.asp?doWork::WScontent::loadArticle=Load&BOparam::WScontent::loadArticle::article_id=${articleId}`;

  log(`Checking: ${name}`);

  // Page 1 — also grab sToken and totalPages
  await page.goto(page1Url, { waitUntil: 'domcontentloaded', timeout: 30000 });

  const ctx = await page.waitForFunction(() => {
    return (
      typeof articleContext !== 'undefined' &&
      articleContext.pagination &&
      Array.isArray(articleContext.searchResults)
    );
  }, { timeout: 10000 })
    .then(() => page.evaluate(() => ({
      sToken:     articleContext.sToken,
      totalPages: parseInt(articleContext.pagination.total_pages, 10),
      results:    articleContext.searchResults,
    })))
    .catch(async () => {
      // Fallback: just grab whatever's there
      return page.evaluate(() => ({
        sToken:     (typeof articleContext !== 'undefined' && articleContext.sToken) || null,
        totalPages: (typeof articleContext !== 'undefined' && articleContext.pagination)
          ? parseInt(articleContext.pagination.total_pages, 10) : 1,
        results:    (typeof articleContext !== 'undefined' && articleContext.searchResults) || [],
      }));
    });

  log(`Page 1: ${ctx.results.length} screenings | ${ctx.totalPages} total pages`);

  const allResults = [...ctx.results];

  // Pages 2–N — navigate in Playwright keeping the session alive
  for (let p = 2; p <= ctx.totalPages; p++) {
    const pageUrl = `${BASE_URL}default.asp?sToken=${encodeURIComponent(ctx.sToken)}&BOset::WScontent::SearchResultsInfo::current_page=${p}&doWork::WScontent::getPage=&BOparam::WScontent::getPage::article_id=${articleId}`;
    const results = await readPage(page, pageUrl, p);
    allResults.push(...results);
  }

  log(`Total scanned: ${allResults.length} screenings across ${ctx.totalPages} page(s)`);
  return extractAvailable(allResults, name);
}

// ── Entry point ───────────────────────────────────────────────────────────────

async function main() {
  log('=== BFI IMAX Ticket Check (GitHub Actions) ===');

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  });
  const page = await context.newPage();

  let anyFound = false;

  for (const film of FILMS) {
    try {
      const available = await checkFilm(page, film);

      if (available.length === 0) {
        log(`❌ "${film.name}" — all sold out`);
      } else {
        anyFound = true;
        for (const s of available) {
          log(`🎟️  AVAILABLE: ${s.film} | ${s.date} | ${s.availNum} seat(s) | ${s.status}`);
          log(`   Book: ${s.bookingUrl}`);
          await sendNotification(s);
        }
      }
    } catch (e) {
      log(`ERROR checking "${film.name}": ${e.message}`);
    }
  }

  await browser.close();

  if (!anyFound) {
    log('No tickets available this run — will check again in 5 minutes.');
  }

  log('=== Check complete ===');
}

main().catch((e) => {
  console.error('Fatal:', e);
  process.exit(1);
});
