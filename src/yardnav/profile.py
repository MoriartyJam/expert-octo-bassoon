from __future__ import annotations

from dataclasses import dataclass
from typing import Mapping


Tags = Mapping[str, str]


@dataclass(frozen=True)
class CostProfile:
    """Tunable preferences for yard-first pedestrian routing."""

    mode: str = "walk"
    yard_factor: float = 0.70
    footway_factor: float = 0.90
    path_factor: float = 0.80
    track_factor: float = 0.85
    living_street_factor: float = 2.00
    residential_factor: float = 4.50
    public_road_factor: float = 5.00
    service_factor: float = 1.40
    driveway_factor: float = 1.35
    parking_aisle_factor: float = 1.20
    sidewalk_factor: float = 2.20
    roadside_footway_factor: float = 4.00
    roadside_path_factor: float = 3.80
    major_road_factor: float = 6.00
    informal_crossing_penalty_m: float = 15.0
    uncontrolled_crossing_penalty_m: float = 35.0
    marked_crossing_penalty_m: float = 50.0
    signal_crossing_penalty_m: float = 120.0
    crossing_penalty_m: float = 55.0
    major_road_crossing_penalty_m: float = 100.0
    unlit_penalty_factor: float = 1.15
    poor_surface_factor: float = 1.20
    stairs_factor: float = 1.35
    kerb_penalty_m: float = 0.0
    barrier_penalty_m: float = 0.0


MTB_PROFILE = CostProfile(
    mode="mtb",
    yard_factor=0.75,
    footway_factor=1.25,
    path_factor=0.75,
    track_factor=0.70,
    living_street_factor=1.20,
    residential_factor=2.80,
    public_road_factor=3.80,
    service_factor=0.90,
    driveway_factor=0.85,
    parking_aisle_factor=1.05,
    sidewalk_factor=2.20,
    roadside_footway_factor=3.20,
    roadside_path_factor=2.60,
    major_road_factor=5.50,
    informal_crossing_penalty_m=25.0,
    uncontrolled_crossing_penalty_m=50.0,
    marked_crossing_penalty_m=70.0,
    signal_crossing_penalty_m=180.0,
    crossing_penalty_m=80.0,
    major_road_crossing_penalty_m=180.0,
    poor_surface_factor=1.35,
    stairs_factor=float("inf"),
    kerb_penalty_m=140.0,
    barrier_penalty_m=180.0,
)

EXPERIMENTAL_PROFILE = CostProfile(
    mode="experimental",
    yard_factor=1.30,
    footway_factor=0.32,
    path_factor=0.25,
    track_factor=0.35,
    living_street_factor=2.20,
    residential_factor=4.50,
    public_road_factor=4.20,
    service_factor=1.60,
    driveway_factor=1.80,
    parking_aisle_factor=2.00,
    sidewalk_factor=1.40,
    roadside_footway_factor=1.20,
    roadside_path_factor=0.90,
    major_road_factor=6.00,
    informal_crossing_penalty_m=10.0,
    uncontrolled_crossing_penalty_m=25.0,
    marked_crossing_penalty_m=40.0,
    signal_crossing_penalty_m=100.0,
    crossing_penalty_m=45.0,
    major_road_crossing_penalty_m=160.0,
    poor_surface_factor=1.05,
    stairs_factor=float("inf"),
    kerb_penalty_m=20.0,
    barrier_penalty_m=40.0,
)


MAJOR_ROADS = {
    "motorway",
    "motorway_link",
    "trunk",
    "trunk_link",
    "primary",
    "primary_link",
    "secondary",
    "secondary_link",
}

POOR_SURFACES = {
    "bad",
    "very_bad",
    "horrible",
    "very_horrible",
    "impassable",
    "mud",
    "sand",
}

FAST_MTB_SURFACES = {
    "asphalt",
    "compacted",
    "concrete",
    "concrete:plates",
    "fine_gravel",
    "paving_stones",
}

SLOW_MTB_SURFACES = {
    "cobblestone",
    "grass",
    "gravel",
    "ground",
    "pebblestone",
    "sett",
    "unpaved",
}

