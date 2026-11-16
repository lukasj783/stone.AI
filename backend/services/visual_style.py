from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any, Iterable

from core.supabase_client import get_supabase_client


@dataclass(frozen=True)
class VisualStyle:
    label: str
    style_prompt: str
    negative_style_prompt: str

    def prompt_block(self) -> str:
        return "\n".join((
            "VISUAL STYLE CONTRACT (mandatory):",
            self.style_prompt,
            f"Avoid: {self.negative_style_prompt}.",
            "Keep the rendering medium, palette, materials, proportions, and lighting consistent with this contract.",
        ))


STYLE_PRESETS: dict[str, VisualStyle] = {
    "Realistic": VisualStyle(
        label="Realistic",
        style_prompt="Photorealistic live-action imagery with natural materials, believable scale, and physically plausible lighting.",
        negative_style_prompt="anime, 3D animation, pixel art, flat 2D cartoon, hand-drawn illustration, rough storyboard sketch",
    ),
    "Anime": VisualStyle(
        label="Anime",
        style_prompt="Finished Japanese anime imagery with expressive line work, cel-shaded lighting, clean color separation, and cinematic composition.",
        negative_style_prompt="photorealistic live action, western 3D animation, pixel art, western cartoon, rough storyboard sketch",
    ),
    "3D": VisualStyle(
        label="3D",
        style_prompt="Finished stylized 3D animated film imagery with polished modeling, tactile materials, soft cinematic lighting, and appealing proportions.",
        negative_style_prompt="photorealistic live action, flat 2D cartoon, anime, pixel art, rough storyboard sketch",
    ),
    "Pixel": VisualStyle(
        label="Pixel",
        style_prompt="Finished pixel-art imagery with deliberate low-resolution pixel detail, a coherent limited palette, readable silhouettes, and crisp edges.",
        negative_style_prompt="photorealistic live action, smooth 3D render, anime, vector cartoon, rough storyboard sketch",
    ),
    "Cartoon": VisualStyle(
        label="Cartoon",
        style_prompt="Finished 2D cartoon imagery with bold clean outlines, simplified consistent proportions, and controlled flat shading.",
        negative_style_prompt="photorealistic live action, anime, 3D render, pixel art, rough storyboard sketch",
    ),
}

DEFAULT_VISUAL_STYLE = STYLE_PRESETS["Realistic"]


def resolve_visual_style(label: object) -> VisualStyle:
    """Resolve a supported style label, falling back to the realistic contract."""
    if not isinstance(label, str):
        return DEFAULT_VISUAL_STYLE
    candidate = label.strip()
    for name, preset in STYLE_PRESETS.items():
        if candidate.casefold() == name.casefold():
            return preset
    return DEFAULT_VISUAL_STYLE


def character_visual_style(character: dict[str, Any] | None) -> VisualStyle:
    """Return a character's explicit style, or the default when none is stored."""
    metadata = (character or {}).get("metadata")
    if not isinstance(metadata, dict):
        return DEFAULT_VISUAL_STYLE
    return resolve_visual_style(metadata.get("visual_style"))


def resolve_character_visual_style(
    character: dict[str, Any] | None,
    fallback: object = None,
) -> VisualStyle:
    """Use the character's stored style before a caller-provided fallback."""
    metadata = (character or {}).get("metadata")
    stored = metadata.get("visual_style") if isinstance(metadata, dict) else None
    if isinstance(stored, str) and stored.strip():
        return resolve_visual_style(stored)
    return resolve_visual_style(fallback)


def load_character(
    project_id: str,
    character_id: str,
    supabase: Any | None = None,
) -> dict[str, Any]:
    """Load one project-scoped character with its metadata."""
    client = supabase or get_supabase_client()
    if not client:
        raise RuntimeError("Supabase client not initialized")
    result = client.table("characters").select("*").eq("id", character_id).eq(
        "project_id", project_id
    ).maybe_single().execute()
    character = result.data
    if not character:
        raise ValueError("Character was not found in this project")
    return character


def save_character_visual_style(
    project_id: str,
    character_id: str,
    visual_style: object,
    supabase: Any | None = None,
) -> VisualStyle:
    """Persist the authoritative visual style on one project character."""
    client = supabase or get_supabase_client()
    if not client:
        raise RuntimeError("Supabase client not initialized")

    character = load_character(project_id, character_id, client)
    style = resolve_visual_style(visual_style)
    metadata = character.get("metadata")
    if not isinstance(metadata, dict):
        metadata = {}
    metadata["visual_style"] = style.label
    metadata["visual_style_updated_at"] = datetime.now(UTC).isoformat()
    client.table("characters").update({"metadata": metadata}).eq("id", character_id).eq(
        "project_id", project_id
    ).execute()
    return style


def _characters_for_blocks(
    supabase: Any,
    project_id: str,
    blocks: Iterable[dict[str, Any]],
) -> list[dict[str, Any]]:
    block_rows = list(blocks)
    character_ids = {
        block.get("character_id")
        for block in block_rows
        if isinstance(block.get("character_id"), str) and block.get("character_id")
    }
    character_names = {
        block.get("character_name").casefold()
        for block in block_rows
        if isinstance(block.get("character_name"), str) and block.get("character_name")
    }
    if not character_ids and not character_names:
        return []

    rows = supabase.table("characters").select(
        "id, name, metadata"
    ).eq("project_id", project_id).execute().data or []
    return [
        character
        for character in rows
        if character.get("id") in character_ids
        or (
            isinstance(character.get("name"), str)
            and character["name"].casefold() in character_names
        )
    ]


