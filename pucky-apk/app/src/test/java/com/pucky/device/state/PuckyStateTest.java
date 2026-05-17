package com.pucky.device.state;

import org.json.JSONObject;
import org.junit.Test;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

public final class PuckyStateTest {
    @Test
    public void snapshotJsonMirrorsDashboardState() throws Exception {
        PuckyState state = PuckyState.get();
        state.setDeviceId("pucky-test");
        state.setBrokerUrl("ws://broker.example/v1/devices/pucky-test/connect");
        state.setServiceRunning(true);
        state.setConnectionState("online");
        state.setLastCommand("cmd_7", "completed");
        state.setLastError("none");

        JSONObject snapshot = state.snapshotJson();

        assertEquals("pucky.ui_state.v1", snapshot.getString("schema"));
        assertEquals(true, snapshot.getBoolean("service_running"));
        assertEquals("online", snapshot.getString("connection_state"));
        assertEquals("pucky-test", snapshot.getString("device_id"));
        assertEquals("cmd_7", snapshot.getString("last_command_id"));
        assertEquals("completed", snapshot.getString("last_command_status"));
        assertTrue(snapshot.getString("dashboard_text").contains("Connection: online"));
    }
}
