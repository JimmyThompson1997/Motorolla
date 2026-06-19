import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright-core";

import {
  attachPageLogging,
  ensureDir,
  resolveChromePath,
  writeAutomationError,
  writeJsonFile
} from "../../support/cover_shared.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const DEFAULT_PAGE_URL = "https://pucky.fly.dev/ui/pucky/latest/?theme=light&reset_nav=1";
const VIEWPORT = { width: 430, height: 932 };

function parseArgs(argv) {
  const config = {
    pageUrl: process.env.PUCKY_HEADER_PROOF_URL || DEFAULT_PAGE_URL,
    reportDir: path.resolve(repoRoot, ".tmp", "header-full-bleed-proof"),
    timeoutMs: 20000,
    headless: true
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = String(argv[index] || "");
    if (arg === "--page-url" && argv[index + 1]) {
      config.pageUrl = String(argv[++index] || config.pageUrl);
    } else if (arg === "--report-dir" && argv[index + 1]) {
      config.reportDir = path.resolve(String(argv[++index] || config.reportDir));
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
  if (!String(status.branch_status || "").startsWith("## master...origin/master")) {
    throw new Error(`Canonical repo must be on master tracking origin/master. Saw: ${status.branch_status}`);
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

async function saveViewportScreenshot(page, reportDir, fileName) {
  const target = path.join(reportDir, `${fileName}.png`);
  await page.screenshot({
    path: target,
    fullPage: false,
    animations: "disabled",
    timeout: 120000
  });
  return target;
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

async function backUntilRoute(page, targetRoute, timeoutMs) {
  for (let index = 0; index < 8; index += 1) {
    const current = await page.evaluate(() => document.querySelector(".light-shell")?.getAttribute("data-light-route") || "");
    if (current === targetRoute) {
      return;
    }
    await page.evaluate(() => window.PuckyHandleAndroidBack && window.PuckyHandleAndroidBack());
    await page.waitForTimeout(250);
  }
  await waitForRoute(page, targetRoute, timeoutMs);
}

async function resetScroll(page) {
  await page.evaluate(() => {
    const feed = document.getElementById("feed");
    if (feed && typeof feed.scrollTo === "function") {
      feed.scrollTo({ top: 0, behavior: "instant" });
      return;
    }
    window.scrollTo({ top: 0, behavior: "instant" });
  });
  await page.waitForTimeout(150);
}

async function scrollForProof(page) {
  await page.evaluate(() => {
    const feed = document.getElementById("feed");
    if (feed && feed.scrollHeight > feed.clientHeight && typeof feed.scrollTo === "function") {
      const maxFeedScroll = Math.max(0, feed.scrollHeight - feed.clientHeight);
      const feedTarget = Math.min(maxFeedScroll, Math.max(220, Math.round(feed.clientHeight * 0.55)));
      feed.scrollTo({ top: feedTarget, behavior: "instant" });
      return;
    }
    const maxWindowScroll = Math.max(
      0,
      document.documentElement.scrollHeight - window.innerHeight,
      document.body.scrollHeight - window.innerHeight
    );
    const windowTarget = Math.min(maxWindowScroll, Math.max(220, Math.round(window.innerHeight * 0.55)));
    window.scrollTo({ top: windowTarget, behavior: "instant" });
  });
  await page.waitForTimeout(250);
}

async function collectHeaderMetrics(page, screenId, options = {}) {
  return page.evaluate(({ screenId: innerScreenId, expectDetail }) => {
    function rectData(node) {
      if (!node) return null;
      const rect = node.getBoundingClientRect();
      return {
        x: Number(rect.x.toFixed(2)),
        y: Number(rect.y.toFixed(2)),
        width: Number(rect.width.toFixed(2)),
        height: Number(rect.height.toFixed(2)),
        top: Number(rect.top.toFixed(2)),
        right: Number(rect.right.toFixed(2)),
        bottom: Number(rect.bottom.toFixed(2)),
        left: Number(rect.left.toFixed(2)),
        center_x: Number((rect.left + rect.width / 2).toFixed(2)),
        center_y: Number((rect.top + rect.height / 2).toFixed(2))
      };
    }

    const shell = document.querySelector(".light-shell");
    const feed = document.getElementById("feed");
    const pageNode = shell?.querySelector(".light-page");
    const headerOuter = pageNode?.querySelector(":scope > .light-page-header-shell") || shell?.querySelector(".light-page-header-shell");
    const headerInner = headerOuter?.querySelector(".light-page-header");
    const title = headerInner?.querySelector(".light-page-title");
    const backButton = headerInner?.querySelector(".light-back-button, .light-nav-slot");
    const backIcon = backButton?.querySelector("svg, .material-icon");
    const contentNodes = pageNode ? Array.from(pageNode.children).filter(node => !node.classList.contains("light-page-header-shell")) : [];
    const contentColumn = contentNodes.find(node => node.getBoundingClientRect().height > 0) || null;
    const titleStyle = title ? window.getComputedStyle(title) : null;
    const route = shell?.getAttribute("data-light-route") || "";
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const outerRect = rectData(headerOuter);
    const innerRect = rectData(headerInner);
    const contentRect = rectData(contentColumn);
    const backRect = rectData(backButton);
    const backIconRect = rectData(backIcon);
    const titleRect = rectData(title);

    return {
      screen_id: innerScreenId,
      route,
      expect_detail: Boolean(expectDetail),
      viewport: {
        width: viewportWidth,
        height: viewportHeight,
        scroll_y: Number(window.scrollY.toFixed(2)),
        feed_scroll_top: feed ? Number(feed.scrollTop.toFixed(2)) : null
      },
      header_outer: outerRect,
      header_inner: innerRect,
      content_column: contentRect,
      back_button: backRect,
      back_icon: backIconRect,
      title: {
        text: String(title?.textContent || "").trim(),
        class_name: String(title?.className || ""),
        rect: titleRect,
        font_size: titleStyle?.fontSize || "",
        font_weight: titleStyle?.fontWeight || "",
        text_align: titleStyle?.textAlign || "",
        line_height: titleStyle?.lineHeight || ""
      },
      sticky_visible: Boolean(outerRect && outerRect.top <= 1 && outerRect.bottom > 0),
      deltas: {
        header_width_vs_viewport: outerRect ? Number(Math.abs(outerRect.width - viewportWidth).toFixed(2)) : null,
        inner_left_vs_content_left: innerRect && contentRect ? Number(Math.abs(innerRect.left - contentRect.left).toFixed(2)) : null,
        inner_right_vs_content_right: innerRect && contentRect ? Number(Math.abs(innerRect.right - contentRect.right).toFixed(2)) : null,
        back_icon_center_vs_button_center: backRect && backIconRect ? Number(Math.abs(backRect.center_y - backIconRect.center_y).toFixed(2)) : null,
        back_button_center_y_vs_row_center: backRect && innerRect ? Number(Math.abs(backRect.center_y - innerRect.center_y).toFixed(2)) : null,
        title_center_y_vs_row_center: titleRect && innerRect ? Number(Math.abs(titleRect.center_y - innerRect.center_y).toFixed(2)) : null,
        title_center_x_vs_row_center: titleRect && innerRect ? Number(Math.abs(titleRect.center_x - innerRect.center_x).toFixed(2)) : null
      }
    };
  }, { screenId, expectDetail: Boolean(options.expectDetail) });
}

function evaluateScreen(metrics, baselineTopLevel = null) {
  const failures = [];
  const isDetail = Boolean(metrics.expect_detail);
  if (!metrics.sticky_visible) failures.push("sticky header not visible");
  if ((metrics.deltas.header_width_vs_viewport ?? 99) > 1) failures.push("header outer width does not match viewport");
  if ((metrics.deltas.inner_left_vs_content_left ?? 99) > 1) failures.push("header inner left edge does not align to content column");
  if ((metrics.deltas.inner_right_vs_content_right ?? 99) > 1) failures.push("header inner right edge does not align to content column");
  if ((metrics.deltas.back_icon_center_vs_button_center ?? 99) > 1) failures.push("back icon is not vertically centered in its button");
  if ((metrics.deltas.back_button_center_y_vs_row_center ?? 99) > 2) failures.push("back button is not vertically centered in header row");
  if ((metrics.deltas.title_center_y_vs_row_center ?? 99) > 2) failures.push("title is not vertically centered in header row");
  if ((metrics.deltas.title_center_x_vs_row_center ?? 99) > 2) failures.push("title is not horizontally centered in header row");
  if (!isDetail && baselineTopLevel) {
    if (metrics.title.font_size !== baselineTopLevel.title.font_size) {
      failures.push(`title font size drifted from Inbox (${baselineTopLevel.title.font_size} -> ${metrics.title.font_size})`);
    }
    if (metrics.title.font_weight !== baselineTopLevel.title.font_weight) {
      failures.push(`title font weight drifted from Inbox (${baselineTopLevel.title.font_weight} -> ${metrics.title.font_weight})`);
    }
    if (metrics.title.text_align !== baselineTopLevel.title.text_align) {
      failures.push(`title alignment drifted from Inbox (${baselineTopLevel.title.text_align} -> ${metrics.title.text_align})`);
    }
  }
  if (isDetail && !String(metrics.title.class_name || "").includes("light-page-title-detail")) {
    failures.push("detail screen is missing the detail title class");
  }
  return {
    pass: failures.length === 0,
    failures
  };
}

async function captureRoute(page, config, route, label, screenshots, metricsList, baselineTopLevelRef) {
  await backUntilRoute(page, "home", config.timeoutMs);
  await resetScroll(page);
  await clickHomeTile(page, route, config.timeoutMs);
  await page.waitForTimeout(250);
  screenshots[`${label}_top`] = await saveViewportScreenshot(page, config.reportDir, `${label}-top`);
  const topMetrics = await collectHeaderMetrics(page, `${label}-top`);
  metricsList.push(topMetrics);
  if (!baselineTopLevelRef.value && route === "feed") {
    baselineTopLevelRef.value = topMetrics;
  }
  await scrollForProof(page);
  screenshots[`${label}_scrolled`] = await saveViewportScreenshot(page, config.reportDir, `${label}-scrolled`);
  metricsList.push(await collectHeaderMetrics(page, `${label}-scrolled`));
}

async function captureDetailRoute(page, config, originRoute, rowSelector, label, screenshots, metricsList) {
  await backUntilRoute(page, "home", config.timeoutMs);
  await resetScroll(page);
  await clickHomeTile(page, originRoute, config.timeoutMs);
  const row = page.locator(`.light-shell[data-light-route="${originRoute}"] ${rowSelector}`).first();
  await row.waitFor({ state: "visible", timeout: config.timeoutMs });
  await row.click();
  await page.waitForTimeout(300);
  screenshots[`${label}_top`] = await saveViewportScreenshot(page, config.reportDir, `${label}-top`);
  metricsList.push(await collectHeaderMetrics(page, `${label}-top`, { expectDetail: true }));
  await scrollForProof(page);
  screenshots[`${label}_scrolled`] = await saveViewportScreenshot(page, config.reportDir, `${label}-scrolled`);
  metricsList.push(await collectHeaderMetrics(page, `${label}-scrolled`, { expectDetail: true }));
}

function analysisMarkdown(summary) {
  const lines = [];
  lines.push("# Full-Bleed Header Proof");
  lines.push("");
  lines.push(`- Page URL: ${summary.page_url}`);
  lines.push(`- Git HEAD: ${summary.git.head}`);
  lines.push(`- Manifest commit: ${summary.manifest.source_commit_full}`);
  lines.push(`- Manifest ui_version: ${summary.manifest.ui_version}`);
  lines.push(`- Manifest created_at: ${summary.manifest.created_at}`);
  lines.push("");
  for (const screen of summary.screens) {
    lines.push(`## ${screen.screen_id}`);
    lines.push(`- Route: ${screen.route}`);
    lines.push(`- Screenshot: ${screen.screenshot}`);
    lines.push(`- Expected: full-bleed sticky header, centered title, aligned inner row/content column${screen.expect_detail ? ", detail title variant" : ""}.`);
    lines.push(`- Observed: sticky=${screen.sticky_visible}, outer-vs-viewport delta=${screen.deltas.header_width_vs_viewport}px, inner-left delta=${screen.deltas.inner_left_vs_content_left}px, inner-right delta=${screen.deltas.inner_right_vs_content_right}px, back-icon delta=${screen.deltas.back_icon_center_vs_button_center}px, back-button delta=${screen.deltas.back_button_center_y_vs_row_center}px, title-y delta=${screen.deltas.title_center_y_vs_row_center}px, title-x delta=${screen.deltas.title_center_x_vs_row_center}px.`);
    lines.push(`- Title: "${screen.title.text}" class=${screen.title.class_name} size=${screen.title.font_size} weight=${screen.title.font_weight} align=${screen.title.text_align}.`);
    lines.push(`- Result: ${screen.pass ? "PASS" : `FAIL (${screen.failures.join("; ")})`}`);
    lines.push("");
  }
  return lines.join("\n");
}

async function main() {
  const config = parseArgs(process.argv.slice(2));
  ensureDir(config.reportDir);

  const summary = {
    schema: "pucky.full_bleed_header_real_vm_proof.v1",
    ok: false,
    page_url: config.pageUrl,
    git: null,
    manifest: null,
    screenshots: {},
    screens: []
  };

  let browser;
  let context;
  try {
    const gitState = ensureCanonicalMasterReady();
    summary.git = gitState;
    writeJsonFile(path.join(config.reportDir, "git_state.json"), gitState);

    const manifest = await fetchManifest(config.pageUrl);
    summary.manifest = manifest;
    writeJsonFile(path.join(config.reportDir, "manifest.json"), manifest);
    assert(String(manifest.source_commit_full || "") === String(gitState.head || ""), `Live manifest commit ${manifest.source_commit_full || "<empty>"} does not match pushed master HEAD ${gitState.head}`);

    browser = await chromium.launch({
      executablePath: resolveChromePath(),
      headless: config.headless,
      args: ["--disable-extensions"]
    });
    context = await browser.newContext({
      viewport: VIEWPORT,
      screen: VIEWPORT,
      isMobile: true,
      hasTouch: true
    });
    const page = await context.newPage();
    attachPageLogging(page, path.join(config.reportDir, "console.log"));

    await page.goto(config.pageUrl, { waitUntil: "domcontentloaded", timeout: config.timeoutMs });
    await waitForRoute(page, "home", config.timeoutMs);
    await page.locator('.light-shell[data-light-route="home"] .light-app-grid').waitFor({ state: "visible", timeout: config.timeoutMs });
    summary.screenshots["01-home-shell"] = await saveViewportScreenshot(page, config.reportDir, "01-home-shell");

    const screenshots = {};
    const metricsList = [];
    const baselineTopLevelRef = { value: null };

    await captureRoute(page, config, "feed", "02-inbox", screenshots, metricsList, baselineTopLevelRef);
    await captureRoute(page, config, "contacts", "04-contacts", screenshots, metricsList, baselineTopLevelRef);
    await captureRoute(page, config, "projects", "06-projects", screenshots, metricsList, baselineTopLevelRef);
    await captureRoute(page, config, "settings", "08-settings", screenshots, metricsList, baselineTopLevelRef);
    await captureDetailRoute(page, config, "contacts", ".light-contact-row", "10-contact-detail", screenshots, metricsList);
    await captureDetailRoute(page, config, "projects", ".light-project-row", "12-project-detail", screenshots, metricsList);

    summary.screenshots = {
      ...summary.screenshots,
      "02-inbox-top": screenshots["02-inbox_top"],
      "03-inbox-scrolled": screenshots["02-inbox_scrolled"],
      "04-contacts-top": screenshots["04-contacts_top"],
      "05-contacts-scrolled": screenshots["04-contacts_scrolled"],
      "06-projects-top": screenshots["06-projects_top"],
      "07-projects-scrolled": screenshots["06-projects_scrolled"],
      "08-settings-top": screenshots["08-settings_top"],
      "09-settings-scrolled": screenshots["08-settings_scrolled"],
      "10-contact-detail-top": screenshots["10-contact-detail_top"],
      "11-contact-detail-scrolled": screenshots["10-contact-detail_scrolled"],
      "12-project-detail-top": screenshots["12-project-detail_top"],
      "13-project-detail-scrolled": screenshots["12-project-detail_scrolled"]
    };

    const screenshotAliases = {
      "02-inbox-top": "02-inbox-top",
      "02-inbox-scrolled": "03-inbox-scrolled",
      "04-contacts-top": "04-contacts-top",
      "04-contacts-scrolled": "05-contacts-scrolled",
      "06-projects-top": "06-projects-top",
      "06-projects-scrolled": "07-projects-scrolled",
      "08-settings-top": "08-settings-top",
      "08-settings-scrolled": "09-settings-scrolled",
      "10-contact-detail-top": "10-contact-detail-top",
      "10-contact-detail-scrolled": "11-contact-detail-scrolled",
      "12-project-detail-top": "12-project-detail-top",
      "12-project-detail-scrolled": "13-project-detail-scrolled"
    };

    summary.screens = metricsList.map(metrics => {
      const evaluation = evaluateScreen(metrics, metrics.expect_detail ? null : baselineTopLevelRef.value);
      return {
        ...metrics,
        ...evaluation,
        screenshot: summary.screenshots[screenshotAliases[metrics.screen_id] || ""]
      };
    });

    summary.ok = summary.screens.every(screen => screen.pass);
    writeJsonFile(path.join(config.reportDir, "summary.json"), summary);
    fs.writeFileSync(path.join(config.reportDir, "analysis.md"), analysisMarkdown(summary), "utf8");
    console.log(JSON.stringify(summary, null, 2));
    assert(summary.ok, "One or more header proof screens failed the full-bleed sticky-header acceptance thresholds");
  } catch (error) {
    writeAutomationError(config.reportDir, error);
    throw error;
  } finally {
    await context?.close().catch(() => {});
    await browser?.close().catch(() => {});
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
