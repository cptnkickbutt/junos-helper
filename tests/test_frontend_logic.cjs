const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const scriptPath = path.join(__dirname, "..", "script.js");
const source = fs.readFileSync(scriptPath, "utf8");

function runSourceSection(startMarker, endMarker, context) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  assert.notEqual(start, -1, `Missing source marker: ${startMarker}`);
  assert.notEqual(end, -1, `Missing source marker: ${endMarker}`);
  vm.runInContext(source.slice(start, end), context, { filename: scriptPath });
}

function loadSourceSection(startMarker, endMarker, context = {}) {
  vm.createContext(context);
  runSourceSection(startMarker, endMarker, context);
  return context;
}

function navigationContext(editingTab) {
  const buttons = ["watch", "configure", "move", "series", "vlans", "custom", "review"].map((tab) => ({
    dataset: { tab }, classList: { toggle() {} }, setAttribute() {},
    focus() { this.focused = true; }
  }));
  const context = loadSourceSection("function activateWorkspaceTab", "function updateSelectionModeHint", {
    state: { lastEditingTab: "configure", configQueue: [], nextQueueId: 1, discoveredVlans: [], vlans: [] },
    tabButtons: buttons,
    tabPanels: buttons.map((button) => ({
      dataset: { panel: button.dataset.tab }, classList: { toggle() {} }, hidden: true
    }))
  });
  context.activateWorkspaceTab(editingTab);
  context.activateWorkspaceTab("review");
  return context;
}

test("Live watch does not replace the most recent editing tab as the queue return destination", () => {
  const context = navigationContext("custom");
  context.activateWorkspaceTab("watch");
  assert.equal(context.state.lastEditingTab, "custom");
  assert.equal(context.tabPanels.find((panel) => !panel.hidden).dataset.panel, "watch");
});

function quickTaskContext() {
  const context = loadSourceSection("function isDescriptionOnlyDeployment", "function updatePushAvailability", {
    state: {
      ports: [{ name: "ge-0/0/1", currentMode: "access", currentDescription: "Camera", currentSetLines: [] },
        { name: "xe-0/0/48", currentMode: "trunk", currentDescription: "48_UPLINK_CORE", currentSetLines: [] }],
      manualProtectedPorts: [], bridgeServices: [], discoveredVlans: [], protectionHost: "switch"
    }, hostInput: { value: "switch" }
  });
  runSourceSection("function buildMacTopology", "function macRecordsForPorts", context);
  return context;
}

function commandActionContext(tab = "configure") {
  const context = navigationContext(tab);
  runSourceSection("function activateWorkspaceTab", "[hostInput, usernameInput]", context);
  Object.assign(context.state, {
    ports: [
      { name: "ge-0/0/1", index: 0, currentDescription: "01_BT_306", currentSetLines: [
        'set interfaces ge-0/0/1 description "01_BT_306"',
        "set interfaces ge-0/0/1 unit 300 encapsulation vlan-bridge"
      ] },
      { name: "ge-0/0/2", index: 1, currentSetLines: [] }
    ],
    selected: new Set(["ge-0/0/1"]), vlans: [{ name: "CUSTOMER", value: "310" }],
    discoveredVlans: [{ name: "CUSTOMER", value: "310" }], irbUnits: [],
    bridgeServices: [{ name: "SERVICE", interfaces: ["ge-0/0/1.300", "xe-0/0/48.300"] }]
  });
  const input = (value = "", checked = false) => ({ value, checked });
  Object.assign(context, {
    configOutput: input(), connectionStatus: {}, deviceNameInput: input("BT"),
    hostInput: input("switch"), usernameInput: input("user"), descriptionInput: input("AP"),
    portModeInput: input("access"), nativeVlanInput: input(),
    vlanMembershipInput: { querySelectorAll: () => [{ value: "CUSTOMER" }] },
    appendModeFieldInput: input("", true), appendVlanFieldInput: input(),
    appendNativeVlanFieldInput: input(), appendDescriptionFieldInput: input(),
    shiftOffsetInput: input("1"), moveUpdateDescriptionNumberInput: input(),
    seriesStartPort: input("ge-0/0/1"), seriesCountInput: input("1"), seriesStartNumberInput: input("1"),
    seriesDescriptionInput: input("APT_"), seriesPostfixInput: input(),
    seriesIncludePortNumberInput: input("", true), seriesPadNumbersInput: input(), seriesConfigurationScopeInput: input(),
    descriptionTransformSourceInput: input("{port}_{site}_{apt}"),
    descriptionTransformTargetInput: input("{port}_{site}_RENAMED_{apt}"),
    newVlanNameInput: input("NEW"), newVlanIdInput: input("311"),
    customCommandTemplateInput: input("set interfaces {port} mtu 9216"),
    customCommandSummary: {}, customCommandPreview: {}, MAX_DEPLOYMENT_CONFIG_CHARS: 65536,
    logicalServiceSourceInput: input("0:0"),
    irbVlanInput: input("CUSTOMER"), irbUnitInput: input("310"), irbAddressInput: input("192.0.2.1/24"),
    qinqCustomerPortInput: input("ge-0/0/1"), qinqUplinkPortInput: input("xe-0/0/48"),
    qinqServiceNameInput: input("NEW_QINQ"), qinqOuterTagInput: input("200"), qinqInnerTagInput: input("300"),
    qinqMtuInput: input("9216"), irbSummary: {}, qinqSummary: {},
    window: { confirm: () => true },
    invalidatePreview() { context.state.lastPreviewConfig = null; }, renderConfigQueue() {}, render() {},
    renderVlanChoices() {}, populateServiceChoices() {}, updateDescriptionTransformPreview() {},
    fetch: () => { assert.fail("Staging commands must never execute them"); }
  });
  context.activateWorkspaceTab(tab);
  return context;
}

function utilityContext() {
  const element = () => ({ children: [], textContent: "", hidden: false, disabled: false,
    replaceChildren(...children) { this.children = children; },
    append(...children) { this.children.push(...children); },
    appendChild(child) { this.children.push(child); },
    set innerHTML(value) { assert.fail("History and device data must use plain text"); }
  });
  const dialog = () => ({ open: false, showModal() { this.open = true; }, close() { this.open = false; } });
  const context = loadSourceSection("function cacheDeviceData", "function savedDeviceGroup", {
    state: { deviceDataSnapshots: new Map(), activityEvents: [], activityBefore: null, activityLoadId: 0,
      browserErrors: [], browserErrorsFlushing: false },
    hostInput: { value: "switch-a" }, deviceNameInput: { value: "Access A" },
    deviceDataDialog: dialog(), activityLogDialog: dialog(), optionsDialog: dialog(),
    deviceDataOutput: element(), deviceDataSummary: element(),
    activityLogScope: { value: "active" }, activityLogView: { value: "changes" },
    activityLogSummary: element(), activityLogList: element(), refreshActivityLogBtn: element(), olderActivityLogBtn: element(),
    URLSearchParams, document: { createElement: element },
    fetch: async () => { assert.fail("This action must not make a request"); }
  });
  context.optionsDialog.open = true;
  return context;
}

function historyEvent(id, updates = {}) {
  return { id, timestamp: "2026-10-27T16:00:00+00:00", host: "switch-a", operation: "Protected push",
    status: "awaiting-confirmation", severity: "info", message: "Configuration applied", details: { commandCount: 2 }, ...updates };
}

