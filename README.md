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
- Toggle **Richard View** for an intentionally enormous three-to-four-column port layout.

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
