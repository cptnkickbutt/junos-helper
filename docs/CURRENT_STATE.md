# Current project state

Read this file first in a new session. Replace stale facts instead of appending
history; detailed usage and procedures live in the linked references.

Last reviewed: 2026-11-09

## Current focus

The user requested a commit, push, and updated Windows EXE. v1.7 has been built
and verified locally. Commit/tag/push and GitHub publication are the remaining
release steps at this checkpoint; update this file after those operations.

v1.7 contains the previously uncommitted Live watch improvements, tests, usage
docs, and new continuity/server-planning docs. No long-term recorder,
authentication, Proxmox provisioning, or Linux deployment was implemented.

## Release status

- Branch: `main`; remote: `https://github.com/cptnkickbutt/junos-helper.git`.
- Previous published baseline: **v1.6**, 2026-10-27, commit `96d0874`.
- Prepared release: **v1.7**, 2026-11-09. App version `1.7`, API version `24`
  (browser requires the same), Windows file/product version `1.7.0.0`.
- Fresh standard build: `dist/JunosHelper.exe`; distribution copy:
  `dist/JunosHelper-v1.7.exe` (20,167,848 bytes). No saved profiles embedded.
- Existing coworker/seeded EXEs are separate ignored artifacts and were not rebuilt.

## Implemented behavior

- Custom command accepts Junos `set`/`delete` configuration paths. Global lines
  run once without selected ports. Optional variables are `{port}`,
  `{portNumber}`, `{index}`, `{device}`, and `{host}`; `{{`/`}}` escape braces.
  Preview and append validate variables and combined editor/queue limits.
- Protected push first loads a private candidate, runs `commit check`, and
  discards it. Only explicit success permits the exclusive apply/check and
  `commit confirmed 5`. Failed preflight preserves staged work. Quick commits
  retain their separate restricted eligibility checks.
- Options contains Device data (latest timestamped discovery pull) and Activity
  log (persistent actions/errors with device filters and linked push/confirmation
  records). Uncertain results remain explicitly unverified.
- Live watch pins 1-8 physical/channelized/aggregate ports independently of
  configuration selection. It samples traffic, packet rates, link state, errors,
  optional PoE, and timestamped inventory evidence. Defaults to 5-second reads;
  2/10 seconds, Check now, Pause/Resume, and Reset view are available.
- Watch graphs and baselines remain in memory for two minutes. Reused SSH
  sessions are bounded and expire when idle. Counter resets/gaps must not create
  spikes or invented zeroes. Reset view never clears switch counters.

## v1.7 Live watch changes

1. One shared two-minute graph for up to eight ports. Each port has a consistent
   color; transmit is above zero and dashed receive is below. TX and RX scale
   independently, with numeric ticks, units, and ranges. All ports share each
   direction's scale. Legends show interface name then a wrapping description;
   tooltips include both. Blank live descriptions fall back to the name without
   reviving old inventory descriptions; inventory descriptions are used before a
   live field is available. Metrics and expandable evidence remain below.
2. Hidden documents no longer deliberately suspend sampling or reset baselines
   on focus changes. Browser/OS throttling or sleeping tabs can still delay reads.
3. Six-second SSH command watchdog closes the dedicated watch transport, even
   during exec acknowledgement or trickling output. Streams/channels are closed.
   Stop starting reads after 12 seconds of batch work; an in-progress read can
   finish within its deadline. Preserve partial results and prioritize skipped
   ports next time. Optional cached PoE survives a deferred power read.
4. Successful slow batches no longer wait an additional full interval; failures
   retain the interval retry delay. Show in-progress elapsed time, last batch
   duration, and each port's traffic-read duration.
5. Separate `inventoryRefreshInProgress` from watch-blocking connection work.
   Automatic/manual same-target read-only refresh preserves in-flight watch,
   SSH session, and baselines, even on refresh failure. Initial/reconnections,
   different-target refresh, deployment, and bounce remain blocking. Losing a
   watched port or changing target/credentials still clears the watch.

Earlier user feedback described the refresh fix as "much better." Regression
coverage reproduces the one-minute-refresh interaction; this is not exhaustive
hardware validation. The original symptom's relationship to the additional
watchdog/scheduling hardening remains unproven.

## Deferred monitoring and server work

The user wants selected problem ports monitored for hours/days, especially link
downs, power changes, and flaps. [Monitoring design](MONITORING_DESIGN.md) records
backend collection independent of the browser, saved events/power history,
coverage gaps, timing limits, durable paths, job/credential recovery, and one
authoritative collector. Proposed intervals, retention, controls, roles, and
phases are not approved implementation requirements.

