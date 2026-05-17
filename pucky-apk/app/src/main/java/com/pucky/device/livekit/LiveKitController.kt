package com.pucky.device.livekit

import android.content.Context
import android.media.MediaRecorder
import android.os.Build
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import io.livekit.android.annotations.Beta
import com.pucky.device.storage.SettingsStore
import com.pucky.device.util.Json
import io.livekit.android.AudioOptions
import io.livekit.android.ConnectOptions
import io.livekit.android.LiveKit
import io.livekit.android.LiveKitOverrides
import io.livekit.android.events.RoomEvent
import io.livekit.android.events.collect
import io.livekit.android.room.Room
import io.livekit.android.room.track.RemoteAudioTrack
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.net.URI
import java.time.Instant
import java.util.concurrent.TimeUnit

class LiveKitController private constructor(context: Context, private val settings: SettingsStore) {
    private val appContext: Context = context.applicationContext
    private val prefs = appContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val httpClient = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .build()

    private var room: Room? = null
    private var eventJob: Job? = null
    private var state: String = "disconnected"
    private var micEnabled: Boolean = false
    private var lastError: String = ""
    private var lastSession: JSONObject? = null
    private var connectedAt: String = ""
    private var activePttTurnId: String = ""

    init {
        LiveKit.init(appContext)
        loadSessionFromPrefs()
    }

    @Synchronized
    fun status(): JSONObject {
        val out = JSONObject()
        Json.put(out, "schema", "pucky.livekit_status.v1")
        Json.put(out, "state", state)
        Json.put(out, "connected", state == "connected" || state == "connected_talking" || state == "connected_muted")
        Json.put(out, "mic_enabled", micEnabled)
        Json.put(out, "room", lastSession?.optString("room") ?: JSONObject.NULL)
        Json.put(out, "room_name", lastSession?.optString("room_name") ?: JSONObject.NULL)
        Json.put(out, "url", lastSession?.optString("url") ?: JSONObject.NULL)
        Json.put(out, "identity", lastSession?.optString("identity") ?: JSONObject.NULL)
        Json.put(out, "participant_name", lastSession?.optString("participant_name") ?: JSONObject.NULL)
        Json.put(out, "connected_at", if (connectedAt.isBlank()) JSONObject.NULL else connectedAt)
        Json.put(out, "active_ptt_turn_id", if (activePttTurnId.isBlank()) JSONObject.NULL else activePttTurnId)
        Json.put(out, "remote_audio_gain", remoteAudioGain())
        Json.put(out, "last_error", if (lastError.isBlank()) JSONObject.NULL else lastError)
        val allEvents = eventsJson()
        Json.put(out, "event_count", allEvents.length())
        Json.put(out, "last_event", if (allEvents.length() == 0) JSONObject.NULL else allEvents.optJSONObject(allEvents.length() - 1))
        return out
    }

    fun requestSession(args: JSONObject): JSONObject = runBlocking(Dispatchers.IO) {
        requestSessionInternal(args)
    }

    private fun requestSessionInternal(args: JSONObject): JSONObject {
        return try {
            val endpoint = args.optString("session_url").ifBlank { defaultSessionUrl() }
            val bodyJson = JSONObject()
            copyIfPresent(args, bodyJson, "room_name")
            copyIfPresent(args, bodyJson, "participant_identity")
            copyIfPresent(args, bodyJson, "participant_name")
            val body = bodyJson.toString().toRequestBody(JSON)
            val request = Request.Builder()
                .url(endpoint)
                .header("Authorization", "Bearer ${settings.getToken()}")
                .post(body)
                .build()
            httpClient.newCall(request).execute().use { response ->
                val raw = response.body?.string().orEmpty()
                if (!response.isSuccessful) {
                    throw IllegalStateException("session request HTTP ${response.code}: $raw")
                }
                val session = JSONObject(raw)
                storeSession(session)
                event("session_requested", JSONObject().also {
                    Json.put(it, "endpoint", endpoint)
                    Json.put(it, "room", session.optString("room"))
                    Json.put(it, "identity", session.optString("identity"))
                })
                session
            }
        } catch (exc: Exception) {
            fail("session_request_failed", exc)
            throw exc
        }
    }

    fun connect(args: JSONObject): JSONObject = runBlocking(Dispatchers.IO) {
        connectInternal(args)
    }

