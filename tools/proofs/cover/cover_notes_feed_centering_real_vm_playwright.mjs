import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright-core";

import {
  attachPageLogging,
  ensureDir,
  resolveChromePath,
  saveScreenshot,
  writeAutomationError,
  writeJsonFile
} from "../../support/cover_shared.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const DEFAULT_PAGE_URL = "https://pucky.fly.dev/ui/pucky/latest/?theme=light&reset_nav=1";
const DEFAULT_REPORT_DIR = path.join(repoRoot, ".tmp", "notes-feed-centering-live-proof");
const viewports = [
  { label: "narrow-phone", width: 320, height: 568 },
  { label: "large-phone", width: 428, height: 926 },
  { label: "tablet", width: 768, height: 1024 },
  { label: "desktop", width: 1440, height: 900 }
];

function resolveApiToken() {
  const webToken = String(process.env.PUCKY_WEB_UI_TOKEN || "").trim();
  if (webToken) {
    return webToken;
  }
  return String(process.env.PUCKY_API_TOKEN || "").trim();
}

function parseArgs(argv) {
  const config = {
    pageUrl: process.env.PUCKY_NOTES_FEED_CENTERING_URL || DEFAULT_PAGE_URL,
    reportDir: DEFAULT_REPORT_DIR,
    apiToken: resolveApiToken(),
    timeoutMs: 20000,
    headless: true
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = String(argv[index] || "");
    if (arg === "--page-url" && argv[index + 1]) {
      config.pageUrl = String(argv[++index] || config.pageUrl);
    } else if (arg === "--report-dir" && argv[index + 1]) {
      config.reportDir = path.resolve(String(argv[++index] || config.reportDir));
    } else if (arg === "--api-token" && argv[index + 1]) {
      config.apiToken = String(argv[++index] || config.apiToken);
    } else if (arg === "--timeout-ms" && argv[index + 1]) {
      config.timeoutMs = Math.max(1000, Number(argv[++index] || config.timeoutMs) || config.timeoutMs);
    } else if (arg === "--headed") {
      config.headless = false;
    }
  }
  return config;
}

function runProcess(executable, args, options = {}) {
  const result = spawnSync(executable, args, {
    cwd: options.cwd || repoRoot,
    env: options.env || process.env,
    encoding: "utf8",
    windowsHide: true,
    maxBuffer: 1024 * 1024 * 20
  });
  if (result.status !== 0) {
    throw new Error(`${path.basename(executable)} ${args.join(" ")} failed: ${result.stderr || result.stdout || `exit ${result.status}`}`);
  }
  return String(result.stdout || "").trim();
}

function gitOutput(args) {
  return runProcess("git", args, { cwd: repoRoot });
}

function repoState() {
  const branchStatus = gitOutput(["status", "--short", "--branch", "--untracked-files=no"]);
  const head = gitOutput(["rev-parse", "HEAD"]);
  const upstream = gitOutput(["rev-parse", "@{u}"]);
  return {
    branch_status: branchStatus,
    head,
    upstream,
    clean: !branchStatus.split(/\r?\n/).slice(1).some(line => String(line || "").trim())
  };
}

function ensureCanonicalMasterReady() {
  const status = repoState();
  if (!String(status.branch_status || "").includes("...origin/master")) {
    throw new Error(`Canonical repo must track origin/master for official proof. Saw: ${status.branch_status}`);
  }
  if (!status.clean) {
    throw new Error(`Canonical repo has tracked changes and is not ready for official proof. Saw:\n${status.branch_status}`);
  }
  if (String(status.head || "") !== String(status.upstream || "")) {
    throw new Error(`Canonical repo HEAD ${status.head} does not match upstream ${status.upstream}`);
  }
  return status;
}

async function fetchJson(url) {
  const response = await fetch(url, { headers: { Accept: "application/json" }, cache: "no-store" });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`GET ${url} failed with ${response.status}: ${String(payload?.detail || payload?.error || "")}`);
  }
  return payload;
}

