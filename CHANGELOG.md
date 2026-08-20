# Changelog

All notable changes to Junos Helper will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project uses versioned GitHub releases.

## [Unreleased]

Add new entries here under `Added`, `Changed`, `Fixed`, `Deprecated`, `Removed`,
or `Security`. When publishing a release, move those entries into a dated version
section and update the comparison links at the bottom of this file.

## [v1.1] - 2026-08-20

### Added

- Learned MAC and LLDP neighbor details in port hovers and selected-port summaries.
- An amber disabled-port status dot, compact mouseover legend, and cable-check guidance when live link state cannot be verified.

### Changed

- Replaced long learned-MAC lists in port hovers with a count and a selected-port MAC viewer.
- Added selected, all-learned, and multi-MAC scopes plus MAC/interface search and VLAN filtering to the MAC viewer.
- Expanded Richard View tiles with port status, mode, VLAN, MAC count, and LLDP neighbor details in a three-column layout.
- Added a default per-switch MAC scope that excludes auditable uplink candidates while preserving raw and uplink-only views.
- Added offline manufacturer lookup for learned MACs and LLDP neighbors, shown in port popups, Richard View, and the MAC table.
- Reworked uplink inference to prioritize descriptions and duplicate-port evidence, keeping ordinary two-MAC ports local and using dominant counts only as a corroborated fallback.
- Consolidated the MAC viewer into one row per unique address with visible interfaces so its displayed rows always match the reported count.
- Grouped the MAC table by discovered port order by default and added bidirectional sorting by port, MAC address, manufacturer, and VLAN.
- Rebalanced the inventory toolbar into intentional selection/legend and full-width action rows, with subtle link-state tinting on port tiles.
- Increased the link-state tile tint and added Junos-reported physical link rates to port popups and Richard View.
- Corrected link-rate reporting to prefer negotiated `Link partner Speed`, while showing generic configured/capable speed separately.
- Normalized equivalent link rates to the same readable units and constrained port popups to the visible device panel.

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

[Unreleased]: https://github.com/cptnkickbutt/junos-helper/compare/v1.1...HEAD
[v1.1]: https://github.com/cptnkickbutt/junos-helper/releases/tag/v1.1
[v1.0]: https://github.com/cptnkickbutt/junos-helper/releases/tag/v1.0
