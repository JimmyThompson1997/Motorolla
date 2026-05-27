package com.pucky.device.ui;

import android.content.Context;
import android.content.SharedPreferences;

import com.pucky.device.command.CommandErrorCodes;
import com.pucky.device.command.CommandException;
import com.pucky.device.util.Json;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.Collections;
import java.util.List;

public final class ReplyCardStore {
    private static final String PREFS = "pucky_reply_cards";
    private static final String KEY_CARDS = "cards_json";
    private static final int MAX_TRACE_BYTES = 64 * 1024;
    private static final String PUBLIC_AUDIOBOOK_DIR =
            File.separator + "Podcasts" + File.separator + "From_Pocket_Computers_to_Planetary_Platforms";

    private final Context context;

    public ReplyCardStore(Context context) {
        this.context = context.getApplicationContext();
    }

    public List<ReplyCard> cards() {
        return readCards();
    }

    public JSONObject replace(JSONArray cardsJson) throws CommandException {
        List<ReplyCard> cards = ReplyCard.listFromJson(cardsJson);
        validateCards(cards);
        writeCards(cards);
        return snapshot(cards);
    }

    public JSONObject prepend(JSONObject cardJson) throws CommandException {
        ReplyCard card = ReplyCard.fromJson(cardJson);
        validateCard(card);
        List<ReplyCard> cards = new ArrayList<>();
        cards.add(card);
        cards.addAll(readCards());
        writeCards(cards);
        return snapshot(cards);
    }

    public JSONObject upsert(JSONObject cardJson) throws CommandException {
        ReplyCard card = ReplyCard.fromJson(cardJson);
        validateCard(card);
        List<ReplyCard> existing = readCards();
        List<ReplyCard> next = new ArrayList<>();
        boolean removed = false;
        for (ReplyCard current : existing) {
            if (sameIdentity(current, card)) {
                removed = true;
                continue;
            }
            next.add(current);
        }
        if (!card.deleted()) {
            next.add(card);
        }
        sortCards(next);
        writeCards(next);
        return snapshot(next);
    }

    public JSONObject merge(JSONArray cardsJson) throws CommandException {
        List<ReplyCard> incoming = ReplyCard.listFromJson(cardsJson);
        validateCards(incoming);
        List<ReplyCard> merged = new ArrayList<>(readCards());
        for (ReplyCard card : incoming) {
            merged = mergeOne(merged, card);
        }
        sortCards(merged);
        writeCards(merged);
        return snapshot(merged);
    }

    public JSONObject clear() {
        prefs().edit().putString(KEY_CARDS, "[]").apply();
        return snapshot(Collections.emptyList());
    }

    public JSONObject snapshot() {
        return snapshot(readCards());
    }

    private JSONObject snapshot(List<ReplyCard> cards) {
        JSONObject out = new JSONObject();
        JSONArray visible = new JSONArray();
        int count = 0;
        for (ReplyCard card : cards) {
            if (card.deleted()) {
                continue;
            }
            Json.add(visible, card.toJson());
            count++;
        }
        Json.put(out, "schema", "pucky.reply_cards.v1");
        Json.put(out, "count", count);
        Json.put(out, "cards", visible);
        return out;
    }

    public JSONObject find(String cardId, String sessionId) {
        ReplyCard found = null;
        for (ReplyCard card : readCards()) {
            if (sameIdentity(card, cardId, sessionId)) {
                found = card;
                break;
            }
        }
        JSONObject out = new JSONObject();
        Json.put(out, "schema", "pucky.reply_card_lookup.v1");
        Json.put(out, "found", found != null);
        Json.put(out, "card", found == null ? JSONObject.NULL : found.toJson());
        return out;
    }

    private void validateCards(List<ReplyCard> cards) throws CommandException {
        for (ReplyCard card : cards) {
            validateCard(card);
        }
    }

    private void validateCard(ReplyCard card) throws CommandException {
        validateAudioPath(card.audioPath(), "audio_path");
        validateAudioPath(card.audioPlaylistPath(), "audio_playlist_path");
        validateAppOwnedPath(card.htmlPath(), "html_path");
        validateImagePaths(card.images());
        validateTranscriptMessages(card.transcriptMessages());
        validateTrace(card.trace());
    }

