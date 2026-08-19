// CityExplorer — "The Good Life Index" custom fullscreen web-app shell.
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
  throw new Error(`[city-explorer] cannot resolve model "${id}"`);
}

async function renderChild(args, ref, el) {
  if (args.host && typeof args.host.renderChild === "function") {
    const dispose = await args.host.renderChild(ref, el);
    return typeof dispose === "function" ? dispose : () => {};
  }
  const wm = args.model.widget_manager;
  if (!wm || typeof wm.create_view !== "function") {
    throw new Error("[city-explorer] renderChild needs a static host or widget_manager");
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

// ── web-mercator math (pitch≈0; inspect mode flattens the camera first) ─────

const TILE = 512;

function lngLatToWorld(lng, lat) {
  const x = ((lng + 180) / 360) * TILE;
  const s = Math.sin((lat * Math.PI) / 180);
  const y = (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * TILE;
  return [x, y];
}

function worldToLngLat(x, y) {
  const lng = (x / TILE) * 360 - 180;
  const n = Math.PI - (2 * Math.PI * y) / TILE;
  const lat = (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
  return [lng, lat];
}

function projectToScreen(vs, lng, lat, w, h) {
  const scale = Math.pow(2, asNumber(vs.zoom));
  const [cx, cy] = lngLatToWorld(asNumber(vs.longitude), asNumber(vs.latitude));
  const [px, py] = lngLatToWorld(lng, lat);
  const dx = (px - cx) * scale;
  const dy = (py - cy) * scale;
  const b = (-asNumber(vs.bearing) * Math.PI) / 180;
  return [
    w / 2 + dx * Math.cos(b) - dy * Math.sin(b),
    h / 2 + dx * Math.sin(b) + dy * Math.cos(b),
  ];
}

function unprojectFromScreen(vs, sx, sy, w, h) {
  const scale = Math.pow(2, asNumber(vs.zoom));
  const dx = sx - w / 2;
  const dy = sy - h / 2;
  const b = (asNumber(vs.bearing) * Math.PI) / 180;
  const rx = dx * Math.cos(b) - dy * Math.sin(b);
  const ry = dx * Math.sin(b) + dy * Math.cos(b);
  const [cx, cy] = lngLatToWorld(asNumber(vs.longitude), asNumber(vs.latitude));
  return worldToLngLat(cx + rx / scale, cy + ry / scale);
}

// ── tiny DOM helpers ────────────────────────────────────────────────────────

function h(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text != null) node.textContent = text;
  return node;
}

function svgEl(tag) {
  return document.createElementNS("http://www.w3.org/2000/svg", tag);
}

const fmt = (n) => asNumber(n).toLocaleString("en-US");

function ratingFor(cat, minutes) {
  for (const [max, label] of cat.ratings || []) {
    if (minutes <= max) return label;
  }
  return (cat.ratings || []).length ? cat.ratings[cat.ratings.length - 1][1] : "";
}

// ── teaser card (inline child of Fullscreen) ────────────────────────────────

function renderTeaser(model, el) {
  const meta = model.get("meta") || {};
  const card = h("div", "ce-teaser");
  card.appendChild(h("div", "ce-kicker", meta.kicker || "Fullscreen demo"));
  card.appendChild(h("div", "ce-teaser-title", meta.title || "The Good Life Index"));
  if (meta.subtitle) card.appendChild(h("div", "ce-teaser-sub", meta.subtitle));

  const row = h("div", "ce-teaser-stats");
  for (const tile of meta.teaser_tiles || []) {
    const cell = h("div", "ce-teaser-stat");
    cell.appendChild(h("div", "ce-teaser-stat-value", tile.value));
    cell.appendChild(h("div", "ce-teaser-stat-label", tile.label));
    row.appendChild(cell);
  }
  card.appendChild(row);
  card.appendChild(h("div", "ce-teaser-hint", "⛶  Expand to go apartment hunting"));
  el.appendChild(card);
}

// ── the app shell ───────────────────────────────────────────────────────────

async function render(args) {
  const { model, el } = args;
  el.classList.add("city-explorer");

  if (model.get("mode") === "teaser") {
    renderTeaser(model, el);
    return () => {};
  }

  const meta = model.get("meta") || {};
  const cities = model.get("cities") || [];
  const categories = model.get("categories") || [];
  const personas = model.get("personas") || [];
  const hexIndex = model.get("hex_index") || {};
  const amenityPoints = model.get("amenity_points") || {};
  const personaLayerKeys = model.get("persona_layer_keys") || [];
  const sliderCats = categories.filter((c) => c.slider);

  let disposed = false;
  const cleanups = [() => (disposed = true)];

  // — state (mirrored to traits for deep-link restore) —
  let activeCity = String(model.get("city") || (cities[0] && cities[0].key) || "");
  let activePersona = String(model.get("persona") || "");
  const filters = {};
  const savedFilters = model.get("filters") || {};
  for (const c of sliderCats) filters[c.key] = asNumber(savedFilters[c.key], c.default);
  let amenityDotsOn = false;
  let threeDOn = true;

  const cityByKey = (key) => cities.find((c) => c.key === key) || cities[0];

  // — layout skeleton —
  const app = h("div", "ce-app");
  const header = h("header", "ce-header");
  const titleBlock = h("div", "ce-title-block");
  titleBlock.appendChild(h("div", "ce-kicker", meta.kicker || ""));
  titleBlock.appendChild(h("h1", "ce-title", meta.title || "The Good Life Index"));
  if (meta.subtitle) titleBlock.appendChild(h("div", "ce-subtitle", meta.subtitle));
  header.appendChild(titleBlock);

  const citySwitch = h("div", "ce-city-switch");
  const cityBtns = new Map();
  for (const c of cities) {
    const btn = h("button", "ce-city-btn", `${c.emoji || ""} ${c.label}`.trim());
    btn.type = "button";
    btn.addEventListener("click", () => setCity(c.key));
    citySwitch.appendChild(btn);
    cityBtns.set(c.key, btn);
  }
  header.appendChild(citySwitch);
  app.appendChild(header);

  const body = h("div", "ce-body");
  const rail = h("aside", "ce-rail");
  const main = h("main", "ce-main");
  body.append(rail, main);
  app.appendChild(body);
  el.appendChild(app);

  // — stat tiles (per active city) —
  const tilesSection = h("section", "ce-section");
  const tiles = h("div", "ce-tiles");
  tilesSection.appendChild(tiles);
  rail.appendChild(tilesSection);

  function renderTiles() {
    tiles.textContent = "";
    const c = cityByKey(activeCity);
    for (const tile of (c && c.stats && c.stats.tiles) || []) {
      const cell = h("div", "ce-tile");
      cell.appendChild(h("div", "ce-tile-value", tile.value));
      cell.appendChild(h("div", "ce-tile-label", tile.label));
      if (tile.sub) cell.appendChild(h("div", "ce-tile-sub", tile.sub));
      tiles.appendChild(cell);
    }
  }

  // — head-to-head strip —
  const versusSection = h("section", "ce-section");
  versusSection.appendChild(h("h2", "ce-section-title", "Head to head"));
  const versus = h("div", "ce-versus");
  versusSection.appendChild(versus);
  rail.appendChild(versusSection);

  function renderVersus() {
    versus.textContent = "";
    const c = cityByKey(activeCity);
    for (const row of (c && c.stats && c.stats.versus) || []) {
      const line = h("div", "ce-versus-row");
      line.appendChild(h("span", null, row.label));
      const b = h("b", null, row.value);
      line.appendChild(b);
      versus.appendChild(line);
    }
  }

  // — mode tabs: apartment hunt / personas —
  const tabs = h("div", "ce-tabs");
  const huntTab = h("button", "ce-tab", "🔍 Apartment hunt");
  huntTab.type = "button";
  const personaTab = h("button", "ce-tab", "🎭 Personas");
  personaTab.type = "button";
  tabs.append(huntTab, personaTab);
  rail.appendChild(tabs);

  // — hunt panel: sliders —
  const huntSection = h("section", "ce-section");
  huntSection.appendChild(h("h2", "ce-section-title", "Max walk to…"));
  huntSection.appendChild(
    h("div", "ce-section-note", "Drag until only the places worth living in remain."),
  );
  const sliderVals = new Map();
  for (const cat of sliderCats) {
    const row = h("div", "ce-slider-row");
    const head = h("div", "ce-slider-head");
    head.appendChild(h("span", null, `${cat.emoji || ""} ${cat.label}`.trim()));
    const val = h("span", "ce-slider-val");
    head.appendChild(val);
    row.appendChild(head);
    const input = document.createElement("input");
    input.type = "range";
    input.className = "ce-slider";
    input.min = "1";
    input.max = String(cat.max || 30);
    input.step = "1";
    input.value = String(filters[cat.key]);
    input.addEventListener("input", () => {
      filters[cat.key] = asNumber(input.value, cat.default);
      sliderVals.get(cat.key).textContent = labelFor(cat);
      scheduleFilters();
    });
    row.appendChild(input);
    huntSection.appendChild(row);
    sliderVals.set(cat.key, val);
  }
  const labelFor = (cat) =>
    filters[cat.key] >= (cat.max || 30) ? "don't care" : `≤ ${filters[cat.key]} min`;
  for (const cat of sliderCats) sliderVals.get(cat.key).textContent = labelFor(cat);

  const qualify = h("div", "ce-qualify");
  huntSection.appendChild(qualify);
  rail.appendChild(huntSection);

  function renderQualify() {
    const idx = hexIndex[activeCity];
    if (!idx || !idx.mins) {
      qualify.textContent = "";
      return;
    }
    const catPos = sliderCats.map((c) => categories.findIndex((k) => k.key === c.key));
    let ok = 0;
    for (const row of idx.mins) {
      let pass = true;
      for (let s = 0; s < sliderCats.length; s++) {
        if (row[catPos[s]] > filters[sliderCats[s].key]) {
          pass = false;
          break;
        }
      }
      if (pass) ok++;
    }
    const pct = idx.mins.length ? Math.round((ok / idx.mins.length) * 100) : 0;
    const c = cityByKey(activeCity);
    qualify.innerHTML = "";
    const strong = h("b", null, `${pct}%`);
    qualify.append(strong, document.createTextNode(` of ${c ? c.label : "the city"} still qualifies`));
    if (pct === 0) qualify.append(document.createTextNode(" — nobody is that fussy 🙃"));
  }

  // — personas panel —
  const personaSection = h("section", "ce-section");
  personaSection.style.display = "none";
  personaSection.appendChild(h("h2", "ce-section-title", "Who are you today?"));
  const personaWrap = h("div", "ce-personas");
  const personaCards = new Map();
  for (const p of personas) {
    const card = h("button", "ce-persona");
    card.type = "button";
    card.appendChild(h("div", "ce-persona-emoji", p.emoji || "🙂"));
    const txt = h("div", "ce-persona-text");
    txt.appendChild(h("div", "ce-persona-label", p.label));
    if (p.blurb) txt.appendChild(h("div", "ce-persona-blurb", p.blurb));
    card.appendChild(txt);
    card.addEventListener("click", () => setPersona(activePersona === p.key ? "" : p.key));
    personaWrap.appendChild(card);
    personaCards.set(p.key, card);
  }
  personaSection.appendChild(personaWrap);
  const legend = h("div", "ce-legend");
  legend.appendChild(h("div", null, "Weighted walk score"));
  legend.appendChild(h("div", "ce-legend-bar"));
  const legendEnds = h("div", "ce-legend-ends");
  legendEnds.append(h("span", null, "the good life"), h("span", null, "the long walk"));
  legend.appendChild(legendEnds);
  legend.style.display = "none";
  personaSection.appendChild(legend);
  rail.appendChild(personaSection);

  // — layers + view section —
  const layersSection = h("section", "ce-section");
  layersSection.appendChild(h("h2", "ce-section-title", "View"));
  const makeSwitch = (label, initial, onFlip) => {
    const wrap = h("label", "ce-switch");
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = initial;
    const slider = h("span", "ce-switch-track");
    slider.appendChild(h("span", "ce-switch-thumb"));
    wrap.append(input, slider, h("span", "ce-switch-label", label));
    input.addEventListener("change", () => onFlip(input.checked));
    layersSection.appendChild(wrap);
    return input;
  };
  rail.appendChild(layersSection);

  // — go-to (neighborhood fly-tos per city) —
  const flySection = h("section", "ce-section");
  flySection.appendChild(h("h2", "ce-section-title", "Go to"));
  const flyRow = h("div", "ce-fly");
  flySection.appendChild(flyRow);
  rail.appendChild(flySection);

  function renderFlyButtons() {
    flyRow.textContent = "";
    const c = cityByKey(activeCity);
    for (const loc of (c && c.neighborhoods) || []) {
      const btn = h("button", "ce-fly-btn", loc.label || "Somewhere nice");
      btn.type = "button";
      btn.addEventListener("click", () => flyTo({ ...loc, pitch: threeDOn ? (loc.pitch ?? 55) : 0 }));
      flyRow.appendChild(btn);
    }
  }

  // — credits / license —
  const credits = h("footer", "ce-credits");
  for (const c of meta.credits || []) {
    const a = h("a", "ce-credit-link", c.label);
    a.href = c.url;
    a.target = "_blank";
    a.rel = "noopener";
    credits.appendChild(a);
  }
  if (meta.note) credits.appendChild(h("div", "ce-license", meta.note));
  if (meta.license) credits.appendChild(h("div", "ce-license", meta.license));
  rail.appendChild(credits);

  // — main map area —
  const mapMount = h("div", "ce-map-mount");
  // Inline styles: the embedded widget overwrites el.className during render.
  mapMount.style.cssText = "position:absolute;inset:0;width:100%;height:100%;margin:0;";
  main.appendChild(mapMount);

  const spider = svgEl("svg");
  spider.setAttribute("class", "ce-spider");
  main.appendChild(spider);

  const capture = h("div", "ce-capture");
  capture.style.display = "none";
  main.appendChild(capture);

  const inspectBtn = h("button", "ce-inspect-btn", "📍 Inspect");
  inspectBtn.type = "button";
  main.appendChild(inspectBtn);
  const inspectHint = h("div", "ce-inspect-hint", "Click anywhere: how good is life there?");
  inspectHint.style.display = "none";
  main.appendChild(inspectHint);

  const inspector = h("div", "ce-inspector");
  inspector.style.display = "none";
  main.appendChild(inspector);

  if (meta.attribution) main.appendChild(h("div", "ce-attribution", meta.attribution));

  const mapRef = model.get("map");
  if (mapRef) {
    cleanups.push(await renderChild(args, mapRef, mapMount));
  } else {
    mapMount.appendChild(h("div", "ce-empty", "No map configured"));
  }

  // Wrapper divs between the widget cell and the lonboard map have no height,
  // collapsing the WebGL canvas to 0px. Stretch and re-measure a few times.
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

  // — resolve driven models (lists aligned with `cities`) —
  let mapH = null;
  let buildingHs = [];
  let huntHs = [];
  let personaHs = [];
  let amenityHs = [];
  try {
    const resolveList = (trait) => {
      const refs = Array.isArray(model.get(trait)) ? model.get(trait) : [];
      return Promise.all(refs.map((ref) => resolveModel(model, idOf(ref))));
    };
    [mapH, buildingHs, huntHs, personaHs, amenityHs] = await Promise.all([
      mapRef ? resolveModel(model, idOf(mapRef)) : null,
      resolveList("building_layers"),
      resolveList("hunt_layers"),
      resolveList("persona_layers"),
      resolveList("amenity_layers"),
    ]);
  } catch (err) {
    console.warn("[city-explorer] model resolution failed:", err);
  }

  function flyTo(loc) {
    if (!mapH) return;
    const msg = {
      type: "fly-to",
      transitionDuration: asNumber(loc.transitionDuration, 2200),
      longitude: loc.longitude,
      latitude: loc.latitude,
      zoom: loc.zoom,
      pitch: loc.pitch ?? 0,
      bearing: loc.bearing ?? 0,
    };
    mapH.sendCustom(msg);
  }

  function cameraNow() {
    const vs = mapH ? mapH.get("view_state") : null;
    return vs && typeof vs === "object" && "longitude" in vs ? vs : null;
  }

  // — layer visibility (single source of truth, self-healing via poll) —
  let lastVisKey = "";
  function applyVisibility() {
    if (!cities.length) return;
    const proxies =
      buildingHs.map((x) => x.models.length).join(",") +
      "|" + huntHs.map((x) => x.models.length).join(",") +
      "|" + personaHs.map((x) => x.models.length).join(",") +
      "|" + amenityHs.map((x) => x.models.length).join(",");
    const key = `${activeCity}:${activePersona}:${amenityDotsOn}:${proxies}`;
    if (key === lastVisKey) return;
    lastVisKey = key;
    cities.forEach((c, i) => {
      const isActive = c.key === activeCity;
      if (buildingHs[i]) {
        buildingHs[i].set("visible", isActive);
        buildingHs[i].save();
      }
      if (huntHs[i]) {
        huntHs[i].set("visible", isActive && !activePersona);
        huntHs[i].save();
      }
      if (amenityHs[i]) {
        amenityHs[i].set("visible", isActive && amenityDotsOn);
        amenityHs[i].save();
      }
    });
    personaLayerKeys.forEach((pk, i) => {
      const on = pk === `${activePersona}:${activeCity}`;
      if (personaHs[i]) {
        personaHs[i].set("visible", on);
        personaHs[i].save();
      }
    });
  }

  // — GPU filters (rAF-throttled writes to every hunt layer) —
  let filterDirty = true;
  let filterScheduled = false;
  function scheduleFilters() {
    filterDirty = true;
    model.set("filters", { ...filters });
    safeSaveChanges(model);
    renderQualify();
    if (filterScheduled) return;
    filterScheduled = true;
    requestAnimationFrame(() => {
      filterScheduled = false;
      applyFilters();
    });
  }

  let lastFilterKey = "";
  function applyFilters() {
    const ranges = sliderCats.map((c) => [0, filters[c.key]]);
    const key = JSON.stringify(ranges) + "|" + huntHs.map((x) => x.models.length).join(",");
    if (key === lastFilterKey) return;
    lastFilterKey = key;
    filterDirty = false;
    for (const hh of huntHs) {
      hh.set("filter_range", ranges);
      hh.save();
    }
  }

  // — tabs / persona selection —
  function setPersona(key) {
    activePersona = key || "";
    model.set("persona", activePersona);
    safeSaveChanges(model);
    const onPersonas = !!activePersona;
    huntTab.classList.toggle("ce-tab--active", !onPersonas);
    personaTab.classList.toggle("ce-tab--active", !onPersonas ? false : true);
    for (const [k, card] of personaCards)
      card.classList.toggle("ce-persona--active", k === activePersona);
    legend.style.display = activePersona ? "" : "none";
    applyVisibility();
  }

  huntTab.addEventListener("click", () => {
    huntSection.style.display = "";
    personaSection.style.display = "none";
    huntTab.classList.add("ce-tab--active");
    personaTab.classList.remove("ce-tab--active");
    setPersona("");
  });
  personaTab.addEventListener("click", () => {
    huntSection.style.display = "none";
    personaSection.style.display = "";
    huntTab.classList.remove("ce-tab--active");
    personaTab.classList.add("ce-tab--active");
    if (!activePersona && personas.length) setPersona(personas[0].key);
  });

  // — city switching —
  function setCity(key) {
    if (key === activeCity) return;
    activeCity = key;
    model.set("city", key);
    safeSaveChanges(model);
    for (const [k, btn] of cityBtns)
      btn.classList.toggle("ce-city-btn--active", k === activeCity);
    clearInspection();
    renderTiles();
    renderVersus();
    renderFlyButtons();
    renderQualify();
    applyVisibility();
    const c = cityByKey(key);
    if (c && c.camera) flyTo({ ...c.camera, pitch: threeDOn ? (c.camera.pitch ?? 50) : 0, transitionDuration: 4000 });
  }

  // — view switches —
  makeSwitch("3D buildings", threeDOn, (on) => {
    threeDOn = on;
    for (const bh of buildingHs) {
      bh.set("extruded", on);
      bh.save();
    }
    const cam = cameraNow();
    if (cam) {
      flyTo({
        longitude: cam.longitude,
        latitude: cam.latitude,
        zoom: cam.zoom,
        bearing: cam.bearing,
        pitch: on ? 55 : 0,
        transitionDuration: 1200,
      });
    }
  });
  makeSwitch("Amenity dots", false, (on) => {
    amenityDotsOn = on;
    applyVisibility();
  });

  // — inspector —
  let inspectOn = false;
  let inspection = null; // {lng, lat, targets: [{lon, lat, color}]}

  inspectBtn.addEventListener("click", () => {
    inspectOn = !inspectOn;
    inspectBtn.classList.toggle("ce-inspect-btn--active", inspectOn);
    capture.style.display = inspectOn ? "" : "none";
    inspectHint.style.display = inspectOn && !inspection ? "" : "none";
    if (inspectOn) {
      // Flatten the camera: the screen→lngLat math assumes pitch 0.
      const cam = cameraNow();
      if (cam && Math.abs(asNumber(cam.pitch)) > 1) {
        flyTo({
          longitude: cam.longitude,
          latitude: cam.latitude,
          zoom: cam.zoom,
          bearing: cam.bearing,
          pitch: 0,
          transitionDuration: 700,
        });
      }
    } else {
      clearInspection();
    }
  });

  function clearInspection() {
    inspection = null;
    inspector.style.display = "none";
    spider.textContent = "";
    inspectHint.style.display = inspectOn ? "" : "none";
  }

  function nearestHex(lng, lat) {
    const idx = hexIndex[activeCity];
    if (!idx || !idx.lon || !idx.lon.length) return -1;
    const latScale = Math.cos((lat * Math.PI) / 180);
    let best = -1;
    let bestD = Infinity;
    for (let i = 0; i < idx.lon.length; i++) {
      const dx = (idx.lon[i] - lng) * latScale;
      const dy = idx.lat[i] - lat;
      const d = dx * dx + dy * dy;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    // Reject clicks far outside the grid (res-10 hexes are ~66 m wide;
    // ~150 m in degrees ≈ 0.0014).
    return Math.sqrt(bestD) > 0.002 ? -1 : best;
  }

  capture.addEventListener("click", (ev) => {
    const cam = cameraNow();
    if (!cam) return;
    const rect = capture.getBoundingClientRect();
    const [lng, lat] = unprojectFromScreen(
      cam,
      ev.clientX - rect.left,
      ev.clientY - rect.top,
      rect.width,
      rect.height,
    );
    inspect(lng, lat);
  });

  function inspect(lng, lat) {
    const hexI = nearestHex(lng, lat);
    inspectHint.style.display = "none";
    inspector.style.display = "";
    inspector.textContent = "";
    const close = h("button", "ce-inspector-close", "✕");
    close.type = "button";
    close.addEventListener("click", clearInspection);
    inspector.appendChild(close);
    inspector.appendChild(h("div", "ce-inspector-title", "Life at this spot"));

    if (hexI < 0) {
      inspector.appendChild(
        h("div", "ce-inspector-sub", "Outside the surveyed core — here be dragons 🐉"),
      );
      inspection = { lng, lat, targets: [] };
      redrawSpider();
      return;
    }

    const idx = hexIndex[activeCity];
    const mins = idx.mins[hexI];
    const idxs = idx.idxs[hexI];
    inspector.appendChild(h("div", "ce-inspector-sub", "Walking minutes to your essentials"));

    const targets = [];
    let total = 0;
    let counted = 0;
    categories.forEach((cat, ci) => {
      const m = mins[ci];
      const ai = idxs[ci];
      const pts = (amenityPoints[activeCity] || {})[cat.key] || [];
      const target = ai >= 0 && ai < pts.length ? pts[ai] : null;
      const row = h("div", "ce-essential");
      row.appendChild(h("div", "ce-essential-emoji", cat.emoji || "•"));
      const mid = h("div", null);
      const name = target && target[2] ? target[2] : cat.label;
      mid.appendChild(h("div", "ce-essential-name", name));
      mid.appendChild(h("div", "ce-essential-rating", ratingFor(cat, m)));
      row.appendChild(mid);
      row.appendChild(
        h("div", "ce-essential-min", m >= (cat.max || 30) ? `${cat.max || 30}+ min` : `${Math.round(m)} min`),
      );
      inspector.appendChild(row);
      total += Math.min(m, 30);
      counted++;
      if (target) targets.push({ lon: target[0], lat: target[1], color: cat.color || "#ffb454" });
    });

    const avg = counted ? total / counted : 30;
    let verdict = "";
    for (const [max, text] of meta.verdicts || []) {
      if (avg <= max) {
        verdict = text;
        break;
      }
    }
    if (verdict) inspector.appendChild(h("div", "ce-inspector-verdict", verdict));

    inspection = { lng, lat, targets };
    redrawSpider();
  }

  // — spider lines (SVG overlay, re-projected on camera change) —
  let lastSpiderCam = "";
  function redrawSpider() {
    if (!inspection) {
      spider.textContent = "";
      lastSpiderCam = "";
      return;
    }
    const cam = cameraNow();
    if (!cam) return;
    const rect = main.getBoundingClientRect();
    spider.setAttribute("viewBox", `0 0 ${rect.width} ${rect.height}`);
    spider.textContent = "";
    const [ox, oy] = projectToScreen(cam, inspection.lng, inspection.lat, rect.width, rect.height);
    for (const t of inspection.targets) {
      const [tx, ty] = projectToScreen(cam, t.lon, t.lat, rect.width, rect.height);
      const line = svgEl("line");
      line.setAttribute("x1", ox);
      line.setAttribute("y1", oy);
      line.setAttribute("x2", tx);
      line.setAttribute("y2", ty);
      line.setAttribute("stroke", t.color);
      line.setAttribute("stroke-width", "1.6");
      line.setAttribute("stroke-dasharray", "5 4");
      line.setAttribute("opacity", "0.85");
      spider.appendChild(line);
      const dot = svgEl("circle");
      dot.setAttribute("cx", tx);
      dot.setAttribute("cy", ty);
      dot.setAttribute("r", "4.5");
      dot.setAttribute("fill", t.color);
      dot.setAttribute("stroke", "#0f1216");
      dot.setAttribute("stroke-width", "1.5");
      spider.appendChild(dot);
    }
    const origin = svgEl("circle");
    origin.setAttribute("cx", ox);
    origin.setAttribute("cy", oy);
    origin.setAttribute("r", "6");
    origin.setAttribute("fill", "#ffffff");
    origin.setAttribute("stroke", "#14171c");
    origin.setAttribute("stroke-width", "2");
    spider.appendChild(origin);
  }

  function spiderTick() {
    if (!inspection) return;
    const cam = cameraNow();
    if (!cam) return;
    const key = ["longitude", "latitude", "zoom", "pitch", "bearing"]
      .map((k) => asNumber(cam[k]).toFixed(6))
      .join(",");
    if (key !== lastSpiderCam) {
      lastSpiderCam = key;
      redrawSpider();
    }
  }

  // — initial paint —
  for (const [k, btn] of cityBtns)
    btn.classList.toggle("ce-city-btn--active", k === activeCity);
  huntTab.classList.add("ce-tab--active");
  renderTiles();
  renderVersus();
  renderFlyButtons();
  renderQualify();
  applyVisibility();
  applyFilters();
  if (activePersona) {
    huntSection.style.display = "none";
    personaSection.style.display = "";
    huntTab.classList.remove("ce-tab--active");
    personaTab.classList.add("ce-tab--active");
    setPersona(activePersona);
  }

  // — self-healing poll (late-resolving proxies, filters, spider tracking) —
  const stopAt = Date.now() + MAX_RUN_MS;
  const loop = () => {
    if (disposed) return;
    try {
      applyVisibility();
      applyFilters();
      spiderTick();
    } catch (err) {
      console.warn("[city-explorer] tick error", err);
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
