(() => {
  const FEED_ICON_EXCLUDES_KEY = "pucky.cover.feed_icon_excludes.v1";
  const HOME_MENU_ICON_LIBRARY_KEY = "pucky.cover.home_menu_icon_library.v1";
  const AUDIO_STATE_KEY = "pucky.cover.audio_state.v1";
  const NAV_STATE_KEY = "pucky.cover.nav_state.v1";
  const READ_OVERRIDES_KEY = "pucky.cover.read_overrides.v1";
  const THEME_STATE_KEY = "pucky.cover.theme.v1";
  const BROWSER_DEVICE_STATE_KEY = "pucky.cover.browser_device_id.v1";
  const CALENDAR_TIMEZONE_STATE_KEY = "pucky.cover.calendar_timezone.v1";
  const SELF_CONTACT_ID = "contact-me";
  const COMPLETE_EPSILON_MS = 500;
  const FEED_SYNC_INTERVAL_MS = 15000;
  const CARD_MENU_CLICK_SUPPRESS_MS = 550;
  const TURN_STATUS_POLL_MS = 250;
  const TURN_STATUS_LIVE_ROUTE_INTERVAL_MS = 1000;
  const TURN_STATUS_IDLE_ROUTE_INTERVAL_MS = 3000;
  const PLAYER_STATE_POLL_INTERVAL_MS = 500;
  const ARCHIVE_REVEAL_WIDTH_PX = 88;
  const ARCHIVE_REVEAL_OPEN_THRESHOLD_PX = 44;
  const ARCHIVE_REVEAL_SLOP_PX = 12;
  const ARCHIVE_REVEAL_DEBUG_STORAGE_KEY = "pucky.cover.archive_reveal_debug.v1";
  const ARCHIVE_REVEAL_DEBUG_TRACE_LIMIT = 160;
  const ARCHIVE_REVEAL_DEBUG_BADGE_RENDERING_ENABLED = false;
  const NOTE_FLASH_DEBUG_TRACE_LIMIT = 256;
  const NOTE_FLASH_DEBUG_FAIL_OPEN_MS = 1500;
  const NOTE_FLASH_DEBUG_REQUIRED_PHASES = Object.freeze([
    "note_row_pointerdown",
    "note_row_click",
    "lightNavigate_start",
    "lightNavigate_state_set",
    "render_start",
    "note_detail_page_created",
    "note_detail_wrapper_created",
    "note_iframe_srcdoc_assigned",
    "note_iframe_load",
    "note_iframe_ready",
    "note_iframe_fail_open",
    "render_end"
  ]);
  const ARCHIVE_REVEAL_CLOSE_REASONS = Object.freeze([
    "threshold_not_met",
    "outside_dismiss",
    "click_capture_close",
    "pointercancel",
    "touchcancel",
    "route_change",
    "busy_archive",
    "unknown"
  ]);
  const MEETING_STATUS_POLL_MS = 1000;
  const MEETING_STATUS_IDLE_ROUTE_INTERVAL_MS = 2000;
  const WORKSPACE_REFRESH_TICK_MS = 1000;
  const REMINDER_LIVE_UI_TICK_MS = 1000;
  const WORKSPACE_TASK_STALE_VISIBLE_MS = 15000;
  const WORKSPACE_REMINDER_STALE_VISIBLE_MS = 15000;
  const CALENDAR_GAP_THRESHOLD_MS = 90 * 60 * 1000;
  const CALENDAR_CLUSTER_WINDOW_MS = 15 * 60 * 1000;
  const CALENDAR_DAY_RAIL_EDGE_THRESHOLD_PX = 180;
  const TURN_UI_TIMELINE_MAX_EVENTS = 64;
  const SETTINGS_SURFACE_RELOAD_KEY = "pucky.cover.settings_surface_reload.v1";
  const DEFAULT_LINKS_API_BASE = "https://pucky.fly.dev";
  const LINKS_NATIVE_CONFIG_READY_TIMEOUT_MS = 2200;
  const LINKS_NATIVE_CONFIG_RETRY_MS = 120;
  const TASK_SPLIT_MIN_WIDTH_PX = 900;
  const MIN_PLAYBACK_SPEED = 0.5;
  const MAX_PLAYBACK_SPEED = 3;
  const SPEED_OPTIONS = [0.75, 1, 1.25, 1.5, 2, 2.5, 3];
  const AUDIO_TILE_PHASES = ["idle", "starting", "playing_confirmed", "pause_pending", "start_failed", "ended_immediately"];
  const AUDIO_PROBE_EVENT_LIMIT = 48;
  const PERF_DEBUG_EVENT_LIMIT = 96;
  const PERF_BRIDGE_CACHE_TTL_MS = 30000;
  const PERF_DEFERRED_TASK_DELAY_MS = 120;
  const PERF_CALENDAR_PRELOAD_DELAY_MS = 180;
  const PERF_BROWSER_SAMPLE_RATE = 0.01;
  const PERF_ANDROID_SAMPLE_RATE = 0.05;
  const AUDIO_START_CONFIRMATION_TIMEOUT_MS = 1800;
  const AUDIO_EARLY_END_WINDOW_MS = 2000;
  const AUDIO_TERMINAL_RESET_MS = 1600;
  const BROWSER_AUDIO_RUNTIME = "browser_native";
  const DOT = " \u00b7 ";
  const CALENDAR_DESCRIPTION_URL_PATTERN = /https?:\/\/[^\s<>"']+/gi;
  let calendarTimeZoneOptionsCache = null;
  const iconCatalog = window.PUCKY_UI_ICONS && typeof window.PUCKY_UI_ICONS === "object"
    ? window.PUCKY_UI_ICONS
    : {};
  const routeCatalog = window.PUCKY_UI_ROUTES && typeof window.PUCKY_UI_ROUTES === "object"
    ? window.PUCKY_UI_ROUTES
    : {};
  const MATERIAL_SYMBOLS = iconCatalog.MATERIAL_SYMBOLS && typeof iconCatalog.MATERIAL_SYMBOLS === "object"
    ? iconCatalog.MATERIAL_SYMBOLS
    : {};
  const SEMANTIC_ICON_REGISTRY = iconCatalog.SEMANTIC_ICON_REGISTRY && typeof iconCatalog.SEMANTIC_ICON_REGISTRY === "object"
    ? iconCatalog.SEMANTIC_ICON_REGISTRY
    : {};
  const SEMANTIC_ICON_KEY_BY_ICON = Object.freeze(Object.entries(SEMANTIC_ICON_REGISTRY).reduce((registry, [semanticKey, entry]) => {
    const icon = String(entry && entry.icon || "").trim().toLowerCase();
    if (icon && MATERIAL_SYMBOLS[icon] && !registry[icon]) {
      registry[icon] = semanticKey;
    }
    return registry;
  }, {}));
  const LIGHT_APPS = Array.isArray(routeCatalog.LIGHT_APPS)
    ? routeCatalog.LIGHT_APPS
    : [];
  const LIGHT_ROUTES = new Set(Array.isArray(routeCatalog.LIGHT_ROUTES)
    ? routeCatalog.LIGHT_ROUTES
    : []);
  const HOME_SHELL_CANONICAL_ROUTES = new Set(Array.isArray(routeCatalog.HOME_SHELL_CANONICAL_ROUTES)
    ? routeCatalog.HOME_SHELL_CANONICAL_ROUTES
    : []);
  const UNIVERSAL_FLAT_FEED_SURFACES = new Set(["notes", "meeting-notes", "reminders", "projects", "inbox", "meetings"]);
  const LIGHT_ROUTE_PARENTS = routeCatalog.LIGHT_ROUTE_PARENTS && typeof routeCatalog.LIGHT_ROUTE_PARENTS === "object"
    ? routeCatalog.LIGHT_ROUTE_PARENTS
    : {};
  const ROUTE_ALIASES = routeCatalog.ROUTE_ALIASES && typeof routeCatalog.ROUTE_ALIASES === "object"
    ? routeCatalog.ROUTE_ALIASES
    : {};
  const WORKSPACE_ROUTE_COLLECTIONS = routeCatalog.WORKSPACE_ROUTE_COLLECTIONS && typeof routeCatalog.WORKSPACE_ROUTE_COLLECTIONS === "object"
    ? routeCatalog.WORKSPACE_ROUTE_COLLECTIONS
    : {};
  const WORKSPACE_COLLECTION_LABELS = routeCatalog.WORKSPACE_COLLECTION_LABELS && typeof routeCatalog.WORKSPACE_COLLECTION_LABELS === "object"
    ? routeCatalog.WORKSPACE_COLLECTION_LABELS
    : {};
  const WORKSPACE_KIND_COLLECTIONS = routeCatalog.WORKSPACE_KIND_COLLECTIONS && typeof routeCatalog.WORKSPACE_KIND_COLLECTIONS === "object"
    ? routeCatalog.WORKSPACE_KIND_COLLECTIONS
    : {};

  const DEFAULT_HOME_MENU_ICONS = Array.isArray(routeCatalog.DEFAULT_HOME_MENU_ICONS)
    ? routeCatalog.DEFAULT_HOME_MENU_ICONS
    : [];

  const TURN_REPLY_MODES = ["card_only", "card_and_spoken"];
  const TURN_ARRIVAL_CUE_MODES = ["none", "haptic", "chime", "haptic_and_chime"];
  const TURN_MODEL_OPTIONS = ["gpt-5.4", "gpt-5.4-mini", "gpt-5.4-nano"];
  const TURN_REASONING_EFFORT_OPTIONS = ["none", "low", "medium", "high", "xhigh"];
  const DEFAULT_TURN_MODEL = "gpt-5.4-mini";
  const DEFAULT_TURN_REASONING_EFFORT = "low";
  const LINKS_BROWSER_HANDOFF_LOCK_MS = 2200;
  const LINKS_ROW_HEIGHT = 62;
  const LIGHT_ROUTE_HISTORY_LIMIT = 12;
  const LIGHT_HISTORY_SELECTED_KEYS = [
    "selectedContactId",
    "selectedMeetingId",
    "selectedMeetingNoteId",
    "selectedReminderId",
    "selectedNoteId",
    "selectedTaskId",
    "selectedProjectId",
    "selectedFeedId"
  ];
  let nativeProtectedAuthorization = "";
  const LINKS_AUTH_SCHEME_LABELS = {
    OAUTH2: "OAuth",
    API_KEY: "API key",
    BASIC: "Basic",
    BEARER_TOKEN: "Token",
    NO_AUTH: "No auth"
  };

  const noteFlashDebugDefaults = resolveNoteFlashDebugDefaults();
  const initialTheme = resolveInitialTheme();
  const persistedAudioState = loadAudioState();
  const persistedNavState = loadNavState();
  const initialCalendarTimeZonePreference = resolveCalendarTimezonePreference();
  const initialRouteValue = initialRoute(persistedNavState.route, initialTheme);
  const initialTaskSectionsExpandedValue = initialTaskSectionsExpanded(persistedNavState.task_sections_expanded);
  const state = {
    cards: [],
    cardIconRegistry: {},
    cardIconRegistryLoading: false,
    cardIconRegistryRequestedAt: 0,
    theme: initialTheme,
    route: initialRouteValue,
    lightReturnRoute: "",
    previousLightRoute: "home",
    lightRouteHistory: normalizeLightRouteHistory(persistedNavState.light_history),
    selectedContactId: String(persistedNavState.selected_contact_id || persistedNavState.selectedContactId || "").trim() || "sarah",
    selectedMeetingId: "vendor",
    selectedMeetingNoteId: "demo-meeting-home-refresh",
    selectedReminderId: "demo-reminder-paint-samples",
    selectedNoteId: "q4",
    selectedTaskId: String(persistedNavState.selected_task_id || "").trim() || "demo-task-do-paint-samples",
    selectedProjectId: String(persistedNavState.selected_project_id || persistedNavState.selected_tag_id || "").trim() || "aurora",
    selectedFeedId: "maya-budget",
    selectedCalendarDate: calendarTodayDateKey(resolveCalendarTimeZone(initialCalendarTimeZonePreference)),
    calendarDayRailStartMonth: "",
    calendarDayRailEndMonth: "",
    calendarTimeZone: initialCalendarTimeZonePreference,
    taskSectionsExpanded: initialTaskSectionsExpandedValue,
    taskMutationPending: {},
    taskSelectionMode: false,
    selectedTaskIds: new Set(),
    taskBulkArchivePending: false,
    reminderMutationPending: {},
    notesSectionsExpanded: { pinned: true, recent: true },
    notePinPending: {},
    taskNavOrigin: null,
    detailNavOrigin: null,
    reminderHistoryExpanded: false,
    meetingDetailSections: null,
    meetingDetailSectionCache: {},
    workspace: {
      notes: initialWorkspaceBucketState(),
      tasks: initialWorkspaceBucketState(),
      "calendar-events": initialWorkspaceBucketState(),
      "feed-items": initialWorkspaceBucketState(),
      projects: initialWorkspaceBucketState(),
      contacts: initialWorkspaceBucketState(),
      messages: initialWorkspaceBucketState(),
      "meeting-notes": initialWorkspaceBucketState(),
      reminders: initialWorkspaceBucketState()
    },
    feedScrollTop: scrollNumber(persistedNavState.feed_scroll_top),
    navDetail: normalizeNavDetail(persistedNavState.detail),
    navRestored: false,
    excludedFeedIcons: loadFeedIconExcludes(),
    homeMenuIconLibrary: loadHomeMenuIconLibrary(),
    readOverrides: loadReadOverrides(),
    turn: initialTurnStatus(),
    threadScope: initialThreadScope(),
    turnSettings: initialTurnSettings(),
    wakeStatus: initialWakeStatus(),
    uiSurface: initialUiSurfaceStatus(),
    phoneRole: initialPhoneRoleStatus(),
    activePath: "",
    player: { loaded: false, is_playing: false, position_ms: 0, duration_ms: 0, speed: 1, observed_at_ms: 0 },
    audioProbe: initialAudioProbeStatus(),
    lastToast: { message: "", shown_at: "" },
    defaultAudioSpeed: 1,
    defaultAudioSpeedAvailable: false,
    savedPositions: numberMapFromObject(persistedAudioState.positions),
    completedPaths: new Set(Array.isArray(persistedAudioState.completed) ? persistedAudioState.completed : []),
    speedByPath: numberMapFromObject(persistedAudioState.speeds),
    selectedTimestampByPath: stringMapFromObject(persistedAudioState.selected_timestamps),
    scrubPreviewByPath: new Map(),
    scrubbingAudioKey: "",
    audioToggleBusyKey: "",
    timestampTap: null,
    audioCard: null,
    traceCard: null,
    metaCard: null,
    feedLoadError: "",
    feedSource: "",
    feedLastAppliedAt: 0,
    vmFeedSnapshotPromise: null,
    showArchivedFeed: false,
    inboxManageMode: false,
    inboxArchiveFilterPendingTarget: null,
    selectedInboxCardKeys: new Set(),
    lastInboxManageResult: {
      action: "",
      ok: true,
      count: 0,
      error: ""
    },
    openCardMenuSessionId: "",
    openCardMenuThreadId: "",
    cardMenuClickSuppressUntil: 0,
    turnUiEvents: [],
    lastRenderedTurnVisualState: "",
    lastRenderedTurnId: "",
    waveHistory: new Map(),
    contacts: {
      search: "",
      editDraft: null,
      editSaving: false,
      editQueued: false,
      editStatus: "idle",
      editError: "",
    },
    links: initialLinksState(),
    meetings: initialMeetingsState(),
    meetingRecording: initialMeetingRecordingStatus(),
    drag: null
  };

  ensureStoredHomeMenuIcons();

  const pending = new Map();
  const bridgeReadCache = new Map();
  const deferredPerfTasks = new Map();
  let seq = 0;
  let feedSyncIntervalId = 0;
  let audioProbeResetTimerId = 0;
  let sharedBrowserAudio = null;
  let activeArchiveReveal = null;
  let archiveRevealGestureSeq = 0;
  let scheduledRenderToken = 0;
  let lastTurnStatusPollAt = 0;
  let lastPlayerStatePollAt = 0;
  let lastWakeStatusPollAt = 0;
  let lastMeetingStatusPollAt = 0;
  let perfTelemetryInFlight = 0;
  const archiveRevealDebugTrace = [];
  const archiveRevealDebugState = {
    enabled: archiveRevealDebugEnabled(),
    phase: "",
    source: "",
    offset: 0,
    horizontal: false,
    gesture_id: "",
    item_id: "",
    wrapper_class: "",
    close_reason: "",
    context: "",
    trace_count: 0
  };
  const noteFlashDebugTrace = [];
  const noteFlashDebugState = {
    enabled: Boolean(noteFlashDebugDefaults.enabled),
    route_delay_ms: noteFlashDebugDefaults.route_delay_ms,
    iframe_delay_ms: noteFlashDebugDefaults.iframe_delay_ms,
    fail_open_ms: NOTE_FLASH_DEBUG_FAIL_OPEN_MS,
    phase: "",
    route: "",
    theme: initialTheme,
    selected_note_id: "",
    previous_route: "",
    wrapper_state: "",
    iframe_visibility: "",
    shell_surface: "",
    detail_surface: "",
    note_surface: "",
    reason: "",
    trace_count: 0
  };
  const perfDebugState = initialPerfDebugState(initialRouteValue);
  window.__puckyArchiveRevealDebug = {
    schema: "pucky.archive_reveal_debug.v1",
    push(entry) {
      return archiveRevealDebugRecord(entry);
    },
    getTrace() {
      return archiveRevealDebugTrace.slice();
    },
    clearTrace() {
      archiveRevealDebugTrace.length = 0;
      archiveRevealDebugState.phase = "";
      archiveRevealDebugState.source = "";
      archiveRevealDebugState.offset = 0;
      archiveRevealDebugState.horizontal = false;
      archiveRevealDebugState.gesture_id = "";
      archiveRevealDebugState.item_id = "";
      archiveRevealDebugState.wrapper_class = "";
      archiveRevealDebugState.close_reason = "";
      archiveRevealDebugState.context = "";
      archiveRevealDebugState.trace_count = 0;
      syncArchiveRevealDebugBadge();
      return true;
    },
    getState() {
      return {
        ...archiveRevealDebugState,
        close_reasons: ARCHIVE_REVEAL_CLOSE_REASONS.slice()
      };
    },
    setEnabled(enabled) {
      archiveRevealDebugState.enabled = Boolean(enabled);
      try {
        if (archiveRevealDebugState.enabled) {
          localStorage.setItem(ARCHIVE_REVEAL_DEBUG_STORAGE_KEY, "1");
        } else {
          localStorage.removeItem(ARCHIVE_REVEAL_DEBUG_STORAGE_KEY);
        }
      } catch (_) {
        // Ignore localStorage failures in WebView preview and private mode.
      }
      syncArchiveRevealDebugBadge();
      return archiveRevealDebugState.enabled;
    }
  };
  window.__puckyNoteFlashDebug = {
    schema: "pucky.note_flash_debug.v1",
    getTrace() {
      return noteFlashDebugTrace.slice();
    },
    clearTrace() {
      noteFlashDebugTrace.length = 0;
      noteFlashDebugState.phase = "";
      noteFlashDebugState.route = "";
      noteFlashDebugState.selected_note_id = "";
      noteFlashDebugState.previous_route = "";
      noteFlashDebugState.wrapper_state = "";
      noteFlashDebugState.iframe_visibility = "";
      noteFlashDebugState.shell_surface = "";
      noteFlashDebugState.detail_surface = "";
      noteFlashDebugState.note_surface = "";
      noteFlashDebugState.reason = "";
      noteFlashDebugState.trace_count = 0;
      return true;
    },
    getState() {
      return noteFlashDebugSnapshot();
    }
  };
  window.__PUCKY_PERF_DEBUG__ = {
    schema: "pucky.perf_debug.v1",
    getState() {
      return perfDebugMetrics();
    },
    clear() {
      clearPerfDebugState();
      return perfDebugMetrics();
    }
  };

  function archiveRevealDebugEnabled() {
    try {
      const params = new URLSearchParams(window.location.search || "");
      if (params.get("debug_archive_reveal") === "1") {
        return true;
      }
    } catch (_) {
      // Ignore malformed URLs in fallback previews.
    }
    try {
      return localStorage.getItem(ARCHIVE_REVEAL_DEBUG_STORAGE_KEY) === "1";
    } catch (_) {
      return false;
    }
  }

  function archiveRevealDebugItemId(item, wrapper = null) {
    const meetingId = String(item && item.meeting_id || "").trim();
    if (meetingId) {
      return `meeting:${meetingId}`;
    }
    const sessionId = cardSessionId(item);
    if (sessionId) {
      return `session:${sessionId}`;
    }
    const cardId = String(item && item.card_id || "").trim();
    if (cardId) {
      return `card:${cardId}`;
    }
    const node = wrapper instanceof Element
      ? wrapper.querySelector("[data-card-session-id], [data-card-id]")
      : null;
    if (node instanceof Element) {
      const wrapperSessionId = String(node.getAttribute("data-card-session-id") || "").trim();
      if (wrapperSessionId) {
        return `session:${wrapperSessionId}`;
      }
      const wrapperCardId = String(node.getAttribute("data-card-id") || "").trim();
      if (wrapperCardId) {
        return `card:${wrapperCardId}`;
      }
    }
    return "";
  }

  function archiveRevealDebugOffset(wrapper = null) {
    if (!(wrapper instanceof Element)) {
      return 0;
    }
    const parsed = parseFloat(wrapper.style.getPropertyValue("--archive-reveal-offset") || "0");
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function archiveRevealDebugCloseReason(reason) {
    const value = String(reason || "").trim();
    return ARCHIVE_REVEAL_CLOSE_REASONS.includes(value) ? value : "unknown";
  }

  function nextArchiveRevealGestureId() {
    archiveRevealGestureSeq += 1;
    return `archive_reveal_${archiveRevealGestureSeq}`;
  }

  function syncArchiveRevealDebugBadge() {
    const badgeId = "archiveRevealDebugBadge";
    const existing = document.getElementById(badgeId);
    if (!ARCHIVE_REVEAL_DEBUG_BADGE_RENDERING_ENABLED || !archiveRevealDebugState.enabled) {
      existing?.remove();
      return;
    }
    if (!document.body) {
      return;
    }
    const badge = existing || (() => {
      const node = document.createElement("div");
      node.id = badgeId;
      node.className = "archive-reveal-debug-badge";
      document.body.append(node);
      return node;
    })();
    const source = archiveRevealDebugState.source || "-";
    const phase = archiveRevealDebugState.phase || "-";
    const reason = archiveRevealDebugState.close_reason || "-";
    const offset = Math.round(Number(archiveRevealDebugState.offset || 0));
    badge.textContent = `${source} ${offset}px ${phase}\n${reason}`;
  }

  function archiveRevealDebugRecord(entry = {}) {
    const payload = entry && typeof entry === "object" ? entry : {};
    const wrapper = payload.wrapper instanceof Element ? payload.wrapper : null;
    const hasCloseReason = Object.prototype.hasOwnProperty.call(payload, "close_reason")
      && String(payload.close_reason || "").trim();
    const next = {
      schema: "pucky.archive_reveal_debug_entry.v1",
      seq: archiveRevealDebugTrace.length + 1,
      timestamp: new Date().toISOString(),
      gesture_id: String(payload.gesture_id || "").trim(),
      item_id: String(payload.item_id || archiveRevealDebugItemId(null, wrapper)).trim(),
      source: String(payload.source || "").trim(),
      scope: String(payload.scope || "archive_reveal").trim(),
      phase: String(payload.phase || "").trim(),
      offset: Number.isFinite(Number(payload.offset)) ? Number(payload.offset) : archiveRevealDebugOffset(wrapper),
      horizontal: Boolean(payload.horizontal),
      wrapper_class: String(payload.wrapper_class || (wrapper ? wrapper.className : "")).trim(),
      close_reason: hasCloseReason ? archiveRevealDebugCloseReason(payload.close_reason) : "",
      context: String(payload.context || "").trim()
    };
    archiveRevealDebugTrace.push(next);
    if (archiveRevealDebugTrace.length > ARCHIVE_REVEAL_DEBUG_TRACE_LIMIT) {
      archiveRevealDebugTrace.splice(0, archiveRevealDebugTrace.length - ARCHIVE_REVEAL_DEBUG_TRACE_LIMIT);
    }
    archiveRevealDebugState.phase = next.phase;
    archiveRevealDebugState.source = next.source;
    archiveRevealDebugState.offset = next.offset;
    archiveRevealDebugState.horizontal = next.horizontal;
    archiveRevealDebugState.gesture_id = next.gesture_id;
    archiveRevealDebugState.item_id = next.item_id;
    archiveRevealDebugState.wrapper_class = next.wrapper_class;
    if (next.close_reason) {
      archiveRevealDebugState.close_reason = next.close_reason;
    }
    archiveRevealDebugState.context = next.context;
    archiveRevealDebugState.trace_count = archiveRevealDebugTrace.length;
    syncArchiveRevealDebugBadge();
    return next;
  }

  function noteFlashDebugEnabled() {
    return Boolean(noteFlashDebugState.enabled);
  }

  function noteFlashDebugRouteDelayMs() {
    return Math.max(0, Number(noteFlashDebugState.route_delay_ms || 0));
  }

  function noteFlashDebugIframeDelayMs() {
    return Math.max(0, Number(noteFlashDebugState.iframe_delay_ms || 0));
  }

  function noteFlashDebugComputedValue(node, propertyName) {
    if (!(node instanceof Element)) {
      return "";
    }
    try {
      return String(window.getComputedStyle(node).getPropertyValue(propertyName) || "").trim();
    } catch (_) {
      return "";
    }
  }

  function noteFlashDebugBackground(node) {
    return noteFlashDebugComputedValue(node, "background-color");
  }

  function noteFlashDebugSnapshot(overrides = {}) {
    const shell = document.querySelector(".app-shell");
    const detail = document.querySelector(".light-note-detail-page");
    const wrapper = detail?.querySelector(".light-detail-html-body");
    const frame = wrapper?.querySelector(".light-html-frame");
    let frameBodyBackground = "";
    try {
      frameBodyBackground = frame?.contentDocument?.body ? noteFlashDebugBackground(frame.contentDocument.body) : "";
    } catch (_) {
      frameBodyBackground = "";
    }
    const noteSurface = String(
      overrides.note_surface
      || frameBodyBackground
      || noteFlashDebugBackground(frame)
      || noteFlashDebugBackground(wrapper)
      || noteFlashDebugBackground(detail)
      || ""
    ).trim();
    return {
      schema: "pucky.note_flash_debug.v1",
      enabled: Boolean(noteFlashDebugState.enabled),
      route_delay_ms: noteFlashDebugRouteDelayMs(),
      iframe_delay_ms: noteFlashDebugIframeDelayMs(),
      fail_open_ms: NOTE_FLASH_DEBUG_FAIL_OPEN_MS,
      phase: String(overrides.phase || noteFlashDebugState.phase || "").trim(),
      route: String(overrides.route || state.route || "").trim(),
      theme: String(overrides.theme || state.theme || "").trim(),
      selected_note_id: String(overrides.selected_note_id || state.selectedNoteId || "").trim(),
      previous_route: String(overrides.previous_route || state.previousLightRoute || "").trim(),
      wrapper_state: String(overrides.wrapper_state || wrapper?.getAttribute("data-html-frame-state") || "").trim(),
      iframe_visibility: String(overrides.iframe_visibility || (frame ? noteFlashDebugComputedValue(frame, "visibility") : "") || "").trim(),
      shell_surface: String(overrides.shell_surface || noteFlashDebugBackground(shell) || "").trim(),
      detail_surface: String(overrides.detail_surface || noteFlashDebugBackground(detail) || "").trim(),
      note_surface: noteSurface,
      reason: String(overrides.reason || noteFlashDebugState.reason || "").trim(),
      trace_count: noteFlashDebugTrace.length,
      required_phases: NOTE_FLASH_DEBUG_REQUIRED_PHASES.slice()
    };
  }

  function noteFlashDebugRecord(phase, entry = {}) {
    if (!noteFlashDebugEnabled()) {
      return null;
    }
    const snapshot = noteFlashDebugSnapshot({ ...entry, phase });
    const next = {
      schema: "pucky.note_flash_debug_entry.v1",
      seq: noteFlashDebugTrace.length + 1,
      ts_ms: Date.now(),
      phase: snapshot.phase,
      route: snapshot.route,
      theme: snapshot.theme,
      selected_note_id: snapshot.selected_note_id,
      previous_route: snapshot.previous_route,
      wrapper_state: snapshot.wrapper_state,
      iframe_visibility: snapshot.iframe_visibility,
      shell_surface: snapshot.shell_surface,
      detail_surface: snapshot.detail_surface,
      note_surface: snapshot.note_surface,
      reason: snapshot.reason
    };
    noteFlashDebugTrace.push(next);
    if (noteFlashDebugTrace.length > NOTE_FLASH_DEBUG_TRACE_LIMIT) {
      noteFlashDebugTrace.splice(0, noteFlashDebugTrace.length - NOTE_FLASH_DEBUG_TRACE_LIMIT);
    }
    noteFlashDebugState.phase = next.phase;
    noteFlashDebugState.route = next.route;
    noteFlashDebugState.theme = next.theme;
    noteFlashDebugState.selected_note_id = next.selected_note_id;
    noteFlashDebugState.previous_route = next.previous_route;
    noteFlashDebugState.wrapper_state = next.wrapper_state;
    noteFlashDebugState.iframe_visibility = next.iframe_visibility;
    noteFlashDebugState.shell_surface = next.shell_surface;
    noteFlashDebugState.detail_surface = next.detail_surface;
    noteFlashDebugState.note_surface = next.note_surface;
    noteFlashDebugState.reason = next.reason;
    noteFlashDebugState.trace_count = noteFlashDebugTrace.length;
    return next;
  }

  function perfDebugEnabled() {
    try {
      const params = new URLSearchParams(window.location.search || "");
      return params.get("debug_perf") === "1";
    } catch (_) {
      return false;
    }
  }

  function initialWorkspaceBucketState() {
    return {
      items: [],
      loaded: false,
      loading: false,
      error: "",
      dirty: false,
      lastRefreshAt: 0,
      fingerprint: "",
      queryKey: "",
      queryCache: {},
      recordCache: {},
      recordLoading: {}
    };
  }

  function perfDebugSessionId() {
    try {
      if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
        return crypto.randomUUID();
      }
    } catch (_) {
      // Ignore crypto unavailability in previews.
    }
    return `perf-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
  }

  function resolvePerfRunId() {
    try {
      const params = new URLSearchParams(window.location.search || "");
      return String(params.get("perf_run_id") || params.get("debug_perf_run_id") || "").trim();
    } catch (_) {
      return "";
    }
  }

  function perfSurfaceName() {
    if (window.PuckyAndroid && typeof window.PuckyAndroid.postMessage === "function") {
      return "android_webview";
    }
    return /^https?:/i.test(String(window.location && window.location.protocol || "")) ? "hosted_browser" : "browser_preview";
  }

  function perfDeviceClass() {
    if (window.PuckyAndroid && typeof window.PuckyAndroid.postMessage === "function") {
      return "android_webview";
    }
    const width = Math.max(0, Number(window.innerWidth || 0));
    return width && width <= 700 ? "mobile_browser" : "desktop_browser";
  }

  function perfTelemetrySampleReason() {
    if (perfDebugEnabled()) {
      return "debug_perf";
    }
    const rate = window.PuckyAndroid && typeof window.PuckyAndroid.postMessage === "function"
      ? PERF_ANDROID_SAMPLE_RATE
      : PERF_BROWSER_SAMPLE_RATE;
    return Math.random() < rate
      ? (window.PuckyAndroid && typeof window.PuckyAndroid.postMessage === "function" ? "android_sampled" : "browser_sampled")
      : "";
  }

  function initialPerfDebugState(initialRoute = "") {
    const now = Date.now();
    const sampleReason = perfTelemetrySampleReason();
    return {
      enabled: perfDebugEnabled() || Boolean(sampleReason),
      session_id: perfDebugSessionId(),
      run_id: resolvePerfRunId(),
      sample_reason: sampleReason,
      surface: perfSurfaceName(),
      device_class: perfDeviceClass(),
      boot_phase: "booting",
      route: String(initialRoute || "home").trim() || "home",
      route_sequence: 1,
      route_started_at_ms: now,
      route_enter_at_ms: now,
      route_data_start_at_ms: 0,
      route_data_end_at_ms: 0,
      route_ready: false,
      route_ready_reason: "",
      route_ready_at_ms: 0,
      route_perf_sent: false,
      render_count: 0,
      last_render_ms: 0,
      bridge_total_ms: 0,
      shell_launch_elapsed_ms: 0,
      webview_load_elapsed_ms: 0,
      asset_delivery_failures: 0,
      hosted_reload_attempts: 0,
      bootstrap_snapshot_used: false,
      bridge_calls_by_command: {},
      fetches_by_key: {},
      poll_ticks_by_lane: {},
      cache_hits_by_key: {},
      deferred_tasks_started: 0,
      deferred_tasks_completed: 0,
      unchanged_refresh_skips: 0,
      recent_events: []
    };
  }

  function perfDebugPushEvent(type, detail = {}) {
    if (!perfDebugState.enabled) {
      return;
    }
    const entry = {
      type: String(type || "").trim(),
      route: String(state.route || perfDebugState.route || "home").trim() || "home",
      ts_ms: Date.now(),
      detail: detail && typeof detail === "object" ? { ...detail } : { value: detail }
    };
    perfDebugState.recent_events.push(entry);
    if (perfDebugState.recent_events.length > PERF_DEBUG_EVENT_LIMIT) {
      perfDebugState.recent_events.splice(0, perfDebugState.recent_events.length - PERF_DEBUG_EVENT_LIMIT);
    }
  }

  function perfDebugIncrementCounter(storeKey, counterKey, amount = 1) {
    if (!perfDebugState.enabled) {
      return;
    }
    const store = perfDebugState[storeKey] && typeof perfDebugState[storeKey] === "object"
      ? perfDebugState[storeKey]
      : {};
    const key = String(counterKey || "").trim();
    if (!key) {
      return;
    }
    store[key] = safeNumber(store[key]) + Math.max(1, safeNumber(amount, 1));
    perfDebugState[storeKey] = store;
  }

  function clearPerfDebugState() {
    const next = initialPerfDebugState(state.route);
    perfDebugState.enabled = next.enabled;
    perfDebugState.session_id = next.session_id;
    perfDebugState.run_id = next.run_id;
    perfDebugState.sample_reason = next.sample_reason;
    perfDebugState.surface = next.surface;
    perfDebugState.device_class = next.device_class;
    perfDebugState.boot_phase = next.boot_phase;
    perfDebugState.route = next.route;
    perfDebugState.route_sequence = next.route_sequence;
    perfDebugState.route_started_at_ms = next.route_started_at_ms;
    perfDebugState.route_enter_at_ms = next.route_enter_at_ms;
    perfDebugState.route_data_start_at_ms = next.route_data_start_at_ms;
    perfDebugState.route_data_end_at_ms = next.route_data_end_at_ms;
    perfDebugState.route_ready = next.route_ready;
    perfDebugState.route_ready_reason = next.route_ready_reason;
    perfDebugState.route_ready_at_ms = next.route_ready_at_ms;
    perfDebugState.route_perf_sent = next.route_perf_sent;
    perfDebugState.render_count = next.render_count;
    perfDebugState.last_render_ms = next.last_render_ms;
    perfDebugState.bridge_total_ms = next.bridge_total_ms;
    perfDebugState.shell_launch_elapsed_ms = next.shell_launch_elapsed_ms;
    perfDebugState.webview_load_elapsed_ms = next.webview_load_elapsed_ms;
    perfDebugState.asset_delivery_failures = next.asset_delivery_failures;
    perfDebugState.hosted_reload_attempts = next.hosted_reload_attempts;
    perfDebugState.bootstrap_snapshot_used = next.bootstrap_snapshot_used;
    perfDebugState.bridge_calls_by_command = {};
    perfDebugState.fetches_by_key = {};
    perfDebugState.poll_ticks_by_lane = {};
    perfDebugState.cache_hits_by_key = {};
    perfDebugState.deferred_tasks_started = 0;
    perfDebugState.deferred_tasks_completed = 0;
    perfDebugState.unchanged_refresh_skips = 0;
    perfDebugState.recent_events = [];
    perfDebugPushEvent("perf_debug_cleared", {});
    syncPerfDebugState("perf_debug_cleared");
  }

  function setPerfBootPhase(phase) {
    if (!perfDebugState.enabled) {
      return;
    }
    const nextPhase = String(phase || "").trim();
    if (!nextPhase || perfDebugState.boot_phase === nextPhase) {
      return;
    }
    perfDebugState.boot_phase = nextPhase;
    perfDebugPushEvent("boot_phase", { phase: nextPhase });
  }

  function recordPerfRouteDataStart(label) {
    if (!perfDebugState.enabled) {
      return;
    }
    if (!safeNumber(perfDebugState.route_data_start_at_ms)) {
      perfDebugState.route_data_start_at_ms = Date.now();
    }
    perfDebugPushEvent("route_data_start", { label: String(label || "").trim() || "unknown" });
  }

  function recordPerfRouteDataEnd(label) {
    if (!perfDebugState.enabled) {
      return;
    }
    perfDebugState.route_data_end_at_ms = Date.now();
    perfDebugPushEvent("route_data_end", { label: String(label || "").trim() || "unknown" });
  }

  function recordPerfCacheHit(key) {
    perfDebugIncrementCounter("cache_hits_by_key", key);
  }

  function recordPerfUnchangedRefreshSkip(key) {
    if (!perfDebugState.enabled) {
      return;
    }
    perfDebugState.unchanged_refresh_skips = safeNumber(perfDebugState.unchanged_refresh_skips) + 1;
    perfDebugPushEvent("unchanged_refresh_skip", { key: String(key || "").trim() || "unknown" });
  }

  function queueDeferredPerfTask(name, work, options = {}) {
    const taskName = String(name || "").trim();
    if (!taskName || typeof work !== "function") {
      return false;
    }
    if (deferredPerfTasks.has(taskName)) {
      return false;
    }
    const delayMs = Math.max(0, safeNumber(options.delayMs, PERF_DEFERRED_TASK_DELAY_MS));
    const token = setTimeout(async () => {
      deferredPerfTasks.delete(taskName);
      if (perfDebugState.enabled) {
        perfDebugState.deferred_tasks_started = safeNumber(perfDebugState.deferred_tasks_started) + 1;
        perfDebugPushEvent("deferred_task_start", { name: taskName });
      }
      try {
        await work();
      } catch (error) {
        perfDebugPushEvent("deferred_task_error", {
          name: taskName,
          error: String(error && error.message || error || "unknown")
        });
      } finally {
        if (perfDebugState.enabled) {
          perfDebugState.deferred_tasks_completed = safeNumber(perfDebugState.deferred_tasks_completed) + 1;
          perfDebugPushEvent("deferred_task_complete", { name: taskName });
        }
      }
    }, delayMs);
    deferredPerfTasks.set(taskName, token);
    return true;
  }

  function stableJsonFingerprint(value) {
    try {
      return JSON.stringify(value) || "";
    } catch (_) {
      return "";
    }
  }

  function perfNowMs() {
    try {
      return typeof performance !== "undefined" && typeof performance.now === "function"
        ? performance.now()
        : Date.now();
    } catch (_) {
      return Date.now();
    }
  }

  function readySelector(selectors) {
    const candidates = Array.isArray(selectors) ? selectors : [];
    for (const selector of candidates) {
      if (selector && document.querySelector(selector)) {
        return {
          ready: true,
          reason: `selector:${selector}`
        };
      }
    }
    return {
      ready: false,
      reason: candidates.length ? `waiting_selector:${candidates[0]}` : "waiting_selector"
    };
  }

  function workspaceRouteReadyState(collection, selectors) {
    const bucket = workspaceBucket(collection);
    if (!bucket) {
      return {
        ready: false,
        reason: `missing_bucket:${collection}`
      };
    }
    if (bucket.error) {
      return {
        ready: true,
        reason: `error:${collection}`
      };
    }
    if (!bucket.loaded) {
      return {
        ready: false,
        reason: `loading:${collection}`
      };
    }
    if (!workspaceItems(collection).length) {
      return {
        ready: true,
        reason: `empty:${collection}`
      };
    }
    const selectorState = readySelector(selectors);
    if (selectorState.ready) {
      return selectorState;
    }
    return {
      ready: true,
      reason: `loaded:${collection}`
    };
  }

  function routeReadyState(route = state.route) {
    const currentRoute = String(route || "").trim() || "home";
    switch (currentRoute) {
      case "home":
        return readySelector([".light-app-tile", ".light-home-page", '.app-shell[data-view="home"]']);
      case "inbox":
        if (state.feedLoadError) {
          return {
            ready: true,
            reason: "error:inbox"
          };
        }
        if (Array.isArray(state.cards) && state.cards.length) {
          return readySelector(["article[data-card-id] .card-body", "article[data-card-session-id] .card-body"]);
        }
        if (document.querySelector(".empty")) {
          return {
            ready: true,
            reason: "empty:inbox"
          };
        }
        return {
          ready: false,
          reason: "loading:inbox"
        };
      case "meetings":
        if (state.meetings.error) {
          return {
            ready: true,
            reason: "error:meetings"
          };
        }
        if (!state.meetings.loaded) {
          return {
            ready: false,
            reason: "loading:meetings"
          };
        }
        if (!Array.isArray(state.meetings.records) || !state.meetings.records.length) {
          return {
            ready: true,
            reason: "empty:meetings"
          };
        }
        return readySelector(["article[data-card-session-id] .card-body", ".meetings-list-card article[data-card-session-id] .card-body"]);
      case "notes":
        return workspaceRouteReadyState("notes", [".light-note-row"]);
      case "tasks":
        return workspaceRouteReadyState("tasks", [".light-task-row", ".light-task-workspace", ".light-task-detail-surface"]);
      case "calendar":
        return workspaceRouteReadyState("calendar-events", [".light-event-block", ".light-calendar-page"]);
      case "projects":
        return workspaceRouteReadyState("projects", [".light-project-row"]);
      case "contacts":
        return workspaceRouteReadyState("contacts", [".light-contact-row"]);
      case "meeting-notes":
        return workspaceRouteReadyState("meeting-notes", [".light-graph-row"]);
      case "reminders":
        return workspaceRouteReadyState("reminders", [".light-reminder-row"]);
      case "connect":
        if (!document.querySelector(".links-search")) {
          return {
            ready: false,
            reason: "waiting_selector:.links-search"
          };
        }
        if (state.links.loading && !state.links.firstPageReady && !state.links.connectedLoaded && !state.links.error && !state.links.message) {
          return {
            ready: false,
            reason: "loading:connect"
          };
        }
        if (state.links.firstPageReady || state.links.connectedLoaded || state.links.error || state.links.message || state.links.token || state.links.userId) {
          return {
            ready: true,
            reason: state.links.error
              ? "connect_error"
              : state.links.firstPageReady
                ? "connect_catalog_ready"
              : state.links.connectedLoaded
                ? "connect_connected_loaded"
                : "connect_session_ready"
          };
        }
        return {
          ready: false,
          reason: "waiting_connect_session"
        };
      case "task-detail":
        if (!workspaceBucket("tasks")?.loaded) {
          return {
            ready: false,
            reason: "loading:tasks"
          };
        }
        return readySelector([".light-task-detail-surface", ".light-task-detail-page", ".light-task-detail-pane [data-task-detail-id]"]);
      case "contact-detail":
        return readySelector([".light-contact-detail-page"]);
      case "contact-edit":
        return readySelector([".light-contact-edit-page"]);
      case "project-detail":
        return readySelector([".light-project-detail-page"]);
      case "reminder-detail":
        return readySelector([".light-reminder-detail-surface", ".light-reminder-detail-page"]);
      case "note-detail":
        return readySelector([".light-note-detail-page"]);
      case "meeting-detail":
        return readySelector([".light-event-detail-page", ".light-event-document"]);
      case "meeting-note-detail":
        return readySelector([".light-meeting-note-detail-page"]);
      case "settings":
        return readySelector([".light-settings-real .settings-card", ".light-settings-real", '.app-shell[data-view="settings"]']);
      default:
        return readySelector([`.app-shell[data-view="${currentRoute}"]`]);
    }
  }

  function bootstrapDebugState() {
    const raw = window.__PUCKY_BOOTSTRAP_STATUS__ && typeof window.__PUCKY_BOOTSTRAP_STATUS__ === "object"
      ? window.__PUCKY_BOOTSTRAP_STATUS__
      : {};
    return {
      shell_launch_elapsed_ms: safeNumber(raw.shell_launch_elapsed_ms),
      webview_load_elapsed_ms: safeNumber(raw.webview_load_elapsed_ms),
      asset_delivery_failures: Array.isArray(raw.asset_delivery_failures)
        ? raw.asset_delivery_failures.length
        : safeNumber(raw.asset_delivery_failures),
      hosted_reload_attempts: safeNumber(raw.hosted_reload_attempts || raw.reload_attempts)
    };
  }

  function syncPerfDebugRuntimeBudgets() {
    const bootstrap = bootstrapDebugState();
    if (safeNumber(bootstrap.shell_launch_elapsed_ms) > 0) {
      perfDebugState.shell_launch_elapsed_ms = safeNumber(bootstrap.shell_launch_elapsed_ms);
    }
    if (safeNumber(bootstrap.webview_load_elapsed_ms) > 0) {
      perfDebugState.webview_load_elapsed_ms = safeNumber(bootstrap.webview_load_elapsed_ms);
    }
    perfDebugState.asset_delivery_failures = Math.max(
      safeNumber(perfDebugState.asset_delivery_failures),
      safeNumber(bootstrap.asset_delivery_failures)
    );
    perfDebugState.hosted_reload_attempts = Math.max(
      safeNumber(perfDebugState.hosted_reload_attempts),
      safeNumber(bootstrap.hosted_reload_attempts)
    );
    const surface = state.uiSurface && typeof state.uiSurface === "object" ? state.uiSurface : {};
    if (safeNumber(surface.shell_launch_elapsed_ms) > 0) {
      perfDebugState.shell_launch_elapsed_ms = safeNumber(surface.shell_launch_elapsed_ms);
    }
    if (safeNumber(surface.webview_load_elapsed_ms) > 0) {
      perfDebugState.webview_load_elapsed_ms = safeNumber(surface.webview_load_elapsed_ms);
    }
    perfDebugState.asset_delivery_failures = Math.max(
      safeNumber(perfDebugState.asset_delivery_failures),
      safeNumber(surface.asset_delivery_failures)
    );
    perfDebugState.hosted_reload_attempts = Math.max(
      safeNumber(perfDebugState.hosted_reload_attempts),
      safeNumber(surface.hosted_reload_attempts)
    );
  }

  function syncPerfDebugState(reason = "") {
    if (!perfDebugState.enabled) {
      return;
    }
    syncPerfDebugRuntimeBudgets();
    const route = String(state.route || "home").trim() || "home";
    if (perfDebugState.route !== route) {
      if (perfDebugState.route_ready && !perfDebugState.route_perf_sent) {
        void flushRoutePerfTelemetry("route_change");
      }
      perfDebugState.route = route;
      perfDebugState.route_sequence += 1;
      perfDebugState.route_started_at_ms = Date.now();
      perfDebugState.route_enter_at_ms = perfDebugState.route_started_at_ms;
      perfDebugState.route_data_start_at_ms = 0;
      perfDebugState.route_data_end_at_ms = 0;
      perfDebugState.route_ready = false;
      perfDebugState.route_ready_reason = "";
      perfDebugState.route_ready_at_ms = 0;
      perfDebugState.route_perf_sent = false;
      perfDebugState.render_count = 0;
      perfDebugState.last_render_ms = 0;
      perfDebugState.bridge_total_ms = 0;
      perfDebugState.bridge_calls_by_command = {};
      perfDebugState.fetches_by_key = {};
      perfDebugState.poll_ticks_by_lane = {};
      perfDebugState.cache_hits_by_key = {};
      perfDebugState.deferred_tasks_started = 0;
      perfDebugState.deferred_tasks_completed = 0;
      perfDebugState.unchanged_refresh_skips = 0;
      perfDebugState.recent_events = [];
      perfDebugPushEvent("route_changed", { route, reason: String(reason || "").trim() || "unknown" });
    }
    const snapshot = routeReadyState(route);
    perfDebugState.route_ready_reason = String(snapshot.reason || "").trim();
    if (snapshot.ready && !perfDebugState.route_ready) {
      perfDebugState.route_ready = true;
      perfDebugState.route_ready_at_ms = Date.now();
      setPerfBootPhase("route_ready");
      perfDebugPushEvent("route_ready", {
        route,
        reason: perfDebugState.route_ready_reason,
        elapsed_ms: Math.max(0, perfDebugState.route_ready_at_ms - perfDebugState.route_started_at_ms)
      });
      queueDeferredPerfTask(`perf_flush:${route}:${safeNumber(perfDebugState.route_sequence)}`, () => flushRoutePerfTelemetry("route_ready"), {
        delayMs: PERF_DEFERRED_TASK_DELAY_MS
      });
    } else if (!snapshot.ready) {
      perfDebugState.route_ready = false;
      perfDebugState.route_ready_at_ms = 0;
    }
  }

  function perfDebugMetrics() {
    syncPerfDebugState("metrics_read");
    syncPerfDebugRuntimeBudgets();
    return {
      schema: "pucky.perf_debug_metrics.v1",
      enabled: Boolean(perfDebugState.enabled),
      route: String(perfDebugState.route || state.route || "home").trim() || "home",
      route_sequence: safeNumber(perfDebugState.route_sequence, 1),
      route_started_at_ms: safeNumber(perfDebugState.route_started_at_ms),
      route_enter_at_ms: safeNumber(perfDebugState.route_enter_at_ms),
      route_data_start_at_ms: safeNumber(perfDebugState.route_data_start_at_ms),
      route_data_end_at_ms: safeNumber(perfDebugState.route_data_end_at_ms),
      route_ready: Boolean(perfDebugState.route_ready),
      route_ready_reason: String(perfDebugState.route_ready_reason || ""),
      route_ready_at_ms: safeNumber(perfDebugState.route_ready_at_ms),
      route_ready_elapsed_ms: perfDebugState.route_ready_at_ms
        ? Math.max(0, safeNumber(perfDebugState.route_ready_at_ms) - safeNumber(perfDebugState.route_started_at_ms))
        : 0,
      wall_elapsed_ms: Math.max(0, Date.now() - safeNumber(perfDebugState.route_enter_at_ms)),
      bridge_total_ms: safeNumber(perfDebugState.bridge_total_ms),
      shell_launch_elapsed_ms: safeNumber(perfDebugState.shell_launch_elapsed_ms),
      webview_load_elapsed_ms: safeNumber(perfDebugState.webview_load_elapsed_ms),
      asset_delivery_failures: safeNumber(perfDebugState.asset_delivery_failures),
      hosted_reload_attempts: safeNumber(perfDebugState.hosted_reload_attempts),
      bootstrap_snapshot_used: Boolean(perfDebugState.bootstrap_snapshot_used),
      render_count: safeNumber(perfDebugState.render_count),
      last_render_ms: safeNumber(perfDebugState.last_render_ms),
      boot_phase: String(perfDebugState.boot_phase || ""),
      session_id: String(perfDebugState.session_id || ""),
      run_id: String(perfDebugState.run_id || ""),
      sample_reason: String(perfDebugState.sample_reason || ""),
      surface: String(perfDebugState.surface || ""),
      device_class: String(perfDebugState.device_class || ""),
      bridge_calls_by_command: { ...perfDebugState.bridge_calls_by_command },
      fetches_by_key: { ...perfDebugState.fetches_by_key },
      poll_ticks_by_lane: { ...perfDebugState.poll_ticks_by_lane },
      cache_hits_by_key: { ...perfDebugState.cache_hits_by_key },
      deferred_tasks_started: safeNumber(perfDebugState.deferred_tasks_started),
      deferred_tasks_completed: safeNumber(perfDebugState.deferred_tasks_completed),
      unchanged_refresh_skips: safeNumber(perfDebugState.unchanged_refresh_skips),
      recent_events: perfDebugState.recent_events.slice(-PERF_DEBUG_EVENT_LIMIT)
    };
  }

  function recordPerfBridgeCall(command, startedAt, ok, error = "") {
    if (!perfDebugState.enabled) {
      return;
    }
    const name = String(command || "").trim();
    if (!name) {
      return;
    }
    perfDebugIncrementCounter("bridge_calls_by_command", name);
    perfDebugState.bridge_total_ms = safeNumber(perfDebugState.bridge_total_ms) + Math.max(0, perfNowMs() - safeNumber(startedAt));
    if (!ok || error) {
      perfDebugPushEvent("bridge_error", {
        command: name,
        elapsed_ms: Math.max(0, perfNowMs() - safeNumber(startedAt)),
        error: String(error || "unknown")
      });
    }
  }

  function recordPerfFetch(key, startedAt, ok, error = "") {
    if (!perfDebugState.enabled) {
      return;
    }
    const name = String(key || "").trim();
    if (!name) {
      return;
    }
    perfDebugIncrementCounter("fetches_by_key", name);
    if (!ok || error) {
      perfDebugPushEvent("fetch_error", {
        key: name,
        elapsed_ms: Math.max(0, perfNowMs() - safeNumber(startedAt)),
        error: String(error || "unknown")
      });
    }
  }

  function recordPerfPollTick(lane) {
    perfDebugIncrementCounter("poll_ticks_by_lane", lane);
  }

  function requestRender(reason = "scheduled_render") {
    if (scheduledRenderToken) {
      return false;
    }
    const commit = () => {
      scheduledRenderToken = 0;
      render();
    };
    perfDebugPushEvent("render_scheduled", { reason: String(reason || "").trim() || "scheduled_render" });
    if (typeof window !== "undefined" && typeof window.requestAnimationFrame === "function") {
      scheduledRenderToken = window.requestAnimationFrame(commit);
      return true;
    }
    scheduledRenderToken = window.setTimeout(commit, 0);
    return true;
  }

  function routeUsesLiveTurnPolling(route = state.route) {
    return ["home", "inbox", "meetings"].includes(String(route || "").trim());
  }

  function turnStatusPollIntervalMs(route = state.route) {
    if (isTurnActive(state.turn) || wakeProofVisualState(state.wakeStatus) !== "idle") {
      return TURN_STATUS_POLL_MS;
    }
    if (playerHasAudioIdentity(state.player) && Boolean(state.player?.is_playing)) {
      return PLAYER_STATE_POLL_INTERVAL_MS;
    }
    return routeUsesLiveTurnPolling(route) ? TURN_STATUS_LIVE_ROUTE_INTERVAL_MS : TURN_STATUS_IDLE_ROUTE_INTERVAL_MS;
  }

  function shouldPollMeetingStatus(route = state.route) {
    const currentRoute = String(route || "").trim();
    if (String(state.meetingRecording?.state || "idle") !== "idle") {
      return true;
    }
    return currentRoute === "meetings" || currentRoute === "meeting-detail";
  }

  function meetingStatusPollIntervalMs(route = state.route) {
    const currentRoute = String(route || "").trim();
    if (String(state.meetingRecording?.state || "idle") !== "idle") {
      return MEETING_STATUS_POLL_MS;
    }
    if (currentRoute === "meetings" || currentRoute === "meeting-detail") {
      return MEETING_STATUS_IDLE_ROUTE_INTERVAL_MS;
    }
    return 0;
  }

  function workspaceRouteQueryKey(route = state.route, options = {}) {
    return "";
  }

  function workspaceBucketNeedsRefresh(collection, staleMs, options = {}) {
    const bucket = workspaceBucket(collection);
    if (!bucket) {
      return false;
    }
    const queryKey = String(options.queryKey || "").trim();
    if (queryKey && String(bucket.queryKey || "").trim() !== queryKey) {
      return true;
    }
    if (!bucket.loaded || bucket.dirty) {
      return true;
    }
    const lastRefreshAt = safeNumber(bucket.lastRefreshAt);
    if (lastRefreshAt <= 0) {
      return true;
    }
    return (Date.now() - lastRefreshAt) >= Math.max(1000, safeNumber(staleMs, 1000));
  }

  function markWorkspaceBucketDirty(collection, options = {}) {
    const bucket = workspaceBucket(collection);
    if (!bucket) {
      return;
    }
    bucket.dirty = true;
    perfDebugPushEvent("workspace_bucket_dirty", {
      collection: String(collection || "").trim(),
      reason: String(options.reason || "").trim()
    });
    if (options.refresh) {
      void loadWorkspaceCollection(collection, {
        render: options.render !== false,
        force: true,
        reason: String(options.reason || "").trim() || "dirty_refresh"
      });
    }
  }

  window.Pucky = {
    request(payload) {
      const command = payload && payload.command;
      const args = payload && payload.args ? payload.args : {};
      const startedAt = perfNowMs();
      if (window.PuckyAndroid && typeof window.PuckyAndroid.postMessage === "function") {
        const id = String(++seq);
        const message = JSON.stringify({ id, command, args });
        return new Promise((resolve, reject) => {
          pending.set(id, { resolve, reject });
          window.PuckyAndroid.postMessage(message);
          setTimeout(() => {
            if (pending.has(id)) {
              pending.delete(id);
              reject(new Error("Pucky native bridge timed out"));
            }
          }, 15000);
        }).then(result => {
          recordPerfBridgeCall(command, startedAt, true);
          return result;
        }).catch(error => {
          recordPerfBridgeCall(command, startedAt, false, error && error.message ? error.message : String(error || ""));
          throw error;
        });
      }
      return Promise.resolve()
        .then(() => browserRequest(command, args))
        .then(result => {
          recordPerfBridgeCall(command, startedAt, true);
          return result;
        })
        .catch(error => {
          recordPerfBridgeCall(command, startedAt, false, error && error.message ? error.message : String(error || ""));
          throw error;
        });
    },
    __resolve(id, payload) {
      const slot = pending.get(String(id));
      if (!slot) {
        return;
      }
      pending.delete(String(id));
      if (payload && payload.ok) {
        slot.resolve(payload.result || {});
      } else {
        slot.reject(new Error((payload && payload.error) || "Native command failed"));
      }
    },
    __event(name, payload) {
      if (name === "player.state") {
        const previousPlayer = state.player;
        state.player = stampPlayerState(payload || state.player);
        syncActivePathFromPlayer(state.player);
        rememberPlayerProgress(state.player);
        const audioProbeChanged = syncAudioProbeFromPlayerState(previousPlayer, state.player);
        if (shouldRenderForPlayerState(previousPlayer, state.player) || audioProbeChanged) {
          requestRender("native_event_player_state");
        }
      }
      if (name === "voice.state") {
        applyVoiceState(payload);
        renderVoiceStatus();
      }
      if (name === "pucky.turn.status") {
        const incoming = normalizeTurnStatus(payload);
        const indicator = turnIndicatorFromStatus(incoming);
        recordTurnUiEvent("turn_status_event", {
          turn_id: turnStatusTurnId(incoming),
          state: indicator.state,
          visual_state: turnVisualState(incoming),
          remote_stage: indicator.remote_stage || ""
        });
        applyTurnStatus(payload);
        renderVoiceStatus();
      }
    }
  };

  function ensureSharedBrowserAudio() {
    if (sharedBrowserAudio) {
      return sharedBrowserAudio;
    }
    const audio = new Audio();
    audio.preload = "auto";
    audio.playsInline = true;
    sharedBrowserAudio = audio;
    audio.addEventListener("loadedmetadata", () => syncSharedBrowserPlayerState({ render: true }));
    audio.addEventListener("durationchange", () => syncSharedBrowserPlayerState({ render: true }));
    audio.addEventListener("ratechange", () => syncSharedBrowserPlayerState({ render: false }));
    audio.addEventListener("play", () => syncSharedBrowserPlayerState({ render: true }));
    audio.addEventListener("pause", () => syncSharedBrowserPlayerState({ render: true }));
    audio.addEventListener("ended", () => syncSharedBrowserPlayerState({ state: "completed", render: true }));
    return audio;
  }

  function audioPlayerNumberValue(value, fallback = 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function syncSharedBrowserPlayerState(overrides = {}) {
    const previousPlayer = state.player;
    const audio = ensureSharedBrowserAudio();
    const hasDuration = Number.isFinite(Number(audio.duration)) && audio.duration > 0;
    const isPlaying = Boolean(audio && !audio.paused && !audio.ended);
    const durationSource = Number.isFinite(audioPlayerNumberValue(audio.duration, 0)) ? audio.duration : 0;
    const positionSource = Number.isFinite(audio.currentTime) ? Math.max(0, audio.currentTime) : 0;
    const audioElementSource = String(audio.currentSrc || audio.src || "").trim();
    const next = {
      schema: "pucky.player_state.v1",
      loaded: true,
      state: String(overrides.state || "").trim() || (isPlaying ? "playing" : (audio.ended ? "completed" : "paused")),
      is_playing: isPlaying,
      title: String("title" in overrides ? overrides.title : previousPlayer?.title || ""),
      path: String("path" in overrides ? overrides.path : previousPlayer?.path || audioElementSource || ""),
      source: String("source" in overrides ? overrides.source : previousPlayer?.source || state.activePath || audioElementSource || ""),
      position_ms: Math.max(0, Math.round("position_ms" in overrides ? audioPlayerNumberValue(overrides.position_ms) : positionSource * 1000)),
      duration_ms: Math.max(0, Math.round("duration_ms" in overrides ? audioPlayerNumberValue(overrides.duration_ms) : (hasDuration ? durationSource * 1000 : audioPlayerNumberValue(previousPlayer?.duration_ms, 0)))),
      queue_index: audioPlayerNumberValue("queue_index" in overrides ? overrides.queue_index : previousPlayer?.queue_index, -1),
      queue_count: audioPlayerNumberValue("queue_count" in overrides ? overrides.queue_count : previousPlayer?.queue_count, 0),
      speed: finiteSpeed("speed" in overrides ? overrides.speed : audio.playbackRate ?? previousPlayer?.speed ?? 1) ?? previousPlayer?.speed ?? 1,
      can_seek: true,
      audio_session_id: audioPlayerNumberValue(previousPlayer?.audio_session_id, 1)
    };
    state.player = stampPlayerState(next);
    syncActivePathFromPlayer(state.player);
    rememberPlayerProgress(state.player);
    if (overrides.render) {
      const probeChanged = syncAudioProbeFromPlayerState(previousPlayer, state.player);
      if (shouldRenderForPlayerState(previousPlayer, state.player) || probeChanged) {
        render();
      }
    }
    return state.player;
  }

  async function browserRequest(command, args) {
    if (command === "voice.thread_scope.get") {
      return normalizeThreadScope(state.threadScope);
    }
    if (command === "voice.thread_scope.set") {
      state.threadScope = normalizeThreadScope(args);
      return state.threadScope;
    }
    if (command === "voice.thread_scope.clear") {
      state.threadScope = initialThreadScope();
      return state.threadScope;
    }
    if (command === "meeting.recording.status") {
      return state.meetingRecording;
    }
    if (command === "player.state") {
      return playerHasAudioIdentity(state.player)
        ? syncSharedBrowserPlayerState({ render: false })
        : state.player;
    }
    if (command === "pucky.turn.status") {
      return state.turn;
    }
    if (command === "pucky.turn.settings.get") {
      return state.turnSettings;
    }
    if (command === "phone.role.status") {
      return normalizePhoneRoleStatus(state.phoneRole);
    }
    if (command === "phone.role.request_setup") {
      throw new Error("Phone role setup is only available in the APK on your device.");
    }
    if (command === "phone.role.open_default_apps_settings") {
      throw new Error("Phone role settings are only available in the APK on your device.");
    }
    if (command === "pucky.turn.settings.set") {
      const mode = args.reply_mode !== undefined || args.mode !== undefined
        ? normalizeReplyMode(args.reply_mode || args.mode)
        : normalizeReplyMode(state.turnSettings.reply_mode);
      const arrivalCueMode = normalizeArrivalCueMode(
        args.arrival_cue_mode !== undefined
          ? args.arrival_cue_mode
          : args.accepted_chime_enabled !== undefined
            ? (truthy(args.accepted_chime_enabled) ? "chime" : "none")
            : state.turnSettings.arrival_cue_mode
      );
      const model = normalizeTurnModel(
        args.model !== undefined ? args.model : state.turnSettings.model
      );
      const reasoningEffort = normalizeTurnReasoningEffort(
        args.reasoning_effort !== undefined ? args.reasoning_effort : state.turnSettings.reasoning_effort
      );
      state.turnSettings = {
        schema: "pucky.turn_settings.v1",
        reply_mode: mode,
        spoken_reply_enabled: mode === "card_and_spoken",
        arrival_cue_mode: arrivalCueMode,
        accepted_chime_enabled: arrivalCueMode === "chime" || arrivalCueMode === "haptic_and_chime",
        model,
        reasoning_effort: reasoningEffort,
        modes: TURN_REPLY_MODES,
        arrival_cue_modes: TURN_ARRIVAL_CUE_MODES,
        model_options: TURN_MODEL_OPTIONS,
        reasoning_effort_options: TURN_REASONING_EFFORT_OPTIONS
      };
      return state.turnSettings;
    }
    if (command === "pucky.turn.arrival_cue.test" || command === "pucky.turn.sent_cue.test") {
      const arrivalCueMode = normalizeArrivalCueMode(state.turnSettings.arrival_cue_mode);
      const acceptedChimeEnabled = arrivalCueMode === "chime" || arrivalCueMode === "haptic_and_chime";
      return {
        schema: "pucky.turn_arrival_cue_playback.v1",
        test: true,
        arrival_cue_mode: arrivalCueMode,
        arrival_cue_attempted: arrivalCueMode !== "none",
        arrival_cue_suppressed: arrivalCueMode === "none",
        arrival_cue_result: arrivalCueMode === "none" ? "disabled" : "played",
        accepted_chime_enabled: acceptedChimeEnabled,
        accepted_chime_attempted: acceptedChimeEnabled,
        accepted_chime_suppressed: !acceptedChimeEnabled,
        haptic_attempted: arrivalCueMode === "haptic" || arrivalCueMode === "haptic_and_chime",
        haptic_played: arrivalCueMode === "haptic" || arrivalCueMode === "haptic_and_chime",
        chime_attempted: acceptedChimeEnabled,
        chime_played: acceptedChimeEnabled,
        played: arrivalCueMode !== "none",
        reason: arrivalCueMode === "none" ? "disabled" : "",
        asset_name: "pucky_system_notification.mp3",
        asset_path: "res/raw/pucky_system_notification.mp3",
        fallback_used: false,
        player: "MediaPlayer",
        stream: "music",
        usage: "media_sonification"
      };
    }
    if (command === "pucky.turn.received_cue.test") {
      return {
        schema: "pucky.turn_reply_received_cue_playback.v1",
        test: true,
        trigger: "manual_test",
        reply_received_cue_attempted: true,
        reply_received_cue_suppressed: false,
        reply_received_cue_played: true,
        reply_received_cue_result: "played",
        played: true,
        reason: "",
        asset_name: "pucky_new_message_2.mp3",
        asset_path: "res/raw/pucky_new_message_2.mp3",
        reply_received_cue_asset_name: "pucky_new_message_2.mp3",
        reply_received_cue_asset_path: "res/raw/pucky_new_message_2.mp3",
        reply_received_cue_fallback_used: false,
        fallback_used: false,
        player: "MediaPlayer",
        stream: "music",
        usage: "media_sonification"
      };
    }
    if (command === "pucky.turn.chime.test") {
      return browserRequest("pucky.turn.arrival_cue.test", args);
    }
    if (command === "wake.status") {
      return state.wakeStatus;
    }
    if (command === "wake.start") {
      state.wakeStatus = normalizeWakeStatus({
        ...state.wakeStatus,
        enabled: true,
        requested_enabled: true,
        running: false,
        state: "idle",
        mode: "android_stt_wake",
        engine: "android_stt_sentinel",
        requested_engine: "android_stt_sentinel",
        effective_engine: "stopped",
        debug_recognizer_mode: state.wakeStatus.debug_recognizer_mode || "android",
        recognizer_state: "idle",
        suspended_reason: "service_not_started"
      });
      return state.wakeStatus;
    }
    if (command === "wake.stop") {
      state.wakeStatus = normalizeWakeStatus({
        ...state.wakeStatus,
        enabled: false,
        requested_enabled: false,
        running: false,
        state: "idle",
        debug_recognizer_mode: state.wakeStatus.debug_recognizer_mode || "android",
        recognizer_state: "stopped",
        suspended_reason: "disabled"
      });
      return state.wakeStatus;
    }
    if (command === "wake.config.set") {
      const enabled = args.enabled === undefined ? state.wakeStatus.enabled : truthy(args.enabled);
      state.wakeStatus = normalizeWakeStatus({
        ...state.wakeStatus,
        enabled,
        requested_enabled: enabled,
        running: enabled ? state.wakeStatus.running : false,
        state: enabled ? state.wakeStatus.state : "idle",
        mode: "android_stt_wake",
        engine: "android_stt_sentinel",
        requested_engine: "android_stt_sentinel",
        effective_engine: enabled && state.wakeStatus.running ? "android_stt_sentinel" : "stopped",
        debug_recognizer_mode: String(args.recognizer_mode || state.wakeStatus.debug_recognizer_mode || "android"),
        recognizer_state: enabled ? state.wakeStatus.recognizer_state || "idle" : "stopped",
        suspended_reason: enabled
          ? state.wakeStatus.running
            ? ""
            : state.wakeStatus.suspended_reason || "service_not_started"
          : "disabled",
        scope: String(args.scope || state.wakeStatus.scope || "awake_and_unlocked_foreground"),
        mode: String(args.mode || state.wakeStatus.mode || "android_stt_wake")
      });
      return state.wakeStatus;
    }
    if (command === "wake.simulate") {
      const event = String(args.event || "final").toLowerCase();
      const phrase = String(args.transcript || args.phrase || args.text || "");
      const alternatives = Array.isArray(args.alternatives) ? args.alternatives : [];
      const acceptedWake = /^(hey\s+)?(pucky|bucky|pocky|pookie|pupp)(\s|$)/i.test(phrase)
        || alternatives.some(value => /^(hey\s+)?(pucky|bucky|pocky|pookie|pupp)(\s|$)/i.test(String(value || "")));
      const singleWord = /^(pucky|bucky|pocky|pookie|pupp)(\s|$)/i.test(phrase);
      const accepted = event === "partial" ? acceptedWake && !singleWord : acceptedWake;
      const proof = {
        active: accepted,
        visual_state: accepted ? "armed" : "idle",
        matched_phrase: accepted ? phrase : "",
        transcript: phrase,
        remaining_ms: accepted ? 3000 : 0
      };
      state.wakeStatus = normalizeWakeStatus({
        ...state.wakeStatus,
        mode: "android_stt_wake",
        engine: "android_stt_sentinel",
        requested_engine: "android_stt_sentinel",
        effective_engine: accepted ? "stopped" : "android_stt_sentinel",
        debug_recognizer_mode: state.wakeStatus.debug_recognizer_mode || "android",
        running: !accepted,
        state: accepted ? "matched" : event === "error" ? "error" : "armed",
        recognizer_state: accepted ? "matched" : event === "error" ? "error" : "ready",
        last_transcript: phrase,
        last_alternatives: alternatives,
        last_error_code: event === "error" ? String(args.error_code || "ERROR_CLIENT") : "",
        last_error_message: event === "error" ? String(args.error_message || "Simulated recognizer error") : "",
        last_restart_reason: event === "error" ? "recognizer_error" : (accepted ? "proof_window_elapsed" : "final_no_match"),
        restart_count: event === "error" ? safeNumber(state.wakeStatus.restart_count) + 1 : safeNumber(state.wakeStatus.restart_count),
        suspended_reason: accepted ? "" : (event === "error" ? "" : ""),
        proof_indicator: proof,
        last_match: {
          matched_phrase: proof.matched_phrase,
          match_source: accepted ? `simulate_${event}` : "",
          matched_at: accepted ? new Date().toISOString() : ""
        }
      });
      return state.wakeStatus;
    }
    if (command === "ui.surface.get") {
      return describeUiSurface();
    }
    if (command === "ui.debug.audio_probe.get") {
      return describeAudioProbe();
    }
    if (command === "ui.debug.goto_home") {
      return uiDebugDispatch("goto_home", args);
    }
    if (command === "ui.debug.back") {
      return uiDebugDispatch("back", args);
    }
    if (command === "ui.debug.focus_card") {
      return uiDebugDispatch("focus_card", args);
    }
    if (command === "ui.debug.clear_focus") {
      return uiDebugDispatch("clear_focus", args);
    }
    if (command === "ui.debug.refresh_cards") {
      return uiDebugDispatch("refresh_cards", args);
    }
    if (command === "ui.debug.open_card_action") {
      return uiDebugDispatch("open_card_action", args);
    }
    if (command === "browser.open") {
      const url = String(args.url || "").trim();
      if (!url) {
        throw new Error("browser.open requires url");
      }
      let popup = null;
      let popupError = null;
      if (typeof window.open === "function") {
        try {
          popup = window.open("", "_blank", "noopener,noreferrer");
          if (popup && popup.location && typeof popup.location.assign === "function") {
            popup.location.assign(url);
          }
        } catch (error) {
          popupError = error;
        }
      }
      let popupOpened = false;
      if (popup) {
        await new Promise(resolve => setTimeout(resolve, 24));
        try {
          if (typeof popup.closed === "boolean" && popup.closed === true) {
            popupOpened = false;
          } else {
            try {
              const popupHref = String(popup.location && popup.location.href || "").trim();
              popupOpened = Boolean(popupHref && popupHref !== "about:blank");
            } catch (_) {
              popupOpened = true;
            }
          }
        } catch (_) {
          popupOpened = true;
        }
      }
      if (popupOpened) {
        return {
          schema: "pucky.browser_open.v1",
          launched: true,
          uri: url,
          user_mediated: true,
          launch_surface: "popup",
          popup_opened: true,
          same_tab_navigation: false
        };
      }
      let assignError = null;
      if (window.location && typeof window.location.assign === "function") {
        try {
          window.location.assign(url);
          return {
            schema: "pucky.browser_open.v1",
            launched: true,
            uri: url,
            user_mediated: true,
            launch_surface: "same_tab",
            popup_opened: false,
            same_tab_navigation: true
          };
        } catch (error) {
          assignError = error;
        }
      }
      const detail = [popupError, assignError]
        .map(error => String(error && error.message ? error.message : error || "").trim())
        .filter(Boolean)
        .join("; ");
      throw new Error(detail ? `browser.open failed to launch auth: ${detail}` : "browser.open could not open a popup or navigate this tab.");
    }
    if (command === "player.asset.prepare") {
      const url = String(args.url || "").trim();
      if (!url) {
        throw new Error("player.asset.prepare requires url");
      }
      const filename = String(args.filename || "meeting-audio.m4a").replace(/[^A-Za-z0-9._-]+/g, "-");
      return {
        schema: "pucky.player_asset_prepare.v1",
        url,
        device_path: `/data/data/com.pucky.device.debug/files/downloads/${filename}`,
        mime_type: String(args.mime_type || "audio/mp4")
      };
    }
    if (command === "player.play") {
      const requestedPath = String(args.path || "").trim();
      const nextPath = requestedPath || String(state.player.path || state.activePath || "").trim();
      const nextSource = args.source !== undefined
        ? String(args.source || "").trim()
        : (requestedPath ? "" : String(state.player.source || "").trim());
      const selectedPlayer = state.player;
      const start = Number.isFinite(Number(args.start_at_ms))
        ? Math.max(0, Math.round(Number(args.start_at_ms)))
        : savedPositionFor(nextSource || nextPath);
      const speed = finiteSpeed(args.speed ?? args.rate)
        ?? savedSpeedForCard(findCardByAudioLookupKey(nextSource || nextPath) || {})
        ?? state.player.speed
        ?? 1;
      const audio = ensureSharedBrowserAudio();
      if (!nextPath) {
        throw new Error("No audio source available.");
      }
      const currentElementSource = String(audio.currentSrc || audio.src || "").trim();
      const switchingSource = Boolean(currentElementSource) && !samePath(currentElementSource, nextPath);
      if (switchingSource) {
        audio.pause();
      }
      if (switchingSource || !samePath(String(audio.src || ""), nextPath)) {
        audio.src = nextPath;
        audio.load();
      }
      audio.playbackRate = speed;
      try {
        audio.currentTime = Math.max(0, start / 1000);
      } catch (_) {
        // Some WebKit builds reject seeks before metadata is available; playback can still begin at 0.
      }
      state.activePath = nextSource || nextPath;
      await audio.play();
      return syncSharedBrowserPlayerState({
        title: String(args.title || selectedPlayer?.title || ""),
        path: nextPath,
        source: nextSource,
        queue_index: selectedPlayer?.queue_index ?? -1,
        queue_count: selectedPlayer?.queue_count ?? 0,
        speed,
        position_ms: start,
        render: true
      });
    }
    if (command === "player.queue.set") {
      const playlist = args.playlist_path || "";
      const first = playlist ? `${playlist}#track1` : String((args.items && args.items[0] && args.items[0].path) || "");
      const nextSource = String(playlist).trim();
      const nextPath = first;
      const selectedPlayer = state.player;
      const speed = finiteSpeed(args.speed ?? args.rate)
        || state.speedByPath.get(normalizePath(audioControlKey({ audio_playlist_path: playlist, audio_path: first })))
        || state.player.speed
        || 1;
      const audio = ensureSharedBrowserAudio();
      if (nextPath) {
        audio.src = nextPath;
        audio.load();
      }
      state.activePath = nextSource || nextPath || state.activePath;
      return syncSharedBrowserPlayerState({
        title: String(args.title || selectedPlayer?.title || ""),
        path: nextPath || selectedPlayer?.path || "",
        source: nextSource || selectedPlayer?.source || "",
        state: "loaded",
        is_playing: false,
        position_ms: 0,
        duration_ms: 0,
        queue_index: Number(args.index || 0),
        queue_count: playlist ? 83 : ((args.items && args.items.length) || 1),
        speed
      });
    }
    if (command === "player.pause") {
      const audio = ensureSharedBrowserAudio();
      await audio.pause();
      return syncSharedBrowserPlayerState({ render: true });
    }
    if (command === "player.seek") {
      const audio = ensureSharedBrowserAudio();
      const positionMs = Math.max(0, Math.round(Number(args.position_ms || 0)));
      if (positionMs) {
        audio.currentTime = positionMs / 1000;
      } else if (audio.currentTime) {
        audio.currentTime = 0;
      }
      return syncSharedBrowserPlayerState({
        position_ms: positionMs,
        render: true
      });
    }
    if (command === "player.speed") {
      const speed = Math.max(0.5, Math.min(3, Number(args.speed || 1)));
      const audio = ensureSharedBrowserAudio();
      audio.playbackRate = speed;
      if (state.activePath) {
        state.speedByPath.set(normalizePath(state.activePath), speed);
        persistAudioState();
      }
      return syncSharedBrowserPlayerState({
        speed,
        render: true
      });
    }
    if (command === "artifact.read_base64") {
      return fetchArtifactBase64(args.path, args.max_bytes);
    }
    if (command === "artifact.url") {
      const url = await resolveBrowserArtifactUrl(args.path);
      return {
        schema: "pucky.artifact_url.v1",
        url,
        mime_type: guessMediaMime(args.path || url),
        bytes: 0
      };
    }
    throw new Error(`Unsupported browser mock command: ${command}`);
  }

  async function fetchArtifactBase64(path, maxBytes = 0) {
    const artifactUrl = await resolveBrowserArtifactUrl(path);
    const response = await fetchArtifactHttpResponse(artifactUrl, "Artifact");
    const buffer = await response.arrayBuffer();
    const bytes = Number(buffer.byteLength || 0);
    const limit = Math.max(0, Number(maxBytes || 0));
    if (limit && bytes > limit) {
      throw new Error(`Artifact exceeds max_bytes (${bytes} > ${limit})`);
    }
    return {
      schema: "pucky.artifact_base64.v1",
      path: String(path || ""),
      url: artifactUrl,
      mime_type: String(response.headers.get("content-type") || "").split(";", 1)[0].trim() || guessMediaMime(path || artifactUrl),
      bytes,
      content_base64: base64FromBytes(buffer)
    };
  }

  async function resolveBrowserArtifactUrl(path) {
    const value = String(path || "").trim();
    if (!value) {
      throw new Error("artifact path is missing");
    }
    if (/^(data|blob|https?):/i.test(value)) {
      return value;
    }
    if (value.startsWith("/")) {
      return new URL(value, window.location.origin).toString();
    }
    return new URL(value, window.location.href).toString();
  }

  function base64FromBytes(buffer) {
    const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer || []);
    let binary = "";
    const chunkSize = 0x8000;
    for (let index = 0; index < bytes.length; index += chunkSize) {
      binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
    }
    return btoa(binary);
  }

  const HOME_FEED_LIMIT = 100;

  function feedApiBaseUrl() {
    if (state.links.apiBaseUrl) {
      return state.links.apiBaseUrl;
    }
    return resolveHostedBrowserApiBaseUrl();
  }

  function feedApiPath(options = {}) {
    const params = new URLSearchParams();
    params.set("limit", String(Math.max(1, Number(options.limit || HOME_FEED_LIMIT) || HOME_FEED_LIMIT)));
    params.set("include_archived", options.includeArchived ? "1" : "0");
    params.set("compact", "1");
    if (options.cursor) {
      params.set("cursor", String(options.cursor));
    }
    return `/api/feed?${params.toString()}`;
  }

  async function feedApiRequest(path, options = {}) {
    await ensureLinksApiConfig();
    const method = String(options.method || "GET").toUpperCase();
    const startedAt = perfNowMs();
    const metricKey = String(options.metricKey || `feed:${String(path || "").split("?")[0] || "/"}`).trim();
    const init = {
      method,
      cache: String(options.cache || "no-store"),
      headers: { Accept: "application/json" }
    };
    Object.assign(init.headers, await protectedApiAuthorizationHeaders({ method, authorized: options.authorized === true }));
    if (options.body !== undefined) {
      init.headers["Content-Type"] = "application/json";
      init.body = JSON.stringify(options.body);
    }
    try {
      const response = await fetch(`${feedApiBaseUrl()}${path}`, init);
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(String(payload && (payload.detail || payload.error) || `Feed request failed (${response.status})`));
      }
      recordPerfFetch(metricKey, startedAt, true);
      return payload;
    } catch (error) {
      recordPerfFetch(metricKey, startedAt, false, error && error.message ? error.message : String(error || ""));
      throw error;
    }
  }

  async function workspaceApiRequest(path, options = {}) {
    await ensureLinksApiConfig();
    const method = String(options.method || "GET").toUpperCase();
    const startedAt = perfNowMs();
    const metricKey = String(options.metricKey || `workspace:${String(path || "").split("?")[0] || "/"}`).trim();
    const init = {
      method,
      cache: String(options.cache || "no-store"),
      headers: { Accept: "application/json" }
    };
    Object.assign(init.headers, await protectedApiAuthorizationHeaders({ method, authorized: options.authorized === true }));
    if (options.body !== undefined) {
      init.headers["Content-Type"] = "application/json";
      init.body = JSON.stringify(options.body);
    }
    try {
      const response = await fetch(`${linksApiBaseUrl()}${path}`, init);
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(String(payload && (payload.detail || payload.error) || `Workspace request failed (${response.status})`));
      }
      recordPerfFetch(metricKey, startedAt, true);
      return payload;
    } catch (error) {
      recordPerfFetch(metricKey, startedAt, false, error && error.message ? error.message : String(error || ""));
      throw error;
    }
  }

  async function patchWorkspaceRecord(collection, recordId, payload) {
    const id = String(recordId || "").trim();
    return workspaceApiRequest(`/api/workspace/${encodeURIComponent(collection)}/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: payload
    });
  }

  async function createWorkspaceAsset(payload) {
    return workspaceApiRequest("/api/workspace/assets", {
      method: "POST",
      body: payload
    });
  }

  function workspaceQuery(collection, options = {}) {
    const params = new URLSearchParams();
    params.set("limit", String(Math.max(1, Number(options.limit || 200) || 200)));
    if (options.includeArchived) params.set("include_archived", "1");
    if (options.includeDeleted) params.set("include_deleted", "1");
    if (options.date) params.set("date", String(options.date));
    const query = params.toString();
    return `/api/workspace/${collection}${query ? `?${query}` : ""}`;
  }

  function workspaceCollectionLabel(collection) {
    return WORKSPACE_COLLECTION_LABELS[String(collection || "")] || "workspace records";
  }

  function workspaceCollectionStaleMs(collection) {
    switch (String(collection || "").trim()) {
      case "tasks":
        return WORKSPACE_TASK_STALE_VISIBLE_MS;
      case "reminders":
        return WORKSPACE_REMINDER_STALE_VISIBLE_MS;
      default:
        return 30000;
    }
  }

  function workspaceQueryKey(collection, options = {}) {
    return "";
  }

  function workspaceCacheEntry(bucket, queryKey) {
    if (!bucket || !queryKey || !(bucket.queryCache && typeof bucket.queryCache === "object")) {
      return null;
    }
    const cached = bucket.queryCache[queryKey];
    return cached && typeof cached === "object" ? cached : null;
  }

  function rememberWorkspaceCache(bucket, queryKey, items, fingerprint, lastRefreshAt) {
    if (!bucket || !queryKey) {
      return;
    }
    const nextCache = bucket.queryCache && typeof bucket.queryCache === "object"
      ? { ...bucket.queryCache }
      : {};
    nextCache[queryKey] = {
      items: Array.isArray(items) ? items.slice() : [],
      fingerprint: String(fingerprint || ""),
      lastRefreshAt: safeNumber(lastRefreshAt)
    };
    const keys = Object.keys(nextCache).sort((left, right) => {
      const leftTime = safeNumber(nextCache[left] && nextCache[left].lastRefreshAt);
      const rightTime = safeNumber(nextCache[right] && nextCache[right].lastRefreshAt);
      return rightTime - leftTime;
    });
    while (keys.length > 5) {
      const staleKey = keys.pop();
      if (!staleKey) {
        break;
      }
      delete nextCache[staleKey];
    }
    bucket.queryCache = nextCache;
  }

  function workspaceRecordCacheEntry(bucket, recordId) {
    const id = String(recordId || "").trim();
    if (!bucket || !id || !(bucket.recordCache && typeof bucket.recordCache === "object")) {
      return null;
    }
    const cached = bucket.recordCache[id];
    return cached && typeof cached === "object" ? cached : null;
  }

  function rememberWorkspaceRecord(bucket, record, lastRefreshAt = Date.now()) {
    const id = String(record?.id || record?.record_id || "").trim();
    if (!bucket || !id || !record || typeof record !== "object") {
      return false;
    }
    const nextFingerprint = stableJsonFingerprint(record);
    const previous = workspaceRecordCacheEntry(bucket, id);
    if (previous && previous.fingerprint === nextFingerprint) {
      return false;
    }
    const nextCache = bucket.recordCache && typeof bucket.recordCache === "object"
      ? { ...bucket.recordCache }
      : {};
    nextCache[id] = {
      record,
      fingerprint: nextFingerprint,
      lastRefreshAt: safeNumber(lastRefreshAt) || Date.now()
    };
    bucket.recordCache = nextCache;
    return true;
  }

  async function loadWorkspaceRecord(collection, recordId, options = {}) {
    const bucket = state.workspace[collection];
    const id = String(recordId || "").trim();
    if (!bucket || !id) {
      return null;
    }
    const cached = workspaceRecordCacheEntry(bucket, id);
    const staleMs = workspaceCollectionStaleMs(collection);
    if (!options.force && cached && (Date.now() - safeNumber(cached.lastRefreshAt)) < Math.max(1000, staleMs)) {
      return cached.record || null;
    }
    if (!(bucket.recordLoading && typeof bucket.recordLoading === "object")) {
      bucket.recordLoading = {};
    }
    if (bucket.recordLoading[id]) {
      return cached?.record || null;
    }
    bucket.recordLoading = { ...bucket.recordLoading, [id]: true };
    try {
      await ensureLinksApiConfig();
      const payload = await workspaceApiRequest(`/api/workspace/${encodeURIComponent(collection)}/${encodeURIComponent(id)}`, {
        metricKey: `workspace:${collection}:record`
      });
      const changed = rememberWorkspaceRecord(bucket, payload, Date.now());
      if (options.render && changed) {
        requestRender(`workspace:${collection}:record:${String(options.reason || "refresh")}`);
      }
      return payload;
    } catch (_) {
      return cached?.record || null;
    } finally {
      const nextLoading = { ...(bucket.recordLoading || {}) };
      delete nextLoading[id];
      bucket.recordLoading = nextLoading;
    }
  }

  function applyWorkspaceCacheEntry(bucket, queryKey, entry) {
    if (!bucket || !entry || typeof entry !== "object") {
      return false;
    }
    const nextItems = Array.isArray(entry.items) ? entry.items.slice() : [];
    const nextFingerprint = String(entry.fingerprint || stableJsonFingerprint(nextItems));
    const changed = bucket.fingerprint !== nextFingerprint || String(bucket.queryKey || "") !== queryKey || !bucket.loaded;
    const refreshedAt = safeNumber(entry.lastRefreshAt) || Date.now();
    nextItems.forEach(item => rememberWorkspaceRecord(bucket, item, refreshedAt));
    bucket.items = nextItems;
    bucket.fingerprint = nextFingerprint;
    bucket.queryKey = String(queryKey || "");
    bucket.loaded = true;
    bucket.loading = false;
    bucket.error = "";
    bucket.lastRefreshAt = refreshedAt;
    bucket.dirty = false;
    return changed;
  }

  async function loadWorkspaceCollection(collection, options = {}) {
    const bucket = state.workspace[collection];
    if (!bucket || (bucket.loading && options.preload !== true)) {
      return;
    }
    const queryKey = workspaceQueryKey(collection, options);
    const staleMs = workspaceCollectionStaleMs(collection);
    const cachedEntry = workspaceCacheEntry(bucket, queryKey);
    const cachedFresh = Boolean(
      cachedEntry
      && !bucket.dirty
      && (Date.now() - safeNumber(cachedEntry.lastRefreshAt)) < Math.max(1000, staleMs)
    );
    if (!options.force && cachedEntry && (cachedFresh || options.allowCachedRender === true)) {
      recordPerfCacheHit(`workspace:${collection}`);
      recordPerfRouteDataStart(`workspace:${collection}:cache`);
      const changedFromCache = applyWorkspaceCacheEntry(bucket, queryKey, cachedEntry);
      recordPerfRouteDataEnd(`workspace:${collection}:cache`);
      if (options.render && changedFromCache) {
        requestRender(`workspace:${collection}:${String(options.reason || "cache")}`);
      }
      if (cachedFresh) {
        return changedFromCache;
      }
    }
    const hadError = Boolean(bucket.error);
    if (options.preload !== true) {
      bucket.loading = true;
      bucket.error = "";
    }
    let changed = !bucket.loaded || hadError;
    try {
      await ensureLinksApiConfig();
      const date = String(options.date || "");
      recordPerfRouteDataStart(`workspace:${collection}`);
      const payload = await workspaceApiRequest(workspaceQuery(collection, { date, includeArchived: Boolean(options.includeArchived) }), {
        metricKey: `workspace:${collection}`
      });
      const nextItems = Array.isArray(payload && payload.items) ? payload.items : [];
      const nextFingerprint = stableJsonFingerprint(nextItems);
      const refreshedAt = Date.now();
      nextItems.forEach(item => rememberWorkspaceRecord(bucket, item, refreshedAt));
      rememberWorkspaceCache(bucket, queryKey, nextItems, nextFingerprint, refreshedAt);
      if (options.preload !== true && (bucket.fingerprint !== nextFingerprint || String(bucket.queryKey || "") !== queryKey)) {
        bucket.items = nextItems;
        bucket.fingerprint = nextFingerprint;
        bucket.queryKey = queryKey;
        changed = true;
      } else if (options.preload !== true) {
        recordPerfUnchangedRefreshSkip(`workspace:${collection}`);
      }
      if (options.preload !== true) {
        bucket.loaded = true;
        bucket.lastRefreshAt = refreshedAt;
        bucket.dirty = false;
      }
      recordPerfRouteDataEnd(`workspace:${collection}`);
    } catch (error) {
      if (options.preload !== true) {
        bucket.error = String(error && error.message || error || "Workspace request failed");
        changed = true;
      }
    } finally {
      if (options.preload !== true) {
        bucket.loading = false;
      }
    }
    if (options.render && (changed || options.renderWhenUnchanged === true)) {
      requestRender(`workspace:${collection}:${String(options.reason || "refresh")}`);
    }
    return changed;
  }

  async function loadWorkspaceForRoute(route = state.route, options = {}) {
    if (String(route || "").trim() === "home") {
      await loadWorkspaceCollection("reminders", options);
      return;
    }
    const collection = WORKSPACE_ROUTE_COLLECTIONS[String(route || "")];
    if (!collection) {
      return;
    }
    const queryKey = workspaceRouteQueryKey(route, options);
    if (!options.force && !workspaceBucketNeedsRefresh(collection, workspaceCollectionStaleMs(collection), { queryKey })) {
      return false;
    }
    return loadWorkspaceCollection(collection, {
      ...options,
      queryKey
    });
  }

  function workspaceItems(collection) {
    return Array.isArray(state.workspace[collection]?.items) ? state.workspace[collection].items : [];
  }

  function workspaceBucket(collection) {
    return state.workspace[collection] || {
      items: [],
      loaded: false,
      loading: false,
      error: ""
    };
  }

  function normalizeFeedSnapshot(payload, source = "vm") {
    const cards = Array.isArray(payload?.items)
      ? payload.items
      : Array.isArray(payload?.cards)
        ? payload.cards
        : [];
    return {
      schema: "pucky.reply_cards.v1",
      source,
      count: cards.length,
      cards,
      next_cursor: String(payload?.next_cursor || ""),
      has_more: Boolean(payload?.has_more)
    };
  }

  function applyFeedSnapshot(snapshot, options = {}) {
    state.cards = Array.isArray(snapshot?.cards) ? snapshot.cards : [];
    state.feedSource = String(snapshot?.source || "unknown");
    state.feedLastAppliedAt = Date.now();
    state.feedLoadError = "";
    reconcileInboxManageSelection();
    reconcileReadOverrides();
    reconcileFocusedCardSelection();
    clearMissingFeedIconFilter();
    if (options.render !== false) {
      render();
    }
    return {
      schema: "pucky.reply_cards.v1",
      source: String(snapshot?.source || "unknown"),
      count: state.cards.length,
      cards: state.cards,
      next_cursor: String(snapshot?.next_cursor || ""),
      has_more: Boolean(snapshot?.has_more)
    };
  }

  async function fetchVmFeedSnapshot(options = {}) {
    const payload = await feedApiRequest(feedApiPath(options));
    return normalizeFeedSnapshot(payload, "vm");
  }

  async function syncFeedCards(options = {}) {
    const reason = options.reason || "feed_sync";
    try {
      recordPerfRouteDataStart("inbox:feed");
      const snapshot = await fetchVmFeedSnapshot({ includeArchived: Boolean(options.includeArchived || state.showArchivedFeed) });
      const applied = applyFeedSnapshot(snapshot, { render: options.render !== false });
      recordPerfRouteDataEnd("inbox:feed");
      await syncVoiceThreadScope({ reason: `feed_sync:${reason}`, render: true });
      return applied;
    } catch (error) {
      state.feedLoadError = error instanceof Error ? error.message : String(error || "Feed unavailable");
      if (!options.silent) {
        throw error;
      }
      if (options.render !== false) {
        render();
      }
      return { schema: "pucky.reply_cards.v1", source: "error", count: state.cards.length, cards: state.cards };
    }
  }

  async function loadCards() {
    await syncFeedCards({ reason: "load_cards", silent: true, render: true, authoritative: true });
    restoreNavStateAfterCards();
    void syncVoiceThreadScope({ reason: "load_cards", render: true });
  }

  async function refreshCardsFromVmSnapshot(options = {}) {
    if (state.vmFeedSnapshotPromise) {
      return state.vmFeedSnapshotPromise;
    }
    const turnId = turnStatusTurnId(state.turn);
    recordTurnUiEvent("feed_vm_refresh_start", {
      turn_id: turnId,
      reason: String(options.reason || "vm_snapshot")
    });
    state.vmFeedSnapshotPromise = (async () => {
      try {
        await syncFeedCards({
          reason: String(options.reason || "vm_snapshot"),
          silent: true,
          render: false
        });
        if (options.render !== false) {
          render();
          restoreNavStateAfterCards();
          syncOpenThreadDetailAfterCards();
        }
        recordTurnUiEvent("feed_vm_refresh_complete", {
          turn_id: turnId,
          reason: String(options.reason || "vm_snapshot"),
          card_count: state.cards.length,
          source: state.feedSource
        });
        return { cards: state.cards };
      } catch (_) {
        return { cards: state.cards };
      } finally {
        state.vmFeedSnapshotPromise = null;
      }
    })();
    return state.vmFeedSnapshotPromise;
  }

  function cloneCachedBridgeValue(value) {
    try {
      return JSON.parse(JSON.stringify(value));
    } catch (_) {
      return value;
    }
  }

  function bridgeReadCacheKey(command, args = {}) {
    return `${String(command || "").trim()}\u001f${stableJsonFingerprint(args && typeof args === "object" ? args : {})}`;
  }

  function readBridgeCache(command, args = {}, ttlMs = PERF_BRIDGE_CACHE_TTL_MS) {
    const key = bridgeReadCacheKey(command, args);
    const entry = bridgeReadCache.get(key);
    if (!entry) {
      return null;
    }
    if ((Date.now() - safeNumber(entry.at)) >= Math.max(1000, safeNumber(ttlMs, PERF_BRIDGE_CACHE_TTL_MS))) {
      bridgeReadCache.delete(key);
      return null;
    }
    recordPerfCacheHit(`bridge:${String(command || "").trim()}`);
    return cloneCachedBridgeValue(entry.value);
  }

  function writeBridgeCache(command, args = {}, value) {
    const key = bridgeReadCacheKey(command, args);
    bridgeReadCache.set(key, {
      at: Date.now(),
      value: cloneCachedBridgeValue(value)
    });
  }

  function invalidateBridgeReadCache(command) {
    const prefix = `${String(command || "").trim()}\u001f`;
    for (const key of Array.from(bridgeReadCache.keys())) {
      if (key.startsWith(prefix)) {
        bridgeReadCache.delete(key);
      }
    }
  }

  async function cachedBridgeRead(command, args = {}, options = {}) {
    const ttlMs = Math.max(0, safeNumber(options.ttlMs, PERF_BRIDGE_CACHE_TTL_MS));
    if (!options.force && ttlMs > 0) {
      const cached = readBridgeCache(command, args, ttlMs);
      if (cached !== null) {
        return cached;
      }
    }
    const snapshot = await Pucky.request({ command, args });
    if (ttlMs > 0) {
      writeBridgeCache(command, args, snapshot);
    }
    return snapshot;
  }

  async function loadTurnStatus(options = {}) {
    const before = stableJsonFingerprint(normalizeTurnStatus(state.turn));
    try {
      const snapshot = await Pucky.request({ command: "pucky.turn.status", args: {} });
      applyTurnStatus(snapshot);
      const changed = before !== stableJsonFingerprint(normalizeTurnStatus(state.turn));
      if (options.render && changed) {
        requestRender("turn_status");
      }
      return changed;
    } catch (_) {
      // The bridge can be briefly unavailable during WebView startup.
      return false;
    }
  }

  async function loadTurnSettings(options = {}) {
    try {
      const snapshot = await cachedBridgeRead("pucky.turn.settings.get", {}, options);
      state.turnSettings = normalizeTurnSettings(snapshot);
      if (options.render) {
        render();
      }
    } catch (_) {
      // Browser previews and early WebView startup keep the default card-only mode.
    }
  }

  async function loadWakeStatus(options = {}) {
    const before = stableJsonFingerprint(normalizeWakeStatus(state.wakeStatus));
    try {
      const snapshot = await cachedBridgeRead("wake.status", {}, options);
      state.wakeStatus = normalizeWakeStatus(snapshot);
      const changed = before !== stableJsonFingerprint(normalizeWakeStatus(state.wakeStatus));
      if (options.render && changed) {
        requestRender("wake_status");
      }
      return changed;
    } catch (_) {
      // Keep the current placeholder wake state if the bridge is not ready yet.
      return false;
    }
  }

  async function loadUiSurfaceStatus(options = {}) {
    try {
      const snapshot = await cachedBridgeRead("ui.surface.get", {}, options);
      state.uiSurface = normalizeUiSurfaceStatus(snapshot);
      syncPerfDebugRuntimeBudgets();
      if (options.render) {
        render();
      }
    } catch (_) {
      // Local browser preview keeps a synthetic bundle_current status.
    }
  }

  async function loadDefaultAudioSpeed(options = {}) {
    try {
      const snapshot = await cachedBridgeRead("ui.default_audio_speed.get", {}, options);
      state.defaultAudioSpeed = clampSpeed(snapshot && snapshot.speed);
      state.defaultAudioSpeedAvailable = true;
    } catch (_) {
      state.defaultAudioSpeed = 1;
      state.defaultAudioSpeedAvailable = false;
    }
    if (options.render) {
      render();
    }
  }

  async function loadPhoneRoleStatus(options = {}) {
    const hasNativeBridge = Boolean(window.PuckyAndroid && typeof window.PuckyAndroid.postMessage === "function");
    if (hasNativeBridge) {
      try {
        const snapshot = await cachedBridgeRead("phone.role.status", {}, options);
        state.phoneRole = normalizePhoneRoleStatus({
          ...snapshot,
          source: "native_bridge",
          read_only: false,
          loaded: true,
          error_code: "",
          error_detail: ""
        });
      } catch (error) {
        state.phoneRole = normalizePhoneRoleStatus({
          ...state.phoneRole,
          source: "native_bridge",
          read_only: false,
          loaded: false,
          error_code: "broker_command_failed",
          error_detail: String(error && error.message || "")
        });
      }
    } else {
      state.phoneRole = unavailableBrowserPhoneRoleStatus("preview_unavailable", {
        source: "preview_unavailable",
        loaded: true
      });
    }
    if (options.render) {
      render();
    }
  }

  function unavailableBrowserPhoneRoleStatus(errorCode, overrides = {}) {
    return normalizePhoneRoleStatus({
      schema: "pucky.phone_role_status.v1",
      state: "unavailable",
      role_held: false,
      eligible: false,
      role_available: false,
      package_name: "com.pucky.device.debug",
      default_dialer_package: "",
      default_dialer_label: "",
      stock_incall_ui_replaced_when_held: true,
      source: "preview_unavailable",
      read_only: true,
      loaded: false,
      error_code: String(errorCode || "preview_unavailable").trim() || "preview_unavailable",
      error_detail: "",
      device_id: String(state.links && state.links.deviceId || "").trim(),
      ...overrides
    });
  }

  let nativeBootstrapPromise = null;

  function hasNativeBootstrapBridge() {
    return Boolean(window.PuckyAndroid && typeof window.PuckyAndroid.postMessage === "function");
  }

  function applyNativeBootstrapSnapshot(snapshot) {
    const raw = snapshot && typeof snapshot === "object" ? snapshot : {};
    const config = raw.config && typeof raw.config === "object" ? raw.config : {};
    const provisioning = raw.provisioning && typeof raw.provisioning === "object" ? raw.provisioning : {};
    if (raw.ui_surface && typeof raw.ui_surface === "object") {
      state.uiSurface = normalizeUiSurfaceStatus(raw.ui_surface);
      writeBridgeCache("ui.surface.get", {}, raw.ui_surface);
    }
    if (raw.turn_status && typeof raw.turn_status === "object") {
      applyTurnStatus(raw.turn_status);
      writeBridgeCache("pucky.turn.status", {}, raw.turn_status);
    }
    if (raw.turn_settings && typeof raw.turn_settings === "object") {
      state.turnSettings = normalizeTurnSettings(raw.turn_settings);
      writeBridgeCache("pucky.turn.settings.get", {}, raw.turn_settings);
    }
    if (raw.wake_status && typeof raw.wake_status === "object") {
      state.wakeStatus = normalizeWakeStatus(raw.wake_status);
      writeBridgeCache("wake.status", {}, raw.wake_status);
    }
    if (raw.phone_role && typeof raw.phone_role === "object") {
      state.phoneRole = normalizePhoneRoleStatus(raw.phone_role);
      writeBridgeCache("phone.role.status", {}, raw.phone_role);
    }
    if (raw.default_audio_speed && typeof raw.default_audio_speed === "object") {
      state.defaultAudioSpeed = clampSpeed(raw.default_audio_speed && raw.default_audio_speed.speed);
      state.defaultAudioSpeedAvailable = true;
      writeBridgeCache("ui.default_audio_speed.get", {}, raw.default_audio_speed);
    }
    if (config && typeof config === "object") {
      state.links.apiBaseUrl = String(config.api_base_url || "").trim().replace(/\/$/, "");
      state.links.apiToken = String(config.api_token || "").trim();
      writeBridgeCache("pucky.config.get", {}, config);
    }
    if (String(provisioning.device_id || "").trim()) {
      state.links.deviceId = String(provisioning.device_id || "").trim();
    }
    perfDebugState.bootstrap_snapshot_used = true;
    syncPerfDebugRuntimeBudgets();
    return raw;
  }

  async function loadNativeBootstrapSnapshot(options = {}) {
    if (!hasNativeBootstrapBridge()) {
      return null;
    }
    if (!options.force && nativeBootstrapPromise) {
      return nativeBootstrapPromise;
    }
    nativeBootstrapPromise = (async () => {
      const snapshot = await cachedBridgeRead("ui.bootstrap.get", {}, {
        force: Boolean(options.force),
        ttlMs: Math.max(1000, safeNumber(options.ttlMs, PERF_BRIDGE_CACHE_TTL_MS))
      });
      return applyNativeBootstrapSnapshot(snapshot);
    })();
    try {
      const snapshot = await nativeBootstrapPromise;
      if (options.render) {
        requestRender("native_bootstrap");
      }
      return snapshot;
    } finally {
      nativeBootstrapPromise = null;
    }
  }

  async function loadSettingsState(options = {}) {
    if (hasNativeBootstrapBridge()) {
      try {
        await loadNativeBootstrapSnapshot({ render: false, force: Boolean(options.force) });
      } catch (_) {
        // Fall through to explicit bridge reads when bootstrap is unavailable.
      }
      if (options.ensureSurface !== false && ensureSettingsSurfaceCurrent()) {
        return;
      }
      if (options.render) {
        render();
      }
      void Promise.all([
        loadPhoneRoleStatus({ render: false, force: true }),
        loadDefaultAudioSpeed({ render: false, force: true }),
        loadTurnSettings({ render: false, force: true }),
        loadWakeStatus({ render: false, force: true }),
        loadUiSurfaceStatus({ render: false, force: true })
      ]).then(() => {
        if (options.ensureSurface !== false && ensureSettingsSurfaceCurrent()) {
          return;
        }
        if (options.render) {
          requestRender("settings_quiet_refresh");
        }
      });
      return;
    }
    await Promise.all([
      loadPhoneRoleStatus({ render: false }),
      loadDefaultAudioSpeed({ render: false }),
      loadTurnSettings({ render: false }),
      loadWakeStatus({ render: false }),
      loadUiSurfaceStatus({ render: false })
    ]);
    if (options.ensureSurface !== false && ensureSettingsSurfaceCurrent()) {
      return;
    }
    if (options.render) {
      render();
    }
  }

  function normalizeLinksPortalPayload(payload) {
    return {
      portal_url: String(payload && (payload.portal_url || payload.url) || ""),
      token: String(payload && payload.token || ""),
      auth_mode: String(payload && payload.auth_mode || "browser"),
      available: payload ? payload.ok !== false : false,
      error: String(payload && payload.error || "")
    };
  }

  function bundledLinksCatalogPayload() {
    const payload = window.PUCKY_LINKS_CATALOG && typeof window.PUCKY_LINKS_CATALOG === "object"
      ? window.PUCKY_LINKS_CATALOG
      : {};
    return {
      apps: Array.isArray(payload && payload.apps) ? payload.apps : [],
      total: safeNumber(payload && payload.total),
      generated_at: String(payload && payload.generated_at || ""),
      catalog_version: String(payload && payload.catalog_version || ""),
      schema: String(payload && payload.schema || "pucky.links_catalog_bundle.v1")
    };
  }

  function normalizeLinksApp(item) {
    const authSchemes = Array.isArray(item && item.auth_schemes) ? item.auth_schemes : [];
    const managedAuthSchemes = Array.isArray(item && item.managed_auth_schemes) ? item.managed_auth_schemes : [];
    return {
      slug: String(item && item.slug || "").trim(),
      name: String(item && (item.name || item.slug) || "").trim(),
      logo: String(item && item.logo || "").trim(),
      logo_path: String(item && item.logo_path || "").trim(),
      logo_source_url: String(item && item.logo_source_url || item.logo || "").trim(),
      auth_schemes: authSchemes.map(value => String(value || "").trim().toUpperCase()).filter(Boolean),
      managed_auth_schemes: managedAuthSchemes.map(value => String(value || "").trim().toUpperCase()).filter(Boolean),
      auth_label: String(item && item.auth_label || "").trim(),
      state: String(item && item.state || "not-connected").trim(),
      counts: item && typeof item.counts === "object" ? item.counts : { total: 0, active: 0, pending: 0, expired: 0 }
    };
  }

  function hydrateBundledLinksCatalog(options = {}) {
    if (!options.force && state.links.firstPageReady && state.links.apps.length) {
      return;
    }
    recordPerfRouteDataStart("connect:catalog_bundle");
    const payload = bundledLinksCatalogPayload();
    const apps = payload.apps.map(normalizeLinksApp).filter(item => item.slug && item.name);
    apps.sort((a, b) => String(a.name || a.slug).localeCompare(String(b.name || b.slug)));
    state.links.apps = apps;
    state.links.totalAvailable = Math.max(payload.total, apps.length);
    state.links.catalogVersion = payload.catalog_version;
    state.links.catalogGeneratedAt = payload.generated_at;
    state.links.catalogSource = "bundle";
    state.links.firstPageReady = true;
    if (!state.links.catalogTelemetrySent) {
      state.links.catalogTelemetrySent = true;
      linksDebugRecord(
        "catalog_loaded_from_bundle",
        {
          total_count: state.links.totalAvailable,
          catalog_version: state.links.catalogVersion,
          generated_at: state.links.catalogGeneratedAt,
          catalog_source: state.links.catalogSource,
          catalog_schema: payload.schema
        },
        "route"
      );
    }
    recordPerfRouteDataEnd("connect:catalog_bundle");
  }

  function resetLinksCatalogState(options = {}) {
    state.links.apps = [];
    if (options.clearConnected === true) {
      state.links.connectedApps = [];
      state.links.connectedSlugs = new Set();
      state.links.connectedLoaded = false;
      state.links.userId = "";
    }
    state.links.totalAvailable = 0;
    state.links.lastRefreshAt = 0;
    state.links.firstPageReady = false;
    state.links.catalogVersion = "";
    state.links.catalogGeneratedAt = "";
    state.links.catalogSource = "";
    state.links.catalogTelemetrySent = false;
    if (options.keepSearch !== true) {
      state.links.search = "";
    }
  }

  function linksCountLabel(filtered) {
    const totalAvailable = safeNumber(state.links.totalAvailable);
    if (totalAvailable > 0 && filtered.length !== totalAvailable) {
      return `${filtered.length}/${totalAvailable}`;
    }
    return filtered.length || totalAvailable ? String(filtered.length || totalAvailable) : "";
  }

  let linksLogoObserver = null;

  function createLinksIconFallback() {
    const fallback = el("span", "links-app-icon-fallback");
    fallback.innerHTML = iconSvg("apps", { filled: false });
    return fallback;
  }

  function loadLinksIconImage(icon, app) {
    if (!icon || icon.dataset.linksLogoLoaded === "1" || icon.dataset.linksLogoLoading === "1") {
      return;
    }
    const logoPath = String(app && app.logo_path || "").trim();
    if (!logoPath) {
      return;
    }
    icon.dataset.linksLogoLoading = "1";
    const img = document.createElement("img");
    img.className = "links-app-logo";
    img.src = logoPath;
    img.alt = "";
    img.loading = "lazy";
    img.decoding = "async";
    img.fetchPriority = "low";
    img.addEventListener("load", () => {
      icon.classList.add("has-image");
      icon.dataset.linksLogoLoaded = "1";
      delete icon.dataset.linksLogoLoading;
      state.links.logoLoads += 1;
    });
    img.addEventListener("error", () => {
      state.links.logoErrors += 1;
      delete icon.dataset.linksLogoLoading;
      img.remove();
    });
    icon.append(img);
  }

  function observeLinksIconImage(icon, app) {
    const logoPath = String(app && app.logo_path || "").trim();
    if (!logoPath) {
      return;
    }
    if (typeof IntersectionObserver !== "function") {
      loadLinksIconImage(icon, app);
      return;
    }
    if (!linksLogoObserver) {
      linksLogoObserver = new IntersectionObserver(entries => {
        entries.forEach(entry => {
          if (!entry.isIntersecting) {
            return;
          }
          const target = entry.target;
          linksLogoObserver.unobserve(target);
          const slug = String(target && target.dataset.linksLogoSlug || "").trim();
          const appRow = Array.isArray(state.links.apps) ? state.links.apps.find(item => String(item.slug || "") === slug) : null;
          loadLinksIconImage(target, appRow);
        });
      }, {
        root: linksScrollElement(),
        rootMargin: "240px 0px 240px 0px",
      });
    }
    icon.dataset.linksLogoSlug = String(app && app.slug || "").trim();
    linksLogoObserver.observe(icon);
  }

  function createLinksRow(app, index, handoffLocked) {
    const row = el("button", "links-app-row");
    row.type = "button";
    row.dataset.linksSlug = String(app.slug || "");
    row.dataset.linksIndex = String(index);
    row.disabled = handoffLocked;
    row.classList.toggle("is-opening", handoffLocked && state.links.openingSlug === app.slug);

    const icon = el("span", "links-app-icon");
    icon.append(createLinksIconFallback());
    observeLinksIconImage(icon, app);

    const name = el("span", "links-app-name", app.name || app.slug);
    const auth = el("span", "links-app-auth", linksAuthLabelForApp(app));
    const mark = el("span", state.links.connectedSlugs.has(app.slug) ? "links-app-mark is-connected" : "links-app-mark");

    row.append(icon, name, auth, mark);
    row.addEventListener("click", () => {
      if (hostedConnectReadOnlyMode() && !String(state.links.apiToken || state.links.token || "").trim()) {
        state.links.error = "";
        state.links.message = "Open Connect with ?api_token=... to launch app auth flows in browser.";
        state.links.messageKind = "";
        render();
        return;
      }
      void openLinksAuthFlow(app);
    });
    return row;
  }

  function syncLinksRowStates(refs, handoffLocked) {
    if (!refs || !refs.rows) {
      return;
    }
    refs.rows.querySelectorAll(".links-app-row").forEach(row => {
      const slug = String(row.dataset.linksSlug || "");
      row.disabled = handoffLocked;
      row.classList.toggle("is-opening", handoffLocked && state.links.openingSlug === slug);
      const mark = row.querySelector(".links-app-mark");
      if (mark) {
        mark.classList.toggle("is-connected", state.links.connectedSlugs.has(slug));
      }
    });
  }

  function linksAuthLabelForApp(app) {
    const fromPayload = String(app && app.auth_label || "").trim();
    if (fromPayload) {
      return fromPayload;
    }
    const labels = [];
    const seen = new Set();
    [app && app.managed_auth_schemes, app && app.auth_schemes].forEach(source => {
      (Array.isArray(source) ? source : []).forEach(raw => {
        const key = String(raw || "").trim().toUpperCase();
        if (!key || seen.has(key)) {
          return;
        }
        const label = LINKS_AUTH_SCHEME_LABELS[key];
        if (!label) {
          return;
        }
        seen.add(key);
        labels.push(label);
      });
    });
    return labels.join(" + ");
  }

  function blankLinksHandoffState() {
    return {
      at: "",
      event: "",
      slug: "",
      auth_url: "",
      launched: false,
      launch_surface: "",
      popup_opened: false,
      same_tab_navigation: false,
      error: ""
    };
  }

  function linksDebugRoot() {
    if (!window.__PUCKY_LINKS_DEBUG__ || typeof window.__PUCKY_LINKS_DEBUG__ !== "object") {
      window.__PUCKY_LINKS_DEBUG__ = {
        schema: "pucky.links_debug.v1",
        route_sessions: [],
        click_sessions: [],
        last_event: null,
        last_handoff: blankLinksHandoffState()
      };
    }
    return window.__PUCKY_LINKS_DEBUG__;
  }

  function linksDebugNow() {
    if (typeof performance !== "undefined" && performance && typeof performance.now === "function") {
      return performance.now();
    }
    return Date.now();
  }

  function linksDebugSession(kind) {
    const root = linksDebugRoot();
    const sessionId = kind === "click" ? state.links.debugClickSessionId : state.links.debugRouteSessionId;
    if (!sessionId) {
      return null;
    }
    const list = kind === "click" ? root.click_sessions : root.route_sessions;
    return list.find(item => item && item.id === sessionId) || null;
  }

  function linksDebugSnapshot(extra = {}) {
    let renderedRows = 0;
    try {
      renderedRows = document.querySelectorAll(".links-app-row").length;
    } catch (_) {
      renderedRows = 0;
    }
    return Object.assign(
      {
        at: new Date().toISOString(),
        route: state.route,
        loading: Boolean(state.links.loading),
        total_hydrated_apps: Array.isArray(state.links.apps) ? state.links.apps.length : 0,
        rendered_rows: renderedRows,
        catalog_source: String(state.links.catalogSource || ""),
        catalog_version: String(state.links.catalogVersion || ""),
        session_ready: Boolean(state.links.token || state.links.userId || state.links.connectedLoaded),
        connected_loaded: Boolean(state.links.connectedLoaded),
        connected_count: Array.isArray(state.links.connectedApps) ? state.links.connectedApps.length : 0,
        logo_loads: safeNumber(state.links.logoLoads),
        logo_errors: safeNumber(state.links.logoErrors),
        search_value: String(state.links.search || ""),
        handoff_locked: Boolean(state.links.handoffLocked),
        opening_slug: String(state.links.openingSlug || "")
      },
      extra
    );
  }

  function linksDebugStartSession(kind, meta = {}) {
    const root = linksDebugRoot();
    const session = {
      id: `links_${kind}_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`,
      kind,
      started_at: new Date().toISOString(),
      started_perf_ms: linksDebugNow(),
      meta,
      events: []
    };
    const list = kind === "click" ? root.click_sessions : root.route_sessions;
    list.push(session);
    if (list.length > 12) {
      list.splice(0, list.length - 12);
    }
    if (kind === "click") {
      state.links.debugClickSessionId = session.id;
    } else {
      state.links.debugRouteSessionId = session.id;
      state.links.firstRowsTelemetrySent = false;
      state.links.logoLoads = 0;
      state.links.logoErrors = 0;
    }
    return session;
  }

  function linksDebugRecord(event, extra = {}, kind = "route") {
    const session = linksDebugSession(kind);
    if (!session) {
      return null;
    }
    const entry = linksDebugSnapshot(
      Object.assign(
        {
          event,
          elapsed_ms: Math.round((linksDebugNow() - safeNumber(session.started_perf_ms)) * 10) / 10
        },
        extra
      )
    );
    session.events.push(entry);
    linksDebugRoot().last_event = entry;
    console.info("links.telemetry", entry);
    return entry;
  }

  function linksDebugEnsureRouteSession(reason) {
    if (!linksDebugSession("route")) {
      linksDebugStartSession("route", { reason: String(reason || "") });
      linksDebugRecord("links_route_enter", { reason: String(reason || "") }, "route");
    }
  }

  function linksDebugStartClickSession(slug) {
    linksDebugStartSession("click", { slug: String(slug || "") });
    linksDebugRecord("row_click", { slug: String(slug || "") }, "click");
  }

  function linksHandoffState() {
    const current = state.links.lastHandoff;
    if (!current || typeof current !== "object") {
      return blankLinksHandoffState();
    }
    return Object.assign(blankLinksHandoffState(), current);
  }

  function setLinksHandoffState(patch = {}) {
    state.links.lastHandoff = Object.assign(blankLinksHandoffState(), linksHandoffState(), patch);
    linksDebugRoot().last_handoff = Object.assign({}, state.links.lastHandoff);
    return state.links.lastHandoff;
  }

  function normalizeLinksBrowserOpenResult(result, options = {}) {
    const raw = result && typeof result === "object" ? result : {};
    const event = String(options.event || "browser_open_result").trim() || "browser_open_result";
    const slug = String(options.slug || "").trim();
    const authUrl = String(raw.uri || raw.url || options.authUrl || "").trim();
    const launched = raw.launched !== false;
    const popupOpened = raw.popup_opened === true;
    const sameTabNavigation = raw.same_tab_navigation === true;
    let launchSurface = String(raw.launch_surface || raw.surface || "").trim();
    if (!launchSurface) {
      if (popupOpened) {
        launchSurface = "popup";
      } else if (sameTabNavigation) {
        launchSurface = "same_tab";
      } else if (launched && !hostedConnectReadOnlyMode()) {
        launchSurface = "external_intent";
      }
    }
    return {
      at: new Date().toISOString(),
      event,
      slug,
      auth_url: authUrl,
      launched,
      launch_surface: launchSurface,
      popup_opened: popupOpened || launchSurface === "popup",
      same_tab_navigation: sameTabNavigation || launchSurface === "same_tab",
      error: String(raw.error || options.error || "").trim()
    };
  }

  function hostedConnectReadOnlyMode() {
    return !(window.PuckyAndroid && typeof window.PuckyAndroid.postMessage === "function");
  }

  async function loadLinksConnected(options = {}) {
    if (!state.links.token && !hostedConnectReadOnlyMode()) {
      return;
    }
    const age = Date.now() - safeNumber(state.links.lastRefreshAt);
    if (!options.force && state.links.connectedLoaded && age >= 0 && age < PERF_BRIDGE_CACHE_TTL_MS) {
      recordPerfCacheHit("links:my-apps");
      if (options.render) {
        render();
      }
      return;
    }
    linksDebugRecord(
      "my_apps_start",
      {
        force: Boolean(options.force),
        hosted_read_only: hostedConnectReadOnlyMode(),
      },
      "route"
    );
    recordPerfRouteDataStart("connect:my_apps");
    const query = new URLSearchParams();
    if (state.links.token) {
      query.set("token", state.links.token);
    }
    const payload = await linksApiRequest(
      `/api/links/composio/my-apps${query.toString() ? `?${query}` : ""}`
    );
    const list = Array.isArray(payload && payload.apps) ? payload.apps : [];
    const active = [];
    const slugs = new Set();
    list.forEach(item => {
      const slug = String(item && item.slug || "").trim();
      const counts = item && typeof item.counts === "object" ? item.counts : {};
      if (!slug || Number(counts.active || 0) <= 0) {
        return;
      }
      slugs.add(slug);
      active.push({
        slug,
        name: String(item && (item.name || item.slug) || slug).trim()
      });
    });
    active.sort((a, b) => String(a.name || a.slug).localeCompare(String(b.name || b.slug)));
    state.links.connectedApps = active;
    state.links.connectedSlugs = slugs;
    state.links.connectedLoaded = true;
    state.links.userId = String(payload && payload.user_id || "").trim();
    state.links.lastRefreshAt = Date.now();
    recordPerfRouteDataEnd("connect:my_apps");
    linksDebugRecord(
      "my_apps_end",
      {
        connected_count: active.length,
        payload_count: list.length,
        user_id: state.links.userId,
        server_timing: String(payload && payload._server_timing || "")
      },
      "route"
    );
    if (options.render) {
      render();
    }
  }

  function optionsShouldRenderLinksPage() {
    return state.route === "connect";
  }

  let linksPageNode = null;
  let linksPageRefs = null;
  let linksSessionPromise = null;
  async function hydrateLinksSession(options = {}) {
    if (linksSessionPromise) {
      return linksSessionPromise;
    }
    linksSessionPromise = (async () => {
      state.links.loading = true;
      if (options.render) {
        render();
      }
      try {
        let payload = null;
        if (options.force === true) {
          state.links.portal_url = "";
          state.links.token = "";
          state.links.userId = "";
          state.links.connectedApps = [];
          state.links.connectedSlugs = new Set();
          state.links.connectedLoaded = false;
          state.links.lastRefreshAt = 0;
        }
        if (hostedConnectReadOnlyMode()) {
          state.links.available = true;
          state.links.portal_url = "";
          state.links.token = "";
          state.links.auth_mode = "browser";
          await ensureLinksApiConfig();
          if (state.links.apiToken) {
            linksDebugRecord("portal_url_start", { force: Boolean(options.force), browser_preview: true }, "route");
            payload = normalizeLinksPortalPayload(await linksApiRequest("/api/links/composio/portal-url"));
            state.links.portal_url = payload.portal_url;
            state.links.token = payload.token;
            state.links.auth_mode = payload.auth_mode;
            state.links.available = payload.available;
            linksDebugRecord(
              "portal_url_end",
              {
                auth_mode: payload.auth_mode,
                available: payload.available,
                browser_preview: true,
                server_timing: String(payload && payload._server_timing || "")
              },
              "route"
            );
          }
          await loadLinksConnected({ render: false, force: Boolean(options.force) });
          return;
        }
        if (!state.links.token) {
          linksDebugRecord("portal_url_start", { force: Boolean(options.force) }, "route");
          await ensureLinksApiConfig();
          if (!state.links.apiToken) {
            state.links.available = false;
            state.links.error = "Device provisioning missing pucky_api_token.";
            linksDebugRecord("handoff_error", { stage: "portal_load", detail: state.links.error }, "route");
            return;
          }
          payload = normalizeLinksPortalPayload(await linksApiRequest("/api/links/composio/portal-url"));
          state.links.portal_url = payload.portal_url;
          state.links.token = payload.token;
          state.links.auth_mode = payload.auth_mode;
          state.links.available = payload.available;
          linksDebugRecord(
            "portal_url_end",
            {
              auth_mode: payload.auth_mode,
              available: payload.available,
              server_timing: String(payload && payload._server_timing || "")
            },
            "route"
          );
        }
        if (!state.links.token) {
          state.links.error = payload && payload.error ? payload.error : "Connect portal unavailable";
          return;
        }
        await loadLinksConnected({ render: false, force: Boolean(options.force) });
      } catch (error) {
        const detail = String(error && error.message ? error.message : "Unable to open Connect");
        const bridgeLikelyPresent = Boolean(window.PuckyAndroid && typeof window.PuckyAndroid.postMessage === "function");
        state.links.available = false;
        state.links.error = !bridgeLikelyPresent && /unauthorized|401/i.test(detail) ? "" : detail;
        linksDebugRecord("handoff_error", { stage: "portal_load", detail: state.links.error }, "route");
      } finally {
        state.links.loading = false;
        linksSessionPromise = null;
        if (optionsShouldRenderLinksPage()) {
          render();
        }
      }
    })();
    return linksSessionPromise;
  }

  async function loadLinksPortal(options = {}) {
    linksDebugEnsureRouteSession(options.force ? "force_reload" : "route_open");
    if (options.force) {
      resetLinksCatalogState({ keepSearch: true, clearConnected: true });
    }
    hydrateBundledLinksCatalog({ force: Boolean(options.force) });
    state.links.error = "";
    state.links.message = "";
    state.links.messageKind = "";
    if (options.render) {
      render();
    }
    if (options.force) {
      void hydrateLinksSession({ render: false, force: true });
      return;
    }
    void hydrateLinksSession({ render: false });
  }

  function linksScrollElement() {
    return linksPageRefs && linksPageRefs.scrollport ? linksPageRefs.scrollport : null;
  }

  function linksMatchesSearch(app, needle) {
    return String(app && app.name || "").toLowerCase().includes(needle)
      || String(app && app.slug || "").toLowerCase().includes(needle);
  }

  function linksFilteredApps() {
    const needle = String(state.links.search || "").trim().toLowerCase();
    const apps = Array.isArray(state.links.apps) ? state.links.apps : [];
    if (!needle) {
      return apps;
    }
    return apps.filter(app => linksMatchesSearch(app, needle));
  }

  function syncLinksMessage(refs) {
    const text = state.links.error || state.links.message;
    refs.message.hidden = !text;
    refs.message.textContent = text;
    refs.message.className = `links-message${state.links.messageKind === "ok" ? " is-ok" : state.links.error ? " is-error" : ""}`;
  }

  function syncLinksConnected(refs) {
    refs.connected.hidden = !state.links.connectedApps.length;
    refs.connectedStrip.replaceChildren(
      ...state.links.connectedApps.map(app => {
        const chip = el("span", "links-connected-chip", app.name || app.slug);
        chip.dataset.linksConnectedSlug = String(app.slug || "");
        return chip;
      })
    );
  }

  function syncLinksEmptyState(refs) {
    if (state.links.loading && !state.links.firstPageReady && !state.links.apps.length) {
      refs.empty.hidden = false;
      refs.emptyTitle.textContent = "Loading Connect...";
      refs.emptyBody.textContent = "Pucky is fetching your connectable apps.";
      refs.retry.hidden = true;
      refs.searchWrap.hidden = true;
      refs.listCard.hidden = true;
      refs.connected.hidden = true;
      return true;
    }
    if (state.links.error && !state.links.apps.length) {
      refs.empty.hidden = false;
      refs.emptyTitle.textContent = "Could not load Connect right now.";
      refs.emptyBody.textContent = state.links.error;
      refs.retry.hidden = false;
      refs.searchWrap.hidden = true;
      refs.listCard.hidden = true;
      refs.connected.hidden = true;
      return true;
    }
    refs.empty.hidden = true;
    refs.retry.hidden = true;
    refs.searchWrap.hidden = false;
    refs.listCard.hidden = false;
    return false;
  }

  function syncLinksSearchInput(refs) {
    const handoffLocked = linksHandoffLocked();
    refs.search.disabled = handoffLocked;
    if (document.activeElement !== refs.search && refs.search.value !== state.links.search) {
      refs.search.value = state.links.search;
    }
  }

  function syncLinksListContents(refs) {
    const filtered = linksFilteredApps();
    refs.listCount.textContent = linksCountLabel(filtered);
    if (!filtered.length) {
      refs.rows.dataset.linksListKey = "";
      refs.rows.replaceChildren(el("div", "links-empty", state.links.apps.length ? "No apps match your search." : "No connectable apps are available right now."));
      return;
    }
    const handoffLocked = linksHandoffLocked();
    const listKey = filtered.map(app => String(app.slug || "")).join("\u001f");
    if (refs.rows.dataset.linksListKey !== listKey) {
      const fragment = document.createDocumentFragment();
      filtered.forEach((app, index) => {
        fragment.append(createLinksRow(app, index, handoffLocked));
      });
      refs.rows.replaceChildren(fragment);
      refs.rows.dataset.linksListKey = listKey;
    }
    syncLinksRowStates(refs, handoffLocked);
    if (!state.links.firstRowsTelemetrySent && filtered.length > 0) {
      state.links.firstRowsTelemetrySent = true;
      linksDebugRecord("first_rows_rendered", { rendered_rows: filtered.length }, "route");
    }
  }

  function syncLinksPage() {
    if (!linksPageRefs) {
      return;
    }
    hydrateBundledLinksCatalog();
    linksPageRefs.page.classList.toggle("is-handoff-lock", linksHandoffLocked());
    linksPageRefs.scrollport.classList.toggle("is-handoff-lock", linksHandoffLocked());
    syncLinksMessage(linksPageRefs);
    if (syncLinksEmptyState(linksPageRefs)) {
      return;
    }
    syncLinksConnected(linksPageRefs);
    syncLinksSearchInput(linksPageRefs);
    syncLinksListContents(linksPageRefs);
  }

  async function refreshLinksConnectedSoon(options = {}) {
    if (!state.links.token) {
      await hydrateLinksSession({ render: false, force: Boolean(options.force) });
      return;
    }
    const age = Date.now() - safeNumber(state.links.lastRefreshAt);
    if (!options.force && age < 1200) {
      return;
    }
    try {
      await loadLinksConnected({ render: Boolean(options.render) });
    } catch (_) {
      // Keep the last known connected badges if refresh fails.
    }
  }

  let linksHandoffTimer = 0;

  function clearLinksHandoffTimer() {
    if (linksHandoffTimer) {
      clearTimeout(linksHandoffTimer);
      linksHandoffTimer = 0;
    }
  }

  function linksHandoffLocked() {
    return Boolean(state.route === "connect" && state.links.handoffLocked);
  }

  function releaseLinksHandoff(options = {}) {
    const wasLocked = state.links.handoffLocked;
    const slug = String(state.links.openingSlug || "");
    clearLinksHandoffTimer();
    state.links.handoffLocked = false;
    state.links.handoffDeadlineAt = 0;
    state.links.openingSlug = "";
    if (wasLocked) {
      linksDebugRecord("handoff_unlock", { slug, reason: String(options.reason || "release") }, "click");
      if (options.clearClick !== false) {
        state.links.debugClickSessionId = "";
      }
    }
    if (options.render !== false) {
      render();
    }
  }

  function startLinksHandoff(slug) {
    clearLinksHandoffTimer();
    state.links.handoffLocked = true;
    state.links.handoffDeadlineAt = Date.now() + LINKS_BROWSER_HANDOFF_LOCK_MS;
    state.links.openingSlug = slug;
    setLinksHandoffState({
      at: new Date().toISOString(),
      event: "handoff_started",
      slug: String(slug || "").trim(),
      auth_url: "",
      launched: false,
      launch_surface: "",
      popup_opened: false,
      same_tab_navigation: false,
      error: ""
    });
    state.links.error = "";
    state.links.message = "";
    state.links.messageKind = "";
    linksHandoffTimer = setTimeout(() => {
      if (!state.links.handoffLocked || state.links.openingSlug !== slug) {
        return;
      }
      releaseLinksHandoff();
    }, LINKS_BROWSER_HANDOFF_LOCK_MS);
  }

  async function openLinksAuthFlow(app) {
    const slug = String(app && app.slug || "").trim();
    let authUrl = "";
    if (!slug || linksHandoffLocked()) {
      return;
    }
    if (!state.links.token) {
      await hydrateLinksSession({ render: false });
      if (!state.links.token) {
        state.links.error = state.links.error || "Connect portal unavailable";
        render();
        return;
      }
    }
    linksDebugStartClickSession(slug);
    startLinksHandoff(slug);
    render();
    try {
      linksDebugRecord("oauth_start_start", { slug }, "click");
      const payload = await linksApiRequest(
        `/api/links/composio/oauth/start?token=${encodeURIComponent(state.links.token)}&app=${encodeURIComponent(slug)}&auth_mode=${encodeURIComponent(state.links.auth_mode || "browser")}`
      );
      linksDebugRecord(
        "oauth_start_end",
        {
          slug,
          auth_mode: String(payload && payload.auth_mode || state.links.auth_mode),
          server_timing: String(payload && payload._server_timing || "")
        },
        "click"
      );
      authUrl = String(payload && payload.auth_url || "").trim();
      if (!authUrl) {
        throw new Error("Connect did not return a valid auth URL.");
      }
      if (String(payload && payload.auth_mode || state.links.auth_mode) === "browser") {
        linksDebugRecord("browser_open_requested", { slug, auth_url: authUrl }, "click");
        const handoff = normalizeLinksBrowserOpenResult(
          await Pucky.request({ command: "browser.open", args: { url: authUrl } }),
          { slug, authUrl }
        );
        setLinksHandoffState(handoff);
        linksDebugRecord(
          "browser_open_result",
          {
            slug,
            auth_url: handoff.auth_url,
            launch_surface: handoff.launch_surface,
            launched: handoff.launched,
            popup_opened: handoff.popup_opened,
            same_tab_navigation: handoff.same_tab_navigation
          },
          "click"
        );
        if (!handoff.launched) {
          throw new Error(handoff.error || "Browser handoff did not launch an auth surface.");
        }
      } else if (window.location && typeof window.location.assign === "function") {
        setLinksHandoffState({
          at: new Date().toISOString(),
          event: "same_tab_assign",
          slug,
          auth_url: authUrl,
          launched: true,
          launch_surface: "same_tab",
          popup_opened: false,
          same_tab_navigation: true,
          error: ""
        });
        window.location.assign(authUrl);
        return;
      } else {
        throw new Error("This surface cannot open the auth flow.");
      }
    } catch (error) {
      const detail = String(error && error.message ? error.message : error || "");
      const bridgeLikelyPresent = Boolean(window.PuckyAndroid && typeof window.PuckyAndroid.postMessage === "function");
      if (bridgeLikelyPresent && /browser\.open|timed out|Native command failed/i.test(detail)) {
        state.links.error = "Browser handoff failed. Pucky needs the current APK shell before Google and other OAuth apps can open safely.";
      } else {
        state.links.error = detail || "Could not open the auth flow.";
      }
      setLinksHandoffState({
        at: new Date().toISOString(),
        event: "handoff_error",
        slug,
        auth_url: authUrl,
        launched: false,
        launch_surface: "",
        popup_opened: false,
        same_tab_navigation: false,
        error: state.links.error
      });
      linksDebugRecord("handoff_error", { slug, detail: state.links.error }, "click");
      releaseLinksHandoff({ render: false, reason: "error" });
    } finally {
      if (!state.links.handoffLocked) {
        render();
      }
    }
  }

  function linksApiBaseUrl() {
    if (state.links.apiBaseUrl) {
      return state.links.apiBaseUrl;
    }
    return resolveHostedBrowserApiBaseUrl();
  }

  async function requestNativeLinksConfig(options = {}) {
    const requireApiToken = options.requireApiToken === true;
    const deadlineAt = Date.now() + LINKS_NATIVE_CONFIG_READY_TIMEOUT_MS;
    let lastError = null;
    let lastConfig = null;
    const cached = !options.force ? readBridgeCache("pucky.config.get", {}, PERF_BRIDGE_CACHE_TTL_MS) : null;
    if (cached && (!requireApiToken || Boolean(String(cached && cached.api_token || "").trim()) || cached && cached.has_api_token === true)) {
      return cached;
    }
    while (Date.now() < deadlineAt) {
      if (!(window.Pucky && typeof window.Pucky.request === "function")) {
        await new Promise(resolve => setTimeout(resolve, LINKS_NATIVE_CONFIG_RETRY_MS));
        continue;
      }
      try {
        const config = await Pucky.request({ command: "pucky.config.get", args: {} });
        lastConfig = config && typeof config === "object" ? config : {};
        const hasApiToken = Boolean(String(config && config.api_token || "").trim()) || config && config.has_api_token === true;
        if (!requireApiToken || hasApiToken) {
          writeBridgeCache("pucky.config.get", {}, config);
          return config;
        }
      } catch (error) {
        lastError = error;
      }
      await new Promise(resolve => setTimeout(resolve, LINKS_NATIVE_CONFIG_RETRY_MS));
    }
    if (lastConfig) {
      return lastConfig;
    }
    if (lastError) {
      throw lastError;
    }
    throw new Error("Native bridge did not expose pucky.config.get.");
  }

  function resolveHostedBrowserApiToken() {
    const uiState = window.PUCKY_UI_STATE && typeof window.PUCKY_UI_STATE === "object"
      ? window.PUCKY_UI_STATE
      : null;
    if (uiState && typeof uiState.resolveBrowserApiToken === "function") {
      return String(uiState.resolveBrowserApiToken() || "").trim();
    }
    try {
      return String(new URLSearchParams(window.location.search || "").get("api_token") || "").trim();
    } catch (_) {
      return "";
    }
  }

  function resolveHostedBrowserApiBaseUrl() {
    const fallbackApiBaseUrl = window.location && /^https?:$/i.test(window.location.protocol || "")
      ? String(window.location.origin || "").replace(/\/$/, "")
      : DEFAULT_LINKS_API_BASE;
    const uiState = window.PUCKY_UI_STATE && typeof window.PUCKY_UI_STATE === "object"
      ? window.PUCKY_UI_STATE
      : null;
    if (uiState && typeof uiState.resolveBrowserApiBaseUrl === "function") {
      return String(uiState.resolveBrowserApiBaseUrl({ defaultApiBaseUrl: fallbackApiBaseUrl }) || fallbackApiBaseUrl).trim().replace(/\/$/, "");
    }
    try {
      const params = new URLSearchParams(window.location.search || "");
      const queryApiBaseUrl = String(params.get("api_base_url") || params.get("apiBase") || "").trim().replace(/\/$/, "");
      if (queryApiBaseUrl) {
        return queryApiBaseUrl;
      }
    } catch (_) {
      return fallbackApiBaseUrl;
    }
    return fallbackApiBaseUrl;
  }

  function resolveHostedBrowserDeviceId() {
    const uiState = window.PUCKY_UI_STATE && typeof window.PUCKY_UI_STATE === "object"
      ? window.PUCKY_UI_STATE
      : null;
    if (uiState && typeof uiState.resolveBrowserDeviceId === "function") {
      return String(uiState.resolveBrowserDeviceId({ deviceStateKey: BROWSER_DEVICE_STATE_KEY }) || "").trim();
    }
    try {
      const params = new URLSearchParams(window.location.search || "");
      const queryDeviceId = String(params.get("device_id") || "").trim();
      if (queryDeviceId) {
        localStorage.setItem(BROWSER_DEVICE_STATE_KEY, queryDeviceId);
        return queryDeviceId;
      }
      return String(localStorage.getItem(BROWSER_DEVICE_STATE_KEY) || "").trim();
    } catch (_) {
      return "";
    }
  }

  function refreshHostedBrowserAuthState() {
    if (window.PuckyAndroid && typeof window.PuckyAndroid.postMessage === "function") {
      return;
    }
    state.links.apiBaseUrl = resolveHostedBrowserApiBaseUrl();
    state.links.apiToken = resolveHostedBrowserApiToken();
    state.links.deviceId = resolveHostedBrowserDeviceId();
  }

  async function ensureLinksApiConfig() {
    if (!(window.PuckyAndroid && typeof window.PuckyAndroid.postMessage === "function")) {
      refreshHostedBrowserAuthState();
      return;
    }
    if (state.links.apiBaseUrl && state.links.apiToken) {
      return;
    }
    try {
      await loadNativeBootstrapSnapshot({ render: false });
      if (state.links.apiBaseUrl && state.links.apiToken) {
        return;
      }
    } catch (_) {
      // Fall back to the bounded native-config read below.
    }
    try {
      const config = await requestNativeLinksConfig({ requireApiToken: true });
      state.links.apiBaseUrl = String(config && config.api_base_url || "").replace(/\/$/, "");
      state.links.apiToken = String(config && config.api_token || "");
      state.links.deviceId = "";
    } catch (_) {
      state.links.apiBaseUrl = "";
      state.links.apiToken = "";
      state.links.deviceId = "";
    }
  }

  async function protectedApiAuthorizationHeaders(options = {}) {
    const method = String(options.method || "GET").toUpperCase();
    const needsAuthorization = Boolean(options.authorized) || method !== "GET";
    if (!needsAuthorization) {
      return {};
    }
    if (state.links.apiToken) {
      return { Authorization: `Bearer ${state.links.apiToken}` };
    }
    if (!(window.PuckyAndroid && typeof window.PuckyAndroid.postMessage === "function")) {
      refreshHostedBrowserAuthState();
      return state.links.apiToken ? { Authorization: `Bearer ${state.links.apiToken}` } : {};
    }
    if (nativeProtectedAuthorization) {
      return { Authorization: nativeProtectedAuthorization };
    }
    try {
      const payload = await Pucky.request({ command: "pucky.authorization.get", args: {} });
      const authorization = String(payload && payload.authorization || "").trim();
      if (!authorization) {
        return {};
      }
      nativeProtectedAuthorization = authorization;
      return { Authorization: authorization };
    } catch (_) {
      return {};
    }
  }

  async function linksApiRequest(path, options = {}) {
    await ensureLinksApiConfig();
    const method = String(options.method || "GET").toUpperCase();
    const startedAt = perfNowMs();
    const metricKey = String(options.metricKey || `links:${String(path || "").split("?")[0] || "/"}`).trim();
    const init = {
      method,
      cache: String(options.cache || "no-store"),
      headers: {}
    };
    if (state.links.apiToken) {
      init.headers.Authorization = `Bearer ${state.links.apiToken}`;
    }
    Object.assign(init.headers, await protectedApiAuthorizationHeaders({ method, authorized: options.authorized === true }));
    if (options.body !== undefined) {
      init.headers["Content-Type"] = "application/json";
      init.body = JSON.stringify(options.body);
    }
    try {
      const response = await fetch(`${linksApiBaseUrl()}${path}`, init);
      const payload = await response.json().catch(() => ({}));
      if (payload && typeof payload === "object" && !Array.isArray(payload)) {
        payload._server_timing = String(response.headers.get("Server-Timing") || "");
        payload._http_status = response.status;
      }
      if (!response.ok) {
        throw new Error(String(payload && (payload.detail || payload.error) || `Connect request failed (${response.status})`));
      }
      recordPerfFetch(metricKey, startedAt, true);
      return payload;
    } catch (error) {
      recordPerfFetch(metricKey, startedAt, false, error && error.message ? error.message : String(error || ""));
      throw error;
    }
  }

  function routePerfEventPayload(trigger = "route_ready") {
    const metrics = perfDebugMetrics();
    if (!metrics.route_ready || !String(metrics.sample_reason || "").trim()) {
      return null;
    }
    return {
      schema: "pucky.ui_route_perf_event.v1",
      surface: String(metrics.surface || perfSurfaceName()),
      route: String(metrics.route || state.route || "home"),
      cold_start: safeNumber(metrics.route_sequence, 1) === 1,
      wall_elapsed_ms: safeNumber(metrics.wall_elapsed_ms),
      route_ready_elapsed_ms: safeNumber(metrics.route_ready_elapsed_ms),
      bridge_total_ms: safeNumber(metrics.bridge_total_ms),
      shell_launch_elapsed_ms: safeNumber(metrics.shell_launch_elapsed_ms),
      webview_load_elapsed_ms: safeNumber(metrics.webview_load_elapsed_ms),
      asset_delivery_failures: safeNumber(metrics.asset_delivery_failures),
      hosted_reload_attempts: safeNumber(metrics.hosted_reload_attempts),
      bootstrap_snapshot_used: Boolean(metrics.bootstrap_snapshot_used),
      bridge_calls_by_command: { ...(metrics.bridge_calls_by_command || {}) },
      fetches_by_key: { ...(metrics.fetches_by_key || {}) },
      poll_ticks_by_lane: { ...(metrics.poll_ticks_by_lane || {}) },
      cache_hits_by_key: { ...(metrics.cache_hits_by_key || {}) },
      deferred_tasks_started: safeNumber(metrics.deferred_tasks_started),
      deferred_tasks_completed: safeNumber(metrics.deferred_tasks_completed),
      unchanged_refresh_skips: safeNumber(metrics.unchanged_refresh_skips),
      device_class: String(metrics.device_class || perfDeviceClass()),
      app_version: "",
      ui_version: String(state.uiSurface?.ui_version || bundleUiVersion() || ""),
      sample_reason: String(metrics.sample_reason || ""),
      boot_phase: String(metrics.boot_phase || ""),
      route_ready_reason: String(metrics.route_ready_reason || ""),
      render_count: safeNumber(metrics.render_count),
      last_render_ms: safeNumber(metrics.last_render_ms),
      route_enter_at_ms: safeNumber(metrics.route_enter_at_ms),
      route_data_start_at_ms: safeNumber(metrics.route_data_start_at_ms),
      route_data_end_at_ms: safeNumber(metrics.route_data_end_at_ms),
      route_ready_at_ms: safeNumber(metrics.route_ready_at_ms),
      session_id: String(metrics.session_id || ""),
      run_id: String(metrics.run_id || ""),
      trigger: String(trigger || "route_ready")
    };
  }

  async function flushRoutePerfTelemetry(trigger = "route_ready") {
    if (!perfDebugState.enabled || perfDebugState.route_perf_sent || perfTelemetryInFlight > 0) {
      return false;
    }
    const payload = routePerfEventPayload(trigger);
    if (!payload) {
      return false;
    }
    perfDebugState.route_perf_sent = true;
    perfTelemetryInFlight += 1;
    try {
      await ensureLinksApiConfig();
      const headers = await protectedApiAuthorizationHeaders({ method: "POST", authorized: true });
      if (!((headers && headers.Authorization) || state.links.apiToken)) {
        perfDebugState.route_perf_sent = false;
        return false;
      }
      const response = await fetch(`${linksApiBaseUrl()}/api/ui/route-perf-events`, {
        method: "POST",
        cache: "no-store",
        headers: {
          "Content-Type": "application/json",
          ...(headers || {}),
          ...(state.links.apiToken ? { Authorization: `Bearer ${state.links.apiToken}` } : {})
        },
        body: JSON.stringify(payload)
      });
      if (!response.ok) {
        perfDebugState.route_perf_sent = false;
        return false;
      }
      return true;
    } catch (_) {
      perfDebugState.route_perf_sent = false;
      return false;
    } finally {
      perfTelemetryInFlight = Math.max(0, perfTelemetryInFlight - 1);
    }
  }

  async function loadMeetings(options = {}) {
    if (state.meetings.loading) {
      return;
    }
    const hadError = Boolean(state.meetings.error);
    state.meetings.loading = true;
    state.meetings.error = "";
    let changed = !state.meetings.loaded || hadError;
    if (options.render) {
      renderFeed();
    }
    try {
      recordPerfRouteDataStart("meetings:list");
      const payload = await linksApiRequest("/api/meetings?compact=1", {
        cache: "no-store",
        metricKey: "links:meetings"
      });
      const nextRecords = Array.isArray(payload.meetings) ? payload.meetings : [];
      const nextFingerprint = stableJsonFingerprint(nextRecords);
      if (state.meetings.fingerprint !== nextFingerprint) {
        state.meetings.records = nextRecords;
        state.meetings.fingerprint = nextFingerprint;
        changed = true;
      }
      state.meetings.loaded = true;
      state.meetings.lastRefreshAt = Date.now();
      recordPerfRouteDataEnd("meetings:list");
    } catch (error) {
      state.meetings.error = meetingsApiErrorMessage(error, "Unable to load meetings");
      changed = true;
    } finally {
      state.meetings.loading = false;
      if (options.render && changed) {
        requestRender(`meetings:${String(options.reason || "refresh")}`);
      }
    }
    return changed;
  }

  async function loadMeetingDetail(meeting) {
    const meetingId = String(meeting && meeting.meeting_id || "").trim();
    if (!meetingId) {
      return meeting;
    }
    const payload = await linksApiRequest(`/api/meetings/${encodeURIComponent(meetingId)}`, { cache: "no-store" });
    const detail = payload && payload.meeting && typeof payload.meeting === "object" ? payload.meeting : meeting;
    state.meetings.records = state.meetings.records.map(item =>
      String(item && item.meeting_id || "") === meetingId ? { ...item, ...detail } : item
    );
    return detail;
  }

  function meetingsApiErrorMessage(error, fallback = "Meetings request failed") {
    const detail = String(error && error.message ? error.message : fallback);
    return detail.replace(/^(Links|Connect) request failed/i, "Meetings request failed");
  }

  async function refreshMeetingRecordingStatus(options = {}) {
    const before = stableJsonFingerprint(normalizeMeetingRecordingStatus(state.meetingRecording));
    try {
      state.meetingRecording = normalizeMeetingRecordingStatus(
        await Pucky.request({ command: "meeting.recording.status", args: {} })
      );
    } catch (_) {
      state.meetingRecording = normalizeMeetingRecordingStatus(state.meetingRecording);
    }
    const changed = before !== stableJsonFingerprint(normalizeMeetingRecordingStatus(state.meetingRecording));
    if (options.render && changed) {
      renderVoiceStatus();
    }
    return changed;
  }

  function ensureSettingsSurfaceCurrent() {
    if (state.route !== "settings") {
      return false;
    }
    const bridgeConnected = Boolean(state.uiSurface.bridge_connected);
    const sourceKind = String(state.uiSurface.source_kind || "");
    const entrypointUrl = String(state.uiSurface.entrypoint_url || "");
    // Hosted browser sessions have no native bundle to swap into, so Settings should stay in-place.
    if (!bridgeConnected || sourceKind === "bundle_current" || !entrypointUrl || !window.location || !window.location.replace) {
      try {
        sessionStorage.removeItem(SETTINGS_SURFACE_RELOAD_KEY);
      } catch (_) {
        // Session storage is a best-effort guardrail.
      }
      return false;
    }
    try {
      if (sessionStorage.getItem(SETTINGS_SURFACE_RELOAD_KEY) === entrypointUrl) {
        return false;
      }
      sessionStorage.setItem(SETTINGS_SURFACE_RELOAD_KEY, entrypointUrl);
    } catch (_) {
      // If storage is unavailable we still attempt a single reload.
    }
    window.location.replace(entrypointUrl);
    return true;
  }


  function render() {
    const startedAt = perfNowMs();
    noteFlashDebugRecord("render_start");
    renderVoiceStatus();
    renderThreadScopeBadge();
    renderFeed();
    renderInboxManageOverlay();
    renderAudioDetail();
    renderDetailAudioContinuity();
    noteFlashDebugRecord("render_end");
    perfDebugState.render_count = safeNumber(perfDebugState.render_count) + 1;
    perfDebugState.last_render_ms = Math.max(0, perfNowMs() - startedAt);
    syncPerfDebugState("render");
  }

  function renderVoiceStatus() {
    const indicators = document.querySelectorAll("[data-voice-status]");
    if (!indicators.length) {
      return;
    }
    const turnState = turnVisualState(state.turn);
    const wakeProofState = turnState === "idle" ? wakeProofVisualState(state.wakeStatus) : "idle";
    const meetingState = meetingRecordingVisualState();
    const visualState = meetingState !== "idle"
      ? meetingState
      : wakeProofState !== "idle"
        ? wakeProofState
        : turnState;
    const label = meetingState !== "idle"
      ? "meeting recording"
      : wakeProofState !== "idle"
        ? "wake matched"
        : turnStateLabel(visualState);
    const renderedVisualState = visualState;
    const renderedLabel = label;
    const turnId = turnStatusTurnId(state.turn);
    if (state.lastRenderedTurnVisualState !== renderedVisualState || state.lastRenderedTurnId !== turnId) {
      state.lastRenderedTurnVisualState = renderedVisualState;
      state.lastRenderedTurnId = turnId;
      recordTurnUiEvent("voice_status_rendered", {
        turn_id: turnId,
        visual_state: renderedVisualState,
        label: renderedLabel
      });
    }
    indicators.forEach(indicator => {
      indicator.hidden = false;
      indicator.setAttribute("aria-hidden", "false");
      indicator.className = `voice-status voice-status-${renderedVisualState}`;
      indicator.setAttribute("aria-label", `Turn state: ${renderedLabel}`);
      indicator.title = `Turn: ${renderedLabel}`;
    });
  }

  function initialTurnStatus() {
    return {
      schema: "pucky.turn_status.v1",
      configured: false,
      indicator: {
        schema: "pucky.turn_indicator.v1",
        state: "idle",
        visual_state: "idle",
        mic_on: false,
        speech_detected: false,
        uploading: false,
        stt_running: false,
        codex_running: false,
        tts_running: false,
        speaking: false,
        failed: false,
        remote_stage: "",
        active: false
      }
    };
  }

  function turnStatusTurnId(status) {
    const normalized = normalizeTurnStatus(status);
    const last = normalized.last_status && typeof normalized.last_status === "object" ? normalized.last_status : {};
    return String(
      normalized.turn_id
      || last.turn_id
      || normalized.local_session_id
      || last.local_session_id
      || ""
    ).trim();
  }

  function recordTurnUiEvent(event, detail = {}) {
    const entry = {
      schema: "pucky.ui_turn_timing_event.v1",
      event: String(event || "").trim(),
      at: new Date().toISOString(),
      at_ms: Date.now()
    };
    Object.entries(detail || {}).forEach(([key, value]) => {
      if (value !== undefined) {
        entry[key] = value;
      }
    });
    state.turnUiEvents.push(entry);
    if (state.turnUiEvents.length > TURN_UI_TIMELINE_MAX_EVENTS) {
      state.turnUiEvents = state.turnUiEvents.slice(-TURN_UI_TIMELINE_MAX_EVENTS);
    }
    return entry;
  }

  function currentTurnUiTiming() {
    const turnId = turnStatusTurnId(state.turn);
    const events = state.turnUiEvents.filter(entry => {
      const eventTurnId = String(entry?.turn_id || "").trim();
      return !turnId || !eventTurnId || eventTurnId === turnId;
    });
    return {
      schema: "pucky.ui_turn_timing.v1",
      turn_id: turnId,
      events: events.slice(-TURN_UI_TIMELINE_MAX_EVENTS)
    };
  }

  function initialThreadScope() {
    return {
      schema: "pucky.voice_thread_scope.v1",
      mode: "new_thread",
      thread_id: "",
      card_id: "",
      session_id: "",
      source_surface: "",
      label: "",
      updated_at: "",
      active: false
    };
  }

  function initialTurnSettings() {
    return {
      schema: "pucky.turn_settings.v1",
      reply_mode: "card_only",
      spoken_reply_enabled: false,
      arrival_cue_mode: "chime",
      accepted_chime_enabled: true,
      model: DEFAULT_TURN_MODEL,
      reasoning_effort: DEFAULT_TURN_REASONING_EFFORT,
      modes: TURN_REPLY_MODES,
      arrival_cue_modes: TURN_ARRIVAL_CUE_MODES,
      model_options: TURN_MODEL_OPTIONS,
      reasoning_effort_options: TURN_REASONING_EFFORT_OPTIONS
    };
  }

  function initialWakeStatus() {
    return {
      schema: "pucky.wake_word_status.v4",
      enabled: false,
      requested_enabled: false,
      running: false,
      state: "idle",
      suspended_reason: "",
      engine: "android_stt_sentinel",
      requested_engine: "android_stt_sentinel",
      effective_engine: "stopped",
      mode: "android_stt_wake",
      scope: "awake_and_unlocked_foreground",
      debug_recognizer_mode: "android",
      recognizer_state: "idle",
      restart_count: 0,
      last_restart_reason: "",
      last_transcript: "",
      last_alternatives: [],
      last_error_code: "",
      last_error_message: "",
      last_match: {
        matched_phrase: "",
        match_source: "",
        matched_at: ""
      },
      proof_indicator: {
        active: false,
        visual_state: "idle",
        matched_phrase: "",
        transcript: "",
        remaining_ms: 0
      }
    };
  }

  function normalizeThreadScope(input) {
    const raw = input && typeof input === "object" ? input : {};
    const mode = String(raw.mode || "");
    const threadId = String(raw.thread_id || "");
    const active = mode === "existing_thread" && !!threadId;
    return {
      schema: raw.schema || "pucky.voice_thread_scope.v1",
      mode: active ? "existing_thread" : "new_thread",
      thread_id: active ? threadId : "",
      card_id: active ? String(raw.card_id || "") : "",
      session_id: active ? String(raw.session_id || "") : "",
      source_surface: active ? String(raw.source_surface || "") : "",
      label: active ? String(raw.label || "") : "",
      updated_at: String(raw.updated_at || ""),
      active
    };
  }

  function renderThreadScopeBadge() {
    const node = document.getElementById("threadScopeStatus");
    if (!node) {
      return;
    }
    node.setAttribute("data-thread-scope-active", state.threadScope.active ? "true" : "false");
    node.setAttribute("data-thread-scope-mode", state.threadScope.mode || "new_thread");
    node.setAttribute("data-thread-id", state.threadScope.thread_id || "");
    node.setAttribute("data-source-surface", state.threadScope.source_surface || "");
    node.hidden = true;
    node.textContent = "";
    node.setAttribute("aria-hidden", "true");
  }

  function bundleConfig() {
    return window.PUCKY_BUNDLE_CONFIG && typeof window.PUCKY_BUNDLE_CONFIG === "object"
      ? window.PUCKY_BUNDLE_CONFIG
      : {};
  }

  function bundleUiVersion() {
    const config = bundleConfig();
    const explicit = String(config.ui_version || "").trim();
    if (explicit) {
      return explicit;
    }
    const short = String(config.source_commit_short || "").trim();
    return short ? `git-${short}` : "browser_preview";
  }

  function hasNativeAudioBridge() {
    return Boolean(window.PuckyAndroid && typeof window.PuckyAndroid.postMessage === "function");
  }

  function audioRuntimeMode() {
    return hasNativeAudioBridge() ? "native_bridge" : BROWSER_AUDIO_RUNTIME;
  }

  function initialSurfaceKind() {
    const url = String(window.location && window.location.href || "");
    return /^https:\/\/pucky\.fly\.dev\/ui\/pucky\/latest(?:\/|\/index\.html)/i.test(url)
      ? "hosted_vm"
      : "bundle_current";
  }

  function initialUiSurfaceStatus() {
    const config = bundleConfig();
    const bootstrap = bootstrapDebugState();
    return {
      schema: "pucky.ui_surface.v1",
      requested_url: window.location.href,
      active_url: window.location.href,
      entrypoint_url: window.location.href,
      fallback_asset_url: "",
      ui_version: bundleUiVersion(),
      source_commit_full: String(config.source_commit_full || ""),
      source_commit_short: String(config.source_commit_short || ""),
      source_dirty: Boolean(config.source_dirty),
      source_kind: initialSurfaceKind(),
      bridge_connected: hasNativeAudioBridge(),
      audio_runtime_mode: audioRuntimeMode(),
      shell_launch_elapsed_ms: safeNumber(bootstrap.shell_launch_elapsed_ms),
      webview_load_elapsed_ms: safeNumber(bootstrap.webview_load_elapsed_ms),
      hosted_reload_attempts: safeNumber(bootstrap.hosted_reload_attempts),
      asset_delivery_failures: safeNumber(bootstrap.asset_delivery_failures)
    };
  }

  function initialAudioProbeStatus() {
    return {
      schema: "pucky.audio_probe.v1",
      target_key: "",
      target_card: {
        card_id: "",
        session_id: "",
        thread_id: "",
        title: ""
      },
      runtime_mode: audioRuntimeMode(),
      active_path: "",
      current_tile_audio_phase: "idle",
      resolved_source_type: "",
      cache_prep: "",
      recent_events: [],
      last_terminal_outcome: "",
      last_error_toast: "",
      started_at: "",
      started_at_ms: 0,
      confirmed_at: "",
      confirmed_at_ms: 0,
      ended_at: "",
      ended_at_ms: 0
    };
  }

  function initialPhoneRoleStatus() {
    return normalizePhoneRoleStatus({
      schema: "pucky.phone_role_status.v1",
      state: "unavailable",
      role_held: false,
      eligible: false,
      role_available: false,
      package_name: "com.pucky.device.debug",
      default_dialer_package: "",
      default_dialer_label: "",
      stock_incall_ui_replaced_when_held: true,
      loaded: false,
      source: "preview_unavailable",
      read_only: true,
      error_code: "preview_unavailable",
      error_detail: "",
      device_id: ""
    });
  }

  function normalizePhoneRoleStatus(input) {
    const raw = input && typeof input === "object" ? input : {};
    const hasNativeBridge = Boolean(window.PuckyAndroid && typeof window.PuckyAndroid.postMessage === "function");
    return {
      schema: "pucky.phone_role_status.v1",
      state: String(raw.state || "unknown").trim() || "unknown",
      role_held: truthy(raw.role_held),
      eligible: truthy(raw.eligible),
      role_available: truthy(raw.role_available),
      package_name: String(raw.package_name || "").trim(),
      default_dialer_package: String(raw.default_dialer_package || "").trim(),
      default_dialer_label: String(raw.default_dialer_label || "").trim(),
      stock_incall_ui_replaced_when_held: raw.stock_incall_ui_replaced_when_held !== undefined
        ? truthy(raw.stock_incall_ui_replaced_when_held)
        : true,
      loaded: raw.loaded !== undefined ? truthy(raw.loaded) : true,
      source: String(raw.source || (hasNativeBridge ? "native_bridge" : "preview_unavailable")).trim() || "preview_unavailable",
      read_only: raw.read_only !== undefined ? truthy(raw.read_only) : !hasNativeBridge,
      error_code: String(raw.error_code || "").trim(),
      error_detail: String(raw.error_detail || raw.detail || raw.error || "").trim(),
      device_id: String(raw.device_id || "").trim()
    };
  }

  function cssEscape(value) {
    const raw = String(value || "");
    if (window.CSS && typeof window.CSS.escape === "function") {
      return window.CSS.escape(raw);
    }
    return raw.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  }

  function describeUiSurface() {
    const shell = document.querySelector(".app-shell");
    const threadScope = document.getElementById("threadScopeStatus");
    const voiceStatus = document.getElementById("voiceStatus");
    const voiceStatusStyle = voiceStatus ? window.getComputedStyle(voiceStatus) : null;
    const voiceStatusRect = voiceStatus ? voiceStatus.getBoundingClientRect() : null;
    const detail = document.getElementById("detail");
    const feed = document.getElementById("feed");
    const feedStyle = feed ? window.getComputedStyle(feed) : null;
    const focusedSessionId = String(state.openCardMenuSessionId || "");
    const focusedCard = findFocusedCard();
    const currentUrl = String(window.location && window.location.href || "");
    const bridgeConnected = hasNativeAudioBridge();
    const cards = Array.from(document.querySelectorAll("article[data-card-id], article[data-card-session-id]")).map(node => ({
      kind: node.getAttribute("data-card-kind") || "",
      card_id: node.getAttribute("data-card-id") || "",
      session_id: node.getAttribute("data-card-session-id") || "",
      thread_id: node.getAttribute("data-card-thread-id") || "",
      pending_outbound: node.getAttribute("data-card-kind") === "pending_outbound",
      pending_state: node.getAttribute("data-card-pending-state") || "",
      preview: (node.querySelector(".preview, .card-outbound-preview, .title")?.textContent || "").trim(),
      audio_phase: node.getAttribute("data-audio-phase") || "",
      audio_runtime_mode: node.getAttribute("data-audio-runtime-mode") || "",
      audio_strip_kind: node.getAttribute("data-audio-strip-kind") || "",
      audio_busy: node.getAttribute("data-audio-busy") || "",
      audio_label: (node.querySelector(".tile-audio-status-label")?.textContent || "").trim()
    }));
    return {
      ...state.uiSurface,
      requested_url: bridgeConnected ? state.uiSurface.requested_url : currentUrl,
      active_url: bridgeConnected ? state.uiSurface.active_url : currentUrl,
      entrypoint_url: bridgeConnected ? state.uiSurface.entrypoint_url : currentUrl,
      audio_runtime_mode: audioRuntimeMode(),
      route: shell?.getAttribute("data-view") || "",
      detail: {
        open: Boolean(detail?.classList.contains("is-open")),
        type: detail?.getAttribute("data-detail-type") || "",
        card_id: detail?.getAttribute("data-detail-card-id") || "",
        session_id: detail?.getAttribute("data-detail-session-id") || "",
        thread_id: detail?.getAttribute("data-detail-thread-id") || "",
        viewer: detail?.getAttribute("data-detail-viewer") || ""
      },
        focused_card: {
          active: Boolean(focusedCard),
          session_id: focusedSessionId,
          card_id: String(focusedCard?.card_id || ""),
          thread_id: String(cardOrigin(focusedCard).thread_id || ""),
          menu_open: Boolean(focusedCard),
        },
      thread_scope: {
        visible: Boolean(threadScope && !threadScope.hidden),
        active: threadScope?.getAttribute("data-thread-scope-active") || "false",
        mode: threadScope?.getAttribute("data-thread-scope-mode") || "",
        thread_id: threadScope?.getAttribute("data-thread-id") || "",
        source_surface: threadScope?.getAttribute("data-source-surface") || "",
        label: (threadScope?.textContent || "").trim()
      },
      voice_status: {
        exists: Boolean(voiceStatus),
        class_name: voiceStatus?.className || "",
        aria_hidden: voiceStatus?.getAttribute("aria-hidden") || "",
        hidden: Boolean(voiceStatus?.hidden),
        title: voiceStatus?.title || "",
        label: voiceStatus?.getAttribute("aria-label") || "",
        rect: voiceStatusRect ? {
          top: Math.round(Number(voiceStatusRect.top || 0)),
          right: Math.round(Number(voiceStatusRect.right || 0)),
          bottom: Math.round(Number(voiceStatusRect.bottom || 0)),
          left: Math.round(Number(voiceStatusRect.left || 0)),
          width: Math.round(Number(voiceStatusRect.width || 0)),
          height: Math.round(Number(voiceStatusRect.height || 0))
        } : null,
        computed_display: voiceStatusStyle?.display || "",
        computed_visibility: voiceStatusStyle?.visibility || "",
        computed_opacity: voiceStatusStyle?.opacity || "",
        voice_color: String(voiceStatusStyle?.getPropertyValue("--voice-color") || "").trim()
      },
      toast: {
        message: String(state.lastToast.message || ""),
        shown_at: String(state.lastToast.shown_at || "")
      },
      turn_timing: currentTurnUiTiming(),
      visible_cards: cards,
      home_feed: {
        active_route: state.route,
        ui_version: state.uiSurface?.ui_version || "",
        feed_source: state.feedSource,
        feed_last_applied_ms: Math.round(Number(state.feedLastAppliedAt || 0)),
        feed_load_error: state.feedLoadError,
        scroll_top: Math.round(Number(feed?.scrollTop || 0)),
        client_height: Math.round(Number(feed?.clientHeight || 0)),
        scroll_height: Math.round(Number(feed?.scrollHeight || 0)),
        overflow_y: feedStyle?.overflowY || "",
        direct_card_count: feed ? Array.from(feed.children).filter(node => node?.classList?.contains("card-wrap")).length : 0,
        visible_card_count: cards.length,
        inbox_manage_mode: Boolean(state.inboxManageMode),
        inbox_archive_filter_pending: inboxArchiveFilterPending(),
        inbox_archive_filter_pending_target: inboxArchiveFilterPending()
          ? Boolean(state.inboxArchiveFilterPendingTarget)
          : null,
        inbox_manage_selected_count: state.selectedInboxCardKeys instanceof Set ? state.selectedInboxCardKeys.size : 0,
        inbox_manage_selected_ids: state.selectedInboxCardKeys instanceof Set ? Array.from(state.selectedInboxCardKeys) : [],
        open_card_menu_session_id: String(state.openCardMenuSessionId || ""),
        open_card_menu_thread_id: String(state.openCardMenuThreadId || ""),
        last_inbox_manage_result: {
          ...(state.lastInboxManageResult || {})
        },
        archive_reveal_open_count: document.querySelectorAll(".card-wrap.is-archive-reveal-open").length,
        archive_reveal_active_count: document.querySelectorAll(".card-wrap.is-archive-reveal-active").length,
        last_scroll_sample: {
          scroll_top: Math.round(Number(feed?.scrollTop || 0)),
          timestamp_ms: Date.now()
        }
      },
      ui_debug_available: true
    };
  }

  function describeAudioProbe() {
    return {
      ...state.audioProbe,
      bridge_connected: hasNativeAudioBridge(),
      runtime_mode: audioRuntimeMode(),
      active_path: state.activePath || "",
      current_tile_audio_phase: state.audioProbe.current_tile_audio_phase || "idle",
      recent_events: Array.isArray(state.audioProbe.recent_events)
        ? state.audioProbe.recent_events.slice(-AUDIO_PROBE_EVENT_LIMIT)
        : [],
      last_error_toast: String(state.audioProbe.last_error_toast || state.lastToast.message || "")
    };
  }

  function uiDebugDispatch(action, rawArgs = {}) {
    if (action === "goto_home") {
      return uiDebugGotoHome();
    }
    if (action === "links_metrics") {
      return {
        schema: "pucky.ui_debug_action.v1",
        ok: true,
        action,
        handled: true,
        metrics: linksDebugMetrics(),
        surface: describeUiSurface()
      };
    }
    if (action === "perf_metrics") {
      return {
        schema: "pucky.ui_debug_action.v1",
        ok: true,
        action,
        handled: true,
        metrics: perfDebugMetrics(),
        surface: describeUiSurface()
      };
    }
    if (action === "back") {
      return {
        schema: "pucky.ui_debug_action.v1",
        ok: true,
        action,
        handled: handleAndroidBack(),
        surface: describeUiSurface()
      };
    }
    if (action === "focus_card") {
      return uiDebugFocusCard(rawArgs);
    }
    if (action === "clear_focus") {
      return uiDebugClearFocus();
    }
    if (action === "refresh_cards") {
      return uiDebugRefreshCards();
    }
    if (action === "open_card_action") {
      return uiDebugOpenCardAction(rawArgs);
    }
    return {
      schema: "pucky.ui_debug_action.v1",
      ok: false,
      action,
      handled: false,
      error: `Unsupported ui.debug action: ${action}`,
      surface: describeUiSurface()
    };
  }

  function uiDebugGotoHome() {
    let handled = false;
    for (let attempts = 0; attempts < 8; attempts += 1) {
      const changed = handleAndroidBack();
      handled = handled || changed;
      if (!changed) {
        break;
      }
    }
    if (state.route !== "home") {
      state.route = "home";
      state.lightReturnRoute = "";
      state.previousLightRoute = "home";
      persistNavState();
      render();
      handled = true;
    }
    void syncVoiceThreadScope({ reason: "debug_goto_home", render: true, force: true });
    return {
      schema: "pucky.ui_debug_action.v1",
      ok: true,
      action: "goto_home",
      handled,
      surface: describeUiSurface()
    };
  }

  function uiDebugRefreshCards() {
    void refreshCardsFromVmSnapshot({ render: true }).then(() => {
      void syncVoiceThreadScope({ reason: "debug_refresh_cards", render: true });
    });
    return {
      schema: "pucky.ui_debug_action.v1",
      ok: true,
      action: "refresh_cards",
      handled: true,
      pending: true,
      surface: describeUiSurface()
    };
  }

  function linksDebugMetrics() {
    const feed = document.getElementById("feed");
    const scrollport = linksScrollElement();
    const filtered = linksFilteredApps();
    const filteredSlugs = filtered
      .map(item => String(item && item.slug || "").trim())
      .filter(Boolean);
    const handoff = linksHandoffState();
    const scrollTop = Math.max(0, safeNumber(scrollport && scrollport.scrollTop));
    const viewportHeight = Math.max(LINKS_ROW_HEIGHT, safeNumber(scrollport && scrollport.clientHeight));
    const startIndex = filtered.length ? Math.min(filtered.length - 1, Math.max(0, Math.floor(scrollTop / LINKS_ROW_HEIGHT))) : 0;
    const endIndex = filtered.length ? Math.min(filtered.length, Math.max(startIndex + 1, Math.ceil((scrollTop + viewportHeight) / LINKS_ROW_HEIGHT))) : 0;
    const firstVisible = filtered[startIndex] || null;
    const lastVisible = filtered[Math.max(startIndex, endIndex - 1)] || null;
    return {
      schema: "pucky.links_debug_metrics.v1",
      route: state.route,
      links_route_active: state.route === "connect",
      active_scroller: scrollport ? "links-scrollport" : "feed",
      catalog_source: String(state.links.catalogSource || ""),
      catalog_version: String(state.links.catalogVersion || ""),
      filtered_app_count: filtered.length,
      filtered_slugs: filteredSlugs,
      rendered_row_count: linksPageRefs?.rows ? linksPageRefs.rows.querySelectorAll(".links-app-row").length : 0,
      connected_loaded: Boolean(state.links.connectedLoaded),
      api_token_present: Boolean(String(state.links.apiToken || "").trim()),
      portal_token_present: Boolean(String(state.links.token || "").trim()),
      session_ready: Boolean(state.links.token || state.links.userId || state.links.connectedLoaded),
      loading: Boolean(state.links.loading),
      logo_loads: safeNumber(state.links.logoLoads),
      logo_errors: safeNumber(state.links.logoErrors),
      inline_message: String(state.links.error || state.links.message || ""),
      toast_message: String(state.lastToast.message || ""),
      last_handoff_event: String(handoff.event || ""),
      last_handoff_slug: String(handoff.slug || ""),
      last_handoff_url: String(handoff.auth_url || ""),
      last_handoff_surface: String(handoff.launch_surface || ""),
      last_handoff_launched: Boolean(handoff.launched),
      last_handoff_popup_opened: Boolean(handoff.popup_opened),
      last_handoff_same_tab_navigation: Boolean(handoff.same_tab_navigation),
      last_handoff_error: String(handoff.error || ""),
      first_visible_slug: String(firstVisible && firstVisible.slug || ""),
      last_visible_slug: String(lastVisible && lastVisible.slug || ""),
      feed: {
        scroll_top: Math.max(0, safeNumber(feed && feed.scrollTop)),
        client_height: Math.max(0, safeNumber(feed && feed.clientHeight)),
        scroll_height: Math.max(0, safeNumber(feed && feed.scrollHeight))
      },
      list: {
        scroll_top: scrollTop,
        client_height: Math.max(0, safeNumber(scrollport && scrollport.clientHeight)),
        scroll_height: Math.max(0, safeNumber(scrollport && scrollport.scrollHeight))
      }
    };
  }

  function uiDebugOpenCardAction(rawArgs = {}) {
    const action = String(rawArgs.action || "transcript").trim() || "transcript";
    const sessionId = String(rawArgs.session_id || "").trim();
    const cardId = String(rawArgs.card_id || "").trim();
    if (!sessionId && !cardId) {
      return {
        schema: "pucky.ui_debug_action.v1",
        ok: false,
        action: "open_card_action",
        handled: false,
        error: "session_id or card_id is required",
        surface: describeUiSurface()
      };
    }
    const selector = sessionId
      ? `[data-card-session-id="${cssEscape(sessionId)}"][data-card-action="${cssEscape(action)}"]`
      : `[data-card-id="${cssEscape(cardId)}"][data-card-action="${cssEscape(action)}"]`;
    let target = document.querySelector(selector);
    if (!target && action === "attachment") {
      const detail = document.getElementById("detail");
      const detailSessionId = detail?.getAttribute("data-detail-session-id") || "";
      const detailCardId = detail?.getAttribute("data-detail-card-id") || "";
      const sameDetail = (sessionId && detailSessionId === sessionId) || (cardId && detailCardId === cardId);
      if (sameDetail) {
        target = detail?.querySelector(".bubble-attachment-chip");
      }
    }
    if (!target || typeof target.click !== "function") {
      return {
        schema: "pucky.ui_debug_action.v1",
        ok: false,
        action: "open_card_action",
        handled: false,
        selector,
        error: `Could not find card action target for ${action}`,
        surface: describeUiSurface()
      };
    }
    target.click();
    return {
      schema: "pucky.ui_debug_action.v1",
      ok: true,
      action: "open_card_action",
      handled: true,
      selector,
      surface: describeUiSurface()
    };
  }

  function uiDebugFocusCard(rawArgs = {}) {
    const sessionId = String(rawArgs.session_id || "").trim();
    const cardId = String(rawArgs.card_id || "").trim();
    if (!sessionId && !cardId) {
      return {
        schema: "pucky.ui_debug_action.v1",
        ok: false,
        action: "focus_card",
        handled: false,
        error: "session_id or card_id is required",
        surface: describeUiSurface()
      };
    }
    if (normalizeNavDetail(state.navDetail)) {
      uiDebugGotoHome();
    }
    if (state.route !== "inbox") {
      lightNavigate("inbox");
    }
    if (state.showArchivedFeed) {
      state.showArchivedFeed = false;
    }
    const card = sessionId
      ? findCardBySessionId(sessionId)
      : state.cards.find(item => String(item?.card_id || "") === cardId);
    const nextSessionId = cardSessionId(card) || sessionId;
    if (!card || !nextSessionId) {
      return {
        schema: "pucky.ui_debug_action.v1",
        ok: false,
        action: "focus_card",
        handled: false,
        error: "Could not find card to focus",
        surface: describeUiSurface()
      };
    }
    state.cardMenuClickSuppressUntil = Date.now() + CARD_MENU_CLICK_SUPPRESS_MS;
    state.openCardMenuSessionId = nextSessionId;
    state.openCardMenuThreadId = cardThreadId(card);
    renderFeed();
    void syncVoiceThreadScope({ reason: "debug_focus_card", render: true });
    return {
      schema: "pucky.ui_debug_action.v1",
      ok: true,
      action: "focus_card",
      handled: true,
      session_id: nextSessionId,
      surface: describeUiSurface()
    };
  }

  function uiDebugClearFocus() {
    const handled = dismissOpenCardMenu(false);
    if (!handled) {
      state.openCardMenuSessionId = "";
      state.openCardMenuThreadId = "";
      renderFeed();
      void syncVoiceThreadScope({ reason: "debug_clear_focus", render: true, force: true });
    }
    return {
      schema: "pucky.ui_debug_action.v1",
      ok: true,
      action: "clear_focus",
      handled,
      surface: describeUiSurface()
    };
  }

  function initialLinksState() {
    return {
      available: true,
      loading: false,
      error: "",
      portal_url: "",
      token: "",
      apiBaseUrl: resolveHostedBrowserApiBaseUrl(),
      apiToken: resolveHostedBrowserApiToken(),
      deviceId: resolveHostedBrowserDeviceId(),
      userId: "",
      auth_mode: "browser",
      apps: [],
      connectedApps: [],
      connectedSlugs: new Set(),
      search: "",
      openingSlug: "",
      handoffLocked: false,
      handoffDeadlineAt: 0,
      firstPageReady: false,
      totalAvailable: 0,
      connectedLoaded: false,
      catalogVersion: "",
      catalogGeneratedAt: "",
      catalogSource: "",
      catalogTelemetrySent: false,
      debugRouteSessionId: "",
      debugClickSessionId: "",
      firstRowsTelemetrySent: false,
      logoLoads: 0,
      logoErrors: 0,
      message: "",
      messageKind: "",
      lastHandoff: blankLinksHandoffState(),
      lastRefreshAt: 0
    };
  }

  function initialMeetingsState() {
    return {
      loading: false,
      loaded: false,
      error: "",
      records: [],
      lastRefreshAt: 0,
      fingerprint: ""
    };
  }

  function initialMeetingRecordingStatus() {
    return {
      schema: "pucky.meeting_recording_status.v1",
      state: "idle",
      active_meeting_id: null,
      meetings: []
    };
  }

  function initialMapTrackerStatus() {
    return {
      schema: "pucky.location_tracker_status.v1",
      running: false,
      track_id: "",
      interval_ms: 30000,
      sample_count: 0,
      last_point: null,
      bytes: 0
    };
  }

  function normalizeTurnSettings(input) {
    const raw = input && typeof input === "object" ? input : {};
    const mode = normalizeReplyMode(raw.reply_mode || raw.mode);
    const arrivalCueMode = normalizeArrivalCueMode(
      raw.arrival_cue_mode !== undefined
        ? raw.arrival_cue_mode
        : raw.accepted_chime_enabled !== false
          ? "chime"
          : "none"
    );
    const model = normalizeTurnModel(raw.model);
    const reasoningEffort = normalizeTurnReasoningEffort(raw.reasoning_effort);
    return {
      schema: "pucky.turn_settings.v1",
      reply_mode: mode,
      spoken_reply_enabled: mode === "card_and_spoken",
      arrival_cue_mode: arrivalCueMode,
      accepted_chime_enabled: arrivalCueMode === "chime" || arrivalCueMode === "haptic_and_chime",
      model,
      reasoning_effort: reasoningEffort,
      modes: Array.isArray(raw.modes) && raw.modes.length ? raw.modes : TURN_REPLY_MODES,
      arrival_cue_modes: Array.isArray(raw.arrival_cue_modes) && raw.arrival_cue_modes.length
        ? raw.arrival_cue_modes
        : TURN_ARRIVAL_CUE_MODES,
      model_options: Array.isArray(raw.model_options) && raw.model_options.length
        ? raw.model_options.map(normalizeTurnModel)
        : TURN_MODEL_OPTIONS,
      reasoning_effort_options: Array.isArray(raw.reasoning_effort_options) && raw.reasoning_effort_options.length
        ? raw.reasoning_effort_options.map(normalizeTurnReasoningEffort)
        : TURN_REASONING_EFFORT_OPTIONS
    };
  }

  function normalizeTurnModel(model) {
    const value = String(model || "").trim().toLowerCase();
    return TURN_MODEL_OPTIONS.includes(value) ? value : DEFAULT_TURN_MODEL;
  }

  function normalizeTurnReasoningEffort(reasoningEffort) {
    const value = String(reasoningEffort || "").trim().toLowerCase();
    return TURN_REASONING_EFFORT_OPTIONS.includes(value) ? value : DEFAULT_TURN_REASONING_EFFORT;
  }

  function normalizeWakeStatus(input) {
    const raw = input && typeof input === "object" ? input : {};
    return {
      schema: raw.schema || "pucky.wake_word_status.v4",
      enabled: truthy(raw.enabled),
      requested_enabled: truthy(raw.requested_enabled ?? raw.enabled),
      running: truthy(raw.running),
      state: String(raw.state || "idle"),
      suspended_reason: String(raw.suspended_reason || ""),
      engine: String(raw.engine || "android_stt_sentinel"),
      requested_engine: String(raw.requested_engine || raw.engine || "android_stt_sentinel"),
      effective_engine: String(raw.effective_engine || (truthy(raw.running) ? "android_stt_sentinel" : "stopped")),
      mode: String(raw.mode || "android_stt_wake"),
      scope: String(raw.scope || "awake_and_unlocked_foreground"),
      debug_recognizer_mode: String(raw.debug_recognizer_mode || "android"),
      recognizer_state: String(raw.recognizer_state || "idle"),
      restart_count: safeNumber(raw.restart_count),
      last_restart_reason: String(raw.last_restart_reason || ""),
      last_transcript: String(raw.last_transcript || ""),
      last_alternatives: Array.isArray(raw.last_alternatives) ? raw.last_alternatives : [],
      last_error_code: String(raw.last_error_code || ""),
      last_error_message: String(raw.last_error_message || ""),
      last_match: raw.last_match && typeof raw.last_match === "object" ? raw.last_match : {
        matched_phrase: "",
        match_source: "",
        matched_at: ""
      },
      proof_indicator: normalizeWakeProof(raw.proof_indicator)
    };
  }

  function normalizeWakeProof(input) {
    const raw = input && typeof input === "object" ? input : {};
    const active = truthy(raw.active);
    return {
      active,
      visual_state: active ? normalizeVisualState(raw.visual_state || "armed") : "idle",
      matched_phrase: String(raw.matched_phrase || ""),
      transcript: String(raw.transcript || ""),
      remaining_ms: safeNumber(raw.remaining_ms),
      expires_at_elapsed_ms: safeNumber(raw.expires_at_elapsed_ms)
    };
  }

  function wakeStatusDetail(status) {
    const current = status && typeof status === "object" ? status : initialWakeStatus();
    if (current.running) {
      return "Listening while awake and unlocked";
    }
    const reason = String(current.suspended_reason || "");
    if (reason === "device_not_interactive") {
      return "Waiting for screen wake";
    }
    if (reason === "device_locked") {
      return "Waiting for unlock";
    }
    if (reason === "turn_active") {
      return "Paused during active turn";
    }
    if (reason === "service_not_started") {
      return "Wake service starting";
    }
    if (reason === "record_audio_permission_missing") {
      return "Microphone permission required";
    }
    if (reason === "speech_recognition_unavailable") {
      return "Speech recognizer unavailable";
    }
    if (reason === "assistant_scope_reserved") {
      return "Screen-off wake not enabled in this phase";
    }
    if (current.enabled || current.requested_enabled) {
      return "Wake requested, not armed";
    }
    return "Enable the local wake phrase on device.";
  }

  function normalizeUiSurfaceStatus(input) {
    const raw = input && typeof input === "object" ? input : {};
    const bootstrap = bootstrapDebugState();
    return {
      schema: raw.schema || "pucky.ui_surface.v1",
      requested_url: String(raw.requested_url || window.location.href || ""),
      active_url: String(raw.active_url || window.location.href || ""),
      entrypoint_url: String(raw.entrypoint_url || window.location.href || ""),
      fallback_asset_url: String(raw.fallback_asset_url || ""),
      ui_version: String(raw.ui_version || bundleUiVersion() || "unknown"),
      source_commit_full: String(raw.source_commit_full || bundleConfig().source_commit_full || ""),
      source_commit_short: String(raw.source_commit_short || bundleConfig().source_commit_short || ""),
      source_dirty: Boolean(raw.source_dirty ?? bundleConfig().source_dirty),
      source_kind: String(raw.source_kind || "legacy_placeholder"),
      bridge_connected: truthy(raw.bridge_connected ?? !!window.PuckyAndroid),
      audio_runtime_mode: String(raw.audio_runtime_mode || audioRuntimeMode()),
      shell_launch_elapsed_ms: safeNumber(raw.shell_launch_elapsed_ms || bootstrap.shell_launch_elapsed_ms),
      webview_load_elapsed_ms: safeNumber(raw.webview_load_elapsed_ms || bootstrap.webview_load_elapsed_ms),
      hosted_reload_attempts: safeNumber(raw.hosted_reload_attempts || bootstrap.hosted_reload_attempts),
      asset_delivery_failures: safeNumber(raw.asset_delivery_failures || bootstrap.asset_delivery_failures)
    };
  }

  function normalizeReplyMode(mode) {
    const value = String(mode || "").trim().toLowerCase();
    return value === "card_and_spoken" || value === "spoken" || value === "voice"
      ? "card_and_spoken"
      : "card_only";
  }

  function normalizeArrivalCueMode(mode) {
    const value = String(mode || "").trim().toLowerCase();
    if (value === "haptic_and_chime" || value === "both" || value === "buzz_and_chime") {
      return "haptic_and_chime";
    }
    if (value === "haptic" || value === "buzz" || value === "vibrate") {
      return "haptic";
    }
    if (value === "none" || value === "off" || value === "silent") {
      return "none";
    }
    return "chime";
  }

  function applyTurnStatus(input) {
    state.turn = normalizeTurnStatus(input);
  }

  function applyVoiceState(input) {
    if (input && typeof input === "object" && input.schema === "pucky.turn_status.v1") {
      applyTurnStatus(input);
      return;
    }
    loadTurnStatus({ render: false });
  }

  function normalizeTurnStatus(input) {
    const raw = input && typeof input === "object" ? input : {};
    const rawIndicator = raw.indicator && typeof raw.indicator === "object" ? raw.indicator : {};
    const rawLast = raw.last_status && typeof raw.last_status === "object" ? raw.last_status : {};
    const remoteStage = String(rawIndicator.remote_stage || raw.remote_stage || raw.stage || rawLast.remote_stage || rawLast.stage || "").trim();
    const rawState = String(rawIndicator.state || raw.state || raw.stage || rawLast.state || rawLast.stage || "idle").trim();
    const rawVisualState = String(rawIndicator.visual_state || raw.visual_state || raw.stage || rawLast.visual_state || rawLast.stage || rawState).trim();
    const indicator = {
      schema: "pucky.turn_indicator.v1",
      state: normalizeTurnState(rawState),
      visual_state: normalizeVisualState(rawVisualState),
      mic_on: truthy(rawIndicator.mic_on ?? raw.mic_on),
      hearing: truthy(rawIndicator.hearing ?? raw.hearing),
      speech_detected: truthy(rawIndicator.speech_detected ?? raw.speech_detected),
      vad_engine: String(rawIndicator.vad_engine || raw.vad_engine || "").trim(),
      vad_available: truthy(rawIndicator.vad_available ?? raw.vad_available),
      vad_probability: safeNumber(rawIndicator.vad_probability ?? raw.vad_probability),
      speech_frames: safeNumber(rawIndicator.speech_frames ?? raw.speech_frames),
      uploading: truthy(rawIndicator.uploading ?? raw.uploading),
      stt_running: truthy(rawIndicator.stt_running ?? raw.stt_running) || remoteStage === "stt_running",
      codex_running: truthy(rawIndicator.codex_running ?? raw.codex_running) || remoteStage === "codex_running",
      tts_running: truthy(rawIndicator.tts_running ?? raw.tts_running) || remoteStage === "tts_running",
      speaking: truthy(rawIndicator.speaking ?? raw.speaking),
      failed: truthy(rawIndicator.failed ?? raw.failed),
      active: truthy(rawIndicator.active ?? raw.active),
      remote_stage: remoteStage,
      amplitude: safeNumber(rawIndicator.amplitude ?? raw.amplitude),
      elapsed_ms: safeNumber(rawIndicator.elapsed_ms ?? raw.elapsed_ms),
      peak_amplitude: safeNumber(rawIndicator.peak_amplitude ?? raw.peak_amplitude),
      samples_over_threshold: safeNumber(rawIndicator.samples_over_threshold ?? raw.samples_over_threshold),
      gate_latency_ms: safeNumber(rawIndicator.gate_latency_ms ?? raw.gate_latency_ms)
    };
    if (shouldTreatReplyRecoveryAsSettled(raw, indicator)) {
      indicator.state = "idle";
      indicator.visual_state = "idle";
      indicator.uploading = false;
      indicator.stt_running = false;
      indicator.codex_running = false;
      indicator.tts_running = false;
      indicator.speaking = false;
      indicator.failed = false;
      indicator.active = false;
    }
    indicator.active = indicator.active || indicator.visual_state !== "idle";
    return {
      ...raw,
      schema: raw.schema || "pucky.turn_status.v1",
      configured: truthy(raw.configured),
      indicator
    };
  }

  function shouldTreatReplyRecoveryAsSettled(raw, indicator) {
    const last = raw && typeof raw.last_status === "object" ? raw.last_status : {};
    const serverTurnStatus = last && typeof last.server_turn_status === "object" ? last.server_turn_status : {};
    const player = raw && typeof raw.player_state === "object" ? raw.player_state : {};
    const replyRecoveryPending = truthy(raw.reply_recovery_pending ?? last.reply_recovery_pending);
    const responseTransportError = String(raw.response_transport_error || last.response_transport_error || "").trim();
    const remoteStage = String(indicator.remote_stage || raw.remote_stage || last.remote_stage || "").trim().toLowerCase();
    const serverStage = String(serverTurnStatus.stage || "").trim().toLowerCase();
    const feedPersisted = truthy(serverTurnStatus.feed_persisted);
    const playerState = String(player.state || "").trim().toLowerCase();
    const playerCompleted = !truthy(player.is_playing)
      && (!String(player.source || "").trim() || playerState === "completed" || playerState === "idle" || playerState === "stopped");
    const transportActive = indicator.uploading
      || indicator.stt_running
      || indicator.codex_running
      || indicator.tts_running;
    const visuallyActive = indicator.visual_state === "uploading" || indicator.visual_state === "thinking";
    if (!replyRecoveryPending || !responseTransportError) {
      return false;
    }
    if (indicator.mic_on || indicator.hearing || indicator.speaking) {
      return false;
    }
    if (transportActive || visuallyActive) {
      return false;
    }
    if (remoteStage !== "completed" && serverStage !== "completed") {
      return false;
    }
    return feedPersisted || playerCompleted;
  }

  function turnIndicatorFromStatus(status) {
    return normalizeTurnStatus(status).indicator;
  }

  function normalizeTurnState(input) {
    const value = String(input || "").trim().toLowerCase();
    if (["armed", "recording", "discarded_silence", "uploading", "stt_running", "codex_running", "tts_running", "speaking", "failed"].includes(value)) {
      return value;
    }
    return "idle";
  }

  function normalizeVisualState(input) {
    const value = String(input || "").trim().toLowerCase();
    if (["idle", "armed", "recording", "uploading", "thinking", "speaking", "meeting_recording"].includes(value)) {
      return value;
    }
    if (["stt_running", "tts_running", "upload_received"].includes(value)) return "uploading";
    if (value === "codex_running") return "thinking";
    if (value === "discarded_silence") return "idle";
    return "idle";
  }

  function turnVisualState(status) {
    const indicator = turnIndicatorFromStatus(status);
    return normalizeVisualState(indicator.visual_state || indicator.state);
  }

  function wakeProofVisualState(status) {
    const proof = normalizeWakeStatus(status).proof_indicator;
    if (!proof.active) {
      return "idle";
    }
    return normalizeVisualState(proof.visual_state || "armed");
  }

  function normalizeMeetingRecordingStatus(input) {
    const raw = input && typeof input === "object" ? input : {};
    return {
      ...initialMeetingRecordingStatus(),
      ...raw,
      state: String(raw.state || "idle").trim().toLowerCase()
    };
  }

  function meetingRecordingVisualState() {
    const status = normalizeMeetingRecordingStatus(state.meetingRecording);
    if (status.state === "recording") {
      return "meeting_recording";
    }
    return "idle";
  }

  function turnStateLabel(visualState) {
    const labels = {
      idle: "idle",
      armed: "armed",
      recording: "recording",
      uploading: "uploading",
      thinking: "thinking",
      speaking: "speaking",
      meeting_recording: "meeting recording"
    };
    return labels[visualState] || "idle";
  }

  function isTurnActive(status) {
    const indicator = turnIndicatorFromStatus(status);
    return Boolean(indicator.mic_on || indicator.uploading || indicator.stt_running
      || indicator.codex_running || indicator.tts_running || indicator.speaking
      || indicator.active || turnVisualState(status) !== "idle");
  }

  function turnRequestedThreadMode(status) {
    return String(normalizeTurnStatus(status).requested_thread_mode || "").trim().toLowerCase();
  }

  function turnRequestedThreadId(status) {
    return String(normalizeTurnStatus(status).requested_thread_id || "").trim();
  }

  function turnUserTranscript(status) {
    return String(normalizeTurnStatus(status).user_transcript || "").trim();
  }

  function turnStatusTimestamp(status) {
    const normalized = normalizeTurnStatus(status);
    return String(normalized.updated_at || normalized.created_at || normalized.timestamp || "").trim();
  }

  function turnFailed(status) {
    const normalized = normalizeTurnStatus(status);
    const indicator = turnIndicatorFromStatus(normalized);
    const stage = String(normalized.stage || "").trim().toLowerCase();
    const value = String(normalized.status || "").trim().toLowerCase();
    return Boolean(indicator.failed || stage === "failed" || value === "failed");
  }

  function turnFailureSummary(status) {
    const normalized = normalizeTurnStatus(status);
    const failureReason = String(
      normalized.failure_reason
      || normalized.detail
      || normalized.error
      || normalized.error_message
      || ""
    ).trim();
    if (failureReason) {
      return failureReason;
    }
    const errorType = String(normalized.error_type || "").trim();
    if (errorType) {
      return `Turn failed before a reply was produced (${errorType}).`;
    }
    return "Turn failed before a reply was produced.";
  }

  function pendingTurnState(status) {
    if (turnFailed(status)) {
      return "failed";
    }
    const normalized = normalizeTurnStatus(status);
    const stage = String(normalized.stage || "").trim().toLowerCase();
    const visualState = turnVisualState(normalized);
    if (visualState === "thinking" || stage === "codex_running" || stage === "tts_running") {
      return "thinking";
    }
    return "sending";
  }

  function truthy(value) {
    return value === true || value === 1 || value === "1" || value === "true";
  }

  function safeNumber(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : 0;
  }

  function dismissTransientUiForRouteChange() {
    dismissArchiveReveal({ immediate: true, reason: "route_change", context: "route_change" });
    dismissOpenCardMenu(false);
    state.inboxManageMode = false;
    inboxManageSelection().clear();
    clearTaskSelection();
    dismissTraceSheet();
    dismissOriginSheet();
    dismissAdvancedSettingsSheet();
    closeSettingsSelector();
    closeSpeedPicker();
    dismissDetail();
    state.audioCard = null;
  }

  function filterIconButton(filter) {
    const selected = !state.showArchivedFeed && isFeedIconIncluded(filter.key);
    const button = el("button", selected ? "filter-icon is-selected" : "filter-icon");
    const semanticAccentKey = canonicalIconAccentKey(filter.icon || filter.key);
    button.type = "button";
    button.dataset.filterIcon = filter.key;
    button.dataset.appAccent = semanticAccentKey || "";
    button.style.setProperty("--filter-accent", resolvedFilterAccentValue(filter));
    button.setAttribute("aria-label", filter.label);
    button.setAttribute("aria-pressed", selected ? "true" : "false");
    button.innerHTML = replyCardIconSvg(filter.icon, { filled: selected });
    button.addEventListener("click", () => {
      if (state.showArchivedFeed) {
        state.showArchivedFeed = false;
        state.excludedFeedIcons = new Set(uniqueFeedIcons().filter(icon => icon !== filter.key));
        persistFeedIconExcludes();
        render();
        persistNavState();
        return;
      }
      toggleFeedIcon(filter.key);
    });
    return button;
  }

  function renderFeed() {
    const feed = document.getElementById("feed");
    const route = effectiveRoute();
    const theme = effectiveTheme();
    const shell = document.querySelector(".app-shell");
    shell?.setAttribute("data-view", state.route || "home");
    shell?.setAttribute("data-theme", theme);
    shell?.setAttribute("data-canonical-route", route || "home");
    shell?.setAttribute("data-embedded-app", embeddedLightApp());
    shell?.setAttribute("data-chrome-mode", chromeMode());
    shell?.classList.toggle("is-inbox-managing", route === "inbox" && Boolean(state.inboxManageMode));
    shell?.classList.toggle("is-inbox-archive-filter-loading", route === "inbox" && inboxArchiveFilterPending());
    if (route === "inbox" && inboxArchiveFilterPending()) {
      shell?.setAttribute("data-inbox-archive-filter-pending-target", String(Boolean(state.inboxArchiveFilterPendingTarget)));
    } else {
      shell?.removeAttribute("data-inbox-archive-filter-pending-target");
    }
    feed.classList.toggle("is-links-route", route === "connect");
    dismissArchiveReveal({ immediate: true, reason: "unknown", context: "render_feed" });
    syncRouteQueryParam(route);
    if (isHomeShellMockRoute()) {
      const page = lightMockRoutePage(route) || lightHomePage();
      const currentView = feed.firstElementChild;
      if (!(currentView instanceof HTMLElement)
          || currentView.dataset.homeShellKind !== "mock"
          || currentView.dataset.lightRoute !== (route || "home")
          || currentView.firstElementChild !== page
          || feed.childElementCount !== 1) {
        feed.replaceChildren(homeShellMockView(route, page));
      }
      return;
    }
    if (route === "settings") {
      feed.replaceChildren(homeShellCanonicalView(route, lightSettingsSurface()));
      return;
    }
    if (route === "connect") {
      const page = homeShellCanonicalView(route, lightAppsPage());
      if (feed.firstElementChild !== page || feed.childElementCount !== 1) {
        feed.replaceChildren(page);
      }
      syncLinksPage();
      return;
    }
    if (route === "meetings") {
      feed.replaceChildren(homeShellCanonicalView(route, lightMeetingsPage()));
      return;
    }
    if (route === "inbox") {
      feed.replaceChildren(homeShellCanonicalView(route, lightInboxPage()));
      return;
    }
    state.route = "home";
    syncRouteQueryParam("home");
    feed.replaceChildren(lightView());
  }

  function renderHomeFeedInto(container) {
    container.replaceChildren(...homeFeedContentNodes());
  }

  function homeShellCanonicalView(route, page) {
    const view = el("section", "light-shell");
    view.dataset.lightRoute = route || "home";
    view.dataset.homeShellKind = HOME_SHELL_CANONICAL_ROUTES.has(route) ? "canonical" : "mock";
    view.append(page);
    return view;
  }

  function homeShellMockView(route, page) {
    const view = el("section", "light-shell");
    view.dataset.lightRoute = route || "home";
    view.dataset.homeShellKind = "mock";
    view.append(page);
    return view;
  }

  function homeFeedContentNodes() {
    const displayCards = feedDisplayCards();
    if (state.feedLoadError && !displayCards.length) {
      const empty = el("div", "empty feed-load-error");
      empty.append(
        el("strong", "", "Could not load the Home feed."),
        el("span", "", state.feedLoadError)
      );
      return [empty];
    }
    if (!displayCards.length) {
      const empty = el("div", "empty");
      empty.append("No replies yet.", document.createElement("br"), "Pucky will place agent replies here.");
      return [empty];
    }
    const cards = filteredFeedCards(displayCards);
    if (!cards.length) {
      return [filteredFeedEmptyView()];
    }
    return cards.map(cardView);
  }

  function lightMockRoutePage(route = state.route) {
    switch (route) {
      case "inbox-detail":
        return lightFeedDetailPage();
      case "contacts":
        return lightContactsPage();
      case "contact-detail":
        return lightContactDetailPage();
      case "contact-edit":
        return lightContactEditPage();
      case "calendar":
        return lightCalendarPage();
      case "meeting-detail":
        return lightMeetingDetailPage();
      case "meeting-notes":
        return lightMeetingNotesPage();
      case "meeting-note-detail":
        return lightMeetingNoteDetailPage();
      case "reminders":
        return lightRemindersPage();
      case "reminder-detail":
        return lightReminderDetailPage();
      case "notes":
        return lightNotesPage();
      case "note-detail":
        return lightNoteDetailPage();
      case "tasks":
        return lightTasksPage();
      case "task-detail":
        return lightTaskDetailPage();
      case "projects":
        return lightProjectsPage();
      case "project-detail":
        return lightProjectDetailPage();
      case "home":
      default:
        return null;
    }
  }

  function lightView() {
    const route = state.route || "home";
    const mockPage = lightMockRoutePage(route);
    const page = mockPage || lightHomePage();
    if (!mockPage && route !== "home") {
      state.route = "home";
      return homeShellMockView("home", page);
    }
    return homeShellMockView(route, page);
  }

  function lightHomePage() {
    const reminderBucket = workspaceBucket("reminders");
    if (!reminderBucket.loaded && !reminderBucket.loading) {
      void loadWorkspaceCollection("reminders", { render: true });
    }
    const page = el("section", "light-home");
    const grid = el("div", "light-app-grid");
    grid.append(...LIGHT_APPS.map(lightAppTile));
    page.append(grid);
    return page;
  }

  function lightAppTile(app) {
    const tile = el("button", "light-app-tile");
    tile.type = "button";
    tile.dataset.route = app.route;
    tile.dataset.lightAppRoute = app.route;
    tile.dataset.appLabel = app.label;
    tile.dataset.semanticIcon = app.semantic;
    tile.setAttribute("aria-label", app.label);
    tile.addEventListener("click", () => openLightApp(app.route));
    const icon = lightAppIcon(app);
    const badge = lightAppBadge(app);
    tile.append(icon, el("span", "light-app-label", app.label));
    if (badge) {
      tile.append(badge);
    }
    return tile;
  }

  function lightAppBadge(app) {
    const value = lightAppBadgeValue(app);
    if (!value) {
      return null;
    }
    const badge = el("span", "light-app-badge", value);
    badge.setAttribute("aria-label", `${app.label} active count ${value}`);
    return badge;
  }

  function lightAppBadgeValue(app) {
    if (String(app?.route || "") !== "reminders") {
      return "";
    }
    const count = activeReminderCount();
    if (!count) {
      return "";
    }
    return count > 99 ? "99+" : String(count);
  }

  function openLightApp(route) {
    if (String(route || "") === "calendar") {
      state.selectedCalendarDate = calendarTodayDateKey();
    }
    lightNavigate(route);
  }

  function semanticIconAccentKey(accentKey) {
    const key = String(accentKey || "").trim().toLowerCase();
    return SEMANTIC_ICON_REGISTRY[key] ? key : "";
  }

  function semanticIconName(accentKey) {
    const key = semanticIconAccentKey(accentKey) || "inbox";
    const entry = SEMANTIC_ICON_REGISTRY[key] || SEMANTIC_ICON_REGISTRY.inbox;
    return String(entry.icon || SEMANTIC_ICON_REGISTRY.inbox?.icon || "mail").trim();
  }

  function semanticIconAccentValue(accentKey, theme = effectiveTheme()) {
    const key = semanticIconAccentKey(accentKey) || "inbox";
    const entry = SEMANTIC_ICON_REGISTRY[key] || SEMANTIC_ICON_REGISTRY.inbox;
    const colors = entry.colors && typeof entry.colors === "object" ? entry.colors : {};
    const mode = normalizeTheme(theme) === "light" ? "light" : "dark";
    return String(colors[mode] || colors.dark || colors.light || "#8b63ff").trim();
  }

  function applySemanticIconAccent(node, accentKey, options = {}) {
    const key = semanticIconAccentKey(accentKey);
    const propertyName = String(options?.propertyName || "--icon-accent");
    if (!key && options?.allowEmpty) {
      delete node.dataset.appAccent;
      node.style.removeProperty(propertyName);
      return "";
    }
    const resolvedKey = key || "inbox";
    const accent = semanticIconAccentValue(resolvedKey, options?.theme || effectiveTheme());
    node.dataset.appAccent = resolvedKey;
    node.style.setProperty(propertyName, accent);
    return accent;
  }

  function canonicalIconAccentKey(iconKey) {
    const key = normalizeReplyCardIcon(iconKey);
    return SEMANTIC_ICON_KEY_BY_ICON[key] || "";
  }

  function resolvedFilterAccentValue(filter, theme = effectiveTheme()) {
    const semanticAccentKey = canonicalIconAccentKey(filter.icon || filter.key);
    if (semanticAccentKey) {
      return semanticIconAccentValue(semanticAccentKey, theme);
    }
    return String(filter?.accent || "#f5f9ff");
  }

  function lightAppIcon(app, accentKey = "") {
    const wrap = el("span", "light-app-icon");
    if (app && typeof app === "object" && !Array.isArray(app)) {
      wrap.dataset.semanticIcon = app.semantic;
      applySemanticIconAccent(wrap, app?.semantic);
      wrap.innerHTML = iconSvg(semanticIconName(app?.semantic), { filled: false });
      return wrap;
    }
    applySemanticIconAccent(wrap, accentKey, { allowEmpty: true });
    wrap.innerHTML = iconSvg(app, { filled: false });
    return wrap;
  }

  function lightWorkspaceStatus(collection, icon, emptyTitle) {
    const bucket = workspaceBucket(collection);
    if (bucket.error) {
      return lightEmptyState("warning", "Could not load", bucket.error);
    }
    if (!bucket.loaded) {
      return lightEmptyState(icon, "Loading", "Pulling workspace records from the VM.");
    }
    if (bucket.loaded && !workspaceItems(collection).length) {
      return lightEmptyState(icon, emptyTitle, "Agent-created records will appear here.");
    }
    return null;
  }

  function contactIsSelf(contact) {
    const metadata = contact && typeof contact === "object" && contact.metadata && typeof contact.metadata === "object"
      ? contact.metadata
      : {};
    return String(contact?.id || contact?.record_id || "").trim() === SELF_CONTACT_ID || Boolean(metadata.is_self);
  }

  function contactsListItems() {
    return workspaceItems("contacts")
      .filter(contact => contactRecordId(contact) !== "clinic-front-desk")
      .slice()
      .sort((left, right) => {
        const leftSelf = contactIsSelf(left);
        const rightSelf = contactIsSelf(right);
        if (leftSelf !== rightSelf) {
          return leftSelf ? -1 : 1;
        }
        return String(left?.title || "").localeCompare(String(right?.title || ""));
      });
  }

  function normalizeSearchDigits(value) {
    return String(value || "").replace(/\D+/g, "");
  }

  function contactSearchTerms(contact) {
    const meta = contact && typeof contact === "object" && contact.metadata && typeof contact.metadata === "object"
      ? contact.metadata
      : {};
    const activity = Array.isArray(meta.activity) ? meta.activity : [];
    return [
      contact?.title,
      contact?.summary,
      meta.display_name,
      meta.first_name,
      meta.last_name,
      meta.email,
      meta.phone,
      ...activity,
    ]
      .map(value => String(value || "").trim())
      .filter(Boolean);
  }

  function contactMatchesSearch(contact, needle = state.contacts.search) {
    const query = String(needle || "").trim().toLowerCase();
    if (!query) {
      return true;
    }
    if (contactSearchTerms(contact).some(value => value.toLowerCase().includes(query))) {
      return true;
    }
    const phoneDigits = normalizeSearchDigits(contact?.metadata?.phone);
    const queryDigits = normalizeSearchDigits(query);
    return Boolean(phoneDigits && queryDigits && phoneDigits.includes(queryDigits));
  }

  function filteredContactsListItems() {
    return contactsListItems().filter(contact => contactMatchesSearch(contact));
  }

  function contactRecordId(contact) {
    return String(contact?.id || contact?.record_id || "").trim();
  }

  function contactNameParts(contact) {
    const meta = contact && typeof contact === "object" && contact.metadata && typeof contact.metadata === "object"
      ? contact.metadata
      : {};
    const first = String(meta.first_name || "").trim();
    const last = String(meta.last_name || "").trim();
    if (first || last) {
      return { first, last };
    }
    const title = String(meta.display_name || contact?.title || "").trim();
    if (!title) {
      return { first: "", last: "" };
    }
    const parts = title.split(/\s+/).filter(Boolean);
    if (parts.length <= 1) {
      return { first: title, last: "" };
    }
    return {
      first: parts.shift() || "",
      last: parts.join(" "),
    };
  }

  function contactDraftDisplayName(draft, fallbackContact = null) {
    if (contactIsSelf(fallbackContact)) {
      return "Me";
    }
    const first = String(draft?.firstName || "").trim();
    const last = String(draft?.lastName || "").trim();
    const fullName = [first, last].filter(Boolean).join(" ").trim();
    if (fullName) {
      return fullName;
    }
    if (first) {
      return first;
    }
    if (last) {
      return last;
    }
    return "Unnamed contact";
  }

  function contactDisplayTitle(contact) {
    if (contactIsSelf(contact)) {
      return "Me";
    }
    const meta = contact && typeof contact === "object" && contact.metadata && typeof contact.metadata === "object"
      ? contact.metadata
      : {};
    const first = String(meta.first_name || "").trim();
    const last = String(meta.last_name || "").trim();
    const fullName = [first, last].filter(Boolean).join(" ").trim();
    if (fullName) {
      return fullName;
    }
    const displayName = String(meta.display_name || contact?.title || "").trim();
    return displayName || "Unnamed contact";
  }

  function contactInitialsFromText(value, fallback = "CT") {
    const letters = String(value || "")
      .replace(/[^A-Za-z0-9]+/g, " ")
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    if (letters.length >= 2) {
      return `${letters[0].charAt(0)}${letters[letters.length - 1].charAt(0)}`.toUpperCase();
    }
    if (letters.length === 1) {
      return letters[0].charAt(0).toUpperCase();
    }
    return String(fallback || "CT").slice(0, 2).toUpperCase();
  }

  function contactAvatarText(contact) {
    if (contactIsSelf(contact)) {
      return "ME";
    }
    const meta = contact && typeof contact === "object" && contact.metadata && typeof contact.metadata === "object"
      ? contact.metadata
      : {};
    const displayTitle = contactDisplayTitle(contact);
    return contactInitialsFromText(displayTitle, String(meta.avatar || displayTitle || "CT"));
  }

  function contactDraftAvatar(draft, fallbackContact = null) {
    if (contactIsSelf(fallbackContact)) {
      return "ME";
    }
    const draftTitle = contactDraftDisplayName(draft, fallbackContact);
    if (draftTitle && draftTitle !== "Unnamed contact") {
      return contactInitialsFromText(draftTitle, String(fallbackContact?.metadata?.avatar || draftTitle || "CT"));
    }
    const fallbackTitle = contactDisplayTitle(fallbackContact);
    return contactInitialsFromText(fallbackTitle, String(fallbackContact?.metadata?.avatar || fallbackTitle || "CT"));
  }

  function buildContactEditDraft(contact) {
    const meta = contact?.metadata || {};
    const name = contactNameParts(contact);
    const draft = {
      contactId: contactRecordId(contact),
      firstName: name.first,
      lastName: name.last,
      summary: String(contact?.summary || "").trim(),
      email: String(meta.email || "").trim(),
      phone: String(meta.phone || "").trim(),
      photo: String(meta.photo || "").trim(),
      photoAssetId: String(meta.photo_asset_id || "").trim(),
      activity: Array.isArray(meta.activity) ? meta.activity.map(value => String(value || "")) : [],
    };
    draft.initialSnapshot = contactEditDraftSnapshot(draft);
    return draft;
  }

  function contactEditDraftSnapshot(draft) {
    return JSON.stringify({
      firstName: String(draft?.firstName || "").trim(),
      lastName: String(draft?.lastName || "").trim(),
      summary: String(draft?.summary || "").trim(),
      email: String(draft?.email || "").trim(),
      phone: String(draft?.phone || "").trim(),
      photo: String(draft?.photo || "").trim(),
      photoAssetId: String(draft?.photoAssetId || "").trim(),
      activity: Array.isArray(draft?.activity) ? draft.activity.map(value => String(value || "")) : [],
    });
  }

  function ensureContactEditDraft(contact) {
    const contactId = contactRecordId(contact);
    const current = state.contacts.editDraft;
    if (current && current.contactId === contactId) {
      return current;
    }
    const draft = buildContactEditDraft(contact);
    state.contacts.editDraft = draft;
    state.contacts.editQueued = false;
    state.contacts.editStatus = "saved";
    state.contacts.editError = "";
    return draft;
  }

  function clearContactDetailAutosaveTimer() {
    if (!contactDetailAutosaveTimer) {
      return;
    }
    clearTimeout(contactDetailAutosaveTimer);
    contactDetailAutosaveTimer = 0;
  }

  function clearContactEditDraft() {
    clearContactDetailAutosaveTimer();
    state.contacts.editDraft = null;
    state.contacts.editSaving = false;
    state.contacts.editQueued = false;
    state.contacts.editStatus = "idle";
    state.contacts.editError = "";
  }

  function contactEditHasUnsavedChanges(draft = state.contacts.editDraft) {
    if (!draft) {
      return false;
    }
    return contactEditDraftSnapshot(draft) !== String(draft.initialSnapshot || "");
  }

  function updateContactEditDraft(patch = {}) {
    if (!state.contacts.editDraft || !patch || typeof patch !== "object") {
      return;
    }
    const nextActivity = Object.prototype.hasOwnProperty.call(patch, "activity")
      ? (Array.isArray(patch.activity) ? patch.activity.slice() : [])
      : (Array.isArray(state.contacts.editDraft.activity) ? state.contacts.editDraft.activity.slice() : []);
    state.contacts.editDraft = {
      ...state.contacts.editDraft,
      ...patch,
      activity: nextActivity,
    };
  }

  function contactDraftActivity(draft, fallbackContact = null) {
    if (Array.isArray(draft?.activity)) {
      return draft.activity.map(value => String(value || ""));
    }
    const activity = fallbackContact?.metadata?.activity;
    return Array.isArray(activity) ? activity.map(value => String(value || "")) : [];
  }

  function contactEditPreviewRecord(contact, draft) {
    const title = contactDraftDisplayName(draft, contact);
    return {
      ...contact,
      title: contactIsSelf(contact) ? "Me" : title,
      summary: String(draft?.summary || "").trim(),
      metadata: {
        ...(contact?.metadata || {}),
        display_name: contactIsSelf(contact) ? "Me" : title,
        first_name: String(draft?.firstName || "").trim(),
        last_name: String(draft?.lastName || "").trim(),
        email: String(draft?.email || "").trim(),
        phone: String(draft?.phone || "").trim(),
        avatar: contactDraftAvatar(draft, contact),
        photo: String(draft?.photo || "").trim(),
        activity: contactDraftActivity(draft, contact),
      }
    };
  }

  function loadImageElement(src) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error("Could not load the selected photo."));
      image.src = src;
    });
  }

  function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(new Error("Could not read the selected photo."));
      reader.readAsDataURL(file);
    });
  }

  async function prepareContactPhotoDraft(file) {
    const sourceDataUrl = await readFileAsDataUrl(file);
    const image = await loadImageElement(sourceDataUrl);
    const longestEdge = Math.max(Number(image.naturalWidth || 0), Number(image.naturalHeight || 0), 1);
    const scale = Math.min(1, 512 / longestEdge);
    const width = Math.max(1, Math.round(Number(image.naturalWidth || 1) * scale));
    const height = Math.max(1, Math.round(Number(image.naturalHeight || 1) * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error("Canvas is unavailable.");
    }
    context.drawImage(image, 0, 0, width, height);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.82);
    return {
      photo: dataUrl,
      photoAssetId: "",
    };
  }

  function mergeContactRecordIntoBucket(record) {
    const bucket = state.workspace.contacts;
    const nextId = contactRecordId(record);
    if (!bucket || !Array.isArray(bucket.items) || !nextId) {
      return;
    }
    let replaced = false;
    bucket.items = bucket.items.map(item => {
      if (contactRecordId(item) !== nextId) {
        return item;
      }
      replaced = true;
      return record;
    });
    if (!replaced) {
      bucket.items.push(record);
    }
  }

  function cloneContactEditDraft(draft) {
    return {
      ...draft,
      activity: Array.isArray(draft?.activity) ? draft.activity.slice() : [],
    };
  }

  function contactEditStatusLabel() {
    if (state.contacts.editStatus === "error") {
      return "Couldn't save";
    }
    if (state.contacts.editSaving || state.contacts.editStatus === "saving" || state.contacts.editStatus === "dirty") {
      return "Saving...";
    }
    return "Saved";
  }

  function resolveContactEditFlushWaiters(result) {
    const waiters = contactEditFlushWaiters.splice(0, contactEditFlushWaiters.length);
    waiters.forEach(resolve => resolve(result));
  }

  function syncContactInputValue(input, value) {
    if (!(input instanceof HTMLInputElement || input instanceof HTMLTextAreaElement)) {
      return;
    }
    if (document.activeElement === input) {
      return;
    }
    const nextValue = String(value || "");
    if (input.value !== nextValue) {
      input.value = nextValue;
    }
  }

  function scheduleContactDetailAutosave() {
    clearContactDetailAutosaveTimer();
    state.contacts.editStatus = "dirty";
    syncContactDetailEditor();
    contactDetailAutosaveTimer = window.setTimeout(() => {
      contactDetailAutosaveTimer = 0;
      void flushContactDetailAutosave({ reason: "debounce" });
    }, 350);
  }

  function contactEditPayload(contact, draft) {
    const title = contactIsSelf(contact) ? "Me" : contactDraftDisplayName(draft, contact);
    const meta = contact?.metadata || {};
    const payload = {
      title,
      summary: String(draft?.summary || "").trim(),
      metadata: {
        display_name: title,
        email: String(draft?.email || "").trim(),
        phone: String(draft?.phone || "").trim(),
        avatar: contactDraftAvatar(draft, contact),
        photo: String(draft?.photo || "").trim(),
        photo_asset_id: String(draft?.photo || "").trim() ? "" : "",
      }
    };
    if (!contactIsSelf(contact)) {
      payload.metadata.first_name = String(draft?.firstName || "").trim();
      payload.metadata.last_name = String(draft?.lastName || "").trim();
      payload.metadata.activity = contactDraftActivity(draft, contact);
    } else if (Array.isArray(meta.activity)) {
      payload.metadata.activity = meta.activity.map(value => String(value || ""));
    }
    return payload;
  }

  async function flushContactDetailAutosave(options = {}) {
    clearContactDetailAutosaveTimer();
    const contact = selectedContact();
    const draft = state.contacts.editDraft;
    const contactId = contactRecordId(contact);
    if (!draft || !contactId) {
      return true;
    }
    if (state.contacts.editSaving) {
      if (contactEditHasUnsavedChanges(state.contacts.editDraft)) {
        state.contacts.editQueued = true;
      }
      return new Promise(resolve => {
        contactEditFlushWaiters.push(resolve);
      });
    }
    if (!contactEditHasUnsavedChanges(draft)) {
      if (state.contacts.editStatus !== "error") {
        state.contacts.editStatus = "saved";
        syncContactDetailEditor();
      }
      return true;
    }
    state.contacts.editSaving = true;
    state.contacts.editQueued = false;
    state.contacts.editStatus = "saving";
    state.contacts.editError = "";
    syncContactDetailEditor();
    let lastUpdated = null;
    let success = false;
    try {
      while (true) {
        state.contacts.editQueued = false;
        const draftForSave = cloneContactEditDraft(state.contacts.editDraft);
        const payload = contactEditPayload(selectedContact() || contact, draftForSave);
        const savedSnapshot = contactEditDraftSnapshot(draftForSave);
        const updated = await patchWorkspaceRecord("contacts", contactId, payload);
        mergeContactRecordIntoBucket(updated);
        state.selectedContactId = contactRecordId(updated) || contactId;
        lastUpdated = updated;
        if (state.contacts.editDraft && state.contacts.editDraft.contactId === contactId) {
          state.contacts.editDraft.photoAssetId = "";
          state.contacts.editDraft.initialSnapshot = savedSnapshot;
        }
        if (!state.contacts.editQueued && !contactEditHasUnsavedChanges(state.contacts.editDraft)) {
          break;
        }
      }
      success = true;
      state.contacts.editStatus = "saved";
      state.contacts.editError = "";
      return lastUpdated || true;
    } catch (error) {
      state.contacts.editStatus = "error";
      state.contacts.editError = String(error?.message || "Could not save contact.");
      showToast(state.contacts.editError);
      return false;
    } finally {
      state.contacts.editSaving = false;
      syncContactDetailEditor();
      resolveContactEditFlushWaiters(success ? (lastUpdated || true) : false);
    }
  }

  function updateContactDetailDraftAndSchedule(patch = {}, options = {}) {
    updateContactEditDraft(patch);
    state.contacts.editStatus = "dirty";
    syncContactDetailEditor();
    if (options.immediate) {
      void flushContactDetailAutosave({ reason: options.reason || "immediate" });
      return;
    }
    scheduleContactDetailAutosave();
  }

  function updateContactDetailActivityValue(index, value) {
    const nextActivity = contactDraftActivity(state.contacts.editDraft);
    nextActivity[index] = String(value || "");
    updateContactDetailDraftAndSchedule({ activity: nextActivity });
  }

  function addContactDetailActivityRow() {
    const nextActivity = contactDraftActivity(state.contacts.editDraft);
    const nextIndex = nextActivity.length;
    nextActivity.push("");
    updateContactDetailDraftAndSchedule({ activity: nextActivity }, { immediate: true, reason: "activity_add" });
    const focusNewRow = () => {
      const input = document.querySelector(`[data-contact-activity-index="${String(nextIndex)}"]`);
      if (input instanceof HTMLInputElement) {
        input.focus({ preventScroll: true });
      }
    };
    if (typeof window !== "undefined" && typeof window.requestAnimationFrame === "function") {
      window.requestAnimationFrame(focusNewRow);
      return;
    }
    focusNewRow();
  }

  function removeContactDetailActivityRow(index) {
    const nextActivity = contactDraftActivity(state.contacts.editDraft).filter((_, itemIndex) => itemIndex !== index);
    updateContactDetailDraftAndSchedule({ activity: nextActivity }, { immediate: true, reason: "activity_remove" });
  }

  function syncContactActivityRows(refs, draft) {
    const activity = contactDraftActivity(draft);
    if (refs.activityRows.childElementCount !== activity.length) {
      const fragment = document.createDocumentFragment();
      activity.forEach((value, index) => {
        const row = el("div", "light-contact-activity-row");
        const input = el("input", "light-project-input light-contact-edit-input");
        input.type = "text";
        input.placeholder = "Activity";
        input.dataset.contactActivityIndex = String(index);
        input.value = String(value || "");
        input.addEventListener("input", () => updateContactDetailActivityValue(index, input.value));
        input.addEventListener("blur", () => {
          void flushContactDetailAutosave({ reason: "activity_blur" });
        });
        const remove = el("button", "light-reminder-action-button", "Remove");
        remove.type = "button";
        remove.dataset.contactActivityRemove = String(index);
        remove.addEventListener("click", event => {
          event.preventDefault();
          removeContactDetailActivityRow(index);
        });
        row.append(input, remove);
        fragment.append(row);
      });
      refs.activityRows.replaceChildren(fragment);
    }
    Array.from(refs.activityRows.querySelectorAll("input[data-contact-activity-index]")).forEach((input, index) => {
      syncContactInputValue(input, activity[index] || "");
    });
  }

  function syncContactDetailEditor() {
    if (!contactDetailPageRefs) {
      return;
    }
    const contact = selectedContact();
    if (!contact) {
      return;
    }
    const draft = ensureContactEditDraft(contact);
    const preview = contactEditPreviewRecord(contact, draft);
    const refs = contactDetailPageRefs;
    const contactId = contactRecordId(contact);
    const avatarKey = JSON.stringify({
      photo: String(preview?.metadata?.photo || ""),
      initials: contactAvatarText(preview),
    });
    refs.page.dataset.contactId = contactId;
    if (refs.avatar.dataset.avatarKey !== avatarKey) {
      refs.avatar.dataset.avatarKey = avatarKey;
      refs.avatar.replaceChildren(lightAvatar(preview, "large"));
    }
    refs.title.textContent = contactDisplayTitle(preview);
    refs.detail.textContent = contactIsSelf(contact)
      ? "Edit your description, email, phone, and photo. Connected stays read-only."
      : "Edits autosave. Connected stays read-only.";
    refs.status.textContent = contactEditStatusLabel();
    refs.status.dataset.contactAutosaveStatus = state.contacts.editStatus || "idle";
    refs.nameGrid.hidden = contactIsSelf(contact);
    refs.activitySection.hidden = contactIsSelf(contact);
    syncContactInputValue(refs.firstNameInput, draft.firstName || "");
    syncContactInputValue(refs.lastNameInput, draft.lastName || "");
    syncContactInputValue(refs.summaryInput, draft.summary || "");
    syncContactInputValue(refs.emailInput, draft.email || "");
    syncContactInputValue(refs.phoneInput, draft.phone || "");
    syncContactActivityRows(refs, draft);
    refs.changePhoto.textContent = draft.photo ? "Change photo" : "Add photo";
    refs.removePhoto.hidden = !draft.photo;
    if (refs.connected.dataset.contactId !== contactId) {
      refs.connected.dataset.contactId = contactId;
      refs.connected.replaceChildren(lightLinkedRecordSection(contact, {
        title: "Connected",
        showWhenEmpty: true,
        showChips: false,
        showChevron: false,
        variant: "flat",
        fromRoute: "contact-detail"
      }));
    }
  }

  let contactsPageNode = null;
  let contactsPageRefs = null;
  let contactDetailPageNode = null;
  let contactDetailPageRefs = null;
  let contactDetailPageContactId = "";
  let contactDetailAutosaveTimer = 0;
  const contactEditFlushWaiters = [];

  function syncContactsSearchInput(refs) {
    if (document.activeElement !== refs.search && refs.search.value !== state.contacts.search) {
      refs.search.value = String(state.contacts.search || "");
    }
  }

  function syncContactsPage() {
    if (!contactsPageRefs) {
      return;
    }
    const refs = contactsPageRefs;
    const emptyMessage = "No contacts match your search.";
    const emptyHint = "Clear the search field to see every contact again.";
    const status = lightWorkspaceStatus("contacts", "contacts", "No contacts yet");
    refs.status.replaceChildren();
    refs.status.hidden = !status;
    refs.searchWrap.hidden = Boolean(status);
    if (status) {
      refs.status.append(status);
      refs.empty.hidden = true;
      refs.list.hidden = true;
      refs.list.replaceChildren();
      return;
    }
    syncContactsSearchInput(refs);
    const contacts = filteredContactsListItems();
    refs.empty.dataset.emptyMessage = emptyMessage;
    refs.empty.dataset.emptyHint = emptyHint;
    refs.empty.hidden = contacts.length > 0;
    refs.list.hidden = contacts.length === 0;
    if (!contacts.length) {
      refs.list.replaceChildren();
      return;
    }
    const fragment = document.createDocumentFragment();
    contacts.forEach(contact => {
      const row = el("button", "light-contact-row light-feed-row is-flat-feed");
      row.type = "button";
      row.dataset.contactId = contact.id;
      row.addEventListener("click", () => {
        state.selectedContactId = contact.id;
        lightNavigate("contact-detail", { from: "contacts" });
      });
      row.append(lightAvatar(contact), lightContactCopy(contact));
      fragment.append(row);
    });
    refs.list.replaceChildren(fragment);
  }

  function lightContactsSearchField() {
    const searchWrap = el("label", "light-contacts-search-wrap");
    searchWrap.setAttribute("for", "contactsSearch");
    const search = el("input", "light-contacts-search");
    search.id = "contactsSearch";
    search.type = "search";
    search.setAttribute("aria-label", "Search contacts");
    search.placeholder = "Search contacts";
    search.autocomplete = "off";
    search.spellcheck = false;
    search.value = String(state.contacts.search || "");
    const onSearchInput = () => {
      const nextValue = search.value;
      if (String(state.contacts.search || "") === nextValue) {
        return;
      }
      state.contacts.search = nextValue;
      resetLightRouteScroll();
      syncContactsPage();
    };
    search.addEventListener("input", onSearchInput);
    search.addEventListener("search", onSearchInput);
    searchWrap.append(search);
    return searchWrap;
  }

  function lightContactsPage() {
    if (!contactsPageNode) {
      const page = lightPage("Contacts", { onBack: () => lightNavigate("home") });
      page.classList.add("light-contacts-page");
      const status = el("div", "light-contacts-status");
      status.hidden = true;
      const searchWrap = lightContactsSearchField();
      const empty = lightEmptyState("search", "No contacts match your search.", "Clear the search field to see every contact again.");
      empty.hidden = true;
      const list = el("div", "light-contact-list");
      page.append(status, searchWrap, empty, list);
      const search = searchWrap.querySelector(".light-contacts-search");
      contactsPageRefs = {
        page,
        status,
        searchWrap,
        search,
        empty,
        list,
      };
      contactsPageNode = page;
    }
    syncContactsPage();
    return contactsPageNode;
  }

  function lightContactDetailPage() {
    const contact = selectedContact();
    if (!contact) {
      return lightPage("Contact", { subtitle: "Contact not found.", detail: true });
    }
    ensureLinkedCollections(contact);
    const contactId = contactRecordId(contact);
    if (!contactDetailPageNode || !contactDetailPageRefs || contactDetailPageContactId !== contactId) {
      const page = lightPage("Contact", {
        detail: true,
      });
      page.classList.add("light-contact-detail-page", "light-contact-edit-page");
      const form = el("form", "light-contact-edit-form");
      form.addEventListener("submit", event => event.preventDefault());

      const header = el("section", "light-contact-edit-photo-card");
      const avatar = el("div", "light-contact-detail-avatar");
      const photoCopy = el("div", "light-contact-edit-photo-copy");
      const title = el("h2", "light-contact-edit-photo-title", "");
      const detail = el("p", "light-contact-edit-photo-detail", "");
      const status = el("p", "light-contact-detail-status", "Saved");
      status.dataset.contactAutosaveStatus = "idle";
      photoCopy.append(title, detail, status);
      const photoActions = el("div", "light-contact-edit-photo-actions");
      const changePhoto = el("button", "light-reminder-action-button", "Add photo");
      changePhoto.type = "button";
      const removePhoto = el("button", "light-reminder-action-button", "Remove photo");
      removePhoto.type = "button";
      removePhoto.dataset.contactPhotoRemove = "true";
      const photoInput = el("input", "light-contact-edit-photo-input");
      photoInput.type = "file";
      photoInput.accept = "image/png,image/jpeg,image/webp";
      photoInput.hidden = true;
      photoInput.dataset.contactPhotoInput = "true";
      changePhoto.addEventListener("click", event => {
        event.preventDefault();
        photoInput.click();
      });
      removePhoto.addEventListener("click", event => {
        event.preventDefault();
        updateContactDetailDraftAndSchedule({
          photo: "",
          photoAssetId: "",
        }, { immediate: true, reason: "photo_remove" });
      });
      photoInput.addEventListener("change", async () => {
        const file = photoInput.files && photoInput.files[0] ? photoInput.files[0] : null;
        if (!file) {
          return;
        }
        try {
          updateContactDetailDraftAndSchedule(await prepareContactPhotoDraft(file), { immediate: true, reason: "photo_add" });
        } catch (error) {
          showToast(String(error?.message || "Could not update the selected photo."));
        } finally {
          photoInput.value = "";
        }
      });
      photoActions.append(changePhoto, removePhoto);
      header.append(avatar, photoCopy, photoActions, photoInput);

      const nameGrid = el("div", "light-contact-edit-name-grid");
      const firstNameInput = el("input", "light-project-input light-contact-edit-input");
      firstNameInput.type = "text";
      firstNameInput.placeholder = "First name";
      firstNameInput.autocomplete = "given-name";
      firstNameInput.dataset.contactEditField = "first_name";
      firstNameInput.addEventListener("input", () => updateContactDetailDraftAndSchedule({ firstName: firstNameInput.value }));
      firstNameInput.addEventListener("blur", () => {
        void flushContactDetailAutosave({ reason: "first_name_blur" });
      });
      const lastNameInput = el("input", "light-project-input light-contact-edit-input");
      lastNameInput.type = "text";
      lastNameInput.placeholder = "Last name";
      lastNameInput.autocomplete = "family-name";
      lastNameInput.dataset.contactEditField = "last_name";
      lastNameInput.addEventListener("input", () => updateContactDetailDraftAndSchedule({ lastName: lastNameInput.value }));
      lastNameInput.addEventListener("blur", () => {
        void flushContactDetailAutosave({ reason: "last_name_blur" });
      });
      nameGrid.append(
        lightContactEditField("First name", firstNameInput),
        lightContactEditField("Last name", lastNameInput),
      );

      const summaryInput = el("textarea", "light-project-input light-contact-edit-input light-contact-edit-textarea");
      summaryInput.placeholder = "Description";
      summaryInput.rows = 4;
      summaryInput.dataset.contactEditField = "summary";
      summaryInput.addEventListener("input", () => updateContactDetailDraftAndSchedule({ summary: summaryInput.value }));
      summaryInput.addEventListener("blur", () => {
        void flushContactDetailAutosave({ reason: "summary_blur" });
      });

      const emailInput = el("input", "light-project-input light-contact-edit-input");
      emailInput.type = "email";
      emailInput.placeholder = "Email";
      emailInput.autocomplete = "email";
      emailInput.dataset.contactEditField = "email";
      emailInput.addEventListener("input", () => updateContactDetailDraftAndSchedule({ email: emailInput.value }));
      emailInput.addEventListener("blur", () => {
        void flushContactDetailAutosave({ reason: "email_blur" });
      });

      const phoneInput = el("input", "light-project-input light-contact-edit-input");
      phoneInput.type = "tel";
      phoneInput.placeholder = "Phone";
      phoneInput.autocomplete = "tel";
      phoneInput.dataset.contactEditField = "phone";
      phoneInput.addEventListener("input", () => updateContactDetailDraftAndSchedule({ phone: phoneInput.value }));
      phoneInput.addEventListener("blur", () => {
        void flushContactDetailAutosave({ reason: "phone_blur" });
      });

      const activitySection = el("section", "light-contact-activity-section");
      activitySection.append(lightSectionTitle("Activity"));
      const activityRows = el("div", "light-contact-activity-rows");
      const activityActions = el("div", "light-contact-activity-actions");
      const addActivity = el("button", "light-reminder-action-button", "Add activity");
      addActivity.type = "button";
      addActivity.dataset.contactActivityAdd = "true";
      addActivity.addEventListener("click", event => {
        event.preventDefault();
        addContactDetailActivityRow();
      });
      activityActions.append(addActivity);
      activitySection.append(activityRows, activityActions);

      const connected = el("div", "light-contact-detail-connected");
      form.append(
        header,
        nameGrid,
        lightContactEditField("Description", summaryInput),
        lightContactEditField("Email", emailInput),
        lightContactEditField("Phone", phoneInput),
        activitySection,
      );
      page.append(form, connected);
      contactDetailPageRefs = {
        page,
        form,
        avatar,
        title,
        detail,
        status,
        changePhoto,
        removePhoto,
        photoInput,
        nameGrid,
        firstNameInput,
        lastNameInput,
        summaryInput,
        emailInput,
        phoneInput,
        activitySection,
        activityRows,
        connected,
      };
      contactDetailPageNode = page;
      contactDetailPageContactId = contactId;
    }
    ensureContactEditDraft(contact);
    syncContactDetailEditor();
    return contactDetailPageNode;
  }

  function lightContactEditField(label, control) {
    const field = el("label", "light-contact-edit-field");
    field.append(el("span", "light-contact-edit-label", label));
    field.append(control);
    return field;
  }

  function lightContactEditPage() {
    return lightContactDetailPage();
  }

  function lightCalendarPage() {
    const page = lightPage("Calendar", {
      action: lightIconButton("settings", "Calendar settings", openCalendarSettingsSheet, "light-calendar-settings-button"),
      headerChrome: lightDatePicker()
    });
    page.classList.add("light-calendar-page");
    page.append(lightCalendarAgendaHeading());
    const bucket = workspaceBucket("calendar-events");
    if (bucket.error) {
      page.append(lightEmptyState("calendar", "Could not load", bucket.error));
      return page;
    }
    if (!bucket.loaded) {
      page.append(lightEmptyState("calendar", "Loading", "Pulling calendar records from the VM."));
      return page;
    }
    const events = visibleCalendarEvents();
    ensureCalendarAgendaCollections(events);
    if (!events.length) {
      page.append(lightEmptyState("calendar", calendarEmptyStateTitle(), "Try Today or pick another date."));
      return page;
    }
    page.append(lightTimeline(events));
    return page;
  }

  function lightDatePicker() {
    const picker = el("section", "light-date-picker");
    const top = el("div", "light-calendar-strip-top");
    const controls = el("div", "light-date-picker-controls");
    const field = el("div", "light-date-input-wrap");
    const input = el("input", "light-date-input");
    input.type = "date";
    input.value = selectedCalendarDateKey();
    input.setAttribute("aria-label", "Calendar date");
    input.addEventListener("change", () => {
      state.selectedCalendarDate = normalizeCalendarDateKey(input.value) || calendarTodayDateKey();
      render();
    });
    field.append(input);
    controls.append(field);
    top.append(el("h2", "light-date-picker-title", calendarMonthHeading()), controls);
    const strip = el("div", "light-calendar-day-strip");
    strip.setAttribute("aria-label", "Calendar days");
    strip.addEventListener("scroll", () => queueCalendarDayRailContinuation(strip));
    buildCalendarDayRail(strip, selectedCalendarDateKey());
    picker.append(top, strip);
    return picker;
  }

  function buildCalendarDayRail(strip, dayKey) {
    if (!(strip instanceof HTMLElement)) {
      return;
    }
    const targetDayKey = normalizeCalendarDateKey(dayKey) || selectedCalendarDateKey();
    const monthKeys = calendarDayRailMonthKeys(targetDayKey);
    strip.replaceChildren();
    state.calendarDayRailStartMonth = "";
    state.calendarDayRailEndMonth = "";
    monthKeys.forEach(monthKey => appendCalendarDayRailMonth(strip, monthKey));
    queueCalendarDayStripCenter(strip, targetDayKey);
  }

  function appendCalendarDayRailMonth(strip, monthKey) {
    if (!(strip instanceof HTMLElement)) {
      return;
    }
    const normalized = normalizeCalendarMonthKey(monthKey);
    if (!normalized || normalized === state.calendarDayRailEndMonth) {
      return;
    }
    calendarMonthDayKeys(normalized).forEach(dayKey => strip.append(lightCalendarDayChip(dayKey)));
    if (!state.calendarDayRailStartMonth) {
      state.calendarDayRailStartMonth = normalized;
    }
    state.calendarDayRailEndMonth = normalized;
  }

  function prependCalendarDayRailMonth(strip, monthKey) {
    if (!(strip instanceof HTMLElement)) {
      return;
    }
    const normalized = normalizeCalendarMonthKey(monthKey);
    if (!normalized || normalized === state.calendarDayRailStartMonth) {
      return;
    }
    const previousWidth = strip.scrollWidth;
    const fragment = document.createDocumentFragment();
    calendarMonthDayKeys(normalized).forEach(dayKey => fragment.append(lightCalendarDayChip(dayKey)));
    strip.prepend(fragment);
    state.calendarDayRailStartMonth = normalized;
    if (!state.calendarDayRailEndMonth) {
      state.calendarDayRailEndMonth = normalized;
    }
    strip.scrollLeft += Math.max(0, strip.scrollWidth - previousWidth);
  }

  function queueCalendarDayRailContinuation(strip) {
    if (!(strip instanceof HTMLElement) || strip.dataset.railContinuationQueued === "1") {
      return;
    }
    strip.dataset.railContinuationQueued = "1";
    const flush = () => {
      strip.dataset.railContinuationQueued = "0";
      continueCalendarDayRail(strip);
    };
    if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame(flush);
      return;
    }
    flush();
  }

  function continueCalendarDayRail(strip) {
    if (!(strip instanceof HTMLElement)) {
      return;
    }
    const threshold = Math.max(96, Math.min(CALENDAR_DAY_RAIL_EDGE_THRESHOLD_PX, Math.round(strip.clientWidth * 0.2) || CALENDAR_DAY_RAIL_EDGE_THRESHOLD_PX));
    if (strip.scrollLeft <= threshold && state.calendarDayRailStartMonth) {
      prependCalendarDayRailMonth(strip, shiftCalendarMonthKey(state.calendarDayRailStartMonth, -1));
    }
    const remaining = Math.max(0, strip.scrollWidth - strip.clientWidth - strip.scrollLeft);
    if (remaining <= threshold && state.calendarDayRailEndMonth) {
      appendCalendarDayRailMonth(strip, shiftCalendarMonthKey(state.calendarDayRailEndMonth, 1));
    }
  }

  function queueCalendarDayStripCenter(strip, dayKey = selectedCalendarDateKey()) {
    if (typeof requestAnimationFrame !== "function") {
      centerCalendarDayStrip(strip, dayKey);
      return;
    }
    requestAnimationFrame(() => centerCalendarDayStrip(strip, dayKey));
  }

  function centerCalendarDayStrip(strip, dayKey = selectedCalendarDateKey()) {
    if (!(strip instanceof HTMLElement)) {
      return;
    }
    const chip = strip.querySelector(`.light-calendar-day-chip[data-day="${dayKey}"]`);
    if (!(chip instanceof HTMLElement)) {
      return;
    }
    const left = chip.offsetLeft - Math.max(0, (strip.clientWidth - chip.offsetWidth) / 2);
    strip.scrollTo({ left: Math.max(0, left), behavior: "auto" });
  }

  function lightCalendarAgendaHeading() {
    const section = el("section", "light-calendar-agenda-heading");
    section.append(el("h2", "light-calendar-agenda-title", calendarSelectedDayHeadline()));
    return section;
  }

  function openCalendarSettingsSheet() {
    const sheet = el("section", "settings-selector-sheet calendar-settings-panel");
    const header = el("div", "calendar-settings-panel-header");
    const copy = el("div", "calendar-settings-sheet-copy");
    copy.append(
      el("h2", "calendar-settings-sheet-title", "Calendar settings"),
      el("p", "calendar-settings-sheet-detail", "Choose whether Calendar follows your device time or stays pinned to one city.")
    );
    header.append(
      copy,
      (() => {
        const button = el("button", "calendar-settings-sheet-done", "Done");
        button.type = "button";
        button.addEventListener("click", closeCalendarSettingsSheet);
        return button;
      })()
    );
    const body = el("div", "calendar-settings-panel-body");
    body.append(calendarTimeZoneSettingsCard(), calendarEventTypeFiltersCard());
    sheet.append(header, body);
    const overlay = openOverlay("settingsSelectorOverlay", sheet, closeCalendarSettingsSheet);
    overlay?.classList.add("calendar-settings-overlay");
  }

  function closeCalendarSettingsSheet() {
    const overlay = closeOverlay("settingsSelectorOverlay");
    overlay?.classList.remove("calendar-settings-overlay");
  }

  function lightCalendarDayChip(dayKey) {
    const selected = dayKey === selectedCalendarDateKey();
    const isToday = dayKey === calendarTodayDateKey();
    const day = Number(String(dayKey || "").split("-")[2] || 0);
    const chip = el(
      "button",
      [
        "light-calendar-day-chip",
        selected ? "is-selected" : "",
        isToday ? "is-today" : ""
      ].filter(Boolean).join(" ")
    );
    chip.type = "button";
    chip.setAttribute("aria-pressed", selected ? "true" : "false");
    chip.dataset.day = dayKey;
    chip.dataset.month = calendarMonthKey(dayKey);
    chip.addEventListener("click", () => {
      state.selectedCalendarDate = dayKey;
      render();
    });
    const dots = el("span", "light-calendar-day-dots");
    calendarDayMarkers(dayKey).forEach(tone => dots.append(el("span", `light-calendar-day-dot ${tone}`, "")));
    chip.append(
      el("span", "light-calendar-day-weekday", calendarDayWeekdayLabel(dayKey)),
      el("span", "light-calendar-day-number", String(day || "")),
      dots
    );
    return chip;
  }

  function lightTimeline(events) {
    const timeline = el("div", "light-timeline");
    const agendaEvents = Array.isArray(events) ? events : visibleCalendarEvents();
    calendarAgendaBlocks(agendaEvents).forEach(block => timeline.append(block));
    return timeline;
  }

  function calendarAgendaBlocks(events) {
    const clusters = [];
    events.forEach(event => {
      const start = calendarEventStartMs(event);
      const end = calendarEventEndMs(event);
      const last = clusters[clusters.length - 1];
      if (last && start <= last.end + CALENDAR_CLUSTER_WINDOW_MS) {
        last.events.push(event);
        last.end = Math.max(last.end, end);
        return;
      }
      clusters.push({ start, end, events: [event] });
    });
    return clusters.flatMap((cluster, index) => {
      const blocks = [];
      if (index > 0) {
        const gap = cluster.start - clusters[index - 1].end;
        if (gap >= CALENDAR_GAP_THRESHOLD_MS) {
          blocks.push(lightCalendarGap(cluster.start, gap));
        }
      }
      blocks.push(lightCalendarCluster(cluster, index));
      return blocks;
    });
  }

  function lightCalendarGap(untilMs, gapMs) {
    const gap = el("section", "light-calendar-gap");
    gap.append(
      el("span", "light-calendar-gap-line"),
      el("span", "light-calendar-gap-label", `Free ${calendarFormatTime(untilMs - gapMs)} - ${calendarFormatTime(untilMs)}`),
      el("span", "light-calendar-gap-line")
    );
    return gap;
  }

  function lightCalendarCluster(cluster, clusterIndex = 0) {
    const section = el("section", "light-calendar-cluster");
    cluster.events.forEach((event, eventIndex) => section.append(lightCalendarEventBlock(event, clusterIndex + eventIndex)));
    return section;
  }

  function lightCalendarEventBlock(event, index = 0) {
    const block = el("article", `light-event-block ${calendarEventColor(event, index)}`);
    block.dataset.eventId = event.id;
    block.setAttribute("role", "button");
    block.tabIndex = 0;
    block.setAttribute("aria-label", event.title || "Open event");
    const openEvent = () => {
      state.selectedMeetingId = event.id;
      state.meetingDetailSections = resetMeetingDetailSections(event.id);
      state.meetingDetailSectionCache = {
        ...state.meetingDetailSectionCache,
        [String(event.id || "").trim()]: state.meetingDetailSections,
      };
      lightNavigate("meeting-detail", { from: "calendar" });
    };
    block.addEventListener("click", event => {
      if (event.target instanceof Element && event.target.closest(".light-attendee-chip")) {
        return;
      }
      openEvent();
    });
    block.addEventListener("keydown", event => {
      if (event.target !== block) {
        return;
      }
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        openEvent();
      }
    });
    const main = el("button", "light-event-main");
    main.type = "button";
    main.addEventListener("click", event => {
      event.stopPropagation();
      openEvent();
    });
    main.append(
      el("span", "light-event-time", calendarEventTimeRange(event)),
      el("strong", "light-event-title", event.title || "Untitled event"),
    );
    block.append(main);
    const chips = lightCalendarEventChips(event, { fromRoute: "calendar", contactsOnly: true });
    if (chips) {
      block.append(chips);
    }
    return block;
  }

  function visibleCalendarEvents() {
    const selected = selectedCalendarDateKey();
    return workspaceItems("calendar-events")
      .filter(event => calendarEventDateKey(event) === selected)
      .filter(event => calendarToneEnabled(calendarEventTone(event)))
      .slice()
      .sort((left, right) => {
        const byStart = calendarEventStartMs(left) - calendarEventStartMs(right);
        if (byStart !== 0) return byStart;
        const byEnd = calendarEventEndMs(left) - calendarEventEndMs(right);
        if (byEnd !== 0) return byEnd;
        return String(left?.title || "").localeCompare(String(right?.title || ""));
      });
  }

  function resetMeetingDetailSections(meetingId = state.selectedMeetingId) {
    const normalizedMeetingId = String(meetingId || "").trim();
    return {
      meetingId: normalizedMeetingId,
      details: true,
      connected: false,
    };
  }

  function ensureMeetingDetailSections(meetingId = state.selectedMeetingId) {
    const normalizedMeetingId = String(meetingId || "").trim();
    const current = state.meetingDetailSections;
    if (current && current.meetingId === normalizedMeetingId) {
      return current;
    }
    const cached = state.meetingDetailSectionCache?.[normalizedMeetingId];
    if (cached && cached.meetingId === normalizedMeetingId) {
      state.meetingDetailSections = {
        ...cached
      };
      return state.meetingDetailSections;
    }
    if (!current || current.meetingId !== normalizedMeetingId) {
      state.meetingDetailSections = resetMeetingDetailSections(normalizedMeetingId);
    }
    state.meetingDetailSectionCache = {
      ...state.meetingDetailSectionCache,
      [normalizedMeetingId]: state.meetingDetailSections,
    };
    return state.meetingDetailSections;
  }

  function meetingDetailSectionExpanded(sectionKey, meetingId = state.selectedMeetingId) {
    const normalizedKey = String(sectionKey || "").trim().toLowerCase();
    const sections = ensureMeetingDetailSections(meetingId);
    return Boolean(sections?.[normalizedKey]);
  }

  function setMeetingDetailSectionExpanded(sectionKey, expanded, meetingId = state.selectedMeetingId) {
    const normalizedKey = String(sectionKey || "").trim().toLowerCase();
    if (!normalizedKey) {
      return state.meetingDetailSections;
    }
    const sections = ensureMeetingDetailSections(meetingId);
    state.meetingDetailSections = {
      ...sections,
      meetingId: String(meetingId || sections?.meetingId || "").trim(),
      [normalizedKey]: Boolean(expanded),
    };
    state.meetingDetailSectionCache = {
      ...state.meetingDetailSectionCache,
      [state.meetingDetailSections.meetingId]: state.meetingDetailSections,
    };
    return state.meetingDetailSections;
  }

  function toggleMeetingDetailSection(sectionKey) {
    const meetingId = String(state.selectedMeetingId || "").trim();
    if (!meetingId) {
      return;
    }
    setMeetingDetailSectionExpanded(
      sectionKey,
      !meetingDetailSectionExpanded(sectionKey, meetingId),
      meetingId
    );
    render();
  }

  function lightMeetingDetailPage() {
    const meeting = selectedMeeting();
    if (!meeting) {
      return lightPage("Event", { subtitle: "Event not found.", detail: true });
    }
    ensureLinkedCollections(meeting);
    const meta = meeting.metadata || {};
    const attendees = calendarEventPeople(meeting);
    const docs = Array.isArray(meta.docs) ? meta.docs : [];
    const contactBucket = workspaceBucket("contacts");
    if (calendarEventNeedsContacts(meeting) && !contactBucket.loaded && !contactBucket.loading) {
      void loadWorkspaceCollection("contacts", { render: true });
    }
    ensureMeetingDetailSections(meeting.id);
    const page = lightPage(meeting.title || "Event", { detail: true });
    page.classList.add("light-document-page", "light-event-document", "light-event-detail-page");
    page.append(lightCalendarEventDetailsSection(meeting, attendees));
    page.append(lightMeetingDetailConnectedSection(meeting));
    if (Array.isArray(meta.agenda) && meta.agenda.length) {
      page.append(lightListSection("Agenda", meta.agenda));
    }
    if (docs.length) {
      page.append(lightInfoSection("Related docs", docs.map(doc => ({ icon: "note", label: doc, value: "Open" }))));
    }
    return page;
  }

  function lightCalendarEventDetailsSection(event, attendees = calendarEventPeople(event)) {
    void attendees;
    const card = el("div", "light-calendar-detail-card light-calendar-event-detail-card");
    card.append(
      lightCalendarDetailRow("when", "When", calendarEventCompactWhenLabel(event), { compact: true })
    );
    const recognized = calendarEventChipTargets(event, { contactsOnly: true });
    if (recognized.length) {
      const cloud = el("div", "light-chip-cloud light-attendee-chip-cloud");
      recognized.forEach(entry => cloud.append(lightCalendarContactChip(entry, { fromRoute: "meeting-detail" })));
      card.append(lightCalendarDetailRow("who", "Who", cloud, {
        compact: true,
        valueClassName: "light-calendar-detail-people",
      }));
    }
    const place = String(event?.metadata?.place || "").trim();
    const address = String(event?.metadata?.address || "").trim();
    const locationValue = lightCalendarLocationValue(place, address);
    if (place || address) {
      card.append(lightCalendarDetailRow("place", "Location", locationValue, {
        compact: true,
        valueClassName: "light-calendar-detail-location-value",
      }));
    }
    const eventTimeZone = String(event?.metadata?.time_zone || "").trim();
    if (eventTimeZone && eventTimeZone !== calendarEffectiveTimeZone()) {
      card.append(lightCalendarDetailRow("time-zone", "Time zone", eventTimeZone, { compact: true }));
    }
    const description = String(event?.summary || "").trim();
    if (description) {
      card.append(lightCalendarDetailDescription(description));
    }
    return lightMeetingDetailSection("Details", "details", card, {
      expanded: meetingDetailSectionExpanded("details", event?.id),
      sectionClassName: "light-calendar-detail-section"
    });
  }

  function lightCalendarDetailRow(rowKey, label, value, options = {}) {
    const row = el("div", "light-calendar-detail-row");
    if (options.compact) {
      row.classList.add("is-compact");
    }
    const valueClassName = ["light-calendar-detail-row-value", String(options.valueClassName || "").trim()].filter(Boolean).join(" ");
    const valueNode = el("div", valueClassName);
    if (value instanceof Node) {
      valueNode.append(value);
    } else {
      valueNode.textContent = String(value ?? "").trim();
    }
    row.dataset.detailRow = String(rowKey || label || "").trim().toLowerCase();
    row.append(
      el("strong", "light-calendar-detail-row-label", label),
      valueNode
    );
    return row;
  }

  function lightCalendarLocationValue(place, address) {
    const primary = String(place || "").trim();
    const secondary = String(address || "").trim();
    const block = el("div", "light-calendar-detail-location");
    if (primary) {
      block.append(el("span", "light-calendar-detail-location-primary", primary));
    }
    if (secondary) {
      block.append(el("span", "light-calendar-detail-location-address", secondary));
    }
    return block;
  }

  function lightCalendarDetailDescription(description) {
    const block = el("div", "light-calendar-detail-description");
    block.dataset.detailRow = "description";
    const paragraph = el("p", "light-calendar-detail-description-copy");
    appendCalendarDescriptionNodes(paragraph, description);
    block.append(paragraph);
    return block;
  }

  function normalizeCalendarDescriptionUrl(url) {
    let href = String(url || "").trim();
    let trailingText = "";
    while (href && /[.,!?;:]$/.test(href)) {
      trailingText = `${href.slice(-1)}${trailingText}`;
      href = href.slice(0, -1);
    }
    if (!href) {
      return { href: "", trailingText };
    }
    try {
      const parsed = new URL(href, window.location && window.location.href ? window.location.href : undefined);
      if (!/^https?:$/i.test(String(parsed.protocol || ""))) {
        return { href: "", trailingText: String(url || "") };
      }
      return { href: parsed.toString(), trailingText };
    } catch (_) {
      return { href: "", trailingText: String(url || "") };
    }
  }

  async function openExternalBrowserUrl(url) {
    const href = String(url || "").trim();
    if (!href) {
      return false;
    }
    try {
      const parsed = new URL(href, window.location && window.location.href ? window.location.href : undefined);
      if (!/^https?:$/i.test(String(parsed.protocol || ""))) {
        return false;
      }
    } catch (_) {
      return false;
    }
    try {
      if (
        window.PuckyAndroid
        && typeof window.PuckyAndroid.postMessage === "function"
        && typeof Pucky !== "undefined"
        && Pucky
        && typeof Pucky.request === "function"
      ) {
        const result = await Pucky.request({ command: "browser.open", args: { url: href } });
        if (result && result.launched) {
          return true;
        }
      }
    } catch (_) {
      // Fall back to the browser APIs below when the bridge is unavailable.
    }
    try {
      if (typeof window.open === "function") {
        const popup = window.open(href, "_blank", "noopener,noreferrer");
        if (popup) {
          return true;
        }
      }
    } catch (_) {
      // Leave the Pucky shell in place when popup creation is unavailable.
    }
    return false;
  }

  function lightCalendarDescriptionLink(url) {
    const href = String(url || "").trim();
    const link = document.createElement("a");
    link.className = "light-calendar-detail-description-link";
    link.href = href;
    link.rel = "noopener noreferrer";
    link.target = "_blank";
    link.textContent = href;
    link.addEventListener("click", event => {
      if (
        window.PuckyAndroid
        && typeof window.PuckyAndroid.postMessage === "function"
        && typeof Pucky !== "undefined"
        && Pucky
        && typeof Pucky.request === "function"
      ) {
        event.preventDefault();
        void openExternalBrowserUrl(href);
      }
    });
    return link;
  }

  function appendCalendarDescriptionNodes(container, description) {
    const text = String(description || "").trim();
    container.replaceChildren();
    if (!text) {
      return;
    }
    CALENDAR_DESCRIPTION_URL_PATTERN.lastIndex = 0;
    let cursor = 0;
    let linked = false;
    for (const match of text.matchAll(CALENDAR_DESCRIPTION_URL_PATTERN)) {
      const rawMatch = String(match[0] || "");
      const start = Number(match.index || 0);
      if (start > cursor) {
        container.append(document.createTextNode(text.slice(cursor, start)));
      }
      const { href, trailingText } = normalizeCalendarDescriptionUrl(rawMatch);
      if (href) {
        container.append(lightCalendarDescriptionLink(href));
        linked = true;
      } else {
        container.append(document.createTextNode(rawMatch));
      }
      if (trailingText) {
        container.append(document.createTextNode(trailingText));
      }
      cursor = start + rawMatch.length;
    }
    if (!linked) {
      container.textContent = text;
      return;
    }
    if (cursor < text.length) {
      container.append(document.createTextNode(text.slice(cursor)));
    }
  }

  function lightMeetingDetailConnectedSection(meeting) {
    const entries = workspaceLinkedEntries(meeting, {
      excludeKinds: ["contact"],
    });
    const list = el("div", "light-linked-record-list light-feed-section-body light-feed-list light-card is-flat-feed");
    list.dataset.linkedRecordsCount = String(entries.length);
    if (!entries.length) {
      list.append(el("div", "light-linked-records-empty-shell is-flat-feed"));
    } else {
      entries.forEach(entry => list.append(lightLinkedRecordFeedRow(entry, {
        fromRoute: "meeting-detail",
        showChips: false,
        showChevron: false,
        variant: "flat",
      })));
    }
    return lightMeetingDetailSection("Connected", "connected", list, {
      expanded: meetingDetailSectionExpanded("connected", meeting?.id),
      count: entries.length,
      sectionClassName: "light-linked-records-section is-flat-feed",
      linkedRecordsTitle: "connected",
    });
  }

  function lightMeetingDetailSection(title, sectionKey, bodyContent, options = {}) {
    const normalizedTitle = String(title || "").trim();
    const normalizedKey = String(sectionKey || normalizedTitle).trim().toLowerCase();
    const expanded = options.expanded !== false;
    const sectionClassName = `light-feed-section light-meeting-detail-section ${String(options.sectionClassName || "").trim()}`.trim();
    const section = el("section", sectionClassName);
    section.dataset.meetingDetailSection = normalizedKey;
    if (options.linkedRecordsTitle) {
      section.dataset.linkedRecordsTitle = String(options.linkedRecordsTitle || "").trim().toLowerCase();
    }
    const controlsId = `light-meeting-detail-section-${normalizedKey}`;
    section.append(lightMeetingDetailSectionHeader(normalizedTitle, normalizedKey, options.count, expanded, controlsId));
    const body = el("div", "light-meeting-detail-section-body");
    body.id = controlsId;
    body.hidden = !expanded;
    if (bodyContent instanceof Node) {
      body.append(bodyContent);
    }
    section.append(body);
    return section;
  }

  function lightMeetingDetailSectionHeader(title, sectionKey, count, expanded, controlsId) {
    const button = el("button", expanded ? "light-feed-section-header light-meeting-detail-section-header is-expanded" : "light-feed-section-header light-meeting-detail-section-header");
    button.type = "button";
    button.dataset.meetingDetailSection = String(sectionKey || "").trim().toLowerCase();
    button.setAttribute("aria-expanded", String(expanded));
    button.setAttribute("aria-controls", controlsId);
    button.setAttribute("aria-label", `${expanded ? "Collapse" : "Expand"} ${String(title || sectionKey || "section").trim().toLowerCase()}`);
    button.addEventListener("click", event => {
      event.preventDefault();
      event.stopPropagation();
      toggleMeetingDetailSection(sectionKey);
    });
    const copy = el("span", "light-meeting-detail-section-copy");
    copy.append(el("span", "light-section-title light-meeting-detail-section-title", String(title || "").trim().toUpperCase()));
    if (Number.isFinite(Number(count))) {
      copy.append(el("span", "light-meeting-detail-section-count", String(Number(count))));
    }
    const chevron = el("span", "light-meeting-detail-section-chevron");
    chevron.innerHTML = iconSvg(expanded ? "expand_more" : "chevron_right");
    button.append(copy, chevron);
    return button;
  }

  function lightGuestAttendeeChip(label) {
    return el("span", "light-attendee-chip light-attendee-chip-guest", String(label || "").trim());
  }

  function normalizeUniversalFeedTileDescriptor(descriptor = {}) {
    return {
      id: String(descriptor.id || "").trim(),
      surface: String(descriptor.surface || "").trim().toLowerCase(),
      variant: String(descriptor.variant || "").trim().toLowerCase(),
      sectionKey: String(descriptor.sectionKey || "").trim().toLowerCase(),
      title: String(descriptor.title || "").trim(),
      meta: descriptor.meta && typeof descriptor.meta === "object" ? descriptor.meta : descriptor.meta ?? null,
      summary: String(descriptor.summary || "").trim(),
      chips: Array.isArray(descriptor.chips) ? descriptor.chips.slice() : [],
      leading: descriptor.leading && typeof descriptor.leading === "object" ? descriptor.leading : null,
      trailing: descriptor.trailing && typeof descriptor.trailing === "object" ? descriptor.trailing : null,
      interactive: descriptor.interactive !== false,
      open: typeof descriptor.open === "function" ? descriptor.open : null,
      renderMode: String(descriptor.renderMode || "light").trim().toLowerCase() || "light",
    };
  }

  function isUniversalFlatFeedSurface(surface) {
    const surfaceKey = String(surface || "").trim().toLowerCase();
    return UNIVERSAL_FLAT_FEED_SURFACES.has(surfaceKey);
  }

  function normalizeUniversalFeedSectionDescriptor(descriptor = {}) {
    const items = Array.isArray(descriptor.items) ? descriptor.items.map(normalizeUniversalFeedTileDescriptor) : [];
    const count = Number.isFinite(Number(descriptor.count)) ? Number(descriptor.count) : items.length;
    return {
      key: String(descriptor.key || "").trim().toLowerCase(),
      label: String(descriptor.label || "").trim(),
      count,
      collapsible: Boolean(descriptor.collapsible),
      expanded: descriptor.expanded !== false,
      emptyState: descriptor.emptyState || null,
      items,
    };
  }

  function universalFeedSectionClassName(surface) {
    if (surface === "notes") {
      return "light-notes-section";
    }
    if (surface === "reminders") {
      return "light-reminder-list-section";
    }
    return "";
  }

  function universalFeedListClassName(surface) {
    if (surface === "notes") {
      return "light-notes-section-body";
    }
    if (surface === "meeting-notes") {
      return "light-list light-graph-list";
    }
    if (surface === "reminders") {
      return "light-list light-graph-list";
    }
    if (surface === "projects") {
      return "light-list";
    }
    if (surface === "meetings") {
      return "meetings-list-card";
    }
    return "";
  }

  function renderUniversalFeedPage(options = {}) {
    const page = typeof options.createPage === "function"
      ? options.createPage()
      : lightPage(options.title || "Workspace", options.pageOptions || {});
    const surfaceKey = String(options.surface || "").trim().toLowerCase();
    const isFlatFeed = isUniversalFlatFeedSurface(surfaceKey);
    const pageClassName = String(options.pageClassName || "").trim();
    page.classList.add("light-feed-page");
    if (pageClassName) {
      page.classList.add(...pageClassName.split(/\s+/).filter(Boolean));
    }
    page.dataset.feedSurface = surfaceKey;
    if (isFlatFeed) {
      page.classList.add("is-flat-feed");
    }
    const surfaceTag = String(options.surfaceTag || "div").trim().toLowerCase() || "div";
    const surfaceClassName = `light-feed-surface ${String(options.surfaceClassName || "").trim()}`.trim();
    const surface = el(surfaceTag, surfaceClassName);
    surface.dataset.feedSurface = surfaceKey;
    if (isFlatFeed) {
      surface.classList.add("is-flat-feed");
    }
    const contentClassName = String(options.contentClassName || "").trim();
    const content = contentClassName ? el("div", contentClassName) : surface;
    if (content !== surface && isFlatFeed) {
      content.classList.add("is-flat-feed");
    }
    if (content !== surface) {
      surface.append(content);
    }
    if (options.status instanceof Node) {
      content.append(options.status);
      page.append(surface);
      return page;
    }
    const beforeSections = Array.isArray(options.beforeSections)
      ? options.beforeSections.filter(node => node instanceof Node)
      : [];
    const afterSections = Array.isArray(options.afterSections)
      ? options.afterSections.filter(node => node instanceof Node)
      : [];
    const sections = Array.isArray(options.sections) ? options.sections.map(normalizeUniversalFeedSectionDescriptor) : [];
    beforeSections.forEach(node => content.append(node));
    sections.forEach(section => content.append(renderUniversalFeedSection(section, { surface: options.surface })));
    if (!sections.length && options.emptyState instanceof Node) {
      content.append(options.emptyState);
    }
    afterSections.forEach(node => content.append(node));
    page.append(surface);
    return page;
  }

  function renderUniversalFeedSection(sectionDescriptor, options = {}) {
    const descriptor = {
      ...normalizeUniversalFeedSectionDescriptor(sectionDescriptor),
      surface: String(options.surface || "").trim().toLowerCase(),
    };
    const sectionClassName = universalFeedSectionClassName(descriptor.surface);
    const section = el("section", `${sectionClassName} light-feed-section`.trim());
    if (isUniversalFlatFeedSurface(descriptor.surface)) {
      section.classList.add("is-flat-feed");
    }
    if (descriptor.key) {
      section.dataset.feedSection = descriptor.key;
    }
    if (descriptor.surface === "notes" && descriptor.key) {
      section.dataset.notesSection = descriptor.key;
    }
    const bodyId = descriptor.key ? `light-${descriptor.surface || "feed"}-section-${descriptor.key}` : "";
    if (descriptor.collapsible && descriptor.surface === "notes") {
      section.append(lightNotesSectionHeader(descriptor.label, descriptor.key, descriptor.count, descriptor.expanded, bodyId));
    } else if (descriptor.label) {
      const header = el("div", "light-feed-section-header");
      header.append(lightSectionTitle(descriptor.label));
      section.append(header);
    }
    const listClassName = universalFeedListClassName(descriptor.surface);
    const body = el("div", `${listClassName} light-feed-section-body light-feed-list`.trim());
    if (isUniversalFlatFeedSurface(descriptor.surface)) {
      body.classList.add("is-flat-feed");
    }
    if (bodyId) {
      body.id = bodyId;
    }
    body.hidden = descriptor.collapsible && !descriptor.expanded;
    if (descriptor.emptyState && descriptor.items.length === 0) {
      body.append(descriptor.emptyState);
    } else if (!descriptor.collapsible || descriptor.expanded) {
      body.append(...descriptor.items.map(item => renderUniversalFeedTile(item)));
    }
    section.append(body);
    return section;
  }

  function renderUniversalFeedTile(tileDescriptor) {
    const descriptor = normalizeUniversalFeedTileDescriptor(tileDescriptor);
    if (descriptor.variant === "notes") {
      return lightNoteRow(descriptor.meta?.note || null);
    }
    if (descriptor.variant === "graph") {
      const record = descriptor.meta?.record || null;
      return lightGraphRow(record, {
        rowClassName: descriptor.meta?.rowClassName || "",
        showLeadingIcon: descriptor.leading?.show !== false,
        showTrailingChevron: descriptor.trailing?.show !== false,
        showChips: descriptor.meta?.showChips !== false,
        flatFeed: descriptor.renderMode === "flat",
        icon: descriptor.leading?.icon || graphKindIcon(record?.kind),
        detailRoute: descriptor.meta?.detailRoute || "",
        selectedKey: descriptor.meta?.selectedKey || "",
        collection: descriptor.meta?.collection || ""
      });
    }
    if (descriptor.variant === "reminder") {
      // Legacy call shape retained for source-contract coverage:
      // return lightReminderRow(descriptor.meta?.reminder || null);
      return lightReminderRow(descriptor.meta?.reminder || null, {
        flatFeed: descriptor.renderMode === "flat",
      });
    }
    if (descriptor.variant === "project") {
      return lightProjectRow(descriptor.meta?.project || null, {
        flatFeed: descriptor.renderMode === "flat",
      });
    }
    if (descriptor.variant === "canonical_reply") {
      const card = descriptor.meta?.card;
      return cardView(card, { surface: descriptor.surface, flatFeed: descriptor.renderMode === "flat" });
    }
    if (descriptor.variant === "canonical_meeting") {
      const meeting = descriptor.meta?.meeting;
      return cardView(meetingCardFromRecord(meeting), { surface: descriptor.surface, flatFeed: descriptor.renderMode === "flat" });
    }
    return el("div", "light-feed-row");
  }

  function universalNoteFeedTileDescriptor(note, sectionKey = "") {
    const noteId = noteRecordId(note);
    const meta = noteMetaLine(note);
    return normalizeUniversalFeedTileDescriptor({
      id: noteId,
      surface: "notes",
      variant: "notes",
      sectionKey,
      title: note.title || "Untitled note",
      meta: { note, source: meta.source, timestamp: meta.timestamp },
      summary: String(note?.summary || "").trim(),
      chips: [],
      leading: null,
      trailing: { kind: "pin", pending: notePinPending(noteId), pinned: Boolean(note?.pinned) },
      interactive: true,
      open: () => {
        state.selectedNoteId = noteId;
        lightNavigate("note-detail", { from: "notes" });
      },
      renderMode: "flat",
    });
  }

  function universalGraphFeedTileDescriptor(record, options = {}) {
    return normalizeUniversalFeedTileDescriptor({
      id: String(record?.id || record?.record_id || "").trim(),
      surface: String(options.surface || options.collection || "workspace").trim().toLowerCase(),
      variant: "graph",
      sectionKey: String(options.sectionKey || options.collection || "").trim().toLowerCase(),
      title: record?.title || "Untitled record",
      meta: {
        record,
        rowClassName: String(options.rowClassName || "").trim(),
        detailRoute: String(options.detailRoute || "").trim(),
        selectedKey: String(options.selectedKey || "").trim(),
        collection: String(options.collection || "").trim(),
        showChips: options.showChips !== false,
      },
      summary: graphListLabel(record),
      chips: graphObjectChipValues(record),
      leading: { icon: options.icon || graphKindIcon(record?.kind), show: options.showLeadingIcon !== false },
      trailing: { show: options.showTrailingChevron !== false },
      interactive: true,
      open: () => {
        state[options.selectedKey] = record.id;
        lightNavigate(options.detailRoute, { from: options.collection });
      },
      renderMode: "flat",
    });
  }

  function universalReminderFeedTileDescriptor(reminder, sectionKey = "") {
    return normalizeUniversalFeedTileDescriptor({
      id: String(reminder?.id || "").trim(),
      surface: "reminders",
      variant: "reminder",
      sectionKey: String(sectionKey || "").trim().toLowerCase(),
      title: reminder?.title || "Untitled reminder",
      meta: { reminder },
      summary: String(reminder?.summary || "").trim(),
      chips: [],
      leading: { icon: "bell", show: true },
      trailing: { show: true, label: reminderRowLabel(reminder) },
      interactive: true,
      open: () => {
        state.selectedReminderId = reminder.id;
        lightNavigate("reminder-detail", { from: "reminders" });
      },
      renderMode: "flat",
    });
  }

  function universalProjectFeedTileDescriptor(project, sectionKey = "") {
    return normalizeUniversalFeedTileDescriptor({
      id: String(project?.id || "").trim(),
      surface: "projects",
      variant: "project",
      sectionKey: String(sectionKey || "").trim().toLowerCase(),
      title: project?.title || "Untitled project",
      meta: { project },
      summary: `${workspaceTimestamp(project?.updated_at_ms, "Updated")}${DOT}${project?.summary || "Project"}`,
      chips: [],
      leading: { icon: "folder", show: true },
      trailing: null,
      interactive: true,
      open: () => {
        state.selectedProjectId = project.id;
        lightNavigate("project-detail", { from: "projects" });
      },
      renderMode: "flat",
    });
  }

  function universalCanonicalReplyFeedTileDescriptor(card, sectionKey = "inbox") {
    return normalizeUniversalFeedTileDescriptor({
      id: String(card?.card_id || card?.session_id || "").trim(),
      surface: "inbox",
      variant: "canonical_reply",
      sectionKey,
      title: card?.title || "Pucky",
      meta: { card },
      summary: String(card?.summary || "").trim(),
      chips: [],
      leading: null,
      trailing: null,
      interactive: true,
      open: () => showTranscript(card),
      renderMode: "flat",
    });
  }

  function universalCanonicalMeetingFeedTileDescriptor(meeting, sectionKey = "meetings") {
    return normalizeUniversalFeedTileDescriptor({
      id: String(meeting?.meeting_id || meeting?.id || "").trim(),
      surface: "meetings",
      variant: "canonical_meeting",
      sectionKey,
      title: meeting?.title || "Meeting",
      meta: { meeting },
      summary: String(meeting?.summary || "").trim(),
      chips: [],
      leading: null,
      trailing: null,
      interactive: true,
      open: () => {
        void showMeetingDetail(meeting);
      },
      renderMode: "flat",
    });
  }

  function lightMeetingNotesPage() {
    return lightGraphListPage({
      title: "Meeting Notes",
      surface: "meeting-notes",
      collection: "meeting-notes",
      icon: "record_voice_over",
      detailRoute: "meeting-note-detail",
      selectedKey: "selectedMeetingNoteId",
      emptyTitle: "No meeting notes yet",
      rowClassName: "light-graph-row-meeting-notes",
      showLeadingIcon: false,
      showTrailingChevron: false,
      showChips: false,
    });
  }

  function lightMeetingNoteDetailPage() {
    const meeting = selectedMeetingNote();
    if (!meeting) {
      return lightPage("Meeting Note", { subtitle: "Meeting note not found.", detail: true });
    }
    ensureMeetingNoteSupportingCollections(meeting);
    const page = lightPage(meeting.title || "Meeting Note", { detail: true });
    page.classList.add("light-document-page", "light-meeting-note-detail-page");
    const summary = String(meeting.summary || "").trim();
    if (summary) {
      page.append(el("p", "light-event-summary-copy light-meeting-note-summary", summary));
    }
    page.append(lightMeetingNoteDetailsSection(meeting));
    page.append(lightLinkedRecordSection(meeting, {
      title: "Connected",
      excludeKinds: ["contact"],
      showWhenEmpty: true,
      fromRoute: "meeting-note-detail",
      dedupeTargets: true,
      showChips: false,
      showChevron: false,
      variant: "flat",
      detailResolver: meetingNoteConnectedDetail,
    }));
    return page;
  }

  function ensureMeetingNoteSupportingCollections(meeting) {
    ensureLinkedCollections(meeting);
    const meta = meeting?.metadata || {};
    const participants = Array.isArray(meta.participants)
      ? meta.participants.map(value => String(value || "").trim()).filter(Boolean)
      : [];
    const contactBucket = workspaceBucket("contacts");
    if (participants.length && contactBucket && !contactBucket.loaded && !contactBucket.loading) {
      void loadWorkspaceCollection("contacts", { render: true });
    }
    const sourceKind = String(meta.source_kind || "calendar_event").trim();
    const sourceId = String(meta.source_id || meta.source || "").trim();
    const sourceCollection = workspaceCollectionForKind(sourceKind);
    const sourceBucket = sourceCollection ? workspaceBucket(sourceCollection) : null;
    if (sourceId && sourceCollection && sourceBucket && !sourceBucket.loaded && !sourceBucket.loading) {
      void loadWorkspaceCollection(sourceCollection, { render: true });
    }
  }

  function lightMeetingNoteDetailsSection(meeting) {
    const section = el("section", "light-calendar-detail-section light-meeting-note-details-section");
    section.append(lightSectionTitle("Details"));
    const card = el("div", "light-calendar-detail-card");
    card.append(lightMeetingNoteDetailRow("when", "When", meetingTimeLabel(meeting)));
    const who = lightMeetingNoteWhoRow(meeting);
    if (who) {
      card.append(who);
    }
    section.append(card);
    return section;
  }

  function lightMeetingNoteDetailRow(rowKey, label, value, options = {}) {
    const target = options?.target || null;
    const isInteractive = Boolean(target?.route && target?.id && target?.selectedKey);
    const row = el(
      isInteractive ? "button" : "div",
      [
        "light-calendar-detail-row",
        "light-meeting-note-detail-row",
        isInteractive ? "is-clickable" : "",
      ].filter(Boolean).join(" ")
    );
    row.dataset.detailRow = String(rowKey || label || "").trim().toLowerCase();
    if (isInteractive) {
      row.type = "button";
      row.dataset.workspaceTargetRoute = target.route;
      row.dataset.workspaceTargetId = target.id;
      row.dataset.workspaceTargetKind = target.kind || "";
      row.addEventListener("click", () => openWorkspaceTarget(
        target,
        options.fromRoute || state.route || "",
        options.openOptions || {}
      ));
    }
    row.append(
      el("strong", "light-calendar-detail-row-label", label),
      el("div", "light-calendar-detail-row-value", String(value || "").trim())
    );
    return row;
  }

  function meetingNoteAttendeeEntries(meeting) {
    const participants = Array.isArray(meeting?.metadata?.participants) ? meeting.metadata.participants : [];
    const seen = new Set();
    const entries = [];
    participants.forEach(value => {
      const label = String(value || "").trim();
      const key = label.toLowerCase();
      if (!label || seen.has(key)) {
        return;
      }
      seen.add(key);
      const contact = workspaceContactByName(label);
      const target = contact ? workspaceTargetForKind("contact", contact.id) : null;
      entries.push({
        label: contact ? calendarContactChipLabel(contact) : label,
        fullLabel: contact ? String(contact.title || contact.metadata?.display_name || label).trim() || label : label,
        contact: contact || null,
        target,
        recognized: Boolean(target),
      });
    });
    return entries;
  }

  function lightMeetingNoteWhoRow(meeting) {
    const attendees = meetingNoteAttendeeEntries(meeting);
    if (!attendees.length) {
      return null;
    }
    const row = el("div", "light-calendar-detail-row light-meeting-note-detail-row");
    row.dataset.detailRow = "who";
    const value = el("div", "light-calendar-detail-row-value light-calendar-detail-people");
    const cloud = el("div", "light-chip-cloud light-attendee-chip-cloud");
    attendees.forEach(entry => {
      if (entry.target) {
        cloud.append(lightCalendarContactChip(entry, { fromRoute: "meeting-note-detail" }));
        return;
      }
      cloud.append(lightGuestAttendeeChip(entry.label));
    });
    value.append(cloud);
    row.append(el("strong", "light-calendar-detail-row-label", "Who"), value);
    return row;
  }

  function lightRemindersPage() {
    const status = lightWorkspaceStatus("reminders", "bell", "No reminders yet");
    const reminders = chronologicalReminders();
    const active = reminders.filter(reminder => reminderIsActive(reminder));
    const live = active.filter(reminder => reminderIsLive(reminder));
    const upcoming = active.filter(reminder => !reminderIsLive(reminder));
    const sections = [];
    if (live.length) {
      sections.push(lightReminderListSection("Live", live, "live"));
    }
    if (upcoming.length) {
      sections.push(lightReminderListSection("Upcoming", upcoming, "upcoming"));
    }
    return renderUniversalFeedPage({
      title: "Reminders",
      surface: "reminders",
      pageClassName: "light-graph-page light-reminders-page",
      status,
      emptyState: lightEmptyState("bell", "No reminders yet", "Scheduled reminders will appear here."),
      sections,
    });
  }

  function lightReminderListSection(title, reminders, sectionKey = "") {
    return {
      key: String(sectionKey || "").trim().toLowerCase(),
      label: title,
      count: reminders.length,
      collapsible: false,
      expanded: true,
      emptyState: null,
      items: reminders.map(reminder => universalReminderFeedTileDescriptor(reminder, sectionKey))
    };
  }

  function lightReminderDetailPage() {
    const reminder = selectedReminder();
    if (!reminder) {
      return lightPage("Reminder", { subtitle: "Reminder not found.", detail: true });
    }
    ensureLinkedCollections(reminder);
    const page = lightPage("Reminder", { detail: true });
    page.classList.add("light-document-page", "light-reminder-document", "light-reminder-detail-page");
    page.append(lightReminderDetailSurface(reminder));
    return page;
  }

  function lightReminderDetailSurface(reminder) {
    const surface = el("div", "light-reminder-detail-surface");
    surface.dataset.reminderDetailId = String(reminder?.id || "");
    surface.append(lightReminderDetailCard(reminder));
    const feed = lightReminderDetailFeed(reminder);
    if (feed) {
      surface.append(feed);
    }
    return surface;
  }

  function lightGraphListPage(options = {}) {
    const status = lightWorkspaceStatus(options.collection, options.icon || "apps", options.emptyTitle || "No records yet");
    return renderUniversalFeedPage({
      title: options.title || "Workspace",
      surface: String(options.surface || options.collection || "workspace"),
      pageClassName: "light-graph-page",
      surfaceClassName: "light-list-surface",
      status,
      sections: [{
        key: String(options.sectionKey || options.collection || "records").trim().toLowerCase(),
        label: String(options.sectionLabel || "").trim(),
        count: workspaceItems(options.collection).length,
        collapsible: false,
        expanded: true,
        emptyState: null,
        items: workspaceItems(options.collection).map(record => universalGraphFeedTileDescriptor(record, options))
      }],
    });
  }

  function lightGraphRow(record, options = {}) {
    const rowClassName = String(options.rowClassName || "").trim();
    const flatFeed = options.flatFeed === true;
    const row = el("button", ["light-card", "light-feed-row", "light-graph-row", rowClassName, flatFeed ? "is-flat-feed" : ""].filter(Boolean).join(" "));
    const leadingIcon = options.showLeadingIcon === false
      ? null
      : lightSmallIcon(options.icon || graphKindIcon(record.kind));
    const trailingChevron = options.showTrailingChevron === false
      ? null
      : el("span", "light-chevron", ">");
    row.type = "button";
    row.dataset.recordId = record.id;
    row.addEventListener("click", () => {
      state[options.selectedKey] = record.id;
      lightNavigate(options.detailRoute, { from: options.collection });
    });
    if (leadingIcon) {
      row.append(leadingIcon);
    }
    row.append(lightTextStack(record.title, graphListLabel(record)));
    if (options.showChips !== false) {
      row.append(graphObjectChips(record));
    }
    if (trailingChevron) {
      row.append(trailingChevron);
    }
    return row;
  }

  function lightReminderRow(reminder, options = {}) {
    const group = reminderGroup(reminder);
    const deliveryClass = reminderDeliveryClass(reminder);
    const flatFeed = options.flatFeed === true;
    const row = el("button", ["light-card", "light-feed-row", "light-reminder-row", group || "", deliveryClass, flatFeed ? "is-flat-feed" : ""].filter(Boolean).join(" "));
    const copy = el("span", "light-text-stack");
    const secondaryCopy = reminderListSecondaryCopy(reminder);
    const reminderState = reminderIsLive(reminder) ? "live" : (reminderIsSnoozed(reminder) ? "snoozed" : "upcoming");
    copy.append(el("strong", "", reminder.title || "Untitled reminder"));
    if (secondaryCopy) {
      copy.append(el("span", "light-reminder-row-summary", secondaryCopy));
    }
    row.type = "button";
    row.dataset.recordId = reminder.id;
    row.dataset.reminderId = reminder.id;
    row.dataset.reminderState = reminderState;
    row.addEventListener("click", () => {
      state.selectedReminderId = reminder.id;
      lightNavigate("reminder-detail", { from: "reminders" });
    });
    row.append(
      lightSmallIcon("bell", "reminders"),
      copy,
      lightReminderRowEnd(reminder)
    );
    return row;
  }

  function lightReminderRowEnd(reminder) {
    const countdown = reminderSnoozeCountdown(reminder);
    if (countdown) {
      const wrap = el("span", "light-reminder-countdown");
      wrap.dataset.reminderCountdown = "true";
      wrap.dataset.reminderProgress = countdown.progress.toFixed(3);
      wrap.dataset.reminderRemainingMs = String(countdown.remainingMs);
      wrap.setAttribute("aria-label", `Snoozed for ${countdown.label} more, until ${countdown.untilLabel}`);
      wrap.title = `Snoozed until ${countdown.untilLabel}`;
      wrap.style.setProperty("--progress", countdown.progress.toFixed(3));
      wrap.append(
        el("span", "light-reminder-countdown-ring"),
        el("span", "light-reminder-countdown-label", countdown.label)
      );
      return wrap;
    }
    return el("span", "light-reminder-time", reminderRowLabel(reminder));
  }

  function chronologicalReminders() {
    return workspaceItems("reminders")
      .filter(reminder => !reminderIsDismissed(reminder))
      .slice()
      .sort((left, right) => {
        const leftSent = reminderIsSentHistory(left);
        const rightSent = reminderIsSentHistory(right);
        if (leftSent !== rightSent) {
          return leftSent ? 1 : -1;
        }
        if (leftSent && rightSent) {
          const leftSentAt = reminderSentAtMs(left);
          const rightSentAt = reminderSentAtMs(right);
          if (leftSentAt !== rightSentAt) {
            return rightSentAt - leftSentAt;
          }
        }
        const leftDue = Number(left?.due_at_ms || 0);
        const rightDue = Number(right?.due_at_ms || 0);
        const leftHasDue = Number.isFinite(leftDue) && leftDue > 0;
        const rightHasDue = Number.isFinite(rightDue) && rightDue > 0;
        if (leftHasDue && rightHasDue && leftDue !== rightDue) {
          return leftDue - rightDue;
        }
        if (leftHasDue !== rightHasDue) {
          return leftHasDue ? -1 : 1;
        }
        const leftEvent = Number(left?.event_at_ms || left?.updated_at_ms || 0);
        const rightEvent = Number(right?.event_at_ms || right?.updated_at_ms || 0);
        if (leftEvent !== rightEvent) {
          return leftEvent - rightEvent;
        }
        return String(left?.title || "").localeCompare(String(right?.title || ""));
      });
  }

  function lightGraphDetailPage(record, options = {}) {
    if (!record) {
      return lightPage(options.title || "Workspace", { subtitle: "Record not found.", detail: true });
    }
    ensureLinkedCollections(record);
    const page = lightPage(record.title || options.title || graphKindLabel(record.kind), { detail: true });
    page.classList.add("light-document-page", "light-graph-document");
    const article = el("article", "light-doc-article");
    article.append(
      lightDocumentEyebrow(options.eyebrow || graphKindLabel(record.kind), workspaceTimestamp(record.event_at_ms || record.start_at_ms || record.due_at_ms || record.updated_at_ms, "Updated")),
      el("h1", "", record.title),
      el("p", "light-note-body", record.summary || "")
    );
    page.append(article);
    if (Array.isArray(options.rows) && options.rows.length) {
      page.append(lightInfoSection("Context", options.rows));
    }
    const notes = lightLinkedNotesSection(record);
    if (notes) {
      page.append(notes);
    }
    const linkedRows = lightLinkedRecordRows(record, { excludeKinds: ["note"] });
    if (linkedRows.length) {
      page.append(lightInfoSection("Linked records", linkedRows));
    }
    return page;
  }

  function messageDetailRows(message) {
    const meta = message?.metadata || {};
    const participants = Array.isArray(meta.participants) ? meta.participants : [];
    const sender = String(meta.sender || "").trim();
    const seen = new Set(sender ? [sender.toLowerCase()] : []);
    const rows = [
      { icon: "text", label: "Channel", value: messageChannelLabel(message) },
      { icon: "contacts", label: "Sender", value: sender || "Unknown", target: workspaceContactTargetByName(sender) },
      { icon: "clock", label: "When", value: messageThreadTimeLabel(message) }
    ];
    let participantCount = 0;
    participants.forEach(name => {
      const value = String(name || "").trim();
      if (!value || seen.has(value.toLowerCase())) {
        return;
      }
      seen.add(value.toLowerCase());
      rows.push({
        icon: "contacts",
        label: participantCount === 0 ? "Participants" : "Also",
        value,
        target: workspaceContactTargetByName(value)
      });
      participantCount += 1;
    });
    if (!participantCount && !sender) {
      rows.push({ icon: "apps", label: "Participants", value: "Just me" });
    }
    return rows;
  }

  function meetingNoteConnectedDetail(entry) {
    const kind = String(entry?.relatedKind || entry?.kind || "").trim();
    const kindLabel = graphKindLabel(kind);
    const related = entry?.related || null;
    if (!related) {
      return String(entry?.relation || kindLabel).trim() || kindLabel;
    }
    if (kind === "calendar_event") {
      return calendarConnectedTileTimestampLabel(related);
    }
    const timestamp = kind === "note"
      ? noteTimestampLabel(related)
      : workspaceTimestamp(linkedRecordRecencyMs(kind, related), "");
    const summary = String(related?.summary || "").trim();
    return [kindLabel, timestamp, summary].filter(Boolean).join(DOT);
  }

  function reminderDestinationRows(reminder) {
    return reminderDestinations(reminder).map(destination => ({
      icon: reminderChannelIcon(destination.channel),
      accentKey: reminderChannelAccentKey(destination.channel),
      label: reminderChannelName(destination.channel),
      value: reminderDestinationDetail(reminder, destination)
    }));
  }

  function reminderRecipients(reminder) {
    const values = Array.isArray(reminder?.metadata?.recipients) ? reminder.metadata.recipients : [];
    if (!values.length) {
      return [{ id: "self", kind: "self", contactId: "", label: "Me" }];
    }
    return values.map(item => ({
      id: String(item?.id || item?.recipient_id || item?.contact_id || "").trim(),
      kind: String(item?.kind || (String(item?.id || "").trim() === "self" ? "self" : "contact")).trim().toLowerCase() || "contact",
      contactId: String(item?.contact_id || "").trim(),
      label: String(item?.label || item?.title || item?.name || "").trim()
    })).filter(item => item.id);
  }

  function reminderDestinations(reminder) {
    const values = Array.isArray(reminder?.metadata?.destinations) ? reminder.metadata.destinations : [];
    if (!values.length) {
      return [{ channel: "phone_notification", recipientIds: ["self"], appSlug: "", endpoint: "", address: "", label: "" }];
    }
    return values.map(item => ({
      id: String(item?.id || "").trim(),
      channel: String(item?.channel || item?.kind || item?.type || "").trim().toLowerCase(),
      recipientIds: Array.isArray(item?.recipient_ids) ? item.recipient_ids.map(value => String(value || "").trim()).filter(Boolean) : [],
      appSlug: String(item?.app_slug || "").trim().toLowerCase(),
      endpoint: String(item?.endpoint || "").trim(),
      address: String(item?.address || item?.value || item?.number || "").trim(),
      label: String(item?.label || "").trim()
    })).filter(item => item.channel);
  }

  function reminderLinkedChips(reminder) {
    const labels = [];
    const seen = new Set();
    const links = Array.isArray(reminder?.links) ? reminder.links : [];
    links.forEach(link => {
      const sourceKind = String(link?.source_kind || "").trim();
      const sourceId = String(link?.source_id || "").trim();
      const targetKind = String(link?.target_kind || "").trim();
      const targetId = String(link?.target_id || "").trim();
      let relatedKind = "";
      let relatedId = "";
      if (sourceKind === "reminder" && sourceId === reminder?.id) {
        relatedKind = targetKind;
        relatedId = targetId;
      } else if (targetKind === "reminder" && targetId === reminder?.id) {
        relatedKind = sourceKind;
        relatedId = sourceId;
      }
      if (!relatedKind || !relatedId) {
        return;
      }
      const label = workspaceTargetLabel(relatedKind, relatedId);
      if (!label || seen.has(label)) {
        return;
      }
      seen.add(label);
      labels.push(label);
    });
    if (!labels.length) {
      return null;
    }
    const row = el("span", "light-graph-chip-row");
    labels.slice(0, 2).forEach(label => row.append(el("span", "light-graph-chip", label)));
    if (labels.length > 2) {
      row.append(el("span", "light-graph-chip", `+${labels.length - 2}`));
    }
    return row;
  }

  function graphObjectChips(record) {
    const chips = el("span", "light-graph-chip-row");
    graphObjectChipValues(record).forEach(value => chips.append(el("span", "light-graph-chip", value)));
    return chips;
  }

  function graphObjectChipValues(record) {
    const meta = record?.metadata || {};
    const linkCount = Array.isArray(record?.links) ? record.links.length : 0;
    const values = [];
    if (record?.kind) {
      values.push(graphKindLabel(record.kind));
    }
    if (linkCount) {
      values.push(`${linkCount} link${linkCount === 1 ? "" : "s"}`);
    }
    if (meta.channel) {
      values.push(meta.channel);
    }
    return values.slice(0, 3);
  }

  function graphListLabel(record) {
    if (String(record?.kind || "").trim() === "calendar_event") {
      return calendarConnectedTileTimestampLabel(record);
    }
    const timestamp = workspaceTimestamp(record.event_at_ms || record.start_at_ms || record.due_at_ms || record.updated_at_ms, "Updated");
    return `${timestamp}${DOT}${record.summary || graphKindLabel(record.kind)}`;
  }

  function calendarConnectedTileTimestampLabel(event, timeZone = calendarEffectiveTimeZone(), nowMs = Date.now()) {
    const dayKey = calendarEventDateKey(event, timeZone);
    return `${calendarConnectedTileDateLabel(dayKey, timeZone, nowMs)}${DOT}${calendarEventTimeRange(event, timeZone)}`;
  }

  function calendarConnectedTileDateLabel(dayKey, timeZone = calendarEffectiveTimeZone(), nowMs = Date.now()) {
    const normalized = normalizeCalendarDateKey(dayKey) || calendarTodayDateKey(timeZone);
    const today = calendarDateKeyFromTimestamp(nowMs, timeZone) || calendarTodayDateKey(timeZone);
    if (normalized === today) {
      return "Today";
    }
    if (normalized === shiftCalendarDateKey(today, 1)) {
      return "Tomorrow";
    }
    if (normalized === shiftCalendarDateKey(today, -1)) {
      return "Yesterday";
    }
    const delta = calendarDateKeyDistance(normalized, today);
    if (Number.isFinite(delta) && Math.abs(delta) < 7) {
      return formatCalendarDateKey(normalized, { weekday: "long" });
    }
    return formatCalendarDateKey(normalized, { month: "numeric", day: "numeric", year: "2-digit" });
  }

  function calendarDateKeyDistance(dayKey, baseDayKey) {
    const day = calendarDateFromKey(dayKey);
    const base = calendarDateFromKey(baseDayKey);
    if (!day || !base) {
      return Number.NaN;
    }
    return Math.round((day.getTime() - base.getTime()) / (24 * 60 * 60 * 1000));
  }

  function connectedRecordValue(relatedKind, related, fallback = "", options = {}) {
    if (String(relatedKind || "").trim() === "calendar_event" && related) {
      return calendarConnectedTileTimestampLabel(related);
    }
    if (options.preferSummary === true) {
      const summary = String(related?.summary || "").trim();
      if (summary) {
        return summary;
      }
    }
    return String(fallback || graphKindLabel(relatedKind)).trim() || graphKindLabel(relatedKind);
  }

  function calendarEventDetailRows(event, attendees = calendarEventPeople(event)) {
    if (!event) {
      return [];
    }
    const meta = event.metadata || {};
    const rows = [{
      icon: "clock",
      label: "When",
      value: calendarEventCompactWhenLabel(event)
    }];
    const place = String(meta.place || "").trim();
    if (place) {
      rows.push({ icon: "pin", label: "Place", value: place });
    }
    const eventTimeZone = String(meta.time_zone || "").trim();
    if (eventTimeZone && eventTimeZone !== calendarEffectiveTimeZone()) {
      rows.push({ icon: "globe", label: "Time zone", value: eventTimeZone });
    }
    const recognized = attendees
      .filter(person => person?.recognized && person?.target)
      .map(person => String(person?.label || person?.fullLabel || "").trim())
      .filter(Boolean);
    if (recognized.length) {
      rows.push({
        icon: "contacts",
        label: "Who",
        value: recognized.join(", ")
      });
    }
    return rows;
  }

  function meetingTimeLabel(meeting) {
    if (!meeting) {
      return "Any time";
    }
    if (meeting.start_at_ms) {
      return `${meeting.date || "Scheduled"}${DOT}${calendarEventTimeRange(meeting)}`;
    }
    return meeting.date || "Any time";
  }

  function reminderDueLabel(reminder) {
    const due = Number(reminder?.due_at_ms || 0);
    const sentAtMs = reminderSentAtMs(reminder);
    if (sentAtMs > 0 && reminderIsSentHistory(reminder)) {
      return `Sent ${reminderClockLabel(sentAtMs, { includeDay: true })}`;
    }
    if (reminderIsSnoozed(reminder)) {
      return `Snoozed until ${reminderClockLabel(due)}`;
    }
    if (!Number.isFinite(due) || due <= 0) {
      return "Anytime";
    }
    const delta = due - Date.now();
    if (delta < 0) {
      return "Live";
    }
    if (delta <= 60 * 60 * 1000) {
      return `in ${Math.max(1, Math.ceil(delta / 60000))}m`;
    }
    return reminderClockLabel(due, { includeDay: delta > 24 * 60 * 60 * 1000 });
  }

  function reminderStatusLabel(reminder) {
    const status = String(reminder?.status || "").trim().toLowerCase();
    if (status === "done") {
      return "done";
    }
    return status || "open";
  }

  function reminderDeliveryLabel(reminder) {
    const deliveryState = reminderMetadata(reminder).deliveryState;
    if (deliveryState === "sent" && reminderIsSentHistory(reminder)) {
      return "Sent";
    }
    if (reminderIsSnoozed(reminder)) {
      return "Snoozed";
    }
    return "Pending";
  }

  function reminderDeliveryClass(reminder) {
    const label = reminderDeliveryLabel(reminder);
    if (label === "Sent") {
      return "delivery-sent";
    }
    if (label === "Snoozed") {
      return "delivery-snoozed";
    }
    return "delivery-pending";
  }

  function reminderDeliveryDetail(reminder) {
    const label = reminderDeliveryLabel(reminder);
    const channels = reminderChannelSummary(reminder);
    if (channels) {
      return `${label}${DOT}${channels}`;
    }
    return label;
  }

  function reminderChannelSummary(reminder) {
    const names = [];
    const seen = new Set();
    reminderDestinations(reminder).forEach(destination => {
      const name = reminderChannelName(destination.channel);
      if (!name || seen.has(name)) {
        return;
      }
      seen.add(name);
      names.push(name);
    });
    return names.join(", ");
  }

  function reminderChannelName(channel) {
    return ({
      phone_notification: "Phone notification",
      email: "Email",
      sms: "SMS",
      call: "Call",
      connected_app: "Connected app"
    })[String(channel || "").trim().toLowerCase()] || "Reminder";
  }

  function reminderChannelIcon(channel) {
    return ({
      phone_notification: "bell",
      email: "text",
      sms: "text",
      call: "phone",
      connected_app: "apps"
    })[String(channel || "").trim().toLowerCase()] || "bell";
  }

  function reminderChannelAccentKey(channel) {
    return ({
      phone_notification: "reminders",
      email: "inbox",
      sms: "inbox",
      call: "contacts",
      connected_app: "connect"
    })[String(channel || "").trim().toLowerCase()] || "reminders";
  }

  function reminderDestinationDetail(reminder, destination) {
    const recipientNames = reminderDestinationRecipientNames(reminder, destination);
    if (destination.channel === "connected_app" && destination.appSlug) {
      return recipientNames ? `${destination.appSlug}${DOT}${recipientNames}` : destination.appSlug;
    }
    if (destination.address) {
      return recipientNames ? `${recipientNames}${DOT}${destination.address}` : destination.address;
    }
    return recipientNames || reminderChannelName(destination.channel);
  }

  function reminderDestinationRecipientNames(reminder, destination) {
    const recipientsById = new Map(reminderRecipients(reminder).map(item => [item.id, item]));
    const names = destination.recipientIds.map(id => reminderRecipientDisplayName(recipientsById.get(id))).filter(Boolean);
    return names.join(", ");
  }

  function reminderRecipientDisplayName(recipient) {
    if (!recipient) {
      return "";
    }
    if (String(recipient.kind || "").trim().toLowerCase() === "self") {
      const me = workspaceRecordByKind("contact", SELF_CONTACT_ID);
      return String(me?.title || recipient.label || "Me").trim() || "Me";
    }
    const contactId = String(recipient.contactId || recipient.id || "").trim();
    const contact = contactId ? workspaceRecordByKind("contact", contactId) : null;
    return String(recipient.label || contact?.title || contactId || "Contact").trim() || "Contact";
  }

  function reminderRecipientSecondaryCopy(recipient) {
    if (!recipient) {
      return "";
    }
    if (String(recipient.kind || "").trim().toLowerCase() === "self") {
      return "";
    }
    const contactId = String(recipient.contactId || recipient.id || "").trim();
    const contact = contactId ? workspaceRecordByKind("contact", contactId) : null;
    return String(contact?.summary || "").trim();
  }

  function reminderDetailLinkedRows(reminder, options = {}) {
    const currentKind = String(reminder?.kind || "");
    const currentId = String(reminder?.id || reminder?.record_id || "");
    const links = Array.isArray(reminder?.links) ? reminder.links : [];
    const includeKinds = Array.isArray(options.includeKinds) && options.includeKinds.length
      ? new Set(options.includeKinds.map(value => String(value || "").trim()).filter(Boolean))
      : null;
    const excludeKinds = new Set(
      Array.isArray(options.excludeKinds) ? options.excludeKinds.map(value => String(value || "").trim()).filter(Boolean) : []
    );
    const rows = [];
    const seen = new Set();
    links.forEach(link => {
      const isSource = String(link.source_kind) === currentKind && String(link.source_id) === currentId;
      const relatedKind = isSource ? link.target_kind : link.source_kind;
      const normalizedKind = String(relatedKind || "").trim();
      if ((includeKinds && !includeKinds.has(normalizedKind)) || excludeKinds.has(normalizedKind)) {
        return;
      }
      const relatedId = isSource ? link.target_id : link.source_id;
      const rowKey = `${normalizedKind}:${String(relatedId || "").trim()}`;
      if (!String(relatedId || "").trim() || seen.has(rowKey)) {
        return;
      }
      seen.add(rowKey);
      const related = workspaceRecordByKind(relatedKind, relatedId);
      const label = String(related?.title || link.label || relatedId || graphKindLabel(relatedKind)).trim() || graphKindLabel(relatedKind);
      const relation = link.label && link.label !== label ? `${graphKindLabel(relatedKind)}${DOT}${link.label}` : graphKindLabel(relatedKind);
      const value = typeof options.valueResolver === "function"
        ? options.valueResolver({ link, related, relatedKind: normalizedKind, relatedId, label, relation })
        : connectedRecordValue(relatedKind, related, relation, { preferSummary: true });
      rows.push({
        icon: graphKindIcon(relatedKind),
        accentKey: graphKindAccentKey(relatedKind),
        label,
        value,
        target: workspaceTargetForKind(relatedKind, related?.id || relatedId),
        kind: normalizedKind,
        className: String(options.className || "light-reminder-detail-tile is-linked").trim(),
        dataset: {
          reminderDetailTile: String(options.tileType || "linked"),
          reminderLinkedKind: normalizedKind,
        },
      });
    });
    return rows;
  }

  function reminderDetailLinkedNoteRows(reminder) {
    return reminderDetailLinkedRows(reminder, {
      includeKinds: ["note"],
      tileType: "note",
      className: "light-reminder-detail-tile is-note",
      valueResolver: ({ related, relation }) => String(related?.summary || relation || "Note").trim() || "Note",
    });
  }

  function reminderDetailLinkedRecordRows(reminder) {
    const kindOrder = ["calendar_event", "task", "meeting_note", "project", "contact", "feed_item"];
    const rows = reminderDetailLinkedRows(reminder, {
      excludeKinds: ["note"],
      tileType: "linked",
      className: "light-reminder-detail-tile is-linked",
    });
    rows.sort((left, right) => {
      const leftOrder = kindOrder.indexOf(String(left?.kind || ""));
      const rightOrder = kindOrder.indexOf(String(right?.kind || ""));
      const leftRank = leftOrder >= 0 ? leftOrder : kindOrder.length;
      const rightRank = rightOrder >= 0 ? rightOrder : kindOrder.length;
      if (leftRank !== rightRank) {
        return leftRank - rightRank;
      }
      return String(left?.label || "").localeCompare(String(right?.label || ""));
    });
    return rows;
  }

  function reminderDetailFeedRows(reminder) {
    return [
      ...reminderDetailLinkedNoteRows(reminder),
      ...reminderDetailLinkedRecordRows(reminder),
    ];
  }

  function lightReminderDetailFeed(reminder) {
    const rows = reminderDetailFeedRows(reminder);
    if (!rows.length) {
      return null;
    }
    const section = el("section", "light-info-section light-reminder-detail-feed-section");
    section.append(lightSectionTitle("Connected"));
    const card = el("div", "light-card light-info-card light-reminder-detail-feed");
    card.dataset.reminderDetailFeed = "true";
    rows.forEach(row => card.append(lightInfoRow(row)));
    section.append(card);
    return section;
  }

  function lightReminderActionRow(reminder) {
    if (!reminderIsLive(reminder)) {
      return null;
    }
    const reminderId = reminderRecordId(reminder);
    const donePending = reminderMutationPending(reminderId, "done");
    const snoozePending = reminderMutationPending(reminderId, "snooze");
    const pending = donePending || snoozePending;
    const row = el("div", "light-reminder-action-row");
    row.dataset.reminderActionRow = "true";

    const dismissButton = el("button", "light-pill light-reminder-action-button is-primary", "Dismiss");
    dismissButton.type = "button";
    dismissButton.dataset.reminderAction = "dismiss";
    dismissButton.disabled = pending || reminderIsDismissed(reminder);
    dismissButton.addEventListener("click", event => {
      event.preventDefault();
      void dismissReminder(reminder);
    });

    const snoozeButton = el("button", "light-pill light-reminder-action-button", "Snooze");
    snoozeButton.type = "button";
    snoozeButton.dataset.reminderAction = "snooze";
    snoozeButton.disabled = pending || reminderIsDismissed(reminder);
    snoozeButton.addEventListener("click", event => {
      event.preventDefault();
      void snoozeReminder(reminder, Date.now() + 90_000);
    });

    row.append(dismissButton, snoozeButton);
    return row;
  }

  function lightReminderDetailCard(reminder) {
    const card = el("section", `light-card light-reminder-detail-card ${reminderDeliveryClass(reminder)}`.trim());
    card.dataset.reminderDetailCard = "true";
    card.dataset.reminderState = reminderIsLive(reminder) ? "live" : (reminderIsSnoozed(reminder) ? "snoozed" : "upcoming");
    const identity = el("div", "light-reminder-detail-identity");
    const copy = el("div", "light-reminder-detail-copy");
    copy.append(
      el("span", "light-reminder-detail-eyebrow", reminderDetailEyebrow(reminder)),
      el("strong", "light-reminder-detail-title", reminder.title || "Untitled reminder")
    );
    const summary = String(reminder?.summary || "").trim();
    if (summary) {
      copy.append(el("p", "light-reminder-detail-summary", summary));
    }
    identity.append(lightSmallIcon("bell", "reminders"), copy);
    card.append(identity);
    const actionRow = lightReminderActionRow(reminder);
    if (actionRow) {
      card.append(actionRow);
    }
    return card;
  }

  function reminderGroup(reminder) {
    if (reminderIsSentHistory(reminder)) {
      return "sent";
    }
    if (reminderIsLive(reminder)) {
      return "live";
    }
    if (reminderIsActive(reminder)) {
      return "upcoming";
    }
    return "unscheduled";
  }

  function reminderIsLive(reminder) {
    if (!reminderIsActive(reminder) || reminderIsSnoozed(reminder)) {
      return false;
    }
    const due = Number(reminder?.due_at_ms || 0);
    return Number.isFinite(due) && due > 0 && due <= Date.now();
  }

  function reminderIsNow(reminder) {
    return reminderIsLive(reminder);
  }

  function reminderClockLabel(ms, options = {}) {
    const value = Number(ms || 0);
    if (!Number.isFinite(value) || value <= 0) {
      return "Anytime";
    }
    const date = new Date(value);
    const time = date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    if (!options.includeDay) {
      return time;
    }
    const weekday = date.toLocaleDateString([], { weekday: "short" });
    return `${weekday} ${time}`;
  }

  function reminderRowLabel(reminder) {
    return reminderListDueLabel(reminder);
  }

  function reminderListSecondaryCopy(reminder) {
    const summary = String(reminder?.summary || "").trim();
    if (summary) {
      return summary;
    }
    if (reminderIsSnoozed(reminder)) {
      return `Snoozed until ${reminderClockLabel(Number(reminder?.due_at_ms || 0))}`;
    }
    return "Personal reminder";
  }

  function reminderListDueLabel(reminder) {
    const due = Number(reminder?.due_at_ms || 0);
    if (!Number.isFinite(due) || due <= 0) {
      return "Anytime";
    }
    const delta = due - Date.now();
    if (delta <= 0) {
      return "Live";
    }
    if (delta <= 60 * 60 * 1000) {
      return `in ${Math.max(1, Math.ceil(delta / 60000))}m`;
    }
    const date = new Date(due);
    const day = dateKey(date);
    if (day === todayDateKey()) {
      return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    }
    if (day === todayDateKey(1)) {
      return "Tomorrow";
    }
    return date.toLocaleDateString([], { month: "short", day: "numeric" });
  }

  function reminderScheduleLabel(reminder) {
    const due = Number(reminder?.due_at_ms || 0);
    if (!Number.isFinite(due) || due <= 0) {
      return "Anytime";
    }
    return workspaceTimestamp(due, "Scheduled");
  }

  function reminderDetailEyebrow(reminder) {
    if (reminderIsSnoozed(reminder)) {
      return `Snoozed until ${reminderClockLabel(Number(reminder?.due_at_ms || 0))}`;
    }
    if (reminderIsLive(reminder)) {
      return `Live${DOT}${reminderScheduleLabel(reminder)}`;
    }
    return reminderScheduleLabel(reminder);
  }

  function reminderMetadata(reminder) {
    const meta = reminder?.metadata || {};
    return {
      deliveryState: String(meta.delivery_state || "").trim().toLowerCase(),
      snoozedUntilMs: Number(meta.snoozed_until_ms || 0),
      lastFiredAtMs: Number(meta.last_fired_at_ms || 0),
      lastFiredDueAtMs: Number(meta.last_fired_due_at_ms || 0)
    };
  }

  function reminderIsDismissed(reminder) {
    return String(reminder?.status || "").trim().toLowerCase() === "done";
  }

  function reminderSentAtMs(reminder) {
    return reminderMetadata(reminder).lastFiredAtMs;
  }

  function reminderIsSentHistory(reminder) {
    void reminder;
    // Delivered reminders stay in the active/live flow until the user dismisses them.
    return false;
  }

  function reminderIsSnoozed(reminder) {
    if (reminderIsDismissed(reminder) || reminderIsSentHistory(reminder)) {
      return false;
    }
    const meta = reminderMetadata(reminder);
    return meta.snoozedUntilMs > Date.now() && meta.snoozedUntilMs === Number(reminder?.due_at_ms || 0);
  }

  function reminderIsActive(reminder) {
    return !reminderIsDismissed(reminder) && !reminderIsSentHistory(reminder);
  }

  function reminderIsNavigableFromList(reminder) {
    return reminderIsActive(reminder);
  }

  function reminderSnoozeCountdown(reminder, nowMs) {
    if (!reminderIsSnoozed(reminder)) {
      return null;
    }
    const dueAtMs = Number(reminder?.due_at_ms || 0);
    if (!Number.isFinite(dueAtMs) || dueAtMs <= 0) {
      return null;
    }
    const updatedAtMs = Number(reminder?.updated_at_ms || reminder?.event_at_ms || reminder?.created_at_ms || 0);
    const fallbackStartAtMs = Math.max(0, dueAtMs - 60_000);
    const startAtMs = updatedAtMs > 0 ? Math.min(updatedAtMs, fallbackStartAtMs) : fallbackStartAtMs;
    const totalMs = Math.max(60_000, dueAtMs - startAtMs);
    const remainingMs = Math.max(0, dueAtMs - Number(nowMs || Date.now()));
    const progress = Math.max(0, Math.min(1, 1 - (remainingMs / totalMs)));
    return {
      totalMs,
      remainingMs,
      progress,
      label: reminderRemainingCompactLabel(remainingMs),
      untilLabel: reminderClockLabel(dueAtMs),
    };
  }

  function reminderRemainingCompactLabel(ms) {
    const value = Math.max(0, Number(ms || 0));
    if (!Number.isFinite(value) || value <= 0) {
      return "0m";
    }
    const totalMinutes = Math.max(1, Math.ceil(value / 60000));
    if (totalMinutes < 60) {
      return `${totalMinutes}m`;
    }
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    if (hours >= 24 && minutes === 0) {
      return `${Math.round(totalMinutes / (24 * 60))}d`;
    }
    if (minutes === 0) {
      return `${hours}h`;
    }
    return `${hours}h ${minutes}m`;
  }

  function routeUsesReminderLiveUiTick(route = state.route) {
    return ["home", "reminders", "reminder-detail"].includes(String(route || "").trim());
  }

  function reminderNeedsLiveUiTick(reminder, nowMs = Date.now()) {
    if (!reminderIsActive(reminder)) {
      return false;
    }
    const dueAtMs = Number(reminder?.due_at_ms || 0);
    if (!Number.isFinite(dueAtMs) || dueAtMs <= 0) {
      return false;
    }
    return dueAtMs > nowMs || reminderIsLive(reminder) || reminderIsSnoozed(reminder);
  }

  function shouldTickReminderLiveUi(route = state.route, nowMs = Date.now()) {
    if (document.visibilityState !== "visible" || !routeUsesReminderLiveUiTick(route)) {
      return false;
    }
    return workspaceItems("reminders").some(reminder => reminderNeedsLiveUiTick(reminder, nowMs));
  }

  function activeReminderCount() {
    return workspaceItems("reminders").filter(reminder => reminderIsActive(reminder)).length;
  }

  function graphKindLabel(kind) {
    return ({
      note: "Note",
      task: "Task",
      calendar_event: "Calendar",
      feed_item: "Inbox",
      project: "Project",
      contact: "Contact",
      message: "Message",
      meeting_note: "Meeting note",
      reminder: "Reminder",
      asset: "Asset"
    })[String(kind || "")] || "Record";
  }

  function graphKindAccentKey(kind) {
    return canonicalIconAccentKey(graphKindIcon(kind));
  }

  function graphKindIcon(kind) {
    return ({
      note: "note",
      task: "checklist",
      calendar_event: "calendar",
      feed_item: "text",
      project: "folder",
      contact: "contacts",
      message: "chat",
      meeting_note: "record_voice_over",
      reminder: "bell",
      asset: "attachment"
    })[String(kind || "")] || "apps";
  }

  function workspaceCollectionForKind(kind) {
    return WORKSPACE_KIND_COLLECTIONS[String(kind || "")] || "";
  }

  function workspaceRecordByKind(kind, id) {
    const collection = workspaceCollectionForKind(kind);
    if (!collection) {
      return null;
    }
    const recordId = String(id || "").trim();
    const direct = workspaceItems(collection).find(item => item.id === recordId || item.record_id === recordId);
    if (direct) {
      return direct;
    }
    const bucket = workspaceBucket(collection);
    const cached = workspaceRecordCacheEntry(bucket, recordId);
    if (cached?.record) {
      return cached.record;
    }
    const queryCache = bucket?.queryCache && typeof bucket.queryCache === "object" ? bucket.queryCache : {};
    for (const entry of Object.values(queryCache)) {
      const match = Array.isArray(entry?.items)
        ? entry.items.find(item => item.id === recordId || item.record_id === recordId)
        : null;
      if (match) {
        rememberWorkspaceRecord(bucket, match, safeNumber(entry.lastRefreshAt) || Date.now());
        return match;
      }
    }
    return null;
  }

  function workspaceTargetForKind(kind, id) {
    const normalizedKind = String(kind || "").trim();
    const normalizedId = String(id || "").trim();
    const route = ({
      note: "note-detail",
      task: "task-detail",
      calendar_event: "meeting-detail",
      feed_item: "inbox-detail",
      project: "project-detail",
      contact: "contact-detail",
      meeting_note: "meeting-note-detail",
      reminder: "reminder-detail"
    })[normalizedKind] || "";
    const selectedKey = ({
      note: "selectedNoteId",
      task: "selectedTaskId",
      calendar_event: "selectedMeetingId",
      feed_item: "selectedFeedId",
      project: "selectedProjectId",
      contact: "selectedContactId",
      meeting_note: "selectedMeetingNoteId",
      reminder: "selectedReminderId"
    })[normalizedKind] || "";
    if (!route || !selectedKey || !normalizedId) {
      return null;
    }
    return { kind: normalizedKind, id: normalizedId, route, selectedKey };
  }

  function workspaceTargetLabel(kind, id) {
    return String(workspaceRecordByKind(kind, id)?.title || id || graphKindLabel(kind));
  }

  function workspaceContactByName(name) {
    const target = String(name || "").trim().toLowerCase();
    if (!target) {
      return null;
    }
    return workspaceItems("contacts").find(item => {
      const meta = item?.metadata || {};
      return [item.title, meta.display_name].some(value => String(value || "").trim().toLowerCase() === target);
    }) || null;
  }

  function workspaceContactTargetByName(name) {
    const contact = workspaceContactByName(name);
    return contact ? workspaceTargetForKind("contact", contact.id) : null;
  }

  function calendarContactChipLabel(contact) {
    const meta = contact?.metadata || {};
    const first = String(meta.first_name || "").trim();
    const last = String(meta.last_name || "").trim();
    if (first && last) {
      return `${first} ${last.charAt(0).toUpperCase()}.`;
    }
    if (first) {
      return first;
    }
    const display = String(contact?.title || meta.display_name || "").trim();
    return display || "Contact";
  }

  function calendarEventNeedsContacts(event) {
    const attendees = Array.isArray(event?.metadata?.attendees) ? event.metadata.attendees : [];
    if (attendees.length) {
      return true;
    }
    const currentKind = String(event?.kind || "calendar_event");
    const currentId = String(event?.id || event?.record_id || "");
    const links = Array.isArray(event?.links) ? event.links : [];
    return links.some(link => {
      const relatedKind = String(link.source_kind) === currentKind && String(link.source_id) === currentId
        ? link.target_kind
        : link.source_kind;
      return String(relatedKind || "") === "contact";
    });
  }

  function ensureCalendarAgendaCollections(events) {
    if (!Array.isArray(events) || !events.length) {
      return;
    }
    let needsContacts = false;
    events.forEach(event => {
      if (calendarEventNeedsContacts(event)) {
        needsContacts = true;
      }
      if (Array.isArray(event?.links) && event.links.length) {
        ensureLinkedCollections(event);
      }
    });
    if (needsContacts) {
      const bucket = workspaceBucket("contacts");
      if (!bucket.loaded && !bucket.loading) {
        void loadWorkspaceCollection("contacts", { render: true });
      }
    }
  }

  function calendarEventPeople(event) {
    const people = [];
    const seenIds = new Set();
    const seenNames = new Set();
    const remember = person => {
      const contactId = String(person?.contactId || "").trim();
      const fullLabel = String(person?.fullLabel || person?.label || "").trim();
      const nameKey = fullLabel.toLowerCase();
      if (contactId && seenIds.has(contactId)) {
        return;
      }
      if (!contactId && nameKey && seenNames.has(nameKey)) {
        return;
      }
      if (contactId) {
        seenIds.add(contactId);
      }
      if (nameKey) {
        seenNames.add(nameKey);
      }
      people.push({
        label: String(person?.label || fullLabel || "Guest").trim() || "Guest",
        fullLabel: fullLabel || String(person?.label || "Guest").trim() || "Guest",
        target: person?.target || null,
        contactId,
        recognized: Boolean(person?.recognized && person?.target)
      });
    };
    const currentKind = String(event?.kind || "calendar_event");
    const currentId = String(event?.id || event?.record_id || "");
    const links = Array.isArray(event?.links) ? event.links : [];
    links.forEach(link => {
      const isSource = String(link.source_kind) === currentKind && String(link.source_id) === currentId;
      const relatedKind = isSource ? link.target_kind : link.source_kind;
      if (String(relatedKind || "") !== "contact") {
        return;
      }
      const relatedId = isSource ? link.target_id : link.source_id;
      const contact = workspaceRecordByKind("contact", relatedId);
      if (contact) {
        const fullLabel = String(contact.title || contact.metadata?.display_name || "").trim() || String(link.label || relatedId || "Contact").trim();
        remember({
          label: calendarContactChipLabel(contact),
          fullLabel,
          target: workspaceTargetForKind("contact", contact.id),
          contactId: contact.id,
          recognized: true
        });
        return;
      }
      const fallback = String(link.label || relatedId || "").trim();
      if (fallback) {
        remember({ label: fallback, fullLabel: fallback });
      }
    });
    const attendees = Array.isArray(event?.metadata?.attendees) ? event.metadata.attendees : [];
    attendees.forEach(name => {
      const fullLabel = String(name || "").trim();
      if (!fullLabel) {
        return;
      }
      const contact = workspaceContactByName(fullLabel);
      if (contact) {
        remember({
          label: calendarContactChipLabel(contact),
          fullLabel: String(contact.title || contact.metadata?.display_name || fullLabel).trim() || fullLabel,
          target: workspaceTargetForKind("contact", contact.id),
          contactId: contact.id,
          recognized: true
        });
        return;
      }
      remember({ label: fullLabel, fullLabel });
    });
    return people;
  }

  function taskUsesSplitLayout() {
    return typeof window !== "undefined" && window.innerWidth >= TASK_SPLIT_MIN_WIDTH_PX;
  }

  function taskDetailReturnRoute() {
    return taskUsesSplitLayout() ? "tasks" : "task-detail";
  }

  function rememberTaskNavOrigin(taskId, route = taskDetailReturnRoute()) {
    const normalizedTaskId = String(taskId || "").trim();
    const normalizedRoute = String(route || "").trim();
    if (!normalizedTaskId || !normalizedRoute) {
      state.taskNavOrigin = null;
      return null;
    }
    const origin = { taskId: normalizedTaskId, route: normalizedRoute };
    state.taskNavOrigin = origin;
    return origin;
  }

  function rememberDetailNavOrigin(origin = null) {
    if (!origin || typeof origin !== "object") {
      state.detailNavOrigin = null;
      return null;
    }
    const kind = String(origin.kind || "").trim().toLowerCase();
    const route = String(origin.route || "").trim().toLowerCase();
    if (kind === "transcript") {
      const sessionId = String(origin.sessionId || origin.session_id || "").trim();
      const threadId = String(origin.threadId || origin.thread_id || "").trim();
      if (!route || (!sessionId && !threadId)) {
        state.detailNavOrigin = null;
        return null;
      }
      state.detailNavOrigin = { kind, route, sessionId, threadId };
      return state.detailNavOrigin;
    }
    if (kind === "meeting_detail") {
      const meetingId = String(origin.meetingId || origin.meeting_id || "").trim();
      if (!route || !meetingId) {
        state.detailNavOrigin = null;
        return null;
      }
      state.detailNavOrigin = { kind, route, meetingId };
      return state.detailNavOrigin;
    }
    state.detailNavOrigin = null;
    return null;
  }

  function restoreDetailNavOrigin() {
    const origin = state.detailNavOrigin;
    if (!origin || typeof origin !== "object") {
      return false;
    }
    state.detailNavOrigin = null;
    if (String(origin.kind || "") === "transcript") {
      const card = origin.threadId
        ? findCardByThreadId(origin.threadId)
        : findCardBySessionId(origin.sessionId);
      if (card) {
        showTranscript(card, { restoring: true });
        return true;
      }
      return false;
    }
    if (String(origin.kind || "") === "meeting_detail") {
      const meetingId = String(origin.meetingId || "").trim();
      const meeting = state.meetings.records.find(item => String(item?.meeting_id || "").trim() === meetingId);
      if (meeting) {
        void showMeetingDetail(meeting);
        return true;
      }
    }
    return false;
  }

  function openWorkspaceTarget(target, fromRoute = "", options = {}) {
    if (!target || !target.route || !target.selectedKey || !target.id) {
      return false;
    }
    if (options && options.taskOrigin) {
      state.taskNavOrigin = {
        taskId: String(options.taskOrigin.taskId || "").trim(),
        route: String(options.taskOrigin.route || "").trim() || taskDetailReturnRoute()
      };
    }
    if (options && options.detailOrigin) {
      rememberDetailNavOrigin(options.detailOrigin);
    }
    if (target.route === "meeting-detail") {
      state.meetingDetailSections = resetMeetingDetailSections(target.id);
      state.meetingDetailSectionCache = {
        ...state.meetingDetailSectionCache,
        [String(target.id || "").trim()]: state.meetingDetailSections,
      };
    }
    state[target.selectedKey] = target.id;
    lightNavigate(target.route, {
      from: fromRoute || state.route || "",
      selectionPatch: { [target.selectedKey]: target.id },
      preserveTaskOrigin: Boolean(options && options.taskOrigin),
      preserveDetailOrigin: Boolean(options && options.detailOrigin),
    });
    return true;
  }

  function ensureLinkedCollections(record) {
    const links = Array.isArray(record?.links) ? record.links : [];
    links.forEach(link => {
      const currentKind = String(record.kind || "");
      const currentId = String(record.id || record.record_id || "");
      const relatedKind = String(link.source_kind) === currentKind && String(link.source_id) === currentId
        ? link.target_kind
        : link.source_kind;
      const relatedId = String(link.source_kind) === currentKind && String(link.source_id) === currentId
        ? link.target_id
        : link.source_id;
      const collection = workspaceCollectionForKind(relatedKind);
      const bucket = collection ? workspaceBucket(collection) : null;
      if (String(relatedKind || "") === "calendar_event" && collection && relatedId && !workspaceRecordByKind(relatedKind, relatedId)) {
        void loadWorkspaceRecord(collection, relatedId, { render: true, reason: "linked_calendar" });
      }
      if (bucket && !bucket.loaded && !bucket.loading) {
        void loadWorkspaceCollection(collection, { render: true });
      }
    });
  }

  function workspaceLinkedEntries(record, options = {}) {
    const currentKind = String(options.currentKind || record?.kind || "");
    const currentId = String(record?.id || record?.record_id || "");
    const links = Array.isArray(record?.links) ? record.links : [];
    const includeKinds = Array.isArray(options.includeKinds) && options.includeKinds.length
      ? new Set(options.includeKinds.map(value => String(value || "").trim()).filter(Boolean))
      : null;
    const excludeKinds = new Set(
      Array.isArray(options.excludeKinds) ? options.excludeKinds.map(value => String(value || "").trim()).filter(Boolean) : []
    );
    const dedupeTargets = options.dedupeTargets === true;
    const seenTargets = dedupeTargets ? new Set() : null;
    const rows = [];
    links.forEach(link => {
      const isSource = String(link.source_kind) === currentKind && String(link.source_id) === currentId;
      const relatedKind = isSource ? link.target_kind : link.source_kind;
      const normalizedKind = String(relatedKind || "").trim();
      if ((includeKinds && !includeKinds.has(normalizedKind)) || excludeKinds.has(normalizedKind)) {
        return;
      }
      const relatedId = String(isSource ? link.target_id : link.source_id || "").trim();
      const related = workspaceRecordByKind(relatedKind, relatedId);
      if (seenTargets) {
        const dedupeKey = `${normalizedKind}:${String(related?.id || relatedId).trim()}`;
        if (!dedupeKey.endsWith(":") && seenTargets.has(dedupeKey)) {
          return;
        }
        if (!dedupeKey.endsWith(":")) {
          seenTargets.add(dedupeKey);
        }
      }
      const label = String(related?.title || link.label || relatedId || graphKindLabel(relatedKind)).trim() || graphKindLabel(relatedKind);
      const relation = link.label && link.label !== label ? `${graphKindLabel(relatedKind)}${DOT}${link.label}` : graphKindLabel(relatedKind);
      rows.push({
        link,
        related,
        kind: normalizedKind,
        relatedKind: normalizedKind,
        relatedId,
        label,
        relation,
        target: workspaceTargetForKind(relatedKind, related?.id || relatedId),
      });
    });
    return rows;
  }

  function workspaceLinkedRows(record, options = {}) {
    return workspaceLinkedEntries(record, options).map(entry => {
      const resolvedValue = typeof options.valueResolver === "function"
        ? options.valueResolver(entry)
        : connectedRecordValue(entry.relatedKind, entry.related, entry.relation);
      return {
        icon: graphKindIcon(entry.relatedKind),
        accentKey: graphKindAccentKey(entry.relatedKind),
        label: entry.label,
        value: String(resolvedValue || entry.relation || graphKindLabel(entry.relatedKind)),
        target: entry.target
      };
    });
  }

  function lightLinkedRecordRows(record, options = {}) {
    return workspaceLinkedRows(record, options);
  }

  function lightLinkedNotesSection(record, options = {}) {
    const rows = workspaceLinkedRows(record, {
      includeKinds: ["note"],
      valueResolver: ({ related, relation }) => String(related?.summary || relation || "Note").trim() || "Note"
    });
    if (!rows.length) {
      return null;
    }
    return lightInfoSection(options.title || "Notes", rows, { showTrailingChevron: options.showTrailingChevron });
  }

  function connectedRecordEntries(records, options = {}) {
    const includeKinds = Array.isArray(options.includeKinds) && options.includeKinds.length
      ? new Set(options.includeKinds.map(value => String(value || "").trim()).filter(Boolean))
      : null;
    const excludeKinds = new Set(
      Array.isArray(options.excludeKinds) ? options.excludeKinds.map(value => String(value || "").trim()).filter(Boolean) : []
    );
    const dedupeTargets = options.dedupeTargets !== false;
    const seenTargets = dedupeTargets ? new Set() : null;
    const entries = [];
    (Array.isArray(records) ? records : []).forEach(item => {
      if (!item || typeof item !== "object") {
        return;
      }
      const kind = String(item.kind || "").trim();
      const relatedId = String(item.id || item.record_id || "").trim();
      if (!kind || !relatedId || (includeKinds && !includeKinds.has(kind)) || excludeKinds.has(kind)) {
        return;
      }
      if (seenTargets) {
        const key = `${kind}:${relatedId}`;
        if (seenTargets.has(key)) {
          return;
        }
        seenTargets.add(key);
      }
      const related = workspaceRecordByKind(kind, relatedId);
      entries.push({
        link: null,
        related,
        kind,
        relatedKind: kind,
        relatedId,
        label: String(related?.title || item.title || relatedId || graphKindLabel(kind)).trim() || graphKindLabel(kind),
        relation: graphKindLabel(kind),
        target: workspaceTargetForKind(kind, related?.id || relatedId),
        snapshot: item,
      });
    });
    return entries;
  }

  function lightLinkedRecordChips(entry) {
    if (entry?.related) {
      return graphObjectChips(entry.related);
    }
    const row = el("span", "light-graph-chip-row");
    row.append(el("span", "light-graph-chip", graphKindLabel(entry?.kind)));
    return row;
  }

  function lightLinkedRecordFeedRow(entry, options = {}) {
    const kind = String(entry?.kind || entry?.relatedKind || "").trim();
    const target = entry?.target || null;
    const related = entry?.related || null;
    const isInteractive = Boolean(target?.route && target?.id && target?.selectedKey);
    const showChips = options.showChips !== false;
    const showChevron = options.showChevron !== false;
    const flatFeed = String(options.variant || "").trim().toLowerCase() === "flat";
    const row = el(
      isInteractive ? "button" : "div",
      [
        "light-card",
        "light-feed-row",
        "light-graph-row",
        "light-linked-record-feed-row",
        showChips ? "" : "is-no-chips",
        showChevron ? "" : "is-no-chevron",
        flatFeed ? "is-flat-feed" : "",
        String(options.rowClassName || "").trim(),
      ].filter(Boolean).join(" ")
    );
    const title = String(related?.title || entry?.label || entry?.relatedId || graphKindLabel(kind)).trim() || graphKindLabel(kind);
    const detail = typeof options.detailResolver === "function"
      ? String(options.detailResolver(entry) || "").trim()
      : related
        ? graphListLabel(related)
        : String(entry?.relation || graphKindLabel(kind)).trim() || graphKindLabel(kind);
    row.dataset.recordId = String(related?.id || entry?.relatedId || "").trim();
    row.dataset.linkedRecordKind = kind;
    row.dataset.linkedRecordId = String(entry?.relatedId || "").trim();
    if (isInteractive) {
      row.type = "button";
      row.dataset.workspaceTargetRoute = target.route;
      row.dataset.workspaceTargetId = target.id;
      row.dataset.workspaceTargetKind = target.kind || kind;
      row.addEventListener("click", () => openWorkspaceTarget(
        target,
        options.fromRoute || state.route || "",
        options.openOptions || {}
      ));
    }
    row.append(lightSmallIcon(graphKindIcon(kind), graphKindAccentKey(kind)), lightTextStack(title, detail));
    if (showChips) {
      row.append(lightLinkedRecordChips(entry));
    }
    if (isInteractive && showChevron) {
      row.append(el("span", "light-chevron", ">"));
    }
    return row;
  }

  function lightLinkedRecordSection(record, options = {}) {
    const title = options.title || "Linked records";
    const showWhenEmpty = options.showWhenEmpty === true;
    const flatFeed = String(options.variant || "").trim().toLowerCase() === "flat";
    const entries = Array.isArray(options.entries)
      ? connectedRecordEntries(options.entries, {
          includeKinds: Array.isArray(options.includeKinds) ? options.includeKinds : [],
          excludeKinds: Array.isArray(options.excludeKinds) ? options.excludeKinds : [],
          dedupeTargets: options.dedupeTargets !== false,
        })
      : workspaceLinkedEntries(record, {
          includeKinds: Array.isArray(options.includeKinds) ? options.includeKinds : [],
          excludeKinds: Array.isArray(options.excludeKinds) ? options.excludeKinds : [],
          dedupeTargets: options.dedupeTargets === true,
        });
    if (!entries.length && !showWhenEmpty) {
      return null;
    }
    const section = el("section", "light-linked-records-section light-feed-section");
    if (flatFeed) {
      section.classList.add("is-flat-feed");
    }
    section.dataset.linkedRecordsTitle = String(title || "Linked records").trim().toLowerCase();
    const header = el("div", "light-feed-section-header");
    header.append(lightSectionTitle(title));
    const body = el("div", "light-linked-record-list light-feed-section-body light-feed-list");
    if (flatFeed) {
      body.classList.add("light-card", "is-flat-feed");
    }
    body.dataset.linkedRecordsCount = String(entries.length);
    if (!entries.length) {
      body.append(el("div", flatFeed ? "light-linked-records-empty-shell is-flat-feed" : "light-card light-linked-records-empty-shell"));
    } else {
      entries.forEach(entry => body.append(lightLinkedRecordFeedRow(entry, {
        fromRoute: options.fromRoute || state.route || "",
        rowClassName: options.rowClassName || "",
        openOptions: options.openOptions || {},
        detailResolver: typeof options.detailResolver === "function" ? options.detailResolver : null,
        showChips: options.showChips !== false,
        showChevron: options.showChevron !== false,
        variant: flatFeed ? "flat" : "",
      })));
    }
    section.append(header, body);
    return section;
  }

  function noteContentUpdatedAtMs(note) {
    const candidates = [
      note?.content_updated_at_ms,
      note?.metadata?.content_updated_at_ms,
      note?.created_at_ms,
      note?.updated_at_ms,
    ];
    for (const candidate of candidates) {
      const value = Number(candidate || 0);
      if (Number.isFinite(value) && value > 0) {
        return value;
      }
    }
    return 0;
  }

  function noteTimestampLabel(note) {
    return workspaceTimestamp(noteContentUpdatedAtMs(note));
  }

  function noteSourceLabel(note) {
    const raw = String(note?.metadata?.context || "").trim();
    const normalized = raw.toLowerCase();
    if (!raw || normalized === "notes" || normalized === "all notes") {
      return "";
    }
    return raw;
  }

  function noteMetaLine(note) {
    return {
      source: noteSourceLabel(note),
      timestamp: noteTimestampLabel(note),
    };
  }

  function linkedRecordRecencyMs(relatedKind, related) {
    const kind = String(relatedKind || "").trim();
    if (!related || typeof related !== "object") {
      return 0;
    }
    if (kind === "note") {
      return noteContentUpdatedAtMs(related);
    }
    const candidates = [
      related?.updated_at_ms,
      related?.created_at_ms,
      related?.event_at_ms,
      related?.start_at_ms,
      related?.due_at_ms,
    ];
    for (const candidate of candidates) {
      const value = Number(candidate || 0);
      if (Number.isFinite(value) && value > 0) {
        return value;
      }
    }
    return 0;
  }

  function noteRecordId(note) {
    return String(note?.id || note?.record_id || "").trim();
  }

  function notePinPending(noteId) {
    return Boolean(state.notePinPending[String(noteId || "").trim()]);
  }

  function setNotePinPending(noteId, pending) {
    const key = String(noteId || "").trim();
    const next = { ...state.notePinPending };
    if (!key) {
      state.notePinPending = next;
      return;
    }
    if (pending) {
      next[key] = true;
    } else {
      delete next[key];
    }
    state.notePinPending = next;
  }

  function notesWithPinnedState(items, noteId, nextPinned) {
    const targetId = String(noteId || "").trim();
    const source = Array.isArray(items) ? items : [];
    const target = source.find(item => noteRecordId(item) === targetId);
    if (!targetId || !target) {
      return source.slice();
    }
    const toggled = { ...target, pinned: nextPinned };
    const pinned = [];
    const recent = [];
    source.forEach(item => {
      if (noteRecordId(item) === targetId) {
        return;
      }
      if (item?.pinned) {
        pinned.push(item);
        return;
      }
      recent.push(item);
    });
    return nextPinned
      ? [toggled, ...pinned, ...recent]
      : [...pinned, toggled, ...recent];
  }

  async function toggleNotePin(note) {
    const noteId = noteRecordId(note);
    if (!noteId || notePinPending(noteId)) {
      return;
    }
    const notesBucket = state.workspace.notes;
    if (!notesBucket || !Array.isArray(notesBucket.items)) {
      return;
    }
    const previousItems = notesBucket.items.slice();
    const previousSectionsExpanded = {
      ...state.notesSectionsExpanded
    };
    const nextPinned = !Boolean(note.pinned);
    notesBucket.error = "";
    setNotesSectionExpanded(nextPinned ? "pinned" : "recent", true);
    notesBucket.items = notesWithPinnedState(previousItems, noteId, nextPinned);
    setNotePinPending(noteId, true);
    render();
    try {
      await patchWorkspaceRecord("notes", noteId, { pinned: nextPinned });
      await loadWorkspaceCollection("notes", { render: true, force: true });
      notesBucket.error = "";
    } catch (error) {
      notesBucket.items = previousItems;
      state.notesSectionsExpanded = previousSectionsExpanded;
      notesBucket.error = "";
      setNotePinPending(noteId, false);
      render();
      showToast(error.message);
      return;
    }
    setNotePinPending(noteId, false);
    render();
  }

  function noteSectionExpanded(sectionKey) {
    return state.notesSectionsExpanded?.[sectionKey] !== false;
  }

  function setNotesSectionExpanded(sectionKey, expanded) {
    state.notesSectionsExpanded = {
      ...state.notesSectionsExpanded,
      [sectionKey]: Boolean(expanded),
    };
  }

  function toggleNotesSection(sectionKey) {
    setNotesSectionExpanded(sectionKey, !noteSectionExpanded(sectionKey));
    render();
  }

  function lightNotesPage() {
    const status = lightWorkspaceStatus("notes", "note", "No notes yet");
    const notes = workspaceItems("notes");
    const pinned = notes.filter(note => note.pinned);
    const sections = [];
    if (pinned.length) {
      sections.push(lightNotesSection("Pinned", "pinned", pinned));
    }
    sections.push(lightNotesSection("Recent", "recent", notes.filter(note => !note.pinned)));
    return renderUniversalFeedPage({
      title: "Notes",
      surface: "notes",
      pageClassName: "light-notes-page",
      surfaceClassName: "light-notes-feed",
      status,
      sections,
    });
  }

  function lightNotesSectionHeader(title, sectionKey, count, expanded, controlsId) {
    const button = el("button", "light-feed-section-header light-notes-section-header");
    button.type = "button";
    button.dataset.notesSection = sectionKey;
    button.setAttribute("aria-expanded", String(expanded));
    button.setAttribute("aria-controls", controlsId);
    button.addEventListener("click", event => {
      event.preventDefault();
      event.stopPropagation();
      toggleNotesSection(sectionKey);
    });
    const copy = el("span", "light-notes-section-copy");
    copy.append(
      el("span", "light-notes-section-label", String(title).toUpperCase()),
      el("span", "light-notes-section-count", String(count))
    );
    const chevron = el("span", "light-notes-section-chevron");
    chevron.innerHTML = iconSvg(expanded ? "expand_more" : "chevron_right");
    button.append(copy, chevron);
    return button;
  }

  function lightNotesSection(title, sectionKey, notes) {
    return {
      key: sectionKey,
      label: title,
      count: notes.length,
      collapsible: true,
      expanded: noteSectionExpanded(sectionKey),
      emptyState: null,
      items: notes.map(note => universalNoteFeedTileDescriptor(note, sectionKey))
    };
  }

  function lightNoteRow(note) {
    const row = el("div", "light-feed-row light-note-row");
    const noteId = noteRecordId(note);
    row.setAttribute("role", "button");
    row.tabIndex = 0;
    row.setAttribute("aria-label", note.title || "Open note");
    row.dataset.noteId = noteId;
    row.dataset.notePinned = String(Boolean(note.pinned));
    row.addEventListener("pointerdown", () => {
      noteFlashDebugRecord("note_row_pointerdown", {
        selected_note_id: noteId,
        reason: "pointerdown"
      });
    });
    const openNote = () => {
      if (!noteId) {
        return;
      }
      noteFlashDebugRecord("note_row_click", {
        selected_note_id: noteId,
        reason: "open_note"
      });
      state.selectedNoteId = noteId;
      lightNavigate("note-detail", { from: "notes" });
    };
    row.addEventListener("click", openNote);
    row.addEventListener("keydown", event => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        openNote();
      }
    });
    const meta = noteMetaLine(note);
    const copy = el("span", "light-note-feed-copy");
    copy.append(el("strong", "", note.title || "Untitled note"));
    const metaRow = el("span", "light-note-row-meta");
    if (meta.source) {
      metaRow.append(el("span", "light-note-row-context", meta.source));
    } else {
      metaRow.classList.add("is-time-only");
    }
    metaRow.append(el("span", "light-note-row-time", meta.timestamp));
    copy.append(metaRow);
    row.dataset.noteHasSource = String(Boolean(meta.source));
    const pin = el("button", "light-note-pin-button");
    pin.type = "button";
    pin.disabled = notePinPending(noteId);
    pin.dataset.notePinned = String(Boolean(note.pinned));
    pin.setAttribute("aria-label", note.pinned ? "Unpin note" : "Pin note");
    pin.addEventListener("click", event => {
      event.preventDefault();
      event.stopPropagation();
      void toggleNotePin(note);
    });
    pin.addEventListener("keydown", event => {
      if (event.key === "Enter" || event.key === " ") {
        event.stopPropagation();
      }
    });
    pin.innerHTML = iconSvg("pin", { filled: Boolean(note.pinned) });
    row.append(copy, pin);
    return row;
  }

  function lightNoteDetailPage() {
    const note = selectedNote();
    if (!note) {
      return lightPage("Note", { subtitle: "Note not found.", detail: true });
    }
    const page = lightPage(note.title || "Untitled note", { detail: true, htmlDetail: true });
    page.classList.add("light-document-page", "light-note-document", "light-note-detail-page");
    noteFlashDebugRecord("note_detail_page_created", {
      selected_note_id: noteRecordId(note),
      reason: "lightNoteDetailPage"
    });
    page.append(lightHtmlDocument(note, "No generated note page yet.", {
      untitledFallback: true,
      className: "light-detail-html-body light-note-detail-html-body",
      fullBleed: true,
      revealOnLoad: "note",
      noteFlashDebug: true
    }));
    return page;
  }

  function lightTasksPage() {
    if (taskUsesSplitLayout()) {
      return lightTaskWorkspacePage();
    }
    const page = lightPage(taskPageTitle(), { action: taskPageHeaderAction() });
    page.classList.add("light-tasks-page");
    const status = lightWorkspaceStatus("tasks", "checklist", "No tasks yet");
    if (status) {
      page.append(status);
      return page;
    }
    renderTaskGroups(page);
    page.append(lightTaskBulkActionBar());
    return page;
  }

  function lightTaskSectionHeader(label, group, count) {
    const expanded = taskSectionExpanded(group);
    const toggle = el("button", expanded ? "light-task-section-toggle is-expanded" : "light-task-section-toggle");
    toggle.type = "button";
    toggle.dataset.taskSection = group;
    toggle.setAttribute("aria-expanded", expanded ? "true" : "false");
    toggle.setAttribute("aria-label", `${expanded ? "Collapse" : "Expand"} ${label.toLowerCase()} tasks`);
    const chevron = el("span", "light-small-icon-button light-task-section-chevron");
    chevron.innerHTML = iconSvg(expanded ? "expand_more" : "navigate_next");
    toggle.append(
      el("h3", "light-task-section-title", label),
      el("span", "light-task-section-spacer"),
      el("span", "light-task-section-count", `${count}`),
      chevron
    );
    toggle.addEventListener("click", () => toggleTaskSection(group));
    return toggle;
  }

  function taskSectionExpanded(group) {
    const sections = state.taskSectionsExpanded || {};
    if (typeof sections[group] === "boolean") return sections[group];
    return group !== "done";
  }

  function initialTaskSectionsExpanded(value) {
    const source = value && typeof value === "object" ? value : {};
    return {
      overdue: typeof source.overdue === "boolean" ? source.overdue : true,
      do: typeof source.do === "boolean" ? source.do : true,
      soon: typeof source.soon === "boolean" ? source.soon : true,
      done: typeof source.done === "boolean" ? source.done : false,
    };
  }

  function toggleTaskSection(group) {
    state.taskSectionsExpanded = {
      overdue: taskSectionExpanded("overdue"),
      do: taskSectionExpanded("do"),
      soon: taskSectionExpanded("soon"),
      done: taskSectionExpanded("done"),
      [group]: !taskSectionExpanded(group)
    };
    render();
  }

  function taskStatusLabel(status) {
    const value = String(status || "").trim();
    return ({
      todo: "To do",
      in_progress: "In progress",
      waiting: "Waiting",
      done: "Done",
    })[value] || "To do";
  }

  function normalizedTaskStatus(task) {
    const raw = String(task?.status || "").trim().toLowerCase();
    if (!raw || raw === "open") return "todo";
    if (raw === "in-progress" || raw === "in progress") return "in_progress";
    if (raw === "blocked") return "waiting";
    return ["todo", "in_progress", "waiting", "done"].includes(raw) ? raw : "todo";
  }

  function taskStatusSelectorChoices() {
    return ["todo", "in_progress", "waiting", "done"].map(value => {
      const leadingNode = el("span", taskStatusCircleClass(value));
      leadingNode.setAttribute("aria-hidden", "true");
      return {
        value,
        label: taskStatusLabel(value),
        leadingNode,
      };
    });
  }

  function taskMutationKey(taskId, scope) {
    return `${String(taskId || "").trim()}::${String(scope || "").trim()}`;
  }

  function taskMutationPending(taskId, scope) {
    return Boolean(state.taskMutationPending[taskMutationKey(taskId, scope)]);
  }

  function setTaskMutationPending(taskId, scope, pending) {
    const key = taskMutationKey(taskId, scope);
    const next = { ...state.taskMutationPending };
    if (!String(taskId || "").trim() || !String(scope || "").trim()) {
      state.taskMutationPending = next;
      return;
    }
    if (pending) {
      next[key] = true;
    } else {
      delete next[key];
    }
    state.taskMutationPending = next;
  }

  function mergeTaskRecordIntoBucket(record) {
    const bucket = state.workspace.tasks;
    const nextId = taskRecordId(record);
    if (!bucket || !Array.isArray(bucket.items) || !nextId) {
      return;
    }
    if (Boolean(record?.archived) || Boolean(record?.deleted)) {
      bucket.items = bucket.items.filter(item => taskRecordId(item) !== nextId);
      return;
    }
    let replaced = false;
    bucket.items = bucket.items.map(item => {
      if (taskRecordId(item) !== nextId) {
        return item;
      }
      replaced = true;
      return record;
    });
    if (!replaced) {
      bucket.items.push(record);
    }
  }

  async function updateTaskStatus(taskId, nextStatus) {
    const id = String(taskId || "").trim();
    const status = String(nextStatus || "").trim();
    const bucket = state.workspace.tasks;
    if (!id || !["todo", "in_progress", "waiting", "done"].includes(status) || !bucket || !Array.isArray(bucket.items)) {
      return;
    }
    const current = bucket.items.find(item => taskRecordId(item) === id);
    if (!current || normalizedTaskStatus(current) === status) {
      return;
    }
    try {
      const result = await patchWorkspaceRecord("tasks", id, { status });
      mergeTaskRecordIntoBucket(result);
      state.selectedTaskId = taskRecordId(result) || id;
      bucket.error = "";
      persistNavState();
      render();
      markWorkspaceBucketDirty("tasks", { refresh: true, reason: "task_status_update" });
    } catch (error) {
      bucket.error = "";
      showToast(error.message);
    }
  }

  async function toggleTaskChecklistItem(task, itemId) {
    const taskId = taskRecordId(task);
    const checklistItemId = String(itemId || "").trim();
    const bucket = state.workspace.tasks;
    if (!taskId || !checklistItemId || !bucket || !Array.isArray(bucket.items) || taskMutationPending(taskId, checklistItemId)) {
      return null;
    }
    const current = bucket.items.find(item => taskRecordId(item) === taskId) || task;
    if (!current) {
      return null;
    }
    const checklist = taskChecklist(current);
    const target = checklist.find(item => String(item?.id || "").trim() === checklistItemId);
    if (!target) {
      return null;
    }
    const nextChecklist = checklist.map(item => {
      if (String(item?.id || "").trim() !== checklistItemId) {
        return item;
      }
      return {
        ...item,
        done: !Boolean(item?.done),
      };
    });
    const previousAllDone = checklist.length > 0 && checklist.every(item => Boolean(item?.done));
    const nextAllDone = nextChecklist.length > 0 && nextChecklist.every(item => Boolean(item?.done));
    const currentStatus = normalizedTaskStatus(current);
    const nextStatus = nextAllDone ? "done" : (previousAllDone ? "in_progress" : "");
    const optimisticStatus = nextStatus || currentStatus;
    const optimisticDerivedGroup = (() => {
      if (optimisticStatus === "done") {
        return "done";
      }
      const dueAtMs = Number(current?.due_at_ms || 0);
      const nowMs = Date.now();
      if (Number.isFinite(dueAtMs) && dueAtMs > 0) {
        if (dueAtMs < nowMs) {
          return "overdue";
        }
        if (dueAtMs <= nowMs + 24 * 60 * 60 * 1000) {
          return "do";
        }
        return "soon";
      }
      return "do";
    })();
    const payload = nextStatus ? { checklist: nextChecklist, status: nextStatus } : { checklist: nextChecklist };
    const previousItems = bucket.items.slice();
    const optimistic = {
      ...current,
      status: optimisticStatus,
      derived_group: optimisticDerivedGroup,
      checklist: nextChecklist,
      metadata: {
        ...(current?.metadata || {}),
        checklist: nextChecklist,
        status: optimisticStatus,
      },
    };
    setTaskMutationPending(taskId, checklistItemId, true);
    bucket.items = bucket.items.map(item => taskRecordId(item) === taskId ? optimistic : item);
    bucket.error = "";
    render();
    try {
      const result = await patchWorkspaceRecord("tasks", taskId, payload);
      mergeTaskRecordIntoBucket(result);
      state.selectedTaskId = taskRecordId(result) || taskId;
      persistNavState();
      markWorkspaceBucketDirty("tasks", { refresh: true, reason: "task_checklist_toggle" });
      return result;
    } catch (error) {
      bucket.items = previousItems;
      bucket.error = "";
      showToast(error.message);
      return null;
    } finally {
      setTaskMutationPending(taskId, checklistItemId, false);
      render();
    }
  }

  function openTaskStatusSelector(task, source) {
    const taskId = taskRecordId(task);
    const current = normalizedTaskStatus(task);
    if (!taskId) {
      return;
    }
    openSettingsSelector({
      title: source === "list" ? "Update task status" : "Task status",
      currentValue: current,
      options: taskStatusSelectorChoices(),
      onSelect: value => {
        const nextStatus = String(value || "").trim();
        void updateTaskStatus(taskId, nextStatus);
      },
    });
  }

  function taskSelectionModeActive() {
    return state.taskSelectionMode === true;
  }

  function clearTaskSelection() {
    state.taskSelectionMode = false;
    state.selectedTaskIds = new Set();
  }

  function selectedTaskIdsSet() {
    return state.selectedTaskIds instanceof Set ? state.selectedTaskIds : new Set();
  }

  function selectedTaskCount() {
    return selectedTaskIdsSet().size;
  }

  function taskSelected(task) {
    return selectedTaskIdsSet().has(taskRecordId(task));
  }

  function taskPageTitle() {
    return taskSelectionModeActive() ? "Select tasks" : "Tasks";
  }

  function taskPageHeaderAction() {
    if (!workspaceItems("tasks").length) {
      return el("div", "light-nav-slot");
    }
    const button = el(
      "button",
      "light-page-header-action light-task-select-toggle",
      taskSelectionModeActive() ? "Cancel" : "Select"
    );
    button.type = "button";
    button.addEventListener("click", event => {
      event.preventDefault();
      if (taskSelectionModeActive()) {
        clearTaskSelection();
      } else {
        state.taskSelectionMode = true;
        state.selectedTaskIds = new Set();
      }
      render();
    });
    return button;
  }

  function lightTaskRowStatusTrigger(task) {
    const statusTrigger = el("button", "light-task-row-status-trigger");
    statusTrigger.type = "button";
    statusTrigger.dataset.taskStatusTrigger = "true";
    statusTrigger.setAttribute("aria-label", `Change task status for ${task.title || "task"}`);
    statusTrigger.append(el("span", taskCheckCircleClass(task)));
    statusTrigger.addEventListener("click", event => {
      event.preventDefault();
      event.stopPropagation();
      openTaskStatusSelector(task, "list");
    });
    return statusTrigger;
  }

  function lightTaskSelectionControl(task) {
    const selected = taskSelected(task);
    const trigger = el("button", selected ? "light-task-selection-trigger is-selected" : "light-task-selection-trigger");
    trigger.type = "button";
    trigger.setAttribute("aria-label", selected ? `Unselect ${task.title || "task"}` : `Select ${task.title || "task"}`);
    trigger.setAttribute("aria-pressed", selected ? "true" : "false");
    trigger.append(el("span", selected ? "light-check-circle done" : "light-check-circle"));
    trigger.addEventListener("click", event => {
      event.preventDefault();
      event.stopPropagation();
      toggleTaskSelection(task);
    });
    return trigger;
  }

  function toggleTaskSelection(task) {
    const taskId = taskRecordId(task);
    if (!taskId) {
      return;
    }
    const next = new Set(selectedTaskIdsSet());
    if (next.has(taskId)) {
      next.delete(taskId);
    } else {
      next.add(taskId);
    }
    state.taskSelectionMode = true;
    state.selectedTaskIds = next;
    render();
  }

  function lightTaskBulkActionBar() {
    if (!taskSelectionModeActive()) {
      return document.createDocumentFragment();
    }
    const count = selectedTaskCount();
    const bar = el("div", "light-task-bulk-bar");
    bar.append(el("span", "light-task-bulk-count", `${count} selected`));
    const archive = el("button", "light-task-bulk-archive", "Archive");
    archive.type = "button";
    archive.disabled = count === 0 || state.taskBulkArchivePending;
    archive.addEventListener("click", event => {
      event.preventDefault();
      void archiveSelectedTasks();
    });
    bar.append(archive);
    return bar;
  }

  async function archiveSelectedTasks() {
    const bucket = state.workspace.tasks;
    const selectedIds = Array.from(selectedTaskIdsSet());
    if (!bucket || !Array.isArray(bucket.items) || !selectedIds.length || state.taskBulkArchivePending) {
      return;
    }
    const previousItems = bucket.items.slice();
    state.taskBulkArchivePending = true;
    bucket.items = bucket.items.filter(item => !selectedIds.includes(taskRecordId(item)));
    if (selectedIds.includes(state.selectedTaskId)) {
      state.selectedTaskId = taskRecordId(bucket.items[0]) || "";
    }
    render();
    try {
      for (const taskId of selectedIds) {
        const result = await patchWorkspaceRecord("tasks", taskId, { archived: true });
        mergeTaskRecordIntoBucket(result);
      }
      clearTaskSelection();
      persistNavState();
    } catch (error) {
      bucket.items = previousItems;
      showToast(error.message);
    } finally {
      state.taskBulkArchivePending = false;
      render();
    }
  }

  function lightTaskDetailActionButton(task) {
    const actionButton = el("button", "light-task-detail-action-trigger");
    actionButton.type = "button";
    actionButton.setAttribute("aria-label", "Task actions");
    actionButton.innerHTML = iconSvg("more_horiz", { filled: true });
    actionButton.addEventListener("click", event => {
      event.preventDefault();
      event.stopPropagation();
      openTaskActions(task);
    });
    return actionButton;
  }

  function openTaskActions(task) {
    openSettingsSelector({
      title: "Task actions",
      currentValue: "",
      options: [
        {
          value: "archive_task",
          label: "Archive task",
        },
      ],
      onSelect: value => {
        if (String(value || "") === "archive_task") {
          void archiveTask(task, { fromDetail: true });
        }
      },
    });
  }

  async function archiveTask(task, options = {}) {
    const taskId = taskRecordId(task);
    const bucket = state.workspace.tasks;
    if (!taskId || !bucket || !Array.isArray(bucket.items) || taskMutationPending(taskId, "archive")) {
      return null;
    }
    const previousItems = bucket.items.slice();
    setTaskMutationPending(taskId, "archive", true);
    bucket.items = bucket.items.filter(item => taskRecordId(item) !== taskId);
    if (state.selectedTaskId === taskId) {
      state.selectedTaskId = taskRecordId(bucket.items[0]) || "";
    }
    render();
    try {
      const result = await patchWorkspaceRecord("tasks", taskId, { archived: true });
      mergeTaskRecordIntoBucket(result);
      clearTaskSelection();
      if (options.fromDetail && !taskUsesSplitLayout()) {
        state.route = "tasks";
        state.previousLightRoute = "tasks";
        state.lightReturnRoute = "home";
      }
      persistNavState();
      return result;
    } catch (error) {
      bucket.items = previousItems;
      showToast(error.message);
      return null;
    } finally {
      setTaskMutationPending(taskId, "archive", false);
      render();
    }
  }

  function reminderRecordId(reminder) {
    return String(reminder?.id || reminder?.record_id || "").trim();
  }

  function reminderById(reminderId, fallback = null) {
    const normalizedReminderId = String(reminderId || "").trim();
    if (!normalizedReminderId) {
      return fallback;
    }
    return workspaceItems("reminders").find(reminder => reminderRecordId(reminder) === normalizedReminderId) || fallback;
  }

  function unwrapReminderRecordResponse(payload) {
    const reminder = payload && typeof payload === "object" && payload.reminder && typeof payload.reminder === "object"
      ? payload.reminder
      : payload;
    return reminder && typeof reminder === "object" ? reminder : null;
  }

  function replaceReminderInItems(items, nextReminder) {
    const normalizedReminderId = reminderRecordId(nextReminder);
    const source = Array.isArray(items) ? items : [];
    if (!normalizedReminderId) {
      return source.slice();
    }
    return source.map(reminder => reminderRecordId(reminder) === normalizedReminderId ? nextReminder : reminder);
  }

  function reminderMutationKey(reminderId, scope) {
    return `${String(reminderId || "").trim()}::${String(scope || "").trim()}`;
  }

  function reminderMutationPending(reminderId, scope) {
    return Boolean(state.reminderMutationPending[reminderMutationKey(reminderId, scope)]);
  }

  function reminderHasPendingMutation(reminderId) {
    const normalizedReminderId = String(reminderId || "").trim();
    if (!normalizedReminderId) {
      return false;
    }
    return Object.keys(state.reminderMutationPending).some(key => key.startsWith(`${normalizedReminderId}::`));
  }

  function setReminderMutationPending(reminderId, scope, pending) {
    const key = reminderMutationKey(reminderId, scope);
    const next = { ...state.reminderMutationPending };
    if (!String(reminderId || "").trim() || !String(scope || "").trim()) {
      state.reminderMutationPending = next;
      return;
    }
    if (pending) {
      next[key] = true;
    } else {
      delete next[key];
    }
    state.reminderMutationPending = next;
  }

  async function applyReminderMutation(reminderId, scope, optimisticReminder, patchPayload) {
    const normalizedReminderId = String(reminderId || "").trim();
    const normalizedScope = String(scope || "").trim();
    const remindersBucket = state.workspace.reminders;
    if (!normalizedReminderId || !normalizedScope || !remindersBucket || !Array.isArray(remindersBucket.items)) {
      return null;
    }
    if (reminderMutationPending(normalizedReminderId, normalizedScope)) {
      return null;
    }
    const previousItems = remindersBucket.items.slice();
    setReminderMutationPending(normalizedReminderId, normalizedScope, true);
    remindersBucket.items = replaceReminderInItems(previousItems, optimisticReminder);
    render();
    try {
      const response = await patchWorkspaceRecord("reminders", normalizedReminderId, patchPayload);
      const nextReminder = unwrapReminderRecordResponse(response);
      if (nextReminder && reminderRecordId(nextReminder) === normalizedReminderId) {
        remindersBucket.items = replaceReminderInItems(remindersBucket.items, nextReminder);
      }
      markWorkspaceBucketDirty("reminders", { refresh: true, reason: `reminder_${normalizedScope}` });
      return nextReminder;
    } catch (error) {
      remindersBucket.items = previousItems;
      showToast(error.message);
      return null;
    } finally {
      setReminderMutationPending(normalizedReminderId, normalizedScope, false);
      render();
    }
  }

  function reminderWithDoneStatus(reminder) {
    return {
      ...reminder,
      status: "done",
      metadata: {
        ...(reminder?.metadata || {}),
        snoozed_until_ms: 0,
      },
    };
  }

  function reminderWithSnooze(reminder, dueAtMs) {
    return {
      ...reminder,
      due_at_ms: dueAtMs,
      metadata: {
        ...(reminder?.metadata || {}),
        delivery_state: "pending",
        last_fired_at_ms: 0,
        last_fired_due_at_ms: 0,
        last_delivery_error: "",
        snoozed_until_ms: dueAtMs,
      },
    };
  }

  async function markReminderDone(reminder) {
    const currentReminder = reminderById(reminderRecordId(reminder), reminder);
    const normalizedReminderId = reminderRecordId(currentReminder);
    if (!currentReminder || !normalizedReminderId || reminderHasPendingMutation(normalizedReminderId) || reminderIsDismissed(currentReminder)) {
      return null;
    }
    const optimisticReminder = reminderWithDoneStatus(currentReminder);
    const nextReminder = await applyReminderMutation(normalizedReminderId, "done", optimisticReminder, { status: "done" });
    if (nextReminder && state.route === "reminder-detail") {
      lightNavigate("reminders", {
        from: "reminder-detail",
        replaceHistory: true,
        selectionPatch: { selectedReminderId: "" },
      });
    }
    return nextReminder;
  }

  async function dismissReminder(reminder) {
    return markReminderDone(reminder);
  }

  function reminderSnoozePresetTimestamp(preset, nowMs = Date.now()) {
    const base = Number(nowMs || 0) > 0 ? Number(nowMs) : Date.now();
    const normalizedPreset = String(preset || "").trim();
    if (normalizedPreset === "1_hour") {
      return base + 60 * 60 * 1000;
    }
    if (normalizedPreset === "this_evening") {
      const target = new Date(base);
      target.setHours(18, 0, 0, 0);
      if (target.getTime() <= base + 60_000) {
        target.setDate(target.getDate() + 1);
      }
      return target.getTime();
    }
    if (normalizedPreset === "tomorrow_morning") {
      const target = new Date(base);
      target.setDate(target.getDate() + 1);
      target.setHours(9, 0, 0, 0);
      return target.getTime();
    }
    return base + 10 * 60 * 1000;
  }

  function reminderSnoozePresetMetaLabel(timestampMs) {
    const value = Number(timestampMs || 0);
    if (!Number.isFinite(value) || value <= 0) {
      return "";
    }
    const date = new Date(value);
    const time = date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    const key = dateKey(date);
    if (key === todayDateKey()) {
      return `Today${DOT}${time}`;
    }
    if (key === todayDateKey(1)) {
      return `Tomorrow${DOT}${time}`;
    }
    return date.toLocaleString([], {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit"
    });
  }

  function reminderSnoozePresets(nowMs = Date.now()) {
    return [
      { value: "1_hour", label: "1 hour" },
      { value: "this_evening", label: "This evening" },
      { value: "tomorrow_morning", label: "Tomorrow morning" },
    ].map(option => {
      const timestampMs = reminderSnoozePresetTimestamp(option.value, nowMs);
      return {
        ...option,
        timestampMs,
        meta: reminderSnoozePresetMetaLabel(timestampMs),
      };
    });
  }

  async function snoozeReminder(reminder, dueAtMs) {
    const currentReminder = reminderById(reminderRecordId(reminder), reminder);
    const normalizedReminderId = reminderRecordId(currentReminder);
    const nextDueAtMs = Math.max(Date.now() + 60_000, Number(dueAtMs || 0));
    if (!currentReminder || !normalizedReminderId || reminderHasPendingMutation(normalizedReminderId) || !Number.isFinite(nextDueAtMs)) {
      return null;
    }
    const optimisticReminder = reminderWithSnooze(currentReminder, nextDueAtMs);
    return applyReminderMutation(normalizedReminderId, "snooze", optimisticReminder, {
      due_at_ms: nextDueAtMs,
      metadata: {
        snoozed_until_ms: nextDueAtMs,
        delivery_state: "pending",
        last_fired_at_ms: 0,
        last_fired_due_at_ms: 0,
        last_delivery_error: "",
      },
    });
  }

  function openReminderSnoozeSelector(reminder) {
    const currentReminder = reminderById(reminderRecordId(reminder), reminder);
    const currentReminderId = reminderRecordId(currentReminder);
    if (!currentReminder || !currentReminderId || reminderHasPendingMutation(currentReminderId)) {
      return;
    }
    const options = reminderSnoozePresets();
    openSettingsSelector({
      title: "Snooze reminder",
      currentValue: "",
      options: options.map(option => ({
        value: option.value,
        label: option.label,
        meta: option.meta,
      })),
      onSelect: value => {
        const selected = options.find(option => option.value === String(value || "").trim());
        if (!selected) {
          return;
        }
        void snoozeReminder(reminderById(currentReminderId, currentReminder), selected.timestampMs);
      },
    });
  }

  function lightTaskGroup(tasks, group) {
    const card = el("div", "light-card light-task-card light-task-group");
    tasks.forEach(task => {
      const selectionMode = taskSelectionModeActive();
      const selected = taskSelected(task);
      const row = el("div", `light-task-row ${taskRowTone(task)}`);
      row.dataset.taskId = task.id;
      row.dataset.taskStatus = normalizedTaskStatus(task);
      row.dataset.taskSelected = selected ? "true" : "false";
      if (selected) {
        row.classList.add("is-selected");
      }
      const leading = selectionMode ? lightTaskSelectionControl(task) : lightTaskRowStatusTrigger(task);
      const main = el("button", "light-task-row-main");
      main.type = "button";
      main.setAttribute("aria-pressed", selectionMode && selected ? "true" : "false");
      main.addEventListener("pointerdown", () => row.classList.add("is-pressed"));
      main.addEventListener("pointerup", () => row.classList.remove("is-pressed"));
      main.addEventListener("pointercancel", () => row.classList.remove("is-pressed"));
      main.addEventListener("blur", () => row.classList.remove("is-pressed"));
      main.addEventListener("click", () => {
        if (selectionMode) {
          void toggleTaskSelection(task);
          return;
        }
        openTaskFromList(task);
      });
      const copy = el("span", "light-task-row-copy");
      copy.append(el("strong", "light-task-row-title", task.title || "Untitled task"));
      const trailing = el("span", "light-task-row-trailing");
      const badge = lightTaskStatusBadge(normalizedTaskStatus(task), { compact: true });
      if (badge) {
        trailing.append(badge);
      }
      trailing.append(el("span", "light-due", taskDueLabel(task)));
      main.append(copy, trailing);
      row.append(leading, main);
      card.append(row);
    });
    return card;
  }

  function taskCheckCircleClass(task) {
    const classes = ["light-check-circle"];
    const tone = taskRowTone(task);
    if (tone !== "todo") {
      classes.push(tone);
    }
    return classes.join(" ");
  }

  function taskStatusCircleClass(status) {
    const classes = ["light-check-circle"];
    const normalized = String(status || "").trim();
    if (normalized && normalized !== "todo") {
      classes.push(normalized);
    }
    return classes.join(" ");
  }

  function taskRowTone(task) {
    const status = normalizedTaskStatus(task);
    if (status === "done") {
      return "done";
    }
    if (String(task?.derived_group || "") === "overdue") {
      return "overdue";
    }
    return status;
  }

  function taskDescription(task) {
    return String(task?.description || task?.summary || task?.metadata?.description || "").trim();
  }

  function taskChecklist(task) {
    return Array.isArray(task?.checklist) ? task.checklist : [];
  }

  function taskRecordId(task) {
    return String(task?.id || task?.record_id || "").trim();
  }

  function lightTaskStatusBadge(status, options = {}) {
    const value = String(status || "").trim();
    if (!["in_progress", "waiting", "done"].includes(value)) {
      return null;
    }
    const className = options.compact
      ? `light-task-status-badge ${value} is-compact`
      : `light-task-status-badge ${value}`;
    return el("span", className, taskStatusLabel(value));
  }

  function openTaskFromList(task) {
    state.selectedTaskId = task.id;
    if (taskUsesSplitLayout()) {
      state.route = "tasks";
      state.previousLightRoute = "tasks";
      persistNavState();
      render();
      return;
    }
    lightNavigate("task-detail", { from: "tasks" });
  }

  function taskDueLabel(task) {
    const group = String(task?.derived_group || "do");
    const due = Number(task?.due_at_ms || 0);
    if (normalizedTaskStatus(task) === "done") {
      return "Done";
    }
    if (!Number.isFinite(due) || due <= 0) {
      return "No due";
    }
    const date = new Date(due);
    const time = date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    const day = dateKey(date);
    if (group === "overdue") {
      return `${workspaceTimestamp(due, "overdue")}`;
    }
    if (day === todayDateKey()) {
      return time;
    }
    if (day === todayDateKey(1)) {
      return time;
    }
    return date.toLocaleDateString([], { month: "short", day: "numeric" });
  }

  function taskDateTimeLabel(timestampMs, fallback) {
    const value = Number(timestampMs || 0);
    if (!Number.isFinite(value) || value <= 0) {
      return fallback;
    }
    return new Date(value).toLocaleString([], {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit"
    });
  }

  function taskConnectedRows(task) {
    const seen = new Set();
    const rows = [];
    const origin = { taskId: taskRecordId(task), route: taskDetailReturnRoute() };
    workspaceLinkedEntries(task, { currentKind: "task" }).forEach(entry => {
      const target = entry.target;
      const key = target?.kind && target?.id
        ? `${target.kind}:${target.id}`
        : `${entry.relatedKind}:${entry.relatedId}`;
      if (!target || seen.has(key)) {
        return;
      }
      seen.add(key);
      const recencyMs = linkedRecordRecencyMs(entry.relatedKind, entry.related);
      const value = entry.relatedKind === "note"
        ? String(entry.related?.summary || entry.relation || "Note").trim() || "Note"
        : connectedRecordValue(entry.relatedKind, entry.related, entry.relation, { preferSummary: true });
      rows.push({
        icon: graphKindIcon(entry.relatedKind),
        accentKey: graphKindAccentKey(entry.relatedKind),
        label: String(entry.label || graphKindLabel(entry.relatedKind)).trim() || graphKindLabel(entry.relatedKind),
        value,
        target,
        kind: entry.relatedKind,
        recencyMs,
        fromRoute: origin.route,
        openOptions: { taskOrigin: origin },
        dataset: {
          taskConnectedKind: entry.relatedKind,
          taskConnectedRecencyMs: String(recencyMs || 0),
        },
      });
    });
    rows.sort((left, right) => {
      const recencyDelta = Number(right.recencyMs || 0) - Number(left.recencyMs || 0);
      if (recencyDelta !== 0) {
        return recencyDelta;
      }
      const kindDelta = String(left.kind || "").localeCompare(String(right.kind || ""));
      if (kindDelta !== 0) {
        return kindDelta;
      }
      return String(left.label || "").localeCompare(String(right.label || ""));
    });
    return rows;
  }

  function lightTaskChecklistSection(task) {
    const items = taskChecklist(task);
    if (!items.length) {
      return null;
    }
    const section = el("section", "light-info-section");
    section.append(lightSectionTitle("Checklist"));
    const card = el("div", "light-card light-task-checklist-card");
    items.forEach(item => {
      const row = el("button", item.done ? "light-task-checklist-row is-done" : "light-task-checklist-row");
      row.type = "button";
      row.dataset.checklistItemId = String(item.id || "");
      row.dataset.checklistDone = item.done ? "true" : "false";
      row.setAttribute("aria-pressed", item.done ? "true" : "false");
      row.disabled = taskMutationPending(taskRecordId(task), item.id);
      row.append(
        el("span", item.done ? "light-check-circle done" : "light-check-circle"),
        el("span", "light-task-checklist-label", String(item.label || "Checklist item"))
      );
      row.addEventListener("click", event => {
        event.preventDefault();
        void toggleTaskChecklistItem(task, item.id);
      });
      card.append(row);
    });
    section.append(card);
    return section;
  }

  function lightTaskConnectedSection(task) {
    const rows = taskConnectedRows(task);
    if (!rows.length) {
      return null;
    }
    return lightInfoSection("Connected", rows, { showTrailingChevron: false });
  }

  function lightChipIcon(icon, accentKey = "") {
    const wrap = el("span", "light-record-chip-icon");
    applySemanticIconAccent(wrap, accentKey, { propertyName: "color", allowEmpty: true });
    wrap.innerHTML = iconSvg(icon, { filled: false });
    return wrap;
  }

  function resetLightRouteScroll() {
    const restore = () => {
      const feed = document.getElementById("feed");
      restoreScrollPosition(feed, 0);
      if (feed) {
        feed.scrollTop = 0;
      }
      if (typeof window !== "undefined") {
        window.scrollTo(0, 0);
      }
      if (document?.documentElement) {
        document.documentElement.scrollTop = 0;
      }
      if (document?.body) {
        document.body.scrollTop = 0;
      }
    };
    state.feedScrollTop = 0;
    restore();
    if (typeof window !== "undefined" && typeof window.requestAnimationFrame === "function") {
      window.requestAnimationFrame(restore);
    }
    window.setTimeout(restore, 0);
    window.setTimeout(restore, 48);
  }

  function lightTaskDetailCard(task) {
    const current = normalizedTaskStatus(task);
    const card = el("button", `light-card light-task-detail-card ${taskRowTone(task)}`);
    card.type = "button";
    card.dataset.taskStatusTrigger = "true";
    card.dataset.taskStatus = current;
    card.dataset.taskStatusLabel = taskStatusLabel(current);
    card.setAttribute("aria-haspopup", "dialog");
    card.setAttribute("aria-label", `Change task status for ${task.title || "task"}. Current status ${taskStatusLabel(current)}.`);
    card.addEventListener("click", event => {
      event.preventDefault();
      event.stopPropagation();
      openTaskStatusSelector(task, "detail-header");
    });
    const statusCircle = el("span", "light-task-status-circle");
    statusCircle.setAttribute("aria-hidden", "true");
    statusCircle.append(el("span", taskCheckCircleClass(task)));
    const createdAt = Number(task?.created_at_ms || 0);
    const completedAt = Number(task?.completed_at_ms || 0);
    const headerMetaPrefix = current === "done" ? "Completed" : "Created";
    const headerMetaAt = current === "done" ? (completedAt > 0 ? completedAt : createdAt) : createdAt;
    const copy = el("div", "light-task-detail-copy");
    copy.append(
      el("strong", "light-task-detail-title", task.title || "Untitled task"),
      el("span", "light-task-detail-due", taskDueLabel(task))
    );
    if (Number.isFinite(headerMetaAt) && headerMetaAt > 0) {
      copy.append(el("span", "light-task-detail-created", `${headerMetaPrefix} ${taskDateTimeLabel(headerMetaAt, "")}`));
    }
    card.append(statusCircle, copy);
    return card;
  }

  function lightTaskDetailSurface(task) {
    const surface = el("div", "light-task-detail-surface");
    surface.dataset.taskDetailId = String(task?.id || "");
    surface.dataset.taskStatus = normalizedTaskStatus(task);
    const header = el("div", "light-task-detail-header");
    header.append(lightTaskDetailCard(task), lightTaskDetailActionButton(task));
    surface.append(header);
    const description = taskDescription(task);
    if (description) {
      surface.append(lightCopySection("Description", description));
    }
    const checklist = lightTaskChecklistSection(task);
    if (checklist) {
      surface.append(checklist);
    }
    const connected = lightTaskConnectedSection(task);
    if (connected) {
      surface.append(connected);
    }
    return surface;
  }

  function renderTaskGroups(container) {
    [
      ["do", "Today"],
      ["overdue", "Overdue"],
      ["soon", "Upcoming"],
      ["done", "Done"]
    ].forEach(([group, label]) => {
      const tasks = filteredTasks(group);
      if (!tasks.length) return;
      container.append(lightTaskSectionHeader(label, group, tasks.length));
      if (taskSectionExpanded(group)) {
        container.append(lightTaskGroup(tasks, group));
      }
    });
  }

  function lightTaskWorkspacePage() {
    const page = lightPage(taskPageTitle(), { action: taskPageHeaderAction() });
    page.classList.add("light-tasks-page", "light-task-workspace-page");
    const status = lightWorkspaceStatus("tasks", "checklist", "No tasks yet");
    if (status) {
      page.append(status);
      return page;
    }
    const shell = el("div", "light-task-workspace");
    const listPane = el("section", "light-task-list-pane");
    renderTaskGroups(listPane);
    listPane.append(lightTaskBulkActionBar());
    const detailPane = el("section", "light-task-detail-pane");
    const task = selectedTask();
    if (taskSelectionModeActive()) {
      detailPane.append(lightEmptyState("archive", "Select tasks", "Choose one or more tasks to archive from the list."));
    } else if (task) {
      ensureLinkedCollections(task);
      detailPane.append(lightTaskDetailSurface(task));
    } else {
      detailPane.append(lightEmptyState("checklist", "No task selected", "Pick a task from the list to open its details."));
    }
    shell.append(listPane, detailPane);
    page.append(shell);
    return page;
  }

  function lightTaskDetailPage() {
    if (taskUsesSplitLayout()) {
      return lightTaskWorkspacePage();
    }
    const task = selectedTask();
    if (!task) {
      return lightPage("Task", { subtitle: "Task not found.", detail: true });
    }
    ensureLinkedCollections(task);
    const page = lightPage(task.title || "Task", { detail: true });
    page.classList.add("light-task-detail-page");
    page.append(lightTaskDetailSurface(task));
    return page;
  }

  function lightAppsPage() {
    const page = lightPage("Connect");
    page.classList.add("light-apps-page");
    page.append(linksPageView());
    return page;
  }

  function lightFeedRow(item) {
      const row = el("button", "light-card light-feed-row");
      row.type = "button";
      row.dataset.feedId = item.id;
      row.addEventListener("click", () => {
        state.selectedFeedId = item.id;
        lightNavigate("inbox-detail", { from: "inbox" });
      });
    row.append(lightSmallIcon(item.metadata?.icon || "text"), lightTextStack(item.title, `${workspaceTimestamp(item.event_at_ms || item.updated_at_ms, "Updated")}${DOT}${item.summary || item.metadata?.type || "Workspace"}`), el("span", "light-chevron", ">"));
    return row;
  }

  function lightFeedDetailPage() {
    const item = selectedFeedItem();
    if (!item) {
      return lightPage("Inbox Item", { subtitle: "Inbox item not found.", detail: true });
    }
    ensureLinkedCollections(item);
    const page = lightPage("Inbox Item", { detail: true });
    page.classList.add("light-document-page", "light-feed-document");
    const article = el("article", "light-doc-article");
    article.append(
      lightDocumentEyebrow(item.metadata?.type || "Inbox update", workspaceTimestamp(item.event_at_ms || item.updated_at_ms, "Updated")),
      el("h1", "", item.title),
      el("p", "light-note-body", item.summary || "")
    );
    page.append(article);
    const notes = lightLinkedNotesSection(item);
    if (notes) {
      page.append(notes);
    }
    const relatedRows = lightLinkedRecordRows(item, { excludeKinds: ["note"] });
    if (relatedRows.length) {
      page.append(lightInfoSection("Related", relatedRows));
    }
    return page;
  }

  function lightProjectsPage() {
    const status = lightWorkspaceStatus("projects", "folder", "No projects yet");
    return renderUniversalFeedPage({
      title: "Projects",
      surface: "projects",
      status,
      sections: [{
        key: "projects",
        label: "",
        count: allProjects().length,
        collapsible: false,
        expanded: true,
        emptyState: null,
        items: allProjects().map(project => universalProjectFeedTileDescriptor(project, "projects"))
      }],
    });
  }

  function lightProjectRow(project, options = {}) {
    const flatFeed = options.flatFeed === true;
    const row = el("button", ["light-card", "light-feed-row", "light-project-row", flatFeed ? "is-flat-feed" : ""].filter(Boolean).join(" "));
    row.type = "button";
    row.dataset.projectId = project.id;
    row.addEventListener("click", () => {
      state.selectedProjectId = project.id;
      lightNavigate("project-detail", { from: "projects" });
    });
    row.append(
      lightSmallIcon("folder"),
      lightTextStack(project.title, `${workspaceTimestamp(project.updated_at_ms, "Updated")}${DOT}${project.summary || "Project"}`)
    );
    return row;
  }

  function projectConnectedDetail(entry) {
    const kind = String(entry?.relatedKind || entry?.kind || "").trim();
    const kindLabel = graphKindLabel(kind);
    const related = entry?.related || null;
    if (!related) {
      return String(entry?.relation || kindLabel).trim() || kindLabel;
    }
    if (kind === "calendar_event") {
      return calendarConnectedTileTimestampLabel(related);
    }
    if (kind === "contact") {
      return [kindLabel, String(related.summary || "").trim()].filter(Boolean).join(DOT);
    }
    const timestamp = workspaceTimestamp(
      related.event_at_ms || related.start_at_ms || related.due_at_ms || related.updated_at_ms,
      ""
    );
    return [kindLabel, timestamp, String(related.summary || "").trim()].filter(Boolean).join(DOT);
  }

  function lightProjectDetailPage() {
    const project = selectedProject();
    if (!project) {
      return lightPage("Project", { subtitle: "Project not found.", detail: true });
    }
    ensureLinkedCollections(project);
    const page = lightPage(project.title, { detail: true });
    page.classList.add("light-project-detail-page");
    page.append(lightLinkedRecordSection(project, {
      title: "Connected",
      showWhenEmpty: true,
      fromRoute: "project-detail",
      dedupeTargets: true,
      showChips: false,
      showChevron: false,
      variant: "flat",
      detailResolver: projectConnectedDetail,
    }));
    return page;
  }

  function lightSettingsSurface() {
    const page = el("section", "light-page light-canonical-port-page light-settings-page");
    page.append(lightHeader("Settings"));
    const surface = el("section", "light-canonical-port-surface light-settings-surface");
    const settings = settingsPageView();
    settings.classList.add("light-settings-real");
    surface.append(settings);
    page.append(surface);
    return page;
  }

  function lightInboxPage() {
    return renderUniversalFeedPage({
      title: "Inbox",
      surface: "inbox",
      createPage: () => {
        const page = lightPage("Inbox", { action: inboxManageHeaderAction() });
        page.classList.add("light-canonical-port-page", "light-inbox-page");
        return page;
      },
      surfaceTag: "section",
      surfaceClassName: "light-canonical-port-surface light-inbox-surface",
      beforeSections: [inboxArchiveFilterLoadingNotice()].filter(Boolean),
      sections: [lightInboxSection()]
    });
  }

  function inboxArchiveFilterLoadingNotice() {
    if (!inboxArchiveFilterPending()) {
      return null;
    }
    const target = Boolean(state.inboxArchiveFilterPendingTarget);
    const notice = el("div", "inbox-archive-loading-notice");
    notice.setAttribute("role", "status");
    notice.setAttribute("aria-live", "polite");
    notice.append(
      el("span", "inbox-header-spinner"),
      el("span", "", target ? "Loading archived replies..." : "Loading active replies...")
    );
    return notice;
  }

  function lightMeetingsPage() {
    const beforeSections = [];
    if (state.meetings.loading && state.meetings.records.length) {
      beforeSections.push(el("div", "meetings-refreshing", "Refreshing..."));
    }
    return renderUniversalFeedPage({
      title: "Meetings",
      surface: "meetings",
      createPage: () => {
        const page = lightPage("Meetings");
        page.classList.add("light-canonical-port-page", "light-meetings-page");
        return page;
      },
      surfaceTag: "section",
      surfaceClassName: "light-canonical-port-surface light-meetings-surface",
      contentClassName: "meetings-page is-embedded-light",
      beforeSections,
      sections: [lightMeetingsSection()]
    });
  }

  function lightInboxSection() {
    const displayCards = feedDisplayCards();
    if (state.feedLoadError && !displayCards.length) {
      const empty = el("div", "empty feed-load-error");
      empty.append(
        el("strong", "", "Could not load the Home feed."),
        el("span", "", state.feedLoadError)
      );
      return {
        key: "inbox",
        label: "",
        count: 0,
        collapsible: false,
        expanded: true,
        emptyState: empty,
        items: []
      };
    }
    if (!displayCards.length && !state.feedLastAppliedAt) {
      return {
        key: "inbox",
        label: "",
        count: 0,
        collapsible: false,
        expanded: true,
        emptyState: el("div", "empty", "Loading inbox..."),
        items: []
      };
    }
    if (!displayCards.length) {
      const empty = el("div", "empty");
      empty.append("No inbox items yet.", document.createElement("br"), "Replies and meeting summaries will appear here.");
      return {
        key: "inbox",
        label: "",
        count: 0,
        collapsible: false,
        expanded: true,
        emptyState: empty,
        items: []
      };
    }
    const cards = filteredFeedCards(displayCards);
    return {
      key: "inbox",
      label: "",
      count: cards.length,
      collapsible: false,
      expanded: true,
      emptyState: cards.length ? null : filteredFeedEmptyView(),
      items: cards.map(card => universalCanonicalReplyFeedTileDescriptor(card, "inbox"))
    };
  }

  function lightMeetingsSection() {
    const records = visibleMeetingRecords().slice().reverse();
    let emptyState = null;
    if (state.meetings.loading && !state.meetings.records.length) {
      emptyState = el("div", "meetings-empty", "Loading meetings...");
    } else if (state.meetings.error && !state.meetings.records.length) {
      emptyState = el("div", "meetings-empty is-error", state.meetings.error);
    } else if (!state.meetings.records.length) {
      emptyState = el("div", "meetings-empty", "No meeting recordings yet.");
    }
    return {
      key: "meetings",
      label: "",
      count: records.length,
      collapsible: false,
      expanded: true,
      emptyState,
      items: records.map(meeting => universalCanonicalMeetingFeedTileDescriptor(meeting, "meetings"))
    };
  }

  function lightPage(title, options = {}) {
    const page = el("section", "light-page");
    if (options.htmlDetail) {
      page.classList.add("light-html-detail-page");
    }
    page.append(lightHeader(title, options));
    if (options.subtitle) {
      page.append(el("p", "light-page-subtitle", options.subtitle));
    }
    return page;
  }

  function lightHeader(title, options = {}) {
    const shell = el("div", "light-page-header-shell");
    const header = el("header", "light-page-header");
    const onBack = typeof options.onBack === "function" ? options.onBack : () => lightBack();
    const left = options.back === false
      ? el("div", "light-nav-slot")
      : lightCircleButton("chevron_left", "Back", onBack, "light-back-button");
    const titleClass = options.detail
      ? "light-page-title light-page-title-detail"
      : options.large
        ? "light-page-title large"
        : "light-page-title";
    const heading = el(options.detail || options.large ? "h1" : "h2", titleClass, title);
    const right = options.action || el("div", "light-nav-slot");
    if (options.action) {
      header.classList.add("has-action");
    }
    header.append(left, heading, right);
    shell.append(header);
    if (options.headerChrome) {
      shell.classList.add("has-chrome");
      const chrome = el("div", "light-page-header-chrome");
      chrome.append(options.headerChrome);
      shell.append(chrome);
    }
    return shell;
  }

  function normalizeLightHistoryRoute(route) {
    const value = String(route || "").trim();
    if (!value) {
      return "";
    }
    if (value === "home" || isLightDetailRoute(value)) {
      return value;
    }
    return normalizeHomeShellRoute(value, { preview: false }) || "";
  }

  function lightRouteDetailKey(route) {
    return ({
      "inbox-detail": "selectedFeedId",
      "meeting-detail": "selectedMeetingId",
      "meeting-note-detail": "selectedMeetingNoteId",
      "reminder-detail": "selectedReminderId",
      "note-detail": "selectedNoteId",
      "task-detail": "selectedTaskId",
      "project-detail": "selectedProjectId",
      "contact-detail": "selectedContactId",
      "contact-edit": "selectedContactId"
    })[String(route || "")] || "";
  }

  function lightRouteDetailCollection(route) {
    return ({
      "inbox-detail": "feed-items",
      "meeting-detail": "calendar-events",
      "meeting-note-detail": "meeting-notes",
      "reminder-detail": "reminders",
      "note-detail": "notes",
      "task-detail": "tasks",
      "project-detail": "projects",
      "contact-detail": "contacts",
      "contact-edit": "contacts"
    })[String(route || "")] || "";
  }

  function captureLightRouteScrollTop(route = state.route) {
    const normalizedRoute = normalizeLightHistoryRoute(route);
    if (!normalizedRoute) {
      return 0;
    }
    const feed = document.getElementById("feed");
    return scrollNumber(feed ? feed.scrollTop : 0);
  }

  function normalizeLightRouteSnapshot(snapshot) {
    if (!snapshot || typeof snapshot !== "object") {
      return null;
    }
    const route = normalizeLightHistoryRoute(snapshot.route);
    if (!route) {
      return null;
    }
    const normalized = {
      route,
      selectedCalendarDate: String(snapshot.selectedCalendarDate || ""),
      scroll_top: scrollNumber(snapshot.scroll_top ?? snapshot.scrollTop)
    };
    LIGHT_HISTORY_SELECTED_KEYS.forEach(key => {
      normalized[key] = String(snapshot[key] || "");
    });
    if (!normalized.selectedProjectId) {
      normalized.selectedProjectId = String(snapshot.selectedTagId || "");
    }
    return normalized;
  }

  function normalizeLightRouteHistory(history) {
    if (!Array.isArray(history)) {
      return [];
    }
    return history
      .map(normalizeLightRouteSnapshot)
      .filter(Boolean)
      .slice(-LIGHT_ROUTE_HISTORY_LIMIT);
  }

  function lightRouteSnapshotIdentity(snapshot) {
    const normalized = normalizeLightRouteSnapshot(snapshot);
    if (!normalized) {
      return "";
    }
    const detailKey = lightRouteDetailKey(normalized.route);
    const detailId = detailKey ? String(normalized[detailKey] || "") : "";
    const calendarKey = normalized.route === "calendar" || normalized.route === "meeting-detail"
      ? String(normalized.selectedCalendarDate || "")
      : "";
    return [normalized.route, detailKey, detailId, calendarKey].join("::");
  }

  function lightRouteSnapshotExactRecord(snapshot) {
    const normalized = normalizeLightRouteSnapshot(snapshot);
    if (!normalized) {
      return null;
    }
    const detailKey = lightRouteDetailKey(normalized.route);
    const collection = lightRouteDetailCollection(normalized.route);
    const recordId = detailKey ? String(normalized[detailKey] || "") : "";
    if (!detailKey || !collection || !recordId) {
      return null;
    }
    return workspaceRecordById(collection, recordId, null);
  }

  function lightRouteSnapshotIsRestorable(snapshot) {
    const normalized = normalizeLightRouteSnapshot(snapshot);
    if (!normalized) {
      return false;
    }
    if (normalized.route === "reminder-detail") {
      const reminder = reminderById(normalized.selectedReminderId, null);
      return Boolean(reminder) && reminderIsNavigableFromList(reminder);
    }
    if (!isLightDetailRoute(normalized.route)) {
      return true;
    }
    const exactRecord = lightRouteSnapshotExactRecord(normalized);
    return Boolean(exactRecord);
  }

  function captureLightRouteSnapshot(route = state.route) {
    const normalizedRoute = normalizeLightHistoryRoute(route);
    if (!normalizedRoute) {
      return null;
    }
    const snapshot = {
      route: normalizedRoute,
      selectedCalendarDate: String(state.selectedCalendarDate || ""),
      scroll_top: captureLightRouteScrollTop(normalizedRoute)
    };
    LIGHT_HISTORY_SELECTED_KEYS.forEach(key => {
      snapshot[key] = String(state[key] || "");
    });
    return normalizeLightRouteSnapshot(snapshot);
  }

  function pushLightRouteHistory(snapshot) {
    const normalized = normalizeLightRouteSnapshot(snapshot);
    if (!normalized) {
      return;
    }
    const history = normalizeLightRouteHistory(state.lightRouteHistory);
    const nextIdentity = lightRouteSnapshotIdentity(normalized);
    const currentIdentity = history.length ? lightRouteSnapshotIdentity(history[history.length - 1]) : "";
    if (nextIdentity && nextIdentity === currentIdentity) {
      state.lightRouteHistory = history;
      return;
    }
    history.push(normalized);
    state.lightRouteHistory = history.slice(-LIGHT_ROUTE_HISTORY_LIMIT);
  }

  function popLightRouteHistory() {
    const history = normalizeLightRouteHistory(state.lightRouteHistory);
    const currentIdentity = lightRouteSnapshotIdentity(captureLightRouteSnapshot());
    while (history.length) {
      const snapshot = history.pop();
      if (!snapshot) {
        continue;
      }
      if (lightRouteSnapshotIdentity(snapshot) === currentIdentity) {
        continue;
      }
      if (!lightRouteSnapshotIsRestorable(snapshot)) {
        continue;
      }
      state.lightRouteHistory = history;
      return snapshot;
    }
    state.lightRouteHistory = [];
    return null;
  }

  function applyLightRouteSelectionPatch(selectionPatch = {}) {
    LIGHT_HISTORY_SELECTED_KEYS.forEach(key => {
      if (Object.prototype.hasOwnProperty.call(selectionPatch, key)) {
        state[key] = String(selectionPatch[key] || "");
      }
    });
    if (!Object.prototype.hasOwnProperty.call(selectionPatch, "selectedProjectId")
      && Object.prototype.hasOwnProperty.call(selectionPatch, "selectedTagId")) {
      state.selectedProjectId = String(selectionPatch.selectedTagId || "");
    }
  }

  function isContactsSurfaceRoute(route) {
    const value = String(route || "").trim();
    return value === "contacts" || value === "contact-detail" || value === "contact-edit";
  }

  function resetContactsSearchIfLeavingContacts(nextRoute, currentRoute = state.route) {
    if (!isContactsSurfaceRoute(currentRoute) || isContactsSurfaceRoute(nextRoute)) {
      return;
    }
    state.contacts.search = "";
  }

  function isContactDetailEditorRoute(route = state.route) {
    const value = String(route || "").trim();
    return value === "contact-detail" || value === "contact-edit";
  }

  function runAfterContactDetailFlush(nextRoute, selectionPatch, callback) {
    if (!isContactDetailEditorRoute(state.route)) {
      return true;
    }
    const currentContactId = String(state.contacts.editDraft?.contactId || state.selectedContactId || "");
    const nextContactId = Object.prototype.hasOwnProperty.call(selectionPatch || {}, "selectedContactId")
      ? String(selectionPatch.selectedContactId || "")
      : String(state.selectedContactId || currentContactId);
    const stayingOnSameContact = isContactDetailEditorRoute(nextRoute) && nextContactId && nextContactId === currentContactId;
    if (stayingOnSameContact) {
      return true;
    }
    if (!state.contacts.editSaving && !contactEditHasUnsavedChanges()) {
      clearContactEditDraft();
      return true;
    }
    void flushContactDetailAutosave({ reason: "route_change" }).then(result => {
      if (result === false) {
        syncContactDetailEditor();
        return;
      }
      clearContactEditDraft();
      callback();
    });
    return false;
  }

  function restoreLightRouteScroll(snapshot) {
    const normalized = normalizeLightRouteSnapshot(snapshot);
    if (!normalized) {
      return;
    }
    const scrollTop = scrollNumber(normalized.scroll_top);
    const restore = () => restoreScrollPosition(document.getElementById("feed"), scrollTop);
    state.feedScrollTop = scrollTop;
    restore();
    if (typeof window !== "undefined" && typeof window.requestAnimationFrame === "function") {
      window.requestAnimationFrame(restore);
    }
    window.setTimeout(restore, 0);
  }

  function runLightRouteSideEffects(reason = "light_app_click") {
    void syncVoiceThreadScope({ reason, render: true });
    void loadWorkspaceForRoute(state.route, { render: true, reason });
    if (state.route === "connect") {
      linksDebugStartSession("route", { reason: reason === "light_back" ? "light_back_open" : "light_app_open" });
      linksDebugRecord("links_route_enter", { reason: reason === "light_back" ? "light_back_open" : "light_app_open" }, "route");
      loadLinksPortal({ render: true });
    }
    if (state.route === "inbox") {
      restoreFeedScroll();
      syncFeedCards({ reason: reason === "light_back" ? "home_shell_inbox_back" : "home_shell_inbox_open", silent: true, render: true });
    }
    if (state.route === "meetings") {
      refreshMeetingRecordingStatus({ render: true });
      loadMeetings({ render: true });
    }
    if (state.route === "settings") {
      loadSettingsState({ render: true });
    }
  }

  function restoreLightRouteSnapshot(snapshot) {
    const normalized = normalizeLightRouteSnapshot(snapshot);
    if (!normalized) {
      return false;
    }
    resetContactsSearchIfLeavingContacts(normalized.route);
    LIGHT_HISTORY_SELECTED_KEYS.forEach(key => {
      state[key] = String(normalized[key] || "");
    });
    if (normalized.selectedCalendarDate) {
      state.selectedCalendarDate = normalized.selectedCalendarDate;
    }
    state.route = normalized.route;
    state.lightReturnRoute = state.route === "home" ? "" : "home";
    state.previousLightRoute = LIGHT_ROUTE_PARENTS[state.route] || "home";
    persistNavState();
    render();
    restoreLightRouteScroll(normalized);
    runLightRouteSideEffects("light_back");
    return true;
  }

  function lightNavigate(route, options = {}) {
    if (linksHandoffLocked()) {
      return;
    }
    const nextRoute = normalizeHomeShellRoute(route, { preview: isWalkthroughPreview() });
    if (!nextRoute) {
      return;
    }
    rememberFeedScroll();
    const currentSnapshot = captureLightRouteSnapshot();
    const selectionPatch = options.selectionPatch && typeof options.selectionPatch === "object"
      ? options.selectionPatch
      : null;
    const replaceHistory = options.replaceHistory === true;
    if (!options.skipContactDetailFlush) {
      const continued = runAfterContactDetailFlush(nextRoute, selectionPatch, () => {
        lightNavigate(route, {
          ...options,
          skipContactDetailFlush: true,
        });
      });
      if (!continued) {
        return;
      }
    }
    const targetSnapshot = currentSnapshot
      ? normalizeLightRouteSnapshot({
          ...currentSnapshot,
          route: nextRoute,
          ...(selectionPatch || {})
        })
      : null;
    dismissTransientUiForRouteChange();
    if (!options.preserveTaskOrigin) {
      state.taskNavOrigin = null;
    }
    if (!options.preserveDetailOrigin) {
      state.detailNavOrigin = null;
    }
    if (!replaceHistory && currentSnapshot && lightRouteSnapshotIdentity(currentSnapshot) !== lightRouteSnapshotIdentity(targetSnapshot)) {
      pushLightRouteHistory(currentSnapshot);
    }
    if (options.from) {
      state.previousLightRoute = options.from;
    } else if (state.route && state.route !== nextRoute && state.route !== "home") {
      state.previousLightRoute = state.route;
    } else {
      state.previousLightRoute = "home";
    }
    noteFlashDebugRecord("lightNavigate_start", {
      route: nextRoute,
      previous_route: currentSnapshot?.route || state.route || "",
      reason: options.from || "light_app_click"
    });
    const commitNavigation = (reason = "light_app_click") => {
      resetContactsSearchIfLeavingContacts(nextRoute);
      applyLightRouteSelectionPatch(selectionPatch || {});
      state.route = nextRoute;
      state.lightReturnRoute = state.route === "home" ? "" : "home";
      noteFlashDebugRecord("lightNavigate_state_set", {
        route: nextRoute,
        previous_route: state.previousLightRoute,
        reason
      });
      persistNavState();
      render();
      resetLightRouteScroll();
      runLightRouteSideEffects(reason);
    };
    const routeDelayMs = noteFlashDebugEnabled() && nextRoute === "note-detail"
      ? noteFlashDebugRouteDelayMs()
      : 0;
    if (routeDelayMs > 0) {
      window.setTimeout(() => commitNavigation("light_app_click"), routeDelayMs);
      return;
    }
    commitNavigation("light_app_click");
  }

  function lightBack(options = {}) {
    if (linksHandoffLocked()) {
      releaseLinksHandoff({ render: false, reason: "light_back" });
      return true;
    }
    if (!isHomeShellRoute() || state.route === "home") {
      return false;
    }
    if (!options.skipContactDetailFlush && isContactDetailEditorRoute(state.route)) {
      const continued = runAfterContactDetailFlush(
        LIGHT_ROUTE_PARENTS[state.route] || state.previousLightRoute || "home",
        {},
        () => {
          lightBack({ ...options, skipContactDetailFlush: true });
        }
      );
      if (!continued) {
        return true;
      }
    }
    const snapshot = popLightRouteHistory();
    if (snapshot) {
      state.taskNavOrigin = null;
      const restored = restoreLightRouteSnapshot(snapshot);
      if (restored) {
        restoreDetailNavOrigin();
      }
      return restored;
    }
    if (state.taskNavOrigin && state.route !== state.taskNavOrigin.route) {
      state.selectedTaskId = state.taskNavOrigin.taskId;
      state.route = state.taskNavOrigin.route;
      state.previousLightRoute = LIGHT_ROUTE_PARENTS[state.route] || "home";
      state.lightReturnRoute = state.route === "home" ? "" : "home";
      state.taskNavOrigin = null;
      persistNavState();
      render();
      void syncVoiceThreadScope({ reason: "light_back", render: true });
      void loadWorkspaceForRoute(state.route, { render: true, force: true });
      return true;
    }
    const detailParent = isLightDetailRoute(state.previousLightRoute) ? state.previousLightRoute : "";
    const parent = isHomeShellCanonicalRoute()
      ? "home"
      : detailParent || LIGHT_ROUTE_PARENTS[state.route] || state.previousLightRoute || "home";
    resetContactsSearchIfLeavingContacts(parent === state.route ? "home" : parent);
    state.route = parent === state.route ? "home" : parent;
    state.previousLightRoute = LIGHT_ROUTE_PARENTS[state.route] || "home";
    state.lightReturnRoute = state.route === "home" ? "" : "home";
    persistNavState();
    render();
    runLightRouteSideEffects("light_back");
    return true;
  }

  function lightCircleButton(icon, label, onClick, className = "") {
    const button = el("button", `light-circle-button ${className}`.trim());
    button.type = "button";
    button.setAttribute("aria-label", label);
    button.innerHTML = iconSvg(icon, { filled: false });
    if (typeof onClick === "function") {
      button.addEventListener("click", onClick);
    }
    return button;
  }

  function lightIconButton(icon, label, onClick, className = "") {
    const button = el("button", `light-icon-button ${className}`.trim());
    button.type = "button";
    button.setAttribute("aria-label", label);
    button.innerHTML = iconSvg(icon, { filled: false });
    if (typeof onClick === "function") {
      button.addEventListener("click", onClick);
    }
    return button;
  }

  function lightPillButton(label, onClick, active = false) {
    const button = el("button", active ? "light-pill is-active" : "light-pill", label);
    button.type = "button";
    button.addEventListener("click", onClick);
    return button;
  }

  function lightSmallIcon(icon, accentKey = "") {
    const wrap = el("span", "light-small-icon");
    applySemanticIconAccent(wrap, accentKey, { propertyName: "--home-shell-accent", allowEmpty: true });
    wrap.innerHTML = iconSvg(icon, { filled: false });
    return wrap;
  }

  function lightTextStack(title, detail) {
    const copy = el("span", "light-text-stack");
    copy.append(el("strong", "", title), el("span", "", detail || ""));
    return copy;
  }

  function lightContactCopy(contact) {
    const meta = contact.metadata || {};
    const activity = Array.isArray(meta.activity) && meta.activity.length ? meta.activity[0] : "";
    return lightTextStack(contactDisplayTitle(contact), `${contact.summary || "Contact"}${activity ? `${DOT}${activity}` : ""}`);
  }

  function lightAvatar(contact, size = "") {
    const meta = contact.metadata || {};
    const photo = String(meta.photo || "");
    const initials = contactAvatarText(contact);
    const hasPhoto = Boolean(photo);
    const avatar = el("span", `light-avatar ${hasPhoto ? "has-photo" : ""} ${size}`.trim(), hasPhoto ? "" : initials);
    avatar.setAttribute("aria-label", contactDisplayTitle(contact));
    avatar.dataset.contactId = contact.id;
    if (hasPhoto) {
      avatar.dataset.photo = photo;
      const img = document.createElement("img");
      img.src = photo;
      img.alt = "";
      img.decoding = "async";
      avatar.append(img);
    } else {
      avatar.style.background = "linear-gradient(135deg,#f59e0b,#fbbf24)";
    }
    return avatar;
  }

  function lightActionColumn(icon, label, color) {
    const action = el("button", "light-profile-action");
    action.type = "button";
    action.append(lightAppIcon(icon, color), el("span", "", label));
    return action;
  }

  function lightEmptyState(icon, title, detail, options = {}) {
    const empty = el("section", "light-empty-state");
    empty.append(lightAppIcon(icon, "sky"), el("h2", "", title), el("p", "", detail));
    if (options.actionLabel && typeof options.onAction === "function") {
      const button = el("button", "settings-action-button light-empty-state-action", options.actionLabel);
      button.type = "button";
      button.addEventListener("click", event => {
        event.preventDefault();
        options.onAction();
      });
      empty.append(button);
    }
    return empty;
  }

  function lightSectionTitle(title) {
    return el("h3", "light-section-title", String(title).toUpperCase());
  }

  function lightCopySection(title, body) {
    const section = el("section", "light-copy-section");
    section.append(lightSectionTitle(title), el("p", "", body));
    return section;
  }

  function lightListSection(title, lines) {
    const section = el("section", "light-card light-list-section");
    section.append(lightSectionTitle(title));
    const list = el("ul", "");
    lines.forEach(line => list.append(el("li", "", line)));
    section.append(list);
    return section;
  }

  function lightInfoSection(title, rows, options = {}) {
    const section = el("section", "light-info-section");
    section.append(lightSectionTitle(title));
    const card = el("div", "light-card light-info-card");
    const suppressInteractiveChevron = String(title || "").trim().toLowerCase() === "linked records";
    const showTrailingChevron = options.showTrailingChevron !== false && !suppressInteractiveChevron;
    rows.forEach(row => card.append(lightInfoRow(row, { showChevron: showTrailingChevron })));
    section.append(card);
    return section;
  }

  function lightInfoRow(row, options = {}) {
    const isInteractive = Boolean(row?.target?.route && row?.target?.id && row?.target?.selectedKey);
    const className = [
      "light-info-row",
      isInteractive ? "is-clickable" : "",
      String(row?.className || "").trim(),
    ].filter(Boolean).join(" ");
    const item = el(isInteractive ? "button" : "div", className);
    if (row?.dataset && typeof row.dataset === "object") {
      Object.entries(row.dataset).forEach(([key, value]) => {
        item.dataset[key] = String(value || "");
      });
    }
    if (isInteractive) {
      item.type = "button";
      item.dataset.workspaceTargetRoute = row.target.route;
      item.dataset.workspaceTargetId = row.target.id;
      item.dataset.workspaceTargetKind = row.target.kind || "";
      item.addEventListener("click", () => openWorkspaceTarget(
        row.target,
        row.fromRoute || state.route || "",
        row.openOptions || {}
      ));
    }
    const copy = row?.hideDetail
      ? (() => {
          const stack = el("span", "light-text-stack");
          stack.append(el("strong", "", row.label));
          return stack;
        })()
      : lightTextStack(row.label, row.value);
    item.append(
      lightSmallIcon(row.icon, row.accentKey || row.accent || ""),
      copy
    );
    return item;
  }

  function lightAttendeesSection(attendees, options = {}) {
    const section = el("section", "light-info-section light-attendees-section");
    section.append(lightSectionTitle("Attendees"));
    const card = el("div", "light-card light-attendee-chip-card");
    const cloud = el("div", "light-chip-cloud light-attendee-chip-cloud");
    attendees.forEach(person => {
      const entry = typeof person === "string"
        ? { label: person, fullLabel: person, target: workspaceContactTargetByName(person) }
        : person;
      cloud.append(lightAttendeeChip(entry, { fromRoute: options.fromRoute || state.route || "" }));
    });
    card.append(cloud);
    section.append(card);
    return section;
  }

  function lightAttendeeChip(person, options = {}) {
    const label = String(person?.label || person?.fullLabel || "Guest").trim() || "Guest";
    const target = person?.target || null;
    const chip = el(target ? "button" : "span", target ? "light-attendee-chip is-link" : "light-attendee-chip", label);
    if (target) {
      chip.type = "button";
      chip.addEventListener("click", event => {
        event.stopPropagation();
        openWorkspaceTarget(target, options.fromRoute || state.route || "");
      });
    }
    return chip;
  }

  function lightCalendarContactChip(entry, options = {}) {
    const label = String(entry?.label || entry?.fullLabel || graphKindLabel(entry?.kind)).trim() || "Contact";
    const target = entry?.target || null;
    const chip = el(
      target ? "button" : "span",
      target ? "light-attendee-chip light-calendar-attendee-chip is-link" : "light-attendee-chip light-calendar-attendee-chip"
    );
    applySemanticIconAccent(chip, "contacts", { propertyName: "--calendar-attendee-accent" });
    const icon = el("span", "light-calendar-attendee-chip-icon");
    icon.innerHTML = iconSvg("contacts", { filled: true });
    chip.append(
      icon,
      el("span", "light-calendar-attendee-chip-label", label)
    );
    if (target) {
      chip.type = "button";
      chip.addEventListener("click", event => {
        event.stopPropagation();
        openWorkspaceTarget(target, options.fromRoute || state.route || "");
      });
    }
    return chip;
  }

  function lightCalendarEventChips(event, options = {}) {
    const row = el("div", "light-event-chip-row");
    const chipTargets = calendarEventChipTargets(event, options);
    const limit = Math.max(0, Number(options.limit || 0) || 0);
    const visible = limit > 0 ? chipTargets.slice(0, limit) : chipTargets;
    if (visible.length) {
      visible.forEach(entry => row.append(lightCalendarContactChip(entry, { fromRoute: options.fromRoute || state.route || "" })));
      if (limit > 0 && chipTargets.length > limit) {
        row.append(el("span", "light-attendee-chip light-attendee-overflow", `+${chipTargets.length - limit}`));
      }
    }
    return row.childElementCount ? row : null;
  }

  function calendarEventChipTargets(event, options = {}) {
    const chips = [];
    const seen = new Set();
    const remember = entry => {
      const label = String(entry?.label || "").trim();
      const target = entry?.target || null;
      const kind = String(entry?.kind || target?.kind || "").trim();
      const key = kind === "contact"
        ? `contact:${label.toLowerCase()}`
        : target?.kind && target?.id
        ? `${target.kind}:${target.id}`
        : `${String(entry?.kind || "")}:${label.toLowerCase()}`;
      if (!label || !key || seen.has(key)) {
        return;
      }
      seen.add(key);
      chips.push({
        label,
        target,
        kind
      });
    };
    if (options.excludeContacts !== true) {
      calendarEventPeople(event)
        .filter(person => person.recognized && person.target)
        .forEach(person => remember({
          label: person.label,
          target: person.target,
          kind: "contact"
        }));
    }
    if (options.contactsOnly === true) {
      return disambiguateCalendarChipLabels(chips);
    }
    const currentKind = String(event?.kind || "calendar_event");
    const currentId = String(event?.id || event?.record_id || "");
    const links = Array.isArray(event?.links) ? event.links : [];
    const allowedKinds = new Set(["project", "task", "note", "meeting_note", "reminder"]);
    links.forEach(link => {
      const isSource = String(link.source_kind) === currentKind && String(link.source_id) === currentId;
      const relatedKind = String(isSource ? link.target_kind : link.source_kind);
      if (!allowedKinds.has(relatedKind)) {
        return;
      }
      const relatedId = String(isSource ? link.target_id : link.source_id);
      const related = workspaceRecordByKind(relatedKind, relatedId);
      const target = workspaceTargetForKind(relatedKind, related?.id || relatedId);
      remember({
        label: String(related?.title || link.label || graphKindLabel(relatedKind)).trim() || graphKindLabel(relatedKind),
        target,
        kind: relatedKind
      });
    });
    return disambiguateCalendarChipLabels(chips);
  }

  function disambiguateCalendarChipLabels(chips) {
    const duplicateCounts = new Map();
    chips.forEach(entry => {
      const label = String(entry?.label || "").trim();
      const kind = String(entry?.kind || entry?.target?.kind || "").trim();
      if (!label || kind === "contact") {
        return;
      }
      const key = label.toLowerCase();
      duplicateCounts.set(key, Number(duplicateCounts.get(key) || 0) + 1);
    });
    return chips.map(entry => {
      const label = String(entry?.label || "").trim();
      const kind = String(entry?.kind || entry?.target?.kind || "").trim();
      if (!label || kind === "contact" || Number(duplicateCounts.get(label.toLowerCase()) || 0) < 2) {
        return entry;
      }
      return {
        ...entry,
        label: `${label}${DOT}${graphKindLabel(kind)}`
      };
    });
  }

  function lightRecordChip(entry, options = {}) {
    const label = String(entry?.label || graphKindLabel(entry?.kind)).trim() || "Linked";
    const target = entry?.target || null;
    const chip = el(
      target ? "button" : "span",
      target ? "light-attendee-chip light-calendar-link-chip light-record-chip is-link" : "light-attendee-chip light-calendar-link-chip light-record-chip"
    );
    chip.append(
      lightChipIcon(graphKindIcon(entry?.kind), graphKindAccentKey(entry?.kind)),
      el("span", "light-record-chip-label", label)
    );
    if (target) {
      chip.type = "button";
      chip.dataset.workspaceTargetRoute = target.route;
      chip.dataset.workspaceTargetId = target.id;
      chip.dataset.workspaceTargetKind = target.kind || "";
      chip.addEventListener("click", event => {
        event.stopPropagation();
        openWorkspaceTarget(target, options.fromRoute || state.route || "", {
          taskOrigin: options.taskOrigin || null,
          detailOrigin: options.detailOrigin || null,
        });
      });
    }
    return chip;
  }

  function lightChipIcon(icon, accentKey = "") {
    const wrap = el("span", "light-record-chip-icon");
    applySemanticIconAccent(wrap, accentKey, { propertyName: "color", allowEmpty: true });
    wrap.innerHTML = iconSvg(icon, { filled: false });
    return wrap;
  }

  function lightAttendeeRow(name) {
    const contact = workspaceItems("contacts").find(item => item.title === name || item.metadata?.display_name === name);
    const target = contact ? workspaceTargetForKind("contact", contact.id) : null;
    const row = el(target ? "button" : "div", target ? "light-info-row light-attendee-row is-clickable" : "light-info-row light-attendee-row is-external");
    if (target) {
      row.type = "button";
      row.dataset.workspaceTargetRoute = target.route;
      row.dataset.workspaceTargetId = target.id;
      row.dataset.workspaceTargetKind = target.kind || "";
      row.addEventListener("click", () => openWorkspaceTarget(target, "meeting-detail"));
    }
    row.append(lightSmallIcon(contact ? "contacts" : "apps"), lightTextStack(name, contact ? contact.summary : `External${DOT}Vendor`), target ? el("span", "light-chevron", ">") : el("span", ""));
    return row;
  }

  function lightHeroDetail(title, detail, icon) {
    const hero = el("section", "light-card light-hero-detail");
    hero.append(lightAppIcon(icon, "sky"), lightTextStack(title, detail));
    return hero;
  }

  function calendarFormatTime(timestampMs, timeZone = calendarEffectiveTimeZone()) {
    const value = Number(timestampMs || 0);
    if (!Number.isFinite(value) || value <= 0) {
      return "Any time";
    }
    return new Date(value).toLocaleTimeString([], {
      hour: "numeric",
      minute: "2-digit",
      timeZone
    });
  }

  function calendarEventStartMs(event) {
    const start = Number(event?.start_at_ms || 0);
    if (!Number.isFinite(start) || start <= 0) {
      return 0;
    }
    return start;
  }

  function calendarEventEndMs(event) {
    const start = calendarEventStartMs(event);
    const end = Number(event?.end_at_ms || 0);
    if (!Number.isFinite(end) || end <= start) {
      return start;
    }
    return end;
  }

  function calendarEventDateKey(event, timeZone = calendarEffectiveTimeZone()) {
    const start = calendarEventStartMs(event);
    if (start > 0) {
      return calendarDateKeyFromTimestamp(start, timeZone) || normalizeCalendarDateKey(event?.date) || selectedCalendarDateKey();
    }
    return normalizeCalendarDateKey(event?.date) || selectedCalendarDateKey();
  }

  function calendarEventDayLabel(event, timeZone = calendarEffectiveTimeZone()) {
    return formatCalendarDateKey(calendarEventDateKey(event, timeZone), {
      weekday: "long",
      month: "long",
      day: "numeric"
    });
  }

  function calendarEventCompactDateLabel(event, timeZone = calendarEffectiveTimeZone()) {
    return formatCalendarDateKey(calendarEventDateKey(event, timeZone), {
      month: "long",
      day: "numeric"
    });
  }

  function calendarEventCompactWhenLabel(event, timeZone = calendarEffectiveTimeZone()) {
    return `${calendarEventCompactDateLabel(event, timeZone)}${DOT}${calendarEventTimeRange(event, timeZone)}`;
  }

  function calendarEventTimeRange(event, timeZone = calendarEffectiveTimeZone()) {
    const start = calendarEventStartMs(event);
    const end = calendarEventEndMs(event);
    if (!start) {
      return "Any time";
    }
    const startText = calendarFormatTime(start, timeZone);
    if (!end || end <= start) {
      return startText;
    }
    const endText = calendarFormatTime(end, timeZone);
    return `${startText} - ${endText}`;
  }

  function calendarEventColor(event, index = 0) {
    return calendarEventTone(event);
  }

  function defaultCalendarTypeFilters() {
    return {
      amber: true,
      blue: true,
      green: true,
      purple: true,
      red: true,
      slate: true
    };
  }

  function normalizeCalendarTypeFilters(value) {
    const next = defaultCalendarTypeFilters();
    if (!value || typeof value !== "object") {
      return next;
    }
    Object.keys(next).forEach(tone => {
      if (value[tone] === false) {
        next[tone] = false;
      }
    });
    return next;
  }

  function loadCalendarTypeFilters() {
    try {
      return normalizeCalendarTypeFilters(JSON.parse(localStorage.getItem("pucky.cover.calendar_type_filters.v1") || "null"));
    } catch (_error) {
      return defaultCalendarTypeFilters();
    }
  }

  function ensureCalendarTypeFilters() {
    if (!state.calendarTypeFilters || typeof state.calendarTypeFilters !== "object") {
      state.calendarTypeFilters = loadCalendarTypeFilters();
    }
    return state.calendarTypeFilters;
  }

  function persistCalendarTypeFilters() {
    try {
      localStorage.setItem("pucky.cover.calendar_type_filters.v1", JSON.stringify(ensureCalendarTypeFilters()));
    } catch (_error) {
      // Ignore persistence failures.
    }
  }

  function calendarToneEnabled(tone) {
    return ensureCalendarTypeFilters()[String(tone || "slate")] !== false;
  }

  function calendarEventTone(event) {
    const type = String(event?.metadata?.type || event?.status || "").trim().toLowerCase();
    const title = String(event?.title || "").trim().toLowerCase();
    const place = String(event?.metadata?.place || "").trim().toLowerCase();
    const haystack = [type, title, place].filter(Boolean).join(" ");
    if (haystack.includes("health") || haystack.includes("clinic") || haystack.includes("doctor")) {
      return "red";
    }
    if (haystack.includes("family") || haystack.includes("school") || haystack.includes("dinner")) {
      return "green";
    }
    if (haystack.includes("freelance") || haystack.includes("client") || haystack.includes("work")) {
      return "blue";
    }
    if (haystack.includes("meeting") || haystack.includes("call")) {
      return "purple";
    }
    if (haystack.includes("personal") || haystack.includes("home")) {
      return "amber";
    }
    return "slate";
  }

  function calendarEventTypeLabel(event) {
    const raw = String(event?.metadata?.type || "").trim();
    if (raw) {
      return raw
        .replace(/[_-]+/g, " ")
        .replace(/\b\w/g, char => char.toUpperCase());
    }
    const tone = calendarEventTone(event);
    return {
      red: "Health",
      green: "Family",
      blue: "Work",
      purple: "Call",
      amber: "Personal",
      slate: "Calendar"
    }[tone] || "Calendar";
  }

  function calendarTypeFilterOptions() {
    return [
      { tone: "amber", label: "Personal / Home" },
      { tone: "blue", label: "Freelance / Work" },
      { tone: "green", label: "Family" },
      { tone: "purple", label: "Call / Meeting" },
      { tone: "red", label: "Health" },
      { tone: "slate", label: "Other" }
    ];
  }

  function calendarDayTitle() {
    return "Calendar";
  }

  function selectedCalendarDateKey() {
    return normalizeCalendarDateKey(state.selectedCalendarDate) || calendarTodayDateKey();
  }

  function calendarSelectedDayHeadline(dayKey = selectedCalendarDateKey()) {
    if (dayKey === calendarTodayDateKey()) {
      return "Today";
    }
    if (dayKey === shiftCalendarDateKey(calendarTodayDateKey(), 1)) {
      return "Tomorrow";
    }
    return formatCalendarDateKey(dayKey, { weekday: "long", month: "long", day: "numeric" });
  }

  function calendarSelectedDayContext(dayKey = selectedCalendarDateKey()) {
    const fullDate = formatCalendarDateKey(dayKey, { weekday: "long", month: "long", day: "numeric" });
    const headline = calendarSelectedDayHeadline(dayKey);
    const zoneLabel = normalizeCalendarTimezonePreference(state.calendarTimeZone) === "device-local"
      ? `Device local${DOT}${calendarEffectiveTimeZone()}`
      : `Pinned${DOT}${calendarEffectiveTimeZone()}`;
    return headline === fullDate ? zoneLabel : `${fullDate}${DOT}${zoneLabel}`;
  }

  function calendarMonthHeading(dayKey = selectedCalendarDateKey()) {
    return formatCalendarDateKey(dayKey, { month: "long", year: "numeric" });
  }

  function normalizeCalendarMonthKey(value) {
    return /^\d{4}-\d{2}$/.test(String(value || "").trim()) ? String(value || "").trim() : "";
  }

  function calendarMonthKey(value = selectedCalendarDateKey()) {
    const dayKey = normalizeCalendarDateKey(value);
    return dayKey ? dayKey.slice(0, 7) : calendarTodayDateKey().slice(0, 7);
  }

  function calendarMonthDateFromKey(value) {
    const key = normalizeCalendarMonthKey(value);
    if (!key) {
      return null;
    }
    const [year, month] = key.split("-").map(Number);
    return new Date(Date.UTC(year, month - 1, 1, 12, 0, 0));
  }

  function shiftCalendarMonthKey(value, offsetMonths = 0) {
    const date = calendarMonthDateFromKey(value);
    if (!date) {
      return calendarMonthKey();
    }
    date.setUTCMonth(date.getUTCMonth() + Number(offsetMonths || 0), 1);
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
  }

  function calendarMonthDayKeys(monthKey) {
    const date = calendarMonthDateFromKey(monthKey);
    if (!date) {
      return [];
    }
    const targetMonth = date.getUTCMonth();
    const keys = [];
    while (date.getUTCMonth() === targetMonth) {
      keys.push(utcDateKey(date));
      date.setUTCDate(date.getUTCDate() + 1);
    }
    return keys;
  }

  function calendarDayRailMonthKeys(dayKey = selectedCalendarDateKey()) {
    const currentMonth = calendarMonthKey(dayKey);
    return [
      shiftCalendarMonthKey(currentMonth, -1),
      currentMonth,
      shiftCalendarMonthKey(currentMonth, 1)
    ];
  }

  function calendarDayWeekdayLabel(dayKey) {
    return formatCalendarDateKey(dayKey, { weekday: "short" }).replace(/\./g, "").toUpperCase();
  }

  function calendarDayMarkers(dayKey) {
    return workspaceItems("calendar-events")
      .filter(event => calendarEventDateKey(event) === dayKey)
      .filter(event => calendarToneEnabled(calendarEventTone(event)))
      .sort((a, b) => calendarEventStartMs(a) - calendarEventStartMs(b))
      .slice(0, 4)
      .map(event => calendarEventTone(event));
  }

  function calendarEventMarkerTone(event, index = 0) {
    return calendarEventTone(event);
  }

  function calendarEmptyStateTitle(dayKey = selectedCalendarDateKey()) {
    if (dayKey === calendarTodayDateKey()) {
      return "No events today";
    }
    if (dayKey === shiftCalendarDateKey(calendarTodayDateKey(), 1)) {
      return "No events tomorrow";
    }
    return `No events on ${formatCalendarDateKey(dayKey, { weekday: "long", month: "long", day: "numeric" })}`;
  }

  function ordinalSuffix(day) {
    const value = Number(day || 0);
    if ([11, 12, 13].includes(value % 100)) return "th";
    if (value % 10 === 1) return "st";
    if (value % 10 === 2) return "nd";
    if (value % 10 === 3) return "rd";
    return "th";
  }

  function lightDocumentEyebrow(label, detail) {
    const row = el("p", "light-doc-eyebrow");
    row.append(el("span", "", label), DOT, el("span", "", detail));
    return row;
  }

  function lightDocumentMeta(rows) {
    const meta = el("dl", "light-doc-meta");
    rows.forEach(([label, value]) => {
      meta.append(el("dt", "", label), el("dd", "", value));
    });
    return meta;
  }

  function filteredTasks(group) {
    return workspaceItems("tasks").filter(task => {
      const taskGroup = String(task.derived_group || "do");
      return taskGroup === group;
    });
  }

  function selectedContact() {
    return selectedWorkspaceRecord("contacts", state.selectedContactId);
  }

  function selectedMeeting() {
    return selectedWorkspaceRecord("calendar-events", state.selectedMeetingId);
  }


  function selectedMeetingNote() {
    return selectedWorkspaceRecord("meeting-notes", state.selectedMeetingNoteId);
  }

  function selectedReminder() {
    return selectedWorkspaceRecord("reminders", state.selectedReminderId);
  }

  function selectedNote() {
    return selectedWorkspaceRecord("notes", state.selectedNoteId);
  }

  function selectedTask() {
    return selectedWorkspaceRecord("tasks", state.selectedTaskId);
  }

  function selectedProject() {
    return selectedWorkspaceRecord("projects", state.selectedProjectId);
  }

  function allProjects() {
    return workspaceItems("projects");
  }

  function projectThreads(project) {
    const threads = project?.metadata?.threads;
    return Array.isArray(threads) ? threads.map(String).filter(Boolean) : [];
  }

  function projectAssets(project) {
    const assets = project?.metadata?.assets;
    return Array.isArray(assets) ? assets.map(String).filter(Boolean) : [];
  }

  function isLightDetailRoute(route) {
    return [
      "inbox-detail",
      "meeting-detail",
      "meeting-note-detail",
      "reminder-detail",
      "note-detail",
      "task-detail",
      "project-detail",
      "contact-detail",
      "contact-edit"
    ].includes(String(route || ""));
  }

  function selectedFeedItem() {
    return workspaceItems("feed-items").find(item => item.id === state.selectedFeedId) || workspaceItems("feed-items")[0] || null;
  }

  function workspaceRecordById(collection, id, fallback = null) {
    const normalizedId = String(id || "").trim();
    if (!normalizedId) {
      return fallback;
    }
    return workspaceItems(collection).find(item => item.id === normalizedId || item.record_id === normalizedId) || fallback;
  }

  function selectedWorkspaceRecord(collection, id, fallback = null) {
    return workspaceRecordById(collection, id, workspaceItems(collection)[0] || fallback);
  }

  function todayDateKey(offsetDays = 0) {
    const date = new Date();
    date.setDate(date.getDate() + Number(offsetDays || 0));
    return dateKey(date);
  }

  function normalizeCalendarDateKey(value) {
    return /^\d{4}-\d{2}-\d{2}$/.test(String(value || "").trim()) ? String(value || "").trim() : "";
  }

  function calendarDateFromKey(value) {
    const key = normalizeCalendarDateKey(value);
    if (!key) {
      return null;
    }
    const [year, month, day] = key.split("-").map(Number);
    return new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  }

  function utcDateKey(date) {
    const value = date instanceof Date ? date : new Date(date);
    if (Number.isNaN(value.getTime())) {
      return "";
    }
    return `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, "0")}-${String(value.getUTCDate()).padStart(2, "0")}`;
  }

  function shiftCalendarDateKey(value, offsetDays = 0) {
    const date = calendarDateFromKey(value);
    if (!date) {
      return calendarTodayDateKey();
    }
    date.setUTCDate(date.getUTCDate() + Number(offsetDays || 0));
    return utcDateKey(date);
  }

  function browserLocalTimeZone() {
    try {
      return String(Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC");
    } catch (_) {
      return "UTC";
    }
  }

  function isValidCalendarTimeZone(value) {
    try {
      Intl.DateTimeFormat([], { timeZone: String(value || "") }).format(new Date(0));
      return true;
    } catch (_) {
      return false;
    }
  }

  function normalizeCalendarTimezonePreference(value) {
    const raw = String(value || "").trim();
    if (!raw || raw === "device-local") {
      return "device-local";
    }
    return isValidCalendarTimeZone(raw) ? raw : "device-local";
  }

  function resolveCalendarTimeZone(preference) {
    const normalized = normalizeCalendarTimezonePreference(preference);
    return normalized === "device-local" ? browserLocalTimeZone() : normalized;
  }

  function calendarEffectiveTimeZone() {
    return resolveCalendarTimeZone(state.calendarTimeZone);
  }

  function resolveCalendarTimezonePreference() {
    try {
      return normalizeCalendarTimezonePreference(localStorage.getItem(CALENDAR_TIMEZONE_STATE_KEY));
    } catch (_) {
      return "device-local";
    }
  }

  function persistCalendarTimezonePreference(value) {
    try {
      localStorage.setItem(CALENDAR_TIMEZONE_STATE_KEY, normalizeCalendarTimezonePreference(value));
    } catch (_) {
      // Calendar timezone is a local preference and should never block the UI.
    }
  }

  function calendarDateParts(value, timeZone = calendarEffectiveTimeZone()) {
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) {
      return null;
    }
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).formatToParts(date);
    const year = parts.find(part => part.type === "year")?.value;
    const month = parts.find(part => part.type === "month")?.value;
    const day = parts.find(part => part.type === "day")?.value;
    if (!year || !month || !day) {
      return null;
    }
    return { year, month, day };
  }

  function calendarDateKeyFromTimestamp(timestampMs, timeZone = calendarEffectiveTimeZone()) {
    const parts = calendarDateParts(timestampMs, timeZone);
    if (!parts) {
      return "";
    }
    return `${parts.year}-${parts.month}-${parts.day}`;
  }

  function calendarTodayDateKey(timeZone = calendarEffectiveTimeZone()) {
    return calendarDateKeyFromTimestamp(Date.now(), timeZone) || todayDateKey();
  }

  function formatCalendarDateKey(value, options) {
    const date = calendarDateFromKey(value);
    if (!date) {
      return "Calendar";
    }
    return date.toLocaleDateString([], {
      timeZone: "UTC",
      ...options
    });
  }

  function calendarTimeZoneOptions() {
    if (Array.isArray(calendarTimeZoneOptionsCache)) {
      return calendarTimeZoneOptionsCache;
    }
    const values = [];
    try {
      if (typeof Intl.supportedValuesOf === "function") {
        values.push(...Intl.supportedValuesOf("timeZone"));
      }
    } catch (_) {
      // Fall through to the shorter fallback list.
    }
    if (!values.length) {
      values.push(
        browserLocalTimeZone(),
        "UTC",
        "America/Los_Angeles",
        "America/Denver",
        "America/Chicago",
        "America/New_York",
        "Europe/London",
        "Europe/Paris",
        "Asia/Tokyo",
        "Australia/Sydney"
      );
    }
    const unique = Array.from(new Set(values.filter(isValidCalendarTimeZone)));
    calendarTimeZoneOptionsCache = [
      { value: "device-local", label: "Device local" },
      ...unique.map(value => ({
        value,
        label: value.replace(/\//g, " / ").replace(/_/g, " ")
      }))
    ];
    return calendarTimeZoneOptionsCache;
  }

  function dateKey(date) {
    const value = date instanceof Date ? date : new Date(date);
    if (Number.isNaN(value.getTime())) {
      return "";
    }
    return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
  }

  function workspaceTimestamp(ms, fallback = "") {
    const value = Number(ms || 0);
    if (!Number.isFinite(value) || value <= 0) {
      return fallback;
    }
    return formatSmartTimestamp(new Date(value));
  }

  function workspaceHtml(record) {
    if (!record) {
      return "";
    }
    return String(record.html || "");
  }

  function workspaceHtmlThemePalette() {
    if (effectiveTheme() === "dark") {
      return {
        theme: "dark",
        background: "#08111c",
        text: "#f7f9fc",
        muted: "#9fb0c7",
        link: "#6ea8ff",
        surface: "rgba(247, 249, 252, 0.08)",
        border: "rgba(255, 255, 255, 0.12)"
      };
    }
    return {
      theme: "light",
      background: "#ffffff",
      text: "#111827",
      muted: "#667085",
      link: "#226fe8",
      surface: "#f4f7fb",
      border: "rgba(17, 24, 39, 0.08)"
    };
  }

  function workspaceHtmlBaseCss() {
    const palette = workspaceHtmlThemePalette();
    const fontStack = '"Aptos","Segoe UI",system-ui,sans-serif';
    return [
      `:root{color-scheme:${palette.theme};--pucky-doc-bg:${palette.background};--pucky-doc-text:${palette.text};--pucky-doc-muted:${palette.muted};--pucky-doc-link:${palette.link};--pucky-doc-surface:${palette.surface};--pucky-doc-border:${palette.border};}`,
      `html{background:var(--pucky-doc-bg);color:var(--pucky-doc-text);font-family:${fontStack};-webkit-text-size-adjust:100%;text-size-adjust:100%;}`,
      "*,:before,:after{box-sizing:border-box;}",
      `body{min-height:100vh;margin:0;padding:0;background:var(--pucky-doc-bg);color:var(--pucky-doc-text);font-family:${fontStack};font-size:16px;line-height:1.6;text-rendering:optimizeLegibility;-webkit-font-smoothing:antialiased;overflow-wrap:anywhere;}`,
      "body>:first-child{margin-top:0!important;}",
      "body>:last-child{margin-bottom:0!important;}",
      `h1,h2,h3,h4,h5,h6{margin:0 0 12px;color:var(--pucky-doc-text);font-family:${fontStack};line-height:1.08;letter-spacing:0;}`,
      "h1{font-size:clamp(1.9rem,5vw,2.5rem);font-weight:820;}",
      "h2{font-size:clamp(1.4rem,4vw,1.9rem);font-weight:780;}",
      "p,ul,ol,blockquote,pre,table{margin:0 0 14px;}",
      "ul,ol{padding-left:22px;}",
      "li+li{margin-top:6px;}",
      "a{color:var(--pucky-doc-link);}",
      "img,svg,video,canvas,table,iframe{max-width:100%;height:auto;}",
      "pre,code{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;}",
      "pre{padding:12px 14px;border-radius:14px;background:var(--pucky-doc-surface);white-space:pre-wrap;word-break:break-word;}",
      "table{width:100%;border-collapse:collapse;}",
      "td,th{padding:8px 0;border-top:1px solid var(--pucky-doc-border);text-align:left;vertical-align:top;}",
      "blockquote{padding-left:14px;border-left:3px solid var(--pucky-doc-border);color:var(--pucky-doc-muted);}"
    ].join("");
  }

  function normalizedWorkspaceHtmlDocument(sourceHtml) {
    const raw = String(sourceHtml || "").trim();
    if (!raw) {
      return "";
    }
    const fallbackDocument = `<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width, initial-scale=1"><style data-pucky-embedded-html="true">${workspaceHtmlBaseCss()}</style></head><body data-pucky-embedded-body="true">${raw}</body></html>`;
    try {
      const doc = new DOMParser().parseFromString(raw, "text/html");
      const root = doc.documentElement;
      const head = doc.head || doc.createElement("head");
      const body = doc.body || doc.createElement("body");
      if (!doc.head) {
        root.insertBefore(head, body);
      }
      if (!doc.body) {
        root.append(body);
      }
      if (!root.getAttribute("lang")) {
        root.setAttribute("lang", "en");
      }
      root.setAttribute("data-pucky-embedded-theme", workspaceHtmlThemePalette().theme);
      let viewport = head.querySelector('meta[name="viewport"]');
      if (!viewport) {
        viewport = doc.createElement("meta");
        head.prepend(viewport);
      }
      viewport.setAttribute("name", "viewport");
      viewport.setAttribute("content", "width=device-width, initial-scale=1");
      const existingStyle = head.querySelector('style[data-pucky-embedded-html="true"]');
      if (existingStyle) {
        existingStyle.remove();
      }
      const style = doc.createElement("style");
      style.setAttribute("data-pucky-embedded-html", "true");
      style.textContent = workspaceHtmlBaseCss();
      head.append(style);
      body.setAttribute("data-pucky-embedded-body", "true");
      return `<!doctype html>${root.outerHTML}`;
    } catch (error) {
      return fallbackDocument;
    }
  }

  function syncHtmlDetailFrameHeight(frame) {
    if (!(frame instanceof HTMLIFrameElement)) {
      return 0;
    }
    try {
      const root = frame.contentDocument.documentElement;
      const body = frame.contentDocument.body;
      const height = Math.max(
        Number(root?.scrollHeight || 0),
        Number(root?.offsetHeight || 0),
        Number(root?.clientHeight || 0),
        Number(body?.scrollHeight || 0),
        Number(body?.offsetHeight || 0),
        Number(body?.clientHeight || 0)
      );
      if (!Number.isFinite(height) || height <= 0) {
        return 0;
      }
      frame.style.height = `${height}px`;
      return height;
    } catch (error) {
      return 0;
    }
  }

  function installHtmlDetailFrameSizing(frame) {
    if (!(frame instanceof HTMLIFrameElement)) {
      return;
    }
    if (typeof frame.__puckyHtmlDetailFrameCleanup === "function") {
      frame.__puckyHtmlDetailFrameCleanup();
    }
    let rafId = 0;
    const schedule = () => {
      if (rafId) {
        return;
      }
      const run = () => {
        rafId = 0;
        syncHtmlDetailFrameHeight(frame);
      };
      if (typeof window !== "undefined" && typeof window.requestAnimationFrame === "function") {
        rafId = window.requestAnimationFrame(run);
        return;
      }
      rafId = window.setTimeout(run, 0);
    };
    const cleanup = [];
    const bind = () => {
      schedule();
      let doc = null;
      try {
        doc = frame.contentDocument;
      } catch (error) {
        doc = null;
      }
      if (!doc || !doc.body || doc.__puckyHtmlDetailFrameSizingBound) {
        return;
      }
      doc.__puckyHtmlDetailFrameSizingBound = true;
      if (typeof ResizeObserver === "function") {
        const observer = new ResizeObserver(() => schedule());
        observer.observe(doc.documentElement);
        observer.observe(doc.body);
        cleanup.push(() => observer.disconnect());
      }
      const docChange = () => schedule();
      doc.addEventListener("load", docChange, true);
      doc.addEventListener("toggle", docChange, true);
      cleanup.push(() => doc.removeEventListener("load", docChange, true));
      cleanup.push(() => doc.removeEventListener("toggle", docChange, true));
      if (doc.fonts && typeof doc.fonts.addEventListener === "function") {
        doc.fonts.addEventListener("loadingdone", docChange);
        cleanup.push(() => doc.fonts.removeEventListener("loadingdone", docChange));
      }
    };
    const onResize = () => schedule();
    window.addEventListener("resize", schedule);
    cleanup.push(() => window.removeEventListener("resize", schedule));
    frame.addEventListener("load", bind);
    cleanup.push(() => frame.removeEventListener("load", bind));
    frame.__puckyHtmlDetailFrameCleanup = () => {
      cleanup.splice(0).forEach(fn => {
        try {
          fn();
        } catch (error) {
          // Best-effort cleanup for detached detail frames.
        }
      });
      if (rafId && typeof window !== "undefined" && typeof window.cancelAnimationFrame === "function") {
        window.cancelAnimationFrame(rafId);
      }
      rafId = 0;
    };
    bind();
    onResize();
  }

  function lightHtmlDocument(record, fallbackText = "Generated page is loading.", options = {}) {
    const html = workspaceHtml(record);
    const untitledFallback = Boolean(options && options.untitledFallback);
    const extraClassName = String(options && options.className || "").trim();
    const fullBleed = Boolean(options && options.fullBleed);
    const revealOnLoad = String(options && options.revealOnLoad || "").trim().toLowerCase();
    const noteRevealOnLoad = revealOnLoad === "note";
    const noteFlashDebug = Boolean(options && options.noteFlashDebug && noteFlashDebugEnabled());
    if (!html) {
      if (untitledFallback) {
        return el("section", `light-html-empty ${fullBleed ? "light-html-stage" : ""} ${extraClassName}`.trim(), fallbackText);
      }
      return lightCopySection("Generated page", fallbackText);
    }
    const frame = el("iframe", "light-html-frame");
    frame.setAttribute("sandbox", "allow-same-origin");
    frame.setAttribute("scrolling", "no");
    frame.setAttribute("title", String(record?.title || "Generated page"));
    const wrap = el("section", `${fullBleed ? "light-html-card light-html-stage" : "light-card light-html-card"} ${extraClassName}`.trim());
    if (noteRevealOnLoad) {
      wrap.setAttribute("data-html-frame-state", "loading");
      wrap.setAttribute("aria-busy", "true");
      frame.style.visibility = "hidden";
    }
    if (noteFlashDebug) {
      noteFlashDebugRecord("note_detail_wrapper_created", {
        selected_note_id: noteRecordId(record),
        reason: "lightHtmlDocument"
      });
    }
    wrap.append(frame);
    installHtmlDetailFrameSizing(frame);
    if (!noteRevealOnLoad) {
      frame.srcdoc = normalizedWorkspaceHtmlDocument(html);
      return wrap;
    }
    let settled = false;
    let failOpenTimerId = 0;
    let srcdocAssigned = false;
    const markReady = (phase, reason) => {
      if (settled) {
        return;
      }
      settled = true;
      if (failOpenTimerId) {
        window.clearTimeout(failOpenTimerId);
      }
      wrap.setAttribute("data-html-frame-state", "ready");
      wrap.setAttribute("aria-busy", "false");
      frame.style.visibility = "visible";
      if (noteFlashDebug) {
        noteFlashDebugRecord(phase, {
          selected_note_id: noteRecordId(record),
          reason
        });
      }
    };
    const onLoad = () => {
      if (!srcdocAssigned) {
        return;
      }
      if (noteFlashDebug) {
        noteFlashDebugRecord("note_iframe_load", {
          selected_note_id: noteRecordId(record),
          reason: "load_event"
        });
      }
      let embeddedBodyReady = false;
      try {
        embeddedBodyReady = frame.contentDocument?.body?.getAttribute("data-pucky-embedded-body") === "true";
      } catch (_) {
        embeddedBodyReady = false;
      }
      if (embeddedBodyReady) {
        markReady("note_iframe_ready", "load_event");
      }
    };
    frame.addEventListener("load", onLoad);
    const iframeDelayMs = noteFlashDebug ? noteFlashDebugIframeDelayMs() : 0;
    failOpenTimerId = window.setTimeout(() => {
      markReady("note_iframe_fail_open", "fail_open_timeout");
    }, NOTE_FLASH_DEBUG_FAIL_OPEN_MS);
    const assignSrcdoc = () => {
      srcdocAssigned = true;
      frame.srcdoc = normalizedWorkspaceHtmlDocument(html);
      if (noteFlashDebug) {
        noteFlashDebugRecord("note_iframe_srcdoc_assigned", {
          selected_note_id: noteRecordId(record),
          reason: iframeDelayMs > 0 ? "delayed_srcdoc" : "srcdoc"
        });
      }
    };
    if (iframeDelayMs > 0) {
      window.setTimeout(assignSrcdoc, iframeDelayMs);
    } else {
      assignSrcdoc();
    }
    return wrap;
  }

  function filteredFeedEmptyView() {
    const empty = el("div", "empty feed-filter-empty");
    empty.append(
      el("div", "feed-filter-empty-icon", ""),
      el("div", "", state.showArchivedFeed ? "No archived replies." : "No selected replies."),
      el("small", "", state.showArchivedFeed ? "Archived replies from this device will appear here." : "Tap icons above to add card types back to the feed.")
    );
    empty.querySelector(".feed-filter-empty-icon").innerHTML = iconSvg(state.showArchivedFeed ? "archive_folder" : "mail", { filled: true });
    return empty;
  }

  function pendingTurnCard(status = state.turn, cards = state.cards) {
    const normalized = normalizeTurnStatus(status);
    const turnId = turnStatusTurnId(normalized);
    const transcript = turnUserTranscript(normalized);
    if (!turnId || !transcript) {
      return null;
    }
    const active = isTurnActive(normalized);
    const failed = turnFailed(normalized);
    if (!active && !failed) {
      return null;
    }
    const hasPersistedCard = (Array.isArray(cards) ? cards : []).some(card =>
      cardSessionId(card) === turnId || String(card?.card_id || "").trim() === turnId
    );
    if (hasPersistedCard) {
      return null;
    }
    const requestedThreadId = turnRequestedThreadId(normalized);
    const timestamp = turnStatusTimestamp(normalized) || new Date().toISOString();
    const pendingState = pendingTurnState(normalized);
    return {
      card_id: `pending:${turnId}`,
      session_id: turnId,
      turn_id: turnId,
      title: requestedThreadId ? "Continuing Thread" : "New Message",
      summary: transcript,
      transcript,
      created_at: timestamp,
      updated_at: timestamp,
      pending_outbound: true,
      pending_state: pendingState,
      pending_placeholder: pendingState === "sending",
      pending_user_transcript: transcript,
      pending_error: failed ? turnFailureSummary(normalized) : "",
      requested_thread_mode: turnRequestedThreadMode(normalized),
      requested_thread_id: requestedThreadId,
      synthetic_pending: true,
      origin: {
        thread_id: requestedThreadId
      }
    };
  }

  function feedDisplayCards(cards = state.cards) {
    const base = Array.isArray(cards) ? cards.filter(Boolean) : [];
    const pendingCard = pendingTurnCard(state.turn, base);
    return pendingCard ? [pendingCard, ...base] : base;
  }

  function filteredFeedCards(cards) {
    const displayCards = Array.isArray(cards) ? cards : feedDisplayCards();
    return displayCards.filter(card => {
      if (card && card.deleted) {
        return false;
      }
      const archived = Boolean(card && card.archived);
      if (isPendingOutboundCard(card)) {
        return state.showArchivedFeed ? archived : !archived;
      }
      return state.showArchivedFeed
        ? archived
        : !archived && isFeedIconIncluded(cardIconKey(card));
    });
  }

  function inboxManageSelection() {
    if (!(state.selectedInboxCardKeys instanceof Set)) {
      state.selectedInboxCardKeys = new Set(Array.isArray(state.selectedInboxCardKeys) ? state.selectedInboxCardKeys : []);
    }
    return state.selectedInboxCardKeys;
  }

  function inboxManageCardKey(card) {
    const cardId = String(card && card.card_id || "").trim();
    if (cardId) {
      return `card:${cardId}`;
    }
    const sessionId = cardSessionId(card);
    return sessionId ? `session:${sessionId}` : "";
  }

  function canManageInboxCard(card) {
    if (!card) {
      return false;
    }
    if (!String(card.card_id || "").trim()) {
      return false;
    }
    if (Boolean(card.synthetic_pending) && !isMeetingProcessingCard(card) && !isFailedPendingOutboundCard(card)) {
      return false;
    }
    if (!isPendingOutboundCard(card)) {
      return true;
    }
    return isFailedPendingOutboundCard(card);
  }

  function isInboxCardSelected(card) {
    const key = inboxManageCardKey(card);
    return Boolean(key && inboxManageSelection().has(key));
  }

  function reconcileInboxManageSelection(cards = filteredFeedCards(feedDisplayCards())) {
    const selection = inboxManageSelection();
    const visibleKeys = new Set((Array.isArray(cards) ? cards : [])
      .filter(canManageInboxCard)
      .map(inboxManageCardKey)
      .filter(Boolean));
    for (const key of Array.from(selection)) {
      if (!visibleKeys.has(key)) {
        selection.delete(key);
      }
    }
  }

  function selectedInboxManageCards() {
    const selection = inboxManageSelection();
    return filteredFeedCards(feedDisplayCards()).filter(card => {
      const key = inboxManageCardKey(card);
      return key && selection.has(key) && canManageInboxCard(card);
    });
  }

  function setInboxManageMode(active, options = {}) {
    state.inboxManageMode = Boolean(active);
    if (!state.inboxManageMode) {
      inboxManageSelection().clear();
    } else {
      reconcileInboxManageSelection();
    }
    dismissOpenCardMenu(false);
    if (options.render !== false) {
      render();
    }
  }

  function toggleInboxManageSelection(card) {
    if (!canManageInboxCard(card)) {
      return;
    }
    const key = inboxManageCardKey(card);
    if (!key) {
      return;
    }
    const selection = inboxManageSelection();
    if (selection.has(key)) {
      selection.delete(key);
    } else {
      selection.add(key);
    }
    render();
  }

  function clearInboxManageSelection() {
    inboxManageSelection().clear();
    render();
  }

  function inboxArchiveFilterPending() {
    return state.inboxArchiveFilterPendingTarget !== null && state.inboxArchiveFilterPendingTarget !== undefined;
  }

  function inboxArchiveFilterLabel(archived) {
    return archived ? "Archived" : "Active";
  }

  function inboxHeaderPillButton(config = {}) {
    const active = Boolean(config.active);
    const busy = Boolean(config.busy);
    const button = el("button", `light-pill inbox-header-pill ${config.className || ""}${active ? " is-active" : ""}${busy ? " is-loading" : ""}`.trim());
    button.type = "button";
    button.disabled = Boolean(config.disabled);
    if (config.ariaLabel) {
      button.setAttribute("aria-label", config.ariaLabel);
    }
    if (busy) {
      button.setAttribute("aria-busy", "true");
    }
    if (config.pressed !== undefined) {
      button.setAttribute("aria-pressed", config.pressed ? "true" : "false");
    }
    if (config.pendingTarget !== undefined) {
      button.dataset.pendingTarget = String(config.pendingTarget);
    }
    const icon = el("span", "inbox-header-pill-icon");
    icon.innerHTML = busy ? "" : iconSvg(config.icon || "archive_folder", { filled: true });
    if (busy) {
      icon.append(el("span", "inbox-header-spinner"));
    }
    button.append(icon, el("span", "inbox-header-pill-label", String(config.label || "")));
    if (typeof config.onClick === "function") {
      button.addEventListener("click", config.onClick);
    }
    return button;
  }

  function inboxManageHeaderAction() {
    const wrap = el("div", "inbox-header-actions");
    const filterPending = inboxArchiveFilterPending();
    const pendingTarget = filterPending ? Boolean(state.inboxArchiveFilterPendingTarget) : undefined;
    const displayArchived = filterPending ? pendingTarget : Boolean(state.showArchivedFeed);
    const archive = inboxHeaderPillButton({
      className: "inbox-archive-toggle",
      icon: displayArchived ? "archive_folder" : "mail",
      label: inboxArchiveFilterLabel(displayArchived),
      ariaLabel: filterPending
        ? `Loading ${displayArchived ? "archived replies" : "active replies"}`
        : `Inbox filter: ${displayArchived ? "Archived replies" : "Active replies"}`,
      active: displayArchived,
      busy: filterPending,
      disabled: filterPending,
      pressed: Boolean(state.showArchivedFeed),
      pendingTarget,
      onClick: () => {
        void toggleInboxArchivedFeed();
      }
    });
    const manage = inboxHeaderPillButton({
      className: "inbox-manage-toggle",
      icon: "checklist",
      label: state.inboxManageMode ? "Done" : "Manage",
      ariaLabel: state.inboxManageMode ? "Done managing Inbox" : "Manage Inbox",
      active: Boolean(state.inboxManageMode),
      disabled: filterPending,
      pressed: Boolean(state.inboxManageMode),
      onClick: () => setInboxManageMode(!state.inboxManageMode)
    });
    wrap.append(archive, manage);
    return wrap;
  }

  async function toggleInboxArchivedFeed() {
    if (inboxArchiveFilterPending()) {
      return;
    }
    const targetArchived = !state.showArchivedFeed;
    state.inboxArchiveFilterPendingTarget = targetArchived;
    state.inboxManageMode = false;
    inboxManageSelection().clear();
    dismissOpenCardMenu(false);
    render();
    try {
      await syncFeedCards({
        reason: targetArchived ? "show_archived_inbox" : "show_active_inbox",
        includeArchived: targetArchived,
        silent: false,
        render: false
      });
      state.showArchivedFeed = targetArchived;
      state.inboxArchiveFilterPendingTarget = null;
      reconcileInboxManageSelection();
      render();
    } catch (error) {
      state.inboxArchiveFilterPendingTarget = null;
      render();
      showToast(error instanceof Error ? error.message : String(error || "Feed unavailable"));
    }
  }

  function inboxManageToolbar() {
    if (!state.inboxManageMode) {
      return null;
    }
    reconcileInboxManageSelection();
    const count = inboxManageSelection().size;
    const actionLabel = state.showArchivedFeed ? "Unarchive" : "Archive";
    const bar = el("div", "inbox-manage-bar");
    bar.dataset.inboxManageSelectedCount = String(count);
    const status = el("div", "inbox-manage-count", `${count} selected`);
    const actions = el("div", "inbox-manage-actions");
    const archive = el("button", "inbox-manage-action is-primary", actionLabel);
    archive.type = "button";
    archive.disabled = count === 0;
    archive.addEventListener("click", () => {
      void archiveSelectedInboxCards();
    });
    const clear = el("button", "inbox-manage-action", "Clear");
    clear.type = "button";
    clear.disabled = count === 0;
    clear.addEventListener("click", clearInboxManageSelection);
    const cancel = el("button", "inbox-manage-action", "Cancel");
    cancel.type = "button";
    cancel.addEventListener("click", () => setInboxManageMode(false));
    actions.append(archive, clear, cancel);
    bar.append(status, actions);
    return bar;
  }

  function renderInboxManageOverlay() {
    const shell = document.querySelector(".app-shell");
    document.getElementById("inboxManageOverlay")?.remove();
    if (!shell || effectiveRoute() !== "inbox" || !state.inboxManageMode) {
      return;
    }
    const toolbar = inboxManageToolbar();
    if (!toolbar) {
      return;
    }
    const overlay = el("section", "inbox-manage-overlay");
    overlay.id = "inboxManageOverlay";
    overlay.setAttribute("aria-label", "Inbox management actions");
    overlay.append(toolbar);
    shell.append(overlay);
  }

  function applyOptimisticInboxBatchAction(cards, action) {
    const previousCards = state.cards.slice();
    const previousSelection = new Set(inboxManageSelection());
    const targetKeys = new Set((Array.isArray(cards) ? cards : []).map(inboxManageCardKey).filter(Boolean));
    const nextArchived = action === "archive";
    state.cards = state.cards.map(card => {
      const key = inboxManageCardKey(card);
      return key && targetKeys.has(key) ? { ...card, archived: nextArchived } : card;
    });
    inboxManageSelection().clear();
    reconcileFocusedCardSelection();
    reconcileReadOverrides();
    clearMissingFeedIconFilter();
    render();
    return () => {
      state.cards = previousCards;
      state.selectedInboxCardKeys = previousSelection;
      reconcileFocusedCardSelection();
      reconcileReadOverrides();
      clearMissingFeedIconFilter();
      render();
    };
  }

  async function archiveSelectedInboxCards() {
    const targets = selectedInboxManageCards();
    const action = state.showArchivedFeed ? "unarchive" : "archive";
    if (!targets.length) {
      return null;
    }
    dismissOpenCardMenu(false);
    const rollback = applyOptimisticInboxBatchAction(targets, action);
    try {
      const results = [];
      for (const card of targets) {
        const result = await postFeedAction(card, action);
        if (result === null || result && result.ok === false) {
          throw new Error(String(result && (result.error || result.detail) || "Feed action failed"));
        }
        results.push(result);
      }
      state.lastInboxManageResult = {
        action,
        ok: true,
        count: targets.length,
        error: ""
      };
      render();
      void syncFeedCards({
        reason: `inbox_manage_${action}`,
        includeArchived: state.showArchivedFeed,
        silent: true,
        render: true
      });
      return results;
    } catch (error) {
      rollback();
      state.lastInboxManageResult = {
        action,
        ok: false,
        count: targets.length,
        error: error instanceof Error ? error.message : String(error || "Feed action failed")
      };
      render();
      showToast(state.lastInboxManageResult.error);
      return null;
    }
  }

  function uniqueFeedIcons() {
    return uniqueFeedIconFilters().map(filter => filter.key);
  }

  function uniqueFeedIconFilters() {
    const seen = new Set();
    const filters = [];
    state.homeMenuIconLibrary.forEach(filter => {
      if (!filter || seen.has(filter.key)) {
        return;
      }
      seen.add(filter.key);
      filters.push({ ...filter });
    });
    state.cards.forEach(card => {
      if (!card || card.deleted || isPendingOutboundCard(card)) {
        return;
      }
      const icon = cardIconKey(card);
      if (!seen.has(icon)) {
        seen.add(icon);
        filters.push({
          key: icon,
          icon,
          label: `${icon} replies`,
          accent: card.accent || "#f5f9ff"
        });
        return;
      }
      const existing = filters.find(filter => filter.key === icon);
      if (existing && !existing.accent && card.accent) {
        existing.accent = card.accent;
      }
    });
    return filters;
  }

  function cardIconKey(card) {
    return normalizeReplyCardIcon(card && card.icon);
  }

  function isPendingOutboundCard(card) {
    return Boolean(card && card.pending_outbound);
  }

  function isFailedPendingOutboundCard(card) {
    if (!isPendingOutboundCard(card)) {
      return false;
    }
    const stateName = String(card.pending_state || "").trim();
    return stateName === "failed" || stateName === "upload_blocked";
  }

  function pendingOutboundSummary(card) {
    return String(card?.summary || card?.transcript || "Sending your message...");
  }

  function pendingOutboundStatusLabel(card) {
    const explicit = String(card?.pending_label || "").trim();
    if (explicit) {
      return explicit;
    }
    if (isFailedPendingOutboundCard(card)) {
      return "Failed";
    }
    return card?.pending_placeholder ? "Sending" : "Thinking";
  }

  function pendingOutboundStatusClass(card) {
    const label = pendingOutboundStatusLabel(card).toLowerCase();
    if (label === "failed") return "is-failed";
    if (label === "thinking") return "is-thinking";
    return "is-sending";
  }

  function clearMissingFeedIconFilter() {
    const validIcons = new Set(uniqueFeedIcons());
    let changed = false;
    Array.from(state.excludedFeedIcons).forEach(icon => {
      if (!validIcons.has(icon)) {
        state.excludedFeedIcons.delete(icon);
        changed = true;
      }
    });
    if (changed) {
      persistFeedIconExcludes();
    }
  }

  function isFeedIconIncluded(icon) {
    const key = String(icon || "");
    if (!key) {
      return state.excludedFeedIcons.size === 0;
    }
    return !state.excludedFeedIcons.has(key);
  }

  function toggleFeedIcon(icon) {
    const key = String(icon || "");
    if (!key) {
      return;
    }
    if (state.excludedFeedIcons.has(key)) {
      state.excludedFeedIcons.delete(key);
    } else {
      state.excludedFeedIcons.add(key);
    }
    persistFeedIconExcludes();
    render();
    persistNavState();
  }

  function settingsPageView() {
    const page = el("section", "settings-page");
    const cards = [
      appearanceSettingsCard(),
      defaultAudioSpeedSettingCard(),
      replyModeSettingsCard(),
      wakeWordSettingsCard(),
      arrivalCueSettingsCard(),
      modelSettingsCard(),
      reasoningEffortSettingsCard()
    ];
    cards.push(phoneRoleSettingsCard(), advancedSettingsCard());
    page.append(...cards);
    return page;
  }

  function appearanceSettingsCard() {
    const currentTheme = normalizeTheme(state.theme) || "dark";
    return settingsSelectorCard({
      settingId: "appearance",
      accent: "#8b63ff",
      icon: currentTheme === "light" ? "lightbulb_2" : "moon",
      title: "Appearance",
      detail: "Switch between dark and light.",
      valueLabel: appearanceThemeLabel(currentTheme),
      onOpen: () => openSettingsSelector({
        title: "Appearance",
        currentValue: currentTheme,
        options: [
          { value: "dark", label: "Dark" },
          { value: "light", label: "Light" }
        ],
        onSelect: setThemePreference
      })
    });
  }

  function appearanceThemeLabel(theme) {
    return normalizeTheme(theme) === "light" ? "Light" : "Dark";
  }

  function phoneRoleSettingsCard() {
    const status = normalizePhoneRoleStatus(state.phoneRole);
    const action = phoneRoleActionForStatus(status);
    return settingsSelectorCard({
      settingId: "phone-role",
      accent: status.role_held ? "#22c55e" : "#f59e0b",
      icon: "phone",
      title: "Phone app role",
      detail: phoneRoleSettingsDetail(status),
      valueLabel: phoneRoleSettingsValueLabel(status),
      onOpen: refreshPhoneRoleStatus,
      actionLabel: action.label,
      action: action.handler
    });
  }

  function phoneRoleSettingsDetail(status) {
    const holder = phoneRoleHolderLabel(status);
    if (status.source === "preview_unavailable") {
      return "Hosted web keeps phone-role state read-only. Open the APK on your phone to view or change it.";
    }
    if (status.source === "browser_live_api") {
      if (status.error_code === "unauthorized") {
        return "Hosted web does not expose phone-role state. Open the APK on your phone to view it.";
      }
      if (status.error_code === "device_context_unavailable") {
        return "Phone-role state is unavailable because Pucky could not choose a device cleanly.";
      }
      if (status.error_code === "device_offline") {
        return "The selected device is offline, so phone-role state cannot be read right now. Bring the device online in Pucky, then reload.";
      }
      if (status.error_code === "broker_command_failed") {
        return "Pucky reached the backend, but the device did not return phone-role state cleanly. Retry from the device once the bridge is healthy.";
      }
      const scope = status.device_id ? `Synced from ${status.device_id}` : "Synced from your device";
      return `${holder}. ${scope} in read-only mode. Use the APK on your phone to change the phone-app role.`;
    }
    return `${holder}. Enabling dialer mode unlocks direct call control, stays user-mediated through Android settings, and may replace the stock in-call UI while active.`;
  }

  function phoneRoleSettingsValueLabel(status) {
    if (status.source === "preview_unavailable") {
      return "Preview";
    }
    if (status.source === "browser_live_api" && status.error_code) {
      return "Read-only";
    }
    return status.role_held ? "On" : "Off";
  }

  function phoneRoleHolderLabel(status) {
    const label = String(status && status.default_dialer_label || "").trim();
    const packageName = String(status && status.default_dialer_package || "").trim();
    if (label && packageName && label !== packageName) {
      return `Current default: ${label} (${packageName})`;
    }
    if (label) {
      return `Current default: ${label}`;
    }
    if (packageName) {
      return `Current default: ${packageName}`;
    }
    return "Current default phone app unavailable";
  }

  function phoneRolePrimaryActionLabel(status) {
    return status && status.role_held ? "Restore stock phone app" : "Enable Pucky dialer mode";
  }

  function phoneRoleActionForStatus(status) {
    if (status.source !== "native_bridge" || status.read_only) {
      return { label: "", handler: null };
    }
    return {
      label: phoneRolePrimaryActionLabel(status),
      handler: runPhoneRolePrimaryAction
    };
  }

  async function runPhoneRolePrimaryAction() {
    const roleHeld = truthy(state.phoneRole && state.phoneRole.role_held);
    const command = roleHeld ? "phone.role.open_default_apps_settings" : "phone.role.request_setup";
    const args = roleHeld ? {} : { show_notification: true, open_setup_ui: true };
    try {
      await Pucky.request({ command, args });
      showToast(roleHeld
        ? "Opened Android default-app settings so you can switch away from Pucky."
        : "Opened the Android phone-app role flow for Pucky.");
    } catch (error) {
      showToast(String(error && error.message || "Phone role action failed"));
    }
    await loadPhoneRoleStatus({ render: true });
  }

  async function refreshPhoneRoleStatus() {
    await loadPhoneRoleStatus({ render: true });
  }

  function calendarTimeZoneSettingsCard() {
    const row = el("article", "settings-card settings-native-select-card");
    row.style.setProperty("--accent", "#3f6df6");
    row.setAttribute("data-setting-id", "calendar-time-zone");
    const iconEl = el("div", "settings-card-icon");
    iconEl.innerHTML = iconSvg("calendar", { filled: true });
    const copy = el("div", "settings-card-copy");
    copy.append(
      el("h2", "settings-card-title", "Calendar time zone"),
      el("p", "settings-card-detail", "Use your device clock or pin Calendar to a specific city.")
    );
    const control = el("label", "settings-native-select-control");
    const select = el("select", "settings-native-select");
    select.setAttribute("aria-label", "Calendar time zone");
    const meta = el("span", "settings-native-select-meta", `Now using ${calendarEffectiveTimeZone()}`);
    const currentValue = normalizeCalendarTimezonePreference(state.calendarTimeZone);
    calendarTimeZoneOptions().forEach(option => {
      const optionEl = document.createElement("option");
      optionEl.value = option.value;
      optionEl.textContent = option.label;
      optionEl.selected = option.value === currentValue;
      select.append(optionEl);
    });
    select.value = currentValue;
    select.addEventListener("change", () => {
      setCalendarTimezonePreference(select.value);
      meta.textContent = `Now using ${calendarEffectiveTimeZone()}`;
    });
    control.append(
      select,
      meta
    );
    row.append(iconEl, copy, control);
    return row;
  }

  function calendarEventTypeFiltersCard() {
    const section = el("section", "calendar-settings-card calendar-type-filter-card");
    section.append(
      el("h2", "calendar-settings-card-title", "Event types"),
      el("p", "calendar-settings-card-detail", "Show or hide event categories and their day-strip dots.")
    );
    const list = el("div", "calendar-type-filter-list");
    calendarTypeFilterOptions().forEach(option => list.append(calendarEventTypeFilterRow(option)));
    section.append(list);
    return section;
  }

  function calendarEventTypeFilterRow(option) {
    const row = el("label", "calendar-type-filter-row");
    row.dataset.tone = option.tone;
    const copy = el("span", "calendar-type-filter-copy");
    copy.append(
      el("span", `calendar-type-filter-dot ${option.tone}`),
      el("span", "calendar-type-filter-label", option.label)
    );
    const toggle = document.createElement("input");
    toggle.type = "checkbox";
    toggle.className = "calendar-type-filter-toggle";
    toggle.checked = calendarToneEnabled(option.tone);
    toggle.setAttribute("aria-label", option.label);
    toggle.addEventListener("change", () => {
      const filters = ensureCalendarTypeFilters();
      filters[option.tone] = Boolean(toggle.checked);
      persistCalendarTypeFilters();
      render();
    });
    row.append(copy, toggle);
    return row;
  }

  function setCalendarTimezonePreference(value) {
    const nextValue = normalizeCalendarTimezonePreference(value);
    if (nextValue === state.calendarTimeZone) {
      render();
      return;
    }
    state.calendarTimeZone = nextValue;
    persistCalendarTimezonePreference(nextValue);
    if (!state.selectedCalendarDate) {
      state.selectedCalendarDate = calendarTodayDateKey();
    }
    persistNavState();
    render();
  }

  function defaultAudioSpeedSettingCard() {
    const row = el("button", state.defaultAudioSpeedAvailable ? "settings-card" : "settings-card is-disabled");
    row.type = "button";
    row.style.setProperty("--accent", "#72c2ff");
    row.setAttribute("data-setting-id", "default-audio-speed");
    row.disabled = !state.defaultAudioSpeedAvailable;
    const iconEl = el("div", "settings-card-icon");
    iconEl.innerHTML = iconSvg("book", { filled: true });
    const copy = el("div", "settings-card-copy");
    copy.append(
      el("h2", "settings-card-title", "Default playback speed"),
      el(
        "p",
        "settings-card-detail",
        state.defaultAudioSpeedAvailable
          ? "Applies to future Home tile playback starts unless a tile already has its own saved speed."
          : "Device only. Connect the Android bridge to change this setting."
      )
    );
    const value = el("span", "settings-card-value", formatSpeed(state.defaultAudioSpeed));
    row.append(iconEl, copy, value);
    row.addEventListener("click", event => {
      event.preventDefault();
      if (!state.defaultAudioSpeedAvailable) {
        return;
      }
      openSpeedPicker({ kind: "setting" });
    });
    return row;
  }

  function linksPageView() {
    if (!linksPageRefs) {
      const page = el("section", "links-page");
      const message = el("div", "links-message", "");
      message.hidden = true;
      page.append(message);

      const empty = el("div", "links-empty", "");
      const emptyTitle = el("strong", "", "");
      const emptyBody = el("p", "", "");
      const retry = el("button", "links-open-button", "Retry");
      retry.type = "button";
      retry.hidden = true;
      retry.addEventListener("click", () => {
        linksDebugStartSession("route", { reason: "force_reload" });
        linksDebugRecord("links_route_enter", { reason: "force_reload" }, "route");
        loadLinksPortal({ render: true, force: true });
      });
      empty.append(emptyTitle, emptyBody, retry);
      page.append(empty);

      const connected = el("section", "links-connected");
      connected.append(el("div", "links-connected-label", "Connected"));
      const connectedStrip = el("div", "links-connected-strip");
      connected.append(connectedStrip);
      page.append(connected);

      const searchWrap = el("label", "links-search-wrap");
      searchWrap.setAttribute("for", "linksSearch");
      const search = el("input", "links-search");
      search.id = "linksSearch";
      search.type = "search";
      search.placeholder = "Search apps";
      search.autocomplete = "off";
      search.spellcheck = false;
      search.value = state.links.search;
      const onSearchInput = () => {
        state.links.search = search.value;
        const scrollport = linksScrollElement();
        if (scrollport && safeNumber(scrollport.scrollTop) > 0) {
          scrollport.scrollTop = 0;
        }
        linksDebugRecord("search_input", { search_value: state.links.search }, "route");
        syncLinksPage();
      };
      search.addEventListener("input", onSearchInput);
      search.addEventListener("search", onSearchInput);
      searchWrap.append(search);
      page.append(searchWrap);

      const listCard = el("section", "links-list-card");
      const listHead = el("div", "links-list-head");
      const listLabel = el("span", "links-list-label", "All Apps");
      const listCount = el("span", "links-list-count", "");
      listHead.append(listLabel, listCount);
      listCard.append(listHead);
      const scrollport = el("div", "links-list-scrollport");
      scrollport.id = "linksScrollport";
      const rows = el("div", "links-list-rows");
      scrollport.append(rows);
      listCard.append(scrollport);
      page.append(listCard);

      linksPageRefs = {
        page,
        message,
        empty,
        emptyTitle,
        emptyBody,
        retry,
        connected,
        connectedStrip,
        searchWrap,
        search,
        listCard,
        scrollport,
        listCount,
        rows
      };
      linksPageNode = page;
    }
    syncLinksPage();
    return linksPageNode;
  }

  function meetingsPageView(options = {}) {
    const embedded = Boolean(options && options.embedded);
    const page = el("section", embedded ? "meetings-page is-embedded-light" : "meetings-page");
    if (embedded) {
    } else {
      const header = el("div", "meetings-header");
      header.append(
        el("div", "meetings-kicker", "Meeting Recording Mode"),
        el("h2", "meetings-title", "Meetings")
      );
      page.append(header);
    }

    if (state.meetings.loading && !state.meetings.records.length) {
      page.append(el("div", "meetings-empty", "Loading meetings..."));
      return page;
    }
    if (state.meetings.error && !state.meetings.records.length) {
      page.append(el("div", "meetings-empty is-error", state.meetings.error));
      return page;
    }
    if (!state.meetings.records.length) {
      page.append(el("div", "meetings-empty", "No meeting recordings yet."));
      return page;
    }
    if (state.meetings.loading) {
      page.append(el("div", "meetings-refreshing", "Refreshing..."));
    }
    const list = el("section", "meetings-list-card");
    list.append(...visibleMeetingRecords().slice().reverse().map(meeting => cardView(meetingCardFromRecord(meeting))));
    page.append(list);
    return page;
  }

  function visibleMeetingRecords() {
    return state.meetings.records.filter(meeting => !Boolean(meeting && meeting.archived));
  }

  async function showMeetingDetail(meeting) {
    const meetingId = String(meeting && meeting.meeting_id || "").trim();
    const stateName = meetingState(meeting);
    const openDetail = (record, options = {}) => {
      if (meetingState(record) === "failed") {
        showMeetingFailedDetail(record, options);
        return true;
      }
      if (meetingState(record) !== "completed") {
        showTranscript(meetingCardFromRecord(record), options);
        return true;
      }
      showMeetingRuntimeDetail(record, options);
      return true;
    };
    if (stateName === "completed") {
      openDetail(meeting, { scrollTop: state.navDetail?.scroll_top });
    }
    if (!meetingId) {
      return;
    }
    const shouldLoadDetail = stateName === "failed" || !meetingHasFullDetail(meeting);
    if (!shouldLoadDetail) {
      openDetail(meeting, { scrollTop: state.navDetail?.scroll_top });
      return;
    }
    if (stateName !== "completed") {
      openDetail(meeting, { scrollTop: state.navDetail?.scroll_top });
    }
    try {
      const detail = await loadMeetingDetail(meeting);
      const panel = document.getElementById("detail");
      if (panel?.classList.contains("is-open") && panel.getAttribute("data-detail-session-id") === meetingId) {
        openDetail(detail, { scrollTop: state.navDetail?.scroll_top });
      }
    } catch (error) {
      showToast(meetingsApiErrorMessage(error));
      if (stateName === "completed") {
        openDetail(meeting, { scrollTop: state.navDetail?.scroll_top });
      }
    }
  }

  function openMeetingSummaryDetail(meeting, options = {}) {
    const card = meetingCardFromRecord(meeting);
    const attachments = meetingAttachmentsForCard(card);
    const summaryIndex = meetingSummaryAttachmentIndex(attachments, null);
    if (summaryIndex >= 0) {
      showAttachmentViewer(card, attachments, { initialIndex: summaryIndex, ...options });
      return true;
    }
    showTranscript(card, options);
    return false;
  }

  function meetingConnectedRecords(meeting) {
    const sources = [
      meeting?.connected_records,
      meeting?.card?.connected_records,
      meeting?.feed_item?.connected_records,
    ];
    for (const source of sources) {
      if (Array.isArray(source) && source.length) {
        return source.map(item => ({ ...(item && typeof item === "object" ? item : {}) }));
      }
    }
    const assistant = Array.isArray(meeting?.feed_item?.transcript_messages)
      ? meeting.feed_item.transcript_messages.find(item => String(item?.role || "").toLowerCase() === "assistant")
      : null;
    return Array.isArray(assistant?.connected_records)
      ? assistant.connected_records.map(item => ({ ...(item && typeof item === "object" ? item : {}) }))
      : [];
  }

  function meetingRuntimeStatusLabel(meeting) {
    const stateName = meetingState(meeting);
    if (stateName === "completed") return "Completed";
    if (stateName === "failed") return "Failed";
    if (stateName === "processing") return "Processing";
    return "Uploaded";
  }

  function meetingRuntimeWhenLabel(meeting) {
    const raw = String(meeting?.started_at || meeting?.created_at || "").trim();
    const timestamp = smartTimestamp(raw, "");
    const duration = formatMeetingDuration(safeNumber(meeting?.duration_ms));
    return [timestamp, duration].filter(Boolean).join(DOT) || "Unknown";
  }

  function meetingRuntimeAudioRow(meeting) {
    const duration = formatMeetingDuration(safeNumber(meeting?.duration_ms));
    const hasAudioSource = Boolean(meetingPlayablePath(meeting) || String(meeting?.audio_url || "").trim());
    if (!hasAudioSource) {
      return lightMeetingNoteDetailRow("audio", "Audio", duration || "Unavailable");
    }
    const row = el("button", "light-calendar-detail-row light-meeting-note-detail-row is-clickable");
    row.type = "button";
    row.dataset.detailRow = "audio";
    row.addEventListener("click", () => {
      void showMeetingAudioDetail(meeting);
    });
    row.append(
      el("strong", "light-calendar-detail-row-label", "Audio"),
      el("div", "light-calendar-detail-row-value", [duration, "Open recording"].filter(Boolean).join(DOT) || "Open recording")
    );
    return row;
  }

  function meetingRuntimeConnectedDetail(entry) {
    if (entry?.related) {
      return meetingNoteConnectedDetail(entry);
    }
    const kind = String(entry?.relatedKind || entry?.kind || "").trim();
    const kindLabel = graphKindLabel(kind);
    const summary = String(entry?.snapshot?.summary || "").trim();
    return [kindLabel, summary].filter(Boolean).join(DOT) || kindLabel;
  }

  function meetingRuntimeConnectedSection(meeting) {
    return lightLinkedRecordSection(meeting, {
      title: "Connected",
      entries: meetingConnectedRecords(meeting),
      showWhenEmpty: true,
      fromRoute: "meeting-detail",
      dedupeTargets: true,
      showChips: false,
      showChevron: false,
      variant: "flat",
      detailResolver: meetingRuntimeConnectedDetail,
      openOptions: {
        detailOrigin: {
          kind: "meeting_detail",
          route: "meetings",
          meetingId: String(meeting?.meeting_id || "").trim(),
        }
      },
    });
  }

  function meetingRuntimeDetailContent(meeting) {
    const content = el("div", "detail-content light-document-page light-meeting-runtime-detail");
    const summary = String(meeting?.card?.summary || meeting?.summary || "").trim();
    if (summary) {
      content.append(el("p", "light-event-summary-copy light-meeting-runtime-summary", summary));
    }
    const detailsSection = el("section", "light-calendar-detail-section light-meeting-note-details-section light-meeting-runtime-details-section");
    detailsSection.append(lightSectionTitle("Details"));
    const card = el("div", "light-calendar-detail-card");
    card.append(
      lightMeetingNoteDetailRow("when", "When", meetingRuntimeWhenLabel(meeting)),
      lightMeetingNoteDetailRow("status", "Status", meetingRuntimeStatusLabel(meeting)),
      meetingRuntimeAudioRow(meeting),
    );
    detailsSection.append(card);
    content.append(detailsSection, meetingRuntimeConnectedSection(meeting));
    return content;
  }

  function showMeetingRuntimeDetail(meeting, options = {}) {
    state.audioCard = null;
    const panel = document.getElementById("detail");
    const detailCard = meetingCardFromRecord(meeting);
    const content = meetingRuntimeDetailContent(meeting);
    applyDetailDataAttributes(panel, "meeting_runtime", detailCard, { viewer: "meeting_runtime" });
    openSideDetail(panel, meetingTitle(meeting), content, dismissDetail);
    rememberNavDetail("meeting_runtime", detailCard, options);
    installDetailScrollPersistence(content, "meeting_runtime");
    restoreScrollPosition(content, options.scrollTop);
    void syncVoiceThreadScope({ reason: "show_meeting_runtime_detail", render: true });
  }

  async function showMeetingAudioDetail(meeting) {
    const openAudio = (record) => {
      const card = meetingCardFromRecord(record);
      const attachments = meetingAttachmentsForCard(card);
      const audioIndex = meetingAttachmentIndexByTitle(attachments, "Meeting Audio");
      if (audioIndex >= 0) {
        showAttachmentViewer(card, attachments, { initialIndex: audioIndex });
        return true;
      }
      const fallback = {
        title: "Meeting Audio",
        kind: "audio",
        mime_type: card.audio_mime_type || "audio/mp4",
        path: card.audio_path || "",
        url: card.audio_url || ""
      };
      if (fallback.path || fallback.url) {
        void showAudioAttachment(card, fallback);
        return true;
      }
      return false;
    };
    if (openAudio(meeting)) {
      return;
    }
    if (!String(meeting && meeting.meeting_id || "").trim()) {
      showToast("Meeting audio is unavailable.");
      return;
    }
    try {
      const detail = await loadMeetingDetail(meeting);
      if (!openAudio(detail)) {
        showToast("Meeting audio is unavailable.");
      }
    } catch (error) {
      showToast(meetingsApiErrorMessage(error));
    }
  }

  function meetingHasFullDetail(meeting) {
    if (!meeting || typeof meeting !== "object") {
      return false;
    }
    const hasTranscriptDetail = Boolean(
      meeting.transcript_text
      || Array.isArray(meeting.speaker_turns) && meeting.speaker_turns.length
      || meeting.transcript_result
    );
    if (!hasTranscriptDetail) {
      return false;
    }
    if (meetingState(meeting) !== "completed") {
      return true;
    }
    const persistedMessages = Array.isArray(meeting?.feed_item?.transcript_messages)
      ? meeting.feed_item.transcript_messages
      : [];
    const persistedAssistant = persistedMessages.find(item => String(item?.role || "").toLowerCase() === "assistant") || null;
    const assistantAttachments = Array.isArray(persistedAssistant?.attachments) ? persistedAssistant.attachments : [];
    const connectedRecords = meetingConnectedRecords(meeting);
    return assistantAttachments.length > 0 || connectedRecords.length > 0;
  }

  function meetingCardFromRecord(meeting) {
    const card = meeting && typeof meeting === "object" ? meeting : {};
    const agentCard = card.card && typeof card.card === "object" ? card.card : {};
    const attachments = meetingRecordAttachments(card);
    return {
      session_id: String(card.meeting_id || agentCard.session_id || ""),
      title: meetingTitle(card),
      icon: "mic",
      accent: "#72c2ff",
      read: true,
      created_at: String(card.started_at || card.created_at || ""),
      updated_at: String(card.updated_at || card.stopped_at || ""),
      summary: String(agentCard.summary || card.transcript_text || (meetingState(card) === "processing" ? "Processing..." : "")),
      audio_path: meetingPlayablePath(card),
      audio_url: String(card.audio_url || ""),
      audio_mime_type: String(card.mime_type || "audio/mp4"),
      audio_duration_ms: safeNumber(card.duration_ms),
      attachments,
      connected_records: meetingConnectedRecords(card),
      transcript_messages: meetingTranscriptMessages(card),
      is_meeting_recording: true,
      render_profile: "meeting_list",
      meeting_record: card
    };
  }

  function meetingRecordAttachments(meeting) {
    const record = meeting && typeof meeting === "object" ? meeting : {};
    const meetingId = String(record.meeting_id || "").trim();
    const attachments = [];
    const transcriptArtifactId = meetingId ? `pucky_card_${meetingId}:meeting_transcript` : "";
    const transcriptPath = String(record.transcript_path || "").trim();
    const transcriptText = meetingTranscriptText(record);
    if (transcriptText || transcriptPath || transcriptArtifactId) {
      attachments.push({
        id: `meeting-transcript-text-${meetingId || "current"}`,
        title: "Transcript (Plain Text)",
        kind: "text",
        mime_type: "text/plain",
        path: transcriptPath,
        artifact: transcriptArtifactId,
        text: transcriptText,
        meeting_id: meetingId
      });
    }
    const audioUrl = String(record.audio_url || "").trim();
    const audioPath = String(record.audio_path || "").trim();
    if (audioUrl || audioPath) {
      attachments.push({
        id: `meeting-audio-${meetingId || "current"}`,
        title: "Meeting Audio",
        kind: "audio",
        mime_type: String(record.mime_type || "audio/mp4"),
        url: audioUrl,
        path: audioPath,
        meeting_id: meetingId
      });
    }
    return attachments;
  }

  function decodeMeetingSummaryBase64(contentBase64) {
    const value = String(contentBase64 || "").trim();
    if (!value) {
      return "";
    }
    try {
      return atob(value);
    } catch (_) {
      return "";
    }
  }

  function extractMeetingSummaryLink(htmlText, pattern) {
    const match = String(htmlText || "").match(pattern);
    return absolutizeAppUrl(match ? String(match[1] || "").trim() : "");
  }

  function absolutizeAppUrl(url) {
    const value = String(url || "").trim();
    if (!value) {
      return "";
    }
    try {
      return new URL(value, window.location.origin).href;
    } catch (_) {
      return value;
    }
  }

  function meetingAttachmentsForCard(card) {
    const primary = preferredDisplayAttachments(card, card?.attachments);
    if (primary.length) {
      return primary;
    }
    return assistantAttachmentsForCard(card);
  }

  function meetingPlayablePath(meeting) {
    const devicePath = String(meeting && meeting.device_path || "").trim();
    if (isAndroidPlayableAudioPath(devicePath)) {
      return devicePath;
    }
    const audioPath = String(meeting && meeting.audio_path || "").trim();
    return isAndroidPlayableAudioPath(audioPath) ? audioPath : "";
  }

  function isAndroidLocalArtifactPath(path) {
    const value = String(path || "").trim();
    return Boolean(value)
      && !/^[A-Za-z]:[\\/]/.test(value)
      && !value.startsWith("/data/pucky-src/")
      && (
        value.startsWith("/data/data/com.pucky.device")
        || value.startsWith("/data/user/")
        || value.startsWith("/storage/emulated/")
        || value.startsWith("/sdcard/")
        || value.startsWith("content://")
      );
  }

  function isAndroidPlayableAudioPath(path) {
    return isAndroidLocalArtifactPath(path);
  }

  function meetingTranscriptMessages(meeting) {
    const transcript = meetingTranscriptText(meeting);
    const summary = String(
      meeting && meeting.card && meeting.card.summary
      || meeting && meeting.feed_item && meeting.feed_item.summary
      || ""
    ).trim();
    const persistedMessages = Array.isArray(meeting?.feed_item?.transcript_messages)
      ? meeting.feed_item.transcript_messages
      : [];
    const persistedUser = persistedMessages.find(item => String(item?.role || "").toLowerCase() === "user") || null;
    const persistedAssistant = persistedMessages.find(item => String(item?.role || "").toLowerCase() === "assistant") || null;
    const assistantAttachments = normalizedAttachments(persistedAssistant?.attachments);
    const messages = [];
    const transcriptText = transcript || String(persistedUser?.text || "").trim();
    if (transcriptText) {
      messages.push({ role: "user", text: transcriptText, created_at: meeting.started_at || meeting.created_at || persistedUser?.created_at || "" });
    }
    const assistantText = summary || String(persistedAssistant?.text || "").trim();
    if (assistantText || assistantAttachments.length) {
      messages.push({
        role: "assistant",
        text: assistantText || "Meeting processed.",
        created_at: meeting.updated_at || persistedAssistant?.created_at || "",
        attachments: assistantAttachments
      });
    }
    return messages.length ? messages : [{ role: "assistant", text: "No transcript is attached to this meeting yet." }];
  }

  function meetingTranscriptText(meeting) {
    return String(meeting && meeting.transcript_text || "").replace(/\r\n/g, "\n").trim();
  }

  function meetingFailedSummary(meeting) {
    const cardSummary = String(meeting && meeting.card && meeting.card.summary || "").trim();
    if (cardSummary) {
      return cardSummary;
    }
    const transcriptError = String(meeting && meeting.transcript_error || "").trim();
    if (transcriptError) {
      return transcriptError;
    }
    const failureReason = String(meeting && meeting.failure_reason || "").trim();
    if (failureReason) {
      return failureReason;
    }
    return "Processing stopped before the meeting agent finished.";
  }

  function meetingTitle(meeting) {
    const raw = meeting && typeof meeting === "object" ? meeting : {};
    const card = raw.card && typeof raw.card === "object" ? raw.card : {};
    return String(raw.title || card.title || raw.recording_title || card.recording_title || raw.meeting_id || "Meeting Recording");
  }

  function meetingState(meeting) {
    const value = String(meeting && meeting.state || "uploaded").toLowerCase();
    return ["uploaded", "processing", "completed", "failed"].includes(value) ? value : "uploaded";
  }

  function meetingRowTimestamp(meeting) {
    const raw = meeting && (meeting.updated_at || meeting.stopped_at || meeting.started_at || meeting.created_at) || "";
    const text = smartTimestamp(raw, "");
    if (!text) {
      return null;
    }
    const date = parseDate(raw);
    return { text, iso: date ? date.toISOString() : String(raw) };
  }

  function formatMeetingDuration(durationMs) {
    const totalSeconds = Math.round(safeNumber(durationMs) / 1000);
    if (totalSeconds <= 0) {
      return "";
    }
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${String(seconds).padStart(2, "0")}`;
  }

  function replyModeSettingsCard() {
    const options = (state.turnSettings.modes || TURN_REPLY_MODES).map(mode => ({
      value: normalizeReplyMode(mode),
      label: replyModeLabel(mode)
    }));
    const currentMode = normalizeReplyMode(state.turnSettings.reply_mode);
    return settingsSelectorCard({
      settingId: "reply-playback",
      accent: "#ffb000",
      icon: "mic",
      title: "Reply playback",
      detail: "Choose if replies stay as cards or also speak.",
      valueLabel: replyModeLabel(currentMode),
      onOpen: () => openSettingsSelector({
        title: "Reply playback",
        currentValue: currentMode,
        options,
        onSelect: setTurnReplyMode
      })
    });
  }

  async function setTurnReplyMode(mode) {
    const replyMode = normalizeReplyMode(mode);
    state.turnSettings = normalizeTurnSettings({
      ...state.turnSettings,
      reply_mode: replyMode
    });
    render();
    try {
      const updated = await Pucky.request({
        command: "pucky.turn.settings.set",
        args: {
          reply_mode: replyMode,
          arrival_cue_mode: state.turnSettings.arrival_cue_mode
        }
      });
      invalidateBridgeReadCache("pucky.turn.settings.get");
      state.turnSettings = normalizeTurnSettings(updated);
      render();
    } catch (_) {
      // Browser preview keeps the optimistic local value.
    }
  }

  function wakeWordSettingsCard() {
    return settingsToggleCard({
      accent: "#72c2ff",
      icon: "record_voice_over",
      title: "Wake word",
      detail: wakeStatusDetail(state.wakeStatus),
      enabled: state.wakeStatus.enabled,
      onToggle: setWakeWordEnabled
    });
  }

  function arrivalCueSettingsCard() {
    const options = (state.turnSettings.arrival_cue_modes || TURN_ARRIVAL_CUE_MODES).map(mode => ({
      value: normalizeArrivalCueMode(mode),
      label: arrivalCueLabel(mode)
    }));
    const currentMode = normalizeArrivalCueMode(state.turnSettings.arrival_cue_mode);
    return settingsSelectorCard({
      accent: "#ffb000",
      icon: "bell",
      title: "Message sent cue",
      detail: "Cue when your message lands.",
      valueLabel: arrivalCueLabel(currentMode),
      onOpen: () => openSettingsSelector({
        title: "Message sent cue",
        currentValue: currentMode,
        options,
        onSelect: setArrivalCueMode
      }),
      actionLabel: "Test cue",
      action: testArrivalCue
    });
  }

  async function setWakeWordEnabled(enabled) {
    state.wakeStatus = normalizeWakeStatus({
      ...state.wakeStatus,
      enabled,
      requested_enabled: enabled,
      running: enabled ? state.wakeStatus.running : false,
      state: enabled ? state.wakeStatus.state : "idle",
      suspended_reason: enabled
        ? state.wakeStatus.running
          ? ""
          : state.wakeStatus.suspended_reason || "service_not_started"
        : "disabled"
    });
    render();
    try {
      const updated = await Pucky.request({
        command: enabled ? "wake.start" : "wake.stop",
        args: { enabled }
      });
      invalidateBridgeReadCache("wake.status");
      state.wakeStatus = normalizeWakeStatus(updated);
      render();
    } catch (_) {
      // Browser preview keeps the optimistic local state.
    }
  }

  async function setArrivalCueMode(mode) {
    const arrivalCueMode = normalizeArrivalCueMode(mode);
    state.turnSettings = normalizeTurnSettings({
      ...state.turnSettings,
      arrival_cue_mode: arrivalCueMode
    });
    render();
    try {
      const updated = await Pucky.request({
        command: "pucky.turn.settings.set",
        args: {
          reply_mode: state.turnSettings.reply_mode,
          arrival_cue_mode: arrivalCueMode
        }
      });
      invalidateBridgeReadCache("pucky.turn.settings.get");
      state.turnSettings = normalizeTurnSettings(updated);
      render();
    } catch (_) {
      // Browser preview keeps the optimistic local state.
    }
  }

  async function testArrivalCue() {
    try {
      await Pucky.request({ command: "pucky.turn.sent_cue.test", args: {} });
    } catch (_) {
      showToast("Could not test the message sent cue.");
    }
  }

  function modelSettingsCard() {
    const options = (state.turnSettings.model_options || TURN_MODEL_OPTIONS).map(model => ({
      value: normalizeTurnModel(model),
      label: turnModelLabel(model)
    }));
    const currentModel = normalizeTurnModel(state.turnSettings.model);
    return settingsSelectorCard({
      settingId: "turn-model",
      accent: "#63c1a5",
      icon: "smart_toy",
      title: "Session model",
      detail: "Default OpenAI model. Applies to new sessions.",
      valueLabel: turnModelLabel(currentModel),
      onOpen: () => openSettingsSelector({
        title: "Session model",
        currentValue: currentModel,
        options,
        onSelect: setTurnModel
      })
    });
  }

  async function setTurnModel(model) {
    const nextModel = normalizeTurnModel(model);
    state.turnSettings = normalizeTurnSettings({
      ...state.turnSettings,
      model: nextModel
    });
    render();
    try {
      const updated = await Pucky.request({
        command: "pucky.turn.settings.set",
        args: {
          model: nextModel
        }
      });
      invalidateBridgeReadCache("pucky.turn.settings.get");
      state.turnSettings = normalizeTurnSettings(updated);
      render();
    } catch (_) {
      // Browser preview keeps the optimistic local value.
    }
  }

  function reasoningEffortSettingsCard() {
    const options = (state.turnSettings.reasoning_effort_options || TURN_REASONING_EFFORT_OPTIONS).map(value => ({
      value: normalizeTurnReasoningEffort(value),
      label: reasoningEffortLabel(value)
    }));
    const currentEffort = normalizeTurnReasoningEffort(state.turnSettings.reasoning_effort);
    return settingsSelectorCard({
      settingId: "turn-reasoning-effort",
      accent: "#72c2ff",
      icon: "psychology",
      title: "Thinking level",
      detail: "Default reasoning effort. Applies to new sessions.",
      valueLabel: reasoningEffortLabel(currentEffort),
      onOpen: () => openSettingsSelector({
        title: "Thinking level",
        currentValue: currentEffort,
        options,
        onSelect: setTurnReasoningEffort
      })
    });
  }

  async function setTurnReasoningEffort(reasoningEffort) {
    const nextEffort = normalizeTurnReasoningEffort(reasoningEffort);
    state.turnSettings = normalizeTurnSettings({
      ...state.turnSettings,
      reasoning_effort: nextEffort
    });
    render();
    try {
      const updated = await Pucky.request({
        command: "pucky.turn.settings.set",
        args: {
          reasoning_effort: nextEffort
        }
      });
      invalidateBridgeReadCache("pucky.turn.settings.get");
      state.turnSettings = normalizeTurnSettings(updated);
      render();
    } catch (_) {
      // Browser preview keeps the optimistic local value.
    }
  }

  function setThemePreference(theme) {
    const nextTheme = normalizeTheme(theme) || "dark";
    const previousTheme = state.theme;
    const nextRoute = resolveRouteForTheme(state.route, nextTheme);
    state.theme = nextTheme;
    persistTheme(nextTheme);
    syncThemeQueryParam(nextTheme);
    if (nextRoute !== state.route) {
      dismissTransientUiForRouteChange();
      state.route = nextRoute;
      state.lightReturnRoute = "";
      state.previousLightRoute = "home";
    }
    if (previousTheme !== nextTheme && nextRoute === "settings") {
      loadSettingsState({ render: false });
    }
    persistNavState();
    render();
  }

  function settingsToggleCard({ accent, icon, title, detail, enabled, onToggle }) {
    const row = el("article", "settings-card");
    row.style.setProperty("--accent", accent || "#72c2ff");
    const iconEl = el("div", "settings-card-icon");
    iconEl.innerHTML = iconSvg(icon, { filled: true });
    const copy = el("div", "settings-card-copy");
    copy.append(
      el("h2", "settings-card-title", title),
      el("p", "settings-card-detail", detail)
    );
    const toggle = settingsToggleButton(enabled, async () => {
      await onToggle(!enabled);
    });
    row.append(iconEl, copy, toggle);
    return row;
  }

  function settingsSelectorCard({ settingId = "", accent, icon, title, detail, valueLabel, onOpen, actionLabel = "", action = null }) {
    const row = el("article", actionLabel ? "settings-card settings-selector-card has-actions" : "settings-card settings-selector-card");
    if (settingId) {
      row.setAttribute("data-setting-id", String(settingId));
    }
    row.style.setProperty("--accent", accent || "#72c2ff");
    const iconEl = el("div", "settings-card-icon");
    iconEl.innerHTML = iconSvg(icon, { filled: true });
    const copy = el("div", "settings-card-copy");
    copy.append(
      el("h2", "settings-card-title", title),
      el("p", "settings-card-detail", detail)
    );
    const selector = settingsSelectorButton(valueLabel, onOpen);
    row.append(iconEl, copy, selector);
    if (actionLabel && action) {
      const actions = el("div", "settings-card-actions");
      actions.append(settingsActionButton(actionLabel, action));
      row.append(actions);
    }
    return row;
  }

  function settingsToggleButton(enabled, onClick) {
    const button = el("button", enabled ? "settings-toggle is-on" : "settings-toggle");
    button.type = "button";
    button.setAttribute("aria-pressed", enabled ? "true" : "false");
    button.append(
      el("span", "settings-toggle-track"),
      el("span", "settings-toggle-thumb")
    );
    button.addEventListener("click", event => {
      event.preventDefault();
      onClick();
    });
    return button;
  }

  function settingsSelectorButton(label, onClick) {
    const button = el("button", "settings-selector-button");
    button.type = "button";
    button.setAttribute("aria-haspopup", "dialog");
    button.append(
      el("span", "settings-selector-button-label", label),
      (() => {
        const icon = el("span", "settings-selector-button-icon");
        icon.innerHTML = iconSvg("expand_more", { filled: true });
        return icon;
      })()
    );
    button.addEventListener("click", event => {
      event.preventDefault();
      event.stopPropagation();
      onClick();
    });
    return button;
  }

  function advancedSettingsCard() {
    const card = el("button", "settings-card settings-nav-card");
    card.type = "button";
    card.style.setProperty("--accent", "#8b63ff");
    const icon = el("div", "settings-card-icon");
    icon.innerHTML = iconSvg("tune", { filled: true });
    const copy = el("div", "settings-card-copy");
    copy.append(
      el("h2", "settings-card-title", "Advanced"),
      el("p", "settings-card-detail", "Bundle, surface, wake, bridge.")
    );
    const chevron = el("span", "settings-nav-chevron");
    chevron.innerHTML = iconSvg("navigate_next");
    card.append(icon, copy, chevron);
    card.addEventListener("click", event => {
      event.preventDefault();
      showAdvancedSettingsSheet();
    });
    return card;
  }

  function settingsActionButton(label, action) {
    const button = el("button", "settings-action-button", label);
    button.type = "button";
    button.addEventListener("click", event => {
      event.preventDefault();
      action();
    });
    return button;
  }

  function settingsDiagnosticItem(label, value) {
    const item = el("div", "settings-diagnostic-item");
    item.append(
      el("span", "settings-diagnostic-label", label),
      el("span", "settings-diagnostic-value", value)
    );
    return item;
  }

  function openOverlay(overlayId, content, onBackdropClick) {
    const overlay = document.getElementById(overlayId);
    if (!overlay) {
      return null;
    }
    overlay.replaceChildren(content);
    overlay.classList.add("is-open");
    overlay.setAttribute("aria-hidden", "false");
    overlay.onclick = event => {
      if (event.target === overlay && typeof onBackdropClick === "function") {
        onBackdropClick();
      }
    };
    return overlay;
  }

  function closeOverlay(overlayId, { clearChildren = true } = {}) {
    const overlay = document.getElementById(overlayId);
    if (!overlay) {
      return null;
    }
    overlay.classList.remove("is-open");
    overlay.setAttribute("aria-hidden", "true");
    overlay.onclick = null;
    if (clearChildren) {
      overlay.replaceChildren();
    }
    return overlay;
  }

  function openSettingsSelector({ title, currentValue, options, onSelect }) {
    dismissAdvancedSettingsSheet();
    const sheet = el("div", "settings-selector-sheet");
    sheet.addEventListener("click", event => event.stopPropagation());
    sheet.append(el("h1", "settings-selector-title", title));
    const list = el("div", "settings-selector-list");
    for (const option of options) {
      const active = currentValue === option.value;
      const button = el("button", active ? "settings-selector-option is-active" : "settings-selector-option");
      button.type = "button";
      button.setAttribute("aria-pressed", active ? "true" : "false");
      button.setAttribute("data-selector-value", String(option.value || ""));
      const copy = el("span", "settings-selector-option-copy");
      copy.append(el("span", "settings-selector-option-label", option.label));
      if (String(option.meta || "").trim()) {
        copy.append(el("span", "settings-selector-option-meta", String(option.meta || "").trim()));
      }
      const leading = el("span", "settings-selector-option-leading");
      if (option.leadingNode instanceof Node) {
        leading.append(option.leadingNode);
      } else if (String(option.icon || "").trim()) {
        leading.innerHTML = iconSvg(String(option.icon || "").trim(), { filled: false });
      }
      button.append(
        leading,
        copy,
        (() => {
          const check = el("span", "settings-selector-option-check");
          check.innerHTML = iconSvg("check");
          return check;
        })()
      );
      button.addEventListener("click", event => {
        event.preventDefault();
        event.stopPropagation();
        closeSettingsSelector();
        onSelect(option.value);
      });
      list.append(button);
    }
    sheet.append(list);
    openOverlay("settingsSelectorOverlay", sheet, closeSettingsSelector);
  }

  function closeSettingsSelector() {
    closeOverlay("settingsSelectorOverlay");
  }

  function showAdvancedSettingsSheet() {
    closeSettingsSelector();
    const sheet = document.getElementById("settingsSheet");
    if (!sheet) {
      return;
    }
    const wrap = el("div", "trace-inner settings-sheet-inner");
    const dragZone = el("div", "sheet-drag-zone");
    dragZone.append(el("div", "sheet-grip"));
    wrap.append(dragZone);

    const card = el("article", "trace-card settings-sheet-card");
    card.append(
      el("h1", "trace-title", "Advanced"),
      el("p", "trace-empty", "Live bundle and bridge facts from this cover shell.")
    );
    const diagnostics = el("div", "settings-diagnostics settings-sheet-diagnostics");
    diagnostics.append(
      settingsDiagnosticItem("Bundle", state.uiSurface.ui_version || "unknown"),
      settingsDiagnosticItem("Surface", formatSurfaceKind(state.uiSurface.source_kind)),
      settingsDiagnosticItem(
        "Wake",
        state.wakeStatus.running
          ? "listening"
          : state.wakeStatus.suspended_reason
            ? state.wakeStatus.suspended_reason.replaceAll("_", " ")
            : state.wakeStatus.enabled || state.wakeStatus.requested_enabled
              ? "requested"
              : "off"
      ),
      settingsDiagnosticItem("Bridge", state.uiSurface.bridge_connected ? "connected" : "browser")
    );
    card.append(diagnostics);
    wrap.append(card);
    installVerticalDismiss(wrap, sheet, dismissAdvancedSettingsSheet);
    sheet.replaceChildren(wrap);
    sheet.setAttribute("aria-hidden", "false");
    sheet.classList.add("is-open");
    sheet.onclick = event => {
      if (event.target === sheet) {
        dismissAdvancedSettingsSheet();
      }
    };
  }

  function dismissAdvancedSettingsSheet() {
    const sheet = document.getElementById("settingsSheet");
    if (!sheet) {
      return;
    }
    sheet.style.transform = "";
    sheet.classList.remove("is-open", "is-dragging");
    sheet.setAttribute("aria-hidden", "true");
    sheet.onclick = null;
    sheet.replaceChildren();
  }

  function formatSurfaceKind(kind) {
    const value = String(kind || "").trim();
    if (value === "bundle_current") return "current bundle";
    if (value === "bundle_previous") return "previous bundle";
    if (value === "fallback_asset") return "fallback asset";
    if (value === "legacy_placeholder") return "legacy surface";
    return value || "unknown";
  }

  function replyModeLabel(mode) {
    return normalizeReplyMode(mode) === "card_and_spoken" ? "Card + voice" : "Card only";
  }

  function arrivalCueLabel(mode) {
    const value = normalizeArrivalCueMode(mode);
    if (value === "none") return "None";
    if (value === "haptic") return "Buzz";
    if (value === "haptic_and_chime") return "Buzz + chime";
    return "Chime";
  }

  function turnModelLabel(model) {
    const value = normalizeTurnModel(model);
    if (value === "gpt-5.4") return "GPT-5.4";
    if (value === "gpt-5.4-nano") return "GPT-5.4 nano";
    return "GPT-5.4 mini";
  }

  function reasoningEffortLabel(reasoningEffort) {
    const value = normalizeTurnReasoningEffort(reasoningEffort);
    if (value === "none") return "None";
    if (value === "medium") return "Medium";
    if (value === "high") return "High";
    if (value === "xhigh") return "Extra high";
    return "Low";
  }


  function inboxManageSelectButton(card) {
    const selected = isInboxCardSelected(card);
    const select = el("button", selected ? "inbox-manage-select is-selected" : "inbox-manage-select");
    select.type = "button";
    applyCardActionData(select, "manage_select", card, "reply");
    select.setAttribute("aria-label", `${selected ? "Deselect" : "Select"} ${card?.title || "Inbox tile"}`);
    select.setAttribute("aria-pressed", selected ? "true" : "false");
    select.innerHTML = selected ? iconSvg("check", { filled: true }) : "";
    select.addEventListener("click", (event) => {
      event.stopPropagation();
      toggleInboxManageSelection(card);
    });
    return select;
  }

  function isInboxCardMenuOpen(card) {
    const sessionId = cardSessionId(card);
    const threadId = cardThreadId(card);
    return Boolean(
      (sessionId && state.openCardMenuSessionId === sessionId)
      || (!sessionId && threadId && state.openCardMenuThreadId === threadId)
    );
  }

  function openInboxCardMenu(card) {
    state.cardMenuClickSuppressUntil = Date.now() + CARD_MENU_CLICK_SUPPRESS_MS;
    state.openCardMenuSessionId = cardSessionId(card);
    state.openCardMenuThreadId = cardThreadId(card);
    renderFeed();
    void syncVoiceThreadScope({ reason: "inbox_card_menu_open", render: true, force: true });
  }

  function inboxCardMenuButton(card) {
    const open = isInboxCardMenuOpen(card);
    const menuButton = el("button", open ? "inbox-card-menu-button is-open" : "inbox-card-menu-button");
    menuButton.type = "button";
    applyCardActionData(menuButton, "manage_menu", card, "reply");
    menuButton.setAttribute("aria-label", `More actions for ${card?.title || "Inbox tile"}`);
    menuButton.setAttribute("aria-expanded", open ? "true" : "false");
    menuButton.innerHTML = iconSvg("more_vert", { filled: true });
    menuButton.addEventListener("click", (event) => {
      event.stopPropagation();
      if (isInboxCardMenuOpen(card)) {
        dismissOpenCardMenu(false);
        return;
      }
      openInboxCardMenu(card);
    });
    return menuButton;
  }

  function shouldShowInboxCardEscapeMenu(card) {
    if (!canManageInboxCard(card)) {
      return false;
    }
    if (state.showArchivedFeed || Boolean(card?.archived)) {
      return true;
    }
    if (isMeetingProcessingCard(card) || isFailedPendingOutboundCard(card)) {
      return true;
    }
    const origin = card?.origin && typeof card.origin === "object" ? card.origin : {};
    const text = [
      card?.card_kind,
      card?.meeting_state,
      card?.status,
      card?.state,
      card?.workflow_state,
      card?.processing_state,
      card?.error_code,
      card?.error,
      card?.failure_reason,
      card?.transcript_error,
      card?.title,
      card?.summary,
      origin.card_kind,
      origin.meeting_state,
      origin.status,
      origin.state,
      origin.error_code,
      origin.failure_reason,
      origin.transcript_error
    ].map(value => String(value || "").trim().toLowerCase()).filter(Boolean).join(" ");
    return /\b(failed|failure|error|errored|stalled|blocked|upload_blocked|needs review|needs_review|processing)\b/.test(text);
  }

  function cardOverflowMenu(card) {
    const menu = el("div", "card-longpress-menu inbox-card-menu");
    menu.setAttribute("role", "menu");
    const addItem = (label, icon, actionName, handler) => {
      const item = el("button", "inbox-card-menu-item");
      item.type = "button";
      item.setAttribute("role", "menuitem");
      item.dataset.cardMenuAction = actionName;
      item.innerHTML = `${iconSvg(icon, { filled: true })}<span>${label}</span>`;
      item.addEventListener("click", (event) => {
        event.stopPropagation();
        handler();
      });
      menu.append(item);
    };
    addItem("Open transcript", "chat", "open_transcript", () => {
      dismissOpenCardMenu(false);
      showTranscript(card);
    });
    if (isCardRead(card)) {
      addItem("Mark unread", "checklist", "mark_unread", () => {
        dismissOpenCardMenu(false);
        setCardReadOverride(card, false);
        render();
      });
    } else {
      addItem("Mark read", "checklist", "mark_read", () => {
        dismissOpenCardMenu(false);
        markCardRead(card);
      });
    }
    if (state.showArchivedFeed) {
      addItem("Unarchive", "archive_folder", "unarchive", () => {
        dismissOpenCardMenu(false);
        void requestFeedAction(card, "unarchive", { silent: false });
      });
    } else {
      addItem("Archive", "archive_folder", "archive", () => {
        dismissOpenCardMenu(false);
        void requestFeedAction(card, "archive", { silent: false });
      });
    }
    return menu;
  }

  function cardView(card, options = {}) {
    const flatFeed = Boolean(options.flatFeed);
    const surface = String(options.surface || "").trim().toLowerCase();
    if (isPendingOutboundCard(card)) {
      return outboundCardView(card, options);
    }
    if (isMeetingProcessingCard(card)) {
      return meetingProcessingCardView(card, options);
    }
    const wrapper = el("div", flatFeed ? "card-wrap is-flat-feed" : "card-wrap");
    setDataAttribute(wrapper, "data-card-surface", surface);
    wrapper.style.setProperty("--accent", card.accent || "#72c2ff");
    const isMeetingList = isMeetingsListCard(card);
    const inboxSurface = surface === "inbox" && !isMeetingList;
    const manageableInboxCard = inboxSurface && canManageInboxCard(card);
    const inboxManageMode = manageableInboxCard && Boolean(state.inboxManageMode);
    const inboxEscapeMenu = manageableInboxCard && shouldShowInboxCardEscapeMenu(card);
    if (inboxSurface) {
      wrapper.classList.add("is-inbox-card");
    }
    if (inboxManageMode || inboxEscapeMenu) {
      wrapper.classList.add("has-inbox-menu");
    }
    if (inboxManageMode) {
      wrapper.classList.add("is-inbox-manage-mode");
    }
    if (manageableInboxCard && isInboxCardSelected(card)) {
      wrapper.classList.add("is-inbox-manage-selected");
    }
    const cardClassName = isMeetingList
      ? meetingListCardClass(card)
      : isCardRead(card)
        ? "card"
        : "card card-unread";
    const cardEl = el("article", flatFeed ? `${cardClassName} is-flat-feed` : cardClassName);
    setDataAttribute(cardEl, "data-card-surface", surface);
    cardEl.style.setProperty("--accent", card.accent || "#72c2ff");
    applyCardDataAttributes(cardEl, card, isMeetingList ? "meeting" : "reply");
    setDataAttribute(cardEl, "data-audio-phase", currentTileAudioPhase(card));
    setDataAttribute(cardEl, "data-audio-runtime-mode", audioRuntimeMode());
    setDataAttribute(cardEl, "data-audio-strip-kind", currentTileAudioStripKind(card));
    setDataAttribute(cardEl, "data-audio-busy", isCardAudioBusy(card) ? "true" : "false");
    const cardStamp = cardTimestamp(card);

    let identity = null;
    if (!isMeetingList) {
      identity = el("button", `identity ${cardStateClass(card)}`);
      identity.type = "button";
      applyCardActionData(identity, "mark_read", card, "reply");
      identity.innerHTML = replyCardIconSvg(feedIdentityIconName(card), { filled: true });
      identity.setAttribute("aria-label", isCardRead(card) ? `${card.title} is read` : `Mark ${card.title} read`);
      identity.addEventListener("click", (event) => {
        event.stopPropagation();
        if (inboxManageMode) {
          toggleInboxManageSelection(card);
          return;
        }
        toggleCardRead(card);
      });
    }

    const body = el("div", isMeetingList ? "card-body is-title-only" : "card-body");
    if (flatFeed) {
      body.classList.add("is-flat-feed");
    }
    if (isMeetingList) {
      body.setAttribute("role", "button");
      body.tabIndex = 0;
      body.setAttribute("aria-disabled", "false");
      applyCardActionData(body, "attachment", card, "meeting");
      body.addEventListener("click", () => {
        if (!shouldSuppressCardActivation()) {
          void showMeetingDetail(card.meeting_record);
        }
      });
      body.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          void showMeetingDetail(card.meeting_record);
        }
      });
      const copy = el("div", "card-meeting-copy");
      copy.append(el("h2", "title", card.title || "Pucky"));
      body.append(copy);
    } else {
      const title = el("button", "card-title-trigger title", card.title || "Pucky");
      title.type = "button";
      applyCardActionData(title, "transcript_title", card, "reply");
      title.setAttribute("aria-label", `Open transcript for ${card.title || "reply"}`);
      title.addEventListener("click", () => {
        if (inboxManageMode) {
          toggleInboxManageSelection(card);
          return;
        }
        if (!shouldSuppressCardActivation()) {
          showTranscript(card);
        }
      });
      body.append(title);
      if (currentTileAudioPhase(card) !== "idle") {
        const inlineAudio = el("button", "card-inline-audio-trigger");
        inlineAudio.type = "button";
        applyCardActionData(inlineAudio, "audio_controls_inline", card, "reply");
        inlineAudio.setAttribute("aria-label", `Open audio controls for ${card.title || "reply"}`);
        inlineAudio.append(audioTileStatus(card));
        inlineAudio.addEventListener("click", () => {
          if (inboxManageMode) {
            toggleInboxManageSelection(card);
            return;
          }
          if (!shouldSuppressCardActivation()) {
            showAudioDetail(resolveAudioControlsTargetCard(card));
          }
        });
        body.append(inlineAudio);
      } else {
        const summary = el("button", "card-summary-trigger");
        summary.type = "button";
        applyCardActionData(summary, "transcript_body", card, "reply");
        summary.setAttribute("aria-label", `Open transcript for ${card.title || "reply"}`);
        summary.append(el("p", "preview", card.summary || card.transcript || ""));
        summary.addEventListener("click", () => {
          if (inboxManageMode) {
            toggleInboxManageSelection(card);
            return;
          }
          if (!shouldSuppressCardActivation()) {
            showTranscript(card);
          }
        });
        body.append(summary);
      }
    }

    const actions = el("div", "card-actions");
    setDataAttribute(actions, "data-card-surface", surface);
    if (hasAudio(card)) {
      const audioPhase = currentTileAudioPhase(card);
      const audio = el("button", audioPhase === "playing_confirmed"
        ? "action action-audio is-playing"
        : ["starting", "pause_pending"].includes(audioPhase)
          ? "action action-audio is-busy"
          : ["start_failed", "ended_immediately"].includes(audioPhase)
            ? "action action-audio is-failed"
            : "action action-audio");
      audio.type = "button";
      applyCardActionData(audio, "audio", card, isMeetingList ? "meeting" : "reply");
      audio.innerHTML = iconSvg("mic", { filled: true });
      audio.setAttribute("aria-label", isMeetingList
        ? `Open audio for ${card.title}`
        : audioPhase === "playing_confirmed"
          ? `Pause ${card.title}`
          : audioPhase === "starting"
            ? `Starting ${card.title}`
            : audioPhase === "pause_pending"
              ? `Pausing ${card.title}`
              : `Play ${card.title}`);
      audio.addEventListener("click", async (event) => {
        event.stopPropagation();
        if (inboxManageMode) {
          toggleInboxManageSelection(card);
          return;
        }
        if (isMeetingList) {
          void showMeetingAudioDetail(card.meeting_record);
          return;
        }
        await toggleAudio(card);
      });
      actions.append(audio);
    }
    actions.classList.add(`action-count-${Math.min(2, actions.childElementCount)}`);

    if (identity) {
      cardEl.append(identity, body, actions);
    } else if (isMeetingList) {
      const meta = el("div", "card-meeting-meta");
      if (cardStamp) {
        const stamp = el("time", "card-timestamp", cardStamp.text);
        stamp.dateTime = cardStamp.iso;
        meta.append(stamp);
      }
      meta.append(actions);
      cardEl.append(body, meta);
    } else {
      cardEl.append(body, actions);
    }
    if (cardStamp && !isMeetingList) {
      const stamp = el("time", "card-timestamp", cardStamp.text);
      stamp.dateTime = cardStamp.iso;
      cardEl.append(stamp);
    }
    if (isMeetingList) {
      appendArchiveRevealAction(wrapper, {
        label: `Archive ${card.title || "meeting"}`
      });
      wrapper.append(cardEl);
      installArchiveReveal(wrapper, card.meeting_record, {
        canReveal: canRevealMeetingArchive,
        performArchive: () => performMeetingArchive(card.meeting_record)
      });
      return wrapper;
    }
    const revealArchiveEnabled = surface !== "inbox" && canArchiveHomeCard(card);
    if (inboxManageMode) {
      wrapper.append(inboxManageSelectButton(card));
    }
    if (revealArchiveEnabled) {
      appendArchiveRevealAction(wrapper, {
        label: `Archive ${card.title || "reply"}`
      });
    }
    wrapper.append(cardEl);
    if (inboxEscapeMenu && !inboxManageMode) {
      wrapper.append(inboxCardMenuButton(card));
      if (isInboxCardMenuOpen(card)) {
        wrapper.append(cardOverflowMenu(card));
      }
    }
    if (revealArchiveEnabled) {
      installArchiveReveal(wrapper, card, {
        canReveal: canRevealHomeArchive,
        performArchive: () => performHomeArchive(card)
      });
    }
    return wrapper;
  }

  function isMeetingsListCard(card) {
    return Boolean(card && card.is_meeting_recording && card.render_profile === "meeting_list" && card.meeting_record);
  }

  function meetingListCardClass(card) {
    const stateName = meetingState(card && card.meeting_record);
    if (stateName === "failed") {
      return "card card-meeting-list is-failed";
    }
    if (stateName === "completed") {
      return "card card-meeting-list";
    }
    return "card card-meeting-list card-pending-thread";
  }

  function isMeetingProcessingCard(card) {
    const origin = card?.origin && typeof card.origin === "object" ? card.origin : {};
    const nested = card?.card && typeof card.card === "object" ? card.card : {};
    const nestedOrigin = nested.origin && typeof nested.origin === "object" ? nested.origin : {};
    return String(card?.card_kind || nested.card_kind || origin.card_kind || nestedOrigin.card_kind || "") === "meeting_processing"
      || String(card?.meeting_state || nested.meeting_state || origin.meeting_state || nestedOrigin.meeting_state || "") === "processing";
  }

  function meetingProcessingCardView(card, options = {}) {
    const flatFeed = Boolean(options.flatFeed);
    const surface = String(options.surface || "").trim().toLowerCase();
    const wrapper = el("div", flatFeed ? "card-wrap card-wrap-meeting-processing is-flat-feed" : "card-wrap card-wrap-meeting-processing");
    setDataAttribute(wrapper, "data-card-surface", surface);
    wrapper.style.setProperty("--accent", card.accent || "#72c2ff");
    const inboxSurface = surface === "inbox";
    const manageableInboxCard = inboxSurface && canManageInboxCard(card);
    const inboxManageMode = manageableInboxCard && Boolean(state.inboxManageMode);
    const inboxEscapeMenu = manageableInboxCard && shouldShowInboxCardEscapeMenu(card);
    if (inboxSurface) {
      wrapper.classList.add("is-inbox-card");
    }
    if (inboxManageMode || inboxEscapeMenu) {
      wrapper.classList.add("has-inbox-menu");
    }
    if (inboxManageMode) {
      wrapper.classList.add("is-inbox-manage-mode");
    }
    if (manageableInboxCard && isInboxCardSelected(card)) {
      wrapper.classList.add("is-inbox-manage-selected");
    }
    const cardEl = el("article", flatFeed ? "card card-meeting-processing is-flat-feed" : "card card-meeting-processing");
    setDataAttribute(cardEl, "data-card-surface", surface);
    applyCardDataAttributes(cardEl, card, "meeting_processing");
    const mark = el("div", "meeting-processing-mark");
    mark.innerHTML = iconSvg("mic", { filled: true });
    const copy = el("div", "meeting-processing-copy");
    copy.append(el("p", "meeting-processing-status", "Processing meeting..."));
    copy.append(el("p", "meeting-processing-subcopy", "Transcription, diarization, and follow-up checks are running."));
    cardEl.append(mark, copy);
    const cardStamp = cardTimestamp(card);
    if (cardStamp) {
      const stamp = el("time", "card-timestamp meeting-processing-timestamp", cardStamp.text);
      stamp.dateTime = cardStamp.iso;
      cardEl.append(stamp);
    }
    if (inboxManageMode) {
      wrapper.append(inboxManageSelectButton(card));
    }
    wrapper.append(cardEl);
    if (inboxEscapeMenu && !inboxManageMode) {
      wrapper.append(inboxCardMenuButton(card));
      if (isInboxCardMenuOpen(card)) {
        wrapper.append(cardOverflowMenu(card));
      }
    }
    return wrapper;
  }

  function outboundCardView(card, options = {}) {
    const flatFeed = Boolean(options.flatFeed);
    const surface = String(options.surface || "").trim().toLowerCase();
    const wrapper = el("div", flatFeed ? "card-wrap is-flat-feed" : "card-wrap");
    setDataAttribute(wrapper, "data-card-surface", surface);
    wrapper.style.setProperty("--accent", card.accent || "#72c2ff");
    const cardClassName = isFailedPendingOutboundCard(card)
      ? "card card-outbound is-failed"
      : "card card-outbound";
    const cardEl = el("article", flatFeed ? `${cardClassName} is-flat-feed` : cardClassName);
    setDataAttribute(cardEl, "data-card-surface", surface);
    cardEl.style.setProperty("--accent", card.accent || "#72c2ff");
    applyCardDataAttributes(cardEl, card, "pending_outbound");
    applyCardActionData(cardEl, "transcript", card, "pending_outbound");
    cardEl.setAttribute("role", "button");
    cardEl.tabIndex = 0;
    cardEl.setAttribute("aria-disabled", "false");
    cardEl.setAttribute("aria-label", `Open transcript for ${card.title || "pending reply"}`);
    cardEl.addEventListener("click", () => {
      if (!shouldSuppressCardActivation()) {
        showTranscript(card);
      }
    });
    cardEl.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        showTranscript(card);
      }
    });
    const copy = el("div", "card-outbound-copy");
    const preview = el("p", card?.pending_placeholder ? "card-outbound-preview is-placeholder" : "card-outbound-preview", pendingOutboundSummary(card));
    copy.append(preview);
    const meta = el("div", "card-outbound-meta");
    const metaCopy = el("div", "card-outbound-meta-copy");
    const status = el("span", `card-outbound-status ${pendingOutboundStatusClass(card)}`, pendingOutboundStatusLabel(card));
    metaCopy.append(status);
    const stamp = cardTimestamp(card);
    if (stamp) {
      const time = el("time", "card-outbound-time", stamp.text);
      time.dateTime = stamp.iso;
      metaCopy.append(time);
    }
    meta.append(metaCopy);
    cardEl.append(copy, meta);
    const revealArchiveEnabled = surface !== "inbox" && canArchiveHomeCard(card);
    if (revealArchiveEnabled) {
      appendArchiveRevealAction(wrapper, {
        label: `Archive ${card.title || "reply"}`
      });
    }
    wrapper.append(cardEl);
    if (revealArchiveEnabled) {
      installArchiveReveal(wrapper, card, {
        canReveal: canRevealHomeArchive,
        performArchive: () => performHomeArchive(card)
      });
    }
    return wrapper;
  }

  function appendArchiveRevealAction(wrapper, config = {}) {
    const action = el("button", "archive-reveal-action");
    action.type = "button";
    action.tabIndex = -1;
    action.dataset.dragIgnore = "true";
    action.setAttribute("aria-label", config.label || "Archive");
    action.innerHTML = iconSvg("delete", { filled: true });
    wrapper.append(action);
  }

  function audioCacheMediaId(source) {
    const meetingId = String(source && source.meeting_id || "").trim();
    if (meetingId) {
      return `meeting:${meetingId}:audio`;
    }
    const sessionId = String(source && source.session_id || "").trim();
    if (source && source.is_meeting_recording && sessionId) {
      return `meeting:${sessionId}:audio`;
    }
    const explicit = String(source && (source.media_id || source.audio_media_id) || "").trim();
    if (explicit) {
      return explicit;
    }
    const cardId = String(source && source.card_id || "").trim();
    if (cardId) {
      return `feed:${cardId}:audio`;
    }
    return sessionId ? `feed:${sessionId}:audio` : "";
  }

  async function ensureAudioCacheForPlayback(source, options = {}) {
    const hasNativeBridge = Boolean(window.PuckyAndroid && typeof window.PuckyAndroid.postMessage === "function");
    const url = String(source && (source.audio_url || source.url) || "").trim();
    if (!hasNativeBridge || !url) {
      return "";
    }
    const mediaId = audioCacheMediaId(source);
    if (!mediaId) {
      return "";
    }
    const result = await Pucky.request({
      command: "media.cache.ensure",
      args: {
        media_id: mediaId,
        owner_type: source && (source.is_meeting_recording || source.meeting_id) ? "meeting" : "feed",
        owner_id: String(source && (source.meeting_id || source.card_id || source.session_id) || ""),
        kind: "audio",
        title: source && source.title || "Audio",
        url,
        mime_type: source && (source.audio_mime_type || source.mime_type) || "audio/mp4",
        bytes: safeNumber(source && (source.audio_bytes || source.bytes)),
        sha256: String(source && (source.audio_sha256 || source.media_sha256 || source.sha256) || ""),
        max_bytes: options.maxBytes || 96 * 1024 * 1024
      }
    });
    const path = String(result && (result.device_path || result.path || result.local_path) || "").trim();
    if (!path) {
      throw new Error("Audio unavailable: cached asset path is missing.");
    }
    source.audio_path = path;
    if (source.meeting_record && typeof source.meeting_record === "object") {
      source.meeting_record.device_path = path;
    }
    return path;
  }

  async function prepareAudioForPlayback(card) {
    if (!card || typeof card !== "object") {
      return "";
    }
    if (prefersHostedDirectAudio(card)) {
      return String(card.audio_url || "").trim();
    }
    if (card.audio_path && (!card.is_meeting_recording || isAndroidPlayableAudioPath(card.audio_path))) {
      return String(card.audio_path);
    }
    const url = String(card.audio_url || "").trim();
    if (!url) {
      return String(card.audio_path || "");
    }
    const cachedPath = await ensureAudioCacheForPlayback(card);
    if (cachedPath) {
      return cachedPath;
    }
    return url;
  }

  async function resolveAudioAttachmentSrc(item, options = {}) {
    const hasNativeBridge = hasNativeArtifactBridge();
    const meetingId = String(item && item.meeting_id || "").trim();
    const artifactId = attachmentArtifactId(item);
    let url = String(item && item.url || "").trim();
    const hasCanonicalAttachmentSource = Boolean(artifactId || url);
    if (meetingId && !hasCanonicalAttachmentSource) {
      const resolvedMeetingAudio = await resolveMeetingAudioLink(item);
      const resolvedPath = String(resolvedMeetingAudio && (resolvedMeetingAudio.device_path || resolvedMeetingAudio.path) || "").trim();
      if (resolvedPath && hasNativeBridge && isAndroidPlayableAudioPath(resolvedPath)) {
        return resolveLocalArtifactPath(resolvedPath, { ...(item || {}), path: resolvedPath }, options);
      }
      if (resolvedMeetingAudio && resolvedMeetingAudio.url) {
        url = String(resolvedMeetingAudio.url);
        item = { ...(item || {}), url };
      }
    }
    const path = String(mediaPath(item) || "").trim();
    if (path && hasNativeBridge && isAndroidPlayableAudioPath(path)) {
      return resolveLocalArtifactPath(path, item, options);
    }
    if (item && (item.src || item.data_url)) {
      return String(item.src || item.data_url);
    }
    if (artifactId) {
      return resolveArtifactUrl(item, { ...options, preferDataUrl: true });
    }
    if (url && hasNativeBridge) {
      const preparedPath = await ensureAudioCacheForPlayback({ ...(item || {}), audio_url: url }, options);
      return resolveLocalArtifactPath(preparedPath, { ...(item || {}), path: preparedPath }, options);
    }
    if (url) {
      return url;
    }
    return resolveArtifactUrl(item, options);
  }

  function currentBrowserPlayerState() {
    return playerHasAudioIdentity(state.player)
      ? syncSharedBrowserPlayerState({ render: false })
      : state.player;
  }

  async function toggleHostedBrowserAudio(card, busyKey) {
    const current = currentBrowserPlayerState();
    rememberPlayerProgress(current);
    recordAudioProbeEvent("player_state_before_action", {
      target_key: busyKey,
      state: String(current?.state || ""),
      is_playing: Boolean(current?.is_playing),
      path: String(current?.path || ""),
      source: String(current?.source || ""),
      position_ms: Number(current?.position_ms || 0)
    });
    const same = isSameAudioCard(current, card);
    const sameCompleted = same && isCompletePlayback(current);
    const sourceInfo = describeAudioSourceForCard(card);
    const startSpeed = resolvedStartSpeedForCard(card);
    const audioUrl = String(card?.audio_url || "").trim();
    const controlKey = audioControlKey(card) || audioUrl;
    if (same && current.is_playing) {
      setAudioProbePhase(card, "pause_pending", {
        reason: "pause_requested",
        clear_error: true,
        ...sourceInfo
      });
      render();
      recordAudioProbeEvent("pause_request_start", { target_key: busyKey });
      state.player = stampPlayerState(await pauseWithRewind(card));
      recordAudioProbeEvent("pause_request_end", {
        target_key: busyKey,
        state: String(state.player?.state || ""),
        is_playing: Boolean(state.player?.is_playing),
        position_ms: Number(state.player?.position_ms || 0)
      });
      syncAudioProbeFromPlayerState(current, state.player);
      return;
    }
    if (!audioUrl) {
      throw new Error("Audio unavailable: hosted audio URL is missing.");
    }
    const start = same && !sameCompleted
      ? savedPositionFor(current.source || current.path)
      : savedPositionFor(controlKey);
    if (!same || sameCompleted) {
      forgetCompleted(controlKey);
    }
    setAudioProbePhase(card, "starting", {
      reason: same && !sameCompleted ? "resume_requested" : "play_requested",
      clear_error: true,
      ...sourceInfo
    });
    state.activePath = controlKey;
    recordAudioProbeEvent("source_resolved", {
      target_key: busyKey,
      ...sourceInfo
    });
    recordAudioProbeEvent("play_request_start", {
      target_key: busyKey,
      mode: same && !sameCompleted ? "resume_existing" : "direct_path",
      requested_path: audioUrl,
      start_at_ms: start,
      speed: startSpeed
    });
    render();
    state.player = stampPlayerState(await Pucky.request({
      command: "player.play",
      args: {
        path: audioUrl,
        source: controlKey,
        title: card.title,
        start_at_ms: start,
        speed: startSpeed
      }
    }));
    recordAudioProbeEvent("play_request_end", {
      target_key: busyKey,
      state: String(state.player?.state || ""),
      is_playing: Boolean(state.player?.is_playing),
      path: String(state.player?.path || ""),
      source: String(state.player?.source || "")
    });
    rememberPlayerProgress(state.player);
    confirmAudioProbePlaybackStart(busyKey, state.player);
  }

  async function toggleAudio(card) {
    const busyKey = audioStateKey(card);
    const phaseBefore = currentTileAudioPhase(card);
    if (state.audioToggleBusyKey === busyKey || ["starting", "pause_pending"].includes(phaseBefore)) {
      return;
    }
    recordAudioProbeEvent("click_received", {
      target_key: busyKey,
      runtime_mode: audioRuntimeMode(),
      bridge_connected: hasNativeAudioBridge(),
      phase_before: phaseBefore
    });
    state.audioToggleBusyKey = busyKey;
    recordAudioProbeEvent("busy_start", { target_key: busyKey });
    render();
    try {
      if (prefersHostedDirectAudio(card)) {
        await toggleHostedBrowserAudio(card, busyKey);
        markCardRead(card);
        render();
        return;
      }
      const current = await Pucky.request({ command: "player.state", args: {} });
      rememberPlayerProgress(current);
      recordAudioProbeEvent("player_state_before_action", {
        target_key: busyKey,
        state: String(current?.state || ""),
        is_playing: Boolean(current?.is_playing),
        path: String(current?.path || ""),
        source: String(current?.source || ""),
        position_ms: Number(current?.position_ms || 0)
      });
      const same = isSameAudioCard(current, card);
      const sameCompleted = same && isCompletePlayback(current);
      const sourceInfo = describeAudioSourceForCard(card);
      const startSpeed = resolvedStartSpeedForCard(card);
      if (same && current.is_playing) {
        setAudioProbePhase(card, "pause_pending", {
          reason: "pause_requested",
          clear_error: true,
          ...sourceInfo
        });
        render();
        recordAudioProbeEvent("pause_request_start", { target_key: busyKey });
        state.player = stampPlayerState(await pauseWithRewind(card));
        recordAudioProbeEvent("pause_request_end", {
          target_key: busyKey,
          state: String(state.player?.state || ""),
          is_playing: Boolean(state.player?.is_playing),
          position_ms: Number(state.player?.position_ms || 0)
        });
        syncAudioProbeFromPlayerState(current, state.player);
      } else if (same && !sameCompleted) {
        setAudioProbePhase(card, "starting", {
          reason: "resume_requested",
          clear_error: true,
          ...sourceInfo
        });
        state.activePath = audioControlKey(card);
        recordAudioProbeEvent("source_resolved", {
          target_key: busyKey,
          ...sourceInfo
        });
        recordAudioProbeEvent("play_request_start", {
          target_key: busyKey,
          mode: "resume_existing",
          start_at_ms: savedPositionFor(current.source || current.path),
          speed: startSpeed
        });
        render();
        state.player = stampPlayerState(await Pucky.request({
          command: "player.play",
          args: { start_at_ms: savedPositionFor(current.source || current.path), speed: startSpeed }
        }));
        recordAudioProbeEvent("play_request_end", {
          target_key: busyKey,
          state: String(state.player?.state || ""),
          is_playing: Boolean(state.player?.is_playing),
          path: String(state.player?.path || ""),
          source: String(state.player?.source || "")
        });
        rememberPlayerProgress(state.player);
      } else if (hasNativeAudioBridge() && card.audio_playlist_path) {
        setAudioProbePhase(card, "starting", {
          reason: "queue_requested",
          clear_error: true,
          ...sourceInfo
        });
        state.activePath = audioControlKey(card);
        recordAudioProbeEvent("source_resolved", {
          target_key: busyKey,
          ...sourceInfo
        });
        render();
        const queued = await Pucky.request({
          command: "player.queue.set",
          args: { playlist_path: card.audio_playlist_path, title: card.title, load: true }
        });
        const start = savedPositionFor(audioControlKey(card));
        recordAudioProbeEvent("queue_loaded", {
          target_key: busyKey,
          path: String(queued?.path || ""),
          source: String(queued?.source || ""),
          queue_count: Number(queued?.queue_count || 0)
        });
        recordAudioProbeEvent("play_request_start", {
          target_key: busyKey,
          mode: "queue_playlist",
          start_at_ms: start,
          speed: startSpeed
        });
        state.player = stampPlayerState(await Pucky.request({
          command: "player.play",
          args: { start_at_ms: start, speed: startSpeed }
        }));
        recordAudioProbeEvent("play_request_end", {
          target_key: busyKey,
          state: String(state.player?.state || ""),
          is_playing: Boolean(state.player?.is_playing),
          path: String(state.player?.path || ""),
          source: String(state.player?.source || "")
        });
        rememberPlayerProgress(state.player);
        confirmAudioProbePlaybackStart(busyKey, state.player);
      } else {
        setAudioProbePhase(card, "starting", {
          reason: "play_requested",
          clear_error: true,
          ...sourceInfo
        });
        state.activePath = audioControlKey(card);
        recordAudioProbeEvent("source_resolved", {
          target_key: busyKey,
          ...sourceInfo
        });
        render();
        const audioPath = await prepareAudioForPlayback(card);
        const start = savedPositionFor(audioPath);
        forgetCompleted(audioPath);
        recordAudioProbeEvent("play_request_start", {
          target_key: busyKey,
          mode: "direct_path",
          requested_path: String(audioPath || ""),
          start_at_ms: start,
          speed: startSpeed
        });
        state.player = stampPlayerState(await Pucky.request({
          command: "player.play",
          args: { path: audioPath, title: card.title, start_at_ms: start, speed: startSpeed }
        }));
        recordAudioProbeEvent("play_request_end", {
          target_key: busyKey,
          state: String(state.player?.state || ""),
          is_playing: Boolean(state.player?.is_playing),
          path: String(state.player?.path || ""),
          source: String(state.player?.source || "")
        });
        rememberPlayerProgress(state.player);
        confirmAudioProbePlaybackStart(busyKey, state.player);
      }
      markCardRead(card);
      render();
    } catch (error) {
      const message = String(error && error.message || error || "Audio playback failed.");
      recordAudioProbeEvent("action_error", {
        target_key: busyKey,
        phase: currentTileAudioPhase(card),
        message
      });
      setAudioProbeTerminal(card, "start_failed", {
        reason: phaseBefore === "playing_confirmed" ? "pause_request_error" : "play_request_error",
        error_message: message,
        schedule_reset: true
      });
      syncActivePathFromPlayer(state.player);
      showToast(message);
      render();
    } finally {
      if (state.audioToggleBusyKey === busyKey) {
        state.audioToggleBusyKey = "";
        recordAudioProbeEvent("busy_end", { target_key: busyKey });
      }
      render();
    }
  }

  function showTranscript(card, options = {}) {
    state.audioCard = null;
    if (!options.restoring) {
      markCardRead(card);
    }
    renderFeed();
    if (options.restoring) {
      restoreFeedScroll();
    }
    const panel = document.getElementById("detail");
    const messages = messagesForCard(card);
    const content = el("div", "detail-content chat-detail");
    const stack = el("div", "chat-stack");
    messages.forEach((message, index) => {
      const images = messageImages(card, message, index, messages);
      if (message.role !== "user" && images.length) {
        stack.append(chatMediaBubble(card, images));
      }
      const bubble = el("div", [
        "bubble",
        message.role === "user" ? "user" : "assistant",
        message.pending_placeholder ? "is-thinking" : "",
        message.pending_failed ? "is-failed" : "",
      ].filter(Boolean).join(" "));
      const attachments = messageAttachmentRow(card, message, index);
      if (attachments) {
        bubble.append(attachments);
      }
      const connected = messageConnectedRecordRow(card, message);
      if (connected) {
        bubble.append(connected);
      }
      bubble.append(document.createTextNode(message.text || ""));
      if (message.role !== "user" && !message.synthetic) {
        const actions = el("div", "bubble-actions");
        const meta = el("button", "bubble-origin-action");
        meta.type = "button";
        meta.innerHTML = iconSvg("settings", { filled: false });
        meta.setAttribute("aria-label", "Open reply details");
        meta.addEventListener("click", (event) => {
          event.stopPropagation();
          showOriginSheet(card);
        });
        const trace = el("button", "bubble-trace-action");
        trace.type = "button";
        trace.innerHTML = iconSvg("lightbulb_2", { filled: false });
        trace.setAttribute("aria-label", "Open thinking logs");
        trace.addEventListener("click", (event) => {
          event.stopPropagation();
          showTurnTrace(card, message, index);
        });
        actions.append(meta, trace);
        bubble.append(actions);
      }
      const stamp = messageTimestamp(message);
      if (stamp) {
        bubble.append(el("span", "bubble-meta", stamp));
      }
      stack.append(bubble);
    });
    content.append(stack);
    applyDetailDataAttributes(panel, "transcript", card);
    openSideDetail(panel, card.title || "Transcript", content, dismissDetail);
    rememberNavDetail("transcript", card, options);
    installDetailScrollPersistence(content, "transcript");
    void syncVoiceThreadScope({ reason: "show_transcript", render: true });
    if (options.restoring) {
      restoreScrollPosition(content, options.scrollTop);
    } else {
      scrollTranscriptToLatest(content);
    }
  }

  function chatMediaBubble(card, images) {
    const media = el("div", "chat-media");
    media.setAttribute("role", "group");
    media.setAttribute("aria-label", `Open ${images.length} generated media item${images.length === 1 ? "" : "s"}`);
    const rail = el("div", "chat-media-rail");
    rail.dataset.dragIgnore = "true";
    images.forEach((image, index) => {
      const tile = el("button", "chat-media-tile");
      tile.type = "button";
      tile.setAttribute("aria-label", `Open generated media ${index + 1} of ${images.length}`);
      tile.addEventListener("click", (event) => {
        event.stopPropagation();
        showAttachmentViewer(card, images, { initialIndex: index, onDismiss: () => showTranscript(card) });
      });
      if (isVideoMedia(image)) {
        const video = document.createElement("video");
        video.className = "chat-media-video";
        video.muted = true;
        video.playsInline = true;
        video.preload = "metadata";
        video.setAttribute("aria-label", image.title || image.alt || `Video ${index + 1}`);
        tile.append(video);
        resolveMediaSrc(image)
          .then(src => { video.src = src; })
          .catch(() => { tile.append(el("span", "chat-media-error", "Video unavailable")); });
      } else if (isDocumentMedia(image)) {
        tile.append(mediaDocumentPreview(image, "chat"));
      } else if (isImageMedia(image)) {
        const imageEl = document.createElement("img");
        imageEl.alt = image.title || image.alt || `Generated image ${index + 1}`;
        imageEl.decoding = "async";
        tile.append(imageEl);
        resolveImageSrc(image)
          .then(src => { imageEl.src = src; })
          .catch(() => { tile.append(el("span", "chat-media-error", "Image unavailable")); });
      } else {
        tile.append(mediaDocumentPreview(image, "chat"));
      }
      rail.append(tile);
    });
    if (images.length > 1) {
      media.append(el("span", "chat-media-count", `${images.length} items`));
    }
    media.append(rail);
    installOneSlidePager(rail);
    return media;
  }

  function attachmentChipIcon(item) {
    const kind = attachmentKind(item);
    if (kind === "audio") return "mic";
    if (kind === "image") return "image";
    if (kind === "video") return "play_arrow";
    if (kind === "text" || kind === "html" || kind === "table") return "text";
    return "attachment";
  }

  function attachmentChipLabel(item) {
    const title = String(item?.title || "").trim();
    if (title) {
      return title;
    }
    const kind = attachmentKind(item);
    if (kind === "audio") return "Audio";
    if (kind === "image") return "Image";
    if (kind === "video") return "Video";
    if (kind === "html") return "HTML";
    if (kind === "text") return "Text";
    if (kind === "table") return "Table";
    if (kind === "document") return "Document";
    if (kind === "archive") return "Archive";
    return "Attachment";
  }

  function messageAttachmentRow(card, message, index) {
    const attachments = preferredDisplayAttachments(card, message?.attachments);
    const chips = attachments.filter(item => {
      if (String(message?.role || "").toLowerCase() === "user") {
        return true;
      }
      return attachmentViewerType(item) !== "image_gallery";
    });
    if (!chips.length) {
      return null;
    }
    const row = el("div", "bubble-attachment-row");
    chips.forEach(item => {
      const initialIndex = attachments.indexOf(item);
      if (initialIndex < 0) {
        return;
      }
      const chip = el("button", "bubble-attachment-chip");
      chip.type = "button";
      chip.dataset.dragIgnore = "true";
      chip.innerHTML = `${iconSvg(attachmentChipIcon(item), { filled: false })}<span>${escapeHtml(attachmentChipLabel(item))}</span>`;
      chip.setAttribute("aria-label", `Open ${attachmentChipLabel(item)}`);
      chip.addEventListener("click", event => {
        event.stopPropagation();
        showAttachmentViewer(card, attachments, { initialIndex, onDismiss: () => showTranscript(card) });
      });
      row.append(chip);
    });
    return row.childElementCount ? row : null;
  }

  function messageConnectedRecordRow(card, message) {
    const entries = connectedRecordEntries(message?.connected_records, { dedupeTargets: true });
    if (!entries.length) {
      return null;
    }
    const row = el("div", "bubble-attachment-row bubble-connected-record-row");
    const detailOrigin = {
      kind: "transcript",
      route: "inbox",
      sessionId: cardSessionId(card),
      threadId: cardThreadId(card),
    };
    entries.forEach(entry => {
      row.append(lightRecordChip(entry, {
        fromRoute: "inbox",
        detailOrigin,
      }));
    });
    return row.childElementCount ? row : null;
  }

  async function showRichPage(card, options = {}) {
    state.audioCard = null;
    if (!options.restoring) {
      markCardRead(card);
    }
    renderFeed();
    if (options.restoring) {
      restoreFeedScroll();
    }
    const panel = document.getElementById("detail");
    const content = el("div", "detail-content rich-detail");
    const pageSource = resolveRichPageSource(card);
    let cleanupEdgeDismiss = () => {};
    const dismissWithCleanup = () => {
      cleanupEdgeDismiss();
      dismissDetail();
    };
    try {
      if (!pageSource) {
        throw new Error("Page source is missing.");
      }
      content.append(await richFrame(pageSource, card), el("div", "rich-swipe-edge"));
    } catch (error) {
      content.append(el("p", "preview", `Page unavailable: ${error.message}`));
    }
    applyDetailDataAttributes(panel, "page", card, { viewer: "html_iframe" });
    openSideDetail(panel, card.title || "Page", content, dismissWithCleanup, { fullBleed: true });
    rememberNavDetail("page", card, options);
    installDetailScrollPersistence(content, "page");
    void syncVoiceThreadScope({ reason: "show_page", render: true });
    restoreScrollPosition(content, options.scrollTop);
    const edge = content.querySelector(".rich-swipe-edge");
    if (edge) {
      cleanupEdgeDismiss = installHorizontalDismiss(edge, panel, dismissWithCleanup);
    }
  }

  async function readRichPageSource(pageSource) {
    const source = String(pageSource || "").trim();
    if (!source) {
      throw new Error("Page source is missing.");
    }
    if (hasNativeArtifactBridge()) {
      const result = await Pucky.request({
        command: "artifact.read_base64",
        args: { path: source, max_bytes: 1024 * 1024 }
      });
      const mime = String((result && result.mime_type) || "").trim() || guessMediaMime(source);
      const contentBase64 = String((result && result.content_base64) || "");
      return {
        path: source,
        mime_type: mime,
        bytes: Number((result && result.bytes) || 0),
        content_base64: contentBase64,
        text: mime === "application/pdf" ? "" : atob(contentBase64)
      };
    }
    const response = await fetchArtifactHttpResponse(source, "Page");
    const mime = String(response.headers.get("content-type") || "").split(";", 1)[0].trim() || guessMediaMime(source);
    const buffer = await response.arrayBuffer();
    return {
      path: source,
      mime_type: mime,
      bytes: Number(buffer.byteLength || 0),
      content_base64: base64FromBytes(buffer),
      text: mime === "application/pdf" ? "" : new TextDecoder().decode(buffer)
    };
  }

  async function richFrame(path = "", source = null) {
    const iframe = el("iframe", "rich-frame");
    iframe.setAttribute("sandbox", "allow-scripts allow-forms allow-popups allow-same-origin");
    const result = await readRichPageSource(path);
    const mime = String((result && result.mime_type) || "").toLowerCase();
    const transcriptContext = source ? await resolveMeetingTranscriptLink(source, source) : { href: "" };
    const audioContext = source ? await resolveMeetingAudioAttachmentLink(source, source) : { href: "" };
    if (mime === "application/pdf" || ((mime === "" || mime === "application/octet-stream") && /\.pdf$/i.test(String(path)))) {
      iframe.srcdoc = pdfArtifactHtml(result, path, String(result && result.content_base64 || ""));
    } else {
      iframe.srcdoc = await rewriteMeetingHtmlContent(String(result && result.text || ""), source || {}, {
        transcriptHref: String(transcriptContext.href || ""),
        audioHref: String(audioContext.href || "")
      });
    }
    return iframe;
  }

  function hasRichPage(card) {
    return Boolean(resolveRichPageSource(card));
  }

  function resolveRichPageSource(card) {
    if (!card || typeof card !== "object") {
      return "";
    }
    const htmlPath = String(card.html_path || "").trim();
    const htmlUrl = String(card.html_url || "").trim();
    const htmlArtifact = String(card.html_artifact || "").trim();
    if (hasNativeArtifactBridge()) {
      return htmlPath || (htmlArtifact ? artifactVirtualPath(htmlArtifact) : "") || htmlUrl;
    }
    return htmlUrl || (htmlArtifact ? artifactApiUrl(htmlArtifact) : "") || htmlPath;
  }

  function pdfArtifactHtml(result, path, contentBase64) {
    const name = String(path || "PDF artifact").replace(/^.*\//, "") || "PDF artifact";
    const bytes = Number((result && result.bytes) || 0);
    const size = bytes > 0 ? `${Math.round(bytes / 1024)} KB` : "cached artifact";
    const href = contentBase64 ? `data:application/pdf;base64,${contentBase64}` : "#";
    return `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>
      body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f5f7fb;color:#101820;font-family:Arial,sans-serif}
      main{box-sizing:border-box;width:min(86vw,540px);padding:28px;border-radius:28px;background:white;box-shadow:0 18px 70px rgba(16,24,32,.18)}
      .icon{width:72px;height:88px;border-radius:10px;background:#e53935;color:white;display:grid;place-items:center;font-weight:900;font-size:22px;margin-bottom:20px}
      h1{font-size:28px;line-height:1.05;margin:0 0 12px}
      p{font-size:16px;line-height:1.45;color:#435063;margin:0 0 14px}
      a{display:inline-block;margin-top:8px;padding:12px 16px;border-radius:999px;background:#101820;color:white;text-decoration:none;font-weight:800}
    </style><main><div class="icon">PDF</div><h1>${escapeHtml(name)}</h1><p>${escapeHtml(size)}. Android WebView does not render PDF pages natively, so Pucky is showing this cached-document placeholder instead of a blank pane.</p><p>A future pass can add PDF.js thumbnails or native document opening.</p><a href="${href}">Open PDF data</a></main>`;
  }

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function meetingHtmlSource(source = {}) {
    const meetingRecord = source && typeof source.meeting_record === "object" ? source.meeting_record : {};
    return {
      meeting_id: String(source.meeting_id || meetingRecord.meeting_id || source.session_id || "").trim(),
      title: String(source.title || meetingRecord.title || "").trim(),
      recording_title: String(source.recording_title || meetingRecord.recording_title || "").trim(),
      canonical_basename: String(source.canonical_basename || meetingRecord.canonical_basename || "").trim(),
      device_path: String(source.device_path || meetingRecord.device_path || source.audio_path || meetingRecord.audio_path || "").trim(),
      audio_url: String(source.audio_url || meetingRecord.audio_url || source.url || "").trim(),
      transcript_path: String(source.transcript_path || meetingRecord.transcript_path || "").trim(),
      transcript_html_path: String(source.transcript_html_path || meetingRecord.transcript_html_path || "").trim(),
      mime_type: String(source.audio_mime_type || source.mime_type_audio || source.mime_type || meetingRecord.mime_type || "").trim(),
      started_at: String(source.started_at || meetingRecord.started_at || source.created_at || meetingRecord.created_at || "").trim()
    };
  }

  function applyResolvedMeetingAudioSource(source, resolved) {
    if (!source || typeof source !== "object" || !resolved || typeof resolved !== "object") {
      return;
    }
    const devicePath = String(resolved.device_path || resolved.path || "").trim();
    const canonicalBasename = String(resolved.canonical_basename || "").trim();
    const audioUrl = String(resolved.url || "").trim();
    const recordingTitle = String(resolved.recording_title || "").trim();
    if (devicePath) {
      source.device_path = devicePath;
      source.audio_path = devicePath;
    }
    if (canonicalBasename) {
      source.canonical_basename = canonicalBasename;
    }
    if (recordingTitle) {
      source.recording_title = recordingTitle;
    }
    if (audioUrl) {
      source.audio_url = audioUrl;
    }
    if (source.meeting_record && typeof source.meeting_record === "object") {
      if (devicePath) {
        source.meeting_record.device_path = devicePath;
      }
      if (canonicalBasename) {
        source.meeting_record.canonical_basename = canonicalBasename;
      }
      if (recordingTitle) {
        source.meeting_record.recording_title = recordingTitle;
      }
    }
  }

  async function resolveMeetingAudioLink(source = {}) {
    const context = meetingHtmlSource(source);
    if (!context.meeting_id && !context.device_path && !context.audio_url) {
      return {};
    }
    if (window.PuckyAndroid && typeof window.PuckyAndroid.postMessage === "function") {
      try {
        const resolved = await Pucky.request({
          command: "meeting.recording.resolve_audio_link",
          args: context
        });
        applyResolvedMeetingAudioSource(source, resolved);
        return resolved || {};
      } catch (_) {
        // Older APKs can still render the page with a non-local fallback.
      }
    }
    if (context.device_path) {
        return {
          device_path: context.device_path,
          url: context.audio_url,
          canonical_basename: context.canonical_basename,
          recording_title: context.recording_title
        };
      }
    if (context.audio_url) {
      return {
        url: context.audio_url,
        canonical_basename: context.canonical_basename,
        recording_title: context.recording_title
      };
    }
    return {};
  }

  function assistantAttachmentsForCard(card) {
    const messages = Array.isArray(card?.transcript_messages) ? card.transcript_messages : [];
    const assistant = messages.find(item => String(item?.role || "").toLowerCase() === "assistant") || {};
    return normalizedAttachments(assistant.attachments);
  }

  function isMeetingAttachmentItem(item) {
    return Boolean(String(item?.meeting_id || "").trim());
  }

  function meetingAttachmentDisplayRank(item) {
    const id = String(item?.id || "").trim().toLowerCase();
    const title = String(item?.title || "").trim().toLowerCase();
    if (id.endsWith(":html")) return 0;
    if (title === "meeting summary") return 0;
    if (title === "transcript" || title === "meeting transcript html") return 1;
    if (title === "transcript (plain text)" || title === "meeting transcript") return 2;
    if (title === "meeting audio") return 3;
    return 4;
  }

  function preferredDisplayAttachments(card, attachments) {
    const items = normalizedAttachments(attachments);
    if (!items.length) {
      return items;
    }
    if (!items.some(isMeetingAttachmentItem)) {
      return items;
    }
    return items
      .map((item, index) => ({ item, index, rank: meetingAttachmentDisplayRank(item) }))
      .sort((left, right) => left.rank - right.rank || left.index - right.index)
      .map(entry => entry.item);
  }

  function meetingAttachmentIndexByTitle(attachments, title) {
    const needle = String(title || "").trim().toLowerCase();
    return attachments.findIndex(item => String(item?.title || "").trim().toLowerCase() === needle);
  }

  function meetingSummaryAttachmentIndex(attachments, summaryItem) {
    if (!summaryItem) {
      return meetingAttachmentIndexByTitle(attachments, "Meeting Summary");
    }
    const matchId = String(summaryItem.id || "").trim();
    const matchArtifact = String(summaryItem.artifact || "").trim();
    return attachments.findIndex(item => {
      if (!item || typeof item !== "object") {
        return false;
      }
      if (matchId && String(item.id || "").trim() === matchId) {
        return true;
      }
      if (matchArtifact && String(item.artifact || "").trim() === matchArtifact) {
        return true;
      }
      return String(item.title || "").trim() === String(summaryItem.title || "").trim()
        && String(item.kind || "").trim() === String(summaryItem.kind || "").trim();
    });
  }

  async function resolveMeetingAttachmentLink(card, summaryItem, targetTitle, resolveHref) {
    const attachments = meetingAttachmentsForCard(card);
    const targetIndex = meetingAttachmentIndexByTitle(attachments, targetTitle);
    const targetAttachment = targetIndex >= 0 ? attachments[targetIndex] : null;
    if (targetAttachment) {
      try {
        return {
          href: await resolveHref(targetAttachment),
          attachments,
          targetIndex,
          summaryIndex: meetingSummaryAttachmentIndex(attachments, summaryItem),
          targetAttachment
        };
      } catch (_) {
        return {
          href: "",
          attachments,
          targetIndex,
          summaryIndex: meetingSummaryAttachmentIndex(attachments, summaryItem),
          targetAttachment
        };
      }
    }
    return {
      href: "",
      attachments,
      targetIndex: -1,
      summaryIndex: meetingSummaryAttachmentIndex(attachments, summaryItem),
      targetAttachment: null
    };
  }

  async function resolveMeetingTranscriptLink(card, summaryItem = null) {
    let htmlContext = await resolveMeetingAttachmentLink(
      card,
      summaryItem,
      "Transcript",
      attachment => resolveArtifactUrl(attachment, { maxBytes: 2 * 1024 * 1024 })
    );
    if (!htmlContext.targetAttachment) {
      htmlContext = await resolveMeetingAttachmentLink(
        card,
        summaryItem,
        "Meeting Transcript HTML",
        attachment => resolveArtifactUrl(attachment, { maxBytes: 2 * 1024 * 1024 })
      );
    }
    if (htmlContext.targetAttachment) {
      return {
        ...htmlContext,
        transcriptIndex: htmlContext.targetIndex,
        transcriptAttachment: htmlContext.targetAttachment
      };
    }
    let context = await resolveMeetingAttachmentLink(
      card,
      summaryItem,
      "Transcript (Plain Text)",
      attachment => resolveArtifactUrl(attachment, { maxBytes: 2 * 1024 * 1024, preferDataUrl: true })
    );
    if (!context.targetAttachment) {
      context = await resolveMeetingAttachmentLink(
        card,
        summaryItem,
        "Meeting Transcript",
        attachment => resolveArtifactUrl(attachment, { maxBytes: 2 * 1024 * 1024, preferDataUrl: true })
      );
    }
    return {
      ...context,
      transcriptIndex: context.targetIndex,
      transcriptAttachment: context.targetAttachment
    };
  }

  async function resolveMeetingAudioAttachmentLink(card, summaryItem = null) {
    const context = await resolveMeetingAttachmentLink(
      card,
      summaryItem,
      "Meeting Audio",
      attachment => resolveArtifactUrl(attachment, { maxBytes: 32 * 1024 * 1024 })
    );
    return {
      ...context,
      audioIndex: context.targetIndex,
      audioAttachment: context.targetAttachment
    };
  }

  function meetingLinkHtml(href, label, className, action) {
    const safeHref = String(href || "#").trim() || "#";
    return `<a class="document-open-link ${escapeHtml(className)}" href="${escapeHtml(safeHref)}" data-pucky-meeting-action="${escapeHtml(action)}">${escapeHtml(label)}</a>`;
  }

  function meetingTranscriptLinkHtml(href, label = "Open Transcript") {
    return meetingLinkHtml(href, label, "pucky-meeting-transcript-link", "transcript");
  }

  function meetingAudioLinkHtml(href, label = "Listen To Audio") {
    return meetingLinkHtml(href, label, "pucky-meeting-audio-link", "audio");
  }

  function reopenMeetingSummaryAttachment(card, attachments, summaryIndex) {
    if (summaryIndex >= 0) {
      showAttachmentViewer(card, attachments, {
        initialIndex: summaryIndex,
        onDismiss: () => showTranscript(card)
      });
      return true;
    }
    showTranscript(card);
    return false;
  }

  function openMeetingAttachmentFromHtml(card, attachments, summaryIndex, targetTitle) {
    const candidates = Array.isArray(targetTitle) ? targetTitle : [targetTitle];
    for (const candidate of candidates) {
      const targetIndex = meetingAttachmentIndexByTitle(attachments, candidate);
      if (targetIndex < 0) {
        continue;
      }
      showAttachmentViewer(card, attachments, {
        initialIndex: targetIndex,
        onDismiss: () => reopenMeetingSummaryAttachment(card, attachments, summaryIndex)
      });
      return true;
    }
    return false;
  }

  function installMeetingHtmlActionBridge(iframe, { card, attachments, summaryIndex } = {}) {
    if (!(iframe instanceof HTMLIFrameElement) || !card || !Array.isArray(attachments) || summaryIndex < 0) {
      return;
    }
    const bind = () => {
      const doc = iframe.contentDocument;
      if (!doc || !doc.body || doc.__puckyMeetingLinksBound) {
        return;
      }
      doc.__puckyMeetingLinksBound = true;
      doc.addEventListener("click", event => {
        const eventTarget = event.target;
        const candidate = eventTarget && typeof eventTarget === "object" && "nodeType" in eventTarget && Number(eventTarget.nodeType) === 3
          ? eventTarget.parentElement
          : eventTarget;
        const target = candidate && typeof candidate.closest === "function"
          ? candidate.closest("a[data-pucky-meeting-action]")
          : null;
        if (!target || String(target.tagName || "").toLowerCase() !== "a") {
          return;
        }
        const action = String(target.dataset.puckyMeetingAction || "").trim().toLowerCase();
        if (action === "transcript") {
          event.preventDefault();
          event.stopPropagation();
          if (!openMeetingAttachmentFromHtml(card, attachments, summaryIndex, ["Transcript", "Transcript (Plain Text)", "Meeting Transcript HTML", "Meeting Transcript"])) {
            target.removeAttribute("data-pucky-meeting-action");
            target.click();
          }
          return;
        }
        if (action === "audio") {
          event.preventDefault();
          event.stopPropagation();
          if (!openMeetingAttachmentFromHtml(card, attachments, summaryIndex, "Meeting Audio")) {
            target.removeAttribute("data-pucky-meeting-action");
            target.click();
          }
        }
      });
    };
    iframe.addEventListener("load", bind);
    bind();
    requestAnimationFrame(bind);
  }

  async function rewriteMeetingHtmlContent(htmlText, source = {}, options = {}) {
    const raw = String(htmlText || "");
    if (!raw) {
      return raw;
    }
    const transcriptHref = String(options.transcriptHref || "").trim();
    const audioHref = String(options.audioHref || "").trim();
    const hasTranscriptPlaceholder = raw.includes("{{PUCKY_MEETING_TRANSCRIPT_LINK}}");
    const hasPlaceholder = raw.includes("{{PUCKY_MEETING_AUDIO_LINK}}");
    const hasRawMeetingAudioUrl = /\/api\/meetings\/[^"' ]+\/audio/i.test(raw);
    const hasBrokenTranscriptLink = /<a\b[^>]*href=["']<a\b[^>]*pucky-meeting-transcript-link\b[^>]*>.*?<\/a>["'][^>]*>.*?<\/a>/i.test(raw);
    const hasBrokenAudioLink = /<a\b[^>]*href=["']<a\b[^>]*pucky-meeting-audio-link\b[^>]*>.*?<\/a>["'][^>]*>.*?<\/a>/i.test(raw);
    if (!hasTranscriptPlaceholder && !hasPlaceholder && !hasRawMeetingAudioUrl && !hasBrokenTranscriptLink && !hasBrokenAudioLink) {
      return raw;
    }
    let output = raw;
    if (hasTranscriptPlaceholder) {
      const transcriptReplacement = transcriptHref
        ? meetingTranscriptLinkHtml(transcriptHref)
        : '<span class="pucky-meeting-transcript-link is-unavailable">Transcript unavailable on this device.</span>';
      output = output.replace(/<a\b[^>]*href=["']\{\{PUCKY_MEETING_TRANSCRIPT_LINK\}\}["'][^>]*>.*?<\/a>/gi, transcriptReplacement);
      output = output.replace(/\{\{PUCKY_MEETING_TRANSCRIPT_LINK\}\}/g, transcriptReplacement);
    }
    if (transcriptHref) {
      output = output.replace(/<a\b[^>]*data-pucky-meeting-action=["']transcript["'][^>]*>.*?<\/a>/gi, meetingTranscriptLinkHtml(transcriptHref));
      output = output.replace(/<a\b[^>]*href=["']<a\b[^>]*pucky-meeting-transcript-link\b[^>]*>.*?<\/a>["'][^>]*>.*?<\/a>/gi, meetingTranscriptLinkHtml(transcriptHref));
    }
    const replacement = audioHref
      ? meetingAudioLinkHtml(audioHref)
      : '<span class="pucky-meeting-audio-link is-unavailable">Audio unavailable on this device.</span>';
    output = output.replace(/<a\b[^>]*href=["']\{\{PUCKY_MEETING_AUDIO_LINK\}\}["'][^>]*>.*?<\/a>/gi, replacement);
    output = output.replace(/\{\{PUCKY_MEETING_AUDIO_LINK\}\}/g, replacement);
    if (audioHref) {
      output = output.replace(/<a\b[^>]*data-pucky-meeting-action=["']audio["'][^>]*>.*?<\/a>/gi, meetingAudioLinkHtml(audioHref, "Listen To Audio"));
      output = output.replace(/<a\b[^>]*href=["']<a\b[^>]*pucky-meeting-audio-link\b[^>]*>.*?<\/a>["'][^>]*>.*?<\/a>/gi, meetingAudioLinkHtml(audioHref, "Listen To Audio"));
    }
    if (audioHref) {
      output = output.replace(/<a([^>]*?)href=["'](?:https?:\/\/[^"' ]+)?\/api\/meetings\/[^"' ]+\/audio["']([^>]*)>(.*?)<\/a>/gi, meetingAudioLinkHtml(audioHref, "Listen To Audio"));
      output = output.replace(/<a([^>]*?)href=["']\/api\/meetings\/[^"' ]+\/audio["']([^>]*)>(.*?)<\/a>/gi, meetingAudioLinkHtml(audioHref, "Listen To Audio"));
    }
    return output;
  }

  async function showImageReel(card, imageSet = null, options = {}) {
    state.audioCard = null;
    const restoreOptions = typeof options === "number" ? { initialIndex: options } : options;
    const images = normalizedImages(imageSet || restorableImagesForCard(card));
    const panel = document.getElementById("detail");
    const content = el("div", "detail-content image-reel");
    const onDismiss = typeof restoreOptions.onDismiss === "function" ? restoreOptions.onDismiss : null;
    const startIndex = Math.max(0, Math.min(images.length - 1, Number(restoreOptions.initialIndex ?? restoreOptions.imageIndex ?? 0)));
    const dismissGallery = () => {
      panel.style.transform = "";
      panel.classList.remove("is-dragging");
      if (onDismiss) {
        onDismiss();
      } else {
        dismissDetail();
      }
    };
    if (!images.length) {
      content.append(el("p", "preview", "No images are attached to this reply."));
    } else {
      const gallery = el("div", "image-gallery");
      const track = el("div", "image-gallery-track");
      track.dataset.dragIgnore = "true";
      images.forEach((image, index) => {
        const slide = el("figure", "image-slide");
        const frame = el("div", "image-slide-frame");
        if (isVideoMedia(image)) {
          const video = document.createElement("video");
          video.className = "image-reel-video";
          video.controls = true;
          video.playsInline = true;
          video.preload = "metadata";
          video.setAttribute("aria-label", image.title || image.alt || `Video ${index + 1}`);
          frame.append(video);
          resolveMediaSrc(image)
            .then(src => { video.src = src; })
            .catch(() => { frame.append(el("span", "chat-media-error", "Video unavailable")); });
        } else if (isDocumentMedia(image)) {
          frame.append(mediaDocumentPreview(image, "gallery"));
        } else {
          const imageEl = document.createElement("img");
          imageEl.className = "image-reel-img";
          imageEl.alt = image.title || image.alt || `Generated image ${index + 1}`;
          imageEl.decoding = "async";
          frame.append(imageEl);
          resolveImageSrc(image)
            .then(src => { imageEl.src = src; })
            .catch(error => {
              imageEl.remove();
              frame.append(el("p", "preview", `Image unavailable: ${error.message}`));
            });
        }
        const meta = el("figcaption", "image-reel-meta");
        const caption = image.title || image.alt || "";
        if (caption) {
          meta.append(el("span", "image-caption", caption));
        }
        if (images.length > 1) {
          meta.append(el("span", "image-reel-count", `${index + 1} / ${images.length}`));
        }
        slide.append(frame, meta);
        track.append(slide);
      });
      gallery.append(track);
      content.append(gallery, el("div", "image-swipe-edge"));
      installOneSlidePager(track);
      requestAnimationFrame(() => {
        const slide = track.children[startIndex];
        if (slide) {
          track.scrollLeft = slide.offsetLeft;
        }
      });
    }
    applyDetailDataAttributes(panel, "images", card, { viewer: "image_gallery" });
    openSideDetail(panel, card.title || "Images", content, dismissGallery);
    rememberNavDetail("images", card, { ...restoreOptions, imageIndex: startIndex });
    installDetailScrollPersistence(content, "images");
    void syncVoiceThreadScope({ reason: "show_images", render: true });
    restoreScrollPosition(content, restoreOptions.scrollTop);
  }

  async function showAttachmentViewer(card, attachmentSet = null, options = {}) {
    const restoreOptions = typeof options === "number" ? { initialIndex: options } : options;
    const attachments = normalizedAttachments(attachmentSet || restorableImagesForCard(card));
    const startIndex = Math.max(0, Math.min(attachments.length - 1, Number(restoreOptions.initialIndex ?? restoreOptions.imageIndex ?? 0)));
    const item = attachments[startIndex];
    if (!item) {
      return showImageReel(card, [], restoreOptions);
    }
    const viewerType = attachmentViewerType(item);
    if (viewerType === "image_gallery") {
      const images = attachments.filter(attachment => attachmentViewerType(attachment) === "image_gallery");
      const imageIndex = Math.max(0, images.indexOf(item));
      return showImageReel(card, images, { ...restoreOptions, initialIndex: imageIndex });
    }
    if (viewerType === "video_player") {
      return showVideoAttachment(card, item, { ...restoreOptions, initialIndex: startIndex, attachmentSet: attachments });
    }
    if (viewerType === "audio_player") {
      return showAudioAttachment(card, item, { ...restoreOptions, initialIndex: startIndex, attachmentSet: attachments });
    }
    return showDocumentAttachment(card, item, { ...restoreOptions, initialIndex: startIndex, attachmentSet: attachments });
  }

  async function showVideoAttachment(card, item, options = {}) {
    state.audioCard = null;
    const panel = document.getElementById("detail");
    const dismissAttachment = detailDismissHandler(options);
    const content = el("div", "detail-content attachment-detail video-detail");
    const frame = el("section", "video-player-card");
    const shell = el("div", "attachment-video-shell");
    const video = document.createElement("video");
    video.className = "attachment-video-player";
    video.controls = false;
    video.playsInline = true;
    video.setAttribute("playsinline", "");
    video.setAttribute("webkit-playsinline", "");
    video.preload = "metadata";
    video.setAttribute("aria-label", item.title || item.alt || "Video attachment");
    const play = el("button", "attachment-video-play");
    play.type = "button";
    play.innerHTML = iconSvg("play_arrow", { filled: true });
    play.setAttribute("aria-label", "Play video");
    const controls = el("div", "video-controls");
    const elapsed = el("span", "video-time video-elapsed", "0:00");
    const timeline = el("div", "video-timeline");
    timeline.setAttribute("role", "slider");
    timeline.setAttribute("aria-label", "Video position");
    timeline.setAttribute("aria-valuemin", "0");
    timeline.setAttribute("aria-valuemax", "0");
    timeline.setAttribute("aria-valuenow", "0");
    const progress = el("div", "video-progress");
    const scrubber = el("div", "video-scrubber");
    timeline.append(progress, scrubber);
    const durationLabel = el("span", "video-time video-duration", "0:00");
    controls.append(elapsed, timeline, durationLabel);
    const updateVideoUi = () => {
      const duration = Number(video.duration || 0);
      const position = Number(video.currentTime || 0);
      const ratio = duration > 0 ? Math.max(0, Math.min(1, position / duration)) : 0;
      shell.classList.toggle("is-playing", !video.paused && !video.ended);
      play.innerHTML = iconSvg(!video.paused && !video.ended ? "pause" : "play_arrow", { filled: true });
      play.setAttribute("aria-label", !video.paused && !video.ended ? "Pause video" : "Play video");
      elapsed.textContent = formatVideoTime(position);
      durationLabel.textContent = duration > 0 ? formatVideoTime(duration) : "0:00";
      progress.style.width = `${ratio * 100}%`;
      scrubber.style.left = `${ratio * 100}%`;
      timeline.setAttribute("aria-valuemax", String(Math.max(0, Math.floor(duration))));
      timeline.setAttribute("aria-valuenow", String(Math.max(0, Math.floor(position))));
    };
    const seekFromPointer = (event) => {
      const duration = Number(video.duration || 0);
      if (!(duration > 0)) {
        return;
      }
      const rect = timeline.getBoundingClientRect();
      const clientX = Number(event.clientX || 0);
      const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / Math.max(1, rect.width)));
      video.currentTime = ratio * duration;
      updateVideoUi();
    };
    let scrubbing = false;
    timeline.addEventListener("pointerdown", event => {
      event.preventDefault();
      event.stopPropagation();
      scrubbing = true;
      timeline.setPointerCapture(event.pointerId);
      seekFromPointer(event);
    });
    timeline.addEventListener("pointermove", event => {
      if (!scrubbing) {
        return;
      }
      event.preventDefault();
      seekFromPointer(event);
    });
    const finishScrub = (event) => {
      if (!scrubbing) {
        return;
      }
      event.preventDefault();
      seekFromPointer(event);
      scrubbing = false;
      if (timeline.hasPointerCapture(event.pointerId)) {
        timeline.releasePointerCapture(event.pointerId);
      }
    };
    timeline.addEventListener("pointerup", finishScrub);
    timeline.addEventListener("pointercancel", finishScrub);
    const toggle = async () => {
      try {
        if (!video.paused && !video.ended) {
          video.pause();
        } else {
          await video.play();
        }
        updateVideoUi();
      } catch (error) {
        frame.append(el("p", "attachment-error", `Video playback unavailable: ${error.message}`));
      }
    };
    play.addEventListener("click", event => {
      event.stopPropagation();
      toggle();
    });
    video.addEventListener("click", event => {
      event.stopPropagation();
      toggle();
    });
    video.addEventListener("loadedmetadata", updateVideoUi);
    video.addEventListener("timeupdate", updateVideoUi);
    video.addEventListener("seeked", updateVideoUi);
    video.addEventListener("play", updateVideoUi);
    video.addEventListener("pause", updateVideoUi);
    video.addEventListener("ended", updateVideoUi);
    shell.append(video, play, controls);
    frame.append(shell);
    content.append(frame);
    applyDetailDataAttributes(panel, "attachment", card, { viewer: "video_player" });
    openSideDetail(panel, item.title || card.title || "Video", content, dismissAttachment);
    rememberNavDetail("attachment", card, options);
    installDetailScrollPersistence(content, "attachment");
    void syncVoiceThreadScope({ reason: "show_video_attachment", render: true });
    restoreScrollPosition(content, options.scrollTop);
    try {
      video.src = await resolveMediaSrc(item, {
        maxBytes: 64 * 1024 * 1024
      });
    } catch (error) {
      frame.append(el("p", "attachment-error", `Video unavailable: ${error.message}`));
    }
  }

  function formatVideoTime(seconds) {
    const total = Math.max(0, Math.floor(Number(seconds || 0)));
    const minutes = Math.floor(total / 60);
    const remainder = total % 60;
    return `${minutes}:${String(remainder).padStart(2, "0")}`;
  }

  async function showAudioAttachment(card, item, options = {}) {
    state.audioCard = null;
    const panel = document.getElementById("detail");
    const dismissAttachment = detailDismissHandler(options);
    const content = el("div", "detail-content attachment-detail document-detail audio-attachment-detail");
    const wrap = el("section", "attachment-audio-card");
    wrap.append(attachmentMeta(item, "Audio"));
    const audio = document.createElement("audio");
    audio.className = "attachment-audio-player";
    audio.controls = true;
    audio.preload = "metadata";
    wrap.append(audio);
    content.append(wrap);
    applyDetailDataAttributes(panel, "attachment", card, { viewer: "audio_player" });
    openSideDetail(panel, item.title || card.title || "Audio", content, dismissAttachment);
    rememberNavDetail("attachment", card, options);
    void syncVoiceThreadScope({ reason: "show_audio_attachment", render: true });
    try {
      audio.src = await resolveAudioAttachmentSrc(item, { maxBytes: 32 * 1024 * 1024 });
    } catch (error) {
      wrap.append(el("p", "attachment-error", `Audio unavailable: ${error.message}`));
    }
  }

  async function showDocumentAttachment(card, item, options = {}) {
    state.audioCard = null;
    const panel = document.getElementById("detail");
    const dismissAttachment = detailDismissHandler(options);
    const kind = attachmentKind(item);
    const content = el("div", `detail-content attachment-detail document-detail document-${kind}`);
    const viewer = await documentViewer(card, item, options);
    content.append(viewer);
    applyDetailDataAttributes(panel, "attachment", card, { viewer: attachmentViewerType(item) });
    openSideDetail(panel, item.title || card.title || "Attachment", content, dismissAttachment);
    rememberNavDetail("attachment", card, options);
    installDetailScrollPersistence(content, "attachment");
    void syncVoiceThreadScope({ reason: "show_document_attachment", render: true });
    restoreScrollPosition(content, options.scrollTop);
  }

  async function documentViewer(card, item, options = {}) {
    const viewerType = attachmentViewerType(item);
    if (viewerType === "html_iframe") {
      return htmlIframeViewer(card, item, options);
    }
    if (viewerType === "table") {
      return tableViewer(item);
    }
    if (viewerType === "text") {
      return textViewer(item);
    }
    const htmlSrc = documentHtmlSrc(item);
    if (htmlSrc) {
      return documentHtmlViewer(htmlSrc, item);
    }
    const kind = attachmentKind(item);
    const wrap = el("section", "document-fallback");
    wrap.append(mediaDocumentPreview(item, "gallery"));
    try {
      const src = await resolveArtifactUrl(item, { maxBytes: 10 * 1024 * 1024 });
      wrap.append(attachmentMeta(item, `${kind.toUpperCase()} cached artifact`));
      const link = el("a", "document-open-link", "Open cached file");
      link.href = src;
      link.target = "_blank";
      wrap.append(link);
    } catch (error) {
      wrap.append(el("p", "attachment-error", `Attachment unavailable: ${error.message}`));
    }
    return wrap;
  }

  async function htmlIframeViewer(card, item, options = {}) {
    const iframe = el("iframe", "document-frame");
    iframe.setAttribute("sandbox", "allow-scripts allow-forms allow-popups allow-same-origin");
    const artifactId = attachmentArtifactId(item, ["viewer_artifact", "html_artifact", "document_html_artifact", "artifact"]);
    const localPath = item.viewer_path || item.html_viewer_path || item.document_html_path || htmlAttachmentLocalPath(item);
    const src = documentHtmlSrc(item);
    try {
      const transcriptContext = await resolveMeetingTranscriptLink(card, item);
      const audioContext = await resolveMeetingAudioAttachmentLink(card, item);
      const hasNativeBridge = Boolean(window.PuckyAndroid && typeof window.PuckyAndroid.postMessage === "function");
      if (src && /^data:/i.test(src)) {
        iframe.srcdoc = await rewriteMeetingHtmlContent(decodeHtmlDataUrl(src), item, {
          transcriptHref: transcriptContext.href,
          audioHref: audioContext.href
        });
      } else if (src || artifactId) {
        iframe.srcdoc = await rewriteMeetingHtmlContent(await fetchHtmlAttachmentText(item, artifactId, src), item, {
          transcriptHref: transcriptContext.href,
          audioHref: audioContext.href
        });
      } else if (hasNativeBridge && isAndroidLocalArtifactPath(localPath)) {
        const readPath = isAndroidLocalArtifactPath(localPath) ? localPath : artifactVirtualPath(artifactId);
        const result = await Pucky.request({
          command: "artifact.read_base64",
          args: { path: readPath, max_bytes: 2 * 1024 * 1024 }
        });
        iframe.srcdoc = await rewriteMeetingHtmlContent(atob(String(result.content_base64 || "")), item, {
          transcriptHref: transcriptContext.href,
          audioHref: audioContext.href
        });
      } else {
        throw new Error("HTML attachment source is missing");
      }
      installMeetingHtmlActionBridge(iframe, {
        card,
        attachments: Array.isArray(options.attachmentSet) ? options.attachmentSet : meetingAttachmentsForCard(card),
        summaryIndex: Number.isFinite(Number(options.initialIndex)) ? Number(options.initialIndex) : meetingSummaryAttachmentIndex(meetingAttachmentsForCard(card), item)
      });
    } catch (error) {
      const fallback = el("section", "document-fallback");
      fallback.append(attachmentMeta(item, "HTML"));
      fallback.append(el("p", "attachment-error", `HTML preview unavailable: ${error.message}`));
      return fallback;
    }
    return iframe;
  }

  async function fetchHtmlAttachmentText(item, artifactId, src = "") {
    const htmlSrc = String(src || "").trim();
    if (htmlSrc) {
      const response = await fetchArtifactHttpResponse(htmlSrc, "HTML artifact");
      return await response.text();
    }
    if (artifactId) {
      const response = await fetchArtifactHttpResponse(artifactApiUrl(artifactId), "HTML artifact");
      return await response.text();
    }
    throw new Error("HTML attachment source is missing");
  }

  function decodeHtmlDataUrl(src) {
    const value = String(src || "").trim();
    if (!/^data:/i.test(value)) {
      return value;
    }
    const commaIndex = value.indexOf(",");
    if (commaIndex < 0) {
      return "";
    }
    const metadata = value.slice(5, commaIndex).toLowerCase();
    const payload = value.slice(commaIndex + 1);
    try {
      if (metadata.includes(";base64")) {
        return atob(payload);
      }
      return decodeURIComponent(payload);
    } catch (_) {
      return "";
    }
  }

  async function tableViewer(item) {
    const wrap = el("section", "table-viewer");
    wrap.append(attachmentMeta(item, "Table"));
    const rows = Array.isArray(item?.viewer?.rows) ? item.viewer.rows : Array.isArray(item?.rows) ? item.rows : [];
    const columns = Array.isArray(item?.viewer?.columns) ? item.viewer.columns : Array.isArray(item?.columns) ? item.columns : [];
    if (rows.length) {
      wrap.append(tableElement(columns, rows));
      return wrap;
    }
    try {
      const src = await resolveArtifactUrl(item, { maxBytes: 2 * 1024 * 1024, preferDataUrl: true });
      const text = src.startsWith("data:") ? atob(src.split(",", 2)[1] || "") : await loadLocalText(src);
      wrap.append(tableElement([], parseCsvPreview(text)));
    } catch (error) {
      wrap.append(el("p", "attachment-error", `Table preview unavailable: ${error.message}`));
      wrap.append(await downloadFallbackViewer(item));
    }
    return wrap;
  }

  async function textViewer(item) {
    const wrap = el("section", "text-viewer");
    wrap.append(attachmentMeta(item, "Text"));
    const inline = String(item?.viewer?.text || item?.preview?.text || item?.text || "");
    try {
      const text = inline || await textFromAttachment(item);
      wrap.append(el("pre", "text-preview", text || "No text preview is available."));
    } catch (error) {
      wrap.append(el("p", "attachment-error", `Text preview unavailable: ${error.message}`));
      wrap.append(await downloadFallbackViewer(item));
    }
    return wrap;
  }

  async function textFromAttachment(item) {
    const src = await resolveArtifactUrl(item, { maxBytes: 2 * 1024 * 1024, preferDataUrl: true });
    if (src.startsWith("data:")) {
      return atob(src.split(",", 2)[1] || "");
    }
    return loadLocalText(src);
  }

  async function downloadFallbackViewer(item) {
    const wrap = el("div", "document-open-wrap");
    try {
      const src = await resolveArtifactUrl(item, { maxBytes: 10 * 1024 * 1024 });
      const link = el("a", "document-open-link", "Open cached file");
      link.href = src;
      link.target = "_blank";
      wrap.append(link);
    } catch (error) {
      wrap.append(el("p", "attachment-error", `Original unavailable: ${error.message}`));
    }
    return wrap;
  }

  function tableElement(columns, rows) {
    const table = el("table", "attachment-table");
    const normalizedRows = rows.slice(0, 80).map(row => Array.isArray(row) ? row : Object.values(row || {}));
    const headerValues = columns.length ? columns : normalizedRows.shift() || [];
    const thead = document.createElement("thead");
    const headRow = document.createElement("tr");
    headerValues.forEach(value => headRow.append(el("th", "", String(value))));
    thead.append(headRow);
    const tbody = document.createElement("tbody");
    normalizedRows.forEach(row => {
      const tr = document.createElement("tr");
      row.forEach(value => tr.append(el("td", "", String(value))));
      tbody.append(tr);
    });
    table.append(thead, tbody);
    return table;
  }

  function parseCsvPreview(text) {
    return String(text || "")
      .split(/\r?\n/)
      .filter(Boolean)
      .slice(0, 81)
      .map(row => row.split(",").map(cell => cell.trim()));
  }

  async function documentHtmlViewer(src, item) {
    const wrap = el("article", "document-rendered");
    wrap.dataset.kind = attachmentKind(item);
    try {
      const text = await loadDocumentHtml(src, item);
      const parsed = new DOMParser().parseFromString(text, "text/html");
      const children = Array.from(parsed.body ? parsed.body.children : []);
      if (!children.length) {
        throw new Error("Document HTML was empty");
      }
      children.forEach(child => wrap.append(document.importNode(child, true)));
    } catch (error) {
      wrap.append(attachmentMeta(item, "Document"));
      wrap.append(el("p", "attachment-error", `Document preview unavailable: ${error.message}`));
    }
    return wrap;
  }

  async function loadDocumentHtml(src, item) {
    const path = item && (item.viewer_path || item.html_viewer_path || item.document_html_path);
    if (path) {
      const result = await Pucky.request({
        command: "artifact.read_base64",
        args: { path, max_bytes: 2 * 1024 * 1024 }
      });
      return atob(String(result.content_base64 || ""));
    }
    return loadLocalText(src);
  }

  function loadLocalText(src) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("GET", src, true);
      xhr.onload = () => {
        if ((xhr.status >= 200 && xhr.status < 300) || xhr.status === 0) {
          resolve(xhr.responseText || "");
        } else {
          reject(new Error(`HTTP ${xhr.status}`));
        }
      };
      xhr.onerror = () => reject(new Error("Unable to load cached document"));
      xhr.send();
    });
  }

  function attachmentMeta(item, fallback) {
    const meta = el("div", "attachment-meta");
    meta.append(el("strong", "attachment-title", item.title || fallback || "Attachment"));
    if (item.alt) {
      meta.append(el("span", "attachment-subtitle", item.alt));
    }
    return meta;
  }

  function detailDismissHandler(options = {}, fallback = dismissDetail) {
    return typeof options.onDismiss === "function" ? options.onDismiss : fallback;
  }

  async function resolveImageSrc(image) {
    return resolveArtifactUrl(image);
  }

  async function resolveMediaSrc(image, options = {}) {
    return resolveArtifactUrl(image, {
      ...options,
      preferDataUrl: isVideoMedia(image) ? true : options.preferDataUrl
    });
  }

  function hasNativeArtifactBridge() {
    return Boolean(window.PuckyAndroid && typeof window.PuckyAndroid.postMessage === "function");
  }

  async function resolveArtifactUrl(item, options = {}) {
    if (item.src || item.data_url) {
      return String(item.src || item.data_url);
    }
    const hasNativeBridge = hasNativeArtifactBridge();
    const artifactId = attachmentArtifactId(item);
    const path = mediaPath(item);
    if (path && hasNativeBridge && isAndroidLocalArtifactPath(path)) {
      return resolveLocalArtifactPath(path, item, options);
    }
    if (artifactId) {
      if (hasNativeBridge) {
        const virtualPath = artifactVirtualPath(artifactId);
        if (virtualPath) {
          return resolveLocalArtifactPath(virtualPath, { ...(item || {}), path: virtualPath }, options);
        }
      }
      if (options.preferDataUrl) {
        return resolveRemoteArtifactObjectUrl(artifactId, item);
      }
      const apiUrl = artifactApiUrl(artifactId);
      if (apiUrl) {
        return apiUrl;
      }
    }
    if (item.url) {
      return String(item.url);
    }
    const bundled = bundledArtifactPath(item);
    if (bundled) {
      return bundled;
    }
    if (!path) {
      throw new Error("attachment path is missing");
    }
    return resolveLocalArtifactPath(path, item, options);
  }

  async function resolveRemoteArtifactObjectUrl(artifactId, item) {
    const apiUrl = artifactApiUrl(artifactId);
    if (!apiUrl) {
      throw new Error("artifact url is missing");
    }
    const response = await fetchArtifactHttpResponse(apiUrl, "Artifact");
    const mime = resolvedMediaMime(
      { mime_type: String(response.headers.get("content-type") || "").split(";", 1)[0].trim() },
      item,
      apiUrl
    );
    return URL.createObjectURL(new Blob([await response.arrayBuffer()], { type: mime }));
  }

  async function fetchArtifactHttpResponse(url, label = "Artifact") {
    const apiUrl = String(url || "").trim();
    if (!apiUrl) {
      throw new Error("artifact url is missing");
    }
    await ensureLinksApiConfig();
    const response = await fetch(apiUrl, { cache: "no-store", headers: {} });
    if (!response.ok) {
      throw new Error(`${label} unavailable: HTTP ${response.status}`);
    }
    return response;
  }

  async function resolveLocalArtifactPath(path, item, options = {}) {
    if (!options.preferDataUrl && window.PuckyAndroid && typeof window.PuckyAndroid.postMessage === "function") {
      try {
        const result = await Pucky.request({
          command: "artifact.url",
          args: { path }
        });
        if (result && result.url) {
          return String(result.url);
        }
      } catch (_) {
        // Older APKs only expose base64; keep a bounded fallback for small diagnostics.
      }
    }
    const result = await Pucky.request({
      command: "artifact.read_base64",
      args: { path, max_bytes: options.maxBytes || 5 * 1024 * 1024 }
    });
    const mime = resolvedMediaMime(result, item, path);
    return `data:${mime};base64,${result.content_base64 || ""}`;
  }

  function resolvedImageMime(result, image, path) {
    return resolvedMediaMime(result, image, path);
  }

  function resolvedMediaMime(result, image, path) {
    const declared = String((image && image.mime_type) || "").trim();
    if (declared && declared !== "application/octet-stream") {
      return declared;
    }
    const returned = String((result && result.mime_type) || "").trim();
    if (returned && returned !== "application/octet-stream") {
      return returned;
    }
    return guessMediaMime(path);
  }

  function guessImageMime(path) {
    return guessMediaMime(path);
  }

  function guessMediaMime(path) {
    const value = String(path || "").toLowerCase();
    if (value.endsWith(".m4a")) return "audio/mp4";
    if (value.endsWith(".mp3")) return "audio/mpeg";
    if (value.endsWith(".wav")) return "audio/wav";
    if (value.endsWith(".aac")) return "audio/aac";
    if (value.endsWith(".ogg")) return "audio/ogg";
    if (value.endsWith(".opus")) return "audio/opus";
    if (value.endsWith(".mp4")) return "video/mp4";
    if (value.endsWith(".webm")) return "video/webm";
    if (value.endsWith(".mov")) return "video/quicktime";
    if (value.endsWith(".jpg") || value.endsWith(".jpeg")) return "image/jpeg";
    if (value.endsWith(".webp")) return "image/webp";
    if (value.endsWith(".gif")) return "image/gif";
    if (value.endsWith(".svg")) return "image/svg+xml";
    if (value.endsWith(".pdf")) return "application/pdf";
    if (value.endsWith(".docx")) return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    if (value.endsWith(".xlsx")) return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    if (value.endsWith(".csv")) return "text/csv";
    if (value.endsWith(".html") || value.endsWith(".htm")) return "text/html";
    return "application/octet-stream";
  }

  function mediaPath(item) {
    return item && (item.path || item.local_path || item.image_path || item.artifact_path || "");
  }

  function attachmentArtifactId(item, preferredFields = []) {
    const fields = preferredFields.concat([
      "artifact",
      "viewer_artifact",
      "html_artifact",
      "document_html_artifact",
      "preview_artifact"
    ]);
    for (const field of fields) {
      const value = String(item?.[field] || item?.viewer?.[field] || item?.original?.[field] || "").trim();
      if (value) {
        return value;
      }
    }
    return "";
  }

  function artifactVirtualPath(artifactId) {
    const value = String(artifactId || "").trim();
    return value ? `fixtures/artifacts/${encodeURI(value)}` : "";
  }

  function artifactApiUrl(artifactId) {
    const value = String(artifactId || "").trim();
    return value ? `/api/artifacts/${encodeURIComponent(value)}` : "";
  }

  function bundledArtifactPath(item, field = "artifact") {
    return artifactVirtualPath(item && item[field]);
  }

  function documentHtmlSrc(item) {
    const viewer = item && item.viewer && typeof item.viewer === "object" ? item.viewer : {};
    if (viewer.viewer_src || viewer.viewer_url || viewer.html_src || viewer.html_url || viewer.viewer_path || viewer.html_viewer_path || viewer.document_html_path) {
      return String(viewer.viewer_src || viewer.viewer_url || viewer.html_src || viewer.html_url || viewer.viewer_path || viewer.html_viewer_path || viewer.document_html_path);
    }
    const direct = item && (item.viewer_src || item.viewer_url || item.html_src || item.html_url || item.viewer_path || item.html_viewer_path || item.document_html_path);
    if (direct) {
      return String(direct);
    }
    return bundledArtifactPath(viewer, "viewer_artifact")
      || bundledArtifactPath(viewer, "html_artifact")
      || bundledArtifactPath(viewer, "document_html_artifact")
      || bundledArtifactPath(item, "viewer_artifact")
      || bundledArtifactPath(item, "html_artifact")
      || bundledArtifactPath(item, "document_html_artifact");
  }

  function attachmentKind(item) {
    const explicit = String((item && item.kind) || "").toLowerCase();
    if (["image", "video", "audio", "document", "table", "html", "text", "archive", "unknown"].includes(explicit)) {
      return explicit;
    }
    const meta = mediaDocumentMeta(item);
    if (meta.kind) {
      return meta.kind === "pdf" || meta.kind === "docx" || meta.kind === "pptx" ? "document" : meta.kind;
    }
    const mime = String((item && item.mime_type) || "").toLowerCase();
    const path = String(mediaPath(item) || bundledArtifactPath(item) || item?.src || item?.data_url || "").toLowerCase();
    if (mime.startsWith("video/") || /\.(mp4|webm|mov)(?:$|[?#])/i.test(path)) {
      return "video";
    }
    if (mime.startsWith("audio/") || /\.(mp3|m4a|wav|aac|ogg|opus)(?:$|[?#])/i.test(path)) {
      return "audio";
    }
    if (mime.startsWith("image/") || /\.(avif|gif|jpe?g|png|svg|webp)(?:$|[?#])/i.test(path)) {
      return "image";
    }
    if (mime === "text/csv" || /\.csv(?:$|[?#])/i.test(path)) {
      return "table";
    }
    if (mime === "text/html" || /\.html?(?:$|[?#])/i.test(path)) {
      return "html";
    }
    if (mime === "text/plain" || /\.txt(?:$|[?#])/i.test(path)) {
      return "text";
    }
    return "unknown";
  }

  function isPdfMedia(item) {
    return mediaDocumentMeta(item).kind === "pdf";
  }

  function isDocumentMedia(item) {
    const kind = attachmentKind(item);
    return !["image", "video"].includes(kind);
  }

  function isVideoMedia(item) {
    if (String((item && item.kind) || "").toLowerCase() === "video") {
      return true;
    }
    const mime = String((item && item.mime_type) || "").toLowerCase();
    const path = String((item && (mediaPath(item) || item.artifact || item.src || item.data_url)) || "").toLowerCase();
    return mime.startsWith("video/") || /\.(mp4|webm|mov)(?:$|[?#])/i.test(path);
  }

  function isImageMedia(item) {
    return attachmentKind(item) === "image";
  }

  function mediaDocumentMeta(item) {
    const kind = String((item && item.kind) || "").toLowerCase();
    if (kind === "document") {
      return { kind: documentSubkind(item), label: attachmentLabel(item, kind), title: "Document" };
    }
    if (kind === "table") {
      return { kind: "table", label: attachmentLabel(item, kind), title: "Table" };
    }
    if (kind === "html") {
      return { kind: "html", label: "HTML", title: "HTML page" };
    }
    if (kind === "text") {
      return { kind: "text", label: "TXT", title: "Text" };
    }
    if (kind === "archive") {
      return { kind: "archive", label: "ZIP", title: "Archive" };
    }
    if (kind === "unknown") {
      return { kind: "unknown", label: "FILE", title: "File" };
    }
    const mime = String((item && item.mime_type) || "").toLowerCase();
    const path = String((item && (mediaPath(item) || item.artifact || item.src || item.data_url)) || "");
    const lowerPath = path.toLowerCase();
    if (mime === "application/pdf" || /\.pdf(?:$|[?#])/i.test(lowerPath)) {
      return { kind: "pdf", label: "PDF", title: "PDF document" };
    }
    if (
      mime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
      /\.docx(?:$|[?#])/i.test(lowerPath)
    ) {
      return { kind: "docx", label: "DOCX", title: "Word document" };
    }
    if (
      mime === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
      /\.xlsx(?:$|[?#])/i.test(lowerPath) ||
      mime === "text/csv" ||
      /\.csv(?:$|[?#])/i.test(lowerPath)
    ) {
      return { kind: mime === "text/csv" || /\.csv(?:$|[?#])/i.test(lowerPath) ? "table" : "xlsx", label: mime === "text/csv" || /\.csv(?:$|[?#])/i.test(lowerPath) ? "CSV" : "XLSX", title: "Spreadsheet" };
    }
    if (
      mime === "application/vnd.openxmlformats-officedocument.presentationml.presentation" ||
      /\.pptx(?:$|[?#])/i.test(lowerPath)
    ) {
      return { kind: "pptx", label: "PPTX", title: "Presentation" };
    }
    return { kind: "", label: "FILE", title: "Document" };
  }

  function documentSubkind(item) {
    const mime = String((item && item.mime_type) || "").toLowerCase();
    const path = String((item && (mediaPath(item) || item.artifact || item.src || item.data_url)) || "").toLowerCase();
    if (mime === "application/pdf" || /\.pdf(?:$|[?#])/i.test(path)) return "pdf";
    if (mime.includes("wordprocessingml") || /\.docx(?:$|[?#])/i.test(path)) return "docx";
    if (mime.includes("presentationml") || /\.pptx(?:$|[?#])/i.test(path)) return "pptx";
    return "document";
  }

  function attachmentLabel(item, kind = attachmentKind(item)) {
    const mime = String((item && item.mime_type) || "").toLowerCase();
    if (kind === "image") return "IMG";
    if (kind === "video") return "MP4";
    if (kind === "audio") return "AUD";
    if (kind === "table") return mime.includes("spreadsheetml") ? "XLSX" : "CSV";
    if (kind === "html") return "HTML";
    if (kind === "text") return "TXT";
    if (kind === "archive") return "ZIP";
    const subkind = documentSubkind(item);
    if (subkind === "pdf") return "PDF";
    if (subkind === "docx") return "DOCX";
    if (subkind === "pptx") return "PPTX";
    return "FILE";
  }

  function mediaDocumentPreview(item, variant) {
    const meta = mediaDocumentMeta(item);
    const wrap = el("div", `media-doc-preview ${variant === "gallery" ? "is-gallery" : "is-chat"}`);
    wrap.dataset.kind = meta.kind || "file";
    const previewSrc = documentPreviewSrc(item);
    if (previewSrc) {
      wrap.classList.add("has-render");
      const image = document.createElement("img");
      image.className = "media-doc-render";
      image.alt = item.alt || `${item.title || meta.title} preview`;
      image.decoding = "async";
      image.src = previewSrc;
      wrap.append(image);
    }
    const label = el("div", "media-doc-label");
    label.append(el("span", "media-doc-badge", meta.label || attachmentLabel(item)));
    label.append(el("strong", "media-doc-title", item.title || meta.title));
    label.append(el("span", "media-doc-subtitle", previewSubtitle(item, variant)));
    wrap.append(label);
    return wrap;
  }

  function documentPreviewSrc(item) {
    const preview = item && item.preview && typeof item.preview === "object" ? item.preview : {};
    if (preview.src || preview.url || preview.path) {
      return String(preview.src || preview.url || preview.path);
    }
    if (preview.artifact) {
      return `fixtures/artifacts/${encodeURI(String(preview.artifact))}`;
    }
    const direct = item && (item.preview_path || item.preview_src || item.preview_url);
    if (direct) {
      return String(direct);
    }
    const artifact = item && item.preview_artifact;
    return artifact ? `fixtures/artifacts/${encodeURI(String(artifact))}` : "";
  }

  function previewSubtitle(item, variant) {
    if (item.status && item.status !== "ready") {
      return item.status === "failed" ? "Preview failed" : "Processing";
    }
    if (variant === "gallery") {
      return item.size_bytes ? `${Math.round(Number(item.size_bytes) / 1024)} KB` : "Rendered from real local file";
    }
    return "Tap to view";
  }

  function showTurnTrace(card, message = null, index = 0) {
    dismissOriginSheet();
    state.traceCard = card;
    const sheet = document.getElementById("traceSheet");
    const wrap = el("div", "trace-inner");
    const dragZone = el("div", "sheet-drag-zone");
    dragZone.append(el("div", "sheet-grip"));
    wrap.append(dragZone);

    const traceCard = el("article", "trace-card");
    traceCard.append(el("h1", "trace-title", "Thinking Logs"));
    const entries = thinkingLogEntries(card, message, index);
    if (!entries.length) {
      traceCard.append(el("p", "trace-empty", "No activity details for this reply."));
    }
    for (const entry of entries) {
      const block = el("section", "trace-entry");
      block.append(el("p", "trace-thought", entry.title));
      const rows = el("div", "trace-tools");
      for (const item of entry.items) {
        const row = el("div", "trace-tool-row");
        row.append(el("i", `trace-dot ${traceStatusClass(item.status)}`));
        row.append(el("span", "trace-tool-label", cleanTraceLabel(item.label)));
        rows.append(row);
      }
      block.append(rows);
      traceCard.append(block);
    }
    wrap.append(traceCard);
    installVerticalDismiss(wrap, sheet, dismissTraceSheet);
    sheet.replaceChildren(wrap);
    sheet.setAttribute("aria-hidden", "false");
    sheet.classList.add("is-open");
  }

  function dismissTraceSheet() {
    const sheet = document.getElementById("traceSheet");
    sheet.style.transform = "";
    sheet.classList.remove("is-open", "is-dragging");
    sheet.setAttribute("aria-hidden", "true");
    sheet.replaceChildren();
    state.traceCard = null;
  }

  function showOriginSheet(card) {
    dismissTraceSheet();
    state.metaCard = card;
    const sheet = document.getElementById("metaSheet");
    if (!sheet) {
      return;
    }
    const origin = cardOrigin(card);
    const wrap = el("div", "trace-inner meta-inner");
    const dragZone = el("div", "sheet-drag-zone");
    dragZone.append(el("div", "sheet-grip"));
    wrap.append(dragZone);

    const metaCard = el("article", "meta-card");
    metaCard.append(el("h1", "trace-title", "Reply Details"));
    if (!origin.thread_id && !origin.rollout_path && !origin.model) {
      metaCard.append(el("p", "trace-empty", "No generation metadata is attached to this reply yet."));
    } else {
      const rows = el("div", "meta-rows");
      rows.append(
        metaRow("Card title", card.title || "Untitled reply"),
        metaRow("Thread title", origin.thread_title || "Unavailable"),
        metaRow("Model", origin.model || "Unavailable"),
        metaRow("Runtime", originRuntime(origin)),
        metaRow("Reasoning", origin.reasoning_effort || "Default"),
        metaRow("Sandbox", origin.sandbox_policy || "Unavailable"),
        metaRow("Approval", origin.approval_mode || "Unavailable"),
        metaRow("Thread ID", origin.thread_id || "Unavailable", { monospace: true }),
        metaRow("Rollout path", origin.rollout_path || "Unavailable", { monospace: true }),
        metaRow("Source", origin.source || "Unavailable")
      );
      metaCard.append(rows);
    }
    wrap.append(metaCard);
    installVerticalDismiss(wrap, sheet, dismissOriginSheet);
    sheet.replaceChildren(wrap);
    sheet.setAttribute("aria-hidden", "false");
    sheet.classList.add("is-open");
  }

  function dismissOriginSheet() {
    const sheet = document.getElementById("metaSheet");
    if (!sheet) {
      return;
    }
    sheet.style.transform = "";
    sheet.classList.remove("is-open", "is-dragging");
    sheet.setAttribute("aria-hidden", "true");
    sheet.replaceChildren();
    state.metaCard = null;
  }

  function openSideDetail(panel, title, content, onDismiss, options = {}) {
    const shell = el("div", "detail-shell");
    const audioCard = options.showAudioContinuity === true && hasAudio(options.audioCard) ? options.audioCard : null;
    const fullBleed = Boolean(options.fullBleed);
    const header = lightHeader(title, { onBack: onDismiss, detail: true });
    const body = el("div", "detail-content");
    const bodyInner = el("div", "detail-content-inner");
    if (fullBleed) {
      shell.classList.add("is-full-bleed");
      body.classList.add("is-full-bleed");
      bodyInner.classList.add("is-full-bleed");
      content.classList.add("is-full-bleed");
    }
    bodyInner.append(content);
    body.append(bodyInner);
    shell.append(header);
    if (audioCard) {
      shell.append(detailAudioContinuity(audioCard));
    }
    shell.append(body);
    panel.replaceChildren(shell);
    panel.setAttribute("aria-hidden", "false");
    panel.classList.add("is-open");
    renderVoiceStatus();
    installHorizontalDismiss(shell, panel, onDismiss);
  }

  function dismissDetail() {
    const panel = document.getElementById("detail");
    state.navDetail = null;
    persistNavState();
    panel.style.transform = "";
    panel.classList.remove("is-open", "is-dragging");
    panel.setAttribute("aria-hidden", "true");
    clearDetailDataAttributes(panel);
    panel.replaceChildren();
    void syncVoiceThreadScope({ reason: "detail_dismiss", render: true, force: true });
  }

  function handleAndroidBack() {
    if (dismissOpenCardMenu()) {
      return true;
    }
    const settingsSelectorOverlay = document.getElementById("settingsSelectorOverlay");
    if (settingsSelectorOverlay && settingsSelectorOverlay.classList.contains("is-open")) {
      closeSettingsSelector();
      return true;
    }
    const settingsSheet = document.getElementById("settingsSheet");
    if (settingsSheet && settingsSheet.classList.contains("is-open")) {
      dismissAdvancedSettingsSheet();
      return true;
    }
    const detail = document.getElementById("detail");
    if (detail && detail.classList.contains("is-open")) {
      const back = detail.querySelector(".light-back-button, .detail-back");
      if (back) {
        back.click();
        if (detail.classList.contains("is-open")) {
          dismissDetail();
        }
      } else {
        dismissDetail();
      }
      return true;
    }
    const traceSheet = document.getElementById("traceSheet");
    if (traceSheet && traceSheet.classList.contains("is-open")) {
      dismissTraceSheet();
      return true;
    }
    const metaSheet = document.getElementById("metaSheet");
    if (metaSheet && metaSheet.classList.contains("is-open")) {
      dismissOriginSheet();
      return true;
    }
    const overlay = document.getElementById("speedOverlay");
    if (overlay && overlay.classList.contains("is-open")) {
      closeSpeedPicker();
      return true;
    }
    if (isHomeShellRoute() && lightBack()) {
      return true;
    }
    return false;
  }

  function resolveAudioControlsTargetCard(card) {
    const active = findCardByPlayer(state.player);
    if (active) {
      return active;
    }
    const sessionId = cardSessionId(card);
    if (sessionId) {
      const bySession = findCardBySessionId(sessionId);
      if (bySession) {
        return bySession;
      }
    }
    const threadId = cardThreadId(card);
    if (threadId) {
      const byThread = findCardByThreadId(threadId);
      if (byThread) {
        return byThread;
      }
    }
    return findCardByIdentity(card) || card;
  }

  function showAudioDetail(card, options = {}) {
    const targetCard = resolveAudioControlsTargetCard(card);
    state.audioCard = targetCard;
    const panel = document.getElementById("detail");
    const content = audioDetailContent(targetCard);
    applyDetailDataAttributes(panel, "audio", targetCard, { viewer: "audio_player" });
    openSideDetail(panel, targetCard.title || "Audio", content, dismissAudioDetail);
    rememberNavDetail("audio", targetCard, options);
    installDetailScrollPersistence(content, "audio");
    void syncVoiceThreadScope({ reason: "show_audio_detail", render: true });
    restoreScrollPosition(content, options.scrollTop);
    restoreTimestampScroll(content, options.timestampScrollTop);
  }

  function showMeetingFailedDetail(meeting, options = {}) {
    state.audioCard = null;
    const panel = document.getElementById("detail");
    const detailCard = meetingCardFromRecord(meeting);
    const content = meetingFailedDetailContent(meeting);
    applyDetailDataAttributes(panel, "meeting_failed", detailCard, { viewer: "meeting_failed" });
    openSideDetail(panel, meetingTitle(meeting), content, dismissDetail);
    rememberNavDetail("meeting_failed", detailCard, options);
    installDetailScrollPersistence(content, "meeting_failed");
    restoreScrollPosition(content, options.scrollTop);
    void syncVoiceThreadScope({ reason: "show_meeting_failed_detail", render: true });
  }

  function renderAudioDetail() {
    const card = state.audioCard;
    if (!card) {
      return;
    }
    const panel = document.getElementById("detail");
    if (!panel || !panel.classList.contains("is-open")) {
      state.audioCard = null;
      return;
    }
    const existing = panel.querySelector(".audio-detail");
    if (!existing) {
      return;
    }
    if (state.scrubbingAudioKey === audioStateKey(card)) {
      return;
    }
    if (existing.dataset.audioKey === audioStateKey(card)) {
      refreshAudioDetail(card, existing);
      return;
    }
    const chapterScroll = existing.querySelector(".timestamp-list")?.scrollTop || 0;
    const next = audioDetailContent(card);
    existing.replaceWith(next);
    installDetailScrollPersistence(next, "audio");
    const nextList = next.querySelector(".timestamp-list");
    if (nextList) {
      nextList.scrollTop = chapterScroll;
    }
  }

  function currentDetailAudioCard() {
    const detail = normalizeNavDetail(state.navDetail);
    if (!detail || detail.type === "audio") {
      return null;
    }
    const card = resolveNavDetailCard(detail);
    return card && hasAudio(card) ? card : null;
  }

  function detailAudioContinuity(card) {
    const section = el("section", "detail-audio-continuity");
    const inner = el("div", "detail-audio-continuity-inner");
    section.style.setProperty("--accent", card.accent || "#72c2ff");
    section.dataset.audioKey = audioStateKey(card);
    const copy = el("div", "detail-audio-continuity-copy");
    copy.append(el("div", "detail-audio-continuity-kicker", "Audio playback"));
    copy.append(el("div", "detail-audio-continuity-title", card.title || "Audio"));
    copy.append(audioTileStatus(card));
    const actions = el("div", "detail-audio-continuity-actions");
    const toggle = el("button", "detail-audio-action detail-audio-action-primary", isPlayingCard(card) ? "Pause" : "Play");
    toggle.type = "button";
    toggle.disabled = isCardAudioBusy(card) || ["starting", "pause_pending"].includes(currentTileAudioPhase(card));
    toggle.addEventListener("click", () => {
      void toggleAudio(card);
    });
    const open = el("button", "detail-audio-action", "Open audio controls");
    open.type = "button";
    open.addEventListener("click", () => {
      showAudioDetail(resolveAudioControlsTargetCard(card));
    });
    actions.append(toggle, open);
    inner.append(copy, actions);
    section.append(inner);
    return section;
  }

  function renderDetailAudioContinuity() {
    const panel = document.getElementById("detail");
    if (!panel || !panel.classList.contains("is-open")) {
      return;
    }
    const existing = panel.querySelector(".detail-audio-continuity");
    if (!existing) {
      return;
    }
    const card = currentDetailAudioCard();
    if (!card) {
      existing.remove();
      return;
    }
    existing.replaceWith(detailAudioContinuity(card));
  }

  function meetingFailedDetailContent(meeting) {
    const content = el("div", "detail-content meeting-failed-detail");
    const body = el("section", "meeting-failed-body");
    body.append(
      el("p", "meeting-failed-kicker", "Meeting failed"),
      el("p", "meeting-failed-summary", meetingFailedSummary(meeting))
    );
    const meta = el("div", "meeting-failed-meta");
    const duration = formatMeetingDuration(safeNumber(meeting && meeting.duration_ms));
    if (duration) {
      meta.append(el("span", "meeting-failed-chip", duration));
    }
    const stage = String(meeting && meeting.failure_stage || "").trim();
    if (stage) {
      meta.append(el("span", "meeting-failed-chip", stage.replaceAll("_", " ")));
    }
    const meetingId = String(meeting && meeting.meeting_id || "").trim();
    if (meetingId) {
      meta.append(el("span", "meeting-failed-chip", meetingId));
    }
    if (meta.childNodes.length) {
      body.append(meta);
    }
    const transcriptError = String(meeting && meeting.transcript_error || "").trim();
    if (transcriptError && transcriptError !== meetingFailedSummary(meeting)) {
      body.append(el("p", "meeting-failed-error", transcriptError));
    }
    content.append(body);
    return content;
  }

  function audioDetailContent(card) {
    const content = el("div", "detail-content audio-detail");
    content.dataset.audioKey = audioStateKey(card);
    if (card?.is_meeting_recording) {
      content.classList.add("meeting-audio-detail");
    }
    content.style.setProperty("--accent", card.accent || "#72c2ff");
    const player = el("section", "audio-player");
    if (card.summary && audioTimestamps(card).length === 0) {
      player.append(el("p", "audio-summary", card.summary));
    }
    player.append(audioScrubber(card));
    player.append(audioControls(card));
    content.append(player);
    const timestamps = timestampListView(card);
    if (timestamps) {
      content.append(timestamps);
    }
    if (card?.is_meeting_recording) {
      content.append(meetingTranscriptAction(card));
    }
    return content;
  }

  function meetingTranscriptAction(card) {
    const action = el("section", "meeting-transcript-action");
    const label = meetingTranscriptLabel(card.meeting_record || card);
    const button = el("button", "meeting-view-transcript", label);
    button.type = "button";
    button.addEventListener("click", () => showMeetingTranscriptDetail(card));
    action.append(button);
    return action;
  }

  function meetingTranscriptLabel(meeting) {
    return "View Transcript";
  }

  function showMeetingTranscriptDetail(card) {
    const meeting = card.meeting_record || card;
    showTranscript(meetingCardFromRecord(meeting));
  }

  function meetingTranscriptSection(meeting) {
    const section = el("section", "meeting-transcript-section");
    section.append(el("h3", "meeting-transcript-title", meetingTranscriptLabel(meeting)));
    const transcript = meetingTranscriptText(meeting);
    const parsedTurns = parseMeetingTranscriptLines(transcript);
    const speakerTurns = parsedTurns.length ? parsedTurns : Array.isArray(meeting?.speaker_turns) ? meeting.speaker_turns : [];
    if (speakerTurns.length) {
      const list = el("div", "meeting-speaker-turns");
      speakerTurns.forEach(turn => {
        const row = el("article", "meeting-speaker-turn");
        row.append(
          el("div", "meeting-speaker-label", meetingSpeakerDisplayLabel(turn)),
          el("p", "meeting-speaker-text", String(turn?.text || ""))
        );
        list.append(row);
      });
      section.append(list);
      return section;
    }
    if (transcript) {
      section.append(el("pre", "meeting-transcript-text", transcript));
      if (String(meeting?.diarization_status || "") === "no_speaker_turns" || String(meeting?.diarization_status || "") === "plain_transcript" || String(meeting?.diarization_status || "") === "no_transcript") {
        section.append(el("p", "meeting-transcript-note", "No speaker-separated transcript was returned for this recording."));
      }
      return section;
    }
    const state = meetingState(meeting);
    if (state === "processing") {
      section.append(el("p", "meeting-transcript-note", "Processing transcript and diarization..."));
    } else if (state === "failed" || meeting?.transcript_error) {
      section.append(el("p", "meeting-transcript-note is-error", String(meeting?.transcript_error || meeting?.failure_reason || "Transcript failed.")));
    } else {
      section.append(el("p", "meeting-transcript-note", "No transcript is available yet."));
    }
    return section;
  }

  function parseMeetingTranscriptLines(transcript) {
    return String(transcript || "")
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(Boolean)
      .map(line => {
        const match = line.match(/^(?:\[(?<stamp>[^\]]+)\]\s*)?(?<speaker>[^:]{1,80}):\s*(?<text>.+)$/);
        if (!match) {
          return null;
        }
        return {
          speaker: String(match.groups?.speaker || "").trim(),
          label: String(match.groups?.speaker || "").trim(),
          text: String(match.groups?.text || "").trim(),
          stamp: String(match.groups?.stamp || "").trim()
        };
      })
      .filter(Boolean);
  }

  function meetingSpeakerDisplayLabel(turn) {
    const speaker = String(turn?.speaker || "speaker").replaceAll("_", " ");
    const start = Number(turn?.start);
    if (Number.isFinite(start)) {
      return `${speaker} - ${formatSeconds(start)}`;
    }
    const stamp = String(turn?.stamp || "").trim();
    return stamp ? `${speaker} - ${stamp}` : speaker;
  }

  function meetingSpeakerLabel(turn) {
    const speaker = String(turn?.speaker || "speaker").replaceAll("_", " ");
    const start = Number(turn?.start);
    return Number.isFinite(start) ? `${speaker} · ${formatSeconds(start)}` : speaker;
  }

  function formatSeconds(seconds) {
    const total = Math.max(0, Math.round(Number(seconds || 0)));
    const minutes = Math.floor(total / 60);
    const remainder = total % 60;
    return `${minutes}:${String(remainder).padStart(2, "0")}`;
  }

  function refreshAudioDetail(card, existing) {
    const scrub = existing.querySelector(".audio-scrub");
    if (scrub) {
      updateAudioScrubPreview(card, scrub, playbackPositionForCard(card));
    }
    const controls = existing.querySelector(".audio-controls");
    if (controls) {
      controls.replaceWith(audioControls(card));
    }
  }

  function audioScrubber(card) {
    const scrub = el("div", "scrub audio-scrub");
    const duration = audioDurationForCard(card);
    const position = clampAudioPosition(playbackPositionForCard(card), duration);
    const slider = el("div", "scrub-slider");
    slider.tabIndex = 0;
    slider.setAttribute("role", "slider");
    slider.setAttribute("aria-label", "Audio position");
    slider.dataset.dragIgnore = "true";
    slider.append(el("span", "scrub-track"));
    appendScrubChapterTicks(slider, card, duration);
    slider.append(
      el("span", "scrub-chapter-range"),
      el("span", "scrub-fill"),
      el("span", "scrub-chapter-marker"),
      el("span", "scrub-knob")
    );
    updateScrubSlider(slider, position, duration);
    updateScrubChapterPreview(card, slider, position, duration);
    let commitPending = false;
    const commit = (positionMs) => {
      if (commitPending) {
        return;
      }
      commitPending = true;
      commitAudioScrub(card, positionMs).finally(() => {
        commitPending = false;
      });
    };
    const previewFromPointer = (event) => {
      const next = scrubPositionFromPointer(slider, event, duration);
      previewAudioScrub(card, scrub, next);
      return next;
    };
    const stopScrubEvent = (event) => {
      event.preventDefault();
      event.stopPropagation();
    };
    slider.addEventListener("pointerdown", (event) => {
      stopScrubEvent(event);
      slider.focus();
      if (event.pointerId !== undefined) {
        slider.setPointerCapture?.(event.pointerId);
      }
      startAudioScrub(card, Number(slider.dataset.positionMs || 0));
      previewFromPointer(event);
    });
    slider.addEventListener("pointermove", (event) => {
      if (state.scrubbingAudioKey !== audioStateKey(card)) {
        return;
      }
      stopScrubEvent(event);
      previewFromPointer(event);
    });
    slider.addEventListener("pointerup", (event) => {
      if (state.scrubbingAudioKey !== audioStateKey(card)) {
        return;
      }
      stopScrubEvent(event);
      const next = previewFromPointer(event);
      if (event.pointerId !== undefined) {
        slider.releasePointerCapture?.(event.pointerId);
      }
      commit(next);
    });
    slider.addEventListener("pointercancel", (event) => {
      event.stopPropagation();
      if (event.pointerId !== undefined) {
        slider.releasePointerCapture?.(event.pointerId);
      }
      stopAudioScrub(card);
    });
    slider.addEventListener("touchstart", (event) => {
      const touch = event.touches[0];
      if (!touch) {
        return;
      }
      stopScrubEvent(event);
      slider.focus();
      startAudioScrub(card, Number(slider.dataset.positionMs || 0));
      previewAudioScrub(card, scrub, scrubPositionFromClientX(slider, touch.clientX, duration));
    }, { passive: false });
    slider.addEventListener("touchmove", (event) => {
      const touch = event.touches[0];
      if (!touch || state.scrubbingAudioKey !== audioStateKey(card)) {
        return;
      }
      stopScrubEvent(event);
      previewAudioScrub(card, scrub, scrubPositionFromClientX(slider, touch.clientX, duration));
    }, { passive: false });
    slider.addEventListener("touchend", (event) => {
      if (state.scrubbingAudioKey !== audioStateKey(card)) {
        return;
      }
      stopScrubEvent(event);
      const touch = event.changedTouches[0];
      const next = touch
        ? scrubPositionFromClientX(slider, touch.clientX, duration)
        : Number(slider.dataset.positionMs || 0);
      commit(next);
    });
    slider.addEventListener("touchcancel", (event) => {
      event.stopPropagation();
      stopAudioScrub(card);
    });
    slider.addEventListener("keydown", (event) => {
      const current = Number(slider.dataset.positionMs || 0);
      const smallStep = 15000;
      const largeStep = 60000;
      let next = current;
      if (event.key === "ArrowLeft") next = current - smallStep;
      else if (event.key === "ArrowRight") next = current + smallStep;
      else if (event.key === "PageDown") next = current - largeStep;
      else if (event.key === "PageUp") next = current + largeStep;
      else if (event.key === "Home") next = 0;
      else if (event.key === "End") next = duration;
      else return;
      event.preventDefault();
      const positionMs = clampAudioPosition(next, duration);
      previewAudioScrub(card, scrub, positionMs);
      commit(positionMs);
    });
    scrub.append(slider);
    const timeRow = el("div", "time-row");
    timeRow.append(
      el("span", "time-elapsed", formatTime(position)),
      el("span", "time-remaining", `-${formatTime(Math.max(0, duration - position))}`)
    );
    scrub.append(timeRow);
    return scrub;
  }

  function previewAudioScrub(card, scrub, rawPosition) {
    const duration = audioDurationForCard(card);
    const positionMs = clampAudioPosition(rawPosition, duration);
    startAudioScrub(card, positionMs);
    state.activePath = audioControlKey(card);
    if (isActiveCard(card)) {
      state.player = stampPlayerState({ ...state.player, position_ms: positionMs });
    }
    updateAudioScrubPreview(card, scrub, positionMs);
  }

  async function commitAudioScrub(card, rawPosition) {
    const duration = audioDurationForCard(card);
    const positionMs = clampAudioPosition(rawPosition, duration);
    const marker = currentTimestamp(card, positionMs);
    if (marker) {
      rememberSelectedTimestamp(card, marker);
    }
    try {
      state.activePath = audioControlKey(card);
      const current = await Pucky.request({ command: "player.state", args: {} });
      rememberPlayerProgress(current);
      const same = isSameAudioCard(current, card);
      if (!same && hasNativeAudioBridge() && card.audio_playlist_path) {
        await Pucky.request({
          command: "player.queue.set",
          args: { playlist_path: card.audio_playlist_path, title: card.title, load: true }
        });
      } else if (!same && (card.audio_path || card.audio_url)) {
        const audioPath = await prepareAudioForPlayback(card);
        await Pucky.request({
          command: "player.play",
          args: { path: audioPath, source: audioControlKey(card) || audioPath, title: card.title, start_at_ms: positionMs, speed: resolvedStartSpeedForCard(card) }
        });
      }
      state.player = stampPlayerState(await Pucky.request({ command: "player.seek", args: { position_ms: positionMs } }));
      rememberPlayerProgress(state.player);
      stopAudioScrub(card);
      render();
    } catch (error) {
      showToast(error.message);
      stopAudioScrub(card);
      renderAudioDetail();
    }
  }

  function updateAudioScrubPreview(card, scrub, positionMs) {
    const duration = audioDurationForCard(card);
    const slider = scrub.querySelector(".scrub-slider");
    if (slider) {
      updateScrubSlider(slider, positionMs, duration);
      updateScrubChapterPreview(card, slider, positionMs, duration);
    }
    const elapsed = scrub.querySelector(".time-elapsed");
    if (elapsed) {
      elapsed.textContent = formatTime(positionMs);
    }
    const remaining = scrub.querySelector(".time-remaining");
    if (remaining) {
      remaining.textContent = `-${formatTime(Math.max(0, duration - positionMs))}`;
    }
    updateTimestampPreview(card, positionMs);
  }

  function scrubPositionFromPointer(slider, event, durationMs) {
    return scrubPositionFromClientX(slider, event.clientX, durationMs);
  }

  function scrubPositionFromClientX(slider, clientX, durationMs) {
    const rect = slider.getBoundingClientRect();
    const width = Math.max(1, rect.width);
    const ratio = Math.max(0, Math.min(1, (Number(clientX || 0) - rect.left) / width));
    return clampAudioPosition(ratio * durationMs, durationMs);
  }

  function updateScrubSlider(slider, positionMs, durationMs) {
    const duration = Math.max(0, Number(durationMs || 0));
    const position = clampAudioPosition(positionMs, duration);
    const ratio = duration > 0 ? position / duration : 0;
    slider.dataset.positionMs = String(Math.round(position));
    slider.style.setProperty("--progress", String(ratio));
    slider.setAttribute("aria-valuemin", "0");
    slider.setAttribute("aria-valuemax", String(Math.round(duration)));
    slider.setAttribute("aria-valuenow", String(Math.round(position)));
    slider.setAttribute("aria-valuetext", `${formatTime(position)} of ${formatTime(duration)}`);
  }

  function appendScrubChapterTicks(slider, card, durationMs) {
    const duration = Math.max(0, Number(durationMs || 0));
    if (duration <= 0) {
      return;
    }
    audioTimestamps(card).forEach(marker => {
      const tick = el("span", "scrub-chapter-tick");
      const ratio = clampAudioPosition(marker.start_ms, duration) / duration;
      tick.style.setProperty("--tick", String(ratio));
      tick.setAttribute("aria-hidden", "true");
      tick.title = marker.title;
      slider.append(tick);
    });
  }

  function updateScrubChapterPreview(card, slider, positionMs, durationMs) {
    const duration = Math.max(0, Number(durationMs || 0));
    const scrubbing = state.scrubbingAudioKey === audioStateKey(card);
    const marker = scrubbing ? currentTimestamp(card, positionMs) : selectedTimestamp(card);
    if (!marker || duration <= 0) {
      slider.classList.remove("has-chapter-preview", "is-scrub-previewing");
      return;
    }
    const previewPosition = scrubbing ? positionMs : marker.start_ms;
    const previewRatio = clampAudioPosition(previewPosition, duration) / duration;
    const rangeStart = clampAudioPosition(marker.start_ms, duration) / duration;
    const rangeEnd = marker.end_ms === null
      ? rangeStart
      : clampAudioPosition(marker.end_ms, duration) / duration;
    slider.classList.add("has-chapter-preview");
    slider.classList.toggle("is-scrub-previewing", scrubbing);
    slider.style.setProperty("--chapter-preview", String(previewRatio));
    slider.style.setProperty("--chapter-range-start", String(rangeStart));
    slider.style.setProperty("--chapter-range-width", String(Math.max(0, rangeEnd - rangeStart)));
  }

  function updateTimestampPreview(card, positionMs) {
    const current = currentTimestamp(card, positionMs);
    const activeId = current?.id || "";
    const selectedId = selectedTimestampFor(card);
    document.querySelectorAll(".timestamp-row[data-timestamp-id]").forEach(row => {
      const active = Boolean(activeId && row.dataset.timestampId === activeId);
      const selected = Boolean(selectedId && row.dataset.timestampId === selectedId);
      row.classList.toggle("is-active", active);
      row.classList.toggle("is-selected", selected);
      row.setAttribute("aria-pressed", selected ? "true" : "false");
      const play = row.querySelector(".timestamp-play");
      if (play) {
        play.tabIndex = selected ? 0 : -1;
        play.setAttribute("aria-hidden", selected ? "false" : "true");
      }
    });
  }

  function audioControls(card) {
    const controls = el("div", "audio-controls");
    const speed = activePlayerMatchesCard(card) ? (state.player.speed || resolvedStartSpeedForCard(card)) : resolvedStartSpeedForCard(card);
    controls.append(control(formatSpeed(speed), () => openSpeedPicker({ kind: "card", card }), "control-speed", "Playback speed"));
    const cluster = el("div", "transport-cluster");
    cluster.append(iconControl("replay_15", "Back 15 seconds", () => seekRelative(-15000), "control-skip"));
    cluster.append(iconControl(state.player.is_playing && activePlayerMatchesCard(card) ? "pause" : "play_arrow", state.player.is_playing && activePlayerMatchesCard(card) ? "Pause" : "Play", () => toggleAudio(card), "control-play"));
    cluster.append(iconControl("forward_30", "Forward 30 seconds", () => seekRelative(30000), "control-skip"));
    controls.append(cluster, el("span", "control-spacer"));
    return controls;
  }

  function timestampListView(card) {
    const markers = audioTimestamps(card);
    if (!markers.length) {
      return null;
    }
    const section = el("section", "timestamp-list");
    section.setAttribute("aria-label", "Audio chapters");
    section.append(el("h2", "timestamp-list-header", "Chapters"));
    const current = currentTimestamp(card, playbackPositionForCard(card));
    const activeId = current?.id || "";
    const selectedId = selectedTimestampFor(card);
    markers.forEach(marker => {
      const rowClasses = ["timestamp-row"];
      if (marker.id === activeId) rowClasses.push("is-active");
      if (marker.id === selectedId) rowClasses.push("is-selected");
      const row = el("div", rowClasses.join(" "));
      row.tabIndex = 0;
      row.setAttribute("role", "button");
      row.dataset.timestampId = marker.id;
      row.setAttribute("aria-pressed", marker.id === selectedId ? "true" : "false");
      row.setAttribute("aria-label", `Select ${marker.title}. Double tap or use the row play button to play from ${formatTime(marker.start_ms)}.`);
      row.addEventListener("click", (event) => handleTimestampRowClick(card, marker, event));
      row.addEventListener("keydown", (event) => handleTimestampRowKeydown(card, marker, event));
      row.append(el("span", "timestamp-time", formatTime(marker.start_ms)));
      const copy = el("span", "timestamp-copy");
      copy.append(el("span", "timestamp-title", marker.title));
      if (marker.detail) {
        copy.append(el("span", "timestamp-detail", marker.detail));
      }
      row.append(copy);
      const play = iconControl("play_arrow", `Play ${marker.title} from ${formatTime(marker.start_ms)}`, (event) => {
        event.stopPropagation();
        commitTimestamp(card, marker);
      }, "timestamp-play");
      play.tabIndex = marker.id === selectedId ? 0 : -1;
      play.setAttribute("aria-hidden", marker.id === selectedId ? "false" : "true");
      row.append(play);
      section.append(row);
    });
    return section;
  }

  function handleTimestampRowClick(card, marker, event) {
    event.preventDefault();
    event.stopPropagation();
    const key = `${audioStateKey(card)}:${marker.id}`;
    const now = Date.now();
    const previous = state.timestampTap;
    const isDoubleTap = (event.detail > 1) || (previous && previous.key === key && now - previous.at < 420);
    state.timestampTap = isDoubleTap ? null : { key, at: now };
    if (isDoubleTap) {
      commitTimestamp(card, marker);
      return;
    }
    previewTimestamp(card, marker);
  }

  function handleTimestampRowKeydown(card, marker, event) {
    if (event.key !== "Enter" && event.key !== " ") {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    previewTimestamp(card, marker);
  }

  function previewTimestamp(card, marker) {
    rememberSelectedTimestamp(card, marker);
    const panel = document.getElementById("detail");
    const scrub = panel?.querySelector(".audio-scrub");
    if (scrub) {
      updateAudioScrubPreview(card, scrub, playbackPositionForCard(card));
    }
    updateTimestampPreview(card, playbackPositionForCard(card));
  }

  async function commitTimestamp(card, marker) {
    try {
      const positionMs = Math.max(0, Number(marker.start_ms || 0));
      rememberSelectedTimestamp(card, marker);
      markCardRead(card);
      const current = await Pucky.request({ command: "player.state", args: {} });
      rememberPlayerProgress(current);
      const same = isSameAudioCard(current, card);
      state.activePath = audioControlKey(card);
      if (!same && hasNativeAudioBridge() && card.audio_playlist_path) {
        await Pucky.request({
          command: "player.queue.set",
          args: { playlist_path: card.audio_playlist_path, title: card.title, load: true }
        });
      } else if (!same && (card.audio_path || card.audio_url)) {
        const audioPath = await prepareAudioForPlayback(card);
        await Pucky.request({
          command: "player.play",
          args: { path: audioPath, source: audioControlKey(card) || audioPath, title: card.title, start_at_ms: positionMs }
        });
      }
      state.player = stampPlayerState(await Pucky.request({ command: "player.seek", args: { position_ms: positionMs } }));
      if (!state.player.is_playing) {
        state.player = stampPlayerState(await Pucky.request({
          command: "player.play",
          args: { start_at_ms: positionMs, speed: resolvedStartSpeedForCard(card) }
        }));
      }
      rememberPlayerProgress(state.player);
      render();
    } catch (error) {
      showToast(error.message);
    }
  }

  async function jumpToTimestamp(card, marker) {
    return commitTimestamp(card, marker);
  }

  function dismissAudioDetail() {
    state.audioCard = null;
    dismissDetail();
  }

  function waveform(card, className, count) {
    const key = audioControlKey(card);
    if (!state.waveHistory.has(key)) {
      state.waveHistory.set(key, Array.from({ length: count }, () => 0));
    }
    const levels = state.waveHistory.get(key);
    if (isActiveCard(card) && state.player.is_playing) {
      levels.shift();
      const t = Date.now() / 160;
      const burst = Math.max(0, Math.sin(t) * 0.72 + Math.sin(t * 0.37) * 0.35);
      levels.push(Math.min(1, Math.max(0, burst)));
    }
    const row = el("div", className);
    row.addEventListener("click", (event) => {
      event.stopPropagation();
      if (hasAudio(card)) {
        showAudioDetail(card);
      }
    });
    for (const level of levels.slice(-count)) {
      const tick = el("i", "tick");
      tick.style.setProperty("--level", String(level));
      row.append(tick);
    }
    return row;
  }

  function openSpeedPicker(context) {
    const isSetting = context && context.kind === "setting";
    const card = context && context.kind === "card" ? context.card : context;
    const current = isSetting
      ? clampSpeed(state.defaultAudioSpeed)
      : clampSpeed(state.player.speed || resolvedStartSpeedForCard(card));
    const menu = el("div", "speed-menu");
    menu.append(el("div", "speed-picker-title", isSetting ? "Default playback speed" : "Playback speed"));
    for (const speed of SPEED_OPTIONS) {
      const active = Math.abs(speed - current) < 0.001;
      const button = el("button", active ? "is-active" : "", formatSpeed(speed));
      button.setAttribute("data-speed-value", String(speed));
      button.addEventListener("click", async (event) => {
        event.stopPropagation();
        if (isSetting) {
          const result = await Pucky.request({ command: "ui.default_audio_speed.set", args: { speed } });
          invalidateBridgeReadCache("ui.default_audio_speed.get");
          state.defaultAudioSpeed = clampSpeed(result && result.speed);
          state.defaultAudioSpeedAvailable = true;
        } else {
          rememberSpeed(card, speed);
          state.player = stampPlayerState(await Pucky.request({ command: "player.speed", args: { speed } }));
        }
        closeSpeedPicker();
        render();
      });
      menu.append(button);
    }
    openOverlay("speedOverlay", menu, closeSpeedPicker);
  }

  function closeSpeedPicker() {
    closeOverlay("speedOverlay");
  }

  async function seekRelative(delta) {
    const next = Math.max(0, Math.min(state.player.duration_ms || 0, (state.player.position_ms || 0) + delta));
    state.player = stampPlayerState(await Pucky.request({ command: "player.seek", args: { position_ms: next } }));
    rememberPlayerProgress(state.player);
    render();
  }

  async function pauseWithRewind(card) {
    const paused = await Pucky.request({ command: "player.pause", args: {} });
    const rewindTo = Math.max(0, Number(paused.position_ms || 0) - 1000);
    const rewound = await Pucky.request({ command: "player.seek", args: { position_ms: rewindTo } });
    rememberPlayerProgress(rewound);
    state.activePath = audioControlKey(card);
    return rewound;
  }

  function control(label, action, extraClass = "", ariaLabel = label) {
    const button = el("button", `control ${extraClass}`.trim(), label);
    button.type = "button";
    button.setAttribute("aria-label", ariaLabel);
    button.addEventListener("click", action);
    return button;
  }

  function iconControl(icon, label, action, extraClass = "") {
    const button = control("", action, extraClass, label);
    button.innerHTML = iconSvg(icon, { filled: true });
    return button;
  }

  function shouldSuppressCardActivation() {
    return Date.now() < Number(state.cardMenuClickSuppressUntil || 0);
  }

  function dismissOpenCardMenu(suppressClick = true) {
    if (!state.openCardMenuSessionId) {
      return false;
    }
    state.openCardMenuSessionId = "";
    state.openCardMenuThreadId = "";
    if (suppressClick) {
      state.cardMenuClickSuppressUntil = Date.now() + CARD_MENU_CLICK_SUPPRESS_MS;
    }
    renderFeed();
    void syncVoiceThreadScope({ reason: "card_menu_dismiss", render: true, force: true });
    return true;
  }

  async function archiveHomeCard(card) {
    dismissOpenCardMenu(false);
    await syncFeedCards({ reason: "pre_archive", silent: true, render: false, authoritative: true });
    const freshCard = findCardByIdentity(card) || card;
    return requestFeedAction(freshCard, "archive");
  }

  async function archiveMeetingRecord(meeting) {
    const meetingId = String(meeting && meeting.meeting_id || "").trim();
    if (!meetingId) {
      return null;
    }
    const result = await linksApiRequest("/api/meetings/actions", {
      method: "POST",
      body: {
        client_action_id: `meeting_archive_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
        meeting_id: meetingId,
        action: "archive"
      }
    });
    const archivedId = String(result?.meeting?.meeting_id || meetingId);
    state.meetings.records = state.meetings.records.map(item =>
      String(item && item.meeting_id || "") === archivedId ? { ...item, archived: true } : item
    );
    return result;
  }

  function applyOptimisticMeetingArchive(meeting) {
    const previousMeetings = state.meetings.records.slice();
    const meetingId = String(meeting && meeting.meeting_id || "").trim();
    state.meetings.records = state.meetings.records.map(item =>
      meetingId && String(item && item.meeting_id || "") === meetingId ? { ...item, archived: true } : item
    ).filter(record => !Boolean(record && record.archived));
    render();
    return () => {
      state.meetings.records = previousMeetings;
      render();
    };
  }

  function applyOptimisticHomeArchive(card) {
    const previousCards = state.cards.slice();
    const target = findCardByIdentity(card) || card;
    const targetCardId = String(target && target.card_id || "");
    const targetSessionId = cardSessionId(target);
    state.cards = state.cards.map(item => {
      const sameCardId = targetCardId && String(item && item.card_id || "") === targetCardId;
      const sameSession = targetSessionId && cardSessionId(item) === targetSessionId;
      return sameCardId || sameSession ? { ...item, archived: true } : item;
    });
    reconcileFocusedCardSelection();
    reconcileReadOverrides();
    clearMissingFeedIconFilter();
    render();
    return () => {
      state.cards = previousCards;
      reconcileFocusedCardSelection();
      reconcileReadOverrides();
      clearMissingFeedIconFilter();
      render();
    };
  }

  async function performHomeArchive(card) {
    const rollback = applyOptimisticHomeArchive(card);
    const result = await archiveHomeCard(card);
    if (result === null || result && result.ok === false) {
      rollback();
      return null;
    }
    return result;
  }

  async function performMeetingArchive(meeting) {
    const rollback = applyOptimisticMeetingArchive(meeting);
    try {
      const result = await archiveMeetingRecord(meeting);
      if (result === null || result && result.ok === false) {
        rollback();
        return null;
      }
      return result;
    } catch (error) {
      rollback();
      throw error;
    }
  }

  function canArchiveHomeCard(card) {
    if (Boolean(card?.archived)) {
      return false;
    }
    if (Boolean(card?.synthetic_pending)) {
      return false;
    }
    if (!cardSessionId(card) && !String(card?.card_id || "").trim()) {
      return false;
    }
    if (!isPendingOutboundCard(card)) {
      return true;
    }
    return isFailedPendingOutboundCard(card);
  }

  function canRevealHomeArchive(card) {
    if (!usesHomeFeedRoute() || state.showArchivedFeed) {
      return false;
    }
    return canArchiveHomeCard(card);
  }

  function canRevealMeetingArchive(meeting) {
    return state.route === "meetings"
      && !state.meetings.loading
      && !Boolean(meeting?.archived)
      && Boolean(String(meeting?.meeting_id || "").trim());
  }

  function dismissArchiveReveal(options = {}) {
    if (!activeArchiveReveal) {
      return false;
    }
    const { wrapper, actionButton } = activeArchiveReveal;
    const source = String(options.source || activeArchiveReveal.source || "").trim();
    const gestureId = String(options.gesture_id || activeArchiveReveal.gestureId || "").trim();
    const itemId = String(options.item_id || activeArchiveReveal.itemId || archiveRevealDebugItemId(null, wrapper)).trim();
    const context = String(options.context || "").trim();
    const closeReason = archiveRevealDebugCloseReason(options.reason);
    activeArchiveReveal = null;
    archiveRevealDebugRecord({
      scope: "archive_reveal",
      phase: "dismiss",
      source,
      gesture_id: gestureId,
      item_id: itemId,
      wrapper,
      horizontal: Boolean(options.horizontal ?? true),
      close_reason: closeReason,
      context
    });
    if (!wrapper || !wrapper.isConnected) {
      return true;
    }
    wrapper.classList.remove(
      "is-archive-reveal-active",
      "is-archive-reveal-open",
      "is-archive-reveal-dragging"
    );
    if (options.immediate) {
      wrapper.classList.add("is-archive-reveal-immediate");
      window.requestAnimationFrame(() => {
        wrapper.classList.remove("is-archive-reveal-immediate");
      });
    }
    wrapper.style.setProperty("--archive-reveal-offset", "0px");
    if (actionButton) {
      actionButton.tabIndex = -1;
    }
    return true;
  }

  function setActiveArchiveReveal(entry) {
    if (activeArchiveReveal && activeArchiveReveal.wrapper !== entry.wrapper) {
      activeArchiveReveal.close({ immediate: false, reason: "unknown", context: "switch_active_reveal" });
    }
    activeArchiveReveal = entry;
  }

  function installArchiveReveal(wrapper, item, config) {
    const revealTrack = wrapper?.querySelector(".card");
    const actionButton = wrapper?.querySelector(".archive-reveal-action");
    if (!revealTrack || !actionButton) {
      return;
    }
    let startX = 0;
    let startY = 0;
    let startOffset = 0;
    let activePointerId = null;
    let active = false;
    let horizontal = false;
    let activeInputSource = "";
    let pointerCaptured = false;
    let busy = false;
    let currentGestureId = "";
    let currentGestureSource = "";
    const itemId = archiveRevealDebugItemId(item, wrapper);
    const preferTouchEvents = prefersTouchInput();

    const currentOffset = () => {
      const raw = wrapper.style.getPropertyValue("--archive-reveal-offset");
      const parsed = parseFloat(raw || "0");
      return Number.isFinite(parsed) ? parsed : 0;
    };

    const record = (phase, extra = {}) => archiveRevealDebugRecord({
      scope: "archive_reveal",
      phase,
      source: extra.source || currentGestureSource || activeInputSource,
      gesture_id: extra.gesture_id || currentGestureId,
      item_id: extra.item_id || itemId,
      wrapper,
      offset: extra.offset ?? currentOffset(),
      horizontal: extra.horizontal ?? horizontal,
      wrapper_class: extra.wrapper_class || wrapper.className,
      close_reason: extra.close_reason,
      context: extra.context
    });

    const applyOffset = offset => {
      const nextOffset = Math.max(0, Math.min(ARCHIVE_REVEAL_WIDTH_PX, Math.round(offset)));
      wrapper.style.setProperty("--archive-reveal-offset", `${nextOffset}px`);
      wrapper.classList.toggle("is-archive-reveal-active", nextOffset > 0);
      const isOpen = nextOffset === ARCHIVE_REVEAL_WIDTH_PX;
      wrapper.classList.toggle("is-archive-reveal-open", isOpen);
      actionButton.tabIndex = isOpen ? 0 : -1;
      return nextOffset;
    };

    const closeReveal = (options = {}) => {
      const closeSource = String(options.source || currentGestureSource || activeInputSource || "").trim();
      const closeGestureId = String(options.gesture_id || currentGestureId || "").trim();
      const closeReason = archiveRevealDebugCloseReason(options.reason);
      const context = String(options.context || "").trim();
      record(options.phase || "close", {
        source: closeSource,
        gesture_id: closeGestureId,
        close_reason: closeReason,
        context
      });
      releasePointerCapture();
      active = false;
      horizontal = false;
      activePointerId = null;
      activeInputSource = "";
      wrapper.classList.remove("is-archive-reveal-dragging");
      if (options.immediate) {
        wrapper.classList.add("is-archive-reveal-immediate");
      }
      applyOffset(0);
      if (options.immediate) {
        window.requestAnimationFrame(() => {
          wrapper.classList.remove("is-archive-reveal-immediate");
        });
      }
      if (activeArchiveReveal && activeArchiveReveal.wrapper === wrapper) {
        activeArchiveReveal = null;
      }
      currentGestureId = "";
      currentGestureSource = "";
    };

    const openReveal = () => {
      wrapper.classList.remove("is-archive-reveal-dragging", "is-archive-reveal-immediate");
      applyOffset(ARCHIVE_REVEAL_WIDTH_PX);
      setActiveArchiveReveal({
        wrapper,
        actionButton,
        close: closeReveal,
        source: currentGestureSource,
        gestureId: currentGestureId,
        itemId
      });
      record("open");
    };

    const capturePointer = pointer => {
      if (pointer === null || !wrapper.setPointerCapture) {
        return;
      }
      try {
        wrapper.setPointerCapture(pointer);
        pointerCaptured = true;
      } catch (_) {
        pointerCaptured = false;
      }
    };

    const releasePointerCapture = () => {
      if (!pointerCaptured || activePointerId === null || !wrapper.releasePointerCapture) {
        pointerCaptured = false;
        return;
      }
      try {
        wrapper.releasePointerCapture(activePointerId);
      } catch (_) {
        // Pointer capture can already be released by WebView on cancel.
      }
      pointerCaptured = false;
    };

    const begin = (x, y, target, pointer = null, source = "") => {
      if (busy || !config.canReveal(item) || isDragIgnoredTarget(target)) {
        return;
      }
      if (active && activeInputSource !== source) {
        return;
      }
      if (active) {
        return;
      }
      if (activeArchiveReveal && activeArchiveReveal.wrapper !== wrapper) {
        activeArchiveReveal.close({ immediate: false });
      }
      startX = x;
      startY = y;
      startOffset = currentOffset();
      activePointerId = pointer;
      currentGestureId = nextArchiveRevealGestureId();
      currentGestureSource = source;
      activeInputSource = source;
      active = true;
      horizontal = false;
      wrapper.classList.remove("is-archive-reveal-immediate");
      record("begin", { source });
    };

    const move = (x, y, source) => {
      if (!active || activeInputSource !== source) {
        return;
      }
      const dx = x - startX;
      const dy = y - startY;
      if (!horizontal && Math.abs(dx) < ARCHIVE_REVEAL_SLOP_PX && Math.abs(dy) < ARCHIVE_REVEAL_SLOP_PX) {
        return;
      }
      if (!horizontal && Math.abs(dy) > Math.abs(dx)) {
        closeReveal({ immediate: true });
        return;
      }
      if (!horizontal && startOffset <= 0 && dx > 0) {
        closeReveal({ immediate: true });
        return;
      }
      horizontal = true;
      if (source === "pointer" && !pointerCaptured) {
        capturePointer(activePointerId);
      }
      wrapper.classList.add("is-archive-reveal-dragging");
      const nextOffset = applyOffset(startOffset - dx);
      record("move", { source, offset: nextOffset });
    };

    const finish = source => {
      if (!active || activeInputSource !== source) {
        return;
      }
      active = false;
      releasePointerCapture();
      activePointerId = null;
      activeInputSource = "";
      wrapper.classList.remove("is-archive-reveal-dragging");
      record("finish", { source });
      if (!horizontal) {
        currentGestureId = "";
        currentGestureSource = "";
        return;
      }
      if (currentOffset() >= ARCHIVE_REVEAL_OPEN_THRESHOLD_PX) {
        openReveal();
        return;
      }
      closeReveal({ immediate: false, source, reason: "threshold_not_met" });
    };

    wrapper.addEventListener("click", event => {
      if (wrapper.classList.contains("is-archive-reveal-open")) {
        const actionTarget = event.target instanceof Element ? event.target.closest(".archive-reveal-action") : null;
        if (!actionTarget) {
          event.preventDefault();
          event.stopPropagation();
          event.stopImmediatePropagation();
          closeReveal({ immediate: false, reason: "click_capture_close", context: "wrapper_click_capture" });
          return;
        }
      }
      if (shouldSuppressCardActivation()) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
      }
    }, true);
    wrapper.addEventListener("pointerdown", event => {
      if (!shouldHandleTouchLikePointerEvent(event, preferTouchEvents)) {
        return;
      }
      begin(event.clientX, event.clientY, event.target, event.pointerId, "pointer");
    });
    wrapper.addEventListener("pointermove", event => {
      if (!shouldHandleTouchLikePointerEvent(event, preferTouchEvents)) {
        return;
      }
      if (activePointerId !== null && event.pointerId !== activePointerId) {
        return;
      }
      move(event.clientX, event.clientY, "pointer");
    });
    wrapper.addEventListener("pointerup", event => {
      if (!shouldHandleTouchLikePointerEvent(event, preferTouchEvents)) {
        return;
      }
      if (activePointerId !== null && event.pointerId !== activePointerId) {
        return;
      }
      finish("pointer");
    });
    wrapper.addEventListener("pointercancel", event => {
      if (!shouldHandleTouchLikePointerEvent(event, preferTouchEvents)) {
        return;
      }
      if (activePointerId !== null && event.pointerId !== activePointerId) {
        return;
      }
      record("cancel", { source: "pointer", close_reason: "pointercancel" });
      finish("pointer");
    });
    wrapper.addEventListener("touchstart", event => {
      if (event.touches.length) {
        begin(event.touches[0].clientX, event.touches[0].clientY, event.target, null, "touch");
      }
    }, { passive: true });
    wrapper.addEventListener("touchmove", event => {
      if (event.touches.length) {
        move(event.touches[0].clientX, event.touches[0].clientY, "touch");
        if (horizontal) {
          event.preventDefault();
        }
      }
    }, { passive: false });
    wrapper.addEventListener("touchend", () => {
      finish("touch");
    });
    wrapper.addEventListener("touchcancel", () => {
      record("cancel", { source: "touch", close_reason: "touchcancel" });
      finish("touch");
    });
    actionButton.addEventListener("click", event => {
      event.preventDefault();
      event.stopPropagation();
      if (busy) {
        record("dismiss", { close_reason: "busy_archive", context: "action_busy" });
        return;
      }
      busy = true;
      activeArchiveReveal = null;
      void config.performArchive(item).catch(error => {
        showToast(error.message);
      }).finally(() => {
        busy = false;
      });
    });
  }

  function installCardMenuOutsideDismiss() {
    document.addEventListener("pointerdown", event => {
      if (!state.openCardMenuSessionId) {
        return;
      }
      const target = event.target instanceof Element ? event.target : null;
      const menu = target?.closest(".card-longpress-menu");
      const menuButton = target?.closest(".inbox-card-menu-button");
      if (menu || menuButton) {
        return;
      }
      dismissOpenCardMenu(true);
    }, true);
  }

  function installArchiveRevealOutsideDismiss() {
    document.addEventListener("pointerdown", event => {
      if (!activeArchiveReveal) {
        return;
      }
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest(".archive-reveal-action")) {
        return;
      }
      if (target && activeArchiveReveal.wrapper.contains(target)) {
        return;
      }
      dismissArchiveReveal({
        immediate: false,
        reason: "outside_dismiss",
        context: "document_pointerdown_outside"
      });
    }, true);
  }

  function installVerticalDismiss(target, panel, onDismiss = dismissTraceSheet) {
    installDrag(target, {
      axis: "y",
      scrollTarget: target,
      start: () => { panel.classList.add("is-dragging"); },
      apply: value => { panel.style.transform = `translateY(${Math.max(0, value)}px)`; },
      reset: () => {
        panel.classList.remove("is-dragging");
        panel.style.transform = "";
      },
      done: () => {
        panel.classList.remove("is-dragging");
        onDismiss();
      }
    });
  }

  function installHorizontalDismiss(target, panel, onDismiss = dismissDetail, hooks = {}) {
    return installDrag(target, {
      axis: "x",
      start: () => { panel.classList.add("is-dragging"); },
      confirm: hooks.confirm,
      apply: value => { panel.style.transform = `translateX(${Math.max(0, value)}px)`; },
      reset: () => {
        panel.classList.remove("is-dragging");
        panel.style.transform = "";
        if (hooks.reset) {
          hooks.reset();
        }
      },
      done: () => {
        panel.classList.remove("is-dragging");
        if (hooks.reset) {
          hooks.reset();
        }
        onDismiss();
      }
    });
  }

  function installDrag(target, config) {
    let startX = 0;
    let startY = 0;
    let active = false;
    let confirmed = false;
    let raf = 0;
    let pendingValue = 0;
    let activePointerId = null;
    let pointerCaptured = false;
    const cleanup = [];
    const threshold = () => (config.axis === "x" ? window.innerWidth : window.innerHeight) * 0.22;
    const applyFrame = () => {
      raf = 0;
      config.apply(pendingValue);
    };
    const scheduleApply = value => {
      pendingValue = value;
      if (!raf) {
        raf = requestAnimationFrame(applyFrame);
      }
    };
    const begin = (x, y) => {
      startX = x;
      startY = y;
      active = true;
      confirmed = false;
      if (config.start) {
        config.start();
      }
    };
    const move = (x, y, event) => {
      if (!active) return;
      const dx = x - startX;
      const dy = y - startY;
      const primary = config.axis === "x" ? dx : dy;
      const cross = config.axis === "x" ? Math.abs(dy) : Math.abs(dx);
      if (primary > 8 && primary > cross) {
        if (config.axis === "y" && canScrollUp(config.scrollTarget)) {
          active = false;
          if (config.reset) {
            config.reset();
          }
          return;
        }
        if (event && event.cancelable) {
          event.preventDefault();
        }
        if (!confirmed) {
          confirmed = true;
          if (config.confirm) {
            config.confirm();
          }
          if (
            activePointerId !== null &&
            target.setPointerCapture &&
            !pointerCaptured
          ) {
            try {
              target.setPointerCapture(activePointerId);
              pointerCaptured = true;
            } catch (_) {
              pointerCaptured = false;
            }
          }
        }
        scheduleApply(primary);
      }
    };
    const finish = (x, y) => {
      if (!active) return;
      active = false;
      if (raf) {
        cancelAnimationFrame(raf);
        raf = 0;
      }
      if (
        activePointerId !== null &&
        pointerCaptured &&
        target.releasePointerCapture
      ) {
        try {
          target.releasePointerCapture(activePointerId);
        } catch (_) {
          // Pointer capture can already be released by the browser on cancel.
        }
      }
      activePointerId = null;
      pointerCaptured = false;
      const delta = config.axis === "x" ? x - startX : y - startY;
      if (confirmed && delta > threshold()) {
        config.done();
      } else {
        config.reset();
      }
    };
    const add = (type, handler, options) => {
      target.addEventListener(type, handler, options);
      cleanup.push(() => target.removeEventListener(type, handler, options));
    };
    add("pointerdown", event => {
      if (isDragIgnoredTarget(event.target)) {
        return;
      }
      activePointerId = event.pointerId;
      pointerCaptured = false;
      begin(event.clientX, event.clientY);
    });
    add("pointermove", event => {
      move(event.clientX, event.clientY, event);
    });
    add("pointerup", event => {
      finish(event.clientX, event.clientY);
    });
    add("pointercancel", event => {
      finish(event.clientX, event.clientY);
    });
    add("touchstart", event => {
      if (isDragIgnoredTarget(event.target)) {
        return;
      }
      if (event.touches.length) {
        begin(event.touches[0].clientX, event.touches[0].clientY);
      }
    }, { passive: true });
    add("touchmove", event => {
      if (event.touches.length) {
        move(event.touches[0].clientX, event.touches[0].clientY, event);
      }
    }, { passive: false });
    add("touchend", event => {
      const touch = event.changedTouches[0];
      finish(touch ? touch.clientX : startX, touch ? touch.clientY : startY);
    });
    add("touchcancel", event => {
      const touch = event.changedTouches[0];
      finish(touch ? touch.clientX : startX, touch ? touch.clientY : startY);
    });
    return () => {
      if (raf) {
        cancelAnimationFrame(raf);
      }
      cleanup.forEach(remove => remove());
    };
  }

  function isDragIgnoredTarget(target) {
    return Boolean(target && target.closest && target.closest(
      "button, input, select, textarea, a, iframe, [role='slider'], [data-drag-ignore='true']"
    ));
  }

  function prefersTouchInput() {
    return ("ontouchstart" in window)
      || Number(window.navigator?.maxTouchPoints || 0) > 0
      || Number(window.navigator?.msMaxTouchPoints || 0) > 0;
  }

  function shouldHandleTouchLikePointerEvent(event, preferTouchEvents = false) {
    if (!event || event.isPrimary === false) {
      return false;
    }
    const pointerType = String(event.pointerType || "").toLowerCase();
    if (pointerType === "mouse" || pointerType === "pen") {
      return false;
    }
    if (preferTouchEvents && pointerType === "touch") {
      return false;
    }
    if (!pointerType && window.matchMedia && window.matchMedia("(pointer: fine)").matches) {
      return false;
    }
    return true;
  }

  function messagesForCard(card) {
    if (isPendingOutboundCard(card)) {
      return pendingOutboundMessages(card);
    }
    if (Array.isArray(card.transcript_messages) && card.transcript_messages.length) {
      return card.transcript_messages.map(item => ({
        role: item.role || item.sender || "assistant",
        text: item.text || item.content || "",
        time: item.time || "",
        timestamp: item.timestamp || "",
        created_at: item.created_at || "",
        attachments: normalizedAttachments(item.attachments),
        connected_records: Array.isArray(item.connected_records) ? item.connected_records.slice() : [],
        images: normalizedImages(item.images)
      }));
    }
    if (card.transcript) {
      return String(card.transcript).split(/\n+/).filter(Boolean).map(line => {
        const user = /^user:/i.test(line);
        return { role: user ? "user" : "assistant", text: line.replace(/^(user|pucky|assistant):\s*/i, "") };
      });
    }
    return [{
      role: "assistant",
      text: card.summary || "No transcript is attached to this reply.",
      connected_records: Array.isArray(card?.connected_records) ? card.connected_records.slice() : [],
    }];
  }

  function pendingOutboundMessages(card) {
    const transcript = String(card?.pending_user_transcript || card?.summary || card?.transcript || "").trim()
      || "Message sent.";
    const createdAt = String(card?.created_at || card?.updated_at || "");
    const failed = isFailedPendingOutboundCard(card);
    return [
      {
        role: "user",
        text: transcript,
        created_at: createdAt,
        synthetic: true
      },
      {
        role: "assistant",
        text: failed ? String(card?.pending_error || turnFailureSummary(state.turn)) : "Thinking...",
        created_at: String(card?.updated_at || createdAt),
        synthetic: true,
        pending_placeholder: !failed,
        pending_failed: failed
      }
    ];
  }

  function scrollTranscriptToLatest(content) {
    requestAnimationFrame(() => {
      content.scrollTop = content.scrollHeight;
    });
  }

  function canScrollUp(target) {
    return Boolean(target && target.scrollTop > 0);
  }

  function isNearBottom(target, threshold = 84) {
    if (!target) {
      return true;
    }
    return (target.scrollHeight - (target.scrollTop + target.clientHeight)) <= threshold;
  }

  function syncOpenThreadDetailAfterCards() {
    if (state.route !== "inbox") {
      return null;
    }
    const detail = normalizeNavDetail(state.navDetail);
    if (!detail || detail.type !== "transcript") {
      return null;
    }
    const panel = document.getElementById("detail");
    if (!panel || !panel.classList.contains("is-open")) {
      return null;
    }
    const nextCard = resolveNavDetailCard(detail);
    const nextSessionId = cardSessionId(nextCard);
    if (!nextCard || !nextSessionId || nextSessionId === detail.session_id) {
      return null;
    }
    const content = panel.querySelector(".detail-content");
    captureCurrentDetailScroll();
    const shouldStickToLatest = isTurnActive(state.turn) || isNearBottom(content);
    showTranscript(nextCard, shouldStickToLatest
      ? {}
      : { restoring: true, scrollTop: state.navDetail?.scroll_top });
    recordTurnUiEvent("thread_detail_rebound", {
      turn_id: turnStatusTurnId(state.turn),
      detail_type: detail.type,
      thread_id: cardThreadId(nextCard),
      session_id: nextSessionId,
      stick_to_latest: shouldStickToLatest
    });
    return { type: detail.type, thread_id: cardThreadId(nextCard), session_id: nextSessionId };
  }

  function cardTimestamp(card) {
    const raw = card.updated_at || card.created_at || card.timestamp || card.time || "";
    const text = smartTimestamp(raw, "");
    if (!text) {
      return null;
    }
    const date = parseDate(raw);
    return { text, iso: date ? date.toISOString() : String(raw) };
  }

  function messageTimestamp(message) {
    return smartTimestamp(
      message.created_at || message.timestamp || "",
      message.time || message.timestamp || ""
    );
  }

  function smartTimestamp(raw, fallback = "") {
    const date = parseDate(raw);
    if (!date) {
      return fallback;
    }
    return formatSmartTimestamp(date);
  }

  function parseDate(raw) {
    if (!raw) {
      return null;
    }
    const date = new Date(raw);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  function formatSmartTimestamp(date, now = new Date()) {
    const elapsedMs = now.getTime() - date.getTime();
    if (elapsedMs >= 0 && elapsedMs < 24 * 60 * 60 * 1000) {
      return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    }
    const daysAgo = Math.floor((startOfDay(now) - startOfDay(date)) / (24 * 60 * 60 * 1000));
    if (daysAgo === 1) {
      return "Yesterday";
    }
    if (daysAgo > 1 && daysAgo < 7) {
      return date.toLocaleDateString([], { weekday: "long" });
    }
    return `${date.getMonth() + 1}/${date.getDate()}/${String(date.getFullYear()).slice(-2)}`;
  }

  function startOfDay(date) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
  }

  function hasTranscript(card) {
    return isPendingOutboundCard(card)
      || Boolean(card.transcript || (Array.isArray(card.transcript_messages) && card.transcript_messages.length));
  }

  function cardImages(card) {
    return cardAttachments(card);
  }

  function cardAttachments(card) {
    const direct = normalizedAttachments(card?.attachments);
    return direct.length ? direct : normalizedAttachments(card?.images);
  }

  function normalizedImages(images) {
    return normalizedAttachments(images);
  }

  function normalizedAttachments(attachments) {
    return Array.isArray(attachments)
      ? attachments
        .filter(attachment => attachment && hasAttachmentSource(attachment))
        .map((attachment, index) => normalizeAttachment(attachment, index))
      : [];
  }

  function hasAttachmentSource(attachment) {
    if (!attachment || typeof attachment !== "object") {
      return false;
    }
    const hasDirectSource = Boolean(
      attachment.path
      || attachment.local_path
      || attachment.image_path
      || attachment.artifact
      || attachment.artifact_path
      || attachment.viewer_artifact
      || attachment.html_artifact
      || attachment.document_html_artifact
      || attachment.viewer_path
      || attachment.html_viewer_path
      || attachment.document_html_path
      || attachment.src
      || attachment.url
      || attachment.data_url
      || attachment.viewer
    );
    if (hasDirectSource) {
      return true;
    }
    const kind = String(attachment.kind || attachment.type || "").toLowerCase();
    const mime = String(attachment.mime_type || attachment.mime || "").toLowerCase();
    const textLike = kind === "text"
      || kind === "markdown"
      || kind === "html"
      || kind === "table"
      || mime.startsWith("text/")
      || mime === "application/json"
      || mime === "application/xml";
    if (!textLike) {
      return false;
    }
    return hasMeaningfulAttachmentText(attachment.text || attachment.preview);
  }

  function hasMeaningfulAttachmentText(value) {
    const text = String(value || "").trim();
    if (!text) {
      return false;
    }
    const lower = text.toLowerCase();
    const placeholders = [
      "speaker-separated transcript with timestamps",
      "meeting transcript",
      "meeting summary",
      "playback url:"
    ];
    if (placeholders.some(item => lower === item || lower.startsWith(`${item}.`))) {
      return false;
    }
    return text.length >= 80 || text.includes("\n");
  }

  function htmlAttachmentLocalPath(item) {
    const kind = String(item?.kind || item?.type || "").toLowerCase();
    const mime = String(item?.mime_type || item?.mime || "").toLowerCase();
    const path = String(item?.path || item?.local_path || "").trim();
    if (!path) {
      return "";
    }
    return kind === "html" || mime.includes("html") ? path : "";
  }

  function normalizeAttachment(attachment, index = 0) {
    const raw = { ...attachment };
    const mime = resolvedMediaMime(null, raw, mediaPath(raw) || bundledArtifactPath(raw) || raw.src || raw.url || raw.data_url || "");
    const kind = normalizedAttachmentKind(raw, mime);
    const id = String(raw.id || raw.sha256 || raw.path || raw.artifact || raw.src || raw.url || `${kind}-${index}`);
    const title = String(raw.title || raw.name || raw.filename || id.replace(/^.*\//, "") || "Attachment");
    const original = raw.original && typeof raw.original === "object" ? { ...raw.original } : {};
    original.name = original.name || title;
    original.mime_type = original.mime_type || mime;
    if (raw.path && !original.path) original.path = raw.path;
    if (raw.artifact && !original.artifact) original.artifact = raw.artifact;
    if (raw.sha256 && !original.sha256) original.sha256 = raw.sha256;
    const preview = normalizeAttachmentPreview(raw, kind);
    const viewer = normalizeAttachmentViewer(raw, kind, mime);
    return {
      ...raw,
      id,
      kind,
      title,
      mime_type: mime,
      status: raw.status || "ready",
      original,
      preview,
      viewer
    };
  }

  function normalizedAttachmentKind(item, mime) {
    const explicit = String(item.kind || "").toLowerCase();
    if (["image", "video", "audio", "document", "table", "html", "text", "archive", "unknown"].includes(explicit)) {
      return explicit;
    }
    if (mime.startsWith("image/")) return "image";
    if (mime.startsWith("video/")) return "video";
    if (mime.startsWith("audio/")) return "audio";
    if (mime === "text/csv" || mime === "text/tab-separated-values") return "table";
    if (mime === "text/html" || mime === "application/xhtml+xml") return "html";
    if (["text/plain", "text/markdown", "application/json", "text/xml", "application/xml"].includes(mime)) return "text";
    if (mime === "application/pdf" || mime.includes("wordprocessingml") || mime.includes("presentationml") || mime.includes("spreadsheetml")) return "document";
    const path = String(mediaPath(item) || bundledArtifactPath(item) || item.src || "").toLowerCase();
    if (/\.(zip|rar|7z|tar|gz)(?:$|[?#])/i.test(path)) return "archive";
    return "unknown";
  }

  function normalizeAttachmentPreview(item, kind) {
    if (item.preview && typeof item.preview === "object") {
      return { ...item.preview };
    }
    if (item.preview_artifact || item.preview_path || item.preview_src || item.preview_url) {
      return {
        type: "image",
        artifact: item.preview_artifact || "",
        path: item.preview_path || "",
        src: item.preview_src || item.preview_url || ""
      };
    }
    if (kind === "image") return { type: "image", ...attachmentSource(item) };
    if (kind === "video") return { type: "video", ...attachmentSource(item) };
    if (kind === "text") return { type: "text", text: String(item.text || item.summary || item.alt || "") };
    return { type: "icon", label: attachmentLabel(item, kind), icon: kind };
  }

  function normalizeAttachmentViewer(item, kind, mime) {
    if (item.viewer && typeof item.viewer === "object") {
      return { ...item.viewer };
    }
    if (kind === "image") return { type: "image_gallery", images: [{ ...attachmentSource(item), type: "image" }] };
    if (kind === "video") return { type: "video_player", sources: [{ ...attachmentSource(item), type: mime || "video/mp4" }] };
    if (kind === "audio") return { type: "audio_player", sources: [{ ...attachmentSource(item), type: mime || "audio/mpeg" }] };
    if (kind === "html") return { type: "html_iframe", ...attachmentViewerSource(item) };
    if (kind === "table") return { type: "table", ...attachmentViewerSource(item) };
    if (kind === "text") return { type: "text", ...attachmentViewerSource(item) };
    if (documentHtmlSrc(item)) return { type: "document_html", ...attachmentViewerSource(item) };
    if (kind === "document" && (item.preview_artifact || item.preview_path || item.preview_src)) {
      return { type: "document_pages", page_count: item.page_count || 1, first_page_image: normalizeAttachmentPreview(item, kind) };
    }
    return { type: "download_only", reason: "No browser-safe preview derivative is available." };
  }

  function attachmentSource(item) {
    const source = {};
    ["path", "artifact", "src", "data_url", "url"].forEach(key => {
      if (item[key]) source[key] = item[key];
    });
    return source;
  }

  function attachmentViewerSource(item) {
    const source = {};
    [
      "viewer_path",
      "html_viewer_path",
      "document_html_path",
      "viewer_src",
      "viewer_url",
      "viewer_artifact",
      "html_artifact",
      "document_html_artifact",
      "path",
      "artifact",
      "src",
      "data_url",
      "url"
    ].forEach(key => {
      if (item[key]) source[key] = item[key];
    });
    return source;
  }

  function attachmentViewerType(item) {
    const viewerType = String(item?.viewer?.type || "").toLowerCase();
    if (viewerType) {
      return viewerType;
    }
    return normalizeAttachmentViewer(item || {}, attachmentKind(item || {}), String(item?.mime_type || "")).type;
  }

  function attachmentPromotesToChatMedia(item) {
    const viewerType = attachmentViewerType(item);
    return ["image_gallery", "video_player", "document_html", "html_iframe"].includes(viewerType);
  }

  function messageImages(card, message, index, messages) {
    const direct = normalizedAttachments(message?.attachments).filter(attachmentPromotesToChatMedia);
    if (direct.length) {
      return direct;
    }
    const legacy = normalizedImages(message?.images);
    if (legacy.length) {
      return legacy;
    }
    return index === lastAssistantMessageIndex(messages) ? cardImages(card) : [];
  }

  function restorableImagesForCard(card) {
    const direct = cardImages(card);
    if (direct.length) {
      return direct;
    }
    const messages = messagesForCard(card);
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const images = normalizedAttachments(messages[index]?.attachments).concat(normalizedImages(messages[index]?.images));
      if (images.length) {
        return images;
      }
    }
    return [];
  }

  function firstDisplayableAttachmentInfo(card) {
    const sets = [];
    const cardLevel = preferredDisplayAttachments(card, card?.attachments);
    const cardLevelHasMeetingAttachments = cardLevel.some(isMeetingAttachmentItem);
    if (cardLevelHasMeetingAttachments && cardLevel.length) {
      sets.push(cardLevel);
    }
    const messages = messagesForCard(card);
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      if (String(messages[index]?.role || "").toLowerCase() === "user") {
        continue;
      }
      const attachments = preferredDisplayAttachments(card, messages[index]?.attachments);
      if (attachments.length) {
        sets.push(attachments);
        break;
      }
    }
    if (!cardLevelHasMeetingAttachments && cardLevel.length) {
      sets.push(cardLevel);
    }
    for (const attachments of sets) {
      const index = attachments.findIndex(item => {
        const type = attachmentViewerType(item);
        return ["html_iframe", "table", "text", "image_gallery", "video_player", "audio_player", "document_html"].includes(type);
      });
      if (index >= 0) {
        return { attachments, index, item: attachments[index] };
      }
    }
    return null;
  }

  function lastAssistantMessageIndex(messages) {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      if (messages[index]?.role !== "user") {
        return index;
      }
    }
    return -1;
  }

  function hasTrace(card) {
    return thinkingLogEntries(card).length > 0;
  }

  function thinkingLogEntries(card, message = null, index = 0) {
    const trace = traceForTurn(card, message, index);
    const sections = Array.isArray(trace.sections) ? trace.sections : [];
    const entries = [];
    for (const section of sections) {
      if (!section || !["thinking", "reasoning"].includes(String(section.kind || "").toLowerCase())) {
        continue;
      }
      const title = String(section.title || section.text || section.summary || "").trim();
      const items = traceItems(section.items);
      if (title || items.length) {
        entries.push({ title: title || "Thinking", items });
      }
    }
    if (!entries.length && Array.isArray(trace.thinking)) {
      for (const item of trace.thinking) {
        const title = String(item.title || item.text || item.summary || item).trim();
        if (title) {
          entries.push({ title, items: traceItems(item.items) });
        }
      }
    }
    return entries;
  }

  function traceForTurn(card, message = null, index = 0) {
    if (message && typeof message.trace === "object") {
      return message.trace;
    }
    if (card && typeof card.trace === "object") {
      return card.trace;
    }
    return mockTraceFor(card, message, index);
  }

  function mockTraceFor(card, message = null, index = 0) {
    const title = String(card?.title || "reply").toLowerCase();
    const text = String(message?.text || card?.summary || "the reply").replace(/\s+/g, " ").trim();
    const short = text ? text.slice(0, 42) : "the reply";
    return {
      schema: "pucky.turn_trace.v1",
      turn_id: `${card?.session_id || "fixture"}_${index}`,
      sections: [
        {
          kind: "thinking",
          title: `Checking ${title}.`,
          items: [
            { label: "feed_api_get", status: "completed" },
            { label: "artifact_read_base64", status: "completed" }
          ]
        },
        {
          kind: "reasoning",
          title: `Preparing: ${short}${text.length > short.length ? "..." : ""}`,
          items: [
            { label: "message_outline", status: "completed" },
            { label: "unused_tool_probe", status: "failed" }
          ]
        }
      ]
    };
  }

  function traceItems(items) {
    if (!Array.isArray(items)) {
      return [];
    }
    return items
      .filter(item => item && (item.label || item.name || item.tool || item.command))
      .map(item => ({
        label: item.label || item.name || item.tool || item.command,
        status: item.status || item.state || item.result || ""
      }));
  }

  function cleanTraceLabel(label) {
    return String(label || "").replace(/_/g, " ").trim();
  }

  function traceStatusClass(status) {
    const value = String(status || "").toLowerCase();
    if (["completed", "complete", "success", "succeeded", "ok", "done", "true"].includes(value)) {
      return "success";
    }
    if (["failed", "failure", "error", "errored", "cancelled", "canceled", "false"].includes(value)) {
      return "failed";
    }
    return "neutral";
  }

  function isActiveCard(card) {
    if (activePlayerMatchesCard(card)) {
      return true;
    }
    return samePath(state.activePath, audioControlKey(card));
  }

  function activePlayerMatchesCard(card) {
    return Boolean(playerHasAudioIdentity(state.player) && isSameAudioCard(state.player, card));
  }

  function cardOrigin(card) {
    return card && card.origin && typeof card.origin === "object" ? card.origin : {};
  }

  function originRuntime(origin) {
    const runtime = String(origin.runtime || "codex").trim() || "codex";
    const provider = String(origin.model_provider || "").trim();
    return provider ? `${runtime} / ${provider}` : runtime;
  }

  function metaRow(label, value, options = {}) {
    const row = el("div", "meta-row");
    row.append(el("span", "meta-label", label));
    row.append(el("span", options.monospace ? "meta-value is-monospace" : "meta-value", value));
    return row;
  }

  function hasAudio(card) {
    return Boolean(card && (card.audio_path || card.audio_playlist_path || card.audio_url));
  }

  function audioControlKey(card) {
    if (!card || typeof card !== "object") {
      return "";
    }
    if (card.audio_playlist_path) {
      return card.audio_playlist_path;
    }
    if (!hasNativeAudioBridge() && card.audio_url) {
      return hostedAudioSessionKey(card) || card.audio_url;
    }
    return card.audio_path || card.audio_media_id || card.audio_url || card.session_id || card.title || "";
  }

  function audioStateKey(card) {
    return normalizePath(audioControlKey(card));
  }

  function hostedAudioSessionKey(card) {
    if (!card || typeof card !== "object") {
      return "";
    }
    const explicit = String(card.audio_media_id || card.media_id || "").trim();
    if (explicit) {
      return `media:${explicit}`;
    }
    const cardId = String(card.card_id || "").trim();
    if (cardId) {
      return `card:${cardId}:audio`;
    }
    const sessionId = cardSessionId(card);
    if (sessionId) {
      return `session:${sessionId}:audio`;
    }
    const threadId = cardThreadId(card);
    if (threadId) {
      return `thread:${threadId}:audio`;
    }
    const audioUrl = canonicalHostedAudioUrlIdentity(card.audio_url);
    return audioUrl ? `url:${audioUrl}` : "";
  }

  function canonicalHostedAudioUrlIdentity(value) {
    const raw = String(value || "").trim();
    if (!raw) {
      return "";
    }
    try {
      const base = window.location && window.location.origin
        ? window.location.origin
        : DEFAULT_LINKS_API_BASE;
      const url = new URL(raw, base);
      url.hash = "";
      url.search = "";
      return url.toString();
    } catch (_) {
      return raw.replace(/[?#].*$/, "");
    }
  }

  function playerStateKey(player) {
    return normalizePath((player && (player.source || player.path)) || state.activePath || "");
  }

  function isAudioTilePhase(phase) {
    return AUDIO_TILE_PHASES.includes(String(phase || ""));
  }

  function audioProbeTarget(card) {
    return {
      card_id: String(card?.card_id || ""),
      session_id: String(cardSessionId(card) || ""),
      thread_id: String(cardThreadId(card) || ""),
      title: String(card?.title || "")
    };
  }

  function clearAudioProbeResetTimer() {
    if (!audioProbeResetTimerId) {
      return;
    }
    window.clearTimeout(audioProbeResetTimerId);
    audioProbeResetTimerId = 0;
  }

  function recordAudioProbeEvent(type, extra = {}) {
    const event = {
      at: new Date().toISOString(),
      type: String(type || "event"),
      ...extra
    };
    const events = Array.isArray(state.audioProbe.recent_events) ? state.audioProbe.recent_events.slice() : [];
    events.push(event);
    state.audioProbe.recent_events = events.slice(-AUDIO_PROBE_EVENT_LIMIT);
    return event;
  }

  function applyAudioProbeState(patch = {}) {
    state.audioProbe = {
      ...state.audioProbe,
      ...patch,
      runtime_mode: audioRuntimeMode(),
      active_path: state.activePath || ""
    };
  }

  function scheduleAudioProbeReset(delayMs = AUDIO_TERMINAL_RESET_MS) {
    clearAudioProbeResetTimer();
    audioProbeResetTimerId = window.setTimeout(() => {
      audioProbeResetTimerId = 0;
      applyAudioProbeState({
        target_key: "",
        target_card: {
          card_id: "",
          session_id: "",
          thread_id: "",
          title: ""
        },
        current_tile_audio_phase: "idle",
        resolved_source_type: "",
        cache_prep: "",
        started_at: "",
        started_at_ms: 0,
        confirmed_at: "",
        confirmed_at_ms: 0,
        ended_at: "",
        ended_at_ms: 0
      });
      render();
    }, Math.max(0, Number(delayMs || AUDIO_TERMINAL_RESET_MS)));
  }

  function setAudioProbePhase(card, phase, extra = {}) {
    clearAudioProbeResetTimer();
    const nextPhase = isAudioTilePhase(phase) ? String(phase) : "idle";
    const now = Date.now();
    const patch = {
      target_key: audioStateKey(card),
      target_card: audioProbeTarget(card),
      current_tile_audio_phase: nextPhase,
      resolved_source_type: extra.resolved_source_type ?? state.audioProbe.resolved_source_type,
      cache_prep: extra.cache_prep ?? state.audioProbe.cache_prep,
      last_terminal_outcome: "",
      last_error_toast: extra.clear_error ? "" : state.audioProbe.last_error_toast,
      ended_at: "",
      ended_at_ms: 0
    };
    if (nextPhase === "starting") {
      patch.started_at = new Date(now).toISOString();
      patch.started_at_ms = now;
      patch.confirmed_at = "";
      patch.confirmed_at_ms = 0;
    }
    if (nextPhase === "playing_confirmed") {
      patch.confirmed_at = new Date(now).toISOString();
      patch.confirmed_at_ms = now;
    }
    applyAudioProbeState(patch);
    recordAudioProbeEvent("phase", {
      phase: nextPhase,
      reason: String(extra.reason || ""),
      target_key: state.audioProbe.target_key
    });
    return true;
  }

  function setAudioProbePhaseByKey(targetKey, phase, extra = {}) {
    if (!samePath(state.audioProbe.target_key, targetKey)) {
      return false;
    }
    const nextPhase = isAudioTilePhase(phase) ? String(phase) : "idle";
    const now = Date.now();
    const patch = {
      current_tile_audio_phase: nextPhase,
      resolved_source_type: extra.resolved_source_type ?? state.audioProbe.resolved_source_type,
      cache_prep: extra.cache_prep ?? state.audioProbe.cache_prep,
      last_terminal_outcome: ""
    };
    if (nextPhase === "playing_confirmed") {
      patch.confirmed_at = new Date(now).toISOString();
      patch.confirmed_at_ms = now;
    }
    applyAudioProbeState(patch);
    recordAudioProbeEvent("phase", {
      phase: nextPhase,
      reason: String(extra.reason || ""),
      target_key: state.audioProbe.target_key
    });
    return true;
  }

  function confirmAudioProbePlaybackStart(targetKey, player, reason = "play_request_acknowledged") {
    if (!samePath(state.audioProbe.target_key, targetKey)) {
      return false;
    }
    if (!Boolean(player?.is_playing) || !samePath(targetKey, playerStateKey(player))) {
      return false;
    }
    if (state.audioProbe.current_tile_audio_phase === "playing_confirmed") {
      return false;
    }
    return setAudioProbePhaseByKey(targetKey, "playing_confirmed", {
      reason: String(reason || "play_request_acknowledged")
    });
  }

  function setAudioProbeTerminal(card, outcome, extra = {}) {
    const targetKey = audioStateKey(card);
    return setAudioProbeTerminalByKey(targetKey, outcome, {
      ...extra,
      target_card: audioProbeTarget(card)
    });
  }

  function setAudioProbeTerminalByKey(targetKey, outcome, extra = {}) {
    if (!samePath(state.audioProbe.target_key, targetKey)) {
      return false;
    }
    clearAudioProbeResetTimer();
    const now = Date.now();
    const value = String(outcome || "").trim() || "idle";
    const phase = ["start_failed", "ended_immediately"].includes(value) ? value : "idle";
    applyAudioProbeState({
      target_key: extra.immediate_reset ? "" : state.audioProbe.target_key,
      target_card: extra.immediate_reset
        ? {
            card_id: "",
            session_id: "",
            thread_id: "",
            title: ""
          }
        : (extra.target_card || state.audioProbe.target_card),
      current_tile_audio_phase: phase,
      last_terminal_outcome: value,
      last_error_toast: String(extra.error_message || state.audioProbe.last_error_toast || state.lastToast.message || ""),
      ended_at: new Date(now).toISOString(),
      ended_at_ms: now
    });
    recordAudioProbeEvent("terminal", {
      outcome: value,
      phase,
      reason: String(extra.reason || ""),
      target_key: state.audioProbe.target_key
    });
    if (extra.schedule_reset) {
      scheduleAudioProbeReset(extra.reset_delay_ms || AUDIO_TERMINAL_RESET_MS);
    }
    return true;
  }

  function prefersHostedDirectAudio(card) {
    return !hasNativeAudioBridge() && Boolean(String(card?.audio_url || "").trim());
  }

  function describeAudioSourceForCard(card) {
    if (prefersHostedDirectAudio(card)) {
      return { resolved_source_type: "browser_url", cache_prep: "skipped" };
    }
    if (card?.audio_playlist_path) {
      return { resolved_source_type: "playlist_path", cache_prep: "skipped" };
    }
    if (card?.audio_path && (!card?.is_meeting_recording || isAndroidPlayableAudioPath(card.audio_path))) {
      return { resolved_source_type: "local_path", cache_prep: "skipped" };
    }
    if (card?.audio_url) {
      return {
        resolved_source_type: hasNativeAudioBridge() ? "remote_url" : "browser_url",
        cache_prep: hasNativeAudioBridge() ? "attempted" : "skipped"
      };
    }
    return { resolved_source_type: "unknown", cache_prep: "skipped" };
  }

  function currentTileAudioPhase(card) {
    if (samePath(state.audioProbe.target_key, audioStateKey(card)) && isAudioTilePhase(state.audioProbe.current_tile_audio_phase)) {
      return state.audioProbe.current_tile_audio_phase;
    }
    if (state.player.is_playing && activePlayerMatchesCard(card)) {
      return "playing_confirmed";
    }
    return "idle";
  }

  function currentTileAudioStripKind(card) {
    const phase = currentTileAudioPhase(card);
    if (phase !== "playing_confirmed") {
      return "status";
    }
    if (Number(state.player.duration_ms || 0) > 0 && activePlayerMatchesCard(card)) {
      return "progress";
    }
    return "status";
  }

  function isCardAudioBusy(card) {
    return samePath(state.audioToggleBusyKey, audioStateKey(card));
  }

  function tileAudioLabel(card) {
    const phase = currentTileAudioPhase(card);
    if (phase === "starting") {
      return "Starting audio...";
    }
    if (phase === "pause_pending") {
      return "Pausing audio...";
    }
    if (phase === "playing_confirmed") {
      return "Audio playing";
    }
    if (phase === "start_failed") {
      return "Playback failed";
    }
    if (phase === "ended_immediately") {
      return "Playback ended early";
    }
    return "Audio ready";
  }

  function tileAudioMeta(card) {
    const phase = currentTileAudioPhase(card);
    if (["start_failed", "ended_immediately"].includes(phase)) {
      return String(state.audioProbe.last_error_toast || "Tap again to retry playback.");
    }
    if (phase === "playing_confirmed" && currentTileAudioStripKind(card) === "progress") {
      const duration = Number(state.player.duration_ms || 0);
      const position = currentPlayerPositionMs(state.player);
      if (duration > 0) {
        return `${formatTime(position)} of ${formatTime(duration)}`;
      }
    }
    return "";
  }

  function audioTileStatus(card) {
    const phase = currentTileAudioPhase(card);
    const runtime = samePath(state.audioProbe.target_key, audioStateKey(card))
      ? String(state.audioProbe.runtime_mode || audioRuntimeMode())
      : audioRuntimeMode();
    const status = el("div", "tile-audio-status");
    const label = el("div", "tile-audio-status-label", tileAudioLabel(card));
    const strip = el("div", `tile-audio-strip is-${phase} is-${runtime}`);
    const stripKind = currentTileAudioStripKind(card);
    setDataAttribute(status, "data-audio-phase", phase);
    setDataAttribute(status, "data-audio-runtime-mode", runtime);
    setDataAttribute(status, "data-audio-strip-kind", stripKind);
    setDataAttribute(strip, "data-strip-kind", stripKind);
    status.append(label);
    if (stripKind === "progress") {
      const progress = el("span", "tile-audio-progress");
      const duration = Math.max(0, Number(state.player.duration_ms || 0));
      const position = currentPlayerPositionMs(state.player);
      progress.style.setProperty("--progress", String(duration > 0 ? Math.min(1, position / duration) : 0));
      strip.append(progress);
    }
    status.append(strip);
    const meta = tileAudioMeta(card);
    if (meta) {
      status.append(el("div", "tile-audio-status-meta", meta));
    }
    return status;
  }

  function isPlayingCard(card) {
    return currentTileAudioPhase(card) === "playing_confirmed";
  }

  function isSameAudioCard(player, card) {
    if (!playerHasAudioIdentity(player) || !hasAudio(card)) {
      return false;
    }
    if (samePath(playerStateKey(player), audioStateKey(card))) {
      return true;
    }
    return samePath(player.path, card.audio_path)
      || samePath(player.path, card.audio_url)
      || samePath(player.source, audioControlKey(card))
      || samePath(player.source, card.audio_playlist_path)
      || samePath(player.source, card.audio_url);
  }

  function playerHasAudioIdentity(player) {
    return Boolean(player && (player.path || player.source));
  }

  function stampPlayerState(player, observedAtMs = Date.now()) {
    return {
      ...(player && typeof player === "object" ? player : state.player),
      observed_at_ms: Math.max(0, Number(observedAtMs || Date.now()))
    };
  }

  function currentPlayerPositionMs(player) {
    const base = Math.max(0, Number(player?.position_ms || 0));
    const duration = Math.max(0, Number(player?.duration_ms || 0));
    if (!player?.is_playing || duration <= 0) {
      return duration > 0 ? Math.min(duration, base) : base;
    }
    const observedAtMs = Math.max(0, Number(player?.observed_at_ms || 0));
    if (!observedAtMs) {
      return duration > 0 ? Math.min(duration, base) : base;
    }
    const speed = finiteSpeed(player?.speed) ?? 1;
    const live = base + Math.max(0, Date.now() - observedAtMs) * speed;
    return duration > 0 ? Math.min(duration, live) : live;
  }

  function isAudioDetailOpen() {
    const panel = document.getElementById("detail");
    return Boolean(panel?.classList.contains("is-open") && panel.getAttribute("data-detail-type") === "audio");
  }

  function shouldAnimateActiveTileAudio() {
    if (!state.activePath || !state.player.is_playing) {
      return false;
    }
    if (Number(state.player.duration_ms || 0) <= 0) {
      return false;
    }
    if (isAudioDetailOpen()) {
      return true;
    }
    const detailCard = currentDetailAudioCard();
    if (detailCard && activePlayerMatchesCard(detailCard)) {
      return true;
    }
    return (state.route === "inbox" || state.route === "inbox-detail")
      && feedDisplayCards().some(card => activePlayerMatchesCard(card));
  }

  function shouldRenderForPlayerState(previousPlayer, nextPlayer) {
    const previous = previousPlayer && typeof previousPlayer === "object" ? previousPlayer : {};
    const next = nextPlayer && typeof nextPlayer === "object" ? nextPlayer : {};
    const presentationChanged = String(previous.path || "") !== String(next.path || "")
      || String(previous.source || "") !== String(next.source || "")
      || String(previous.state || "") !== String(next.state || "")
      || Boolean(previous.is_playing) !== Boolean(next.is_playing)
      || Number(previous.duration_ms || 0) !== Number(next.duration_ms || 0)
      || Number(previous.speed || 0) !== Number(next.speed || 0)
      || String(previous.title || "") !== String(next.title || "");
    if (presentationChanged) {
      return true;
    }
    return isAudioDetailOpen()
      && Number(previous.position_ms || 0) !== Number(next.position_ms || 0);
  }

  function syncAudioProbeFromPlayerState(previousPlayer, nextPlayer) {
    const targetKey = String(state.audioProbe.target_key || "");
    if (!targetKey) {
      return false;
    }
    const phase = isAudioTilePhase(state.audioProbe.current_tile_audio_phase)
      ? state.audioProbe.current_tile_audio_phase
      : "idle";
    const nextKey = playerStateKey(nextPlayer);
    const matchesTarget = samePath(nextKey, targetKey);
    const isPlaying = Boolean(nextPlayer?.is_playing && matchesTarget);
    const now = Date.now();
    if (phase === "starting") {
      if (isPlaying) {
        return setAudioProbePhaseByKey(targetKey, "playing_confirmed", {
          reason: "player_confirmed"
        });
      }
      const startedAtMs = Number(state.audioProbe.started_at_ms || 0);
      if (startedAtMs && now - startedAtMs >= AUDIO_START_CONFIRMATION_TIMEOUT_MS) {
        return setAudioProbeTerminalByKey(targetKey, "start_failed", {
          reason: matchesTarget ? "player_not_playing" : "player_not_matched",
          schedule_reset: true
        });
      }
      return false;
    }
    if (phase === "pause_pending") {
      if (!isPlaying) {
        return setAudioProbeTerminalByKey(targetKey, "paused", {
          reason: "pause_confirmed",
          immediate_reset: true
        });
      }
      return false;
    }
    if (phase === "playing_confirmed" && !isPlaying) {
      const durationMs = Number(nextPlayer?.duration_ms || 0);
      const positionMs = Number(nextPlayer?.position_ms || 0);
      const completedNaturally = matchesTarget && (
        String(nextPlayer?.state || "") === "completed"
        || (durationMs > 0 && positionMs >= Math.max(0, durationMs - 250))
      );
      if (completedNaturally) {
        return setAudioProbeTerminalByKey(targetKey, "completed", {
          reason: "playback_completed",
          immediate_reset: true
        });
      }
      const confirmedAtMs = Number(state.audioProbe.confirmed_at_ms || 0);
      if (confirmedAtMs && now - confirmedAtMs <= AUDIO_EARLY_END_WINDOW_MS) {
        return setAudioProbeTerminalByKey(targetKey, "ended_immediately", {
          reason: "playback_stopped_early",
          schedule_reset: true
        });
      }
      return setAudioProbeTerminalByKey(targetKey, "paused", {
        reason: "playback_idle",
        immediate_reset: true
      });
    }
    return false;
  }

  function syncActivePathFromPlayer(player) {
    if (!playerHasAudioIdentity(player)) {
      state.activePath = "";
      return;
    }
    const matched = feedDisplayCards().find(card => isSameAudioCard(player, card));
    if (matched) {
      state.activePath = audioControlKey(matched);
      return;
    }
    if (!samePath(playerStateKey(player), state.activePath)) {
      state.activePath = "";
    }
  }

  function findCardByAudioLookupKey(key) {
    const target = normalizePath(key);
    if (!target) {
      return null;
    }
    return feedDisplayCards().find(card => (
      samePath(audioControlKey(card), target)
        || samePath(card.audio_url, target)
        || samePath(card.audio_path, target)
        || samePath(card.audio_playlist_path, target)
    )) || null;
  }

  function samePath(left, right) {
    return Boolean(left && right && normalizePath(left) === normalizePath(right));
  }

  function normalizePath(path) {
    return String(path || "")
      .replace(/^\/data\/user\/0\//, "/data/data/")
      .replace(/^\/mnt\/sdcard\//, "/storage/emulated/0/")
      .replace(/^\/sdcard\//, "/storage/emulated/0/");
  }

  function savedPositionFor(path) {
    const normalized = normalizePath(path);
    if (state.completedPaths.has(normalized)) {
      return 0;
    }
    return state.savedPositions.get(normalized) || 0;
  }

  function rememberPosition(path, position) {
    state.savedPositions.set(normalizePath(path), position);
    persistAudioState();
  }

  function savedSpeedForCard(card) {
    const speed = finiteSpeed(state.speedByPath.get(audioStateKey(card)));
    return speed ?? null;
  }

  function resolvedStartSpeedForCard(card) {
    return savedSpeedForCard(card) ?? clampSpeed(state.defaultAudioSpeed);
  }

  function rememberSpeed(card, speed) {
    state.speedByPath.set(audioStateKey(card), clampSpeed(speed));
    persistAudioState();
  }

  function selectedTimestampFor(card) {
    return state.selectedTimestampByPath.get(audioStateKey(card)) || "";
  }

  function rememberSelectedTimestamp(card, marker) {
    if (!marker || !marker.id) {
      return;
    }
    state.selectedTimestampByPath.set(audioStateKey(card), marker.id);
    persistAudioState();
  }

  function playbackPositionForCard(card) {
    const preview = scrubPreviewForCard(card);
    if (Number.isFinite(preview)) {
      return preview;
    }
    if (activePlayerMatchesCard(card)) {
      return currentPlayerPositionMs(state.player);
    }
    return savedPositionFor(audioControlKey(card));
  }

  function scrubPreviewForCard(card) {
    return Number(state.scrubPreviewByPath.get(audioStateKey(card)));
  }

  function rememberScrubPreview(card, positionMs) {
    const position = clampAudioPosition(positionMs, audioDurationForCard(card));
    state.scrubPreviewByPath.set(audioStateKey(card), position);
  }

  function startAudioScrub(card, positionMs) {
    state.scrubbingAudioKey = audioStateKey(card);
    rememberScrubPreview(card, positionMs);
  }

  function stopAudioScrub(card) {
    const key = audioStateKey(card);
    if (state.scrubbingAudioKey === key) {
      state.scrubbingAudioKey = "";
    }
    clearScrubPreview(card);
  }

  function clearScrubPreview(card) {
    state.scrubPreviewByPath.delete(audioStateKey(card));
  }

  function clampAudioPosition(positionMs, durationMs) {
    const position = Math.max(0, Number(positionMs || 0));
    const duration = Math.max(0, Number(durationMs || 0));
    return duration > 0 ? Math.min(duration, position) : position;
  }

  function audioDurationForCard(card) {
    const playerDuration = Number(state.player.duration_ms || 0);
    if (playerDuration > 0 && activePlayerMatchesCard(card)) {
      return playerDuration;
    }
    const markers = audioTimestamps(card);
    return markers.reduce((max, marker) => Math.max(max, Number(marker.end_ms || marker.start_ms || 0)), 0);
  }

  function audioTimestamps(card) {
    const raw = Array.isArray(card.audio_timestamps) ? card.audio_timestamps : [];
    return raw.map((item, index) => {
      const startMs = Number(item && item.start_ms);
      if (!Number.isFinite(startMs) || startMs < 0) {
        return null;
      }
      const endMs = Number(item && item.end_ms);
      const title = String((item && item.title) || "").trim();
      return {
        id: String((item && item.id) || `timestamp-${index + 1}`),
        title: title || `Timestamp ${index + 1}`,
        start_ms: Math.round(startMs),
        end_ms: Number.isFinite(endMs) && endMs >= startMs ? Math.round(endMs) : null,
        detail: String((item && item.detail) || "").trim(),
        kind: String((item && item.kind) || "").trim()
      };
    }).filter(Boolean).sort((left, right) => left.start_ms - right.start_ms);
  }

  function currentTimestamp(card, positionMs) {
    const markers = audioTimestamps(card);
    if (!markers.length) {
      return null;
    }
    const position = Math.max(0, Number(positionMs || 0));
    let current = markers[0];
    for (const marker of markers) {
      if (marker.start_ms <= position) {
        current = marker;
      } else {
        break;
      }
    }
    return current;
  }

  function selectedTimestamp(card) {
    const selectedId = selectedTimestampFor(card);
    if (!selectedId) {
      return null;
    }
    return audioTimestamps(card).find(marker => marker.id === selectedId) || null;
  }

  function isCompletePlayback(player) {
    if (!player || !player.path) {
      return false;
    }
    const duration = Number(player.duration_ms || 0);
    const position = Number(player.position_ms || 0);
    return player.state === "completed" || (duration > 0 && position >= Math.max(0, duration - COMPLETE_EPSILON_MS));
  }

  function rememberPlayerProgress(player) {
    const key = playerStateKey(player);
    if (!player || !key) {
      return;
    }
    if (isCompletePlayback(player)) {
      state.completedPaths.add(key);
      rememberPosition(key, 0);
      persistAudioState();
      return;
    }
    state.completedPaths.delete(key);
    rememberPosition(key, Math.max(0, Number(player.position_ms || 0)));
  }

  function forgetCompleted(path) {
    state.completedPaths.delete(normalizePath(path));
    persistAudioState();
  }

  async function postFeedAction(card, action) {
    const cardId = String(card && card.card_id || "");
    if (!cardId) {
      return null;
    }
    const clientActionId = `feed_${action}_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
    return feedApiRequest("/api/feed/actions", {
      method: "POST",
      body: {
        client_action_id: clientActionId,
        card_id: cardId,
        action
      }
    });
  }

  async function requestFeedAction(card, action, options = {}) {
    const cardId = String(card && card.card_id || "");
    if (!cardId) {
      return null;
    }
    try {
      const result = await postFeedAction(card, action);
      state.cards = result && result.ok === false
        ? state.cards
        : applyLocalFeedAction(state.cards, card, action);
      reconcileFocusedCardSelection();
      reconcileReadOverrides();
      clearMissingFeedIconFilter();
      render();
      if (result && result.ok === false && !options.silent) {
        showToast(result.error || "Feed refreshed");
      }
      return result;
    } catch (error) {
      if (!options.silent) {
        showToast(error.message);
      }
      return null;
    }
  }

  function requestMarkRead(card) {
    if (isPendingOutboundCard(card)) {
      return;
    }
    if (Boolean(card && card.read)) {
      return;
    }
    requestFeedAction(card, "mark_read", { silent: true });
  }

  function markCardRead(card) {
    if (isPendingOutboundCard(card)) {
      return;
    }
    setCardReadOverride(card, true);
    render();
    requestMarkRead(card);
  }

  function toggleCardRead(card) {
    if (isPendingOutboundCard(card)) {
      return;
    }
    if (isCardRead(card)) {
      setCardReadOverride(card, false);
      render();
      return;
    }
    markCardRead(card);
  }

  function isCardRead(card) {
    const override = readOverrideForCard(card);
    if (override !== null) {
      return override;
    }
    return Boolean(card && card.read);
  }

  function cardStateClass(card) {
    return isCardRead(card) ? "is-read" : "is-unread";
  }

  function toggleRead(card, action) {
    if (!action) {
      return;
    }
    markCardRead(card);
  }

  function isActionRead(card, action) {
    return Boolean(card && card.read);
  }

  function actionStateClass(card, action) {
    return isCardRead(card) ? "is-read" : "is-unread";
  }

  function resolveInitialTheme() {
    const params = new URLSearchParams(window.location.search || "");
    const queryTheme = normalizeTheme(params.get("theme"));
    if (queryTheme) {
      persistTheme(queryTheme);
      return queryTheme;
    }
    try {
      return normalizeTheme(localStorage.getItem(THEME_STATE_KEY)) || "dark";
    } catch (_) {
      return "dark";
    }
  }

  function parseDebugDelayMs(value) {
    const numeric = Number(value || 0);
    if (!Number.isFinite(numeric) || numeric <= 0) {
      return 0;
    }
    return Math.max(0, Math.min(5000, Math.round(numeric)));
  }

  function resolveNoteFlashDebugDefaults() {
    try {
      const params = new URLSearchParams(window.location.search || "");
      return {
        enabled: params.get("debug_note_flash") === "1",
        route_delay_ms: parseDebugDelayMs(params.get("debug_note_flash_delay_route_ms")),
        iframe_delay_ms: parseDebugDelayMs(params.get("debug_note_flash_delay_iframe_ms"))
      };
    } catch (_) {
      return {
        enabled: false,
        route_delay_ms: 0,
        iframe_delay_ms: 0
      };
    }
  }

  function normalizeTheme(value) {
    const theme = String(value || "").trim().toLowerCase();
    return theme === "light" || theme === "dark" ? theme : "";
  }

  function persistTheme(theme) {
    try {
      localStorage.setItem(THEME_STATE_KEY, normalizeTheme(theme) || "dark");
    } catch (_) {
      // Theme persistence is a visual preference and should never block boot.
    }
  }

  function syncThemeQueryParam(theme) {
    try {
      const url = new URL(window.location.href || "");
      url.searchParams.set("theme", normalizeTheme(theme) || "dark");
      window.history.replaceState(window.history.state || null, "", `${url.pathname}${url.search}${url.hash}`);
    } catch (_) {
      // Query param sync should help reload parity without blocking the page.
    }
  }

  function effectiveRoute() {
    return state.route;
  }

  function effectiveTheme() {
    return state.theme;
  }

  function usesHomeFeedRoute(route = state.route) {
    const value = String(route || "").trim();
    return value === "inbox";
  }

  function embeddedLightApp() {
    const value = String(state.route || "").trim();
    if (!isHomeShellCanonicalRoute(value)) {
      return "";
    }
    if (value === "inbox") return "inbox";
    if (value === "connect") return "connect";
    return value;
  }

  function chromeMode() {
    return "home-shell";
  }

  function isLightTheme() {
    return state.theme === "light";
  }

  function isWalkthroughPreview() {
    try {
      const params = new URLSearchParams(window.location.search || "");
      return params.get("preview") === "walkthrough";
    } catch (_) {
      return false;
    }
  }

  function normalizeHomeShellRoute(route) {
    const value = String(route || "").trim();
    if (!value) {
      return "home";
    }
    const normalized = ROUTE_ALIASES[value] || value;
    if (normalized === "home" || LIGHT_ROUTES.has(normalized) || HOME_SHELL_CANONICAL_ROUTES.has(normalized)) {
      return normalized;
    }
    return "";
  }

  function isHomeShellMockRoute(route = state.route) {
    const value = String(route || "").trim();
    return value === "home" || LIGHT_ROUTES.has(value);
  }

  function isHomeShellCanonicalRoute(route = effectiveRoute()) {
    const value = String(route || "").trim();
    return HOME_SHELL_CANONICAL_ROUTES.has(value);
  }

  function isHomeShellRoute(route = state.route) {
    const value = String(route || "").trim();
    return value === "home"
      || LIGHT_ROUTES.has(value)
      || HOME_SHELL_CANONICAL_ROUTES.has(value);
  }

  function isLightShellRoute() {
    return isHomeShellMockRoute();
  }

  function loadNavState() {
    try {
      if (shouldResetNavState()) {
        localStorage.removeItem(NAV_STATE_KEY);
        return {};
      }
      const parsed = JSON.parse(localStorage.getItem(NAV_STATE_KEY) || "{}");
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch (_) {
      return {};
    }
  }

  function shouldResetNavState() {
    try {
      const params = new URLSearchParams(window.location.search || "");
      return params.get("reset_nav") === "1";
    } catch (_) {
      return false;
    }
  }

  function initialRoute(route, theme = "dark") {
    return resolveInitialRouteState(route, theme).route;
  }

  function resolveInitialRouteState(route, theme = "dark") {
    void theme;
    const queryRoute = routeQueryParam();
    if (queryRoute) {
      return { route: normalizeHomeShellRoute(queryRoute) || "home" };
    }
    const persistedRoute = String(route || "").trim();
    if (persistedRoute) {
      return { route: normalizeHomeShellRoute(persistedRoute) || "home" };
    }
    return { route: "home" };
  }

  function resolveRouteForTheme(route, theme = state.theme) {
    void theme;
    const value = String(route || "").trim();
    if (!value) {
      return "home";
    }
    return normalizeHomeShellRoute(value) || "home";
  }

  function routeQueryParam() {
    try {
      return String(new URLSearchParams(window.location.search || "").get("route") || "").trim();
    } catch (_) {
      return "";
    }
  }

  function syncRouteQueryParam(route) {
    try {
      const url = new URL(window.location.href || "");
      url.searchParams.delete("reset_nav");
      url.searchParams.set("route", normalizeHomeShellRoute(route) || "home");
      window.history.replaceState(window.history.state || null, "", `${url.pathname}${url.search}${url.hash}`);
    } catch (_) {
      // Query param sync should help direct-entry parity without blocking the page.
    }
  }

  function scrollNumber(value) {
    const number = Number(value || 0);
    return Number.isFinite(number) ? Math.max(0, Math.round(number)) : 0;
  }

  function normalizeNavDetail(detail) {
    if (!detail || typeof detail !== "object") {
      return null;
    }
    const type = String(detail.type || "");
    if (!["audio", "transcript", "page", "images", "attachment", "meeting_failed", "meeting_runtime"].includes(type)) {
      return null;
    }
    const sessionId = String(detail.session_id || "");
    if (!sessionId) {
      return null;
    }
    const normalized = {
      type,
      session_id: sessionId,
      thread_id: String(detail.thread_id || ""),
      scroll_top: scrollNumber(detail.scroll_top ?? detail.scrollTop)
    };
    if (type === "audio") {
      normalized.timestamp_scroll_top = scrollNumber(detail.timestamp_scroll_top ?? detail.timestampScrollTop);
    }
    if (type === "images" || type === "attachment") {
      normalized.image_index = scrollNumber(detail.image_index ?? detail.imageIndex);
    }
    return normalized;
  }

  function cardSessionId(card) {
    return String(card?.session_id || card?.local_session_id || card?.turn_id || "");
  }

  function cardThreadId(card) {
    return String(cardOrigin(card).thread_id || "").trim();
  }

  function resolveNavDetailCard(detail) {
    if (!detail) {
      return null;
    }
    const byThread = detail.thread_id ? findCardByThreadId(detail.thread_id) : null;
    if (byThread) {
      return byThread;
    }
    return findCardBySessionId(detail.session_id);
  }

  function setDataAttribute(node, name, value) {
    if (!node) {
      return;
    }
    const clean = String(value || "").trim();
    if (clean) {
      node.setAttribute(name, clean);
      return;
    }
    node.removeAttribute(name);
  }

  function applyCardDataAttributes(node, card, kind) {
    if (!node) {
      return;
    }
    setDataAttribute(node, "data-card-kind", kind || "reply");
    setDataAttribute(node, "data-card-id", card?.card_id || "");
    setDataAttribute(node, "data-card-session-id", cardSessionId(card));
    setDataAttribute(node, "data-card-thread-id", cardThreadId(card));
    if (card?.pending_outbound) {
      setDataAttribute(node, "data-card-pending-state", card?.pending_state || "sending");
      return;
    }
    node.removeAttribute("data-card-pending-state");
  }

  function applyCardActionData(node, action, card, kind = "") {
    applyCardDataAttributes(node, card, kind || (card?.pending_outbound ? "pending_outbound" : "reply"));
    setDataAttribute(node, "data-card-action", action);
  }

  function applyDetailDataAttributes(panel, detailType, card, extra = {}) {
    if (!panel) {
      return;
    }
    setDataAttribute(panel, "data-detail-type", detailType || "");
    setDataAttribute(panel, "data-detail-card-id", card?.card_id || "");
    setDataAttribute(panel, "data-detail-session-id", cardSessionId(card));
    setDataAttribute(panel, "data-detail-thread-id", cardThreadId(card));
    setDataAttribute(panel, "data-detail-viewer", extra.viewer || "");
  }

  function clearDetailDataAttributes(panel) {
    if (!panel) {
      return;
    }
    [
      "data-detail-type",
      "data-detail-card-id",
      "data-detail-session-id",
      "data-detail-thread-id",
      "data-detail-viewer"
    ].forEach(name => panel.removeAttribute(name));
  }

  function threadScopeForCard(card, sourceSurface) {
    const origin = cardOrigin(card);
    const threadId = String(origin.thread_id || "").trim();
    if (!threadId) {
      return null;
    }
    return normalizeThreadScope({
      mode: "existing_thread",
      thread_id: threadId,
      card_id: String(card?.card_id || ""),
      session_id: cardSessionId(card),
      source_surface: sourceSurface
    });
  }

  function desiredThreadScope() {
    if (!usesHomeFeedRoute()) {
      return initialThreadScope();
    }
    const detail = normalizeNavDetail(state.navDetail);
    if (detail) {
      const card = resolveNavDetailCard(detail);
      if (card) {
        if (detail.type === "transcript") {
          return threadScopeForCard(card, "thread_transcript") || initialThreadScope();
        }
        if (detail.type === "page") {
          return threadScopeForCard(card, "thread_page") || initialThreadScope();
        }
        if (["attachment", "images", "audio"].includes(detail.type)) {
          return threadScopeForCard(card, "thread_attachment") || initialThreadScope();
        }
      }
    }
    const focusedCard = findFocusedCard();
    if (focusedCard) {
      return threadScopeForCard(focusedCard, "feed_tile_selected") || initialThreadScope();
    }
    return initialThreadScope();
  }

  function sameThreadScope(left, right) {
    return String(left?.mode || "") === String(right?.mode || "")
      && String(left?.thread_id || "") === String(right?.thread_id || "")
      && String(left?.card_id || "") === String(right?.card_id || "")
      && String(left?.session_id || "") === String(right?.session_id || "")
      && String(left?.source_surface || "") === String(right?.source_surface || "");
  }

  let threadScopeSyncTail = Promise.resolve();

  function syncVoiceThreadScope(options = {}) {
    const task = threadScopeSyncTail.catch(() => {}).then(async () => {
      const desired = desiredThreadScope();
      if (!options.force && sameThreadScope(state.threadScope, desired)) {
        if (options.render !== false) {
          renderThreadScopeBadge();
        }
        return state.threadScope;
      }
      try {
        state.threadScope = normalizeThreadScope(
          desired.active
            ? await Pucky.request({ command: "voice.thread_scope.set", args: desired })
            : await Pucky.request({ command: "voice.thread_scope.clear", args: { reason: String(options.reason || "") } })
        );
      } catch (_) {
        state.threadScope = desired;
      }
      if (options.render !== false) {
        renderThreadScopeBadge();
      }
      return state.threadScope;
    });
    threadScopeSyncTail = task.catch(() => {});
    return task;
  }

  function findCardBySessionId(sessionId) {
    const target = String(sessionId || "");
    return target ? feedDisplayCards().find(card => cardSessionId(card) === target) || null : null;
  }

  function findCardByPlayer(player) {
    if (!playerHasAudioIdentity(player)) {
      return null;
    }
    return feedDisplayCards().find(card => isSameAudioCard(player, card)) || null;
  }

  function findCardByIdentity(sourceCard) {
    const cardId = String(sourceCard && sourceCard.card_id || "");
    const sessionId = cardSessionId(sourceCard);
    return state.cards.find(card => {
      const sameCard = cardId && String(card && card.card_id || "") === cardId;
      const sameSession = sessionId && cardSessionId(card) === sessionId;
      return sameCard || sameSession;
    }) || null;
  }

  function findCardByThreadId(threadId) {
    const target = String(threadId || "").trim();
    return target ? feedDisplayCards().find(card => cardThreadId(card) === target) || null : null;
  }

  function findFocusedCard() {
    const focusedSessionId = String(state.openCardMenuSessionId || "");
    const direct = focusedSessionId ? findCardBySessionId(focusedSessionId) : null;
    if (direct) {
      return direct;
    }
    const focusedThreadId = String(state.openCardMenuThreadId || "").trim();
    return focusedThreadId ? findCardByThreadId(focusedThreadId) : null;
  }

  function reconcileFocusedCardSelection() {
    if (!state.openCardMenuSessionId && !state.openCardMenuThreadId) {
      return;
    }
    const direct = findCardBySessionId(state.openCardMenuSessionId);
    if (direct) {
      state.openCardMenuThreadId = cardThreadId(direct);
      return;
    }
    const fallback = findCardByThreadId(state.openCardMenuThreadId);
    if (fallback) {
      state.openCardMenuSessionId = cardSessionId(fallback);
      state.openCardMenuThreadId = cardThreadId(fallback);
      return;
    }
    state.openCardMenuSessionId = "";
    state.openCardMenuThreadId = "";
  }

  function rememberFeedScroll() {
    const feed = document.getElementById("feed");
    if (feed && usesHomeFeedRoute()) {
      state.feedScrollTop = scrollNumber(feed.scrollTop);
    }
  }

  function restoreFeedScroll() {
    if (usesHomeFeedRoute()) {
      restoreScrollPosition(document.getElementById("feed"), state.feedScrollTop);
    }
  }

  function captureCurrentDetailScroll() {
    if (!state.navDetail) {
      return;
    }
    const panel = document.getElementById("detail");
    if (!panel || !panel.classList.contains("is-open")) {
      return;
    }
    const content = panel.querySelector(".detail-content");
    if (!content) {
      return;
    }
    state.navDetail = {
      ...state.navDetail,
      scroll_top: scrollNumber(content.scrollTop)
    };
    const timestamps = content.querySelector(".timestamp-list");
    if (state.navDetail.type === "audio" && timestamps) {
      state.navDetail.timestamp_scroll_top = scrollNumber(timestamps.scrollTop);
    }
    const imageTrack = content.querySelector(".image-gallery-track");
    if ((state.navDetail.type === "images" || state.navDetail.type === "attachment") && imageTrack) {
      state.navDetail.image_index = currentImageGalleryIndex(imageTrack);
    }
  }

  function persistNavState() {
    try {
      rememberFeedScroll();
      captureCurrentDetailScroll();
      localStorage.setItem(NAV_STATE_KEY, JSON.stringify({
        route: state.route,
        light_history: normalizeLightRouteHistory(state.lightRouteHistory),
        selected_contact_id: state.selectedContactId || null,
        selected_task_id: state.selectedTaskId || null,
        selected_project_id: state.selectedProjectId || null,
        task_sections_expanded: initialTaskSectionsExpanded(state.taskSectionsExpanded),
        feed_scroll_top: state.feedScrollTop,
        detail: normalizeNavDetail(state.navDetail),
        updated_at: Date.now()
      }));
    } catch (_) {
      // Navigation restore is a convenience layer; the UI should keep working without storage.
    }
  }

  function rememberNavDetail(type, card, options = {}) {
    const sessionId = cardSessionId(card);
    if (!sessionId) {
      state.navDetail = null;
      persistNavState();
      return;
    }
    state.navDetail = normalizeNavDetail({
      type,
      session_id: sessionId,
      thread_id: cardThreadId(card),
      scroll_top: options.scrollTop ?? options.scroll_top,
      timestamp_scroll_top: options.timestampScrollTop ?? options.timestamp_scroll_top,
      image_index: options.imageIndex ?? options.image_index
    });
    persistNavState();
  }

  function installFeedScrollPersistence() {
    const feed = document.getElementById("feed");
    if (!feed || feed.dataset.navScrollBound) {
      return;
    }
    feed.dataset.navScrollBound = "true";
    feed.addEventListener("scroll", debounce(() => {
      rememberFeedScroll();
      persistNavState();
    }, 120), { passive: true });
  }

  function installFeedSyncLoop() {
    if (feedSyncIntervalId) {
      return;
    }
    feedSyncIntervalId = window.setInterval(() => {
      if (document.visibilityState !== "visible" || state.route !== "inbox") {
        return;
      }
      syncFeedCards({ reason: "feed_visible_poll", silent: true, render: true });
    }, FEED_SYNC_INTERVAL_MS);
  }

  function installDetailScrollPersistence(content, type) {
    if (!content || content.dataset.navScrollBound) {
      return;
    }
    content.dataset.navScrollBound = "true";
    const save = debounce(() => {
      if (!state.navDetail || state.navDetail.type !== type) {
        return;
      }
      captureCurrentDetailScroll();
      persistNavState();
    }, 120);
    content.addEventListener("scroll", save, { passive: true });
    const timestamps = content.querySelector(".timestamp-list");
    if (timestamps) {
      timestamps.addEventListener("scroll", save, { passive: true });
    }
    const imageTrack = content.querySelector(".image-gallery-track");
    if (imageTrack) {
      imageTrack.addEventListener("scroll", save, { passive: true });
    }
  }

  function currentImageGalleryIndex(track) {
    if (!track || !track.children.length) {
      return 0;
    }
    const scrollLeft = Number(track.scrollLeft || 0);
    let bestIndex = 0;
    let bestDistance = Infinity;
    Array.from(track.children).forEach((child, index) => {
      const distance = Math.abs(Number(child.offsetLeft || 0) - scrollLeft);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestIndex = index;
      }
    });
    return bestIndex;
  }

  function installOneSlidePager(track) {
    if (!track || track.dataset.oneSlidePagerBound) {
      return;
    }
    track.dataset.oneSlidePagerBound = "true";
    let startX = 0;
    let startY = 0;
    let startLeft = 0;
    let startIndex = 0;
    let startTime = 0;
    let lastX = 0;
    let lastTime = 0;
    let velocityX = 0;
    let settleRaf = 0;
    let active = false;
    let horizontal = false;
    const stopSettle = () => {
      if (settleRaf) {
        cancelAnimationFrame(settleRaf);
        settleRaf = 0;
      }
      track.classList.remove("is-touch-settling");
    };
    const reset = () => {
      active = false;
      horizontal = false;
      track.classList.remove("is-touch-paging", "is-touch-settling");
    };
    const easeOutCubic = value => 1 - Math.pow(1 - value, 3);
    const settleDurationFor = (distance, speed) => {
      const base = distance > 180 ? 172 : 138;
      const velocityBoost = Math.min(46, Math.abs(speed) * 82);
      return Math.max(108, Math.round(base - velocityBoost));
    };
    const animateTo = (targetLeft, speed = 0, onComplete = reset) => {
      stopSettle();
      const fromLeft = Number(track.scrollLeft || 0);
      const distance = targetLeft - fromLeft;
      if (Math.abs(distance) < 1) {
        track.scrollLeft = targetLeft;
        onComplete();
        return;
      }
      const duration = settleDurationFor(Math.abs(distance), speed);
      const startedAt = performance.now();
      track.classList.add("is-touch-paging", "is-touch-settling");
      const step = now => {
        const elapsed = Math.min(1, (now - startedAt) / duration);
        track.scrollLeft = fromLeft + distance * easeOutCubic(elapsed);
        if (elapsed < 1) {
          settleRaf = requestAnimationFrame(step);
          return;
        }
        settleRaf = 0;
        track.scrollLeft = targetLeft;
        onComplete();
      };
      settleRaf = requestAnimationFrame(step);
    };
    const snapTo = (index, options = {}) => {
      const clamped = Math.max(0, Math.min(track.children.length - 1, index));
      const slide = track.children[clamped];
      if (slide) {
        const targetLeft = Number(slide.offsetLeft || 0);
        if (options.animate === false) {
          stopSettle();
          track.scrollLeft = targetLeft;
          reset();
          return;
        }
        animateTo(targetLeft, options.velocity || 0, options.onComplete || reset);
      }
    };
    track.addEventListener("touchstart", event => {
      if (event.touches.length !== 1 || !track.children.length) {
        return;
      }
      stopSettle();
      const touch = event.touches[0];
      startX = touch.clientX;
      startY = touch.clientY;
      startLeft = Number(track.scrollLeft || 0);
      startIndex = currentImageGalleryIndex(track);
      startTime = performance.now();
      lastX = startX;
      lastTime = startTime;
      velocityX = 0;
      active = true;
      horizontal = false;
    }, { passive: true });
    track.addEventListener("touchmove", event => {
      if (!active || event.touches.length !== 1) {
        return;
      }
      const touch = event.touches[0];
      const now = performance.now();
      const dx = touch.clientX - startX;
      const dy = touch.clientY - startY;
      if (!horizontal && Math.abs(dx) < 8 && Math.abs(dy) < 8) {
        return;
      }
      if (!horizontal && Math.abs(dy) > Math.abs(dx)) {
        reset();
        return;
      }
      horizontal = true;
      track.classList.add("is-touch-paging");
      event.preventDefault();
      track.scrollLeft = startLeft - dx;
      const dt = Math.max(1, now - lastTime);
      velocityX = (touch.clientX - lastX) / dt;
      lastX = touch.clientX;
      lastTime = now;
    }, { passive: false });
    track.addEventListener("touchend", event => {
      if (!active) {
        return;
      }
      const changed = event.changedTouches && event.changedTouches[0];
      const dx = changed ? changed.clientX - startX : startLeft - Number(track.scrollLeft || 0);
      if (!horizontal) {
        snapTo(currentImageGalleryIndex(track), { animate: false });
        return;
      }
      const elapsed = Math.max(1, performance.now() - startTime);
      const averageVelocity = dx / elapsed;
      const releaseVelocity = Math.abs(velocityX) > Math.abs(averageVelocity) ? velocityX : averageVelocity;
      const threshold = Math.min(82, Math.max(28, track.clientWidth * 0.11));
      const flick = Math.abs(releaseVelocity) >= 0.32 && Math.abs(dx) >= 16;
      const direction = Math.abs(dx) >= threshold || flick ? (dx < 0 ? 1 : -1) : 0;
      snapTo(startIndex + direction, { velocity: releaseVelocity });
    }, { passive: true });
    track.addEventListener("touchcancel", () => {
      if (active) {
        snapTo(startIndex, { velocity: velocityX });
      }
    }, { passive: true });
  }

  function restoreScrollPosition(target, scrollTop) {
    if (!target) {
      return;
    }
    const top = scrollNumber(scrollTop);
    requestAnimationFrame(() => {
      target.scrollTop = top;
    });
  }

  function restoreTimestampScroll(content, scrollTop) {
    const timestamps = content?.querySelector(".timestamp-list");
    restoreScrollPosition(timestamps, scrollTop);
  }

  function restoreNavStateAfterCards() {
    if (state.navRestored) {
      return;
    }
    state.navRestored = true;
    restoreFeedScroll();
    if (!usesHomeFeedRoute()) {
      state.navDetail = null;
      persistNavState();
      void syncVoiceThreadScope({ reason: "restore_nav_non_feed", render: true });
      return;
    }
    const detail = normalizeNavDetail(state.navDetail);
    if (!detail) {
      persistNavState();
      void syncVoiceThreadScope({ reason: "restore_nav_empty", render: true });
      return;
    }
    const card = resolveNavDetailCard(detail);
    if (!card) {
      state.navDetail = null;
      persistNavState();
      void syncVoiceThreadScope({ reason: "restore_nav_missing_card", render: true });
      return;
    }
    if (detail.type === "audio" && hasAudio(card)) {
      showAudioDetail(card, { restoring: true, scrollTop: detail.scroll_top, timestampScrollTop: detail.timestamp_scroll_top });
      return;
    }
    if (detail.type === "transcript") {
      showTranscript(card, { restoring: true, scrollTop: detail.scroll_top });
      return;
    }
    if (detail.type === "page" && hasRichPage(card)) {
      showRichPage(card, { restoring: true, scrollTop: detail.scroll_top });
      return;
    }
    if (detail.type === "images") {
      showImageReel(card, null, { restoring: true, scrollTop: detail.scroll_top, initialIndex: detail.image_index });
      return;
    }
    if (detail.type === "attachment") {
      showAttachmentViewer(card, null, { restoring: true, scrollTop: detail.scroll_top, initialIndex: detail.image_index });
      return;
    }
    state.navDetail = null;
    persistNavState();
    void syncVoiceThreadScope({ reason: "restore_nav_fallback", render: true });
  }

  function debounce(callback, waitMs) {
    let timer = 0;
    return (...args) => {
      if (timer) {
        window.clearTimeout(timer);
      }
      timer = window.setTimeout(() => {
        timer = 0;
        callback(...args);
      }, waitMs);
    };
  }

  function loadFeedIconExcludes() {
    try {
      return new Set(JSON.parse(localStorage.getItem(FEED_ICON_EXCLUDES_KEY) || "[]"));
    } catch (_) {
      return new Set();
    }
  }

  function normalizeHomeMenuIconEntry(entry) {
    if (!entry || typeof entry !== "object") {
      return null;
    }
    const key = String(entry.key || entry.icon || "").toLowerCase().trim();
    const icon = String(entry.icon || entry.key || "").toLowerCase().trim();
    if (!/^[a-z0-9_]{1,48}$/.test(key) || !/^[a-z0-9_]{1,48}$/.test(icon)) {
      return null;
    }
    const label = String(entry.label || `${key} replies`).trim() || `${key} replies`;
    const accent = String(entry.accent || "#f5f9ff").trim() || "#f5f9ff";
    return { key, icon, label, accent };
  }

  function loadHomeMenuIconLibrary() {
    const merged = [];
    const seen = new Set();
    const append = (entry) => {
      const normalized = normalizeHomeMenuIconEntry(entry);
      if (!normalized || seen.has(normalized.key)) {
        return;
      }
      seen.add(normalized.key);
      merged.push(normalized);
    };
    DEFAULT_HOME_MENU_ICONS.forEach(append);
    try {
      const parsed = JSON.parse(localStorage.getItem(HOME_MENU_ICON_LIBRARY_KEY) || "[]");
      if (Array.isArray(parsed)) {
        parsed.forEach(append);
      }
    } catch (_) {
      // Fall back to the bundled defaults when stored icon preferences are unavailable.
    }
    return merged;
  }

  function persistHomeMenuIconLibrary() {
    try {
      localStorage.setItem(HOME_MENU_ICON_LIBRARY_KEY, JSON.stringify(state.homeMenuIconLibrary));
    } catch (_) {
      // Home menu icon preferences are convenience state; default icons remain safe.
    }
  }

  function ensureStoredHomeMenuIcons() {
    const normalized = loadHomeMenuIconLibrary();
    let stored = "";
    try {
      stored = String(localStorage.getItem(HOME_MENU_ICON_LIBRARY_KEY) || "");
    } catch (_) {
      stored = "";
    }
    if (stored && JSON.stringify(normalized) === JSON.stringify(state.homeMenuIconLibrary)) {
      return;
    }
    state.homeMenuIconLibrary = normalized;
    persistHomeMenuIconLibrary();
  }

  function persistFeedIconExcludes() {
    try {
      localStorage.setItem(FEED_ICON_EXCLUDES_KEY, JSON.stringify(Array.from(state.excludedFeedIcons)));
    } catch (_) {
      // Feed filters are convenience state; the default all-included feed is safe.
    }
  }

  function loadAudioState() {
    try {
      const parsed = JSON.parse(localStorage.getItem(AUDIO_STATE_KEY) || "{}");
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch (_) {
      return {};
    }
  }

  function numberMapFromObject(value) {
    const entries = value && typeof value === "object" ? Object.entries(value) : [];
    return new Map(entries
      .map(([key, item]) => [normalizePath(key), Number(item)])
      .filter(([, item]) => Number.isFinite(item)));
  }

  function stringMapFromObject(value) {
    const entries = value && typeof value === "object" ? Object.entries(value) : [];
    return new Map(entries.map(([key, item]) => [normalizePath(key), String(item || "")]));
  }

  function objectFromMap(map) {
    return Object.fromEntries(Array.from(map.entries()).filter(([key]) => key));
  }

  function cardSessionKey(card) {
    return String(card?.session_id || card?.card_id || "").trim();
  }

  function loadReadOverrides() {
    try {
      const parsed = JSON.parse(localStorage.getItem(READ_OVERRIDES_KEY) || "{}");
      const entries = parsed && typeof parsed === "object" ? Object.entries(parsed) : [];
      return new Map(entries
        .map(([key, value]) => [String(key || "").trim(), Boolean(value)])
        .filter(([key]) => key));
    } catch (_) {
      return new Map();
    }
  }

  function persistReadOverrides() {
    try {
      localStorage.setItem(READ_OVERRIDES_KEY, JSON.stringify(objectFromMap(state.readOverrides)));
    } catch (_) {
      // Manual read-state toggles are convenience state; card data still renders without them.
    }
  }

  function readOverrideForCard(card) {
    const sessionId = cardSessionKey(card);
    if (!sessionId || !state.readOverrides.has(sessionId)) {
      return null;
    }
    return Boolean(state.readOverrides.get(sessionId));
  }

  function setCardReadOverride(card, read) {
    const sessionId = cardSessionKey(card);
    if (!sessionId) {
      return;
    }
    state.readOverrides.set(sessionId, Boolean(read));
    persistReadOverrides();
  }

  function reconcileReadOverrides() {
    let changed = false;
    const liveSessions = new Set(state.cards.map(cardSessionKey).filter(Boolean));
    for (const sessionId of Array.from(state.readOverrides.keys())) {
      if (!liveSessions.has(sessionId)) {
        state.readOverrides.delete(sessionId);
        changed = true;
      }
    }
    state.cards.forEach(card => {
      const sessionId = cardSessionKey(card);
      if (!sessionId || !state.readOverrides.has(sessionId)) {
        return;
      }
      if (Boolean(state.readOverrides.get(sessionId)) === Boolean(card.read)) {
        state.readOverrides.delete(sessionId);
        changed = true;
      }
    });
    if (changed) {
      persistReadOverrides();
    }
  }

  function persistAudioState() {
    try {
      localStorage.setItem(AUDIO_STATE_KEY, JSON.stringify({
        positions: objectFromMap(state.savedPositions),
        speeds: objectFromMap(state.speedByPath),
        completed: Array.from(state.completedPaths),
        selected_timestamps: objectFromMap(state.selectedTimestampByPath)
      }));
    } catch (_) {
      // Audio resume state is opportunistic; playback should continue without storage.
    }
  }

  function finiteSpeed(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? clampSpeed(parsed) : null;
  }

  function clampSpeed(value) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
      return 1;
    }
    return Math.max(MIN_PLAYBACK_SPEED, Math.min(MAX_PLAYBACK_SPEED, parsed));
  }

  function formatSpeed(speed) {
    return `${Number(clampSpeed(speed).toFixed(2)).toString()}x`;
  }

  function normalizeIcon(icon) {
    const value = String(icon || "").toLowerCase();
    return MATERIAL_SYMBOLS[value] ? value : "mail";
  }

  function applyLocalFeedAction(cards, sourceCard, action) {
    const sourceCardId = String(sourceCard && sourceCard.card_id || "");
    const sourceSessionId = cardSessionId(sourceCard);
    return (Array.isArray(cards) ? cards : [])
      .map(card => {
        const same = (sourceCardId && String(card && card.card_id || "") === sourceCardId)
          || (!sourceCardId && sourceSessionId && cardSessionId(card) === sourceSessionId);
        if (!same) {
          return card;
        }
        if (action === "archive") {
          return { ...card, archived: true };
        }
        if (action === "unarchive") {
          return { ...card, archived: false };
        }
        if (action === "mark_read") {
          return { ...card, read: true };
        }
        if (action === "delete") {
          return { ...card, deleted: true };
        }
        return card;
      })
      .filter(card => !card.deleted);
  }

  function iconSvg(icon, options = {}) {
    const name = normalizeIcon(icon);
    const filled = options.filled !== false;
    const className = options.className || "material-icon";
    const symbol = MATERIAL_SYMBOLS[name] || MATERIAL_SYMBOLS.mail;
    const paths = filled ? (symbol.filled || symbol.outline) : (symbol.outline || symbol.filled);
    return `<svg class="${className}" viewBox="0 0 24 24" aria-hidden="true">${paths}</svg>`;
  }

  function normalizeReplyCardIcon(icon) {
    const value = String(icon || "").toLowerCase().trim();
    if (!/^[a-z0-9_]{1,48}$/.test(value)) {
      return "mail";
    }
    if (state.cardIconRegistry[value] || MATERIAL_SYMBOLS[value]) {
      return value;
    }
    scheduleCardIconRegistryRefresh();
    return "mail";
  }

  function replyCardIconSvg(icon, options = {}) {
    const name = normalizeReplyCardIcon(icon);
    const symbol = state.cardIconRegistry[name] || MATERIAL_SYMBOLS[name] || MATERIAL_SYMBOLS.mail;
    const filled = options.filled !== false;
    const className = options.className || "material-icon";
    const paths = filled ? (symbol.filled || symbol.filled_svg || symbol.outline || symbol.outline_svg) : (symbol.outline || symbol.outline_svg || symbol.filled || symbol.filled_svg);
    return `<svg class="${className}" viewBox="0 0 24 24" aria-hidden="true">${paths}</svg>`;
  }

  function feedIdentityIconName(card) {
    const name = normalizeReplyCardIcon(card?.icon);
    if (hasAudio(card) && ["mic", "keyboard_voice", "graphic_eq", "radio"].includes(name)) {
      return "mail";
    }
    return name;
  }

  function scheduleCardIconRegistryRefresh() {
    if (state.cardIconRegistryLoading) {
      return;
    }
    const age = Date.now() - Number(state.cardIconRegistryRequestedAt || 0);
    if (age < 1500) {
      return;
    }
    state.cardIconRegistryRequestedAt = Date.now();
    Promise.resolve().then(() => loadCardIconRegistry({ render: true, force: true })).catch(() => {});
  }

  async function loadCardIconRegistry(options = {}) {
    if (state.cardIconRegistryLoading) {
      return;
    }
    state.cardIconRegistryLoading = true;
    try {
      const payload = await fetchCardIconRegistry();
      const next = {};
      const icons = Array.isArray(payload?.icons) ? payload.icons : [];
      icons.forEach((icon) => {
        const name = String(icon?.name || "").toLowerCase().trim();
        if (!/^[a-z0-9_]{1,48}$/.test(name)) {
          return;
        }
        const filled = String(icon?.filled_svg || "").trim();
        const outline = String(icon?.outline_svg || "").trim();
        if (!filled && !outline) {
          return;
        }
        next[name] = {
          filled: filled || outline,
          outline: outline || filled
        };
      });
      state.cardIconRegistry = next;
    } catch (_) {
      // Keep bundled icons if the runtime registry is temporarily unavailable.
    } finally {
      state.cardIconRegistryLoading = false;
      if (options.render) {
        render();
      }
    }
  }

  async function fetchCardIconRegistry() {
    const response = await fetch(`${linksApiBaseUrl()}/api/card-icons`, { cache: "no-store" });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(String(payload?.detail || payload?.error || `Card icon registry failed (${response.status})`));
    }
    return payload;
  }

  function formatTime(ms) {
    const total = Math.max(0, Math.round(Number(ms || 0) / 1000));
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const seconds = total % 60;
    if (hours > 0) {
      return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
    }
    return `${minutes}:${String(seconds).padStart(2, "0")}`;
  }

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function showToast(message) {
    const text = String(message || "").trim();
    if (!text) {
      return;
    }
    state.lastToast = {
      message: text,
      shown_at: new Date().toISOString()
    };
    recordAudioProbeEvent("toast", {
      message: text,
      target_key: state.audioProbe.target_key
    });
    console.warn(text);
  }

  setInterval(async () => {
    if (document.visibilityState !== "visible") {
      return;
    }
    let changed = false;
    try {
      const now = Date.now();
      const turnInterval = turnStatusPollIntervalMs(state.route);
      if ((now - lastTurnStatusPollAt) >= turnInterval) {
        recordPerfPollTick("turn_status");
        lastTurnStatusPollAt = now;
        const wasTurnActive = isTurnActive(state.turn);
        const turnChanged = await loadTurnStatus({ render: false });
        const turnActive = isTurnActive(state.turn);
        if (state.route === "inbox" && (turnActive || wasTurnActive)) {
          await refreshCardsFromVmSnapshot({ render: false });
        }
        changed = changed || turnChanged || turnActive || wasTurnActive;
      }
      if (state.activePath && (now - lastPlayerStatePollAt) >= PLAYER_STATE_POLL_INTERVAL_MS) {
        recordPerfPollTick("player_state");
        lastPlayerStatePollAt = now;
        const previousPlayer = state.player;
        state.player = stampPlayerState(await Pucky.request({ command: "player.state", args: {} }));
        syncActivePathFromPlayer(state.player);
        if (state.player.path) {
          rememberPlayerProgress(state.player);
        }
        const audioProbeChanged = syncAudioProbeFromPlayerState(previousPlayer, state.player);
        changed = changed || shouldRenderForPlayerState(previousPlayer, state.player) || audioProbeChanged;
      }
      if ((wakeProofVisualState(state.wakeStatus) !== "idle" || state.route === "settings")
          && (now - lastWakeStatusPollAt) >= TURN_STATUS_LIVE_ROUTE_INTERVAL_MS) {
        recordPerfPollTick("wake_status");
        lastWakeStatusPollAt = now;
        changed = (await loadWakeStatus({ render: false })) || changed;
      }
      if (changed) {
        requestRender("visible_poll");
      }
    } catch (_) {
      // Keep cached state visible if the bridge temporarily fails.
    }
  }, TURN_STATUS_POLL_MS);

  setInterval(() => {
    if (shouldAnimateActiveTileAudio()) {
      render();
    }
  }, 90);

  setInterval(() => {
    if (shouldTickReminderLiveUi(state.route, Date.now())) {
      requestRender("reminder_live_ui_tick");
    }
  }, REMINDER_LIVE_UI_TICK_MS);

  setInterval(() => {
    if (document.visibilityState === "visible") {
      const interval = meetingStatusPollIntervalMs(state.route);
      if (!interval) {
        return;
      }
      const now = Date.now();
      if ((now - lastMeetingStatusPollAt) < interval) {
        return;
      }
      recordPerfPollTick("meeting_status");
      lastMeetingStatusPollAt = now;
      void refreshMeetingRecordingStatus({ render: true });
    }
  }, MEETING_STATUS_POLL_MS);

  setInterval(() => {
    if (document.visibilityState === "visible"
        && (state.route === "tasks" || state.route === "task-detail")
        && workspaceBucketNeedsRefresh("tasks", WORKSPACE_TASK_STALE_VISIBLE_MS)) {
      recordPerfPollTick("workspace_tasks_visible");
      void loadWorkspaceCollection("tasks", {
        render: true,
        force: true,
        reason: "visible_stale"
      });
    }
  }, WORKSPACE_REFRESH_TICK_MS);

  setInterval(() => {
    if (document.visibilityState === "visible"
        && (state.route === "home" || state.route === "reminders" || state.route === "reminder-detail")
        && workspaceBucketNeedsRefresh("reminders", WORKSPACE_REMINDER_STALE_VISIBLE_MS)) {
      recordPerfPollTick("workspace_reminders_visible");
      void loadWorkspaceCollection("reminders", {
        render: true,
        renderWhenUnchanged: true,
        force: true,
        reason: "visible_stale"
      });
    }
  }, WORKSPACE_REFRESH_TICK_MS);

  window.addEventListener("pagehide", persistNavState);
  let previousTaskSplitLayout = taskUsesSplitLayout();
  window.addEventListener("resize", debounce(() => {
    const nextTaskSplitLayout = taskUsesSplitLayout();
    if (nextTaskSplitLayout === previousTaskSplitLayout) {
      return;
    }
    previousTaskSplitLayout = nextTaskSplitLayout;
    if (state.route === "tasks" || state.route === "task-detail") {
      if (nextTaskSplitLayout && state.route === "task-detail") {
        state.route = "tasks";
      }
      persistNavState();
      render();
    }
  }, 120));
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      if (state.links.handoffLocked) {
        linksDebugRecord("document_hidden", { slug: String(state.links.openingSlug || "") }, "click");
        releaseLinksHandoff({ render: false, reason: "document_hidden" });
      }
      void flushRoutePerfTelemetry("pagehide");
      persistNavState();
      return;
    }
    if (state.route === "inbox") {
      syncFeedCards({ reason: "visibility_visible", silent: true, render: true });
      return;
    }
    if (state.route === "connect") {
      refreshLinksConnectedSoon({ render: true, force: true });
      return;
    }
    if (state.route === "meetings") {
      refreshMeetingRecordingStatus({ render: true });
      loadMeetings({ render: true, reason: "visibility_visible" });
      return;
    }
    if (state.route === "settings") {
      loadSettingsState({ render: true });
      return;
    }
    if (state.route === "home") {
      if (workspaceBucketNeedsRefresh("reminders", WORKSPACE_REMINDER_STALE_VISIBLE_MS)) {
        void loadWorkspaceCollection("reminders", {
          render: true,
          renderWhenUnchanged: true,
          force: true,
          reason: "visibility_visible"
        });
      }
      return;
    }
    if (state.route === "task-detail") {
      if (workspaceBucketNeedsRefresh("tasks", WORKSPACE_TASK_STALE_VISIBLE_MS)) {
        void loadWorkspaceCollection("tasks", { render: true, force: true, reason: "visibility_visible" });
      }
      return;
    }
    void loadWorkspaceForRoute(state.route, { render: true, force: true, reason: "visibility_visible" });
  });

  function runBootRouteSideEffects() {
    const route = String(state.route || "home").trim() || "home";
    const hasNativeBootstrap = hasNativeBootstrapBridge();
    const bootstrapTask = hasNativeBootstrap
      ? loadNativeBootstrapSnapshot({ render: route === "settings" }).catch(() => null)
      : Promise.resolve(null);
    setPerfBootPhase("boot_critical_dispatch");
    void syncVoiceThreadScope({ reason: "boot", render: true });
    if (route === "connect") {
      linksDebugStartSession("route", { reason: "boot_route" });
      linksDebugRecord("links_route_enter", { reason: "boot_route" }, "route");
      void bootstrapTask.then(() => loadLinksPortal({ render: true }));
    } else if (route === "meetings") {
      loadTurnStatus({ render: false });
      refreshMeetingRecordingStatus({ render: true });
      loadMeetings({ render: true, reason: "boot" });
    } else if (route === "settings") {
      loadSettingsState({ render: false, ensureSurface: true });
    } else if (route === "inbox") {
      loadTurnStatus({ render: false });
      loadCardIconRegistry({ render: false });
      loadCards();
    } else if (route !== "home" && WORKSPACE_ROUTE_COLLECTIONS[route]) {
      void loadWorkspaceForRoute(route, { render: true, force: true, reason: "boot" });
    }
    queueDeferredPerfTask("boot:home:reminders", async () => {
      if (route === "home") {
        await loadWorkspaceCollection("reminders", { render: true, force: true, reason: "boot_deferred" });
      }
    }, { delayMs: PERF_DEFERRED_TASK_DELAY_MS });
    queueDeferredPerfTask("boot:ambient:turn_status", async () => {
      if (route !== "inbox" && route !== "meetings") {
        await loadTurnStatus({ render: false });
      }
    }, { delayMs: PERF_DEFERRED_TASK_DELAY_MS });
    if (!hasNativeBootstrap) {
      queueDeferredPerfTask("boot:ambient:ui_surface", () => loadUiSurfaceStatus({ render: false }), {
        delayMs: PERF_DEFERRED_TASK_DELAY_MS * 2
      });
      queueDeferredPerfTask("boot:ambient:turn_settings", () => loadTurnSettings({ render: false }), {
        delayMs: PERF_DEFERRED_TASK_DELAY_MS * 2
      });
      queueDeferredPerfTask("boot:ambient:default_audio_speed", () => loadDefaultAudioSpeed({ render: false }), {
        delayMs: PERF_DEFERRED_TASK_DELAY_MS * 2
      });
      if (route !== "settings") {
        queueDeferredPerfTask("boot:ambient:phone_role", () => loadPhoneRoleStatus({ render: false }), {
          delayMs: PERF_DEFERRED_TASK_DELAY_MS * 3
        });
        queueDeferredPerfTask("boot:ambient:wake_status", () => loadWakeStatus({ render: false }), {
          delayMs: PERF_DEFERRED_TASK_DELAY_MS * 3
        });
      }
    }
    if (route !== "inbox") {
      queueDeferredPerfTask("boot:idle:feed", () => loadCards(), {
        delayMs: PERF_DEFERRED_TASK_DELAY_MS * 5
      });
    }
    setPerfBootPhase("boot_deferred_queued");
  }

  window.PuckyHandleAndroidBack = handleAndroidBack;
  window.PuckyUiDebug = {
    describe: describeUiSurface,
    dispatch: uiDebugDispatch,
    linksMetrics: linksDebugMetrics,
    perfMetrics: perfDebugMetrics
  };
  syncThemeQueryParam(state.theme);
  syncRouteQueryParam(state.route);
  render();
  setPerfBootPhase("initial_render");
  syncPerfDebugState("boot");
  installFeedScrollPersistence();
  installFeedSyncLoop();
  installCardMenuOutsideDismiss();
  installArchiveRevealOutsideDismiss();
  runBootRouteSideEffects();
})();
