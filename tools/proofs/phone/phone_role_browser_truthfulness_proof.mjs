import fs from "node:fs";
import http from "node:http";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  attachPageLogging,
  ensureDir,
  resolveChromePath,
  saveScreenshot,
  writeAutomationError,
  writeJsonFile
} from "../../support/cover_shared.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../..");
const uiRoot = path.join(repoRoot, "pucky_vm", "ui_src");
const bundledNodeModules = process.env.CODEX_NODE_MODULES
  || "C:\\Users\\jimmy\\.cache\\codex-runtimes\\codex-primary-runtime\\dependencies\\node\\node_modules";
const require = createRequire(import.meta.url);
const { chromium } = (() => {
  try {
    return require("playwright-core");
  } catch (_) {
    return require(path.join(bundledNodeModules, "playwright-core"));
  }
})();
const reportDir = path.join(repoRoot, ".tmp", "phone-role-browser-truthfulness");
const summaryPath = path.join(reportDir, "summary.json");
const consoleLogPath = path.join(reportDir, "console.log");
const automationErrorPath = path.join(reportDir, "automation-error.txt");

const mimeTypes = new Map([
  [".html", "text/html; charset=utf-8"],
  [".js", "application/javascript; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".svg", "image/svg+xml"],
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".webp", "image/webp"]
]);

function sendJson(response, statusCode, payload) {
  const body = Buffer.from(JSON.stringify(payload, null, 2), "utf8");
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": String(body.length),
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "*"
  });
  response.end(body);
}

function sendFile(response, filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const contentType = mimeTypes.get(ext) || "application/octet-stream";
  const body = fs.readFileSync(filePath);
  response.writeHead(200, {
    "Content-Type": contentType,
    "Content-Length": String(body.length),
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "*"
  });
  response.end(body);
}

function createServer() {
  return http.createServer((request, response) => {
    const url = new URL(request.url || "/", "http://127.0.0.1");
    if (url.pathname === "/pucky-config.js") {
      const body = Buffer.from("window.PUCKY_CONFIG = {};\n", "utf8");
      response.writeHead(200, {
        "Content-Type": "application/javascript; charset=utf-8",
        "Content-Length": String(body.length),
        "Cache-Control": "no-store",
        "Access-Control-Allow-Origin": "*"
      });
      response.end(body);
      return;
    }
    if (url.pathname === "/favicon.ico") {
      response.writeHead(204, { "Access-Control-Allow-Origin": "*" });
      response.end();
      return;
    }
    const relativePath = url.pathname === "/" ? "/index.html" : url.pathname;
    const candidate = path.resolve(uiRoot, `.${relativePath}`);
    if (!candidate.startsWith(uiRoot) || !fs.existsSync(candidate) || fs.statSync(candidate).isDirectory()) {
      response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("not found");
      return;
    }
    sendFile(response, candidate);
  });
}

async function textContent(page, selector) {
  const value = await page.locator(selector).textContent();
  return String(value || "").trim();
}

async function cardSnapshot(page) {
  return {
    title: await textContent(page, '[data-setting-id="phone-role"] .settings-card-title'),
    detail: await textContent(page, '[data-setting-id="phone-role"] .settings-card-detail'),
    value: await textContent(page, '[data-setting-id="phone-role"] .settings-selector-button-label'),
    actionCount: await page.locator('[data-setting-id="phone-role"] .settings-action-button').count()
  };
}

async function run() {
  ensureDir(reportDir);
  fs.writeFileSync(consoleLogPath, "", "utf8");
  if (fs.existsSync(automationErrorPath)) {
    fs.unlinkSync(automationErrorPath);
  }
  const chromePath = resolveChromePath();
  const server = createServer();

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  const browser = await chromium.launch({
    headless: true,
    executablePath: chromePath,
    args: ["--disable-extensions"]
  });
  const context = await browser.newContext({ viewport: { width: 430, height: 932 } });
  const page = await context.newPage();
  attachPageLogging(page, consoleLogPath);

  const summary = {
    schema: "pucky.phone_role_browser_truthfulness_proof.v1",
    base_url: baseUrl,
    chrome_path: chromePath,
    screenshots: {}
  };
  try {
    await page.goto(`${baseUrl}/index.html?route=settings`, { waitUntil: "load", timeout: 30000 });
    await page.waitForSelector('[data-setting-id="phone-role"]');
    await page.waitForFunction(() => {
      const detail = document.querySelector('[data-setting-id="phone-role"] .settings-card-detail');
      return Boolean(
        detail
        && detail.textContent
        && /Hosted web keeps phone-role state read-only\./.test(detail.textContent)
      );
    });
    summary.preview_unavailable = await cardSnapshot(page);
    summary.preview_unavailable.no_fake_google = !(await page.content()).includes("Phone by Google");
    summary.screenshots.preview_unavailable = await saveScreenshot(page, reportDir, "01-preview-unavailable");

    if (summary.preview_unavailable.value !== "Preview") {
      throw new Error(`expected preview value label to be Preview, got ${summary.preview_unavailable.value}`);
    }
    if (summary.preview_unavailable.actionCount !== 0) {
      throw new Error(`expected preview mode to hide actions, got ${summary.preview_unavailable.actionCount}`);
    }
    if (!summary.preview_unavailable.no_fake_google) {
      throw new Error("preview mode still rendered fake Google Dialer copy");
    }

    writeJsonFile(summaryPath, summary);
  } catch (error) {
    writeAutomationError(reportDir, error);
    throw error;
  } finally {
    await browser.close();
    await new Promise((resolve, reject) => server.close((closeError) => (closeError ? reject(closeError) : resolve())));
  }
}

run().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exitCode = 1;
});