test("device data popup uses the target's timestamped snapshot and preserves output and errors", () => {
  const context = utilityContext();
  context.cacheDeviceData({ host: "SWITCH-A", deviceName: "Access A", collectedAt: "2026-10-27T16:00:00+00:00",
    debug: { interfaceCount: 2 }, results: [{ command: "show interfaces terse", output: "ports on A", error: "partial read" }] });
  context.cacheDeviceData({ host: "switch-b", deviceName: "Access B", debug: {}, results: [{ command: "show version", output: "data from B" }] });
  context.showDeviceData();
  assert.match(context.deviceDataSummary.textContent, /Access A.*SWITCH-A.*Collected/);
  assert.match(context.deviceDataOutput.textContent, /ports on A/);
  assert.match(context.deviceDataOutput.textContent, /Error: partial read/);
  assert.doesNotMatch(context.deviceDataOutput.textContent, /data from B/);
  assert.equal(context.optionsDialog.open, false);
  assert.equal(context.deviceDataDialog.open, true);
  assert.equal(context.state.returnToOptionsButton, "openDeviceDataBtn");
  context.hostInput.value = "switch-c";
  context.showDeviceData();
  assert.match(context.deviceDataSummary.textContent, /No data.*switch-c/);
  assert.doesNotMatch(context.deviceDataOutput.textContent, /ports on A/);
});

test("activity log filters active device, paginates, and renders untrusted messages as text", async () => {
  const context = utilityContext();
  const requests = [];
  context.fetch = async (url) => {
    requests.push(url);
    return { ok: true, json: async () => ({ ok: true, events: requests.length === 1
      ? [historyEvent(3, { message: '<script>alert("test")</script>' })]
      : [historyEvent(3), historyEvent(2)], hasMore: requests.length === 1, nextBefore: 3 }) };
  };
  await context.showActivityLog();
  assert.match(requests[0], /host=switch-a/);
  assert.match(requests[0], /view=changes/);
  assert.equal(context.activityLogList.children[0].children[2].textContent, '<script>alert("test")</script>');
  await context.loadActivityLog(true);
  assert.match(requests[1], /before=3/);
  assert.deepEqual(Array.from(context.state.activityEvents, (event) => event.id), [3, 2]);
  context.activityLogScope.value = "all";
  await context.loadActivityLog();
  assert.doesNotMatch(requests[2], /host=/);
  context.hostInput.value = "";
  context.activityLogScope.value = "active";
  await context.loadActivityLog();
  assert.equal(requests.length, 3);
  assert.match(context.activityLogSummary.textContent, /Choose a target/);
});

test("out-of-order history requests cannot display a previous device or filter", async () => {
  const context = utilityContext();
  let resolveFirst;
  context.fetch = () => new Promise((resolve) => { resolveFirst = resolve; });
  const first = context.loadActivityLog();
  context.activityLogScope.value = "all";
  context.fetch = async () => ({ ok: true, json: async () => ({ ok: true, events: [historyEvent(2)], hasMore: false }) });
  await context.loadActivityLog();
  resolveFirst({ ok: true, json: async () => ({ ok: true, events: [historyEvent(1)], hasMore: false }) });
  await first;
  assert.deepEqual(Array.from(context.state.activityEvents, (event) => event.id), [2]);
  assert.match(context.activityLogSummary.textContent, /All devices/);
  assert.match(context.activityEventMessage(historyEvent(1, { confirmationState: "window-elapsed" })), /Verify the current switch state/);
  assert.doesNotMatch(context.activityEventMessage(historyEvent(1, { confirmationState: "window-elapsed" })), /rolled back/);
});

test("browser logging failures retain messages for retry without recursively throwing", async () => {
  const context = utilityContext();
  context.state.browserErrors.push({ message: "Script failed", host: "switch-a" });
  context.fetch = async () => { throw new Error("Backend offline"); };
  await context.flushBrowserErrors();
  assert.equal(context.state.browserErrors.length, 1);
  assert.equal(context.state.browserErrorsFlushing, false);
  context.fetch = async () => ({ ok: true });
  await context.flushBrowserErrors();
  assert.equal(context.state.browserErrors.length, 0);
});

const commandActions = [
  ["applySelectedPorts", "configure"], ["appendSelectedFields", "configure"],
  ["removeVlanFromSelected", "configure"], ["enableSelectedPorts", "configure"],
  ["disableSelectedPorts", "configure"], ["clearSelectedPortConfiguration", "configure"],
  ["buildIrbConfiguration", "configure"], ["buildQinqConfiguration", "configure"],
  ["buildLogicalServiceMove", "configure"], ["buildMoveConfiguration", "move"],
  ["buildSeriesConfiguration", "series"], ["buildDescriptionTransformConfiguration", "series"],
  ["createVlanCommand", "vlans"], ["buildCustomCommands", "custom"]
];

test("custom templates expand in inventory order for only selected ports and preserve staged work", () => {
  const context = commandActionContext("custom");
  context.state.ports.push({ name: "et-0/0/0:1", index: 2 });
  context.state.selected = new Set(["et-0/0/0:1", "ge-0/0/1"]);
  context.state.configManual = true;
  context.configOutput.value = "set vlans NEW vlan-id 311";
  context.customCommandTemplateInput.value = '# Comment\r\nset interfaces {port} description "Port {port}"\r\n\r\ndelete interfaces {port} unit 0 family ethernet-switching vlan members OLD';
  context.updateCustomCommandPreview();
  const expected = [
    'set interfaces ge-0/0/1 description "Port ge-0/0/1"',
    'delete interfaces ge-0/0/1 unit 0 family ethernet-switching vlan members OLD',
    'set interfaces et-0/0/0:1 description "Port et-0/0/0:1"',
    'delete interfaces et-0/0/0:1 unit 0 family ethernet-switching vlan members OLD'
  ].join("\n");
  assert.equal(context.customCommandPreview.textContent, expected);
  context.buildCustomCommands();
  assert.equal(context.configOutput.value, `set vlans NEW vlan-id 311\n${expected}`);
  assert.match(context.customCommandSummary.textContent, /4 commands: 0 global \(once\), 2 selected ports/);
});

test("invalid custom templates reject the entire batch without changing staged work or navigation", () => {
  for (const template of [
    "", "# Only a comment", "set", "delete", "show interfaces {port}",
    "set interfaces {port} disable; commit", 'set interfaces {port} description "unterminated',
    "set interfaces {port} description `test`", "set interfaces {port} description $(test)",
    "set interfaces {port} disable\u0000", "set interfaces {port} disable\ncommit",
    "set interfaces {port} description {unknown}", "set interfaces {port",
    "set system host-name foo | save /tmp/test",
    "set protocols rstp interface {port} disable; commit"
  ]) {
    const context = commandActionContext("custom");
    context.configOutput.value = "# Keep staged work";
    context.customCommandTemplateInput.value = template;
    context.buildCustomCommands();
    assert.equal(context.configOutput.value, "# Keep staged work", template);
    assert.equal(context.tabPanels.find((panel) => !panel.hidden).dataset.panel, "custom", template);
    assert.ok(context.customCommandPlan().error, template);
  }
  const context = commandActionContext("custom");
  context.state.selected.clear();
  assert.match(context.customCommandPlan().error, /Select/);
  context.state.selected.add("ge-0/0/1");
  context.customCommandTemplateInput.value = "set interfaces {port} disable\n".repeat(501);
  assert.match(context.customCommandPlan().error, /500-command/);
  context.customCommandTemplateInput.value = `set interfaces {port} description "${"a".repeat(65536)}"`;
  assert.match(context.customCommandPlan().error, /64 KB/);
});

