"""Rank a project's objects by how many scenes they appear in and how often characters handle them.

This is the prop breakdown a production does before making references: objects that
recur across scenes and are held, used or fought over need consistent references
(several angles), while one-off background items do not.

The ranking reads the saved script directly; no language model is involved, so it is
cheap to rerun after every script edit.

Scoring (0-4):
- Scenes: appears in 1 scene -> 0, 2 scenes -> 1, 3 or more -> 2
- Interactions: never handled -> 0, handled once -> 1, twice or more -> 2
Tiers: 3-4 major (several reference angles), 2 medium (one or two images),
0-1 minor (one image, or text only).
"""

from __future__ import annotations

import re
from dataclasses import asdict, dataclass, field
from datetime import UTC, datetime
from typing import Any

from core.supabase_client import require_supabase_client
from core.supabase_records import as_records

TIER_MAJOR = "major"
TIER_MEDIUM = "medium"
TIER_MINOR = "minor"

# Verbs that mean a character is physically handling or using an object.
INTERACTION_VERBS = (
    "hold", "holds", "holding", "held", "grab", "grabs", "grabbing", "grabbed", "take", "takes", "taking", "took",
    "pick", "picks", "picking", "picked", "lift", "lifts", "lifting", "lifted", "carry", "carries", "carrying", "carried",
    "open", "opens", "opening", "opened", "close", "closes", "closing", "closed", "unlock", "unlocks", "unlocked",
    "lock", "locks", "locked", "use", "uses", "using", "used", "hand", "hands", "handing", "handed", "give", "gives",
    "giving", "gave", "pass", "passes", "passed", "throw", "throws", "throwing", "threw", "toss", "tosses", "tossed",
    "drop", "drops", "dropping", "dropped", "place", "places", "placed", "put", "puts", "putting", "set", "sets",
    "pocket", "pockets", "pocketed", "slip", "slips", "slipped", "clutch", "clutches", "clutching", "clutched",
    "grip", "grips", "gripping", "gripped", "squeeze", "squeezes", "squeezed", "wield", "wields", "wielding",
    "point", "points", "pointing", "pointed", "aim", "aims", "aiming", "aimed", "fire", "fires", "firing", "fired",
    "shoot", "shoots", "shot", "swing", "swings", "swung", "draw", "draws", "drew", "drawn", "load", "loads", "loaded",
    "read", "reads", "reading", "write", "writes", "wrote", "sign", "signs", "signed", "dial", "dials", "dialed",
    "type", "types", "typed", "press", "presses", "pressed", "push", "pushes", "pushed", "pull", "pulls", "pulled",
    "turn", "turns", "turned", "twist", "twists", "twisted", "wind", "winds", "wound", "examine", "examines", "examined",
    "inspect", "inspects", "inspected", "study", "studies", "studied", "touch", "touches", "touched", "stroke",
    "strokes", "stroked", "raise", "raises", "raised", "lower", "lowers", "lowered", "hide", "hides", "hid", "hidden",
    "conceal", "conceals", "concealed", "steal", "steals", "stole", "stolen", "snatch", "snatches", "snatched",
    "fight", "fights", "fought", "struggle", "struggles", "wrestle", "wrestles", "drive", "drives", "drove", "ride",
    "rides", "rode", "wear", "wears", "wore", "puts on", "removes", "remove", "removed", "flip", "flips", "flipped",
    "shake", "shakes", "shook", "tap", "taps", "tapped", "hug", "hugs", "kiss", "kisses", "kissed", "smash", "smashes",
    "smashed", "break", "breaks", "broke", "broken", "light", "lights", "lit", "eat", "eats", "drink", "drinks",
    "drank", "pour", "pours", "poured", "fill", "fills", "filled", "plug", "plugs", "plugged", "insert", "inserts",
    "inserted", "unwrap", "unwraps", "unwrapped", "unfold", "unfolds", "unfolded", "fold", "folds", "folded",
)
PRONOUNS = ("he", "she", "they", "his", "her", "their", "him", "them", "hers", "theirs")
HEAD_NOUN_STOPWORDS = {"the", "a", "an", "of", "old", "new", "small", "big", "large", "little", "one", "thing", "item", "object"}
# Words that end the verb's object phrase: "grabs the key FROM the car" handles the key, not the car.
# "with" is allowed, since "strikes him with the bat" handles the bat.
OBJECT_PHRASE_BREAKS = {
    "and", "or", "but", "from", "of", "to", "into", "in", "on", "onto", "at", "toward", "towards", "off", "out",
    "over", "under", "by", "through", "while", "as", "then", "near", "beside", "behind", "inside", "across", "past",
}
MAX_WORDS_BETWEEN_VERB_AND_OBJECT = 4
SENTENCE_SPLIT = re.compile(r"(?<=[.!?;])\s+|\n+")
_VERB_PATTERN = re.compile(r"\b(" + "|".join(sorted({re.escape(v) for v in INTERACTION_VERBS}, key=len, reverse=True)) + r")\b", re.IGNORECASE)
_PRONOUN_PATTERN = re.compile(r"\b(" + "|".join(PRONOUNS) + r")\b", re.IGNORECASE)


