import atexit
import ctypes
import hashlib
import ipaddress
import json
import logging
import os
import re
import shlex
import shutil
import sys
import tempfile
import threading
import time
import urllib.request
import webbrowser
import uuid
import sqlite3
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import paramiko
from dotenv import dotenv_values, load_dotenv, set_key
from flask import Flask, g, jsonify, request, send_from_directory
from activity_log import ActivityLog, utc_now
from live_watch import WatchSessions, WatchSessionError, validate_watch_ports, parse_interface_sample, parse_poe_sample
from mac_vendor_lookup import BaseMacLookup, InvalidMacError, MacLookup, VendorNotFoundError

APP_DIR = Path(__file__).resolve().parent
IS_FROZEN = bool(getattr(sys, "frozen", False))
RESOURCE_DIR = Path(getattr(sys, "_MEIPASS", APP_DIR))
VENDOR_DATABASE = RESOURCE_DIR / "mac-vendors.txt"
if not VENDOR_DATABASE.is_file():
    VENDOR_DATABASE = Path(sys.prefix) / "cache" / "mac-vendors.txt"
BaseMacLookup.cache_path = str(VENDOR_DATABASE)
MAC_LOOKUP = MacLookup() if VENDOR_DATABASE.is_file() else None
SAVED_DEVICE_PREFIX = "JUNOS_DEVICE_"
DEVICE_SEED_HASH_KEY = "JUNOS_DEVICE_SEED_HASH"
ENV_WRITE_LOCK = threading.Lock()
_SINGLE_INSTANCE_MUTEX: tuple[Any, int] | None = None


def _replace_environment_path(source: Path, destination: Path) -> None:
    os.replace(source, destination)


def _persist_dotenv_values(path: Path, updates: dict[str, str]) -> None:
    """Apply several dotenv changes with one OneDrive-friendly destination rewrite."""
    if not updates:
        return
    with ENV_WRITE_LOCK:
        path.parent.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(prefix="junos_helper_env_") as work_directory:
            work_path = Path(work_directory) / ".env"
            if path.exists():
                shutil.copyfile(path, work_path)
            else:
                work_path.touch()
            for key, value in updates.items():
                set_key(str(work_path), key, value, quote_mode="always")
            contents = work_path.read_bytes()

        staging_path: Path | None = None
        try:
            with tempfile.NamedTemporaryFile(
                prefix=".junos_helper_env_",
                suffix=".tmp",
                dir=path.parent,
                delete=False,
            ) as staging_file:
                staging_file.write(contents)
                staging_file.flush()
                os.fsync(staging_file.fileno())
                staging_path = Path(staging_file.name)

            replace_error: OSError | None = None
            for attempt in range(7):
                try:
                    _replace_environment_path(staging_path, path)
                    staging_path = None
                    replace_error = None
                    break
                except OSError as exc:
                    if not isinstance(exc, PermissionError) and getattr(exc, "winerror", None) not in {5, 32}:
                        raise
                    replace_error = exc
                    time.sleep(min(0.05 * (2 ** attempt), 0.5))

            if replace_error is not None:
                # OneDrive can permit file writes while temporarily denying rename-overwrite.
                with path.open("wb") as environment_file:
                    environment_file.write(contents)
                    environment_file.flush()
                    os.fsync(environment_file.fileno())
        finally:
            if staging_path is not None:
                try:
                    staging_path.unlink(missing_ok=True)
                except OSError:
                    pass


def _environment_path() -> Path:
    """Keep mutable configuration outside a frozen executable."""
    override = os.getenv("JUNOS_HELPER_ENV_PATH")
    if override:
        return Path(override).expanduser().resolve()
    if not IS_FROZEN:
        return APP_DIR / ".env"
    local_app_data = os.getenv("LOCALAPPDATA")
    base_dir = Path(local_app_data) if local_app_data else Path.home() / "AppData" / "Local"
    return base_dir / "Junos Helper" / ".env"


def _prepare_environment(path: Path) -> None:
    if not IS_FROZEN:
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    seed_path = next(
        (candidate for candidate in (RESOURCE_DIR / "seed.env", RESOURCE_DIR / ".env") if candidate.is_file()),
        None,
    )
    if not path.exists():
        if seed_path is not None:
            shutil.copyfile(seed_path, path)
        else:
            path.touch()
    if seed_path is None:
        return

    seed_hash = hashlib.sha256(seed_path.read_bytes()).hexdigest()
    current_values = dotenv_values(path)
    if current_values.get(DEVICE_SEED_HASH_KEY) == seed_hash:
        return
    seed_values = dotenv_values(seed_path)
    updates = {
        key: value or ""
        for key, value in seed_values.items()
        if key.startswith(SAVED_DEVICE_PREFIX)
    }
    updates[DEVICE_SEED_HASH_KEY] = seed_hash
    _persist_dotenv_values(path, updates)


ENV_PATH = _environment_path()
_prepare_environment(ENV_PATH)
load_dotenv(ENV_PATH)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("junos_helper")

app = Flask(__name__, static_folder=None)
app.config["MAX_CONTENT_LENGTH"] = 128 * 1024
APP_VERSION = "1.6"
API_VERSION = 24
WATCH_SESSIONS = WatchSessions()
atexit.register(WATCH_SESSIONS.close)
WATCH_LOG_THROTTLE = {}
WATCH_LOG_LOCK = threading.Lock()
PORT_BOUNCE_LOCK = threading.Lock()
COMMIT_COMMENT = "Applied by Junos Helper"
CONFIRM_COMMENT = "Confirmed by Junos Helper"
QUICK_DESCRIPTION_COMMIT_COMMENT = "Description update by Junos Helper"

DISCOVERY_COMMANDS = (
    "show interfaces terse",
    "show interfaces media",
    "show ethernet-switching table",
    "show lldp neighbors detail",
    "show vlans",
    "show configuration vlans | display set",
    "show version",
    "show configuration interfaces | display set",
    "show configuration system host-name | display set",
)
INTERFACE_RE = re.compile(
    r"(?<![A-Za-z0-9])((?:(?:ge|xe|et|fe|mge)-\d+/\d+/\d+(?:/\d+)?(?::\d+)?|(?:ae|reth)\d+)(?:\.\d+)?)",
    re.IGNORECASE,
)
PHYSICAL_INTERFACE_NAME_RE = re.compile(
    r"^(fe|ge|mge|xe|et)-(\d+)/(\d+)/(\d+)(?:/(\d+))?(?::(\d+))?$",
    re.IGNORECASE,
)


def _interface_sort_key(name: str, model: str = "") -> tuple[Any, ...]:
    """Sort physical interfaces by chassis location rather than speed prefix."""
    physical = PHYSICAL_INTERFACE_NAME_RE.fullmatch(name)
    if physical:
        prefix, fpc, pic, port, subport, lane = physical.groups()
        prefix_rank = {"fe": 0, "ge": 1, "mge": 2, "xe": 3, "et": 4}[prefix.lower()]
        family_group = 0
        if model.upper().startswith("EX4100") and prefix.lower() in {"xe", "et"}:
            # EX4100 access and uplink banks can reuse numeric coordinates.
            family_group = 1
        return (
            0,
            family_group,
            int(fpc),
            int(pic),
            int(port),
            int(subport) if subport is not None else -1,
            int(lane) if lane is not None else -1,
            prefix_rank,
        )
    aggregate = re.fullmatch(r"(ae|reth)(\d+)", name, re.IGNORECASE)
    if aggregate:
        return (1, 0 if aggregate.group(1).lower() == "ae" else 1, int(aggregate.group(2)))
    return (2, name.lower())


def _preferred_interface_names(names: list[str], model: str = "") -> list[str]:
    """Hide slower aliases when a platform exposes multiple names for one port."""
    unique_names = list(dict.fromkeys(names))
    names_by_location: dict[tuple[str, ...], list[tuple[str, str]]] = {}
    for name in unique_names:
        physical = PHYSICAL_INTERFACE_NAME_RE.fullmatch(name)
        if not physical:
            continue
        prefix, *location = physical.groups()
        names_by_location.setdefault(tuple(value or "" for value in location), []).append(
            (prefix.lower(), name)
        )

    hidden_names: set[str] = set()
    speed_rank = {"fe": 0, "ge": 1, "mge": 2, "xe": 3, "et": 4}
    for aliases in names_by_location.values():
        prefixes = {prefix for prefix, _name in aliases}
        if model.upper().startswith("EX4400") and len(prefixes) > 1:
            fastest_prefix = max(prefixes, key=speed_rank.__getitem__)
            hidden_names.update(name for prefix, name in aliases if prefix != fastest_prefix)
        elif {"xe", "et"}.issubset(prefixes):
            hidden_names.update(name for prefix, name in aliases if prefix == "xe")
    return [name for name in unique_names if name not in hidden_names]


def _interface_name_capability(name: str) -> str:
    """Infer the fixed-rate capability represented by a physical interface prefix."""
    match = PHYSICAL_INTERFACE_NAME_RE.fullmatch(name)
    if not match:
        return ""
    return {
        "fe": "100 Mbps",
        "ge": "1 Gbps",
        "mge": "2.5 Gbps",
        "xe": "10 Gbps",
        "et": "100 Gbps",
    }.get(match.group(1).lower(), "")


def _env_flag(name: str, default: bool = False) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def _local_app_url(bind_host: str, bind_port: int) -> str:
    if bind_host not in {"127.0.0.1", "localhost"}:
        return ""
    return f"http://127.0.0.1:{bind_port}"


def _existing_helper_url(bind_host: str, bind_port: int) -> str:
    app_url = _local_app_url(bind_host, bind_port)
    if not app_url:
        return ""
    try:
        with urllib.request.urlopen(f"{app_url}/api/health", timeout=0.4) as response:
            health = json.load(response)
    except (OSError, ValueError):
        return ""
    return app_url if isinstance(health, dict) and health.get("ok") and health.get("apiVersion") else ""


