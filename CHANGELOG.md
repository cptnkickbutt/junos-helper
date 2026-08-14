# Changelog

All notable changes to Junos Helper will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project uses versioned GitHub releases.

## [Unreleased]

Add new entries here under `Added`, `Changed`, `Fixed`, `Deprecated`, `Removed`,
or `Security`. When publishing a release, move those entries into a dated version
section and update the comparison links at the bottom of this file.

## [v1.0] - 2026-08-14

### Added

- Junos interface, VLAN, description, administrative-state, and switching-configuration discovery.
- Single, contiguous-range, and arbitrary multi-port selection workflows.
- Access and trunk configuration generation with VLAN membership management.
- Description-only edits and numbered description series with optional physical-port prefixes, postfixes, and shared switching configuration.
- Exact interface-configuration moves with destination cleanup and safe handling of vacated source ports.
- VLAN creation with VLAN ID and name validation.
- Candidate configuration previews using `show | compare`.
- Rollback-protected deployment using `commit check` and `commit confirmed 5`.
- Local saved-device profiles, quick connect, manual refresh, and configurable automatic refresh.

### Security

- Restricted generated commands to validated interface and VLAN operations.
- Enabled SSH host-key verification by default with an explicit lab-only opt-out.
- Bound the development server to loopback with debug mode disabled by default.
- Restricted web-served files to the three required frontend assets so `.env` and source files cannot be downloaded.
- Excluded credentials, virtual environments, caches, logs, coverage output, and editor metadata from Git.

[Unreleased]: https://github.com/cptnkickbutt/junos-helper/compare/v1.0...HEAD
[v1.0]: https://github.com/cptnkickbutt/junos-helper/releases/tag/v1.0
