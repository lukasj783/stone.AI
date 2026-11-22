"""Choose which reference images a storyboard frame sends to the image model.

Each character's turnaround view is picked to match how that character appears in the
shot (shot size and which way they face), and the reference budget is shared between
characters, the location and props so no subject is crowded out.

Guidance this follows:
- A small, well-chosen set holds identity better than many images (quality is reported
  to plateau around 6 references and degrade beyond ~10).
- The front view is the identity anchor; a face close-up carries facial fidelity for
  close framing; 3/4 and profile views help when the camera sees the character from
  the side.
- References that match the target viewpoint transfer identity best.

A character with an approved model sheet (one generated image: face close-up plus a
full-body turnaround) sends that sheet, which carries identity, body and costume from
every angle, and the face crop cut from it for facial fidelity. The prompt tells the model
the sheet shows one person, so it draws them once instead of copying the layout.
Characters that only have the older separate turnaround views still use those.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

FACE_CLOSEUP_VIEW = "face_closeup"
MODEL_SHEET_VIEW = "model_sheet"

# Screen-direction vocabulary the shot planner uses for each visible character.
FACING_TOWARD_CAMERA = "toward camera"
FACINGS = (
    FACING_TOWARD_CAMERA,
    "three-quarter screen left",
    "three-quarter screen right",
    "profile screen left",
    "profile screen right",
    "away from camera",
)

# Turnaround view that shows the character the way the camera sees them.
# A character facing screen-left has turned toward their own right, so the camera sees
# their left side (left_profile); turning toward screen-right shows the left 3/4 view.
FACING_TO_VIEW = {
    FACING_TOWARD_CAMERA: "front",
    "three-quarter screen left": "right_three_quarter",
    "three-quarter screen right": "left_three_quarter",
    "profile screen left": "left_profile",
    "profile screen right": "right_profile",
    "away from camera": "back",
}

VIEW_LABELS = {
    MODEL_SHEET_VIEW: "character sheet (one person: face close-up and full-body turnaround)",
    FACE_CLOSEUP_VIEW: "face close-up",
    "front": "front view",
    "left_three_quarter": "left 3/4 view",
    "right_three_quarter": "right 3/4 view",
    "left_profile": "left profile view",
    "right_profile": "right profile view",
    "back": "back view",
}

FRAMING_CLOSE = "close"
FRAMING_MEDIUM = "medium"
FRAMING_WIDE = "wide"

MAX_VIEWS_PER_CHARACTER = 3
# Views per shot by the character's importance tier; untiered characters get the maximum.
CHARACTER_TIER_VIEWS = {"major": 3, "medium": 2, "minor": 1}


@dataclass(frozen=True)
class ReferenceImage:
    url: str
    label: str
    is_sheet: bool = False


def shot_framing(shot_size: str | None) -> str:
    """Group a shot size into close, medium or wide framing."""
    text = (shot_size or "").casefold()
    if "close" in text or "insert" in text:
        return FRAMING_CLOSE
    if any(word in text for word in ("wide", "establishing", "full", "overhead")):
        return FRAMING_WIDE
    return FRAMING_MEDIUM


def normalize_facing(value: object) -> str | None:
    text = " ".join(str(value or "").casefold().replace("-", " ").split())
    if not text:
        return None
    for facing in FACINGS:
        if text == facing.replace("-", " "):
            return facing
    return None


def _priority(framing: str, facing: str | None) -> list[str]:
    """Views to try, best first, for one character in one shot."""
    primary = FACING_TO_VIEW.get(facing or FACING_TOWARD_CAMERA, "front")
    if primary == "back":
        # The face is hidden: silhouette, hair and costume from behind and the side matter.
        return ["back", "left_three_quarter", "right_three_quarter", "front"]
    if primary in ("left_profile", "right_profile"):
        side = "left_three_quarter" if primary == "left_profile" else "right_three_quarter"
        if framing == FRAMING_WIDE:
            return [primary, "front", side]
        return [primary, FACE_CLOSEUP_VIEW, "front", side]
    if framing == FRAMING_CLOSE:
        return [FACE_CLOSEUP_VIEW, primary, "front", "left_three_quarter"]
    if framing == FRAMING_MEDIUM:
        return [primary, FACE_CLOSEUP_VIEW, "front", "left_three_quarter"]
    return [primary, "front", "left_three_quarter", "right_three_quarter"]


def _sheet_priority(framing: str, facing: str | None) -> list[str]:
    """Sheet and face crop, best first, for a character with an approved model sheet."""
    if FACING_TO_VIEW.get(facing or FACING_TOWARD_CAMERA) == "back":
        return [MODEL_SHEET_VIEW]  # the face is hidden; the sheet's back view is what matters
    if framing == FRAMING_CLOSE:
        return [FACE_CLOSEUP_VIEW, MODEL_SHEET_VIEW]
    return [MODEL_SHEET_VIEW, FACE_CLOSEUP_VIEW]


def select_character_views(
    character: dict[str, Any],
    framing: str,
    facing: str | None,
    budget: int,
) -> list[tuple[str, str]]:
    """Return up to ``budget`` (view, url) pairs for this character in this shot."""
    if budget <= 0:
        return []
    views = character.get("views") or {}
    chosen: list[tuple[str, str]] = []
    seen_urls: set[str] = set()
    priority = _sheet_priority(framing, facing) if views.get(MODEL_SHEET_VIEW) else _priority(framing, facing)
    for view in priority:
        url = views.get(view)
        if url and str(url) not in seen_urls:
            chosen.append((view, str(url)))
            seen_urls.add(str(url))
        if len(chosen) == budget:
            return chosen
    if not chosen and character.get("image_url"):
        chosen.append(("front", str(character["image_url"])))
    return chosen


# Environment and object galleries (see services/entity_references.py): preferred angles
# per framing, and how many images each may use. A wide shot needs more of the location;
# a close-up or insert needs more of the object.
ENVIRONMENT_PRIORITY = {
    FRAMING_WIDE: ["primary", "wide", "reverse", "side", "detail"],
    FRAMING_MEDIUM: ["primary", "side", "reverse", "detail"],
    FRAMING_CLOSE: ["detail", "primary", "side"],
}
ENVIRONMENT_CAP = {FRAMING_WIDE: 3, FRAMING_MEDIUM: 2, FRAMING_CLOSE: 1}
OBJECT_PRIORITY = {
    FRAMING_WIDE: ["primary", "three_quarter"],
    FRAMING_MEDIUM: ["primary", "three_quarter", "side", "detail"],
    FRAMING_CLOSE: ["detail", "primary", "three_quarter", "side", "back"],
}
OBJECT_CAP = {FRAMING_WIDE: 1, FRAMING_MEDIUM: 2, FRAMING_CLOSE: 3}
MAX_IMAGES_PER_ENTITY = 3


def tier_cap(framing_cap: int, tier: object) -> int:
    """Adjust a location's or object's image cap by how much it matters in the script.

    Major ones get one extra image (up to 3), medium ones at most 2, minor ones 1.
    Unranked ones keep the cap for the framing.
    """
    if tier == "major":
        return min(MAX_IMAGES_PER_ENTITY, framing_cap + 1)
    if tier == "medium":
        return min(2, framing_cap)
    if tier == "minor":
        return 1
    return framing_cap
ENTITY_ANGLE_LABELS = {
    "primary": "main view",
    "wide": "extra-wide view",
    "reverse": "reverse angle",
    "side": "side angle",
    "detail": "detail view",
    "three_quarter": "3/4 view",
    "back": "back view",
    "custom": "reference",
    "former_main": "reference",
}


def entity_reference_images(entity: dict[str, Any] | None) -> list[tuple[str, str]]:
    """(angle, url) pairs of an environment or object: its gallery, else its main image."""
    if not entity:
        return []
    gallery = [
        (str(reference.get("angle") or "custom"), str(reference["url"]))
        for reference in entity.get("references") or []
        if reference.get("url")
    ]
    if gallery:
        return gallery
    return [("primary", str(entity["image_url"]))] if entity.get("image_url") else []


def select_entity_images(
    images: list[tuple[str, str]],
    priority: list[str],
    cap: int,
) -> list[tuple[str, str]]:
    """Best ``cap`` images: preferred angles first, then any other uploads in gallery order."""
    ordered = [image for angle in priority for image in images if image[0] == angle]
    ordered.extend(image for image in images if image not in ordered)
    chosen: list[tuple[str, str]] = []
    for image in ordered:
        if image[1] not in {url for _, url in chosen}:
            chosen.append(image)
        if len(chosen) == cap:
            break
    return chosen


def build_frame_references(
    characters: list[dict[str, Any]],
    facing_by_character: dict[int, str | None],
    shot_size: str | None,
    environment: dict[str, Any] | None,
    objects: list[dict[str, Any]],
    max_references: int,
) -> list[ReferenceImage]:
    """Ordered, labeled, de-duplicated reference images for one storyboard frame.

    Every subject (each character, the location, each prop) gets a queue of its best
    images for this shot, capped per subject. Slots are handed out in rounds - first
    image of every subject, then second images, and so on - so nobody is starved, with
    characters served first within a round. The result is grouped by subject.

    ``facing_by_character`` is keyed by ``id(character)`` for the characters in the shot.
    """
    framing = shot_framing(shot_size)
    queues: list[list[ReferenceImage]] = []
    for character in characters:
        name = str(character.get("name") or "Character").upper()
        views = select_character_views(
            character, framing, facing_by_character.get(id(character)),
            CHARACTER_TIER_VIEWS.get(str(character.get("tier")), MAX_VIEWS_PER_CHARACTER),
        )
        queues.append([
            ReferenceImage(url, f"{name}, {VIEW_LABELS.get(view, view.replace('_', ' '))}", is_sheet=view == MODEL_SHEET_VIEW)
            for view, url in views
        ])
    environment_images = select_entity_images(
        entity_reference_images(environment), ENVIRONMENT_PRIORITY[framing],
        tier_cap(ENVIRONMENT_CAP[framing], (environment or {}).get("tier")),
    )
    queues.append([
        ReferenceImage(url, f"location, {ENTITY_ANGLE_LABELS.get(angle, angle.replace('_', ' '))}")
        for angle, url in environment_images
    ])
    for obj in objects:
        name = str(obj.get("name") or "prop")
        images = select_entity_images(
            entity_reference_images(obj), OBJECT_PRIORITY[framing], tier_cap(OBJECT_CAP[framing], obj.get("tier")),
        )
        queues.append([
            ReferenceImage(url, f"prop: {name}, {ENTITY_ANGLE_LABELS.get(angle, angle.replace('_', ' '))}")
            for angle, url in images
        ])

    limit = max_references if max_references > 0 else sum(len(queue) for queue in queues)
    taken = [0] * len(queues)
    seen: set[str] = set()
    total = 0
    for round_index in range(max((len(queue) for queue in queues), default=0)):
        for queue_index, queue in enumerate(queues):
            if total >= limit:
                break
            if round_index < len(queue) and queue[round_index].url not in seen:
                seen.add(queue[round_index].url)
                taken[queue_index] = round_index + 1
                total += 1
        if total >= limit:
            break

    references: list[ReferenceImage] = []
    used: set[str] = set()
    for queue, count in zip(queues, taken):
        for reference in queue[:count]:
            if reference.url not in used:
                used.add(reference.url)
                references.append(reference)
    return references


def describe_references(references: list[ReferenceImage]) -> str | None:
    """Prompt lines telling the model which reference image is which."""
    if not references:
        return None
    lines = [
        "REFERENCE IMAGES (keep each character's face, hair, body and costume exactly as shown, but "
        "pose and frame them as this shot describes, never on a studio background; match the "
        "location and props to their images):"
    ]
    lines.extend(f"- Image {index}: {reference.label}" for index, reference in enumerate(references, start=1))
    if any(reference.is_sheet for reference in references):
        lines.append(
            "A character sheet shows ONE person several times (a face close-up and turnaround angles). "
            "Draw that person once, in this shot's pose and framing; never copy the sheet's layout, "
            "repeated figures or plain background."
        )
    return "\n".join(lines)
