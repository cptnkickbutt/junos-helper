const state = {
  ports: [],
  selected: new Set(),
  lastSelected: null,
  mode: "single",
  pendingConfirmation: false,
  pendingTarget: null,
  pendingActivityId: null,
  deviceDataSnapshots: new Map(),
  activityEvents: [],
  activityBefore: null,
  activityLoadId: 0,
  returnToOptionsButton: null,
  browserErrors: [],
  browserErrorsFlushing: false,
  vlans: [],
  irbUnits: [],
  bridgeServices: [],
  configManual: false,
  lastEditingTab: "configure",
  manualProtectedPorts: [],
  discoveredVlans: [],
  protectionHost: null,
  protectionSaving: false,
  confirmationDeadline: null,
  confirmationTimer: null,
  modeKeyword: "interface-mode",
  lastPreviewConfig: null,
  configQueue: [],
  nextQueueId: 1,
  queueTargetHost: null,
  savedDevices: [],
  savedDeviceId: null,
  visibleSavedDeviceGroups: null,
  connectionInProgress: false,
  deploymentInProgress: false,
  bounceInProgress: false,
  refreshTimer: null,
  richardView: false
};
const REQUIRED_API_VERSION = 24;
const AUTO_SAVE_STORAGE_KEY = "junosHelper.autoSaveConnections";
const BOUNCE_INTERVAL_STORAGE_KEY = "junosHelper.bounceInterval";
const VISIBLE_GROUPS_STORAGE_KEY = "junosHelper.visibleSavedDeviceGroups";
const MAX_CONFIG_QUEUE_BATCHES = 8;
const MAX_DEPLOYMENT_CONFIG_CHARS = 64 * 1024;

const hostInput = document.getElementById("host");
const usernameInput = document.getElementById("username");
const passwordInput = document.getElementById("password");
const deviceNameInput = document.getElementById("deviceName");
const selectionModeInput = document.getElementById("selectionMode");
const shiftOffsetInput = document.getElementById("shiftOffset");
const portModeInput = document.getElementById("portMode");
const nativeVlanInput = document.getElementById("nativeVlan");
const appendModeFieldInput = document.getElementById("appendModeField");
const appendVlanFieldInput = document.getElementById("appendVlanField");
const appendNativeVlanFieldInput = document.getElementById("appendNativeVlanField");
const appendDescriptionFieldInput = document.getElementById("appendDescriptionField");
const appendSelectedFieldsBtn = document.getElementById("appendSelectedFieldsBtn");
const vlanMembershipInput = document.getElementById("vlanMembership");
const descriptionInput = document.getElementById("description");
const selectionSummary = document.getElementById("selectionSummary");
const selectionSummaryBox = document.getElementById("selectionSummaryBox");
const configOutput = document.getElementById("configOutput");
const connectionHint = document.getElementById("connectionHint");
const portGrid = document.getElementById("portGrid");
const connectionStatus = document.getElementById("connectionStatus");
const deviceMetadata = document.getElementById("deviceMetadata");
const deviceDataDialog = document.getElementById("deviceDataDialog");
const deviceDataSummary = document.getElementById("deviceDataSummary");
const deviceDataOutput = document.getElementById("deviceDataOutput");
const activityLogDialog = document.getElementById("activityLogDialog");
const activityLogScope = document.getElementById("activityLogScope");
const activityLogView = document.getElementById("activityLogView");
const activityLogSummary = document.getElementById("activityLogSummary");
const activityLogList = document.getElementById("activityLogList");
const refreshActivityLogBtn = document.getElementById("refreshActivityLogBtn");
const olderActivityLogBtn = document.getElementById("olderActivityLogBtn");
const confirmBtn = document.getElementById("confirmBtn");
const connectBtn = document.getElementById("connectBtn");
const savedDeviceInput = document.getElementById("savedDevice");
const quickConnectBtn = document.getElementById("quickConnectBtn");
const saveDeviceBtn = document.getElementById("saveDeviceBtn");
const savedDeviceGroups = document.getElementById("savedDeviceGroups");
const connectionForm = document.getElementById("connectionForm");
const groupAssignmentForm = document.getElementById("groupAssignmentForm");
const groupAssignmentInput = document.getElementById("groupAssignment");
const groupDeviceList = document.getElementById("groupDeviceList");
const groupManagementStatus = document.getElementById("groupManagementStatus");
const visibleGroupList = document.getElementById("visibleGroupList");
const visibleGroupStatus = document.getElementById("visibleGroupStatus");
const autoSaveConnectionsInput = document.getElementById("autoSaveConnections");
const stopAppBtn = document.getElementById("stopAppBtn");
const optionsBtn = document.getElementById("optionsBtn");
const optionsDialog = document.getElementById("optionsDialog");
const refreshIntervalInput = document.getElementById("refreshInterval");
const refreshNowBtn = document.getElementById("refreshNowBtn");
const lastRefresh = document.getElementById("lastRefresh");
const richardViewBtn = document.getElementById("richardViewBtn");
const viewMacsBtn = document.getElementById("viewMacsBtn");
const macViewScopeInput = document.getElementById("macViewScope");
const learnedMacDialog = document.getElementById("learnedMacDialog");
const learnedMacDialogSummary = document.getElementById("learnedMacDialogSummary");
const learnedMacDialogContent = document.getElementById("learnedMacDialogContent");
const learnedMacSearchInput = document.getElementById("learnedMacSearch");
const learnedMacVlanFilter = document.getElementById("learnedMacVlanFilter");
const learnedMacSortInput = document.getElementById("learnedMacSort");
const learnedMacSortDirectionBtn = document.getElementById("learnedMacSortDirection");
const pushBtn = document.getElementById("pushBtn");
const quickCommitBtn = document.getElementById("quickCommitBtn");
const commitTimer = document.getElementById("commitTimer");
const deploymentHint = document.getElementById("deploymentHint");
const intendedChangeSummary = document.getElementById("intendedChangeSummary");
const moveSummary = document.getElementById("moveSummary");
const moveUpdateDescriptionNumberInput = document.getElementById("moveUpdateDescriptionNumber");
const seriesConfigurationScopeInput = document.getElementById("seriesConfigurationScope");
const seriesStartPort = document.getElementById("seriesStartPort");
const seriesCountInput = document.getElementById("seriesCount");
const seriesStartNumberInput = document.getElementById("seriesStartNumber");
const seriesDescriptionInput = document.getElementById("seriesDescription");
const seriesPostfixInput = document.getElementById("seriesPostfix");
const seriesIncludePortNumberInput = document.getElementById("seriesIncludePortNumber");
const seriesPadNumbersInput = document.getElementById("seriesPadNumbers");
const seriesDescriptionPreview = document.getElementById("seriesDescriptionPreview");
const descriptionTransformSourceInput = document.getElementById("descriptionTransformSource");
const descriptionTransformTargetInput = document.getElementById("descriptionTransformTarget");
const descriptionTransformPreview = document.getElementById("descriptionTransformPreview");
const buildDescriptionTransformBtn = document.getElementById("buildDescriptionTransformBtn");
const newVlanNameInput = document.getElementById("newVlanName");
const newVlanIdInput = document.getElementById("newVlanId");
const customCommandTemplateInput = document.getElementById("customCommandTemplate");
const customCommandSummary = document.getElementById("customCommandSummary");
const customCommandPreview = document.getElementById("customCommandPreview");
const irbVlanInput = document.getElementById("irbVlan");
const irbUnitInput = document.getElementById("irbUnit");
const irbAddressInput = document.getElementById("irbAddress");
const irbSummary = document.getElementById("irbSummary");
const qinqCustomerPortInput = document.getElementById("qinqCustomerPort");
const qinqUplinkPortInput = document.getElementById("qinqUplinkPort");
const qinqServiceNameInput = document.getElementById("qinqServiceName");
const qinqOuterTagInput = document.getElementById("qinqOuterTag");
const qinqInnerTagInput = document.getElementById("qinqInnerTag");
const qinqMtuInput = document.getElementById("qinqMtu");
const qinqSummary = document.getElementById("qinqSummary");
const logicalServiceSourceInput = document.getElementById("logicalServiceSource");
const logicalServiceMoveSummary = document.getElementById("logicalServiceMoveSummary");
const previewBtn = document.getElementById("previewBtn");
const previewState = document.getElementById("previewState");
const compareOutput = document.getElementById("compareOutput");
const configQueueLabelInput = document.getElementById("configQueueLabel");
const queueCurrentConfigBtn = document.getElementById("queueCurrentConfigBtn");
const clearConfigQueueBtn = document.getElementById("clearConfigQueueBtn");
const configQueueSummary = document.getElementById("configQueueSummary");
const configQueueList = document.getElementById("configQueueList");
const selectionModeHint = document.getElementById("selectionModeHint");
const tabButtons = Array.from(document.querySelectorAll(".tab-button"));
const tabPanels = Array.from(document.querySelectorAll(".tab-panel"));

function activateWorkspaceTab(tabName, focus = false) {
  if (tabName !== "review" && tabName !== "watch" && tabButtons.some((button) => button.dataset.tab === tabName)) {
    state.lastEditingTab = tabName;
  }
  tabButtons.forEach((button) => {
    const active = button.dataset.tab === tabName;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", String(active));
    if (active && focus) button.focus();
  });
  tabPanels.forEach((panel) => {
    const active = panel.dataset.panel === tabName;
    panel.classList.toggle("active", active);
    panel.hidden = !active;
  });
}

function updateSelectionModeHint() {
  const messages = {
    single: "Single mode keeps one port selected at a time.",
    range: "Range mode uses two clicks to select every port between them.",
    multi: "Multi-select toggles individual ports; Shift+click adds a range from the last clicked port."
  };
  selectionModeHint.textContent = messages[selectionModeInput.value] || "";
}

function isDescriptionOnlyDeployment(config) {
  const commands = config.split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));
  const descriptionCommand = /^(set|delete) interfaces ((?:(?:ge|xe|et|fe|mge)-\d+\/\d+\/\d+(?:\/\d+)?(?::\d+)?|(?:ae|reth)\d+)) description(?:\s+(.+))?$/i;
  return commands.length > 0 && commands.every((line) => {
    const match = line.match(descriptionCommand);
    if (!match) return false;
    return match[1].toLowerCase() === "set" ? !!match[3] : !match[3];
  });
}

function updatePushAvailability() {
  const deploymentConfig = combinedDeploymentConfig();
  pushBtn.disabled = state.pendingConfirmation
    || state.deploymentInProgress
    || !deploymentConfig
    || state.lastPreviewConfig !== deploymentConfig;
  previewBtn.disabled = state.pendingConfirmation || state.deploymentInProgress || !deploymentConfig;
  const quickError = isDescriptionOnlyDeployment(deploymentConfig) ? "" : quickTaskValidationError(deploymentConfig);
  quickCommitBtn.disabled = state.pendingConfirmation || state.deploymentInProgress
    || state.connectionInProgress || state.protectionSaving || !queueMatchesCurrentTarget() || !!quickError;
  quickCommitBtn.title = quickError || "Commit all queued and current eligible changes after commit check, without rollback confirmation.";
  document.getElementById("quickTaskSummary").textContent = quickError || "All queued and current commands qualify for quick commit. Fresh switch checks run before committing.";
  updateProtectionSummary();
  window.liveWatch?.onContextChange();
}

function invalidatePreview() {
  state.lastPreviewConfig = null;
  previewState.textContent = "Preview required";
  previewState.className = "preview-state stale";
  document.getElementById("tab-review").classList.toggle("needs-review", !!combinedDeploymentConfig());
  updatePushAvailability();
}

function replaceConfig(text, manual = true) {
  if (state.pendingConfirmation || state.deploymentInProgress) return;
  let normalized = text.trim();
  if (manual && state.configManual && normalized) {
    const existingNames = new Set([
      ...state.discoveredVlans,
      ...parseVlanDefinitions(normalized),
      ...parseVlanDefinitions(state.configQueue.map((batch) => batch.config).join("\n"))
    ].map((vlan) => vlan.name));
    const retained = parseVlanDefinitions(configOutput.value).filter((vlan) => !existingNames.has(vlan.name));
    if (retained.length) {
      normalized = ["# New VLANs retained for deployment",
        ...retained.map((vlan) => `set vlans ${vlan.name} vlan-id ${vlan.value}`), "", normalized].join("\n");
    }
  }
  if (configOutput.value === normalized) {
    state.configManual = manual;
    return;
  }
  configOutput.value = normalized;
  state.configManual = manual;
  invalidatePreview();
  renderConfigQueue();
}

function appendConfigLines(lines) {
  if (!lines.length) return;
  const existingConfig = state.configManual ? configOutput.value.trim() : "";
  replaceConfig([existingConfig, lines.join("\n")].filter(Boolean).join("\n"), true);
}

function configCommandCount(config) {
  return config.split(/\r?\n/).filter((line) => {
    const trimmed = line.trim();
    return trimmed && !trimmed.startsWith("#");
  }).length;
}

