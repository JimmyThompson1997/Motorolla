(() => {
  const READ_STATE_KEY = "pucky.cover.read_actions.v2";
  const COMPLETE_EPSILON_MS = 500;

  const MATERIAL_SYMBOLS = {
    mail: {
      filled: '<path d="M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2Zm0 4-8 5-8-5V6l8 5 8-5v2Z"/>',
      outline: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m4.2 7 7.8 5.8L19.8 7"/><path d="m4.4 18 5.7-5.1"/><path d="m19.6 18-5.7-5.1"/>'
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
    mic: {
      filled: '<path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3Zm5.3-3c0 3-2.54 5.1-5.3 5.1S6.7 14 6.7 11H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c3.28-.48 6-3.3 6-6.72h-1.7Z"/>',
      outline: '<rect x="9" y="2.5" width="6" height="11" rx="3"/><path d="M5.5 10.8c0 3.5 2.7 6.2 6.5 6.2s6.5-2.7 6.5-6.2"/><path d="M12 17v4"/>'
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
    settings: {
      filled: '<path d="M19.4 13.5c.1-.5.1-1 .1-1.5s0-1-.1-1.5l2-1.5-2-3.5-2.4 1a7.2 7.2 0 0 0-2.6-1.5L14 2h-4l-.4 2.5A7.2 7.2 0 0 0 7 6L4.6 5l-2 3.5 2 1.5c-.1.5-.1 1-.1 1.5s0 1 .1 1.5l-2 1.5 2 3.5L7 18a7.2 7.2 0 0 0 2.6 1.5L10 22h4l.4-2.5A7.2 7.2 0 0 0 17 18l2.4 1 2-3.5-2-1.5ZM12 15.5A3.5 3.5 0 1 1 12 8a3.5 3.5 0 0 1 0 7.5Z"/>',
      outline: '<path d="m10.2 3-.4 2.2a7 7 0 0 0-2.1.9L5.6 5.2 3.7 8.5l1.8 1.3a7.7 7.7 0 0 0 0 2.4l-1.8 1.3 1.9 3.3 2.1-.9a7 7 0 0 0 2.1.9l.4 2.2h3.6l.4-2.2a7 7 0 0 0 2.1-.9l2.1.9 1.9-3.3-1.8-1.3a7.7 7.7 0 0 0 0-2.4l1.8-1.3-1.9-3.3-2.1.9a7 7 0 0 0-2.1-.9L13.8 3h-3.6Z"/><circle cx="12" cy="12" r="3.1"/>'
    }
  };

  const PAGE_TABS = [
    { route: "feed", icon: "mail", label: "Inbox" },
    { route: "calls", icon: "phone", label: "Calls" },
    { route: "texts", icon: "text", label: "Texts" },
    { route: "routines", icon: "checklist", label: "Routines" },
    { route: "sensors", icon: "sensors", label: "Sensors" }
  ];

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
      audio_playlist_path: "/mock/pocket-computers.m3u",
      html_path: "/mock/pocket-computers.html"
    }
  ];

  const state = {
    cards: [],
    route: "feed",
    activePath: "",
    player: { loaded: false, is_playing: false, position_ms: 0, duration_ms: 0, speed: 1 },
    savedPositions: new Map(),
    completedPaths: new Set(),
    speedByPath: new Map(),
    sheetCard: null,
    traceCard: null,
    waveHistory: new Map(),
    readActions: loadReadActions(),
    drag: null
  };

  const pending = new Map();
  let seq = 0;

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
        rememberPlayerProgress(state.player);
        render();
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
    if (command === "player.state") {
      return state.player;
    }
    if (command === "player.play") {
      const nextPath = args.path || state.player.path || state.activePath;
      const nextSource = args.path ? null : (state.player.source || null);
      state.activePath = args.path || state.activePath;
      const start = args.start_at_ms ?? state.savedPositions.get(normalizePath(nextPath)) ?? 0;
      state.player = {
        schema: "pucky.player_state.v1",
        loaded: true,
        state: "playing",
        is_playing: true,
        path: nextPath,
        source: nextSource,
        position_ms: start,
        duration_ms: 1000 * 60 * 19 + 57000,
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
        duration_ms: 1000 * 60 * 19 + 57000,
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
      }
      return state.player;
    }
    if (command === "artifact.read_base64") {
      return mockArtifactResult(args.path);
    }
    throw new Error(`Unsupported browser mock command: ${command}`);
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

  async function loadCards() {
    try {
      const snapshot = await Pucky.request({ command: "ui.reply_cards.get", args: {} });
      state.cards = Array.isArray(snapshot.cards) ? snapshot.cards : [];
    } catch (error) {
      state.cards = MOCK_CARDS;
    }
    render();
  }

  function render() {
    renderTabs();
    renderFeed();
    renderAudioSheet();
  }

  function renderTabs() {
    const tabs = document.getElementById("pageTabs");
    if (!tabs) {
      return;
    }
    tabs.replaceChildren(...PAGE_TABS.map(tabView));
  }

  function tabView(tab) {
    const button = el("button", tab.route === state.route ? "tab is-active" : "tab");
    button.type = "button";
    button.dataset.route = tab.route;
    button.setAttribute("aria-label", tab.label);
    button.setAttribute("aria-current", tab.route === state.route ? "page" : "false");
    button.innerHTML = iconSvg(tab.icon, { filled: tab.route === state.route });
    button.addEventListener("click", () => {
      state.route = tab.route;
      render();
    });
    return button;
  }

  function renderFeed() {
    const feed = document.getElementById("feed");
    document.querySelector(".app-shell")?.setAttribute("data-view", state.route);
    if (state.route !== "feed") {
      const current = PAGE_TABS.find(tab => tab.route === state.route);
      feed.replaceChildren(el("div", "placeholder-page", `${current?.label || "Page"} will live here.`));
      return;
    }
    if (!state.cards.length) {
      feed.innerHTML = '<div class="empty">No replies yet.<br>Pucky will place agent replies here.</div>';
      return;
    }
    feed.replaceChildren(...state.cards.map(cardView));
  }

  function cardView(card) {
    const images = cardImages(card);
    const wrapper = el("div", images.length ? "card-wrap has-images" : "card-wrap");
    const cardEl = el("article", isActionRead(card, "audio") ? "card" : "card card-unread");
    cardEl.style.setProperty("--accent", card.accent || "#72c2ff");
    const cardStamp = cardTimestamp(card);

    if (images.length) {
      const imagesButton = el("button", "image-affordance");
      imagesButton.type = "button";
      imagesButton.innerHTML = `${iconSvg("image", { filled: true })}<span class="image-count">${images.length}</span>`;
      imagesButton.setAttribute("aria-label", `Open ${images.length} image${images.length === 1 ? "" : "s"} for ${card.title}`);
      imagesButton.addEventListener("click", (event) => {
        event.stopPropagation();
        showImageReel(card);
      });
      wrapper.append(imagesButton);
    }

    const identity = el("button", `identity ${actionStateClass(card, "audio")}`);
    identity.type = "button";
    identity.innerHTML = iconSvg(card.icon, { filled: true });
    identity.setAttribute("aria-label", isActionRead(card, "audio") ? `Mark ${card.title} unread` : `Mark ${card.title} read`);
    identity.addEventListener("click", (event) => {
      event.stopPropagation();
      toggleRead(card, "audio");
      renderFeed();
    });

    const body = el("div", "card-body");
    body.setAttribute("role", "button");
    body.tabIndex = 0;
    body.addEventListener("click", () => showTranscript(card));
    body.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        showTranscript(card);
      }
    });
    const title = el("h2", "title", card.title || "Pucky");
    body.append(title);
    if (isActiveCard(card) && state.player.is_playing) {
      body.append(waveform(card, "wave-row", 46));
    } else {
      body.append(el("p", "preview", card.summary || card.transcript || ""));
    }

    const actions = el("div", "card-actions");
    if (hasAudio(card)) {
      const audio = el("button", isActiveCard(card) && state.player.is_playing
        ? "action action-audio is-playing"
        : "action action-audio");
      audio.type = "button";
      audio.innerHTML = iconSvg("mic", { filled: true });
      audio.setAttribute("aria-label", `${state.player.is_playing && isActiveCard(card) ? "Pause" : "Play"} ${card.title}`);
      audio.addEventListener("click", (event) => {
        event.stopPropagation();
        toggleAudio(card);
      });
      actions.append(audio);
    }
    if (card.html_path) {
      const page = el("button", `action ${actionStateClass(card, "page")}`);
      page.type = "button";
      page.innerHTML = iconSvg("attachment", { filled: true });
      page.setAttribute("aria-label", `Open page for ${card.title}`);
      page.addEventListener("click", (event) => {
        event.stopPropagation();
        showRichPage(card);
      });
      actions.append(page);
    }

    cardEl.append(identity, body, actions);
    if (cardStamp) {
      const stamp = el("time", "card-timestamp", cardStamp.text);
      stamp.dateTime = cardStamp.iso;
      cardEl.append(stamp);
    }
    wrapper.append(cardEl);
    return wrapper;
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
          args: { start_at_ms: savedPositionFor(current.path) }
        });
        rememberPlayerProgress(state.player);
      } else if (card.audio_playlist_path) {
        state.activePath = audioControlKey(card);
        markRead(card, "audio");
        const queued = await Pucky.request({
          command: "player.queue.set",
          args: { playlist_path: card.audio_playlist_path, title: card.title, load: true }
        });
        const start = savedPositionFor(queued.path);
        state.player = await Pucky.request({
          command: "player.play",
          args: { start_at_ms: start }
        });
        rememberPlayerProgress(state.player);
      } else {
        const start = savedPositionFor(card.audio_path);
        state.activePath = audioControlKey(card);
        markRead(card, "audio");
        forgetCompleted(card.audio_path);
        state.player = await Pucky.request({
          command: "player.play",
          args: { path: card.audio_path, title: card.title, start_at_ms: start }
        });
        rememberPlayerProgress(state.player);
      }
      render();
    } catch (error) {
      showToast(error.message);
    }
  }

  function showTranscript(card) {
    markRead(card, "transcript");
    renderFeed();
    const panel = document.getElementById("detail");
    const messages = messagesForCard(card);
    const content = el("div", "detail-content chat-detail");
    messages.forEach((message, index) => {
      const bubble = el("div", `bubble ${message.role === "user" ? "user" : "assistant"}`);
      bubble.append(document.createTextNode(message.text || ""));
      if (message.role !== "user") {
        const trace = el("button", "bubble-trace-action");
        trace.type = "button";
        trace.innerHTML = iconSvg("settings", { filled: false });
        trace.setAttribute("aria-label", "Open thinking log");
        trace.addEventListener("click", (event) => {
          event.stopPropagation();
          showTurnTrace(card, message, index);
        });
        bubble.append(trace);
      }
      const stamp = messageTimestamp(message);
      if (stamp) {
        bubble.append(el("span", "bubble-meta", stamp));
      }
      content.append(bubble);
    });
    openSideDetail(panel, card.title || "Transcript", content, dismissDetail);
    scrollTranscriptToLatest(content);
  }

  async function showRichPage(card) {
    markRead(card, "page");
    renderFeed();
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
      content.append(richFrame(result), el("div", "rich-swipe-edge"));
    } catch (error) {
      if (isMockHtmlArtifact(card.html_path)) {
        content.append(richFrame(mockArtifactResult(card.html_path)), el("div", "rich-swipe-edge"));
      } else {
        content.append(el("p", "preview", `Page unavailable: ${error.message}`));
      }
    }
    openSideDetail(panel, card.title || "Page", content, dismissWithCleanup);
    const edge = content.querySelector(".rich-swipe-edge");
    if (edge) {
      cleanupEdgeDismiss = installHorizontalDismiss(edge, panel, dismissWithCleanup);
    }
  }

  function richFrame(result) {
    const iframe = el("iframe", "rich-frame");
    iframe.setAttribute("sandbox", "allow-scripts allow-forms allow-popups allow-same-origin");
    iframe.srcdoc = atob(result.content_base64 || "");
    return iframe;
  }

  async function showImageReel(card) {
    const images = cardImages(card);
    const panel = document.getElementById("detail");
    const content = el("div", "detail-content image-reel");
    if (!images.length) {
      content.append(el("p", "preview", "No images are attached to this reply."));
    }
    for (let index = 0; index < images.length; index++) {
      const image = images[index];
      const frame = el("figure", "image-frame");
      const imageEl = document.createElement("img");
      imageEl.className = "image-reel-img";
      imageEl.alt = image.title || image.alt || `Generated image ${index + 1}`;
      imageEl.decoding = "async";
      try {
        imageEl.src = await resolveImageSrc(image);
      } catch (error) {
        frame.append(el("p", "preview", `Image unavailable: ${error.message}`));
      }
      if (imageEl.src) {
        frame.append(imageEl);
      }
      if (image.title || image.alt) {
        frame.append(el("figcaption", "image-caption", image.title || image.alt));
      }
      content.append(frame);
    }
    openSideDetail(panel, card.title || "Images", content, dismissDetail);
  }

  async function resolveImageSrc(image) {
    if (image.src || image.data_url) {
      return String(image.src || image.data_url);
    }
    const path = image.path || image.local_path || image.image_path;
    if (!path) {
      throw new Error("image path is missing");
    }
    const result = await Pucky.request({
      command: "artifact.read_base64",
      args: { path, max_bytes: 5 * 1024 * 1024 }
    });
    const mime = result.mime_type || image.mime_type || guessImageMime(path);
    return `data:${mime};base64,${result.content_base64 || ""}`;
  }

  function guessImageMime(path) {
    const value = String(path || "").toLowerCase();
    if (value.endsWith(".jpg") || value.endsWith(".jpeg")) return "image/jpeg";
    if (value.endsWith(".webp")) return "image/webp";
    if (value.endsWith(".gif")) return "image/gif";
    if (value.endsWith(".svg")) return "image/svg+xml";
    return "image/png";
  }

  function showTurnTrace(card, message = null, index = 0) {
    state.traceCard = card;
    const sheet = document.getElementById("traceSheet");
    const wrap = el("div", "trace-inner");
    const dragZone = el("div", "sheet-drag-zone");
    dragZone.append(el("div", "sheet-grip"));
    wrap.append(dragZone);

    const traceCard = el("article", "trace-card");
    traceCard.append(el("h1", "trace-title", "Thinking Log"));
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

  function openSideDetail(panel, title, content, onDismiss) {
    const shell = el("div", "detail-shell");
    const header = el("header", "detail-header");
    const back = el("button", "detail-back");
    back.type = "button";
    back.innerHTML = iconSvg("chevron_left", { filled: false });
    back.setAttribute("aria-label", "Back to feed");
    back.addEventListener("click", onDismiss);
    header.append(back, el("h1", "detail-title", title));
    shell.append(header, content);
    panel.replaceChildren(shell);
    panel.setAttribute("aria-hidden", "false");
    panel.classList.add("is-open");
    installHorizontalDismiss(shell, panel, onDismiss);
  }

  function dismissDetail() {
    const panel = document.getElementById("detail");
    panel.style.transform = "";
    panel.classList.remove("is-open", "is-dragging");
    panel.setAttribute("aria-hidden", "true");
    panel.replaceChildren();
  }

  function showAudioSheet(card) {
    state.sheetCard = card;
    renderAudioSheet();
    const sheet = document.getElementById("audioSheet");
    sheet.setAttribute("aria-hidden", "false");
    sheet.classList.add("is-open");
  }

  function renderAudioSheet() {
    const sheet = document.getElementById("audioSheet");
    const card = state.sheetCard;
    if (!card) {
      return;
    }
    const wrap = el("div", "sheet-inner");
    const dragZone = el("div", "sheet-drag-zone");
    dragZone.append(el("div", "sheet-grip"));
    wrap.append(dragZone);
    wrap.append(el("h1", "sheet-title", card.title || "Audio"));
    wrap.append(el("p", "sheet-summary", card.summary || ""));
    const wave = waveform(card, "sheet-wave", 92);
    wave.addEventListener("click", () => {});
    wrap.append(wave);

    const scrub = el("div", "scrub");
    const range = document.createElement("input");
    range.type = "range";
    range.min = "0";
    range.max = String(Math.max(1, state.player.duration_ms || 1));
    range.value = String(Math.max(0, state.player.position_ms || 0));
    range.addEventListener("change", async () => {
      state.player = await Pucky.request({ command: "player.seek", args: { position_ms: Number(range.value) } });
      rememberPlayerProgress(state.player);
      renderAudioSheet();
    });
    scrub.append(range);
    const elapsed = Math.max(0, state.player.position_ms || 0);
    const duration = Math.max(0, state.player.duration_ms || 0);
    const timeRow = el("div", "time-row");
    timeRow.append(
      el("span", "time-elapsed", formatTime(elapsed)),
      el("span", "time-remaining", `-${formatTime(Math.max(0, duration - elapsed))}`)
    );
    scrub.append(timeRow);
    wrap.append(scrub);

    const controls = el("div", "controls");
    controls.append(iconControl("replay_15", "Back 15 seconds", () => seekRelative(-15000), "control-skip"));
    controls.append(iconControl(state.player.is_playing ? "pause" : "play_arrow", state.player.is_playing ? "Pause" : "Play", () => toggleAudio(card), "control-play"));
    controls.append(iconControl("forward_30", "Forward 30 seconds", () => seekRelative(30000), "control-skip"));
    controls.append(control(`${state.player.speed || 1}x`, () => openSpeedPicker(card), "control-speed", "Playback speed"));
    wrap.append(controls);
    installVerticalDismiss(wrap, sheet, dismissAudioSheet);
    sheet.replaceChildren(wrap);
  }

  function dismissAudioSheet() {
    const sheet = document.getElementById("audioSheet");
    sheet.style.transform = "";
    sheet.classList.remove("is-open", "is-dragging");
    sheet.setAttribute("aria-hidden", "true");
    state.sheetCard = null;
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
        showAudioSheet(card);
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
    const current = Number(state.player.speed || 1);
    const menu = el("div", "speed-menu");
    for (const speed of [0.75, 1, 1.25, 1.5, 2, 2.5, 3]) {
      const button = el("button", speed === current ? "is-active" : "", `${speed}x`);
      button.addEventListener("click", async (event) => {
        event.stopPropagation();
        state.speedByPath.set(normalizePath(audioControlKey(card)), speed);
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

  function installVerticalDismiss(target, panel, onDismiss = dismissAudioSheet) {
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
      begin(event.clientX, event.clientY);
      if (target.setPointerCapture) {
        target.setPointerCapture(event.pointerId);
      }
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

  function messagesForCard(card) {
    if (Array.isArray(card.transcript_messages) && card.transcript_messages.length) {
      return card.transcript_messages.map(item => ({
        role: item.role || item.sender || "assistant",
        text: item.text || item.content || "",
        time: item.time || "",
        timestamp: item.timestamp || "",
        created_at: item.created_at || ""
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
    return Array.isArray(card?.images)
      ? card.images.filter(image => image && (image.path || image.local_path || image.image_path || image.src || image.data_url))
      : [];
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
    return isSameAudioCard(state.player, card) || samePath(state.activePath, audioControlKey(card));
  }

  function hasAudio(card) {
    return Boolean(card.audio_path || card.audio_playlist_path);
  }

  function audioControlKey(card) {
    return card.audio_playlist_path || card.audio_path || card.session_id || card.title || "";
  }

  function isSameAudioCard(player, card) {
    if (!player || !hasAudio(card)) {
      return false;
    }
    return samePath(player.path, card.audio_path)
      || samePath(player.source, card.audio_playlist_path)
      || samePath(state.activePath, audioControlKey(card));
  }

  function samePath(left, right) {
    return Boolean(left && right && normalizePath(left) === normalizePath(right));
  }

  function normalizePath(path) {
    return String(path || "").replace(/^\/data\/user\/0\//, "/data/data/");
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
    if (!player || !player.path) {
      return;
    }
    const normalized = normalizePath(player.path);
    if (isCompletePlayback(player)) {
      state.completedPaths.add(normalized);
      rememberPosition(player.path, 0);
      return;
    }
    state.completedPaths.delete(normalized);
    rememberPosition(player.path, Math.max(0, Number(player.position_ms || 0)));
  }

  function forgetCompleted(path) {
    state.completedPaths.delete(normalizePath(path));
  }

  function actionKey(card, action) {
    return `${card.session_id || card.title || card.audio_path || "card"}:${action}`;
  }

  function markRead(card, action) {
    state.readActions.add(actionKey(card, action));
    persistReadActions();
  }

  function markUnread(card, action) {
    state.readActions.delete(actionKey(card, action));
    persistReadActions();
  }

  function toggleRead(card, action) {
    if (isActionRead(card, action)) {
      markUnread(card, action);
    } else {
      markRead(card, action);
    }
  }

  function isActionRead(card, action) {
    return state.readActions.has(actionKey(card, action));
  }

  function actionStateClass(card, action) {
    return isActionRead(card, action) ? "is-read" : "is-unread";
  }

  function loadReadActions() {
    try {
      return new Set(JSON.parse(localStorage.getItem(READ_STATE_KEY) || "[]"));
    } catch (_) {
      return new Set();
    }
  }

  function persistReadActions() {
    try {
      localStorage.setItem(READ_STATE_KEY, JSON.stringify(Array.from(state.readActions)));
    } catch (_) {
      // Read state is a visual affordance; failure should never break the shell.
    }
  }

  function normalizeIcon(icon) {
    const value = String(icon || "").toLowerCase();
    return MATERIAL_SYMBOLS[value] ? value : "mail";
  }

  function iconSvg(icon, options = {}) {
    const name = normalizeIcon(icon);
    const filled = options.filled !== false;
    const className = options.className || "material-icon";
    const symbol = MATERIAL_SYMBOLS[name] || MATERIAL_SYMBOLS.mail;
    const paths = filled ? (symbol.filled || symbol.outline) : (symbol.outline || symbol.filled);
    return `<svg class="${className}" viewBox="0 0 24 24" aria-hidden="true">${paths}</svg>`;
  }

  function formatTime(ms) {
    const total = Math.max(0, Math.round(Number(ms || 0) / 1000));
    const minutes = Math.floor(total / 60);
    const seconds = total % 60;
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
    if (state.activePath) {
      try {
        state.player = await Pucky.request({ command: "player.state", args: {} });
        if (state.player.path) {
          state.activePath = state.player.path;
          rememberPlayerProgress(state.player);
        }
        render();
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

  loadCards();
})();
