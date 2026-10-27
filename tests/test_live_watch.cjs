const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { counterDelta, acceptSample, freshRecord, LiveWatchController } = require("../live-watch.js");

function sample(time = 100000, updates = {}) {
  const { counters, ...rest } = updates;
  return { name: "ge-0/0/1", admin: "up", oper: "up", speed: "1000mbps", speedBps: 1e9,
    lastFlapped: "Never", counterEpoch: "123|Never", sampleTimeMs: time,
    sampledAt: "2026-10-27T16:00:00+00:00", counters: { rxBytes: "1000", txBytes: "500", rxPackets: "100", txPackets: "50",
      inputErrors: "4", outputErrors: "2", inputDrops: "0", outputDrops: "0", framingErrors: "1", carrierTransitions: "2", ...counters }, ...rest };
}

function harness() {
  let now = 100000;
  let timerId = 0;
  const timers = new Map();
  const context = { connection: { host: "switch", username: "netops", password: "secret", deviceName: "Access" },
    ports: [{ name: "ge-0/0/1" }, { name: "xe-0/0/48" }], selected: new Set(["ge-0/0/1"]), connected: true, busy: false, hidden: false };
  const calls = [];
  const env = { context: () => context, now: () => now, render() {}, abort() {},
    schedule: (fn) => { timers.set(++timerId, fn); return timerId; }, cancel: (id) => timers.delete(id),
    request: async (url, payload) => {
      calls.push({ url, payload });
      return url.endsWith("/sample") ? { ok: true, sessionId: "session-a", ports: payload.ports.map((name) => sample(now, { name })) } : { ok: true };
    } };
  return { env, context, calls, timers, controller: new LiveWatchController(env), advance: (ms) => { now += ms; } };
}

test("counter differences retain 64-bit precision and compute measured rates", () => {
  assert.equal(counterDelta("9007199254740994", "9007199254740993"), 1);
  assert.equal(counterDelta(null, "0"), null);
  assert.equal(counterDelta("0", "1"), null);
  const record = freshRecord("ge-0/0/1");
  acceptSample(record, sample(100000, { counters: { rxBytes: "9007199254740993" } }), 100000, 5000);
  assert.equal(record.rates, null);
  acceptSample(record, sample(101000, { counters: { rxBytes: "9007199254740994", txBytes: "1500", rxPackets: "102", inputErrors: "6" } }), 101000, 5000);
  assert.equal(record.rates.rxBytes, 8);
  assert.equal(record.rates.txBytes, 8000);
  assert.equal(record.rates.rxPackets, 2);
  assert.equal(record.totals.inputErrors, 2);
  assert.equal(record.totals.framingErrors, 0);
});

test("failures and long gaps break graphs without fabricating zero traffic", () => {
  const record = freshRecord("ge-0/0/1");
  acceptSample(record, sample(), 100000, 5000);
  acceptSample(record, sample(105000, { counters: { rxBytes: "2000" } }), 105000, 5000);
  assert.equal(record.rates.rxBytes, 1600);
  acceptSample(record, { error: "No response" }, 110000, 5000);
  assert.equal(record.rates, null);
  assert.equal(record.receivedAt, 105000);
  assert.equal(record.points.at(-1).rx, null);
  acceptSample(record, sample(115000, { counters: { rxBytes: "3000", inputErrors: "8" } }), 115000, 5000);
  assert.equal(record.rates, null);
  assert.equal(record.totals.inputErrors, 4);
  acceptSample(record, sample(180000, { counters: { rxBytes: "4000", inputErrors: "8" } }), 180000, 5000);
  assert.equal(record.rates, null);
});

test("counter resets, missing fields, and link changes renew rate baselines", () => {
  const record = freshRecord("ge-0/0/1");
  acceptSample(record, sample(), 100000, 5000);
  acceptSample(record, sample(105000, { counters: { rxBytes: "2000", inputErrors: "6" } }), 105000, 5000);
  acceptSample(record, sample(110000, { counters: { rxBytes: "0", inputErrors: "0" } }), 110000, 5000);
  assert.equal(record.rates, null);
  assert.equal(record.totals.inputErrors, 2);
  assert.match(record.events[0].message, /Counters restarted/);
  acceptSample(record, sample(115000, { counters: { rxBytes: "500", inputErrors: "1", outputDrops: null } }), 115000, 5000);
  assert.equal(record.rates.rxBytes, 800);
  assert.equal(record.totals.inputErrors, 3);
  acceptSample(record, sample(120000, { oper: "down", speedBps: null, counters: { rxBytes: "500", inputErrors: "1" } }), 120000, 5000);
  assert.equal(record.rates, null);
  assert.ok(record.events.some((event) => /Link changed: up → down/.test(event.message)));
  const unavailable = freshRecord("ge-0/0/1");
  acceptSample(unavailable, sample(100000, { counters: { inputErrors: null, rxBytes: null } }), 100000, 5000);
  acceptSample(unavailable, sample(105000, { counters: { inputErrors: null, rxBytes: null } }), 105000, 5000);
  assert.equal(unavailable.rates.rxBytes, null);
  assert.equal(unavailable.totals.inputErrors, undefined);
  acceptSample(unavailable, sample(110000, { counters: { inputErrors: "7" } }), 110000, 5000);
  acceptSample(unavailable, sample(115000, { counters: { inputErrors: null } }), 115000, 5000);
  acceptSample(unavailable, sample(120000, { counters: { inputErrors: "9" } }), 120000, 5000);
  assert.equal(unavailable.totals.inputErrors, 2);
});

