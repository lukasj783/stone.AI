"""Universal Script Engine configuration.

The database holds which script formats, unit types (Act, Chapter, Lesson...),
block types (Action, Narration, Interview...) and character types (Main, Narrator,
Spokesperson...) each project type may use. This module loads that configuration once,
caches it briefly, and answers questions such as "which unit holds script blocks in a
documentary?", "is a b_roll block visual?" or "is a narrator ever seen on camera?".
"""

import logging
import threading
import time
from dataclasses import asdict, dataclass, field
from typing import Any

from core.supabase_client import require_supabase_client


logger = logging.getLogger(__name__)

CONFIG_CACHE_SECONDS = 300.0
DEFAULT_PROJECT_TYPE = "feature_film"

ON_CAMERA = "on_camera"
VOICE_ONLY = "voice_only"


@dataclass(frozen=True)
class DetailFieldConfig:
    """One type-specific profile field, e.g. a spokesperson's ``brand``."""

    key: str
    label: str
    hint: str = ""


@dataclass(frozen=True)
class CharacterTypeConfig:
    key: str
    label: str
    description: str = ""
    presence: str = ON_CAMERA  # on_camera | voice_only
    # Speaks straight to the lens (presenter, host, spokesperson) rather than to other characters.
    addresses_camera: bool = False
    detail_fields: tuple[DetailFieldConfig, ...] = ()
    sort_order: int = 0

    @property
    def voice_only(self) -> bool:
        return self.presence == VOICE_ONLY

    @property
    def detail_keys(self) -> tuple[str, ...]:
        return tuple(detail.key for detail in self.detail_fields)


def _character_type_from_row(row: dict[str, Any]) -> CharacterTypeConfig:
    details: list[DetailFieldConfig] = []
    raw_fields = row.get("detail_fields")
    for item in raw_fields if isinstance(raw_fields, list) else []:
        if isinstance(item, dict) and isinstance(item.get("key"), str) and item["key"].strip():
            key = item["key"].strip()
            details.append(DetailFieldConfig(
                key=key,
                label=str(item.get("label") or key.replace("_", " ").capitalize()),
                hint=str(item.get("hint") or ""),
            ))
    presence = row.get("presence")
    return CharacterTypeConfig(
        key=str(row["key"]),
        label=str(row.get("label") or row["key"]),
        description=str(row.get("description") or ""),
        presence=presence if presence in (ON_CAMERA, VOICE_ONLY) else ON_CAMERA,
        addresses_camera=bool(row.get("addresses_camera")),
        detail_fields=tuple(details),
        sort_order=int(row.get("sort_order") or 0),
    )


@dataclass(frozen=True)
class BlockTypeConfig:
    key: str
    label: str
    description: str
    lane: str  # video | audio | both | structure
    is_visual: bool
    speaker_role: str  # none | optional | required
    metadata_schema: dict[str, Any] | None
    sort_order: int

    @property
    def is_spoken(self) -> bool:
        return self.speaker_role != "none" and self.lane in {"audio", "both"}


@dataclass(frozen=True)
class UnitTypeConfig:
    key: str
    label: str
    description: str
    level: int
    is_leaf: bool


@dataclass(frozen=True)
class FormatConfig:
    key: str
    label: str
    renderer: str  # screenplay | two_column | treatment | instructional
    description: str
    is_default: bool


