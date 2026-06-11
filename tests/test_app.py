import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parents[1] / "src"))

from yardnav.app import create_app
from yardnav.network import RoutingNetwork
from yardnav.routing import Edge, Node


class AppTests(unittest.TestCase):
    def setUp(self) -> None:
        network = RoutingNetwork(
            nodes={
                1: Node(1, 50.45, 30.52),
                2: Node(2, 50.451, 30.521),
                3: Node(3, 50.452, 30.522),
            },
            graph={
                1: [Edge(2, 150, {"highway": "path"})],
                2: [
                    Edge(1, 150, {"highway": "path"}),
                    Edge(3, 170, {"highway": "path"}),
                ],
                3: [Edge(2, 170, {"highway": "path"})],
            },
        )
        self.client = create_app(network=network).test_client()

    def test_health(self) -> None:
        response = self.client.get("/api/health")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json["nodes"], 3)

    def test_mobile_navigation_controls_are_rendered(self) -> None:
        response = self.client.get("/")
        html = response.get_data(as_text=True)
        self.assertEqual(response.status_code, 200)
        for element_id in (
            "quick-locate",
            "track",
            "wake-lock",
            "voice-guidance",
            "custom-controls",
            "build-custom",
            "navigation-banner",
            "maneuver-icon",
            "maneuver-instruction",
            "following-maneuver",
            "route-direction-hint",
        ):
            self.assertIn(f'id="{element_id}"', html)
        self.assertIn("manifest.webmanifest", html)

    def test_returns_geojson_route(self) -> None:
        response = self.client.post(
            "/api/route",
            json={
                "start_lat": 50.45,
                "start_lon": 30.52,
                "goal_lat": 50.451,
                "goal_lon": 30.521,
                "profile": "mtb",
            },
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json["geometry"]["type"], "LineString")
        self.assertEqual(response.json["properties"]["distance_m"], 150)
        self.assertEqual(response.json["properties"]["roadside_distance_m"], 0)
        self.assertEqual(response.json["properties"]["public_road_distance_m"], 0)
        self.assertEqual(response.json["properties"]["stairs_distance_m"], 0)

    def test_rejects_missing_coordinate(self) -> None:
        response = self.client.post("/api/route", json={"start_lat": 50.45})
        self.assertEqual(response.status_code, 400)

    def test_custom_route_passes_through_points_in_order(self) -> None:
        response = self.client.post(
            "/api/custom-route",
            json={
                "points": [
                    {"lat": 50.45, "lon": 30.52},
                    {"lat": 50.451, "lon": 30.521},
                    {"lat": 50.452, "lon": 30.522},
                ],
            },
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json["properties"]["profile"], "custom_experimental")
        self.assertEqual(response.json["properties"]["distance_m"], 320)
        self.assertEqual(response.json["properties"]["via_count"], 1)
        self.assertEqual(len(response.json["geometry"]["coordinates"]), 3)

    def test_custom_route_requires_at_least_two_points(self) -> None:
        response = self.client.post(
            "/api/custom-route",
            json={"points": [{"lat": 50.45, "lon": 30.52}]},
        )
        self.assertEqual(response.status_code, 400)


class ProductionStartupTests(unittest.TestCase):
    def test_default_app_starts_without_loading_all_kyiv_tiles(self) -> None:
        app = create_app()
        response = app.test_client().get("/api/health")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json["nodes"], 0)
        self.assertEqual(response.json["loaded_tiles"], [])


if __name__ == "__main__":
    unittest.main()
