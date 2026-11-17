"""Universal Script Compiler.

Turns a project's script units (Act, Chapter, Lesson, Scene...) and script blocks
into the project's chosen format:

- screenplay:    scene headings, action, centred character cues and dialogue
- two_column:    AV script; each row pairs what is seen (video) with what is heard (audio)
- treatment:     prose visuals with lyric/music cues (music videos)
- instructional: lesson script with narration, on-screen points and knowledge checks

The compiler is pure: it takes rows and configuration and returns a structured
result plus a plain-text rendering, so it can be tested without a database.
"""

from dataclasses import dataclass, field
from typing import Any

from services.script_config import BlockTypeConfig, FormatConfig, ProjectTypeConfig


@dataclass
class CompiledElement:
    block_id: str | None
    block_type: str
    label: str
    lane: str
    text: str
    speaker: str | None = None
    parenthetical: str | None = None
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass
class CompiledRow:
    """One row of a two-column script: video on the left, audio on the right."""

    video: list[CompiledElement] = field(default_factory=list)
    audio: list[CompiledElement] = field(default_factory=list)
    span: CompiledElement | None = None  # structural rows (headings, transitions)


@dataclass
class CompiledUnit:
    id: str
    unit_type: str
    unit_label: str
    number: str
    title: str
    heading: str
    summary: str | None
    is_leaf: bool
    elements: list[CompiledElement] = field(default_factory=list)
    rows: list[CompiledRow] = field(default_factory=list)
    children: list["CompiledUnit"] = field(default_factory=list)


@dataclass
class CompiledScript:
    project_id: str
    project_type: str
    format: str
    renderer: str
    title: str
    units: list[CompiledUnit]
    text: str

    def to_dict(self) -> dict[str, Any]:
        def element(e: CompiledElement) -> dict[str, Any]:
            return dict(e.__dict__)

        def row(r: CompiledRow) -> dict[str, Any]:
            return {
                "video": [element(e) for e in r.video],
                "audio": [element(e) for e in r.audio],
                "span": element(r.span) if r.span else None,
            }

        def unit(u: CompiledUnit) -> dict[str, Any]:
            return {
                "id": u.id,
                "unit_type": u.unit_type,
                "unit_label": u.unit_label,
                "number": u.number,
                "title": u.title,
                "heading": u.heading,
                "summary": u.summary,
                "is_leaf": u.is_leaf,
                "elements": [element(e) for e in u.elements],
                "rows": [row(r) for r in u.rows],
                "children": [unit(c) for c in u.children],
            }

        return {
            "project_id": self.project_id,
            "project_type": self.project_type,
            "format": self.format,
            "renderer": self.renderer,
            "title": self.title,
            "units": [unit(u) for u in self.units],
            "text": self.text,
        }


# ---------------------------------------------------------------------------
# Building the unit tree
# ---------------------------------------------------------------------------


def _sort_key(row: dict[str, Any]) -> tuple[int, str]:
    return (int(row.get("sort_order") or 0), str(row.get("created_at") or ""))


def _unit_heading(unit: dict[str, Any], label: str, number: str, renderer: str) -> str:
    slugline = str(unit.get("slugline_raw") or "").strip()
    title = str(unit.get("title") or "").strip()
    if renderer == "screenplay" and slugline:
        return slugline.upper()
    if title:
        return f"{label.upper()} {number}: {title}"
    if slugline:
        return f"{label.upper()} {number}: {slugline}"
    return f"{label.upper()} {number}"


def _element(block: dict[str, Any], config: BlockTypeConfig | None) -> CompiledElement:
    metadata = block.get("metadata") if isinstance(block.get("metadata"), dict) else {}
    return CompiledElement(
        block_id=block.get("id"),
        block_type=str(block.get("block_type") or ""),
        label=config.label if config else str(block.get("block_type") or "").replace("_", " ").title(),
        lane=config.lane if config else "video",
        text=str(block.get("content") or "").strip(),
        speaker=(str(block.get("character_name") or "").strip() or None),
        parenthetical=(str(block.get("parenthetical") or "").strip() or None),
        metadata=metadata,
    )


