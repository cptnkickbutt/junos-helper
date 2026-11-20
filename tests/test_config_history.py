import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

import app
from activity_log import ActivityLog
import config_history as history


CURRENT = 'version 24.2R1;\nsystem {\n    host-name current;\n}\ninterfaces {\n    ge-0/0/1 {\n        description "New";\n    }\n}'
OLDER = CURRENT.replace('current;', 'older;').replace('"New"', '"Old"')


def commit_xml(count=3, *, pending=False, epoch=0):
    rows = ''.join(f'<commit-history><sequence-number>{i}</sequence-number><user>netops</user>'
                   f'<client>cli</client><date-time>2026-11-20 10:{i:02d}:00 EST</date-time>'
                   f'<configuration-revision>re0-{epoch + 1000 - i}</configuration-revision>'
                   f'<log>Change {i}</log></commit-history>' for i in range(count))
    return f'<rpc-reply xmlns:junos="http://xml.juniper.net/junos"><commit-information>{rows}' + (
        '<rollback><remaining>240</remaining></rollback>' if pending else '') + '</commit-information></rpc-reply>'


class FakeReader:
    def __init__(self):
        self.current, self.target, self.rescue = CURRENT, OLDER, OLDER
        self.pending, self.epoch, self.count = False, 0, 3
        self.calls = []
        self.fail = None
        self.after = None

    def command(self, command, **kwargs):
        self.calls.append(command)
        if self.fail and self.fail in command:
            raise history.HistoryError('Read failed', 502)
        if command == 'show system commit':
            return '\n'.join(f'{i} 2026-11-20 10:{i:02d}:00 EST by netops via cli' +
                (' commit confirmed, rollback in 5mins' if self.pending and i == 0 else '') for i in range(self.count))
        if command.startswith('show system commit'):
            return commit_xml(self.count, pending=self.pending, epoch=self.epoch)
        if command == 'show system rollback 0':
            return self.current
        if command.startswith('show system rollback '):
            if self.after:
                callback, self.after = self.after, None
                callback()
            return self.target
        if command == 'show system configuration rescue':
            return self.rescue
        if command == 'request system configuration rescue save':
            self.rescue = self.current
            return ''
        raise AssertionError(command)


class FakeCandidate:
    def __init__(self, reader):
        self.reader = reader
        self.calls = []
        self.mode = 'configuration'
        self.fail = None
        self.on_check = None
        self.loaded = None
        self.closed = False

    def command(self, command, **kwargs):
        self.calls.append(command)
        if self.fail and self.fail in command:
            raise history.HistoryError('Candidate failed', 422)
        if command == 'configure private':
            return 'Entering configuration mode'
        if command == 'rollback 0':
            self.loaded = self.reader.current
            return 'load complete'
        if command == 'rollback rescue':
            self.loaded = self.reader.rescue
            return 'load complete'
        if command.startswith('rollback '):
            self.loaded = self.reader.target
            return 'load complete'
        if command == 'show':
            return self.loaded
        if command == 'commit check':
            if self.on_check:
                self.on_check()
            return 'configuration check succeeds'
        if command.startswith('commit confirmed'):
            self.reader.current = self.loaded
            self.reader.epoch += 1
            self.reader.pending = True
            return 'commit complete'
        if command.startswith('commit comment'):
            self.reader.pending = False
            return 'commit complete'
        if command == 'exit':
            return ''
        raise AssertionError(command)

    def close(self):
        self.closed = True


