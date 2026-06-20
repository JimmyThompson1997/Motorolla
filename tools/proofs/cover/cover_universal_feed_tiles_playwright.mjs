import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright-core";

import {
  ensureDir,
  resolveChromePath,
  writeAutomationError,
  writeJsonFile,
} from "../../support/cover_shared.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const RESULT_SCHEMA = "pucky.universal_feed_tiles_browser_proof.v1";
const DEFAULT_BASE_URL = process.env.PUCKY_UNIVERSAL_FEED_TILES_BASE_URL || "https://pucky.fly.dev";
const MOBILE_VIEWPORT = { width: 430, height: 932 };
const DESKTOP_VIEWPORT = { width: 1440, height: 980 };
const DETAIL_SELECTOR = "#detail";
const LEGACY_WEB_TOKEN_ENV = "PUCKY_" + "WEB_UI_TOKEN";
const LEGACY_WEB_TOKEN_PLACEHOLDER = ["Paste ", "PUCKY_", "WEB_UI_TOKEN"].join("");
const ROUTES = [
  {
    surface: "Notes",
    route: "notes",
    theme: "light",
    primarySelector: ".light-note-row",
    emptySelector: ".light-empty-state",
    viewportModes: ["mobile", "desktop"],
    detail: {
      openerSelector: ".light-note-row",
      expectedRoute: "note-detail",
    },
  },
  {
    surface: "Meeting Notes",
    route: "meeting-notes",
    theme: "light",
    primarySelector: ".light-graph-row",
    emptySelector: ".light-empty-state",
    viewportModes: ["mobile", "desktop"],
    detail: {
      openerSelector: ".light-graph-row",
      expectedRoute: "meeting-note-detail",
    },
  },
  {
    surface: "Reminders",
    route: "reminders",
    theme: "light",
    primarySelector: ".light-reminder-row",
    emptySelector: ".light-empty-state",
    viewportModes: ["mobile"],
    detail: {
      openerSelector: ".light-reminder-row",
      expectedRoute: "reminder-detail",
    },
  },
  {
    surface: "Projects",
    route: "projects",
    theme: "light",
    primarySelector: ".light-project-row",
    emptySelector: ".light-empty-state",
    viewportModes: ["mobile", "desktop"],
    detail: {
      openerSelector: ".light-project-row",
      expectedRoute: "project-detail",
    },
  },
  {
    surface: "Inbox",
    route: "inbox",
    theme: "dark",
    primarySelector: ".card-wrap > article.card",
    emptySelector: ".empty, .feed-load-error",
    viewportModes: ["mobile"],
    detail: {
      openerSelector: ".card-wrap > article.card .card-body",
      expectedSelector: `${DETAIL_SELECTOR}[aria-hidden="false"], ${DETAIL_SELECTOR}.is-open`,
    },
  },
  {
    surface: "Meetings",
    route: "meetings",
    theme: "dark",
    primarySelector: ".card.card-meeting-list",
    emptySelector: ".meetings-empty",
    viewportModes: ["mobile"],
    detail: {
      openerSelector: ".card.card-meeting-list .card-body",
      expectedSelector: `${DETAIL_SELECTOR}[aria-hidden="false"], ${DETAIL_SELECTOR}.is-open`,
    },
  },
];

function resolveApiToken() {
  const webToken = String(process.env[LEGACY_WEB_TOKEN_ENV] || "").trim();
  if (webToken) {
    return webToken;
  }
  const operatorToken = String(process.env.PUCKY_OPERATOR_TOKEN || "").trim();
  if (operatorToken) {
    return operatorToken;
  }
  return String(process.env.PUCKY_API_TOKEN || "").trim();
}

