package com.pucky.device.calls;

import android.telecom.Call;
import android.telecom.CallAudioState;
import android.telecom.InCallService;

public final class PuckyInCallService extends InCallService {
    @Override
    public void onCallAdded(Call call) {
        super.onCallAdded(call);
        PuckyCallStateStore.onCallAdded(this, call);
    }

    @Override
    public void onCallRemoved(Call call) {
        PuckyCallStateStore.onCallRemoved(call);
        super.onCallRemoved(call);
    }

    @Override
    public void onBringToForeground(boolean showDialpad) {
        super.onBringToForeground(showDialpad);
        PuckyCallStateStore.onBringToForeground(this, showDialpad);
    }

    @Override
    public void onCallAudioStateChanged(CallAudioState audioState) {
        super.onCallAudioStateChanged(audioState);
    }
}
