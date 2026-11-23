"""Script character profile: script facts with the user's manual choices layered on top.

Identity facts live on the character and never change between shots. They split into
core facts (columns on ``characters``) and physical facts (the ``characters.physical``
JSONB column, keyed by ``PHYSICAL_FIELDS``). Manual overrides for both are stored flat
in ``metadata.manual_overrides`` under the same field names. Shot-level state such as
expression, pose or action does not belong here.

The character's type (``character_type``) says how they exist in the production: a
voice-only type (narrator) is heard and never drawn; ``on_camera`` overrides that for one
character. Every speaker has a ``voice`` (``VOICE_FIELDS``), and ``type_details`` holds the
fields the type asks for (a spokesperson's brand, a host's show). Overrides for these use
the keys ``character_type``, ``on_camera``, ``voice.<field>`` and ``type_details.<field>``.
"""

import re
from collections.abc import Mapping
from typing import Any

from services.visual_style import VisualStyle


CORE_CHARACTER_FIELDS = ("role", "age", "gender", "race", "appearance", "personality")

# How a character sounds, in the order prompts and the profile list it.
VOICE_FIELDS: tuple[tuple[str, str], ...] = (
    ("tone", "Tone"),
    ("accent", "Accent"),
    ("pace", "Pace"),
    ("pitch", "Pitch / vocal age"),
    ("delivery", "Delivery notes"),
)
VOICE_FIELD_NAMES = tuple(name for name, _ in VOICE_FIELDS)
VOICE_PREFIX = "voice."
TYPE_DETAILS_PREFIX = "type_details."
ROLE_OVERRIDE_FIELDS = ("character_type", "on_camera")
PROFILE_TEXT_MAX_CHARS = 500
DETAIL_KEY_PATTERN = re.compile(r"^[a-z][a-z0-9_]{0,63}$")
VOICE_ONLY_PRESENCE = "voice_only"

# Permanent physical identity, in the order prompts list it.
PHYSICAL_FIELDS: tuple[tuple[str, str], ...] = (
    ("height", "Height"),
    ("build", "Build"),
    ("skin_tone", "Skin tone"),
    ("face", "Face"),
    ("eyes", "Eyes"),
    ("hair", "Hair"),
    ("facial_hair", "Facial hair"),
    ("distinguishing_marks", "Distinguishing marks"),
    ("glasses", "Glasses"),
    ("demeanor", "Demeanor"),
)
PHYSICAL_FIELD_NAMES = tuple(name for name, _ in PHYSICAL_FIELDS)

EDITABLE_CHARACTER_FIELDS = CORE_CHARACTER_FIELDS + PHYSICAL_FIELD_NAMES


def clean_physical(value: object) -> dict[str, str]:
    """Known physical keys with non-empty string values, in canonical order."""
    if not isinstance(value, dict):
        return {}
    cleaned: dict[str, str] = {}
    for name in PHYSICAL_FIELD_NAMES:
        item = value.get(name)
        if isinstance(item, str) and item.strip():
            cleaned[name] = item.strip()
    return cleaned


def clean_voice(value: object) -> dict[str, str]:
    """Known voice keys with non-empty string values, in canonical order."""
    if not isinstance(value, dict):
        return {}
    cleaned: dict[str, str] = {}
    for name in VOICE_FIELD_NAMES:
        item = value.get(name)
        if isinstance(item, str) and item.strip():
            cleaned[name] = item.strip()[:PROFILE_TEXT_MAX_CHARS]
    return cleaned


def clean_type_details(value: object, allowed_keys: tuple[str, ...] | None = None) -> dict[str, str]:
    """Type-specific details as {key: short text}; only ``allowed_keys`` when given."""
    if not isinstance(value, dict):
        return {}
    keys = allowed_keys if allowed_keys is not None else tuple(value)
    cleaned: dict[str, str] = {}
    for key in keys:
        item = value.get(key)
        if isinstance(key, str) and DETAIL_KEY_PATTERN.match(key) and isinstance(item, str) and item.strip():
            cleaned[key] = item.strip()[:PROFILE_TEXT_MAX_CHARS]
    return cleaned


def is_override_field(field: str) -> bool:
    """True for every key the profile editor may set or clear in ``manual_overrides``."""
    if field in EDITABLE_CHARACTER_FIELDS or field in ROLE_OVERRIDE_FIELDS:
        return True
    if field.startswith(VOICE_PREFIX):
        return field[len(VOICE_PREFIX):] in VOICE_FIELD_NAMES
    if field.startswith(TYPE_DETAILS_PREFIX):
        return bool(DETAIL_KEY_PATTERN.match(field[len(TYPE_DETAILS_PREFIX):]))
    return False


