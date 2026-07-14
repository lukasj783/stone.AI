"""
Character generation service.

Builds a system prompt that instructs Nanobanana to generate a character
turnaround sheet containing multiple orthographic and production views arranged
in a grid.  The composite image returned by the model is then split into
individual keyframes using Pillow, so each view can be displayed independently
in the frontend grid.
"""

from __future__ import annotations

import io
import uuid

from PIL import Image

from core.supabase_client import get_supabase_client


# ---------------------------------------------------------------------------
# View labels — must match the grid order in CHARACTER_SYSTEM_PROMPT
# Grid is 2 columns × 3 rows, keyframes come back left-to-right, top-to-bottom:
#   0: Side View (Profile)        [Col 1, Row 1]
#   1: T-Pose / A-Pose            [Col 2, Row 1]
#   2: Three-Quarter (3/4) Front  [Col 1, Row 2]
#   3: Top-Down (Bird's Eye)      [Col 2, Row 2]
#   4: Three-Quarter (3/4) Back   [Col 1, Row 3]
#   5: Bottom-Up (Worm's Eye)     [Col 2, Row 3]
# ---------------------------------------------------------------------------

CHARACTER_VIEW_LABELS = [
    "Side View (Profile)",
    "T-Pose / A-Pose",
    "Three-Quarter (3/4) Front",
    "Top-Down (Bird's Eye)",
    "Three-Quarter (3/4) Back",
    "Bottom-Up (Worm's Eye)",
]


# ---------------------------------------------------------------------------
# System prompt
# ---------------------------------------------------------------------------

CHARACTER_SYSTEM_PROMPT = """\
You are a professional character designer and concept artist.

Create a single character turnaround reference sheet for the character
described below. The sheet must contain exactly six (6) views arranged in a
2-column by 3-row grid (2 columns, 3 rows). Each cell must occupy one view.

Label each view clearly inside the cell so it can be identified later:

Column 1 (top to bottom):
  1. Side View (Profile) — Essential for establishing depth, nose shape, and posture.
  2. Three-Quarter (3/4) Front — The most common view showing depth and facial character.
  3. Three-Quarter (3/4) Back — Crucial for complex hairstyles, capes, or backpack designs.

Column 2 (top to bottom):
  4. T-Pose / A-Pose — Standard arm positions used for 3D rigging and modeling.
  5. Top-Down (Bird's Eye) — Shows shoulder breadth, hat shapes, and footprint depth.
  6. Bottom-Up (Worm's Eye) — Useful for giant characters or dramatic, towering perspective.

Background requirement (CRITICAL):
- Every cell MUST have a uniform, solid background — either pure white (#FFFFFF) or dark grey (#2A2A2A).
- Choose ONE background color and use it identically across all six views.
- The background must be completely flat with no gradients, textures, patterns, or props.
- This ensures the character is clearly visible and easy to isolate, similar to a passport photo.
- Do not add shadows on the background — only the character's own contact shadow is acceptable.

Important guidelines:
- Keep the character design consistent across all six views.
- Maintain even spacing between cells with thin divider lines.
- Use a consistent art style (high-quality concept art) across all views.
- Each cell should be roughly square and equally sized.
- The character must be fully lit, centered, and fill most of each cell.

Character description: {user_prompt}
"""


def build_character_system_prompt(user_prompt: str) -> str:
    """Return the full prompt to send to the image model."""
    return CHARACTER_SYSTEM_PROMPT.format(user_prompt=user_prompt)


# ---------------------------------------------------------------------------
# Image-to-Image Character Variations System Prompt
# ---------------------------------------------------------------------------

CHARACTER_IMG2IMG_SYSTEM_PROMPT = """\
Create four (4) style variations for the person or character shown in the [reference] image. 
The sheet must contain exactly four (4) views arranged in a 2-column by 2-row grid (2 columns, 2 rows). 
Each cell must occupy one view.

Provide these exact four style variations, one in each cell:
1. Original style (Top-Left)
2. Fantasy/RPG Armor (Top-Right)
3. Modern/Cyberpunk Clothing (Bottom-Left)
4. Alternate Outfit/Timeline (Bottom-Right)

Background requirement (CRITICAL):
- Every cell MUST have a uniform, solid background — either pure white (#FFFFFF) or dark grey (#2A2A2A).
- Choose ONE background color and use it identically across all cells.
- The background must be completely flat with no gradients, textures, patterns, or props.
- This ensures the character is clearly visible and easy to isolate, similar to a passport photo.
- Do not add shadows on the background — only the character's own contact shadow is acceptable.

Important Style Guidelines (CRITICAL):
- STRICT STYLE MATCH: You must exactly preserve the art style, photographic realism, texture, and medium of the [reference] image! 
- Do NOT convert real photos into cartoons or illustrations. 
- If the uploaded image is a real photo, the output MUST look like real photographs.
- Keep the identity and facial features consistent across all views, based exactly on the [reference] image.
- Each cell should be roughly square and equally sized.
- The character must be fully lit, centered, and fill most of each cell.
"""

def build_character_img2img_prompt(user_guidance: str = "") -> str:
    """Build the system prompt for image-to-image character variations."""
    prompt = CHARACTER_IMG2IMG_SYSTEM_PROMPT
    if user_guidance:
        prompt += f"\nAdditional guidance from user: {user_guidance}\n"
    return prompt