    private void validateImagePaths(String imagesJson) throws CommandException {
        if (imagesJson == null || imagesJson.trim().isEmpty()) {
            return;
        }
        try {
            JSONArray images = new JSONArray(imagesJson);
            for (int index = 0; index < images.length(); index++) {
                JSONObject image = images.optJSONObject(index);
                if (image == null) {
                    throw new CommandException(CommandErrorCodes.MALFORMED_COMMAND,
                            "images[" + index + "] must be an object");
                }
                validateAppOwnedPath(firstPath(image), "images[" + index + "].path");
            }
        } catch (CommandException exc) {
            throw exc;
        } catch (Exception exc) {
            throw new CommandException(CommandErrorCodes.MALFORMED_COMMAND,
                    "Unable to validate images: " + exc.getMessage());
        }
    }

    private void validateTranscriptMessages(String transcriptMessagesJson) throws CommandException {
        if (transcriptMessagesJson == null || transcriptMessagesJson.trim().isEmpty()) {
            return;
        }
        try {
            JSONArray messages = new JSONArray(transcriptMessagesJson);
            for (int index = 0; index < messages.length(); index++) {
                JSONObject message = messages.optJSONObject(index);
                if (message == null) {
                    throw new CommandException(CommandErrorCodes.MALFORMED_COMMAND,
                            "transcript_messages[" + index + "] must be an object");
                }
                validateAttachmentPaths(message.optJSONArray("attachments"),
                        "transcript_messages[" + index + "].attachments");
            }
        } catch (CommandException exc) {
            throw exc;
        } catch (Exception exc) {
            throw new CommandException(CommandErrorCodes.MALFORMED_COMMAND,
                    "Unable to validate transcript_messages: " + exc.getMessage());
        }
    }

    private void validateAttachmentPaths(JSONArray attachments, String field) throws CommandException {
        if (attachments == null) {
            return;
        }
        for (int index = 0; index < attachments.length(); index++) {
            JSONObject attachment = attachments.optJSONObject(index);
            if (attachment == null) {
                throw new CommandException(CommandErrorCodes.MALFORMED_COMMAND,
                        field + "[" + index + "] must be an object");
            }
            for (String key : new String[] {
                    "path",
                    "local_path",
                    "image_path",
                    "preview_path",
                    "viewer_path",
                    "html_viewer_path",
                    "document_html_path"
            }) {
                validateAppOwnedPath(attachment.optString(key, ""), field + "[" + index + "]." + key);
            }
        }
    }

    private void validateTrace(String traceJson) throws CommandException {
        if (traceJson == null || traceJson.trim().isEmpty()) {
            return;
        }
        if (traceJson.getBytes(StandardCharsets.UTF_8).length > MAX_TRACE_BYTES) {
            throw new CommandException(CommandErrorCodes.MALFORMED_COMMAND,
                    "trace exceeds " + MAX_TRACE_BYTES + " bytes");
        }
    }

    private String firstPath(JSONObject image) {
        String path = image.optString("path", "").trim();
        if (!path.isEmpty()) {
            return path;
        }
        path = image.optString("local_path", "").trim();
        if (!path.isEmpty()) {
            return path;
        }
        return image.optString("image_path", "").trim();
    }

    private void validateAppOwnedPath(String path, String field) throws CommandException {
        if (path == null || path.trim().isEmpty()) {
            return;
        }
        try {
            File file = new File(path).getCanonicalFile();
            if (!file.isAbsolute()) {
                throw new CommandException(CommandErrorCodes.MALFORMED_COMMAND,
                        field + " must be an absolute app-owned path");
            }
            if (!isWithin(file, context.getFilesDir())
                    && !isWithin(file, context.getCacheDir())
                    && !isWithin(file, context.getExternalFilesDir(null))) {
                throw new CommandException(CommandErrorCodes.PERMISSION_MISSING,
                        field + " is outside Pucky app-owned storage");
            }
        } catch (CommandException exc) {
            throw exc;
        } catch (Exception exc) {
            throw new CommandException(CommandErrorCodes.EXECUTION_FAILED,
                    "Unable to validate " + field + ": " + exc.getMessage());
        }
    }

