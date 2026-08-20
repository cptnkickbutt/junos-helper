import unittest
import tempfile
from pathlib import Path
from unittest.mock import Mock, patch

import app as app_module
from app import (
    _clean_compare_output,
    _cli_failure_message,
    _connection_values,
    _configured_interface_names,
    _enrich_lldp_neighbor,
    _mac_manufacturer,
    _parse_interface_details,
    _parse_interface_speeds,
    _parse_interface_configuration,
    _parse_interfaces,
    _parse_ethernet_switching_table,
    _parse_lldp_neighbors,
    _parse_configured_vlans,
    _parse_vlan_memberships,
    _run_command,
    _ssh_client,
    _validated_config_lines,
    app,
)


class PackagedEnvironmentTests(unittest.TestCase):
    def test_packaged_environment_uses_local_app_data(self) -> None:
        with patch.object(app_module, "IS_FROZEN", True), patch.dict(
            app_module.os.environ, {"LOCALAPPDATA": r"C:\Users\tester\AppData\Local"}, clear=False
        ):
            self.assertEqual(
                app_module._environment_path(),
                Path(r"C:\Users\tester\AppData\Local") / "Junos Helper" / ".env",
            )

    def test_packaged_environment_copies_seed_only_once(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory)
            resource_dir = base / "resources"
            resource_dir.mkdir()
            seed = resource_dir / ".env"
            seed.write_text("JUNOS_HOST=192.0.2.10\n", encoding="utf-8")
            destination = base / "data" / ".env"

            with patch.object(app_module, "IS_FROZEN", True), patch.object(
                app_module, "RESOURCE_DIR", resource_dir
            ):
                app_module._prepare_environment(destination)
                self.assertEqual(destination.read_text(encoding="utf-8"), "JUNOS_HOST=192.0.2.10\n")

                seed.write_text("JUNOS_HOST=192.0.2.20\n", encoding="utf-8")
                app_module._prepare_environment(destination)
                self.assertEqual(destination.read_text(encoding="utf-8"), "JUNOS_HOST=192.0.2.10\n")


class RunCommandTests(unittest.TestCase):
    def test_prefers_junos_cli_variant(self) -> None:
        client = Mock()

        def fake_exec_command(command: str):
            if command == "cli -c 'show interfaces terse'":
                stdout = Mock()
                stdout.read.return_value = b"Physical interface: ge-0/0/0, Enabled, up\n"
                stderr = Mock()
                stderr.read.return_value = b""
                return Mock(), stdout, stderr
            stdout = Mock()
            stdout.read.return_value = b"show: Command not found.\n"
            stderr = Mock()
            stderr.read.return_value = b""
            return Mock(), stdout, stderr

        client.exec_command.side_effect = fake_exec_command

        output, error = _run_command(client, "show interfaces terse")

        self.assertIn("Physical interface", output)
        self.assertEqual("", error)
        self.assertEqual(client.exec_command.call_args_list[0].args[0], "cli -c 'show interfaces terse'")


class SSHClientTests(unittest.TestCase):
    @patch("app._env_flag", return_value=True)
    @patch("app.paramiko.SSHClient")
    def test_lab_mode_automatically_accepts_unknown_host_keys(
        self, ssh_client_class: Mock, _env_flag: Mock
    ) -> None:
        client = ssh_client_class.return_value

        _ssh_client("192.0.2.10", "netops", "test")

        policy = client.set_missing_host_key_policy.call_args.args[0]
        self.assertEqual(policy.__class__.__name__, "AutoAddPolicy")
        client.connect.assert_called_once()


