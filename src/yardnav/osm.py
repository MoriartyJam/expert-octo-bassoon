from __future__ import annotations

from collections import defaultdict
from collections.abc import Iterable
from dataclasses import dataclass
from math import cos, floor, hypot, isfinite, radians
from pathlib import Path
from xml.etree import ElementTree

from .network import RoutingNetwork
from .profile import is_bikeable, is_walkable
from .routing import Edge, Node, straight_line_m


PUBLIC_ROADS = {
    "primary",
    "primary_link",
    "residential",
    "road",
    "secondary",
    "secondary_link",
    "tertiary",
    "tertiary_link",
    "trunk",
    "trunk_link",
    "unclassified",
}
ROADSIDE_CANDIDATES = {"footway", "path", "pedestrian"}
GRID_SIZE_M = 50.0
ROADSIDE_DISTANCE_M = 28.0
INTERIOR_DISTANCE_M = 32.0
PARALLEL_COSINE = 0.78
ROUTING_TAGS = {
    "access",
    "barrier",
    "bicycle",
    "crossing",
    "crossing:road",
    "crossing:signals",
    "foot",
    "foot:oneway",
    "footway",
    "highway",
    "kerb",
    "lit",
    "oneway:foot",
    "ramp:bicycle",
    "service",
    "smoothness",
    "surface",
    "tracktype",
    "yard",
}
NODE_ROUTING_TAGS = {
    "barrier",
    "bicycle",
    "crossing",
    "crossing:signals",
    "highway",
    "kerb",
}


@dataclass(frozen=True, slots=True)
class _Way:
    id: int
    refs: tuple[int, ...]
    tags: dict[str, str]


@dataclass(frozen=True, slots=True)
class _Segment:
    ax: float
    ay: float
    bx: float
    by: float

    @property
    def midpoint(self) -> tuple[float, float]:
        return (self.ax + self.bx) / 2, (self.ay + self.by) / 2


def _tags(
    element: ElementTree.Element,
    allowed: set[str] | None = None,
) -> dict[str, str]:
    return {
        tag.attrib["k"]: tag.attrib["v"]
        for tag in element.findall("tag")
        if "k" in tag.attrib and "v" in tag.attrib
        and (allowed is None or tag.attrib["k"] in allowed)
    }


def _project(node: Node, reference_lat: float) -> tuple[float, float]:
    return (
        node.lon * 111_320 * cos(radians(reference_lat)),
        node.lat * 110_540,
    )


def _point_segment_distance(px: float, py: float, segment: _Segment) -> float:
    dx = segment.bx - segment.ax
    dy = segment.by - segment.ay
    length_sq = dx * dx + dy * dy
    if length_sq == 0:
        return hypot(px - segment.ax, py - segment.ay)
    position = ((px - segment.ax) * dx + (py - segment.ay) * dy) / length_sq
    position = max(0.0, min(1.0, position))
    return hypot(
        px - (segment.ax + position * dx),
        py - (segment.ay + position * dy),
    )


def _parallel(first: _Segment, second: _Segment) -> bool:
    first_dx = first.bx - first.ax
    first_dy = first.by - first.ay
    second_dx = second.bx - second.ax
    second_dy = second.by - second.ay
    denominator = hypot(first_dx, first_dy) * hypot(second_dx, second_dy)
    if denominator == 0:
        return False
    cosine = abs((first_dx * second_dx + first_dy * second_dy) / denominator)
    return cosine >= PARALLEL_COSINE


def _grid_cells(segment: _Segment) -> set[tuple[int, int]]:
    min_x = floor(min(segment.ax, segment.bx) / GRID_SIZE_M)
    max_x = floor(max(segment.ax, segment.bx) / GRID_SIZE_M)
    min_y = floor(min(segment.ay, segment.by) / GRID_SIZE_M)
    max_y = floor(max(segment.ay, segment.by) / GRID_SIZE_M)
    return {
        (x, y)
        for x in range(min_x, max_x + 1)
        for y in range(min_y, max_y + 1)
    }


def _nearby_road_segments(
    segment: _Segment,
    road_grid: dict[tuple[int, int], list[_Segment]],
) -> list[_Segment]:
    midpoint_x, midpoint_y = segment.midpoint
    cell_x = floor(midpoint_x / GRID_SIZE_M)
    cell_y = floor(midpoint_y / GRID_SIZE_M)
    return [
        road
        for x in range(cell_x - 1, cell_x + 2)
        for y in range(cell_y - 1, cell_y + 2)
        for road in road_grid.get((x, y), ())
    ]


def _osm_files(path: Path | Iterable[Path]) -> tuple[Path, ...]:
    if not isinstance(path, Path):
        files = tuple(path)
        if not files:
            raise ValueError("at least one .osm file is required")
        return files
    if path.is_dir():
        files = tuple(sorted(path.glob("*.osm")))
        if not files:
            raise ValueError(f"no .osm files found in {path}")
        return files
    return (path,)


