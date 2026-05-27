package com.pucky.device.wake;

import org.json.JSONArray;

public interface WakeRecognizer {
    void start(Callback callback);

    void stop();

    interface Callback {
        void onReady();

        void onBeginningOfSpeech();

        void onPartial(String transcript, JSONArray alternatives);

        void onFinal(String transcript, JSONArray alternatives);

        void onError(String errorCode, String errorMessage);

        void onStopped();
    }
}

interface WakeRecognizerFactory {
    WakeRecognizer create();
}
