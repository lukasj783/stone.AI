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
    "Realistic Cinematic": ProjectVisualStyle(
        label="Realistic Cinematic",
        style_prompt="Photorealistic live-action cinematic imagery with natural materials, believable scale, and physically plausible lighting.",
        negative_style_prompt="cartoon, anime, stylized 3D, hand-drawn illustration, rough storyboard sketch",
    ),
    "Hyper-Realistic": ProjectVisualStyle(
        label="Hyper-Realistic",
        style_prompt="Highly photorealistic cinematic imagery with precise material detail, natural anatomy, and realistic lighting.",
        negative_style_prompt="cartoon, anime, stylized 3D, illustration, rough storyboard sketch",
    ),
    "Stylized 3D": ProjectVisualStyle(
        label="Stylized 3D",
        style_prompt="Finished stylized 3D animated-film imagery with intentional shapes, dimensional materials, and cinematic global illumination.",
        negative_style_prompt="photorealistic live action, 2D anime, flat cartoon, rough storyboard sketch",
    ),
    "Pixar-like": ProjectVisualStyle(
        label="Pixar-like",
        style_prompt="Finished stylized 3D family-animation imagery with appealing rounded forms, expressive faces, detailed materials, and cinematic lighting.",
        negative_style_prompt="photorealistic live action, 2D anime, flat cartoon, rough storyboard sketch",
    ),
    "Anime": ProjectVisualStyle(
        label="Anime",
        style_prompt="Finished 2D cinematic anime imagery with clean linework, cel shading, expressive faces, and controlled color design.",
        negative_style_prompt="photorealistic live action, 3D render, western cartoon, rough storyboard sketch",
    ),
    "Cartoon": ProjectVisualStyle(
        label="Cartoon",
        style_prompt="Finished 2D cartoon imagery with bold clean outlines, simplified consistent proportions, and controlled flat shading.",
        negative_style_prompt="photorealistic live action, anime, 3D render, rough storyboard sketch",
    ),
    "Graphic Novel": ProjectVisualStyle(
        label="Graphic Novel",
        style_prompt="Finished graphic-novel imagery with deliberate ink linework, graphic shadows, and a coherent limited color palette.",
        negative_style_prompt="photorealistic live action, anime, 3D render, rough pencil storyboard",
    ),
    "Hand-Drawn Illustration": ProjectVisualStyle(
        label="Hand-Drawn Illustration",
        style_prompt="Finished hand-drawn illustration with intentional linework, textured color, and consistent editorial composition.",
        negative_style_prompt="photorealistic live action, 3D render, rough unfinished storyboard",
    ),
    "Digital Painting": ProjectVisualStyle(
        label="Digital Painting",
        style_prompt="Finished cinematic digital painting with painterly brushwork, cohesive color, and deliberate lighting.",
        negative_style_prompt="photorealistic live action, flat cartoon, 3D render, rough unfinished storyboard",
    ),
    "Watercolor": ProjectVisualStyle(
        label="Watercolor",
        style_prompt="Finished watercolor illustration with translucent pigment, paper texture, and controlled edges.",
        negative_style_prompt="photorealistic live action, 3D render, flat vector cartoon, rough unfinished storyboard",
    ),
    "Oil Painting": ProjectVisualStyle(
        label="Oil Painting",
        style_prompt="Finished cinematic oil painting with visible brushwork, rich layered color, and deliberate light.",
        negative_style_prompt="photorealistic live action, 3D render, flat cartoon, rough unfinished storyboard",
    ),
}

DEFAULT_VISUAL_STYLE = STYLE_PRESETS["Realistic Cinematic"]


def resolve_visual_style(label: object) -> ProjectVisualStyle:
    return STYLE_PRESETS.get(label, DEFAULT_VISUAL_STYLE) if isinstance(label, str) else DEFAULT_VISUAL_STYLE


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