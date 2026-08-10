// SituationRoom — custom fullscreen mission-control shell.
//
// Static-export rules honored throughout (see manywidgets docs/guides):
// one listener per trait, save_changes wrapped, vanilla DOM only, styles via
// _css. The helpers below are vendored from @manywidgets/core (not published
// to npm; esbuild inlines it for in-repo widgets, out-of-tree widgets vendor).

const POLL_MS = 50;
const MAX_RUN_MS = 30 * 60 * 1000;

// ── vendored @manywidgets/core helpers ──────────────────────────────────────

function safeSaveChanges(model) {
  try {
    model?.save_changes?.();
  } catch {
    /* no kernel (static export) */
  }
}

function stripIpy(id) {
  return id ? String(id).replace(/^IPY_MODEL_/, "") : "";
}

function idOf(ref) {
  if (typeof ref === "string") return stripIpy(ref);
  return ref && typeof ref.model_id === "string" ? ref.model_id : "";
}

function asNumber(value, fallback = 0) {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function deliverCustomMessage(model, content, buffers = []) {
  if (typeof model.receiveCustomMessage === "function") {
    model.receiveCustomMessage(content, buffers); // static export proxy
  } else if (typeof model.trigger === "function") {
    model.trigger("msg:custom", content, buffers); // live Backbone model
  }
}

function getStaticRegistry() {
  const hosts = globalThis.__myst_anywidget_hosts;
  if (!hosts || typeof hosts.values !== "function") return null;
  for (const v of hosts.values()) return v;
  return null;
}

function findAllInRegistry(reg, id) {
  const out = [];
  const seen = new Set();
  const push = (m) => {
    if (m && !seen.has(m)) {
      seen.add(m);
      out.push(m);
    }
  };
  if (typeof reg.get === "function") push(reg.get(id));
  const all =
    typeof reg.filter === "function"
      ? reg.filter((w) => !!w && w.model_id === id)
      : typeof reg.all === "function"
        ? reg.all().filter((w) => !!w && w.model_id === id)
        : [];
  for (const m of all) push(m);
  return out;
}

function makeHandle(getModels) {
  return {
    get models() {
      return getModels();
    },
    get(field) {
      const ms = getModels();
      return ms.length ? ms[0].get(field) : undefined;
    },
    set(field, value) {
      for (const m of getModels()) m.set(field, value);
    },
    save() {
      for (const m of getModels()) safeSaveChanges(m);
    },
    sendCustom(content, buffers = []) {
      for (const m of getModels()) deliverCustomMessage(m, content, buffers);
    },
  };
}

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms);
    promise.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

async function resolveModel(model, ref, { timeout = 5000 } = {}) {
  const id = stripIpy(ref);
  const reg = getStaticRegistry();
  if (reg) return makeHandle(() => findAllInRegistry(reg, id));
  if (model.widget_manager?.get_model) {
    const resolved = await withTimeout(model.widget_manager.get_model(id), timeout);
    const current = resolved ?? null;
    return makeHandle(() => (current ? [current] : []));
  }
  throw new Error(`[situation-room] cannot resolve model "${id}"`);
}

async function renderChild(args, ref, el) {
  if (args.host && typeof args.host.renderChild === "function") {
    const dispose = await args.host.renderChild(ref, el);
    return typeof dispose === "function" ? dispose : () => {};
  }
  const wm = args.model.widget_manager;
  if (!wm || typeof wm.create_view !== "function") {
    throw new Error("[situation-room] renderChild needs a static host or widget_manager");
  }
  const child = typeof ref === "string" ? await wm.get_model(stripIpy(ref)) : ref;
  const view = await wm.create_view(child);
  el.appendChild(view.el);
  return () => {
    try {
      view.remove?.();
    } catch {
      /* best-effort */
    }
  };
}

// ── tiny DOM helpers ────────────────────────────────────────────────────────

function h(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text != null) node.textContent = text;
  return node;
}