class HistoryServiceTests(unittest.TestCase):
    def setUp(self):
        self.reader = FakeReader()
        self.candidate = FakeCandidate(self.reader)
        self.factory = Mock(return_value=self.candidate)
        self.service = history.HistoryService(Mock(), 'switch-a', 'netops', reader=self.reader, candidate_factory=self.factory)

    def preview(self, rescue=False):
        data = self.service.history(20)
        return self.service.compare(data['knownGood']['sourceToken'] if rescue else data['entries'][1]['sourceToken'])

    def test_history_limits_and_namespaced_xml_metadata(self):
        self.reader.count = 50
        data = self.service.history(20)
        self.assertEqual([row['index'] for row in data['entries']], list(range(21)))
        self.assertEqual(data['entries'][1]['comment'], 'Change 1')
        self.assertEqual(data['entries'][1]['revision'], 're0-999')
        self.assertEqual(len(self.service.history(15)['entries']), 16)
        self.reader.count = 2
        self.assertEqual(len(self.service.history(20)['entries']), 2)
        self.assertTrue(all(command.startswith('show ') for command in self.reader.calls))

    def test_legacy_text_history_and_sensitive_comments(self):
        rows, pending = history.parse_history('0 2026-11-20 10:00:00 EST by root via cli\n  Good change\n'
                                               '1 2026-11-19 09:00:00 EST by other via netconf\n  password TOPSECRET')
        self.assertEqual(rows[0]['comment'], 'Good change')
        self.assertEqual(rows[1]['comment'], '[Sensitive comment omitted]')
        self.assertFalse(pending)
        self.assertTrue(history.parse_history(commit_xml(pending=True))[1])
        for bad in ('', '<commit-information/>', 'not a history'):
            with self.subTest(bad=bad), self.assertRaises(history.HistoryError):
                history.parse_history(bad)

    def test_inactive_xml_flags_indexes_and_historical_comments_do_not_imply_pending(self):
        plain = commit_xml()
        for extra in ('<rollback-pending>false</rollback-pending>', '<rollback-pending>0</rollback-pending>',
                      '<rollback-number>1</rollback-number>', '<rollback-index>0</rollback-index>',
                      '<rollback>0</rollback>', '<log>Investigate commit confirmed, rollback in 5mins</log>'):
            xml = plain.replace('</commit-information>', extra + '</commit-information>')
            self.assertFalse(history.parse_history(xml)[1], extra)
        old_flag = plain.replace('<sequence-number>1</sequence-number>', '<sequence-number>1</sequence-number><rollback-pending/>')
        self.assertFalse(history.parse_history(old_flag)[1])
        text = '0 2026-11-20 10:00:00 EST by netops via cli\n  Check commit confirmed, rollback in 5mins\n' \
               '1 2026-11-19 10:00:00 EST by netops via cli commit confirmed, rollback in 5mins'
        self.assertFalse(history.parse_history(text)[1])
        self.assertTrue(history.parse_history('0 2026-11-20 10:00:00 EST by netops via cli commit confirmed, rollback in 5mins')[1])

    def test_live_header_overrides_misleading_xml_and_still_blocks_real_pending_state(self):
        original = self.reader.command
        def command(text, **kwargs):
            value = original(text, **kwargs)
            if '| display xml' in text:
                value = value.replace('</commit-information>', '<rollback-pending/></commit-information>')
            return value
        self.reader.command = command
        self.assertFalse(self.service.history(20)['pendingConfirmation'])
        self.reader.pending = True
        self.assertTrue(self.service.history(20)['pendingConfirmation'])
        with self.assertRaises(history.HistoryError):
            self.service.restore(self.preview()['previewToken'])

    def test_unsupported_revision_option_falls_back(self):
        original = self.reader.command
        def command(text, **kwargs):
            if 'include-configuration-revision' in text:
                return None
            return original(text, **kwargs)
        self.reader.command = command
        self.assertEqual(len(self.service.history(20)['entries']), 3)
        self.assertIn('show system commit | display xml', self.reader.calls)

    def test_comparison_direction_and_restore_identity(self):
        result = self.preview()
        self.assertIn('-    host-name current;', result['diff'])
        self.assertIn('+    host-name older;', result['diff'])
        self.assertFalse(result['identical'])
        self.assertEqual(result['addedLines'], 2)
        self.factory.assert_not_called()

    def test_sensitive_hierarchies_remain_redacted_even_without_opening_context(self):
        current = 'snmp {\n    community PRIVATE {\n' + ''.join(f'        clients 192.0.2.{i};\n' for i in range(20)) + '    }\n}'
        target = current.replace('192.0.2.10;', '198.51.100.99;')
        result = history.configuration_diff(current, target)
        self.assertFalse(result['identical'])
        self.assertEqual(result['addedLines'], 1)
        self.assertNotIn('198.51.100.99', result['diff'])
        self.assertNotIn('PRIVATE', result['diff'])
        self.assertIn('[Sensitive configuration redacted]', result['diff'])
        multiline = 'system {\n    private-key "-----BEGIN KEY-----\nOLDMATERIAL\n-----END KEY-----";\n}'
        result = history.configuration_diff(multiline, multiline.replace('OLDMATERIAL', 'NEWMATERIAL'))
        self.assertNotIn('OLDMATERIAL', result['diff'])
        self.assertNotIn('NEWMATERIAL', result['diff'])
        self.assertFalse(result['identical'])

    def test_incomplete_or_permission_restricted_snapshots_rejected(self):
        for text in ('version 24.2;\nsystem {', 'version 24.2;\nsystem { ACCESS-DENIED }',
                     'version 24.2;\n[output truncated]', 'version 24.2;\nsystem { description "unfinished; }'):
            with self.subTest(text=text), self.assertRaises(history.HistoryError):
                history.canonical_config(text)

    def test_tokens_cannot_be_reused_for_wrong_device_user_purpose_or_after_restart(self):
        token = self.preview()['previewToken']
        for host, user, purpose in [('switch-b', 'netops', 'restore'), ('switch-a', 'other', 'restore'), ('switch-a', 'netops', 'save')]:
            with self.subTest(host=host, user=user, purpose=purpose), self.assertRaises(history.HistoryError):
                history.unseal(token, host, user, purpose)
        with patch.object(history, 'SIGNER', history.URLSafeTimedSerializer('different-key', salt='junos-history-v1')):
            with self.assertRaises(history.HistoryError):
                self.service.restore(token)
        with patch.object(history, 'TOKEN_SECONDS', -1), self.assertRaises(history.HistoryError):
            self.service.restore(token)
        self.factory.assert_not_called()

    def test_new_commit_and_mid_comparison_rotation_are_stale(self):
        data = self.service.history(20)
        self.reader.epoch += 1
        with self.assertRaises(history.HistoryError):
            self.service.compare(data['entries'][1]['sourceToken'])
        self.reader.epoch = 0
        self.reader.after = lambda: setattr(self.reader, 'epoch', 1)
        with self.assertRaises(history.HistoryError):
            self.service.compare(data['entries'][1]['sourceToken'])

    def test_restore_checks_each_stage_then_uses_confirmed_commit(self):
        for rescue in (False, True):
            with self.subTest(rescue=rescue):
                self.setUp()
                result = self.service.restore(self.preview(rescue)['previewToken'])
                self.assertTrue(result['pendingConfirmation'])
                self.assertIn('configure private', self.candidate.calls)
                self.assertIn('commit check', self.candidate.calls)
                self.assertEqual(sum(cmd.startswith('commit confirmed 5') for cmd in self.candidate.calls), 1)
                self.assertNotIn('update', self.candidate.calls)
                confirmed = self.service.confirm(result['confirmationToken'])
                self.assertIn('Confirmed by Junos Helper: restore', confirmed['commitComment'])
                self.assertFalse(self.reader.pending)
                self.assertTrue(self.candidate.closed)

    def test_failed_load_show_or_check_sends_no_commit_and_cleans_private_candidate(self):
        for fail in ('configure private', 'rollback revision', 'show', 'commit check'):
            with self.subTest(fail=fail):
                self.setUp()
                preview = self.preview()
                self.candidate.fail = fail
                with self.assertRaises(history.HistoryError):
                    self.service.restore(preview['previewToken'])
                self.assertFalse(any(command.startswith('commit confirmed') for command in self.candidate.calls))
                self.assertTrue(self.candidate.closed)
                if fail != 'configure private':
                    self.assertEqual(self.candidate.calls[-2:], ['rollback 0', 'exit'])

    def test_candidate_mismatch_or_concurrent_commit_stops_apply(self):
        for scenario in ('loaded', 'concurrent', 'pending'):
            with self.subTest(scenario=scenario):
                self.setUp()
                preview = self.preview()
                if scenario == 'loaded':
                    original = self.candidate.command
                    self.candidate.command = lambda command, **kwargs: CURRENT if command == 'show' else original(command, **kwargs)
                elif scenario == 'concurrent':
                    self.candidate.on_check = lambda: setattr(self.reader, 'epoch', 1)
                else:
                    self.reader.pending = True
                with self.assertRaises(history.HistoryError):
                    self.service.restore(preview['previewToken'])
                self.assertFalse(any(command.startswith('commit confirmed') for command in self.candidate.calls))

    def test_changed_rescue_and_identical_restore_are_rejected(self):
        preview = self.preview(True)
        self.reader.rescue = CURRENT
        with self.assertRaises(history.HistoryError):
            self.service.restore(preview['previewToken'])
        self.reader.target = CURRENT
        with self.assertRaises(history.HistoryError):
            self.service.restore(self.preview()['previewToken'])
        self.factory.assert_not_called()

    def test_save_requires_explicit_existing_rescue_identity_and_verified_baseline(self):
        data = self.service.history(20)
        with self.assertRaises(history.HistoryError):
            self.service.save_known_good(data['baselineToken'], '')
        self.assertNotIn('request system configuration rescue save', self.reader.calls)
        result = self.service.save_known_good(data['baselineToken'], data['knownGood']['fingerprint'])
        self.assertEqual(result['fingerprint'], history.fingerprint(CURRENT))
        self.factory.assert_not_called()
        self.reader.pending = True
        with self.assertRaises(history.HistoryError):
            self.service.save_known_good(data['baselineToken'], result['fingerprint'])

    def test_save_token_cannot_replace_a_rescue_that_changed_since_history(self):
        data = self.service.history(20)
        self.reader.rescue = CURRENT
        with self.assertRaises(history.HistoryError):
            self.service.save_known_good(data['baselineToken'], history.fingerprint(CURRENT))
        self.assertNotIn('request system configuration rescue save', self.reader.calls)

    def test_rescue_read_failure_is_not_treated_as_missing_or_safe_to_replace(self):
        self.reader.fail = 'show system configuration rescue'
        data = self.service.history(20)
        self.assertFalse(data['knownGood']['available'])
        self.assertTrue(data['knownGood']['error'])
        with self.assertRaises(history.HistoryError):
            self.service.save_known_good(data['baselineToken'], '')
        self.assertNotIn('request system configuration rescue save', self.reader.calls)

    def test_lost_commit_response_is_unverified_not_a_safe_retry(self):
        preview = self.preview()
        self.candidate.fail = 'commit confirmed'
        with self.assertRaises(history.HistoryError) as raised:
            self.service.restore(preview['previewToken'])
        self.assertEqual(raised.exception.status, 502)
        self.assertIn('unverified', str(raised.exception))

    def test_confirmation_rejects_a_different_pending_commit_with_identical_config(self):
        result = self.service.restore(self.preview()['previewToken'])
        self.reader.epoch += 1
        self.candidate.calls.clear()
        with self.assertRaises(history.HistoryError):
            self.service.confirm(result['confirmationToken'])
        self.assertEqual(self.candidate.calls, [])


