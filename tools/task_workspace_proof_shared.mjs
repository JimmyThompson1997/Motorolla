import fs from "node:fs";
import path from "node:path";

import {
  attachPageLogging,
  ensureDir,
  saveScreenshot,
  writeJsonFile
} from "./cover_shared.mjs";

export const TASK_PROOF_TARGETS = [
  { kind: "calendar_event", expectedRoute: "meeting-detail", titleKey: "calendarEventTitle" },
  { kind: "contact", expectedRoute: "contact-detail", titleKey: "contactTitle" },
  { kind: "project", expectedRoute: "project-detail", titleKey: "projectTitle" },
  { kind: "note", expectedRoute: "note-detail", titleKey: "noteTitle" },
];

export function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

export function logStep(config, message) {
  const line = `[${new Date().toISOString()}] ${message}`;
  fs.appendFileSync(path.join(config.reportDir, "progress.log"), `${line}\n`, "utf8");
  console.log(line);
}

function slug(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "proof";
}

function compactRunLabel(value) {
  return slug(value).replace(/-/g, "").slice(0, 10) || "proof";
}

function initialChecklist() {
  return [
    { id: "prep-room", label: "Prep the room summary", done: false },
    { id: "send-recap", label: "Send the recap note", done: true },
    { id: "confirm-owner", label: "Confirm the final owner", done: false },
  ];
}

export function buildTaskProofSeed(runId = `task-proof-${Date.now()}`) {
  const runLabel = compactRunLabel(runId);
  const prefix = `task-proof-${runLabel}`;
  const nowMs = Date.now();
  const primaryChecklist = initialChecklist();
  const seed = {
    schema: "pucky.task_workspace_seed_manifest.v1",
    run_id: runId,
    prefix,
    primaryTaskId: `${prefix}-primary`,
    overdueTaskId: `${prefix}-overdue`,
    inProgressTaskId: `${prefix}-in-progress`,
    waitingTaskId: `${prefix}-waiting`,
    doneTaskId: `${prefix}-done`,
    emptyTaskId: `${prefix}-empty`,
    noteId: `${prefix}-note`,
    contactId: `${prefix}-contact`,
    projectId: `${prefix}-project`,
    calendarEventId: `${prefix}-event`,
    linkIds: [
      `${prefix}-task-calendar`,
      `${prefix}-task-contact`,
      `${prefix}-task-project`,
      `${prefix}-task-note`,
    ],
    primaryTaskTitle: `Task Proof Primary ${runLabel}`,
    overdueTaskTitle: `Task Proof Overdue ${runLabel}`,
    inProgressTaskTitle: `Task Proof In Progress ${runLabel}`,
    waitingTaskTitle: `Task Proof Waiting ${runLabel}`,
    doneTaskTitle: `Task Proof Done ${runLabel}`,
    emptyTaskTitle: `Task Proof Empty ${runLabel}`,
    noteTitle: `Task Proof Note ${runLabel}`,
    contactTitle: `Task Proof Contact ${runLabel}`,
    projectTitle: `Task Proof Project ${runLabel}`,
    calendarEventTitle: `Task Proof Event ${runLabel}`,
    primaryDescription: "Structured task detail should show this description without falling back to a generated HTML page.",
    createdBy: `Task Proof Contact ${runLabel}`,
    createdAtMs: nowMs - 2 * 60 * 60 * 1000,
    primaryDueAtMs: nowMs + 2 * 60 * 60 * 1000,
    overdueDueAtMs: nowMs - 90 * 60 * 1000,
    inProgressDueAtMs: nowMs + 3 * 24 * 60 * 60 * 1000,
    waitingDueAtMs: nowMs + 5 * 24 * 60 * 60 * 1000,
    doneDueAtMs: nowMs - 24 * 60 * 60 * 1000,
    primaryChecklist,
    record_ids: {
      tasks: [],
      notes: [],
      contacts: [],
      projects: [],
      "calendar-events": [],
    },
  };
  seed.record_ids.tasks = [
    seed.primaryTaskId,
    seed.overdueTaskId,
    seed.inProgressTaskId,
    seed.waitingTaskId,
    seed.doneTaskId,
    seed.emptyTaskId,
  ];
  seed.record_ids.notes = [seed.noteId];
  seed.record_ids.contacts = [seed.contactId];
  seed.record_ids.projects = [seed.projectId];
  seed.record_ids["calendar-events"] = [seed.calendarEventId];
  return seed;
}

