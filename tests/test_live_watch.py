import json
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

import app
from activity_log import ActivityLog
from live_watch import WatchSessions, WatchSessionError, parse_interface_sample, parse_poe_sample, validate_watch_ports
REAL_WATCH_READ = app._watch_read


def interface_output(name="ge-0/0/1", *, rx="9007199254740995", link="Up", speed="1000mbps"):
    return f"""Physical interface: {name}, Enabled, Physical link is {link}
  Interface index: 7, SNMP ifIndex: 8, Generation: 123
  Description: Camera, entrance
  Link-level type: Ethernet, MTU: 1514, Speed: {speed}, BPDU Error: None
  Last flapped: 2026-10-27 10:00:00 UTC (00:01:00 ago)
  Statistics last cleared: Never
  Traffic statistics:
    Input bytes: {rx} 0 bps
    Output bytes: 3000 0 bps
    Input packets: 200 0 pps
    Output packets: 100 0 pps
  Input errors:
    Errors: 4, Drops: 2, Framing errors: 3, Runts: 0
  Output errors:
    Carrier transitions: 2, Errors: 5, Drops: 7, MTU errors: 0
  Egress queues: 8 supported
  Logical interface {name}.300 (Index 123)
    Traffic statistics:
      Input bytes: 999999999
      Output bytes: 999999999
"""


class SampleParsingTests(unittest.TestCase):
    def test_physical_counters_are_precise_and_exclude_logical_units(self):
        sample = parse_interface_sample(interface_output(), "ge-0/0/1")
        self.assertEqual(sample["counters"]["rxBytes"], "9007199254740995")
        self.assertEqual(sample["counters"]["txBytes"], "3000")
        self.assertEqual(sample["counters"]["inputErrors"], "4")
        self.assertEqual(sample["counters"]["framingErrors"], "3")
        self.assertEqual(sample["counters"]["carrierTransitions"], "2")
        self.assertEqual(sample["speedBps"], 1000000000)
        self.assertEqual(sample["description"], "Camera, entrance")
        self.assertEqual(sample["lastFlapped"], "2026-10-27 10:00:00 UTC")

    def test_channel_lanes_aggregate_names_down_links_and_partner_speed(self):
        for name in ("et-0/0/0:1", "mge-1/0/12", "ae0", "reth1"):
            output = interface_output(name).replace("BPDU Error: None", "BPDU Error: None, Link partner Speed: 100 Mbps")
            self.assertEqual(parse_interface_sample(output, name)["speedBps"], 100000000)
        self.assertIsNone(parse_interface_sample(interface_output(link="Down"), "ge-0/0/1")["speedBps"])
        self.assertIsNone(parse_interface_sample(interface_output(speed="Auto"), "ge-0/0/1")["speedBps"])

    def test_missing_physical_statistics_and_total_errors_stay_unavailable(self):
        output = "Physical interface: ge-0/0/1, Enabled, Physical link is Up\n  Input errors:\n    Framing errors: 8\n  Logical interface ge-0/0/1.0 (Index 1)\n    Traffic statistics:\n      Input bytes: 99999\n"
        sample = parse_interface_sample(output, "ge-0/0/1")
        self.assertIsNone(sample["counters"]["rxBytes"])
        self.assertIsNone(sample["counters"]["inputErrors"])
        self.assertEqual(sample["counters"]["framingErrors"], "8")
        with self.assertRaises(ValueError):
            parse_interface_sample(interface_output("et-0/0/0:1"), "et-0/0/0:0")

    def test_poe_label_and_table_formats(self):
        sample = parse_poe_sample("Administrative status: Enabled\nOperational status: ON\nPower consumption: 5.2W", "ge-0/0/1")
        self.assertEqual(sample["watts"], "5.2W")
        single = parse_poe_sample("Administrative status: Enabled\nOperational status: ON\nPower consumed: 7.8W", "ge-0/0/1")
        self.assertEqual(single["watts"], "7.8W")
        table = parse_poe_sample("ge-0/0/1 Enabled ON 30.0W Low 5.2W 3", "ge-0/0/1")
        self.assertEqual(table["watts"], "5.2 W")
        with self.assertRaises(ValueError):
            parse_poe_sample("PoE unsupported", "ge-0/0/1")


