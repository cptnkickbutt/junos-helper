import json
import sqlite3
import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import Mock, patch

import app
from activity_log import ActivityLog, utc_now


class ActivityHistoryTests(unittest.TestCase):
    def setUp(self):
        self.directory = self.enterContext(tempfile.TemporaryDirectory())
        self.path = Path(self.directory) / "activity.sqlite3"
        self.enterContext(patch.dict(app.app.config, {"ACTIVITY_LOG_PATH": self.path}))
        self.enterContext(patch.object(app, "ACTIVITY_LAST_ERROR", ""))
        self.client = app.app.test_client()

    def event(self, **updates):
        return {"host": "SWITCH-A", "operation": "Protected push", "category": "change",
                "status": "committed", "severity": "info", "message": "Committed",
                "request_id": "a" * 32, **updates}

    def test_persistence_device_filter_pagination_and_error_views(self):
        store = ActivityLog(self.path)
        for number in range(105):
            store.append(self.event(message=str(number), request_id=str(number)))
        store.append(self.event(host="switch-b", message="Other device"))
        store.append(self.event(operation="Data pull", category="data", status="succeeded", message="Inventory"))
        store.append(self.event(category="data", severity="error", status="failed", message="SSH failed"))
        first = self.client.get("/api/activity?host=switch-a&view=changes").get_json()
        self.assertEqual(len(first["events"]), 100)
        self.assertTrue(first["hasMore"])
        self.assertEqual(first["events"][0]["message"], "SSH failed")
        self.assertTrue(all(event["host"] == "switch-a" for event in first["events"]))
        second = ActivityLog(self.path).read(host="SWITCH-A", before=first["nextBefore"])
        self.assertEqual(len(second["events"]), 6)
        self.assertFalse(second["hasMore"])
        self.assertFalse({event["id"] for event in first["events"]} & {event["id"] for event in second["events"]})
        self.assertEqual(len(store.read(host="switch-a", view="errors")["events"]), 1)
        self.assertEqual(len(store.read(host="switch-b", view="all")["events"]), 1)

    def test_concurrent_actions_share_one_database_without_lost_events(self):
        store = ActivityLog(self.path)
        with ThreadPoolExecutor(max_workers=4) as executor:
            ids = list(executor.map(lambda number: store.append(self.event(request_id=str(number))), range(24)))
        self.assertEqual(len(set(ids)), 24)
        self.assertEqual(len(ActivityLog(self.path).read()["events"]), 24)

    def test_retention_bounds_and_completed_attempt_suppression(self):
        store = ActivityLog(self.path, max_rows=3)
        old = (datetime.now(timezone.utc) - timedelta(days=91)).isoformat(timespec="seconds")
        store.append(self.event(timestamp=old))
        self.assertEqual(store.read()["events"], [])
        for number in range(5):
            store.append(self.event(request_id=str(number), message=str(number)))
        self.assertEqual([event["message"] for event in store.read()["events"]], ["4", "3", "2"])
        store = ActivityLog(self.path)
        store.append(self.event(status="started", request_id="attempt"))
        self.assertEqual(store.read()["events"][0]["status"], "started")
        store.append(self.event(status="failed", request_id="attempt"))
        attempts = [event for event in store.read()["events"] if event["request_id"] == "attempt"]
        self.assertEqual([event["status"] for event in attempts], ["failed"])

    def test_confirmation_correlates_by_request_and_device_and_does_not_assert_rollback(self):
        store = ActivityLog(self.path)
        elapsed = (datetime.now(timezone.utc) - timedelta(minutes=1)).isoformat(timespec="seconds")
        store.append(self.event(status="awaiting-confirmation", details={"confirmationDeadline": elapsed}))
        self.assertEqual(store.read()["events"][0]["confirmationState"], "window-elapsed")
        store.append(self.event(host="switch-b", status="confirmed", request_id="b" * 32, related_request_id="a" * 32))
        self.assertEqual(store.read(host="switch-a")["events"][0]["confirmationState"], "window-elapsed")
        store.append(self.event(status="confirmed", request_id="c" * 32, related_request_id="a" * 32))
        pushes = [event for event in store.read(host="switch-a")["events"] if event["status"] == "awaiting-confirmation"]
        self.assertEqual(pushes[0]["confirmationState"], "confirmed")

    @patch("app._execute_cli")
    @patch("app._ssh_client", return_value=Mock())
    def test_push_and_confirmation_have_durable_distinct_outcomes(self, ssh, execute):
        execute.side_effect = [("configuration check succeeds", "", 0), ("commit complete", "", 0), ("commit complete", "", 0)]
        payload = {"host": "SWITCH-A", "username": "netops", "password": "ssh-secret", "deviceName": "access-a",
                   "config": "set interfaces ge-0/0/1 description Camera"}
        result = self.client.post("/api/push", json=payload).get_json()
        events = self.client.get("/api/activity?host=switch-a").get_json()["events"]
        self.assertEqual(len(events), 1)
        self.assertEqual(events[0]["status"], "awaiting-confirmation")
        self.assertEqual(events[0]["details"]["commandCount"], 1)
        self.assertEqual(events[0]["details"]["interfaces"], ["ge-0/0/1"])
        self.assertNotIn("Camera", json.dumps(events))
        self.client.post("/api/confirm", json={**payload, "config": "", "confirmationFor": result["activityId"]})
        events = ActivityLog(self.path).read(host="switch-a")["events"]
        self.assertEqual(events[0]["status"], "confirmed")
        self.assertEqual(events[1]["confirmationState"], "confirmed")
        self.assertNotIn("ssh-secret", self.path.read_bytes().decode("latin1"))

    @patch("app._execute_cli", return_value=("error: invalid value\nconfiguration check-out failed", "", 0))
    @patch("app._ssh_client", return_value=Mock())
    def test_failed_check_is_logged_as_not_committed(self, ssh, execute):
        self.client.post("/api/push", json={"host": "switch-a", "username": "netops", "config": "set system host-name invalid"})
        event = self.client.get("/api/activity?host=switch-a").get_json()["events"][0]
        self.assertEqual(event["status"], "check-failed")
        self.assertIn("No commit request was sent", event["message"])
        self.assertIn("invalid value", event["details"]["error"])
        execute.assert_called_once()

    @patch("app._execute_cli", side_effect=OSError("SSH channel closed"))
    @patch("app._ssh_client", return_value=Mock())
    def test_lost_response_is_not_reported_as_a_successful_commit(self, ssh, execute):
        self.client.post("/api/push", json={"host": "switch-a", "username": "netops", "config": "set system host-name test"})
        event = ActivityLog(self.path).read()["events"][0]
        self.assertEqual(event["status"], "unverified")

    @patch("app._execute_cli", return_value=("error: invalid password supplied", "", 1))
    @patch("app._ssh_client", return_value=Mock())
    def test_secret_values_and_raw_config_are_excluded_from_history(self, ssh, execute):
        secret = "private-config-secret"
        with patch("app._execute_cli", return_value=(f'error: set system root-authentication encrypted-password "{secret}"', "", 0)):
            self.client.post("/api/push", json={"host": "switch-a", "username": "netops", "password": "ssh-secret",
                "config": f'set system root-authentication encrypted-password "{secret}"'})
        events = json.dumps(ActivityLog(self.path).read()["events"])
        self.assertNotIn(secret, events)
        self.assertNotIn("ssh-secret", events)
        self.assertNotIn("batchFingerprint", events)
        for config in (
            'set security ike policy test pre-shared-key ascii-text "abcdefgh"',
            'set system root-authentication encrypted-password "abcdefgh',
        ):
            cleaned = app._activity_clean("error: invalid value abcdefgh", {"config": config})
            self.assertNotIn("abcdefgh", cleaned)

    @patch("app.ActivityLog.append", side_effect=sqlite3.OperationalError("read only"))
    @patch("app._execute_cli", return_value=("commit complete", "", 0))
    @patch("app._ssh_client", return_value=Mock())
    def test_storage_failure_does_not_change_commit_outcome_and_is_reported(self, ssh, execute, append):
        result = self.client.post("/api/confirm", json={"host": "switch-a", "username": "netops"})
        self.assertEqual(result.status_code, 200)
        self.assertTrue(result.get_json()["ok"])
        self.assertIn("activityWarning", result.get_json())
        self.assertIn("Some actions may be missing", app.ACTIVITY_LAST_ERROR)

    def test_browser_errors_are_persisted_and_invalid_filters_rejected(self):
        self.client.post("/api/activity/browser-error", json={"host": "switch-a", "message": "Unexpected script failure", "source": "script.js"})
        event = self.client.get("/api/activity?host=switch-a&view=errors").get_json()["events"][0]
        self.assertEqual(event["operation"], "Browser error")
        self.assertEqual(event["details"]["source"], "script.js")
        self.assertEqual(self.client.get("/api/activity?before=invalid").status_code, 400)
        self.assertEqual(self.client.get("/api/activity?view=invalid").status_code, 400)
        self.assertEqual(self.client.get("/activity.sqlite3").status_code, 404)

    def test_source_and_packaged_runs_share_local_app_data_history(self):
        with patch.dict(app.app.config, {"ACTIVITY_LOG_PATH": None}), patch.dict(app.os.environ, {
            "LOCALAPPDATA": self.directory, "JUNOS_HELPER_ACTIVITY_LOG_PATH": "",
        }):
            for frozen in (False, True):
                with patch.object(app, "IS_FROZEN", frozen):
                    self.assertEqual(app._activity_store().path, Path(self.directory) / "Junos Helper" / "activity.sqlite3")

    def test_data_and_history_are_options_popups_outside_the_workspace(self):
        with self.client.get("/") as response:
            html = response.get_data(as_text=True)
        self.assertNotIn("Diagnostics output", html)
        self.assertIn('id="openDeviceDataBtn"', html)
        self.assertIn('id="openActivityLogBtn"', html)
        self.assertIn('<dialog id="deviceDataDialog"', html)
        self.assertIn('<dialog id="activityLogDialog"', html)
        self.assertNotIn('id="deviceDataOutput"', html.split("</main>")[0])

    @patch("app._run_command")
    @patch("app._ssh_client", return_value=Mock())
    def test_partial_data_pull_is_a_warning_and_not_a_change(self, ssh, run):
        run.side_effect = lambda client, command: ("", "error: unavailable") if command == "show interfaces media" else ("", "")
        response = self.client.post("/api/connect", json={"host": "switch-a", "username": "netops", "isRefresh": True})
        self.assertEqual(response.status_code, 200)
        self.assertIn("collectedAt", response.get_json())
        event = ActivityLog(self.path).read(host="switch-a", view="errors")["events"][0]
        self.assertEqual(event["operation"], "Data refresh")
        self.assertEqual(event["status"], "partial")
        self.assertEqual(event["category"], "data")
        self.assertEqual(event["details"]["commandErrors"][0]["command"], "show interfaces media")
