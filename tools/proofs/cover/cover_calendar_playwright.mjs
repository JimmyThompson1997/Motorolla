import fs from "node:fs";
import path from "node:path";

import { chromium, webkit } from "playwright-core";
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
const CALENDAR_SELECTION_MOTION_DURATION_MS = 180;
const CALENDAR_SELECTION_MOTION_MIN_MS = 120;
const CALENDAR_SELECTION_MOTION_MAX_MS = 280;
const CALENDAR_SELECTION_MOTION_MID_CAPTURE_MS = 80;
const LOCATOR_SHOT_ATTEMPTS = 4;
const LOCATOR_SHOT_RETRY_MS = 150;
const MANIFEST_FETCH_ATTEMPTS = 4;
const MANIFEST_FETCH_RETRY_MS = 750;
const CALENDAR_EVENT_CONTAINER_ATTEMPTS = 4;
const CALENDAR_EVENT_CONTAINER_RETRY_MS = 250;
const CALENDAR_TONES = Object.freeze(["red", "blue", "green", "amber", "purple", "slate"]);

function resolveApiToken() {
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
    timeoutMs: 30000,
    browserName: "chromium"
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
    } else if (arg === "--browser" && argv[index + 1]) {
      const browserName = String(argv[++index] || config.browserName).trim().toLowerCase();
      config.browserName = browserName === "webkit" ? "webkit" : "chromium";
    }
  }
  return config;
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function delay(ms) {
  await new Promise(resolve => setTimeout(resolve, Math.max(0, Number(ms || 0))));
}

function dateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function dateKeyInTimeZone(timestampMs, timeZone) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).formatToParts(new Date(Number(timestampMs || 0))).map(part => [part.type, part.value])
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function dayAt(offsetDays, hour, minute = 0) {
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);
  date.setHours(hour, minute, 0, 0);
  return date.getTime();
}

function pageUrl(baseUrl, apiToken = "", theme = "light") {
  const root = new URL(baseUrl);
  const refreshValue = root.searchParams.get("_pucky_refresh");
  const url = new URL("/ui/pucky/latest/index.html", root);
  url.searchParams.set("theme", theme);
  url.searchParams.set("reset_nav", "1");
  url.searchParams.set("_pucky_refresh", String(refreshValue || Date.now()));
  void apiToken;
  return url.toString();
}

