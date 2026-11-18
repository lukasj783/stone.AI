"""Plan a scene's shot list with a language model.

The planner reads the whole scene at once, so it can split one screenplay line into
several shots, merge consecutive lines into one shot, and vary coverage between
neighbouring shots. It only decides *what* each shot shows and how it is framed; the
image prompt itself is still assembled deterministically by the storyboard service.
"""

import json
from typing import Any

from services.gemini_client import GeminiError, run_gemini
from services.storyboard_references import FACINGS, normalize_facing


PLANNER_DEADLINE_SECONDS = 120.0

SHOT_SIZES = (
    "extreme wide shot",
    "wide shot",
    "full shot",
    "medium shot",
    "medium close-up",
    "close-up",
    "extreme close-up",
    "two shot",
    "over-the-shoulder shot",
    "point-of-view shot",
    "insert shot",
)
CAMERA_ANGLES = ("eye level", "low angle", "high angle", "overhead", "dutch angle")
DEFAULT_SHOT_SIZE = "medium shot"
DEFAULT_CAMERA_ANGLE = "eye level"

PLANNER_SYSTEM_INSTRUCTION = (
    "You are a film director's storyboard artist. You break a screenplay scene into a "
    "shot list. You reply with raw JSON only."
)


class ShotPlanningError(RuntimeError):
    """The language model could not produce a usable shot list."""


PRODUCTION_COVERAGE = {
    "Documentary": "Interview answers are talking-head shots (medium close-ups, eyes just off camera); narration plays over b-roll and archival material, so illustrate what it describes.",
    "Advertisement": "Favour bold, clean compositions; give the product hero framing (insert or close-up) and end on the call to action.",
    "Explainer": "Keep frames simple and readable; one idea per frame; graphics and demonstrations are framed to be understood at a glance.",
    "Educational": "Frame demonstrations so the learner can see the hands, tool or screen clearly; use inserts for detail.",
    "Music Video": "Alternate performance coverage with story visuals, cutting on the song's rhythm.",
}


def build_planner_prompt(
    scene_heading: str,
    script_lines: list[dict[str, Any]],
    character_names: list[str],
    prop_names: list[str],
    max_shots: int,
    production: str = "Film",
) -> str:
    rendered_lines = []
    for line in script_lines:
        prefix = f"[{line['number']}]" if line.get("number") else "   "
        rendered_lines.append(f"{prefix} {line['label']}: {line['text']}")
    script_text = "\n".join(rendered_lines)
    characters_text = ", ".join(character_names) if character_names else "none listed"
    props_text = ", ".join(prop_names) if prop_names else "none listed"

    coverage = PRODUCTION_COVERAGE.get(production, "")
    coverage_line = f"\nCOVERAGE STYLE: {coverage}" if coverage else ""
    return f"""Break this {production.lower()} script unit into a storyboard shot list.

PRODUCTION: {production}{coverage_line}
SCENE: {scene_heading}
KNOWN CHARACTERS: {characters_text}
KNOWN PROPS: {props_text}

SCRIPT (numbered lines must be storyboarded; unnumbered lines are context only):
{script_text}

Rules:
- Every numbered line must be covered by at least one shot. List the line numbers a shot covers in "lines".
- Split a line into several shots only when it holds distinct visual beats. Merge consecutive lines into one shot when they are a single continuous moment. Most lines need 1 to 3 shots.
- Keep shots in script order. Use at most {max_shots} shots in total.
- "description" is one or two present-tense sentences describing what is visible in a single still frame. Name each visible character with the exact name from KNOWN CHARACTERS instead of a pronoun.
- Never put spoken dialogue, quoted words, captions, or on-screen text in a description. For a dialogue line, describe the speaker talking or a listener reacting.
- Do not invent story events, characters, or props that are not in the script.
- Vary shot sizes across neighbouring shots the way an editor would cut the scene. Open with an establishing shot when the location is new.
- "shot_size" must be one of: {", ".join(SHOT_SIZES)}.
- "camera_angle" must be one of: {", ".join(CAMERA_ANGLES)}.
- "characters" lists the KNOWN CHARACTERS visible in the shot. "props" lists the KNOWN PROPS visible in the shot.
- "character_facing" maps each listed character to the direction they face relative to the camera, one of: {", ".join(FACINGS)}. Screen left/right are as the audience sees the frame. In an over-the-shoulder shot the foreground character is "away from camera".

Output ONLY valid JSON matching this schema, with no markdown fences:
{{
  "shots": [
    {{
      "lines": [1],
      "description": "What the frame shows.",
      "shot_size": "wide shot",
      "camera_angle": "eye level",
      "characters": ["NAME"],
      "character_facing": {{"NAME": "toward camera"}},
      "props": []
    }}
  ]
}}"""


