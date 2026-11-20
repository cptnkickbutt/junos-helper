"""Bounded Junos history reads and staged, private-candidate restores.

Configuration text exists only for the lifetime of a request. Browser tokens and
the activity catalog contain identities/metadata, never configuration snapshots.
"""
import difflib
import hashlib
import json
import re
import secrets
import shlex
import threading
import time
import xml.etree.ElementTree as ET
from datetime import datetime, timezone

from itsdangerous import BadSignature, SignatureExpired, URLSafeTimedSerializer


MAX_OUTPUT = 2 * 1024 * 1024
TOKEN_SECONDS = 300
SIGNER = URLSafeTimedSerializer(secrets.token_hex(32), salt="junos-history-v1")
REVISION_RE = re.compile(r"[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}")
ERROR_RE = re.compile(r"(?im)^\s*(?:error:|syntax error|unknown command|permission denied|"
                      r"command not found|configuration check-out failed|commit failed|"
                      r"configuration database (?:modified|locked)|lock failed)")
SENSITIVE_RE = re.compile(r"(?i)(?:password|secret|community|authentication|private-key|public-key|"
                          r"pre-shared-key|ascii-text|certificate|key-chain|radius-server|"
                          r"tacplus-server|ssh-rsa|ssh-ed25519|ssh-ecdsa|\bkey\b)")


class HistoryError(ValueError):
    def __init__(self, message, status=409):
        super().__init__(message)
        self.status = status


def fingerprint(value):
    return hashlib.sha256(value.encode()).hexdigest()


def canonical_config(value):
    lines = [line.rstrip() for line in value.replace("\r", "").splitlines()
             if not re.match(r"^## (?:Last (?:changed|commit)|SECRET-DATA)", line)
             and not re.fullmatch(r"\{(?:master|backup|primary|secondary|linecard)[^}]*\}", line.strip())]
    text = "\n".join(lines).strip()
    if not text or not re.search(r"(?m)^(?:version\s|[a-z][a-z0-9-]*\s*\{)", text):
        raise HistoryError("The switch did not return a complete readable configuration.", 502)
    if re.search(r"(?i)ACCESS-DENIED|\[output (?:truncated|omitted)\]|---\(more\)---", text):
        raise HistoryError("Configuration output is incomplete or permission restricted. Restore is disabled.", 422)
    structure = re.sub(r'"(?:\\.|[^"\\])*"', '""', text)
    structure = re.sub(r"/\*.*?\*/", "", structure, flags=re.S)
    structure = re.sub(r"(?m)#.*$", "", structure).replace('""', "")
    depth = 0
    for character in structure:
        depth += (character == "{") - (character == "}")
        if depth < 0:
            break
    if depth != 0 or '"' in structure:
        raise HistoryError("Configuration output is incomplete. Restore is disabled.", 422)
    return text


def safe_comment(text):
    # Device-supplied comments are useful, but must not propagate obvious secrets.
    return "[Sensitive comment omitted]" if SENSITIVE_RE.search(text) else text[:512]


