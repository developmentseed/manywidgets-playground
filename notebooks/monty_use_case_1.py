import marimo

__generated_with = "0.23.14"
app = marimo.App(width="medium", auto_download=["html", "ipynb"])


@app.cell
def _():
    import marimo as mo

    return (mo,)


@app.cell(hide_code=True)
def _(mo):
    mo.md(r"""
    # Use Case 1: Population and Infrastructure Risk Exposure
    How many people and which assets are exposed to a given hazard, before any event, as a baseline for preparedness and planning.
    """)
    return


@app.cell(hide_code=True)
def _(mo):
    mo.md(r"""
    ### Hazard Types

    1. Riverine Flood
    2. Tropical Cyclone
    3. Earthquake
    4. Wildfire
    """)
    return


@app.cell(hide_code=True)
def _(mo):
    mo.md(r"""
    ## Data Sources

    1. INFORM Subnational Risk Index — hazard scores per municipality
    2. Population data — WorldPop constrained population raster
    3. Administrative boundaries — OCHA COD-AB admin3 (municipality) polygons
    """)
    return


@app.cell(hide_code=True)
def _(mo):
    mo.md(r"""
    ## Data Prep
    """)
    return


@app.cell(hide_code=True)
def _(mo):
    mo.md(r"""
    ### Boundaries

    Let's fetch data for Lebanon.

    OCHA's Common Operational Datasets (COD-AB) are published as cloud-native
    GeoParquet by the Humanitarian Data Exchange on
    [source.coop/hdx/cod-ab](https://source.coop/hdx/cod-ab), one file per
    country/admin level. Admin 3 (`adm3`, ~1,600 municipalities) lines up
    with the municipality granularity used by the INFORM risk index below.

    The catalog is organized as a [STAC](https://stacspec.org/) tree
    (per the [Portolan SDI spec](https://www.portolan-sdi.org/#quickstart)
    this dataset is built with): root catalog → country → version →
    admin-level collection → asset. Each collection resolves to a
    predictable path, so we build the file's URL directly from a base
    URL and a country/version/admin-level suffix, fetch it, and keep
    only the columns we need.
    """)
    return


@app.cell
def _():
    import io

    import geopandas as gpd
    import requests

    boundaries_url = "https://data.source.coop/hdx/cod-ab"
    adm3_path = "lbn/latest/adm3/original.parquet"

    _response = requests.get(f"{boundaries_url}/{adm3_path}")
    lebanon_admin3_gdf = gpd.read_parquet(io.BytesIO(_response.content))
    # Keep only selected columns
    lebanon_admin3_gdf = lebanon_admin3_gdf[["adm1_name", "adm2_name", "adm3_name", "adm3_pcode", "geometry"]]
    lebanon_admin3_gdf
    return lebanon_admin3_gdf, requests


@app.cell(hide_code=True)
def _(mo):
    mo.md(r"""
    ### Inform Subnational Risk Index

    INFORM Subnational Risk is published for roughly 30 countries at various spatial resolution (admin 1 - 3), potentially ad-hoc.

    For example, the most recent data for Lebanon appears to be from 2024.
    """)
    return


@app.cell
def _():
    import pandas as pd

    inform_lebanon_url = "https://drmkc.jrc.ec.europa.eu/inform-index/Portals/0/InfoRM/2024/Subnational/Lebanon/20241010%20-%20INFORM_LEBANON_2024_v1.xlsx"

    inform_lebanon_df = pd.read_excel(
        inform_lebanon_url, sheet_name="INFORM Lebanon 2024", header=1
    ).dropna(subset=["MUNICIPALITY"])
    inform_lebanon_df
    return (inform_lebanon_df,)


@app.cell(hide_code=True)
def _(mo):
    mo.md(r"""
    For the purposes of this notebook, the key variables provided by INFORM appear to be:

    1. NATURAL
        1. Flood (riverine flood)
        2. Storm (tropical cyclone)
        3. Earthquake & Tsunami
        4. Forest Fire (wildfire)
    2. VULNERABILITY
    3. INFRASTRUCTURE
    4. LACK OF COPING CAPACITY
    5. RISK
    """)
    return


