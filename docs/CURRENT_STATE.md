# Current project state

Read this file first in a new session. Replace stale facts instead of appending
history; detailed usage and procedures live in the linked references.

Last reviewed: 2026-11-20

## Current focus

The requested full push and EXE update are complete. **v1.9 / API 28** contains
configuration history/known-good recovery, locked-port bounce, dynamic commit
comments, checked-list VLAN membership, grouped QinQ customer-port rebuilds,
and the live-header pending-state fix. The standard credential-free EXE was
built, verified, committed, tagged, pushed, and published. Uploaded size/digest
and remote main/tag were verified. This final publication-handoff update is
documentation only; it does not change the verified application build.
No real-switch reads/writes were performed. Hardware restore/recovery and the
reported always-pending switch symptom remain unverified; browser visual QA
also remains unverified. Existing field order (Native VLAN before VLAN
membership) is preserved. Deferred monitoring/server/authentication work is
outside this request.

## Release status

- Branch: `main`; remote: `https://github.com/cptnkickbutt/junos-helper.git`.
- Latest published release: **v1.9**, 2026-11-20, release commit `5a99dee`
  (`5a99dee0cb293e5225e8dea765caa1b6aac8ff9d`). Annotated tag `v1.9` points
  to that commit and was pushed with main. A documentation-only publication
  handoff commit follows the release tag on main.
- App `1.9`, API **28**, Windows file/product version `1.9.0.0`. Backend and
  browser require the same API. Restart the app and refresh the browser together.
- Standard build: `dist/JunosHelper.exe`; distribution copy:
  `dist/JunosHelper-v1.9.exe` (20,314,641 bytes). No saved credentials embedded.
