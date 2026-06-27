import path from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright-core";

import {
  ensureDir,
  resolveChromePath,
  writeAutomationError,
  writeJsonFile,
} from "../../support/cover_shared.mjs";
import { loadProofRuntimeEnv, resolveWriteToken } from "../../support/proof_runtime_env.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
loadProofRuntimeEnv({ rootDir: ROOT });
const RESULT_SCHEMA = "pucky.universal_feed_tiles_browser_proof.v1";
const DEFAULT_BASE_URL = process.env.PUCKY_UNIVERSAL_FEED_TILES_BASE_URL || "https://pucky.fly.dev";
const MOBILE_VIEWPORT = { width: 430, height: 932 };
const DESKTOP_VIEWPORT = { width: 1440, height: 980 };
const DETAIL_SELECTOR = "#detail";
const REMINDER_PROOF_RECORD_ID = process.env.PUCKY_UNIVERSAL_FEED_REMINDER_ID || "demo-reminder-paint-samples";
const REMINDER_PROOF_TITLE = process.env.PUCKY_UNIVERSAL_FEED_REMINDER_TITLE || "Bring paint samples upstairs";
const REMINDER_PROOF_EVENT_TITLE = process.env.PUCKY_UNIVERSAL_FEED_REMINDER_EVENT_TITLE || "Front porch repair window";
const REMINDER_PROOF_BLOCKED_SUMMARY = process.env.PUCKY_UNIVERSAL_FEED_REMINDER_BLOCKED_SUMMARY
  || "Walk the porch list, paint touch-ups, and the one loose handrail fix.";
const ROUTES = [
  {
    surface: "Notes",
    route: "notes",
    themes: ["light", "dark"],
    primarySelector: ".light-note-row",
    emptySelector: ".light-empty-state",
    viewportModes: ["mobile", "desktop"],
    detail: {
      openerSelector: ".light-note-row",
      expectedRoute: "note-detail",
    },
  },
  {
    surface: "Meeting Notes",
    route: "meeting-notes",
    themes: ["light", "dark"],
    primarySelector: ".light-graph-row",
    emptySelector: ".light-empty-state",
    viewportModes: ["mobile", "desktop"],
    detail: {
      openerSelector: ".light-graph-row",
      expectedRoute: "meeting-note-detail",
    },
  },
  {
    surface: "Reminders",
    route: "reminders",
    themes: ["light", "dark"],
    primarySelector: ".light-reminder-row",
    emptySelector: ".light-empty-state",
    viewportModes: ["mobile", "desktop"],
    detail: {
      openerSelector: `.light-reminder-row[data-record-id="${REMINDER_PROOF_RECORD_ID}"]`,
      expectedRoute: "reminder-detail",
    },
  },
  {
    surface: "Projects",
    route: "projects",
    themes: ["light", "dark"],
    primarySelector: ".light-project-row",
    emptySelector: ".light-empty-state",
    viewportModes: ["mobile", "desktop"],
    detail: {
      openerSelector: ".light-project-row",
      expectedRoute: "project-detail",
    },
  },
  {
    surface: "Inbox",
    route: "inbox",
    themes: ["light", "dark"],
    primarySelector: ".card-wrap > article.card",
    emptySelector: ".empty, .feed-load-error",
    viewportModes: ["mobile", "desktop"],
    detail: {
      openerSelector: ".card-wrap > article.card .card-body",
      expectedSelector: `${DETAIL_SELECTOR}[aria-hidden="false"], ${DETAIL_SELECTOR}.is-open`,
    },
  },
  {
    surface: "Meetings",
    route: "meetings",
    themes: ["light", "dark"],
    primarySelector: ".card.card-meeting-list",
    emptySelector: ".meetings-empty",
    viewportModes: ["mobile", "desktop"],
    detail: {
      openerSelector: ".card.card-meeting-list .card-body",
      expectedSelector: `${DETAIL_SELECTOR}[aria-hidden="false"], ${DETAIL_SELECTOR}.is-open`,
    },
  },
];
const CALENDAR_CONNECTED_SURFACES = [
  {
    key: "meeting-notes",
    surface: "Meeting Notes",
    route: "meeting-notes",
    readySelector: ".light-graph-row",
    openerSelector: '[data-record-id="demo-meeting-home-refresh"]',
    detailSelector: '.light-shell[data-light-route="meeting-note-detail"]',
    expectedCalendarTitle: "Front porch repair window",
    blockedSummaries: [
      "Walk the porch list, paint touch-ups, and the one loose handrail fix.",
    ],
  },
  {
    key: "reminders",
    surface: "Reminders",
    route: "reminders",
    readySelector: ".light-reminder-row",
    openerSelector: `[data-record-id="${REMINDER_PROOF_RECORD_ID}"]`,
    openerText: REMINDER_PROOF_TITLE,
    detailSelector: '.light-shell[data-light-route="reminder-detail"]',
    expectedCalendarTitle: REMINDER_PROOF_EVENT_TITLE,
    blockedSummaries: [
      REMINDER_PROOF_BLOCKED_SUMMARY,
    ],
  },
  {
    key: "projects",
    surface: "Projects",
    route: "projects",
    readySelector: ".light-project-row",
    openerSelector: '.light-project-row[data-project-id="home-refresh"]',
    detailSelector: '.light-shell[data-light-route="project-detail"]',
    expectedCalendarTitle: "Front porch repair window",
    blockedSummaries: [
      "Walk the porch list, paint touch-ups, and the one loose handrail fix.",
    ],
  },
  {
    key: "tasks",
    surface: "Tasks",
    route: "tasks",
    readySelector: ".light-task-row, .light-task-detail-surface",
    openerSelector: '[data-task-id="demo-task-do-paint-samples"] .light-task-row-main',
    detailSelector: '.light-task-detail-surface[data-task-detail-id="demo-task-do-paint-samples"], .light-shell[data-light-route="task-detail"]',
    expectedCalendarTitle: "Front porch repair window",
    blockedSummaries: [
      "Walk the porch list, paint touch-ups, and the one loose handrail fix.",
    ],
  },
];
const CALENDAR_CONNECTED_TIME_WINDOW_RE = /\b\d{1,2}:\d{2}\s?(?:AM|PM)\s*-\s*\d{1,2}:\d{2}\s?(?:AM|PM)\b/i;
const CALENDAR_CONNECTED_DATE_PREFIX_RE = /^(?:Today|Tomorrow|Yesterday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|\d{1,2}\/\d{1,2}\/\d{2})\s*[·•]\s*/;
const CALENDAR_CONNECTED_ROW_SELECTOR = [
  '.light-linked-record-feed-row[data-workspace-target-kind="calendar_event"]',
  '.light-reminder-detail-tile[data-reminder-linked-kind="calendar_event"]',
  '.light-info-row[data-task-connected-kind="calendar_event"]',
].join(", ");
const PROJECT_CONNECTED_ROW_SELECTOR = ".light-linked-record-feed-row";
const CALENDAR_BLUE = "rgb(63, 109, 246)";

function resolveApiToken() {
  return resolveWriteToken({ rootDir: ROOT });
}

