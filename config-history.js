(function (root) {
  "use strict";

  class ConfigHistoryController {
    constructor(env) {
      this.env = env;
      this.key = "";
      this.generation = 0;
      this.depth = 20;
      this.data = null;
      this.results = new Map();
      this.selected = null;
      this.loading = false;
      this.batch = false;
      this.mutating = false;
      this.message = "Connect to a switch, then refresh its configuration history.";
    }
    contextChanged() {
      const context = this.env.context();
      const key = JSON.stringify(context.payload);
      if (key !== this.key) {
        this.key = key;
        this.generation += 1;
        this.data = null;
        this.results.clear();
        this.selected = null;
        this.loading = false;
        this.batch = false;
        this.message = "Refresh history for this switch. Comparisons expire after five minutes.";
      } else if (this.renderSignature() === this.renderState) {
        return;
      }
      this.notify();
    }
    renderSignature() {
      const context = this.env.context();
      const selected = this.results.get(this.selected);
      return JSON.stringify([context.connected, context.busy, context.pending, context.hasDraft,
        context.pendingRestore?.host, !!selected?.expiresAt && this.env.now() >= selected.expiresAt]);
    }
    notify() { this.renderState = this.renderSignature(); this.env.render(this); }
    valid(generation, key) {
      return generation === this.generation && key === JSON.stringify(this.env.context().payload);
    }
    keyFor(source) { return source === "rescue" ? "rescue" : String(source.index); }
    sourceFor(source) { return source === "rescue" ? this.data?.knownGood : source; }
    canRead() { const c = this.env.context(); return c.connected && !c.busy && !this.loading && !this.mutating; }
    canRestore() {
      const c = this.env.context();
      const result = this.results.get(this.selected);
      return this.canRead() && !this.batch && !c.pending && !c.hasDraft && !this.data?.pendingConfirmation
        && result?.previewToken && !result.identical && !result.error
        && this.env.now() < result.expiresAt;
    }
    async load() {
      if (!this.canRead() || this.batch) return;
      const generation = ++this.generation;
      const context = this.env.context();
      const key = JSON.stringify(context.payload);
      this.loading = true;
      this.results.clear();
      this.selected = null;
      this.message = "Reading commit history and known-good rescue configuration…";
      this.notify();
      try {
        const data = await this.env.request("/api/config-history", { ...context.payload, depth: this.depth });
        if (!this.valid(generation, key)) return;
        this.data = data;
        this.message = `Loaded current and ${Math.max(0, data.entries.length - 1)} previous versions. ${data.catalogWarning || "Choose a version or compare all shown."}`;
      } catch (error) {
        if (!this.valid(generation, key)) return;
        this.data = null;
        this.message = error.message;
      } finally {
        if (this.valid(generation, key)) { this.loading = false; this.notify(); }
      }
    }
    async compare(source, inBatch = false) {
      if (!this.canRead() || (this.batch && !inBatch)) return;
      const identity = this.sourceFor(source);
      if (!identity?.sourceToken) return;
      const id = this.keyFor(source);
      const generation = this.generation;
      const context = this.env.context();
      const key = JSON.stringify(context.payload);
      this.selected = id;
      this.loading = true;
      this.results.set(id, { status: "Comparing…" });
      this.notify();
      try {
        const data = await this.env.request("/api/config-history/compare", { ...context.payload, sourceToken: identity.sourceToken });
        if (!this.valid(generation, key)) return;
        this.results.set(id, { ...data, status: data.identical ? "Identical" : `+${data.addedLines} / −${data.removedLines} lines`,
          expiresAt: this.env.now() + data.expiresInSeconds * 1000 });
        this.message = data.pendingConfirmation ? "The switch has a pending confirmed commit. Restore and known-good save are blocked."
          : "Preview shows what restoring this version would add (+) and remove (−) from current.";
      } catch (error) {
        if (!this.valid(generation, key)) return;
        if (error.status === 409) {
          for (const id of this.results.keys()) this.results.set(id, { status: "Stale", error: "The reviewed baseline expired or changed. Refresh history." });
          this.data.baselineToken = "";
          this.batch = false;
        }
        this.results.set(id, { status: "Comparison failed", error: error.message });
        this.message = error.message;
      } finally {
        if (this.valid(generation, key)) { this.loading = false; this.notify(); }
      }
    }
    select(id) { this.selected = id; this.notify(); }
    async compareAll() {
      if (!this.canRead() || this.batch || !this.data) return;
      this.batch = true;
      const generation = this.generation;
      const entries = this.data.entries.filter((row) => row.index !== 0);
      for (let index = 0; index < entries.length; index += 1) {
        if (!this.batch || generation !== this.generation || this.env.context().busy) break;
        await this.compare(entries[index], true);
        if (generation !== this.generation) break;
        if (!this.batch) { this.notify(); break; }
        this.message = `Compared ${index + 1} of ${entries.length} versions. Each result is relative to the same reviewed current commit.`;
        this.notify();
      }
      if (generation === this.generation) { this.batch = false; this.notify(); }
    }
    cancelBatch() { this.batch = false; this.message = "Stopping after the in-progress comparison. Completed results are retained."; this.notify(); }
    async saveKnownGood(label) {
      const context = this.env.context();
      if (!this.canRead() || this.batch || context.pending || this.data?.pendingConfirmation || !this.data?.baselineToken || this.data.knownGood.error) return;
      const replacing = this.data.knownGood.available;
      if (!this.env.confirm(`${replacing ? "Replace the existing rescue configuration" : "Save the current committed configuration as known good"} on ${context.payload.host}?\n\nThis saves the active switch configuration, independently of editor drafts. ${replacing ? "The previous rescue backup will be replaced." : "It does not deploy configuration."}`)) return;
      await this.mutate("/api/config-history/known-good", { baselineToken: this.data.baselineToken,
        replaceFingerprint: replacing ? this.data.knownGood.fingerprint : "", label }, context);
    }
    async restore() {
      if (!this.canRestore()) return;
      const context = this.env.context();
      const result = this.results.get(this.selected);
      if (!this.env.confirm(`Restore ${result.sourceLabel} on ${context.payload.host}?\n\nThis replaces the WHOLE switch configuration, including changes to unrelated ports, VLANs, and management access.\n\nThe switch will use a five-minute confirmed commit. Verify service and confirm before it expires.`)) return;
      await this.mutate("/api/config-history/restore", { previewToken: result.previewToken }, context);
    }
    async mutate(path, extra, context) {
      this.mutating = true;
      this.env.setBusy(true);
      this.message = path.endsWith("restore") ? "Loading and checking the reviewed configuration before the protected restore…" : "Saving and verifying the known-good rescue configuration…";
      this.notify();
      let result;
      try {
        result = await this.env.request(path, { ...context.payload, ...extra });
        this.message = path.endsWith("restore") ? "Restore applied. Verify service and confirm within five minutes."
          : `Known-good save verified. ${result.catalogWarning || "Its metadata is available in the all-device activity log."}`;
        if (result.pendingConfirmation) this.env.onRestore(result, context.payload);
        if (result.activityWarning) this.message += ` ${result.activityWarning}`;
        if (this.data) this.data.baselineToken = "";
        this.results.clear();
      } catch (error) {
        this.results.clear();
        if (this.data) this.data.baselineToken = "";
        this.message = `${error.message} Refresh history before retrying.`;
      } finally {
        this.mutating = false;
        this.env.setBusy(false);
        this.notify();
      }
      if (result) {
        await this.env.onChanged();
        const message = this.message;
        await this.load();
        this.message = message;
        this.notify();
      }
    }
  }

  function mount(env, document) {
    const ids = ["historyRefresh", "historyDepth", "historyCompareAll", "historyCancel", "historyStatus", "historyBaseline",
      "historyKnownGood", "historyLabel", "historySaveKnownGood", "historyCompareKnownGood", "historyRestoreKnownGood", "historyCatalog", "historyRows", "historyDiffTitle", "historyDiff", "historyRestore", "historyConfirm", "historyDraftHint"];
    const ui = Object.fromEntries(ids.map((id) => [id, document.getElementById(id)]));
    const element = (tag, text, className) => {
      const node = document.createElement(tag);
      if (text !== undefined) node.textContent = text;
      if (className) node.className = className;
      return node;
    };
    let controller;
    env.render = (model) => {
      const context = env.context();
      const canRead = model.canRead();
      ui.historyStatus.textContent = model.message;
      ui.historyRefresh.disabled = !canRead || model.batch;
      ui.historyDepth.disabled = model.loading || model.batch || model.mutating;
      ui.historyCompareAll.disabled = !canRead || model.batch || !model.data;
      ui.historyCancel.hidden = !model.batch;
      ui.historySaveKnownGood.disabled = !canRead || model.batch || context.pending || model.data?.pendingConfirmation || !model.data?.baselineToken || !!model.data?.knownGood.error;
      ui.historyLabel.disabled = model.mutating;
      ui.historyCompareKnownGood.disabled = !canRead || model.batch || !model.data?.knownGood.sourceToken;
      ui.historyRestoreKnownGood.disabled = ui.historyCompareKnownGood.disabled || context.hasDraft || context.pending;
      ui.historyRestore.disabled = !model.canRestore();
      ui.historyConfirm.hidden = !context.pendingRestore;
      ui.historyConfirm.disabled = context.busy;
      ui.historyConfirm.textContent = context.pendingRestore ? `Confirm restore on ${context.pendingRestore.host}` : "Confirm restored configuration";
      ui.historyDraftHint.textContent = context.hasDraft ? "Your editor or queue contains staged work. Clear it explicitly before restoring; it will never be combined with a rollback."
        : context.pending ? "A committed change awaits confirmation. Use the confirmation button before another restore."
          : "Restores affect the entire switch. Review the diff, apply with protection, then confirm after checking service.";
      ui.historyBaseline.textContent = model.data ? `Current: ${model.data.baselineRevision || model.data.baselineFingerprint.slice(0, 12)} · Read ${new Date(model.data.collectedAt).toLocaleString()}` : "No switch history loaded.";
      const known = model.data?.knownGood;
      const metadata = known?.catalog;
      ui.historyKnownGood.textContent = known?.error ? `Rescue configuration unavailable: ${known.error}`
        : known?.available ? `${metadata?.label || "Switch rescue configuration"} · ${known.fingerprint.slice(0, 12)}${metadata?.savedAt ? ` · Saved ${new Date(metadata.savedAt).toLocaleString()} by ${metadata.operator}` : " · Existing rescue; save details unknown"}`
          : "No readable known-good rescue configuration has been found. Refresh history to check.";
      ui.historySaveKnownGood.textContent = known?.available ? "Replace known good with current" : "Save current as known good";
      ui.historyRows.replaceChildren();
      for (const row of model.data?.entries || []) {
        const item = element("tr");
        const result = model.results.get(String(row.index));
        if (model.selected === String(row.index)) item.className = "history-selected";
        for (const value of [row.index === 0 ? "Current" : `Rollback ${row.index}`, row.timestamp || "Unknown", row.user || "Unknown", row.comment || "—"]) item.appendChild(element("td", value));
        const action = element("td");
        if (row.index === 0) action.textContent = "Comparison baseline";
        else {
          const button = element("button", result?.status || "Compare", "secondary compact-button");
          button.type = "button";
          button.disabled = !canRead || model.batch;
          button.addEventListener("click", () => result && !result.error ? model.select(String(row.index)) : void model.compare(row));
          action.appendChild(button);
          if (result && !result.error) {
            const refresh = element("button", "Compare again", "secondary compact-button");
            refresh.type = "button";
            refresh.disabled = !canRead || model.batch;
            refresh.addEventListener("click", () => model.compare(row));
            action.appendChild(refresh);
          }
        }
        item.appendChild(action);
        ui.historyRows.appendChild(item);
      }
      const selected = model.results.get(model.selected);
      ui.historyRestore.textContent = selected?.sourceLabel === "rescue" ? "Restore known good with protection" : "Restore selected version with protection";
      ui.historyDiffTitle.textContent = selected?.sourceLabel ? `Restore preview: current → ${selected.sourceLabel}` : "Configuration comparison";
      ui.historyDiff.replaceChildren();
      const text = selected?.error || (selected?.identical ? "This version matches the current configuration." : selected?.diff)
        || "Choose a historical version or known good to compare. Sensitive configuration values are masked.";
      for (const line of text.split("\n")) {
        const type = line.startsWith("+") ? "added" : line.startsWith("-") ? "removed" : line.startsWith("@@") ? "hunk" : "context";
        ui.historyDiff.appendChild(element("span", line + "\n", `history-diff-${type}`));
      }
    };
    controller = new ConfigHistoryController(env);
    ui.historyRefresh.addEventListener("click", () => controller.load());
    ui.historyDepth.addEventListener("change", () => { controller.depth = Number(ui.historyDepth.value); controller.load(); });
    ui.historyCompareAll.addEventListener("click", () => controller.compareAll());
    ui.historyCancel.addEventListener("click", () => controller.cancelBatch());
    ui.historyCompareKnownGood.addEventListener("click", () => controller.compare("rescue"));
    ui.historyRestoreKnownGood.addEventListener("click", async () => {
      await controller.compare("rescue");
      ui.historyDiff.scrollIntoView({ behavior: "smooth", block: "center" });
      ui.historyRestore.focus();
    });
    ui.historyCatalog.addEventListener("click", env.openCatalog);
    ui.historySaveKnownGood.addEventListener("click", () => controller.saveKnownGood(ui.historyLabel.value));
    ui.historyRestore.addEventListener("click", () => controller.restore());
    ui.historyConfirm.addEventListener("click", env.confirmRestore);
    controller.contextChanged();
    return controller;
  }

  if (typeof module !== "undefined" && module.exports) module.exports = { ConfigHistoryController, mount };
  if (!root.document || !root.getConfigHistoryContext) return;
  const controller = mount({ context: root.getConfigHistoryContext, now: () => Date.now(), confirm: (message) => root.confirm(message),
    setBusy: root.setHistoryChangeInProgress, onRestore: root.beginHistoryConfirmation,
    onChanged: () => root.connectToSwitch({ isRefresh: true }), confirmRestore: root.confirmCommit,
    openCatalog: () => root.showActivityLog({ knownGood: true }),
    request: async (url, payload) => {
      const response = await root.fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const data = await response.json();
      if (!response.ok || !data.ok) {
        const error = new Error(data.error || "Switch request failed");
        error.status = response.status;
        throw error;
      }
      return data;
    }
  }, root.document);
  root.configHistory = { onContextChange: () => controller.contextChanged() };
  root.setInterval(() => controller.contextChanged(), 1000);
})(typeof window !== "undefined" ? window : globalThis);