def _release_packaged_instance_mutex() -> None:
    global _SINGLE_INSTANCE_MUTEX
    if _SINGLE_INSTANCE_MUTEX is None:
        return
    kernel32, handle = _SINGLE_INSTANCE_MUTEX
    kernel32.CloseHandle(handle)
    _SINGLE_INSTANCE_MUTEX = None


def _acquire_packaged_instance_mutex() -> bool:
    """Keep one packaged server per signed-in Windows session."""
    global _SINGLE_INSTANCE_MUTEX
    if not IS_FROZEN or os.name != "nt":
        return True
    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    close_handle = kernel32.CloseHandle
    close_handle.argtypes = (ctypes.c_void_p,)
    close_handle.restype = ctypes.c_bool
    create_mutex = kernel32.CreateMutexW
    create_mutex.argtypes = (ctypes.c_void_p, ctypes.c_bool, ctypes.c_wchar_p)
    create_mutex.restype = ctypes.c_void_p
    ctypes.set_last_error(0)
    handle = create_mutex(None, False, "Local\\JunosHelper.SingleInstance")
    if not handle:
        raise ctypes.WinError(ctypes.get_last_error())
    if ctypes.get_last_error() == 183:  # ERROR_ALREADY_EXISTS
        kernel32.CloseHandle(handle)
        return False
    _SINGLE_INSTANCE_MUTEX = (kernel32, handle)
    atexit.register(_release_packaged_instance_mutex)
    return True


def _schedule_process_shutdown() -> None:
    def terminate() -> None:
        logger.info("Junos Helper shutdown requested from the local UI")
        os._exit(0)

    shutdown_timer = threading.Timer(0.35, terminate)
    shutdown_timer.daemon = True
    shutdown_timer.start()


def _saved_device_id(hostname: str) -> str:
    readable = re.sub(r"[^A-Z0-9]+", "_", hostname.upper()).strip("_")[:36] or "DEVICE"
    digest = hashlib.sha256(hostname.lower().encode("utf-8")).hexdigest()[:8].upper()
    return f"{readable}_{digest}"


def _persist_environment_values(updates: dict[str, str]) -> None:
    _persist_dotenv_values(ENV_PATH, updates)
    for key, value in updates.items():
        os.environ[key] = value


def _saved_devices() -> dict[str, dict[str, str]]:
    values = dotenv_values(ENV_PATH) if ENV_PATH.exists() else {}
    devices: dict[str, dict[str, str]] = {}
    suffixes = {"HOSTNAME", "HOST", "USERNAME", "PASSWORD", "GROUP"}
    for key, value in values.items():
        if not key.startswith(SAVED_DEVICE_PREFIX):
            continue
        remainder = key[len(SAVED_DEVICE_PREFIX):]
        device_id, separator, field = remainder.rpartition("_")
        if not separator or field not in suffixes:
            continue
        devices.setdefault(device_id, {})[field.lower()] = value or ""
    return {
        device_id: details
        for device_id, details in devices.items()
        if details.get("hostname") and details.get("host") and details.get("username") and details.get("password")
    }


def _connection_values(payload: dict[str, Any]) -> tuple[str, str, str]:
    device_id = str(payload.get("deviceId") or "").strip().upper()
    saved = _saved_devices().get(device_id, {}) if re.fullmatch(r"[A-Z0-9_]{1,64}", device_id) else {}
    host = (payload.get("host") or saved.get("host") or os.getenv("JUNOS_HOST", "")).strip()
    username = (payload.get("username") or saved.get("username") or os.getenv("JUNOS_USERNAME", "")).strip()
    password = payload.get("password") or saved.get("password") or os.getenv("JUNOS_PASSWORD", "")
    return host, username, password


ACTIVITY_OPERATIONS = {
    "/api/connect": ("Data pull", "data"), "/api/preview": ("Comparison", "review"),
    "/api/push": ("Protected push", "change"), "/api/confirm": ("Commit confirmation", "change"),
    "/api/quick-task-commit": ("Quick commit", "change"),
    "/api/quick-description-commit": ("Description quick commit", "change"),
    "/api/ports/bounce": ("Port bounce", "change"),
    "/api/protected-ports": ("Port protection", "settings"),
    "/api/devices": ("Save device", "settings"), "/api/devices/group": ("Assign group", "settings"),
}
ACTIVITY_LAST_ERROR = ""


def _activity_store() -> ActivityLog:
    configured = app.config.get("ACTIVITY_LOG_PATH") or os.getenv("JUNOS_HELPER_ACTIVITY_LOG_PATH")
    base = Path(os.getenv("LOCALAPPDATA") or Path.home() / "AppData" / "Local")
    return ActivityLog(Path(configured) if configured else base / "Junos Helper" / "activity.sqlite3")


def _activity_clean(value: Any, payload: dict) -> str:
    """Keep useful error text while excluding credentials and secret configuration values."""
    text = str(value or "")
    secrets = [payload.get("password")]
    try:
        secrets.append(_connection_values(payload)[2])
    except (ValueError, TypeError, AttributeError):
        pass
    for line in str(payload.get("config") or "").splitlines():
        try:
            parts = shlex.split(line)
        except ValueError:
            # Malformed secret-bearing commands must not leak through validation errors.
            sensitive = re.search(r"(?:password|secret|community|authentication-data|\bkey)\s+(.+)", line, re.I)
            if sensitive:
                remainder = sensitive.group(1).strip().strip("\"'")
                secrets.extend([remainder, *[part.strip("\"'") for part in remainder.split()]])
                text = text.replace(line.strip(), "[sensitive command omitted]")
            continue
        for index, part in enumerate(parts[:-1]):
            if re.search(r"password|secret|community|authentication-data|(?:^|-)key(?:$|-)", part, re.I):
                secrets.extend(parts[index + 1:])
    for secret in sorted({str(secret) for secret in secrets if secret}, key=len, reverse=True):
        text = text.replace(secret, "[redacted]")
    text = re.sub(r'(?i)((?:encrypted-password|password|secret|community|authentication-key|private-key)\s+)("[^"\n]*"|\S+)',
                  r"\1[redacted]", text)
    text = "\n".join("[Sensitive error details omitted; see current operation output.]" if re.search(
        r"password|secret|community|authentication-data|(?:^|[\s-])key(?:$|[\s-])", line, re.I) else line for line in text.splitlines())
    return text[:2000]


def _record_activity(event: dict) -> bool:
    global ACTIVITY_LAST_ERROR
    try:
        _activity_store().append(event)
        return True
    except (OSError, sqlite3.Error) as exc:
        ACTIVITY_LAST_ERROR = f"History could not be saved at {utc_now()} ({type(exc).__name__}). Some actions may be missing."
        logger.warning("Activity history write failed: %s", type(exc).__name__)
        return False


@app.before_request
def start_activity() -> None:
    if request.method not in {"POST", "PATCH"} or request.path not in ACTIVITY_OPERATIONS:
        return
    payload = request.get_json(silent=True)
    if not isinstance(payload, dict):
        return
    try:
        host, username, _ = _connection_values(payload)
    except (ValueError, TypeError, AttributeError):
        host, username = "", ""
    operation, category = ACTIVITY_OPERATIONS[request.path]
    if request.path == "/api/connect" and payload.get("isRefresh"):
        operation = "Data refresh"
    lines = [line.strip() for line in str(payload.get("config") or "").splitlines()
             if line.strip() and not line.lstrip().startswith("#")]
    details = {"operator": _activity_clean(username, payload)}
    if lines:
        details["commandCount"] = len(lines)
        if not re.search(r"password|secret|community|authentication-data|(?:^|[\s-])key(?:$|[\s-])", "\n".join(lines), re.I):
            details["batchFingerprint"] = hashlib.sha256("\n".join(lines).encode()).hexdigest()[:16]
        interfaces = set()
        for line in lines:
            try:
                parts = shlex.split(line)
            except ValueError:
                continue
            if len(parts) >= 3 and parts[1] == "interfaces" and INTERFACE_RE.fullmatch(parts[2]):
                interfaces.add(parts[2])
            elif len(parts) >= 5 and parts[1] == "protocols":
                interfaces.update(parts[index + 1] for index, part in enumerate(parts[:-1])
                                  if part == "interface" and INTERFACE_RE.fullmatch(parts[index + 1]))
        details["interfaces"] = sorted(interfaces)[:100]
    if isinstance(payload.get("ports"), list):
        details["ports"] = [name for name in payload["ports"] if isinstance(name, str) and INTERFACE_RE.fullmatch(name)][:100]
    if request.path == "/api/ports/bounce":
        details.update(kind=payload.get("kind") if payload.get("kind") in ("link", "poe") else "invalid",
                       interval=payload.get("interval") if type(payload.get("interval")) is int else None)
    related = str(payload.get("confirmationFor") or "")
    event = {"host": host.lower(), "device_name": _activity_clean(payload.get("deviceName"), payload)[:128],
             "operation": operation, "category": category, "request_id": uuid.uuid4().hex,
             "related_request_id": related if re.fullmatch(r"[a-f0-9]{32}", related) else "", "details": details}
    g.activity_event = event
    g.activity_payload = payload
    if category == "change" and request.path != "/api/protected-ports":
        _record_activity({**event, "status": "started", "severity": "info",
                          "message": f"{operation} requested. No completion result recorded yet."})


