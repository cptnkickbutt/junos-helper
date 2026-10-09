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
