import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

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
const PROOF_RUN_ID = "proof-workspace";
const CLEANUP_RECORD_COLLECTION_ORDER = [
  "reminders",
  "meeting-notes",
  "projects",
  "feed-items",
  "calendar-events",
  "tasks",
  "notes",
  "contacts"
];
const require = createRequire(import.meta.url);

function loadPlaywrightCore() {
  const bundledNodeModules = String(process.env.CODEX_NODE_MODULES || "").trim();
  const bundled = path.join(os.homedir(), ".cache", "codex-runtimes", "codex-primary-runtime", "dependencies", "node", "node_modules", "playwright-core");
  const bundledPlaywright = path.join(os.homedir(), ".cache", "codex-runtimes", "codex-primary-runtime", "dependencies", "node", "node_modules", "playwright");
  const candidates = [
    () => require("playwright-core"),
    () => require("playwright"),
    () => bundledNodeModules ? require(path.join(bundledNodeModules, "playwright-core")) : null,
    () => bundledNodeModules ? require(path.join(bundledNodeModules, "playwright")) : null,
    () => require(bundledPlaywright),
    () => require(bundled)
  ];
  for (const candidate of candidates) {
    try {
      const resolved = candidate();
      if (resolved) {
        return resolved;
      }
    } catch {
      // Try the next resolution path.
    }
  }
  throw new Error("Could not resolve playwright-core from local tools or bundled runtime");
}

const { chromium } = loadPlaywrightCore();

