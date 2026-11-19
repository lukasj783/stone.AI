"""Format-aware script generation for the Universal Script Engine.

Script generation runs in two steps for every project type:

1. Plan: the model breaks the source (outline or brief) into a tree of units using
   only the unit types the project type allows (Act > Scene, Chapter > Scene,
   Module > Lesson > Section...).
2. Write: each leaf unit is written as script blocks using only the project
   type's block types (Action/Dialogue for films, Narration/Interview/B-Roll for
   documentaries, Visual/Voice-Over/Product Shot for ads...).

Everything here is pure (prompt text in, validated rows out) so it can be tested
without calling the model or the database. The database triggers enforce the same
rules again on insert.
"""

import json
from dataclasses import dataclass, field
from typing import Any, Callable

from services.duration_budget import (
    budget_plan,
    max_unit_seconds,
    normalize_pacing,
    parse_duration_seconds,
    plan_duration_rules,
    plan_fit_problems,
    plan_retry_note,
    split_oversized_units,
    target_unit_count,
    unit_count_range,
    unit_length_guide,
)
from services.script_config import BlockTypeConfig, FormatConfig, ProjectTypeConfig


# ---------------------------------------------------------------------------
# JSON helpers
# ---------------------------------------------------------------------------


def parse_model_json(value: str) -> Any:
    """Parse JSON from a model reply, tolerating markdown fences and stray prose."""
    cleaned = (value or "").strip()
    if cleaned.startswith("```"):
        lines = cleaned.splitlines()
        cleaned = "\n".join(lines[1:-1] if lines and lines[-1].strip() == "```" else lines[1:]).strip()
    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        start = min((index for index in (cleaned.find("{"), cleaned.find("[")) if index >= 0), default=-1)
        end = max(cleaned.rfind("}"), cleaned.rfind("]"))
        if start < 0 or end <= start:
            raise
        return json.loads(cleaned[start : end + 1])


def _text(value: Any) -> str:
    return " ".join(str(value).split()) if isinstance(value, (str, int, float)) and not isinstance(value, bool) else ""


# ---------------------------------------------------------------------------
# Step 1: unit plan
# ---------------------------------------------------------------------------

STRUCTURE_GUIDANCE = {
    "feature_film": "Follow a three-act structure. Acts contain scenes; sequences are optional.",
    "short_film": "Keep a complete beginning, middle and end. Acts are optional for very short films.",
    "music_video": "Follow the song's structure (intro, verses, chorus, bridge, outro). Each segment is a stretch of the song.",
    "documentary": "Organise the film into thematic chapters. Each scene is one interview, location or event.",
    "advertisement": "Hook in the first seconds, show the product or benefit, end with a clear call to action. Keep the total within the requested duration.",
    "explainer": "Problem, solution, how it works, call to action. Keep each scene focused on one idea.",
    "educational": "Modules group lessons; each lesson has an introduction, explanation/demonstration sections and a short recap or check.",
}


