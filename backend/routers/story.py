import json
import replicate
from fastapi import APIRouter, HTTPException, BackgroundTasks
import asyncio

from core.supabase_client import get_supabase_client
from core.config import get_settings
from schemas.story import GenerateOutlineResponse, GenerateScriptPayload, GenerateScriptResponse, MovieIdeaPayload

router = APIRouter(prefix="/api/story", tags=["story"])

@router.post("/generate-outline", response_model=GenerateOutlineResponse)
async def generate_outline(payload: MovieIdeaPayload) -> GenerateOutlineResponse:
    try:
        settings = get_settings()
        api_token = settings.replicate_api_token
        if not api_token:
            raise HTTPException(status_code=500, detail="REPLICATE_API_TOKEN not configured")

        characters_text = "\n".join(
            [
                f"- {character.name} ({character.role or 'Character'}): "
                f"Archetype={character.archetype or 'N/A'}, "
                f"Personality={character.personality or 'N/A'}, "
                f"Traits={', '.join(character.tags) if character.tags else 'N/A'}"
                for character in payload.characters
            ]
        ) or "- No characters supplied"

        prompt = f"""
You are an expert Hollywood screenwriter and story consultant. 
Generate a detailed movie outline based on the following project data:

Basics:
- Project Type: {payload.basics.projectType}
- Duration: {payload.basics.duration}
- Genres: {', '.join(payload.basics.genres) if payload.basics.genres else 'N/A'}
- Themes/Tone: {', '.join(payload.basics.themeTone) if payload.basics.themeTone else 'N/A'}
- Ending Type: {payload.basics.endingType}
- Visual Style: {payload.basics.visualStyle}

Story:
- Logline: {payload.story.logline}
- Premise: {payload.story.premise}

Characters:
{characters_text}

Please structure the outline into:
1. Act I (Inciting Incident, Plot Point 1)
2. Act II (Rising Action, Midpoint, Lowest Point)
3. Act III (Climax, Resolution)

Return the output in clean Markdown format with professional sluglines.
"""

        client = replicate.Client(api_token=api_token)

        output = client.run(
            "google/gemini-2.5-flash",
            input={
                "prompt": prompt
            }
        )

        # Gemini returns the output as a generator or string, handle that
        outline_text = "".join(output) if not isinstance(output, str) else output

        return GenerateOutlineResponse(outline=outline_text)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/generate-script", response_model=GenerateScriptResponse)