class Channel:
    def __init__(self):
        self.output = []
        self.stderr = []
        self.closed = False
        self.sent = []

    def get_pty(self, **kwargs):
        pass

    def exec_command(self, command):
        self.output.append(b'netops@switch> ')

    def sendall(self, text):
        self.sent.append(text.strip())
        command = text.strip()
        config = command.startswith(('configure', 'rollback', 'show', 'commit'))
        body = 'Entering configuration mode' if command == 'configure private' else 'load complete' if command.startswith('rollback') else ''
        if command == 'commit check':
            body = 'error: invalid configuration\nconfiguration check-out failed'
        prompt = 'netops@switch# ' if config else 'netops@switch> '
        self.output.append((command + '\r\n' + body + ('\r\n[edit]' if config else '') + '\r\n' + prompt).encode())

    def recv_ready(self):
        return bool(self.output)

    def recv(self, size):
        return self.output.pop(0)

    def recv_stderr_ready(self):
        return bool(self.stderr)

    def recv_stderr(self, size):
        return self.stderr.pop(0)

    def exit_status_ready(self):
        return False

    def close(self):
        self.closed = True


class TransportTests(unittest.TestCase):
    def test_persistent_candidate_consumes_echo_prompts_and_checks_results(self):
        client = Mock()
        channel = Channel()
        client.get_transport.return_value.open_session.return_value = channel
        candidate = history.CandidateCLI(client)
        self.assertEqual(candidate.command('configure private', expected='Entering configuration mode'), 'Entering configuration mode')
        self.assertEqual(candidate.mode, 'configuration')
        self.assertEqual(candidate.command('rollback 1', expected='load complete'), 'load complete')
        with self.assertRaises(history.HistoryError):
            candidate.command('commit check', expected='configuration check succeeds')
        self.assertNotIn('commit confirmed', channel.sent)
        candidate.close()
        self.assertTrue(channel.closed)

    def test_candidate_output_size_deadline_and_disconnect_fail_closed(self):
        candidate = history.CandidateCLI.__new__(history.CandidateCLI)
        candidate.channel = Channel()
        candidate.channel.output = [b'X' * 100]
        with patch.object(history, 'MAX_OUTPUT', 20), self.assertRaises(history.HistoryError):
            candidate._receive(1)
        with self.assertRaises(history.HistoryError):
            candidate._receive(0)
        candidate.channel.closed = True
        with self.assertRaises(history.HistoryError):
            candidate._receive(1)

    def test_operational_reads_drain_stdout_stderr_and_close_every_stream(self):
        client = Mock()
        channel = Channel()
        channel.output = [b'version 24.2;\n', b'system {}']
        channel.exit_status_ready = lambda: True
        channel.recv_exit_status = lambda: 0
        streams = [Mock(), Mock(channel=channel), Mock()]
        client.exec_command.return_value = streams
        reader = history.OperationalCLI(client)
        self.assertIn('system {}', reader.command('show system rollback 0'))
        for stream in streams:
            stream.close.assert_called_once()
        channel.stderr = [b'permission denied']
        with self.assertRaises(history.HistoryError):
            reader.command('show system rollback 0')

    def test_only_explicit_missing_rescue_output_is_treated_as_missing(self):
        client = Mock()
        channel = Channel()
        channel.exit_status_ready = lambda: True
        channel.recv_exit_status = lambda: 0
        client.exec_command.return_value = [Mock(), Mock(channel=channel), Mock()]
        channel.output = [b'error: No rescue configuration is set.']
        self.assertIsNone(history.OperationalCLI(client).command('show system configuration rescue', missing_ok=True))
        channel.output = [b'error: permission denied']
        with self.assertRaises(history.HistoryError):
            history.OperationalCLI(client).command('show system configuration rescue', missing_ok=True)


