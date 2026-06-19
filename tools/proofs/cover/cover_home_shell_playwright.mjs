import fs from "node:fs";
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

const DEFAULT_BASE_URL = "https://pucky.fly.dev";
const VIEWPORT = { width: 430, height: 932 };

function parseArgs(argv) {
  const config = {
    baseUrl: process.env.PUCKY_HOME_SHELL_BASE_URL || DEFAULT_BASE_URL,
    reportDir: path.resolve("artifacts", "home-shell-proof", new Date().toISOString().replace(/[:.]/g, "-")),
    timeoutMs: 30000
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = String(argv[index] || "");
    if (arg === "--base-url" && argv[index + 1]) {
      config.baseUrl = String(argv[++index] || config.baseUrl).trim().replace(/\/+$/, "");
    } else if (arg === "--report-dir" && argv[index + 1]) {
      config.reportDir = path.resolve(String(argv[++index] || config.reportDir));
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

function buildPageUrl(baseUrl, { theme = "light", route = "", resetNav = true } = {}) {
  const url = new URL(`${String(baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, "")}/ui/pucky/latest/index.html`);
  url.searchParams.set("theme", theme);
  if (route) {
    url.searchParams.set("route", route);
  }
  if (resetNav) {
    url.searchParams.set("reset_nav", "1");
  }
  return url.toString();
}

async function goto(page, url, timeoutMs) {
  await page.goto(url, { waitUntil: "commit", timeout: timeoutMs });
}

async function waitForHome(page, theme, timeoutMs) {
  await page.waitForFunction(
    ({ expectedTheme }) => {
      const shell = document.querySelector(".app-shell");
      const grid = document.querySelector(".light-shell[data-light-route=\"home\"] .light-app-grid");
      const voice = document.getElementById("voiceStatus");
      return Boolean(
        shell
        && shell.getAttribute("data-theme") === expectedTheme
        && shell.getAttribute("data-chrome-mode") === "home-shell"
        && grid
        && voice
      );
    },
    { expectedTheme: theme },
    { timeout: timeoutMs }
  );
}

async function waitForCanonicalHomeShell(page, { route, readySelector, timeoutMs }) {
  await page.waitForFunction(
    ({ expectedRoute, selector }) => {
      const shell = document.querySelector(".app-shell");
      const voice = document.getElementById("voiceStatus");
      const tabs = document.getElementById("pageTabs");
      return Boolean(
        shell
        && shell.getAttribute("data-chrome-mode") === "home-shell"
        && shell.getAttribute("data-canonical-route") === expectedRoute
        && document.querySelector(selector)
        && voice
        && tabs
        && tabs.hidden
      );
    },
    { expectedRoute: route, selector: readySelector },
    { timeout: timeoutMs }
  );
}

async function waitForCanonicalDirect(page, { theme, route, readySelector, timeoutMs }) {
  await page.waitForFunction(
    ({ expectedTheme, expectedRoute, selector }) => {
      const shell = document.querySelector(".app-shell");
      const tabs = document.getElementById("pageTabs");
      return Boolean(
        shell
        && shell.getAttribute("data-theme") === expectedTheme
        && shell.getAttribute("data-canonical-route") === expectedRoute
        && shell.getAttribute("data-chrome-mode") === "canonical"
        && tabs
        && !tabs.hidden
        && document.querySelector(selector)
      );
    },
    { expectedTheme: theme, expectedRoute: route, selector: readySelector },
    { timeout: timeoutMs }
  );
}

async function clickTile(page, label, timeoutMs) {
  const tile = page.locator(`.light-app-tile[data-app-label="${label}"]`);
  await tile.first().waitFor({ state: "visible", timeout: timeoutMs });
  await tile.first().evaluate((node) => node.click());
}

async function captureShellState(page) {
  return page.evaluate(() => {
    const shell = document.querySelector(".app-shell");
    const tabs = document.getElementById("pageTabs");
    const tray = document.getElementById("routeTray");
    return {
      theme: shell?.getAttribute("data-theme") || "",
      view: shell?.getAttribute("data-view") || "",
      canonical_route: shell?.getAttribute("data-canonical-route") || "",
      chrome_mode: shell?.getAttribute("data-chrome-mode") || "",
      embedded_app: shell?.getAttribute("data-embedded-app") || "",
      tabs_hidden: Boolean(tabs?.hidden),
      tray_hidden: Boolean(tray?.hidden),
      voice_visible: Boolean(document.getElementById("voiceStatus"))
    };
  });
}

async function openFirstFeedDetail(page, timeoutMs) {
  const body = page.locator("#feed article.card .card-body").first();
  if (await body.count()) {
    await body.click();
    await page.waitForFunction(() => {
      const detail = document.getElementById("detail");
      return Boolean(detail && (detail.classList.contains("is-open") || detail.getAttribute("aria-hidden") === "false"));
    }, {}, { timeout: timeoutMs });
    return true;
  }
  return false;
}

async function openFirstMeetingDetail(page, timeoutMs) {
  const body = page.locator(".meetings-page article.card .card-body").first();
  if (await body.count()) {
    await body.click();
    await page.waitForFunction(() => {
      const detail = document.getElementById("detail");
      return Boolean(detail && (detail.classList.contains("is-open") || detail.getAttribute("aria-hidden") === "false"));
    }, {}, { timeout: timeoutMs });
    return true;
  }
  return false;
}

async function backToHome(page, theme, timeoutMs) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const alreadyHome = await page.evaluate(() => Boolean(document.querySelector(".light-shell[data-light-route=\"home\"] .light-app-grid")));
    if (alreadyHome) {
      return;
    }
    await page.evaluate(() => window.PuckyHandleAndroidBack && window.PuckyHandleAndroidBack());
    await page.waitForTimeout(250);
  }
  await waitForHome(page, theme, timeoutMs);
}

async function main() {
  const config = parseArgs(process.argv.slice(2));
  ensureDir(config.reportDir);
  const summary = {
    base_url: config.baseUrl,
    viewport: VIEWPORT,
    screenshots: {}
  };
  const consoleLogPath = path.join(config.reportDir, "console.log");
  const browser = await chromium.launch({
    executablePath: resolveChromePath(),
    headless: true
  });
  const context = await browser.newContext({
    viewport: VIEWPORT,
    recordVideo: { dir: path.join(config.reportDir, "video"), size: VIEWPORT }
  });
  await context.tracing.start({ screenshots: true, snapshots: true });
  const page = await context.newPage();
  attachPageLogging(page, consoleLogPath);

  try {
    await goto(page, buildPageUrl(config.baseUrl, { theme: "dark" }), config.timeoutMs);
    await waitForHome(page, "dark", config.timeoutMs);
    summary.dark_home = await captureShellState(page);
    summary.screenshots.dark_home = await saveScreenshot(page, config.reportDir, "01-dark-home");

    await goto(page, buildPageUrl(config.baseUrl, { theme: "light" }), config.timeoutMs);
    await waitForHome(page, "light", config.timeoutMs);
    summary.light_home = await captureShellState(page);
    summary.screenshots.light_home = await saveScreenshot(page, config.reportDir, "02-light-home");

    await clickTile(page, "Inbox", config.timeoutMs);
    await waitForCanonicalHomeShell(page, { route: "feed", readySelector: ".light-shell[data-light-route=\"feed\"] article.card, .light-shell[data-light-route=\"feed\"] .empty", timeoutMs: config.timeoutMs });
    summary.inbox = await captureShellState(page);
    summary.inbox.detail_opened = await openFirstFeedDetail(page, config.timeoutMs);
    summary.screenshots.inbox = await saveScreenshot(page, config.reportDir, "03-inbox-home-shell");
    await backToHome(page, "light", config.timeoutMs);

    await clickTile(page, "Connect", config.timeoutMs);
    await waitForCanonicalHomeShell(page, { route: "links", readySelector: ".light-shell[data-light-route=\"links\"] .links-page", timeoutMs: config.timeoutMs });
    summary.connect = await captureShellState(page);
    const search = page.locator("#linksSearch");
    if (await search.count()) {
      await search.fill("g");
    }
    summary.screenshots.connect = await saveScreenshot(page, config.reportDir, "04-connect-home-shell");
    await backToHome(page, "light", config.timeoutMs);

    await clickTile(page, "Meetings", config.timeoutMs);
    await waitForCanonicalHomeShell(page, { route: "meetings", readySelector: ".light-shell[data-light-route=\"meetings\"] .meetings-page", timeoutMs: config.timeoutMs });
    summary.meetings = await captureShellState(page);
    summary.meetings.detail_opened = await openFirstMeetingDetail(page, config.timeoutMs);
    summary.screenshots.meetings = await saveScreenshot(page, config.reportDir, "05-meetings-home-shell");
    await backToHome(page, "light", config.timeoutMs);

    await goto(page, buildPageUrl(config.baseUrl, { theme: "light" }), config.timeoutMs);
    await waitForHome(page, "light", config.timeoutMs);
    await clickTile(page, "Settings", config.timeoutMs);
    await page.waitForTimeout(1500);
    summary.settings_probe = await captureShellState(page);
    summary.screenshots.settings_probe = await saveScreenshot(page, config.reportDir, "06-settings-probe");
    await waitForCanonicalHomeShell(page, { route: "settings", readySelector: ".light-shell[data-light-route=\"settings\"] .light-settings-surface", timeoutMs: config.timeoutMs });
    summary.settings = await captureShellState(page);
    summary.screenshots.settings = await saveScreenshot(page, config.reportDir, "07-settings-home-shell");
    await backToHome(page, "light", config.timeoutMs);

    await clickTile(page, "Tasks", config.timeoutMs);
    await page.waitForSelector(".light-shell[data-light-route=\"tasks\"] .light-tasks-page", { timeout: config.timeoutMs });
    summary.tasks = await captureShellState(page);
    summary.screenshots.tasks = await saveScreenshot(page, config.reportDir, "08-tasks-home-shell");

    await goto(page, buildPageUrl(config.baseUrl, { theme: "light", route: "feed" }), config.timeoutMs);
    await waitForCanonicalDirect(page, { theme: "light", route: "feed", readySelector: "#feed article.card, #feed .empty", timeoutMs: config.timeoutMs });
    summary.direct_feed = await captureShellState(page);
    summary.screenshots.direct_feed = await saveScreenshot(page, config.reportDir, "09-direct-feed-canonical");

    await goto(page, buildPageUrl(config.baseUrl, { theme: "light", route: "links" }), config.timeoutMs);
    await waitForCanonicalDirect(page, { theme: "light", route: "links", readySelector: ".links-page", timeoutMs: config.timeoutMs });
    summary.direct_links = await captureShellState(page);
    summary.screenshots.direct_links = await saveScreenshot(page, config.reportDir, "10-direct-links-canonical");

    assert(summary.dark_home.chrome_mode === "home-shell", "Dark default entry did not open the home shell");
    assert(summary.light_home.chrome_mode === "home-shell", "Light default entry did not open the home shell");
    assert(summary.inbox.chrome_mode === "home-shell" && summary.inbox.canonical_route === "feed", "Inbox tile did not open feed in home-shell mode");
    assert(summary.connect.chrome_mode === "home-shell" && summary.connect.canonical_route === "links", "Connect tile did not open links in home-shell mode");
    assert(summary.meetings.chrome_mode === "home-shell" && summary.meetings.canonical_route === "meetings", "Meetings tile did not open meetings in home-shell mode");
    assert(summary.settings.chrome_mode === "home-shell" && summary.settings.canonical_route === "settings", "Settings tile did not open settings in home-shell mode");
    assert(summary.direct_feed.chrome_mode === "canonical", "Direct feed route lost canonical chrome");
    assert(summary.direct_links.chrome_mode === "canonical", "Direct links route lost canonical chrome");

    writeJsonFile(path.join(config.reportDir, "summary.json"), summary);
  } catch (error) {
    writeJsonFile(path.join(config.reportDir, "summary.json"), summary);
    writeAutomationError(config.reportDir, error);
    throw error;
  } finally {
    await context.tracing.stop({ path: path.join(config.reportDir, "trace.zip") });
    await context.close();
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exitCode = 1;
});
