package com.pucky.device.assistant;

import android.service.voice.VoiceInteractionService;
import android.util.Log;

public final class PuckyVoiceInteractionService extends VoiceInteractionService {
    private static final String TAG = "PuckyVoiceInteraction";

    @Override
    public void onReady() {
        super.onReady();
        Log.i(TAG, "Pucky assistant service ready");
    }

    @Override
    public void onShutdown() {
        Log.i(TAG, "Pucky assistant service shutdown");
        super.onShutdown();
    }
}
