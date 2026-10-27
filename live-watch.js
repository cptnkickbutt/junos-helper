(function (root) {
  "use strict";
  const COUNTERS = ["inputErrors", "outputErrors", "inputDrops", "outputDrops", "framingErrors", "carrierTransitions"];
  const TRAFFIC = ["rxBytes", "txBytes", "rxPackets", "txPackets"];
  const HISTORY_MS = 120000;

  function counterDelta(current, previous) {
    if (!/^\d+$/.test(String(current ?? "")) || !/^\d+$/.test(String(previous ?? ""))) return null;
    const delta = BigInt(current) - BigInt(previous);
    return delta >= 0n ? Number(delta) : null;
  }

  function freshRecord(name) {
    return { name, latest: null, previous: null, receivedAt: null, rates: null, totals: {}, errorPrevious: {}, points: [], events: [], error: "", rateGap: true };
  }

  function acceptSample(record, sample, now, intervalMs) {
    if (sample.error) {
      record.error = sample.error;
      record.rateGap = true;
      if (record.points.length && record.points.at(-1).rx !== null) record.points.push({ time: now, rx: null, tx: null });
      record.rates = null;
    } else {
      const previous = record.previous;
      const parsedTime = Date.parse(sample.sampledAt);
      const observedAt = Number.isFinite(parsedTime) ? Math.min(now, parsedTime) : now;
      const counters = sample.counters || {};
      const lastKnown = (key) => COUNTERS.includes(key) ? record.errorPrevious[key] : previous?.counters[key];
      const reset = !!previous && (sample.counterEpoch !== previous.counterEpoch || [...TRAFFIC, ...COUNTERS].some((key) => (
        /^\d+$/.test(String(counters[key] ?? "")) && /^\d+$/.test(String(lastKnown(key) ?? ""))
        && BigInt(counters[key]) < BigInt(lastKnown(key))
      )));
      const elapsed = previous ? sample.sampleTimeMs - previous.sampleTimeMs : 0;
      const linkChanged = previous && (sample.oper !== previous.oper || sample.admin !== previous.admin || sample.speedBps !== previous.speedBps);
      const comparable = previous && !reset && !record.rateGap && !linkChanged && elapsed > 0 && elapsed <= Math.max(15000, intervalMs * 3);
      record.rates = comparable ? Object.fromEntries(TRAFFIC.map((key) => {
        const delta = counterDelta(counters[key], previous.counters[key]);
        return [key, delta === null ? null : delta * 1000 / elapsed * (key.endsWith("Bytes") ? 8 : 1)];
      })) : null;
      if (reset) record.errorPrevious = {};
      COUNTERS.forEach((key) => {
        if (counters[key] === null || counters[key] === undefined) return;
        if (record.totals[key] === undefined) record.totals[key] = 0;
        const delta = !reset ? counterDelta(counters[key], record.errorPrevious[key]) : null;
        if (delta !== null) record.totals[key] += delta;
        record.errorPrevious[key] = counters[key];
      });
      const event = (message) => record.events.unshift({ time: now, message });
      if (previous && sample.oper !== previous.oper) event(`Link changed: ${previous.oper} → ${sample.oper}`);
      if (previous && sample.speed !== previous.speed) event(`Reported speed changed: ${previous.speed} → ${sample.speed}`);
      if (previous && sample.lastFlapped !== previous.lastFlapped && sample.lastFlapped !== "Unknown") event(`Switch last-flapped time changed: ${sample.lastFlapped}`);
      if (reset) event("Counters restarted; the rate baseline was renewed.");
      record.events = record.events.slice(0, 12);
      record.points.push({ time: observedAt, rx: record.rates?.rxBytes ?? null, tx: record.rates?.txBytes ?? null });
      record.latest = sample;
      record.previous = sample;
      record.receivedAt = observedAt;
      record.error = "";
      record.rateGap = false;
    }
    record.points = record.points.filter((point) => point.time >= now - HISTORY_MS).slice(-240);
    return record;
  }

  function bitRate(value) {
    if (value === null || value === undefined || !Number.isFinite(value)) return "—";
    const units = ["b/s", "Kb/s", "Mb/s", "Gb/s", "Tb/s"];
    let unit = 0;
    while (value >= 1000 && unit < units.length - 1) { value /= 1000; unit++; }
    return `${value.toLocaleString(undefined, { maximumFractionDigits: unit ? 2 : 0 })} ${units[unit]}`;
  }

  class LiveWatchController {
    constructor(env) {
      this.env = env;
      this.names = [];
      this.records = new Map();
      this.running = false;
      this.busy = false;
      this.intervalMs = 5000;
      this.includePoe = false;
      this.sessionId = "";
      this.targetKey = "";
      this.targetLabel = "";
      this.generation = 0;
      this.timer = null;
      this.status = "Select ports, then choose Watch selected ports.";
    }
    key(context) { return `${context.connection.host.toLowerCase()}|${context.connection.username}`; }
    notify() { this.env.render(this); }
    cancelTimer() { if (this.timer !== null) this.env.cancel(this.timer); this.timer = null; }
    schedule(delay = this.intervalMs) {
      this.cancelTimer();
      if (this.running) this.timer = this.env.schedule(() => { this.timer = null; void this.poll(); }, delay);
    }
    closeSession(token = this.sessionId) {
      if (token === this.sessionId) this.sessionId = "";
      if (token) void this.env.request("/api/live-watch/stop", { sessionId: token }).catch(() => {});
    }
    stop(clear = false) {
      this.running = false;
      this.generation++;
      this.cancelTimer();
      this.env.abort?.();
      this.busy = false;
      this.closeSession();
      this.records.forEach((record) => { record.rateGap = true; record.rates = null; });
      if (clear) { this.names = []; this.records.clear(); }
      this.status = clear ? "Connection changed. Select ports and start a new watch." : "Paused. Values are from the last collected samples.";
      this.notify();
    }
    contextChanged() {
      const context = this.env.context();
      if (this.names.length && (this.key(context) !== this.targetKey || !context.connected
          || this.names.some((name) => !context.ports.some((port) => port.name === name)))) this.stop(true);
      else {
        if (context.busy && this.busy) {
          this.generation++;
          this.env.abort?.();
          this.busy = false;
          this.closeSession();
          this.records.forEach((record) => { record.rateGap = true; record.rates = null; });
          this.status = "Waiting for the current switch action to finish…";
          this.schedule();
        }
        this.notify();
      }
    }
    async start() {
      const context = this.env.context();
      const names = context.ports.filter((port) => context.selected.has(port.name)).map((port) => port.name);
      if (!context.connected || context.busy) { this.status = "Connect to the target and wait for the current switch action to finish."; this.notify(); return; }
      if (!names.length || names.length > 8) { this.status = "Select 1–8 ports to watch, including an uplink if useful."; this.notify(); return; }
      this.stop(true);
      this.names = names;
      this.records = new Map(names.map((name) => [name, freshRecord(name)]));
      this.targetKey = this.key(context);
      this.targetLabel = `${context.connection.deviceName || context.connection.host} · ${context.connection.host}`;
      this.running = true;
      this.status = "Collecting the first samples…";
      return this.poll();
    }
    resume() {
      if (!this.names.length) return;
      this.running = true;
      this.records.forEach((record) => { record.rateGap = true; });
      return this.poll();
    }
    reset() {
      this.records.forEach((record) => {
        record.previous = null; record.totals = {}; record.errorPrevious = {}; record.points = []; record.events = []; record.rates = null; record.rateGap = true;
      });
      this.status = "View reset. New baselines will start with the next successful sample.";
      this.notify();
      if (this.running) return this.poll();
    }
    async poll(manual = false) {
      if (!this.names.length || this.busy || !this.running && !manual) return;
      const context = this.env.context();
      if (this.key(context) !== this.targetKey || !context.connected) { this.stop(true); return; }
      if (context.busy || context.hidden) {
        this.status = context.hidden ? "Browser tab hidden — sampling suspended." : "Waiting for the current switch action to finish…";
        this.records.forEach((record) => { record.rateGap = true; record.rates = null; });
        this.notify(); this.schedule(); return;
      }
      const generation = this.generation;
      const began = this.env.now();
      this.busy = true;
      this.status = "Collecting live statistics…";
      this.notify();
      try {
        const collect = () => this.env.request("/api/live-watch/sample", { ...context.connection,
          ports: this.names, sessionId: this.sessionId, includePoe: this.includePoe });
        let payload = await collect();
        if (generation !== this.generation) {
          if (payload.sessionId) this.closeSession(payload.sessionId);
          return;
        }
        if (payload.sessionExpired) {
          this.sessionId = "";
          this.records.forEach((record) => { record.rateGap = true; });
          payload = await collect();
          if (generation !== this.generation) { if (payload.sessionId) this.closeSession(payload.sessionId); return; }
        }
        if (Object.hasOwn(payload, "sessionId")) this.sessionId = payload.sessionId;
        if (!payload.ports) throw new Error(payload.error || "No live statistics returned.");
        if (this.env.context().busy || this.key(this.env.context()) !== this.targetKey) {
          this.records.forEach((record) => { record.rateGap = true; });
          this.status = "Sample skipped because the connection or switch action changed.";
          return;
        }
        const now = this.env.now();
        const byName = new Map(payload.ports.map((sample) => [sample.name, sample]));
        this.names.forEach((name) => acceptSample(this.records.get(name), byName.get(name) || { error: "No sample returned for this port." }, now, this.intervalMs));
        const failed = [...this.records.values()].filter((record) => record.error).length;
        this.status = `${this.running ? "Watching" : "One-time check complete"}: ${this.targetLabel}${failed ? ` · ${failed} port read${failed === 1 ? "" : "s"} unavailable` : ""}.`;
      } catch (error) {
        if (generation !== this.generation) return;
        this.closeSession();
        this.records.forEach((record) => acceptSample(record, { error: error.message }, this.env.now(), this.intervalMs));
        this.status = `Statistics unavailable: ${error.message}`;
      } finally {
        if (generation === this.generation) {
          this.busy = false;
          this.notify();
          const elapsed = this.env.now() - began;
          this.schedule(elapsed >= this.intervalMs ? this.intervalMs : this.intervalMs - elapsed);
        }
      }
    }
  }

  if (typeof module !== "undefined" && module.exports) {
    module.exports = { counterDelta, acceptSample, freshRecord, bitRate, LiveWatchController };
    return;
  }

  const doc = root.document;
  const controls = Object.fromEntries(["watchSelectedBtn", "watchPauseBtn", "watchCheckBtn", "watchResetBtn", "watchInterval", "watchPoe", "watchSelectionHint", "watchStatus", "watchPorts"]
    .map((id) => [id, doc.getElementById(id)]));
  const cards = new Map();
  let abort = null;
  const element = (tag, className = "", text = "") => {
    const node = doc.createElement(tag); node.className = className; node.textContent = text; return node;
  };
  function metric(label) {
    const container = element("span", "watch-metric");
    const value = element("strong", "", "—");
    container.append(element("small", "", label), value);
    return { container, value };
  }
  function createCard(name, open) {
    const node = element("details", "watch-port"); node.open = open;
    const summary = element("summary", "watch-port-summary");
    const identity = element("span", "watch-port-identity");
    const link = element("span", "watch-link", "Waiting");
    const speed = element("small");
    identity.append(element("strong", "", name), link, speed);
    const rx = metric("Receive"); const tx = metric("Transmit");
    summary.append(identity, rx.container, tx.container);
    const body = element("div", "watch-port-body");
    const description = element("p", "muted");
    const freshness = element("p", "watch-freshness");
    const packets = element("p", "watch-packets");
    const graphHeader = element("div", "watch-chart-heading");
    const ceiling = element("span");
    graphHeader.append(element("span", "watch-rx", "━ Receive"), element("span", "watch-tx", "━ Transmit"), ceiling);
    const graph = doc.createElementNS("http://www.w3.org/2000/svg", "svg");
    graph.classList.add("watch-chart"); graph.setAttribute("viewBox", "0 0 720 150"); graph.setAttribute("role", "img");
    graph.setAttribute("aria-label", `${name}: receive and transmit rates over the last 120 seconds`);
    const axis = element("div", "watch-chart-axis"); axis.append(element("span", "", "120 seconds ago"), element("span", "", "Now"));
    const errors = element("details", "watch-section");
    const errorsSummary = element("summary", "", "Errors & link changes");
    const errorValues = element("dl", "watch-error-values");
    const errorFields = {};
    const labels = { inputErrors: "New input errors", outputErrors: "New output errors", inputDrops: "New input drops",
      outputDrops: "New output drops", framingErrors: "New framing errors", carrierTransitions: "New carrier transitions" };
    COUNTERS.forEach((key) => { const value = element("dd"); errorFields[key] = value; errorValues.append(element("dt", "", labels[key]), value); });
    const flap = element("p", "muted"); const events = element("ul", "watch-events");
    errors.append(errorsSummary, element("p", "credential-note", "Counter increases since this view's baseline. Switch counters are never cleared."), errorValues, flap, events);
    const poe = element("details", "watch-section"); const poeText = element("p");
    poe.append(element("summary", "", "PoE"), poeText);
    const learned = element("details", "watch-section"); const learnedText = element("p");
    learned.append(element("summary", "", "Learned device details"), learnedText);
    body.append(description, freshness, packets, graphHeader, graph, axis, errors, poe, learned);
    node.append(summary, body); controls.watchPorts.appendChild(node);
    return { node, link, speed, rx: rx.value, tx: tx.value, description, freshness, packets, graph, ceiling,
      errorsSummary, errorFields, flap, events, poeText, learnedText };
  }
  function drawGraph(card, record, now) {
    const points = record.points.filter((point) => point.time >= now - HISTORY_MS);
    const max = Math.max(1, ...points.flatMap((point) => [point.rx || 0, point.tx || 0]));
    card.ceiling.textContent = `Scale 0–${bitRate(max)}`;
    card.graph.replaceChildren();
    [0, 75, 150].forEach((y) => {
      const line = doc.createElementNS("http://www.w3.org/2000/svg", "line");
      line.setAttribute("x1", "0"); line.setAttribute("x2", "720"); line.setAttribute("y1", String(y)); line.setAttribute("y2", String(y));
      line.setAttribute("class", "watch-chart-grid"); card.graph.appendChild(line);
    });
    ["rx", "tx"].forEach((key) => {
      let segment = [];
      const flush = () => {
        if (segment.length) {
          const path = doc.createElementNS("http://www.w3.org/2000/svg", "polyline");
          path.setAttribute("points", segment.join(" ")); path.setAttribute("class", `watch-line watch-${key}`);
          card.graph.appendChild(path);
          if (segment.length === 1) {
            const [x, y] = segment[0].split(",");
            const dot = doc.createElementNS("http://www.w3.org/2000/svg", "circle");
            dot.setAttribute("cx", x); dot.setAttribute("cy", y); dot.setAttribute("r", "3");
            dot.setAttribute("class", `watch-dot watch-${key}`); card.graph.appendChild(dot);
          }
        }
        segment = [];
      };
      points.forEach((point) => {
        if (point[key] === null) { flush(); return; }
        segment.push(`${Math.max(0, (point.time - now + HISTORY_MS) / HISTORY_MS * 720).toFixed(2)},${(145 - point[key] / max * 140).toFixed(2)}`);
      });
      flush();
    });
  }
  function render(controller) {
    const context = root.getLiveWatchContext();
    controls.watchSelectionHint.textContent = `${context.selected.size} selected · Watch up to 8 ports. Watched ports stay pinned when the configuration selection changes.`;
    if (controls.watchStatus.textContent !== controller.status) controls.watchStatus.textContent = controller.status;
    controls.watchStatus.className = `tool-summary ${[...controller.records.values()].some((record) => record.error) ? "error-text" : "muted"}`;
    controls.watchSelectedBtn.disabled = context.busy || !context.connected;
    controls.watchPauseBtn.disabled = !controller.names.length;
    controls.watchPauseBtn.textContent = controller.running ? "Pause" : "Resume";
    controls.watchCheckBtn.disabled = !controller.names.length || controller.busy || context.busy;
    controls.watchResetBtn.disabled = !controller.names.length || controller.busy;
    [...cards].forEach(([name, card]) => { if (!controller.records.has(name)) { card.node.remove(); cards.delete(name); } });
    const now = Date.now();
    controller.names.forEach((name, index) => {
      if (!cards.has(name)) cards.set(name, createCard(name, index < 2));
      const card = cards.get(name); const record = controller.records.get(name); const sample = record.latest;
      const inventory = context.ports.find((port) => port.name === name);
      const age = record.receivedAt === null ? null : (now - record.receivedAt) / 1000;
      const stale = age === null || age > Math.max(12, controller.intervalMs / 1000 * 3) || !!record.error;
      card.node.classList.toggle("watch-stale", stale || !controller.running);
      card.link.textContent = sample ? `${sample.admin === "down" ? "Disabled" : sample.oper === "up" ? "Link up" : "Link down"}${stale || !controller.running ? " · last sample" : ""}` : "Waiting for sample";
      card.link.className = `watch-link ${sample?.oper === "up" && sample?.admin === "up" ? "up" : "down"}`;
      card.speed.textContent = sample ? `Reported speed: ${sample.speed}` : "Reported speed: —";
      const currentRates = stale ? null : record.rates;
      card.rx.textContent = bitRate(currentRates?.rxBytes); card.tx.textContent = bitRate(currentRates?.txBytes);
      card.description.textContent = sample?.description || inventory?.currentDescription || "No description";
      card.freshness.textContent = record.error ? `Read unavailable: ${record.error}${age !== null ? ` · Last success ${Math.floor(age)}s ago` : ""}`
        : sample ? `${stale ? "Stale" : !controller.running ? "Paused / manual sample" : "Last sample"}: ${new Date(sample.sampledAt).toLocaleTimeString()} · ${Math.floor(age)}s ago${!record.rates ? " · Waiting for two comparable samples" : ""}`
          : "Waiting for the first sample. Rates need two successful samples.";
      const pps = (value) => value === null || value === undefined ? "—" : `${value.toLocaleString(undefined, { maximumFractionDigits: 1 })} packets/s`;
      const utilization = (value) => value === null || value === undefined || !sample?.speedBps ? "—" : `${(value / sample.speedBps * 100).toFixed(1)}%`;
      card.packets.textContent = `RX ${pps(currentRates?.rxPackets)} · TX ${pps(currentRates?.txPackets)} · Link utilization RX ${utilization(currentRates?.rxBytes)} / TX ${utilization(currentRates?.txBytes)}`;
      const knownTotal = (key) => sample?.counters?.[key] === null || sample?.counters?.[key] === undefined ? undefined : record.totals[key];
      COUNTERS.forEach((key) => { card.errorFields[key].textContent = knownTotal(key) === undefined ? "Unavailable" : knownTotal(key).toLocaleString(); });
      card.errorsSummary.textContent = `Errors & link changes · new input ${knownTotal("inputErrors") ?? "—"} / output ${knownTotal("outputErrors") ?? "—"}`;
      card.flap.textContent = `Switch-reported last flap: ${sample?.lastFlapped || "Unknown"}`;
      card.events.replaceChildren(...record.events.map((event) => element("li", "", `${new Date(event.time).toLocaleTimeString()} · ${event.message}`)));
      const poe = sample?.poe;
      card.poeText.textContent = !controller.includePoe ? "Enable Collect PoE above to read power information."
        : !poe ? "No PoE sample yet." : poe.available
          ? `Admin: ${poe.admin || "Unknown"} · Operational: ${poe.oper || "Unknown"} · Consumption: ${poe.watts || "Unavailable"} · Collected ${new Date(poe.sampledAt).toLocaleTimeString()}`
          : `Unavailable: ${poe.error}`;
      const evidence = inventory?.learnedMacs?.map((mac) => `${mac.mac}${mac.manufacturer ? ` (${mac.manufacturer})` : ""}`).join(", ");
      const neighbor = inventory?.lldpNeighbor;
      card.learnedText.textContent = `Inventory evidence${context.inventoryAt ? ` collected ${new Date(context.inventoryAt).toLocaleTimeString()}` : ""}. MACs: ${evidence || "None learned"}. LLDP: ${neighbor?.systemName || neighbor?.chassisId || "None learned"}. Learned records can remain after a device disconnects; refresh inventory for a new pull.`;
      drawGraph(card, record, now);
    });
  }
  const controller = new LiveWatchController({
    context: () => ({ ...root.getLiveWatchContext(), hidden: doc.hidden }), now: () => Date.now(), render,
    schedule: (fn, delay) => root.setTimeout(fn, delay), cancel: (timer) => root.clearTimeout(timer),
    abort: () => abort?.abort(),
    request: async (url, payload) => {
      const isSample = url.endsWith("/sample");
      const requestAbort = isSample ? new AbortController() : null;
      if (isSample) abort = requestAbort;
      const timeout = isSample ? root.setTimeout(() => requestAbort.abort(), 25000) : null;
      try {
        const response = await root.fetch(url, { method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload), ...(isSample ? { signal: requestAbort.signal } : {}) });
        const result = await response.json();
        if (!response.ok && !result.ports && !result.sessionExpired) throw new Error(result.error || "Statistics request failed");
        return result;
      } finally {
        if (timeout !== null) root.clearTimeout(timeout);
        if (abort === requestAbort) abort = null;
      }
    }
  });
  controls.watchSelectedBtn.addEventListener("click", () => controller.start());
  controls.watchPauseBtn.addEventListener("click", () => controller.running ? controller.stop() : controller.resume());
  controls.watchCheckBtn.addEventListener("click", () => controller.poll(true));
  controls.watchResetBtn.addEventListener("click", () => controller.reset());
  controls.watchInterval.addEventListener("change", () => { controller.intervalMs = Number(controls.watchInterval.value) * 1000; controller.schedule(); });
  controls.watchPoe.addEventListener("change", () => { controller.includePoe = controls.watchPoe.checked; controller.notify(); });
  doc.addEventListener("visibilitychange", () => {
    controller.records.forEach((record) => { record.rateGap = true; });
    if (!doc.hidden && controller.running) void controller.poll();
  });
  root.addEventListener("pagehide", () => {
    controller.cancelTimer();
    if (controller.sessionId) root.fetch("/api/live-watch/stop", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: controller.sessionId }), keepalive: true }).catch(() => {});
  });
  root.setInterval(() => { if (controller.names.length && !doc.hidden) controller.notify(); }, 1000);
  root.liveWatch = { onContextChange: () => controller.contextChanged(), resetConnection: () => controller.stop(true) };
  controller.notify();
})(typeof window !== "undefined" ? window : globalThis);
