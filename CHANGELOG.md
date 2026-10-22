# Changelog

All notable changes to Junos Helper will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project uses versioned GitHub releases.

## [Unreleased]

Add new entries here under `Added`, `Changed`, `Fixed`, `Deprecated`, `Removed`,
or `Security`. When publishing a release, move those entries into a dated version
section and update the comparison links at the bottom of this file.

## [v1.4] - 2026-10-22

### Added

- Added automatic uplink protection, saved manual protected ports, lock badges with protection reasons, and selection of eligible access ports.
- Added quick commits for new VLANs and eligible access-port enable/disable commands, including mixed description batches. Server checks fresh configuration, MAC and LLDP evidence, protected ports, and VLAN collisions for the entire deployment.

### Changed

- Return to the most recent editing tab after queuing or successfully completing a commit.
- Consolidate protection, enable/disable, and quick-commit controls. Selection actions adapt their wording and fill color, including mixed selections and staged administrative changes.
- Move protected-port locks to the top-left tile corner and add persistent selected-port outlines plus a collapsible floating list of selected ports.

### Fixed

- Show IRB and Q-in-Q builder validation errors beside their action buttons; reject blank IRB units.

## [v1.3] - 2026-10-09

### Added

- Added selected-port description transforms with unlimited named sections, live before/after previews, reusable or removable captures, and safe skipping of nonmatching descriptions.
- Added a one-click description-only quick commit for the combined queue and current editor. It runs `commit check`, commits immediately without requiring `show | compare`, and is guarded by matching browser and server validation that rejects every non-description command.
- Added an eight-batch, browser-memory configuration queue so separate port workflows can share one `show | compare`, confirmed commit, and final confirmation cycle.
- Added discovery and trunk-only configuration of physical-interface `native-vlan-id`, including automatic trunk membership.
- Added multi-select focused appends for port mode, VLAN membership, native VLAN, and description.
- Added additive Shift+click range selection in Multi-select mode so multiple separate port ranges can be configured together.
- Added optional automatic zero-padding for numbered series, using at least two digits and expanding to three when the range reaches 100.
- Added an opt-in move action that replaces a source description's leading port number with the destination port number.
- Added a packaged-only **Stop app** action that shuts down the local server and allows the PyInstaller launcher to exit.
- Added packaged single-instance protection and existing-server detection so repeated launches do not create competing listeners on port 8000.

### Changed

- Active port tiles now use their negotiated link rate for the existing bold-outline and light-fill accent: amber at 100 Mbps, green at 1 Gbps, cyan at 2.5 Gbps, blue at 10 Gbps, and purple at 100 Gbps. Unknown or other active rates use neutral slate, and down links remain red.
- Richard View cards now grow with wrapped content, while their mouseover shows only supplemental description and neighbor details.

### Fixed

- Focused append actions now discard an untouched auto-generated full draft instead of silently including every Configure-tab field.

### Security

- Restricted the quick-commit endpoint to complete physical-interface description set/delete commands, with full combined-payload revalidation before opening SSH.
- Restricted packaged shutdown to loopback requests carrying a same-origin-only custom header; source-mode shutdown remains unavailable.

## [v1.2] - 2026-08-25

### Added

- Added a guarded IPv4 IRB builder that discovers existing VLAN bindings and IRB addresses before generating gateway configuration.
- Added a paired Q-in-Q builder for customer-facing push/pop translation and outer/inner-tagged uplink services.
- Added a Configure-tab logical-service move that copies an exact nonzero unit and rewrites its bridge-VLAN membership on one selected destination port.
- Added an opt-in browser-persisted checkbox for automatically saving successful connections that are not already known.
- Added persistent switch groups with grouped saved-device selection and multi-device group assignment.
- Added native Enter-key form submission, Enter-to-Quick-Connect, and Ctrl/Cmd+S profile saving.
- Added a browser-persisted group visibility filter for the login card's saved-device selector.

### Changed

- Expanded configuration validation to admit only the new IRB address, VLAN binding, and logical bridge-member command shapes.
- Moved the IRB and Q-in-Q controls into an expandable advanced section on the Configure tab.
- Updated whole-port moves to carry discovered Q-in-Q bridge references instead of leaving them attached to old logical interfaces.
- Kept saved-site selection, Quick Connect, profile saving, and auto-save on the login card while dedicating the top-right Options panel to multi-select group management.
- Changed the initial auto-refresh interval from Off to one minute.
- Changed seeded coworker builds to merge each new saved-device seed revision into existing local profiles while preserving coworker-only devices and unrelated settings.

### Fixed

- Collapsed EX4400 multi-prefix identities at each physical coordinate to the fastest tile (`xe` over `ge`, `et` over `xe`), while keeping EX4100 `mge/ge` access banks ahead of separately numbered `xe/et` uplink banks.
- Sorted the combined port inventory by physical FPC/PIC/port location across interface prefixes, and represented configuration-only ports as unconfigured `down/down` interfaces with name-derived capability, including 2.5 Gbps for EX4100 `mge` ports.
- Added physical interfaces found only in `show configuration interfaces` to the tile inventory when Junos omits them from operational interface output.
- Kept EX4650 channelized interfaces such as `et-0/0/0:0` through `et-0/0/0:3` distinct during discovery instead of collapsing them into a single displayed port.
- Batched `.env` profile changes into one process-locked write with retry and in-place fallback for transient Windows/OneDrive rename locks.

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

[Unreleased]: https://github.com/cptnkickbutt/junos-helper/compare/v1.4...HEAD
[v1.4]: https://github.com/cptnkickbutt/junos-helper/compare/v1.3...v1.4
[v1.3]: https://github.com/cptnkickbutt/junos-helper/compare/v1.2...v1.3
[v1.2]: https://github.com/cptnkickbutt/junos-helper/compare/v1.1...v1.2
[v1.1]: https://github.com/cptnkickbutt/junos-helper/releases/tag/v1.1
[v1.0]: https://github.com/cptnkickbutt/junos-helper/releases/tag/v1.0