function timestampSlug() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function parseArgs(argv) {
  const config = {
    baseUrl: DEFAULT_BASE_URL,
    apiToken: resolveApiToken(),
    timeoutMs: 30000,
    headless: true,
    refreshKey: `universal-feed-tiles-${Date.now()}`,
    reportDir: path.resolve(ROOT, ".tmp", "universal-feed-tiles-proof", timestampSlug()),
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = String(argv[index] || "");
    if (arg === "--base-url" && argv[index + 1]) {
      config.baseUrl = String(argv[++index] || config.baseUrl).replace(/\/+$/, "");
    } else if (arg === "--api-token" && argv[index + 1]) {
      config.apiToken = String(argv[++index] || config.apiToken).trim();
    } else if (arg === "--timeout-ms" && argv[index + 1]) {
      config.timeoutMs = Math.max(1000, Number(argv[++index] || config.timeoutMs) || config.timeoutMs);
    } else if (arg === "--report-dir" && argv[index + 1]) {
      config.reportDir = path.resolve(String(argv[++index] || config.reportDir));
    } else if (arg === "--refresh-key" && argv[index + 1]) {
      config.refreshKey = String(argv[++index] || config.refreshKey).trim() || config.refreshKey;
    } else if (arg === "--headed") {
      config.headless = false;
    }
  }
  return config;
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function buildRouteUrl(config, routeConfig) {
  const url = new URL("/ui/pucky/latest/index.html", `${String(config.baseUrl || "").replace(/\/+$/, "")}/`);
  url.searchParams.set("theme", String(routeConfig.theme || "light"));
  url.searchParams.set("route", String(routeConfig.route || "home"));
  url.searchParams.set("reset_nav", "1");
  if (String(config.refreshKey || "").trim()) {
    url.searchParams.set("_pucky_refresh", String(config.refreshKey || "").trim());
  }
  return url.toString();
}

async function fetchManifest(config) {
  const url = new URL("/ui/pucky/latest/manifest.json", `${String(config.baseUrl || "").replace(/\/+$/, "")}/`);
  if (String(config.refreshKey || "").trim()) {
    url.searchParams.set("_pucky_refresh", String(config.refreshKey || "").trim());
  }
  const response = await fetch(url, {
    headers: {
      "Cache-Control": "no-cache, no-store, max-age=0",
      Pragma: "no-cache",
    },
  });
  const payload = await response.json().catch(() => ({}));
  assert(response.ok, `Could not load manifest from ${url.toString()} (${response.status})`);
  return {
    manifest: payload,
    manifestUrl: url.toString(),
  };
}

async function saveScreenshot(page, filePath) {
  ensureDir(path.dirname(filePath));
  await page.screenshot({
    path: filePath,
    fullPage: true,
    animations: "disabled",
    timeout: 120000,
  });
  return filePath;
}

async function waitForRoute(page, route, timeoutMs) {
  await page.waitForFunction(
    expectedRoute => document.querySelector(".light-shell")?.getAttribute("data-light-route") === expectedRoute,
    route,
    { timeout: timeoutMs }
  );
}

async function unlockPreviewIfNeeded(page, apiToken, timeoutMs) {
  const locked = await page.evaluate(() => {
    const title = document.querySelector(".light-empty-state h2");
    const action = document.querySelector(".light-empty-state .light-empty-state-action");
    return String(title?.textContent || "").trim() === "Preview needs api_token"
      && String(action?.textContent || "").trim() === "Unlock web preview";
  });
  if (!locked) {
    return false;
  }
  assert(String(apiToken || "").trim(), "Universal feed tiles proof requires --api-token or a preview token when unlock is needed");
  await page.getByRole("button", { name: "Unlock web preview" }).click();
  await page.getByPlaceholder(LEGACY_WEB_TOKEN_PLACEHOLDER).waitFor({ state: "visible", timeout: timeoutMs });
  await page.getByPlaceholder(LEGACY_WEB_TOKEN_PLACEHOLDER).fill(String(apiToken || "").trim());
  await page.getByRole("button", { name: "Save token" }).click();
  await page.waitForTimeout(250);
  return true;
}

async function waitForSurfaceReady(page, routeConfig, timeoutMs) {
  await waitForRoute(page, routeConfig.route, timeoutMs);
  await unlockPreviewIfNeeded(page, routeConfig.apiToken, timeoutMs);
  await waitForRoute(page, routeConfig.route, timeoutMs);
  await page.waitForFunction(
    ({ primarySelector, emptySelector }) => {
      const primary = document.querySelector(primarySelector);
      const empty = emptySelector ? document.querySelector(emptySelector) : null;
      return Boolean(primary || empty);
    },
    { primarySelector: routeConfig.primarySelector, emptySelector: routeConfig.emptySelector },
    { timeout: timeoutMs }
  );
}

async function scrollList(page) {
  return page.evaluate(() => {
    const candidates = [
      document.getElementById("feed"),
      document.querySelector(".detail-content"),
      document.scrollingElement,
    ].filter(Boolean);
    const target = candidates.find(node => node.scrollHeight - node.clientHeight > 80) || candidates[0] || document.scrollingElement;
    if (!target) {
      return { canScroll: false, target: "" };
    }
    const maxScroll = Math.max(0, target.scrollHeight - target.clientHeight);
    if (maxScroll <= 80) {
      return { canScroll: false, target: target.id || target.className || target.tagName };
    }
    target.scrollTo({ top: Math.min(maxScroll, Math.round(maxScroll * 0.5)), left: 0, behavior: "instant" });
    return {
      canScroll: true,
      target: target.id || target.className || target.tagName,
      maxScroll,
      top: target.scrollTop,
    };
  });
}

async function collectRouteMetrics(page, routeConfig) {
  return page.evaluate(config => {
    function count(selector) {
      return selector ? document.querySelectorAll(selector).length : 0;
    }
    function rectData(selector) {
      const node = document.querySelector(selector);
      if (!node) {
        return null;
      }
      const rect = node.getBoundingClientRect();
      return {
        left: Number(rect.left.toFixed(2)),
        top: Number(rect.top.toFixed(2)),
        width: Number(rect.width.toFixed(2)),
        height: Number(rect.height.toFixed(2)),
      };
    }
    const shell = document.querySelector(".light-shell");
    const header = document.querySelector(".light-page-header");
    const title = document.querySelector(".light-page-title, .light-page-title-detail");
    const feedPage = document.querySelector(".light-feed-page");
    const feedSurface = document.querySelector(".light-feed-surface");
    const firstSection = document.querySelector(".light-feed-section");
    const sectionKeys = [...document.querySelectorAll(".light-feed-section")]
      .map(node => node.getAttribute("data-feed-section") || "")
      .filter(Boolean);
    return {
      routeIdentity: shell?.getAttribute("data-light-route") || "",
      headerPresent: Boolean(header),
      headerText: String(title?.textContent || "").trim(),
      headerMetrics: rectData(".light-page-header"),
      titleMetrics: rectData(".light-page-title, .light-page-title-detail"),
      pageClasses: feedPage ? [...feedPage.classList] : [],
      surfaceClasses: feedSurface ? [...feedSurface.classList] : [],
      firstSectionClasses: firstSection ? [...firstSection.classList] : [],
      sectionKeys,
      scrollMetrics: {
        innerWidth: window.innerWidth,
        innerHeight: window.innerHeight,
        documentScrollWidth: document.documentElement.scrollWidth,
        documentScrollHeight: document.documentElement.scrollHeight,
        documentScrollLeft: window.scrollX || document.documentElement.scrollLeft || 0,
      },
      selectorCounts: {
        primary: count(config.primarySelector),
        genericFeedRows: count(".light-feed-row"),
        feedPages: count(".light-feed-page"),
        feedSurfaces: count(".light-feed-surface"),
        feedSections: count(".light-feed-section"),
        notesPinButtons: count(".light-note-pin-button"),
        notesLeadingIcons: count(".light-note-row .light-small-icon"),
        graphLeadingIcons: count(".light-graph-row .light-small-icon"),
        graphChevrons: count(".light-graph-row .light-chevron"),
        reminderChips: count(".light-reminder-row .light-graph-chip-row"),
        reminderSnoozedRows: count(".light-reminder-row.delivery-snoozed"),
        projectChipRows: count(".light-project-chip-row"),
        inboxCards: count(".card-wrap > article.card"),
        archiveActions: count(".archive-reveal-action"),
        inlineAudioTriggers: count(".card-inline-audio-trigger"),
        meetingsToolbar: count(".meetings-embedded-toolbar"),
        meetingsCards: count(".card.card-meeting-list"),
        meetingsEmpty: count(".meetings-empty"),
      },
    };
  }, routeConfig);
}

async function collectDetailMetrics(page) {
  return page.evaluate(({ detailSelector }) => {
    const detail = document.querySelector(detailSelector);
    return {
      currentRoute: document.querySelector(".light-shell")?.getAttribute("data-light-route") || "",
      detailVisible: Boolean(detail && (!detail.hasAttribute("aria-hidden") || detail.getAttribute("aria-hidden") === "false" || detail.classList.contains("is-open"))),
      noteHtmlFrames: document.querySelectorAll(".light-note-detail-html-body .light-html-frame").length,
      scheduleSections: [...document.querySelectorAll(".light-section-title")].filter(node => String(node.textContent || "").trim() === "SCHEDULE").length,
      channelsSections: [...document.querySelectorAll(".light-section-title")].filter(node => String(node.textContent || "").trim() === "CHANNELS").length,
      notesSections: [...document.querySelectorAll(".light-section-title")].filter(node => String(node.textContent || "").trim() === "NOTES").length,
      projectGridCount: document.querySelectorAll(".light-project-section-grid").length,
      detailShells: document.querySelectorAll(".detail-shell").length,
      detailPanels: document.querySelectorAll(`${detailSelector}.is-open, ${detailSelector}[aria-hidden="false"]`).length,
    };
  }, { detailSelector: DETAIL_SELECTOR });
}

function assertCommonRouteState(routeConfig, metrics) {
  assert(metrics.routeIdentity === routeConfig.route, `${routeConfig.surface}: expected route ${routeConfig.route}, saw ${metrics.routeIdentity}`);
  assert(metrics.headerPresent, `${routeConfig.surface}: expected sticky header to render`);
  assert(metrics.scrollMetrics.documentScrollWidth <= metrics.scrollMetrics.innerWidth + 1, `${routeConfig.surface}: horizontal overflow detected`);
  assert(metrics.selectorCounts.feedPages >= 1, `${routeConfig.surface}: missing .light-feed-page`);
  assert(metrics.selectorCounts.feedSurfaces >= 1, `${routeConfig.surface}: missing .light-feed-surface`);
  assert(metrics.selectorCounts.feedSections >= 1, `${routeConfig.surface}: missing .light-feed-section`);
}

function assertRouteSpecificState(routeConfig, metrics) {
  if (routeConfig.route === "notes") {
    assert(metrics.sectionKeys.includes("pinned"), "Notes: pinned section missing");
    assert(metrics.sectionKeys.includes("recent"), "Notes: recent section missing");
    assert(metrics.selectorCounts.notesPinButtons > 0, "Notes: expected right-side pin buttons");
    assert(metrics.selectorCounts.notesLeadingIcons === 0, "Notes: no left icon regression allowed");
  }
  if (routeConfig.route === "meeting-notes") {
    assert(metrics.selectorCounts.graphLeadingIcons === 0, "Meeting Notes: leading icon regression detected");
    assert(metrics.selectorCounts.graphChevrons === 0, "Meeting Notes: trailing chevron regression detected");
  }
  if (routeConfig.route === "reminders") {
    assert(metrics.sectionKeys.includes("active"), "Reminders: active section missing");
    if (metrics.selectorCounts.reminderSnoozedRows > 0) {
      assert(metrics.sectionKeys.includes("snoozed"), "Reminders: snoozed section missing");
    }
    assert(metrics.selectorCounts.reminderChips === 0, "Reminders: chips should stay hidden");
  }
  if (routeConfig.route === "projects") {
    assert(metrics.selectorCounts.projectChipRows > 0, "Projects: chip rows should remain visible");
  }
  if (routeConfig.route === "inbox" && metrics.selectorCounts.primary > 0) {
    assert(metrics.selectorCounts.inboxCards > 0, "Inbox: canonical cards should render");
    assert(metrics.selectorCounts.archiveActions > 0, "Inbox: archive reveal should remain available");
  }
  if (routeConfig.route === "meetings") {
    assert(metrics.selectorCounts.meetingsToolbar === 1, "Meetings: embedded toolbar should render once");
    if (metrics.selectorCounts.primary > 0) {
      assert(metrics.selectorCounts.meetingsCards === metrics.selectorCounts.primary, "Meetings: rows should stay card-meeting-list");
    } else {
      assert(metrics.selectorCounts.meetingsEmpty > 0, "Meetings: empty-state honesty should remain visible when no rows exist");
    }
  }
}

async function backToList(page, routeConfig, timeoutMs) {
  for (let index = 0; index < 6; index += 1) {
    await page.evaluate(() => window.PuckyHandleAndroidBack && window.PuckyHandleAndroidBack());
    try {
      if (routeConfig.detail.expectedRoute) {
        await waitForRoute(page, routeConfig.route, 1000);
        return true;
      }
      await page.waitForFunction(
        selector => {
          const panel = document.querySelector(selector);
          return !panel || panel.getAttribute("aria-hidden") === "true" || !panel.classList.contains("is-open");
        },
        routeConfig.detail.expectedSelector,
        { timeout: 1000 }
      );
      await waitForRoute(page, routeConfig.route, timeoutMs);
      return true;
    } catch (_error) {
      // Keep trying the shared back handler.
    }
  }
  return false;
}

async function openDetailAndReturn(page, routeConfig, timeoutMs, routeDir, prefix) {
  const opener = page.locator(routeConfig.detail.openerSelector).first();
  if (await opener.count() === 0) {
    return {
      attempted: false,
      opened: false,
      returned: false,
      routeAfterOpen: routeConfig.route,
      reason: "No primary rows available for detail open",
    };
  }
  await opener.waitFor({ state: "visible", timeout: timeoutMs });
  await opener.click();
  if (routeConfig.detail.expectedRoute) {
    await waitForRoute(page, routeConfig.detail.expectedRoute, timeoutMs);
  } else if (routeConfig.detail.expectedSelector) {
    await page.locator(routeConfig.detail.expectedSelector).first().waitFor({ state: "visible", timeout: timeoutMs });
  }
  const detailMetrics = await collectDetailMetrics(page);
  if (routeConfig.route === "notes") {
    assert(detailMetrics.noteHtmlFrames > 0, "Notes: detail should stay HTML-backed");
  }
  if (routeConfig.route === "reminders") {
    assert(detailMetrics.scheduleSections > 0, "Reminders: schedule section should render");
    assert(detailMetrics.channelsSections > 0, "Reminders: channels section should render");
  }
  if (routeConfig.route === "projects") {
    assert(detailMetrics.projectGridCount > 0, "Projects: detail grid should render");
  }
  const detailScreenshot = await saveScreenshot(page, path.join(routeDir, `${prefix}-detail-open.png`));
  const returned = await backToList(page, routeConfig, timeoutMs);
  assert(returned, `${routeConfig.surface}: could not return from first detail open`);
  await waitForRoute(page, routeConfig.route, timeoutMs);
  const backScreenshot = await saveScreenshot(page, path.join(routeDir, `${prefix}-back-to-list.png`));
  return {
    attempted: true,
    opened: true,
    returned,
    routeAfterOpen: detailMetrics.currentRoute,
    detailMetrics,
    screenshots: {
      detailOpen: detailScreenshot,
      backToList: backScreenshot,
    },
  };
}

async function captureRoute(browser, config, routeConfig, viewportName, viewport, consoleEvents, networkEvents) {
  const routeDir = path.join(config.reportDir, `${routeConfig.route}-${viewportName}`);
  const videoDir = path.join(routeDir, "video");
  ensureDir(routeDir);
  ensureDir(videoDir);
  const context = await browser.newContext({
    viewport,
    screen: viewport,
    hasTouch: viewportName === "mobile",
    isMobile: viewportName === "mobile",
    recordVideo: { dir: videoDir, size: viewport },
  });
  await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
  const page = await context.newPage();
  const pageVideo = page.video();
  page.on("console", message => {
    consoleEvents.push({
      route: routeConfig.route,
      viewport: viewportName,
      type: message.type(),
      text: message.text(),
    });
  });
  page.on("pageerror", error => {
    consoleEvents.push({
      route: routeConfig.route,
      viewport: viewportName,
      type: "pageerror",
      text: error.message || String(error),
    });
  });
  page.on("response", response => {
    networkEvents.push({
      route: routeConfig.route,
      viewport: viewportName,
      url: response.url(),
      status: response.status(),
      ok: response.ok(),
    });
  });

  const prefix = viewportName;
  const tracePath = path.join(routeDir, `${prefix}-trace.zip`);
  let summary = null;
  try {
    routeConfig.apiToken = config.apiToken;
    await page.goto(buildRouteUrl(config, routeConfig), { waitUntil: "domcontentloaded", timeout: timeoutMsFor(routeConfig, config) });
    await waitForSurfaceReady(page, routeConfig, config.timeoutMs);
    const routeTop = await saveScreenshot(page, path.join(routeDir, `${prefix}-route-top.png`));
    const metrics = await collectRouteMetrics(page, routeConfig);
    assertCommonRouteState(routeConfig, metrics);
    assertRouteSpecificState(routeConfig, metrics);
    const scrollState = await scrollList(page);
    let secondaryScreenshot = "";
    if (scrollState.canScroll) {
      await page.waitForTimeout(150);
      secondaryScreenshot = await saveScreenshot(page, path.join(routeDir, `${prefix}-scrolled.png`));
    }
    const detailResult = await openDetailAndReturn(page, routeConfig, config.timeoutMs, routeDir, prefix);
    summary = {
      surface: routeConfig.surface,
      route: routeConfig.route,
      theme: routeConfig.theme,
      viewport: viewportName,
      page_url: buildRouteUrl(config, routeConfig),
      container_classes: {
        page: metrics.pageClasses,
        surface: metrics.surfaceClasses,
        first_section: metrics.firstSectionClasses,
      },
      item_counts: metrics.selectorCounts,
      header_metrics: metrics.headerMetrics,
      title_metrics: metrics.titleMetrics,
      scroll_metrics: metrics.scrollMetrics,
      section_keys: metrics.sectionKeys,
      first_detail_result: detailResult,
      screenshots: {
        route_top: routeTop,
        scrolled: secondaryScreenshot,
      },
      trace_path: tracePath,
      video_path: "",
    };
    writeJsonFile(path.join(routeDir, `${prefix}-summary.json`), summary);
  } finally {
    await context.tracing.stop({ path: tracePath }).catch(() => {});
    await context.close().catch(() => {});
  }
  if (summary) {
    summary.video_path = pageVideo ? await pageVideo.path().catch(() => "") : "";
    writeJsonFile(path.join(routeDir, `${prefix}-summary.json`), summary);
  }
  return summary;
}

function timeoutMsFor(_routeConfig, config) {
  return Math.max(1000, Number(config.timeoutMs || 30000) || 30000);
}

async function main() {
  const config = parseArgs(process.argv.slice(2));
  ensureDir(config.reportDir);
  const consoleEvents = [];
  const networkEvents = [];
  let browser = null;
  try {
    const manifestResult = await fetchManifest(config);
    browser = await chromium.launch({
      executablePath: resolveChromePath(),
      headless: config.headless,
    });
    const routeSummaries = {};
    for (const routeConfig of ROUTES) {
      routeSummaries[routeConfig.route] = {};
      for (const viewportName of routeConfig.viewportModes) {
        const viewport = viewportName === "desktop" ? DESKTOP_VIEWPORT : MOBILE_VIEWPORT;
        routeSummaries[routeConfig.route][viewportName] = await captureRoute(
          browser,
          config,
          routeConfig,
          viewportName,
          viewport,
          consoleEvents,
          networkEvents,
        );
      }
    }
    const summary = {
      schema: RESULT_SCHEMA,
      ok: true,
      base_url: config.baseUrl,
      report_dir: config.reportDir,
      refresh_key: config.refreshKey,
      manifest_url: manifestResult.manifestUrl,
      remote_manifest: manifestResult.manifest,
      routes: routeSummaries,
    };
    writeJsonFile(path.join(config.reportDir, "summary.json"), summary);
    writeJsonFile(path.join(config.reportDir, "console.json"), consoleEvents);
    writeJsonFile(path.join(config.reportDir, "network.json"), networkEvents);
    console.log(JSON.stringify(summary, null, 2));
  } catch (error) {
    writeAutomationError(config.reportDir, error);
    throw error;
  } finally {
    if (browser) {
      await browser.close().catch(() => {});
    }
  }
}

main().catch(error => {
  console.error(error.stack || error.message || String(error));
  process.exitCode = 1;
});
