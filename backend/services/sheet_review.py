"""Check that a generated character sheet really holds a face close-up and the turnaround.

Image models do not always follow a layout prompt: an edit model may just retouch the
reference photo, or drop the back view, or draw two people. Every sheet is checked before
it is kept, and the caller retries with the problems spelled out when the check fails.

By default the check is a layout check, so the character flow never calls Replicate: on
the requested plain background it finds the face close-up in the left third and counts the
full-body figures to its right. Set CHARACTER_SHEET_REVIEW=vision to have Gemini (on
Replicate) list what the sheet contains and where the face is; the layout check then
stands in whenever Gemini cannot answer.
"""

from __future__ import annotations

import json
import logging
import os
import re
from dataclasses import dataclass, field
from typing import Any

from PIL import Image, ImageChops

from services.gemini_client import run_gemini

logger = logging.getLogger(__name__)

REQUIRED_VIEWS = ("front", "three_quarter", "profile", "back")
VIEW_NAMES = {
    "front": "front view",
    "three_quarter": "three-quarter view",
    "profile": "side profile view",
    "back": "back view",
}
FACE_PANEL_SHARE = 0.34

REVIEW_SYSTEM = "You inspect character model sheets for a film production pipeline. Answer with JSON only."
REVIEW_PROMPT = """\
Image 1 is a generated character model sheet. It is meant to contain, for ONE character:
- one large head-and-shoulders face close-up (usually on the left), and
- a full-body turnaround: a front view, a three-quarter view, a side profile view and a back view,
  each showing the whole body from head to feet.
{references}
Report what image 1 actually contains as JSON with exactly these keys:
{{
  "face_closeup": true or false,
  "face_box": [ymin, xmin, ymax, xmax] of the face close-up on a 0-1000 scale, or null,
  "views": the full-body views present, using only "front", "three_quarter", "profile", "back",
  "full_body": true if every turnaround figure shows the whole body from head to feet,
  "one_character": true if the close-up and every figure are the same single person,
  "matches_references": true or false (face and outfit match the reference images), or null when there are none,
  "text_or_labels": true if the sheet has any text, labels, numbers or panel borders,
  "problems": one short sentence naming what is missing or wrong, or ""
}}
"""


@dataclass
class SheetReview:
    ok: bool
    method: str  # "vision" or "layout"
    face_closeup: bool = False
    views: list[str] = field(default_factory=list)
    problems: list[str] = field(default_factory=list)
    # Face close-up as [ymin, xmin, ymax, xmax] on a 0-1000 scale, when known.
    face_box: list[int] | None = None
    text_or_labels: bool = False

    def as_record(self) -> dict[str, Any]:
        return {
            "ok": self.ok,
            "method": self.method,
            "face_closeup": self.face_closeup,
            "views": self.views,
            "problems": self.problems,
            "face_box": self.face_box,
            "text_or_labels": self.text_or_labels,
        }


# --------------------------------------------------------------------------- image regions