# ---------------------------------------------------------------------------
# Pillow image splitting
# ---------------------------------------------------------------------------

# Default grid layout: 2 columns × 3 rows = 6 views
DEFAULT_COLS = 2
DEFAULT_ROWS = 3


def split_character_sheet(
    image_bytes: bytes,
    cols: int = DEFAULT_COLS,
    rows: int = DEFAULT_ROWS,
) -> list[bytes]:
    """
    Split a composite character sheet into individual keyframes.

    The image is divided into a *cols* × *rows* grid. Each cell is cropped and
    returned as PNG bytes in left-to-right, top-to-bottom order.

    Returns a list of byte strings (one per cell). If the image cannot be
    processed, an empty list is returned.
    """
    try:
        img = Image.open(io.BytesIO(image_bytes))
    except Exception:
        return []

    width, height = img.size

    cell_width = width // cols
    cell_height = height // rows

    if cell_width < 10 or cell_height < 10:
        # Image too small to split meaningfully
        return [image_bytes]

    keyframes: list[bytes] = []

    for row in range(rows):
        for col in range(cols):
            left = col * cell_width
            upper = row * cell_height
            right = left + cell_width
            lower = upper + cell_height

            cell = img.crop((left, upper, right, lower))

            buf = io.BytesIO()
            # Preserve RGBA if present, otherwise RGB
            save_mode = cell.mode if cell.mode in ("RGB", "RGBA") else "RGB"
            if cell.mode != save_mode:
                cell = cell.convert(save_mode)
            cell.save(buf, format="PNG")
            keyframes.append(buf.getvalue())

    return keyframes


# ---------------------------------------------------------------------------
# Supabase upload helper
# ---------------------------------------------------------------------------

def upload_keyframe(file_bytes: bytes) -> str:
    """Upload a single keyframe PNG to Supabase storage and return the public URL."""
    supabase = get_supabase_client()
    if not supabase:
        raise RuntimeError("Supabase client not initialized")

    filename = f"character_keyframe_{uuid.uuid4().hex}.png"

    supabase.storage.from_("output-images").upload(
        file=file_bytes,
        path=filename,
        file_options={"content-type": "image/png"},
    )

    return supabase.storage.from_("output-images").get_public_url(filename)


# ---------------------------------------------------------------------------
# Studio schema logging
# ---------------------------------------------------------------------------

def log_character_to_studio(
    keyframe_urls: list[str],
    view_labels: list[str] | None = None,
    prompt: str = "",
    model: str = "",
    char_name: str = "",
    char_role: str = "",
    char_description: str = "",
) -> None:
    """
    Log a character generation to the studio schema.

    Creates rows in:
      - generation_jobs (kind='character')
      - assets (one per keyframe, type='image', source='generation')
      - generation_outputs (links job → asset with output_index)
      - characters (name, role, appearance — if char_name is provided)
      - asset_links (links each keyframe asset to the character)

    This is best-effort: errors are printed but never raised so that the API
    response is not affected by logging failures.
    """
    supabase = get_supabase_client()
    if not supabase:
        return

    if view_labels is None:
        view_labels = CHARACTER_VIEW_LABELS

    try:
        # 1. Create a generation_job
        job_res = supabase.table("generation_jobs").insert({
            "kind": "character",
            "model": model,
            "prompt": prompt,
            "status": "complete",
        }).execute()

        job_id = job_res.data[0]["id"] if job_res.data else None

        # 2. Create a character record (if name is provided)
        character_id = None
        if char_name:
            char_res = supabase.table("characters").insert({
                "name": char_name,
                "role": char_role or None,
                "appearance": char_description or None,
            }).execute()
            character_id = char_res.data[0]["id"] if char_res.data else None

        # 3. Create assets + generation_outputs for each keyframe
        for idx, url in enumerate(keyframe_urls):
            view_label = view_labels[idx] if idx < len(view_labels) else f"View {idx + 1}"

            # Extract storage path from URL
            storage_path = url.split("/storage/v1/object/public/output-images/")[-1] if "/storage/v1/object/public/" in url else None

            asset_res = supabase.table("assets").insert({
                "type": "image",
                "source": "generation",
                "name": f"{char_name or 'Character'} - {view_label}" if char_name else view_label,
                "url": url,
                "storage_path": storage_path,
                "mime_type": "image/png",
                "metadata": {"view_label": view_label, "character_generation": True},
            }).execute()

            asset_id = asset_res.data[0]["id"] if asset_res.data else None

            # Link asset to generation job
            if job_id and asset_id:
                supabase.table("generation_outputs").insert({
                    "generation_job_id": job_id,
                    "asset_id": asset_id,
                    "output_index": idx,
                    "selected": idx == 0,
                }).execute()

            # Link asset to character
            if character_id and asset_id:
                supabase.table("asset_links").insert({
                    "asset_id": asset_id,
                    "target_type": "character",
                    "target_id": character_id,
                    "role": "keyframe",
                    "sort_order": idx,
                }).execute()

        # 4. Set primary_asset_id on the character (first keyframe)
        if character_id and keyframe_urls:
            first_asset_res = supabase.table("assets").select("id").eq("url", keyframe_urls[0]).execute()
            if first_asset_res.data:
                supabase.table("characters").update({
                    "primary_asset_id": first_asset_res.data[0]["id"]
                }).eq("id", character_id).execute()

    except Exception as e:
        print(f"Failed to log character to studio schema: {e}")