    private suspend fun connectInternal(args: JSONObject): JSONObject {
        return try {
            val session = resolveSession(args)
            val url = session.optString("url", session.optString("server_url"))
            val token = session.optString("token", session.optString("participant_token"))
            val roomName = session.optString("room", session.optString("room_name"))
            if (url.isBlank()) {
                throw IllegalArgumentException("LiveKit url is required")
            }
            if (token.isBlank()) {
                throw IllegalArgumentException("LiveKit token is required")
            }
            disconnectInternal("reconnect_before_connect")
            state = "connecting"
            event("connect_started", JSONObject().also {
                Json.put(it, "url", url)
                Json.put(it, "room", roomName)
            })
            val activeRoom = LiveKit.create(appContext, overrides = liveKitOverrides())
            room = activeRoom
            startEventCollection(activeRoom)
            activeRoom.connect(
                url,
                token,
                ConnectOptions(autoSubscribe = true, audio = false, video = false)
            )
            activeRoom.localParticipant.setMicrophoneEnabled(false)
            micEnabled = false
            state = "connected_muted"
            connectedAt = Instant.now().toString()
            lastError = ""
            event("connected", JSONObject().also {
                Json.put(it, "room", roomName)
                Json.put(it, "identity", session.optString("identity", session.optString("participant_identity")))
            })
            status()
        } catch (exc: Exception) {
            fail("connect_failed", exc)
            throw exc
        }
    }

    fun disconnect(args: JSONObject): JSONObject {
        val reason = args.optString("reason", "command_disconnect")
        disconnectInternal(reason)
        return status()
    }

    fun setMic(args: JSONObject): JSONObject = runBlocking(Dispatchers.IO) {
        setMicInternal(args)
    }

    private suspend fun setMicInternal(args: JSONObject): JSONObject {
        return try {
            val activeRoom = room ?: throw IllegalStateException("LiveKit room is not connected")
            val enabled = args.optBoolean("enabled", false)
            val changed = activeRoom.localParticipant.setMicrophoneEnabled(enabled)
            val sdkReportedEnabled = activeRoom.localParticipant.isMicrophoneEnabled
            micEnabled = enabled
            state = if (micEnabled) "connected_talking" else "connected_muted"
            event(if (enabled) "mic_enabled" else "mic_disabled", JSONObject().also {
                Json.put(it, "requested_enabled", enabled)
                Json.put(it, "changed", changed)
                Json.put(it, "sdk_reported_enabled", sdkReportedEnabled)
                Json.put(it, "reason", args.optString("reason", "command"))
                copyIfPresent(args, it, "ptt_turn_id")
            })
            scope.launch {
                delay(750)
                event("mic_state_observed", JSONObject().also {
                    Json.put(it, "requested_enabled", enabled)
                    Json.put(it, "sdk_reported_enabled", activeRoom.localParticipant.isMicrophoneEnabled)
                    Json.put(it, "reason", args.optString("reason", "command"))
                    copyIfPresent(args, it, "ptt_turn_id")
                })
            }
            status()
        } catch (exc: Exception) {
            fail("mic_set_failed", exc)
            throw exc
        }
    }

    fun ensureConnected(args: JSONObject): JSONObject = runBlocking(Dispatchers.IO) {
        ensureConnectedInternal(args)
    }

    private suspend fun ensureConnectedInternal(args: JSONObject): JSONObject {
        val out = JSONObject()
        val connectedBefore = isLiveKitConnected()
        Json.put(out, "schema", "pucky.livekit_ensure_connected.v1")
        Json.put(out, "connected_before", connectedBefore)
        Json.put(out, "state_before", state)
        Json.put(out, "session_expired", sessionExpired(lastSession, SESSION_EXPIRY_GRACE_SECONDS))
        if (connectedBefore) {
            Json.put(out, "connected_after", true)
            Json.put(out, "status", status())
            return out
        }
        val connectArgs = JSONObject(args.toString())
        if (!connectArgs.optBoolean("force_new_session", false)
                && sessionExpired(lastSession, SESSION_EXPIRY_GRACE_SECONDS)) {
            Json.put(connectArgs, "force_new_session", true)
        }
        event("ptt_connect_started", JSONObject().also {
            copyIfPresent(args, it, "ptt_turn_id")
            Json.put(it, "state_before", state)
            Json.put(it, "session_expired", sessionExpired(lastSession, SESSION_EXPIRY_GRACE_SECONDS))
        })
        val connected = connectInternal(connectArgs)
        Json.put(out, "connected_after", true)
        Json.put(out, "connect", connected)
        event("ptt_connected", JSONObject().also {
            copyIfPresent(args, it, "ptt_turn_id")
            Json.put(it, "room", connected.optString("room", ""))
            Json.put(it, "connected_at", connected.optString("connected_at", ""))
        })
        return out
    }

