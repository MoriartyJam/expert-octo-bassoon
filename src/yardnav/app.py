from __future__ import annotations

import argparse
import os
from pathlib import Path
from typing import Any

from flask import Flask, jsonify, render_template, request

from .network import RoutedPath, RoutingNetwork
from .osm import PUBLIC_ROADS, load_osm_xml
from .profile import (
    EXPERIMENTAL_PROFILE,
    CostProfile,
    MTB_PROFILE,
    estimated_speed_kmh,
)


PACKAGE_DIR = Path(__file__).parent
DEFAULT_OSM_PATH = PACKAGE_DIR.parents[1] / "data" / "kyiv"
KYIV_BOUNDS = (50.2132422, 30.2361453, 50.5908142, 30.8263593)


def _number(payload: dict[str, Any], name: str) -> float:
    value = payload.get(name)
    if isinstance(value, bool):
        raise ValueError(f"{name} must be a number")
    try:
        return float(value)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"{name} must be a number") from exc


def _route_feature(
    results: list[RoutedPath],
    mode: str,
    profile: CostProfile,
) -> dict[str, Any]:
    coordinates: list[tuple[float, float]] = []
    edges = []
    node_count = 0
    distance_m = 0.0
    generalized_cost = 0.0
    for index, result in enumerate(results):
        coordinates.extend(result.coordinates[index > 0 :])
        edges.extend(result.route.edges)
        node_count += len(result.route.node_ids) - (1 if index > 0 else 0)
        distance_m += result.route.distance_m
        generalized_cost += result.route.generalized_cost

    roadside_distance = sum(
        edge.length_m
        for edge in edges
        if edge.tags.get("yardnav:roadside") == "yes"
    )
    interior_distance = sum(
        edge.length_m
        for edge in edges
        if edge.tags.get("yardnav:interior") == "yes"
        or edge.tags.get("yard") == "yes"
    )
    public_road_distance = sum(
        edge.length_m
        for edge in edges
        if edge.tags.get("highway") in PUBLIC_ROADS
    )
    signal_crossings = sum(
        1
        for edge in edges
        if edge.tags.get("crossing") == "traffic_signals"
        or edge.tags.get("crossing:signals") == "yes"
    )
    informal_crossings = sum(
        1
        for edge in edges
        if edge.tags.get("crossing") in {"unmarked", "informal"}
    )
    duration_hours = sum(
        edge.length_m / 1000 / estimated_speed_kmh(edge.tags, profile)
        for edge in edges
    )
    duration_min = duration_hours * 60
    average_speed_kmh = (
        distance_m / 1000 / duration_hours if duration_hours else 0.0
    )
    kerb_edges = len(
        {
            edge.tags.get("yardnav:kerb_node", f"edge:{index}")
            for index, edge in enumerate(edges)
            if edge.tags.get("yardnav:kerb")
        }
    )
    barrier_edges = len(
        {
            edge.tags.get("yardnav:barrier_node", f"edge:{index}")
            for index, edge in enumerate(edges)
            if edge.tags.get("yardnav:barrier")
            and edge.tags.get("yardnav:barrier") != "kerb"
        }
    )
    stairs_distance = sum(
        edge.length_m
        for edge in edges
        if edge.tags.get("highway") == "steps"
    )
    return {
        "type": "Feature",
        "geometry": {
            "type": "LineString",
            "coordinates": coordinates,
        },
        "properties": {
            "distance_m": round(distance_m),
            "generalized_cost": round(generalized_cost, 1),
            "profile": mode,
            "duration_min": round(duration_min, 1),
            "average_speed_kmh": round(average_speed_kmh, 1),
            "meets_speed_target": (
                average_speed_kmh >= 10.0 if mode == "mtb" else None
            ),
            "node_count": node_count,
            "via_count": max(0, len(results) - 1),
            "roadside_distance_m": round(roadside_distance),
            "interior_distance_m": round(interior_distance),
            "public_road_distance_m": round(public_road_distance),
            "signal_crossing_edges": signal_crossings,
            "informal_crossing_edges": informal_crossings,
            "kerb_edges": kerb_edges,
            "barrier_edges": barrier_edges,
            "stairs_distance_m": round(stairs_distance),
            "snapped_start": {
                "lat": results[0].start_node.lat,
                "lon": results[0].start_node.lon,
            },
            "snapped_goal": {
                "lat": results[-1].goal_node.lat,
                "lon": results[-1].goal_node.lon,
            },
        },
    }


