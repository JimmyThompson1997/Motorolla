import importlib.util
import pathlib
import tempfile
import threading
import unittest


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


class BrokerIntegrationTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        db_path = pathlib.Path(self.tmp.name) / "broker.sqlite3"
        broker.DEVICES.clear()
        broker.init_db(str(db_path))
        self.server = broker.ThreadingHTTPServer(("127.0.0.1", 0), broker.Handler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.ctx = puckyctl.build_context({
            "broker_base_url": f"http://127.0.0.1:{self.server.server_address[1]}",
            "default_device_id": "pucky-test",
            "operator_token": "operator-dev-token",
            "default_output": "json",
            "evidence_dir": str(pathlib.Path(self.tmp.name) / "evidence"),
        })

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=2)
        broker.DB.close()
        self.tmp.cleanup()

    def test_health_and_devices(self):
        self.assertTrue(puckyctl.api_health(self.ctx)["ok"])
        self.assertEqual(puckyctl.api_devices(self.ctx), [])

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


if __name__ == "__main__":
    unittest.main()