    fun pttStart(args: JSONObject): JSONObject = runBlocking(Dispatchers.IO) {
        val turnId = args.optString("ptt_turn_id").ifBlank { "ptt_${System.currentTimeMillis().toString(16)}" }
        val startDelayMs = args.optLong("start_delay_ms", PTT_START_DELAY_MS).coerceIn(0L, 500L)
        val pttArgs = JSONObject(args.toString())
        Json.put(pttArgs, "ptt_turn_id", turnId)
        val out = JSONObject()
        Json.put(out, "schema", "pucky.livekit_ptt_start.v2")
        Json.put(out, "ptt_turn_id", turnId)
        Json.put(out, "start_delay_ms", startDelayMs)
        event("ptt_start_requested", JSONObject().also {
            Json.put(it, "ptt_turn_id", turnId)
            Json.put(it, "state_before", state)
            Json.put(it, "mic_enabled_before", micEnabled)
        })
        var phase = "connect"
        try {
            Json.put(out, "connect", ensureConnectedInternal(pttArgs))
            Json.put(out, "local_ready_chime", disabledCoverChime("ready"))
            event("ptt_ready_chime_skipped", JSONObject().also {
                Json.put(it, "ptt_turn_id", turnId)
                Json.put(it, "kind", "ready")
                Json.put(it, "start_delay_ms", startDelayMs)
                Json.put(it, "reason", "quiet_cover_mode")
            })
            if (startDelayMs > 0) {
                delay(startDelayMs)
            }
            phase = "mic_enable"
            Json.put(out, "mic", setMicInternal(JSONObject().also {
                Json.put(it, "enabled", true)
                Json.put(it, "reason", "ptt_start")
                Json.put(it, "ptt_turn_id", turnId)
            }))
            val readyHaptic = hapticCue("ready")
            Json.put(out, "local_ready_haptic", readyHaptic)
            event("ptt_ready_haptic", JSONObject().also {
                Json.put(it, "ptt_turn_id", turnId)
                Json.put(it, "kind", "ready")
                Json.put(it, "played_locally", readyHaptic.optBoolean("played_locally", false))
                Json.put(it, "reason", readyHaptic.optString("reason", ""))
            })
            activePttTurnId = turnId
            Json.put(out, "status", "recording")
            event("ptt_turn_started", JSONObject().also {
                Json.put(it, "ptt_turn_id", turnId)
                Json.put(it, "room", lastSession?.optString("room") ?: "")
            })
            out
        } catch (exc: Exception) {
            pttFailed(turnId, phase, exc)
            throw exc
        }
    }

    fun pttStop(args: JSONObject): JSONObject = runBlocking(Dispatchers.IO) {
        val turnId = args.optString("ptt_turn_id").ifBlank {
            if (activePttTurnId.isBlank()) "ptt_${System.currentTimeMillis().toString(16)}" else activePttTurnId
        }
        val out = JSONObject()
        Json.put(out, "schema", "pucky.livekit_ptt_stop.v2")
        Json.put(out, "ptt_turn_id", turnId)
        event("ptt_stop_requested", JSONObject().also {
            Json.put(it, "ptt_turn_id", turnId)
            Json.put(it, "state_before", state)
            Json.put(it, "mic_enabled_before", micEnabled)
        })
        var phase = "mic_disable"
        try {
            Json.put(out, "mic", setMicInternal(JSONObject().also {
                Json.put(it, "enabled", false)
                Json.put(it, "reason", "ptt_stop")
                Json.put(it, "ptt_turn_id", turnId)
            }))
            event("ptt_turn_stopped", JSONObject().also {
                Json.put(it, "ptt_turn_id", turnId)
            })
            activePttTurnId = ""
            if (args.optBoolean("haptic_on_stop", false) || args.optBoolean("haptic", false)) {
                val sentHaptic = hapticCue("sent")
                Json.put(out, "local_sent_haptic", sentHaptic)
                event("ptt_sent_haptic", JSONObject().also {
                    Json.put(it, "ptt_turn_id", turnId)
                    Json.put(it, "kind", "sent")
                    Json.put(it, "played_locally", sentHaptic.optBoolean("played_locally", false))
                    Json.put(it, "reason", sentHaptic.optString("reason", ""))
                })
            } else {
                Json.put(out, "local_sent_haptic", JSONObject().also {
                    Json.put(it, "played_locally", false)
                    Json.put(it, "reason", "deferred_until_vox_turn_start")
                })
                event("ptt_sent_haptic_skipped", JSONObject().also {
                    Json.put(it, "ptt_turn_id", turnId)
                    Json.put(it, "reason", "deferred_until_vox_turn_start")
                })
            }
            Json.put(out, "local_sent_chime", disabledCoverChime("sent"))
            event("ptt_sent_chime_skipped", JSONObject().also {
                Json.put(it, "ptt_turn_id", turnId)
                Json.put(it, "kind", "sent")
                Json.put(it, "reason", "quiet_cover_mode")
            })
            Json.put(out, "status", "sent")
            out
        } catch (exc: Exception) {
            pttFailed(turnId, phase, exc)
            throw exc
        }
    }

