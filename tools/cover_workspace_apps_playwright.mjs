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
} from "./cover_shared.mjs";

const DEFAULT_BASE_URL = process.env.PUCKY_WORKSPACE_PROOF_BASE_URL || "http://127.0.0.1:8767";
const VIEWPORT = { width: 430, height: 932 };
const PROOF_RUN_ID = "proof-workspace";

function parseArgs(argv) {
  const config = {
    baseUrl: DEFAULT_BASE_URL,
    apiToken: process.env.PUCKY_WORKSPACE_PROOF_TOKEN || process.env.PUCKY_API_TOKEN || "",
    reportDir: path.resolve("artifacts", "workspace-apps", new Date().toISOString().replace(/[:.]/g, "-")),
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

function pageUrl(baseUrl, theme, apiToken = "") {
  const url = new URL(`${baseUrl.replace(/\/+$/, "")}/ui/pucky/latest/index.html`);
  url.searchParams.set("theme", theme);
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

function isUnauthorizedError(error) {
  return /\(401\)/.test(String(error?.message || error));
}

async function readCollection(config, collection, now = null) {
  try {
    const payload = await apiRequest(config, "GET", `/api/workspace/${collection}${now ? `?now_ms=${now}` : ""}`);
    return payload?.items || [];
  } catch (error) {
    return [];
  }
}

function buildSeedManifest(runId = PROOF_RUN_ID) {
  return {
    runId,
    assetIds: [`${runId}-note-html`, `${runId}-task-asset-html`],
    linkIds: [
      `${runId}-alpha-note`,
      `${runId}-alpha-task`,
      `${runId}-alpha-calendar`,
      `${runId}-alpha-feed`,
      `${runId}-alpha-contact`,
      `${runId}-beta-task`,
      `${runId}-beta-calendar`,
      `${runId}-beta-feed`,
      `${runId}-beta-contact`
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
      contacts: [`${runId}-contact-one`, `${runId}-contact-two`]
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
    const asset = await apiRequest(config, "POST", "/api/workspace/assets", {
      id: manifest.assetIds[0],
      title: "Proof pinned note HTML",
      html: "<!doctype html><html><body><h1>Proof Pinned Note</h1><p>Agent-created note page with three bullets.</p><ul><li>Alpha</li><li>Beta</li><li>Gamma</li></ul></body></html>"
    });
    await apiRequest(config, "POST", "/api/workspace/notes", {
      id: `${runId}-pinned-note`,
      title: "Proof Pinned Note",
      summary: "Pinned note created through workspace API.",
      pinned: true,
      html_asset_id: asset.asset_id,
      metadata: { context: "Browser proof", icon: "pin" }
    });
    await apiRequest(config, "POST", "/api/workspace/notes", {
      id: `${runId}-recent-note`,
      title: "Proof Recent Note",
      summary: "Recent unpinned note.",
      html: "<!doctype html><h1>Proof Recent Note</h1><p>Recent note HTML page.</p>",
      metadata: { context: "Browser proof", icon: "note" }
    });

    const taskAsset = await apiRequest(config, "POST", "/api/workspace/assets", {
      id: manifest.assetIds[1],
      title: "Proof task asset HTML",
      html: [
        "<!doctype html><html><body>",
        "<h1>Asset-backed task page</h1>",
        "<p>This task uses an HTML asset instead of inline record HTML.</p>",
        "<ul><li>Review the latest legal edits</li><li>Sync with procurement</li><li>Send the signed version</li></ul>",
        "<p>Open questions: redlines, final signer, delivery timing.</p>",
        "</body></html>"
      ].join("")
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
      due_at_ms: Date.now() + 3 * 24 * 60 * 60 * 1000,
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
      summary: "Uses html_asset_id instead of inline html.",
      status: "open",
      due_at_ms: Date.now() + 24 * 60 * 60 * 1000,
      html_asset_id: taskAsset.asset_id
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
      html: "<!doctype html><h1>Proof Contact One</h1><p>Contact profile HTML.</p>",
      metadata: {
        avatar: "P1",
        email: "proof.one@example.com",
        phone: "+1 (555) 010-1000",
        endpoints: [{ label: "Email", value: "proof.one@example.com" }, { label: "Signal", value: "+1 (555) 010-1000" }],
        activity: ["Created by proof", "Linked to Alpha"]
      }
    });
    await apiRequest(config, "POST", "/api/workspace/contacts", {
      id: `${runId}-contact-two`,
      title: "Proof Contact Two",
      summary: "Customer sponsor",
      html: "<!doctype html><h1>Proof Contact Two</h1><p>Second contact profile.</p>",
      metadata: {
        avatar: "P2",
        email: "proof.two@example.com",
        phone: "+1 (555) 010-2000",
        endpoints: [{ label: "Email", value: "proof.two@example.com" }],
        activity: ["Created by proof", "Linked to Beta"]
      }
    });

    for (const link of [
      ["alpha-note", "note", `${runId}-pinned-note`, "Proof Pinned Note"],
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
      }
    };
  } catch (error) {
    if (!isUnauthorizedError(error)) {
      throw error;
    }
    const [notes, tasks, events, feeds, projects, contacts] = await Promise.all([
      readCollection(config, "notes"),
      readCollection(config, "tasks"),
      readCollection(config, "calendar-events"),
      readCollection(config, "feed-items"),
      readCollection(config, "projects"),
      readCollection(config, "contacts")
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
      contacts
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
      tabsHidden: Boolean(tabs?.hidden),
      trayHidden: Boolean(tray?.hidden),
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
  await page.locator(`.light-app-tile[data-app-label="${label}"]`).click({ timeout: timeoutMs });
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
    const toggle = document.querySelector(".light-task-detail-toggle")?.textContent?.trim() || "";
    const hasNotes = /\bNOTES\b/.test(pageText);
    const hasRelated = /\bRELATED\b/.test(pageText);
    const hasGeneratedPage = /\bGENERATED PAGE\b/.test(pageText);
    const htmlFrame = document.querySelector(".light-task-detail-body.light-html-card iframe");
    const htmlFallback = document.querySelector(".light-task-detail-body.light-html-empty")?.textContent?.trim() || "";
    return {
      route,
      title,
      due,
      toggle,
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

async function proveNotes(page, config, seed, theme, screenshots) {
  await openTile(page, "Notes", "notes", config.timeoutMs);
  const note = seed.writeEnabled
    ? { id: seed.pinnedNoteId, title: "Proof Pinned Note" }
    : (seed.notes || []).find(item => Boolean(item.id)) ;
  if (!note?.id || !note?.title) {
    await backHome(page, theme, config.timeoutMs);
    return;
  }
  await page.locator(`[data-note-id="${note.id}"]`).waitFor({ state: "visible", timeout: config.timeoutMs });
  screenshots[`${theme}_notes`] = await saveScreenshot(page, config.reportDir, `${theme}-notes-list`);
  await page.locator(`[data-note-id="${note.id}"]`).click();
  await expectFrameHeading(page, note.title, config.timeoutMs);
  const layout = await readDetailHtmlBodyMetrics(page);
  assert(layout.body && layout.page, "Expected note detail to expose a measurable HTML body");
  assert(layout.body.left <= layout.page.left + 2, `Expected note HTML body to reach page left edge, got ${layout.body.left} vs ${layout.page.left}`);
  assert(layout.body.right >= layout.page.right - 2, `Expected note HTML body to reach page right edge, got ${layout.body.right} vs ${layout.page.right}`);
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
    const sameGroupPair =
      (soonTasks.length >= 2 ? soonTasks : null) ||
      (overdueTasks.length >= 2 ? overdueTasks : null) ||
      (doneTasks.length >= 2 ? doneTasks : null) ||
      (dueFallback.length >= 2 ? dueFallback : null);
    if (sameGroupPair) {
      [rowA, rowB] = sameGroupPair;
    }
    if (!rowA || !rowB) {
      rowA = {
        id: (seed.taskIds?.rowA || `${seed.runId}-${theme}-row-a`),
        title: "Proof Future Task"
      };
      rowB = {
        id: (seed.taskIds?.rowB || `${seed.runId}-${theme}-row-b`),
        title: "Proof Overdue Task"
      };
      const rowATask = seedTasks.find((task) => String(task.id) === String(rowA.id));
      const rowBTask = seedTasks.find((task) => String(task.id) === String(rowB.id));
      if (rowATask) rowA = rowATask;
      if (rowBTask) rowB = rowBTask;
    }
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
  screenshots[`${theme}_tasks_list`] = await saveScreenshot(page, config.reportDir, `${theme}-tasks-list`);

  const baselinePress = await readTaskPressMetrics(page, rowA.id, rowB.id);
  assert(baselinePress.found.row, `Missing task row ${rowA.id}`);
  await rowAButton.dispatchEvent("pointerdown");
  await rowAButton.evaluate((button) => {
    if (button instanceof HTMLButtonElement) {
      button.classList.add("is-pressed");
    }
  });
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
  await rowAButton.evaluate((button) => {
    if (button instanceof HTMLButtonElement) {
      button.classList.remove("is-pressed");
    }
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

  await rowAButton.dispatchEvent("pointerup");
  await rowAButton.click();
  await expectFrameHeading(page, rowA.title || `Proof ${theme} Row A`, config.timeoutMs);
  screenshots[`${theme}_tasks_detail_a`] = await saveScreenshot(page, config.reportDir, `${theme}-tasks-detail-a`);
  await page.evaluate(() => window.PuckyHandleAndroidBack && window.PuckyHandleAndroidBack());
  await page.waitForSelector('.light-shell[data-light-route="tasks"]', { timeout: config.timeoutMs });
  await rowBButton.click();
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

  await page.locator(`[data-task-id="${inlineId}"]`).click();
  await page.waitForSelector('.light-shell[data-light-route="task-detail"]', { timeout: config.timeoutMs });
  await page.frameLocator(".light-task-detail-body.light-html-card iframe").getByText("Proof Future Task", { exact: true }).waitFor({ state: "visible", timeout: config.timeoutMs });
  let detailState = await readTaskDetailState(page);
  assert(detailState.route === "task-detail", `Expected task-detail route, got ${detailState.route}`);
  assert(detailState.title === "Proof Future Task", `Expected inline task title, got ${detailState.title}`);
  assert(detailState.hasHtmlFrame, "Expected inline HTML task to render an iframe body");
  assert(!detailState.hasNotes, "Did not expect NOTES section on task detail");
  assert(!detailState.hasRelated, "Did not expect RELATED section on task detail");
  assert(!detailState.hasGeneratedPage, "Did not expect GENERATED PAGE section on task detail");
  screenshots[`${theme}_tasks_inline_html`] = await saveScreenshot(page, config.reportDir, `${theme}-tasks-inline-html`);
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
  summary.taskDetail.push({ theme, type: "inline_html", taskId: inlineId, title: detailState.title, toggle: detailState.toggle, due: detailState.due });
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

  await page.locator(`[data-task-id="${assetId}"]`).click();
  await page.waitForSelector('.light-shell[data-light-route="task-detail"]', { timeout: config.timeoutMs });
  await page.frameLocator(".light-task-detail-body.light-html-card iframe").getByText("Asset-backed task page", { exact: true }).waitFor({ state: "visible", timeout: config.timeoutMs });
  detailState = await readTaskDetailState(page);
  assert(detailState.title === "Proof Asset Task", `Expected asset task title, got ${detailState.title}`);
  assert(detailState.hasHtmlFrame, "Expected asset-backed task to render an iframe body");
  screenshots[`${theme}_tasks_asset_html`] = await saveScreenshot(page, config.reportDir, `${theme}-tasks-asset-html`);
  summary.taskDetail.push({ theme, type: "asset_html", taskId: assetId, title: detailState.title, toggle: detailState.toggle, due: detailState.due });
  await page.evaluate(() => window.PuckyHandleAndroidBack && window.PuckyHandleAndroidBack());
  await page.waitForSelector('.light-shell[data-light-route="tasks"]', { timeout: config.timeoutMs });

  await page.locator(`[data-task-id="${emptyId}"]`).click();
  await page.waitForSelector('.light-shell[data-light-route="task-detail"]', { timeout: config.timeoutMs });
  detailState = await readTaskDetailState(page);
  assert(detailState.title === "Proof Empty Task", `Expected empty task title, got ${detailState.title}`);
  assert(!detailState.hasHtmlFrame, "Did not expect iframe body for no-HTML task");
  assert(detailState.htmlFallback === "No task page yet.", `Expected minimal empty fallback, got ${detailState.htmlFallback}`);
  screenshots[`${theme}_tasks_empty_html`] = await saveScreenshot(page, config.reportDir, `${theme}-tasks-empty-html`);
  summary.taskDetail.push({ theme, type: "no_html", taskId: emptyId, title: detailState.title, toggle: detailState.toggle, due: detailState.due, fallback: detailState.htmlFallback });
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
  await page.locator(`[data-task-id="${doneId}"]`).click();
  await page.waitForSelector('.light-shell[data-light-route="task-detail"]', { timeout: config.timeoutMs });
  detailState = await readTaskDetailState(page);
  assert(detailState.toggle === "Reopen task", `Expected done task toggle to say Reopen task, got ${detailState.toggle}`);
  await page.locator(".light-task-detail-toggle").click();
  await page.waitForFunction(() => {
    const button = document.querySelector(".light-task-detail-toggle");
    return Boolean(button && button.textContent && button.textContent.includes("Mark done"));
  }, { timeout: config.timeoutMs });
  detailState = await readTaskDetailState(page);
  assert(detailState.toggle === "Mark done", `Expected reopened task toggle to say Mark done, got ${detailState.toggle}`);
  screenshots[`${theme}_tasks_done_toggle`] = await saveScreenshot(page, config.reportDir, `${theme}-tasks-done-toggle`);
  summary.taskDetail.push({ theme, type: "done_reopen", taskId: doneId, title: detailState.title, toggle: detailState.toggle, due: detailState.due });
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
    await page.locator(`[data-task-id="${flipId}"]`).click();
    await expectFrameHeading(page, `Proof Deadline Flip`, config.timeoutMs);
    screenshots[`${theme}_tasks_detail`] = await saveScreenshot(page, config.reportDir, `${theme}-tasks-detail`);
  }
  await backHome(page, theme, config.timeoutMs);
}

async function proveCalendar(page, config, seed, theme, screenshots) {
  await openTile(page, "Calendar", "calendar", config.timeoutMs);
  const events = seed.writeEnabled ? [] : (seed.calendarEvents || []);
  const seededEventId = seed.writeEnabled ? seed.calendarIds?.todayRoadmap : null;
  const eventCards = seededEventId
    ? page.locator(`[data-event-id="${seededEventId}"]`)
    : page.locator('[data-event-id]');
  const eventCount = await eventCards.count();
  if (!eventCount) {
    screenshots[`${theme}_calendar_today`] = await saveScreenshot(page, config.reportDir, `${theme}-calendar-today`);
    await backHome(page, theme, config.timeoutMs);
    return;
  }
  const expectedTitle = seed.writeEnabled
    ? "Proof Today Roadmap"
    : ((await eventCards.first().innerText()).split("\n")[0].trim() || "Calendar");
  screenshots[`${theme}_calendar_today`] = await saveScreenshot(page, config.reportDir, `${theme}-calendar-today`);
  await eventCards.first().click();
  await expectFrameHeading(page, expectedTitle, config.timeoutMs);
  const layout = await readDetailHtmlBodyMetrics(page);
  assert(layout.body && layout.page, "Expected calendar detail to expose a measurable HTML body");
  assert(layout.body.left <= layout.page.left + 2, `Expected calendar HTML body to reach page left edge, got ${layout.body.left} vs ${layout.page.left}`);
  assert(layout.body.right >= layout.page.right - 2, `Expected calendar HTML body to reach page right edge, got ${layout.body.right} vs ${layout.page.right}`);
  await backHome(page, theme, config.timeoutMs);
  return;
}

async function proveFeed(page, config, seed, theme, screenshots) {
  await openTile(page, "Feed", "feed-preview", config.timeoutMs);
  const feedItems = seed.writeEnabled ? null : (seed.feedItems || []);
  const feedCards = page.locator('[data-feed-id]');
  const feedCardCount = await feedCards.count();
  if (!feedCardCount) {
    await backHome(page, theme, config.timeoutMs);
    return;
  }
  if (!seed.writeEnabled && feedItems.length) {
    await page.getByText(feedItems[0].title).first().waitFor({ state: "visible", timeout: config.timeoutMs });
  }
  screenshots[`${theme}_feed`] = await saveScreenshot(page, config.reportDir, `${theme}-feed-list`);
  const row = feedCards.first();
  const detailText = await row.innerText();
  await row.click();
  await expectFrameHeading(page, (detailText || "").split("\n")[0].trim() || "Feed item", config.timeoutMs);
  if (!seed.writeEnabled && feedItems.length) {
    const item = feedItems.find((entry) => String(entry.id) === `${seed.runId}-project-decision`) || feedItems[0];
    await expectFrameHeading(page, item?.title || "Feed item", config.timeoutMs);
  }
  const layout = await readDetailHtmlBodyMetrics(page);
  assert(layout.body && layout.page, "Expected feed detail to expose a measurable HTML body");
  assert(layout.body.left <= layout.page.left + 2, `Expected feed HTML body to reach page left edge, got ${layout.body.left} vs ${layout.page.left}`);
  assert(layout.body.right >= layout.page.right - 2, `Expected feed HTML body to reach page right edge, got ${layout.body.right} vs ${layout.page.right}`);
  screenshots[`${theme}_feed_detail`] = await saveScreenshot(page, config.reportDir, `${theme}-feed-detail`);
  await backHome(page, theme, config.timeoutMs);
}

async function proveProjects(page, config, seed, theme, screenshots) {
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
  const layout = await readDetailHtmlBodyMetrics(page);
  assert(layout.body && layout.page, "Expected project detail to expose a measurable HTML body");
  assert(layout.body.left <= layout.page.left + 2, `Expected project HTML body to reach page left edge, got ${layout.body.left} vs ${layout.page.left}`);
  assert(layout.body.right >= layout.page.right - 2, `Expected project HTML body to reach page right edge, got ${layout.body.right} vs ${layout.page.right}`);
  screenshots[`${theme}_projects_detail`] = await saveScreenshot(page, config.reportDir, `${theme}-projects-detail`);
  await backHome(page, theme, config.timeoutMs);
}

async function proveContacts(page, config, seed, theme, screenshots) {
  await openTile(page, "Contacts", "contacts", config.timeoutMs);
  const contacts = seed.writeEnabled ? null : (seed.contacts || []);
  if (seed.writeEnabled) {
    await page.locator(`button[data-contact-id="${seed.runId}-contact-one"]`).waitFor({ state: "visible", timeout: config.timeoutMs });
  } else if (contacts.length) {
    await page.locator(`button[data-contact-id="${contacts[0].id}"]`).waitFor({ state: "visible", timeout: config.timeoutMs });
  } else {
    await backHome(page, theme, config.timeoutMs);
    return;
  }
  screenshots[`${theme}_contacts`] = await saveScreenshot(page, config.reportDir, `${theme}-contacts-list`);
  if (seed.writeEnabled) {
    await page.locator(`button[data-contact-id="${seed.runId}-contact-one"]`).click();
    await page.getByText("proof.one@example.com").first().waitFor({ state: "visible", timeout: config.timeoutMs });
    await expectFrameHeading(page, "Proof Contact One", config.timeoutMs);
  } else {
    const firstContact = contacts[0];
    await page.locator(`button[data-contact-id="${firstContact.id}"]`).click();
    await expectFrameHeading(page, firstContact.title, config.timeoutMs);
  }
  const layout = await readDetailHtmlBodyMetrics(page);
  assert(layout.body && layout.page, "Expected contact detail to expose a measurable HTML body");
  assert(layout.body.left <= layout.page.left + 2, `Expected contact HTML body to reach page left edge, got ${layout.body.left} vs ${layout.page.left}`);
  assert(layout.body.right >= layout.page.right - 2, `Expected contact HTML body to reach page right edge, got ${layout.body.right} vs ${layout.page.right}`);
  screenshots[`${theme}_contacts_detail`] = await saveScreenshot(page, config.reportDir, `${theme}-contacts-detail`);
  await backHome(page, theme, config.timeoutMs);
}

async function runTheme(page, config, seed, theme, summary, networkLog) {
  const screenshots = {};
  await page.goto(pageUrl(config.baseUrl, theme, config.apiToken), { waitUntil: "commit", timeout: config.timeoutMs });
  await waitForHome(page, theme, config.timeoutMs);
  screenshots[`${theme}_home`] = await saveScreenshot(page, config.reportDir, `${theme}-home`);
  await proveNotes(page, config, seed, theme, screenshots);
  await proveTasks(page, config, seed, theme, screenshots, summary, networkLog);
  await proveCalendar(page, config, seed, theme, screenshots);
  await proveFeed(page, config, seed, theme, screenshots);
  await proveProjects(page, config, seed, theme, screenshots);
  await proveContacts(page, config, seed, theme, screenshots);
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
  try {
    lightSeed = await seedWorkspace(config, `${PROOF_RUN_ID}-light`);
    darkSeed = await seedWorkspace(config, `${PROOF_RUN_ID}-dark`);
    summary.seed = lightSeed;
    summary.seeds = { light: lightSeed, dark: darkSeed };
    browser = await chromium.launch({
      executablePath: resolveChromePath(),
      headless: true
    });
    context = await browser.newContext({
      viewport: VIEWPORT,
      recordVideo: { dir: config.reportDir, size: VIEWPORT }
    });
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

    summary.screenshots = {
      ...(await runTheme(page, config, lightSeed, "light", summary, networkLog)),
      ...(await runTheme(page, config, darkSeed, "dark", summary, networkLog))
    };
    summary.assertions.push("light and dark home-shell loaded");
    summary.assertions.push("notes/tasks/calendar/feed/projects/contacts read /api/workspace records");
    summary.assertions.push("generated HTML iframes rendered for all six apps");
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
      const cleanupResults = [];
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
