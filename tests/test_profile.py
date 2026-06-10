import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parents[1] / "src"))

from yardnav.profile import (
    EXPERIMENTAL_PROFILE,
    MTB_PROFILE,
    edge_cost,
    estimated_speed_kmh,
)


class EdgeCostTests(unittest.TestCase):
    def test_yard_is_preferred_over_major_road(self) -> None:
        yard = edge_cost(100, {"highway": "service", "yardnav:interior": "yes"})
        major = edge_cost(100, {"highway": "primary"})
        self.assertLess(yard, major)

    def test_roadside_footway_is_more_expensive_than_driveway(self) -> None:
        roadside = edge_cost(
            100,
            {"highway": "footway", "yardnav:roadside": "yes"},
        )
        driveway = edge_cost(100, {"highway": "service", "service": "driveway"})
        self.assertGreater(roadside, driveway)

    def test_public_residential_road_is_more_expensive_than_driveway(self) -> None:
        public_road = edge_cost(100, {"highway": "residential"})
        driveway = edge_cost(100, {"highway": "service", "service": "driveway"})
        self.assertGreater(public_road, driveway)

    def test_unmarked_crossing_is_preferred_over_signal(self) -> None:
        unmarked = edge_cost(
            20,
            {"highway": "footway", "footway": "crossing", "crossing": "unmarked"},
        )
        signal = edge_cost(
            20,
            {
                "highway": "footway",
                "footway": "crossing",
                "crossing": "traffic_signals",
            },
        )
        self.assertLess(unmarked, signal)

    def test_mtb_blocks_steps_without_bicycle_ramp(self) -> None:
        self.assertEqual(
            edge_cost(20, {"highway": "steps"}, MTB_PROFILE),
            float("inf"),
        )

    def test_mtb_allows_steps_with_bicycle_ramp(self) -> None:
        self.assertLess(
            edge_cost(
                20,
                {"highway": "steps", "ramp:bicycle": "yes"},
                MTB_PROFILE,
            ),
            float("inf"),
        )

    def test_mtb_penalizes_raised_kerb(self) -> None:
        clear = edge_cost(20, {"highway": "path"}, MTB_PROFILE)
        kerb = edge_cost(
            20,
            {"highway": "path", "yardnav:kerb": "raised"},
            MTB_PROFILE,
        )
        self.assertGreater(kerb, clear)

    def test_mtb_fast_path_exceeds_ten_kmh(self) -> None:
        speed = estimated_speed_kmh(
            {"highway": "track", "surface": "compacted"},
            MTB_PROFILE,
        )
        self.assertGreaterEqual(speed, 10)

    def test_experimental_prefers_path_over_service_road(self) -> None:
        path = edge_cost(100, {"highway": "path"}, EXPERIMENTAL_PROFILE)
        service = edge_cost(100, {"highway": "service"}, EXPERIMENTAL_PROFILE)
        self.assertLess(path, service)

    def test_experimental_does_not_discount_interior_service_road(self) -> None:
        path = edge_cost(140, {"highway": "path"}, EXPERIMENTAL_PROFILE)
        service = edge_cost(
            60,
            {"highway": "service", "yardnav:interior": "yes"},
            EXPERIMENTAL_PROFILE,
        )
        self.assertLess(path, service)

    def test_experimental_blocks_steps_without_bicycle_ramp(self) -> None:
        self.assertEqual(
            edge_cost(20, {"highway": "steps"}, EXPERIMENTAL_PROFILE),
            float("inf"),
        )

    def test_private_path_is_blocked_without_foot_access(self) -> None:
        cost = edge_cost(20, {"highway": "service", "access": "private"})
        self.assertEqual(cost, float("inf"))

    def test_private_path_can_have_explicit_foot_access(self) -> None:
        cost = edge_cost(
            20,
            {"highway": "service", "access": "private", "foot": "permissive"},
        )
        self.assertLess(cost, float("inf"))

    def test_proposed_road_is_not_walkable(self) -> None:
        cost = edge_cost(20, {"highway": "proposed", "proposed": "footway"})
        self.assertEqual(cost, float("inf"))


if __name__ == "__main__":
    unittest.main()