def _run_planner_model(prompt: str) -> str:
    try:
        return run_gemini(
            prompt,
            system_instruction=PLANNER_SYSTEM_INSTRUCTION,
            temperature=0.3,
            deadline_seconds=PLANNER_DEADLINE_SECONDS,
        )
    except GeminiError as error:
        raise ShotPlanningError(str(error)) from error


def _parse_json(value: str) -> object:
    cleaned = value.strip()
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


def _pick(value: Any, allowed: tuple[str, ...], default: str) -> str:
    text = " ".join(str(value or "").lower().split())
    return text if text in allowed else default


def _string_list(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    return [" ".join(item.split()) for item in value if isinstance(item, str) and item.strip()]


def normalize_shot_plans(parsed: object, valid_line_numbers: set[int]) -> list[dict[str, Any]]:
    """Keep only well-formed shots that point at real script lines."""
    raw_shots = parsed.get("shots") if isinstance(parsed, dict) else parsed
    if not isinstance(raw_shots, list):
        return []
    plans: list[dict[str, Any]] = []
    for raw in raw_shots:
        if not isinstance(raw, dict):
            continue
        description = " ".join(str(raw.get("description") or "").split())
        raw_lines = raw.get("lines")
        if not isinstance(raw_lines, list):
            raw_lines = [raw_lines]
        lines = sorted({
            number
            for number in raw_lines
            if isinstance(number, int) and not isinstance(number, bool) and number in valid_line_numbers
        })
        if not description or not lines:
            continue
        plans.append({
            "lines": lines,
            "description": description,
            "shot_size": _pick(raw.get("shot_size"), SHOT_SIZES, DEFAULT_SHOT_SIZE),
            "camera_angle": _pick(raw.get("camera_angle"), CAMERA_ANGLES, DEFAULT_CAMERA_ANGLE),
            "characters": _string_list(raw.get("characters")),
            "character_facing": _facing_map(raw.get("character_facing")),
            "props": _string_list(raw.get("props")),
        })
    return plans


def _facing_map(value: Any) -> dict[str, str]:
    """Keep only character names mapped to a known facing direction."""
    if not isinstance(value, dict):
        return {}
    facing: dict[str, str] = {}
    for name, direction in value.items():
        label = " ".join(str(name or "").split())
        normalized = normalize_facing(direction)
        if label and normalized:
            facing[label] = normalized
    return facing


def plan_scene_shots(
    scene_heading: str,
    script_lines: list[dict[str, Any]],
    character_names: list[str],
    prop_names: list[str],
    max_shots: int,
    production: str = "Film",
) -> list[dict[str, Any]]:
    """Ask the language model for a shot list and return the validated shots."""
    valid_line_numbers = {int(line["number"]) for line in script_lines if line.get("number")}
    if not valid_line_numbers:
        raise ShotPlanningError("Scene has no lines to plan shots for")
    prompt = build_planner_prompt(scene_heading, script_lines, character_names, prop_names, max_shots, production)
    try:
        parsed = _parse_json(_run_planner_model(prompt))
    except ShotPlanningError:
        raise
    except Exception as error:
        raise ShotPlanningError(f"Shot planner call failed: {error}") from error
    plans = normalize_shot_plans(parsed, valid_line_numbers)
    if not plans:
        raise ShotPlanningError("Shot planner returned no usable shots")
    return plans
