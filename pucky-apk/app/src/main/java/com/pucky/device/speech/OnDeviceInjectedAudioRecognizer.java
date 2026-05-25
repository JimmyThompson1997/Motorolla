package com.pucky.device.speech;

import android.media.AudioFormat;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.ParcelFileDescriptor;
import android.speech.RecognitionListener;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;
import android.util.Log;

import com.pucky.device.speech.lab.AudioFrameBus;
import com.pucky.device.util.Json;

import org.json.JSONArray;

import java.io.IOException;
import java.util.ArrayList;
import java.util.Locale;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

public final class OnDeviceInjectedAudioRecognizer {
    private static final String TAG = "PuckyInjectedSpeech";
    private static final int WAV_HEADER_BYTES = 44;
    private static final int STT_EDGE_PADDING_MS = 200;
    private static final long DEFAULT_TIMEOUT_MS = 8000L;

    private final android.content.Context context;
    private final Handler main;

    public OnDeviceInjectedAudioRecognizer(android.content.Context context) {
        this.context = context.getApplicationContext();
        this.main = new Handler(Looper.getMainLooper());
    }

    public RecognitionOutcome recognizeWav(byte[] wavBytes) {
        return recognize(padSamplesForRecognition(readPcm16MonoWav(wavBytes)), DEFAULT_TIMEOUT_MS);
    }

    public RecognitionOutcome recognize(short[] samples, long timeoutMs) {
        if (samples == null || samples.length == 0) {
            return RecognitionOutcome.failed("empty_capture", "No PCM samples were provided");
        }
        RecognitionSession session = new RecognitionSession();
        CountDownLatch latch = new CountDownLatch(1);
        main.post(() -> startRecognitionOnMain(samples, session, latch));
        try {
            boolean completed = latch.await(Math.max(1L, timeoutMs), TimeUnit.MILLISECONDS);
            if (!completed) {
                cleanupRecognition(session);
                return RecognitionOutcome.failed("classifier_timeout",
                        "Android on-device recognizer timed out");
            }
        } catch (InterruptedException exc) {
            Thread.currentThread().interrupt();
            cleanupRecognition(session);
            return RecognitionOutcome.failed("classifier_interrupted", exc.getMessage());
        }
        return session.outcome == null
                ? RecognitionOutcome.failed("classifier_failed", "Android on-device recognizer returned no outcome")
                : session.outcome;
    }

