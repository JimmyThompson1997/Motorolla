package com.pucky.device.speech;

import android.media.AudioAttributes;
import android.media.AudioManager;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.speech.tts.TextToSpeech;
import android.speech.tts.Voice;
import android.util.Log;

import com.pucky.device.audio.AudioRouteDetector;
import com.pucky.device.clipboard.PuckyClipboardController;
import com.pucky.device.command.CommandErrorCodes;
import com.pucky.device.util.Json;

import org.json.JSONObject;

import java.time.Instant;
import java.util.ArrayList;
import java.util.Locale;
import java.util.Set;
import java.util.UUID;

public final class PuckyTurnKeywordInterceptor {
    private static final String TAG = "PuckyTurnKeyword";
    private static final long TTS_READY_WAIT_MS = 1800L;
    private static final long TTS_AFTER_CHIME_MS = 250L;

    private static volatile PuckyTurnKeywordInterceptor shared;

    private final android.content.Context context;
    private final RecipeStepExecutor recipeStepExecutor;
    private final PuckyClipboardController clipboardController;
    private final AudioRouteDetector routeDetector;
    private final OnDeviceInjectedAudioRecognizer injectedRecognizer;
    private final Handler main;

    private TextToSpeech speaker;
    private boolean ttsReady;
    private boolean ttsInitializing;
    private String ttsVoiceName = "";
    private boolean ttsVoiceNetworkRequired;

    public static PuckyTurnKeywordInterceptor shared(android.content.Context context) {
        PuckyTurnKeywordInterceptor existing = shared;
        if (existing != null) {
            return existing;
        }
        synchronized (PuckyTurnKeywordInterceptor.class) {
            if (shared == null) {
                shared = new PuckyTurnKeywordInterceptor(context.getApplicationContext());
            }
            return shared;
        }
    }

    private PuckyTurnKeywordInterceptor(android.content.Context context) {
        this.context = context.getApplicationContext();
        this.recipeStepExecutor = new RecipeStepExecutor(this.context);
        this.clipboardController = PuckyClipboardController.shared(this.context);
        this.routeDetector = new AudioRouteDetector(this.context);
        this.injectedRecognizer = new OnDeviceInjectedAudioRecognizer(this.context);
        this.main = new Handler(Looper.getMainLooper());
    }