const fmt = (n) => asNumber(n).toLocaleString("en-US");

function fmtCompact(n) {
  const v = asNumber(n);
  if (v >= 1e6) return `${(v / 1e6).toFixed(v >= 1e7 ? 0 : 1)}M`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(v >= 1e4 ? 0 : 1)}k`;
  return `${Math.round(v)}`;
}

const ALERT_COLORS = { Red: "#ff4d4d", Orange: "#ff9f1a", Green: "#3dd68c" };

// ── teaser card (inline child of Fullscreen) ────────────────────────────────

function renderTeaser(model, el) {
  const meta = model.get("meta") || {};
  const stats = model.get("stats") || {};
  const card = h("div", "sr-teaser");
  card.appendChild(h("div", "sr-kicker", meta.kicker || "Fullscreen demo"));
  card.appendChild(h("div", "sr-teaser-title", meta.title || "Situation room"));
  if (meta.subtitle) card.appendChild(h("div", "sr-teaser-sub", meta.subtitle));

  const row = h("div", "sr-teaser-stats");
  for (const tile of stats.tiles || []) {
    const cell = h("div", "sr-teaser-stat");
    const value = h("div", "sr-teaser-stat-value", tile.value);
    if (tile.color) value.style.color = tile.color;
    cell.appendChild(value);
    cell.appendChild(h("div", "sr-teaser-stat-label", tile.label));
    row.appendChild(cell);
  }
  card.appendChild(row);
  card.appendChild(h("div", "sr-teaser-hint", "⛶  Expand to open the situation room"));
  el.appendChild(card);
}

// ── the app shell ───────────────────────────────────────────────────────────

async function render(args) {
  const { model, el } = args;
  el.classList.add("situation-room");

  if (model.get("mode") === "teaser") {
    renderTeaser(model, el);
    return () => {};
  }

  const meta = model.get("meta") || {};
  const types = model.get("types") || [];
  const stats = model.get("stats") || {};
  const events = model.get("events") || [];
  const typeByKey = new Map(types.map((t) => [t.key, t]));

  let disposed = false;
  const cleanups = [() => (disposed = true)];

  // — layout skeleton: header + (rail | event list | map) —
  const app = h("div", "sr-app");
  const header = h("header", "sr-header");
  const titleBlock = h("div", "sr-title-block");
  titleBlock.appendChild(h("div", "sr-kicker", meta.kicker || ""));
  titleBlock.appendChild(h("h1", "sr-title", meta.title || "Situation room"));
  if (meta.subtitle) titleBlock.appendChild(h("div", "sr-subtitle", meta.subtitle));
  header.appendChild(titleBlock);

  const headRight = h("div", "sr-head-right");
  if (meta.window_label) headRight.appendChild(h("div", "sr-window", meta.window_label));
  const alertCounts = {};
  for (const ev of events) alertCounts[ev.alert] = (alertCounts[ev.alert] || 0) + 1;
  const badges = h("div", "sr-badges");
  for (const level of ["Red", "Orange", "Green"]) {
    if (!alertCounts[level]) continue;
    const b = h("span", "sr-badge");
    const dot = h("i", "sr-dot");
    dot.style.background = ALERT_COLORS[level];
    b.append(dot, document.createTextNode(`${alertCounts[level]} ${level}`));
    badges.appendChild(b);
  }
  headRight.appendChild(badges);
  header.appendChild(headRight);
  app.appendChild(header);

  const body = h("div", "sr-body");
  const rail = h("aside", "sr-rail");
  const listCol = h("aside", "sr-list-col");
  const main = h("main", "sr-main");
  body.append(rail, listCol, main);
  app.appendChild(body);
  el.appendChild(app);

  const tip = h("div", "sr-tip");
  tip.style.display = "none";
  app.appendChild(tip);
  const showTip = (evt, text) => {
    tip.textContent = text;
    tip.style.display = "block";
    const rect = app.getBoundingClientRect();
    tip.style.left = `${Math.min(evt.clientX - rect.left + 14, rect.width - 260)}px`;
    tip.style.top = `${evt.clientY - rect.top + 14}px`;
  };
  const hideTip = () => (tip.style.display = "none");

  // — stat tiles —
  const tiles = h("section", "sr-section sr-tiles");
  for (const tile of stats.tiles || []) {
    const cell = h("div", "sr-tile");
    const value = h("div", "sr-tile-value", tile.value);
    if (tile.color) value.style.color = tile.color;
    cell.appendChild(value);
    cell.appendChild(h("div", "sr-tile-label", tile.label));
    if (tile.sub) cell.appendChild(h("div", "sr-tile-sub", tile.sub));
    tiles.appendChild(cell);
  }
  rail.appendChild(tiles);

  // — weekly pulse chart (stacked columns by hazard type) —
  // Prefer precomputed raw-registration buckets from meta; fall back to
  // bucketing the (collapsed) event list by its week index.
  let buckets;
  let unit = "registration";
  if (Array.isArray(meta.weekly) && meta.weekly.length) {
    buckets = meta.weekly;
  } else {
    unit = "event";
    const weeks = Math.max(1, ...events.map((e) => asNumber(e.week) + 1));
    buckets = Array.from({ length: weeks }, () => ({}));
    for (const ev of events) {
      const w = asNumber(ev.week);
      if (w < 0) continue; // long-running event registered before the window
      const wi = Math.min(w, buckets.length - 1);
      buckets[wi][ev.type] = (buckets[wi][ev.type] || 0) + 1;
    }
  }
  const maxWeek = Math.max(1, ...buckets.map((b) => Object.values(b).reduce((a, v) => a + v, 0)));

  const chartSection = h("section", "sr-section");
  chartSection.appendChild(h("h2", "sr-section-title", meta.weekly_title || "Events per week"));
  const chart = h("div", "sr-chart");
  const segEls = []; // {seg, type}
  buckets.forEach((bucket, wi) => {
    const col = h("div", "sr-chart-col");
    const stack = h("div", "sr-chart-stack");
    for (const t of types) {
      const n = bucket[t.key] || 0;
      if (!n) continue;
      const seg = h("div", "sr-chart-seg");
      seg.style.height = `${(n / maxWeek) * 100}%`;
      seg.style.background = t.color;
      seg.addEventListener("mousemove", (evt) =>
        showTip(evt, `Week ${wi + 1}: ${n} ${t.label.toLowerCase()} ${unit}${n > 1 ? "s" : ""}`),
      );
      seg.addEventListener("mouseleave", hideTip);
      stack.appendChild(seg);
      segEls.push({ seg, type: t.key });
    }
    col.appendChild(stack);
    chart.appendChild(col);
  });
  chartSection.appendChild(chart);
  const axis = h("div", "sr-chart-axis");
  axis.append(h("span", null, meta.window_start_label || "90 days ago"), h("span", null, meta.window_end_label || "now"));
  chartSection.appendChild(axis);
  rail.appendChild(chartSection);

  // — hazard-type chips —
  const chipsSection = h("section", "sr-section");
  chipsSection.appendChild(h("h2", "sr-section-title", "Hazard types"));
  const chips = h("div", "sr-chips");
  const chipEls = new Map();
  for (const t of types) {
    const chip = h("button", "sr-chip", `${t.label} · ${fmt(t.count)}`);
    chip.type = "button";
    const dot = h("i", "sr-dot");
    dot.style.background = t.color;
    chip.prepend(dot);
    chip.addEventListener("click", () => toggleType(t.key));
    chips.appendChild(chip);
    chipEls.set(t.key, chip);
  }
  const allBtn = h("button", "sr-chip sr-chip--all", "Show all");
  allBtn.type = "button";
  allBtn.addEventListener("click", () => setSelectedTypes([]));
  chips.appendChild(allBtn);
  chipsSection.appendChild(chips);
  rail.appendChild(chipsSection);

  // — layer switches —
  const layersSection = h("section", "sr-section");
  layersSection.appendChild(h("h2", "sr-section-title", "Layers"));
  const makeSwitch = (label, initial, onFlip) => {
    const wrap = h("label", "sr-switch");
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = initial;
    const slider = h("span", "sr-switch-track");
    slider.appendChild(h("span", "sr-switch-thumb"));
    wrap.append(input, slider, h("span", "sr-switch-label", label));
    input.addEventListener("change", () => onFlip(input.checked));
    layersSection.appendChild(wrap);
    return input;
  };
  rail.appendChild(layersSection);

  const resetBtn = h("button", "sr-reset", "◎  Reset global view");
  resetBtn.type = "button";
  rail.appendChild(resetBtn);

  // — credits —
  const credits = h("footer", "sr-credits");
  for (const c of meta.credits || []) {
    const a = h("a", "sr-credit-link", c.label);
    a.href = c.url;
    a.target = "_blank";
    a.rel = "noopener";
    credits.appendChild(a);
  }
  if (meta.note) credits.appendChild(h("div", "sr-note", meta.note));
  rail.appendChild(credits);

  // — event list column —
  const listHead = h("div", "sr-list-head");
  listHead.appendChild(h("h2", "sr-section-title", "Event log"));
  const listCount = h("span", "sr-list-count", "");
  listHead.appendChild(listCount);
  listCol.appendChild(listHead);
  const list = h("div", "sr-list");
  listCol.appendChild(list);

  const rowEls = new Map(); // id -> {row, detail, ev}
  for (const ev of events) {
    const t = typeByKey.get(ev.type) || {};
    const row = h("article", "sr-event");
    row.tabIndex = 0;
    row.setAttribute("role", "button");
    const stripe = h("i", "sr-event-stripe");
    stripe.style.background = ALERT_COLORS[ev.alert] || ALERT_COLORS.Green;
    row.appendChild(stripe);

    const bodyEl = h("div", "sr-event-body");
    const top = h("div", "sr-event-top");
    const typeTag = h("span", "sr-event-type", t.label || ev.type);
    typeTag.style.color = t.color || "#8a94a0";
    top.append(typeTag, h("span", "sr-event-date", ev.date || ""));
    bodyEl.appendChild(top);
    bodyEl.appendChild(h("div", "sr-event-title", ev.title));
    const sub = [];
    if (ev.countries) sub.push(ev.countries);
    if (ev.affected) sub.push(`${fmtCompact(ev.affected)} affected`);
    if (sub.length) bodyEl.appendChild(h("div", "sr-event-sub", sub.join(" · ")));

    const detail = h("div", "sr-event-detail");
    detail.style.display = "none";
    if (ev.severity_text) detail.appendChild(h("div", "sr-event-sev", ev.severity_text));
    if (asNumber(ev.episodes) > 1) {
      detail.appendChild(
        h("div", "sr-event-sev", `Registered ${ev.episodes}× over the window — showing worst alert and peak impacts.`),
      );
    }
    if ((ev.impacts || []).length) {
      const table = h("div", "sr-impacts");
      for (const imp of ev.impacts) {
        const line = h("div", "sr-impact");
        line.appendChild(h("span", "sr-impact-label", imp.label + (imp.forecasted ? " (forecast)" : "")));
        line.appendChild(h("span", "sr-impact-value", fmt(imp.value)));
        table.appendChild(line);
      }
      detail.appendChild(table);
    } else {
      detail.appendChild(h("div", "sr-event-sev", "No impact reports for this event."));
    }
    bodyEl.appendChild(detail);
    row.appendChild(bodyEl);

    const activate = () => focusEvent(ev.id, { fly: true });
    row.addEventListener("click", activate);
    row.addEventListener("keydown", (evt) => {
      if (evt.key === "Enter" || evt.key === " ") {
        evt.preventDefault();
        activate();
      }
    });
    list.appendChild(row);
    rowEls.set(ev.id, { row, detail, ev });
  }

  // — main map area —
  const mapMount = h("div", "sr-map-mount");
  // Inline styles: an embedded widget overwrites el.className during its
  // render, which would drop any class-based sizing.
  mapMount.style.cssText = "position:absolute;inset:0;width:100%;height:100%;margin:0;";
  main.appendChild(mapMount);

  const legend = h("div", "sr-legend");
  for (const t of types) {
    const item = h("span", "sr-legend-item", t.label);
    const dot = h("i", "sr-dot");
    dot.style.background = t.color;
    item.prepend(dot);
    legend.appendChild(item);
  }
  main.appendChild(legend);
  if (meta.attribution) main.appendChild(h("div", "sr-attribution", meta.attribution));

  const mapRef = model.get("map");
  if (mapRef) {
    cleanups.push(await renderChild(args, mapRef, mapMount));
  } else {
    mapMount.appendChild(h("div", "sr-empty", "No map configured"));
  }

  // The wrapper divs the host inserts between this cell and the lonboard map
  // have no intrinsic height, which collapses the WebGL canvas to 0px.
  // Stretch any zero-height ancestor of a canvas, then make deck.gl /
  // maplibre re-measure. Re-run a few times to catch late-mounting maps.
  const fixMapHeights = () => {
    let touched = false;
    for (const canvas of mapMount.querySelectorAll("canvas")) {
      let node = canvas.parentElement;
      while (node && node !== mapMount) {
        if (node.clientHeight === 0 && node.style.height !== "100%") {
          node.style.height = "100%";
          touched = true;
        }
        node = node.parentElement;
      }
    }
    if (touched) window.dispatchEvent(new Event("resize"));
  };
  requestAnimationFrame(fixMapHeights);
  for (const delay of [300, 800, 1600, 3200]) setTimeout(fixMapHeights, delay);

  // — resolve driven models —
  let mapH = null;
  let pointLayerHs = []; // aligned with `types`
  let footprintLayerHs = []; // aligned with `footprint_types`
  let nightH = null;
  const footprintTypes = model.get("footprint_types") || [];
  try {
    const pointRefs = Array.isArray(model.get("point_layers")) ? model.get("point_layers") : [];
    const fpRefs = Array.isArray(model.get("footprint_layers")) ? model.get("footprint_layers") : [];
    [mapH, pointLayerHs, footprintLayerHs, nightH] = await Promise.all([
      mapRef ? resolveModel(model, idOf(mapRef)) : null,
      Promise.all(pointRefs.map((ref) => resolveModel(model, idOf(ref)))),
      Promise.all(fpRefs.map((ref) => resolveModel(model, idOf(ref)))),
      model.get("night_layer") ? resolveModel(model, idOf(model.get("night_layer"))) : null,
    ]);
  } catch (err) {
    console.warn("[situation-room] model resolution failed:", err);
  }

  const HOME = { longitude: 15, latitude: 14, zoom: 1.5, pitch: 0, bearing: 0 };
  function flyTo(camera, duration = 1800) {
    if (!mapH) return;
    mapH.sendCustom({ type: "fly-to", transitionDuration: duration, ...camera });
  }
  resetBtn.addEventListener("click", () => {
    flyTo(HOME, 1600);
    focusEvent("", { fly: false });
  });

  // — hazard-type selection → chips, list, chart, layer visibility —
  const allKeys = types.map((t) => t.key);
  const readSelectedTypes = () => {
    const sel = model.get("selected_types");
    return Array.isArray(sel) && sel.length ? sel.map(String) : allKeys.slice();
  };

  function setSelectedTypes(keys) {
    model.set("selected_types", keys);
    safeSaveChanges(model);
    refreshSelection();
  }

  function toggleType(key) {
    const active = new Set(readSelectedTypes());
    const wasAll = active.size === allKeys.length && !(model.get("selected_types") || []).length;
    if (wasAll) {
      // First narrowing click isolates that type.
      setSelectedTypes([key]);
      return;
    }
    if (active.has(key)) active.delete(key);
    else active.add(key);
    // Empty set flips back to "all" rather than "nothing".
    setSelectedTypes(active.size && active.size < allKeys.length ? [...active] : []);
  }

  let lastFilterKey = "";
  function applyLayerVisibility() {
    const sel = new Set(readSelectedTypes());
    const key =
      `${JSON.stringify([...sel].sort())}:` +
      `${pointLayerHs.map((h2) => h2.models.length).join(",")}:` +
      `${footprintLayerHs.map((h2) => h2.models.length).join(",")}`;
    if (key === lastFilterKey) return;
    lastFilterKey = key;
    pointLayerHs.forEach((h2, i) => {
      const t = types[i];
      if (!t) return;
      h2.set("visible", sel.has(t.key));
      h2.save();
    });
    footprintLayerHs.forEach((h2, i) => {
      const tKey = footprintTypes[i];
      if (!tKey) return;
      h2.set("visible", footprintsOn && sel.has(tKey));
      h2.save();
    });
  }

  function refreshSelection() {
    const sel = new Set(readSelectedTypes());
    const allActive = sel.size === allKeys.length;
    for (const [key, chip] of chipEls) chip.classList.toggle("sr-chip--active", sel.has(key) && !allActive);
    allBtn.classList.toggle("sr-chip--active", allActive);
    for (const { seg, type } of segEls) seg.classList.toggle("sr-chart-seg--dim", !sel.has(type));
    let visible = 0;
    for (const { row, ev } of rowEls.values()) {
      const show = sel.has(ev.type);
      row.style.display = show ? "" : "none";
      if (show) visible += 1;
    }
    listCount.textContent = `${fmt(visible)} of ${fmt(events.length)}`;
    lastFilterKey = ""; // force a layer-visibility pass
    applyLayerVisibility();
  }

  // — event focus —
  function focusEvent(id, { fly }) {
    const previous = model.get("selected_event");
    const next = id === previous ? (fly ? "" : id) : id;
    model.set("selected_event", next);
    safeSaveChanges(model);
    for (const [rid, { row, detail, ev }] of rowEls) {
      const active = rid === next;
      row.classList.toggle("sr-event--active", active);
      detail.style.display = active ? "" : "none";
      if (active && fly) {
        flyTo({ longitude: ev.lon, latitude: ev.lat, zoom: asNumber(ev.zoom, 5), pitch: 0, bearing: 0 });
        row.scrollIntoView({ block: "nearest", behavior: "smooth" });
      }
    }
  }

  const onSelectedTypes = () => refreshSelection();
  model.on("change:selected_types", onSelectedTypes);
  cleanups.push(() => model.off?.("change:selected_types", onSelectedTypes));

  // — layer switches wiring —
  let footprintsOn = true;
  makeSwitch("Hazard footprints", true, (on) => {
    footprintsOn = on;
    lastFilterKey = "";
    applyLayerVisibility();
  });
  makeSwitch("Night lights (VIIRS)", true, (on) => {
    if (nightH) {
      nightH.set("visible", on);
      nightH.save();
    }
  });

  // — initial paint + self-healing poll (late static proxies) —
  refreshSelection();
  const initialSelected = model.get("selected_event");
  if (initialSelected) focusEvent(initialSelected, { fly: false });
  const stopAt = Date.now() + MAX_RUN_MS;
  const loop = () => {
    if (disposed) return;
    try {
      applyLayerVisibility();
    } catch (err) {
      console.warn("[situation-room] tick error", err);
    }
    if (Date.now() < stopAt) setTimeout(loop, POLL_MS);
  };
  setTimeout(loop, POLL_MS);

  return () => {
    for (const dispose of cleanups.reverse()) {
      try {
        dispose();
      } catch {
        /* best-effort */
      }
    }
  };
}

export default { render };