WALKABLE_HIGHWAYS = {
    "bridleway",
    "corridor",
    "crossing",
    "footway",
    "living_street",
    "path",
    "pedestrian",
    "platform",
    "primary",
    "primary_link",
    "residential",
    "road",
    "secondary",
    "secondary_link",
    "service",
    "steps",
    "tertiary",
    "tertiary_link",
    "track",
    "trunk",
    "trunk_link",
    "unclassified",
}

BIKEABLE_HIGHWAYS = {
    "bridleway",
    "cycleway",
    "footway",
    "living_street",
    "path",
    "pedestrian",
    "primary",
    "primary_link",
    "residential",
    "road",
    "secondary",
    "secondary_link",
    "service",
    "steps",
    "tertiary",
    "tertiary_link",
    "track",
    "trunk",
    "trunk_link",
    "unclassified",
}


def is_walkable(tags: Tags) -> bool:
    if tags.get("access") in {"no", "private"}:
        return tags.get("foot") in {"yes", "designated", "permissive"}
    if tags.get("foot") == "no":
        return False
    if tags.get("highway") in {"motorway", "motorway_link"}:
        return tags.get("foot") == "yes"
    if tags.get("highway") == "cycleway":
        return tags.get("foot") in {"yes", "designated", "permissive"}
    return tags.get("highway") in WALKABLE_HIGHWAYS


def is_bikeable(tags: Tags) -> bool:
    if tags.get("bicycle") in {"no", "dismount"}:
        return False
    if tags.get("access") in {"no", "private"}:
        return tags.get("bicycle") in {"yes", "designated", "permissive"}
    if tags.get("highway") in {"motorway", "motorway_link"}:
        return False
    if tags.get("highway") == "steps":
        return tags.get("ramp:bicycle") in {"yes", "designated"}
    if tags.get("highway") in {"footway", "pedestrian"}:
        return tags.get("bicycle") != "no"
    return tags.get("highway") in BIKEABLE_HIGHWAYS


