CHARACTER_IMG2IMG_SYSTEM_PROMPT = """\
Create a polished character image from the supplied reference image.

Preserve the character's identity, facial features, pose, proportions, art style,
photographic realism, texture, and medium unless the user's guidance explicitly
requests a change. Keep the character clearly visible, well lit, and centered.
Return one complete image per generated output. Do not create a collage, grid,
sheet, panels, labels, or divider lines.
"""

CHARACTER_IMG2IMG_VIEW_PROMPT = """\
Create a polished character image from the supplied reference image.

Camera angle: {view_label}. The character is {view_direction}.

Preserve the character's identity, facial features, hairstyle, body proportions,
clothing, accessories, footwear, art style, texture, and medium from the
reference image unless the user's guidance explicitly requests a change. Show
exactly one complete full-body character in a neutral standing pose with relaxed
arms. Keep the character centered, well lit, and on a clean uniform studio
background. Do not mirror or flip the character. Preserve asymmetric details on
the same side of the character's body.

Do not create a collage, grid, sheet, panels, labels, divider lines, or multiple
views. Output only one image.
"""


def build_character_img2img_prompt(user_guidance: str = "") -> str:
    """Build the prompt for reference-based character generation."""
    prompt = CHARACTER_IMG2IMG_SYSTEM_PROMPT
    if user_guidance:
        prompt += f"\nAdditional guidance from user: {user_guidance}\n"
    return prompt


def build_character_img2img_view_prompt(
    user_guidance: str,
    view_label: str,
    view_direction: str,
) -> str:
    """Build a reference-conditioned prompt for one character turnaround view."""
    prompt = CHARACTER_IMG2IMG_VIEW_PROMPT.format(
        view_label=view_label,
        view_direction=view_direction,
    )
    if user_guidance:
        prompt += f"\nAdditional guidance from user: {user_guidance}\n"
    return prompt