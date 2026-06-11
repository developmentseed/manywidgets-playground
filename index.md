---
title: manywidgets playground
---

# manywidgets playground

A friction-free place to explore [manywidgets](https://github.com/developmentseed/manywidgets)
patterns in Jupyter notebooks and publish them as a **static, kernel-free
interactive site**. Drag a slider, toggle a layer, fly a map — all with no kernel
running, thanks to the [`myst-anywidget-static-export`](https://github.com/developmentseed/myst-anywidget-static-export)
plugin.

Clone the repo, run `just lab` to play locally, author your own notebooks in
`notebooks/`, then push to `main` and GitHub Pages serves them.

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