async function fetchManifest(pageUrl) {
  return fetchJson(new URL("manifest.json", pageUrl).toString());
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function waitForRoute(page, route, timeoutMs) {
  await page.waitForFunction(
    expectedRoute => document.querySelector(".light-shell")?.getAttribute("data-light-route") === expectedRoute,
    route,
    { timeout: timeoutMs }
  );
}

async function clickHomeTile(page, route, timeoutMs) {
  const tile = page.locator(`.light-shell[data-light-route="home"] .light-app-tile[data-route="${route}"]`);
  await tile.waitFor({ state: "visible", timeout: timeoutMs });
  await tile.click();
  await waitForRoute(page, route, timeoutMs);
}

async function backUntilHome(page, timeoutMs) {
  for (let index = 0; index < 8; index += 1) {
    const current = await page.evaluate(() => document.querySelector(".light-shell")?.getAttribute("data-light-route") || "");
    if (current === "home") {
      return;
    }
    await page.evaluate(() => window.PuckyHandleAndroidBack && window.PuckyHandleAndroidBack());
    await page.waitForTimeout(250);
  }
  await waitForRoute(page, "home", timeoutMs);
}

async function collectCenteringMetrics(page) {
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
  const before = await collectCenteringMetrics(page);
  await page.evaluate(() => {
    window.scrollTo({ left: 120, top: window.scrollY, behavior: "instant" });
    const feed = document.getElementById("feed");
    if (feed && typeof feed.scrollTo === "function") {
      feed.scrollTo({ left: 120, top: feed.scrollTop, behavior: "instant" });
    }
  });
  const box = await page.locator("#feed").boundingBox().catch(() => null);
  if (box) {
    const y = box.y + Math.min(160, Math.max(80, box.height * 0.3));
    await page.mouse.move(box.x + box.width * 0.75, y);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.25, y, { steps: 14 });
    await page.mouse.up();
  }
  await page.waitForTimeout(150);
  const after = await collectCenteringMetrics(page);
  assert(after.documentScrollWidth <= after.innerWidth + 1, `${label}: document scroll width overflowed (${after.documentScrollWidth} > ${after.innerWidth})`);
  assert(after.documentScrollLeft <= 1, `${label}: document scrolled horizontally (${after.documentScrollLeft})`);
  assert(after.feedScrollLeft <= 1, `${label}: feed scrolled horizontally (${after.feedScrollLeft})`);
  if (before.content && after.content) {
    assert(Math.abs(after.content.centerX - before.content.centerX) <= 1, `${label}: content center drifted (${before.content.centerX} -> ${after.content.centerX})`);
  }
  return { before, after };
}

async function readNotesView(page) {
  return page.evaluate(() => {
    function rectData(node) {
      if (!node) return null;
      const rect = node.getBoundingClientRect();
      return {
        width: Math.round(rect.width),
        height: Math.round(rect.height)
      };
    }
    const groups = {};
    [...document.querySelectorAll(".light-notes-section")].forEach(section => {
      const title = section.querySelector(".light-section-title")?.textContent?.trim().toLowerCase() || "";
      groups[title] = [...section.querySelectorAll(".light-note-row .light-note-feed-copy strong")].map(el => el.textContent?.trim() || "");
    });
    return {
      route: document.querySelector(".light-shell")?.getAttribute("data-light-route") || "",
      rowPinButtons: document.querySelectorAll(".light-note-row .light-note-pin-button").length,
      leftIcons: document.querySelectorAll(".light-note-row .light-small-icon").length,
      cardRows: document.querySelectorAll(".light-note-row.light-card").length,
      groups,
      rows: [...document.querySelectorAll(".light-note-row")].map(row => {
        const pin = row.querySelector(".light-note-pin-button");
        const icon = pin?.querySelector(".material-icon");
        const pinRect = pin?.getBoundingClientRect();
        const pinStyle = pin ? getComputedStyle(pin) : null;
        const iconStyle = icon ? getComputedStyle(icon) : null;
        return {
          id: row.getAttribute("data-note-id") || "",
          title: row.querySelector(".light-note-feed-copy strong")?.textContent?.trim() || "",
          pinned: pin?.getAttribute("data-note-pinned") || "",
          rect: rectData(row),
          pinRect: rectData(pin),
          pinBackground: pinStyle?.backgroundColor || "",
          pinBorderWidth: pinStyle?.borderTopWidth || "",
          pinBorderRadius: pinStyle?.borderRadius || "",
          pinBoxShadow: pinStyle?.boxShadow || "",
          iconWidth: iconStyle ? Math.round(parseFloat(iconStyle.width || "0")) : 0,
          iconHeight: iconStyle ? Math.round(parseFloat(iconStyle.height || "0")) : 0,
          pinWidth: pinRect ? Math.round(pinRect.width) : 0,
          pinHeight: pinRect ? Math.round(pinRect.height) : 0
        };
      })
    };
  });
}

