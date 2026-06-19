import fs from "node:fs";
import path from "node:path";

import { chromium } from "playwright-core";
import {
  attachPageLogging,
  ensureDir,
  resolveChromePath,
  writeAutomationError,
  writeJsonFile
} from "../../support/cover_shared.mjs";

const DEFAULT_BASE_URL = process.env.PUCKY_CALENDAR_PROOF_BASE_URL || "https://pucky.fly.dev";
const PROOF_RUN_ID = "proof-calendar";
const DESKTOP_VIEWPORT = { width: 1280, height: 720 };
const MOBILE_VIEWPORT = { width: 390, height: 844 };

function resolveApiToken() {
  const webToken = String(process.env.PUCKY_WEB_UI_TOKEN || "").trim();
  if (webToken) {
    return webToken;
  }
  const proofToken = String(process.env.PUCKY_CALENDAR_PROOF_TOKEN || "").trim();
  if (proofToken) {
    return proofToken;
  }
  return String(process.env.PUCKY_API_TOKEN || "").trim();
}

function parseArgs(argv) {
  const config = {
    baseUrl: DEFAULT_BASE_URL,
    apiToken: resolveApiToken(),
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

function pageUrl(baseUrl, apiToken = "", theme = "light") {
  const url = new URL(`${baseUrl.replace(/\/+$/, "")}/ui/pucky/latest/index.html`);
  url.searchParams.set("theme", theme);
  url.searchParams.set("reset_nav", "1");
  url.searchParams.set("_pucky_refresh", String(Date.now()));
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

async function deleteWorkspaceLink(config, linkId) {
  try {
    await apiRequest(config, "DELETE", `/api/workspace/links/${linkId}`);
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
  for (const linkId of [...(seed.linkIds || [])].reverse()) {
    await deleteWorkspaceLink(config, linkId);
  }
  for (const record of [...(seed.records || [])].reverse()) {
    await deleteWorkspaceRecord(config, record.collection, record.id);
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
  const emptyDay = dateKey(new Date(Date.now() + 5 * 24 * 60 * 60 * 1000));
  const seed = { runId, writeEnabled: true, records: [], linkIds: [], today, tomorrow, dayAfter, emptyDay };
  await cleanupWorkspaceSeed(config, seed);
  const rememberRecord = async (collection, payload) => {
    seed.records.push({ collection, id: payload.id });
    await apiRequest(config, "POST", `/api/workspace/${collection}`, payload);
  };
  const rememberLink = async payload => {
    seed.linkIds.push(payload.id);
    await apiRequest(config, "POST", "/api/workspace/links", payload);
  };

  await rememberRecord("contacts", {
    id: `${runId}-jimmy-torres`,
    title: "Jimmy Torres",
    summary: "Proof collaborator",
    html: "<!doctype html><h1>Jimmy Torres</h1><p>Proof contact for the freelance review.</p>",
    metadata: { first_name: "Jimmy", last_name: "Torres", photo: "fixtures/contact_photos/proof-contact.webp", email: "jimmy@example.com", phone: "+1 (415) 555-0101" }
  });
  await rememberRecord("contacts", {
    id: `${runId}-jeff-bennett`,
    title: "Jeff Bennett",
    summary: "Proof family contact",
    html: "<!doctype html><h1>Jeff Bennett</h1><p>Proof contact for family plans and review context.</p>",
    metadata: { first_name: "Jeff", last_name: "Bennett", photo: "fixtures/contact_photos/eric.webp", email: "jeff@example.com", phone: "+1 (415) 555-0102" }
  });
  await rememberRecord("projects", {
    id: `${runId}-project`,
    title: "Proof freelance follow-up",
    summary: "Homepage edits, invoice note, and the next review loop.",
    html: "<!doctype html><h1>Proof freelance follow-up</h1><p>Project shell for the review call, task, and reminder.</p>",
    metadata: { threads: ["Homepage pass"], chips: ["Freelance", "Proof"] }
  });
  await rememberRecord("notes", {
    id: `${runId}-note`,
    title: "Proof review outline",
    summary: "Bullet list for the call and the post-call note.",
    html: "<!doctype html><h1>Proof review outline</h1><p>Note linked from the proof calendar event.</p>",
    metadata: { tags: ["Calendar", "Proof"] }
  });
  await rememberRecord("tasks", {
    id: `${runId}-task`,
    title: "Send proof review notes",
    summary: "Ship the last homepage notes before the call starts.",
    status: "open",
    due_at_ms: dayAt(0, 8, 45),
    html: "<!doctype html><h1>Send proof review notes</h1><p>Task linked to the review call and reminder.</p>",
    metadata: { owner: "Jimmy Torres", project: "Proof freelance follow-up" }
  });
  await rememberRecord("meeting-notes", {
    id: `${runId}-meeting-note`,
    title: "Proof freelance prep",
    summary: "Quick prep note for the linked review call.",
    date: today,
    start_at_ms: dayAt(0, 9, 0),
    end_at_ms: dayAt(0, 9, 20),
    html: "<!doctype html><h1>Proof freelance prep</h1><p>Meeting note linked to the review call, task, reminder, and project.</p>",
    metadata: {
      participants: ["Jimmy Torres", "Jeff Bennett"],
      source: `${runId}-freelance-review`,
      source_kind: "calendar_event",
      source_id: `${runId}-freelance-review`
    }
  });
  await rememberRecord("reminders", {
    id: `${runId}-reminder`,
    title: "Send proof HTML before call",
    summary: "Small nudge tied directly to the review event.",
    status: "open",
    due_at_ms: dayAt(0, 8, 30),
    html: "<!doctype html><h1>Send proof HTML before call</h1><p>Reminder linked back to the proof review event and task.</p>",
    metadata: { source_kind: "calendar_event", source_id: `${runId}-freelance-review`, snooze_state: "ready" }
  });
  await rememberRecord("calendar-events", {
    id: `${runId}-freelance-review`,
    title: "Proof freelance review call",
    summary: "Homepage pass, invoice cleanup, and the next edit round.",
    date: today,
    start_at_ms: dayAt(0, 9, 30),
    end_at_ms: dayAt(0, 10, 15),
    html: "<!doctype html><h1>Proof freelance review call</h1><p>Graph-linked proof event for attendee chips and cross-app navigation.</p>",
    metadata: { place: "Kitchen table", type: "freelance", attendees: ["Jimmy Torres", "Jeff Bennett"] }
  });
  await rememberRecord("calendar-events", {
    id: `${runId}-katy-handoff`,
    title: "Proof Katy pickup handoff",
    summary: "School pickup switch before dinner.",
    date: today,
    start_at_ms: dayAt(0, 17, 45),
    end_at_ms: dayAt(0, 18, 15),
    html: "<!doctype html><h1>Proof Katy pickup handoff</h1><p>Family logistics proof event.</p>",
    metadata: { place: "North field gate", type: "family", attendees: ["Jeff Bennett"] }
  });
  await rememberRecord("calendar-events", {
    id: `${runId}-forsters`,
    title: "Proof dinner with the Forsters",
    summary: "Simple family dinner and summer-plan catch-up.",
    date: today,
    start_at_ms: dayAt(0, 18, 0),
    end_at_ms: dayAt(0, 19, 0),
    html: "<!doctype html><h1>Proof dinner with the Forsters</h1><p>Overlap proof event for the compact agenda cluster.</p>",
    metadata: { place: "Forster house", type: "family", attendees: ["Jeff Bennett"] }
  });
  await rememberRecord("calendar-events", {
    id: `${runId}-clinic`,
    title: "Proof clinic paperwork check-in",
    summary: "Forms, prep questions, and timing.",
    date: tomorrow,
    start_at_ms: dayAt(1, 11, 0),
    end_at_ms: dayAt(1, 11, 30),
    html: "<!doctype html><h1>Proof clinic paperwork check-in</h1><p>Health proof event.</p>",
    metadata: { place: "Westside Clinic", type: "health", attendees: ["Clinic front desk"] }
  });
  await rememberRecord("calendar-events", {
    id: `${runId}-late-call`,
    title: "Proof late call",
    summary: "Moves to tomorrow in New York",
    date: today,
    start_at_ms: dayAt(0, 23, 30),
    end_at_ms: dayAt(0, 23, 50),
    html: "<!doctype html><h1>Proof late call</h1><p>Timezone shift proof event.</p>",
    metadata: { place: "Phone", type: "call", attendees: ["Jimmy Torres"] }
  });
  await rememberRecord("calendar-events", {
    id: `${runId}-coffee`,
    title: "Proof coffee catch-up",
    summary: "Intentional day-after event",
    date: dayAfter,
    start_at_ms: dayAt(2, 10, 0),
    end_at_ms: dayAt(2, 10, 30),
    html: "<!doctype html><h1>Proof coffee catch-up</h1><p>Day-after event for empty-day checks.</p>",
    metadata: { place: "Northside", type: "personal" }
  });

  await rememberLink({
    id: `${runId}-link-contact-jimmy`,
    source_kind: "calendar_event",
    source_id: `${runId}-freelance-review`,
    target_kind: "contact",
    target_id: `${runId}-jimmy-torres`,
    label: "Jimmy Torres"
  });
  await rememberLink({
    id: `${runId}-link-contact-jeff`,
    source_kind: "calendar_event",
    source_id: `${runId}-freelance-review`,
    target_kind: "contact",
    target_id: `${runId}-jeff-bennett`,
    label: "Jeff Bennett"
  });
  await rememberLink({
    id: `${runId}-link-project`,
    source_kind: "calendar_event",
    source_id: `${runId}-freelance-review`,
    target_kind: "project",
    target_id: `${runId}-project`,
    label: "Proof freelance follow-up"
  });
  await rememberLink({
    id: `${runId}-link-task`,
    source_kind: "calendar_event",
    source_id: `${runId}-freelance-review`,
    target_kind: "task",
    target_id: `${runId}-task`,
    label: "Send proof review notes"
  });
  await rememberLink({
    id: `${runId}-link-note`,
    source_kind: "calendar_event",
    source_id: `${runId}-freelance-review`,
    target_kind: "note",
    target_id: `${runId}-note`,
    label: "Proof review outline"
  });
  await rememberLink({
    id: `${runId}-link-meeting-note`,
    source_kind: "calendar_event",
    source_id: `${runId}-freelance-review`,
    target_kind: "meeting_note",
    target_id: `${runId}-meeting-note`,
    label: "Proof freelance prep"
  });
  await rememberLink({
    id: `${runId}-link-reminder`,
    source_kind: "calendar_event",
    source_id: `${runId}-freelance-review`,
    target_kind: "reminder",
    target_id: `${runId}-reminder`,
    label: "Send proof HTML before call"
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

async function openCalendarSettings(page) {
  await page.locator(".light-calendar-settings-button").click();
  await page.locator(".calendar-settings-panel").waitFor({ state: "visible" });
}

async function closeCalendarSettings(page) {
  await page.locator(".calendar-settings-sheet-done").click();
  await page.locator(".calendar-settings-panel").waitFor({ state: "hidden" });
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

async function pageHeaderText(page) {
  return String(await page.locator(".light-page-header").textContent() || "").replace(/\s+/g, " ").trim();
}

async function waitForHeaderText(page, text) {
  await page.waitForFunction(target => {
    const header = document.querySelector(".light-page-header");
    return Boolean(header && String(header.textContent || "").includes(String(target || "")));
  }, text);
}

async function currentLightRoute(page) {
  return String(await page.locator(".light-shell").getAttribute("data-light-route") || "");
}

async function waitForSelectorText(page, selector, text) {
  await page.waitForFunction(({ targetSelector, targetText }) => {
    const node = document.querySelector(String(targetSelector || ""));
    return Boolean(node && String(node.textContent || "").includes(String(targetText || "")));
  }, { targetSelector: selector, targetText: text });
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

async function calendarChromeText(page) {
  return page.evaluate(() => {
    const chrome = document.querySelector(".light-date-picker");
    return String(chrome?.textContent || "").replace(/\s+/g, " ").trim();
  });
}

async function calendarLaneWidth(page) {
  return page.evaluate(() => Math.round(document.querySelector(".light-calendar-page")?.getBoundingClientRect().width ?? 0));
}

async function calendarStripMetrics(page) {
  return page.locator(".light-calendar-day-strip").evaluate(node => ({
    scrollLeft: Math.round(node.scrollLeft || 0),
    scrollWidth: Math.round(node.scrollWidth || 0),
    clientWidth: Math.round(node.clientWidth || 0),
    childCount: node.querySelectorAll(".light-calendar-day-chip").length
  }));
}

async function settingsPanelMetrics(page) {
  return page.locator(".calendar-settings-panel").evaluate(node => {
    const rect = node.getBoundingClientRect();
    return {
      top: Math.round(rect.top),
      left: Math.round(rect.left),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight
    };
  });
}

function normalizeTexts(values) {
  return values.map(value => String(value || "").replace(/\s+/g, " ").trim()).filter(Boolean);
}

async function assertChipContrast(page, selector) {
  const metrics = await page.locator(selector).first().evaluate(node => {
    const style = getComputedStyle(node);
    const toRgb = value => String(value || "").match(/\d+/g)?.slice(0, 3).map(Number) || [0, 0, 0];
    const fg = toRgb(style.color);
    const bg = toRgb(style.backgroundColor);
    const delta = Math.abs(fg[0] - bg[0]) + Math.abs(fg[1] - bg[1]) + Math.abs(fg[2] - bg[2]);
    return { delta, color: style.color, background: style.backgroundColor };
  });
  assert(metrics.delta >= 60, `Expected readable chip contrast for ${selector}, got ${JSON.stringify(metrics)}.`);
}

async function gapMetrics(page) {
  return page.locator(".light-calendar-gap").first().evaluate(node => {
    const gapRect = node.getBoundingClientRect();
    const laneRect = node.parentElement?.getBoundingClientRect();
    const label = node.querySelector(".light-calendar-gap-label")?.textContent?.replace(/\s+/g, " ").trim() || "";
    return {
      gapWidth: Math.round(gapRect.width),
      laneWidth: Math.round(laneRect?.width || 0),
      label
    };
  });
}

async function allText(page, selector) {
  return normalizeTexts(await page.locator(selector).allTextContents());
}

async function scrollDayStripWithButton(page, direction = 1) {
  const buttons = page.locator(".light-calendar-strip-nav-button");
  const buttonIndex = direction > 0 ? (await buttons.count()) - 1 : 0;
  const before = await calendarStripMetrics(page);
  await buttons.nth(buttonIndex).click();
  await page.waitForFunction(previous => {
    const strip = document.querySelector(".light-calendar-day-strip");
    return Boolean(strip && Math.abs((strip.scrollLeft || 0) - Number(previous || 0)) >= 24);
  }, before.scrollLeft);
}

async function scrollDayStripDirect(page, amount = 180) {
  const before = await calendarStripMetrics(page);
  await page.locator(".light-calendar-day-strip").evaluate((node, delta) => {
    node.scrollBy({ left: Number(delta || 0), behavior: "instant" });
  }, amount);
  await page.waitForFunction(previous => {
    const strip = document.querySelector(".light-calendar-day-strip");
    return Boolean(strip && Math.abs((strip.scrollLeft || 0) - Number(previous || 0)) >= 24);
  }, before.scrollLeft);
}

async function setCalendarTypeEnabled(page, label, enabled) {
  const row = page.locator(".calendar-type-filter-row", { hasText: label }).first();
  const toggle = row.locator(".calendar-type-filter-toggle");
  const current = await toggle.isChecked();
  if (current !== enabled) {
    await toggle.click();
  }
}

async function selectConnectedChip(page, label) {
  await page.locator(".light-event-connected-card .light-attendee-chip", { hasText: label }).first().click();
}

function proofEventSelector(seed) {
  return `.light-event-block[data-event-id="${seed.runId}-freelance-review"]`;
}

function proofLateCallSelector(seed) {
  return `.light-event-block[data-event-id="${seed.runId}-late-call"]`;
}

async function selectAgendaChip(page, seed, label) {
  await page.locator(`${proofEventSelector(seed)} .light-attendee-chip`, { hasText: label }).first().click();
}

async function selectCalendarEvent(page, seed) {
  await page.locator(`${proofEventSelector(seed)} .light-event-main`).click();
  await waitForHeaderText(page, "Proof freelance review call");
}

async function selectCalendarDetailTarget(page, label, route, expectedText) {
  await selectConnectedChip(page, label);
  if (route === "contact-detail") {
    await waitForSelectorText(page, ".light-profile-card h1", expectedText);
  } else if (route === "task-detail") {
    await waitForSelectorText(page, ".light-shell", expectedText);
  } else if (route === "reminder-detail") {
    await waitForSelectorText(page, ".light-shell", expectedText);
  } else {
    await waitForHeaderText(page, expectedText);
  }
  assert(await currentLightRoute(page) === route, `Expected ${route} after selecting ${label}, got ${await currentLightRoute(page)}.`);
}

async function selectTimezone(page, value) {
  const select = page.locator('.settings-native-select');
  await select.selectOption(value);
}

async function runDesktopScenario(browser, config, seed, summary, consoleLog, networkLog, theme = "light") {
  const reportDir = path.join(config.reportDir, `desktop-${theme}`);
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
    await page.goto(pageUrl(config.baseUrl, config.apiToken, theme), { waitUntil: "networkidle", timeout: config.timeoutMs });
    await page.locator('.light-app-tile[data-route="calendar"]').waitFor({ state: "visible" });
    await openHomeCalendar(page);

    const initialDate = await page.locator(".light-date-input").inputValue();
    assert(initialDate === seed.today, `Calendar should open on local today ${seed.today}, got ${initialDate}`);
    const chromeText = await calendarChromeText(page);
    assert(!chromeText.includes("Pinned"), "Expected calendar chrome to hide Pinned copy.");
    assert(!chromeText.includes("Device local"), "Expected calendar chrome to hide Device local copy.");
    assert(!chromeText.includes("America/"), "Expected calendar chrome to hide raw timezone text.");
    assert(!chromeText.includes("Jump to date"), "Expected compact calendar chrome without Jump to date copy.");
    assert(!chromeText.includes("Busy window"), "Expected calendar chrome to drop Busy window copy.");
    assert(await page.locator(".light-calendar-today-button").count() === 0, "Expected Today chip to stay hidden when the selected day is already today.");
    const stripMetrics = await calendarStripMetrics(page);
    assert(stripMetrics.childCount === 21, `Expected the desktop day strip to render twenty-one chips, got ${stripMetrics.childCount}.`);
    assert(await page.locator(".light-calendar-strip-nav-button").count() === 2, "Expected desktop calendar arrows for strip navigation.");
    assert(await page.locator(".light-event-badge").count() === 0, "Expected agenda cards to hide the legacy type badge.");
    const todayTitles = await visibleCalendarTitles(page);
    assert(todayTitles.includes("Proof freelance review call"), "Expected the linked proof review call on the device-local today view.");
    assert(todayTitles.includes("Proof Katy pickup handoff"), "Expected clustered family logistics on today.");
    assert(await calendarLaneWidth(page) >= 820, `Expected a widened desktop calendar lane, got ${await calendarLaneWidth(page)}px.`);
    const eventSelector = proofEventSelector(seed);
    await page.waitForFunction(selector => document.querySelectorAll(`${selector} .light-attendee-chip`).length >= 2, eventSelector);
    assert(await page.locator(`${eventSelector} .light-event-summary`).count() === 0, "Expected agenda cards to drop summary text.");
    const agendaChipTexts = await allText(page, `${eventSelector} .light-attendee-chip`);
    for (const label of ["Jimmy T.", "Jeff B."]) {
      assert(agendaChipTexts.includes(label), `Expected agenda contact chips to include ${label}, got ${agendaChipTexts.join(", ")}.`);
    }
    assert(agendaChipTexts.length === 2, `Expected agenda cards to show only recognized contacts, got ${agendaChipTexts.join(", ")}.`);
    assert(!agendaChipTexts.includes("Kitchen table"), "Expected place to stay out of calendar agenda chips.");
    for (const label of ["Proof freelance follow-up", "Send proof review notes", "Proof review outline", "Proof freelance prep", "Send proof HTML before call"]) {
      assert(!agendaChipTexts.includes(label), `Expected agenda cards to hide non-contact graph chips like ${label}.`);
    }
    const firstGap = await gapMetrics(page);
    assert(/^Free .+ - .+$/.test(firstGap.label), `Expected explicit free-range copy, got ${firstGap.label}.`);
    assert(firstGap.laneWidth > 0 && firstGap.gapWidth >= firstGap.laneWidth - 24, `Expected a near full-width free banner, got ${JSON.stringify(firstGap)}.`);
    await assertChipContrast(page, `${eventSelector} .light-attendee-chip.is-link`);
    assert(await page.locator(eventSelector).evaluate(node => node.className.includes("blue")), "Expected the freelance review card to use the shared blue tone.");
    assert(await page.locator(".light-calendar-day-chip.is-selected .light-calendar-day-dot.blue").count() >= 1, "Expected the selected day strip to use the same blue tone for the freelance event.");
    await saveShot(page, reportDir, `calendar-desktop-${theme}-today.png`, summary);
    await scrollDayStripWithButton(page, 1);
    await saveShot(page, reportDir, `calendar-desktop-${theme}-day-rail-scroll.png`, summary);

    await selectAgendaChip(page, seed, "Jimmy T.");
    await waitForSelectorText(page, ".light-profile-card h1", "Jimmy Torres");
    assert(await currentLightRoute(page) === "contact-detail", `Expected contact-detail route after agenda chip tap, got ${await currentLightRoute(page)}.`);
    await saveShot(page, reportDir, `calendar-desktop-${theme}-agenda-chip-contact.png`, summary);
    await page.getByRole("button", { name: "Back" }).click();
    await page.locator(".light-date-input").waitFor({ state: "visible" });
    assert(await currentLightRoute(page) === "calendar", `Expected Back from agenda chip to restore calendar, got ${await currentLightRoute(page)}.`);
    assert(await page.locator(".light-date-input").inputValue() === seed.today, "Expected calendar agenda Back to preserve the selected day.");
    assert((await visibleCalendarTitles(page)).includes("Proof freelance review call"), "Expected the source event to remain visible after returning to the agenda.");
    await saveShot(page, reportDir, `calendar-desktop-${theme}-agenda-after-back.png`, summary);

    await selectCalendarEvent(page, seed);
    assert((await pageHeaderText(page)).includes("Proof freelance review call"), "Expected the event detail header to use the real event title.");
    assert(await page.locator(".light-event-detail-time").count() === 0, "Expected event detail to remove the redundant time line beneath the header.");
    assert(await page.locator(".light-doc-eyebrow").count() === 0, "Expected the calendar detail eyebrow to be removed.");
    assert(await page.locator(".light-doc-article h1").count() === 0, "Expected calendar detail to avoid repeating the title in a large H1.");
    const detailText = String(await page.locator(".light-document-page").textContent() || "").replace(/\s+/g, " ").trim();
    assert(/details/i.test(detailText), "Expected event detail to render the Details section.");
    assert(/description/i.test(detailText), "Expected event detail to render a Description section.");
    const detailSectionTitles = (await allText(page, ".light-document-page .light-section-title")).map(value => value.toUpperCase());
    assert(detailSectionTitles.includes("DETAILS"), `Expected event detail section titles to include Details, got ${detailSectionTitles.join(", ")}.`);
    assert(detailSectionTitles.includes("DESCRIPTION"), `Expected event detail section titles to include Description, got ${detailSectionTitles.join(", ")}.`);
    assert(detailSectionTitles.indexOf("DETAILS") < detailSectionTitles.indexOf("DESCRIPTION"), `Expected Details to appear before Description, got ${detailSectionTitles.join(", ")}.`);
    assert(!detailText.includes("Linked records"), "Expected event detail to collapse Linked records into Connected chips.");
    const whoChipTexts = await allText(page, '.light-calendar-detail-row[data-detail-row="who"] .light-attendee-chip');
    for (const label of ["Jimmy T.", "Jeff B."]) {
      assert(whoChipTexts.includes(label), `Expected Who to include ${label}, got ${whoChipTexts.join(", ")}.`);
    }
    const connectedChipTexts = await allText(page, ".light-event-connected-card .light-attendee-chip");
    for (const label of ["Proof freelance follow-up", "Send proof review notes", "Proof review outline", "Proof freelance prep", "Send proof HTML before call"]) {
      assert(connectedChipTexts.includes(label), `Expected Connected to include ${label}, got ${connectedChipTexts.join(", ")}.`);
    }
    assert(!connectedChipTexts.includes("Jimmy T."), "Expected contact chips to stay in Who, not Connected.");
    assert(!connectedChipTexts.includes("Jeff B."), "Expected contact chips to stay in Who, not Connected.");
    assert(!connectedChipTexts.includes("Kitchen table"), "Expected place to stay out of Connected chips on detail.");
    assert(await page.locator('.light-calendar-detail-row[data-detail-row="place"] .light-attendee-chip').count() === 0, "Expected Place to stay plain text only.");
    await assertChipContrast(page, ".light-event-connected-card .light-attendee-chip.is-link");
    await saveShot(page, reportDir, `calendar-desktop-${theme}-event-detail.png`, summary);
    await page.locator('.light-calendar-detail-row[data-detail-row="who"] .light-attendee-chip', { hasText: "Jimmy T." }).first().click();
    await waitForSelectorText(page, ".light-profile-card h1", "Jimmy Torres");
    assert(await currentLightRoute(page) === "contact-detail", `Expected contact-detail route after Who chip tap, got ${await currentLightRoute(page)}.`);
    await page.getByRole("button", { name: "Back" }).click();
    assert(await currentLightRoute(page) === "meeting-detail", `Expected Back from Who chip to restore meeting-detail, got ${await currentLightRoute(page)}.`);
    await waitForHeaderText(page, "Proof freelance review call");
    for (const target of [
      { label: "Proof freelance follow-up", route: "project-detail", expectedText: "Proof freelance follow-up" },
      { label: "Send proof review notes", route: "task-detail", expectedText: "Send proof review notes" },
      { label: "Proof review outline", route: "note-detail", expectedText: "Proof review outline" },
      { label: "Proof freelance prep", route: "meeting-note-detail", expectedText: "Proof freelance prep" },
      { label: "Send proof HTML before call", route: "reminder-detail", expectedText: "Send proof HTML before call" }
    ]) {
      await selectCalendarDetailTarget(page, target.label, target.route, target.expectedText);
      await saveShot(page, reportDir, `calendar-desktop-${theme}-${target.route}.png`, summary);
      await page.getByRole("button", { name: "Back" }).click();
      assert(await currentLightRoute(page) === "meeting-detail", `Expected Back from ${target.label} to restore meeting-detail, got ${await currentLightRoute(page)}.`);
      await waitForHeaderText(page, "Proof freelance review call");
    }
    await page.getByRole("button", { name: "Back" }).click();
    await page.locator(".light-date-input").waitFor({ state: "visible" });
    assert(await currentLightRoute(page) === "calendar", `Expected Back from event detail to restore calendar, got ${await currentLightRoute(page)}.`);
    assert(await page.locator(".light-date-input").inputValue() === seed.today, "Expected event-detail Back to preserve the selected day.");
    summary.assertions.push(`desktop ${theme} calendar detail kept full chip navigation and Back restoration`);

    await setCalendarDate(page, seed.emptyDay);
    await page.locator(".light-empty-state").waitFor({ state: "visible" });
    const emptyCopy = await page.locator(".light-empty-state").textContent();
    assert(
      String(emptyCopy || "").includes("No events tomorrow") || String(emptyCopy || "").includes("No events on"),
      "Expected date-aware empty-state copy on an empty day."
    );
    await saveShot(page, reportDir, `calendar-desktop-${theme}-empty-day.png`, summary);

    await goHome(page);
    await openHomeCalendar(page);
    const reopenedDate = await page.locator(".light-date-input").inputValue();
    assert(reopenedDate === seed.today, `Calendar should reset to today after Home re-entry, got ${reopenedDate}`);
    summary.assertions.push(`desktop ${theme} calendar home entry resets to today`);

    const scrollMetrics = await stickyMetrics(page);
    assert(scrollMetrics.headerTop <= 1, `Expected sticky header to pin at top, got ${scrollMetrics.headerTop}`);
    assert(scrollMetrics.controlsTop >= 0 && scrollMetrics.controlsTop < 140, `Expected sticky controls to remain visible, got ${scrollMetrics.controlsTop}`);
    await saveShot(page, reportDir, `calendar-desktop-${theme}-scrolled.png`, summary);
    summary.assertions.push(`desktop ${theme} sticky header and controls stayed pinned`);

    await openCalendarSettings(page);
    const timezoneCount = await page.locator('.settings-native-select').count();
    assert(timezoneCount === 1, `Expected one calendar-local time zone select, got ${timezoneCount}.`);
    assert(await page.locator(".calendar-type-filter-row").count() === 6, "Expected six semantic event-type filter rows.");
    const desktopSettingsMetrics = await settingsPanelMetrics(page);
    assert(desktopSettingsMetrics.top >= 16, `Expected a centered desktop settings modal, got ${JSON.stringify(desktopSettingsMetrics)}.`);
    assert(desktopSettingsMetrics.height < desktopSettingsMetrics.viewportHeight, `Expected desktop settings to avoid full-height overlay, got ${JSON.stringify(desktopSettingsMetrics)}.`);
    const settingsCopy = await page.locator(".calendar-settings-panel").textContent();
    assert(!String(settingsCopy || "").includes("[object HTMLHeadingElement]"), "Expected calendar settings sheet to render clean copy without object text.");
    await setCalendarTypeEnabled(page, "Freelance / Work", false);
    await page.waitForFunction(selector => !document.querySelector(selector), eventSelector);
    assert((await visibleCalendarTitles(page)).every(title => title !== "Proof freelance review call"), "Expected the freelance filter to hide the proof review event.");
    assert(await page.locator(".light-calendar-day-chip.is-selected .light-calendar-day-dot.blue").count() === 0, "Expected the selected-day blue dot to hide with the freelance filter disabled.");
    await saveShot(page, reportDir, `calendar-desktop-${theme}-filtered.png`, summary);
    await setCalendarTypeEnabled(page, "Freelance / Work", true);
    await page.waitForFunction(selector => Boolean(document.querySelector(selector)), eventSelector);
    await selectTimezone(page, "America/New_York");
    await saveShot(page, reportDir, `calendar-desktop-${theme}-settings-sheet.png`, summary);
    await closeCalendarSettings(page);
    const lateCallSelector = proofLateCallSelector(seed);
    assert(await page.locator(lateCallSelector).count() === 0, "Expected the seeded late-call event to move off the selected day after timezone switch.");
    await setCalendarDate(page, seed.tomorrow);
    assert(await page.locator(lateCallSelector).count() === 1, "Expected the seeded late-call event to appear on tomorrow in New York.");
    const lateCallTime = String(await page.locator(`${lateCallSelector} .light-event-time`).textContent() || "").trim();
    assert(lateCallTime.includes("2:30 AM"), `Expected the seeded late-call event to shift to 2:30 AM in New York, got ${lateCallTime}.`);
    await saveShot(page, reportDir, `calendar-desktop-${theme}-timezone-shift.png`, summary);
    summary.assertions.push(`desktop ${theme} timezone switch changed calendar grouping and times`);
  } finally {
    await context.tracing.stop({ path: path.join(reportDir, `trace-desktop-${theme}.zip`) });
    await context.close();
  }
}

async function runMobileScenario(browser, config, seed, summary, consoleLog, networkLog, theme = "light") {
  const reportDir = path.join(config.reportDir, `mobile-${theme}`);
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
    await page.goto(pageUrl(config.baseUrl, config.apiToken, theme), { waitUntil: "networkidle", timeout: config.timeoutMs });
    await page.locator('.light-app-tile[data-route="calendar"]').waitFor({ state: "visible" });
    await openHomeCalendar(page);
    const chromeText = await calendarChromeText(page);
    assert(await page.locator(".light-date-input").count() === 1, "Expected a native date input on mobile.");
    const stripMetrics = await calendarStripMetrics(page);
    assert(stripMetrics.childCount === 15, `Expected the mobile day strip to render fifteen chips, got ${stripMetrics.childCount}.`);
    assert(!chromeText.includes("Pinned"), "Expected mobile calendar chrome to hide Pinned copy.");
    assert(!chromeText.includes("Device local"), "Expected mobile calendar chrome to hide Device local copy.");
    assert(!chromeText.includes("America/"), "Expected mobile calendar chrome to hide raw timezone text.");
    assert(!chromeText.includes("Jump to date"), "Expected mobile calendar chrome without Jump to date copy.");
    assert(!chromeText.includes("Busy window"), "Expected mobile calendar chrome to drop Busy window copy.");
    assert(await page.locator(".light-calendar-today-button").count() === 0, "Expected Today chip to stay hidden on the already-selected mobile today view.");
    assert(await page.locator(".light-event-badge").count() === 0, "Expected mobile agenda cards to hide the legacy type badge.");
    const eventSelector = proofEventSelector(seed);
    await page.waitForFunction(selector => document.querySelectorAll(`${selector} .light-attendee-chip`).length >= 2, eventSelector);
    assert(await page.locator(`${eventSelector} .light-event-summary`).count() === 0, "Expected mobile agenda cards to drop summary text.");
    const mobileChipTexts = await allText(page, `${eventSelector} .light-attendee-chip`);
    for (const label of ["Jimmy T.", "Jeff B."]) {
      assert(mobileChipTexts.includes(label), `Expected mobile agenda contact chips to include ${label}, got ${mobileChipTexts.join(", ")}.`);
    }
    assert(mobileChipTexts.length === 2, `Expected mobile agenda cards to stay contacts-only, got ${mobileChipTexts.join(", ")}.`);
    assert(!mobileChipTexts.includes("Kitchen table"), "Expected place to stay out of mobile agenda chips.");
    for (const label of ["Proof freelance follow-up", "Send proof review notes", "Proof review outline", "Proof freelance prep", "Send proof HTML before call"]) {
      assert(!mobileChipTexts.includes(label), `Expected mobile agenda cards to hide non-contact graph chips like ${label}.`);
    }
    const mobileGap = await gapMetrics(page);
    assert(/^Free .+ - .+$/.test(mobileGap.label), `Expected mobile free-range copy, got ${mobileGap.label}.`);
    await assertChipContrast(page, `${eventSelector} .light-attendee-chip.is-link`);
    await saveShot(page, reportDir, `calendar-mobile-${theme}-top.png`, summary);
    await scrollDayStripDirect(page, 220);
    await saveShot(page, reportDir, `calendar-mobile-${theme}-day-rail-scroll.png`, summary);
    await selectCalendarEvent(page, seed);
    assert(await page.locator(".light-event-detail-time").count() === 0, "Expected mobile event detail to remove the redundant time line beneath the header.");
    assert(await page.locator(".light-doc-eyebrow").count() === 0, "Expected the mobile detail eyebrow to be removed.");
    assert(await page.locator(".light-doc-article h1").count() === 0, "Expected the mobile detail to avoid a duplicated large title.");
    const mobileDetailText = String(await page.locator(".light-document-page").textContent() || "").replace(/\s+/g, " ").trim();
    const mobileSectionTitles = (await allText(page, ".light-document-page .light-section-title")).map(value => value.toUpperCase());
    assert(mobileSectionTitles.includes("DETAILS"), `Expected mobile event detail section titles to include Details, got ${mobileSectionTitles.join(", ")}.`);
    assert(mobileSectionTitles.includes("DESCRIPTION"), `Expected mobile event detail section titles to include Description, got ${mobileSectionTitles.join(", ")}.`);
    assert(mobileSectionTitles.indexOf("DETAILS") < mobileSectionTitles.indexOf("DESCRIPTION"), `Expected mobile Details to appear before Description, got ${mobileSectionTitles.join(", ")}.`);
    assert(!mobileDetailText.includes("Linked records"), "Expected mobile event detail to collapse Linked records into Connected chips.");
    const mobileWhoChipTexts = await allText(page, '.light-calendar-detail-row[data-detail-row="who"] .light-attendee-chip');
    assert(mobileWhoChipTexts.includes("Jimmy T.") && mobileWhoChipTexts.includes("Jeff B."), `Expected mobile Who row to carry contact chips, got ${mobileWhoChipTexts.join(", ")}.`);
    const mobileConnectedChipTexts = await allText(page, ".light-event-connected-card .light-attendee-chip");
    assert(!mobileConnectedChipTexts.includes("Jimmy T.") && !mobileConnectedChipTexts.includes("Jeff B."), `Expected mobile Connected chips to exclude contacts, got ${mobileConnectedChipTexts.join(", ")}.`);
    await assertChipContrast(page, ".light-event-connected-card .light-attendee-chip.is-link");
    await saveShot(page, reportDir, `calendar-mobile-${theme}-detail.png`, summary);
    await page.getByRole("button", { name: "Back" }).click();
    await page.locator(".light-date-input").waitFor({ state: "visible" });
    const metrics = await stickyMetrics(page);
    assert(metrics.headerTop <= 1, `Expected mobile header to stay pinned, got ${metrics.headerTop}`);
    assert(metrics.controlsTop >= 0 && metrics.controlsTop < 140, `Expected mobile controls row to stay pinned, got ${metrics.controlsTop}`);
    await saveShot(page, reportDir, `calendar-mobile-${theme}-scrolled.png`, summary);
    await openCalendarSettings(page);
    assert(await page.locator(".calendar-type-filter-row").count() === 6, "Expected six mobile semantic event-type filter rows.");
    const mobileSettingsMetrics = await settingsPanelMetrics(page);
    assert(mobileSettingsMetrics.top <= 40, `Expected mobile settings to dock within the safe-area top edge, got ${JSON.stringify(mobileSettingsMetrics)}.`);
    assert(mobileSettingsMetrics.height >= Math.round(mobileSettingsMetrics.viewportHeight * 0.85), `Expected a tall mobile settings overlay, got ${JSON.stringify(mobileSettingsMetrics)}.`);
    await saveShot(page, reportDir, `calendar-mobile-${theme}-settings-sheet.png`, summary);
    await closeCalendarSettings(page);
    await page.evaluate(() => {
      const feed = document.querySelector(".feed");
      if (feed && typeof feed.scrollTo === "function") {
        feed.scrollTo({ top: 9999, left: 0, behavior: "instant" });
      }
    });
    await page.locator('.light-event-title', { hasText: "Proof late call" }).click();
    await waitForHeaderText(page, "Proof late call");
    const detailTop = await page.evaluate(() => {
      const header = document.querySelector(".light-page-header");
      const feed = document.querySelector(".feed");
      return {
        headerTop: Math.round(header?.getBoundingClientRect().top ?? -999),
        feedScrollTop: Math.round(feed?.scrollTop ?? -1)
      };
    });
    assert(detailTop.headerTop <= 1, `Expected deep-scroll event taps to land with the header visible, got ${JSON.stringify(detailTop)}.`);
    assert(detailTop.feedScrollTop <= 24, `Expected deep-scroll event detail to open near the top, got ${JSON.stringify(detailTop)}.`);
    await saveShot(page, reportDir, `calendar-mobile-${theme}-late-call-detail.png`, summary);
    summary.assertions.push(`mobile ${theme} sticky header, full chips, and lean event detail stayed readable`);
  } finally {
    await context.tracing.stop({ path: path.join(reportDir, `trace-mobile-${theme}.zip`) });
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
    await runDesktopScenario(browser, config, seed, summary, consoleLog, networkLog, "light");
    await runDesktopScenario(browser, config, seed, summary, consoleLog, networkLog, "dark");
    await runMobileScenario(browser, config, seed, summary, consoleLog, networkLog, "light");
    await runMobileScenario(browser, config, seed, summary, consoleLog, networkLog, "dark");
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
