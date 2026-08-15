#!/usr/bin/env node
/**
 * BFI IMAX Ticket Check — GitHub Actions one-shot runner
 *
 * Strategy:
 *   - Playwright loads page 1 only (needed to get session cookies + sToken)
 *   - Raw node-fetch handles all remaining pages (fast, ~200ms each)
 *   - Total runtime: ~20-30s for 19 pages, well within Actions limits
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

// ── Parse searchResults from raw HTML ─────────────────────────────────────────

function parseSearchResults(html) {
  const idx = html.indexOf('searchResults');
  if (idx === -1) return [];

  const after = html.slice(idx + 'searchResults'.length);
  const arrStart = after.indexOf('[');
  if (arrStart === -1) return [];

  // Walk brackets to find matching close
  let depth = 0;
  let arrEnd = -1;
  for (let i = arrStart; i < Math.min(after.length, arrStart + 500000); i++) {
    if (after[i] === '[') depth++;
    else if (after[i] === ']') {
      depth--;
      if (depth === 0) { arrEnd = i; break; }
    }
  }
  if (arrEnd === -1) return [];

  try {
    return JSON.parse(after.slice(arrStart, arrEnd + 1));
  } catch (_) {
    return [];
  }
}

function parseToken(html) {
  const m = html.match(/sToken\s*[=:]\s*["']([^"']+)["']/);
  return m ? m[1] : null;
}

function parseTotalPages(html) {
  const m = html.match(/total_pages\s*[=:]\s*["']?(\d+)["']?/);
  return m ? parseInt(m[1], 10) : 1;
}

// ── Extract available screenings from results array ───────────────────────────

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

// ── Main film check ───────────────────────────────────────────────────────────

async function checkFilm(browserPage, cookieHeader, film) {
  const { name, articleId } = film;
  const page1Url = `${BASE_URL}default.asp?doWork::WScontent::loadArticle=Load&BOparam::WScontent::loadArticle::article_id=${articleId}`;

  // Page 1 — use Playwright (has session cookies already from browser launch)
  log(`Checking: ${name}`);
  await browserPage.goto(page1Url, { waitUntil: 'domcontentloaded', timeout: 30000 });

  const html1 = await browserPage.content();
  const sToken     = parseToken(html1);
  const totalPages = parseTotalPages(html1);
  const results1   = parseSearchResults(html1);

  log(`Page 1: ${results1.length} screenings | ${totalPages} total pages`);

  const allResults = [...results1];

  // Pages 2–N — use fast node-fetch with session cookies
  if (sToken && totalPages > 1) {
    // Grab cookies from Playwright context to reuse in fetch
    const cookies = await browserPage.context().cookies();
    const cookieStr = cookies.map(c => `${c.name}=${c.value}`).join('; ');

    const fetchHeaders = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-GB,en;q=0.9',
      'Referer': page1Url,
      'Cookie': cookieStr,
    };

    // Fetch all remaining pages concurrently (max 5 at a time to be polite)
    const remaining = Array.from({ length: totalPages - 1 }, (_, i) => i + 2);
    const BATCH = 5;

    for (let i = 0; i < remaining.length; i += BATCH) {
      const batch = remaining.slice(i, i + BATCH);
      const batchResults = await Promise.all(
        batch.map(async (p) => {
          const url = `${BASE_URL}default.asp?sToken=${encodeURIComponent(sToken)}&BOset::WScontent::SearchResultsInfo::current_page=${p}&doWork::WScontent::getPage=&BOparam::WScontent::getPage::article_id=${articleId}`;
          try {
            const res = await fetch(url, { headers: fetchHeaders });
            if (!res.ok) { log(`⚠️ Page ${p}: HTTP ${res.status}`); return { p, results: [] }; }
            const html = await res.text();
            const results = parseSearchResults(html);
            return { p, results };
          } catch (e) {
            log(`⚠️ Page ${p} error: ${e.message}`);
            return { p, results: [] };
          }
        })
      );

      for (const { p, results } of batchResults) {
        log(`Page ${p}: ${results.length} screenings`);
        allResults.push(...results);
      }
    }
  }

  log(`Total scanned: ${allResults.length} screenings across ${totalPages} page(s)`);
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

  // Hit the homepage first to pick up session cookies
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});

  let anyFound = false;

  for (const film of FILMS) {
    try {
      const available = await checkFilm(page, null, film);

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