function timestampSlug() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function parseArgs(argv) {
  const config = {
    baseUrl: DEFAULT_BASE_URL,
    apiToken: resolveApiToken(),
    timeoutMs: 30000,
    headless: true,
    refreshKey: `universal-feed-tiles-${Date.now()}`,
    reportDir: path.resolve(ROOT, ".tmp", "universal-feed-tiles-proof", timestampSlug()),
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
    } else if (arg === "--refresh-key" && argv[index + 1]) {
      config.refreshKey = String(argv[++index] || "").trim() || config.refreshKey;
    } else if (arg === "--headed") {
      config.headless = false;
    }
  }
  return config;
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function buildRouteUrl(config, routeConfig, theme) {
  const url = new URL("/ui/pucky/latest/index.html", `${String(config.baseUrl || "").replace(/\/+$/, "")}/`);
  url.searchParams.set("theme", String(theme || "light"));
  url.searchParams.set("route", String(routeConfig.route || "home"));
  url.searchParams.set("reset_nav", "1");
  if (String(config.apiToken || "").trim()) {
    url.searchParams.set("api_token", String(config.apiToken || "").trim());
  }
  if (String(config.refreshKey || "").trim()) {
    url.searchParams.set("_pucky_refresh", String(config.refreshKey || "").trim());
  }
  return url.toString();
}

async function gotoRouteWithRetry(page, url, options, maxAttempts = 3) {
  let lastError = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      await page.goto(url, options);
      return;
    } catch (error) {
      lastError = error;
      if (attempt >= maxAttempts) {
        break;
      }
      await page.waitForTimeout(1000 * attempt);
    }
  }
  throw lastError;
}

async function fetchManifest(config) {
  const url = new URL("/ui/pucky/latest/manifest.json", `${String(config.baseUrl || "").replace(/\/+$/, "")}/`);
  if (String(config.refreshKey || "").trim()) {
    url.searchParams.set("_pucky_refresh", String(config.refreshKey || "").trim());
  }
  const response = await fetch(url, {
    headers: {
      "Cache-Control": "no-cache, no-store, max-age=0",
      Pragma: "no-cache",
    },
  });
  const payload = await response.json().catch(() => ({}));
  assert(response.ok, `Could not load manifest from ${url.toString()} (${response.status})`);
  return {
    manifest: payload,
    manifestUrl: url.toString(),
  };
}

async function saveScreenshot(page, filePath) {
  ensureDir(path.dirname(filePath));
  try {
    await page.screenshot({
      path: filePath,
      fullPage: true,
      animations: "disabled",
      timeout: 45000,
    });
  } catch (error) {
    await page.screenshot({
      path: filePath,
      fullPage: false,
      animations: "disabled",
      timeout: 45000,
    });
  }
  return filePath;
}

function timeoutMsFor(_routeConfig, config) {
  return Math.max(1000, Number(config.timeoutMs || 30000) || 30000);
}

function isZeroishPx(value) {
  return Math.abs(Number.parseFloat(String(value || "0")) || 0) <= 0.5;
}

function isTransparentColor(value) {
  const text = String(value || "").trim().toLowerCase();
  if (!text || text === "transparent") {
    return true;
  }
  const rgba = text.match(/^rgba?\((.+)\)$/);
  if (!rgba) {
    return false;
  }
  const parts = rgba[1].split(",").map(part => part.trim());
  if (parts.length === 4) {
    return Math.abs(Number.parseFloat(parts[3]) || 0) <= 0.01;
  }
  return parts.slice(0, 3).every(part => Number.parseFloat(part) === 0);
}

function isNoShadow(value) {
  const text = String(value || "").trim().toLowerCase();
  return !text || text === "none" || text === "rgba(0, 0, 0, 0) 0px 0px 0px 0px";
}

async function waitForRoute(page, route, timeoutMs) {
  await page.waitForFunction(
    expectedRoute => document.querySelector(".light-shell")?.getAttribute("data-light-route") === expectedRoute,
    route,
    { timeout: timeoutMs }
  );
}

async function waitForSurfaceReady(page, routeConfig, apiToken, timeoutMs) {
  void apiToken;
  await waitForRoute(page, routeConfig.route, timeoutMs);
  await page.waitForFunction(
    ({ primarySelector, emptySelector }) => {
      const primary = document.querySelector(primarySelector);
      const empty = emptySelector ? document.querySelector(emptySelector) : null;
      if (primary) {
        return true;
      }
      if (!empty) {
        return false;
      }
      const emptyText = String(empty.textContent || "").replace(/\s+/g, " ").trim();
      return !/\bLoading\b|Pulling workspace records|Loading inbox|Loading meetings/i.test(emptyText);
    },
    { primarySelector: routeConfig.primarySelector, emptySelector: routeConfig.emptySelector },
    { timeout: timeoutMs }
  );
}

async function scrollList(page) {
  return page.evaluate(() => {
    const candidates = [
      document.getElementById("feed"),
      document.querySelector(".detail-content"),
      document.scrollingElement,
    ].filter(Boolean);
    const target = candidates.find(node => node.scrollHeight - node.clientHeight > 80) || candidates[0] || document.scrollingElement;
    if (!target) {
      return { canScroll: false, target: "" };
    }
    const maxScroll = Math.max(0, target.scrollHeight - target.clientHeight);
    if (maxScroll <= 80) {
      return { canScroll: false, target: target.id || target.className || target.tagName };
    }
    target.scrollTo({ top: Math.min(maxScroll, Math.round(maxScroll * 0.5)), left: 0, behavior: "instant" });
    return {
      canScroll: true,
      target: target.id || target.className || target.tagName,
      maxScroll,
      top: target.scrollTop,
    };
  });
}

