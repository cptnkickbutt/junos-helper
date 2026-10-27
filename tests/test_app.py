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
    _interface_name_capability,
    _interface_sort_key,
    _mac_manufacturer,
    _parse_interface_details,
    _parse_interface_speeds,
    _parse_interface_configuration,
    _parse_irb_configuration,
    _parse_interfaces,
    _parse_ethernet_switching_table,
    _parse_lldp_neighbors,
    _preferred_interface_names,
    _parse_configured_vlans,
    _parse_vlan_memberships,
    _parse_vlan_l3_interfaces,
    _parse_vlan_interface_members,
    _run_command,
    _ssh_client,
    _validated_config_lines,
    _validated_description_only_lines,
    app,
)



def setUpModule():
    global _activity_directory, _activity_config
    _activity_directory = tempfile.TemporaryDirectory()
    _activity_config = patch.dict(app_module.app.config, {"ACTIVITY_LOG_PATH": Path(_activity_directory.name) / "activity.sqlite3"})
    _activity_config.start()


def tearDownModule():
    _activity_config.stop()
    _activity_directory.cleanup()


class PackagedEnvironmentTests(unittest.TestCase):
    def test_packaged_environment_uses_local_app_data(self) -> None:
        with patch.object(app_module, "IS_FROZEN", True), patch.dict(
            app_module.os.environ, {"LOCALAPPDATA": r"C:\Users\tester\AppData\Local"}, clear=False
        ):
            self.assertEqual(
                app_module._environment_path(),
                Path(r"C:\Users\tester\AppData\Local") / "Junos Helper" / ".env",
            )

    def test_packaged_environment_merges_new_device_seed_without_replacing_local_values(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory)
            resource_dir = base / "resources"
            resource_dir.mkdir()
            seed = resource_dir / ".env"
            seed.write_text(
                "JUNOS_HOST=192.0.2.10\n"
                "JUNOS_DEVICE_SHARED_GROUP='Original'\n",
                encoding="utf-8",
            )
            destination = base / "data" / ".env"

            with patch.object(app_module, "IS_FROZEN", True), patch.object(
                app_module, "RESOURCE_DIR", resource_dir
            ):
                app_module._prepare_environment(destination)
                first_values = app_module.dotenv_values(destination)
                self.assertEqual(first_values["JUNOS_HOST"], "192.0.2.10")
                self.assertEqual(first_values["JUNOS_DEVICE_SHARED_GROUP"], "Original")
                self.assertIn(app_module.DEVICE_SEED_HASH_KEY, first_values)

                app_module._persist_dotenv_values(destination, {
                    "JUNOS_DEVICE_COWORKER_HOSTNAME": "coworker-only",
                })

                seed.write_text(
                    "JUNOS_HOST=192.0.2.20\n"
                    "JUNOS_DEVICE_SHARED_GROUP='Updated'\n",
                    encoding="utf-8",
                )
                app_module._prepare_environment(destination)
                updated_values = app_module.dotenv_values(destination)
                self.assertEqual(updated_values["JUNOS_HOST"], "192.0.2.10")
                self.assertEqual(updated_values["JUNOS_DEVICE_SHARED_GROUP"], "Updated")
                self.assertEqual(updated_values["JUNOS_DEVICE_COWORKER_HOSTNAME"], "coworker-only")


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

    def test_parse_irb_addresses_and_vlan_bindings(self) -> None:
        interface_output = "\n".join([
            "set interfaces irb unit 310 family inet address 192.0.2.1/24",
            "set interfaces irb unit 310 family inet address 192.0.2.2/24",
            "set interfaces irb unit 999 family inet6 address 2001:db8::1/64",
        ])
        vlan_output = "\n".join([
            "set vlans TEST_MGMT vlan-id 310",
            "set vlans TEST_MGMT l3-interface irb.310",
            "set vlans TEST_QINQ interface ge-0/0/17.300",
            "set vlans TEST_QINQ interface xe-0/2/0.300",
        ])

        self.assertEqual(_parse_irb_configuration(interface_output), [
            {"unit": 310, "addresses": ["192.0.2.1/24", "192.0.2.2/24"]},
        ])
        self.assertEqual(_parse_vlan_l3_interfaces(vlan_output), {"TEST_MGMT": "irb.310"})
        self.assertEqual(_parse_vlan_interface_members(vlan_output), [{
            "name": "TEST_QINQ",
            "interfaces": ["ge-0/0/17.300", "xe-0/2/0.300"],
        }])

    def test_parse_interface_configuration_uses_exact_names(self) -> None:
        output = "\n".join([
            'set interfaces ge-0/0/1 description "Camera #1"',
            "set interfaces ge-0/0/1 unit 0 family ethernet-switching interface-mode access",
            "set interfaces ge-0/0/1 unit 0 family ethernet-switching vlan members TEST_ENV",
            "set interfaces xe-0/2/0 unit 0 family ethernet-switching interface-mode trunk",
            "set interfaces xe-0/2/0 native-vlan-id 25",
            "set interfaces xe-0/2/0 unit 0 family ethernet-switching vlan members [ TEST_AV TEST_GUEST ]",
        ])

        parsed = _parse_interface_configuration(output)
        self.assertEqual(parsed["ge-0/0/1"]["mode"], "access")
        self.assertEqual(parsed["ge-0/0/1"]["modeKeyword"], "interface-mode")
        self.assertEqual(parsed["ge-0/0/1"]["description"], "Camera #1")
        self.assertEqual(parsed["ge-0/0/1"]["vlans"], ["TEST_ENV"])
        self.assertEqual(len(parsed["ge-0/0/1"]["setLines"]), 3)
        self.assertEqual(parsed["xe-0/2/0"]["mode"], "trunk")
        self.assertEqual(parsed["xe-0/2/0"]["nativeVlanId"], "25")
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

    def test_parse_interfaces_keeps_ex4650_channelized_ports_distinct(self) -> None:
        output = "\n".join([
            "Interface               Admin Link Proto    Local                 Remote",
            "et-0/0/0:0             up    up",
            "et-0/0/0:0.0           up    up   eth-switch",
            "et-0/0/0:1             up    down",
            "et-0/0/0:2             up    up",
            "et-0/0/0:3             down  down",
            "et-0/0/1               up    up",
        ])

        self.assertEqual(_parse_interfaces(output), [
            "et-0/0/0:0",
            "et-0/0/0:1",
            "et-0/0/0:2",
            "et-0/0/0:3",
            "et-0/0/1",
        ])
        self.assertEqual(
            [(detail["name"], detail["admin"], detail["oper"])
             for detail in _parse_interface_details(output)],
            [
                ("et-0/0/0:0", "up", "up"),
                ("et-0/0/0:1", "up", "down"),
                ("et-0/0/0:2", "up", "up"),
                ("et-0/0/0:3", "down", "down"),
                ("et-0/0/1", "up", "up"),
            ],
        )

        configuration = _parse_interface_configuration("\n".join([
            'set interfaces et-0/0/0:0 description "Lane zero"',
            'set interfaces et-0/0/0:1 description "Lane one"',
        ]))
        self.assertEqual(set(configuration), {"et-0/0/0:0", "et-0/0/0:1"})

        macs = _parse_ethernet_switching_table("\n".join([
            "DATA 00:11:22:33:44:55 Learn 0 et-0/0/0:0.0",
            "DATA 00:11:22:33:44:66 Learn 0 et-0/0/0:1.0",
        ]))
        self.assertEqual(set(macs), {"et-0/0/0:0", "et-0/0/0:1"})

    def test_interface_inventory_sort_uses_physical_port_order(self) -> None:
        interfaces = [
            "et-0/0/55",
            "xe-0/0/12",
            "et-0/0/48",
            "xe-0/0/2",
            "xe-0/0/0",
            "ae0",
        ]

        self.assertEqual(sorted(interfaces, key=_interface_sort_key), [
            "xe-0/0/0",
            "xe-0/0/2",
            "xe-0/0/12",
            "et-0/0/48",
            "et-0/0/55",
            "ae0",
        ])

    def test_ex4100_inventory_keeps_access_and_uplink_banks_separate(self) -> None:
        interfaces = [
            "xe-0/2/0",
            "ge-0/0/16",
            "xe-0/0/1",
            "mge-0/0/1",
            "xe-0/1/0",
            "mge-0/0/0",
        ]

        self.assertEqual(
            sorted(interfaces, key=lambda name: _interface_sort_key(name, "EX4100-48MP")),
            [
                "mge-0/0/0",
                "mge-0/0/1",
                "ge-0/0/16",
                "xe-0/0/1",
                "xe-0/1/0",
                "xe-0/2/0",
            ],
        )

    def test_faster_et_alias_replaces_xe_without_collapsing_mge(self) -> None:
        self.assertEqual(_preferred_interface_names([
            "xe-0/1/0",
            "et-0/1/0",
            "mge-0/0/1",
            "xe-0/0/1",
        ]), [
            "et-0/1/0",
            "mge-0/0/1",
            "xe-0/0/1",
        ])

    def test_ex4400_uses_fastest_prefix_for_each_physical_port(self) -> None:
        self.assertEqual(_preferred_interface_names([
            "ge-0/0/0",
            "xe-0/0/0",
            "xe-0/1/0",
            "et-0/1/0",
        ], "EX4400-24X"), [
            "xe-0/0/0",
            "et-0/1/0",
        ])

    def test_interface_name_capability_infers_fixed_rate_prefixes(self) -> None:
        self.assertEqual(_interface_name_capability("xe-0/0/47"), "10 Gbps")
        self.assertEqual(_interface_name_capability("et-0/0/48"), "100 Gbps")
        self.assertEqual(_interface_name_capability("mge-0/0/0"), "2.5 Gbps")