@app.after_request
def finish_activity(response):
    event = getattr(g, "activity_event", None)
    if event is None:
        return response
    payload = g.activity_payload
    body = response.get_json(silent=True) or {}
    ok = response.status_code < 400 and body.get("ok") is True
    status, severity = ("succeeded", "info") if ok else ("failed", "error")
    message = f'{event["operation"]} {"completed" if ok else "failed"}.'
    details = {**event["details"], "httpStatus": response.status_code}
    if request.path == "/api/connect" and ok:
        event["device_name"] = _activity_clean(body.get("deviceName"), payload)[:128]
        failures = [item for item in body.get("results", []) if item.get("error") or re.search(
            r"(?:error:|syntax error|permission denied|unknown command)", item.get("output") or "", re.I)]
        details["interfaceCount"] = body.get("portCount", 0)
        if failures:
            status, severity = "partial", "warning"
            details["commandErrors"] = [{"command": item.get("command"),
                "error": _activity_clean(_cli_failure_message(item.get("output", ""), item.get("error", ""), "Data pull failed"), payload)} for item in failures]
        message = f'{event["operation"]}: {details["interfaceCount"]} interfaces, {len(failures)} command errors.'
    elif request.path == "/api/push" and ok and body.get("pendingConfirmation"):
        status = "awaiting-confirmation"
        details["confirmationDeadline"] = (datetime.now(timezone.utc) + timedelta(minutes=body.get("confirmMinutes", 5))).isoformat(timespec="seconds")
        message = "Configuration applied with rollback protection; awaiting final confirmation."
    elif request.path == "/api/confirm" and ok:
        status, message = "confirmed", "Committed change confirmed successfully."
    elif request.path.startswith("/api/quick-") and ok:
        status, message = "committed", "Quick changes committed successfully; no confirmation window."
    elif body.get("stage") == "commit-check":
        status, message = "check-failed", "Commit check failed. No commit request was sent; draft retained in the browser."
    elif not ok and response.status_code >= 500 and event["category"] == "change":
        status, severity = "unverified", "warning"
        message = f'{event["operation"]} result could not be verified. Check switch state before retrying.'
    if body.get("error"):
        details["error"] = _activity_clean(body["error"], payload)
    if request.path == "/api/ports/bounce":
        details["portsAccepted"] = [item["port"] for item in body.get("results", []) if item.get("ok")]
        details["portErrors"] = [{"port": item["port"], "error": _activity_clean(item.get("error"), payload)}
                                 for item in body.get("results", []) if not item.get("ok")]
    stored = _record_activity({**event, "status": status, "severity": severity, "message": message, "details": details})
    if response.is_json:
        body["activityId"] = event["request_id"]
        if not stored:
            body["activityWarning"] = "This outcome could not be saved in activity history."
        response.set_data(app.json.dumps(body))
    return response


@app.get("/api/activity")
def activity_history() -> Any:
    view = request.args.get("view", "changes")
    try:
        before = int(request.args.get("before", "0"))
        if view not in {"changes", "all", "errors"} or before < 0:
            raise ValueError
    except ValueError:
        return jsonify({"ok": False, "error": "Invalid activity filter."}), 400
    try:
        history = _activity_store().read(host=request.args.get("host", ""), view=view, before=before)
        return jsonify({"ok": True, **history, "warning": ACTIVITY_LAST_ERROR,
                        "retentionDays": 90, "maxEntries": 50000})
    except (OSError, sqlite3.Error, ValueError):
        return jsonify({"ok": False, "error": "Activity history is unavailable. Check the local storage location."}), 503


@app.post("/api/activity/browser-error")
def browser_activity_error() -> Any:
    payload = request.get_json(silent=True) or {}
    if not isinstance(payload, dict) or not isinstance(payload.get("message"), str):
        return jsonify({"ok": False, "error": "Supply a browser error message."}), 400
    host, _, _ = _connection_values(payload)
    stored = _record_activity({"host": host, "device_name": _activity_clean(payload.get("deviceName"), payload)[:128],
        "operation": "Browser error", "category": "application", "status": "failed", "severity": "error",
        "message": _activity_clean(payload["message"], payload), "request_id": uuid.uuid4().hex,
        "details": {"source": _activity_clean(payload.get("source"), payload)[:200]}})
    return jsonify({"ok": stored}), 200 if stored else 503


def _ssh_client(host: str, username: str, password: str) -> paramiko.SSHClient:
    client = paramiko.SSHClient()
    client.load_system_host_keys()
    if _env_flag("JUNOS_ALLOW_UNKNOWN_HOST_KEY"):
        logger.info("Automatic SSH host-key acceptance is enabled for this connection")
        client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    else:
        client.set_missing_host_key_policy(paramiko.RejectPolicy())

    client.connect(
        hostname=host,
        port=int(os.getenv("JUNOS_SSH_PORT", "22")),
        username=username,
        password=password,
        look_for_keys=False,
        allow_agent=False,
        timeout=10,
        auth_timeout=10,
        banner_timeout=10,
    )
    return client


def _run_command(client: paramiko.SSHClient, command: str) -> tuple[str, str]:
    variants = []
    if not command.startswith("cli"):
        variants.append(f"cli -c {shlex.quote(command)}")
    variants.append(command)

    for variant in variants:
        stdin, stdout, stderr = client.exec_command(variant)
        output = stdout.read().decode("utf-8", errors="replace")
        error = stderr.read().decode("utf-8", errors="replace")
        combined = f"{output}\n{error}".strip()
        if combined:
            if "command not found" in combined.lower() or "unknown command" in combined.lower():
                continue
            return output, error
    return "", ""


def _parse_interfaces(output: str) -> list[str]:
    matches = []
    for line in output.splitlines():
        for match in INTERFACE_RE.finditer(line):
            iface = match.group(1).split(".")[0]
            if iface not in matches:
                matches.append(iface)
    return matches


def _parse_interface_details(output: str) -> list[dict[str, str]]:
    details_by_name: dict[str, dict[str, str]] = {}

    for line in output.splitlines():
        line = line.strip()
        if not line or line.startswith("Physical") or line.startswith("Interface"):
            continue
        match = INTERFACE_RE.search(line)
        if not match:
            continue
        matched_name = match.group(1)
        if "." in matched_name:
            continue
        iface = matched_name
        parts = line.split()
        admin = "unknown"
        oper = "unknown"
        if len(parts) >= 3:
            admin = parts[1].lower() if parts[1].lower() in {"up", "down"} else "unknown"
            oper = parts[2].lower() if parts[2].lower() in {"up", "down"} else "unknown"
        details_by_name[iface] = {"name": iface, "admin": admin, "oper": oper, "raw": line}

    return list(details_by_name.values())


def _normalize_interface_speed(value: str) -> str:
    speed = value.strip()
    speed = re.sub(r"(?<=\d)(?=[A-Za-z])", " ", speed)
    speed = re.sub(r"\bmbps\b", "Mbps", speed, flags=re.IGNORECASE)
    speed = re.sub(r"\bgbps\b", "Gbps", speed, flags=re.IGNORECASE)
    speed = re.sub(r"\btbps\b", "Tbps", speed, flags=re.IGNORECASE)
    if speed.lower() in {"", "unknown", "unspecified", "auto"}:
        return ""
    numeric_match = re.fullmatch(r"(\d+(?:\.\d+)?)\s+(Mbps|Gbps|Tbps)", speed, re.IGNORECASE)
    if not numeric_match:
        return speed
    amount = float(numeric_match.group(1))
    unit = numeric_match.group(2).lower()
    if unit == "mbps" and amount >= 1000:
        amount /= 1000
        unit = "gbps"
    elif unit == "gbps" and amount >= 1000:
        amount /= 1000
        unit = "tbps"
    formatted_amount = f"{amount:g}"
    display_unit = {"mbps": "Mbps", "gbps": "Gbps", "tbps": "Tbps"}[unit]
    return f"{formatted_amount} {display_unit}"


def _parse_interface_speeds(output: str) -> dict[str, dict[str, str]]:
    """Collect configured/capable and negotiated rates for physical interfaces."""
    speeds: dict[str, dict[str, str]] = {}
    current_interface = ""
    for raw_line in output.splitlines():
        physical_match = re.match(r"^\s*Physical interface\s*:\s*(\S+)", raw_line, re.IGNORECASE)
        if physical_match:
            candidate = physical_match.group(1).rstrip(",").split(".")[0]
            current_interface = candidate if INTERFACE_RE.fullmatch(candidate) else ""
            if current_interface:
                speeds.setdefault(current_interface, {})
        if not current_interface:
            continue
        configured_match = re.search(r"(?:^|,)\s*Speed\s*:\s*([^,]+)", raw_line, re.IGNORECASE)
        partner_match = re.search(r"Link partner Speed\s*:\s*([^,]+)", raw_line, re.IGNORECASE)
        if configured_match:
            configured = _normalize_interface_speed(configured_match.group(1))
            if configured:
                speeds[current_interface]["capability"] = configured
        if partner_match:
            negotiated = _normalize_interface_speed(partner_match.group(1))
            if negotiated:
                speeds[current_interface]["negotiated"] = negotiated
    return {name: rates for name, rates in speeds.items() if rates}


MAC_RE = re.compile(r"\b(?:[0-9a-f]{2}:){5}[0-9a-f]{2}\b", re.IGNORECASE)


def _mac_manufacturer(mac: str) -> str:
    """Resolve a globally assigned MAC against the bundled offline OUI database."""
    if not MAC_LOOKUP or not MAC_RE.fullmatch(mac):
        return ""
    first_octet = int(mac[:2], 16)
    if first_octet & 0b10:
        return ""
    try:
        return MAC_LOOKUP.lookup(mac)
    except (InvalidMacError, VendorNotFoundError):
        return ""


def _parse_ethernet_switching_table(output: str) -> dict[str, list[dict[str, str]]]:
    """Collect learned MAC entries by physical interface from common Junos table formats."""
    entries: dict[str, list[dict[str, str]]] = {}
    for raw_line in output.splitlines():
        mac_match = MAC_RE.search(raw_line)
        interface_matches = list(INTERFACE_RE.finditer(raw_line))
        if not mac_match or not interface_matches:
            continue
        interface_name = interface_matches[-1].group(1).split(".")[0]
        before_mac = [token for token in raw_line[:mac_match.start()].split() if token not in {"*", "-"}]
        vlan = before_mac[-1] if before_mac else ""
        entry = {"mac": mac_match.group(0).lower()}
        manufacturer = _mac_manufacturer(entry["mac"])
        if manufacturer:
            entry["manufacturer"] = manufacturer
        if vlan and vlan.lower() not in {"mac", "address"}:
            entry["vlan"] = vlan
        interface_entries = entries.setdefault(interface_name, [])
        if entry not in interface_entries:
            interface_entries.append(entry)
    return entries


