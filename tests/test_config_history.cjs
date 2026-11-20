const assert = require("node:assert/strict");
const test = require("node:test");
const { ConfigHistoryController, mount } = require("../config-history.js");

function historyData() {
  return { entries: [0, 1, 2].map((index) => ({ index, timestamp: "2026-11-20 10:00:00 EST", user: "netops",
    comment: `<img src=x onerror=alert(${index})>`, sourceToken: `source-${index}` })),
    knownGood: { available: true, fingerprint: "a".repeat(64), sourceToken: "rescue", catalog: { label: "After checks" } },
    baselineToken: "baseline", baselineFingerprint: "b".repeat(64), baselineRevision: "re0-100",
    collectedAt: "2026-11-20T15:00:00Z" };
}

function harness() {
  const h = { context: { payload: { host: "switch-a", username: "netops", password: "secret" }, connected: true,
    busy: false, pending: false, hasDraft: false }, calls: [], prompts: [], now: 1000, changes: 0, restores: [] };
  h.env = { context: () => h.context, now: () => h.now, render() {},
    confirm: (message) => { h.prompts.push(message); return true; },
    setBusy: (busy) => { h.context.busy = busy; },
    onRestore: (result, payload) => { h.restores.push({ result, payload }); h.context.pending = true; },
    onChanged: async () => { h.changes += 1; }, confirmRestore() {},
    request: async (url, payload) => {
      h.calls.push({ url, payload });
      if (url === "/api/config-history") return historyData();
      if (url.endsWith("compare")) return { diff: '-old\n+new', addedLines: 1, removedLines: 1, identical: false,
        sourceLabel: payload.sourceToken === "rescue" ? "rescue" : "re0-99", previewToken: "review", expiresInSeconds: 300 };
      if (url.endsWith("restore")) return { pendingConfirmation: true, confirmationToken: "confirmation", activityId: "activity" };
      return { ok: true };
    }
  };
  h.controller = new ConfigHistoryController(h.env);
  h.controller.contextChanged();
  return h;
}

test("history compares remain read-only and restoration requires a current reviewed result", async () => {
  const h = harness();
  await h.controller.load();
  assert.equal(h.calls[0].payload.depth, 20);
  assert.equal(!!h.controller.canRestore(), false);
  await h.controller.compare(h.controller.data.entries[1]);
  assert.equal(!!h.controller.canRestore(), true);
  for (const flag of ["hasDraft", "pending", "busy"]) {
    h.context[flag] = true;
    await h.controller.restore();
    h.context[flag] = false;
  }
  assert.equal(h.prompts.length, 0);
  assert.equal(h.calls.length, 2);
  h.now += 300001;
  assert.equal(!!h.controller.canRestore(), false);
  await h.controller.restore();
  assert.equal(h.calls.length, 2);
});

test("known-good restore uses the selected preview, confirms whole-switch scope, and refreshes", async () => {
  const h = harness();
  await h.controller.load();
  await h.controller.compare("rescue");
  await h.controller.restore();
  assert.match(h.prompts[0], /WHOLE switch configuration/);
  assert.match(h.prompts[0], /five-minute confirmed commit/);
  assert.equal(h.calls[2].payload.previewToken, "review");
  assert.equal(h.calls[2].payload.config, undefined);
  assert.equal(h.restores[0].payload.host, "switch-a");
  assert.equal(h.context.busy, false);
  assert.equal(h.changes, 1);
  assert.equal(h.controller.results.size, 0);
  assert.match(h.controller.message, /Restore applied/);
});

test("known-good replacement is explicit and carries the reviewed rescue identity", async () => {
  const h = harness();
  await h.controller.load();
  await h.controller.saveKnownGood("After maintenance");
  assert.match(h.prompts[0], /previous rescue backup will be replaced/);
  assert.equal(h.calls[1].payload.replaceFingerprint, "a".repeat(64));
  assert.equal(h.calls[1].payload.label, "After maintenance");
  const blocked = harness();
  await blocked.controller.load();
  blocked.controller.data.pendingConfirmation = true;
  await blocked.controller.saveKnownGood("No");
  assert.equal(blocked.calls.length, 1);
  blocked.controller.data.pendingConfirmation = false;
  blocked.controller.data.knownGood.error = "Permission denied";
  await blocked.controller.saveKnownGood("No");
  assert.equal(blocked.calls.length, 1);
});

