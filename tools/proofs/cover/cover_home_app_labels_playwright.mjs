import path from "node:path";
import { fileURLToPath } from "node:url";
import os from "node:os";
import { createRequire } from "node:module";

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
const require = createRequire(import.meta.url);
const DEFAULT_BASE_URL = "https://pucky.fly.dev";
const VIEWPORT = { width: 395, height: 786 };
const THEMES = ["light", "dark"];
const OVERLAP_EPSILON = 0.5;
const CENTER_EPSILON = 2;
const BADGE_CENTER_EPSILON = 3;

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
    () => require(bundled),
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

function buildPageUrl(config, theme) {
  if (config.pageUrl) {
    const url = new URL(config.pageUrl);
    url.searchParams.set("theme", theme);
    url.searchParams.set("route", "home");
    url.searchParams.set("reset_nav", "1");
    if (config.refreshKey) {
      url.searchParams.set("_pucky_refresh", config.refreshKey);
    }
    return url.toString();
  }
  const url = new URL(config.baseUrl || DEFAULT_BASE_URL);
  if (!url.pathname || url.pathname === "/") {
    url.pathname = "/ui/pucky/latest/index.html";
  } else if (url.pathname.endsWith("/")) {
    url.pathname = `${url.pathname}index.html`;
  }
  url.searchParams.set("theme", theme);
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

    function rgbToHex(value) {
      const match = String(value || "").trim().match(/^rgba?\(([^)]+)\)$/i);
      if (!match) {
        return String(value || "").trim();
      }
      const parts = match[1].split(",").map((part) => Number.parseFloat(part.trim()));
      if (parts.length < 3 || parts.slice(0, 3).some((part) => !Number.isFinite(part))) {
        return String(value || "").trim();
      }
      return `#${parts.slice(0, 3).map((part) => Math.max(0, Math.min(255, Math.round(part))).toString(16).padStart(2, "0")).join("")}`.toLowerCase();
    }

    const registry = window.PUCKY_UI_ICONS && typeof window.PUCKY_UI_ICONS === "object"
      && window.PUCKY_UI_ICONS.SEMANTIC_ICON_REGISTRY && typeof window.PUCKY_UI_ICONS.SEMANTIC_ICON_REGISTRY === "object"
      ? window.PUCKY_UI_ICONS.SEMANTIC_ICON_REGISTRY
      : {};
    const theme = String(document.documentElement?.dataset?.theme || document.body?.dataset?.theme || new URL(window.location.href).searchParams.get("theme") || "light").trim().toLowerCase();
    const grid = document.querySelector(".light-app-grid");
    const gridStyle = grid ? window.getComputedStyle(grid) : null;
    const labels = Array.from(document.querySelectorAll(".light-app-tile")).map((tile, index) => {
      const icon = tile.querySelector(".light-app-icon");
      const label = tile.querySelector(".light-app-label");
      const badge = tile.querySelector(".light-app-badge");
      const tileStyle = window.getComputedStyle(tile);
      const iconStyle = icon ? window.getComputedStyle(icon) : null;
      const labelStyle = label ? window.getComputedStyle(label) : null;
      const semanticKey = String(tile.getAttribute("data-semantic-icon") || icon?.getAttribute("data-semantic-icon") || "").trim();
      const registryEntry = semanticKey ? registry[semanticKey] || null : null;
      return {
        index,
        route: tile.getAttribute("data-route") || "",
        semanticKey,
        accentKey: String(icon?.dataset?.appAccent || "").trim(),
        text: tile.getAttribute("data-app-label") || label?.textContent?.trim() || "",
        badge: badge ? domRect(badge) : null,
        badgeCount: badge ? String(badge.textContent || "").trim() : "",
        registryIcon: String(registryEntry?.icon || "").trim(),
        registryColors: registryEntry && typeof registryEntry.colors === "object" ? registryEntry.colors : null,
        tile: domRect(tile),
        icon: icon ? domRect(icon) : null,
        label: label ? domRect(label) : null,
        iconColor: iconStyle?.color || "",
        iconColorHex: rgbToHex(iconStyle?.color || ""),
        iconBackground: iconStyle?.backgroundColor || "",
        iconAccentVar: String(iconStyle?.getPropertyValue("--icon-accent") || "").trim().toLowerCase(),
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
      theme,
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
    assert(item.semanticKey, `${item.text} semantic key is missing`);
    assert(item.registryIcon, `${item.text} registry icon is missing`);
    assert(item.registryColors, `${item.text} registry colors are missing`);
    assert(item.accentKey === item.semanticKey, `${item.text} accent key drifted from semantic key`);
    const expectedColor = String(item.registryColors?.[metrics.theme] || item.registryColors?.dark || item.registryColors?.light || "").trim().toLowerCase();
    assert(expectedColor, `${item.text} registry color is missing for ${metrics.theme}`);
    assert(item.iconAccentVar === expectedColor, `${item.text} icon accent var expected ${expectedColor}, saw ${item.iconAccentVar}`);
    assert(item.iconColorHex === expectedColor, `${item.text} icon color expected ${expectedColor}, saw ${item.iconColorHex}`);
    assert(item.iconBackground && item.iconBackground !== "rgba(0, 0, 0, 0)" && item.iconBackground !== "transparent", `${item.text} icon background is transparent`);
    if (item.badge) {
      const badgeCenterX = item.badge.left + item.badge.width / 2;
      const badgeCenterY = item.badge.top + item.badge.height / 2;
      const expectedCenterX = item.icon.right;
      const expectedCenterY = item.icon.top;
      const badgeDriftX = Math.abs(badgeCenterX - expectedCenterX);
      const badgeDriftY = Math.abs(badgeCenterY - expectedCenterY);
      assert(item.badgeCount, `${item.text} badge is missing visible text`);
      assert(badgeDriftX <= BADGE_CENTER_EPSILON, `${item.text} badge geometry drifted horizontally by ${badgeDriftX.toFixed(2)}px`);
      assert(badgeDriftY <= BADGE_CENTER_EPSILON, `${item.text} badge geometry drifted vertically by ${badgeDriftY.toFixed(2)}px`);
    }
  }
  assertNoSameRowLabelOverlap(metrics);
}

async function main() {
  const config = parseArgs(process.argv.slice(2));
  ensureDir(config.reportDir);
  const consoleLogPath = path.join(config.reportDir, "console.log");
  const browser = await chromium.launch({
    executablePath: resolveChromePath(),
    headless: true,
  });
  const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 2 });
  const page = await context.newPage();
  attachPageLogging(page, consoleLogPath);
  try {
    const summary = {
      schema: "pucky.home_app_labels_browser_proof.v1",
      ok: true,
      themes: {},
    };
    for (const theme of THEMES) {
      const pageUrl = buildPageUrl(config, theme);
      await page.goto(pageUrl, { waitUntil: "domcontentloaded", timeout: config.timeoutMs });
      await page.waitForSelector(".light-app-tile[data-route='meeting-notes'] .light-app-label", { timeout: config.timeoutMs });
      await page.waitForLoadState("networkidle", { timeout: config.timeoutMs }).catch(() => {});
      const metrics = await collectHomeLabelMetrics(page);
      assertHomeLabelContract(metrics);
      const screenshot = await saveScreenshot(page, config.reportDir, `home-app-labels-${theme}`);
      summary.themes[theme] = {
        ...metrics,
        pageUrl,
        screenshot,
      };
    }
    writeJsonFile(path.join(config.reportDir, "summary.json"), summary);
    await browser.close();
    return 0;
  } catch (error) {
    const screenshot = await saveScreenshot(page, config.reportDir, "home-app-labels-failure").catch(() => "");
    writeAutomationError(config.reportDir, error);
    writeJsonFile(path.join(config.reportDir, "summary.json"), {
      schema: "pucky.home_app_labels_browser_proof.v1",
      ok: false,
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