def _parse_lldp_neighbors(output: str) -> dict[str, dict[str, str]]:
    """Parse the labeled blocks returned by `show lldp neighbors detail`."""
    neighbors: dict[str, dict[str, str]] = {}
    current_interface = ""
    field_names = {
        "chassis id": "chassisId",
        "port id": "portId",
        "port description": "portDescription",
        "system name": "systemName",
        "system description": "systemDescription",
        "system capabilities": "systemCapabilities",
        "enabled capabilities": "enabledCapabilities",
        "med manufacturer name": "manufacturer",
        "manufacturer name": "manufacturer",
        "med model name": "model",
        "model name": "model",
    }
    for raw_line in output.splitlines():
        line = raw_line.strip()
        local_match = re.match(r"^Local interface\s*:\s*(\S+)", line, re.IGNORECASE)
        if local_match:
            candidate = local_match.group(1).split(".")[0]
            current_interface = candidate if INTERFACE_RE.fullmatch(candidate) else ""
            if current_interface:
                neighbors.setdefault(current_interface, {})
            continue
        if not current_interface:
            continue
        field_match = re.match(r"^([^:]+?)\s*:\s*(.*)$", line)
        if not field_match:
            continue
        target = field_names.get(field_match.group(1).strip().lower())
        value = field_match.group(2).strip()
        if target and value and value != "-":
            neighbors[current_interface][target] = value
    return neighbors


def _enrich_lldp_neighbor(
    neighbor: dict[str, str], learned_macs: list[dict[str, str]]
) -> dict[str, str]:
    enriched = dict(neighbor)
    if not enriched.get("manufacturer"):
        enriched["manufacturer"] = _mac_manufacturer(enriched.get("chassisId", ""))
    if not enriched.get("manufacturer"):
        manufacturers = {entry.get("manufacturer", "") for entry in learned_macs}
        manufacturers.discard("")
        if len(manufacturers) == 1:
            enriched["manufacturer"] = manufacturers.pop()
    if not enriched.get("manufacturer"):
        enriched.pop("manufacturer", None)
    return enriched


def _parse_vlan_memberships(output: str) -> list[dict[str, str]]:
    memberships: list[dict[str, str]] = []
    seen: set[tuple[str, str]] = set()
    lines = [line.strip() for line in output.splitlines() if line.strip()]
    for line in lines:
        lowered = line.lower()
        if lowered.startswith(("name", "vlan", "routing instance")) or set(line) <= {"-", " ", "+"}:
            continue
        parts = re.split(r"\s+", line)
        tag_index = next((index for index, part in enumerate(parts) if re.fullmatch(r"\d+", part)), None)
        if tag_index is None or tag_index == 0:
            continue
        name = parts[tag_index - 1]
        value = parts[tag_index]
        key = (name, value)
        if key not in seen:
            memberships.append({"name": name, "value": value})
            seen.add(key)
    return memberships


def _parse_configured_vlans(output: str) -> list[dict[str, str]]:
    """Parse stable `set vlans NAME vlan-id TAG` configuration lines."""
    memberships: list[dict[str, str]] = []
    seen: set[tuple[str, str]] = set()
    pattern = re.compile(r"^set vlans\s+(\S+)\s+vlan-id\s+(\d+)\s*$", re.IGNORECASE)
    for raw_line in output.splitlines():
        match = pattern.match(raw_line.strip())
        if not match:
            continue
        key = (match.group(1), match.group(2))
        if key not in seen:
            memberships.append({"name": key[0], "value": key[1]})
            seen.add(key)
    return memberships


def _parse_vlan_l3_interfaces(output: str) -> dict[str, str]:
    """Return VLAN-to-IRB bindings from display-set configuration."""
    bindings: dict[str, str] = {}
    pattern = re.compile(
        r"^set vlans\s+(\S+)\s+l3-interface\s+(irb\.\d+)\s*$", re.IGNORECASE
    )
    for raw_line in output.splitlines():
        match = pattern.match(raw_line.strip())
        if match:
            bindings[match.group(1)] = match.group(2).lower()
    return bindings


def _parse_vlan_interface_members(output: str) -> list[dict[str, Any]]:
    """Parse direct logical-interface members used by service-provider VLANs."""
    services: dict[str, dict[str, Any]] = {}
    pattern = re.compile(r"^set vlans\s+(\S+)\s+interface\s+(\S+)\s*$", re.IGNORECASE)
    for raw_line in output.splitlines():
        match = pattern.match(raw_line.strip())
        if not match or not INTERFACE_RE.fullmatch(match.group(2)) or "." not in match.group(2):
            continue
        service = services.setdefault(match.group(1), {"name": match.group(1), "interfaces": []})
        if match.group(2) not in service["interfaces"]:
            service["interfaces"].append(match.group(2))
    return list(services.values())


def _parse_irb_configuration(output: str) -> list[dict[str, Any]]:
    """Parse IPv4 addresses configured on IRB logical units."""
    units: dict[int, dict[str, Any]] = {}
    pattern = re.compile(
        r"^set interfaces irb unit\s+(\d+)\s+family inet address\s+(\S+)\s*$",
        re.IGNORECASE,
    )
    for raw_line in output.splitlines():
        match = pattern.match(raw_line.strip())
        if not match:
            continue
        unit = int(match.group(1))
        try:
            parsed_address = ipaddress.ip_interface(match.group(2))
        except ValueError:
            continue
        if parsed_address.version != 4:
            continue
        address = str(parsed_address)
        details = units.setdefault(unit, {"unit": unit, "addresses": []})
        if address not in details["addresses"]:
            details["addresses"].append(address)
    return [units[unit] for unit in sorted(units)]


def _parse_interface_configuration(output: str) -> dict[str, dict[str, Any]]:
    configuration: dict[str, dict[str, Any]] = {}
    for raw_line in output.splitlines():
        line = raw_line.strip()
        match = re.match(r"^set interfaces\s+(\S+)\s+(.+)$", line)
        if not match:
            continue
        interface_name = match.group(1).split(".")[0]
        if not INTERFACE_RE.fullmatch(interface_name):
            continue
        remainder = match.group(2)
        details = configuration.setdefault(interface_name, {"vlans": [], "setLines": []})
        details["setLines"].append(line)

        mode_match = re.search(r"(interface-mode|port-mode)\s+(access|trunk)\b", remainder)
        if mode_match:
            details["modeKeyword"] = mode_match.group(1)
            details["mode"] = mode_match.group(2)

        native_vlan_match = re.search(r"(?:^|\s)native-vlan-id\s+(\d+)\b", remainder)
        if native_vlan_match:
            details["nativeVlanId"] = native_vlan_match.group(1)

        description_match = re.match(r"description\s+(.+)$", remainder)
        if description_match:
            try:
                description_parts = shlex.split(description_match.group(1))
            except ValueError:
                description_parts = []
            if description_parts:
                details["description"] = " ".join(description_parts)

        if remainder == "disable":
            details["disabled"] = True

        vlan_match = re.search(r"vlan members\s+(.+)$", remainder)
        if vlan_match:
            try:
                values = shlex.split(vlan_match.group(1).replace("[", " ").replace("]", " "))
            except ValueError:
                values = []
            for value in values:
                if value not in details["vlans"]:
                    details["vlans"].append(value)
    return configuration


def _configured_interface_names(configuration: dict[str, dict[str, Any]]) -> set[str]:
    """Treat switch ports with at least one VLAN membership as configured."""
    return {
        name
        for name, details in configuration.items()
        if details.get("vlans")
    }


def _parse_metadata(results: list[dict[str, str]]) -> dict[str, str]:
    combined = "\n".join(item.get("output", "") for item in results)
    metadata: dict[str, str] = {}

    # detect hostname from several possible outputs
    hostname_matches = re.findall(r"(?:hostname|Hostname|host-name|Host-name)\s+([A-Za-z0-9._-]+)", combined, re.IGNORECASE)
    if hostname_matches:
        metadata["hostname"] = hostname_matches[0]
    else:
        # also detect from configuration output lines like: set system host-name switch01
        m = re.search(r"set system host-name\s+([A-Za-z0-9._-]+)", combined)
        if m:
            metadata["hostname"] = m.group(1)

    model_match = re.search(r"Model:\s*(.+)", combined, re.IGNORECASE)
    if model_match:
        metadata["model"] = model_match.group(1).strip()

    version_match = re.search(r"Junos:\s*(.+)", combined, re.IGNORECASE)
    if version_match:
        metadata["version"] = version_match.group(1).strip()

    serial_match = re.search(r"Serial\s+number:\s*(.+)", combined, re.IGNORECASE)
    if serial_match:
        metadata["serial"] = serial_match.group(1).strip()

    return metadata


@app.get("/")
@app.get("/index.html")
def index() -> Any:
    return send_from_directory(RESOURCE_DIR, "index.html")


@app.get("/styles.css")
def stylesheet() -> Any:
    return send_from_directory(RESOURCE_DIR, "styles.css")


@app.get("/script.js")
def javascript() -> Any:
    return send_from_directory(RESOURCE_DIR, "script.js")


@app.get("/live-watch.js")
def live_watch_javascript() -> Any:
    return send_from_directory(RESOURCE_DIR, "live-watch.js")


@app.get("/api/health")
def health() -> Any:
    return jsonify({"ok": True, "appVersion": APP_VERSION, "apiVersion": API_VERSION, "packaged": IS_FROZEN})