    fun coverEvent(args: JSONObject): JSONObject {
        val detail = JSONObject(args.toString())
        val coverEventName = detail.optString("event").ifBlank {
            detail.optString("type").ifBlank { "cover_event" }
        }
        Json.put(detail, "event", coverEventName)
        Json.put(detail, "received_at", Instant.now().toString())
        if (coverEventName == "codex_turn_started"
            || coverEventName == "turn_accepted"
            || coverEventName == "turn_started"
        ) {
            val cue = hapticCue("sent")
            Json.put(detail, "local_haptic", cue)
        }
        event("cover_event", detail)
        val out = JSONObject()
        Json.put(out, "schema", "pucky.cover_event_result.v1")
        Json.put(out, "event", coverEventName)
        Json.put(out, "accepted", true)
        return out
    }

    @Synchronized
    fun eventsList(args: JSONObject): JSONObject {
        val limit = args.optInt("limit", 50).coerceIn(1, MAX_EVENTS)
        val all = eventsJson()
        val sliced = JSONArray()
        val start = (all.length() - limit).coerceAtLeast(0)
        for (i in start until all.length()) {
            Json.add(sliced, all.opt(i))
        }
        val out = JSONObject()
        Json.put(out, "schema", "pucky.livekit_events.v1")
        Json.put(out, "events", sliced)
        Json.put(out, "count", sliced.length())
        Json.put(out, "total_count", all.length())
        return out
    }

    @Synchronized
    fun eventsClear(): JSONObject {
        prefs.edit().putString(EVENTS, "[]").commit()
        val out = JSONObject()
        Json.put(out, "schema", "pucky.livekit_events_clear.v1")
        Json.put(out, "cleared", true)
        return out
    }

    fun outputGain(args: JSONObject): JSONObject {
        val changed = args.has("gain")
        if (changed) {
            val gain = args.optDouble("gain", DEFAULT_REMOTE_AUDIO_GAIN).coerceIn(0.0, 1.0)
            prefs.edit().putFloat(REMOTE_AUDIO_GAIN, gain.toFloat()).commit()
        }
        val applied = applyRemoteAudioGainToSubscribedTracks(if (changed) "gain_set" else "gain_get")
        val out = JSONObject()
        Json.put(out, "schema", "pucky.livekit_output_gain.v1")
        Json.put(out, "gain", remoteAudioGain())
        Json.put(out, "changed", changed)
        Json.put(out, "applied_track_count", applied)
        Json.put(out, "range", "0.0..1.0")
        return out
    }

    @Synchronized
    private fun storeSession(session: JSONObject) {
        val normalized = JSONObject(session.toString())
        if (!normalized.has("url") && normalized.has("server_url")) {
            Json.put(normalized, "url", normalized.optString("server_url"))
        }
        if (!normalized.has("token") && normalized.has("participant_token")) {
            Json.put(normalized, "token", normalized.optString("participant_token"))
        }
        if (!normalized.has("room") && normalized.has("room_name")) {
            Json.put(normalized, "room", normalized.optString("room_name"))
        }
        if (!normalized.has("identity") && normalized.has("participant_identity")) {
            Json.put(normalized, "identity", normalized.optString("participant_identity"))
        }
        lastSession = normalized
        prefs.edit().putString(SESSION, normalized.toString()).commit()
    }

