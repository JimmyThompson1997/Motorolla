(() => {
  const ICONS = {
    clock: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8"/><path d="M12 7v5l4 2"/></svg>',
    bolt: '<svg viewBox="0 0 24 24"><path d="M13 2 4 14h7l-1 8 10-13h-7z"/></svg>',
    calendar: '<svg viewBox="0 0 24 24"><rect x="4" y="5" width="16" height="15" rx="2"/><path d="M8 3v4M16 3v4M4 10h16M8 14h3M13 14h3"/></svg>',
    moon: '<svg viewBox="0 0 24 24"><path d="M20 15.5A8.5 8.5 0 0 1 8.5 4 7 7 0 1 0 20 15.5z"/></svg>',
    book: '<svg viewBox="0 0 24 24"><path d="M5 4h8a3 3 0 0 1 3 3v13H8a3 3 0 0 0-3 3z"/><path d="M19 4h-3a3 3 0 0 0-3 3v13h3a3 3 0 0 1 3 3z"/></svg>',
    mail: '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m4 7 8 6 8-6"/></svg>'
  };
  const ACTIONS = {
    transcript: '<svg viewBox="0 0 24 24"><path d="M5 5h14v10H9l-4 4z"/><path d="M8 9h8M8 12h5"/></svg>',
    page: '<svg viewBox="0 0 24 24"><path d="m21.4 11.1-9.2 9.2a6 6 0 0 1-8.5-8.5l9.2-9.2a4 4 0 0 1 5.7 5.7l-9 9a2 2 0 0 1-2.8-2.8l8.5-8.5"/></svg>'
  };
  const MOCK_CARDS = [
    {
      session_id: "mock_morning",
      title: "Morning launch",
      icon: "clock",
      accent: "#ffb000",
      summary: "Brief me, triage the inbox, scan the weather, surface the one thing that cannot slip.",
      transcript_messages: [
        { role: "user", text: "Pucky, start my morning." },
        { role: "assistant", text: "Inbox triage, weather, and your first priority are ready." }
      ],
      audio_path: "/mock/morning.wav",
      html_path: "/mock/morning.html"
    },
    {
      session_id: "mock_leave",
      title: "Leaving home",
      icon: "bolt",
      accent: "#50d86a",
      summary: "Start commute, queue a drive mix, notify ETA, check garage state, and keep it light.",
      transcript_messages: [
        { role: "user", text: "Leaving home." },
        { role: "assistant", text: "Commute mode is ready. Garage status is queued." }
      ],
      audio_path: "/mock/leaving.wav",
      html_path: "/mock/leaving.html"
    },
    {
      session_id: "mock_meeting",
      title: "Meeting prep",
      icon: "calendar",
      accent: "#3a84ff",
      summary: "Pull agenda notes, summarize the last thread, identify likely decisions, and prep follow-ups.",
      transcript_messages: [
        { role: "user", text: "What do I need before the meeting?" },
        { role: "assistant", text: "Agenda, prior notes, and decision risks are lined up." }
      ],
      audio_path: "/mock/meeting.wav",
      html_path: "/mock/meeting.html"
    },
    {
      session_id: "mock_night",
      title: "Night wrap",
      icon: "moon",
      accent: "#8b63ff",
      summary: "Summarize the day, capture loose tasks, set tomorrow priorities, dim notifications.",
      transcript_messages: [
        { role: "user", text: "Wrap my day." },
        { role: "assistant", text: "Loose tasks and tomorrow's first move are organized." }
      ],
      audio_path: "/mock/night.wav",
      html_path: "/mock/night.html"
    },
    {
      session_id: "mock_book",
      title: "Pocket Computers",
      icon: "book",
      accent: "#72c2ff",
      summary: "From Pocket Computers to Planetary Platforms. Complete George narration, ready to resume.",
      transcript_messages: [
        { role: "assistant", text: "Chapter narration is ready at the last saved position." }
      ],
      audio_path: "/mock/pocket-computers.wav",
      html_path: "/mock/pocket-computers.html"
    }
  ];

  const state = {
    cards: [],
    activePath: "",
    player: { loaded: false, is_playing: false, position_ms: 0, duration_ms: 0, speed: 1 },
    savedPositions: new Map(),
    speedByPath: new Map(),
    sheetCard: null,
    waveHistory: new Map(),
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
      state.activePath = args.path || state.activePath;
      const start = args.start_at_ms ?? state.savedPositions.get(state.activePath) ?? 0;
      state.player = {
        schema: "pucky.player_state.v1",
        loaded: true,
        is_playing: true,
        path: state.activePath,
        position_ms: start,
        duration_ms: 1000 * 60 * 19 + 57000,
        speed: state.speedByPath.get(state.activePath) || 1,
        can_seek: true,
        audio_session_id: 1
      };
      return state.player;
    }
    if (command === "player.pause") {
      state.player = { ...state.player, is_playing: false };
      return state.player;
    }
    if (command === "player.seek") {
      state.player = { ...state.player, position_ms: Math.max(0, Number(args.position_ms || 0)) };
      return state.player;
    }
    if (command === "player.speed") {
      const speed = Math.max(0.5, Math.min(3, Number(args.speed || 1)));
      state.player = { ...state.player, speed };
      if (state.activePath) {
        state.speedByPath.set(state.activePath, speed);
      }
      return state.player;
    }
    if (command === "artifact.read_base64") {
      return {
        content_base64: btoa("<!doctype html><style>body{font-family:sans-serif;padding:24px;line-height:1.4}</style><h1>Pucky page</h1><p>This is a browser-mode rich reply preview.</p>")
      };
    }
    throw new Error(`Unsupported browser mock command: ${command}`);
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
    renderFeed();
    renderAudioSheet();
  }

  function renderFeed() {
    const feed = document.getElementById("feed");
    if (!state.cards.length) {
      feed.innerHTML = '<div class="empty">No replies yet.<br>Pucky will place agent replies here.</div>';
      return;
    }
    feed.replaceChildren(...state.cards.map(cardView));
  }

  function cardView(card) {
    const cardEl = el("article", "card");
    cardEl.style.setProperty("--accent", card.accent || "#72c2ff");

    const identity = el("button", "identity");
    identity.type = "button";
    identity.innerHTML = ICONS[normalizeIcon(card.icon)] || ICONS.mail;
    identity.setAttribute("aria-label", card.audio_path ? `Play ${card.title}` : card.title);
    if (isActiveCard(card)) {
      identity.classList.add("audio-active");
    }
    identity.addEventListener("click", (event) => {
      event.stopPropagation();
      if (card.audio_path) {
        toggleAudio(card);
      }
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
    if (hasTranscript(card)) {
      const transcript = el("button", "action");
      transcript.type = "button";
      transcript.innerHTML = ACTIONS.transcript;
      transcript.setAttribute("aria-label", `Open transcript for ${card.title}`);
      transcript.addEventListener("click", (event) => {
        event.stopPropagation();
        showTranscript(card);
      });
      actions.append(transcript);
    }
    if (card.html_path) {
      const page = el("button", "action");
      page.type = "button";
      page.innerHTML = ACTIONS.page;
      page.setAttribute("aria-label", `Open page for ${card.title}`);
      page.addEventListener("click", (event) => {
        event.stopPropagation();
        showRichPage(card);
      });
      actions.append(page);
    }

    cardEl.append(identity, body, actions);
    return cardEl;
  }

  async function toggleAudio(card) {
    try {
      const current = await Pucky.request({ command: "player.state", args: {} });
      const same = current && samePath(current.path, card.audio_path);
      if (same && current.is_playing) {
        state.player = await Pucky.request({ command: "player.pause", args: {} });
      } else {
        const start = savedPositionFor(card.audio_path);
        state.activePath = card.audio_path;
        state.player = await Pucky.request({
          command: "player.play",
          args: { path: card.audio_path, title: card.title, start_at_ms: start }
        });
      }
      render();
    } catch (error) {
      showToast(error.message);
    }
  }

  function showTranscript(card) {
    const panel = document.getElementById("detail");
    const messages = messagesForCard(card);
    const content = el("div", "panel-scroll");
    content.append(el("h1", "chat-title", card.title || "Transcript"));
    for (const message of messages) {
      const bubble = el("div", `bubble ${message.role === "user" ? "user" : "assistant"}`);
      bubble.append(document.createTextNode(message.text || ""));
      if (message.time) {
        bubble.append(el("span", "bubble-meta", message.time));
      }
      content.append(bubble);
    }
    openRightPanel(panel, content);
  }

  async function showRichPage(card) {
    const panel = document.getElementById("detail");
    const content = el("div", "panel-scroll");
    try {
      const result = await Pucky.request({
        command: "artifact.read_base64",
        args: { path: card.html_path, max_bytes: 1024 * 1024 }
      });
      const iframe = el("iframe", "rich-frame");
      iframe.setAttribute("sandbox", "allow-scripts allow-forms allow-popups");
      iframe.srcdoc = atob(result.content_base64 || "");
      content.append(iframe);
    } catch (error) {
      content.append(el("h1", "chat-title", card.title || "Page"));
      content.append(el("p", "preview", `Page unavailable: ${error.message}`));
    }
    openRightPanel(panel, content);
  }

  function openRightPanel(panel, content) {
    const edge = el("div", "edge-swipe");
    panel.replaceChildren(content, edge);
    panel.setAttribute("aria-hidden", "false");
    panel.classList.add("is-open");
    installHorizontalDismiss(content, panel);
    installHorizontalDismiss(edge, panel);
  }

  function dismissDetail() {
    const panel = document.getElementById("detail");
    panel.style.transform = "";
    panel.classList.remove("is-open");
    panel.setAttribute("aria-hidden", "true");
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
      renderAudioSheet();
    });
    scrub.append(range);
    scrub.append(el("div", "time-row", `${formatTime(state.player.position_ms || 0)} / ${formatTime(state.player.duration_ms || 0)}`));
    wrap.append(scrub);

    const controls = el("div", "controls");
    controls.append(control("15", () => seekRelative(-15000)));
    controls.append(control(state.player.is_playing ? "||" : ">", () => toggleAudio(card)));
    controls.append(control("30", () => seekRelative(30000)));
    controls.append(control(`${state.player.speed || 1}x`, () => openSpeedPicker(card)));
    wrap.append(controls);
    installVerticalDismiss(wrap, sheet);
    sheet.replaceChildren(wrap);
  }

  function dismissAudioSheet() {
    const sheet = document.getElementById("audioSheet");
    sheet.style.transform = "";
    sheet.classList.remove("is-open");
    sheet.setAttribute("aria-hidden", "true");
    state.sheetCard = null;
  }

  function waveform(card, className, count) {
    const key = card.audio_path || card.session_id || card.title;
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
      if (card.audio_path) {
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
        state.speedByPath.set(card.audio_path, speed);
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
    render();
  }

  function control(label, action) {
    const button = el("button", "control", label);
    button.type = "button";
    button.addEventListener("click", action);
    return button;
  }

  function installHorizontalDismiss(target, panel) {
    installDrag(target, {
      axis: "x",
      apply: value => { panel.style.transform = `translateX(${Math.max(0, value)}px)`; },
      reset: () => { panel.style.transform = ""; },
      done: () => dismissDetail()
    });
  }

  function installVerticalDismiss(target, panel) {
    installDrag(target, {
      axis: "y",
      apply: value => { panel.style.transform = `translateY(${Math.max(0, value)}px)`; },
      reset: () => { panel.style.transform = ""; },
      done: () => dismissAudioSheet()
    });
  }

  function installDrag(target, config) {
    let startX = 0;
    let startY = 0;
    let dragging = false;
    const threshold = () => (config.axis === "x" ? window.innerWidth : window.innerHeight) * 0.22;
    const begin = (x, y) => {
      startX = x;
      startY = y;
      dragging = true;
    };
    const move = (x, y, event) => {
      if (!dragging) return;
      const dx = x - startX;
      const dy = y - startY;
      const primary = config.axis === "x" ? dx : dy;
      const cross = config.axis === "x" ? Math.abs(dy) : Math.abs(dx);
      if (primary > 8 && primary > cross) {
        if (event && event.cancelable) {
          event.preventDefault();
        }
        config.apply(primary);
        if (primary > threshold()) {
          dragging = false;
          config.done();
        }
      }
    };
    const finish = (x, y) => {
      if (!dragging) return;
      dragging = false;
      const delta = config.axis === "x" ? x - startX : y - startY;
      if (delta > threshold()) {
        config.done();
      } else {
        config.reset();
      }
    };
    target.addEventListener("pointerdown", event => {
      begin(event.clientX, event.clientY);
      if (target.setPointerCapture) {
        target.setPointerCapture(event.pointerId);
      }
    });
    target.addEventListener("pointermove", event => {
      move(event.clientX, event.clientY, event);
    });
    target.addEventListener("pointerup", event => {
      finish(event.clientX, event.clientY);
    });
    target.addEventListener("pointercancel", event => {
      finish(event.clientX, event.clientY);
    });
    target.addEventListener("touchstart", event => {
      if (event.touches.length) {
        begin(event.touches[0].clientX, event.touches[0].clientY);
      }
    }, { passive: true });
    target.addEventListener("touchmove", event => {
      if (event.touches.length) {
        move(event.touches[0].clientX, event.touches[0].clientY, event);
      }
    }, { passive: false });
    target.addEventListener("touchend", event => {
      const touch = event.changedTouches[0];
      finish(touch ? touch.clientX : startX, touch ? touch.clientY : startY);
    });
    target.addEventListener("touchcancel", event => {
      const touch = event.changedTouches[0];
      finish(touch ? touch.clientX : startX, touch ? touch.clientY : startY);
    });
  }

  function messagesForCard(card) {
    if (Array.isArray(card.transcript_messages) && card.transcript_messages.length) {
      return card.transcript_messages.map(item => ({
        role: item.role || "assistant",
        text: item.text || item.content || "",
        time: item.time || item.timestamp || ""
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

  function hasTranscript(card) {
    return Boolean(card.transcript || (Array.isArray(card.transcript_messages) && card.transcript_messages.length));
  }

  function isActiveCard(card) {
    return Boolean(card.audio_path
      && (samePath(state.activePath, card.audio_path) || samePath(state.player.path, card.audio_path)));
  }

  function samePath(left, right) {
    return Boolean(left && right && normalizePath(left) === normalizePath(right));
  }

  function normalizePath(path) {
    return String(path || "").replace(/^\/data\/user\/0\//, "/data/data/");
  }

  function savedPositionFor(path) {
    return state.savedPositions.get(normalizePath(path)) || 0;
  }

  function rememberPosition(path, position) {
    state.savedPositions.set(normalizePath(path), position);
  }

  function normalizeIcon(icon) {
    const value = String(icon || "").toLowerCase();
    return ICONS[value] ? value : "mail";
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
          rememberPosition(state.activePath, state.player.position_ms || 0);
        }
        render();
      } catch (_) {
        // Keep cached state visible if the bridge temporarily fails.
      }
    }
  }, 250);

  loadCards();
})();