    private void validateAudioPath(String path, String field) throws CommandException {
        if (path == null || path.trim().isEmpty()) {
            return;
        }
        try {
            File file = new File(path).getCanonicalFile();
            if (!file.isAbsolute()) {
                throw new CommandException(CommandErrorCodes.MALFORMED_COMMAND,
                        field + " must be an absolute path");
            }
            if (!isWithin(file, context.getFilesDir())
                    && !isWithin(file, context.getCacheDir())
                    && !isWithin(file, context.getExternalFilesDir(null))
                    && !isAllowedPublicAudiobook(file)) {
                throw new CommandException(CommandErrorCodes.PERMISSION_MISSING,
                        field + " is outside Pucky playback storage");
            }
        } catch (CommandException exc) {
            throw exc;
        } catch (Exception exc) {
            throw new CommandException(CommandErrorCodes.EXECUTION_FAILED,
                    "Unable to validate " + field + ": " + exc.getMessage());
        }
    }

    private boolean isAllowedPublicAudiobook(File file) throws Exception {
        File sharedStorage = new File("/storage/emulated/0" + PUBLIC_AUDIOBOOK_DIR).getCanonicalFile();
        File sdcard = new File("/sdcard" + PUBLIC_AUDIOBOOK_DIR).getCanonicalFile();
        File legacySdcard = new File("/mnt/sdcard" + PUBLIC_AUDIOBOOK_DIR).getCanonicalFile();
        return isWithin(file, sharedStorage) || isWithin(file, sdcard) || isWithin(file, legacySdcard);
    }

    private static boolean isWithin(File file, File root) throws Exception {
        if (root == null) {
            return false;
        }
        String filePath = file.getCanonicalPath();
        String rootPath = root.getCanonicalPath();
        return filePath.equals(rootPath) || filePath.startsWith(rootPath + File.separator);
    }

    private SharedPreferences prefs() {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    private List<ReplyCard> readCards() {
        String raw = prefs().getString(KEY_CARDS, "[]");
        try {
            return new ArrayList<>(ReplyCard.listFromJson(new JSONArray(raw)));
        } catch (Exception ignored) {
            return new ArrayList<>();
        }
    }

    private void writeCards(List<ReplyCard> cards) {
        prefs().edit().putString(KEY_CARDS, ReplyCard.listToJson(cards).toString()).apply();
    }

    private List<ReplyCard> mergeOne(List<ReplyCard> existing, ReplyCard incoming) {
        List<ReplyCard> next = new ArrayList<>();
        for (ReplyCard current : existing) {
            if (!sameIdentity(current, incoming)) {
                next.add(current);
            }
        }
        if (!incoming.deleted()) {
            next.add(incoming);
        }
        return next;
    }

    private static boolean sameIdentity(ReplyCard left, ReplyCard right) {
        return sameIdentity(left, right.cardId(), right.sessionId());
    }

    private static boolean sameIdentity(ReplyCard card, String cardId, String sessionId) {
        String leftCardId = safe(card.cardId());
        String rightCardId = safe(cardId);
        if (!leftCardId.isEmpty() && !rightCardId.isEmpty()) {
            return leftCardId.equals(rightCardId);
        }
        String leftSessionId = safe(card.sessionId());
        String rightSessionId = safe(sessionId);
        return !leftSessionId.isEmpty() && leftSessionId.equals(rightSessionId);
    }

    private static void sortCards(List<ReplyCard> cards) {
        cards.sort(Comparator
                .comparingLong(ReplyCardStore::sortTimestamp)
                .reversed()
                .thenComparing(ReplyCard::title, String.CASE_INSENSITIVE_ORDER));
    }

    private static long sortTimestamp(ReplyCard card) {
        return parseIso(card.updatedAt(), parseIso(card.createdAt(), 0L));
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

    private static String safe(String value) {
        return value == null ? "" : value.trim();
    }
}