    @Synchronized
    private fun loadSessionFromPrefs() {
        val raw = prefs.getString(SESSION, "").orEmpty()
        if (raw.isBlank()) {
            return
        }
        try {
            lastSession = JSONObject(raw)
        } catch (_: Exception) {
            lastSession = null
        }
    }

    private fun resolveSession(args: JSONObject): JSONObject {
        val inline = args.optJSONObject("session")
        if (inline != null) {
            storeSession(inline)
            return inline
        }
        if (args.optBoolean("force_new_session", false)
                || args.has("room_name")
                || args.has("participant_identity")
                || args.has("participant_name")
                || args.has("session_url")) {
            return requestSessionInternal(args)
        }
        if (args.has("url") || args.has("server_url") || args.has("token") || args.has("participant_token")) {
            val session = JSONObject()
            copyIfPresent(args, session, "url")
            copyIfPresent(args, session, "server_url")
            copyIfPresent(args, session, "token")
            copyIfPresent(args, session, "participant_token")
            copyIfPresent(args, session, "room")
            copyIfPresent(args, session, "room_name")
            copyIfPresent(args, session, "identity")
            copyIfPresent(args, session, "participant_identity")
            copyIfPresent(args, session, "participant_name")
            storeSession(session)
            return session
        }
        val existing = lastSession
        if (existing == null || sessionExpired(existing, SESSION_EXPIRY_GRACE_SECONDS)) {
            return requestSessionInternal(args)
        }
        return existing
    }

    private fun disconnectInternal(reason: String) {
        val activeRoom = room
        if (activeRoom != null) {
            try {
                activeRoom.disconnect()
            } catch (exc: Exception) {
                lastError = "${exc.javaClass.simpleName}: ${exc.message}"
            }
        }
        eventJob?.cancel()
        eventJob = null
        room = null
        micEnabled = false
        activePttTurnId = ""
        state = "disconnected"
        connectedAt = ""
        event("disconnected", JSONObject().also { Json.put(it, "reason", reason) })
    }

    @OptIn(Beta::class)
    private fun startEventCollection(activeRoom: Room) {
        eventJob?.cancel()
        eventJob = scope.launch {
            activeRoom.events.collect { roomEvent ->
                when (roomEvent) {
                    is RoomEvent.Connected -> event("sdk_connected", JSONObject())
                    is RoomEvent.Reconnecting -> {
                        state = "reconnecting"
                        event("sdk_reconnecting", JSONObject())
                    }
                    is RoomEvent.Reconnected -> {
                        state = if (micEnabled) "connected_talking" else "connected_muted"
                        event("sdk_reconnected", JSONObject())
                    }
                    is RoomEvent.Disconnected -> {
                        state = "disconnected"
                        micEnabled = false
                        event("sdk_disconnected", JSONObject().also {
                            Json.put(it, "reason", roomEvent.reason.toString())
                            Json.put(it, "error", roomEvent.error?.message ?: JSONObject.NULL)
                        })
                    }
                    is RoomEvent.ParticipantConnected -> event("participant_connected", JSONObject().also {
                        Json.put(it, "identity", roomEvent.participant.identity?.value ?: "")
                        Json.put(it, "name", roomEvent.participant.name ?: "")
                    })
                    is RoomEvent.ParticipantDisconnected -> event("participant_disconnected", JSONObject().also {
                        Json.put(it, "identity", roomEvent.participant.identity?.value ?: "")
                        Json.put(it, "name", roomEvent.participant.name ?: "")
                    })
                    is RoomEvent.TrackSubscribed -> event("track_subscribed", JSONObject().also {
                        val participantIdentity = roomEvent.participant.identity?.value ?: ""
                        Json.put(it, "participant", participantIdentity)
                        Json.put(it, "track", roomEvent.track.name)
                        val applied = applyRemoteAudioGain(roomEvent.track, participantIdentity, "track_subscribed")
                        if (applied != null) {
                            Json.put(it, "remote_audio_gain", applied)
                        }
                    })
                    is RoomEvent.TrackUnsubscribed -> event("track_unsubscribed", JSONObject().also {
                        Json.put(it, "participant", roomEvent.participant.identity?.value ?: "")
                    })
                    is RoomEvent.TranscriptionReceived -> event("transcription_received", transcriptionDetail(roomEvent))
                    is RoomEvent.FailedToConnect -> {
                        state = "failed"
                        lastError = roomEvent.error.message ?: roomEvent.error.toString()
                        event("sdk_failed_to_connect", JSONObject().also {
                            Json.put(it, "error", lastError)
                        })
                    }
                    else -> event("sdk_${roomEvent::class.simpleName}", JSONObject())
                }
            }
        }
    }

