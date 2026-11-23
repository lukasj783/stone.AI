"""Screenplay parentheticals become ElevenLabs audio tags; stage business is dropped."""

import unittest

from services.audio_tags import direction_to_tag, directions_to_tags, to_elevenlabs_text


class DirectionTests(unittest.TestCase):
    def test_vocal_directions_use_the_documented_tag_wording(self) -> None:
        cases = {
            "whispering": "whispers",
            "Laughing": "laughs",
            "clears his throat": "clears throat",
            "in tears": "crying",
            "sighing": "sighs",
            "under her breath": "under breath",
            "to herself": "under breath",
        }
        for direction, tag in cases.items():
            with self.subTest(direction=direction):
                self.assertEqual(direction_to_tag(direction), tag)

    def test_emotions_and_adverbs_are_kept_as_written(self) -> None:
        self.assertEqual(direction_to_tag("sarcastically"), "sarcastically")
        self.assertEqual(direction_to_tag("mischievously"), "mischievously")
        self.assertEqual(direction_to_tag("nervous"), "nervous")
        self.assertEqual(direction_to_tag("about to cry"), "about to cry")
        self.assertEqual(direction_to_tag("with a strong Kenyan accent"), "strong kenyan accent")
        self.assertEqual(direction_to_tag("in a low voice"), "low voice")

    def test_beats_become_pauses(self) -> None:
        self.assertEqual(direction_to_tag("beat"), "short pause")
        self.assertEqual(direction_to_tag("a beat"), "short pause")
        self.assertEqual(direction_to_tag("long pause"), "long pause")
        self.assertEqual(direction_to_tag("silence"), "long pause")

    def test_extensions_addressees_and_stage_business_are_not_tags(self) -> None:
        for direction in ("V.O.", "O.S.", "CONT'D", "cont’d", "into phone", "on the radio", "in Swahili",
                          "to Amina", "re: the money", "lighting a cigarette", "beating the drum",
                          "drying her hands", "turning away"):
            with self.subTest(direction=direction):
                self.assertIsNone(direction_to_tag(direction))

    def test_trailing_stage_business_is_cut_from_a_vocal_direction(self) -> None:
        self.assertEqual(direction_to_tag("laughing at him"), "laughs")
        self.assertEqual(direction_to_tag("smiling as she leaves"), "smiling")

    def test_advert_tone_descriptions_are_delivery(self) -> None:
        # Real voice-over parentheticals from generated advert scripts.
        cases = {
            "(Deep, gritty, and dramatic)": ["deep", "gritty", "dramatic"],
            "(warm and inviting)": ["warm and inviting"],
            "(Enthusiastic and persuasive)": ["enthusiastic and persuasive"],
            "(delighted, refreshed)": ["delighted", "refreshed"],
            "(sighing, deeply disappointed)": ["sighs", "deeply disappointed"],
            "(warm, inviting, deep voice)": ["warm", "inviting", "deep voice"],
            "(panting, desperately hopeful)": ["panting", "desperately hopeful"],
            "(smiling warmly, with pride)": ["smiling warmly", "with pride"],
        }
        for parenthetical, expected in cases.items():
            with self.subTest(parenthetical=parenthetical):
                self.assertEqual(directions_to_tags([parenthetical])[0], expected)

    def test_physical_business_is_cut_and_the_delivery_kept(self) -> None:
        self.assertEqual(directions_to_tags(["(excitedly pointing to the bottle)"]), (["excitedly"], []))
        self.assertEqual(directions_to_tags(["(laughing, pointing to her bottle)"]), (["laughs"], ["pointing to her bottle"]))
        self.assertEqual(direction_to_tag("voice shaking"), "voice shaking")
        self.assertEqual(direction_to_tag("light and breezy"), "light and breezy")

    def test_places_are_not_delivery(self) -> None:
        self.assertIsNone(direction_to_tag("in the car"))
        self.assertIsNone(direction_to_tag("from the doorway"))
        self.assertIsNone(direction_to_tag("with a gun"))
        self.assertEqual(direction_to_tag("with a smile"), "smile")

    def test_several_directions_split_and_deduplicate(self) -> None:
        tags, dropped = directions_to_tags(["(to Amina, laughing; then softly)", "(laughs)"])
        self.assertEqual(tags, ["laughs", "softly"])
        self.assertEqual(dropped, ["to Amina"])


class LineTextTests(unittest.TestCase):
    def test_parenthetical_leads_the_line(self) -> None:
        line = to_elevenlabs_text("I told you already.", ["(whispering)"])
        self.assertEqual(line.text, "[whispers] I told you already.")
        self.assertEqual(line.tags, ("whispers",))

    def test_inline_parentheticals_become_tags_in_place(self) -> None:
        line = to_elevenlabs_text("I never meant (beat) to hurt you. (laughs) Really.")
        self.assertEqual(line.text, "I never meant [short pause] to hurt you. [laughs] Really.")

    def test_non_vocal_inline_aside_disappears(self) -> None:
        line = to_elevenlabs_text("Hello? (into phone) Who is this?")
        self.assertEqual(line.text, "Hello? Who is this?")
        self.assertEqual(line.dropped, ("into phone",))

    def test_pauses_at_the_edges_are_trimmed(self) -> None:
        self.assertEqual(to_elevenlabs_text("Fine.", ["(beat)"]).text, "Fine.")
        self.assertEqual(to_elevenlabs_text("Fine. (beat)").text, "Fine.")

    def test_tags_already_in_the_line_are_not_repeated(self) -> None:
        self.assertEqual(to_elevenlabs_text("[laughs] No way.", ["(laughing)"]).text, "[laughs] No way.")

    def test_dialogue_metadata_adds_emotion_and_delivery(self) -> None:
        line = to_elevenlabs_text("We won!", [], {"emotion": "excited", "delivery": "shouting"})
        self.assertEqual(line.text, "[excited] [shouts] We won!")

    def test_line_with_only_extensions_is_unchanged(self) -> None:
        line = to_elevenlabs_text("Where were you?", ["(V.O.)", "(CONT'D)"])
        self.assertEqual(line.text, "Where were you?")
        self.assertEqual(line.dropped, ("V.O.", "CONT'D"))

    def test_swahili_line_keeps_its_words(self) -> None:
        line = to_elevenlabs_text("Nakupenda sana.", ["(in Swahili, softly)"])
        self.assertEqual(line.text, "[softly] Nakupenda sana.")


if __name__ == "__main__":
    unittest.main()
