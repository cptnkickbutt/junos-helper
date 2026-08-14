const state = {
  ports: [],
  selected: new Set(),
  lastSelected: null,
  mode: "single",
  pendingConfirmation: false,
  pendingTarget: null,
  vlans: [],
  configManual: false,
  confirmationDeadline: null,
  confirmationTimer: null,
  modeKeyword: "interface-mode",
  lastPreviewConfig: null,
  savedDevices: [],
  savedDeviceId: null,
  connectionInProgress: false,
  refreshTimer: null,
  richardView: false
};
const REQUIRED_API_VERSION = 7;

const hostInput = document.getElementById("host");
const usernameInput = document.getElementById("username");
const passwordInput = document.getElementById("password");
const deviceNameInput = document.getElementById("deviceName");
const selectionModeInput = document.getElementById("selectionMode");
const shiftOffsetInput = document.getElementById("shiftOffset");
const portModeInput = document.getElementById("portMode");
const vlanMembershipInput = document.getElementById("vlanMembership");
const descriptionInput = document.getElementById("description");
const selectionSummary = document.getElementById("selectionSummary");
const selectionSummaryBox = document.getElementById("selectionSummaryBox");
const configOutput = document.getElementById("configOutput");
const connectionHint = document.getElementById("connectionHint");
const portGrid = document.getElementById("portGrid");
const connectionStatus = document.getElementById("connectionStatus");
const deviceMetadata = document.getElementById("deviceMetadata");
const diagnosticsOutput = document.getElementById("diagnosticsOutput");
const confirmBtn = document.getElementById("confirmBtn");
const connectBtn = document.getElementById("connectBtn");
const savedDeviceInput = document.getElementById("savedDevice");
const quickConnectBtn = document.getElementById("quickConnectBtn");
const saveDeviceBtn = document.getElementById("saveDeviceBtn");
const refreshIntervalInput = document.getElementById("refreshInterval");
const refreshNowBtn = document.getElementById("refreshNowBtn");
const lastRefresh = document.getElementById("lastRefresh");
const richardViewBtn = document.getElementById("richardViewBtn");
const pushBtn = document.getElementById("pushBtn");
const commitTimer = document.getElementById("commitTimer");
const deploymentHint = document.getElementById("deploymentHint");
const intendedChangeSummary = document.getElementById("intendedChangeSummary");
const moveSummary = document.getElementById("moveSummary");
const seriesConfigurationScopeInput = document.getElementById("seriesConfigurationScope");
const seriesStartPort = document.getElementById("seriesStartPort");
const seriesCountInput = document.getElementById("seriesCount");
const seriesStartNumberInput = document.getElementById("seriesStartNumber");
const seriesDescriptionInput = document.getElementById("seriesDescription");
const seriesPostfixInput = document.getElementById("seriesPostfix");
const seriesIncludePortNumberInput = document.getElementById("seriesIncludePortNumber");
const seriesDescriptionPreview = document.getElementById("seriesDescriptionPreview");
const newVlanNameInput = document.getElementById("newVlanName");
const newVlanIdInput = document.getElementById("newVlanId");
const previewBtn = document.getElementById("previewBtn");
const previewState = document.getElementById("previewState");
const compareOutput = document.getElementById("compareOutput");
const selectionModeHint = document.getElementById("selectionModeHint");
const tabButtons = Array.from(document.querySelectorAll(".tab-button"));
const tabPanels = Array.from(document.querySelectorAll(".tab-panel"));

function activateWorkspaceTab(tabName, focus = false) {
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
    multi: "Multi-select toggles ports independently in any order."
  };
  selectionModeHint.textContent = messages[selectionModeInput.value] || "";
}

function updatePushAvailability() {
  pushBtn.disabled = state.pendingConfirmation
    || !configOutput.value.trim()
    || state.lastPreviewConfig !== configOutput.value;
}

function invalidatePreview() {
  state.lastPreviewConfig = null;
  previewState.textContent = "Preview required";
  previewState.className = "preview-state stale";
  document.getElementById("tab-review").classList.toggle("needs-review", !!configOutput.value.trim());
  updatePushAvailability();
}

