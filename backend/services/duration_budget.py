"""Keep generated scripts, shot lists and clips close to the runtime the user chose.

The idea form stores the target as free text ("30 min", "1 hr", "90 sec"). This
module turns it into seconds and then budgets that time top-down:

1. Plan: every leaf unit (scene, segment, section...) gets ``duration_seconds`` and
   the leaves are rescaled so they add up to the target.
2. Write: each unit's budget is turned into a length guide for the writer
   (screenplay pages, spoken words).
3. Shots: a scene's budget is split across its shots and snapped to the clip
   lengths the video model can render.

Everything here is pure so it can be tested without the model or the database.
"""

import math
import re
from dataclasses import replace
from typing import Any, Protocol, Sequence


# ---------------------------------------------------------------------------
# Parsing the target
# ---------------------------------------------------------------------------

_UNIT_SECONDS = {
    "h": 3600, "hr": 3600, "hrs": 3600, "hour": 3600, "hours": 3600, "saa": 3600, "masaa": 3600,
    "m": 60, "min": 60, "mins": 60, "minute": 60, "minutes": 60, "dakika": 60,
    "s": 1, "sec": 1, "secs": 1, "second": 1, "seconds": 1, "sekunde": 1,
}
_NUMBER = r"(\d+(?:[.,]\d+)?)"
_RANGE = re.compile(_NUMBER + r"\s*(?:-|–|—|to)\s*" + _NUMBER)
_AMOUNT = re.compile(_NUMBER + r"\s*([a-z]+)?")
_CLOCK = re.compile(r"^(\d+):(\d{1,2})(?::(\d{1,2}))?$")


def _number(text: str) -> float:
    return float(text.replace(",", "."))


def parse_duration_seconds(value: Any) -> int | None:
    """Read a runtime like "30 min", "1 hr", "1h 30m", "90 sec", "1:30:00" or
    "Dakika 3–5" (a range uses its midpoint). A bare number is minutes.
    Returns whole seconds, or None when nothing sensible can be read."""
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return int(round(value * 60)) if value > 0 else None
    text = " ".join(str(value or "").lower().split())
    if not text:
        return None

    clock = _CLOCK.match(text)
    if clock:
        a, b, c = clock.groups()
        seconds = int(a) * 3600 + int(b) * 60 + int(c) if c else int(a) * 60 + int(b)
        return seconds or None

    # A unit word anywhere in the text ("Dakika 3–5", "3-5 min") applies to a range.
    words = re.findall(r"[a-z]+", text)
    unit_words = [w for w in words if w in _UNIT_SECONDS]
    range_match = _RANGE.search(text)
    if range_match and len(unit_words) <= 1:
        low, high = (_number(g) for g in range_match.groups())
        scale = _UNIT_SECONDS[unit_words[0]] if unit_words else 60
        seconds = (low + high) / 2 * scale
        return int(round(seconds)) or None

    total = 0.0
    found = False
    leading_unit = _UNIT_SECONDS.get(words[0]) if words and text.startswith(words[0]) else None
    for amount, unit in _AMOUNT.findall(text):
        scale = _UNIT_SECONDS.get(unit or "") or leading_unit or 60
        total += _number(amount) * scale
        found = True
    if not found or total <= 0:
        return None
    return int(round(total))


def format_seconds(seconds: float) -> str:
    """Human runtime: 45 s, 3 min, 1 h 30 min."""
    seconds = int(round(seconds))
    if seconds < 60:
        return f"{seconds} s"
    hours, rest = divmod(seconds, 3600)
    minutes, secs = divmod(rest, 60)
    parts = []
    if hours:
        parts.append(f"{hours} h")
    if minutes:
        parts.append(f"{minutes} min")
    if secs and not hours:
        parts.append(f"{secs} s")
    return " ".join(parts)


# ---------------------------------------------------------------------------
# Pacing per project type
# ---------------------------------------------------------------------------

