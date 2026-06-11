import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parents[1] / "src"))

from yardnav.osm import load_osm_xml


class OsmImportTests(unittest.TestCase):
    def test_loads_walkable_ways_and_skips_private_ways(self) -> None:
        xml = """<?xml version="1.0"?>
        <osm version="0.6">
          <node id="1" lat="50.0" lon="30.0"/>
          <node id="2" lat="50.0" lon="30.001"/>
          <node id="3" lat="50.0" lon="30.002"/>
          <way id="10">
            <nd ref="1"/><nd ref="2"/>
            <tag k="highway" v="path"/>
          </way>
          <way id="11">
            <nd ref="2"/><nd ref="3"/>
            <tag k="highway" v="service"/>
            <tag k="access" v="private"/>
          </way>
        </osm>
        """
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "map.osm"
            path.write_text(xml, encoding="utf-8")
            network = load_osm_xml(path)

        self.assertEqual(set(network.nodes), {1, 2})
        self.assertEqual(network.graph[1][0].target, 2)
        self.assertEqual(network.graph[2][0].target, 1)

    def test_respects_foot_oneway(self) -> None:
        xml = """<?xml version="1.0"?>
        <osm version="0.6">
          <node id="1" lat="50.0" lon="30.0"/>
          <node id="2" lat="50.0" lon="30.001"/>
          <way id="10">
            <nd ref="1"/><nd ref="2"/>
            <tag k="highway" v="path"/>
            <tag k="oneway:foot" v="yes"/>
          </way>
        </osm>
        """
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "map.osm"
            path.write_text(xml, encoding="utf-8")
            network = load_osm_xml(path)

        self.assertIn(1, network.graph)
        self.assertNotIn(2, network.graph)

    def test_marks_parallel_footway_as_roadside(self) -> None:
        xml = """<?xml version="1.0"?>
        <osm version="0.6">
          <node id="1" lat="50.0000" lon="30.0000"/>
          <node id="2" lat="50.0000" lon="30.0020"/>
          <node id="3" lat="50.0001" lon="30.0000"/>
          <node id="4" lat="50.0001" lon="30.0020"/>
          <way id="10">
            <nd ref="1"/><nd ref="2"/>
            <tag k="highway" v="residential"/>
          </way>
          <way id="11">
            <nd ref="3"/><nd ref="4"/>
            <tag k="highway" v="footway"/>
          </way>
        </osm>
        """
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "map.osm"
            path.write_text(xml, encoding="utf-8")
            network = load_osm_xml(path)

        self.assertEqual(network.graph[3][0].tags["yardnav:roadside"], "yes")

    def test_marks_service_road_away_from_public_road_as_interior(self) -> None:
        xml = """<?xml version="1.0"?>
        <osm version="0.6">
          <node id="1" lat="50.0000" lon="30.0000"/>
          <node id="2" lat="50.0000" lon="30.0020"/>
          <node id="3" lat="50.0010" lon="30.0000"/>
          <node id="4" lat="50.0010" lon="30.0020"/>
          <way id="10">
            <nd ref="1"/><nd ref="2"/>
            <tag k="highway" v="residential"/>
          </way>
          <way id="11">
            <nd ref="3"/><nd ref="4"/>
            <tag k="highway" v="service"/>
          </way>
        </osm>
        """
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "map.osm"
            path.write_text(xml, encoding="utf-8")
            network = load_osm_xml(path)

        self.assertEqual(network.graph[3][0].tags["yardnav:interior"], "yes")

    def test_copies_crossing_type_from_node_to_footway_edge(self) -> None:
        xml = """<?xml version="1.0"?>
        <osm version="0.6">
          <node id="1" lat="50.0000" lon="30.0000"/>
          <node id="2" lat="50.0001" lon="30.0000">
            <tag k="highway" v="crossing"/>
            <tag k="crossing" v="unmarked"/>
          </node>
          <node id="3" lat="50.0002" lon="30.0000"/>
          <way id="10">
            <nd ref="1"/><nd ref="2"/><nd ref="3"/>
            <tag k="highway" v="footway"/>
          </way>
        </osm>
        """
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "map.osm"
            path.write_text(xml, encoding="utf-8")
            network = load_osm_xml(path)

        self.assertEqual(network.graph[1][0].tags["crossing"], "unmarked")
        self.assertEqual(
            network.graph[1][0].tags["yardnav:crossing_node"],
            "yes",
        )

    def test_loads_directory_and_deduplicates_way_ids(self) -> None:
        xml = """<?xml version="1.0"?>
        <osm version="0.6">
          <node id="1" lat="50.0" lon="30.0"/>
          <node id="2" lat="50.0" lon="30.001"/>
          <way id="10">
            <nd ref="1"/><nd ref="2"/>
            <tag k="highway" v="path"/>
          </way>
        </osm>
        """
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)
            (path / "a.osm").write_text(xml, encoding="utf-8")
            (path / "b.osm").write_text(xml, encoding="utf-8")
            network = load_osm_xml(path)

        self.assertEqual(len(network.graph[1]), 1)
        self.assertEqual(len(network.graph[2]), 1)

    def test_reuses_tags_for_opposite_edges(self) -> None:
        xml = """<?xml version="1.0"?>
        <osm version="0.6">
          <node id="1" lat="50.0" lon="30.0"/>
          <node id="2" lat="50.0" lon="30.001"/>
          <way id="10">
            <nd ref="1"/><nd ref="2"/>
            <tag k="highway" v="path"/>
            <tag k="surface" v="ground"/>
          </way>
        </osm>
        """
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "map.osm"
            path.write_text(xml, encoding="utf-8")
            network = load_osm_xml(path)

        self.assertIs(network.graph[1][0].tags, network.graph[2][0].tags)


if __name__ == "__main__":
    unittest.main()