test("global custom commands run once with no selected ports and once with many ports", () => {
  for (const selected of [[], ["ge-0/0/1", "ge-0/0/2"]]) {
    const context = commandActionContext("custom");
    context.state.selected = new Set(selected);
    context.customCommandTemplateInput.value = "set system ntp server 192.0.2.123\ndelete protocols rstp";
    context.buildCustomCommands();
    assert.equal(context.configOutput.value, context.customCommandTemplateInput.value);
    assert.equal(context.customCommandPlan().globalCount, 2);
    assert.equal(context.customCommandPlan().portCount, 0);
    assert.equal(context.tabPanels.find((panel) => !panel.hidden).dataset.panel, "review");
  }
});

test("mixed templates preserve command blocks and expand port and device variables", () => {
  const context = commandActionContext("custom");
  context.state.ports.push({ name: "et-0/1/12:1", index: 2 });
  context.state.selected = new Set(["et-0/1/12:1", "ge-0/0/1"]);
  context.customCommandTemplateInput.value = [
    'set snmp location "{device} at {host}"',
    'set interfaces {port} description "{device}_{portNumber}_{index}_{{literal}}"',
    'set protocols rstp interface {port} disable',
    'set system ntp server 192.0.2.123',
    'delete interfaces {port} disable'
  ].join("\n");
  context.buildCustomCommands();
  assert.equal(context.configOutput.value, [
    'set snmp location "BT at switch"',
    'set interfaces ge-0/0/1 description "BT_1_1_{literal}"',
    'set protocols rstp interface ge-0/0/1 disable',
    'set interfaces et-0/1/12:1 description "BT_12_2_{literal}"',
    'set protocols rstp interface et-0/1/12:1 disable',
    'set system ntp server 192.0.2.123',
    'delete interfaces ge-0/0/1 disable',
    'delete interfaces et-0/1/12:1 disable'
  ].join("\n"));
  context.state.selected.clear();
  assert.match(context.customCommandPlan().error, /Select/);
  context.customCommandTemplateInput.value = 'set system host-name {device}';
  context.deviceNameInput.value = "";
  assert.match(context.customCommandPlan().error, /no value.*device/);
  context.customCommandTemplateInput.value = 'set system host-name {host}';
  context.hostInput.value = 'bad; commit';
  assert.match(context.customCommandPlan().error, /separators/);
});

test("custom commands account for existing editor and queued commands before staging", () => {
  const context = commandActionContext("custom");
  context.state.configManual = true;
  context.configOutput.value = "delete system ntp";
  context.state.configQueue = [{ label: "large batch", config: "set system ntp server 192.0.2.1\n".repeat(499) }];
  context.buildCustomCommands();
  assert.equal(context.configOutput.value, "delete system ntp");
  assert.match(context.customCommandSummary.textContent, /combined editor and queue/);
  assert.equal(context.tabPanels.find((panel) => !panel.hidden).dataset.panel, "custom");
});

test("failed push check preserves editor and queue, exposes Junos errors, and allows correction and retry", async () => {
  const context = commandActionContext("custom");
  const original = "set system host-name typo";
  context.configOutput.value = original;
  context.state.configManual = true;
  context.state.configQueue = [{ label: "Queued", config: "set system ntp server 192.0.2.123" }];
  context.state.lastPreviewConfig = context.combinedDeploymentConfig();
  Object.assign(context, {
    pushBtn: {}, confirmBtn: {}, previewState: {}, compareOutput: {},
    queueMatchesCurrentTarget: () => true, connectionPayload: (value) => value,
    requests: [], startConfirmationWindow() {},
    fetch: async (url) => {
      context.requests.push(url);
      return { ok: false, json: async () => ({ ok: false, stage: "commit-check",
        error: "configuration check-out failed", output: "error: invalid host-name" }) };
    }
  });
  context.activateWorkspaceTab("review");
  await context.pushToSwitch();
  assert.equal(context.configOutput.value, original);
  assert.equal(context.state.configQueue.length, 1);
  assert.equal(context.state.lastPreviewConfig, null);
  assert.equal(context.state.deploymentInProgress, false);
  assert.equal(!!context.state.pendingConfirmation, false);
  assert.match(context.compareOutput.textContent, /No commit was sent/);
  assert.match(context.compareOutput.textContent, /invalid host-name/);
  assert.equal(context.tabPanels.find((panel) => !panel.hidden).dataset.panel, "review");
  context.configOutput.value = "set system host-name corrected";
  await context.pushToSwitch();
  assert.equal(context.requests.length, 1, "a new comparison is required after failure");
  context.state.lastPreviewConfig = context.combinedDeploymentConfig();
  context.fetch = async () => ({ ok: true, json: async () => ({ ok: true, pendingConfirmation: true }) });
  await context.pushToSwitch();
  assert.equal(context.state.pendingConfirmation, true);
});

test("RSTP custom command expands every selected port and appends into Review & deploy", () => {
  const context = commandActionContext("custom");
  context.state.selected.add("ge-0/0/2");
  context.state.ports.push({ name: "et-0/0/0:1", index: 2 });
  context.state.selected.add("et-0/0/0:1");
  context.customCommandTemplateInput.value = "set protocols rstp interface {port} disable";
  context.updateCustomCommandPreview();
  const expected = [
    "set protocols rstp interface ge-0/0/1 disable",
    "set protocols rstp interface ge-0/0/2 disable",
    "set protocols rstp interface et-0/0/0:1 disable"
  ].join("\n");
  assert.equal(context.customCommandPreview.textContent, expected);
  context.buildCustomCommands();
  assert.equal(context.configOutput.value, expected);
  assert.equal(context.tabPanels.find((panel) => !panel.hidden).dataset.panel, "review");
  assert.equal(context.isDescriptionOnlyDeployment(expected), false);
  assert.match(quickTaskContext().quickTaskValidationError(expected), /rollback protection/);
  context.customCommandTemplateInput.value = "delete protocols rstp interface {port} disable";
  assert.equal(context.customCommandPlan().lines.length, 3);
  context.customCommandTemplateInput.value = "delete protocols rstp interface {port}";
  assert.equal(context.customCommandPlan().lines.length, 3);
});

test("every command action stages commands, opens and focuses review, and remembers its editing tab", () => {
  for (const [action, tab] of commandActions) {
    const context = commandActionContext(tab);
    if (action === "buildLogicalServiceMove") context.state.selected = new Set(["ge-0/0/2"]);
    if (action === "buildQinqConfiguration") context.state.ports[0].currentSetLines = [];
    context[action]();
    assert.match(context.configOutput.value, /^(set|delete) /m, `${action} must stage actionable commands`);
    assert.equal(context.tabPanels.find((panel) => !panel.hidden).dataset.panel, "review", action);
    assert.equal(context.tabButtons.find((button) => button.dataset.tab === "review").focused, true, action);
    assert.equal(context.state.lastEditingTab, tab, action);
  }
});