# Typical length of one leaf unit and one shot, in seconds.
AVERAGE_UNIT_SECONDS = {
    "feature_film": 120,
    "short_film": 75,
    "music_video": 20,
    "documentary": 90,
    "advertisement": 6,
    "explainer": 20,
    "educational": 90,
}
AVERAGE_SHOT_SECONDS = {
    "feature_film": 6,
    "short_film": 6,
    "music_video": 4,
    "documentary": 7,
    "advertisement": 4,
    "explainer": 6,
    "educational": 8,
}
DEFAULT_UNIT_SECONDS = 60
DEFAULT_SHOT_SECONDS = 6

# Seedance 2.0 image-to-video renders whole-second clips in this range.
MIN_CLIP_SECONDS = 4
MAX_CLIP_SECONDS = 15

# Leaf units shorter than this are not worth a scene of their own.
MIN_UNIT_SECONDS = 3

# Screen-time rules of thumb.
SPOKEN_WORDS_PER_SECOND = 2.5  # about 150 words a minute
SCREENPLAY_LINES_PER_MINUTE = 55  # about one formatted page a minute

# Drift (as a fraction of the target) that is accepted without correction.
DEFAULT_TOLERANCE = 0.05


# Pacing chosen on the idea form. It scales the typical scene and shot length:
# action cuts between many short scenes, drama lets fewer, longer scenes play out.
PACING_FACTORS = {
    "action": (0.6, 0.6),   # (scene length, shot length)
    "comedy": (0.8, 0.85),
    "drama": (1.25, 1.2),
}
PACING_GUIDANCE = {
    "action": "Pacing: ACTION. Many short scenes, frequent location changes and intercutting; enter scenes late and leave early.",
    "comedy": "Pacing: COMEDY. Brisk scenes built around one comic situation or gag each; cut on the laugh.",
    "drama": "Pacing: DRAMA. Fewer, longer scenes that let conversations and emotional beats play out.",
}


def normalize_pacing(value: Any) -> str:
    """'action' | 'comedy' | 'drama', or '' when unknown (type defaults apply)."""
    text = " ".join(str(value or "").lower().split())
    return text if text in PACING_FACTORS else ""


def average_unit_seconds(project_type: str, pacing: str = "") -> float:
    base = AVERAGE_UNIT_SECONDS.get(project_type, DEFAULT_UNIT_SECONDS)
    return base * PACING_FACTORS.get(normalize_pacing(pacing), (1.0, 1.0))[0]


def unit_count_range(target_seconds: int, project_type: str, pacing: str = "") -> tuple[int, int]:
    """How many leaf units a plan of this length should have."""
    average = average_unit_seconds(project_type, pacing)
    low = max(1, math.floor(target_seconds / (average * 1.6)))
    high = max(low, math.ceil(target_seconds / (average * 0.6)))
    return low, high


def target_unit_count(target_seconds: int, project_type: str, pacing: str = "") -> int:
    """The scene count to aim for: runtime / typical scene length, kept inside the range."""
    low, high = unit_count_range(target_seconds, project_type, pacing)
    # Round halves up (not Python's round-half-to-even) to match the frontend estimate.
    aim = math.floor(target_seconds / average_unit_seconds(project_type, pacing) + 0.5)
    return min(high, max(low, aim))


def average_shot_seconds(project_type: str, pacing: str = "") -> int:
    base = AVERAGE_SHOT_SECONDS.get(project_type, DEFAULT_SHOT_SECONDS)
    factor = PACING_FACTORS.get(normalize_pacing(pacing), (1.0, 1.0))[1]
    return max(MIN_CLIP_SECONDS, round(base * factor))


def plan_duration_rules(target_seconds: int, project_type: str, leaf_label: str, pacing: str = "") -> str:
    """Prompt lines that make the plan add up to the target."""
    low, high = unit_count_range(target_seconds, project_type, pacing)
    aim = target_unit_count(target_seconds, project_type, pacing)
    average = round(average_unit_seconds(project_type, pacing))
    leaf = leaf_label.lower()
    guidance = PACING_GUIDANCE.get(normalize_pacing(pacing))
    pacing_line = f"\n- {guidance}" if guidance else ""
    return (
        f"Target duration: {format_seconds(target_seconds)} ({target_seconds} seconds of screen time).\n"
        f"- Give every \"{leaf}\" a realistic \"duration_seconds\" (screen time, whole seconds).\n"
        f"- The \"duration_seconds\" of all {leaf}s must add up to {target_seconds} seconds.\n"
        f"- Plan about {aim} {leaf}s (never fewer than {low} or more than {high}); "
        f"a typical {leaf} runs about {average} seconds.{pacing_line}"
    )