test("only two minutes of measurements are retained in memory", () => {
  const record = freshRecord("ge-0/0/1");
  for (let index = 0; index < 180; index++) {
    acceptSample(record, sample(100000 + index * 2000, { counters: { rxBytes: String(1000 + index * 2000) } }), 100000 + index * 2000, 2000);
  }
  assert.ok(record.points.length <= 61);
  assert.ok(record.points.every((point) => point.time >= 100000 + 179 * 2000 - 120000));
});

test("freshness uses each port's collection time rather than when a slow batch arrives", () => {
  const record = freshRecord("ge-0/0/1");
  const arrival = Date.parse("2026-10-27T16:00:10+00:00");
  acceptSample(record, sample(), arrival, 5000);
  assert.equal(arrival - record.receivedAt, 10000);
  assert.equal(record.points[0].time, record.receivedAt);
});

test("watched ports stay pinned independently of configuration selection, with no overlapping reads", async () => {
  const h = harness();
  await h.controller.start();
  assert.deepEqual(h.controller.names, ["ge-0/0/1"]);
  assert.equal(h.timers.size, 1);
  h.context.selected = new Set(["xe-0/0/48"]);
  h.controller.contextChanged();
  assert.deepEqual(h.controller.names, ["ge-0/0/1"]);
  let resolve;
  h.env.request = (url, payload) => new Promise((done) => { h.calls.push({ url, payload }); resolve = done; });
  const pending = h.controller.poll(true);
  await h.controller.poll(true);
  assert.equal(h.calls.length, 2);
  assert.deepEqual(h.calls[1].payload.ports, ["ge-0/0/1"]);
  resolve({ ok: true, sessionId: "session-a", ports: [sample(105000)] });
  await pending;
  assert.equal(h.timers.size, 1);
  assert.ok(h.calls.every((call) => call.url.startsWith("/api/live-watch/")));
});

test("pause, manual check, reset view, and resume do not clear switch counters", async () => {
  const h = harness();
  await h.controller.start();
  h.controller.stop();
  assert.equal(h.controller.running, false);
  assert.equal(h.timers.size, 0);
  assert.equal(h.calls.at(-1).url, "/api/live-watch/stop");
  h.advance(5000);
  await h.controller.poll(true);
  assert.equal(h.controller.running, false);
  assert.equal(h.controller.records.get("ge-0/0/1").rates, null);
  h.controller.reset();
  assert.equal(h.controller.records.get("ge-0/0/1").points.length, 0);
  assert.equal(h.controller.records.get("ge-0/0/1").previous, null);
  await h.controller.resume();
  assert.equal(h.controller.running, true);
  assert.ok(h.calls.every((call) => !JSON.stringify(call.payload).includes("clear interfaces")));
});

test("busy switch actions and hidden browser tabs suspend sampling", async () => {
  const h = harness();
  await h.controller.start();
  h.context.busy = true;
  const count = h.calls.length;
  await h.controller.poll();
  assert.equal(h.calls.length, count);
  assert.match(h.controller.status, /current switch action/);
  h.context.busy = false;
  h.context.hidden = true;
  await h.controller.poll();
  assert.equal(h.calls.length, count);
  assert.match(h.controller.status, /hidden/);
  h.context.hidden = false;
  h.context.connection.host = "another-switch";
  h.controller.contextChanged();
  assert.equal(h.controller.names.length, 0);
  assert.equal(h.controller.running, false);
});

test("expired SSH sessions reconnect once and establish a fresh rate baseline", async () => {
  const h = harness();
  await h.controller.start();
  let calls = 0;
  h.env.request = async (url, payload) => {
    calls++;
    return calls === 1 ? { ok: false, sessionExpired: true } : { ok: true, sessionId: "replacement", ports: [sample(105000)] };
  };
  await h.controller.poll();
  assert.equal(calls, 2);
  assert.equal(h.controller.sessionId, "replacement");
  assert.equal(h.controller.records.get("ge-0/0/1").rates, null);
});

