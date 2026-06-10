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

function parseArgs(argv) {
  const config = {
    baseUrl: DEFAULT_BASE_URL,
    apiToken: process.env.PUCKY_WORKSPACE_PROOF_TOKEN || process.env.PUCKY_API_TOKEN || "proof-token",
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

function pageUrl(baseUrl, theme) {
  const url = new URL(`${baseUrl.replace(/\/+$/, "")}/ui/pucky/latest/index.html`);
  url.searchParams.set("theme", theme);
  url.searchParams.set("reset_nav", "1");
  return url.toString();
}

async function apiRequest(config, method, apiPath, body = undefined) {
  const response = await fetch(`${config.baseUrl}${apiPath}`, {
    method,
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${config.apiToken}`,
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

async function seedWorkspace(config) {
  const runId = `proof-${Date.now()}`;
  const today = dateKey(new Date());
  const tomorrow = dateKey(new Date(Date.now() + 24 * 60 * 60 * 1000));

  const asset = await apiRequest(config, "POST", "/api/workspace/assets", {
    id: `${runId}-note-html`,
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

  await apiRequest(config, "POST", "/api/workspace/tasks", {
    id: `${runId}-overdue-task`,
    title: "Proof Overdue Task",
    summary: "Starts overdue.",
    status: "open",
    due_at_ms: Date.now() - 60_000,
    html: "<!doctype html><h1>Proof Overdue Task</h1>"
  });
  await apiRequest(config, "POST", "/api/workspace/tasks", {
    id: `${runId}-future-task`,
    title: "Proof Future Task",
    summary: "Due later.",
    status: "open",
    due_at_ms: Date.now() + 3 * 24 * 60 * 60 * 1000,
    html: "<!doctype html><h1>Proof Future Task</h1>"
  });
  await apiRequest(config, "POST", "/api/workspace/tasks", {
    id: `${runId}-done-task`,
    title: "Proof Done Task",
    summary: "Done stays done even after deadline.",
    status: "done",
    due_at_ms: Date.now() - 120_000,
    html: "<!doctype html><h1>Proof Done Task</h1>"
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

  return { runId, today, tomorrow };
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
  await page.frameLocator(".light-html-frame").locator(`text=${text}`).first().waitFor({ state: "visible", timeout: timeoutMs });
}

async function proveNotes(page, config, seed, theme, screenshots) {
  await openTile(page, "Notes", "notes", config.timeoutMs);
  await page.getByText("Proof Pinned Note").waitFor({ state: "visible", timeout: config.timeoutMs });
  screenshots[`${theme}_notes`] = await saveScreenshot(page, config.reportDir, `${theme}-notes-list`);
  await page.locator(`[data-note-id="${seed.runId}-pinned-note"]`).click();
  await expectFrameHeading(page, "Proof Pinned Note", config.timeoutMs);
  screenshots[`${theme}_notes_detail`] = await saveScreenshot(page, config.reportDir, `${theme}-notes-detail`);
  await backHome(page, theme, config.timeoutMs);
}

async function proveTasks(page, config, seed, theme, screenshots) {
  const flipId = `${seed.runId}-${theme}-deadline-flip`;
  await apiRequest(config, "POST", "/api/workspace/tasks", {
    id: flipId,
    title: `Proof ${theme} Deadline Flip`,
    summary: "Moves to overdue after timestamp passes.",
    status: "open",
    due_at_ms: Date.now() + 5500,
    html: `<!doctype html><h1>Proof ${theme} Deadline Flip</h1>`
  });
  await openTile(page, "Tasks", "tasks", config.timeoutMs);
  for (const label of ["DO", "DO SOON", "OVERDUE", "DONE"]) {
    await page.getByText(label, { exact: true }).waitFor({ state: "visible", timeout: config.timeoutMs });
  }
  await page.locator(`[data-task-id="${flipId}"]`).waitFor({ state: "visible", timeout: config.timeoutMs });
  screenshots[`${theme}_tasks_before`] = await saveScreenshot(page, config.reportDir, `${theme}-tasks-before-deadline`);
  await page.waitForTimeout(8500);
  await page.waitForFunction((taskId) => {
    const row = document.querySelector(`[data-task-id="${taskId}"]`);
    return Boolean(row && row.classList.contains("overdue"));
  }, flipId, { timeout: config.timeoutMs });
  screenshots[`${theme}_tasks_after`] = await saveScreenshot(page, config.reportDir, `${theme}-tasks-after-deadline`);
  await page.locator(`[data-task-id="${flipId}"]`).click();
  await expectFrameHeading(page, `Proof ${theme} Deadline Flip`, config.timeoutMs);
  screenshots[`${theme}_tasks_detail`] = await saveScreenshot(page, config.reportDir, `${theme}-tasks-detail`);
  await backHome(page, theme, config.timeoutMs);
}

async function proveCalendar(page, config, seed, theme, screenshots) {
  await openTile(page, "Calendar", "calendar", config.timeoutMs);
  await page.getByText("Proof Today Roadmap").waitFor({ state: "visible", timeout: config.timeoutMs });
  await page.getByText("Proof Overlap Event").waitFor({ state: "visible", timeout: config.timeoutMs });
  screenshots[`${theme}_calendar_today`] = await saveScreenshot(page, config.reportDir, `${theme}-calendar-today`);
  await page.locator(`[data-event-id="${seed.runId}-today-overlap"]`).click();
  await expectFrameHeading(page, "Proof Overlap Event", config.timeoutMs);
  screenshots[`${theme}_calendar_detail`] = await saveScreenshot(page, config.reportDir, `${theme}-calendar-detail`);
  await page.evaluate(() => window.PuckyHandleAndroidBack && window.PuckyHandleAndroidBack());
  await page.getByText("Choose date").click();
  await page.locator(`.light-date-cell[data-date="${seed.tomorrow}"]`).click();
  await page.getByText("Proof Tomorrow Event").waitFor({ state: "visible", timeout: config.timeoutMs });
  screenshots[`${theme}_calendar_tomorrow`] = await saveScreenshot(page, config.reportDir, `${theme}-calendar-tomorrow`);
  await backHome(page, theme, config.timeoutMs);
}

async function proveFeed(page, config, seed, theme, screenshots) {
  await openTile(page, "Feed", "feed-preview", config.timeoutMs);
  for (const text of ["Proof Note Feed", "Proof Project Decision", "Proof Calendar Change"]) {
    await page.getByText(text).waitFor({ state: "visible", timeout: config.timeoutMs });
  }
  screenshots[`${theme}_feed`] = await saveScreenshot(page, config.reportDir, `${theme}-feed-list`);
  await page.locator(`[data-feed-id="${seed.runId}-project-decision"]`).click();
  await expectFrameHeading(page, "Proof Project Decision", config.timeoutMs);
  screenshots[`${theme}_feed_detail`] = await saveScreenshot(page, config.reportDir, `${theme}-feed-detail`);
  await backHome(page, theme, config.timeoutMs);
}

async function proveProjects(page, config, seed, theme, screenshots) {
  await openTile(page, "Projects", "projects", config.timeoutMs);
  await page.getByText("Proof Alpha Project").waitFor({ state: "visible", timeout: config.timeoutMs });
  await page.getByText("Proof Beta Project").waitFor({ state: "visible", timeout: config.timeoutMs });
  screenshots[`${theme}_projects`] = await saveScreenshot(page, config.reportDir, `${theme}-projects-list`);
  await page.locator(`[data-project-id="${seed.runId}-alpha-project"]`).click();
  for (const text of ["Alpha kickoff", "Alpha launch", "Proof Future Task", "Proof Today Roadmap", "Proof Project Decision", "Proof Contact One"]) {
    await page.getByText(text).waitFor({ state: "visible", timeout: config.timeoutMs });
  }
  await expectFrameHeading(page, "Proof Alpha Project", config.timeoutMs);
  screenshots[`${theme}_projects_detail`] = await saveScreenshot(page, config.reportDir, `${theme}-projects-detail`);
  await backHome(page, theme, config.timeoutMs);
}

async function proveContacts(page, config, seed, theme, screenshots) {
  await openTile(page, "Contacts", "contacts", config.timeoutMs);
  await page.getByText("Proof Contact One").waitFor({ state: "visible", timeout: config.timeoutMs });
  screenshots[`${theme}_contacts`] = await saveScreenshot(page, config.reportDir, `${theme}-contacts-list`);
  await page.locator(`button[data-contact-id="${seed.runId}-contact-one"]`).click();
  await page.getByText("proof.one@example.com").first().waitFor({ state: "visible", timeout: config.timeoutMs });
  await expectFrameHeading(page, "Proof Contact One", config.timeoutMs);
  screenshots[`${theme}_contacts_detail`] = await saveScreenshot(page, config.reportDir, `${theme}-contacts-detail`);
  await backHome(page, theme, config.timeoutMs);
}

async function runTheme(page, config, seed, theme) {
  const screenshots = {};
  await page.goto(pageUrl(config.baseUrl, theme), { waitUntil: "commit", timeout: config.timeoutMs });
  await waitForHome(page, theme, config.timeoutMs);
  screenshots[`${theme}_home`] = await saveScreenshot(page, config.reportDir, `${theme}-home`);
  await proveNotes(page, config, seed, theme, screenshots);
  await proveTasks(page, config, seed, theme, screenshots);
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
    assertions: []
  };

  let browser;
  let context;
  try {
    const seed = await seedWorkspace(config);
    summary.seed = seed;
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
        networkLog.push({ type: "request", method: request.method(), url, at: new Date().toISOString() });
      }
    });
    page.on("response", response => {
      const url = response.url();
      if (url.includes("/api/workspace/")) {
        networkLog.push({ type: "response", status: response.status(), url, at: new Date().toISOString() });
      }
    });

    summary.screenshots = {
      ...(await runTheme(page, config, seed, "light")),
      ...(await runTheme(page, config, seed, "dark"))
    };
    summary.assertions.push("light and dark home-shell loaded");
    summary.assertions.push("notes/tasks/calendar/feed/projects/contacts read /api/workspace records");
    summary.assertions.push("generated HTML iframes rendered for all six apps");
    summary.assertions.push("near-future task moved to overdue after deadline refresh");
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
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