    @OptIn(Beta::class)
    private fun transcriptionDetail(roomEvent: RoomEvent.TranscriptionReceived): JSONObject {
        val detail = JSONObject()
        Json.put(detail, "participant", roomEvent.participant?.identity?.value ?: "")
        Json.put(detail, "publication_sid", roomEvent.publication?.sid ?: "")
        Json.put(detail, "segment_count", roomEvent.transcriptionSegments.size)
        val segments = JSONArray()
        for (segment in roomEvent.transcriptionSegments.take(8)) {
            Json.add(segments, JSONObject().also {
                Json.put(it, "id", segment.id)
                Json.put(it, "text", segment.text)
                Json.put(it, "language", segment.language)
                Json.put(it, "final", segment.final)
            })
        }
        Json.put(detail, "segments", segments)
        return detail
    }

    @Synchronized
    private fun event(name: String, detail: JSONObject) {
        val event = JSONObject()
        Json.put(event, "id", "lk_${System.currentTimeMillis().toString(16)}")
        Json.put(event, "schema", "pucky.livekit_event.v1")
        Json.put(event, "timestamp", Instant.now().toString())
        Json.put(event, "event", name)
        Json.put(event, "state", state)
        Json.put(event, "mic_enabled", micEnabled)
        Json.put(event, "detail", detail)
        appendEvent(event)
    }

    @Synchronized
    private fun fail(eventName: String, exc: Exception) {
        lastError = "${exc.javaClass.simpleName}: ${exc.message}"
        state = if (state == "connecting") "failed" else state
        event(eventName, JSONObject().also {
            Json.put(it, "error", lastError)
        })
    }

    @Synchronized
    private fun eventsJson(): JSONArray {
        return try {
            JSONArray(prefs.getString(EVENTS, "[]"))
        } catch (_: Exception) {
            JSONArray()
        }
    }

    @Synchronized
    private fun appendEvent(event: JSONObject) {
        val existing = eventsJson()
        val next = JSONArray()
        val start = (existing.length() - (MAX_EVENTS - 1)).coerceAtLeast(0)
        for (i in start until existing.length()) {
            Json.add(next, existing.opt(i))
        }
        Json.add(next, event)
        prefs.edit().putString(EVENTS, next.toString()).commit()
    }

    private fun isLiveKitConnected(): Boolean {
        return room != null && (state == "connected" || state == "connected_talking" || state == "connected_muted")
    }

    private fun remoteAudioGain(): Double {
        return prefs.getFloat(REMOTE_AUDIO_GAIN, DEFAULT_REMOTE_AUDIO_GAIN.toFloat())
            .toDouble()
            .coerceIn(0.0, 1.0)
    }

    private fun applyRemoteAudioGain(track: Any?, participantIdentity: String, reason: String): JSONObject? {
        val remoteTrack = track as? RemoteAudioTrack ?: return null
        val gain = remoteAudioGain()
        val out = JSONObject()
        Json.put(out, "schema", "pucky.livekit_remote_audio_gain_applied.v1")
        Json.put(out, "gain", gain)
        Json.put(out, "track", remoteTrack.name)
        Json.put(out, "participant", participantIdentity)
        Json.put(out, "reason", reason)
        return try {
            remoteTrack.setVolume(gain)
            Json.put(out, "ok", true)
            out
        } catch (exc: Exception) {
            Json.put(out, "ok", false)
            Json.put(out, "error", exc.javaClass.simpleName + ": " + (exc.message ?: ""))
            out
        }
    }

    private fun applyRemoteAudioGainToSubscribedTracks(reason: String): Int {
        val activeRoom = room ?: return 0
        var applied = 0
        for (participant in activeRoom.remoteParticipants.values) {
            for (publicationAndTrack in participant.audioTrackPublications) {
                val result = applyRemoteAudioGain(
                    publicationAndTrack.second,
                    participant.identity?.value ?: "",
                    reason
                )
                if (result?.optBoolean("ok", false) == true) {
                    applied += 1
                }
            }
        }
        if (applied > 0) {
            event("remote_audio_gain_reapplied", JSONObject().also {
                Json.put(it, "gain", remoteAudioGain())
                Json.put(it, "track_count", applied)
                Json.put(it, "reason", reason)
            })
        }
        return applied
    }

