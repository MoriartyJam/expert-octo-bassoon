import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parents[1] / "src"))

from yardnav.profile import EXPERIMENTAL_PROFILE
from yardnav.routing import Edge, Node, find_route


class RoutingTests(unittest.TestCase):
    def test_prefers_longer_yard_route_over_major_road(self) -> None:
        nodes = {
            1: Node(1, 50.4500, 30.5200),
            2: Node(2, 50.4500, 30.5210),
            3: Node(3, 50.4505, 30.5205),
            4: Node(4, 50.4500, 30.5220),
        }
        graph = {
            1: [
                Edge(2, 70, {"highway": "primary"}),
                Edge(3, 100, {"highway": "service", "service": "driveway"}),
            ],
            2: [Edge(4, 70, {"highway": "primary"})],
            3: [Edge(4, 100, {"highway": "path"})],
        }

        route = find_route(nodes, graph, 1, 4)

        self.assertIsNotNone(route)
        self.assertEqual(route.node_ids, (1, 3, 4))
        self.assertEqual(route.distance_m, 200)

    def test_returns_none_for_disconnected_graph(self) -> None:
        nodes = {
            1: Node(1, 50.45, 30.52),
            2: Node(2, 50.46, 30.53),
        }
        self.assertIsNone(find_route(nodes, {}, 1, 2))

    def test_experimental_prefers_longer_path_over_shorter_yard_road(self) -> None:
        nodes = {
            1: Node(1, 50.4500, 30.5200),
            2: Node(2, 50.4500, 30.5210),
            3: Node(3, 50.4505, 30.5205),
            4: Node(4, 50.4500, 30.5220),
        }
        graph = {
            1: [
                Edge(
                    2,
                    60,
                    {"highway": "service", "yardnav:interior": "yes"},
                ),
                Edge(3, 100, {"highway": "path", "surface": "ground"}),
            ],
            2: [
                Edge(
                    4,
                    60,
                    {"highway": "service", "yardnav:interior": "yes"},
                ),
            ],
            3: [Edge(4, 100, {"highway": "path", "surface": "ground"})],
        }

        route = find_route(nodes, graph, 1, 4, EXPERIMENTAL_PROFILE)

        self.assertIsNotNone(route)
        self.assertEqual(route.node_ids, (1, 3, 4))


if __name__ == "__main__":
    unittest.main()
