"""Synthetic group/unit fixtures; never store a production configuration here."""
import unittest
from unittest.mock import Mock, patch

from app import _discovered_interface_configuration, _parse_interface_configuration, app


RAW = "\n".join([
    "set interfaces mge-0/0/13 apply-groups APARTMENT",
    'set interfaces mge-0/0/13 description "13_Example apartment"',
    "set interfaces mge-0/0/13 unit 304 vlan-id-list 3001",
    "set interfaces xe-0/2/0 flexible-vlan-tagging",
    "set interfaces xe-0/2/0 unit 0 family ethernet-switching interface-mode trunk",
    "set interfaces xe-0/2/0 unit 304 vlan-id 304",
])
EFFECTIVE = RAW + "\n" + "\n".join([
    "set interfaces mge-0/0/13 flexible-vlan-tagging",
    "set interfaces mge-0/0/13 native-vlan-id 311",
    "set interfaces mge-0/0/13 mtu 9216",
    "set interfaces mge-0/0/13 encapsulation extended-vlan-bridge",
    "set interfaces mge-0/0/13 unit 26 vlan-id 26",
    "set interfaces mge-0/0/13 unit 307 vlan-id 307",
    "set interfaces mge-0/0/13 unit 311 vlan-id 311",
    "set interfaces mge-0/0/13 unit 304 input-vlan-map push",
    "set interfaces mge-0/0/13 unit 304 output-vlan-map pop",
])
RAW_COMMAND = "show configuration interfaces | display set"
EFFECTIVE_COMMAND = "show configuration interfaces | display inheritance no-comments | display set"


class GroupDiscoveryTests(unittest.TestCase):
    def results(self, effective=EFFECTIVE, error=""):
        return [{"command": RAW_COMMAND, "output": RAW, "error": ""},
                {"command": 'show configuration groups | display set | match " interfaces "',
                 "output": "set groups APARTMENT interfaces <*> native-vlan-id 311", "error": ""},
                {"command": EFFECTIVE_COMMAND, "output": effective, "error": error}]

    def test_resolved_group_values_keep_editable_statements_separate(self):
        details = _discovered_interface_configuration(self.results())["mge-0/0/13"]
        self.assertEqual(details["nativeVlanId"], "311")
        self.assertEqual(details["groups"], ["APARTMENT"])
        self.assertEqual(details["groupInterfacePatterns"], {"APARTMENT": ["<*>"]})
        self.assertEqual(details["encapsulation"], "extended-vlan-bridge")
        self.assertTrue(details["inheritanceResolved"])
        self.assertNotIn("mode", details)  # Bridging is not interface-mode trunk.
        self.assertEqual(details["units"]["304"], {
            "vlanIds": ["3001"], "inputVlanMap": "push", "outputVlanMap": "pop"})
        self.assertEqual(details["units"]["311"]["vlanIds"], ["311"])
        self.assertEqual(len(details["setLines"]), 3)
        self.assertGreater(len(details["effectiveSetLines"]), len(details["setLines"]))

    def test_failed_or_empty_inheritance_preserves_explicit_values_without_inventing_tags(self):
        for output, error in [("", ""), ("syntax error, expecting <command>", ""),
                              (EFFECTIVE, "permission denied")]:
            with self.subTest(error=error, output=output[:12]):
                details = _discovered_interface_configuration(self.results(output, error))["mge-0/0/13"]
                self.assertFalse(details["inheritanceResolved"])
                self.assertNotIn("nativeVlanId", details)
                self.assertNotIn("311", details["units"])
                self.assertEqual(details["groups"], ["APARTMENT"])

    def test_units_preserve_ranges_and_do_not_assume_unit_number_is_a_vlan_tag(self):
        parsed = _parse_interface_configuration("\n".join([
            "set interfaces ge-0/0/1 apply-groups [ FIRST SECOND ]",
            "set interfaces ge-0/0/1 unit 900 vlan-id-list [ 100-200 300 ]",
            "set interfaces ge-0/0/1 unit 900 input-vlan-map vlan-id 400",
            "set interfaces ge-0/0/1 unit 900 input-vlan-map push",
            "set interfaces xe-0/0/1 unit 12 vlan-tags outer 400",
            "set interfaces xe-0/0/1 unit 12 vlan-tags inner 100",
        ]))
        self.assertEqual(parsed["ge-0/0/1"]["groups"], ["FIRST", "SECOND"])
        self.assertEqual(parsed["ge-0/0/1"]["units"]["900"]["vlanIds"], ["100-200", "300"])
        self.assertEqual(parsed["ge-0/0/1"]["units"]["900"]["pushTag"], "400")
        self.assertEqual(parsed["xe-0/0/1"]["units"]["12"], {"outerTag": "400", "innerTag": "100"})

    @patch("app._run_command")
    @patch("app._ssh_client")
    def test_connect_exposes_resolved_units_and_direct_group_names(self, ssh_client, run_command):
        ssh_client.return_value = Mock()
        outputs = {RAW_COMMAND: RAW, EFFECTIVE_COMMAND: EFFECTIVE,
                   "show interfaces terse": "mge-0/0/13 up up\nxe-0/2/0 up up"}
        run_command.side_effect = lambda _client, command: (outputs.get(command, ""), "")
        with patch("app._record_activity", return_value=True):
            response = app.test_client().post("/api/connect", json={"host": "192.0.2.1", "username": "example"})
        self.assertEqual(response.status_code, 200)
        details = {entry["name"]: entry for entry in response.get_json()["interfaceDetails"]}
        self.assertEqual(details["mge-0/0/13"]["nativeVlanId"], "311")
        self.assertEqual(details["mge-0/0/13"]["units"]["304"]["vlanIds"], ["3001"])
        self.assertEqual(details["mge-0/0/13"]["groups"], ["APARTMENT"])
        self.assertTrue(details["mge-0/0/13"]["inheritanceResolved"])
        self.assertTrue(details["mge-0/0/13"]["configured"])


if __name__ == "__main__":
    unittest.main()