def parse_history(output):
    """Parse XML first, with a strict legacy text fallback; never invent entries."""
    entries = []
    pending = False
    if "<" in output and "commit-information" in output:
        start, end = output.find("<"), output.rfind(">") + 1
        try:
            root = ET.fromstring(output[start:end])
        except ET.ParseError as exc:
            raise HistoryError("Unable to parse switch commit history.", 502) from exc
        for node in root.iter():
            node.tag = node.tag.rsplit("}", 1)[-1]
        # XML schema variants contain rollback indexes, flags with explicit false
        # values, and historical comments. These are hints only; the service also
        # verifies live status from the documented operational text header.
        def pending_flag(node):
            value = (node.text or "").strip().lower()
            return value not in {"0", "false", "no", "none", "disabled", "not pending"}

        for information in root.iter("commit-information"):
            for node in information:
                if node.tag in {"rollback", "rollback-pending", "pending-rollback"} and pending_flag(node):
                    pending = True
        for node in root.iter("commit-history"):
            fields = {child.tag: (child.text or "").strip() for child in node}
            number = fields.get("sequence-number", "")
            if not number.isdigit() or not 0 <= int(number) <= 49:
                continue
            if int(number) == 0 and any(child.tag in {"rollback-pending", "pending-rollback"} and pending_flag(child) for child in node):
                pending = True
            revision = fields.get("configuration-revision", fields.get("revision", ""))
            if not REVISION_RE.fullmatch(revision):
                revision = ""
            entries.append({"index": int(number), "timestamp": fields.get("date-time", ""),
                            "user": fields.get("user", ""), "client": fields.get("client", ""),
                            "comment": safe_comment(fields.get("log", "")), "revision": revision})
    else:
        for line in output.splitlines():
            match = re.match(r"^\s*(\d+)\s+(\d{4}-\d\d-\d\d\s+\d\d:\d\d:\d\d(?:\s+\S+)?)\s+by\s+(\S+)\s+via\s+(\S+)(.*)$", line)
            if match and 0 <= int(match[1]) <= 49:
                tail = match[5].strip()
                if int(match[1]) == 0:
                    pending = bool(re.search(r"(?i)\bcommit confirmed\b|\brollback pending\b", tail))
                revision = tail.split()[0] if tail else ""
                if not REVISION_RE.fullmatch(revision) or revision in {"commit", "rollback"}:
                    revision = ""
                entries.append({"index": int(match[1]), "timestamp": match[2], "user": match[3],
                                "client": match[4], "comment": "", "revision": revision})
            elif entries and re.match(r"^\s+", line) and line.strip() and not line.strip().startswith(("{", "[")):
                entries[-1]["comment"] = safe_comment((entries[-1]["comment"] + " " + line.strip()).strip())
    entries.sort(key=lambda row: row["index"])
    if not entries or entries[0]["index"] != 0 or len({row["index"] for row in entries}) != len(entries):
        raise HistoryError("The switch did not return an identifiable current commit.", 502)
    for row in entries:
        row["identity"] = fingerprint(json.dumps({k: v for k, v in row.items() if k != "index"}, sort_keys=True))
    return entries, pending


def _redacted_lines(text):
    result, hidden_depth, in_quote, hidden_quote = [], 0, False, False
    for line in text.splitlines():
        # Track quoted values across lines as well as sensitive hierarchy. Secret
        # PEM/key material often has no keyword on its continuation lines.
        depth, escaped = 0, False
        sensitive = hidden_depth > 0 or hidden_quote or bool(SENSITIVE_RE.search(line))
        for character in line:
            if escaped:
                escaped = False
            elif character == "\\" and in_quote:
                escaped = True
            elif character == '"':
                in_quote = not in_quote
            elif not in_quote:
                if character == '#':
                    break
                depth += (character == "{") - (character == "}")
        if sensitive:
            result.append(" " * (len(line) - len(line.lstrip())) + "[Sensitive configuration redacted]")
            hidden_depth = max(0, hidden_depth + depth)
        else:
            result.append(line)
        hidden_quote = sensitive and in_quote
    return result


def configuration_diff(current, target):
    """Diff raw texts for accuracy, then substitute independently redacted lines."""
    old, new = current.splitlines(), target.splitlines()
    safe_old, safe_new = _redacted_lines(current), _redacted_lines(target)
    output, added, removed = [], 0, 0
    for group in difflib.SequenceMatcher(None, old, new, autojunk=False).get_grouped_opcodes(3):
        output.append(f"@@ -{group[0][1] + 1},{group[-1][2] - group[0][1]} +{group[0][3] + 1},{group[-1][4] - group[0][3]} @@")
        for kind, i, j, a, b in group:
            if kind == "equal":
                output.extend(" " + line for line in safe_old[i:j])
            else:
                if kind in {"delete", "replace"}:
                    output.extend("-" + line for line in safe_old[i:j])
                    removed += j - i
                if kind in {"insert", "replace"}:
                    output.extend("+" + line for line in safe_new[a:b])
                    added += b - a
    patch = "\n".join(output)
    if len(patch.encode()) > MAX_OUTPUT:
        raise HistoryError("Comparison is too large to display completely; restoration is disabled.", 422)
    return {"diff": patch, "addedLines": added, "removedLines": removed,
            "identical": current == target, "direction": "Current -> selected configuration"}