test("cancellation sends no save or restore request", async () => {
  const h = harness();
  h.env.confirm = () => false;
  await h.controller.load();
  await h.controller.compare("rescue");
  await h.controller.restore();
  await h.controller.saveKnownGood("No");
  assert.equal(h.calls.length, 2);
});

test("late reads cannot populate a changed device or credentials", async () => {
  for (const field of ["host", "username", "password"]) {
    const h = harness();
    let finish;
    h.env.request = () => new Promise((resolve) => { finish = resolve; });
    const pending = h.controller.load();
    h.context.payload = { ...h.context.payload, [field]: "changed" };
    h.controller.contextChanged();
    finish(historyData());
    await pending;
    assert.equal(h.controller.data, null);
    assert.equal(h.controller.loading, false);
  }
});

test("compare-all is sequential, retains partial failure, and supports stopping", async () => {
  const h = harness();
  await h.controller.load();
  const original = h.env.request;
  let running = 0, peak = 0;
  h.env.request = async (url, payload) => {
    running += 1;
    peak = Math.max(peak, running);
    await Promise.resolve();
    running -= 1;
    if (payload.sourceToken === "source-1") throw new Error("Read failed");
    return original(url, payload);
  };
  await h.controller.compareAll();
  assert.equal(peak, 1);
  assert.equal(h.controller.results.get("1").status, "Comparison failed");
  assert.equal(h.controller.results.get("2").addedLines, 1);
  assert.equal(h.controller.batch, false);
  let finish;
  h.env.request = () => new Promise((resolve) => { finish = resolve; });
  const batch = h.controller.compareAll();
  h.controller.cancelBatch();
  finish({ identical: true, expiresInSeconds: 300 });
  await batch;
  assert.equal(h.controller.results.get("1").identical, true);
});

test("failed writes retain no reusable restore preview and restore UI controls", async () => {
  const h = harness();
  await h.controller.load();
  await h.controller.compare("rescue");
  h.env.request = async () => { throw new Error("Outcome unverified"); };
  await h.controller.restore();
  assert.match(h.controller.message, /unverified.*Refresh history/);
  assert.equal(h.context.busy, false);
  assert.equal(h.controller.results.size, 0);
  assert.equal(h.restores.length, 0);
});

test("idle context ticks preserve an inspected diff and stale baseline errors invalidate reviews", async () => {
  const h = harness();
  let renders = 0;
  h.env.render = () => { renders += 1; };
  await h.controller.load();
  await h.controller.compare(h.controller.data.entries[1]);
  const previous = renders;
  h.controller.contextChanged();
  h.controller.contextChanged();
  assert.equal(renders, previous, "An idle tick must not rebuild the scrolled diff viewer");
  h.now += 300001;
  h.controller.contextChanged();
  assert.equal(renders, previous + 1);
  h.env.request = async () => { const error = new Error('Current changed'); error.status = 409; throw error; };
  await h.controller.compare(h.controller.data.entries[2]);
  assert.equal(h.controller.results.get('1').status, 'Stale');
  assert.equal(h.controller.results.get('1').previewToken, undefined);
  assert.equal(h.controller.data.baselineToken, '');
});

class Node {
  constructor(tag) { this.tagName = tag; this.children = []; this.listeners = {}; this.textContent = ""; }
  appendChild(child) { this.children.push(child); }
  replaceChildren() { this.children = []; }
  addEventListener(name, fn) { this.listeners[name] = fn; }
  set innerHTML(value) { assert.fail("Switch content must be rendered as text"); }
}

test("the mounted section displays untrusted comments/diffs as text and gates restore", async () => {
  const h = harness();
  const nodes = new Map();
  const document = { getElementById: (id) => {
    if (!nodes.has(id)) nodes.set(id, new Node("control"));
    return nodes.get(id);
  }, createElement: (tag) => new Node(tag) };
  const controller = mount(h.env, document);
  await controller.load();
  assert.equal(nodes.get("historyRows").children[1].children[3].textContent, '<img src=x onerror=alert(1)>');
  assert.equal(nodes.get("historyRestore").disabled, true);
  await controller.compare(controller.data.entries[1]);
  assert.equal(nodes.get("historyRestore").disabled, false);
  assert.equal(nodes.get("historyDiff").children[0].className, "history-diff-removed");
  h.context.hasDraft = true;
  controller.contextChanged();
  assert.equal(nodes.get("historyRestore").disabled, true);
  assert.match(nodes.get("historyDraftHint").textContent, /Clear it explicitly/);
});