@app.cell(hide_code=True)
def _(mo):
    mo.md(r"""
    ### Matching boundaries to the risk index

    INFORM's admin3 codes are Lebanon's national cadastre codes (per the
    workbook's own Table of Contents), not OCHA P-codes, so the two datasets
    aren't interoperable via their code columns. We join on normalized
    district + municipality names instead. Both sides also carry placeholder
    rows for disputed/unclaimed cadastral zones (`"Litige"` in INFORM,
    `"Conflict"` in OCHA) that share a generic label rather than a real
    name, so those are excluded from the match rather than joined blindly.

    Name-matching works well here because OCHA's own admin3 level for
    Lebanon *is* the cadastre too, not a coincidence: its
    [STAC collection metadata](https://data.source.coop/hdx/cod-ab/lbn/latest/adm3/collection.json)
    labels `admin_3_name` as `"Cadaster (Manatek Ikaria)"`, and its
    `caveats` field documents that Lebanon's admin3 P-codes are purely
    numeric and follow a different sequence than admin1/2 — an OCHA-
    acknowledged P-code nesting conflict from the post-2014 governorate
    restructuring, independent of the INFORM/OCHA mismatch above.
    """)
    return


@app.cell
def _(inform_lebanon_df, lebanon_admin3_gdf):
    _inform = inform_lebanon_df[inform_lebanon_df["MUNICIPALITY"] != "Litige"].copy()
    _inform["key"] = (_inform["DISTRICT"] + _inform["MUNICIPALITY"]).str.lower().str.replace(r"[^a-z0-9]", "", regex=True)

    _ocha = lebanon_admin3_gdf[lebanon_admin3_gdf["adm3_name"] != "Litige"].copy()
    _ocha["key"] = (_ocha["adm2_name"] + _ocha["adm3_name"]).str.lower().str.replace(r"[^a-z0-9]", "", regex=True)

    _hazard_cols = ["Flood", "Storm", "Earthquake & Tsunami", "Forest Fire", "RISK"]

    risk_boundaries_gdf = _ocha[["key", "geometry"]].merge(
        _inform[["key", "GOVERNORATE", "DISTRICT", "MUNICIPALITY"] + _hazard_cols], on="key"
    )
    print(f"Matched {len(risk_boundaries_gdf)} of {len(_inform)} municipalities ({len(risk_boundaries_gdf) / len(_inform):.1%})")
    return (risk_boundaries_gdf,)


@app.cell(hide_code=True)
def _(mo):
    mo.md(r"""
    ### Overall Risk Map
    """)
    return


@app.cell(hide_code=True)
def _(mo):
    from manywidgets import Dropdown

    hazard_options = {
        "Overall Risk": "RISK",
        "Riverine Flood": "Flood",
        "Tropical Cyclone": "Storm",
        "Earthquake": "Earthquake & Tsunami",
        "Wildfire": "Forest Fire",
    }

    hazard_selector = mo.ui.anywidget(
        Dropdown(options=list(hazard_options.keys()), value="Overall Risk", label="Hazard")
    )
    hazard_selector

    return hazard_options, hazard_selector


@app.cell
def _(risk_boundaries_gdf):
    import matplotlib
    from lonboard import Map, PolygonLayer
    from lonboard.colormap import apply_continuous_cmap

    _vals = risk_boundaries_gdf["RISK"]
    _normalized = (_vals - _vals.min()) / (_vals.max() - _vals.min())
    _colors = apply_continuous_cmap(_normalized.to_numpy(), matplotlib.colormaps["YlOrRd"])

    risk_layer = PolygonLayer.from_geopandas(
        risk_boundaries_gdf,
        get_fill_color=_colors,
        get_line_color=[80, 80, 80],
        line_width_min_pixels=0.5,
        opacity=0.8,
    )
    risk_map = Map(risk_layer, view_state={"longitude": 35.86, "latitude": 33.95, "zoom": 7.5}, height=500)
    risk_map
    return apply_continuous_cmap, matplotlib, risk_layer