The user is arranging a Proxmox CT/VM for internal access. Preferred baseline:
Ubuntu Server 24.04.3, proposed 2 vCPU/2 GB RAM/32 GB disk. This is an initial
estimate, not load-tested capacity. Guest type/address and installed state remain
unverified. RADIUS/LDAP and permissions are deferred. No server was accessed,
provisioned, deployed, or tested in this workspace session.

[Server setup brief](SERVER_SETUP_BRIEF.md) is the external handoff: read-only
GitHub deploy key, local push -> server pull, one Gunicorn worker with threads,
systemd/Nginx, external durable paths, verified switch host keys, restricted
internal access, and backup/update/rollback checks. Migration concerns remain:
no app-user authentication, global saved profiles, process-local watch sessions
and locks, browser-held deployment/confirmation state, Windows-style activity
path defaults, and development-server startup. Deferred ideas are context, not
instructions to implement them automatically.

## Verification

Completed in this 2026-11-09 release session:

- **115 Python + 61 Node tests passed (176 total)** before the version-only bump.
  Coverage includes refresh/watch integration, watchdog and stream cleanup,
  batch-budget fairness, hidden-tab collection, slow-success scheduling,
  direction/scaling/gaps, eight ports/sixteen traces, and safe legend rendering.
- Standard PyInstaller build completed with workspace-local cache.
- Archive inspection confirmed byte-identical current HTML/CSS/JS assets,
  `live_watch`/`activity_log` modules, vendor database, and no `.env`/`seed.env`.
- Windows file/product metadata verified as `1.7.0.0`.
- Fresh EXE started on an isolated loopback port with empty test profiles and a
  workspace-local activity path. `/api/health` reported v1.7/API 24/packaged;
  all four served assets matched source. Authorized local shutdown returned
  success and the launcher exited cleanly.

No real-switch sampling/configuration or Linux deployment was tested. No fresh
visual browser inspection was performed. Earlier-session visual validation was
blocked by browser tooling; the ignored `.audit-cache/live-preview/` fixture is
synthetic and is not hardware evidence.

## Local workflow and data

- Source: `.\.venv\Scripts\python.exe app.py` (normally localhost:8000).
- Checks: `.\.venv\Scripts\python.exe -m unittest discover -s tests -q`;
  `node --test tests/test_frontend_logic.cjs tests/test_live_watch.cjs`;
  `git diff --check`.
- Build: set `PYINSTALLER_CONFIG_DIR` to workspace `build\pyinstaller-cache`,
  then `powershell -NoProfile -ExecutionPolicy Bypass -File .\build.ps1`.
  Before recursive Windows cleanup verify absolute targets remain inside the
  workspace and contain no junctions/symlinks.
- Standard build excludes credentials. `-IncludeSavedDevices` embeds extractable
  plaintext credentials and is only for explicitly requested trusted distribution.
- Source profiles: ignored `.env`. Packaged profiles:
  `%LOCALAPPDATA%\Junos Helper\.env`; `JUNOS_HELPER_ENV_PATH` overrides it.
- Activity: `%LOCALAPPDATA%\Junos Helper\activity.sqlite3`;
  `JUNOS_HELPER_ACTIVITY_LOG_PATH` overrides it. Retention: 90 days/50,000 rows.
  Never commit credentials, the activity database, or raw device pulls.
- Do not send real switch configuration changes as a development test without
  a user-authorized device operation.

## Exact next step

Finish the requested v1.7 commit/tag/push/publication and record verified outcomes
here. The user is arranging the server separately; a GitHub push does not deploy
it. After this release, follow user feedback or server setup results. Do not
implement the proposed recorder/authentication without a new request.

## Source documents and code map

- [README](../README.md), [button behavior](../BUTTON_BEHAVIOR.md),
  [changelog](../CHANGELOG.md), [continuity instructions](../AGENTS.md).
- [Server setup brief](SERVER_SETUP_BRIEF.md),
  [monitoring design](MONITORING_DESIGN.md).
- `app.py`: APIs/discovery/SSH/deployment/version; `script.js`: main UI/watch context;
  `live-watch.js`: polling/rates/graph; `live_watch.py`: parsers/watch sessions;
  `activity_log.py`: SQLite history; `index.html`/`styles.css`: layout/styles;
  `tests/`: Python/Node tests; `build.ps1`/`version_info.txt`: Windows packaging.