@dataclass
class ObjectRanking:
    scene_count: int = 0
    scene_ids: list[str] = field(default_factory=list)
    mention_count: int = 0
    dialogue_mentions: int = 0
    interaction_count: int = 0
    interacting_characters: list[str] = field(default_factory=list)
    scene_score: int = 0
    interaction_score: int = 0
    score: int = 0
    tier: str = TIER_MINOR
    rank: int = 0


def _word_pattern(phrases: list[str]) -> re.Pattern[str] | None:
    cleaned = sorted({" ".join(phrase.split()) for phrase in phrases if phrase and phrase.strip()}, key=len, reverse=True)
    if not cleaned:
        return None
    parts = [r"\s+".join(re.escape(word) for word in phrase.split()) for phrase in cleaned]
    return re.compile(r"\b(?:" + "|".join(parts) + r")(?:'s|s|es)?\b", re.IGNORECASE)


def object_name_patterns(objects: list[dict[str, Any]]) -> dict[str, re.Pattern[str]]:
    """Match an object's full name, plus its head noun when no other object shares it.

    "Silver revolver" also matches "the revolver"; if two objects end in "key", only
    their full names count, so one object's mentions are never credited to another.
    """
    head_nouns: dict[str, int] = {}
    for obj in objects:
        words = str(obj.get("name") or "").casefold().split()
        if len(words) > 1 and words[-1] not in HEAD_NOUN_STOPWORDS and len(words[-1]) >= 3:
            head_nouns[words[-1]] = head_nouns.get(words[-1], 0) + 1
    patterns: dict[str, re.Pattern[str]] = {}
    for obj in objects:
        name = " ".join(str(obj.get("name") or "").split())
        phrases = [name]
        words = name.casefold().split()
        if len(words) > 1 and head_nouns.get(words[-1]) == 1:
            phrases.append(words[-1])
        pattern = _word_pattern(phrases)
        if pattern:
            patterns[str(obj["id"])] = pattern
    return patterns


def character_patterns(characters: list[dict[str, Any]]) -> dict[str, re.Pattern[str]]:
    """Character display name -> pattern over full name, first name and tags/aliases."""
    patterns: dict[str, re.Pattern[str]] = {}
    for character in characters:
        name = " ".join(str(character.get("name") or "").split())
        if not name:
            continue
        aliases = [name, name.split()[0], name.split()[-1]]  # full, first and last name
        aliases.extend(tag for tag in character.get("tags") or [] if isinstance(tag, str))
        pattern = _word_pattern([alias for alias in aliases if len(alias) >= 2])
        if pattern:
            patterns[name] = pattern
    return patterns


def _verb_acts_on(sentence: str, object_start: int) -> bool:
    """True when an interaction verb shortly before the object takes it as its object."""
    for verb in _VERB_PATTERN.finditer(sentence[:object_start]):
        gap = sentence[verb.end():object_start].casefold().replace(",", " ").split()
        if len(gap) <= MAX_WORDS_BETWEEN_VERB_AND_OBJECT and not OBJECT_PHRASE_BREAKS.intersection(gap):
            return True
    return False


def _score(value: int, two_at: int, one_at: int) -> int:
    return 2 if value >= two_at else 1 if value >= one_at else 0


def tier_for(score: int) -> str:
    return TIER_MAJOR if score >= 3 else TIER_MEDIUM if score == 2 else TIER_MINOR


