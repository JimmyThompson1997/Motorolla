import path from "node:path";
import { execFileSync } from "node:child_process";
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
import {
  apiRequest,
  cleanupTaskProofSeed,
  seedTaskProofWorkspace,
  waitForRoute,
} from "../../support/task_workspace_proof_shared.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const RESULT_SCHEMA = "pucky.contact_detail_classic_edit_browser_proof.v1";
const DEFAULT_LOCAL_BASE_URL = "http://127.0.0.1:8767";
const DEFAULT_LIVE_BASE_URL = "https://pucky.fly.dev";
const VIEWPORTS = Object.freeze({
  desktop: { width: 1440, height: 900, isMobile: false, hasTouch: false, deviceScaleFactor: 1.5 },
  iphone: { width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 3 },
  android: { width: 412, height: 915, isMobile: true, hasTouch: true, deviceScaleFactor: 2.625 },
});

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function timestampSlug() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function resolveApiToken() {
  const candidates = [
    process.env.PUCKY_WEB_UI_TOKEN,
    process.env.PUCKY_WORKSPACE_PROOF_TOKEN,
    process.env.PUCKY_LIVE_USER_SESSION_TOKEN,
    process.env.PUCKY_OPERATOR_TOKEN,
    process.env.PUCKY_API_TOKEN,
  ];
  for (const candidate of candidates) {
    const token = String(candidate || "").trim();
    if (token) {
      return token;
    }
  }
  return "proof-token";
}

function parseArgs(argv) {
  const config = {
    baseUrl: DEFAULT_LOCAL_BASE_URL,
    apiToken: resolveApiToken(),
    timeoutMs: 30000,
    reportDir: path.resolve(".tmp", "contact-detail-classic-edit-proof", timestampSlug()),
    runId: `contact-detail-classic-edit-${Date.now()}`,
    refreshKey: "",
    requiredCommit: "",
    keepSeed: false,
    live: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = String(argv[index] || "");
    if (arg === "--base-url" && argv[index + 1]) {
      config.baseUrl = String(argv[++index] || config.baseUrl).replace(/\/+$/, "");
    } else if (arg === "--api-token" && argv[index + 1]) {
      config.apiToken = String(argv[++index] || config.apiToken).trim();
    } else if (arg === "--timeout-ms" && argv[index + 1]) {
      config.timeoutMs = Math.max(1000, Number(argv[++index] || config.timeoutMs) || config.timeoutMs);
    } else if (arg === "--report-dir" && argv[index + 1]) {
      config.reportDir = path.resolve(String(argv[++index] || config.reportDir));
    } else if (arg === "--run-id" && argv[index + 1]) {
      config.runId = String(argv[++index] || config.runId).trim();
    } else if (arg === "--refresh-key" && argv[index + 1]) {
      config.refreshKey = String(argv[++index] || "").trim();
    } else if (arg === "--required-commit" && argv[index + 1]) {
      config.requiredCommit = String(argv[++index] || "").trim();
    } else if (arg === "--keep-seed") {
      config.keepSeed = true;
    } else if (arg === "--live") {
      config.live = true;
    }
  }
  if (config.live && config.baseUrl === DEFAULT_LOCAL_BASE_URL) {
    config.baseUrl = DEFAULT_LIVE_BASE_URL;
  }
  if (!config.refreshKey) {
    config.refreshKey = config.requiredCommit || currentGitHeadShort() || String(Date.now());
  }
  return config;
}