def load_osm_xml(
    path: str | Path | Iterable[Path],
    bounds: tuple[float, float, float, float] | None = None,
) -> RoutingNetwork:
    """Load a pedestrian and bicycle graph from OSM XML files.

    The path may point to one XML file or to a directory of tiled XML extracts.
    Ways repeated across tile boundaries are deduplicated by their OSM ID.
    """
    source = Path(path) if isinstance(path, (str, Path)) else path
    files = _osm_files(source)
    all_nodes: dict[int, Node] = {}
    node_tags: dict[int, dict[str, str]] = {}
    for file in files:
        for _, element in ElementTree.iterparse(file, events=("end",)):
            if element.tag == "node":
                node_id = int(element.attrib["id"])
                all_nodes[node_id] = Node(
                    id=node_id,
                    lat=float(element.attrib["lat"]),
                    lon=float(element.attrib["lon"]),
                )
                tags = _tags(element, NODE_ROUTING_TAGS)
                if tags:
                    node_tags[node_id] = tags
            if element.tag in {"node", "way"}:
                element.clear()

    ways_by_id: dict[int, _Way] = {}
    for file in files:
        for _, element in ElementTree.iterparse(file, events=("end",)):
            if element.tag == "way":
                tags = _tags(element, ROUTING_TAGS)
                if is_walkable(tags) or is_bikeable(tags):
                    refs = tuple(
                        int(nd.attrib["ref"])
                        for nd in element.findall("nd")
                        if int(nd.attrib["ref"]) in all_nodes
                    )
                    if len(refs) >= 2:
                        way_id = int(element.attrib["id"])
                        ways_by_id[way_id] = _Way(way_id, refs, tags)
            if element.tag in {"node", "way"}:
                element.clear()
    ways = list(ways_by_id.values())

    reference_lat = (
        sum(node.lat for node in all_nodes.values()) / len(all_nodes)
        if all_nodes
        else 0.0
    )
    road_grid: dict[tuple[int, int], list[_Segment]] = defaultdict(list)
    for way in ways:
        if way.tags.get("highway") not in PUBLIC_ROADS:
            continue
        for source_id, target_id in zip(way.refs, way.refs[1:]):
            source_x, source_y = _project(all_nodes[source_id], reference_lat)
            target_x, target_y = _project(all_nodes[target_id], reference_lat)
            segment = _Segment(source_x, source_y, target_x, target_y)
            for cell in _grid_cells(segment):
                road_grid[cell].append(segment)

    graph: dict[int, list[Edge]] = defaultdict(list)
    used_nodes: set[int] = set()
    tag_cache: dict[tuple[tuple[str, str], ...], dict[str, str]] = {}

    for way in ways:
        refs = way.refs
        tags = way.tags

        foot_oneway = tags.get("oneway:foot") or tags.get("foot:oneway")
        forward = foot_oneway != "-1"
        backward = foot_oneway not in {"yes", "1", "true"}

        for source_id, target_id in zip(refs, refs[1:]):
            source = all_nodes[source_id]
            target = all_nodes[target_id]
            if bounds is not None:
                south, west, north, east = bounds
                if not (
                    south <= source.lat <= north
                    and west <= source.lon <= east
                    and south <= target.lat <= north
                    and west <= target.lon <= east
                ):
                    continue
            length_m = straight_line_m(source, target)
            if not isfinite(length_m) or length_m <= 0:
                continue
            edge_tags = dict(tags)
            endpoint_tags = (
                node_tags.get(source_id, {}),
                node_tags.get(target_id, {}),
            )
            for node_id, candidate in zip(
                (source_id, target_id),
                endpoint_tags,
            ):
                if candidate.get("barrier"):
                    edge_tags["yardnav:barrier"] = candidate["barrier"]
                    edge_tags["yardnav:barrier_node"] = str(node_id)
                    if candidate.get("bicycle"):
                        edge_tags["bicycle"] = candidate["bicycle"]
                if candidate.get("kerb"):
                    edge_tags["yardnav:kerb"] = candidate["kerb"]
                    edge_tags["yardnav:kerb_node"] = str(node_id)
                elif candidate.get("barrier") == "kerb":
                    edge_tags["yardnav:kerb"] = "unknown"
                    edge_tags["yardnav:kerb_node"] = str(node_id)
            if tags.get("highway") in ROADSIDE_CANDIDATES:
                crossing_tags = next(
                    (
                        candidate
                        for candidate in (
                            node_tags.get(source_id, {}),
                            node_tags.get(target_id, {}),
                        )
                        if candidate.get("crossing") not in {None, "no"}
                        or candidate.get("highway") == "crossing"
                    ),
                    None,
                )
                if crossing_tags:
                    edge_tags["yardnav:crossing_node"] = "yes"
                    edge_tags["crossing"] = crossing_tags.get("crossing", "yes")
                    if "crossing:signals" in crossing_tags:
                        edge_tags["crossing:signals"] = crossing_tags["crossing:signals"]
            source_x, source_y = _project(source, reference_lat)
            target_x, target_y = _project(target, reference_lat)
            segment = _Segment(source_x, source_y, target_x, target_y)
            nearby_roads = _nearby_road_segments(segment, road_grid)
            midpoint_x, midpoint_y = segment.midpoint
            road_distances = [
                _point_segment_distance(midpoint_x, midpoint_y, road)
                for road in nearby_roads
            ]
            nearest_road = min(road_distances, default=float("inf"))

            if (
                tags.get("highway") in ROADSIDE_CANDIDATES
                and nearest_road <= ROADSIDE_DISTANCE_M
                and any(
                    _point_segment_distance(midpoint_x, midpoint_y, road)
                    <= ROADSIDE_DISTANCE_M
                    and _parallel(segment, road)
                    for road in nearby_roads
                )
            ):
                edge_tags["yardnav:roadside"] = "yes"
            if (
                tags.get("highway") == "service"
                and nearest_road > INTERIOR_DISTANCE_M
            ):
                edge_tags["yardnav:interior"] = "yes"

            tag_key = tuple(sorted(edge_tags.items()))
            shared_tags = tag_cache.setdefault(tag_key, edge_tags)
            if forward:
                graph[source_id].append(Edge(target_id, length_m, shared_tags))
            if backward:
                graph[target_id].append(Edge(source_id, length_m, shared_tags))
            used_nodes.update((source_id, target_id))

    nodes = {node_id: all_nodes[node_id] for node_id in used_nodes}
    return RoutingNetwork(nodes=nodes, graph=dict(graph))
