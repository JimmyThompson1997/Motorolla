import path from "node:path";

import { chromium } from "playwright-core";
import {
  attachPageLogging,
  ensureDir,
  resolveChromePath,
  saveScreenshot,
  writeAutomationError,
  writeJsonFile
} from "../../support/cover_shared.mjs";

const DEFAULT_LIGHT_URL = "https://pucky.fly.dev/ui/pucky/latest/index.html?theme=light&reset_nav=1";
const DEFAULT_DARK_FEED_URL = "https://pucky.fly.dev/ui/pucky/latest/index.html?theme=dark&route=inbox&reset_nav=1";
const DEFAULT_DARK_MEETINGS_URL = "https://pucky.fly.dev/ui/pucky/latest/index.html?theme=dark&route=meetings&reset_nav=1";
const VIEWPORT = { width: 430, height: 932 };

function parseArgs(argv) {
  const config = {
    lightUrl: process.env.PUCKY_LIGHT_CANONICAL_DARK_URL || DEFAULT_LIGHT_URL,
    darkFeedUrl: process.env.PUCKY_DARK_FEED_URL || DEFAULT_DARK_FEED_URL,
    darkMeetingsUrl: process.env.PUCKY_DARK_MEETINGS_URL || DEFAULT_DARK_MEETINGS_URL,
    reportDir: path.resolve("artifacts", "light-canonical-dark-ports"),
    timeoutMs: 25000
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = String(argv[index] || "");
    if (arg === "--light-url" && argv[index + 1]) {
      config.lightUrl = String(argv[++index] || config.lightUrl);
    } else if (arg === "--dark-feed-url" && argv[index + 1]) {
      config.darkFeedUrl = String(argv[++index] || config.darkFeedUrl);
    } else if (arg === "--dark-meetings-url" && argv[index + 1]) {
      config.darkMeetingsUrl = String(argv[++index] || config.darkMeetingsUrl);
    } else if (arg === "--report-dir" && argv[index + 1]) {
      config.reportDir = String(argv[++index] || config.reportDir);
    } else if (arg === "--timeout-ms" && argv[index + 1]) {
      config.timeoutMs = Math.max(1000, Number(argv[++index] || config.timeoutMs) || config.timeoutMs);
    }
  }
  return config;
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function normalizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function cssString(value) {
  return String(value || "").replace(/\\/g, "\\\\").replace(/"/g, "\\\"");
}

async function waitForCanonicalPort(page, activeLabel, timeoutMs) {
  await page.waitForFunction(
    expected => {
      const shell = document.querySelector(".app-shell");
      const active = document.querySelector(`.page-tabs .tab.is-active[aria-label="${expected}"]`);
      return shell?.getAttribute("data-theme") === "dark" && !!active;
    },
    activeLabel,
    { timeout: timeoutMs }
  );
}

async function extractCardRows(page, selector, limit = 10) {
  return page.locator(selector).evaluateAll((nodes, maxRows) =>
    nodes.slice(0, maxRows).map(node => ({
      card_id: String(node.getAttribute("data-card-id") || "").trim(),
      session_id: String(node.getAttribute("data-card-session-id") || "").trim(),
      title: String(node.querySelector(".title")?.textContent || "").trim(),
      preview: String(node.querySelector(".preview")?.textContent || "").trim(),
      timestamp: String(node.querySelector(".card-timestamp")?.textContent || "").trim(),
      classes: String(node.className || "").trim(),
      unread: node.classList.contains("card-unread"),
      action_count: node.querySelectorAll("[data-card-action]").length
    })),
    limit
  );
}

function rowsMatch(leftRows, rightRows) {
  if (leftRows.length !== rightRows.length) {
    return false;
  }
  return leftRows.every((leftRow, index) => {
    const rightRow = rightRows[index];
    return leftRow.card_id === rightRow.card_id
      && leftRow.session_id === rightRow.session_id
      && leftRow.title === rightRow.title
      && leftRow.preview === rightRow.preview
      && leftRow.timestamp === rightRow.timestamp
      && leftRow.unread === rightRow.unread
      && leftRow.action_count === rightRow.action_count
      && leftRow.classes === rightRow.classes;
  });
}

async function readDetailState(page) {
  return page.locator("#detail").evaluate(panel => ({
    detail_type: String(panel.getAttribute("data-detail-type") || "").trim(),
    card_id: String(panel.getAttribute("data-detail-card-id") || "").trim(),
    session_id: String(panel.getAttribute("data-detail-session-id") || "").trim(),
    viewer: String(panel.getAttribute("data-detail-viewer") || "").trim(),
    title: String(panel.querySelector(".detail-title, .detail-header h1, .detail-header h2")?.textContent || "").trim()
  }));
}

async function closeDetail(page, timeoutMs) {
  if (!await page.locator(".detail-panel.is-open").count()) {
    return;
  }
  await page.evaluate(() => window.PuckyHandleAndroidBack && window.PuckyHandleAndroidBack());
  await page.locator(".detail-panel.is-open").waitFor({ state: "hidden", timeout: timeoutMs });
}

async function clickSelector(page, selector, timeoutMs) {
  await page.locator(selector).first().waitFor({ state: "visible", timeout: timeoutMs });
  await page.evaluate(selectorValue => {
    const target = document.querySelector(selectorValue);
    if (!(target instanceof HTMLElement)) {
      throw new Error(`Missing clickable target for ${selectorValue}`);
    }
    target.click();
  }, selector);
}

async function stableCardSelector(page, selector, timeoutMs) {
  const trigger = page.locator(selector).first();
  await trigger.waitFor({ state: "visible", timeout: timeoutMs });
  const target = await trigger.evaluate(node => {
    const article = node.closest("article.card");
    return {
      action: String(node.getAttribute("data-card-action") || "").trim(),
      session_id: String(article?.getAttribute("data-card-session-id") || "").trim(),
      card_id: String(article?.getAttribute("data-card-id") || "").trim(),
      is_card_body: node.classList.contains("card-body")
    };
  });
  if (target.action && (target.session_id || target.card_id)) {
    return target.session_id
      ? `article.card[data-card-session-id="${cssString(target.session_id)}"] [data-card-action="${cssString(target.action)}"]`
      : `article.card[data-card-id="${cssString(target.card_id)}"] [data-card-action="${cssString(target.action)}"]`;
  }
  if (target.is_card_body && (target.session_id || target.card_id)) {
    return target.session_id
      ? `article.card[data-card-session-id="${cssString(target.session_id)}"] .card-body`
      : `article.card[data-card-id="${cssString(target.card_id)}"] .card-body`;
  }
  return selector;
}

async function openAndReadDetail(page, selector, timeoutMs) {
  const targetSelector = await stableCardSelector(page, selector, timeoutMs);
  await clickSelector(page, targetSelector, timeoutMs);
  await page.locator(".detail-panel.is-open").waitFor({ state: "visible", timeout: timeoutMs });
  const detail = await readDetailState(page);
  await closeDetail(page, timeoutMs);
  return detail;
}

async function toggleAndReadAudioState(page, selector, timeoutMs) {
  const trigger = page.locator(selector).first();
  await trigger.waitFor({ state: "visible", timeout: timeoutMs });
  const target = await trigger.evaluate(button => {
    const article = button.closest("article.card");
    return {
      card_id: String(article?.getAttribute("data-card-id") || "").trim(),
      session_id: String(article?.getAttribute("data-card-session-id") || "").trim(),
      title: String(article?.querySelector(".title")?.textContent || "").trim()
    };
  });
  assert(target.card_id || target.session_id, "Audio target did not resolve to a canonical card identity");
  const targetSelector = target.session_id
    ? `article.card[data-card-session-id="${cssString(target.session_id)}"] [data-card-action="audio"]`
    : `article.card[data-card-id="${cssString(target.card_id)}"] [data-card-action="audio"]`;
  await clickSelector(page, targetSelector, timeoutMs);
  await page.waitForFunction(
    selectorValue => Boolean(document.querySelector(selectorValue)?.classList.contains("is-playing")),
    targetSelector,
    { timeout: timeoutMs }
  );
  const playing = await page.locator(targetSelector).evaluate(button => ({
    classes: String(button.className || "").trim(),
    aria_label: String(button.getAttribute("aria-label") || "").trim()
  }));
  await clickSelector(page, targetSelector, timeoutMs);
  await page.waitForFunction(
    selectorValue => {
      const button = document.querySelector(selectorValue);
      return !!button && !button.classList.contains("is-playing");
    },
    targetSelector,
    { timeout: timeoutMs }
  );
  return {
    ...target,
    ...playing,
    playing: true
  };
}

async function clickLightTile(page, route, timeoutMs) {
  const tile = page.locator(`.light-app-tile[data-route="${route}"]`);
  await tile.waitFor({ state: "visible", timeout: timeoutMs });
  await tile.click();
}

async function backToLightHome(page, timeoutMs) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    if (await page.locator(".light-shell[data-light-route=\"home\"]").count()) {
      return;
    }
    await page.evaluate(() => window.PuckyHandleAndroidBack && window.PuckyHandleAndroidBack());
    await page.waitForTimeout(200);
  }
  await page.locator(".light-shell[data-light-route=\"home\"]").waitFor({ state: "visible", timeout: timeoutMs });
}

