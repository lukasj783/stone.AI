"""Script character profile: script facts with the user's manual choices layered on top.

Identity facts live on the character and never change between shots. They split into
core facts (columns on ``characters``) and physical facts (the ``characters.physical``
JSONB column, keyed by ``PHYSICAL_FIELDS``). Manual overrides for both are stored flat
in ``metadata.manual_overrides`` under the same field names. Shot-level state such as
expression, pose or action does not belong here.
"""

from services.visual_style import VisualStyle


CORE_CHARACTER_FIELDS = ("role", "age", "gender", "race", "appearance", "personality")

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


def effective_character_profile(character: dict[str, object]) -> dict[str, object]:
    """Return script facts with explicit manual profile choices layered over them.

    ``physical`` in the result is always a dict holding the merged physical facts.
    """
    effective = dict(character)
    physical = clean_physical(character.get("physical"))
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
    effective["physical"] = {name: physical[name] for name in PHYSICAL_FIELD_NAMES if name in physical}
    return effective


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
) -> str:
    """Build provider instructions from persisted facts without letting hints replace them."""
    character = effective_character_profile(character)
    fields = (
        ("Name", character.get("name")),
        ("Role", character.get("role")),
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