def create_app(
    network: RoutingNetwork | None = None,
    osm_path: str | Path | None = None,
) -> Flask:
    app = Flask(
        __name__,
        template_folder=str(PACKAGE_DIR / "templates"),
        static_folder=str(PACKAGE_DIR / "static"),
    )
    source = Path(osm_path or os.environ.get("YARDNAV_OSM_PATH", DEFAULT_OSM_PATH))
    source_bounds = KYIV_BOUNDS if source.resolve() == DEFAULT_OSM_PATH.resolve() else None
    routing_network = network or load_osm_xml(source, bounds=source_bounds)
    app.config["ROUTING_NETWORK"] = routing_network
    app.config["OSM_PATH"] = str(source)

    @app.get("/")
    def index() -> str:
        south, west, north, east = routing_network.bounds
        return render_template(
            "index.html",
            center_lat=(south + north) / 2,
            center_lon=(west + east) / 2,
            bounds=[south, west, north, east],
        )

    @app.get("/api/health")
    def health():
        edge_count = sum(len(edges) for edges in routing_network.graph.values())
        return jsonify(
            {
                "status": "ok",
                "nodes": len(routing_network.nodes),
                "directed_edges": edge_count,
                "source": app.config["OSM_PATH"],
            }
        )

    @app.post("/api/route")
    def route():
        payload = request.get_json(silent=True)
        if not isinstance(payload, dict):
            return jsonify({"error": "JSON object is required"}), 400

        try:
            start_lat = _number(payload, "start_lat")
            start_lon = _number(payload, "start_lon")
            goal_lat = _number(payload, "goal_lat")
            goal_lon = _number(payload, "goal_lon")
        except ValueError as exc:
            return jsonify({"error": str(exc)}), 400

        mode = payload.get("profile", "mtb")
        profiles = {
            "walk": CostProfile(),
            "mtb": MTB_PROFILE,
            "experimental": EXPERIMENTAL_PROFILE,
        }
        if mode not in profiles:
            return jsonify(
                {"error": "profile must be walk, mtb or experimental"}
            ), 400
        profile = profiles[mode]
        result = routing_network.route_coordinates(
            start_lat,
            start_lon,
            goal_lat,
            goal_lon,
            profile,
        )
        if result is None:
            return jsonify({"error": "No connected pedestrian route found"}), 404

        return jsonify(_route_feature([result], mode, profile))

    @app.post("/api/custom-route")
    def custom_route():
        payload = request.get_json(silent=True)
        if not isinstance(payload, dict):
            return jsonify({"error": "JSON object is required"}), 400
        points = payload.get("points")
        if not isinstance(points, list) or not 2 <= len(points) <= 20:
            return jsonify({"error": "points must contain 2 to 20 coordinates"}), 400

        parsed_points: list[tuple[float, float]] = []
        try:
            for point in points:
                if not isinstance(point, dict):
                    raise ValueError("each point must be an object")
                parsed_points.append(
                    (
                        _number(point, "lat"),
                        _number(point, "lon"),
                    )
                )
        except ValueError as exc:
            return jsonify({"error": str(exc)}), 400

        results: list[RoutedPath] = []
        for index, (start, goal) in enumerate(
            zip(parsed_points, parsed_points[1:]),
            start=1,
        ):
            result = routing_network.route_coordinates(
                start[0],
                start[1],
                goal[0],
                goal[1],
                EXPERIMENTAL_PROFILE,
            )
            if result is None:
                return jsonify(
                    {"error": f"No route found between custom points {index} and {index + 1}"}
                ), 404
            results.append(result)

        return jsonify(
            _route_feature(results, "custom_experimental", EXPERIMENTAL_PROFILE)
        )

    return app


def main() -> None:
    parser = argparse.ArgumentParser(description="Run the YardNav development server")
    parser.add_argument("--osm", type=Path, default=None, help="path to an OSM XML extract")
    parser.add_argument("--host", default=os.environ.get("HOST", "0.0.0.0"))
    parser.add_argument(
        "--port",
        type=int,
        default=int(os.environ.get("PORT", "8000")),
    )
    args = parser.parse_args()
    create_app(osm_path=args.osm).run(
        host=args.host,
        port=args.port,
        debug=False,
        use_reloader=False,
    )


if __name__ == "__main__":
    main()
