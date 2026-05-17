#!/usr/bin/env python3
import argparse
import base64
import datetime as _dt
import json
import os
import pathlib
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid


RESULT_SCHEMA = "puckyctl.result.v1"
CONFIG_SCHEMA = "puckyctl.config.v1"
DEFAULT_CONFIG_PATH = pathlib.Path.home() / ".config" / "pucky" / "puckyctl.json"
DEFAULT_CONFIG = {
    "schema": CONFIG_SCHEMA,
    "broker_base_url": "http://127.0.0.1:8080",
    "operator_token_env": "PUCKY_OPERATOR_TOKEN",
    "operator_token": "operator-dev-token",
    "default_device_id": "",
    "evidence_dir": "/data/pucky/evidence",
    "default_timeout_ms": 30000,
    "default_output": "human",
}

TERMINAL_STATUSES = {
    "completed",
    "failed",
    "rejected",
    "device_offline",
    "send_failed",
}

QUIET_COMMANDS = [
    ("ping", {}),
    ("status.get", {}),
    ("battery.get", {}),
    ("network.get", {}),
    ("sensor.list", {}),
    ("storage.get", {}),
    ("log.tail", {"limit": 10}),
    ("capabilities.get", {}),
    ("permissions.get", {}),
    ("service.status", {}),
    ("power.policy.get", {}),
]

PHYSICAL_COMMANDS = {
    "notification": ("notify.show", {"title": "Pucky physical test", "text": "Notification path check"}),
    "audible-notification": ("notify.show", {"title": "Pucky audible test", "text": "Audible notification path check", "audible": True}),
    "audio": ("audio.tone", {"duration_ms": 150, "volume": 20}),
    "timer": ("timer.set", {"delay_ms": 1000, "title": "Pucky timer test", "text": "Timer path check"}),
    "torch": ("torch.set", {"enabled": True, "auto_off_ms": 1000}),
    "camera": ("photo.capture", {"max_width": 640}),
}


class CliError(Exception):
    def __init__(self, code, message, status=None, body=None, exit_code=1):
        super().__init__(message)
        self.code = code
        self.message = message
        self.status = status
        self.body = body
        self.exit_code = exit_code


