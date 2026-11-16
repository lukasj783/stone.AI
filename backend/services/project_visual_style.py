from dataclasses import dataclass
from typing import Any

from core.supabase_client import get_supabase_client


@dataclass(frozen=True)
class ProjectVisualStyle:
    label: str
    style_prompt: str
    negative_style_prompt: str

    def prompt_block(self) -> str:
        return "\n".join((
            "PROJECT VISUAL CONTRACT (mandatory):",
            self.style_prompt,
            f"Avoid: {self.negative_style_prompt}.",
            "Keep the rendering medium, palette, materials, proportions, and lighting consistent with this contract.",
        ))


STYLE_PRESETS = {
    "Realistic": ProjectVisualStyle(
        label="Realistic",
        style_prompt="Photorealistic live-action imagery with natural materials, believable scale, and physically plausible lighting.",
        negative_style_prompt="cartoon, anime, 3D pixel art, stylized 3D, hand-drawn illustration, rough storyboard sketch",
    ),
    "3D Pixel": ProjectVisualStyle(
        label="3D Pixel",
        style_prompt="Finished 3D pixel-art / voxel-style render with visible cubic geometry, deliberate low-resolution texture, and cinematic lighting.",
        negative_style_prompt="photorealistic live action, flat 2D cartoon, anime, rough storyboard sketch",
    ),
    "Cartoon": ProjectVisualStyle(
        label="Cartoon",
        style_prompt="Finished 2D cartoon imagery with bold clean outlines, simplified consistent proportions, and controlled flat shading.",
        negative_style_prompt="photorealistic live action, anime, 3D render, pixel art, rough storyboard sketch",
    ),
}

DEFAULT_VISUAL_STYLE = STYLE_PRESETS["Realistic"]

# Labels from the previous 11-option picker keep resolving to one of the three
# supported contracts so existing projects still generate consistently.
LEGACY_STYLE_ALIASES = {
    "Realistic Cinematic": "Realistic",
    "Hyper-Realistic": "Realistic",
    "Digital Painting": "Realistic",
    "Oil Painting": "Realistic",
    "Watercolor": "Realistic",
    "Graphic Novel": "Realistic",
    "Hand-Drawn Illustration": "Realistic",
    "Stylized 3D": "3D Pixel",
    "Pixar-like": "3D Pixel",
    "Anime": "Cartoon",
}


def resolve_visual_style(label: object) -> ProjectVisualStyle:
    if not isinstance(label, str):
        return DEFAULT_VISUAL_STYLE
    canonical = LEGACY_STYLE_ALIASES.get(label, label)
    return STYLE_PRESETS.get(canonical, DEFAULT_VISUAL_STYLE)


def load_project_visual_style(project_id: str, supabase: Any | None = None) -> ProjectVisualStyle:
    client = supabase or get_supabase_client()
    if not client:
        raise RuntimeError("Supabase client not initialized")
    result = client.table("project_documents").select("metadata").eq(
        "project_id", project_id
    ).eq("type", "idea").order("updated_at", desc=True).limit(1).maybe_single().execute()
    metadata = (result.data or {}).get("metadata") or {}
    return resolve_visual_style(metadata.get("visualStyle") if isinstance(metadata, dict) else None)


def apply_visual_style(prompt: str, visual_style: ProjectVisualStyle) -> str:
    return f"{visual_style.prompt_block()}\n\n{prompt.strip()}"