def build_two_column_rows(elements: list[CompiledElement], type_config: ProjectTypeConfig) -> list[CompiledRow]:
    """Pair video and audio into rows.

    A visual block starts a new row once the current row already shows a visual;
    audio and overlays (lower thirds, on-screen text) join the current row; structural
    blocks get a full-width row of their own.
    """
    rows: list[CompiledRow] = []
    current: CompiledRow | None = None

    def has_visual(row: CompiledRow) -> bool:
        return any((type_config.block(e.block_type) or _UNKNOWN_VISUAL).is_visual for e in row.video)

    for element in elements:
        config = type_config.block(element.block_type)
        lane = config.lane if config else element.lane
        if lane == "structure":
            rows.append(CompiledRow(span=element))
            current = None
            continue
        if lane in {"video", "both"} and (config is None or config.is_visual):
            if current is None or has_visual(current) or lane == "both":
                current = CompiledRow()
                rows.append(current)
            current.video.append(element)
            if lane == "both":
                current = None
            continue
        if current is None:
            current = CompiledRow()
            rows.append(current)
        if lane == "video":
            current.video.append(element)
        else:
            current.audio.append(element)
    return rows


_UNKNOWN_VISUAL = BlockTypeConfig(
    key="", label="", description="", lane="video", is_visual=True,
    speaker_role="none", metadata_schema=None, sort_order=0,
)


def compile_script(
    project: dict[str, Any],
    type_config: ProjectTypeConfig,
    script_format: FormatConfig,
    units: list[dict[str, Any]],
    blocks: list[dict[str, Any]],
) -> CompiledScript:
    renderer = script_format.renderer
    blocks_by_unit: dict[str, list[dict[str, Any]]] = {}
    for block in blocks:
        blocks_by_unit.setdefault(str(block.get("scene_id")), []).append(block)

    children_by_parent: dict[str | None, list[dict[str, Any]]] = {}
    unit_ids = {str(unit.get("id")) for unit in units}
    for unit in units:
        parent = unit.get("parent_id")
        parent_key = str(parent) if parent and str(parent) in unit_ids else None
        children_by_parent.setdefault(parent_key, []).append(unit)

    counters: dict[str, int] = {}

    def build(unit: dict[str, Any]) -> CompiledUnit:
        unit_type = str(unit.get("unit_type") or type_config.leaf_unit.key)
        unit_config = type_config.unit(unit_type)
        label = unit_config.label if unit_config else unit_type.title()
        counters[unit_type] = counters.get(unit_type, 0) + 1
        number = str(unit.get("scene_number") or counters[unit_type])
        compiled = CompiledUnit(
            id=str(unit.get("id")),
            unit_type=unit_type,
            unit_label=label,
            number=number,
            title=str(unit.get("title") or unit.get("slugline_raw") or "").strip(),
            heading=_unit_heading(unit, label, number, renderer),
            summary=unit.get("summary"),
            is_leaf=bool(unit.get("is_leaf", True)),
        )
        unit_blocks = sorted(blocks_by_unit.get(compiled.id, []), key=_sort_key)
        compiled.elements = [_element(b, type_config.block(b.get("block_type"))) for b in unit_blocks]
        if renderer in {"two_column", "instructional"}:
            compiled.rows = build_two_column_rows(compiled.elements, type_config)
        compiled.children = [build(child) for child in sorted(children_by_parent.get(compiled.id, []), key=_sort_key)]
        return compiled

    tree = [build(unit) for unit in sorted(children_by_parent.get(None, []), key=_sort_key)]
    title = str(project.get("name") or "Untitled")
    text = render_text(title, type_config, script_format, tree)
    return CompiledScript(
        project_id=str(project.get("id")),
        project_type=type_config.key,
        format=script_format.key,
        renderer=renderer,
        title=title,
        units=tree,
        text=text,
    )


# ---------------------------------------------------------------------------
# Plain-text rendering
# ---------------------------------------------------------------------------

SCREENPLAY_CHARACTER_INDENT = " " * 22
SCREENPLAY_DIALOGUE_INDENT = " " * 10
SCREENPLAY_PAREN_INDENT = " " * 16
SCREENPLAY_TRANSITION_INDENT = " " * 45
COLUMN_WIDTH = 44


def _wrap(text: str, width: int) -> list[str]:
    words = text.split()
    lines: list[str] = []
    line = ""
    for word in words:
        if line and len(line) + 1 + len(word) > width:
            lines.append(line)
            line = word
        else:
            line = f"{line} {word}".strip()
    if line:
        lines.append(line)
    return lines or [""]


def _metadata_suffix(element: CompiledElement) -> str:
    parts = []
    for key in ("timestamp", "lower_third", "source", "year", "mood", "track", "duration_seconds"):
        value = element.metadata.get(key)
        if value not in (None, ""):
            parts.append(f"{key.replace('_', ' ')}: {value}")
    return f" [{'; '.join(parts)}]" if parts else ""


