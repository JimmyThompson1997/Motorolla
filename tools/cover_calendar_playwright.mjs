import fs from "node:fs";
import path from "node:path";

import { chromium } from "playwright-core";
import {
  attachPageLogging,
  ensureDir,
  resolveChromePath,
  writeAutomationError,
  writeJsonFile
} from "./cover_shared.mjs";

const DEFAULT_BASE_URL = process.env.PUCKY_CALENDAR_PROOF_BASE_URL || "https://pucky.fly.dev";
const PROOF_RUN_ID = "proof-calendar";
const DESKTOP_VIEWPORT = { width: 1280, height: 720 };
const MOBILE_VIEWPORT = { width: 390, height: 844 };

function parseArgs(argv) {
  const config = {
    baseUrl: DEFAULT_BASE_URL,
    apiToken: process.env.PUCKY_CALENDAR_PROOF_TOKEN || process.env.PUCKY_API_TOKEN || "",
    reportDir: path.resolve("artifacts", "calendar-proof", new Date().toISOString().replace(/[:.]/g, "-")),
    timeoutMs: 30000
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = String(argv[index] || "");
    if (arg === "--base-url" && argv[index + 1]) {
      config.baseUrl = String(argv[++index] || config.baseUrl).replace(/\/+$/, "");
    } else if (arg === "--api-token" && argv[index + 1]) {
      config.apiToken = String(argv[++index] || config.apiToken);
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

function dateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function dayAt(offsetDays, hour, minute = 0) {
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);
  date.setHours(hour, minute, 0, 0);
  return date.getTime();
}

function pageUrl(baseUrl, apiToken = "") {
  const url = new URL(`${baseUrl.replace(/\/+$/, "")}/ui/pucky/latest/index.html`);
  url.searchParams.set("theme", "light");
  url.searchParams.set("reset_nav", "1");
  if (String(apiToken || "").trim()) {
    url.searchParams.set("api_token", String(apiToken || "").trim());
  }
  return url.toString();
}

async function apiRequest(config, method, apiPath, body = undefined) {
  const headers = { Accept: "application/json" };
  if (config.apiToken) {
    headers.Authorization = `Bearer ${config.apiToken}`;
  }
  const response = await fetch(`${config.baseUrl}${apiPath}`, {
    method,
    headers: {
      ...headers,
      ...(body === undefined ? {} : { "Content-Type": "application/json" })
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`${method} ${apiPath} failed (${response.status}): ${JSON.stringify(payload)}`);
  }
  return payload;
}

async function deleteWorkspaceRecord(config, collection, recordId) {
  try {
    await apiRequest(config, "DELETE", `/api/workspace/${collection}/${recordId}`);
  } catch (error) {
    if (/\(404\)/.test(String(error?.message || ""))) {
      return;
    }
    throw error;
  }
}

async function cleanupWorkspaceSeed(config, seed) {
  if (!seed?.writeEnabled) {
    return false;
  }
  for (const recordId of seed.recordIds) {
    await deleteWorkspaceRecord(config, "calendar-events", recordId);
  }
  return true;
}

async function seedCalendar(config, runId = PROOF_RUN_ID) {
  if (!config.apiToken) {
    throw new Error("Calendar proof needs an API token to seed real workspace records.");
  }
  const today = dateKey(new Date());
  const tomorrow = dateKey(new Date(Date.now() + 24 * 60 * 60 * 1000));
  const dayAfter = dateKey(new Date(Date.now() + 2 * 24 * 60 * 60 * 1000));
  const recordIds = [
    `${runId}-brunch`,
    `${runId}-handyman`,
    `${runId}-pickup`,
    `${runId}-pta`,
    `${runId}-late-call`,
    `${runId}-coffee`
  ];
  const seed = { runId, writeEnabled: true, recordIds, today, tomorrow, dayAfter };
  await cleanupWorkspaceSeed(config, seed);
  await apiRequest(config, "POST", "/api/workspace/calendar-events", {
    id: `${runId}-brunch`,
    title: "Proof brunch plan",
    summary: "Cedar Cafe",
    date: today,
    start_at_ms: dayAt(0, 9, 0),
    end_at_ms: dayAt(0, 9, 45),
    html: "<!doctype html><h1>Proof brunch plan</h1><p>Late breakfast and errands.</p>",
    metadata: { place: "Cedar Cafe", type: "personal", attendees: ["Alex"] }
  });
  await apiRequest(config, "POST", "/api/workspace/calendar-events", {
    id: `${runId}-handyman`,
    title: "Proof handyman window",
    summary: "Front door and hallway light",
    date: today,
    start_at_ms: dayAt(0, 13, 30),
    end_at_ms: dayAt(0, 14, 15),
    html: "<!doctype html><h1>Proof handyman window</h1><p>Home repair follow-up.</p>",
    metadata: { place: "Home", type: "personal", attendees: ["Lee"] }
  });
  await apiRequest(config, "POST", "/api/workspace/calendar-events", {
    id: `${runId}-pickup`,
    title: "Proof school pickup",
    summary: "Leave before traffic stacks up",
    date: today,
    start_at_ms: dayAt(0, 18, 0),
    end_at_ms: dayAt(0, 18, 30),
    html: "<!doctype html><h1>Proof school pickup</h1><p>Evening family logistics.</p>",
    metadata: { place: "Lincoln School", type: "personal" }
  });
  await apiRequest(config, "POST", "/api/workspace/calendar-events", {
    id: `${runId}-pta`,
    title: "Proof PTA check-in",
    summary: "Quick overlap after pickup",
    date: today,
    start_at_ms: dayAt(0, 18, 10),
    end_at_ms: dayAt(0, 18, 40),
    html: "<!doctype html><h1>Proof PTA check-in</h1><p>Small overlap event.</p>",
    metadata: { place: "Phone", type: "personal" }
  });
  await apiRequest(config, "POST", "/api/workspace/calendar-events", {
    id: `${runId}-late-call`,
    title: "Proof late call",
    summary: "Moves to tomorrow in New York",
    date: today,
    start_at_ms: dayAt(0, 23, 30),
    end_at_ms: dayAt(0, 23, 50),
    html: "<!doctype html><h1>Proof late call</h1><p>Timezone shift proof event.</p>",
    metadata: { place: "Phone", type: "personal" }
  });
  await apiRequest(config, "POST", "/api/workspace/calendar-events", {
    id: `${runId}-coffee`,
    title: "Proof coffee catch-up",
    summary: "Intentional day-after event",
    date: dayAfter,
    start_at_ms: dayAt(2, 10, 0),
    end_at_ms: dayAt(2, 10, 30),
    html: "<!doctype html><h1>Proof coffee catch-up</h1><p>Day-after event for empty-day checks.</p>",
    metadata: { place: "Northside", type: "personal" }
  });
  return seed;
}

async function saveShot(page, reportDir, name, summary) {
  const target = path.join(reportDir, name);
  await page.screenshot({ path: target, fullPage: false });
  summary.screenshots[name] = target;
}

async function openHomeCalendar(page) {
  await page.locator('.light-app-tile[data-route="calendar"]').click();
  await page.locator(".light-date-input").waitFor({ state: "visible" });
}

async function goHome(page) {
  await page.getByRole("button", { name: "Back" }).click();
  await page.locator('.light-app-tile[data-route="calendar"]').waitFor({ state: "visible" });
}

async function setCalendarDate(page, value) {
  await page.evaluate(nextValue => {
    const input = document.querySelector(".light-date-input");
    if (!(input instanceof HTMLInputElement)) {
      throw new Error("Calendar date input not found");
    }
    input.value = nextValue;
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }, value);
}

async function visibleCalendarTitles(page) {
  return page.evaluate(() => Array.from(document.querySelectorAll(".light-event-title")).map(node => node.textContent?.trim()).filter(Boolean));
}

async function visibleCalendarTimes(page) {
  return page.evaluate(() => Array.from(document.querySelectorAll(".light-event-time")).map(node => node.textContent?.trim()).filter(Boolean));
}

async function stickyMetrics(page) {
  return page.evaluate(() => {
    const feed = document.querySelector(".feed");
    if (feed && typeof feed.scrollTo === "function") {
      feed.scrollTo({ top: 420, left: 0, behavior: "instant" });
    }
    const header = document.querySelector(".light-page-header");
    const controls = document.querySelector(".light-date-picker");
    return {
      headerTop: Math.round(header?.getBoundingClientRect().top ?? -999),
      controlsTop: Math.round(controls?.getBoundingClientRect().top ?? -999),
      feedScrollTop: Math.round(feed?.scrollTop ?? -1)
    };
  });
}

async function selectTimezone(page, value) {
  const select = page.locator('.settings-native-select');
  await select.selectOption(value);
}

async function runDesktopScenario(browser, config, seed, summary, consoleLog, networkLog) {
  const reportDir = path.join(config.reportDir, "desktop");
  ensureDir(reportDir);
  const context = await browser.newContext({
    viewport: DESKTOP_VIEWPORT,
    recordVideo: { dir: reportDir, size: DESKTOP_VIEWPORT }
  });
  await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
  const page = await context.newPage();
  attachPageLogging(page, consoleLog);
  page.on("request", request => {
    if (request.url().includes("/api/workspace/")) {
      networkLog.push({ type: "request", method: request.method(), url: request.url(), at: new Date().toISOString() });
    }
  });
  page.on("response", response => {
    if (response.url().includes("/api/workspace/")) {
      networkLog.push({ type: "response", status: response.status(), url: response.url(), at: new Date().toISOString() });
    }
  });
  try {
    await page.goto(pageUrl(config.baseUrl, config.apiToken), { waitUntil: "networkidle", timeout: config.timeoutMs });
    await page.locator('.light-app-tile[data-route="calendar"]').waitFor({ state: "visible" });
    await openHomeCalendar(page);

    const initialDate = await page.locator(".light-date-input").inputValue();
    assert(initialDate === seed.today, `Calendar should open on local today ${seed.today}, got ${initialDate}`);
    const todayTitles = await visibleCalendarTitles(page);
    assert(todayTitles.includes("Proof late call"), "Expected late-call event on the device-local today view.");
    assert(todayTitles.includes("Proof school pickup"), "Expected clustered pickup event on today.");
    summary.assertions.push("desktop calendar opened to today");
    await saveShot(page, reportDir, "calendar-desktop-today.png", summary);

    await setCalendarDate(page, seed.tomorrow);
    await page.locator(".light-empty-state").waitFor({ state: "visible" });
    const emptyCopy = await page.locator(".light-empty-state").textContent();
    assert(
      String(emptyCopy || "").includes("No events tomorrow") || String(emptyCopy || "").includes("No events on"),
      "Expected date-aware empty-state copy on an empty day."
    );
    await saveShot(page, reportDir, "calendar-desktop-empty-day.png", summary);

    await goHome(page);
    await openHomeCalendar(page);
    const reopenedDate = await page.locator(".light-date-input").inputValue();
    assert(reopenedDate === seed.today, `Calendar should reset to today after Home re-entry, got ${reopenedDate}`);
    summary.assertions.push("calendar home entry resets to today");

    const busyLabelCount = await page.getByText("Busy window", { exact: true }).count();
    assert(busyLabelCount >= 1, "Expected clustered events to render inside a busy window.");
    const scrollMetrics = await stickyMetrics(page);
    assert(scrollMetrics.headerTop <= 1, `Expected sticky header to pin at top, got ${scrollMetrics.headerTop}`);
    assert(scrollMetrics.controlsTop >= 0 && scrollMetrics.controlsTop < 140, `Expected sticky controls to remain visible, got ${scrollMetrics.controlsTop}`);
    await saveShot(page, reportDir, "calendar-desktop-scrolled.png", summary);
    summary.assertions.push("desktop sticky header and controls stayed pinned");

    await goHome(page);
    await page.locator('.light-app-tile[data-route="settings"]').click();
    await page.locator('.settings-native-select').waitFor({ state: "visible" });
    await selectTimezone(page, "America/New_York");
    await goHome(page);
    await openHomeCalendar(page);
    const nyTodayTitles = await visibleCalendarTitles(page);
    assert(!nyTodayTitles.includes("Proof late call"), "Expected late-call event to move off the selected day after timezone switch.");
    await setCalendarDate(page, seed.tomorrow);
    const nyTomorrowTitles = await visibleCalendarTitles(page);
    const nyTomorrowTimes = await visibleCalendarTimes(page);
    assert(nyTomorrowTitles.includes("Proof late call"), "Expected late-call event to appear on tomorrow in New York.");
    assert(nyTomorrowTimes.some(value => value.includes("2:30 AM")), `Expected a shifted 2:30 AM time in New York, got ${nyTomorrowTimes.join(", ")}`);
    await saveShot(page, reportDir, "calendar-desktop-timezone-shift.png", summary);
    summary.assertions.push("timezone switch changed calendar grouping and times");
  } finally {
    await context.tracing.stop({ path: path.join(reportDir, "trace-desktop.zip") });
    await context.close();
  }
}

async function runMobileScenario(browser, config, summary, consoleLog, networkLog) {
  const reportDir = path.join(config.reportDir, "mobile");
  ensureDir(reportDir);
  const context = await browser.newContext({
    viewport: MOBILE_VIEWPORT,
    recordVideo: { dir: reportDir, size: MOBILE_VIEWPORT }
  });
  await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
  const page = await context.newPage();
  attachPageLogging(page, consoleLog);
  page.on("request", request => {
    if (request.url().includes("/api/workspace/")) {
      networkLog.push({ type: "request", method: request.method(), url: request.url(), at: new Date().toISOString() });
    }
  });
  page.on("response", response => {
    if (response.url().includes("/api/workspace/")) {
      networkLog.push({ type: "response", status: response.status(), url: response.url(), at: new Date().toISOString() });
    }
  });
  try {
    await page.goto(pageUrl(config.baseUrl, config.apiToken), { waitUntil: "networkidle", timeout: config.timeoutMs });
    await page.locator('.light-app-tile[data-route="calendar"]').waitFor({ state: "visible" });
    await openHomeCalendar(page);
    assert(await page.locator(".light-date-input").count() === 1, "Expected a native date input on mobile.");
    await saveShot(page, reportDir, "calendar-mobile-top.png", summary);
    const metrics = await stickyMetrics(page);
    assert(metrics.headerTop <= 1, `Expected mobile header to stay pinned, got ${metrics.headerTop}`);
    assert(metrics.controlsTop >= 0 && metrics.controlsTop < 140, `Expected mobile controls row to stay pinned, got ${metrics.controlsTop}`);
    await saveShot(page, reportDir, "calendar-mobile-scrolled.png", summary);
    summary.assertions.push("mobile sticky header and controls stayed pinned");
  } finally {
    await context.tracing.stop({ path: path.join(reportDir, "trace-mobile.zip") });
    await context.close();
  }
}

async function readManifest(config) {
  const response = await fetch(`${config.baseUrl}/ui/pucky/latest/manifest.json?cb=${Date.now()}`, {
    headers: { Accept: "application/json" }
  });
  if (!response.ok) {
    throw new Error(`Manifest fetch failed (${response.status})`);
  }
  return response.json();
}

async function main() {
  const config = parseArgs(process.argv.slice(2));
  ensureDir(config.reportDir);
  const consoleLog = path.join(config.reportDir, "console.log");
  const networkLog = [];
  fs.writeFileSync(consoleLog, "", "utf8");
  const summary = {
    schema: "pucky.calendar_browser_proof.v1",
    base_url: config.baseUrl,
    report_dir: config.reportDir,
    started_at: new Date().toISOString(),
    screenshots: {},
    assertions: []
  };

  let browser;
  let seed;
  try {
    summary.manifest = await readManifest(config);
    seed = await seedCalendar(config, `${PROOF_RUN_ID}-${Date.now()}`);
    summary.seed = seed;
    browser = await chromium.launch({
      executablePath: resolveChromePath(),
      headless: true
    });
    await runDesktopScenario(browser, config, seed, summary, consoleLog, networkLog);
    await runMobileScenario(browser, config, summary, consoleLog, networkLog);
    summary.ok = true;
    summary.finished_at = new Date().toISOString();
    writeJsonFile(path.join(config.reportDir, "network.json"), networkLog);
    writeJsonFile(path.join(config.reportDir, "summary.json"), summary);
  } catch (error) {
    summary.ok = false;
    summary.error = String(error?.stack || error?.message || error);
    writeAutomationError(config.reportDir, error);
    writeJsonFile(path.join(config.reportDir, "network.json"), networkLog);
    writeJsonFile(path.join(config.reportDir, "summary.json"), summary);
    throw error;
  } finally {
    if (browser) {
      await browser.close().catch(() => {});
    }
    if (seed) {
      try {
        await cleanupWorkspaceSeed(config, seed);
        summary.cleanup = { attempted: true, cleaned: true };
      } catch (cleanupError) {
        summary.cleanup = {
          attempted: true,
          cleaned: false,
          error: String(cleanupError?.stack || cleanupError?.message || cleanupError)
        };
      }
      writeJsonFile(path.join(config.reportDir, "summary.json"), summary);
    }
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