def edge_cost(length_m: float, tags: Tags, profile: CostProfile | None = None) -> float:
    """Return generalized distance in meters for one walkable graph edge."""
    if length_m < 0:
        raise ValueError("length_m cannot be negative")
    p = profile or CostProfile()
    bicycle_mode = p.mode in {"mtb", "experimental"}
    if bicycle_mode:
        if not is_bikeable(tags):
            return float("inf")
    elif not is_walkable(tags):
        return float("inf")

    highway = tags.get("highway", "")
    service = tags.get("service", "")

    if bicycle_mode:
        if tags.get("bicycle") in {"no", "dismount"}:
            return float("inf")
        if highway == "steps" and tags.get("ramp:bicycle") not in {
            "yes",
            "designated",
        }:
            return float("inf")

    if (
        tags.get("yard") == "yes"
        or tags.get("yardnav:interior") == "yes"
    ) and p.mode != "experimental":
        factor = p.yard_factor
    elif highway == "path":
        factor = (
            p.roadside_path_factor
            if tags.get("yardnav:roadside") == "yes"
            else p.path_factor
        )
    elif highway == "track":
        factor = p.track_factor
    elif highway in {"footway", "pedestrian"}:
        factor = (
            p.roadside_footway_factor
            if tags.get("yardnav:roadside") == "yes"
            else p.footway_factor
        )
    elif highway == "steps":
        factor = 1.80 if bicycle_mode else p.stairs_factor
    elif highway == "cycleway":
        factor = 0.75 if bicycle_mode else p.sidewalk_factor
    elif highway == "service" and service == "driveway":
        factor = p.driveway_factor
    elif highway == "service" and service == "parking_aisle":
        factor = p.parking_aisle_factor
    elif highway == "service":
        factor = p.service_factor
    elif highway == "living_street":
        factor = p.living_street_factor
    elif highway == "residential":
        factor = p.residential_factor
    elif highway in MAJOR_ROADS:
        factor = p.major_road_factor
    elif highway in {"road", "tertiary", "tertiary_link", "unclassified"}:
        factor = p.public_road_factor
    else:
        factor = p.sidewalk_factor

    if tags.get("footway") in {"sidewalk", "sidewalk:right", "sidewalk:left"}:
        factor = max(factor, p.sidewalk_factor)
    if tags.get("lit") == "no":
        factor *= p.unlit_penalty_factor
    if tags.get("smoothness") in POOR_SURFACES or tags.get("surface") in POOR_SURFACES:
        factor *= p.poor_surface_factor
    if bicycle_mode:
        surface = tags.get("surface", "")
        if surface in FAST_MTB_SURFACES:
            factor *= 0.85
        elif surface in SLOW_MTB_SURFACES:
            factor *= 1.10
        if tags.get("smoothness") in {"bad", "very_bad", "horrible"}:
            factor *= 1.25
        if tags.get("tracktype") in {"grade4", "grade5"}:
            factor *= 1.20

    cost = length_m * factor
    if bicycle_mode:
        speed = estimated_speed_kmh(tags, p)
        if p.mode == "mtb" and speed < 10.0:
            cost += length_m * (10.0 / speed - 1.0) * 2.0
        kerb = tags.get("yardnav:kerb", tags.get("kerb", ""))
        if kerb in {"raised", "yes", "regular", "unknown"}:
            cost += p.kerb_penalty_m
        elif kerb in {"lowered", "rolled"}:
            cost += p.kerb_penalty_m * 0.20
        barrier = tags.get("yardnav:barrier", tags.get("barrier", ""))
        if barrier in {"cycle_barrier", "bollard", "block", "gate", "lift_gate"}:
            if tags.get("bicycle") not in {"yes", "designated"}:
                cost += p.barrier_penalty_m
    if (
        tags.get("footway") == "crossing"
        or tags.get("highway") == "crossing"
        or tags.get("yardnav:crossing_node") == "yes"
    ):
        crossing = tags.get("crossing", "")
        if crossing == "traffic_signals" or tags.get("crossing:signals") == "yes":
            penalty = p.signal_crossing_penalty_m
        elif crossing in {"unmarked", "informal"}:
            penalty = p.informal_crossing_penalty_m
        elif crossing == "uncontrolled":
            penalty = p.uncontrolled_crossing_penalty_m
        elif crossing in {"marked", "zebra"}:
            penalty = p.marked_crossing_penalty_m
        else:
            penalty = p.crossing_penalty_m
        if tags.get("yardnav:crossing_node") == "yes":
            penalty /= 2
        cost += penalty
        if tags.get("crossing:road") in MAJOR_ROADS:
            cost += p.major_road_crossing_penalty_m
    return cost


def estimated_speed_kmh(tags: Tags, profile: CostProfile | None = None) -> float:
    """Estimate moving speed for route duration reporting."""
    p = profile or CostProfile()
    if p.mode not in {"mtb", "experimental"}:
        return 4.8

    highway = tags.get("highway", "")
    surface = tags.get("surface", "")
    if highway == "steps":
        return 4.0
    if highway in {"track", "path"}:
        speed = 14.0
    elif highway in {"service", "living_street", "residential"}:
        speed = 16.0
    elif highway in {"footway", "pedestrian"}:
        speed = 11.0
    else:
        speed = 14.0

    if surface in FAST_MTB_SURFACES:
        speed += 2.0
    elif surface in SLOW_MTB_SURFACES:
        speed -= 2.0
    elif surface in POOR_SURFACES:
        speed -= 5.0
    if tags.get("smoothness") in {"bad", "very_bad", "horrible"}:
        speed -= 3.0
    if tags.get("tracktype") in {"grade4", "grade5"}:
        speed -= 2.0
    if tags.get("yardnav:roadside") == "yes":
        speed = min(speed, 12.0)
    if tags.get("yardnav:kerb") in {"raised", "yes", "regular", "unknown"}:
        speed = min(speed, 7.0)
    if tags.get("yardnav:barrier"):
        speed = min(speed, 5.0)
    return max(speed, 4.0)
