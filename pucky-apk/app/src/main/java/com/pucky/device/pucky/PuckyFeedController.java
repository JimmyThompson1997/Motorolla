package com.pucky.device.pucky;

import android.content.Context;
import android.content.SharedPreferences;
import android.util.Log;

import com.pucky.device.command.CommandErrorCodes;
import com.pucky.device.command.CommandException;
import com.pucky.device.net.Ipv4FirstDns;
import com.pucky.device.state.PuckyState;
import com.pucky.device.storage.SettingsStore;
import com.pucky.device.ui.ReplyCardStore;
import com.pucky.device.util.Json;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.UUID;

import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;

public final class PuckyFeedController {
    private static final String TAG = "PuckyFeedController";
    private static final String PREFS = "pucky_feed";
    private static final String KEY_CURSOR = "last_cursor";
    private static final MediaType JSON_MEDIA_TYPE = MediaType.get("application/json; charset=utf-8");
    private static PuckyFeedController shared;

    private final Context context;
    private final SettingsStore settings;
    private final ReplyCardStore replyCards;
    private final SharedPreferences prefs;
    private final OkHttpClient http = new OkHttpClient.Builder().dns(Ipv4FirstDns.INSTANCE).build();

    public static synchronized PuckyFeedController shared(Context context) {
        if (shared == null) {
            shared = new PuckyFeedController(context.getApplicationContext());
        }
        return shared;
    }