    public JSONObject intercept(byte[] wavBytes, String localSessionId, String turnId, JSONObject speechGate) {
        JSONObject out = new JSONObject();
        Json.put(out, "schema", "pucky.turn_keyword_intercept.v1");
        Json.put(out, "local_session_id", localSessionId);
        Json.put(out, "turn_id", turnId);
        Json.put(out, "source", "volume_up_walkie");
        Json.put(out, "speech_gate", speechGate == null ? JSONObject.NULL : speechGate);
        String storedRaw = storedRecipeBundleRaw();
        Json.put(out, "stored_recipe_bundle_present", !storedRaw.trim().isEmpty());
        if (storedRaw.trim().isEmpty()) {
            Json.put(out, "classifier_status", "no_cached_vm_bundle");
            Json.put(out, "handled", false);
            Json.put(out, "matched", false);
            return out;
        }
        short[] samples = OnDeviceInjectedAudioRecognizer.padSamplesForRecognition(
                OnDeviceInjectedAudioRecognizer.readPcm16MonoWav(wavBytes));
        if (samples.length == 0) {
            Json.put(out, "classifier_status", "empty_capture");
            Json.put(out, "handled", false);
            Json.put(out, "matched", false);
            return out;
        }
        OnDeviceInjectedAudioRecognizer.RecognitionOutcome recognition = injectedRecognizer.recognize(samples, 8000L);
        Json.put(out, "classifier_status", recognition.status);
        Json.put(out, "final_transcript", recognition.transcript);
        Json.put(out, "alternatives", recognition.alternatives);
        Json.put(out, "confidence_scores", recognition.confidences);
        if (!recognition.errorCode.isEmpty()) {
            Json.put(out, "error_code", recognition.errorCode);
            Json.put(out, "error_message", recognition.errorMessage);
        }
        if (!recognition.succeeded || recognition.transcript.trim().isEmpty()) {
            Json.put(out, "handled", false);
            Json.put(out, "matched", false);
            return out;
        }

        SpeechRecipeRegistry.RecipeMatch recipe = SpeechRecipeRegistry.matchStoredOnly(recognition.transcript, storedRaw);
        Json.put(out, "match", SpeechRecipeRegistry.matchJson(recipe));
        Json.put(out, "matched", recipe.matched);
        if (!recipe.matched) {
            Json.put(out, "handled", false);
            return out;
        }

        JSONObject session = new JSONObject();
        Json.put(session, "schema", "pucky.turn_keyword_session.v1");
        Json.put(session, "source", "volume_up_walkie");
        Json.put(session, "session_id", localSessionId);
        Json.put(session, "turn_id", turnId);
        Json.put(session, "route", routeDetector.snapshot());
        Json.put(session, "started_at", Instant.now().toString());
        Json.put(session, "completed_at", Instant.now().toString());
        Json.put(session, "final_transcript", recognition.transcript);
        Json.put(session, "alternatives", recognition.alternatives);
        Json.put(session, "confidence_scores", recognition.confidences);
        Json.put(session, "keyword_raw_transcript", recipe.rawTranscript);
        Json.put(session, "keyword_normalized_transcript", recipe.normalizedTranscript);
        Json.put(session, "keyword_match_strategy", "exact_utterance");
        Json.put(session, "keyword_match", recipe.matched);
        Json.put(session, "keyword_match_id", recipe.id);
        Json.put(session, "keyword_match_phrase", recipe.phrase);
        Json.put(session, "keyword_match_source", recipe.source);
        Json.put(session, "keyword_reply_text", recipe.replyText);

        String actionStatus = recipe.hasSteps() ? "planned" : "not_applicable";
        JSONObject actionResult = null;
        String actionErrorCode = "";
        String actionErrorMessage = "";
        boolean actionFailed = false;
        boolean actionPending = false;
        if (recipe.hasSteps()) {
            Json.put(session, "pucky_clipboard_entry_id", newClipboardEntryId());
            try {
                actionResult = recipeStepExecutor.execute(recipe, session);
                actionStatus = actionResult.optString("status", "unknown");
                actionPending = "pending".equals(actionStatus);
                actionFailed = !"succeeded".equals(actionStatus) && !actionPending;
                if (actionFailed) {
                    actionErrorCode = actionResult.optString("error_code", CommandErrorCodes.EXECUTION_FAILED);
                    actionErrorMessage = actionResult.optString("error_message", "recipe execution failed");
                }
            } catch (Exception exc) {
                actionFailed = true;
                actionStatus = "failed";
                actionErrorCode = exc instanceof com.pucky.device.command.CommandException
                        ? ((com.pucky.device.command.CommandException) exc).code()
                        : CommandErrorCodes.EXECUTION_FAILED;
                actionErrorMessage = exc.getMessage() == null ? exc.getClass().getSimpleName() : exc.getMessage();
            }
        }
        String replyOverride = actionResultReplyOverride(actionResult);
        String ttsText = replyOverride != null
                ? replyOverride
                : actionFailed
                ? failureReply(recipe, actionErrorCode)
                : recipe.replyText;
        boolean skipSuccessTts = recipe.matched && !actionFailed
                && (actionPending || shouldSkipSuccessTts(recipe, actionResult));
        JSONObject successChime = null;
        JSONObject failureChime = null;
        if (actionFailed) {
            failureChime = recipeStepExecutor.playFailureChime("pucky.keyword_action_failure_chime.v1");
            Json.put(out, "failure_chime", failureChime);
        } else if (recipe.matched && !actionPending) {
            successChime = recipeStepExecutor.playSuccessChime("pucky.keyword_success_chime.v1");
            Json.put(out, "success_chime", successChime);
        }

        Json.put(session, "keyword_action", recipe.hasSteps() ? recipe.steps : JSONObject.NULL);
        Json.put(session, "keyword_action_command",
                recipe.hasSteps() ? recipe.firstDeviceCommand().isEmpty() ? "vm_event.post" : recipe.firstDeviceCommand() : JSONObject.NULL);
        Json.put(session, "keyword_action_status", actionStatus);
        Json.put(session, "keyword_action_result", actionResult == null ? JSONObject.NULL : actionResult);
        Json.put(session, "keyword_action_error_code", actionErrorCode.isEmpty() ? JSONObject.NULL : actionErrorCode);
        Json.put(session, "keyword_action_error_message", actionErrorMessage.isEmpty() ? JSONObject.NULL : actionErrorMessage);

        if (recipe.hasSteps()) {
            JSONObject clipboard = clipboardController.append(
                    PuckyClipboardController.entryFromRecipeSession(session, "volume_up_walkie"));
            Json.put(out, "pucky_clipboard", clipboard);
            Json.put(session, "pucky_clipboard_saved", clipboard.optBoolean("saved", false));
            JSONObject entry = clipboard.optJSONObject("entry");
            if (entry != null) {
                Json.put(session, "pucky_clipboard_entry_id", entry.optString("entry_id", ""));
                Json.put(out, "pucky_clipboard_entry_id", entry.optString("entry_id", ""));
            }
        }

        if (!skipSuccessTts && ttsText != null && !ttsText.trim().isEmpty()) {
            Json.put(out, "tts_status", speakReply(ttsText));
            Json.put(out, "tts_text", ttsText);
        } else {
            Json.put(out, "tts_status", skipSuccessTts ? "skipped_keyword_action_feedback" : "skipped_empty_text");
        }

        Json.put(out, "handled", true);
        Json.put(out, "execution_status", actionStatus);
        Json.put(out, "execution", actionResult == null ? JSONObject.NULL : actionResult);
        Json.put(out, "error_code", actionErrorCode.isEmpty() ? JSONObject.NULL : actionErrorCode);
        Json.put(out, "error_message", actionErrorMessage.isEmpty() ? JSONObject.NULL : actionErrorMessage);
        Json.put(out, "keyword_reply_text", recipe.replyText);
        Log.i(TAG, "walkie keyword intercept turn=" + turnId
                + " matched=" + recipe.id
                + " action_status=" + actionStatus
                + " transcript=" + recipe.normalizedTranscript);
        return out;
    }