def seal(data, host, username):
    return SIGNER.dumps({**data, "host": host.strip().lower(), "username": username})


def unseal(token, host, username, purpose):
    if not isinstance(token, str) or len(token) > 6000:
        raise HistoryError("Refresh history and select a configuration first.")
    try:
        data = SIGNER.loads(token, max_age=TOKEN_SECONDS)
    except (BadSignature, SignatureExpired) as exc:
        raise HistoryError("This review expired or the app restarted. Refresh and compare again.") from exc
    if data.get("host") != host.strip().lower() or data.get("username") != username or data.get("purpose") != purpose:
        raise HistoryError("This review belongs to another device, user, or operation. Refresh history.")
    return data


class OperationalCLI:
    """Independent operational execs with a transport-closing deadline."""
    def __init__(self, client):
        self.client = client

    def command(self, command, *, allow_error=False, missing_ok=False):
        expired = threading.Event()
        def expire():
            expired.set()
            self.client.close()
        timer = threading.Timer(20, expire)
        timer.daemon = True
        timer.start()
        streams = []
        try:
            streams = self.client.exec_command(f"cli -c {shlex.quote(command)}", timeout=20)
            # Drain both streams together to avoid an SSH window deadlock.
            channel = streams[1].channel
            chunks, errors, size = [], [], 0
            while True:
                if expired.is_set():
                    raise HistoryError("History read timed out. No complete result was verified.", 504)
                progressed = False
                for ready, receive, dest in ((channel.recv_ready, channel.recv, chunks),
                                              (channel.recv_stderr_ready, channel.recv_stderr, errors)):
                    if ready():
                        chunk = receive(65536)
                        size += len(chunk)
                        if size > MAX_OUTPUT:
                            raise HistoryError("Switch output exceeds the history size limit.", 422)
                        dest.append(chunk)
                        progressed = True
                if channel.exit_status_ready() and not channel.recv_ready() and not channel.recv_stderr_ready():
                    break
                if not progressed:
                    time.sleep(0.01)
            output = b"".join(chunks).decode("utf-8", "replace").strip()
            error = b"".join(errors).decode("utf-8", "replace").strip()
            failed = channel.recv_exit_status() != 0 or bool(error) or bool(ERROR_RE.search(output))
            if failed and missing_ok and re.search(r"(?i)no rescue configuration|rescue configuration (?:is )?not (?:set|found)", output + error):
                return None
            if failed and not allow_error:
                raise HistoryError("The switch rejected a history read. Check command support and permissions.", 502)
            return output if not failed else None
        finally:
            timer.cancel()
            for stream in streams:
                stream.close()


