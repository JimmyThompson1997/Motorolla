import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

import { ensureDir, resolveChromePath } from "../../support/cover_shared.mjs";

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../..");

function loadPlaywrightCore() {
  const bundled = path.join(os.homedir(), ".cache", "codex-runtimes", "codex-primary-runtime", "dependencies", "node", "node_modules", "playwright-core");
  const candidates = [
    () => require("playwright-core"),
    () => require(bundled)
  ];
  for (const candidate of candidates) {
    try {
      return candidate();
    } catch {
      // Try the next resolution path.
    }
  }
  throw new Error("Could not resolve playwright-core from local tools or bundled runtime");
}

const { chromium } = loadPlaywrightCore();

const VIEWPORTS = [
  { label: "desktop", width: 1280, height: 900, isMobile: false },
  { label: "mobile", width: 390, height: 844, isMobile: true, hasTouch: true }
];

const THEMES = ["light", "dark"];
const DEFAULT_BASE_URL = "http://127.0.0.1:57676";
const DEFAULT_REPORT_DIR = path.join(repoRoot, ".tmp", "projects-pin-proof");

function parseArgs(argv) {
  const config = {
    baseUrl: DEFAULT_BASE_URL,
    apiToken: "",
    reportDir: DEFAULT_REPORT_DIR,
    headless: true,
    timeoutMs: 15_000,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = String(argv[index] || "");
    const next = argv[index + 1];
    if (arg === "--base-url" && next) {
      config.baseUrl = String(next);
      index += 1;
      continue;
    }
    if (arg === "--api-token" && next) {
      config.apiToken = String(next);
      index += 1;
      continue;
    }
    if (arg === "--report-dir" && next) {
      config.reportDir = path.resolve(String(next));
      index += 1;
      continue;
    }
    if (arg === "--headed") {
      config.headless = false;
      continue;
    }
    if (arg === "--timeout-ms" && next) {
      config.timeoutMs = Math.max(5_000, Number(next) || config.timeoutMs);
      index += 1;
    }
  }
  if (!config.apiToken) {
    config.apiToken = String(
      process.env.PUCKY_WORKSPACE_PROOF_TOKEN
      || process.env.PUCKY_API_TOKEN
      || process.env.PUCKY_OPERATOR_TOKEN
      || ""
    ).trim();
  }
  if (!config.apiToken) {
    throw new Error("Projects pin proof requires --api-token or PUCKY_WORKSPACE_PROOF_TOKEN/PUCKY_API_TOKEN/PUCKY_OPERATOR_TOKEN");
  }
  config.baseUrl = String(config.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, "");
  return config;
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
    await apiRequest(config, "DELETE", `/api/workspace/${collection}/${encodeURIComponent(recordId)}`);
  } catch (error) {
    const message = String(error?.message || error || "");
    if (!/\(404\)/.test(message)) {
      throw error;
    }
  }
}

function buildSeed(runId) {
  return {
    pinned: {
      id: `${runId}-pinned-project`,
      title: "Proof pinned project",
      summary: "Pinned baseline project for the browser proof.",
      pinned: true,
      metadata: {
        threads: ["Pinned thread"],
        assets: ["Pinned asset"]
      }
    },
    recent: {
      id: `${runId}-recent-project`,
      title: "Proof recent project",
      summary: "Recent project that gets pinned and unpinned.",
      pinned: false,
      metadata: {
        threads: ["Recent thread"],
        assets: ["Recent asset"]
      }
    },
    failure: {
      id: `${runId}-failure-project`,
      title: "Proof failure project",
      summary: "Recent project used for rollback coverage.",
      pinned: false,
      metadata: {
        threads: ["Failure thread"],
        assets: ["Failure asset"]
      }
    }
  };
}

async function seedProjects(config, runId) {
  const seed = buildSeed(runId);
  for (const project of Object.values(seed)) {
    await deleteWorkspaceRecord(config, "projects", project.id);
    await apiRequest(config, "POST", "/api/workspace/projects", project);
  }
  return seed;
}

async function cleanupProjects(config, seed) {
  for (const project of Object.values(seed || {})) {
    await deleteWorkspaceRecord(config, "projects", project.id);
  }
}

function buildProjectsUrl(config, theme) {
  const url = new URL(`${config.baseUrl}/ui/pucky/latest/index.html`);
  url.searchParams.set("route", "projects");
  url.searchParams.set("theme", String(theme || "light"));
  url.searchParams.set("reset_nav", "1");
  url.searchParams.set("api_token", config.apiToken);
  return url.toString();
}

