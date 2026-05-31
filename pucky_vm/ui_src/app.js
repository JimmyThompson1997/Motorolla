(() => {
  const FEED_ICON_EXCLUDES_KEY = "pucky.cover.feed_icon_excludes.v1";
  const HOME_MENU_ICON_LIBRARY_KEY = "pucky.cover.home_menu_icon_library.v1";
  const AUDIO_STATE_KEY = "pucky.cover.audio_state.v1";
  const NAV_STATE_KEY = "pucky.cover.nav_state.v1";
  const READ_OVERRIDES_KEY = "pucky.cover.read_overrides.v1";
  const COMPLETE_EPSILON_MS = 500;
  const MOCK_STANDARD_DURATION_MS = 1000 * 60 * 19 + 57000;
  const MOCK_AUDIOBOOK_DURATION_MS = 69897450;
  const FEED_REFRESH_THRESHOLD = 28;
  const FEED_REFRESH_MAX_PULL = 72;
  const FEED_REFRESH_HOLD_OFFSET = 46;
  const FEED_REFRESH_MIN_DWELL_MS = 450;
  const FEED_REFRESH_TIMEOUT_MS = 15000;
  const FEED_SYNC_INTERVAL_MS = 15000;
  const CARD_MENU_CLICK_SUPPRESS_MS = 550;
  const CARD_ARCHIVE_SWIPE_TRIGGER_PX = 82;
  const CARD_ARCHIVE_SWIPE_MAX_PX = 126;
  const CARD_ARCHIVE_SWIPE_SLOP_PX = 12;
  const TURN_UI_TIMELINE_MAX_EVENTS = 64;
  const SETTINGS_SURFACE_RELOAD_KEY = "pucky.cover.settings_surface_reload.v1";
  const DEFAULT_LINKS_API_BASE = "https://pucky.fly.dev";
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

  const PAGE_TABS = [
    { route: "feed", icon: "mail", label: "Home" },
    { route: "links", icon: "link", label: "Links" },
    { route: "morning", icon: "coffee", label: "Morning" },
    { route: "calls", icon: "phone", label: "Calls" },
    { route: "settings", icon: "settings", label: "Settings" }
  ];

  const DEFAULT_HOME_MENU_ICONS = [
    { key: "book", icon: "book", label: "Audiobooks", accent: "#72c2ff" }
  ];

  const TURN_REPLY_MODES = ["card_only", "card_and_spoken"];
  const TURN_ARRIVAL_CUE_MODES = ["none", "haptic", "chime", "haptic_and_chime"];
  const LINKS_BROWSER_HANDOFF_LOCK_MS = 2200;
  const LINKS_ROW_HEIGHT = 62;
  const LINKS_WINDOW_OVERSCAN = 8;
  const LINKS_SCROLL_SETTLE_MS = 80;
  const LINKS_AUTH_SCHEME_LABELS = {
    OAUTH2: "OAuth",
    API_KEY: "API key",
    BASIC: "Basic",
    BEARER_TOKEN: "Token",
    NO_AUTH: "No auth"
  };

  const MOCK_CARDS = [
    {
      session_id: "mock_morning",
      title: "Morning launch",
      icon: "clock",
      accent: "#ffb000",
      created_at: "2026-05-20T06:33:00-07:00",
      summary: "Brief me, triage the inbox, scan the weather, surface the one thing that cannot slip.",
      transcript_messages: [
        { role: "user", text: "Pucky, start my morning.", created_at: "2026-05-20T06:31:00-07:00" },
        { role: "assistant", text: "Weather is clear until early afternoon. Your inbox has three messages that look decision-relevant, and one calendar collision at 11.", created_at: "2026-05-20T06:31:00-07:00" },
        { role: "user", text: "Give me the one thing that cannot slip.", created_at: "2026-05-20T06:32:00-07:00" },
        { role: "assistant", text: "The funding memo. It blocks the contractor reply and the finance sync. I would do that before anything tactical.", created_at: "2026-05-20T06:32:00-07:00" },
        { role: "user", text: "Any landmines?", created_at: "2026-05-20T06:33:00-07:00" },
        { role: "assistant", text: "Two. First, the team thread drifted into scope without a decision owner. Second, the weather window for errands is smaller than yesterday's forecast suggested.", created_at: "2026-05-20T06:33:00-07:00" }
      ],
      audio_path: "/mock/morning.wav",
      html_path: "/mock/morning.html"
    },
    {
      session_id: "mock_leave",
      title: "Leaving home",
      icon: "bolt",
      accent: "#50d86a",
      created_at: "2026-05-20T08:08:00-07:00",
      summary: "Start commute, queue a drive mix, notify ETA, check garage state, and keep it light.",
      transcript_messages: [
        { role: "user", text: "Leaving home.", time: "8:07 AM" },
        { role: "assistant", text: "Drive mode is ready. I queued a low-distraction mix, checked the garage action, and prepared an ETA note if traffic gets worse.", time: "8:07 AM" },
        { role: "assistant", text: "One small warning: the north route has a slowdown near the merge, but it is still faster than the alternate by six minutes.", time: "8:08 AM" }
      ],
      audio_path: "/mock/leaving.wav",
      html_path: "/mock/leaving.html"
    },
    {
      session_id: "mock_meeting",
      title: "Meeting prep",
      icon: "calendar",
      accent: "#3a84ff",
      created_at: "2026-05-19T09:46:00-07:00",
      summary: "Pull agenda notes, summarize the last thread, identify likely decisions, and prep follow-ups.",
      transcript_messages: [
        { role: "user", text: "What do I need before the meeting?", time: "9:45 AM" },
        { role: "assistant", text: "The decision is narrower than the thread makes it look: approve the lightweight pilot, or defer until analytics can support a larger rollout.", time: "9:45 AM" },
        { role: "assistant", text: "I pulled the three likely objections into a short prep note: cost, support burden, and whether the pilot result will be credible.", time: "9:46 AM" },
        { role: "user", text: "Give me a good first sentence.", time: "9:46 AM" },
        { role: "assistant", text: "Try: 'I think we can make this decision smaller and safer by treating the first release as an instrumentation pilot, not a product commitment.'", time: "9:46 AM" }
      ],
      audio_path: "/mock/meeting.wav",
      html_path: "/mock/meeting.html"
    },
    {
      session_id: "mock_night",
      title: "Night wrap",
      icon: "moon",
      accent: "#8b63ff",
      created_at: "2026-05-18T23:01:00-07:00",
      summary: "Summarize the day, capture loose tasks, set tomorrow priorities, dim notifications.",
      transcript_messages: [
        { role: "user", text: "Wrap my day.", time: "11:00 PM" },
        { role: "assistant", text: "You closed two loops, left one thread waiting on confirmation, and created one new task that should not be handled tonight.", time: "11:00 PM" },
        { role: "assistant", text: "Tomorrow's first move should be the contractor reply. I put it above inbox triage because it unlocks the rest of the workday.", time: "11:01 PM" },
        { role: "user", text: "Dim everything except urgent calls.", time: "11:01 PM" },
        { role: "assistant", text: "Done. Quiet mode is staged, and urgent callers remain allowed.", time: "11:01 PM" }
      ],
      audio_path: "/mock/night.wav",
      html_path: "/mock/night.html"
    },
    {
      session_id: "mock_book",
      title: "Pocket Computers",
      icon: "book",
      accent: "#72c2ff",
      created_at: "2026-05-09T16:13:00-07:00",
      summary: "From Pocket Computers to Planetary Platforms. Complete George narration, ready to resume.",
      transcript_messages: [
        { role: "assistant", text: "Chapter narration is ready at the last saved position.", time: "4:12 PM" },
        { role: "assistant", text: "The next section traces the leap from tiny personal machines to always-connected pocket infrastructure.", time: "4:12 PM" },
        { role: "user", text: "Resume softly and keep the speed where I left it.", time: "4:13 PM" },
        { role: "assistant", text: "Ready. Playback will resume with the saved position and speed.", time: "4:13 PM" }
      ],
      audio_path: "/mock/pocket-computers.wav",
      audio_timestamps: [
        { id: "chapter-01", title: "Prologue - The Phone Before the Phone", start_ms: 0, end_ms: 403260, detail: "6:43", kind: "prologue" },
        { id: "chapter-03", title: "Chapter 1 - The Portable Future Before It Fit in a Pocket", start_ms: 406080, end_ms: 2741520, detail: "38:55 across 3 segments", kind: "chapter" },
        { id: "chapter-14", title: "Chapter 10 - The iPhone Demo and the Reframing of the Phone", start_ms: 22422900, end_ms: 24921850, detail: "41:39 across 3 segments", kind: "chapter" },
        { id: "chapter-31", title: "Postscript - The Runtime Phone", start_ms: 66065430, end_ms: 69897470, detail: "1:03:52 across 4 segments", kind: "postscript" }
      ],
      html_path: "/mock/pocket-computers.html"
    }
  ];
  const persistedAudioState = loadAudioState();
  const persistedNavState = loadNavState();
  const state = {
    cards: [],
    cardIconRegistry: {},
    cardIconRegistryLoading: false,
    cardIconRegistryRequestedAt: 0,
    route: initialRoute(persistedNavState.route),
    openTrayRoute: initialOpenTrayRoute(persistedNavState.open_tray_route, persistedNavState.route),
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
    activePath: "",
    player: { loaded: false, is_playing: false, position_ms: 0, duration_ms: 0, speed: 1 },
    savedPositions: numberMapFromObject(persistedAudioState.positions),
    completedPaths: new Set(Array.isArray(persistedAudioState.completed) ? persistedAudioState.completed : []),
    speedByPath: numberMapFromObject(persistedAudioState.speeds),
    selectedTimestampByPath: stringMapFromObject(persistedAudioState.selected_timestamps),
    scrubPreviewByPath: new Map(),
    scrubbingAudioKey: "",
    timestampTap: null,
    audioCard: null,
    traceCard: null,
    metaCard: null,
    feedRefreshPromise: null,
    feedRefreshing: false,
    nativeFeedSnapshotPromise: null,
    showArchivedFeed: false,
    openCardMenuSessionId: "",
    openCardMenuThreadId: "",
    cardMenuClickSuppressUntil: 0,
    turnUiEvents: [],
    lastRenderedTurnVisualState: "",
    lastRenderedTurnId: "",
    waveHistory: new Map(),
    links: initialLinksState(),
    drag: null
  };

  ensureStoredHomeMenuIcons();

  const pending = new Map();
  let seq = 0;
  let feedSyncIntervalId = 0;
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
        state.player = payload || state.player;
        syncActivePathFromPlayer(state.player);
        rememberPlayerProgress(state.player);
        render();
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
        if (window.PuckyAndroid && typeof window.PuckyAndroid.postMessage === "function" && state.route === "feed") {
          void refreshCardsFromNativeSnapshot({ render: true, reason: "turn_status_event" });
        }
      }
      if (name === "pucky.feed.updated") {
        const cards = Array.isArray(payload && payload.cards) ? payload.cards : [];
        if (cards.length || (payload && payload.count === 0)) {
          state.cards = cards;
          reconcileFocusedCardSelection();
          clearMissingFeedIconFilter();
          render();
          restoreNavStateAfterCards();
          syncOpenThreadDetailAfterCards();
        }
      }
    }
  };

  async function browserRequest(command, args) {
    if (command === "ui.reply_cards.get") {
      try {
        const response = await fetch("/ui/pucky/fixtures/reply_cards.json", { cache: "no-store" });
        if (response.ok) {
          return response.json();
        }
      } catch (_) {
        // Local file and static preview mode intentionally fall back to fixtures.
      }
      return { schema: "pucky.reply_cards.v1", count: MOCK_CARDS.length, cards: MOCK_CARDS };
    }
    if (command === "pucky.feed.sync") {
      return { schema: "pucky.feed_sync_result.v1", configured: true, reason: args.reason || "browser_mock", snapshot: { schema: "pucky.reply_cards.v1", count: state.cards.length, cards: state.cards } };
    }
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
    if (command === "pucky.feed.action") {
      const action = String(args.action || "").trim();
      const cardId = String(args.card_id || "");
      const sessionId = String(args.session_id || "");
      state.cards = state.cards
        .map(card => {
          const same = (card.card_id && card.card_id === cardId)
            || (!cardId && card.session_id && card.session_id === sessionId);
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
      return {
        schema: "pucky.feed_action_result.v1",
        ok: true,
        action,
        snapshot: { schema: "pucky.reply_cards.v1", count: state.cards.length, cards: state.cards }
      };
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
    if (command === "pucky.turn.settings.set") {
      const mode = normalizeReplyMode(args.reply_mode || args.mode);
      const arrivalCueMode = normalizeArrivalCueMode(
        args.arrival_cue_mode !== undefined
          ? args.arrival_cue_mode
          : args.accepted_chime_enabled !== undefined
            ? (truthy(args.accepted_chime_enabled) ? "chime" : "none")
            : state.turnSettings.arrival_cue_mode
      );
      state.turnSettings = {
        schema: "pucky.turn_settings.v1",
        reply_mode: mode,
        spoken_reply_enabled: mode === "card_and_spoken",
        arrival_cue_mode: arrivalCueMode,
        accepted_chime_enabled: arrivalCueMode === "chime" || arrivalCueMode === "haptic_and_chime",
        modes: TURN_REPLY_MODES,
        arrival_cue_modes: TURN_ARRIVAL_CUE_MODES
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
    if (command === "player.play") {
      const nextPath = args.path || state.player.path || state.activePath;
      const nextSource = args.path ? null : (state.player.source || null);
      state.activePath = nextSource || args.path || state.activePath;
      const start = args.start_at_ms ?? savedPositionFor(nextSource || nextPath) ?? 0;
      state.player = {
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
        speed: state.speedByPath.get(normalizePath(state.activePath)) || 1,
        can_seek: true,
        audio_session_id: 1
      };
      return state.player;
    }
    if (command === "player.queue.set") {
      const playlist = args.playlist_path || "";
      const first = playlist ? `${playlist}#track1` : String((args.items && args.items[0] && args.items[0].path) || "");
      state.activePath = playlist || first || state.activePath;
      state.player = {
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
        speed: state.speedByPath.get(normalizePath(audioControlKey({ audio_playlist_path: playlist, audio_path: first }))) || 1,
        can_seek: true,
        audio_session_id: 1
      };
      return state.player;
    }
    if (command === "player.pause") {
      state.player = { ...state.player, state: "paused", is_playing: false };
      return state.player;
    }
    if (command === "player.seek") {
      state.player = { ...state.player, position_ms: Math.max(0, Number(args.position_ms || 0)) };
      rememberPlayerProgress(state.player);
      return state.player;
    }
    if (command === "player.speed") {
      const speed = Math.max(0.5, Math.min(3, Number(args.speed || 1)));
      state.player = { ...state.player, speed };
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

  async function fetchReplyCards() {
    const snapshot = await Pucky.request({ command: "ui.reply_cards.get", args: {} });
    return Array.isArray(snapshot.cards) ? snapshot.cards : [];
  }

  async function syncFeedCards(options = {}) {
    const reason = options.reason || "feed_sync";
    const authoritative = options.authoritative === true;
    const resetCursor = options.resetCursor === true || authoritative;
    try {
      const result = await Pucky.request({
        command: "pucky.feed.sync",
        args: { reason, reset_cursor: resetCursor, authoritative }
      });
      const snapshot = result && result.snapshot && Array.isArray(result.snapshot.cards)
        ? result.snapshot
        : { cards: await fetchReplyCards() };
      state.cards = Array.isArray(snapshot.cards) ? snapshot.cards : [];
      reconcileReadOverrides();
      reconcileFocusedCardSelection();
      clearMissingFeedIconFilter();
      if (options.render !== false) {
        render();
      }
      await syncVoiceThreadScope({ reason: `feed_sync:${reason}`, render: true });
      return snapshot;
    } catch (error) {
      if (!options.silent) {
        throw error;
      }
      return { cards: state.cards };
    }
  }

  async function loadCards() {
    try {
      state.cards = await fetchReplyCards();
    } catch (error) {
      state.cards = MOCK_CARDS;
    }
    reconcileReadOverrides();
    reconcileFocusedCardSelection();
    clearMissingFeedIconFilter();
    render();
    restoreNavStateAfterCards();
    void syncVoiceThreadScope({ reason: "load_cards", render: true });
    if (window.PuckyAndroid && typeof window.PuckyAndroid.postMessage === "function") {
      syncFeedCards({ reason: "load_cards", silent: true, render: true, authoritative: true });
    }
  }

  async function refreshCardsFromNativeSnapshot(options = {}) {
    if (!(window.PuckyAndroid && typeof window.PuckyAndroid.postMessage === "function")) {
      return { cards: state.cards };
    }
    if (state.nativeFeedSnapshotPromise) {
      return state.nativeFeedSnapshotPromise;
    }
    const turnId = turnStatusTurnId(state.turn);
    recordTurnUiEvent("feed_snapshot_refresh_start", {
      turn_id: turnId,
      reason: String(options.reason || "native_snapshot")
    });
    state.nativeFeedSnapshotPromise = (async () => {
      try {
        const cards = await fetchReplyCards();
        state.cards = Array.isArray(cards) ? cards : state.cards;
        reconcileReadOverrides();
        reconcileFocusedCardSelection();
        clearMissingFeedIconFilter();
        if (options.render !== false) {
          render();
          restoreNavStateAfterCards();
          syncOpenThreadDetailAfterCards();
        }
        recordTurnUiEvent("feed_snapshot_refresh_complete", {
          turn_id: turnId,
          reason: String(options.reason || "native_snapshot"),
          card_count: state.cards.length
        });
        return { cards: state.cards };
      } catch (_) {
        return { cards: state.cards };
      } finally {
        state.nativeFeedSnapshotPromise = null;
      }
    })();
    return state.nativeFeedSnapshotPromise;
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

  async function loadSettingsState(options = {}) {
    await Promise.all([
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

  async function loadLinksPortal(options = {}) {
    if (state.links.loading) {
      return;
    }
    linksDebugEnsureRouteSession(options.force ? "force_reload" : "route_open");
    if (options.force) {
      resetLinksCatalogState({ keepSearch: true });
    }
    state.links.loading = true;
    state.links.error = "";
    state.links.message = "";
    state.links.messageKind = "";
    if (options.render) {
      render();
    }
    try {
      let payload = null;
      if (!state.links.token || options.force === true) {
        linksDebugRecord("portal_url_start", { force: Boolean(options.force) }, "route");
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
        state.links.error = payload.error || "Links portal unavailable";
      } else {
        const connectedPromise = loadLinksConnected({ render: false })
          .then(() => {
            if (optionsShouldRenderLinksPage()) {
              render();
            }
          })
          .catch(() => {
            // Keep the list usable even if connection badges arrive later.
          });
        if (!state.links.firstPageReady || !state.links.apps.length) {
          await loadLinksCatalog({ render: false });
        }
        void connectedPromise;
      }
    } catch (error) {
      state.links.available = false;
      state.links.error = String(error && error.message ? error.message : "Unable to open Links");
      linksDebugRecord("handoff_error", { stage: "portal_load", detail: state.links.error }, "route");
    } finally {
      state.links.loading = false;
      if (options.render !== false) {
        render();
      }
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

  function normalizeLinksCatalogPayload(payload) {
    return {
      apps: Array.isArray(payload && payload.apps) ? payload.apps : [],
      total: safeNumber(payload && payload.total),
      generated_at: String(payload && payload.generated_at || ""),
      catalog_version: String(payload && payload.catalog_version || "")
    };
  }

  function normalizeLinksApp(item) {
    const authSchemes = Array.isArray(item && item.auth_schemes) ? item.auth_schemes : [];
    const managedAuthSchemes = Array.isArray(item && item.managed_auth_schemes) ? item.managed_auth_schemes : [];
    return {
      slug: String(item && item.slug || "").trim(),
      name: String(item && (item.name || item.slug) || "").trim(),
      logo: String(item && item.logo || "").trim(),
      auth_schemes: authSchemes.map(value => String(value || "").trim().toUpperCase()).filter(Boolean),
      managed_auth_schemes: managedAuthSchemes.map(value => String(value || "").trim().toUpperCase()).filter(Boolean),
      auth_label: String(item && item.auth_label || "").trim(),
      state: String(item && item.state || "not-connected").trim(),
      counts: item && typeof item.counts === "object" ? item.counts : { total: 0, active: 0, pending: 0, expired: 0 }
    };
  }

  function resetLinksCatalogState(options = {}) {
    clearLinksScrollSettleTimer();
    state.links.apps = [];
    if (options.clearConnected === true) {
      state.links.connectedApps = [];
      state.links.connectedSlugs = new Set();
    }
    state.links.totalAvailable = 0;
    state.links.scrolling = false;
    state.links.lastRefreshAt = 0;
    state.links.firstPageReady = false;
    state.links.catalogVersion = "";
    state.links.catalogGeneratedAt = "";
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

  function linksFooterText(filtered) {
    if (!state.links.firstPageReady && state.links.loading) {
      return "";
    }
    if (state.links.search && !filtered.length) {
      return "";
    }
    return "";
  }

  function createLinksRow(app, handoffLocked) {
    const row = el("button", "links-app-row");
    row.type = "button";
    row.disabled = handoffLocked;
    row.classList.toggle("is-opening", handoffLocked && state.links.openingSlug === app.slug);

    const icon = el("span", "links-app-icon");
    const fallback = el("span", "links-app-fallback", linksAppInitial(app));
    if (app.logo) {
      const img = document.createElement("img");
      img.className = "links-app-logo";
      img.src = app.logo;
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
    icon.append(fallback);

    const name = el("span", "links-app-name", app.name || app.slug);
    const auth = el("span", "links-app-auth", linksAuthLabelForApp(app));
    const mark = el("span", state.links.connectedSlugs.has(app.slug) ? "links-app-mark is-connected" : "links-app-mark");

    row.append(icon, name, auth, mark);
    row.addEventListener("click", () => {
      openLinksAuthFlow(app);
    });
    return row;
  }

  function renderLinksListContents(list, listCount, footer, handoffLocked) {
    const filtered = linksFilteredApps();
    listCount.textContent = linksCountLabel(filtered);
    list.replaceChildren();
    footer.textContent = linksFooterText(filtered);
    footer.classList.toggle("is-visible", Boolean(footer.textContent));
    if (!filtered.length) {
      list.append(el("div", "links-empty", state.links.apps.length ? "No apps match your search." : "No connectable apps are available right now."));
      return;
    }
    if (!state.links.firstRowsTelemetrySent) {
      state.links.firstRowsTelemetrySent = true;
      linksDebugRecord("first_rows_rendered", { rendered_rows: filtered.length }, "route");
    }
    const fragment = document.createDocumentFragment();
    filtered.forEach(app => {
      fragment.append(createLinksRow(app, handoffLocked));
    });
    list.append(fragment);
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
    return state.route === "links";
  }

  let linksPageNode = null;
  let linksPageRefs = null;
  let linksScrollSettleTimer = 0;
  let linksScrollRaf = 0;

  function clearLinksScrollSettleTimer() {
    if (linksScrollSettleTimer) {
      clearTimeout(linksScrollSettleTimer);
      linksScrollSettleTimer = 0;
    }
  }

  async function loadLinksCatalog(options = {}) {
    if (!state.links.token) {
      return;
    }
    linksDebugRecord("catalog_start", {}, "route");
    const payload = normalizeLinksCatalogPayload(
      await linksApiRequest(`/api/links/composio/catalog?token=${encodeURIComponent(state.links.token)}`, { cache: "default" })
    );
    state.links.apps = payload.apps.map(normalizeLinksApp).filter(item => item.slug && item.name);
    state.links.totalAvailable = Math.max(payload.total, state.links.apps.length);
    state.links.catalogVersion = payload.catalog_version;
    state.links.catalogGeneratedAt = payload.generated_at;
    state.links.firstPageReady = state.links.apps.length > 0 || state.links.totalAvailable === 0;
    linksDebugRecord(
      "catalog_end",
      {
        total_count: state.links.totalAvailable,
        catalog_version: state.links.catalogVersion,
        generated_at: state.links.catalogGeneratedAt
      },
      "route"
    );
    if (options.render) {
      render();
    }
  }

  function linksFeedElement() {
    return document.getElementById("feed");
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

  function linksVisibleRange(totalCount) {
    const feed = linksFeedElement();
    const scrollTop = Math.max(0, safeNumber(feed && feed.scrollTop));
    const viewportHeight = Math.max(LINKS_ROW_HEIGHT, safeNumber(feed && feed.clientHeight));
    const unclampedStartIndex = Math.max(0, Math.floor(scrollTop / LINKS_ROW_HEIGHT) - LINKS_WINDOW_OVERSCAN);
    const maxStartIndex = Math.max(0, totalCount - 1);
    const startIndex = Math.min(unclampedStartIndex, maxStartIndex);
    const endIndex = Math.min(
      totalCount,
      Math.max(
        startIndex + 1,
        Math.ceil((scrollTop + viewportHeight) / LINKS_ROW_HEIGHT) + LINKS_WINDOW_OVERSCAN
      )
    );
    return { startIndex, endIndex };
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
      refs.emptyTitle.textContent = "Loading Links...";
      refs.emptyBody.textContent = "Pucky is fetching your connectable apps.";
      refs.retry.hidden = true;
      refs.searchWrap.hidden = true;
      refs.listCard.hidden = true;
      refs.connected.hidden = true;
      return true;
    }
    if (state.links.error && !state.links.apps.length) {
      refs.empty.hidden = false;
      refs.emptyTitle.textContent = "Could not load Links right now.";
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
    refs.footer.textContent = linksFooterText(filtered);
    refs.footer.classList.toggle("is-visible", Boolean(refs.footer.textContent));
    if (!filtered.length) {
      refs.topSpacer.style.height = "0px";
      refs.bottomSpacer.style.height = "0px";
      refs.rows.replaceChildren(el("div", "links-empty", state.links.apps.length ? "No apps match your search." : "No connectable apps are available right now."));
      return;
    }
    const { startIndex, endIndex } = linksVisibleRange(filtered.length);
    refs.topSpacer.style.height = `${startIndex * LINKS_ROW_HEIGHT}px`;
    refs.bottomSpacer.style.height = `${Math.max(0, (filtered.length - endIndex) * LINKS_ROW_HEIGHT)}px`;
    const handoffLocked = linksHandoffLocked();
    const fragment = document.createDocumentFragment();
    filtered.slice(startIndex, endIndex).forEach(app => {
      fragment.append(createLinksRow(app, handoffLocked));
    });
    refs.rows.replaceChildren(fragment);
    if (!state.links.firstRowsTelemetrySent && (endIndex - startIndex) > 0) {
      state.links.firstRowsTelemetrySent = true;
      linksDebugRecord("first_rows_rendered", { rendered_rows: endIndex - startIndex }, "route");
    }
  }

  function syncLinksPage() {
    if (!linksPageRefs) {
      return;
    }
    linksPageRefs.page.classList.toggle("is-handoff-lock", linksHandoffLocked());
    syncLinksMessage(linksPageRefs);
    if (syncLinksEmptyState(linksPageRefs)) {
      return;
    }
    syncLinksConnected(linksPageRefs);
    syncLinksSearchInput(linksPageRefs);
    syncLinksListContents(linksPageRefs);
  }

  function noteLinksScrollActivity() {
    if (state.route !== "links") {
      return;
    }
    state.links.scrolling = true;
    clearLinksScrollSettleTimer();
    if (!linksScrollRaf) {
      linksScrollRaf = requestAnimationFrame(() => {
        linksScrollRaf = 0;
        syncLinksPage();
      });
    }
    linksScrollSettleTimer = window.setTimeout(() => {
      linksScrollSettleTimer = 0;
      state.links.scrolling = false;
      syncLinksPage();
    }, LINKS_SCROLL_SETTLE_MS);
  }

  async function refreshLinksConnectedSoon(options = {}) {
    if (!state.links.token) {
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
    return Boolean(state.route === "links" && state.links.handoffLocked);
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
    if (!slug || !state.links.token || linksHandoffLocked()) {
      return;
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
        throw new Error("Links did not return a valid auth URL.");
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
    if (window.location && /^https?:$/i.test(window.location.protocol || "")) {
      return String(window.location.origin || "").replace(/\/$/, "");
    }
    return DEFAULT_LINKS_API_BASE;
  }

  async function linksApiRequest(path, options = {}) {
    const method = String(options.method || "GET").toUpperCase();
    const init = {
      method,
      cache: String(options.cache || "no-store"),
      headers: {}
    };
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
      throw new Error(String(payload && (payload.detail || payload.error) || `Links request failed (${response.status})`));
    }
    return payload;
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
    renderTabs();
    renderVoiceStatus();
    renderThreadScopeBadge();
    renderRouteTray();
    renderFeed();
    renderAudioDetail();
  }

  function renderTabs() {
    const tabs = document.getElementById("pageTabs");
    if (!tabs) {
      return;
    }
    tabs.replaceChildren(...PAGE_TABS.map(tabView));
  }

  function renderVoiceStatus() {
    const indicators = document.querySelectorAll("[data-voice-status]");
    if (!indicators.length) {
      return;
    }
    const turnState = turnVisualState(state.turn);
    const wakeProofState = turnState === "idle" ? wakeProofVisualState(state.wakeStatus) : "idle";
    const visualState = wakeProofState !== "idle" ? wakeProofState : turnState;
    const label = wakeProofState !== "idle" ? "wake matched" : turnStateLabel(visualState);
    const turnId = turnStatusTurnId(state.turn);
    if (state.lastRenderedTurnVisualState !== visualState || state.lastRenderedTurnId !== turnId) {
      state.lastRenderedTurnVisualState = visualState;
      state.lastRenderedTurnId = turnId;
      recordTurnUiEvent("voice_status_rendered", {
        turn_id: turnId,
        visual_state: visualState,
        label
      });
    }
    indicators.forEach(indicator => {
      indicator.className = `voice-status voice-status-${visualState}`;
      indicator.setAttribute("aria-label", `Turn state: ${label}`);
      indicator.title = `Turn: ${label}`;
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
      modes: TURN_REPLY_MODES,
      arrival_cue_modes: TURN_ARRIVAL_CUE_MODES
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

  function initialUiSurfaceStatus() {
    return {
      schema: "pucky.ui_surface.v1",
      requested_url: window.location.href,
      active_url: window.location.href,
      entrypoint_url: window.location.href,
      fallback_asset_url: "",
      ui_version: "browser_preview",
      source_kind: "bundle_current",
      bridge_connected: Boolean(window.PuckyAndroid && typeof window.PuckyAndroid.postMessage === "function")
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
    const detail = document.getElementById("detail");
    const focusedSessionId = String(state.openCardMenuSessionId || "");
    const focusedCard = findFocusedCard();
    const cards = Array.from(document.querySelectorAll("article[data-card-id]")).map(node => ({
      kind: node.getAttribute("data-card-kind") || "",
      card_id: node.getAttribute("data-card-id") || "",
      session_id: node.getAttribute("data-card-session-id") || "",
      thread_id: node.getAttribute("data-card-thread-id") || "",
      pending_outbound: node.getAttribute("data-card-kind") === "pending_outbound",
      pending_state: node.getAttribute("data-card-pending-state") || "",
      preview: (node.querySelector(".preview, .card-outbound-preview, .title")?.textContent || "").trim()
    }));
    return {
      ...state.uiSurface,
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
      turn_timing: currentTurnUiTiming(),
      visible_cards: cards,
      ui_debug_available: true
    };
  }

  function uiDebugDispatch(action, rawArgs = {}) {
    if (action === "goto_home") {
      return uiDebugGotoHome();
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
    const tab = document.querySelector('[data-route="feed"]');
    if (tab && state.route !== "feed") {
      tab.click();
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
    void refreshCardsFromNativeSnapshot({ render: true }).then(() => {
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
    if (state.route !== "feed" || normalizeNavDetail(state.navDetail)) {
      uiDebugGotoHome();
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
      scrolling: false,
      catalogVersion: "",
      catalogGeneratedAt: "",
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
    return {
      schema: "pucky.turn_settings.v1",
      reply_mode: mode,
      spoken_reply_enabled: mode === "card_and_spoken",
      arrival_cue_mode: arrivalCueMode,
      accepted_chime_enabled: arrivalCueMode === "chime" || arrivalCueMode === "haptic_and_chime",
      modes: Array.isArray(raw.modes) && raw.modes.length ? raw.modes : TURN_REPLY_MODES,
      arrival_cue_modes: Array.isArray(raw.arrival_cue_modes) && raw.arrival_cue_modes.length
        ? raw.arrival_cue_modes
        : TURN_ARRIVAL_CUE_MODES
    };
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
      ui_version: String(raw.ui_version || "unknown"),
      source_kind: String(raw.source_kind || "legacy_placeholder"),
      bridge_connected: truthy(raw.bridge_connected ?? !!window.PuckyAndroid)
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
    const remoteStage = String(rawIndicator.remote_stage || raw.remote_stage || rawLast.remote_stage || "").trim();
    const rawState = String(rawIndicator.state || raw.state || rawLast.state || "idle").trim();
    const rawVisualState = String(rawIndicator.visual_state || raw.visual_state || rawLast.visual_state || rawState).trim();
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
    indicator.active = indicator.active || indicator.visual_state !== "idle";
    return {
      ...raw,
      schema: raw.schema || "pucky.turn_status.v1",
      configured: truthy(raw.configured),
      indicator
    };
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
    if (["idle", "armed", "recording", "uploading", "thinking", "speaking"].includes(value)) {
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

  function turnStateLabel(visualState) {
    const labels = {
      idle: "idle",
      armed: "armed",
      recording: "recording",
      uploading: "uploading",
      thinking: "thinking",
      speaking: "speaking"
    };
    return labels[visualState] || "idle";
  }

  function isTurnActive(status) {
    const indicator = turnIndicatorFromStatus(status);
    return Boolean(indicator.mic_on || indicator.uploading || indicator.stt_running
      || indicator.codex_running || indicator.tts_running || indicator.speaking
      || indicator.active || turnVisualState(status) !== "idle");
  }

  function truthy(value) {
    return value === true || value === 1 || value === "1" || value === "true";
  }

  function safeNumber(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : 0;
  }

  function tabView(tab) {
    const button = el("button", tab.route === state.route ? "tab is-active" : "tab");
    button.type = "button";
    button.disabled = linksHandoffLocked();
    button.dataset.route = tab.route;
    button.setAttribute("aria-label", tab.label);
    button.setAttribute("aria-current", tab.route === state.route ? "page" : "false");
    button.innerHTML = iconSvg(tab.icon, { filled: false });
    button.addEventListener("click", () => {
      if (linksHandoffLocked()) {
        return;
      }
      rememberFeedScroll();
      if (state.route === tab.route) {
        state.openTrayRoute = state.openTrayRoute === tab.route ? null : tab.route;
      } else {
        dismissTransientUiForRouteChange();
        state.route = tab.route;
        state.openTrayRoute = null;
      }
      persistNavState();
      render();
      void syncVoiceThreadScope({ reason: "tab_click", render: true });
      if (state.route === "feed") {
        restoreFeedScroll();
        syncFeedCards({ reason: "route_feed", silent: true, render: true });
      } else if (state.route === "links") {
        linksDebugStartSession("route", { reason: "route_open" });
        linksDebugRecord("links_route_enter", { reason: "route_open" }, "route");
        loadLinksPortal({ render: true });
      } else if (state.route === "settings") {
        loadSettingsState({ render: true });
      }
    });
    return button;
  }

  function dismissTransientUiForRouteChange() {
    dismissOpenCardMenu(false);
    dismissTraceSheet();
    dismissOriginSheet();
    dismissAdvancedSettingsSheet();
    closeSettingsSelector();
    closeSpeedPicker();
    dismissDetail();
    state.audioCard = null;
  }

  function renderRouteTray() {
    const tray = document.getElementById("routeTray");
    if (!tray) {
      return;
    }
    if (state.route !== "feed" || state.openTrayRoute !== "feed") {
      tray.hidden = true;
      tray.replaceChildren();
      return;
    }
    tray.hidden = false;
    tray.replaceChildren(homeIconFilterTrayView());
  }

  function homeIconFilterTrayView() {
    const shell = el("div", "route-tray-shell");
    const archiveIcon = el("button", state.showArchivedFeed ? "route-tray-archive-icon is-selected" : "route-tray-archive-icon");
    archiveIcon.type = "button";
    archiveIcon.setAttribute("aria-label", "Archive");
    archiveIcon.setAttribute("title", "Archive");
    archiveIcon.setAttribute("aria-pressed", state.showArchivedFeed ? "true" : "false");
    archiveIcon.innerHTML = iconSvg("archive_folder", { filled: state.showArchivedFeed });
    archiveIcon.addEventListener("click", () => {
      state.showArchivedFeed = true;
      render();
      persistNavState();
    });
    const divider = el("span", "route-tray-divider");
    divider.setAttribute("aria-hidden", "true");
    const icons = el("div", "route-tray-icons");
    const filters = uniqueFeedIconFilters();
    icons.append(...filters.map(filter => filterIconButton(filter)));
    shell.append(archiveIcon, divider, icons);
    return shell;
  }

  function filterIconButton(filter) {
    const selected = !state.showArchivedFeed && isFeedIconIncluded(filter.key);
    const button = el("button", selected ? "filter-icon is-selected" : "filter-icon");
    button.type = "button";
    button.dataset.filterIcon = filter.key;
    button.style.setProperty("--filter-accent", filter.accent || "#f5f9ff");
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
    document.querySelector(".app-shell")?.setAttribute("data-view", state.route);
    feed.classList.toggle("is-links-handoff-locked", linksHandoffLocked());
    if (state.route === "settings") {
      feed.replaceChildren(settingsPageView());
      return;
    }
    if (state.route === "links") {
      const page = linksPageView();
      if (feed.firstElementChild !== page || feed.childElementCount !== 1) {
        feed.replaceChildren(page);
      }
      syncLinksPage();
      return;
    }
    if (state.route !== "feed") {
      const current = PAGE_TABS.find(tab => tab.route === state.route);
      feed.replaceChildren(el("div", "placeholder-page", `${current?.label || "Page"} will live here.`));
      return;
    }
    if (!state.cards.length) {
      feed.innerHTML = '<div class="empty">No replies yet.<br>Pucky will place agent replies here.</div>';
      return;
    }
    const cards = filteredFeedCards();
    if (!cards.length) {
      feed.replaceChildren(filteredFeedEmptyView());
      return;
    }
    feed.replaceChildren(...cards.map(cardView));
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

  function filteredFeedCards() {
    return state.cards.filter(card => {
      if (card && card.deleted) {
        return false;
      }
      const archived = Boolean(card && card.archived);
      return state.showArchivedFeed
        ? archived
        : !archived && (isPendingOutboundCard(card) || isFeedIconIncluded(cardIconKey(card)));
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
      replyModeSettingsCard(),
      wakeWordSettingsCard(),
      arrivalCueSettingsCard(),
      advancedSettingsCard()
    );
    return page;
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
        const feed = linksFeedElement();
        if (feed && safeNumber(feed.scrollTop) > 0) {
          feed.scrollTop = 0;
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
      const list = el("div", "links-list");
      const topSpacer = el("div", "links-list-spacer");
      const rows = el("div", "links-list-rows");
      const bottomSpacer = el("div", "links-list-spacer");
      list.append(topSpacer, rows, bottomSpacer);
      listCard.append(list);
      const footer = el("div", "links-loading-footer", "");
      listCard.append(footer);
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
        list,
        listCount,
        footer,
        topSpacer,
        rows,
        bottomSpacer
      };
      linksPageNode = page;
    }
    syncLinksPage();
    return linksPageNode;
  }

  function linksAppInitial(app) {
    const name = String(app && (app.name || app.slug) || "").trim();
    return name ? name.slice(0, 1).toUpperCase() : "?";
  }

  function replyModeSettingsCard() {
    const options = (state.turnSettings.modes || TURN_REPLY_MODES).map(mode => ({
      value: normalizeReplyMode(mode),
      label: replyModeLabel(mode)
    }));
    const currentMode = normalizeReplyMode(state.turnSettings.reply_mode);
    return settingsSelectorCard({
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

  function settingsSelectorCard({ accent, icon, title, detail, valueLabel, onOpen, actionLabel = "", action = null }) {
    const row = el("article", actionLabel ? "settings-card settings-selector-card has-actions" : "settings-card settings-selector-card");
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

  function openSettingsSelector({ title, currentValue, options, onSelect }) {
    dismissAdvancedSettingsSheet();
    const overlay = document.getElementById("settingsSelectorOverlay");
    if (!overlay) {
      return;
    }
    const sheet = el("div", "settings-selector-sheet");
    sheet.addEventListener("click", event => event.stopPropagation());
    sheet.append(el("h1", "settings-selector-title", title));
    const list = el("div", "settings-selector-list");
    for (const option of options) {
      const active = currentValue === option.value;
      const button = el("button", active ? "settings-selector-option is-active" : "settings-selector-option");
      button.type = "button";
      button.setAttribute("aria-pressed", active ? "true" : "false");
      button.append(
        el("span", "settings-selector-option-label", option.label),
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
    overlay.replaceChildren(sheet);
    overlay.classList.add("is-open");
    overlay.setAttribute("aria-hidden", "false");
    overlay.onclick = event => {
      if (event.target === overlay) {
        closeSettingsSelector();
      }
    };
  }

  function closeSettingsSelector() {
    const overlay = document.getElementById("settingsSelectorOverlay");
    if (!overlay) {
      return;
    }
    overlay.classList.remove("is-open");
    overlay.setAttribute("aria-hidden", "true");
    overlay.onclick = null;
    overlay.replaceChildren();
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


  function cardView(card) {
    if (isPendingOutboundCard(card)) {
      return outboundCardView(card);
    }
    const wrapper = el("div", "card-wrap");
    wrapper.style.setProperty("--accent", card.accent || "#72c2ff");
    const cardEl = el("article", isCardRead(card) ? "card" : "card card-unread");
    cardEl.style.setProperty("--accent", card.accent || "#72c2ff");
    applyCardDataAttributes(cardEl, card, "reply");
    const cardStamp = cardTimestamp(card);

    const identity = el("button", `identity ${cardStateClass(card)}`);
    identity.type = "button";
    applyCardActionData(identity, "mark_read", card, "reply");
    identity.innerHTML = replyCardIconSvg(card.icon, { filled: true });
    identity.setAttribute("aria-label", isCardRead(card) ? `${card.title} is read` : `Mark ${card.title} read`);
    identity.addEventListener("click", (event) => {
      event.stopPropagation();
      toggleCardRead(card);
    });

    const body = el("div", "card-body");
    body.setAttribute("role", "button");
    body.tabIndex = 0;
    body.setAttribute("aria-disabled", "false");
    applyCardActionData(body, "transcript", card, "reply");
    body.addEventListener("click", () => {
      if (!shouldSuppressCardActivation()) {
        showTranscript(card);
      }
    });
    body.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        showTranscript(card);
      }
    });
    const title = el("h2", "title", card.title || "Pucky");
    body.append(title);
    if (isPlayingCard(card)) {
      body.append(waveform(card, "wave-row", 46));
    } else {
      body.append(el("p", "preview", card.summary || card.transcript || ""));
    }

    const actions = el("div", "card-actions");
    if (hasAudio(card)) {
      const audio = el("button", isPlayingCard(card)
        ? "action action-audio is-playing"
        : "action action-audio");
      audio.type = "button";
      applyCardActionData(audio, "audio", card, "reply");
      audio.innerHTML = iconSvg("mic", { filled: true });
      audio.setAttribute("aria-label", `${isPlayingCard(card) ? "Pause" : "Play"} ${card.title}`);
      audio.addEventListener("click", async (event) => {
        event.stopPropagation();
        await toggleAudio(card);
      });
      actions.append(audio);
    }
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

    cardEl.append(identity, body, actions);
    if (cardStamp) {
      const stamp = el("time", "card-timestamp", cardStamp.text);
      stamp.dateTime = cardStamp.iso;
      cardEl.append(stamp);
    }
    appendCardSwipeAction(wrapper);
    wrapper.append(cardEl);
    installCardArchiveSwipe(wrapper, card);
    return wrapper;
  }

  function outboundCardView(card) {
    const wrapper = el("div", "card-wrap");
    const cardEl = el("article", isFailedPendingOutboundCard(card)
      ? "card card-outbound is-failed"
      : "card card-outbound");
    applyCardDataAttributes(cardEl, card, "pending_outbound");
    const copy = el("div", "card-outbound-copy");
    const preview = el("p", card?.pending_placeholder ? "card-outbound-preview is-placeholder" : "card-outbound-preview", pendingOutboundSummary(card));
    copy.append(preview);
    const meta = el("div", "card-outbound-meta");
    const status = el("span", `card-outbound-status ${pendingOutboundStatusClass(card)}`, pendingOutboundStatusLabel(card));
    meta.append(status);
    const stamp = cardTimestamp(card);
    if (stamp) {
      const time = el("time", "card-outbound-time", stamp.text);
      time.dateTime = stamp.iso;
      meta.append(time);
    }
    cardEl.append(copy, meta);
    appendCardSwipeAction(wrapper);
    wrapper.append(cardEl);
    installCardArchiveSwipe(wrapper, card);
    return wrapper;
  }

  function appendCardSwipeAction(wrapper) {
    const action = el("div", "card-swipe-action");
    action.setAttribute("aria-hidden", "true");
    action.innerHTML = iconSvg("archive_folder", { filled: true });
    action.append(el("span", "card-swipe-label", "Archive"));
    wrapper.append(action);
  }

  async function toggleAudio(card) {
    try {
      const current = await Pucky.request({ command: "player.state", args: {} });
      rememberPlayerProgress(current);
      const same = isSameAudioCard(current, card);
      const sameCompleted = same && isCompletePlayback(current);
      if (same && current.is_playing) {
        state.player = await pauseWithRewind();
      } else if (same && !sameCompleted) {
        state.activePath = audioControlKey(card);
        state.player = await Pucky.request({
          command: "player.play",
          args: { start_at_ms: savedPositionFor(current.source || current.path) }
        });
        await applySavedSpeedForCard(card);
        rememberPlayerProgress(state.player);
      } else if (card.audio_playlist_path) {
        state.activePath = audioControlKey(card);
        const queued = await Pucky.request({
          command: "player.queue.set",
          args: { playlist_path: card.audio_playlist_path, title: card.title, load: true }
        });
        const start = savedPositionFor(audioControlKey(card));
        state.player = await Pucky.request({
          command: "player.play",
          args: { start_at_ms: start }
        });
        await applySavedSpeedForCard(card);
        rememberPlayerProgress(state.player);
      } else {
        const start = savedPositionFor(card.audio_path);
        state.activePath = audioControlKey(card);
        forgetCompleted(card.audio_path);
        state.player = await Pucky.request({
          command: "player.play",
          args: { path: card.audio_path, title: card.title, start_at_ms: start }
        });
        await applySavedSpeedForCard(card);
        rememberPlayerProgress(state.player);
      }
      markCardRead(card);
      render();
    } catch (error) {
      showToast(error.message);
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
      const bubble = el("div", `bubble ${message.role === "user" ? "user" : "assistant"}`);
      const attachments = messageAttachmentRow(card, message, index);
      if (attachments) {
        bubble.append(attachments);
      }
      bubble.append(document.createTextNode(message.text || ""));
      if (message.role !== "user") {
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
    const attachments = normalizedAttachments(message?.attachments);
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
        content.append(richFrame(result, card.html_path), el("div", "rich-swipe-edge"));
    } catch (error) {
      if (isMockHtmlArtifact(card.html_path)) {
        content.append(richFrame(mockArtifactResult(card.html_path), card.html_path), el("div", "rich-swipe-edge"));
      } else {
        content.append(el("p", "preview", `Page unavailable: ${error.message}`));
      }
    }
    applyDetailDataAttributes(panel, "page", card, { viewer: "html_iframe" });
    openSideDetail(panel, card.title || "Page", content, dismissWithCleanup);
    rememberNavDetail("page", card, options);
    installDetailScrollPersistence(content, "page");
    void syncVoiceThreadScope({ reason: "show_page", render: true });
    restoreScrollPosition(content, options.scrollTop);
    const edge = content.querySelector(".rich-swipe-edge");
    if (edge) {
      cleanupEdgeDismiss = installHorizontalDismiss(edge, panel, dismissWithCleanup);
    }
  }

  function richFrame(result, path = "") {
    const iframe = el("iframe", "rich-frame");
    iframe.setAttribute("sandbox", "allow-scripts allow-forms allow-popups allow-same-origin");
    const mime = String((result && result.mime_type) || "").toLowerCase();
    const content = String((result && result.content_base64) || "");
    if (mime === "application/pdf" || ((mime === "" || mime === "application/octet-stream") && /\.pdf$/i.test(String(path)))) {
      iframe.srcdoc = pdfArtifactHtml(result, path, content);
    } else {
      iframe.srcdoc = atob(content);
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
      return showVideoAttachment(card, item, { ...restoreOptions, initialIndex: startIndex });
    }
    if (viewerType === "audio_player") {
      return showAudioAttachment(card, item, { ...restoreOptions, initialIndex: startIndex });
    }
    return showDocumentAttachment(card, item, { ...restoreOptions, initialIndex: startIndex });
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
      audio.src = await resolveArtifactUrl(item, { maxBytes: 32 * 1024 * 1024 });
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
    const viewer = await documentViewer(item);
    content.append(viewer);
    applyDetailDataAttributes(panel, "attachment", card, { viewer: attachmentViewerType(item) });
    openSideDetail(panel, item.title || card.title || "Attachment", content, dismissAttachment);
    rememberNavDetail("attachment", card, options);
    installDetailScrollPersistence(content, "attachment");
    void syncVoiceThreadScope({ reason: "show_document_attachment", render: true });
    restoreScrollPosition(content, options.scrollTop);
  }

  async function documentViewer(item) {
    const viewerType = attachmentViewerType(item);
    if (viewerType === "html_iframe") {
      return htmlIframeViewer(item);
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

  async function htmlIframeViewer(item) {
    const iframe = el("iframe", "document-frame");
    iframe.setAttribute("sandbox", "allow-scripts allow-forms allow-popups allow-same-origin");
    const path = item.viewer_path || item.html_viewer_path || item.document_html_path;
    const src = documentHtmlSrc(item);
    try {
      if (path) {
        const result = await Pucky.request({
          command: "artifact.read_base64",
          args: { path, max_bytes: 2 * 1024 * 1024 }
        });
        iframe.srcdoc = atob(String(result.content_base64 || ""));
      } else if (src) {
        iframe.src = src;
      } else {
        throw new Error("HTML attachment source is missing");
      }
    } catch (error) {
      const fallback = el("section", "document-fallback");
      fallback.append(attachmentMeta(item, "HTML"));
      fallback.append(el("p", "attachment-error", `HTML preview unavailable: ${error.message}`));
      return fallback;
    }
    return iframe;
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
    const bundled = bundledArtifactPath(item);
    if (bundled) {
      return bundled;
    }
    const path = mediaPath(item);
    if (!path) {
      throw new Error("attachment path is missing");
    }
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

  function bundledArtifactPath(item, field = "artifact") {
    const artifact = item && item[field];
    return artifact ? `fixtures/artifacts/${encodeURI(String(artifact))}` : "";
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

  function openSideDetail(panel, title, content, onDismiss) {
    const shell = el("div", "detail-shell");
    const header = el("header", "detail-header");
    const back = el("button", "detail-back");
    back.type = "button";
    back.innerHTML = iconSvg("chevron_left", { filled: false });
    back.setAttribute("aria-label", "Back");
    back.addEventListener("click", onDismiss);
    header.append(back, el("h1", "detail-title", title));
    shell.append(header, content);
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
      const back = detail.querySelector(".detail-back");
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

  function audioDetailContent(card) {
    const content = el("div", "detail-content audio-detail");
    content.dataset.audioKey = audioStateKey(card);
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
    return content;
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
      state.player = { ...state.player, position_ms: positionMs };
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
      } else if (!same && card.audio_path) {
        await Pucky.request({
          command: "player.play",
          args: { path: card.audio_path, title: card.title, start_at_ms: positionMs }
        });
      }
      state.player = await Pucky.request({ command: "player.seek", args: { position_ms: positionMs } });
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
    const speed = isActiveCard(card) ? (state.player.speed || speedForCard(card)) : speedForCard(card);
    controls.append(control(formatSpeed(speed), () => openSpeedPicker(card), "control-speed", "Playback speed"));
    const cluster = el("div", "transport-cluster");
    cluster.append(iconControl("replay_15", "Back 15 seconds", () => seekRelative(-15000), "control-skip"));
    cluster.append(iconControl(state.player.is_playing && isActiveCard(card) ? "pause" : "play_arrow", state.player.is_playing && isActiveCard(card) ? "Pause" : "Play", () => toggleAudio(card), "control-play"));
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
      } else if (!same && card.audio_path) {
        await Pucky.request({
          command: "player.play",
          args: { path: card.audio_path, title: card.title, start_at_ms: positionMs }
        });
      }
      state.player = await Pucky.request({ command: "player.seek", args: { position_ms: positionMs } });
      if (!state.player.is_playing) {
        state.player = await Pucky.request({ command: "player.play", args: { start_at_ms: positionMs } });
      }
      await applySavedSpeedForCard(card);
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

  function openSpeedPicker(card) {
    const overlay = document.getElementById("speedOverlay");
    const current = Number(isActiveCard(card) ? (state.player.speed || speedForCard(card)) : speedForCard(card));
    const menu = el("div", "speed-menu");
    for (const speed of [0.75, 1, 1.25, 1.5, 2, 2.5, 3]) {
      const button = el("button", speed === current ? "is-active" : "", `${speed}x`);
      button.addEventListener("click", async (event) => {
        event.stopPropagation();
        rememberSpeed(card, speed);
        state.player = await Pucky.request({ command: "player.speed", args: { speed } });
        closeSpeedPicker();
        render();
      });
      menu.append(button);
    }
    overlay.replaceChildren(menu);
    overlay.classList.add("is-open");
    overlay.setAttribute("aria-hidden", "false");
    overlay.onclick = closeSpeedPicker;
  }

  function closeSpeedPicker() {
    const overlay = document.getElementById("speedOverlay");
    overlay.classList.remove("is-open");
    overlay.setAttribute("aria-hidden", "true");
  }

  async function seekRelative(delta) {
    const next = Math.max(0, Math.min(state.player.duration_ms || 0, (state.player.position_ms || 0) + delta));
    state.player = await Pucky.request({ command: "player.seek", args: { position_ms: next } });
    rememberPlayerProgress(state.player);
    render();
  }

  async function pauseWithRewind() {
    const paused = await Pucky.request({ command: "player.pause", args: {} });
    const rewindTo = Math.max(0, Number(paused.position_ms || 0) - 1000);
    const rewound = await Pucky.request({ command: "player.seek", args: { position_ms: rewindTo } });
    rememberPlayerProgress(rewound);
    state.activePath = "";
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

  function canArchiveBySwipe(card) {
    if (state.route !== "feed" || state.showArchivedFeed || state.feedRefreshing) {
      return false;
    }
    if (Boolean(card?.archived)) {
      return false;
    }
    if (isPendingOutboundCard(card)) {
      return isFailedPendingOutboundCard(card);
    }
    return Boolean(cardSessionId(card) || String(card?.card_id || ""));
  }

  function installCardArchiveSwipe(wrapper, card) {
    const cardEl = wrapper?.querySelector(".card");
    if (!cardEl) {
      return;
    }
    let startX = 0;
    let startY = 0;
    let activePointerId = null;
    let active = false;
    let horizontal = false;
    let swiped = false;
    let swipeOffset = 0;

    const applyOffset = x => {
      swipeOffset = Math.max(0, Math.min(CARD_ARCHIVE_SWIPE_MAX_PX, Math.round(x)));
      wrapper.style.setProperty("--card-swipe-offset", `${swipeOffset}px`);
      wrapper.classList.toggle("is-card-swipe-active", swipeOffset > 0);
      wrapper.classList.toggle("is-card-swipe-armed", swipeOffset >= CARD_ARCHIVE_SWIPE_TRIGGER_PX);
    };

    const reset = () => {
      active = false;
      horizontal = false;
      swiped = false;
      activePointerId = null;
      applyOffset(0);
    };

    const begin = (x, y, target, pointer = null) => {
      if (!canArchiveBySwipe(card) || isDragIgnoredTarget(target)) {
        return;
      }
      startX = x;
      startY = y;
      activePointerId = pointer;
      active = true;
      horizontal = false;
      swiped = false;
      applyOffset(0);
    };

    const move = (x, y) => {
      if (!active) {
        return;
      }
      const dx = x - startX;
      const dy = y - startY;
      if (!horizontal && Math.abs(dx) < CARD_ARCHIVE_SWIPE_SLOP_PX && Math.abs(dy) < CARD_ARCHIVE_SWIPE_SLOP_PX) {
        return;
      }
      if (!horizontal && Math.abs(dy) > Math.abs(dx)) {
        reset();
        return;
      }
      horizontal = true;
      if (dx <= 0) {
        applyOffset(0);
        return;
      }
      applyOffset(dx);
    };

    const finish = () => {
      if (!active) {
        return;
      }
      active = false;
      activePointerId = null;
      if (!horizontal || swipeOffset < CARD_ARCHIVE_SWIPE_TRIGGER_PX || swiped) {
        reset();
        return;
      }
      swiped = true;
      state.cardMenuClickSuppressUntil = Date.now() + CARD_MENU_CLICK_SUPPRESS_MS;
      wrapper.classList.add("is-card-swiped-away");
      applyOffset(CARD_ARCHIVE_SWIPE_MAX_PX);
      void archiveHomeCard(card).then(result => {
        if (!result) {
          wrapper.classList.remove("is-card-swiped-away");
          reset();
        }
      });
    };

    wrapper.addEventListener("click", event => {
      if (shouldSuppressCardActivation()) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
      }
    }, true);
    wrapper.addEventListener("pointerdown", event => {
      begin(event.clientX, event.clientY, event.target, event.pointerId);
    });
    wrapper.addEventListener("pointermove", event => {
      if (activePointerId !== null && event.pointerId !== activePointerId) {
        return;
      }
      move(event.clientX, event.clientY);
    });
    wrapper.addEventListener("pointerup", event => {
      if (activePointerId !== null && event.pointerId !== activePointerId) {
        return;
      }
      finish();
    });
    wrapper.addEventListener("pointercancel", event => {
      if (activePointerId !== null && event.pointerId !== activePointerId) {
        return;
      }
      finish();
    });
    wrapper.addEventListener("touchstart", event => {
      if (event.touches.length) {
        begin(event.touches[0].clientX, event.touches[0].clientY, event.target);
      }
    }, { passive: true });
    wrapper.addEventListener("touchmove", event => {
      if (event.touches.length) {
        move(event.touches[0].clientX, event.touches[0].clientY);
      }
    }, { passive: true });
    wrapper.addEventListener("touchend", () => {
      finish();
    });
    wrapper.addEventListener("touchcancel", () => {
      finish();
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

  function messagesForCard(card) {
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
    if (state.route !== "feed") {
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

  function sleep(ms) {
    return new Promise(resolve => window.setTimeout(resolve, ms));
  }

  async function withTimeout(promise, timeoutMs, message) {
    let timeoutId = 0;
    const timeout = new Promise((_, reject) => {
      timeoutId = window.setTimeout(() => reject(new Error(message || "Timed out")), timeoutMs);
    });
    try {
      return await Promise.race([promise, timeout]);
    } finally {
      window.clearTimeout(timeoutId);
    }
  }

  function updateFeedRefreshIndicator(options = {}) {
    const indicator = document.getElementById("feedRefresh");
    if (!indicator) {
      return;
    }
    const offset = Math.max(0, Number(options.offset) || 0);
    const visible = Boolean(options.refreshing);
    const label = indicator.querySelector(".feed-refresh-pill");
    const text = "Refreshing...";
    indicator.style.setProperty("--feed-refresh-pull", `${offset}px`);
    indicator.classList.toggle("is-visible", Boolean(visible));
    indicator.classList.toggle("is-refreshing", Boolean(options.refreshing));
    if (label) {
      label.textContent = text;
    }
    indicator.setAttribute("aria-label", text);
    indicator.setAttribute("aria-hidden", visible ? "false" : "true");
  }

  function resetFeedRefreshIndicator() {
    const indicator = document.getElementById("feedRefresh");
    if (!indicator) {
      return;
    }
    indicator.style.setProperty("--feed-refresh-pull", "0px");
    const label = indicator.querySelector(".feed-refresh-pill");
    if (label) {
      label.textContent = "Refreshing...";
    }
    indicator.classList.remove("is-visible", "is-refreshing");
    indicator.setAttribute("aria-label", "Refreshing Home feed");
    indicator.setAttribute("aria-hidden", "true");
  }

  function releaseFeedPull(feed) {
    feed.classList.remove("is-rubber-banding");
    feed.classList.add("is-rubber-band-release");
    feed.style.transform = "";
    window.setTimeout(() => {
      feed.classList.remove("is-rubber-band-release");
    }, 340);
  }

  function finishFeedRefresh() {
    const feed = document.getElementById("feed");
    resetFeedRefreshIndicator();
    if (feed) {
      feed.classList.remove("is-feed-refreshing");
      releaseFeedPull(feed);
    }
  }

  async function refreshFeedCards() {
    if (state.feedRefreshPromise) {
      return state.feedRefreshPromise;
    }
    state.feedRefreshing = true;
    const startedAt = Date.now();
    const feed = document.getElementById("feed");
    if (feed) {
      feed.classList.remove("is-rubber-banding");
      feed.classList.remove("is-rubber-band-release");
      feed.classList.add("is-feed-refreshing");
      feed.style.transform = `translateY(${FEED_REFRESH_HOLD_OFFSET}px)`;
    }
    updateFeedRefreshIndicator({ offset: FEED_REFRESH_HOLD_OFFSET, refreshing: true });

    state.feedRefreshPromise = (async () => {
      try {
        await withTimeout(syncFeedCards({ reason: "pull_to_refresh", render: false, authoritative: true }), FEED_REFRESH_TIMEOUT_MS, "Feed refresh timed out");
        state.feedScrollTop = 0;
        render();
        restoreScrollPosition(document.getElementById("feed"), 0);
        persistNavState();
      } catch (_) {
        // Keep the existing feed visible when the native card store is briefly unavailable.
      } finally {
        const remaining = FEED_REFRESH_MIN_DWELL_MS - (Date.now() - startedAt);
        if (remaining > 0) {
          await sleep(remaining);
        }
        state.feedRefreshing = false;
        state.feedRefreshPromise = null;
        finishFeedRefresh();
      }
    })();
    return state.feedRefreshPromise;
  }

  function installFeedRubberBand() {
    const feed = document.getElementById("feed");
    if (!feed || feed.dataset.rubberBandBound) {
      return;
    }
    feed.dataset.rubberBandBound = "true";

    let startY = 0;
    let active = false;
    let offset = 0;
    let raf = 0;
    let pullDirection = "";
    let refreshArmed = false;

    const atTop = () => feed.scrollTop <= 0;
    const atBottom = () => feed.scrollTop + feed.clientHeight >= feed.scrollHeight - 1;
    const apply = nextOffset => {
      offset = nextOffset;
      if (raf) {
        return;
      }
      raf = requestAnimationFrame(() => {
        raf = 0;
        feed.style.transform = offset ? `translateY(${offset}px)` : "";
      });
    };
    const reset = () => {
      active = false;
      offset = 0;
      pullDirection = "";
      refreshArmed = false;
      if (raf) {
        cancelAnimationFrame(raf);
        raf = 0;
      }
      updateFeedRefreshIndicator({ offset: 0 });
      releaseFeedPull(feed);
    };

    feed.addEventListener("touchstart", event => {
      if (!event.touches.length || state.route !== "feed" || state.feedRefreshing) {
        return;
      }
      startY = event.touches[0].clientY;
      active = false;
      pullDirection = "";
      refreshArmed = false;
    }, { passive: true });

    feed.addEventListener("touchmove", event => {
      if (!event.touches.length || state.route !== "feed" || state.feedRefreshing) {
        return;
      }
      const dy = event.touches[0].clientY - startY;
      const topPull = dy > 0 && atTop();
      const bottomPull = dy < 0 && atBottom();
      const edgePull = topPull || bottomPull;
      if (!edgePull) {
        if (active) {
          reset();
        }
        return;
      }
      if (event.cancelable) {
        event.preventDefault();
      }
      active = true;
      feed.classList.add("is-rubber-banding");
      feed.classList.remove("is-rubber-band-release");
      pullDirection = topPull ? "top" : "bottom";
      const eased = Math.min(FEED_REFRESH_MAX_PULL, Math.pow(Math.abs(dy), 0.72));
      refreshArmed = pullDirection === "top" && eased >= FEED_REFRESH_THRESHOLD;
      if (pullDirection === "bottom") {
        refreshArmed = false;
      }
      updateFeedRefreshIndicator({ offset: pullDirection === "top" ? eased : 0 });
      apply(Math.sign(dy) * eased);
    }, { passive: false });

    feed.addEventListener("touchend", () => {
      if (pullDirection === "top" && refreshArmed) {
        active = false;
        offset = 0;
        refreshArmed = false;
        pullDirection = "";
        if (raf) {
          cancelAnimationFrame(raf);
          raf = 0;
        }
        refreshFeedCards();
        return;
      }
      if (active) {
        reset();
      }
    });
    feed.addEventListener("touchcancel", () => {
      if (active) {
        reset();
      }
    });
  }

  function cardTimestamp(card) {
    const raw = card.created_at || card.timestamp || card.time || "";
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
    return Boolean(card.transcript || (Array.isArray(card.transcript_messages) && card.transcript_messages.length));
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
    return Boolean(
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
      || attachment.data_url
      || attachment.text
      || attachment.preview
      || attachment.viewer
    );
  }

  function normalizeAttachment(attachment, index = 0) {
    const raw = { ...attachment };
    const mime = resolvedMediaMime(null, raw, mediaPath(raw) || bundledArtifactPath(raw) || raw.src || raw.data_url || "");
    const kind = normalizedAttachmentKind(raw, mime);
    const id = String(raw.id || raw.sha256 || raw.path || raw.artifact || raw.src || `${kind}-${index}`);
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
    const messages = messagesForCard(card);
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      if (String(messages[index]?.role || "").toLowerCase() === "user") {
        continue;
      }
      const attachments = normalizedAttachments(messages[index]?.attachments);
      if (attachments.length) {
        sets.push(attachments);
        break;
      }
    }
    const cardLevel = normalizedAttachments(card?.attachments);
    if (cardLevel.length) {
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
            { label: "ui_reply_cards_get", status: "completed" },
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
    if (state.player.is_playing && playerHasAudioIdentity(state.player)) {
      return isSameAudioCard(state.player, card);
    }
    return samePath(state.activePath, audioControlKey(card));
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

  function isPlayingCard(card) {
    return Boolean(state.player.is_playing && playerHasAudioIdentity(state.player) && isSameAudioCard(state.player, card));
  }

  function hasAudio(card) {
    return Boolean(card.audio_path || card.audio_playlist_path);
  }

  function audioControlKey(card) {
    return card.audio_playlist_path || card.audio_path || card.session_id || card.title || "";
  }

  function audioStateKey(card) {
    return normalizePath(audioControlKey(card));
  }

  function playerStateKey(player) {
    return normalizePath((player && (player.source || player.path)) || state.activePath || "");
  }

  function isSameAudioCard(player, card) {
    if (!playerHasAudioIdentity(player) || !hasAudio(card)) {
      return false;
    }
    return samePath(player.path, card.audio_path)
      || samePath(player.source, card.audio_playlist_path);
  }

  function playerHasAudioIdentity(player) {
    return Boolean(player && (player.path || player.source));
  }

  function syncActivePathFromPlayer(player) {
    if (!playerHasAudioIdentity(player) || !player.is_playing) {
      state.activePath = "";
      return;
    }
    const matched = state.cards.find(card => isSameAudioCard(player, card));
    if (matched) {
      state.activePath = audioControlKey(matched);
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

  function speedForCard(card) {
    return Number(state.speedByPath.get(audioStateKey(card)) || 1);
  }

  function rememberSpeed(card, speed) {
    state.speedByPath.set(audioStateKey(card), speed);
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

  async function applySavedSpeedForCard(card) {
    const speed = speedForCard(card);
    if (!Number.isFinite(speed) || Math.abs(speed - Number(state.player.speed || 1)) < 0.001) {
      return;
    }
    state.player = await Pucky.request({ command: "player.speed", args: { speed } });
  }

  function playbackPositionForCard(card) {
    const preview = scrubPreviewForCard(card);
    if (Number.isFinite(preview)) {
      return preview;
    }
    if (isActiveCard(card)) {
      return Number(state.player.position_ms || 0);
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
    if (playerDuration > 0 && isActiveCard(card)) {
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
    if (!cardId && !sessionId) {
      return null;
    }
    try {
      const result = await Pucky.request({
        command: "pucky.feed.action",
        args: {
          card_id: cardId,
          session_id: sessionId,
          action,
          client_action_id: `feed_${action}_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`
        }
      });
      const snapshot = result && result.snapshot && Array.isArray(result.snapshot.cards)
        ? result.snapshot
        : { cards: await fetchReplyCards() };
      state.cards = result && result.ok === false
        ? (Array.isArray(snapshot.cards) ? snapshot.cards : state.cards)
        : applyLocalFeedAction(Array.isArray(snapshot.cards) ? snapshot.cards : state.cards, card, action);
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

  function initialRoute(route) {
    const queryRoute = routeQueryParam();
    if (PAGE_TABS.some(tab => tab.route === queryRoute)) {
      return queryRoute;
    }
    const value = String(route || "");
    return PAGE_TABS.some(tab => tab.route === value) ? value : "feed";
  }

  function routeQueryParam() {
    try {
      return String(new URLSearchParams(window.location.search || "").get("route") || "").trim();
    } catch (_) {
      return "";
    }
  }

  function initialOpenTrayRoute(openTrayRoute, route) {
    const value = String(openTrayRoute || "");
    const normalizedRoute = initialRoute(route);
    return value && value === normalizedRoute ? value : null;
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
    if (state.route !== "feed") {
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
    return target ? state.cards.find(card => cardSessionId(card) === target) || null : null;
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
    return target ? state.cards.find(card => cardThreadId(card) === target) || null : null;
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
    if (feed && state.route === "feed") {
      state.feedScrollTop = scrollNumber(feed.scrollTop);
    }
  }

  function restoreFeedScroll() {
    if (state.route === "feed") {
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
        route: initialRoute(state.route),
        open_tray_route: state.openTrayRoute || null,
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
      noteLinksScrollActivity();
    }, 120), { passive: true });
  }

  function installFeedSyncLoop() {
    if (feedSyncIntervalId) {
      return;
    }
    feedSyncIntervalId = window.setInterval(() => {
      if (document.visibilityState !== "visible" || state.route !== "feed" || state.feedRefreshing) {
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
    if (state.route !== "feed") {
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

  function formatSpeed(speed) {
    const value = Number(speed || 1);
    if (!Number.isFinite(value)) {
      return "1x";
    }
    return `${String(Math.round(value * 100) / 100).replace(/\.0$/, "")}x`;
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
    console.warn(message);
  }

  setInterval(async () => {
    if (state.route === "feed" || state.activePath || isTurnActive(state.turn) || wakeProofVisualState(state.wakeStatus) !== "idle") {
      let changed = false;
      try {
        if (state.activePath) {
          state.player = await Pucky.request({ command: "player.state", args: {} });
          syncActivePathFromPlayer(state.player);
          if (state.player.path) {
            rememberPlayerProgress(state.player);
          }
          changed = true;
        }
        if (state.route === "feed" || isTurnActive(state.turn)) {
          const wasTurnActive = isTurnActive(state.turn);
          await loadTurnStatus({ render: false });
          const turnActive = isTurnActive(state.turn);
          if (state.route === "feed" && (turnActive || wasTurnActive)) {
            await refreshCardsFromNativeSnapshot({ render: false });
          }
          changed = changed || turnActive || wasTurnActive;
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
    }
  }, 250);

  setInterval(() => {
    if (state.activePath && state.player.is_playing) {
      render();
    }
  }, 90);

  window.addEventListener("pagehide", persistNavState);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      if (state.links.handoffLocked) {
        linksDebugRecord("document_hidden", { slug: String(state.links.openingSlug || "") }, "click");
        releaseLinksHandoff({ render: false, reason: "document_hidden" });
      }
      persistNavState();
      return;
    }
    if (state.route === "feed") {
      syncFeedCards({ reason: "visibility_visible", silent: true, render: true });
      return;
    }
    if (state.route === "links") {
      refreshLinksConnectedSoon({ render: true, force: true });
      return;
    }
    if (state.route === "settings") {
      loadSettingsState({ render: true });
    }
  });

  window.PuckyHandleAndroidBack = handleAndroidBack;
  window.PuckyUiDebug = {
    describe: describeUiSurface,
    dispatch: uiDebugDispatch
  };
  installFeedRubberBand();
  installFeedScrollPersistence();
  installFeedSyncLoop();
  installCardMenuOutsideDismiss();
  void syncVoiceThreadScope({ reason: "boot", render: true });
  loadTurnStatus({ render: false });
  loadSettingsState({ render: false, ensureSurface: state.route === "settings" });
  loadCardIconRegistry({ render: false });
  loadCards();
  if (state.route === "links") {
    linksDebugStartSession("route", { reason: "boot_route" });
    linksDebugRecord("links_route_enter", { reason: "boot_route" }, "route");
    loadLinksPortal({ render: true });
  }
})();