async function collectRouteMetrics(page, routeConfig) {
  return page.evaluate(config => {
    function count(selector) {
      return selector ? document.querySelectorAll(selector).length : 0;
    }
    function nodeRect(node) {
      if (!node) {
        return null;
      }
      const rect = node.getBoundingClientRect();
      return {
        left: Number(rect.left.toFixed(2)),
        top: Number(rect.top.toFixed(2)),
        width: Number(rect.width.toFixed(2)),
        height: Number(rect.height.toFixed(2)),
      };
    }
    function rectData(selector) {
      const node = document.querySelector(selector);
      return nodeRect(node);
    }
    function classList(node) {
      return node ? [...node.classList] : [];
    }
    function hasVisibleDivider(node) {
      if (!node) {
        return false;
      }
      const style = window.getComputedStyle(node);
      return (Number.parseFloat(style.borderTopWidth) || 0) > 0.5
        && String(style.borderTopColor || "").trim() !== "transparent";
    }
    const shell = document.querySelector(".light-shell");
    const header = document.querySelector(".light-page-header");
    const title = document.querySelector(".light-page-title, .light-page-title-detail");
    const feedPage = document.querySelector(".light-feed-page");
    const feedSurface = document.querySelector(".light-feed-surface");
    const firstSection = document.querySelector(".light-feed-section");
    const sectionKeys = [...document.querySelectorAll(".light-feed-section")]
      .map(node => node.getAttribute("data-feed-section") || "")
      .filter(Boolean);
    const matchingRows = [...document.querySelectorAll(config.primarySelector)];
    const firstRow = matchingRows[0] || null;
    const firstContentRow = matchingRows.find(node => node.querySelector(".card-body, .light-text-stack")) || firstRow;
    const firstRowStyle = firstRow ? window.getComputedStyle(firstRow) : null;
    const firstIdentity = firstContentRow?.querySelector(".identity, .light-small-icon, .light-app-icon") || null;
    const firstBody = firstContentRow?.querySelector(".card-body, .light-text-stack") || null;
    const firstActions = firstContentRow?.querySelector(".card-actions") || null;
    const firstTitle = firstContentRow?.querySelector(".card-title-trigger, .title, .light-event-title, strong") || null;
    const firstSummary = firstContentRow?.querySelector(".card-summary-trigger .preview, .card-summary-trigger, .light-note-row-context, .light-project-summary, .light-event-summary") || null;
    const firstBodyStyle = firstBody ? window.getComputedStyle(firstBody) : null;
    const firstActionsStyle = firstActions ? window.getComputedStyle(firstActions) : null;
    const dividerNode = matchingRows.slice(1).find(node => hasVisibleDivider(node)) || null;
    const dividerStyle = dividerNode ? window.getComputedStyle(dividerNode) : null;
    const wrapper = firstRow?.closest(".card-wrap") || null;
    const rowActionMetrics = matchingRows.slice(0, 4).map(node => {
      const actionsNode = node.querySelector(".card-actions");
      const titleNode = node.querySelector(".card-title-trigger, .title, .light-event-title, strong");
      const summaryNode = node.querySelector(".card-summary-trigger .preview, .card-summary-trigger, .light-note-row-context, .light-project-summary, .light-event-summary");
      return {
        classList: classList(node),
        actionCount: actionsNode ? actionsNode.querySelectorAll(".action").length : 0,
        actionsClassList: classList(actionsNode),
        actionsRect: nodeRect(actionsNode),
        titleRect: nodeRect(titleNode),
        summaryRect: nodeRect(summaryNode),
      };
    });
    return {
      routeIdentity: shell?.getAttribute("data-light-route") || "",
      headerPresent: Boolean(header),
      headerText: String(title?.textContent || "").trim(),
      headerMetrics: rectData(".light-page-header"),
      titleMetrics: rectData(".light-page-title, .light-page-title-detail"),
      pageClasses: classList(feedPage),
      surfaceClasses: classList(feedSurface),
      firstSectionClasses: classList(firstSection),
      sectionKeys,
      scrollMetrics: {
        innerWidth: window.innerWidth,
        innerHeight: window.innerHeight,
        documentScrollWidth: document.documentElement.scrollWidth,
        documentScrollHeight: document.documentElement.scrollHeight,
        documentScrollLeft: window.scrollX || document.documentElement.scrollLeft || 0,
      },
      firstRowChrome: firstRow ? {
        tagName: String(firstRow.tagName || "").toLowerCase(),
        classList: classList(firstRow),
        wrapperClasses: classList(wrapper),
        borderTopWidth: firstRowStyle.borderTopWidth,
        borderRightWidth: firstRowStyle.borderRightWidth,
        borderBottomWidth: firstRowStyle.borderBottomWidth,
        borderLeftWidth: firstRowStyle.borderLeftWidth,
        borderTopLeftRadius: firstRowStyle.borderTopLeftRadius,
        borderTopRightRadius: firstRowStyle.borderTopRightRadius,
        borderBottomLeftRadius: firstRowStyle.borderBottomLeftRadius,
        borderBottomRightRadius: firstRowStyle.borderBottomRightRadius,
        boxShadow: firstRowStyle.boxShadow,
        backgroundColor: firstRowStyle.backgroundColor,
        paddingLeft: firstRowStyle.paddingLeft,
        paddingRight: firstRowStyle.paddingRight,
        dividerColor: dividerStyle ? dividerStyle.borderTopColor : "",
        dividerWidth: dividerStyle ? dividerStyle.borderTopWidth : "",
      } : null,
      firstRowContentMetrics: firstRow ? {
        identityRect: nodeRect(firstIdentity),
        bodyRect: nodeRect(firstBody),
        actionsRect: nodeRect(firstActions),
        titleRect: nodeRect(firstTitle),
        summaryRect: nodeRect(firstSummary),
        actionCount: firstActions ? firstActions.querySelectorAll(".action").length : 0,
        actionsClassList: classList(firstActions),
        bodyPaddingLeft: firstBodyStyle ? firstBodyStyle.paddingLeft : "",
        bodyPaddingRight: firstBodyStyle ? firstBodyStyle.paddingRight : "",
        actionsGap: firstActionsStyle ? firstActionsStyle.gap : "",
        actionsMinWidth: firstActionsStyle ? firstActionsStyle.minWidth : "",
        actionsWidth: firstActionsStyle ? firstActionsStyle.width : "",
      } : null,
      rowActionMetrics,
      selectorCounts: {
        primary: count(config.primarySelector),
        genericFeedRows: count(".light-feed-row"),
        feedPages: count(".light-feed-page"),
        feedSurfaces: count(".light-feed-surface"),
        feedSections: count(".light-feed-section"),
        notesPinButtons: count(".light-note-pin-button"),
        notesLeadingIcons: count(".light-note-row .light-small-icon"),
        graphLeadingIcons: count(".light-graph-row .light-small-icon"),
        graphChevrons: count(".light-graph-row .light-chevron"),
        reminderChips: count(".light-reminder-row .light-graph-chip-row"),
        reminderSnoozedRows: count(".light-reminder-row.delivery-snoozed"),
        listRowPills: count(".light-project-chip-row"),
        inboxCards: count(".card-wrap > article.card"),
        archiveActions: count(".archive-reveal-action"),
        inboxArchiveToggles: count(".inbox-archive-toggle"),
        inboxManageToggles: count(".inbox-manage-toggle"),
        inlineAudioTriggers: count(".card-inline-audio-trigger"),
        meetingsCards: count(".card.card-meeting-list"),
        meetingsEmpty: count(".meetings-empty"),
      },
    };
  }, routeConfig);
}

async function collectDetailMetrics(page) {
  return page.evaluate(({ detailSelector, calendarConnectedRowSelector }) => {
    function calendarConnectedRows() {
      return [...document.querySelectorAll(calendarConnectedRowSelector)].map(node => {
        const stack = node.querySelector(".light-text-stack");
        const title = String(stack?.querySelector("strong")?.textContent || "").trim();
        const detail = String(stack?.querySelector("span")?.textContent || "").trim().replace(/\s+/g, " ");
        return {
          title,
          detail,
          text: String(node.textContent || "").trim().replace(/\s+/g, " "),
        };
      }).filter(row => row.title || row.detail || row.text);
    }
    const detail = document.querySelector(detailSelector);
    const reminderCard = document.querySelector('[data-reminder-detail-card="true"]');
    const reminderDetailTextSource = detail || reminderCard || document.querySelector(".light-shell");
    return {
      currentRoute: document.querySelector(".light-shell")?.getAttribute("data-light-route") || "",
      detailVisible: Boolean(detail && (!detail.hasAttribute("aria-hidden") || detail.getAttribute("aria-hidden") === "false" || detail.classList.contains("is-open"))),
      noteHtmlFrames: document.querySelectorAll(".light-note-detail-html-body .light-html-frame").length,
      scheduleSections: [...document.querySelectorAll(".light-section-title")].filter(node => String(node.textContent || "").trim() === "SCHEDULE").length,
      channelsSections: [...document.querySelectorAll(".light-section-title")].filter(node => String(node.textContent || "").trim() === "CHANNELS").length,
      notesSections: [...document.querySelectorAll(".light-section-title")].filter(node => String(node.textContent || "").trim() === "NOTES").length,
      reminderDetailFeeds: document.querySelectorAll('[data-reminder-detail-feed="true"]').length,
      reminderDetailState: reminderCard?.getAttribute("data-reminder-state") || "",
      reminderConnectedRows: document.querySelectorAll('[data-reminder-detail-feed="true"] [data-reminder-detail-tile]').length,
      reminderActionRows: document.querySelectorAll('[data-reminder-action-row="true"]').length,
      reminderDetailChevrons: document.querySelectorAll(".light-reminder-detail-feed .light-chevron").length,
      reminderHasStatusText: String(reminderDetailTextSource?.textContent || "").includes("Status:"),
      reminderHasDeliveryText: String(reminderDetailTextSource?.textContent || "").includes("Delivery:"),
      projectGridCount: document.querySelectorAll(".light-project-section-grid").length,
      connectedLinkedRecordSections: document.querySelectorAll('.light-linked-records-section[data-linked-records-title="connected"]').length,
      detailHeroCount: document.querySelectorAll(".light-detail-hero").length,
      chipCloudCount: document.querySelectorAll(".light-chip-cloud").length,
      calendarConnectedRows: calendarConnectedRows(),
      detailShells: document.querySelectorAll(".detail-shell").length,
      detailPanels: document.querySelectorAll(`${detailSelector}.is-open, ${detailSelector}[aria-hidden="false"]`).length,
    };
  }, { detailSelector: DETAIL_SELECTOR, calendarConnectedRowSelector: CALENDAR_CONNECTED_ROW_SELECTOR });
}

