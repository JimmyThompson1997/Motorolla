(() => {
  const FEED_ICON_EXCLUDES_KEY = "pucky.cover.feed_icon_excludes.v1";
  const HOME_MENU_ICON_LIBRARY_KEY = "pucky.cover.home_menu_icon_library.v1";
  const AUDIO_STATE_KEY = "pucky.cover.audio_state.v1";
  const NAV_STATE_KEY = "pucky.cover.nav_state.v1";
  const READ_OVERRIDES_KEY = "pucky.cover.read_overrides.v1";
  const THEME_STATE_KEY = "pucky.cover.theme.v1";
  const CALENDAR_TIMEZONE_STATE_KEY = "pucky.cover.calendar_timezone.v1";
  const BROWSER_API_TOKEN_STATE_KEY = "pucky.cover.browser_api_token.v1";
  const BROWSER_DEVICE_ID_STATE_KEY = "pucky.cover.browser_device_id.v1";
  const SELF_CONTACT_ID = "contact-me";
  const COMPLETE_EPSILON_MS = 500;
  const MOCK_STANDARD_DURATION_MS = 1000 * 60 * 19 + 57000;
  const MOCK_AUDIOBOOK_DURATION_MS = 69897450;
  const FEED_SYNC_INTERVAL_MS = 15000;
  const CARD_MENU_CLICK_SUPPRESS_MS = 550;
  const TURN_STATUS_POLL_MS = 250;
  const ARCHIVE_REVEAL_WIDTH_PX = 88;
  const ARCHIVE_REVEAL_OPEN_THRESHOLD_PX = 44;
  const ARCHIVE_REVEAL_SLOP_PX = 12;
  const ARCHIVE_REVEAL_DEBUG_STORAGE_KEY = "pucky.cover.archive_reveal_debug.v1";
  const ARCHIVE_REVEAL_DEBUG_TRACE_LIMIT = 160;
  const ARCHIVE_REVEAL_DEBUG_BADGE_RENDERING_ENABLED = false;
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
  const WORKSPACE_TASK_REFRESH_MS = 2000;
  const WORKSPACE_REMINDER_REFRESH_MS = 15000;
  const CALENDAR_GAP_THRESHOLD_MS = 90 * 60 * 1000;
  const CALENDAR_CLUSTER_WINDOW_MS = 15 * 60 * 1000;
  const TURN_UI_TIMELINE_MAX_EVENTS = 64;
  const SETTINGS_SURFACE_RELOAD_KEY = "pucky.cover.settings_surface_reload.v1";
  const DEFAULT_LINKS_API_BASE = "https://pucky.fly.dev";
  const TASK_SPLIT_MIN_WIDTH_PX = 900;
  const MIN_PLAYBACK_SPEED = 0.5;
  const MAX_PLAYBACK_SPEED = 3;
  const SPEED_OPTIONS = [0.75, 1, 1.25, 1.5, 2, 2.5, 3];
  const AUDIO_TILE_PHASES = ["idle", "starting", "playing_confirmed", "pause_pending", "start_failed", "ended_immediately"];
  const AUDIO_PROBE_EVENT_LIMIT = 48;
  const AUDIO_START_CONFIRMATION_TIMEOUT_MS = 1800;
  const AUDIO_EARLY_END_WINDOW_MS = 2000;
  const AUDIO_TERMINAL_RESET_MS = 1600;
  const DOT = " \u00b7 ";
  let calendarTimeZoneOptionsCache = null;
  const MATERIAL_SYMBOLS = {
    mail: {
      filled: '<path d="M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2Zm0 4-8 5-8-5V6l8 5 8-5v2Z"/>',
      outline: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m4.2 7 7.8 5.8L19.8 7"/><path d="m4.4 18 5.7-5.1"/><path d="m19.6 18-5.7-5.1"/>'
    },
    link: {
      filled: '<path d="M3.9 12a5 5 0 0 1 5-5H12v2H8.9a3 3 0 0 0 0 6H12v2H8.9a5 5 0 0 1-5-5Zm5.6 1v-2h5v2h-5Zm2.5 4h3.1a3 3 0 0 0 0-6H12V9h3.1a5 5 0 0 1 0 10H12v-2Z"/>',
      outline: '<path d="M10 8H8.8a4 4 0 0 0 0 8H10"/><path d="M14 8h1.2a4 4 0 0 1 0 8H14"/><path d="M9.5 12h5"/>'
    },
    bell: {
      filled: '<path d="M12 22a2.8 2.8 0 0 0 2.8-2.5H9.2A2.8 2.8 0 0 0 12 22Zm7-5-2-2v-5.2c0-3.1-1.7-5.6-4.5-6.3V2h-1v1.5C8.7 4.2 7 6.7 7 9.8V15l-2 2v1h14v-1Z"/>',
      outline: '<path d="M7 15V9.8c0-3 2-5.3 5-5.3s5 2.3 5 5.3V15l2 2H5l2-2Z"/><path d="M10 19.5h4"/><path d="M12 2v2.5"/>'
    },
    coffee: {
      filled: '<path d="M4 7h12v7.5A4.5 4.5 0 0 1 11.5 19h-3A4.5 4.5 0 0 1 4 14.5V7Zm12 2h2.5a2.5 2.5 0 0 1 0 5H16V9Zm0 2v1h2.5a.5.5 0 0 0 0-1H16ZM3 20h15v2H3v-2ZM7 2h1.5v3H7V2Zm4 0h1.5v3H11V2Z"/>',
      outline: '<path d="M4.5 7.5h11v7A4.5 4.5 0 0 1 11 19H9a4.5 4.5 0 0 1-4.5-4.5v-7Z"/><path d="M15.5 9h3a2.5 2.5 0 0 1 0 5h-3"/><path d="M3 20.5h15"/><path d="M7.5 2v3M12 2v3"/>'
    },
    clock: {
      filled: '<path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2Zm0 17c-3.86 0-7-3.14-7-7s3.14-7 7-7 7 3.14 7 7-3.14 7-7 7Zm1-12h-2v6l5 3 1-1.73-4-2.27V7Z"/>',
      outline: '<circle cx="12" cy="12" r="8.2"/><path d="M12 7.3v5.1l3.8 2.2"/>'
    },
    bolt: {
      filled: '<path d="M7 2h10l-3.2 7H20L9 22l2.3-8H5l2-12Z"/>',
      outline: '<path d="M13.5 2.8 5.7 13.2h5.7L9.9 21.2l8.4-10.4h-5.8l1-8Z"/>'
    },
    calendar: {
      filled: '<path d="M7 2h2v2h6V2h2v2h1c1.1 0 2 .9 2 2v14c0 1.1-.9 2-2 2H6c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2h1V2Zm11 8H6v10h12V10Z"/>',
      outline: '<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M8 3v4M16 3v4M4 10h16M8 14h3M13 14h3"/>'
    },
    moon: {
      filled: '<path d="M21 14.4C19.7 18.8 15.6 22 10.8 22 5.4 22 1 17.6 1 12.2 1 7.4 4.2 3.3 8.6 2c-.8 1.3-1.2 2.8-1.2 4.4 0 5.6 4.6 10.2 10.2 10.2 1.6 0 3.1-.4 4.4-1.2Z"/>',
      outline: '<path d="M20.8 14.8A8.8 8.8 0 1 1 9.2 3.2a7.3 7.3 0 0 0 11.6 11.6Z"/>'
    },
    book: {
      filled: '<path d="M4 5.5C4 4.67 4.67 4 5.5 4H11c.74 0 1.43.24 2 .65.57-.41 1.26-.65 2-.65h3.5c.83 0 1.5.67 1.5 1.5V19c0 .55-.45 1-1 1h-4c-.67 0-1.31.22-1.84.62-.1.08-.22.12-.35.12h-1.62c-.13 0-.25-.04-.35-.12C10.31 20.22 9.67 20 9 20H5c-.55 0-1-.45-1-1V5.5ZM6 6v12h3c.72 0 1.4.16 2 .45V6.25c-.31-.16-.65-.25-1-.25H6Zm7 .25v12.2c.6-.29 1.28-.45 2-.45h3V6h-3c-.35 0-.69.09-1 .25Z"/>',
      outline: '<path d="M5 5h5.2c1 0 1.8.3 2.8.9V20c-.9-.7-1.9-1-3-1H5V5Z"/><path d="M19 5h-4.2c-.9 0-1.8.3-2.8.9V20c.9-.7 1.9-1 3-1h4V5Z"/>'
    },
    chat: {
      filled: '<path d="M4 4h16c1.1 0 2 .9 2 2v10c0 1.1-.9 2-2 2H8l-5 4V6c0-1.1.9-2 2-2Z"/>',
      outline: '<path d="M5 5h14c1 0 1.8.8 1.8 1.8v8.4c0 1-.8 1.8-1.8 1.8H9l-5 4V6.8C4 5.8 4.8 5 5 5Z"/><path d="M8 9h8M8 12.5h6"/>'
    },
    attachment: {
      filled: '<path d="M16.5 6v11.5c0 2.21-1.79 4-4 4s-4-1.79-4-4V5c0-1.38 1.12-2.5 2.5-2.5s2.5 1.12 2.5 2.5v10.5c0 .55-.45 1-1 1s-1-.45-1-1V6H10v9.5c0 1.38 1.12 2.5 2.5 2.5s2.5-1.12 2.5-2.5V5c0-2.21-1.79-4-4-4S7 2.79 7 5v12.5c0 3.04 2.46 5.5 5.5 5.5s5.5-2.46 5.5-5.5V6h-1.5Z"/>',
      outline: '<path d="M16.5 6v11.5a4 4 0 0 1-8 0V5a2.5 2.5 0 0 1 5 0v10.5a1 1 0 0 1-2 0V6"/>'
    },
    archive_folder: {
      filled: '<path d="M4 5h6l2 2h8c1.1 0 2 .9 2 2v9c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V7c0-1.1.9-2 2-2Zm4 5v2h8v-2H8Zm2 4v2h4v-2h-4Z"/>',
      outline: '<path d="M3 7.5c0-1.1.9-2 2-2h5l2 2h7c1.1 0 2 .9 2 2v8c0 1.1-.9 2-2 2H5c-1.1 0-2-.9-2-2v-10Z"/><path d="M8 11h8"/><path d="M10 15h4"/>'
    },
    star: {
      filled: '<path d="m12 17.27 5.18 3.13-1.37-5.89 4.57-3.96-6.02-.51L12 4.5l-2.36 5.54-6.02.51 4.57 3.96-1.37 5.89L12 17.27Z"/>',
      outline: '<path d="m12 16.3 3.76 2.27-1-4.28 3.32-2.88-4.38-.37L12 7l-1.7 4.04-4.38.37 3.32 2.88-1 4.28L12 16.3Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>'
    },
    mic: {
      filled: '<path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3Zm5.3-3c0 3-2.54 5.1-5.3 5.1S6.7 14 6.7 11H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c3.28-.48 6-3.3 6-6.72h-1.7Z"/>',
      outline: '<rect x="9" y="2.5" width="6" height="11" rx="3"/><path d="M5.5 10.8c0 3.5 2.7 6.2 6.5 6.2s6.5-2.7 6.5-6.2"/><path d="M12 17v4"/>'
    },
    record_voice_over: {
      filled: '<path d="M9 11.5A3.5 3.5 0 1 0 9 4.5a3.5 3.5 0 0 0 0 7Zm0 2c-2.7 0-6 1.35-6 3.35V19h12v-2.15c0-2-3.3-3.35-6-3.35Zm8.3-8.1-1.4 1.4a5.35 5.35 0 0 1 0 7.6l1.4 1.4a7.35 7.35 0 0 0 0-10.4Zm2.8-2.8-1.4 1.4a9.3 9.3 0 0 1 0 13.2l1.4 1.4a11.3 11.3 0 0 0 0-16Z"/>',
      outline: '<circle cx="9" cy="8" r="3.4"/><path d="M3.5 18.5c.4-2.8 3-4.3 5.5-4.3s5.1 1.5 5.5 4.3"/><path d="M15.7 6.7a5.8 5.8 0 0 1 0 8.2"/><path d="M18.4 4a9.6 9.6 0 0 1 0 13.6"/>'
    },
    play_arrow: {
      filled: '<path d="M8 5v14l11-7L8 5Z"/>',
      outline: '<path d="M8 5v14l11-7-11-7Z"/>'
    },
    pause: {
      filled: '<path d="M7 5h3v14H7V5Zm7 0h3v14h-3V5Z"/>',
      outline: '<path d="M7 5h3v14H7V5ZM14 5h3v14h-3V5Z"/>'
    },
    delete: {
      filled: '<path d="M6 7h12l-1 13a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L6 7Zm3-4h6l1 2h4v2H4V5h4l1-2Zm1 6v9h2V9h-2Zm4 0v9h2V9h-2Z"/>',
      outline: '<path d="M5 7h14"/><path d="M9 7V4h6v3"/><path d="m8 7 1 12h6l1-12"/><path d="M10 10v6"/><path d="M14 10v6"/>'
    },
    replay_15: {
      filled: '<path d="M12 5V2L7 7l5 5V8.1c3.4 0 6.1 2.7 6.1 6.1 0 1.8-.8 3.4-2 4.5l1.4 1.5c1.6-1.5 2.6-3.6 2.6-6 0-4.5-3.6-8.1-8.1-8.1Z"/><text x="7.2" y="17" font-size="6.5" font-weight="850" fill="currentColor">15</text>',
      outline: '<path d="M12 5V2L7 7l5 5V8.1c3.4 0 6.1 2.7 6.1 6.1 0 1.8-.8 3.4-2 4.5"/><text x="7.2" y="17" font-size="6.5" font-weight="850" fill="currentColor">15</text>'
    },
    forward_30: {
      filled: '<path d="M12 5V2l5 5-5 5V8.1c-3.4 0-6.1 2.7-6.1 6.1 0 1.8.8 3.4 2 4.5l-1.4 1.5c-1.6-1.5-2.6-3.6-2.6-6 0-4.5 3.6-8.1 8.1-8.1Z"/><text x="8" y="17" font-size="6.5" font-weight="850" fill="currentColor">30</text>',
      outline: '<path d="M12 5V2l5 5-5 5V8.1c-3.4 0-6.1 2.7-6.1 6.1 0 1.8.8 3.4 2 4.5"/><text x="8" y="17" font-size="6.5" font-weight="850" fill="currentColor">30</text>'
    },
    phone: {
      filled: '<path d="M6.62 10.79c1.44 2.83 3.76 5.15 6.59 6.59l2.2-2.2c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1C10.61 21 3 13.39 3 4c0-.55.45-1 1-1h3.5c.55 0 1 .45 1 1 0 1.24.2 2.45.57 3.57.11.35.03.74-.25 1.02l-2.2 2.2Z"/>',
      outline: '<path d="M6.6 10.8a15.1 15.1 0 0 0 6.6 6.6l2.1-2.1c.3-.3.7-.4 1.1-.2 1.1.4 2.3.6 3.6.6v4.8C10.6 20.5 3.5 13.4 3.5 4h4.8c0 1.3.2 2.5.6 3.6.1.4 0 .8-.2 1.1l-2.1 2.1Z"/>'
    },
    text: {
      filled: '<path d="M4 4h16c1.1 0 2 .9 2 2v9c0 1.1-.9 2-2 2H8l-5 4V6c0-1.1.9-2 2-2Zm3 5h10V7H7v2Zm0 4h7v-2H7v2Z"/>',
      outline: '<path d="M5 5h14c1 0 1.8.8 1.8 1.8v8.4c0 1-.8 1.8-1.8 1.8H8.8L4 20.8v-14C4 5.8 4.8 5 5 5Z"/><path d="M8 9h8M8 12.5h6"/>'
    },
    chevron_left: {
      filled: '<path d="M15.4 5.4 14 4 6 12l8 8 1.4-1.4L8.8 12l6.6-6.6Z"/>',
      outline: '<path d="M15 5 8 12l7 7"/>'
    },
    chevron_right: {
      filled: '<path d="M8.6 5.4 10 4l8 8-8 8-1.4-1.4 6.6-6.6-6.6-6.6Z"/>',
      outline: '<path d="m9 5 7 7-7 7"/>'
    },
    checklist: {
      filled: '<path d="m9 16.2-3.5-3.5L4.1 14.1 9 19 20.3 7.7 18.9 6.3 9 16.2ZM4 6h8v2H4V6Zm0 4h8v2H4v-2Z"/>',
      outline: '<path d="m8.8 17.1-3.3-3.3"/><path d="M8.8 17.1 20 5.9"/><path d="M4 6h8M4 10h8"/>'
    },
    sensors: {
      filled: '<path d="M7.1 7.1 5.7 5.7C4.1 7.3 3 9.5 3 12s1.1 4.7 2.7 6.3l1.4-1.4C5.8 15.6 5 13.9 5 12s.8-3.6 2.1-4.9Zm11.2-1.4-1.4 1.4C18.2 8.4 19 10.1 19 12s-.8 3.6-2.1 4.9l1.4 1.4C19.9 16.7 21 14.5 21 12s-1.1-4.7-2.7-6.3ZM12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z"/>',
      outline: '<path d="M7 7a7 7 0 0 0 0 10"/><path d="M17 7a7 7 0 0 1 0 10"/><circle cx="12" cy="12" r="3.5"/>'
    },
    image: {
      filled: '<path d="M5 4h14c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H5c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2Zm2.2 12h9.7l-3.1-4.1-2.4 3.1-1.8-2.2L7.2 16ZM8 9.5A1.5 1.5 0 1 0 8 6.5a1.5 1.5 0 0 0 0 3Z"/>',
      outline: '<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><circle cx="8" cy="9" r="1.6"/><path d="m6.5 16 3.1-3.4 2.2 2.5 2.5-3.2 3.5 4.1H6.5Z"/>'
    },
    note: {
      filled: '<path d="M6 3h8.6L20 8.4V21H6c-1.1 0-2-.9-2-2V5c0-1.1.9-2 2-2Zm8 1.8V9h4.2L14 4.8ZM7.5 12h9v1.8h-9V12Zm0 4h6.8v1.8H7.5V16Z"/>',
      outline: '<path d="M5 4h9l5 5v11H5V4Z"/><path d="M14 4v5h5"/><path d="M8 13h8M8 17h6"/>'
    },
    edit: {
      filled: '<path d="M3 17.3V21h3.7L17.8 9.9l-3.7-3.7L3 17.3Zm17.7-10.2a1 1 0 0 0 0-1.4L18.3 3.3a1 1 0 0 0-1.4 0l-1.8 1.8 3.7 3.7 1.9-1.7Z"/>',
      outline: '<path d="M4 20h3.2L18.5 8.7 15.3 5.5 4 16.8V20Z"/><path d="m14.6 6.2 3.2 3.2"/><path d="M3.5 20.5h17"/>'
    },
    folder: {
      filled: '<path d="M4 5h6l2 2h8c1.1 0 2 .9 2 2v8.5c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V7c0-1.1.9-2 2-2Z"/>',
      outline: '<path d="M3 6h6.2l2 2H21v10.5c0 .8-.7 1.5-1.5 1.5h-16C2.7 20 2 19.3 2 18.5v-11C2 6.7 2.7 6 3 6Z"/>'
    },
    contacts: {
      filled: '<path d="M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm7.5-2.5a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM2 20c0-3.3 3-6 7-6s7 2.7 7 6v1H2v-1Zm13.7-7c2.8.4 5.3 2.6 5.3 5.5V20h-3.2c-.2-2.4-1.2-4.5-2.8-6.1.2-.3.4-.6.7-.9Z"/>',
      outline: '<circle cx="9" cy="7" r="3.5"/><path d="M2.5 20.5c.4-4 3.1-6.5 6.5-6.5s6.1 2.5 6.5 6.5"/><circle cx="16.5" cy="6" r="2.7"/><path d="M15.7 12.5c3 .4 5.2 2.6 5.6 5.8"/>'
    },
    apps: {
      filled: '<path d="M4 4h6v6H4V4Zm10 0h6v6h-6V4ZM4 14h6v6H4v-6Zm10 0h6v6h-6v-6Z"/>',
      outline: '<rect x="4" y="4" width="6" height="6" rx="1.5"/><rect x="14" y="4" width="6" height="6" rx="1.5"/><rect x="4" y="14" width="6" height="6" rx="1.5"/><rect x="14" y="14" width="6" height="6" rx="1.5"/>'
    },
    plus: {
      filled: '<path d="M11 4h2v7h7v2h-7v7h-2v-7H4v-2h7V4Z"/>',
      outline: '<path d="M12 5v14M5 12h14"/>'
    },
    pin: {
      filled: '<path d="M15 2 22 9l-2 2-1.4-1.4-4.1 4.1.5 4.8-1.5 1.5-4.9-4.9L4 20l-1-1 4.9-4.6L3 9.5 4.5 8l4.8.5 4.1-4.1L12 3l3-1Z"/>',
      outline: '<path d="m15 3 6 6-2 2-1.5-1.5-4.2 4.2.5 4.8-1.2 1.2-8.3-8.3 1.2-1.2 4.8.5 4.2-4.2L13 5l2-2Z"/><path d="m8.7 15.3-4.2 4.2"/>'
    },
    warning: {
      filled: '<path d="M12 2 22 20H2L12 2Zm-1 6v6h2V8h-2Zm0 8v2h2v-2h-2Z"/>',
      outline: '<path d="M12 3 21 20H3L12 3Z"/><path d="M12 8v6M12 17v.2"/>'
    },
    search: {
      filled: '<path d="M10 3a7 7 0 0 1 5.6 11.2l4.1 4.1-1.4 1.4-4.1-4.1A7 7 0 1 1 10 3Zm0 2a5 5 0 1 0 0 10 5 5 0 0 0 0-10Z"/>',
      outline: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m15.8 15.8 4.2 4.2"/>'
    },
    more_vert: {
      filled: '<path d="M12 8a2 2 0 1 0 0-4 2 2 0 0 0 0 4Zm0 2a2 2 0 1 0 0 4 2 2 0 0 0 0-4Zm0 6a2 2 0 1 0 0 4 2 2 0 0 0 0-4Z"/>',
      outline: '<circle cx="12" cy="5" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="12" cy="19" r="1.2"/>'
    },
    lightbulb_2: {
      filled: '<path d="M9 21h6v-2H9v2Zm3-19C8.14 2 5 5.14 5 9c0 2.38 1.19 4.47 3 5.74V17c0 .55.45 1 1 1h6c.55 0 1-.45 1-1v-2.26A6.98 6.98 0 0 0 19 9c0-3.86-3.14-7-7-7Zm2.05 11.06-.55.34V16h-3v-2.6l-.55-.34A4.93 4.93 0 0 1 7 9c0-2.76 2.24-5 5-5s5 2.24 5 5c0 1.67-.84 3.23-2.95 4.06ZM10 10.2h4V8.5h-4v1.7Z"/>',
      outline: '<path d="M9 21h6"/><path d="M9.5 18h5"/><path d="M9.5 15.8v-2.4A5.6 5.6 0 0 1 6.5 8.5 5.5 5.5 0 0 1 12 3a5.5 5.5 0 0 1 5.5 5.5 5.6 5.6 0 0 1-3 4.9v2.4"/><path d="M10 9h4"/><path d="M12 3V1.8"/><path d="m5.5 4.2-.9-.9"/><path d="m18.5 4.2.9-.9"/>'
    },
    settings: {
      filled: '<path d="M19.4 13.5c.1-.5.1-1 .1-1.5s0-1-.1-1.5l2-1.5-2-3.5-2.4 1a7.2 7.2 0 0 0-2.6-1.5L14 2h-4l-.4 2.5A7.2 7.2 0 0 0 7 6L4.6 5l-2 3.5 2 1.5c-.1.5-.1 1-.1 1.5s0 1 .1 1.5l-2 1.5 2 3.5L7 18a7.2 7.2 0 0 0 2.6 1.5L10 22h4l.4-2.5A7.2 7.2 0 0 0 17 18l2.4 1 2-3.5-2-1.5ZM12 15.5A3.5 3.5 0 1 1 12 8a3.5 3.5 0 0 1 0 7.5Z"/>',
      outline: '<path d="m10.2 3-.4 2.2a7 7 0 0 0-2.1.9L5.6 5.2 3.7 8.5l1.8 1.3a7.7 7.7 0 0 0 0 2.4l-1.8 1.3 1.9 3.3 2.1-.9a7 7 0 0 0 2.1.9l.4 2.2h3.6l.4-2.2a7 7 0 0 0 2.1-.9l2.1.9 1.9-3.3-1.8-1.3a7.7 7.7 0 0 0 0-2.4l1.8-1.3-1.9-3.3-2.1.9a7 7 0 0 0-2.1-.9L13.8 3h-3.6Z"/><circle cx="12" cy="12" r="3.1"/>'
    },
    expand_more: {
      filled: '<path d="m7 10 5 5 5-5H7Z"/>',
      outline: '<path d="m7 10 5 5 5-5"/>'
    },
    navigate_next: {
      filled: '<path d="M8.6 5.4 10 4l8 8-8 8-1.4-1.4 6.6-6.6-6.6-6.6Z"/>',
      outline: '<path d="m9 5 7 7-7 7"/>'
    },
    tune: {
      filled: '<path d="M3 17h6v2H3v-2Zm0-6h10v2H3v-2Zm0-6h18v2H3V5Zm8 12h10v2H11v-2Zm4-6h6v2h-6v-2Z"/>',
      outline: '<path d="M3 6h18M3 12h10M15 12h6M3 18h6M11 18h10"/><circle cx="13" cy="6" r="2"/><circle cx="11" cy="12" r="2"/><circle cx="9" cy="18" r="2"/>'
    }
  };

  const SEMANTIC_ICON_ACCENT_PALETTE = {
    inbox: { dark: "#8b63ff", light: "#8b63ff" },
    connect: { dark: "#4f61d8", light: "#4f61d8" },
    meetings: { dark: "#0a84ff", light: "#0a84ff" },
    settings: { dark: "#64748b", light: "#64748b" },
    messages: { dark: "#226fe8", light: "#226fe8" },
    meeting_notes: { dark: "#0ea5e9", light: "#0ea5e9" },
    reminders: { dark: "#f59e0b", light: "#f59e0b" },
    notes: { dark: "#f2a000", light: "#f2a000" },
    tasks: { dark: "#22c55e", light: "#22c55e" },
    calendar: { dark: "#ff443a", light: "#ff443a" },
    projects: { dark: "#0f9fb8", light: "#0f9fb8" },
    contacts: { dark: "#f43f68", light: "#f43f68" }
  };
  const LIGHT_APPS = [
    { route: "inbox", label: "Inbox", icon: "mail", accent: "inbox", kind: "real" },
    { route: "connect", label: "Connect", icon: "link", accent: "connect", kind: "real" },
    { route: "meetings", label: "Meetings", icon: "mic", accent: "meetings", kind: "real" },
    { route: "settings", label: "Settings", icon: "settings", accent: "settings", kind: "real" },
    { route: "meeting-notes", label: "Meeting Notes", icon: "record_voice_over", accent: "meeting_notes", kind: "mock" },
    { route: "reminders", label: "Reminders", icon: "bell", accent: "reminders", kind: "real" },
    { route: "notes", label: "Notes", icon: "note", accent: "notes", kind: "mock" },
    { route: "tasks", label: "Tasks", icon: "checklist", accent: "tasks", kind: "mock" },
    { route: "calendar", label: "Calendar", icon: "calendar", accent: "calendar", kind: "mock" },
    { route: "projects", label: "Projects", icon: "folder", accent: "projects", kind: "mock" },
    { route: "contacts", label: "Contacts", icon: "contacts", accent: "contacts", kind: "mock" }
  ];
  const LIGHT_ROUTES = new Set([
    "home",
    "notes",
    "note-detail",
    "tasks",
    "task-detail",
    "calendar",
    "meeting-detail",
    "meeting-notes",
    "meeting-note-detail",
    "reminders",
    "reminder-detail",
    "projects",
    "project-detail",
    "project-new",
    "contacts",
    "contact-detail",
    "contact-edit",
    "contact-new"
  ]);
  const HOME_SHELL_CANONICAL_ROUTES = new Set(["inbox", "connect", "meetings", "settings"]);
  const LIGHT_ROUTE_PARENTS = {
    "note-detail": "notes",
    "task-detail": "tasks",
    "meeting-detail": "calendar",
    "meeting-note-detail": "meeting-notes",
    "reminder-detail": "reminders",
    "project-detail": "projects",
    "project-new": "projects",
    "contact-detail": "contacts",
    "contact-edit": "contacts",
    "contact-new": "contacts"
  };
  const ROUTE_ALIASES = {
    apps: "connect",
    links: "connect",
    feed: "inbox",
    "feed-preview": "inbox",
    "feed-preview-detail": "inbox",
    morning: "home",
    calls: "home"
  };
  const WORKSPACE_ROUTE_COLLECTIONS = {
    notes: "notes",
    "note-detail": "notes",
    tasks: "tasks",
    "task-detail": "tasks",
    calendar: "calendar-events",
    "meeting-detail": "calendar-events",
    "message-detail": "messages",
    "meeting-notes": "meeting-notes",
    "meeting-note-detail": "meeting-notes",
    reminders: "reminders",
    "reminder-detail": "reminders",
    "feed-preview": "feed-items",
    "feed-preview-detail": "feed-items",
    projects: "projects",
    "project-detail": "projects",
    "project-new": "projects",
    contacts: "contacts",
    "contact-detail": "contacts",
    "contact-edit": "contacts",
    "contact-new": "contacts"
  };
  const WORKSPACE_KIND_COLLECTIONS = {
    note: "notes",
    task: "tasks",
    calendar_event: "calendar-events",
    feed_item: "feed-items",
    project: "projects",
    contact: "contacts",
    meeting_note: "meeting-notes",
    reminder: "reminders"
  };

  const DEFAULT_HOME_MENU_ICONS = [
    { key: "book", icon: "book", label: "Audiobooks", accent: "#72c2ff" }
  ];

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
  const LINKS_AUTH_SCHEME_LABELS = {
    OAUTH2: "OAuth",
    API_KEY: "API key",
    BASIC: "Basic",
    BEARER_TOKEN: "Token",
    NO_AUTH: "No auth"
  };

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
    selectedContactId: "sarah",
    selectedMeetingId: "vendor",
    selectedMeetingNoteId: "demo-meeting-home-refresh",
    selectedReminderId: "demo-reminder-paint-samples",
    selectedNoteId: "q4",
    selectedTaskId: String(persistedNavState.selected_task_id || "").trim() || "demo-task-do-paint-samples",
    selectedProjectId: "aurora",
    selectedFeedId: "maya-budget",
    selectedCalendarDate: calendarTodayDateKey(resolveCalendarTimeZone(initialCalendarTimeZonePreference)),
    calendarTimeZone: initialCalendarTimeZonePreference,
    taskSectionsExpanded: initialTaskSectionsExpandedValue,
    notesSectionsExpanded: { pinned: true, recent: true },
    taskFilter: "all",
    taskNavOrigin: null,
    reminderHistoryExpanded: false,
    workspace: {
      notes: { items: [], loaded: false, loading: false, error: "" },
      tasks: { items: [], loaded: false, loading: false, error: "" },
      "calendar-events": { items: [], loaded: false, loading: false, error: "" },
      "feed-items": { items: [], loaded: false, loading: false, error: "" },
      projects: { items: [], loaded: false, loading: false, error: "" },
      contacts: { items: [], loaded: false, loading: false, error: "" },
      messages: { items: [], loaded: false, loading: false, error: "" },
      "meeting-notes": { items: [], loaded: false, loading: false, error: "" },
      reminders: { items: [], loaded: false, loading: false, error: "" },
      assets: {}
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
    openCardMenuSessionId: "",
    openCardMenuThreadId: "",
    cardMenuClickSuppressUntil: 0,
    turnUiEvents: [],
    lastRenderedTurnVisualState: "",
    lastRenderedTurnId: "",
    waveHistory: new Map(),
    links: initialLinksState(),
    meetings: initialMeetingsState(),
    meetingRecording: initialMeetingRecordingStatus(),
    drag: null
  };

  ensureStoredHomeMenuIcons();

  const pending = new Map();
  let seq = 0;
  let feedSyncIntervalId = 0;
  let audioProbeResetTimerId = 0;
  let activeArchiveReveal = null;
  let archiveRevealGestureSeq = 0;
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

  window.Pucky = {
    request(payload) {
      const command = payload && payload.command;
      const args = payload && payload.args ? payload.args : {};
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
        });
      }
      return browserRequest(command, args);
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
          render();
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
      return state.player;
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
      try {
        window.open(url, "_blank", "noopener,noreferrer");
      } catch (_) {
        if (window.location && typeof window.location.assign === "function") {
          window.location.assign(url);
        }
      }
      return {
        schema: "pucky.browser_open.v1",
        launched: true,
        uri: url,
        user_mediated: true
      };
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
      const nextPath = args.path || state.player.path || state.activePath;
      const nextSource = args.path ? null : (state.player.source || null);
      state.activePath = nextSource || args.path || state.activePath;
      const start = args.start_at_ms ?? savedPositionFor(nextSource || nextPath) ?? 0;
      const speed = finiteSpeed(args.speed ?? args.rate)
        ?? savedSpeedForCard(state.cards.find(card => audioControlKey(card) === state.activePath) || {})
        ?? state.player.speed
        ?? 1;
      state.player = stampPlayerState({
        schema: "pucky.player_state.v1",
        loaded: true,
        state: "playing",
        is_playing: true,
        path: nextPath,
        source: nextSource,
        position_ms: start,
        duration_ms: mockDurationForPath(nextSource || nextPath),
        queue_index: state.player.queue_index ?? -1,
        queue_count: state.player.queue_count ?? 0,
        speed,
        can_seek: true,
        audio_session_id: 1
      });
      return state.player;
    }
    if (command === "player.queue.set") {
      const playlist = args.playlist_path || "";
      const first = playlist ? `${playlist}#track1` : String((args.items && args.items[0] && args.items[0].path) || "");
      state.activePath = playlist || first || state.activePath;
      state.player = stampPlayerState({
        schema: "pucky.player_state.v1",
        loaded: true,
        state: "loaded",
        is_playing: false,
        path: first,
        source: playlist || null,
        position_ms: 0,
        duration_ms: mockDurationForPath(playlist || first),
        queue_index: Number(args.index || 0),
        queue_count: playlist ? 83 : ((args.items && args.items.length) || 1),
        speed: finiteSpeed(args.speed ?? args.rate) || state.speedByPath.get(normalizePath(audioControlKey({ audio_playlist_path: playlist, audio_path: first }))) || 1,
        can_seek: true,
        audio_session_id: 1
      });
      return state.player;
    }
    if (command === "player.pause") {
      state.player = stampPlayerState({ ...state.player, state: "paused", is_playing: false });
      return state.player;
    }
    if (command === "player.seek") {
      state.player = stampPlayerState({ ...state.player, position_ms: Math.max(0, Number(args.position_ms || 0)) });
      rememberPlayerProgress(state.player);
      return state.player;
    }
    if (command === "player.speed") {
      const speed = Math.max(0.5, Math.min(3, Number(args.speed || 1)));
      state.player = stampPlayerState({ ...state.player, speed });
      if (state.activePath) {
        state.speedByPath.set(normalizePath(state.activePath), speed);
        persistAudioState();
      }
      return state.player;
    }
    if (command === "artifact.read_base64") {
      return mockArtifactResult(args.path);
    }
    if (command === "artifact.url") {
      return {
        schema: "pucky.artifact_url.v1",
        url: String(args.path || ""),
        mime_type: guessMediaMime(args.path || ""),
        bytes: 0
      };
    }
    throw new Error(`Unsupported browser mock command: ${command}`);
  }

  function mockDurationForPath(path) {
    return /pocket-computers/i.test(String(path || ""))
      ? MOCK_AUDIOBOOK_DURATION_MS
      : MOCK_STANDARD_DURATION_MS;
  }

  function mockArtifactResult(path) {
    const value = String(path || "");
    const title = mockArtifactTitle(value);
    if (/\.(avif|gif|jpe?g|png|svg|webp)$/i.test(value)) {
      const svg = `<!doctype svg><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 900 620"><defs><linearGradient id="g" x1="0" x2="1" y1="0" y2="1"><stop stop-color="#0b1828"/><stop offset=".58" stop-color="#1f6feb"/><stop offset="1" stop-color="#ffb000"/></linearGradient></defs><rect width="900" height="620" fill="url(#g)"/><circle cx="705" cy="132" r="82" fill="#f5f9ff" opacity=".18"/><path d="M85 472 292 250l135 152 116-148 245 218H85Z" fill="#f5f9ff" opacity=".88"/><text x="70" y="96" fill="#f5f9ff" font-family="Arial,sans-serif" font-size="44" font-weight="800">${title}</text></svg>`;
      return {
        mime_type: "image/svg+xml",
        content_base64: btoa(svg)
      };
    }
    if (/\.pdf$/i.test(value)) {
      const pdf = `%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 420 594] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj\n4 0 obj\n<< /Length 86 >>\nstream\nBT /F1 24 Tf 48 522 Td (${title}) Tj /F1 13 Tf 0 -36 Td (PDF fixture preview) Tj ET\nendstream\nendobj\n5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF`;
      return {
        mime_type: "application/pdf",
        content_base64: btoa(pdf)
      };
    }
    return {
      mime_type: "text/html",
      content_base64: btoa(mockHtmlArtifact(title))
    };
  }

  function mockArtifactTitle(path) {
    return String(path || "Pucky page")
      .replace(/^.*\//, "")
      .replace(/\.[a-z0-9]+$/i, "")
      .replace(/-/g, " ");
  }

  function mockHtmlArtifact(title) {
    return `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;font-family:Georgia,serif;background:#fff8e7;color:#17202a;padding:22px;line-height:1.45}h1{font:800 30px/1.05 system-ui,sans-serif;margin:0 0 14px}section{margin:18px 0;padding:14px;border:2px solid #17202a;box-shadow:5px 5px 0 #f2b705}p{font-size:16px}.tag{display:inline-block;background:#17202a;color:white;padding:4px 8px;margin-bottom:10px}</style><h1>${title}</h1><section><span class="tag">rich reply</span><p>This is a longer HTML artifact preview so the cover sheet has to scroll. It is intentionally text-heavy for layout testing.</p><p>The final agent version can ship charts, images, controls, route pages, or generated documents here. The APK only needs to cache and display the bundle safely.</p></section><section><p>Second section: a compact brief, a decision, a risk list, and a next action. This tests whether the iframe gets enough vertical room without swallowing the bottom safe area.</p><p>Keep this scrolling naturally. No giant dead band at the top, no clipped bottom controls, and no mystery margins.</p></section>`;
  }

  function isMockHtmlArtifact(path) {
    return /^\/mock\/[^/]+\.html$/i.test(String(path || ""));
  }

  const HOME_FEED_LIMIT = 100;

  function feedApiBaseUrl() {
    if (state.links.apiBaseUrl) {
      return state.links.apiBaseUrl;
    }
    if (window.location && /^https?:$/i.test(window.location.protocol || "")) {
      return String(window.location.origin || "").replace(/\/$/, "");
    }
    return DEFAULT_LINKS_API_BASE;
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
    const init = {
      method,
      cache: String(options.cache || "no-store"),
      headers: { Accept: "application/json" }
    };
    if (state.links.apiToken) {
      init.headers.Authorization = `Bearer ${state.links.apiToken}`;
    }
    if (options.body !== undefined) {
      init.headers["Content-Type"] = "application/json";
      init.body = JSON.stringify(options.body);
    }
    const response = await fetch(`${feedApiBaseUrl()}${path}`, init);
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(String(payload && (payload.detail || payload.error) || `Feed request failed (${response.status})`));
    }
    return payload;
  }

  async function workspaceApiRequest(path, options = {}) {
    await ensureLinksApiConfig();
    const method = String(options.method || "GET").toUpperCase();
    const init = {
      method,
      cache: String(options.cache || "no-store"),
      headers: { Accept: "application/json" }
    };
    if (state.links.apiToken) {
      init.headers.Authorization = `Bearer ${state.links.apiToken}`;
    }
    if (options.body !== undefined) {
      init.headers["Content-Type"] = "application/json";
      init.body = JSON.stringify(options.body);
    }
    const response = await fetch(`${linksApiBaseUrl()}${path}`, init);
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(String(payload && (payload.detail || payload.error) || `Workspace request failed (${response.status})`));
    }
    return payload;
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

  async function loadWorkspaceCollection(collection, options = {}) {
    const bucket = state.workspace[collection];
    if (!bucket || (bucket.loading && !options.force)) {
      return;
    }
    bucket.loading = true;
    bucket.error = "";
    try {
      const date = "";
      const payload = await workspaceApiRequest(workspaceQuery(collection, { date, includeArchived: Boolean(options.includeArchived) }));
      bucket.items = Array.isArray(payload && payload.items) ? payload.items : [];
      bucket.loaded = true;
    } catch (error) {
      bucket.error = String(error && error.message || error || "Workspace request failed");
    } finally {
      bucket.loading = false;
    }
    if (options.render) {
      render();
    }
  }

  async function upsertWorkspaceRecord(collection, body, options = {}) {
    const bucket = workspaceBucket(collection);
    try {
      const record = await workspaceApiRequest(`/api/workspace/${collection}`, {
        method: "POST",
        body
      });
      await loadWorkspaceCollection(collection, { ...options, force: true, render: false });
      if (options.render) {
        render();
      }
      return record;
    } catch (error) {
      bucket.error = String(error && error.message || error || "Workspace write failed");
      showToast(bucket.error);
      if (options.render) {
        render();
      }
      return null;
    }
  }

  async function patchWorkspaceRecord(collection, id, body, options = {}) {
    const recordId = String(id || "").trim();
    const bucket = workspaceBucket(collection);
    if (!recordId) {
      return null;
    }
    try {
      const record = await workspaceApiRequest(`/api/workspace/${collection}/${encodeURIComponent(recordId)}`, {
        method: "PATCH",
        body
      });
      await loadWorkspaceCollection(collection, { ...options, force: true, render: false });
      if (options.render) {
        render();
      }
      return record;
    } catch (error) {
      bucket.error = String(error && error.message || error || "Workspace write failed");
      showToast(bucket.error);
      if (options.render) {
        render();
      }
      return null;
    }
  }

  async function loadWorkspaceForRoute(route = state.route, options = {}) {
    const collection = WORKSPACE_ROUTE_COLLECTIONS[String(route || "")];
    if (!collection) {
      return;
    }
    await loadWorkspaceCollection(collection, options);
  }

  async function loadWorkspaceAsset(assetId, options = {}) {
    const id = String(assetId || "").trim();
    if (!id || state.workspace.assets[id]) {
      return state.workspace.assets[id] || null;
    }
    try {
      const payload = await workspaceApiRequest(`/api/workspace/assets/${encodeURIComponent(id)}`);
      state.workspace.assets[id] = payload;
      if (options.render) {
        render();
      }
      return payload;
    } catch (_) {
      return null;
    }
  }

  function workspaceItems(collection) {
    return Array.isArray(state.workspace[collection]?.items) ? state.workspace[collection].items : [];
  }

  function workspaceBucket(collection) {
    return state.workspace[collection] || { items: [], loaded: false, loading: false, error: "" };
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
      const snapshot = await fetchVmFeedSnapshot({ includeArchived: false });
      const applied = applyFeedSnapshot(snapshot, { render: options.render !== false });
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

  async function loadTurnStatus(options = {}) {
    try {
      const snapshot = await Pucky.request({ command: "pucky.turn.status", args: {} });
      applyTurnStatus(snapshot);
      if (options.render) {
        render();
      }
    } catch (_) {
      // The bridge can be briefly unavailable during WebView startup.
    }
  }

  async function loadTurnSettings(options = {}) {
    try {
      const snapshot = await Pucky.request({ command: "pucky.turn.settings.get", args: {} });
      state.turnSettings = normalizeTurnSettings(snapshot);
      if (options.render) {
        render();
      }
    } catch (_) {
      // Browser previews and early WebView startup keep the default card-only mode.
    }
  }

  async function loadWakeStatus(options = {}) {
    try {
      const snapshot = await Pucky.request({ command: "wake.status", args: {} });
      state.wakeStatus = normalizeWakeStatus(snapshot);
      if (options.render) {
        render();
      }
    } catch (_) {
      // Keep the current placeholder wake state if the bridge is not ready yet.
    }
  }

  async function loadUiSurfaceStatus(options = {}) {
    try {
      const snapshot = await Pucky.request({ command: "ui.surface.get", args: {} });
      state.uiSurface = normalizeUiSurfaceStatus(snapshot);
      if (options.render) {
        render();
      }
    } catch (_) {
      // Local browser preview keeps a synthetic bundle_current status.
    }
  }

  async function loadDefaultAudioSpeed(options = {}) {
    try {
      const snapshot = await Pucky.request({ command: "ui.default_audio_speed.get", args: {} });
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
        const snapshot = await Pucky.request({ command: "phone.role.status", args: {} });
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
      state.phoneRole = await fetchBrowserPhoneRoleStatus();
    }
    if (options.render) {
      render();
    }
  }

  async function fetchBrowserPhoneRoleStatus() {
    await ensureLinksApiConfig();
    if (!state.links.apiToken) {
      return unavailableBrowserPhoneRoleStatus("preview_unavailable", {
        source: "preview_unavailable",
        loaded: false
      });
    }
    const params = new URLSearchParams();
    if (state.links.deviceId) {
      params.set("device_id", state.links.deviceId);
    }
    const response = await fetch(
      `${linksApiBaseUrl()}/api/device/phone-role-status${params.toString() ? `?${params.toString()}` : ""}`,
      {
        method: "GET",
        cache: "no-store",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${state.links.apiToken}`
        }
      }
    );
    const payload = await response.json().catch(() => ({}));
    if (response.ok) {
      const resolvedDeviceId = String(payload && payload.device_id || "").trim();
      if (resolvedDeviceId) {
        state.links.deviceId = resolvedDeviceId;
      }
      return normalizePhoneRoleStatus({
        ...payload,
        source: "browser_live_api",
        read_only: true,
        loaded: true,
        error_code: "",
        error_detail: ""
      });
    }
    return unavailableBrowserPhoneRoleStatus(
      normalizeBrowserPhoneRoleErrorCode(response.status, payload),
      {
        ...payload,
        source: "browser_live_api",
        read_only: true,
        loaded: false
      }
    );
  }

  function normalizeBrowserPhoneRoleErrorCode(statusCode, payload) {
    const explicit = String(payload && payload.error_code || "").trim();
    if (explicit) {
      return explicit;
    }
    if (statusCode === 401) {
      return "unauthorized";
    }
    if (statusCode === 409) {
      return "device_context_unavailable";
    }
    if (statusCode === 503) {
      return "device_offline";
    }
    return "broker_command_failed";
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

  async function loadSettingsState(options = {}) {
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
  }

  function resetLinksCatalogState(options = {}) {
    state.links.apps = [];
    if (options.clearConnected === true) {
      state.links.connectedApps = [];
      state.links.connectedSlugs = new Set();
      state.links.connectedLoaded = false;
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

  function createLinksRow(app, index, handoffLocked) {
    const row = el("button", "links-app-row");
    row.type = "button";
    row.dataset.linksSlug = String(app.slug || "");
    row.dataset.linksIndex = String(index);
    row.disabled = handoffLocked;
    row.classList.toggle("is-opening", handoffLocked && state.links.openingSlug === app.slug);

    const icon = el("span", "links-app-icon");
    if (app.logo_path) {
      const img = document.createElement("img");
      img.className = "links-app-logo";
      img.src = String(app.logo_path || "");
      img.alt = "";
      img.loading = "lazy";
      img.decoding = "async";
      img.addEventListener("load", () => {
        icon.classList.add("has-image");
        state.links.logoLoads += 1;
      });
      img.addEventListener("error", () => {
        state.links.logoErrors += 1;
        img.remove();
      });
      icon.append(img);
    }

    const name = el("span", "links-app-name", app.name || app.slug);
    const auth = el("span", "links-app-auth", linksAuthLabelForApp(app));
    const mark = el("span", state.links.connectedSlugs.has(app.slug) ? "links-app-mark is-connected" : "links-app-mark");

    row.append(icon, name, auth, mark);
    row.addEventListener("click", () => {
      openLinksAuthFlow(app);
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

  function linksDebugRoot() {
    if (!window.__PUCKY_LINKS_DEBUG__ || typeof window.__PUCKY_LINKS_DEBUG__ !== "object") {
      window.__PUCKY_LINKS_DEBUG__ = {
        schema: "pucky.links_debug.v1",
        route_sessions: [],
        click_sessions: [],
        last_event: null
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
        session_ready: Boolean(state.links.token),
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

  async function loadLinksConnected(options = {}) {
    if (!state.links.token) {
      return;
    }
    linksDebugRecord("my_apps_start", { force: Boolean(options.force) }, "route");
    const payload = await linksApiRequest(`/api/links/composio/my-apps?token=${encodeURIComponent(state.links.token)}`);
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
    state.links.lastRefreshAt = Date.now();
    linksDebugRecord(
      "my_apps_end",
      {
        connected_count: active.length,
        payload_count: list.length,
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
          state.links.connectedApps = [];
          state.links.connectedSlugs = new Set();
          state.links.connectedLoaded = false;
          state.links.lastRefreshAt = 0;
        }
        if (!state.links.token) {
          linksDebugRecord("portal_url_start", { force: Boolean(options.force) }, "route");
          await ensureLinksApiConfig();
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
      ...state.links.connectedApps.map(app => el("span", "links-connected-chip", app.name || app.slug))
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
      const authUrl = String(payload && payload.auth_url || "").trim();
      if (!authUrl) {
        throw new Error("Connect did not return a valid auth URL.");
      }
      if (String(payload && payload.auth_mode || state.links.auth_mode) === "browser") {
        linksDebugRecord("browser_open_requested", { slug }, "click");
        await Pucky.request({ command: "browser.open", args: { url: authUrl } });
      } else if (window.location && typeof window.location.assign === "function") {
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
    if (window.location && /^https?:$/i.test(window.location.protocol || "")) {
      return String(window.location.origin || "").replace(/\/$/, "");
    }
    return DEFAULT_LINKS_API_BASE;
  }

  async function ensureLinksApiConfig() {
    if (state.links.apiBaseUrl) {
      if (!state.links.apiToken) {
        state.links.apiToken = resolveBrowserApiToken();
      }
      if (!state.links.deviceId) {
        state.links.deviceId = resolveBrowserDeviceId();
      }
      return;
    }
    if (!(window.PuckyAndroid && typeof window.PuckyAndroid.postMessage === "function")) {
      state.links.apiBaseUrl = String(window.location.origin || DEFAULT_LINKS_API_BASE || "").replace(/\/$/, "");
      state.links.apiToken = resolveBrowserApiToken();
      state.links.deviceId = resolveBrowserDeviceId();
      return;
    }
    try {
      const config = await Pucky.request({ command: "pucky.config.get", args: {} });
      state.links.apiBaseUrl = String(config && config.api_base_url || "").replace(/\/$/, "");
      state.links.apiToken = String(config && config.api_token || "");
      state.links.deviceId = "";
    } catch (_) {
      state.links.apiBaseUrl = "";
      state.links.apiToken = "";
      state.links.deviceId = "";
    }
  }

  async function linksApiRequest(path, options = {}) {
    await ensureLinksApiConfig();
    const method = String(options.method || "GET").toUpperCase();
    const init = {
      method,
      cache: String(options.cache || "no-store"),
      headers: {}
    };
    if (state.links.apiToken) {
      init.headers.Authorization = `Bearer ${state.links.apiToken}`;
    }
    if (options.body !== undefined) {
      init.headers["Content-Type"] = "application/json";
      init.body = JSON.stringify(options.body);
    }
    const response = await fetch(`${linksApiBaseUrl()}${path}`, init);
    const payload = await response.json().catch(() => ({}));
    if (payload && typeof payload === "object" && !Array.isArray(payload)) {
      payload._server_timing = String(response.headers.get("Server-Timing") || "");
      payload._http_status = response.status;
    }
    if (!response.ok) {
      throw new Error(String(payload && (payload.detail || payload.error) || `Connect request failed (${response.status})`));
    }
    return payload;
  }

  async function loadMeetings(options = {}) {
    if (state.meetings.loading) {
      return;
    }
    state.meetings.loading = true;
    state.meetings.error = "";
    if (options.render) {
      renderFeed();
    }
    try {
      const payload = await linksApiRequest("/api/meetings?compact=1", { cache: "no-store" });
      state.meetings.records = Array.isArray(payload.meetings) ? payload.meetings : [];
      state.meetings.lastRefreshAt = Date.now();
    } catch (error) {
      state.meetings.error = meetingsApiErrorMessage(error, "Unable to load meetings");
    } finally {
      state.meetings.loading = false;
      if (options.render) {
        renderFeed();
      }
    }
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
    try {
      state.meetingRecording = normalizeMeetingRecordingStatus(
        await Pucky.request({ command: "meeting.recording.status", args: {} })
      );
    } catch (_) {
      state.meetingRecording = normalizeMeetingRecordingStatus(state.meetingRecording);
    }
    if (options.render) {
      renderVoiceStatus();
    }
    return state.meetingRecording;
  }

  function ensureSettingsSurfaceCurrent() {
    if (state.route !== "settings") {
      return false;
    }
    const sourceKind = String(state.uiSurface.source_kind || "");
    const entrypointUrl = String(state.uiSurface.entrypoint_url || "");
    if (sourceKind === "bundle_current" || !entrypointUrl || !window.location || !window.location.replace) {
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
    renderVoiceStatus();
    renderThreadScopeBadge();
    renderFeed();
    renderAudioDetail();
    renderDetailAudioContinuity();
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
    return hasNativeAudioBridge() ? "native_bridge" : "browser_stub";
  }

  function initialSurfaceKind() {
    const url = String(window.location && window.location.href || "");
    return /^https:\/\/pucky\.fly\.dev\/ui\/pucky\/latest\/index\.html/i.test(url)
      ? "hosted_vm"
      : "bundle_current";
  }

  function initialUiSurfaceStatus() {
    const config = bundleConfig();
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
      audio_runtime_mode: audioRuntimeMode()
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
      rendered_row_count: linksPageRefs?.rows ? linksPageRefs.rows.querySelectorAll(".links-app-row").length : 0,
      connected_loaded: Boolean(state.links.connectedLoaded),
      session_ready: Boolean(state.links.token),
      loading: Boolean(state.links.loading),
      logo_loads: safeNumber(state.links.logoLoads),
      logo_errors: safeNumber(state.links.logoErrors),
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
      apiBaseUrl: "",
      apiToken: "",
      deviceId: "",
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
      lastRefreshAt: 0
    };
  }

  function initialMeetingsState() {
    return {
      loading: false,
      error: "",
      records: [],
      lastRefreshAt: 0
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
      audio_runtime_mode: String(raw.audio_runtime_mode || audioRuntimeMode())
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
    feed.classList.toggle("is-links-route", route === "connect");
    dismissArchiveReveal({ immediate: true, reason: "unknown", context: "render_feed" });
    syncRouteQueryParam(route);
    if (isHomeShellMockRoute()) {
      feed.replaceChildren(lightView());
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

  function lightView() {
    const view = el("section", "light-shell");
    view.dataset.lightRoute = state.route || "home";
    view.dataset.homeShellKind = "mock";
    switch (state.route) {
      case "contacts":
        view.append(lightContactsPage());
        break;
      case "contact-detail":
        view.append(lightContactDetailPage());
        break;
      case "contact-edit":
        view.append(lightContactEditPage());
        break;
      case "contact-new":
        view.append(lightContactCreatePage());
        break;
      case "calendar":
        view.append(lightCalendarPage());
        break;
      case "meeting-detail":
        view.append(lightMeetingDetailPage());
        break;
      case "meeting-notes":
        view.append(lightMeetingNotesPage());
        break;
      case "meeting-note-detail":
        view.append(lightMeetingNoteDetailPage());
        break;
      case "reminders":
        view.append(lightRemindersPage());
        break;
      case "reminder-detail":
        view.append(lightReminderDetailPage());
        break;
      case "notes":
        view.append(lightNotesPage());
        break;
      case "note-detail":
        view.append(lightNoteDetailPage());
        break;
      case "tasks":
        view.append(lightTasksPage());
        break;
      case "task-detail":
        view.append(lightTaskDetailPage());
        break;
      case "projects":
        view.append(lightProjectsPage());
        break;
      case "project-detail":
        view.append(lightProjectDetailPage());
        break;
      case "project-new":
        view.append(lightProjectCreatePage());
        break;
      case "home":
      default:
        state.route = "home";
        view.append(lightHomePage());
        break;
    }
    view.dataset.lightRoute = state.route || "home";
    return view;
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
    return SEMANTIC_ICON_ACCENT_PALETTE[key] ? key : "";
  }

  function semanticIconAccentValue(accentKey, theme = effectiveTheme()) {
    const key = semanticIconAccentKey(accentKey) || "inbox";
    const palette = SEMANTIC_ICON_ACCENT_PALETTE[key] || SEMANTIC_ICON_ACCENT_PALETTE.inbox;
    const mode = normalizeTheme(theme) === "light" ? "light" : "dark";
    return String(palette[mode] || palette.dark || palette.light || "#8b63ff").trim();
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
    if (key === "mail") return "inbox";
    if (key === "link") return "connect";
    if (key === "mic") return "meetings";
    if (key === "settings") return "settings";
    if (key === "chat") return "messages";
    if (key === "record_voice_over") return "meeting_notes";
    if (key === "bell") return "reminders";
    if (key === "note") return "notes";
    if (key === "checklist") return "tasks";
    if (key === "calendar") return "calendar";
    if (key === "text") return "feed_preview";
    if (key === "folder") return "projects";
    if (key === "contacts") return "contacts";
    return "";
  }

  function resolvedFilterAccentValue(filter, theme = effectiveTheme()) {
    const semanticAccentKey = canonicalIconAccentKey(filter.icon || filter.key);
    if (semanticAccentKey) {
      return semanticIconAccentValue(semanticAccentKey, theme);
    }
    return String(filter?.accent || "#f5f9ff");
  }

  function lightAppIcon(app) {
    const wrap = el("span", "light-app-icon");
    applySemanticIconAccent(wrap, app?.accent);
    wrap.innerHTML = iconSvg(app.icon, { filled: false });
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

  function lightContactsPage() {
    const page = lightPage("Contacts", { onBack: () => lightNavigate("home") });
    page.classList.add("light-contacts-page");
    const list = el("div", "light-contact-list");
    const status = lightWorkspaceStatus("contacts", "contacts", "No contacts yet");
    if (status) {
      page.append(status);
      return page;
    }
    list.append(...contactsListItems().map(contact => {
      const row = el("button", "light-card light-contact-row");
      row.type = "button";
      row.dataset.contactId = contact.id;
      row.addEventListener("click", () => {
        state.selectedContactId = contact.id;
        lightNavigate("contact-detail", { from: "contacts" });
      });
      row.append(lightAvatar(contact), lightContactCopy(contact));
      return row;
    }));
    page.append(list);
    return page;
  }

  function lightContactCreatePage() {
    const page = lightPage("New Contact");
    const card = el("section", "light-card light-create-card");
    const name = el("input", "light-project-input");
    name.type = "text";
    name.placeholder = "Display name";
    name.value = "New contact";
    const email = el("input", "light-project-input");
    email.type = "email";
    email.placeholder = "Email";
    const phone = el("input", "light-project-input");
    phone.type = "tel";
    phone.placeholder = "Phone";
    const save = lightPillButton("Create contact", async () => {
      const title = name.value.trim() || "New contact";
      const record = await upsertWorkspaceRecord("contacts", {
        id: `contact-${Date.now()}`,
        title,
        summary: "Workspace contact",
        metadata: {
          avatar: title.split(/\s+/).map(part => part[0] || "").join("").slice(0, 2).toUpperCase(),
          email: email.value.trim(),
          phone: phone.value.trim(),
          endpoints: [
            ...(email.value.trim() ? [{ label: "Email", value: email.value.trim() }] : []),
            ...(phone.value.trim() ? [{ label: "Phone", value: phone.value.trim() }] : [])
          ],
          activity: ["Created from Contacts"]
        }
      }, { render: false });
      if (record) {
        state.selectedContactId = record.id;
        lightNavigate("contact-detail", { from: "contacts" });
      }
    });
    card.append(
      lightSmallIcon("contacts"),
      lightTextStack("Create a contact", "Persist a person, endpoints, activity, and agent-written HTML profile."),
      name,
      email,
      phone,
      save
    );
    page.append(card);
    return page;
  }

  function buildEditableContactEndpoints(existingEndpoints, emailValue, phoneValue) {
    const endpoints = Array.isArray(existingEndpoints) ? existingEndpoints.filter(item => {
      if (!item || typeof item !== "object") {
        return false;
      }
      const label = String(item.label || item.type || "").trim().toLowerCase();
      return !["email", "gmail", "mail", "phone", "sms", "text", "mobile", "call"].includes(label);
    }).map(item => ({ ...item })) : [];
    const email = String(emailValue || "").trim();
    const phone = String(phoneValue || "").trim();
    if (email) {
      endpoints.push({ label: "Email", value: email });
    }
    if (phone) {
      endpoints.push({ label: "Phone", value: phone });
    }
    return endpoints;
  }

  function lightContactEditPage() {
    const contact = selectedContact();
    if (!contact) {
      return lightPage("Edit Contact", { subtitle: "Contact not found.", detail: true });
    }
    const selfContact = contactIsSelf(contact);
    const meta = contact.metadata || {};
    const page = lightPage(selfContact ? "Edit Me" : "Edit Contact", { detail: true });
    const card = el("section", "light-card light-create-card");
    const name = el("input", "light-project-input");
    name.type = "text";
    name.placeholder = "Display name";
    name.value = String(contact.title || "");
    const email = el("input", "light-project-input");
    email.type = "email";
    email.placeholder = "Email";
    email.value = String(meta.email || "");
    const phone = el("input", "light-project-input");
    phone.type = "tel";
    phone.placeholder = "Phone";
    phone.value = String(meta.phone || "");
    const device = el("input", "light-project-input");
    device.type = "text";
    device.placeholder = "Preferred reminder device id";
    device.value = String(meta.notification_device_id || meta.preferred_reminder_device_id || "");
    const save = lightPillButton(selfContact ? "Save profile" : "Save contact", async () => {
      const title = selfContact ? "Me" : (name.value.trim() || "Contact");
      const nextEmail = email.value.trim();
      const nextPhone = phone.value.trim();
      const metadata = {
        ...(meta || {}),
        ...(selfContact ? { is_self: true } : {}),
        avatar: selfContact
          ? String(meta.avatar || "ME").trim() || "ME"
          : String(meta.avatar || title.split(/\s+/).map(part => part[0] || "").join("").slice(0, 2).toUpperCase()).trim(),
        email: nextEmail,
        phone: nextPhone,
        endpoints: buildEditableContactEndpoints(meta.endpoints, nextEmail, nextPhone),
        notification_device_id: selfContact ? device.value.trim() : String(meta.notification_device_id || ""),
        preferred_reminder_device_id: selfContact ? device.value.trim() : String(meta.preferred_reminder_device_id || "")
      };
      const record = await patchWorkspaceRecord("contacts", String(contact.id || contact.record_id || ""), {
        title,
        summary: selfContact
          ? "Personal reminder delivery profile"
          : String(contact.summary || "Workspace contact"),
        metadata
      }, { render: false });
      if (record) {
        state.selectedContactId = String(record.id || record.record_id || contact.id || "");
        lightNavigate("contact-detail", { from: "contacts" });
      }
    });
    card.append(
      lightSmallIcon("contacts", "contacts"),
      lightTextStack(
        selfContact ? "Edit Me" : "Edit contact",
        selfContact
          ? "Keep your delivery endpoints current so reminders can route through phone, Gmail, and SMS."
          : "Update the contact profile and endpoints."
      )
    );
    if (!selfContact) {
      card.append(name);
    }
    card.append(email, phone);
    if (selfContact) {
      card.append(device);
    }
    card.append(save);
    page.append(card);
    return page;
  }

  function lightContactDetailPage() {
    const contact = selectedContact();
    if (!contact) {
      return lightPage("Contact", { subtitle: "Contact not found.", detail: true });
    }
    ensureLinkedCollections(contact);
    const selfContact = contactIsSelf(contact);
    const page = lightPage("Contact", { detail: true });
    const hero = el("section", "light-profile-card");
    hero.append(lightAvatar(contact, "large"), el("h1", "", contact.title), el("p", "", contact.summary));
    page.append(hero);
    const meta = contact.metadata || {};
    page.append(lightInfoSection("Contact", [
      { icon: "mail", accentKey: "connect", label: "Email", value: meta.email || "" },
      { icon: "phone", accentKey: "contacts", label: "Phone", value: meta.phone || "" },
      ...(selfContact && String(meta.notification_device_id || meta.preferred_reminder_device_id || "").trim()
        ? [{
            icon: "bell",
            accentKey: "reminders",
            label: "Reminder device",
            value: String(meta.notification_device_id || meta.preferred_reminder_device_id || "").trim()
          }]
        : [])
    ]));
    if (Array.isArray(meta.endpoints) && meta.endpoints.length) {
      page.append(lightInfoSection("Endpoints", meta.endpoints.map(row => ({ icon: "apps", accentKey: "connect", label: row.label, value: row.value }))));
    }
    if (Array.isArray(meta.activity) && meta.activity.length) {
      page.append(lightInfoSection("Activity", meta.activity.map((item, index) => ({
      icon: index === 0 ? "chat" : index === 1 ? "clock" : "calendar",
      accentKey: index === 0 ? "notes" : index === 1 ? "meetings" : "calendar",
      label: index === 0 ? "Last interaction" : index === 1 ? "Last meeting" : "Upcoming",
      value: item
      }))));
    }
    if (contact.links && contact.links.length) {
      page.append(lightInfoSection("Linked records", lightLinkedRecordRows(contact)));
    }
    page.append(lightHtmlDocument(contact, "No generated contact page yet.", { untitledFallback: true, className: "light-detail-html-body" }));
    return page;
  }

  function lightCalendarPage() {
    const page = lightPage("Calendar", {
      action: lightCircleButton("settings", "Calendar settings", openCalendarSettingsSheet, "light-calendar-settings-button")
    });
    page.classList.add("light-calendar-page");
    page.append(lightDatePicker());
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
    const nav = el("div", "light-calendar-strip-nav");
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
    nav.append(
      lightCalendarStripNavButton(-1),
      lightCalendarStripNavButton(1)
    );
    controls.append(nav, field);
    if (selectedCalendarDateKey() !== calendarTodayDateKey()) {
      const today = el("button", "light-calendar-today-button", "Today");
      today.type = "button";
      today.addEventListener("click", () => {
        state.selectedCalendarDate = calendarTodayDateKey();
        render();
      });
      controls.append(today);
    }
    top.append(el("h2", "light-date-picker-title", calendarMonthHeading()), controls);
    const strip = el("div", "light-calendar-day-strip");
    strip.setAttribute("aria-label", "Calendar days");
    calendarStripDays().forEach(dayKey => strip.append(lightCalendarDayChip(dayKey)));
    picker.append(top, strip);
    queueCalendarDayStripCenter(strip, selectedCalendarDateKey());
    return picker;
  }

  function lightCalendarStripNavButton(direction = 1) {
    const button = el(
      "button",
      direction < 0 ? "light-calendar-strip-nav-button is-prev" : "light-calendar-strip-nav-button is-next",
      direction < 0 ? "‹" : "›"
    );
    button.type = "button";
    button.setAttribute("aria-label", direction < 0 ? "Earlier days" : "Later days");
    button.addEventListener("click", event => {
      const strip = event.currentTarget?.closest(".light-date-picker")?.querySelector(".light-calendar-day-strip");
      scrollCalendarDayStrip(strip, direction);
    });
    return button;
  }

  function scrollCalendarDayStrip(strip, direction = 1) {
    if (!(strip instanceof HTMLElement)) {
      return;
    }
    const chip = strip.querySelector(".light-calendar-day-chip");
    const chipWidth = Math.max(58, Math.round(chip?.getBoundingClientRect().width || 58));
    strip.scrollBy({ left: (chipWidth + 8) * (direction < 0 ? -5 : 5), behavior: "smooth" });
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
    const open = el("button", "light-event-main");
    open.type = "button";
    open.addEventListener("click", () => {
      state.selectedMeetingId = event.id;
      lightNavigate("meeting-detail", { from: "calendar" });
    });
    open.append(
      el("span", "light-event-time", calendarEventTimeRange(event)),
      el("strong", "light-event-title", event.title || "Untitled event"),
    );
    block.append(open);
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
    const page = lightPage(meeting.title || "Event", { detail: true });
    page.classList.add("light-document-page", "light-event-document", "light-event-detail-page");
    page.append(lightCalendarEventDetailsSection(meeting, attendees));
    if (String(meeting.summary || "").trim()) {
      page.append(lightCopySection("Description", meeting.summary));
    }
    const chips = lightCalendarEventChips(meeting, { fromRoute: "meeting-detail", excludeContacts: true });
    if (chips) {
      const section = el("section", "light-info-section");
      section.append(lightSectionTitle("Connected"));
      const card = el("div", `light-card light-attendee-chip-card light-event-connected-card ${calendarEventTone(meeting)}`.trim());
      card.append(chips);
      section.append(card);
      page.append(section);
    }
    if (Array.isArray(meta.agenda) && meta.agenda.length) {
      page.append(lightListSection("Agenda", meta.agenda));
    }
    if (docs.length) {
      page.append(lightInfoSection("Related docs", docs.map(doc => ({ icon: "note", label: doc, value: "Open" }))));
    }
    return page;
  }

  function lightCalendarEventDetailsSection(event, attendees = calendarEventPeople(event)) {
    const section = el("section", "light-calendar-detail-section");
    section.append(lightSectionTitle("Details"));
    const card = el("div", "light-calendar-detail-card");
    card.append(
      lightCalendarDetailRow("when", "When", `${calendarEventDayLabel(event)}${DOT}${calendarEventTimeRange(event)}`)
    );
    const recognized = calendarEventChipTargets(event, { contactsOnly: true });
    const guests = attendees
      .filter(person => !person.recognized)
      .map(person => String(person?.fullLabel || person?.label || "").trim())
      .filter(Boolean);
    if (recognized.length || guests.length) {
      const who = el("div", "light-calendar-detail-row");
      who.dataset.detailRow = "who";
      const value = el("div", "light-calendar-detail-row-value light-calendar-detail-people");
      if (recognized.length) {
        const cloud = el("div", "light-attendee-chip-cloud");
        recognized.forEach(entry => cloud.append(lightRecordChip(entry, { fromRoute: "meeting-detail" })));
        value.append(cloud);
      }
      if (guests.length) {
        value.append(el("p", "light-calendar-detail-guest-list", guests.join(", ")));
      }
      who.append(el("strong", "light-calendar-detail-row-label", "Who"), value);
      card.append(who);
    }
    const place = String(event?.metadata?.place || "").trim();
    if (place) {
      card.append(lightCalendarDetailRow("place", "Place", place));
    }
    const eventTimeZone = String(event?.metadata?.time_zone || "").trim();
    if (eventTimeZone && eventTimeZone !== calendarEffectiveTimeZone()) {
      card.append(lightCalendarDetailRow("time-zone", "Time zone", eventTimeZone));
    }
    section.append(card);
    return section;
  }

  function lightCalendarDetailRow(rowKey, label, value) {
    const row = el("div", "light-calendar-detail-row");
    row.dataset.detailRow = String(rowKey || label || "").trim().toLowerCase();
    row.append(
      el("strong", "light-calendar-detail-row-label", label),
      el("div", "light-calendar-detail-row-value", value)
    );
    return row;
  }

  function lightMeetingNotesPage() {
    return lightGraphListPage({
      title: "Meeting Notes",
      collection: "meeting-notes",
      icon: "record_voice_over",
      detailRoute: "meeting-note-detail",
      selectedKey: "selectedMeetingNoteId",
      emptyTitle: "No meeting notes yet"
    });
  }

  function lightMeetingNoteDetailPage() {
    const meeting = selectedMeetingNote();
    return lightGraphDetailPage(meeting, {
      title: "Meeting Note",
      eyebrow: "Graph meeting",
      icon: "record_voice_over",
      rows: meetingNoteDetailRows(meeting),
      fallback: "No generated meeting note page yet."
    });
  }

  function lightRemindersPage() {
    const page = lightPage("Reminders");
    page.classList.add("light-graph-page", "light-reminders-page");
    const status = lightWorkspaceStatus("reminders", "bell", "No reminders yet");
    if (status) {
      page.append(status);
      return page;
    }
    const reminders = chronologicalReminders();
    const active = reminders.filter(reminder => reminderIsActive(reminder));
    const snoozed = reminders.filter(reminder => reminderIsSnoozed(reminder));
    if (!active.length && !snoozed.length) {
      page.append(lightEmptyState("bell", "No reminders yet", "Scheduled reminders will appear here."));
      return page;
    }
    if (active.length) {
      page.append(lightReminderListSection("", active, "active"));
    }
    if (snoozed.length) {
      page.append(lightReminderListSection("Snoozed", snoozed, "snoozed"));
    }
    return page;
  }

  function lightReminderListSection(title, reminders, sectionKey = "") {
    const section = el("section", "light-reminder-list-section");
    section.dataset.reminderSection = String(sectionKey || "").trim().toLowerCase();
    if (title) {
      section.append(lightSectionTitle(title));
    }
    const list = el("div", "light-list light-graph-list");
    reminders.forEach(reminder => list.append(lightReminderRow(reminder)));
    section.append(list);
    return section;
  }

  function lightReminderDetailPage() {
    const reminder = selectedReminder();
    if (!reminder) {
      return lightPage("Reminder", { subtitle: "Reminder not found.", detail: true });
    }
    ensureLinkedCollections(reminder);
    const page = lightPage("Reminder", { detail: true });
    page.classList.add("light-document-page", "light-reminder-document");
    page.append(lightReminderDetailCard(reminder));
    page.append(lightInfoSection("Schedule", reminderDetailRows(reminder)));
    const recipientRows = reminderRecipientRows(reminder);
    if (recipientRows.length) {
      page.append(lightInfoSection("Recipients", recipientRows));
    }
    const destinationRows = reminderDestinationRows(reminder);
    if (destinationRows.length) {
      const channels = lightInfoSection("Channels", destinationRows);
      channels.classList.add("light-reminder-channels-section");
      page.append(channels);
    }
    const linkedRows = lightLinkedRecordRows(reminder);
    if (linkedRows.length) {
      page.append(lightInfoSection("Linked records", linkedRows));
    }
    return page;
  }

  function lightGraphListPage(options = {}) {
    const page = lightPage(options.title || "Workspace");
    page.classList.add("light-graph-page");
    const status = lightWorkspaceStatus(options.collection, options.icon || "apps", options.emptyTitle || "No records yet");
    if (status) {
      page.append(status);
      return page;
    }
    const list = el("div", "light-list light-graph-list");
    list.append(...workspaceItems(options.collection).map(record => lightGraphRow(record, options)));
    page.append(list);
    return page;
  }

  function lightGraphRow(record, options = {}) {
    const row = el("button", "light-card light-graph-row");
    row.type = "button";
    row.dataset.recordId = record.id;
    row.addEventListener("click", () => {
      state[options.selectedKey] = record.id;
      lightNavigate(options.detailRoute, { from: options.collection });
    });
    row.append(
      lightSmallIcon(options.icon || graphKindIcon(record.kind)),
      lightTextStack(record.title, graphListLabel(record)),
      graphObjectChips(record),
      el("span", "light-chevron", ">")
    );
    return row;
  }

  function lightReminderRow(reminder) {
    const group = reminderGroup(reminder);
    const deliveryClass = reminderDeliveryClass(reminder);
    const row = el("button", `light-card light-reminder-row ${group || ""} ${deliveryClass}`.trim());
    const copy = el("span", "light-text-stack");
    copy.append(el("strong", "", reminder.title || "Untitled reminder"));
    row.type = "button";
    row.dataset.recordId = reminder.id;
    row.dataset.reminderId = reminder.id;
    row.addEventListener("click", () => {
      state.selectedReminderId = reminder.id;
      lightNavigate("reminder-detail", { from: "reminders" });
    });
    row.append(
      lightSmallIcon("bell", "reminders"),
      copy,
      el("span", "light-reminder-time", reminderRowLabel(reminder))
    );
    return row;
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
    const linkedRows = lightLinkedRecordRows(record);
    if (linkedRows.length) {
      page.append(lightInfoSection("Linked records", linkedRows));
    }
    page.append(lightHtmlDocument(record, options.fallback, { untitledFallback: true, className: "light-detail-html-body" }));
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

  function meetingNoteDetailRows(meeting) {
    const meta = meeting?.metadata || {};
    const participants = Array.isArray(meta.participants) ? meta.participants : [];
    const sourceKind = String(meta.source_kind || "calendar_event").trim();
    const sourceId = String(meta.source_id || meta.source || "").trim();
    const rows = [
      { icon: "clock", label: "When", value: meetingTimeLabel(meeting) }
    ];
    if (sourceId) {
      rows.push({
        icon: graphKindIcon(sourceKind),
        label: "Source",
        value: workspaceTargetLabel(sourceKind, sourceId),
        target: workspaceTargetForKind(sourceKind, sourceId)
      });
    }
    if (participants.length) {
      participants.forEach((name, index) => rows.push({
        icon: "contacts",
        label: index === 0 ? "Attendees" : "Also",
        value: name,
        target: workspaceContactTargetByName(name)
      }));
    } else {
      rows.push({ icon: "contacts", label: "Attendees", value: "No attendees tagged" });
    }
    rows.push({
      icon: "note",
      label: "Topics",
      value: Array.isArray(meta.extracted_topics) && meta.extracted_topics.length ? meta.extracted_topics.join(", ") : "No topics yet"
    });
    return rows;
  }

  function reminderDetailRows(reminder) {
    return [
      { icon: "clock", accentKey: "reminders", label: "When", value: reminderScheduleLabel(reminder) }
    ];
  }

  function reminderRecipientRows(reminder) {
    return reminderRecipients(reminder).map(recipient => ({
      icon: "contacts",
      accentKey: "contacts",
      label: reminderRecipientDisplayName(recipient),
      value: recipient.kind === "self" ? "Personal delivery profile" : "Contact",
      target: workspaceTargetForKind("contact", recipient.kind === "self" ? SELF_CONTACT_ID : (recipient.contactId || recipient.id))
    }));
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
    values.slice(0, 3).forEach(value => chips.append(el("span", "light-graph-chip", value)));
    return chips;
  }

  function graphListLabel(record) {
    const timestamp = workspaceTimestamp(record.event_at_ms || record.start_at_ms || record.due_at_ms || record.updated_at_ms, "Updated");
    return `${timestamp}${DOT}${record.summary || graphKindLabel(record.kind)}`;
  }

  function calendarEventDetailRows(event, attendees = calendarEventPeople(event)) {
    if (!event) {
      return [];
    }
    const meta = event.metadata || {};
    const rows = [{
      icon: "clock",
      label: "When",
      value: `${calendarEventDayLabel(event)}${DOT}${calendarEventTimeRange(event)}`
    }];
    const place = String(meta.place || "").trim();
    if (place) {
      rows.push({ icon: "pin", label: "Place", value: place });
    }
    const eventTimeZone = String(meta.time_zone || "").trim();
    if (eventTimeZone && eventTimeZone !== calendarEffectiveTimeZone()) {
      rows.push({ icon: "globe", label: "Time zone", value: eventTimeZone });
    }
    const guests = attendees
      .filter(person => !person.recognized)
      .map(person => String(person?.fullLabel || person?.label || "").trim())
      .filter(Boolean);
    if (guests.length) {
      rows.push({
        icon: "contacts",
        label: guests.length === 1 ? "Guest" : "Guests",
        value: guests.join(", ")
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
      return "Now";
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

  function reminderSnoozePayload(reminder, reopen = false) {
    const nextDueAtMs = Date.now() + 10 * 60 * 1000;
    return {
      status: reopen ? "open" : String(reminder?.status || "").trim().toLowerCase() === "done" ? "open" : (reminder?.status || "open"),
      due_at_ms: nextDueAtMs,
      metadata: {
        delivery_state: "pending",
        last_fired_at_ms: 0,
        last_fired_due_at_ms: 0,
        last_delivery_error: "",
        last_notification_command_id: "",
        last_delivery_mode_requested: "",
        last_delivery_mode_effective: "",
        last_delivery_degraded_to: "",
        last_delivery_warnings: [],
        snoozed_until_ms: nextDueAtMs
      }
    };
  }

  function reminderDismissButton(reminder) {
    const button = lightPillButton("Dismiss", async () => {
      button.disabled = true;
      await patchWorkspaceRecord("reminders", reminder.id, {
        status: "done"
      }, { render: true });
      if (state.route === "reminder-detail") {
        lightNavigate("reminders", { from: "reminders" });
      }
    }, false);
    button.classList.add("light-reminder-dismiss");
    return button;
  }

  function reminderSnoozeButton(reminder) {
    const button = lightPillButton("Snooze 10 min", async () => {
      button.disabled = true;
      await patchWorkspaceRecord("reminders", reminder.id, reminderSnoozePayload(reminder), { render: true });
    }, false);
    button.classList.add("light-reminder-snooze");
    return button;
  }

  function lightReminderActionRow(reminder) {
    const row = el("div", "light-reminder-actions");
    row.append(reminderDismissButton(reminder), reminderSnoozeButton(reminder));
    return row;
  }

  function lightReminderDetailCard(reminder) {
    const card = el("section", `light-card light-reminder-detail-card ${reminderDeliveryClass(reminder)}`.trim());
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
    card.append(identity, lightReminderActionRow(reminder));
    return card;
  }

  function reminderGroup(reminder) {
    if (reminderIsSentHistory(reminder)) {
      return "sent";
    }
    if (reminderIsSnoozed(reminder)) {
      return "snoozed";
    }
    const due = Number(reminder?.due_at_ms || 0);
    if (Number.isFinite(due) && due > 0 && due <= Date.now()) {
      return "now";
    }
    if (Number.isFinite(due) && due > 0) {
      return "active";
    }
    return "unscheduled";
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
    return reminderDueLabel(reminder);
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
      return reminderDueLabel(reminder);
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
    if (reminderIsDismissed(reminder)) {
      return false;
    }
    const meta = reminderMetadata(reminder);
    const dueAtMs = Number(reminder?.due_at_ms || 0);
    return meta.deliveryState === "sent" && meta.lastFiredDueAtMs > 0 && meta.lastFiredDueAtMs === dueAtMs;
  }

  function reminderIsSnoozed(reminder) {
    if (reminderIsDismissed(reminder) || reminderIsSentHistory(reminder)) {
      return false;
    }
    const meta = reminderMetadata(reminder);
    return meta.snoozedUntilMs > Date.now() && meta.snoozedUntilMs === Number(reminder?.due_at_ms || 0);
  }

  function reminderIsActive(reminder) {
    return !reminderIsDismissed(reminder) && !reminderIsSentHistory(reminder) && !reminderIsSnoozed(reminder);
  }

  function activeReminderCount() {
    return workspaceItems("reminders").filter(reminder => reminderIsActive(reminder)).length;
  }

  function graphKindLabel(kind) {
    return ({
      note: "Note",
      task: "Task",
      calendar_event: "Calendar",
      feed_item: "Feed",
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
    return workspaceItems(collection).find(item => item.id === id || item.record_id === id) || null;
  }

  function workspaceTargetForKind(kind, id) {
    const normalizedKind = String(kind || "").trim();
    const normalizedId = String(id || "").trim();
    const route = ({
      note: "note-detail",
      task: "task-detail",
      calendar_event: "meeting-detail",
      feed_item: "feed-preview-detail",
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
    const parts = display.split(/\s+/).filter(Boolean);
    if (parts.length >= 2 && /^[A-Z]/i.test(parts[0]) && /^[A-Z]/i.test(parts[1])) {
      return `${parts[0]} ${parts[1].charAt(0).toUpperCase()}.`;
    }
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
    state[target.selectedKey] = target.id;
    lightNavigate(target.route, {
      from: fromRoute || state.route || "",
      selectionPatch: { [target.selectedKey]: target.id },
      preserveTaskOrigin: Boolean(options && options.taskOrigin),
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
      const collection = workspaceCollectionForKind(relatedKind);
      const bucket = collection ? workspaceBucket(collection) : null;
      if (bucket && !bucket.loaded && !bucket.loading) {
        void loadWorkspaceCollection(collection, { render: true });
      }
    });
  }

  function lightLinkedRecordRows(record) {
    const currentKind = String(record?.kind || "");
    const currentId = String(record?.id || record?.record_id || "");
    const links = Array.isArray(record?.links) ? record.links : [];
    return links.map(link => {
      const isSource = String(link.source_kind) === currentKind && String(link.source_id) === currentId;
      const relatedKind = isSource ? link.target_kind : link.source_kind;
      const relatedId = isSource ? link.target_id : link.source_id;
      const related = workspaceRecordByKind(relatedKind, relatedId);
      const label = related?.title || link.label || relatedId || graphKindLabel(relatedKind);
      const relation = link.label && link.label !== label ? `${graphKindLabel(relatedKind)}${DOT}${link.label}` : graphKindLabel(relatedKind);
      return {
        icon: graphKindIcon(relatedKind),
        accentKey: graphKindAccentKey(relatedKind),
        label,
        value: relation,
        target: workspaceTargetForKind(relatedKind, related?.id || relatedId)
      };
    });
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
    const page = lightPage("Notes");
    page.classList.add("light-notes-page");
    const status = lightWorkspaceStatus("notes", "note", "No notes yet");
    if (status) {
      page.append(status);
      return page;
    }
    const notes = workspaceItems("notes");
    const pinned = notes.filter(note => note.pinned);
    const feedWrap = el("div", "light-notes-feed");
    if (pinned.length) {
      feedWrap.append(lightNotesSection("Pinned", "pinned", pinned));
    }
    feedWrap.append(lightNotesSection("Recent", "recent", notes.filter(note => !note.pinned)));
    page.append(feedWrap);
    return page;
  }

  function lightNotesSectionHeader(title, sectionKey, count, expanded, controlsId) {
    const button = el("button", "light-notes-section-header");
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
    const section = el("section", "light-notes-section");
    section.dataset.notesSection = sectionKey;
    const expanded = noteSectionExpanded(sectionKey);
    const bodyId = `light-notes-section-${sectionKey}`;
    section.append(lightNotesSectionHeader(title, sectionKey, notes.length, expanded, bodyId));
    const body = el("div", "light-notes-section-body");
    body.id = bodyId;
    body.hidden = !expanded;
    if (expanded) {
      notes.forEach(note => body.append(lightNoteRow(note)));
    }
    section.append(body);
    return section;
  }

  function lightNoteRow(note) {
    const row = el("div", "light-note-row");
    row.setAttribute("role", "button");
    row.tabIndex = 0;
    row.setAttribute("aria-label", note.title || "Open note");
    row.dataset.noteId = note.id;
    row.dataset.notePinned = String(Boolean(note.pinned));
    const openNote = () => {
      state.selectedNoteId = note.id;
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
    const pin = lightIconButton("pin", note.pinned ? "Unpin note" : "Pin note", event => {
      if (event) {
        event.preventDefault();
        event.stopPropagation();
      }
      void toggleNotePin(note.id);
    }, "light-note-pin-button");
    pin.addEventListener("keydown", event => {
      if (event.key === "Enter" || event.key === " ") {
        event.stopPropagation();
      }
    });
    pin.dataset.noteId = note.id;
    pin.dataset.notePinned = String(Boolean(note.pinned));
    pin.setAttribute("aria-pressed", String(Boolean(note.pinned)));
    pin.innerHTML = iconSvg("pin", { filled: Boolean(note.pinned) });
    row.append(copy, pin);
    return row;
  }

  function lightNoteDetailPage() {
    const note = selectedNote();
    if (!note) {
      return lightPage("Note", { subtitle: "Note not found.", detail: true });
    }
    const page = lightPage(note.title || "Untitled note", { detail: true });
    page.classList.add("light-document-page", "light-note-document", "light-note-detail-page");
    page.append(lightHtmlDocument(note, "No generated note page yet.", { untitledFallback: true, className: "light-detail-html-body" }));
    return page;
  }

  async function toggleNotePin(noteId) {
    const bucket = workspaceBucket("notes");
    const recordId = String(noteId || "").trim();
    const items = workspaceItems("notes");
    if (!recordId || !items.length) {
      return;
    }
    const note = items.find(item => String(item.id || "") === recordId);
    if (!note) {
      return;
    }
    const previousItems = bucket.items.slice();
    const previousError = bucket.error;
    const previousNotesSectionsExpanded = { ...state.notesSectionsExpanded };
    const nextPinned = !Boolean(note.pinned);
    const toggled = { ...note, pinned: nextPinned };
    const pinned = [];
    const recent = [];
    previousItems.forEach(item => {
      if (String(item.id || "") === recordId) {
        return;
      }
      if (item.pinned) {
        pinned.push(item);
        return;
      }
      recent.push(item);
    });
    bucket.items = nextPinned
      ? [toggled, ...pinned, ...recent]
      : [...pinned, toggled, ...recent];
    setNotesSectionExpanded(nextPinned ? "pinned" : "recent", true);
    bucket.error = "";
    render();
    const updated = await patchWorkspaceRecord("notes", note.id, { pinned: nextPinned }, { render: false });
    if (!updated) {
      bucket.items = previousItems;
      bucket.error = previousError;
      state.notesSectionsExpanded = previousNotesSectionsExpanded;
      render();
      return;
    }
    render();
  }

  function lightTasksPage() {
    if (taskUsesSplitLayout()) {
      return lightTaskWorkspacePage();
    }
    ensureTaskPeopleContactsLoaded(workspaceItems("tasks"));
    const page = lightPage("Tasks");
    page.classList.add("light-tasks-page");
    const status = lightWorkspaceStatus("tasks", "checklist", "No tasks yet");
    if (status) {
      page.append(status);
      return page;
    }
    page.append(lightTaskFilters());
    renderTaskGroups(page);
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

  function initialTaskFilter(value) {
    const normalized = String(value || "").trim();
    return ["all", "todo", "in_progress", "waiting", "done"].includes(normalized) ? normalized : "all";
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

  function lightTaskCounts() {
    return workspaceItems("tasks").reduce((counts, task) => {
      const group = String(task.derived_group || "do");
      if (group === "overdue") {
        counts.overdue += 1;
      } else if (group === "done") {
        counts.done += 1;
      } else if (group === "do") {
        counts.due += 1;
      } else if (group === "soon") {
        counts.dueSoon += 1;
      }
      return counts;
    }, { due: 0, dueSoon: 0, overdue: 0, done: 0 });
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

  function taskStatusFilterChoices() {
    return [
      ["all", "All"],
      ["todo", "To do"],
      ["in_progress", "In progress"],
      ["waiting", "Waiting"],
      ["done", "Done"],
    ];
  }

  function currentTaskFilterChoice() {
    return taskStatusFilterChoices().find(([key]) => key === state.taskFilter) || taskStatusFilterChoices()[0];
  }

  function taskStatusCounts() {
    return workspaceItems("tasks").reduce((counts, task) => {
      const status = normalizedTaskStatus(task);
      counts.all += 1;
      counts[status] += 1;
      return counts;
    }, {
      all: 0,
      todo: 0,
      in_progress: 0,
      waiting: 0,
      done: 0,
    });
  }

  function lightTaskGroup(tasks, group) {
    const card = el("div", "light-card light-task-card light-task-group");
    tasks.forEach(task => {
      const row = el("div", `light-task-row ${taskRowTone(task)}`);
      row.dataset.taskId = task.id;
      row.dataset.taskStatus = normalizedTaskStatus(task);
      const statusTrigger = el("button", "light-task-row-status-trigger");
      statusTrigger.type = "button";
      statusTrigger.dataset.taskStatusTrigger = "true";
      statusTrigger.setAttribute("aria-label", `Change status for ${task.title || "task"}`);
      statusTrigger.append(el("span", taskCheckCircleClass(task)));
      statusTrigger.addEventListener("click", event => {
        event.preventDefault();
        event.stopPropagation();
        openTaskStatusSelector(task);
      });
      const main = el("button", "light-task-row-main");
      main.type = "button";
      main.addEventListener("pointerdown", () => row.classList.add("is-pressed"));
      main.addEventListener("pointerup", () => row.classList.remove("is-pressed"));
      main.addEventListener("pointercancel", () => row.classList.remove("is-pressed"));
      main.addEventListener("blur", () => row.classList.remove("is-pressed"));
      main.addEventListener("click", () => openTaskFromList(task));
      const copy = el("span", "light-task-row-copy");
      copy.append(el("strong", "light-task-row-title", task.title || "Untitled task"));
      const trailing = el("span", "light-task-row-trailing");
      const badge = lightTaskStatusBadge(normalizedTaskStatus(task), { compact: true });
      if (badge) {
        trailing.append(badge);
      }
      trailing.append(el("span", "light-due", taskDueLabel(task)));
      main.append(copy, trailing);
      row.append(statusTrigger, main);
      card.append(row);
    });
    return card;
  }

  function lightTaskFilters() {
    const wrap = el("div", "light-task-filter-strip");
    const [currentKey, currentLabel] = currentTaskFilterChoice();
    const counts = taskStatusCounts();
    const button = el("button", "light-pill is-active light-task-filter-button");
    button.type = "button";
    button.dataset.taskFilter = currentKey;
    button.dataset.taskFilterCurrent = currentKey;
    button.setAttribute("aria-haspopup", "dialog");
    button.setAttribute("aria-label", `Filter tasks: ${currentLabel}`);
    const icon = el("span", "light-task-filter-button-icon");
    icon.innerHTML = iconSvg("tune", { filled: true });
    const copy = el("span", "light-task-filter-button-copy");
    copy.append(el("span", "light-task-filter-button-label", currentLabel));
    const chevron = el("span", "light-task-filter-button-chevron");
    chevron.innerHTML = iconSvg("navigate_next");
    button.append(icon, copy, chevron);
    button.addEventListener("click", event => {
      event.preventDefault();
      openSettingsSelector({
        title: "Filter tasks",
        currentValue: currentKey,
        options: taskStatusFilterChoices().map(([value, label]) => ({
          value,
          label,
          meta: String(counts[value] || 0),
        })),
        onSelect: value => {
          state.taskFilter = String(value || "all");
          render();
        },
      });
    });
    wrap.append(button);
    return wrap;
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

  function taskCreatedBy(task) {
    return String(task?.created_by || task?.metadata?.created_by || "").trim();
  }

  function taskDescription(task) {
    return String(task?.description || task?.summary || task?.metadata?.description || "").trim();
  }

  function taskChecklist(task) {
    return Array.isArray(task?.checklist) ? task.checklist : [];
  }

  function taskOwners(task) {
    const owners = [];
    const append = value => {
      const name = String(value || "").trim();
      if (name && !owners.includes(name)) {
        owners.push(name);
      }
    };
    append(task?.owner);
    append(task?.metadata?.owner);
    const explicitOwners = Array.isArray(task?.owners)
      ? task.owners
      : (Array.isArray(task?.metadata?.owners) ? task.metadata.owners : []);
    explicitOwners.forEach(append);
    return owners;
  }

  function taskPrimaryOwner(task) {
    const createdBy = taskCreatedBy(task);
    return taskOwners(task).find(name => name !== createdBy) || "";
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

  function taskCreatedByTarget(task) {
    const createdBy = taskCreatedBy(task);
    if (!createdBy) {
      return null;
    }
    return workspaceContactTargetByName(createdBy);
  }

  function ensureTaskPeopleContacts(task) {
    ensureTaskPeopleContactsLoaded([task]);
  }

  function ensureTaskPeopleContactsLoaded(tasks) {
    const items = Array.isArray(tasks) ? tasks : [];
    if (!items.some(task => taskCreatedBy(task) || taskPrimaryOwner(task))) {
      return;
    }
    const bucket = workspaceBucket("contacts");
    if (!bucket.loaded && !bucket.loading) {
      void loadWorkspaceCollection("contacts", { render: true });
    }
  }

  function taskDetailRows(task) {
    return [
      { icon: "clock", accentKey: "meetings", label: "Created", value: taskDateTimeLabel(task.created_at_ms, "Unknown") },
      { icon: "calendar", accentKey: "calendar", label: "Due", value: taskDateTimeLabel(task.due_at_ms, "No due date") },
    ];
  }

  function lightTaskPeopleSection(task) {
    const origin = { taskId: task.id, route: taskDetailReturnRoute() };
    const entries = [];
    const createdBy = taskCreatedBy(task);
    if (createdBy) {
      entries.push({
        role: "Created by",
        datasetRole: "created_by",
        contactName: createdBy,
      });
    }
    const owner = taskPrimaryOwner(task);
    if (owner) {
      entries.push({
        role: "Owner",
        datasetRole: "owner",
        contactName: owner,
      });
    }
    if (!entries.length) {
      return null;
    }
    const section = el("section", "light-info-section");
    section.append(lightSectionTitle("People"));
    const card = el("div", "light-card light-task-people-card");
    entries.forEach(entry => {
      const row = el("div", "light-task-person-row");
      row.dataset.taskPersonRole = entry.datasetRole;
      row.append(el("span", "light-task-person-label", entry.role));
      row.append(lightRecordChip({
        label: entry.contactName,
        kind: "contact",
        target: workspaceContactTargetByName(entry.contactName),
      }, {
        fromRoute: origin.route,
        taskOrigin: origin,
      }));
      card.append(row);
    });
    section.append(card);
    return section;
  }

  function taskAttachmentTargets(task) {
    const links = Array.isArray(task?.links) ? task.links : [];
    const seen = new Set();
    const allowedKinds = new Set(["calendar_event", "contact", "project", "note", "meeting_note", "reminder"]);
    const ordered = [];
    links.forEach(link => {
      const isSource = String(link.source_kind) === "task" && String(link.source_id) === String(task?.id || task?.record_id || "");
      const relatedKind = String(isSource ? link.target_kind : link.source_kind);
      if (!allowedKinds.has(relatedKind)) {
        return;
      }
      const relatedId = String(isSource ? link.target_id : link.source_id);
      const related = workspaceRecordByKind(relatedKind, relatedId);
      const target = workspaceTargetForKind(relatedKind, related?.id || relatedId);
      const key = target?.kind && target?.id ? `${target.kind}:${target.id}` : `${relatedKind}:${relatedId}`;
      if (!target || seen.has(key)) {
        return;
      }
      seen.add(key);
      ordered.push({
        label: String(related?.title || link.label || graphKindLabel(relatedKind)).trim() || graphKindLabel(relatedKind),
        target,
        kind: relatedKind
      });
    });
    const order = ["calendar_event", "contact", "project", "note", "meeting_note", "reminder"];
    ordered.sort((left, right) => order.indexOf(left.kind) - order.indexOf(right.kind));
    return ordered;
  }

  async function updateTaskStatus(task, nextStatus) {
    await patchWorkspaceRecord("tasks", task.id, { status: nextStatus }, { render: true });
  }

  async function toggleTaskChecklistItem(task, itemId) {
    const items = taskChecklist(task).map(item => (
      String(item.id || "") === String(itemId || "")
        ? { ...item, done: !Boolean(item.done) }
        : item
    ));
    await patchWorkspaceRecord("tasks", task.id, { checklist: items }, { render: true });
  }

  function taskStatusSelectorOptions() {
    return [
      ["todo", "To do"],
      ["in_progress", "In progress"],
      ["waiting", "Waiting"],
      ["done", "Done"],
    ].map(([value, label]) => {
      const leading = el("span", "settings-selector-status-icon");
      leading.append(el("span", taskStatusCircleClass(value)));
      return { value, label, leadingNode: leading };
    });
  }

  function openTaskStatusSelector(task) {
    const current = normalizedTaskStatus(task);
    openSettingsSelector({
      title: "Task status",
      currentValue: current,
      options: taskStatusSelectorOptions(),
      onSelect: async value => {
        const next = String(value || current);
        if (next === current) {
          return;
        }
        await updateTaskStatus(task, next);
      },
    });
  }

  function lightTaskStatusControl(task) {
    const control = el("div", "light-task-status-control");
    const current = normalizedTaskStatus(task);
    const button = el("button", "light-pill is-active light-task-status-trigger");
    button.type = "button";
    button.dataset.taskStatus = current;
    button.setAttribute("aria-haspopup", "dialog");
    button.setAttribute("aria-label", `Change status: ${taskStatusLabel(current)}`);
    const icon = el("span", "light-task-status-trigger-icon");
    icon.append(el("span", taskStatusCircleClass(current)));
    const copy = el("span", "light-task-status-trigger-copy");
    copy.append(el("span", "light-task-status-trigger-label", taskStatusLabel(current)));
    const chevron = el("span", "light-task-status-trigger-chevron");
    chevron.innerHTML = iconSvg("navigate_next");
    button.append(icon, copy, chevron);
    button.addEventListener("click", event => {
      event.preventDefault();
      openTaskStatusSelector(task);
    });
    control.append(button);
    return control;
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
      row.addEventListener("click", async () => {
        row.disabled = true;
        await toggleTaskChecklistItem(task, item.id);
      });
      row.append(
        el("span", item.done ? "light-check-circle done" : "light-check-circle"),
        el("span", "light-task-checklist-label", String(item.label || "Checklist item"))
      );
      card.append(row);
    });
    section.append(card);
    return section;
  }

  function lightTaskAttachmentsSection(task) {
    const attachments = taskAttachmentTargets(task);
    if (!attachments.length) {
      return null;
    }
    const section = el("section", "light-info-section");
    section.append(lightSectionTitle("Attached"));
    const card = el("div", "light-card light-task-attachment-card");
    const cloud = el("div", "light-chip-cloud light-task-chip-cloud");
    const origin = { taskId: task.id, route: taskDetailReturnRoute() };
    attachments.forEach(entry => {
      cloud.append(lightRecordChip(entry, {
        fromRoute: origin.route,
        taskOrigin: origin
      }));
    });
    card.append(cloud);
    section.append(card);
    return section;
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
    const card = el("section", `light-card light-task-detail-card ${taskRowTone(task)}`);
    const statusTrigger = el("button", "light-task-status-circle-trigger");
    statusTrigger.type = "button";
    statusTrigger.dataset.taskStatusTrigger = "true";
    statusTrigger.setAttribute("aria-label", `Change status for ${task.title || "task"}`);
    statusTrigger.append(el("span", taskCheckCircleClass(task)));
    statusTrigger.addEventListener("click", event => {
      event.preventDefault();
      event.stopPropagation();
      openTaskStatusSelector(task);
    });
    const copy = el("div", "light-task-detail-copy");
    copy.append(
      el("strong", "light-task-detail-title", task.title || "Untitled task"),
      el("span", "light-task-detail-due", taskDueLabel(task))
    );
    card.append(statusTrigger, copy, lightTaskStatusControl(task));
    return card;
  }

  function lightTaskDetailSurface(task) {
    const surface = el("div", "light-task-detail-surface");
    surface.dataset.taskDetailId = String(task?.id || "");
    surface.dataset.taskStatus = normalizedTaskStatus(task);
    surface.append(lightTaskDetailCard(task));
    ensureTaskPeopleContacts(task);
    const description = taskDescription(task);
    if (description) {
      surface.append(lightCopySection("Description", description));
    }
    surface.append(lightInfoSection("Details", taskDetailRows(task)));
    const people = lightTaskPeopleSection(task);
    if (people) {
      surface.append(people);
    }
    const checklist = lightTaskChecklistSection(task);
    if (checklist) {
      surface.append(checklist);
    }
    const attachments = lightTaskAttachmentsSection(task);
    if (attachments) {
      surface.append(attachments);
    }
    return surface;
  }

  function renderTaskGroups(container) {
    [
      ["overdue", "Overdue"],
      ["do", "Today"],
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
    ensureTaskPeopleContactsLoaded(workspaceItems("tasks"));
  }

  function lightTaskWorkspacePage() {
    const page = lightPage("Tasks");
    page.classList.add("light-tasks-page", "light-task-workspace-page");
    const status = lightWorkspaceStatus("tasks", "checklist", "No tasks yet");
    if (status) {
      page.append(status);
      return page;
    }
    const shell = el("div", "light-task-workspace");
    const listPane = el("section", "light-task-list-pane");
    listPane.append(lightTaskFilters());
    renderTaskGroups(listPane);
    const detailPane = el("section", "light-task-detail-pane");
    const task = selectedTask();
    if (task) {
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

  function lightFeedPage() {
    const page = lightPage("Feed");
    const status = lightWorkspaceStatus("feed-items", "text", "No feed items yet");
    if (status) {
      page.append(status);
      return page;
    }
    const items = workspaceItems("feed-items");
    const todayItems = items.filter(item => dateKey(new Date(Number(item.event_at_ms || item.updated_at_ms || 0))) === todayDateKey());
    const olderItems = items.filter(item => dateKey(new Date(Number(item.event_at_ms || item.updated_at_ms || 0))) !== todayDateKey());
    page.append(lightSectionTitle("Today"));
    const list = el("div", "light-list");
    list.append(...(todayItems.length ? todayItems : items.slice(0, 3)).map(lightFeedRow));
    page.append(list);
    if (olderItems.length) {
      const older = el("div", "light-list");
      older.append(...olderItems.map(lightFeedRow));
      page.append(lightSectionTitle("Older"), older);
    }
    return page;
  }

  function lightFeedRow(item) {
      const row = el("button", "light-card light-feed-row");
      row.type = "button";
      row.dataset.feedId = item.id;
      row.addEventListener("click", () => {
        state.selectedFeedId = item.id;
        lightNavigate("feed-preview-detail", { from: "feed-preview" });
      });
    row.append(lightSmallIcon(item.metadata?.icon || "text"), lightTextStack(item.title, `${workspaceTimestamp(item.event_at_ms || item.updated_at_ms, "Updated")}${DOT}${item.summary || item.metadata?.type || "Workspace"}`), el("span", "light-chevron", ">"));
    return row;
  }

  function lightFeedDetailPage() {
    const item = selectedFeedItem();
    if (!item) {
      return lightPage("Feed Item", { subtitle: "Feed item not found.", detail: true });
    }
    ensureLinkedCollections(item);
    const page = lightPage("Feed Item", { detail: true });
    page.classList.add("light-document-page", "light-feed-document");
    const article = el("article", "light-doc-article");
    article.append(
      lightDocumentEyebrow(item.metadata?.type || "Workspace feed", workspaceTimestamp(item.event_at_ms || item.updated_at_ms, "Updated")),
      el("h1", "", item.title),
      el("p", "light-note-body", item.summary || "")
    );
    page.append(article);
    const relatedRows = lightLinkedRecordRows(item);
    if (relatedRows.length) {
      page.append(lightInfoSection("Related", relatedRows));
    }
    page.append(lightHtmlDocument(item, "No generated feed page yet.", { untitledFallback: true, className: "light-detail-html-body" }));
    return page;
  }

  function lightProjectsPage() {
    const page = lightPage("Projects");
    const list = el("div", "light-list");
    const status = lightWorkspaceStatus("projects", "folder", "No projects yet");
    if (status) {
      page.append(status);
      return page;
    }
    list.append(...allProjects().map(project => {
      const row = el("button", "light-card light-project-row");
      row.type = "button";
      row.dataset.projectId = project.id;
      row.addEventListener("click", () => {
        state.selectedProjectId = project.id;
        lightNavigate("project-detail", { from: "projects" });
      });
      const chips = el("span", "light-project-chip-row");
      projectChips(project).forEach(chip => chips.append(el("span", "light-project-chip", chip)));
      row.append(lightSmallIcon("folder"), lightTextStack(project.title, `${workspaceTimestamp(project.updated_at_ms, "Updated")}${DOT}${project.summary || "Project"}`), chips);
      return row;
    }));
    page.append(list);
    return page;
  }

  function lightProjectDetailPage() {
    const project = selectedProject();
    if (!project) {
      return lightPage("Project", { subtitle: "Project not found.", detail: true });
    }
    ensureLinkedCollections(project);
    const page = lightPage(project.title, { detail: true });
    page.append(lightDetailHero(project.title, `${workspaceTimestamp(project.updated_at_ms, "Updated")}${DOT}${project.summary || "Project"}`, "folder"));
    page.append(lightChipCloud(projectChips(project)));
    const grid = el("div", "light-project-section-grid");
    [
      ["Threads", "chat", projectThreads(project)],
      ["Artifacts", "attachment", projectAssets(project)],
      ["Meetings", "record_voice_over", projectLinked(project, "meeting_note")],
      ["Notes", "note", projectLinked(project, "note")],
      ["Tasks", "checklist", projectLinked(project, "task")],
      ["Calendar", "calendar", projectLinked(project, "calendar_event")],
      ["Feed", "text", projectLinked(project, "feed_item")],
      ["People", "contacts", projectLinked(project, "contact")],
      ["Reminders", "bell", projectLinked(project, "reminder")]
    ].forEach(([title, icon, items]) => grid.append(lightProjectSection(title, icon, items)));
    page.append(grid);
    page.append(lightHtmlDocument(project, "No generated project page yet.", { untitledFallback: true, className: "light-detail-html-body" }));
    return page;
  }

  function lightProjectCreatePage() {
    const page = lightPage("New Project");
    const card = el("section", "light-card light-project-create-card");
    const name = el("input", "light-project-input");
    name.type = "text";
    name.placeholder = "Project name";
    name.value = "New project";
    const hints = el("div", "light-create-options");
    [
      ["chat", "Threads", "Collect related conversations"],
      ["attachment", "Artifacts", "Roll up files and generated pages"],
      ["checklist", "Tasks", "Track follow-ups in one folder"]
    ].forEach(([icon, label, value]) => {
      const option = el("div", "light-create-option");
      option.append(lightSmallIcon(icon), lightTextStack(label, value));
      hints.append(option);
    });
    const create = lightPillButton("Create project", async () => {
      const title = name.value.trim() || "New project";
      const record = await upsertWorkspaceRecord("projects", {
        id: `project-${Date.now()}`,
        title,
        summary: "Workspace project folder for threads, generated pages, links, tasks, and people.",
        metadata: {
          threads: ["Drop related chat threads here"],
          assets: ["Generated pages and files will appear here"],
          chips: ["1 thread", "Draft"]
        }
      }, { render: false });
      if (record) {
        state.selectedProjectId = record.id;
        lightNavigate("project-detail", { from: "projects" });
      }
    }, false);
    card.append(lightSmallIcon("folder"), lightTextStack("Project folder", "A lightweight rollup of chats, artifacts, notes, tasks, meetings, and people."), name, hints, create);
    page.append(card);
    return page;
  }

  function lightProjectSection(title, icon, items) {
    const section = el("section", "light-card light-project-section");
    section.append(lightSmallIcon(icon), el("h3", "", title));
    const list = el("div", "light-project-section-items");
    const values = Array.isArray(items) && items.length ? items : ["Nothing linked yet"];
    values.forEach(item => list.append(lightProjectSectionItem(item)));
    section.append(list);
    return section;
  }

  function lightProjectSectionItem(item) {
    if (!item || typeof item !== "object") {
      return el("span", "light-project-section-item", String(item || ""));
    }
    const interactive = Boolean(item.target?.route && item.target?.id && item.target?.selectedKey);
    const row = el(interactive ? "button" : "span", interactive ? "light-project-section-item is-clickable" : "light-project-section-item");
    if (interactive) {
      row.type = "button";
      row.dataset.workspaceTargetRoute = item.target.route;
      row.dataset.workspaceTargetId = item.target.id;
      row.dataset.workspaceTargetKind = item.target.kind || "";
      row.addEventListener("click", () => openWorkspaceTarget(item.target, "project-detail"));
    }
    row.append(
      el("span", "", item.label || ""),
      interactive ? el("span", "light-chevron", ">") : el("span", "", item.detail || "")
    );
    return row;
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
    const page = el("section", "light-page light-canonical-port-page light-inbox-page");
    page.append(lightHeader("Inbox"));
    const surface = el("section", "light-canonical-port-surface light-inbox-surface");
    surface.append(...homeFeedContentNodes());
    page.append(surface);
    return page;
  }

  function lightMeetingsPage() {
    const page = el("section", "light-page light-canonical-port-page light-meetings-page");
    page.append(lightHeader("Meetings"));
    const surface = el("section", "light-canonical-port-surface light-meetings-surface");
    surface.append(meetingsPageView({ embedded: true }));
    page.append(surface);
    return page;
  }

  function lightPage(title, options = {}) {
    const page = el("section", "light-page");
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
    header.append(left, heading, right);
    shell.append(header);
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
      "meeting-detail": "selectedMeetingId",
      "meeting-note-detail": "selectedMeetingNoteId",
      "reminder-detail": "selectedReminderId",
      "note-detail": "selectedNoteId",
      "task-detail": "selectedTaskId",
      "feed-preview-detail": "selectedFeedId",
      "project-detail": "selectedProjectId",
      "contact-detail": "selectedContactId",
      "contact-edit": "selectedContactId"
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
    void loadWorkspaceForRoute(state.route, { render: true, force: true });
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
    if (currentSnapshot && lightRouteSnapshotIdentity(currentSnapshot) !== lightRouteSnapshotIdentity(targetSnapshot)) {
      pushLightRouteHistory(currentSnapshot);
    }
    if (options.from) {
      state.previousLightRoute = options.from;
    } else if (state.route && state.route !== nextRoute && state.route !== "home") {
      state.previousLightRoute = state.route;
    } else {
      state.previousLightRoute = "home";
    }
    applyLightRouteSelectionPatch(selectionPatch || {});
    state.route = nextRoute;
    state.lightReturnRoute = state.route === "home" ? "" : "home";
    persistNavState();
    render();
    resetLightRouteScroll();
    runLightRouteSideEffects("light_app_click");
  }

  function lightBack() {
    if (linksHandoffLocked()) {
      releaseLinksHandoff({ render: false, reason: "light_back" });
      return true;
    }
    if (!isHomeShellRoute() || state.route === "home") {
      return false;
    }
    const snapshot = popLightRouteHistory();
    if (snapshot) {
      state.taskNavOrigin = null;
      return restoreLightRouteSnapshot(snapshot);
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
    return lightTextStack(contact.title, `${contact.summary || "Contact"}${activity ? `${DOT}${activity}` : ""}`);
  }

  function lightAvatar(contact, size = "") {
    const meta = contact.metadata || {};
    const photo = String(meta.photo || "");
    const initials = String(meta.avatar || contact.title || "?").slice(0, 2).toUpperCase();
    const hasPhoto = Boolean(photo);
    const avatar = el("span", `light-avatar ${hasPhoto ? "has-photo" : ""} ${size}`.trim(), hasPhoto ? "" : initials);
    avatar.setAttribute("aria-label", contact.title);
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

  function lightEmptyState(icon, title, detail) {
    const empty = el("section", "light-empty-state");
    empty.append(lightAppIcon(icon, "sky"), el("h2", "", title), el("p", "", detail));
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

  function lightInfoSection(title, rows) {
    const section = el("section", "light-info-section");
    section.append(lightSectionTitle(title));
    const card = el("div", "light-card light-info-card");
    rows.forEach(row => {
      const isInteractive = Boolean(row?.target?.route && row?.target?.id && row?.target?.selectedKey);
      const item = el(isInteractive ? "button" : "div", isInteractive ? "light-info-row is-clickable" : "light-info-row");
      if (isInteractive) {
        item.type = "button";
        item.dataset.workspaceTargetRoute = row.target.route;
        item.dataset.workspaceTargetId = row.target.id;
        item.dataset.workspaceTargetKind = row.target.kind || "";
        item.addEventListener("click", () => openWorkspaceTarget(row.target, state.route));
      }
      item.append(lightSmallIcon(row.icon, row.accentKey || row.accent || ""), lightTextStack(row.label, row.value), isInteractive ? el("span", "light-chevron", ">") : el("span", ""));
      card.append(item);
    });
    section.append(card);
    return section;
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

  function lightCalendarEventChips(event, options = {}) {
    const row = el("div", "light-event-chip-row");
    const chipTargets = calendarEventChipTargets(event, options);
    const limit = Math.max(0, Number(options.limit || 0) || 0);
    const visible = limit > 0 ? chipTargets.slice(0, limit) : chipTargets;
    if (visible.length) {
      visible.forEach(entry => row.append(lightRecordChip(entry, { fromRoute: options.fromRoute || state.route || "" })));
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
      return chips;
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
    return chips;
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
        openWorkspaceTarget(target, options.fromRoute || state.route || "", { taskOrigin: options.taskOrigin || null });
      });
    }
    return chip;
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

  function lightDetailHero(title, detail, icon) {
    const hero = el("section", "light-card light-detail-hero");
    hero.append(lightSmallIcon(icon), lightTextStack(title, detail));
    return hero;
  }

  function lightChipCloud(chips) {
    const cloud = el("div", "light-chip-cloud");
    chips.forEach(chip => cloud.append(el("span", "", chip)));
    return cloud;
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

  function calendarStripWindowSize() {
    return typeof window !== "undefined" && window.innerWidth >= 768 ? 21 : 15;
  }

  function calendarStripDays(dayKey = selectedCalendarDateKey()) {
    const count = calendarStripWindowSize();
    const start = -Math.floor(count / 2);
    return Array.from({ length: count }, (_, index) => shiftCalendarDateKey(dayKey, start + index));
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
      const byFilter = state.taskFilter === "all"
        || normalizedTaskStatus(task) === state.taskFilter;
      return taskGroup === group && byFilter;
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

  function projectChips(project) {
    const meta = project?.metadata || {};
    if (Array.isArray(meta.chips) && meta.chips.length) {
      return meta.chips.map(String);
    }
    const threads = projectThreads(project).filter(item => item !== "Nothing linked yet").length;
    const links = Array.isArray(project?.links) ? project.links.length : 0;
    return [`${threads} thread${threads === 1 ? "" : "s"}`, `${links} link${links === 1 ? "" : "s"}`];
  }

  function projectThreads(project) {
    const threads = project?.metadata?.threads;
    return Array.isArray(threads) ? threads.map(String).filter(Boolean) : [];
  }

  function projectAssets(project) {
    const assets = project?.metadata?.assets;
    return Array.isArray(assets) ? assets.map(String).filter(Boolean) : [];
  }

  function projectLinked(project, kind) {
    const links = Array.isArray(project?.links) ? project.links : [];
    return links
      .filter(link => (
        String(link.source_kind) === "project" && String(link.target_kind) === kind
      ) || (
        String(link.target_kind) === "project" && String(link.source_kind) === kind
      ))
      .map(link => {
        const isSource = String(link.source_kind) === "project";
        const relatedKind = isSource ? link.target_kind : link.source_kind;
        const relatedId = isSource ? link.target_id : link.source_id;
        const related = workspaceRecordByKind(relatedKind, relatedId);
        return {
          label: String(related?.title || link.label || relatedId || kind),
          detail: graphKindLabel(relatedKind),
          target: workspaceTargetForKind(relatedKind, related?.id || relatedId)
        };
      });
  }

  function isLightDetailRoute(route) {
    return [
      "meeting-detail",
      "message-detail",
      "meeting-note-detail",
      "reminder-detail",
      "note-detail",
      "task-detail",
      "feed-preview-detail",
      "project-detail",
      "contact-detail",
      "contact-edit"
    ].includes(String(route || ""));
  }

  function selectedFeedItem() {
    return workspaceItems("feed-items").find(item => item.id === state.selectedFeedId) || workspaceItems("feed-items")[0] || null;
  }

  function selectedWorkspaceRecord(collection, id, fallback = null) {
    return workspaceItems(collection).find(item => item.id === id || item.record_id === id) || workspaceItems(collection)[0] || fallback;
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
    const direct = String(record.html || "");
    if (direct) {
      return direct;
    }
    const assetId = String(record.html_asset_id || "");
    if (!assetId) {
      return "";
    }
    const cached = state.workspace.assets[assetId];
    if (cached && String(cached.text || "")) {
      return String(cached.text || "");
    }
    void loadWorkspaceAsset(assetId, { render: true });
    return "";
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

  function lightHtmlDocument(record, fallbackText = "Generated page is loading.", options = {}) {
    const html = workspaceHtml(record);
    const untitledFallback = Boolean(options && options.untitledFallback);
    const extraClassName = String(options && options.className || "").trim();
    if (!html) {
      if (untitledFallback) {
        return el("section", `light-html-empty ${extraClassName}`.trim(), fallbackText);
      }
      return lightCopySection("Generated page", fallbackText);
    }
    const frame = el("iframe", "light-html-frame");
    frame.setAttribute("sandbox", "");
    frame.setAttribute("title", String(record?.title || "Generated page"));
    frame.srcdoc = normalizedWorkspaceHtmlDocument(html);
    const wrap = el("section", `light-card light-html-card ${extraClassName}`.trim());
    wrap.append(frame);
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
    const hero = el("article", "settings-hero");
    const heroIcon = el("div", "settings-hero-icon");
    heroIcon.innerHTML = iconSvg("settings", { filled: true });
    const heroCopy = el("div", "settings-hero-copy");
    heroCopy.append(
      el("h1", "settings-title", "Settings"),
      el("p", "settings-subtitle", "Wake, walkie, feedback")
    );
    hero.append(heroIcon, heroCopy);
    page.append(
      hero,
      appearanceSettingsCard(),
      defaultAudioSpeedSettingCard(),
      replyModeSettingsCard(),
      wakeWordSettingsCard(),
      arrivalCueSettingsCard(),
      modelSettingsCard(),
      reasoningEffortSettingsCard(),
      phoneRoleSettingsCard(),
      advancedSettingsCard()
    );
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
      return "Web preview is read-only for phone-role state. Add api_token and, when needed, device_id to sync a real device, or open the APK on your phone to manage it.";
    }
    if (status.source === "browser_live_api") {
      if (status.error_code === "unauthorized") {
        return "Web preview could not authenticate device state. Add a valid api_token to view the real phone-role status here.";
      }
      if (status.error_code === "device_context_unavailable") {
        return "Web preview could not choose a device. Add device_id or bring exactly one online device into context before reloading.";
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
    row.style.setProperty("--accent", "#ff6c5f");
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
    const refresh = el("button", "meetings-refresh", "Refresh");
    refresh.type = "button";
    refresh.addEventListener("click", () => loadMeetings({ render: true }));
    if (embedded) {
      const toolbar = el("div", "meetings-embedded-toolbar");
      toolbar.append(refresh);
      page.append(toolbar);
    } else {
      const header = el("div", "meetings-header");
      header.append(
        el("div", "meetings-kicker", "Meeting Recording Mode"),
        el("h2", "meetings-title", "Meetings")
      );
      header.append(refresh);
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
      return openMeetingSummaryDetail(record, options);
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
      if (stateName === "completed") {
        openDetail(detail, { scrollTop: state.navDetail?.scroll_top });
        return;
      }
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
    return assistantAttachments.length > 0;
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
      transcript_messages: meetingTranscriptMessages(card),
      is_meeting_recording: true,
      render_profile: "meeting_list",
      meeting_record: card
    };
  }

  function meetingRecordAttachments(meeting) {
    const record = meeting && typeof meeting === "object" ? meeting : {};
    const card = record.card && typeof record.card === "object" ? record.card : {};
    const meetingId = String(record.meeting_id || "").trim();
    const attachments = [];
    const summaryArtifactId = meetingId ? `pucky_card_${meetingId}:html` : "";
    const transcriptArtifactId = meetingId ? `pucky_card_${meetingId}:meeting_transcript` : "";
    const transcriptHtmlArtifactId = meetingId ? `pucky_card_${meetingId}:meeting_transcript_html` : "";
    const summaryHtmlBase64 = String(card.html_base64 || "").trim();
    const summaryHtmlText = decodeMeetingSummaryBase64(summaryHtmlBase64);
    const transcriptHtmlUrl = extractMeetingSummaryLink(summaryHtmlText, /<a\b[^>]*href=["']([^"']*\/api\/shared\/artifacts\/[^"']+)["'][^>]*>/i);
    const signedAudioUrl = extractMeetingSummaryLink(summaryHtmlText, /<a\b[^>]*href=["']([^"']*\/api\/shared\/meetings\/[^"']*\/audio[^"']*)["'][^>]*>/i);
    if (summaryHtmlBase64) {
      attachments.push({
        id: `meeting-summary-${meetingId || "current"}`,
        title: "Meeting Summary",
        kind: "html",
        mime_type: String(card.html_mime_type || "text/html"),
        data_url: `data:text/html;base64,${summaryHtmlBase64}`,
        viewer_src: `data:text/html;base64,${summaryHtmlBase64}`,
        html_src: `data:text/html;base64,${summaryHtmlBase64}`,
        artifact: summaryArtifactId,
        viewer_artifact: summaryArtifactId,
        html_artifact: summaryArtifactId,
        meeting_id: meetingId
      });
    }
    const transcriptHtmlPath = String(record.transcript_html_path || "").trim();
    if (transcriptHtmlPath || transcriptHtmlArtifactId) {
      attachments.push({
        id: `meeting-transcript-html-${meetingId || "current"}`,
        title: "Transcript",
        kind: "html",
        mime_type: "text/html",
        path: transcriptHtmlPath,
        viewer_url: transcriptHtmlUrl,
        html_url: transcriptHtmlUrl,
        artifact: transcriptHtmlArtifactId,
        viewer_artifact: transcriptHtmlArtifactId,
        html_artifact: transcriptHtmlArtifactId,
        meeting_id: meetingId
      });
    }
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
    const audioUrl = signedAudioUrl || String(record.audio_url || "").trim();
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
    return String(raw.recording_title || card.recording_title || raw.title || raw.meeting_id || "Meeting Recording");
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


  function cardView(card) {
    if (isPendingOutboundCard(card)) {
      return outboundCardView(card);
    }
    if (isMeetingProcessingCard(card)) {
      return meetingProcessingCardView(card);
    }
    const wrapper = el("div", "card-wrap");
    wrapper.style.setProperty("--accent", card.accent || "#72c2ff");
    const isMeetingList = isMeetingsListCard(card);
    const cardEl = el("article", isMeetingList
      ? meetingListCardClass(card)
      : isCardRead(card)
        ? "card"
        : "card card-unread");
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
      identity.innerHTML = replyCardIconSvg(card.icon, { filled: true });
      identity.setAttribute("aria-label", isCardRead(card) ? `${card.title} is read` : `Mark ${card.title} read`);
      identity.addEventListener("click", (event) => {
        event.stopPropagation();
        toggleCardRead(card);
      });
    }

    const body = el("div", isMeetingList ? "card-body is-title-only" : "card-body");
    body.setAttribute("role", "button");
    body.tabIndex = 0;
    body.setAttribute("aria-disabled", "false");
    applyCardActionData(body, isMeetingList ? "attachment" : "transcript", card, isMeetingList ? "meeting" : "reply");
    body.addEventListener("click", () => {
      if (!shouldSuppressCardActivation()) {
        if (isMeetingList) {
          void showMeetingDetail(card.meeting_record);
          return;
        }
        showTranscript(card);
      }
    });
    body.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        if (isMeetingList) {
          void showMeetingDetail(card.meeting_record);
          return;
        }
        showTranscript(card);
      }
    });
    const title = el("h2", "title", card.title || "Pucky");
    body.append(title);
    if (!isMeetingList) {
      if (currentTileAudioPhase(card) !== "idle") {
        body.append(audioTileStatus(card));
      } else {
        body.append(el("p", "preview", card.summary || card.transcript || ""));
      }
    }

    const actions = el("div", "card-actions");
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
        if (isMeetingList) {
          void showMeetingAudioDetail(card.meeting_record);
          return;
        }
        await toggleAudio(card);
      });
      actions.append(audio);
    }
    if (!isMeetingList) {
      const attachmentInfo = firstDisplayableAttachmentInfo(card);
      if (card.html_path) {
        const page = el("button", `action ${actionStateClass(card, "page")}`);
        page.type = "button";
        applyCardActionData(page, "page", card, "reply");
        page.innerHTML = iconSvg("attachment", { filled: true });
        page.setAttribute("aria-label", `Open page for ${card.title}`);
        page.addEventListener("click", (event) => {
          event.stopPropagation();
          showRichPage(card);
        });
        actions.append(page);
      } else if (attachmentInfo) {
        const file = el("button", `action ${actionStateClass(card, "attachment")}`);
        file.type = "button";
        applyCardActionData(file, "attachment", card, "reply");
        file.innerHTML = iconSvg("attachment", { filled: true });
        file.setAttribute("aria-label", `Open file for ${card.title}`);
        file.addEventListener("click", (event) => {
          event.stopPropagation();
          showAttachmentViewer(card, attachmentInfo.attachments, { initialIndex: attachmentInfo.index });
        });
        actions.append(file);
      }
    }

    if (identity) {
      cardEl.append(identity, body, actions);
    } else {
      cardEl.append(body, actions);
    }
    if (cardStamp) {
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
    if (canArchiveHomeCard(card)) {
      appendArchiveRevealAction(wrapper, {
        label: `Archive ${card.title || "reply"}`
      });
    }
    wrapper.append(cardEl);
    if (canArchiveHomeCard(card)) {
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

  function meetingProcessingCardView(card) {
    const wrapper = el("div", "card-wrap card-wrap-meeting-processing");
    wrapper.style.setProperty("--accent", card.accent || "#72c2ff");
    const cardEl = el("article", "card card-meeting-processing");
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
    wrapper.append(cardEl);
    return wrapper;
  }

  function outboundCardView(card) {
    const wrapper = el("div", "card-wrap");
    wrapper.style.setProperty("--accent", card.accent || "#72c2ff");
    const cardEl = el("article", isFailedPendingOutboundCard(card)
      ? "card card-outbound is-failed"
      : "card card-outbound");
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
    if (canArchiveHomeCard(card)) {
      appendArchiveRevealAction(wrapper, {
        label: `Archive ${card.title || "reply"}`
      });
    }
    wrapper.append(cardEl);
    if (canArchiveHomeCard(card)) {
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
    const hasNativeBridge = Boolean(window.PuckyAndroid && typeof window.PuckyAndroid.postMessage === "function");
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
      } else if (card.audio_playlist_path) {
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
    openSideDetail(panel, card.title || "Transcript", content, dismissDetail, { audioCard: hasAudio(card) ? card : null });
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
    let cleanupEdgeDismiss = () => {};
    const dismissWithCleanup = () => {
      cleanupEdgeDismiss();
      dismissDetail();
    };
    try {
      const result = await Pucky.request({
        command: "artifact.read_base64",
        args: { path: card.html_path, max_bytes: 1024 * 1024 }
      });
      content.append(await richFrame(result, card.html_path, card), el("div", "rich-swipe-edge"));
    } catch (error) {
      if (isMockHtmlArtifact(card.html_path)) {
        content.append(await richFrame(mockArtifactResult(card.html_path), card.html_path, card), el("div", "rich-swipe-edge"));
      } else {
        content.append(el("p", "preview", `Page unavailable: ${error.message}`));
      }
    }
    applyDetailDataAttributes(panel, "page", card, { viewer: "html_iframe" });
    openSideDetail(panel, card.title || "Page", content, dismissWithCleanup, { audioCard: hasAudio(card) ? card : null });
    rememberNavDetail("page", card, options);
    installDetailScrollPersistence(content, "page");
    void syncVoiceThreadScope({ reason: "show_page", render: true });
    restoreScrollPosition(content, options.scrollTop);
    const edge = content.querySelector(".rich-swipe-edge");
    if (edge) {
      cleanupEdgeDismiss = installHorizontalDismiss(edge, panel, dismissWithCleanup);
    }
  }

  async function richFrame(result, path = "", source = null) {
    const iframe = el("iframe", "rich-frame");
    iframe.setAttribute("sandbox", "allow-scripts allow-forms allow-popups allow-same-origin");
    const mime = String((result && result.mime_type) || "").toLowerCase();
    const content = String((result && result.content_base64) || "");
    const transcriptContext = source ? await resolveMeetingTranscriptLink(source, source) : { href: "" };
    if (mime === "application/pdf" || ((mime === "" || mime === "application/octet-stream") && /\.pdf$/i.test(String(path)))) {
      iframe.srcdoc = pdfArtifactHtml(result, path, content);
    } else {
      iframe.srcdoc = await rewriteMeetingHtmlContent(atob(content), source || {}, {
        transcriptHref: String(transcriptContext.href || "")
      });
    }
    return iframe;
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
    openSideDetail(panel, card.title || "Images", content, dismissGallery, { audioCard: hasAudio(card) ? card : null });
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
    openSideDetail(panel, item.title || card.title || "Video", content, dismissAttachment, { audioCard: hasAudio(card) ? card : null });
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
    openSideDetail(panel, item.title || card.title || "Audio", content, dismissAttachment, { audioCard: hasAudio(card) ? card : null });
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
    openSideDetail(panel, item.title || card.title || "Attachment", content, dismissAttachment, { audioCard: hasAudio(card) ? card : null });
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

  async function resolveArtifactUrl(item, options = {}) {
    if (item.src || item.data_url) {
      return String(item.src || item.data_url);
    }
    const hasNativeBridge = Boolean(window.PuckyAndroid && typeof window.PuckyAndroid.postMessage === "function");
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
    const headers = {};
    if (state.links.apiToken && !/[?&]token=/i.test(apiUrl)) {
      headers.Authorization = `Bearer ${state.links.apiToken}`;
    }
    const response = await fetch(apiUrl, { cache: "no-store", headers });
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
    const audioCard = hasAudio(options.audioCard) ? options.audioCard : null;
    const header = lightHeader(title, { onBack: onDismiss, detail: true });
    const body = el("div", "detail-content");
    const bodyInner = el("div", "detail-content-inner");
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

  function showAudioDetail(card, options = {}) {
    state.audioCard = card;
    const panel = document.getElementById("detail");
    const content = audioDetailContent(card);
    applyDetailDataAttributes(panel, "audio", card, { viewer: "audio_player" });
    openSideDetail(panel, card.title || "Audio", content, dismissAudioDetail);
    rememberNavDetail("audio", card, options);
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
    const runtime = samePath(state.audioProbe.target_key, audioStateKey(card))
      ? String(state.audioProbe.runtime_mode || audioRuntimeMode())
      : audioRuntimeMode();
    const section = el("section", "detail-audio-continuity");
    const inner = el("div", "detail-audio-continuity-inner");
    section.style.setProperty("--accent", card.accent || "#72c2ff");
    section.dataset.audioKey = audioStateKey(card);
    const copy = el("div", "detail-audio-continuity-copy");
    copy.append(el("div", "detail-audio-continuity-kicker", runtime === "browser_stub" ? "Browser preview" : "Tile audio"));
    copy.append(el("div", "detail-audio-continuity-title", card.title || "Audio"));
    copy.append(audioTileStatus(card));
    const actions = el("div", "detail-audio-continuity-actions");
    const toggle = el("button", "detail-audio-action detail-audio-action-primary", isPlayingCard(card) ? (runtime === "browser_stub" ? "Stop preview" : "Pause") : "Play");
    toggle.type = "button";
    toggle.disabled = isCardAudioBusy(card) || ["starting", "pause_pending"].includes(currentTileAudioPhase(card));
    toggle.addEventListener("click", () => {
      void toggleAudio(card);
    });
    const open = el("button", "detail-audio-action", "Open audio controls");
    open.type = "button";
    open.addEventListener("click", () => showAudioDetail(card));
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
      if (!same && card.audio_playlist_path) {
        await Pucky.request({
          command: "player.queue.set",
          args: { playlist_path: card.audio_playlist_path, title: card.title, load: true }
        });
      } else if (!same && (card.audio_path || card.audio_url)) {
        const audioPath = await prepareAudioForPlayback(card);
        await Pucky.request({
          command: "player.play",
          args: { path: audioPath, title: card.title, start_at_ms: positionMs, speed: resolvedStartSpeedForCard(card) }
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
      if (!same && card.audio_playlist_path) {
        await Pucky.request({
          command: "player.queue.set",
          args: { playlist_path: card.audio_playlist_path, title: card.title, load: true }
        });
      } else if (!same && (card.audio_path || card.audio_url)) {
        const audioPath = await prepareAudioForPlayback(card);
        await Pucky.request({
          command: "player.play",
          args: { path: audioPath, title: card.title, start_at_ms: positionMs }
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
      if (menu) {
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
        images: normalizedImages(item.images)
      }));
    }
    if (card.transcript) {
      return String(card.transcript).split(/\n+/).filter(Boolean).map(line => {
        const user = /^user:/i.test(line);
        return { role: user ? "user" : "assistant", text: line.replace(/^(user|pucky|assistant):\s*/i, "") };
      });
    }
    return [{ role: "assistant", text: card.summary || "No transcript is attached to this reply." }];
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
    return Boolean(card.audio_path || card.audio_playlist_path || card.audio_url);
  }

  function audioControlKey(card) {
    if (card.audio_playlist_path) {
      return card.audio_playlist_path;
    }
    if (!hasNativeAudioBridge() && card.audio_url) {
      return card.audio_url;
    }
    return card.audio_path || card.audio_media_id || card.audio_url || card.session_id || card.title || "";
  }

  function audioStateKey(card) {
    return normalizePath(audioControlKey(card));
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

  function describeAudioSourceForCard(card) {
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
    if (audioRuntimeMode() === "native_bridge" && Number(state.player.duration_ms || 0) > 0 && activePlayerMatchesCard(card)) {
      return "progress";
    }
    return "status";
  }

  function isCardAudioBusy(card) {
    return samePath(state.audioToggleBusyKey, audioStateKey(card));
  }

  function tileAudioLabel(card) {
    const phase = currentTileAudioPhase(card);
    const runtime = samePath(state.audioProbe.target_key, audioStateKey(card))
      ? String(state.audioProbe.runtime_mode || audioRuntimeMode())
      : audioRuntimeMode();
    if (phase === "starting") {
      return runtime === "browser_stub" ? "Starting browser preview..." : "Starting audio...";
    }
    if (phase === "pause_pending") {
      return "Pausing audio...";
    }
    if (phase === "playing_confirmed") {
      return runtime === "browser_stub" ? "Browser preview active" : "Audio playing";
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
    const runtime = samePath(state.audioProbe.target_key, audioStateKey(card))
      ? String(state.audioProbe.runtime_mode || audioRuntimeMode())
      : audioRuntimeMode();
    if (["start_failed", "ended_immediately"].includes(phase)) {
      return String(state.audioProbe.last_error_toast || "Tap again to retry playback.");
    }
    if (phase === "playing_confirmed" && runtime === "browser_stub" && currentTileAudioStripKind(card) === "status") {
      return "Browser preview only.";
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
    const shouldRenderStrip = !(runtime === "browser_stub" && phase === "playing_confirmed" && stripKind === "status");
    setDataAttribute(status, "data-audio-phase", phase);
    setDataAttribute(status, "data-audio-runtime-mode", runtime);
    setDataAttribute(status, "data-audio-strip-kind", stripKind);
    setDataAttribute(strip, "data-strip-kind", stripKind);
    status.append(label);
    if (shouldRenderStrip) {
      if (stripKind === "progress") {
        const progress = el("span", "tile-audio-progress");
        const duration = Math.max(0, Number(state.player.duration_ms || 0));
        const position = currentPlayerPositionMs(state.player);
        progress.style.setProperty("--progress", String(duration > 0 ? Math.min(1, position / duration) : 0));
        strip.append(progress);
      }
      status.append(strip);
    }
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
    return samePath(player.path, card.audio_path)
      || samePath(player.path, card.audio_url)
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
    if (!player?.is_playing || audioRuntimeMode() !== "native_bridge" || duration <= 0) {
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
    if (audioRuntimeMode() !== "native_bridge" || Number(state.player.duration_ms || 0) <= 0) {
      return false;
    }
    if (isAudioDetailOpen()) {
      return true;
    }
    const detailCard = currentDetailAudioCard();
    if (detailCard && activePlayerMatchesCard(detailCard)) {
      return true;
    }
    return state.route === "inbox" && feedDisplayCards().some(card => activePlayerMatchesCard(card));
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
    const phase = currentTileAudioPhase({ audio_path: targetKey, audio_url: targetKey, title: state.audioProbe.target_card?.title || "" });
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

  async function requestFeedAction(card, action, options = {}) {
    const cardId = String(card && card.card_id || "");
    const sessionId = cardSessionId(card);
    if (!cardId) {
      return null;
    }
    const clientActionId = `feed_${action}_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
    try {
      const result = await feedApiRequest("/api/feed/actions", {
        method: "POST",
        body: {
          client_action_id: clientActionId,
          card_id: cardId,
          action
        }
      });
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

  function resolveBrowserApiToken() {
    try {
      const params = new URLSearchParams(window.location.search || "");
      const queryToken = String(params.get("api_token") || "").trim();
      if (queryToken) {
        localStorage.setItem(BROWSER_API_TOKEN_STATE_KEY, queryToken);
        return queryToken;
      }
      return String(localStorage.getItem(BROWSER_API_TOKEN_STATE_KEY) || "").trim();
    } catch (_) {
      return "";
    }
  }

  function resolveBrowserDeviceId() {
    try {
      const params = new URLSearchParams(window.location.search || "");
      const queryDeviceId = String(params.get("device_id") || "").trim();
      if (queryDeviceId) {
        localStorage.setItem(BROWSER_DEVICE_ID_STATE_KEY, queryDeviceId);
        return queryDeviceId;
      }
      return String(localStorage.getItem(BROWSER_DEVICE_ID_STATE_KEY) || "").trim();
    } catch (_) {
      return "";
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
    if (!["audio", "transcript", "page", "images", "attachment"].includes(type)) {
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
        selected_task_id: state.selectedTaskId || null,
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
    if (detail.type === "page" && card.html_path) {
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
      const wasTurnActive = isTurnActive(state.turn);
      await loadTurnStatus({ render: false });
      const turnActive = isTurnActive(state.turn);
      if (state.route === "inbox" && (turnActive || wasTurnActive)) {
        await refreshCardsFromVmSnapshot({ render: false });
      }
      changed = changed || turnActive || wasTurnActive;
      if (state.activePath) {
        const previousPlayer = state.player;
        state.player = stampPlayerState(await Pucky.request({ command: "player.state", args: {} }));
        syncActivePathFromPlayer(state.player);
        if (state.player.path) {
          rememberPlayerProgress(state.player);
        }
        const audioProbeChanged = syncAudioProbeFromPlayerState(previousPlayer, state.player);
        changed = changed || shouldRenderForPlayerState(previousPlayer, state.player) || audioProbeChanged;
      }
      if (wakeProofVisualState(state.wakeStatus) !== "idle") {
        await loadWakeStatus({ render: false });
        changed = true;
      }
      if (changed) {
        render();
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
    if (document.visibilityState === "visible") {
      void refreshMeetingRecordingStatus({ render: true });
    }
  }, MEETING_STATUS_POLL_MS);

  setInterval(() => {
    if (document.visibilityState === "visible" && (state.route === "tasks" || state.route === "task-detail")) {
      void loadWorkspaceCollection("tasks", { render: true, force: true });
    }
  }, WORKSPACE_TASK_REFRESH_MS);

  setInterval(() => {
    if (document.visibilityState === "visible" && (state.route === "home" || state.route === "reminders" || state.route === "reminder-detail")) {
      void loadWorkspaceCollection("reminders", { render: true, force: true });
    }
  }, WORKSPACE_REMINDER_REFRESH_MS);

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
      loadMeetings({ render: true });
      return;
    }
    if (state.route === "settings") {
      loadSettingsState({ render: true });
      return;
    }
    if (state.route === "home") {
      void loadWorkspaceCollection("reminders", { render: true, force: true });
      return;
    }
    if (state.route === "task-detail") {
      return;
    }
    void loadWorkspaceForRoute(state.route, { render: true, force: true });
  });

  window.PuckyHandleAndroidBack = handleAndroidBack;
  window.PuckyUiDebug = {
    describe: describeUiSurface,
    dispatch: uiDebugDispatch,
    linksMetrics: linksDebugMetrics
  };
  syncThemeQueryParam(state.theme);
  syncRouteQueryParam(state.route);
  render();
  installFeedScrollPersistence();
  installFeedSyncLoop();
  installCardMenuOutsideDismiss();
  installArchiveRevealOutsideDismiss();
  void syncVoiceThreadScope({ reason: "boot", render: true });
  loadTurnStatus({ render: false });
  refreshMeetingRecordingStatus({ render: true });
  loadSettingsState({ render: false, ensureSurface: state.route === "settings" });
  loadCardIconRegistry({ render: false });
  loadCards();
  void loadWorkspaceForRoute(state.route, { render: true, force: true });
  if (state.route === "connect") {
    linksDebugStartSession("route", { reason: "boot_route" });
    linksDebugRecord("links_route_enter", { reason: "boot_route" }, "route");
    loadLinksPortal({ render: true });
  } else if (state.route === "meetings") {
    refreshMeetingRecordingStatus({ render: true });
    loadMeetings({ render: true });
  }
})();