@app.post("/api/shutdown")
def shutdown() -> Any:
    if not IS_FROZEN:
        return jsonify({"ok": False, "error": "Shutdown is available only in the packaged app."}), 404
    try:
        is_loopback = ipaddress.ip_address(request.remote_addr or "").is_loopback
    except ValueError:
        is_loopback = False
    if not is_loopback or request.headers.get("X-Junos-Helper") != "shutdown":
        return jsonify({"ok": False, "error": "Local shutdown authorization is required."}), 403
    _schedule_process_shutdown()
    return jsonify({"ok": True, "message": "Junos Helper is stopping."})


@app.get("/api/defaults")
def defaults() -> Any:
    """Return non-secret local-development defaults to the browser."""
    return jsonify(
        {
            "host": os.getenv("JUNOS_HOST", ""),
            "username": os.getenv("JUNOS_USERNAME", ""),
        }
    )


def _public_saved_devices() -> list[dict[str, str]]:
    def device_sort_key(device: dict[str, str]) -> tuple[int, int | str, str]:
        try:
            address = ipaddress.ip_address(device["host"])
            return (0 if address.version == 4 else 1, int(address), device["hostname"].lower())
        except ValueError:
            return (2, device["host"].lower(), device["hostname"].lower())

    return sorted(
        (
            {
                "id": device_id,
                "hostname": details["hostname"],
                "host": details["host"],
                "username": details["username"],
                "group": details.get("group", ""),
            }
            for device_id, details in _saved_devices().items()
        ),
        key=device_sort_key,
    )


@app.get("/api/devices")
def saved_devices() -> Any:
    return jsonify({"ok": True, "devices": _public_saved_devices()})


@app.post("/api/devices")
def save_device() -> Any:
    payload = request.get_json(silent=True) or {}
    hostname = str(payload.get("hostname") or "").strip()
    group = str(payload.get("group") or "").strip()
    host, username, password = _connection_values(payload)
    if not hostname or not re.fullmatch(r"[A-Za-z0-9._-]{1,253}", hostname):
        return jsonify({"ok": False, "error": "A valid discovered device hostname is required."}), 400
    if not host or not username or not password:
        return jsonify({"ok": False, "error": "Host, username, and password are required to save a device."}), 400
    if group and not re.fullmatch(r"[A-Za-z0-9 ._:-]{1,64}", group):
        return jsonify({"ok": False, "error": "Group names may use letters, numbers, spaces, . _ : and -."}), 400

    device_id = _saved_device_id(hostname)
    values = {
        "HOSTNAME": hostname,
        "HOST": host,
        "USERNAME": username,
        "PASSWORD": password,
        "GROUP": group,
    }
    try:
        _persist_environment_values({
            f"{SAVED_DEVICE_PREFIX}{device_id}_{field}": value
            for field, value in values.items()
        })
    except OSError as exc:
        logger.warning("Unable to save device %s: %s", hostname, exc)
        return jsonify({"ok": False, "error": f"Unable to update {ENV_PATH.name}: {exc}"}), 500

    device = next(item for item in _public_saved_devices() if item["id"] == device_id)
    logger.info("Saved local connection profile for %s", hostname)
    return jsonify({"ok": True, "device": device})


@app.patch("/api/devices/group")
def assign_device_group() -> Any:
    payload = request.get_json(silent=True) or {}
    raw_device_ids = payload.get("deviceIds")
    group = str(payload.get("group") or "").strip()
    if not isinstance(raw_device_ids, list) or not raw_device_ids or len(raw_device_ids) > 500:
        return jsonify({"ok": False, "error": "Select between 1 and 500 saved devices."}), 400
    device_ids = list(dict.fromkeys(str(device_id).strip().upper() for device_id in raw_device_ids))
    if any(not re.fullmatch(r"[A-Z0-9_]{1,64}", device_id) for device_id in device_ids):
        return jsonify({"ok": False, "error": "An invalid saved-device ID was supplied."}), 400
    if group and not re.fullmatch(r"[A-Za-z0-9 ._:-]{1,64}", group):
        return jsonify({"ok": False, "error": "Group names may use letters, numbers, spaces, . _ : and -."}), 400
    saved = _saved_devices()
    missing = [device_id for device_id in device_ids if device_id not in saved]
    if missing:
        return jsonify({"ok": False, "error": "One or more saved devices no longer exist."}), 400

    try:
        _persist_environment_values({
            f"{SAVED_DEVICE_PREFIX}{device_id}_GROUP": group
            for device_id in device_ids
        })
    except OSError as exc:
        logger.warning("Unable to assign saved-device group: %s", exc)
        return jsonify({"ok": False, "error": f"Unable to update {ENV_PATH.name}: {exc}"}), 500

    logger.info("Assigned %d saved device(s) to group %s", len(device_ids), group or "Ungrouped")
    return jsonify({"ok": True, "devices": _public_saved_devices(), "updated": len(device_ids)})


@app.post("/api/connect")
def connect_switch() -> Any:
    payload = request.get_json(silent=True) or {}
    host, username, password = _connection_values(payload)

    if not host or not username:
        return jsonify({"ok": False, "error": "Host and username are required."}), 400

    client: paramiko.SSHClient | None = None

    try:
        client = _ssh_client(host, username, password)
        results = []
        for command in DISCOVERY_COMMANDS:
            output, error = _run_command(client, command)
            results.append({"command": command, "output": output, "error": error})

        parsed_interface_names: list[str] = []
        interface_details: list[dict[str, Any]] = []
        learned_macs_by_interface: dict[str, list[dict[str, str]]] = {}
        lldp_neighbors_by_interface: dict[str, dict[str, str]] = {}
        interface_speeds_by_name: dict[str, dict[str, str]] = {}
        vlan_memberships_by_name: dict[str, dict[str, str]] = {}
        vlan_l3_interfaces: dict[str, str] = {}
        irb_units: list[dict[str, Any]] = []
        bridge_services: list[dict[str, Any]] = []
        for item in results:
            if item["command"].startswith("show interfaces"):
                parsed_interface_names.extend(_parse_interfaces(item["output"]))
                interface_details.extend(_parse_interface_details(item["output"]))
            if item["command"] == "show ethernet-switching table":
                learned_macs_by_interface = _parse_ethernet_switching_table(item["output"])
            if item["command"] == "show interfaces media":
                interface_speeds_by_name = _parse_interface_speeds(item["output"])
            if item["command"] == "show lldp neighbors detail":
                lldp_neighbors_by_interface = _parse_lldp_neighbors(item["output"])
            if item["command"] == "show vlans":
                for vlan in _parse_vlan_memberships(item["output"]):
                    vlan_memberships_by_name[vlan["name"]] = vlan
            if item["command"].startswith("show configuration vlans"):
                for vlan in _parse_configured_vlans(item["output"]):
                    vlan_memberships_by_name[vlan["name"]] = vlan
                vlan_l3_interfaces.update(_parse_vlan_l3_interfaces(item["output"]))
                bridge_services = _parse_vlan_interface_members(item["output"])

        operational_interface_names = set(parsed_interface_names)

        # collect configured interfaces from any configuration output
        interface_configuration: dict[str, dict[str, Any]] = {}
        for item in results:
            cmd = item.get("command", "")
            out = item.get("output", "") or ""
            if "show configuration interfaces" in cmd:
                interface_configuration.update(_parse_interface_configuration(out))
                irb_units = _parse_irb_configuration(out)

        # Some platforms omit inactive physical ports from operational interface
        # output even though their configuration remains present. Keep live-output
        # order, then add any configuration-only ports so they still receive tiles.
        metadata = _parse_metadata(results)
        parsed_interface_names = _preferred_interface_names(
            [*parsed_interface_names, *interface_configuration],
            metadata.get("model", ""),
        )
        parsed_interface_names.sort(
            key=lambda name: _interface_sort_key(name, metadata.get("model", ""))
        )
        details_by_name = {
            details["name"]: details
            for details in interface_details
            if details.get("name") in parsed_interface_names
        }
        interface_details = []
        for name in parsed_interface_names:
            if name in details_by_name:
                interface_details.append(details_by_name[name])
                continue
            configuration_only = name not in operational_interface_names
            fallback_details = {
                "name": name,
                "admin": "down" if configuration_only else "unknown",
                "oper": "down" if configuration_only else "unknown",
                "raw": "",
            }
            capability = _interface_name_capability(name)
            if capability:
                fallback_details["speedCapability"] = capability
            interface_details.append(fallback_details)

        for vlan_name, l3_interface in vlan_l3_interfaces.items():
            if vlan_name in vlan_memberships_by_name:
                vlan_memberships_by_name[vlan_name]["l3Interface"] = l3_interface

        configured_interfaces = (
            _configured_interface_names(interface_configuration) & set(parsed_interface_names)
        )

        # mark configured flag on interface details where applicable
        for d in interface_details:
            name = d.get("name", "")
            configured = interface_configuration.get(name, {})
            d["configured"] = name in configured_interfaces
            d["vlans"] = configured.get("vlans", [])
            for field in (
                "mode", "modeKeyword", "nativeVlanId", "description", "disabled", "setLines"
            ):
                if field in configured:
                    d[field] = configured[field]
            d["learnedMacs"] = learned_macs_by_interface.get(name, [])
            if name in interface_speeds_by_name:
                rates = interface_speeds_by_name[name]
                if "capability" in rates:
                    d["speedCapability"] = rates["capability"]
                if "negotiated" in rates:
                    d["negotiatedSpeed"] = rates["negotiated"]
                elif re.match(r"^(?:xe|et)-", name, re.IGNORECASE) and d.get("oper") == "up":
                    # Fixed-rate optical interface names reflect the active physical rate.
                    d["negotiatedSpeed"] = rates.get("capability", "")
            if name in lldp_neighbors_by_interface:
                d["lldpNeighbor"] = _enrich_lldp_neighbor(
                    lldp_neighbors_by_interface[name], d["learnedMacs"]
                )

        logger.info("Discovery completed for %s: interfaces=%s metadata=%s", host, parsed_interface_names, metadata)
        return jsonify(
            {
                "ok": True,
                "host": host,
                "collectedAt": utc_now(),
                "manualProtectedPorts": _manual_protected_ports(host),
                "results": results,
                "interfaces": parsed_interface_names,
                "portCount": len(parsed_interface_names),
                "metadata": metadata,
                "deviceName": metadata.get("hostname") or host,
                "interfaceDetails": interface_details,
                "vlanMemberships": sorted(
                    vlan_memberships_by_name.values(), key=lambda vlan: (int(vlan["value"]), vlan["name"])
                ),
                "configuredInterfaces": list(configured_interfaces),
                "interfaceConfiguration": interface_configuration,
                "irbUnits": irb_units,
                "bridgeServices": bridge_services,
                "debug": {
                    "interfaceCount": len(parsed_interface_names),
                    "vlanCount": len(vlan_memberships_by_name),
                    "configuredInterfaceCount": len(configured_interfaces),
                    "rawCommands": [item["command"] for item in results],
                },
            }
        )
    except (paramiko.SSHException, OSError, ValueError) as exc:
        logger.warning("Discovery failed for %s: %s", host, exc)
        return jsonify({"ok": False, "error": str(exc)}), 500
    finally:
        if client is not None:
            client.close()


