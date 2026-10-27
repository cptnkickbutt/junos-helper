"""Read-only, in-memory SSH sessions and physical-port sample parsing."""

import hashlib
import json
import re
import threading
import time
import uuid
from dataclasses import dataclass, field


WATCH_PORT_RE = re.compile(r"(?:(?:fe|ge|mge|xe|et)-\d+/\d+/\d+(?:/\d+)?(?::\d+)?|(?:ae|reth)\d+)")
MAX_WATCH_PORTS = 8


def validate_watch_ports(ports):
    if (not isinstance(ports, list) or not 1 <= len(ports) <= MAX_WATCH_PORTS
            or any(not isinstance(port, str) or not WATCH_PORT_RE.fullmatch(port) for port in ports)):
        raise ValueError("Select 1–8 named physical or aggregate interfaces to watch.")
    return list(dict.fromkeys(ports))


def _counter(text, expression):
    match = re.search(expression + r"\s*:\s*(\d+)\b", text, re.I)
    return match.group(1) if match else None


def _section(text, heading, following):
    match = re.search(r"(?im)^\s*" + heading + r"\s*:\s*", text)
    if not match:
        return ""
    return re.split(r"(?im)^\s*(?:" + following + r")\s*:", text[match.end():], maxsplit=1)[0]


def speed_bps(value):
    match = re.fullmatch(r"\s*(\d+(?:\.\d+)?)\s*([kmgt]?)(?:b(?:it)?(?:/s|ps)?)\s*", value, re.I)
    if not match:
        return None
    speed = float(match.group(1)) * {"": 1, "k": 1e3, "m": 1e6, "g": 1e9, "t": 1e12}[match.group(2).lower()]
    return int(speed) if speed > 0 else None


def parse_interface_sample(output, name):
    headers = list(re.finditer(r"(?im)^\s*Physical interface\s*:\s*(\S+),\s*(Enabled|Disabled),\s*Physical link is (\w+)", output))
    selected = next((index for index, match in enumerate(headers) if match.group(1) == name), None)
    if selected is None:
        raise ValueError(f"No physical-interface statistics returned for {name}.")
    header = headers[selected]
    end = headers[selected + 1].start() if selected + 1 < len(headers) else len(output)
    # Unit counters must never be added to, or substituted for, physical counters.
    text = re.split(r"(?im)^\s*Logical interface(?:\s*:|\s+)", output[header.start():end], maxsplit=1)[0]
    field_value = lambda label: (match.group(1).strip() if (match := re.search(label + r"\s*:\s*([^,\n]+)", text, re.I)) else "")
    traffic = _section(text, "Traffic statistics", "IPv[46] transit statistics|Local statistics|Transit statistics|Multicast statistics|Input errors|Output errors|Egress queues")
    inputs = _section(text, "Input errors", "Output errors|Egress queues")
    outputs = _section(text, "Output errors", "Egress queues|Ingress queues|Active alarms")
    speed = field_value("Link partner Speed") or field_value(r"(?:^|,)\s*Speed")
    cleared = field_value("Statistics last cleared").split(" (")[0]
    generation = field_value("Generation")
    return {
        "name": name, "admin": "up" if header.group(2).lower() == "enabled" else "down",
        "oper": header.group(3).lower(), "speed": speed or "Unknown",
        "speedBps": speed_bps(speed) if header.group(3).lower() == "up" else None,
        "description": (match.group(1).strip() if (match := re.search(r"(?im)^\s*Description:\s*(.*)$", text)) else ""),
        "lastFlapped": field_value("Last flapped").split(" (")[0] or "Unknown",
        "counterEpoch": f"{generation}|{cleared}",
        "counters": {
            "rxBytes": _counter(traffic, r"Input\s+bytes"), "txBytes": _counter(traffic, r"Output\s+bytes"),
            "rxPackets": _counter(traffic, r"Input\s+packets"), "txPackets": _counter(traffic, r"Output\s+packets"),
            "inputErrors": _counter(inputs, r"(?:^|[,\n])\s*Errors"), "inputDrops": _counter(inputs, r"\bDrops"),
            "framingErrors": _counter(inputs, r"Framing errors"),
            "outputErrors": _counter(outputs, r"(?:^|[,\n])\s*Errors"), "outputDrops": _counter(outputs, r"\bDrops"),
            "carrierTransitions": _counter(outputs, r"Carrier transitions"),
        },
    }


