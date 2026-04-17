"""Build the 5-country TopoJSON map from Bostock's world-atlas (Natural Earth 1:50m). Pure stdlib — no geopandas/shapely."""

from __future__ import annotations

import json
import sys
import urllib.request
from pathlib import Path
from typing import Any

SOURCE_URL = "https://cdn.jsdelivr.net/npm/world-atlas@2/countries-50m.json"
OUTPUT_PATH = Path("docs/data/processed/map.topojson")

# Drops France's DOM-TOMs (Guiana, Reunion, etc) while keeping Portuguese islands and the Med.
EUROPE_BBOX = (-12.0, 33.0, 35.0, 72.0)  # (minLon, minLat, maxLon, maxLat)

# world-atlas pads ISO numeric ids with a leading zero (AT = "040"), so match as strings.
FOCUS_BY_ISO_NUMERIC = {
    "040": "AT",
    "250": "FR",
    "276": "DE",
    "380": "IT",
    "756": "CH",
}

DISPLAY_NAME = {
    "AT": "Austria",
    "CH": "Switzerland",
    "DE": "Germany",
    "FR": "France",
    "IT": "Italy",
}


def fetch_source() -> dict[str, Any]:
    print(f"Fetching {SOURCE_URL}")
    with urllib.request.urlopen(SOURCE_URL) as response:
        return json.loads(response.read())


def _normalise_id(value: Any) -> str:
    """world-atlas ids are strings, but guard against ints too."""
    if isinstance(value, int):
        return f"{value:03d}"
    if isinstance(value, str):
        return value.zfill(3)
    return ""


def filter_focus_geometries(world: dict[str, Any]) -> list[dict[str, Any]]:
    countries = world["objects"]["countries"]["geometries"]
    focus: list[dict[str, Any]] = []
    seen: set[str] = set()
    for g in countries:
        iso = _normalise_id(g.get("id"))
        if iso in FOCUS_BY_ISO_NUMERIC:
            code = FOCUS_BY_ISO_NUMERIC[iso]
            props = dict(g.get("properties") or {})
            props["iso_numeric"] = iso
            props["iso_code"] = code
            props["name"] = DISPLAY_NAME[code]
            new = dict(g)
            new["id"] = code
            new["properties"] = props
            focus.append(new)
            seen.add(code)

    missing = set(FOCUS_BY_ISO_NUMERIC.values()) - seen
    if missing:
        raise RuntimeError(f"world-atlas is missing focus countries: {sorted(missing)}")
    return focus


def collect_used_arcs(geometry: Any, used: set[int]) -> None:
    """Record every arc index a geometry touches. TopoJSON encodes reversed arcs as `~n`; we normalise to the forward index."""
    if isinstance(geometry, dict):
        if "arcs" in geometry:
            collect_used_arcs(geometry["arcs"], used)
        if "geometries" in geometry:
            for sub in geometry["geometries"]:
                collect_used_arcs(sub, used)
        return

    if isinstance(geometry, list):
        for item in geometry:
            if isinstance(item, int):
                used.add(item if item >= 0 else ~item)
            else:
                collect_used_arcs(item, used)


def remap_arcs(tree: Any, index_map: dict[int, int]) -> Any:
    """Copy an arc tree with every index remapped through `index_map`."""
    if isinstance(tree, int):
        if tree >= 0:
            return index_map[tree]
        return ~index_map[~tree]
    if isinstance(tree, list):
        return [remap_arcs(child, index_map) for child in tree]
    if isinstance(tree, dict):
        out = dict(tree)
        if "arcs" in out:
            out["arcs"] = remap_arcs(out["arcs"], index_map)
        if "geometries" in out:
            out["geometries"] = [remap_arcs(g, index_map) for g in out["geometries"]]
        return out
    return tree


def decode_arc(
    arc: list[list[int]],
    transform: dict[str, list[float]],
) -> list[tuple[float, float]]:
    """Delta-decode a quantised arc into lon/lat points."""
    scale = transform["scale"]
    translate = transform["translate"]
    points: list[tuple[float, float]] = []
    x = y = 0
    for idx, (dx, dy) in enumerate(arc):
        if idx == 0:
            x, y = dx, dy
        else:
            x += dx
            y += dy
        points.append((x * scale[0] + translate[0], y * scale[1] + translate[1]))
    return points


