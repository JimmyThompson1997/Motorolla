import importlib.util
import json
import pathlib
import sqlite3
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from unittest import mock


ROOT = pathlib.Path(__file__).resolve().parents[1]


def load_module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


puckyctl = load_module("puckyctl_under_test", ROOT / "puckyctl" / "puckyctl.py")
broker = load_module("pucky_fly_broker_under_test", ROOT / "fly-broker" / "pucky_fly_broker.py")


class ParseTests(unittest.TestCase):
    def test_parse_duration_ms(self):
        self.assertEqual(puckyctl.parse_duration_ms("250ms"), 250)
        self.assertEqual(puckyctl.parse_duration_ms("3s"), 3000)
        self.assertEqual(puckyctl.parse_duration_ms("2m"), 120000)

    def test_parse_key_values(self):
        self.assertEqual(
            puckyctl.parse_key_values(["enabled=true", "max_events=3", "label=test"]),
            {"enabled": True, "max_events": 3, "label": "test"},
        )

    def test_global_timeout_does_not_consume_command_timeout(self):
        opts, rest = puckyctl.extract_global_options([
            "--json",
            "--broker",
            "https://broker.example",
            "location",
            "get",
            "--timeout-ms",
            "10000",
        ])
        self.assertEqual(opts["default_output"], "json")
        self.assertEqual(opts["broker_base_url"], "https://broker.example")
        self.assertNotIn("default_timeout_ms", opts)
        self.assertEqual(rest, ["location", "get", "--timeout-ms", "10000"])

    def test_global_timeout_before_command_is_still_global(self):
        opts, rest = puckyctl.extract_global_options([
            "--timeout-ms",
            "60000",
            "devices",
        ])
        self.assertEqual(opts["default_timeout_ms"], 60000)
        self.assertEqual(rest, ["devices"])

    def test_context_falls_back_to_pucky_api_token_for_personal_operator_auth(self):
        with mock.patch.dict(
            "os.environ",
            {"PUCKY_OPERATOR_TOKEN": "", "PUCKY_API_TOKEN": "personal-token"},
            clear=False,
        ):
            ctx = puckyctl.build_context({})

        self.assertEqual(ctx["operator_token"], "personal-token")


class BrokerIntegrationTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        db_path = pathlib.Path(self.tmp.name) / "broker.sqlite3"
        self.env_patch = mock.patch.dict(
            "os.environ",
            {
                "PUCKY_OPERATOR_TOKEN": "operator-token",
                "PUCKY_DEVICE_TOKEN": "device-token",
            },
        )
        self.env_patch.start()
        broker.DEVICES.clear()
        broker.init_db(str(db_path))
        self.server = broker.ThreadingHTTPServer(("127.0.0.1", 0), broker.Handler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.ctx = puckyctl.build_context({
            "broker_base_url": f"http://127.0.0.1:{self.server.server_address[1]}",
            "default_device_id": "pucky-test",
            "operator_token": "operator-token",
            "default_output": "json",
            "evidence_dir": str(pathlib.Path(self.tmp.name) / "evidence"),
        })

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=2)
        broker.DB.close()
        self.env_patch.stop()
        self.tmp.cleanup()

    def test_health_and_devices(self):
        self.assertTrue(puckyctl.api_health(self.ctx)["ok"])
        self.assertEqual(puckyctl.api_devices(self.ctx), [])

    def test_operator_token_fails_closed_when_not_configured(self):
        ctx = dict(self.ctx)
        ctx["operator_token"] = "operator-dev-token"

        with mock.patch.dict("os.environ", {"PUCKY_OPERATOR_TOKEN": ""}):
            with self.assertRaises(puckyctl.CliError) as caught:
                puckyctl.api_devices(ctx)

        self.assertEqual(401, caught.exception.status)

    def test_operator_and_device_auth_accept_explicit_pucky_api_token_fallback(self):
        fallback = "personal-api-token"
        ctx = dict(self.ctx)
        ctx["operator_token"] = fallback

        with mock.patch.dict(
            "os.environ",
            {"PUCKY_OPERATOR_TOKEN": "", "PUCKY_DEVICE_TOKEN": "", "PUCKY_API_TOKEN": fallback},
            clear=False,
        ):
            self.assertEqual(puckyctl.api_devices(ctx), [])
            response = self.post_device_event("pucky-test", {"type": "agent.recipe_triggered"}, token=fallback)

        self.assertTrue(response["ok"])

    def test_send_offline_command_uses_v1_alias(self):
        result = puckyctl.run_command_send(
            self.ctx,
            ["ping", "--args-json", '{"hello":"world"}'],
            direct=True,
        )
        self.assertFalse(result["ok"])
        self.assertEqual(result["status"], "device_offline")
        self.assertEqual(result["type"], "ping")
        stored = puckyctl.get_command(self.ctx, result["command_id"])
        self.assertEqual(stored["args"], {"hello": "world"})

    def test_command_queued_writes_optional_action_ledger_row(self):
        ledger_path = pathlib.Path(self.tmp.name) / "actions.sqlite3"
        with mock.patch.dict(
            "os.environ",
            {
                "PUCKY_ACTION_LEDGER_PATH": str(ledger_path),
                "PUCKY_ACTION_LEDGER_USER_ID": "user-1",
            },
            clear=False,
        ):
            result = puckyctl.run_command_send(
                self.ctx,
                ["battery.status", "--args-json", "{}"],
                direct=True,
            )

        self.assertFalse(result["ok"])
        conn = sqlite3.connect(str(ledger_path))
        try:
            row = conn.execute(
                """
                SELECT user_id, surface, action, tool, target, status
                FROM action_log
                ORDER BY id DESC
                LIMIT 1
                """
            ).fetchone()
        finally:
            conn.close()
        self.assertEqual(
            tuple(row),
            ("user-1", "apk_broker", "battery.status", "battery.status", "device=pucky-test", "queued"),
        )

    def test_capability_result_is_stored_for_v1_endpoint(self):
        command = {
            "id": "cmd_capability",
            "device_id": "pucky-test",
            "type": "capabilities.get",
            "args": {},
            "ttl_ms": 30000,
            "created_at": puckyctl.utc_now(),
            "status": "sent",
        }
        broker.persist_command(command)
        broker.update_command_from_device({
            "schema": "pucky.command_result.v1",
            "id": "cmd_capability",
            "type": "capabilities.get",
            "status": "completed",
            "result": {
                "capabilities": [
                    {
                        "capability_id": "battery.get",
                        "status": "proven",
                        "permission": None,
                        "direct_control": "yes",
                    }
                ]
            },
        })
        body = puckyctl.api_capabilities(self.ctx, "pucky-test")
        self.assertEqual(body["capabilities"][0]["capability_id"], "battery.get")
        self.assertEqual(body["capabilities"][0]["status"], "proven")

    def test_photo_result_is_stored_as_artifact_metadata(self):
        command = {
            "id": "cmd_photo",
            "device_id": "pucky-test",
            "type": "photo.capture",
            "args": {"max_width": 640},
            "ttl_ms": 30000,
            "created_at": puckyctl.utc_now(),
            "status": "sent",
        }
        broker.persist_command(command)
        broker.update_command_from_device({
            "schema": "pucky.command_result.v1",
            "id": "cmd_photo",
            "type": "photo.capture",
            "status": "completed",
            "result": {
                "captured": True,
                "path": "/device/photo.jpg",
                "bytes": 123,
                "mime_type": "image/jpeg",
            },
        })
        body = puckyctl.api_artifacts(self.ctx, "pucky-test")
        self.assertEqual(body["artifacts"][0]["kind"], "photo")
        self.assertEqual(body["artifacts"][0]["device_path"], "/device/photo.jpg")

    def test_device_event_endpoint_persists_keyword_trigger(self):
        body = {
            "schema": "pucky.keyword_triggered.v1",
            "device_id": "pucky-test",
            "type": "agent.recipe_triggered",
            "recipe_id": "check_email",
            "raw_transcript": "check email",
        }
        response = self.post_device_event("pucky-test", body, token="device-token")

        self.assertTrue(response["ok"])
        history = broker.history(20, "pucky-test")
        self.assertTrue(any(
            item.get("event") == "agent.recipe_triggered"
            and item.get("payload", {}).get("recipe_id") == "check_email"
            for item in history
        ))

    def test_device_event_endpoint_rejects_bad_token_and_device_mismatch(self):
        with self.assertRaises(urllib.error.HTTPError) as unauthorized:
            self.post_device_event("pucky-test", {"type": "agent.recipe_triggered"}, token="bad-token")
        self.assertEqual(401, unauthorized.exception.code)

        with self.assertRaises(urllib.error.HTTPError) as mismatch:
            self.post_device_event("pucky-test", {
                "device_id": "other-device",
                "type": "agent.recipe_triggered",
            }, token="device-token")
        self.assertEqual(400, mismatch.exception.code)

    def test_device_token_fails_closed_when_not_configured(self):
        with mock.patch.dict("os.environ", {"PUCKY_DEVICE_TOKEN": "", "PUCKY_API_TOKEN": ""}):
            with self.assertRaises(urllib.error.HTTPError) as caught:
                self.post_device_event("pucky-test", {"type": "agent.recipe_triggered"}, token="dev-token")

        self.assertEqual(401, caught.exception.code)

    def post_device_event(self, device_id, body, token):
        url = f"http://127.0.0.1:{self.server.server_address[1]}/v1/devices/{device_id}/events"
        request = urllib.request.Request(
            url,
            data=json.dumps(body).encode("utf-8"),
            headers={
                "content-type": "application/json",
                "authorization": f"Bearer {token}",
            },
            method="POST",
        )
        with urllib.request.urlopen(request, timeout=5) as response:
            return json.loads(response.read().decode("utf-8"))


if __name__ == "__main__":
    unittest.main()