def _validated_config_lines(config_text: str) -> list[str]:
    """Validate command framing; Junos validates configuration syntax and semantics."""
    if len(config_text) > 65536:
        raise ValueError("Configuration is too large.")
    if re.search(r"[\x00-\x08\x0b-\x1f\x7f]", config_text.replace("\r", "").replace("\n", "")):
        raise ValueError("Unsafe control character in configuration.")

    commands: list[str] = []
    for number, raw_line in enumerate(config_text.splitlines(), 1):
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        if any(token in line for token in (";", "|", "`", "$(")):
            raise ValueError(f"Unsafe command delimiter on line {number}: {line}")
        try:
            parts = shlex.split(line)
        except ValueError as exc:
            raise ValueError(f"Invalid quoting on line {number}: {line}") from exc
        if len(parts) < 2 or parts[0] not in {"set", "delete"} or not parts[1]:
            raise ValueError(f"Line {number}: only set/delete commands with a configuration path are allowed.")
        commands.append(line)

    if not commands:
        raise ValueError("No actionable Junos commands found.")
    if len(commands) > 500:
        raise ValueError("Configuration contains too many commands.")
    return commands


def _validated_description_only_lines(config_text: str) -> list[str]:
    commands = _validated_config_lines(config_text)
    for line in commands:
        parts = shlex.split(line)
        interface_name = parts[2] if len(parts) > 2 else ""
        is_physical_interface = bool(
            INTERFACE_RE.fullmatch(interface_name) and "." not in interface_name
        )
        is_set_description = (
            len(parts) == 5
            and parts[:2] == ["set", "interfaces"]
            and is_physical_interface
            and parts[3] == "description"
            and bool(parts[4])
        )
        is_delete_description = (
            len(parts) == 4
            and parts[:2] == ["delete", "interfaces"]
            and is_physical_interface
            and parts[3] == "description"
        )
        if not (is_set_description or is_delete_description):
            raise ValueError(
                "Quick commit accepts only complete physical-interface description set/delete commands."
            )
    return commands


def _execute_cli(client: paramiko.SSHClient, cli_commands: str) -> tuple[str, str, int]:
    remote_command = f"cli -c {shlex.quote(cli_commands)}"
    _, stdout, stderr = client.exec_command(remote_command, timeout=60)
    output = stdout.read().decode("utf-8", errors="replace")
    error = stderr.read().decode("utf-8", errors="replace")
    exit_status = stdout.channel.recv_exit_status()
    return output, error, exit_status


def _clean_compare_output(output: str) -> str:
    noise = {"entering configuration mode", "exiting configuration mode"}
    return "\n".join(line for line in output.splitlines() if line.strip().lower() not in noise).strip()


def _cli_failure_message(output: str, error: str, fallback: str) -> str:
    """Prefer actionable Junos CLI text, which is commonly written to stdout."""
    lines = [line.strip() for line in f"{error}\n{output}".splitlines() if line.strip()]
    actionable = [
        line for line in lines
        if any(marker in line.lower() for marker in ("error", "failed", "warning", "permission", "required"))
    ]
    message = "\n".join(actionable or lines[-4:])
    return message[:2000] or fallback


def _watch_read(client, command):
    _, stdout, stderr = client.exec_command(f"cli -c {shlex.quote(command)}", timeout=6)
    output = stdout.read().decode("utf-8", errors="replace")
    error = stderr.read().decode("utf-8", errors="replace")
    status = stdout.channel.recv_exit_status()
    if status != 0 or error.strip() or re.search(r"(?im)^\s*(?:error:|syntax error|unknown command|permission denied)", output):
        raise ValueError(_cli_failure_message(output, error, "The switch did not return interface statistics."))
    return output


def _watch_warning(host, message, payload):
    with WATCH_LOG_LOCK:
        now = time.monotonic()
        if now - WATCH_LOG_THROTTLE.get(host, -60) < 30:
            return
        if len(WATCH_LOG_THROTTLE) >= 64:
            WATCH_LOG_THROTTLE.clear()
        WATCH_LOG_THROTTLE[host] = now
    _record_activity({"host": host, "device_name": _activity_clean(payload.get("deviceName"), payload),
        "operation": "Live watch", "category": "monitor", "status": "read-failed", "severity": "warning",
        "request_id": uuid.uuid4().hex, "message": "Live statistics could not be collected completely.",
        "details": {"error": _activity_clean(message, payload)}})


@app.post("/api/live-watch/sample")
def live_watch_sample() -> Any:
    payload = request.get_json(silent=True)
    if not isinstance(payload, dict):
        return jsonify({"ok": False, "error": "Supply a connection and 1–8 watched ports."}), 400
    try:
        ports = validate_watch_ports(payload.get("ports"))
        host, username, password = _connection_values(payload)
        if not host or not username:
            raise ValueError("Host and username are required.")
        token = payload.get("sessionId") or ""
        if not isinstance(token, str) or token and not re.fullmatch(r"[a-f0-9]{32}", token):
            raise ValueError("Invalid watch session.")
        if type(payload.get("includePoe", False)) is not bool:
            raise ValueError("Choose whether to collect PoE information.")
    except (ValueError, TypeError, AttributeError) as exc:
        return jsonify({"ok": False, "error": str(exc)}), 400
    entry = None
    samples = []
    started = time.monotonic()
    fatal = False
    cancelled = False
    try:
        entry = WATCH_SESSIONS.acquire(host, username, password, token, _ssh_client)
        if not token:
            _record_activity({"host": host, "device_name": _activity_clean(payload.get("deviceName"), payload),
                "operation": "Live watch", "category": "monitor", "status": "started", "severity": "info",
                "request_id": uuid.uuid4().hex, "message": "Read-only live watch started.", "details": {"ports": ports}})
        for index, name in enumerate(ports):
            try:
                output = _watch_read(entry.client, f"show interfaces {name} extensive")
                sample = {**parse_interface_sample(output, name), "sampledAt": utc_now(),
                          "sampleTimeMs": time.monotonic() * 1000}
                if payload.get("includePoe"):
                    cached = entry.optional.get(name)
                    if cached is None or time.monotonic() - cached[0] >= 20:
                        try:
                            if name.startswith(("ae", "reth")):
                                raise ValueError("PoE is not applicable to this interface type.")
                            poe = {"available": True, **parse_poe_sample(_watch_read(entry.client, f"show poe interface {name}"), name)}
                        except ValueError as exc:
                            poe = {"available": False, "error": str(exc)}
                        except (paramiko.SSHException, OSError) as exc:
                            poe = {"available": False, "error": f"PoE read unavailable: {exc}"}
                            fatal = True
                            cancelled = not WATCH_SESSIONS.active(entry)
                            WATCH_SESSIONS.drop(entry.token)
                        poe["sampledAt"] = utc_now()
                        entry.optional[name] = (time.monotonic(), poe)
                    sample["poe"] = entry.optional[name][1]
                samples.append(sample)
                if fatal:
                    samples.extend({"name": remaining, "error": "Not collected after SSH failure."} for remaining in ports[index + 1:])
                    break
            except ValueError as exc:
                cancelled = cancelled or not WATCH_SESSIONS.active(entry)
                samples.append({"name": name, "error": str(exc)})
            except (paramiko.SSHException, OSError) as exc:
                samples.extend({"name": remaining, "error": f"Statistics unavailable after SSH failure: {exc}"} for remaining in ports[index:])
                fatal = True
                cancelled = not WATCH_SESSIONS.active(entry)
                WATCH_SESSIONS.drop(entry.token)
                break
        errors = [sample["error"] for sample in samples if sample.get("error")]
        if errors and not cancelled:
            _watch_warning(host, errors[0], payload)
        ok = any(not sample.get("error") for sample in samples)
        return jsonify({"ok": ok, "host": host, "sessionId": "" if fatal else entry.token, "ports": samples,
            "collectedAt": utc_now(), "durationMs": round((time.monotonic() - started) * 1000),
            "error": "" if ok else "No watched-port statistics could be collected."}), 200 if ok else 502
    except WatchSessionError as exc:
        return jsonify({"ok": False, "sessionExpired": exc.expired, "error": str(exc)}), 409
    except (paramiko.SSHException, OSError) as exc:
        _watch_warning(host, str(exc), payload)
        return jsonify({"ok": False, "error": str(exc), "sessionId": ""}), 502
    finally:
        if entry is not None:
            WATCH_SESSIONS.release(entry)


