# Ubuntu / Proxmox setup brief

Prepared 2026-10-28 for setup outside this workspace. This is a handoff, not an
executed deployment or a tested Linux installation. Replace site-specific names,
addresses, certificate locations, and administrator account details during setup.

## Copyable setup request

Set up Junos Helper as an internal web application on my new Proxmox guest:

- Ubuntu Server 24.04.3 baseline, 2 vCPU, 2 GB RAM, 32 GB disk. Apply normal Ubuntu
  updates. CT versus VM is determined by the guest actually provisioned.
- Repository: `https://github.com/cptnkickbutt/junos-helper.git`, branch `main`.
  This is a Python Flask app with Paramiko SSH access to Junos switches. Linux
  deployment has not yet been tested. Do not use the Windows EXE on this server.
- I will edit/test locally, commit, and push to GitHub. The server pulls reviewed
  updates from GitHub. It does not need GitHub write access or a copy of my local
  private SSH key. Create a dedicated server deploy key for this repository,
  register its public key in GitHub as **read-only**, and verify GitHub's SSH host
  identity before cloning. SSH clone URL:
  `git@github.com:cptnkickbutt/junos-helper.git`.
- Keep the deployment SSH account separate from the unprivileged runtime account
  `junos-helper`. The deployment account owns `/opt/junos-helper` and its Python
  virtual environment; the runtime account can read code but writes only its
  runtime data. Install Git, Python 3 with venv/pip support, Nginx, the repository's
  `requirements.txt`, and Gunicorn in that venv. Node is only needed if running
  the frontend test suite on the server.
- Create a systemd service named `junos-helper`, working in `/opt/junos-helper`,
  running Gunicorn against **`app:app`** bound to **`127.0.0.1:8000`**. Start with
  **one worker and four threads** (`gthread`), with automatic restart on failure
  and startup at boot. Current SSH watch tokens/locks are process-local; multiple
  worker processes would split their state. Do not enable debug, development
  reload, or automatic worker recycling. Configure request/graceful-stop and
  reverse-proxy timeouts to accommodate slow switch operations during the pilot.
- Put Nginx in front with an internal DNS name and HTTPS certificate. Restrict
  access to the intended management network/users; allow administrative SSH only
  where needed. Keep port 8000 private. This app currently has **no application
  user authentication/permissions**, and saved device credentials can authorize
  switch changes. Do not expose it publicly. RADIUS/LDAP and roles are future work.
- Create `/var/lib/junos-helper` owned by the runtime account and set these
  environment variables in the service **before importing the app**:
  `JUNOS_HELPER_ENV_PATH=/var/lib/junos-helper/devices.env` and
  `JUNOS_HELPER_ACTIVITY_LOG_PATH=/var/lib/junos-helper/activity.sqlite3`.
  Start the devices file from `.env.example` and fill secrets on the server.
  Use a private data directory and mode 600 for the populated devices file.
  It must be writable by the runtime account because the UI saves device profiles.
  Keep `JUNOS_DEBUG=false` and `JUNOS_ALLOW_UNKNOWN_HOST_KEY=false`.
- Give the runtime account a valid home and verified Junos switch host keys in
  its own SSH `known_hosts`. Confirm the guest can reach the intended switches
  on SSH (normally TCP 22). GitHub deploy credentials and switch credentials are
  separate. Do not put either private keys or populated profiles in Git.
- Back up persistent profiles and SQLite data using a database-consistent method;
  keep backups off the guest disk. Preserve these paths across code updates.
- Establish a manual update procedure: save the deployed commit ID and take any
  needed backup; ensure no switch commit is awaiting confirmation and no active
  operation will be interrupted; require a clean server checkout; run
  `git pull --ff-only origin main`, update venv dependencies, restart the service,
  and check `/api/health` plus systemd logs. Stop on divergence/conflicts instead
  of discarding server changes. Document rollback to the previous commit and
  dependency environment; future database migrations require a separate data
  rollback plan. Do not auto-deploy every GitHub push yet.
- Verify reboot startup, HTTPS access, health/API versions, persistent activity
  storage, and read-only discovery/live sampling. Do not test deployment by
  sending configuration changes to a real switch.
- Longer-term recordings are **not implemented yet**. The hosting foundation
  should support a future independent collector with persistent jobs/history.
  Reboot recovery of recordings is not a current feature.

## Repository state at handoff

The v1.7 update includes the tested Live watch improvements and the
design/continuity docs. See [current state](CURRENT_STATE.md) for the verified
build, commit, and publication status. A server clone only receives pushed
GitHub contents. This setup request does not itself deploy or update the server.

## References

- [GitHub deploy keys](https://docs.github.com/en/authentication/connecting-to-github-with-ssh/managing-deploy-keys)
- [Flask production deployment](https://flask.palletsprojects.com/en/stable/deploying/)
- [Flask / Gunicorn deployment](https://flask.palletsprojects.com/en/stable/deploying/gunicorn/)
- [Gunicorn settings](https://gunicorn.org/reference/settings/)
- [Monitoring design and deferred authentication](MONITORING_DESIGN.md)