test("command actions do not mutate the preview or navigate during deployment or a pending confirmation", () => {
  for (const [action, tab] of commandActions) {
    for (const flag of ["deploymentInProgress", "pendingConfirmation"]) {
      const context = commandActionContext(tab);
      context.state[flag] = true;
      context.configOutput.value = "# Keep current work";
      context[action]();
      assert.equal(context.configOutput.value, "# Keep current work", `${action}: ${flag}`);
      assert.equal(context.tabPanels.find((panel) => !panel.hidden).dataset.panel, tab, `${action}: ${flag}`);
    }
  }
});

test("rejected or canceled command actions keep the editing tab and existing preview", () => {
  for (const action of ["applySelectedPorts", "enableSelectedPorts", "disableSelectedPorts", "clearSelectedPortConfiguration", "createVlanCommand"]) {
    const context = commandActionContext();
    context.configOutput.value = "# Keep current work";
    context.state.selected.clear();
    context.newVlanNameInput.value = "";
    context[action]();
    assert.equal(context.configOutput.value, "# Keep current work", action);
    assert.equal(context.tabPanels.find((panel) => !panel.hidden).dataset.panel, "configure", action);
  }
  const context = commandActionContext();
  context.window.confirm = () => false;
  context.clearSelectedPortConfiguration();
  assert.equal(context.configOutput.value, "");
  assert.equal(context.tabPanels.find((panel) => !panel.hidden).dataset.panel, "configure");
});

test("quick tasks accept mixed eligible batches and reject a single protected or risky command", () => {
  const context = quickTaskContext();
  const eligible = 'set interfaces ge-0/0/1 disable\nset vlans NEW vlan-id 310\nset interfaces ge-0/0/1 description Camera';
  assert.equal(context.quickTaskValidationError(eligible), "");
  assert.match(context.quickTaskValidationError(eligible + '\nset interfaces xe-0/0/48 disable'), /Uplink/);
  assert.match(context.quickTaskValidationError(eligible + '\ndelete interfaces ge-0/0/1'), /rollback protection/);
  context.state.manualProtectedPorts = ["ge-0/0/1"];
  assert.match(context.quickTaskValidationError(eligible), /Manually protected/);
  context.state.ports[0].currentDescription = "Changed description";
  assert.equal(context.portProtectionReason(context.state.ports[0]), "Manually protected");
});

test("quick task eligibility rejects VLAN collisions, comments, stale targets, and service ports", () => {
  const context = quickTaskContext();
  context.state.discoveredVlans = [{ name: "OLD", value: "310" }];
  assert.match(context.quickTaskValidationError('set vlans NEW vlan-id 310'), /unused/);
  assert.match(context.quickTaskValidationError('set vlans OLD vlan-id 311'), /unused/);
  assert.match(context.quickTaskValidationError('set vlans NEW vlan-id 311\nset vlans OTHER vlan-id 311'), /unused/);
  assert.match(context.quickTaskValidationError('# nothing'), /Build/);
  context.state.ports[0].currentSetLines = ['set interfaces ge-0/0/1 unit 300 vlan-id 300'];
  assert.match(context.quickTaskValidationError('set interfaces ge-0/0/1 disable'), /Logical service/);
  context.hostInput.value = "another-switch";
  assert.match(context.quickTaskValidationError('set vlans NEW vlan-id 311'), /Connect/);
});

test("queue returns to the previous editing tab only after a successful queue", () => {
  for (const tab of ["configure", "series", "move", "vlans", "custom"]) {
    const context = navigationContext(tab);
    Object.assign(context, {
      configOutput: { value: "set interfaces ge-0/0/1 description AP" },
      configQueueLabelInput: { value: "" }, hostInput: { value: "switch" },
      connectionStatus: {}, MAX_CONFIG_QUEUE_BATCHES: 8, MAX_DEPLOYMENT_CONFIG_CHARS: 65536,
      queueMatchesCurrentTarget: () => true, safeQueueLabel: (value) => value,
      composeDeploymentConfig: () => "config", combinedDeploymentConfig: () => "config",
      isDescriptionOnlyDeployment: () => true, replaceConfig() {}, renderConfigQueue() {}
    });
    runSourceSection("function queueCurrentConfig", "function removeQueuedConfig", context);
    context.state.pendingConfirmation = true;
    context.queueCurrentConfig();
    assert.equal(context.tabPanels.find((panel) => !panel.hidden).dataset.panel, "review");
    context.state.pendingConfirmation = false;
    context.queueCurrentConfig();
    assert.equal(context.state.configQueue.length, 1);
    assert.equal(context.tabPanels.find((panel) => !panel.hidden).dataset.panel, tab);
    assert.ok(context.tabButtons.find((button) => button.dataset.tab === tab).focused);
  }
});

test("successful quick commits and confirmations return to editing; failures stay on review", async () => {
  for (const operation of ["quickCommitChanges", "quickTasks", "confirmCommit"]) {
    for (const ok of [true, false]) {
      const context = navigationContext("series");
      Object.assign(context, {
        configQueueLabelInput: { value: "" }, configOutput: { value: "config" }, compareOutput: {},
        connectionStatus: {}, quickCommitBtn: {}, confirmBtn: {},
        hostInput: { value: "switch" }, usernameInput: { value: "user" }, passwordInput: { value: "" }, deviceNameInput: { value: "Switch" },
        MAX_DEPLOYMENT_CONFIG_CHARS: 65536,
        combinedDeploymentConfig: () => "config", queueMatchesCurrentTarget: () => true,
        isDescriptionOnlyDeployment: () => operation !== "quickTasks", connectionPayload: (value) => value,
        quickTaskValidationError: () => "", connectToSwitch: async () => {},
        configCommandCount: () => 1, renderConfigQueue() {}, setDeploymentReady() {},
        requests: [], fetch: async (url) => { context.requests.push(url); return { ok, json: async () => ({ ok }) }; }
      });
      context.state.pendingConfirmation = operation === "confirmCommit";
      context.state.confirmationDeadline = Date.now() + 60000;
      runSourceSection("function clearDeploymentWorkspace", "async function checkBackendCompatibility", context);
      runSourceSection("function parseVlanDefinitions", "function renderConfigQueue", context);
      runSourceSection("async function quickCommitChanges", "async function pushToSwitch", context);
      runSourceSection("async function confirmCommit", "[hostInput, usernameInput]", context);
      if (operation === "quickTasks") await context.quickCommitChanges();
      else await context[operation]();
      assert.equal(context.tabPanels.find((panel) => !panel.hidden).dataset.panel, ok ? "series" : "review");
      assert.equal(context.requests[0], operation === "confirmCommit" ? "/api/confirm"
        : operation === "quickTasks" ? "/api/quick-task-commit" : "/api/quick-description-commit");
    }
  }
});

function stagedVlansContext() {
  const context = commandActionContext("vlans");
  Object.assign(context, {
    configQueueLabelInput: { value: "" }, MAX_CONFIG_QUEUE_BATCHES: 8, MAX_DEPLOYMENT_CONFIG_CHARS: 65536,
    compareOutput: {}, chosenVlans: ["NEW"]
  });
  context.parseMembershipInput = () => context.chosenVlans;
  context.renderConfigQueue = () => context.syncAvailableVlans();
  return context;
}