def utc_now():
    return _dt.datetime.now(_dt.timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def load_json_file(path):
    try:
        with open(path, "r", encoding="utf-8") as handle:
            return json.load(handle)
    except FileNotFoundError:
        return {}


def extract_global_options(argv):
    opts = {}
    rest = []
    i = 0
    while i < len(argv):
        arg = argv[i]
        if rest:
            rest.append(arg)
            i += 1
            continue
        if arg == "--json":
            opts["default_output"] = "json"
        elif arg == "--human":
            opts["default_output"] = "human"
        elif arg in ("--broker", "--broker-base-url"):
            i += 1
            if i >= len(argv):
                raise CliError("ARGUMENT_ERROR", f"{arg} requires a value", exit_code=2)
            opts["broker_base_url"] = argv[i]
        elif arg.startswith("--broker="):
            opts["broker_base_url"] = arg.split("=", 1)[1]
        elif arg.startswith("--broker-base-url="):
            opts["broker_base_url"] = arg.split("=", 1)[1]
        elif arg in ("--token", "--operator-token"):
            i += 1
            if i >= len(argv):
                raise CliError("ARGUMENT_ERROR", f"{arg} requires a value", exit_code=2)
            opts["operator_token"] = argv[i]
        elif arg.startswith("--token="):
            opts["operator_token"] = arg.split("=", 1)[1]
        elif arg.startswith("--operator-token="):
            opts["operator_token"] = arg.split("=", 1)[1]
        elif arg in ("--device", "--device-id"):
            i += 1
            if i >= len(argv):
                raise CliError("ARGUMENT_ERROR", f"{arg} requires a value", exit_code=2)
            opts["default_device_id"] = argv[i]
        elif arg.startswith("--device="):
            opts["default_device_id"] = arg.split("=", 1)[1]
        elif arg.startswith("--device-id="):
            opts["default_device_id"] = arg.split("=", 1)[1]
        elif arg == "--evidence-dir":
            i += 1
            if i >= len(argv):
                raise CliError("ARGUMENT_ERROR", f"{arg} requires a value", exit_code=2)
            opts["evidence_dir"] = argv[i]
        elif arg.startswith("--evidence-dir="):
            opts["evidence_dir"] = arg.split("=", 1)[1]
        elif arg == "--timeout-ms":
            i += 1
            if i >= len(argv):
                raise CliError("ARGUMENT_ERROR", f"{arg} requires a value", exit_code=2)
            opts["default_timeout_ms"] = int(argv[i])
        elif arg.startswith("--timeout-ms="):
            opts["default_timeout_ms"] = int(arg.split("=", 1)[1])
        else:
            rest.extend(argv[i:])
            break
        i += 1
    return opts, rest


def build_context(global_opts):
    config_path = pathlib.Path(os.environ.get("PUCKYCTL_CONFIG", str(DEFAULT_CONFIG_PATH)))
    config = dict(DEFAULT_CONFIG)
    config.update(load_json_file(config_path))
    env_token_name = config.get("operator_token_env") or "PUCKY_OPERATOR_TOKEN"

    if os.environ.get("PUCKY_BROKER_BASE_URL"):
        config["broker_base_url"] = os.environ["PUCKY_BROKER_BASE_URL"]
    if os.environ.get(env_token_name):
        config["operator_token"] = os.environ[env_token_name]
    if os.environ.get("PUCKY_DEVICE_ID"):
        config["default_device_id"] = os.environ["PUCKY_DEVICE_ID"]
    if os.environ.get("PUCKY_EVIDENCE_DIR"):
        config["evidence_dir"] = os.environ["PUCKY_EVIDENCE_DIR"]

    config.update({key: value for key, value in global_opts.items() if value is not None})
    config["broker_base_url"] = str(config["broker_base_url"]).rstrip("/")
    config["default_timeout_ms"] = int(config.get("default_timeout_ms") or 30000)
    return config


def build_parser():
    parser = argparse.ArgumentParser(
        prog="puckyctl",
        description="VM-side CLI for the Pucky broker command API.",
    )
    sub = parser.add_subparsers(dest="resource")

    sub.add_parser("health")
    sub.add_parser("devices")

    device = sub.add_parser("device")
    device_sub = device.add_subparsers(dest="action")
    device_get = device_sub.add_parser("get")
    device_get.add_argument("device_id", nargs="?")

    caps = sub.add_parser("capabilities")
    caps.add_argument("device_id", nargs="?")
    caps.add_argument("--refresh", action="store_true", help="Ask the APK to refresh capabilities.get first.")
    add_command_flags(caps)

    perms = sub.add_parser("permissions")
    perms.add_argument("device_id", nargs="?")
    perms.add_argument("--refresh", action="store_true", help="Ask the APK to refresh permissions.get first.")
    add_command_flags(perms)

    hist = sub.add_parser("history")
    hist.add_argument("device_id", nargs="?")
    hist.add_argument("--limit", type=int, default=200)

    replies = sub.add_parser("replies")
    replies_sub = replies.add_subparsers(dest="action")
    replies_list = replies_sub.add_parser("list")
    replies_list.add_argument("device_id", nargs="?")
    replies_list.add_argument("--limit", type=int, default=50)
    replies_list.add_argument("--since-id", default="")
    replies_poll = replies_sub.add_parser("poll")
    replies_poll.add_argument("device_id", nargs="?")
    replies_poll.add_argument("--timeout-ms", type=int, default=120000)
    replies_poll.add_argument("--interval-ms", type=int, default=2000)
    replies_poll.add_argument("--since-id", default="")

    artifacts = sub.add_parser("artifacts")
    artifacts.add_argument("device_id", nargs="?")

    artifact = sub.add_parser("artifact")
    artifact_sub = artifact.add_subparsers(dest="action")
    artifact_get = artifact_sub.add_parser("get")
    artifact_get.add_argument("artifact_id")
    artifact_get.add_argument("device_id", nargs="?")

    command = sub.add_parser("command")
    command.add_argument("command_args", nargs=argparse.REMAINDER)

    for name in ("status", "battery", "network", "storage"):
        simple = sub.add_parser(name)
        add_command_flags(simple)

    location = sub.add_parser("location")
    location_sub = location.add_subparsers(dest="action")
    location_get = location_sub.add_parser("get")
    location_get.add_argument("--provider", default="")
    location_get.add_argument("--cached", action="store_true")
    location_get.add_argument("--timeout-ms", type=int, default=8000)
    add_command_flags(location_get)
    location_watch = location_sub.add_parser("watch")
    location_watch.add_argument("--duration-ms", type=int, default=15000)
    location_watch.add_argument("--interval-ms", type=int, default=5000)
    location_watch.add_argument("--min-distance-m", type=float, default=0.0)
    location_watch.add_argument("--max-samples", type=int, default=100)
    location_watch.add_argument("--trace-id", default="")
    add_command_flags(location_watch)

    logs = sub.add_parser("logs")
    logs_sub = logs.add_subparsers(dest="action")
    logs_tail = logs_sub.add_parser("tail")
    logs_tail.add_argument("--limit", type=int, default=50)
    add_command_flags(logs_tail)

    sensor = sub.add_parser("sensor")
    sensor_sub = sensor.add_subparsers(dest="action")
    sensor_list = sensor_sub.add_parser("list")
    add_command_flags(sensor_list)
    sensor_sample = sensor_sub.add_parser("sample")
    sensor_sample.add_argument("--type", type=int)
    sensor_sample.add_argument("--string-type")
    sensor_sample.add_argument("--events", type=int, default=3)
    sensor_sample.add_argument("--timeout", type=int, default=2000)
    sensor_sample.add_argument("--rate-us", type=int)
    add_command_flags(sensor_sample)

    camera = sub.add_parser("camera")
    camera_sub = camera.add_subparsers(dest="action")
    camera_info = camera_sub.add_parser("info")
    add_command_flags(camera_info)
    camera_photo = camera_sub.add_parser("photo")
    camera_photo.add_argument("--camera-id")
    camera_photo.add_argument("--max-width", type=int, default=640)
    camera_photo.add_argument("--timeout", type=int, default=8000)
    add_command_flags(camera_photo)

    torch = sub.add_parser("torch")
    torch_sub = torch.add_subparsers(dest="action")
    torch_on = torch_sub.add_parser("on")
    torch_on.add_argument("--camera-id")
    torch_on.add_argument("--auto-off", type=int, default=1000)
    add_command_flags(torch_on)
    torch_off = torch_sub.add_parser("off")
    torch_off.add_argument("--camera-id")
    add_command_flags(torch_off)

    notify = sub.add_parser("notify")
    notify_sub = notify.add_subparsers(dest="action")
    notify_show = notify_sub.add_parser("show")
    notify_show.add_argument("--title", default="Pucky")
    notify_show.add_argument("--text", default="Pucky notification")
    notify_show.add_argument("--channel")
    notify_show.add_argument("--silent", action="store_true")
    notify_show.add_argument("--audible", action="store_true")
    add_command_flags(notify_show)
    notify_ask = notify_sub.add_parser("ask")
    notify_ask.add_argument("--title", default="Pucky")
    notify_ask.add_argument("--text", default="Reply to Pucky")
    notify_ask.add_argument("--prompt-id", default="")
    notify_ask.add_argument("--reply-label", default="Reply")
    notify_ask.add_argument("--audible", action="store_true")
    notify_ask.add_argument("--silent", action="store_true")
    add_command_flags(notify_ask)
    notify_cancel = notify_sub.add_parser("cancel")
    notify_cancel.add_argument("--id", required=True)
    add_command_flags(notify_cancel)

    timer = sub.add_parser("timer")
    timer_sub = timer.add_subparsers(dest="action")
    timer_set = timer_sub.add_parser("set")
    timer_set.add_argument("--id")
    timer_set.add_argument("--in", dest="delay", required=True)
    timer_set.add_argument("--title", default="Pucky timer")
    timer_set.add_argument("--text", default="Timer done")
    add_command_flags(timer_set)
    timer_cancel = timer_sub.add_parser("cancel")
    timer_cancel.add_argument("--id", required=True)
    add_command_flags(timer_cancel)

    audio = sub.add_parser("audio")
    audio_sub = audio.add_subparsers(dest="action")
    audio_tone = audio_sub.add_parser("tone")
    audio_tone.add_argument("--duration", type=int, default=150)
    audio_tone.add_argument("--volume", type=int, default=20)
    audio_tone.add_argument("--tone", type=int)
    add_command_flags(audio_tone)

    audio_route = audio_sub.add_parser("route")
    add_command_flags(audio_route)
    audio_volume = audio_sub.add_parser("volume")
    audio_volume.add_argument("--level", type=int)
    audio_volume.add_argument("--percent", type=int)
    add_command_flags(audio_volume)

    voice = sub.add_parser("voice")
    voice_sub = voice.add_subparsers(dest="action")
    voice_status = voice_sub.add_parser("status")
    add_command_flags(voice_status)
    voice_start = voice_sub.add_parser("start")
    voice_start.add_argument("--session-id", default="")
    voice_start.add_argument("--max-duration-ms", type=int, default=30000)
    voice_start.add_argument("--audio-source", default="mic", choices=["mic", "voice_recognition", "voice_communication"])
    voice_start.add_argument("--sample-tag", default="")
    add_command_flags(voice_start)
    voice_stop = voice_sub.add_parser("stop")
    voice_stop.add_argument("--session-id", default="")
    voice_stop.add_argument("--reason", default="command_stop")
    add_command_flags(voice_stop)
    voice_last = voice_sub.add_parser("last")
    add_command_flags(voice_last)
    voice_list = voice_sub.add_parser("list")
    voice_list.add_argument("--limit", type=int, default=20)
    add_command_flags(voice_list)
    voice_delete = voice_sub.add_parser("delete")
    voice_delete.add_argument("session_id")
    voice_delete.add_argument("--keep-file", action="store_true")
    add_command_flags(voice_delete)

    speech = sub.add_parser("speech")
    speech_sub = speech.add_subparsers(dest="action")
    speech_status = speech_sub.add_parser("status")
    add_command_flags(speech_status)
    speech_start = speech_sub.add_parser("start")
    speech_start.add_argument("--session-id", default="")
    speech_start.add_argument("--language", default="")
    speech_start.add_argument("--prefer-offline", action="store_true")
    speech_start.add_argument("--no-partial-results", action="store_true")
    speech_start.add_argument("--start-delay-ms", type=int, default=150)
    speech_start.add_argument("--chime-volume", type=int, default=80)
    add_command_flags(speech_start)
    speech_stop = speech_sub.add_parser("stop")
    speech_stop.add_argument("--reason", default="command_stop")
    add_command_flags(speech_stop)
    speech_last = speech_sub.add_parser("last")
    add_command_flags(speech_last)
    speech_list = speech_sub.add_parser("list")
    speech_list.add_argument("--limit", type=int, default=20)
    add_command_flags(speech_list)
    speech_delete = speech_sub.add_parser("delete")
    speech_delete.add_argument("session_id")
    add_command_flags(speech_delete)

    livekit = sub.add_parser("livekit")
    livekit_sub = livekit.add_subparsers(dest="action")
    livekit_status = livekit_sub.add_parser("status")
    add_command_flags(livekit_status)
    livekit_session = livekit_sub.add_parser("session")
    livekit_session.add_argument("--room-name", default="")
    livekit_session.add_argument("--session-url", default="")
    add_command_flags(livekit_session)
    livekit_connect = livekit_sub.add_parser("connect")
    livekit_connect.add_argument("--url", default="")
    livekit_connect.add_argument("--token", default="")
    livekit_connect.add_argument("--room", default="")
    add_command_flags(livekit_connect)
    livekit_disconnect = livekit_sub.add_parser("disconnect")
    livekit_disconnect.add_argument("--reason", default="puckyctl_disconnect")
    add_command_flags(livekit_disconnect)
    livekit_mic = livekit_sub.add_parser("mic")
    livekit_mic.add_argument("state", choices=["on", "off"])
    livekit_mic.add_argument("--reason", default="puckyctl")
    add_command_flags(livekit_mic)
    livekit_ptt_start = livekit_sub.add_parser("ptt-start")
    livekit_ptt_start.add_argument("--room-name", default="")
    livekit_ptt_start.add_argument("--force-new-session", action="store_true")
    livekit_ptt_start.add_argument("--start-delay-ms", type=int, default=100)
    livekit_ptt_start.add_argument("--chime-volume", type=int, default=45)
    add_command_flags(livekit_ptt_start)
    livekit_ptt_stop = livekit_sub.add_parser("ptt-stop")
    livekit_ptt_stop.add_argument("--turn-id", default="")
    livekit_ptt_stop.add_argument("--chime-volume", type=int, default=45)
    add_command_flags(livekit_ptt_stop)
    livekit_events = livekit_sub.add_parser("events")
    livekit_events.add_argument("--limit", type=int, default=50)
    add_command_flags(livekit_events)
    livekit_clear = livekit_sub.add_parser("clear-events")
    add_command_flags(livekit_clear)
    livekit_gain = livekit_sub.add_parser("output-gain")
    livekit_gain.add_argument("--gain", type=float)
    add_command_flags(livekit_gain)

    media = sub.add_parser("media")
    media_sub = media.add_subparsers(dest="action")
    media_state = media_sub.add_parser("state")
    add_command_flags(media_state)
    media_key = media_sub.add_parser("key")
    media_key.add_argument("media_action", choices=["play_pause", "play", "pause", "next", "previous", "prev", "stop", "toggle"])
    add_command_flags(media_key)
    media_open = media_sub.add_parser("open-uri")
    media_open.add_argument("uri")
    media_open.add_argument("--mime-type", default="")
    media_open.add_argument("--require-resolvable", action="store_true")
    add_command_flags(media_open)
    media_export = media_sub.add_parser("export-audio")
    media_export.add_argument("path")
    media_export.add_argument("--display-name", default="")
    media_export.add_argument("--title", default="")
    media_export.add_argument("--mime-type", default="")
    add_command_flags(media_export)
    media_exports = media_sub.add_parser("exports")
    media_exports.add_argument("--limit", type=int, default=50)
    add_command_flags(media_exports)
    media_export_delete = media_sub.add_parser("export-delete")
    media_export_delete.add_argument("--content-uri", default="")
    media_export_delete.add_argument("--id", type=int)
    add_command_flags(media_export_delete)

    player = sub.add_parser("player")
    player_sub = player.add_subparsers(dest="action")
    player_prepare = player_sub.add_parser("prepare")
    player_prepare.add_argument("url")
    player_prepare.add_argument("--filename", default="")
    player_prepare.add_argument("--max-bytes", type=int, default=25 * 1024 * 1024)
    add_command_flags(player_prepare)
    player_load = player_sub.add_parser("load")
    player_load.add_argument("path")
    player_load.add_argument("--title", default="")
    player_load.add_argument("--source", default="")
    add_command_flags(player_load)
    player_play = player_sub.add_parser("play")
    player_play.add_argument("--path", default="")
    player_play.add_argument("--title", default="")
    player_play.add_argument("--source", default="")
    player_play.add_argument("--start-at-ms", type=int)
    add_command_flags(player_play)
    player_pause = player_sub.add_parser("pause")
    add_command_flags(player_pause)
    player_stop = player_sub.add_parser("stop")
    add_command_flags(player_stop)
    player_seek = player_sub.add_parser("seek")
    player_seek.add_argument("position_ms", type=int)
    add_command_flags(player_seek)
    player_state = player_sub.add_parser("state")
    add_command_flags(player_state)
    player_queue = player_sub.add_parser("queue-set")
    player_queue.add_argument("items", nargs="+", help="App-owned media artifact paths.")
    player_queue.add_argument("--index", type=int, default=0)
    player_queue.add_argument("--no-load", action="store_true")
    add_command_flags(player_queue)
    player_next = player_sub.add_parser("next")
    player_next.add_argument("--play", action="store_true")
    add_command_flags(player_next)
    player_previous = player_sub.add_parser("previous")
    player_previous.add_argument("--play", action="store_true")
    add_command_flags(player_previous)
    player_bookmark = player_sub.add_parser("bookmark")
    player_bookmark.add_argument("--id", default="")
    player_bookmark.add_argument("--note", default="")
    player_bookmark.add_argument("--position-ms", type=int)
    add_command_flags(player_bookmark)
    player_bookmarks = player_sub.add_parser("bookmarks")
    player_bookmarks.add_argument("--limit", type=int, default=50)
    add_command_flags(player_bookmarks)

    button = sub.add_parser("button")
    button_sub = button.add_subparsers(dest="action")
    button_state = button_sub.add_parser("state")
    add_command_flags(button_state)
    button_config = button_sub.add_parser("config")
    add_command_flags(button_config)
    button_set = button_sub.add_parser("config-set")
    button_set.add_argument("--enabled", choices=["true", "false"])
    button_set.add_argument("--double-press-ms", type=int)
    button_set.add_argument("--long-press-repeat-count", type=int)
    button_set.add_argument("--mapping", action="append", default=[], help="Gesture/action pair, e.g. volume_up_double=audio.tone")
    add_command_flags(button_set)
    button_reset = button_sub.add_parser("config-reset")
    add_command_flags(button_reset)
    button_events = button_sub.add_parser("events")
    button_events.add_argument("--limit", type=int, default=20)
    add_command_flags(button_events)
    button_clear = button_sub.add_parser("clear-events")
    add_command_flags(button_clear)
    button_sim = button_sub.add_parser("simulate")
    button_sim.add_argument("gesture", choices=[
        "volume_up_press",
        "volume_up_hold",
        "volume_up_hold_release",
        "volume_down_hold",
        "volume_down_press",
        "volume_up_double",
        "volume_down_double",
        "volume_both_press",
    ])
    add_command_flags(button_sim)

    system = sub.add_parser("system")
    system_sub = system.add_subparsers(dest="action")
    for name in ("runtime", "memory", "thermal"):
        item = system_sub.add_parser(name)
        add_command_flags(item)
    benchmark = system_sub.add_parser("benchmark")
    benchmark.add_argument("--iterations", type=int, default=5000)
    benchmark.add_argument("--max-ms", type=int, default=250)
    add_command_flags(benchmark)

    service = sub.add_parser("service")
    service_sub = service.add_subparsers(dest="action")
    service_status = service_sub.add_parser("status")
    add_command_flags(service_status)

    power = sub.add_parser("power")
    power_sub = power.add_subparsers(dest="action")
    power_policy = power_sub.add_parser("policy")
    add_command_flags(power_policy)

    artifact = sub.add_parser("artifact-local")
    artifact_sub = artifact.add_subparsers(dest="action")
    artifact_list = artifact_sub.add_parser("list")
    add_command_flags(artifact_list)
    artifact_hash = artifact_sub.add_parser("hash")
    artifact_hash.add_argument("--path", required=True)
    add_command_flags(artifact_hash)
    artifact_read = artifact_sub.add_parser("read")
    artifact_read.add_argument("--path", required=True)
    artifact_read.add_argument("--max-bytes", type=int, default=1024 * 1024)
    add_command_flags(artifact_read)
    artifact_delete = artifact_sub.add_parser("delete")
    artifact_delete.add_argument("--path", required=True)
    add_command_flags(artifact_delete)

    file_cmd = sub.add_parser("file")
    file_sub = file_cmd.add_subparsers(dest="action")
    file_download = file_sub.add_parser("download")
    file_download.add_argument("url")
    file_download.add_argument("--filename", default="")
    file_download.add_argument("--max-bytes", type=int, default=10 * 1024 * 1024)
    add_command_flags(file_download)
    file_put = file_sub.add_parser("put")
    file_put.add_argument("local_path")
    file_put.add_argument("--filename", default="")
    file_put.add_argument("--max-bytes", type=int, default=5 * 1024 * 1024)
    add_command_flags(file_put)

    app_update = sub.add_parser("app-update")
    app_update_sub = app_update.add_subparsers(dest="action")
    app_update_install = app_update_sub.add_parser("install")
    app_update_install.add_argument("--path", required=True)
    app_update_install.add_argument("--max-bytes", type=int, default=100 * 1024 * 1024)
    app_update_install.add_argument("--no-open-settings", action="store_true")
    add_command_flags(app_update_install)

    settings = sub.add_parser("settings")
    settings_sub = settings.add_subparsers(dest="action")
    settings_open = settings_sub.add_parser("open")
    settings_open.add_argument("target")
    add_command_flags(settings_open)

    browser = sub.add_parser("browser")
    browser_sub = browser.add_subparsers(dest="action")
    browser_open = browser_sub.add_parser("open")
    browser_open.add_argument("url")
    add_command_flags(browser_open)

    share = sub.add_parser("share")
    share_sub = share.add_subparsers(dest="action")
    share_text = share_sub.add_parser("text")
    share_text.add_argument("text")
    share_text.add_argument("--title", default="Share with")
    add_command_flags(share_text)

    note = sub.add_parser("note")
    note_sub = note.add_subparsers(dest="action")
    note_create = note_sub.add_parser("create")
    note_create.add_argument("--title", default="")
    note_create.add_argument("--body", default="")
    note_create.add_argument("--id")
    add_command_flags(note_create)
    note_list = note_sub.add_parser("list")
    note_list.add_argument("--limit", type=int, default=50)
    add_command_flags(note_list)
    note_delete = note_sub.add_parser("delete")
    note_delete.add_argument("--id", required=True)
    add_command_flags(note_delete)

    intent = sub.add_parser("intent")
    intent_sub = intent.add_subparsers(dest="action")
    alarm = intent_sub.add_parser("alarm")
    alarm.add_argument("--hour", type=int, required=True)
    alarm.add_argument("--minutes", type=int, required=True)
    alarm.add_argument("--message", default="Pucky alarm")
    alarm.add_argument("--skip-ui", action="store_true")
    add_command_flags(alarm)
    calendar = intent_sub.add_parser("calendar")
    calendar.add_argument("--title", required=True)
    calendar.add_argument("--description", default="")
    calendar.add_argument("--location", default="")
    calendar.add_argument("--begin-ms", type=int)
    calendar.add_argument("--end-ms", type=int)
    add_command_flags(calendar)
    dial = intent_sub.add_parser("dial")
    dial.add_argument("--number", default="")
    add_command_flags(dial)

    test = sub.add_parser("test")
    test_sub = test.add_subparsers(dest="suite")
    quiet = test_sub.add_parser("quiet")
    quiet.add_argument("--strict", action="store_true")
    quiet.add_argument("--no-evidence", action="store_true")
    physical = test_sub.add_parser("physical")
    physical.add_argument("--allow", required=True, help="Comma-separated physical actions: notification,audible-notification,audio,timer,torch,camera")
    physical.add_argument("--no-evidence", action="store_true")

    for name in ("unplugged", "sensors", "lifecycle", "reconnect", "storage", "settings-panels"):
        placeholder = test_sub.add_parser(name)
        placeholder.add_argument("--manual", action="store_true")

    return parser


def add_command_flags(parser):
    parser.add_argument("--wait", action="store_true")
    parser.add_argument("--no-wait", action="store_true")
    parser.add_argument("--ttl-ms", type=int, default=30000)
    parser.add_argument("--evidence", action="store_true")
    parser.add_argument("--no-evidence", action="store_true")


def broker_json(ctx, method, path, body=None):
    url = ctx["broker_base_url"] + path
    data = None
    headers = {"accept": "application/json"}
    token = ctx.get("operator_token")
    if token:
        headers["authorization"] = "Bearer " + token
    if body is not None:
        data = json.dumps(body, separators=(",", ":")).encode("utf-8")
        headers["content-type"] = "application/json"
    request = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(request, timeout=max(1, ctx["default_timeout_ms"] / 1000.0)) as response:
            return response.status, read_response_json(response)
    except urllib.error.HTTPError as exc:
        return exc.code, read_response_json(exc)
    except urllib.error.URLError as exc:
        raise CliError("BROKER_UNAVAILABLE", str(exc.reason), body={"url": url})


def read_response_json(response):
    text = response.read().decode("utf-8", errors="replace")
    if not text:
        return {}
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        return {"raw": text}


def api_health(ctx):
    status, body = broker_json(ctx, "GET", "/health")
    if status == 404:
        status, body = broker_json(ctx, "GET", "/healthz")
    if status == 404:
        status, body = broker_json(ctx, "GET", "/api/pucky/health")
    require_status(status, body, "HEALTH_FAILED")
    return body


def api_devices(ctx):
    status, body = broker_json(ctx, "GET", "/v1/devices")
    if status == 404:
        status, body = broker_json(ctx, "GET", "/devices")
    require_status(status, body, "DEVICES_FAILED")
    return body.get("devices") or []


def api_device(ctx, device_id):
    status, body = broker_json(ctx, "GET", "/v1/devices/" + quote(device_id))
    require_status(status, body, "DEVICE_GET_FAILED")
    return body


def api_history(ctx, device_id=None, limit=200):
    if device_id:
        path = f"/v1/devices/{quote(device_id)}/history?limit={int(limit)}"
    else:
        path = f"/history?limit={int(limit)}"
    status, body = broker_json(ctx, "GET", path)
    require_status(status, body, "HISTORY_FAILED")
    return body


def api_replies(ctx, device_id, limit=50, since_id=""):
    query = {"limit": int(limit)}
    if since_id:
        query["since_id"] = since_id
    path = f"/v1/devices/{quote(device_id)}/replies?" + urllib.parse.urlencode(query)
    status, body = broker_json(ctx, "GET", path)
    require_status(status, body, "REPLIES_FAILED")
    return body


def api_capabilities(ctx, device_id):
    status, body = broker_json(ctx, "GET", f"/v1/devices/{quote(device_id)}/capabilities")
    require_status(status, body, "CAPABILITIES_FAILED")
    return body


def api_permissions(ctx, device_id):
    status, body = broker_json(ctx, "GET", f"/v1/devices/{quote(device_id)}/permissions")
    require_status(status, body, "PERMISSIONS_FAILED")
    return body


def api_artifacts(ctx, device_id):
    status, body = broker_json(ctx, "GET", f"/v1/devices/{quote(device_id)}/artifacts")
    require_status(status, body, "ARTIFACTS_FAILED")
    return body


def api_artifact(ctx, device_id, artifact_id):
    path = f"/v1/devices/{quote(device_id)}/artifacts/{quote(artifact_id)}"
    status, body = broker_json(ctx, "GET", path)
    require_status(status, body, "ARTIFACT_GET_FAILED")
    return body


def api_test_run(ctx, body):
    status, response = broker_json(ctx, "POST", "/v1/test-runs", body)
    if status == 404:
        return None
    require_status(status, response, "TEST_RUN_RECORD_FAILED", expected=(200, 201))
    return response.get("test_run")


def send_command(ctx, device_id, command_type, args, ttl_ms=30000, command_id=None):
    body = {
        "id": command_id or "cmd_" + str(uuid.uuid4()),
        "type": command_type,
        "args": args or {},
        "ttl_ms": ttl_ms,
        "created_at": utc_now(),
    }
    status, response = broker_json(ctx, "POST", f"/v1/devices/{quote(device_id)}/commands", body)
    if status == 404:
        status, response = broker_json(ctx, "POST", f"/devices/{quote(device_id)}/commands", body)
    if status not in (200, 202, 409):
        require_status(status, response, "COMMAND_SEND_FAILED", expected=(200, 202, 409))
    command = response.get("command") or response
    if status == 409:
        command.setdefault("status", "device_offline")
        command.setdefault("error", {"code": response.get("error") or "DEVICE_OFFLINE", "message": "Device is offline"})
    return command


def get_command(ctx, command_id, device_id=None):
    status, body = broker_json(ctx, "GET", "/v1/commands/" + quote(command_id))
    if status == 404 and device_id:
        path = f"/v1/devices/{quote(device_id)}/commands/{quote(command_id)}"
        status, body = broker_json(ctx, "GET", path)
    if status == 404 and device_id:
        path = f"/devices/{quote(device_id)}/commands/{quote(command_id)}"
        status, body = broker_json(ctx, "GET", path)
    require_status(status, body, "COMMAND_GET_FAILED")
    return body


def wait_command(ctx, command_id, device_id=None, timeout_ms=None):
    timeout_ms = int(timeout_ms or ctx["default_timeout_ms"])
    deadline = time.monotonic() + timeout_ms / 1000.0
    last = None
    while True:
        last = get_command(ctx, command_id, device_id=device_id)
        if last.get("status") in TERMINAL_STATUSES:
            return last
        if time.monotonic() >= deadline:
            last = dict(last)
            last["wait_error"] = {"code": "WAIT_TIMEOUT", "message": f"Timed out after {timeout_ms} ms"}
            return last
        time.sleep(0.5)


def require_status(status, body, code, expected=(200,)):
    if status not in expected:
        message = body.get("error") if isinstance(body, dict) else None
        if not message:
            message = f"Unexpected HTTP status {status}"
        raise CliError(code, str(message), status=status, body=body)


def quote(value):
    return urllib.parse.quote(str(value), safe="")


def resolve_device_id(ctx, explicit=None):
    if explicit:
        return explicit
    if ctx.get("default_device_id"):
        return ctx["default_device_id"]
    devices = api_devices(ctx)
    online = [device for device in devices if device.get("online")]
    if len(online) == 1:
        return online[0]["device_id"]
    if len(devices) == 1:
        return devices[0]["device_id"]
    raise CliError(
        "DEVICE_REQUIRED",
        "Provide --device/--device-id, set PUCKY_DEVICE_ID, or configure default_device_id.",
        body={"devices": devices},
    )


def parse_arg_value(raw):
    lowered = raw.lower()
    if lowered == "true":
        return True
    if lowered == "false":
        return False
    if lowered == "null":
        return None
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        return raw


def parse_key_values(values):
    out = {}
    for value in values or []:
        if "=" not in value:
            raise CliError("ARGUMENT_ERROR", f"--arg requires key=value, got {value!r}", exit_code=2)
        key, raw = value.split("=", 1)
        key = key.strip()
        if not key:
            raise CliError("ARGUMENT_ERROR", "--arg key cannot be empty", exit_code=2)
        out[key] = parse_arg_value(raw)
    return out


def parse_args_json(text):
    if not text:
        return {}
    try:
        value = json.loads(text)
    except json.JSONDecodeError as exc:
        raise CliError("ARGUMENT_ERROR", f"--args-json is invalid JSON: {exc}", exit_code=2)
    if not isinstance(value, dict):
        raise CliError("ARGUMENT_ERROR", "--args-json must decode to an object", exit_code=2)
    return value


def merge_command_args(args_json, key_values):
    merged = parse_args_json(args_json)
    merged.update(parse_key_values(key_values))
    return merged


def parse_duration_ms(value):
    text = str(value).strip().lower()
    match = re.fullmatch(r"(\d+(?:\.\d+)?)(ms|s|m|h)?", text)
    if not match:
        raise CliError("ARGUMENT_ERROR", f"Invalid duration: {value}", exit_code=2)
    amount = float(match.group(1))
    unit = match.group(2) or "s"
    factor = {"ms": 1, "s": 1000, "m": 60000, "h": 3600000}[unit]
    return int(round(amount * factor))


def command_result(command, started_at=None):
    result_message = command.get("result") if isinstance(command.get("result"), dict) else None
    ack_message = command.get("ack") if isinstance(command.get("ack"), dict) else None
    status = command.get("status")
    payload = result_message.get("result") if result_message else None
    error = command.get("error")
    if not error and result_message:
        error = result_message.get("error")
    if not error and ack_message:
        error = ack_message.get("error")
    if command.get("wait_error"):
        error = command["wait_error"]
    ok = status == "completed" and not command.get("wait_error")
    duration_ms = None
    if started_at is not None:
        duration_ms = int(round((time.monotonic() - started_at) * 1000))
    return {
        "schema": RESULT_SCHEMA,
        "ok": ok,
        "device_id": command.get("device_id"),
        "command_id": command.get("id"),
        "type": command.get("type"),
        "status": status,
        "duration_ms": duration_ms,
        "result": payload,
        "error": error,
        "evidence": None,
    }


def plain_result(ok, kind, result=None, error=None, device_id=None, command_id=None, command_type=None):
    return {
        "schema": RESULT_SCHEMA,
        "ok": bool(ok),
        "kind": kind,
        "device_id": device_id,
        "command_id": command_id,
        "type": command_type,
        "status": "completed" if ok else "failed",
        "duration_ms": None,
        "result": result if result is not None else {},
        "error": error,
        "evidence": None,
    }


def write_evidence(ctx, result, label=None):
    evidence_dir = pathlib.Path(ctx["evidence_dir"])
    stamp = _dt.datetime.now(_dt.timezone.utc).strftime("%Y%m%d-%H%M%SZ")
    name_bits = [stamp, label or result.get("type") or result.get("kind") or "result"]
    if result.get("command_id"):
        name_bits.append(result["command_id"])
    safe_name = "-".join(safe_filename(bit) for bit in name_bits if bit) + ".json"
    try:
        evidence_dir.mkdir(parents=True, exist_ok=True)
        path = evidence_dir / safe_name
        document = {
            "schema": "puckyctl.evidence.v1",
            "created_at": utc_now(),
            "broker_base_url": ctx["broker_base_url"],
            "result": result,
        }
        with open(path, "w", encoding="utf-8") as handle:
            json.dump(document, handle, indent=2, sort_keys=True)
            handle.write("\n")
        return {"path": str(path)}
    except OSError as exc:
        return {"error": {"code": "EVIDENCE_WRITE_FAILED", "message": str(exc), "path": str(evidence_dir)}}


def safe_filename(value):
    return re.sub(r"[^A-Za-z0-9_.-]+", "_", str(value)).strip("._")[:80] or "item"


def should_wait(args, default):
    if getattr(args, "no_wait", False):
        return False
    if getattr(args, "wait", False):
        return True
    return default


def should_write_evidence(args, default=False):
    if getattr(args, "no_evidence", False):
        return False
    if getattr(args, "evidence", False):
        return True
    return default


def run_command(ctx, device_id, command_type, args, parsed_args, wait_default=True, evidence_default=False):
    device_id = resolve_device_id(ctx, device_id)
    started = time.monotonic()
    command = send_command(ctx, device_id, command_type, args, ttl_ms=getattr(parsed_args, "ttl_ms", 30000))
    if should_wait(parsed_args, wait_default) and command.get("id") and command.get("status") not in TERMINAL_STATUSES:
        command = wait_command(ctx, command["id"], device_id=device_id)
    result = command_result(command, started_at=started)
    if should_write_evidence(parsed_args, evidence_default):
        result["evidence"] = write_evidence(ctx, result)
    return result


def run_command_remainder(ctx, rest):
    if not rest:
        raise CliError("ARGUMENT_ERROR", "command requires get, send, wait, replay, or a command type", exit_code=2)
    action = rest[0]
    if action == "get":
        parser = argparse.ArgumentParser(prog="puckyctl command get")
        parser.add_argument("command_id")
        parser.add_argument("device_id", nargs="?")
        args = parser.parse_args(rest[1:])
        command = get_command(ctx, args.command_id, device_id=args.device_id or ctx.get("default_device_id") or None)
        return command_result(command)
    if action == "wait":
        parser = argparse.ArgumentParser(prog="puckyctl command wait")
        parser.add_argument("command_id")
        parser.add_argument("device_id", nargs="?")
        parser.add_argument("--timeout-ms", type=int)
        parser.add_argument("--evidence", action="store_true")
        parser.add_argument("--no-evidence", action="store_true")
        args = parser.parse_args(rest[1:])
        started = time.monotonic()
        command = wait_command(ctx, args.command_id, device_id=args.device_id or ctx.get("default_device_id") or None, timeout_ms=args.timeout_ms)
        result = command_result(command, started_at=started)
        if should_write_evidence(args):
            result["evidence"] = write_evidence(ctx, result)
        return result
    if action == "replay":
        parser = argparse.ArgumentParser(prog="puckyctl command replay")
        parser.add_argument("command_id")
        parser.add_argument("--device-id")
        add_command_flags(parser)
        args = parser.parse_args(rest[1:])
        original = get_command(ctx, args.command_id, device_id=args.device_id or ctx.get("default_device_id") or None)
        return run_command(ctx, args.device_id or original.get("device_id"), original["type"], original.get("args") or {}, args, wait_default=True)
    if action == "send":
        return run_command_send(ctx, rest[1:], direct=False)
    return run_command_send(ctx, rest, direct=True)


def run_command_send(ctx, rest, direct=False):
    parser = argparse.ArgumentParser(prog="puckyctl command" + ("" if direct else " send"))
    parser.add_argument("positionals", nargs="+")
    parser.add_argument("--args-json")
    parser.add_argument("--arg", action="append", default=[])
    parser.add_argument("--id")
    parser.add_argument("--device-id")
    add_command_flags(parser)
    args = parser.parse_args(rest)
    if direct:
        if len(args.positionals) != 1:
            raise CliError("ARGUMENT_ERROR", "direct command form accepts exactly one command type", exit_code=2)
        device_id = args.device_id
        command_type = args.positionals[0]
    else:
        if len(args.positionals) == 1:
            device_id = args.device_id
            command_type = args.positionals[0]
        elif len(args.positionals) == 2:
            device_id = args.device_id or args.positionals[0]
            command_type = args.positionals[1]
        else:
            raise CliError("ARGUMENT_ERROR", "send requires [device_id] <type>", exit_code=2)
    payload = merge_command_args(args.args_json, args.arg)
    device_id = resolve_device_id(ctx, device_id)
    started = time.monotonic()
    command = send_command(ctx, device_id, command_type, payload, ttl_ms=args.ttl_ms, command_id=args.id)
    if should_wait(args, default=False) and command.get("id") and command.get("status") not in TERMINAL_STATUSES:
        command = wait_command(ctx, command["id"], device_id=device_id)
    result = command_result(command, started_at=started)
    if should_write_evidence(args):
        result["evidence"] = write_evidence(ctx, result)
    return result


def dispatch(ctx, args):
    if args.resource == "health":
        return plain_result(True, "health", api_health(ctx))
    if args.resource == "devices":
        return plain_result(True, "devices", {"devices": api_devices(ctx)})
    if args.resource == "device":
        require_action(args.action, "device")
        device_id = resolve_device_id(ctx, args.device_id)
        return plain_result(True, "device", api_device(ctx, device_id), device_id=device_id)
    if args.resource == "history":
        device_id = args.device_id
        return plain_result(True, "history", api_history(ctx, device_id=device_id, limit=args.limit), device_id=device_id)
    if args.resource == "replies":
        require_action(args.action, "replies")
        device_id = resolve_device_id(ctx, args.device_id)
        if args.action == "list":
            return plain_result(
                True,
                "replies",
                api_replies(ctx, device_id, limit=args.limit, since_id=args.since_id),
                device_id=device_id,
            )
        deadline = time.monotonic() + max(1, args.timeout_ms) / 1000.0
        last = None
        while True:
            body = api_replies(ctx, device_id, limit=1, since_id=args.since_id)
            replies = body.get("replies") or []
            if replies:
                return plain_result(True, "replies", body, device_id=device_id)
            last = body
            if time.monotonic() >= deadline:
                return plain_result(
                    False,
                    "replies",
                    last,
                    error={"code": "REPLY_TIMEOUT", "message": f"No reply received after {args.timeout_ms} ms"},
                    device_id=device_id,
                )
            time.sleep(max(250, args.interval_ms) / 1000.0)
    if args.resource == "artifacts":
        device_id = resolve_device_id(ctx, args.device_id)
        return plain_result(True, "artifacts", api_artifacts(ctx, device_id), device_id=device_id)
    if args.resource == "artifact":
        require_action(args.action, "artifact")
        device_id = resolve_device_id(ctx, args.device_id)
        return plain_result(True, "artifact", api_artifact(ctx, device_id, args.artifact_id), device_id=device_id)
    if args.resource == "capabilities":
        device_id = resolve_device_id(ctx, args.device_id)
        probe = None
        if args.refresh:
            probe = run_command(ctx, device_id, "capabilities.get", {}, args, wait_default=True)
        body = api_capabilities(ctx, device_id)
        if probe is not None:
            body["probe"] = probe
        ok = probe is None or probe["ok"]
        return plain_result(ok, "capabilities", body, error=None if ok else probe.get("error"), device_id=device_id)
    if args.resource == "permissions":
        device_id = resolve_device_id(ctx, args.device_id)
        probe = None
        if args.refresh:
            probe = run_command(ctx, device_id, "permissions.get", {}, args, wait_default=True)
        body = api_permissions(ctx, device_id)
        if probe is not None:
            body["probe"] = probe
        ok = probe is None or probe["ok"]
        return plain_result(ok, "permissions", body, error=None if ok else probe.get("error"), device_id=device_id)
    if args.resource == "command":
        return run_command_remainder(ctx, args.command_args)
    if args.resource in ("status", "battery", "network", "storage"):
        return run_command(ctx, None, f"{args.resource}.get", {}, args, wait_default=True)
    if args.resource == "location":
        require_action(args.action, "location")
        if args.action == "get":
            payload = {
                "fresh": not args.cached,
                "timeout_ms": args.timeout_ms,
            }
            if args.provider:
                payload["provider"] = args.provider
            return run_command(ctx, None, "location.get", payload, args, wait_default=True)
        payload = {
            "duration_ms": args.duration_ms,
            "interval_ms": args.interval_ms,
            "min_distance_m": args.min_distance_m,
            "max_samples": args.max_samples,
        }
        if args.trace_id:
            payload["trace_id"] = args.trace_id
        return run_command(ctx, None, "location.watch", payload, args, wait_default=True)
    if args.resource == "logs":
        require_action(args.action, "logs")
        return run_command(ctx, None, "log.tail", {"limit": args.limit}, args, wait_default=True)
    if args.resource == "sensor":
        require_action(args.action, "sensor")
        if args.action == "list":
            return run_command(ctx, None, "sensor.list", {}, args, wait_default=True)
        payload = {"max_events": args.events, "timeout_ms": args.timeout}
        if args.type is not None:
            payload["type"] = args.type
        if args.string_type:
            payload["string_type"] = args.string_type
        if args.rate_us is not None:
            payload["rate_us"] = args.rate_us
        return run_command(ctx, None, "sensor.sample", payload, args, wait_default=True)
    if args.resource == "camera":
        require_action(args.action, "camera")
        if args.action == "info":
            return run_command(ctx, None, "camera.info", {}, args, wait_default=True)
        payload = {"max_width": args.max_width, "timeout_ms": args.timeout}
        if args.camera_id:
            payload["camera_id"] = args.camera_id
        return run_command(ctx, None, "photo.capture", payload, args, wait_default=True, evidence_default=True)
    if args.resource == "torch":
        require_action(args.action, "torch")
        payload = {"enabled": args.action == "on"}
        if args.action == "on":
            payload["auto_off_ms"] = args.auto_off
        if args.camera_id:
            payload["camera_id"] = args.camera_id
        return run_command(ctx, None, "torch.set", payload, args, wait_default=True)
    if args.resource == "notify":
        require_action(args.action, "notify")
        if args.action == "show":
            payload = {"title": args.title, "text": args.text}
            if args.channel:
                payload["channel"] = args.channel
            if args.silent:
                payload["silent"] = True
            if args.audible:
                payload["audible"] = True
            return run_command(ctx, None, "notify.show", payload, args, wait_default=True)
        if args.action == "ask":
            payload = {
                "title": args.title,
                "text": args.text,
                "reply_label": args.reply_label,
            }
            if args.prompt_id:
                payload["prompt_id"] = args.prompt_id
            if args.silent:
                payload["silent"] = True
            if args.audible:
                payload["audible"] = True
            return run_command(ctx, None, "notify.ask", payload, args, wait_default=True)
        return run_command(ctx, None, "notify.cancel", {"id": args.id}, args, wait_default=True)
    if args.resource == "timer":
        require_action(args.action, "timer")
        if args.action == "set":
            payload = {"delay_ms": parse_duration_ms(args.delay), "title": args.title, "text": args.text}
            if args.id:
                payload["id"] = args.id
            return run_command(ctx, None, "timer.set", payload, args, wait_default=True)
        return run_command(ctx, None, "timer.cancel", {"id": args.id}, args, wait_default=True)
    if args.resource == "audio":
        require_action(args.action, "audio")
        if args.action == "route":
            return run_command(ctx, None, "audio.route.get", {}, args, wait_default=True)
        if args.action == "volume":
            payload = {}
            if args.level is not None:
                payload["level"] = args.level
            if args.percent is not None:
                payload["percent"] = args.percent
            return run_command(ctx, None, "audio.volume.set", payload, args, wait_default=True)
        payload = {"duration_ms": args.duration, "volume": args.volume}
        if args.tone is not None:
            payload["tone"] = args.tone
        return run_command(ctx, None, "audio.tone", payload, args, wait_default=True)
    if args.resource == "voice":
        require_action(args.action, "voice")
        if args.action == "status":
            return run_command(ctx, None, "voice.capture.status", {}, args, wait_default=True)
        if args.action == "start":
            payload = {
                "max_duration_ms": args.max_duration_ms,
                "audio_source": args.audio_source,
            }
            if args.session_id:
                payload["session_id"] = args.session_id
            if args.sample_tag:
                payload["sample_tag"] = args.sample_tag
            return run_command(ctx, None, "voice.capture.start", payload, args, wait_default=True)
        if args.action == "stop":
            payload = {"reason": args.reason}
            if args.session_id:
                payload["session_id"] = args.session_id
            return run_command(ctx, None, "voice.capture.stop", payload, args, wait_default=True, evidence_default=True)
        if args.action == "last":
            return run_command(ctx, None, "voice.capture.last", {}, args, wait_default=True)
        if args.action == "list":
            return run_command(ctx, None, "voice.capture.list", {"limit": args.limit}, args, wait_default=True)
        return run_command(ctx, None, "voice.capture.delete", {
            "session_id": args.session_id,
            "delete_file": not args.keep_file,
        }, args, wait_default=True)
    if args.resource == "speech":
        require_action(args.action, "speech")
        if args.action == "status":
            return run_command(ctx, None, "speech.native.status", {}, args, wait_default=True)
        if args.action == "start":
            payload = {
                "partial_results": not args.no_partial_results,
                "prefer_offline": args.prefer_offline,
                "start_delay_ms": args.start_delay_ms,
                "chime_volume": args.chime_volume,
            }
            if args.session_id:
                payload["session_id"] = args.session_id
            if args.language:
                payload["language"] = args.language
            return run_command(ctx, None, "speech.native.start", payload, args, wait_default=True)
        if args.action == "stop":
            return run_command(ctx, None, "speech.native.stop", {"reason": args.reason}, args, wait_default=True)
        if args.action == "last":
            return run_command(ctx, None, "speech.native.last", {}, args, wait_default=True)
        if args.action == "list":
            return run_command(ctx, None, "speech.native.list", {"limit": args.limit}, args, wait_default=True)
        return run_command(ctx, None, "speech.native.delete", {"session_id": args.session_id}, args, wait_default=True)
    if args.resource == "livekit":
        require_action(args.action, "livekit")
        if args.action == "status":
            return run_command(ctx, None, "livekit.status", {}, args, wait_default=True)
        if args.action == "session":
            payload = {}
            if args.room_name:
                payload["room_name"] = args.room_name
            if args.session_url:
                payload["session_url"] = args.session_url
            return run_command(ctx, None, "livekit.session.request", payload, args, wait_default=True)
        if args.action == "connect":
            payload = {}
            if args.url:
                payload["url"] = args.url
            if args.token:
                payload["token"] = args.token
            if args.room:
                payload["room"] = args.room
            return run_command(ctx, None, "livekit.connect", payload, args, wait_default=True)
        if args.action == "disconnect":
            return run_command(ctx, None, "livekit.disconnect", {"reason": args.reason}, args, wait_default=True)
        if args.action == "mic":
            return run_command(ctx, None, "livekit.mic.set", {
                "enabled": args.state == "on",
                "reason": args.reason,
            }, args, wait_default=True)
        if args.action == "ptt-start":
            payload = {
                "force_new_session": bool(args.force_new_session),
                "start_delay_ms": args.start_delay_ms,
                "chime_volume": args.chime_volume,
            }
            if args.room_name:
                payload["room_name"] = args.room_name
            return run_command(ctx, None, "livekit.ptt.start", payload, args, wait_default=True)
        if args.action == "ptt-stop":
            payload = {"chime_volume": args.chime_volume}
            if args.turn_id:
                payload["ptt_turn_id"] = args.turn_id
            return run_command(ctx, None, "livekit.ptt.stop", payload, args, wait_default=True)
        if args.action == "events":
            return run_command(ctx, None, "livekit.events.list", {"limit": args.limit}, args, wait_default=True)
        if args.action == "clear-events":
            return run_command(ctx, None, "livekit.events.clear", {}, args, wait_default=True)
        payload = {}
        if args.gain is not None:
            payload["gain"] = args.gain
        return run_command(ctx, None, "livekit.output.gain", payload, args, wait_default=True)
    if args.resource == "media":
        require_action(args.action, "media")
        if args.action == "state":
            return run_command(ctx, None, "media.state.get", {}, args, wait_default=True)
        if args.action == "key":
            return run_command(ctx, None, "media.key", {"action": args.media_action}, args, wait_default=True)
        if args.action == "export-audio":
            payload = {"path": args.path}
            if args.display_name:
                payload["display_name"] = args.display_name
            if args.title:
                payload["title"] = args.title
            if args.mime_type:
                payload["mime_type"] = args.mime_type
            return run_command(ctx, None, "media.export.audio", payload, args, wait_default=True)
        if args.action == "exports":
            return run_command(ctx, None, "media.export.list", {"limit": args.limit}, args, wait_default=True)
        if args.action == "export-delete":
            payload = {}
            if args.content_uri:
                payload["content_uri"] = args.content_uri
            if args.id is not None:
                payload["id"] = args.id
            return run_command(ctx, None, "media.export.delete", payload, args, wait_default=True)
        payload = {
            "uri": args.uri,
            "mime_type": args.mime_type,
            "require_resolvable": args.require_resolvable,
        }
        return run_command(ctx, None, "media.open_uri", payload, args, wait_default=True)
    if args.resource == "player":
        require_action(args.action, "player")
        if args.action == "prepare":
            payload = {"url": args.url, "max_bytes": args.max_bytes}
            if args.filename:
                payload["filename"] = args.filename
            return run_command(ctx, None, "player.asset.prepare", payload, args, wait_default=True)
        if args.action == "load":
            payload = {"path": args.path}
            if args.title:
                payload["title"] = args.title
            if args.source:
                payload["source"] = args.source
            return run_command(ctx, None, "player.load", payload, args, wait_default=True)
        if args.action == "play":
            payload = {}
            if args.path:
                payload["path"] = args.path
            if args.title:
                payload["title"] = args.title
            if args.source:
                payload["source"] = args.source
            if args.start_at_ms is not None:
                payload["start_at_ms"] = args.start_at_ms
            return run_command(ctx, None, "player.play", payload, args, wait_default=True)
        if args.action == "pause":
            return run_command(ctx, None, "player.pause", {}, args, wait_default=True)
        if args.action == "stop":
            return run_command(ctx, None, "player.stop", {}, args, wait_default=True)
        if args.action == "seek":
            return run_command(ctx, None, "player.seek", {"position_ms": args.position_ms}, args, wait_default=True)
        if args.action == "state":
            return run_command(ctx, None, "player.state", {}, args, wait_default=True)
        if args.action == "queue-set":
            return run_command(ctx, None, "player.queue.set", {
                "items": args.items,
                "index": args.index,
                "load": not args.no_load,
            }, args, wait_default=True)
        if args.action == "next":
            return run_command(ctx, None, "player.queue.next", {"play": args.play}, args, wait_default=True)
        if args.action == "previous":
            return run_command(ctx, None, "player.queue.previous", {"play": args.play}, args, wait_default=True)
        if args.action == "bookmark":
            payload = {"note": args.note}
            if args.id:
                payload["id"] = args.id
            if args.position_ms is not None:
                payload["position_ms"] = args.position_ms
            return run_command(ctx, None, "player.bookmark.save", payload, args, wait_default=True)
        if args.action == "bookmarks":
            return run_command(ctx, None, "player.bookmark.list", {"limit": args.limit}, args, wait_default=True)
    if args.resource == "button":
        require_action(args.action, "button")
        if args.action == "state":
            return run_command(ctx, None, "button.state", {}, args, wait_default=True)
        if args.action == "config":
            return run_command(ctx, None, "button.config.get", {}, args, wait_default=True)
        if args.action == "config-set":
            payload = {}
            if args.enabled is not None:
                payload["enabled"] = args.enabled == "true"
            if args.double_press_ms is not None:
                payload["double_press_ms"] = args.double_press_ms
            if args.long_press_repeat_count is not None:
                payload["long_press_repeat_count"] = args.long_press_repeat_count
            if args.mapping:
                mappings = {}
                for item in args.mapping:
                    if "=" not in item:
                        raise CliError("ARGUMENT_ERROR", "--mapping must look like gesture=action", exit_code=2)
                    key, value = item.split("=", 1)
                    key = key.strip()
                    value = value.strip()
                    if not key or not value:
                        raise CliError("ARGUMENT_ERROR", "--mapping must include non-empty gesture and action", exit_code=2)
                    mappings[key] = value
                payload["mappings"] = mappings
            return run_command(ctx, None, "button.config.set", payload, args, wait_default=True)
        if args.action == "config-reset":
            return run_command(ctx, None, "button.config.reset", {}, args, wait_default=True)
        if args.action == "events":
            return run_command(ctx, None, "button.events.list", {"limit": args.limit}, args, wait_default=True)
        if args.action == "clear-events":
            return run_command(ctx, None, "button.events.clear", {}, args, wait_default=True)
        if args.action == "simulate":
            return run_command(ctx, None, "button.simulate", {"gesture": args.gesture}, args, wait_default=True)
    if args.resource == "system":
        require_action(args.action, "system")
        if args.action == "runtime":
            return run_command(ctx, None, "runtime.stats", {}, args, wait_default=True)
        if args.action == "memory":
            return run_command(ctx, None, "system.memory.get", {}, args, wait_default=True)
        if args.action == "thermal":
            return run_command(ctx, None, "system.thermal.get", {}, args, wait_default=True)
        return run_command(ctx, None, "compute.benchmark", {"iterations": args.iterations, "max_ms": args.max_ms}, args, wait_default=True)
    if args.resource == "service":
        require_action(args.action, "service")
        return run_command(ctx, None, "service.status", {}, args, wait_default=True)
    if args.resource == "power":
        require_action(args.action, "power")
        return run_command(ctx, None, "power.policy.get", {}, args, wait_default=True)
    if args.resource == "artifact-local":
        require_action(args.action, "artifact-local")
        if args.action == "list":
            return run_command(ctx, None, "artifact.list", {}, args, wait_default=True)
        if args.action == "hash":
            return run_command(ctx, None, "artifact.hash", {"path": args.path}, args, wait_default=True)
        if args.action == "read":
            return run_command(ctx, None, "artifact.read_base64", {
                "path": args.path,
                "max_bytes": args.max_bytes,
            }, args, wait_default=True)
        return run_command(ctx, None, "artifact.delete", {"path": args.path}, args, wait_default=True)
    if args.resource == "file":
        require_action(args.action, "file")
        if args.action == "download":
            payload = {"url": args.url, "max_bytes": args.max_bytes}
            if args.filename:
                payload["filename"] = args.filename
            return run_command(ctx, None, "file.download", payload, args, wait_default=True)
        local_path = pathlib.Path(args.local_path)
        data = local_path.read_bytes()
        payload = {
            "filename": args.filename or local_path.name,
            "content_base64": base64.b64encode(data).decode("ascii"),
            "max_bytes": args.max_bytes,
        }
        return run_command(ctx, None, "file.put_base64", payload, args, wait_default=True)
    if args.resource == "app-update":
        require_action(args.action, "app-update")
        return run_command(ctx, None, "app.update.install_downloaded", {
            "path": args.path,
            "max_bytes": args.max_bytes,
            "open_settings_if_needed": not args.no_open_settings,
        }, args, wait_default=True)
    if args.resource == "settings":
        require_action(args.action, "settings")
        return run_command(ctx, None, "settings.open", {"target": args.target}, args, wait_default=True)
    if args.resource == "browser":
        require_action(args.action, "browser")
        return run_command(ctx, None, "browser.open", {"url": args.url}, args, wait_default=True)
    if args.resource == "share":
        require_action(args.action, "share")
        return run_command(ctx, None, "share.text", {"text": args.text, "title": args.title}, args, wait_default=True)
    if args.resource == "note":
        require_action(args.action, "note")
        if args.action == "create":
            payload = {"title": args.title, "body": args.body}
            if args.id:
                payload["id"] = args.id
            return run_command(ctx, None, "note.create_local", payload, args, wait_default=True)
        if args.action == "list":
            return run_command(ctx, None, "note.list_local", {"limit": args.limit}, args, wait_default=True)
        return run_command(ctx, None, "note.delete_local", {"id": args.id}, args, wait_default=True)
    if args.resource == "intent":
        require_action(args.action, "intent")
        if args.action == "alarm":
            return run_command(ctx, None, "alarm.intent.set", {
                "hour": args.hour,
                "minutes": args.minutes,
                "message": args.message,
                "skip_ui": args.skip_ui,
            }, args, wait_default=True)
        if args.action == "calendar":
            payload = {"title": args.title, "description": args.description, "location": args.location}
            if args.begin_ms is not None:
                payload["begin_ms"] = args.begin_ms
            if args.end_ms is not None:
                payload["end_ms"] = args.end_ms
            return run_command(ctx, None, "calendar.intent.insert", payload, args, wait_default=True)
        return run_command(ctx, None, "phone.intent.dial", {"number": args.number}, args, wait_default=True)
    if args.resource == "test":
        require_action(args.suite, "test")
        if args.suite == "quiet":
            return run_quiet_test(ctx, args)
        if args.suite == "physical":
            return run_physical_test(ctx, args)
        return plain_result(False, "test", {"suite": args.suite}, error={"code": "TEST_NOT_IMPLEMENTED", "message": "This suite is a Phase 3 placeholder."})
    raise CliError("ARGUMENT_ERROR", "No command provided", exit_code=2)


def require_action(action, name):
    if not action:
        raise CliError("ARGUMENT_ERROR", f"{name} requires a subcommand", exit_code=2)


def run_quiet_test(ctx, args):
    started = time.monotonic()
    health = api_health(ctx)
    devices = api_devices(ctx)
    device_id = resolve_device_id(ctx, None)
    steps = [
        {"name": "health", "ok": True, "result": health},
        {"name": "devices", "ok": True, "result": {"devices": devices}},
    ]
    unsupported = []
    failures = []
    for command_type, payload in QUIET_COMMANDS:
        step_args = argparse.Namespace(wait=True, no_wait=False, ttl_ms=30000, evidence=False, no_evidence=True)
        result = run_command(ctx, device_id, command_type, payload, step_args, wait_default=True)
        code = ((result.get("error") or {}).get("code") if isinstance(result.get("error"), dict) else None)
        if not result["ok"] and code == "COMMAND_NOT_ALLOWED" and not args.strict:
            unsupported.append(command_type)
            result = dict(result)
            result["ok"] = True
            result["status"] = "not_implemented"
        elif not result["ok"]:
            failures.append(command_type)
        steps.append({"name": command_type, "ok": result["ok"], "result": result})
    summary = {
        "suite": "quiet",
        "device_id": device_id,
        "steps": len(steps),
        "failures": failures,
        "unsupported": unsupported,
        "strict": bool(args.strict),
    }
    ok = not failures and (not unsupported or not args.strict)
    result = plain_result(ok, "test", {"summary": summary, "steps": steps}, error=None if ok else {"code": "TEST_FAILED", "message": "Quiet suite had failures."}, device_id=device_id)
    result["duration_ms"] = int(round((time.monotonic() - started) * 1000))
    test_run = api_test_run(ctx, {
        "device_id": device_id,
        "suite": "quiet",
        "started_at": utc_now(),
        "completed_at": utc_now(),
        "status": "completed" if ok else "failed",
        "summary": summary,
    })
    if test_run:
        result["result"]["test_run"] = test_run
    if not args.no_evidence:
        result["evidence"] = write_evidence(ctx, result, label="test-quiet")
    return result


def run_physical_test(ctx, args):
    allowed = {item.strip().lower() for item in args.allow.split(",") if item.strip()}
    unknown = sorted(allowed - set(PHYSICAL_COMMANDS))
    if unknown:
        raise CliError("ARGUMENT_ERROR", "Unknown physical allow entries: " + ",".join(unknown), exit_code=2)
    if not allowed:
        raise CliError("ARGUMENT_ERROR", "test physical requires at least one --allow entry", exit_code=2)
    started = time.monotonic()
    device_id = resolve_device_id(ctx, None)
    steps = []
    failures = []
    for name in sorted(allowed):
        command_type, payload = PHYSICAL_COMMANDS[name]
        step_args = argparse.Namespace(wait=True, no_wait=False, ttl_ms=30000, evidence=False, no_evidence=True)
        result = run_command(ctx, device_id, command_type, payload, step_args, wait_default=True)
        if not result["ok"]:
            failures.append(name)
        steps.append({"name": name, "command": command_type, "ok": result["ok"], "result": result})
    summary = {"suite": "physical", "device_id": device_id, "allowed": sorted(allowed), "failures": failures}
    ok = not failures
    result = plain_result(ok, "test", {"summary": summary, "steps": steps}, error=None if ok else {"code": "TEST_FAILED", "message": "Physical suite had failures."}, device_id=device_id)
    result["duration_ms"] = int(round((time.monotonic() - started) * 1000))
    test_run = api_test_run(ctx, {
        "device_id": device_id,
        "suite": "physical",
        "started_at": utc_now(),
        "completed_at": utc_now(),
        "status": "completed" if ok else "failed",
        "summary": summary,
    })
    if test_run:
        result["result"]["test_run"] = test_run
    if not args.no_evidence:
        result["evidence"] = write_evidence(ctx, result, label="test-physical")
    return result


def print_result(ctx, result):
    if ctx.get("default_output") == "json":
        print(json.dumps(result, indent=2, sort_keys=True))
        return
    kind = result.get("kind")
    if not result.get("ok") and result.get("error") and not result.get("command_id"):
        print(json.dumps(result["error"], indent=2, sort_keys=True))
    elif kind == "devices":
        devices = result.get("result", {}).get("devices") or []
        if not devices:
            print("No devices known.")
        for device in devices:
            online = "online" if device.get("online") else "offline"
            print(f"{device.get('device_id')}  {online}  last_seen={device.get('last_seen')}")
    elif kind == "health":
        print(json.dumps(result.get("result") or {}, indent=2, sort_keys=True))
    elif kind == "test":
        summary = (result.get("result") or {}).get("summary") or {}
        print(f"test {summary.get('suite')}: {'ok' if result.get('ok') else 'failed'}")
        print(json.dumps(summary, indent=2, sort_keys=True))
    elif result.get("command_id"):
        print(f"{result.get('type')} {result.get('command_id')}: {result.get('status')}")
        if result.get("error"):
            print(json.dumps(result["error"], indent=2, sort_keys=True))
        elif result.get("result") is not None:
            print(json.dumps(result["result"], indent=2, sort_keys=True))
    else:
        print(json.dumps(result.get("result") or {}, indent=2, sort_keys=True))
    evidence = result.get("evidence")
    if isinstance(evidence, dict) and evidence.get("path"):
        print(f"evidence: {evidence['path']}")


def error_result(error):
    return {
        "schema": RESULT_SCHEMA,
        "ok": False,
        "status": "failed",
        "error": {
            "code": error.code,
            "message": error.message,
            "http_status": error.status,
            "body": error.body,
        },
        "result": None,
        "evidence": None,
    }


def main(argv=None):
    argv = list(sys.argv[1:] if argv is None else argv)
    try:
        global_opts, rest = extract_global_options(argv)
        ctx = build_context(global_opts)
        parser = build_parser()
        if not rest:
            parser.print_help()
            return 2
        args = parser.parse_args(rest)
        result = dispatch(ctx, args)
        print_result(ctx, result)
        return 0 if result.get("ok") else 1
    except CliError as exc:
        global_opts = {}
        try:
            global_opts, _ = extract_global_options(argv)
            ctx = build_context(global_opts)
        except Exception:
            ctx = dict(DEFAULT_CONFIG)
        result = error_result(exc)
        print_result(ctx, result)
        return exc.exit_code


if __name__ == "__main__":
    raise SystemExit(main())