async function collectCalendarConnectedRows(page) {
  return page.evaluate(selector => {
    return [...document.querySelectorAll(selector)].map(node => {
      const stack = node.querySelector(".light-text-stack");
      const title = String(stack?.querySelector("strong")?.textContent || "").trim();
      const detail = String(stack?.querySelector("span")?.textContent || "").trim().replace(/\s+/g, " ");
      return {
        title,
        detail,
        text: String(node.textContent || "").trim().replace(/\s+/g, " "),
      };
    }).filter(row => row.title || row.detail || row.text);
  }, CALENDAR_CONNECTED_ROW_SELECTOR);
}

async function waitForProjectConnectedRows(page, timeoutMs, blockedTitles = []) {
  await page.waitForFunction(
    ({ selector, blocked }) => {
      const rows = [...document.querySelectorAll(selector)];
      if (!rows.length) {
        return false;
      }
      const titles = rows
        .map(node => String(node.querySelector("strong")?.textContent || "").trim())
        .filter(Boolean);
      if (!titles.length) {
        return false;
      }
      return titles.every(title => !blocked.includes(title));
    },
    { selector: PROJECT_CONNECTED_ROW_SELECTOR, blocked: blockedTitles },
    { timeout: timeoutMs }
  );
}

async function collectProjectConnectedMetrics(page) {
  return page.evaluate(selector => {
    return [...document.querySelectorAll(selector)].map(node => {
      const stack = node.querySelector(".light-text-stack");
      const title = String(stack?.querySelector("strong")?.textContent || "").trim();
      const detail = String(stack?.querySelector("span")?.textContent || "").trim().replace(/\s+/g, " ");
      const icon = node.querySelector(".light-small-icon");
      const iconStyle = icon ? window.getComputedStyle(icon) : null;
      return {
        title,
        detail,
        text: String(node.textContent || "").trim().replace(/\s+/g, " "),
        kind: node.getAttribute("data-workspace-target-kind") || node.getAttribute("data-linked-record-kind") || "",
        targetRoute: node.getAttribute("data-workspace-target-route") || "",
        targetId: node.getAttribute("data-workspace-target-id") || "",
        calendarIconColor: iconStyle?.color || "",
      };
    }).filter(row => row.title || row.detail || row.text);
  }, PROJECT_CONNECTED_ROW_SELECTOR);
}

async function collectDetailIdentity(page) {
  return page.evaluate(() => {
    const shell = document.querySelector(".light-shell");
    const route = shell?.getAttribute("data-light-route") || "";
    const title = String(
      document.querySelector(".light-page-title, .light-page-title-detail, .light-task-detail-title, .light-document-page h1")
        ?.textContent || ""
    ).trim();
    return {
      route,
      title,
      taskId: document.querySelector(".light-task-detail-surface")?.getAttribute("data-task-detail-id") || "",
    };
  });
}

async function clickProjectConnectedRow(page, targetKind, targetId, timeoutMs) {
  const row = page.locator(
    `${PROJECT_CONNECTED_ROW_SELECTOR}[data-workspace-target-kind="${targetKind}"][data-workspace-target-id="${targetId}"]`
  ).first();
  await row.waitFor({ state: "visible", timeout: timeoutMs });
  await row.click();
}

function assertCalendarConnectedRow(surfaceConfig, rows) {
  const matchingRows = rows.filter(row => !surfaceConfig.expectedCalendarTitle || row.title === surfaceConfig.expectedCalendarTitle);
  assert(
    matchingRows.length > 0,
    `${surfaceConfig.surface}: expected linked Calendar row for ${surfaceConfig.expectedCalendarTitle}; saw ${JSON.stringify(rows)}`
  );
  const row = matchingRows[0];
  assert(
    CALENDAR_CONNECTED_DATE_PREFIX_RE.test(row.detail),
    `${surfaceConfig.surface}: Calendar row should start with relative date, saw "${row.detail}"`
  );
  assert(
    CALENDAR_CONNECTED_TIME_WINDOW_RE.test(row.detail),
    `${surfaceConfig.surface}: Calendar row should show a start-end time window, saw "${row.detail}"`
  );
  for (const blocked of surfaceConfig.blockedSummaries || []) {
    assert(!row.detail.includes(blocked), `${surfaceConfig.surface}: Calendar row leaked old summary text "${blocked}"`);
    assert(!row.text.includes(blocked), `${surfaceConfig.surface}: Calendar row container leaked old summary text "${blocked}"`);
  }
  return row;
}

function assertCommonRouteState(routeConfig, metrics) {
  assert(metrics.routeIdentity === routeConfig.route, `${routeConfig.surface}: expected route ${routeConfig.route}, saw ${metrics.routeIdentity}`);
  assert(metrics.headerPresent, `${routeConfig.surface}: expected sticky header to render`);
  assert(metrics.scrollMetrics.documentScrollWidth <= metrics.scrollMetrics.innerWidth + 1, `${routeConfig.surface}: horizontal overflow detected`);
  assert(metrics.selectorCounts.feedPages >= 1, `${routeConfig.surface}: missing .light-feed-page`);
  assert(metrics.selectorCounts.feedSurfaces >= 1, `${routeConfig.surface}: missing .light-feed-surface`);
  assert(metrics.selectorCounts.feedSections >= 1, `${routeConfig.surface}: missing .light-feed-section`);
  if (metrics.selectorCounts.primary > 0) {
    assert(Boolean(metrics.firstRowChrome), `${routeConfig.surface}: expected first row chrome metrics`);
  }
}

function assertFlatShellState(routeConfig, metrics) {
  if (metrics.selectorCounts.primary === 0) {
    return;
  }
  const chrome = metrics.firstRowChrome;
  assert(chrome, `${routeConfig.surface}: missing computed flat shell metrics`);
  if (routeConfig.route !== "notes") {
    assert(chrome.classList.includes("is-flat-feed"), `${routeConfig.surface}: first row should opt into .is-flat-feed classes`);
  }
  if (routeConfig.route === "inbox" || routeConfig.route === "meetings") {
    assert(chrome.wrapperClasses.includes("is-flat-feed"), `${routeConfig.surface}: wrapper should opt into .is-flat-feed classes`);
  }
  assert(isZeroishPx(chrome.borderLeftWidth), `${routeConfig.surface}: resting shell should not keep a left border (${chrome.borderLeftWidth})`);
  assert(isZeroishPx(chrome.borderRightWidth), `${routeConfig.surface}: resting shell should not keep a right border (${chrome.borderRightWidth})`);
  assert(isZeroishPx(chrome.borderBottomWidth), `${routeConfig.surface}: resting shell should not keep a bottom border (${chrome.borderBottomWidth})`);
  assert(isZeroishPx(chrome.borderTopLeftRadius), `${routeConfig.surface}: resting shell should not keep rounded corners (${chrome.borderTopLeftRadius})`);
  assert(isZeroishPx(chrome.borderTopRightRadius), `${routeConfig.surface}: resting shell should not keep rounded corners (${chrome.borderTopRightRadius})`);
  assert(isNoShadow(chrome.boxShadow), `${routeConfig.surface}: resting shell should not keep a shadow (${chrome.boxShadow})`);
  assert(isTransparentColor(chrome.backgroundColor), `${routeConfig.surface}: resting shell should stay visually flat (${chrome.backgroundColor})`);
  if (metrics.selectorCounts.primary > 1) {
    assert(!isZeroishPx(chrome.dividerWidth), `${routeConfig.surface}: divider-based row separation should remain visible`);
    assert(!isTransparentColor(chrome.dividerColor), `${routeConfig.surface}: divider color should remain visible`);
  }
}

