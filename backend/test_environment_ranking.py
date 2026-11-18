import unittest

from services.environment_ranking import characters_by_scene, rank_environments
from services.object_ranking import TIER_MAJOR, TIER_MEDIUM, TIER_MINOR

SCENES = [{"id": f"s{index}"} for index in range(1, 6)]
CHARACTERS = [{"name": "Elena Voss", "tags": []}, {"name": "Mara", "tags": []}, {"name": "Kane", "tags": ["BOSS"]}]
ENVIRONMENTS = [
    {"id": "office", "name": "Precinct Office", "metadata": {"source_scene_ids": ["s1", "s3", "s5"]}},
    {"id": "dock", "name": "Dock", "metadata": {"source_scene_ids": ["s2", "s4"]}},
    {"id": "alley", "name": "Alley", "metadata": {"source_scene_ids": ["s4"]}},
    {"id": "roof", "name": "Rooftop", "metadata": {"source_scene_ids": []}},
]


def block(scene: str, content: str, speaker: str | None = None) -> dict:
    return {"scene_id": scene, "content": content, "character_name": speaker}


BLOCKS = [
    block("s1", "Voss sits at her desk."),
    block("s1", "Where is Kane?", speaker="MARA"),
    block("s2", "Mara waits by the water."),
    block("s3", "The boss storms in."),
    block("s3", "Voss looks up."),
    block("s4", "Empty pier. Rain."),
    block("s5", "Voss alone, reading files."),
]


class EnvironmentRankingTests(unittest.TestCase):
    def setUp(self) -> None:
        self.rankings = rank_environments(ENVIRONMENTS, SCENES, BLOCKS, CHARACTERS)

    def test_cast_comes_from_speakers_and_action_not_names_in_dialogue(self) -> None:
        cast, lines = characters_by_scene(BLOCKS, CHARACTERS)
        self.assertEqual(sorted(cast["s1"]), ["Elena Voss", "Mara"])  # "Kane" is only talked about
        self.assertEqual(cast["s3"], ["Kane", "Elena Voss"])  # "the boss" is Kane's tag
        self.assertEqual(lines["s1"], 2)

    def test_recurring_set_with_full_cast_is_major_and_first(self) -> None:
        office = self.rankings["office"]
        self.assertEqual((office.scene_count, office.character_count), (3, 3))
        self.assertEqual(office.characters, ["Elena Voss", "Mara", "Kane"])
        self.assertEqual((office.score, office.tier, office.rank), (4, TIER_MAJOR, 1))

    def test_medium_needs_two_scenes_and_two_characters(self) -> None:
        dock = self.rankings["dock"]
        self.assertEqual((dock.scene_count, dock.character_count, dock.score), (2, 1, 1))
        self.assertEqual(dock.tier, TIER_MINOR)
        two_people = rank_environments(
            [{"id": "dock", "name": "Dock", "metadata": {"source_scene_ids": ["s2"]}}],
            SCENES, [block("s2", "Mara and Voss meet.")], CHARACTERS,
        )["dock"]
        self.assertEqual((two_people.score, two_people.tier), (1, TIER_MINOR))
        both = rank_environments(
            [{"id": "dock", "name": "Dock", "metadata": {"source_scene_ids": ["s2", "s4"]}}],
            SCENES, [block("s2", "Mara and Voss meet.")], CHARACTERS,
        )["dock"]
        self.assertEqual((both.score, both.tier), (2, TIER_MEDIUM))

    def test_empty_and_unused_locations_rank_last(self) -> None:
        self.assertEqual(self.rankings["alley"].character_count, 0)
        self.assertEqual(self.rankings["roof"].scene_count, 0)
        order = sorted(self.rankings, key=lambda key: self.rankings[key].rank)
        self.assertEqual(order, ["office", "dock", "alley", "roof"])


if __name__ == "__main__":
    unittest.main()
