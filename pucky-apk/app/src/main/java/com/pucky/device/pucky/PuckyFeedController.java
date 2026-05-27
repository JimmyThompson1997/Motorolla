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
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
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
    private static final String PENDING_PLACEHOLDER = "Sending your message...";
    private static final MediaType JSON_MEDIA_TYPE = MediaType.get("application/json; charset=utf-8");
    private static PuckyFeedController shared;

    private final Context context;
    private final SettingsStore settings;
    private final ReplyCardStore replyCards;
    private final PuckyTurnController turnController;
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
        this.turnController = PuckyTurnController.shared(this.context);
        this.prefs = this.context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    public JSONObject snapshot() {
        return mergedSnapshot();
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
        JSONObject snapshot = mergedSnapshot();
        JSONObject existing = findSnapshotCard(snapshot, cardId, sessionId);
        if (existing == null) {
            throw new CommandException(CommandErrorCodes.MALFORMED_COMMAND, "feed card not found");
        }
        String resolvedCardId = existing.optString("card_id", cardId).trim();
        if (resolvedCardId.isEmpty() && !existing.optBoolean("pending_outbound", false)) {
            throw new CommandException(CommandErrorCodes.MALFORMED_COMMAND, "feed card is missing card_id");
        }
        if (existing.optBoolean("pending_outbound", false)) {
            if (!"archive".equals(action)) {
                throw new CommandException(CommandErrorCodes.MALFORMED_COMMAND,
                        "pending outbound cards only support archive");
            }
            boolean archived = turnController.archiveHistoryRecord(
                    existing.optString("turn_id", ""),
                    existing.optString("local_session_id", existing.optString("session_id", "")));
            if (!archived) {
                throw new CommandException(CommandErrorCodes.EXECUTION_FAILED, "pending outbound card not found");
            }
            emitFeedUpdated();
            JSONObject after = mergedSnapshot();
            JSONObject archivedCard = findSnapshotCard(after, resolvedCardId, sessionId);
            JSONObject out = new JSONObject();
            Json.put(out, "schema", "pucky.feed_action_result.v1");
            Json.put(out, "ok", true);
            Json.put(out, "action", action);
            Json.put(out, "client_action_id", clientActionId);
            Json.put(out, "card", archivedCard == null ? existing : archivedCard);
            Json.put(out, "snapshot", after);
            return out;
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
            Json.put(out, "snapshot", mergedSnapshot());
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
        JSONObject before = mergedSnapshot();
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
        JSONObject snapshot = mergedSnapshot();
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

    private JSONObject mergedSnapshot() {
        JSONObject persisted = replyCards.snapshot();
        JSONArray persistedCards = persisted.optJSONArray("cards");
        JSONArray pendingCards = synthesizePendingCards(persistedCards);
        List<JSONObject> merged = new ArrayList<>();
        appendSnapshotCards(merged, persistedCards);
        appendSnapshotCards(merged, pendingCards);
        merged.sort(Comparator
                .comparingLong(PuckyFeedController::snapshotSortTimestamp)
                .reversed()
                .thenComparing(card -> card.optString("summary", ""), String.CASE_INSENSITIVE_ORDER));
        JSONArray visible = new JSONArray();
        int count = 0;
        for (JSONObject card : merged) {
            if (card == null || card.optBoolean("deleted", false)) {
                continue;
            }
            Json.add(visible, card);
            count++;
        }
        JSONObject out = new JSONObject();
        Json.put(out, "schema", "pucky.reply_cards.v1");
        Json.put(out, "count", count);
        Json.put(out, "cards", visible);
        return out;
    }

    private JSONArray synthesizePendingCards(JSONArray persistedCards) {
        JSONArray history = turnController.historySnapshotArray();
        JSONArray cards = new JSONArray();
        for (int index = 0; index < history.length(); index++) {
            JSONObject record = history.optJSONObject(index);
            if (record == null) {
                continue;
            }
            String state = record.optString("latest_state", "").trim();
            if (!shouldSynthesizePendingCard(state)) {
                continue;
            }
            if (hasMatchingReplyCard(persistedCards, record)) {
                continue;
            }
            String turnId = record.optString("turn_id", "").trim();
            String localSessionId = record.optString("local_session_id", "").trim();
            String sessionId = localSessionId.isEmpty() ? turnId : localSessionId;
            if (turnId.isEmpty() && sessionId.isEmpty()) {
                continue;
            }
            String transcript = record.optString("user_transcript", "").trim();
            boolean failed = isFailedPendingState(state);
            boolean placeholder = transcript.isEmpty();
            JSONObject card = new JSONObject();
            String pendingId = "pending_turn_" + (turnId.isEmpty() ? sessionId : turnId);
            Json.put(card, "card_id", pendingId);
            Json.put(card, "turn_id", turnId);
            Json.put(card, "local_session_id", localSessionId);
            Json.put(card, "session_id", sessionId);
            Json.put(card, "title", "Sent message");
            Json.put(card, "summary", placeholder ? PENDING_PLACEHOLDER : transcript);
            Json.put(card, "transcript", transcript);
            Json.put(card, "created_at", record.optString("created_at", record.optString("updated_at", Instant.now().toString())));
            Json.put(card, "updated_at", record.optString("updated_at", record.optString("created_at", Instant.now().toString())));
            Json.put(card, "archived", record.optBoolean("archived", false));
            Json.put(card, "read", true);
            Json.put(card, "deleted", false);
            Json.put(card, "pending_outbound", true);
            Json.put(card, "pending_state", state);
            Json.put(card, "pending_label", pendingLabelFor(state, placeholder));
            Json.put(card, "pending_error", record.optString("error", ""));
            Json.put(card, "pending_placeholder", placeholder);
            Json.add(cards, card);
        }
        return cards;
    }

    private static void appendSnapshotCards(List<JSONObject> target, JSONArray cards) {
        if (cards == null) {
            return;
        }
        for (int index = 0; index < cards.length(); index++) {
            JSONObject card = cards.optJSONObject(index);
            if (card != null) {
                target.add(card);
            }
        }
    }

    private static JSONObject findSnapshotCard(JSONObject snapshot, String cardId, String sessionId) {
        JSONArray cards = snapshot == null ? null : snapshot.optJSONArray("cards");
        String cleanCardId = safe(cardId);
        String cleanSessionId = safe(sessionId);
        if (cards == null) {
            return null;
        }
        for (int index = 0; index < cards.length(); index++) {
            JSONObject card = cards.optJSONObject(index);
            if (card == null) {
                continue;
            }
            String existingCardId = safe(card.optString("card_id", ""));
            String existingSessionId = safe(card.optString("session_id", ""));
            if (!cleanCardId.isEmpty() && cleanCardId.equals(existingCardId)) {
                return card;
            }
            if (!cleanSessionId.isEmpty() && cleanSessionId.equals(existingSessionId)) {
                return card;
            }
        }
        return null;
    }

    private static boolean hasMatchingReplyCard(JSONArray persistedCards, JSONObject record) {
        if (persistedCards == null || record == null) {
            return false;
        }
        String turnId = safe(record.optString("turn_id", ""));
        String sessionId = safe(record.optString("local_session_id", record.optString("session_id", "")));
        for (int index = 0; index < persistedCards.length(); index++) {
            JSONObject card = persistedCards.optJSONObject(index);
            if (card == null || card.optBoolean("deleted", false)) {
                continue;
            }
            if (!turnId.isEmpty() && turnId.equals(safe(card.optString("turn_id", "")))) {
                return true;
            }
            if (!sessionId.isEmpty() && sessionId.equals(safe(card.optString("session_id", "")))) {
                return true;
            }
        }
        return false;
    }

    private static boolean shouldSynthesizePendingCard(String state) {
        return "uploading".equals(state)
                || "upload_received".equals(state)
                || "stt_running".equals(state)
                || "codex_running".equals(state)
                || "tts_running".equals(state)
                || "failed".equals(state)
                || "upload_blocked".equals(state);
    }

    private static boolean isFailedPendingState(String state) {
        return "failed".equals(state) || "upload_blocked".equals(state);
    }

    private static String pendingLabelFor(String state, boolean placeholder) {
        if (isFailedPendingState(state)) {
            return "Failed";
        }
        if (!placeholder && ("codex_running".equals(state) || "tts_running".equals(state))) {
            return "Thinking";
        }
        return "Sending";
    }

    private static long snapshotSortTimestamp(JSONObject card) {
        return parseIso(card == null ? "" : card.optString("updated_at", ""),
                parseIso(card == null ? "" : card.optString("created_at", ""), 0L));
    }

    private static long parseIso(String value, long fallback) {
        String clean = safe(value);
        if (clean.isEmpty()) {
            return fallback;
        }
        try {
            return java.time.Instant.parse(clean).toEpochMilli();
        } catch (Exception ignored) {
            return fallback;
        }
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
        JSONArray transcriptMessages = localizeTranscriptMessages(response.transcriptMessages(), dir);
        if (transcriptMessages.length() == 0) {
            JSONObject assistant = new JSONObject();
            Json.put(assistant, "role", "assistant");
            Json.put(assistant, "text", response.text());
            Json.put(assistant, "created_at", response.createdAt());
            Json.add(transcriptMessages, assistant);
        }
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

    private JSONArray localizeTranscriptMessages(JSONArray input, File dir) throws Exception {
        JSONArray localized = new JSONArray();
        if (input == null) {
            return localized;
        }
        for (int index = 0; index < input.length(); index++) {
            JSONObject message = input.optJSONObject(index);
            if (message == null) {
                continue;
            }
            JSONObject copy = new JSONObject(message.toString());
            JSONArray attachments = localizeAttachments(copy.optJSONArray("attachments"), dir, "message_" + (index + 1));
            if (attachments.length() > 0) {
                Json.put(copy, "attachments", attachments);
            } else {
                copy.remove("attachments");
            }
            localized.put(copy);
        }
        return localized;
    }

    private JSONArray localizeAttachments(JSONArray input, File dir, String prefix) throws Exception {
        JSONArray localized = new JSONArray();
        if (input == null) {
            return localized;
        }
        for (int index = 0; index < input.length(); index++) {
            JSONObject attachment = input.optJSONObject(index);
            if (attachment == null) {
                continue;
            }
            JSONObject localizedAttachment = localizeAttachment(attachment, dir, prefix + "_attachment_" + (index + 1));
            if (localizedAttachment != null) {
                localized.put(localizedAttachment);
            }
        }
        return localized;
    }

    private JSONObject localizeAttachment(JSONObject attachment, File dir, String filenameBase) throws Exception {
        JSONObject copy = new JSONObject(attachment.toString());
        localizeArtifactField(copy, "artifact", "path", dir, filenameBase);
        localizeArtifactField(copy, "viewer_artifact", "viewer_path", dir, filenameBase + "_viewer");
        localizeArtifactField(copy, "html_artifact", "html_viewer_path", dir, filenameBase + "_html");
        localizeArtifactField(copy, "document_html_artifact", "document_html_path", dir, filenameBase + "_document");
        localizeArtifactField(copy, "preview_artifact", "preview_path", dir, filenameBase + "_preview");
        if (!isAppOwnedPath(copy.optString("path", "")) && !copy.has("text")) {
            copy.remove("path");
        }
        if (!isAppOwnedPath(copy.optString("viewer_path", ""))) {
            copy.remove("viewer_path");
        }
        if (!isAppOwnedPath(copy.optString("html_viewer_path", ""))) {
            copy.remove("html_viewer_path");
        }
        if (!isAppOwnedPath(copy.optString("document_html_path", ""))) {
            copy.remove("document_html_path");
        }
        if (!isAppOwnedPath(copy.optString("preview_path", ""))) {
            copy.remove("preview_path");
        }
        copy.remove("viewer");
        copy.remove("preview");
        return copy;
    }

    private void localizeArtifactField(JSONObject attachment, String artifactField, String pathField, File dir, String filenameBase)
            throws Exception {
        String artifactId = safe(attachment.optString(artifactField, ""));
        if (artifactId.isEmpty()) {
            return;
        }
        String existingPath = safe(attachment.optString(pathField, ""));
        String hint = existingPath.isEmpty() ? artifactId : new File(existingPath).getName();
        File target = downloadArtifact(artifactId, dir, filenameBase, hint);
        Json.put(attachment, pathField, target.getAbsolutePath());
    }

    private File downloadArtifact(String artifactId, File dir, String filenameBase, String hint) throws Exception {
        String url = baseUrl("/api/artifacts/" + URLEncoder.encode(artifactId, "UTF-8").replace("+", "%20"));
        Request request = new Request.Builder()
                .url(url)
                .header("Authorization", "Bearer " + settings.getPuckyTurnAuthToken())
                .get()
                .build();
        try (Response response = http.newCall(request).execute()) {
            if (!response.isSuccessful() || response.body() == null) {
                throw new IOException("artifact http_" + response.code());
            }
            File target = new File(dir, safeAttachmentFilename(filenameBase, hint));
            write(target, response.body().bytes());
            return target;
        }
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

    private boolean isAppOwnedPath(String raw) {
        String clean = safe(raw);
        if (clean.isEmpty()) {
            return false;
        }
        try {
            File file = new File(clean).getCanonicalFile();
            return isWithin(file, context.getFilesDir())
                    || isWithin(file, context.getCacheDir())
                    || isWithin(file, context.getExternalFilesDir(null));
        } catch (Exception ignored) {
            return false;
        }
    }

    private static boolean isWithin(File file, File root) throws IOException {
        if (file == null || root == null) {
            return false;
        }
        File candidate = file.getCanonicalFile();
        File base = root.getCanonicalFile();
        return candidate.equals(base) || candidate.getPath().startsWith(base.getPath() + File.separator);
    }

    private static String safe(String raw) {
        return raw == null ? "" : raw.trim();
    }

    private static String safeAttachmentFilename(String prefix, String hint) {
        String cleanHint = safeName(hint);
        if (cleanHint.isEmpty()) {
            cleanHint = prefix;
        }
        int dot = cleanHint.lastIndexOf('.');
        String ext = dot >= 0 ? cleanHint.substring(dot) : "";
        String stem = dot >= 0 ? cleanHint.substring(0, dot) : cleanHint;
        if (stem.isEmpty()) {
            stem = prefix;
        }
        return safeName(prefix + "_" + stem) + ext;
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