function assertRouteSpecificState(routeConfig, metrics) {
  if (routeConfig.route === "notes") {
    assert(metrics.sectionKeys.includes("pinned"), "Notes: pinned section missing");
    assert(metrics.sectionKeys.includes("recent"), "Notes: recent section missing");
    assert(metrics.selectorCounts.notesPinButtons > 0, "Notes: expected right-side pin buttons");
    assert(metrics.selectorCounts.notesLeadingIcons === 0, "Notes: no left icon regression allowed");
  }
  if (routeConfig.route === "meeting-notes") {
    assert(metrics.selectorCounts.graphLeadingIcons === 0, "Meeting Notes: leading icon regression detected");
    assert(metrics.selectorCounts.graphChevrons === 0, "Meeting Notes: trailing chevron regression detected");
  }
  if (routeConfig.route === "reminders") {
    assert(metrics.sectionKeys.includes("live") || metrics.sectionKeys.includes("upcoming"), "Reminders: live/upcoming sections missing");
    if (metrics.selectorCounts.reminderSnoozedRows > 0) {
      assert(metrics.sectionKeys.includes("upcoming"), "Reminders: snoozed reminders should stay inside Upcoming");
    }
    assert(metrics.selectorCounts.reminderChips === 0, "Reminders: chips should stay hidden");
  }
  if (routeConfig.route === "projects") {
    assert(metrics.selectorCounts.listRowPills === 0, "Projects: list rows should not render gray pills");
  }
  if (routeConfig.route === "inbox" && metrics.selectorCounts.primary > 0) {
    assert(metrics.selectorCounts.inboxCards > 0, "Inbox: canonical cards should render");
    assert(metrics.selectorCounts.inboxArchiveToggles === 1, "Inbox: archive filter toggle should remain available");
    assert(metrics.selectorCounts.inboxManageToggles === 1, "Inbox: manage toggle should remain available");
    assert(metrics.firstRowContentMetrics, "Inbox: missing first-row content metrics");
    assert(metrics.firstRowContentMetrics.bodyRect, "Inbox: missing measurable body width");
    assert(metrics.firstRowContentMetrics.actionsRect, "Inbox: missing measurable action rail width");
    assert(metrics.firstRowContentMetrics.bodyRect.width > 190, `Inbox: flat cards should reclaim body width beyond the old 184px column (${metrics.firstRowContentMetrics.bodyRect.width})`);
    const oneActionRow = metrics.rowActionMetrics.find(item => item.actionCount === 1 && item.actionsRect);
    if (oneActionRow) {
      assert(oneActionRow.actionsRect.width < 60, `Inbox: one-action rows should not reserve the old wide action rail (${oneActionRow.actionsRect.width})`);
    }
    const twoActionRow = metrics.rowActionMetrics.find(item => item.actionCount >= 2 && item.actionsRect);
    if (twoActionRow) {
      assert(twoActionRow.actionsRect.width < 92, `Inbox: two-action rows should stay tighter than the old 98px rail (${twoActionRow.actionsRect.width})`);
    }
  }
  if (routeConfig.route === "meetings") {
    if (metrics.selectorCounts.primary > 0) {
      assert(metrics.selectorCounts.meetingsCards === metrics.selectorCounts.primary, "Meetings: rows should stay card-meeting-list");
    } else {
      assert(metrics.selectorCounts.meetingsEmpty > 0, "Meetings: empty-state honesty should remain visible when no rows exist");
    }
  }
}

async function backToList(page, routeConfig, timeoutMs) {
  for (let index = 0; index < 6; index += 1) {
    await page.evaluate(() => window.PuckyHandleAndroidBack && window.PuckyHandleAndroidBack());
    try {
      if (routeConfig.detail.expectedRoute) {
        await waitForRoute(page, routeConfig.route, 1000);
        return true;
      }
      await page.waitForFunction(
        selector => {
          const panel = document.querySelector(selector);
          return !panel || panel.getAttribute("aria-hidden") === "true" || !panel.classList.contains("is-open");
        },
        routeConfig.detail.expectedSelector,
        { timeout: 1000 }
      );
      await waitForRoute(page, routeConfig.route, timeoutMs);
      return true;
    } catch (_error) {
      // Keep trying the shared back handler.
    }
  }
  return false;
}

async function openDetailAndReturn(page, routeConfig, timeoutMs, routeDir, prefix) {
  const openers = page.locator(routeConfig.detail.openerSelector);
  const openerCount = await openers.count();
  if (openerCount === 0) {
    return {
      attempted: false,
      opened: false,
      returned: false,
      routeAfterOpen: routeConfig.route,
      reason: "No primary rows available for detail open",
    };
  }
  const attemptLimit = routeConfig.route === "reminders" ? Math.min(openerCount, 4) : 1;
  let detailMetrics = null;
  for (let index = 0; index < attemptLimit; index += 1) {
    const opener = openers.nth(index);
    await opener.waitFor({ state: "visible", timeout: timeoutMs });
    await opener.click();
    if (routeConfig.detail.expectedRoute) {
      await waitForRoute(page, routeConfig.detail.expectedRoute, timeoutMs);
    } else if (routeConfig.detail.expectedSelector) {
      await page.locator(routeConfig.detail.expectedSelector).first().waitFor({ state: "visible", timeout: timeoutMs });
    }
    detailMetrics = await collectDetailMetrics(page);
    const reminderMissingLinkedNote = routeConfig.route === "reminders"
      && detailMetrics.reminderConnectedRows === 0
      && index + 1 < attemptLimit;
    if (!reminderMissingLinkedNote) {
      break;
    }
    const returned = await backToList(page, routeConfig, timeoutMs);
    assert(returned, `${routeConfig.surface}: could not return while searching for a reminder with a linked note`);
    await waitForRoute(page, routeConfig.route, timeoutMs);
  }
  assert(detailMetrics, `${routeConfig.surface}: detail did not open`);
  if (routeConfig.route === "notes") {
    assert(detailMetrics.noteHtmlFrames > 0, "Notes: detail should stay HTML-backed");
  }
  if (routeConfig.route === "reminders") {
    assert(detailMetrics.scheduleSections === 0, "Reminders: schedule section should be folded into the mixed feed");
    assert(detailMetrics.channelsSections === 0, "Reminders: channels section should stay hidden");
    assert(detailMetrics.notesSections === 0, "Reminders: notes section should be folded into the mixed feed");
    assert(detailMetrics.reminderDetailFeeds > 0, "Reminders: mixed reminder detail feed should render");
    assert(detailMetrics.reminderConnectedRows > 0, "Reminders: connected tiles should render in the mixed feed");
    assert(!detailMetrics.reminderHasStatusText, "Reminders: detail should not show Status text");
    assert(!detailMetrics.reminderHasDeliveryText, "Reminders: detail should not show Delivery text");
    if (detailMetrics.reminderDetailState === "live") {
      assert(detailMetrics.reminderActionRows > 0, "Reminders: live detail should render actions");
    } else {
      assert(detailMetrics.reminderActionRows === 0, `Reminders: non-live detail should not render actions (saw ${detailMetrics.reminderActionRows})`);
    }
    assert(detailMetrics.reminderDetailChevrons === 0, "Reminders: mixed feed rows should drop trailing chevrons");
  }
  if (routeConfig.route === "projects") {
    assert(detailMetrics.connectedLinkedRecordSections > 0, "Projects: connected detail section should render");
    assert(detailMetrics.detailHeroCount === 0, "Expected project detail hero card to be removed");
    assert(detailMetrics.chipCloudCount === 0, "Expected project detail chip cloud to be removed");
  }
  const detailScreenshot = await saveScreenshot(page, path.join(routeDir, `${prefix}-detail-open.png`));
  const returned = await backToList(page, routeConfig, timeoutMs);
  assert(returned, `${routeConfig.surface}: could not return from first detail open`);
  await waitForRoute(page, routeConfig.route, timeoutMs);
  const backScreenshot = await saveScreenshot(page, path.join(routeDir, `${prefix}-back-to-list.png`));
  return {
    attempted: true,
    opened: true,
    returned,
    routeAfterOpen: detailMetrics.currentRoute,
    detailMetrics,
    screenshots: {
      detailOpen: detailScreenshot,
      backToList: backScreenshot,
    },
  };
}

