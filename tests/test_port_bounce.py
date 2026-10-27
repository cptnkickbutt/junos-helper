import tempfile
from pathlib import Path
import unittest
from unittest.mock import Mock, patch

import paramiko

import app



def setUpModule():
    global _activity_directory, _activity_config
    _activity_directory = tempfile.TemporaryDirectory()
    _activity_config = patch.dict(app.app.config, {"ACTIVITY_LOG_PATH": Path(_activity_directory.name) / "activity.sqlite3"})
    _activity_config.start()


def tearDownModule():
    _activity_config.stop()
    _activity_directory.cleanup()


class PortBounceTests(unittest.TestCase):
    def setUp(self):
        self.ssh = self.enterContext(patch("app._ssh_client", return_value=Mock()))
        self.manual = self.enterContext(patch("app._manual_protected_ports", return_value=[]))
        self.outputs = {
            "show interfaces terse": ("mge-0/0/12 up up\nmge-0/0/13 up down\nmge-0/0/14 up up", "", 0),
            "show configuration interfaces | display set": (
                "set interfaces mge-0/0/12 flexible-vlan-tagging\n"
                "set interfaces mge-0/0/12 unit 3026 input-vlan-map push\n"
                "set interfaces mge-0/0/13 unit 0 family ethernet-switching interface-mode access", "", 0),
            "show ethernet-switching table": ("", "", 0),
            "show lldp neighbors detail": ("", "", 0),
        }
        self.execute = self.enterContext(patch("app._execute_cli", side_effect=self.execute_command))
        self.payload = {"host": "192.0.2.10", "username": "netops", "ports": ["mge-0/0/12"], "kind": "link", "interval": 5}
        self.client = app.app.test_client()

    def execute_command(self, client, command):
        if command in self.outputs:
            result = self.outputs[command]
            if isinstance(result, Exception):
                raise result
            return result
        if command.startswith("show poe interface "):
            return f"PoE interface: {command.split()[-1]}\nAdministrative status: Enabled\nOperational status: ON", "", 0
        parts = command.split()
        if parts[:4] == ["request", "interface", "bounce", "poe"]:
            return f"PoE bounce request received for {parts[4]} with interval {parts[-1]}s.", "", 0
        if parts[:3] == ["request", "interface", "bounce"]:
            return f"Bounce operation on interface {parts[3]} started with interval {parts[-1]} secs.", "", 0
        self.fail(f"Unexpected CLI command: {command}")

    def commands(self):
        return [call.args[1] for call in self.execute.call_args_list]

    def test_link_bounce_allows_customer_logical_services_and_keeps_configuration_out(self):
        self.payload.update(ports=["mge-0/0/12", "mge-0/0/13"], config="set system host-name INJECTED")
        response = self.client.post("/api/ports/bounce", json=self.payload)
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.get_json()["ok"])
        self.assertEqual(self.commands()[-2:], [
            "request interface bounce mge-0/0/12 interval 5",
            "request interface bounce mge-0/0/13 interval 5",
        ])
        self.assertTrue(all(command.startswith(("show ", "request interface bounce ")) for command in self.commands()))
        self.ssh.return_value.close.assert_called_once()
        self.assertFalse(app.PORT_BOUNCE_LOCK.locked())

    def test_poe_checks_every_port_before_sending_native_power_bounces(self):
        self.payload.update(kind="poe", interval=10, ports=["mge-0/0/12", "mge-0/0/13"])
        response = self.client.post("/api/ports/bounce", json=self.payload)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(self.commands()[-4:], [
            "show poe interface mge-0/0/12", "show poe interface mge-0/0/13",
            "request interface bounce poe mge-0/0/12 interval 10",
            "request interface bounce poe mge-0/0/13 interval 10",
        ])

    def test_bad_requests_are_rejected_before_ssh(self):
        for update in [
            {"kind": "reboot"}, {"kind": ["link"]}, {"interval": True}, {"interval": 0},
            {"interval": 31}, {"interval": "5"}, {"ports": []}, {"ports": "mge-0/0/12"},
            {"ports": ["mge-0/0/12.3026"]}, {"ports": ["ae0"]}, {"ports": ["all"]},
            {"ports": ["mge-0/0/12; reboot"]}, {"ports": ["mge-0/0/12"] * 49},
        ]:
            with self.subTest(update=update):
                response = self.client.post("/api/ports/bounce", json={**self.payload, **update})
                self.assertEqual(response.status_code, 400)
                self.ssh.assert_not_called()

    def test_duplicates_are_only_bounced_once(self):
        self.payload["ports"] *= 2
        self.assertEqual(self.client.post("/api/ports/bounce", json=self.payload).status_code, 200)
        self.assertEqual(len([command for command in self.commands() if command.startswith("request ")]), 1)

    def test_protected_port_rejects_the_whole_selection(self):
        self.manual.return_value = ["mge-0/0/13"]
        self.payload["ports"].append("mge-0/0/13")
        response = self.client.post("/api/ports/bounce", json=self.payload)
        self.assertEqual(response.status_code, 409)
        self.assertIn("Manually protected", response.get_json()["error"])
        self.assertTrue(all(command.startswith("show ") for command in self.commands()))

    def test_disabled_or_undiscovered_port_is_never_bounced(self):
        for update in [
            {"show interfaces terse": ("mge-0/0/12 down down", "", 0)},
            {"show configuration interfaces | display set": ("set interfaces mge-0/0/12 disable", "", 0)},
            {"show interfaces terse": ("mge-0/0/13 up up", "", 0)},
        ]:
            with self.subTest(update=update), patch.dict(self.outputs, update):
                self.execute.reset_mock()
                response = self.client.post("/api/ports/bounce", json=self.payload)
                self.assertEqual(response.status_code, 409)
                self.assertTrue(all(command.startswith("show ") for command in self.commands()))

    def test_failed_fresh_read_never_bounces(self):
        self.outputs["show ethernet-switching table"] = ("error: permission denied", "", 0)
        response = self.client.post("/api/ports/bounce", json=self.payload)
        self.assertEqual(response.status_code, 409)
        self.assertIn("permission denied", response.get_json()["error"])
        self.assertTrue(all(command.startswith("show ") for command in self.commands()))

    def test_poe_unavailable_on_one_port_prevents_every_power_bounce(self):
        self.payload.update(kind="poe", ports=["mge-0/0/12", "mge-0/0/13"])
        self.outputs["show poe interface mge-0/0/13"] = ("Administrative status: Disabled", "", 0)
        response = self.client.post("/api/ports/bounce", json=self.payload)
        self.assertEqual(response.status_code, 409)
        self.assertIn("PoE is not enabled", response.get_json()["error"])
        self.assertTrue(all(command.startswith("show ") for command in self.commands()))

    def test_unsupported_command_reports_error_without_configuration_fallback(self):
        self.outputs["request interface bounce mge-0/0/12 interval 5"] = ("syntax error, expecting <command>.", "", 0)
        response = self.client.post("/api/ports/bounce", json=self.payload)
        self.assertEqual(response.status_code, 502)
        self.assertIn("syntax error", response.get_json()["results"][0]["error"])
        self.assertEqual(len(self.commands()), 5)

    def test_missing_acknowledgement_is_not_reported_as_success(self):
        self.outputs["request interface bounce mge-0/0/12 interval 5"] = ("", "", 0)
        response = self.client.post("/api/ports/bounce", json=self.payload)
        self.assertEqual(response.status_code, 502)
        self.assertIn("not acknowledged", response.get_json()["results"][0]["error"])

    def test_partial_success_preserves_per_port_results(self):
        self.payload["ports"].append("mge-0/0/13")
        self.outputs["request interface bounce mge-0/0/13 interval 5"] = ("error: port busy", "", 1)
        response = self.client.post("/api/ports/bounce", json=self.payload)
        self.assertEqual(response.status_code, 502)
        self.assertEqual([item["ok"] for item in response.get_json()["results"]], [True, False])
        self.assertIn("port busy", response.get_json()["results"][1]["error"])

    def test_lost_connection_reports_uncertainty_and_stops_remaining_requests(self):
        self.payload["ports"] += ["mge-0/0/13", "mge-0/0/14"]
        self.outputs["request interface bounce mge-0/0/13 interval 5"] = paramiko.SSHException("channel closed")
        response = self.client.post("/api/ports/bounce", json=self.payload)
        self.assertEqual(response.status_code, 502)
        results = response.get_json()["results"]
        self.assertTrue(results[0]["ok"])
        self.assertIn("may have started", results[1]["error"])
        self.assertIn("Not attempted", results[2]["error"])
        self.assertNotIn("request interface bounce mge-0/0/14 interval 5", self.commands())
        self.ssh.return_value.close.assert_called_once()
        self.assertFalse(app.PORT_BOUNCE_LOCK.locked())

    def test_overlapping_request_is_rejected_without_ssh(self):
        with patch.object(app, "PORT_BOUNCE_LOCK") as lock:
            lock.acquire.return_value = False
            response = self.client.post("/api/ports/bounce", json=self.payload)
            self.assertEqual(response.status_code, 409)
            self.ssh.assert_not_called()
            lock.release.assert_not_called()


if __name__ == "__main__":
    unittest.main()