test("starting a switch action interrupts an in-flight sample and ignores its late response", async () => {
  const h = harness();
  await h.controller.start();
  let resolve;
  let aborted = false;
  h.env.abort = () => { aborted = true; };
  h.env.request = async (url) => url.endsWith("/sample") ? new Promise((done) => { resolve = done; }) : { ok: true };
  const pending = h.controller.poll();
  h.context.busy = true;
  h.controller.contextChanged();
  assert.equal(aborted, true);
  assert.equal(h.controller.busy, false);
  assert.equal(h.controller.running, true);
  resolve({ ok: true, sessionId: "old-session", ports: [sample(105000, { counters: { rxBytes: "99999999" } })] });
  await pending;
  assert.equal(h.controller.records.get("ge-0/0/1").latest.counters.rxBytes, "1000");
  assert.match(h.controller.status, /current switch action/);
});

test("late replies cannot replace a new watch or clear its SSH session", async () => {
  const h = harness();
  let resolveOld;
  h.env.request = async (url, payload) => {
    h.calls.push({ url, payload });
    if (url.endsWith("/stop")) return { ok: true };
    if (payload.host === "switch") return new Promise((resolve) => { resolveOld = resolve; });
    return { ok: true, sessionId: "new-session", ports: [sample(105000, { name: "xe-0/0/48" })] };
  };
  const old = h.controller.start();
  h.context.connection.host = "another-switch";
  h.context.selected = new Set(["xe-0/0/48"]);
  await h.controller.start();
  resolveOld({ ok: true, sessionId: "old-session", ports: [sample()] });
  await old;
  assert.equal(h.controller.sessionId, "new-session");
  assert.deepEqual(h.controller.names, ["xe-0/0/48"]);
  assert.ok(h.calls.some((call) => call.url.endsWith("/stop") && call.payload.sessionId === "old-session"));
});

test("the browser module wires controls and displays samples without HTML injection", async () => {
  const makeElement = (tag = "div") => ({ tag, children: [], attrs: {}, handlers: {}, textContent: "", value: "5", checked: false,
    classList: { add() {}, toggle() {} },
    setAttribute(key, value) { this.attrs[key] = value; },
    addEventListener(key, fn) { this.handlers[key] = fn; },
    append(...children) { children.forEach((child) => this.appendChild(child)); },
    appendChild(child) { child.parent = this; this.children.push(child); },
    replaceChildren(...children) { this.children = []; this.append(...children); },
    remove() { if (this.parent) this.parent.children = this.parent.children.filter((child) => child !== this); },
    set innerHTML(value) { assert.fail("Switch data must use textContent"); }
  });
  const ids = ["watchSelectedBtn", "watchPauseBtn", "watchCheckBtn", "watchResetBtn", "watchInterval", "watchPoe", "watchSelectionHint", "watchStatus", "watchPorts"];
  const elements = Object.fromEntries(ids.map((id) => [id, makeElement()]));
  const h = harness();
  let now = 100000;
  let bytes = 1000;
  const doc = { hidden: false, getElementById: (id) => elements[id], createElement: makeElement,
    createElementNS: (ns, tag) => makeElement(tag), addEventListener() {} };
  class Clock extends Date { static now() { return now; } }
  const root = { document: doc, getLiveWatchContext: () => h.context, setTimeout: () => 1, clearTimeout() {}, setInterval() {}, addEventListener() {},
    fetch: async (url) => ({ ok: true, json: async () => url.endsWith("/stop") ? { ok: true } : { ok: true, sessionId: "session", ports: [sample(now, {
      description: '<script>untrusted()</script>', counters: { rxBytes: String(bytes) }
    })] } }) };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "..", "live-watch.js"), "utf8"), { window: root, AbortController, Date: Clock });
  await elements.watchSelectedBtn.handlers.click();
  const card = elements.watchPorts.children[0];
  assert.equal(card.children[1].children[0].textContent, '<script>untrusted()</script>');
  now += 5000; bytes += 1000;
  await elements.watchCheckBtn.handlers.click();
  assert.equal(card.children[0].children[1].children[1].textContent, "1.6 Kb/s");
  assert.match(elements.watchStatus.textContent, /Watching/);
  assert.equal(elements.watchPauseBtn.textContent, "Pause");
  elements.watchPauseBtn.handlers.click();
  assert.equal(elements.watchPauseBtn.textContent, "Resume");
});