function refreshVlanInventory(context, vlans) {
  context.payload = { vlanMemberships: vlans, host: "switch", bridgeServices: [], irbUnits: [] };
  runSourceSection("    state.discoveredVlans = payload.vlanMemberships", "    if (payload.debug)", context);
}

test("new VLAN survives full regeneration, queuing, inventory refresh and a second port batch", () => {
  const context = stagedVlansContext();
  context.createVlanCommand();
  assert.equal(context.state.vlans.some((vlan) => vlan.name === "NEW"), true);
  assert.equal(context.state.discoveredVlans.some((vlan) => vlan.name === "NEW"), false);
  context.activateWorkspaceTab("configure");
  context.applySelectedPorts();
  assert.match(context.configOutput.value, /set vlans NEW vlan-id 311/);
  assert.match(context.configOutput.value, /set interfaces ge-0\/0\/1 unit 0 family ethernet-switching vlan members NEW/);
  context.queueCurrentConfig();
  assert.equal(context.configOutput.value, "");
  refreshVlanInventory(context, [{ name: "CUSTOMER", value: "310" }]);
  assert.equal(context.state.vlans.some((vlan) => vlan.name === "NEW"), true);
  context.state.selected = new Set(["ge-0/0/2"]);
  context.applySelectedPorts();
  assert.match(context.configOutput.value, /set interfaces ge-0\/0\/2 unit 0 family ethernet-switching vlan members NEW/);
  context.queueCurrentConfig();
  refreshVlanInventory(context, [{ name: "CUSTOMER", value: "310" }]);
  const combined = context.combinedDeploymentConfig();
  assert.equal((combined.match(/set vlans NEW vlan-id 311/g) || []).length, 1);
  assert.match(combined, /interfaces ge-0\/0\/1 .* vlan members NEW/);
  assert.match(combined, /interfaces ge-0\/0\/2 .* vlan members NEW/);
  assert.equal(context.state.vlans.filter((vlan) => vlan.name === "NEW").length, 1);
});

test("queued VLANs remain selectable after appending fields and queued work controls the picker", () => {
  const context = stagedVlansContext();
  context.createVlanCommand();
  context.appendVlanFieldInput.checked = true;
  context.appendSelectedFields();
  context.queueCurrentConfig();
  refreshVlanInventory(context, [{ name: "CUSTOMER", value: "310" }]);
  assert.equal(context.state.vlans.some((vlan) => vlan.name === "NEW"), true);
  context.state.queueTargetHost = "other-switch";
  context.syncAvailableVlans();
  assert.equal(context.state.vlans.some((vlan) => vlan.name === "NEW"), false);
  context.state.queueTargetHost = "switch";
  context.syncAvailableVlans();
  assert.equal(context.state.vlans.some((vlan) => vlan.name === "NEW"), true);
  context.removeQueuedConfig(context.state.configQueue[0].id);
  assert.equal(context.state.vlans.some((vlan) => vlan.name === "NEW"), false);
  assert.equal(context.state.vlans.some((vlan) => vlan.name === "CUSTOMER"), true);
});

test("editing or clearing staged VLAN definitions removes stale choices without losing discovery", () => {
  const context = stagedVlansContext();
  context.configOutput.value = "# set vlans COMMENT vlan-id 200\nset vlans INVALID vlan-id 4095\nset vlans MANUAL vlan-id 312";
  context.renderConfigQueue();
  assert.deepEqual(Array.from(context.state.vlans, (vlan) => vlan.name), ["CUSTOMER", "MANUAL"]);
  context.configOutput.value = "";
  context.renderConfigQueue();
  assert.deepEqual(Array.from(context.state.vlans, (vlan) => vlan.name), ["CUSTOMER"]);
  context.configOutput.value = "set vlans MANUAL vlan-id 312";
  context.queueCurrentConfig();
  context.clearConfigQueue();
  assert.deepEqual(Array.from(context.state.vlans, (vlan) => vlan.name), ["CUSTOMER"]);
});

test("successful deployment retains newly committed VLANs until the next live inventory refresh", () => {
  const context = stagedVlansContext();
  context.state.discoveredVlans[0].l3Interface = "irb.310";
  context.createVlanCommand();
  context.queueCurrentConfig();
  context.clearDeploymentWorkspace();
  assert.equal(context.state.configQueue.length, 0);
  assert.equal(context.configOutput.value, "");
  assert.deepEqual(Array.from(context.state.vlans, (vlan) => vlan.name), ["CUSTOMER", "NEW"]);
  assert.equal(context.state.vlans[0].l3Interface, "irb.310");
  refreshVlanInventory(context, [{ name: "CUSTOMER", value: "310", l3Interface: "irb.310" }, { name: "NEW", value: "311" }]);
  assert.equal(context.state.vlans.filter((vlan) => vlan.name === "NEW").length, 1);
});

test("selection toggles handle mixed ports and follow staged enable/disable commands", () => {
  let config = "";
  const context = loadSourceSection("function selectionActionState", "async function saveSelectedProtection", {
    state: {
      ports: [{ name: "ge-0/0/1", currentDisabled: true }, { name: "ge-0/0/2", currentDisabled: false }],
      selected: new Set(["ge-0/0/1", "ge-0/0/2"]), manualProtectedPorts: ["ge-0/0/1"]
    }, combinedDeploymentConfig: () => config
  });
  assert.equal(context.selectionActionState().enable, false);
  assert.equal(context.selectionActionState().unprotect, false);
  config = "set interfaces ge-0/0/2 disable";
  assert.equal(context.selectionActionState().enable, true);
  config += "\ndelete interfaces ge-0/0/1 disable";
  assert.equal(context.selectionActionState().enable, false);
  context.state.manualProtectedPorts.push("ge-0/0/2");
  assert.equal(context.selectionActionState().unprotect, true);
  context.state.selected.clear();
  assert.equal(context.selectionActionState().enable, false);
  assert.equal(context.selectionActionState().unprotect, false);
});

test("floating selection shows port names in inventory order and hides when cleared", () => {
  const element = () => ({ children: [], replaceChildren() { this.children = []; },
    appendChild(child) { this.children.push(child); }, append(...children) { this.children.push(...children); } });
  const elements = Object.fromEntries(["floatingSelection", "floatingSelectionSummary", "floatingSelectionList"].map((id) => [id, element()]));
  const context = loadSourceSection("function updateSelectionSummary", "function updateIntendedChangeSummary", {
    state: { ports: [{ name: "ge-0/0/1" }, { name: "ge-0/0/2" }], selected: new Set(["ge-0/0/2", "ge-0/0/1"]) },
    selectionSummary: element(), selectionSummaryBox: element(), logicalServicesForPort: () => [],
    document: { getElementById: (id) => elements[id], createElement: element }
  });
  context.updateSelectionSummary();
  assert.equal(elements.floatingSelection.hidden, false);
  assert.equal(elements.floatingSelectionSummary.textContent, "2 selected ports");
  assert.deepEqual(elements.floatingSelectionList.children.map((item) => item.textContent), ["ge-0/0/1", "ge-0/0/2"]);
  context.state.selected.clear();
  context.updateSelectionSummary();
  assert.equal(elements.floatingSelection.hidden, true);
  assert.equal(elements.floatingSelectionList.children.length, 0);
});