@dataclass(frozen=True)
class ProjectTypeConfig:
    key: str
    label: str
    description: str
    is_narrative: bool
    requires_outline: bool
    formats: tuple[FormatConfig, ...]
    unit_types: tuple[UnitTypeConfig, ...]
    block_types: tuple[BlockTypeConfig, ...]
    # Keys of the character types this project type offers, in display order.
    character_types: tuple[str, ...] = field(default_factory=tuple)
    character_type_configs: tuple[CharacterTypeConfig, ...] = field(default_factory=tuple)

    def character_type(self, key: str | None) -> CharacterTypeConfig | None:
        return next((item for item in self.character_type_configs if item.key == key), None)

    @property
    def default_format(self) -> FormatConfig:
        return next((fmt for fmt in self.formats if fmt.is_default), self.formats[0])

    @property
    def leaf_unit(self) -> UnitTypeConfig:
        return next(unit for unit in self.unit_types if unit.is_leaf)

    @property
    def container_units(self) -> tuple[UnitTypeConfig, ...]:
        return tuple(unit for unit in self.unit_types if not unit.is_leaf)

    def format(self, key: str | None) -> FormatConfig:
        return next((fmt for fmt in self.formats if fmt.key == key), self.default_format)

    def unit(self, key: str | None) -> UnitTypeConfig | None:
        return next((unit for unit in self.unit_types if unit.key == key), None)

    def block(self, key: str | None) -> BlockTypeConfig | None:
        return next((block for block in self.block_types if block.key == key), None)

    @property
    def block_keys(self) -> frozenset[str]:
        return frozenset(block.key for block in self.block_types)

    @property
    def visual_block_keys(self) -> frozenset[str]:
        return frozenset(block.key for block in self.block_types if block.is_visual)

    @property
    def spoken_block_keys(self) -> frozenset[str]:
        return frozenset(block.key for block in self.block_types if block.is_spoken)

    @property
    def primary_visual_block(self) -> BlockTypeConfig:
        """The block type a generic "what we see" line maps to (action, visual, b_roll...)."""
        for preferred in ("action", "visual", "b_roll", "performance", "demonstration"):
            block = self.block(preferred)
            if block:
                return block
        return next(block for block in self.block_types if block.is_visual)

    @property
    def primary_spoken_block(self) -> BlockTypeConfig | None:
        for preferred in ("dialogue", "narration", "voice_over", "instruction", "lyric"):
            block = self.block(preferred)
            if block:
                return block
        return None


@dataclass(frozen=True)
class EngineConfig:
    project_types: dict[str, ProjectTypeConfig]
    character_types: tuple[dict[str, Any], ...]
    character_type_configs: dict[str, CharacterTypeConfig] = field(default_factory=dict)

    def project_type(self, key: str | None) -> ProjectTypeConfig:
        return self.project_types.get(key or "") or self.project_types[DEFAULT_PROJECT_TYPE]


def build_engine_config(tables: dict[str, list[dict[str, Any]]]) -> EngineConfig:
    """Assemble configuration from raw table rows (kept pure so it is testable)."""
    formats = {row["key"]: row for row in tables["script_formats"]}
    units = {row["key"]: row for row in tables["script_unit_types"]}
    blocks = {row["key"]: row for row in tables["script_block_types"]}
    character_types = tuple(sorted(tables.get("character_types", []), key=lambda row: row.get("sort_order") or 0))
    character_type_configs = {row["key"]: _character_type_from_row(row) for row in character_types}
    character_type_links = tables.get("project_type_character_types") or []

    def offered_character_types(project_type: str) -> tuple[CharacterTypeConfig, ...]:
        """The project type's own list; every type when it has none configured."""
        links = sorted(
            (link for link in character_type_links
             if link.get("project_type") == project_type and link.get("character_type") in character_type_configs),
            key=lambda link: link.get("sort_order") or 0,
        )
        if not links:
            return tuple(character_type_configs.values())
        return tuple(character_type_configs[link["character_type"]] for link in links)

    project_types: dict[str, ProjectTypeConfig] = {}
    for row in sorted(tables["project_types"], key=lambda r: r.get("sort_order") or 0):
        key = row["key"]
        type_formats = tuple(
            FormatConfig(
                key=link["script_format"],
                label=formats[link["script_format"]]["label"],
                renderer=formats[link["script_format"]]["renderer"],
                description=formats[link["script_format"]].get("description") or "",
                is_default=bool(link.get("is_default")),
            )
            for link in sorted(
                (link for link in tables["project_type_formats"] if link["project_type"] == key),
                key=lambda link: (not link.get("is_default"), formats[link["script_format"]].get("sort_order") or 0),
            )
        )
        type_units = tuple(
            UnitTypeConfig(
                key=link["unit_type"],
                label=units[link["unit_type"]]["label"],
                description=units[link["unit_type"]].get("description") or "",
                level=int(link["level"]),
                is_leaf=bool(link.get("is_leaf")),
            )
            for link in sorted(
                (link for link in tables["project_type_unit_types"] if link["project_type"] == key),
                key=lambda link: link["level"],
            )
        )
        type_blocks = tuple(
            BlockTypeConfig(
                key=link["block_type"],
                label=blocks[link["block_type"]]["label"],
                description=blocks[link["block_type"]].get("description") or "",
                lane=blocks[link["block_type"]]["lane"],
                is_visual=bool(blocks[link["block_type"]].get("is_visual")),
                speaker_role=blocks[link["block_type"]].get("speaker_role") or "none",
                metadata_schema=blocks[link["block_type"]].get("metadata_schema"),
                sort_order=int(link.get("sort_order") or 0),
            )
            for link in sorted(
                (link for link in tables["project_type_block_types"] if link["project_type"] == key),
                key=lambda link: link.get("sort_order") or 0,
            )
        )
        if not type_formats or not type_units or not type_blocks:
            continue
        type_characters = offered_character_types(key)
        project_types[key] = ProjectTypeConfig(
            key=key,
            label=row["label"],
            description=row.get("description") or "",
            is_narrative=bool(row.get("is_narrative")),
            requires_outline=bool(row.get("requires_outline")),
            formats=type_formats,
            unit_types=type_units,
            block_types=type_blocks,
            character_types=tuple(item.key for item in type_characters),
            character_type_configs=type_characters,
        )
    if DEFAULT_PROJECT_TYPE not in project_types:
        raise RuntimeError("Script engine configuration is missing the default project type")
    return EngineConfig(
        project_types=project_types,
        character_types=character_types,
        character_type_configs=character_type_configs,
    )