@app.cell
def _(
    apply_continuous_cmap,
    hazard_options,
    hazard_selector,
    matplotlib,
    risk_boundaries_gdf,
    risk_layer,
):
    _col = hazard_options[hazard_selector.widget.value]
    _vals = risk_boundaries_gdf[_col]
    _normalized = (_vals - _vals.min()) / (_vals.max() - _vals.min())
    risk_layer.get_fill_color = apply_continuous_cmap(_normalized.to_numpy(), matplotlib.colormaps["YlOrRd"])

    return


@app.cell
def _(mo):
    mo.md(r"""
    ### Population Exposure

    [WorldPop](https://hub.worldpop.org/geodata/summary?id=74096) publishes constrained population estimates as ~100m GeoTIFFs, projected for future years including 2026. The Lebanon file is small (~3.7MB) so we fetch it in full rather than relying on partial reads — it's not actually a valid Cloud-Optimized GeoTIFF (its image directory sits at the end of the file and it has no overviews), so remote range-reads aren't supported anyway.

    We sum population per pixel within each admin3 polygon (zonal statistics) to get total population per municipality.
    """)
    return


@app.cell
def _(requests, risk_boundaries_gdf):
    from rasterstats import zonal_stats
    import rasterio

    _pop_url = "https://data.worldpop.org/GIS/Population/Global_2015_2030/R2025A/2026/LBN/v1/100m/constrained/lbn_pop_2026_CN_100m_R2025A_v1.tif"
    _response = requests.get(_pop_url)

    with rasterio.MemoryFile(_response.content) as _memfile:
        with _memfile.open() as _src:
            _stats = zonal_stats(
                risk_boundaries_gdf,
                _src.read(1),
                affine=_src.transform,
                stats="sum",
                nodata=_src.nodata,
            )

    risk_population_gdf = risk_boundaries_gdf.copy()
    risk_population_gdf["population"] = [round(_s["sum"] or 0) for _s in _stats]
    risk_population_gdf[["MUNICIPALITY", "population"]].sort_values("population", ascending=False).head()
    return (risk_population_gdf,)


@app.cell
def _(mo):
    mo.md(r"""
    ### Population at Risk by Hazard

    INFORM classifies its 0-10 risk scores into five bands using hierarchical
    cluster analysis: Very Low (0.0–2.1), Low (2.2–3.1), Medium (3.2–4.8),
    High (4.9–6.7), Very High (6.8–10.0) — see the
    [INFORM concept & methodology report](https://drmkc.jrc.ec.europa.eu/inform-index).
    Each hazard sub-indicator (Flood, Storm, Earthquake & Tsunami, Forest Fire)
    uses the same 0-10 scale as the overall RISK score.

    These bands are published for the global country-level index; INFORM's
    subnational methodology doesn't spell out per-indicator thresholds
    explicitly, so treating the "High" cutoff (≥4.9) as the default
    "at risk" threshold is a reasonable but non-official choice. The slider
    below defaults there and is adjustable, and applies to the hazard
    selected above.
    """)
    return


@app.cell
def _(mo):
    from manywidgets import Slider

    risk_threshold = mo.ui.anywidget(
        Slider(value=4.9, min=0, max=10, step=0.1, label="At-risk threshold (INFORM 0-10 scale; default 4.9 = 'High')")
    )
    risk_threshold

    return (risk_threshold,)


@app.cell
def _(
    hazard_options,
    hazard_selector,
    mo,
    risk_population_gdf,
    risk_threshold,
):
    from manywidgets import Stat

    _col = hazard_options[hazard_selector.widget.value]
    municipalities_at_risk_df = (
        risk_population_gdf.loc[
            risk_population_gdf[_col] >= risk_threshold.widget.value,
            ["MUNICIPALITY", "DISTRICT", _col, "population"],
        ]
        .rename(columns={_col: "risk_score"})
        .sort_values("population", ascending=False)
        .reset_index(drop=True)
    )

    population_at_risk_stat = Stat(
        label=f"People at risk — {hazard_selector.widget.value} (≥ {risk_threshold.widget.value})",
        value=f"{municipalities_at_risk_df['population'].sum():,.0f}",
        unit=f"across {len(municipalities_at_risk_df)} of {len(risk_population_gdf)} municipalities",
    )

    mo.vstack([population_at_risk_stat, municipalities_at_risk_df])

    return


if __name__ == "__main__":
    app.run()
