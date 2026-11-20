import tempfile
from pathlib import Path
import unittest
from unittest.mock import Mock, patch

import app


class CommitCommentTests(unittest.TestCase):
    def comment(self, text, **kwargs):
        return app._change_commit_comment(app._validated_config_lines(text), **kwargs)

    def test_mixed_changes_include_actions_targets_and_total(self):
        comment = self.comment('\n'.join([
            '# queued batch',
            'set interfaces ge-0/0/1 description "Camera"',
            'delete interfaces ge-0/0/2 disable',
            'set vlans CAMERAS interface ge-0/0/1.310',
        ]))
        self.assertEqual(comment, 'Junos Helper: set descriptions x1; enable ports x1; '
                         'set VLAN membership x1; ports ge-0/0/1,ge-0/0/1.310 +1; VLANs CAMERAS; 3 commands')

    def test_structural_fields_do_not_classify_free_text_as_commands(self):
        self.assertIn('set descriptions x1', self.comment('set interfaces ge-0/0/1 description "disable"'))
        for field, expected in [
            ('unit 0 family ethernet-switching interface-mode trunk', 'set port mode'),
            ('native-vlan-id 310', 'set native VLAN'),
            ('unit 3026 vlan-id 100', 'set VLAN tags'),
            ('unit 3026 input-vlan-map push', 'set VLAN mapping'),
            ('apply-groups CUSTOMERS', 'set interface groups'),
        ]:
            with self.subTest(field=field):
                self.assertIn(expected, self.comment('set interfaces ge-0/0/1 ' + field))

    def test_vlan_values_help_distinguish_membership_and_tag_changes(self):
        comment = self.comment('\n'.join([
            'set interfaces ge-0/0/1 unit 0 family ethernet-switching vlan members [CAMERAS VOICE]',
            'set interfaces ge-0/0/1 native-vlan-id 310',
            'set interfaces ge-0/0/1 unit 3026 vlan-id 100',
        ]))
        self.assertIn('VLANs CAMERAS,VOICE', comment)
        self.assertIn('set native VLAN 310', comment)
        self.assertIn('set VLAN tags 100', comment)
        self.assertIn('set VLAN ID 310', self.comment('set vlans CAMERAS vlan-id 310'))

    def test_comment_does_not_copy_free_text_secrets_or_cli_metacharacters(self):
        text = '\n'.join([
            'set interfaces ge-0/0/1 description \'a "quoted" description\'',
            'set system root-authentication encrypted-password "$6$TOPSECRET"',
            'set snmp community PRIVATE authorization read-only',
            'set "unknown root" "arbitrary value"',
            'set vlans \'unsafe"name\' vlan-id 310',
        ])
        comment = self.comment(text)
        for forbidden in ('quoted', 'TOPSECRET', 'PRIVATE', 'arbitrary', 'unsafe', '"', "'", '; exit', '\n', '$'):
            self.assertNotIn(forbidden, comment)
        self.assertIn('5 commands', comment)

    def test_many_changes_are_bounded_with_explicit_counts(self):
        text = '\n'.join(f'set interfaces ge-0/0/{number} description "Camera"' for number in range(48))
        comment = self.comment(text)
        self.assertIn('set descriptions x48', comment)
        self.assertIn('+46', comment)
        self.assertTrue(comment.endswith('48 commands'))
        first, second = 'ge-0/0/' + '1' * 150, 'ge-0/0/' + '2' * 150
        large = self.comment('\n'.join([
            f'set interfaces {first} description Camera',
            f'set interfaces {second} native-vlan-id 310',
            f'set interfaces {first} unit 3026 input-vlan-map push',
            f'set vlans CAMERAS interface {second}.3026',
        ]), confirmed=True)
        self.assertLessEqual(len(large), 240)
        self.assertIn('+1 change types', large)
        self.assertTrue(large.endswith('...; 4 commands'))

    def test_confirmation_uses_summary_without_reapplying_configuration(self):
        with tempfile.TemporaryDirectory() as directory, \
                patch.dict(app.app.config, {'ACTIVITY_LOG_PATH': Path(directory) / 'activity.sqlite3'}), \
                patch('app._ssh_client', return_value=Mock()), \
                patch('app._execute_cli', return_value=('commit complete', '', 0)) as execute:
            client = app.app.test_client()
            payload = {'host': '192.0.2.10', 'username': 'netops',
                       'config': 'set interfaces ge-0/0/1 disable'}
            response = client.post('/api/confirm', json=payload)
            self.assertEqual(response.status_code, 200)
            comment = 'Confirmed by Junos Helper: disable ports x1; ports ge-0/0/1; 1 command'
            self.assertEqual(response.get_json()['commitComment'], comment)
            self.assertEqual(execute.call_args.args[1], f'configure exclusive; commit comment "{comment}"; exit')
            events = app._activity_store().read(host='192.0.2.10', view='all')['events']
            self.assertEqual(events[0]['details']['commitComment'], comment)
            # Invalid optional metadata must not obstruct confirmation or reach the CLI.
            for config in ('set interfaces ge-0/0/1 disable; exit', ['not text']):
                response = client.post('/api/confirm', json={**payload, 'config': config})
                self.assertEqual(response.status_code, 200)
                self.assertIn('comment "Confirmed by Junos Helper"', execute.call_args.args[1])


if __name__ == '__main__':
    unittest.main()
