"""Character sheet: one composed image with a large face close-up and the six-view turnaround.

The six turnaround views are reused pixel for pixel, so the sheet never drifts from the
approved character. Only the face close-up is newly generated, conditioned on the front
and three-quarter views, and it is reused until those views change.

Layout (3840 x 2160):

    ┌──────────────────────────────────────────────────────────────────┐
    │ NAME                                            CHARACTER SHEET  │
    │ Main character · Role · Age · Gender · Race          Style · date │
    ├────────────────────┬─────────────────────────────────────────────┤
    │ FACE CLOSE-UP      │ TURNAROUND                                  │
    │                    │ Front | L 3/4 | L side | Back | R side | R 3/4 │
    │   (large face      ├───────────────┬─────────────────────────────┤
    │    portrait)       │ COLOR PALETTE │ PROFILE / APPEARANCE /      │
    │                    │ swatches+hex  │ PERSONALITY                 │
    └────────────────────┴───────────────┴─────────────────────────────┘
"""

from __future__ import annotations

import io
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime
from functools import lru_cache
from typing import Any

import httpx
from PIL import Image, ImageDraw, ImageFont
from supabase import Client

from core.supabase_client import require_supabase_client
from core.supabase_records import as_record, as_records, maybe_single_record
from schemas.image_generation import CharacterView, CreateImageRequest
from services.character_views import CHARACTER_VIEW_SPECS, build_script_character_profile, effective_character_profile
from services.image_generation_service import generate_provider_images
from services.visual_style import resolve_character_visual_style

SHEET_WIDTH = 3840
SHEET_HEIGHT = 2160
MARGIN = 96
FACE_WIDTH = 1180
COLUMN_GAP = 80
SECTION_LABEL_HEIGHT = 56

BACKGROUND = (245, 243, 239)
PANEL = (255, 255, 255)
INK = (28, 27, 31)
MUTED = (107, 104, 112)
RULE = (217, 213, 206)
ACCENT = (109, 40, 217)

FACE_ROLE = "face_closeup"
SHEET_ROLE = "character_sheet"
STORAGE_BUCKET = "output-images"

VIEW_SHORT_LABELS: dict[str, str] = {
    CharacterView.front.value: "Front",
    CharacterView.left_three_quarter.value: "Left 3/4",
    CharacterView.left_profile.value: "Left profile",
    CharacterView.back.value: "Back",
    CharacterView.right_profile.value: "Right profile",
    CharacterView.right_three_quarter.value: "Right 3/4",
}
VIEW_ORDER = [view.value for view, _, _ in CHARACTER_VIEW_SPECS]

FACE_CLOSEUP_PROMPT = """\
You are a professional character designer creating the face reference for a character sheet.

The attached reference images show one character: {reference_list}.
Create a head-and-shoulders close-up portrait of exactly this character.

{profile}

Framing: the face fills most of the frame, cropped from just above the top of the hair to the
upper chest. The character looks directly into the camera with a calm, neutral expression,
eyes open and in sharp focus. Soft, even studio lighting with no harsh shadows across the face,
on the same clean uniform studio background as the references.

Preserve the identity exactly: facial structure, skin tone and texture, eye shape and color,
eyebrows, nose, lips, hairstyle and hair color, facial hair, makeup, scars, marks, piercings,
glasses, and any visible clothing or accessories at the neckline. Match the art style, medium,
and rendering of the reference images. Do not mirror or flip the character.

Do not create a collage, grid, sheet, panels, labels, text, or multiple faces. Output only one image.
"""


@dataclass(frozen=True)
class SheetProfile:
    name: str
    character_type: str | None = None
    role: str | None = None
    age: int | str | None = None
    gender: str | None = None
    race: str | None = None
    appearance: str | None = None
    personality: str | None = None
    visual_style: str | None = None


# --------------------------------------------------------------------------- rendering


FONT_CANDIDATES = {
    False: ("DejaVuSans.ttf", "arial.ttf", "Arial.ttf", "LiberationSans-Regular.ttf", "Helvetica.ttc"),
    True: ("DejaVuSans-Bold.ttf", "arialbd.ttf", "Arial Bold.ttf", "LiberationSans-Bold.ttf", "Helvetica.ttc"),
}


