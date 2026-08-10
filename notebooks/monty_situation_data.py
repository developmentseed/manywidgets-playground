"""Data-prep module for the Global Disaster Situation Room demo.

Source: the Montandon harmonized disaster STAC API (IFRC), GDACS collections
(all verified 2026-08-10):

- ``gdacs-events``   — one Point item per event episode (title, severitydata,
  monty:corr_id, country codes, hazard codes).
- ``gdacs-hazards``  — same events with GDACS alert level
  (``monty:hazard_detail.severity_label``: Green/Orange/Red) and, for floods,
  wildfires and droughts, footprint (Multi)Polygons.
- ``gdacs-impacts``  — per-advisory impact records
  (``monty:impact_detail``: type/category/value, e.g. affected_total/people).

Auth: requires ``MONTANDON_API_TOKEN`` (Bearer), loaded from the repo ``.env``
via python-dotenv. All loaders are cache-first: parquet/JSON snapshots under
``notebooks/data/monty_situation/`` are used when present, so the token is only
needed when refreshing the snapshot. The window is pinned in the snapshot's
``meta.json`` (not "now") so re-executions are reproducible.
"""

from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from pathlib import Path

DATA_DIR = Path(__file__).parent / "data" / "monty_situation"

STAC_API_URL = "https://montandon-eoapi.ifrc.org/stac"
WINDOW_DAYS = 90
MAX_ITEMS = 5000

# UNDRR hazard code (first entry of monty:hazard_codes) -> situation-room type.
# Colors picked for a dark UI; each type keeps one hue across points/footprints.
HAZARD_TYPES = {
    "GH0101": {"key": "eq", "label": "Earthquake", "color": "#ef6548"},
    "MH0600": {"key": "fl", "label": "Flood", "color": "#4da3ff"},
    "MH0309": {"key": "tc", "label": "Tropical cyclone", "color": "#b78cf2"},
    # NB: verified against item titles/keywords — MH0401 items are "Drought in …"
    # and EN0205 items are "Forest fires in …" (not the other way around).
    "MH0401": {"key": "dr", "label": "Drought", "color": "#d9c36a"},
    "EN0205": {"key": "wf", "label": "Wildfire", "color": "#ffb020"},
    "GH0205": {"key": "vo", "label": "Volcano", "color": "#ff4d6d"},
}

EVENTS_FILE = DATA_DIR / "events.parquet"
FOOTPRINTS_FILE = DATA_DIR / "footprints.parquet"
IMPACTS_FILE = DATA_DIR / "impacts.parquet"
META_FILE = DATA_DIR / "meta.json"

# Human labels for monty:impact_detail.type values (GDACS vocabulary).
IMPACT_LABELS = {
    "death": "Deaths",
    "missing": "Missing",
    "injured": "Injured",
    "affected_total": "People affected",
    "potentially_affected": "Potentially affected",
    "assisted": "People assisted",
    "relocated": "People displaced",
    "damaged": "Buildings damaged",
    "destroyed": "Buildings destroyed",
}


def _ensure_data_dir() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    gi = DATA_DIR.parent / ".gitignore"
    if not gi.exists():
        gi.write_text("*\n")


def _client():
    import os

    from dotenv import load_dotenv
    from pystac_client import Client

    load_dotenv(Path(__file__).parents[1] / ".env")
    token = os.getenv("MONTANDON_API_TOKEN")
    if not token:
        raise RuntimeError(
            "MONTANDON_API_TOKEN is not set and no cached snapshot exists — "
            "add it to .env (see .env.example) to fetch the GDACS snapshot."
        )
    return Client.open(STAC_API_URL, headers={"Authorization": f"Bearer {token}"})


def _window() -> tuple[str, str]:
    """Snapshot window (ISO start/end). Pinned in meta.json once fetched."""
    if META_FILE.exists():
        meta = json.loads(META_FILE.read_text())
        return meta["window_start"], meta["window_end"]
    now = datetime.now(timezone.utc).replace(microsecond=0)
    start = now - timedelta(days=WINDOW_DAYS)
    return start.isoformat(), now.isoformat()


def _search(client, collection: str):
    start, end = _window()
    return list(
        client.search(
            collections=[collection],
            datetime=f"{start}/{end}",
            max_items=MAX_ITEMS,
        ).items()
    )


def _hazard_code(props: dict) -> str | None:
    for code in props.get("monty:hazard_codes", []):
        if code in HAZARD_TYPES:
            return code
    return None


