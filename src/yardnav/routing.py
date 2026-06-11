from __future__ import annotations

from dataclasses import dataclass
from heapq import heappop, heappush
from math import cos, hypot, radians
from typing import Mapping, Sequence

from .profile import CostProfile, Tags, edge_cost


@dataclass(frozen=True, slots=True)
class Node:
    id: int
    lat: float
    lon: float


@dataclass(frozen=True, slots=True)
class Edge:
    target: int
    length_m: float
    tags: Tags


@dataclass(frozen=True, slots=True)
class Route:
    node_ids: tuple[int, ...]
    distance_m: float
    generalized_cost: float
    edges: tuple[Edge, ...] = ()


Graph = Mapping[int, Sequence[Edge]]


def _straight_line_m(a: Node, b: Node) -> float:
    mean_lat = radians((a.lat + b.lat) / 2)
    dx = (a.lon - b.lon) * 111_320 * cos(mean_lat)
    dy = (a.lat - b.lat) * 110_540
    return hypot(dx, dy)


def straight_line_m(a: Node, b: Node) -> float:
    """Return an approximate local distance between two WGS84 points."""
    return _straight_line_m(a, b)


def find_route(
    nodes: Mapping[int, Node],
    graph: Graph,
    start: int,
    goal: int,
    profile: CostProfile | None = None,
) -> Route | None:
    """Find a minimum generalized-cost route using A*."""
    if start not in nodes or goal not in nodes:
        raise KeyError("start and goal must exist in nodes")
    if start == goal:
        return Route((start,), 0.0, 0.0, ())

    p = profile or CostProfile()
    minimum_factor = min(
        p.yard_factor,
        p.footway_factor,
        p.path_factor,
        p.track_factor,
        p.service_factor,
    )
    frontier: list[tuple[float, int]] = [(0.0, start)]
    best_cost = {start: 0.0}
    distance = {start: 0.0}
    parent: dict[int, tuple[int, Edge]] = {}

    while frontier:
        _, current = heappop(frontier)
        if current == goal:
            path = [goal]
            path_edges: list[Edge] = []
            while path[-1] != start:
                previous, edge = parent[path[-1]]
                path_edges.append(edge)
                path.append(previous)
            path.reverse()
            path_edges.reverse()
            return Route(
                tuple(path),
                distance[goal],
                best_cost[goal],
                tuple(path_edges),
            )

        current_cost = best_cost[current]
        for edge in graph.get(current, ()):
            if edge.target not in nodes:
                continue
            step_cost = edge_cost(edge.length_m, edge.tags, p)
            candidate = current_cost + step_cost
            if candidate >= best_cost.get(edge.target, float("inf")):
                continue

            best_cost[edge.target] = candidate
            distance[edge.target] = distance[current] + edge.length_m
            parent[edge.target] = (current, edge)
            heuristic = _straight_line_m(nodes[edge.target], nodes[goal]) * minimum_factor
            heappush(frontier, (candidate + heuristic, edge.target))

    return None