@lru_cache(maxsize=32)
def _font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    for candidate in FONT_CANDIDATES[bold]:
        try:
            return ImageFont.truetype(candidate, size)
        except OSError:
            continue
    return ImageFont.load_default(size=size)


def _background_color(image: Image.Image) -> tuple[int, int, int]:
    """Average the corners, which are the studio background for every generated view."""
    rgb = image.convert("RGB")
    width, height = rgb.size
    points = [(0, 0), (width - 1, 0), (0, height - 1), (width - 1, height - 1), (width // 2, 0)]
    samples = [rgb.getpixel(point) for point in points]
    return tuple(sum(int(sample[channel]) for sample in samples) // len(samples) for channel in range(3))  # type: ignore[return-value]


def _distance(first: tuple[int, int, int], second: tuple[int, int, int]) -> float:
    return sum((a - b) ** 2 for a, b in zip(first, second)) ** 0.5


def extract_palette(image: Image.Image, count: int = 6) -> list[tuple[int, int, int]]:
    """Return the character's dominant colors, ignoring the studio background."""
    rgb = image.convert("RGB")
    rgb.thumbnail((256, 256))
    background = _background_color(rgb)
    quantized = rgb.quantize(colors=16, method=Image.Quantize.MEDIANCUT)
    palette = quantized.getpalette() or []
    colors = sorted(quantized.getcolors() or [], reverse=True)
    minimum_pixels = rgb.width * rgb.height * 0.004
    chosen: list[tuple[int, int, int]] = []
    for pixels, index in colors:
        if pixels < minimum_pixels:
            continue
        color = (palette[index * 3], palette[index * 3 + 1], palette[index * 3 + 2])
        if _distance(color, background) < 48 or any(_distance(color, other) < 40 for other in chosen):
            continue
        chosen.append(color)
        if len(chosen) == count:
            break
    return chosen


def _hex(color: tuple[int, int, int]) -> str:
    return "#{:02X}{:02X}{:02X}".format(*color)


def _paste_contain(canvas: Image.Image, image: Image.Image, box: tuple[int, int, int, int]) -> None:
    """Fit the whole image inside the box, filling the margins with its own background."""
    left, top, right, bottom = box
    width, height = right - left, bottom - top
    canvas.paste(Image.new("RGB", (width, height), _background_color(image)), (left, top))
    scale = min(width / image.width, height / image.height)
    resized = image.convert("RGB").resize((max(1, round(image.width * scale)), max(1, round(image.height * scale))), Image.Resampling.LANCZOS)
    canvas.paste(resized, (left + (width - resized.width) // 2, top + (height - resized.height) // 2))


def _paste_cover(canvas: Image.Image, image: Image.Image, box: tuple[int, int, int, int], vertical_focus: float = 0.35) -> None:
    """Fill the box completely, cropping the excess with the focus kept near the face."""
    left, top, right, bottom = box
    width, height = right - left, bottom - top
    scale = max(width / image.width, height / image.height)
    resized = image.convert("RGB").resize((max(width, round(image.width * scale)), max(height, round(image.height * scale))), Image.Resampling.LANCZOS)
    crop_left = (resized.width - width) // 2
    crop_top = round((resized.height - height) * vertical_focus)
    canvas.paste(resized.crop((crop_left, crop_top, crop_left + width, crop_top + height)), (left, top))


def _wrap(draw: ImageDraw.ImageDraw, text: str, font: Any, width: int) -> list[str]:
    lines: list[str] = []
    for paragraph in text.splitlines():
        line = ""
        for word in paragraph.split():
            candidate = f"{line} {word}".strip()
            if not line or draw.textlength(candidate, font=font) <= width:
                line = candidate
            else:
                lines.append(line)
                line = word
        if line:
            lines.append(line)
    return lines


def _section_label(draw: ImageDraw.ImageDraw, text: str, x: int, y: int) -> None:
    draw.text((x, y), text.upper(), font=_font(28, bold=True), fill=ACCENT)


def _text_block(draw: ImageDraw.ImageDraw, label: str, text: str, x: int, y: int, width: int, max_y: int) -> int:
    """Draw a labeled paragraph, truncating with an ellipsis at max_y. Returns the next y."""
    font = _font(32)
    line_height = 46
    if y + SECTION_LABEL_HEIGHT + line_height > max_y:
        return y
    _section_label(draw, label, x, y)
    y += SECTION_LABEL_HEIGHT - 8
    lines = _wrap(draw, text, font, width)
    visible = max(1, (max_y - y) // line_height)
    if len(lines) > visible:
        lines = lines[:visible]
        last = lines[-1]
        while last and draw.textlength(f"{last}…", font=font) > width:
            last = last[:-1]
        lines[-1] = f"{last.rstrip(' ,.;')}…"
    for line in lines:
        draw.text((x, y), line, font=font, fill=INK)
        y += line_height
    return y + 36


def _type_label(character_type: str | None) -> str | None:
    if not character_type:
        return None
    return {"main": "Main character", "supporting": "Supporting character"}.get(
        character_type, character_type.replace("_", " ").title()
    )


def _present(value: object) -> bool:
    return value is not None and str(value).strip() != ""


def render_character_sheet(
    profile: SheetProfile,
    face: Image.Image,
    views: dict[str, Image.Image],
    palette: list[tuple[int, int, int]] | None = None,
    created_at: datetime | None = None,
) -> Image.Image:
    """Compose the sheet. Pure function: no network or database access."""
    canvas = Image.new("RGB", (SHEET_WIDTH, SHEET_HEIGHT), BACKGROUND)
    draw = ImageDraw.Draw(canvas)
    right_edge = SHEET_WIDTH - MARGIN

    # Header
    draw.text((MARGIN, MARGIN - 8), profile.name.upper(), font=_font(104, bold=True), fill=INK)
    age = f"{profile.age} years" if _present(profile.age) else None
    subtitle = " · ".join(
        str(part) for part in (_type_label(profile.character_type), profile.role, age, profile.gender, profile.race) if _present(part)
    )
    if subtitle:
        draw.text((MARGIN, MARGIN + 128), subtitle, font=_font(40), fill=MUTED)
    title_font = _font(36, bold=True)
    title = "CHARACTER SHEET"
    draw.text((right_edge - draw.textlength(title, font=title_font), MARGIN + 6), title, font=title_font, fill=ACCENT)
    meta = " · ".join(
        part for part in (
            f"Style: {profile.visual_style}" if profile.visual_style else None,
            (created_at or datetime.now(UTC)).strftime("%d %b %Y"),
        ) if part
    )
    meta_font = _font(30)
    draw.text((right_edge - draw.textlength(meta, font=meta_font), MARGIN + 70), meta, font=meta_font, fill=MUTED)
    header_bottom = MARGIN + 214
    draw.line((MARGIN, header_bottom, right_edge, header_bottom), fill=RULE, width=3)

    body_top = header_bottom + 56
    body_bottom = SHEET_HEIGHT - MARGIN

    # Face close-up (large, left column)
    _section_label(draw, "Face close-up", MARGIN, body_top)
    face_box = (MARGIN, body_top + SECTION_LABEL_HEIGHT, MARGIN + FACE_WIDTH, body_bottom)
    _paste_cover(canvas, face, face_box)
    draw.rectangle(face_box, outline=RULE, width=3)

    # Turnaround row
    right_x = MARGIN + FACE_WIDTH + COLUMN_GAP
    right_width = right_edge - right_x
    _section_label(draw, "Turnaround", right_x, body_top)
    cell_gap = 20
    cell_width = (right_width - cell_gap * (len(VIEW_ORDER) - 1)) // len(VIEW_ORDER)
    cell_height = round(cell_width * 1.5)
    cell_top = body_top + SECTION_LABEL_HEIGHT
    label_font = _font(28, bold=True)
    for index, view in enumerate(VIEW_ORDER):
        left = right_x + index * (cell_width + cell_gap)
        box = (left, cell_top, left + cell_width, cell_top + cell_height)
        image = views.get(view)
        if image is not None:
            _paste_contain(canvas, image, box)
        else:
            draw.rectangle(box, fill=PANEL)
            missing = "Not generated"
            missing_font = _font(26)
            draw.text(
                (left + (cell_width - draw.textlength(missing, font=missing_font)) / 2, cell_top + cell_height / 2 - 14),
                missing, font=missing_font, fill=MUTED,
            )
        draw.rectangle(box, outline=RULE, width=2)
        label = VIEW_SHORT_LABELS[view]
        draw.text((left + (cell_width - draw.textlength(label, font=label_font)) / 2, cell_top + cell_height + 16), label, font=label_font, fill=INK)

    lower_top = cell_top + cell_height + 84
    draw.line((right_x, lower_top, right_edge, lower_top), fill=RULE, width=3)
    lower_top += 40

    # Color palette
    palette = palette if palette is not None else extract_palette(views.get(CharacterView.front.value) or face)
    _section_label(draw, "Color palette", right_x, lower_top)
    swatch = 104
    swatch_y = lower_top + SECTION_LABEL_HEIGHT
    hex_font = _font(32, bold=True)
    for color in palette:
        if swatch_y + swatch > body_bottom:
            break
        draw.rectangle((right_x, swatch_y, right_x + swatch, swatch_y + swatch), fill=color, outline=RULE, width=2)
        draw.text((right_x + swatch + 28, swatch_y + swatch / 2 - 18), _hex(color), font=hex_font, fill=INK)
        swatch_y += swatch + 24
    if not palette:
        draw.text((right_x, swatch_y), "No palette available", font=_font(30), fill=MUTED)

    # Profile text
    text_x = right_x + 640
    text_width = right_edge - text_x
    y = lower_top
    _section_label(draw, "Profile", text_x, y)
    y += SECTION_LABEL_HEIGHT - 8
    facts = [(label, value) for label, value in (
        ("Role", profile.role), ("Age", profile.age), ("Gender", profile.gender), ("Race", profile.race),
    ) if _present(value)]
    fact_label_font, fact_font = _font(30, bold=True), _font(30)
    column_width = text_width // 2
    for index, (label, value) in enumerate(facts):
        fx = text_x + (index % 2) * column_width
        fy = y + (index // 2) * 50
        draw.text((fx, fy), f"{label}:", font=fact_label_font, fill=MUTED)
        offset = draw.textlength(f"{label}: ", font=fact_label_font)
        value_text = str(value)
        while value_text and draw.textlength(value_text, font=fact_font) > column_width - offset - 24:
            value_text = value_text[:-1]
        if value_text != str(value):
            value_text = f"{value_text.rstrip()}…"
        draw.text((fx + offset, fy), value_text, font=fact_font, fill=INK)
    y += ((len(facts) + 1) // 2) * 50 + 40
    if _present(profile.appearance):
        y = _text_block(draw, "Appearance", str(profile.appearance), text_x, y, text_width, body_bottom)
    if _present(profile.personality):
        _text_block(draw, "Personality", str(profile.personality), text_x, y, text_width, body_bottom)

    return canvas


# --------------------------------------------------------------------------- data access


def _download_image(url: str) -> Image.Image:
    response = httpx.get(url, timeout=60.0, follow_redirects=True)
    response.raise_for_status()
    image = Image.open(io.BytesIO(response.content))
    image.load()
    return image


def load_sheet_character(project_id: str, character_id: str) -> dict[str, Any]:
    supabase = require_supabase_client()
    character = maybe_single_record(supabase.table("characters").select(
        "id, name, character_type, role, age, gender, race, appearance, personality, tags, metadata"
    ).eq("id", character_id).eq("project_id", project_id).maybe_single().execute())
    if not character:
        raise ValueError("Character was not found in this project")
    return character


def load_character_view_urls(project_id: str, character: dict[str, Any]) -> dict[str, str]:
    """Return the current URL of each turnaround view, including repaired keyframes."""
    supabase = require_supabase_client()
    metadata = character.get("metadata") if isinstance(character.get("metadata"), dict) else {}
    job_id = metadata.get("latest_generation_job_id")
    view_assets: dict[str, str] = {}

    if isinstance(job_id, str) and job_id:
        outputs = as_records(supabase.table("generation_outputs").select("asset_id, metadata").eq(
            "generation_job_id", job_id
        ).eq("is_active", True).execute().data)
        for output in outputs:
            output_metadata = output.get("metadata") if isinstance(output.get("metadata"), dict) else {}
            view = output_metadata.get("view")
            if view in VIEW_ORDER and output.get("asset_id"):
                view_assets[view] = str(output["asset_id"])

    if not view_assets:
        links = as_records(supabase.table("asset_links").select("asset_id, metadata").eq("project_id", project_id).eq(
            "target_type", "character"
        ).eq("target_id", character["id"]).eq("role", "keyframe").order("created_at").execute().data)
        for link in links:
            link_metadata = link.get("metadata") if isinstance(link.get("metadata"), dict) else {}
            view = link_metadata.get("view")
            if view in VIEW_ORDER and link.get("asset_id"):
                view_assets[view] = str(link["asset_id"])  # later links win

    if not view_assets:
        return {}
    assets = as_records(supabase.table("assets").select("id, url").in_("id", list(view_assets.values())).execute().data)
    urls = {str(asset["id"]): str(asset["url"]) for asset in assets}
    return {view: urls[asset_id] for view, asset_id in view_assets.items() if asset_id in urls}


def _views_signature(view_urls: dict[str, str]) -> str:
    """Identify the exact set of reference views a face close-up was generated from."""
    return "|".join(view_urls.get(view, "") for view in (CharacterView.front.value, CharacterView.left_three_quarter.value, CharacterView.right_three_quarter.value))


def build_face_closeup_prompt(character: dict[str, Any], reference_views: list[str]) -> str:
    try:
        profile = build_script_character_profile(character, resolve_character_visual_style(character, None))
    except ValueError:
        profile = f"Character name: {character.get('name')}"
    reference_list = ", ".join(f"image {index + 1} is the {VIEW_SHORT_LABELS[view].lower()} view" for index, view in enumerate(reference_views))
    return FACE_CLOSEUP_PROMPT.format(reference_list=reference_list, profile=profile)


def generate_face_closeup(character: dict[str, Any], view_urls: dict[str, str], model: str, provider: str, project_id: str) -> str:
    reference_views = [
        view for view in (CharacterView.front.value, CharacterView.left_three_quarter.value, CharacterView.right_three_quarter.value)
        if view_urls.get(view)
    ][:2]
    if not reference_views:
        raise ValueError("Generate the character's front view before creating a character sheet")
    response = generate_provider_images(CreateImageRequest(
        model=model,
        provider=provider,
        prompt=build_face_closeup_prompt(character, reference_views),
        aspect_ratio="3:4",
        num_images=1,
        output_format="png",
        image_mapping={f"image{index + 1}": view_urls[view] for index, view in enumerate(reference_views)},
        project_id=project_id,
    ))
    if not response.images:
        raise RuntimeError("No image returned for the face close-up")
    return response.images[0]


def _store_linked_image(
    supabase: Client,
    project_id: str,
    character_id: str,
    image: Image.Image,
    *,
    role: str,
    name: str,
    file_format: str,
    metadata: dict[str, Any],
) -> tuple[str, str]:
    """Upload an image, create its asset, and make it the character's only link for the role."""
    buffer = io.BytesIO()
    if file_format == "jpeg":
        image.convert("RGB").save(buffer, "JPEG", quality=92)
        extension, mime_type = "jpg", "image/jpeg"
    else:
        image.save(buffer, "PNG")
        extension, mime_type = "png", "image/png"
    content = buffer.getvalue()
    storage_path = f"character-sheets/{character_id}/{role}_{uuid.uuid4().hex}.{extension}"
    supabase.storage.from_(STORAGE_BUCKET).upload(file=content, path=storage_path, file_options={"content-type": mime_type})
    url = supabase.storage.from_(STORAGE_BUCKET).get_public_url(storage_path)
    try:
        created = as_records(supabase.table("assets").insert({
            "project_id": project_id,
            "type": "image",
            "source": "generation",
            "name": name,
            "url": url,
            "storage_path": storage_path,
            "mime_type": mime_type,
            "size_bytes": len(content),
            "width": image.width,
            "height": image.height,
            "metadata": {**metadata, "character_id": character_id, "kind": role},
        }).execute().data)
        if not created:
            raise RuntimeError(f"Failed to create the {role.replace('_', ' ')} asset")
        asset_id = str(created[0]["id"])
        supabase.table("asset_links").delete().eq("project_id", project_id).eq("target_type", "character").eq(
            "target_id", character_id
        ).eq("role", role).execute()
        supabase.table("asset_links").insert({
            "project_id": project_id,
            "asset_id": asset_id,
            "target_type": "character",
            "target_id": character_id,
            "role": role,
            "sort_order": 0,
            "metadata": metadata,
        }).execute()
    except Exception:
        supabase.storage.from_(STORAGE_BUCKET).remove([storage_path])
        raise
    return asset_id, url


def _save_character_metadata(supabase: Client, project_id: str, character_id: str, key: str, value: dict[str, Any]) -> None:
    row = as_record(supabase.table("characters").select("metadata").eq("id", character_id).eq(
        "project_id", project_id
    ).single().execute().data)
    stored = row.get("metadata") if row else None
    metadata = dict(stored) if isinstance(stored, dict) else {}
    metadata[key] = value
    supabase.table("characters").update({"metadata": metadata}).eq("id", character_id).eq("project_id", project_id).execute()


# --------------------------------------------------------------------------- orchestration


def create_character_sheet(
    project_id: str,
    character_id: str,
    model: str = "nanobanana",
    provider: str = "replicate",
    regenerate_face: bool = False,
) -> dict[str, Any]:
    """Generate (or reuse) the face close-up, compose the sheet, and attach both to the character."""
    supabase = require_supabase_client()
    raw_character = load_sheet_character(project_id, character_id)
    character = effective_character_profile(raw_character)
    view_urls = load_character_view_urls(project_id, raw_character)
    if CharacterView.front.value not in view_urls:
        raise ValueError("Generate the character's turnaround views before creating a character sheet")

    metadata = raw_character.get("metadata") if isinstance(raw_character.get("metadata"), dict) else {}
    signature = _views_signature(view_urls)
    stored_face = metadata.get(FACE_ROLE) if isinstance(metadata.get(FACE_ROLE), dict) else {}
    face_url = stored_face.get("url") if stored_face.get("views_signature") == signature else None
    face_asset_id = stored_face.get("asset_id") if face_url else None
    face_image: Image.Image | None = None

    if regenerate_face or not face_url:
        generated_url = generate_face_closeup(character, view_urls, model, provider, project_id)
        face_image = _download_image(generated_url)
        face_metadata = {"views_signature": signature, "model": model, "provider": provider}
        face_asset_id, face_url = _store_linked_image(
            supabase, project_id, character_id, face_image,
            role=FACE_ROLE, name=f"{character.get('name') or 'Character'} - Face close-up", file_format="png", metadata=face_metadata,
        )
        _save_character_metadata(supabase, project_id, character_id, FACE_ROLE, {
            **face_metadata, "asset_id": face_asset_id, "url": face_url, "created_at": datetime.now(UTC).isoformat(),
        })
    if face_image is None:
        face_image = _download_image(str(face_url))

    views = {view: _download_image(url) for view, url in view_urls.items()}
    palette = extract_palette(views[CharacterView.front.value])
    created_at = datetime.now(UTC)
    profile = SheetProfile(
        name=str(character.get("name") or "Character"),
        character_type=character.get("character_type"),
        role=character.get("role"),
        age=character.get("age"),
        gender=character.get("gender"),
        race=character.get("race"),
        appearance=character.get("appearance"),
        personality=character.get("personality"),
        visual_style=metadata.get("visual_style") if isinstance(metadata.get("visual_style"), str) else None,
    )
    sheet = render_character_sheet(profile, face_image, views, palette, created_at)
    sheet_metadata = {
        "views_signature": signature,
        "face_asset_id": face_asset_id,
        "source_generation_job_id": metadata.get("latest_generation_job_id"),
        "palette": [_hex(color) for color in palette],
    }
    sheet_asset_id, sheet_url = _store_linked_image(
        supabase, project_id, character_id, sheet,
        role=SHEET_ROLE, name=f"{profile.name} - Character sheet", file_format="jpeg", metadata=sheet_metadata,
    )
    _save_character_metadata(supabase, project_id, character_id, SHEET_ROLE, {
        **sheet_metadata, "asset_id": sheet_asset_id, "url": sheet_url, "created_at": created_at.isoformat(),
    })
    return {
        "character_id": character_id,
        "sheet_asset_id": sheet_asset_id,
        "sheet_url": sheet_url,
        "face_closeup_asset_id": face_asset_id,
        "face_closeup_url": face_url,
        "width": sheet.width,
        "height": sheet.height,
        "palette": sheet_metadata["palette"],
        "missing_views": [view for view in VIEW_ORDER if view not in view_urls],
    }