    private void startRecognitionOnMain(short[] samples, RecognitionSession session, CountDownLatch latch) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU
                || !SpeechRecognizer.isOnDeviceRecognitionAvailable(context)) {
            session.outcome = RecognitionOutcome.failed("on_device_unavailable",
                    "Android on-device SpeechRecognizer injected audio is unavailable");
            latch.countDown();
            return;
        }
        try {
            ParcelFileDescriptor[] pipe = ParcelFileDescriptor.createPipe();
            session.read = pipe[0];
            ParcelFileDescriptor write = pipe[1];
            session.recognizer = SpeechRecognizer.createOnDeviceSpeechRecognizer(context);
            session.recognizer.setRecognitionListener(new RecognitionListener() {
                private boolean completed;

                @Override
                public void onReadyForSpeech(Bundle params) {
                }

                @Override
                public void onBeginningOfSpeech() {
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
                    if (completed) {
                        return;
                    }
                    completed = true;
                    session.outcome = RecognitionOutcome.failed(
                            "recognizer_" + error,
                            "Android on-device SpeechRecognizer injected-audio error " + error);
                    cleanupRecognition(session);
                    latch.countDown();
                }

                @Override
                public void onResults(Bundle results) {
                    if (completed) {
                        return;
                    }
                    completed = true;
                    session.outcome = RecognitionOutcome.succeeded(results);
                    cleanupRecognition(session);
                    latch.countDown();
                }

                @Override
                public void onPartialResults(Bundle partialResults) {
                }

                @Override
                public void onEvent(int eventType, Bundle params) {
                }

                @Override
                public void onSegmentResults(Bundle segmentResults) {
                    session.latestSegment = RecognitionOutcome.succeeded(segmentResults);
                }

                @Override
                public void onEndOfSegmentedSession() {
                    if (completed) {
                        return;
                    }
                    completed = true;
                    session.outcome = session.latestSegment == null
                            ? RecognitionOutcome.failed("empty_segmented_session",
                            "Android on-device SpeechRecognizer returned no transcript")
                            : session.latestSegment;
                    cleanupRecognition(session);
                    latch.countDown();
                }

                @Override
                public void onLanguageDetection(Bundle results) {
                }
            });
            android.content.Intent intent = new android.content.Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
            intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
            intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE, Locale.getDefault().toLanguageTag());
            intent.putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, false);
            intent.putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 5);
            intent.putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, true);
            intent.putExtra(RecognizerIntent.EXTRA_CALLING_PACKAGE, context.getPackageName());
            intent.putExtra(RecognizerIntent.EXTRA_AUDIO_SOURCE, session.read);
            intent.putExtra(RecognizerIntent.EXTRA_AUDIO_SOURCE_SAMPLING_RATE, AudioFrameBus.SAMPLE_RATE);
            intent.putExtra(RecognizerIntent.EXTRA_AUDIO_SOURCE_CHANNEL_COUNT, 1);
            intent.putExtra(RecognizerIntent.EXTRA_AUDIO_SOURCE_ENCODING, AudioFormat.ENCODING_PCM_16BIT);
            intent.putExtra(RecognizerIntent.EXTRA_SEGMENTED_SESSION, RecognizerIntent.EXTRA_AUDIO_SOURCE);
            intent.putExtra(RecognizerIntent.EXTRA_ENABLE_FORMATTING, RecognizerIntent.FORMATTING_OPTIMIZE_QUALITY);
            intent.putExtra(RecognizerIntent.EXTRA_HIDE_PARTIAL_TRAILING_PUNCTUATION, true);
            session.recognizer.startListening(intent);
            writeCapturedPcmAsync(write, samples);
        } catch (IOException | RuntimeException exc) {
            session.outcome = RecognitionOutcome.failed("recognizer_start_failed",
                    exc.getClass().getSimpleName() + ": " + exc.getMessage());
            cleanupRecognition(session);
            latch.countDown();
        }
    }

    private void writeCapturedPcmAsync(ParcelFileDescriptor write, short[] samples) {
        new Thread(() -> {
            try (ParcelFileDescriptor.AutoCloseOutputStream out =
                         new ParcelFileDescriptor.AutoCloseOutputStream(write)) {
                byte[] buffer = new byte[Math.min(8192, Math.max(2, samples.length * 2))];
                int offset = 0;
                while (offset < samples.length) {
                    int count = Math.min(buffer.length / 2, samples.length - offset);
                    for (int i = 0; i < count; i++) {
                        short value = samples[offset + i];
                        buffer[i * 2] = (byte) (value & 0xff);
                        buffer[i * 2 + 1] = (byte) ((value >> 8) & 0xff);
                    }
                    out.write(buffer, 0, count * 2);
                    offset += count;
                }
                out.flush();
            } catch (IOException exc) {
                Log.w(TAG, "injected-audio recognizer pipe write failed: " + exc.getMessage());
            }
        }, "pucky-injected-audio-pipe").start();
    }

    private void cleanupRecognition(RecognitionSession session) {
        main.post(() -> {
            try {
                if (session.recognizer != null) {
                    session.recognizer.destroy();
                }
            } catch (RuntimeException ignored) {
            }
            session.recognizer = null;
            if (session.read != null) {
                try {
                    session.read.close();
                } catch (IOException ignored) {
                }
                session.read = null;
            }
        });
    }

    public static short[] readPcm16MonoWav(byte[] wavBytes) {
        if (wavBytes == null || wavBytes.length <= WAV_HEADER_BYTES) {
            return new short[0];
        }
        int dataBytes = wavBytes.length - WAV_HEADER_BYTES;
        int sampleCount = dataBytes / 2;
        short[] samples = new short[sampleCount];
        int offset = WAV_HEADER_BYTES;
        for (int i = 0; i < sampleCount; i++) {
            int lo = wavBytes[offset++] & 0xff;
            int hi = wavBytes[offset++] & 0xff;
            samples[i] = (short) ((hi << 8) | lo);
        }
        return samples;
    }

    public static short[] padSamplesForRecognition(short[] samples) {
        if (samples == null || samples.length == 0 || STT_EDGE_PADDING_MS <= 0) {
            return samples == null ? new short[0] : samples;
        }
        int paddingSamples = AudioFrameBus.SAMPLE_RATE * STT_EDGE_PADDING_MS / 1000;
        short[] out = new short[samples.length + paddingSamples * 2];
        System.arraycopy(samples, 0, out, paddingSamples, samples.length);
        return out;
    }

    public static final class RecognitionOutcome {
        public final boolean succeeded;
        public final String status;
        public final String transcript;
        public final JSONArray alternatives;
        public final JSONArray confidences;
        public final String errorCode;
        public final String errorMessage;

        private RecognitionOutcome(
                boolean succeeded,
                String status,
                String transcript,
                JSONArray alternatives,
                JSONArray confidences,
                String errorCode,
                String errorMessage) {
            this.succeeded = succeeded;
            this.status = status;
            this.transcript = transcript == null ? "" : transcript;
            this.alternatives = alternatives == null ? new JSONArray() : alternatives;
            this.confidences = confidences == null ? new JSONArray() : confidences;
            this.errorCode = errorCode == null ? "" : errorCode;
            this.errorMessage = errorMessage == null ? "" : errorMessage;
        }

        static RecognitionOutcome succeeded(Bundle results) {
            ArrayList<String> values = results == null ? null : results.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
            float[] confidenceArray = results == null ? null : results.getFloatArray(SpeechRecognizer.CONFIDENCE_SCORES);
            return new RecognitionOutcome(true, "matched_or_no_match_ready",
                    first(values),
                    array(values),
                    array(confidenceArray),
                    "",
                    "");
        }

        public static RecognitionOutcome failed(String code, String message) {
            return new RecognitionOutcome(false, "classifier_failed", "", new JSONArray(),
                    new JSONArray(), code, message);
        }

        private static String first(ArrayList<String> values) {
            return values == null || values.isEmpty() ? "" : values.get(0);
        }

        private static JSONArray array(ArrayList<String> values) {
            JSONArray out = new JSONArray();
            if (values == null) {
                return out;
            }
            for (String value : values) {
                Json.add(out, value);
            }
            return out;
        }

        private static JSONArray array(float[] values) {
            JSONArray out = new JSONArray();
            if (values == null) {
                return out;
            }
            for (float value : values) {
                Json.add(out, value);
            }
            return out;
        }
    }

    private static final class RecognitionSession {
        SpeechRecognizer recognizer;
        ParcelFileDescriptor read;
        RecognitionOutcome outcome;
        RecognitionOutcome latestSegment;
    }
}
