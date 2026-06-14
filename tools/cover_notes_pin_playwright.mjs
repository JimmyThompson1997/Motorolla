import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

import { ensureDir, resolveChromePath } from "./cover_shared.mjs";

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const uiRoot = path.join(repoRoot, "pucky_vm", "ui_src");
const proofDir = path.join(repoRoot, ".tmp", "notes-pin-proof");

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
const now = Date.now();
const baseNotes = [
  {
    id: "q4",
    title: "Q4 hiring plan",
    summary: "Engineering hiring priorities and next steps.",
    pinned: true,
    html: "<!doctype html><h1>Q4 hiring plan</h1><p>Engineering hiring priorities and next steps.</p>",
    updated_at_ms: now - 2 * 60 * 60 * 1000,
    metadata: { context: "All notes", icon: "pin" }
  },
  {
    id: "march",
    title: "March eval notes",
    summary: "Prior vendor evaluation and support risks.",
    html: "<!doctype html><h1>March eval notes</h1><p>Prior vendor evaluation and support risks.</p>",
    updated_at_ms: now - 24 * 60 * 60 * 1000,
    metadata: { context: "Vendor review", icon: "attachment" }
  },
  {
    id: "onboarding",
    title: "Onboarding spec v3",
    summary: "First-run checklist and analytics events.",
    html: "<!doctype html><h1>Onboarding spec v3</h1><p>First-run checklist and analytics events.</p>",
    updated_at_ms: now - 7 * 24 * 60 * 60 * 1000,
    metadata: { context: "Project Aurora", icon: "note" }
  }
];

const viewports = [
  { label: "iphone-se", width: 320, height: 568 },
  { label: "iphone-13-mini", width: 375, height: 812 },
  { label: "iphone-14-plus", width: 428, height: 926 },
  { label: "ipad-mini", width: 768, height: 1024 }
];

function cloneNotes(notes) {
  return JSON.parse(JSON.stringify(notes));
}

function applyPinnedOrder(notes, noteId, nextPinned) {
  const recordId = String(noteId || "");
  const target = notes.find(note => String(note.id || "") === recordId);
  if (!target) {
    return cloneNotes(notes);
  }
  const toggled = { ...target, pinned: nextPinned };
  const pinned = [];
  const recent = [];
  notes.forEach(note => {
    if (String(note.id || "") === recordId) {
      return;
    }
    if (note.pinned) {
      pinned.push({ ...note });
      return;
    }
    recent.push({ ...note });
  });
  return nextPinned
    ? [toggled, ...pinned, ...recent]
    : [...pinned, toggled, ...recent];
}

function contentTypeFor(filePath) {
  if (filePath.endsWith(".html")) return "text/html; charset=utf-8";
  if (filePath.endsWith(".js")) return "application/javascript; charset=utf-8";
  if (filePath.endsWith(".css")) return "text/css; charset=utf-8";
  if (filePath.endsWith(".json")) return "application/json; charset=utf-8";
  if (filePath.endsWith(".svg")) return "image/svg+xml";
  if (filePath.endsWith(".png")) return "image/png";
  if (filePath.endsWith(".jpg") || filePath.endsWith(".jpeg")) return "image/jpeg";
  return "application/octet-stream";
}

function uiFilePathFromRequest(urlPath) {
  const cleanPath = String(urlPath || "/").split("?")[0];
  if (cleanPath === "/" || cleanPath === "/index.html" || cleanPath === "/ui/pucky/latest/" || cleanPath === "/ui/pucky/latest/index.html") {
    return path.join(uiRoot, "index.html");
  }
  if (cleanPath.startsWith("/ui/pucky/latest/")) {
    return path.join(uiRoot, cleanPath.slice("/ui/pucky/latest/".length));
  }
  if (cleanPath.startsWith("/ui/pucky/fixtures/")) {
    return path.join(uiRoot, cleanPath.slice("/ui/pucky/".length));
  }
  return path.join(uiRoot, cleanPath.replace(/^\/+/, ""));
}