async function waitForRoute(page, route, timeoutMs) {
  await page.locator(`.light-shell[data-light-route="${route}"]`).waitFor({ state: "visible", timeout: timeoutMs });
}

async function saveScreenshot(page, dir, name) {
  const target = path.join(dir, name);
  await page.screenshot({ path: target, fullPage: true });
  return target;
}

async function waitForProofRows(page, runId, timeoutMs) {
  const selector = `.light-project-row[data-project-id^="${runId}-"]`;
  await page.locator(selector).first().waitFor({ state: "visible", timeout: timeoutMs });
}

async function waitForCondition(fn, timeoutMs, message) {
  const startedAt = Date.now();
  for (;;) {
    if (await fn()) {
      return;
    }
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error(message);
    }
    await new Promise(resolve => setTimeout(resolve, 120));
  }
}

async function readProjectsView(page, runId) {
  return page.evaluate(currentRunId => {
    const shell = document.querySelector(".light-shell");
    const sections = [...document.querySelectorAll(".light-projects-section")].map(section => {
      const key = String(section.getAttribute("data-projects-section") || "");
      const header = section.querySelector(".light-projects-section-header");
      const rows = [...section.querySelectorAll(".light-project-row")].map(row => ({
        id: String(row.getAttribute("data-project-id") || ""),
        title: String(row.querySelector("strong")?.textContent || "").trim()
      }));
      return {
        key,
        expanded: header?.getAttribute("aria-expanded") === "true",
        rowIds: rows.map(row => row.id),
        rowTitles: rows.map(row => row.title)
      };
    });
    const rows = [...document.querySelectorAll(".light-project-row")].map(row => {
      const copy = row.querySelector(".light-project-feed-copy");
      const pin = row.querySelector(".light-project-pin-button");
      const summary = row.querySelector(".light-project-row-summary");
      const time = row.querySelector(".light-project-row-time");
      const copyRect = copy?.getBoundingClientRect();
      const pinRect = pin?.getBoundingClientRect();
      const pinStyle = pin ? window.getComputedStyle(pin) : null;
      return {
        id: String(row.getAttribute("data-project-id") || ""),
        title: String(row.querySelector("strong")?.textContent || "").trim(),
        pinned: String(row.getAttribute("data-project-pinned") || ""),
        summary: String(summary?.textContent || "").trim(),
        time: String(time?.textContent || "").trim(),
        copyRight: copyRect ? copyRect.right : 0,
        pinLeft: pinRect ? pinRect.left : 0,
        pinWidth: pinRect ? Math.round(pinRect.width) : 0,
        pinHeight: pinRect ? Math.round(pinRect.height) : 0,
        pinBackground: pinStyle ? pinStyle.backgroundColor : "",
        pinBorderWidth: pinStyle ? pinStyle.borderTopWidth : "",
        pinBorderRadius: pinStyle ? pinStyle.borderTopLeftRadius : "",
        pinBoxShadow: pinStyle ? pinStyle.boxShadow : "",
        leadingIcons: row.querySelectorAll(".light-small-icon").length
      };
    });
    const proofRows = rows.filter(row => row.id.startsWith(`${currentRunId}-`));
    const proofGroups = Object.fromEntries(
      sections.map(section => [
        section.key,
        section.rowTitles.filter((_, index) => section.rowIds[index].startsWith(`${currentRunId}-`))
      ])
    );
    return {
      route: String(shell?.getAttribute("data-light-route") || ""),
      sections,
      rows,
      proofRows,
      proofGroups,
      sectionKeys: sections.map(section => section.key)
    };
  }, runId);
}

function sectionState(view, key) {
  return view.sections.find(section => section.key === key) || { expanded: false, rowIds: [], rowTitles: [] };
}

async function openProjects(page, config, theme, timeoutMs) {
  await page.goto(buildProjectsUrl(config, theme), { waitUntil: "domcontentloaded", timeout: timeoutMs });
  await waitForRoute(page, "projects", timeoutMs);
}