async def generate_script(payload: GenerateScriptPayload, background_tasks: BackgroundTasks) -> GenerateScriptResponse:
    try:
        settings = get_settings()
        api_token = settings.replicate_api_token
        if not api_token:
            raise HTTPException(status_code=500, detail="REPLICATE_API_TOKEN not configured")
            
        supabase = get_supabase_client()

        # Check if we already have scenes to generate.
        # Step 1: Draft the scene index/beatsheet outline dividing the whole story into a sequence of scenes
        characters_text = "\n".join(
            [f"- {c.name}: {c.archetype or c.role}" for c in payload.characters]
        ) if payload.characters else "- Elements inferred from outline"

        plan_prompt = f"""
You are an expert Hollywood screenwriter and story planner.
Analyze the provided screenplay outline and break it down into a sequence of structured screenplay scenes.
Do not write the screenplay content yet. Just outline and define the sequence of scenes.

Here is the outline:
{payload.outline}

Characters:
{characters_text}

Output ONLY valid JSON matching this schema:
{{
  "scenes": [
    {{
      "slugline_raw": "INT. OR EXT. LOCATION - TIME",
      "location_type": "INT." or "EXT." or "INT./EXT.",
      "location": "LOCATION",
      "time_of_day": "TIME",
      "summary": "Detailed but brief prompt/summary of what happens in this scene, character actions, narrative context, and what dialogue goals must be met."
    }}
  ]
}}

Format rules:
- Extract all scenes from the outline. Provide the list of scenes.
- Ensure strict JSON formatting. No markdown code blocks around the response, just the raw JSON object.
"""

        client = replicate.Client(api_token=api_token)

        output = client.run(
            "google/gemini-2.5-flash",
            input={
                "prompt": plan_prompt
            }
        )

        beats_text = "".join(output) if not isinstance(output, str) else output
        
        # Clean up possible markdown wrappers from LLM response
        cleaned_beats = beats_text.strip()
        if cleaned_beats.startswith("```"):
            lines = cleaned_beats.splitlines()
            if lines[0].startswith("```"):
                lines = lines[1:]
            if lines and lines[-1].strip() == "```":
                lines = lines[:-1]
            cleaned_beats = "\n".join(lines).strip()
            
        try:
            parsed_beats = json.loads(cleaned_beats)
        except json.JSONDecodeError as je:
            print(f"Failed to parse beats JSON directly. Attempting custom cleaning.")
            start_obj = cleaned_beats.find('{')
            end_obj = cleaned_beats.rfind('}')
            start_arr = cleaned_beats.find('[')
            end_arr = cleaned_beats.rfind(']')
            
            start_idx = -1
            end_idx = -1
            if start_obj != -1 and (start_arr == -1 or start_obj < start_arr):
                start_idx = start_obj
                end_idx = end_obj
            elif start_arr != -1:
                start_idx = start_arr
                end_idx = end_arr
                
            if start_idx != -1 and end_idx != -1 and end_idx > start_idx:
                try:
                    parsed_beats = json.loads(cleaned_beats[start_idx:end_idx+1])
                except Exception:
                    raise HTTPException(status_code=500, detail=f"Invalid layout JSON returned by LLM: {je}")
            else:
                raise HTTPException(status_code=500, detail=f"Invalid layout JSON returned by LLM: {je}")

        if isinstance(parsed_beats, list):
            beats_list = parsed_beats
        elif isinstance(parsed_beats, dict):
            beats_list = parsed_beats.get("scenes", [])
        else:
            beats_list = []

        scenes_inserted = []
        scene_order = 0
        
        # Clean up existing scenes and blocks for the project first
        try:
            supabase.table("scenes").delete().eq("project_id", payload.project_id).execute()
            supabase.table("project_documents").delete().eq("project_id", payload.project_id).eq("type", "script").execute()
        except Exception as delete_err:
            print(f"Error purging old screenplay objects: {delete_err}")

        # Insert scenes as pending placeholders
        for idx, scene in enumerate(beats_list):
            try:
                scene_res = supabase.table("scenes").insert({
                    "project_id": payload.project_id,
                    "slugline_raw": scene.get("slugline_raw", ""),
                    "location_type": scene.get("location_type", "INT."),
                    "location": scene.get("location", ""),
                    "time_of_day": scene.get("time_of_day", "DAY"),
                    "summary": scene.get("summary", ""),
                    "status": "pending",
                    "sort_order": idx
                }).execute()
                
                if scene_res and hasattr(scene_res, 'data') and scene_res.data and len(scene_res.data) > 0:
                    scenes_inserted.append(scene_res.data[0])
            except Exception as scene_err:
                print(f"Failed to insert placeholder scene {idx}: {scene_err}")

        # Launch the progressive backdrop generator
        background_tasks.add_task(
            progressive_generation_worker,
            payload.project_id,
            scenes_inserted,
            characters_text,
            payload.basics.dict() if payload.basics else {}
        )

        # To maintain compatibility with matching GenerateScriptResponse (which expects scenes and blocks),
        # we can structure a response that tells the front-end that progressive processing is occurring,
        # or we return the scenes without blocks initially.
        response_scenes = []
        for s in scenes_inserted:
            response_scenes.append({
                "slugline_raw": s.get("slugline_raw", ""),
                "location_type": s.get("location_type"),
                "location": s.get("location"),
                "time_of_day": s.get("time_of_day"),
                "blocks": []
            })
            
        return GenerateScriptResponse(scenes=response_scenes)

    except Exception as e:
        print(f"Error in prepare script pipeline: {e}")
        raise HTTPException(status_code=500, detail=str(e))


from pydantic import BaseModel

class RewriteIncompletePayload(BaseModel):
    project_id: str

