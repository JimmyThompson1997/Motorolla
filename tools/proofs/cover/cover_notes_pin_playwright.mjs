import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

import { ensureDir, resolveChromePath } from "../../support/cover_shared.mjs";

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../..");
const uiRoot = path.join(repoRoot, "pucky_vm", "ui_src");
const proofDir = path.join(repoRoot, ".tmp", "notes-pin-proof");
const PROOF_BROWSER_TOKEN = "proof-browser-token";

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
  { label: "ipad-mini", width: 768, height: 1024 },
  { label: "desktop", width: 1440, height: 900 }
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
    const sections = [...document.querySelectorAll(".light-notes-section")].map(section => {
      const key = section.getAttribute("data-notes-section") || "";
      const header = section.querySelector(".light-notes-section-header");
      const body = section.querySelector(".light-notes-section-body");
      return {
        key,
        title: section.querySelector(".light-notes-section-label")?.textContent?.trim() || "",
        count: section.querySelector(".light-notes-section-count")?.textContent?.trim() || "",
        expanded: header?.getAttribute("aria-expanded") === "true",
        hidden: Boolean(body?.hidden),
        rows: [...section.querySelectorAll(".light-note-row .light-note-feed-copy strong")].map(el => el.textContent?.trim() || "")
      };
    });
    const groups = Object.fromEntries(sections.map(section => [section.key, section.rows]));
    const notesFeed = document.querySelector(".light-notes-feed");
    return {
      route: document.querySelector("[data-light-route]")?.getAttribute("data-light-route") || document.body?.dataset?.route || null,
      hasNotesFeed: Boolean(notesFeed),
      sectionHeaders: document.querySelectorAll(".light-notes-section-header").length,
      sections,
      rowPinButtons: document.querySelectorAll(".light-note-row .light-note-pin-button").length,
      leftIcons: document.querySelectorAll(".light-note-row .light-small-icon").length,
      cardRows: document.querySelectorAll(".light-note-row.light-card").length,
      groups,
      rows: [...document.querySelectorAll(".light-note-row")].map(row => {
        const rect = row.getBoundingClientRect();
        const copy = row.querySelector(".light-note-feed-copy");
        const pin = row.querySelector(".light-note-pin-button");
        const icon = pin?.querySelector(".material-icon");
        const meta = row.querySelector(".light-note-row-meta");
        const context = row.querySelector(".light-note-row-context");
        const time = row.querySelector(".light-note-row-time");
        const copyRect = copy?.getBoundingClientRect();
        const pinRect = pin?.getBoundingClientRect();
        const pinStyle = pin ? getComputedStyle(pin) : null;
        const iconStyle = icon ? getComputedStyle(icon) : null;
        return {
          id: row.getAttribute("data-note-id") || "",
          title: row.querySelector(".light-note-feed-copy strong")?.textContent?.trim() || "",
          pinned: pin?.getAttribute("data-note-pinned") || "",
          width: Math.round(rect.width),
          height: Math.round(rect.height),
          hasSummary: Boolean(row.querySelector(".light-note-summary")),
          hasSource: row.getAttribute("data-note-has-source") === "true",
          contextLabel: context?.textContent?.trim() || "",
          timeLabel: time?.textContent?.trim() || "",
          timeOnly: meta?.classList.contains("is-time-only") || false,
          copyRight: copyRect ? Math.round(copyRect.right) : 0,
          pinLeft: pinRect ? Math.round(pinRect.left) : 0,
          pinWidth: pinRect ? Math.round(pinRect.width) : 0,
          pinHeight: pinRect ? Math.round(pinRect.height) : 0,
          pinBackground: pinStyle?.backgroundColor || "",
          pinBorderWidth: pinStyle?.borderTopWidth || "",
          pinBorderRadius: pinStyle?.borderRadius || "",
          pinBoxShadow: pinStyle?.boxShadow || "",
          iconWidth: iconStyle ? Math.round(parseFloat(iconStyle.width || "0")) : 0,
          iconHeight: iconStyle ? Math.round(parseFloat(iconStyle.height || "0")) : 0
        };
      })
    };
  });
}

