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
    lightUrl: process.env.PUCKY_LIGHT_NATIVE_URL || DEFAULT_LIGHT_URL,
    darkFeedUrl: process.env.PUCKY_DARK_FEED_URL || DEFAULT_DARK_FEED_URL,
    darkMeetingsUrl: process.env.PUCKY_DARK_MEETINGS_URL || DEFAULT_DARK_MEETINGS_URL,
    reportDir: path.resolve("artifacts", "light-native-ports"),
    timeoutMs: 30000
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

async function waitForLightHome(page, timeoutMs) {
  await page.waitForFunction(
    () => {
      const shell = document.querySelector(".light-shell[data-light-route=\"home\"]");
      const grid = shell?.querySelector(".light-app-grid");
      const appShell = document.querySelector(".app-shell");
      const voice = document.querySelector("#voiceStatus");
      return !!shell && !!grid && appShell?.getAttribute("data-theme") === "light" && !!voice;
    },
    undefined,
    { timeout: timeoutMs }
  );
}

async function waitForLightRoute(page, route, selector, timeoutMs) {
  await page.waitForFunction(
    ({ expectedRoute, requiredSelector }) => {
      const shell = document.querySelector(`.light-shell[data-light-route="${expectedRoute}"]`);
      const appShell = document.querySelector(".app-shell");
      const target = requiredSelector ? shell?.querySelector(requiredSelector) : shell;
      const headerTitle = shell?.querySelector(".light-page-title");
      const voice = document.querySelector("#voiceStatus");
      return !!shell
        && !!target
        && !!headerTitle
        && !!voice
        && appShell?.getAttribute("data-theme") === "light";
    },
    { expectedRoute: route, requiredSelector: selector },
    { timeout: timeoutMs }
  );
}

async function waitForDarkRoute(page, route, selector, timeoutMs) {
  await page.waitForFunction(
    ({ expectedRoute, requiredSelector }) => {
      const routeShell = document.querySelector(`.light-shell[data-light-route="${expectedRoute}"]`);
      const headerTitle = routeShell?.querySelector(".light-page-title");
      const voice = document.querySelector("#voiceStatus");
      const shell = document.querySelector(".app-shell");
      const target = requiredSelector ? document.querySelector(requiredSelector) : document.body;
      return shell?.getAttribute("data-theme") === "dark" && !!target && !!headerTitle && !!voice;
    },
    { expectedRoute: route, requiredSelector: selector },
    { timeout: timeoutMs }
  );
}

async function readHiddenState(page, selector) {
  const locator = page.locator(selector);
  if (!await locator.count()) {
    return true;
  }
  return locator.evaluate(node => Boolean(node.hidden) || getComputedStyle(node).display === "none" || getComputedStyle(node).visibility === "hidden");
}

async function assertHidden(page, selector, message) {
  const hidden = await readHiddenState(page, selector);
  assert(hidden, message);
}

