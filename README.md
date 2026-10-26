# Junos Quick Change Configurator

A local Flask web app for discovering Junos switch ports and VLANs, selecting ports visually, generating `set`/`delete` commands, and applying interface changes with rollback protection.

Release history is maintained in the [changelog](CHANGELOG.md).

The [button behavior reference](BUTTON_BEHAVIOR.md) covers staging, immediate actions, navigation, and deployment. Successful command-building actions consistently open and focus **Review & deploy**; local controls and immediate operations stay in context.

## Change workflows

- Select one port, a two-click contiguous range, or an arbitrary multi-selection.
- Preserve channelized EX4650 interface lanes (for example, `et-0/0/0:0`) as distinct discovered ports.
- Include configured physical ports in the inventory even when Junos omits them from `show interfaces terse` and `show interfaces media`; these fallback tiles are ordered by physical location and shown as unconfigured `down/down` ports with capability inferred for `fe`, `ge`, `mge` (2.5 Gbps on EX4100), `xe`, and `et` names.
- Collapse EX4400 multi-prefix names for one physical coordinate to the fastest identity (`xe` over `ge`, `et` over `xe`), while keeping EX4100 access-port and uplink-port banks in their physical grouping when their numeric coordinates overlap.
- In Multi-select mode, Shift+click adds every port from the last clicked tile through the new tile while preserving previously selected ranges.
- Rebuild switching configuration from discovered mode, VLAN memberships, and descriptions.
- Clear selected ports together with all their logical units and discovered `vlans ... interface` references, including references left by an earlier clear. For services with exactly two nonzero logical endpoints, also remove the paired endpoint's VLAN reference and logical unit while preserving the uplink's physical settings and other units. The confirmation lists paired units and services skipped because they have multiple endpoints, unit 0, or a peer unit shared with another VLAN. Selecting the uplink itself still clears its entire configuration.
- Discover existing native VLAN IDs and choose a trunk-only native VLAN from the Configure tab; selecting one includes that VLAN in generated trunk membership.
- Append any combination of port mode, VLAN membership, native VLAN, and description without carrying along an untouched automatically generated full configuration draft.
- Move exact interface configuration to ports at a positive or negative offset, including discovered logical-service bridge references. Destination descriptions can optionally replace a leading source-port number with the destination-port number. Destinations are cleared first; source-only ports are cleared, disabled, and renamed using the `portNumber_siteCode_UNUSED` convention.
- Build numbered port series from a start interface and count, with an optional `##_` physical-port prefix, a description prefix/postfix, and an incrementing number. Series numbers can be zero-padded to at least two digits and automatically expand to three digits when needed. Series default to description-only commands, with an option to also apply the shared mode and VLAN configuration from the Configure tab.
- Transform existing descriptions on any selected ports with unlimited named sections. A current pattern such as `{port}*EWT_{apt}` can become `{port}_WT_*{apt}`, preserving irregular port and apartment values while literals are added, removed, edited, or reordered; nonmatching descriptions are previewed and skipped.
- Create named VLANs with validated VLAN IDs. Newly staged VLANs remain available in pickers across queued batches and inventory refreshes. Replacement builders retain unqueued creation commands, and the picker tracks definitions in the editor and queue until deployment or removal.
- Build an IPv4 IRB gateway for a discovered VLAN with checks for existing VLAN and logical-unit ownership.
- Build paired customer/uplink Q-in-Q services with flexible Ethernet encapsulation, push/pop tag translation, double-tagged uplink units, jumbo MTU, and bridge membership.
- Move one discovered Q-in-Q logical unit and its bridge-VLAN membership to a selected destination without replacing unit 0 or moving the global IRB.
- Load a live `show | compare` candidate diff before Push is enabled.
- Queue up to eight labeled command batches for one switch and deploy the queued batches plus the current editor together. Queue contents remain in the current browser tab and clear after a successful protected push confirmation or description-only quick commit.
- Quick commit description-only queued batches plus the current editor in one click. The shortcut skips `show | compare` and the confirmation window, but still runs `commit check` and is rejected by the server if any command is not a physical-interface description set/delete.
- Automatically protect uplink candidates, trunks, aggregate members, and LLDP switch/router neighbors from quick port actions. Lock badges sit at the top-left of protected tiles, separate from the status indicators; hover for the reason. One protection button switches between **Protect selected** and **Remove manual protection**, saving choices locally per management address independently of interface descriptions. Mixed selections are protected together. Removing manual protection does not override automatic protection. Normal rollback-protected edits remain available.
- Use **Select eligible access ports** to exclude protected ports, unknown modes, and logical service ports. The port administration summary lists selected exclusions. One enable/disable button changes its label and fill color: all-disabled selections offer enable, while enabled or mixed selections offer disable. It accounts for staged commands in the queue and editor. Stage commands as usual, then use the single **Quick commit** button in Review & deploy. It automatically uses the description-only path or the eligible-task path. Quick tasks may combine descriptions, new VLAN creation with unused names/IDs, and eligible access-port enable/disable commands across the entire queue and editor. The server rereads interfaces, VLANs, learned MACs, and LLDP before committing; a conflict rejects the entire batch. These quick commits run `commit check` and commit directly without a rollback confirmation window. Access VLAN changes, interface clearing, moves, IRB, and Q-in-Q changes retain the protected workflow.
- Use **Port bounce** or **PoE bounce** in Port administration for a timed interruption on 1–48 selected physical ports. Set off time under **Options → Port actions** using a compact seconds field. It defaults to five seconds, accepts 1–30 seconds, and is remembered in this browser. Bounces run immediately after confirmation, independently of the configuration editor and queue. The server rechecks discovered interfaces, administrative state, manual/automatic protection, learned MACs, and LLDP before any bounce; PoE bounce also verifies enabled PoE on every selected port. Protected or disabled selections reject the whole request. Unprotected logical-service customer ports are supported. Each port reports whether the switch accepted its request, including partial failures or uncertain responses; verify switch status before retrying an uncertain request. These actions use Junos native timed bounce commands and do not change or commit configuration. They require platform/release support for [`request interface bounce`](https://www.juniper.net/documentation/us/en/software/junos/cli-reference/topics/ref/command/request-interface-port-bounce.html) (introduced in 23.4R1, with the PoE option in 24.2R1); unsupported switches report their CLI error without a configuration-based fallback.
- Keep selected ports visible with persistent cyan tile outlines and a collapsible floating list of selected interface names while scrolling through the workspace. The current range anchor retains its yellow dashed outline.
- Return to the most recent editing tab after queuing changes or successfully completing a quick commit or final commit confirmation.
- Save hostname-based local device profiles for one-click reconnects.
- Optionally auto-save successful new connections, with the preference retained in the browser.
- Assign several saved switches to a free-form group at once from the top-right Options panel and browse them under grouped headings in the login card's saved-device selector.
- Choose which groups appear in the login card's saved-device selector; the visibility filter is retained in the browser while group management continues to show every switch.
- Use familiar keyboard behavior: Enter submits credentials or a group assignment, Enter on a selected saved device starts Quick Connect, Escape closes dialogs, and Ctrl/Cmd+S saves the connected device.
- Refresh inventory on demand or automatically every 30 seconds, one minute, or five minutes.
- See unique per-switch learned MAC totals that prioritize explicit uplink descriptions, consolidate duplicate entries, and retain selected, uplink, and raw-all scopes for inspection.
- Group MAC-table rows by discovered port order by default, with ascending or descending sorting by port, MAC, manufacturer, or VLAN.
- Resolve neighbor and learned-MAC manufacturers from LLDP-MED or the bundled offline IEEE OUI database.
- Toggle **Richard View** for a three-column operational layout with status, mode, VLAN, learned-MAC, and LLDP neighbor details on cards that grow with wrapped content and use concise supplemental hovers.
- Compare the actual negotiated link-partner rate with the configured/capable port speed in compact tile hovers and Richard View details.
- Read active link rates directly from tile accents: amber for 100 Mbps, green for 1 Gbps, cyan for 2.5 Gbps, blue for 10 Gbps, and purple for 100 Gbps. Other or unavailable active rates use neutral slate, while down links remain red.
- Use the two-row inventory toolbar as selection, inspection, and display actions expand without crowding the expanded negotiated-rate legend.

Disabled ports remain visible and are labeled explicitly. Junos may retain a previously learned MAC or LLDP neighbor briefly, and the app shows that as retained device evidence. An administratively disabled port cannot provide a reliable live-link check; finding a passive cable with no active endpoint requires platform-specific cable diagnostics (TDR), which this app does not run automatically because it can disrupt a port.

## Setup

Create and activate a virtual environment, then install the dependencies:

```powershell
py -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
```

Copy `.env.example` to `.env` and fill in the local switch credentials. `.env` is ignored by Git. The password remains on the Flask server and is not returned to the browser; leaving the browser password field blank uses the value from `.env`.

The **Save device** action stores the discovered hostname, management address, username, password, and optional switch group in hostname-keyed `.env` entries. Use **Options** to select one or more switches and assign them to an existing or new group; leaving the group blank moves them to Ungrouped. **Auto-save new** saves a successful connection only when its hostname and address are not already present. Saved-device list responses omit passwords, and Quick Connect resolves the password only on the Flask server. Because `.env` contains plaintext secrets, keep it restricted to the local workstation and never commit or share it.

Auto-refresh defaults to one minute and refreshes discovered interface and VLAN state while preserving the current selection and configuration workspace. It can still be turned off or changed to another interval from the discovered-device card.

For a lab device that is not present in your SSH known-hosts file, set `JUNOS_ALLOW_UNKNOWN_HOST_KEY=true` to connect without first opening a separate SSH session. This automatically accepts the key for that connection. Keep it `false` for normal use and add the verified switch host key to known hosts instead.

## Run

```powershell
python app.py
```

Open <http://127.0.0.1:8000>. The app binds only to loopback and runs without Flask debug mode by default.

Keep the default loopback binding unless the host is otherwise protected. The app is designed as a trusted local administration tool and does not provide user authentication for browsers connecting to it. Only the three frontend assets are web-served; project files and `.env` are explicitly excluded.

## Windows executable

Install the build dependency once, then build the single-file executable:

```powershell
python -m pip install -r requirements-build.txt
powershell -NoProfile -ExecutionPolicy Bypass -File .\build.ps1
```

The result is `dist\JunosHelper.exe`. The executable's Windows file properties include its release version, defined in `version_info.txt`; the app also reports `appVersion` through `/api/health`. Double-clicking the packaged app starts the local server and opens the browser. Distribute a newly built executable for each upgrade; coworkers can replace their old executable in place.

The packaged app allows one Junos Helper server per Windows sign-in. Launching it again reuses the running server instead of creating another copy. Use **Stop app** in the page header to shut down the packaged server and release both PyInstaller processes; closing only the browser tab does not stop the local server. The button is hidden when running `app.py` directly, which remains under terminal/VS Code process control.

Packaged builds keep their writable configuration at `%LOCALAPPDATA%\Junos Helper\.env`, so saved devices survive executable replacements. To seed a coworker's first run with the devices in this project's current `.env`, build with:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\build.ps1 -IncludeSavedDevices
```

On first run, the seed initializes the user's local application-data file. On later seeded releases, saved-device entries embedded in a new seed revision are merged once: matching shared profiles and groups are updated, coworker-only profiles are preserved, and unrelated local settings are left unchanged. `JUNOS_HELPER_ENV_PATH` can override the storage location for managed deployments.

Important: the saved-device entries contain plaintext passwords. Embedding them makes those credentials recoverable by anyone who can access the executable. Only use the seeded build with trusted coworkers over an approved secure distribution channel. The safer alternative is to distribute the normal build and provision each coworker's `.env` separately with their own switch account.

## Configuration safety

The normal push API accepts approved physical-interface changes, IPv4 IRB addresses, VLAN IDs, VLAN-to-IRB bindings, and logical-interface bridge membership. It performs a `commit check` followed by `commit confirmed 5`. After verifying the switch, click **Confirm committed change** within five minutes. Otherwise Junos automatically rolls the change back.

**Quick commit descriptions** is intentionally narrower: every actionable line across the queue and current editor must set or delete a physical-interface description. The server independently validates that complete combined payload, runs `commit check`, and then commits immediately. It does not create a rollback confirmation window; use the normal comparison and protected push whenever the workspace includes another type of change.

The IRB workflow covers the default routing instance and IPv4 gateway addressing. Routing-instance placement, VRRP, IPv6, DHCP relay, firewall filters, and routing policy remain outside this focused builder and can require site-specific coordination.

## Tests

```powershell
python -m unittest discover -s tests -v
node --test tests\test_frontend_logic.cjs
```

## License

Released under the [MIT License](LICENSE).
