# Proposed troubleshooting monitoring

Status: design only, 2026-10-28. No monitoring collector, storage, or UI has been
implemented. The v1.7 Live watch improvements are separate from this proposal;
see [current state](CURRENT_STATE.md) for their release status.

## Intended use

The user wants selected problem ports monitored for hours/days, especially for
link downs, power changes, and flaps. Start with one switch and 1–8 explicitly
selected ports. Preserve port names and descriptions in saved history so old
incidents remain identifiable even after a description changes.

The user is considering hosting the application in a CT/VM on their Proxmox
server for internal access. Treat a hosted Linux service as the preferred design
direction, subject to a separate deployment decision. This changes the service
lifetime and credential requirements below; it does not expand the initial
selected-problem-port scope into fleet monitoring. RADIUS/LDAP login and
permissions are explicitly future considerations, not current implementation
priorities. No Proxmox connection, host provisioning, or migration is authorized
by this discussion.

## Information to collect

| Evidence | Existing support | Proposed saved behavior |
| --- | --- | --- |
| Administrative and physical link state | Live watch parses both | Down/up observations, recovery, approximately bounded outage duration; distinguish administrative disable from unexpected link loss |
| Carrier transitions and last-flapped value | Live watch parses both | Detect evidence of brief down/up cycles between polls, with counter deltas and the latest switch-reported timestamp |
| PoE administrative/operational state and watts | Live watch parses basic fields; currently cached for 20 seconds | Power history, on/off/fault changes, and fresh per-field timestamps |
| PoE operational detail, power limit and device class | Not parsed yet | Save overload/power-budget/detection evidence where the model and release expose it |
| Interface errors, drops, framing errors, speed | Live watch parses these | Error bursts, speed changes, and counter-reset markers alongside incidents |
| PoE controller state and budget | Not collected yet | Slower context samples of capacity, reserved/consumed power, guard band, controller state |
| Switch uptime and chassis alarms | Not collected yet | Reboot evidence and active hardware/power/temperature alarms where available |
| SSH failures and collection interruption | UI errors exist; no persistent monitor coverage history | Explicit monitoring gaps, reconnects, app pauses, and device-unreachable observations |

Treat platform/release support and CLI permissions as capabilities discovered at
session start. Unsupported fields remain unavailable rather than zero/off. Basic
PoE values exist in the current parser; detailed fault reasons and controller or
chassis data need new parsers and representative fixtures.

## Proposed collection and lifetime

- Run collection in the Python backend, independently of browser timers. A
  closed/hidden browser must not stop an active saved monitoring session.
- For the proposed hosted deployment, collection runs as a managed Linux service
  while the Proxmox guest and required network paths are available. Browser and
  workstation shutdown do not end a recording. Guest/host downtime interrupts
  collection; saved history survives. Record unknown coverage on recovery rather
  than manufacturing outages. Service startup/restart and job recovery need
  explicit behavior, including whether a still-valid recording resumes.
- For a desktop deployment, the app and PC must still remain running/awake. Keep
  the same collector/storage design usable in both deployment modes where useful.
- Hosted restart recovery needs a server-side credential source. Store references
  to protected credentials in job definitions, never secrets in monitoring rows,
  exports, logs, or browser responses. Choose the secret mechanism and backup/key
  handling during deployment design. Prefer a dedicated read-only monitoring
  identity separate from credentials used for switch changes. A memory-only mode
  remains possible, but recordings then need reauthentication after app restart.
- Reuse/co-ordinate backend samples with Live watch where possible rather than
  running duplicate per-port CLI reads. Enforce per-device read budgets and
  backoff. Keep inventory refresh independent; yield during deployments/bounces
  and record the resulting coverage gap or known app action.
- Target 5–10-second link/error/PoE observations for selected ports, subject to
  measured device performance. Poll controller/uptime/alarm context less often,
  provisionally every 60 seconds. Show achieved intervals and freshness; the
  present 20-second PoE cache is not sufficient to promise 5-second power history.