class WatchSessionTests(unittest.TestCase):
    def setUp(self):
        self.pool = WatchSessions(maximum=1)
        self.addCleanup(self.pool.close)
        self.connect = Mock(return_value=Mock())

    def test_connection_reuse_and_identity_binding(self):
        entry = self.pool.acquire("switch", "user", "secret", "", self.connect)
        self.pool.release(entry)
        reused = self.pool.acquire("SWITCH", "user", "secret", entry.token, self.connect)
        self.assertIs(reused, entry)
        self.pool.release(reused)
        self.connect.assert_called_once()
        for host, user, password in (("other", "user", "secret"), ("switch", "other", "secret"), ("switch", "user", "wrong")):
            with self.assertRaises(WatchSessionError) as caught:
                self.pool.acquire(host, user, password, entry.token, self.connect)
            self.assertTrue(caught.exception.expired)

    def test_no_overlapping_samples_capacity_and_idle_close(self):
        entry = self.pool.acquire("switch", "user", "secret", "", self.connect)
        with self.assertRaises(WatchSessionError) as caught:
            self.pool.acquire("switch", "user", "secret", entry.token, self.connect)
        self.assertFalse(caught.exception.expired)
        with self.assertRaises(WatchSessionError):
            self.pool.acquire("other", "user", "secret", "", self.connect)
        self.pool.drop(entry.token, only_idle=True)
        self.assertIn(entry.token, self.pool.sessions)
        self.pool.release(entry)
        entry.last_used = time.monotonic() - 100
        self.pool.drop(entry.token, only_idle=True)
        self.assertNotIn(entry.token, self.pool.sessions)
        entry.client.close.assert_called_once()