    private String storedRecipeBundleRaw() {
        return PuckyRecipeController.shared(context).storedRecipeBundleRaw();
    }

    private synchronized void ensureTtsReady() {
        if (speaker != null || ttsInitializing) {
            return;
        }
        ttsInitializing = true;
        main.post(() -> {
            try {
                WalkieKeywordTtsInitListener listener = new WalkieKeywordTtsInitListener();
                TextToSpeech created = new TextToSpeech(context, listener);
                listener.attach(created);
            } catch (RuntimeException exc) {
                synchronized (PuckyTurnKeywordInterceptor.this) {
                    ttsInitializing = false;
                    ttsReady = false;
                    ttsVoiceName = "";
                }
                Log.w(TAG, "walkie keyword TTS init failed: " + exc.getMessage());
            }
        });
    }

    private void handleTtsInit(TextToSpeech created, int status) {
        if (created == null || status != TextToSpeech.SUCCESS) {
            synchronized (this) {
                ttsReady = false;
                ttsInitializing = false;
                ttsVoiceName = "";
            }
            return;
        }
        Locale preferredLocale = Locale.getDefault();
        int language = created.setLanguage(preferredLocale);
        if (language == TextToSpeech.LANG_MISSING_DATA || language == TextToSpeech.LANG_NOT_SUPPORTED) {
            synchronized (this) {
                ttsReady = false;
                ttsInitializing = false;
                ttsVoiceName = "";
            }
            created.shutdown();
            return;
        }
        Voice selected = chooseLocalVoice(created, preferredLocale);
        if (selected != null) {
            try {
                created.setVoice(selected);
            } catch (RuntimeException ignored) {
            }
        }
        created.setAudioAttributes(new AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_MEDIA)
                .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                .build());
        synchronized (this) {
            speaker = created;
            ttsReady = true;
            ttsInitializing = false;
            ttsVoiceName = selected == null ? "" : selected.getName();
            ttsVoiceNetworkRequired = selected != null && selected.isNetworkConnectionRequired();
        }
    }

    private String speakReply(String text) {
        ensureTtsReady();
        waitForTtsReady(TTS_READY_WAIT_MS);
        TextToSpeech localSpeaker;
        synchronized (this) {
            localSpeaker = ttsReady ? speaker : null;
        }
        if (localSpeaker == null) {
            return "waiting_for_tts";
        }
        Bundle params = new Bundle();
        params.putFloat(TextToSpeech.Engine.KEY_PARAM_VOLUME, 1.0f);
        params.putInt(TextToSpeech.Engine.KEY_PARAM_STREAM, AudioManager.STREAM_MUSIC);
        main.postDelayed(() -> {
            try {
                localSpeaker.speak(text, TextToSpeech.QUEUE_FLUSH, params,
                        "pucky_turn_keyword_" + UUID.randomUUID().toString().replace("-", ""));
            } catch (RuntimeException exc) {
                Log.w(TAG, "walkie keyword TTS speak failed: " + exc.getMessage());
            }
        }, TTS_AFTER_CHIME_MS);
        return "scheduled";
    }

    private void waitForTtsReady(long timeoutMs) {
        long deadline = System.currentTimeMillis() + Math.max(0L, timeoutMs);
        while (System.currentTimeMillis() < deadline) {
            synchronized (this) {
                if (ttsReady || !ttsInitializing) {
                    return;
                }
            }
            try {
                Thread.sleep(50L);
            } catch (InterruptedException exc) {
                Thread.currentThread().interrupt();
                return;
            }
        }
    }

    private static Voice chooseLocalVoice(TextToSpeech created, Locale preferredLocale) {
        Set<Voice> voices = created.getVoices();
        if (voices == null || voices.isEmpty()) {
            return null;
        }
        Voice best = null;
        int bestScore = Integer.MIN_VALUE;
        for (Voice voice : voices) {
            if (voice == null || voice.getLocale() == null || !preferredLocale.getLanguage().equals(voice.getLocale().getLanguage())) {
                continue;
            }
            int score = 0;
            if (!voice.isNetworkConnectionRequired()) {
                score += 100;
            }
            if (voice.getQuality() > 0) {
                score += voice.getQuality();
            }
            if (voice.getLatency() > 0) {
                score -= voice.getLatency() / 10;
            }
            if (best == null || score > bestScore) {
                best = voice;
                bestScore = score;
            }
        }
        return best;
    }

    private static String actionResultReplyOverride(JSONObject actionResult) {
        if (actionResult == null) {
            return null;
        }
        if ("pucky.recipe_execution_result.v1".equals(actionResult.optString("schema", ""))) {
            org.json.JSONArray steps = actionResult.optJSONArray("step_results");
            if (steps != null) {
                for (int i = 0; i < steps.length(); i++) {
                    JSONObject step = steps.optJSONObject(i);
                    if (step == null) {
                        continue;
                    }
                    String nested = actionResultReplyOverride(step.optJSONObject("result"));
                    if (nested != null) {
                        return nested;
                    }
                }
            }
        }
        JSONObject result = actionResult.optJSONObject("result");
        if (result == null || !result.has("reply_text_override")) {
            return null;
        }
        return result.optString("reply_text_override", "");
    }

    private static boolean shouldSkipSuccessTts(SpeechRecipeRegistry.RecipeMatch recipe, JSONObject actionResult) {
        return recipe != null
                && recipe.hasSteps()
                && actionResultReplyOverride(actionResult) == null
                && isChimeOnlySuccessAction(recipe.firstDeviceCommand());
    }

    private static boolean isChimeOnlySuccessAction(String command) {
        return RecipeDevicePrimitiveExecutor.COMMAND_PHOTO_CAPTURE.equals(command)
                || RecipeDevicePrimitiveExecutor.COMMAND_LOCATION_PIN.equals(command)
                || RecipeDevicePrimitiveExecutor.COMMAND_SCREENSHOT_CAPTURE.equals(command)
                || RecipeDevicePrimitiveExecutor.COMMAND_VIDEO_CAPTURE_START.equals(command);
    }

    private static String failureReply(SpeechRecipeRegistry.RecipeMatch recipe, String actionErrorCode) {
        if (CommandErrorCodes.NO_DISPLAY_ON.equals(actionErrorCode)) {
            return "Failed. Phone screen is off.";
        }
        return recipe == null || recipe.errorReplyText.isEmpty()
                ? "That keyword action failed."
                : recipe.errorReplyText;
    }

    private static String newClipboardEntryId() {
        return "clip_" + UUID.randomUUID().toString().replace("-", "");
    }

    private final class WalkieKeywordTtsInitListener implements TextToSpeech.OnInitListener {
        private TextToSpeech created;

        void attach(TextToSpeech created) {
            this.created = created;
        }

        @Override
        public void onInit(int status) {
            handleTtsInit(created, status);
        }
    }

}
