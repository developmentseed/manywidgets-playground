---
title: manywidgets playground
---

# manywidgets playground

Author [manywidgets](https://developmentseed.org/manywidgets) notebooks in
Jupyter and publish them as a **static, kernel-free interactive site**.

**Add your own:** drop an `.ipynb` into `notebooks/` → `just execute` →
`just preview` (<http://localhost:9876>) → open a PR to publish.

## Gallery

- **[Welcome](notebooks/welcome.ipynb)** — the minimal tour: import manywidgets
  and render a single `Chart`.
- **[Dashboard](notebooks/dashboard.ipynb)** — linked controls (`Slider`,
  `Dropdown`, `Toggle`) driving a `Chart` and a `Stat` row via `jsdlink` —
  kernel-free links that survive static export.
- **[Lonboard map](notebooks/lonboard-map.ipynb)** — a lonboard `Map` with a
  `LayerToggle`, a `RangeSlider` + `FilterBinder`, and a `MapFlyer` for
  geospatial DX.

New to the project? Start with **Welcome**, then crib from **Dashboard**. To make
your own: `just new "my idea"`.