class CandidateCLI:
    """One persistent CLI channel: send the next stage only after checking output."""
    PROMPT = re.compile(r"(?m)^[^\s<>\r\n]+[>#] ?$")

    def __init__(self, client):
        self.client, self.channel = client, None
        timer = threading.Timer(20, client.close)
        timer.daemon = True
        timer.start()
        try:
            self.channel = client.get_transport().open_session(timeout=20)
            self.channel.get_pty(term="vt100", width=1000, height=1000)
            self.channel.exec_command("cli")
            self._receive(20)
            self.command("set cli screen-length 0")
            self.command("set cli screen-width 0")
        finally:
            timer.cancel()

    def _receive(self, timeout):
        deadline, data = time.monotonic() + timeout, b""
        while time.monotonic() < deadline:
            if self.channel.recv_ready():
                data += self.channel.recv(65536)
                if len(data) > MAX_OUTPUT:
                    raise HistoryError("Candidate output exceeds the restore size limit.", 422)
                text = re.sub(r"\x1b\[[0-?]*[ -/]*[@-~]", "", data.decode("utf-8", "replace")).replace("\r", "")
                matches = list(self.PROMPT.finditer(text))
                if matches and not text[matches[-1].end():].strip():
                    self.mode = "configuration" if matches[-1][0].strip().endswith("#") else "operational"
                    body = text[:matches[-1].start()].rstrip()
                    # CLI appends its current hierarchy before every config prompt.
                    body = re.sub(r"(?:\n|^)(?:\{[^\n]*\}(?:\n)?)?\[edit[^\n]*\]$", "", body)
                    return body.strip()
            elif self.channel.closed or self.channel.exit_status_ready():
                raise HistoryError("Restore connection closed. Verify switch state before retrying.", 502)
            else:
                time.sleep(0.01)
        raise HistoryError("Restore command timed out. Verify switch state before retrying.", 504)

    def command(self, command, *, expected=None, timeout=20):
        timer = threading.Timer(timeout, self.client.close)
        timer.daemon = True
        timer.start()
        try:
            self.channel.sendall(command + "\n")
            output = self._receive(timeout)
            if output.splitlines()[:1] == [command]:
                output = "\n".join(output.splitlines()[1:]).strip()
            if ERROR_RE.search(output) or (expected and expected.lower() not in output.lower()):
                raise HistoryError("The switch rejected a restore stage. No subsequent stage was sent.", 422)
            return output
        finally:
            timer.cancel()

    def close(self):
        if self.channel is not None:
            self.channel.close()