function currentGitHeadShort() {
  try {
    return execFileSync("git", ["rev-parse", "--short", "HEAD"], {
      cwd: ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch (_error) {
    return "";
  }
}

async function fetchManifest(baseUrl, refreshKey) {
  const url = new URL("/ui/pucky/latest/manifest.json", `${String(baseUrl || "").replace(/\/+$/, "")}/`);
  if (String(refreshKey || "").trim()) {
    url.searchParams.set("_pucky_refresh", String(refreshKey || "").trim());
  }
  const response = await fetch(url, {
    headers: {
      "Cache-Control": "no-cache, no-store, max-age=0",
      Pragma: "no-cache",
    },
  });
  if (!response.ok) {
    throw new Error(`Could not load manifest from ${url.toString()} (${response.status})`);
  }
  return {
    manifestUrl: url.toString(),
    payload: await response.json(),
  };
}

function commitMatches(requiredCommit, uiVersion) {
  const required = String(requiredCommit || "").trim();
  const actual = String(uiVersion || "").trim();
  return !required || (Boolean(actual) && actual.startsWith(required));
}

function buildContactsUrl(config, theme = "light") {
  const url = new URL("/ui/pucky/latest/index.html", `${String(config.baseUrl || "").replace(/\/+$/, "")}/`);
  url.searchParams.set("theme", theme);
  url.searchParams.set("route", "contacts");
  url.searchParams.set("reset_nav", "1");
  if (String(config.apiToken || "").trim()) {
    url.searchParams.set("api_token", String(config.apiToken || "").trim());
  }
  if (String(config.refreshKey || "").trim()) {
    url.searchParams.set("_pucky_refresh", String(config.refreshKey || "").trim());
  }
  return url.toString();
}

function laneExpectations(laneName) {
  const titleToken = laneName === "desktop" ? "Desktop" : laneName === "iphone" ? "Iphone" : "Android";
  return {
    firstName: "Taylor",
    lastName: titleToken,
    description: `Edited in ${laneName} contact proof.`,
    email: `edited.${laneName}@example.com`,
    phone: laneName === "desktop" ? "+1 (415) 555-0181" : laneName === "iphone" ? "+1 (415) 555-0182" : "+1 (415) 555-0183",
    title: `Taylor ${titleToken}`,
    initials: `T${titleToken.charAt(0).toUpperCase()}`,
  };
}

async function resetProofContact(config, seed, laneName) {
  await apiRequest(config.baseUrl, config.apiToken, "PATCH", `/api/workspace/contacts/${encodeURIComponent(seed.contactId)}`, {
    summary: `Baseline summary for ${laneName}.`,
    metadata: {
      first_name: "Proof",
      last_name: "Baseline",
      display_name: "Proof Baseline",
      email: `baseline.${laneName}@example.com`,
      phone: "+1 (415) 555-0160",
      photo: "",
      activity: ["Linked to live alpha"],
    },
  });
}

async function fetchContactRecord(config, contactId) {
  return apiRequest(config.baseUrl, config.apiToken, "GET", `/api/workspace/contacts/${encodeURIComponent(contactId)}`);
}

async function waitForContactDetail(page, contactId, timeoutMs) {
  await page.waitForFunction(
    expectedId => document.querySelector(".light-shell")?.getAttribute("data-light-route") === "contact-detail"
      && document.querySelector(".light-page[data-contact-detail-id]")?.getAttribute("data-contact-detail-id") === expectedId,
    contactId,
    { timeout: timeoutMs },
  );
}

async function waitForSaveState(page, expectedState, timeoutMs) {
  await page.waitForFunction(
    expected => document.querySelector(".light-contact-detail-save-status")?.getAttribute("data-contact-save-state") === expected,
    expectedState,
    { timeout: timeoutMs },
  );
}

async function waitForSaved(page, timeoutMs) {
  await page.waitForFunction(() => {
    const node = document.querySelector(".light-contact-detail-save-status");
    return node && node.getAttribute("data-contact-save-state") === "saved" && String(node.textContent || "").includes("Saved");
  }, undefined, { timeout: timeoutMs });
}

async function installTypingTrace(page, label) {
  return page.evaluate((ariaLabel) => {
    const input = Array.from(document.querySelectorAll("input, textarea")).find((node) => node.getAttribute("aria-label") === ariaLabel);
    if (!(input instanceof HTMLInputElement) && !(input instanceof HTMLTextAreaElement)) {
      throw new Error(`Could not find input ${ariaLabel}`);
    }
    if (window.__contactDetailTypingTrace && typeof window.__contactDetailTypingTrace.cleanup === "function") {
      window.__contactDetailTypingTrace.cleanup();
    }
    const token = input.dataset.proofInputToken || `proof-token-${Math.random().toString(16).slice(2)}`;
    input.dataset.proofInputToken = token;
    const trace = {
      label: ariaLabel,
      initialToken: token,
      finalToken: token,
      blur: 0,
      focusout: 0,
      inputEvents: 0,
      values: [input.value],
      cleanup: null,
    };
    const onBlur = () => {
      trace.blur += 1;
    };
    const onFocusOut = () => {
      trace.focusout += 1;
    };
    const onInput = () => {
      trace.inputEvents += 1;
      trace.values.push(input.value);
      trace.finalToken = input.dataset.proofInputToken || "";
    };
    input.addEventListener("blur", onBlur);
    input.addEventListener("focusout", onFocusOut);
    input.addEventListener("input", onInput);
    trace.cleanup = () => {
      input.removeEventListener("blur", onBlur);
      input.removeEventListener("focusout", onFocusOut);
      input.removeEventListener("input", onInput);
    };
    window.__contactDetailTypingTrace = trace;
    return {
      initialToken: token,
      startingValue: input.value,
    };
  }, label);
}

async function readTypingTrace(page, label) {
  return page.evaluate((ariaLabel) => {
    const input = Array.from(document.querySelectorAll("input, textarea")).find((node) => node.getAttribute("aria-label") === ariaLabel);
    const trace = window.__contactDetailTypingTrace || {};
    return {
      label: ariaLabel,
      initialToken: String(trace.initialToken || ""),
      finalToken: String(trace.finalToken || ""),
      currentToken: String(input?.dataset?.proofInputToken || ""),
      currentValue: String(input?.value || ""),
      blur: Number(trace.blur || 0),
      focusout: Number(trace.focusout || 0),
      inputEvents: Number(trace.inputEvents || 0),
      values: Array.isArray(trace.values) ? trace.values.slice() : [],
    };
  }, label);
}

async function clearTypingTrace(page) {
  await page.evaluate(() => {
    if (window.__contactDetailTypingTrace && typeof window.__contactDetailTypingTrace.cleanup === "function") {
      window.__contactDetailTypingTrace.cleanup();
    }
    delete window.__contactDetailTypingTrace;
  });
}

function selectAllShortcut() {
  return process.platform === "darwin" ? "Meta+A" : "Control+A";
}

async function typeFieldWithTrace(page, label, value) {
  const field = page.locator(`input[aria-label="${label}"], textarea[aria-label="${label}"]`).first();
  await field.waitFor({ state: "visible" });
  await field.click();
  await field.press(selectAllShortcut());
  await field.press("Backspace");
  await installTypingTrace(page, label);
  await page.keyboard.type(value, { delay: 35 });
  await page.waitForTimeout(60);
  const trace = await readTypingTrace(page, label);
  await clearTypingTrace(page);
  assert(trace.blur === 0, `${label}: expected zero blur events while typing, saw ${trace.blur}`);
  assert(trace.focusout === 0, `${label}: expected zero focusout events while typing, saw ${trace.focusout}`);
  assert(trace.initialToken && trace.currentToken === trace.initialToken, `${label}: input node was replaced during typing`);
  assert(trace.currentValue === value, `${label}: expected value ${value}, saw ${trace.currentValue}`);
  return trace;
}

async function fillField(page, label, value, timeoutMs) {
  const field = page.locator(`input[aria-label="${label}"], textarea[aria-label="${label}"]`).first();
  await field.waitFor({ state: "visible", timeout: timeoutMs });
  await field.click();
  await field.press(selectAllShortcut()).catch(() => {});
  await field.fill(value);
}

async function assertActivityReadOnly(page) {
  const section = page.locator(".light-info-section").filter({
    has: page.locator(".light-section-title", { hasText: "ACTIVITY" }),
  }).first();
  await section.waitFor({ state: "visible" });
  const editableCount = await section.locator("input, textarea, [contenteditable='true']").count();
  assert(editableCount === 0, `Activity section should stay read-only, saw ${editableCount} editable controls`);
}

async function openProofContactFromList(page, seed, timeoutMs) {
  await waitForRoute(page, "contacts", timeoutMs);
  const row = page.locator(`button[data-contact-id="${seed.contactId}"]`).first();
  await row.waitFor({ state: "visible", timeout: timeoutMs });
  await row.click();
  await waitForContactDetail(page, seed.contactId, timeoutMs);
}

async function reloadContactsAndReopen(page, config, seed, laneName, timeoutMs) {
  await page.goto(buildContactsUrl(config), { waitUntil: "domcontentloaded", timeout: timeoutMs });
  await waitForRoute(page, "contacts", timeoutMs);
  await openProofContactFromList(page, seed, timeoutMs);
  await page.locator(".light-contact-detail-hero .light-avatar").first().waitFor({ state: "visible", timeout: timeoutMs });
  return {
    screenshot: await saveScreenshot(page, path.join(config.reportDir, laneName), `${laneName}-baseline-detail-reloaded`),
  };
}

async function proveLane(browser, config, seed, laneName, laneViewport) {
  const laneDir = path.join(config.reportDir, laneName);
  ensureDir(laneDir);
  await resetProofContact(config, seed, laneName);

  const context = await browser.newContext({
    viewport: { width: laneViewport.width, height: laneViewport.height },
    deviceScaleFactor: laneViewport.deviceScaleFactor,
    isMobile: laneViewport.isMobile,
    hasTouch: laneViewport.hasTouch,
  });
  const page = await context.newPage();
  attachPageLogging(page, path.join(laneDir, "console.log"));

  const expectations = laneExpectations(laneName);
  const screenshots = {};
  try {
    await page.goto(buildContactsUrl(config), { waitUntil: "domcontentloaded", timeout: config.timeoutMs });
    await waitForRoute(page, "contacts", config.timeoutMs);
    await openProofContactFromList(page, seed, config.timeoutMs);

    const initialHeroAvatar = page.locator(".light-contact-detail-hero .light-avatar").first();
    await initialHeroAvatar.waitFor({ state: "visible", timeout: config.timeoutMs });
    screenshots.baseline_detail = await saveScreenshot(page, laneDir, `${laneName}-baseline-detail`);

    assert(await page.getByRole("button", { name: "Edit contact" }).count() === 1, `${laneName}: expected edit button in view mode`);
    assert(await page.getByRole("button", { name: "Done editing" }).count() === 0, `${laneName}: done button should be hidden in view mode`);

    await page.getByRole("button", { name: "Edit contact" }).click();
    await waitForRoute(page, "contact-detail", config.timeoutMs);
    await page.getByRole("button", { name: "Done editing" }).waitFor({ state: "visible", timeout: config.timeoutMs });
    await assertActivityReadOnly(page);
    screenshots.edit_mode = await saveScreenshot(page, laneDir, `${laneName}-edit-mode`);

    const firstNameTrace = await typeFieldWithTrace(page, "First name", expectations.firstName);
    await fillField(page, "Last name", expectations.lastName, config.timeoutMs);
    await fillField(page, "Description", expectations.description, config.timeoutMs);
    await fillField(page, "Email", expectations.email, config.timeoutMs);
    await fillField(page, "Phone", expectations.phone, config.timeoutMs);
    await page.locator(".light-contact-detail-save-status").click();
    await waitForSaved(page, config.timeoutMs);
    screenshots.edited_fields = await saveScreenshot(page, laneDir, `${laneName}-edited-fields`);

    let record = await fetchContactRecord(config, seed.contactId);
    assert(record.title === expectations.title, `${laneName}: expected saved title ${expectations.title}, saw ${record.title}`);
    assert(record.summary === expectations.description, `${laneName}: expected saved description ${expectations.description}, saw ${record.summary}`);
    assert(record.metadata?.email === expectations.email, `${laneName}: expected saved email ${expectations.email}, saw ${record.metadata?.email}`);
    assert(record.metadata?.phone === expectations.phone, `${laneName}: expected saved phone ${expectations.phone}, saw ${record.metadata?.phone}`);

    const photoInput = page.locator(".light-contact-detail-photo-input").first();
    await photoInput.setInputFiles(path.join(ROOT, "pucky_vm", "ui_src", "fixtures", "contact_photos", "sam.webp"));
    await waitForSaveState(page, "saving", config.timeoutMs);
    await waitForSaved(page, config.timeoutMs);
    await page.locator(".light-contact-detail-hero .light-avatar.has-photo img").first().waitFor({ state: "visible", timeout: config.timeoutMs });
    await page.getByRole("button", { name: "Done editing" }).click();
    await page.getByRole("button", { name: "Edit contact" }).waitFor({ state: "visible", timeout: config.timeoutMs });

    await page.getByRole("button", { name: "Back" }).click();
    await waitForRoute(page, "contacts", config.timeoutMs);
    screenshots.updated_list_row = await saveScreenshot(page, laneDir, `${laneName}-updated-list-row`);
    await reloadContactsAndReopen(page, config, seed, laneName, config.timeoutMs);
    await page.locator(".light-contact-detail-hero .light-avatar.has-photo img").first().waitFor({ state: "visible", timeout: config.timeoutMs });
    screenshots.photo_added = await saveScreenshot(page, laneDir, `${laneName}-photo-added`);

    await page.getByRole("button", { name: "Edit contact" }).click();
    await page.getByRole("button", { name: "Done editing" }).waitFor({ state: "visible", timeout: config.timeoutMs });
    await page.getByRole("button", { name: "Remove photo" }).click();
    await waitForSaveState(page, "saving", config.timeoutMs);
    await waitForSaved(page, config.timeoutMs);
    await page.getByRole("button", { name: "Done editing" }).click();
    await page.getByRole("button", { name: "Edit contact" }).waitFor({ state: "visible", timeout: config.timeoutMs });

    await page.getByRole("button", { name: "Back" }).click();
    await waitForRoute(page, "contacts", config.timeoutMs);
    await page.goto(buildContactsUrl(config), { waitUntil: "domcontentloaded", timeout: config.timeoutMs });
    await waitForRoute(page, "contacts", config.timeoutMs);
    await openProofContactFromList(page, seed, config.timeoutMs);
    await page.locator(".light-contact-detail-hero .light-avatar").first().waitFor({ state: "visible", timeout: config.timeoutMs });
    assert(await page.locator(".light-contact-detail-hero .light-avatar.has-photo img").count() === 0, `${laneName}: photo should be removed after reload`);
    const avatarText = (await page.locator(".light-contact-detail-hero .light-avatar").first().textContent())?.trim() || "";
    assert(avatarText === expectations.initials, `${laneName}: expected initials ${expectations.initials} after photo removal, saw ${avatarText}`);
    screenshots.photo_removed = await saveScreenshot(page, laneDir, `${laneName}-photo-removed`);

    record = await fetchContactRecord(config, seed.contactId);
    assert(String(record.metadata?.photo || "") === "", `${laneName}: expected saved photo to be empty after removal`);

    return {
      viewport: {
        width: laneViewport.width,
        height: laneViewport.height,
      },
      first_name_trace: firstNameTrace,
      screenshots,
      final_contact: {
        id: record.id,
        title: record.title,
        summary: record.summary,
        email: record.metadata?.email || "",
        phone: record.metadata?.phone || "",
        photo: record.metadata?.photo || "",
      },
    };
  } finally {
    await context.close().catch(() => {});
  }
}

async function main() {
  const config = parseArgs(process.argv.slice(2));
  ensureDir(config.reportDir);
  assert(String(config.apiToken || "").trim(), "This proof needs an API token so it can seed and verify proof contacts.");

  const summary = {
    schema: RESULT_SCHEMA,
    ok: false,
    base_url: config.baseUrl,
    report_dir: config.reportDir,
    run_id: config.runId,
    refresh_key: config.refreshKey,
    required_commit: config.requiredCommit,
    manifest: null,
    lanes: {},
    seed: null,
    cleanup_performed: false,
  };

  if (config.live) {
    const manifest = await fetchManifest(config.baseUrl, config.refreshKey);
    const uiVersion = String(manifest.payload?.ui_version || "").trim();
    assert(commitMatches(config.requiredCommit, uiVersion), `Hosted manifest ui_version ${uiVersion || "missing"} did not match required commit ${config.requiredCommit}`);
    summary.manifest = {
      ...manifest,
      ui_version: uiVersion,
    };
  }

  const seed = await seedTaskProofWorkspace(config.baseUrl, config.apiToken, config.runId, {
    reportDir: config.reportDir,
    cleanupFirst: true,
  });
  summary.seed = {
    contact_id: seed.contactId,
    owner_contact_id: seed.ownerContactId,
    seed_manifest_path: seed.seed_manifest_path || "",
  };

  const browser = await chromium.launch({
    executablePath: resolveChromePath(),
    headless: true,
  });

  try {
    for (const [laneName, laneViewport] of Object.entries(VIEWPORTS)) {
      summary.lanes[laneName] = await proveLane(browser, config, seed, laneName, laneViewport);
    }
    summary.ok = true;
    writeJsonFile(path.join(config.reportDir, "summary.json"), summary);
  } catch (error) {
    writeAutomationError(config.reportDir, error);
    writeJsonFile(path.join(config.reportDir, "summary.json"), {
      ...summary,
      ok: false,
      error: error.message || String(error),
    });
    throw error;
  } finally {
    await browser.close().catch(() => {});
    if (!config.keepSeed) {
      await cleanupTaskProofSeed(config.baseUrl, config.apiToken, seed).catch(() => {});
      summary.cleanup_performed = true;
      writeJsonFile(path.join(config.reportDir, "summary.json"), summary);
    }
  }
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exit(1);
});
