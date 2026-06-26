import fs from "node:fs";
import path from "node:path";

export const BROWSER_PREVIEW_TOKEN_KEY = "pucky.cover.browser_api_token.v1";
export const DEFAULT_OTP_CODE = "424242";

export function ensureDir(target) {
  fs.mkdirSync(target, { recursive: true });
}

export function timestampSlug() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

export function writeJsonFile(targetPath, payload) {
  ensureDir(path.dirname(targetPath));
  fs.writeFileSync(targetPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

export function readJsonFile(targetPath) {
  return JSON.parse(fs.readFileSync(targetPath, "utf8"));
}

export function redacted(value, { leading = 2, trailing = 2 } = {}) {
  const text = String(value || "").trim();
  if (!text) {
    return "";
  }
  if (text.length <= leading + trailing) {
    return `${text.slice(0, 1)}***`;
  }
  return `${text.slice(0, leading)}***${text.slice(-trailing)}`;
}

export function maskEmail(email) {
  const text = String(email || "").trim();
  if (!text || !text.includes("@")) {
    return redacted(text, { leading: 1, trailing: 1 });
  }
  const [local, domain] = text.split("@", 2);
  const domainParts = domain.split(".");
  const domainName = domainParts.shift() || "";
  const domainSuffix = domainParts.join(".");
  return `${redacted(local, { leading: 1, trailing: 0 })}@${redacted(domainName, { leading: 1, trailing: 0 })}${domainSuffix ? `.${domainSuffix}` : ""}`;
}

export function requireValue(value, label) {
  const text = String(value || "").trim();
  if (!text) {
    throw new Error(`Missing required value: ${label}`);
  }
  return text;
}

export function parseJson(value, fallback = {}) {
  const text = String(value || "").trim();
  if (!text) {
    return fallback;
  }
  return JSON.parse(text);
}

export function splitCsv(value) {
  return String(value || "")
    .split(",")
    .map(item => String(item || "").trim())
    .filter(Boolean);
}

export async function primeBrowserPreviewToken(context, token) {
  const clean = String(token || "").trim();
  await context.addInitScript(({ storageKey, browserToken }) => {
    try {
      localStorage.removeItem("pucky.cover.nav_state.v1");
      if (browserToken) {
        localStorage.setItem(storageKey, browserToken);
      } else {
        localStorage.removeItem(storageKey);
      }
    } catch (_error) {
      // Best effort only.
    }
  }, {
    storageKey: BROWSER_PREVIEW_TOKEN_KEY,
    browserToken: clean,
  });
}

export async function maybeClickOneOf(page, labels, timeoutMs = 2500) {
  for (const label of labels) {
    const button = page.getByRole("button", { name: label }).first();
    if (await button.isVisible({ timeout: timeoutMs }).catch(() => false)) {
      await button.click();
      return label;
    }
    const link = page.getByRole("link", { name: label }).first();
    if (await link.isVisible({ timeout: timeoutMs }).catch(() => false)) {
      await link.click();
      return label;
    }
  }
  return "";
}

async function firstVisibleLocator(page, selectors, timeoutMs = 15000) {
  const deadline = Date.now() + Math.max(1000, timeoutMs);
  while (Date.now() < deadline) {
    for (const selector of selectors) {
      const locator = page.locator(selector).first();
      if (await locator.isVisible({ timeout: 250 }).catch(() => false)) {
        return { selector, locator };
      }
    }
    await page.waitForTimeout(150);
  }
  throw new Error(`Could not find a visible input matching selectors: ${selectors.join(", ")}`);
}

export async function fillEmailAddress(page, email, timeoutMs = 20000) {
  const { selector, locator } = await firstVisibleLocator(page, [
    'input[type="email"]',
    'input[name*="email" i]',
    'input[autocomplete="email"]',
    'input[placeholder*="email" i]',
    'input[id*="email" i]',
  ], timeoutMs);
  await locator.fill(String(email || "").trim());
  return selector;
}

export async function waitForOtpInput(page, timeoutMs = 20000) {
  return firstVisibleLocator(page, [
    'input[autocomplete="one-time-code"]',
    'input[inputmode="numeric"]',
    'input[name*="code" i]',
    'input[id*="code" i]',
    'input[placeholder*="code" i]',
  ], timeoutMs);
}

export async function fillOtpCode(page, code, timeoutMs = 20000) {
  const clean = String(code || "").trim();
  if (!clean) {
    throw new Error("OTP code is required");
  }
  const { locator } = await waitForOtpInput(page, timeoutMs);
  const allInputs = page.locator('input[autocomplete="one-time-code"], input[inputmode="numeric"], input[name*="code" i], input[id*="code" i]');
  const count = await allInputs.count().catch(() => 0);
  if (count >= clean.length && count > 1) {
    const chars = clean.split("");
    let singleCharFields = 0;
    for (let index = 0; index < count; index += 1) {
      const field = allInputs.nth(index);
      const maxLength = await field.getAttribute("maxlength").catch(() => "");
      if (String(maxLength || "").trim() === "1") {
        singleCharFields += 1;
      }
    }
    if (singleCharFields >= clean.length) {
      for (let index = 0; index < clean.length; index += 1) {
        await allInputs.nth(index).fill(chars[index]);
      }
      return "multi_input";
    }
  }
  await locator.fill(clean);
  return "single_input";
}

export async function performOtpLogin(page, { loginUrl, email, otpCode, timeoutMs, otpButtonLabels = [] }) {
  const steps = [];
  await page.goto(String(loginUrl || ""), { waitUntil: "domcontentloaded", timeout: timeoutMs });
  steps.push({ action: "goto_login", url: page.url() });
  const emailSelector = await fillEmailAddress(page, email, timeoutMs);
  steps.push({ action: "fill_email", selector: emailSelector });
  const submitLabel = await maybeClickOneOf(page, [
    "Continue",
    "Send code",
    "Send Code",
    "Sign in",
    "Sign up",
    "Create account",
  ], 2500);
  if (submitLabel) {
    steps.push({ action: "submit_email", label: submitLabel });
  }
  await waitForOtpInput(page, timeoutMs);
  steps.push({ action: "otp_ready" });
  const otpMode = await fillOtpCode(page, otpCode, timeoutMs);
  steps.push({ action: "fill_otp", mode: otpMode });
  const verifyLabel = await maybeClickOneOf(page, [
    ...otpButtonLabels,
    "Continue",
    "Verify",
    "Verify code",
    "Sign in",
    "Submit",
  ], 2500);
  if (verifyLabel) {
    steps.push({ action: "submit_otp", label: verifyLabel });
  }
  return steps;
}

export async function waitForWorkspaceReady(page, {
  timeoutMs,
  workspaceHostPattern = "",
  readySelector = ".light-shell, .app-shell, [data-light-route]",
  loginUrl = "",
}) {
  const started = Date.now();
  const hostPattern = String(workspaceHostPattern || "").trim();
  const loginOrigin = safeOrigin(loginUrl);
  while (Date.now() - started < timeoutMs) {
    const currentUrl = page.url();
    const currentOrigin = safeOrigin(currentUrl);
    if (hostPattern) {
      try {
        if (new RegExp(hostPattern).test(new URL(currentUrl).host)) {
          return { url: currentUrl, readyBy: "host_pattern" };
        }
      } catch (_error) {
        // Continue to other readiness checks.
      }
    }
    if (readySelector) {
      const ready = await page.locator(readySelector).first().isVisible({ timeout: 250 }).catch(() => false);
      if (ready && (!loginOrigin || currentOrigin !== loginOrigin)) {
        return { url: currentUrl, readyBy: "selector" };
      }
    }
    await page.waitForTimeout(200);
  }
  throw new Error(`Workspace never became ready after login. Last URL: ${page.url()}`);
}

export function safeOrigin(value) {
  try {
    return new URL(String(value || "")).origin;
  } catch (_error) {
    return "";
  }
}

export async function pageApiJson(page, targetUrl, options = {}) {
  return page.evaluate(async ({ url, method, body, headers }) => {
    const response = await fetch(url, {
      method,
      credentials: "include",
      cache: "no-store",
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await response.text();
    let payload = {};
    try {
      payload = text ? JSON.parse(text) : {};
    } catch (_error) {
      payload = { raw_text: text };
    }
    return {
      ok: response.ok,
      status: response.status,
      url,
      payload,
    };
  }, {
    url: String(targetUrl || ""),
    method: String(options.method || "GET").toUpperCase(),
    body: options.body === undefined ? null : options.body,
    headers: {
      Accept: "application/json",
      ...(options.body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(options.headers || {}),
    },
  });
}

export async function pageApiMultipartJson(page, targetUrl, options = {}) {
  return page.evaluate(async ({ url, method, fields, files, headers }) => {
    const form = new FormData();
    for (const [key, value] of Object.entries(fields || {})) {
      form.append(key, value == null ? "" : String(value));
    }
    for (const file of Array.isArray(files) ? files : []) {
      const fieldName = String(file?.fieldName || "files").trim() || "files";
      const fileName = String(file?.fileName || "attachment.txt").trim() || "attachment.txt";
      const contentType = String(file?.contentType || "application/octet-stream").trim() || "application/octet-stream";
      let blob = null;
      if (typeof file?.text === "string") {
        blob = new Blob([file.text], { type: contentType });
      } else {
        const base64 = String(file?.base64 || "").trim();
        const bytes = Uint8Array.from(atob(base64), char => char.charCodeAt(0));
        blob = new Blob([bytes], { type: contentType });
      }
      form.append(fieldName, blob, fileName);
    }
    const response = await fetch(url, {
      method,
      credentials: "include",
      cache: "no-store",
      headers,
      body: form,
    });
    const text = await response.text();
    let payload = {};
    try {
      payload = text ? JSON.parse(text) : {};
    } catch (_error) {
      payload = { raw_text: text };
    }
    return {
      ok: response.ok,
      status: response.status,
      url,
      payload,
    };
  }, {
    url: String(targetUrl || ""),
    method: String(options.method || "POST").toUpperCase(),
    fields: options.fields || {},
    files: Array.isArray(options.files) ? options.files : [],
    headers: {
      Accept: "application/json",
      ...(options.headers || {}),
    },
  });
}

export async function pageFetchMeta(page, targetUrl, options = {}) {
  return page.evaluate(async ({ url, method, body, headers, expectJson }) => {
    const response = await fetch(url, {
      method,
      credentials: "include",
      cache: "no-store",
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
    const contentType = String(response.headers.get("content-type") || "").trim();
    const byteLength = Number(response.headers.get("content-length") || "0") || 0;
    const text = await response.text();
    let json = null;
    if (expectJson || /json/i.test(contentType)) {
      try {
        json = text ? JSON.parse(text) : {};
      } catch (_error) {
        json = null;
      }
    }
    return {
      ok: response.ok,
      status: response.status,
      url,
      contentType,
      byteLength: byteLength || text.length,
      textSnippet: String(text || "").slice(0, 4000),
      json,
    };
  }, {
    url: String(targetUrl || ""),
    method: String(options.method || "GET").toUpperCase(),
    body: options.body === undefined ? null : options.body,
    headers: {
      Accept: "*/*",
      ...(options.body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(options.headers || {}),
    },
    expectJson: Boolean(options.expectJson),
  });
}

export function interpolateJsonTemplate(template, values) {
  const source = JSON.stringify(template);
  const rendered = source.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_match, key) => {
    return JSON.stringify(values[key] ?? "");
  });
  return JSON.parse(rendered);
}

export async function captureBodyText(page) {
  try {
    return String(await page.locator("body").innerText({ timeout: 5000 }) || "").replace(/\s+/g, " ").trim();
  } catch (_error) {
    return "";
  }
}