def resolve_scene_visual_style(
    project_id: str,
    scene_id: str | None = None,
    scene_ids: Iterable[str] | None = None,
    supabase: Any | None = None,
    blocks: Iterable[dict[str, Any]] | None = None,
) -> VisualStyle:
    """Resolve a scene's style from its linked characters.

    The most recently changed explicit character style wins. When several
    characters are explicit but have no timestamp, the first linked character
    in screenplay order wins. A scene with no explicit style is Realistic.
    """
    client = supabase or get_supabase_client()
    if not client:
        raise RuntimeError("Supabase client not initialized")

    selected_scene_ids = {value for value in (scene_ids or []) if isinstance(value, str) and value}
    if isinstance(scene_id, str) and scene_id:
        selected_scene_ids.add(scene_id)
    if not selected_scene_ids:
        return DEFAULT_VISUAL_STYLE

    if blocks is None:
        block_rows = client.table("script_blocks").select(
            "scene_id, character_id, character_name"
        ).eq("project_id", project_id).in_(
            "scene_id", sorted(selected_scene_ids)
        ).execute().data or []
    else:
        block_rows = [
            block for block in blocks if block.get("scene_id") in selected_scene_ids
        ]
    linked_characters = _characters_for_blocks(client, project_id, block_rows)
    if not linked_characters:
        return DEFAULT_VISUAL_STYLE

    by_id = {character.get("id"): character for character in linked_characters if character.get("id")}
    by_name = {
        str(character.get("name")).casefold(): character
        for character in linked_characters
        if isinstance(character.get("name"), str) and character.get("name")
    }

    best: tuple[str, VisualStyle] | None = None
    for index, block in enumerate(block_rows):
        character = by_id.get(block.get("character_id"))
        if character is None and isinstance(block.get("character_name"), str):
            character = by_name.get(block["character_name"].casefold())
        if character is None:
            continue
        metadata = character.get("metadata") if isinstance(character.get("metadata"), dict) else {}
        label = metadata.get("visual_style")
        if not isinstance(label, str) or not label.strip():
            continue
        style = resolve_visual_style(label)
        updated_at = metadata.get("visual_style_updated_at")
        recency = updated_at if isinstance(updated_at, str) else ""
        candidate = (f"{recency}|{index:08d}", style)
        if best is None or candidate[0] > best[0]:
            best = candidate

    return best[1] if best is not None else DEFAULT_VISUAL_STYLE


def find_character_scene_ids(
    project_id: str,
    character: dict[str, Any],
    supabase: Any | None = None,
) -> list[str]:
    """Find scenes where the character speaks or appears in a generated storyboard."""
    client = supabase or get_supabase_client()
    if not client:
        raise RuntimeError("Supabase client not initialized")

    character_id = character.get("id")
    name = character.get("name") if isinstance(character.get("name"), str) else ""
    normalized_name = name.strip().casefold()

    scene_ids: set[str] = set()
    blocks = client.table("script_blocks").select(
        "scene_id, character_id, character_name"
    ).eq("project_id", project_id).execute().data or []
    for block in blocks:
        scene_id = block.get("scene_id")
        if not isinstance(scene_id, str):
            continue
        block_character_id = block.get("character_id")
        block_name = block.get("character_name")
        if (character_id and block_character_id == character_id) or (
            normalized_name
            and isinstance(block_name, str)
            and block_name.strip().casefold() == normalized_name
        ):
            scene_ids.add(scene_id)

    shots = client.table("shots").select("scene_id, metadata").eq(
        "project_id", project_id
    ).execute().data or []
    for shot in shots:
        scene_id = shot.get("scene_id")
        metadata = shot.get("metadata") if isinstance(shot.get("metadata"), dict) else {}
        ids = metadata.get("character_ids") if isinstance(metadata.get("character_ids"), list) else []
        labels = metadata.get("characters") if isinstance(metadata.get("characters"), list) else []
        names = {
            str(label.get("name")).strip().casefold()
            for label in labels
            if isinstance(label, dict) and label.get("name")
        }
        if isinstance(scene_id, str) and (
            (character_id and character_id in ids)
            or (normalized_name and normalized_name in names)
        ):
            scene_ids.add(scene_id)

    return sorted(scene_ids)


def _linked_ids(
    rows: Iterable[dict[str, Any]],
    scene_ids: set[str],
    require_primary_asset: bool,
) -> list[str]:
    linked: list[str] = []
    for row in rows:
        if require_primary_asset and not row.get("primary_asset_id"):
            continue
        metadata = row.get("metadata") if isinstance(row.get("metadata"), dict) else {}
        source_scene_ids = metadata.get("source_scene_ids")
        if not isinstance(source_scene_ids, list):
            continue
        if scene_ids.intersection(value for value in source_scene_ids if isinstance(value, str)):
            row_id = row.get("id")
            if isinstance(row_id, str) and row_id not in linked:
                linked.append(row_id)
    return linked


def find_style_dependent_assets(
    project_id: str,
    scene_ids: Iterable[str],
    supabase: Any | None = None,
) -> tuple[list[str], list[str]]:
    """Return scene-linked environments and props that already have reference images."""
    client = supabase or get_supabase_client()
    if not client:
        raise RuntimeError("Supabase client not initialized")

    linked_scene_ids = {value for value in scene_ids if isinstance(value, str) and value}
    if not linked_scene_ids:
        return [], []

    environments = client.table("environments").select(
        "id, primary_asset_id, metadata"
    ).eq("project_id", project_id).execute().data or []
    props = client.table("props").select(
        "id, primary_asset_id, metadata"
    ).eq("project_id", project_id).execute().data or []
    return (
        _linked_ids(environments, linked_scene_ids, require_primary_asset=True),
        _linked_ids(props, linked_scene_ids, require_primary_asset=True),
    )


def apply_visual_style(prompt: str, visual_style: VisualStyle) -> str:
    return f"{visual_style.prompt_block()}\n\n{prompt.strip()}"