function bounceContext() {
  const context = quickTaskContext();
  const input = (value = "", disabled = false) => ({ value, disabled });
  const elements = { portBounceResults: {}, bounceInterval: input("5") };
  Object.assign(context, {
    document: { getElementById: (id) => elements[id] },
    usernameInput: input("user"), passwordInput: input(), savedDeviceInput: input(),
    connectBtn: input(), quickConnectBtn: input("", true), refreshNowBtn: input(),
    renderConfigQueue() {}, requests: [], confirmations: [],
    connectionPayload: (extra) => ({ host: "switch", username: "user", ...extra }),
    configOutput: { value: "set vlans STAGED vlan-id 100" }, elements
  });
  context.window = { confirm: (message) => { context.confirmations.push(message); return true; } };
  context.state.selected = new Set(["ge-0/0/1"]);
  context.state.configQueue = [{ label: "Keep me", config: "set vlans QUEUED vlan-id 101" }];
  context.fetch = async (url, options) => {
    context.requests.push({ url, payload: JSON.parse(options.body) });
    assert.equal(context.state.bounceInProgress, true);
    assert.equal(context.state.deploymentInProgress, true);
    assert.equal(context.connectBtn.disabled, true);
    return { ok: true, json: async () => ({ ok: true, results: [{ port: "ge-0/0/1", ok: true }] }) };
  };
  runSourceSection("function bounceSelectionError", "async function saveSelectedProtection", context);
  runSourceSection("function selectedInterfaceNames", "function portConfigurationClearPlan", context);
  return context;
}

test("bounce buttons call their operational API without deploying or clearing staged configuration", async () => {
  for (const kind of ["link", "poe"]) {
    const context = bounceContext();
    await context.bounceSelectedPorts(kind);
    assert.deepEqual(context.requests, [{ url: "/api/ports/bounce", payload: {
      host: "switch", username: "user", ports: ["ge-0/0/1"], kind, interval: 5
    } }]);
    assert.match(context.confirmations[0], /runs immediately/);
    assert.match(context.confirmations[0], /ge-0\/0\/1/);
    assert.match(context.elements.portBounceResults.textContent, /request accepted \(5s\)/);
    assert.equal(context.elements.portBounceResults.className, "tool-summary valid");
    assert.equal(context.configOutput.value, "set vlans STAGED vlan-id 100");
    assert.equal(context.state.configQueue[0].label, "Keep me");
    assert.equal(context.state.bounceInProgress, false);
    assert.equal(context.state.deploymentInProgress, false);
    assert.equal(context.connectBtn.disabled, false);
    assert.equal(context.quickConnectBtn.disabled, true);
  }
});

test("bounce rejects protected ports, disabled ports, invalid intervals and stale targets", async () => {
  for (const scenario of ["protected", "disabled", "interval", "stale", "empty"]) {
    const context = bounceContext();
    if (scenario === "protected") context.state.selected = new Set(["xe-0/0/48"]);
    if (scenario === "disabled") context.state.ports[0].currentDisabled = true;
    if (scenario === "interval") context.elements.bounceInterval.value = "0";
    if (scenario === "stale") context.hostInput.value = "another-switch";
    if (scenario === "empty") context.state.selected.clear();
    await context.bounceSelectedPorts("link");
    assert.equal(context.requests.length, 0);
    assert.equal(context.confirmations.length, 0);
    assert.equal(context.elements.portBounceResults.className, "tool-summary error-text");
  }
});

test("bounce supports unprotected service ports and honors cancellation and busy state", async () => {
  const context = bounceContext();
  context.state.ports[0].currentMode = "unknown";
  context.state.ports[0].currentSetLines = ["set interfaces ge-0/0/1 unit 300 input-vlan-map push"];
  context.state.bridgeServices = [{ name: "SERVICE", interfaces: ["ge-0/0/1.300", "xe-0/0/48.300"] }];
  assert.equal(context.bounceSelectionError(), "");
  context.window.confirm = () => false;
  await context.bounceSelectedPorts("link");
  assert.equal(context.requests.length, 0);
  for (const flag of ["pendingConfirmation", "deploymentInProgress", "connectionInProgress", "protectionSaving"]) {
    context.state[flag] = true;
    context.window.confirm = () => { assert.fail("Busy actions must not prompt"); };
    await context.bounceSelectedPorts("poe");
    context.state[flag] = false;
  }
});

test("bounce renders partial failures and restores controls after a lost response", async () => {
  const context = bounceContext();
  context.fetch = async () => ({ ok: false, json: async () => ({ ok: false, error: "Partial failure", results: [
    { port: "ge-0/0/1", ok: true }, { port: "ge-0/0/2", ok: false, error: "Unsupported on this port" }
  ] }) });
  await context.bounceSelectedPorts("poe");
  assert.match(context.elements.portBounceResults.textContent, /ge-0\/0\/1: request accepted/);
  assert.match(context.elements.portBounceResults.textContent, /ge-0\/0\/2: Unsupported/);
  assert.equal(context.elements.portBounceResults.className, "tool-summary error-text");
  context.fetch = async () => { throw new Error("Connection lost"); };
  await context.bounceSelectedPorts("link");
  assert.match(context.elements.portBounceResults.textContent, /requests may have started/);
  assert.equal(context.state.deploymentInProgress, false);
  assert.equal(context.connectBtn.disabled, false);
});

function clearPortsContext(selected = ["mge-0/0/12", "mge-0/0/13"]) {
  const context = {
    state: {
      ports: ["mge-0/0/12", "mge-0/0/13", "xe-0/2/0", "mge-0/0/120"].map((name) => ({
        name, currentSetLines: []
      })),
      selected: new Set(selected),
      bridgeServices: [
        { name: "BT_APT_306_QnQ", interfaces: ["mge-0/0/12.3026", "xe-0/2/0.3026"] },
        { name: "BT_APT_307_QnQ", interfaces: ["mge-0/0/13.3027", "xe-0/2/0.3027"] },
        { name: "OTHER", interfaces: ["mge-0/0/120.3026"] }
      ]
    },
    connectionStatus: {}, batches: [], confirmations: [], activateWorkspaceTab() {}
  };
  context.window = { confirm: (message) => { context.confirmations.push(message); return true; } };
  context.appendConfigLines = (lines) => context.batches.push(Array.from(lines));
  return loadSourceSection("function selectedInterfaceNames", "async function previewDeviceDiff", context);
}