class DiscoveryParsingTests(unittest.TestCase):
    def test_parse_ethernet_switching_table_groups_macs_by_physical_port(self) -> None:
        output = "\n".join([
            "VLAN              MAC address       Type         Age Interfaces",
            "CAMERAS           00:11:22:33:44:55 Learn          0 ge-0/0/2.0",
            "VOICE             aa:bb:cc:dd:ee:ff Learn          4 ge-0/0/2.0",
        ])

        with patch("app._mac_manufacturer", return_value="Test Vendor"):
            parsed = _parse_ethernet_switching_table(output)

        self.assertEqual(parsed, {
            "ge-0/0/2": [
                {"mac": "00:11:22:33:44:55", "manufacturer": "Test Vendor", "vlan": "CAMERAS"},
                {"mac": "aa:bb:cc:dd:ee:ff", "manufacturer": "Test Vendor", "vlan": "VOICE"},
            ]
        })

    def test_parse_lldp_neighbor_detail_collects_device_identity(self) -> None:
        output = "\n".join([
            "LLDP Neighbor Information:",
            "Local interface    : ge-0/0/2.0",
            "Chassis ID         : 00:11:22:33:44:55",
            "Port ID            : GigabitEthernet1/0/24",
            "Port description   : Uplink to closet",
            "System name        : camera-sw-01",
            "System description : Juniper Networks EX2300",
            "System capabilities: Bridge Router",
            "Enabled capabilities: Bridge",
            "MED Manufacturer name: Juniper Networks",
            "MED Model name     : EX2300",
        ])

        self.assertEqual(_parse_lldp_neighbors(output)["ge-0/0/2"], {
            "chassisId": "00:11:22:33:44:55",
            "portId": "GigabitEthernet1/0/24",
            "portDescription": "Uplink to closet",
            "systemName": "camera-sw-01",
            "systemDescription": "Juniper Networks EX2300",
            "systemCapabilities": "Bridge Router",
            "enabledCapabilities": "Bridge",
            "manufacturer": "Juniper Networks",
            "model": "EX2300",
        })

    def test_mac_manufacturer_uses_offline_database_and_ignores_private_addresses(self) -> None:
        self.assertEqual(_mac_manufacturer("00:05:85:00:00:01"), "Juniper Networks")
        self.assertEqual(_mac_manufacturer("02:00:00:00:00:01"), "")

    @patch("app._mac_manufacturer", return_value="Juniper Networks")
    def test_lldp_neighbor_manufacturer_falls_back_to_chassis_oui(self, _lookup: Mock) -> None:
        enriched = _enrich_lldp_neighbor({"chassisId": "00:05:85:00:00:01"}, [])
        self.assertEqual(enriched["manufacturer"], "Juniper Networks")

    def test_parse_interface_details_includes_admin_state(self) -> None:
        output = "\n".join([
            "admin up",
            "ge-0/0/0 up up",
            "ge-0/0/1 down up",
        ])

        details = _parse_interface_details(output)

        self.assertEqual(details[0]["name"], "ge-0/0/0")
        self.assertEqual(details[0]["admin"], "up")
        self.assertEqual(details[0]["oper"], "up")
        self.assertEqual(details[1]["name"], "ge-0/0/1")
        self.assertEqual(details[1]["admin"], "down")
        self.assertEqual(details[1]["oper"], "up")

    def test_parse_interface_speeds_collects_physical_media_rate(self) -> None:
        output = "\n".join([
            "Physical interface: ge-0/0/0, Enabled, Physical link is Up",
            "  Link-level type: Ethernet, MTU: 1514, Speed: 1000mbps, BPDU Error: None",
            "  Link mode: Full-duplex, Flow control: None, Remote fault: OK, Link partner Speed: 100 Mbps",
            "Physical interface: mge-0/0/1, Enabled, Physical link is Up",
            "  Link-level type: Ethernet, MTU: 1514, Speed: 2500Mbps, BPDU Error: None",
            "  Link mode: Full-duplex, Flow control: None, Remote fault: OK, Link partner Speed: 2.5Gbps",
            "Physical interface: ge-0/0/2, Enabled, Physical link is Down",
            "  Link-level type: Ethernet, MTU: 1514, Speed: Unspecified, BPDU Error: None",
        ])

        self.assertEqual(_parse_interface_speeds(output), {
            "ge-0/0/0": {"capability": "1 Gbps", "negotiated": "100 Mbps"},
            "mge-0/0/1": {"capability": "2.5 Gbps", "negotiated": "2.5 Gbps"},
        })

    def test_parse_vlan_memberships_extracts_names_and_values(self) -> None:
        output = "\n".join([
            "Name           Tag  Interfaces",
            "default        1",
            "prod           100",
            "voice          200",
        ])

        memberships = _parse_vlan_memberships(output)

        self.assertEqual(memberships[0]["name"], "default")
        self.assertEqual(memberships[0]["value"], "1")
        self.assertEqual(memberships[1]["name"], "prod")
        self.assertEqual(memberships[1]["value"], "100")

    def test_parse_vlan_memberships_with_routing_instance_column(self) -> None:
        output = "\n".join([
            "Routing instance        VLAN name             Tag          Interfaces",
            "default-switch          default               1",
            "default-switch          users                 100          ge-0/0/1.0*",
            "default-switch          voice                 200",
        ])

        self.assertEqual(_parse_vlan_memberships(output), [
            {"name": "default", "value": "1"},
            {"name": "users", "value": "100"},
            {"name": "voice", "value": "200"},
        ])

    def test_parse_configured_vlans_from_display_set(self) -> None:
        output = "\n".join([
            "set vlans TEST_AV vlan-id 25",
            "set vlans TEST_ENV vlan-id 23",
            "set vlans TEST_ENV l3-interface irb.23",
        ])

        self.assertEqual(_parse_configured_vlans(output), [
            {"name": "TEST_AV", "value": "25"},
            {"name": "TEST_ENV", "value": "23"},
        ])

    def test_parse_interface_configuration_uses_exact_names(self) -> None:
        output = "\n".join([
            'set interfaces ge-0/0/1 description "Camera #1"',
            "set interfaces ge-0/0/1 unit 0 family ethernet-switching interface-mode access",
            "set interfaces ge-0/0/1 unit 0 family ethernet-switching vlan members TEST_ENV",
            "set interfaces xe-0/2/0 unit 0 family ethernet-switching interface-mode trunk",
            "set interfaces xe-0/2/0 unit 0 family ethernet-switching vlan members [ TEST_AV TEST_GUEST ]",
        ])

        parsed = _parse_interface_configuration(output)
        self.assertEqual(parsed["ge-0/0/1"]["mode"], "access")
        self.assertEqual(parsed["ge-0/0/1"]["modeKeyword"], "interface-mode")
        self.assertEqual(parsed["ge-0/0/1"]["description"], "Camera #1")
        self.assertEqual(parsed["ge-0/0/1"]["vlans"], ["TEST_ENV"])
        self.assertEqual(len(parsed["ge-0/0/1"]["setLines"]), 3)
        self.assertEqual(parsed["xe-0/2/0"]["mode"], "trunk")
        self.assertEqual(parsed["xe-0/2/0"]["vlans"], ["TEST_AV", "TEST_GUEST"])

    def test_configured_interfaces_require_vlan_membership(self) -> None:
        configuration = {
            "ge-0/0/1": {"description": "XX_UNUSED", "disabled": True, "vlans": []},
            "ge-0/0/2": {"description": "01_Camera", "vlans": ["CAMERAS"]},
            "xe-0/2/0": {"mode": "trunk", "vlans": ["DATA", "VOICE"]},
        }

        self.assertEqual(
            _configured_interface_names(configuration),
            {"ge-0/0/2", "xe-0/2/0"},
        )

    def test_logical_unit_does_not_overwrite_physical_state(self) -> None:
        output = "\n".join([
            "Interface               Admin Link Proto    Local                 Remote",
            "ge-0/0/0               up    up",
            "ge-0/0/0.0             up    up   eth-switch",
        ])

        details = _parse_interface_details(output)

        self.assertEqual(details, [{
            "name": "ge-0/0/0",
            "admin": "up",
            "oper": "up",
            "raw": "ge-0/0/0               up    up",
        }])

    def test_parse_interfaces_supports_aggregated_and_mge_ports(self) -> None:
        output = "ae0 up up\nmge-0/0/0 down down\nae0.0 up up"

        self.assertEqual(_parse_interfaces(output), ["ae0", "mge-0/0/0"])