async function readNoteDetailView(page) {
  return page.evaluate(() => {
    const htmlBody = document.querySelector(".light-detail-html-body");
    const htmlFrame = document.querySelector(".light-detail-html-body .light-html-frame");
    const htmlBodyRect = htmlBody?.getBoundingClientRect();
    const htmlFrameRect = htmlFrame?.getBoundingClientRect();
    return {
      route: document.querySelector(".light-shell")?.getAttribute("data-light-route") || document.body?.dataset?.route || null,
      headerTitle: document.querySelector(".light-page-title-detail")?.textContent?.trim() || "",
      articleCount: document.querySelectorAll(".light-doc-article.light-note-detail").length,
      noteBodyCount: document.querySelectorAll(".light-note-body").length,
      htmlBodyCount: document.querySelectorAll(".light-detail-html-body").length,
      htmlFrameCount: document.querySelectorAll(".light-detail-html-body .light-html-frame").length,
      htmlEmptyCount: document.querySelectorAll(".light-html-empty.light-detail-html-body").length,
      innerWidth: window.innerWidth,
      documentScrollWidth: document.documentElement.scrollWidth,
      htmlBodyLeft: Number((htmlBodyRect?.left || 0).toFixed(2)),
      htmlFrameLeft: Number((htmlFrameRect?.left || 0).toFixed(2))
    };
  });
}

async function waitForNotesList(page) {
  await page.locator(".light-note-row").first().waitFor({ state: "visible", timeout: 10000 });
}

async function expectPreviewApiTokenLock(page) {
  await page.waitForFunction(() => {
    const shell = document.querySelector(".light-shell");
    const title = document.querySelector(".light-empty-state h2");
    const detail = document.querySelector(".light-empty-state p");
    const action = document.querySelector(".light-empty-state .light-empty-state-action");
    return shell?.getAttribute("data-light-route") === "notes"
      && String(title?.textContent || "").trim() === "Preview needs api_token"
      && String(detail?.textContent || "").trim() === "Web preview is locked. Use Unlock web preview to load live Notes from the VM in this browser."
      && String(action?.textContent || "").trim() === "Unlock web preview";
  }, { timeout: 10000 });
}

async function unlockBrowserPreview(page, apiToken = PROOF_BROWSER_TOKEN) {
  await page.getByRole("button", { name: "Unlock web preview" }).click();
  await page.getByPlaceholder("Paste PUCKY_WEB_UI_TOKEN").waitFor({ state: "visible", timeout: 10000 });
  await page.getByPlaceholder("Paste PUCKY_WEB_UI_TOKEN").fill(String(apiToken || "").trim());
  await page.getByRole("button", { name: "Save token" }).click();
  await page.waitForFunction(() => !document.querySelector(".browser-unlock-sheet"), { timeout: 10000 });
  await page.waitForFunction(() => Boolean(localStorage.getItem("pucky.cover.browser_api_token.v1")), { timeout: 10000 });
}

async function openNotes(page) {
  await page.waitForFunction(() => Boolean(document.querySelector('button.light-app-tile[data-route="notes"]')), { timeout: 10000 });
  await page.evaluate(() => document.querySelector('button.light-app-tile[data-route="notes"]')?.click());
  const locked = await page.waitForFunction(() => {
    const shell = document.querySelector(".light-shell");
    const title = document.querySelector(".light-empty-state h2");
    return shell?.getAttribute("data-light-route") === "notes"
      && String(title?.textContent || "").trim() === "Preview needs api_token";
  }, { timeout: 1200 }).then(() => true).catch(() => false);
  if (locked) {
    await expectPreviewApiTokenLock(page);
    await unlockBrowserPreview(page);
  }
  await waitForNotesList(page);
}

async function readHorizontalMetrics(page) {
  return page.evaluate(() => {
    function rectData(node) {
      if (!node) return null;
      const rect = node.getBoundingClientRect();
      return {
        left: Number(rect.left.toFixed(2)),
        right: Number(rect.right.toFixed(2)),
        width: Number(rect.width.toFixed(2)),
        centerX: Number((rect.left + rect.width / 2).toFixed(2))
      };
    }
    const shell = document.querySelector(".light-shell");
    const feed = document.getElementById("feed");
    const content = shell ? [...shell.children].find(node => node.getBoundingClientRect().height > 0) : null;
    return {
      route: shell?.getAttribute("data-light-route") || "",
      innerWidth: window.innerWidth,
      documentScrollWidth: document.documentElement.scrollWidth,
      documentScrollLeft: Number((window.scrollX || document.documentElement.scrollLeft || document.body.scrollLeft || 0).toFixed(2)),
      feedScrollLeft: Number((feed?.scrollLeft || 0).toFixed(2)),
      feedScrollWidth: Number(feed?.scrollWidth || 0),
      feedClientWidth: Number(feed?.clientWidth || 0),
      shell: rectData(shell),
      content: rectData(content)
    };
  });
}