def unit_length_guide(duration_seconds: float, renderer: str) -> str:
    """Tell the writer how much material fits a unit's budget."""
    seconds = int(round(duration_seconds))
    max_words = int(seconds * SPOKEN_WORDS_PER_SECOND)
    guide = f"Target length: about {seconds} seconds of screen time"
    if renderer == "screenplay":
        lines = max(3, round(seconds / 60 * SCREENPLAY_LINES_PER_MINUTE))
        guide += f" (about {lines} formatted screenplay lines; one page is about one minute)"
    guide += f". Keep spoken words (dialogue, narration, voice-over, lyrics) under about {max_words} words."
    return guide


def planner_shot_guide(duration_seconds: float, project_type: str, pacing: str = "") -> str:
    """Prompt line asking the shot planner for a shot count that fits the scene."""
    average = average_shot_seconds(project_type, pacing)
    seconds = int(round(duration_seconds))
    shots = max(1, round(seconds / average))
    return (
        f"TARGET RUNTIME: this scene runs about {seconds} seconds. Aim for about {shots} shots "
        f"(each clip lasts {MIN_CLIP_SECONDS}-{MAX_CLIP_SECONDS} seconds, about {average} s on average)."
    )


# ---------------------------------------------------------------------------
# Budgeting a unit plan
# ---------------------------------------------------------------------------


class _Unit(Protocol):
    is_leaf: bool
    duration_seconds: float | None
    children: list[Any]


def _leaves(units: Sequence[_Unit]) -> list[_Unit]:
    found: list[_Unit] = []
    for unit in units:
        if unit.is_leaf:
            found.append(unit)
        else:
            found.extend(_leaves(unit.children))
    return found


def _sum_containers(units: Sequence[_Unit]) -> float:
    total = 0.0
    for unit in units:
        if not unit.is_leaf:
            unit.duration_seconds = _sum_containers(unit.children)
        total += unit.duration_seconds or 0
    return total


def distribute_integer(total: int, weights: Sequence[float], minimum: int = 0) -> list[int]:
    """Split ``total`` into whole numbers proportional to ``weights`` (largest
    remainder method), giving each part at least ``minimum`` when possible."""
    count = len(weights)
    if count == 0:
        return []
    if minimum * count >= total:
        base, extra = divmod(max(total, 0), count)
        return [base + (1 if i < extra else 0) for i in range(count)]
    safe = [float(w) if w > 0 else 0.0 for w in weights]
    if not sum(safe):
        safe = [1.0] * count
    weight_sum = sum(safe)
    raw = [total * w / weight_sum for w in safe]
    parts = [math.floor(r) for r in raw]
    order = sorted(range(count), key=lambda i: raw[i] - parts[i], reverse=True)
    for i in order[: total - sum(parts)]:
        parts[i] += 1
    # Lift parts below the minimum, taking the time from the largest parts.
    for i in range(count):
        while parts[i] < minimum:
            donor = max(range(count), key=lambda j: parts[j])
            if parts[donor] <= minimum:
                break
            parts[donor] -= 1
            parts[i] += 1
    return parts


