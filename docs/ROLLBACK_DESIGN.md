# Configuration history, known good, and rollback

Status: included in v1.9 / API 28, 2026-11-20. See current state for build and
publication verification. Earlier v1.8 / API 25 builds do not contain this feature.
No real-device history/save/restore was performed by the agent. Synthetic
verification and current limitations are recorded in [current state](CURRENT_STATE.md).

## User workflow

Open **Config history & rollback** beside **Review & deploy** after connecting.
History is switch-wide and independent of selected ports. Refresh reads current
plus up to 15 or 20 previous versions, with switch timestamps, users, and commit
comments (including commits made outside Junos Helper). Current stays at slot 0;
fewer available versions are normal. The history tab does not replace the last
configuration-builder tab as the return destination for ordinary deployments.

Compare one row or **Compare all shown with current**. Batch reads are sequential
and can stop after the in-progress comparison, retaining completed results and
individual failures. History reads do not set the deployment-busy flag or
interrupt live watch. A dedicated SSH connection and transport-closing command
deadlines bound reads; output over 2 MiB or incomplete/restricted configuration
is rejected rather than treated as a valid empty comparison.

Every displayed diff uses **Current -> selected configuration**: plus lines would
be added and minus lines removed by restoring. These are deterministic unified
text diffs of complete committed snapshots, preserving configuration hierarchy;
the counts include text/hierarchy lines and are not counts of changed objects.
Sensitive lines and complete sensitive subtrees are masked after calculating
raw differences, so secret-only changes still appear as changes without exposing
values. Configurations and diffs remain transient and are never written to the
activity database, repository, or executable.

## Known good and cross-device logging

Known good uses the switch-resident Junos rescue configuration, separate from
the rotating rollback slots. The card offers **Compare known good**, **Restore
known good...** (opens a review, without applying), and **Save current as known
good** with an optional label. Saving replaces an existing rescue backup only
after the app supplies its reviewed fingerprint and the operator confirms.
Unreadable rescue output is not treated as a missing backup safe to overwrite.

Save current always saves the active committed configuration, independently of
editor drafts. It cannot mark an arbitrary old row without first making that
version current. Restore/verify/confirm a historical version, then save it as
known good if desired. This feature stores no app-managed configuration copies;
older overwritten rescue backups cannot be recovered from activity metadata.
Existing rescue configurations are usable, with save details labeled unknown
unless Junos Helper has matching metadata.

**Known good across devices** opens **Options -> Activity log** with **All devices**
and **Known good & restores** selected. This filter shows save/restore/confirmation
events plus a durable metadata catalog for all observed switches. It includes
management address, device name, optional label, saving operator/time/revision,
configuration fingerprint, last check, and available/missing/unreadable state.
Catalog rows survive normal 90-day/50,000-entry activity cleanup. They describe
last observations, not live availability or separate off-switch backups. A new
external rescue fingerprint clears stale saved-by/label/time attribution. A read
failure preserves previous metadata but explicitly marks it unreadable.

## Review identity and restore controls

Server-signed five-minute tokens bind reviews to management address, username,
current commit identity/configuration fingerprint, and selected source identity.
Changing devices/credentials invalidates browser comparisons. Restarting the app
invalidates outstanding tokens. Rollback indexes are checked against fresh commit
history; revision IDs are used for loads when available. Current/history/source
changes require a fresh review rather than silently restoring a renumbered slot.

Restoration is a dedicated operation and does not expand the ordinary set/delete
validator. Editor commands or queued batches block restore until explicitly
cleared; generated target/SSH comments alone do not block it. No draft is combined
with a whole-configuration rollback. Both selected-history and rescue restore
show the same whole-switch confirmation and five-minute confirmed-commit flow.
The switch must remain reachable over SSH; this cannot recover a lost management
path remotely.

The implementation uses a persistent **private candidate**, instead of the
exclusive/shared-candidate sequence originally proposed. This preserves other
users' uncommitted shared configuration. It resets only its own private candidate,
loads the exact selected revision/rescue, verifies the complete candidate against
the reviewed fingerprint, checks the active baseline again, then sends commit
check. Only explicit successful stage responses permit the next command. Another
baseline/pending-state check precedes commit confirmed 5. The private candidate is
never updated or merged after concurrent active changes. A failed stage sends no
later commit, and cleanup discards only this private candidate. Native private
commit conflict behavior still requires validation on supported target platforms.

Device-side pending confirmed commits block save/restore validation. This check
is verified with the live current header from operational `show system commit`,
in addition to reading XML history metadata. False/zero XML flags, rollback
indexes, older confirmed commits, and user comments cannot establish pending
state. History/status identity mismatches require a refresh. This addresses
synthetic false-positive cases behind the reported always-pending warning; the
specific switch symptom has not been reproduced or verified against hardware.
This matters because Junos commit check can confirm a pending commit. Local app
write requests are serialized per management address across save/restore, normal
pushes/quick commits, confirmations, and bounces. This process-local guard does
not coordinate other app instances, alternate addresses, or external CLI users;
operators still need to coordinate concurrent configuration work.

After an acknowledged restore, the app verifies active content and pending commit
identity before issuing a confirmation token. Final confirmation stays bound to
that exact applied commit and original target, even if the selected profile
changes. It runs in an isolated candidate, never reapplies old commands, and
requires the matching pending state. Lost responses remain unverified; timers
alone never prove automatic recovery. Apply/confirmation refresh inventory;
history must be refreshed after commits before another restore.

## Implementation and verification

- `config_history.py`: history/XML and legacy text parsing, normalized fingerprints,
  redacted diffs, signed review tokens, bounded operational reads, persistent
  candidate CLI, save/restore/confirmation sequencing.
- `config-history.js`: history controller and DOM UI, sequential comparisons,
  cancellation, context isolation, draft/pending/expiry guards and write controls.
- `app.py`: API routes, per-device write guard, metadata/activity integration,
  and public asset route. `activity_log.py`: durable metadata table and filter.
- `script.js`: tab integration, cross-device catalog, and pinned restore
  confirmation. `build.ps1`: includes the new frontend asset when later built.

Synthetic tests cover history depth/metadata/fallback, redaction/diff direction,
missing/unreadable rescue, incomplete output, source/baseline changes, signed
review binding/expiry, load/show/check failures without commit, candidate cleanup,
pending state, exact final confirmation, catalog retention/provenance, transport
framing/limits, UI cancellation/stale replies, safe rendering, and draft handling.
These tests do not establish real EX/Junos output compatibility or recovery.
Native visual QA could not be completed because the helper returned a capture
from a different window than the selected browser; the synthetic preview was
stopped. No executable build/release is implied by source verification.

## Official references

- [Saved versions and commit history](https://www.juniper.net/documentation/us/en/software/junos/cli-reference/topics/ref/command/show-system-rollback.html)
- [Stable revision identifiers](https://www.juniper.net/documentation/us/en/software/junos/cli/topics/topic-map/junos-configuration-managing.html)
- [Private candidate concurrency](https://www.juniper.net/documentation/us/en/software/junos/cli/topics/topic-map/configure-command.html)
- [Rescue save/read semantics](https://www.juniper.net/documentation/us/en/software/junos/netconf/topics/task/netconf-requesting-rescue-configuration.html)
- [Commit check and confirmation](https://www.juniper.net/documentation/us/en/software/junos/cli-reference/topics/ref/command/commit.html)