async function readNoteDetailView(page) {
  return page.evaluate(() => ({
    route: document.querySelector(".light-shell")?.getAttribute("data-light-route") || "",
    headerTitle: document.querySelector(".light-page-title-detail")?.textContent?.trim() || "",
    articleCount: document.querySelectorAll(".light-doc-article.light-note-detail").length,
    noteBodyCount: document.querySelectorAll(".light-note-body").length,
    htmlBodyCount: document.querySelectorAll(".light-detail-html-body").length,
    htmlFrameCount: document.querySelectorAll(".light-detail-html-body .light-html-frame").length,
    htmlEmptyCount: document.querySelectorAll(".light-html-empty.light-detail-html-body").length
  }));
}

async function waitForNotes(page, timeoutMs) {
  await page.locator(".light-note-row").first().waitFor({ state: "visible", timeout: timeoutMs });
}

async function expectPreviewApiTokenLock(page, timeoutMs) {
  await page.waitForFunction(() => {
    const shell = document.querySelector(".light-shell");
    const title = document.querySelector(".light-empty-state h2");
    const detail = document.querySelector(".light-empty-state p");
    const action = document.querySelector(".light-empty-state .light-empty-state-action");
    return shell?.getAttribute("data-light-route") === "notes"
      && String(title?.textContent || "").trim() === "Preview needs api_token"
      && String(detail?.textContent || "").trim() === "Web preview is locked. Use Unlock web preview to load live Notes from the VM in this browser."
      && String(action?.textContent || "").trim() === "Unlock web preview";
  }, { timeout: timeoutMs });
}

async function unlockBrowserPreview(page, apiToken, timeoutMs) {
  assert(String(apiToken || "").trim(), "Expected PUCKY_WEB_UI_TOKEN to unlock live Notes preview");
  await page.getByRole("button", { name: "Unlock web preview" }).click();
  await page.getByPlaceholder("Paste PUCKY_WEB_UI_TOKEN").waitFor({ state: "visible", timeout: timeoutMs });
  await page.getByPlaceholder("Paste PUCKY_WEB_UI_TOKEN").fill(String(apiToken || "").trim());
  await page.getByRole("button", { name: "Save token" }).click();
  await page.waitForFunction(() => !document.querySelector(".browser-unlock-sheet"), { timeout: timeoutMs });
  await page.waitForFunction(() => Boolean(localStorage.getItem("pucky.cover.browser_api_token.v1")), { timeout: timeoutMs });
}

async function ensureNotesUnlocked(page, config) {
  const locked = await page.waitForFunction(() => {
    const shell = document.querySelector(".light-shell");
    const title = document.querySelector(".light-empty-state h2");
    return shell?.getAttribute("data-light-route") === "notes"
      && String(title?.textContent || "").trim() === "Preview needs api_token";
  }, { timeout: 1200 }).then(() => true).catch(() => false);
  if (!locked) {
    return;
  }
  await expectPreviewApiTokenLock(page, config.timeoutMs);
  await unlockBrowserPreview(page, config.apiToken, config.timeoutMs);
}

async function reloadIntoNotes(page, timeoutMs) {
  await page.reload({ waitUntil: "domcontentloaded" });
  const route = await page.evaluate(() => document.querySelector(".light-shell")?.getAttribute("data-light-route") || "");
  if (route !== "notes") {
    await backUntilHome(page, timeoutMs);
    await clickHomeTile(page, "notes", timeoutMs);
  }
  await waitForNotes(page, timeoutMs);
}