def build_plan_prompt(
    type_config: ProjectTypeConfig,
    script_format: FormatConfig,
    source_label: str,
    source_body: str,
    characters_text: str,
    duration: str = "",
    pacing: str = "",
) -> str:
    leaf = type_config.leaf_unit
    unit_lines = "\n".join(
        f"- {unit.key} (level {unit.level}{', holds the script content' if unit.is_leaf else ''}): {unit.description}"
        for unit in type_config.unit_types
    )
    is_screenplay = script_format.renderer == "screenplay"
    leaf_fields = (
        '"slugline_raw": "INT. OR EXT. LOCATION - TIME", "location_type": "INT." | "EXT." | "INT./EXT.", '
        '"location": "LOCATION", "time_of_day": "TIME", "duration_seconds": 90'
        if is_screenplay
        else '"location": "Where it takes place, or null", "time_of_day": "DAY | NIGHT | null", "duration_seconds": 15'
    )
    target_seconds = parse_duration_seconds(duration)
    if target_seconds:
        duration_line = "\n" + plan_duration_rules(target_seconds, type_config.key, leaf.label, pacing)
    elif duration:
        duration_line = f"\nTarget duration: {duration}"
    else:
        duration_line = ""
    return f"""You are an expert {type_config.label.lower()} writer and story planner.
Break the source material into a structured plan for a {type_config.label} written as a {script_format.label}.
Do not write the script content yet; only plan the units.

{STRUCTURE_GUIDANCE.get(type_config.key, "")}{duration_line}

Allowed unit types (outermost first):
{unit_lines}

{source_label}
{source_body}

People / characters:
{characters_text}

Output ONLY valid JSON matching this shape, with no markdown fences:
{{
  "units": [
    {{
      "unit_type": "{type_config.container_units[0].key if type_config.container_units else leaf.key}",
      "title": "Short title",
      "summary": "What happens or is covered, and what it must achieve.",
      "children": [
        {{
          "unit_type": "{leaf.key}",
          "title": "Short title",
          "summary": "Detailed brief for this {leaf.label.lower()}: what is seen, who appears, what is said or explained.",
          {leaf_fields},
          "children": []
        }}
      ]
    }}
  ]
}}

Rules:
- Use only the allowed unit types. A unit may only contain unit types with a higher level number.
- Every branch must end in a "{leaf.key}"; only "{leaf.key}" units hold script content.
- Container levels are optional: you may place a "{leaf.key}" directly at the top level.
- Keep units in the order they will play.
- "duration_seconds" is the screen time of a "{leaf.key}" in whole seconds."""


@dataclass
class PlannedUnit:
    unit_type: str
    title: str
    summary: str
    is_leaf: bool
    slugline_raw: str | None = None
    location_type: str | None = None
    location: str | None = None
    time_of_day: str | None = None
    duration_seconds: float | None = None
    children: list["PlannedUnit"] = field(default_factory=list)

    def row(self) -> dict[str, Any]:
        """Column values for the scenes table (parent_id and sort_order are added on insert)."""
        return {
            "unit_type": self.unit_type,
            "title": self.title or None,
            "summary": self.summary or None,
            "slugline_raw": self.slugline_raw or (self.title if self.is_leaf else None),
            "location_type": self.location_type,
            "location": self.location,
            "time_of_day": self.time_of_day,
            "duration_seconds": self.duration_seconds,
            "status": "pending" if self.is_leaf else "complete",
        }


def _duration(value: Any) -> float | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)) and value >= 0:
        return float(value)
    return None


def normalize_unit_plan(parsed: Any, type_config: ProjectTypeConfig) -> list[PlannedUnit]:
    """Validate the model's unit tree against the project type's unit rules.

    Unknown unit types are re-labelled by position (a node with children becomes the
    next container level, a node without becomes the leaf); a leaf never keeps
    children; containers without any leaf below them are dropped. A flat legacy
    {"scenes": [...]} plan is accepted as top-level leaf units.
    """
    leaf = type_config.leaf_unit
    if isinstance(parsed, dict):
        raw_units = parsed.get("units")
        if raw_units is None:
            raw_units = parsed.get("scenes")
    else:
        raw_units = parsed
    if not isinstance(raw_units, list):
        return []

    def convert(raw: Any, min_level: int) -> PlannedUnit | None:
        if not isinstance(raw, dict):
            return None
        raw_children = raw.get("children") if isinstance(raw.get("children"), list) else []
        unit = type_config.unit(_text(raw.get("unit_type")).lower())
        if unit is None or unit.level < min_level:
            if raw_children:
                unit = next((u for u in type_config.container_units if u.level >= min_level), leaf)
            else:
                unit = leaf
        if unit.level < min_level:
            unit = leaf
        title = _text(raw.get("title")) or _text(raw.get("slugline_raw"))
        summary = _text(raw.get("summary"))
        if unit.is_leaf:
            if not title and not summary:
                return None
            return PlannedUnit(
                unit_type=unit.key,
                title=title,
                summary=summary,
                is_leaf=True,
                slugline_raw=_text(raw.get("slugline_raw")) or None,
                location_type=_text(raw.get("location_type")) or None,
                location=_text(raw.get("location")) or None,
                time_of_day=_text(raw.get("time_of_day")) or None,
                duration_seconds=_duration(raw.get("duration_seconds")),
            )
        children = [child for child in (convert(c, unit.level + 1) for c in raw_children) if child]
        if not children:
            return None
        return PlannedUnit(unit_type=unit.key, title=title, summary=summary, is_leaf=False, children=children)

    return [unit for unit in (convert(raw, 1) for raw in raw_units) if unit]