class HistoryApiAndCatalogTests(unittest.TestCase):
    def setUp(self):
        directory = self.enterContext(tempfile.TemporaryDirectory())
        self.path = Path(directory) / 'activity.sqlite3'
        self.enterContext(patch.dict(app.app.config, {'ACTIVITY_LOG_PATH': self.path}))
        self.ssh = self.enterContext(patch('app._ssh_client', return_value=Mock()))
        self.service = self.enterContext(patch('app.HistoryService')).return_value
        self.client = app.app.test_client()
        self.payload = {'host': 'switch-a', 'username': 'netops', 'password': 'ssh-secret', 'deviceName': 'Access A'}

    def test_saved_known_good_is_available_across_devices_without_raw_config(self):
        self.service.save_known_good.return_value = {'fingerprint': 'a' * 64, 'revision': 're0-100', 'sourceLabel': 'rescue'}
        result = self.client.post('/api/config-history/known-good', json={**self.payload, 'label': 'After maintenance'}).get_json()
        self.assertTrue(result['ok'])
        data = self.client.get('/api/activity?view=known-good').get_json()
        self.assertEqual(data['knownGood'][0]['host'], 'switch-a')
        self.assertEqual(data['knownGood'][0]['label'], 'After maintenance')
        self.assertEqual(data['knownGood'][0]['state'], 'available')
        self.assertEqual(data['events'][0]['operation'], 'Save known good')
        self.assertNotIn('ssh-secret', json.dumps(data))
        self.assertEqual(self.client.get('/api/activity?view=known-good&host=switch-b').get_json()['knownGood'], [])
        self.ssh.return_value.close.assert_called_once()

    def test_full_synthetic_api_save_compare_restore_and_confirmation(self):
        reader = FakeReader()
        def service(client, host, username):
            return history.HistoryService(client, host, username, reader=reader,
                candidate_factory=lambda client: FakeCandidate(reader))
        with patch('app.HistoryService', side_effect=service):
            data = self.client.post('/api/config-history', json=self.payload).get_json()
            saved = self.client.post('/api/config-history/known-good', json={**self.payload,
                'baselineToken': data['baselineToken'], 'replaceFingerprint': data['knownGood']['fingerprint'],
                'label': 'Before maintenance'}).get_json()
            self.assertTrue(saved['ok'])
            data = self.client.post('/api/config-history', json=self.payload).get_json()
            comparison = self.client.post('/api/config-history/compare', json={**self.payload,
                'sourceToken': data['entries'][1]['sourceToken']}).get_json()
            self.assertTrue(comparison['ok'])
            restored = self.client.post('/api/config-history/restore', json={**self.payload,
                'previewToken': comparison['previewToken']}).get_json()
            self.assertTrue(restored['pendingConfirmation'])
            confirmed = self.client.post('/api/config-history/confirm', json={**self.payload,
                'confirmationToken': restored['confirmationToken'], 'confirmationFor': restored['activityId']}).get_json()
            self.assertTrue(confirmed['ok'])
            data = self.client.get('/api/activity?view=known-good').get_json()
            self.assertEqual(data['knownGood'][0]['label'], 'Before maintenance')
            self.assertEqual(data['events'][0]['status'], 'confirmed')
            self.assertNotIn('host-name', json.dumps(data))
            self.assertNotIn('previewToken', json.dumps(data))

    def test_catalog_survives_log_pruning_and_clears_stale_saved_metadata(self):
        store = ActivityLog(self.path, max_rows=1)
        store.observe_known_good('switch-a', 'A', 'a' * 64, saved={'operator': 'netops', 'label': 'Verified'})
        store.observe_known_good('switch-b', 'B', 'b' * 64)
        for index in range(3):
            store.append({'operation': 'Test', 'message': str(index)})
        self.assertEqual(len(store.read()['events']), 1)
        self.assertEqual(len(store.known_good()), 2)
        self.assertEqual(store.known_good('switch-a')[0]['label'], 'Verified')
        store.observe_known_good('switch-a', 'A', '', error='Unreadable')
        self.assertEqual(store.known_good('switch-a')[0]['state'], 'unreadable')
        self.assertEqual(store.known_good('switch-a')[0]['label'], 'Verified')
        store.observe_known_good('switch-a', 'A', 'c' * 64)
        self.assertEqual(store.known_good('switch-a')[0]['savedAt'], '')
        store.observe_known_good('switch-b', 'B', '')
        self.assertEqual(store.known_good('switch-b')[0]['state'], 'missing')

    def test_restore_and_confirmation_are_correlated_in_cross_device_history(self):
        self.service.restore.return_value = {'sourceLabel': 'rescue', 'pendingConfirmation': True, 'confirmMinutes': 5,
                                             'confirmationToken': 'sensitive-token', 'commitComment': 'Restore rescue'}
        applied = self.client.post('/api/config-history/restore', json=self.payload).get_json()
        self.service.confirm.return_value = {'sourceLabel': 'rescue', 'commitComment': 'Confirmed rescue'}
        self.client.post('/api/config-history/confirm', json={**self.payload, 'confirmationFor': applied['activityId']})
        events = self.client.get('/api/activity?view=known-good').get_json()['events']
        self.assertEqual(events[0]['status'], 'confirmed')
        self.assertEqual(events[1]['confirmationState'], 'confirmed')
        self.assertNotIn('sensitive-token', json.dumps(events))

    def test_operation_guard_rejects_overlapping_changes_and_releases_after_failure(self):
        lock = app.DEVICE_CHANGE_LOCKS.setdefault('switch-a', app.threading.Lock())
        with lock:
            self.assertEqual(self.client.post('/api/config-history/restore', json=self.payload).status_code, 409)
            self.ssh.assert_not_called()
        self.service.restore.side_effect = history.HistoryError('Stale review')
        self.assertEqual(self.client.post('/api/config-history/restore', json=self.payload).status_code, 409)
        self.assertFalse(lock.locked())

    def test_invalid_depth_or_label_and_private_files_are_rejected(self):
        for depth in (0, 49, '20', True):
            self.assertEqual(self.client.post('/api/config-history', json={**self.payload, 'depth': depth}).status_code, 400)
        self.assertEqual(self.client.post('/api/config-history/known-good', json={**self.payload, 'label': 'bad\nlabel'}).status_code, 400)
        self.ssh.assert_not_called()
        response = self.client.get('/config-history.js')
        self.assertEqual(response.status_code, 200)
        response.close()
        self.assertEqual(self.client.get('/config_history.py').status_code, 404)


if __name__ == '__main__':
    unittest.main()
