import path from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright-core";
import {
  attachPageLogging,
  ensureDir,
  resolveChromePath,
  saveScreenshot,
  writeAutomationError,
  writeJsonFile,
} from "../../support/cover_shared.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../..");
const defaultReportDir = path.join(repoRoot, "artifacts", "cover-home-app-labels");
const DEFAULT_BASE_URL = "https://pucky.fly.dev";
const VIEWPORT = { width: 395, height: 786 };
const OVERLAP_EPSILON = 0.5;
const CENTER_EPSILON = 2;

function parseArgs(argv) {
  const config = {
    baseUrl: DEFAULT_BASE_URL,
    pageUrl: "",
    reportDir: defaultReportDir,
    refreshKey: String(Date.now()),
    timeoutMs: 30000,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = String(argv[index] || "");
    if (arg === "--base-url" && argv[index + 1]) {
      config.baseUrl = String(argv[++index] || config.baseUrl).trim();
    } else if (arg === "--page-url" && argv[index + 1]) {
      config.pageUrl = String(argv[++index] || "").trim();
    } else if (arg === "--report-dir" && argv[index + 1]) {
      config.reportDir = path.resolve(String(argv[++index] || config.reportDir));
    } else if (arg === "--refresh-key" && argv[index + 1]) {
      config.refreshKey = String(argv[++index] || config.refreshKey).trim();
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

function buildPageUrl(config) {
  if (config.pageUrl) {
    return config.pageUrl;
  }
  const url = new URL(config.baseUrl || DEFAULT_BASE_URL);
  if (!url.pathname || url.pathname === "/") {
    url.pathname = "/ui/pucky/latest/index.html";
  } else if (url.pathname.endsWith("/")) {
    url.pathname = `${url.pathname}index.html`;
  }
  url.searchParams.set("theme", "light");
  url.searchParams.set("route", "home");
  url.searchParams.set("reset_nav", "1");
  if (config.refreshKey) {
    url.searchParams.set("_pucky_refresh", config.refreshKey);
  }
  return url.toString();
}

async function collectHomeLabelMetrics(page) {
  return await page.evaluate(() => {
    function domRect(node) {
      const rect = node.getBoundingClientRect();
      return {
        left: rect.left,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
        width: rect.width,
        height: rect.height,
        centerX: rect.left + rect.width / 2,
        centerY: rect.top + rect.height / 2,
      };
    }

    const grid = document.querySelector(".light-app-grid");
    const gridStyle = grid ? window.getComputedStyle(grid) : null;
    const labels = Array.from(document.querySelectorAll(".light-app-tile")).map((tile, index) => {
      const icon = tile.querySelector(".light-app-icon");
      const label = tile.querySelector(".light-app-label");
      const tileStyle = window.getComputedStyle(tile);
      const labelStyle = label ? window.getComputedStyle(label) : null;
      return {
        index,
        route: tile.getAttribute("data-route") || "",
        text: tile.getAttribute("data-app-label") || label?.textContent?.trim() || "",
        tile: domRect(tile),
        icon: icon ? domRect(icon) : null,
        label: label ? domRect(label) : null,
        tileStyle: {
          paddingTop: tileStyle.paddingTop,
          paddingRight: tileStyle.paddingRight,
          paddingBottom: tileStyle.paddingBottom,
          paddingLeft: tileStyle.paddingLeft,
          gridTemplateColumns: tileStyle.gridTemplateColumns,
          width: tileStyle.width,
        },
        labelStyle: labelStyle ? {
          whiteSpace: labelStyle.whiteSpace,
          width: labelStyle.width,
          maxWidth: labelStyle.maxWidth,
          minHeight: labelStyle.minHeight,
          textAlign: labelStyle.textAlign,
        } : null,
      };
    });
    return {
      schema: "pucky.home_app_labels_browser_proof.v1",
      location: window.location.href,
      viewport: {
        width: window.innerWidth,
        height: window.innerHeight,
      },
      grid: grid ? {
        rect: domRect(grid),
        columnGap: gridStyle?.columnGap || "",
        gridTemplateColumns: gridStyle?.gridTemplateColumns || "",
      } : null,
      labels,
    };
  });
}

function assertNoSameRowLabelOverlap(metrics) {
  const labels = metrics.labels.filter((item) => item.label);
  const overlaps = [];
  for (let leftIndex = 0; leftIndex < labels.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < labels.length; rightIndex += 1) {
      const left = labels[leftIndex];
      const right = labels[rightIndex];
      const verticalOverlap = Math.min(left.label.bottom, right.label.bottom) - Math.max(left.label.top, right.label.top);
      const horizontalOverlap = Math.min(left.label.right, right.label.right) - Math.max(left.label.left, right.label.left);
      if (verticalOverlap > OVERLAP_EPSILON && horizontalOverlap > OVERLAP_EPSILON) {
        overlaps.push({
          a: left.text,
          b: right.text,
          verticalOverlap,
          horizontalOverlap,
          aLabel: left.label,
          bLabel: right.label,
        });
      }
    }
  }
  assert(overlaps.length === 0, `Home app labels overlap within a row: ${JSON.stringify(overlaps)}`);
}

function assertHomeLabelContract(metrics) {
  const labels = metrics.labels.filter((item) => item.label);
  assert(metrics.grid, "Missing .light-app-grid");
  assert(labels.length >= 11, `Expected home app labels, found ${labels.length}`);
  const meetingNotes = labels.find((item) => item.text === "Meeting Notes");
  assert(meetingNotes, "Meeting Notes label is missing");

  for (const item of labels) {
    assert(item.labelStyle?.whiteSpace !== "nowrap", `${item.text} label still uses nowrap`);
    assert(item.tileStyle?.paddingTop === "0px", `${item.text} tile top padding is not 0`);
    assert(item.tileStyle?.paddingRight === "0px", `${item.text} tile right padding is not 0`);
    assert(item.tileStyle?.paddingBottom === "0px", `${item.text} tile bottom padding is not 0`);
    assert(item.tileStyle?.paddingLeft === "0px", `${item.text} tile left padding is not 0`);
    assert(item.icon, `${item.text} icon is missing`);
    const tileCenter = item.tile.centerX;
    const iconDrift = Math.abs(item.icon.centerX - tileCenter);
    const labelDrift = Math.abs(item.label.centerX - tileCenter);
    assert(iconDrift <= CENTER_EPSILON, `${item.text} icon center drift ${iconDrift.toFixed(2)}px`);
    assert(labelDrift <= CENTER_EPSILON, `${item.text} label center drift ${labelDrift.toFixed(2)}px`);
    assert(item.label.left >= item.tile.left - OVERLAP_EPSILON, `${item.text} label bleeds left of tile`);
    assert(item.label.right <= item.tile.right + OVERLAP_EPSILON, `${item.text} label bleeds right of tile`);
  }
  assertNoSameRowLabelOverlap(metrics);
}

async function main() {
  const config = parseArgs(process.argv.slice(2));
  ensureDir(config.reportDir);
  const pageUrl = buildPageUrl(config);
  const consoleLogPath = path.join(config.reportDir, "console.log");
  const browser = await chromium.launch({
    executablePath: resolveChromePath(),
    headless: true,
  });
  const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 2 });
  const page = await context.newPage();
  attachPageLogging(page, consoleLogPath);
  try {
    await page.goto(pageUrl, { waitUntil: "domcontentloaded", timeout: config.timeoutMs });
    await page.waitForSelector(".light-app-tile[data-route='meeting-notes'] .light-app-label", { timeout: config.timeoutMs });
    await page.waitForLoadState("networkidle", { timeout: config.timeoutMs }).catch(() => {});
    const metrics = await collectHomeLabelMetrics(page);
    assertHomeLabelContract(metrics);
    const screenshot = await saveScreenshot(page, config.reportDir, "home-app-labels");
    const summary = {
      ...metrics,
      ok: true,
      pageUrl,
      screenshot,
    };
    writeJsonFile(path.join(config.reportDir, "summary.json"), summary);
    await browser.close();
    return 0;
  } catch (error) {
    const screenshot = await saveScreenshot(page, config.reportDir, "home-app-labels-failure").catch(() => "");
    writeAutomationError(config.reportDir, error);
    writeJsonFile(path.join(config.reportDir, "summary.json"), {
      schema: "pucky.home_app_labels_browser_proof.v1",
      ok: false,
      pageUrl,
      viewport: VIEWPORT,
      screenshot,
      error: error.message || String(error),
    });
    await browser.close();
    throw error;
  }
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exit(1);
});