async function revealArchiveWithoutMutating(page, routeConfig, timeoutMs, routeDir, prefix) {
  if (!["inbox", "meetings"].includes(routeConfig.route)) {
    return {
      attempted: false,
      opened: false,
      closed: false,
      reason: "Archive reveal not required for this route",
    };
  }

  let lastResolveError = null;
  let wrapper = null;
  for (let attemptIndex = 0; attemptIndex < 8; attemptIndex += 1) {
    const candidate = page.locator(".card-wrap").filter({ has: page.locator(".archive-reveal-action") }).first();
    if (await candidate.count() === 0) {
      await page.waitForTimeout(100 + attemptIndex * 50);
      continue;
    }
    try {
      await candidate.locator("article.card").first().waitFor({ state: "visible", timeout: Math.min(2000, timeoutMs) });
      await candidate.scrollIntoViewIfNeeded({ timeout: Math.min(2000, timeoutMs) });
      wrapper = candidate;
      break;
    } catch (error) {
      lastResolveError = error;
      await page.waitForTimeout(100 + attemptIndex * 50);
    }
  }

  if (!wrapper) {
    if (lastResolveError) {
      throw lastResolveError;
    }
    return {
      attempted: false,
      opened: false,
      closed: false,
      reason: "No archivable wrapper found",
    };
  }
  const card = wrapper.locator("article.card").first();
  const box = await card.boundingBox();
  assert(box, `${routeConfig.surface}: could not read the first archivable card bounds`);
  await wrapper.evaluate(node => {
    const rect = node.getBoundingClientRect();
    const y = rect.top + rect.height * 0.5;
    const startX = rect.left + rect.width * 0.78;
    const endX = rect.left + rect.width * 0.18;
    const steps = 4;
    const dispatchTouch = (type, x) => {
      const touchPoint = [{ clientX: x, clientY: y }];
      const event = new Event(type, { bubbles: true, cancelable: true });
      Object.defineProperty(event, "touches", { value: type === "touchend" ? [] : touchPoint });
      Object.defineProperty(event, "targetTouches", { value: type === "touchend" ? [] : touchPoint });
      Object.defineProperty(event, "changedTouches", { value: touchPoint });
      node.dispatchEvent(event);
    };
    dispatchTouch("touchstart", startX);
    for (let step = 1; step <= steps; step += 1) {
      const progress = step / steps;
      dispatchTouch("touchmove", startX + (endX - startX) * progress);
    }
    dispatchTouch("touchend", endX);
  });
  await page.waitForFunction(
    () => document.querySelectorAll(".card-wrap.is-archive-reveal-open").length > 0,
    undefined,
    { timeout: timeoutMs }
  );
  const revealMetrics = await page.evaluate(() => {
    const wrapperNode = document.querySelector(".card-wrap.is-archive-reveal-open");
    const action = wrapperNode?.querySelector(".archive-reveal-action");
    return {
      wrapperClasses: wrapperNode ? [...wrapperNode.classList] : [],
      actionLabel: String(action?.getAttribute("aria-label") || "").trim(),
      actionVisible: Boolean(action),
    };
  });
  const archiveScreenshot = await saveScreenshot(page, path.join(routeDir, `${prefix}-archive-reveal.png`));
  await page.mouse.click(4, Math.max(4, Math.round(box.y + 12)));
  await page.waitForFunction(
    () => document.querySelectorAll(".card-wrap.is-archive-reveal-open").length === 0,
    undefined,
    { timeout: timeoutMs }
  );
  return {
    attempted: true,
    opened: true,
    closed: true,
    revealMetrics,
    screenshot: archiveScreenshot,
  };
}

async function captureRoute(browser, config, routeConfig, theme, viewportName, viewport, consoleEvents, networkEvents) {
  const routeDir = path.join(config.reportDir, routeConfig.route, theme, viewportName);
  const videoDir = path.join(routeDir, "video");
  ensureDir(routeDir);
  ensureDir(videoDir);
  const context = await browser.newContext({
    viewport,
    screen: viewport,
    hasTouch: viewportName === "mobile",
    isMobile: viewportName === "mobile",
    recordVideo: { dir: videoDir, size: viewport },
  });
  await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
  const page = await context.newPage();
  const pageVideo = page.video();
  page.on("console", message => {
    consoleEvents.push({
      route: routeConfig.route,
      theme,
      viewport: viewportName,
      type: message.type(),
      text: message.text(),
    });
  });
  page.on("pageerror", error => {
    consoleEvents.push({
      route: routeConfig.route,
      theme,
      viewport: viewportName,
      type: "pageerror",
      text: error.message || String(error),
    });
  });
  page.on("response", response => {
    networkEvents.push({
      route: routeConfig.route,
      theme,
      viewport: viewportName,
      url: response.url(),
      status: response.status(),
      ok: response.ok(),
    });
  });

  const prefix = viewportName;
  const tracePath = path.join(routeDir, `${prefix}-trace.zip`);
  let summary = null;
  try {
    const pageUrl = buildRouteUrl(config, routeConfig, theme);
    await gotoRouteWithRetry(page, pageUrl, { waitUntil: "domcontentloaded", timeout: timeoutMsFor(routeConfig, config) });
    await waitForSurfaceReady(page, routeConfig, config.apiToken, config.timeoutMs);
    const routeTop = await saveScreenshot(page, path.join(routeDir, `${prefix}-route-top.png`));
    const metrics = await collectRouteMetrics(page, routeConfig);
    assertCommonRouteState(routeConfig, metrics);
    assertFlatShellState(routeConfig, metrics);
    assertRouteSpecificState(routeConfig, metrics);
    const scrollState = await scrollList(page);
    let secondaryScreenshot = "";
    if (scrollState.canScroll) {
      await page.waitForTimeout(150);
      secondaryScreenshot = await saveScreenshot(page, path.join(routeDir, `${prefix}-scrolled.png`));
    }
    const detailResult = await openDetailAndReturn(page, routeConfig, config.timeoutMs, routeDir, prefix);
    const archiveRevealResult = await revealArchiveWithoutMutating(page, routeConfig, config.timeoutMs, routeDir, prefix);
    summary = {
      surface: routeConfig.surface,
      route: routeConfig.route,
      theme,
      viewport: viewportName,
      page_url: pageUrl,
      container_classes: {
        page: metrics.pageClasses,
        surface: metrics.surfaceClasses,
        first_section: metrics.firstSectionClasses,
      },
      item_counts: metrics.selectorCounts,
      header_metrics: metrics.headerMetrics,
      title_metrics: metrics.titleMetrics,
      scroll_metrics: metrics.scrollMetrics,
      first_row_chrome_metrics: metrics.firstRowChrome,
      first_row_content_metrics: metrics.firstRowContentMetrics,
      row_action_metrics: metrics.rowActionMetrics,
      section_keys: metrics.sectionKeys,
      first_detail_result: detailResult,
      archive_reveal_result: archiveRevealResult,
      screenshots: {
        route_top: routeTop,
        scrolled: secondaryScreenshot,
      },
      trace_path: tracePath,
      video_path: "",
    };
    writeJsonFile(path.join(routeDir, `${prefix}-summary.json`), summary);
  } finally {
    await context.tracing.stop({ path: tracePath }).catch(() => {});
    await context.close().catch(() => {});
  }
  if (summary) {
    summary.video_path = pageVideo ? await pageVideo.path().catch(() => "") : "";
    writeJsonFile(path.join(routeDir, `${prefix}-summary.json`), summary);
  }
  return summary;
}