def polygon_centroid(
    polygon: list[list[int]],
    arcs: list[list[list[int]]],
    transform: dict[str, list[float]],
) -> tuple[float, float]:
    """Rough centroid of the outer ring — good enough for a bbox test."""
    if not polygon:
        return (0.0, 0.0)
    outer_ring = polygon[0]
    lons: list[float] = []
    lats: list[float] = []
    for arc_idx in outer_ring:
        forward = arc_idx if arc_idx >= 0 else ~arc_idx
        pts = decode_arc(arcs[forward], transform)
        if arc_idx < 0:
            pts = list(reversed(pts))
        for lon, lat in pts:
            lons.append(lon)
            lats.append(lat)
    if not lons:
        return (0.0, 0.0)
    return (sum(lons) / len(lons), sum(lats) / len(lats))


def prune_overseas_polygons(
    geom: dict[str, Any],
    arcs: list[list[list[int]]],
    transform: dict[str, list[float]],
) -> dict[str, Any]:
    """Drop MultiPolygon members outside Europe. Downgrade to Polygon if only one survives."""
    if geom.get("type") != "MultiPolygon":
        return geom

    min_lon, min_lat, max_lon, max_lat = EUROPE_BBOX
    kept = []
    for polygon in geom["arcs"]:
        c_lon, c_lat = polygon_centroid(polygon, arcs, transform)
        if min_lon <= c_lon <= max_lon and min_lat <= c_lat <= max_lat:
            kept.append(polygon)

    if not kept:
        raise RuntimeError(
            f"no European polygons left for {geom.get('id')} — "
            f"check EUROPE_BBOX"
        )

    new = dict(geom)
    if len(kept) == 1:
        new["type"] = "Polygon"
        new["arcs"] = kept[0]
    else:
        new["type"] = "MultiPolygon"
        new["arcs"] = kept
    return new


def compute_bbox_from_arcs(
    arcs: list[list[list[int]]],
    transform: dict[str, list[float]],
) -> list[float]:
    """bbox [minX, minY, maxX, maxY] in degrees from delta-encoded arcs."""
    scale = transform["scale"]
    translate = transform["translate"]

    min_x = min_y = float("inf")
    max_x = max_y = float("-inf")

    for arc in arcs:
        x = y = 0
        for idx, (dx, dy) in enumerate(arc):
            if idx == 0:
                x, y = dx, dy
            else:
                x += dx
                y += dy
            lon = x * scale[0] + translate[0]
            lat = y * scale[1] + translate[1]
            if lon < min_x: min_x = lon
            if lon > max_x: max_x = lon
            if lat < min_y: min_y = lat
            if lat > max_y: max_y = lat

    return [min_x, min_y, max_x, max_y]


def build(world: dict[str, Any]) -> dict[str, Any]:
    focus_geoms = filter_focus_geometries(world)

    # Prune before collecting arcs, otherwise overseas arcs get dragged in.
    transform = world.get("transform")
    if transform is None:
        raise RuntimeError("expected quantised source topology with a transform")
    focus_geoms = [prune_overseas_polygons(g, world["arcs"], transform) for g in focus_geoms]

    used: set[int] = set()
    for g in focus_geoms:
        collect_used_arcs(g, used)

    # Dense 0..N-1 renumbering that preserves original order.
    old_arcs = world["arcs"]
    old_to_new: dict[int, int] = {}
    new_arcs: list[Any] = []
    for old_idx in sorted(used):
        old_to_new[old_idx] = len(new_arcs)
        new_arcs.append(old_arcs[old_idx])

    new_geoms = [remap_arcs(g, old_to_new) for g in focus_geoms]

    bbox = compute_bbox_from_arcs(new_arcs, transform)

    return {
        "type": "Topology",
        "bbox": bbox,
        "transform": transform,
        "objects": {
            "countries": {
                "type": "GeometryCollection",
                "geometries": new_geoms,
            },
        },
        "arcs": new_arcs,
    }


def main() -> None:
    world = fetch_source()
    topo = build(world)

    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    with OUTPUT_PATH.open("w") as f:
        json.dump(topo, f, separators=(",", ":"))

    raw_arcs = len(world["arcs"])
    kept_arcs = len(topo["arcs"])
    size_kb = OUTPUT_PATH.stat().st_size / 1024

    print(f"Wrote {OUTPUT_PATH}")
    print(f"  countries kept: {len(topo['objects']['countries']['geometries'])}")
    print(f"  arcs kept:      {kept_arcs} / {raw_arcs} ({kept_arcs / raw_arcs:.1%})")
    print(f"  file size:      {size_kb:.1f} KB")
    print(f"  bbox:           {topo['bbox']}")
    for g in topo["objects"]["countries"]["geometries"]:
        print(f"  - {g['id']:2s}  {g['properties']['name']}  (type={g['type']})")


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:  # noqa: BLE001
        print(f"error: {exc}", file=sys.stderr)
        sys.exit(1)
