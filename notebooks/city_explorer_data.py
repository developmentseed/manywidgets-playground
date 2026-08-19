"""Data-prep module for "The Good Life Index" city explorer (Amsterdam / New York).

Sources:
- Building footprints: Overture Maps buildings GeoParquet (release 2026-07-22.0)
  queried with DuckDB (httpfs + spatial) using bbox pushdown — same pattern as
  la_fires_data.py.
- Amenities + pedestrian network: OpenStreetMap via osmnx (ODbL).

For each city a compact core AOI gets an H3 res-10 hex grid; every hex is
assigned network walking minutes (multi-source Dijkstra on the OSM walk graph,
80 m/min) to the nearest amenity of each category, plus the identity of that
amenity (for the click-inspector's spider lines). If Overpass is unreachable
the loader falls back to Euclidean distance x 1.4 detour factor and flags it.

All loaders are cache-first: files under notebooks/data/city_explorer/ are used
when present, otherwise re-fetched/re-derived. Run this module directly to
populate the cache and print the payload gates:

    uv run python notebooks/city_explorer_data.py
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np

DATA_DIR = Path(__file__).parent / "data" / "city_explorer"

OVERTURE_RELEASE = "2026-07-22.0"
OVERTURE_BUILDINGS_S3 = (
    f"s3://overturemaps-us-west-2/release/{OVERTURE_RELEASE}/"
    "theme=buildings/type=building/*"
)

WALK_M_PER_MIN = 80.0  # ~4.8 km/h
MINUTES_CAP = 30.0
DETOUR_FACTOR = 1.4  # Euclidean fallback only
H3_RES = 10
MAX_BUILDINGS_PER_CITY = 12_000
MIN_PARK_AREA_M2 = 2_000  # ignore flower-bed "parks"
PARK_BOUNDARY_STEP_M = 50  # sample park edges as extra Dijkstra sources

CITIES: dict[str, dict] = {
    "ams": {
        "label": "Amsterdam",
        "utm": "EPSG:32631",
        "default_height": 11.0,
        # Canal ring / binnenstad core (tightened: full ring bbox held 22k
        # buildings, over the payload gate).
        "aoi": (4.880, 52.362, 4.908, 52.381),
    },
    "nyc": {
        "label": "New York",
        "utm": "EPSG:32618",
        "default_height": 18.0,
        # Lower Manhattan, below ~14th St (nudged under the payload gate).
        "aoi": (-74.018, 40.700, -73.972, 40.7355),
    },
}

# Category order is load-bearing: it defines the column order used by the
# widget traits and the DataFilterExtension filter columns downstream.
CATEGORIES: list[dict] = [
    {"key": "coffee", "tags": {"amenity": ["cafe"]}},
    {"key": "toilet", "tags": {"amenity": ["toilets"]}},
    {"key": "park", "tags": {"leisure": ["park", "garden"]}},
    {
        "key": "grocery",
        "tags": {"shop": ["supermarket", "convenience", "greengrocer"]},
    },
    {"key": "pub", "tags": {"amenity": ["pub", "bar"]}},
    {
        "key": "transit",
        "tags": {
            "railway": ["station", "halt", "tram_stop", "subway_entrance"],
            "highway": ["bus_stop"],
        },
    },
]
CATEGORY_KEYS = [c["key"] for c in CATEGORIES]


def _ensure_data_dir() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)


def _aoi_polygon(city: str):
    from shapely.geometry import box

    return box(*CITIES[city]["aoi"])


# --- 1. Overture buildings ---------------------------------------------------


def _fetch_overture_raw(city: str):
    """Raw Overture pull for the city bbox (cached so AOI tweaks don't refetch)."""
    import duckdb
    import geopandas as gpd
    from shapely import wkb

    path = DATA_DIR / f"{city}_buildings_raw.parquet"
    if path.exists():
        return gpd.read_parquet(path)

    xmin, ymin, xmax, ymax = CITIES[city]["aoi"]
    con = duckdb.connect()
    con.execute(
        "INSTALL httpfs; LOAD httpfs; INSTALL spatial; LOAD spatial; "
        "SET s3_region='us-west-2';"
    )
    df = con.execute(
        f"""
        SELECT id, ST_AsWKB(geometry) AS wkb, height, num_floors
        FROM read_parquet('{OVERTURE_BUILDINGS_S3}', hive_partitioning=1)
        WHERE bbox.xmin <= {xmax} AND bbox.xmax >= {xmin}
          AND bbox.ymin <= {ymax} AND bbox.ymax >= {ymin}
        """
    ).fetch_df()
    geom = df["wkb"].apply(lambda b: wkb.loads(bytes(b)))
    gdf = gpd.GeoDataFrame(df.drop(columns=["wkb"]), geometry=geom, crs="EPSG:4326")
    gdf.to_parquet(path)
    return gdf


def _drop_small_holes(geom, min_area: float):
    from shapely.geometry import MultiPolygon, Polygon

    def clean(poly: Polygon) -> Polygon:
        rings = [r for r in poly.interiors if Polygon(r).area >= min_area]
        return Polygon(poly.exterior, rings)

    if geom.geom_type == "Polygon":
        return clean(geom)
    if geom.geom_type == "MultiPolygon":
        return MultiPolygon([clean(p) for p in geom.geoms])
    return geom


def load_buildings(city: str):
    """Simplified, height-filled buildings clipped to the core AOI.

    Returns GeoDataFrame (EPSG:4326) with columns: geometry, height (float32).
    Gate: raises if the clipped count exceeds MAX_BUILDINGS_PER_CITY.
    """
    import geopandas as gpd

    _ensure_data_dir()
    path = DATA_DIR / f"{city}_buildings.parquet"
    if path.exists():
        return gpd.read_parquet(path)

    cfg = CITIES[city]
    raw = _fetch_overture_raw(city)
    aoi = _aoi_polygon(city)

    gdf = raw[raw.geometry.intersects(aoi)].copy()
    if len(gdf) > MAX_BUILDINGS_PER_CITY:
        raise AssertionError(
            f"{city}: {len(gdf)} buildings in AOI exceeds gate of "
            f"{MAX_BUILDINGS_PER_CITY} — tighten CITIES['{city}']['aoi']."
        )

    height = gdf["height"].astype("float64")
    height = height.fillna(gdf["num_floors"].astype("float64") * 3.2)
    gdf["height"] = height.fillna(cfg["default_height"]).astype("float32")

    utm = gdf.to_crs(cfg["utm"])
    utm["geometry"] = utm.geometry.simplify(0.75).apply(
        _drop_small_holes, min_area=20.0
    )
    utm = utm[utm.geometry.is_valid & ~utm.geometry.is_empty]
    out = utm.to_crs("EPSG:4326")[["height", "geometry"]].reset_index(drop=True)
    out.to_parquet(path)
    return out


# --- 2. OSM walk network -----------------------------------------------------


def _osmnx():
    import osmnx as ox

    ox.settings.cache_folder = DATA_DIR / "_osmnx_cache"
    return ox


def load_walk_graph(city: str):
    """Pedestrian network for the buffered AOI, cached as GraphML."""
    ox = _osmnx()

    _ensure_data_dir()
    path = DATA_DIR / f"{city}_walk.graphml"
    if path.exists():
        return ox.io.load_graphml(path)
    poly = _aoi_polygon(city).buffer(0.003)  # ~300 m so edges cross the AOI rim
    G = ox.graph.graph_from_polygon(poly, network_type="walk", simplify=True)
    ox.io.save_graphml(G, path)
    return G


# --- 3. Amenities ------------------------------------------------------------


def _dedupe_points(gdf, utm_crs: str, grid_m: float = 25.0):
    """Drop near-duplicate points by snapping to a coarse grid."""
    pts = gdf.to_crs(utm_crs)
    key = (
        (pts.geometry.x // grid_m).astype("int64").astype(str)
        + "_"
        + (pts.geometry.y // grid_m).astype("int64").astype(str)
    )
    return gdf[~key.duplicated()].copy()


def load_amenities(city: str):
    """One GeoDataFrame of amenity points: category, name, lon, lat, geometry.

    Point index within each category is the identity used by ``{cat}_idx`` in
    the hex stats and by the app's spider lines. Parks are polygons: the stored
    point is a representative point, but Dijkstra sources sample the boundary
    (see compute_hex_stats) so distances are to the park edge.
    """
    import geopandas as gpd
    import pandas as pd

    ox = _osmnx()

    _ensure_data_dir()
    path = DATA_DIR / f"{city}_amenities.parquet"
    if path.exists():
        return gpd.read_parquet(path)

    cfg = CITIES[city]
    poly = _aoi_polygon(city).buffer(0.003)
    frames = []
    for cat in CATEGORIES:
        feats = ox.features.features_from_polygon(poly, cat["tags"])
        if not len(feats):
            continue
        feats = feats.reset_index()
        if cat["key"] == "park":
            areas = feats.to_crs(cfg["utm"]).geometry.area
            feats = feats[areas >= MIN_PARK_AREA_M2].copy()
            feats["boundary_wkt"] = feats.geometry.to_wkt()
        pts = feats.copy()
        pts["geometry"] = pts.geometry.representative_point()
        pts = _dedupe_points(pts, cfg["utm"])
        name = pts["name"] if "name" in pts else pd.Series(index=pts.index, dtype=object)
        frames.append(
            gpd.GeoDataFrame(
                {
                    "category": cat["key"],
                    "name": name.where(name.notna(), None),
                    "boundary_wkt": pts.get("boundary_wkt"),
                    "geometry": pts.geometry,
                },
                crs="EPSG:4326",
            )
        )
    out = pd.concat(frames, ignore_index=True)
    out["lon"] = out.geometry.x
    out["lat"] = out.geometry.y
    out.to_parquet(path)
    return out


# --- 4. Hex stats ------------------------------------------------------------


def _hex_grid(city: str):
    """H3 res-10 cells covering the AOI -> DataFrame(h3, lon, lat)."""
    import h3
    import pandas as pd

    cells = h3.geo_to_cells(_aoi_polygon(city), H3_RES)
    latlng = [h3.cell_to_latlng(c) for c in cells]
    return pd.DataFrame(
        {
            "h3": list(cells),
            "lon": [p[1] for p in latlng],
            "lat": [p[0] for p in latlng],
        }
    ).sort_values("h3").reset_index(drop=True)


def _category_sources(cat_pts, cfg):
    """Dijkstra source coordinates (+ owning amenity index) for one category.

    For parks each boundary vertex sample maps back to the park's row index, so
    walking distance is to the park edge while identity stays the park itself.
    """
    from shapely import wkt

    import pandas as pd

    lons, lats, owner = [], [], []
    for idx, row in enumerate(cat_pts.itertuples()):
        bwkt = getattr(row, "boundary_wkt", None)
        if isinstance(bwkt, str) and pd.notna(bwkt):
            geom = wkt.loads(row.boundary_wkt)
            boundary = geom.boundary if geom.geom_type != "LineString" else geom
            step = PARK_BOUNDARY_STEP_M / 111_000  # ~deg; sampling, not survey
            n = max(4, int(boundary.length / step))
            for i in range(n):
                p = boundary.interpolate(i / n, normalized=True)
                lons.append(p.x)
                lats.append(p.y)
                owner.append(idx)
        else:
            lons.append(row.lon)
            lats.append(row.lat)
            owner.append(idx)
    return lons, lats, owner


def _network_minutes(G, hexes, cat_pts, cfg):
    """(minutes, idx) arrays for one category via multi-source Dijkstra."""
    import networkx as nx

    ox = _osmnx()

    lons, lats, owner = _category_sources(cat_pts, cfg)
    src_nodes, src_dists = ox.distance.nearest_nodes(G, lons, lats, return_dist=True)

    # Closest owning amenity per snapped node (several sources may share one).
    node_owner: dict = {}
    node_snap: dict = {}
    for n, d, o in zip(src_nodes, src_dists, owner):
        if n not in node_snap or d < node_snap[n]:
            node_snap[n] = d
            node_owner[n] = o

    sources = set(node_owner)
    dist = nx.multi_source_dijkstra_path_length(G, sources, weight="length")
    cells = nx.voronoi_cells(G, sources, weight="length")
    nearest_center: dict = {}
    for center, nodes in cells.items():
        if center == "unreachable":
            continue
        for n in nodes:
            nearest_center[n] = center

    hex_nodes, hex_dists = ox.distance.nearest_nodes(
        G, hexes["lon"].tolist(), hexes["lat"].tolist(), return_dist=True
    )
    minutes = np.full(len(hexes), MINUTES_CAP, dtype="float32")
    idx = np.full(len(hexes), -1, dtype="int32")
    for i, (n, snap) in enumerate(zip(hex_nodes, hex_dists)):
        if n in dist:
            m = (dist[n] + snap) / WALK_M_PER_MIN
            minutes[i] = min(m, MINUTES_CAP)
            center = nearest_center.get(n)
            if center is not None:
                idx[i] = node_owner[center]
    return minutes, idx


def _euclidean_minutes(hexes, cat_pts, cfg):
    """Fallback: straight-line distance x detour factor."""
    import geopandas as gpd
    from shapely import STRtree
    from shapely.geometry import Point

    pts = gpd.GeoSeries(
        [Point(xy) for xy in zip(cat_pts["lon"], cat_pts["lat"])], crs="EPSG:4326"
    ).to_crs(cfg["utm"])
    hx = gpd.GeoSeries(
        [Point(xy) for xy in zip(hexes["lon"], hexes["lat"])], crs="EPSG:4326"
    ).to_crs(cfg["utm"])
    tree = STRtree(list(pts))
    minutes = np.full(len(hexes), MINUTES_CAP, dtype="float32")
    idx = np.full(len(hexes), -1, dtype="int32")
    for i, p in enumerate(hx):
        j = int(tree.nearest(p))
        d = p.distance(pts.iloc[j]) * DETOUR_FACTOR
        minutes[i] = min(d / WALK_M_PER_MIN, MINUTES_CAP)
        idx[i] = j
    return minutes, idx


def compute_hex_stats(city: str):
    """Per-hex walking minutes + nearest-amenity identity for all categories.

    Returns DataFrame: h3 (str), lon, lat, then {cat}_min float32 and
    {cat}_idx int32 for each category in CATEGORY_KEYS order.
    """
    import pandas as pd

    _ensure_data_dir()
    path = DATA_DIR / f"{city}_hexes.parquet"
    if path.exists():
        return pd.read_parquet(path)

    cfg = CITIES[city]
    hexes = _hex_grid(city)
    amen = load_amenities(city)

    method = "network"
    try:
        G = load_walk_graph(city)
    except Exception as e:  # Overpass down — degrade honestly, don't die
        print(f"[city_explorer_data] {city}: walk graph failed ({e}); "
              "falling back to Euclidean x 1.4")
        G, method = None, "euclidean"

    for key in CATEGORY_KEYS:
        cat_pts = amen[amen["category"] == key].reset_index(drop=True)
        if not len(cat_pts):
            hexes[f"{key}_min"] = np.float32(MINUTES_CAP)
            hexes[f"{key}_idx"] = np.int32(-1)
            continue
        if method == "network":
            minutes, idx = _network_minutes(G, hexes, cat_pts, cfg)
        else:
            minutes, idx = _euclidean_minutes(hexes, cat_pts, cfg)
        hexes[f"{key}_min"] = minutes
        hexes[f"{key}_idx"] = idx

    meta = DATA_DIR / f"{city}_meta.json"
    meta.write_text(
        json.dumps(
            {
                "city": city,
                "method": method,
                "h3_res": H3_RES,
                "overture_release": OVERTURE_RELEASE,
                "categories": CATEGORY_KEYS,
                "walk_m_per_min": WALK_M_PER_MIN,
                "minutes_cap": MINUTES_CAP,
            },
            indent=1,
        )
    )
    hexes.to_parquet(path)
    return hexes


# --- 5. Head-to-head stats ---------------------------------------------------


def load_city_stats(city: str) -> dict:
    """Aggregates for the switcher UI: % of hexes within 5/10 min, medians."""
    hexes = compute_hex_stats(city)
    stats: dict = {"n_hexes": int(len(hexes)), "pct_within_5": {}, "pct_within_10": {},
                   "median_min": {}}
    for key in CATEGORY_KEYS:
        m = hexes[f"{key}_min"]
        stats["pct_within_5"][key] = round(float((m <= 5).mean()) * 100, 1)
        stats["pct_within_10"][key] = round(float((m <= 10).mean()) * 100, 1)
        stats["median_min"][key] = round(float(m.median()), 1)
    return stats


if __name__ == "__main__":
    for city in CITIES:
        print(f"=== {CITIES[city]['label']} ===")
        b = load_buildings(city)
        print(f"buildings: {len(b)} (gate {MAX_BUILDINGS_PER_CITY})")
        a = load_amenities(city)
        print("amenities:", a["category"].value_counts().to_dict())
        h = compute_hex_stats(city)
        print(f"hexes: {len(h)} @ res {H3_RES}")
        print("stats:", json.dumps(load_city_stats(city), indent=1))