@app.post("/api/live-watch/stop")
def live_watch_stop() -> Any:
    payload = request.get_json(silent=True) or {}
    token = payload.get("sessionId") if isinstance(payload, dict) else None
    if not isinstance(token, str) or not re.fullmatch(r"[a-f0-9]{32}", token):
        return jsonify({"ok": False, "error": "Supply a watch session ID."}), 400
    host = WATCH_SESSIONS.drop(token)
    if host:
        _record_activity({"host": host, "operation": "Live watch", "category": "monitor", "status": "stopped",
            "severity": "info", "request_id": uuid.uuid4().hex, "message": "Read-only watch session closed."})
    return jsonify({"ok": True})


@app.post("/api/preview")
def preview_config() -> Any:
    payload = request.get_json(silent=True) or {}
    host, username, password = _connection_values(payload)
    config_text = (payload.get("config") or "").strip()
    if not host or not username:
        return jsonify({"ok": False, "error": "Host and username are required."}), 400
    try:
        commands = _validated_config_lines(config_text)
    except ValueError as exc:
        return jsonify({"ok": False, "error": str(exc)}), 400

    client: paramiko.SSHClient | None = None
    try:
        client = _ssh_client(host, username, password)
        combined = "; ".join(commands)
        output, error, exit_status = _execute_cli(
            client,
            f"configure private; {combined}; show | compare; rollback 0; exit",
        )
        combined_output = f"{output}\n{error}".lower()
        if exit_status != 0 or any(marker in combined_output for marker in ("error:", "syntax error")):
            return jsonify({"ok": False, "error": _cli_failure_message(output, error, "Preview failed."), "output": output.strip()}), 502
        return jsonify({"ok": True, "compare": _clean_compare_output(output), "error": error.strip()})
    except (paramiko.SSHException, OSError, ValueError) as exc:
        logger.warning("Preview failed for %s: %s", host, exc)
        return jsonify({"ok": False, "error": str(exc)}), 500
    finally:
        if client is not None:
            client.close()


def _protection_key(host: str) -> str:
    return "JUNOS_PROTECTED_" + hashlib.sha256(host.strip().lower().encode()).hexdigest().upper()


def _manual_protected_ports(host: str) -> list[str]:
    values = dotenv_values(ENV_PATH) if ENV_PATH.exists() else {}
    return (values.get(_protection_key(host)) or "").split()


@app.post("/api/protected-ports")
def save_protected_ports() -> Any:
    payload = request.get_json(silent=True) or {}
    host, _, _ = _connection_values(payload)
    ports = payload.get("ports")
    if not host or not isinstance(ports, list) or len(ports) > 1000 or any(
        not isinstance(port, str) or not INTERFACE_RE.fullmatch(port) or "." in port for port in ports
    ):
        return jsonify({"ok": False, "error": "Supply a host and physical port names."}), 400
    try:
        _persist_environment_values({_protection_key(host): " ".join(sorted(set(ports)))})
    except OSError as exc:
        return jsonify({"ok": False, "error": str(exc)}), 500
    return jsonify({"ok": True, "manualProtectedPorts": sorted(set(ports))})


def _quick_port_exclusions(configuration: dict, macs: dict, neighbors: dict, manual: list[str],
                           *, access_only: bool = True) -> dict[str, str]:
    reasons = dict.fromkeys(manual, "Manually protected")
    explicit = {name for name, details in configuration.items() if re.search(
        r"(?:^|[^a-z0-9])(?:uplink|upstream|distribution|distro|core)(?:$|[^a-z0-9])",
        details.get("description", ""), re.I
    )}
    counts = {name: len({entry["mac"].lower() for entry in entries}) for name, entries in macs.items()}
    mac_ports: dict[str, set[str]] = {}
    for name, entries in macs.items():
        for entry in entries:
            mac_ports.setdefault(entry["mac"].lower(), set()).add(name)
    for name, details in configuration.items():
        lines = details.get("setLines", [])
        neighbor = neighbors.get(name, {})
        capabilities = f'{neighbor.get("systemCapabilities", "")} {neighbor.get("enabledCapabilities", "")}'
        duplicate = {entry["mac"].lower() for entry in macs.get(name, []) if len(mac_ports[entry["mac"].lower()]) > 1}
        peers = set().union(*(mac_ports[mac] - {name} for mac in duplicate)) if duplicate else set()
        other_counts = [count for port, count in counts.items() if port != name and count]
        count = counts.get(name, 0)
        dominant = len(other_counts) >= 2 and count >= max(8, max(other_counts, default=0) * 4)
        if name in explicit:
            reasons[name] = "Uplink description"
        elif not PHYSICAL_INTERFACE_NAME_RE.fullmatch(name):
            reasons[name] = "Aggregated interface"
        elif details.get("mode") == "trunk" or (access_only and details.get("mode") != "access"):
            reasons[name] = "Requires explicit access mode"
        elif re.search(r"\b(?:bridge|router)\b", capabilities, re.I):
            reasons[name] = "LLDP switch/router neighbor"
        elif not explicit and (len(duplicate) >= 2 and len(peers) >= 2 or dominant):
            reasons[name] = "Uplink MAC pattern"
        elif any(re.search(r"\b802\.3ad\b", line) for line in lines):
            reasons[name] = "Aggregate member"
        elif access_only and any(re.search(r"\b(?:native-vlan-id|flexible-vlan-tagging|encapsulation|vlan-tagging)\b", line)
                 or re.search(r"\bunit (?!0\b)\d+\b", line)
                 or re.search(r"\bfamily (?!ethernet-switching\b)\S+", line) for line in lines):
            reasons[name] = "Aggregate membership or logical service configuration"
    return reasons


def _bounce_read(client: paramiko.SSHClient, command: str) -> str:
    output, error, status = _execute_cli(client, command)
    if status != 0 or error.strip() or re.search(
        r"(?:error:|syntax error|permission denied|unknown command|command not found)", output, re.I
    ):
        raise ValueError(_cli_failure_message(output, error, f"Unable to read {command}."))
    return output


def _check_bounce_ports(client: paramiko.SSHClient, host: str, ports: list[str], kind: str) -> None:
    details = {item["name"]: item for item in _parse_interface_details(_bounce_read(client, "show interfaces terse"))}
    configuration = _parse_interface_configuration(_bounce_read(client, "show configuration interfaces | display set"))
    for name in details:
        configuration.setdefault(name, {})
    macs = _parse_ethernet_switching_table(_bounce_read(client, "show ethernet-switching table"))
    neighbors = _parse_lldp_neighbors(_bounce_read(client, "show lldp neighbors detail"))
    exclusions = _quick_port_exclusions(configuration, macs, neighbors, _manual_protected_ports(host), access_only=False)
    errors = []
    for name in ports:
        if name not in details:
            errors.append(f"{name}: physical interface was not discovered; refresh inventory")
        elif name in exclusions:
            errors.append(f"{name}: {exclusions[name]}")
        elif configuration[name].get("disabled") or details[name]["admin"] != "up":
            errors.append(f"{name}: interface must be administratively enabled")
    if errors:
        raise ValueError("No ports bounced. " + "; ".join(errors))
    if kind == "poe":
        for name in ports:
            output = _bounce_read(client, f"show poe interface {name}")
            if not re.search(r"Administrative status\s*:\s*Enabled\b", output, re.I):
                raise ValueError(f"No ports bounced. {name}: PoE is not enabled or its status could not be verified.")


@app.post("/api/ports/bounce")
def bounce_ports() -> Any:
    payload = request.get_json(silent=True) or {}
    host, username, password = _connection_values(payload)
    ports, kind, interval = payload.get("ports"), payload.get("kind"), payload.get("interval", 5)
    if not host or not username:
        return jsonify({"ok": False, "error": "Host and username are required."}), 400
    if kind not in ("link", "poe") or type(interval) is not int or not 1 <= interval <= 30:
        return jsonify({"ok": False, "error": "Choose link or poe bounce and an interval from 1 to 30 seconds."}), 400
    if not isinstance(ports, list) or not 1 <= len(ports) <= 48 or any(
        not isinstance(name, str) or not PHYSICAL_INTERFACE_NAME_RE.fullmatch(name) for name in ports
    ):
        return jsonify({"ok": False, "error": "Select 1 to 48 physical Ethernet ports."}), 400
    ports = list(dict.fromkeys(ports))
    if not PORT_BOUNCE_LOCK.acquire(blocking=False):
        return jsonify({"ok": False, "error": "Another bounce request is in progress."}), 409
    client = None
    results = []
    try:
        client = _ssh_client(host, username, password)
        _check_bounce_ports(client, host, ports, kind)
        for name in ports:
            command = f"request interface bounce {'poe ' if kind == 'poe' else ''}{name} interval {interval}"
            try:
                output, error, status = _execute_cli(client, command)
            except (paramiko.SSHException, OSError) as exc:
                results.append({"port": name, "ok": False, "error": f"Response unavailable; bounce may have started: {exc}"})
                for remaining in ports[len(results):]:
                    results.append({"port": remaining, "ok": False, "error": "Not attempted after connection failure."})
                break
            acknowledged = re.search(
                rf"PoE bounce request received for {re.escape(name)}\b" if kind == "poe"
                else rf"Bounce operation on interface {re.escape(name)} started\b", output, re.I
            )
            ok = status == 0 and not error.strip() and bool(acknowledged) and not re.search(
                r"(?:error:|failed|syntax error|permission denied)", output, re.I
            )
            results.append({"port": name, "ok": ok, "output": output.strip(), "error": "" if ok else
                            _cli_failure_message(output, error, "Bounce was not acknowledged; check switch support and port status.")})
        ok = all(result["ok"] for result in results)
        logger.info("%s bounce requested for %s on %s: %s", kind, ports, host, results)
        return jsonify({"ok": ok, "results": results, "interval": interval,
                        "error": "" if ok else "Some bounce requests failed or could not be verified. Review per-port results."}), 200 if ok else 502
    except ValueError as exc:
        return jsonify({"ok": False, "error": str(exc), "results": results}), 409
    except (paramiko.SSHException, OSError) as exc:
        return jsonify({"ok": False, "error": str(exc), "results": results}), 502
    finally:
        try:
            if client is not None:
                client.close()
        finally:
            PORT_BOUNCE_LOCK.release()


