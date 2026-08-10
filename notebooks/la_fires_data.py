"""Data-prep module for the Palisades fire (Los Angeles, Jan 2025) building-damage explorer.

Sources (all verified 2026-08-10):
- Fire perimeter: NIFC WFIGS Interagency Fire Perimeters (ArcGIS FeatureServer).
- Building damage: Microsoft AI for Good damage predictions via HDX
  (footprint polygons with a per-building damage probability, derived from
  Maxar post-event imagery, catalog 1050010040277500).
- Building footprints: Overture Maps buildings GeoParquet (release 2026-07-22.0)
  queried with DuckDB (httpfs + spatial) using bbox pushdown.
- Imagery: Maxar Open Data ARD visual COGs. NOTE: Maxar Open Data is licensed
  CC-BY-NC-4.0 (non-commercial, attribution required).

All loaders are cache-first: files under notebooks/data/ are used when present,
otherwise re-fetched/re-derived. Dependencies: duckdb, geopandas, pyarrow,
requests, shapely.
"""

from __future__ import annotations

import json
from pathlib import Path
from urllib.parse import urljoin

DATA_DIR = Path(__file__).parent / "data"

# --- Verified endpoints -----------------------------------------------------

WFIGS_PERIMETERS_URL = (
    "https://services3.arcgis.com/T4QMspbfLg3qTGWY/arcgis/rest/services/"
    "WFIGS_Interagency_Perimeters/FeatureServer/0/query"
)

HDX_DAMAGE_GPKG_URL = (
    "https://data.humdata.org/dataset/30768ff0-289b-4fda-96d9-7209243c984d/"
    "resource/9650c5fe-c29b-429e-81e3-537688a74f60/download/"
    "maxar_palisades_1050010040277500_damage_predictions.gpkg"
)

OVERTURE_BUILDINGS_S3 = (
    "s3://overturemaps-us-west-2/release/2026-07-22.0/"
    "theme=buildings/type=building/*"
)

MAXAR_STAC_ROOT = (
    "https://maxar-opendata.s3.amazonaws.com/events/"
    "WildFires-LosAngeles-Jan-2025/collection.json"
)
MAXAR_PRE_CATALOG_ID = "10400100A17B5900"  # WV-3, 2024-12-21, 0% cloud
MAXAR_POST_CATALOG_ID = "103001010B9A1B00"  # WV-2, 2025-01-13, 0% cloud

# Palisades perimeter bbox padded ~1 km (lon/lat)
AOI = (-118.6959, 34.0198, -118.4906, 34.1394)

# Cached files
PERIMETER_FILE = DATA_DIR / "palisades_perimeter.geojson"
DAMAGE_GPKG_FILE = DATA_DIR / "msf_damage_maxar.gpkg"
BUILDINGS_FILE = DATA_DIR / "palisades_buildings.parquet"
BUILDINGS_DAMAGE_FILE = DATA_DIR / "palisades_buildings_damage.parquet"
MAXAR_SELECTION_FILE = DATA_DIR / "maxar_selection.json"

DAMAGE_CLASSES = ["destroyed", "major", "minor", "affected", "no_damage", "unassessed"]


def _ensure_data_dir() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    gi = DATA_DIR / ".gitignore"
    if not gi.exists():
        gi.write_text("*\n")


# --- 1. Fire perimeter ------------------------------------------------------

def load_perimeter(incident: str = "Palisades"):
    """Return the WFIGS fire perimeter as a GeoDataFrame (EPSG:4326)."""
    import geopandas as gpd

    _ensure_data_dir()
    path = DATA_DIR / f"{incident.lower()}_perimeter.geojson"
    if not path.exists():
        import requests

        params = {
            "where": (
                f"UPPER(attr_IncidentName)=UPPER('{incident}') "
                "AND attr_POOState='US-CA' "
                "AND attr_FireDiscoveryDateTime > timestamp '2025-01-01 00:00:00' "
                "AND attr_FireDiscoveryDateTime < timestamp '2025-02-01 00:00:00'"
            ),
            "outFields": (
                "poly_IncidentName,attr_IncidentName,attr_FireDiscoveryDateTime,"
                "poly_GISAcres,attr_POOState"
            ),
            "f": "geojson",
        }
        r = requests.get(WFIGS_PERIMETERS_URL, params=params, timeout=120)
        r.raise_for_status()
        path.write_bytes(r.content)
    return gpd.read_file(path)


# --- 2+3+4. Buildings with damage ------------------------------------------

def _fetch_damage_gpkg() -> Path:
    if not DAMAGE_GPKG_FILE.exists():
        import requests

        r = requests.get(HDX_DAMAGE_GPKG_URL, timeout=300)
        r.raise_for_status()
        DAMAGE_GPKG_FILE.write_bytes(r.content)
    return DAMAGE_GPKG_FILE


def _fetch_overture_buildings():
    """Query Overture buildings inside AOI via DuckDB; returns GeoDataFrame."""
    import duckdb
    import geopandas as gpd
    from shapely import wkb

    if BUILDINGS_FILE.exists():
        return gpd.read_parquet(BUILDINGS_FILE)

    xmin, ymin, xmax, ymax = AOI
    con = duckdb.connect()
    con.execute(
        "INSTALL httpfs; LOAD httpfs; INSTALL spatial; LOAD spatial; "
        "SET s3_region='us-west-2';"
    )
    df = con.execute(
        f"""
        SELECT id, ST_AsWKB(geometry) AS wkb, height, num_floors,
               class, subtype, names.primary AS name
        FROM read_parquet('{OVERTURE_BUILDINGS_S3}', hive_partitioning=1)
        WHERE bbox.xmin <= {xmax} AND bbox.xmax >= {xmin}
          AND bbox.ymin <= {ymax} AND bbox.ymax >= {ymin}
        """
    ).fetch_df()
    geom = df["wkb"].apply(lambda b: wkb.loads(bytes(b)))
    gdf = gpd.GeoDataFrame(df.drop(columns=["wkb"]), geometry=geom, crs="EPSG:4326")
    gdf.to_parquet(BUILDINGS_FILE)
    return gdf


