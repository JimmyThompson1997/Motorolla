package com.pucky.device.assistant;

import android.content.Intent;
import android.os.Bundle;
import android.speech.RecognitionService;
import android.speech.SpeechRecognizer;

public final class PuckyRecognitionService extends RecognitionService {
    @Override
    protected void onStartListening(Intent recognizerIntent, Callback listener) {
        try {
            listener.beginningOfSpeech();
            listener.error(SpeechRecognizer.ERROR_CLIENT);
        } catch (Exception ignored) {
            // Best-effort no-op service for assistant role qualification.
        }
    }

    @Override
    protected void onCancel(Callback listener) {
    }

    @Override
    protected void onStopListening(Callback listener) {
        try {
            listener.results(new Bundle());
        } catch (Exception ignored) {
            // Best effort no-op service for assistant role qualification.
        }
    }
}
