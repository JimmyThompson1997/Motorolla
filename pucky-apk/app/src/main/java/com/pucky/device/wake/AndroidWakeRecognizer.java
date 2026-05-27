package com.pucky.device.wake;

import android.content.Context;
import android.content.Intent;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.speech.RecognitionListener;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;

import org.json.JSONArray;

import java.util.ArrayList;
import java.util.Locale;
import java.util.concurrent.atomic.AtomicBoolean;

final class AndroidWakeRecognizer implements WakeRecognizer {
    static final class Factory implements WakeRecognizerFactory {
        private final Context context;

        Factory(Context context) {
            this.context = context.getApplicationContext();
        }

        @Override
        public WakeRecognizer create() {
            return new AndroidWakeRecognizer(context);
        }
    }

    private final Context context;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final AtomicBoolean stopped = new AtomicBoolean(false);

    private SpeechRecognizer recognizer;
    private Callback callback;

    AndroidWakeRecognizer(Context context) {
        this.context = context.getApplicationContext();
    }

    @Override
    public void start(Callback callback) {
        if (callback == null) {
            throw new IllegalArgumentException("WakeRecognizer callback is required");
        }
        this.callback = callback;
        main.post(() -> {
            if (stopped.get()) {
                notifyStoppedOnce();
                return;
            }
            try {
                recognizer = SpeechRecognizer.createSpeechRecognizer(context);
                recognizer.setRecognitionListener(new Listener());
                Intent intent = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
                intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
                intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE, Locale.getDefault().toLanguageTag());
                intent.putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true);
                intent.putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 5);
                intent.putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, true);
                intent.putExtra(RecognizerIntent.EXTRA_CALLING_PACKAGE, context.getPackageName());
                recognizer.startListening(intent);
            } catch (RuntimeException exc) {
                emitError("recognizer_start_failed",
                        exc.getClass().getSimpleName() + ": " + String.valueOf(exc.getMessage()));
                notifyStoppedOnce();
            }
        });
    }

    @Override
    public void stop() {
        if (!stopped.compareAndSet(false, true)) {
            return;
        }
        main.post(() -> {
            SpeechRecognizer current = recognizer;
            recognizer = null;
            if (current != null) {
                try {
                    current.cancel();
                } catch (RuntimeException ignored) {
                }
                try {
                    current.destroy();
                } catch (RuntimeException ignored) {
                }
            }
            notifyStopped();
        });
    }

    private void emitError(String code, String message) {
        Callback target = callback;
        if (target != null && !stopped.get()) {
            target.onError(code, message == null ? "" : message);
        }
    }

    private void notifyStoppedOnce() {
        if (stopped.compareAndSet(false, true)) {
            notifyStopped();
        }
    }

    private void notifyStopped() {
        Callback target = callback;
        if (target != null) {
            target.onStopped();
        }
    }

    private final class Listener implements RecognitionListener {
        @Override
        public void onReadyForSpeech(Bundle params) {
            Callback target = callback;
            if (target != null && !stopped.get()) {
                target.onReady();
            }
        }

        @Override
        public void onBeginningOfSpeech() {
            Callback target = callback;
            if (target != null && !stopped.get()) {
                target.onBeginningOfSpeech();
            }
        }

        @Override
        public void onRmsChanged(float rmsdB) {
        }

        @Override
        public void onBufferReceived(byte[] buffer) {
        }

        @Override
        public void onEndOfSpeech() {
        }

        @Override
        public void onError(int error) {
            if (stopped.get()) {
                notifyStopped();
                return;
            }
            emitError(errorName(error), "Android SpeechRecognizer error " + error + " (" + errorName(error) + ")");
            stop();
        }

        @Override
        public void onResults(Bundle results) {
            if (stopped.get()) {
                notifyStopped();
                return;
            }
            Callback target = callback;
            if (target != null) {
                target.onFinal(firstResult(results), resultsArray(results));
            }
        }

        @Override
        public void onPartialResults(Bundle partialResults) {
            if (stopped.get()) {
                notifyStopped();
                return;
            }
            Callback target = callback;
            if (target != null) {
                target.onPartial(firstResult(partialResults), resultsArray(partialResults));
            }
        }

        @Override
        public void onEvent(int eventType, Bundle params) {
        }
    }

    private static String firstResult(Bundle results) {
        ArrayList<String> values = extractResults(results);
        return values.isEmpty() ? "" : values.get(0);
    }

    private static JSONArray resultsArray(Bundle results) {
        JSONArray out = new JSONArray();
        for (String value : extractResults(results)) {
            out.put(value);
        }
        return out;
    }

    private static ArrayList<String> extractResults(Bundle results) {
        ArrayList<String> values = results == null ? null : results.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
        if (values == null || values.isEmpty()) {
            ArrayList<CharSequence> charValues = results == null ? null
                    : results.getCharSequenceArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
            values = new ArrayList<>();
            if (charValues != null) {
                for (CharSequence value : charValues) {
                    if (value != null) {
                        values.add(value.toString());
                    }
                }
            }
        }
        return values == null ? new ArrayList<>() : values;
    }

    private static String errorName(int error) {
        switch (error) {
            case SpeechRecognizer.ERROR_AUDIO:
                return "ERROR_AUDIO";
            case SpeechRecognizer.ERROR_CLIENT:
                return "ERROR_CLIENT";
            case SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS:
                return "ERROR_INSUFFICIENT_PERMISSIONS";
            case SpeechRecognizer.ERROR_NETWORK:
                return "ERROR_NETWORK";
            case SpeechRecognizer.ERROR_NETWORK_TIMEOUT:
                return "ERROR_NETWORK_TIMEOUT";
            case SpeechRecognizer.ERROR_NO_MATCH:
                return "ERROR_NO_MATCH";
            case SpeechRecognizer.ERROR_RECOGNIZER_BUSY:
                return "ERROR_RECOGNIZER_BUSY";
            case SpeechRecognizer.ERROR_SERVER:
                return "ERROR_SERVER";
            case SpeechRecognizer.ERROR_SERVER_DISCONNECTED:
                return "ERROR_SERVER_DISCONNECTED";
            case SpeechRecognizer.ERROR_SPEECH_TIMEOUT:
                return "ERROR_SPEECH_TIMEOUT";
            case SpeechRecognizer.ERROR_TOO_MANY_REQUESTS:
                return "ERROR_TOO_MANY_REQUESTS";
            case SpeechRecognizer.ERROR_LANGUAGE_NOT_SUPPORTED:
                return "ERROR_LANGUAGE_NOT_SUPPORTED";
            case SpeechRecognizer.ERROR_LANGUAGE_UNAVAILABLE:
                return "ERROR_LANGUAGE_UNAVAILABLE";
            default:
                return "ERROR_" + error;
        }
    }
}