def budget_plan(plan: Sequence[_Unit], target_seconds: int | None) -> dict[str, Any]:
    """Make the plan's leaf durations add up to ``target_seconds``.

    Leaves the model left without a duration get the average of the others (or an
    equal share). If the total then drifts more than the tolerance from the target,
    every leaf is rescaled proportionally. Containers get the sum of their children.
    Mutates the plan in place and returns a small report.
    """
    leaves = _leaves(plan)
    report: dict[str, Any] = {
        "target_seconds": target_seconds,
        "unit_count": len(leaves),
        "model_seconds": None,
        "planned_seconds": None,
        "rescaled": False,
    }
    if not leaves:
        return report

    known = [leaf.duration_seconds for leaf in leaves if leaf.duration_seconds]
    report["model_seconds"] = round(sum(known)) if known else None

    if not target_seconds:
        if known:
            fill = sum(known) / len(known)
            for leaf in leaves:
                if not leaf.duration_seconds:
                    leaf.duration_seconds = float(round(fill))
        report["planned_seconds"] = round(_sum_containers(plan)) if known else None
        return report

    if known:
        fill = sum(known) / len(known)
    else:
        fill = target_seconds / len(leaves)
    weights = [leaf.duration_seconds or fill for leaf in leaves]
    drift = abs(sum(weights) - target_seconds) / target_seconds
    if drift > DEFAULT_TOLERANCE or len(known) < len(leaves):
        minimum = MIN_UNIT_SECONDS if MIN_UNIT_SECONDS * len(leaves) <= target_seconds else 1
        seconds = distribute_integer(target_seconds, weights, minimum)
        report["rescaled"] = drift > DEFAULT_TOLERANCE
    else:
        seconds = [int(round(w)) for w in weights]
    for leaf, value in zip(leaves, seconds):
        leaf.duration_seconds = float(value)
    report["planned_seconds"] = round(_sum_containers(plan))
    return report


# ---------------------------------------------------------------------------
# Checking that the plan's shape fits the runtime
# ---------------------------------------------------------------------------

# A leaf unit may run at most this many times the type's typical length.
MAX_UNIT_FACTOR = 2.5


def max_unit_seconds(target_seconds: int, project_type: str, pacing: str = "") -> int:
    """Longest a single leaf unit may run. Never below what the smallest allowed
    unit count needs, so a plan inside the count range is never flagged for length."""
    average = average_unit_seconds(project_type, pacing)
    low, _ = unit_count_range(target_seconds, project_type, pacing)
    return max(math.ceil(average * MAX_UNIT_FACTOR), math.ceil(target_seconds / low))


def plan_fit_problems(
    plan: Sequence[_Unit],
    target_seconds: int | None,
    project_type: str,
    leaf_label: str = "scene",
    pacing: str = "",
) -> list[str]:
    """Why a budgeted plan does not fit the runtime (empty when it fits).

    Run after ``budget_plan``, so durations are the rescaled ones the scenes will
    actually get. The messages are written to be sent back to the model.
    """
    if not target_seconds:
        return []
    leaves = _leaves(plan)
    leaf = leaf_label.lower()
    low, high = unit_count_range(target_seconds, project_type, pacing)
    aim = target_unit_count(target_seconds, project_type, pacing)
    problems: list[str] = []
    if len(leaves) < low:
        problems.append(
            f"You planned {len(leaves)} {leaf}s for {format_seconds(target_seconds)}; plan about {aim} (between {low} and {high}). "
            f"Break long {leaf}s into separate beats."
        )
    elif len(leaves) > high:
        problems.append(
            f"You planned {len(leaves)} {leaf}s for {format_seconds(target_seconds)}; plan about {aim} (between {low} and {high}). "
            f"Merge {leaf}s that are the same continuous moment."
        )
    limit = max_unit_seconds(target_seconds, project_type, pacing)
    too_long = [unit for unit in leaves if (unit.duration_seconds or 0) > limit]
    if too_long:
        problems.append(
            f"{len(too_long)} {leaf}(s) would run longer than {format_seconds(limit)} once scaled to the runtime; "
            f"no {leaf} may exceed {limit} seconds."
        )
    return problems