export async function apiRequest(baseUrl, apiToken, method, apiPath, body = undefined) {
  const headers = { Accept: "application/json" };
  if (String(apiToken || "").trim()) {
    headers.Authorization = `Bearer ${String(apiToken || "").trim()}`;
  }
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
  }
  const response = await fetch(`${String(baseUrl || "").replace(/\/+$/, "")}${apiPath}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`${method} ${apiPath} failed (${response.status}): ${JSON.stringify(payload)}`);
  }
  return payload;
}

async function deleteWorkspaceRecord(baseUrl, apiToken, collection, recordId) {
  try {
    await apiRequest(baseUrl, apiToken, "DELETE", `/api/workspace/${collection}/${encodeURIComponent(recordId)}`);
  } catch (error) {
    if (String(error?.message || "").includes("(404)")) {
      return;
    }
    throw error;
  }
}

async function deleteWorkspaceLink(baseUrl, apiToken, linkId) {
  try {
    await apiRequest(baseUrl, apiToken, "DELETE", `/api/workspace/links/${encodeURIComponent(linkId)}`);
  } catch (error) {
    if (String(error?.message || "").includes("(404)")) {
      return;
    }
    throw error;
  }
}

export async function cleanupTaskProofSeed(baseUrl, apiToken, seed) {
  for (const linkId of seed.linkIds || []) {
    await deleteWorkspaceLink(baseUrl, apiToken, linkId);
  }
  for (const [collection, ids] of Object.entries(seed.record_ids || {})) {
    for (const recordId of ids) {
      await deleteWorkspaceRecord(baseUrl, apiToken, collection, recordId);
    }
  }
}

async function createTaskProofRecords(baseUrl, apiToken, seed) {
  await apiRequest(baseUrl, apiToken, "POST", "/api/workspace/contacts", {
    id: seed.contactId,
    title: seed.contactTitle,
    summary: "Proof contact linked from the primary task.",
    metadata: {
      first_name: "Proof",
      last_name: runDisplayToken(seed),
      email: `${seed.prefix}@example.com`,
    },
  });
  await apiRequest(baseUrl, apiToken, "POST", "/api/workspace/projects", {
    id: seed.projectId,
    title: seed.projectTitle,
    summary: "Proof project linked from the primary task.",
    metadata: { threads: ["Task proof review", "Task proof follow-up"] },
  });
  await apiRequest(baseUrl, apiToken, "POST", "/api/workspace/notes", {
    id: seed.noteId,
    title: seed.noteTitle,
    summary: "Proof note linked from the primary task.",
    html: "<!doctype html><html><body><h1>Task proof note</h1><p>This note exists to verify cross-record navigation from a task.</p></body></html>",
  });
  await apiRequest(baseUrl, apiToken, "POST", "/api/workspace/calendar-events", {
    id: seed.calendarEventId,
    title: seed.calendarEventTitle,
    summary: "Proof calendar event linked from the primary task.",
    date: new Date(seed.primaryDueAtMs).toISOString().slice(0, 10),
    start_at_ms: seed.primaryDueAtMs,
    end_at_ms: seed.primaryDueAtMs + 45 * 60 * 1000,
  });

  const commonTask = {
    created_at_ms: seed.createdAtMs,
    created_by: seed.createdBy,
  };
  await apiRequest(baseUrl, apiToken, "POST", "/api/workspace/tasks", {
    id: seed.primaryTaskId,
    title: seed.primaryTaskTitle,
    summary: "",
    status: "todo",
    due_at_ms: seed.primaryDueAtMs,
    description: seed.primaryDescription,
    checklist: seed.primaryChecklist,
    ...commonTask,
  });
  await apiRequest(baseUrl, apiToken, "POST", "/api/workspace/tasks", {
    id: seed.overdueTaskId,
    title: seed.overdueTaskTitle,
    summary: "",
    status: "todo",
    due_at_ms: seed.overdueDueAtMs,
    description: "This overdue proof task confirms overdue stays derived rather than stored as a status.",
    ...commonTask,
  });
  await apiRequest(baseUrl, apiToken, "POST", "/api/workspace/tasks", {
    id: seed.inProgressTaskId,
    title: seed.inProgressTaskTitle,
    summary: "",
    status: "in_progress",
    due_at_ms: seed.inProgressDueAtMs,
    description: "This task starts in progress for filter coverage.",
    ...commonTask,
  });
  await apiRequest(baseUrl, apiToken, "POST", "/api/workspace/tasks", {
    id: seed.waitingTaskId,
    title: seed.waitingTaskTitle,
    summary: "",
    status: "waiting",
    due_at_ms: seed.waitingDueAtMs,
    description: "This task starts waiting with no checklist.",
    ...commonTask,
  });
  await apiRequest(baseUrl, apiToken, "POST", "/api/workspace/tasks", {
    id: seed.doneTaskId,
    title: seed.doneTaskTitle,
    summary: "",
    status: "done",
    due_at_ms: seed.doneDueAtMs,
    description: "This task starts done for filter and bucket coverage.",
    ...commonTask,
  });
  await apiRequest(baseUrl, apiToken, "POST", "/api/workspace/tasks", {
    id: seed.emptyTaskId,
    title: seed.emptyTaskTitle,
    summary: "",
    status: "todo",
    due_at_ms: seed.primaryDueAtMs + 30 * 60 * 1000,
    created_at_ms: seed.createdAtMs,
    created_by: seed.createdBy,
  });

  await apiRequest(baseUrl, apiToken, "POST", "/api/workspace/links", {
    id: seed.linkIds[0],
    source_kind: "task",
    source_id: seed.primaryTaskId,
    target_kind: "calendar_event",
    target_id: seed.calendarEventId,
    label: seed.calendarEventTitle,
  });
  await apiRequest(baseUrl, apiToken, "POST", "/api/workspace/links", {
    id: seed.linkIds[1],
    source_kind: "task",
    source_id: seed.primaryTaskId,
    target_kind: "contact",
    target_id: seed.contactId,
    label: seed.contactTitle,
  });
  await apiRequest(baseUrl, apiToken, "POST", "/api/workspace/links", {
    id: seed.linkIds[2],
    source_kind: "task",
    source_id: seed.primaryTaskId,
    target_kind: "project",
    target_id: seed.projectId,
    label: seed.projectTitle,
  });
  await apiRequest(baseUrl, apiToken, "POST", "/api/workspace/links", {
    id: seed.linkIds[3],
    source_kind: "task",
    source_id: seed.primaryTaskId,
    target_kind: "note",
    target_id: seed.noteId,
    label: seed.noteTitle,
  });
}

function runDisplayToken(seed) {
  return compactRunLabel(seed.run_id || seed.prefix || "proof").toUpperCase();
}

export async function seedTaskProofWorkspace(baseUrl, apiToken, runId, options = {}) {
  const config = {
    cleanupFirst: true,
    reportDir: "",
    ...options,
  };
  const seed = buildTaskProofSeed(runId);
  if (config.cleanupFirst) {
    await cleanupTaskProofSeed(baseUrl, apiToken, seed);
  }
  await createTaskProofRecords(baseUrl, apiToken, seed);
  if (config.reportDir) {
    ensureDir(config.reportDir);
    seed.seed_manifest_path = path.join(config.reportDir, "seed_manifest.json");
    writeJsonFile(seed.seed_manifest_path, seed);
  }
  return seed;
}

export async function fetchTaskRecord(baseUrl, apiToken, taskId) {
  return apiRequest(baseUrl, apiToken, "GET", `/api/workspace/tasks/${encodeURIComponent(taskId)}`);
}

export async function restoreTaskProofSeed(baseUrl, apiToken, seed) {
  await apiRequest(baseUrl, apiToken, "PATCH", `/api/workspace/tasks/${encodeURIComponent(seed.primaryTaskId)}`, {
    status: "todo",
    description: seed.primaryDescription,
    created_by: seed.createdBy,
    checklist: seed.primaryChecklist,
  });
}

export function proofPageUrl(baseUrl, apiToken) {
  const url = new URL(`${String(baseUrl || "").replace(/\/+$/, "")}/ui/pucky/latest/index.html`);
  url.searchParams.set("theme", "light");
  url.searchParams.set("route", "tasks");
  if (String(apiToken || "").trim()) {
    url.searchParams.set("api_token", String(apiToken || "").trim());
  }
  return url.toString();
}

async function stabilizeUrlForReloads(page) {
  await page.evaluate(() => {
    try {
      const url = new URL(window.location.href);
      url.searchParams.delete("route");
      url.searchParams.delete("reset_nav");
      history.replaceState({}, "", url.toString());
    } catch (_error) {
      // Ignore URL normalization failures during proof.
    }
  });
}

async function currentRoute(page) {
  return page.evaluate(() => document.querySelector(".light-shell")?.getAttribute("data-light-route") || "");
}

export async function waitForRoute(page, route, timeoutMs) {
  await page.waitForFunction(
    expectedRoute => document.querySelector(".light-shell")?.getAttribute("data-light-route") === expectedRoute,
    route,
    { timeout: timeoutMs }
  );
}

export async function waitForTaskDetail(page, taskId, timeoutMs) {
  await page.waitForFunction(
    expectedTaskId => document.querySelector(".light-task-detail-surface")?.getAttribute("data-task-detail-id") === expectedTaskId,
    taskId,
    { timeout: timeoutMs }
  );
}

async function waitForTaskStatus(page, status, timeoutMs) {
  await page.waitForFunction(
    expectedStatus => document.querySelector(".light-task-detail-surface")?.getAttribute("data-task-status") === expectedStatus,
    status,
    { timeout: timeoutMs }
  );
}

async function pageTextIncludes(page, text, timeoutMs) {
  await page.waitForFunction(
    expectedText => String(document.body?.textContent || "").includes(expectedText),
    text,
    { timeout: timeoutMs }
  );
}

async function recordViewState(page) {
  return page.evaluate(() => {
    const shell = document.querySelector(".light-shell");
    const detail = document.querySelector(".light-task-detail-surface");
    const sectionTitles = Array.from(document.querySelectorAll(".light-section-title"))
      .map(node => String(node.textContent || "").trim().toLowerCase());
    return {
      route: shell?.getAttribute("data-light-route") || "",
      taskDetailId: detail?.getAttribute("data-task-detail-id") || "",
      taskStatus: detail?.getAttribute("data-task-status") || "",
      hasTaskHtmlFrame: Boolean(detail?.querySelector(".light-html-frame")),
      hasDescriptionSection: sectionTitles.includes("description"),
      hasChecklistSection: sectionTitles.includes("checklist"),
      hasAttachedSection: sectionTitles.includes("attached"),
      createdByInteractive: Boolean(detail?.querySelector('.light-info-row[data-workspace-target-kind="contact"]')),
      attachedChipIconCount: detail?.querySelectorAll(".light-task-chip-cloud .light-record-chip-icon").length || 0,
      statusButtonCount: detail?.querySelectorAll(".light-task-status-control .light-pill").length || 0,
      title: String(document.querySelector(".light-task-detail-title")?.textContent || "").trim(),
    };
  });
}

async function readTaskListSurface(page) {
  return page.evaluate(() => {
    const shell = document.querySelector(".light-shell");
    const sections = Array.from(document.querySelectorAll(".light-task-section-toggle")).map(toggle => {
      const group = String(toggle.dataset.taskSection || "");
      const label = String(toggle.querySelector(".light-task-section-title")?.textContent || "").trim();
      const count = String(toggle.querySelector(".light-task-section-count")?.textContent || "").trim();
      let rowIds = [];
      const card = toggle.nextElementSibling;
      if (card && card.matches(".light-task-group")) {
        rowIds = Array.from(card.querySelectorAll(".light-task-row")).map(row => String(row.dataset.taskId || ""));
      }
      return {
        group,
        label,
        count,
        expanded: String(toggle.getAttribute("aria-expanded") || "") === "true",
        rowIds,
      };
    });
    const filters = Array.from(document.querySelectorAll(".light-task-filter-strip .light-pill")).map(button => ({
      key: String(button.dataset.taskFilter || ""),
      label: String(button.textContent || "").trim(),
      active: button.classList.contains("is-active"),
    }));
    return {
      route: shell?.getAttribute("data-light-route") || "",
      sections,
      filters,
    };
  });
}

async function ensureSectionExpanded(page, group) {
  const toggle = page.locator(`button.light-task-section-toggle[data-task-section="${group}"]`).first();
  if (!(await toggle.count())) {
    return;
  }
  if ((await toggle.getAttribute("aria-expanded")) !== "true") {
    await toggle.click();
  }
}

async function taskRowVisible(page, taskId) {
  return page.locator(`.light-task-row[data-task-id="${taskId}"]`).first().isVisible().catch(() => false);
}

async function revealTaskRow(page, taskId) {
  if (await taskRowVisible(page, taskId)) {
    return;
  }
  for (const group of ["overdue", "do", "soon", "done"]) {
    await ensureSectionExpanded(page, group);
    if (await taskRowVisible(page, taskId)) {
      return;
    }
  }
}

async function taskGroupForRow(page, taskId) {
  return page.evaluate((expectedTaskId) => {
    const toggles = Array.from(document.querySelectorAll("button.light-task-section-toggle"));
    for (const toggle of toggles) {
      const card = toggle.nextElementSibling;
      if (card && card.matches(".light-task-group") && card.querySelector(`.light-task-row[data-task-id="${expectedTaskId}"]`)) {
        return String(toggle.dataset.taskSection || "");
      }
    }
    return "";
  }, taskId);
}

async function goToTasksList(page, mode, timeoutMs) {
  let attempts = 0;
  while ((await currentRoute(page)) !== "tasks" && attempts < 4) {
    const back = page.locator("button.light-back-button").first();
    if (!(await back.count())) {
      break;
    }
    await back.click();
    attempts += 1;
    await page.waitForTimeout(250);
  }
  await waitForRoute(page, "tasks", timeoutMs);
  if (mode === "desktop") {
    await page.locator(".light-task-list-pane, .light-tasks-page").first().waitFor({ state: "visible", timeout: timeoutMs });
  }
}

async function openTask(page, taskId, mode, timeoutMs) {
  if (mode === "mobile") {
    await goToTasksList(page, mode, timeoutMs);
  } else {
    await waitForRoute(page, "tasks", timeoutMs);
  }
  await revealTaskRow(page, taskId);
  const row = page.locator(`.light-task-row[data-task-id="${taskId}"]`).first();
  await row.waitFor({ state: "visible", timeout: timeoutMs });
  await row.click();
  await waitForTaskDetail(page, taskId, timeoutMs);
  if (mode === "mobile") {
    await waitForRoute(page, "task-detail", timeoutMs);
  }
}

async function clickTaskFilter(page, filterKey, timeoutMs) {
  const button = page.locator(`.light-task-filter-strip .light-pill[data-task-filter="${filterKey}"]`).first();
  await button.waitFor({ state: "visible", timeout: timeoutMs });
  await button.click();
  await page.waitForTimeout(150);
}

async function verifyListFilters(page, seed, mode, config, checks) {
  await goToTasksList(page, mode, config.timeoutMs);
  await ensureSectionExpanded(page, "done");
  const listState = await readTaskListSurface(page);
  const labels = listState.sections.map(section => section.label);
  assert(labels.includes("Today"), `${mode}: missing Today task group`);
  assert(labels.includes("Upcoming"), `${mode}: missing Upcoming task group`);
  assert(labels.includes("Overdue"), `${mode}: missing Overdue task group`);
  assert(labels.includes("Done"), `${mode}: missing Done task group`);
  const filterLabels = listState.filters.map(item => item.label);
  for (const label of ["All", "To do", "In progress", "Waiting", "Done"]) {
    assert(filterLabels.includes(label), `${mode}: missing ${label} task filter`);
  }
  checks.push({
    type: "list_surface",
    mode,
    sections: listState.sections,
    filters: listState.filters,
  });
  const filterExpectations = [
    {
      key: "all",
      present: [seed.primaryTaskId, seed.overdueTaskId, seed.inProgressTaskId, seed.waitingTaskId, seed.doneTaskId, seed.emptyTaskId],
      absent: [],
    },
    {
      key: "todo",
      present: [seed.primaryTaskId, seed.overdueTaskId, seed.emptyTaskId],
      absent: [seed.inProgressTaskId, seed.waitingTaskId, seed.doneTaskId],
    },
    {
      key: "in_progress",
      present: [seed.inProgressTaskId],
      absent: [seed.primaryTaskId, seed.overdueTaskId, seed.waitingTaskId, seed.doneTaskId, seed.emptyTaskId],
    },
    {
      key: "waiting",
      present: [seed.waitingTaskId],
      absent: [seed.primaryTaskId, seed.overdueTaskId, seed.inProgressTaskId, seed.doneTaskId, seed.emptyTaskId],
    },
    {
      key: "done",
      present: [seed.doneTaskId],
      absent: [seed.primaryTaskId, seed.overdueTaskId, seed.inProgressTaskId, seed.waitingTaskId, seed.emptyTaskId],
    },
  ];
  for (const expectation of filterExpectations) {
    await clickTaskFilter(page, expectation.key, config.timeoutMs);
    await ensureSectionExpanded(page, "done");
    for (const taskId of expectation.present) {
      await revealTaskRow(page, taskId);
      assert(await taskRowVisible(page, taskId), `${mode}: expected task ${taskId} to be visible under ${expectation.key}`);
    }
    for (const taskId of expectation.absent) {
      assert(!(await taskRowVisible(page, taskId)), `${mode}: expected task ${taskId} to be hidden under ${expectation.key}`);
    }
    checks.push({
      type: "task_filter",
      mode,
      filter: expectation.key,
      present: expectation.present,
      absent: expectation.absent,
    });
  }
  await clickTaskFilter(page, "all", config.timeoutMs);
  await ensureSectionExpanded(page, "done");
}

async function verifyStructuredTaskDetail(page, seed, mode, config, screenshots, checks) {
  await openTask(page, seed.primaryTaskId, mode, config.timeoutMs);
  const state = await recordViewState(page);
  assert(state.taskDetailId === seed.primaryTaskId, `${mode}: wrong primary task detail opened`);
  assert(state.hasTaskHtmlFrame === false, `${mode}: task detail still renders an HTML frame`);
  assert(state.hasDescriptionSection, `${mode}: primary task is missing Description`);
  assert(state.hasChecklistSection, `${mode}: primary task is missing Checklist`);
  assert(state.hasAttachedSection, `${mode}: primary task is missing Attached`);
  assert(state.createdByInteractive, `${mode}: primary task Created by row should open the linked contact`);
  assert(state.attachedChipIconCount >= 4, `${mode}: primary task chips should render icons for linked records`);
  assert(state.statusButtonCount >= 4, `${mode}: primary task is missing status controls`);
  await pageTextIncludes(page, seed.primaryTaskTitle, config.timeoutMs);
  screenshots[`${mode}_task_detail_primary`] = await saveScreenshot(page, config.reportDir, `${mode}-02-task-detail-primary`);
  checks.push({
    type: "structured_primary_detail",
    mode,
    state,
    screenshot: screenshots[`${mode}_task_detail_primary`],
  });

  await openTask(page, seed.emptyTaskId, mode, config.timeoutMs);
  const emptyState = await recordViewState(page);
  assert(emptyState.taskDetailId === seed.emptyTaskId, `${mode}: wrong empty task detail opened`);
  assert(emptyState.hasTaskHtmlFrame === false, `${mode}: empty task detail rendered legacy HTML`);
  assert(emptyState.hasDescriptionSection === false, `${mode}: empty task should not render Description`);
  assert(emptyState.hasChecklistSection === false, `${mode}: empty task should not render Checklist`);
  assert(emptyState.hasAttachedSection === false, `${mode}: empty task should not render Attached`);
  screenshots[`${mode}_task_detail_empty`] = await saveScreenshot(page, config.reportDir, `${mode}-03-task-detail-empty`);
  checks.push({
    type: "empty_detail",
    mode,
    state: emptyState,
    screenshot: screenshots[`${mode}_task_detail_empty`],
  });

  await openTask(page, seed.primaryTaskId, mode, config.timeoutMs);
}

async function verifyCreatedByNavigation(page, seed, mode, config, screenshots, checks) {
  const row = page.locator('.light-task-detail-surface .light-info-row[data-workspace-target-kind="contact"]').first();
  await row.waitFor({ state: "visible", timeout: config.timeoutMs });
  const payload = await row.evaluate(node => ({
    label: String(node.textContent || "").replace(/\s+/g, " ").trim(),
    route: String(node.dataset.workspaceTargetRoute || "").trim(),
    id: String(node.dataset.workspaceTargetId || "").trim(),
    kind: String(node.dataset.workspaceTargetKind || "").trim(),
  }));
  await row.click();
  await waitForRoute(page, "contact-detail", config.timeoutMs);
  await pageTextIncludes(page, seed.contactTitle, config.timeoutMs);
  const openedScreenshot = await saveScreenshot(page, config.reportDir, `${mode}-created-by-opened`);
  await page.locator("button.light-back-button").click();
  await waitForRoute(page, mode === "mobile" ? "task-detail" : "tasks", config.timeoutMs);
  await waitForTaskDetail(page, seed.primaryTaskId, config.timeoutMs);
  const returnedState = await recordViewState(page);
  const returnedScreenshot = await saveScreenshot(page, config.reportDir, `${mode}-created-by-returned`);
  assert(returnedState.taskDetailId === seed.primaryTaskId, `${mode}: Created by back path lost the originating task`);
  checks.push({
    type: "created_by_navigation",
    mode,
    linked_target_kind: payload.kind,
    linked_target_id: payload.id,
    linked_label: payload.label,
    opened_route: "contact-detail",
    returned_route: returnedState.route,
    returned_task_id: returnedState.taskDetailId,
    returned_to_same_task: returnedState.taskDetailId === seed.primaryTaskId,
    screenshots: {
      opened: openedScreenshot,
      returned: returnedScreenshot,
    },
  });
}

async function verifyStatusMutations(page, seed, mode, config, checks) {
  const transitions = [
    { nextStatus: "in_progress", expectedGroup: "do" },
    { nextStatus: "waiting", expectedGroup: "do" },
    { nextStatus: "done", expectedGroup: "done" },
  ];
  for (const transition of transitions) {
    const button = page.locator(`.light-task-status-control .light-pill[data-task-status="${transition.nextStatus}"]`).first();
    await button.waitFor({ state: "visible", timeout: config.timeoutMs });
    await button.click();
    await waitForTaskStatus(page, transition.nextStatus, config.timeoutMs);
    const task = await fetchTaskRecord(config.baseUrl, config.apiToken, seed.primaryTaskId);
    assert(String(task.status || "") === transition.nextStatus, `${mode}: API status did not persist ${transition.nextStatus}`);
    if (mode === "mobile") {
      await page.locator("button.light-back-button").click();
      await waitForRoute(page, "tasks", config.timeoutMs);
      await revealTaskRow(page, seed.primaryTaskId);
      assert((await taskGroupForRow(page, seed.primaryTaskId)) === transition.expectedGroup, `${mode}: task did not move to ${transition.expectedGroup} after ${transition.nextStatus}`);
      await openTask(page, seed.primaryTaskId, mode, config.timeoutMs);
    } else {
      if (transition.expectedGroup === "done") {
        await ensureSectionExpanded(page, "done");
      }
      assert((await taskGroupForRow(page, seed.primaryTaskId)) === transition.expectedGroup, `${mode}: task did not move to ${transition.expectedGroup} after ${transition.nextStatus}`);
    }
    await page.reload({ waitUntil: "domcontentloaded", timeout: config.timeoutMs });
    if (mode === "mobile") {
      await waitForRoute(page, "task-detail", config.timeoutMs);
    } else {
      await waitForRoute(page, "tasks", config.timeoutMs);
    }
    await waitForTaskDetail(page, seed.primaryTaskId, config.timeoutMs);
    await waitForTaskStatus(page, transition.nextStatus, config.timeoutMs);
    checks.push({
      type: "status_transition",
      mode,
      next_status: transition.nextStatus,
      expected_group: transition.expectedGroup,
    });
  }
  const overdueTask = await fetchTaskRecord(config.baseUrl, config.apiToken, seed.overdueTaskId);
  assert(String(overdueTask.status || "") === "todo", `${mode}: overdue proof task stored an unexpected status ${overdueTask.status}`);
}

async function verifyChecklistPersistence(page, seed, mode, config, checks) {
  const items = seed.primaryChecklist.slice(0, 2);
  const expected = new Map(seed.primaryChecklist.map(item => [item.id, Boolean(item.done)]));
  for (const item of items) {
    const row = page.locator(`.light-task-checklist-row[data-checklist-item-id="${item.id}"]`).first();
    await row.waitFor({ state: "visible", timeout: config.timeoutMs });
    await row.click();
    expected.set(item.id, !Boolean(expected.get(item.id)));
    await page.waitForTimeout(150);
  }
  const apiTask = await fetchTaskRecord(config.baseUrl, config.apiToken, seed.primaryTaskId);
  const apiChecklist = Array.isArray(apiTask.checklist) ? apiTask.checklist : [];
  for (const item of items) {
    const apiItem = apiChecklist.find(entry => String(entry.id || "") === item.id);
    assert(Boolean(apiItem?.done) === Boolean(expected.get(item.id)), `${mode}: checklist API state did not persist for ${item.id}`);
  }
  await page.reload({ waitUntil: "domcontentloaded", timeout: config.timeoutMs });
  if (mode === "mobile") {
    await waitForRoute(page, "task-detail", config.timeoutMs);
  } else {
    await waitForRoute(page, "tasks", config.timeoutMs);
  }
  await waitForTaskDetail(page, seed.primaryTaskId, config.timeoutMs);
  for (const item of items) {
    const row = page.locator(`.light-task-checklist-row[data-checklist-item-id="${item.id}"]`).first();
    const className = await row.getAttribute("class");
    assert(String(className || "").includes("is-done") === Boolean(expected.get(item.id)), `${mode}: checklist row did not persist for ${item.id}`);
  }
  checks.push({
    type: "checklist_persistence",
    mode,
    toggled_items: items.map(item => ({ id: item.id, done: expected.get(item.id) })),
  });
}

async function clickChipForKind(page, kind, timeoutMs) {
  const locator = page.locator(`.light-task-chip-cloud [data-workspace-target-kind="${kind}"]`).first();
  await locator.waitFor({ state: "visible", timeout: timeoutMs });
  const payload = await locator.evaluate(node => ({
    label: String(node.textContent || "").replace(/\s+/g, " ").trim(),
    route: String(node.dataset.workspaceTargetRoute || "").trim(),
    id: String(node.dataset.workspaceTargetId || "").trim(),
    kind: String(node.dataset.workspaceTargetKind || "").trim(),
  }));
  await locator.click();
  return payload;
}

async function verifyNavigationLoop(page, seed, mode, config, screenshots, checks) {
  await openTask(page, seed.primaryTaskId, mode, config.timeoutMs);
  for (const target of TASK_PROOF_TARGETS) {
    const chip = await clickChipForKind(page, target.kind, config.timeoutMs);
    assert(chip.route === target.expectedRoute, `${mode}: ${target.kind} chip routed to ${chip.route}, expected ${target.expectedRoute}`);
    await waitForRoute(page, target.expectedRoute, config.timeoutMs);
    await pageTextIncludes(page, seed[target.titleKey], config.timeoutMs);
    const openedRoute = await currentRoute(page);
    const openedScreenshot = await saveScreenshot(page, config.reportDir, `${mode}-${target.kind}-opened`);
    await page.locator("button.light-back-button").click();
    await waitForRoute(page, mode === "mobile" ? "task-detail" : "tasks", config.timeoutMs);
    await waitForTaskDetail(page, seed.primaryTaskId, config.timeoutMs);
    const returnedState = await recordViewState(page);
    const returnedScreenshot = await saveScreenshot(page, config.reportDir, `${mode}-${target.kind}-returned`);
    assert(returnedState.taskDetailId === seed.primaryTaskId, `${mode}: back did not return to the same task after ${target.kind}`);
    checks.push({
      type: "linked_navigation",
      mode,
      linked_target_kind: chip.kind,
      linked_target_id: chip.id,
      linked_label: chip.label,
      opened_route: openedRoute,
      returned_route: returnedState.route,
      returned_task_id: returnedState.taskDetailId,
      returned_to_same_task: returnedState.taskDetailId === seed.primaryTaskId,
      screenshots: {
        opened: openedScreenshot,
        returned: returnedScreenshot,
      },
    });
  }
}

async function verifyReloadStability(page, seed, mode, config, checks) {
  await page.reload({ waitUntil: "domcontentloaded", timeout: config.timeoutMs });
  await waitForRoute(page, mode === "mobile" ? "task-detail" : "tasks", config.timeoutMs);
  await waitForTaskDetail(page, seed.primaryTaskId, config.timeoutMs);
  const detailState = await recordViewState(page);
  assert(detailState.taskDetailId === seed.primaryTaskId, `${mode}: task context failed to survive task-detail reload`);
  checks.push({
    type: "reload_detail_stability",
    mode,
    route: detailState.route,
    task_id: detailState.taskDetailId,
  });

  await goToTasksList(page, mode, config.timeoutMs);
  await page.reload({ waitUntil: "domcontentloaded", timeout: config.timeoutMs });
  await waitForRoute(page, "tasks", config.timeoutMs);
  await revealTaskRow(page, seed.primaryTaskId);
  assert(await taskRowVisible(page, seed.primaryTaskId), `${mode}: task list reload lost the primary task`);
  checks.push({
    type: "reload_list_stability",
    mode,
    route: "tasks",
    task_id: seed.primaryTaskId,
  });
}

function buildTracking(page, consoleLogPath) {
  const consoleErrors = [];
  const pageErrors = [];
  attachPageLogging(page, consoleLogPath);
  page.on("console", message => {
    if (message.type() === "error") {
      consoleErrors.push(message.text());
    }
  });
  page.on("pageerror", error => {
    pageErrors.push(error.message || String(error));
  });
  return { consoleErrors, pageErrors };
}

function seriousConsoleErrors(messages) {
  const patterns = [
    /cannot read/i,
    /undefined/i,
    /null/i,
    /selected/i,
    /linked/i,
    /route/i,
  ];
  return messages.filter(message => patterns.some(pattern => pattern.test(String(message || ""))));
}

export async function runTaskWorkspaceProofMode(browser, config, mode, seed) {
  const viewport = mode === "mobile"
    ? { width: 430, height: 932 }
    : { width: 1400, height: 1000 };
  const context = await browser.newContext({
    viewport,
    screen: viewport,
    hasTouch: mode === "mobile",
    isMobile: mode === "mobile",
  });
  await context.setExtraHTTPHeaders({
    Authorization: `Bearer ${config.apiToken}`,
  });
  await context.addInitScript(() => {
    try {
      if (!sessionStorage.getItem("pucky.task_workspace_proof.nav_reset.v1")) {
        localStorage.removeItem("pucky.cover.nav_state.v1");
        sessionStorage.setItem("pucky.task_workspace_proof.nav_reset.v1", "1");
      }
      localStorage.removeItem("pucky.cover.browser_device_id.v1");
    } catch (_error) {
      // Ignore localStorage bootstrap failures in proof mode.
    }
  });
  await context.addInitScript(apiToken => {
    try {
      localStorage.setItem("pucky.cover.browser_api_token.v1", apiToken);
    } catch (_error) {
      // Ignore localStorage bootstrap failures in proof mode.
    }
  }, config.apiToken);

  const page = await context.newPage();
  const consoleLogPath = path.join(config.reportDir, `${mode}.console.log`);
  const tracking = buildTracking(page, consoleLogPath);
  const pageUrl = proofPageUrl(config.baseUrl, config.apiToken);
  const screenshots = {};
  const checks = [];
  try {
    logStep(config, `${mode}: opening ${pageUrl}`);
    await page.goto(pageUrl, { waitUntil: "domcontentloaded", timeout: config.timeoutMs });
    await waitForRoute(page, "tasks", config.timeoutMs);
    await stabilizeUrlForReloads(page);
    await ensureSectionExpanded(page, "done");
    screenshots[`${mode}_task_list`] = await saveScreenshot(page, config.reportDir, `${mode}-01-task-list`);

    await verifyListFilters(page, seed, mode, config, checks);
    await verifyStructuredTaskDetail(page, seed, mode, config, screenshots, checks);
    await verifyCreatedByNavigation(page, seed, mode, config, screenshots, checks);
    await verifyStatusMutations(page, seed, mode, config, checks);
    await verifyChecklistPersistence(page, seed, mode, config, checks);
    await verifyNavigationLoop(page, seed, mode, config, screenshots, checks);
    await verifyReloadStability(page, seed, mode, config, checks);

    const pageErrors = tracking.pageErrors.slice();
    const badConsole = seriousConsoleErrors(tracking.consoleErrors);
    assert(pageErrors.length === 0, `${mode}: unexpected page errors: ${JSON.stringify(pageErrors)}`);
    assert(badConsole.length === 0, `${mode}: unexpected console errors: ${JSON.stringify(badConsole)}`);

    return {
      mode,
      page_url: pageUrl,
      checks,
      screenshots,
      console_log: consoleLogPath,
      page_errors: pageErrors,
      console_errors: tracking.consoleErrors,
    };
  } finally {
    await context.close().catch(() => {});
  }
}
