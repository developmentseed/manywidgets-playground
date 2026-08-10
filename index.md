---
title: manywidgets playground
---

# manywidgets playground

Author [manywidgets](https://developmentseed.org/manywidgets) notebooks in
Jupyter and publish them as a **static, kernel-free interactive site**.

**Add your own:** drop an `.ipynb` into `notebooks/` → `just execute` →
`just preview` (<http://localhost:9876>) → open a PR to publish. Full guide in the
[README](https://github.com/developmentseed/manywidgets-playground#readme).

## Gallery

- **[Welcome](notebooks/welcome.ipynb)** — the minimal tour: import manywidgets
  and render a single `Chart`.
- **[Dashboard](notebooks/dashboard.ipynb)** — linked controls (`Slider`,
  `Dropdown`, `Toggle`) driving a `Chart` and a `Stat` row via `jsdlink` —
  kernel-free links that survive static export.
- **[Lonboard map](notebooks/lonboard-map.ipynb)** — a lonboard `Map` with a
  `LayerToggle`, a `RangeSlider` + `FilterBinder`, and a `MapFlyer` for
  geospatial DX.
- **[Anatomy of a Firestorm](notebooks/la-fires.ipynb)** — the flagship
  `Fullscreen` demo: a fully custom ESM web app (Palisades Fire damage explorer)
  with a Maxar before/after imagery swipe, 30k damage-classed Overture buildings,
  GPU filtering, 3D extrusion and linked charts — all kernel-free.

New to the project? Start with **Welcome**, then crib from **Dashboard**. To make
your own: `just new "my idea"`.