def split_oversized_units(
    plan: list[Any], target_seconds: int | None, project_type: str, pacing: str = ""
) -> int:
    """Last resort when the model keeps planning too few, too long units: split
    each leaf longer than ``max_unit_seconds`` into consecutive parts of about the
    type's typical length. The parts keep the unit's brief, marked "Part i of n",
    so the writer continues the same moment. Mutates the plan; returns how many
    units were split."""
    if not target_seconds:
        return 0
    limit = max_unit_seconds(target_seconds, project_type, pacing)
    average = average_unit_seconds(project_type, pacing)
    split_count = 0

    def visit(units: list[Any]) -> list[Any]:
        nonlocal split_count
        result: list[Any] = []
        for unit in units:
            if not unit.is_leaf:
                unit.children = visit(unit.children)
                result.append(unit)
                continue
            seconds = unit.duration_seconds or 0
            if seconds <= limit:
                result.append(unit)
                continue
            parts = max(2, round(seconds / average))
            lengths = distribute_integer(int(round(seconds)), [1.0] * parts)
            split_count += 1
            for index, length in enumerate(lengths, start=1):
                label = f"Part {index} of {parts}"
                result.append(replace(
                    unit,
                    title=f"{unit.title} ({label})" if unit.title else label,
                    summary=f"{label}: {'begin' if index == 1 else 'continue'} this moment. {unit.summary}".strip(),
                    duration_seconds=float(length),
                ))
        return result

    plan[:] = visit(plan)
    if split_count:
        _sum_containers(plan)
    return split_count


def plan_retry_note(problems: Sequence[str]) -> str:
    """Appended to the plan prompt when the previous plan did not fit."""
    lines = "\n".join(f"- {problem}" for problem in problems)
    return (
        "\n\nYour previous plan did not fit the target duration:\n"
        f"{lines}\n"
        "Return the complete corrected plan, following every rule above."
    )


# ---------------------------------------------------------------------------
# Shot durations
# ---------------------------------------------------------------------------


def spoken_seconds(text: str) -> float:
    words = len(re.findall(r"[\w']+", text or ""))
    return words / SPOKEN_WORDS_PER_SECOND


def shot_weight(spoken_text: str, visual_text: str = "") -> float:
    """Relative screen time a shot needs: spoken lines set a floor, visuals add a little."""
    visual_words = len(re.findall(r"[\w']+", visual_text or ""))
    return max(1.0, spoken_seconds(spoken_text) + 0.5, min(visual_words / 6, 6.0))


def allocate_shot_durations(
    scene_seconds: float | None,
    weights: Sequence[float],
    project_type: str = "",
    min_seconds: int = MIN_CLIP_SECONDS,
    max_seconds: int = MAX_CLIP_SECONDS,
    pacing: str = "",
) -> list[int]:
    """Split a scene's budget across its shots as clip lengths the model can render.

    Each shot gets a share proportional to its weight, clamped to
    ``[min_seconds, max_seconds]``. Time a clamped shot cannot take is moved to the
    shots that still have room, so the total matches the budget whenever the
    shot count allows it. Without a budget, each shot gets the type's average
    shot length (stretched for long spoken lines).
    """
    count = len(weights)
    if count == 0:
        return []
    if not scene_seconds or scene_seconds <= 0:
        average = average_shot_seconds(project_type, pacing)
        return [
            int(min(max_seconds, max(min_seconds, math.ceil(max(average, w)))))
            for w in weights
        ]

    target = int(round(min(max(scene_seconds, count * min_seconds), count * max_seconds)))
    durations = distribute_integer(target, weights, 0)
    # Clamp and redistribute until every shot is inside the allowed range.
    for _ in range(count + 1):
        durations = [min(max_seconds, max(min_seconds, d)) for d in durations]
        diff = target - sum(durations)
        if diff == 0:
            break
        if diff > 0:
            room = [i for i in range(count) if durations[i] < max_seconds]
        else:
            room = [i for i in range(count) if durations[i] > min_seconds]
        if not room:
            break
        extra = distribute_integer(abs(diff), [weights[i] for i in room], 0)
        for i, amount in zip(room, extra):
            durations[i] += amount if diff > 0 else -amount
    return [min(max_seconds, max(min_seconds, d)) for d in durations]


def runtime_report(target_seconds: int | None, actual_seconds: float) -> dict[str, Any]:
    """Target vs. actual, with the drift as a signed fraction of the target."""
    drift = (actual_seconds - target_seconds) / target_seconds if target_seconds else None
    return {
        "target_seconds": target_seconds,
        "actual_seconds": round(actual_seconds, 3),
        "drift": round(drift, 4) if drift is not None else None,
        "within_tolerance": drift is not None and abs(drift) <= DEFAULT_TOLERANCE,
    }