def _validated_quick_task_lines(config_text: str, configuration: dict, vlan_output: str,
                                macs: dict, neighbors: dict, manual: list[str]) -> list[str]:
    commands = _validated_config_lines(config_text)
    exclusions = _quick_port_exclusions(configuration, macs, neighbors, manual)
    names = set(re.findall(r"^set vlans (\S+)", vlan_output, re.M))
    ids = {int(value) for value in re.findall(r"\bvlan-id (\d+)\b", vlan_output)}
    for command in commands:
        try:
            _validated_description_only_lines(command)
            continue
        except ValueError:
            pass
        parts = shlex.split(command)
        if len(parts) == 4 and parts[1] == "interfaces" and parts[3] == "disable":
            name = parts[2]
            if name not in configuration or name in exclusions:
                raise ValueError(f"{name}: {exclusions.get(name, 'not discovered as an access port')}. Use rollback protection.")
            if any(member.split(".")[0] == name for member in re.findall(r"^set vlans \S+ interface (\S+)", vlan_output, re.M)):
                raise ValueError(f"{name}: bridge service member. Use rollback protection.")
        elif len(parts) == 5 and parts[:2] == ["set", "vlans"] and parts[3] == "vlan-id":
            if not re.fullmatch(r"[A-Za-z0-9_.:-]+", parts[2]) or not parts[4].isdigit() or not 1 <= int(parts[4]) <= 4094:
                raise ValueError("Quick VLAN creation requires a valid name and an ID between 1 and 4094.")
            name, vlan_id = parts[2], int(parts[4])
            if name in names or vlan_id in ids:
                raise ValueError("Quick VLAN creation requires an unused name and ID, including within this batch.")
            names.add(name)
            ids.add(vlan_id)
        else:
            raise ValueError("Quick tasks allow only descriptions, new VLAN IDs, and eligible access-port enable/disable commands.")
    return commands


@app.post("/api/quick-task-commit")
@app.post("/api/quick-description-commit")
def quick_description_commit() -> Any:
    payload = request.get_json(silent=True) or {}
    host, username, password = _connection_values(payload)
    config_text = (payload.get("config") or "").strip()

    if not host or not username:
        return jsonify({"ok": False, "error": "Host and username are required."}), 400
    if not config_text:
        return jsonify({"ok": False, "error": "No configuration provided."}), 400

    try:
        if request.path == "/api/quick-task-commit":
            commands = _validated_config_lines(config_text)
        else:
            commands = _validated_description_only_lines(config_text)
    except ValueError as exc:
        return jsonify({"ok": False, "error": str(exc)}), 400

    client: paramiko.SSHClient | None = None
    try:
        client = _ssh_client(host, username, password)
        if request.path == "/api/quick-task-commit":
            fresh = {}
            for command in ("show configuration interfaces | display set", "show configuration vlans | display set",
                            "show ethernet-switching table", "show lldp neighbors detail"):
                output, error, read_status = _execute_cli(client, command)
                if read_status != 0 or error.strip() or re.search(
                    r"(?:error:|syntax error|permission denied|unknown command|command not found)", output, re.I
                ):
                    raise ValueError("Fresh quick-task checks failed; refresh or use the protected workflow.")
                fresh[command] = output
            commands = _validated_quick_task_lines(
                config_text, _parse_interface_configuration(fresh["show configuration interfaces | display set"]),
                fresh["show configuration vlans | display set"],
                _parse_ethernet_switching_table(fresh["show ethernet-switching table"]),
                _parse_lldp_neighbors(fresh["show lldp neighbors detail"]), _manual_protected_ports(host)
            )
        combined = "; ".join(commands)
        commit_comment = "Quick tasks via Junos Helper" if request.path == "/api/quick-task-commit" else QUICK_DESCRIPTION_COMMIT_COMMENT
        output, error, exit_status = _execute_cli(
            client,
            f'configure exclusive; {combined}; commit check; commit comment "{commit_comment}"; exit',
        )
        combined_output = f"{output}\n{error}".lower()
        failure_markers = ("error:", "commit failed", "configuration check-out failed", "syntax error")
        success = "commit complete" in combined_output
        if exit_status != 0 or not success or any(marker in combined_output for marker in failure_markers):
            message = _cli_failure_message(output, error, "Description commit did not complete.")
            logger.warning("Description commit rejected by %s (status %s): %s", host, exit_status, message)
            return jsonify(
                {"ok": False, "error": message, "output": output.strip()}
            ), 502

        return jsonify(
            {
                "ok": True,
                "output": output.strip(),
                "error": error.strip(),
                "pendingConfirmation": False,
                "commandCount": len(commands),
            }
        )
    except (paramiko.SSHException, OSError, ValueError) as exc:
        logger.warning("Description commit failed for %s: %s", host, exc)
        return jsonify({"ok": False, "error": str(exc)}), 500
    finally:
        if client is not None:
            client.close()


@app.post("/api/push")
def push_config() -> Any:
    payload = request.get_json(silent=True) or {}
    host, username, password = _connection_values(payload)
    config_text = (payload.get("config") or "").strip()

    if not host or not username:
        return jsonify({"ok": False, "error": "Host and username are required."}), 400
    if not config_text:
        return jsonify({"ok": False, "error": "No configuration provided."}), 400

    try:
        commands = _validated_config_lines(config_text)
    except ValueError as exc:
        return jsonify({"ok": False, "error": str(exc)}), 400

    client: paramiko.SSHClient | None = None

    try:
        client = _ssh_client(host, username, password)
        combined = "; ".join(commands)
        # Do not send a commit request unless this exact payload passes a separate
        # check. The private candidate is discarded on both success and failure.
        check_output, check_error, check_status = _execute_cli(
            client,
            f"configure private; {combined}; commit check; rollback 0; exit",
        )
        check_text = f"{check_output}\n{check_error}".lower()
        failure_markers = ("error:", "commit failed", "configuration check-out failed", "syntax error", "unknown command", "permission denied")
        if (check_status != 0 or "configuration check succeeds" not in check_text
                or any(marker in check_text for marker in failure_markers)):
            message = _cli_failure_message(check_output, check_error, "Junos did not report a successful commit check.")
            return jsonify({
                "ok": False, "stage": "commit-check", "error": message,
                "output": check_output.strip(), "pendingConfirmation": False,
            }), 422
        output, error, exit_status = _execute_cli(
            client,
            f'configure exclusive; {combined}; commit check; commit confirmed 5 comment "{COMMIT_COMMENT}"; exit',
        )
        combined_output = f"{output}\n{error}".lower()
        success = "commit complete" in combined_output or "commit confirmed" in combined_output
        if exit_status != 0 or not success or any(marker in combined_output for marker in failure_markers):
            message = _cli_failure_message(output, error, "Commit did not complete.")
            logger.warning("Commit rejected by %s (status %s): %s", host, exit_status, message)
            return jsonify(
                {"ok": False, "error": message, "output": output.strip()}
            ), 502

        return jsonify(
            {
                "ok": True,
                "output": output.strip(),
                "error": error.strip(),
                "pendingConfirmation": True,
                "commitCheckPassed": True,
                "confirmMinutes": 5,
            }
        )
    except (paramiko.SSHException, OSError, ValueError) as exc:
        logger.warning("Push failed for %s: %s", host, exc)
        return jsonify({"ok": False, "error": str(exc)}), 500
    finally:
        if client is not None:
            client.close()


@app.post("/api/confirm")
def confirm_config() -> Any:
    payload = request.get_json(silent=True) or {}
    host, username, password = _connection_values(payload)
    if not host or not username:
        return jsonify({"ok": False, "error": "Host and username are required."}), 400

    client: paramiko.SSHClient | None = None
    try:
        client = _ssh_client(host, username, password)
        output, error, exit_status = _execute_cli(
            client,
            f'configure exclusive; commit comment "{CONFIRM_COMMENT}"; exit',
        )
        combined_output = f"{output}\n{error}".lower()
        if exit_status != 0 or "commit complete" not in combined_output or "error:" in combined_output:
            message = _cli_failure_message(output, error, "Commit confirmation failed.")
            logger.warning("Commit confirmation rejected by %s (status %s): %s", host, exit_status, message)
            return jsonify(
                {"ok": False, "error": message, "output": output.strip()}
            ), 502
        return jsonify({"ok": True, "output": output.strip(), "error": error.strip()})
    except (paramiko.SSHException, OSError, ValueError) as exc:
        logger.warning("Commit confirmation failed for %s: %s", host, exc)
        return jsonify({"ok": False, "error": str(exc)}), 500
    finally:
        if client is not None:
            client.close()


def _run_local_server() -> None:
    bind_host = os.getenv("JUNOS_BIND_HOST", "127.0.0.1")
    bind_port = int(os.getenv("JUNOS_BIND_PORT", "8000"))
    app_url = _local_app_url(bind_host, bind_port)
    existing_url = _existing_helper_url(bind_host, bind_port)
    if existing_url:
        logger.warning("Junos Helper is already serving %s; not starting another server", existing_url)
        if IS_FROZEN:
            webbrowser.open(existing_url)
        return

    if not _acquire_packaged_instance_mutex():
        for _attempt in range(20):
            existing_url = _existing_helper_url(bind_host, bind_port)
            if existing_url:
                break
            time.sleep(0.1)
        logger.warning("Another packaged Junos Helper instance is already running")
        if existing_url:
            webbrowser.open(existing_url)
        return

    if IS_FROZEN and app_url:
        threading.Timer(1.0, webbrowser.open, args=(app_url,)).start()
    try:
        app.run(
            host=bind_host,
            port=bind_port,
            debug=_env_flag("JUNOS_DEBUG"),
            use_reloader=False,
        )
    finally:
        _release_packaged_instance_mutex()


if __name__ == "__main__":
    _run_local_server()