function safeQueueLabel(value) {
  return value.replace(/[\r\n#]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 64);
}

function composeDeploymentConfig(queue = state.configQueue, current = configOutput.value) {
  const currentConfig = current.trim();
  if (!queue.length) return currentConfig;
  const sections = queue.map((batch, index) => (
    `# Queued batch ${index + 1}: ${batch.label}\n${batch.config}`
  ));
  if (currentConfig) sections.push(`# Current batch\n${currentConfig}`);
  return sections.join("\n\n").trim();
}

function combinedDeploymentConfig() {
  return composeDeploymentConfig();
}

function queueMatchesCurrentTarget() {
  return !state.queueTargetHost
    || state.queueTargetHost === hostInput.value.trim().toLowerCase();
}

function parseVlanDefinitions(config) {
  const vlans = new Map();
  config.split(/\r?\n/).forEach((line) => {
    const match = line.trim().match(/^set vlans ([A-Za-z0-9_.:-]+) vlan-id (\d+)$/);
    if (match && Number(match[2]) >= 1 && Number(match[2]) <= 4094) {
      vlans.set(match[1], { name: match[1], value: String(Number(match[2])) });
    }
  });
  return [...vlans.values()];
}

function syncAvailableVlans() {
  const vlans = new Map(state.discoveredVlans.map((vlan) => [vlan.name, { ...vlan }]));
  const queuedConfig = queueMatchesCurrentTarget() ? state.configQueue.map((batch) => batch.config).join("\n") : "";
  parseVlanDefinitions(`${queuedConfig}\n${configOutput.value}`).forEach((vlan) => {
    if (!vlans.has(vlan.name)) vlans.set(vlan.name, vlan);
  });
  const available = [...vlans.values()].sort((a, b) => Number(a.value) - Number(b.value) || a.name.localeCompare(b.name));
  if (JSON.stringify(available) === JSON.stringify(state.vlans)) return;
  state.vlans = available;
  renderVlanChoices();
  populateServiceChoices();
}

function renderConfigQueue() {
  syncAvailableVlans();
  const queuedCommands = state.configQueue.reduce(
    (total, batch) => total + configCommandCount(batch.config),
    0
  );
  configQueueSummary.textContent = state.configQueue.length
    ? `${state.configQueue.length} of ${MAX_CONFIG_QUEUE_BATCHES} batches · ${queuedCommands} commands`
    : "No queued batches";
  configQueueList.replaceChildren();
  if (!state.configQueue.length) {
    const empty = document.createElement("li");
    empty.className = "muted";
    empty.textContent = "Nothing is queued. The current editor will deploy by itself.";
    configQueueList.appendChild(empty);
  } else {
    state.configQueue.forEach((batch, index) => {
      const item = document.createElement("li");
      const row = document.createElement("div");
      row.className = "config-queue-item-heading";
      const identity = document.createElement("div");
      const label = document.createElement("strong");
      label.textContent = `${index + 1}. ${batch.label}`;
      const count = document.createElement("small");
      const commandCount = configCommandCount(batch.config);
      count.textContent = `${commandCount} command${commandCount === 1 ? "" : "s"}`;
      identity.append(label, count);
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "secondary compact-button";
      remove.textContent = "Remove";
      remove.disabled = state.pendingConfirmation || state.deploymentInProgress;
      remove.addEventListener("click", () => removeQueuedConfig(batch.id));
      row.append(identity, remove);
      const details = document.createElement("details");
      const summary = document.createElement("summary");
      summary.textContent = "View queued commands";
      const commands = document.createElement("pre");
      commands.textContent = batch.config;
      details.append(summary, commands);
      item.append(row, details);
      configQueueList.appendChild(item);
    });
  }
  const queueFull = state.configQueue.length >= MAX_CONFIG_QUEUE_BATCHES;
  queueCurrentConfigBtn.disabled = state.pendingConfirmation || state.deploymentInProgress || queueFull || !configOutput.value.trim();
  clearConfigQueueBtn.disabled = state.pendingConfirmation || state.deploymentInProgress || !state.configQueue.length;
  configQueueLabelInput.disabled = state.pendingConfirmation || state.deploymentInProgress;
  configOutput.disabled = state.pendingConfirmation || state.deploymentInProgress;
  updatePushAvailability();
}

function queueCurrentConfig() {
  const currentConfig = configOutput.value.trim();
  if (!currentConfig || state.pendingConfirmation || state.deploymentInProgress) return;
  if (!queueMatchesCurrentTarget()) {
    connectionStatus.textContent = "The queued batches belong to another switch. Clear the queue before changing targets.";
    connectionStatus.className = "status-pill error";
    return;
  }
  if (state.configQueue.length >= MAX_CONFIG_QUEUE_BATCHES) {
    connectionStatus.textContent = `The queue is limited to ${MAX_CONFIG_QUEUE_BATCHES} batches.`;
    connectionStatus.className = "status-pill error";
    return;
  }
  const batchNumber = state.nextQueueId;
  const batch = {
    id: batchNumber,
    label: safeQueueLabel(configQueueLabelInput.value) || `Batch ${batchNumber}`,
    config: currentConfig
  };
  const prospectiveConfig = composeDeploymentConfig([...state.configQueue, batch], "");
  if (prospectiveConfig.length > MAX_DEPLOYMENT_CONFIG_CHARS) {
    connectionStatus.textContent = "The combined queue would exceed the 64 KB deployment limit.";
    connectionStatus.className = "status-pill error";
    return;
  }
  state.configQueue.push(batch);
  state.nextQueueId += 1;
  state.queueTargetHost ||= hostInput.value.trim().toLowerCase();
  configQueueLabelInput.value = "";
  replaceConfig("", false);
  renderConfigQueue();
  connectionStatus.textContent = isDescriptionOnlyDeployment(combinedDeploymentConfig())
    ? `${batch.label} queued. Build the next batch or quick commit the combined descriptions.`
    : `${batch.label} queued. Build the next batch or run the combined comparison.`;
  connectionStatus.className = "status-pill connected";
  activateWorkspaceTab(state.lastEditingTab, true);
}

function removeQueuedConfig(batchId) {
  if (state.pendingConfirmation || state.deploymentInProgress) return;
  state.configQueue = state.configQueue.filter((batch) => batch.id !== batchId);
  if (!state.configQueue.length) state.queueTargetHost = null;
  invalidatePreview();
  renderConfigQueue();
}

function clearConfigQueue() {
  if (!state.configQueue.length || state.pendingConfirmation || state.deploymentInProgress) return;
  if (!window.confirm("Remove every queued configuration batch? The current editor will be kept.")) return;
  state.configQueue = [];
  state.queueTargetHost = null;
  invalidatePreview();
  renderConfigQueue();
}

function clearDeploymentWorkspace() {
  const committedVlans = new Map(state.discoveredVlans.map((vlan) => [vlan.name, { ...vlan }]));
  parseVlanDefinitions(combinedDeploymentConfig()).forEach((vlan) => {
    committedVlans.set(vlan.name, { ...committedVlans.get(vlan.name), ...vlan });
  });
  state.discoveredVlans = [...committedVlans.values()];
  state.configQueue = [];
  state.nextQueueId = 1;
  state.queueTargetHost = null;
  configQueueLabelInput.value = "";
  configOutput.value = "";
  state.configManual = false;
  compareOutput.textContent = "No device comparison loaded.";
  renderConfigQueue();
  activateWorkspaceTab(state.lastEditingTab, true);
}

async function checkBackendCompatibility() {
  try {
    const response = await fetch("/api/health", { cache: "no-store" });
    const health = await response.json();
    stopAppBtn.hidden = health.packaged !== true;
    if (!response.ok || health.apiVersion !== REQUIRED_API_VERSION) {
      connectionStatus.textContent = `Backend restart required (need API ${REQUIRED_API_VERSION}, found ${health.apiVersion ?? "legacy"})`;
      connectionStatus.className = "status-pill error";
      connectBtn.textContent = "Retry after backend restart";
      return false;
    }
    connectBtn.textContent = "Connect & pull data";
    return true;
  } catch (_error) {
    stopAppBtn.hidden = true;
    connectionStatus.textContent = "Backend is unavailable; start or restart Flask";
    connectionStatus.className = "status-pill error";
    connectBtn.textContent = "Retry backend connection";
    return false;
  }
}

async function stopPackagedApp() {
  const pendingWarning = state.pendingConfirmation
    ? "\n\nA confirmed commit is awaiting confirmation and will roll back automatically unless it has already been confirmed."
    : "";
  if (!window.confirm(`Stop Junos Helper and release its background processes?${pendingWarning}`)) return;
  stopAppBtn.disabled = true;
  stopAppBtn.textContent = "Stopping…";
  try {
    const response = await fetch("/api/shutdown", {
      method: "POST",
      headers: { "X-Junos-Helper": "shutdown" }
    });
    const payload = await response.json();
    if (!response.ok || !payload.ok) throw new Error(payload.error || "Shutdown failed");
    connectionStatus.textContent = "Junos Helper stopped; you can close this browser tab";
    connectionStatus.className = "status-pill";
    stopAppBtn.textContent = "Stopped";
  } catch (error) {
    connectionStatus.textContent = `Shutdown error: ${error.message}`;
    connectionStatus.className = "status-pill error";
    stopAppBtn.disabled = false;
    stopAppBtn.textContent = "Stop app";
  }
}

function clearConfirmationTimer() {
  if (state.confirmationTimer !== null) {
    window.clearInterval(state.confirmationTimer);
    state.confirmationTimer = null;
  }
}

function setDeploymentReady(message = "Compare before a rollback-protected push. Push runs commit check first; failed checks preserve your editor and queue.") {
  state.pendingActivityId = null;
  clearConfirmationTimer();
  state.pendingConfirmation = false;
  state.pendingTarget = null;
  state.confirmationDeadline = null;
  state.lastPreviewConfig = null;
  previewState.textContent = "Preview required";
  previewState.className = "preview-state stale";
  pushBtn.textContent = "Push with rollback protection";
  quickCommitBtn.textContent = "Quick commit";
  confirmBtn.disabled = true;
  confirmBtn.textContent = "Confirm committed change";
  commitTimer.textContent = "Ready";
  commitTimer.className = "commit-timer ready";
  deploymentHint.textContent = message;
  renderConfigQueue();
}

function updateConfirmationTimer() {
  if (!state.confirmationDeadline) return;
  const remainingMs = state.confirmationDeadline - Date.now();
  if (remainingMs <= 0) {
    setDeploymentReady("The confirmation window expired. Junos should roll back the unconfirmed change; verify the device before pushing again.");
    commitTimer.textContent = "Expired";
    commitTimer.className = "commit-timer expired";
    connectionStatus.textContent = "Confirmation window expired; automatic rollback expected";
    connectionStatus.className = "status-pill error";
    return;
  }
  const remainingSeconds = Math.ceil(remainingMs / 1000);
  const minutes = Math.floor(remainingSeconds / 60);
  const seconds = String(remainingSeconds % 60).padStart(2, "0");
  commitTimer.textContent = `${minutes}:${seconds}`;
}

function startConfirmationWindow(minutes) {
  clearConfirmationTimer();
  state.confirmationDeadline = Date.now() + minutes * 60 * 1000;
  pushBtn.disabled = true;
  pushBtn.textContent = "Waiting for confirmation";
  confirmBtn.disabled = false;
  commitTimer.className = "commit-timer active";
  deploymentHint.textContent = "The change is active with rollback protection. Verify service, then confirm before time runs out.";
  renderConfigQueue();
  updateConfirmationTimer();
  state.confirmationTimer = window.setInterval(updateConfirmationTimer, 1000);
}

async function loadDefaults() {
  try {
    const response = await fetch("/api/defaults");
    if (!response.ok) return;
    const defaults = await response.json();
    if (!hostInput.value) hostInput.value = defaults.host || "";
    if (!usernameInput.value) usernameInput.value = defaults.username || "";
    updateConnectionHint();
    updateConfig();
  } catch (_error) {
    // Offline config generation still works when the backend is unavailable.
  }
}

function connectionPayload(extra = {}) {
  return {
    deviceId: state.savedDeviceId,
    host: hostInput.value.trim(),
    username: usernameInput.value.trim(),
    password: passwordInput.value,
    deviceName: deviceNameInput.value.trim(),
    ...extra
  };
}

function getLiveWatchContext() {
  const connection = connectionPayload();
  return { connection, ports: state.ports, selected: new Set(state.selected),
    connected: state.protectionHost === connection.host.toLowerCase() && state.ports.length > 0,
    busy: state.connectionInProgress || state.deploymentInProgress || state.bounceInProgress,
    inventoryAt: state.deviceDataSnapshots?.get(connection.host.toLowerCase())?.collectedAt || null };
}

function cacheDeviceData(payload) {
  const snapshots = state.deviceDataSnapshots ||= new Map();
  const host = payload.host.trim().toLowerCase();
  const debug = payload.debug || {};
  const text = [
    `Interface count: ${debug.interfaceCount ?? payload.portCount ?? 0}`,
    `VLAN count: ${debug.vlanCount ?? 0}`,
    `Configured interface count: ${debug.configuredInterfaceCount ?? 0}`,
    ...((payload.results || []).map((entry) => `=== ${entry.command} ===\n${(entry.output || "").trim()}${entry.error ? `\nError: ${entry.error.trim()}` : ""}`))
  ].join("\n\n");
  snapshots.delete(host);
  snapshots.set(host, { host: payload.host, device: payload.deviceName || payload.host,
    collectedAt: payload.collectedAt || new Date().toISOString(), text });
  if (snapshots.size > 10) snapshots.delete(snapshots.keys().next().value);
}

function queueBrowserError(message, source = "") {
  state.browserErrors.push({ message: String(message).slice(0, 2000), source: String(source).slice(0, 200),
    host: hostInput.value.trim(), deviceId: state.savedDeviceId, deviceName: deviceNameInput.value.trim() });
  if (state.browserErrors.length > 50) state.browserErrors.shift();
  void flushBrowserErrors();
}

async function flushBrowserErrors() {
  if (state.browserErrorsFlushing) return;
  state.browserErrorsFlushing = true;
  try {
    while (state.browserErrors.length) {
      const response = await fetch("/api/activity/browser-error", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(state.browserErrors[0])
      });
      if (!response.ok) break;
      state.browserErrors.shift();
    }
  } catch (_error) {
    // Keep unsent errors in memory; do not recursively log a logging failure.
  } finally {
    state.browserErrorsFlushing = false;
  }
}

function openOptionsPopup(dialog, buttonId) {
  state.returnToOptionsButton = optionsDialog.open ? buttonId : null;
  if (optionsDialog.open) optionsDialog.close();
  dialog.showModal();
}

function showDeviceData() {
  const host = hostInput.value.trim().toLowerCase();
  const snapshot = state.deviceDataSnapshots?.get(host);
  deviceDataSummary.textContent = snapshot
    ? `${snapshot.device} · ${snapshot.host} · Collected ${new Date(snapshot.collectedAt).toLocaleString()}`
    : `No data has been pulled for ${host || "the current target"} in this browser session.`;
  deviceDataOutput.textContent = snapshot?.text || "Connect or refresh this device to collect its data.";
  openOptionsPopup(deviceDataDialog, "openDeviceDataBtn");
}

function activityEventMessage(event) {
  if (event.confirmationState === "confirmed") return "Configuration applied; final confirmation was later recorded.";
  if (event.confirmationState === "window-elapsed") return "Configuration was applied; the confirmation window elapsed. Verify the current switch state.";
  return event.message;
}

function renderActivityLog() {
  activityLogList.replaceChildren();
  if (!state.activityEvents.length) {
    const empty = document.createElement("li");
    empty.className = "muted";
    empty.textContent = "No retained entries match these filters. History begins with this update.";
    activityLogList.appendChild(empty);
    return;
  }
  state.activityEvents.forEach((event) => {
    const item = document.createElement("li");
    item.className = `activity-entry ${["info", "warning", "error"].includes(event.severity) ? event.severity : "info"}`;
    const heading = document.createElement("div");
    heading.className = "activity-entry-heading";
    const time = document.createElement("time");
    time.dateTime = event.timestamp;
    time.textContent = new Date(event.timestamp).toLocaleString();
    const status = document.createElement("strong");
    status.textContent = (event.confirmationState || event.status).replaceAll("-", " ");
    heading.append(time, status);
    const device = document.createElement("div");
    device.className = "activity-entry-device";
    device.textContent = `${event.device_name || event.host || "Application"}${event.device_name && event.host ? ` · ${event.host}` : ""} · ${event.operation}`;
    const message = document.createElement("p");
    message.textContent = activityEventMessage(event);
    const details = document.createElement("details");
    const summary = document.createElement("summary");
    summary.textContent = "Details";
    const content = document.createElement("pre");
    content.textContent = JSON.stringify(event.details, null, 2);
    details.append(summary, content);
    item.append(heading, device, message, details);
    activityLogList.appendChild(item);
  });
}

async function loadActivityLog(older = false) {
  const loadId = ++state.activityLoadId;
  const host = hostInput.value.trim().toLowerCase();
  const activeOnly = activityLogScope.value === "active";
  if (!older) {
    state.activityEvents = [];
    state.activityBefore = null;
    activityLogList.replaceChildren();
    olderActivityLogBtn.hidden = true;
  }
  if (activeOnly && !host) {
    activityLogSummary.textContent = "Choose a target device or select All devices.";
    refreshActivityLogBtn.disabled = false;
    olderActivityLogBtn.disabled = false;
    return;
  }
  const query = new URLSearchParams({ view: activityLogView.value });
  if (activeOnly) query.set("host", host);
  if (older && state.activityBefore) query.set("before", String(state.activityBefore));
  refreshActivityLogBtn.disabled = true;
  olderActivityLogBtn.disabled = true;
  activityLogSummary.textContent = "Loading local activity history…";
  activityLogSummary.className = "tool-summary muted";
  try {
    const response = await fetch(`/api/activity?${query}`, { cache: "no-store" });
    const payload = await response.json();
    if (!response.ok || !payload.ok) throw new Error(payload.error || "Unable to read activity history");
    if (loadId !== state.activityLoadId) return;
    state.activityEvents = [...new Map([...state.activityEvents, ...payload.events].map((event) => [event.id, event])).values()];
    state.activityBefore = payload.nextBefore;
    olderActivityLogBtn.hidden = !payload.hasMore;
    renderActivityLog();
    activityLogSummary.textContent = `${state.activityEvents.length} entries · ${activeOnly ? host : "All devices"}${payload.warning ? ` · ${payload.warning}` : ""}`;
    activityLogSummary.className = `tool-summary ${payload.warning ? "error-text" : "muted"}`;
  } catch (error) {
    if (loadId !== state.activityLoadId) return;
    activityLogSummary.textContent = error.message;
    activityLogSummary.className = "tool-summary error-text";
  } finally {
    if (loadId === state.activityLoadId) {
      refreshActivityLogBtn.disabled = false;
      olderActivityLogBtn.disabled = false;
    }
  }
}

function showActivityLog() {
  activityLogScope.value = "active";
  openOptionsPopup(activityLogDialog, "openActivityLogBtn");
  void flushBrowserErrors();
  return loadActivityLog();
}

function savedDeviceGroup(device) {
  return device.group?.trim() || "Ungrouped";
}

function sortedSavedDeviceGroups() {
  return Array.from(new Set(state.savedDevices.map(savedDeviceGroup)))
    .sort((left, right) => {
      if (left === "Ungrouped") return 1;
      if (right === "Ungrouped") return -1;
      return left.localeCompare(right, undefined, { numeric: true });
    });
}

function savedDeviceGroupIsVisible(device) {
  return state.visibleSavedDeviceGroups === null
    || state.visibleSavedDeviceGroups.has(savedDeviceGroup(device));
}

function renderSavedDeviceChoices(selectedId = state.savedDeviceId) {
  savedDeviceInput.replaceChildren(new Option("Choose a saved device", ""));
  const devicesByGroup = new Map();
  state.savedDevices.filter(savedDeviceGroupIsVisible).forEach((device) => {
    const group = savedDeviceGroup(device);
    if (!devicesByGroup.has(group)) devicesByGroup.set(group, []);
    devicesByGroup.get(group).push(device);
  });
  sortedSavedDeviceGroups().forEach((group) => {
    const devices = devicesByGroup.get(group);
    if (!devices?.length) return;
    const optionGroup = document.createElement("optgroup");
    optionGroup.label = group;
    devices.forEach((device) => optionGroup.appendChild(new Option(`${device.hostname} — ${device.host}`, device.id)));
    savedDeviceInput.appendChild(optionGroup);
  });
  const selectedIsVisible = selectedId
    && state.savedDevices.some((device) => device.id === selectedId && savedDeviceGroupIsVisible(device));
  if (selectedIsVisible) {
    savedDeviceInput.value = selectedId;
    state.savedDeviceId = selectedId;
  } else if (selectedId) {
    state.savedDeviceId = null;
  }
  quickConnectBtn.disabled = !savedDeviceInput.value || state.connectionInProgress;
}

function renderVisibleGroupChoices() {
  visibleGroupList.replaceChildren();
  const groups = sortedSavedDeviceGroups();
  if (!groups.length) {
    const empty = document.createElement("span");
    empty.className = "muted";
    empty.textContent = "No groups loaded.";
    visibleGroupList.appendChild(empty);
    visibleGroupStatus.textContent = "No saved-device groups are available.";
    return;
  }
  groups.forEach((group) => {
    const count = state.savedDevices.filter((device) => savedDeviceGroup(device) === group).length;
    const label = document.createElement("label");
    label.className = "compact-checkbox visible-group-option";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.name = "visibleSavedGroup";
    checkbox.value = group;
    checkbox.checked = state.visibleSavedDeviceGroups === null || state.visibleSavedDeviceGroups.has(group);
    const name = document.createElement("span");
    name.textContent = group;
    const total = document.createElement("small");
    total.textContent = String(count);
    label.append(checkbox, name, total);
    visibleGroupList.appendChild(label);
  });
  const visibleCount = visibleGroupList.querySelectorAll('input[name="visibleSavedGroup"]:checked').length;
  visibleGroupStatus.textContent = state.visibleSavedDeviceGroups === null
    ? `All ${groups.length} group${groups.length === 1 ? " is" : "s are"} shown.`
    : `${visibleCount} of ${groups.length} groups shown.`;
  visibleGroupStatus.className = `tool-summary ${visibleCount ? "valid" : "muted"}`;
}

function storeVisibleSavedDeviceGroups() {
  try {
    if (state.visibleSavedDeviceGroups === null) {
      window.localStorage.removeItem(VISIBLE_GROUPS_STORAGE_KEY);
    } else {
      window.localStorage.setItem(
        VISIBLE_GROUPS_STORAGE_KEY,
        JSON.stringify(Array.from(state.visibleSavedDeviceGroups))
      );
    }
  } catch (_error) {
    // The filter remains active for this session if browser storage is unavailable.
  }
}

async function loadSavedDevices(selectedId = state.savedDeviceId) {
  try {
    const response = await fetch("/api/devices", { cache: "no-store" });
    const payload = await response.json();
    if (!response.ok || !payload.ok) return;
    state.savedDevices = payload.devices || [];
    const groups = Array.from(new Set(state.savedDevices.map((device) => device.group?.trim()).filter(Boolean)))
      .sort((left, right) => left.localeCompare(right, undefined, { numeric: true }));
    savedDeviceGroups.replaceChildren(...groups.map((group) => {
      const option = document.createElement("option");
      option.value = group;
      return option;
    }));
    renderVisibleGroupChoices();
    renderSavedDeviceChoices(selectedId);
    renderGroupDeviceList();
  } catch (_error) {
    // Manual connections remain available if saved profiles cannot be loaded.
  }
}

function selectedGroupDeviceIds() {
  return Array.from(groupDeviceList.querySelectorAll('input[name="groupDevice"]:checked'))
    .map((input) => input.value);
}

function updateGroupSelectionStatus() {
  const count = selectedGroupDeviceIds().length;
  groupManagementStatus.textContent = count
    ? `${count} saved switch${count === 1 ? "" : "es"} selected`
    : "Select saved switches to organize.";
  groupManagementStatus.className = `tool-summary ${count ? "valid" : "muted"}`;
}

function renderGroupDeviceList() {
  const previouslySelected = new Set(selectedGroupDeviceIds());
  groupDeviceList.replaceChildren();
  if (!state.savedDevices.length) {
    const empty = document.createElement("span");
    empty.className = "muted";
    empty.textContent = "No saved switches available.";
    groupDeviceList.appendChild(empty);
    updateGroupSelectionStatus();
    return;
  }
  const devicesByGroup = new Map();
  state.savedDevices.forEach((device) => {
    const group = device.group?.trim() || "Ungrouped";
    if (!devicesByGroup.has(group)) devicesByGroup.set(group, []);
    devicesByGroup.get(group).push(device);
  });
  Array.from(devicesByGroup.entries())
    .sort(([left], [right]) => {
      if (left === "Ungrouped") return 1;
      if (right === "Ungrouped") return -1;
      return left.localeCompare(right, undefined, { numeric: true });
    })
    .forEach(([group, devices]) => {
      const fieldset = document.createElement("fieldset");
      fieldset.className = "group-device-section";
      const legend = document.createElement("legend");
      legend.textContent = group;
      fieldset.appendChild(legend);
      devices.forEach((device) => {
        const label = document.createElement("label");
        label.className = "compact-checkbox group-device-option";
        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.name = "groupDevice";
        checkbox.value = device.id;
        checkbox.checked = previouslySelected.has(device.id);
        const name = document.createElement("span");
        name.textContent = device.hostname;
        const host = document.createElement("small");
        host.textContent = device.host;
        label.append(checkbox, name, host);
        fieldset.appendChild(label);
      });
      groupDeviceList.appendChild(fieldset);
    });
  updateGroupSelectionStatus();
}

async function assignSelectedDevicesToGroup() {
  const deviceIds = selectedGroupDeviceIds();
  if (!deviceIds.length) {
    updateGroupSelectionStatus();
    groupManagementStatus.textContent = "Select at least one saved switch first.";
    groupManagementStatus.className = "tool-summary error-text";
    return;
  }
  const group = groupAssignmentInput.value.trim();
  const assignButton = document.getElementById("assignGroupBtn");
  assignButton.disabled = true;
  assignButton.textContent = "Applying…";
  try {
    const response = await fetch("/api/devices/group", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ deviceIds, group })
    });
    const payload = await response.json();
    if (!response.ok || !payload.ok) throw new Error(payload.error || "Unable to update switch groups");
    await loadSavedDevices(state.savedDeviceId);
    groupAssignmentInput.value = "";
    groupManagementStatus.textContent = `Moved ${payload.updated} switch${payload.updated === 1 ? "" : "es"} to ${group || "Ungrouped"}`;
    groupManagementStatus.className = "tool-summary valid";
  } catch (error) {
    groupManagementStatus.textContent = `Group update error: ${error.message}`;
    groupManagementStatus.className = "tool-summary error-text";
  } finally {
    assignButton.disabled = false;
    assignButton.textContent = "Apply group";
  }
}

function selectSavedDevice() {
  const device = state.savedDevices.find((entry) => entry.id === savedDeviceInput.value);
  state.savedDeviceId = device?.id || null;
  quickConnectBtn.disabled = !device || state.connectionInProgress;
  if (!device) return;
  hostInput.value = device.host;
  usernameInput.value = device.username;
  passwordInput.value = "";
  deviceNameInput.value = device.hostname;
  invalidatePreview();
  updateConnectionHint();
  updateConfig();
  window.liveWatch?.onContextChange();
}

