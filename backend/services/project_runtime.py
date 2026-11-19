"""Read the runtime settings a project chose on its idea form."""

from dataclasses import dataclass
from typing import Any

from services.duration_budget import normalize_pacing, parse_duration_seconds


@dataclass(frozen=True)
class ProjectRuntime:
    target_seconds: int | None = None
    # "action" | "comedy" | "drama", or "" for the project type's default pacing.
    pacing: str = ""


def runtime_from_idea_metadata(metadata: Any) -> ProjectRuntime:
    if not isinstance(metadata, dict):
        return ProjectRuntime()
    brief = metadata.get("brief") if isinstance(metadata.get("brief"), dict) else {}
    return ProjectRuntime(
        target_seconds=parse_duration_seconds(metadata.get("duration") or brief.get("duration")),
        pacing=normalize_pacing(metadata.get("pacing")),
    )


def load_project_runtime(supabase: Any, project_id: str) -> ProjectRuntime:
    """The runtime and pacing saved with the project's idea / brief document."""
    try:
        rows = supabase.table("project_documents").select("metadata").eq("project_id", project_id).eq(
            "type", "idea"
        ).limit(1).execute().data or []
    except Exception:
        return ProjectRuntime()
    return runtime_from_idea_metadata(rows[0].get("metadata") if rows else None)