function replaceConfig(text, manual = true) {
  const normalized = text.trim();
  if (configOutput.value === normalized) {
    state.configManual = manual;
    return;
  }
  configOutput.value = normalized;
  state.configManual = manual;
  invalidatePreview();
}

function appendConfigLines(lines) {
  if (!lines.length) return;
  replaceConfig(`${configOutput.value}\n${lines.join("\n")}`, true);
}

async function checkBackendCompatibility() {
  try {
    const response = await fetch("/api/health", { cache: "no-store" });
    const health = await response.json();
    if (!response.ok || health.apiVersion !== REQUIRED_API_VERSION) {
      connectionStatus.textContent = `Backend restart required (need API ${REQUIRED_API_VERSION}, found ${health.apiVersion ?? "legacy"})`;
      connectionStatus.className = "status-pill error";
      connectBtn.textContent = "Retry after backend restart";
      return false;
    }
    connectBtn.textContent = "Connect & pull data";
    return true;
  } catch (_error) {
    connectionStatus.textContent = "Backend is unavailable; start or restart Flask";
    connectionStatus.className = "status-pill error";
    connectBtn.textContent = "Retry backend connection";
    return false;
  }
}

function clearConfirmationTimer() {
  if (state.confirmationTimer !== null) {
    window.clearInterval(state.confirmationTimer);
    state.confirmationTimer = null;
  }
}

function setDeploymentReady(message = "Run show | compare for the current preview before pushing with rollback protection.") {
  clearConfirmationTimer();
  state.pendingConfirmation = false;
  state.pendingTarget = null;
  state.confirmationDeadline = null;
  state.lastPreviewConfig = null;
  previewState.textContent = "Preview required";
  previewState.className = "preview-state stale";
  updatePushAvailability();
  pushBtn.textContent = "Push with rollback protection";
  confirmBtn.disabled = true;
  confirmBtn.textContent = "Confirm committed change";
  commitTimer.textContent = "Ready";
  commitTimer.className = "commit-timer ready";
  deploymentHint.textContent = message;
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
    ...extra
  };
}

async function loadSavedDevices(selectedId = state.savedDeviceId) {
  try {
    const response = await fetch("/api/devices", { cache: "no-store" });
    const payload = await response.json();
    if (!response.ok || !payload.ok) return;
    state.savedDevices = payload.devices || [];
    savedDeviceInput.replaceChildren(new Option("Choose a saved device", ""));
    state.savedDevices.forEach((device) => {
      savedDeviceInput.add(new Option(`${device.hostname} — ${device.host}`, device.id));
    });
    if (selectedId && state.savedDevices.some((device) => device.id === selectedId)) {
      savedDeviceInput.value = selectedId;
      state.savedDeviceId = selectedId;
    }
    quickConnectBtn.disabled = !savedDeviceInput.value || state.connectionInProgress;
  } catch (_error) {
    // Manual connections remain available if saved profiles cannot be loaded.
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
  updateConnectionHint();
  updateConfig();
}

async function saveCurrentDevice() {
  if (!deviceNameInput.value || !hostInput.value.trim() || !usernameInput.value.trim()) {
    connectionStatus.textContent = "Connect and discover a device hostname before saving it";
    connectionStatus.className = "status-pill error";
    return;
  }
  saveDeviceBtn.disabled = true;
  saveDeviceBtn.textContent = "Saving…";
  try {
    const response = await fetch("/api/devices", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(connectionPayload({ hostname: deviceNameInput.value }))
    });
    const payload = await response.json();
    if (!response.ok || !payload.ok) throw new Error(payload.error || "Unable to save device");
    state.savedDeviceId = payload.device.id;
    passwordInput.value = "";
    await loadSavedDevices(payload.device.id);
    connectionStatus.textContent = `${payload.device.hostname} saved for quick connect`;
    connectionStatus.className = "status-pill connected";
  } catch (error) {
    connectionStatus.textContent = `Save error: ${error.message}`;
    connectionStatus.className = "status-pill error";
  } finally {
    saveDeviceBtn.disabled = !state.ports.length;
    saveDeviceBtn.textContent = "Save device";
  }
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
  if (state.connectionInProgress) return;
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
      body: JSON.stringify(connectionPayload())
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
            currentDescription: detail.description || configuration.description || "",
            currentDisabled: !!(detail.disabled || configuration.disabled),
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

    state.vlans = payload.vlanMemberships || [];
    renderVlanChoices();

    if (payload.debug) {
      const debugText = [
        `Interface count: ${payload.debug.interfaceCount}`,
        `VLAN count: ${payload.debug.vlanCount ?? 0}`,
        `Configured interface count: ${payload.debug.configuredInterfaceCount ?? 0}`,
        `Commands run: ${payload.debug.rawCommands.join(", ")}`,
        "",
        ...payload.results.map((entry) => `=== ${entry.command} ===\n${(entry.output || entry.error || "").trim()}`)
      ].join("\n\n");
      diagnosticsOutput.textContent = debugText;
    }

    state.configManual = isRefresh ? previousConfigManual : false;
    saveDeviceBtn.disabled = false;
    refreshNowBtn.disabled = false;
    lastRefresh.textContent = `Last refreshed ${new Date().toLocaleTimeString()}`;
    render(!isRefresh);
    configureAutoRefresh();
  } catch (error) {
    connectionStatus.textContent = `${isRefresh ? "Refresh" : "Connection"} error: ${error.message}`;
    connectionStatus.className = "status-pill error";
  } finally {
    state.connectionInProgress = false;
    connectBtn.disabled = false;
    refreshNowBtn.disabled = !state.ports.length;
    quickConnectBtn.disabled = !savedDeviceInput.value;
  }
}

