# Button behavior

Command actions open and focus **Review & deploy** after successfully building or appending commands. Invalid input, canceled confirmations, and blocked edits keep the current tab and preview. Automatically updating a draft while selecting ports or editing fields does not change tabs.

| Buttons | Effect | Navigation |
| --- | --- | --- |
| Regenerate full config; Append selected fields; Append VLAN removal | Stage commands for selected ports. Full regeneration requires at least one selected port. | Open Review & deploy. |
| Enable selected / Disable selected; Clear selected configuration | Stage administrative commands. Clear first confirms the selected ports and detected paired units. | Open Review & deploy. |
| Append IRB configuration; Append Q-in-Q configuration; Build logical-unit move | Validate and stage service commands. | Open Review & deploy. |
| Build move commands; Build series configuration; Build selected description changes | Validate and build commands for moving or renaming ports. | Open Review & deploy. |
| Add VLAN command | Stage VLAN creation and add the VLAN to the local picker. | Open Review & deploy. |
| Append custom commands | Stage any `set`/`delete` configuration commands. Lines with port variables repeat per selected port; global lines run once without a selection. Invalid templates leave staged work unchanged. | Open Review & deploy. |
| Port bounce (teal); PoE bounce (purple) | Run an immediate timed action after confirmation and fresh server checks. Configuration in the editor and queue is preserved. | Stay on the current tab; show per-port results in Port administration. |
| Protect selected / Remove manual protection | Save protection choices for the current switch. | Stay on the current tab; update tile locks and protection summary. |
| Select all; Clear selection; Select eligible access ports; individual port tiles | Change the selected ports and update local draft/selection details. | Stay on the current tab. |
| Connect & pull data; Quick connect; Refresh now | Load switch identity, configuration, and inventory. | Stay on the current tab. |
| Save device | Save the connected device's local profile. | Stay on the current tab. |
| View MACs; MAC sort-direction arrow; Close learned MAC addresses | Open, sort, or close the learned-MAC dialog. | Preserve the underlying workspace tab. |
| Live watch: Watch selected ports | Pin 1–8 selected physical/aggregate ports and start read-only sampling with new baselines. Does not stage commands or change the selection. | Stay on Live watch. It does not replace the last editing tab as the queue/commit return destination. |
| Live watch: Pause / Resume; Check now; Reset view | Control collection, request a one-time sample, or renew local graph/error baselines. Switch counters are never cleared. | Stay on Live watch. |
| Live watch: Refresh interval; Collect PoE; each port row | Adjust polling, optionally collect power data at 20-second intervals, or expand details. | Stay on Live watch. Watched ports remain pinned while other workspace tabs are used; collection suspends during switch actions or while the browser tab is hidden. |
| Richard View | Toggle the inventory layout. | Stay on the current tab. |
| Configure; Move config; Series/Descriptions; VLANs; Custom command; Review & deploy | Select the requested workspace tab. | Open the selected tab. Editing tabs become the return destination for queue/deployment completion. |
| Queue current batch | Save the current editor as a queued batch and clear the editor. | Return to the most recent editing tab on success. Errors stay on Review & deploy. |
| Clear queue; each queued batch's Remove button | Remove queued work, invalidate the device comparison, and preserve the current editor. Clear queue asks for confirmation. | Stay on Review & deploy. |
| Run show \| compare | Load the candidate diff without committing. | Stay on Review & deploy. |
| Push with rollback protection | Run a separate private-candidate commit check before sending the protected commit. Failed checks discard that candidate and preserve the editor and queue for correction and a fresh comparison. Successful pushes use a confirmed commit. | Stay on Review & deploy; show failed-check details or await final confirmation. |
| Quick commit; Confirm committed change | Complete the applicable commit and clear successfully deployed workspace batches. | Return to the most recent editing tab on success. Errors stay on Review & deploy. |
| Options; Close options | Open or close preferences and saved-site management. | Preserve the underlying workspace tab. |
| Options: Device data; Activity log | Open the target's latest timestamped discovery snapshot or persistent operation history. History defaults to the active device and changes/errors; all-device, all-activity, and warning/error filters are available. | Open a popup. Closing it or pressing Escape returns to Options and restores focus. Staged work and the workspace tab are preserved. |
| Activity log: Refresh log; Load older entries; Device / Show filters | Read retained local history. Viewing the log does not contact the switch or stage commands. | Stay in the log popup. |
| Options: Show all / Clear visible groups; Select all / Clear switch selections; Apply group | Change saved-device visibility, select profiles, or save a group assignment. | Stay in Options; update its lists and status messages. |
| Stop app | Confirm and shut down the packaged local app. | Report shutdown in place. |

Command builders ignore activation while deployment is in progress or a commit is awaiting confirmation. Bounces retain their separate immediate-action confirmation. Changing saved profiles, preferences, protection, inventory selection, or display options does not stage or deploy switch configuration.