def parse_poe_sample(output, name):
    fields = {}
    for key, label in (("admin", "Administrative status"), ("oper", "Operational status"), ("watts", "Power (?:consumption|consumed)")):
        match = re.search(label + r"\s*:\s*([^\n]+)", output, re.I)
        fields[key] = match.group(1).strip() if match else None
    if not fields["admin"]:
        # Some releases print a table even for a single named interface.
        row = re.search(r"(?im)^\s*" + re.escape(name) + r"\s+(Enabled|Disabled)\s+(\S+)\s+(\d+(?:\.\d+)?)\s*(?:W)?\s+\S+\s+(\d+(?:\.\d+)?)\s*(?:W)?", output)
        if row:
            fields.update(admin=row.group(1), oper=row.group(2), watts=row.group(4) + " W")
    if not fields["admin"]:
        raise ValueError("PoE status is unavailable or not supported for this port.")
    return fields


class WatchSessionError(ValueError):
    def __init__(self, message, *, expired=False):
        super().__init__(message)
        self.expired = expired


@dataclass
class WatchSession:
    token: str
    identity: str
    client: object
    host: str
    last_used: float = field(default_factory=time.monotonic)
    lock: threading.Lock = field(default_factory=threading.Lock)
    optional: dict = field(default_factory=dict)


class WatchSessions:
    def __init__(self, *, idle_seconds=90, maximum=8):
        self.idle_seconds = idle_seconds
        self.maximum = maximum
        self.sessions = {}
        self.lock = threading.Lock()
        self.shutdown = threading.Event()
        self.thread = None

    def _sweep(self):
        while not self.shutdown.wait(15):
            with self.lock:
                expired = [token for token, entry in self.sessions.items()
                           if time.monotonic() - entry.last_used > self.idle_seconds and not entry.lock.locked()]
            for token in expired:
                self.drop(token, only_idle=True)

    def acquire(self, host, username, password, token, connect):
        identity = hashlib.sha256(json.dumps([host.strip().lower(), username, password]).encode()).hexdigest()
        with self.lock:
            entry = self.sessions.get(token) if token else None
            if token and (entry is None or entry.identity != identity):
                raise WatchSessionError("Watch session expired or the connection changed. Reconnect the watch.", expired=True)
            if entry is not None:
                if not entry.lock.acquire(blocking=False):
                    raise WatchSessionError("A sample is already running for this watch.")
                entry.last_used = time.monotonic()
                return entry
            if len(self.sessions) >= self.maximum:
                raise WatchSessionError("The live-watch session limit is reached. Pause another watch and retry shortly.")
        client = connect(host, username, password)
        entry = WatchSession(uuid.uuid4().hex, identity, client, host.strip().lower())
        with self.lock:
            if len(self.sessions) >= self.maximum:
                client.close()
                raise WatchSessionError("The live-watch session limit is reached.")
            entry.lock.acquire()
            self.sessions[entry.token] = entry
            if self.thread is None:
                self.thread = threading.Thread(target=self._sweep, daemon=True, name="junos-live-watch")
                self.thread.start()
        return entry

    def release(self, entry):
        with self.lock:
            entry.last_used = time.monotonic()
            entry.lock.release()

    def active(self, entry):
        with self.lock:
            return self.sessions.get(entry.token) is entry

    def drop(self, token, *, only_idle=False):
        with self.lock:
            entry = self.sessions.get(token)
            if entry is None or only_idle and (entry.lock.locked() or time.monotonic() - entry.last_used <= self.idle_seconds):
                return None
            self.sessions.pop(token)
        entry.client.close()
        return entry.host

    def close(self):
        self.shutdown.set()
        with self.lock:
            tokens = list(self.sessions)
        for token in tokens:
            self.drop(token)
