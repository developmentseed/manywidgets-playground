// FireExplorer — custom fullscreen web-app shell.
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

function setByPath(model, path, value) {
  const parts = path.split(".");
  if (parts.length === 1) {
    model.set(parts[0], value);
    return;
  }
  const topKey = parts[0];
  const existing = model.get(topKey);
  const next = existing && typeof existing === "object" ? { ...existing } : {};
  let cursor = next;
  for (let i = 1; i < parts.length - 1; i++) {
    const k = parts[i];
    const child = cursor[k];
    cursor[k] = child && typeof child === "object" ? { ...child } : {};
    cursor = cursor[k];
  }
  cursor[parts[parts.length - 1]] = value;
  model.set(topKey, next);
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
    setByPath(path, value) {
      for (const m of getModels()) setByPath(m, path, value);
    },
    save() {
      for (const m of getModels()) safeSaveChanges(m);
    },
    on(field, fn) {
      for (const m of getModels()) m.on?.(`change:${field}`, () => fn(m.get(field)));
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
  throw new Error(`[fire-explorer] cannot resolve model "${id}"`);
}

async function renderChild(args, ref, el) {
  if (args.host && typeof args.host.renderChild === "function") {
    const dispose = await args.host.renderChild(ref, el);
    return typeof dispose === "function" ? dispose : () => {};
  }
  const wm = args.model.widget_manager;
  if (!wm || typeof wm.create_view !== "function") {
    throw new Error("[fire-explorer] renderChild needs a static host or widget_manager");
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

// ── teaser card (inline child of Fullscreen) ────────────────────────────────

function renderTeaser(model, el) {
  const meta = model.get("meta") || {};
  const stats = model.get("stats") || {};
  const card = h("div", "fx-teaser");
  card.appendChild(h("div", "fx-kicker", meta.kicker || "Fullscreen demo"));
  card.appendChild(h("div", "fx-teaser-title", meta.title || "Fire explorer"));
  if (meta.subtitle) card.appendChild(h("div", "fx-teaser-sub", meta.subtitle));

  const row = h("div", "fx-teaser-stats");
  for (const tile of stats.tiles || []) {
    const cell = h("div", "fx-teaser-stat");
    const value = h("div", "fx-teaser-stat-value", tile.value);
    if (tile.color) value.style.color = tile.color;
    cell.appendChild(value);
    cell.appendChild(h("div", "fx-teaser-stat-label", tile.label));
    row.appendChild(cell);
  }
  card.appendChild(row);
  card.appendChild(h("div", "fx-teaser-hint", "⛶  Expand for the full interactive story"));
  el.appendChild(card);
}

// ── the app shell ───────────────────────────────────────────────────────────

async function render(args) {
  const { model, el } = args;
  el.classList.add("fire-explorer");

  if (model.get("mode") === "teaser") {
    renderTeaser(model, el);
    return () => {};
  }

  const meta = model.get("meta") || {};
  const classes = model.get("classes") || [];
  const stats = model.get("stats") || {};
  const locations = model.get("locations") || [];

  let disposed = false;
  const cleanups = [() => (disposed = true)];

  // — layout skeleton —
  const app = h("div", "fx-app");
  const header = h("header", "fx-header");
  const titleBlock = h("div", "fx-title-block");
  titleBlock.appendChild(h("div", "fx-kicker", meta.kicker || ""));
  titleBlock.appendChild(h("h1", "fx-title", meta.title || "Fire explorer"));
  if (meta.subtitle) titleBlock.appendChild(h("div", "fx-subtitle", meta.subtitle));
  header.appendChild(titleBlock);

  const badges = h("div", "fx-badges");
  if (meta.before_label) {
    const b = h("span", "fx-badge fx-badge--before");
    b.append(h("i", "fx-dot"), document.createTextNode(meta.before_label));
    badges.appendChild(b);
  }
  if (meta.after_label) {
    const b = h("span", "fx-badge fx-badge--after");
    b.append(h("i", "fx-dot"), document.createTextNode(meta.after_label));
    badges.appendChild(b);
  }
  header.appendChild(badges);
  app.appendChild(header);

  const body = h("div", "fx-body");
  const rail = h("aside", "fx-rail");
  const main = h("main", "fx-main");
  body.append(rail, main);
  app.appendChild(body);
  el.appendChild(app);

  // — stat tiles —
  const tiles = h("section", "fx-section fx-tiles");
  for (const tile of stats.tiles || []) {
    const cell = h("div", "fx-tile");
    const value = h("div", "fx-tile-value", tile.value);
    if (tile.color) value.style.color = tile.color;
    cell.appendChild(value);
    cell.appendChild(h("div", "fx-tile-label", tile.label));
    if (tile.sub) cell.appendChild(h("div", "fx-tile-sub", tile.sub));
    tiles.appendChild(cell);
  }
  rail.appendChild(tiles);

  // — damage chart (horizontal bars, direct labels, hover tooltip) —
  const chartSection = h("section", "fx-section");
  chartSection.appendChild(h("h2", "fx-section-title", "Damage assessment"));
  const chart = h("div", "fx-chart");
  const tip = h("div", "fx-tip");
  tip.style.display = "none";
  app.appendChild(tip);

  const maxCount = Math.max(1, ...classes.map((c) => asNumber(c.count)));
  const barRows = new Map(); // key -> {row, fill}
  for (const cls of classes) {
    const row = h("div", "fx-bar-row");
    row.dataset.key = cls.key;
    row.setAttribute("role", "button");
    row.tabIndex = 0;
    const label = h("div", "fx-bar-label", cls.label);
    const track = h("div", "fx-bar-track");
    const fill = h("div", "fx-bar-fill");
    fill.style.width = `${Math.max(1.5, (asNumber(cls.count) / maxCount) * 100)}%`;
    fill.style.background = cls.color || "#8a94a0";
    track.appendChild(fill);
    const count = h("div", "fx-bar-count", fmt(cls.count));
    row.append(label, track, count);
    chart.appendChild(row);
    barRows.set(cls.key, { row, fill });

    row.addEventListener("mousemove", (ev) => {
      const pctNote = cls.pct != null ? ` (${cls.pct}% of assessed)` : "";
      tip.textContent = `${cls.label}: ${fmt(cls.count)} buildings${pctNote}`;
      tip.style.display = "block";
      const rect = app.getBoundingClientRect();
      tip.style.left = `${Math.min(ev.clientX - rect.left + 14, rect.width - 240)}px`;
      tip.style.top = `${ev.clientY - rect.top + 14}px`;
    });
    row.addEventListener("mouseleave", () => {
      tip.style.display = "none";
    });
    row.addEventListener("click", () => toggleClass(cls.key));
    row.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter" || ev.key === " ") {
        ev.preventDefault();
        toggleClass(cls.key);
      }
    });
  }
  chartSection.appendChild(chart);
  rail.appendChild(chartSection);

  // — filter chips —
  const chipsSection = h("section", "fx-section");
  chipsSection.appendChild(h("h2", "fx-section-title", "Filter buildings on the map"));
  const chips = h("div", "fx-chips");
  const chipEls = new Map();
  for (const cls of classes) {
    const chip = h("button", "fx-chip", cls.label);
    chip.type = "button";
    const dot = h("i", "fx-dot");
    dot.style.background = cls.color || "#8a94a0";
    chip.prepend(dot);
    chip.addEventListener("click", () => toggleClass(cls.key));
    chips.appendChild(chip);
    chipEls.set(cls.key, chip);
  }
  const allBtn = h("button", "fx-chip fx-chip--all", "Show all");
  allBtn.type = "button";
  allBtn.addEventListener("click", () => setSelected(classes.map((c) => c.key)));
  chips.appendChild(allBtn);
  chipsSection.appendChild(chips);
  rail.appendChild(chipsSection);

  // — layer toggles —
  const layersSection = h("section", "fx-section");
  layersSection.appendChild(h("h2", "fx-section-title", "Layers"));
  const makeSwitch = (label, initial, onFlip) => {
    const wrap = h("label", "fx-switch");
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = initial;
    const slider = h("span", "fx-switch-track");
    slider.appendChild(h("span", "fx-switch-thumb"));
    wrap.append(input, slider, h("span", "fx-switch-label", label));
    input.addEventListener("change", () => onFlip(input.checked));
    layersSection.appendChild(wrap);
    return input;
  };
  rail.appendChild(layersSection);

  // — fly-to presets —
  let flySection = null;
  if (locations.length) {
    flySection = h("section", "fx-section");
    flySection.appendChild(h("h2", "fx-section-title", "Go to"));
    const flyRow = h("div", "fx-fly");
    for (const loc of locations) {
      const btn = h("button", "fx-fly-btn", loc.label || "Location");
      btn.type = "button";
      btn.addEventListener("click", () => flyTo(loc));
      flyRow.appendChild(btn);
    }
    flySection.appendChild(flyRow);
    rail.appendChild(flySection);
  }

  // — credits / license —
  const credits = h("footer", "fx-credits");
  for (const c of meta.credits || []) {
    const a = h("a", "fx-credit-link", c.label);
    a.href = c.url;
    a.target = "_blank";
    a.rel = "noopener";
    credits.appendChild(a);
  }
  if (meta.note) credits.appendChild(h("div", "fx-license", meta.note));
  if (meta.license) credits.appendChild(h("div", "fx-license", meta.license));
  rail.appendChild(credits);

  // — main map area —
  const noPrePill = h("div", "fx-map-label fx-map-label--nopre", "No pre-fire imagery in this area");
  noPrePill.style.display = "none";

  const mapMount = h("div", "fx-map-mount");
  // Inline styles: an embedded widget (e.g. MapCompare) overwrites el.className
  // during its render, which would drop any class-based sizing.
  mapMount.style.cssText = "position:absolute;inset:0;width:100%;height:100%;margin:0;";
  main.appendChild(mapMount);
  if (meta.before_label) main.appendChild(h("div", "fx-map-label fx-map-label--before", meta.before_label));
  main.appendChild(noPrePill);
  if (meta.after_label) main.appendChild(h("div", "fx-map-label fx-map-label--after", meta.after_label));
  if (meta.attribution) main.appendChild(h("div", "fx-attribution", meta.attribution));

  const compareRef = model.get("compare");
  if (compareRef) {
    cleanups.push(await renderChild(args, compareRef, mapMount));
  } else {
    mapMount.appendChild(h("div", "fx-empty", "No map configured"));
  }

  // The wrapper divs the host inserts between the MapCompare cells and the
  // lonboard maps have no intrinsic height, which collapses the WebGL canvases
  // to 0px. Stretch any zero-height ancestor of a canvas, then make deck.gl /
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
  let classLayerHs = []; // aligned with `classes`
  let perimeterH = null;
  let mapHs = [];
  try {
    const layerRefs = Array.isArray(model.get("class_layers")) ? model.get("class_layers") : [];
    const mapRefs = Array.isArray(model.get("maps")) ? model.get("maps") : [];
    [classLayerHs, perimeterH, mapHs] = await Promise.all([
      Promise.all(layerRefs.map((ref) => resolveModel(model, idOf(ref)))),
      model.get("perimeter_layer") ? resolveModel(model, idOf(model.get("perimeter_layer"))) : null,
      Promise.all(mapRefs.map((ref) => resolveModel(model, idOf(ref)))),
    ]);
  } catch (err) {
    console.warn("[fire-explorer] model resolution failed:", err);
  }

  function flyTo(loc) {
    const { label: _label, ...camera } = loc;
    const duration = asNumber(loc.transitionDuration, 3000);
    const msg = { type: "fly-to", transitionDuration: duration, ...camera };
    delete msg.label;
    muteSync(duration + 500); // both maps fly together; don't let the sync loop snap them
    for (const m of mapHs) m.sendCustom(msg);
    updateCoveragePill(camera);
  }

  // — selection state → layer filter + UI emphasis —
  const allKeys = classes.map((c) => c.key);
  const readSelected = () => {
    const sel = model.get("selected");
    return Array.isArray(sel) && sel.length ? sel.map(String) : allKeys.slice();
  };

  function setSelected(keys) {
    model.set("selected", keys);
    safeSaveChanges(model);
    refreshSelection();
  }

  function toggleClass(key) {
    const current = new Set(readSelected());
    if (current.has(key)) current.delete(key);
    else current.add(key);
    // never allow an empty selection to read as "everything hidden" by accident:
    setSelected(current.size ? [...current] : allKeys.slice());
  }

  let lastFilterKey = "";
  function applyFilter() {
    if (!classLayerHs.length) return;
    const sel = new Set(readSelected());
    const key = `${JSON.stringify([...sel].sort())}:${classLayerHs.map((h) => h.models.length).join(",")}`;
    if (key === lastFilterKey) return;
    lastFilterKey = key;
    classLayerHs.forEach((h, i) => {
      const cls = classes[i];
      if (!cls) return;
      h.set("visible", sel.has(cls.key));
      h.save();
    });
  }

  function refreshSelection() {
    const sel = new Set(readSelected());
    const allActive = sel.size === allKeys.length;
    for (const [key, chip] of chipEls) chip.classList.toggle("fx-chip--active", sel.has(key));
    for (const [key, { row }] of barRows) row.classList.toggle("fx-bar-row--dim", !sel.has(key) && !allActive);
    applyFilter();
  }

  const onSelectedChange = () => refreshSelection();
  model.on("change:selected", onSelectedChange);
  cleanups.push(() => model.off?.("change:selected", onSelectedChange));

  // — layer toggles wiring —
  makeSwitch("3D buildings", false, (on) => {
    for (const h of classLayerHs) {
      h.set("extruded", on);
      h.save();
    }
    muteSync(1700);
    for (const m of mapHs) {
      m.sendCustom({ type: "fly-to", transitionDuration: 1200, pitch: on ? 55 : 0, ...cameraCenter() });
    }
  });
  makeSwitch("Fire perimeter", true, (on) => {
    if (perimeterH) {
      perimeterH.set("visible", on);
      perimeterH.save();
    }
  });

  function cameraCenter() {
    const vs = mapHs.length ? mapHs[0].get("view_state") : null;
    if (vs && typeof vs === "object") {
      const { longitude, latitude, zoom, bearing } = vs;
      return { longitude, latitude, zoom, bearing };
    }
    return {};
  }

  // — camera sync between the two maps —
  // MapCompare mirrors the `view_state` TRAIT, but in static export the deck
  // camera does not reliably follow external trait writes; it does follow
  // "fly-to" custom messages (the mechanism lonboard handles imperatively).
  // So: watch each map's view_state (lonboard writes it as you pan) and drive
  // the other map with a zero-duration fly-to.
  const CAM_KEYS = ["longitude", "latitude", "zoom", "pitch", "bearing"];
  const CAM_EPS = { longitude: 1e-7, latitude: 1e-7, zoom: 1e-4, pitch: 1e-3, bearing: 1e-3 };
  const camEq = (a, b) =>
    a && b && CAM_KEYS.every((k) => Math.abs((+a[k] || 0) - (+b[k] || 0)) <= CAM_EPS[k]);
  const lastCam = [];
  const muteUntil = [];

  function muteSync(ms) {
    const until = Date.now() + ms;
    for (let i = 0; i < mapHs.length; i++) muteUntil[i] = until;
  }

  function syncCameras() {
    if (mapHs.length < 2) return;
    const now = Date.now();
    for (let i = 0; i < mapHs.length; i++) {
      const v = mapHs[i].get("view_state");
      if (!v || typeof v !== "object" || !("longitude" in v)) continue;
      if (now < (muteUntil[i] || 0)) {
        lastCam[i] = v; // absorb the echo caused by our own fly-to
        continue;
      }
      if (lastCam[i] && !camEq(v, lastCam[i])) {
        const cam = {};
        for (const k of CAM_KEYS) if (v[k] != null) cam[k] = v[k];
        for (let j = 0; j < mapHs.length; j++) {
          if (j === i) continue;
          // NOTE: don't skip based on map j's view_state trait — MapCompare's
          // trait-level mirror updates it without moving the deck camera, so
          // the trait is not evidence the camera is actually there.
          if (lastCam[j] && camEq(v, lastCam[j])) continue; // we already drove it here
          mapHs[j].sendCustom({ type: "fly-to", transitionDuration: 0, ...cam });
          muteUntil[j] = now + 250;
          lastCam[j] = v;
        }
        updateCoveragePill(v);
      }
      lastCam[i] = v;
    }
  }

  // — "no pre-fire imagery" hint on the before side —
  const preBounds = Array.isArray(meta.pre_bounds) && meta.pre_bounds.length === 4 ? meta.pre_bounds : null;
  function updateCoveragePill(v) {
    if (!preBounds || !v) return;
    const inside =
      v.longitude >= preBounds[0] && v.longitude <= preBounds[2] &&
      v.latitude >= preBounds[1] && v.latitude <= preBounds[3];
    noPrePill.style.display = inside ? "none" : "";
  }

  // — initial paint + self-healing poll (late proxies, filters, camera sync) —
  refreshSelection();
  const initialCam = mapHs.length ? mapHs[0].get("view_state") : null;
  if (initialCam && typeof initialCam === "object") updateCoveragePill(initialCam);
  const stopAt = Date.now() + MAX_RUN_MS;
  const loop = () => {
    if (disposed) return;
    try {
      applyFilter();
      syncCameras();
    } catch (err) {
      console.warn("[fire-explorer] tick error", err);
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