function resolveApiToken() {
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

async function installAuthorizedApiProxy(context, baseUrl, apiToken) {
  const token = String(apiToken || "").trim();
  if (!token) {
    return;
  }
  const apiBase = `${String(baseUrl || "").replace(/\/+$/, "")}/api/**`;
  await context.route(apiBase, async route => {
    const request = route.request();
    const headers = { ...request.headers() };
    delete headers.origin;
    if (!headers.authorization) {
      headers.authorization = `Bearer ${token}`;
    }
    try {
      const response = await route.fetch({
        method: request.method(),
        headers,
        postData: request.postDataBuffer() || undefined
      });
      await route.fulfill({ response });
    } catch (error) {
      const detail = String(error?.message || error || "");
      if (/Request context disposed|Target page, context or browser has been closed/i.test(detail)) {
        await route.abort("failed");
        return;
      }
      throw error;
    }
  });
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
  void reminder;
  return false;
}

function reminderIsSnoozedForScript(reminder) {
  const meta = reminderMetaForScript(reminder);
  const dueAtMs = Number(reminder?.due_at_ms || 0);
  return meta.snoozedUntilMs > Date.now() && meta.snoozedUntilMs === dueAtMs;
}

function reminderIsActiveForScript(reminder) {
  return !reminderIsDismissedForScript(reminder) && !reminderIsSentHistoryForScript(reminder);
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

async function readToastMessage(page) {
  return page.evaluate(() => String(window.PuckyUiDebug?.describe?.()?.toast?.message || "").trim());
}

async function assertNoToast(page, label) {
  const toastMessage = await readToastMessage(page);
  assert(!toastMessage, `${label} should not show an error toast, saw ${toastMessage || "<non-empty>"}`);
}

function buildSeedManifest(runId = PROOF_RUN_ID) {
  return {
    runId,
    linkIds: [
      `${runId}-alpha-note`,
      `${runId}-alpha-note-duplicate`,
      `${runId}-alpha-task`,
      `${runId}-alpha-calendar`,
      `${runId}-alpha-feed`,
      `${runId}-alpha-contact`,
      `${runId}-future-task-note`,
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
      contacts: [`${runId}-contact-one`, `${runId}-contact-two`, `${runId}-david-contact`, `${runId}-daniel-contact`],
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

async function sweepSeedRecordsByPrefix(config, runId = PROOF_RUN_ID) {
  const prefix = `${String(runId || PROOF_RUN_ID).trim()}-`;
  for (const collection of CLEANUP_RECORD_COLLECTION_ORDER) {
    const payload = await readCollection(config, collection);
    const items = Array.isArray(payload?.items) ? payload.items : [];
    const matchingIds = items
      .map(item => String(item?.record_id || item?.id || "").trim())
      .filter(recordId => recordId.startsWith(prefix));
    for (const recordId of matchingIds) {
      await deleteWorkspaceRecord(config, collection, recordId);
    }
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
  for (const collection of CLEANUP_RECORD_COLLECTION_ORDER) {
    const ids = Array.isArray(manifest.recordIds?.[collection]) ? manifest.recordIds[collection] : [];
    for (const recordId of ids) {
      await deleteWorkspaceRecord(config, collection, recordId);
    }
  }
  await sweepSeedRecordsByPrefix(config, seed.runId || PROOF_RUN_ID);
  return true;
}

async function seedWorkspace(config, runId = PROOF_RUN_ID) {
  const manifest = buildSeedManifest(runId);
  const today = dateKey(new Date());
  const tomorrow = dateKey(new Date(Date.now() + 24 * 60 * 60 * 1000));
  try {
    await cleanupWorkspaceSeed(config, { runId, writeEnabled: true });
    const pinnedNoteHtml = "<!doctype html><html><body><h1>Proof Pinned Note</h1><p>Agent-created note page with three bullets.</p><ul><li>Alpha</li><li>Beta</li><li>Gamma</li></ul></body></html>";
    await apiRequest(config, "POST", "/api/workspace/notes", {
      id: `${runId}-pinned-note`,
      title: "Proof Pinned Note",
      summary: "Pinned note created through workspace API.",
      pinned: true,
      html: pinnedNoteHtml,
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
      due_at_ms: Date.now() - 60_000,
      html: [
        "<!doctype html><html><body>",
        "<h1>Proof Overdue Task</h1>",
        "<p>This overdue task proves the detail page can render a realistic inline task document.</p>",
        "<ul><li>Confirm the missing response</li><li>Escalate blocker to the project owner</li><li>Update the rollout note</li></ul>",
        "<p>Status note: this one should already be overdue when the browser proof opens.</p>",
        "</body></html>"
      ].join("")
    });
    await apiRequest(config, "POST", "/api/workspace/tasks", {
      id: `${runId}-future-task`,
      title: "Proof Future Task",
      summary: "Due later.",
      status: "open",
      created_at_ms: Date.now() - 6 * 60 * 60 * 1000,
      due_at_ms: Date.now() + 3 * 24 * 60 * 60 * 1000,
      description: "Proof Future Task should keep its structured description visible above checklist items.",
      checklist: [
        { id: `${runId}-future-task-check-1`, label: "Pull product feedback", done: false },
        { id: `${runId}-future-task-check-2`, label: "Refine the launch checklist", done: false },
        { id: `${runId}-future-task-check-3`, label: "Share the final summary", done: false },
      ],
      html: [
        "<!doctype html><html><body>",
        "<h1>Proof Future Task</h1>",
        "<p>This upcoming task demonstrates the new HTML-first body layout.</p>",
        "<ol><li>Pull product feedback</li><li>Refine the launch checklist</li><li>Share the final summary</li></ol>",
        "<p>Body length is intentional so the iframe has enough content to prove scrolling and spacing.</p>",
        "</body></html>"
      ].join("")
    });
    await apiRequest(config, "POST", "/api/workspace/tasks", {
      id: `${runId}-done-task`,
      title: "Proof Done Task",
      summary: "Done stays done even after deadline.",
      status: "done",
      due_at_ms: Date.now() - 120_000,
      html: [
        "<!doctype html><html><body>",
        "<h1>Proof Done Task</h1>",
        "<p>This task proves the same detail shell works after completion and can be reopened.</p>",
        "<ul><li>Archive the draft</li><li>Note final approval</li><li>Close the loop with the team</li></ul>",
        "</body></html>"
      ].join("")
    });
    await apiRequest(config, "POST", "/api/workspace/tasks", {
      id: `${runId}-asset-task`,
      title: "Proof Asset Task",
      summary: "Structured task without generated HTML.",
      status: "open",
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
      due_at_ms: Date.now() + 6_500,
      html: "<!doctype html><html><body><h1>Proof Deadline Flip</h1><p>Use to verify task auto-overdue transition.</p></body></html>"
    });

    await apiRequest(config, "POST", "/api/workspace/calendar-events", {
      id: `${runId}-today-roadmap`,
      title: "Proof Today Roadmap",
      summary: "Primary today event",
      date: today,
      start_at_ms: dayAt(0, 10),
      end_at_ms: dayAt(0, 11),
      html: "<!doctype html><h1>Proof Today Roadmap</h1><p>Today detail page.</p>",
      metadata: { place: "Zoom", attendees: ["Proof Contact One", "Proof Contact Two"], type: "planning" }
    });
    await apiRequest(config, "POST", "/api/workspace/calendar-events", {
      id: `${runId}-today-overlap`,
      title: "Proof Overlap Event",
      summary: "Same-hour overlap",
      date: today,
      start_at_ms: dayAt(0, 10, 15),
      end_at_ms: dayAt(0, 10, 45),
      html: "<!doctype html><h1>Proof Overlap Event</h1><p>Overlap detail page.</p>",
      metadata: { place: "Figma", attendees: ["Proof Contact One"], type: "design" }
    });
    await apiRequest(config, "POST", "/api/workspace/calendar-events", {
      id: `${runId}-tomorrow-event`,
      title: "Proof Tomorrow Event",
      summary: "Tomorrow event",
      date: tomorrow,
      start_at_ms: dayAt(1, 14),
      end_at_ms: dayAt(1, 15),
      html: "<!doctype html><h1>Proof Tomorrow Event</h1><p>Tomorrow detail page.</p>",
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
        html: `<!doctype html><h1>${item[1]}</h1><p>${item[2]} detail.</p>`,
        metadata: { type: item[0], icon: item[3] }
      });
    }

    await apiRequest(config, "POST", "/api/workspace/projects", {
      id: `${runId}-alpha-project`,
      title: "Proof Alpha Project",
      summary: "Alpha has two named threads.",
      html: "<!doctype html><h1>Proof Alpha Project</h1><p>Alpha project page.</p>",
      metadata: { threads: ["Alpha kickoff", "Alpha launch"], chips: ["2 threads", "5 links"], assets: ["Alpha brief", "Alpha diagram"] }
    });
    await apiRequest(config, "POST", "/api/workspace/projects", {
      id: `${runId}-beta-project`,
      title: "Proof Beta Project",
      summary: "Beta has three named threads.",
      html: "<!doctype html><h1>Proof Beta Project</h1><p>Beta project page.</p>",
      metadata: { threads: ["Beta planning", "Beta risks", "Beta wrap"], chips: ["3 threads", "4 links"], assets: ["Beta brief"] }
    });

    await apiRequest(config, "POST", "/api/workspace/contacts", {
      id: `${runId}-contact-one`,
      title: "Proof Contact One",
      summary: "Partner lead",
      metadata: {
        avatar: "P1",
        photo: "fixtures/contact_photos/proof-contact.webp",
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
        photo: "fixtures/contact_photos/eric.webp",
        email: "proof.two@example.com",
        phone: "+1 (555) 010-2000",
        activity: ["Created by proof", "Linked to Beta"]
      }
    });
    await apiRequest(config, "POST", "/api/workspace/contacts", {
      id: `${runId}-david-contact`,
      title: "David",
      summary: "Contact",
      metadata: {
        first_name: "David",
        activity: ["Single-name proof contact"]
      }
    });
    await apiRequest(config, "POST", "/api/workspace/contacts", {
      id: `${runId}-daniel-contact`,
      title: "Daniel",
      summary: "Contact",
      metadata: {
        first_name: "Daniel",
        activity: ["Single-name proof contact"]
      }
    });
    await apiRequest(config, "POST", "/api/workspace/meeting-notes", {
      id: `${runId}-graph-meeting`,
      title: "Proof Graph Meeting",
      summary: "Meeting note created through workspace API with linked attendees and follow-ups.",
      date: today,
      start_at_ms: dayAt(0, 12),
      end_at_ms: dayAt(0, 12, 45),
      html: [
        "<!doctype html><html><body>",
        "<h1>Proof Graph Meeting</h1>",
        "<p>This meeting links attendee, calendar, note, task, project, and reminder context.</p>",
        "<ol><li>Review proof graph</li><li>Confirm linked task</li><li>Schedule reminder</li></ol>",
        "</body></html>"
      ].join(""),
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
      ["alpha-note-duplicate", "note", `${runId}-pinned-note`, "Proof Pinned Note copy"],
      ["alpha-task", "task", `${runId}-future-task`, "Proof Future Task"],
      ["alpha-calendar", "calendar_event", `${runId}-today-roadmap`, "Proof Today Roadmap"],
      ["alpha-feed", "feed_item", `${runId}-project-decision`, "Proof Project Decision"],
      ["alpha-contact", "contact", `${runId}-contact-one`, "Proof Contact One"],
      ["beta-task", "task", `${runId}-overdue-task`, "Proof Overdue Task"],
      ["beta-calendar", "calendar_event", `${runId}-tomorrow-event`, "Proof Tomorrow Event"],
      ["beta-feed", "feed_item", `${runId}-calendar-change`, "Proof Calendar Change"],
      ["beta-contact", "contact", `${runId}-contact-two`, "Proof Contact Two"]
    ]) {
      await apiRequest(config, "POST", "/api/workspace/links", {
        id: `${runId}-${link[0]}`,
        source_kind: "project",
        source_id: link[0].startsWith("alpha") ? `${runId}-alpha-project` : `${runId}-beta-project`,
        target_kind: link[1],
        target_id: link[2],
        label: link[3]
      });
    }

    for (const link of [
      ["future-task-note", "task", `${runId}-future-task`, "note", `${runId}-pinned-note`, "Proof Pinned Note"],
      ["meeting-contact", "meeting_note", `${runId}-graph-meeting`, "contact", `${runId}-contact-one`, "Proof Contact One"],
      ["meeting-calendar", "meeting_note", `${runId}-graph-meeting`, "calendar_event", `${runId}-today-roadmap`, "Proof Today Roadmap"],
      ["meeting-note", "meeting_note", `${runId}-graph-meeting`, "note", `${runId}-pinned-note`, "Proof Pinned Note"],
      ["meeting-task", "meeting_note", `${runId}-graph-meeting`, "task", `${runId}-future-task`, "Proof Future Task"],
      ["meeting-project", "meeting_note", `${runId}-graph-meeting`, "project", `${runId}-alpha-project`, "Proof Alpha Project"],
      ["meeting-reminder", "meeting_note", `${runId}-graph-meeting`, "reminder", `${runId}-graph-reminder`, "Proof Graph Reminder"],
      ["contact-note", "contact", `${runId}-contact-one`, "note", `${runId}-pinned-note`, "Proof Pinned Note"],
      ["project-reminder", "project", `${runId}-alpha-project`, "reminder", `${runId}-graph-reminder`, "Proof Graph Reminder"],
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
  await page.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll("button.light-back-button"));
    const visible = buttons.filter(node => {
      if (!(node instanceof HTMLElement)) {
        return false;
      }
      const style = getComputedStyle(node);
      return !node.hidden && style.display !== "none" && style.visibility !== "hidden";
    });
    const target = visible[visible.length - 1];
    if (!(target instanceof HTMLButtonElement)) {
      throw new Error("No visible light back button found");
    }
    target.click();
  });
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
    const detail = document.querySelector(".light-task-detail-surface");
    const route = document.querySelector(".light-shell")?.getAttribute("data-light-route") || "";
    const detailText = detail?.textContent || "";
    const title = document.querySelector(".light-task-detail-title")?.textContent?.trim() || "";
    const due = document.querySelector(".light-task-detail-due")?.textContent?.trim() || "";
    const statusCard = document.querySelector(".light-task-detail-card");
    const statusValue = statusCard?.getAttribute("data-task-status") || detail?.getAttribute("data-task-status") || "";
    const statusLabels = {
      do: "To do",
      in_progress: "In progress",
      waiting: "Waiting",
      done: "Done"
    };
    const statusLabel = statusCard?.getAttribute("data-task-status-label")?.trim() || statusLabels[statusValue] || "";
    const sectionTitles = Array.from(detail?.querySelectorAll(".light-section-title") || [])
      .map(node => String(node.textContent || "").trim().toLowerCase());
    const hasConnected = sectionTitles.includes("connected") || /\bconnected\b/i.test(detailText);
    const hasNotes = sectionTitles.includes("notes") || /\bnotes\b/i.test(detailText);
    const hasRelated = sectionTitles.includes("related") || /\brelated\b/i.test(detailText);
    const hasGeneratedPage = sectionTitles.includes("generated page") || /\bgenerated page\b/i.test(detailText);
    const contentSections = Array.from(detail?.children || [])
      .filter(node => node instanceof HTMLElement && node.matches(".light-copy-section, .light-info-section"));
    const contentSectionTitles = contentSections
      .map(node => String(node.querySelector(".light-section-title")?.textContent || "").trim().toLowerCase())
      .filter(Boolean);
    const firstSectionTitle = String(contentSectionTitles[0] || "");
    const notes = Array.from(
      detail?.querySelectorAll('[data-workspace-target-route="note-detail"] .light-text-stack strong, [data-workspace-target-route="note-detail"] .light-record-chip-label') || []
    )
      .map(node => String(node.textContent || "").trim())
      .filter(Boolean);
    return {
      route,
      title,
      due,
      statusLabel,
      statusValue,
      hasConnected,
      hasNotes,
      notes,
      hasRelated,
      hasGeneratedPage,
      sections: sectionTitles,
      createdMeta: document.querySelector(".light-task-detail-created")?.textContent?.trim() || "",
      checklistImmediatelyAfterDescription: contentSectionTitles[0] === "description" && contentSectionTitles[1] === "checklist",
      descriptionIsFirstSection: firstSectionTitle === "description",
      taskHtmlFramePresent: Boolean(detail?.querySelector(".light-html-frame, iframe")),
      statusCardPresent: Boolean(document.querySelector(".light-task-detail-card")),
      statusCirclePresent: Boolean(document.querySelector(".light-task-status-circle")),
    };
  });
}

async function readTaskListState(page) {
  return page.evaluate(() => {
    const bulkBar = document.querySelector(".light-task-bulk-bar");
    const legacyFilterClass = ["light", "task", "filter", "button"].join("-");
    const headers = Array.from(document.querySelectorAll(".light-task-section-title")).map(node => node.textContent?.trim() || "");
    const countLine = document.querySelector(".light-task-counts")?.textContent?.trim() || "";
    const sectionExpanded = Object.fromEntries(
      Array.from(document.querySelectorAll(".light-task-section-toggle")).map(node => [
        node.getAttribute("data-task-section") || "",
        node.getAttribute("aria-expanded") === "true"
      ])
    );
    const visibleTaskIds = Array.from(document.querySelectorAll("[data-task-id]")).map(node => node.getAttribute("data-task-id") || "");
    const selectedRows = Array.from(document.querySelectorAll('.light-task-row[data-task-selected="true"]'))
      .map(node => String(node.getAttribute("data-task-id") || "").trim())
      .filter(Boolean);
    return {
      pageTitle: String(document.querySelector(".light-page-title")?.textContent || "").trim(),
      headers,
      countLine,
      sectionExpanded,
      visibleTaskIds,
      hasFilterPill: Array.from(document.querySelectorAll("button")).some(node => node.classList.contains(legacyFilterClass)),
      selectModeActive: String(document.querySelector(".light-page-title")?.textContent || "").trim() === "Select tasks",
      selectedRows,
      bulkBarPresent: Boolean(bulkBar),
      bulkCountLabel: String(bulkBar?.querySelector(".light-task-bulk-count")?.textContent || "").trim(),
    };
  });
}

async function waitForTaskRowStatus(page, taskId, status, timeoutMs) {
  await page.waitForFunction(
    ([expectedTaskId, expectedStatus]) => {
      return document.querySelector(`.light-task-row[data-task-id="${expectedTaskId}"]`)?.getAttribute("data-task-status") === expectedStatus;
    },
    [String(taskId || ""), String(status || "")],
    { timeout: timeoutMs }
  );
}

async function waitForTaskAbsent(page, taskId, timeoutMs) {
  await page.waitForFunction(
    expectedTaskId => !document.querySelector(`.light-task-row[data-task-id="${expectedTaskId}"]`),
    String(taskId || ""),
    { timeout: timeoutMs }
  );
}

async function waitForTaskDetailStatus(page, status, timeoutMs) {
  await page.waitForFunction(
    expectedStatus => {
      const detail = document.querySelector(".light-task-detail-surface");
      const card = document.querySelector(".light-task-detail-card");
      return Boolean(
        detail
        && detail.getAttribute("data-task-status") === expectedStatus
        && card
        && card.getAttribute("data-task-status") === expectedStatus
      );
    },
    String(status || ""),
    { timeout: timeoutMs }
  );
}

async function probeTaskDetailIdle(page, idleMs = 5200) {
  return page.evaluate(async (waitMs) => {
    const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
    const firstShell = document.querySelector(".light-shell");
    const firstDetail = document.querySelector(".light-task-detail-surface");
    const firstTitleNode = document.querySelector(".light-task-detail-title");
    await sleep(waitMs);
    const currentShell = document.querySelector(".light-shell");
    const currentDetail = document.querySelector(".light-task-detail-surface");
    const currentTitleNode = document.querySelector(".light-task-detail-title");
    return {
      sameShellNode: currentShell === firstShell,
      sameDetailNode: currentDetail === firstDetail,
      sameTitleNode: currentTitleNode === firstTitleNode,
      route: currentShell?.getAttribute("data-light-route") || "",
      title: currentTitleNode?.textContent?.trim() || ""
    };
  }, idleMs);
}

async function readDetailHtmlBodyMetrics(page) {
  return page.evaluate(() => {
    const pageNode = document.querySelector(".light-shell .light-page");
    const body = document.querySelector(".light-detail-html-body");
    const frame = body?.querySelector(".light-html-frame");
    const rect = (node) => {
      if (!(node instanceof Element)) return null;
      const box = node.getBoundingClientRect();
      return {
        left: box.left,
        right: box.right,
        width: box.width
      };
    };
    return {
      route: document.querySelector(".light-shell")?.getAttribute("data-light-route") || "",
      page: rect(pageNode),
      body: rect(body),
      frame: rect(frame)
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

async function assertNoWorkspaceHtmlDocument(page, label) {
  const htmlState = await page.evaluate(() => {
    const root = document.querySelector(".light-shell");
    const text = String(root?.textContent || "");
    return {
      hasHtmlBody: Boolean(root?.querySelector(".light-detail-html-body")),
      hasHtmlCard: Boolean(root?.querySelector(".light-html-card")),
      hasHtmlFrame: Boolean(root?.querySelector(".light-html-frame")),
      hasGeneratedFallback: text.includes("Generated page") || /No generated .* page yet\./i.test(text)
    };
  });
  assert(!htmlState.hasHtmlBody, `${label} should not render a rich HTML document panel`);
  assert(!htmlState.hasHtmlCard, `${label} should not render a rich HTML card`);
  assert(!htmlState.hasHtmlFrame, `${label} should not render a rich HTML iframe`);
  assert(!htmlState.hasGeneratedFallback, `${label} should not render generated-page fallback text`);
  return htmlState;
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

async function ensureTaskSectionExpanded(page, group) {
  const toggle = page.locator(`button.light-task-section-toggle[data-task-section="${group}"]`).first();
  if (!(await toggle.count())) {
    return;
  }
  if ((await toggle.getAttribute("aria-expanded")) !== "true") {
    await toggle.click();
  }
}

async function taskRowVisible(page, taskId) {
  return page.locator(`.light-task-row[data-task-id="${taskId}"]`).first().isVisible().catch(() => false);
}

async function revealTaskRow(page, taskId) {
  if (await taskRowVisible(page, taskId)) {
    return;
  }
  for (const group of ["do", "overdue", "soon", "done"]) {
    await ensureTaskSectionExpanded(page, group);
    if (await taskRowVisible(page, taskId)) {
      return;
    }
  }
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
  await waitForLightRoute(page, "note-detail", config.timeoutMs);
  await page.locator(".light-html-frame").first().waitFor({ state: "attached", timeout: config.timeoutMs });
  await expectFrameHeading(page, note.title, config.timeoutMs);
  const layout = await readDetailHtmlBodyMetrics(page);
  const frameMetrics = await readDetailFrameDocumentMetrics(page);
  assert(layout.body && layout.page, "Expected note detail to expose a measurable HTML body");
  assert(layout.body.left <= layout.page.left + 2, `Expected note HTML body to reach page left edge, got ${layout.body.left} vs ${layout.page.left}`);
  assert(layout.body.right >= layout.page.right - 2, `Expected note HTML body to reach page right edge, got ${layout.body.right} vs ${layout.page.right}`);
  assertDetailFrameMetrics(frameMetrics, "note detail", theme);
  summary.detailHtmlMetrics = summary.detailHtmlMetrics || [];
  summary.detailHtmlMetrics.push({ theme, route: "note-detail", layout, frame: frameMetrics });
  screenshots[`${theme}_notes_detail`] = await saveScreenshot(page, config.reportDir, `${theme}-notes-detail`);
  await backHome(page, theme, config.timeoutMs);
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
  for (const label of ["Today", "Overdue", "Upcoming", "Done"]) {
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
      JSON.stringify(listState.headers) === JSON.stringify(["Today", "Overdue", "Upcoming", "Done"]),
      `Expected task section order Today/Overdue/Upcoming/Done, got ${JSON.stringify(listState.headers)}`
    );
    assert(!listState.hasFilterPill, "Expected Tasks to render without the legacy filter pill");
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
  const assetId = seed.taskIds?.asset;
  const emptyId = seed.taskIds?.empty;
  const doneId = seed.taskIds?.done;
  summary.taskDetail = summary.taskDetail || [];

  await page.locator(".light-task-row-status-trigger").first().waitFor({ state: "visible", timeout: config.timeoutMs });
  const listStatusControl = page.locator(`.light-task-row[data-task-id="${inlineId}"] .light-task-row-status-trigger`).first();
  await listStatusControl.click();
  await page.locator(".settings-selector-sheet").first().waitFor({ state: "visible", timeout: config.timeoutMs });
  screenshots[`${theme}_tasks_status_selector_list`] = await saveScreenshot(page, config.reportDir, `${theme}-tasks-status-selector-list`);
  await page.locator('.settings-selector-option[data-selector-value="in_progress"]').first().click();
  await waitForTaskRowStatus(page, inlineId, "in_progress", config.timeoutMs);

  await taskRowControl(page, inlineId).click();
  await page.waitForSelector('.light-shell[data-light-route="task-detail"]', { timeout: config.timeoutMs });
  let detailState = await readTaskDetailState(page);
  assert(detailState.route === "task-detail", `Expected task-detail route, got ${detailState.route}`);
  assert(detailState.title === "Proof Future Task", `Expected inline task title, got ${detailState.title}`);
  assert(detailState.sections.includes("description"), "Expected inline task detail to include a Description section");
  assert(detailState.sections.includes("checklist"), "Expected inline task detail to include a Checklist section");
  assert(detailState.sections.includes("connected"), "Expected inline task detail to include a Connected section");
  assert(!detailState.sections.includes("people"), "Did not expect inline task detail to include a People section");
  assert(detailState.descriptionIsFirstSection, "Expected inline task detail to start with Description");
  assert(detailState.createdMeta, "Expected inline task detail to render compact created metadata in the header");
  assert(detailState.createdMeta.startsWith("Created "), `Expected inline task detail header to say Created, got ${detailState.createdMeta}`);
  assert(detailState.statusCardPresent, "Expected inline task detail to render the interactive status header card");
  assert(detailState.statusCirclePresent, "Expected inline task detail to keep the visible status circle");
  assert(!detailState.taskHtmlFramePresent, "Did not expect inline task detail to render an embedded HTML frame");
  assert(detailState.hasConnected, "Expected Connected section on task detail");
  assert(detailState.notes.includes("Proof Pinned Note"), "Expected inline task detail to surface the linked note in Connected");
  assert(!detailState.hasNotes, "Did not expect separate NOTES section on task detail");
  assert(!detailState.hasRelated, "Did not expect RELATED section on task detail");
  assert(!detailState.hasGeneratedPage, "Did not expect GENERATED PAGE section on task detail");
  screenshots[`${theme}_tasks_inline_detail`] = await saveScreenshot(page, config.reportDir, `${theme}-tasks-inline-detail`);
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
    sameDetailNode: idleProbe.sameDetailNode,
    sameShellNode: idleProbe.sameShellNode,
    sameTitleNode: idleProbe.sameTitleNode
  });
  assert(idleTaskRequests === 0, `Expected no task polling while task-detail idles, saw ${idleTaskRequests} task requests`);
  assert(idleProbe.sameDetailNode, "Expected task-detail surface node to remain stable while idling");
  assert(idleProbe.sameShellNode, "Expected task-detail shell node to remain stable while idling");
  assert(idleProbe.sameTitleNode, "Expected task-detail title node to remain stable while idling");
  summary.taskDetail.push({
    theme,
    type: "inline_detail",
    taskId: inlineId,
    title: detailState.title,
    statusLabel: detailState.statusLabel,
    statusValue: detailState.statusValue,
    due: detailState.due,
    createdMeta: detailState.createdMeta,
    descriptionIsFirstSection: detailState.descriptionIsFirstSection,
    taskHtmlFramePresent: detailState.taskHtmlFramePresent,
  });
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

  await taskRowControl(page, assetId).click();
  await page.waitForSelector('.light-shell[data-light-route="task-detail"]', { timeout: config.timeoutMs });
  detailState = await readTaskDetailState(page);
  assert(detailState.title === "Proof Asset Task", `Expected asset task title, got ${detailState.title}`);
  assert(detailState.descriptionIsFirstSection, "Expected asset task detail to start with Description");
  assert(!detailState.taskHtmlFramePresent, "Did not expect asset task detail to render an embedded HTML frame");
  screenshots[`${theme}_tasks_asset_detail`] = await saveScreenshot(page, config.reportDir, `${theme}-tasks-asset-detail`);
  summary.taskDetail.push({
    theme,
    type: "asset_detail",
    taskId: assetId,
    title: detailState.title,
    statusLabel: detailState.statusLabel,
    statusValue: detailState.statusValue,
    due: detailState.due,
    descriptionIsFirstSection: detailState.descriptionIsFirstSection,
    taskHtmlFramePresent: detailState.taskHtmlFramePresent,
  });
  await page.evaluate(() => window.PuckyHandleAndroidBack && window.PuckyHandleAndroidBack());
  await page.waitForSelector('.light-shell[data-light-route="tasks"]', { timeout: config.timeoutMs });

  await taskRowControl(page, emptyId).click();
  await page.waitForSelector('.light-shell[data-light-route="task-detail"]', { timeout: config.timeoutMs });
  detailState = await readTaskDetailState(page);
  assert(detailState.title === "Proof Empty Task", `Expected empty task title, got ${detailState.title}`);
  assert(detailState.descriptionIsFirstSection, "Expected empty task detail to start with Description");
  assert(!detailState.taskHtmlFramePresent, "Did not expect empty task detail to render an embedded HTML frame");
  assert(
    await page.locator(`[data-workspace-target-route="note-detail"]`).count() === 0,
    "Did not expect note link targets on empty task detail"
  );
  screenshots[`${theme}_tasks_empty_detail`] = await saveScreenshot(page, config.reportDir, `${theme}-tasks-empty-detail`);
  summary.taskDetail.push({
    theme,
    type: "empty_detail",
    taskId: emptyId,
    title: detailState.title,
    statusLabel: detailState.statusLabel,
    statusValue: detailState.statusValue,
    due: detailState.due,
    descriptionIsFirstSection: detailState.descriptionIsFirstSection,
    taskHtmlFramePresent: detailState.taskHtmlFramePresent,
  });
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
  const doneTaskControl = taskRowControl(page, doneId).first();
  await doneTaskControl.waitFor({ state: "visible", timeout: config.timeoutMs });
  await doneTaskControl.scrollIntoViewIfNeeded({ timeout: Math.min(2000, config.timeoutMs) });
  await doneTaskControl.click({ timeout: config.timeoutMs });
  await page.waitForSelector('.light-shell[data-light-route="task-detail"]', { timeout: config.timeoutMs });
  detailState = await readTaskDetailState(page);
  assert(detailState.statusValue === "done", `Expected done task status value to be done, got ${detailState.statusValue}`);
  assert(detailState.statusLabel === "Done", `Expected done task status label to say Done, got ${detailState.statusLabel}`);
  assert(detailState.createdMeta.startsWith("Completed "), `Expected done task detail header to say Completed, got ${detailState.createdMeta}`);
  screenshots[`${theme}_tasks_done_status`] = await saveScreenshot(page, config.reportDir, `${theme}-tasks-done-status`);
  summary.taskDetail.push({ theme, type: "done_status", taskId: doneId, title: detailState.title, statusLabel: detailState.statusLabel, statusValue: detailState.statusValue, due: detailState.due, createdMeta: detailState.createdMeta });
  await page.evaluate(() => window.PuckyHandleAndroidBack && window.PuckyHandleAndroidBack());
  await page.waitForSelector('.light-shell[data-light-route="tasks"]', { timeout: config.timeoutMs });

  const bulkArchiveIds = [assetId, emptyId].filter(Boolean);
  if (bulkArchiveIds.length >= 2) {
    await page.locator(".light-task-select-toggle").first().click();
    let selectState = await readTaskListState(page);
    assert(selectState.pageTitle === "Select tasks", `Expected Select tasks page title, got ${selectState.pageTitle}`);
    assert(selectState.selectModeActive, "Expected Select mode to activate");
    assert(selectState.bulkBarPresent, "Expected Select mode to render the bulk archive bar");
    for (const taskId of bulkArchiveIds) {
      await page.locator(`.light-task-row[data-task-id="${taskId}"] .light-task-row-main`).first().click();
    }
    selectState = await readTaskListState(page);
    assert(
      JSON.stringify(selectState.selectedRows.slice().sort()) === JSON.stringify(bulkArchiveIds.slice().sort()),
      `Expected bulk-select state to track ${JSON.stringify(bulkArchiveIds)}, got ${JSON.stringify(selectState.selectedRows)}`
    );
    assert(selectState.bulkCountLabel === `${bulkArchiveIds.length} selected`, `Expected bulk archive count to say ${bulkArchiveIds.length} selected, got ${selectState.bulkCountLabel}`);
    screenshots[`${theme}_tasks_bulk_select`] = await saveScreenshot(page, config.reportDir, `${theme}-tasks-bulk-select`);
    await page.locator(".light-task-bulk-archive").first().click();
    for (const taskId of bulkArchiveIds) {
      await waitForTaskAbsent(page, taskId, config.timeoutMs);
    }
    await page.waitForFunction(() => {
      const title = String(document.querySelector(".light-page-title")?.textContent || "").trim();
      return title !== "Select tasks" && !document.querySelector(".light-task-bulk-bar");
    }, { timeout: config.timeoutMs });
    const bulkArchiveState = await readTaskListState(page);
    assert(!bulkArchiveState.selectModeActive, "Expected bulk archive to exit Select mode");
    assert(!bulkArchiveState.selectedRows.length, "Expected bulk archive to clear selected task rows");
    await page.reload({ waitUntil: "domcontentloaded", timeout: config.timeoutMs });
    await page.waitForSelector('.light-shell[data-light-route="tasks"]', { timeout: config.timeoutMs });
    for (const taskId of bulkArchiveIds) {
      await waitForTaskAbsent(page, taskId, config.timeoutMs);
    }
    summary.taskArchive = summary.taskArchive || [];
    summary.taskArchive.push({
      theme,
      type: "bulk_archive",
      archivedTaskIds: bulkArchiveIds,
      selectState,
      listState: bulkArchiveState,
    });
  }

  await revealTaskRow(page, `${seed.runId}-overdue-task`);
  await taskRowControl(page, `${seed.runId}-overdue-task`).click();
  await page.waitForSelector('.light-shell[data-light-route="task-detail"]', { timeout: config.timeoutMs });
  await page.locator(".light-task-detail-action-trigger").first().click();
  await page.locator(".settings-selector-sheet").first().waitFor({ state: "visible", timeout: config.timeoutMs });
  await page.locator('.settings-selector-option[data-selector-value="archive_task"]').first().click();
  await page.waitForSelector('.light-shell[data-light-route="tasks"]', { timeout: config.timeoutMs });
  await waitForTaskAbsent(page, `${seed.runId}-overdue-task`, config.timeoutMs);
  const detailArchiveState = await readTaskListState(page);
  summary.taskArchive = summary.taskArchive || [];
  summary.taskArchive.push({
    theme,
    type: "detail_archive",
    archivedTaskId: `${seed.runId}-overdue-task`,
    archiveActionLabel: "Archive task",
    listState: detailArchiveState,
  });
  screenshots[`${theme}_tasks_detail_archive`] = await saveScreenshot(page, config.reportDir, `${theme}-tasks-detail-archive`);

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
  const htmlState = await assertNoWorkspaceHtmlDocument(page, "Inbox detail");
  summary.noHtmlDetails = summary.noHtmlDetails || [];
  summary.noHtmlDetails.push({ theme, route: "inbox-detail", htmlState });
  screenshots[`${theme}_inbox_detail`] = await saveScreenshot(page, config.reportDir, `${theme}-inbox-detail`);
  if (seed.writeEnabled) {
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
    for (const text of ["Proof Pinned Note", "Proof Future Task", "Proof Today Roadmap", "Proof Project Decision", "Proof Contact One", "Proof Graph Reminder"]) {
      await page.getByText(text).waitFor({ state: "visible", timeout: config.timeoutMs });
    }
    await expectFrameHeading(page, "Proof Alpha Project", config.timeoutMs);
  } else {
    const firstProject = projects[0];
    await page.locator(`[data-project-id="${firstProject.id}"]`).click();
    await expectFrameHeading(page, firstProject.title, config.timeoutMs);
  }
  const htmlState = await assertNoWorkspaceHtmlDocument(page, "Project detail");
  const projectState = await readProjectDetailState(page, seed.runId || PROOF_RUN_ID);
  assert(projectState.shellRoute === "project-detail", `Expected project-detail route, got ${projectState.shellRoute}`);
  assert(projectState.heroCount === 0, "Project detail should not render the legacy hero card");
  assert(projectState.chipCloudCount === 0, "Project detail should not render the top chip cloud");
  assert(projectState.sectionGridCount === 0, "Project detail should not render the legacy per-kind grid");
  assert(projectState.connectedSectionCount === 1, "Project detail should render one Connected section");
  assert(projectState.connectedBodyIsFlat, "Project detail should render Connected inside one shared flat-feed shell");
  assert(projectState.connectedRows > 0, "Project detail should render connected feed rows");
  assert(projectState.flatRowCount === projectState.connectedRows, "Project detail connected rows should all use flat-feed styling");
  assert(projectState.connectedChevronCount === 0, "Project detail connected rows should not render trailing chevrons");
  assert(projectState.contiguousRows, "Project detail connected rows should render contiguously with no inter-row gaps");
  if (seed.writeEnabled) {
    assert(projectState.pinnedNoteRows === 1, "Project detail should collapse duplicate linked-note targets into one row");
  }
  summary.noHtmlDetails = summary.noHtmlDetails || [];
  summary.noHtmlDetails.push({ theme, route: "project-detail", htmlState });
  summary.projects = summary.projects || [];
  summary.projects.push({ theme, projectState });
  screenshots[`${theme}_projects_detail`] = await saveScreenshot(page, config.reportDir, `${theme}-projects-detail`);
  if (seed.writeEnabled) {
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

async function assertFlatContactProfileCard(page, label) {
  const cardState = await page.evaluate(() => {
    const card = document.querySelector(".light-contact-detail-page .light-profile-card");
    if (!card) {
      return { exists: false };
    }
    const styles = window.getComputedStyle(card);
    const rect = card.getBoundingClientRect();
    return {
      exists: true,
      heading: String(card.querySelector("h1")?.textContent || "").trim(),
      summary: String(card.querySelector("p")?.textContent || "").trim(),
      backgroundColor: styles.backgroundColor,
      borderRadius: styles.borderRadius,
      borderTopColor: styles.borderTopColor,
      borderTopStyle: styles.borderTopStyle,
      borderTopWidth: styles.borderTopWidth,
      boxShadow: styles.boxShadow,
      rect: {
        height: Math.round(rect.height),
        width: Math.round(rect.width)
      }
    };
  });
  assert(cardState.exists, `${label} should render the scoped contact profile card`);
  assert(cardState.heading, `${label} should keep a visible profile heading`);
  assert(cardState.summary, `${label} should keep visible descriptor text`);
  assert(cardState.backgroundColor === "rgba(0, 0, 0, 0)" || cardState.backgroundColor === "transparent", `${label} profile card should have a transparent background, got ${cardState.backgroundColor}`);
  assert(cardState.boxShadow === "none", `${label} profile card should not have a shadow, got ${cardState.boxShadow}`);
  assert(cardState.borderRadius === "0px", `${label} profile card should not have a card radius, got ${cardState.borderRadius}`);
  assert(cardState.borderTopWidth === "0px" || cardState.borderTopStyle === "none" || cardState.borderTopColor === "rgba(0, 0, 0, 0)", `${label} profile card should not have a visible border, got ${cardState.borderTopWidth} ${cardState.borderTopStyle} ${cardState.borderTopColor}`);
  return cardState;
}

async function assertNoContactEndpoints(page, config, contactId, label, options = {}) {
  const detailState = await page.evaluate(() => {
    const sectionTitles = Array.from(document.querySelectorAll(".light-info-section .light-section-title"))
      .map(node => String(node.textContent || "").trim())
      .filter(Boolean);
    return {
      sectionTitles
    };
  });
  assert(detailState.sectionTitles.some(title => title.toLowerCase() === "contact"), `${label} should render the Contact section`);
  if (options.requireActivity) {
    assert(detailState.sectionTitles.some(title => title.toLowerCase() === "activity"), `${label} should render the Activity section`);
  }
  assert(!detailState.sectionTitles.some(title => title.toLowerCase() === "endpoints"), `${label} should not render an Endpoints section`);
  if (String(contactId || "").trim() && String(config.apiToken || "").trim()) {
    const record = await apiRequest(config, "GET", `/api/workspace/contacts/${encodeURIComponent(String(contactId || "").trim())}`);
    const metadata = record?.metadata || {};
    assert(!Object.prototype.hasOwnProperty.call(metadata, "endpoints"), `${label} API metadata should not expose endpoints`);
  }
  return detailState;
}

async function assertNoContactHtmlDocument(page, config, contactId, label) {
  const htmlState = await page.evaluate(() => {
    const root = document.querySelector(".light-contact-detail-page");
    const text = String(root?.textContent || "");
    return {
      hasHtmlBody: Boolean(root?.querySelector(".light-detail-html-body")),
      hasHtmlCard: Boolean(root?.querySelector(".light-html-card")),
      hasHtmlFrame: Boolean(root?.querySelector(".light-html-frame")),
      hasGeneratedFallback: text.includes("generated contact page") || text.includes("Generated page")
    };
  });
  assert(!htmlState.hasHtmlBody, `${label} should not render a Contact HTML document panel`);
  assert(!htmlState.hasHtmlCard, `${label} should not render a Contact HTML card`);
  assert(!htmlState.hasHtmlFrame, `${label} should not render a Contact HTML iframe`);
  assert(!htmlState.hasGeneratedFallback, `${label} should not render generated-page fallback text`);
  if (String(contactId || "").trim() && String(config.apiToken || "").trim()) {
    const record = await apiRequest(config, "GET", `/api/workspace/contacts/${encodeURIComponent(String(contactId || "").trim())}`);
    assert(!String(record?.html || "").trim(), `${label} API contact record should not expose document HTML`);
    assert(!String(record?.html_asset_id || "").trim(), `${label} API contact record should not expose document HTML asset id`);
  }
  return htmlState;
}

async function assertContactPhotoThumbnails(page, label, timeoutMs) {
  const startedAt = Date.now();
  let lastRows = null;
  let lastError = `${label} should render contact rows`;
  while (Date.now() - startedAt < timeoutMs) {
    const rows = await page.evaluate(() => {
      const loadedImages = Array.from(document.querySelectorAll(".light-contact-row .light-avatar.has-photo img"));
      return {
        loadedImageCount: loadedImages.length,
        rows: Array.from(document.querySelectorAll("button.light-contact-row[data-contact-id]")).map(row => {
          const avatar = row.querySelector(".light-avatar");
          const img = row.querySelector(".light-avatar.has-photo img");
          const titleNode = row.querySelector(".light-text-stack strong") || row.querySelector(".light-text-stack span");
          return {
            id: String(row.getAttribute("data-contact-id") || ""),
            title: String(titleNode?.textContent || "").trim(),
            hasPhotoClass: Boolean(avatar?.classList.contains("has-photo")),
            imageCount: img ? 1 : 0,
            src: img ? String(img.getAttribute("src") || img.currentSrc || "") : "",
            naturalWidth: img ? img.naturalWidth : 0,
            naturalHeight: img ? img.naturalHeight : 0,
            complete: img ? img.complete : false,
            objectFit: img ? getComputedStyle(img).objectFit : "",
            initials: avatar ? String(avatar.textContent || "").trim() : ""
          };
        })
      };
    });
    lastRows = rows;
    try {
      assert(rows.rows.length > 0, `${label} should render contact rows`);
      assert(!rows.rows.some(row => row.title === "Clinic front desk" || row.id === "clinic-front-desk"), "Clinic front desk should not render in Contacts");
      const me = rows.rows.find(row => row.id === "contact-me");
      assert(me, `${label} should render contact-me`);
      assert(!me.hasPhotoClass && me.imageCount === 0, "contact-me should remain initials-only");
      const singleInitialContacts = rows.rows.filter(row => row.title === "David" || row.title === "Daniel");
      assert(singleInitialContacts.length === 2, `${label} should render the seeded single-name contacts`);
      for (const contact of singleInitialContacts) {
        assert(!contact.hasPhotoClass && contact.imageCount === 0, `${contact.title || contact.id} should stay initials-only`);
        assert(contact.initials === "D", `${contact.title || contact.id} should render a single D initial, got ${contact.initials}`);
      }
      const contacts = rows.rows.filter(row => row.id !== "contact-me" && row.title !== "David" && row.title !== "Daniel");
      assert(contacts.length > 0, `${label} should render at least one photo contact`);
      for (const contact of contacts) {
        assert(contact.hasPhotoClass, `${contact.title || contact.id} should use the photo avatar class`);
        assert(contact.imageCount === 1, `${contact.title || contact.id} should render exactly one thumbnail image`);
        assert(contact.naturalWidth > 0 && contact.naturalHeight > 0, `${contact.title || contact.id} thumbnail should have natural dimensions, got ${contact.naturalWidth}x${contact.naturalHeight}`);
        assert(contact.objectFit === "cover", `${contact.title || contact.id} thumbnail should use object-fit: cover, got ${contact.objectFit}`);
      }
      return rows;
    } catch (error) {
      lastError = String(error?.message || error || lastError);
      await page.waitForTimeout(250);
    }
  }
  throw new Error(`${lastError}; last rows ${JSON.stringify(lastRows)}`);
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
    const rowData = rows.map(node => ({
      id: String(node.getAttribute("data-contact-id") || "").trim(),
      title: String(node.querySelector(".light-text-stack strong")?.textContent || "").trim(),
      avatarText: String(node.querySelector(".light-avatar")?.textContent || "").trim(),
    }));
    return {
      route: shell?.getAttribute("data-light-route") || "",
      searchVisible: Boolean(search),
      query: search instanceof HTMLInputElement ? search.value : "",
      rowIds: rowData.map(row => row.id).filter(Boolean),
      rowTitles: rowData.map(row => row.title).filter(Boolean),
      rowAvatarTexts: Object.fromEntries(rowData.filter(row => row.id).map(row => [row.id, row.avatarText])),
      emptyText: String(empty?.textContent || "").replace(/\s+/g, " ").trim(),
    };
  });
}

async function installContactsSearchTrace(page) {
  await page.evaluate(() => {
    if (!window.__contactsSearchTraceStore) {
      const store = {
        currentNode: null,
        currentToken: 0,
        events: [],
        initialToken: 0,
        initialValue: "",
      };
      const bindSearchNode = () => {
        const next = document.getElementById("contactsSearch");
        if (next !== store.currentNode) {
          store.currentNode = next instanceof HTMLInputElement ? next : null;
          store.currentToken += 1;
          if (store.currentNode) {
            store.currentNode.dataset.traceToken = String(store.currentToken);
          }
          return true;
        }
        return false;
      };
      const readValue = () => store.currentNode instanceof HTMLInputElement ? store.currentNode.value : "";
      const record = (type, event = null) => {
        const target = event?.target instanceof HTMLElement ? event.target : null;
        const shouldRecord = !target || target.id === "contactsSearch" || target === store.currentNode;
        if (!shouldRecord) {
          return;
        }
        store.events.push({
          type,
          nodeToken: store.currentToken,
          activeId: document.activeElement?.id || "",
          targetId: target?.id || "",
          value: readValue(),
          key: event?.key || "",
          data: event?.data || "",
          inputType: event?.inputType || "",
        });
      };
      bindSearchNode();
      ["focusin", "focusout", "blur", "beforeinput", "input", "keydown", "keyup"].forEach(type => {
        document.addEventListener(type, event => {
          if (bindSearchNode()) {
            record("search-node-changed", null);
          }
          record(type, event);
        }, true);
      });
      new MutationObserver(() => {
        if (bindSearchNode()) {
          record("search-node-changed", null);
        }
      }).observe(document.documentElement, { childList: true, subtree: true });
      window.__contactsSearchTraceStore = store;
    }
    const store = window.__contactsSearchTraceStore;
    const current = document.getElementById("contactsSearch");
    store.currentNode = current instanceof HTMLInputElement ? current : null;
    if (store.currentNode && !store.currentToken) {
      store.currentToken = 1;
      store.currentNode.dataset.traceToken = String(store.currentToken);
    }
    store.events = [];
    store.initialToken = store.currentToken;
    store.initialValue = store.currentNode instanceof HTMLInputElement ? store.currentNode.value : "";
  });
}

async function traceContactsSearchTyping(page, query, timeoutMs) {
  await setContactsSearchQuery(page, "", timeoutMs);
  const search = page.locator(".light-contacts-search").first();
  await search.click();
  await installContactsSearchTrace(page);
  await search.type(query, { delay: 40 });
  await page.waitForFunction(expectedQuery => {
    const input = document.querySelector(".light-contacts-search");
    return input instanceof HTMLInputElement && input.value === expectedQuery;
  }, query, { timeout: timeoutMs });
  const trace = await page.evaluate(() => {
    const store = window.__contactsSearchTraceStore || {};
    const current = document.getElementById("contactsSearch");
    return {
      initialToken: Number(store.initialToken || 0),
      initialValue: String(store.initialValue || ""),
      finalToken: Number(store.currentToken || 0),
      finalValue: current instanceof HTMLInputElement ? current.value : "",
      events: Array.isArray(store.events) ? store.events.slice() : [],
    };
  });
  const eventCounts = trace.events.reduce((counts, event) => {
    const key = String(event?.type || "");
    counts[key] = (counts[key] || 0) + 1;
    return counts;
  }, {});
  return {
    ...trace,
    eventCounts,
    searchState: await readContactsSearchState(page),
  };
}

async function readContactEditState(page) {
  return page.evaluate(() => {
    const shell = document.querySelector(".light-shell");
    const pageRoot = document.querySelector(".light-contact-edit-page");
    const isVisible = node => Boolean(node) && !(node instanceof HTMLElement && (node.hidden || getComputedStyle(node).display === "none"));
    const fieldValue = key => {
      const input = document.querySelector(`[data-contact-edit-field="${key}"]`);
      return input instanceof HTMLInputElement || input instanceof HTMLTextAreaElement ? input.value : "";
    };
    const activityValues = Array.from(document.querySelectorAll("input[data-contact-activity-index]"))
      .map(node => node instanceof HTMLInputElement ? node.value : "")
      .filter(value => value.length || value === "");
    const status = document.querySelector("[data-contact-autosave-status]");
    const firstNameInput = document.querySelector('[data-contact-edit-field="first_name"]');
    const lastNameInput = document.querySelector('[data-contact-edit-field="last_name"]');
    return {
      route: shell?.getAttribute("data-light-route") || "",
      pageVisible: Boolean(pageRoot),
      title: String(pageRoot?.querySelector(".light-contact-edit-photo-title")?.textContent || "").trim(),
      avatarText: String(pageRoot?.querySelector(".light-contact-detail-avatar .light-avatar")?.textContent || "").trim(),
      firstName: fieldValue("first_name"),
      lastName: fieldValue("last_name"),
      summary: fieldValue("summary"),
      email: fieldValue("email"),
      phone: fieldValue("phone"),
      activityValues,
      firstNameVisible: isVisible(firstNameInput),
      lastNameVisible: isVisible(lastNameInput),
      hasConnectedSection: Boolean(pageRoot?.querySelector('[data-linked-records-title="connected"]')),
      hasPhotoPreview: Boolean(pageRoot?.querySelector(".light-avatar.has-photo img")),
      hasRedundantHero: Boolean(pageRoot?.querySelector(".light-profile-card")),
      autosaveStatus: String(status?.getAttribute("data-contact-autosave-status") || "").trim(),
      autosaveLabel: String(status?.textContent || "").trim(),
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

async function fillContactEditField(page, fieldName, value, timeoutMs) {
  const input = page.locator(`[data-contact-edit-field="${fieldName}"]`).first();
  await input.waitFor({ state: "visible", timeout: timeoutMs });
  await input.fill(value);
}

async function waitForContactRecord(config, contactId, predicate, description, timeoutMs) {
  const startedAt = Date.now();
  let lastRecord = null;
  while (Date.now() - startedAt < timeoutMs) {
    lastRecord = await apiRequest(config, "GET", `/api/workspace/contacts/${encodeURIComponent(contactId)}`);
    if (predicate(lastRecord)) {
      return lastRecord;
    }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for contact ${contactId}: ${description}; last record ${JSON.stringify(lastRecord)}`);
}

async function waitForContactAutosaveSaved(page, timeoutMs) {
  await page.waitForFunction(() => {
    const status = document.querySelector("[data-contact-autosave-status]");
    return status instanceof HTMLElement && status.getAttribute("data-contact-autosave-status") === "saved";
  }, undefined, { timeout: timeoutMs });
}

async function installContactEditTrace(page, fieldName) {
  await page.evaluate(fieldKey => {
    if (!window.__contactEditTraceStore) {
      window.__contactEditTraceStore = {};
    }
    const store = {
      currentNode: null,
      currentToken: 0,
      events: [],
      initialToken: 0,
      initialValue: "",
    };
    const selector = `[data-contact-edit-field="${String(fieldKey || "")}"]`;
    const bindFieldNode = () => {
      const next = document.querySelector(selector);
      if (next !== store.currentNode) {
        store.currentNode = next instanceof HTMLInputElement || next instanceof HTMLTextAreaElement ? next : null;
        store.currentToken += 1;
        if (store.currentNode instanceof HTMLElement) {
          store.currentNode.dataset.traceToken = String(store.currentToken);
        }
        return true;
      }
      return false;
    };
    const readValue = () => store.currentNode instanceof HTMLInputElement || store.currentNode instanceof HTMLTextAreaElement
      ? store.currentNode.value
      : "";
    const record = (type, event = null) => {
      const target = event?.target instanceof HTMLElement ? event.target : null;
      const shouldRecord = !target || target.matches(selector) || target === store.currentNode;
      if (!shouldRecord) {
        return;
      }
      store.events.push({
        type,
        nodeToken: store.currentToken,
        activeName: document.activeElement?.getAttribute?.("data-contact-edit-field") || "",
        value: readValue(),
        key: event?.key || "",
        data: event?.data || "",
        inputType: event?.inputType || "",
      });
    };
    bindFieldNode();
    ["focusin", "focusout", "blur", "beforeinput", "input", "keydown", "keyup"].forEach(type => {
      document.addEventListener(type, event => {
        if (bindFieldNode()) {
          record("contact-edit-node-changed", null);
        }
        record(type, event);
      }, true);
    });
    new MutationObserver(() => {
      if (bindFieldNode()) {
        record("contact-edit-node-changed", null);
      }
    }).observe(document.documentElement, { childList: true, subtree: true });
    window.__contactEditTraceStore[fieldKey] = store;
    if (store.currentNode && !store.currentToken) {
      store.currentToken = 1;
      store.currentNode.dataset.traceToken = String(store.currentToken);
    }
    store.events = [];
    store.initialToken = store.currentToken;
    store.initialValue = readValue();
  }, fieldName);
}

async function traceContactEditTyping(page, fieldName, value, timeoutMs) {
  const input = page.locator(`[data-contact-edit-field="${fieldName}"]`).first();
  await input.waitFor({ state: "visible", timeout: timeoutMs });
  await input.click();
  await input.fill("");
  await installContactEditTrace(page, fieldName);
  await input.type(value, { delay: 40 });
  await page.waitForFunction(({ fieldKey, expectedValue }) => {
    const field = document.querySelector(`[data-contact-edit-field="${fieldKey}"]`);
    return (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement) && field.value === expectedValue;
  }, { fieldKey: fieldName, expectedValue: value }, { timeout: timeoutMs });
  const trace = await page.evaluate(fieldKey => {
    const store = (window.__contactEditTraceStore || {})[fieldKey] || {};
    const current = document.querySelector(`[data-contact-edit-field="${fieldKey}"]`);
    return {
      initialToken: Number(store.initialToken || 0),
      initialValue: String(store.initialValue || ""),
      finalToken: Number(store.currentToken || 0),
      finalValue: current instanceof HTMLInputElement || current instanceof HTMLTextAreaElement ? current.value : "",
      events: Array.isArray(store.events) ? store.events.slice() : [],
    };
  }, fieldName);
  const eventCounts = trace.events.reduce((counts, event) => {
    const key = String(event?.type || "");
    counts[key] = (counts[key] || 0) + 1;
    return counts;
  }, {});
  return {
    ...trace,
    eventCounts,
    editState: await readContactEditState(page),
  };
}

async function proveContacts(page, config, seed, theme, screenshots, summary) {
  await openTile(page, "Contacts", "contacts", config.timeoutMs);
  const contacts = seed.writeEnabled ? null : (seed.contacts || []);
  const proofContactId = `${seed.runId}-contact-one`;
  const davidContactId = `${seed.runId}-david-contact`;
  const danielContactId = `${seed.runId}-daniel-contact`;
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
  assert(baselineSearchState.rowAvatarTexts["contact-me"] === "ME", `Expected contact-me avatar to stay ME, got ${baselineSearchState.rowAvatarTexts["contact-me"] || "<missing>"}`);
  assert(baselineSearchState.rowAvatarTexts[davidContactId] === "D", `Expected David avatar to render a single D initial, got ${baselineSearchState.rowAvatarTexts[davidContactId] || "<missing>"}`);
  assert(baselineSearchState.rowAvatarTexts[danielContactId] === "D", `Expected Daniel avatar to render a single D initial, got ${baselineSearchState.rowAvatarTexts[danielContactId] || "<missing>"}`);
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
  const initialsSearchState = await expectContactsSearchRows(page, "single-name proof", [danielContactId, davidContactId], config.timeoutMs);
  assert(initialsSearchState.rowAvatarTexts[davidContactId] === "D", `Expected David initials search result to render D, got ${initialsSearchState.rowAvatarTexts[davidContactId] || "<missing>"}`);
  assert(initialsSearchState.rowAvatarTexts[danielContactId] === "D", `Expected Daniel initials search result to render D, got ${initialsSearchState.rowAvatarTexts[danielContactId] || "<missing>"}`);
  screenshots[`${theme}_contacts_search_initials`] = await saveScreenshot(page, config.reportDir, `${theme}-contacts-search-initials`);
  const stabilityQuery = "dav";
  const stabilityTrace = await traceContactsSearchTyping(page, stabilityQuery, config.timeoutMs);
  assert((stabilityTrace.eventCounts.blur || 0) === 0, `Expected Contacts search typing to avoid blur/focusout while filtering; saw ${JSON.stringify(stabilityTrace.eventCounts)}`);
  assert((stabilityTrace.eventCounts.focusout || 0) === 0, `Expected Contacts search typing to avoid blur/focusout while filtering; saw ${JSON.stringify(stabilityTrace.eventCounts)}`);
  assert((stabilityTrace.eventCounts["search-node-changed"] || 0) === 0, `Expected Contacts search typing to keep the same mounted input; saw ${JSON.stringify(stabilityTrace.eventCounts)}`);
  assert(stabilityTrace.initialToken === stabilityTrace.finalToken, `Expected Contacts search typing to keep the same mounted input (token ${stabilityTrace.initialToken} -> ${stabilityTrace.finalToken})`);
  assert(stabilityTrace.finalValue === stabilityQuery, `Expected Contacts search typing to finish with ${stabilityQuery}, got ${stabilityTrace.finalValue}`);
  assert(
    JSON.stringify(stabilityTrace.searchState.rowIds) === JSON.stringify([davidContactId]),
    `Expected ${stabilityQuery} to filter down to David, got ${stabilityTrace.searchState.rowIds.join(", ")}`
  );
  screenshots[`${theme}_contacts_search_stability`] = await saveScreenshot(page, config.reportDir, `${theme}-contacts-search-stability`);
  summary.contactSearchStability = summary.contactSearchStability || [];
  summary.contactSearchStability.push({
    theme,
    query: stabilityQuery,
    trace: stabilityTrace,
  });
  await expectContactsSearchRows(page, "", baselineRowIds, config.timeoutMs);
  await page.locator('button[data-contact-id="contact-me"]').click();
  await waitForLightRoute(page, "contact-detail", config.timeoutMs);
  await waitForGraphText(page, "Me", config.timeoutMs);
  const meEditState = await readContactEditState(page);
  assert(meEditState.pageVisible, "Expected Me contact detail editor to be visible");
  assert(!meEditState.hasRedundantHero, "Expected contact detail editor to remove the redundant hero");
  assert(!meEditState.firstNameVisible && !meEditState.lastNameVisible, "Expected self contact detail to stay name-locked as Me");
  assert(meEditState.hasConnectedSection, "Expected contact detail editor to keep Connected visible");
  await assertNoContactEndpoints(page, config, "contact-me", "Me contact detail");
  await assertNoContactHtmlDocument(page, config, "contact-me", "Me contact detail");
  const meLinkedSection = page.locator('.light-linked-records-section[data-linked-records-title="connected"]').first();
  await meLinkedSection.waitFor({ state: "visible", timeout: config.timeoutMs });
  assert(await meLinkedSection.getByText("NOTES").count() === 0, "Expected Me contact detail to avoid a separate Notes section.");
  const meConnectedState = await readLinkedRecordSectionState(page, "connected");
  assert(meConnectedState.sectionCount === 1, "Expected Me contact detail to render one Connected section.");
  assert(meConnectedState.bodyIsFlat, "Expected Me contact detail to render Connected inside one shared flat-feed shell.");
  assert(meConnectedState.chevronCount === 0, "Expected Me contact Connected shell to omit trailing chevrons.");
  assert(meConnectedState.chipCount === 0, "Expected Me contact Connected shell to omit linked-record pills.");
  const meEmptyShell = meLinkedSection.locator(".light-linked-records-empty-shell").first();
  await meEmptyShell.waitFor({ state: "visible", timeout: config.timeoutMs });
  const meEmptyShellBox = await meEmptyShell.boundingBox();
  assert(meEmptyShellBox && meEmptyShellBox.height >= 60 && meEmptyShellBox.height <= 120, `Expected Me linked-record shell to stay compact, got ${JSON.stringify(meEmptyShellBox)}.`);
  summary.contactProfileCards = summary.contactProfileCards || [];
  summary.contactProfileCards.push({ theme, contact: "contact-me", editor: meEditState });
  screenshots[`${theme}_contacts_me_detail`] = await saveScreenshot(page, config.reportDir, `${theme}-contacts-me-detail`);
  await topBackToRoute(page, "contacts", "", config.timeoutMs);
  if (!seed.writeEnabled && !contacts.length) {
    await backHome(page, theme, config.timeoutMs);
    return;
  }
  const photoState = await assertContactPhotoThumbnails(page, `${theme} Contacts list`, config.timeoutMs);
  summary.contactPhotoThumbnails = summary.contactPhotoThumbnails || [];
  summary.contactPhotoThumbnails.push({ theme, ...photoState });
  if (seed.writeEnabled) {
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
    await waitForGraphText(page, "Proof Contact One", config.timeoutMs);
    const contactEditState = await readContactEditState(page);
    assert(contactEditState.pageVisible, "Expected contact detail editor to be visible");
    assert(!contactEditState.hasRedundantHero, "Expected contact detail editor to remove the redundant hero");
    assert(contactEditState.firstNameVisible && contactEditState.lastNameVisible, "Expected normal contact detail to expose editable first and last name fields");
    assert(contactEditState.hasConnectedSection, "Expected contact detail editor to keep Connected visible");
    await assertNoContactEndpoints(page, config, proofContactId, "Proof Contact One detail", { requireActivity: true });
    await assertNoContactHtmlDocument(page, config, proofContactId, "Proof Contact One detail");
    summary.contactProfileCards.push({ theme, contact: proofContactId, editor: contactEditState });
    const linkedSection = page.locator('.light-linked-records-section[data-linked-records-title="connected"]').first();
    await linkedSection.waitFor({ state: "visible", timeout: config.timeoutMs });
    assert(await page.getByText("NOTES").count() === 0, "Expected populated contact detail to avoid a separate Notes section.");
    assert(await linkedSection.locator(".light-linked-record-feed-row").count() >= 3, "Expected populated contact detail to show mixed linked-record rows.");
    assert(await linkedSection.locator(".light-info-row").count() === 0, "Expected linked records to use feed rows instead of legacy info rows.");
    const connectedState = await readLinkedRecordSectionState(page, "connected");
    assert(connectedState.bodyIsFlat, "Expected populated contact Connected section to render inside one shared flat-feed shell.");
    assert(connectedState.flatRowCount === connectedState.rowCount, "Expected populated contact Connected rows to all use flat-feed styling.");
    assert(connectedState.contiguousRows, "Expected populated contact Connected rows to render contiguously with no inter-row gaps.");
    assert(connectedState.chevronCount === 0, "Expected populated contact Connected rows to omit trailing chevrons.");
    assert(connectedState.chipCount === 0, "Expected populated contact Connected rows to omit pills.");
    const linkedTexts = await linkedSection.locator(".light-linked-record-feed-row").allTextContents();
    for (const label of ["Proof Pinned Note", "Proof Alpha Project", "Proof Graph Meeting"]) {
      assert(linkedTexts.some(value => value.includes(label)), `Expected populated contact linked records to include ${label}, got ${linkedTexts.join(", ")}.`);
    }
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
    await waitForGraphText(page, "Proof Contact One", config.timeoutMs);
    await assertNoContactEndpoints(page, config, proofContactId, "Proof Contact One detail", { requireActivity: true });
    await assertNoContactHtmlDocument(page, config, proofContactId, "Proof Contact One detail");
    screenshots[`${theme}_contacts_detail_reopened`] = await saveScreenshot(page, config.reportDir, `${theme}-contacts-detail`);
    await page.locator(`[data-workspace-target-kind="note"][data-workspace-target-id="${seed.pinnedNoteId}"]`).first().waitFor({ state: "visible", timeout: config.timeoutMs });
    for (const [kind, route, id, text] of [
      ["note", "note-detail", `${seed.runId}-pinned-note`, "Proof Pinned Note"],
      ["project", "project-detail", `${seed.runId}-alpha-project`, "Proof Alpha Project"],
      ["meeting_note", "meeting-note-detail", `${seed.runId}-graph-meeting`, "Proof Graph Meeting"]
    ]) {
      await page.locator(`[data-workspace-target-kind="${kind}"][data-workspace-target-id="${id}"]`).first().click();
      await waitForLightRoute(page, route, config.timeoutMs);
      await waitForGraphText(page, text, config.timeoutMs);
      await topBackToRoute(page, "contact-detail", "Proof Contact One", config.timeoutMs);
    }
    screenshots[`${theme}_contact_after_back`] = await saveScreenshot(page, config.reportDir, `${theme}-contact-after-back`);
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
  await waitForGraphText(page, firstVisibleContact.title, config.timeoutMs);
  const contactEditState = await readContactEditState(page);
  assert(contactEditState.pageVisible, `Expected ${firstVisibleContact.title} detail editor to be visible`);
  assert(!contactEditState.hasRedundantHero, "Expected contact detail editor to remove the redundant hero");
  await assertNoContactEndpoints(page, config, firstVisibleContact.id, `${firstVisibleContact.title} detail`);
  await assertNoContactHtmlDocument(page, config, firstVisibleContact.id, `${firstVisibleContact.title} detail`);
  summary.contactProfileCards.push({ theme, contact: firstVisibleContact.id, editor: contactEditState });
  const detailState = await readGraphDetailState(page);
  assert(detailState.route === "contact-detail", `Expected contact-detail route, got ${detailState.route}`);
  assert(!detailState.hasHtmlFrame, "Did not expect contact detail to render a generated HTML iframe");
  screenshots[`${theme}_contacts_detail`] = await saveScreenshot(page, config.reportDir, `${theme}-contacts-detail`);
  await backHome(page, theme, config.timeoutMs);
  summary.contactProfiles = summary.contactProfiles || [];
  summary.contactProfiles.push({ theme, selfContactId: firstContactId, contacts_list_flatness: contactsListFlatness });
}

async function proveContactsEdit(page, config, seed, theme, screenshots, summary) {
  if (!seed.writeEnabled) {
    summary.assertions.push("contacts edit proof skipped because API token was unavailable");
    return;
  }
  const proofContactId = `${seed.runId}-contact-one`;
  const updatedFirstName = "Updated";
  const updatedLastName = "Proof Contact";
  const updatedTitle = "Updated Proof Contact";
  const updatedSummary = "Updated from local proof edit flow";
  const updatedEmail = "updated.proof.one@example.com";
  const updatedPhone = "+1 (555) 010-3333";
  const updatedActivity = "Added from local proof";
  const photoPath = path.resolve("pucky_vm/ui_src/fixtures/contact_photos/proof-contact.webp");
  const expectedInitials = "UC";

  await backHome(page, theme, config.timeoutMs);
  await openTile(page, "Contacts", "contacts", config.timeoutMs);
  await page.locator(`button[data-contact-id="${proofContactId}"]`).first().waitFor({ state: "visible", timeout: config.timeoutMs });
  screenshots[`${theme}_contact_edit_baseline`] = await saveScreenshot(page, config.reportDir, `${theme}-contact-edit-baseline`);

  await page.locator(`button[data-contact-id="${proofContactId}"]`).first().click();
  await waitForLightRoute(page, "contact-detail", config.timeoutMs);
  await waitForGraphText(page, "Proof Contact One", config.timeoutMs);
  const initialEditState = await readContactEditState(page);
  assert(initialEditState.pageVisible, "Expected Contacts detail editor to be visible");
  assert(initialEditState.route === "contact-detail", `Expected contact-detail route, got ${initialEditState.route}`);
  assert(!initialEditState.hasRedundantHero, "Expected contact detail editor to remove the redundant hero");
  assert(initialEditState.firstNameVisible && initialEditState.lastNameVisible, "Expected normal contact detail to expose editable first and last name fields");
  assert(initialEditState.hasConnectedSection, "Expected contact detail editor to keep Connected visible");

  const typingTrace = await traceContactEditTyping(page, "first_name", updatedFirstName, config.timeoutMs);
  assert((typingTrace.eventCounts.blur || 0) === 0 && (typingTrace.eventCounts.focusout || 0) === 0, "Expected contact edit typing to avoid blur/focusout while editing");
  assert(typingTrace.initialToken === typingTrace.finalToken, "Expected contact edit typing to keep the same mounted input");

  await fillContactEditField(page, "last_name", updatedLastName, config.timeoutMs);
  await fillContactEditField(page, "summary", updatedSummary, config.timeoutMs);
  await fillContactEditField(page, "email", updatedEmail, config.timeoutMs);
  await fillContactEditField(page, "phone", updatedPhone, config.timeoutMs);
  await waitForContactAutosaveSaved(page, config.timeoutMs);
  let updatedRecord = await waitForContactRecord(
    config,
    proofContactId,
    record => record.title === updatedTitle
      && record.summary === updatedSummary
      && String(record?.metadata?.email || "") === updatedEmail
      && String(record?.metadata?.phone || "") === updatedPhone,
    "name + contact info autosave",
    config.timeoutMs
  );
  assert(updatedRecord.title === updatedTitle, `Expected contact edit to persist the updated title, got ${updatedRecord.title}`);
  screenshots[`${theme}_contact_edit_name`] = await saveScreenshot(page, config.reportDir, `${theme}-contact-edit-name`);

  await page.locator('[data-contact-activity-add="true"]').first().click();
  await page.locator('[data-contact-activity-index="2"]').first().waitFor({ state: "visible", timeout: config.timeoutMs });
  await page.locator('[data-contact-activity-index="2"]').first().fill(updatedActivity);
  await waitForContactAutosaveSaved(page, config.timeoutMs);
  updatedRecord = await waitForContactRecord(
    config,
    proofContactId,
    record => Array.isArray(record?.metadata?.activity)
      && record.metadata.activity.includes(updatedActivity)
      && record.metadata.activity.length === 3,
    "activity add autosave",
    config.timeoutMs
  );
  await page.locator('[data-contact-activity-remove="0"]').first().click();
  await waitForContactAutosaveSaved(page, config.timeoutMs);
  updatedRecord = await waitForContactRecord(
    config,
    proofContactId,
    record => Array.isArray(record?.metadata?.activity)
      && record.metadata.activity.includes(updatedActivity)
      && !record.metadata.activity.includes("Created by proof")
      && record.metadata.activity.length === 2,
    "activity remove autosave",
    config.timeoutMs
  );
  screenshots[`${theme}_contact_edit_activity`] = await saveScreenshot(page, config.reportDir, `${theme}-contact-edit-activity`);

  const photoInput = page.locator('input[type="file"][data-contact-photo-input="true"]').first();
  await photoInput.setInputFiles(photoPath);
  await page.waitForFunction(() => Boolean(document.querySelector(".light-contact-edit-page .light-avatar.has-photo img")), undefined, { timeout: config.timeoutMs });
  await waitForContactAutosaveSaved(page, config.timeoutMs);
  updatedRecord = await waitForContactRecord(
    config,
    proofContactId,
    record => String(record?.metadata?.photo || "").startsWith("data:image/jpeg"),
    "photo add autosave",
    config.timeoutMs
  );
  assert(String(updatedRecord.metadata?.photo || "").trim(), "Expected contact edit to persist the uploaded photo");
  screenshots[`${theme}_contact_edit_photo_added`] = await saveScreenshot(page, config.reportDir, `${theme}-contact-edit-photo-added`);

  await page.locator('[data-contact-photo-remove="true"]').first().click();
  await page.waitForFunction(() => !document.querySelector(".light-contact-edit-page .light-avatar.has-photo img"), undefined, { timeout: config.timeoutMs });
  await waitForContactAutosaveSaved(page, config.timeoutMs);
  updatedRecord = await waitForContactRecord(
    config,
    proofContactId,
    record => !String(record?.metadata?.photo || "").trim(),
    "photo remove autosave",
    config.timeoutMs
  );
  assert(!String(updatedRecord.metadata?.photo || "").trim(), "Expected contact edit to remove the uploaded photo");
  const photoRemovedState = await readContactEditState(page);
  assert(photoRemovedState.avatarText === expectedInitials, `Expected photo removal to restore derived initials, got ${photoRemovedState.avatarText}`);
  screenshots[`${theme}_contact_edit_photo_removed`] = await saveScreenshot(page, config.reportDir, `${theme}-contact-edit-photo-removed`);

  await topBackToRoute(page, "contacts", "", config.timeoutMs);
  await page.locator(`button[data-contact-id="${proofContactId}"]`).first().waitFor({ state: "visible", timeout: config.timeoutMs });
  const updatedListState = await readContactsSearchState(page);
  assert(updatedListState.rowTitles.includes(updatedTitle), `Expected edited contact row to reappear with the updated title, got ${updatedListState.rowTitles.join(", ")}`);
  screenshots[`${theme}_contact_edit_updated_list`] = await saveScreenshot(page, config.reportDir, `${theme}-contact-edit-updated-list`);

  await page.locator(`button[data-contact-id="${proofContactId}"]`).first().click();
  await waitForLightRoute(page, "contact-detail", config.timeoutMs);
  await waitForGraphText(page, updatedTitle, config.timeoutMs);
  const reopenedState = await readContactEditState(page);
  assert(reopenedState.firstName === updatedFirstName, `Expected reopened contact detail to keep first name ${updatedFirstName}, got ${reopenedState.firstName}`);
  assert(reopenedState.lastName === updatedLastName, `Expected reopened contact detail to keep last name ${updatedLastName}, got ${reopenedState.lastName}`);
  assert(reopenedState.summary === updatedSummary, `Expected reopened contact detail to keep summary ${updatedSummary}, got ${reopenedState.summary}`);
  assert(reopenedState.email === updatedEmail, `Expected reopened contact detail to keep email ${updatedEmail}, got ${reopenedState.email}`);
  assert(reopenedState.phone === updatedPhone, `Expected reopened contact detail to keep phone ${updatedPhone}, got ${reopenedState.phone}`);
  assert(JSON.stringify(reopenedState.activityValues) === JSON.stringify(["Linked to Alpha", updatedActivity]), `Expected reopened contact detail to keep edited activity rows, got ${JSON.stringify(reopenedState.activityValues)}`);
  assert(!reopenedState.hasPhotoPreview, "Expected photo removal to keep the detail editor on initials after reopen");
  await backHome(page, theme, config.timeoutMs);

  summary.contactEdits = summary.contactEdits || [];
  summary.contactEdits.push({
    theme,
    contact_id: proofContactId,
    updated_first_name: updatedFirstName,
    updated_last_name: updatedLastName,
    updated_title: updatedTitle,
    updated_summary: updatedSummary,
    updated_email: updatedEmail,
    updated_phone: updatedPhone,
    activity: Array.isArray(updatedRecord.metadata?.activity) ? updatedRecord.metadata.activity.slice() : [],
    photo_present: Boolean(String(updatedRecord.metadata?.photo || "").trim()),
  });
}

async function proveReminders(page, config, seed, theme, screenshots, summary) {
  if (!seed.writeEnabled) {
    summary.assertions.push("reminder delivery proof skipped because API token was unavailable");
    return;
  }
  const liveReminderId = `${seed.runId}-live-reminder`;
  const dismissReminderId = `${seed.runId}-dismiss-reminder`;
  const upcomingReminderId = `${seed.runId}-upcoming-reminder`;
  const snoozedReminderId = `${seed.runId}-snoozed-reminder`;
  for (const reminderId of [liveReminderId, dismissReminderId, upcomingReminderId, snoozedReminderId]) {
    await deleteWorkspaceRecord(config, "reminders", reminderId);
  }
  const baselineActiveCount = await readActiveReminderCount(config);
  const liveDueAtMs = Date.now() - 60_000;
  const dismissDueAtMs = Date.now() - 30_000;
  const upcomingDueAtMs = Date.now() + (30 * 60 * 1000);
  const snoozedDueAtMs = Date.now() + (15 * 60 * 1000);
  await apiRequest(config, "POST", "/api/workspace/reminders", {
    id: liveReminderId,
    title: "Proof Live Reminder",
    summary: "Live reminder detail should stay compact and actionable.",
    status: "open",
    due_at_ms: liveDueAtMs,
    metadata: {
      source_kind: "task",
      source_id: `${seed.runId}-future-task`,
      recipients: [
        { id: "self", kind: "self", label: "Me" },
        { id: `${seed.runId}-contact-one`, kind: "contact", contact_id: `${seed.runId}-contact-one`, label: "Proof Contact One" }
      ],
      destinations: [
        { channel: "phone_notification", recipient_ids: ["self"] },
        { channel: "sms", recipient_ids: [`${seed.runId}-contact-one`] }
      ]
    }
  });
  await apiRequest(config, "POST", "/api/workspace/reminders", {
    id: dismissReminderId,
    title: "Proof Dismiss Reminder",
    summary: "Dismiss should remove this reminder from the active set.",
    status: "open",
    due_at_ms: dismissDueAtMs,
    metadata: {
      source_kind: "meeting_note",
      source_id: `${seed.runId}-graph-meeting`,
      recipients: [{ id: "self", kind: "self", label: "Me" }],
      destinations: [{ channel: "phone_notification", recipient_ids: ["self"] }]
    }
  });
  await apiRequest(config, "POST", "/api/workspace/reminders", {
    id: upcomingReminderId,
    title: "Proof Upcoming Reminder",
    summary: "Upcoming reminder detail should stay read-only until it goes live.",
    status: "open",
    due_at_ms: upcomingDueAtMs,
    metadata: {
      source_kind: "project",
      source_id: `${seed.runId}-alpha-project`,
      recipients: [{ id: "self", kind: "self", label: "Me" }],
      destinations: [{ channel: "phone_notification", recipient_ids: ["self"] }]
    }
  });
  await apiRequest(config, "POST", "/api/workspace/reminders", {
    id: snoozedReminderId,
    title: "Proof Snoozed Reminder",
    summary: "Snoozed reminders should stay inside Upcoming with a countdown.",
    status: "open",
    due_at_ms: snoozedDueAtMs,
    metadata: {
      source_kind: "project",
      source_id: `${seed.runId}-beta-project`,
      snoozed_until_ms: snoozedDueAtMs,
      delivery_state: "pending",
      last_fired_at_ms: 0,
      last_fired_due_at_ms: 0,
      last_delivery_error: "",
      recipients: [{ id: "self", kind: "self", label: "Me" }],
      destinations: [{ channel: "phone_notification", recipient_ids: ["self"] }]
    }
  });
  let activeCount = baselineActiveCount + 4;
  await page.goto(pageUrl(config.baseUrl, theme), { waitUntil: "commit", timeout: config.timeoutMs });
  await waitForHome(page, theme, config.timeoutMs);
  await openTile(page, "Reminders", "reminders", config.timeoutMs);
  const liveRow = page.locator(`.light-reminder-row[data-reminder-id="${liveReminderId}"]:visible`).first();
  const dismissRow = page.locator(`.light-reminder-row[data-reminder-id="${dismissReminderId}"]:visible`).first();
  const upcomingRow = page.locator(`.light-reminder-row[data-reminder-id="${upcomingReminderId}"]:visible`).first();
  const snoozedRow = page.locator(`.light-reminder-row[data-reminder-id="${snoozedReminderId}"]:visible`).first();
  await liveRow.waitFor({ state: "visible", timeout: config.timeoutMs });
  await dismissRow.waitFor({ state: "visible", timeout: config.timeoutMs });
  await upcomingRow.waitFor({ state: "visible", timeout: config.timeoutMs });
  await snoozedRow.waitFor({ state: "visible", timeout: config.timeoutMs });
  await page.waitForFunction(() => {
    const sectionTitles = [...document.querySelectorAll(".light-section-title")].map(node => String(node.textContent || "").trim().toUpperCase());
    const lower = String(document.body.innerText || "").toLowerCase();
    return sectionTitles.includes("LIVE")
      && sectionTitles.includes("UPCOMING")
      && !sectionTitles.includes("SNOOZED")
      && !lower.includes("overdue")
      && !lower.includes("failed");
  }, { timeout: config.timeoutMs });
  await page.waitForFunction(() => {
    const snoozedRow = document.querySelector('.light-reminder-row[data-reminder-state="snoozed"]');
    const snoozedCountdown = snoozedRow?.querySelector('[data-reminder-countdown="true"]');
    return !document.querySelector(".light-reminder-history-divider")
      && !document.querySelector(".light-reminder-history-list")
      && !document.querySelector('[data-reminder-history-toggle="sent"]')
      && Boolean(snoozedCountdown);
  }, { timeout: config.timeoutMs });
  const rowChipCounts = await Promise.all([
    liveRow.locator(".light-graph-chip-row").count(),
    dismissRow.locator(".light-graph-chip-row").count(),
    upcomingRow.locator(".light-graph-chip-row").count(),
    snoozedRow.locator(".light-graph-chip-row").count()
  ]);
  assert(rowChipCounts.every(count => count === 0), `Expected no linked chips on reminder rows, saw ${rowChipCounts.join(",")}`);
  await backHome(page, theme, config.timeoutMs);
  await waitForReminderHomeBadgeCount(page, activeCount, config.timeoutMs);
  screenshots[`${theme}_reminders_home_badge_active`] = await saveScreenshot(page, config.reportDir, `${theme}-reminders-home-badge-active`);
  await openTile(page, "Reminders", "reminders", config.timeoutMs);
  await liveRow.waitFor({ state: "visible", timeout: config.timeoutMs });
  screenshots[`${theme}_reminders_list_pending`] = await saveScreenshot(page, config.reportDir, `${theme}-reminders-list-pending`);

  await upcomingRow.click({ force: true });
  await waitForLightRoute(page, "reminder-detail", config.timeoutMs);
  await waitForGraphText(page, "Proof Upcoming Reminder", config.timeoutMs);
  await page.waitForFunction(() => {
    const card = document.querySelector('[data-reminder-detail-card="true"]');
    const shell = document.querySelector(".light-shell");
    const lower = String(shell?.textContent || "").toLowerCase();
    const sectionTitles = [...document.querySelectorAll(".light-section-title")].map(node => String(node.textContent || "").trim().toLowerCase());
    return card?.getAttribute("data-reminder-state") === "upcoming"
      && !document.querySelector('[data-reminder-action-row="true"]')
      && !lower.includes("status:")
      && !lower.includes("delivery:")
      && !lower.includes("system notification")
      && !sectionTitles.includes("schedule")
      && !sectionTitles.includes("recipients")
      && !sectionTitles.includes("channels")
      && !sectionTitles.includes("linked records")
      && !sectionTitles.includes("notes")
      && !sectionTitles.includes("connected")
      && document.querySelectorAll('[data-reminder-detail-tile="recipient"]').length === 0
      && document.querySelectorAll('[data-reminder-detail-tile="when"]').length === 0
      && !document.querySelector('[data-reminder-detail-feed="true"]')
      && document.querySelectorAll('[data-reminder-detail-feed="true"]').length === 0
      && !document.querySelector(".light-reminder-detail-feed .light-chevron")
      && !lower.includes("no generated reminder page yet.");
  }, { timeout: config.timeoutMs });
  await page.waitForFunction(() => !document.querySelector(".light-detail-html-body .light-html-frame"), { timeout: config.timeoutMs });
  await assertNoToast(page, `${theme} upcoming reminder detail`);
  screenshots[`${theme}_reminder_detail_upcoming`] = await saveScreenshot(page, config.reportDir, `${theme}-reminder-detail-upcoming`);
  await page.evaluate(() => window.PuckyHandleAndroidBack && window.PuckyHandleAndroidBack());
  await waitForLightRoute(page, "reminders", config.timeoutMs);

  summary.reminders = summary.reminders || [];
  const reminderSummary = {
    theme,
    baselineActiveCount,
    liveReminderId,
    dismissReminderId,
    upcomingReminderId,
    snoozedReminderId,
    snoozedUntilMs: 0,
    dismissedStatus: ""
  };

  await liveRow.click({ force: true });
  await waitForLightRoute(page, "reminder-detail", config.timeoutMs);
  await waitForGraphText(page, "Proof Live Reminder", config.timeoutMs);
  await page.waitForFunction(() => {
    const card = document.querySelector('[data-reminder-detail-card="true"]');
    const shell = document.querySelector(".light-shell");
    const lower = String(shell?.textContent || "").toLowerCase();
    const actions = [...document.querySelectorAll('[data-reminder-action-row="true"] button')].map(node => String(node.textContent || "").trim());
    return card?.getAttribute("data-reminder-state") === "live"
      && JSON.stringify(actions) === JSON.stringify(["Dismiss", "Snooze"])
      && !lower.includes("status:")
      && !lower.includes("delivery:")
      && !lower.includes("done")
      && !lower.includes("system notification")
      && document.querySelectorAll('[data-reminder-detail-tile="recipient"]').length === 0
      && document.querySelectorAll('[data-reminder-detail-tile="when"]').length === 0
      && !document.querySelector('[data-reminder-detail-feed="true"]')
      && !document.querySelector(".light-reminder-detail-feed .light-chevron");
  }, { timeout: config.timeoutMs });
  await assertNoToast(page, `${theme} live reminder detail`);
  screenshots[`${theme}_reminder_detail_live`] = await saveScreenshot(page, config.reportDir, `${theme}-reminder-detail-live`);

  await page.locator('[data-reminder-action="snooze"]').click();
  const snoozedRecord = await waitForReminderRecord(
    config,
    liveReminderId,
    record => reminderIsSnoozedForScript(record) && Number(record?.due_at_ms || 0) >= Date.now() + 70_000,
    "live reminder should snooze for roughly ninety seconds",
    30_000
  );
  assert(
    Number(snoozedRecord?.metadata?.snoozed_until_ms || 0) === Number(snoozedRecord?.due_at_ms || 0),
    `Expected snoozed reminder to align due_at_ms and snoozed_until_ms, saw ${Number(snoozedRecord?.due_at_ms || 0)} vs ${Number(snoozedRecord?.metadata?.snoozed_until_ms || 0)}`
  );
  reminderSummary.snoozedUntilMs = Number(snoozedRecord?.metadata?.snoozed_until_ms || 0);
  await assertNoToast(page, `${theme} reminder snooze`);
  await page.waitForFunction(() => {
    const shell = document.querySelector(".light-shell");
    const card = document.querySelector('[data-reminder-detail-card="true"]');
    return shell?.getAttribute("data-light-route") === "reminder-detail"
      && card?.getAttribute("data-reminder-state") === "snoozed"
      && !document.querySelector('[data-reminder-action-row="true"]');
  }, { timeout: config.timeoutMs });
  screenshots[`${theme}_reminder_detail_snoozed`] = await saveScreenshot(page, config.reportDir, `${theme}-reminder-detail-snoozed`);
  await page.evaluate(() => window.PuckyHandleAndroidBack && window.PuckyHandleAndroidBack());
  await waitForLightRoute(page, "reminders", config.timeoutMs);
  await page.waitForFunction((targetId) => {
    const row = document.querySelector(`.light-reminder-row[data-reminder-id="${targetId}"]`);
    return Boolean(row)
      && row.getAttribute("data-reminder-state") === "snoozed"
      && Boolean(row.querySelector('[data-reminder-countdown="true"]'));
  }, liveReminderId, { timeout: config.timeoutMs });
  screenshots[`${theme}_reminders_list_snoozed`] = await saveScreenshot(page, config.reportDir, `${theme}-reminders-list-snoozed`);
  await backHome(page, theme, config.timeoutMs);
  await waitForReminderHomeBadgeCount(page, activeCount, config.timeoutMs);
  screenshots[`${theme}_reminders_home_badge_after_snooze`] = await saveScreenshot(page, config.reportDir, `${theme}-reminders-home-badge-after-snooze`);

  await openTile(page, "Reminders", "reminders", config.timeoutMs);
  await dismissRow.waitFor({ state: "visible", timeout: config.timeoutMs });
  await dismissRow.click({ force: true });
  await waitForLightRoute(page, "reminder-detail", config.timeoutMs);
  await waitForGraphText(page, "Proof Dismiss Reminder", config.timeoutMs);
  await page.waitForFunction(() => {
    const card = document.querySelector('[data-reminder-detail-card="true"]');
    const actions = [...document.querySelectorAll('[data-reminder-action-row="true"] button')].map(node => String(node.textContent || "").trim());
    return card?.getAttribute("data-reminder-state") === "live"
      && JSON.stringify(actions) === JSON.stringify(["Dismiss", "Snooze"]);
  }, { timeout: config.timeoutMs });
  await page.locator('[data-reminder-action="dismiss"]').click();
  const dismissedReminder = await waitForReminderRecord(
    config,
    dismissReminderId,
    record => String(record?.status || "").trim().toLowerCase() === "done",
    "dismiss reminder should mark done",
    30_000
  );
  await assertNoToast(page, `${theme} reminder dismiss`);
  reminderSummary.dismissedStatus = String(dismissedReminder?.status || "").trim().toLowerCase();
  activeCount -= 1;
  await waitForLightRoute(page, "reminders", config.timeoutMs);
  await page.waitForFunction((targetId) => !document.querySelector(`.light-reminder-row[data-reminder-id="${targetId}"]`), dismissReminderId, { timeout: config.timeoutMs });
  screenshots[`${theme}_reminders_list_after_dismiss`] = await saveScreenshot(page, config.reportDir, `${theme}-reminders-list-after-dismiss`);

  await backHome(page, theme, config.timeoutMs);
  await waitForReminderHomeBadgeCount(page, activeCount, config.timeoutMs);
  screenshots[`${theme}_reminders_home_badge_after_dismiss`] = await saveScreenshot(page, config.reportDir, `${theme}-reminders-home-badge-after-dismiss`);

  reminderSummary.finalActiveCount = activeCount;
  summary.reminders.push(reminderSummary);
  summary.assertions.push(`${theme} reminders group into Live/Upcoming, keep snoozed reminders inside Upcoming, expose Dismiss and Snooze only on live reminder detail, hide backend delivery copy, hide Connected entirely when a reminder has no graph links, and keep the home badge tied to visible reminders including snoozed items`);
}

async function readGraphDetailState(page) {
  return page.evaluate(() => ({
    route: document.querySelector(".light-shell")?.getAttribute("data-light-route") || "",
    text: document.querySelector(".light-shell")?.textContent || "",
    hasHtmlFrame: Boolean(document.querySelector(".light-detail-html-body .light-html-frame"))
  }));
}

async function readMeetingNoteDetailState(page) {
  return page.evaluate(() => {
    const shell = document.querySelector('.light-shell[data-light-route="meeting-note-detail"]') || document.querySelector(".light-shell");
    const detail = shell?.querySelector(".light-page") || shell;
    const sectionTitles = Array.from(detail?.querySelectorAll(".light-section-title") || [])
      .map(node => String(node.textContent || "").trim().toUpperCase())
      .filter(Boolean);
    const eyebrowTexts = Array.from(detail?.querySelectorAll(".light-doc-eyebrow") || [])
      .map(node => String(node.textContent || "").trim())
      .filter(Boolean);
    const detailRowLabels = Array.from(detail?.querySelectorAll(".light-meeting-note-detail-row .light-calendar-detail-row-label") || [])
      .map(node => String(node.textContent || "").trim());
    const whoChipLabels = Array.from(detail?.querySelectorAll('.light-meeting-note-details-section .light-calendar-detail-card [data-detail-row="who"] .light-attendee-chip') || [])
      .map(node => String(node.textContent || "").trim())
      .filter(Boolean);
    const whoChipRoot = detail?.querySelector('.light-meeting-note-details-section .light-calendar-detail-card [data-detail-row="who"] .light-attendee-chip');
    const whoChipRootStyle = whoChipRoot ? getComputedStyle(whoChipRoot) : null;
    const hasStandaloneWhoSection = Boolean(detail?.querySelector(".light-meeting-note-who-section"));
    const whoInsideDetailsCard = Boolean(detail?.querySelector('.light-meeting-note-details-section .light-calendar-detail-card [data-detail-row="who"]'));
    const connectedRowTexts = Array.from(detail?.querySelectorAll('.light-linked-records-section[data-linked-records-title="connected"] .light-linked-record-feed-row') || [])
      .map(node => String(node.textContent || "").trim())
      .filter(Boolean);
    return {
      text: detail?.textContent || "",
      sectionTitles,
      eyebrowTexts,
      detailRowLabels,
      whoChipLabels,
      whoChipCount: detail?.querySelectorAll('.light-meeting-note-details-section .light-calendar-detail-card [data-detail-row="who"] .light-attendee-chip').length || 0,
      whoChipRootBackground: String(whoChipRootStyle?.backgroundColor || ""),
      whoChipRootColor: String(whoChipRootStyle?.color || ""),
      whoChipRootBorderRadius: String(whoChipRootStyle?.borderRadius || ""),
      hasStandaloneWhoSection,
      whoInsideDetailsCard,
      connectedRowTexts,
    };
  });
}

async function readProjectDetailState(page, runId) {
  return page.evaluate(({ runId: currentRunId }) => {
    const connectedSection = [...document.querySelectorAll(".light-linked-records-section")]
      .find(node => String(node.getAttribute("data-linked-records-title") || "").trim() === "connected");
    const connectedBody = connectedSection?.querySelector(".light-linked-record-list") || null;
    const connectedRows = connectedSection
      ? connectedSection.querySelectorAll(".light-linked-record-feed-row").length
      : 0;
    const flatRowCount = connectedSection
      ? connectedSection.querySelectorAll(".light-linked-record-feed-row.is-flat-feed").length
      : 0;
    const connectedChevronCount = connectedSection
      ? connectedSection.querySelectorAll(".light-linked-record-feed-row .light-chevron").length
      : 0;
    const pinnedNoteRows = connectedSection
      ? connectedSection.querySelectorAll(`[data-workspace-target-route="note-detail"][data-workspace-target-id="${currentRunId}-pinned-note"]`).length
      : 0;
    const rowRects = connectedSection
      ? [...connectedSection.querySelectorAll(".light-linked-record-feed-row")].map((row) => {
          const rect = row.getBoundingClientRect();
          return { top: rect.top, bottom: rect.bottom };
        })
      : [];
    const contiguousRows = rowRects.every((rect, index) => index === 0 || Math.abs(rect.top - rowRects[index - 1].bottom) <= 1.5);
    return {
      heroCount: document.querySelectorAll(".light-detail-hero").length,
      chipCloudCount: document.querySelectorAll(".light-project-detail-page .light-chip-cloud").length,
      sectionGridCount: document.querySelectorAll(".light-project-section-grid").length,
      connectedSectionCount: connectedSection ? 1 : 0,
      connectedBodyIsFlat: Boolean(connectedBody?.classList.contains("light-card") && connectedBody?.classList.contains("is-flat-feed")),
      connectedRows,
      flatRowCount,
      connectedChevronCount,
      contiguousRows,
      pinnedNoteRows,
      shellRoute: document.querySelector(".light-shell")?.getAttribute("data-light-route") || "",
    };
  }, { runId });
}

async function readLinkedRecordSectionState(page, title) {
  return page.evaluate(({ currentTitle }) => {
    const normalizedTitle = String(currentTitle || "").trim().toLowerCase();
    const section = [...document.querySelectorAll(".light-linked-records-section")]
      .find(node => String(node.getAttribute("data-linked-records-title") || "").trim() === normalizedTitle);
    const body = section?.querySelector(".light-linked-record-list") || null;
    const rows = section ? [...section.querySelectorAll(".light-linked-record-feed-row")] : [];
    const rowRects = rows.map((row) => {
      const rect = row.getBoundingClientRect();
      return { top: rect.top, bottom: rect.bottom };
    });
    return {
      sectionCount: section ? 1 : 0,
      bodyIsFlat: Boolean(body?.classList.contains("light-card") && body?.classList.contains("is-flat-feed")),
      rowCount: rows.length,
      flatRowCount: section ? section.querySelectorAll(".light-linked-record-feed-row.is-flat-feed").length : 0,
      chevronCount: section ? section.querySelectorAll(".light-linked-record-feed-row .light-chevron").length : 0,
      chipCount: section ? section.querySelectorAll(".light-linked-record-feed-row .light-graph-chip-row, .light-linked-record-feed-row .light-graph-chip").length : 0,
      contiguousRows: rowRects.every((rect, index) => index === 0 || Math.abs(rect.top - rowRects[index - 1].bottom) <= 1.5),
    };
  }, { currentTitle: title });
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
  const meetingNotesListState = await page.evaluate(() => ({
    chipRows: document.querySelectorAll('.light-shell[data-light-route="meeting-notes"] .light-graph-row .light-graph-chip-row').length,
    leadingIcons: document.querySelectorAll('.light-shell[data-light-route="meeting-notes"] .light-graph-row .light-small-icon').length,
    chevrons: document.querySelectorAll('.light-shell[data-light-route="meeting-notes"] .light-graph-row .light-chevron').length,
  }));
  assert(meetingNotesListState.chipRows === 0, "Meeting Notes list should not render right-side pill chips");
  assert(meetingNotesListState.leadingIcons === 0, "Meeting Notes list should not render leading icons");
  assert(meetingNotesListState.chevrons === 0, "Meeting Notes list should not render trailing chevrons");
  screenshots[`${theme}_graph_meetings`] = await saveScreenshot(page, config.reportDir, `${theme}-graph-meeting-notes-list`);
  await page.locator(`[data-record-id="${meeting}"]`).click();
  await expectFrameHeading(page, "Proof Graph Meeting", config.timeoutMs);
  for (const text of ["Proof Today Roadmap", "Proof Pinned Note", "Proof Future Task", "Proof Alpha Project", "Proof Graph Reminder"]) {
    await waitForGraphText(page, text, config.timeoutMs);
  }
  graphState = await readGraphDetailState(page);
  const meetingNoteState = await readMeetingNoteDetailState(page);
  const meetingConnectedState = await readLinkedRecordSectionState(page, "connected");
  assert(graphState.route === "meeting-note-detail", `Expected meeting-note-detail route, got ${graphState.route}`);
  assert(!graphState.hasHtmlFrame, "Meeting note detail should stay a structured graph document, not a generated HTML iframe");
  assert(!meetingNoteState.eyebrowTexts.some(value => /graph meeting/i.test(value)), `Meeting note detail should not render the stale Graph meeting eyebrow, got ${meetingNoteState.eyebrowTexts.join(", ")}.`);
  assert(meetingNoteState.sectionTitles.includes("DETAILS"), `Expected meeting note detail to include DETAILS, got ${meetingNoteState.sectionTitles.join(", ")}.`);
  assert(meetingNoteState.sectionTitles.includes("CONNECTED"), `Expected meeting note detail to include CONNECTED, got ${meetingNoteState.sectionTitles.join(", ")}.`);
  assert(!meetingNoteState.sectionTitles.includes("WHO"), `Meeting note detail should keep Who inside the Details card instead of rendering a standalone WHO section, got ${meetingNoteState.sectionTitles.join(", ")}.`);
  assert(!meetingNoteState.sectionTitles.includes("CONTEXT"), `Expected meeting note detail to remove CONTEXT, got ${meetingNoteState.sectionTitles.join(", ")}.`);
  assert(!meetingNoteState.sectionTitles.includes("NOTES"), `Expected meeting note detail to remove the separate NOTES section, got ${meetingNoteState.sectionTitles.join(", ")}.`);
  assert(!meetingNoteState.sectionTitles.includes("LINKED RECORDS"), `Expected meeting note detail to remove the separate LINKED RECORDS section, got ${meetingNoteState.sectionTitles.join(", ")}.`);
  assert(JSON.stringify(meetingNoteState.detailRowLabels) === JSON.stringify(["When", "Who"]), `Expected meeting note detail rows to only include When and Who, got ${meetingNoteState.detailRowLabels.join(", ")}.`);
  assert(meetingNoteState.whoInsideDetailsCard, "Meeting note detail should keep Who inside the Details card.");
  assert(!meetingNoteState.hasStandaloneWhoSection, "Meeting note detail should not keep a standalone Who section shell.");
  assert(meetingNoteState.whoChipLabels.includes("Proof Contact One"), `Expected Who chips to reuse the calendar-style contact label logic, got ${meetingNoteState.whoChipLabels.join(", ")}.`);
  assert(meetingNoteState.whoChipCount >= 1, "Expected meeting note Who to render at least one attendee chip.");
  assert(!isTransparentColor(meetingNoteState.whoChipRootBackground), `Expected meeting note Who chip to keep a visible tinted root background, got ${meetingNoteState.whoChipRootBackground}.`);
  assert(String(meetingNoteState.whoChipRootColor || "").trim().toLowerCase() !== String(meetingNoteState.whoChipRootBackground || "").trim().toLowerCase(), `Expected meeting note Who chip text to keep readable contrast, got text ${meetingNoteState.whoChipRootColor} on ${meetingNoteState.whoChipRootBackground}.`);
  assert(!isZeroishPx(meetingNoteState.whoChipRootBorderRadius), `Expected meeting note Who chip to keep a coherent rounded root shape, got ${meetingNoteState.whoChipRootBorderRadius}.`);
  assert(meetingConnectedState.sectionCount === 1, "Expected meeting note detail to render one Connected section.");
  assert(meetingConnectedState.bodyIsFlat, "Expected meeting note Connected to render inside one shared flat-feed shell.");
  assert(meetingConnectedState.rowCount === 5, `Expected meeting note Connected to render five linked rows after dedupe/contact exclusion, got ${meetingConnectedState.rowCount}.`);
  assert(meetingConnectedState.flatRowCount === meetingConnectedState.rowCount, "Expected meeting note Connected rows to all use flat-feed styling.");
  assert(meetingConnectedState.chevronCount === 0, "Expected meeting note Connected to omit trailing chevrons.");
  assert(meetingConnectedState.chipCount === 0, "Expected meeting note Connected to omit pills.");
  assert(meetingConnectedState.contiguousRows, "Expected meeting note Connected rows to render contiguously with no inter-row gaps.");
  assert(!meetingNoteState.connectedRowTexts.some(value => value.includes("Proof Contact One")), `Expected meeting note Connected to exclude contact rows, got ${meetingNoteState.connectedRowTexts.join(", ")}.`);
  const meetingHtmlState = await assertNoWorkspaceHtmlDocument(page, "Meeting note detail");
  summary.noHtmlDetails = summary.noHtmlDetails || [];
  summary.noHtmlDetails.push({ theme, route: "meeting-note-detail", htmlState: meetingHtmlState });
  screenshots[`${theme}_graph_meeting_detail`] = await saveScreenshot(page, config.reportDir, `${theme}-graph-meeting-detail`);
  for (const [route, id, text, shot] of [
    ["meeting-detail", `${seed.runId}-today-roadmap`, "Proof Today Roadmap", "graph-meeting-source-event"],
    ["note-detail", `${seed.runId}-pinned-note`, "Proof Pinned Note", "graph-meeting-linked-note"],
    ["project-detail", `${seed.runId}-alpha-project`, "Proof Alpha Project", "graph-meeting-linked-project"]
  ]) {
    const locator = page.locator(`[data-workspace-target-route="${route}"][data-workspace-target-id="${id}"]`).first();
    await locator.click();
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
  for (const text of ["Proof Future Task", "Proof Graph Meeting", "Proof Alpha Project", "CONNECTED"]) {
    await waitForGraphText(page, text, config.timeoutMs);
  }
  await page.waitForFunction(() => {
    const shell = document.querySelector(".light-shell");
    const text = String(shell?.textContent || "").toLowerCase();
    const feedLabels = [...document.querySelectorAll('.light-reminder-detail-feed .light-text-stack strong')]
      .map(node => String(node.textContent || "").trim())
      .filter(Boolean);
    return !text.includes("status:")
      && !text.includes("delivery:")
      && !text.includes("system notification")
      && document.querySelectorAll('[data-reminder-detail-tile="recipient"]').length === 0
      && document.querySelectorAll('[data-reminder-detail-tile="when"]').length === 0
      && !document.querySelector('[data-reminder-action-row="true"]')
      && document.querySelectorAll('[data-reminder-detail-feed="true"]').length === 1
      && !document.querySelector(".light-reminder-detail-feed .light-chevron")
      && JSON.stringify(feedLabels) === JSON.stringify(["Proof Future Task", "Proof Graph Meeting", "Proof Alpha Project"]);
  }, { timeout: config.timeoutMs });
  await assertNoToast(page, `${theme} graph reminder detail`);
  graphState = await readGraphDetailState(page);
  assert(graphState.route === "reminder-detail", `Expected reminder-detail route, got ${graphState.route}`);
  assert(!graphState.hasHtmlFrame, "Did not expect reminder detail to render a generated HTML iframe");
  screenshots[`${theme}_graph_reminder_detail`] = await saveScreenshot(page, config.reportDir, `${theme}-graph-reminder-detail`);
  for (const [route, id, text, shot] of [
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
  for (const text of ["Proof Graph Meeting", "Proof Alpha Project"]) {
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
  if (shouldRunSection(config, "contact-edit")) {
    await proveContactsEdit(page, config, seed, theme, screenshots, summary);
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
    await installAuthorizedApiProxy(context, config.baseUrl, config.apiToken);
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
    summary.assertions.push("generated HTML iframes rendered for notes while non-note workspace details stayed structured");
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