def _classify(damaged, pct) -> str:
    if damaged == 0 or pct is None or pct <= 0:
        return "no_damage"
    if pct >= 0.75:
        return "destroyed"
    if pct >= 0.50:
        return "major"
    if pct >= 0.25:
        return "minor"
    return "affected"


def load_buildings_with_damage():
    """Overture footprints joined with MS AI-for-Good damage classes.

    Returns a GeoDataFrame (EPSG:4326) with columns:
    id, height, num_floors, class, subtype, name, geometry,
    damage_pct (0-1, max over matched damage footprints), damaged (0/1),
    damage (destroyed/major/minor/affected/no_damage/unassessed).
    Buildings outside the damage-assessment coverage are 'unassessed'.
    """
    import geopandas as gpd
    import pandas as pd

    _ensure_data_dir()
    if BUILDINGS_DAMAGE_FILE.exists():
        return gpd.read_parquet(BUILDINGS_DAMAGE_FILE)

    bld = _fetch_overture_buildings()
    dmg = gpd.read_file(_fetch_damage_gpkg()).to_crs("EPSG:4326")

    dmg_pts = dmg.copy()
    dmg_pts["geometry"] = dmg_pts.geometry.representative_point()
    j = gpd.sjoin(
        dmg_pts[["damage_pct_0m", "damaged", "geometry"]],
        bld[["id", "geometry"]],
        predicate="within",
        how="left",
    )
    un = j[j["id"].isna()].drop(columns=["index_right", "id"])
    if len(un):
        jn = gpd.sjoin_nearest(
            un.to_crs("EPSG:32611"),
            bld[["id", "geometry"]].to_crs("EPSG:32611"),
            max_distance=15,
            how="left",
        )
        j = pd.concat([j[j["id"].notna()], jn.to_crs("EPSG:4326")])

    agg = (
        j.dropna(subset=["id"])
        .groupby("id")
        .agg(damage_pct=("damage_pct_0m", "max"), damaged=("damaged", "max"))
        .reset_index()
    )
    agg["damage"] = [
        _classify(d, p) for d, p in zip(agg["damaged"], agg["damage_pct"])
    ]
    out = bld.merge(agg, on="id", how="left")
    out["damage"] = out["damage"].fillna("unassessed")
    out.to_parquet(BUILDINGS_DAMAGE_FILE)
    return out


# --- 5. Maxar pre/post imagery ---------------------------------------------

def _bbox_intersects(a, b) -> bool:
    return not (a[2] < b[0] or a[0] > b[2] or a[3] < b[1] or a[1] > b[3])


def _walk_maxar_selection() -> dict:
    import requests

    root = requests.get(MAXAR_STAC_ROOT, timeout=60).json()
    children = [
        urljoin(MAXAR_STAC_ROOT, l["href"])
        for l in root["links"]
        if l["rel"] == "child"
    ]
    sel = {"pre": [], "post": []}
    wanted = {MAXAR_PRE_CATALOG_ID: "pre", MAXAR_POST_CATALOG_ID: "post"}
    for curl in children:
        cid = curl.rsplit("/", 1)[-1].replace("_collection.json", "")
        if cid not in wanted:
            continue
        col = requests.get(curl, timeout=60).json()
        for l in col["links"]:
            if l["rel"] != "item":
                continue
            iurl = urljoin(curl, l["href"])
            it = requests.get(iurl, timeout=60).json()
            if not _bbox_intersects(it["bbox"], AOI):
                continue
            props = it["properties"]
            sel[wanted[cid]].append(
                {
                    "quadkey": props.get("quadkey"),
                    "datetime": props.get("datetime"),
                    "url": urljoin(iurl, it["assets"]["visual"]["href"]),
                    "bounds": it["bbox"],
                    "gsd": props.get("gsd"),
                }
            )
    for side in sel:
        sel[side].sort(key=lambda x: x["quadkey"])
    return sel


def load_maxar_selection() -> dict:
    """Return {"pre": [...], "post": [...]} of verified Maxar ARD visual COGs.

    Each entry: quadkey, datetime, url (https COG), bounds (lon/lat bbox), gsd.
    Pre: 2024-12-21 (WV-3, 0.35 m). Post: 2025-01-13 (WV-2, 0.76 m), 0% cloud.
    License: CC-BY-NC-4.0 (Maxar Open Data).
    """
    _ensure_data_dir()
    if MAXAR_SELECTION_FILE.exists():
        return json.loads(MAXAR_SELECTION_FILE.read_text())
    sel = _walk_maxar_selection()
    MAXAR_SELECTION_FILE.write_text(json.dumps(sel, indent=1))
    return sel


if __name__ == "__main__":
    p = load_perimeter()
    print("perimeter:", len(p), list(p.total_bounds))
    b = load_buildings_with_damage()
    print("buildings:", len(b), b["damage"].value_counts().to_dict())
    m = load_maxar_selection()
    print("maxar: pre", len(m["pre"]), "post", len(m["post"]))
