from __future__ import annotations

from dataclasses import dataclass
from typing import Mapping

from .profile import CostProfile
from .routing import Edge, Graph, Node, Route, find_route, straight_line_m


@dataclass(frozen=True)
class RoutedPath:
    route: Route
    coordinates: tuple[tuple[float, float], ...]
    start_node: Node
    goal_node: Node


@dataclass(frozen=True)
class RoutingNetwork:
    nodes: Mapping[int, Node]
    graph: Graph

    def nearest_node(self, lat: float, lon: float) -> tuple[Node, float]:
        if not self.nodes:
            raise ValueError("routing network is empty")

        point = Node(-1, lat, lon)
        node = min(self.nodes.values(), key=lambda candidate: straight_line_m(point, candidate))
        return node, straight_line_m(point, node)

    def route_coordinates(
        self,
        start_lat: float,
        start_lon: float,
        goal_lat: float,
        goal_lon: float,
        profile: CostProfile | None = None,
    ) -> RoutedPath | None:
        start, _ = self.nearest_node(start_lat, start_lon)
        goal, _ = self.nearest_node(goal_lat, goal_lon)
        route = find_route(self.nodes, self.graph, start.id, goal.id, profile)
        if route is None:
            return None

        coordinates = tuple(
            (self.nodes[node_id].lon, self.nodes[node_id].lat)
            for node_id in route.node_ids
        )
        return RoutedPath(route, coordinates, start, goal)

    @property
    def bounds(self) -> tuple[float, float, float, float]:
        if not self.nodes:
            raise ValueError("routing network is empty")
        lats = [node.lat for node in self.nodes.values()]
        lons = [node.lon for node in self.nodes.values()]
        return min(lats), min(lons), max(lats), max(lons)