async function saveCurrentDevice({ automatic = false } = {}) {
  if (!deviceNameInput.value || !hostInput.value.trim() || !usernameInput.value.trim()) {
    connectionStatus.textContent = "Connect and discover a device hostname before saving it";
    connectionStatus.className = "status-pill error";
    return null;
  }
  saveDeviceBtn.disabled = true;
  saveDeviceBtn.textContent = "Saving…";
  try {
    const existingProfile = state.savedDevices.find((device) => device.id === state.savedDeviceId)
      || savedProfileForCurrentConnection();
    const response = await fetch("/api/devices", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(connectionPayload({
        hostname: deviceNameInput.value,
        group: existingProfile?.group || ""
      }))
    });
    const payload = await response.json();
    if (!response.ok || !payload.ok) throw new Error(payload.error || "Unable to save device");
    state.savedDeviceId = payload.device.id;
    passwordInput.value = "";
    await loadSavedDevices(payload.device.id);
    const groupMessage = payload.device.group ? ` in ${payload.device.group}` : "";
    connectionStatus.textContent = automatic
      ? `${payload.device.hostname} connected and auto-saved${groupMessage}`
      : `${payload.device.hostname} saved${groupMessage} for quick connect`;
    connectionStatus.className = "status-pill connected";
    return payload.device;
  } catch (error) {
    connectionStatus.textContent = automatic
      ? `Connected, but auto-save failed: ${error.message}`
      : `Save error: ${error.message}`;
    connectionStatus.className = "status-pill error";
    return null;
  } finally {
    saveDeviceBtn.disabled = !state.ports.length;
    saveDeviceBtn.textContent = "Save device";
  }
}

function savedProfileForCurrentConnection() {
  const hostname = deviceNameInput.value.trim().toLowerCase();
  const host = hostInput.value.trim().toLowerCase();
  return state.savedDevices.find((device) => (
    device.hostname.toLowerCase() === hostname || device.host.toLowerCase() === host
  )) || null;
}

function configureAutoRefresh() {
  if (state.refreshTimer !== null) {
    window.clearInterval(state.refreshTimer);
    state.refreshTimer = null;
  }
  const seconds = Number(refreshIntervalInput.value);
  if (seconds > 0 && state.ports.length) {
    state.refreshTimer = window.setInterval(() => connectToSwitch({ isRefresh: true }), seconds * 1000);
  }
}

async function connectToSwitch({ isRefresh = false } = {}) {
  if (state.connectionInProgress || state.bounceInProgress) return;
  if (!(await checkBackendCompatibility())) return;
  if (!isRefresh) await loadDefaults();
  const previousSelected = new Set(state.selected);
  const previousConfigManual = state.configManual;
  state.connectionInProgress = true;
  connectBtn.disabled = true;
  refreshNowBtn.disabled = true;
  quickConnectBtn.disabled = true;
  connectionStatus.textContent = "Connecting…";
  connectionStatus.className = "status-pill";
  connectionStatus.textContent = isRefresh ? "Refreshing switch data…" : "Connecting…";

  try {
    const response = await fetch("/api/connect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(connectionPayload({ isRefresh }))
    });

    const payload = await response.json();
    if (!response.ok || !payload.ok) {
      throw new Error(payload.error || "Connection failed");
    }

    if (payload.interfaces && payload.interfaces.length) {
        const discovered = payload.interfaces;
        const detailsByName = Object.fromEntries((payload.interfaceDetails || []).map((detail) => [detail.name, detail]));
        const configurationByName = payload.interfaceConfiguration || {};
        state.ports = discovered.map((name, index) => {
          const detail = detailsByName[name] || {};
          const configuration = configurationByName[name] || {};
          const currentVlans = detail.vlans || configuration.vlans || [];
          return {
            index,
            prefix: name,
            name,
            selected: false,
            admin: detail.admin || "unknown",
            oper: detail.oper || "unknown",
            configured: currentVlans.length > 0,
            currentVlans,
            currentMode: detail.mode || configuration.mode || "unknown",
            currentNativeVlanId: detail.nativeVlanId || configuration.nativeVlanId || "",
            currentDescription: detail.description || configuration.description || "",
            currentDisabled: !!(detail.disabled || configuration.disabled),
            negotiatedSpeed: detail.negotiatedSpeed || "Unknown",
            speedCapability: detail.speedCapability || "Unknown",
            learnedMacs: detail.learnedMacs || [],
            lldpNeighbor: detail.lldpNeighbor || null,
            currentSetLines: detail.setLines || configuration.setLines || [],
            modeKeyword: detail.modeKeyword || configuration.modeKeyword || "interface-mode"
          };
        });
      state.modeKeyword = state.ports.find((port) => port.modeKeyword)?.modeKeyword || "interface-mode";
      populateSeriesStartPorts();
      state.selected = isRefresh
        ? new Set([...previousSelected].filter((name) => state.ports.some((port) => port.name === name)))
        : new Set();
      if (!isRefresh) state.lastSelected = null;
      connectionStatus.textContent = `${isRefresh ? "Refreshed" : "Connected"}: ${discovered.length} interfaces discovered`;
      connectionStatus.className = "status-pill connected";
    } else {
      connectionStatus.textContent = "Connected, but no interface names were parsed from the switch output";
      connectionStatus.className = "status-pill";
    }

    if (payload.deviceName) {
      deviceNameInput.value = payload.deviceName;
    }

    const metadataItems = [];
    if (payload.metadata?.hostname) {
      metadataItems.push(`Hostname: ${payload.metadata.hostname}`);
    }
    if (payload.metadata?.model) {
      metadataItems.push(`Model: ${payload.metadata.model}`);
    }
    if (payload.metadata?.version) {
      metadataItems.push(`Junos: ${payload.metadata.version}`);
    }
    if (payload.metadata?.serial) {
      metadataItems.push(`Serial: ${payload.metadata.serial}`);
    }
    deviceMetadata.replaceChildren();
    if (metadataItems.length) {
      const heading = document.createElement("strong");
      heading.textContent = "Discovered device info";
      deviceMetadata.appendChild(heading);
      metadataItems.forEach((item) => {
        deviceMetadata.appendChild(document.createElement("br"));
        deviceMetadata.appendChild(document.createTextNode(item));
      });
    }

    state.discoveredVlans = payload.vlanMemberships || [];
    state.manualProtectedPorts = payload.manualProtectedPorts || [];
    state.protectionHost = payload.host.trim().toLowerCase();
    state.irbUnits = payload.irbUnits || [];
    state.bridgeServices = payload.bridgeServices || [];
    syncAvailableVlans();
    renderVlanChoices();
    populateServiceChoices();

    if (payload.debug) {
      cacheDeviceData(payload);
    }

    state.configManual = isRefresh ? previousConfigManual : false;
    saveDeviceBtn.disabled = false;
    refreshNowBtn.disabled = false;
    lastRefresh.textContent = `Last refreshed ${new Date().toLocaleTimeString()}`;
    render(!isRefresh);
    configureAutoRefresh();
    if (!isRefresh) {
      if (autoSaveConnectionsInput.checked) await loadSavedDevices(state.savedDeviceId);
      const existingProfile = savedProfileForCurrentConnection();
      if (existingProfile) {
        state.savedDeviceId = existingProfile.id;
        savedDeviceInput.value = existingProfile.id;
      } else if (autoSaveConnectionsInput.checked) {
        await saveCurrentDevice({ automatic: true });
      }
    }
  } catch (error) {
    connectionStatus.textContent = `${isRefresh ? "Refresh" : "Connection"} error: ${error.message}`;
    connectionStatus.className = "status-pill error";
  } finally {
    state.connectionInProgress = false;
    connectBtn.disabled = false;
    refreshNowBtn.disabled = !state.ports.length;
    quickConnectBtn.disabled = !savedDeviceInput.value;
    updatePushAvailability();
    window.liveWatch?.onContextChange();
  }
}

function logicalServicesForPort(portName) {
  const services = [];
  state.bridgeServices.forEach((service) => {
    service.interfaces.forEach((interfaceName) => {
      const separator = interfaceName.lastIndexOf(".");
      if (separator > 0 && interfaceName.slice(0, separator) === portName) {
        services.push(`${service.name} (unit ${interfaceName.slice(separator + 1)})`);
      }
    });
  });
  return services;
}

function negotiatedSpeedClass(speed) {
  const match = String(speed || "").trim().match(/^(\d+(?:\.\d+)?)\s*(Mbps|Gbps|Tbps)$/i);
  if (!match) return "speed-other";
  const amount = Number(match[1]);
  const unit = match[2].toLowerCase();
  const rateMbps = amount * ({ mbps: 1, gbps: 1000, tbps: 1000000 }[unit] || 0);
  const speedClasses = new Map([
    [100, "speed-100m"],
    [1000, "speed-1g"],
    [2500, "speed-2-5g"],
    [10000, "speed-10g"],
    [100000, "speed-100g"]
  ]);
  return speedClasses.get(rateMbps) || "speed-other";
}

function render(updateConfiguration = true) {
  portGrid.innerHTML = "";
  const macTopology = buildMacTopology();
  state.ports.forEach((port) => {
    const button = document.createElement("button");
    const portName = port.name;
    const oper = (port.oper || "unknown").toLowerCase();
    const logicalServices = logicalServicesForPort(portName);
    const configured = !!port.configured || logicalServices.length > 0;
    const selectedClass = state.selected.has(portName) ? " selected" : "";
    const anchorClass = selectionModeInput.value !== "single" && state.lastSelected === port.index ? " range-anchor" : "";
    const statusClass = oper === "up"
      ? ` state-up ${negotiatedSpeedClass(port.negotiatedSpeed)}`
      : oper === "down" ? " state-down" : "";
    button.className = `port-tile${selectedClass}${anchorClass}${statusClass}${configured ? " configured" : ""}${port.currentDisabled ? " disabled-port" : ""}`;
    button.type = "button";
    const description = port.currentDescription || "";
    const displayDescription = description.replace(/^\d{1,3}_/, "");
    const mode = ["access", "trunk"].includes(port.currentMode) ? port.currentMode : "not set";
    const vlanSummary = port.currentVlans?.length ? port.currentVlans.join(", ") : "None";
    const tooltipId = `port-tooltip-${port.index}`;
    button.setAttribute("aria-describedby", tooltipId);
    const label = document.createElement("div");
    label.className = "port-label";
    label.textContent = portName;
    const descriptionLabel = document.createElement("div");
    descriptionLabel.className = "port-description";
    descriptionLabel.textContent = displayDescription;

    const tooltip = document.createElement("span");
    tooltip.className = "port-tooltip";
    tooltip.id = tooltipId;
    tooltip.role = "tooltip";
    const tooltipHeading = document.createElement("strong");
    tooltipHeading.textContent = portName;
    tooltip.appendChild(tooltipHeading);
    const neighbor = port.lldpNeighbor || {};
    const learnedMacCount = new Set((port.learnedMacs || []).map((entry) => entry.mac.toLowerCase())).size;
    const uplinkReason = uplinkCandidateReason(port, macTopology);
    const protection = portProtectionReason(port, macTopology);
    if (protection) {
      const badge = document.createElement("span");
      badge.className = "protected-port-badge";
      badge.textContent = "\u{1F512}";
      badge.title = `Protected: ${protection}`;
      badge.setAttribute("aria-label", `Protected: ${protection}`);
      button.appendChild(badge);
    }
    const learnedManufacturers = Array.from(new Set(
      (port.learnedMacs || []).map((entry) => entry.manufacturer).filter(Boolean)
    ));
    const manufacturerSummary = neighbor.manufacturer
      || (learnedManufacturers.length === 1 ? learnedManufacturers[0]
        : learnedManufacturers.length > 1 ? `${learnedManufacturers.length} manufacturers` : "Unknown");
    const speedSummary = `${port.negotiatedSpeed || "Unknown"} / ${port.speedCapability || "Unknown"}`;
    const richardDetails = document.createElement("dl");
    richardDetails.className = "richard-details";
    [
      ["Admin / link", `${port.currentDisabled ? "disabled" : (port.admin || "unknown")} / ${oper}`],
      ["Link / max", speedSummary],
      ["Mode", mode],
      ["Native VLAN", port.currentNativeVlanId || "None"],
      ["VLANs", vlanSummary],
      ["Logical services", logicalServices.length ? logicalServices.join(", ") : "None"],
      ["MACs", String(learnedMacCount)],
      ["Neighbor", neighbor.systemName || "None learned"],
      ["Manufacturer", manufacturerSummary],
      ["Role", uplinkReason ? "Uplink candidate" : "Local"]
    ].forEach(([term, value]) => {
      const key = document.createElement("dt");
      const detail = document.createElement("dd");
      key.textContent = term;
      detail.textContent = value;
      richardDetails.append(key, detail);
    });
    const connectionRows = [
      ["Protection", protection],
      ["Description", description || "Not set"],
      ["Mode", mode],
      ["Native VLAN", port.currentNativeVlanId || "None"],
      ["VLANs", vlanSummary],
      ["Logical services", logicalServices.length ? logicalServices.join(", ") : "None"],
      ["Admin / link", `${port.currentDisabled ? "disabled" : (port.admin || "unknown")} / ${oper}`],
      ["Negotiated rate", port.negotiatedSpeed || "Unknown"],
      ["Port capability", port.speedCapability || "Unknown"],
      ["Neighbor", neighbor.systemName],
      ["Neighbor port", neighbor.portDescription || neighbor.portId],
      ["Device details", neighbor.systemDescription],
      ["Manufacturer", manufacturerSummary],
      ["Port role", uplinkReason ? `Uplink candidate: ${uplinkReason}` : "Local endpoint port"],
      ["Learned MACs", String(learnedMacCount)],
      ["Chassis ID", neighbor.chassisId]
    ];
    if (port.currentDisabled) {
      connectionRows.push(["Cable check", learnedMacCount || port.lldpNeighbor
        ? "Last/retained device evidence; live link cannot be verified while disabled"
        : "No device evidence; disabled ports cannot verify a live cable"]);
    } else if (!learnedMacCount && !port.lldpNeighbor) {
      connectionRows.push(["Connected device", "None learned"]);
    }
    connectionRows.filter(([, value]) => value).forEach(([term, value]) => {
      const row = document.createElement("span");
      row.className = "port-tooltip-row";
      if (["Description", "Neighbor port", "Device details", "Cable check", "Protection"].includes(term)) {
        row.classList.add("richard-tooltip-supplemental");
      }
      const key = document.createElement("b");
      key.textContent = `${term}:`;
      const detail = document.createElement("span");
      detail.textContent = value;
      row.append(key, detail);
      tooltip.appendChild(row);
    });
    button.append(label, descriptionLabel, richardDetails, tooltip);
    const positionTooltip = () => positionPortTooltip(button, tooltip);
    button.addEventListener("mouseenter", positionTooltip);
    button.addEventListener("focus", positionTooltip);
    button.addEventListener("click", (event) => handlePortSelect(portName, event));
    portGrid.appendChild(button);
  });

  updateSelectionSummary();
  updateProtectionSummary();
  updateViewMacsButton();
  updateIntendedChangeSummary();
  updateMoveSummary();
  if (state.selected.size && !seriesStartPort.value) {
    seriesStartPort.value = state.ports.find((port) => state.selected.has(port.name))?.name || "";
  }
  updateSeriesDescriptionPreview();
  updateDescriptionTransformPreview();
  updateCustomCommandPreview();
  updateIrbSummary();
  updateQinqSummary();
  updateLogicalServiceMoveSummary();
  window.liveWatch?.onContextChange();
  if (updateConfiguration) updateConfig();
  updateConnectionHint();
}

function positionPortTooltip(tile, tooltip) {
  tooltip.classList.remove("positioned");
  tooltip.style.removeProperty("left");
  tooltip.style.removeProperty("top");

  const panel = tile.closest(".device-panel");
  if (!panel) return;
  const panelRect = panel.getBoundingClientRect();
  const tileRect = tile.getBoundingClientRect();
  const tooltipRect = tooltip.getBoundingClientRect();
  const gutter = 12;
  const gap = 9;
  const leftBound = Math.max(panelRect.left, 0) + gutter;
  const rightBound = Math.min(panelRect.right, window.innerWidth) - gutter;
  const topBound = Math.max(panelRect.top, 0) + gutter;
  const bottomBound = Math.min(panelRect.bottom, window.innerHeight) - gutter;

  const preferredLeft = tileRect.left + (tileRect.width - tooltipRect.width) / 2;
  const left = Math.min(
    Math.max(preferredLeft, leftBound),
    Math.max(leftBound, rightBound - tooltipRect.width)
  );
  const above = tileRect.top - tooltipRect.height - gap;
  const below = tileRect.bottom + gap;
  let top = above;
  if (above < topBound && below + tooltipRect.height <= bottomBound) top = below;
  top = Math.min(
    Math.max(top, topBound),
    Math.max(topBound, bottomBound - tooltipRect.height)
  );

  tooltip.style.left = `${left - tileRect.left}px`;
  tooltip.style.top = `${top - tileRect.top}px`;
  tooltip.classList.add("positioned");
}

function buildMacTopology() {
  const macPorts = new Map();
  const portCounts = new Map();
  const explicitUplinks = new Set();
  state.ports.forEach((port) => {
    const uniqueMacs = new Set((port.learnedMacs || []).map((entry) => entry.mac.toLowerCase()));
    portCounts.set(port.name, uniqueMacs.size);
    uniqueMacs.forEach((mac) => {
      if (!macPorts.has(mac)) macPorts.set(mac, new Set());
      macPorts.get(mac).add(port.name);
    });
    const description = port.currentDescription || "";
    if (/(?:^|[^a-z0-9])(?:uplink|upstream|distribution|distro|core)(?:$|[^a-z0-9])/i.test(description)) {
      explicitUplinks.add(port.name);
    }
  });
  return { macPorts, portCounts, explicitUplinks };
}

function uplinkCandidateReason(port, topology = buildMacTopology()) {
  const macCount = topology.portCounts.get(port.name) || 0;
  const capabilities = `${port.lldpNeighbor?.systemCapabilities || ""} ${port.lldpNeighbor?.enabledCapabilities || ""}`;
  if (topology.explicitUplinks.has(port.name)) return "interface description";
  if (/^(?:ae|reth)\d+$/i.test(port.name)) return "aggregated interface";

  const duplicateMacs = new Set((port.learnedMacs || [])
    .map((entry) => entry.mac.toLowerCase())
    .filter((mac) => (topology.macPorts.get(mac)?.size || 0) > 1));
  const duplicatePeers = new Set();
  duplicateMacs.forEach((mac) => {
    topology.macPorts.get(mac).forEach((name) => {
      if (name !== port.name) duplicatePeers.add(name);
    });
  });
  if (!topology.explicitUplinks.size && duplicateMacs.size >= 2 && duplicatePeers.size >= 2) {
    return `${duplicateMacs.size} MACs repeated across ${duplicatePeers.size} ports`;
  }

  if (!topology.explicitUplinks.size) {
    const otherCounts = Array.from(topology.portCounts.entries())
      .filter(([name]) => name !== port.name)
      .map(([, count]) => count)
      .filter(Boolean);
    const nextHighest = Math.max(0, ...otherCounts);
    const dominant = otherCounts.length >= 2 && macCount >= 8 && macCount >= Math.max(8, nextHighest * 4);
    const corroborated = port.currentMode === "trunk" || /\bbridge\b/i.test(capabilities) || macCount >= 32;
    if (dominant && corroborated) return "dominant learned-MAC count";
  }
  return "";
}

function portProtectionReason(port, topology = buildMacTopology()) {
  if (state.manualProtectedPorts.includes(port.name)) return "Manually protected";
  const uplink = uplinkCandidateReason(port, topology);
  if (uplink) return `Uplink candidate: ${uplink}`;
  if (port.currentMode === "trunk") return "Trunk port";
  if (/\b(?:bridge|router)\b/i.test(`${port.lldpNeighbor?.systemCapabilities || ""} ${port.lldpNeighbor?.enabledCapabilities || ""}`)) return "LLDP switch/router neighbor";
  if ((port.currentSetLines || []).some((line) => /\b802\.3ad\b/.test(line))) return "Aggregate member";
  return "";
}