- Use bounded local SQLite storage for structured samples, state transitions,
  session metadata, and coverage. Proposed default: retain seven days, with a
  storage cap and explicit retention behavior. No raw device dumps by default.
- Proposed controls: Start recording, Stop recording, and duration choices such
  as 1 hour / 6 hours / 24 hours / until stopped. These defaults are proposals.

## Event accuracy

Polling gives observations, not a complete event log. An outage can start and
finish between two polls. Carrier-transition increases can reveal down-to-up
cycles that were not directly observed, but do not reveal every event time or
downtime duration. The last-flapped field is only the most recent switch-reported
transition, not a full historical record. Handle counter clears, reboots, and
baseline changes before deriving deltas.

Store the collection time, switch-reported time when available, previous good
observation, and evidence source. Label events as observed, counter-evidenced,
or unknown coverage. Do not double-count an observed recovery and its matching
carrier increment as two incidents. Describe polling-derived outage durations
as approximate or bounded by observations.

Link down does not prove power loss. Zero watts or PoE OFF does not by itself
prove a fault or endpoint reboot. Switch unreachability does not prove the
switch rebooted. Correlate evidence without claiming causation, particularly
when PoE and link data were collected at different times. Show overlapping
events together so the user can distinguish link-only issues, power-related
evidence, administrative actions, and wider switch interruptions.

For finer event timing, a later opt-in phase can read existing switch logs or
ingest configured syslog/SNMP link notifications. Availability depends on device
configuration and retention; notifications can be lost. No switch logging/trap
configuration changes are authorized by this design discussion.

## Proposed report

One saved session contains a port summary (name + description, link incidents,
counter-evidenced flaps, PoE changes/faults, errors, and coverage), a filterable
event timeline, and aligned link-state / power / traffic histories. Mark gaps
explicitly and support export of structured events and samples as CSV. State
changes deserve timeline events; ordinary watt fluctuations belong in the graph.
Keep event filters/thresholds separate from collection so brief evidence is not
discarded merely to reduce notification noise.

Suggested first implementation: backend recording and coverage, link/PoE state
events, power graph, saved-session review, and CSV export. Add capability-tested
controller/chassis context next. This is a targeted diagnostic recorder, not an
approved fleet-monitoring project.

## Hosted deployment and future user access

Suggested sequence, not yet implementation approval:

1. Prepare Linux deployment: production WSGI serving behind an internal HTTPS
   endpoint, service supervision, explicit writable data/configuration paths,
   backups/restores, and server-mode UI behavior. Directory login can remain
   deferred while access is restricted to the intended internal users/network.
2. Add persistent recording with one authoritative collector and recoverable job
   definitions. Web requests read status and issue scoped commands; opening more
   browsers must not multiply polling or stop another user's recording.
3. Add RADIUS and/or LDAP authentication plus application permissions when the
   user makes this a priority. Authentication identifies the person; application
   authorization determines which reports, switches, and actions they can access.

Either an unprivileged Linux CT or a Linux VM is a candidate. A CT is lighter;
a VM provides stronger isolation from the Proxmox host. A small VM is a reasonable
default for an application holding switch-management credentials, but this is a
design recommendation, not a selected or provisioned deployment. Network
exposure, DNS, and certificate arrangements are not decided yet. The user
normally runs **Ubuntu Server 24.04.3** for this type of setup; use that as the
preferred deployment baseline. No Ubuntu guest has been provisioned or tested
for this application, and CT versus VM remains undecided.