class ConfigValidationTests(unittest.TestCase):
    def test_accepts_interface_set_and_delete_commands(self) -> None:
        config = "\n".join([
            "# generated config",
            'set interfaces ge-0/0/1 description "Desk A"',
            "delete interfaces ae0 unit 0 family ethernet-switching vlan members 100",
        ])

        self.assertEqual(len(_validated_config_lines(config)), 2)

    def test_accepts_full_interface_configuration_delete(self) -> None:
        self.assertEqual(
            _validated_config_lines("delete interfaces xe-0/2/0"),
            ["delete interfaces xe-0/2/0"],
        )

    def test_accepts_strict_vlan_creation(self) -> None:
        self.assertEqual(
            _validated_config_lines("set vlans CAMERAS vlan-id 325"),
            ["set vlans CAMERAS vlan-id 325"],
        )

    def test_rejects_out_of_range_vlan(self) -> None:
        with self.assertRaisesRegex(ValueError, "between 1 and 4094"):
            _validated_config_lines("set vlans CAMERAS vlan-id 5000")

    def test_compare_cleanup_removes_cli_mode_noise(self) -> None:
        output = "Entering configuration mode\n[edit interfaces ge-0/0/1]\n+ description Camera;\nExiting configuration mode\n"

        self.assertEqual(
            _clean_compare_output(output),
            "[edit interfaces ge-0/0/1]\n+ description Camera;",
        )

    def test_cli_failure_message_surfaces_junos_stdout_errors(self) -> None:
        output = "Entering configuration mode\nerror: commit comment is required\nExiting configuration mode"

        self.assertEqual(
            _cli_failure_message(output, "", "Commit failed."),
            "error: commit comment is required",
        )

    def test_rejects_non_interface_commands(self) -> None:
        with self.assertRaisesRegex(ValueError, "Only"):
            _validated_config_lines("set system root-authentication plain-text-password")

    def test_rejects_cli_delimiters(self) -> None:
        with self.assertRaisesRegex(ValueError, "Unsafe"):
            _validated_config_lines("set interfaces ge-0/0/1 disable; run show configuration")


