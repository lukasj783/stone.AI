"""Universal Script Engine API: configuration and compiled script output."""

import asyncio
from typing import Any

from fastapi import APIRouter, HTTPException, Query

from core.supabase_client import require_supabase_client
from core.supabase_records import as_records
from services.script_compiler import CompiledScript, compile_script
from services.script_config import (
    engine_config_payload,
    load_engine_config,
    load_project_script_context,
    project_type_payload,
)


router = APIRouter(prefix="/api/script-engine", tags=["script-engine"])


@router.get("/config")
async def get_engine_config(refresh: bool = Query(default=False)) -> dict[str, Any]:
    """Every project type with its formats, unit types and block types."""
    try:
        config = await asyncio.to_thread(load_engine_config, refresh)
        return engine_config_payload(config)
    except Exception as error:
        raise HTTPException(status_code=500, detail=f"Could not load script engine config: {error}") from error


@router.get("/projects/{project_id}/config")
async def get_project_config(project_id: str) -> dict[str, Any]:
    """The configuration that applies to one project, plus its selected format."""
    try:
        context = await asyncio.to_thread(load_project_script_context, project_id)
    except ValueError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    return {
        "project_id": project_id,
        "project_type": context.type_config.key,
        "script_format": context.format.key,
        "renderer": context.format.renderer,
        "config": project_type_payload(context.type_config),
    }


def compile_project_script(project_id: str) -> CompiledScript:
    context = load_project_script_context(project_id)
    supabase = require_supabase_client()
    units = as_records(supabase.table("scenes").select(
        "id, parent_id, unit_type, is_leaf, title, slugline_raw, scene_number, summary, sort_order, created_at"
    ).eq("project_id", project_id).execute().data)
    blocks = as_records(supabase.table("script_blocks").select(
        "id, scene_id, block_type, content, character_name, parenthetical, metadata, sort_order, created_at"
    ).eq("project_id", project_id).execute().data)
    return compile_script(context.project, context.type_config, context.format, units, blocks)


def save_compiled_script(compiled: CompiledScript) -> str:
    """Store the compiled script as the project's script document (replacing older ones)."""
    supabase = require_supabase_client()
    supabase.table("project_documents").delete().eq("project_id", compiled.project_id).eq("type", "script").execute()
    result = supabase.table("project_documents").insert({
        "project_id": compiled.project_id,
        "type": "script",
        "title": compiled.title,
        "content": compiled.text,
        "metadata": {
            "source": "script_compiler",
            "project_type": compiled.project_type,
            "format": compiled.format,
            "renderer": compiled.renderer,
            "compiled": compiled.to_dict(),
        },
    }).execute()
    rows = as_records(result.data)
    return str(rows[0]["id"]) if rows else ""


@router.get("/projects/{project_id}/compile")
async def compile_project(project_id: str, save: bool = Query(default=False)) -> dict[str, Any]:
    """Render the project's script in its format. With save=true it is stored as the script document."""
    try:
        compiled = await asyncio.to_thread(compile_project_script, project_id)
        payload = compiled.to_dict()
        if save:
            payload["document_id"] = await asyncio.to_thread(save_compiled_script, compiled)
        return payload
    except ValueError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    except Exception as error:
        raise HTTPException(status_code=500, detail=f"Script compilation failed: {error}") from error