async function captureCalendarConnectedSurface(browser, config, surfaceConfig, theme, viewportName, viewport, consoleEvents, networkEvents) {
  const routeDir = path.join(config.reportDir, "calendar-connected", surfaceConfig.key, theme, viewportName);
  ensureDir(routeDir);
  const context = await browser.newContext({
    viewport,
    screen: viewport,
    hasTouch: viewportName === "mobile",
    isMobile: viewportName === "mobile",
  });
  const page = await context.newPage();
  page.on("console", message => {
    consoleEvents.push({
      route: surfaceConfig.route,
      theme,
      viewport: viewportName,
      type: message.type(),
      text: message.text(),
    });
  });
  page.on("pageerror", error => {
    consoleEvents.push({
      route: surfaceConfig.route,
      theme,
      viewport: viewportName,
      type: "pageerror",
      text: error.message || String(error),
    });
  });
  page.on("response", response => {
    networkEvents.push({
      route: surfaceConfig.route,
      theme,
      viewport: viewportName,
      url: response.url(),
      status: response.status(),
      ok: response.ok(),
    });
  });

  try {
    const pageUrl = buildRouteUrl(config, surfaceConfig, theme);
    await gotoRouteWithRetry(page, pageUrl, { waitUntil: "domcontentloaded", timeout: config.timeoutMs });
    await waitForRoute(page, surfaceConfig.route, config.timeoutMs);
    await page.locator(surfaceConfig.readySelector).first().waitFor({ state: "visible", timeout: config.timeoutMs });
    let opener = page.locator(surfaceConfig.openerSelector).first();
    if (!(await opener.count()) && surfaceConfig.openerText) {
      opener = page.locator(surfaceConfig.readySelector, { hasText: surfaceConfig.openerText }).first();
    }
    assert(await opener.count(), `${surfaceConfig.surface}: expected a connected-surface opener matching ${surfaceConfig.openerSelector} or ${surfaceConfig.openerText || "(no openerText fallback)"}.`);
    await opener.scrollIntoViewIfNeeded();
    await opener.click();
    await page.locator(surfaceConfig.detailSelector).first().waitFor({ state: "visible", timeout: config.timeoutMs });
    await page.waitForFunction(
      ({ selector, expectedTitle, datePrefixSource, timeWindowSource }) => {
        const datePrefixRe = new RegExp(datePrefixSource, "i");
        const timeWindowRe = new RegExp(timeWindowSource, "i");
        const rows = [...document.querySelectorAll(selector)];
        return rows.some(row => {
          const title = String(row.querySelector(".light-text-stack strong")?.textContent || "").trim();
          const detail = String(row.querySelector(".light-text-stack span")?.textContent || "").trim().replace(/\s+/g, " ");
          if (expectedTitle && title !== expectedTitle) {
            return false;
          }
          return datePrefixRe.test(detail) && timeWindowRe.test(detail);
        });
      },
      {
        selector: CALENDAR_CONNECTED_ROW_SELECTOR,
        expectedTitle: surfaceConfig.expectedCalendarTitle || "",
        datePrefixSource: CALENDAR_CONNECTED_DATE_PREFIX_RE.source,
        timeWindowSource: CALENDAR_CONNECTED_TIME_WINDOW_RE.source,
      },
      { timeout: config.timeoutMs }
    );
    const rows = await collectCalendarConnectedRows(page);
    const matchedRow = assertCalendarConnectedRow(surfaceConfig, rows);
    const screenshot = await saveScreenshot(page, path.join(routeDir, "calendar-connected-row.png"));
    const summary = {
      surface: surfaceConfig.surface,
      route: surfaceConfig.route,
      theme,
      viewport: viewportName,
      page_url: pageUrl,
      matched_row: matchedRow,
      rows,
      screenshot,
    };
    writeJsonFile(path.join(routeDir, "summary.json"), summary);
    return summary;
  } finally {
    await context.close().catch(() => {});
  }
}