def _fetch_snapshot() -> None:
    """Fetch events + hazards + impacts once and write all cache files."""
    import geopandas as gpd
    import pandas as pd
    from shapely.geometry import shape

    client = _client()
    start, end = _window()

    ev_items = _search(client, "gdacs-events")
    hz_items = _search(client, "gdacs-hazards")
    im_items = _search(client, "gdacs-impacts")

    # Alert level + GDACS score per correlation id (from the hazards view).
    alerts: dict[str, dict] = {}
    for it in hz_items:
        p = it.properties
        detail = p.get("monty:hazard_detail", {}) or {}
        alerts[p["monty:corr_id"]] = {
            "alert": detail.get("severity_label") or "Green",
            "gdacs_score": detail.get("severity_value"),
        }

    # Events: dedupe by corr_id keeping the latest episode.
    rows = []
    for it in ev_items:
        p = it.properties
        code = _hazard_code(p)
        if code is None or not it.geometry:
            continue
        geom = shape(it.geometry)
        sev = p.get("severitydata", {}) or {}
        a = alerts.get(p["monty:corr_id"], {})
        rows.append(
            {
                "corr_id": p["monty:corr_id"],
                "title": p.get("title") or p.get("description") or "Event",
                "hazard_code": code,
                "type": HAZARD_TYPES[code]["key"],
                "datetime": pd.to_datetime(p["datetime"], utc=True),
                "episode": p.get("monty:episode_number"),
                "countries": ",".join(p.get("monty:country_codes", [])),
                "severity": sev.get("severity"),
                "severity_unit": sev.get("severityunit"),
                "severity_text": sev.get("severitytext"),
                "alert": a.get("alert", "Green"),
                "gdacs_score": a.get("gdacs_score"),
                "geometry": geom,
            }
        )
    events = (
        gpd.GeoDataFrame(rows, geometry="geometry", crs="EPSG:4326")
        .sort_values(["corr_id", "episode"])
        .groupby("corr_id", as_index=False)
        .last()
    )
    events = gpd.GeoDataFrame(events, geometry="geometry", crs="EPSG:4326")

    # Footprints: real (Multi)Polygons only, one row per event.
    fp_rows = []
    for it in hz_items:
        p = it.properties
        code = _hazard_code(p)
        if code is None or not it.geometry:
            continue
        if it.geometry.get("type") not in ("Polygon", "MultiPolygon"):
            continue
        geom = shape(it.geometry)
        if geom.is_empty:
            continue
        fp_rows.append(
            {
                "corr_id": p["monty:corr_id"],
                "type": HAZARD_TYPES[code]["key"],
                "alert": (p.get("monty:hazard_detail", {}) or {}).get("severity_label")
                or "Green",
                "geometry": geom,
            }
        )
    footprints = (
        gpd.GeoDataFrame(fp_rows, geometry="geometry", crs="EPSG:4326")
        .dissolve(by="corr_id", aggfunc="first")
        .reset_index()
    )

    # Impacts: latest advisory per (event, impact type).
    im_rows = []
    for it in im_items:
        p = it.properties
        detail = p.get("monty:impact_detail", {}) or {}
        if detail.get("value") is None:
            continue
        im_rows.append(
            {
                "corr_id": p["monty:corr_id"],
                "impact_type": detail.get("type"),
                "category": detail.get("category"),
                "value": detail.get("value"),
                "forecasted": bool(p.get("forecasted", False)),
                "datetime": pd.to_datetime(p["datetime"], utc=True),
            }
        )
    impacts = (
        pd.DataFrame(im_rows)
        .sort_values("datetime")
        .groupby(["corr_id", "impact_type"], as_index=False)
        .last()
    )

    _ensure_data_dir()
    events.to_parquet(EVENTS_FILE)
    footprints.to_parquet(FOOTPRINTS_FILE)
    impacts.to_parquet(IMPACTS_FILE)
    META_FILE.write_text(
        json.dumps(
            {
                "window_start": start,
                "window_end": end,
                "fetched_at": datetime.now(timezone.utc).isoformat(),
                "api": STAC_API_URL,
                "counts": {
                    "events": len(events),
                    "footprints": len(footprints),
                    "impact_records": len(impacts),
                },
            },
            indent=1,
        )
    )


def _load(path: Path, kind: str):
    import geopandas as gpd
    import pandas as pd

    if not path.exists():
        _fetch_snapshot()
    if kind == "gdf":
        return gpd.read_parquet(path)
    return pd.read_parquet(path)


def load_events():
    """Deduped GDACS events (Points, EPSG:4326) for the snapshot window.

    Columns: corr_id, title, hazard_code, type (eq/fl/tc/wf/dr/vo), datetime,
    episode, countries, severity, severity_unit, severity_text,
    alert (Green/Orange/Red), gdacs_score, geometry.
    """
    return _load(EVENTS_FILE, "gdf")


def load_footprints():
    """Hazard footprints ((Multi)Polygons, one row per event): corr_id, type, alert."""
    return _load(FOOTPRINTS_FILE, "gdf")


def load_impacts():
    """Latest impact record per (corr_id, impact_type): value, category, forecasted."""
    return _load(IMPACTS_FILE, "df")


def snapshot_meta() -> dict:
    if not META_FILE.exists():
        _fetch_snapshot()
    return json.loads(META_FILE.read_text())


if __name__ == "__main__":
    e = load_events()
    f = load_footprints()
    i = load_impacts()
    print("events:", len(e), e["type"].value_counts().to_dict())
    print("alerts:", e["alert"].value_counts().to_dict())
    print("footprints:", len(f), f["type"].value_counts().to_dict())
    print("impact records:", len(i), i["impact_type"].value_counts().to_dict())
    print("window:", snapshot_meta()["window_start"], "→", snapshot_meta()["window_end"])
