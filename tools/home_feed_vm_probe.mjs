import path from "node:path";

import { chromium } from "playwright-core";
import {
  attachPageLogging,
  ensureDir,
  resolveChromePath,
  saveScreenshot,
  writeAutomationError,
  writeJsonFile
} from "./cover_shared.mjs";

const DEFAULT_PAGE_URL = "https://pucky.fly.dev/ui/pucky/latest/index.html";
const DEFAULT_REPORT_ROOT = path.resolve(".tmp", "home-feed-vm-probe");
const FIXTURE_TITLES = new Set(["Morning launch", "Leaving home", "Pocket Computers"]);

function parseArgs(argv) {
  const config = {
    pageUrl: process.env.PUCKY_HOME_FEED_URL || DEFAULT_PAGE_URL,
    reportDir: "",
    archive: false,
    timeoutMs: 20000
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--page-url") {
      config.pageUrl = String(argv[++index] || config.pageUrl);
    } else if (arg === "--report-dir") {
      config.reportDir = String(argv[++index] || "");
    } else if (arg === "--archive") {
      config.archive = true;
    } else if (arg === "--timeout-ms") {
      config.timeoutMs = Math.max(1000, Number(argv[++index] || config.timeoutMs) || config.timeoutMs);
    }
  }
  if (!config.reportDir) {
    config.reportDir = path.join(DEFAULT_REPORT_ROOT, new Date().toISOString().replace(/[:.]/g, "-"));
  }
  return config;
}

function pageOrigin(pageUrl) {
  return new URL(pageUrl).origin;
}

async function fetchJson(url) {
  const response = await fetch(url, { headers: { Accept: "application/json" } });
  if (!response.ok) {
    throw new Error(`GET ${url} failed with ${response.status}`);
  }
  return response.json();
}

async function visibleCardTitles(page) {
  return page.locator("#feed article.card h2.title").evaluateAll(nodes =>
    nodes.map(node => String(node.textContent || "").trim()).filter(Boolean)
  );
}

async function homeMetrics(page) {
  return page.evaluate(() => {
    const feed = document.getElementById("feed");
    const style = feed ? window.getComputedStyle(feed) : null;
    const debug = window.PuckyUiDebug?.describe?.() || {};
    return {
      route: debug.route || "",
      debug_home_feed: debug.home_feed || null,
      feed_scroll_top: Math.round(Number(feed?.scrollTop || 0)),
      feed_client_height: Math.round(Number(feed?.clientHeight || 0)),
      feed_scroll_height: Math.round(Number(feed?.scrollHeight || 0)),
      feed_overflow_y: style?.overflowY || "",
      home_shell_count: document.querySelectorAll(".home-feed-shell, .home-feed-scroll").length,
      visible_archive_button_count: document.querySelectorAll(".action-archive, [data-card-action='archive']").length,
      reveal_action_count: document.querySelectorAll(".card-wrap .archive-reveal-action").length,
      reveal_open_count: document.querySelectorAll(".card-wrap.is-archive-reveal-open").length
    };
  });
}

async function waitForHomeCards(page, timeoutMs) {
  await page.waitForFunction(() => {
    const feed = document.getElementById("feed");
    if (!feed) {
      return false;
    }
    return feed.querySelectorAll("article.card h2.title").length > 0
      || Boolean(feed.querySelector(".feed-load-error"));
  }, null, { timeout: timeoutMs });
}

async function mouseHoverDoesNotDragFeed(page) {
  const feed = page.locator("#feed");
  const box = await feed.boundingBox();
  if (!box) {
    throw new Error("Could not locate #feed");
  }
  const before = await feed.evaluate(node => node.scrollTop);
  await page.mouse.move(box.x + box.width * 0.5, box.y + 40);
  await page.mouse.move(box.x + box.width * 0.25, box.y + box.height * 0.55, { steps: 12 });
  await page.mouse.move(box.x + box.width * 0.75, box.y + box.height * 0.35, { steps: 12 });
  const after = await feed.evaluate(node => node.scrollTop);
  return { before, after, changed: Math.abs(after - before) };
}

async function mouseDragDoesNotRevealArchive(page) {
  const card = page.locator("#feed .card-wrap article.card").first();
  const box = await card.boundingBox();
  if (!box) {
    throw new Error("Could not locate first Home card for mouse drag test");
  }
  await page.mouse.move(box.x + box.width * 0.65, box.y + box.height * 0.5);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.18, box.y + box.height * 0.5, { steps: 14 });
  await page.mouse.up();
  await page.waitForTimeout(150);
  return page.evaluate(() => ({
    open_count: document.querySelectorAll(".card-wrap.is-archive-reveal-open").length,
    active_count: document.querySelectorAll(".card-wrap.is-archive-reveal-active").length
  }));
}

async function wheelStillScrolls(page) {
  const feed = page.locator("#feed");
  const box = await feed.boundingBox();
  if (!box) {
    throw new Error("Could not locate #feed for wheel test");
  }
  await feed.evaluate(node => { node.scrollTop = 0; });
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5);
  await page.mouse.wheel(0, 600);
  await page.waitForTimeout(300);
  const after = await feed.evaluate(node => node.scrollTop);
  return { after, ok: after > 0 };
}