async function captureProjectsConnectedIntegrity(browser, config, theme, viewportName, viewport, consoleEvents, networkEvents) {
  const routeDir = path.join(config.reportDir, "projects-connected", theme, viewportName);
  ensureDir(routeDir);
  const context = await browser.newContext({
    viewport,
    screen: viewport,
    hasTouch: viewportName === "mobile",
    isMobile: viewportName === "mobile",
  });
  const page = await context.newPage();
  page.on("console", message => {
    consoleEvents.push({
      route: "projects",
      theme,
      viewport: viewportName,
      type: message.type(),
      text: message.text(),
    });
  });
  page.on("pageerror", error => {
    consoleEvents.push({
      route: "projects",
      theme,
      viewport: viewportName,
      type: "pageerror",
      text: error.message || String(error),
    });
  });
  page.on("response", response => {
    networkEvents.push({
      route: "projects",
      theme,
      viewport: viewportName,
      url: response.url(),
      status: response.status(),
      ok: response.ok(),
    });
  });

  try {
    const routeConfig = ROUTES.find(item => item.route === "projects");
    const pageUrl = buildRouteUrl(config, routeConfig, theme);
    await gotoRouteWithRetry(page, pageUrl, { waitUntil: "domcontentloaded", timeout: config.timeoutMs });
    await waitForSurfaceReady(page, routeConfig, config.apiToken, config.timeoutMs);

    await page.locator('.light-project-row[data-project-id="aurora"]').first().click();
    await waitForRoute(page, "project-detail", config.timeoutMs);
    await waitForProjectConnectedRows(page, config.timeoutMs, ["Note", "Tasks"]);
    const auroraRows = await collectProjectConnectedMetrics(page);
    assert(auroraRows.length > 0, "Projects: expected Project Aurora connected rows to render");
    assert(auroraRows.every(row => row.title !== "Note"), `Projects: unexpected generic Note fallback row ${JSON.stringify(auroraRows)}`);
    assert(auroraRows.every(row => row.title !== "Tasks"), `Projects: unexpected generic Tasks fallback row ${JSON.stringify(auroraRows)}`);
    const auroraCalendarRow = auroraRows.find(row => row.kind === "calendar_event" && row.title === "Aurora roadmap sync");
    assert(auroraCalendarRow, `Projects: expected Project Aurora calendar row to resolve semantically, saw ${JSON.stringify(auroraRows)}`);
    assert(
      auroraCalendarRow.calendarIconColor === CALENDAR_BLUE,
      `Projects: expected calendar rows to keep the semantic calendar accent (saw ${auroraCalendarRow?.calendarIconColor || ""})`
    );
    const auroraDetailScreenshot = await saveScreenshot(page, path.join(routeDir, "project-aurora-detail.png"));
    const auroraConnectedScreenshot = await saveScreenshot(page, path.join(routeDir, "project-aurora-connected.png"));

    await clickProjectConnectedRow(page, "task", "demo-task-soon-roadmap", config.timeoutMs);
    await waitForRoute(page, "task-detail", config.timeoutMs);
    const auroraTaskDetail = await collectDetailIdentity(page);
    assert(
      auroraTaskDetail.taskId === "demo-task-soon-roadmap" || auroraTaskDetail.title === "Prep roadmap review packet",
      `Projects: expected exact linked task detail to open, saw ${JSON.stringify(auroraTaskDetail)}`
    );
    const auroraTaskScreenshot = await saveScreenshot(page, path.join(routeDir, "project-aurora-task-detail.png"));
    await page.evaluate(() => window.PuckyHandleAndroidBack && window.PuckyHandleAndroidBack());
    await waitForRoute(page, "project-detail", config.timeoutMs);

    await clickProjectConnectedRow(page, "note", "linked-note-project-aurora", config.timeoutMs);
    await waitForRoute(page, "note-detail", config.timeoutMs);
    const auroraNoteDetail = await collectDetailIdentity(page);
    assert(
      auroraNoteDetail.title === "Project Aurora",
      `Projects: expected exact linked note detail to open, saw ${JSON.stringify(auroraNoteDetail)}`
    );
    const auroraNoteScreenshot = await saveScreenshot(page, path.join(routeDir, "project-aurora-note-detail.png"));
    await page.evaluate(() => window.PuckyHandleAndroidBack && window.PuckyHandleAndroidBack());
    await waitForRoute(page, "project-detail", config.timeoutMs);
    await page.evaluate(() => window.PuckyHandleAndroidBack && window.PuckyHandleAndroidBack());
    await waitForRoute(page, "projects", config.timeoutMs);

    await page.locator('.light-project-row[data-project-id="home-refresh"]').first().click();
    await waitForRoute(page, "project-detail", config.timeoutMs);
    await waitForProjectConnectedRows(page, config.timeoutMs, ["Note", "Tasks"]);
    const homeRows = await collectProjectConnectedMetrics(page);
    const homeCalendarRow = homeRows.find(row => row.kind === "calendar_event" && row.title === "Front porch repair window");
    assert(homeCalendarRow, `Projects: expected Home refresh calendar row to resolve cleanly, saw ${JSON.stringify(homeRows)}`);
    assert(
      homeCalendarRow.calendarIconColor === CALENDAR_BLUE,
      `Projects: expected Home refresh calendar row to keep the semantic calendar accent (saw ${homeCalendarRow?.calendarIconColor || ""})`
    );
    const homeConnectedScreenshot = await saveScreenshot(page, path.join(routeDir, "home-refresh-connected.png"));

    const summary = {
      route: "projects",
      theme,
      viewport: viewportName,
      screenshots: {
        project_aurora_detail: auroraDetailScreenshot,
        project_aurora_connected: auroraConnectedScreenshot,
        project_aurora_task_detail: auroraTaskScreenshot,
        project_aurora_note_detail: auroraNoteScreenshot,
        home_refresh_connected: homeConnectedScreenshot,
      },
      aurora: {
        connectedRows: auroraRows,
        taskDetail: auroraTaskDetail,
        noteDetail: auroraNoteDetail,
      },
      homeRefresh: {
        connectedRows: homeRows,
      },
    };
    writeJsonFile(path.join(routeDir, "summary.json"), summary);
    return summary;
  } finally {
    await context.close().catch(() => {});
  }
}

async function main() {
  const config = parseArgs(process.argv.slice(2));
  ensureDir(config.reportDir);
  const consoleEvents = [];
  const networkEvents = [];
  let browser = null;
  try {
    const manifestResult = await fetchManifest(config);
    browser = await chromium.launch({
      executablePath: resolveChromePath(),
      headless: config.headless,
    });
    const routeSummaries = {};
    for (const routeConfig of ROUTES) {
      routeSummaries[routeConfig.route] = {};
      for (const theme of routeConfig.themes) {
        routeSummaries[routeConfig.route][theme] = {};
        for (const viewportName of routeConfig.viewportModes) {
          const viewport = viewportName === "desktop" ? DESKTOP_VIEWPORT : MOBILE_VIEWPORT;
          routeSummaries[routeConfig.route][theme][viewportName] = await captureRoute(
            browser,
            config,
            routeConfig,
            theme,
            viewportName,
            viewport,
            consoleEvents,
            networkEvents,
          );
        }
      }
    }
    const calendarConnectedSummaries = {};
    for (const surfaceConfig of CALENDAR_CONNECTED_SURFACES) {
      calendarConnectedSummaries[surfaceConfig.key] = {};
      for (const theme of ["light", "dark"]) {
        calendarConnectedSummaries[surfaceConfig.key][theme] = {};
        for (const viewportName of ["mobile", "desktop"]) {
          const viewport = viewportName === "desktop" ? DESKTOP_VIEWPORT : MOBILE_VIEWPORT;
          calendarConnectedSummaries[surfaceConfig.key][theme][viewportName] = await captureCalendarConnectedSurface(
            browser,
            config,
            surfaceConfig,
            theme,
            viewportName,
            viewport,
            consoleEvents,
            networkEvents,
          );
        }
      }
    }
    const projectsConnectedSummaries = {};
    for (const theme of ["light", "dark"]) {
      projectsConnectedSummaries[theme] = {};
      for (const viewportName of ["mobile", "desktop"]) {
        const viewport = viewportName === "desktop" ? DESKTOP_VIEWPORT : MOBILE_VIEWPORT;
        projectsConnectedSummaries[theme][viewportName] = await captureProjectsConnectedIntegrity(
          browser,
          config,
          theme,
          viewportName,
          viewport,
          consoleEvents,
          networkEvents,
        );
      }
    }
    const summary = {
      schema: RESULT_SCHEMA,
      ok: true,
      base_url: config.baseUrl,
      report_dir: config.reportDir,
      refresh_key: config.refreshKey,
      manifest_url: manifestResult.manifestUrl,
      remote_manifest: manifestResult.manifest,
      routes: routeSummaries,
      calendar_connected_surfaces: calendarConnectedSummaries,
      projects_connected_surfaces: projectsConnectedSummaries,
    };
    writeJsonFile(path.join(config.reportDir, "summary.json"), summary);
    writeJsonFile(path.join(config.reportDir, "console.json"), consoleEvents);
    writeJsonFile(path.join(config.reportDir, "network.json"), networkEvents);
    console.log(JSON.stringify(summary, null, 2));
  } catch (error) {
    writeAutomationError(config.reportDir, error);
    throw error;
  } finally {
    if (browser) {
      await browser.close().catch(() => {});
    }
  }
}

main().catch(error => {
  console.error(error.stack || error.message || String(error));
  process.exitCode = 1;
});
