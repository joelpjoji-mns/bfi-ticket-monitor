#!/usr/bin/env node
/**
 * BFI IMAX Ticket Check — one-shot version for GitHub Actions.
 * Runs once, checks all pages, sends ntfy notification if seats found, then exits.
 *
 * Required env vars:
 *   NTFY_TOPIC  — your ntfy.sh topic name (set as a GitHub Secret)
 */

const { chromium } = require('playwright');
const fetch = require('node-fetch');

const NTFY_TOPIC = process.env.NTFY_TOPIC;
if (!NTFY_TOPIC) {
  console.error('ERROR: NTFY_TOPIC environment variable is not set.');
  console.error('Add it as a GitHub Secret named NTFY_TOPIC.');
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

function log(msg) {
  const ts = new Date().toISOString();
  console.log(`[${ts}] ${msg}`);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function sendNotification(screening) {
  const { film, date, availNum, status, bookingUrl } = screening;
  const statusLabel =
    status === 'L' ? 'Limited seats' : status === 'G' ? 'Good availability' : `Status: ${status}`;

  log(`📱 Sending notification: ${film} | ${date} | ${availNum} seat(s)`);

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

  if (res.ok) {
    log('✅ Notification sent successfully');
  } else {
    log(`⚠️ ntfy returned HTTP ${res.status}`);
  }
}

async function checkFilm(page, film) {
  const { name, articleId } = film;

  const url = `${BASE_URL}default.asp?doWork::WScontent::loadArticle=Load&BOparam::WScontent::loadArticle::article_id=${articleId}`;

  log(`Checking: ${name}`);
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

  const ctx = await page.evaluate(() => {
    if (typeof articleContext === 'undefined') return null;
    return {
      sToken: articleContext.sToken || null,
      totalPages: articleContext.pagination
        ? parseInt(articleContext.pagination.total_pages, 10)
        : 1,
      searchResults: articleContext.searchResults || [],
    };
  });

  if (!ctx) {
    log(`⚠️ No articleContext found for "${name}" — page may have changed`);
    return [];
  }

  log(`Found ${ctx.totalPages} page(s) of screenings for "${name}"`);

  const allResults = [...ctx.searchResults];

  // Paginate through remaining pages
  for (let p = 2; p <= ctx.totalPages; p++) {
    await sleep(700);
    const pageUrl = `${BASE_URL}default.asp?sToken=${encodeURIComponent(ctx.sToken)}&BOset::WScontent::SearchResultsInfo::current_page=${p}&doWork::WScontent::getPage=&BOparam::WScontent::getPage::article_id=${articleId}`;

    try {
      await page.goto(pageUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      const pageCtx = await page.evaluate(() => {
        if (typeof articleContext === 'undefined') return null;
        return { searchResults: articleContext.searchResults || [] };
      });
      if (pageCtx) allResults.push(...pageCtx.searchResults);
    } catch (e) {
      log(`⚠️ Error fetching page ${p}: ${e.message}`);
    }
  }

  log(`Scanned ${allResults.length} total screenings`);

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

async function main() {
  log('=== BFI IMAX Ticket Check (GitHub Actions) ===');

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
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
          log(`🎟️  AVAILABLE: ${s.film} | ${s.date} | ${s.availNum} seat(s) | status: ${s.status}`);
          log(`   Book here: ${s.bookingUrl}`);
          await sendNotification(s);
        }
      }
    } catch (e) {
      log(`ERROR checking "${film.name}": ${e.message}`);
    }
  }

  await browser.close();

  if (!anyFound) {
    log('No tickets available this run. GitHub Actions will check again in 5 minutes.');
  }

  log('=== Check complete ===');
}

main().catch((e) => {
  console.error('Fatal error:', e);
  process.exit(1);
});