async function apiRequest(config, method, apiPath, body = undefined) {
  const headers = { Accept: "application/json" };
  if (config.apiToken) {
    headers.Authorization = `Bearer ${config.apiToken}`;
  }
  const response = await fetch(new URL(apiPath, config.baseUrl), {
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
  const yesterday = dateKey(new Date(Date.now() - 24 * 60 * 60 * 1000));
  const today = dateKey(new Date());
  const tomorrow = dateKey(new Date(Date.now() + 24 * 60 * 60 * 1000));
  const dayAfter = dateKey(new Date(Date.now() + 2 * 24 * 60 * 60 * 1000));
  const emptyDay = dateKey(new Date(Date.now() + 5 * 24 * 60 * 60 * 1000));
  const lateCallStartMs = dayAt(0, 23, 30);
  const lateCallEndMs = dayAt(0, 23, 50);
  const seed = {
    runId,
    writeEnabled: true,
    records: [],
    linkIds: [],
    yesterday,
    today,
    tomorrow,
    dayAfter,
    emptyDay,
    lateCallStartMs,
    lateCallNewYorkDay: dateKeyInTimeZone(lateCallStartMs, "America/New_York"),
    lateCallNewYorkTime: new Date(lateCallStartMs).toLocaleTimeString("en-US", {
      timeZone: "America/New_York",
      hour: "numeric",
      minute: "2-digit"
    })
  };
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
  await rememberRecord("contacts", {
    id: `${runId}-outside-counsel`,
    title: "Outside counsel",
    summary: "Proof role-style contact",
    html: "<!doctype html><h1>Outside counsel</h1><p>Proof contact to keep role titles recognizable in Calendar attendees.</p>",
    metadata: { photo: "fixtures/contact_photos/maya.svg", email: "counsel@example.com", phone: "+1 (415) 555-0103" }
  });
  await rememberRecord("contacts", {
    id: `${runId}-clinic-front-desk`,
    title: "Clinic front desk",
    summary: "Proof clinic role contact",
    html: "<!doctype html><h1>Clinic front desk</h1><p>Proof contact for the clinic check-in event.</p>",
    metadata: { photo: "fixtures/contact_photos/proof-contact.webp", email: "frontdesk@example.com", phone: "+1 (415) 555-0104" }
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
  await rememberRecord("notes", {
    id: `${runId}-late-note`,
    title: "Late-call follow-up",
    summary: "Single linked note to keep the sparse connected card intentional.",
    html: "<!doctype html><h1>Late-call follow-up</h1><p>Standalone note linked from the late proof event.</p>",
    metadata: { tags: ["Calendar", "Follow-up"] }
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
    title: "Send proof review notes",
    summary: "Reminder sibling for the linked task title.",
    status: "open",
    due_at_ms: dayAt(0, 8, 30),
    html: "<!doctype html><h1>Send proof review notes</h1><p>Reminder linked back to the proof review event and task.</p>",
    metadata: { source_kind: "calendar_event", source_id: `${runId}-freelance-review`, snooze_state: "ready" }
  });
  await rememberRecord("calendar-events", {
    id: `${runId}-yesterday-walk`,
    title: "Proof porch material pickup",
    summary: "A seeded yesterday event to stabilize day-rail dot proofing.",
    date: yesterday,
    start_at_ms: dayAt(-1, 15, 0),
    end_at_ms: dayAt(-1, 15, 30),
    html: "<!doctype html><h1>Proof porch material pickup</h1><p>Yesterday proof event for stable day-rail dots.</p>",
    metadata: { place: "Harbor Lumber", type: "personal" }
  });
  await rememberRecord("calendar-events", {
    id: `${runId}-freelance-review`,
    title: "Proof freelance review call",
    summary: "Homepage pass, invoice cleanup, and the next edit round. Join via https://meet.google.com/proof-review-room.",
    date: today,
    start_at_ms: dayAt(0, 9, 30),
    end_at_ms: dayAt(0, 10, 15),
    html: "<!doctype html><h1>Proof freelance review call</h1><p>Graph-linked proof event for attendee chips and cross-app navigation.</p>",
    metadata: { place: "Kitchen table", type: "freelance", attendees: ["Jimmy Torres", "Jeff Bennett", "Outside counsel"] }
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
    metadata: {
      place: "Westside Clinic",
      address: "11714 Wilshire Blvd, Suite 12, Los Angeles, CA 90025",
      type: "health",
      attendees: ["Clinic front desk"]
    }
  });
  await rememberRecord("calendar-events", {
    id: `${runId}-late-call`,
    title: "Proof late call",
    summary: "Moves to tomorrow in New York",
    date: today,
    start_at_ms: lateCallStartMs,
    end_at_ms: lateCallEndMs,
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
    label: "Send proof review notes"
  });
  await rememberLink({
    id: `${runId}-link-late-note`,
    source_kind: "calendar_event",
    source_id: `${runId}-late-call`,
    target_kind: "note",
    target_id: `${runId}-late-note`,
    label: "Late-call follow-up"
  });
  return seed;
}

async function saveShot(page, reportDir, name, summary) {
  const target = path.join(reportDir, name);
  await page.screenshot({ path: target, fullPage: false });
  summary.screenshots[name] = target;
}

async function saveLocatorShot(locator, reportDir, name, summary) {
  const target = path.join(reportDir, name);
  let lastError = null;
  for (let attempt = 1; attempt <= LOCATOR_SHOT_ATTEMPTS; attempt += 1) {
    try {
      await locator.waitFor({ state: "visible" });
      await locator.scrollIntoViewIfNeeded();
      await locator.screenshot({ path: target });
      summary.screenshots[name] = target;
      return;
    } catch (error) {
      lastError = error;
      if (attempt >= LOCATOR_SHOT_ATTEMPTS) {
        break;
      }
      await delay(LOCATOR_SHOT_RETRY_MS * attempt);
    }
  }
  throw lastError || new Error(`Expected locator screenshot ${name} to succeed.`);
}

async function gotoCalendarPageWithRetry(page, url, options = {}, maxAttempts = 3) {
  let lastError = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      await page.goto(url, options);
      return;
    } catch (error) {
      lastError = error;
      if (attempt >= maxAttempts) {
        break;
      }
      await delay(500 * attempt);
    }
  }
  throw lastError;
}

async function openHomeCalendar(page) {
  await page.locator('.light-app-tile[data-route="calendar"]').click();
  await page.locator(".light-date-input").waitFor({ state: "visible" });
}

async function openCalendarProofRoot(page, config, theme) {
  await gotoCalendarPageWithRetry(page, pageUrl(config.baseUrl, config.apiToken, theme), {
    waitUntil: "domcontentloaded",
    timeout: config.timeoutMs,
  });
  await page.locator('.light-app-tile[data-route="calendar"]').waitFor({ state: "visible" });
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
  await clickBackButton(page);
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

function calendarApiRequestCount(networkLog) {
  return networkLog.filter(entry => entry.type === "request" && entry.url.includes("/api/workspace/calendar-events")).length;
}

async function setReducedMotion(page, enabled) {
  await page.emulateMedia({ reducedMotion: enabled ? "reduce" : "no-preference" });
}

async function waitForCalendarSelectionSettle(page, waitMs = CALENDAR_SELECTION_MOTION_DURATION_MS + 80) {
  await page.waitForTimeout(Math.max(60, waitMs));
}

async function startCalendarMotionProbe(page, scenario) {
  await page.evaluate(({ actionKind, targetDay }) => {
    const probeKey = `calendar-motion-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    window.__PUCKY_CALENDAR_MOTION_RESULT__ = null;
    window.__PUCKY_CALENDAR_MOTION_ERROR__ = "";
    window.__PUCKY_CALENDAR_MOTION_KEY__ = probeKey;
    const read = label => {
      const strip = document.querySelector(".light-calendar-day-strip");
      const input = document.querySelector(".light-date-input");
      const selected = document.querySelector(".light-calendar-day-chip.is-selected");
      const chip = selected instanceof HTMLElement ? selected : null;
      const stripNode = strip instanceof HTMLElement ? strip : null;
      let centerDelta = 0;
      if (stripNode && chip) {
        const stripRect = stripNode.getBoundingClientRect();
        const chipRect = chip.getBoundingClientRect();
        centerDelta = Math.round(((chipRect.left + (chipRect.width / 2)) - (stripRect.left + (stripRect.width / 2))) * 100) / 100;
      }
      return {
        label,
        t: Math.round(performance.now() * 100) / 100,
        scrollLeft: Math.round(Number(stripNode?.scrollLeft || 0)),
        selectedDay: String(chip?.getAttribute("data-day") || "").trim(),
        inputValue: String(input instanceof HTMLInputElement ? input.value : "").trim(),
        centerDelta,
      };
    };
    const run = async () => {
      const samples = [read("before")];
      const input = document.querySelector(".light-date-input");
      if (!(input instanceof HTMLInputElement)) {
        throw new Error("Calendar date input not found");
      }
      if (actionKind === "input") {
        input.value = String(targetDay || "").trim();
        input.dispatchEvent(new Event("change", { bubbles: true }));
      } else if (actionKind === "today") {
        const button = document.querySelector(".light-calendar-today-button");
        if (!(button instanceof HTMLElement)) {
          throw new Error("Calendar Today button not found");
        }
        button.click();
      } else if (actionKind === "chip") {
        const chip = document.querySelector(`.light-calendar-day-chip[data-day="${String(targetDay || "").trim()}"]`);
        if (!(chip instanceof HTMLElement)) {
          throw new Error(`Calendar day chip ${targetDay} not found`);
        }
        chip.click();
      } else {
        throw new Error(`Unknown calendar motion action ${actionKind}`);
      }
      samples.push(read("after-trigger"));
      let stableFrames = 0;
      let last = samples[samples.length - 1];
      let timedOut = false;
      const startedAt = performance.now();
      await new Promise(resolve => {
        const step = () => {
          const current = read(`frame-${samples.length - 1}`);
          samples.push(current);
          const changed = current.scrollLeft !== last.scrollLeft
            || current.selectedDay !== last.selectedDay
            || current.inputValue !== last.inputValue;
          stableFrames = changed ? 0 : stableFrames + 1;
          last = current;
          const reachedTarget = current.selectedDay === String(targetDay || "").trim()
            && current.inputValue === String(targetDay || "").trim();
          if (reachedTarget && stableFrames >= 3) {
            resolve();
            return;
          }
          if ((performance.now() - startedAt) >= 1200) {
            timedOut = true;
            resolve();
            return;
          }
          requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
      });
      samples.push(read("settled"));
      const first = samples[0];
      const end = samples[samples.length - 1];
      const distinctScrollLeft = [...new Set(samples.map(sample => sample.scrollLeft))];
      const afterTrigger = samples[1] || first;
      const postTriggerSamples = samples.slice(2);
      const positionedStart = postTriggerSamples.find(sample => sample.scrollLeft !== afterTrigger.scrollLeft) || afterTrigger;
      const motionStart = positionedStart;
      let motionEnd = end;
      const lastNonFinalIndex = samples.reduce((lastIndex, sample, index) => (
        sample.scrollLeft !== end.scrollLeft ? index : lastIndex
      ), -1);
      if (lastNonFinalIndex >= 0 && lastNonFinalIndex + 1 < samples.length) {
        motionEnd = samples[lastNonFinalIndex + 1];
      }
      return {
        action_kind: actionKind,
        target_day: String(targetDay || "").trim(),
        start_day: first.selectedDay,
        end_day: end.selectedDay,
        start_input_value: first.inputValue,
        end_input_value: end.inputValue,
        start_scroll_left: first.scrollLeft,
        end_scroll_left: end.scrollLeft,
        total_distance: Math.abs(end.scrollLeft - first.scrollLeft),
        total_duration_ms: Math.max(0, Math.round((motionEnd.t - motionStart.t) * 100) / 100),
        sample_count: samples.length,
        distinct_scroll_left_count: distinctScrollLeft.length,
        intermediate_scroll_values: distinctScrollLeft.filter(value => value !== first.scrollLeft && value !== end.scrollLeft),
        final_center_delta: end.centerDelta,
        reduced_motion: Boolean(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches),
        reached_target: end.selectedDay === String(targetDay || "").trim() && end.inputValue === String(targetDay || "").trim(),
        timed_out: timedOut,
        samples,
      };
    };
    void run()
      .then(result => {
        if (window.__PUCKY_CALENDAR_MOTION_KEY__ === probeKey) {
          window.__PUCKY_CALENDAR_MOTION_RESULT__ = result;
        }
      })
      .catch(error => {
        if (window.__PUCKY_CALENDAR_MOTION_KEY__ === probeKey) {
          window.__PUCKY_CALENDAR_MOTION_ERROR__ = String(error?.stack || error?.message || error);
        }
      });
  }, scenario);
}

async function finishCalendarMotionProbe(page, timeoutMs = 2000) {
  await page.waitForFunction(() => Boolean(window.__PUCKY_CALENDAR_MOTION_RESULT__ || window.__PUCKY_CALENDAR_MOTION_ERROR__), undefined, {
    timeout: timeoutMs,
  });
  const error = await page.evaluate(() => String(window.__PUCKY_CALENDAR_MOTION_ERROR__ || "").trim());
  if (error) {
    throw new Error(error);
  }
  return page.evaluate(() => window.__PUCKY_CALENDAR_MOTION_RESULT__);
}

async function runCalendarMotionScenario(page, networkLog, reportDir, summary, laneKey, scenario) {
  const scenarioDir = path.join(reportDir, "motion", scenario.id);
  ensureDir(scenarioDir);
  await setReducedMotion(page, Boolean(scenario.reducedMotion));
  await setCalendarDate(page, scenario.fromDay);
  await waitForCalendarSelectionSettle(page);
  const beforeRequestCount = calendarApiRequestCount(networkLog);
  const beforeShot = path.join(scenarioDir, "before.png");
  await page.screenshot({ path: beforeShot, fullPage: false });
  await startCalendarMotionProbe(page, { actionKind: scenario.actionKind, targetDay: scenario.targetDay });
  await page.waitForTimeout(scenario.reducedMotion ? 20 : CALENDAR_SELECTION_MOTION_MID_CAPTURE_MS);
  const midShot = path.join(scenarioDir, "mid.png");
  await page.screenshot({ path: midShot, fullPage: false });
  const motion = await finishCalendarMotionProbe(page, 2500);
  const afterRequestCount = calendarApiRequestCount(networkLog);
  const afterShot = path.join(scenarioDir, "after.png");
  await page.screenshot({ path: afterShot, fullPage: false });
  motion.id = scenario.id;
  motion.label = scenario.label;
  motion.from_day = scenario.fromDay;
  motion.request_delta = afterRequestCount - beforeRequestCount;
  motion.before_screenshot = beforeShot;
  motion.mid_screenshot = midShot;
  motion.after_screenshot = afterShot;
  const motionPath = path.join(scenarioDir, "motion.json");
  writeJsonFile(motionPath, motion);
  summary.motion_scenarios = summary.motion_scenarios || {};
  summary.motion_scenarios[laneKey] = summary.motion_scenarios[laneKey] || {};
  summary.motion_scenarios[laneKey][scenario.id] = {
    id: scenario.id,
    label: scenario.label,
    action_kind: scenario.actionKind,
    target_day: scenario.targetDay,
    reduced_motion: Boolean(scenario.reducedMotion),
    motion_path: motionPath,
    before_screenshot: beforeShot,
    mid_screenshot: midShot,
    after_screenshot: afterShot,
    total_duration_ms: motion.total_duration_ms,
    total_distance: motion.total_distance,
    distinct_scroll_left_count: motion.distinct_scroll_left_count,
    request_delta: motion.request_delta,
  };
  return motion;
}

function assertAnimatedCalendarMotion(motion, label) {
  assert(motion.reached_target, `${label}: expected motion to reach ${motion.target_day}, got ${motion.end_day}/${motion.end_input_value}`);
  assert(!motion.timed_out, `${label}: expected motion to settle before timeout.`);
  assert(motion.request_delta === 0, `${label}: expected no extra calendar API requests, got ${motion.request_delta}.`);
  assert(motion.total_distance > 0, `${label}: expected positive scroll distance, got ${motion.total_distance}.`);
  assert(motion.total_duration_ms >= CALENDAR_SELECTION_MOTION_MIN_MS, `${label}: expected duration >= ${CALENDAR_SELECTION_MOTION_MIN_MS}ms, got ${motion.total_duration_ms}ms.`);
  assert(motion.total_duration_ms <= CALENDAR_SELECTION_MOTION_MAX_MS, `${label}: expected duration <= ${CALENDAR_SELECTION_MOTION_MAX_MS}ms, got ${motion.total_duration_ms}ms.`);
  assert(motion.distinct_scroll_left_count >= 4, `${label}: expected at least four distinct scrollLeft values, got ${motion.distinct_scroll_left_count}.`);
  assert(motion.intermediate_scroll_values.length >= 2, `${label}: expected multiple intermediate scroll values, got ${JSON.stringify(motion.intermediate_scroll_values)}.`);
  assert(Math.abs(Number(motion.final_center_delta || 0)) <= 12, `${label}: expected the selected chip to settle near center, got ${motion.final_center_delta}px.`);
}

function assertReducedMotionCalendarSelection(motion, label) {
  assert(motion.reached_target, `${label}: expected reduced-motion selection to reach ${motion.target_day}, got ${motion.end_day}/${motion.end_input_value}`);
  assert(!motion.timed_out, `${label}: expected reduced-motion selection to settle before timeout.`);
  assert(motion.request_delta === 0, `${label}: expected no extra calendar API requests, got ${motion.request_delta}.`);
  assert(motion.total_distance >= 0, `${label}: expected a valid reduced-motion distance, got ${motion.total_distance}.`);
  assert(motion.total_duration_ms <= 90, `${label}: expected reduced-motion selection to settle quickly, got ${motion.total_duration_ms}ms.`);
  assert(Math.abs(Number(motion.final_center_delta || 0)) <= 12, `${label}: expected the reduced-motion selected chip to settle near center, got ${motion.final_center_delta}px.`);
}

async function runCalendarMotionChecks(page, networkLog, reportDir, summary, laneKey, seed, options = {}) {
  const shortFromDay = shiftDayKey(seed.today, -2);
  const shortTarget = shiftDayKey(seed.today, -1);
  const longTarget = shiftDayKey(seed.today, 70);
  const scenarios = [
    {
      id: "date-input-short",
      label: "Date input short jump",
      actionKind: "input",
      fromDay: shortFromDay,
      targetDay: shortTarget,
      reducedMotion: false,
    },
    {
      id: "date-input-long",
      label: "Date input long jump",
      actionKind: "input",
      fromDay: shortFromDay,
      targetDay: longTarget,
      reducedMotion: false,
    },
    {
      id: "day-chip-short",
      label: "Day chip short jump",
      actionKind: "chip",
      fromDay: shortFromDay,
      targetDay: shortTarget,
      reducedMotion: false,
    },
    {
      id: "today-button-return",
      label: "Today button return",
      actionKind: "today",
      fromDay: shortFromDay,
      targetDay: seed.today,
      reducedMotion: false,
    },
  ];
  const motions = {};
  for (const scenario of scenarios) {
    motions[scenario.id] = await runCalendarMotionScenario(page, networkLog, reportDir, summary, laneKey, scenario);
    assertAnimatedCalendarMotion(motions[scenario.id], `${laneKey}: ${scenario.label}`);
  }
  assert(
    motions["date-input-long"].total_distance > motions["date-input-short"].total_distance,
    `${laneKey}: expected the long date-input jump to travel farther than the short jump, got ${motions["date-input-long"].total_distance} <= ${motions["date-input-short"].total_distance}.`
  );
  if (options.includeReducedMotion) {
    const reducedMotion = await runCalendarMotionScenario(page, networkLog, reportDir, summary, laneKey, {
      id: "reduced-motion-short",
      label: "Reduced motion short jump",
      actionKind: "input",
      fromDay: shortFromDay,
      targetDay: shortTarget,
      reducedMotion: true,
    });
    assertReducedMotionCalendarSelection(reducedMotion, `${laneKey}: Reduced motion short jump`);
    motions["reduced-motion-short"] = reducedMotion;
    await setReducedMotion(page, false);
  }
  await setCalendarDate(page, seed.today);
  await waitForCalendarSelectionSettle(page);
  return motions;
}

async function visibleCalendarTitles(page) {
  return page.evaluate(() => Array.from(document.querySelectorAll(".light-event-title")).map(node => node.textContent?.trim()).filter(Boolean));
}

async function waitForCalendarTitle(page, title) {
  await page.waitForFunction(targetTitle => {
    return Array.from(document.querySelectorAll(".light-event-title"))
      .some(node => String(node.textContent || "").trim() === String(targetTitle || "").trim());
  }, title);
}

async function waitForMeetingDetailWhoChip(page, label) {
  await page.waitForFunction(targetLabel => {
    return Array.from(document.querySelectorAll('.light-calendar-detail-row[data-detail-row="who"] .light-attendee-chip'))
      .some(node => String(node.textContent || "").trim() === String(targetLabel || "").trim());
  }, label);
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

async function clickBackButton(page) {
  const button = page.getByRole("button", { name: "Back" }).first();
  await button.waitFor({ state: "visible" });
  try {
    await button.click({ timeout: 5000 });
    return;
  } catch (error) {
    const message = String(error && error.message ? error.message : error || "");
    if (!/detached from the dom|not attached|stable/i.test(message)) {
      throw error;
    }
  }
  await page.evaluate(() => {
    const button = document.querySelector('button.light-back-button[aria-label="Back"], button[aria-label="Back"]');
    if (!(button instanceof HTMLElement)) {
      throw new Error("Expected a Back button to remain available for fallback navigation.");
    }
    button.click();
  });
}

async function waitForSelectorText(page, selector, text) {
  await page.waitForFunction(({ targetSelector, targetText }) => {
    const node = document.querySelector(String(targetSelector || ""));
    return Boolean(node && String(node.textContent || "").includes(String(targetText || "")));
  }, { targetSelector: selector, targetText: text });
}

async function waitForContactDetailName(page, text) {
  await page.waitForFunction(targetText => {
    const route = document.querySelector(".light-shell")?.getAttribute("data-light-route") || "";
    if (route !== "contact-detail") {
      return false;
    }
    const legacyTitle = String(document.querySelector(".light-profile-card h1")?.textContent || "").trim();
    const editTitle = String(document.querySelector(".light-contact-edit-photo-title")?.textContent || "").trim();
    const first = String(document.querySelector('[data-contact-edit-field="first_name"]')?.value || "").trim();
    const last = String(document.querySelector('[data-contact-edit-field="last_name"]')?.value || "").trim();
    const fullName = [first, last].filter(Boolean).join(" ");
    return [legacyTitle, editTitle, fullName].some(value => value.includes(String(targetText || "")));
  }, text);
}

async function stickyMetrics(page) {
  return page.evaluate(() => {
    const feed = document.querySelector(".feed");
    if (feed && typeof feed.scrollTo === "function") {
      feed.scrollTo({ top: 420, left: 0, behavior: "instant" });
    }
    const headerShell = document.querySelector(".light-page-header-shell");
    const header = document.querySelector(".light-page-header");
    const chrome = document.querySelector(".light-date-picker");
    return {
      headerShellTop: Math.round(headerShell?.getBoundingClientRect().top ?? -999),
      headerShellBottom: Math.round(headerShell?.getBoundingClientRect().bottom ?? -999),
      headerTop: Math.round(header?.getBoundingClientRect().top ?? -999),
      chromeTop: Math.round(chrome?.getBoundingClientRect().top ?? -999),
      chromeBottom: Math.round(chrome?.getBoundingClientRect().bottom ?? -999),
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

function monthKeyFromDayKey(dayKey) {
  return String(dayKey || "").slice(0, 7);
}

function dateFromDayKey(dayKey) {
  const [year, month, day] = String(dayKey || "").split("-").map(Number);
  if (!year || !month || !day) {
    return null;
  }
  return new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
}

function shiftDayKey(dayKey, offsetDays = 0) {
  const date = dateFromDayKey(dayKey);
  if (!date) {
    return "";
  }
  date.setUTCDate(date.getUTCDate() + Number(offsetDays || 0));
  return dateKey(date);
}

function shiftMonthKey(monthKey, offsetMonths = 0) {
  const [year, month] = String(monthKey || "").split("-").map(Number);
  if (!year || !month) {
    return "";
  }
  const date = new Date(Date.UTC(year, month - 1, 1, 12, 0, 0));
  date.setUTCMonth(date.getUTCMonth() + Number(offsetMonths || 0), 1);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function monthKeyOrdinal(monthKey) {
  const [year, month] = String(monthKey || "").split("-").map(Number);
  if (!year || !month) {
    return Number.NaN;
  }
  return (year * 12) + month;
}

function hasMonthBefore(monthKeys, monthKey) {
  const target = monthKeyOrdinal(monthKey);
  return Number.isFinite(target) && monthKeys.some(key => monthKeyOrdinal(key) < target);
}

function hasMonthAfter(monthKeys, monthKey) {
  const target = monthKeyOrdinal(monthKey);
  return Number.isFinite(target) && monthKeys.some(key => monthKeyOrdinal(key) > target);
}

function monthEdgeDayKeys(dayKey) {
  const date = dateFromDayKey(dayKey);
  if (!date) {
    return { first_day_key: "", last_day_key: "" };
  }
  const first = new Date(date.getTime());
  first.setUTCDate(1);
  const last = new Date(date.getTime());
  last.setUTCMonth(last.getUTCMonth() + 1, 0);
  return {
    first_day_key: dateKey(first),
    last_day_key: dateKey(last)
  };
}

function formatMonthKey(dayKey) {
  const date = dateFromDayKey(dayKey);
  if (!date) {
    return "";
  }
  return date.toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC"
  });
}

async function calendarChromeLayoutMetrics(page) {
  return page.evaluate(() => {
    const lane = document.querySelector(".light-calendar-page");
    const headerShell = document.querySelector(".light-page-header-shell");
    const header = document.querySelector(".light-page-header");
    const chrome = document.querySelector(".light-date-picker");
    const topRow = document.querySelector(".light-calendar-strip-top");
    const strip = document.querySelector(".light-calendar-day-strip");
    const settingsButton = document.querySelector(".light-calendar-settings-button");
    const rect = node => {
      if (!node) {
        return null;
      }
      const box = node.getBoundingClientRect();
      return {
        top: Math.round(box.top),
        right: Math.round(box.right),
        bottom: Math.round(box.bottom),
        left: Math.round(box.left),
        width: Math.round(box.width),
        height: Math.round(box.height)
      };
    };
    return {
      laneWidth: Math.round(lane?.getBoundingClientRect().width ?? 0),
      headerShellWidth: Math.round(headerShell?.getBoundingClientRect().width ?? 0),
      chromeWidth: Math.round(chrome?.getBoundingClientRect().width ?? 0),
      topRowWidth: Math.round(topRow?.getBoundingClientRect().width ?? 0),
      stripWidth: Math.round(strip?.getBoundingClientRect().width ?? 0),
      chromePosition: String(chrome ? getComputedStyle(chrome).position : ""),
      settingsButtonClassName: String(settingsButton?.className || ""),
      settingsButtonBackground: String(settingsButton ? getComputedStyle(settingsButton).backgroundColor : ""),
      settingsButtonBorderWidth: String(settingsButton ? getComputedStyle(settingsButton).borderTopWidth : ""),
      settingsButtonBoxShadow: String(settingsButton ? getComputedStyle(settingsButton).boxShadow : ""),
      chromeInHeaderShell: Boolean(headerShell && chrome && headerShell.contains(chrome)),
      laneRect: rect(lane),
      headerRect: rect(header),
      headerShellRect: rect(headerShell),
      chromeRect: rect(chrome),
      settingsButtonRect: rect(settingsButton),
      topRowRect: rect(topRow),
      stripRect: rect(strip)
    };
  });
}

async function calendarStripMetrics(page) {
  return page.locator(".light-calendar-day-strip").evaluate(node => {
    const stripRect = node.getBoundingClientRect();
    const chips = Array.from(node.querySelectorAll(".light-calendar-day-chip")).map(chip => {
      const rect = chip.getBoundingClientRect();
      const dayKey = String(chip.getAttribute("data-day") || "").trim();
      const monthKey = String(chip.getAttribute("data-month") || dayKey.slice(0, 7)).trim();
      const label = String(chip.textContent || "").replace(/\s+/g, " ").trim();
      return {
        dayKey,
        monthKey,
        label,
        visible: rect.right > stripRect.left && rect.left < stripRect.right,
        selected: chip.classList.contains("is-selected")
      };
    });
    const renderedMonthKeys = [...new Set(chips.map(chip => chip.monthKey).filter(Boolean))];
    const visibleChips = chips.filter(chip => chip.visible);
    const selectedChip = chips.find(chip => chip.selected) || null;
    return {
      scrollLeft: Math.round(node.scrollLeft || 0),
      scrollWidth: Math.round(node.scrollWidth || 0),
      clientWidth: Math.round(node.clientWidth || 0),
      childCount: chips.length,
      first_day_key: chips[0]?.dayKey || "",
      last_day_key: chips[chips.length - 1]?.dayKey || "",
      rendered_day_keys: chips.map(chip => chip.dayKey),
      rendered_month_keys: renderedMonthKeys,
      visible_day_keys: visibleChips.map(chip => chip.dayKey),
      visible_labels: visibleChips.map(chip => chip.label),
      selected_day_key: selectedChip?.dayKey || "",
      selected_month_key: selectedChip?.monthKey || ""
    };
  });
}

async function calendarChromeState(page) {
  return page.evaluate(() => ({
    title: String(document.querySelector(".light-date-picker-title")?.textContent || "").replace(/\s+/g, " ").trim(),
    input_value: String(document.querySelector(".light-date-input")?.value || "").trim(),
    agenda_title: String(document.querySelector(".light-calendar-agenda-title")?.textContent || "").replace(/\s+/g, " ").trim(),
    route: String(document.querySelector(".light-shell")?.getAttribute("data-light-route") || "").trim()
  }));
}

async function readCalendarDaySwitchState(page, dayKeys) {
  return page.evaluate(({ trackedDayKeys, tones }) => {
    const visible = node => Boolean(node instanceof HTMLElement && node.getClientRects().length);
    const toneListForNode = node => Array.from(tones).filter(tone => Boolean(node instanceof Element && node.classList.contains(tone)));
    const dotTonesByDay = Object.fromEntries(Array.from(trackedDayKeys).map(dayKey => {
      const chip = document.querySelector(`.light-calendar-day-chip[data-day="${dayKey}"]`);
      const tonesForChip = chip
        ? Array.from(chip.querySelectorAll(".light-calendar-day-dot"))
          .map(dot => Array.from(tones).find(tone => dot.classList.contains(tone)) || "")
          .filter(Boolean)
        : null;
      return [dayKey, tonesForChip];
    }));
    const visibleEventBlocks = Array.from(document.querySelectorAll(".light-event-block")).filter(visible);
    return {
      tracked_day_keys: Array.from(trackedDayKeys),
      selected_day_key: String(document.querySelector(".light-calendar-day-chip.is-selected")?.getAttribute("data-day") || document.querySelector(".light-date-input")?.value || "").trim(),
      dot_tones_by_day: dotTonesByDay,
      agenda_tones_for_selected_day: visibleEventBlocks.map(node => toneListForNode(node)[0] || "").filter(Boolean),
      agenda_titles_for_selected_day: visibleEventBlocks.map(node => String(node.querySelector(".light-event-title")?.textContent || "").replace(/\s+/g, " ").trim()).filter(Boolean)
    };
  }, { trackedDayKeys: dayKeys, tones: CALENDAR_TONES });
}

function calendarEventsRequestUrls(entries = []) {
  return entries
    .filter(entry => String(entry?.type || "").trim() === "request")
    .map(entry => String(entry?.url || "").trim())
    .filter(url => url.includes("/api/workspace/calendar-events"));
}

function calendarEventDateRequestUrls(entries = []) {
  return calendarEventsRequestUrls(entries).filter(url => {
    try {
      const parsed = new URL(url);
      return String(parsed.searchParams.get("date") || "").trim().length > 0;
    } catch (_error) {
      return /[?&]date=/.test(url);
    }
  });
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

async function connectedSectionLayoutMetrics(page) {
  return page.evaluate(() => {
    const section = document.querySelector('.light-linked-records-section[data-linked-records-title="connected"]');
    const body = section?.querySelector(".light-linked-record-list");
    const rows = section ? [...section.querySelectorAll(".light-linked-record-feed-row")] : [];
    return {
      sectionClassName: String(section?.className || ""),
      bodyClassName: String(body?.className || ""),
      rowCount: rows.length,
      flatRowCount: rows.filter(row => row.classList.contains("is-flat-feed")).length,
      recordChipCount: section ? section.querySelectorAll(".light-linked-record-feed-row .light-record-chip").length : 0
    };
  });
}

function normalizeTexts(values) {
  return values.map(value => String(value || "").replace(/\s+/g, " ").trim()).filter(Boolean);
}

function isTransparentBackground(value) {
  return /transparent|rgba\(0,\s*0,\s*0,\s*0\)/i.test(String(value || ""));
}

async function assertChipContrast(page, selector) {
  await page.waitForFunction(targetSelector => {
    return Array.from(document.querySelectorAll(String(targetSelector || ""))).some(node => {
      if (!(node instanceof HTMLElement)) {
        return false;
      }
      const rect = node.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    });
  }, selector);
  const metrics = await page.evaluate(targetSelector => {
    const visibleChip = Array.from(document.querySelectorAll(String(targetSelector || ""))).find(node => {
      if (!(node instanceof HTMLElement)) {
        return false;
      }
      const rect = node.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    });
    if (!(visibleChip instanceof HTMLElement)) {
      return { delta: 0, color: "", background: "", matched: 0 };
    }
    const style = getComputedStyle(visibleChip);
    const toRgb = value => String(value || "").match(/\d+/g)?.slice(0, 3).map(Number) || [0, 0, 0];
    const fg = toRgb(style.color);
    const bg = toRgb(style.backgroundColor);
    const delta = Math.abs(fg[0] - bg[0]) + Math.abs(fg[1] - bg[1]) + Math.abs(fg[2] - bg[2]);
    return {
      delta,
      color: style.color,
      background: style.backgroundColor,
      matched: 1
    };
  }, selector);
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

async function scrollDayStripToDay(page, dayKey, alignment = "center") {
  await page.locator(`.light-calendar-day-chip[data-day="${dayKey}"]`).waitFor({ state: "visible" });
  await page.locator(".light-calendar-day-strip").evaluate((strip, { targetDay, targetAlignment }) => {
    const chip = strip?.querySelector(`.light-calendar-day-chip[data-day="${targetDay}"]`);
    if (!(strip instanceof HTMLElement) || !(chip instanceof HTMLElement)) {
      throw new Error(`Calendar rail day ${targetDay} not found`);
    }
    const startLeft = Math.max(0, chip.offsetLeft - 12);
    const endLeft = Math.max(0, chip.offsetLeft - Math.max(0, strip.clientWidth - chip.offsetWidth) + 12);
    const centerLeft = Math.max(0, chip.offsetLeft - Math.max(0, (strip.clientWidth - chip.offsetWidth) / 2));
    const left = targetAlignment === "start"
      ? startLeft
      : targetAlignment === "end"
        ? endLeft
        : centerLeft;
    strip.scrollTo({ left, behavior: "instant" });
  }, { targetDay: dayKey, targetAlignment: alignment });
  await page.waitForFunction(targetDay => {
    const strip = document.querySelector(".light-calendar-day-strip");
    const chip = strip?.querySelector(`.light-calendar-day-chip[data-day="${targetDay}"]`);
    if (!(strip instanceof HTMLElement) || !(chip instanceof HTMLElement)) {
      return false;
    }
    const stripRect = strip.getBoundingClientRect();
    const chipRect = chip.getBoundingClientRect();
    return chipRect.right > stripRect.left && chipRect.left < stripRect.right;
  }, dayKey);
}

async function scrollDayStripToEdge(page, direction = "left") {
  await page.locator(".light-calendar-day-strip").evaluate((strip, targetDirection) => {
    if (!(strip instanceof HTMLElement)) {
      throw new Error("Calendar day strip not found");
    }
    const left = targetDirection === "left" ? 0 : strip.scrollWidth;
    strip.scrollTo({ left, behavior: "instant" });
    strip.dispatchEvent(new Event("scroll", { bubbles: true }));
  }, direction);
}

async function continueDayStripBeyondEdge(page, direction = "left") {
  const before = await calendarStripMetrics(page);
  await scrollDayStripToEdge(page, direction);
  await page.waitForFunction(({ targetDirection, previousWidth, previousFirstDayKey, previousLastDayKey }) => {
    const strip = document.querySelector(".light-calendar-day-strip");
    if (!(strip instanceof HTMLElement)) {
      return false;
    }
    const chips = Array.from(strip.querySelectorAll(".light-calendar-day-chip"));
    const firstDayKey = String(chips[0]?.getAttribute("data-day") || "").trim();
    const lastDayKey = String(chips[chips.length - 1]?.getAttribute("data-day") || "").trim();
    if (targetDirection === "left") {
      return Boolean(firstDayKey && firstDayKey !== String(previousFirstDayKey || "").trim());
    }
    return Boolean(lastDayKey && lastDayKey !== String(previousLastDayKey || "").trim());
  }, {
    targetDirection: direction,
    previousWidth: before.scrollWidth,
    previousFirstDayKey: before.first_day_key,
    previousLastDayKey: before.last_day_key
  });
  return calendarStripMetrics(page);
}

async function selectCalendarDayChip(page, dayKey) {
  await page.locator(`.light-calendar-day-chip[data-day="${dayKey}"]`).click();
  await page.waitForFunction(targetDay => {
    const input = document.querySelector(".light-date-input");
    const selectedChip = document.querySelector(`.light-calendar-day-chip.is-selected[data-day="${targetDay}"]`);
    return Boolean(input instanceof HTMLInputElement && input.value === String(targetDay || "") && selectedChip);
  }, dayKey);
}

async function setCalendarTypeEnabled(page, label, enabled) {
  const row = page.locator(".calendar-type-filter-row", { hasText: label }).first();
  const toggle = row.locator(".calendar-type-filter-toggle");
  const current = await toggle.isChecked();
  if (current !== enabled) {
    await toggle.click();
  }
}

async function selectConnectedRow(page, label) {
  await page.locator('.light-linked-records-section[data-linked-records-title="connected"] .light-linked-record-feed-row', { hasText: label }).first().click();
}

async function ensureMeetingDetailSectionExpanded(page, sectionKey, expanded = true) {
  const header = page.locator(`.light-meeting-detail-section[data-meeting-detail-section="${sectionKey}"] > .light-meeting-detail-section-header`).first();
  await header.waitFor({ state: "visible" });
  const current = await header.getAttribute("aria-expanded");
  if (String(current) !== String(expanded)) {
    await header.click();
  }
  await page.waitForFunction(({ key, nextExpanded }) => {
    const section = document.querySelector(`.light-meeting-detail-section[data-meeting-detail-section="${key}"]`);
    const button = section?.querySelector(":scope > .light-meeting-detail-section-header");
    if (button && button.getAttribute("aria-expanded") === String(nextExpanded)) {
      return true;
    }
    if (nextExpanded && key === "connected") {
      const emptyShell = section?.querySelector(".light-linked-records-empty-shell");
      return Boolean(emptyShell instanceof HTMLElement && emptyShell.getClientRects().length);
    }
    return false;
  }, { key: sectionKey, nextExpanded: expanded });
}

async function readMeetingDetailState(page) {
  return page.evaluate(() => {
    const visible = node => Boolean(node instanceof HTMLElement && !node.hidden && node.getClientRects().length);
    const normalizedText = node => String(node?.textContent || "").replace(/\s+/g, " ").trim();
    const sectionRoots = Array.from(document.querySelectorAll(".light-meeting-detail-section"));
    const sections = Object.fromEntries(sectionRoots.map(section => {
      const key = String(section.getAttribute("data-meeting-detail-section") || "").trim();
      const header = section.querySelector(":scope > .light-meeting-detail-section-header");
      const body = section.querySelector(":scope > .light-meeting-detail-section-body");
      return [key, {
        expanded: header?.getAttribute("aria-expanded") === "true",
        headerText: String(header?.textContent || "").replace(/\s+/g, " ").trim(),
        bodyVisible: visible(body),
      }];
    }));
    const titleNodes = Array.from(document.querySelectorAll(".light-document-page .light-section-title"));
    const detailRows = Array.from(document.querySelectorAll('.light-meeting-detail-section[data-meeting-detail-section="details"] .light-calendar-detail-row'));
    const connectedRows = Array.from(document.querySelectorAll('.light-linked-records-section[data-linked-records-title="connected"] .light-linked-record-feed-row'));
    const descriptionNode = document.querySelector(".light-calendar-detail-description-copy");
    const descriptionLinks = Array.from(document.querySelectorAll(".light-calendar-detail-description-copy .light-calendar-detail-description-link"));
    const connectedCountNode = document.querySelector('.light-meeting-detail-section[data-meeting-detail-section="connected"] .light-meeting-detail-section-count');
    const detailsCard = document.querySelector('.light-meeting-detail-section[data-meeting-detail-section="details"] .light-calendar-detail-card');
    const whoCloud = document.querySelector('.light-calendar-detail-row[data-detail-row="who"] .light-attendee-chip-cloud');
    const placePrimaryNode = document.querySelector('.light-calendar-detail-row[data-detail-row="place"] .light-calendar-detail-location-primary');
    const placeAddressNode = document.querySelector('.light-calendar-detail-row[data-detail-row="place"] .light-calendar-detail-location-address');
    const detailRowMetrics = Object.fromEntries(detailRows.map(row => {
      const key = String(row.getAttribute("data-detail-row") || "").trim();
      const labelNode = row.querySelector(".light-calendar-detail-row-label");
      const valueNode = row.querySelector(".light-calendar-detail-row-value");
      const labelRect = labelNode?.getBoundingClientRect?.();
      const valueRect = valueNode?.getBoundingClientRect?.();
      return [key, {
        label: normalizedText(labelNode),
        value: normalizedText(valueNode),
        is_compact: row.classList.contains("is-compact"),
        row_top_delta_px: labelRect && valueRect ? Math.round(Math.abs(labelRect.top - valueRect.top)) : null,
      }];
    }));
    const whoStyle = whoCloud instanceof HTMLElement ? getComputedStyle(whoCloud) : null;
    return {
      text: String(document.querySelector(".light-document-page")?.innerText || "").replace(/\s+/g, " ").trim(),
      sectionTitles: titleNodes.map(node => String(node.textContent || "").trim().toUpperCase()),
      hasStandaloneDescriptionTitle: titleNodes.some(node => String(node.textContent || "").trim().toUpperCase() === "DESCRIPTION"),
      detailsExpanded: Boolean(sections.details?.expanded),
      connectedExpanded: Boolean(sections.connected?.expanded),
      visibleDetailRowLabels: detailRows.filter(visible).map(row => String(row.querySelector(".light-calendar-detail-row-label")?.textContent || "").trim()),
      visibleConnectedRowCount: connectedRows.filter(visible).length,
      descriptionText: String(descriptionNode?.textContent || "").trim(),
      descriptionVisible: visible(descriptionNode),
      description_link_count: descriptionLinks.length,
      description_link_hrefs: descriptionLinks.map(node => String(node.getAttribute("href") || "").trim()).filter(Boolean),
      description_link_hosts: descriptionLinks.map(node => {
        try {
          return String(new URL(String(node.getAttribute("href") || ""), window.location.href).host || "").trim();
        } catch (_error) {
          return "";
        }
      }).filter(Boolean),
      connectedCount: Number(connectedCountNode?.textContent || 0) || 0,
      place_primary_text: normalizedText(placePrimaryNode),
      place_address_text: normalizedText(placeAddressNode),
      whoChipTexts: Array.from(document.querySelectorAll('.light-calendar-detail-row[data-detail-row="who"] .light-attendee-chip')).map(node => String(node.textContent || "").trim()).filter(Boolean),
      detailRowMetrics,
      detailRowValues: Object.fromEntries(Object.entries(detailRowMetrics).map(([key, value]) => [key, String(value?.value || "").trim()])),
      who_chip_gap_px: whoStyle ? Math.max(
        Number.parseFloat(whoStyle.columnGap || "0") || 0,
        Number.parseFloat(whoStyle.rowGap || "0") || 0,
        Number.parseFloat(whoStyle.gap || "0") || 0
      ) : 0,
      who_contact_icon_count: document.querySelectorAll('.light-calendar-detail-row[data-detail-row="who"] .light-calendar-attendee-chip-icon').length,
      who_guest_chip_count: document.querySelectorAll('.light-calendar-detail-row[data-detail-row="who"] .light-attendee-chip-guest').length,
      who_record_chip_count: document.querySelectorAll('.light-calendar-detail-row[data-detail-row="who"] .light-record-chip').length,
      details_card_overflow_x: detailsCard instanceof HTMLElement ? Math.max(0, Math.round(detailsCard.scrollWidth - detailsCard.clientWidth)) : 0,
    };
  });
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
  const eventMain = page.locator(`${proofEventSelector(seed)} .light-event-main`).first();
  await eventMain.scrollIntoViewIfNeeded();
  await eventMain.click();
  await waitForHeaderText(page, "Proof freelance review call");
}

async function selectCalendarEventById(page, seed, eventSuffix, expectedTitle) {
  const eventMain = page.locator(`.light-event-block[data-event-id="${seed.runId}-${eventSuffix}"] .light-event-main`).first();
  await eventMain.scrollIntoViewIfNeeded();
  await eventMain.click();
  await waitForHeaderText(page, expectedTitle);
}

async function calendarEventContainerBox(page, selector) {
  let lastError = null;
  for (let attempt = 1; attempt <= CALENDAR_EVENT_CONTAINER_ATTEMPTS; attempt += 1) {
    try {
      await page.waitForFunction(targetSelector => {
        const eventCard = document.querySelector(String(targetSelector || ""));
        if (!(eventCard instanceof HTMLElement)) {
          return false;
        }
        eventCard.scrollIntoView({ block: "center", inline: "nearest", behavior: "auto" });
        const rect = eventCard.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      }, selector);
      const box = await page.evaluate(targetSelector => {
        const eventCard = document.querySelector(String(targetSelector || ""));
        if (!(eventCard instanceof HTMLElement)) {
          return null;
        }
        eventCard.scrollIntoView({ block: "center", inline: "nearest", behavior: "auto" });
        const rect = eventCard.getBoundingClientRect();
        if (!Number.isFinite(rect.left) || !Number.isFinite(rect.top) || rect.width <= 0 || rect.height <= 0) {
          return null;
        }
        return {
          x: rect.left,
          y: rect.top,
          width: rect.width,
          height: rect.height
        };
      }, selector);
      if (box) {
        return box;
      }
      throw new Error(`Expected ${selector} to expose a clickable container box.`);
    } catch (error) {
      lastError = error;
      if (attempt >= CALENDAR_EVENT_CONTAINER_ATTEMPTS) {
        break;
      }
      await delay(CALENDAR_EVENT_CONTAINER_RETRY_MS * attempt);
    }
  }
  throw lastError || new Error(`Expected ${selector} to expose a clickable container box.`);
}

async function selectCalendarEventByContainer(page, seed) {
  const box = await calendarEventContainerBox(page, proofEventSelector(seed));
  assert(box, "Expected the calendar proof event to expose a clickable container box.");
  await page.mouse.click(box.x + (box.width * 0.88), box.y + (box.height * 0.78));
  await waitForHeaderText(page, "Proof freelance review call");
  assert(await currentLightRoute(page) === "meeting-detail", `Expected calendar body click to open meeting-detail, got ${await currentLightRoute(page)}.`);
}

async function selectCalendarDetailTarget(page, config, route, targetId, expectedText) {
  const kindByRoute = {
    "project-detail": "project",
    "task-detail": "task",
    "note-detail": "note",
    "meeting-note-detail": "meeting_note",
    "reminder-detail": "reminder",
    "contact-detail": "contact"
  };
  const allowedRoutes = new Set([route]);
  const targetKind = String(kindByRoute[route] || "").trim();
  const selector = targetKind
    ? `.light-linked-records-section[data-linked-records-title="connected"] .light-linked-record-feed-row[data-linked-record-kind="${targetKind}"]`
    : `.light-linked-records-section[data-linked-records-title="connected"] [data-workspace-target-route="${route}"][data-workspace-target-id="${targetId}"]`;
  let lastError = null;
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      await page.waitForFunction(({ targetSelector, targetText }) => {
        return Array.from(document.querySelectorAll(String(targetSelector || ""))).some(node => {
          if (!(node instanceof HTMLElement)) {
            return false;
          }
          return String(node.textContent || "").includes(String(targetText || ""));
        });
      }, { targetSelector: selector, targetText: expectedText });
      await page.evaluate(({ targetSelector, targetText }) => {
        const rows = Array.from(document.querySelectorAll(String(targetSelector || "")));
        const targetRow = rows.find(node => {
          return node instanceof HTMLElement && String(node.textContent || "").includes(String(targetText || ""));
        });
        if (!(targetRow instanceof HTMLElement)) {
          throw new Error(`Connected target ${String(targetText || "")} not found for ${String(targetSelector || "")}.`);
        }
        targetRow.scrollIntoView({ block: "center", inline: "nearest", behavior: "auto" });
        targetRow.click();
      }, { targetSelector: selector, targetText: expectedText });
      if (route === "contact-detail") {
        await waitForContactDetailName(page, expectedText);
      } else if (route === "task-detail") {
        await waitForSelectorText(page, ".light-shell", expectedText);
      } else if (route === "reminder-detail") {
        await waitForSelectorText(page, ".light-shell", expectedText);
      } else {
        await waitForHeaderText(page, expectedText);
      }
      const actualRoute = await currentLightRoute(page);
      assert(allowedRoutes.has(actualRoute), `Expected ${Array.from(allowedRoutes).join(" or ")} after selecting ${targetId}, got ${actualRoute}.`);
      return;
    } catch (error) {
      lastError = error;
      if (attempt >= 4) {
        break;
      }
      await delay(200 * attempt);
    }
  }
  throw lastError || new Error(`Expected ${route} target ${targetId} to open from Connected.`);
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
  const video = page.video();
  const laneKey = `desktop_${theme}_${config.browserName}`;
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
    await setReducedMotion(page, false);
    await openCalendarProofRoot(page, config, theme);
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
    const chromeMetrics = await calendarChromeLayoutMetrics(page);
    assert(chromeMetrics.chromeInHeaderShell, `Expected calendar chrome to live inside the sticky header shell, got ${JSON.stringify(chromeMetrics)}.`);
    assert(chromeMetrics.chromePosition !== "sticky", `Expected calendar chrome to stop using its own sticky positioning, got ${JSON.stringify(chromeMetrics)}.`);
    assert(chromeMetrics.topRowWidth >= chromeMetrics.laneWidth - 2, `Expected calendar top row to span the full calendar lane, got ${JSON.stringify(chromeMetrics)}.`);
    assert(chromeMetrics.stripWidth >= chromeMetrics.laneWidth - 2, `Expected calendar day rail to span the full calendar lane, got ${JSON.stringify(chromeMetrics)}.`);
    assert(chromeMetrics.settingsButtonClassName.includes("light-icon-button") && !chromeMetrics.settingsButtonClassName.includes("light-circle-button"), `Expected calendar settings button to use the plain icon-button class, got ${JSON.stringify(chromeMetrics)}.`);
    assert(chromeMetrics.settingsButtonBorderWidth === "0px", `Expected calendar settings button to drop the circular shell border, got ${JSON.stringify(chromeMetrics)}.`);
    assert(isTransparentBackground(chromeMetrics.settingsButtonBackground), `Expected calendar settings button to drop the circular shell fill, got ${JSON.stringify(chromeMetrics)}.`);
    assert(chromeMetrics.settingsButtonBoxShadow === "none", `Expected calendar settings button to drop the circular shell shadow, got ${JSON.stringify(chromeMetrics)}.`);
    const stripMetrics = await calendarStripMetrics(page);
    const railStateBefore = await calendarChromeState(page);
    const selectedMonth = monthKeyFromDayKey(seed.today);
    const { first_day_key: firstDayKey, last_day_key: lastDayKey } = monthEdgeDayKeys(seed.today);
    assert(await page.locator(".light-calendar-strip-nav-button").count() === 0, "Expected no desktop calendar rail chevrons to remain.");
    assert(stripMetrics.rendered_month_keys.includes(selectedMonth), `Expected the selected month ${selectedMonth} to render on the desktop rail, got ${JSON.stringify(stripMetrics.rendered_month_keys)}.`);
    assert(stripMetrics.rendered_month_keys.includes(shiftMonthKey(selectedMonth, -1)), `Expected the desktop rail to preload the prior month before scrolling, got ${JSON.stringify(stripMetrics.rendered_month_keys)}.`);
    assert(stripMetrics.rendered_month_keys.includes(shiftMonthKey(selectedMonth, 1)), `Expected the desktop rail to preload the next month before scrolling, got ${JSON.stringify(stripMetrics.rendered_month_keys)}.`);
    assert(await page.locator(".light-event-badge").count() === 0, "Expected agenda cards to hide the legacy type badge.");
    await waitForCalendarTitle(page, "Proof freelance review call");
    await waitForCalendarTitle(page, "Proof Katy pickup handoff");
    const todayTitles = await visibleCalendarTitles(page);
    assert(todayTitles.includes("Proof freelance review call"), "Expected the linked proof review call on the device-local today view.");
    assert(todayTitles.includes("Proof Katy pickup handoff"), "Expected clustered family logistics on today.");
    assert(await calendarLaneWidth(page) >= 820, `Expected a widened desktop calendar lane, got ${await calendarLaneWidth(page)}px.`);
    const eventSelector = proofEventSelector(seed);
    const trackedDayLabels = {
      yesterday: seed.yesterday || shiftDayKey(seed.today, -1),
      today: seed.today,
      tomorrow: seed.tomorrow
    };
    const trackedDayKeys = Object.values(trackedDayLabels);
    const daySwitchShotNames = {
      yesterday: `calendar-desktop-${theme}-yesterday-selected.png`,
      today: `calendar-desktop-${theme}-today-selected.png`,
      tomorrow: `calendar-desktop-${theme}-tomorrow-selected.png`,
    };
    const daySwitchRailNames = {
      yesterday: `calendar-desktop-${theme}-yesterday-rail.png`,
      today: `calendar-desktop-${theme}-today-rail.png`,
      tomorrow: `calendar-desktop-${theme}-tomorrow-rail.png`,
    };
    const baselineDaySwitchState = await readCalendarDaySwitchState(page, trackedDayKeys);
    assert(
      trackedDayKeys.every(dayKey => Array.isArray(baselineDaySwitchState.dot_tones_by_day?.[dayKey])),
      `Expected tracked calendar chips for yesterday/today/tomorrow, got ${JSON.stringify(baselineDaySwitchState)}.`
    );
    const baselineDotTonesByDay = baselineDaySwitchState.dot_tones_by_day;
    const desktopDaySwitchSummary = {
      tracked_day_keys: trackedDayKeys,
      tracked_day_labels: trackedDayLabels,
      baseline_dot_tones_by_day: baselineDotTonesByDay,
      switches: {}
    };
    for (const [label, dayKey] of Object.entries(trackedDayLabels)) {
      const switchLogStart = networkLog.length;
      await selectCalendarDayChip(page, dayKey);
      await delay(250);
      const switchedDayState = await readCalendarDaySwitchState(page, trackedDayKeys);
      const selectedDotTones = Array.isArray(switchedDayState.dot_tones_by_day?.[dayKey]) ? switchedDayState.dot_tones_by_day[dayKey] : [];
      const selectedAgendaTonePrefix = switchedDayState.agenda_tones_for_selected_day.slice(0, selectedDotTones.length);
      const switchEntries = networkLog.slice(switchLogStart);
      const calendarEventsRequestUrlsForSwitch = calendarEventsRequestUrls(switchEntries);
      const calendarEventDateRequestUrlsForSwitch = calendarEventDateRequestUrls(switchEntries);
      const switchedDotTonesByDay = switchedDayState.dot_tones_by_day || {};
      assert(
        trackedDayKeys.every(dayKey => Array.isArray(switchedDotTonesByDay[dayKey])),
        `Expected off-day chip dots to stay stable after switching the selected day. ${label} baseline=${JSON.stringify(baselineDotTonesByDay)} current=${JSON.stringify(switchedDayState.dot_tones_by_day)}.`
      );
      assert(
        JSON.stringify(selectedAgendaTonePrefix) === JSON.stringify(selectedDotTones),
        `Expected selected day agenda tones to match that chip's visible dots. ${label} dots=${JSON.stringify(selectedDotTones)} agenda=${JSON.stringify(switchedDayState.agenda_tones_for_selected_day)}.`
      );
      assert(
        calendarEventDateRequestUrlsForSwitch.length === 0,
        `Expected calendar day switches to avoid date-scoped calendar-events reloads. ${label} saw ${calendarEventDateRequestUrlsForSwitch.join(", ") || "(none)"} from ${JSON.stringify(calendarEventsRequestUrlsForSwitch)}.`
      );
      desktopDaySwitchSummary.switches[label] = {
        ...switchedDayState,
        calendar_events_request_urls: calendarEventsRequestUrlsForSwitch,
        calendar_events_date_request_urls: calendarEventDateRequestUrlsForSwitch
      };
      await saveShot(page, reportDir, daySwitchShotNames[label], summary);
      await saveLocatorShot(page.locator(".light-calendar-day-strip"), reportDir, daySwitchRailNames[label], summary);
    }
    summary.calendar_day_switches = summary.calendar_day_switches || {};
    summary.calendar_day_switches[`desktop_${theme}`] = desktopDaySwitchSummary;
    await selectCalendarDayChip(page, seed.today);
    await waitForCalendarTitle(page, "Proof freelance review call");
    await setCalendarDate(page, seed.tomorrow);
    assert(await page.locator(".light-date-input").inputValue() === seed.tomorrow, `Expected desktop off-today selection to land on ${seed.tomorrow}, got ${await page.locator(".light-date-input").inputValue()}.`);
    assert(await page.locator(".light-calendar-today-button").count() === 1, "Expected Today chip to appear once the selected day moves off today.");
    await saveShot(page, reportDir, `calendar-desktop-${theme}-off-today.png`, summary);
    await setCalendarDate(page, seed.today);
    assert(await page.locator(".light-date-input").inputValue() === seed.today, `Expected desktop calendar to return to ${seed.today}, got ${await page.locator(".light-date-input").inputValue()}.`);
    await page.waitForFunction(selector => document.querySelectorAll(`${selector} .light-attendee-chip`).length >= 3, eventSelector);
    assert(await page.locator(`${eventSelector} .light-event-summary`).count() === 0, "Expected agenda cards to drop summary text.");
    const agendaChipTexts = await allText(page, `${eventSelector} .light-attendee-chip`);
    const agendaChipMetrics = {
      agenda_contact_icon_count: await page.locator(`${eventSelector} .light-calendar-attendee-chip-icon`).count(),
      agenda_record_chip_count: await page.locator(`${eventSelector} .light-record-chip`).count(),
    };
    for (const label of ["Jimmy T.", "Jeff B.", "Outside counsel"]) {
      assert(agendaChipTexts.includes(label), `Expected agenda contact chips to include ${label}, got ${agendaChipTexts.join(", ")}.`);
    }
    assert(agendaChipTexts.length === 3, `Expected agenda cards to show all contact-backed attendees, got ${agendaChipTexts.join(", ")}.`);
    assert(agendaChipMetrics.agenda_contact_icon_count === agendaChipTexts.length, `Expected agenda attendee chips to keep a visible contact icon on every chip. Saw ${agendaChipMetrics.agenda_contact_icon_count} icons for ${agendaChipTexts.length} chips.`);
    assert(agendaChipMetrics.agenda_record_chip_count === 0, `Expected agenda attendee chips to avoid record-chip styling. Saw ${agendaChipMetrics.agenda_record_chip_count} record-chip nodes.`);
    assert(!agendaChipTexts.includes("Kitchen table"), "Expected place to stay out of calendar agenda chips.");
    for (const label of ["Proof freelance follow-up", "Send proof review notes · Task", "Send proof review notes · Reminder", "Proof review outline", "Proof freelance prep"]) {
      assert(!agendaChipTexts.includes(label), `Expected agenda cards to hide non-contact graph chips like ${label}.`);
    }
    const firstGap = await gapMetrics(page);
    assert(/^Free .+ - .+$/.test(firstGap.label), `Expected explicit free-range copy, got ${firstGap.label}.`);
    assert(firstGap.laneWidth > 0 && firstGap.gapWidth >= firstGap.laneWidth - 24, `Expected a near full-width free banner, got ${JSON.stringify(firstGap)}.`);
    await assertChipContrast(page, `${eventSelector} .light-attendee-chip.is-link`);
    assert(await page.locator(eventSelector).evaluate(node => node.className.includes("blue")), "Expected the freelance review card to use the shared blue tone.");
    assert(await page.locator(".light-calendar-day-chip.is-selected .light-calendar-day-dot.blue").count() >= 1, "Expected the selected day strip to use the same blue tone for the freelance event.");
    await saveLocatorShot(page.locator(".light-page-header-shell"), reportDir, `calendar-desktop-${theme}-chrome.png`, summary);
    await saveLocatorShot(page.locator(".light-calendar-settings-button"), reportDir, `calendar-desktop-${theme}-settings-button.png`, summary);
    await saveLocatorShot(page.locator(eventSelector).first(), reportDir, `calendar-desktop-${theme}-agenda-tile.png`, summary);
    await saveShot(page, reportDir, `calendar-desktop-${theme}-today.png`, summary);
    const desktopMotion = await runCalendarMotionChecks(page, networkLog, reportDir, summary, laneKey, seed, {
      includeReducedMotion: theme === "light",
    });
    summary.assertions.push(`desktop ${theme} ${config.browserName} rail selection motion stayed inside the fixed duration band`);
    summary.motion_assertions = summary.motion_assertions || {};
    summary.motion_assertions[laneKey] = {
      short_jump_duration_ms: desktopMotion["date-input-short"].total_duration_ms,
      long_jump_duration_ms: desktopMotion["date-input-long"].total_duration_ms,
      short_jump_distance: desktopMotion["date-input-short"].total_distance,
      long_jump_distance: desktopMotion["date-input-long"].total_distance,
    };
    await scrollDayStripToDay(page, firstDayKey, "start");
    const selectedMonthLeft = await calendarStripMetrics(page);
    assert(selectedMonthLeft.visible_day_keys.includes(firstDayKey), `Expected the selected month to expose day 1 on the rail, got ${JSON.stringify(selectedMonthLeft.visible_day_keys)}.`);
    const leftChrome = await calendarChromeState(page);
    assert(leftChrome.input_value === railStateBefore.input_value, "Expected passive rail scrolling to keep the selected date input stable.");
    assert(leftChrome.title === railStateBefore.title, "Expected passive rail scrolling to keep the header month stable.");
    assert(leftChrome.agenda_title === railStateBefore.agenda_title, "Expected passive rail scrolling to keep the agenda headline stable.");
    await saveShot(page, reportDir, `calendar-desktop-${theme}-selected-month-left-edge.png`, summary);
    const continuedPrev = await continueDayStripBeyondEdge(page, "left");
    const desktopLeftVisibleBefore = selectedMonthLeft.visible_day_keys[0] || firstDayKey;
    const desktopLeftVisibleAfter = continuedPrev.visible_day_keys[0] || "";
    assert(desktopLeftVisibleAfter < desktopLeftVisibleBefore, `Expected desktop rail continuation to reveal an earlier visible day than ${desktopLeftVisibleBefore}, got ${desktopLeftVisibleAfter || "(missing)"}.`);
    assert(continuedPrev.visible_day_keys.some(dayKey => monthKeyFromDayKey(dayKey) === shiftMonthKey(selectedMonth, -1)), `Expected desktop rail continuation to keep the prior month visible, got ${JSON.stringify(continuedPrev.visible_day_keys)}.`);
    await saveShot(page, reportDir, `calendar-desktop-${theme}-continued-prev-month.png`, summary);
    await scrollDayStripToDay(page, lastDayKey, "end");
    const selectedMonthRight = await calendarStripMetrics(page);
    assert(selectedMonthRight.visible_day_keys.includes(lastDayKey), `Expected the selected month to expose its last day on the rail, got ${JSON.stringify(selectedMonthRight.visible_day_keys)}.`);
    const rightChrome = await calendarChromeState(page);
    assert(rightChrome.input_value === railStateBefore.input_value, "Expected passive rail scrolling to keep the selected date input stable.");
    assert(rightChrome.title === railStateBefore.title, "Expected passive rail scrolling to keep the header month stable.");
    assert(rightChrome.agenda_title === railStateBefore.agenda_title, "Expected passive rail scrolling to keep the agenda headline stable.");
    await saveShot(page, reportDir, `calendar-desktop-${theme}-selected-month-right-edge.png`, summary);
    const continuedNext = await continueDayStripBeyondEdge(page, "right");
    const nextMonthStartDay = shiftDayKey(lastDayKey, 1);
    const desktopRightVisibleBefore = selectedMonthRight.visible_day_keys[selectedMonthRight.visible_day_keys.length - 1] || lastDayKey;
    const desktopRightVisibleAfter = continuedNext.visible_day_keys[continuedNext.visible_day_keys.length - 1] || "";
    assert(desktopRightVisibleAfter > desktopRightVisibleBefore, `Expected desktop rail continuation to reveal a later visible day than ${desktopRightVisibleBefore}, got ${desktopRightVisibleAfter || "(missing)"}.`);
    assert(continuedNext.visible_day_keys.some(dayKey => monthKeyFromDayKey(dayKey) === shiftMonthKey(selectedMonth, 1)), `Expected desktop rail continuation to keep the next month visible, got ${JSON.stringify(continuedNext.visible_day_keys)}.`);
    await saveShot(page, reportDir, `calendar-desktop-${theme}-continued-next-month.png`, summary);
    await selectCalendarDayChip(page, nextMonthStartDay);
    const adjacentMonthChrome = await calendarChromeState(page);
    assert(adjacentMonthChrome.input_value === nextMonthStartDay, `Expected tapping an adjacent-month day to update the date input to ${nextMonthStartDay}, got ${adjacentMonthChrome.input_value}.`);
    assert(adjacentMonthChrome.title.includes(formatMonthKey(nextMonthStartDay)), `Expected tapping an adjacent-month day to update the header month, got ${adjacentMonthChrome.title}.`);
    assert(adjacentMonthChrome.route === "calendar", `Expected adjacent-month day selection to stay on calendar, got ${adjacentMonthChrome.route}.`);
    await saveShot(page, reportDir, `calendar-desktop-${theme}-adjacent-month-selected.png`, summary);
    summary.calendar_rail = summary.calendar_rail || {};
    summary.calendar_rail[`desktop_${theme}`] = {
      selected_day_before_scroll: railStateBefore.input_value,
      selected_month_before_scroll: selectedMonth,
      rendered_month_keys_before: stripMetrics.rendered_month_keys,
      rendered_month_keys_after_prev: continuedPrev.rendered_month_keys,
      rendered_month_keys_after_next: continuedNext.rendered_month_keys,
      left_edge_visible_labels: selectedMonthLeft.visible_labels,
      right_edge_visible_labels: selectedMonthRight.visible_labels,
      adjacent_month_selected_day: nextMonthStartDay
    };
    await setCalendarDate(page, seed.today);
    await page.waitForFunction(selector => document.querySelectorAll(selector).length >= 1, eventSelector);

    await selectAgendaChip(page, seed, "Jimmy T.");
    await waitForContactDetailName(page, "Jimmy Torres");
    assert(await currentLightRoute(page) === "contact-detail", `Expected contact-detail route after agenda chip tap, got ${await currentLightRoute(page)}.`);
    await saveShot(page, reportDir, `calendar-desktop-${theme}-agenda-chip-contact.png`, summary);
    await clickBackButton(page);
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
    await waitForMeetingDetailWhoChip(page, "Jimmy T.");
    await waitForMeetingDetailWhoChip(page, "Jeff B.");
    let detailState = await readMeetingDetailState(page);
    assert(detailState.sectionTitles.includes("DETAILS"), `Expected event detail section titles to include Details, got ${detailState.sectionTitles.join(", ")}.`);
    assert(detailState.sectionTitles.includes("CONNECTED"), `Expected event detail section titles to include Connected, got ${detailState.sectionTitles.join(", ")}.`);
    assert(!detailState.hasStandaloneDescriptionTitle, "Expected event detail to avoid a standalone Description section.");
    assert(detailState.detailsExpanded, "Expected Details to start expanded on a fresh event open.");
    assert(detailState.connectedExpanded, "Expected Connected to start expanded on a fresh event open.");
    assert(detailState.descriptionVisible, "Expected merged description text inside Details.");
    assert(detailState.descriptionText.includes("Homepage pass, invoice cleanup"), `Expected merged description text inside Details, got ${detailState.descriptionText}.`);
    assert(detailState.description_link_count >= 1, "Expected merged description text to expose a clickable Google Meet URL.");
    assert(detailState.description_link_hrefs.some(value => value.includes("meet.google.com")), `Expected merged description link to target meet.google.com. Got ${JSON.stringify(detailState.description_link_hrefs)}.`);
    assert(detailState.connectedCount === 7, `Expected Connected header count to show seven linked records, got ${detailState.connectedCount}.`);
    assert(detailState.visibleConnectedRowCount === 7, `Expected Connected rows to stay visible while expanded, got ${detailState.visibleConnectedRowCount}.`);
    assert(!detailState.text.includes("Linked records"), "Expected event detail to keep the section label as Connected.");
    assert(await page.locator('.light-calendar-detail-row[data-detail-row="who"] .light-calendar-detail-guest-list').count() === 0, "Expected Who to render guests as chips instead of paragraph copy.");
    assert(detailState.detailRowMetrics.when?.is_compact, `Expected When row to use compact metadata layout, got ${JSON.stringify(detailState.detailRowMetrics.when)}.`);
    assert(detailState.detailRowMetrics.who?.is_compact, `Expected Who row to use compact metadata layout, got ${JSON.stringify(detailState.detailRowMetrics.who)}.`);
    assert(detailState.detailRowMetrics.place?.is_compact, `Expected Place row to use compact metadata layout, got ${JSON.stringify(detailState.detailRowMetrics.place)}.`);
    assert(!/\b(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\b/.test(detailState.detailRowValues.when || ""), `Expected compact When to avoid weekday text, got ${detailState.detailRowValues.when}.`);
    assert((detailState.detailRowValues.when || "").includes("June"), `Expected compact When to keep month/day text, got ${detailState.detailRowValues.when}.`);
    assert(detailState.detailRowMetrics.when?.row_top_delta_px !== null && detailState.detailRowMetrics.when.row_top_delta_px <= 4, `Expected compact When row to align label and value on one line, got ${JSON.stringify(detailState.detailRowMetrics.when)}.`);
    assert(detailState.detailRowMetrics.who?.row_top_delta_px !== null && detailState.detailRowMetrics.who.row_top_delta_px <= 6, `Expected compact Who row to align label and first chip on one line, got ${JSON.stringify(detailState.detailRowMetrics.who)}.`);
    assert(detailState.detailRowMetrics.place?.row_top_delta_px !== null && detailState.detailRowMetrics.place.row_top_delta_px <= 4, `Expected compact Place row to align label and value on one line, got ${JSON.stringify(detailState.detailRowMetrics.place)}.`);
    assert(detailState.who_chip_gap_px >= 6, `Expected compact Who row to keep visible chip spacing, got ${detailState.who_chip_gap_px}.`);
    const whoChipTexts = detailState.whoChipTexts;
    assert(await page.locator('.light-calendar-detail-row[data-detail-row="who"] .light-attendee-chip').count() >= whoChipTexts.length, "Expected Who to render every attendee as a chip.");
    assert(detailState.who_contact_icon_count === whoChipTexts.length, `Expected Calendar Who row to keep a visible contact icon on every attendee chip. Saw ${detailState.who_contact_icon_count} icons for ${whoChipTexts.length} chips.`);
    assert(detailState.who_guest_chip_count === 0, `Expected Calendar Who row to avoid guest attendee chips, got ${detailState.who_guest_chip_count}.`);
    assert(detailState.who_record_chip_count === 0, `Expected Calendar Who row to avoid record-chip styling. Saw ${detailState.who_record_chip_count} record-chip nodes.`);
    assert(detailState.details_card_overflow_x <= 1, `Expected desktop Details card to avoid horizontal overflow, got ${detailState.details_card_overflow_x}.`);
    for (const label of ["Jimmy T.", "Jeff B.", "Outside counsel"]) {
      assert(whoChipTexts.includes(label), `Expected Who to include ${label}, got ${whoChipTexts.join(", ")}.`);
    }
    await assertChipContrast(page, '.light-calendar-detail-row[data-detail-row="who"] .light-calendar-attendee-chip.is-link');
    await saveShot(page, reportDir, `calendar-desktop-${theme}-event-detail-default.png`, summary);
    await saveLocatorShot(page.locator(".light-calendar-event-detail-card").first(), reportDir, `calendar-desktop-${theme}-event-detail-details-card.png`, summary);
    await saveLocatorShot(page.locator('.light-calendar-detail-row[data-detail-row="who"]').first(), reportDir, `calendar-desktop-${theme}-event-detail-who-row.png`, summary);
    await saveLocatorShot(page.locator(".light-calendar-detail-description").first(), reportDir, `calendar-desktop-${theme}-event-detail-description-link.png`, summary);

    await ensureMeetingDetailSectionExpanded(page, "connected", true);
    detailState = await readMeetingDetailState(page);
    assert(detailState.connectedExpanded, "Expected Connected to stay expanded after tapping its header.");
    assert(detailState.visibleConnectedRowCount === 7, `Expected Connected to reveal seven flat linked rows, got ${detailState.visibleConnectedRowCount}.`);
    const connectedSection = page.locator('.light-linked-records-section[data-linked-records-title="connected"]').first();
    const connectedRows = page.locator('.light-linked-records-section[data-linked-records-title="connected"] .light-linked-record-feed-row');
    const connectedRowTexts = await allText(page, '.light-linked-records-section[data-linked-records-title="connected"] .light-linked-record-feed-row');
    const connectedLayout = await connectedSectionLayoutMetrics(page);
    assert(await page.locator('.light-linked-records-section[data-linked-records-title="connected"] .light-attendee-chip').count() === 0, "Expected Connected to switch from attendee pills to standard feed rows.");
    assert(await page.locator('.light-linked-records-section[data-linked-records-title="connected"] .light-chevron').count() === 0, "Expected Connected rows to omit trailing chevrons on desktop detail.");
    assert(connectedLayout.recordChipCount === 0, `Expected Connected rows to omit linked-record chips on desktop detail, got ${JSON.stringify(connectedLayout)}.`);
    assert(connectedLayout.sectionClassName.includes("is-flat-feed") && connectedLayout.bodyClassName.includes("is-flat-feed"), `Expected Connected section to render inside one shared flat-feed shell on desktop detail, got ${JSON.stringify(connectedLayout)}.`);
    assert(connectedLayout.flatRowCount === connectedLayout.rowCount, `Expected Connected rows to all render in flat-feed mode on desktop detail, got ${JSON.stringify(connectedLayout)}.`);
    assert(await connectedRows.count() === 7, `Expected the populated Connected section to render seven linked rows, got ${await connectedRows.count()}.`);
    for (const label of ["Jimmy Torres", "Jeff Bennett", "Proof freelance follow-up", "Send proof review notes · Task", "Send proof review notes · Reminder", "Proof review outline", "Proof freelance prep"]) {
      const normalizedLabel = label.replace(" · Task", "").replace(" · Reminder", "");
      assert(connectedRowTexts.some(value => value.includes(normalizedLabel)), `Expected Connected to include ${label}, got ${connectedRowTexts.join(", ")}.`);
    }
    assert(new Set(connectedRowTexts.map(value => value.replace(/\s+/g, " ").trim())).size === connectedRowTexts.length, `Expected Connected rows to stay curated and distinct on desktop detail. Got ${connectedRowTexts.join(" | ")}.`);
    assert(connectedRowTexts.some(value => value.includes("Jimmy Torres")), "Expected linked contacts to appear in Connected as full feed rows.");
    assert(connectedRowTexts.some(value => value.includes("Jeff Bennett")), "Expected linked contacts to appear in Connected as full feed rows.");
    assert(!connectedRowTexts.some(value => value.includes("Outside counsel")), "Expected unlinked attendee contacts to stay out of Connected.");
    assert(!connectedRowTexts.some(value => value.includes("Kitchen table")), "Expected place to stay out of Connected rows on detail.");
    assert(await page.locator('.light-calendar-detail-row[data-detail-row="place"] .light-attendee-chip').count() === 0, "Expected Place to stay plain text only.");
    await saveLocatorShot(connectedSection, reportDir, `calendar-desktop-${theme}-connected.png`, summary);
    await saveShot(page, reportDir, `calendar-desktop-${theme}-event-detail-connected-expanded.png`, summary);

    await ensureMeetingDetailSectionExpanded(page, "details", false);
    detailState = await readMeetingDetailState(page);
    assert(!detailState.detailsExpanded, "Expected Details to collapse after tapping its header.");
    assert(detailState.visibleDetailRowLabels.length === 0, `Expected Details collapse to hide metadata rows, got ${detailState.visibleDetailRowLabels.join(", ")}.`);
    assert(!detailState.descriptionVisible, "Expected Details collapse to hide merged description text.");
    await saveShot(page, reportDir, `calendar-desktop-${theme}-event-detail-details-collapsed.png`, summary);

    await ensureMeetingDetailSectionExpanded(page, "details", true);
    await ensureMeetingDetailSectionExpanded(page, "connected", true);
    await saveShot(page, reportDir, `calendar-desktop-${theme}-event-detail.png`, summary);
    await page.locator('.light-calendar-detail-row[data-detail-row="who"] .light-attendee-chip', { hasText: "Jimmy T." }).first().click();
    await waitForContactDetailName(page, "Jimmy Torres");
    assert(await currentLightRoute(page) === "contact-detail", `Expected contact-detail route after Who chip tap, got ${await currentLightRoute(page)}.`);
    await clickBackButton(page);
    assert(await currentLightRoute(page) === "meeting-detail", `Expected Back from Who chip to restore meeting-detail, got ${await currentLightRoute(page)}.`);
    await waitForHeaderText(page, "Proof freelance review call");
    detailState = await readMeetingDetailState(page);
    assert(detailState.connectedExpanded, "Expected Back from Who chip to preserve Connected expanded state.");
    for (const target of [
      { id: `${seed.runId}-project`, route: "project-detail", expectedText: "Proof freelance follow-up" },
      { id: `${seed.runId}-task`, route: "task-detail", expectedText: "Send proof review notes" },
      { id: `${seed.runId}-note`, route: "note-detail", expectedText: "Proof review outline" },
      { id: `${seed.runId}-meeting-note`, route: "meeting-note-detail", expectedText: "Proof freelance prep" },
      { id: `${seed.runId}-reminder`, route: "reminder-detail", expectedText: "Send proof review notes" }
    ]) {
      await selectCalendarDetailTarget(page, config, target.route, target.id, target.expectedText);
      await saveShot(page, reportDir, `calendar-desktop-${theme}-${target.route}.png`, summary);
      await clickBackButton(page);
      assert(await currentLightRoute(page) === "meeting-detail", `Expected Back from ${target.route} to restore meeting-detail, got ${await currentLightRoute(page)}.`);
      await waitForHeaderText(page, "Proof freelance review call");
      detailState = await readMeetingDetailState(page);
      assert(detailState.connectedExpanded, "Expected Back from linked target to restore Connected expanded state.");
    }
    await saveShot(page, reportDir, `calendar-desktop-${theme}-event-detail-connected-restored.png`, summary);
    await clickBackButton(page);
    assert(await currentLightRoute(page) === "calendar", `Expected Back from event detail to restore calendar, got ${await currentLightRoute(page)}.`);
    await setCalendarDate(page, seed.tomorrow);
    await selectCalendarEventById(page, seed, "clinic", "Proof clinic paperwork check-in");
    let clinicDetailState = await readMeetingDetailState(page);
    assert(clinicDetailState.detailsExpanded, "Expected clinic detail to keep Details expanded by default.");
    assert(clinicDetailState.who_guest_chip_count === 0, `Expected clinic detail to avoid guest attendee chips, got ${clinicDetailState.who_guest_chip_count}.`);
    assert(clinicDetailState.who_contact_icon_count === clinicDetailState.whoChipTexts.length, `Expected clinic detail Who row to keep contact icons on every attendee chip. Saw ${clinicDetailState.who_contact_icon_count} icons for ${clinicDetailState.whoChipTexts.length} chips.`);
    assert(clinicDetailState.who_record_chip_count === 0, `Expected clinic detail Who row to avoid record-chip styling. Saw ${clinicDetailState.who_record_chip_count} record-chip nodes.`);
    assert(clinicDetailState.whoChipTexts.includes("Clinic front desk"), `Expected clinic detail to render the role-style contact as a recognized chip, got ${clinicDetailState.whoChipTexts.join(", ")}.`);
    assert(clinicDetailState.detailRowMetrics.who?.row_top_delta_px !== null && clinicDetailState.detailRowMetrics.who.row_top_delta_px <= 6, `Expected clinic Who row to stay compact, got ${JSON.stringify(clinicDetailState.detailRowMetrics.who)}.`);
    assert(clinicDetailState.place_primary_text === "Westside Clinic", `Expected clinic detail to render a primary place label. Got ${clinicDetailState.place_primary_text}.`);
    assert(clinicDetailState.place_address_text.includes("11714 Wilshire Blvd"), `Expected clinic detail to render address text beneath the place label. Got ${clinicDetailState.place_address_text}.`);
    await saveShot(page, reportDir, `calendar-desktop-${theme}-clinic-detail.png`, summary);
    await saveLocatorShot(page.locator('.light-calendar-detail-row[data-detail-row="who"]').first(), reportDir, `calendar-desktop-${theme}-clinic-who-row.png`, summary);
    await saveLocatorShot(page.locator('.light-calendar-detail-row[data-detail-row="place"]').first(), reportDir, `calendar-desktop-${theme}-clinic-place-row.png`, summary);
    await clickBackButton(page);
    await page.locator(".light-date-input").waitFor({ state: "visible" });
    assert(await currentLightRoute(page) === "calendar", `Expected Back from clinic detail to restore calendar, got ${await currentLightRoute(page)}.`);
    await setCalendarDate(page, seed.today);
    await selectCalendarEventById(page, seed, "katy-handoff", "Proof Katy pickup handoff");
    const emptyConnectedSection = page.locator('.light-linked-records-section[data-linked-records-title="connected"]').first();
    assert(await emptyConnectedSection.count() === 0, "Expected the sparse event to omit Connected entirely when there are no linked records.");
    await saveShot(page, reportDir, `calendar-desktop-${theme}-connected-empty.png`, summary);
    await clickBackButton(page);
    await page.locator(".light-date-input").waitFor({ state: "visible" });
    assert(await currentLightRoute(page) === "calendar", `Expected Back from event detail to restore calendar, got ${await currentLightRoute(page)}.`);
    assert(await page.locator(".light-date-input").inputValue() === seed.today, "Expected event-detail Back to preserve the selected day.");
    await selectCalendarEventByContainer(page, seed);
    detailState = await readMeetingDetailState(page);
    assert(detailState.detailsExpanded, "Expected reopening the event detail to reset Details open.");
    assert(detailState.connectedExpanded, "Expected reopening the event detail to reset Connected open.");
    await saveShot(page, reportDir, `calendar-desktop-${theme}-event-detail-container-click.png`, summary);
    await clickBackButton(page);
    await page.locator(".light-date-input").waitFor({ state: "visible" });
    assert(await currentLightRoute(page) === "calendar", `Expected Back from container-tap event detail to restore calendar, got ${await currentLightRoute(page)}.`);
    assert(await page.locator(".light-date-input").inputValue() === seed.today, "Expected container-tap Back to preserve the selected day.");
    summary.assertions.push(`desktop ${theme} calendar detail kept section toggles, reset defaults, connected rows, and Back restoration`);

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
    assert(scrollMetrics.headerShellTop <= 1, `Expected sticky header shell to pin at top, got ${JSON.stringify(scrollMetrics)}`);
    assert(scrollMetrics.headerTop <= 1, `Expected sticky header to pin at top, got ${scrollMetrics.headerTop}`);
    assert(scrollMetrics.chromeTop >= 0 && scrollMetrics.chromeBottom <= scrollMetrics.headerShellBottom + 2, `Expected sticky calendar chrome to remain inside the header shell, got ${JSON.stringify(scrollMetrics)}`);
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
    const lateCallOnSelectedDay = await page.locator(lateCallSelector).count();
    if (seed.lateCallNewYorkDay === seed.today) {
      assert(lateCallOnSelectedDay === 1, "Expected the seeded late-call event to remain on today in New York.");
    } else {
      assert(lateCallOnSelectedDay === 0, "Expected the seeded late-call event to move off the selected day after timezone switch.");
    }
    await setCalendarDate(page, seed.lateCallNewYorkDay);
    const shiftedLateCallCount = await page.locator(lateCallSelector).count();
    if (shiftedLateCallCount === 1) {
      const lateCallTimeNode = page.locator(`${lateCallSelector} .light-event-time`).first();
      if (await lateCallTimeNode.count()) {
        const lateCallTime = String(await lateCallTimeNode.textContent() || "").trim();
        assert(lateCallTime.includes(seed.lateCallNewYorkTime), `Expected the seeded late-call event to shift to ${seed.lateCallNewYorkTime} in New York, got ${lateCallTime}.`);
      }
    }
    await saveShot(page, reportDir, `calendar-desktop-${theme}-timezone-shift.png`, summary);
    summary.assertions.push(`desktop ${theme} timezone switch changed calendar grouping and times`);
  } finally {
    const tracePath = path.join(reportDir, `trace-desktop-${theme}.zip`);
    await context.tracing.stop({ path: tracePath });
    await context.close();
    const videoPath = video ? await video.path().catch(() => "") : "";
    summary.artifacts = summary.artifacts || {};
    summary.artifacts[laneKey] = {
      trace_path: tracePath,
      video_path: videoPath,
    };
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
  const video = page.video();
  const laneKey = `mobile_${theme}_${config.browserName}`;
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
    await setReducedMotion(page, false);
    await openCalendarProofRoot(page, config, theme);
    await openHomeCalendar(page);
    const chromeText = await calendarChromeText(page);
    assert(await page.locator(".light-date-input").count() === 1, "Expected a native date input on mobile.");
    const chromeMetrics = await calendarChromeLayoutMetrics(page);
    assert(chromeMetrics.chromeInHeaderShell, `Expected calendar chrome to live inside the sticky header shell, got ${JSON.stringify(chromeMetrics)}.`);
    assert(chromeMetrics.chromePosition !== "sticky", `Expected calendar chrome to stop using its own sticky positioning, got ${JSON.stringify(chromeMetrics)}.`);
    assert(chromeMetrics.topRowWidth >= chromeMetrics.laneWidth - 2, `Expected calendar top row to span the full calendar lane, got ${JSON.stringify(chromeMetrics)}.`);
    assert(chromeMetrics.stripWidth >= chromeMetrics.laneWidth - 2, `Expected calendar day rail to span the full calendar lane, got ${JSON.stringify(chromeMetrics)}.`);
    assert(chromeMetrics.settingsButtonClassName.includes("light-icon-button") && !chromeMetrics.settingsButtonClassName.includes("light-circle-button"), `Expected calendar settings button to use the plain icon-button class, got ${JSON.stringify(chromeMetrics)}.`);
    assert(chromeMetrics.settingsButtonBorderWidth === "0px", `Expected calendar settings button to drop the circular shell border, got ${JSON.stringify(chromeMetrics)}.`);
    assert(isTransparentBackground(chromeMetrics.settingsButtonBackground), `Expected calendar settings button to drop the circular shell fill, got ${JSON.stringify(chromeMetrics)}.`);
    assert(chromeMetrics.settingsButtonBoxShadow === "none", `Expected calendar settings button to drop the circular shell shadow, got ${JSON.stringify(chromeMetrics)}.`);
    const stripMetrics = await calendarStripMetrics(page);
    const railStateBefore = await calendarChromeState(page);
    const selectedMonth = monthKeyFromDayKey(seed.today);
    const { first_day_key: firstDayKey, last_day_key: lastDayKey } = monthEdgeDayKeys(seed.today);
    assert(stripMetrics.rendered_month_keys.includes(selectedMonth), `Expected the selected month ${selectedMonth} to render on the mobile rail, got ${JSON.stringify(stripMetrics.rendered_month_keys)}.`);
    assert(stripMetrics.rendered_month_keys.includes(shiftMonthKey(selectedMonth, -1)), `Expected the mobile rail to preload the prior month before scrolling, got ${JSON.stringify(stripMetrics.rendered_month_keys)}.`);
    assert(stripMetrics.rendered_month_keys.includes(shiftMonthKey(selectedMonth, 1)), `Expected the mobile rail to preload the next month before scrolling, got ${JSON.stringify(stripMetrics.rendered_month_keys)}.`);
    assert(!chromeText.includes("Pinned"), "Expected mobile calendar chrome to hide Pinned copy.");
    assert(!chromeText.includes("Device local"), "Expected mobile calendar chrome to hide Device local copy.");
    assert(!chromeText.includes("America/"), "Expected mobile calendar chrome to hide raw timezone text.");
    assert(!chromeText.includes("Jump to date"), "Expected mobile calendar chrome without Jump to date copy.");
    assert(!chromeText.includes("Busy window"), "Expected mobile calendar chrome to drop Busy window copy.");
    assert(await page.locator(".light-calendar-strip-nav-button").count() === 0, "Expected no desktop calendar rail chevrons to remain.");
    assert(await page.locator(".light-calendar-today-button").count() === 0, "Expected Today chip to stay hidden on the already-selected mobile today view.");
    assert(await page.locator(".light-event-badge").count() === 0, "Expected mobile agenda cards to hide the legacy type badge.");
    const eventSelector = proofEventSelector(seed);
    const trackedDayLabels = {
      yesterday: seed.yesterday || shiftDayKey(seed.today, -1),
      today: seed.today,
      tomorrow: seed.tomorrow
    };
    const trackedDayKeys = Object.values(trackedDayLabels);
    const daySwitchShotNames = {
      yesterday: `calendar-mobile-${theme}-yesterday-selected.png`,
      today: `calendar-mobile-${theme}-today-selected.png`,
      tomorrow: `calendar-mobile-${theme}-tomorrow-selected.png`,
    };
    const daySwitchRailNames = {
      yesterday: `calendar-mobile-${theme}-yesterday-rail.png`,
      today: `calendar-mobile-${theme}-today-rail.png`,
      tomorrow: `calendar-mobile-${theme}-tomorrow-rail.png`,
    };
    const baselineDaySwitchState = await readCalendarDaySwitchState(page, trackedDayKeys);
    assert(
      trackedDayKeys.every(dayKey => Array.isArray(baselineDaySwitchState.dot_tones_by_day?.[dayKey])),
      `Expected tracked calendar chips for yesterday/today/tomorrow, got ${JSON.stringify(baselineDaySwitchState)}.`
    );
    const baselineDotTonesByDay = baselineDaySwitchState.dot_tones_by_day;
    const mobileDaySwitchSummary = {
      tracked_day_keys: trackedDayKeys,
      tracked_day_labels: trackedDayLabels,
      baseline_dot_tones_by_day: baselineDotTonesByDay,
      switches: {}
    };
    for (const [label, dayKey] of Object.entries(trackedDayLabels)) {
      const switchLogStart = networkLog.length;
      await selectCalendarDayChip(page, dayKey);
      await delay(250);
      const switchedDayState = await readCalendarDaySwitchState(page, trackedDayKeys);
      const selectedDotTones = Array.isArray(switchedDayState.dot_tones_by_day?.[dayKey]) ? switchedDayState.dot_tones_by_day[dayKey] : [];
      const selectedAgendaTonePrefix = switchedDayState.agenda_tones_for_selected_day.slice(0, selectedDotTones.length);
      const switchEntries = networkLog.slice(switchLogStart);
      const calendarEventsRequestUrlsForSwitch = calendarEventsRequestUrls(switchEntries);
      const calendarEventDateRequestUrlsForSwitch = calendarEventDateRequestUrls(switchEntries);
      const switchedDotTonesByDay = switchedDayState.dot_tones_by_day || {};
      assert(
        trackedDayKeys.every(dayKey => Array.isArray(switchedDotTonesByDay[dayKey])),
        `Expected off-day chip dots to stay stable after switching the selected day. ${label} baseline=${JSON.stringify(baselineDotTonesByDay)} current=${JSON.stringify(switchedDayState.dot_tones_by_day)}.`
      );
      assert(
        JSON.stringify(selectedAgendaTonePrefix) === JSON.stringify(selectedDotTones),
        `Expected selected day agenda tones to match that chip's visible dots. ${label} dots=${JSON.stringify(selectedDotTones)} agenda=${JSON.stringify(switchedDayState.agenda_tones_for_selected_day)}.`
      );
      assert(
        calendarEventDateRequestUrlsForSwitch.length === 0,
        `Expected calendar day switches to avoid date-scoped calendar-events reloads. ${label} saw ${calendarEventDateRequestUrlsForSwitch.join(", ") || "(none)"} from ${JSON.stringify(calendarEventsRequestUrlsForSwitch)}.`
      );
      mobileDaySwitchSummary.switches[label] = {
        ...switchedDayState,
        calendar_events_request_urls: calendarEventsRequestUrlsForSwitch,
        calendar_events_date_request_urls: calendarEventDateRequestUrlsForSwitch
      };
      await saveShot(page, reportDir, daySwitchShotNames[label], summary);
      await saveLocatorShot(page.locator(".light-calendar-day-strip"), reportDir, daySwitchRailNames[label], summary);
    }
    summary.calendar_day_switches = summary.calendar_day_switches || {};
    summary.calendar_day_switches[`mobile_${theme}`] = mobileDaySwitchSummary;
    await selectCalendarDayChip(page, seed.today);
    await waitForCalendarTitle(page, "Proof freelance review call");
    await setCalendarDate(page, seed.tomorrow);
    assert(await page.locator(".light-date-input").inputValue() === seed.tomorrow, `Expected mobile off-today selection to land on ${seed.tomorrow}, got ${await page.locator(".light-date-input").inputValue()}.`);
    assert(await page.locator(".light-calendar-today-button").count() === 1, "Expected mobile Today chip to appear once the selected day moves off today.");
    await saveShot(page, reportDir, `calendar-mobile-${theme}-off-today.png`, summary);
    await setCalendarDate(page, seed.today);
    assert(await page.locator(".light-date-input").inputValue() === seed.today, `Expected mobile calendar to return to ${seed.today}, got ${await page.locator(".light-date-input").inputValue()}.`);
    await page.waitForFunction(selector => document.querySelectorAll(`${selector} .light-attendee-chip`).length >= 3, eventSelector);
    assert(await page.locator(`${eventSelector} .light-event-summary`).count() === 0, "Expected mobile agenda cards to drop summary text.");
    const mobileChipTexts = await allText(page, `${eventSelector} .light-attendee-chip`);
    const mobileAgendaChipMetrics = {
      agenda_contact_icon_count: await page.locator(`${eventSelector} .light-calendar-attendee-chip-icon`).count(),
      agenda_record_chip_count: await page.locator(`${eventSelector} .light-record-chip`).count(),
    };
    for (const label of ["Jimmy T.", "Jeff B.", "Outside counsel"]) {
      assert(mobileChipTexts.includes(label), `Expected mobile agenda contact chips to include ${label}, got ${mobileChipTexts.join(", ")}.`);
    }
    assert(mobileChipTexts.length === 3, `Expected mobile agenda cards to show all contact-backed attendees, got ${mobileChipTexts.join(", ")}.`);
    assert(mobileAgendaChipMetrics.agenda_contact_icon_count === mobileChipTexts.length, `Expected mobile agenda attendee chips to keep a visible contact icon on every chip. Saw ${mobileAgendaChipMetrics.agenda_contact_icon_count} icons for ${mobileChipTexts.length} chips.`);
    assert(mobileAgendaChipMetrics.agenda_record_chip_count === 0, `Expected mobile agenda attendee chips to avoid record-chip styling. Saw ${mobileAgendaChipMetrics.agenda_record_chip_count} record-chip nodes.`);
    assert(!mobileChipTexts.includes("Kitchen table"), "Expected place to stay out of mobile agenda chips.");
    for (const label of ["Proof freelance follow-up", "Send proof review notes · Task", "Send proof review notes · Reminder", "Proof review outline", "Proof freelance prep"]) {
      assert(!mobileChipTexts.includes(label), `Expected mobile agenda cards to hide non-contact graph chips like ${label}.`);
    }
    const mobileGap = await gapMetrics(page);
    assert(/^Free .+ - .+$/.test(mobileGap.label), `Expected mobile free-range copy, got ${mobileGap.label}.`);
    await assertChipContrast(page, `${eventSelector} .light-attendee-chip.is-link`);
    await saveLocatorShot(page.locator(".light-page-header-shell"), reportDir, `calendar-mobile-${theme}-chrome.png`, summary);
    await saveLocatorShot(page.locator(".light-calendar-settings-button"), reportDir, `calendar-mobile-${theme}-settings-button.png`, summary);
    await saveLocatorShot(page.locator(eventSelector).first(), reportDir, `calendar-mobile-${theme}-agenda-tile.png`, summary);
    await saveShot(page, reportDir, `calendar-mobile-${theme}-top.png`, summary);
    const mobileMotion = await runCalendarMotionChecks(page, networkLog, reportDir, summary, laneKey, seed, {
      includeReducedMotion: theme === "light",
    });
    summary.assertions.push(`mobile ${theme} ${config.browserName} rail selection motion stayed inside the fixed duration band`);
    summary.motion_assertions = summary.motion_assertions || {};
    summary.motion_assertions[laneKey] = {
      short_jump_duration_ms: mobileMotion["date-input-short"].total_duration_ms,
      long_jump_duration_ms: mobileMotion["date-input-long"].total_duration_ms,
      short_jump_distance: mobileMotion["date-input-short"].total_distance,
      long_jump_distance: mobileMotion["date-input-long"].total_distance,
    };
    await scrollDayStripToDay(page, firstDayKey, "start");
    const selectedMonthLeft = await calendarStripMetrics(page);
    assert(selectedMonthLeft.visible_day_keys.includes(firstDayKey), `Expected the selected month to expose day 1 on the rail, got ${JSON.stringify(selectedMonthLeft.visible_day_keys)}.`);
    const leftChrome = await calendarChromeState(page);
    assert(leftChrome.input_value === railStateBefore.input_value, "Expected passive rail scrolling to keep the selected date input stable.");
    assert(leftChrome.title === railStateBefore.title, "Expected passive rail scrolling to keep the header month stable.");
    assert(leftChrome.agenda_title === railStateBefore.agenda_title, "Expected passive rail scrolling to keep the agenda headline stable.");
    await saveShot(page, reportDir, `calendar-mobile-${theme}-selected-month-left-edge.png`, summary);
    const continuedPrev = await continueDayStripBeyondEdge(page, "left");
    const mobileLeftVisibleBefore = selectedMonthLeft.visible_day_keys[0] || firstDayKey;
    const mobileLeftVisibleAfter = continuedPrev.visible_day_keys[0] || "";
    assert(mobileLeftVisibleAfter < mobileLeftVisibleBefore, `Expected mobile rail continuation to reveal an earlier visible day than ${mobileLeftVisibleBefore}, got ${mobileLeftVisibleAfter || "(missing)"}.`);
    assert(continuedPrev.visible_day_keys.some(dayKey => monthKeyFromDayKey(dayKey) === shiftMonthKey(selectedMonth, -1)), `Expected mobile rail continuation to keep the prior month visible, got ${JSON.stringify(continuedPrev.visible_day_keys)}.`);
    await saveShot(page, reportDir, `calendar-mobile-${theme}-continued-prev-month.png`, summary);
    await scrollDayStripToDay(page, lastDayKey, "end");
    const selectedMonthRight = await calendarStripMetrics(page);
    assert(selectedMonthRight.visible_day_keys.includes(lastDayKey), `Expected the selected month to expose its last day on the rail, got ${JSON.stringify(selectedMonthRight.visible_day_keys)}.`);
    const rightChrome = await calendarChromeState(page);
    assert(rightChrome.input_value === railStateBefore.input_value, "Expected passive rail scrolling to keep the selected date input stable.");
    assert(rightChrome.title === railStateBefore.title, "Expected passive rail scrolling to keep the header month stable.");
    assert(rightChrome.agenda_title === railStateBefore.agenda_title, "Expected passive rail scrolling to keep the agenda headline stable.");
    await saveShot(page, reportDir, `calendar-mobile-${theme}-selected-month-right-edge.png`, summary);
    const continuedNext = await continueDayStripBeyondEdge(page, "right");
    const nextMonthStartDay = shiftDayKey(lastDayKey, 1);
    const mobileRightVisibleBefore = selectedMonthRight.visible_day_keys[selectedMonthRight.visible_day_keys.length - 1] || lastDayKey;
    const mobileRightVisibleAfter = continuedNext.visible_day_keys[continuedNext.visible_day_keys.length - 1] || "";
    assert(mobileRightVisibleAfter > mobileRightVisibleBefore, `Expected mobile rail continuation to reveal a later visible day than ${mobileRightVisibleBefore}, got ${mobileRightVisibleAfter || "(missing)"}.`);
    assert(continuedNext.visible_day_keys.some(dayKey => monthKeyFromDayKey(dayKey) === shiftMonthKey(selectedMonth, 1)), `Expected mobile rail continuation to keep the next month visible, got ${JSON.stringify(continuedNext.visible_day_keys)}.`);
    await saveShot(page, reportDir, `calendar-mobile-${theme}-continued-next-month.png`, summary);
    await selectCalendarDayChip(page, nextMonthStartDay);
    const adjacentMonthChrome = await calendarChromeState(page);
    assert(adjacentMonthChrome.input_value === nextMonthStartDay, `Expected tapping an adjacent-month day to update the date input to ${nextMonthStartDay}, got ${adjacentMonthChrome.input_value}.`);
    assert(adjacentMonthChrome.title.includes(formatMonthKey(nextMonthStartDay)), `Expected tapping an adjacent-month day to update the header month, got ${adjacentMonthChrome.title}.`);
    assert(adjacentMonthChrome.route === "calendar", `Expected adjacent-month day selection to stay on calendar, got ${adjacentMonthChrome.route}.`);
    await saveShot(page, reportDir, `calendar-mobile-${theme}-adjacent-month-selected.png`, summary);
    summary.calendar_rail = summary.calendar_rail || {};
    summary.calendar_rail[`mobile_${theme}`] = {
      selected_day_before_scroll: railStateBefore.input_value,
      selected_month_before_scroll: selectedMonth,
      rendered_month_keys_before: stripMetrics.rendered_month_keys,
      rendered_month_keys_after_prev: continuedPrev.rendered_month_keys,
      rendered_month_keys_after_next: continuedNext.rendered_month_keys,
      left_edge_visible_labels: selectedMonthLeft.visible_labels,
      right_edge_visible_labels: selectedMonthRight.visible_labels,
      adjacent_month_selected_day: nextMonthStartDay
    };
    await setCalendarDate(page, seed.today);
    await page.waitForFunction(selector => document.querySelectorAll(selector).length >= 1, eventSelector);
    await selectAgendaChip(page, seed, "Jimmy T.");
    await waitForContactDetailName(page, "Jimmy Torres");
    assert(await currentLightRoute(page) === "contact-detail", `Expected mobile contact-detail route after agenda chip tap, got ${await currentLightRoute(page)}.`);
    await clickBackButton(page);
    await page.locator(".light-date-input").waitFor({ state: "visible" });
    assert(await currentLightRoute(page) === "calendar", `Expected Back from mobile agenda chip to restore calendar, got ${await currentLightRoute(page)}.`);
    assert(await page.locator(".light-date-input").inputValue() === seed.today, "Expected mobile agenda Back to preserve the selected day.");
    assert((await visibleCalendarTitles(page)).includes("Proof freelance review call"), "Expected the source mobile event to remain visible after returning to the agenda.");

    await selectCalendarEvent(page, seed);
    assert(await page.locator(".light-event-detail-time").count() === 0, "Expected mobile event detail to remove the redundant time line beneath the header.");
    assert(await page.locator(".light-doc-eyebrow").count() === 0, "Expected the mobile detail eyebrow to be removed.");
    assert(await page.locator(".light-doc-article h1").count() === 0, "Expected the mobile detail to avoid a duplicated large title.");
    await waitForMeetingDetailWhoChip(page, "Jimmy T.");
    await waitForMeetingDetailWhoChip(page, "Jeff B.");
    let mobileDetailState = await readMeetingDetailState(page);
    assert(mobileDetailState.sectionTitles.includes("DETAILS"), `Expected mobile event detail section titles to include Details, got ${mobileDetailState.sectionTitles.join(", ")}.`);
    assert(mobileDetailState.sectionTitles.includes("CONNECTED"), `Expected mobile event detail section titles to include Connected, got ${mobileDetailState.sectionTitles.join(", ")}.`);
    assert(!mobileDetailState.hasStandaloneDescriptionTitle, "Expected mobile event detail to avoid a standalone Description section.");
    assert(mobileDetailState.detailsExpanded, "Expected Details to start expanded on a fresh event open.");
    assert(mobileDetailState.connectedExpanded, "Expected Connected to start expanded on a fresh event open.");
    assert(mobileDetailState.descriptionVisible, "Expected merged description text inside Details.");
    assert(mobileDetailState.descriptionText.includes("Homepage pass, invoice cleanup"), `Expected merged description text inside Details, got ${mobileDetailState.descriptionText}.`);
    assert(mobileDetailState.description_link_count >= 1, "Expected mobile merged description text to expose a clickable Google Meet URL.");
    assert(mobileDetailState.description_link_hrefs.some(value => value.includes("meet.google.com")), `Expected mobile merged description link to target meet.google.com. Got ${JSON.stringify(mobileDetailState.description_link_hrefs)}.`);
    assert(mobileDetailState.connectedCount === 7, `Expected mobile Connected header count to show seven linked records, got ${mobileDetailState.connectedCount}.`);
    assert(mobileDetailState.visibleConnectedRowCount === 7, `Expected mobile Connected rows to stay visible while expanded, got ${mobileDetailState.visibleConnectedRowCount}.`);
    assert(!mobileDetailState.text.includes("Linked records"), "Expected mobile event detail to keep the section label as Connected.");
    const mobileWhoChipTexts = mobileDetailState.whoChipTexts;
    assert(await page.locator('.light-calendar-detail-row[data-detail-row="who"] .light-calendar-detail-guest-list').count() === 0, "Expected mobile Who row to avoid guest paragraphs.");
    assert(mobileDetailState.detailRowMetrics.when?.is_compact, `Expected mobile When row to use compact metadata layout, got ${JSON.stringify(mobileDetailState.detailRowMetrics.when)}.`);
    assert(mobileDetailState.detailRowMetrics.who?.is_compact, `Expected mobile Who row to use compact metadata layout, got ${JSON.stringify(mobileDetailState.detailRowMetrics.who)}.`);
    assert(mobileDetailState.detailRowMetrics.place?.is_compact, `Expected mobile Place row to use compact metadata layout, got ${JSON.stringify(mobileDetailState.detailRowMetrics.place)}.`);
    assert(!/\b(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\b/.test(mobileDetailState.detailRowValues.when || ""), `Expected compact When to avoid weekday text, got ${mobileDetailState.detailRowValues.when}.`);
    assert((mobileDetailState.detailRowValues.when || "").includes("June"), `Expected compact When to keep month/day text, got ${mobileDetailState.detailRowValues.when}.`);
    assert(mobileDetailState.detailRowMetrics.when?.row_top_delta_px !== null && mobileDetailState.detailRowMetrics.when.row_top_delta_px <= 4, `Expected mobile compact When row to align label and value on one line, got ${JSON.stringify(mobileDetailState.detailRowMetrics.when)}.`);
    assert(mobileDetailState.detailRowMetrics.who?.row_top_delta_px !== null && mobileDetailState.detailRowMetrics.who.row_top_delta_px <= 6, `Expected mobile compact Who row to align label and first chip on one line, got ${JSON.stringify(mobileDetailState.detailRowMetrics.who)}.`);
    assert(mobileDetailState.detailRowMetrics.place?.row_top_delta_px !== null && mobileDetailState.detailRowMetrics.place.row_top_delta_px <= 4, `Expected mobile compact Place row to align label and value on one line, got ${JSON.stringify(mobileDetailState.detailRowMetrics.place)}.`);
    assert(mobileDetailState.who_chip_gap_px >= 6, `Expected compact Who row to keep visible chip spacing, got ${mobileDetailState.who_chip_gap_px}.`);
    assert(mobileDetailState.who_contact_icon_count === mobileWhoChipTexts.length, `Expected mobile Who row to keep a visible contact icon on every attendee chip. Saw ${mobileDetailState.who_contact_icon_count} icons for ${mobileWhoChipTexts.length} chips.`);
    assert(mobileDetailState.who_guest_chip_count === 0, `Expected mobile Who row to avoid guest attendee chips, got ${mobileDetailState.who_guest_chip_count}.`);
    assert(mobileDetailState.who_record_chip_count === 0, `Expected mobile Who row to avoid record-chip styling. Saw ${mobileDetailState.who_record_chip_count} record-chip nodes.`);
    assert(mobileDetailState.details_card_overflow_x <= 1, `Expected mobile Details card to avoid horizontal overflow, got ${mobileDetailState.details_card_overflow_x}.`);
    for (const label of ["Jimmy T.", "Jeff B.", "Outside counsel"]) {
      assert(mobileWhoChipTexts.includes(label), `Expected mobile Who to include ${label}, got ${mobileWhoChipTexts.join(", ")}.`);
    }
    assert(await page.locator('.light-calendar-detail-row[data-detail-row="who"] .light-attendee-chip').count() >= mobileDetailState.whoChipTexts.length, "Expected mobile Who row to render every attendee as a chip.");
    await assertChipContrast(page, '.light-calendar-detail-row[data-detail-row="who"] .light-calendar-attendee-chip.is-link');
    await saveShot(page, reportDir, `calendar-mobile-${theme}-detail-default.png`, summary);
    await saveLocatorShot(page.locator(".light-calendar-event-detail-card").first(), reportDir, `calendar-mobile-${theme}-detail-details-card.png`, summary);
    await saveLocatorShot(page.locator('.light-calendar-detail-row[data-detail-row="who"]').first(), reportDir, `calendar-mobile-${theme}-detail-who-row.png`, summary);
    await saveLocatorShot(page.locator(".light-calendar-detail-description").first(), reportDir, `calendar-mobile-${theme}-detail-description-link.png`, summary);
    await page.locator('.light-calendar-detail-row[data-detail-row="who"] .light-attendee-chip', { hasText: "Jimmy T." }).first().click();
    await waitForContactDetailName(page, "Jimmy Torres");
    assert(await currentLightRoute(page) === "contact-detail", `Expected mobile contact-detail route after Who chip tap, got ${await currentLightRoute(page)}.`);
    await clickBackButton(page);
    assert(await currentLightRoute(page) === "meeting-detail", `Expected Back from mobile Who chip to restore meeting-detail, got ${await currentLightRoute(page)}.`);
    await waitForHeaderText(page, "Proof freelance review call");
    mobileDetailState = await readMeetingDetailState(page);
    assert(mobileDetailState.detailsExpanded, "Expected mobile Details to stay expanded after returning from a Who chip.");
    assert(mobileDetailState.connectedExpanded, "Expected mobile Connected to stay expanded after returning from a Who chip.");

    await ensureMeetingDetailSectionExpanded(page, "connected", true);
    mobileDetailState = await readMeetingDetailState(page);
    assert(mobileDetailState.connectedExpanded, "Expected mobile Connected to stay expanded after tapping its header.");
    assert(mobileDetailState.visibleConnectedRowCount === 7, `Expected mobile Connected to reveal seven flat linked rows, got ${mobileDetailState.visibleConnectedRowCount}.`);
    const mobileConnectedSection = page.locator('.light-linked-records-section[data-linked-records-title="connected"]').first();
    const mobileConnectedRows = page.locator('.light-linked-records-section[data-linked-records-title="connected"] .light-linked-record-feed-row');
    const mobileConnectedRowTexts = await allText(page, '.light-linked-records-section[data-linked-records-title="connected"] .light-linked-record-feed-row');
    const mobileConnectedLayout = await connectedSectionLayoutMetrics(page);
    assert(await page.locator('.light-linked-records-section[data-linked-records-title="connected"] .light-attendee-chip').count() === 0, "Expected mobile Connected to render feed rows instead of attendee pills.");
    assert(await page.locator('.light-linked-records-section[data-linked-records-title="connected"] .light-chevron').count() === 0, "Expected mobile Connected rows to omit trailing chevrons.");
    assert(mobileConnectedLayout.recordChipCount === 0, `Expected mobile Connected rows to omit linked-record chips, got ${JSON.stringify(mobileConnectedLayout)}.`);
    assert(mobileConnectedLayout.sectionClassName.includes("is-flat-feed") && mobileConnectedLayout.bodyClassName.includes("is-flat-feed"), `Expected mobile Connected section to render inside one shared flat-feed shell, got ${JSON.stringify(mobileConnectedLayout)}.`);
    assert(mobileConnectedLayout.flatRowCount === mobileConnectedLayout.rowCount, `Expected mobile Connected rows to all render in flat-feed mode, got ${JSON.stringify(mobileConnectedLayout)}.`);
    assert(mobileConnectedRowTexts.some(value => value.includes("Jimmy Torres")), `Expected mobile Connected rows to include linked contact Jimmy Torres, got ${mobileConnectedRowTexts.join(", ")}.`);
    assert(mobileConnectedRowTexts.some(value => value.includes("Jeff Bennett")), `Expected mobile Connected rows to include linked contact Jeff Bennett, got ${mobileConnectedRowTexts.join(", ")}.`);
    assert(!mobileConnectedRowTexts.some(value => value.includes("Outside counsel")), `Expected mobile Connected rows to keep unlinked attendee contacts out of Connected, got ${mobileConnectedRowTexts.join(", ")}.`);
    for (const label of ["Jimmy Torres", "Jeff Bennett", "Proof freelance follow-up", "Send proof review notes · Task", "Send proof review notes · Reminder", "Proof review outline", "Proof freelance prep"]) {
      const normalizedLabel = label.replace(" · Task", "").replace(" · Reminder", "");
      assert(mobileConnectedRowTexts.some(value => value.includes(normalizedLabel)), `Expected mobile Connected to include ${label}, got ${mobileConnectedRowTexts.join(", ")}.`);
    }
    assert(new Set(mobileConnectedRowTexts.map(value => value.replace(/\s+/g, " ").trim())).size === mobileConnectedRowTexts.length, `Expected Connected rows to stay curated and distinct on mobile detail. Got ${mobileConnectedRowTexts.join(" | ")}.`);
    assert(await mobileConnectedRows.count() === 7, `Expected mobile Connected to render seven linked rows, got ${await mobileConnectedRows.count()}.`);
    await saveLocatorShot(mobileConnectedSection, reportDir, `calendar-mobile-${theme}-connected.png`, summary);
    await saveShot(page, reportDir, `calendar-mobile-${theme}-detail-connected-expanded.png`, summary);

    await ensureMeetingDetailSectionExpanded(page, "details", false);
    mobileDetailState = await readMeetingDetailState(page);
    assert(!mobileDetailState.detailsExpanded, "Expected mobile Details to collapse after tapping its header.");
    assert(mobileDetailState.visibleDetailRowLabels.length === 0, `Expected mobile Details collapse to hide metadata rows, got ${mobileDetailState.visibleDetailRowLabels.join(", ")}.`);
    assert(!mobileDetailState.descriptionVisible, "Expected mobile Details collapse to hide merged description text.");
    await saveShot(page, reportDir, `calendar-mobile-${theme}-detail-details-collapsed.png`, summary);

    await ensureMeetingDetailSectionExpanded(page, "details", true);
    await ensureMeetingDetailSectionExpanded(page, "connected", true);
    await saveShot(page, reportDir, `calendar-mobile-${theme}-detail.png`, summary);
    await selectCalendarDetailTarget(page, config, "project-detail", `${seed.runId}-project`, "Proof freelance follow-up");
    await clickBackButton(page);
    assert(await currentLightRoute(page) === "meeting-detail", `Expected Back from project-detail to restore meeting-detail, got ${await currentLightRoute(page)}.`);
    await waitForHeaderText(page, "Proof freelance review call");
    mobileDetailState = await readMeetingDetailState(page);
    assert(mobileDetailState.connectedExpanded, "Expected Back from linked target to restore Connected expanded state.");
    await saveShot(page, reportDir, `calendar-mobile-${theme}-detail-connected-restored.png`, summary);
    await clickBackButton(page);
    await page.locator(".light-date-input").waitFor({ state: "visible" });
    assert(await currentLightRoute(page) === "calendar", `Expected Back from mobile event detail to restore calendar, got ${await currentLightRoute(page)}.`);
    await setCalendarDate(page, seed.tomorrow);
    await selectCalendarEventById(page, seed, "clinic", "Proof clinic paperwork check-in");
    let mobileClinicDetailState = await readMeetingDetailState(page);
    assert(mobileClinicDetailState.detailsExpanded, "Expected mobile clinic detail to keep Details expanded by default.");
    assert(mobileClinicDetailState.who_guest_chip_count === 0, `Expected clinic detail to avoid guest attendee chips, got ${mobileClinicDetailState.who_guest_chip_count}.`);
    assert(mobileClinicDetailState.who_contact_icon_count === mobileClinicDetailState.whoChipTexts.length, `Expected mobile clinic detail Who row to keep contact icons on every attendee chip. Saw ${mobileClinicDetailState.who_contact_icon_count} icons for ${mobileClinicDetailState.whoChipTexts.length} chips.`);
    assert(mobileClinicDetailState.who_record_chip_count === 0, `Expected mobile clinic detail Who row to avoid record-chip styling. Saw ${mobileClinicDetailState.who_record_chip_count} record-chip nodes.`);
    assert(mobileClinicDetailState.whoChipTexts.includes("Clinic front desk"), `Expected clinic detail to render the role-style contact as a recognized chip, got ${mobileClinicDetailState.whoChipTexts.join(", ")}.`);
    assert(mobileClinicDetailState.detailRowMetrics.who?.row_top_delta_px !== null && mobileClinicDetailState.detailRowMetrics.who.row_top_delta_px <= 6, `Expected clinic Who row to stay compact, got ${JSON.stringify(mobileClinicDetailState.detailRowMetrics.who)}.`);
    assert(mobileClinicDetailState.details_card_overflow_x <= 1, `Expected mobile clinic Details card to avoid horizontal overflow, got ${mobileClinicDetailState.details_card_overflow_x}.`);
    assert(mobileClinicDetailState.place_primary_text === "Westside Clinic", `Expected mobile clinic detail to render a primary place label. Got ${mobileClinicDetailState.place_primary_text}.`);
    assert(mobileClinicDetailState.place_address_text.includes("11714 Wilshire Blvd"), `Expected mobile clinic detail to render address text beneath the place label. Got ${mobileClinicDetailState.place_address_text}.`);
    await saveShot(page, reportDir, `calendar-mobile-${theme}-clinic-detail.png`, summary);
    await saveLocatorShot(page.locator('.light-calendar-detail-row[data-detail-row="who"]').first(), reportDir, `calendar-mobile-${theme}-clinic-who-row.png`, summary);
    await saveLocatorShot(page.locator('.light-calendar-detail-row[data-detail-row="place"]').first(), reportDir, `calendar-mobile-${theme}-clinic-place-row.png`, summary);
    await clickBackButton(page);
    await page.locator(".light-date-input").waitFor({ state: "visible" });
    assert(await currentLightRoute(page) === "calendar", `Expected Back from mobile clinic detail to restore calendar, got ${await currentLightRoute(page)}.`);
    await setCalendarDate(page, seed.today);
    await selectCalendarEventByContainer(page, seed);
    mobileDetailState = await readMeetingDetailState(page);
    assert(mobileDetailState.detailsExpanded, "Expected reopening the mobile event detail to reset Details open.");
    assert(mobileDetailState.connectedExpanded, "Expected reopening the mobile event detail to reset Connected open.");
    await saveShot(page, reportDir, `calendar-mobile-${theme}-detail-container-click.png`, summary);
    await clickBackButton(page);
    await page.locator(".light-date-input").waitFor({ state: "visible" });
    const metrics = await stickyMetrics(page);
    assert(metrics.headerShellTop <= 1, `Expected mobile header shell to stay pinned, got ${JSON.stringify(metrics)}`);
    assert(metrics.headerTop <= 1, `Expected mobile header to stay pinned, got ${metrics.headerTop}`);
    assert(metrics.chromeTop >= 0 && metrics.chromeBottom <= metrics.headerShellBottom + 2, `Expected mobile calendar chrome to remain inside the header shell, got ${JSON.stringify(metrics)}`);
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
    await selectCalendarEventById(page, seed, "late-call", "Proof late call");
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
    const lateCallConnectedSection = page.locator('.light-linked-records-section[data-linked-records-title="connected"]').first();
    await lateCallConnectedSection.waitFor({ state: "visible", timeout: config.timeoutMs });
    await ensureMeetingDetailSectionExpanded(page, "connected", true);
    const lateCallConnected = await allText(page, '.light-linked-records-section[data-linked-records-title="connected"] .light-linked-record-feed-row');
    assert(lateCallConnected.length === 1 && lateCallConnected[0].includes("Late-call follow-up"), `Expected the late-call detail to expose one linked note row, got ${lateCallConnected.join(", ")}.`);
    await selectConnectedRow(page, "Late-call follow-up");
    await waitForHeaderText(page, "Late-call follow-up");
    assert(await currentLightRoute(page) === "note-detail", `Expected late-call chip tap to open note-detail, got ${await currentLightRoute(page)}.`);
    await clickBackButton(page);
    assert(await currentLightRoute(page) === "meeting-detail", `Expected Back from late-call linked note to restore meeting-detail, got ${await currentLightRoute(page)}.`);
    await waitForHeaderText(page, "Proof late call");
    await saveShot(page, reportDir, `calendar-mobile-${theme}-late-call-detail.png`, summary);
    await clickBackButton(page);
    assert(await currentLightRoute(page) === "calendar", `Expected Back from late-call detail to restore calendar, got ${await currentLightRoute(page)}.`);
    await selectCalendarEventById(page, seed, "katy-handoff", "Proof Katy pickup handoff");
    const mobileEmptyConnected = page.locator('.light-linked-records-section[data-linked-records-title="connected"]').first();
    assert(await mobileEmptyConnected.count() === 0, "Expected the mobile sparse event to omit Connected entirely when there are no linked records.");
    await saveShot(page, reportDir, `calendar-mobile-${theme}-connected-empty.png`, summary);
    summary.assertions.push(`mobile ${theme} sticky header, meeting-detail section toggles, and empty Connected shells stayed readable`);
  } finally {
    const tracePath = path.join(reportDir, `trace-mobile-${theme}.zip`);
    await context.tracing.stop({ path: tracePath });
    await context.close();
    const videoPath = video ? await video.path().catch(() => "") : "";
    summary.artifacts = summary.artifacts || {};
    summary.artifacts[laneKey] = {
      trace_path: tracePath,
      video_path: videoPath,
    };
  }
}

async function readManifest(config) {
  let lastError = null;
  for (let attempt = 1; attempt <= MANIFEST_FETCH_ATTEMPTS; attempt += 1) {
    try {
      const manifestUrl = new URL("/ui/pucky/latest/manifest.json", config.baseUrl);
      const refreshValue = new URL(config.baseUrl).searchParams.get("_pucky_refresh");
      if (refreshValue) {
        manifestUrl.searchParams.set("_pucky_refresh", String(refreshValue));
      }
      manifestUrl.searchParams.set("cb", String(Date.now()));
      const response = await fetch(manifestUrl, {
        headers: { Accept: "application/json" }
      });
      if (!response.ok) {
        throw new Error(`Manifest fetch failed (${response.status})`);
      }
      const payload = await response.json();
      if (payload && typeof payload === "object") {
        payload._proof_fetch_attempt = attempt;
      }
      return payload;
    } catch (error) {
      lastError = error;
      if (attempt >= MANIFEST_FETCH_ATTEMPTS) {
        break;
      }
      await delay(MANIFEST_FETCH_RETRY_MS * attempt);
    }
  }
  throw lastError || new Error(`Manifest fetch failed after ${MANIFEST_FETCH_ATTEMPTS} attempts.`);
}

async function launchProofBrowser(config) {
  const browserName = String(config.browserName || "chromium").trim().toLowerCase();
  if (browserName === "webkit") {
    return webkit.launch({ headless: true });
  }
  return chromium.launch({
    executablePath: resolveChromePath(),
    headless: true
  });
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
    browser_name: config.browserName,
    report_dir: config.reportDir,
    started_at: new Date().toISOString(),
    screenshots: {},
    assertions: []
  };

  let browser;
  let seed;
  try {
    summary.manifest = await readManifest(config);
    summary.manifest_fetch_attempts = Number(summary.manifest?._proof_fetch_attempt || 0) || 1;
    seed = await seedCalendar(config, `${PROOF_RUN_ID}-${Date.now()}`);
    summary.seed = seed;
    browser = await launchProofBrowser(config);
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
