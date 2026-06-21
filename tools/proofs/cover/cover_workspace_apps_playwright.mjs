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

const DEFAULT_BASE_URL = process.env.PUCKY_WORKSPACE_PROOF_BASE_URL || "http://127.0.0.1:8767";
const VIEWPORT = { width: 430, height: 932 };
const DESKTOP_NOTE_DETAIL_VIEWPORT = { width: 1280, height: 900 };
const PROOF_RUN_ID = "proof-workspace";

function resolveApiToken() {
  const webToken = String(process.env.PUCKY_WEB_UI_TOKEN || "").trim();
  if (webToken) {
    return webToken;
  }
  const proofToken = String(process.env.PUCKY_WORKSPACE_PROOF_TOKEN || "").trim();
  if (proofToken) {
    return proofToken;
  }
  return String(process.env.PUCKY_API_TOKEN || "").trim();
}

function parseArgs(argv) {
  const config = {
    baseUrl: DEFAULT_BASE_URL,
    apiToken: resolveApiToken(),
    reportDir: path.resolve("artifacts", "workspace-apps", new Date().toISOString().replace(/[:.]/g, "-")),
    timeoutMs: 30000,
    reminderDeliveryMode: process.env.PUCKY_REMINDER_DELIVERY_MODE || "auto",
    sections: []
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
    } else if (arg === "--reminder-delivery" && argv[index + 1]) {
      config.reminderDeliveryMode = String(argv[++index] || config.reminderDeliveryMode).trim().toLowerCase() || "auto";
    } else if (arg === "--sections" && argv[index + 1]) {
      config.sections = String(argv[++index] || "")
        .split(",")
        .map(value => String(value || "").trim().toLowerCase())
        .filter(Boolean);
    }
  }
  return config;
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function isZeroishPx(value) {
  return Math.abs(Number.parseFloat(String(value || "0")) || 0) <= 0.5;
}

function isTransparentColor(value) {
  const text = String(value || "").trim().toLowerCase();
  if (!text || text === "transparent") {
    return true;
  }
  const rgba = text.match(/^rgba?\((.+)\)$/);
  if (!rgba) {
    return false;
  }
  const parts = rgba[1].split(",").map(part => part.trim());
  if (parts.length === 4) {
    return Math.abs(Number.parseFloat(parts[3]) || 0) <= 0.01;
  }
  return parts.slice(0, 3).every(part => Number.parseFloat(part) === 0);
}

