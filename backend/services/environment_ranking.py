"""Rank a project's environments by how many scenes are set there and how many characters appear there.

The location equivalent of the prop breakdown in ``object_ranking``: a recurring set
where many characters meet needs several reference angles; a one-time background does not.

Scoring (0-4):
- Scenes: set in 1 scene -> 0, 2 scenes -> 1, 3 or more -> 2
- Characters: 0-1 distinct characters appear there -> 0, 2 -> 1, 3 or more -> 2
Tiers match objects: 3-4 major, 2 medium, 0-1 minor. Screen time (script lines in its
scenes) breaks ties.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from core.supabase_client import require_supabase_client
from core.supabase_records import as_records
from services.object_ranking import SENTENCE_SPLIT, TIER_MINOR, _score, character_patterns, tier_for


@dataclass
class EnvironmentRanking:
    scene_count: int = 0
    scene_ids: list[str] = field(default_factory=list)
    character_count: int = 0
    characters: list[str] = field(default_factory=list)
    line_count: int = 0
    scene_score: int = 0
    character_score: int = 0
    score: int = 0
    tier: str = TIER_MINOR
    rank: int = 0


def characters_by_scene(
    blocks: list[dict[str, Any]],
    characters: list[dict[str, Any]],
) -> tuple[dict[str, list[str]], dict[str, int]]:
    """Scene id -> characters who speak or are named there, and scene id -> script line count."""
    patterns = character_patterns(characters)
    present: dict[str, dict[str, None]] = {}
    lines: dict[str, int] = {}
    for block in blocks:
        scene_id = str(block.get("scene_id") or "")
        text = " ".join(str(block.get(key) or "") for key in ("content", "parenthetical")).strip()
        speaker = " ".join(str(block.get("character_name") or "").split())
        if not scene_id or not (text or speaker):
            continue
        lines[scene_id] = lines.get(scene_id, 0) + 1
        found = present.setdefault(scene_id, {})
        if speaker:
            match = next((name for name, pattern in patterns.items() if pattern.search(speaker)), None)
            if match:
                found[match] = None
            # Names inside dialogue are people being talked about, not people in the scene.
            continue
        for sentence in SENTENCE_SPLIT.split(text):
            for name, pattern in patterns.items():
                if pattern.search(sentence):
                    found[name] = None
    return {scene_id: list(names) for scene_id, names in present.items()}, lines


def rank_environments(
    environments: list[dict[str, Any]],
    scenes: list[dict[str, Any]],
    blocks: list[dict[str, Any]],
    characters: list[dict[str, Any]],
) -> dict[str, EnvironmentRanking]:
    """Pure ranking: environment id -> scene and character counts, score, tier and rank."""
    scene_order = {str(scene["id"]): index for index, scene in enumerate(scenes) if scene.get("id")}
    cast_by_scene, lines_by_scene = characters_by_scene(blocks, characters)
    cast_order = {" ".join(str(c.get("name") or "").split()): index for index, c in enumerate(characters)}
    rankings: dict[str, EnvironmentRanking] = {}
    for environment in environments:
        environment_id = str(environment.get("id") or "")
        if not environment_id:
            continue
        metadata = environment.get("metadata") if isinstance(environment.get("metadata"), dict) else {}
        scene_ids = sorted(
            {str(scene_id) for scene_id in metadata.get("source_scene_ids") or [] if str(scene_id) in scene_order},
            key=lambda scene_id: scene_order[scene_id],
        )
        cast: dict[str, None] = {}
        for scene_id in scene_ids:
            for name in cast_by_scene.get(scene_id, []):
                cast[name] = None
        ranking = EnvironmentRanking(
            scene_count=len(scene_ids),
            scene_ids=scene_ids,
            character_count=len(cast),
            characters=sorted(cast, key=lambda name: cast_order.get(name, 10**6)),
            line_count=sum(lines_by_scene.get(scene_id, 0) for scene_id in scene_ids),
        )
        ranking.scene_score = _score(ranking.scene_count, two_at=3, one_at=2)
        ranking.character_score = _score(ranking.character_count, two_at=3, one_at=2)
        ranking.score = ranking.scene_score + ranking.character_score
        ranking.tier = tier_for(ranking.score)
        rankings[environment_id] = ranking

    names = {str(environment.get("id")): str(environment.get("name") or "") for environment in environments}
    ordered = sorted(
        rankings,
        key=lambda environment_id: (
            -rankings[environment_id].score,
            -rankings[environment_id].scene_count,
            -rankings[environment_id].character_count,
            -rankings[environment_id].line_count,
            names.get(environment_id, "").casefold(),
        ),
    )
    for position, environment_id in enumerate(ordered, start=1):
        rankings[environment_id].rank = position
    return rankings


def rank_environments_from_script(project_id: str) -> dict[str, EnvironmentRanking]:
    """Rank every environment in the project against its saved script (read-only)."""
    supabase = require_supabase_client()
    environments = as_records(supabase.table("environments").select("id, name, metadata").eq(
        "project_id", project_id
    ).execute().data)
    if not environments:
        return {}
    scenes = as_records(supabase.table("scenes").select("id, sort_order").eq("project_id", project_id).eq(
        "is_leaf", True
    ).order("sort_order").execute().data)
    blocks = as_records(supabase.table("script_blocks").select(
        "scene_id, content, character_name, parenthetical, sort_order"
    ).eq("project_id", project_id).order("sort_order").execute().data)
    characters = as_records(supabase.table("characters").select("name, tags").eq("project_id", project_id).execute().data)
    return rank_environments(environments, scenes, blocks, characters)
