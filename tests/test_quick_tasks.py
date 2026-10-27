import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

import app


ACCESS = "set interfaces ge-0/0/1 unit 0 family ethernet-switching interface-mode access"



def setUpModule():
    global _activity_directory, _activity_config
    _activity_directory = tempfile.TemporaryDirectory()
    _activity_config = patch.dict(app.app.config, {"ACTIVITY_LOG_PATH": Path(_activity_directory.name) / "activity.sqlite3"})
    _activity_config.start()


def tearDownModule():
    _activity_config.stop()
    _activity_directory.cleanup()


class QuickTaskTests(unittest.TestCase):
    def validate(self, commands, interfaces=ACCESS, vlans="", manual=None, macs=None, neighbors=None):
        return app._validated_quick_task_lines(
            commands, app._parse_interface_configuration(interfaces), vlans,
            macs or {}, neighbors or {}, manual or []
        )

    def test_combined_eligible_tasks(self):
        commands = '\n'.join([
            '# queue', 'set interfaces ge-0/0/1 description "Camera"',
            'set interfaces ge-0/0/1 disable', 'delete interfaces ge-0/0/1 disable',
            'set vlans CAMERAS vlan-id 310'
        ])
        self.assertEqual(len(self.validate(commands)), 4)

    def test_exclusions_cannot_be_bypassed_by_description_edit(self):
        command = 'delete interfaces ge-0/0/1 description\nset interfaces ge-0/0/1 disable'
        cases = [
            (ACCESS + '\nset interfaces ge-0/0/1 description "01_UPLINK_CORE"', [], {}, {}),
            (ACCESS, ['ge-0/0/1'], {}, {}),
            (ACCESS.replace('access', 'trunk'), [], {}, {}),
            (ACCESS + '\nset interfaces ge-0/0/1 ether-options 802.3ad ae0', [], {}, {}),
            (ACCESS + '\nset interfaces ge-0/0/1 unit 300 vlan-id 300', [], {}, {}),
            (ACCESS, [], {}, {'ge-0/0/1': {'systemCapabilities': 'Bridge Router'}}),
        ]
        for config, manual, macs, neighbors in cases:
            with self.subTest(config=config, manual=manual, neighbors=neighbors):
                with self.assertRaises(ValueError):
                    self.validate(command, config, manual=manual, macs=macs, neighbors=neighbors)

    def test_mac_topology_and_bridge_members_are_excluded(self):
        macs = {
            'ge-0/0/1': [{'mac': 'aa'}, {'mac': 'bb'}],
            'ge-0/0/2': [{'mac': 'aa'}], 'ge-0/0/3': [{'mac': 'bb'}]
        }
        with self.assertRaisesRegex(ValueError, 'MAC pattern'):
            self.validate('set interfaces ge-0/0/1 disable', macs=macs)
        with self.assertRaisesRegex(ValueError, 'bridge service'):
            self.validate('set interfaces ge-0/0/1 disable', vlans='set vlans SERVICE interface ge-0/0/1.0')

    def test_unknown_ports_and_higher_risk_commands_rejected(self):
        for command in [
            'set system host-name switch-a', 'delete protocols rstp',
            'set vlans NEW vlan-id 5000', 'set vlans NEW vlan-id invalid',
            'set vlans NEW vlan-id 0', 'set vlans NEW vlan-id -1',
            'set interfaces ge-0/0/99 disable', 'delete interfaces ge-0/0/1',
            'set interfaces ge-0/0/1 unit 0 family ethernet-switching vlan members CAMERAS',
            'set interfaces irb unit 310 family inet address 192.0.2.1/24',
        ]:
            with self.subTest(command=command), self.assertRaises(ValueError):
                self.validate('set vlans NEW vlan-id 123\n' + command)

    def test_vlan_conflicts_in_live_config_and_batch(self):
        for commands, vlans in [
            ('set vlans OLD vlan-id 123', 'set vlans OLD interface ge-0/0/2.300'),
            ('set vlans NEW vlan-id 123', 'set vlans OLD vlan-id 123'),
            ('set vlans NEW vlan-id 123\nset vlans OTHER vlan-id 123', ''),
            ('set vlans NEW vlan-id 123\nset vlans NEW vlan-id 124', ''),
        ]:
            with self.subTest(commands=commands), self.assertRaises(ValueError):
                self.validate(commands, vlans=vlans)

    def test_manual_protection_persists_per_host(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(app, 'ENV_PATH', Path(directory) / '.env'), patch.dict(app.os.environ):
            client = app.app.test_client()
            response = client.post('/api/protected-ports', json={'host': 'SWITCH-A', 'ports': ['ge-0/0/1']})
            self.assertEqual(response.status_code, 200)
            self.assertEqual(app._manual_protected_ports('switch-a'), ['ge-0/0/1'])
            self.assertEqual(app._manual_protected_ports('switch-b'), [])
            response = client.post('/api/protected-ports', json={'host': 'switch-a', 'ports': []})
            self.assertEqual(response.status_code, 200)
            self.assertEqual(app._manual_protected_ports('SWITCH-A'), [])

    @patch('app._execute_cli')
    @patch('app._ssh_client')
    @patch('app._manual_protected_ports', return_value=[])
    def test_endpoint_rechecks_then_commits_and_blocks_stale_ui(self, manual, ssh, execute):
        ssh.return_value = Mock()
        execute.side_effect = [(ACCESS, '', 0), ('', '', 0), ('', '', 0), ('', '', 0), ('commit complete', '', 0)]
        payload = {'host': '192.0.2.10', 'username': 'netops', 'config': 'set interfaces ge-0/0/1 disable'}
        client = app.app.test_client()
        response = client.post('/api/quick-task-commit', json=payload)
        self.assertEqual(response.status_code, 200)
        self.assertFalse(response.get_json()['pendingConfirmation'])
        self.assertIn('commit check; commit comment', execute.call_args.args[1])
        self.assertNotIn('commit confirmed', execute.call_args.args[1])
        execute.reset_mock()
        execute.side_effect = [(ACCESS.replace('access', 'trunk'), '', 0), ('', '', 0), ('', '', 0), ('', '', 0)]
        response = client.post('/api/quick-task-commit', json=payload)
        self.assertFalse(response.get_json()['ok'])
        self.assertTrue(all(call.args[1].startswith('show ') for call in execute.call_args_list))
        ssh.return_value.close.assert_called()

    @patch('app._execute_cli', return_value=('', '', 1))
    @patch('app._ssh_client')
    def test_failed_discovery_never_commits(self, ssh, execute):
        response = app.app.test_client().post('/api/quick-task-commit', json={
            'host': '192.0.2.10', 'username': 'netops', 'config': 'set vlans NEW vlan-id 123'
        })
        self.assertFalse(response.get_json()['ok'])
        self.assertEqual(execute.call_count, 1)
        self.assertTrue(execute.call_args.args[1].startswith('show '))


if __name__ == '__main__':
    unittest.main()