function quickPortExclusion(port, topology = buildMacTopology()) {
  const protection = portProtectionReason(port, topology);
  if (protection) return protection;
  if (port.currentMode !== "access") return "Requires explicit access mode";
  if ((port.currentSetLines || []).some((line) =>
    /\b(?:native-vlan-id|flexible-vlan-tagging|encapsulation|vlan-tagging)\b/.test(line)
    || /\bunit (?!0\b)\d+\b/.test(line)
    || /\bfamily (?!ethernet-switching\b)\S+/.test(line))) return "Logical service configuration";
  if (state.bridgeServices.some((service) => service.interfaces.some((name) => name.split(".")[0] === port.name))) return "Bridge service member";
  return "";
}

function updateProtectionSummary() {
  const topology = buildMacTopology();
  const excluded = state.ports.filter((port) => quickPortExclusion(port, topology));
  const selectedExcluded = excluded.filter((port) => state.selected.has(port.name));
  document.getElementById("protectionSummary").textContent = `${state.ports.length - excluded.length} eligible access ports; ${excluded.length} protected/excluded. `
    + (selectedExcluded.length ? `Selected exclusions: ${selectedExcluded.map((port) => `${port.name}: ${quickPortExclusion(port, topology)}`).join("; ")}.` : "Quick tasks recheck the switch before committing.");
  const disabled = !state.ports.length || state.connectionInProgress || state.deploymentInProgress || state.pendingConfirmation
    || state.protectionSaving || state.protectionHost !== hostInput.value.trim().toLowerCase();
  updateSelectionActions(disabled);
  document.getElementById("selectEligiblePortsBtn").disabled = disabled;
}

function selectionActionState() {
  const selected = state.ports.filter((port) => state.selected.has(port.name));
  const commands = combinedDeploymentConfig().split(/\r?\n/).map((line) => line.trim());
  const disabled = (port) => {
    let value = port.currentDisabled;
    for (const line of commands) {
      if (line === `set interfaces ${port.name} disable`) value = true;
      if (line === `delete interfaces ${port.name} disable` || line === `delete interfaces ${port.name}`) value = false;
    }
    return value;
  };
  return {
    enable: selected.length > 0 && selected.every(disabled),
    unprotect: selected.length > 0 && selected.every((port) => state.manualProtectedPorts.includes(port.name))
  };
}

function updateSelectionActions(disabled) {
  const actions = selectionActionState();
  const admin = document.getElementById("togglePortsBtn");
  admin.disabled = disabled || !state.selected.size;
  admin.textContent = actions.enable ? "Enable selected" : "Disable selected";
  admin.className = actions.enable ? "action-enable" : "action-disable";
  admin.title = actions.enable ? "Append enable commands for all selected ports." : "Append disable commands for all selected ports. Mixed selections are disabled together.";
  const protection = document.getElementById("toggleProtectionBtn");
  protection.disabled = disabled || !state.selected.size;
  protection.textContent = actions.unprotect ? "Remove manual protection" : "Protect selected";
  protection.className = actions.unprotect ? "action-unprotect" : "action-protect";
  protection.title = actions.unprotect ? "Remove saved manual protection. Automatic uplink protection remains." : "Save manual protection for every selected port, including mixed selections.";
  const bounceError = bounceSelectionError();
  ["bouncePortsBtn", "bouncePoeBtn"].forEach((id) => {
    const button = document.getElementById(id);
    button.disabled = disabled || !!bounceError;
    button.title = bounceError || "Run a timed bounce immediately after confirmation, independently of the configuration preview.";
  });
  document.getElementById("bounceInterval").disabled = state.bounceInProgress;
}

function loadBounceIntervalPreference() {
  try {
    const interval = Number(window.localStorage.getItem(BOUNCE_INTERVAL_STORAGE_KEY));
    if (Number.isInteger(interval) && interval >= 1 && interval <= 30) {
      document.getElementById("bounceInterval").value = String(interval);
    }
  } catch (_error) {
    // Use the default when browser storage is unavailable.
  }
}

function saveBounceIntervalPreference() {
  const input = document.getElementById("bounceInterval");
  const interval = Number(input.value);
  if (!Number.isInteger(interval) || interval < 1 || interval > 30) {
    input.reportValidity();
    return;
  }
  try {
    window.localStorage.setItem(BOUNCE_INTERVAL_STORAGE_KEY, String(interval));
  } catch (_error) {
    // The selected interval still applies to this session.
  }
}

function bounceSelectionError() {
  if (!state.protectionHost || state.protectionHost !== hostInput.value.trim().toLowerCase()) return "Connect to this switch first.";
  const selected = state.ports.filter((port) => state.selected.has(port.name));
  if (!selected.length || selected.length > 48) return "Select 1 to 48 physical Ethernet ports.";
  const topology = buildMacTopology();
  const errors = selected.flatMap((port) => {
    let reason = portProtectionReason(port, topology);
    if (!/^(?:fe|ge|mge|xe|et)-\d+\/\d+\/\d+(?:\/\d+)?(?::\d+)?$/i.test(port.name)) reason = "Physical Ethernet ports only";
    else if (port.currentDisabled || port.admin === "down") reason = "Port is administratively disabled";
    return reason ? [`${port.name}: ${reason}`] : [];
  });
  return errors.join("; ");
}

async function bounceSelectedPorts(kind) {
  if (state.pendingConfirmation || state.deploymentInProgress || state.connectionInProgress || state.protectionSaving) return;
  const resultBox = document.getElementById("portBounceResults");
  const interval = Number(document.getElementById("bounceInterval").value);
  const error = bounceSelectionError() || (!Number.isInteger(interval) || interval < 1 || interval > 30
    ? "Enter a bounce interval from 1 to 30 seconds." : "");
  if (error) {
    resultBox.textContent = error;
    resultBox.className = "tool-summary error-text";
    return;
  }
  if (!["link", "poe"].includes(kind)) return;
  const ports = selectedInterfaceNames();
  const target = hostInput.value.trim();
  const label = kind === "poe" ? "PoE bounce" : "Port bounce";
  const effect = kind === "poe" ? "Power will be interrupted; connected powered devices may reboot." : "Network links will be interrupted.";
  if (!window.confirm(`${label} on ${target} for ${interval} seconds?\n\n${ports.join(", ")}\n\n${effect}\nThis runs immediately. Queued and preview configuration is not deployed.`)) return;
  const payload = connectionPayload({ ports, kind, interval });
  const connectionControls = [hostInput, usernameInput, passwordInput, savedDeviceInput, connectBtn, quickConnectBtn, refreshNowBtn];
  const previousDisabled = connectionControls.map((control) => control.disabled);
  connectionControls.forEach((control) => { control.disabled = true; });
  state.deploymentInProgress = true;
  state.bounceInProgress = true;
  resultBox.textContent = `Checking selected ports and requesting ${label.toLowerCase()} on ${target}...`;
  resultBox.className = "tool-summary";
  renderConfigQueue();
  try {
    const response = await fetch("/api/ports/bounce", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload)
    });
    const result = await response.json();
    const results = (result.results || []).map((item) => `${item.port}: ${item.ok ? `request accepted (${interval}s)` : item.error || "Request failed"}`);
    resultBox.textContent = [`${label} on ${target}`, ...results,
      response.ok && result.ok ? "The switch will restore service after the interval. Refresh inventory to check status."
        : result.error || "Request failed; check switch status before retrying."].join("\n");
    resultBox.className = response.ok && result.ok ? "tool-summary valid" : "tool-summary error-text";
    if (result.activityWarning) resultBox.textContent += `\n${result.activityWarning}`;
  } catch (error) {
    resultBox.textContent = `${label} on ${target}: response unavailable (${error.message}). Check switch status before retrying; requests may have started.`;
    resultBox.className = "tool-summary error-text";
  } finally {
    state.deploymentInProgress = false;
    state.bounceInProgress = false;
    connectionControls.forEach((control, index) => { control.disabled = previousDisabled[index]; });
    renderConfigQueue();
  }
}

async function saveSelectedProtection(protect) {
  if (state.pendingConfirmation || state.deploymentInProgress || state.connectionInProgress || state.protectionSaving || !state.selected.size) return;
  if (state.protectionHost !== hostInput.value.trim().toLowerCase()) return;
  const targetHost = state.protectionHost;
  const ports = new Set(state.manualProtectedPorts);
  state.selected.forEach((name) => protect ? ports.add(name) : ports.delete(name));
  state.protectionSaving = true;
  updatePushAvailability();
  try {
    const response = await fetch("/api/protected-ports", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(connectionPayload({ ports: [...ports] }))
    });
    const payload = await response.json();
    if (!response.ok || !payload.ok) throw new Error(payload.error || "Unable to save protection");
    if (state.protectionHost !== targetHost || hostInput.value.trim().toLowerCase() !== targetHost) return;
    state.manualProtectedPorts = payload.manualProtectedPorts;
    render(false);
    connectionStatus.textContent = protect ? "Manual port protection saved" : "Manual protection removed; automatic protection still applies";
    connectionStatus.className = "status-pill connected";
  } catch (error) {
    connectionStatus.textContent = `Protection error: ${error.message}`;
    connectionStatus.className = "status-pill error";
  } finally {
    state.protectionSaving = false;
    updatePushAvailability();
  }
}

function quickTaskValidationError(config) {
  if (!config.trim()) return "Build a configuration first.";
  if (!config.split(/\r?\n/).some((line) => line.trim() && !line.trim().startsWith("#"))) return "Build a configuration first.";
  if (state.protectionHost !== hostInput.value.trim().toLowerCase()) return "Connect to this switch before using quick tasks.";
  const topology = buildMacTopology();
  const names = new Set([...state.discoveredVlans.map((vlan) => vlan.name), ...state.bridgeServices.map((service) => service.name)]);
  const ids = new Set(state.discoveredVlans.map((vlan) => Number(vlan.value)));
  for (const line of config.split(/\r?\n/).map((value) => value.trim()).filter((value) => value && !value.startsWith("#"))) {
    if (isDescriptionOnlyDeployment(line)) continue;
    const portMatch = line.match(/^(?:set|delete) interfaces (\S+) disable$/);
    if (portMatch) {
      const port = state.ports.find((entry) => entry.name === portMatch[1]);
      const reason = port ? quickPortExclusion(port, topology) : "Port not discovered";
      if (reason) return `${portMatch[1]}: ${reason}. Use rollback protection.`;
      continue;
    }
    const vlan = line.match(/^set vlans ([A-Za-z0-9_.:-]+) vlan-id (\d+)$/);
    if (vlan && Number(vlan[2]) >= 1 && Number(vlan[2]) <= 4094) {
      if (names.has(vlan[1]) || ids.has(Number(vlan[2]))) return "Quick VLAN creation requires an unused name and ID.";
      names.add(vlan[1]); ids.add(Number(vlan[2]));
      continue;
    }
    return "This batch requires rollback protection. Quick tasks allow descriptions, new VLANs, and eligible port enable/disable only.";
  }
  return "";
}

function macRecordsForPorts(ports) {
  const records = new Map();
  ports.forEach((port) => {
    (port.learnedMacs || []).forEach((entry) => {
      const key = entry.mac.toLowerCase();
      if (!records.has(key)) {
        records.set(key, {
          mac: key,
          manufacturer: entry.manufacturer || "",
          interfaces: new Set(),
          vlans: new Set()
        });
      }
      const record = records.get(key);
      record.interfaces.add(port.name);
      if (entry.vlan) record.vlans.add(entry.vlan);
      if (!record.manufacturer && entry.manufacturer) record.manufacturer = entry.manufacturer;
    });
  });
  return Array.from(records.values());
}

function macRecordInterfaceNames(record) {
  const portOrder = new Map(state.ports.map((port, index) => [port.name, index]));
  return Array.from(record.interfaces).sort((left, right) => {
    const indexDifference = (portOrder.get(left) ?? Number.MAX_SAFE_INTEGER)
      - (portOrder.get(right) ?? Number.MAX_SAFE_INTEGER);
    return indexDifference || left.localeCompare(right, undefined, { numeric: true });
  });
}

function sortMacRecords(records) {
  const portOrder = new Map(state.ports.map((port, index) => [port.name, index]));
  const direction = learnedMacSortDirectionBtn.getAttribute("aria-pressed") === "true" ? -1 : 1;
  const valueFor = (record, field) => {
    if (field === "port") {
      return Math.min(...macRecordInterfaceNames(record).map((name) => portOrder.get(name) ?? Number.MAX_SAFE_INTEGER));
    }
    if (field === "manufacturer") return record.manufacturer || "Unknown";
    if (field === "vlan") return Array.from(record.vlans).sort()[0] || "Unknown";
    return record.mac;
  };
  const field = learnedMacSortInput.value;
  return [...records].sort((left, right) => {
    const leftValue = valueFor(left, field);
    const rightValue = valueFor(right, field);
    const primary = typeof leftValue === "number"
      ? leftValue - rightValue
      : leftValue.localeCompare(rightValue, undefined, { numeric: true, sensitivity: "base" });
    if (primary) return primary * direction;
    const portTie = valueFor(left, "port") - valueFor(right, "port");
    if (portTie) return portTie * direction;
    return left.mac.localeCompare(right.mac) * direction;
  });
}

function portsForMacScope(scope = macViewScopeInput.value) {
  const portsWithMacs = state.ports.filter((port) => port.learnedMacs?.length);
  const topology = buildMacTopology();
  if (scope === "local") return portsWithMacs.filter((port) => !uplinkCandidateReason(port, topology));
  if (scope === "uplinks") return portsWithMacs.filter((port) => uplinkCandidateReason(port, topology));
  if (scope === "all") return portsWithMacs;
  return portsWithMacs.filter((port) => state.selected.has(port.name));
}

function updateViewMacsButton() {
  const scopeCounts = Object.fromEntries(["selected", "local", "uplinks", "all"].map((scope) => {
    const ports = portsForMacScope(scope);
    return [scope, macRecordsForPorts(ports).length];
  }));
  macViewScopeInput.options[0].textContent = `Selected (${scopeCounts.selected} MACs)`;
  macViewScopeInput.options[1].textContent = `Local switch (${scopeCounts.local} MACs)`;
  macViewScopeInput.options[2].textContent = `Uplink candidates (${scopeCounts.uplinks} MACs)`;
  macViewScopeInput.options[3].textContent = `All learned (${scopeCounts.all} MACs)`;
  const macCount = scopeCounts[macViewScopeInput.value];
  viewMacsBtn.disabled = macCount === 0;
  viewMacsBtn.textContent = macCount ? `View MACs (${macCount})` : "View MACs";
}

function renderLearnedMacs() {
  const ports = portsForMacScope();
  const records = macRecordsForPorts(ports);
  const query = learnedMacSearchInput.value.trim().toLowerCase();
  const vlanFilter = learnedMacVlanFilter.value;
  const filteredRecords = sortMacRecords(records.filter((record) => {
    const interfaces = Array.from(record.interfaces);
    const vlans = Array.from(record.vlans);
    const matchesQuery = !query || record.mac.includes(query)
      || (record.manufacturer || "").toLowerCase().includes(query)
      || interfaces.some((name) => name.toLowerCase().includes(query))
      || vlans.some((vlan) => vlan.toLowerCase().includes(query));
    return matchesQuery && (!vlanFilter || vlans.includes(vlanFilter));
  }));
  learnedMacDialogContent.replaceChildren();

  if (filteredRecords.length) {
    const table = document.createElement("table");
    table.className = "learned-mac-table";
    const tableHead = document.createElement("thead");
    tableHead.innerHTML = "<tr><th scope=\"col\">Interface</th><th scope=\"col\">MAC address</th><th scope=\"col\">Manufacturer</th><th scope=\"col\">VLAN</th></tr>";
    const tableBody = document.createElement("tbody");
    const groupByPort = learnedMacSortInput.value === "port";
    const interfaceLabels = filteredRecords.map((record) => macRecordInterfaceNames(record).join(", "));
    const groupSizes = new Map();
    if (groupByPort) interfaceLabels.forEach((label) => groupSizes.set(label, (groupSizes.get(label) || 0) + 1));
    let previousInterfaceLabel = null;
    filteredRecords.forEach((record, recordIndex) => {
      const row = document.createElement("tr");
      const mac = document.createElement("td");
      const manufacturer = document.createElement("td");
      const vlan = document.createElement("td");
      const interfaceNames = macRecordInterfaceNames(record);
      const interfaceLabel = interfaceLabels[recordIndex];
      const reasons = interfaceNames.map((name) => {
        const port = state.ports.find((candidate) => candidate.name === name);
        return port ? uplinkCandidateReason(port) : "";
      }).filter(Boolean);
      mac.textContent = record.mac;
      manufacturer.textContent = record.manufacturer || "Unknown";
      vlan.textContent = Array.from(record.vlans).sort().join(", ") || "Unknown";
      if (!groupByPort || interfaceLabel !== previousInterfaceLabel) {
        const interfaces = document.createElement("th");
        interfaces.scope = "rowgroup";
        interfaces.className = "mac-interface-cell";
        interfaces.textContent = interfaceLabel;
        if (groupByPort) interfaces.rowSpan = groupSizes.get(interfaceLabel);
        if (reasons.length) interfaces.title = `Uplink candidate: ${Array.from(new Set(reasons)).join(", ")}`;
        row.appendChild(interfaces);
        row.classList.add("mac-port-group-start");
      }
      row.append(mac, manufacturer, vlan);
      tableBody.appendChild(row);
      previousInterfaceLabel = interfaceLabel;
    });
    table.append(tableHead, tableBody);
    learnedMacDialogContent.appendChild(table);
  }

  const excludedUplinkCount = macRecordsForPorts(portsForMacScope("uplinks")).length;
  const scopeNote = macViewScopeInput.value === "local" && excludedUplinkCount
    ? ` ${excludedUplinkCount} MACs on uplink candidates are excluded.`
    : "";
  learnedMacDialogSummary.textContent = `Showing ${filteredRecords.length} of ${records.length} unique learned MAC${records.length === 1 ? "" : "s"}.${scopeNote}`;
  if (!filteredRecords.length) {
    const empty = document.createElement("p");
    empty.className = "learned-mac-empty muted";
    empty.textContent = "No learned MAC addresses match these filters.";
    learnedMacDialogContent.appendChild(empty);
  }
}

function showLearnedMacs() {
  const ports = portsForMacScope();
  const vlans = Array.from(new Set(macRecordsForPorts(ports).flatMap((record) => Array.from(record.vlans))))
    .sort((left, right) => left.localeCompare(right, undefined, { numeric: true }));
  learnedMacSearchInput.value = "";
  learnedMacVlanFilter.replaceChildren(new Option("All VLANs", ""));
  vlans.forEach((vlan) => learnedMacVlanFilter.add(new Option(vlan, vlan)));
  renderLearnedMacs();

  learnedMacDialog.showModal();
}

function handlePortSelect(portName, event) {
  const mode = selectionModeInput.value;
  const currentIndex = state.ports.findIndex((port) => port.name === portName);
  const selectedPort = state.ports[currentIndex];

  if (!selectedPort) {
    return;
  }

  if (mode === "single") {
    state.selected = state.selected.size === 1 && state.selected.has(portName)
      ? new Set()
      : new Set([portName]);
    state.lastSelected = currentIndex;
  } else if (mode === "multi") {
    if (event?.shiftKey && state.lastSelected !== null) {
      const start = Math.min(state.lastSelected, currentIndex);
      const end = Math.max(state.lastSelected, currentIndex);
      state.ports.slice(start, end + 1).forEach((port) => state.selected.add(port.name));
    } else {
      if (state.selected.has(portName)) {
        state.selected.delete(portName);
      } else {
        state.selected.add(portName);
      }
    }
    state.lastSelected = currentIndex;
  } else if (state.lastSelected === null) {
    state.selected = new Set([portName]);
    state.lastSelected = currentIndex;
  } else {
    const start = Math.min(state.lastSelected, currentIndex);
    const end = Math.max(state.lastSelected, currentIndex);
    state.selected = new Set(state.ports.slice(start, end + 1).map((port) => port.name));
    state.lastSelected = null;
  }

  hydrateDesiredConfigurationFromSelection();
  render();
}

