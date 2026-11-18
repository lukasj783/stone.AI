"""Rank a project's characters by how many scenes they appear in and how much they speak.

The cast equivalent of ``object_ranking`` and ``environment_ranking``: leads appear
across many scenes and carry the dialogue, so they need full references (turnaround,
face close-up); a one-line extra needs very little.

Scoring (0-4):
- Scenes: appears in 1 scene -> 0, 2 scenes -> 1, 3 or more -> 2
- Dialogue: no lines -> 0, 1-4 lines -> 1, 5 or more -> 2
Tiers match objects and environments: 3-4 major, 2 medium, 0-1 minor. Ties are broken
by scene partners (other characters met on screen), then by mentions in others' lines.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from core.supabase_client import require_supabase_client
from core.supabase_records import as_records
from services.environment_ranking import characters_by_scene
from services.object_ranking import TIER_MINOR, _score, character_patterns, tier_for

LEAD_DIALOGUE_LINES = 5


@dataclass
class CharacterRanking:
    scene_count: int = 0
    scene_ids: list[str] = field(default_factory=list)
    dialogue_lines: int = 0
    scene_partners: list[str] = field(default_factory=list)
    mentioned_by_others: int = 0
    scene_score: int = 0
    dialogue_score: int = 0
    score: int = 0
    tier: str = TIER_MINOR
    rank: int = 0


def rank_characters(
    characters: list[dict[str, Any]],
    scenes: list[dict[str, Any]],
    blocks: list[dict[str, Any]],
) -> dict[str, CharacterRanking]:
    """Pure ranking: character id -> scenes, dialogue lines, score, tier and rank."""
    scene_order = {str(scene["id"]): index for index, scene in enumerate(scenes) if scene.get("id")}
    patterns = character_patterns(characters)
    present_by_scene, _ = characters_by_scene(blocks, characters)
    display_name = {str(c.get("id")): " ".join(str(c.get("name") or "").split()) for c in characters}

    dialogue: dict[str, int] = {}
    mentioned: dict[str, int] = {}
    for block in blocks:
        speaker = " ".join(str(block.get("character_name") or "").split())
        if not speaker:
            continue
        speaker_name = next((name for name, pattern in patterns.items() if pattern.search(speaker)), None)
        if speaker_name:
            dialogue[speaker_name] = dialogue.get(speaker_name, 0) + 1
        text = str(block.get("content") or "")
        for name, pattern in patterns.items():
            if name != speaker_name and pattern.search(text):
                mentioned[name] = mentioned.get(name, 0) + 1

    cast_order = {name: index for index, name in enumerate(display_name.values())}
    rankings: dict[str, CharacterRanking] = {}
    for character_id, name in display_name.items():
        if not character_id or not name:
            continue
        scene_ids = sorted(
            (scene_id for scene_id, present in present_by_scene.items() if name in present and scene_id in scene_order),
            key=lambda scene_id: scene_order[scene_id],
        )
        partners: dict[str, None] = {}
        for scene_id in scene_ids:
            for other in present_by_scene.get(scene_id, []):
                if other != name:
                    partners[other] = None
        ranking = CharacterRanking(
            scene_count=len(scene_ids),
            scene_ids=scene_ids,
            dialogue_lines=dialogue.get(name, 0),
            scene_partners=sorted(partners, key=lambda other: cast_order.get(other, 10**6)),
            mentioned_by_others=mentioned.get(name, 0),
        )
        ranking.scene_score = _score(ranking.scene_count, two_at=3, one_at=2)
        ranking.dialogue_score = _score(ranking.dialogue_lines, two_at=LEAD_DIALOGUE_LINES, one_at=1)
        ranking.score = ranking.scene_score + ranking.dialogue_score
        ranking.tier = tier_for(ranking.score)
        rankings[character_id] = ranking

    ordered = sorted(
        rankings,
        key=lambda character_id: (
            -rankings[character_id].score,
            -rankings[character_id].scene_count,
            -rankings[character_id].dialogue_lines,
            -len(rankings[character_id].scene_partners),
            -rankings[character_id].mentioned_by_others,
            display_name[character_id].casefold(),
        ),
    )
    for position, character_id in enumerate(ordered, start=1):
        rankings[character_id].rank = position
    return rankings


def rank_characters_from_script(project_id: str) -> dict[str, CharacterRanking]:
    """Rank every character in the project against its saved script (read-only)."""
    supabase = require_supabase_client()
    characters = as_records(supabase.table("characters").select("id, name, tags").eq("project_id", project_id).execute().data)
    if not characters:
        return {}
    scenes = as_records(supabase.table("scenes").select("id, sort_order").eq("project_id", project_id).eq(
        "is_leaf", True
    ).order("sort_order").execute().data)
    blocks = as_records(supabase.table("script_blocks").select(
        "scene_id, content, character_name, parenthetical, sort_order"
    ).eq("project_id", project_id).order("sort_order").execute().data)
    return rank_characters(characters, scenes, blocks)
