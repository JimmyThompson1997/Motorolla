package com.pucky.device.assistant;

import android.content.Context;
import android.os.Bundle;
import android.service.voice.VoiceInteractionSession;
import android.util.Log;

public final class PuckyVoiceInteractionSession extends VoiceInteractionSession {
    private static final String TAG = "PuckyAssistantSession";

    public PuckyVoiceInteractionSession(Context context) {
        super(context);
    }

    @Override
    public void onShow(Bundle args, int showFlags) {
        super.onShow(args, showFlags);
        Log.i(TAG, "assistant session shown flags=" + showFlags);
        closeSystemDialogs();
        PuckyAssistantController.handleAssistantInvocation(getContext(), args, showFlags);
        finish();
    }
}