async function runViewportScenario(browser, config, runId, viewport, theme) {
  const scenarioDir = path.join(config.reportDir, `${viewport.label}-${theme}`);
  ensureDir(scenarioDir);
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    isMobile: Boolean(viewport.isMobile),
    hasTouch: Boolean(viewport.hasTouch)
  });
  const page = await context.newPage();
  const seed = await seedProjects(config, runId);
  const result = {
    viewport: viewport.label,
    theme,
    screenshots: {}
  };
  let failureIntercepted = false;
  try {
    await openProjects(page, config, theme, config.timeoutMs);
    await waitForProofRows(page, runId, config.timeoutMs);

    const baseline = await readProjectsView(page, runId);
    assert.equal(baseline.route, "projects", `${viewport.label}/${theme}: expected projects route`);
    assert(baseline.sectionKeys.includes("pinned"), `${viewport.label}/${theme}: expected pinned section`);
    assert(baseline.sectionKeys.includes("recent"), `${viewport.label}/${theme}: expected recent section`);
    assert.equal(sectionState(baseline, "pinned").expanded, true, `${viewport.label}/${theme}: pinned should default expanded`);
    assert.equal(sectionState(baseline, "recent").expanded, true, `${viewport.label}/${theme}: recent should default expanded`);
    assert.deepEqual(baseline.proofGroups.pinned, [seed.pinned.title], `${viewport.label}/${theme}: pinned proof rows did not start in the pinned section`);
    assert.deepEqual(baseline.proofGroups.recent, [seed.failure.title, seed.recent.title], `${viewport.label}/${theme}: recent proof rows did not start in updated order`);
    assert(baseline.proofRows.every(row => row.leadingIcons === 0), `${viewport.label}/${theme}: leading folder icon regression detected`);
    assert(baseline.proofRows.every(row => row.copyRight < row.pinLeft), `${viewport.label}/${theme}: project copy overlaps pin button`);
    assert(baseline.proofRows.every(row => row.pinWidth === 36 && row.pinHeight === 36), `${viewport.label}/${theme}: expected 36px project pin buttons`);
    assert(baseline.proofRows.every(row => row.pinBackground === "rgba(0, 0, 0, 0)"), `${viewport.label}/${theme}: expected transparent project pin buttons`);
    assert(baseline.proofRows.every(row => row.pinBorderWidth === "0px"), `${viewport.label}/${theme}: expected borderless project pin buttons`);
    assert(baseline.proofRows.every(row => row.pinBorderRadius === "0px"), `${viewport.label}/${theme}: expected uncapsuled project pin buttons`);
    assert(baseline.proofRows.every(row => row.pinBoxShadow === "none"), `${viewport.label}/${theme}: expected project pin buttons without shadow chrome`);
    result.screenshots.baseline = await saveScreenshot(page, scenarioDir, "baseline-projects-list.png");

    await page.locator('.light-projects-section-header[data-projects-section="pinned"]').click();
    const pinnedCollapsed = await readProjectsView(page, runId);
    assert.equal(pinnedCollapsed.route, "projects", `${viewport.label}/${theme}: pinned header click should not navigate`);
    assert.equal(sectionState(pinnedCollapsed, "pinned").expanded, false, `${viewport.label}/${theme}: Pinned section did not collapse`);
    assert.deepEqual(pinnedCollapsed.proofGroups.pinned, [], `${viewport.label}/${theme}: collapsed pinned section should hide proof rows`);
    result.screenshots.pinnedCollapsed = await saveScreenshot(page, scenarioDir, "pinned-collapsed.png");
    await page.locator('.light-projects-section-header[data-projects-section="pinned"]').click();

    await page.locator('.light-projects-section-header[data-projects-section="recent"]').click();
    const recentCollapsed = await readProjectsView(page, runId);
    assert.equal(recentCollapsed.route, "projects", `${viewport.label}/${theme}: recent header click should not navigate`);
    assert.equal(sectionState(recentCollapsed, "recent").expanded, false, `${viewport.label}/${theme}: Recent section did not collapse`);
    result.screenshots.recentCollapsed = await saveScreenshot(page, scenarioDir, "recent-collapsed.png");
    await page.locator('.light-projects-section-header[data-projects-section="recent"]').click();

    await page.locator('.light-projects-section-header[data-projects-section="pinned"]').click();
    await page.locator(`.light-project-row[data-project-id="${seed.recent.id}"] .light-project-pin-button`).click();
    await waitForCondition(async () => {
      const view = await readProjectsView(page, runId);
      return view.route === "projects"
        && sectionState(view, "pinned").expanded === true
        && JSON.stringify(view.proofGroups.pinned) === JSON.stringify([seed.recent.title, seed.pinned.title])
        && JSON.stringify(view.proofGroups.recent) === JSON.stringify([seed.failure.title]);
    }, config.timeoutMs, `${viewport.label}/${theme}: pinning into a collapsed pinned section should auto-expand it`);
    const afterPinState = await readProjectsView(page, runId);
    assert.equal(afterPinState.route, "projects", `${viewport.label}/${theme}: pin button click should not leave the projects route`);
    result.screenshots.afterPin = await saveScreenshot(page, scenarioDir, "after-pin.png");

    await page.reload({ waitUntil: "domcontentloaded", timeout: config.timeoutMs });
    await waitForRoute(page, "projects", config.timeoutMs);
    await waitForProofRows(page, runId, config.timeoutMs);
    const reloadedAfterPin = await readProjectsView(page, runId);
    assert.deepEqual(reloadedAfterPin.proofGroups.pinned, [seed.recent.title, seed.pinned.title], `${viewport.label}/${theme}: reloaded pinned state mismatch`);

    await page.locator('.light-projects-section-header[data-projects-section="recent"]').click();
    await page.locator(`.light-project-row[data-project-id="${seed.recent.id}"] .light-project-pin-button`).click();
    await waitForCondition(async () => {
      const view = await readProjectsView(page, runId);
      return view.route === "projects"
        && sectionState(view, "recent").expanded === true
        && JSON.stringify(view.proofGroups.pinned) === JSON.stringify([seed.pinned.title])
        && JSON.stringify(view.proofGroups.recent) === JSON.stringify([seed.recent.title, seed.failure.title]);
    }, config.timeoutMs, `${viewport.label}/${theme}: unpinning into a collapsed recent section should auto-expand it`);
    const afterUnpinState = await readProjectsView(page, runId);
    assert.equal(afterUnpinState.route, "projects", `${viewport.label}/${theme}: pin button click should not leave the projects route`);
    result.screenshots.afterUnpin = await saveScreenshot(page, scenarioDir, "after-unpin.png");

    await page.locator('.light-projects-section-header[data-projects-section="pinned"]').click();
    await page.route(`**/api/workspace/projects/${seed.failure.id}`, async route => {
      const request = route.request();
      if (!failureIntercepted && request.method() === "PATCH") {
        failureIntercepted = true;
        await route.fulfill({
          status: 500,
          contentType: "application/json",
          body: JSON.stringify({ detail: "Projects pin write failed" })
        });
        return;
      }
      await route.continue();
    });
    await page.locator(`.light-project-row[data-project-id="${seed.failure.id}"] .light-project-pin-button`).click();
    await waitForCondition(async () => {
      const view = await readProjectsView(page, runId);
      return failureIntercepted
        && view.route === "projects"
        && sectionState(view, "pinned").expanded === false
        && JSON.stringify(view.proofGroups.recent) === JSON.stringify([seed.recent.title, seed.failure.title]);
    }, config.timeoutMs, `${viewport.label}/${theme}: rollback should restore the pinned section collapse state`);
    const afterFailure = await readProjectsView(page, runId);
    assert.equal(afterFailure.route, "projects", `${viewport.label}/${theme}: pin button click should not leave the projects route`);
    assert.equal(sectionState(afterFailure, "pinned").expanded, false, `${viewport.label}/${theme}: rollback should restore the pinned section collapse state`);
    result.screenshots.failureRollback = await saveScreenshot(page, scenarioDir, "failure-rollback.png");

    await page.locator('.light-projects-section-header[data-projects-section="pinned"]').click();
    await page.locator(`.light-project-row[data-project-id="${seed.recent.id}"] .light-project-feed-copy`).click();
    await waitForRoute(page, "project-detail", config.timeoutMs);
    const detailTitle = await page.locator(".light-page-title-detail").textContent();
    assert.equal(String(detailTitle || "").trim(), seed.recent.title, `${viewport.label}/${theme}: project detail did not open from project copy tap`);
    result.screenshots.projectDetail = await saveScreenshot(page, scenarioDir, "project-detail.png");
    await page.locator('button[aria-label="Back"]').click();
    await waitForRoute(page, "projects", config.timeoutMs);
  } finally {
    await cleanupProjects(config, seed);
    await context.close();
  }
  return result;
}

async function main() {
  const config = parseArgs(process.argv.slice(2));
  ensureDir(config.reportDir);
  const runId = `project-pin-${Date.now()}`;
  const browser = await chromium.launch({
    headless: config.headless,
    executablePath: resolveChromePath()
  });
  const summary = {
    ok: false,
    baseUrl: config.baseUrl,
    reportDir: config.reportDir,
    runId,
    scenarios: []
  };
  try {
    for (const theme of THEMES) {
      for (const viewport of VIEWPORTS) {
        summary.scenarios.push(await runViewportScenario(browser, config, `${runId}-${theme}-${viewport.label}`, viewport, theme));
      }
    }
    summary.ok = true;
  } finally {
    await browser.close();
    fs.writeFileSync(path.join(config.reportDir, "summary.json"), JSON.stringify(summary, null, 2));
  }
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}

main().catch(error => {
  console.error(error?.stack || error?.message || String(error));
  process.exitCode = 1;
});