class PlanError(RuntimeError):
    """The model did not return a usable unit plan."""


# Extra model calls allowed when a plan does not fit the runtime.
PLAN_FIT_RETRIES = 2


def plan_to_runtime(
    run_model: Callable[[str], str],
    prompt: str,
    type_config: ProjectTypeConfig,
    duration: str = "",
    max_retries: int = PLAN_FIT_RETRIES,
    pacing: str = "",
) -> tuple[list[PlannedUnit], dict[str, Any]]:
    """Plan the units and make the plan fit the chosen runtime.

    1. Ask the model for a plan and budget it to the target (``budget_plan``).
    2. If the scene count is outside the range for this runtime, or a scene would
       run too long, send the plan back with the problems, up to ``max_retries`` times.
    3. If it still does not fit, split oversized scenes in code so no scene runs
       longer than ``max_unit_seconds``.

    Returns the plan and a report of what happened.
    """
    target_seconds = parse_duration_seconds(duration)
    leaf_label = type_config.leaf_unit.label
    attempt_prompt = prompt
    attempts: list[dict[str, Any]] = []
    best: tuple[list[PlannedUnit], dict[str, Any], list[str]] | None = None

    for attempt in range(max_retries + 1):
        try:
            plan = normalize_unit_plan(parse_model_json(run_model(attempt_prompt)), type_config)
        except json.JSONDecodeError as error:
            attempts.append({"attempt": attempt + 1, "error": f"invalid JSON: {error}"})
            plan = []
        if plan:
            budget = budget_plan(plan, target_seconds)
            problems = plan_fit_problems(plan, target_seconds, type_config.key, leaf_label, pacing)
            attempts.append({
                "attempt": attempt + 1,
                "unit_count": budget["unit_count"],
                "model_seconds": budget["model_seconds"],
                "problems": problems,
            })
            # Keep the plan with the fewest problems in case no attempt fits.
            if best is None or len(problems) < len(best[2]):
                best = (plan, budget, problems)
            if not problems:
                break
            attempt_prompt = prompt + plan_retry_note(problems)
        elif not attempts or "error" not in attempts[-1]:
            attempts.append({"attempt": attempt + 1, "error": "empty plan"})

    if best is None:
        raise PlanError("The model returned no usable script plan")
    plan, budget, problems = best
    split = split_oversized_units(plan, target_seconds, type_config.key, pacing) if problems else 0
    count = len(leaf_units(plan))
    low, high = unit_count_range(target_seconds, type_config.key, pacing) if target_seconds else (None, None)
    report = {
        **budget,
        "unit_count": count,
        "unit_count_range": [low, high] if target_seconds else None,
        "max_unit_seconds": max_unit_seconds(target_seconds, type_config.key, pacing) if target_seconds else None,
        "target_unit_count": target_unit_count(target_seconds, type_config.key, pacing) if target_seconds else None,
        "pacing": normalize_pacing(pacing) or None,
        "attempts": attempts,
        "split_units": split,
        "fits": not plan_fit_problems(plan, target_seconds, type_config.key, leaf_label, pacing),
    }
    return plan, report


def leaf_units(plan: list[PlannedUnit]) -> list[PlannedUnit]:
    leaves: list[PlannedUnit] = []
    for unit in plan:
        if unit.is_leaf:
            leaves.append(unit)
        else:
            leaves.extend(leaf_units(unit.children))
    return leaves


