package com.pucky.device.ui;

import android.content.Context;
import android.content.SharedPreferences;

import com.pucky.device.command.CommandErrorCodes;
import com.pucky.device.command.CommandException;
import com.pucky.device.util.Json;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

public final class ReplyCardStore {
    private static final String PREFS = "pucky_reply_cards";
    private static final String KEY_CARDS = "cards_json";

    private final Context context;

    public ReplyCardStore(Context context) {
        this.context = context.getApplicationContext();
    }

    public List<ReplyCard> cards() {
        String raw = prefs().getString(KEY_CARDS, "[]");
        try {
            return ReplyCard.listFromJson(new JSONArray(raw));
        } catch (Exception ignored) {
            return Collections.emptyList();
        }
    }

    public JSONObject replace(JSONArray cardsJson) throws CommandException {
        List<ReplyCard> cards = ReplyCard.listFromJson(cardsJson);
        validateCards(cards);
        prefs().edit().putString(KEY_CARDS, ReplyCard.listToJson(cards).toString()).apply();
        return snapshot(cards);
    }

    public JSONObject prepend(JSONObject cardJson) throws CommandException {
        ReplyCard card = ReplyCard.fromJson(cardJson);
        validateCard(card);
        List<ReplyCard> cards = new ArrayList<>();
        cards.add(card);
        cards.addAll(cards());
        prefs().edit().putString(KEY_CARDS, ReplyCard.listToJson(cards).toString()).apply();
        return snapshot(cards);
    }

    public JSONObject clear() {
        prefs().edit().putString(KEY_CARDS, "[]").apply();
        return snapshot(Collections.emptyList());
    }

    public JSONObject snapshot() {
        return snapshot(cards());
    }

    private JSONObject snapshot(List<ReplyCard> cards) {
        JSONObject out = new JSONObject();
        Json.put(out, "schema", "pucky.reply_cards.v1");
        Json.put(out, "count", cards.size());
        Json.put(out, "cards", ReplyCard.listToJson(cards));
        return out;
    }

    private void validateCards(List<ReplyCard> cards) throws CommandException {
        for (ReplyCard card : cards) {
            validateCard(card);
        }
    }

    private void validateCard(ReplyCard card) throws CommandException {
        validateAppOwnedPath(card.audioPath(), "audio_path");
        validateAppOwnedPath(card.htmlPath(), "html_path");
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
}
