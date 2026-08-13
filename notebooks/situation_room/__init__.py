"""SituationRoom — a custom mission-control web-app shell for the
"Global Disaster Situation Room" demo.

Like ``fire_explorer.FireExplorer``, this is a bespoke anywidget: its ESM
module (``app.js``) is a complete little web application (header, stats rail,
weekly-pulse chart, hazard filters, scrollable event list with per-event impact
details, camera fly-tos) that embeds a live lonboard ``Map`` through the same
``renderChild`` mechanism the built-in layout widgets use. It is designed to be
placed in ``manywidgets.Fullscreen(fullscreen=...)`` so the fullscreen overlay
becomes the situation room, driven entirely from the notebook and fully
functional in the kernel-free static export.

All interactivity is client-side: the shell resolves the lonboard layer/map
models through the static-export registry (vendored ``@manywidgets/core``
helpers inside ``app.js``) and writes their traits / sends fly-to messages
directly — no kernel needed.
"""

from __future__ import annotations

import pathlib

import traitlets
from ipywidgets import Widget, widget_serialization
from manywidgets import BaseWidget

_HERE = pathlib.Path(__file__).parent


class SituationRoom(BaseWidget):
    """Custom fullscreen app shell (or compact teaser card when ``mode="teaser"``).

    Data-shaped traits (plain JSON, computed in the notebook):

    - ``meta``: {kicker, title, subtitle, window_label, attribution,
      credits: [{label, url}], note?}
    - ``types``: [{key, label, color, count, affected}] — hazard types in
      display order; drives chips, the weekly chart and the map legend.
    - ``stats``: {tiles: [{label, value, sub, color?}]}
    - ``events``: [{id, title, type, alert, date, iso, week, countries,
      severity_text, lon, lat, zoom, affected, impacts: [{label, value,
      forecasted}]}] — the full event list, already sorted for display.
    - ``selected_types``: active hazard-type keys (written back by the UI;
      empty means "all").
    - ``selected_event``: corr_id of the focused event (written back by the UI).

    Widget references (mounted/driven client-side):

    - ``map``: the lonboard ``Map`` mounted in the main area (also receives
      fly-to camera messages).
    - ``point_layers``: one ScatterplotLayer per entry in ``types`` (aligned);
      chips toggle each layer's ``visible`` trait.
    - ``footprint_layers`` / ``footprint_types``: PolygonLayers for the types
      that have hazard footprints, with the parallel list of type keys.
      (Per-type layers instead of a DataFilterExtension category filter: the
      category filter breaks layers under static export.)
    - ``night_layer``: the GIBS Black Marble tile layer, toggled by a switch.
    """

    _esm = _HERE / "app.js"
    _css = _HERE / "app.css"

    mode = traitlets.Unicode("app", help='"app" (full shell) or "teaser" (inline card).').tag(sync=True)

    meta = traitlets.Dict().tag(sync=True)
    types = traitlets.List(traitlets.Dict()).tag(sync=True)
    stats = traitlets.Dict().tag(sync=True)
    events = traitlets.List(traitlets.Dict()).tag(sync=True)
    selected_types = traitlets.List(traitlets.Unicode()).tag(sync=True)
    selected_event = traitlets.Unicode("").tag(sync=True)

    map = traitlets.Instance(Widget, allow_none=True).tag(sync=True, **widget_serialization)
    point_layers = traitlets.List(traitlets.Instance(Widget)).tag(sync=True, **widget_serialization)
    footprint_layers = traitlets.List(traitlets.Instance(Widget)).tag(sync=True, **widget_serialization)
    footprint_types = traitlets.List(traitlets.Unicode()).tag(sync=True)
    night_layer = traitlets.Instance(Widget, allow_none=True).tag(sync=True, **widget_serialization)

    _myst_child_traits = traitlets.List(["map"]).tag(sync=True)