async function main() {
  const config = parseArgs(process.argv.slice(2));
  ensureDir(config.reportDir);

  const browser = await chromium.launch({ executablePath: resolveChromePath(), headless: true });
  const context = await browser.newContext({ viewport: VIEWPORT, screen: VIEWPORT, hasTouch: true, isMobile: true });
  const lightPage = await context.newPage();
  const darkFeedPage = await context.newPage();
  const darkMeetingsPage = await context.newPage();

  attachPageLogging(lightPage, path.join(config.reportDir, "light-page-console.log"));
  attachPageLogging(darkFeedPage, path.join(config.reportDir, "dark-feed-console.log"));
  attachPageLogging(darkMeetingsPage, path.join(config.reportDir, "dark-meetings-console.log"));

  const screenshots = {};
  try {
    await Promise.all([
      lightPage.goto(config.lightUrl, { waitUntil: "domcontentloaded", timeout: config.timeoutMs }),
      darkFeedPage.goto(config.darkFeedUrl, { waitUntil: "domcontentloaded", timeout: config.timeoutMs }),
      darkMeetingsPage.goto(config.darkMeetingsUrl, { waitUntil: "domcontentloaded", timeout: config.timeoutMs })
    ]);

    await lightPage.locator(".light-shell[data-light-route=\"home\"] .light-app-grid").waitFor({ state: "visible", timeout: config.timeoutMs });
    await waitForCanonicalPort(darkFeedPage, "Home", config.timeoutMs);
    await waitForCanonicalPort(darkMeetingsPage, "Meetings", config.timeoutMs);

    screenshots.home = await saveScreenshot(lightPage, config.reportDir, "01-light-home");
    screenshots.directDarkFeed = await saveScreenshot(darkFeedPage, config.reportDir, "02-direct-dark-feed");
    screenshots.directDarkMeetings = await saveScreenshot(darkMeetingsPage, config.reportDir, "03-direct-dark-meetings");

    await clickLightTile(lightPage, "inbox", config.timeoutMs);
    await waitForCanonicalPort(lightPage, "Home", config.timeoutMs);
    assert(await lightPage.locator(".light-shell").count() === 0, "Light-launched Inbox should not render inside .light-shell");
    assert(await lightPage.locator(".app-shell[data-theme=\"dark\"]").count() === 1, "Light-launched Inbox should force the canonical dark theme");
    const darkFeedRows = await extractCardRows(darkFeedPage, ".card-wrap article.card");
    const inboxRows = await extractCardRows(lightPage, ".card-wrap article.card");
    assert(rowsMatch(darkFeedRows, inboxRows), "Light-launched Inbox cards did not exactly match direct dark feed cards");
    await lightPage.locator(".page-tabs .tab.is-active[aria-label=\"Home\"]").click();
    await lightPage.locator("#routeTray .route-tray-shell").waitFor({ state: "visible", timeout: config.timeoutMs });
    screenshots.inbox = await saveScreenshot(lightPage, config.reportDir, "04-light-launched-inbox-dark");
    await lightPage.locator(".page-tabs .tab.is-active[aria-label=\"Home\"]").click();
    await lightPage.locator("#routeTray .route-tray-shell").waitFor({ state: "hidden", timeout: config.timeoutMs });

    const darkFeedAudioState = await toggleAndReadAudioState(darkFeedPage, "[data-card-action=\"audio\"]", config.timeoutMs);
    const lightInboxAudioState = await toggleAndReadAudioState(lightPage, "[data-card-action=\"audio\"]", config.timeoutMs);
    assert(JSON.stringify(lightInboxAudioState) === JSON.stringify(darkFeedAudioState), "Inbox audio playback behavior diverged from direct dark feed");

    const pageOrAttachmentSelector = "[data-card-action=\"page\"], [data-card-action=\"attachment\"]";
    assert(await darkFeedPage.locator(pageOrAttachmentSelector).count() > 0, "Direct dark feed did not expose a page or attachment action");
    assert(await lightPage.locator(pageOrAttachmentSelector).count() > 0, "Light-launched Inbox did not expose a page or attachment action");
    const darkFeedPageDetail = await openAndReadDetail(darkFeedPage, pageOrAttachmentSelector, config.timeoutMs);
    const lightInboxPageDetail = await openAndReadDetail(lightPage, pageOrAttachmentSelector, config.timeoutMs);
    assert(JSON.stringify(lightInboxPageDetail) === JSON.stringify(darkFeedPageDetail), "Inbox page or attachment detail diverged from direct dark feed");

    await backToLightHome(lightPage, config.timeoutMs);
    screenshots.backHome = await saveScreenshot(lightPage, config.reportDir, "05-back-home");

    await clickLightTile(lightPage, "meetings", config.timeoutMs);
    await waitForCanonicalPort(lightPage, "Meetings", config.timeoutMs);
    assert(await lightPage.locator(".light-shell").count() === 0, "Light-launched Meetings should not render inside .light-shell");
    assert(await lightPage.locator(".app-shell[data-theme=\"dark\"]").count() === 1, "Light-launched Meetings should force the canonical dark theme");
    assert(await lightPage.locator(".light-page-title").count() === 0, "Light-launched Meetings should not render a duplicate light page title");
    assert(await lightPage.locator(".meetings-title").count() === 1, "Light-launched Meetings should render the canonical meetings header once");
    const darkMeetingsRows = await extractCardRows(darkMeetingsPage, ".meetings-page .card-wrap article.card");
    const lightMeetingsRows = await extractCardRows(lightPage, ".meetings-page .card-wrap article.card");
    assert(rowsMatch(darkMeetingsRows, lightMeetingsRows), "Light-launched Meetings rows did not exactly match direct dark meetings");
    screenshots.meetings = await saveScreenshot(lightPage, config.reportDir, "06-light-launched-meetings-dark");

    const darkMeetingDetail = await openAndReadDetail(darkMeetingsPage, ".card-meeting-list .card-body", config.timeoutMs);
    const lightMeetingDetail = await openAndReadDetail(lightPage, ".card-meeting-list .card-body", config.timeoutMs);
    assert(JSON.stringify(lightMeetingDetail) === JSON.stringify(darkMeetingDetail), "Meetings detail diverged from direct dark meetings");

    const darkMeetingAudio = await openAndReadDetail(darkMeetingsPage, ".card-meeting-list [data-card-action=\"audio\"]", config.timeoutMs);
    const lightMeetingAudio = await openAndReadDetail(lightPage, ".card-meeting-list [data-card-action=\"audio\"]", config.timeoutMs);
    assert(JSON.stringify(lightMeetingAudio) === JSON.stringify(darkMeetingAudio), "Meetings audio detail diverged from direct dark meetings");

    const summary = {
      schema: "pucky.light_canonical_dark_ports_proof.v1",
      ok: true,
      light_url: config.lightUrl,
      dark_feed_url: config.darkFeedUrl,
      dark_meetings_url: config.darkMeetingsUrl,
      feed_card_count: inboxRows.length,
      meetings_card_count: lightMeetingsRows.length,
      comparisons: {
        inbox_matches_direct_dark_feed: true,
        meetings_match_direct_dark_meetings: true,
        inbox_audio_state: lightInboxAudioState,
        inbox_page_detail: lightInboxPageDetail,
        meetings_detail: lightMeetingDetail,
        meetings_audio_detail: lightMeetingAudio
      },
      screenshots
    };
    writeJsonFile(path.join(config.reportDir, "summary.json"), summary);
    console.log(JSON.stringify(summary, null, 2));
  } catch (error) {
    writeAutomationError(config.reportDir, error);
    throw error;
  } finally {
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