- [Release and download](https://github.com/cptnkickbutt/junos-helper/releases/tag/v1.9).
  Verified latest, non-draft, non-prerelease; EXE asset is uploaded. GitHub's
  asset SHA-256 matches the local EXE:
  `1d537c534ef3b3cb1762eae2ed0829dd3c38db84d2b7f20a7669a9d24835a6e3`.
- Coworker/seeded EXEs remain separate ignored artifacts and were not rebuilt.

## Implemented behavior

- Config history & rollback sits beside Review & deploy. Read current plus
  15/20 previous versions with commit metadata; compare individually or in a
  cancellable sequential batch. Diffs are Current -> selected, with raw change
  counts and masked sensitive lines/subtrees/multiline values. Snapshots/diffs
  are transient. Bounded dedicated SSH reads preserve live watch and drafts.
- Known good is the device rescue configuration. Save current with an optional
  label, explicitly replace an existing reviewed rescue, compare, or open a
  protected restore preview. Historical versions must first be restored and
  confirmed before saving as known good. There are no app-managed config copies.
- Known good across devices opens Activity log -> All devices / Known good &
  restores. Events and a durable last-observed metadata catalog include device,
  label, save time/operator/revision, fingerprint, and last check/state. Catalog
  survives event retention. External rescue changes clear stale attribution;
  unreadable observations retain prior metadata with an explicit unavailable
  state. Metadata is not a live check or separate backup.
- Whole-config restores require a signed five-minute, device/user/source/base
  review. Actual editor/queue work, stale identities, unreadable/incomplete
  snapshots, and pending switch confirmations block restoration. Generated
  target comments alone do not block. A persistent private candidate resets
  only its own work, verifies the exact loaded snapshot, checks each response
  and current state, then uses commit check and commit confirmed 5. It never
  updates/merges after a concurrent change. Final confirmation pins the exact
  applied pending identity and original device/credentials. Local app writes
  are serialized per management address; external writers still need operator
  coordination. See [implementation notes](ROLLBACK_DESIGN.md).

- Port bounce and PoE bounce ignore manual/automatic port protection. The browser
  confirmation lists protected selections and warns about uplink/management
  interruption; locks remain enabled. Fresh backend checks still require
  discovered, administratively enabled physical ports and enabled PoE for power
  bounce. Bounce no longer requires MAC/LLDP reads. Quick configuration commits
  retain their protection checks. No native bounce command/fallback changes.
- Commit comments summarize submitted set/delete types, enable/disable, ports,
  VLANs, native/tag IDs, and command totals within 240 characters. Target/type
  overflow is indicated. No free-text descriptions or secret values are copied.
  Protected pushes and both quick endpoints generate the summary server-side;
  browser confirmation sends the frozen combined draft only for summary creation
  and never reapplies it. Missing/invalid optional confirmation metadata retains
  the generic confirmation comment. Successful comments are returned as
  `commitComment` and stored in activity details. These describe submitted intent,
  not a verified before/after diff; no-op commands still count.
- QinQ discovery reads both explicit interface statements and switch-resolved
  inheritance. Keep editable `setLines` separate from `effectiveSetLines`;
  expose groups, units/tags, physical encapsulation/MTU, and resolution status.
  Tile hovers/Richard View show inherited native VLANs, named regular VLAN units,
  and separate QinQ customer/outer tags. Do not infer a VLAN tag from a unit number.
- Configure VLAN membership means the final checked unit 0 list for full
  regeneration and Stage selected fields. Clear existing members before setting
  the desired list, including when inventory has none but earlier drafts/queue
  added them. Empty lists stage deletion. Unchecking the native VLAN clears its
  picker; focused membership edits clear discovered/staged native settings if
  that VLAN is no longer retained. Native-only None can also stage deletion.
- Group QinQ rebuilds the target customer after confirmation. Remove all its
  discovered VLAN-unit references before deleting its interface configuration;
  copy the selected source's explicit overrides/group attachments and all source
  VLAN-unit memberships, preserving the service unit and shared uplink/group.
  Only Configure Description is carried over. Ignore automatic Configure drafts;
  replace manual target statements, preserve unrelated manual work, and retain
  queues. Queued target edits and staged source/group/uplink/layout changes block
  rebuilding. Exact interface boundaries avoid touching similarly named ports.
  Existing configured ports are supported; unresolved/unattached inherited
  settings, tag collisions/ranges/overlap and incompatible templates remain
  guarded. The standalone pair path remains append-based and now includes the
  Configure customer description. Group-backed single-unit moves stay blocked.

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

## Configuration history implementation notes

[Rollback notes](ROLLBACK_DESIGN.md) now describe the delivered source behavior,
API/UI modules, official references, and remaining lab requirements. Implementation
uses private candidate isolation in place of the originally proposed exclusive
shared candidate, to preserve others' staged configuration. Comparisons use
complete committed snapshots and deterministic unified text diffs, consistently
in restore direction. Native private commit conflict handling and actual CLI
framing/cleanup/confirmation must still be validated on supported switches.
Junos commit check can confirm a pending commit: browsing uses operational reads
only, while save/restore check live pending state. History now also reads plain
show system commit and verifies that its current timestamp/user/client agree
with XML history. Only that current header establishes active pending status;
XML rollback metadata and historical/user comments cannot falsely block restore. No real-switch
history read, rescue replacement, or restore was used as a development test.

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

Completed in the 2026-11-20 v1.9 build/release session:

- **154 Python + 87 Node tests passed (241 total)** after the app/version bump,
  plus main/history JavaScript syntax checks and git diff --check.
- Standard PyInstaller build passed using a workspace-local cache. Build/dist
  paths were verified inside the workspace without reparse points before cleanup.
- Archive verification found byte-identical current HTML/CSS/JS assets, required
  config_history/live_watch/activity_log/itsdangerous modules and vendor database,
  with no .env or seed.env. No saved profiles were embedded.
- EXE file/product versions verified as 1.9.0.0. The EXE started on an isolated
  loopback port with empty profiles and a workspace-local activity path;
  health reported v1.9/API 28/packaged, all five served assets matched source,
  and authorized local shutdown exited cleanly. Distribution copy/hash recorded
  above. No actual device sampling or configuration was part of the smoke test.
- Release commit/tag were pushed and GitHub publication verified as latest,
  non-draft and non-prerelease. Uploaded asset state/size/SHA-256 and remote
  main/annotated-tag target match the verified local release. The final handoff
  update is documentation only, not a rebuilt EXE. Earlier visual/helper and
  hardware limits below remain in effect.


Completed in the latest 2026-11-20 Configure/QinQ/pending-state fix session:

- **154 Python + 87 Node tests passed (241 total)** across all existing suites.
  New coverage verifies checked-list removals/empty lists, native cleanup from
  inventory/older queue commands, later membership overrides, automatic-draft
  independence, occupied QinQ targets, exact VLAN-reference cleanup without peer
  changes, Configure description escaping, manual/queue preservation, canceled
  rebuilds, and active-header status versus false XML/old/user comment hints.
- Main/history JavaScript syntax checks and git diff --check passed. No new
  browser visual QA, source-server startup, device read/write, EXE build,
  packaging check, commit, push, tag, or release in this latest fix session.
- Earlier in this source session, history implementation passed 152 Python +
  79 Node tests (231 total), and all five frontend assets matched source through
  Flask test-client routes with unique HTML IDs. Those asset checks were not
  repeated after the latest Configure/QinQ UI copy changes.
- Earlier native visual QA failed because the helper captured a different
  window than the selected Opera target after an address-field failure. No
  reliable visual validation is claimed. Its synthetic fixture server on 8768
  was stopped. Ignored .audit-cache/history-preview contains synthetic fixtures.
- The reported always-pending hardware symptom has not been reproduced from
  an authorized device read, and a real protected restore remains unverified.
  Existing package/hardware evidence below is from earlier sessions, not this
  new source. No Linux deployment was performed.

Completed in the 2026-11-16 QinQ source/release session:

- **119 Python + 66 Node tests passed (185 total)**, plus `git diff --check`.
  New synthetic fixtures cover resolved/failed inheritance, raw/effective
  separation, unit/tag distinctions, shared-uplink builder commands, template
  controls, collisions/ranges, occupied ports, and staged conflicts.
- Standard PyInstaller build passed with workspace-local cache. Archive checks
  confirmed current HTML/CSS/JS assets, runtime modules and vendor database,
  with no `.env` or `seed.env` included.
- EXE file/product versions are `1.8.0.0`. The new EXE started on an isolated
  loopback port with empty profiles and a workspace-local activity path.
  `/api/health` reported v1.8/API 25/packaged; all four served assets matched
  source, and authorized local shutdown exited cleanly.
- GitHub publication and remote main/tag were verified. The uploaded EXE size
  and SHA-256 match the local build. The final publication-handoff update is
  documentation only; it does not change the verified application build.
- No hardware reads/writes this session.
- Visual browser QA was blocked: browser host unavailable, and native computer
  use stopped because it could not verify the browser URL. No visual validation
  is claimed. Ignored `.audit-cache/qinq-preview/` contains a synthetic local
  preview generator/assets only; its temporary HTTP server was stopped.

Earlier 2026-11-09 release-session results (not rerun as packaging checks):

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
- `git diff --check` and staged whitespace checks passed. Release and asset
  publication were verified through GitHub CLI; uploaded size/digest match local.

No real-switch sampling/configuration or Linux deployment has been tested in
these workspace sessions. The ignored `.audit-cache/live-preview/` fixture is
also synthetic and is not hardware evidence.

## Local workflow and data

- Source: `.\.venv\Scripts\python.exe app.py` (normally localhost:8000).
- Checks: `.\.venv\Scripts\python.exe -m unittest discover -s tests -q`;
  `node --test tests/test_frontend_logic.cjs tests/test_live_watch.cjs tests/test_config_history.cjs`;
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

Use the published v1.9 EXE. Stop the old packaged app using Stop app (or stop a
source backend in its terminal), launch the replacement, refresh the browser,
and reconnect. Confirm app 1.9/API 28 before checking final-list VLAN staging,
grouped QinQ customer-port rebuild previews, history comparisons, and known-good
metadata. The app must not keep reusing an older running backend.

Refresh history to recheck the reported always-pending warning. Its cause/fix
has synthetic coverage, but the specific switch behavior remains unverified.
Actual rescue saves/restores, candidate concurrency/cleanup, and confirmed
recovery need a separately authorized lab operation. A GitHub push does not
deploy the separately planned server. Do not implement deferred recorder,
authentication, or server work without a new request.

## Source documents and code map

- [README](../README.md), [button behavior](../BUTTON_BEHAVIOR.md),
  [changelog](../CHANGELOG.md), [continuity instructions](../AGENTS.md).
- [Server setup brief](SERVER_SETUP_BRIEF.md),
  [monitoring design](MONITORING_DESIGN.md), [rollback design](ROLLBACK_DESIGN.md).
- `config_history.py` / `config-history.js`: configuration history, redacted diffs, rescue and restore.
- `app.py`: APIs/discovery/SSH/deployment/version; `script.js`: main UI/watch context;
  `live-watch.js`: polling/rates/graph; `live_watch.py`: parsers/watch sessions;
  `activity_log.py`: SQLite history; `index.html`/`styles.css`: layout/styles;
  `tests/`: Python/Node tests; `build.ps1`/`version_info.txt`: Windows packaging.