test("clearing previously cleared apartment ports removes both service endpoints and only paired uplink units", () => {
  const context = clearPortsContext();
  context.clearSelectedPortConfiguration();
  assert.deepEqual(context.batches, [[
    "delete vlans BT_APT_306_QnQ interface mge-0/0/12.3026",
    "delete vlans BT_APT_306_QnQ interface xe-0/2/0.3026",
    "delete vlans BT_APT_307_QnQ interface mge-0/0/13.3027",
    "delete vlans BT_APT_307_QnQ interface xe-0/2/0.3027",
    "delete interfaces xe-0/2/0 unit 3026",
    "delete interfaces xe-0/2/0 unit 3027",
    "delete interfaces mge-0/0/12",
    "delete interfaces mge-0/0/13"
  ]]);
  assert.match(context.confirmations[0], /4 discovered logical-interface VLAN memberships/);
  assert.match(context.confirmations[0], /BT_APT_306_QnQ: xe-0\/2\/0\.3026/);
  assert.match(context.confirmations[0], /BT_APT_307_QnQ: xe-0\/2\/0\.3027/);
  assert.match(context.connectionStatus.textContent, /2 ports and 4 logical-interface VLAN memberships; 2 paired logical units cleared/);
  // Keep the live inventory intact until a successful deployment and refresh.
  assert.equal(context.state.bridgeServices[0].interfaces.length, 2);
});

test("pair detection uses exact VLAN endpoints and preserves unrelated uplink services and settings", () => {
  const context = clearPortsContext(["mge-0/0/12"]);
  context.state.bridgeServices.push({ name: "UNRELATED", interfaces: ["mge-0/0/120.4000", "xe-0/2/0.4000"] });
  const uplink = context.state.ports.find((port) => port.name === "xe-0/2/0");
  uplink.currentSetLines = [
    "set interfaces xe-0/2/0 mtu 9216",
    "set interfaces xe-0/2/0 unit 0 family ethernet-switching interface-mode trunk",
    "set interfaces xe-0/2/0 unit 3026 vlan-tags outer 200",
    "set interfaces xe-0/2/0 unit 3027 vlan-tags outer 200",
    "set interfaces xe-0/2/0 unit 4000 vlan-tags outer 300"
  ];
  context.clearSelectedPortConfiguration();
  assert.deepEqual(context.batches[0], [
    "delete vlans BT_APT_306_QnQ interface mge-0/0/12.3026",
    "delete vlans BT_APT_306_QnQ interface xe-0/2/0.3026",
    "delete interfaces xe-0/2/0 unit 3026",
    "delete interfaces mge-0/0/12"
  ]);
  assert.equal(uplink.currentSetLines.length, 5);
});

test("pair detection uses the peer's own unit and supports channelized ports", () => {
  const context = clearPortsContext(["mge-0/0/12"]);
  context.state.bridgeServices = [
    { name: "SERVICE", interfaces: ["mge-0/0/12.3026", "et-0/0/48:0.200"] }
  ];
  context.clearSelectedPortConfiguration();
  assert.deepEqual(context.batches[0], [
    "delete vlans SERVICE interface mge-0/0/12.3026",
    "delete vlans SERVICE interface et-0/0/48:0.200",
    "delete interfaces et-0/0/48:0 unit 200",
    "delete interfaces mge-0/0/12"
  ]);
});

test("ambiguous or shared peers are listed and excluded from automatic cleanup", () => {
  const cases = [
    { members: ["mge-0/0/12.3026", "xe-0/2/0.3026", "mge-0/0/13.3026"], reason: /multiple endpoints/ },
    { members: ["mge-0/0/12.3026", "xe-0/2/0.0"], reason: /unit 0/ },
    { members: ["mge-0/0/12.0", "xe-0/2/0.3026"], reason: /unit 0/ },
    { members: ["mge-0/0/12.3026", "xe-0/2/0.3026"], shared: true, reason: /shared with another VLAN/ }
  ];
  for (const scenario of cases) {
    const context = clearPortsContext(["mge-0/0/12"]);
    context.state.bridgeServices = [{ name: "SERVICE", interfaces: scenario.members }];
    if (scenario.shared) context.state.bridgeServices.push({ name: "SHARED", interfaces: ["xe-0/2/0.3026"] });
    context.clearSelectedPortConfiguration();
    assert.deepEqual(context.batches[0], [
      `delete vlans SERVICE interface ${scenario.members[0]}`,
      "delete interfaces mge-0/0/12"
    ]);
    assert.match(context.confirmations[0], /Automatic peer cleanup skipped/);
    assert.match(context.confirmations[0], scenario.reason);
    assert.match(context.connectionStatus.textContent, /peer cleanup skipped for 1 service/);
  }
});

test("clearing an explicitly selected uplink removes all its references and deduplicates them", () => {
  const context = clearPortsContext(["mge-0/0/12", "mge-0/0/13", "xe-0/2/0"]);
  context.state.bridgeServices[0].interfaces.push("xe-0/2/0.3026", "xe-0/2/0.0");
  context.clearSelectedPortConfiguration();
  assert.deepEqual(context.batches[0], [
    "delete vlans BT_APT_306_QnQ interface mge-0/0/12.3026",
    "delete vlans BT_APT_306_QnQ interface xe-0/2/0.3026",
    "delete vlans BT_APT_306_QnQ interface xe-0/2/0.0",
    "delete vlans BT_APT_307_QnQ interface mge-0/0/13.3027",
    "delete vlans BT_APT_307_QnQ interface xe-0/2/0.3027",
    "delete interfaces mge-0/0/12",
    "delete interfaces mge-0/0/13",
    "delete interfaces xe-0/2/0"
  ]);
});

test("clearing ordinary ports still stages interface deletion and handles cancel or no selection", () => {
  const context = clearPortsContext(["mge-0/0/12"]);
  context.state.bridgeServices = [];
  context.clearSelectedPortConfiguration();
  assert.deepEqual(context.batches, [["delete interfaces mge-0/0/12"]]);
  assert.doesNotMatch(context.confirmations[0], /Also remove/);
  context.window.confirm = () => false;
  context.clearSelectedPortConfiguration();
  assert.equal(context.batches.length, 1);
  context.state.selected.clear();
  context.window.confirm = () => { assert.fail("Empty selection must not prompt"); };
  context.clearSelectedPortConfiguration();
  assert.equal(context.batches.length, 1);
  assert.match(context.connectionStatus.textContent, /Select at least one port/);
});

function serviceBuilderContext() {
  const context = {
    state: {
      vlans: [{ name: "CUSTOMER", value: 310 }], irbUnits: [],
      bridgeServices: [], ports: []
    },
    irbVlanInput: { value: "CUSTOMER" }, irbUnitInput: { value: "310" },
    irbAddressInput: { value: "192.0.2.1/24" }, irbSummary: {},
    qinqCustomerPortInput: { value: "ge-0/0/1" },
    qinqUplinkPortInput: { value: "xe-0/0/48" },
    qinqServiceNameInput: { value: "CUSTOMER_QINQ" },
    qinqOuterTagInput: { value: "200" }, qinqInnerTagInput: { value: "300" },
    qinqMtuInput: { value: "9216" }, qinqSummary: {}, connectionStatus: {},
    batches: [], tabs: []
  };
  context.appendConfigLines = (lines) => context.batches.push(Array.from(lines));
  context.activateWorkspaceTab = (tab) => context.tabs.push(tab);
  return loadSourceSection("function validIpv4Prefix", "function applySelectedPorts", context);
}

test("IRB button builds gateway commands and opens review", () => {
  const context = serviceBuilderContext();
  context.buildIrbConfiguration();
  assert.deepEqual(context.batches[0].slice(1), [
    "set interfaces irb unit 310 family inet address 192.0.2.1/24",
    "set vlans CUSTOMER l3-interface irb.310"
  ]);
  assert.deepEqual(context.tabs, ["review"]);
});

