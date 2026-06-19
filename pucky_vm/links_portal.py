from __future__ import annotations

import base64
import hashlib
import hmac
import html
import json
import time
from urllib.parse import quote


LINKS_AUTH_SCHEME_LABELS = {
    "OAUTH2": "OAuth",
    "API_KEY": "API key",
    "BASIC": "Basic",
    "BEARER_TOKEN": "Token",
    "NO_AUTH": "No auth",
}


def _base64url_encode_bytes(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")


def _base64url_encode_json(payload: dict[str, object]) -> str:
    return _base64url_encode_bytes(json.dumps(payload, separators=(",", ":"), sort_keys=True).encode("utf-8"))


def _base64url_decode_text(value: str) -> bytes:
    token = str(value or "").strip()
    if not token:
        raise ValueError("empty token segment")
    padding = "=" * (-len(token) % 4)
    return base64.urlsafe_b64decode(token + padding)


def _encode_signed_token(header: dict[str, object], payload: dict[str, object], secret: str) -> str:
    encoded_header = _base64url_encode_json(header)
    encoded_payload = _base64url_encode_json(payload)
    signing_input = f"{encoded_header}.{encoded_payload}".encode("utf-8")
    signature = hmac.new(secret.encode("utf-8"), signing_input, hashlib.sha256).digest()
    return f"{encoded_header}.{encoded_payload}.{_base64url_encode_bytes(signature)}"


def _decode_signed_token(token: str, secret: str) -> dict[str, object] | None:
    if not token or not secret:
        return None
    parts = str(token).split(".")
    if len(parts) != 3:
        return None
    header_segment, payload_segment, signature_segment = parts
    signing_input = f"{header_segment}.{payload_segment}".encode("utf-8")
    expected = hmac.new(secret.encode("utf-8"), signing_input, hashlib.sha256).digest()
    try:
        provided = _base64url_decode_text(signature_segment)
        payload = json.loads(_base64url_decode_text(payload_segment).decode("utf-8"))
    except Exception:
        return None
    if not hmac.compare_digest(expected, provided):
        return None
    if not isinstance(payload, dict):
        return None
    try:
        if int(payload.get("exp") or 0) < int(time.time()):
            return None
    except Exception:
        return None
    return payload


def _links_auth_label(managed_auth_schemes: list[str] | None, auth_schemes: list[str] | None) -> str:
    labels: list[str] = []
    seen: set[str] = set()
    for source in (list(managed_auth_schemes or []), list(auth_schemes or [])):
        for raw in source:
            key = str(raw or "").strip().upper()
            if not key or key in seen:
                continue
            label = LINKS_AUTH_SCHEME_LABELS.get(key)
            if not label:
                continue
            seen.add(key)
            labels.append(label)
    return " + ".join(labels)


def _links_portal_document(*, token: str, auth_mode: str, back_url: str, just_connected: str = "") -> str:
    token_q = quote(token, safe="")
    back_q = html.escape(back_url, quote=True)
    connected_label = html.escape(just_connected, quote=True)
    initial_mode = "browser" if auth_mode == "browser" else "webview"
    return f"""<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
    <title>Pucky Links</title>
    <style>
      :root {{
        color-scheme: dark;
        --bg: #070d14;
        --panel: #0f1722;
        --panel-2: #101b29;
        --line: rgba(245, 249, 255, 0.09);
        --text: #f5f9ff;
        --muted: #90a4bb;
        --accent: #76c6ff;
      }}
      * {{ box-sizing: border-box; }}
      body {{
        margin: 0;
        min-height: 100vh;
        background: var(--bg);
        color: var(--text);
        font-family: Inter, Segoe UI, Arial, sans-serif;
      }}
      .shell {{
        min-height: 100vh;
        padding: 14px 14px 18px;
        display: flex;
        flex-direction: column;
        gap: 10px;
      }}
      .topbar,
      .msg,
      .section,
      .search-wrap {{
        border: 1px solid var(--line);
        border-radius: 16px;
        background: var(--panel);
      }}
      .topbar {{
        padding: 12px;
        display: grid;
        grid-template-columns: 34px minmax(0, 1fr);
        gap: 10px;
        align-items: start;
      }}
      .back {{
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 34px;
        height: 34px;
        border-radius: 11px;
        border: 1px solid var(--line);
        text-decoration: none;
        color: var(--text);
        background: var(--panel-2);
      }}
      h1 {{
        margin: 0;
        font-size: 21px;
        line-height: 1;
        font-weight: 850;
      }}
      .subtle {{
        margin: 5px 0 0;
        color: var(--muted);
        font-size: 12px;
        line-height: 1.35;
      }}
      .msg {{
        display: none;
        padding: 9px 11px;
        font-size: 12px;
        line-height: 1.35;
      }}
      .msg.show {{ display: block; }}
      .msg.ok {{ border-color: rgba(80, 216, 106, 0.32); color: #d8ffe1; }}
      .msg.error {{ border-color: rgba(255, 111, 111, 0.35); color: #ffd7d7; }}
      .search-wrap {{
        padding: 0 12px;
      }}
      .search {{
        width: 100%;
        min-height: 40px;
        border: 0;
        outline: none;
        background: transparent;
        color: var(--text);
        font-size: 14px;
      }}
      .search::placeholder {{ color: var(--muted); }}
      .section {{
        padding: 10px 11px;
      }}
      .section-head {{
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        gap: 8px;
        margin-bottom: 8px;
      }}
      .section-label {{
        font-size: 11px;
        font-weight: 800;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        color: var(--muted);
      }}
      .count {{
        color: var(--muted);
        font-size: 11px;
      }}
      .connected-strip {{
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
      }}
      .connected-chip {{
        min-height: 28px;
        padding: 0 10px;
        border-radius: 999px;
        border: 1px solid var(--line);
        background: var(--panel-2);
        display: inline-flex;
        align-items: center;
        gap: 6px;
        font-size: 12px;
        white-space: nowrap;
      }}
      .mark::before {{
        content: '\\2713';
        color: var(--accent);
        font-weight: 800;
      }}
      .list {{
        display: flex;
        flex-direction: column;
      }}
      .app-row {{
        width: 100%;
        border: 0;
        border-top: 1px solid rgba(245, 249, 255, 0.06);
        background: transparent;
        color: var(--text);
        min-height: 44px;
        padding: 0;
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto;
        gap: 8px;
        align-items: center;
        text-align: left;
        cursor: pointer;
      }}
      .app-row:first-child {{ border-top: 0; }}
      .app-row:disabled {{
        opacity: 0.7;
        cursor: progress;
      }}
      .app-name {{
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font-size: 14px;
        font-weight: 700;
      }}
      .status-mark {{
        min-width: 18px;
        text-align: right;
      }}
      .status-mark.mark::before {{
        content: '\\2713';
        color: var(--accent);
        font-weight: 800;
      }}
      .empty {{
        padding: 10px 0 4px;
        color: var(--muted);
        font-size: 12px;
        line-height: 1.4;
      }}
      .hide {{ display: none !important; }}
    </style>
  </head>
  <body>
    <main class="shell">
      <header class="topbar">
        <a class="back" href="{back_q}" aria-label="Back to Pucky">&lt;</a>
        <div>
          <h1>Links</h1>
          <p class="subtle">Quick search. Tap an app name to jump into the Composio connect flow.</p>
        </div>
      </header>
      <div id="portal-msg" class="msg" aria-live="polite"></div>
      <section id="connected-section" class="section hide">
        <div class="section-head">
          <span class="section-label">Connected</span>
        </div>
        <div id="connected-strip" class="connected-strip"></div>
      </section>
      <label class="search-wrap" for="search">
        <input id="search" class="search" type="search" placeholder="Search apps" autocomplete="off" spellcheck="false">
      </label>
      <section class="section">
        <div class="section-head">
          <span class="section-label">All Apps</span>
          <span id="count" class="count"></span>
        </div>
        <div id="app-list" class="list">
          <div class="empty">Loading apps...</div>
        </div>
      </section>
    </main>
    <script>
      const token = '{token_q}';
      const initialAuthMode = '{initial_mode}';
      const justConnected = '{connected_label}';
      const pending = new Map();
      let seq = 0;
      let authMode = initialAuthMode === 'browser' ? 'browser' : 'webview';
      let allApps = [];
      let connectedApps = [];
      let connectedSlugs = new Set();
      let lastRefreshAt = 0;

      const msg = document.getElementById('portal-msg');
      const connectedSection = document.getElementById('connected-section');
      const connectedStrip = document.getElementById('connected-strip');
      const searchInput = document.getElementById('search');
      const appList = document.getElementById('app-list');
      const count = document.getElementById('count');

      window.Pucky = window.Pucky || {{}};
      if (typeof window.Pucky.request !== 'function') {{
        window.Pucky.request = function request(payload) {{
          const command = payload && payload.command;
          const args = payload && payload.args ? payload.args : {{}};
          if (window.PuckyAndroid && typeof window.PuckyAndroid.postMessage === 'function') {{
            const id = String(++seq);
            const message = JSON.stringify({{ id, command, args }});
            return new Promise((resolve, reject) => {{
              pending.set(id, {{ resolve, reject }});
              window.PuckyAndroid.postMessage(message);
              setTimeout(() => {{
                if (pending.has(id)) {{
                  pending.delete(id);
                  reject(new Error('Pucky native bridge timed out'));
                }}
              }}, 15000);
            }});
          }}
          if (command === 'browser.open') {{
            const url = String(args.url || '').trim();
            if (!url) throw new Error('browser.open requires url');
            try {{
              window.open(url, '_blank', 'noopener,noreferrer');
            }} catch (_err) {{
              window.location.assign(url);
            }}
            return Promise.resolve({{ launched: true, uri: url }});
          }}
          return Promise.reject(new Error('Pucky bridge unavailable'));
        }};
      }}
      if (typeof window.Pucky.__resolve !== 'function') {{
        window.Pucky.__resolve = function resolve(id, payload) {{
          const slot = pending.get(String(id));
          if (!slot) return;
          pending.delete(String(id));
          if (payload && payload.ok) slot.resolve(payload.result || {{}});
          else slot.reject(new Error((payload && payload.error) || 'Native command failed'));
        }};
      }}

      function showMessage(text, kind) {{
        msg.className = 'msg show ' + (kind || '');
        msg.textContent = String(text || '');
      }}

      function hideMessage() {{
        msg.className = 'msg';
        msg.textContent = '';
      }}

      function escapeHtml(value) {{
        return String(value || '')
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;')
          .replace(/'/g, '&#39;');
      }}

      function buildConnectHref(slug) {{
        return '/links/connect/apps?token=' + token + '&app=' + encodeURIComponent(slug) + '&auth_mode=' + encodeURIComponent(authMode);
      }}

      async function apiJson(url, options) {{
        const response = await fetch(url, options || {{ cache: 'no-store' }});
        const payload = await response.json().catch(() => ({{}}));
        if (!response.ok || payload.ok === false) {{
          throw new Error(String((payload && (payload.error || payload.detail || payload.message)) || 'Request failed'));
        }}
        return payload;
      }}

      function renderConnected() {{
        if (!connectedApps.length) {{
          connectedSection.classList.add('hide');
          connectedStrip.innerHTML = '';
          return;
        }}
        connectedSection.classList.remove('hide');
        connectedStrip.innerHTML = connectedApps
          .map(app => "<span class='connected-chip'><span class='mark'></span><span>" + escapeHtml(app.name || app.slug) + "</span></span>")
          .join('');
      }}

      function renderList(query) {{
        const needle = String(query || '').trim().toLowerCase();
        const filtered = needle
          ? allApps.filter(app => String(app.name || '').toLowerCase().includes(needle) || String(app.slug || '').toLowerCase().includes(needle))
          : allApps;
        count.textContent = filtered.length ? String(filtered.length) : '';
        if (!filtered.length) {{
          appList.innerHTML = "<div class='empty'>No apps match your search.</div>";
          return;
        }}
        appList.innerHTML = filtered.map(app => {{
          const active = connectedSlugs.has(String(app.slug || ''));
          return "<button class='app-row' type='button' data-slug='" + escapeHtml(app.slug || '') + "'>" +
            "<span class='app-name'>" + escapeHtml(app.name || app.slug || '') + "</span>" +
            "<span class='status-mark" + (active ? " mark" : "") + "'></span>" +
          "</button>";
        }}).join('');
      }}

      async function loadConnected() {{
        const payload = await apiJson('/api/links/composio/my-apps?token=' + encodeURIComponent(token));
        const list = Array.isArray(payload.apps) ? payload.apps : [];
        const active = [];
        const seen = new Set();
        for (const item of list) {{
          const slug = String(item.slug || '').trim();
          const counts = item && typeof item.counts === 'object' ? item.counts : {{}};
          if (!slug || seen.has(slug) || Number(counts.active || 0) <= 0) continue;
          seen.add(slug);
          active.push({{ slug, name: item.name || slug }});
        }}
        connectedApps = active.sort((a, b) => String(a.name || a.slug).localeCompare(String(b.name || b.slug)));
        connectedSlugs = new Set(connectedApps.map(app => app.slug));
        renderConnected();
        renderList(searchInput.value || '');
        lastRefreshAt = Date.now();
      }}

      async function loadAllApps() {{
        const found = [];
        let offset = 0;
        let hasMore = true;
        let pages = 0;
        while (hasMore && pages < 30) {{
          const payload = await apiJson('/api/links/composio/all-apps?token=' + encodeURIComponent(token) + '&offset=' + offset + '&limit=100');
          const list = Array.isArray(payload.apps) ? payload.apps : [];
          if (!list.length) break;
          found.push(...list.map(item => ({{
            slug: String(item.slug || '').trim(),
            name: String(item.name || item.slug || '').trim(),
          }})).filter(item => item.slug && item.name));
          offset += list.length;
          hasMore = !!payload.has_more;
          pages += 1;
        }}
        allApps = found.sort((a, b) => a.name.localeCompare(b.name));
        renderList(searchInput.value || '');
      }}

      async function connectApp(slug, button) {{
        if (!slug) return;
        const href = buildConnectHref(slug);
        if (authMode === 'browser') {{
          const externalUrl = new URL(href, window.location.href).toString();
          if (window.Pucky && typeof window.Pucky.request === 'function') {{
            try {{
              await window.Pucky.request({{ command: 'browser.open', args: {{ url: externalUrl }} }});
              showMessage('Opened ' + slug + ' in the browser. Come back here when you are done.', 'ok');
              return;
            }} catch (error) {{
              const detail = String(error && error.message ? error.message : error || '');
              if (!/browser\\.open/i.test(detail)) {{
                throw error;
              }}
            }}
          }}
          window.location.assign(href);
          return;
        }}
        window.location.assign(href);
      }}

      async function refreshConnectedSoon() {{
        const age = Date.now() - lastRefreshAt;
        if (age < 1200) return;
        try {{
          await loadConnected();
        }} catch (_err) {{}}
      }}

      document.body.addEventListener('click', async event => {{
        const row = event.target.closest('.app-row');
        if (!row) return;
        const slug = row.getAttribute('data-slug');
        if (!slug) return;
        hideMessage();
        row.disabled = true;
        try {{
          await connectApp(slug, row);
        }} catch (error) {{
          showMessage(error.message || 'Could not open auth flow', 'error');
        }} finally {{
          row.disabled = false;
        }}
      }});

      searchInput.addEventListener('input', () => {{
        renderList(searchInput.value || '');
      }});

      document.addEventListener('visibilitychange', () => {{
        if (!document.hidden) {{
          window.setTimeout(() => {{
            refreshConnectedSoon();
          }}, 280);
        }}
      }});

      window.addEventListener('focus', () => {{
        window.setTimeout(() => {{
          refreshConnectedSoon();
        }}, 280);
      }});

      async function boot() {{
        if (justConnected) {{
          showMessage('Connected ' + justConnected + '. Refreshing your list...', 'ok');
        }}
        await Promise.all([loadConnected(), loadAllApps()]);
      }}

      boot().catch(error => {{
        showMessage(error.message || 'Failed loading apps', 'error');
        appList.innerHTML = "<div class='empty'>Connections are temporarily unavailable.</div>";
      }});
    </script>
  </body>
</html>"""
