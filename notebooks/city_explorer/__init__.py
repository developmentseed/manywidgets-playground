"""CityExplorer — a fully custom web-app shell for "The Good Life Index" demo.

A bespoke anywidget: its ESM module (``app.js``) is a complete little web
application (city switcher, apartment-hunt sliders, persona cards, fly-to
presets, click-inspector with SVG spider lines) that embeds a live lonboard
``Map`` through the same ``renderChild`` mechanism the built-in layout widgets
use. It is designed to be placed in ``manywidgets.Fullscreen(fullscreen=...)``
so the fullscreen overlay becomes a custom app, fully functional in the
kernel-free static export.

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


class CityExplorer(BaseWidget):
    """Custom fullscreen app shell (or compact teaser card when ``mode="teaser"``).

    Data-shaped traits (all plain JSON, computed in the notebook):

    - ``meta``: {kicker, title, subtitle, attribution, credits: [{label, url}],
      note, license}
    - ``cities``: [{key, label, emoji, tagline, camera{longitude, latitude,
      zoom, pitch, bearing}, neighborhoods: [{label, longitude, latitude, zoom,
      pitch?, bearing?}], stats: {tiles: [{label, value, sub?}],
      versus: [{label, value}]}}] — order aligns with the per-city widget lists.
    - ``categories``: [{key, label, emoji, color, slider, max, default}] —
      category order everywhere (hex_index rows, filter columns for the
      slider-enabled subset in list order).
    - ``personas``: [{key, label, emoji, blurb, legend}] — aligned with
      ``persona_layer_keys`` via "{persona}:{city}".
    - ``hex_index``: {city: {"h3": [...], "lon": [...], "lat": [...],
      "mins": [[m0..m5] per hex], "idxs": [[i0..i5] per hex]}} — columnar to
      keep the JSON light; drives the inspector + "% of city" counters.
    - ``amenity_points``: {city: {cat: [[lon, lat, name], ...]}} — spider-line
      targets; ``idxs`` above index into these lists.
    - ``city`` / ``persona`` / ``filters``: UI state written back by the shell
      (persona "" = apartment-hunt mode; filters = {cat: max_minutes}).

    Widget references (mounted/driven client-side):

    - ``map``: the lonboard ``Map`` mounted in the main area (fly-to target).
    - ``building_layers`` / ``hunt_layers`` / ``amenity_layers``: one per city,
      aligned with ``cities``. The hunt layers carry a value-based
      DataFilterExtension; the sliders write ``filter_range`` directly. (Value
      filters are the proven pattern — category filters break under static
      export, and per-feature accessor writes from the client don't deserialize.)
    - ``persona_layers``: one pre-colored hex layer per (persona, city),
      aligned with ``persona_layer_keys``; toggled via ``visible``.
    """

    _esm = _HERE / "app.js"
    _css = _HERE / "app.css"

    mode = traitlets.Unicode("app", help='"app" (full shell) or "teaser" (inline card).').tag(sync=True)

    meta = traitlets.Dict().tag(sync=True)
    cities = traitlets.List(traitlets.Dict()).tag(sync=True)
    categories = traitlets.List(traitlets.Dict()).tag(sync=True)
    personas = traitlets.List(traitlets.Dict()).tag(sync=True)
    hex_index = traitlets.Dict().tag(sync=True)
    amenity_points = traitlets.Dict().tag(sync=True)
    persona_layer_keys = traitlets.List(traitlets.Unicode()).tag(sync=True)

    city = traitlets.Unicode("ams").tag(sync=True)
    persona = traitlets.Unicode("").tag(sync=True)
    filters = traitlets.Dict().tag(sync=True)

    map = traitlets.Instance(Widget, allow_none=True).tag(sync=True, **widget_serialization)
    building_layers = traitlets.List(traitlets.Instance(Widget)).tag(sync=True, **widget_serialization)
    hunt_layers = traitlets.List(traitlets.Instance(Widget)).tag(sync=True, **widget_serialization)
    persona_layers = traitlets.List(traitlets.Instance(Widget)).tag(sync=True, **widget_serialization)
    amenity_layers = traitlets.List(traitlets.Instance(Widget)).tag(sync=True, **widget_serialization)

    _myst_child_traits = traitlets.List(["map"]).tag(sync=True)