class ConfigValidationTests(unittest.TestCase):
    def test_accepts_per_interface_rstp_custom_commands(self) -> None:
        commands = [
            "set protocols rstp interface ge-0/0/1 disable",
            "set protocols rstp interface et-0/0/0:1 edge",
            "delete protocols rstp interface ge-0/0/2 disable",
            "delete protocols rstp interface ae0",
        ]
        self.assertEqual(_validated_config_lines("\n".join(commands)), commands)
        with self.assertRaisesRegex(ValueError, "description"):
            _validated_description_only_lines("\n".join(commands))

    def test_rejects_non_configuration_commands_and_invalid_framing(self) -> None:
        for command in (
            "set", "delete", "set ''", "show configuration", "run show version", "commit",
            "set protocols rstp interface ge-0/0/1 disable; commit",
            "set system host-name test | save /tmp/config",
            'set system host-name "unterminated', "set system host-name test\x00",
            "set system host-name test\x1b", "set system host-name `id`",
        ):
            with self.subTest(command=command), self.assertRaises(ValueError):
                _validated_config_lines(command)

    def test_accepts_interface_set_and_delete_commands(self) -> None:
        config = "\n".join([
            "# generated config",
            'set interfaces ge-0/0/1 description "Desk A"',
            "delete interfaces ae0 unit 0 family ethernet-switching vlan members 100",
        ])

        self.assertEqual(len(_validated_config_lines(config)), 2)

    def test_accepts_combined_queued_batches_with_comment_boundaries(self) -> None:
        config = "\n".join([
            "# Queued batch 1: Hallway AP descriptions",
            'set interfaces ge-0/0/1 description "Hallway AP 1"',
            "# Queued batch 2: Hallway AP port setup",
            "set interfaces ge-0/0/1 unit 0 family ethernet-switching interface-mode trunk",
            "set interfaces ge-0/0/1 unit 0 family ethernet-switching vlan members AP_MGMT",
        ])

        self.assertEqual(len(_validated_config_lines(config)), 3)

    def test_description_quick_commit_accepts_queued_set_and_delete_commands(self) -> None:
        config = "\n".join([
            "# Queued batch 1: Hallway AP descriptions",
            'set interfaces ge-0/0/1 description "Hallway AP 01"',
            "# Queued batch 2: Clear old label",
            "delete interfaces mge-0/0/2 description",
        ])

        self.assertEqual(_validated_description_only_lines(config), [
            'set interfaces ge-0/0/1 description "Hallway AP 01"',
            "delete interfaces mge-0/0/2 description",
        ])

    def test_description_quick_commit_rejects_mixed_or_logical_commands(self) -> None:
        invalid_configs = (
            'set interfaces ge-0/0/1 description "Camera"\nset interfaces ge-0/0/1 disable',
            'set interfaces ge-0/0/1.0 description "Logical unit"',
            "delete interfaces ge-0/0/1",
        )

        for config in invalid_configs:
            with self.subTest(config=config), self.assertRaisesRegex(ValueError, "description"):
                _validated_description_only_lines(config)

    def test_accepts_native_vlan_set_and_delete_commands(self) -> None:
        config = "\n".join([
            "set interfaces ge-0/0/1 native-vlan-id 325",
            "delete interfaces ge-0/0/2 native-vlan-id",
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

    def test_accepts_port_clear_with_leftover_qinq_memberships(self) -> None:
        commands = [
            "delete vlans BT_APT_306_QnQ interface mge-0/0/12.3026",
            "delete vlans BT_APT_306_QnQ interface xe-0/2/0.3026",
            "delete vlans BT_APT_307_QnQ interface mge-0/0/13.3027",
            "delete vlans BT_APT_307_QnQ interface xe-0/2/0.3027",
            "delete interfaces xe-0/2/0 unit 3026",
            "delete interfaces xe-0/2/0 unit 3027",
            "delete interfaces mge-0/0/12",
            "delete interfaces mge-0/0/13",
        ]
        self.assertEqual(_validated_config_lines("\n".join(commands)), commands)
        with self.assertRaises(ValueError):
            _validated_description_only_lines("\n".join(commands))

    def test_accepts_irb_and_qinq_service_commands(self) -> None:
        config = "\n".join([
            "set interfaces irb unit 310 family inet address 192.0.2.1/24",
            "set vlans TEST_MGMT l3-interface irb.310",
            "set interfaces ge-0/0/17 unit 300 encapsulation vlan-bridge",
            "set interfaces xe-0/2/0 unit 300 vlan-tags outer 200",
            "set vlans TEST_QINQ interface ge-0/0/17.300",
            "set vlans TEST_QINQ interface xe-0/2/0.300",
        ])

        self.assertEqual(len(_validated_config_lines(config)), 6)

    def test_configuration_semantics_are_left_to_junos_commit_check(self) -> None:
        commands = ["set interfaces irb unit 310 family inet address nope", "set vlans CAMERAS vlan-id 5000"]
        self.assertEqual(_validated_config_lines("\n".join(commands)), commands)

    def test_accepts_global_deletes_and_extended_configuration(self) -> None:
        commands = [
            "delete vlans TEST_MGMT", "delete protocols rstp", "delete system services telnet",
            "set system ntp server 192.0.2.123", "set protocols rstp interface all disable",
            "set routing-options static route 192.0.2.0/24 discard",
            'set snmp location "Building A"',
        ]
        self.assertEqual(_validated_config_lines("\n".join(commands)), commands)

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

    def test_global_commands_do_not_qualify_for_description_quick_commit(self) -> None:
        with self.assertRaisesRegex(ValueError, "description"):
            _validated_description_only_lines("set system host-name switch-a")

    def test_rejects_cli_delimiters(self) -> None:
        with self.assertRaisesRegex(ValueError, "Unsafe"):
            _validated_config_lines("set interfaces ge-0/0/1 disable; run show configuration")


class ApiSafetyTests(unittest.TestCase):
    @patch("app._execute_cli")
    @patch("app._ssh_client")
    def test_failed_commit_check_never_sends_commit_and_discards_private_candidate(
        self, ssh_client: Mock, execute_cli: Mock
    ) -> None:
        ssh_client.return_value = Mock()
        for result in (
            ("error: invalid value\nconfiguration check-out failed\n", "", 0),
            ("syntax error, expecting <command>\nconfiguration check succeeds\n", "", 0),
            ("configuration check succeeds\n", "error: validation failed", 0),
            ("configuration check succeeds\n", "", 1),
            ("", "", 0),
        ):
            with self.subTest(result=result):
                execute_cli.reset_mock()
                execute_cli.return_value = result
                response = app.test_client().post("/api/push", json={
                    "host": "192.0.2.10", "username": "netops", "password": "test",
                    "config": "set system host-name test-switch",
                })
                self.assertEqual(response.status_code, 422)
                self.assertEqual(response.get_json()["stage"], "commit-check")
                self.assertFalse(response.get_json()["pendingConfirmation"])
                execute_cli.assert_called_once()
                cli = execute_cli.call_args.args[1]
                self.assertIn("set system host-name test-switch; commit check; rollback 0; exit", cli)
                self.assertNotIn("commit confirmed", cli)
                ssh_client.return_value.close.assert_called()

    @patch("app._execute_cli")
    @patch("app._ssh_client")
    def test_global_custom_commands_can_be_compared_checked_and_pushed(
        self, ssh_client: Mock, execute_cli: Mock
    ) -> None:
        ssh_client.return_value = Mock()
        config = "set system ntp server 192.0.2.123\ndelete system services telnet"
        payload = {"host": "192.0.2.10", "username": "netops", "password": "test", "config": config}
        execute_cli.side_effect = [
            ("[edit system ntp]\n+ server 192.0.2.123;", "", 0),
            ("configuration check succeeds\n", "", 0),
            ("commit complete\n", "", 0),
        ]
        self.assertEqual(app.test_client().post("/api/preview", json=payload).status_code, 200)
        response = app.test_client().post("/api/push", json=payload)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(execute_cli.call_count, 3)
        for call in execute_cli.call_args_list:
            for line in config.splitlines():
                self.assertEqual(call.args[1].count(line), 1)

    @patch("app._execute_cli")
    @patch("app._ssh_client")
    def test_preview_reports_configuration_typo_from_junos_stdout(
        self, ssh_client: Mock, execute_cli: Mock
    ) -> None:
        ssh_client.return_value = Mock()
        execute_cli.return_value = ("syntax error: unknown statement ntpp\n", "", 0)
        response = app.test_client().post("/api/preview", json={
            "host": "192.0.2.10", "username": "netops", "config": "set system ntpp server 192.0.2.123",
        })
        self.assertEqual(response.status_code, 502)
        self.assertIn("unknown statement ntpp", response.get_json()["error"])

    @patch("app._execute_cli")
    @patch("app._ssh_client")
    def test_rstp_custom_commands_preview_and_push_with_rollback_protection(
        self, ssh_client: Mock, execute_cli: Mock
    ) -> None:
        ssh_client.return_value = Mock()
        config = "\n".join([
            "set protocols rstp interface ge-0/0/1 disable",
            "set protocols rstp interface ge-0/0/2 disable",
        ])
        payload = {"host": "192.0.2.10", "username": "netops", "password": "test", "config": config}
        execute_cli.return_value = ("[edit protocols rstp]\n+ interface ge-0/0/1 { disable; }", "", 0)
        preview = app.test_client().post("/api/preview", json=payload)
        self.assertEqual(preview.status_code, 200)
        self.assertIn("protocols rstp", preview.get_json()["compare"])
        preview_cli = execute_cli.call_args.args[1]
        for line in config.splitlines():
            self.assertIn(line, preview_cli)
        self.assertIn("show | compare; rollback 0; exit", preview_cli)

        execute_cli.side_effect = [("configuration check succeeds\n", "", 0), ("commit complete\n", "", 0)]
        push = app.test_client().post("/api/push", json=payload)
        self.assertEqual(push.status_code, 200)
        self.assertTrue(push.get_json()["pendingConfirmation"])
        push_cli = execute_cli.call_args.args[1]
        for line in config.splitlines():
            self.assertIn(line, push_cli)
        self.assertIn("commit check; commit confirmed 5", push_cli)

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

    def test_health_reports_whether_shutdown_is_available(self) -> None:
        with patch.object(app_module, "IS_FROZEN", False):
            source_health = app.test_client().get("/api/health").get_json()
        with patch.object(app_module, "IS_FROZEN", True):
            packaged_health = app.test_client().get("/api/health").get_json()

        self.assertEqual(source_health["apiVersion"], app_module.API_VERSION)
        self.assertEqual(source_health["appVersion"], app_module.APP_VERSION)
        self.assertFalse(source_health["packaged"])
        self.assertTrue(packaged_health["packaged"])

    def test_shutdown_is_packaged_local_and_same_origin_only(self) -> None:
        client = app.test_client()
        headers = {"X-Junos-Helper": "shutdown"}
        with patch.object(app_module, "_schedule_process_shutdown") as schedule_shutdown:
            with patch.object(app_module, "IS_FROZEN", False):
                source_response = client.post(
                    "/api/shutdown",
                    headers=headers,
                    environ_overrides={"REMOTE_ADDR": "127.0.0.1"},
                )
            with patch.object(app_module, "IS_FROZEN", True):
                missing_header_response = client.post(
                    "/api/shutdown",
                    environ_overrides={"REMOTE_ADDR": "127.0.0.1"},
                )
                remote_response = client.post(
                    "/api/shutdown",
                    headers=headers,
                    environ_overrides={"REMOTE_ADDR": "192.0.2.10"},
                )

            self.assertEqual(source_response.status_code, 404)
            self.assertEqual(missing_header_response.status_code, 403)
            self.assertEqual(remote_response.status_code, 403)
            schedule_shutdown.assert_not_called()

    def test_packaged_local_shutdown_schedules_process_exit(self) -> None:
        with patch.object(app_module, "IS_FROZEN", True), patch.object(
            app_module, "_schedule_process_shutdown"
        ) as schedule_shutdown:
            response = app.test_client().post(
                "/api/shutdown",
                headers={"X-Junos-Helper": "shutdown"},
                environ_overrides={"REMOTE_ADDR": "127.0.0.1"},
            )

        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.get_json()["ok"])
        schedule_shutdown.assert_called_once_with()

    def test_saved_device_password_stays_server_side_and_supports_quick_connect(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            env_path = Path(directory) / ".env"
            with patch("app.ENV_PATH", env_path):
                save_response = app.test_client().post("/api/devices", json={
                    "hostname": "access-sw-01",
                    "host": "192.0.2.20",
                    "username": "netops",
                    "password": "local-secret",
                    "group": "Boston Access",
                })
                self.assertEqual(save_response.status_code, 200)
                device = save_response.get_json()["device"]

                list_response = app.test_client().get("/api/devices")
                listed_device = list_response.get_json()["devices"][0]
                self.assertEqual(listed_device["hostname"], "access-sw-01")
                self.assertEqual(listed_device["group"], "Boston Access")
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
                    "group": "Boston Core",
                })
                self.assertEqual(update_response.status_code, 200)
                self.assertEqual(len(app.test_client().get("/api/devices").get_json()["devices"]), 1)
                self.assertEqual(
                    app.test_client().get("/api/devices").get_json()["devices"][0]["group"],
                    "Boston Core",
                )
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

    def test_saved_device_rejects_unsafe_group_name(self) -> None:
        response = app.test_client().post("/api/devices", json={
            "hostname": "access-sw-01",
            "host": "192.0.2.20",
            "username": "netops",
            "password": "test",
            "group": "Boston <script>",
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

    def test_assigns_multiple_saved_devices_to_a_group(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            env_path = Path(directory) / ".env"
            with patch("app.ENV_PATH", env_path):
                device_ids = []
                for hostname, host in (("switch-a", "10.0.0.1"), ("switch-b", "10.0.0.2")):
                    response = app.test_client().post("/api/devices", json={
                        "hostname": hostname,
                        "host": host,
                        "username": "netops",
                        "password": "test",
                    })
                    device_ids.append(response.get_json()["device"]["id"])

                with patch("app._replace_environment_path", side_effect=PermissionError(5, "denied")), \
                     patch("app.time.sleep"):
                    group_response = app.test_client().patch("/api/devices/group", json={
                        "deviceIds": device_ids,
                        "group": "Boston Access",
                    })

                self.assertEqual(group_response.status_code, 200)
                self.assertEqual(group_response.get_json()["updated"], 2)
                self.assertEqual(
                    {device["group"] for device in group_response.get_json()["devices"]},
                    {"Boston Access"},
                )

                clear_response = app.test_client().patch("/api/devices/group", json={
                    "deviceIds": [device_ids[0]],
                    "group": "",
                })
                self.assertEqual(clear_response.status_code, 200)
                groups_by_id = {
                    device["id"]: device["group"] for device in clear_response.get_json()["devices"]
                }
                self.assertEqual(groups_by_id[device_ids[0]], "")
                self.assertEqual(groups_by_id[device_ids[1]], "Boston Access")

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
                    "set interfaces ge-0/0/2 native-vlan-id 325",
                    "set interfaces ge-0/0/2 unit 0 family ethernet-switching vlan members CAMERAS",
                    'set interfaces ge-0/0/3 description "Configured but absent from terse"',
                    "set interfaces ge-0/0/3 disable",
                    "set interfaces irb unit 325 family inet address 192.0.2.1/24",
                ]), ""
            if command == "show configuration vlans | display set":
                return "\n".join([
                    "set vlans CAMERAS vlan-id 325",
                    "set vlans CAMERAS l3-interface irb.325",
                    "set vlans CUSTOMER_QINQ interface ge-0/0/1.3013",
                    "set vlans CUSTOMER_QINQ interface ge-0/0/2.3013",
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
        self.assertEqual(payload["interfaces"], ["ge-0/0/1", "ge-0/0/2", "ge-0/0/3"])
        self.assertEqual(payload["configuredInterfaces"], ["ge-0/0/2"])
        self.assertEqual(payload["vlanMemberships"], [
            {"name": "CAMERAS", "value": "325", "l3Interface": "irb.325"},
        ])
        self.assertEqual(payload["irbUnits"], [
            {"unit": 325, "addresses": ["192.0.2.1/24"]},
        ])
        self.assertEqual(payload["bridgeServices"], [{
            "name": "CUSTOMER_QINQ",
            "interfaces": ["ge-0/0/1.3013", "ge-0/0/2.3013"],
        }])
        self.assertFalse(details["ge-0/0/1"]["configured"])
        self.assertTrue(details["ge-0/0/2"]["configured"])
        self.assertEqual(details["ge-0/0/2"]["nativeVlanId"], "325")
        self.assertFalse(details["ge-0/0/3"]["configured"])
        self.assertEqual(details["ge-0/0/3"]["admin"], "down")
        self.assertEqual(details["ge-0/0/3"]["oper"], "down")
        self.assertEqual(details["ge-0/0/3"]["speedCapability"], "1 Gbps")
        self.assertTrue(details["ge-0/0/3"]["disabled"])
        self.assertEqual(
            details["ge-0/0/3"]["description"],
            "Configured but absent from terse",
        )
        self.assertEqual(details["ge-0/0/2"]["negotiatedSpeed"], "100 Mbps")
        self.assertEqual(details["ge-0/0/2"]["speedCapability"], "1 Gbps")
        self.assertEqual(details["ge-0/0/2"]["learnedMacs"], [
            {"mac": "00:11:22:33:44:55", "manufacturer": "CIMSYS Inc", "vlan": "CAMERAS"}
        ])
        self.assertEqual(details["ge-0/0/2"]["lldpNeighbor"]["systemName"], "camera-01")

    @patch("app._execute_cli")
    @patch("app._ssh_client")
    def test_quick_description_commit_checks_then_commits_combined_queue(
        self, ssh_client: Mock, execute_cli: Mock
    ) -> None:
        ssh_client.return_value = Mock()
        execute_cli.return_value = ("commit complete\n", "", 0)

        response = app.test_client().post("/api/quick-description-commit", json={
            "host": "192.0.2.10",
            "username": "netops",
            "password": "test",
            "config": "\n".join([
                "# Queued batch 1: Floor 1",
                'set interfaces ge-0/0/1 description "01_AP"',
                "# Queued batch 2: Floor 2",
                'set interfaces ge-0/0/2 description "02_AP"',
            ]),
        })

        self.assertEqual(response.status_code, 200)
        payload = response.get_json()
        self.assertFalse(payload["pendingConfirmation"])
        self.assertEqual(payload["commandCount"], 2)
        cli = execute_cli.call_args.args[1]
        self.assertTrue(cli.startswith("configure exclusive;"))
        self.assertIn("commit check;", cli)
        self.assertIn('commit comment "Description update by Junos Helper"', cli)
        self.assertNotIn("commit confirmed", cli)

    @patch("app._ssh_client")
    def test_quick_description_commit_rejects_mixed_config_before_ssh(self, ssh_client: Mock) -> None:
        response = app.test_client().post("/api/quick-description-commit", json={
            "host": "192.0.2.10",
            "username": "netops",
            "password": "test",
            "config": "\n".join([
                'set interfaces ge-0/0/1 description "Camera"',
                "set interfaces ge-0/0/1 disable",
            ]),
        })

        self.assertEqual(response.status_code, 400)
        self.assertIn("description", response.get_json()["error"])
        ssh_client.assert_not_called()

    @patch("app._execute_cli")
    @patch("app._ssh_client")
    def test_quick_description_commit_surfaces_junos_stdout_error(
        self, ssh_client: Mock, execute_cli: Mock
    ) -> None:
        ssh_client.return_value = Mock()
        execute_cli.return_value = ("error: permission denied\n", "", 1)

        response = app.test_client().post("/api/quick-description-commit", json={
            "host": "192.0.2.10",
            "username": "netops",
            "password": "test",
            "config": 'set interfaces ge-0/0/1 description "Camera"',
        })

        self.assertEqual(response.status_code, 502)
        self.assertEqual(response.get_json()["error"], "error: permission denied")

    @patch("app._execute_cli")
    @patch("app._ssh_client")
    def test_push_uses_confirmed_commit(self, ssh_client: Mock, execute_cli: Mock) -> None:
        ssh_client.return_value = Mock()
        execute_cli.side_effect = [("configuration check succeeds\n", "", 0), ("commit complete\n", "", 0)]

        response = app.test_client().post("/api/push", json={
            "host": "192.0.2.10",
            "username": "netops",
            "password": "test",
            "config": "set interfaces ge-0/0/1 disable",
        })

        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.get_json()["pendingConfirmation"])
        self.assertTrue(response.get_json()["commitCheckPassed"])
        self.assertEqual(execute_cli.call_count, 2)
        check_cli = execute_cli.call_args_list[0].args[1]
        self.assertTrue(check_cli.startswith("configure private;"))
        self.assertIn("commit check; rollback 0; exit", check_cli)
        self.assertNotIn("commit confirmed", check_cli)
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
        execute_cli.side_effect = [("configuration check succeeds\n", "", 0), ("error: permission denied\n", "", 1)]

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