    private fun sessionExpired(session: JSONObject?, graceSeconds: Long): Boolean {
        if (session == null) {
            return true
        }
        val raw = session.optString("expires_at", "")
        if (raw.isBlank()) {
            return false
        }
        return try {
            val expiresAt = Instant.parse(raw)
            !expiresAt.isAfter(Instant.now().plusSeconds(graceSeconds))
        } catch (_: Exception) {
            true
        }
    }

    private fun disabledCoverChime(kind: String): JSONObject {
        val out = JSONObject()
        Json.put(out, "kind", kind)
        Json.put(out, "played_locally", false)
        Json.put(out, "disabled", true)
        Json.put(out, "reason", "quiet_cover_mode")
        return out
    }

    @Suppress("DEPRECATION")
    private fun hapticCue(kind: String): JSONObject {
        val out = JSONObject()
        Json.put(out, "schema", "pucky.livekit_haptic_cue.v1")
        Json.put(out, "kind", kind)
        val durationMs = 60L
        val amplitude = 255
        Json.put(out, "duration_ms", durationMs)
        Json.put(out, "amplitude", amplitude)
        return try {
            val vibrator = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                val manager = appContext.getSystemService(VibratorManager::class.java)
                manager?.defaultVibrator
            } else {
                appContext.getSystemService(Context.VIBRATOR_SERVICE) as? Vibrator
            }
            if (vibrator == null || !vibrator.hasVibrator()) {
                Json.put(out, "played_locally", false)
                Json.put(out, "reason", "no_vibrator")
                out
            } else {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    vibrator.vibrate(VibrationEffect.createOneShot(durationMs, amplitude))
                } else {
                    vibrator.vibrate(durationMs)
                }
                Json.put(out, "played_locally", true)
                Json.put(out, "reason", "ok")
                out
            }
        } catch (exc: Exception) {
            Json.put(out, "played_locally", false)
            Json.put(out, "reason", exc.javaClass.simpleName + ": " + (exc.message ?: ""))
            out
        }
    }

    private fun liveKitOverrides(): LiveKitOverrides {
        return LiveKitOverrides(
            audioOptions = AudioOptions(
                javaAudioDeviceModuleCustomizer = { builder ->
                    builder.setAudioSource(MediaRecorder.AudioSource.MIC)
                },
                disableAudioPrewarming = true
            )
        )
    }

    private fun pttFailed(turnId: String, phase: String, exc: Exception) {
        event("ptt_failed", JSONObject().also {
            Json.put(it, "ptt_turn_id", turnId)
            Json.put(it, "phase", phase)
            Json.put(it, "error", "${exc.javaClass.simpleName}: ${exc.message}")
        })
    }

    private fun defaultSessionUrl(): String {
        val uri = URI(settings.getBrokerUrl())
        val scheme = if (uri.scheme.equals("wss", ignoreCase = true)) "https" else "http"
        val path = "/api/pucky/devices/${settings.getDeviceId()}/livekit/session"
        return URI(scheme, null, uri.host, uri.port, path, null, null).toString()
    }

    private fun copyIfPresent(from: JSONObject, to: JSONObject, key: String) {
        if (from.has(key) && !from.isNull(key)) {
            Json.put(to, key, from.opt(key))
        }
    }

    companion object {
        private const val PREFS = "pucky_livekit"
        private const val EVENTS = "events_json"
        private const val SESSION = "session_json"
        private const val MAX_EVENTS = 200
        private const val SESSION_EXPIRY_GRACE_SECONDS = 30L
        private const val PTT_START_DELAY_MS = 0L
        private const val DEFAULT_REMOTE_AUDIO_GAIN = 0.75
        private const val REMOTE_AUDIO_GAIN = "remote_audio_gain"
        private val JSON = "application/json; charset=utf-8".toMediaType()

        @Volatile
        private var instance: LiveKitController? = null

        @JvmStatic
        fun shared(context: Context, settings: SettingsStore): LiveKitController {
            return instance ?: synchronized(this) {
                instance ?: LiveKitController(context.applicationContext, settings).also { instance = it }
            }
        }
    }
}