function render(updateConfiguration = true) {
  portGrid.innerHTML = "";
  state.ports.forEach((port) => {
    const button = document.createElement("button");
    const portName = port.name;
    const oper = (port.oper || "unknown").toLowerCase();
    const configured = !!port.configured;
    const selectedClass = state.selected.has(portName) ? " selected" : "";
    const anchorClass = selectionModeInput.value === "range" && state.lastSelected === port.index ? " range-anchor" : "";
    const statusClass = oper === "up" ? " state-up" : oper === "down" ? " state-down" : "";
    button.className = `port-tile${selectedClass}${anchorClass}${statusClass}${configured ? " configured" : ""}`;
    button.type = "button";
    const description = port.currentDescription || "";
    const displayDescription = description.replace(/^\d{2}_/, "");
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
    [
      ["Description", description || "Not set"],
      ["Mode", mode],
      ["VLANs", vlanSummary],
      ["Admin / link", `${port.admin || "unknown"} / ${oper}`]
    ].forEach(([term, value]) => {
      const row = document.createElement("span");
      row.className = "port-tooltip-row";
      const key = document.createElement("b");
      key.textContent = `${term}:`;
      const detail = document.createElement("span");
      detail.textContent = value;
      row.append(key, detail);
      tooltip.appendChild(row);
    });
    button.append(label, descriptionLabel, tooltip);
    button.addEventListener("click", () => handlePortSelect(portName));
    portGrid.appendChild(button);
  });

  updateSelectionSummary();
  updateIntendedChangeSummary();
  updateMoveSummary();
  if (state.selected.size && !seriesStartPort.value) {
    seriesStartPort.value = state.ports.find((port) => state.selected.has(port.name))?.name || "";
  }
  updateSeriesDescriptionPreview();
  if (updateConfiguration) updateConfig();
  updateConnectionHint();
}

function handlePortSelect(portName) {
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
    if (state.selected.has(portName)) {
      state.selected.delete(portName);
    } else {
      state.selected.add(portName);
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
    return p && p.configured;
  }).length;
  selectionSummary.textContent = `${list.length} selected`;
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
    current.textContent = `${port?.currentMode || "unknown"} · ${currentVlans}`;
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