    private PuckyFeedController(Context context) {
        this.context = context.getApplicationContext();
        this.settings = new SettingsStore(this.context);
        this.replyCards = new ReplyCardStore(this.context);
        this.prefs = this.context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    public JSONObject snapshot() {
        return replyCards.snapshot();
    }

    public JSONObject sync(JSONObject args) throws CommandException {
        return syncInternal(args.optString("reason", "manual"), args.optInt("limit", 20), true);
    }

    public void syncAsync(String reason) {
        Thread worker = new Thread(() -> {
            try {
                syncInternal(reason, 20, true);
            } catch (Exception exc) {
                Log.d(TAG, "feed sync skipped: " + exc.getMessage());
            }
        }, "PuckyFeedSync");
        worker.setDaemon(true);
        worker.start();
    }

    public JSONObject action(JSONObject args) throws CommandException {
        String cardId = args.optString("card_id", "").trim();
        String sessionId = args.optString("session_id", "").trim();
        String action = args.optString("action", "").trim();
        String clientActionId = args.optString("client_action_id", "").trim();
        if (action.isEmpty()) {
            throw new CommandException(CommandErrorCodes.MALFORMED_COMMAND, "pucky.feed.action requires action");
        }
        if (clientActionId.isEmpty()) {
            clientActionId = "feed_action_" + UUID.randomUUID().toString().replace("-", "");
        }
        JSONObject resolved = replyCards.find(cardId, sessionId);
        JSONObject existing = resolved.optJSONObject("card");
        if (existing == null) {
            throw new CommandException(CommandErrorCodes.MALFORMED_COMMAND, "feed card not found");
        }
        String resolvedCardId = existing.optString("card_id", cardId).trim();
        if (resolvedCardId.isEmpty()) {
            throw new CommandException(CommandErrorCodes.MALFORMED_COMMAND, "feed card is missing card_id");
        }
        if (!isConfigured()) {
            throw new CommandException(CommandErrorCodes.EXECUTION_FAILED, "feed sync is not configured");
        }
        JSONObject payload = new JSONObject();
        Json.put(payload, "client_action_id", clientActionId);
        Json.put(payload, "card_id", resolvedCardId);
        Json.put(payload, "action", action);
        Request request = new Request.Builder()
                .url(feedActionUrl())
                .header("Authorization", "Bearer " + settings.getPuckyTurnAuthToken())
                .post(RequestBody.create(payload.toString(), JSON_MEDIA_TYPE))
                .build();
        try (Response response = http.newCall(request).execute()) {
            if (!response.isSuccessful() || response.body() == null) {
                throw new CommandException(CommandErrorCodes.EXECUTION_FAILED,
                        "feed action failed with http_" + response.code());
            }
            JSONObject body = new JSONObject(response.body().string());
            JSONObject item = body.optJSONObject("item");
            if (item == null) {
                throw new CommandException(CommandErrorCodes.EXECUTION_FAILED, "feed action missing item");
            }
            JSONObject local = cacheRemoteItem(PuckyTurnResponse.fromJson(item), false);
            emitFeedUpdated();
            JSONObject out = new JSONObject();
            Json.put(out, "schema", "pucky.feed_action_result.v1");
            Json.put(out, "ok", true);
            Json.put(out, "action", action);
            Json.put(out, "client_action_id", clientActionId);
            Json.put(out, "card", local);
            Json.put(out, "snapshot", replyCards.snapshot());
            return out;
        } catch (CommandException exc) {
            throw exc;
        } catch (Exception exc) {
            throw new CommandException(CommandErrorCodes.EXECUTION_FAILED,
                    "Unable to apply feed action: " + exc.getMessage());
        }
    }

    public JSONObject upsertTurnResponse(String fallbackSessionId, PuckyTurnResponse response) throws Exception {
        JSONObject card = cacheRemoteItem(response, false);
        emitFeedUpdated();
        return card;
    }

    private JSONObject syncInternal(String reason, int limit, boolean emitUpdate) throws CommandException {
        JSONObject before = replyCards.snapshot();
        if (!isConfigured()) {
            JSONObject out = new JSONObject();
            Json.put(out, "schema", "pucky.feed_sync_result.v1");
            Json.put(out, "configured", false);
            Json.put(out, "reason", reason);
            Json.put(out, "snapshot", before);
            return out;
        }
        String cursor = prefs.getString(KEY_CURSOR, "");
        String nextCursor = cursor;
        boolean hasMore = false;
        int merged = 0;
        int pages = 0;
        do {
            JSONObject page;
            try {
                page = fetchPage(nextCursor, limit);
            } catch (CommandException exc) {
                throw exc;
            } catch (Exception exc) {
                throw new CommandException(CommandErrorCodes.EXECUTION_FAILED,
                        "Unable to sync feed: " + exc.getMessage());
            }
            JSONArray items = page.optJSONArray("items");
            if (items != null) {
                for (int i = 0; i < items.length(); i++) {
                    JSONObject item = items.optJSONObject(i);
                    if (item == null) {
                        continue;
                    }
                    try {
                        JSONObject local = cacheRemoteItem(PuckyTurnResponse.fromJson(item), false);
                        PuckyTurnController.shared(context).onReplyRecovered(local, "feed_sync");
                        merged++;
                    } catch (Exception exc) {
                        Log.d(TAG, "feed item skipped: " + exc.getMessage());
                    }
                }
            }
            String candidate = page.optString("next_cursor", nextCursor);
            hasMore = page.optBoolean("has_more", false);
            if (candidate.isEmpty() || candidate.equals(nextCursor)) {
                hasMore = false;
            } else {
                nextCursor = candidate;
            }
            pages++;
        } while (hasMore && pages < 5);
        prefs.edit().putString(KEY_CURSOR, nextCursor).apply();
        JSONObject snapshot = replyCards.snapshot();
        if (emitUpdate && merged > 0) {
            emitFeedUpdated();
        }
        JSONObject out = new JSONObject();
        Json.put(out, "schema", "pucky.feed_sync_result.v1");
        Json.put(out, "configured", true);
        Json.put(out, "reason", reason);
        Json.put(out, "merged", merged);
        Json.put(out, "cursor", nextCursor);
        Json.put(out, "snapshot", snapshot);
        return out;
    }

    private JSONObject fetchPage(String cursor, int limit) throws Exception {
        String url = feedUrl() + "?cursor=" + URLEncoder.encode(cursor == null ? "" : cursor, "UTF-8")
                + "&limit=" + Math.max(1, Math.min(100, limit));
        Request request = new Request.Builder()
                .url(url)
                .header("Authorization", "Bearer " + settings.getPuckyTurnAuthToken())
                .get()
                .build();
        try (Response response = http.newCall(request).execute()) {
            if (!response.isSuccessful() || response.body() == null) {
                throw new IOException("feed sync http_" + response.code());
            }
            return new JSONObject(response.body().string());
        }
    }

    private JSONObject cacheRemoteItem(PuckyTurnResponse response, boolean prepend) throws Exception {
        JSONObject card = localCardFromResponse(response);
        replyCards.upsert(card);
        JSONObject lookup = replyCards.find(response.cardId(), response.sessionId());
        JSONObject found = lookup.optJSONObject("card");
        return found == null ? card : found;
    }

    private JSONObject localCardFromResponse(PuckyTurnResponse response) throws Exception {
        String sessionId = safeName(response.sessionId().isEmpty() ? response.turnId() : response.sessionId());
        String directoryName = safeName(response.cardId().isEmpty() ? sessionId : response.cardId());
        File dir = new File(context.getFilesDir(), "pucky_replies" + File.separator + directoryName);
        if (!dir.exists() && !dir.mkdirs()) {
            throw new IOException("Unable to create reply directory");
        }
        String audioPath = "";
        if (response.hasAudio()) {
            File audio = new File(dir, "reply" + audioExtension(response.audioMimeType()));
            write(audio, response.audioBytes());
            audioPath = audio.getAbsolutePath();
        }
        String htmlPath = "";
        if (response.hasHtml()) {
            File html = new File(dir, "reply.html");
            write(html, response.htmlBytes());
            htmlPath = html.getAbsolutePath();
        }
        JSONObject card = new JSONObject();
        Json.put(card, "card_id", response.cardId());
        Json.put(card, "turn_id", response.turnId());
        Json.put(card, "session_id", sessionId);
        Json.put(card, "title", response.cardTitle());
        Json.put(card, "summary", response.summary().isEmpty() ? response.text() : response.summary());
        Json.put(card, "transcript", response.text());
        JSONArray transcriptMessages = new JSONArray();
        JSONObject assistant = new JSONObject();
        Json.put(assistant, "role", "assistant");
        Json.put(assistant, "text", response.text());
        Json.put(assistant, "created_at", response.createdAt());
        Json.add(transcriptMessages, assistant);
        Json.put(card, "transcript_messages", transcriptMessages);
        Json.put(card, "created_at", response.createdAt());
        Json.put(card, "updated_at", response.updatedAt());
        Json.put(card, "icon", response.cardIcon());
        Json.put(card, "origin", response.origin());
        Json.put(card, "archived", response.archived());
        Json.put(card, "read", response.read());
        Json.put(card, "deleted", response.deleted());
        if (!audioPath.isEmpty()) {
            Json.put(card, "audio_path", audioPath);
        }
        if (!htmlPath.isEmpty()) {
            Json.put(card, "html_path", htmlPath);
        }
        return card;
    }

    private void emitFeedUpdated() {
        PuckyState.get().setLifecycleEvent("pucky.feed.updated");
        PuckyState.get().broadcast(context);
    }

    private boolean isConfigured() {
        return !settings.getPuckyTurnUrl().isEmpty() && !settings.getPuckyTurnAuthToken().isEmpty();
    }

    private String feedUrl() {
        return baseUrl("/api/feed");
    }

    private String feedActionUrl() {
        return baseUrl("/api/feed/actions");
    }

    private String baseUrl(String replacementPath) {
        String raw = settings.getPuckyTurnUrl();
        int queryIndex = raw.indexOf('?');
        String base = queryIndex >= 0 ? raw.substring(0, queryIndex) : raw;
        if (base.endsWith("/api/turn")) {
            return base.substring(0, base.length() - "/api/turn".length()) + replacementPath;
        }
        if (base.endsWith("/turn")) {
            return base.substring(0, base.length() - "/turn".length()) + replacementPath;
        }
        return base.replaceAll("/+$", "") + replacementPath;
    }

    private static String safeName(String raw) {
        return String.valueOf(raw == null ? "" : raw).replaceAll("[^A-Za-z0-9._-]+", "_");
    }

    private static void write(File target, byte[] bytes) throws IOException {
        try (FileOutputStream output = new FileOutputStream(target, false)) {
            output.write(bytes);
        }
    }

    private static String audioExtension(String mimeType) {
        String lower = String.valueOf(mimeType).toLowerCase();
        if (lower.contains("mpeg") || lower.contains("mp3")) {
            return ".mp3";
        }
        if (lower.contains("ogg")) {
            return ".ogg";
        }
        return ".wav";
    }
}