@router.post("/rewrite-incomplete")
async def rewrite_incomplete(payload: RewriteIncompletePayload, background_tasks: BackgroundTasks):
    try:
        supabase = get_supabase_client()
        
        # 1. Fetch all scenes for the project
        scenes_res = supabase.table("scenes").select("*").eq("project_id", payload.project_id).order("sort_order", desc=False).execute()
        all_scenes = scenes_res.data if scenes_res and hasattr(scenes_res, 'data') else []
        
        if not all_scenes:
            raise HTTPException(status_code=400, detail="No scenes found for this project. Please generate the screenplay layout first.")

        # 2. Fetch script blocks to find which scene ids already have content
        blocks_res = supabase.table("script_blocks").select("scene_id").eq("project_id", payload.project_id).execute()
        blocks_data = blocks_res.data if blocks_res and hasattr(blocks_res, 'data') else []
        completed_scene_ids = {b.get("scene_id") for b in blocks_data if b.get("scene_id")}

        # 3. Filter to find the incomplete scenes (or scenes with no blocks)
        incomplete_scenes = []
        for s in all_scenes:
            scene_id = s.get("id")
            if scene_id not in completed_scene_ids or s.get("status") in ["pending", "failed", "in_progress"]:
                # Clear any partial blocks for this scene
                try:
                    supabase.table("script_blocks").delete().eq("scene_id", scene_id).execute()
                except Exception as del_err:
                    print(f"Error purging blocks for scene {scene_id}: {del_err}")
                
                # Reset status to pending in database
                try:
                    supabase.table("scenes").update({"status": "pending"}).eq("id", scene_id).execute()
                except Exception as up_err:
                    print(f"Error resetting status for scene {scene_id}: {up_err}")
                
                s["status"] = "pending"
                incomplete_scenes.append(s)

        if not incomplete_scenes:
            return {"message": "All scenes are already generated and completed!", "rewritten_count": 0}

        # 4. Fetch characters to build the description text
        char_res = supabase.table("characters").select("*").eq("project_id", payload.project_id).execute()
        char_list = char_res.data if char_res and hasattr(char_res, 'data') else []
        characters_text = "\n".join(
            [f"- {c.get('name')}: {c.get('role') or c.get('archetype', 'Character')}" for c in char_list]
        ) if char_list else "- Elements inferred from outline"

        # 5. Fetch project detail to supply basic configuration
        proj_res = supabase.table("projects").select("*").eq("id", payload.project_id).execute()
        proj_data = proj_res.data[0] if proj_res and hasattr(proj_res, 'data') and proj_res.data else {}
        basics_dict = {
            "projectType": proj_data.get("description") or "Feature Film",
            "genres": [],
            "visualStyle": "Realistic Cinematic"
        }

        # 6. Launch the progressive backdrop generator
        background_tasks.add_task(
            progressive_generation_worker,
            payload.project_id,
            incomplete_scenes,
            characters_text,
            basics_dict
        )

        return {
            "message": f"Successfully launched background writing worker for {len(incomplete_scenes)} incomplete scenes.",
            "incomplete_scenes": [s.get("slugline_raw") for s in incomplete_scenes],
            "rewritten_count": len(incomplete_scenes)
        }

    except Exception as e:
        print(f"Error in rewrite incomplete pipeline: {e}")
        raise HTTPException(status_code=500, detail=str(e))