class LiveWatchApiTests(unittest.TestCase):
    def setUp(self):
        directory = self.enterContext(tempfile.TemporaryDirectory())
        self.log_path = Path(directory) / "activity.sqlite3"
        self.enterContext(patch.dict(app.app.config, {"ACTIVITY_LOG_PATH": self.log_path}))
        self.pool = WatchSessions()
        self.addCleanup(self.pool.close)
        self.enterContext(patch.object(app, "WATCH_SESSIONS", self.pool))
        self.enterContext(patch.object(app, "WATCH_LOG_THROTTLE", {}))
        self.ssh = self.enterContext(patch("app._ssh_client", return_value=Mock()))
        self.read = self.enterContext(patch("app._watch_read", side_effect=lambda client, command: interface_output(command.split()[2])))
        self.client = app.app.test_client()
        self.payload = {"host": "switch", "username": "netops", "password": "secret", "ports": ["ge-0/0/1", "et-0/0/0:1"]}

    def test_targeted_read_only_samples_reuse_connection_without_logging_each_sample(self):
        response = self.client.post("/api/live-watch/sample", json={**self.payload, "commands": ["request system reboot"]})
        self.assertEqual(response.status_code, 200)
        body = response.get_json()
        self.assertEqual([item["name"] for item in body["ports"]], self.payload["ports"])
        self.assertIsInstance(body["ports"][0]["sampleTimeMs"], float)
        self.assertEqual(body["ports"][0]["counters"]["rxBytes"], "9007199254740995")
        again = self.client.post("/api/live-watch/sample", json={**self.payload, "sessionId": body["sessionId"]})
        self.assertEqual(again.get_json()["sessionId"], body["sessionId"])
        self.ssh.assert_called_once()
        commands = [call.args[1] for call in self.read.call_args_list]
        self.assertEqual(commands, ["show interfaces ge-0/0/1 extensive", "show interfaces et-0/0/0:1 extensive"] * 2)
        self.assertEqual(len(ActivityLog(self.log_path).read(view="all")["events"]), 1)
        stop = self.client.post("/api/live-watch/stop", json={"sessionId": body["sessionId"]})
        self.assertTrue(stop.get_json()["ok"])
        self.ssh.return_value.close.assert_called_once()

    def test_all_ports_validated_before_ssh(self):
        for ports in ([], ["ge-0/0/1.0"], ["all"], ["ge-0/0/1; commit"], ["ge-0/0/1 | save file"], [f"ge-0/0/{number}" for number in range(9)]):
            with self.subTest(ports=ports):
                self.assertEqual(self.client.post("/api/live-watch/sample", json={**self.payload, "ports": ports}).status_code, 400)
        self.ssh.assert_not_called()

    def test_optional_poe_is_cached_and_does_not_break_traffic_when_unsupported(self):
        def output(client, command):
            if command.startswith("show poe"):
                raise ValueError("PoE not supported")
            return interface_output(command.split()[2])
        self.read.side_effect = output
        payload = {**self.payload, "ports": ["ge-0/0/1"], "includePoe": True}
        body = self.client.post("/api/live-watch/sample", json=payload).get_json()
        self.assertTrue(body["ok"])
        self.assertFalse(body["ports"][0]["poe"]["available"])
        self.client.post("/api/live-watch/sample", json={**payload, "sessionId": body["sessionId"]})
        commands = [call.args[1] for call in self.read.call_args_list]
        self.assertEqual(commands.count("show poe interface ge-0/0/1"), 1)

    def test_poe_ssh_failure_keeps_the_already_collected_traffic_sample(self):
        def output(client, command):
            if command.startswith("show poe"):
                raise OSError("channel closed")
            return interface_output()
        self.read.side_effect = output
        body = self.client.post("/api/live-watch/sample", json={**self.payload, "includePoe": True}).get_json()
        self.assertTrue(body["ok"])
        self.assertEqual(body["ports"][0]["counters"]["rxBytes"], "9007199254740995")
        self.assertFalse(body["ports"][0]["poe"]["available"])
        self.assertIn("error", body["ports"][1])
        self.assertEqual(body["sessionId"], "")
        self.assertEqual(self.read.call_count, 2)

    def test_new_browser_asset_is_served_and_internal_module_is_private(self):
        with self.client.get("/live-watch.js") as response:
            self.assertEqual(response.status_code, 200)
            self.assertIn("LiveWatchController", response.get_data(as_text=True))
        self.assertEqual(self.client.get("/live_watch.py").status_code, 404)

    def test_partial_failure_keeps_other_port_and_throttles_diagnostics(self):
        def output(client, command):
            if "et-0/0/0:1" in command:
                raise ValueError("error: interface not found")
            return interface_output()
        self.read.side_effect = output
        body = self.client.post("/api/live-watch/sample", json=self.payload).get_json()
        self.assertTrue(body["ok"])
        self.assertIn("error", body["ports"][1])
        self.client.post("/api/live-watch/sample", json={**self.payload, "sessionId": body["sessionId"]})
        self.assertEqual(len(ActivityLog(self.log_path).read(view="errors")["events"]), 1)

    def test_ssh_failure_closes_session_and_expired_token_cannot_be_used(self):
        self.read.side_effect = OSError("channel closed")
        body = self.client.post("/api/live-watch/sample", json=self.payload).get_json()
        self.assertFalse(body["ok"])
        self.assertEqual(body["sessionId"], "")
        self.assertEqual(len(self.pool.sessions), 0)
        self.ssh.return_value.close.assert_called_once()
        expired = self.client.post("/api/live-watch/sample", json={**self.payload, "sessionId": "a" * 32})
        self.assertEqual(expired.status_code, 409)
        self.assertTrue(expired.get_json()["sessionExpired"])

    def test_cli_error_detection_does_not_mistake_bpdu_error_none_for_a_failure(self):
        client = Mock()
        stdout, stderr = Mock(), Mock()
        stdout.read.return_value = interface_output().encode()
        stdout.channel.recv_exit_status.return_value = 0
        stderr.read.return_value = b""
        client.exec_command.return_value = (None, stdout, stderr)
        self.assertIn("BPDU Error: None", REAL_WATCH_READ(client, "show interfaces ge-0/0/1 extensive"))
        client.exec_command.assert_called_once_with("cli -c 'show interfaces ge-0/0/1 extensive'", timeout=6)
        stdout.read.return_value = b"error: interface not found"
        with self.assertRaisesRegex(ValueError, "interface not found"):
            REAL_WATCH_READ(client, "show interfaces ge-0/0/1 extensive")
