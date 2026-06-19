import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright-core";
import {
  attachPageLogging,
  ensureDir,
  resolveChromePath,
  saveScreenshot,
  writeAutomationError,
  writeJsonFile
} from "./cover_shared.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const uiRoot = path.join(repoRoot, "pucky_vm", "ui_src");
const DEFAULT_REPORT_ROOT = path.join(repoRoot, ".tmp", "browser-first-ui-probe");
const VIEWPORT = { width: 620, height: 698 };

function parseArgs(argv) {
  const config = {
    reportDir: "",
    port: 18765
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--report-dir") {
      config.reportDir = String(argv[++index] || "");
    } else if (arg === "--port") {
      config.port = Number(argv[++index] || config.port) || config.port;
    }
  }
  if (!config.reportDir) {
    config.reportDir = path.join(DEFAULT_REPORT_ROOT, new Date().toISOString().replace(/[:.]/g, "-"));
  }
  return config;
}

function contentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".html") return "text/html; charset=utf-8";
  if (ext === ".js") return "application/javascript; charset=utf-8";
  if (ext === ".css") return "text/css; charset=utf-8";
  if (ext === ".json") return "application/json; charset=utf-8";
  if (ext === ".svg") return "image/svg+xml";
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  return "application/octet-stream";
}

function startStaticServer(port) {
  const server = http.createServer((request, response) => {
    const url = new URL(request.url || "/", `http://127.0.0.1:${port}`);
    let relativePath = decodeURIComponent(url.pathname.replace(/^\/+/, "")) || "index.html";
    if (relativePath.endsWith("/")) {
      relativePath += "index.html";
    }
    const target = path.resolve(uiRoot, relativePath);
    if (target !== uiRoot && !target.startsWith(`${uiRoot}${path.sep}`)) {
      response.writeHead(403).end("forbidden");
      return;
    }
    if (!fs.existsSync(target) || !fs.statSync(target).isFile()) {
      response.writeHead(404).end("not found");
      return;
    }
    response.writeHead(200, { "Content-Type": contentType(target) });
    fs.createReadStream(target).pipe(response);
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve(server));
  });
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function clickTab(page, label) {
  await page.getByRole("button", { name: label }).click();
}

async function visibleHomeTitles(page) {
  return page.locator("#feed article.card h2.title").evaluateAll(nodes =>
    nodes.map(node => String(node.textContent || "").trim()).filter(Boolean)
  );
}

