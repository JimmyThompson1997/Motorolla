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
const defaultReportDir = path.join(repoRoot, "artifacts", "cover-settings-quiet-list");
const DEFAULT_BASE_URL = "https://pucky.fly.dev";
const VIEWPORT = { width: 393, height: 852 };
const MAX_ANY_ROW_HEIGHT = 82;
const MAX_NORMAL_ROW_HEIGHT = 64;

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
  url.searchParams.set("route", "settings");
  url.searchParams.set("reset_nav", "1");
  if (config.refreshKey) {
    url.searchParams.set("_pucky_refresh", config.refreshKey);
  }
  return url.toString();
}

async function collectSettingsMetrics(page) {
  return await page.evaluate(() => {
    function rectOf(node) {
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

    function isHittable(node) {
      if (!node) {
        return false;
      }
      const rect = node.getBoundingClientRect();
      const x = rect.left + rect.width / 2;
      const y = rect.top + rect.height / 2;
      const hit = document.elementFromPoint(x, y);
      return Boolean(hit && (node === hit || node.contains(hit) || hit.contains(node)));
    }

    const cards = Array.from(document.querySelectorAll(".light-settings-real .settings-card")).map((card) => {
      const style = window.getComputedStyle(card);
      const title = card.querySelector(".settings-card-title")?.textContent?.trim() || "";
      const detail = card.querySelector(".settings-card-detail")?.textContent?.trim() || "";
      const selector = card.querySelector(".settings-selector-button");
      const toggle = card.querySelector(".settings-toggle");
      const action = card.querySelector(".settings-action-button");
      return {
        id: card.getAttribute("data-setting-id") || "",
        title,
        detail,
        rect: rectOf(card),
        className: card.className,
        style: {
          backgroundColor: style.backgroundColor,
          borderTopWidth: style.borderTopWidth,
          borderRightWidth: style.borderRightWidth,
          borderBottomWidth: style.borderBottomWidth,
          borderLeftWidth: style.borderLeftWidth,
          borderTopColor: style.borderTopColor,
          borderRightColor: style.borderRightColor,
          borderBottomColor: style.borderBottomColor,
          borderLeftColor: style.borderLeftColor,
          borderRadius: style.borderRadius,
          boxShadow: style.boxShadow,
          minHeight: style.minHeight,
          gridTemplateColumns: style.gridTemplateColumns,
        },
        selector: selector ? { rect: rectOf(selector), text: selector.textContent.trim(), hittable: isHittable(selector), disabled: selector.disabled } : null,
        toggle: toggle ? { rect: rectOf(toggle), hittable: isHittable(toggle), disabled: toggle.disabled } : null,
        action: action ? { rect: rectOf(action), text: action.textContent.trim(), hittable: isHittable(action), disabled: action.disabled } : null,
      };
    });
    return {
      schema: "pucky.settings_quiet_list_browser_proof.v1",
      location: window.location.href,
      viewport: {
        width: window.innerWidth,
        height: window.innerHeight,
      },
      cards,
      visibleText: document.body.textContent.trim().replace(/\s+/g, " "),
    };
  });
}

function assertSettingsQuietList(metrics) {
  assert(metrics.cards.length >= 10, `Expected Settings rows, found ${metrics.cards.length}`);
  const byId = Object.fromEntries(metrics.cards.map((card) => [card.id, card]));
  assert(byId.advanced, "Advanced row is missing data-setting-id=advanced");
  assert(byId.advanced.rect.bottom <= VIEWPORT.height, `Advanced row is not visible in first viewport: bottom ${byId.advanced.rect.bottom}`);

  const expectedDetails = [
    "Theme for Pucky.",
    "Device bridge required.",
    "How replies play back.",
    "Listen on this device.",
    "Sound after send.",
    "Default for new sessions.",
    "Reasoning for new sessions.",
    "Unlock live browser data.",
    "Read-only in web preview.",
    "Bundle, surface, bridge.",
  ];
  for (const detail of expectedDetails) {
    assert(metrics.visibleText.includes(detail), `Missing short Settings copy: ${detail}`);
  }
  for (const stale of [
    "Switch between dark and light.",
    "Connect the Android bridge",
    "Choose if replies stay as cards",
    "Store a browser token in this browser",
    "Web preview is read-only for phone-role state",
  ]) {
    assert(!metrics.visibleText.includes(stale), `Stale verbose Settings copy is still visible: ${stale}`);
  }

  for (const card of metrics.cards) {
    assert(card.rect.height <= MAX_ANY_ROW_HEIGHT, `${card.title} row is too tall: ${card.rect.height}px`);
    if (!card.action) {
      assert(card.rect.height <= MAX_NORMAL_ROW_HEIGHT, `${card.title} normal row is too tall: ${card.rect.height}px`);
    }
    assert(card.style.boxShadow === "none", `${card.title} still has card shadow ${card.style.boxShadow}`);
    assert(card.style.borderTopWidth === "0px", `${card.title} has top border`);
    assert(card.style.borderRightWidth === "0px", `${card.title} has right border`);
    assert(card.style.borderLeftWidth === "0px", `${card.title} has left border`);
    assert(card.style.backgroundColor === "rgba(0, 0, 0, 0)", `${card.title} is not flat/transparent`);
    assert(card.style.borderRadius === "0px", `${card.title} row radius is too card-like: ${card.style.borderRadius}`);
    if (card.selector) {
      assert(card.selector.rect.height >= 28, `${card.title} selector is too small`);
      assert(card.selector.hittable && !card.selector.disabled, `${card.title} selector is not hittable`);
    }
    if (card.toggle) {
      assert(card.toggle.rect.height >= 28, `${card.title} toggle is too small`);
      assert(card.toggle.hittable && !card.toggle.disabled, `${card.title} toggle is not hittable`);
    }
    if (card.action) {
      assert(card.action.rect.height >= 28, `${card.title} action is too small`);
      assert(card.action.hittable && !card.action.disabled, `${card.title} action is not hittable`);
    }
  }
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
    await page.waitForSelector('.light-settings-real [data-setting-id="advanced"]', { timeout: config.timeoutMs });
    await page.waitForLoadState("networkidle", { timeout: config.timeoutMs }).catch(() => {});
    const metrics = await collectSettingsMetrics(page);
    assertSettingsQuietList(metrics);
    const screenshot = await saveScreenshot(page, config.reportDir, "settings-quiet-list");
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
    const screenshot = await saveScreenshot(page, config.reportDir, "settings-quiet-list-failure").catch(() => "");
    writeAutomationError(config.reportDir, error);
    writeJsonFile(path.join(config.reportDir, "summary.json"), {
      schema: "pucky.settings_quiet_list_browser_proof.v1",
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
