"""FireExplorer — a fully custom web-app shell for the "Anatomy of a Firestorm" demo.

This is a bespoke anywidget: its ESM module (``app.js``) is a complete little
web application (header, analysis rail, damage chart, filter chips, layer
toggles, camera presets) that embeds live manywidgets/lonboard widgets — a
``MapCompare`` swipe with two lonboard ``Map``s — through the same
``renderChild`` mechanism the built-in layout widgets use. It is designed to be
placed in ``manywidgets.Fullscreen(fullscreen=...)`` so the fullscreen overlay
becomes a custom app, driven entirely from the notebook and fully functional in
the kernel-free static export.

All interactivity is client-side: the shell resolves the lonboard layer/map
models through the static-export registry (vendored ``@manywidgets/core``
helpers inside ``app.js``) and writes their traits directly — no kernel needed.
"""

from __future__ import annotations

import pathlib

import traitlets
from ipywidgets import Widget, widget_serialization
from manywidgets import BaseWidget

_HERE = pathlib.Path(__file__).parent


class FireExplorer(BaseWidget):
    """Custom fullscreen app shell (or compact teaser card when ``mode="teaser"``).

    Data-shaped traits (all plain JSON, computed in the notebook):

    - ``meta``: {kicker, title, subtitle, before_label, after_label,
      attribution, credits: [{label, url}], license}
    - ``classes``: [{key, label, color, count, pct}] — damage classes in
      severity order; drives the chart, the chips and the map legend.
    - ``stats``: {tiles: [{label, value, sub, color?}], assessed, total}
    - ``locations``: [{label, longitude, latitude, zoom, pitch?, bearing?}]
    - ``selected``: active damage-class keys (written back by the UI).

    Widget references (mounted/driven client-side):

    - ``compare``: a ``manywidgets.lonboard.MapCompare`` mounted in the main area.
    - ``class_layers``: one lonboard layer per damage class, aligned with
      ``classes`` — the chips toggle each layer's ``visible`` trait and the 3D
      switch fans ``extruded`` across all of them. (Per-class layers instead of
      a DataFilterExtension category filter: the category filter breaks the
      layer under static export, per-layer visibility is the proven pattern.)
    - ``perimeter_layer``: lonboard layer toggled by the perimeter switch.
    - ``maps``: the lonboard ``Map``s that receive fly-to camera messages.
    """

    _esm = _HERE / "app.js"
    _css = _HERE / "app.css"

    mode = traitlets.Unicode("app", help='"app" (full shell) or "teaser" (inline card).').tag(sync=True)

    meta = traitlets.Dict().tag(sync=True)
    classes = traitlets.List(traitlets.Dict()).tag(sync=True)
    stats = traitlets.Dict().tag(sync=True)
    locations = traitlets.List(traitlets.Dict()).tag(sync=True)
    selected = traitlets.List(traitlets.Unicode()).tag(sync=True)

    compare = traitlets.Instance(Widget, allow_none=True).tag(sync=True, **widget_serialization)
    class_layers = traitlets.List(traitlets.Instance(Widget)).tag(sync=True, **widget_serialization)
    perimeter_layer = traitlets.Instance(Widget, allow_none=True).tag(sync=True, **widget_serialization)
    maps = traitlets.List(traitlets.Instance(Widget)).tag(sync=True, **widget_serialization)

    _myst_child_traits = traitlets.List(["compare"]).tag(sync=True)
