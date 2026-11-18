import unittest

from services.character_ranking import rank_characters
from services.object_ranking import TIER_MAJOR, TIER_MEDIUM, TIER_MINOR

SCENES = [{"id": f"s{index}"} for index in range(1, 5)]
CHARACTERS = [
    {"id": "voss", "name": "Elena Voss", "tags": []},
    {"id": "mara", "name": "Mara", "tags": []},
    {"id": "kane", "name": "Kane", "tags": ["BOSS"]},
    {"id": "clerk", "name": "Clerk", "tags": []},
    {"id": "ghost", "name": "Ghost", "tags": []},
]


def block(scene: str, content: str, speaker: str | None = None) -> dict:
    return {"scene_id": scene, "content": content, "character_name": speaker}


BLOCKS = [
    block("s1", "Voss enters the office."),
    block("s1", "Morning.", speaker="VOSS"),
    block("s1", "You're late. Kane called.", speaker="MARA"),
    block("s2", "Voss walks the pier alone."),
    block("s2", "Nothing here.", speaker="VOSS"),
    block("s3", "The boss waits. Voss sits."),
    block("s3", "Sit.", speaker="KANE"),
    block("s3", "Talk.", speaker="VOSS"),
    block("s3", "Fine.", speaker="VOSS"),
    block("s4", "Voss pays the clerk."),
    block("s4", "Thanks.", speaker="CLERK"),
    block("s4", "Keep it.", speaker="VOSS"),
    block("s4", "Mara waits outside.", ),
]


class CharacterRankingTests(unittest.TestCase):
    def setUp(self) -> None:
        self.rankings = rank_characters(CHARACTERS, SCENES, BLOCKS)

    def test_lead_is_major_and_first(self) -> None:
        voss = self.rankings["voss"]
        self.assertEqual((voss.scene_count, voss.dialogue_lines), (4, 5))
        self.assertEqual(voss.scene_partners, ["Mara", "Kane", "Clerk"])
        self.assertEqual((voss.score, voss.tier, voss.rank), (4, TIER_MAJOR, 1))

    def test_two_scenes_and_a_line_is_medium(self) -> None:
        mara = self.rankings["mara"]
        self.assertEqual((mara.scene_count, mara.dialogue_lines, mara.score), (2, 1, 2))
        self.assertEqual((mara.tier, mara.rank), (TIER_MEDIUM, 2))

    def test_one_scene_extra_is_minor_and_talked_about_counts_only_for_ties(self) -> None:
        kane, clerk = self.rankings["kane"], self.rankings["clerk"]
        self.assertEqual((kane.scene_count, kane.dialogue_lines, kane.tier), (1, 1, TIER_MINOR))
        self.assertEqual(kane.mentioned_by_others, 1)  # Mara says "Kane called."
        self.assertEqual(clerk.tier, TIER_MINOR)
        # Same score, scenes and lines: the clerk meets two characters, Kane only one.
        self.assertEqual((len(clerk.scene_partners), len(kane.scene_partners)), (2, 1))
        self.assertLess(clerk.rank, kane.rank)

    def test_absent_character_ranks_last(self) -> None:
        ghost = self.rankings["ghost"]
        self.assertEqual((ghost.scene_count, ghost.dialogue_lines, ghost.score, ghost.rank), (0, 0, 0, 5))


if __name__ == "__main__":
    unittest.main()