CONFIG_TABLES = (
    "script_formats",
    "project_types",
    "script_unit_types",
    "script_block_types",
    "character_types",
    "project_type_formats",
    "project_type_unit_types",
    "project_type_block_types",
    "project_type_character_types",
)

_cache_lock = threading.Lock()
_cached: tuple[float, EngineConfig] | None = None


def load_engine_config(force: bool = False) -> EngineConfig:
    global _cached
    with _cache_lock:
        if not force and _cached and time.monotonic() - _cached[0] < CONFIG_CACHE_SECONDS:
            return _cached[1]
        supabase = require_supabase_client()
        tables = {
            table: list(getattr(supabase.table(table).select("*").execute(), "data", None) or [])
            for table in CONFIG_TABLES
        }
        config = build_engine_config(tables)
        _cached = (time.monotonic(), config)
        return config


def character_type_map() -> dict[str, CharacterTypeConfig]:
    """Every character type by key, or {} when the configuration cannot be loaded.

    Callers treat an unknown type as on camera, which is how characters behaved before
    types carried a presence, so a configuration outage never hides a character.
    """
    try:
        return dict(load_engine_config().character_type_configs)
    except Exception as error:  # noqa: BLE001 - degrade to "everyone on camera"
        logger.warning("Character type configuration unavailable: %s", error)
        return {}


@dataclass(frozen=True)
class ProjectScriptContext:
    project: dict[str, Any]
    type_config: ProjectTypeConfig
    format: FormatConfig


def load_project_script_context(project_id: str) -> ProjectScriptContext:
    """The project's row plus the configuration that governs its script."""
    supabase = require_supabase_client()
    result = supabase.table("projects").select(
        "id, name, description, settings, project_type, script_format"
    ).eq("id", project_id).execute()
    rows = getattr(result, "data", None) or []
    if not rows:
        raise ValueError("Project was not found")
    project = rows[0]
    type_config = load_engine_config().project_type(project.get("project_type"))
    return ProjectScriptContext(
        project=project,
        type_config=type_config,
        format=type_config.format(project.get("script_format")),
    )


def project_type_payload(config: ProjectTypeConfig) -> dict[str, Any]:
    """JSON-friendly view of one project type's configuration."""
    return {
        "key": config.key,
        "label": config.label,
        "description": config.description,
        "is_narrative": config.is_narrative,
        "requires_outline": config.requires_outline,
        "default_format": config.default_format.key,
        "formats": [fmt.__dict__ for fmt in config.formats],
        "unit_types": [unit.__dict__ for unit in config.unit_types],
        "leaf_unit_type": config.leaf_unit.key,
        "block_types": [block.__dict__ for block in config.block_types],
        "character_types": [asdict(item) for item in config.character_type_configs],
    }


def engine_config_payload(config: EngineConfig) -> dict[str, Any]:
    return {
        "project_types": [project_type_payload(pt) for pt in config.project_types.values()],
        "character_types": list(config.character_types),
    }