def rank_objects(
    objects: list[dict[str, Any]],
    scenes: list[dict[str, Any]],
    blocks: list[dict[str, Any]],
    characters: list[dict[str, Any]],
) -> dict[str, ObjectRanking]:
    """Pure ranking: object id -> scene and interaction counts, score, tier and rank."""
    object_patterns = object_name_patterns(objects)
    cast_patterns = character_patterns(characters)
    scene_order = {str(scene["id"]): index for index, scene in enumerate(scenes) if scene.get("id")}
    rankings = {str(obj["id"]): ObjectRanking() for obj in objects if obj.get("id")}
    scenes_by_object: dict[str, set[str]] = {object_id: set() for object_id in rankings}
    interactors: dict[str, dict[str, None]] = {object_id: {} for object_id in rankings}

    ordered_blocks = sorted(blocks, key=lambda block: (scene_order.get(str(block.get("scene_id")), 10**6), block.get("sort_order") or 0))
    last_character_by_scene: dict[str, str] = {}
    for block in ordered_blocks:
        scene_id = str(block.get("scene_id") or "")
        text = " ".join(str(block.get(key) or "") for key in ("content", "parenthetical")).strip()
        if not text:
            continue
        speaker = " ".join(str(block.get("character_name") or "").split())
        is_spoken = bool(speaker)
        for sentence in SENTENCE_SPLIT.split(text):
            named = [name for name, pattern in cast_patterns.items() if pattern.search(sentence)]
            if not is_spoken and named:
                last_character_by_scene[scene_id] = named[-1]
            for object_id, pattern in object_patterns.items():
                matches = list(pattern.finditer(sentence))
                hits = len(matches)
                if not hits:
                    continue
                ranking = rankings[object_id]
                ranking.mention_count += hits
                if scene_id:
                    scenes_by_object[object_id].add(scene_id)
                if is_spoken:
                    ranking.dialogue_mentions += hits
                    continue
                if not any(_verb_acts_on(sentence, match.start()) for match in matches):
                    continue
                actors = named or (
                    [last_character_by_scene[scene_id]]
                    if _PRONOUN_PATTERN.search(sentence) and last_character_by_scene.get(scene_id) else []
                )
                if actors:
                    ranking.interaction_count += 1
                    for actor in actors:
                        interactors[object_id][actor] = None
        if is_spoken:
            # The speaker is the most recent person on screen, for later pronoun lines.
            match = next((name for name, pattern in cast_patterns.items() if pattern.search(speaker)), None)
            if match:
                last_character_by_scene[scene_id] = match

    for obj in objects:
        object_id = str(obj.get("id") or "")
        if object_id not in rankings:
            continue
        ranking = rankings[object_id]
        # Scenes the extractor attributed to the object count even when the wording differs.
        metadata = obj.get("metadata") if isinstance(obj.get("metadata"), dict) else {}
        scenes_by_object[object_id].update(
            str(scene_id) for scene_id in metadata.get("source_scene_ids") or [] if str(scene_id) in scene_order
        )
        ranking.scene_ids = sorted(scenes_by_object[object_id], key=lambda scene_id: scene_order.get(scene_id, 10**6))
        ranking.scene_count = len(ranking.scene_ids)
        ranking.interacting_characters = list(interactors[object_id])
        ranking.scene_score = _score(ranking.scene_count, two_at=3, one_at=2)
        ranking.interaction_score = _score(ranking.interaction_count, two_at=2, one_at=1)
        ranking.score = ranking.scene_score + ranking.interaction_score
        ranking.tier = tier_for(ranking.score)

    names = {str(obj.get("id")): str(obj.get("name") or "") for obj in objects}
    ordered = sorted(
        rankings,
        key=lambda object_id: (
            -rankings[object_id].score,
            -rankings[object_id].interaction_count,
            -rankings[object_id].scene_count,
            -rankings[object_id].mention_count,
            names.get(object_id, "").casefold(),
        ),
    )
    for position, object_id in enumerate(ordered, start=1):
        rankings[object_id].rank = position
    return rankings


def rank_objects_from_script(project_id: str, objects: list[dict[str, Any]]) -> dict[str, ObjectRanking]:
    """Rank the given props against the project's saved script (read-only)."""
    if not objects:
        return {}
    supabase = require_supabase_client()
    scenes = as_records(supabase.table("scenes").select("id, sort_order").eq("project_id", project_id).eq(
        "is_leaf", True
    ).order("sort_order").execute().data)
    blocks = as_records(supabase.table("script_blocks").select(
        "scene_id, block_type, content, character_name, parenthetical, sort_order"
    ).eq("project_id", project_id).order("sort_order").execute().data)
    characters = as_records(supabase.table("characters").select("name, tags").eq("project_id", project_id).execute().data)
    return rank_objects(objects, scenes, blocks, characters)


def rank_project_objects(project_id: str) -> dict[str, ObjectRanking]:
    """Rank every object and store the result on each prop's metadata."""
    supabase = require_supabase_client()
    objects = as_records(supabase.table("props").select("id, name, metadata").eq("project_id", project_id).execute().data)
    rankings = rank_objects_from_script(project_id, objects)
    ranked_at = datetime.now(UTC).isoformat()
    for obj in objects:
        ranking = rankings.get(str(obj["id"]))
        if not ranking:
            continue
        metadata = dict(obj["metadata"]) if isinstance(obj.get("metadata"), dict) else {}
        metadata["ranking"] = {**asdict(ranking), "ranked_at": ranked_at}
        supabase.table("props").update({"metadata": metadata}).eq("id", obj["id"]).eq("project_id", project_id).execute()
    return rankings