async def progressive_generation_worker(
    project_id: str,
    scenes: list,
    characters_text: str,
    basics_dict: dict
):
    try:
        settings = get_settings()
        api_token = settings.replicate_api_token
        supabase = get_supabase_client()
        client = replicate.Client(api_token=api_token)

        consolidated_screenplay = {"scenes": []}
        previous_scene_context = "This is the first scene of the screenplay."

        for i, scene in enumerate(scenes):
            scene_id = scene.get("id")
            slugline = scene.get("slugline_raw", "")
            summary = scene.get("summary", "")

            # Set status to in_progress
            try:
                supabase.table("scenes").update({"status": "in_progress"}).eq("id", scene_id).execute()
            except Exception as update_err:
                print(f"Error updating scene status to in_progress: {update_err}")

            draft_prompt = f"""
You are an expert Hollywood screenwriter and script formatter.
You are writing a formatted scene for a screenplay. Do not write the entire movie script, only generate formatting for this single active scene.

Here is the details of the scene you are writing:
Slugline: {slugline}
Beat description: {summary}

---
Global Movie Metadata:
Type: {basics_dict.get("projectType", "Feature Film")}
Genres: {", ".join(basics_dict.get("genres", []))}
Visual style: {basics_dict.get("visualStyle", "Realistic Cinematic")}

Characters:
{characters_text}

---
Important Context - END OF PREVIOUS SCENE:
{previous_scene_context}
---

Write out the standard Action, Dialogue, and Character blocks for this scene.

Output ONLY valid JSON matching this schema for the blocks:
{{
  "blocks": [
    {{
      "block_type": "scene_heading" | "action" | "character" | "parenthetical" | "dialogue" | "transition",
      "content": "Text content of the block. If character, just the name. If dialogue, just the words.",
      "character_name": "Used only if block is dialogue or parenthetical",
      "parenthetical": "Used only if block is dialogue and there is a parenthetical"
    }}
  ]
}}

Format rules:
- Ensure strict JSON formatting. No markdown code blocks around the response, just the raw JSON object.
"""

            output = client.run(
                "google/gemini-2.5-flash",
                input={"prompt": draft_prompt}
            )
            
            blocks_text = "".join(output) if not isinstance(output, str) else output
            
            cleaned_blocks = blocks_text.strip()
            if cleaned_blocks.startswith("```"):
                lines = cleaned_blocks.splitlines()
                if lines[0].startswith("```"):
                    lines = lines[1:]
                if lines and lines[-1].strip() == "```":
                    lines = lines[:-1]
                cleaned_blocks = "\n".join(lines).strip()
                
            try:
                parsed_blocks = json.loads(cleaned_blocks)
            except json.JSONDecodeError:
                start_obj = cleaned_blocks.find('{')
                end_obj = cleaned_blocks.rfind('}')
                start_arr = cleaned_blocks.find('[')
                end_arr = cleaned_blocks.rfind(']')
                
                start_idx = -1
                end_idx = -1
                if start_obj != -1 and (start_arr == -1 or start_obj < start_arr):
                    start_idx = start_obj
                    end_idx = end_obj
                elif start_arr != -1:
                    start_idx = start_arr
                    end_idx = end_arr
                    
                if start_idx != -1 and end_idx != -1 and end_idx > start_idx:
                    try:
                        parsed_blocks = json.loads(cleaned_blocks[start_idx:end_idx+1])
                    except Exception:
                        parsed_blocks = []
                else:
                    parsed_blocks = []

            if isinstance(parsed_blocks, list):
                blocks = parsed_blocks
            elif isinstance(parsed_blocks, dict):
                blocks = parsed_blocks.get("blocks", [])
            else:
                blocks = []
            
            # Save the blocks
            for idx, block in enumerate(blocks):
                try:
                    block_type = block.get("block_type", "action")
                    if block_type not in ["scene_heading", "action", "dialogue", "transition", "shot", "title", "montage"]:
                        if block_type in ["character", "parenthetical"]:
                            block_type = "dialogue"
                        else:
                            block_type = "action"

                    supabase.table("script_blocks").insert({
                        "project_id": project_id,
                        "scene_id": scene_id,
                        "block_type": block_type,
                        "content": block.get("content", ""),
                        "character_name": block.get("character_name"),
                        "parenthetical": block.get("parenthetical"),
                        "sort_order": idx
                    }).execute()
                except Exception as b_err:
                    print(f"Failed to insert background script block: {b_err}")
            
            # Mark scene as complete
            try:
                supabase.table("scenes").update({"status": "complete"}).eq("id", scene_id).execute()
            except Exception as e:
                pass
            
            # Store in unified object
            scene_copy = dict(scene)
            scene_copy["blocks"] = blocks
            consolidated_screenplay["scenes"].append(scene_copy)
            
            # Extract last 10 lines to pass as context to the next scene so dialogue/plot flows smoothly.
            if blocks and len(blocks) > 0:
                last_blocks = blocks[-10:] if len(blocks) > 10 else blocks
                previous_scene_context = "\n".join(
                    [f"[{b.get('block_type', '').upper()}] {b.get('character_name', '')}: {b.get('content', '')}" if b.get('block_type') == 'dialogue' else f"[{b.get('block_type', '').upper()}] {b.get('content', '')}" for b in last_blocks]
                )
            else:
                previous_scene_context = f"End of scene: {slugline}"
            
            # Add small sleep to prevent replicate API rate limit violations.
            await asyncio.sleep(2)
            
        # Optional: Render out the full json string and save to project_documents.
        try:
            full_script_str = json.dumps(consolidated_screenplay)
            supabase.table("project_documents").insert({
                "project_id": project_id,
                "type": "script",
                "title": "Generated Script",
                "content": full_script_str,
                "metadata": {"source": "gemini-2.5-flash-progressive"}
            }).execute()
        except:
            pass
            
    except Exception as worker_err:
        print(f"Background worker failed: {worker_err}")

        # Finally, save consolidated full file to project_documents
        try:
            supabase.table("project_documents").insert({
                "project_id": project_id,
                "type": "script",
                "title": "Generated Screenplay",
                "content": json.dumps(consolidated_screenplay),
                "metadata": {"source": "gemini-2.5-flash-progressive"}
            }).execute()
        except Exception as block_save_err:
            print(f"Failed consolidating complete screenplay: {block_save_err}")