async function main() {
  const config = parseArgs(process.argv.slice(2));
  ensureDir(config.reportDir);

  const server = await startStaticServer(config.port);
  const pageUrl = `http://127.0.0.1:${config.port}/index.html?route=inbox&reset_nav=1`;
  const feedItems = [
    {
      card_id: "vm-card-alpha",
      session_id: "vm-card-alpha",
      icon: "book",
      title: "Live VM Alpha",
      summary: "Rendered from /api/feed, not from bundled fake cards.",
      created_at: "2026-06-05T12:00:00Z",
      archived: false,
      read: false
    },
    {
      card_id: "vm-card-beta",
      session_id: "vm-card-beta",
      icon: "mic",
      title: "Live VM Beta",
      summary: "Second card keeps scroll behavior honest.",
      created_at: "2026-06-05T12:01:00Z",
      archived: false,
      read: false
    }
  ];
  const meetings = [
    {
      meeting_id: "meeting-browser-proof",
      state: "completed",
      title: "Browser Proof Meeting",
      started_at: "2026-06-05T12:02:00Z",
      stopped_at: "2026-06-05T12:03:00Z",
      duration_ms: 60000,
      transcript_status: "completed",
      archived: false
    }
  ];
  const networkLog = [];
  const summary = {
    page_url: pageUrl,
    report_dir: config.reportDir,
    screenshots: {}
  };

  let browser;
  try {
    browser = await chromium.launch({ headless: true, executablePath: resolveChromePath() });
    const context = await browser.newContext({ viewport: VIEWPORT });
    await context.route("**/api/feed**", async route => {
      networkLog.push({ url: route.request().url(), method: route.request().method() });
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ schema: "pucky.feed.v1", ok: true, count: feedItems.length, items: feedItems })
      });
    });
    await context.route("**/api/meetings?**", async route => {
      networkLog.push({ url: route.request().url(), method: route.request().method() });
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ schema: "pucky.meetings.v1", ok: true, compact: true, count: meetings.length, meetings })
      });
    });
    await context.route("**/api/links/composio/portal-url", async route => {
      networkLog.push({ url: route.request().url(), method: route.request().method() });
      await route.fulfill({
        status: 401,
        contentType: "application/json",
        body: JSON.stringify({ error: "unauthorized" })
      });
    });
    await context.route("**/ui/pucky/fixtures/reply_cards.json", async route => {
      networkLog.push({ url: route.request().url(), method: route.request().method(), forbidden: true });
      await route.abort();
    });

    const page = await context.newPage();
    const consoleLogPath = path.join(config.reportDir, "console.log");
    attachPageLogging(page, consoleLogPath);
    await page.goto(pageUrl, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => document.querySelectorAll("#feed article.card h2.title").length > 0, null, { timeout: 10000 });
    summary.home_titles = await visibleHomeTitles(page);
    summary.screenshots.home = await saveScreenshot(page, config.reportDir, "01-home");
    assert(summary.home_titles[0] === "Live VM Alpha", "Home did not render mocked /api/feed cards first");
    assert(!summary.home_titles.includes("Morning launch"), "Home rendered old fixture card title");

    await clickTab(page, "Meetings");
    await page.waitForFunction(() => document.body.textContent.includes("Browser Proof Meeting"), null, { timeout: 10000 });
    summary.meetings_text = await page.locator("#feed").innerText();
    summary.screenshots.meetings = await saveScreenshot(page, config.reportDir, "02-meetings");
    assert(!/unauthorized/i.test(summary.meetings_text), "Meetings displayed unauthorized in browser");

    await clickTab(page, "Links");
    await page.waitForFunction(() => document.querySelectorAll(".links-app-row").length > 20, null, { timeout: 10000 });
    await page.waitForTimeout(800);
    summary.links = await page.evaluate(() => {
      const rows = Array.from(document.querySelectorAll(".links-app-row")).slice(0, 8);
      const tops = rows.map(row => Math.round(row.getBoundingClientRect().top));
      return {
        row_count: document.querySelectorAll(".links-app-row").length,
        logo_count: document.querySelectorAll(".links-app-logo").length,
        fallback_count: document.querySelectorAll(".links-app-fallback").length,
        unauthorized_visible: /unauthorized/i.test(document.getElementById("feed")?.innerText || ""),
        row_tops: tops,
        distinct_row_tops: new Set(tops).size,
        first_logo_src: document.querySelector(".links-app-logo")?.getAttribute("src") || "",
        scroll_height: document.querySelector(".links-list-scrollport")?.scrollHeight || 0,
        client_height: document.querySelector(".links-list-scrollport")?.clientHeight || 0
      };
    });
    summary.screenshots.links = await saveScreenshot(page, config.reportDir, "03-links");
    assert(summary.links.logo_count > 20, "Links did not render static logo images");
    assert(summary.links.fallback_count === 0, "Links rendered initials fallback");
    assert(!summary.links.unauthorized_visible, "Links displayed unauthorized portal status in browser");
    assert(summary.links.distinct_row_tops >= 6, "Links rows are still stacked");
    assert(summary.links.scroll_height > summary.links.client_height, "Links list is not scrollable");
    assert(!/^https?:\/\//i.test(summary.links.first_logo_src), "Links logo src is remote instead of bundle-local");

    summary.network = {
      feed_requests: networkLog.filter(item => item.url.includes("/api/feed")).length,
      meetings_requests: networkLog.filter(item => item.url.includes("/api/meetings")).length,
      fixture_requests: networkLog.filter(item => item.url.includes("/ui/pucky/fixtures/reply_cards.json")).length,
      portal_requests: networkLog.filter(item => item.url.includes("/api/links/composio/portal-url")).length,
      all: networkLog
    };
    assert(summary.network.feed_requests >= 1, "No /api/feed request observed");
    assert(summary.network.meetings_requests >= 1, "No /api/meetings request observed");
    assert(summary.network.fixture_requests === 0, "Fixture feed request observed");
    summary.console_log = consoleLogPath;
    await writeJsonFile(path.join(config.reportDir, "summary.json"), summary);
    console.log(JSON.stringify(summary, null, 2));
  } catch (error) {
    await writeAutomationError(config.reportDir, error);
    throw error;
  } finally {
    if (browser) {
      await browser.close();
    }
    await new Promise(resolve => server.close(resolve));
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
