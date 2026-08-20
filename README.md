# Junos Quick Change Configurator

A local Flask web app for discovering Junos switch ports and VLANs, selecting ports visually, generating `set`/`delete` commands, and applying interface changes with rollback protection.

Release history is maintained in the [changelog](CHANGELOG.md).

## Change workflows

- Select one port, a two-click contiguous range, or an arbitrary multi-selection.
- Rebuild switching configuration from discovered mode, VLAN memberships, and descriptions.
- Move exact interface configuration to ports at a positive or negative offset. Destinations are cleared first; source-only ports are cleared, disabled, and renamed using the `portNumber_siteCode_UNUSED` convention.
- Build numbered port series from a start interface and count, with an optional `##_` physical-port prefix, a description prefix/postfix, and an incrementing number. Series default to description-only commands, with an option to also apply the shared mode and VLAN configuration from the Configure tab.
- Create named VLANs with validated VLAN IDs.
- Load a live `show | compare` candidate diff before Push is enabled.
- Save hostname-based local device profiles for one-click reconnects.
- Refresh inventory on demand or automatically every 30 seconds, one minute, or five minutes.
- See unique per-switch learned MAC totals that prioritize explicit uplink descriptions, consolidate duplicate entries, and retain selected, uplink, and raw-all scopes for inspection.
- Group MAC-table rows by discovered port order by default, with ascending or descending sorting by port, MAC, manufacturer, or VLAN.
- Resolve neighbor and learned-MAC manufacturers from LLDP-MED or the bundled offline IEEE OUI database.
- Toggle **Richard View** for a three-column operational layout with status, mode, VLAN, learned-MAC, and LLDP neighbor details on each tile.
- Compare the actual negotiated link-partner rate with the configured/capable port speed in compact tile hovers and Richard View details.
- Use the two-row inventory toolbar as selection, inspection, and display actions expand without crowding the status legend.

Disabled ports remain visible and are labeled explicitly. Junos may retain a previously learned MAC or LLDP neighbor briefly, and the app shows that as retained device evidence. An administratively disabled port cannot provide a reliable live-link check; finding a passive cable with no active endpoint requires platform-specific cable diagnostics (TDR), which this app does not run automatically because it can disrupt a port.

## Setup

Create and activate a virtual environment, then install the dependencies:

```powershell
py -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
```

Copy `.env.example` to `.env` and fill in the local switch credentials. `.env` is ignored by Git. The password remains on the Flask server and is not returned to the browser; leaving the browser password field blank uses the value from `.env`.

The **Save device** action stores the discovered hostname, management address, username, and password in hostname-keyed `.env` entries. Saved-device list responses omit passwords, and Quick Connect resolves the password only on the Flask server. Because `.env` contains plaintext secrets, keep it restricted to the local workstation and never commit or share it.

Auto-refresh is off by default. Enabling it refreshes discovered interface and VLAN state while preserving the current selection and configuration workspace.

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

The result is `dist\JunosHelper.exe`. Double-clicking the packaged app starts the local server and opens the browser. Distribute a newly built executable for each upgrade; coworkers can replace their old executable in place.

Packaged builds keep their writable configuration at `%LOCALAPPDATA%\Junos Helper\.env`, so saved devices survive executable replacements. To seed a coworker's first run with the devices in this project's current `.env`, build with:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\build.ps1 -IncludeSavedDevices
```

The seed is copied to the user's local application-data folder only when that file does not already exist. Later upgrades never overwrite their saved devices. Delete or rename `%LOCALAPPDATA%\Junos Helper\.env` before launching if a fresh seed is intentionally required. `JUNOS_HELPER_ENV_PATH` can override the storage location for managed deployments.

Important: the saved-device entries contain plaintext passwords. Embedding them makes those credentials recoverable by anyone who can access the executable. Only use the seeded build with trusted coworkers over an approved secure distribution channel. The safer alternative is to distribute the normal build and provision each coworker's `.env` separately with their own switch account.

## Configuration safety

The push API accepts only `set interfaces ...` and `delete interfaces ...` lines. It performs a `commit check` followed by `commit confirmed 5`. After verifying the switch, click **Confirm committed change** within five minutes. Otherwise Junos automatically rolls the change back.

## Deferred scope

IRB and routed-VLAN workflows are intentionally deferred while the tool remains focused on Layer 2 switching changes. Future design should consider VLAN creation plus `l3-interface`, `interfaces irb unit`, addressing, routing-instance association, and validation of existing Layer 3 ownership as one coordinated workflow.

## Tests

```powershell
python -m unittest discover -s tests -v
```

## License

Released under the [MIT License](LICENSE).