async function attemptHorizontalShift(page, label) {
  const before = await readHorizontalMetrics(page);
  await page.evaluate(() => {
    window.scrollTo({ left: 120, top: window.scrollY, behavior: "instant" });
    const feed = document.getElementById("feed");
    if (feed && typeof feed.scrollTo === "function") {
      feed.scrollTo({ left: 120, top: feed.scrollTop, behavior: "instant" });
    }
  });
  await page.waitForTimeout(120);
  const after = await readHorizontalMetrics(page);
  assert(after.documentScrollWidth <= after.innerWidth + 1, `${label}: document scroll width overflowed (${after.documentScrollWidth} > ${after.innerWidth})`);
  assert(after.documentScrollLeft <= 1, `${label}: document scrolled horizontally (${after.documentScrollLeft})`);
  assert(after.feedScrollLeft <= 1, `${label}: feed scrolled horizontally (${after.feedScrollLeft})`);
  if (before.content && after.content) {
    assert(Math.abs(after.content.centerX - before.content.centerX) <= 1, `${label}: content center drifted (${before.content.centerX} -> ${after.content.centerX})`);
  }
  return { before, after };
}

async function runViewportScenario(browser, pageUrl, viewport) {
  const viewportSlug = slug(viewport.label);
  const state = {
    notes: cloneNotes(baseNotes),
    failNextPatch: false
  };
  const networkLog = [];
  const consoleWarnings = [];
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    isMobile: viewport.width <= 768,
    hasTouch: viewport.width <= 768
  });
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
    const homeCentering = await attemptHorizontalShift(page, `${viewport.label}:home`);
    const homeShot = path.join(proofDir, `${viewportSlug}-00-home-centered.png`);
    await page.screenshot({ path: homeShot, fullPage: true });
    await openNotes(page);

    const baseline = await readNotesView(page);
    assert.equal(baseline.route, "notes", `${viewport.label}: Notes route did not open`);
    assert.equal(baseline.hasNotesFeed, true, `${viewport.label}: expected notes feed wrapper`);
    assert.equal(baseline.sectionHeaders, 2, `${viewport.label}: expected 2 section headers`);
    assert.equal(baseline.rowPinButtons, 3, `${viewport.label}: expected 3 row pin buttons`);
    assert.equal(baseline.leftIcons, 0, `${viewport.label}: expected no left icons`);
    assert.equal(baseline.cardRows, 0, `${viewport.label}: expected notes rows without tile cards`);
    assert.deepEqual(baseline.groups.pinned, ["Q4 hiring plan"], `${viewport.label}: pinned baseline mismatch`);
    assert.deepEqual(baseline.groups.recent, ["March eval notes", "Onboarding spec v3"], `${viewport.label}: recent baseline mismatch`);
    assert.equal(baseline.sections.find(section => section.key === "pinned")?.expanded, true, `${viewport.label}: pinned should default expanded`);
    assert.equal(baseline.sections.find(section => section.key === "recent")?.expanded, true, `${viewport.label}: recent should default expanded`);
    assert.equal(new Set(baseline.rows.map(row => row.width)).size, 1, `${viewport.label}: pinned/recent widths diverged`);
    assert.equal(new Set(baseline.rows.map(row => row.height)).size, 1, `${viewport.label}: pinned/recent heights diverged`);
    assert(baseline.rows.every(row => !row.hasSummary), `${viewport.label}: preview summaries should be removed`);
    assert.equal(baseline.rows.find(row => row.id === "q4")?.contextLabel || "", "", `${viewport.label}: generic All notes label should be suppressed`);
    assert.equal(baseline.rows.find(row => row.id === "q4")?.timeOnly, true, `${viewport.label}: generic source row should collapse to time-only meta`);
    assert.equal(baseline.rows.find(row => row.id === "march")?.contextLabel, "Vendor review", `${viewport.label}: expected source label for March note`);
    assert.equal(baseline.rows.find(row => row.id === "onboarding")?.contextLabel, "Project Aurora", `${viewport.label}: expected source label for onboarding note`);
    assert(baseline.rows.every(row => row.timeLabel.length > 0), `${viewport.label}: expected right-side timestamps`);
    assert(baseline.rows.every(row => row.copyRight < row.pinLeft), `${viewport.label}: note copy overlaps pin button`);
    assert(baseline.rows.every(row => row.pinWidth === 36 && row.pinHeight === 36), `${viewport.label}: expected 36px pin tap targets`);
    assert(baseline.rows.every(row => row.iconWidth === 16 && row.iconHeight === 16), `${viewport.label}: expected smaller 16px pin icons`);
    assert(baseline.rows.every(row => row.pinBackground === "rgba(0, 0, 0, 0)"), `${viewport.label}: pin button still has visible background`);
    assert(baseline.rows.every(row => row.pinBorderWidth === "0px"), `${viewport.label}: pin button still has border chrome`);
    assert(baseline.rows.every(row => row.pinBorderRadius === "0px"), `${viewport.label}: pin button still has circular radius`);
    assert(baseline.rows.every(row => row.pinBoxShadow === "none"), `${viewport.label}: pin button still has shadow chrome`);
    const notesCentering = await attemptHorizontalShift(page, `${viewport.label}:notes`);
    const baselineShot = path.join(proofDir, `${viewportSlug}-01-baseline.png`);
    await page.screenshot({ path: baselineShot, fullPage: true });

    await page.locator('.light-notes-section-header[data-notes-section="pinned"]').click();
    const pinnedCollapsed = await readNotesView(page);
    assert.equal(pinnedCollapsed.route, "notes", `${viewport.label}: pinned header click should not navigate`);
    assert.equal(pinnedCollapsed.sections.find(section => section.key === "pinned")?.expanded, false, `${viewport.label}: pinned section did not collapse`);
    assert.deepEqual(pinnedCollapsed.groups.pinned, [], `${viewport.label}: collapsed pinned section should hide rows`);
    assert.deepEqual(pinnedCollapsed.groups.recent, ["March eval notes", "Onboarding spec v3"], `${viewport.label}: collapsing pinned should keep recent visible`);
    await page.locator('.light-notes-section-header[data-notes-section="pinned"]').click();
    const pinnedExpandedAgain = await readNotesView(page);
    assert.equal(pinnedExpandedAgain.sections.find(section => section.key === "pinned")?.expanded, true, `${viewport.label}: pinned section did not re-expand`);
    assert.deepEqual(pinnedExpandedAgain.groups.pinned, ["Q4 hiring plan"], `${viewport.label}: pinned rows did not return after re-expand`);

    await page.locator('.light-notes-section-header[data-notes-section="recent"]').click();
    const recentCollapsed = await readNotesView(page);
    assert.equal(recentCollapsed.route, "notes", `${viewport.label}: recent header click should not navigate`);
    assert.equal(recentCollapsed.sections.find(section => section.key === "recent")?.expanded, false, `${viewport.label}: recent section did not collapse`);
    assert.deepEqual(recentCollapsed.groups.recent, [], `${viewport.label}: collapsed recent section should hide rows`);
    assert.deepEqual(recentCollapsed.groups.pinned, ["Q4 hiring plan"], `${viewport.label}: collapsing recent should keep pinned visible`);
    await page.locator('.light-notes-section-header[data-notes-section="recent"]').click();
    const recentExpandedAgain = await readNotesView(page);
    assert.equal(recentExpandedAgain.sections.find(section => section.key === "recent")?.expanded, true, `${viewport.label}: recent section did not re-expand`);
    assert.deepEqual(recentExpandedAgain.groups.recent, ["March eval notes", "Onboarding spec v3"], `${viewport.label}: recent rows did not return after re-expand`);

    await page.locator('.light-notes-section-header[data-notes-section="pinned"]').click();
    await page.locator('.light-note-row[data-note-id="march"] .light-note-pin-button').click();
    await page.waitForTimeout(50);
    const optimisticPin = await readNotesView(page);
    assert.equal(optimisticPin.sections.find(section => section.key === "pinned")?.expanded, true, `${viewport.label}: pinning into collapsed pinned should auto-expand`);
    assert.deepEqual(optimisticPin.groups.pinned, ["March eval notes", "Q4 hiring plan"], `${viewport.label}: optimistic pin ordering mismatch`);
    assert.equal(optimisticPin.rows.find(row => row.id === "march")?.pinned, "true", `${viewport.label}: optimistic pin state mismatch`);
    await page.waitForTimeout(220);
    const afterPin = await readNotesView(page);
    assert.deepEqual(afterPin.groups.recent, ["Onboarding spec v3"], `${viewport.label}: after-pin recent mismatch`);
    const afterPinShot = path.join(proofDir, `${viewportSlug}-02-after-pin.png`);
    await page.screenshot({ path: afterPinShot, fullPage: true });

    await page.locator('.light-notes-section-header[data-notes-section="recent"]').click();
    await page.locator('.light-note-row[data-note-id="march"] .light-note-pin-button').click();
    await page.waitForTimeout(50);
    const optimisticUnpin = await readNotesView(page);
    assert.equal(optimisticUnpin.sections.find(section => section.key === "recent")?.expanded, true, `${viewport.label}: unpinning into collapsed recent should auto-expand`);
    assert.deepEqual(optimisticUnpin.groups.recent, ["March eval notes", "Onboarding spec v3"], `${viewport.label}: optimistic unpin ordering mismatch`);
    assert.equal(optimisticUnpin.rows.find(row => row.id === "march")?.pinned, "false", `${viewport.label}: optimistic unpin state mismatch`);
    await page.waitForTimeout(220);
    const afterUnpin = await readNotesView(page);
    assert.deepEqual(afterUnpin.groups.pinned, ["Q4 hiring plan"], `${viewport.label}: after-unpin pinned mismatch`);
    const afterUnpinShot = path.join(proofDir, `${viewportSlug}-03-after-unpin.png`);
    await page.screenshot({ path: afterUnpinShot, fullPage: true });

    await page.locator('.light-note-row[data-note-id="march"] .light-note-feed-copy').click();
    await page.locator(".light-page-title-detail").waitFor({ state: "visible", timeout: 10000 });
    const detail = await readNoteDetailView(page);
    assert.equal(detail.route, "note-detail", `${viewport.label}: note detail route did not open`);
    assert.equal(detail.headerTitle, "March eval notes", `${viewport.label}: note detail header did not use note title`);
    assert.equal(detail.articleCount, 0, `${viewport.label}: legacy note detail article still rendered`);
    assert.equal(detail.noteBodyCount, 0, `${viewport.label}: legacy note body copy still rendered`);
    assert.equal(detail.htmlBodyCount, 1, `${viewport.label}: expected a single note HTML body surface`);
    assert.equal(detail.htmlFrameCount + detail.htmlEmptyCount, 1, `${viewport.label}: expected rendered HTML frame or fallback empty state`);
    assert(detail.htmlBodyLeft >= 0, `${viewport.label}: note detail surface is clipped on the left (${detail.htmlBodyLeft})`);
    assert(detail.htmlFrameLeft >= 0, `${viewport.label}: note detail frame is clipped on the left (${detail.htmlFrameLeft})`);
    assert(detail.documentScrollWidth <= detail.innerWidth + 1, `${viewport.label}: note detail introduced horizontal overflow (${detail.documentScrollWidth} > ${detail.innerWidth})`);
    const detailShot = path.join(proofDir, `${viewportSlug}-04-note-detail-clean.png`);
    await page.screenshot({ path: detailShot, fullPage: true });
    await page.locator('button[aria-label="Back"]').click();
    await waitForNotesList(page);

    if (viewport.label === "iphone-13-mini") {
      await page.locator('.light-notes-section-header[data-notes-section="pinned"]').click();
      const beforeFailure = await readNotesView(page);
      assert.equal(beforeFailure.sections.find(section => section.key === "pinned")?.expanded, false, `${viewport.label}: failure setup should collapse pinned`);
      state.failNextPatch = true;
      await page.locator('.light-note-row[data-note-id="onboarding"] .light-note-pin-button').click();
      await page.waitForTimeout(50);
      const optimisticFailure = await readNotesView(page);
      assert.equal(optimisticFailure.sections.find(section => section.key === "pinned")?.expanded, true, `${viewport.label}: failure-path optimistic pin should auto-expand pinned`);
      assert.deepEqual(optimisticFailure.groups.pinned, ["Onboarding spec v3", "Q4 hiring plan"], `${viewport.label}: optimistic failure state mismatch`);
      await page.waitForTimeout(220);
      const afterFailure = await readNotesView(page);
      assert.equal(afterFailure.sections.find(section => section.key === "pinned")?.expanded, false, `${viewport.label}: rollback should restore pinned collapsed state`);
      assert.deepEqual(afterFailure.groups.pinned, [], `${viewport.label}: collapsed pinned section should remain hidden after rollback`);
      assert.deepEqual(afterFailure.groups.recent, ["March eval notes", "Onboarding spec v3"], `${viewport.label}: rollback recent mismatch`);
      assert(consoleWarnings.some(message => message.includes("Notes pin write failed")), `${viewport.label}: expected Notes pin write failed warning`);
      await page.screenshot({ path: path.join(proofDir, `${viewportSlug}-05-failure-rollback.png`), fullPage: true });
    }

    return {
      viewport,
      centering: {
        home: homeCentering,
        notes: notesCentering
      },
      screenshots: {
        home: homeShot,
        baseline: baselineShot,
        after_pin: afterPinShot,
        after_unpin: afterUnpinShot,
        note_detail_clean: detailShot
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