class HistoryService:
    def __init__(self, client, host, username, *, reader=None, candidate_factory=None):
        self.client, self.host, self.username = client, host, username
        self.reader = reader or OperationalCLI(client)
        self.candidate_factory = candidate_factory or CandidateCLI
        self.revisions = True

    def _history(self):
        output = self.reader.command("show system commit include-configuration-revision | display xml", allow_error=True) if self.revisions else None
        if output is None:
            self.revisions = False
            output = self.reader.command("show system commit | display xml")
        rows, _ = parse_history(output)
        status_rows, pending = parse_history(self.reader.command("show system commit"))
        # Do not let XML metadata, user commit comments, or old commit entries
        # manufacture a pending timer. The live current header is authoritative.
        if any(rows[0][key] != status_rows[0][key] for key in ("timestamp", "user", "client")):
            raise HistoryError("Commit history changed while reading live status. Refresh history.")
        return rows, pending

    def _state(self):
        rows, pending = self._history()
        current = canonical_config(self.reader.command("show system rollback 0"))
        after, after_pending = self._history()
        if rows[0]["identity"] != after[0]["identity"]:
            raise HistoryError("The current commit changed during the read. Refresh history.")
        return rows, pending or after_pending, current

    def _rescue(self):
        output = self.reader.command("show system configuration rescue", missing_ok=True)
        if output is None:
            return None
        return canonical_config(output)

    def _base(self, rows, current):
        return {"baseline": fingerprint(current), "baselineIdentity": rows[0]["identity"]}

    def _verify_base(self, token, rows, current):
        if token["baseline"] != fingerprint(current) or token["baselineIdentity"] != rows[0]["identity"]:
            raise HistoryError("The current configuration or commit changed. Refresh and compare again.")

    def history(self, depth):
        rows, pending, current = self._state()
        rescue_error = ""
        try:
            rescue = self._rescue()
        except HistoryError as exc:
            rescue, rescue_error = None, str(exc)
        # Rescue reads can be slow; verify the baseline again before publishing tokens.
        after, _ = self._history()
        if after[0]["identity"] != rows[0]["identity"]:
            raise HistoryError("Commit history changed. Refresh again.")
        base = self._base(rows, current)
        entries = []
        for row in rows:
            if row["index"] > depth:
                continue
            source = {"kind": "rollback", "index": row["index"], "revision": row["revision"], "identity": row["identity"]}
            entries.append({**row, "sourceToken": seal({**base, "source": source, "purpose": "source"}, self.host, self.username)})
        known = {"available": rescue is not None, "error": rescue_error,
                 "fingerprint": fingerprint(rescue) if rescue else "",
                 "sourceToken": seal({**base, "source": {"kind": "rescue"}, "sourceFingerprint": fingerprint(rescue),
                                      "purpose": "source"}, self.host, self.username) if rescue else ""}
        return {"entries": entries, "pendingConfirmation": pending, "knownGood": known,
                "baselineToken": seal({**base, "rescueFingerprint": known["fingerprint"], "purpose": "save"}, self.host, self.username),
                "collectedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
                "baselineRevision": rows[0]["revision"], "baselineFingerprint": base["baseline"]}

    def _source(self, token, rows):
        source = token["source"]
        if source["kind"] == "rescue":
            text = self._rescue()
            if text is None:
                raise HistoryError("The rescue configuration is missing or unreadable.")
            if token.get("sourceFingerprint") != fingerprint(text):
                raise HistoryError("The known-good rescue configuration changed. Refresh and compare again.")
            return text, "rescue"
        match = next((row for row in rows if row["identity"] == source["identity"]
                      and (row["revision"] == source["revision"] if source["revision"] else row["index"] == source["index"])), None)
        if match is None:
            raise HistoryError("The selected version moved or expired. Refresh history.")
        return canonical_config(self.reader.command(f'show system rollback {match["index"]}')), match["revision"] or f'rollback {match["index"]}'

    def compare(self, source_token):
        token = unseal(source_token, self.host, self.username, "source")
        rows, pending, current = self._state()
        self._verify_base(token, rows, current)
        target, label = self._source(token, rows)
        after, _ = self._history()
        self._verify_base(token, after, current)
        result = configuration_diff(current, target)
        review = {**token, "purpose": "restore", "sourceFingerprint": fingerprint(target), "sourceLabel": label}
        return {**result, "sourceLabel": label, "previewToken": seal(review, self.host, self.username),
                "pendingConfirmation": pending, "expiresInSeconds": TOKEN_SECONDS}

    def save_known_good(self, baseline_token, replace_fingerprint):
        token = unseal(baseline_token, self.host, self.username, "save")
        rows, pending, current = self._state()
        self._verify_base(token, rows, current)
        if pending:
            raise HistoryError("A confirmed commit is pending on the switch. Resolve it before saving known good.")
        previous = self._rescue()
        actual_rescue = fingerprint(previous) if previous is not None else ""
        if token.get("rescueFingerprint", "") != actual_rescue or (previous is not None and replace_fingerprint != actual_rescue):
            raise HistoryError("A rescue configuration already exists or changed. Review it before replacing known good.")
        # The save command never changes active configuration. A post-save identity
        # mismatch remains explicitly unverified, rather than claiming the requested version.
        self.reader.command("request system configuration rescue save")
        rescue = self._rescue()
        after, now_pending, now_current = self._state()
        if rescue is None or fingerprint(rescue) != token["baseline"] or now_pending:
            raise HistoryError("Rescue save was sent, but the saved version could not be verified. Refresh history.", 502)
        try:
            self._verify_base(token, after, now_current)
        except HistoryError as exc:
            raise HistoryError("Rescue save was sent, but current changed during verification. Refresh and verify the backup.", 502) from exc
        return {"fingerprint": fingerprint(rescue), "revision": rows[0]["revision"], "sourceLabel": "rescue"}

    def restore(self, preview_token):
        token = unseal(preview_token, self.host, self.username, "restore")
        rows, pending, current = self._state()
        self._verify_base(token, rows, current)
        if pending:
            raise HistoryError("A confirmed commit is pending on the switch. Resolve it before restoring.")
        target, label = self._source(token, rows)
        if fingerprint(target) != token["sourceFingerprint"]:
            raise HistoryError("The selected configuration changed. Compare again.")
        if current == target:
            raise HistoryError("The selected configuration already matches current. No restore is needed.")
        candidate = self.candidate_factory(self.client)
        entered = False
        commit_sent = False
        try:
            # Private mode preserves other users' shared candidate changes. Junos
            # rejects concurrent active changes; never update/merge this candidate.
            candidate.command("configure private", expected="Entering configuration mode")
            entered = True
            if candidate.mode != "configuration":
                raise HistoryError("Unable to open an isolated candidate configuration.", 422)
            candidate.command("rollback 0", expected="load complete")
            command = "rollback rescue" if label == "rescue" else (
                f'rollback revision {token["source"]["revision"]}' if token["source"]["revision"]
                else f'rollback {token["source"]["index"]}')
            candidate.command(command, expected="load complete")
            loaded = canonical_config(candidate.command("show"))
            if fingerprint(loaded) != token["sourceFingerprint"]:
                raise HistoryError("The loaded candidate does not match the reviewed configuration. Restore stopped.", 422)
            rows, pending, current = self._state()
            self._verify_base(token, rows, current)
            if pending:
                raise HistoryError("Another confirmed commit is pending. Restore stopped before validation.")
            candidate.command("commit check", expected="configuration check succeeds", timeout=60)
            rows, pending, current = self._state()
            self._verify_base(token, rows, current)
            if pending:
                raise HistoryError("Another confirmed commit is pending. Restore stopped before apply.")
            comment = f"Junos Helper: restore {label}; confirmed 5 minutes"
            commit_sent = True
            candidate.command(f'commit confirmed 5 comment "{comment}"', expected="commit complete", timeout=60)
            applied_rows, applied_pending, applied_current = self._state()
            if not applied_pending or fingerprint(applied_current) != token["sourceFingerprint"]:
                raise HistoryError("The applied restore could not be verified against the switch.", 502)
            entered = False  # A successful commit has no private changes to discard.
            candidate.command("exit")
            confirmation = seal({"purpose": "confirm", "sourceLabel": label,
                                 "appliedFingerprint": token["sourceFingerprint"],
                                 "appliedIdentity": applied_rows[0]["identity"]}, self.host, self.username)
            return {"pendingConfirmation": True, "confirmMinutes": 5, "commitComment": comment,
                    "sourceLabel": label, "confirmationToken": confirmation}
        except HistoryError as exc:
            if commit_sent:
                raise HistoryError("Restore commit was sent but its outcome is unverified. Check switch state before retrying.", 502) from exc
            raise
        finally:
            if entered and not commit_sent:
                try:
                    candidate.command("rollback 0", expected="load complete")
                    candidate.command("exit")
                except (HistoryError, OSError):
                    pass  # Closing this private session discards only its own candidate.
            candidate.close()

    def confirm(self, confirmation_token):
        token = unseal(confirmation_token, self.host, self.username, "confirm")
        rows, pending, current = self._state()
        if not pending or fingerprint(current) != token["appliedFingerprint"] or rows[0]["identity"] != token["appliedIdentity"]:
            raise HistoryError("The applied version is no longer pending or the configuration changed. Refresh history and verify the switch.")
        candidate = self.candidate_factory(self.client)
        try:
            candidate.command("configure private", expected="Entering configuration mode")
            candidate.command("rollback 0", expected="load complete")
            if fingerprint(canonical_config(candidate.command("show"))) != token["appliedFingerprint"]:
                raise HistoryError("The confirmation candidate changed. Verify the switch before confirming.")
            comment = f'Confirmed by Junos Helper: restore {token["sourceLabel"]}'
            candidate.command(f'commit comment "{comment}"', expected="commit complete", timeout=60)
            candidate.command("exit")
            return {"commitComment": comment, "sourceLabel": token["sourceLabel"]}
        finally:
            candidate.close()