function hydrateDesiredConfigurationFromSelection() {
  if (state.selected.size !== 1) return;
  const port = state.ports.find((candidate) => state.selected.has(candidate.name));
  if (!port) return;
  if (["access", "trunk"].includes(port.currentMode)) {
    portModeInput.value = port.currentMode;
  }
  renderVlanChoices();
  renderNativeVlanChoices(port.currentNativeVlanId || "");
  const desiredVlans = new Set(port.currentVlans || []);
  let accessSelected = false;
  vlanMembershipInput.querySelectorAll('input[name="vlanMembership"]').forEach((input) => {
    const shouldSelect = desiredVlans.has(input.value) && (portModeInput.value !== "access" || !accessSelected);
    input.checked = shouldSelect;
    if (shouldSelect) accessSelected = true;
  });
  descriptionInput.value = port.currentDescription || "";
  state.configManual = false;
}

function updateSelectionSummary() {
  const list = Array.from(state.selected);
  const configuredCount = list.filter((name) => {
    const p = state.ports.find((port) => port.name === name);
    return p && (p.configured || logicalServicesForPort(name).length > 0);
  }).length;
  selectionSummary.textContent = `${list.length} selected`;
  document.getElementById("floatingSelection").hidden = !list.length;
  document.getElementById("floatingSelectionSummary").textContent = `${list.length} selected port${list.length === 1 ? "" : "s"}`;
  const floatingList = document.getElementById("floatingSelectionList");
  floatingList.replaceChildren();
  state.ports.filter((port) => state.selected.has(port.name)).forEach((port) => {
    const item = document.createElement("li");
    item.textContent = port.name;
    item.title = port.currentDescription || port.name;
    floatingList.appendChild(item);
  });
  selectionSummaryBox.replaceChildren();
  if (!list.length) {
    const empty = document.createElement("em");
    empty.textContent = "No ports selected";
    selectionSummaryBox.appendChild(empty);
    return;
  }
  const heading = document.createElement("strong");
  heading.textContent = "Selected ports";
  selectionSummaryBox.appendChild(heading);
  list.forEach((name) => {
    const port = state.ports.find((candidate) => candidate.name === name);
    const row = document.createElement("div");
    row.className = "selected-port-row";
    const portName = document.createElement("strong");
    portName.textContent = name;
    const current = document.createElement("small");
    const currentVlans = port?.currentVlans?.length ? port.currentVlans.join(", ") : "no VLAN membership found";
    const logicalServices = logicalServicesForPort(name);
    const neighborName = port?.lldpNeighbor?.systemName;
    const macCount = port?.learnedMacs?.length || 0;
    const deviceSummary = neighborName || (macCount ? `${macCount} learned MAC${macCount === 1 ? "" : "s"}` : "no connected device learned");
    const adminSummary = port?.currentDisabled ? "disabled" : (port?.oper || "unknown");
    const serviceSummary = logicalServices.length ? ` · ${logicalServices.join(", ")}` : "";
    current.textContent = `${port?.currentMode || "unknown"} · ${currentVlans}${serviceSummary} · ${adminSummary} · ${deviceSummary}`;
    row.append(portName, current);
    selectionSummaryBox.appendChild(row);
  });
  const configured = document.createElement("small");
  configured.textContent = `${configuredCount} configured`;
  selectionSummaryBox.appendChild(configured);
}

function updateIntendedChangeSummary() {
  const ports = state.ports.filter((port) => state.selected.has(port.name));
  const vlanNames = parseMembershipInput();
  const vlanLabels = vlanNames.map((name) => {
    const vlan = state.vlans.find((entry) => entry.name === name);
    return vlan ? `${vlan.name} (${vlan.value})` : name;
  });
  const upCount = ports.filter((port) => port.oper === "up").length;
  const downCount = ports.filter((port) => port.oper === "down").length;
  const rows = [
    ["Mode", portModeInput.value === "access" ? "Access" : "Trunk"],
    ["Native VLAN", portModeInput.value === "trunk" && nativeVlanInput.value
      ? `VLAN ${nativeVlanInput.value}` : "None"],
    ["VLANs", vlanLabels.length ? vlanLabels.join(", ") : "None selected"],
    ["Link state", `${upCount} up · ${downCount} down · ${ports.length - upCount - downCount} unknown`],
    ["Description", descriptionInput.value.trim() || "No change"]
  ];

  const list = document.createElement("dl");
  rows.forEach(([term, value]) => {
    const dt = document.createElement("dt");
    dt.textContent = term;
    const dd = document.createElement("dd");
    dd.textContent = value;
    list.append(dt, dd);
  });
  intendedChangeSummary.replaceChildren(list);
}

function parseMembershipInput() {
  return Array.from(vlanMembershipInput.querySelectorAll('input[name="vlanMembership"]:checked'))
    .map((input) => input.value);
}

function renderNativeVlanChoices(preferredValue = nativeVlanInput.value) {
  const desiredValue = String(preferredValue || "");
  nativeVlanInput.replaceChildren(new Option("None (tagged traffic only)", ""));
  state.vlans.forEach((vlan) => {
    nativeVlanInput.add(new Option(`${vlan.name} (VLAN ${vlan.value})`, String(vlan.value)));
  });
  if (desiredValue && !Array.from(nativeVlanInput.options).some((option) => option.value === desiredValue)) {
    nativeVlanInput.add(new Option(`VLAN ${desiredValue} (not discovered)`, desiredValue));
  }
  const isTrunk = portModeInput.value === "trunk";
  nativeVlanInput.disabled = !isTrunk;
  nativeVlanInput.value = isTrunk ? desiredValue : "";
}

function renderVlanChoices() {
  const selectedValues = new Set(parseMembershipInput());
  const isAccess = portModeInput.value === "access";
  vlanMembershipInput.replaceChildren();

  if (!state.vlans.length) {
    const empty = document.createElement("span");
    empty.className = "muted";
    empty.textContent = "No VLANs discovered";
    vlanMembershipInput.appendChild(empty);
  } else {
    state.vlans.forEach((vlan, index) => {
      const label = document.createElement("label");
      label.className = "vlan-option";
      const input = document.createElement("input");
      input.type = isAccess ? "radio" : "checkbox";
      input.name = "vlanMembership";
      input.value = vlan.name;
      input.checked = selectedValues.has(vlan.name) && (!isAccess || !vlanMembershipInput.querySelector("input:checked"));
      input.id = `vlan-${index}`;
      const text = document.createElement("span");
      text.textContent = vlan.name;
      const tag = document.createElement("small");
      tag.textContent = `VLAN ${vlan.value}`;
      label.append(input, text, tag);
      vlanMembershipInput.appendChild(label);
    });
  }
  renderNativeVlanChoices();
}

function updateConfig(force = false) {
  if (state.configManual && !force) return;
  const selectedPorts = state.ports.filter((port) => state.selected.has(port.name));
  const lines = [];
  lines.push(`# Target: ${deviceNameInput.value || "switch"}`);
  lines.push(`# SSH: ${usernameInput.value || "user"}@${hostInput.value || "host"}`);
  lines.push("");

  selectedPorts.forEach((port) => lines.push(...buildDesiredLines(port, descriptionInput.value.trim()), ""));

  replaceConfig(lines.join("\n"), force);
}

function updateConnectionHint() {
  connectionHint.textContent = `ssh ${usernameInput.value || "netops"}@${hostInput.value || "host"}`;
}

function getMoveMappings() {
  const delta = parseInt(shiftOffsetInput.value || "0", 10) || 0;
  const selectedPorts = state.ports.filter((port) => state.selected.has(port.name));
  if (!selectedPorts.length) return { error: "Select one or more configured source ports.", mappings: [] };
  if (!delta) return { error: "Destination offset cannot be zero.", mappings: [] };
  const mappings = selectedPorts.map((source) => ({ source, destination: state.ports[source.index + delta] }));
  if (mappings.some(({ destination }) => !destination)) {
    return { error: "At least one destination falls outside the discovered port list.", mappings: [] };
  }
  if (mappings.some(({ source }) => !source.currentSetLines?.length)) {
    return { error: "Every source must have discovered interface configuration.", mappings: [] };
  }
  return { error: "", mappings };
}

function descriptionSiteCode(description) {
  return description.match(/^\d{1,3}_([^_]+)_/)?.[1]?.toUpperCase() || "";
}

function rawPhysicalPortNumber(interfaceName) {
  const match = interfaceName.match(/\/(\d+)(?::\d+)?(?:\.\d+)?$/);
  return match ? match[1] : "";
}

function physicalPortNumber(interfaceName) {
  const portNumber = rawPhysicalPortNumber(interfaceName);
  return portNumber ? portNumber.padStart(2, "0") : "";
}

function interfacePortNumber(interfaceName) {
  return physicalPortNumber(interfaceName) || interfaceName.match(/(\d+)$/)?.[1]?.padStart(2, "0") || "00";
}

function unusedDescription(port, fallbackSiteCode) {
  const hostnameSiteCode = deviceNameInput.value.match(/[A-Za-z0-9]+/)?.[0]?.toUpperCase() || "SITE";
  const siteCode = descriptionSiteCode(port.currentDescription || "") || fallbackSiteCode || hostnameSiteCode;
  return `${interfacePortNumber(port.name)}_${siteCode}_UNUSED`;
}

function movedDescription(description, destinationName) {
  const descriptionNumber = description.match(/^(\d+)(?=_)/)?.[1] || "";
  const destinationNumber = rawPhysicalPortNumber(destinationName);
  if (!descriptionNumber || !destinationNumber) return description;
  const replacement = destinationNumber.padStart(
    Math.max(descriptionNumber.length, destinationNumber.length),
    "0"
  );
  return `${replacement}${description.slice(descriptionNumber.length)}`;
}

function moveDescriptionChanges(mappings) {
  if (!moveUpdateDescriptionNumberInput.checked) return [];
  return mappings.flatMap(({ source, destination }) => {
    const currentDescription = source.currentDescription || "";
    const destinationDescription = movedDescription(currentDescription, destination.name);
    return destinationDescription && destinationDescription !== currentDescription
      ? [{ source, destination, currentDescription, destinationDescription }]
      : [];
  });
}

function updateMoveSummary() {
  const { error, mappings } = getMoveMappings();
  const descriptionChanges = error ? [] : moveDescriptionChanges(mappings);
  const renumberSummary = moveUpdateDescriptionNumberInput.checked
    ? descriptionChanges.length
      ? ` · ${descriptionChanges.length} destination description${descriptionChanges.length === 1 ? "" : "s"} will be renumbered`
      : " · no destination description numbers would change"
    : "";
  moveSummary.textContent = error || `${mappings.map(({ source, destination }) => `${source.name} → ${destination.name}`).join(" · ")}${renumberSummary}`;
  moveSummary.className = `tool-summary ${error ? "muted" : "valid"}`;
}

function buildMoveConfiguration() {
  if (state.pendingConfirmation || state.deploymentInProgress) return;
  const { error, mappings } = getMoveMappings();
  if (error) {
    connectionStatus.textContent = error;
    connectionStatus.className = "status-pill error";
    return;
  }
  const destinationNames = new Set(mappings.map(({ destination }) => destination.name));
  const sourceNames = new Set(mappings.map(({ source }) => source.name));
  const retiredSources = [...sourceNames].filter((name) => !destinationNames.has(name));
  const fallbackSiteCode = mappings
    .map(({ source }) => descriptionSiteCode(source.currentDescription || ""))
    .find(Boolean) || "";
  const descriptionChanges = moveDescriptionChanges(mappings);
  const mappingText = mappings.map(({ source, destination }) => `${source.name} → ${destination.name}`).join("\n");
  const retiredText = retiredSources.length
    ? `\n\nRetired: ${retiredSources.map((name) => {
      const source = state.ports.find((port) => port.name === name);
      return `${name} → ${unusedDescription(source, fallbackSiteCode)}`;
    }).join(", ")}`
    : "";
  const descriptionText = moveUpdateDescriptionNumberInput.checked
    ? descriptionChanges.length
      ? `\n\nDescriptions:\n${descriptionChanges.map(({ currentDescription, destinationDescription }) => `${currentDescription} → ${destinationDescription}`).join("\n")}`
      : "\n\nNo destination description numbers would change."
    : "";
  if (!window.confirm(`Build a move that replaces destination configuration?\n\n${mappingText}${descriptionText}${retiredText}\n\nThe preview will clear every destination before copying source configuration. Retired sources will be cleared, disabled, and renamed.`)) return;

  const lines = ["# Interface configuration move", ...mappings.map(({ source, destination }) => `# ${source.name} -> ${destination.name}`), ""];
  const affectedNames = new Set([...sourceNames, ...destinationNames]);
  const bridgeDeletes = [];
  state.bridgeServices.forEach((service) => {
    service.interfaces.forEach((interfaceName) => {
      const separator = interfaceName.lastIndexOf(".");
      const portName = separator > 0 ? interfaceName.slice(0, separator) : interfaceName;
      if (affectedNames.has(portName)) {
        bridgeDeletes.push(`delete vlans ${service.name} interface ${interfaceName}`);
      }
    });
  });
  if (bridgeDeletes.length) lines.push("# Remove logical service references from affected ports", ...bridgeDeletes, "");
  destinationNames.forEach((name) => lines.push(`delete interfaces ${name}`));
  lines.push("");
  mappings.forEach(({ source, destination }) => {
    source.currentSetLines.forEach((line) => {
      const destinationDescription = movedDescription(source.currentDescription || "", destination.name);
      if (moveUpdateDescriptionNumberInput.checked
          && destinationDescription !== (source.currentDescription || "")
          && /^set interfaces\s+\S+\s+description\b/.test(line)) {
        lines.push(buildDescriptionLine(destination, destinationDescription));
      } else {
        lines.push(line.replace(/^set interfaces\s+\S+/, `set interfaces ${destination.name}`));
      }
    });
    state.bridgeServices.forEach((service) => {
      service.interfaces.forEach((interfaceName) => {
        const separator = interfaceName.lastIndexOf(".");
        if (separator < 1 || interfaceName.slice(0, separator) !== source.name) return;
        const unit = interfaceName.slice(separator + 1);
        lines.push(`set vlans ${service.name} interface ${destination.name}.${unit}`);
      });
    });
  });
  if (retiredSources.length) {
    lines.push("", "# Retire source ports that are not also destinations");
    retiredSources.forEach((name) => {
      const source = state.ports.find((port) => port.name === name);
      lines.push(`delete interfaces ${name}`);
      lines.push(`set interfaces ${name} disable`);
      lines.push(`set interfaces ${name} description "${escapeDescription(unusedDescription(source, fallbackSiteCode))}"`);
    });
  }
  replaceConfig(lines.join("\n"), true);
  connectionStatus.textContent = `Built move configuration for ${mappings.length} interface${mappings.length === 1 ? "" : "s"}`;
  connectionStatus.className = "status-pill";
  activateWorkspaceTab("review", true);
}

function populateSeriesStartPorts() {
  const previous = seriesStartPort.value;
  seriesStartPort.replaceChildren(new Option("Select a start port", ""));
  state.ports.forEach((port) => seriesStartPort.add(new Option(port.name, port.name)));
  if (state.ports.some((port) => port.name === previous)) seriesStartPort.value = previous;
}

function escapeDescription(value) {
  return value.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}

function seriesNumberWidth(firstNumber, count) {
  if (!seriesPadNumbersInput.checked) return 0;
  const finalNumber = firstNumber + Math.max(count, 1) - 1;
  return Math.max(2, String(Math.max(Math.abs(firstNumber), Math.abs(finalNumber))).length);
}

function seriesDescription(port, seriesNumber, numberWidth = 0) {
  const portNumber = seriesIncludePortNumberInput.checked ? physicalPortNumber(port.name) : "";
  const portPrefix = portNumber ? `${portNumber}_` : "";
  const formattedNumber = numberWidth ? String(seriesNumber).padStart(numberWidth, "0") : String(seriesNumber);
  return `${portPrefix}${seriesDescriptionInput.value.trim()}${formattedNumber}${seriesPostfixInput.value.trim()}`;
}

function updateSeriesDescriptionPreview() {
  const port = state.ports.find((candidate) => candidate.name === seriesStartPort.value) || { name: "ge-0/0/1" };
  const firstNumber = parseInt(seriesStartNumberInput.value || "0", 10);
  const count = parseInt(seriesCountInput.value || "1", 10);
  const numberWidth = seriesNumberWidth(firstNumber, count);
  const scopeText = seriesConfigurationScopeInput.checked
    ? "description plus Configure-tab mode/VLAN/native VLAN commands"
    : "description command only";
  seriesDescriptionPreview.replaceChildren(
    "Example description: ",
    Object.assign(document.createElement("code"), { textContent: seriesDescription(port, firstNumber, numberWidth) }),
    ` — ${scopeText}`
  );
}

function parseDescriptionPattern(pattern) {
  const tokens = [];
  let literal = "";
  const flushLiteral = () => {
    if (!literal) return;
    tokens.push({ type: "literal", value: literal });
    literal = "";
  };

  for (let index = 0; index < pattern.length;) {
    const character = pattern[index];
    if (character === "{") {
      if (pattern[index + 1] === "{") {
        literal += "{";
        index += 2;
        continue;
      }
      const closingBrace = pattern.indexOf("}", index + 1);
      if (closingBrace < 0) throw new Error("The pattern has an opening brace without a closing brace.");
      const name = pattern.slice(index + 1, closingBrace);
      if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(name)) {
        throw new Error("Section names must start with a letter and contain only letters, numbers, or underscores.");
      }
      flushLiteral();
      tokens.push({ type: "section", name });
      index = closingBrace + 1;
      continue;
    }
    if (character === "}") {
      if (pattern[index + 1] === "}") {
        literal += "}";
        index += 2;
        continue;
      }
      throw new Error("The pattern has a closing brace without an opening brace.");
    }
    literal += character;
    index += 1;
  }
  flushLiteral();
  return tokens;
}