The user proposed **2 vCPU / 2 GB RAM / 32 GB storage**. This is a reasonable
initial sizing estimate for the headless app, one targeted 1–8-port recording,
bounded SQLite history, and a few internal browser users; it is not a measured
capacity guarantee. Four GB RAM is an optional headroom increase, not a current
requirement. Keep retention/storage caps and monitor real memory/disk growth
during the pilot. At eight ports every five seconds, there are 138,240 port
samples/day or 967,680 over seven days if each poll produces one row per port.
Database bytes per row, indexes, journals, and any extra samples must be measured
after the schema exists. Include database-consistent backups in deployment
planning without assuming the 32 GB guest disk also holds backup archives.

Current source assumptions to address during migration:

- `_run_local_server()` uses Flask's development server. Hosted serving needs a
  production WSGI server; Flask documents this for private/internal use as well.
- The activity database defaults to a Windows-style user-local path even outside
  a frozen EXE. `JUNOS_HELPER_ACTIVITY_LOG_PATH` and `JUNOS_HELPER_ENV_PATH` already
  allow explicit overrides. Use durable server paths outside deployment code.
- Saved profiles in `.env` are currently global. The app has no user-login or
  role checks. Saved device IDs can resolve server-side credentials for operations;
  hiding a password in the UI does not establish per-user access to that device.
  Plan explicit access to profiles and actions before broadening access.
- Watch SSH sessions and locks are process-local. Multiple independent WSGI
  workers would not share those tokens or locks. Do not copy a generic multiworker
  deployment command unchanged. Centralize collector ownership and coordinate
  per-device reads/changes; use one appropriate web process during transition if
  needed rather than silently splitting session state.
- Browser-held drafts, selections, and confirmation state are not a multi-user
  operation registry. Hosted changes need server-side operation ownership,
  confirmation context, and per-device concurrency handling as that scope grows.
- The desktop shutdown action and browser auto-open behavior belong to desktop
  mode. Hosted users should not stop the shared service through those controls.

Leave stable identity/scope fields in the future job/event schema and one
server-side place to authorize each operation. Do not claim a named user initiated
an action until an authenticated identity exists. Proposed later roles:

| Role | Proposed access |
| --- | --- |
| Viewer | Read permitted reports and device data |
| Monitor operator | Start/stop permitted recordings and export results |
| Network operator | Perform explicitly permitted switch configuration/bounce actions |
| Administrator | Manage access, device credentials, retention, and service settings |

Roles may be combined or mapped from directory groups / RADIUS reply attributes.
Enforce them on backend routes, including exports and credential-backed device
actions; hiding buttons is presentation only. App login and switch SSH identity
are separate concepts. Details such as direct LDAP versus existing RADIUS backed
by LDAP, group mappings, session policies, and emergency access remain future
decisions. This proposal does not authorize an authentication build now.

## Primary references checked

- [Interface fields: link, errors, carrier transitions, last flapped](https://www.juniper.net/documentation/us/en/software/junos/cli-reference/topics/ref/command/show-interfaces-gigabit-ethernet.html)
- [PoE interface state and operational detail](https://www.juniper.net/documentation/us/en/software/junos/cli-reference/topics/ref/command/show-poe-interface.html)
- [PoE controller budget and state](https://www.juniper.net/documentation/us/en/software/junos/cli-reference/topics/ref/command/show-poe-controller.html)
- [System uptime](https://www.juniper.net/documentation/us/en/software/junos/cli-reference/topics/ref/command/show-system-uptime.html)
- [Chassis alarms](https://www.juniper.net/documentation/us/en/software/junos/cli-reference/topics/ref/command/show-chassis-alarms.html)
- [Supported SNMP notifications](https://www.juniper.net/documentation/us/en/software/junos/network-mgmt/topics/topic-map/snmp-traps-supported-by-junos-os.html)
- [Flask production deployment, including internal services](https://flask.palletsprojects.com/en/stable/deploying/)
- [Proxmox CT architecture and isolation considerations](https://github.com/proxmox/pve-docs/blob/master/pct.adoc)
- [FreeRADIUS LDAP group authorization concepts](https://www.freeradius.org/documentation/freeradius-server/4.0.0/howto/modules/ldap/authorization/index.html)
