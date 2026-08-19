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
- **[Global Disaster Situation Room](notebooks/situation-room.ipynb)** — a second
  custom-ESM `Fullscreen` app: 90 days of GDACS events from the IFRC Montandon
  STAC API in a mission-control UI — event log with impact details, hazard-type
  filters, weekly pulse chart, hazard footprints and NASA night lights, camera
  fly-tos — all kernel-free.
- **[The Good Life Index](notebooks/city-explorer.ipynb)** — a third custom-ESM
  `Fullscreen` app, and the playful one: Amsterdam vs New York, 22k extruded
  Overture buildings in 3D, and every ~66 m hexagon scored by *network* walking
  minutes to coffee, toilets, parks, groceries, pubs and transit. Apartment-hunt
  sliders drive a GPU filter live; a click-anywhere inspector draws spider lines
  to your nearest essentials — all kernel-free.

New to the project? Start with **Welcome**, then crib from **Dashboard**. To make
your own: `just new "my idea"`.