function slug(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

async function createStaticServer() {
  const server = http.createServer((request, response) => {
    const filePath = uiFilePathFromRequest(request.url || "/");
    if (!filePath.startsWith(uiRoot)) {
      response.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("Forbidden");
      return;
    }
    fs.readFile(filePath, (error, buffer) => {
      if (error) {
        response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
        response.end("Not found");
        return;
      }
      response.writeHead(200, { "Content-Type": contentTypeFor(filePath) });
      response.end(buffer);
    });
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert(address && typeof address === "object" && address.port, "Static server failed to bind a port");
  return { server, port: address.port };
}

async function readNotesView(page) {
  return page.evaluate(() => {
    const groups = {};
    let current = "";
    [...document.querySelectorAll(".light-page > .light-section-title, .light-page > .light-list")].forEach(node => {
      if (node.classList.contains("light-section-title")) {
        current = node.textContent?.trim().toLowerCase() || "";
        groups[current] = [];
        return;
      }
      if (node.classList.contains("light-list") && current) {
        groups[current] = [...node.querySelectorAll(".light-note-row .light-text-stack strong")].map(el => el.textContent?.trim() || "");
      }
    });
    return {
      route: document.querySelector("[data-light-route]")?.getAttribute("data-light-route") || document.body?.dataset?.route || null,
      rowPinButtons: document.querySelectorAll(".light-note-row .light-note-pin-button").length,
      leftIcons: document.querySelectorAll(".light-note-row .light-small-icon").length,
      groups,
      rows: [...document.querySelectorAll(".light-note-row")].map(row => {
        const rect = row.getBoundingClientRect();
        return {
          id: row.getAttribute("data-note-id") || "",
          title: row.querySelector(".light-text-stack strong")?.textContent?.trim() || "",
          pinned: row.querySelector(".light-note-pin-button")?.getAttribute("data-note-pinned") || "",
          width: Math.round(rect.width),
          height: Math.round(rect.height)
        };
      })
    };
  });
}

async function waitForNotesList(page) {
  await page.locator(".light-note-row").first().waitFor({ state: "visible", timeout: 10000 });
}

async function openNotes(page) {
  await page.waitForFunction(() => Boolean(document.querySelector('button.light-app-tile[data-route="notes"]')), { timeout: 10000 });
  await page.evaluate(() => document.querySelector('button.light-app-tile[data-route="notes"]')?.click());
  await waitForNotesList(page);
}

async function runViewportScenario(browser, pageUrl, viewport) {
  const viewportSlug = slug(viewport.label);
  const state = {
    notes: cloneNotes(baseNotes),
    failNextPatch: false
  };
  const networkLog = [];
  const consoleWarnings = [];
  const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height } });
  try {
    await context.route("**/api/workspace/notes**", async route => {
      const request = route.request();
      if (request.method() === "GET") {
        networkLog.push({ method: "GET", url: request.url(), status: 200, items: state.notes.map(note => ({ id: note.id, pinned: Boolean(note.pinned) })) });
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ collection: "notes", count: state.notes.length, items: state.notes })
        });
        return;
      }
      if (request.method() === "PATCH") {
        const body = request.postDataJSON();
        const noteId = request.url().split("/").pop() || "";
        const nextPinned = Boolean(body && body.pinned);
        networkLog.push({ method: "PATCH", url: request.url(), status: state.failNextPatch ? 500 : 200, body });
        await new Promise(resolve => setTimeout(resolve, 180));
        if (state.failNextPatch) {
          state.failNextPatch = false;
          await route.fulfill({
            status: 500,
            contentType: "application/json",
            body: JSON.stringify({ error: "Notes pin write failed" })
          });
          return;
        }
        state.notes = applyPinnedOrder(state.notes, noteId, nextPinned);
        const updated = state.notes.find(note => String(note.id) === String(noteId));
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(updated || {})
        });
        return;
      }
      await route.fallback();
    });

    const page = await context.newPage();
    page.on("console", message => {
      if (message.type() === "warning" || message.type() === "warn") {
        consoleWarnings.push(message.text());
      }
    });

    await page.goto(pageUrl, { waitUntil: "domcontentloaded" });
    await openNotes(page);

    const baseline = await readNotesView(page);
    assert.equal(baseline.route, "notes", `${viewport.label}: Notes route did not open`);
    assert.equal(baseline.rowPinButtons, 3, `${viewport.label}: expected 3 row pin buttons`);
    assert.equal(baseline.leftIcons, 0, `${viewport.label}: expected no left icons`);
    assert.deepEqual(baseline.groups.pinned, ["Q4 hiring plan"], `${viewport.label}: pinned baseline mismatch`);
    assert.deepEqual(baseline.groups.recent, ["March eval notes", "Onboarding spec v3"], `${viewport.label}: recent baseline mismatch`);
    assert.equal(new Set(baseline.rows.map(row => row.width)).size, 1, `${viewport.label}: pinned/recent widths diverged`);
    assert.equal(new Set(baseline.rows.map(row => row.height)).size, 1, `${viewport.label}: pinned/recent heights diverged`);
    const baselineShot = path.join(proofDir, `${viewportSlug}-01-baseline.png`);
    await page.screenshot({ path: baselineShot, fullPage: true });

    await page.locator('.light-note-row[data-note-id="march"] .light-note-pin-button').click();
    await page.waitForTimeout(50);
    const optimisticPin = await readNotesView(page);
    assert.deepEqual(optimisticPin.groups.pinned, ["March eval notes", "Q4 hiring plan"], `${viewport.label}: optimistic pin ordering mismatch`);
    assert.equal(optimisticPin.rows.find(row => row.id === "march")?.pinned, "true", `${viewport.label}: optimistic pin state mismatch`);
    await page.waitForTimeout(220);
    const afterPin = await readNotesView(page);
    assert.deepEqual(afterPin.groups.recent, ["Onboarding spec v3"], `${viewport.label}: after-pin recent mismatch`);
    const afterPinShot = path.join(proofDir, `${viewportSlug}-02-after-pin.png`);
    await page.screenshot({ path: afterPinShot, fullPage: true });

    await page.locator('.light-note-row[data-note-id="march"] .light-note-pin-button').click();
    await page.waitForTimeout(50);
    const optimisticUnpin = await readNotesView(page);
    assert.deepEqual(optimisticUnpin.groups.recent, ["March eval notes", "Onboarding spec v3"], `${viewport.label}: optimistic unpin ordering mismatch`);
    assert.equal(optimisticUnpin.rows.find(row => row.id === "march")?.pinned, "false", `${viewport.label}: optimistic unpin state mismatch`);
    await page.waitForTimeout(220);
    const afterUnpin = await readNotesView(page);
    assert.deepEqual(afterUnpin.groups.pinned, ["Q4 hiring plan"], `${viewport.label}: after-unpin pinned mismatch`);
    const afterUnpinShot = path.join(proofDir, `${viewportSlug}-03-after-unpin.png`);
    await page.screenshot({ path: afterUnpinShot, fullPage: true });

    await page.locator('.light-note-row[data-note-id="march"] .light-text-stack').click();
    await page.locator(".light-doc-article h1").waitFor({ state: "visible", timeout: 10000 });
    assert.equal((await page.locator(".light-doc-article h1").textContent())?.trim(), "March eval notes", `${viewport.label}: note detail did not open`);
    await page.locator('button[aria-label="Back"]').click();
    await waitForNotesList(page);

    if (viewport.label === "iphone-13-mini") {
      state.failNextPatch = true;
      await page.locator('.light-note-row[data-note-id="onboarding"] .light-note-pin-button').click();
      await page.waitForTimeout(50);
      const optimisticFailure = await readNotesView(page);
      assert.deepEqual(optimisticFailure.groups.pinned, ["Onboarding spec v3", "Q4 hiring plan"], `${viewport.label}: optimistic failure state mismatch`);
      await page.waitForTimeout(220);
      const afterFailure = await readNotesView(page);
      assert.deepEqual(afterFailure.groups.pinned, ["Q4 hiring plan"], `${viewport.label}: rollback pinned mismatch`);
      assert.deepEqual(afterFailure.groups.recent, ["March eval notes", "Onboarding spec v3"], `${viewport.label}: rollback recent mismatch`);
      assert(consoleWarnings.some(message => message.includes("Notes pin write failed")), `${viewport.label}: expected Notes pin write failed warning`);
      await page.screenshot({ path: path.join(proofDir, `${viewportSlug}-04-failure-rollback.png`), fullPage: true });
    }

    return {
      viewport,
      screenshots: {
        baseline: baselineShot,
        after_pin: afterPinShot,
        after_unpin: afterUnpinShot
      },
      console_warnings: consoleWarnings,
      network_log: networkLog
    };
  } finally {
    await context.close();
  }
}

async function main() {
  ensureDir(proofDir);
  const { server, port } = await createStaticServer();
  const pageUrl = `http://127.0.0.1:${port}/index.html?theme=light`;
  let browser;
  try {
    browser = await chromium.launch({ executablePath: resolveChromePath(), headless: true });
    const results = [];
    for (const viewport of viewports) {
      results.push(await runViewportScenario(browser, pageUrl, viewport));
    }
    const summary = {
      page_url: pageUrl,
      viewports: results
    };
    fs.writeFileSync(path.join(proofDir, "multisize-summary.json"), JSON.stringify(summary, null, 2));
    console.log(JSON.stringify(summary, null, 2));
  } finally {
    await browser?.close().catch(() => {});
    await new Promise(resolve => server.close(resolve));
  }
}

await main();
