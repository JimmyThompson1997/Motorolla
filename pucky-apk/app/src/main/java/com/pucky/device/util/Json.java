package com.pucky.device.util;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

public final class Json {
    private Json() {
    }

    public static JSONObject put(JSONObject object, String key, Object value) {
        try {
            object.put(key, value);
            return object;
        } catch (JSONException e) {
            throw new IllegalStateException(e);
        }
    }

    public static JSONArray add(JSONArray array, Object value) {
        array.put(value);
        return array;
    }
}
