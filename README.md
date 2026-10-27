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
- Use **Custom command** for any Junos `set`/`delete` configuration path, with optional variables for selected ports and device details. Global commands run once without requiring port selection. See [custom commands](#custom-commands) for syntax and examples.
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
- Use **Live watch** to pin 1–8 physical or aggregate ports, including customer/uplink pairs, for live traffic, link state, packet rates, new errors, and optional PoE reads. Two-minute graphs stay in memory, while watched ports remain independent of configuration selection.
- Return to the most recent editing tab after queuing changes or successfully completing a quick commit or final commit confirmation.
- Save hostname-based local device profiles for one-click reconnects.
- Optionally auto-save successful new connections, with the preference retained in the browser.
- Assign several saved switches to a free-form group at once from the top-right Options panel and browse them under grouped headings in the login card's saved-device selector.
- Choose which groups appear in the login card's saved-device selector; the visibility filter is retained in the browser while group management continues to show every switch.
- Use familiar keyboard behavior: Enter submits credentials or a group assignment, Enter on a selected saved device starts Quick Connect, Escape closes dialogs, and Ctrl/Cmd+S saves the connected device.
- Refresh inventory on demand or automatically every 30 seconds, one minute, or five minutes.
- Open **Options → Device data** for a timestamped view of the latest pull for the target, or **Options → Activity log** for persistent action outcomes and errors. Activity defaults to the active device and changes/errors, with all-device and all-activity views available.
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

Keep the default loopback binding unless the host is otherwise protected. The app is designed as a trusted local administration tool and does not provide user authentication for browsers connecting to it. Only the four frontend assets are web-served; project files and `.env` are explicitly excluded.

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

## Live watch

Connect to a switch, select 1–8 physical or aggregate interfaces in the inventory, open **Live watch**, and click **Watch selected ports**. Select a customer port and its uplink together to compare them. The watched list is pinned independently of configuration selection. Starting a new watch replaces that list and starts fresh baselines; switching the target or changing credentials clears it.

Each port shows administrative/link state, the speed reported by the current interface read, receive/transmit traffic, packet rates, and separate per-direction utilization where link speed is known. Expand a row for a two-minute traffic graph, new error/drop/carrier-transition counts, observed link changes, optional PoE, and learned MAC/LLDP information. Learned identity is explicitly labeled as inventory evidence with its collection time; refresh inventory to update it.

Sampling targets five seconds by default, with two- and ten-second choices. **Check now** requests a sample immediately, **Pause/Resume** controls automatic collection, and **Reset view** renews only the app's baselines and graph. No switch counters are cleared. Rates require two comparable samples and use actual collection intervals with precise byte-counter differences. Counter resets, link changes, read failures, and long gaps create rate gaps rather than traffic spikes or invented zeroes. Each port displays its sample time and age, and stale/paused values are labeled. Throughput is per port; aggregate and member traffic are not added into a misleading switch-wide total.

Live watch reads only the watched interfaces over a reused SSH connection, with one sample request at a time and bounded session capacity. Optional PoE is cached for 20 seconds and unavailable fields remain explicit. Collection suspends while the browser tab is hidden or the app is connecting, deploying, or bouncing ports; it can continue while you navigate between workspace tabs. Closing/pausing releases known watch sessions, and abandoned idle connections expire automatically. Slow or unsupported switch commands can reduce the achieved update frequency.

Graphs, counter baselines, and sampled traffic are kept only in memory. The activity log records watch sessions and throttled read warnings, rather than every sample. Switch CLI read permissions and platform/release support determine which fields are available.

## Device data and activity history

**Options → Device data** shows raw discovery command output and command errors for the target device, labeled with its name, management address, and collection time. It is the data pull, rather than a diagnostic test. The browser retains the latest snapshot for up to ten devices during the current session. Switching targets shows that target's snapshot or a clear no-data message. Refresh the inventory to collect new data.

**Options → Activity log** opens persistent local history, newest first. It defaults to **Active device** and **Changes & errors**. Choose **All devices**, **All activity**, or **Errors & warnings**, refresh the list, or load older entries. Closing either popup returns to Options without changing the workspace tab or staged commands. Timestamps display in the browser's local time.

History records data pulls and partial reads, comparisons, protected pushes, failed commit checks, final confirmations, quick commits, port bounces, saved-device/protection actions, and browser script errors. Entries distinguish requests without a completion result, failed checks, applied changes awaiting confirmation, confirmed commits, and results that could not be verified after an SSH failure. Pushes and their final confirmations are linked. An elapsed confirmation window is labeled for verification; the app does not claim that a rollback happened. Changes made through another tool or switch CLI are outside this history, and actions before this update cannot be reconstructed.

One SQLite database at `%LOCALAPPDATA%\Junos Helper\activity.sqlite3` serves all devices for this Windows user, in both source and packaged runs. It survives browser/app restarts and executable replacement. Device filtering uses the management address, normalized without case. History is bounded to the most recent 90 days or 50,000 entries. Set `JUNOS_HELPER_ACTIVITY_LOG_PATH` to override the database location. Browser script errors that cannot reach the backend remain in memory for retry during that session.

The log stores operation outcomes, operator names, command counts, referenced interfaces, non-sensitive batch fingerprints, and sanitized errors. It does not archive raw command batches, SSH passwords, or discovery output; secret-bearing error details are omitted. Storage failures do not change an operation's result: commit responses report that history could not be saved, and the log view shows a storage warning. This is an activity record for the local administration tool, not an independently verified audit of switch state.

## Custom commands

Enter one `set` or `delete` command per line, then click **Append custom commands** to generate and stage the expanded preview in Review & deploy. Opening the review tab alone does not stage the template. Blank lines and `#` comment lines are ignored. Commands without port variables run once, even if ports are selected; commands using a port variable require a selection and repeat for each selected port. Global lines keep their position between port-command blocks.

```text
set system ntp server 192.0.2.123
set protocols rstp interface {port} disable
set interfaces {port} description "{device}_port{portNumber}_{index}"
```

| Variable | Value | Repeats per selected port? |
| --- | --- | --- |
| `{port}` | Full interface name, including any channel lane, such as `et-0/0/12:1` | Yes |
| `{portNumber}` | Unpadded physical port number, such as `12`, or the aggregate number for `ae0`/`reth0` | Yes |
| `{index}` | Position in the selected ports, starting at 1 in inventory order | Yes |
| `{device}` | Discovered device name | No |
| `{host}` | Management address from the connection field | No |

Variables can be combined. Use `{{` and `}}` for literal braces. Unknown variables and missing values stop the entire append. Command separators, pipes, shell substitutions, and control characters are rejected. The combined editor and queue have a 500-command / 64 KB deployment limit. Junos checks configuration syntax and semantics; custom commands can target global configuration as well as interfaces. Quick commit remains limited to its eligible tasks.

## Configuration safety

The normal push API accepts Junos `set`/`delete` configuration commands. **Push with rollback protection** first loads the complete editor and queue into a private candidate, runs `commit check`, and discards that candidate. Only an explicit successful check without CLI errors allows the protected push to proceed. The apply step takes an exclusive lock, reapplies the commands, and runs `commit check` and `commit confirmed 5`. Failed preflight checks send no commit request, display Junos output in Review & deploy, and preserve the editor and queue. Correct the draft, run a fresh comparison, and retry. After a successful push, verify the switch and click **Confirm committed change** within five minutes; otherwise Junos automatically rolls the change back.

**Quick commit descriptions** is intentionally narrower: every actionable line across the queue and current editor must set or delete a physical-interface description. The server independently validates that complete combined payload, runs `commit check`, and then commits immediately. It does not create a rollback confirmation window; use the normal comparison and protected push whenever the workspace includes another type of change.

The IRB workflow covers the default routing instance and IPv4 gateway addressing. Routing-instance placement, VRRP, IPv6, DHCP relay, firewall filters, and routing policy remain outside this focused builder and can require site-specific coordination.

## Tests

```powershell
python -m unittest discover -s tests -v
node --test tests\test_frontend_logic.cjs tests\test_live_watch.cjs
```

## License

Released under the [MIT License](LICENSE).