def _render_screenplay_element(element: CompiledElement) -> list[str]:
    if element.block_type == "scene_heading":
        return [element.text.upper(), ""]
    if element.block_type == "transition":
        return [SCREENPLAY_TRANSITION_INDENT + element.text.upper(), ""]
    if element.block_type == "parenthetical":
        text = element.text if element.text.startswith("(") else f"({element.text})"
        return [SCREENPLAY_PAREN_INDENT + text]
    if element.lane == "audio" or element.speaker:
        lines = []
        if element.speaker:
            cue = element.speaker.upper()
            if element.block_type not in {"dialogue"}:
                cue = f"{cue} ({element.label.upper()})"
            lines.append(SCREENPLAY_CHARACTER_INDENT + cue)
        if element.parenthetical:
            paren = element.parenthetical if element.parenthetical.startswith("(") else f"({element.parenthetical})"
            lines.append(SCREENPLAY_PAREN_INDENT + paren)
        lines.extend(SCREENPLAY_DIALOGUE_INDENT + line for line in _wrap(element.text, 35))
        return lines + [""]
    prefix = "" if element.block_type == "action" else f"{element.label.upper()}: "
    return _wrap(prefix + element.text, 60) + [""]


def _element_line(element: CompiledElement) -> str:
    if element.speaker:
        return f"{element.speaker.upper()} ({element.label}): {element.text}{_metadata_suffix(element)}"
    return f"{element.label.upper()}: {element.text}{_metadata_suffix(element)}"


def _render_rows(rows: list[CompiledRow]) -> list[str]:
    lines = [f"{'VIDEO':<{COLUMN_WIDTH}} | AUDIO", f"{'-' * COLUMN_WIDTH}-+-{'-' * COLUMN_WIDTH}"]
    for row in rows:
        if row.span:
            lines.append(row.span.text.upper())
            continue
        left = [line for e in row.video for line in _wrap(_element_line(e), COLUMN_WIDTH)]
        right = [line for e in row.audio for line in _wrap(_element_line(e), COLUMN_WIDTH)]
        for index in range(max(len(left), len(right), 1)):
            l = left[index] if index < len(left) else ""
            r = right[index] if index < len(right) else ""
            lines.append(f"{l:<{COLUMN_WIDTH}} | {r}".rstrip())
        lines.append(f"{'':<{COLUMN_WIDTH}} |")
    return lines


def _render_treatment(unit: CompiledUnit) -> list[str]:
    lines: list[str] = []
    for element in unit.elements:
        if element.block_type == "lyric":
            stamp = element.metadata.get("timestamp")
            lines.append(f'    "{element.text}"' + (f"  ({stamp})" if stamp else ""))
        elif element.lane == "audio":
            lines.append(f"    [{element.label}: {element.text}{_metadata_suffix(element)}]")
        else:
            lines.extend(_wrap(element.text, 72))
        lines.append("")
    return lines


def _render_instructional(unit: CompiledUnit) -> list[str]:
    lines: list[str] = []
    for element in unit.elements:
        if element.block_type == "quiz":
            question = element.metadata.get("question") or element.text
            lines.append(f"QUIZ: {question}")
            for index, option in enumerate(element.metadata.get("options") or []):
                lines.append(f"   {chr(65 + index)}. {option}")
            if element.metadata.get("answer"):
                lines.append(f"   Answer: {element.metadata['answer']}")
        elif element.block_type == "key_point":
            lines.append(f"* KEY POINT: {element.text}")
        else:
            lines.extend(_wrap(_element_line(element), 76))
        lines.append("")
    return lines


def render_text(
    title: str,
    type_config: ProjectTypeConfig,
    script_format: FormatConfig,
    units: list[CompiledUnit],
) -> str:
    lines = [title.upper(), f"{type_config.label} - {script_format.label}", "", ""]

    def walk(unit: CompiledUnit, depth: int) -> None:
        if not unit.is_leaf:
            lines.append(("=" if depth == 0 else "-") * 3 + f" {unit.heading} " + ("=" if depth == 0 else "-") * 3)
            if unit.summary:
                lines.extend(_wrap(unit.summary, 76))
            lines.append("")
        else:
            starts_with_heading = unit.elements and unit.elements[0].block_type == "scene_heading"
            if not (script_format.renderer == "screenplay" and starts_with_heading):
                lines.append(unit.heading)
                lines.append("")
            if script_format.renderer == "screenplay":
                for element in unit.elements:
                    lines.extend(_render_screenplay_element(element))
            elif script_format.renderer == "two_column":
                lines.extend(_render_rows(unit.rows))
            elif script_format.renderer == "treatment":
                lines.extend(_render_treatment(unit))
            else:
                lines.extend(_render_instructional(unit))
            lines.append("")
        for child in unit.children:
            walk(child, depth + 1)

    for unit in units:
        walk(unit, 0)
    return "\n".join(lines).rstrip() + "\n"
