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
  const buttons = ["configure", "move", "series", "vlans", "review"].map((tab) => ({
    dataset: { tab }, classList: { toggle() {} }, setAttribute() {},
    focus() { this.focused = true; }
  }));
  const context = loadSourceSection("function activateWorkspaceTab", "function updateSelectionModeHint", {
    state: { lastEditingTab: "configure", configQueue: [], nextQueueId: 1 },
    tabButtons: buttons,
    tabPanels: buttons.map((button) => ({
      dataset: { panel: button.dataset.tab }, classList: { toggle() {} }, hidden: true
    }))
  });
  context.activateWorkspaceTab(editingTab);
  context.activateWorkspaceTab("review");
  return context;
}

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
  for (const tab of ["configure", "series", "move", "vlans"]) {
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
        hostInput: { value: "switch" }, usernameInput: { value: "user" }, passwordInput: { value: "" },
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