async function runViewportScenario(browser, config, repo, viewport, index) {
  const viewportDir = path.join(config.reportDir, viewport.label);
  ensureDir(viewportDir);
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    isMobile: viewport.width <= 768,
    hasTouch: viewport.width <= 768
  });
  const consoleLogPath = path.join(viewportDir, "console.log");
  try {
    const page = await context.newPage();
    attachPageLogging(page, consoleLogPath);
    await page.goto(config.pageUrl, { waitUntil: "domcontentloaded", timeout: 120000 });
    await waitForRoute(page, "home", config.timeoutMs);

    const homeCenterBefore = await attemptHorizontalShift(page, `${viewport.label}:home`);
    const homeBeforeShot = await saveScreenshot(page, viewportDir, "01-home-centered-before");

    const tileRoutes = await page.evaluate(() =>
      [...document.querySelectorAll('.light-shell[data-light-route="home"] .light-app-tile[data-route]')]
        .map(node => String(node.getAttribute("data-route") || "").trim())
        .filter(Boolean)
    );
    const uniqueRoutes = [...new Set(tileRoutes)];
    const routeMetrics = [];
    let notesResult = null;

    for (const route of uniqueRoutes) {
      await backUntilHome(page, config.timeoutMs);
      await clickHomeTile(page, route, config.timeoutMs);
      await page.waitForTimeout(350);
      const centering = await attemptHorizontalShift(page, `${viewport.label}:${route}`);
      const entry = { route, centering };
      if (route === "notes") {
        await ensureNotesUnlocked(page, config);
        await waitForNotes(page, config.timeoutMs);
        const baseline = await readNotesView(page);
        assert(baseline.rowPinButtons > 0, `${viewport.label}: live Notes has no row pin buttons`);
        assert(baseline.leftIcons === 0, `${viewport.label}: live Notes still shows left icons`);
        assert(baseline.cardRows === 0, `${viewport.label}: live Notes still renders tile-card rows`);
        assert(new Set(baseline.rows.map(row => row.rect?.width || 0)).size <= 1, `${viewport.label}: live Notes row widths diverged`);
        assert(baseline.rows.every(row => row.pinWidth === 36 && row.pinHeight === 36), `${viewport.label}: live Notes pin tap target size mismatch`);
        assert(baseline.rows.every(row => row.iconWidth === 16 && row.iconHeight === 16), `${viewport.label}: live Notes pin icon size mismatch`);
        assert(baseline.rows.every(row => row.pinBackground === "rgba(0, 0, 0, 0)"), `${viewport.label}: live Notes pin still has visible background`);
        assert(baseline.rows.every(row => row.pinBorderWidth === "0px"), `${viewport.label}: live Notes pin still has border chrome`);
        assert(baseline.rows.every(row => row.pinBorderRadius === "0px"), `${viewport.label}: live Notes pin still has circular radius`);
        assert(baseline.rows.every(row => row.pinBoxShadow === "none"), `${viewport.label}: live Notes pin still has shadow chrome`);
        if (index === 0) {
          const baselineShot = await saveScreenshot(page, viewportDir, "02-notes-feed-baseline");
          const candidate = baseline.rows.find(row => row.pinned === "false") || baseline.rows[0];
          assert(candidate, `${viewport.label}: live Notes has no candidate row to toggle`);
          const originalPinned = candidate.pinned === "true";
          await page.locator(`.light-note-row[data-note-id="${candidate.id}"] .light-note-feed-copy`).click();
          await page.locator(".light-page-title-detail").waitFor({ state: "visible", timeout: config.timeoutMs });
          const detail = await readNoteDetailView(page);
          assert(detail.route === "note-detail", `${viewport.label}: live Notes detail route did not open`);
          assert(detail.headerTitle === candidate.title, `${viewport.label}: live Notes detail header did not use note title`);
          assert(detail.articleCount === 0, `${viewport.label}: live Notes still renders the legacy note detail article`);
          assert(detail.noteBodyCount === 0, `${viewport.label}: live Notes still renders summary/body copy beneath the header`);
          assert(detail.htmlBodyCount === 1, `${viewport.label}: live Notes expected a single HTML display area`);
          assert(detail.htmlFrameCount + detail.htmlEmptyCount === 1, `${viewport.label}: live Notes expected rendered HTML frame or fallback empty state`);
          const detailShot = await saveScreenshot(page, viewportDir, "03-note-detail-clean");
          await page.locator('button[aria-label="Back"]').click();
          await waitForNotes(page, config.timeoutMs);
          await page.locator(`.light-note-row[data-note-id="${candidate.id}"] .light-note-pin-button`).click();
          await page.waitForFunction(
            ({ noteId, nextPinned }) => {
              const row = document.querySelector(`.light-note-row[data-note-id="${noteId}"] .light-note-pin-button`);
              return row?.getAttribute("data-note-pinned") === String(nextPinned);
            },
            { noteId: candidate.id, nextPinned: !originalPinned },
            { timeout: 120000 }
          );
          const afterFirst = await readNotesView(page);
          const afterPinShot = await saveScreenshot(page, viewportDir, "04-notes-after-pin");
          await page.locator(`.light-note-row[data-note-id="${candidate.id}"] .light-note-pin-button`).click();
          await page.waitForFunction(
            ({ noteId, originalPinned }) => {
              const row = document.querySelector(`.light-note-row[data-note-id="${noteId}"] .light-note-pin-button`);
              return row?.getAttribute("data-note-pinned") === String(originalPinned);
            },
            { noteId: candidate.id, originalPinned },
            { timeout: 120000 }
          );
          const afterSecond = await readNotesView(page);
          const afterUnpinShot = await saveScreenshot(page, viewportDir, "05-notes-after-unpin");
          await reloadIntoNotes(page, config.timeoutMs);
          const reloaded = await readNotesView(page);
          assert(reloaded.rows.find(row => row.id === candidate.id)?.pinned === String(originalPinned), `${viewport.label}: live Notes did not persist restored pin state after reload`);
          const reloadShot = await saveScreenshot(page, viewportDir, "06-notes-after-reload");
          notesResult = {
            baseline,
            detail,
            after_first_toggle: afterFirst,
            after_second_toggle: afterSecond,
            reloaded,
            candidate_id: candidate.id,
            candidate_title: candidate.title,
            original_pinned: originalPinned,
            screenshots: {
              baseline: baselineShot,
              note_detail_clean: detailShot,
              after_pin: afterPinShot,
              after_unpin: afterUnpinShot,
              after_reload: reloadShot
            }
          };
        } else {
          entry.notes = baseline;
        }
      }
      routeMetrics.push(entry);
    }

    await backUntilHome(page, config.timeoutMs);
    const homeCenterAfter = await attemptHorizontalShift(page, `${viewport.label}:home-after`);
    const homeAfterShot = await saveScreenshot(page, viewportDir, "07-home-centered-after-swipe");

    return {
      viewport,
      tile_routes: uniqueRoutes,
      home_before: homeCenterBefore,
      home_after: homeCenterAfter,
      home_screenshots: {
        before: homeBeforeShot,
        after: homeAfterShot
      },
      route_metrics: routeMetrics,
      notes_result: notesResult
    };
  } finally {
    await context.close();
  }
}