def plan_script(
    run_model: Callable[[str], str],
    type_config: ProjectTypeConfig,
    script_format: FormatConfig,
    source_label: str,
    source_body: str,
    characters_text: str,
    duration: str = "",
    pacing: str = "",
) -> tuple[list[PlannedUnit], dict[str, Any]]:
    """Plan the script units to fit the runtime: one plan call, re-asked when it
    does not fit (see plan_to_runtime).

    Planning long films act by act was tried and measured with the real model: it
    took 5-10 calls per plan and did not get closer to the scene target (the model
    delivers about 70% of the count asked for, per act as for a whole film), so the
    prompt asks for more scenes than the target instead (see requested_unit_count).
    """
    prompt = build_plan_prompt(
        type_config, script_format, source_label, source_body, characters_text, duration, pacing
    )
    return plan_to_runtime(run_model, prompt, type_config, duration, pacing=pacing)


# ---------------------------------------------------------------------------
# Step 2: blocks for one leaf unit
# ---------------------------------------------------------------------------

FORMAT_WRITING_RULES = {
    "screenplay": (
        "Write in standard screenplay style: present-tense action lines describing only what can be seen and heard, "
        "dialogue as spoken words only. Start with a scene_heading block when one is allowed."
    ),
    "two_column": (
        "Write an AV (two-column) script. Video blocks describe exactly what is on screen; audio blocks carry what is heard "
        "over it. Place each audio block right after the visual it plays over. Keep visual descriptions concrete enough "
        "to storyboard."
    ),
    "treatment": (
        "Write a music video treatment: vivid present-tense visuals, cut to the song. Put lyric lines in lyric blocks "
        "in the order they are sung, each followed by the visuals that accompany it."
    ),
    "instructional": (
        "Write a teaching script: the instructor or narrator explains one step at a time, each explanation followed by "
        "what the learner sees (demonstration, visual, graphic). Summarise with key points; add a quiz when the section "
        "ends a topic."
    ),
}


def _schema_keys(block: BlockTypeConfig) -> list[str]:
    properties = (block.metadata_schema or {}).get("properties")
    return sorted(properties) if isinstance(properties, dict) else []


def build_block_prompt(
    type_config: ProjectTypeConfig,
    script_format: FormatConfig,
    unit: dict[str, Any],
    characters_text: str,
    previous_context: str,
    genres: list[str] | None = None,
) -> str:
    leaf = type_config.leaf_unit
    block_lines = []
    for block in type_config.block_types:
        notes = [f"lane: {block.lane}"]
        if block.speaker_role == "required":
            notes.append("character_name REQUIRED")
        elif block.speaker_role == "optional":
            notes.append("character_name optional")
        keys = _schema_keys(block)
        if keys:
            notes.append("metadata keys: " + ", ".join(keys))
        block_lines.append(f"- {block.key}: {block.description} ({'; '.join(notes)})")

    heading = unit.get("slugline_raw") or unit.get("title") or leaf.label
    details = [f"{leaf.label}: {heading}"]
    if unit.get("summary"):
        details.append(f"Brief: {unit['summary']}")
    if unit.get("location"):
        details.append(f"Location: {unit['location']}")
    if unit.get("duration_seconds"):
        details.append(unit_length_guide(float(unit["duration_seconds"]), script_format.renderer))
    if unit.get("parent_title"):
        details.append(f"Part of: {unit['parent_title']}")
    genre_line = f"\nGenres / style: {', '.join(genres)}" if genres else ""

    return f"""You are an expert {type_config.label.lower()} writer.
You are writing ONE {leaf.label.lower()} of a {type_config.label} in {script_format.label} format.
{FORMAT_WRITING_RULES.get(script_format.renderer, "")}

{chr(10).join(details)}{genre_line}

People / characters:
{characters_text}

End of the previous {leaf.label.lower()}:
{previous_context}

Allowed block types (use ONLY these):
{chr(10).join(block_lines)}

Output ONLY valid JSON, with no markdown fences:
{{
  "blocks": [
    {{
      "block_type": "{type_config.primary_visual_block.key}",
      "content": "The text of the block.",
      "character_name": null,
      "parenthetical": null,
      "metadata": {{}}
    }}
  ]
}}

Rules:
- Use only the allowed block types, in the order they happen.
- character_name is the speaker's name in capitals for spoken blocks; null otherwise.
- metadata only uses the keys listed for that block type; use {{}} when there is nothing to add.
- Do not invent people or products that are not in the brief or the character list."""