def effective_character_profile(character: dict[str, object]) -> dict[str, object]:
    """Return script facts with explicit manual profile choices layered over them.

    ``physical``, ``voice`` and ``type_details`` in the result are always dicts holding
    the merged facts; ``character_type`` and ``on_camera`` carry any manual choice.
    """
    effective = dict(character)
    physical = clean_physical(character.get("physical"))
    voice = clean_voice(character.get("voice"))
    type_details = clean_type_details(character.get("type_details"))
    metadata = character.get("metadata")
    overrides = metadata.get("manual_overrides") if isinstance(metadata, dict) else None
    if isinstance(overrides, dict):
        for field in EDITABLE_CHARACTER_FIELDS:
            value = overrides.get(field)
            if isinstance(value, str) and value.strip():
                if field in PHYSICAL_FIELD_NAMES:
                    physical[field] = value.strip()
                else:
                    effective[field] = value.strip()
            elif field == "age" and isinstance(value, int) and not isinstance(value, bool):
                effective[field] = value
        if isinstance(overrides.get("character_type"), str) and overrides["character_type"].strip():
            effective["character_type"] = overrides["character_type"].strip()
        if isinstance(overrides.get("on_camera"), bool):
            effective["on_camera"] = overrides["on_camera"]
        for key, value in overrides.items():
            if not isinstance(key, str) or not isinstance(value, str) or not value.strip():
                continue
            if key.startswith(VOICE_PREFIX) and key[len(VOICE_PREFIX):] in VOICE_FIELD_NAMES:
                voice[key[len(VOICE_PREFIX):]] = value.strip()
            elif key.startswith(TYPE_DETAILS_PREFIX) and DETAIL_KEY_PATTERN.match(key[len(TYPE_DETAILS_PREFIX):]):
                type_details[key[len(TYPE_DETAILS_PREFIX):]] = value.strip()
    effective["physical"] = {name: physical[name] for name in PHYSICAL_FIELD_NAMES if name in physical}
    effective["voice"] = {name: voice[name] for name in VOICE_FIELD_NAMES if name in voice}
    effective["type_details"] = type_details
    return effective


def is_on_camera(character: dict[str, object], character_types: Mapping[str, Any]) -> bool:
    """Whether the character is ever seen. ``on_camera`` wins; otherwise the type decides,
    and an unknown type counts as on camera."""
    effective = effective_character_profile(character)
    explicit = effective.get("on_camera")
    if isinstance(explicit, bool):
        return explicit
    type_config = character_types.get(str(effective.get("character_type") or ""))
    return getattr(type_config, "presence", None) != VOICE_ONLY_PRESENCE


def addresses_camera(character: dict[str, object], character_types: Mapping[str, Any]) -> bool:
    """Whether an on-camera character talks straight to the lens (presenter, host...)."""
    type_config = character_types.get(str(effective_character_profile(character).get("character_type") or ""))
    return bool(getattr(type_config, "addresses_camera", False)) and is_on_camera(character, character_types)


def type_detail_lines(character: dict[str, object], type_config: Any) -> list[tuple[str, str]]:
    """(label, value) for the type's details the character has, in the type's field order."""
    details = effective_character_profile(character)["type_details"]
    assert isinstance(details, dict)
    return [
        (field.label, details[field.key])
        for field in getattr(type_config, "detail_fields", ()) or ()
        if details.get(field.key)
    ]


def role_summary(character: dict[str, object], character_types: Mapping[str, Any]) -> str:
    """One line naming the character's type and its details, e.g.
    'Spokesperson; Brand represented: Pepsi; Brand look: blue jacket'. Empty for plain types."""
    effective = effective_character_profile(character)
    type_config = character_types.get(str(effective.get("character_type") or ""))
    lines = type_detail_lines(character, type_config) if type_config else []
    if not lines and not getattr(type_config, "addresses_camera", False):
        return ""
    label = str(getattr(type_config, "label", "") or "")
    return "; ".join([label, *(f"{name}: {value}" for name, value in lines)])


def physical_fact_lines(character: dict[str, object]) -> list[tuple[str, str]]:
    """(label, value) pairs for the character's known physical facts, overrides applied."""
    physical = effective_character_profile(character)["physical"]
    assert isinstance(physical, dict)
    return [(label, physical[name]) for name, label in PHYSICAL_FIELDS if name in physical]


def physical_summary(character: dict[str, object]) -> str:
    """One line of physical facts for compact prompts, e.g. 'Height: tall; Hair: short black'."""
    return "; ".join(f"{label}: {value}" for label, value in physical_fact_lines(character))


def build_script_character_profile(
    character: dict[str, object],
    visual_style: VisualStyle | None = None,
    character_types: Mapping[str, Any] | None = None,
) -> str:
    """Build provider instructions from persisted facts without letting hints replace them."""
    on_screen_role = role_summary(character, character_types) if character_types else ""
    character = effective_character_profile(character)
    fields = (
        ("Name", character.get("name")),
        ("Role", character.get("role")),
        ("On-screen role", on_screen_role),
        ("Age", character.get("age")),
        ("Gender", character.get("gender")),
        ("Race", character.get("race")),
        *physical_fact_lines(character),
        ("Appearance", character.get("appearance")),
        ("Personality", character.get("personality")),
    )
    facts = "\n".join(
        f"- {label}: {value}"
        for label, value in fields
        if value is not None and value != ""
    )
    if not facts:
        raise ValueError("The script does not contain visual character details to generate")

    sections = [
        "Canonical character facts (authoritative; preserve exactly):",
        facts,
        (
            "Do not change or contradict any known age, gender, role, race, physical, appearance, "
            "or personality fact. Do not invent missing demographic or identity details."
        ),
    ]
    metadata = character.get("metadata") or {}
    image_prompt = metadata.get("image_prompt") if isinstance(metadata, dict) else None
    if isinstance(image_prompt, str) and image_prompt.strip():
        sections.extend(("Supplementary visual details from the screenplay:", image_prompt.strip()))
    if visual_style:
        sections.extend(("", visual_style.prompt_block()))
    return "\n\n".join(sections)