async function readLightHeaderTitle(page) {
  return normalizeText(await page.locator(".light-shell .light-page-title").first().textContent());
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

async function readCardStyle(page, selector) {
  return page.locator(selector).first().evaluate(node => {
    const style = getComputedStyle(node);
    return {
      backgroundColor: style.backgroundColor,
      borderColor: style.borderColor,
      boxShadow: style.boxShadow,
      color: style.color
    };
  });
}

function assertMeaningfulRows(label, rows) {
  assert(rows.length > 0, `${label} rendered no cards`);
  const meaningfulRows = rows.filter(row => Boolean(row.title || row.preview || row.timestamp));
  assert(
    meaningfulRows.length > 0,
    `${label} cards rendered, but they did not include visible title, preview, or timestamp content`
  );
}

async function readScrollReachability(page, containerSelector, rowsSelector) {
  return page.evaluate(({ containerSel, rowSel }) => {
    const explicitContainer = document.querySelector(containerSel);
    const scrollingElement = document.scrollingElement instanceof HTMLElement
      ? document.scrollingElement
      : document.documentElement instanceof HTMLElement
        ? document.documentElement
        : null;
    const explicitScrollable = explicitContainer instanceof HTMLElement
      ? explicitContainer.scrollHeight > explicitContainer.clientHeight + 1
      : false;
    const container = explicitContainer instanceof HTMLElement
      ? explicitScrollable
        ? explicitContainer
        : scrollingElement || explicitContainer
      : scrollingElement;
    if (!(container instanceof HTMLElement)) {
      return {
        found: false,
        reason: `Missing container ${containerSel}`
      };
    }
    const rows = Array.from(document.querySelectorAll(rowSel || "*"));
    container.scrollTop = 0;
    const scrollHeight = Number(container.scrollHeight.toFixed(2));
    const clientHeight = Number(container.clientHeight.toFixed(2));
    const canScroll = scrollHeight > clientHeight + 1;
    container.scrollTo(0, container.scrollHeight);
    const bottomTop = Number(container.scrollTop.toFixed(2));
    const maxScrollTop = Math.max(0, scrollHeight - clientHeight);
    const reachedBottom = canScroll ? Math.abs(bottomTop - maxScrollTop) <= 1 : true;
    container.scrollTo(0, 0);
    const returnedTop = Number(container.scrollTop.toFixed(2));
    return {
      found: true,
      row_count: rows.length,
      scroll_height: scrollHeight,
      client_height: clientHeight,
      can_scroll: canScroll,
      reached_bottom: reachedBottom,
      returned_top: returnedTop,
      max_scroll_top: maxScrollTop
    };
  }, { containerSel: containerSelector, rowSel: rowsSelector });
}

async function readUnreadMarkerStyle(page) {
  return page.evaluate(() => {
    const marker = document.querySelector(".light-shell[data-light-route=\"inbox\"] .identity.is-unread, .light-shell[data-light-route=\"inbox\"] .action.is-unread");
    if (!(marker instanceof HTMLElement)) {
      return null;
    }
    const style = getComputedStyle(marker);
    const scratch = document.createElement("span");
    scratch.className = marker.classList.contains("identity") ? "identity is-read" : "action is-read";
    scratch.style.position = "absolute";
    scratch.style.visibility = "hidden";
    document.body.append(scratch);
    const readStyle = getComputedStyle(scratch);
    const result = {
      color: style.color,
      backgroundColor: style.backgroundColor,
      boxShadow: style.boxShadow,
      readColor: readStyle.color
    };
    scratch.remove();
    return result;
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

async function readDetailVisual(page) {
  return page.locator("#detail .detail-shell").evaluate(node => {
    const style = getComputedStyle(node);
    return {
      backgroundColor: style.backgroundColor,
      color: style.color,
      borderColor: style.borderColor
    };
  });
}

function assertDetailParity(label, left, right) {
  assert(left.detail_type === right.detail_type, `${label} detail type diverged`);
  assert(left.card_id === right.card_id, `${label} card id diverged`);
  assert(left.session_id === right.session_id, `${label} session id diverged`);
  assert(left.viewer === right.viewer, `${label} viewer diverged`);
  assert(normalizeText(left.title) === normalizeText(right.title), `${label} title diverged`);
}

async function closeDetail(page, timeoutMs) {
  if (!await page.locator(".detail-panel.is-open").count()) {
    return;
  }
  await page.evaluate(() => window.PuckyHandleAndroidBack && window.PuckyHandleAndroidBack());
  await page.locator(".detail-panel.is-open").waitFor({ state: "hidden", timeout: timeoutMs });
}

async function openAudioControls(page, selector, timeoutMs) {
  const trigger = page.locator(selector).first();
  await trigger.waitFor({ state: "visible", timeout: timeoutMs });
  const target = await trigger.evaluate(node => {
    const article = node.closest("article.card");
    return {
      session_id: String(article?.getAttribute("data-card-session-id") || "").trim(),
      card_id: String(article?.getAttribute("data-card-id") || "").trim()
    };
  });
  assert(target.card_id || target.session_id, "Audio controls target did not resolve to a canonical card identity");
  const detailSelector = target.session_id
    ? `article.card[data-card-session-id="${cssString(target.session_id)}"] .card-body`
    : `article.card[data-card-id="${cssString(target.card_id)}"] .card-body`;
  await clickSelector(page, detailSelector, timeoutMs);
  await page.locator(".detail-panel.is-open").waitFor({ state: "visible", timeout: timeoutMs });
  const before = await readDetailState(page);
  const controls = page.locator("#detail .detail-audio-action").filter({ hasText: "Open audio controls" }).first();
  const controlCount = await controls.count();
  assert(controlCount > 0, "Card detail did not expose an \"Open audio controls\" action");
  await controls.click();
  await page.waitForFunction(() => {
    const detail = document.getElementById("detail");
    return String(detail?.getAttribute("data-detail-type") || "") === "audio";
  }, { timeout: timeoutMs });
  const after = await readDetailState(page);
  await closeDetail(page, timeoutMs);
  return {
    before,
    after
  };
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

async function openAndInspectDetail(page, selector, timeoutMs) {
  const targetSelector = await stableCardSelector(page, selector, timeoutMs);
  await clickSelector(page, targetSelector, timeoutMs);
  await page.locator(".detail-panel.is-open").waitFor({ state: "visible", timeout: timeoutMs });
  return {
    state: await readDetailState(page),
    visual: await readDetailVisual(page)
  };
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
    await page.waitForTimeout(250);
  }
  await page.locator(".light-shell[data-light-route=\"home\"]").waitFor({ state: "visible", timeout: timeoutMs });
}

async function compareOptionalAttachmentDetail(lightPage, darkPage, timeoutMs) {
  const selector = "[data-card-action=\"page\"], [data-card-action=\"attachment\"]";
  const darkCount = await darkPage.locator(selector).count();
  const lightCount = await lightPage.locator(selector).count();
  if (!darkCount || !lightCount) {
    return { checked: false, reason: "No page or attachment action was available in the current feed sample." };
  }
  const darkDetail = await openAndInspectDetail(darkPage, selector, timeoutMs);
  const lightDetail = await openAndInspectDetail(lightPage, selector, timeoutMs);
  assertDetailParity("Inbox page/attachment", darkDetail.state, lightDetail.state);
  assert(lightDetail.visual.backgroundColor !== darkDetail.visual.backgroundColor, "Inbox page or attachment detail did not switch to light styling");
  await closeDetail(darkPage, timeoutMs);
  await closeDetail(lightPage, timeoutMs);
  return {
    checked: true,
    dark: darkDetail,
    light: lightDetail
  };
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

    await waitForLightHome(lightPage, config.timeoutMs);
    await waitForDarkRoute(darkFeedPage, "inbox", ".card-wrap article.card", config.timeoutMs);
    await waitForDarkRoute(darkMeetingsPage, "meetings", ".meetings-page", config.timeoutMs);

    assert(await lightPage.locator(".light-app-tile[data-route=\"notifications\"]").count() === 0, "Light home should not include a Notifications tile");
    assert(await lightPage.locator(".light-digest").count() === 0, "Light home should not render the removed digest section");
    assert(await lightPage.locator("#voiceStatus").count() === 1, "Light home should keep the real top-right voice status indicator");

    screenshots.home = await saveScreenshot(lightPage, config.reportDir, "01-light-home");
    screenshots.directDarkFeed = await saveScreenshot(darkFeedPage, config.reportDir, "02-direct-dark-feed");
    screenshots.directDarkMeetings = await saveScreenshot(darkMeetingsPage, config.reportDir, "03-direct-dark-meetings");

    const darkFeedRows = await extractCardRows(darkFeedPage, ".card-wrap article.card");
    const darkFeedCardStyle = await readCardStyle(darkFeedPage, ".card-wrap article.card");
    assertMeaningfulRows("Dark Feed", darkFeedRows);
    const darkFeedScroll = await readScrollReachability(
      darkFeedPage,
      ".light-shell[data-light-route=\"inbox\"] .light-canonical-port-surface",
      ".card-wrap article.card"
    );
    assert(darkFeedScroll.found, "Dark Feed scroll container was not found");
    assert(darkFeedScroll.can_scroll || darkFeedRows.length <= 3, "Dark Feed did not expose enough content to scroll end-to-end");
    assert(darkFeedScroll.reached_bottom, "Dark Feed could not reach the card list bottom");
    assert(darkFeedScroll.returned_top === 0, "Dark Feed did not return to the top of the list after resetting");

    await clickLightTile(lightPage, "inbox", config.timeoutMs);
    await waitForLightRoute(lightPage, "inbox", ".card-wrap article.card", config.timeoutMs);
    assert(await readLightHeaderTitle(lightPage) === "Inbox", "Light Inbox did not render the normal light header title");
    assert(await lightPage.locator(".light-back-button").count() === 1, "Light Inbox should expose the normal back button");
    assert(await lightPage.locator("#voiceStatus").count() === 1, "Light Inbox should keep the real voice status indicator");
    await assertHidden(lightPage, "#pageTabs", "Light Inbox should hide the canonical top tabs");
    await assertHidden(lightPage, "#routeTray", "Light Inbox should hide the canonical route tray");
    const inboxRows = await extractCardRows(lightPage, ".light-shell[data-light-route=\"inbox\"] .card-wrap article.card");
    assertMeaningfulRows("Light Inbox", inboxRows);
    assert(rowsMatch(darkFeedRows, inboxRows), "Light Inbox cards did not match the canonical dark Home feed rows");
    const lightInboxCardStyle = await readCardStyle(lightPage, ".light-shell[data-light-route=\"inbox\"] .card-wrap article.card");
    assert(lightInboxCardStyle.backgroundColor !== darkFeedCardStyle.backgroundColor, "Light Inbox cards did not switch to a light surface style");
    const lightInboxScroll = await readScrollReachability(
      lightPage,
      ".light-shell[data-light-route=\"inbox\"] .light-canonical-port-surface",
      ".light-shell[data-light-route=\"inbox\"] .card-wrap article.card"
    );
    assert(lightInboxScroll.found, "Light Inbox scroll container was not found");
    assert(lightInboxScroll.can_scroll || inboxRows.length <= 3, "Light Inbox did not expose enough content to scroll end-to-end");
    assert(lightInboxScroll.reached_bottom, "Light Inbox could not reach the card list bottom");
    assert(lightInboxScroll.returned_top === 0, "Light Inbox did not return to the top of the list after resetting");
    const unreadMarker = await readUnreadMarkerStyle(lightPage);
    if (unreadMarker) {
      assert(unreadMarker.backgroundColor === "rgba(0, 0, 0, 0)" || unreadMarker.backgroundColor === "transparent", "Light Inbox unread icon should not keep the old background chip");
      assert(unreadMarker.color !== unreadMarker.readColor, "Light Inbox unread icon should keep a distinct emphasized treatment");
    }
    screenshots.inboxList = await saveScreenshot(lightPage, config.reportDir, "04-light-inbox-list");

    const darkFeedDetail = await openAndInspectDetail(darkFeedPage, ".card-wrap article.card .card-body", config.timeoutMs);
    const lightInboxDetail = await openAndInspectDetail(lightPage, ".light-shell[data-light-route=\"inbox\"] .card-wrap article.card .card-body", config.timeoutMs);
    assertDetailParity("Inbox transcript/detail", darkFeedDetail.state, lightInboxDetail.state);
    assert(lightInboxDetail.visual.backgroundColor !== darkFeedDetail.visual.backgroundColor, "Light Inbox detail did not switch to light styling");
    screenshots.inboxDetail = await saveScreenshot(lightPage, config.reportDir, "05-light-inbox-detail");
    await closeDetail(darkFeedPage, config.timeoutMs);
    await closeDetail(lightPage, config.timeoutMs);

    const inboxAttachmentDetail = await compareOptionalAttachmentDetail(lightPage, darkFeedPage, config.timeoutMs);
    const darkFeedAudioState = await toggleAndReadAudioState(darkFeedPage, "[data-card-action=\"audio\"]", config.timeoutMs);
    const lightInboxAudioState = await toggleAndReadAudioState(lightPage, ".light-shell[data-light-route=\"inbox\"] [data-card-action=\"audio\"]", config.timeoutMs);
    assert(JSON.stringify(lightInboxAudioState) === JSON.stringify(darkFeedAudioState), "Light Inbox audio playback behavior diverged from the canonical dark Home feed");
    const darkFeedAudioControls = await openAudioControls(darkFeedPage, "[data-card-action=\"audio\"]", config.timeoutMs);
    const lightInboxAudioControls = await openAudioControls(
      lightPage,
      ".light-shell[data-light-route=\"inbox\"] [data-card-action=\"audio\"]",
      config.timeoutMs
    );
    assert(darkFeedAudioControls.after.detail_type === "audio", "Dark Feed did not enter audio detail after clicking Open audio controls");
    assert(lightInboxAudioControls.after.detail_type === "audio", "Light Inbox did not enter audio detail after clicking Open audio controls");
    assert(
      JSON.stringify(lightInboxAudioControls.before) === JSON.stringify(darkFeedAudioControls.before),
      "Audio controls source card differed between dark Feed and light Inbox"
    );

    await backToLightHome(lightPage, config.timeoutMs);

    let lightMeetingsRows = [];
    let darkMeetingsScroll = { checked: false, reason: "No meetings cards were available in the dark route sample." };
    let lightMeetingsDetail = null;
    let lightMeetingsAudio = null;
    let meetingsRowsMatch = false;
    const darkMeetingsCount = await darkMeetingsPage.locator(".meetings-page .card-wrap article.card").count();
    if (darkMeetingsCount > 0) {
      const darkMeetingsRows = await extractCardRows(darkMeetingsPage, ".meetings-page .card-wrap article.card");
      const darkMeetingsCardStyle = await readCardStyle(darkMeetingsPage, ".meetings-page .card-wrap article.card");
      assertMeaningfulRows("Dark Meetings", darkMeetingsRows);
      const rawDarkMeetingsScroll = await readScrollReachability(
        darkMeetingsPage,
        ".light-shell[data-light-route=\"meetings\"] .light-canonical-port-surface",
        ".meetings-page .card-wrap article.card"
      );
      assert(rawDarkMeetingsScroll.found, "Dark Meetings scroll container was not found");
      if (rawDarkMeetingsScroll.can_scroll) {
        darkMeetingsScroll = { checked: true, ...rawDarkMeetingsScroll };
        assert(darkMeetingsScroll.reached_bottom, "Dark Meetings could not reach the meeting list bottom");
        assert(darkMeetingsScroll.returned_top === 0, "Dark Meetings did not return to the top of the list after resetting");
      } else {
        darkMeetingsScroll = {
          checked: false,
          reason: "Dark Meetings did not expose enough content to scroll end-to-end",
          ...rawDarkMeetingsScroll
        };
      }

      await clickLightTile(lightPage, "meetings", config.timeoutMs);
      await waitForLightRoute(lightPage, "meetings", ".meetings-page", config.timeoutMs);
      assert(await readLightHeaderTitle(lightPage) === "Meetings", "Light Meetings did not render the normal light header title");
      assert(await lightPage.locator(".light-back-button").count() === 1, "Light Meetings should expose the normal back button");
      assert(await lightPage.locator("#voiceStatus").count() === 1, "Light Meetings should keep the real voice status indicator");
      await assertHidden(lightPage, "#pageTabs", "Light Meetings should hide the canonical top tabs");
      await assertHidden(lightPage, "#routeTray", "Light Meetings should hide the canonical route tray");
      assert(await lightPage.locator(".light-shell[data-light-route=\"meetings\"] .meetings-header").count() === 0, "Light Meetings should not render a duplicate canonical meetings header");
      await lightPage.waitForFunction(
        selector => document.querySelectorAll(selector).length > 0,
        ".light-shell[data-light-route=\"meetings\"] .meetings-page .card-wrap article.card",
        { timeout: config.timeoutMs }
      );
      lightMeetingsRows = await extractCardRows(lightPage, ".light-shell[data-light-route=\"meetings\"] .meetings-page .card-wrap article.card");
      assertMeaningfulRows("Light Meetings", lightMeetingsRows);
      meetingsRowsMatch = rowsMatch(darkMeetingsRows, lightMeetingsRows);
      assert(meetingsRowsMatch, "Light Meetings rows did not match the canonical dark meetings list");
      const lightMeetingsCardStyle = await readCardStyle(lightPage, ".light-shell[data-light-route=\"meetings\"] .meetings-page .card-wrap article.card");
      assert(lightMeetingsCardStyle.backgroundColor !== darkMeetingsCardStyle.backgroundColor, "Light Meetings cards did not switch to a light surface style");
      screenshots.meetingsList = await saveScreenshot(lightPage, config.reportDir, "06-light-meetings-list");

      const darkMeetingsDetail = await openAndInspectDetail(darkMeetingsPage, ".card-meeting-list .card-body", config.timeoutMs);
      lightMeetingsDetail = await openAndInspectDetail(lightPage, ".light-shell[data-light-route=\"meetings\"] .card-meeting-list .card-body", config.timeoutMs);
      assertDetailParity("Meetings detail", darkMeetingsDetail.state, lightMeetingsDetail.state);
      assert(lightMeetingsDetail.visual.backgroundColor !== darkMeetingsDetail.visual.backgroundColor, "Light Meetings detail did not switch to light styling");
      screenshots.meetingsDetail = await saveScreenshot(lightPage, config.reportDir, "07-light-meetings-detail");
      await closeDetail(darkMeetingsPage, config.timeoutMs);
      await closeDetail(lightPage, config.timeoutMs);

      assert(await darkMeetingsPage.locator(".card-meeting-list [data-card-action=\"audio\"]").count() > 0, "Canonical dark Meetings did not expose a meeting audio action");
      assert(await lightPage.locator(".light-shell[data-light-route=\"meetings\"] .card-meeting-list [data-card-action=\"audio\"]").count() > 0, "Light Meetings did not expose a meeting audio action");
      const darkMeetingsAudio = await openAndInspectDetail(darkMeetingsPage, ".card-meeting-list [data-card-action=\"audio\"]", config.timeoutMs);
      lightMeetingsAudio = await openAndInspectDetail(lightPage, ".light-shell[data-light-route=\"meetings\"] .card-meeting-list [data-card-action=\"audio\"]", config.timeoutMs);
      assertDetailParity("Meetings audio", darkMeetingsAudio.state, lightMeetingsAudio.state);
      assert(lightMeetingsAudio.visual.backgroundColor !== darkMeetingsAudio.visual.backgroundColor, "Light Meetings audio detail did not switch to light styling");
      screenshots.meetingsAudio = await saveScreenshot(lightPage, config.reportDir, "08-light-meetings-audio");
      await closeDetail(darkMeetingsPage, config.timeoutMs);
      await closeDetail(lightPage, config.timeoutMs);
    }

    await backToLightHome(lightPage, config.timeoutMs);
    screenshots.backHome = await saveScreenshot(lightPage, config.reportDir, "09-back-home");

    const summary = {
      schema: "pucky.light_native_ports_proof.v1",
      ok: true,
      light_url: config.lightUrl,
      dark_feed_url: config.darkFeedUrl,
      dark_meetings_url: config.darkMeetingsUrl,
      feed_card_count: inboxRows.length,
      meetings_card_count: lightMeetingsRows.length,
      inbox_unread_marker: unreadMarker,
      scrollability: {
        dark_feed: darkFeedScroll,
        light_inbox: lightInboxScroll,
        dark_meetings: darkMeetingsScroll
      },
      comparisons: {
        inbox_rows_match_dark_feed: true,
        meetings_rows_match_dark_meetings: meetingsRowsMatch,
        inbox_detail: lightInboxDetail,
        inbox_attachment_detail: inboxAttachmentDetail,
        inbox_audio_state: lightInboxAudioState,
        inbox_audio_controls: {
          dark_feed: darkFeedAudioControls,
          light_inbox: lightInboxAudioControls
        },
        meetings_detail: lightMeetingsDetail,
        meetings_audio: lightMeetingsAudio
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