async function maybeArchiveFirstCard(page, requestLog, enabled) {
  if (!enabled) {
    return { skipped: true };
  }
  const before = await visibleCardTitles(page);
  const button = page.locator(".card-wrap .archive-reveal-action").first();
  await button.click({ timeout: 5000 });
  await page.waitForTimeout(500);
  const after = await visibleCardTitles(page);
  const actionRequests = requestLog.filter(item => item.url.includes("/api/feed/actions"));
  return {
    skipped: false,
    before_first_title: before[0] || "",
    after_first_title: after[0] || "",
    feed_action_requests: actionRequests.length
  };
}

async function main() {
  const config = parseArgs(process.argv.slice(2));
  ensureDir(config.reportDir);

  const origin = pageOrigin(config.pageUrl);
  const liveFeed = await fetchJson(`${origin}/api/feed?limit=100&include_archived=0&compact=1`);
  const liveTitles = Array.isArray(liveFeed.items)
    ? liveFeed.items.map(item => String(item.title || "").trim()).filter(Boolean)
    : [];

  const requestLog = [];
  const browser = await chromium.launch({
    executablePath: resolveChromePath(),
    headless: true
  });
  const context = await browser.newContext({
    viewport: { width: 430, height: 932 },
    deviceScaleFactor: 2,
    isMobile: false,
    hasTouch: false,
    recordVideo: { dir: config.reportDir, size: { width: 430, height: 932 } }
  });
  await context.tracing.start({ screenshots: true, snapshots: true });
  const page = await context.newPage();
  attachPageLogging(page, path.join(config.reportDir, "console.log"));
  page.on("request", request => {
    requestLog.push({ method: request.method(), url: request.url(), resource_type: request.resourceType() });
  });

  try {
    await page.goto(config.pageUrl, { waitUntil: "domcontentloaded", timeout: config.timeoutMs });
    await saveScreenshot(page, config.reportDir, "initial");
    await waitForHomeCards(page, config.timeoutMs);
    await saveScreenshot(page, config.reportDir, "loaded");

    const visibleTitles = await visibleCardTitles(page);
    const fixtureTitlesInLiveFeed = [...FIXTURE_TITLES].filter(title => liveTitles.includes(title));
    const unexpectedFixtureTitles = visibleTitles.filter(title => FIXTURE_TITLES.has(title) && !fixtureTitlesInLiveFeed.includes(title));
    const feedRequests = requestLog.filter(item => item.url.includes("/api/feed"));
    const fixtureRequests = requestLog.filter(item => item.url.includes("/ui/pucky/fixtures/reply_cards.json"));
    const beforeInteractionMetrics = await homeMetrics(page);
    const mouseHover = await mouseHoverDoesNotDragFeed(page);
    const mouseDrag = await mouseDragDoesNotRevealArchive(page);
    const wheel = await wheelStillScrolls(page);
    await saveScreenshot(page, config.reportDir, "after-wheel");
    const afterInteractionMetrics = await homeMetrics(page);
    const archive = await maybeArchiveFirstCard(page, requestLog, config.archive);
    if (config.archive) {
      await saveScreenshot(page, config.reportDir, "after-archive");
    }

    const summary = {
      schema: "pucky.home_feed_vm_probe.v1",
      ok: true,
      page_url: config.pageUrl,
      live_feed_count: liveTitles.length,
      live_feed_first_titles: liveTitles.slice(0, 5),
      visible_titles: visibleTitles.slice(0, 10),
      feed_request_count: feedRequests.length,
      fixture_request_count: fixtureRequests.length,
      bridge_reply_cards_get_count: 0,
      unexpected_fixture_titles: unexpectedFixtureTitles,
      before_interaction_metrics: beforeInteractionMetrics,
      after_interaction_metrics: afterInteractionMetrics,
      mouse_hover_scroll_delta: mouseHover.changed,
      mouse_drag_archive_reveal: mouseDrag,
      wheel_scroll_ok: wheel.ok,
      archive,
      assertions: {
        requested_vm_feed: feedRequests.length > 0,
        no_static_fixture_request: fixtureRequests.length === 0,
        visible_matches_live_first: !liveTitles.length || visibleTitles[0] === liveTitles[0],
        no_unexpected_fixture_titles: unexpectedFixtureTitles.length === 0,
        home_uses_single_feed_scroller: beforeInteractionMetrics.home_shell_count === 0
          && beforeInteractionMetrics.feed_overflow_y === "auto"
          && beforeInteractionMetrics.feed_scroll_height > beforeInteractionMetrics.feed_client_height,
        no_visible_archive_button: beforeInteractionMetrics.visible_archive_button_count === 0,
        mouse_hover_does_not_drag: mouseHover.changed <= 1,
        mouse_drag_does_not_reveal_archive: mouseDrag.open_count === 0 && mouseDrag.active_count === 0,
        wheel_scrolls: wheel.ok,
        archive_calls_api_when_enabled: !config.archive || archive.feed_action_requests > 0
      },
      requests: requestLog
    };
    summary.ok = Object.values(summary.assertions).every(Boolean);
    writeJsonFile(path.join(config.reportDir, "summary.json"), summary);
    await context.tracing.stop({ path: path.join(config.reportDir, "trace.zip") });
    await browser.close();
    if (!summary.ok) {
      throw new Error(`Home feed VM probe failed: ${JSON.stringify(summary.assertions)}`);
    }
    console.log(JSON.stringify(summary, null, 2));
  } catch (error) {
    await context.tracing.stop({ path: path.join(config.reportDir, "trace.zip") }).catch(() => {});
    writeAutomationError(config.reportDir, error);
    await browser.close().catch(() => {});
    throw error;
  }
}

main().catch(error => {
  console.error(error.stack || error.message);
  process.exit(1);
});