function renderVlanChoices() {
  const selectedValues = new Set(parseMembershipInput());
  const isAccess = portModeInput.value === "access";
  vlanMembershipInput.replaceChildren();

  if (!state.vlans.length) {
    const empty = document.createElement("span");
    empty.className = "muted";
    empty.textContent = "No VLANs discovered";
    vlanMembershipInput.appendChild(empty);
    return;
  }

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

function updateConfig(force = false) {
  if (state.configManual && !force) return;
  const selectedPorts = state.ports.filter((port) => state.selected.has(port.name));
  const lines = [];
  lines.push(`# Target: ${deviceNameInput.value || "switch"}`);
  lines.push(`# SSH: ${usernameInput.value || "user"}@${hostInput.value || "host"}`);
  lines.push("");

  selectedPorts.forEach((port) => lines.push(...buildDesiredLines(port, descriptionInput.value.trim()), ""));

  replaceConfig(lines.join("\n"), false);
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

function physicalPortNumber(interfaceName) {
  const match = interfaceName.match(/\/(\d+)(?::\d+)?(?:\.\d+)?$/);
  return match ? match[1].padStart(2, "0") : "";
}

function interfacePortNumber(interfaceName) {
  return physicalPortNumber(interfaceName) || interfaceName.match(/(\d+)$/)?.[1]?.padStart(2, "0") || "00";
}

function unusedDescription(port, fallbackSiteCode) {
  const hostnameSiteCode = deviceNameInput.value.match(/[A-Za-z0-9]+/)?.[0]?.toUpperCase() || "SITE";
  const siteCode = descriptionSiteCode(port.currentDescription || "") || fallbackSiteCode || hostnameSiteCode;
  return `${interfacePortNumber(port.name)}_${siteCode}_UNUSED`;
}

function updateMoveSummary() {
  const { error, mappings } = getMoveMappings();
  moveSummary.textContent = error || mappings.map(({ source, destination }) => `${source.name} → ${destination.name}`).join(" · ");
  moveSummary.className = `tool-summary ${error ? "muted" : "valid"}`;
}

function buildMoveConfiguration() {
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
  const mappingText = mappings.map(({ source, destination }) => `${source.name} → ${destination.name}`).join("\n");
  const retiredText = retiredSources.length
    ? `\n\nRetired: ${retiredSources.map((name) => {
      const source = state.ports.find((port) => port.name === name);
      return `${name} → ${unusedDescription(source, fallbackSiteCode)}`;
    }).join(", ")}`
    : "";
  if (!window.confirm(`Build a move that replaces destination configuration?\n\n${mappingText}${retiredText}\n\nThe preview will clear every destination before copying source configuration. Retired sources will be cleared, disabled, and renamed.`)) return;

  const lines = ["# Interface configuration move", ...mappings.map(({ source, destination }) => `# ${source.name} -> ${destination.name}`), ""];
  destinationNames.forEach((name) => lines.push(`delete interfaces ${name}`));
  lines.push("");
  mappings.forEach(({ source, destination }) => {
    source.currentSetLines.forEach((line) => {
      lines.push(line.replace(/^set interfaces\s+\S+/, `set interfaces ${destination.name}`));
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
  activateWorkspaceTab("review");
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

function seriesDescription(port, seriesNumber) {
  const portNumber = seriesIncludePortNumberInput.checked ? physicalPortNumber(port.name) : "";
  const portPrefix = portNumber ? `${portNumber}_` : "";
  return `${portPrefix}${seriesDescriptionInput.value.trim()}${seriesNumber}${seriesPostfixInput.value.trim()}`;
}

function updateSeriesDescriptionPreview() {
  const port = state.ports.find((candidate) => candidate.name === seriesStartPort.value) || { name: "ge-0/0/1" };
  const firstNumber = parseInt(seriesStartNumberInput.value || "0", 10);
  const scopeText = seriesConfigurationScopeInput.checked
    ? "description plus Configure-tab mode/VLAN commands"
    : "description command only";
  seriesDescriptionPreview.replaceChildren(
    "Example description: ",
    Object.assign(document.createElement("code"), { textContent: seriesDescription(port, firstNumber) }),
    ` — ${scopeText}`
  );
}

function buildDesiredLines(port, description) {
  const vlanMembers = parseMembershipInput();
  const modeKeyword = port.modeKeyword || state.modeKeyword || "interface-mode";
  const lines = [`set interfaces ${port.name} unit 0 family ethernet-switching ${modeKeyword} ${portModeInput.value}`];
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
  const lines = [`# Numbered series (${scopeLabel}): ${prefix || "Port"} ${firstNumber}-${firstNumber + count - 1}`, ""];
  ports.forEach((port, index) => {
    const description = seriesDescription(port, firstNumber + index);
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
  activateWorkspaceTab("review");
}

function createVlanCommand() {
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
  state.vlans.push({ name, value: String(vlanId) });
  state.vlans.sort((a, b) => Number(a.value) - Number(b.value));
  renderVlanChoices();
  newVlanNameInput.value = "";
  newVlanIdInput.value = "";
  connectionStatus.textContent = `Added VLAN ${name} (${vlanId}) to the preview`;
  connectionStatus.className = "status-pill";
}

function applySelectedPorts() {
  updateConfig(true);
}

function addVlanToSelected() {
  const selectedPorts = state.ports.filter((port) => state.selected.has(port.name));
  const vlanList = parseMembershipInput();
  const lines = [];

  selectedPorts.forEach((port) => {
    const iface = port.name;
    vlanList.forEach((vlan) => {
      lines.push(`set interfaces ${iface} unit 0 family ethernet-switching vlan members ${vlan}`);
    });
  });

  appendConfigLines(lines);
}

function removeVlanFromSelected() {
  const selectedPorts = state.ports.filter((port) => state.selected.has(port.name));
  const vlanList = parseMembershipInput();
  const lines = [];

  selectedPorts.forEach((port) => {
    const iface = port.name;
    vlanList.forEach((vlan) => {
      lines.push(`delete interfaces ${iface} unit 0 family ethernet-switching vlan members ${vlan}`);
    });
  });

  appendConfigLines(lines);
}

function setDescriptionForSelected() {
  const selectedPorts = state.ports.filter((port) => state.selected.has(port.name));
  const description = descriptionInput.value.trim();
  const lines = [];

  selectedPorts.forEach((port) => {
    const iface = port.name;
    const escapedDescription = description.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
    lines.push(`set interfaces ${iface} description \"${escapedDescription}\"`);
  });

  appendConfigLines(lines);
}

function selectedInterfaceNames() {
  return state.ports.filter((port) => state.selected.has(port.name)).map((port) => port.name);
}

function appendPortAdministrationCommands(commands, message) {
  if (!commands.length) {
    connectionStatus.textContent = "Select at least one port first";
    connectionStatus.className = "status-pill error";
    return;
  }
  appendConfigLines(commands);
  connectionStatus.textContent = message;
  connectionStatus.className = "status-pill";
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

function clearSelectedPortConfiguration() {
  const interfaces = selectedInterfaceNames();
  if (!interfaces.length) {
    appendPortAdministrationCommands([], "");
    return;
  }
  const portList = interfaces.join(", ");
  if (!window.confirm(`Remove the entire interface configuration for: ${portList}?\n\nThis appends delete interfaces commands to the preview; it does not push them yet.`)) {
    return;
  }
  appendPortAdministrationCommands(
    interfaces.map((iface) => `delete interfaces ${iface}`),
    `Appended full configuration removal for ${interfaces.length} port${interfaces.length === 1 ? "" : "s"}`
  );
}

async function previewDeviceDiff() {
  if (!configOutput.value.trim()) {
    connectionStatus.textContent = "Build a configuration before requesting a device comparison";
    connectionStatus.className = "status-pill error";
    return;
  }
  const previewedConfig = configOutput.value;
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
    if (configOutput.value === previewedConfig) {
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
    previewBtn.disabled = false;
    previewBtn.textContent = "Run show | compare";
    updatePushAvailability();
  }
}

async function pushToSwitch() {
  if (state.pendingConfirmation) {
    connectionStatus.textContent = "Confirm the pending commit before pushing another change";
    connectionStatus.className = "status-pill error";
    return;
  }
  if (state.lastPreviewConfig !== configOutput.value) {
    connectionStatus.textContent = "Run show | compare for the current configuration before pushing";
    connectionStatus.className = "status-pill error";
    return;
  }
  if (!window.confirm("Apply this configuration using a 5-minute confirmed commit? It will roll back unless you confirm it afterward.")) {
    return;
  }
  pushBtn.disabled = true;
  pushBtn.textContent = "Pushing configuration…";
  confirmBtn.disabled = true;
  connectionStatus.textContent = "Pushing config…";
  connectionStatus.className = "status-pill";

  try {
    const response = await fetch("/api/push", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(connectionPayload({ config: configOutput.value }))
    });

    const payload = await response.json();
    if (!response.ok || !payload.ok) {
      throw new Error(payload.error || "Push failed");
    }

    state.pendingConfirmation = !!payload.pendingConfirmation;
    state.pendingTarget = state.pendingConfirmation
      ? { host: hostInput.value.trim(), username: usernameInput.value.trim(), deviceId: state.savedDeviceId }
      : null;
    if (state.pendingConfirmation) {
      startConfirmationWindow(payload.confirmMinutes || 5);
    } else {
      setDeploymentReady("The change completed without a pending confirmation window.");
    }
    connectionStatus.textContent = state.pendingConfirmation
      ? `Config applied. Confirm within ${payload.confirmMinutes || 5} minutes or Junos will roll it back.`
      : "Config pushed successfully";
    connectionStatus.className = "status-pill connected";
  } catch (error) {
    pushBtn.textContent = "Push with rollback protection";
    updatePushAvailability();
    connectionStatus.textContent = `Push error: ${error.message}`;
    connectionStatus.className = "status-pill error";
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
        password: passwordInput.value
      })
    });
    const payload = await response.json();
    if (!response.ok || !payload.ok) throw new Error(payload.error || "Confirmation failed");
    setDeploymentReady("Commit confirmed successfully. Rollback protection is cleared and the workspace is ready for another push.");
    connectionStatus.textContent = "Commit confirmed; automatic rollback canceled";
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
  updateConnectionHint();
  updateConfig();
}));
deviceNameInput.addEventListener("input", () => updateConfig());
descriptionInput.addEventListener("input", () => {
  updateIntendedChangeSummary();
  updateConfig();
});
portModeInput.addEventListener("change", () => {
  renderVlanChoices();
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
});
selectionModeInput.addEventListener("change", () => {
  state.lastSelected = null;
  state.selected = new Set();
  updateSelectionModeHint();
  render();
});
shiftOffsetInput.addEventListener("input", updateMoveSummary);
[seriesConfigurationScopeInput, seriesStartPort, seriesCountInput, seriesStartNumberInput, seriesDescriptionInput, seriesPostfixInput, seriesIncludePortNumberInput]
  .forEach((input) => input.addEventListener("input", updateSeriesDescriptionPreview));

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
document.getElementById("moveConfigBtn").addEventListener("click", buildMoveConfiguration);
document.getElementById("buildSeriesBtn").addEventListener("click", buildSeriesConfiguration);
document.getElementById("createVlanBtn").addEventListener("click", createVlanCommand);
document.getElementById("applyBtn").addEventListener("click", applySelectedPorts);
document.getElementById("addVlanBtn").addEventListener("click", addVlanToSelected);
document.getElementById("removeVlanBtn").addEventListener("click", removeVlanFromSelected);
document.getElementById("setDescriptionBtn").addEventListener("click", setDescriptionForSelected);
document.getElementById("enablePortsBtn").addEventListener("click", enableSelectedPorts);
document.getElementById("disablePortsBtn").addEventListener("click", disableSelectedPorts);
document.getElementById("clearPortsBtn").addEventListener("click", clearSelectedPortConfiguration);
connectBtn.addEventListener("click", () => connectToSwitch());
savedDeviceInput.addEventListener("change", selectSavedDevice);
quickConnectBtn.addEventListener("click", () => connectToSwitch());
saveDeviceBtn.addEventListener("click", saveCurrentDevice);
refreshNowBtn.addEventListener("click", () => connectToSwitch({ isRefresh: true }));
refreshIntervalInput.addEventListener("change", configureAutoRefresh);
richardViewBtn.addEventListener("click", () => {
  state.richardView = !state.richardView;
  portGrid.classList.toggle("richard-view", state.richardView);
  richardViewBtn.setAttribute("aria-pressed", String(state.richardView));
  richardViewBtn.textContent = state.richardView ? "Exit Richard View" : "Richard View";
});
previewBtn.addEventListener("click", previewDeviceDiff);
pushBtn.addEventListener("click", pushToSwitch);
confirmBtn.addEventListener("click", confirmCommit);
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

render();
activateWorkspaceTab("configure");
updateSelectionModeHint();
updateSeriesDescriptionPreview();
setDeploymentReady();
checkBackendCompatibility().then((compatible) => {
  if (compatible) {
    loadDefaults();
    loadSavedDevices();
  }
});