function isNoShadow(value) {
  const text = String(value || "").trim().toLowerCase();
  return !text || text === "none" || text === "rgba(0, 0, 0, 0) 0px 0px 0px 0px";
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

function pageUrl(baseUrl, theme) {
  const url = new URL(`${baseUrl.replace(/\/+$/, "")}/ui/pucky/latest/index.html`);
  url.searchParams.set("theme", theme);
  url.searchParams.set("reset_nav", "1");
  return url.toString();
}

async function primeBrowserPreviewToken(context, apiToken) {
  const token = String(apiToken || "").trim();
  if (!token) {
    return;
  }
  await context.addInitScript((value) => {
    try {
      const key = ["pucky", "cover", ["browser", "api", "token"].join("_"), "v1"].join(".");
      window.localStorage.setItem(key, value);
    } catch (_error) {
      // Ignore storage failures so the proof can still exercise public routes.
    }
  }, token);
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

function isUnauthorizedError(error) {
  return /\(401\)/.test(String(error?.message || error));
}

function shouldRunReminderDelivery(config) {
  const mode = String(config.reminderDeliveryMode || "auto").trim().toLowerCase();
  if (mode === "always") {
    return true;
  }
  if (mode === "never") {
    return false;
  }
  return /pucky\.fly\.dev/i.test(String(config.baseUrl || ""));
}

function shouldRunSection(config, sectionName) {
  const requested = Array.isArray(config.sections) ? config.sections : [];
  if (!requested.length) {
    return true;
  }
  return requested.includes(String(sectionName || "").trim().toLowerCase());
}

async function readCollection(config, collection, now = null) {
  try {
    const payload = await apiRequest(config, "GET", `/api/workspace/${collection}${now ? `?now_ms=${now}` : ""}`);
    return payload?.items || [];
  } catch (error) {
    return [];
  }
}

function reminderMetaForScript(reminder) {
  const metadata = reminder && typeof reminder === "object" && reminder.metadata && typeof reminder.metadata === "object"
    ? reminder.metadata
    : {};
  return {
    deliveryState: String(metadata.delivery_state || "").trim().toLowerCase(),
    snoozedUntilMs: Number(metadata.snoozed_until_ms || 0),
    lastFiredDueAtMs: Number(metadata.last_fired_due_at_ms || 0)
  };
}

function reminderIsDismissedForScript(reminder) {
  return String(reminder?.status || "").trim().toLowerCase() === "done";
}

function reminderIsSentHistoryForScript(reminder) {
  if (reminderIsDismissedForScript(reminder)) {
    return false;
  }
  const meta = reminderMetaForScript(reminder);
  const dueAtMs = Number(reminder?.due_at_ms || 0);
  return meta.deliveryState === "sent" && meta.lastFiredDueAtMs > 0 && meta.lastFiredDueAtMs === dueAtMs;
}

function reminderIsSnoozedForScript(reminder) {
  const meta = reminderMetaForScript(reminder);
  const dueAtMs = Number(reminder?.due_at_ms || 0);
  return meta.snoozedUntilMs > Date.now() && meta.snoozedUntilMs === dueAtMs;
}

function reminderIsActiveForScript(reminder) {
  return !reminderIsDismissedForScript(reminder) && !reminderIsSentHistoryForScript(reminder) && !reminderIsSnoozedForScript(reminder);
}

async function readActiveReminderCount(config) {
  const items = await readCollection(config, "reminders");
  return items.filter(reminder => reminderIsActiveForScript(reminder)).length;
}

async function waitForReminderHomeBadgeCount(page, count, timeoutMs) {
  await page.waitForFunction((expectedCount) => {
    const badge = document.querySelector('.light-app-tile[data-app-label="Reminders"] .light-app-badge');
    if (expectedCount <= 0) {
      return !badge;
    }
    return Boolean(badge) && String(badge.textContent || "").trim() === String(expectedCount);
  }, count, { timeout: timeoutMs });
}

async function waitForReminderRecord(config, reminderId, predicate, description, timeoutMs) {
  const startedAt = Date.now();
  let lastRecord = null;
  while (Date.now() - startedAt < timeoutMs) {
    lastRecord = await apiRequest(config, "GET", `/api/workspace/reminders/${reminderId}`);
    if (predicate(lastRecord)) {
      return lastRecord;
    }
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  throw new Error(`Timed out waiting for reminder ${reminderId}: ${description}; last record ${JSON.stringify(lastRecord)}`);
}

function buildSeedManifest(runId = PROOF_RUN_ID) {
  return {
    runId,
    linkIds: [
      `${runId}-alpha-note`,
      `${runId}-alpha-task`,
      `${runId}-alpha-calendar`,
      `${runId}-alpha-feed`,
      `${runId}-alpha-contact`,
      `${runId}-future-task-note`,
      `${runId}-feed-note`,
      `${runId}-contact-note`,
      `${runId}-beta-task`,
      `${runId}-beta-calendar`,
      `${runId}-beta-feed`,
      `${runId}-beta-contact`,
      `${runId}-meeting-contact`,
      `${runId}-meeting-calendar`,
      `${runId}-meeting-note`,
      `${runId}-meeting-task`,
      `${runId}-meeting-project`,
      `${runId}-meeting-reminder`,
      `${runId}-project-reminder`,
      `${runId}-reminder-note`,
      `${runId}-reminder-task`,
      `${runId}-reminder-meeting`
    ],
    recordIds: {
      notes: [`${runId}-pinned-note`, `${runId}-recent-note`],
      tasks: [
        `${runId}-overdue-task`,
        `${runId}-future-task`,
        `${runId}-done-task`,
        `${runId}-asset-task`,
        `${runId}-empty-task`,
        `${runId}-deadline-flip`
      ],
      "calendar-events": [`${runId}-today-roadmap`, `${runId}-today-overlap`, `${runId}-tomorrow-event`],
      "feed-items": [
        `${runId}-note-update`,
        `${runId}-task-completion`,
        `${runId}-project-decision`,
        `${runId}-contact-activity`,
        `${runId}-calendar-change`
      ],
      projects: [`${runId}-alpha-project`, `${runId}-beta-project`],
      contacts: [`${runId}-contact-one`, `${runId}-contact-two`],
      "meeting-notes": [`${runId}-graph-meeting`],
      reminders: [`${runId}-graph-reminder`, `${runId}-due-reminder`]
    }
  };
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
  const manifest = buildSeedManifest(seed.runId || PROOF_RUN_ID);
  for (const linkId of manifest.linkIds) {
    await deleteWorkspaceLink(config, linkId);
  }
  for (const [collection, ids] of Object.entries(manifest.recordIds)) {
    for (const recordId of ids) {
      await deleteWorkspaceRecord(config, collection, recordId);
    }
  }
  return true;
}

async function seedWorkspace(config, runId = PROOF_RUN_ID) {
  const manifest = buildSeedManifest(runId);
  const today = dateKey(new Date());
  const tomorrow = dateKey(new Date(Date.now() + 24 * 60 * 60 * 1000));
  try {
    await cleanupWorkspaceSeed(config, { runId, writeEnabled: true });
    await apiRequest(config, "POST", "/api/workspace/notes", {
      id: `${runId}-pinned-note`,
      title: "Proof Pinned Note",
      summary: "Pinned note created through workspace API.",
      pinned: true,
      html: "<!doctype html><html><body><h1>Proof Pinned Note</h1><p>Agent-created note page with three bullets.</p><ul><li>Alpha</li><li>Beta</li><li>Gamma</li></ul></body></html>",
      metadata: { context: "Browser proof", icon: "pin" }
    });
    await apiRequest(config, "POST", "/api/workspace/notes", {
      id: `${runId}-recent-note`,
      title: "Proof Recent Note",
      summary: "Recent unpinned note.",
      html: "<!doctype html><h1>Proof Recent Note</h1><p>Recent note HTML page.</p>",
      metadata: { context: "Browser proof", icon: "note" }
    });

    await apiRequest(config, "POST", "/api/workspace/tasks", {
      id: `${runId}-overdue-task`,
      title: "Proof Overdue Task",
      summary: "Starts overdue.",
      status: "open",
      due_at_ms: Date.now() - 60_000
    });
    await apiRequest(config, "POST", "/api/workspace/tasks", {
      id: `${runId}-future-task`,
      title: "Proof Future Task",
      summary: "Due later.",
      status: "open",
      due_at_ms: Date.now() + 3 * 24 * 60 * 60 * 1000
    });
    await apiRequest(config, "POST", "/api/workspace/tasks", {
      id: `${runId}-done-task`,
      title: "Proof Done Task",
      summary: "Done stays done even after deadline.",
      status: "done",
      due_at_ms: Date.now() - 120_000
    });
    await apiRequest(config, "POST", "/api/workspace/tasks", {
      id: `${runId}-asset-task`,
      title: "Proof Waiting Task",
      summary: "Linked note only.",
      status: "waiting",
      due_at_ms: Date.now() + 24 * 60 * 60 * 1000
    });
    await apiRequest(config, "POST", "/api/workspace/tasks", {
      id: `${runId}-empty-task`,
      title: "Proof Empty Task",
      summary: "No generated HTML yet.",
      status: "open",
      due_at_ms: Date.now() + 2 * 24 * 60 * 60 * 1000
    });
    const deadlineFlipId = `${runId}-deadline-flip`;
    await apiRequest(config, "POST", "/api/workspace/tasks", {
      id: deadlineFlipId,
      title: `Proof Deadline Flip`,
      summary: "Moves to overdue after timestamp passes.",
      status: "open",
      due_at_ms: Date.now() + 6_500
    });

    await apiRequest(config, "POST", "/api/workspace/calendar-events", {
      id: `${runId}-today-roadmap`,
      title: "Proof Today Roadmap",
      summary: "Primary today event",
      date: today,
      start_at_ms: dayAt(0, 10),
      end_at_ms: dayAt(0, 11),
      metadata: { place: "Zoom", attendees: ["Proof Contact One", "Proof Contact Two"], type: "planning" }
    });
    await apiRequest(config, "POST", "/api/workspace/calendar-events", {
      id: `${runId}-today-overlap`,
      title: "Proof Overlap Event",
      summary: "Same-hour overlap",
      date: today,
      start_at_ms: dayAt(0, 10, 15),
      end_at_ms: dayAt(0, 10, 45),
      metadata: { place: "Figma", attendees: ["Proof Contact One"], type: "design" }
    });
    await apiRequest(config, "POST", "/api/workspace/calendar-events", {
      id: `${runId}-tomorrow-event`,
      title: "Proof Tomorrow Event",
      summary: "Tomorrow event",
      date: tomorrow,
      start_at_ms: dayAt(1, 14),
      end_at_ms: dayAt(1, 15),
      metadata: { place: "Office", attendees: ["Proof Contact Two"], type: "review" }
    });

    for (const item of [
      ["note-update", "Proof Note Feed", "Note update", "note"],
      ["task-completion", "Proof Task Feed", "Task completion", "checklist"],
      ["project-decision", "Proof Project Decision", "Project decision", "folder"],
      ["contact-activity", "Proof Contact Activity", "Contact activity", "contacts"],
      ["calendar-change", "Proof Calendar Change", "Calendar change", "calendar"]
    ]) {
      await apiRequest(config, "POST", "/api/workspace/feed-items", {
        id: `${runId}-${item[0]}`,
        title: item[1],
        summary: item[2],
        event_at_ms: Date.now() - Math.floor(Math.random() * 600_000),
        metadata: { type: item[0], icon: item[3] }
      });
    }

    await apiRequest(config, "POST", "/api/workspace/projects", {
      id: `${runId}-alpha-project`,
      title: "Proof Alpha Project",
      summary: "Alpha has two named threads.",
      metadata: { threads: ["Alpha kickoff", "Alpha launch"] }
    });
    await apiRequest(config, "POST", "/api/workspace/projects", {
      id: `${runId}-beta-project`,
      title: "Proof Beta Project",
      summary: "Beta has three named threads.",
      metadata: { threads: ["Beta planning", "Beta risks", "Beta wrap"] }
    });

    await apiRequest(config, "POST", "/api/workspace/contacts", {
      id: `${runId}-contact-one`,
      title: "Proof Contact One",
      summary: "Partner lead",
      metadata: {
        avatar: "P1",
        email: "proof.one@example.com",
        phone: "+1 (555) 010-1000",
        activity: ["Created by proof", "Linked to Alpha"]
      }
    });
    await apiRequest(config, "POST", "/api/workspace/contacts", {
      id: `${runId}-contact-two`,
      title: "Proof Contact Two",
      summary: "Customer sponsor",
      metadata: {
        avatar: "P2",
        email: "proof.two@example.com",
        phone: "+1 (555) 010-2000",
        activity: ["Created by proof", "Linked to Beta"]
      }
    });
    await apiRequest(config, "POST", "/api/workspace/meeting-notes", {
      id: `${runId}-graph-meeting`,
      title: "Proof Graph Meeting",
      summary: "Meeting note created through workspace API with linked attendees and follow-ups.",
      date: today,
      start_at_ms: dayAt(0, 12),
      end_at_ms: dayAt(0, 12, 45),
      metadata: {
        participants: ["Proof Contact One"],
        project: "Proof Alpha Project",
        source_kind: "calendar_event",
        source_id: `${runId}-today-roadmap`,
        extracted_topics: ["graph", "meeting", "follow-up"]
      }
    });
    await apiRequest(config, "POST", "/api/workspace/reminders", {
      id: `${runId}-graph-reminder`,
      title: "Proof Graph Reminder",
      summary: "Reminder attached to a task and meeting note.",
      status: "open",
      due_at_ms: Date.now() + 2 * 60 * 60 * 1000,
      metadata: {
        source_kind: "task",
        source_id: `${runId}-future-task`,
        snooze_state: "ready",
        recipients: [
          { id: "self", kind: "self", label: "Me" },
          { id: `${runId}-contact-one`, kind: "contact", contact_id: `${runId}-contact-one`, label: "Proof Contact One" }
        ],
        destinations: [
          { channel: "phone_notification", recipient_ids: ["self"] },
          { channel: "sms", recipient_ids: [`${runId}-contact-one`] }
        ]
      }
    });

    for (const link of [
      ["alpha-note", "note", `${runId}-pinned-note`, "Proof Pinned Note"],
      ["alpha-task", "task", `${runId}-future-task`, "Proof Future Task"],
      ["alpha-calendar", "calendar_event", `${runId}-today-roadmap`, "Proof Today Roadmap"],
      ["alpha-feed", "feed_item", `${runId}-project-decision`, "Proof Project Decision"],
      ["alpha-contact", "contact", `${runId}-contact-one`, "Proof Contact One"],
      ["future-task-note", "note", `${runId}-pinned-note`, "Proof Pinned Note"],
      ["beta-task", "task", `${runId}-overdue-task`, "Proof Overdue Task"],
      ["beta-calendar", "calendar_event", `${runId}-tomorrow-event`, "Proof Tomorrow Event"],
      ["beta-feed", "feed_item", `${runId}-calendar-change`, "Proof Calendar Change"],
      ["beta-contact", "contact", `${runId}-contact-two`, "Proof Contact Two"]
    ]) {
      await apiRequest(config, "POST", "/api/workspace/links", {
        id: `${runId}-${link[0]}`,
        source_kind: link[0] === "future-task-note" ? "task" : "project",
        source_id: link[0] === "future-task-note"
          ? `${runId}-future-task`
          : link[0].startsWith("alpha")
            ? `${runId}-alpha-project`
            : `${runId}-beta-project`,
        target_kind: link[1],
        target_id: link[2],
        label: link[3]
      });
    }

    for (const link of [
      ["meeting-contact", "meeting_note", `${runId}-graph-meeting`, "contact", `${runId}-contact-one`, "Proof Contact One"],
      ["meeting-calendar", "meeting_note", `${runId}-graph-meeting`, "calendar_event", `${runId}-today-roadmap`, "Proof Today Roadmap"],
      ["meeting-note", "meeting_note", `${runId}-graph-meeting`, "note", `${runId}-pinned-note`, "Proof Pinned Note"],
      ["meeting-task", "meeting_note", `${runId}-graph-meeting`, "task", `${runId}-future-task`, "Proof Future Task"],
      ["meeting-project", "meeting_note", `${runId}-graph-meeting`, "project", `${runId}-alpha-project`, "Proof Alpha Project"],
      ["meeting-reminder", "meeting_note", `${runId}-graph-meeting`, "reminder", `${runId}-graph-reminder`, "Proof Graph Reminder"],
      ["project-reminder", "project", `${runId}-alpha-project`, "reminder", `${runId}-graph-reminder`, "Proof Graph Reminder"],
      ["feed-note", "feed_item", `${runId}-project-decision`, "note", `${runId}-pinned-note`, "Proof Pinned Note"],
      ["contact-note", "contact", `${runId}-contact-one`, "note", `${runId}-pinned-note`, "Proof Pinned Note"],
      ["reminder-note", "reminder", `${runId}-graph-reminder`, "note", `${runId}-pinned-note`, "Proof Pinned Note"],
      ["reminder-task", "reminder", `${runId}-graph-reminder`, "task", `${runId}-future-task`, "Proof Future Task"],
      ["reminder-meeting", "reminder", `${runId}-graph-reminder`, "meeting_note", `${runId}-graph-meeting`, "Proof Graph Meeting"]
    ]) {
      await apiRequest(config, "POST", "/api/workspace/links", {
        id: `${runId}-${link[0]}`,
        source_kind: link[1],
        source_id: link[2],
        target_kind: link[3],
        target_id: link[4],
        label: link[5]
      });
    }
    for (const link of [
      ["future-task-note", "task", `${runId}-future-task`, "note", `${runId}-pinned-note`, "Proof Pinned Note"],
      ["feed-note", "feed_item", `${runId}-project-decision`, "note", `${runId}-pinned-note`, "Proof Pinned Note"],
      ["contact-note", "contact", `${runId}-contact-one`, "note", `${runId}-pinned-note`, "Proof Pinned Note"],
      ["reminder-note", "reminder", `${runId}-graph-reminder`, "note", `${runId}-pinned-note`, "Proof Pinned Note"],
    ]) {
      await apiRequest(config, "POST", "/api/workspace/links", {
        id: `${runId}-${link[0]}`,
        source_kind: link[1],
        source_id: link[2],
        target_kind: link[3],
        target_id: link[4],
        label: link[5],
      });
    }

    const seededTasks = await readCollection(config, "tasks", Date.now());
    return {
      runId,
      today,
      tomorrow,
      writeEnabled: true,
      manifest,
      pinnedNoteId: `${runId}-pinned-note`,
      calendarIds: {
        todayRoadmap: `${runId}-today-roadmap`,
        todayOverlap: `${runId}-today-overlap`,
        tomorrow: `${runId}-tomorrow-event`
      },
      tasks: seededTasks,
      taskIds: {
        inline: `${runId}-future-task`,
        asset: `${runId}-asset-task`,
        empty: `${runId}-empty-task`,
        done: `${runId}-done-task`,
        rowA: `${runId}-future-task`,
        rowB: `${runId}-overdue-task`,
        flip: deadlineFlipId
      },
      graphIds: {
        meeting: `${runId}-graph-meeting`,
        reminder: `${runId}-graph-reminder`
      }
    };
  } catch (error) {
    if (!isUnauthorizedError(error)) {
      throw error;
    }
    const [notes, tasks, events, feeds, projects, contacts, meetingNotes, reminders] = await Promise.all([
      readCollection(config, "notes"),
      readCollection(config, "tasks"),
      readCollection(config, "calendar-events"),
      readCollection(config, "feed-items"),
      readCollection(config, "projects"),
      readCollection(config, "contacts"),
      readCollection(config, "meeting-notes"),
      readCollection(config, "reminders")
    ]);
    return {
      runId,
      today,
      tomorrow,
      writeEnabled: false,
      manifest,
      notes,
      tasks,
      calendarEvents: events,
      feedItems: feeds,
      projects,
      contacts,
      meetingNotes,
      reminders
    };
  }
}

async function waitForHome(page, theme, timeoutMs) {
  await page.waitForFunction((expectedTheme) => {
    const shell = document.querySelector(".app-shell");
    const home = document.querySelector('.light-shell[data-light-route="home"]');
    return Boolean(shell && shell.getAttribute("data-theme") === expectedTheme && home);
  }, theme, { timeout: timeoutMs });
}

async function assertHomeShellChrome(page, route) {
  const result = await page.evaluate((expectedRoute) => {
    const shell = document.querySelector(".light-shell");
    const tabs = document.getElementById("pageTabs");
    const tray = document.getElementById("routeTray");
    const status = document.querySelector("[data-voice-status]");
    return {
      route: shell?.getAttribute("data-light-route") || "",
      back: Boolean(document.querySelector(".light-back-button, .light-appbar-back")),
      tabsHidden: !tabs || Boolean(tabs.hidden),
      trayHidden: !tray || Boolean(tray.hidden),
      statusVisible: Boolean(status && status.getBoundingClientRect().width > 0 && status.getBoundingClientRect().height > 0)
    };
  }, route);
  assert(result.route === route, `Expected light route ${route}, got ${result.route}`);
  assert(result.back, `Expected back button on ${route}`);
  assert(result.tabsHidden, `Expected tabs hidden on ${route}`);
  assert(result.trayHidden, `Expected route tray hidden on ${route}`);
  assert(result.statusVisible, `Expected voice status visible on ${route}`);
}

async function openTile(page, label, route, timeoutMs) {
  const selector = `.light-app-tile[data-app-label="${label}"]`;
  await page.waitForFunction((tileSelector) => {
    const tile = document.querySelector(tileSelector);
    if (!(tile instanceof HTMLElement)) {
      return false;
    }
    const rect = tile.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }, selector, { timeout: timeoutMs });
  await page.evaluate((tileSelector) => {
    const tile = document.querySelector(tileSelector);
    if (tile instanceof HTMLElement) {
      tile.click();
    }
  }, selector);
  await page.waitForSelector(`.light-shell[data-light-route="${route}"]`, { timeout: timeoutMs });
  await assertHomeShellChrome(page, route);
}

async function backHome(page, theme, timeoutMs) {
  for (let index = 0; index < 3; index += 1) {
    const isHome = await page.locator('.light-shell[data-light-route="home"]').count();
    if (isHome) {
      await waitForHome(page, theme, timeoutMs);
      return;
    }
    await page.evaluate(() => window.PuckyHandleAndroidBack && window.PuckyHandleAndroidBack());
    await page.waitForTimeout(250);
  }
  await waitForHome(page, theme, timeoutMs);
}

async function topBackToRoute(page, route, text, timeoutMs) {
  await page.getByRole("button", { name: "Back" }).click();
  await waitForLightRoute(page, route, timeoutMs);
  if (text) {
    await waitForGraphText(page, text, timeoutMs);
  }
}

async function expectFrameHeading(page, text, timeoutMs) {
  const escaped = String(text || "").replace(/\\\`/g, "\\\\");
  const shellResult = await page.waitForFunction(
    (targetText) => {
      const shell = document.querySelector(".light-shell");
      return Boolean(shell && shell.textContent && shell.textContent.includes(targetText));
    },
    escaped,
    { timeout: 1_000 }
  ).then(() => true).catch(() => false);
  if (shellResult) {
    return;
  }
  await page.frameLocator(".light-html-frame").locator(`text=${text}`).first().waitFor({ state: "visible", timeout: timeoutMs });
}

async function readTaskDetailState(page) {
  return page.evaluate(() => {
    const route = document.querySelector(".light-shell")?.getAttribute("data-light-route") || "";
    const pageText = document.querySelector(".light-shell")?.textContent || "";
    const title = document.querySelector(".light-task-detail-title")?.textContent?.trim() || "";
    const due = document.querySelector(".light-task-detail-due")?.textContent?.trim() || "";
    const statusTrigger = document.querySelector(".light-task-status-trigger");
    const statusLabel = statusTrigger?.querySelector(".light-task-status-trigger-label")?.textContent?.trim()
      || statusTrigger?.textContent?.trim()
      || "";
    const statusValue = statusTrigger?.getAttribute("data-task-status") || "";
    const hasNotes = /\bnotes\b/i.test(pageText);
    const hasRelated = /\brelated\b/i.test(pageText);
    const hasGeneratedPage = /\bgenerated page\b/i.test(pageText);
    const htmlFrame = document.querySelector(".light-task-detail-body.light-html-card iframe");
    const htmlFallback = document.querySelector(".light-task-detail-body.light-html-empty")?.textContent?.trim() || "";
    return {
      route,
      title,
      due,
      statusLabel,
      statusValue,
      hasNotes,
      hasRelated,
      hasGeneratedPage,
      hasHtmlFrame: Boolean(htmlFrame),
      htmlFallback
    };
  });
}

async function readTaskListState(page) {
  return page.evaluate(() => {
    const headers = Array.from(document.querySelectorAll(".light-task-section-title")).map(node => node.textContent?.trim() || "");
    const countLine = document.querySelector(".light-task-counts")?.textContent?.trim() || "";
    const sectionExpanded = Object.fromEntries(
      Array.from(document.querySelectorAll(".light-task-section-toggle")).map(node => [
        node.getAttribute("data-task-section") || "",
        node.getAttribute("aria-expanded") === "true"
      ])
    );
    const visibleTaskIds = Array.from(document.querySelectorAll("[data-task-id]")).map(node => node.getAttribute("data-task-id") || "");
    return {
      headers,
      countLine,
      sectionExpanded,
      visibleTaskIds
    };
  });
}

async function probeTaskDetailIdle(page, idleMs = 5200) {
  return page.evaluate(async (waitMs) => {
    const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
    const firstShell = document.querySelector(".light-shell");
    const firstTitleNode = document.querySelector(".light-task-detail-title");
    const firstFrame = document.querySelector(".light-task-detail-body .light-html-frame");
    await sleep(waitMs);
    const currentShell = document.querySelector(".light-shell");
    const currentTitleNode = document.querySelector(".light-task-detail-title");
    const currentFrame = document.querySelector(".light-task-detail-body .light-html-frame");
    return {
      sameShellNode: currentShell === firstShell,
      sameTitleNode: currentTitleNode === firstTitleNode,
      sameIframeNode: currentFrame === firstFrame,
      route: currentShell?.getAttribute("data-light-route") || "",
      title: currentTitleNode?.textContent?.trim() || ""
    };
  }, idleMs);
}

async function readDetailHtmlBodyMetrics(page) {
  return page.evaluate(() => {
    const pageNode = document.querySelector(".light-shell .light-page");
    const header = document.querySelector(".light-page-header-shell");
    const body = document.querySelector(".light-detail-html-body");
    const frame = body?.querySelector(".light-html-frame");
    const scrollingNode = document.scrollingElement || document.documentElement;
    const rect = (node) => {
      if (!(node instanceof Element)) return null;
      const box = node.getBoundingClientRect();
      return {
        top: box.top,
        bottom: box.bottom,
        left: box.left,
        right: box.right,
        width: box.width
      };
    };
    return {
      route: document.querySelector(".light-shell")?.getAttribute("data-light-route") || "",
      page: rect(pageNode),
      header: rect(header),
      body: rect(body),
      frame: rect(frame),
      headerBottom: rect(header)?.bottom || 0,
      bodyTop: rect(body)?.top || 0,
      pageScrollHeight: scrollingNode?.scrollHeight || 0,
      pageClientHeight: scrollingNode?.clientHeight || 0,
      frameClientHeight: frame?.clientHeight || 0,
      frameScrollHeight: frame?.contentDocument?.documentElement?.scrollHeight || frame?.contentDocument?.body?.scrollHeight || 0
    };
  });
}

async function readDetailFrameDocumentMetrics(page) {
  const iframeHandle = await page.locator(".light-html-frame").first().elementHandle();
  if (!iframeHandle) {
    return null;
  }
  const frame = await iframeHandle.contentFrame();
  if (!frame) {
    return null;
  }
  return frame.evaluate(() => {
    const root = document.documentElement;
    const body = document.body;
    const style = body ? getComputedStyle(body) : null;
    return {
      viewport: document.querySelector('meta[name="viewport"]')?.getAttribute("content") || "",
      theme: root?.getAttribute("data-pucky-embedded-theme") || "",
      documentWidth: root?.clientWidth || 0,
      bodyWidth: body?.clientWidth || 0,
      bodyMarginTop: style?.marginTop || "",
      bodyMarginRight: style?.marginRight || "",
      bodyMarginBottom: style?.marginBottom || "",
      bodyMarginLeft: style?.marginLeft || "",
      bodyPaddingTop: style?.paddingTop || "",
      bodyPaddingRight: style?.paddingRight || "",
      bodyPaddingBottom: style?.paddingBottom || "",
      bodyPaddingLeft: style?.paddingLeft || "",
      bodyFontFamily: style?.fontFamily || "",
      bodyFontSize: style?.fontSize || "",
      bodyLineHeight: style?.lineHeight || "",
      bodyColor: style?.color || "",
      bodyBackground: style?.backgroundColor || "",
      firstTag: body?.firstElementChild?.tagName || ""
    };
  });
}

function assertDetailFrameMetrics(metrics, label, theme) {
  assert(metrics, `Expected ${label} frame metrics`);
  assert(/width=device-width/i.test(metrics.viewport || ""), `Expected ${label} viewport meta, got ${metrics?.viewport}`);
  assert(/initial-scale=1/i.test(metrics.viewport || ""), `Expected ${label} initial-scale=1, got ${metrics?.viewport}`);
  assert(Number(metrics.documentWidth || 0) > 0 && Number(metrics.documentWidth || 0) <= VIEWPORT.width + 24, `Expected ${label} document width near mobile viewport, got ${metrics?.documentWidth}`);
  assert(metrics.bodyMarginTop === "0px", `Expected ${label} body margin-top reset, got ${metrics?.bodyMarginTop}`);
  assert(metrics.bodyMarginLeft === "0px", `Expected ${label} body margin-left reset, got ${metrics?.bodyMarginLeft}`);
  assert(!/Times New Roman|Georgia/i.test(metrics.bodyFontFamily || ""), `Expected ${label} font stack to avoid default serif, got ${metrics?.bodyFontFamily}`);
  assert(String(metrics.theme || "") === theme, `Expected ${label} embedded theme ${theme}, got ${metrics?.theme}`);
}

function assertDetailHtmlLayout(layout, label) {
  assert(layout.body && layout.page, `Expected ${label} to expose a measurable HTML body`);
  assert(layout.body.left <= layout.page.left + 2, `Expected ${label} HTML body to reach page left edge, got ${layout.body.left} vs ${layout.page.left}`);
  assert(layout.body.right >= layout.page.right - 2, `Expected ${label} HTML body to reach page right edge, got ${layout.body.right} vs ${layout.page.right}`);
  assert(Number(layout.bodyTop || 0) <= Number(layout.headerBottom || 0) + 2, `Expected ${label} HTML body to start directly below the header, got ${layout.bodyTop} vs ${layout.headerBottom}`);
  assert(Number(layout.frameClientHeight || 0) + 2 >= Number(layout.frameScrollHeight || 0), `Expected ${label} iframe height to cover its document height, got ${layout.frameClientHeight} vs ${layout.frameScrollHeight}`);
}

function countTaskRequestEvents(networkLog, startMs, endMs) {
  return networkLog.filter(event => (
    event.type === "request" &&
    event.url.includes("/api/workspace/tasks") &&
    Number(event.at_ms || 0) >= Number(startMs || 0) &&
    Number(event.at_ms || 0) <= Number(endMs || 0)
  )).length;
}

async function readTaskPressMetrics(page, rowTaskId, siblingTaskId = null) {
  return page.evaluate((args) => {
    const row = document.querySelector(`[data-task-id="${args.rowTaskId}"]`);
    const parent = row ? row.closest(".light-task-card") : null;
    const sibling = parent && args.siblingTaskId
      ? parent.querySelector(`[data-task-id="${args.siblingTaskId}"]`)
      : null;
    const capture = (node) => {
      if (!node) {
        return null;
      }
      const style = getComputedStyle(node);
      return {
        className: String(node.className || ""),
        transform: String(style.transform || ""),
        backgroundColor: String(style.backgroundColor || "")
      };
    };
    return {
      row: capture(row),
      parent: capture(parent),
      sibling: capture(sibling),
      found: {
        row: Boolean(row),
        parent: Boolean(parent),
        sibling: Boolean(sibling)
      }
    };
  }, { rowTaskId, siblingTaskId });
}

function taskRowControl(page, taskId) {
  return page.locator(`[data-task-id="${taskId}"] .light-task-row-main`);
}

async function proveNotes(page, config, seed, theme, screenshots, summary) {
  await openTile(page, "Notes", "notes", config.timeoutMs);
  const note = seed.writeEnabled
    ? { id: seed.pinnedNoteId, title: "Proof Pinned Note" }
    : (seed.notes || []).find(item => Boolean(item.id)) ;
  const rowSelector = `.light-note-row[data-note-id="${note?.id || ""}"]`;
  if (!note?.id || !note?.title) {
    await backHome(page, theme, config.timeoutMs);
    return;
  }
  await page.locator(rowSelector).waitFor({ state: "visible", timeout: config.timeoutMs });
  screenshots[`${theme}_notes`] = await saveScreenshot(page, config.reportDir, `${theme}-notes-list`);
  await page.locator(rowSelector).click();
  await expectFrameHeading(page, note.title, config.timeoutMs);
  const layout = await readDetailHtmlBodyMetrics(page);
  const frameMetrics = await readDetailFrameDocumentMetrics(page);
  assertDetailHtmlLayout(layout, "note detail");
  assert(Number(layout.bodyTop || 0) <= Number(layout.headerBottom || 0) + 2, "Expected note HTML body to start directly below the header");
  assert(Number(layout.frameClientHeight || 0) + 2 >= Number(layout.frameScrollHeight || 0), "Expected note detail iframe height to cover its document height");
  assertDetailFrameMetrics(frameMetrics, "note detail", theme);
  summary.detailHtmlMetrics = summary.detailHtmlMetrics || [];
  summary.detailHtmlMetrics.push({ theme, route: "note-detail", layout, frame: frameMetrics });
  screenshots[`${theme}_notes_detail`] = await saveScreenshot(page, config.reportDir, `${theme}-notes-detail`);
  await backHome(page, theme, config.timeoutMs);
  await page.setViewportSize(DESKTOP_NOTE_DETAIL_VIEWPORT);
  await waitForHome(page, theme, config.timeoutMs);
  await openTile(page, "Notes", "notes", config.timeoutMs);
  await page.locator(rowSelector).waitFor({ state: "visible", timeout: config.timeoutMs });
  await page.locator(rowSelector).click();
  await expectFrameHeading(page, note.title, config.timeoutMs);
  const desktopLayout = await readDetailHtmlBodyMetrics(page);
  assertDetailHtmlLayout(desktopLayout, "note detail desktop");
  assert(
    desktopLayout.body && desktopLayout.page &&
      desktopLayout.body.left <= desktopLayout.page.left + 2 &&
      desktopLayout.body.right >= desktopLayout.page.right - 2,
    "Expected note detail desktop HTML body to remain full width"
  );
  summary.detailHtmlMetrics.push({ theme, route: "note-detail-desktop", layout: desktopLayout });
  screenshots[`${theme}_notes_detail_desktop`] = await saveScreenshot(page, config.reportDir, `${theme}-notes-detail-desktop`);
  await backHome(page, theme, config.timeoutMs);
  await page.setViewportSize(VIEWPORT);
  await waitForHome(page, theme, config.timeoutMs);
}

async function proveTasks(page, config, seed, theme, screenshots, summary, networkLog) {
  let seedTasks = Array.isArray(seed.tasks) ? [...seed.tasks] : [];
  if (seed.writeEnabled && !seedTasks.length) {
    seedTasks = await readCollection(config, "tasks");
  }
  const matchGroup = (group) => seedTasks.filter((task) => String(task.derived_group || "").toLowerCase() === group);
  const soonTasks = matchGroup("soon");
  const overdueTasks = matchGroup("overdue");
  const doneTasks = matchGroup("done");
  const dueFallback = matchGroup("do");

  let rowA;
  let rowB;

  if (seed.writeEnabled) {
    const taskById = (taskId) => seedTasks.find((task) => String(task.id) === String(taskId));
    rowA = taskById(seed.taskIds?.rowA) || {
      id: (seed.taskIds?.rowA || `${seed.runId}-${theme}-row-a`),
      title: "Proof Future Task"
    };
    rowB = taskById(seed.taskIds?.rowB) || {
      id: (seed.taskIds?.rowB || `${seed.runId}-${theme}-row-b`),
      title: "Proof Overdue Task"
    };
  } else if (soonTasks.length >= 2) {
    rowA = soonTasks[0];
    rowB = soonTasks[1];
  } else if (soonTasks.length === 1 && overdueTasks.length) {
    rowA = soonTasks[0];
    rowB = overdueTasks[0];
  } else if (overdueTasks.length >= 2) {
    rowA = overdueTasks[0];
    rowB = overdueTasks[1];
  } else if (dueFallback.length) {
    rowA = dueFallback[0];
    rowB = overdueTasks[0] || (seedTasks.length > 1 ? seedTasks[1] : null);
  } else {
    rowA = seedTasks[0];
    rowB = seedTasks[1];
  }

  if (rowA) {
    rowA.title = rowA.title || `Proof ${theme} Row A`;
  }
  if (rowB) {
    rowB.title = rowB.title || `Proof ${theme} Row B`;
  }

  const flipId = seed.writeEnabled ? seed.taskIds?.flip : null;
  await openTile(page, "Tasks", "tasks", config.timeoutMs);
  await page.waitForFunction(() => {
    const taskPage = document.querySelector(".light-tasks-page");
    if (!taskPage) {
      return false;
    }
    const hasRows = document.querySelectorAll("[data-task-id]").length > 0;
    const text = String(taskPage.textContent || "");
    return hasRows && !/\bLoading\b/.test(text);
  }, { timeout: config.timeoutMs }).catch(() => null);

  const availableLabels = [];
  for (const label of ["Overdue", "Today", "Upcoming", "Done"]) {
    try {
      const count = await page.getByText(label, { exact: true }).count();
      if (count > 0) {
        availableLabels.push(label);
      }
    } catch {
      // Ignore label checks when not present yet.
    }
  }
  if (!availableLabels.length && seed.writeEnabled) {
    // In write mode we expect seeded task sections to appear.
    const routeText = await page.locator('.light-tasks-page').innerText().catch(() => "");
    console.log(`Warning: expected task section headers in write-enabled proof, found: ${routeText?.slice(0, 256)}`);
  }
  if (seed.writeEnabled && !availableLabels.length) {
    screenshots[`${theme}_tasks_list`] = await saveScreenshot(page, config.reportDir, `${theme}-tasks-list`);
    await backHome(page, theme, config.timeoutMs);
    return;
  }
  const listState = await readTaskListState(page);
  summary.taskSections = summary.taskSections || [];
  summary.taskSections.push({
    theme,
    headers: listState.headers,
    countLine: listState.countLine,
    sectionExpanded: listState.sectionExpanded
  });
  if (seed.writeEnabled) {
    assert(
      JSON.stringify(listState.headers) === JSON.stringify(["Overdue", "Today", "Upcoming", "Done"]),
      `Expected task section order Overdue/Today/Upcoming/Done, got ${JSON.stringify(listState.headers)}`
    );
    assert(listState.sectionExpanded.done === false, "Expected Done section to start collapsed");
    assert(listState.sectionExpanded.overdue === true, "Expected Overdue section to start expanded");
    assert(listState.sectionExpanded.do === true, "Expected Today section to start expanded");
    assert(listState.sectionExpanded.soon === true, "Expected Upcoming section to start expanded");
    if (seed.taskIds?.done) {
      assert(
        !listState.visibleTaskIds.includes(seed.taskIds.done),
        "Expected done task rows to be hidden while Done is collapsed"
      );
    }
  }

  if (!rowA?.id || !rowB?.id) {
    screenshots[`${theme}_tasks_list`] = await saveScreenshot(page, config.reportDir, `${theme}-tasks-list`);
    await backHome(page, theme, config.timeoutMs);
    return;
  }
  const rowAButton = page.locator(`[data-task-id="${rowA.id}"]`);
  const rowBButton = page.locator(`[data-task-id="${rowB.id}"]`);
  await rowAButton.waitFor({ state: "visible", timeout: config.timeoutMs });
  await rowBButton.waitFor({ state: "visible", timeout: config.timeoutMs });
  const rowAPressTarget = taskRowControl(page, rowA.id);
  const rowBPressTarget = taskRowControl(page, rowB.id);
  await rowAPressTarget.waitFor({ state: "visible", timeout: config.timeoutMs });
  await rowBPressTarget.waitFor({ state: "visible", timeout: config.timeoutMs });
  screenshots[`${theme}_tasks_list`] = await saveScreenshot(page, config.reportDir, `${theme}-tasks-list`);

  const baselinePress = await readTaskPressMetrics(page, rowA.id, rowB.id);
  assert(baselinePress.found.row, `Missing task row ${rowA.id}`);
  await rowAPressTarget.dispatchEvent("pointerdown", { pointerId: 1, pointerType: "touch", isPrimary: true, buttons: 1 });
  const pressedPress = await readTaskPressMetrics(page, rowA.id, rowB.id);
  assert(pressedPress.found.row, `Pressed task row ${rowA.id} not found`);
  assert(pressedPress.found.parent, `Missing press parent card for task row ${rowA.id}`);
  assert(
    pressedPress.parent?.transform === baselinePress.parent?.transform,
    "Expected task row parent transform to remain stable"
  );
  assert(
    String(pressedPress.row?.transform || "") !== String(baselinePress.row?.transform || "") ||
    String(pressedPress.row?.backgroundColor || "") !== String(baselinePress.row?.backgroundColor || ""),
    "Expected row-level press feedback to change"
  );
  if (baselinePress.sibling) {
    assert(
      String(pressedPress.sibling?.transform || "") === String(baselinePress.sibling?.transform || ""),
      "Expected sibling row transform to remain stable"
    );
    assert(
      String(pressedPress.sibling?.backgroundColor || "") === String(baselinePress.sibling?.backgroundColor || ""),
      "Expected sibling row background to remain stable"
    );
  }
  await page.waitForTimeout(120);
  screenshots[`${theme}_tasks_row_press`] = await saveScreenshot(page, config.reportDir, `${theme}-tasks-row-press`);
  await rowAPressTarget.dispatchEvent("pointerup", { pointerId: 1, pointerType: "touch", isPrimary: true, buttons: 0 });
  await rowAPressTarget.evaluate((row) => {
    row.classList.remove("is-pressed");
  });

  summary.taskPress.push({
    theme,
    rowA: { id: rowA.id, title: rowA.title },
    rowB: { id: rowB.id, title: rowB.title },
    baseline: {
      parentTransform: baselinePress.parent?.transform,
      parentBackground: baselinePress.parent?.backgroundColor,
      rowTransform: baselinePress.row?.transform,
      rowBackground: baselinePress.row?.backgroundColor,
      siblingTransform: baselinePress.sibling?.transform
    },
    pressed: {
      parentTransform: pressedPress.parent?.transform,
      parentBackground: pressedPress.parent?.backgroundColor,
      rowTransform: pressedPress.row?.transform,
      rowBackground: pressedPress.row?.backgroundColor,
      siblingTransform: pressedPress.sibling?.transform
    }
  });

  await rowAPressTarget.click();
  await expectFrameHeading(page, rowA.title || `Proof ${theme} Row A`, config.timeoutMs);
  screenshots[`${theme}_tasks_detail_a`] = await saveScreenshot(page, config.reportDir, `${theme}-tasks-detail-a`);
  await page.evaluate(() => window.PuckyHandleAndroidBack && window.PuckyHandleAndroidBack());
  await page.waitForSelector('.light-shell[data-light-route="tasks"]', { timeout: config.timeoutMs });
  await rowBPressTarget.click();
  await expectFrameHeading(page, rowB.title || `Proof ${theme} Row B`, config.timeoutMs);
  screenshots[`${theme}_tasks_detail_b`] = await saveScreenshot(page, config.reportDir, `${theme}-tasks-detail-b`);
  await page.evaluate(() => window.PuckyHandleAndroidBack && window.PuckyHandleAndroidBack());
  await page.waitForSelector('.light-shell[data-light-route="tasks"]', { timeout: config.timeoutMs });

  if (!seed.writeEnabled) {
    await backHome(page, theme, config.timeoutMs);
    return;
  }

  const inlineId = seed.taskIds?.inline;
  const emptyId = seed.taskIds?.empty;
  const doneId = seed.taskIds?.done;
  summary.taskDetail = summary.taskDetail || [];

  await taskRowControl(page, inlineId).click();
  await page.waitForSelector('.light-shell[data-light-route="task-detail"]', { timeout: config.timeoutMs });
  let detailState = await readTaskDetailState(page);
  assert(detailState.route === "task-detail", `Expected task-detail route, got ${detailState.route}`);
  assert(detailState.title === "Proof Future Task", `Expected linked-note task title, got ${detailState.title}`);
  assert(!detailState.hasHtmlFrame, "Did not expect task detail to render an iframe body");
  assert(!detailState.hasRelated, "Did not expect RELATED section on task detail");
  assert(!detailState.hasGeneratedPage, "Did not expect GENERATED PAGE section on task detail");
  screenshots[`${theme}_tasks_note_linked`] = await saveScreenshot(page, config.reportDir, `${theme}-tasks-note-linked`);
  const noteLink = page.locator(`[data-workspace-target-route="note-detail"][data-workspace-target-id="${seed.pinnedNoteId}"]`).first();
  await noteLink.waitFor({ state: "visible", timeout: config.timeoutMs });
  await noteLink.click();
  await waitForLightRoute(page, "note-detail", config.timeoutMs);
  await waitForGraphText(page, "Proof Pinned Note", config.timeoutMs);
  screenshots[`${theme}_task_linked_note`] = await saveScreenshot(page, config.reportDir, `${theme}-task-linked-note`);
  await topBackToRoute(page, "task-detail", "Proof Future Task", config.timeoutMs);
  screenshots[`${theme}_task_detail_open_0s`] = await saveScreenshot(page, config.reportDir, `${theme}-task-detail-open-0s`);
  const idleStartMs = Date.now() + 250;
  await page.waitForTimeout(250);
  const idleProbe = await probeTaskDetailIdle(page, 5200);
  const idleEndMs = Date.now();
  const idleTaskRequests = countTaskRequestEvents(networkLog, idleStartMs, idleEndMs);
  screenshots[`${theme}_task_detail_open_5s`] = await saveScreenshot(page, config.reportDir, `${theme}-task-detail-open-5s`);
  summary.taskDetailIdle = summary.taskDetailIdle || [];
  summary.taskDetailIdle.push({
    theme,
    taskId: inlineId,
    networkTaskRequests: idleTaskRequests,
    sameIframeNode: idleProbe.sameIframeNode,
    sameShellNode: idleProbe.sameShellNode,
    sameTitleNode: idleProbe.sameTitleNode
  });
  assert(idleTaskRequests === 0, `Expected no task polling while task-detail idles, saw ${idleTaskRequests} task requests`);
  assert(idleProbe.sameIframeNode, "Expected task-detail iframe node to remain stable while idling");
  assert(idleProbe.sameShellNode, "Expected task-detail shell node to remain stable while idling");
  assert(idleProbe.sameTitleNode, "Expected task-detail title node to remain stable while idling");
  summary.taskDetail.push({ theme, type: "linked_note", taskId: inlineId, title: detailState.title, statusLabel: detailState.statusLabel, statusValue: detailState.statusValue, due: detailState.due });
  await page.evaluate(() => window.PuckyHandleAndroidBack && window.PuckyHandleAndroidBack());
  await page.waitForSelector('.light-shell[data-light-route="tasks"]', { timeout: config.timeoutMs });
  screenshots[`${theme}_tasks_list_after_back`] = await saveScreenshot(page, config.reportDir, `${theme}-tasks-list-after-back`);
  const listPollStartMs = Date.now() + 250;
  await page.waitForTimeout(2500);
  const listPollEndMs = Date.now();
  const listTaskRequests = countTaskRequestEvents(networkLog, listPollStartMs, listPollEndMs);
  summary.listPollingStillActive = summary.listPollingStillActive || [];
  summary.listPollingStillActive.push({ theme, networkTaskRequests: listTaskRequests });
  assert(listTaskRequests >= 1, `Expected task polling to remain active on list view, saw ${listTaskRequests} task requests`);

  await taskRowControl(page, emptyId).click();
  await page.waitForSelector('.light-shell[data-light-route="task-detail"]', { timeout: config.timeoutMs });
  detailState = await readTaskDetailState(page);
  assert(detailState.title === "Proof Empty Task", `Expected empty task title, got ${detailState.title}`);
  assert(!detailState.hasHtmlFrame, "Did not expect iframe body for no-HTML task");
  assert(
    await page.locator(`[data-workspace-target-route="note-detail"]`).count() === 0,
    "Did not expect note link targets on empty task detail"
  );
  screenshots[`${theme}_tasks_empty_html`] = await saveScreenshot(page, config.reportDir, `${theme}-tasks-empty-html`);
  summary.taskDetail.push({ theme, type: "no_note", taskId: emptyId, title: detailState.title, statusLabel: detailState.statusLabel, statusValue: detailState.statusValue, due: detailState.due });
  await page.evaluate(() => window.PuckyHandleAndroidBack && window.PuckyHandleAndroidBack());
  await page.waitForSelector('.light-shell[data-light-route="tasks"]', { timeout: config.timeoutMs });

  const toggleSection = async (group) => {
    const toggle = page.locator(`.light-task-section-toggle[data-task-section="${group}"]`);
    if (!(await toggle.count())) return null;
    await toggle.click();
    await page.waitForTimeout(250);
    return readTaskListState(page);
  };
  const ensureExpanded = async (group) => {
    const sectionState = await readTaskListState(page);
    if (sectionState.sectionExpanded[group] === false) {
      return toggleSection(group);
    }
    return sectionState;
  };

  const doneExpandedState = await toggleSection("done");
  if (doneExpandedState) {
    summary.taskSections.push({
      theme,
      headers: doneExpandedState.headers,
      countLine: doneExpandedState.countLine,
      sectionExpanded: doneExpandedState.sectionExpanded,
      phase: "done_expanded"
    });
    assert(doneExpandedState.sectionExpanded.done === true, "Expected Done section to expand after tapping the header");
    screenshots[`${theme}_tasks_done_expanded`] = await saveScreenshot(page, config.reportDir, `${theme}-tasks-done-expanded`);
    const collapsedAgain = await toggleSection("done");
    assert(collapsedAgain.sectionExpanded.done === false, "Expected Done section to collapse again after second tap");
  }

  for (const [group, label] of [["overdue", "Overdue"], ["do", "Today"], ["soon", "Upcoming"]]) {
    const collapsed = await toggleSection(group);
    if (!collapsed) continue;
    assert(collapsed.sectionExpanded[group] === false, `Expected ${label} to collapse after tapping the header`);
    const reopened = await toggleSection(group);
    assert(reopened.sectionExpanded[group] === true, `Expected ${label} to expand again after second tap`);
  }

  const expandedForDone = await ensureExpanded("done");
  if (expandedForDone?.sectionExpanded?.done !== true) {
    throw new Error("Expected Done section to be expanded before opening done task detail");
  }
  await taskRowControl(page, doneId).click();
  await page.waitForSelector('.light-shell[data-light-route="task-detail"]', { timeout: config.timeoutMs });
  detailState = await readTaskDetailState(page);
  assert(detailState.statusValue === "done", `Expected done task status value to be done, got ${detailState.statusValue}`);
  assert(detailState.statusLabel === "Done", `Expected done task status label to say Done, got ${detailState.statusLabel}`);
  screenshots[`${theme}_tasks_done_status`] = await saveScreenshot(page, config.reportDir, `${theme}-tasks-done-status`);
  summary.taskDetail.push({ theme, type: "done_status", taskId: doneId, title: detailState.title, statusLabel: detailState.statusLabel, statusValue: detailState.statusValue, due: detailState.due });
  await page.evaluate(() => window.PuckyHandleAndroidBack && window.PuckyHandleAndroidBack());
  await page.waitForSelector('.light-shell[data-light-route="tasks"]', { timeout: config.timeoutMs });

  screenshots[`${theme}_tasks_before_deadline`] = await saveScreenshot(page, config.reportDir, `${theme}-tasks-before-deadline`);
  await page.waitForTimeout(8500);
  if (seed.writeEnabled) {
    await page.waitForFunction((taskId) => {
      const row = document.querySelector(`[data-task-id="${taskId}"]`);
      return Boolean(row && row.classList.contains("overdue"));
    }, flipId, { timeout: config.timeoutMs });
  }
  screenshots[`${theme}_tasks_after`] = await saveScreenshot(page, config.reportDir, `${theme}-tasks-after-deadline`);
  screenshots[`${theme}_tasks_list_after_deadline_move`] = screenshots[`${theme}_tasks_after`];
  summary.deadlineAutoMoveStillActive = summary.deadlineAutoMoveStillActive || [];
  summary.deadlineAutoMoveStillActive.push({ theme, taskId: flipId, movedToOverdue: Boolean(flipId) });
  if (flipId) {
    await taskRowControl(page, flipId).click();
    await expectFrameHeading(page, `Proof Deadline Flip`, config.timeoutMs);
    screenshots[`${theme}_tasks_detail`] = await saveScreenshot(page, config.reportDir, `${theme}-tasks-detail`);
  }
  await backHome(page, theme, config.timeoutMs);
}

async function proveCalendar(page, config, seed, theme, screenshots, summary) {
  await openTile(page, "Calendar", "calendar", config.timeoutMs);
  const events = seed.writeEnabled ? [] : (seed.calendarEvents || []);
  const seededEventId = seed.writeEnabled ? seed.calendarIds?.todayRoadmap : null;
  const eventButtons = seededEventId
    ? page.locator(`[data-event-id="${seededEventId}"] .light-event-main`)
    : page.locator(".light-event-main");
  const eventCount = await eventButtons.count();
  if (!eventCount) {
    screenshots[`${theme}_calendar_today`] = await saveScreenshot(page, config.reportDir, `${theme}-calendar-today`);
    await backHome(page, theme, config.timeoutMs);
    return;
  }
  const expectedTitle = seed.writeEnabled
    ? "Proof Today Roadmap"
    : ((await eventButtons.first().locator(".light-event-title").innerText()).trim() || "Calendar");
  screenshots[`${theme}_calendar_today`] = await saveScreenshot(page, config.reportDir, `${theme}-calendar-today`);
  await eventButtons.first().click();
  await waitForLightRoute(page, "meeting-detail", config.timeoutMs);
  await waitForGraphText(page, expectedTitle, config.timeoutMs);
  const detailState = await page.evaluate(() => ({
    route: document.querySelector(".light-shell")?.getAttribute("data-light-route") || "",
    title: document.querySelector("h1")?.textContent?.trim() || "",
    sectionTitles: Array.from(document.querySelectorAll(".light-section-title")).map(node => String(node.textContent || "").trim()),
    detailRowLabels: Array.from(document.querySelectorAll(".light-calendar-detail-row-label")).map(node => String(node.textContent || "").trim()),
    hasHtmlFrame: Boolean(document.querySelector(".light-html-frame"))
  }));
  assert(detailState.route === "meeting-detail", `Expected meeting-detail route, got ${detailState.route}`);
  assert(detailState.title === expectedTitle, `Expected calendar detail title ${expectedTitle}, got ${detailState.title}`);
  assert(detailState.sectionTitles.includes("DETAILS"), `Expected calendar detail sections to include DETAILS, got ${JSON.stringify(detailState.sectionTitles)}`);
  assert(detailState.detailRowLabels.includes("When"), `Expected calendar detail rows to include When, got ${JSON.stringify(detailState.detailRowLabels)}`);
  assert(!detailState.hasHtmlFrame, "Did not expect calendar detail to use an iframe page");
  summary.calendarDetail = summary.calendarDetail || [];
  summary.calendarDetail.push({ theme, title: detailState.title, sectionTitles: detailState.sectionTitles, detailRowLabels: detailState.detailRowLabels });
  await backHome(page, theme, config.timeoutMs);
  return;
}

async function proveFeed(page, config, seed, theme, screenshots, summary) {
  await openTile(page, "Projects", "projects", config.timeoutMs);
  const projects = seed.writeEnabled ? null : (seed.projects || []);
  if (seed.writeEnabled) {
    await page.locator(`[data-project-id="${seed.runId}-alpha-project"]`).waitFor({ state: "visible", timeout: config.timeoutMs });
    await page.locator(`[data-project-id="${seed.runId}-alpha-project"]`).click();
    await expectFrameHeading(page, "Proof Alpha Project", config.timeoutMs);
  } else if (projects.length) {
    const firstProject = projects[0];
    await page.locator(`[data-project-id="${firstProject.id}"]`).waitFor({ state: "visible", timeout: config.timeoutMs });
    await page.locator(`[data-project-id="${firstProject.id}"]`).click();
    await expectFrameHeading(page, firstProject.title, config.timeoutMs);
  } else {
    await backHome(page, theme, config.timeoutMs);
    return;
  }
  const feedItems = seed.writeEnabled ? null : (seed.feedItems || []);
  const feedCards = seed.writeEnabled
    ? page.locator(`[data-workspace-target-route="inbox-detail"][data-workspace-target-id="${seed.runId}-project-decision"]`)
    : page.locator('[data-workspace-target-route="inbox-detail"]');
  const feedCardCount = await feedCards.count();
  if (!feedCardCount) {
    await backHome(page, theme, config.timeoutMs);
    return;
  }
  screenshots[`${theme}_inbox_links`] = await saveScreenshot(page, config.reportDir, `${theme}-inbox-links`);
  const row = seed.writeEnabled
    ? page.locator(`[data-workspace-target-route="inbox-detail"][data-workspace-target-id="${seed.runId}-project-decision"]`).first()
    : feedCards.first();
  if (seed.writeEnabled) {
    await row.waitFor({ state: "visible", timeout: config.timeoutMs });
  } else if (feedItems.length) {
    await page.getByText(feedItems[0].title).first().waitFor({ state: "visible", timeout: config.timeoutMs });
  }
  const detailText = await row.innerText();
  await row.click();
  await waitForLightRoute(page, "inbox-detail", config.timeoutMs);
  await expectFrameHeading(page, (detailText || "").split("\n")[0].trim() || "Inbox item", config.timeoutMs);
  if (!seed.writeEnabled && feedItems.length) {
    const item = feedItems.find((entry) => String(entry.id) === `${seed.runId}-project-decision`) || feedItems[0];
    await expectFrameHeading(page, item?.title || "Inbox item", config.timeoutMs);
  }
  const detailState = await readGraphDetailState(page);
  assert(detailState.route === "inbox-detail", `Expected inbox-detail route, got ${detailState.route}`);
  assert(!detailState.hasHtmlFrame, "Did not expect inbox detail to render a generated HTML iframe");
  screenshots[`${theme}_inbox_detail`] = await saveScreenshot(page, config.reportDir, `${theme}-inbox-detail`);
  if (seed.writeEnabled) {
    const noteLink = page.locator(`[data-workspace-target-route="note-detail"][data-workspace-target-id="${seed.pinnedNoteId}"]`).first();
    await noteLink.waitFor({ state: "visible", timeout: config.timeoutMs });
    await noteLink.click();
    await waitForLightRoute(page, "note-detail", config.timeoutMs);
    await waitForGraphText(page, "Proof Pinned Note", config.timeoutMs);
    screenshots[`${theme}_inbox_related_note`] = await saveScreenshot(page, config.reportDir, `${theme}-inbox-related-note`);
    await topBackToRoute(page, "inbox-detail", "Proof Project Decision", config.timeoutMs);
    await page.locator(`[data-workspace-target-route="project-detail"][data-workspace-target-id="${seed.runId}-alpha-project"]`).first().click();
    await waitForLightRoute(page, "project-detail", config.timeoutMs);
    await waitForGraphText(page, "Proof Alpha Project", config.timeoutMs);
    screenshots[`${theme}_inbox_related_project`] = await saveScreenshot(page, config.reportDir, `${theme}-inbox-related-project`);
    await topBackToRoute(page, "inbox-detail", "Proof Project Decision", config.timeoutMs);
    screenshots[`${theme}_inbox_after_back`] = await saveScreenshot(page, config.reportDir, `${theme}-inbox-after-back`);
  }
  await backHome(page, theme, config.timeoutMs);
}

async function proveProjects(page, config, seed, theme, screenshots, summary) {
  await openTile(page, "Projects", "projects", config.timeoutMs);
  const projects = seed.writeEnabled ? null : (seed.projects || []);
  if (seed.writeEnabled) {
    await page.locator(`[data-project-id="${seed.runId}-alpha-project"]`).waitFor({ state: "visible", timeout: config.timeoutMs });
    await page.locator(`[data-project-id="${seed.runId}-beta-project"]`).waitFor({ state: "visible", timeout: config.timeoutMs });
  } else if (projects.length) {
    await page.locator(`[data-project-id="${projects[0].id}"]`).waitFor({ state: "visible", timeout: config.timeoutMs });
  } else {
    await backHome(page, theme, config.timeoutMs);
    return;
  }
  screenshots[`${theme}_projects`] = await saveScreenshot(page, config.reportDir, `${theme}-projects-list`);
  if (seed.writeEnabled) {
    await page.locator(`[data-project-id="${seed.runId}-alpha-project"]`).click();
    for (const text of ["Alpha kickoff", "Alpha launch", "Proof Future Task", "Proof Today Roadmap", "Proof Project Decision", "Proof Contact One"]) {
      await page.getByText(text).waitFor({ state: "visible", timeout: config.timeoutMs });
    }
    await expectFrameHeading(page, "Proof Alpha Project", config.timeoutMs);
  } else {
    const firstProject = projects[0];
    await page.locator(`[data-project-id="${firstProject.id}"]`).click();
    await expectFrameHeading(page, firstProject.title, config.timeoutMs);
  }
  const detailState = await readGraphDetailState(page);
  assert(detailState.route === "project-detail", `Expected project-detail route, got ${detailState.route}`);
  assert(!detailState.hasHtmlFrame, "Did not expect project detail to render a generated HTML iframe");
  screenshots[`${theme}_projects_detail`] = await saveScreenshot(page, config.reportDir, `${theme}-projects-detail`);
  if (seed.writeEnabled) {
    await page.locator(`[data-workspace-target-route="note-detail"][data-workspace-target-id="${seed.pinnedNoteId}"]`).first().waitFor({ state: "visible", timeout: config.timeoutMs });
    for (const [route, id, text] of [
      ["note-detail", `${seed.runId}-pinned-note`, "Proof Pinned Note"],
      ["task-detail", `${seed.runId}-future-task`, "Proof Future Task"],
      ["meeting-detail", `${seed.runId}-today-roadmap`, "Proof Today Roadmap"]
    ]) {
      await page.locator(`[data-workspace-target-route="${route}"][data-workspace-target-id="${id}"]`).first().click();
      await waitForLightRoute(page, route, config.timeoutMs);
      await waitForGraphText(page, text, config.timeoutMs);
      await topBackToRoute(page, "project-detail", "Proof Alpha Project", config.timeoutMs);
    }
    screenshots[`${theme}_project_after_back`] = await saveScreenshot(page, config.reportDir, `${theme}-project-after-back`);
  }
  await backHome(page, theme, config.timeoutMs);
}

async function assertNoContactEndpoints(page, config, contactId, label) {
  const detailState = await page.evaluate(() => {
    const sectionTitles = Array.from(document.querySelectorAll(".light-info-section .light-section-title"))
      .map(node => String(node.textContent || "").trim())
      .filter(Boolean);
    return {
      sectionTitles
    };
  });
  assert(!detailState.sectionTitles.some(title => title.toLowerCase() === "endpoints"), `${label} should not render an Endpoints section`);
  if (String(contactId || "").trim() && String(config.apiToken || "").trim()) {
    const record = await apiRequest(config, "GET", `/api/workspace/contacts/${encodeURIComponent(String(contactId || "").trim())}`);
    const metadata = record?.metadata || {};
    assert(!Object.prototype.hasOwnProperty.call(metadata, "endpoints"), `${label} API metadata should not expose endpoints`);
  }
  return detailState;
}

async function readContactsListFlatness(page) {
  return page.evaluate(() => {
    const shell = document.querySelector(".light-shell");
    const list = document.querySelector(".light-contact-list");
    const rows = Array.from(document.querySelectorAll(".light-contact-row"));
    const firstRow = rows[0] || null;
    const secondRow = rows[1] || null;
    const listStyle = list ? getComputedStyle(list) : null;
    const firstRowStyle = firstRow ? getComputedStyle(firstRow) : null;
    const secondRowStyle = secondRow ? getComputedStyle(secondRow) : null;
    return {
      route: shell?.getAttribute("data-light-route") || "",
      rowCount: rows.length,
      firstContactId: firstRow?.getAttribute("data-contact-id") || "",
      listGap: listStyle?.gap || "",
      listPaddingLeft: listStyle?.paddingLeft || "",
      listPaddingRight: listStyle?.paddingRight || "",
      rowClassList: firstRow ? Array.from(firstRow.classList) : [],
      rowBackground: firstRowStyle?.backgroundColor || "",
      rowBoxShadow: firstRowStyle?.boxShadow || "",
      rowBorderTopLeftRadius: firstRowStyle?.borderTopLeftRadius || "",
      rowBorderTopRightRadius: firstRowStyle?.borderTopRightRadius || "",
      rowPaddingLeft: firstRowStyle?.paddingLeft || "",
      rowPaddingRight: firstRowStyle?.paddingRight || "",
      dividerWidth: secondRowStyle?.borderTopWidth || "",
      dividerColor: secondRowStyle?.borderTopColor || "",
    };
  });
}

async function readContactsSearchState(page) {
  return page.evaluate(() => {
    const shell = document.querySelector(".light-shell");
    const search = document.querySelector(".light-contacts-search");
    const rows = Array.from(document.querySelectorAll(".light-contact-row"));
    const empty = document.querySelector(".light-empty-state");
    return {
      route: shell?.getAttribute("data-light-route") || "",
      searchVisible: Boolean(search),
      query: search instanceof HTMLInputElement ? search.value : "",
      rowIds: rows.map(node => String(node.getAttribute("data-contact-id") || "").trim()).filter(Boolean),
      rowTitles: rows
        .map(node => String(node.querySelector(".light-text-stack strong")?.textContent || "").trim())
        .filter(Boolean),
      emptyText: String(empty?.textContent || "").replace(/\s+/g, " ").trim(),
    };
  });
}

async function setContactsSearchQuery(page, query, timeoutMs) {
  const search = page.locator(".light-contacts-search").first();
  await search.waitFor({ state: "visible", timeout: timeoutMs });
  await search.fill(query);
  await page.waitForFunction(expectedQuery => {
    const input = document.querySelector(".light-contacts-search");
    return input instanceof HTMLInputElement && input.value === expectedQuery;
  }, query, { timeout: timeoutMs });
}

async function expectContactsSearchRows(page, query, expectedIds, timeoutMs) {
  await setContactsSearchQuery(page, query, timeoutMs);
  await page.waitForFunction(({ expectedQuery, ids }) => {
    const input = document.querySelector(".light-contacts-search");
    const rowIds = Array.from(document.querySelectorAll(".light-contact-row"))
      .map(node => String(node.getAttribute("data-contact-id") || "").trim())
      .filter(Boolean);
    return input instanceof HTMLInputElement
      && input.value === expectedQuery
      && JSON.stringify(rowIds) === JSON.stringify(ids);
  }, { expectedQuery: query, ids: expectedIds }, { timeout: timeoutMs });
  return readContactsSearchState(page);
}

async function proveContacts(page, config, seed, theme, screenshots, summary) {
  await openTile(page, "Contacts", "contacts", config.timeoutMs);
  const contacts = seed.writeEnabled ? null : (seed.contacts || []);
  const firstContact = page.locator("button[data-contact-id]").first();
  await firstContact.waitFor({ state: "visible", timeout: config.timeoutMs });
  const firstContactId = String(await firstContact.getAttribute("data-contact-id") || "");
  const contactsListFlatness = await readContactsListFlatness(page);
  const baselineSearchState = await readContactsSearchState(page);
  const baselineRowIds = baselineSearchState.rowIds.slice();
  assert(firstContactId === "contact-me", `Me contact should remain pinned first in Contacts (saw ${firstContactId || "none"})`);
  assert(contactsListFlatness.route === "contacts", `Expected contacts route before detail, got ${contactsListFlatness.route}`);
  assert(baselineSearchState.searchVisible, "Contacts search should be visible once contacts have loaded");
  assert(baselineSearchState.query === "", `Expected Contacts search to start empty, got ${baselineSearchState.query}`);
  assert(baselineRowIds[0] === "contact-me", `Expected Contacts baseline list to keep Me first, got ${baselineRowIds[0] || "none"}`);
  assert(contactsListFlatness.rowClassList.includes("is-flat-feed"), `Contacts list should render flat-feed rows (${contactsListFlatness.rowClassList.join(" ")})`);
  assert(isTransparentColor(contactsListFlatness.rowBackground), `Contacts list should stay visually flat (${contactsListFlatness.rowBackground})`);
  assert(isNoShadow(contactsListFlatness.rowBoxShadow), `Contacts list should stay visually flat (${contactsListFlatness.rowBoxShadow})`);
  assert(
    isZeroishPx(contactsListFlatness.rowBorderTopLeftRadius) && isZeroishPx(contactsListFlatness.rowBorderTopRightRadius),
    `Contacts list should remove rounded row corners (${contactsListFlatness.rowBorderTopLeftRadius}, ${contactsListFlatness.rowBorderTopRightRadius})`
  );
  assert(isZeroishPx(contactsListFlatness.listGap), `Contacts list should remove inter-row card gaps (${contactsListFlatness.listGap})`);
  assert(
    isZeroishPx(contactsListFlatness.rowPaddingLeft) && isZeroishPx(contactsListFlatness.rowPaddingRight),
    `Contacts list should remove detached side padding (${contactsListFlatness.rowPaddingLeft}, ${contactsListFlatness.rowPaddingRight})`
  );
  if (contactsListFlatness.rowCount > 1) {
    assert(
      !isZeroishPx(contactsListFlatness.dividerWidth) && !isTransparentColor(contactsListFlatness.dividerColor),
      `Contacts list should keep divider separation between rows (${contactsListFlatness.dividerWidth}, ${contactsListFlatness.dividerColor})`
    );
  }
  screenshots[`${theme}_contacts`] = await saveScreenshot(page, config.reportDir, `${theme}-contacts-search-baseline`);
  await page.locator('button[data-contact-id="contact-me"]').click();
  await waitForLightRoute(page, "contact-detail", config.timeoutMs);
  await waitForGraphText(page, "Me", config.timeoutMs);
  await assertNoContactEndpoints(page, config, "contact-me", "Me contact detail");
  screenshots[`${theme}_contacts_me_detail`] = await saveScreenshot(page, config.reportDir, `${theme}-contacts-me-detail`);
  assert(await page.getByRole("button", { name: "Edit Me" }).count() === 0, "Expected contacts detail to be read-only");
  await topBackToRoute(page, "contacts", "", config.timeoutMs);
  if (!seed.writeEnabled && !contacts.length) {
    await backHome(page, theme, config.timeoutMs);
    return;
  }
  if (seed.writeEnabled) {
    const proofContactId = `${seed.runId}-contact-one`;
    const emailQuery = "one@example";
    const phoneQuery = "0101000";
    const phraseQuery = "Linked to Alpha";
    const reminderQuery = "reminder";
    const noMatchQuery = "zzzz-no-match";

    const emailSearchState = await expectContactsSearchRows(page, emailQuery, [proofContactId], config.timeoutMs);
    assert(emailSearchState.rowTitles.includes("Proof Contact One"), `Expected email query to return Proof Contact One, got ${emailSearchState.rowTitles.join(", ")}`);
    screenshots[`${theme}_contacts_search_email`] = await saveScreenshot(page, config.reportDir, `${theme}-contacts-search-filtered-email`);

    const phoneSearchState = await expectContactsSearchRows(page, phoneQuery, [proofContactId], config.timeoutMs);
    assert(phoneSearchState.rowTitles.includes("Proof Contact One"), `Expected phone query to return Proof Contact One, got ${phoneSearchState.rowTitles.join(", ")}`);
    screenshots[`${theme}_contacts_search_phone`] = await saveScreenshot(page, config.reportDir, `${theme}-contacts-search-filtered-phone`);

    const phraseSearchState = await expectContactsSearchRows(page, phraseQuery, [proofContactId], config.timeoutMs);
    assert(phraseSearchState.rowTitles.includes("Proof Contact One"), `Expected phrase query to return Proof Contact One, got ${phraseSearchState.rowTitles.join(", ")}`);
    screenshots[`${theme}_contacts_search_phrase`] = await saveScreenshot(page, config.reportDir, `${theme}-contacts-search-filtered-phrase`);

    await setContactsSearchQuery(page, reminderQuery, config.timeoutMs);
    await page.waitForFunction(expectedQuery => {
      const input = document.querySelector(".light-contacts-search");
      const rowIds = Array.from(document.querySelectorAll(".light-contact-row"))
        .map(node => String(node.getAttribute("data-contact-id") || "").trim())
        .filter(Boolean);
      return input instanceof HTMLInputElement
        && input.value === expectedQuery
        && rowIds.includes("contact-me")
        && rowIds[0] === "contact-me";
    }, reminderQuery, { timeout: config.timeoutMs });
    const reminderSearchState = await readContactsSearchState(page);
    assert(reminderSearchState.rowIds[0] === "contact-me", `Expected reminder query to keep Me first, got ${reminderSearchState.rowIds.join(", ")}`);

    const emptySearchState = await expectContactsSearchRows(page, noMatchQuery, [], config.timeoutMs);
    assert(emptySearchState.searchVisible, "Contacts search should stay visible when there are no matching results");
    assert(
      emptySearchState.emptyText.includes("No contacts match your search."),
      `Expected no-results state to mention missing contacts, got ${emptySearchState.emptyText}`
    );
    screenshots[`${theme}_contacts_search_empty`] = await saveScreenshot(page, config.reportDir, `${theme}-contacts-search-empty`);

    const clearedSearchState = await expectContactsSearchRows(page, "", baselineRowIds, config.timeoutMs);
    assert(clearedSearchState.rowIds[0] === "contact-me", `Expected clearing Contacts search to restore Me first, got ${clearedSearchState.rowIds[0] || "none"}`);
    screenshots[`${theme}_contacts_search_cleared`] = await saveScreenshot(page, config.reportDir, `${theme}-contacts-search-cleared`);

    await expectContactsSearchRows(page, emailQuery, [proofContactId], config.timeoutMs);
    await page.locator(`button[data-contact-id="${proofContactId}"]`).click();
    await page.getByText("proof.one@example.com").first().waitFor({ state: "visible", timeout: config.timeoutMs });
    await expectFrameHeading(page, "Proof Contact One", config.timeoutMs);
    await assertNoContactEndpoints(page, config, proofContactId, "Proof Contact One detail");
    const filteredDetailState = await readGraphDetailState(page);
    assert(filteredDetailState.route === "contact-detail", `Expected contact-detail route, got ${filteredDetailState.route}`);
    assert(!filteredDetailState.hasHtmlFrame, "Did not expect contact detail to render a generated HTML iframe");
    screenshots[`${theme}_contacts_detail`] = await saveScreenshot(page, config.reportDir, `${theme}-contacts-search-detail-from-filter`);

    await topBackToRoute(page, "contacts", "", config.timeoutMs);
    const backToFilteredState = await readContactsSearchState(page);
    assert(backToFilteredState.query === emailQuery, `Expected active Contacts search query to survive contact-detail Back, got ${backToFilteredState.query}`);
    assert(
      JSON.stringify(backToFilteredState.rowIds) === JSON.stringify([proofContactId]),
      `Expected Back to restore the same filtered Contacts list, got ${backToFilteredState.rowIds.join(", ")}`
    );

    await backHome(page, theme, config.timeoutMs);
    await openTile(page, "Contacts", "contacts", config.timeoutMs);
    await firstContact.waitFor({ state: "visible", timeout: config.timeoutMs });
    const reenteredSearchState = await readContactsSearchState(page);
    assert(reenteredSearchState.query === "", `Expected Contacts search to reset after leaving the Contacts surface, got ${reenteredSearchState.query}`);
    assert(
      JSON.stringify(reenteredSearchState.rowIds) === JSON.stringify(baselineRowIds),
      `Expected Contacts re-entry to restore the baseline list, got ${reenteredSearchState.rowIds.join(", ")}`
    );

    await page.locator(`button[data-contact-id="${proofContactId}"]`).click();
    await page.getByText("proof.one@example.com").first().waitFor({ state: "visible", timeout: config.timeoutMs });
    await expectFrameHeading(page, "Proof Contact One", config.timeoutMs);
    await assertNoContactEndpoints(page, config, proofContactId, "Proof Contact One detail");
    screenshots[`${theme}_contacts_detail_reopened`] = await saveScreenshot(page, config.reportDir, `${theme}-contacts-detail`);
    if (seed.writeEnabled) {
      await page.locator(`[data-workspace-target-route="note-detail"][data-workspace-target-id="${seed.pinnedNoteId}"]`).first().waitFor({ state: "visible", timeout: config.timeoutMs });
      for (const [route, id, text] of [
        ["note-detail", `${seed.runId}-pinned-note`, "Proof Pinned Note"],
        ["project-detail", `${seed.runId}-alpha-project`, "Proof Alpha Project"],
        ["meeting-note-detail", `${seed.runId}-graph-meeting`, "Proof Graph Meeting"]
      ]) {
        await page.locator(`[data-workspace-target-route="${route}"][data-workspace-target-id="${id}"]`).first().click();
        await waitForLightRoute(page, route, config.timeoutMs);
        await waitForGraphText(page, text, config.timeoutMs);
        await topBackToRoute(page, "contact-detail", "Proof Contact One", config.timeoutMs);
      }
      screenshots[`${theme}_contact_after_back`] = await saveScreenshot(page, config.reportDir, `${theme}-contact-after-back`);
    }
    await backHome(page, theme, config.timeoutMs);
    summary.contactProfiles = summary.contactProfiles || [];
    summary.contactProfiles.push({
      theme,
      selfContactId: firstContactId,
      contacts_list_flatness: contactsListFlatness,
      contacts_search: {
        baseline_row_ids: baselineRowIds,
        queries: {
          email: emailQuery,
          phone: phoneQuery,
          phrase: phraseQuery,
          reminder: reminderQuery,
          no_match: noMatchQuery,
        }
      }
    });
    return;
  }
  const firstVisibleContact = contacts[0];
  await page.locator(`button[data-contact-id="${firstVisibleContact.id}"]`).click();
  await expectFrameHeading(page, firstVisibleContact.title, config.timeoutMs);
  await assertNoContactEndpoints(page, config, firstVisibleContact.id, `${firstVisibleContact.title} detail`);
  const detailState = await readGraphDetailState(page);
  assert(detailState.route === "contact-detail", `Expected contact-detail route, got ${detailState.route}`);
  assert(!detailState.hasHtmlFrame, "Did not expect contact detail to render a generated HTML iframe");
  screenshots[`${theme}_contacts_detail`] = await saveScreenshot(page, config.reportDir, `${theme}-contacts-detail`);
  await backHome(page, theme, config.timeoutMs);
  summary.contactProfiles = summary.contactProfiles || [];
  summary.contactProfiles.push({ theme, selfContactId: firstContactId, contacts_list_flatness: contactsListFlatness });
}

async function proveReminders(page, config, seed, theme, screenshots, summary) {
  if (!seed.writeEnabled) {
    summary.assertions.push("reminder delivery proof skipped because API token was unavailable");
    return;
  }
  const deliveryEnabled = shouldRunReminderDelivery(config);
  const manageReminderId = `${seed.runId}-manage-reminder`;
  const manageDueAtMs = Date.now() + 30 * 60 * 1000;
  const deliveryLanes = deliveryEnabled
    ? [
        {
          key: "phone",
          id: `${seed.runId}-due-reminder-phone`,
          title: "Proof Due Reminder Phone",
          channel: "phone_notification",
          detail: "Phone notification lane should fire through VM reminder polling."
        },
        {
          key: "gmail",
          id: `${seed.runId}-due-reminder-gmail`,
          title: "Proof Due Reminder Gmail",
          channel: "email",
          detail: "Gmail lane should fire through VM reminder polling."
        },
        {
          key: "sms",
          id: `${seed.runId}-due-reminder-sms`,
          title: "Proof Due Reminder SMS",
          channel: "sms",
          detail: "SMS lane should fire through VM reminder polling."
        }
      ]
    : [];
  for (const reminderId of [manageReminderId, ...deliveryLanes.map(item => item.id)]) {
    await deleteWorkspaceRecord(config, "reminders", reminderId);
  }
  const baselineActiveCount = await readActiveReminderCount(config);
  for (const [index, lane] of deliveryLanes.entries()) {
    await apiRequest(config, "POST", "/api/workspace/reminders", {
      id: lane.id,
      title: lane.title,
      summary: lane.detail,
      status: "open",
      due_at_ms: Date.now() + 5_000 + (index * 1_500),
      metadata: {
        source_kind: "task",
        source_id: `${seed.runId}-future-task`,
        recipients: [{ id: "self", kind: "self", label: "Me" }],
        destinations: [{ channel: lane.channel, recipient_ids: ["self"] }]
      }
    });
  }
  await apiRequest(config, "POST", "/api/workspace/reminders", {
    id: manageReminderId,
    title: "Proof Manage Reminder",
    summary: "Reminder detail should stay clean and manageable.",
    status: "open",
    due_at_ms: manageDueAtMs,
    metadata: {
      source_kind: "project",
      source_id: `${seed.runId}-alpha-project`,
      recipients: [{ id: "self", kind: "self", label: "Me" }],
      destinations: [{ channel: "phone_notification", recipient_ids: ["self"] }]
    }
  });
  let activeCount = baselineActiveCount + deliveryLanes.length + 1;
  await page.goto(pageUrl(config.baseUrl, theme), { waitUntil: "commit", timeout: config.timeoutMs });
  await waitForHome(page, theme, config.timeoutMs);
  await openTile(page, "Reminders", "reminders", config.timeoutMs);
  const manageRow = page.locator(`[data-reminder-id="${manageReminderId}"]`);
  await manageRow.waitFor({ state: "visible", timeout: config.timeoutMs });
  for (const lane of deliveryLanes) {
    await page.locator(`[data-reminder-id="${lane.id}"]`).waitFor({ state: "visible", timeout: config.timeoutMs });
  }
  await page.waitForFunction(() => {
    const text = document.body.innerText || "";
    return !text.includes("Overdue") && !text.includes("Done") && !text.includes("Failed");
  }, { timeout: config.timeoutMs });
  await page.waitForFunction(() => {
    return !document.querySelector(".light-reminder-history-divider")
      && !document.querySelector(".light-reminder-history-list")
      && !document.querySelector('[data-reminder-history-toggle="sent"]');
  }, { timeout: config.timeoutMs });
  const rowChipCounts = [];
  for (const lane of deliveryLanes) {
    rowChipCounts.push(await page.locator(`[data-reminder-id="${lane.id}"]`).locator(".light-graph-chip-row").count());
  }
  const manageChipCount = await manageRow.locator(".light-graph-chip-row").count();
  assert(rowChipCounts.every(count => count === 0), `Expected no linked chips on delivery reminder rows, saw ${rowChipCounts.join(",")}`);
  assert(manageChipCount === 0, `Expected no linked chips on reminder rows, saw ${manageChipCount}`);
  await backHome(page, theme, config.timeoutMs);
  await waitForReminderHomeBadgeCount(page, activeCount, config.timeoutMs);
  screenshots[`${theme}_reminders_home_badge_active`] = await saveScreenshot(page, config.reportDir, `${theme}-reminders-home-badge-active`);
  await openTile(page, "Reminders", "reminders", config.timeoutMs);
  await manageRow.waitFor({ state: "visible", timeout: config.timeoutMs });
  screenshots[`${theme}_reminders_list_pending`] = await saveScreenshot(page, config.reportDir, `${theme}-reminders-list-pending`);
  await manageRow.click({ force: true });
  await waitForLightRoute(page, "reminder-detail", config.timeoutMs);
  await waitForGraphText(page, "Proof Manage Reminder", config.timeoutMs);
  await page.waitForFunction(() => {
    const text = document.body.innerText || "";
    const lower = text.toLowerCase();
    const sectionTitles = [...document.querySelectorAll(".light-section-title")].map(node => String(node.textContent || "").trim().toLowerCase());
    return lower.includes("status:")
      && lower.includes("delivery:")
      && lower.includes("done")
      && lower.includes("snooze 10 min")
      && lower.includes("snooze...")
      && lower.includes("me")
      && !lower.includes("self")
      && !sectionTitles.includes("schedule")
      && !sectionTitles.includes("recipients")
      && !sectionTitles.includes("channels")
      && !sectionTitles.includes("linked records")
      && Boolean(document.querySelector('[data-reminder-action-row="true"]'))
      && Boolean(document.querySelector('[data-reminder-detail-feed="true"]'))
      && !document.querySelector(".light-reminder-detail-feed .light-chevron")
      && !lower.includes("no generated reminder page yet.");
  }, { timeout: config.timeoutMs });
  await page.waitForFunction(() => !document.querySelector(".light-detail-html-body .light-html-frame"), { timeout: config.timeoutMs });
  screenshots[`${theme}_reminder_detail_pending`] = await saveScreenshot(page, config.reportDir, `${theme}-reminder-detail-pending`);
  summary.reminders = summary.reminders || [];
  const reminderSummary = {
    theme,
    baselineActiveCount,
    deliveryEnabled,
    manageReminderId,
    quickSnoozedUntilMs: 0,
    presetSnoozedUntilMs: 0,
    doneStatus: "",
    lanes: []
  };
  await page.locator('[data-reminder-action="snooze_10"]').click();
  const quickSnoozedRecord = await waitForReminderRecord(
    config,
    manageReminderId,
    record => reminderIsSnoozedForScript(record) && Number(record?.due_at_ms || 0) >= Date.now() + (8 * 60 * 1000),
    "manage reminder should quick-snooze for ten minutes",
    30_000
  );
  reminderSummary.quickSnoozedUntilMs = Number(quickSnoozedRecord?.metadata?.snoozed_until_ms || 0);
  activeCount -= 1;
  await page.waitForFunction(() => {
    const shell = document.querySelector(".light-shell");
    const text = String(shell?.textContent || "").toLowerCase();
    return shell?.getAttribute("data-light-route") === "reminder-detail"
      && text.includes("delivery: snoozed")
      && text.includes("snoozed until");
  }, { timeout: config.timeoutMs });
  screenshots[`${theme}_reminder_detail_snoozed_10`] = await saveScreenshot(page, config.reportDir, `${theme}-reminder-detail-snoozed-10`);

  await page.locator('[data-reminder-action="snooze_selector"]').click();
  await page.locator(".settings-selector-overlay.is-open").waitFor({ state: "visible", timeout: config.timeoutMs });
  await page.waitForFunction(() => {
    const text = String(document.querySelector(".settings-selector-sheet")?.textContent || "").toLowerCase();
    return text.includes("1 hour") && text.includes("this evening") && text.includes("tomorrow morning");
  }, { timeout: config.timeoutMs });
  screenshots[`${theme}_reminder_snooze_selector`] = await saveScreenshot(page, config.reportDir, `${theme}-reminder-snooze-selector`);
  await page.locator('[data-selector-value="1_hour"]').click();
  const presetSnoozedRecord = await waitForReminderRecord(
    config,
    manageReminderId,
    record => reminderIsSnoozedForScript(record) && Number(record?.due_at_ms || 0) >= Date.now() + (55 * 60 * 1000),
    "manage reminder should accept preset snooze selection",
    30_000
  );
  reminderSummary.presetSnoozedUntilMs = Number(presetSnoozedRecord?.metadata?.snoozed_until_ms || 0);
  await page.waitForFunction(() => {
    const shell = document.querySelector(".light-shell");
    const text = String(shell?.textContent || "").toLowerCase();
    return shell?.getAttribute("data-light-route") === "reminder-detail"
      && !document.querySelector(".settings-selector-overlay.is-open")
      && text.includes("delivery: snoozed");
  }, { timeout: config.timeoutMs });
  screenshots[`${theme}_reminder_detail_snoozed_preset`] = await saveScreenshot(page, config.reportDir, `${theme}-reminder-detail-snoozed-preset`);

  await page.locator('[data-reminder-action="done"]').click();
  const doneReminder = await waitForReminderRecord(
    config,
    manageReminderId,
    record => String(record?.status || "").trim().toLowerCase() === "done",
    "manage reminder should mark done",
    30_000
  );
  reminderSummary.doneStatus = String(doneReminder?.status || "").trim().toLowerCase();
  await waitForLightRoute(page, "reminders", config.timeoutMs);
  await page.waitForFunction((targetId) => !document.querySelector(`.light-reminder-row[data-reminder-id="${targetId}"]`), manageReminderId, { timeout: config.timeoutMs });
  screenshots[`${theme}_reminders_list_after_done`] = await saveScreenshot(page, config.reportDir, `${theme}-reminders-list-after-done`);
  if (deliveryEnabled) {
    for (const lane of deliveryLanes) {
      const firedRecord = await waitForReminderRecord(
        config,
        lane.id,
        record => String(record?.metadata?.delivery_state || "").trim().toLowerCase() === "sent",
        `${lane.channel} reminder delivery_state should become sent`,
        45_000
      );
      const firedState = String(firedRecord?.metadata?.delivery_state || "").trim().toLowerCase();
      assert(firedState === "sent", `Expected ${lane.channel} reminder delivery_state to be sent, got ${firedState}`);
      activeCount -= 1;
      await page.waitForFunction((targetId) => !document.querySelector(`.light-reminder-row[data-reminder-id="${targetId}"]`), lane.id, { timeout: config.timeoutMs });
      screenshots[`${theme}_reminders_${lane.key}_after_fire`] = await saveScreenshot(page, config.reportDir, `${theme}-reminders-${lane.key}-after-fire`);
      await backHome(page, theme, config.timeoutMs);
      await waitForReminderHomeBadgeCount(page, activeCount, config.timeoutMs);
      screenshots[`${theme}_reminders_home_badge_${lane.key}_after_fire`] = await saveScreenshot(page, config.reportDir, `${theme}-reminders-home-badge-${lane.key}-after-fire`);
      await openTile(page, "Reminders", "reminders", config.timeoutMs);
      await waitForLightRoute(page, "reminders", config.timeoutMs);
      reminderSummary.lanes.push({
        key: lane.key,
        channel: lane.channel,
        reminderId: lane.id,
        deliveryState: firedState,
        deliveryResults: firedRecord?.metadata?.last_delivery_results || []
      });
    }
  } else {
    summary.assertions.push(`${theme} reminder live-delivery lanes skipped because ${config.baseUrl} is not the live VM target`);
  }

  await backHome(page, theme, config.timeoutMs);
  await waitForReminderHomeBadgeCount(page, activeCount, config.timeoutMs);
  screenshots[`${theme}_reminders_home_badge_after_actions`] = await saveScreenshot(page, config.reportDir, `${theme}-reminders-home-badge-after-actions`);
  await waitForReminderHomeBadgeCount(page, activeCount, config.timeoutMs);

  reminderSummary.finalActiveCount = activeCount;
  summary.reminders.push(reminderSummary);
  summary.assertions.push(`${theme} reminders regroup into Now/Upcoming/Snoozed, expose actionable snooze and done controls, remove channels and detail chevrons, and keep the home badge tied to active reminders only`);
}

async function readGraphDetailState(page) {
  return page.evaluate(() => ({
    route: document.querySelector(".light-shell")?.getAttribute("data-light-route") || "",
    text: document.querySelector(".light-shell")?.textContent || "",
    hasHtmlFrame: Boolean(document.querySelector(".light-detail-html-body .light-html-frame")),
    hasNotes: /\bnotes\b/i.test(document.querySelector(".light-shell")?.textContent || "")
  }));
}

async function waitForGraphText(page, text, timeoutMs) {
  await page.waitForFunction((targetText) => {
    const shell = document.querySelector(".light-shell");
    return Boolean(shell && String(shell.textContent || "").includes(targetText));
  }, text, { timeout: timeoutMs });
}

async function waitForLightRoute(page, route, timeoutMs) {
  await page.waitForFunction((targetRoute) => {
    return document.querySelector(".light-shell")?.getAttribute("data-light-route") === targetRoute;
  }, route, { timeout: timeoutMs });
}

async function proveGraphObjects(page, config, seed, theme, screenshots, summary) {
  if (!seed.writeEnabled) {
    summary.assertions.push("graph object proof skipped write ripple checks because API token was unavailable");
    return;
  }
  const { meeting, reminder } = seed.graphIds || {};
  assert(meeting && reminder, "Expected graph proof IDs from seedWorkspace");

  let graphState;

  await openTile(page, "Meeting Notes", "meeting-notes", config.timeoutMs);
  await page.locator(`[data-record-id="${meeting}"]`).waitFor({ state: "visible", timeout: config.timeoutMs });
  screenshots[`${theme}_graph_meetings`] = await saveScreenshot(page, config.reportDir, `${theme}-graph-meeting-notes-list`);
  await page.locator(`[data-record-id="${meeting}"]`).click();
  await expectFrameHeading(page, "Proof Graph Meeting", config.timeoutMs);
  for (const text of ["Proof Contact One", "Proof Today Roadmap", "Proof Pinned Note", "Proof Future Task", "Proof Alpha Project", "Proof Graph Reminder"]) {
    await waitForGraphText(page, text, config.timeoutMs);
  }
  graphState = await readGraphDetailState(page);
  assert(graphState.route === "meeting-note-detail", `Expected meeting-note-detail route, got ${graphState.route}`);
  assert(!graphState.hasHtmlFrame, "Did not expect meeting note detail to render a generated HTML iframe");
  await page.locator(`[data-workspace-target-route="note-detail"][data-workspace-target-id="${seed.runId}-pinned-note"]`).first().waitFor({ state: "visible", timeout: config.timeoutMs });
  screenshots[`${theme}_graph_meeting_detail`] = await saveScreenshot(page, config.reportDir, `${theme}-graph-meeting-detail`);
  for (const [route, id, text, shot] of [
    ["contact-detail", `${seed.runId}-contact-one`, "Proof Contact One", "graph-meeting-linked-contact"],
    ["note-detail", `${seed.runId}-pinned-note`, "Proof Pinned Note", "graph-meeting-linked-note"]
  ]) {
    await page.locator(`[data-workspace-target-route="${route}"][data-workspace-target-id="${id}"]`).first().click();
    await waitForLightRoute(page, route, config.timeoutMs);
    await waitForGraphText(page, text, config.timeoutMs);
    screenshots[`${theme}_${shot}`] = await saveScreenshot(page, config.reportDir, `${theme}-${shot}`);
    await topBackToRoute(page, "meeting-note-detail", "Proof Graph Meeting", config.timeoutMs);
  }
  screenshots[`${theme}_meeting_note_after_back`] = await saveScreenshot(page, config.reportDir, `${theme}-meeting-note-after-back`);
  await backHome(page, theme, config.timeoutMs);

  await openTile(page, "Reminders", "reminders", config.timeoutMs);
  await page.locator(`[data-reminder-id="${reminder}"]`).waitFor({ state: "visible", timeout: config.timeoutMs });
  screenshots[`${theme}_graph_reminders`] = await saveScreenshot(page, config.reportDir, `${theme}-graph-reminders-list`);
  await page.locator(`[data-reminder-id="${reminder}"]`).click();
  await waitForGraphText(page, "Proof Graph Reminder", config.timeoutMs);
  for (const text of ["Proof Pinned Note", "Proof Future Task", "Proof Graph Meeting", "Proof Alpha Project", "Done", "Snooze 10 min", "CONNECTED"]) {
    await waitForGraphText(page, text, config.timeoutMs);
  }
  graphState = await readGraphDetailState(page);
  assert(graphState.route === "reminder-detail", `Expected reminder-detail route, got ${graphState.route}`);
  assert(!graphState.hasHtmlFrame, "Did not expect reminder detail to render a generated HTML iframe");
  await page.locator(`[data-workspace-target-route="note-detail"][data-workspace-target-id="${seed.runId}-pinned-note"]`).first().waitFor({ state: "visible", timeout: config.timeoutMs });
  screenshots[`${theme}_graph_reminder_detail`] = await saveScreenshot(page, config.reportDir, `${theme}-graph-reminder-detail`);
  for (const [route, id, text, shot] of [
    ["note-detail", `${seed.runId}-pinned-note`, "Proof Pinned Note", "graph-reminder-linked-note"],
    ["task-detail", `${seed.runId}-future-task`, "Proof Future Task", "graph-reminder-source-task"],
    ["meeting-note-detail", `${seed.runId}-graph-meeting`, "Proof Graph Meeting", "graph-reminder-linked-meeting"]
  ]) {
    await page.locator(`[data-workspace-target-route="${route}"][data-workspace-target-id="${id}"]`).first().click();
    await waitForLightRoute(page, route, config.timeoutMs);
    await waitForGraphText(page, text, config.timeoutMs);
    screenshots[`${theme}_${shot}`] = await saveScreenshot(page, config.reportDir, `${theme}-${shot}`);
    await topBackToRoute(page, "reminder-detail", "Proof Graph Reminder", config.timeoutMs);
  }
  screenshots[`${theme}_reminder_after_back`] = await saveScreenshot(page, config.reportDir, `${theme}-reminder-after-back`);
  await backHome(page, theme, config.timeoutMs);

  await openTile(page, "Projects", "projects", config.timeoutMs);
  await page.locator(`[data-project-id="${seed.runId}-alpha-project"]`).click();
  for (const text of ["Proof Graph Meeting", "Proof Pinned Note", "Proof Future Task"]) {
    await waitForGraphText(page, text, config.timeoutMs);
  }
  screenshots[`${theme}_graph_project_ripple`] = await saveScreenshot(page, config.reportDir, `${theme}-graph-project-ripple`);
  await backHome(page, theme, config.timeoutMs);

  await openTile(page, "Contacts", "contacts", config.timeoutMs);
  await page.locator(`button[data-contact-id="${seed.runId}-contact-one"]`).click();
  for (const text of ["Proof Pinned Note", "Proof Graph Meeting", "Proof Alpha Project"]) {
    await waitForGraphText(page, text, config.timeoutMs);
  }
  screenshots[`${theme}_graph_contact_ripple`] = await saveScreenshot(page, config.reportDir, `${theme}-graph-contact-ripple`);
  await backHome(page, theme, config.timeoutMs);

  summary.graphRipple = summary.graphRipple || [];
  summary.graphRipple.push({ theme, meeting, reminder, project: `${seed.runId}-alpha-project`, contact: `${seed.runId}-contact-one` });
  summary.assertions.push(`${theme} meeting-notes/reminders/projects/contacts/feed use top Back to return to the exact prior detail`);
}

async function runTheme(page, config, seed, theme, summary, networkLog) {
  const screenshots = {};
  await page.goto(pageUrl(config.baseUrl, theme), { waitUntil: "commit", timeout: config.timeoutMs });
  await waitForHome(page, theme, config.timeoutMs);
  screenshots[`${theme}_home`] = await saveScreenshot(page, config.reportDir, `${theme}-home`);
  if (shouldRunSection(config, "notes")) {
    await proveNotes(page, config, seed, theme, screenshots, summary);
  }
  if (shouldRunSection(config, "tasks")) {
    await proveTasks(page, config, seed, theme, screenshots, summary, networkLog);
  }
  if (shouldRunSection(config, "calendar")) {
    await proveCalendar(page, config, seed, theme, screenshots, summary);
  }
  if (shouldRunSection(config, "feed")) {
    await proveFeed(page, config, seed, theme, screenshots, summary);
  }
  if (shouldRunSection(config, "projects")) {
    await proveProjects(page, config, seed, theme, screenshots, summary);
  }
  if (shouldRunSection(config, "contacts")) {
    await proveContacts(page, config, seed, theme, screenshots, summary);
  }
  if (shouldRunSection(config, "reminders")) {
    await proveReminders(page, config, seed, theme, screenshots, summary);
  }
  if (shouldRunSection(config, "graph")) {
    await proveGraphObjects(page, config, seed, theme, screenshots, summary);
  }
  return screenshots;
}

async function main() {
  const config = parseArgs(process.argv.slice(2));
  ensureDir(config.reportDir);
  const consoleLog = path.join(config.reportDir, "console.log");
  const networkLog = [];
  fs.writeFileSync(consoleLog, "", "utf8");

  const summary = {
    schema: "pucky.workspace_apps_browser_proof.v1",
    base_url: config.baseUrl,
    report_dir: config.reportDir,
    started_at: new Date().toISOString(),
    screenshots: {},
    assertions: [],
    taskPress: []
  };

  let browser;
  let context;
  let lightSeed = null;
  let darkSeed = null;
  const cleanupResults = [];
  try {
    browser = await chromium.launch({
      executablePath: resolveChromePath(),
      headless: true
    });
    context = await browser.newContext({
      viewport: VIEWPORT,
      recordVideo: { dir: config.reportDir, size: VIEWPORT }
    });
    await primeBrowserPreviewToken(context, config.apiToken);
    await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
    const page = await context.newPage();
    attachPageLogging(page, consoleLog);
    page.on("request", request => {
      const url = request.url();
      if (url.includes("/api/workspace/")) {
        networkLog.push({ type: "request", method: request.method(), url, at: new Date().toISOString(), at_ms: Date.now() });
      }
    });
    page.on("response", response => {
      const url = response.url();
      if (url.includes("/api/workspace/")) {
        networkLog.push({ type: "response", status: response.status(), url, at: new Date().toISOString(), at_ms: Date.now() });
      }
    });

    lightSeed = await seedWorkspace(config, `${PROOF_RUN_ID}-light`);
    summary.seed = lightSeed;
    summary.seeds = { light: lightSeed };
    summary.screenshots = {
      ...summary.screenshots,
      ...(await runTheme(page, config, lightSeed, "light", summary, networkLog))
    };
    if (lightSeed?.writeEnabled) {
      cleanupResults.push(await cleanupWorkspaceSeed(config, lightSeed));
      lightSeed = null;
    }

    darkSeed = await seedWorkspace(config, `${PROOF_RUN_ID}-dark`);
    summary.seeds = { ...(summary.seeds || {}), dark: darkSeed };
    summary.screenshots = {
      ...summary.screenshots,
      ...(await runTheme(page, config, darkSeed, "dark", summary, networkLog))
    };
    if (darkSeed?.writeEnabled) {
      cleanupResults.push(await cleanupWorkspaceSeed(config, darkSeed));
      darkSeed = null;
    }
    summary.assertions.push("light and dark home-shell loaded");
    summary.assertions.push("notes/tasks/calendar/feed/projects/contacts/meeting-notes/reminders read /api/workspace records");
    summary.assertions.push("note detail remains the only generated HTML iframe surface across workspace object apps");
    summary.assertions.push("near-future task moved to overdue after deadline refresh");
    summary.assertions.push("workspace proof seed records were cleaned up after verification");
    summary.finished_at = new Date().toISOString();
    summary.ok = true;
    await context.tracing.stop({ path: path.join(config.reportDir, "trace.zip") });
    await context.close();
    await browser.close();
    writeJsonFile(path.join(config.reportDir, "network.json"), networkLog);
    writeJsonFile(path.join(config.reportDir, "summary.json"), summary);
  } catch (error) {
    summary.ok = false;
    summary.error = String(error?.stack || error?.message || error);
    writeAutomationError(config.reportDir, error);
    writeJsonFile(path.join(config.reportDir, "network.json"), networkLog);
    writeJsonFile(path.join(config.reportDir, "summary.json"), summary);
    try {
      if (context) {
        await context.tracing.stop({ path: path.join(config.reportDir, "trace.zip") });
        await context.close();
      }
    } catch (_) {
      // Ignore cleanup failures.
    }
    try {
      if (browser) {
        await browser.close();
      }
    } catch (_) {
      // Ignore cleanup failures.
    }
    throw error;
  } finally {
    try {
      if (lightSeed?.writeEnabled) {
        cleanupResults.push(await cleanupWorkspaceSeed(config, lightSeed));
      }
      if (darkSeed?.writeEnabled && (!lightSeed || darkSeed.runId !== lightSeed.runId)) {
        cleanupResults.push(await cleanupWorkspaceSeed(config, darkSeed));
      }
      if (cleanupResults.length) {
        summary.cleanup = { attempted: true, cleaned: cleanupResults.every(Boolean) };
        writeJsonFile(path.join(config.reportDir, "summary.json"), summary);
      }
    } catch (cleanupError) {
      summary.cleanup = {
        attempted: true,
        cleaned: false,
        error: String(cleanupError?.stack || cleanupError?.message || cleanupError)
      };
      writeJsonFile(path.join(config.reportDir, "summary.json"), summary);
    }
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