@dataclass
class BlockRow:
    block_type: str
    content: str
    character_name: str | None
    parenthetical: str | None
    metadata: dict[str, Any]

    def row(self) -> dict[str, Any]:
        return {
            "block_type": self.block_type,
            "content": self.content,
            "character_name": self.character_name,
            "parenthetical": self.parenthetical,
            "metadata": self.metadata,
        }


DEFAULT_SPEAKERS = {"interview": "INTERVIEWEE", "dialogue": "SPEAKER"}

# Common names the model uses for block types the project type calls something else.
BLOCK_ALIASES = {
    "character": "dialogue",
    "vo": "voice_over",
    "voiceover": "voice_over",
    "v.o.": "voice_over",
    "broll": "b_roll",
    "b-roll": "b_roll",
    "super": "on_screen_text",
    "text": "on_screen_text",
    "cta": "call_to_action",
    "heading": "scene_heading",
    "slugline": "scene_heading",
    "animation": "graphic",
    "lower third": "lower_third",
}


def normalize_blocks(raw: Any, type_config: ProjectTypeConfig) -> list[BlockRow]:
    """Map the model's blocks onto the project type's allowed block types."""
    raw_blocks = raw.get("blocks") if isinstance(raw, dict) else raw
    if not isinstance(raw_blocks, list):
        return []
    allowed = type_config.block_keys
    spoken_fallback = type_config.primary_spoken_block
    visual_fallback = type_config.primary_visual_block

    rows: list[BlockRow] = []
    pending_speaker: str | None = None
    for raw_block in raw_blocks:
        if not isinstance(raw_block, dict):
            continue
        block_type = _text(raw_block.get("block_type")).lower().replace(" ", "_")
        block_type = BLOCK_ALIASES.get(block_type, block_type)
        content = str(raw_block.get("content") or "").strip()
        speaker = _text(raw_block.get("character_name")).upper() or None
        parenthetical = _text(raw_block.get("parenthetical")) or None
        metadata = raw_block.get("metadata") if isinstance(raw_block.get("metadata"), dict) else {}

        # A bare character cue names the speaker of the next spoken block.
        if _text(raw_block.get("block_type")).lower() == "character":
            if content and not raw_block.get("character_name") and len(content) < 60:
                pending_speaker = _text(content).upper()
                continue

        if block_type not in allowed:
            if block_type == "parenthetical" and spoken_fallback:
                # Formats without a parenthetical block keep it on the line it modifies.
                if rows and rows[-1].block_type in type_config.spoken_block_keys and not rows[-1].parenthetical:
                    rows[-1].parenthetical = content
                    continue
                parenthetical, block_type = content, spoken_fallback.key
                content = ""
            elif (speaker or pending_speaker) and spoken_fallback:
                block_type = spoken_fallback.key
            else:
                block_type = visual_fallback.key

        if not content:
            continue
        config = type_config.block(block_type)
        if config and config.speaker_role != "none":
            speaker = speaker or pending_speaker
            if config.speaker_role == "required" and not speaker:
                speaker = DEFAULT_SPEAKERS.get(block_type, "SPEAKER")
        else:
            speaker = None
        if block_type in type_config.spoken_block_keys:
            pending_speaker = None
        keys = _schema_keys(config) if config else []
        metadata = {key: value for key, value in metadata.items() if key in keys}
        rows.append(BlockRow(block_type, content, speaker, parenthetical, metadata))
    return rows


def blocks_context(rows: list[BlockRow], limit: int = 10) -> str:
    """Last few blocks of a unit, passed to the next unit so it flows on."""
    lines = []
    for row in rows[-limit:]:
        speaker = f" {row.character_name}:" if row.character_name else ""
        lines.append(f"[{row.block_type.upper()}]{speaker} {row.content}")
    return "\n".join(lines)