test("IRB rejects blank units and ownership conflicts beside the builder", () => {
  const context = serviceBuilderContext();
  context.irbUnitInput.value = "";
  context.buildIrbConfiguration();
  assert.match(context.irbSummary.textContent, /enter an IRB unit/);
  context.irbUnitInput.value = "310";
  context.state.vlans[0].l3Interface = "irb.500";
  context.buildIrbConfiguration();
  assert.match(context.irbSummary.textContent, /already bound to irb.500/);
  assert.equal(context.irbSummary.className, "tool-summary error-text");
  assert.equal(context.batches.length, 0);
  assert.equal(context.tabs.length, 0);
});

test("Q-in-Q button builds both service endpoints and opens review", () => {
  const context = serviceBuilderContext();
  context.buildQinqConfiguration();
  const lines = context.batches[0];
  for (const command of [
    "set interfaces ge-0/0/1 unit 300 input-vlan-map push",
    "set interfaces ge-0/0/1 unit 300 input-vlan-map vlan-id 200",
    "set interfaces ge-0/0/1 unit 300 output-vlan-map pop",
    "set interfaces xe-0/0/48 unit 300 vlan-tags outer 200",
    "set interfaces xe-0/0/48 unit 300 vlan-tags inner 300",
    "set vlans CUSTOMER_QINQ interface ge-0/0/1.300",
    "set vlans CUSTOMER_QINQ interface xe-0/0/48.300"
  ]) assert.ok(lines.includes(command), command);
  assert.deepEqual(context.tabs, ["review"]);
});

test("Q-in-Q rejects duplicate ports and unit conflicts beside the builder", () => {
  const context = serviceBuilderContext();
  context.qinqUplinkPortInput.value = "ge-0/0/1";
  context.buildQinqConfiguration();
  assert.match(context.qinqSummary.textContent, /must be different/);
  context.qinqUplinkPortInput.value = "xe-0/0/48";
  context.state.ports = [{ name: "ge-0/0/1", currentSetLines: [
    "set interfaces ge-0/0/1 unit 300 vlan-id 999"
  ] }];
  context.buildQinqConfiguration();
  assert.match(context.qinqSummary.textContent, /already has other configuration/);
  assert.equal(context.qinqSummary.className, "tool-summary error-text");
  assert.equal(context.batches.length, 0);
  assert.equal(context.tabs.length, 0);
});

test("negotiated link rates map to distinct tile color classes", () => {
  const context = loadSourceSection(
    "function negotiatedSpeedClass",
    "function render"
  );

  assert.equal(context.negotiatedSpeedClass("100 Mbps"), "speed-100m");
  assert.equal(context.negotiatedSpeedClass("1 Gbps"), "speed-1g");
  assert.equal(context.negotiatedSpeedClass("2.5 Gbps"), "speed-2-5g");
  assert.equal(context.negotiatedSpeedClass("10 Gbps"), "speed-10g");
  assert.equal(context.negotiatedSpeedClass("100 Gbps"), "speed-100g");
  assert.equal(context.negotiatedSpeedClass("0.1 Gbps"), "speed-100m");
  assert.equal(context.negotiatedSpeedClass("40 Gbps"), "speed-other");
  assert.equal(context.negotiatedSpeedClass("Unknown"), "speed-other");
});

test("move descriptions use the destination port and preserve the remaining text", () => {
  const context = loadSourceSection(
    "function rawPhysicalPortNumber",
    "function updateMoveSummary"
  );

  assert.equal(context.movedDescription("01_BT_whatever", "ge-0/0/2"), "02_BT_whatever");
  assert.equal(context.movedDescription("099_BT_whatever", "ge-0/0/100"), "100_BT_whatever");
  assert.equal(context.movedDescription("BT_whatever", "ge-0/0/2"), "BT_whatever");
});

test("series number padding uses two digits and expands to fit three", () => {
  const context = loadSourceSection(
    "function rawPhysicalPortNumber",
    "function updateMoveSummary",
    {
      seriesPadNumbersInput: { checked: true },
      seriesIncludePortNumberInput: { checked: false },
      seriesDescriptionInput: { value: "hw_ap_" },
      seriesPostfixInput: { value: "" }
    }
  );
  runSourceSection("function seriesNumberWidth", "function updateSeriesDescriptionPreview", context);

  assert.equal(context.seriesNumberWidth(1, 15), 2);
  assert.equal(context.seriesNumberWidth(1, 150), 3);
  assert.equal(context.seriesDescription({ name: "ge-0/0/1" }, 1, 2), "hw_ap_01");

  context.seriesIncludePortNumberInput.checked = true;
  assert.equal(context.seriesDescription({ name: "ge-0/0/1" }, 1, 2), "01_hw_ap_01");

  context.seriesPadNumbersInput.checked = false;
  assert.equal(context.seriesNumberWidth(1, 150), 0);
});

test("description sections preserve irregular values while literals are changed", () => {
  const context = loadSourceSection(
    "function parseDescriptionPattern",
    "function descriptionTransformPlan"
  );

  assert.equal(
    context.transformDescriptionSections(
      "48*EWT_1732",
      "{port}*EWT_{apt}",
      "{port}_WT_*{apt}"
    ),
    "48_WT_*1732"
  );
  assert.equal(
    context.transformDescriptionSections(
      "west-floor7-apt209",
      "{wing}-{floor}-{apartment}",
      "{apartment}_{wing}_RENAMED"
    ),
    "apt209_west_RENAMED"
  );
  assert.equal(
    context.transformDescriptionSections(
      "does-not-match",
      "{port}*EWT_{apt}",
      "{port}_WT_*{apt}"
    ),
    null
  );
});

test("description section patterns validate ambiguous and unknown sections", () => {
  const context = loadSourceSection(
    "function parseDescriptionPattern",
    "function descriptionTransformPlan"
  );

  assert.throws(
    () => context.compileDescriptionTransform("{one}{two}", "{one}_{two}"),
    /literal text between adjacent named sections/
  );
  assert.throws(
    () => context.compileDescriptionTransform("{one}_{two}", "{three}"),
    /not captured by the current pattern/
  );
  assert.equal(
    context.transformDescriptionSections("rack{12}", "rack{{{number}}}", "unit-{number}"),
    "unit-12"
  );
});

test("description-only deployment detection includes queued batches and rejects mixed changes", () => {
  const context = loadSourceSection(
    "function isDescriptionOnlyDeployment",
    "function updatePushAvailability"
  );

  assert.equal(context.isDescriptionOnlyDeployment([
    "# Queued batch 1: Floor 1",
    'set interfaces ge-0/0/1 description "01_AP"',
    "# Queued batch 2: Floor 2",
    'set interfaces ge-0/0/2 description "02_AP"',
    "delete interfaces ge-0/0/3 description"
  ].join("\n")), true);
  assert.equal(context.isDescriptionOnlyDeployment([
    'set interfaces ge-0/0/1 description "Camera"',
    "set interfaces ge-0/0/1 disable"
  ].join("\n")), false);
  assert.equal(context.isDescriptionOnlyDeployment(
    'set interfaces ge-0/0/1.0 description "Logical unit"'
  ), false);
  assert.equal(context.isDescriptionOnlyDeployment("# comments are not commands"), false);
});