async function main() {
  const config = parseArgs(process.argv.slice(2));
  ensureDir(config.reportDir);
  const repo = ensureCanonicalMasterReady();
  const manifest = await fetchManifest(config.pageUrl);
  assert(String(manifest.source_commit_full || "") === String(repo.head || ""), `Live manifest commit ${manifest.source_commit_full || "<empty>"} does not match pushed master HEAD ${repo.head}`);
  assert(String(manifest.ui_version || "").trim(), "Live manifest ui_version is empty");
  writeJsonFile(path.join(config.reportDir, "live-manifest.json"), manifest);
  let browser;
  try {
    browser = await chromium.launch({ executablePath: resolveChromePath(), headless: config.headless });
    const results = [];
    for (let index = 0; index < viewports.length; index += 1) {
      results.push(await runViewportScenario(browser, config, repo, viewports[index], index));
    }
    writeJsonFile(path.join(config.reportDir, "live-centering-metrics.json"), {
      page_url: config.pageUrl,
      manifest,
      repo,
      viewports: results
    });
    console.log(JSON.stringify({
      page_url: config.pageUrl,
      report_dir: config.reportDir,
      manifest,
      repo_head: repo.head,
      viewports: results.map(result => ({
        label: result.viewport.label,
        routes: result.tile_routes,
        notes_candidate: result.notes_result?.candidate_title || null
      }))
    }, null, 2));
  } catch (error) {
    writeAutomationError(config.reportDir, error);
    throw error;
  } finally {
    await browser?.close().catch(() => {});
  }
}

await main();