class ApiSafetyTests(unittest.TestCase):
    def test_only_public_frontend_assets_are_served(self) -> None:
        client = app.test_client()

        for public_path in ("/", "/index.html", "/styles.css", "/script.js"):
            response = client.get(public_path)
            try:
                self.assertEqual(response.status_code, 200, public_path)
            finally:
                response.close()
        for private_path in ("/.env", "/.env.example", "/app.py", "/tests/test_app.py"):
            response = client.get(private_path)
            try:
                self.assertEqual(response.status_code, 404, private_path)
            finally:
                response.close()

    def test_defaults_never_returns_password(self) -> None:
        response = app.test_client().get("/api/defaults")

        self.assertEqual(response.status_code, 200)
        self.assertNotIn("password", response.get_json())

    def test_saved_device_password_stays_server_side_and_supports_quick_connect(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            env_path = Path(directory) / ".env"
            with patch("app.ENV_PATH", env_path):
                save_response = app.test_client().post("/api/devices", json={
                    "hostname": "access-sw-01",
                    "host": "192.0.2.20",
                    "username": "netops",
                    "password": "local-secret",
                })
                self.assertEqual(save_response.status_code, 200)
                device = save_response.get_json()["device"]

                list_response = app.test_client().get("/api/devices")
                listed_device = list_response.get_json()["devices"][0]
                self.assertEqual(listed_device["hostname"], "access-sw-01")
                self.assertNotIn("password", listed_device)

                self.assertEqual(
                    _connection_values({"deviceId": device["id"]}),
                    ("192.0.2.20", "netops", "local-secret"),
                )

                update_response = app.test_client().post("/api/devices", json={
                    "hostname": "access-sw-01",
                    "host": "192.0.2.21",
                    "username": "automation",
                    "password": "updated-secret",
                })
                self.assertEqual(update_response.status_code, 200)
                self.assertEqual(len(app.test_client().get("/api/devices").get_json()["devices"]), 1)
                self.assertEqual(
                    _connection_values({"deviceId": device["id"]}),
                    ("192.0.2.21", "automation", "updated-secret"),
                )

    def test_saved_device_requires_discovered_hostname_and_credentials(self) -> None:
        response = app.test_client().post("/api/devices", json={
            "hostname": "invalid hostname",
            "host": "192.0.2.20",
            "username": "netops",
            "password": "test",
        })

        self.assertEqual(response.status_code, 400)

    def test_saved_devices_are_sorted_numerically_by_ip(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            env_path = Path(directory) / ".env"
            with patch("app.ENV_PATH", env_path):
                for hostname, host in (
                    ("switch-20", "10.0.0.20"),
                    ("switch-100", "10.0.0.100"),
                    ("switch-9", "10.0.0.9"),
                ):
                    response = app.test_client().post("/api/devices", json={
                        "hostname": hostname,
                        "host": host,
                        "username": "netops",
                        "password": "test",
                    })
                    self.assertEqual(response.status_code, 200)

                devices = app.test_client().get("/api/devices").get_json()["devices"]
                self.assertEqual(
                    [device["host"] for device in devices],
                    ["10.0.0.9", "10.0.0.20", "10.0.0.100"],
                )

    @patch("app._run_command")
    @patch("app._ssh_client")
    def test_connect_ignores_browser_supplied_commands(self, ssh_client: Mock, run_command: Mock) -> None:
        ssh_client.return_value = Mock()
        run_command.return_value = ("", "")

        response = app.test_client().post("/api/connect", json={
            "host": "192.0.2.10",
            "username": "netops",
            "password": "test",
            "commands": ["run start shell"],
        })

        self.assertEqual(response.status_code, 200)
        commands = [call.args[1] for call in run_command.call_args_list]
        self.assertNotIn("run start shell", commands)
        self.assertIn("show configuration interfaces | display set", commands)

    @patch("app._run_command")
    @patch("app._ssh_client")
    def test_connect_keeps_all_ports_and_configures_only_vlan_members(
        self, ssh_client: Mock, run_command: Mock
    ) -> None:
        ssh_client.return_value = Mock()

        def discovery_output(_client: Mock, command: str) -> tuple[str, str]:
            if command == "show interfaces terse":
                return "ge-0/0/1 down down\nge-0/0/2 up up", ""
            if command == "show interfaces media":
                return "\n".join([
                    "Physical interface: ge-0/0/2, Enabled, Physical link is Up",
                    "  Link-level type: Ethernet, MTU: 1514, Speed: 1000mbps, BPDU Error: None",
                    "  Link mode: Full-duplex, Flow control: None, Remote fault: OK, Link partner Speed: 100 Mbps",
                ]), ""
            if command == "show ethernet-switching table":
                return "CAMERAS 00:11:22:33:44:55 Learn 0 ge-0/0/2.0", ""
            if command == "show lldp neighbors detail":
                return "\n".join([
                    "Local interface : ge-0/0/2.0",
                    "System name : camera-01",
                    "Port description : Lobby camera",
                ]), ""
            if command == "show configuration interfaces | display set":
                return "\n".join([
                    'set interfaces ge-0/0/1 description "XX_UNUSED"',
                    "set interfaces ge-0/0/1 disable",
                    'set interfaces ge-0/0/2 description "01_Camera"',
                    "set interfaces ge-0/0/2 unit 0 family ethernet-switching vlan members CAMERAS",
                ]), ""
            return "", ""

        run_command.side_effect = discovery_output

        response = app.test_client().post("/api/connect", json={
            "host": "192.0.2.10",
            "username": "netops",
            "password": "test",
        })

        payload = response.get_json()
        details = {item["name"]: item for item in payload["interfaceDetails"]}
        self.assertEqual(payload["interfaces"], ["ge-0/0/1", "ge-0/0/2"])
        self.assertEqual(payload["configuredInterfaces"], ["ge-0/0/2"])
        self.assertFalse(details["ge-0/0/1"]["configured"])
        self.assertTrue(details["ge-0/0/2"]["configured"])
        self.assertEqual(details["ge-0/0/2"]["negotiatedSpeed"], "100 Mbps")
        self.assertEqual(details["ge-0/0/2"]["speedCapability"], "1 Gbps")
        self.assertEqual(details["ge-0/0/2"]["learnedMacs"], [
            {"mac": "00:11:22:33:44:55", "manufacturer": "CIMSYS Inc", "vlan": "CAMERAS"}
        ])
        self.assertEqual(details["ge-0/0/2"]["lldpNeighbor"]["systemName"], "camera-01")

    @patch("app._execute_cli")
    @patch("app._ssh_client")
    def test_push_uses_confirmed_commit(self, ssh_client: Mock, execute_cli: Mock) -> None:
        ssh_client.return_value = Mock()
        execute_cli.return_value = ("commit complete\n", "", 0)

        response = app.test_client().post("/api/push", json={
            "host": "192.0.2.10",
            "username": "netops",
            "password": "test",
            "config": "set interfaces ge-0/0/1 disable",
        })

        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.get_json()["pendingConfirmation"])
        self.assertTrue(execute_cli.call_args.args[1].startswith("configure exclusive;"))
        self.assertIn('commit check; commit confirmed 5 comment "Applied by Junos Helper"', execute_cli.call_args.args[1])

    @patch("app._execute_cli")
    @patch("app._ssh_client")
    def test_confirm_commit_includes_required_comment(self, ssh_client: Mock, execute_cli: Mock) -> None:
        ssh_client.return_value = Mock()
        execute_cli.return_value = ("commit complete\n", "", 0)

        response = app.test_client().post("/api/confirm", json={
            "host": "192.0.2.10",
            "username": "netops",
            "password": "test",
        })

        self.assertEqual(response.status_code, 200)
        self.assertTrue(execute_cli.call_args.args[1].startswith("configure exclusive;"))
        self.assertIn('commit comment "Confirmed by Junos Helper"', execute_cli.call_args.args[1])

    @patch("app._execute_cli")
    @patch("app._ssh_client")
    def test_push_returns_junos_stdout_error(self, ssh_client: Mock, execute_cli: Mock) -> None:
        ssh_client.return_value = Mock()
        execute_cli.return_value = ("error: permission denied\n", "", 1)

        response = app.test_client().post("/api/push", json={
            "host": "192.0.2.10",
            "username": "netops",
            "password": "test",
            "config": "set interfaces ge-0/0/1 disable",
        })

        self.assertEqual(response.status_code, 502)
        self.assertEqual(response.get_json()["error"], "error: permission denied")

    @patch("app._execute_cli")
    @patch("app._ssh_client")
    def test_preview_uses_compare_and_rolls_back_candidate(self, ssh_client: Mock, execute_cli: Mock) -> None:
        ssh_client.return_value = Mock()
        execute_cli.return_value = ("[edit interfaces ge-0/0/1]\n+ description Camera;", "", 0)

        response = app.test_client().post("/api/preview", json={
            "host": "192.0.2.10",
            "username": "netops",
            "password": "test",
            "config": 'set interfaces ge-0/0/1 description "Camera"',
        })

        self.assertEqual(response.status_code, 200)
        self.assertIn("description Camera", response.get_json()["compare"])
        self.assertIn("show | compare; rollback 0; exit", execute_cli.call_args.args[1])


if __name__ == "__main__":
    unittest.main()