def background_color(image: Image.Image) -> tuple[int, int, int]:
    """Average the corners and top middle, which are studio background on a sheet."""
    rgb = image.convert("RGB")
    width, height = rgb.size
    points = [(0, 0), (width - 1, 0), (0, height - 1), (width - 1, height - 1), (width // 2, 0)]
    samples = [rgb.getpixel(point) for point in points]
    return tuple(sum(int(sample[channel]) for sample in samples) // len(samples) for channel in range(3))  # type: ignore[return-value,index]


def foreground_mask(image: Image.Image, background: tuple[int, int, int], threshold: int = 36) -> Image.Image:
    difference = ImageChops.difference(image.convert("RGB"), Image.new("RGB", image.size, background))
    red, green, blue = difference.split()
    strongest = ImageChops.lighter(ImageChops.lighter(red, green), blue)
    return strongest.point(lambda value: 255 if value > threshold else 0)


def column_runs(mask: Image.Image, min_width: int) -> list[tuple[int, int]]:
    """[start, end) runs of columns that contain foreground, at least ``min_width`` wide."""
    width, _ = mask.size
    profile = mask.resize((width, 1), Image.Resampling.BOX).tobytes()  # one byte per column
    runs: list[tuple[int, int]] = []
    start: int | None = None
    for column, value in enumerate([*profile, 0]):
        filled = value / 255 >= 0.004
        if filled and start is None:
            start = column
        elif not filled and start is not None:
            if column - start >= min_width:
                runs.append((start, column))
            start = None
    return runs


def layout_review(image: Image.Image) -> SheetReview:
    """Background-based check: a close-up on the left and four tall figures to its right."""
    rgb = image.convert("RGB")
    width, height = rgb.size
    mask = foreground_mask(rgb, background_color(rgb))
    panel_width = int(width * FACE_PANEL_SHARE)
    problems: list[str] = []

    face_runs = column_runs(mask.crop((0, 0, panel_width, height)), max(2, int(panel_width * 0.25)))
    face_closeup = False
    if face_runs:
        start, end = face_runs[0]
        bbox = mask.crop((start, 0, end, height)).getbbox()
        face_closeup = bool(bbox and bbox[3] - bbox[1] >= height * 0.3)
    if not face_closeup:
        problems.append("no face close-up in the left third")

    # Thin gaps (between an arm and the body) are bridged by the minimum width; tall runs are figures.
    figures = 0
    right = mask.crop((panel_width, 0, width, height))
    for start, end in column_runs(right, max(2, int(width * 0.02))):
        bbox = right.crop((start, 0, end, height)).getbbox()
        if bbox and bbox[3] - bbox[1] >= height * 0.55:
            figures += 1
    if figures < len(REQUIRED_VIEWS):
        problems.append(f"found {figures} full-body figures, need {len(REQUIRED_VIEWS)} (front, three-quarter, profile, back)")
    views = list(REQUIRED_VIEWS[:min(figures, len(REQUIRED_VIEWS))])
    return SheetReview(ok=not problems, method="layout", face_closeup=face_closeup, views=views, problems=problems)


# --------------------------------------------------------------------------- vision review


def _parse_json(text: str) -> dict[str, Any]:
    match = re.search(r"\{.*\}", text, re.DOTALL)
    if not match:
        raise ValueError("no JSON object in the review")
    parsed = json.loads(match.group(0))
    if not isinstance(parsed, dict):
        raise ValueError("the review is not a JSON object")
    return parsed


def _face_box(value: object) -> list[int] | None:
    if not isinstance(value, list) or len(value) != 4:
        return None
    try:
        ymin, xmin, ymax, xmax = (max(0, min(1000, round(float(part)))) for part in value)
    except (TypeError, ValueError):
        return None
    return [ymin, xmin, ymax, xmax] if ymax - ymin >= 50 and xmax - xmin >= 50 else None


def review_from_answer(answer: dict[str, Any], has_references: bool) -> SheetReview:
    """Turn the vision model's JSON into a pass/fail review with readable problems."""
    raw_views = answer.get("views") if isinstance(answer.get("views"), list) else []
    views = [view for view in REQUIRED_VIEWS if view in {str(item).strip().casefold().replace("-", "_") for item in raw_views}]
    problems: list[str] = []
    face_closeup = answer.get("face_closeup") is True
    if not face_closeup:
        problems.append("no face close-up")
    missing = [VIEW_NAMES[view] for view in REQUIRED_VIEWS if view not in views]
    if missing:
        problems.append("missing " + ", ".join(missing))
    if answer.get("full_body") is False:
        problems.append("turnaround figures are cropped instead of full body")
    if answer.get("one_character") is False:
        problems.append("shows more than one person or the figures do not match each other")
    if has_references and answer.get("matches_references") is False:
        problems.append("does not match the reference images")
    detail = str(answer.get("problems") or "").strip()
    if problems and detail:
        problems.append(detail)
    return SheetReview(
        ok=not problems,
        method="vision",
        face_closeup=face_closeup,
        views=views,
        problems=problems,
        face_box=_face_box(answer.get("face_box")) if face_closeup else None,
        text_or_labels=answer.get("text_or_labels") is True,
    )


def _vision_enabled() -> bool:
    """Gemini review is opt-in (CHARACTER_SHEET_REVIEW=vision) because it runs on Replicate."""
    return os.getenv("CHARACTER_SHEET_REVIEW", "layout").strip().casefold() == "vision"


def review_sheet(image: Image.Image, sheet_url: str, references: list[tuple[str, str]] | None = None) -> SheetReview:
    """Review a generated sheet; ``references`` are (url, tag) pairs it was made from.

    Uses the vision model, falling back to the layout check if it cannot answer.
    """
    references = list(references or [])[:9]  # the vision model takes at most 10 images
    if _vision_enabled():
        reference_lines = "".join(
            f"Image {index} is a reference for the character's {tag}.\n"
            for index, (_, tag) in enumerate(references, start=2)
        )
        try:
            answer = run_gemini(
                REVIEW_PROMPT.format(references=("\n" + reference_lines) if reference_lines else ""),
                system_instruction=REVIEW_SYSTEM,
                images=[sheet_url, *(url for url, _ in references)],
                temperature=0,
                deadline_seconds=120,
            )
            return review_from_answer(_parse_json(answer), bool(references))
        except Exception as error:  # GeminiError, bad JSON, network errors: the layout check still runs
            logger.warning("Vision review of the character sheet failed, using the layout check: %s", error)
    return layout_review(image)
