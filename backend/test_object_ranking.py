import unittest

from services.object_ranking import TIER_MAJOR, TIER_MEDIUM, TIER_MINOR, object_name_patterns, rank_objects

SCENES = [{"id": "s1"}, {"id": "s2"}, {"id": "s3"}]
CHARACTERS = [{"name": "Elena Voss", "tags": ["DETECTIVE"]}, {"name": "Mara", "tags": []}]
OBJECTS = [
    {"id": "key", "name": "Silver Key", "metadata": {}},
    {"id": "car", "name": "Old Car", "metadata": {}},
    {"id": "cup", "name": "Coffee Cup", "metadata": {}},
    {"id": "photo", "name": "Family Photo", "metadata": {"source_scene_ids": ["s2"]}},
]


def block(scene: str, order: int, content: str, speaker: str | None = None) -> dict:
    return {"scene_id": scene, "sort_order": order, "content": content, "character_name": speaker}


BLOCKS = [
    block("s1", 1, "Voss pulls the silver key from a drawer. A coffee cup sits on the desk."),
    block("s1", 2, "She pockets the key and heads out to her old car."),
    block("s2", 3, "Mara grabs the key from the dashboard of the car."),
    block("s2", 4, "Where did you get that key?", speaker="VOSS"),
    block("s3", 5, "The old car idles outside. Voss drives the car away."),
    block("s3", 6, "Mara studies the silver key."),
]


class ObjectRankingTests(unittest.TestCase):
    def setUp(self) -> None:
        self.rankings = rank_objects(OBJECTS, SCENES, BLOCKS, CHARACTERS)

    def test_key_is_major_and_ranked_first(self) -> None:
        key = self.rankings["key"]
        self.assertEqual(key.scene_count, 3)
        self.assertEqual(key.interaction_count, 4)  # pulls, pockets (pronoun -> Voss), grabs, studies
        self.assertEqual(key.interacting_characters, ["Elena Voss", "Mara"])
        self.assertEqual(key.dialogue_mentions, 1)
        self.assertEqual((key.score, key.tier, key.rank), (4, TIER_MAJOR, 1))

    def test_car_counts_head_noun_mentions(self) -> None:
        car = self.rankings["car"]
        self.assertEqual(car.scene_ids, ["s1", "s2", "s3"])
        self.assertEqual(car.interaction_count, 1)  # "Voss drives the car"; "heads out to" is not handling it
        self.assertEqual((car.score, car.tier, car.rank), (3, TIER_MAJOR, 2))

    def test_background_cup_is_minor(self) -> None:
        cup = self.rankings["cup"]
        self.assertEqual((cup.scene_count, cup.interaction_count), (1, 0))
        self.assertEqual(cup.tier, TIER_MINOR)

    def test_extractor_scenes_count_without_a_text_match(self) -> None:
        photo = self.rankings["photo"]
        self.assertEqual((photo.scene_count, photo.mention_count, photo.tier), (1, 0, TIER_MINOR))
        self.assertEqual(sorted(r.rank for r in self.rankings.values()), [1, 2, 3, 4])

    def test_medium_tier(self) -> None:
        rankings = rank_objects(
            [{"id": "map", "name": "Map", "metadata": {}}],
            SCENES,
            [block("s1", 1, "Mara unfolds the map."), block("s2", 2, "Mara folds the map away.")],
            CHARACTERS,
        )
        self.assertEqual((rankings["map"].scene_count, rankings["map"].interaction_count), (2, 2))
        self.assertEqual(rankings["map"].score, 3)
        rankings = rank_objects(
            [{"id": "map", "name": "Map", "metadata": {}}], SCENES, [block("s1", 1, "Mara unfolds the map.")], CHARACTERS,
        )
        self.assertEqual((rankings["map"].score, rankings["map"].tier), (1, TIER_MINOR))
        rankings = rank_objects(
            [{"id": "map", "name": "Map", "metadata": {}}],
            SCENES,
            [block("s1", 1, "Mara unfolds the map. She folds the map.")],
            CHARACTERS,
        )
        self.assertEqual(rankings["map"].tier, TIER_MEDIUM)

    def test_only_the_object_the_verb_acts_on_counts(self) -> None:
        objects = [{"id": "key", "name": "Key", "metadata": {}}, {"id": "car", "name": "Car", "metadata": {}},
                   {"id": "bat", "name": "Bat", "metadata": {}}]
        rankings = rank_objects(objects, SCENES, [
            block("s1", 1, "Mara puts the key in the car."),
            block("s1", 2, "Voss strikes the window with the bat."),
        ], CHARACTERS)
        self.assertEqual(rankings["key"].interaction_count, 1)
        self.assertEqual(rankings["car"].interaction_count, 0)
        self.assertEqual(rankings["bat"].interaction_count, 0)  # "strikes" is not in the verb list
        rankings = rank_objects(objects, SCENES, [block("s1", 1, "Voss smashes the window with the bat.")], CHARACTERS)
        self.assertEqual(rankings["bat"].interaction_count, 1)

    def test_shared_head_noun_only_matches_full_names(self) -> None:
        patterns = object_name_patterns([
            {"id": "a", "name": "Silver Key"}, {"id": "b", "name": "Brass Key"},
        ])
        self.assertIsNone(patterns["a"].search("She takes the key."))
        self.assertIsNotNone(patterns["a"].search("She takes the silver key."))


if __name__ == "__main__":
    unittest.main()