function escapeRegularExpression(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function compileDescriptionTransform(sourcePattern, targetPattern) {
  if (!sourcePattern) throw new Error("Enter a current description pattern.");
  const sourceTokens = parseDescriptionPattern(sourcePattern);
  const targetTokens = parseDescriptionPattern(targetPattern);
  const sectionNames = sourceTokens
    .filter((token) => token.type === "section")
    .map((token) => token.name);
  if (new Set(sectionNames).size !== sectionNames.length) {
    throw new Error("Each named section can appear only once in the current pattern.");
  }
  if (sourceTokens.some((token, index) => (
    token.type === "section" && sourceTokens[index + 1]?.type === "section"
  ))) {
    throw new Error("Put literal text between adjacent named sections so their boundary is unambiguous.");
  }
  const unknownSection = targetTokens.find((token) => (
    token.type === "section" && !sectionNames.includes(token.name)
  ));
  if (unknownSection) {
    throw new Error(`The new pattern uses {${unknownSection.name}}, which is not captured by the current pattern.`);
  }

  const expression = sourceTokens.map((token) => (
    token.type === "literal" ? escapeRegularExpression(token.value) : "(.+?)"
  )).join("");
  const matcher = new RegExp(`^${expression}$`);
  return (description) => {
    const match = description.match(matcher);
    if (!match) return null;
    const sections = new Map(sectionNames.map((name, index) => [name, match[index + 1]]));
    return targetTokens.map((token) => (
      token.type === "literal" ? token.value : sections.get(token.name)
    )).join("");
  };
}

function transformDescriptionSections(description, sourcePattern, targetPattern) {
  return compileDescriptionTransform(sourcePattern, targetPattern)(description);
}

function descriptionTransformPlan() {
  const selectedPorts = state.ports.filter((port) => state.selected.has(port.name));
  try {
    const transform = compileDescriptionTransform(
      descriptionTransformSourceInput.value,
      descriptionTransformTargetInput.value
    );
    const changes = [];
    const unchanged = [];
    const unmatched = [];
    selectedPorts.forEach((port) => {
      const currentDescription = port.currentDescription || "";
      const transformedDescription = transform(currentDescription);
      if (transformedDescription === null) {
        unmatched.push(port);
      } else if (transformedDescription === currentDescription) {
        unchanged.push(port);
      } else {
        changes.push({ port, currentDescription, transformedDescription });
      }
    });
    return { selectedPorts, changes, unchanged, unmatched, error: "" };
  } catch (error) {
    return { selectedPorts, changes: [], unchanged: [], unmatched: [], error: error.message };
  }
}

function updateDescriptionTransformPreview() {
  const plan = descriptionTransformPlan();
  descriptionTransformPreview.replaceChildren();
  descriptionTransformPreview.className = "tool-summary";
  buildDescriptionTransformBtn.disabled = !!plan.error || !plan.changes.length;

  if (plan.error) {
    descriptionTransformPreview.classList.add("error-text");
    descriptionTransformPreview.textContent = plan.error;
    return;
  }
  if (!plan.selectedPorts.length) {
    descriptionTransformPreview.classList.add("muted");
    descriptionTransformPreview.append(
      "Select ports to preview. Example: ",
      Object.assign(document.createElement("code"), { textContent: "01*EWT_317 → 01_WT_*317" })
    );
    return;
  }

  const summary = document.createElement("div");
  summary.className = plan.changes.length ? "transform-counts valid" : "transform-counts";
  summary.textContent = `${plan.changes.length} change${plan.changes.length === 1 ? "" : "s"} · ${plan.unchanged.length} unchanged · ${plan.unmatched.length} skipped`;
  descriptionTransformPreview.appendChild(summary);
  plan.changes.slice(0, 4).forEach(({ port, currentDescription, transformedDescription }) => {
    const example = document.createElement("div");
    example.className = "description-transform-example";
    const portName = document.createElement("strong");
    portName.textContent = port.name;
    const before = document.createElement("code");
    before.textContent = currentDescription || "(no description)";
    const after = document.createElement("code");
    after.textContent = transformedDescription || "(delete description)";
    example.append(portName, before, document.createTextNode("→"), after);
    descriptionTransformPreview.appendChild(example);
  });
  if (plan.changes.length > 4) {
    const remaining = document.createElement("div");
    remaining.className = "muted";
    remaining.textContent = `...and ${plan.changes.length - 4} more change${plan.changes.length - 4 === 1 ? "" : "s"}`;
    descriptionTransformPreview.appendChild(remaining);
  }
  if (!plan.changes.length) descriptionTransformPreview.classList.add("muted");
}

function buildDescriptionTransformConfiguration() {
  if (state.pendingConfirmation || state.deploymentInProgress) return;
  const plan = descriptionTransformPlan();
  if (plan.error || !plan.changes.length) {
    connectionStatus.textContent = plan.error || "No selected descriptions would change";
    connectionStatus.className = "status-pill error";
    updateDescriptionTransformPreview();
    return;
  }
  const lines = ["# Description section transform", ""];
  plan.changes.forEach(({ port, transformedDescription }) => {
    lines.push(
      transformedDescription
        ? buildDescriptionLine(port, transformedDescription)
        : `delete interfaces ${port.name} description`,
      ""
    );
  });
  replaceConfig(lines.join("\n"), true);
  const skippedText = plan.unmatched.length ? `; skipped ${plan.unmatched.length} nonmatching port${plan.unmatched.length === 1 ? "" : "s"}` : "";
  connectionStatus.textContent = `Built ${plan.changes.length} description change${plan.changes.length === 1 ? "" : "s"}${skippedText}`;
  connectionStatus.className = "status-pill";
  activateWorkspaceTab("review", true);
}

function buildDesiredLines(port, description) {
  const vlanMembers = parseMembershipInput();
  const nativeVlanId = portModeInput.value === "trunk" ? nativeVlanInput.value : "";
  const nativeVlan = state.vlans.find((vlan) => String(vlan.value) === nativeVlanId);
  if (nativeVlan && !vlanMembers.includes(nativeVlan.name)) vlanMembers.push(nativeVlan.name);
  const modeKeyword = port.modeKeyword || state.modeKeyword || "interface-mode";
  const lines = [`set interfaces ${port.name} unit 0 family ethernet-switching ${modeKeyword} ${portModeInput.value}`];
  if (port.currentNativeVlanId && port.currentNativeVlanId !== nativeVlanId) {
    lines.push(`delete interfaces ${port.name} native-vlan-id`);
  }
  if (nativeVlanId) lines.push(`set interfaces ${port.name} native-vlan-id ${nativeVlanId}`);
  if (port.currentVlans?.length) {
    lines.push(`delete interfaces ${port.name} unit 0 family ethernet-switching vlan members`);
  }
  if (portModeInput.value === "access" && vlanMembers.length) {
    lines.push(`set interfaces ${port.name} unit 0 family ethernet-switching vlan members ${vlanMembers[0]}`);
  } else if (vlanMembers.length) {
    lines.push(`set interfaces ${port.name} unit 0 family ethernet-switching vlan members [${vlanMembers.join(" ")}]`);
  }
  if (description) lines.push(buildDescriptionLine(port, description));
  return lines;
}

function buildDescriptionLine(port, description) {
  return `set interfaces ${port.name} description "${escapeDescription(description)}"`;
}

function buildSeriesConfiguration() {
  if (state.pendingConfirmation || state.deploymentInProgress) return;
  const startIndex = state.ports.findIndex((port) => port.name === seriesStartPort.value);
  const count = parseInt(seriesCountInput.value || "0", 10);
  const firstNumber = parseInt(seriesStartNumberInput.value || "0", 10);
  if (startIndex < 0 || count < 1 || startIndex + count > state.ports.length) {
    connectionStatus.textContent = "Choose a valid start port and count within the discovered port list";
    connectionStatus.className = "status-pill error";
    return;
  }
  const prefix = seriesDescriptionInput.value.trim();
  const ports = state.ports.slice(startIndex, startIndex + count);
  if (seriesIncludePortNumberInput.checked && ports.some((port) => !physicalPortNumber(port.name))) {
    connectionStatus.textContent = "A selected interface does not have a recognizable physical port number";
    connectionStatus.className = "status-pill error";
    return;
  }
  const includeSharedConfiguration = seriesConfigurationScopeInput.checked;
  const scopeLabel = includeSharedConfiguration ? "descriptions and shared switching config" : "descriptions only";
  const numberWidth = seriesNumberWidth(firstNumber, count);
  const lines = [`# Numbered series (${scopeLabel}): ${prefix || "Port"} ${firstNumber}-${firstNumber + count - 1}`, ""];
  ports.forEach((port, index) => {
    const description = seriesDescription(port, firstNumber + index, numberWidth);
    const portLines = includeSharedConfiguration
      ? buildDesiredLines(port, description)
      : [buildDescriptionLine(port, description)];
    lines.push(...portLines, "");
  });
  replaceConfig(lines.join("\n"), true);
  state.selected = new Set(ports.map((port) => port.name));
  render();
  connectionStatus.textContent = `Built series configuration for ${ports.length} interface${ports.length === 1 ? "" : "s"}`;
  connectionStatus.className = "status-pill";
  activateWorkspaceTab("review", true);
}

function createVlanCommand() {
  if (state.pendingConfirmation || state.deploymentInProgress) return;
  const name = newVlanNameInput.value.trim();
  const vlanId = parseInt(newVlanIdInput.value || "0", 10);
  if (!/^[A-Za-z0-9_.:-]+$/.test(name) || vlanId < 1 || vlanId > 4094) {
    connectionStatus.textContent = "Enter a VLAN name using letters, numbers, . _ : - and an ID from 1 to 4094";
    connectionStatus.className = "status-pill error";
    return;
  }
  if (state.vlans.some((vlan) => vlan.name === name || Number(vlan.value) === vlanId)) {
    connectionStatus.textContent = "That VLAN name or ID already exists in discovery data";
    connectionStatus.className = "status-pill error";
    return;
  }
  appendConfigLines([`set vlans ${name} vlan-id ${vlanId}`]);
  syncAvailableVlans();
  newVlanNameInput.value = "";
  newVlanIdInput.value = "";
  connectionStatus.textContent = `Added VLAN ${name} (${vlanId}) to the preview`;
  connectionStatus.className = "status-pill";
  activateWorkspaceTab("review", true);
}

function populateServiceChoices() {
  const selectedVlan = irbVlanInput.value;
  irbVlanInput.replaceChildren(new Option(state.vlans.length ? "Select a VLAN" : "Connect to discover VLANs", ""));
  state.vlans.forEach((vlan) => {
    const routed = vlan.l3Interface ? ` — ${vlan.l3Interface}` : "";
    irbVlanInput.add(new Option(`${vlan.name} (${vlan.value})${routed}`, vlan.name));
  });
  if (state.vlans.some((vlan) => vlan.name === selectedVlan)) irbVlanInput.value = selectedVlan;

  [qinqCustomerPortInput, qinqUplinkPortInput].forEach((select, index) => {
    const previous = select.value;
    select.replaceChildren(new Option(index === 0 ? "Select customer port" : "Select uplink port", ""));
    state.ports.forEach((port) => select.add(new Option(
      port.currentDescription ? `${port.name} — ${port.currentDescription}` : port.name,
      port.name
    )));
    if (state.ports.some((port) => port.name === previous)) select.value = previous;
  });

  const previousServiceSource = logicalServiceSourceInput.value;
  const hasMovableServices = state.bridgeServices.some((service) => service.interfaces.some((interfaceName) => (
    interfaceName.slice(interfaceName.lastIndexOf(".") + 1) !== "0"
  )));
  logicalServiceSourceInput.replaceChildren(new Option(
    hasMovableServices ? "Select a logical service" : "No nonzero logical services discovered",
    ""
  ));
  state.bridgeServices.forEach((service, serviceIndex) => {
    service.interfaces.forEach((interfaceName, memberIndex) => {
      const portName = interfaceName.slice(0, interfaceName.lastIndexOf("."));
      const unit = interfaceName.slice(interfaceName.lastIndexOf(".") + 1);
      if (unit === "0") return;
      const port = state.ports.find((entry) => entry.name === portName);
      const unitLines = (port?.currentSetLines || []).filter((line) => line.includes(` unit ${unit} `));
      const role = unitLines.some((line) => line.includes(" vlan-tags outer "))
        ? "uplink"
        : unitLines.some((line) => line.includes(" input-vlan-map push")) ? "customer" : "logical";
      logicalServiceSourceInput.add(new Option(
        `${service.name} — ${interfaceName} (${role})`,
        `${serviceIndex}:${memberIndex}`
      ));
    });
  });
  if (Array.from(logicalServiceSourceInput.options).some((option) => option.value === previousServiceSource)) {
    logicalServiceSourceInput.value = previousServiceSource;
  }
  updateIrbSummary();
  updateQinqSummary();
  updateLogicalServiceMoveSummary();
}

function selectedLogicalServiceMember() {
  const match = logicalServiceSourceInput.value.match(/^(\d+):(\d+)$/);
  if (!match) return null;
  const service = state.bridgeServices[Number(match[1])];
  const interfaceName = service?.interfaces?.[Number(match[2])];
  if (!service || !interfaceName || !interfaceName.includes(".")) return null;
  const separator = interfaceName.lastIndexOf(".");
  const unit = interfaceName.slice(separator + 1);
  if (!/^\d+$/.test(unit) || Number(unit) < 1 || Number(unit) > 16384) return null;
  return {
    service,
    interfaceName,
    portName: interfaceName.slice(0, separator),
    unit
  };
}

function logicalServiceMoveError() {
  const source = selectedLogicalServiceMember();
  const destinations = selectedInterfaceNames();
  if (!source) return "Select a discovered logical service and source unit.";
  if (destinations.length !== 1) return "Select exactly one destination port in the inventory.";
  const destination = destinations[0];
  if (destination === source.portName) return "Select a destination different from the current service port.";
  const sourcePort = state.ports.find((port) => port.name === source.portName);
  const unitMarker = ` unit ${source.unit} `;
  if (!(sourcePort?.currentSetLines || []).some((line) => line.includes(unitMarker))) {
    return `${source.interfaceName} has no discovered logical-unit configuration to copy.`;
  }
  const destinationPort = state.ports.find((port) => port.name === destination);
  if ((destinationPort?.currentSetLines || []).some((line) => line.includes(unitMarker))) {
    return `${destination}.${source.unit} already has interface configuration.`;
  }
  const destinationMember = `${destination}.${source.unit}`;
  const existingOwner = state.bridgeServices.find((service) => service.interfaces.includes(destinationMember));
  if (existingOwner) return `${destinationMember} is already a member of ${existingOwner.name}.`;
  const incompatibleEncapsulation = (destinationPort?.currentSetLines || []).find((line) => (
    /^set interfaces\s+\S+\s+encapsulation\s+/.test(line)
    && !line.endsWith(" encapsulation flexible-ethernet-services")
  ));
  if (incompatibleEncapsulation) {
    return `${destination} uses another physical encapsulation; this move will not replace it.`;
  }
  if ((destinationPort?.currentSetLines || []).some((line) => /\s+vlan-tagging$/.test(line))) {
    return `${destination} uses vlan-tagging instead of flexible-vlan-tagging.`;
  }
  return "";
}

function updateLogicalServiceMoveSummary() {
  const source = selectedLogicalServiceMember();
  const destination = selectedInterfaceNames()[0];
  const error = logicalServiceMoveError();
  logicalServiceMoveSummary.textContent = error || `${source.service.name}: ${source.interfaceName} → ${destination}.${source.unit}`;
  logicalServiceMoveSummary.className = `tool-summary ${error ? "muted" : "valid"}`;
}

function buildLogicalServiceMove() {
  if (state.pendingConfirmation || state.deploymentInProgress) return;
  const source = selectedLogicalServiceMember();
  const destination = selectedInterfaceNames()[0];
  const error = logicalServiceMoveError();
  if (error) {
    connectionStatus.textContent = error;
    connectionStatus.className = "status-pill error";
    return;
  }
  const sourcePort = state.ports.find((port) => port.name === source.portName);
  const unitMarker = ` unit ${source.unit} `;
  const physicalPrerequisites = sourcePort.currentSetLines.filter((line) => {
    const remainder = line.replace(/^set interfaces\s+\S+\s+/, "");
    return remainder === "flexible-vlan-tagging"
      || remainder === "encapsulation flexible-ethernet-services"
      || /^mtu \d+$/.test(remainder);
  });
  const unitLines = sourcePort.currentSetLines.filter((line) => line.includes(unitMarker));
  const rewrittenLines = [...physicalPrerequisites, ...unitLines]
    .map((line) => line.replace(/^set interfaces\s+\S+/, `set interfaces ${destination}`));
  const lines = [
    `# Move ${source.service.name} logical unit ${source.unit}: ${source.portName} -> ${destination}`,
    `delete vlans ${source.service.name} interface ${source.interfaceName}`,
    ...rewrittenLines,
    `set vlans ${source.service.name} interface ${destination}.${source.unit}`,
    `delete interfaces ${source.portName} unit ${source.unit}`
  ];
  replaceConfig(lines.join("\n"), true);
  connectionStatus.textContent = `Built logical-unit move for ${source.service.name} to ${destination}.${source.unit}`;
  connectionStatus.className = "status-pill";
  activateWorkspaceTab("review", true);
}

function validIpv4Prefix(value) {
  const match = value.trim().match(/^(\d{1,3}(?:\.\d{1,3}){3})\/(\d{1,2})$/);
  if (!match || Number(match[2]) > 32) return false;
  return match[1].split(".").every((octet) => Number(octet) <= 255);
}

function irbConflict() {
  const vlan = state.vlans.find((entry) => entry.name === irbVlanInput.value);
  const unit = Number(irbUnitInput.value);
  if (!vlan || !Number.isInteger(unit)) return "";
  const intendedInterface = `irb.${unit}`;
  if (vlan.l3Interface && vlan.l3Interface.toLowerCase() !== intendedInterface) {
    return `${vlan.name} is already bound to ${vlan.l3Interface}.`;
  }
  const owningVlan = state.vlans.find((entry) => entry.name !== vlan.name
    && entry.l3Interface?.toLowerCase() === intendedInterface);
  if (owningVlan) return `${intendedInterface} is already bound to ${owningVlan.name}.`;
  const existingUnit = state.irbUnits.find((entry) => Number(entry.unit) === unit);
  const address = irbAddressInput.value.trim();
  if (existingUnit?.addresses?.length && address && !existingUnit.addresses.includes(address)) {
    return `${intendedInterface} already has ${existingUnit.addresses.join(", ")}; this builder will not add a secondary address.`;
  }
  return "";
}

function updateIrbSummary() {
  const vlan = state.vlans.find((entry) => entry.name === irbVlanInput.value);
  if (!vlan) {
    irbSummary.textContent = state.vlans.length ? "Select a VLAN to begin." : "Connect to discover VLANs first.";
    irbSummary.className = "tool-summary muted";
    return;
  }
  const unit = irbUnitInput.value;
  const address = irbAddressInput.value.trim();
  const conflict = irbConflict();
  irbSummary.textContent = conflict || `${vlan.name} (${vlan.value}) → irb.${unit || "?"} → ${address || "IPv4 prefix required"}`;
  irbSummary.className = `tool-summary ${conflict ? "error-text" : (unit && validIpv4Prefix(address) ? "valid" : "muted")}`;
}

function buildIrbConfiguration() {
  if (state.pendingConfirmation || state.deploymentInProgress) return;
  const vlan = state.vlans.find((entry) => entry.name === irbVlanInput.value);
  const unit = Number(irbUnitInput.value);
  const address = irbAddressInput.value.trim();
  const conflict = irbConflict();
  if (!vlan || !irbUnitInput.value.trim() || !Number.isInteger(unit) || unit < 0 || unit > 16384 || !validIpv4Prefix(address) || conflict) {
    connectionStatus.textContent = conflict || "Select a VLAN, enter an IRB unit from 0 to 16384, and enter an IPv4 prefix such as 192.0.2.1/24";
    connectionStatus.className = "status-pill error";
    irbSummary.textContent = connectionStatus.textContent;
    irbSummary.className = "tool-summary error-text";
    return;
  }
  appendConfigLines([
    `# IRB gateway for ${vlan.name} (${vlan.value})`,
    `set interfaces irb unit ${unit} family inet address ${address}`,
    `set vlans ${vlan.name} l3-interface irb.${unit}`
  ]);
  connectionStatus.textContent = `Appended IRB gateway irb.${unit} for ${vlan.name}`;
  connectionStatus.className = "status-pill";
  activateWorkspaceTab("review", true);
}

function qinqValues() {
  return {
    customer: qinqCustomerPortInput.value,
    uplink: qinqUplinkPortInput.value,
    serviceName: qinqServiceNameInput.value.trim(),
    outer: Number(qinqOuterTagInput.value),
    inner: Number(qinqInnerTagInput.value),
    mtu: Number(qinqMtuInput.value)
  };
}

function qinqValidationError() {
  const values = qinqValues();
  if (!values.customer || !values.uplink) return "Choose both the customer-facing and uplink ports.";
  if (values.customer === values.uplink) return "Customer-facing and uplink ports must be different.";
  if (!/^[A-Za-z0-9_.:-]+$/.test(values.serviceName)) return "Enter a bridge VLAN name using letters, numbers, . _ : or -.";
  const existingService = state.bridgeServices.find((service) => service.name === values.serviceName);
  if (state.vlans.some((vlan) => vlan.name === values.serviceName) && !existingService) {
    return `${values.serviceName} already exists as a tagged VLAN; use a unique bridge VLAN name.`;
  }
  if (![values.outer, values.inner].every((tag) => Number.isInteger(tag) && tag >= 1 && tag <= 4094)) {
    return "Outer and inner VLAN tags must be from 1 to 4094.";
  }
  if (!Number.isInteger(values.mtu) || values.mtu < 1518 || values.mtu > 16384) {
    return "Physical MTU must be from 1518 to 16384 bytes.";
  }
  const intendedMembers = [`${values.customer}.${values.inner}`, `${values.uplink}.${values.inner}`];
  if (existingService && (existingService.interfaces.length !== intendedMembers.length
    || existingService.interfaces.some((name) => !intendedMembers.includes(name)))) {
    return `${values.serviceName} already has different logical interface members.`;
  }
  return "";
}

function buildQinqLines(values) {
  const customerUnit = `${values.customer}.${values.inner}`;
  const uplinkUnit = `${values.uplink}.${values.inner}`;
  return [
    `# Q-in-Q service ${values.serviceName}: outer ${values.outer}, inner ${values.inner}`,
    `set interfaces ${values.customer} flexible-vlan-tagging`,
    `set interfaces ${values.customer} mtu ${values.mtu}`,
    `set interfaces ${values.customer} encapsulation flexible-ethernet-services`,
    `set interfaces ${values.customer} unit ${values.inner} encapsulation vlan-bridge`,
    `set interfaces ${values.customer} unit ${values.inner} vlan-id ${values.inner}`,
    `set interfaces ${values.customer} unit ${values.inner} input-vlan-map push`,
    `set interfaces ${values.customer} unit ${values.inner} input-vlan-map vlan-id ${values.outer}`,
    `set interfaces ${values.customer} unit ${values.inner} output-vlan-map pop`,
    `set interfaces ${values.uplink} flexible-vlan-tagging`,
    `set interfaces ${values.uplink} mtu ${values.mtu}`,
    `set interfaces ${values.uplink} encapsulation flexible-ethernet-services`,
    `set interfaces ${values.uplink} unit ${values.inner} encapsulation vlan-bridge`,
    `set interfaces ${values.uplink} unit ${values.inner} vlan-tags outer ${values.outer}`,
    `set interfaces ${values.uplink} unit ${values.inner} vlan-tags inner ${values.inner}`,
    `set vlans ${values.serviceName} interface ${customerUnit}`,
    `set vlans ${values.serviceName} interface ${uplinkUnit}`
  ];
}

function qinqUnitConflict(values, expectedLines) {
  for (const interfaceName of [values.customer, values.uplink]) {
    const port = state.ports.find((entry) => entry.name === interfaceName);
    const unitMarker = ` unit ${values.inner} `;
    const existingLines = (port?.currentSetLines || []).filter((line) => line.includes(unitMarker));
    const unexpected = existingLines.find((line) => !expectedLines.includes(line));
    if (unexpected) return `${interfaceName} unit ${values.inner} already has other configuration.`;
  }
  return "";
}

function updateQinqSummary() {
  const values = qinqValues();
  const error = qinqValidationError();
  qinqSummary.textContent = error || `${values.customer}.${values.inner} ↔ ${values.uplink}.${values.inner} · outer ${values.outer} / inner ${values.inner} · MTU ${values.mtu}`;
  qinqSummary.className = `tool-summary ${error ? "muted" : "valid"}`;
}

function buildQinqConfiguration() {
  if (state.pendingConfirmation || state.deploymentInProgress) return;
  const values = qinqValues();
  const validationError = qinqValidationError();
  const lines = validationError ? [] : buildQinqLines(values);
  const conflict = validationError ? "" : qinqUnitConflict(values, lines);
  if (validationError || conflict) {
    connectionStatus.textContent = conflict || validationError;
    connectionStatus.className = "status-pill error";
    qinqSummary.textContent = connectionStatus.textContent;
    qinqSummary.className = "tool-summary error-text";
    return;
  }
  appendConfigLines(lines);
  connectionStatus.textContent = `Appended Q-in-Q service ${values.serviceName} on ${values.customer} and ${values.uplink}`;
  connectionStatus.className = "status-pill";
  activateWorkspaceTab("review", true);
}

function applySelectedPorts() {
  if (state.pendingConfirmation || state.deploymentInProgress) return;
  const count = selectedInterfaceNames().length;
  if (!count) {
    connectionStatus.textContent = "Select at least one port first";
    connectionStatus.className = "status-pill error";
    return;
  }
  updateConfig(true);
  state.configManual = true;
  connectionStatus.textContent = `Built full configuration for ${count} port${count === 1 ? "" : "s"}`;
  connectionStatus.className = "status-pill";
  activateWorkspaceTab("review", true);
}

function customCommandPlan() {
  const ports = state.ports.filter((port) => state.selected.has(port.name));
  const fail = (error) => ({ error, lines: [], portCount: 0, globalCount: 0 });
  if (customCommandTemplateInput.value.length > MAX_DEPLOYMENT_CONFIG_CHARS) return fail("Custom commands exceed the 64 KB configuration limit.");
  const templates = customCommandTemplateInput.value.split(/\r?\n/)
    .map((line, index) => ({ line: line.trim(), number: index + 1 }))
    .filter(({ line }) => line && !line.startsWith("#"));
  if (!templates.length) return fail("Enter at least one custom command.");
  const portVariables = new Set(["port", "portNumber", "index"]);
  const supported = new Set([...portVariables, "device", "host"]);
  try {
    for (const template of templates) {
      template.tokens = parseDescriptionPattern(template.line);
      const names = template.tokens.filter((token) => token.type === "section").map((token) => token.name);
      const unknown = names.find((name) => !supported.has(name));
      if (unknown) return fail(`Line ${template.number}: unknown variable {${unknown}}. Use {port}, {portNumber}, {index}, {device}, or {host}.`);
      template.perPort = names.some((name) => portVariables.has(name));
    }
    const perPort = templates.some((template) => template.perPort);
    if (perPort && !ports.length) return fail("Select at least one port for port variables.");
    const commandCount = templates.reduce((count, template) => count + (template.perPort ? ports.length : 1), 0);
    if (commandCount > 500) return fail("Custom commands exceed the 500-command limit. Select fewer ports or use fewer template lines.");
    const globals = { device: deviceNameInput.value.trim(), host: hostInput.value.trim() };
    const expand = (template, port, index) => {
      const values = { ...globals, port: port?.name, index: String(index + 1),
        portNumber: port ? rawPhysicalPortNumber(port.name) || port.name.match(/(\d+)$/)?.[1] : undefined };
      const line = template.tokens.map((token) => {
        if (token.type === "literal") return token.value;
        if (!values[token.name]) throw new Error(`Line ${template.number}: no value is available for {${token.name}}.`);
        return values[token.name];
      }).join("");
      if (/[;|`\x00-\x08\x0b-\x1f\x7f]/.test(line) || line.includes("$(")) {
        throw new Error(`Line ${template.number}: command separators and control characters are not allowed.`);
      }
      if (!/^(set|delete)\s+\S/.test(line)) {
        throw new Error(`Line ${template.number}: start with set or delete followed by a configuration path.`);
      }
      if (!/^(?:[^"'\\]|\\.|"(?:[^"\\]|\\.)*"|'[^']*')*$/.test(line)) {
        throw new Error(`Line ${template.number}: check quotes and trailing backslashes.`);
      }
      return line;
    };
    const lines = [];
    let portBlock = [];
    const flushPorts = () => {
      ports.forEach((port, index) => portBlock.forEach((template) => lines.push(expand(template, port, index))));
      portBlock = [];
    };
    templates.forEach((template) => {
      if (template.perPort) portBlock.push(template);
      else {
        flushPorts();
        lines.push(expand(template));
      }
    });
    flushPorts();
    if (lines.join("\n").length > MAX_DEPLOYMENT_CONFIG_CHARS) return fail("Custom commands exceed the 64 KB configuration limit.");
    return { error: "", lines, portCount: perPort ? ports.length : 0,
      globalCount: templates.filter((template) => !template.perPort).length };
  } catch (error) {
    return fail(error.message);
  }
}

function updateCustomCommandPreview() {
  const plan = customCommandPlan();
  customCommandSummary.textContent = plan.error || `${plan.lines.length} commands: ${plan.globalCount} global (once), ${plan.portCount} selected ports.`;
  customCommandSummary.className = `tool-summary ${plan.error ? "error-text" : "valid"}`;
  customCommandPreview.textContent = plan.lines.join("\n") || "No custom commands to preview.";
}

function buildCustomCommands() {
  if (state.pendingConfirmation || state.deploymentInProgress) return;
  const plan = customCommandPlan();
  updateCustomCommandPreview();
  if (plan.error) {
    connectionStatus.textContent = plan.error;
    connectionStatus.className = "status-pill error";
    return;
  }
  const current = state.configManual ? configOutput.value.trim() : "";
  const prospective = composeDeploymentConfig(state.configQueue, [current, plan.lines.join("\n")].filter(Boolean).join("\n"));
  if (configCommandCount(prospective) > 500 || prospective.length > MAX_DEPLOYMENT_CONFIG_CHARS) {
    const message = "The combined editor and queue would exceed the 500-command or 64 KB deployment limit.";
    customCommandSummary.textContent = message;
    customCommandSummary.className = "tool-summary error-text";
    connectionStatus.textContent = message;
    connectionStatus.className = "status-pill error";
    return;
  }
  appendConfigLines(plan.lines);
  connectionStatus.textContent = `Appended ${plan.lines.length} custom commands (${plan.globalCount} global, ${plan.portCount} selected ports)`;
  connectionStatus.className = "status-pill";
  activateWorkspaceTab("review", true);
}

function appendSelectedFields() {
  if (state.pendingConfirmation || state.deploymentInProgress) return;
  const selectedPorts = state.ports.filter((port) => state.selected.has(port.name));
  if (!selectedPorts.length) {
    connectionStatus.textContent = "Select at least one port first";
    connectionStatus.className = "status-pill error";
    return;
  }
  const fields = {
    mode: appendModeFieldInput.checked,
    vlans: appendVlanFieldInput.checked,
    nativeVlan: appendNativeVlanFieldInput.checked,
    description: appendDescriptionFieldInput.checked
  };
  if (!Object.values(fields).some(Boolean)) {
    connectionStatus.textContent = "Choose at least one field to append";
    connectionStatus.className = "status-pill error";
    return;
  }
  const vlanList = parseMembershipInput();
  if (fields.vlans && !vlanList.length) {
    connectionStatus.textContent = "Select at least one VLAN membership to append";
    connectionStatus.className = "status-pill error";
    return;
  }
  const nativeVlanId = nativeVlanInput.value;
  const nativeVlan = state.vlans.find((vlan) => String(vlan.value) === nativeVlanId);
  if (fields.nativeVlan && portModeInput.value === "trunk" && (!nativeVlanId || !nativeVlan)) {
    connectionStatus.textContent = "Select a discovered native VLAN first";
    connectionStatus.className = "status-pill error";
    return;
  }

  const lines = [];
  selectedPorts.forEach((port) => {
    const portLines = new Set();
    const modeKeyword = port.modeKeyword || state.modeKeyword || "interface-mode";
    if (fields.mode) {
      portLines.add(`set interfaces ${port.name} unit 0 family ethernet-switching ${modeKeyword} ${portModeInput.value}`);
    }
    if (fields.nativeVlan) {
      if (portModeInput.value === "trunk") {
        portLines.add(`set interfaces ${port.name} native-vlan-id ${nativeVlanId}`);
        portLines.add(`set interfaces ${port.name} unit 0 family ethernet-switching vlan members ${nativeVlan.name}`);
      } else {
        portLines.add(`delete interfaces ${port.name} native-vlan-id`);
      }
    }
    if (fields.vlans) {
      vlanList.forEach((vlan) => {
        portLines.add(`set interfaces ${port.name} unit 0 family ethernet-switching vlan members ${vlan}`);
      });
    }
    if (fields.description) {
      const description = descriptionInput.value.trim();
      portLines.add(description
        ? buildDescriptionLine(port, description)
        : `delete interfaces ${port.name} description`);
    }
    lines.push(...portLines);
  });
  appendConfigLines(lines);
  const fieldLabels = [
    fields.mode && "mode",
    fields.vlans && "VLAN membership",
    fields.nativeVlan && "native VLAN",
    fields.description && "description"
  ].filter(Boolean);
  connectionStatus.textContent = `Appended ${fieldLabels.join(", ")} for ${selectedPorts.length} port${selectedPorts.length === 1 ? "" : "s"}`;
  connectionStatus.className = "status-pill";
  activateWorkspaceTab("review", true);
}

function removeVlanFromSelected() {
  if (state.pendingConfirmation || state.deploymentInProgress) return;
  const selectedPorts = state.ports.filter((port) => state.selected.has(port.name));
  const vlanList = parseMembershipInput();
  if (!selectedPorts.length) {
    connectionStatus.textContent = "Select at least one port first";
    connectionStatus.className = "status-pill error";
    return;
  }
  if (!vlanList.length) {
    connectionStatus.textContent = "Select at least one VLAN membership to remove";
    connectionStatus.className = "status-pill error";
    return;
  }
  const lines = [];

  selectedPorts.forEach((port) => {
    const iface = port.name;
    vlanList.forEach((vlan) => {
      lines.push(`delete interfaces ${iface} unit 0 family ethernet-switching vlan members ${vlan}`);
    });
  });

  appendConfigLines(lines);
  connectionStatus.textContent = `Appended VLAN removal for ${selectedPorts.length} port${selectedPorts.length === 1 ? "" : "s"}`;
  connectionStatus.className = "status-pill";
  activateWorkspaceTab("review", true);
}

function selectedInterfaceNames() {
  return state.ports.filter((port) => state.selected.has(port.name)).map((port) => port.name);
}

function appendPortAdministrationCommands(commands, message) {
  if (state.pendingConfirmation || state.deploymentInProgress) return;
  if (!commands.length) {
    connectionStatus.textContent = "Select at least one port first";
    connectionStatus.className = "status-pill error";
    return;
  }
  appendConfigLines(commands);
  connectionStatus.textContent = message;
  connectionStatus.className = "status-pill";
  activateWorkspaceTab("review", true);
}

function enableSelectedPorts() {
  const interfaces = selectedInterfaceNames();
  appendPortAdministrationCommands(
    interfaces.map((iface) => `delete interfaces ${iface} disable`),
    `Appended enable commands for ${interfaces.length} port${interfaces.length === 1 ? "" : "s"}`
  );
}

function disableSelectedPorts() {
  const interfaces = selectedInterfaceNames();
  appendPortAdministrationCommands(
    interfaces.map((iface) => `set interfaces ${iface} disable`),
    `Appended disable commands for ${interfaces.length} port${interfaces.length === 1 ? "" : "s"}`
  );
}

function portConfigurationClearPlan(interfaces) {
  const selectedNames = new Set(interfaces);
  const bridgeDeletes = new Set();
  const pairedUnits = new Map();
  const skippedPairs = [];
  const parseMember = (name) => {
    const separator = name.lastIndexOf(".");
    return { name, port: name.slice(0, separator), unit: name.slice(separator + 1) };
  };
  state.bridgeServices.forEach((service) => {
    const members = [...new Set(service.interfaces)].map(parseMember);
    const selected = members.filter((member) => selectedNames.has(member.port));
    if (!selected.length) return;
    selected.forEach((member) => bridgeDeletes.add(`delete vlans ${service.name} interface ${member.name}`));
    const peers = members.filter((member) => !selectedNames.has(member.port));
    if (!peers.length) return;
    let skipReason = "";
    if (members.length !== 2) skipReason = "multiple endpoints";
    else if (members.some((member) => !/^\d+$/.test(member.unit) || Number(member.unit) === 0)) {
      skipReason = "unit 0 or unknown unit";
    } else if (state.bridgeServices.some((other) => other.name !== service.name && other.interfaces.includes(peers[0].name))) {
      skipReason = "peer unit shared with another VLAN";
    }
    if (skipReason) {
      skippedPairs.push(`${service.name} (${skipReason})`);
      return;
    }
    const peer = peers[0];
    bridgeDeletes.add(`delete vlans ${service.name} interface ${peer.name}`);
    pairedUnits.set(peer.name, { ...peer, service: service.name });
  });
  return { bridgeDeletes: [...bridgeDeletes], pairedUnits: [...pairedUnits.values()], skippedPairs };
}

function clearSelectedPortConfiguration() {
  if (state.pendingConfirmation || state.deploymentInProgress) return;
  const interfaces = selectedInterfaceNames();
  if (!interfaces.length) {
    appendPortAdministrationCommands([], "");
    return;
  }
  const { bridgeDeletes, pairedUnits, skippedPairs } = portConfigurationClearPlan(interfaces);
  const portList = interfaces.join(", ");
  const serviceSummary = bridgeDeletes.length
    ? `\n\nAlso remove ${bridgeDeletes.length} discovered logical-interface VLAN membership${bridgeDeletes.length === 1 ? "" : "s"}.`
    : "";
  const pairedSummary = pairedUnits.length
    ? `\n\nClear paired logical units on unselected ports:\n${pairedUnits.map((peer) => `${peer.service}: ${peer.name}`).join("\n")}\nOther units and physical settings on those ports are preserved.`
    : "";
  const skippedSummary = skippedPairs.length
    ? `\n\nAutomatic peer cleanup skipped:\n${skippedPairs.join("\n")}`
    : "";
  if (!window.confirm(`Remove the entire interface configuration, including all logical units, for: ${portList}?${serviceSummary}${pairedSummary}${skippedSummary}\n\nThis appends deletion commands to the preview; it does not push them yet.`)) {
    return;
  }
  appendPortAdministrationCommands(
    [...bridgeDeletes, ...pairedUnits.map((peer) => `delete interfaces ${peer.port} unit ${peer.unit}`),
      ...interfaces.map((iface) => `delete interfaces ${iface}`)],
    `Appended full configuration removal for ${interfaces.length} port${interfaces.length === 1 ? "" : "s"}${bridgeDeletes.length ? ` and ${bridgeDeletes.length} logical-interface VLAN membership${bridgeDeletes.length === 1 ? "" : "s"}` : ""}${pairedUnits.length ? `; ${pairedUnits.length} paired logical unit${pairedUnits.length === 1 ? "" : "s"} cleared` : ""}${skippedPairs.length ? `; peer cleanup skipped for ${skippedPairs.length} service${skippedPairs.length === 1 ? "" : "s"} (see confirmation details)` : ""}`
  );
}

async function previewDeviceDiff() {
  const previewedConfig = combinedDeploymentConfig();
  if (!previewedConfig) {
    connectionStatus.textContent = "Build a configuration before requesting a device comparison";
    connectionStatus.className = "status-pill error";
    return;
  }
  if (!queueMatchesCurrentTarget()) {
    connectionStatus.textContent = "The queued batches belong to another switch. Clear the queue before previewing this target.";
    connectionStatus.className = "status-pill error";
    return;
  }
  if (previewedConfig.length > MAX_DEPLOYMENT_CONFIG_CHARS) {
    connectionStatus.textContent = "The combined configuration exceeds the 64 KB deployment limit.";
    connectionStatus.className = "status-pill error";
    return;
  }
  state.deploymentInProgress = true;
  renderConfigQueue();
  previewBtn.disabled = true;
  previewBtn.textContent = "Loading comparison…";
  previewState.textContent = "Previewing";
  compareOutput.textContent = "Loading candidate comparison from the switch…";
  try {
    const response = await fetch("/api/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(connectionPayload({ config: previewedConfig }))
    });
    const payload = await response.json();
    if (!response.ok || !payload.ok) throw new Error(payload.error || "Preview failed");
    compareOutput.textContent = payload.compare || "No differences returned by Junos.";
    if (combinedDeploymentConfig() === previewedConfig) {
      state.lastPreviewConfig = previewedConfig;
      previewState.textContent = "Preview current";
      previewState.className = "preview-state current";
      document.getElementById("tab-review").classList.remove("needs-review");
      connectionStatus.textContent = "Device comparison loaded; review it before pushing";
      connectionStatus.className = "status-pill connected";
    } else {
      invalidatePreview();
    }
  } catch (error) {
    state.lastPreviewConfig = null;
    previewState.textContent = "Preview failed";
    previewState.className = "preview-state stale";
    compareOutput.textContent = `Preview error: ${error.message}`;
    connectionStatus.textContent = `Preview error: ${error.message}`;
    connectionStatus.className = "status-pill error";
  } finally {
    state.deploymentInProgress = false;
    previewBtn.textContent = "Run show | compare";
    renderConfigQueue();
  }
}

async function quickCommitChanges() {
  if (state.deploymentInProgress || state.connectionInProgress || state.protectionSaving) return;
  if (state.pendingConfirmation) {
    connectionStatus.textContent = "Confirm the pending commit before committing another change";
    connectionStatus.className = "status-pill error";
    return;
  }
  const deploymentConfig = combinedDeploymentConfig();
  const quickTasks = !isDescriptionOnlyDeployment(deploymentConfig);
  if (!queueMatchesCurrentTarget()) {
    connectionStatus.textContent = "The queued batches belong to another switch. Clear the queue before committing to this target.";
    connectionStatus.className = "status-pill error";
    return;
  }
  const eligibilityError = quickTasks ? quickTaskValidationError(deploymentConfig)
    : (!isDescriptionOnlyDeployment(deploymentConfig) ? "Quick commit is available only when every queued and current command changes an interface description" : "");
  if (eligibilityError) {
    connectionStatus.textContent = eligibilityError;
    connectionStatus.className = "status-pill error";
    return;
  }
  if (deploymentConfig.length > MAX_DEPLOYMENT_CONFIG_CHARS) {
    connectionStatus.textContent = "The combined configuration exceeds the 64 KB deployment limit.";
    connectionStatus.className = "status-pill error";
    return;
  }

  state.deploymentInProgress = true;
  const commitButton = quickCommitBtn;
  commitButton.textContent = "Committing...";
  connectionStatus.textContent = quickTasks ? "Rechecking eligible tasks and committing..." : "Checking and committing description changes...";
  connectionStatus.className = "status-pill";
  renderConfigQueue();

  try {
    const response = await fetch(quickTasks ? "/api/quick-task-commit" : "/api/quick-description-commit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(connectionPayload({ config: deploymentConfig }))
    });
    const payload = await response.json();
    if (!response.ok || !payload.ok) {
      throw new Error(payload.error || "Quick commit failed");
    }

    clearDeploymentWorkspace();
    setDeploymentReady("Quick changes committed directly after a successful commit check.");
    const commandCount = payload.commandCount || configCommandCount(deploymentConfig);
    connectionStatus.textContent = `${commandCount} ${quickTasks ? "quick" : "description"} change${commandCount === 1 ? "" : "s"} committed successfully`;
    if (payload.activityWarning) connectionStatus.textContent += ` · ${payload.activityWarning}`;
    connectionStatus.className = "status-pill connected";
    if (quickTasks) await connectToSwitch({ isRefresh: true });
  } catch (error) {
    connectionStatus.textContent = `Quick commit error: ${error.message}`;
    connectionStatus.className = "status-pill error";
  } finally {
    state.deploymentInProgress = false;
    commitButton.textContent = "Quick commit";
    renderConfigQueue();
  }
}

async function pushToSwitch() {
  if (state.deploymentInProgress || state.connectionInProgress) return;
  if (state.pendingConfirmation) {
    connectionStatus.textContent = "Confirm the pending commit before pushing another change";
    connectionStatus.className = "status-pill error";
    return;
  }
  const deploymentConfig = combinedDeploymentConfig();
  if (!queueMatchesCurrentTarget()) {
    connectionStatus.textContent = "The queued batches belong to another switch. Clear the queue before pushing this target.";
    connectionStatus.className = "status-pill error";
    return;
  }
  if (state.lastPreviewConfig !== deploymentConfig) {
    connectionStatus.textContent = "Run show | compare for the current configuration before pushing";
    connectionStatus.className = "status-pill error";
    return;
  }
  if (!window.confirm("Run commit check, then apply this configuration using a 5-minute confirmed commit? A failed check stops the push and keeps your draft. Applied changes roll back unless you confirm them afterward.")) {
    return;
  }
  state.deploymentInProgress = true;
  renderConfigQueue();
  pushBtn.disabled = true;
  pushBtn.textContent = "Pushing configuration…";
  confirmBtn.disabled = true;
  connectionStatus.textContent = "Running commit check before the protected push…";
  connectionStatus.className = "status-pill";

  try {
    const response = await fetch("/api/push", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(connectionPayload({ config: deploymentConfig }))
    });

    const payload = await response.json();
    if (!response.ok || !payload.ok) {
      if (payload.stage === "commit-check") {
        state.lastPreviewConfig = null;
        previewState.textContent = "Commit check failed — edit and compare again";
        previewState.className = "preview-state stale";
        compareOutput.textContent = `Commit check failed. No commit was sent. Your editor and queue are preserved.\n\n${payload.output || payload.error || "No details returned by Junos."}`;
      }
      throw new Error(payload.error || "Push failed");
    }

    const pendingConfirmation = !!payload.pendingConfirmation;
    state.pendingConfirmation = pendingConfirmation;
    state.pendingActivityId = pendingConfirmation ? payload.activityId || null : null;
    state.pendingTarget = state.pendingConfirmation
      ? { host: hostInput.value.trim(), username: usernameInput.value.trim(), deviceId: state.savedDeviceId }
      : null;
    if (pendingConfirmation) {
      startConfirmationWindow(payload.confirmMinutes || 5);
    } else {
      clearDeploymentWorkspace();
      setDeploymentReady("The change completed without a pending confirmation window.");
    }
    connectionStatus.textContent = pendingConfirmation
      ? `Config applied. Confirm within ${payload.confirmMinutes || 5} minutes or Junos will roll it back.`
      : "Config pushed successfully";
    if (payload.activityWarning) connectionStatus.textContent += ` · ${payload.activityWarning}`;
    connectionStatus.className = "status-pill connected";
  } catch (error) {
    pushBtn.textContent = "Push with rollback protection";
    connectionStatus.textContent = `Push error: ${error.message}`;
    connectionStatus.className = "status-pill error";
  } finally {
    state.deploymentInProgress = false;
    renderConfigQueue();
  }
}

async function confirmCommit() {
  if (!state.pendingConfirmation || !state.confirmationDeadline) return;
  confirmBtn.disabled = true;
  confirmBtn.textContent = "Confirming…";
  connectionStatus.textContent = "Confirming commit…";
  connectionStatus.className = "status-pill";
  try {
    const response = await fetch("/api/confirm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        deviceId: state.pendingTarget?.deviceId || state.savedDeviceId,
        host: state.pendingTarget?.host || hostInput.value.trim(),
        username: state.pendingTarget?.username || usernameInput.value.trim(),
        password: passwordInput.value,
        deviceName: deviceNameInput.value.trim(),
        confirmationFor: state.pendingActivityId
      })
    });
    const payload = await response.json();
    if (!response.ok || !payload.ok) throw new Error(payload.error || "Confirmation failed");
    clearDeploymentWorkspace();
    setDeploymentReady("Commit confirmed successfully. Rollback protection is cleared and the workspace is ready for another push.");
    connectionStatus.textContent = "Commit confirmed; automatic rollback canceled";
    if (payload.activityWarning) connectionStatus.textContent += ` · ${payload.activityWarning}`;
    connectionStatus.className = "status-pill connected";
  } catch (error) {
    confirmBtn.disabled = !state.confirmationDeadline || state.confirmationDeadline <= Date.now();
    confirmBtn.textContent = "Confirm committed change";
    connectionStatus.textContent = `Confirmation error: ${error.message}`;
    connectionStatus.className = "status-pill error";
  }
}

[hostInput, usernameInput].forEach((input) => input.addEventListener("input", () => {
  const saved = state.savedDevices.find((device) => device.id === state.savedDeviceId);
  if (saved && (saved.host !== hostInput.value.trim() || saved.username !== usernameInput.value.trim())) {
    state.savedDeviceId = null;
    savedDeviceInput.value = "";
    quickConnectBtn.disabled = true;
  }
  invalidatePreview();
  updateConnectionHint();
  updateConfig();
  updateCustomCommandPreview();
  window.liveWatch?.onContextChange();
}));
passwordInput.addEventListener("input", () => window.liveWatch?.resetConnection());
deviceNameInput.addEventListener("input", () => {
  updateConfig();
  updateCustomCommandPreview();
});
descriptionInput.addEventListener("input", () => {
  updateIntendedChangeSummary();
  updateConfig();
});
portModeInput.addEventListener("change", () => {
  renderVlanChoices();
  updateIntendedChangeSummary();
  updateConfig();
});
nativeVlanInput.addEventListener("change", () => {
  const nativeVlan = state.vlans.find((vlan) => String(vlan.value) === nativeVlanInput.value);
  if (nativeVlan) {
    const membership = Array.from(
      vlanMembershipInput.querySelectorAll('input[name="vlanMembership"]')
    ).find((input) => input.value === nativeVlan.name);
    if (membership) membership.checked = true;
  }
  updateIntendedChangeSummary();
  updateConfig();
});
vlanMembershipInput.addEventListener("change", () => {
  updateIntendedChangeSummary();
  updateConfig();
});
configOutput.addEventListener("input", () => {
  state.configManual = true;
  invalidatePreview();
  renderConfigQueue();
});
selectionModeInput.addEventListener("change", () => {
  state.lastSelected = null;
  state.selected = new Set();
  updateSelectionModeHint();
  render();
});
shiftOffsetInput.addEventListener("input", updateMoveSummary);
moveUpdateDescriptionNumberInput.addEventListener("input", updateMoveSummary);
[seriesConfigurationScopeInput, seriesStartPort, seriesCountInput, seriesStartNumberInput, seriesDescriptionInput, seriesPostfixInput, seriesIncludePortNumberInput, seriesPadNumbersInput]
  .forEach((input) => input.addEventListener("input", updateSeriesDescriptionPreview));
[descriptionTransformSourceInput, descriptionTransformTargetInput]
  .forEach((input) => input.addEventListener("input", updateDescriptionTransformPreview));
irbVlanInput.addEventListener("change", () => {
  const vlan = state.vlans.find((entry) => entry.name === irbVlanInput.value);
  if (vlan) irbUnitInput.value = vlan.value;
  updateIrbSummary();
});
[irbUnitInput, irbAddressInput].forEach((input) => input.addEventListener("input", updateIrbSummary));
[qinqCustomerPortInput, qinqUplinkPortInput, qinqServiceNameInput, qinqOuterTagInput, qinqInnerTagInput, qinqMtuInput]
  .forEach((input) => input.addEventListener("input", updateQinqSummary));
logicalServiceSourceInput.addEventListener("change", updateLogicalServiceMoveSummary);

document.getElementById("selectAllBtn").addEventListener("click", () => {
  state.selected = new Set(state.ports.map((port) => port.name));
  state.lastSelected = null;
  render();
});
document.getElementById("clearSelectionBtn").addEventListener("click", () => {
  state.selected = new Set();
  state.lastSelected = null;
  render();
});
viewMacsBtn.addEventListener("click", showLearnedMacs);
macViewScopeInput.addEventListener("change", updateViewMacsButton);
learnedMacSearchInput.addEventListener("input", renderLearnedMacs);
learnedMacVlanFilter.addEventListener("change", renderLearnedMacs);
learnedMacSortInput.addEventListener("change", renderLearnedMacs);
learnedMacSortDirectionBtn.addEventListener("click", () => {
  const descending = learnedMacSortDirectionBtn.getAttribute("aria-pressed") !== "true";
  learnedMacSortDirectionBtn.setAttribute("aria-pressed", String(descending));
  learnedMacSortDirectionBtn.textContent = descending ? "\u2193" : "\u2191";
  learnedMacSortDirectionBtn.setAttribute("aria-label", descending ? "Sort ascending" : "Sort descending");
  learnedMacSortDirectionBtn.title = descending ? "Sort ascending" : "Sort descending";
  renderLearnedMacs();
});
document.getElementById("closeMacDialogBtn").addEventListener("click", () => learnedMacDialog.close());
learnedMacDialog.addEventListener("click", (event) => {
  if (event.target === learnedMacDialog) learnedMacDialog.close();
});
document.getElementById("moveConfigBtn").addEventListener("click", buildMoveConfiguration);
document.getElementById("buildSeriesBtn").addEventListener("click", buildSeriesConfiguration);
buildDescriptionTransformBtn.addEventListener("click", buildDescriptionTransformConfiguration);
document.getElementById("createVlanBtn").addEventListener("click", createVlanCommand);
document.getElementById("buildCustomCommandBtn").addEventListener("click", buildCustomCommands);
customCommandTemplateInput.addEventListener("input", updateCustomCommandPreview);
document.getElementById("buildIrbBtn").addEventListener("click", buildIrbConfiguration);
document.getElementById("buildQinqBtn").addEventListener("click", buildQinqConfiguration);
document.getElementById("moveLogicalServiceBtn").addEventListener("click", buildLogicalServiceMove);
document.getElementById("applyBtn").addEventListener("click", applySelectedPorts);
appendSelectedFieldsBtn.addEventListener("click", appendSelectedFields);
document.getElementById("removeVlanBtn").addEventListener("click", removeVlanFromSelected);
document.getElementById("togglePortsBtn").addEventListener("click", () => {
  if (selectionActionState().enable) enableSelectedPorts();
  else disableSelectedPorts();
});
document.getElementById("clearPortsBtn").addEventListener("click", clearSelectedPortConfiguration);
document.getElementById("bouncePortsBtn").addEventListener("click", () => bounceSelectedPorts("link"));
document.getElementById("bouncePoeBtn").addEventListener("click", () => bounceSelectedPorts("poe"));
connectionForm.addEventListener("submit", (event) => {
  event.preventDefault();
  connectToSwitch();
});
savedDeviceInput.addEventListener("change", selectSavedDevice);
savedDeviceInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && savedDeviceInput.value && !state.connectionInProgress) {
    event.preventDefault();
    connectToSwitch();
  }
});
quickConnectBtn.addEventListener("click", () => {
  connectToSwitch();
});
saveDeviceBtn.addEventListener("click", () => saveCurrentDevice());
autoSaveConnectionsInput.addEventListener("change", () => {
  try {
    window.localStorage.setItem(AUTO_SAVE_STORAGE_KEY, String(autoSaveConnectionsInput.checked));
  } catch (_error) {
    // Auto-save still works for this session if browser storage is unavailable.
  }
});
refreshNowBtn.addEventListener("click", () => connectToSwitch({ isRefresh: true }));
document.getElementById("bounceInterval").addEventListener("change", saveBounceIntervalPreference);
optionsBtn.addEventListener("click", async () => {
  optionsDialog.showModal();
  document.getElementById("openDeviceDataBtn").focus();
  await loadSavedDevices(state.savedDeviceId);
});
document.getElementById("closeOptionsBtn").addEventListener("click", () => optionsDialog.close());
window.addEventListener("error", (event) => queueBrowserError(event.message || "Browser script error", event.filename || ""));
window.addEventListener("unhandledrejection", (event) => queueBrowserError(event.reason?.message || String(event.reason), "Unhandled promise rejection"));
optionsDialog.addEventListener("click", (event) => {
  if (event.target === optionsDialog) optionsDialog.close();
});
document.getElementById("openDeviceDataBtn").addEventListener("click", showDeviceData);
document.getElementById("openActivityLogBtn").addEventListener("click", showActivityLog);
document.getElementById("closeDeviceDataBtn").addEventListener("click", () => deviceDataDialog.close());
document.getElementById("closeActivityLogBtn").addEventListener("click", () => activityLogDialog.close());
[deviceDataDialog, activityLogDialog].forEach((dialog) => {
  dialog.addEventListener("click", (event) => { if (event.target === dialog) dialog.close(); });
  dialog.addEventListener("close", () => {
    const buttonId = state.returnToOptionsButton;
    state.returnToOptionsButton = null;
    if (buttonId) {
      optionsDialog.showModal();
      document.getElementById(buttonId).focus();
    }
  });
});
activityLogScope.addEventListener("change", () => loadActivityLog());
activityLogView.addEventListener("change", () => loadActivityLog());
refreshActivityLogBtn.addEventListener("click", () => loadActivityLog());
olderActivityLogBtn.addEventListener("click", () => loadActivityLog(true));
groupDeviceList.addEventListener("change", updateGroupSelectionStatus);
visibleGroupList.addEventListener("change", () => {
  state.visibleSavedDeviceGroups = new Set(
    Array.from(visibleGroupList.querySelectorAll('input[name="visibleSavedGroup"]:checked'))
      .map((input) => input.value)
  );
  storeVisibleSavedDeviceGroups();
  renderVisibleGroupChoices();
  renderSavedDeviceChoices();
});
groupAssignmentForm.addEventListener("submit", (event) => {
  event.preventDefault();
  assignSelectedDevicesToGroup();
});
document.getElementById("selectAllGroupDevicesBtn").addEventListener("click", () => {
  groupDeviceList.querySelectorAll('input[name="groupDevice"]').forEach((input) => { input.checked = true; });
  updateGroupSelectionStatus();
});
document.getElementById("clearGroupDevicesBtn").addEventListener("click", () => {
  groupDeviceList.querySelectorAll('input[name="groupDevice"]').forEach((input) => { input.checked = false; });
  updateGroupSelectionStatus();
});
document.getElementById("showAllSavedGroupsBtn").addEventListener("click", () => {
  state.visibleSavedDeviceGroups = null;
  storeVisibleSavedDeviceGroups();
  renderVisibleGroupChoices();
  renderSavedDeviceChoices();
});
document.getElementById("hideAllSavedGroupsBtn").addEventListener("click", () => {
  state.visibleSavedDeviceGroups = new Set();
  storeVisibleSavedDeviceGroups();
  renderVisibleGroupChoices();
  renderSavedDeviceChoices();
});
document.addEventListener("keydown", (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s" && state.ports.length) {
    event.preventDefault();
    saveCurrentDevice();
  }
});
stopAppBtn.addEventListener("click", stopPackagedApp);
refreshIntervalInput.addEventListener("change", configureAutoRefresh);
richardViewBtn.addEventListener("click", () => {
  state.richardView = !state.richardView;
  portGrid.classList.toggle("richard-view", state.richardView);
  richardViewBtn.setAttribute("aria-pressed", String(state.richardView));
  richardViewBtn.textContent = state.richardView ? "Exit Richard View" : "Richard View";
});
previewBtn.addEventListener("click", previewDeviceDiff);
quickCommitBtn.addEventListener("click", quickCommitChanges);
document.getElementById("toggleProtectionBtn").addEventListener("click", () => saveSelectedProtection(!selectionActionState().unprotect));
document.getElementById("selectEligiblePortsBtn").addEventListener("click", () => {
  const topology = buildMacTopology();
  state.selected = new Set(state.ports.filter((port) => !quickPortExclusion(port, topology)).map((port) => port.name));
  state.lastSelected = null;
  render();
});
pushBtn.addEventListener("click", pushToSwitch);
confirmBtn.addEventListener("click", confirmCommit);
queueCurrentConfigBtn.addEventListener("click", queueCurrentConfig);
clearConfigQueueBtn.addEventListener("click", clearConfigQueue);
configQueueLabelInput.addEventListener("keydown", (event) => {
  if (event.key !== "Enter") return;
  event.preventDefault();
  queueCurrentConfig();
});
tabButtons.forEach((button, index) => {
  button.addEventListener("click", () => activateWorkspaceTab(button.dataset.tab));
  button.addEventListener("keydown", (event) => {
    if (!["ArrowLeft", "ArrowRight"].includes(event.key)) return;
    event.preventDefault();
    const offset = event.key === "ArrowRight" ? 1 : -1;
    const next = tabButtons[(index + offset + tabButtons.length) % tabButtons.length];
    activateWorkspaceTab(next.dataset.tab, true);
  });
});

try {
  autoSaveConnectionsInput.checked = window.localStorage.getItem(AUTO_SAVE_STORAGE_KEY) === "true";
  const storedVisibleGroups = window.localStorage.getItem(VISIBLE_GROUPS_STORAGE_KEY);
  if (storedVisibleGroups !== null) {
    const parsedVisibleGroups = JSON.parse(storedVisibleGroups);
    if (Array.isArray(parsedVisibleGroups) && parsedVisibleGroups.every((group) => typeof group === "string")) {
      state.visibleSavedDeviceGroups = new Set(parsedVisibleGroups);
    }
  }
} catch (_error) {
  autoSaveConnectionsInput.checked = false;
  state.visibleSavedDeviceGroups = null;
}

loadBounceIntervalPreference();
render();
activateWorkspaceTab("configure");
updateSelectionModeHint();
updateSeriesDescriptionPreview();
updateDescriptionTransformPreview();
setDeploymentReady();
checkBackendCompatibility().then((compatible) => {
  if (compatible) {
    loadDefaults();
    loadSavedDevices();
  }
});
