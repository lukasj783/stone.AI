# Objects and Environments Pages Like Characters — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Objects get a structured profile and an approved object sheet, environments get an editable profile with their gallery's main image as the chosen reference, both pages look like the Characters page, and storyboard frames use all of it.

**Architecture:** Profiles live in `props.metadata.profile` / `environments.metadata.profile` with per-field manual overrides (no migration). Object sheets copy the character-sheet flow (blank canvas + WaveSpeed edit model, candidates, one approved) in a new `services/object_sheet.py`, without the character check. The storyboard sends an object's approved sheet and profile text, and the environment's profile in the location line. The two pages are rebuilt from shared card/row/field components.

**Tech Stack:** FastAPI + Supabase (Python 3.13, `unittest`), Next.js + React + Tailwind (TypeScript, no frontend test runner: verify with `npx tsc --noEmit`, `npm run lint`, and the browser).

**Spec:** `docs/superpowers/specs/2026-11-27-object-environment-pages-design.md`

## Global Constraints

- No database migration: new data goes in `metadata` JSONB and `asset_links` roles.
- Image endpoints are under the existing `/api/image` router (the spec's `/api/images` was a typo); story endpoints under `/api/story`.
- Object profile fields, in this order: `size`, `shape`, `colors`, `material`, `branding`, `details`.
- Environment profile fields: `description` (the existing column) plus `look`, `lighting`, `fixed_features` in `metadata.profile`.
- Object sheet roles: `object_sheet` (approved, at most one per object) and `object_sheet_candidate` (every generation); `target_type` `"prop"`.
- Object sheet: 16:9, 2k, drawn on `blank_canvas_url()` with a storyboard model from `services/storyboard_models.py`; up to 4 reference images tagged `object` or `style`.
- An approved object sheet does NOT change `props.primary_asset_id`; the gallery stays as it is.
- Characters page and character-sheet behaviour stay unchanged.
- Backend tests run from `backend/`: `../.venv/Scripts/python -m unittest <module> -q`. Full suite: `ls test_*.py | sed 's/\.py$//' | xargs ../.venv/Scripts/python -m unittest -q`.

## Review Focus

1. Generating a sheet for an object with no description, no profile, no direction and no reference image → a clear 400 ("Describe the object…"), not a vague sheet. Test in Task 2.
2. Saving a profile field as an empty string → the value and its Manual override are removed (field shows "From script"/empty), not stored as `""`. Test in Task 1.
3. Approving an asset id that is not one of this object's candidates → 404 with a clear message, nothing changed. Test in Task 2.
4. A frame showing an object with a sheet plus several characters with sheets under the reference cap → the object sheet still gets a slot in the first round and the prompt says to draw the object once. Test in Task 4.
5. An object with no sheet → frames keep using its gallery exactly as before (no regression). Test in Task 4.

---

### Task 1: Object and environment profile fields (backend)

**Files:**
- Create: `backend/services/entity_profiles.py`
- Modify: `backend/schemas/script.py:140-165` (object payloads/response), add environment schemas
- Modify: `backend/routers/story.py` (`_object_profile_response`, `update_object`; new `GET /environments`, `PATCH /environments/{environment_id}`)
- Test: `backend/test_entity_profiles.py`

**Interfaces:**
- Produces (`services/entity_profiles.py`):
  - `OBJECT_PROFILE_FIELDS = ("size", "shape", "colors", "material", "branding", "details")`
  - `ENVIRONMENT_PROFILE_FIELDS = ("look", "lighting", "fixed_features")`
  - `profile_values(metadata: dict | None, fields: tuple[str, ...]) -> dict[str, str | None]`
  - `apply_profile_changes(metadata: dict | None, fields: tuple[str, ...], changes: dict[str, str | None]) -> dict` — returns new metadata; a non-empty value is stored in `metadata["profile"][field]` with `metadata["manual_overrides"][field] = True`; `None` or blank removes both; unknown keys raise `ValueError`.
  - `describe_object(prop: dict) -> str` — `"Tamucola: 330 ml; tall curved glass bottle; green glass, red label; glass; white Tamucola logo; silver cap"` (name, then description if set, then the non-empty profile values in field order, joined with `"; "`).
  - `describe_environment_details(environment: dict) -> str` — description, then `look`, `lighting`, `fixed_features` (prefixed `"always: "`), joined with `"; "`; `""` when all empty.
- Produces (schemas): `UpdateObjectPayload.profile: dict[str, str | None] | None`; `ObjectProfileResponse.profile: dict[str, str | None]`; `EnvironmentProfileResponse` (`id, name, description, tags, primary_image_url, profile, manual_override_fields, location_types, time_of_day_values, source_scene_ids, source_sluglines, scene_count`); `UpdateEnvironmentPayload` (`project_id`, `description: str | None`, `tags: list[str] | None`, `profile: dict[str, str | None] | None`).
- Produces (endpoints): `GET /api/story/environments?project_id=` (script environments only: `metadata->>source == 'script'`, ordered by name); `PATCH /api/story/environments/{environment_id}`; object PATCH accepts `profile`; `manual_override_fields` lists profile keys that are overridden.

- [ ] **Step 1: Write the failing tests** in `backend/test_entity_profiles.py`:
  - `test_profile_change_is_stored_and_marked_manual`: `apply_profile_changes({}, OBJECT_PROFILE_FIELDS, {"size": "330 ml"})` → `["profile"]["size"] == "330 ml"` and `["manual_overrides"]["size"] is True`.
  - `test_blank_value_removes_field_and_override` (Review Focus 2): start with size set and overridden, apply `{"size": "  "}` → `"size"` absent from both dicts.
  - `test_unknown_field_is_rejected`: `{"price": "1"}` → `ValueError`.
  - `test_existing_metadata_is_kept`: `sources`, `source_sluglines` survive.
  - `test_describe_object_orders_fields`: prop with name `Tamucola`, description `None`, profile `{"colors": "green glass", "size": "330 ml"}` → `"Tamucola: 330 ml; green glass"`.
  - `test_describe_object_name_only`: → `"Tamucola"`.
  - `test_describe_environment_details`: description `"Small wooden kiosk"`, look `"blue paint"`, fixed_features `"Tamucola fridge on the left"` → `"Small wooden kiosk; blue paint; always: Tamucola fridge on the left"`.
  - `test_object_response_lists_profile_overrides`: `_object_profile_response({"id": "o1", "name": "T", "metadata": {"profile": {"size": "330 ml"}, "manual_overrides": {"size": True}}})` → `profile["size"] == "330 ml"`, `"size" in manual_override_fields`, every field in `OBJECT_PROFILE_FIELDS` present as a key of `profile`.
- [ ] **Step 2: Run** `../.venv/Scripts/python -m unittest test_entity_profiles -q` → errors (module missing).
- [ ] **Step 3: Implement** `entity_profiles.py`, the schema fields, `_object_profile_response` (profile + overrides), `update_object` (`profile` in `model_fields_set` → `apply_profile_changes`), and the two environment endpoints (same Supabase pattern as `list_objects`/`update_object`; environment response reads `location_types`, `time_of_day_values`, `source_scene_ids`, `source_sluglines`, `scene_count` from metadata; primary image URL from `assets`).
- [ ] **Step 4: Run** the new tests, then the full suite → all pass.
- [ ] **Step 5: Commit** `git add backend/services/entity_profiles.py backend/schemas/script.py backend/routers/story.py backend/test_entity_profiles.py && git commit -m "Add object and environment profile fields"`

### Task 2: Object sheet generation and approval (backend)

**Files:**
- Create: `backend/services/object_sheet.py`
- Modify: `backend/routers/text_to_image.py` (two endpoints, reference upload helper takes allowed tags)
- Modify: `backend/schemas/image_generation.py` (`ObjectSheetResponse`, `ApproveObjectSheetRequest`)
- Modify: `backend/routers/story.py` `list_objects` + `_object_profile_response` (sheet + versions), `backend/schemas/script.py` (`ObjectSheetSummary`)
- Test: `backend/test_object_sheet.py`

**Interfaces:**
- Consumes: `describe_object` (Task 1); from `services/character_sheet.py`: `SheetReference`, `blank_canvas_url()`, `sheet_model_id(model)`, `upload_reference_image(content, content_type)`, `CANVAS_NOTE`, `DEFAULT_SHEET_MODEL`, `SHEET_PROVIDER`, `STORAGE_BUCKET`; `generate_provider_images`.
- Produces (`services/object_sheet.py`):
  - `OBJECT_SHEET_ROLE = "object_sheet"`, `OBJECT_CANDIDATE_ROLE = "object_sheet_candidate"`, `OBJECT_REFERENCE_TAGS = ("object", "style")`, `MAX_OBJECT_REFERENCES = 4`
  - `normalize_object_reference_tag(tag: object) -> str` (unknown → `"object"`)
  - `build_object_sheet_prompt(object_block: str, direction: str = "", references: list[SheetReference] | None = None) -> str` — layout text: one object only; front, back, left side, three-quarter from slightly above in one row at the same scale; one close-up of the label or key detail; plain light-grey background, flat light; no text, labels, numbers, hands, people or other objects; identical object in every view; never mirror the label.
  - `generate_object_sheet(project_id: str, object_id: str, *, direction: str = "", references: list[SheetReference] | None = None, model: str | None = None, visual_style: str | None = None, approve: bool | None = None) -> dict` → `{"object_id", "sheet_asset_id", "sheet_url", "generation_job_id", "approved": bool}`; first sheet approved automatically (`approve is None` and no approved sheet). Raises `ValueError("Describe the object (description or profile), add a direction, or add a reference image before generating its sheet.")` when name is the only detail.
  - `approve_object_sheet(project_id: str, object_id: str, asset_id: str) -> dict` → `{"approved": True, "sheet_asset_id", "sheet_url"}`; replaces the `object_sheet` link and stores `props.metadata["object_sheet"] = {"asset_id", "url", "approved_at", "generation_job_id", "references", "direction", "model"}`. Unknown candidate → `ValueError("That object sheet was not found for this object")`.
  - `object_sheet_versions(project_id: str, object_id: str) -> list[dict]` → newest first, `{"asset_id", "url", "created_at", "approved": bool}`.
- Produces (endpoints): `POST /api/image/object-sheet/generate` (Form: `project_id`, `object_id`, `prompt`, `model`, `visual_style`, `images[]`, `image_tags[]`) and `POST /api/image/object-sheet/approve` (JSON `{project_id, object_id, asset_id}`), both → `ObjectSheetResponse`; `ValueError` → 400 for generate, 404 for approve.
- Produces (object list): `ObjectProfileResponse.sheet: ObjectSheetSummary | None` (`asset_id`, `url`) and `sheet_versions: list[ObjectSheetVersion]` (`asset_id`, `url`, `approved`).

- [ ] **Step 1: Write the failing tests** in `backend/test_object_sheet.py` (mock Supabase, `generate_provider_images`, the image download, and storage upload the way `test_character_*` tests do):
  - `test_prompt_asks_for_one_object_in_four_views_and_a_detail`: prompt contains `"front"`, `"back"`, `"side"`, `"three-quarter"`, `"close-up"`, `"ONE"`, and the object block.
  - `test_reference_lines_follow_the_canvas`: two references (`object`, `style`) → `"Image 2"` and `"Image 3"` lines.
  - `test_unknown_reference_tag_becomes_object`.
  - `test_name_only_object_is_refused` (Review Focus 1): object `{"name": "Tamucola"}`, no direction/references → `ValueError` mentioning `"Describe the object"`; `generate_provider_images` not called.
  - `test_first_sheet_is_approved_automatically`: no existing `object_sheet` link → result `approved is True` and `approve_object_sheet` called.
  - `test_later_sheet_stays_a_candidate`: existing approved link → `approved is False`.
  - `test_approving_a_foreign_asset_fails` (Review Focus 3): no candidate link → `ValueError`, no update/insert issued.
  - `test_canvas_is_image_one_and_model_is_a_storyboard_model`: the request sent has `image_input[0] == blank_canvas_url()` and `model == sheet_model_id(None)`.
- [ ] **Step 2: Run** `../.venv/Scripts/python -m unittest test_object_sheet -q` → errors.
- [ ] **Step 3: Implement** `object_sheet.py` (own render function: generation job of kind `"prop"`, one generation, store JPEG asset at `object-sheets/{object_id}/object_sheet_{uuid}.jpg`, link candidate, no review), the endpoints (generalise `_upload_references` with a `normalize` parameter so characters keep their tags), and the list response (`sheet` from `metadata.object_sheet`, versions from candidate links).
- [ ] **Step 4: Run** the new tests and the full suite → all pass.
- [ ] **Step 5: Commit** `git add backend/services/object_sheet.py backend/routers/text_to_image.py backend/routers/story.py backend/schemas backend/test_object_sheet.py && git commit -m "Add object sheets: generate, keep candidates, approve one"`

### Task 3: Storyboard uses object sheets and profiles

**Files:**
- Modify: `backend/services/storyboard_references.py` (`ReferenceImage`, `build_frame_references`, `describe_references`)
- Modify: `backend/services/storyboard_generation.py` (`_gather_scene_linked_entities:1170-1209`, `_describe_location:490-495`, `_build_frames_from_shot_plans:765-778`)
- Test: `backend/test_storyboard_references.py` (extend), `backend/test_storyboard_object_profiles.py`

**Interfaces:**
- Consumes: `describe_object`, `describe_environment_details` (Task 1); `props.metadata.object_sheet.url` (Task 2).
- Produces: `ReferenceImage.is_object_sheet: bool = False`; object dicts from `_gather_scene_linked_entities` gain `"sheet_url": str | None` and `"profile_text": str`; environment dict gains `"profile_text": str`.

- [ ] **Step 1: Write the failing tests:**
  - `test_object_sheet_is_sent_first_for_its_object`: object `{"name": "Tamucola", "sheet_url": "S", "references": [{"angle": "detail", "url": "D"}]}`, close framing → object queue is `["S", "D"]`, first has `is_object_sheet=True`, label contains `"object sheet"`.
  - `test_object_sheet_gets_a_slot_beside_character_sheets` (Review Focus 4): two characters with model sheets, the object with a sheet, `max_references=3` → `"S"` in the result.
  - `test_object_without_sheet_uses_its_gallery` (Review Focus 5): same output as before this change for an object with only gallery images.
  - `test_describe_references_says_draw_the_object_once`: references with an object sheet → text contains `"ONE object"` and `"never copy"`.
  - `test_props_line_carries_the_profile`: `_build_frames_from_shot_plans` with an object whose `profile_text` is `"Tamucola: 330 ml; green glass"` mentioned in the shot → prompt contains `"PROPS:\n- Tamucola: 330 ml; green glass"`.
  - `test_location_line_uses_environment_profile`: `_describe_location({"location": "Local Kiosk", "time_of_day": "DAY"}, {"profile_text": "Small wooden kiosk; blue paint"})` → `"Local Kiosk, DAY: Small wooden kiosk; blue paint"`.
- [ ] **Step 2: Run** `../.venv/Scripts/python -m unittest test_storyboard_references test_storyboard_object_profiles -q` → failures.
- [ ] **Step 3: Implement:** object queue = `[sheet]` + gallery images by `OBJECT_PRIORITY` up to the tier cap minus one; `describe_references` adds: "An object sheet shows ONE object several times (several sides and a close-up). Draw that object once, as this shot needs it; never copy the sheet's layout, repeated objects or plain background."; PROPS becomes one `- {profile_text}` line per object; `_describe_location` uses `profile_text`, falling back to `description`; gather loads `metadata` for props (already selected) and `metadata` for environments.
- [ ] **Step 4: Run** the new tests and the full suite → all pass.
- [ ] **Step 5: Commit** `git commit -am "Storyboard frames use object sheets and object/environment profiles"` (add the new test file first).

### Task 4: Frontend API types and shared entity components

**Files:**
- Modify: `frontend/my-app/lib/api/story.ts` (object profile/sheet types; `StudioEnvironment`, `listEnvironments`, `updateEnvironment`)
- Modify: `frontend/my-app/lib/api/image-generation.ts` (`generateObjectSheet`, `approveObjectSheet`)
- Modify: `frontend/my-app/components/characters/CharacterReferencePicker.tsx` (optional `tagOptions` + `defaultTags` props; Characters passes nothing and behaves as now)
- Create: `frontend/my-app/components/studio/workspace/entity/EntityCards.tsx` (`TierGroups`, `EntityCard`, `EntityRow`)
- Create: `frontend/my-app/components/studio/workspace/entity/ProfileFact.tsx` (view/edit one field with Manual/From script badge and "Reset" link)
- Create: `frontend/my-app/components/studio/workspace/entity/PanelTabs.tsx`

**Interfaces:**
- Produces (types): `ObjectProfileField = 'size' | 'shape' | 'colors' | 'material' | 'branding' | 'details'`; `StudioObject` gains `profile: Record<ObjectProfileField, string | null>`, `sheet: { asset_id: string; url: string } | null`, `sheet_versions: { asset_id: string; url: string; approved: boolean }[]`; `ObjectProfileUpdate.profile?: Partial<Record<ObjectProfileField, string | null>>`; `EnvironmentProfileField = 'look' | 'lighting' | 'fixed_features'`; `StudioEnvironment` mirrors `EnvironmentProfileResponse` plus `ranking: EnvironmentRanking | null` (joined client-side from `rankEnvironments`); `listEnvironments(projectId): Promise<StudioEnvironment[]>`; `updateEnvironment(projectId, environmentId, { description?, tags?, profile? }): Promise<StudioEnvironment>`; `generateObjectSheet({ project_id, object_id, prompt, model, references }): Promise<ObjectSheetResponse>`; `approveObjectSheet(projectId, objectId, assetId): Promise<ObjectSheetResponse>`.
- Produces (components):
  - `TierGroups<T>({ items, tierOf: (item: T) => ObjectTier | null, renderCard, renderRow })` — Major/Medium as cards (`grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-5`), Minor/Unranked as rows, same labels and hints as Characters' `TIER_GROUPS`.
  - `EntityCard({ name, imageUrl, rank, badge: { label: string; ok: boolean }, subtitle, stats: { icon, value, title }[], selected, onSelect, aspect: 'square' | 'video' })`; `EntityRow` with the same fields minus `aspect`.
  - `ProfileFact({ label, value, manual, isEditing, draft, placeholder, multiline, busy, onChange, onReset })`.
  - `PanelTabs({ tabs: { key: string; label: ReactNode }[], active, onChange })`.
- [ ] **Step 1:** Add the types and API functions; run `cd frontend/my-app && npx tsc --noEmit` → no new errors.
- [ ] **Step 2:** Add the picker props and the three components (styles copied from `Characters.tsx` `CastCard`/`CastRow`/`TextFact`/tablist so the pages match); `npx tsc --noEmit` and `npm run lint` → no new errors.
- [ ] **Step 3: Commit** `git add frontend/my-app/lib frontend/my-app/components && git commit -m "Shared entity cards, profile fields and API for objects and environments"`

### Task 5: Objects page like Characters

**Files:**
- Modify (rewrite): `frontend/my-app/components/studio/workspace/Objects.tsx`
- Create: `frontend/my-app/components/studio/workspace/ObjectSheetCreator.tsx`

**Interfaces:**
- Consumes: Task 4 types/components; `useSheetModel`, `StoryboardModelPicker`, `CharacterReferencePicker` with `tagOptions=[{value:'object',label:'Object',hint:'Copy this object exactly: shape, colours, label'},{value:'style',label:'Style',hint:'Use only the art style'}]`, `defaultTags=['object','object','style','style']`; `ReferenceGallery` (unchanged); `ImagePreviewModal`.
- Behaviour:
  - Header keeps New object, Extract from script, Refresh, panel toggle.
  - Body: `TierGroups` of objects; card image = `sheet.url` ?? `primary_image_url`; badge `Sheet`/`No sheet`; stats = scenes and interactions; "N to fill" when profile fields are empty.
  - Panel header: image, name, tier + rank, tags, "Preview" (opens sheet), edit button.
  - Tab **Profile**: description + the six fields via `ProfileFact` (labels: Size, Shape, Colours, Material, Label / branding, Distinctive details; placeholders e.g. "330 ml, about 20 cm tall"), tags, Importance, Script evidence, Delete; an amber "N details missing — Fill in" banner like Characters.
  - Tab **Object sheet ✓/none**: approved sheet (click to preview), versions grid with "Approve" on non-approved ones, `ObjectSheetCreator` (prompt or reference images + model; shows elapsed time while generating), then `ReferenceGallery` titled "Extra reference images (used only when there is no sheet)".
- [ ] **Step 1:** Build `ObjectSheetCreator` (props: `projectId`, `objectName`, `hasSheet`, `busy`, `onGenerate(prompt, references, model) => Promise<boolean>`).
- [ ] **Step 2:** Rewrite `Objects.tsx`; `npx tsc --noEmit` and `npm run lint` → no new errors.
- [ ] **Step 3: Browser check** (dev server running): open `/studio`, Objects view at 1366×650 and 1920×1080 — create "Tamucola", fill Size and Colours, save, reload: values persist with Manual badges; clearing a field removes its badge; card shows "No sheet"; Object sheet tab shows the creator. (Generating a sheet costs credit: only if the user agrees.)
- [ ] **Step 4: Commit** `git commit -m "Objects page works like Characters: cards, profile and object sheet"` (add both files).

### Task 6: Environments page like Characters

**Files:**
- Modify (rewrite): `frontend/my-app/components/studio/workspace/Environments.tsx`

**Interfaces:**
- Consumes: `listEnvironments`, `updateEnvironment`, `rankEnvironments` (Task 4); existing `generateScriptEnvironmentImage`, `generateEnvironmentImageFromUpload`, `ReferenceGallery`, `ImagePreviewModal`.
- Behaviour:
  - Data loads through `listEnvironments` (no direct Supabase reads); rankings joined by `environment_id`.
  - `TierGroups` with 16:9 cards; badge `Main image`/`No image`; stats = scenes and characters.
  - Panel header: main image (click to preview), name, tier + rank, setting and time.
  - Tab **Profile**: Description, Look / architecture, Lighting & colour palette, Fixed features (things that must look the same every time) via `ProfileFact`; Importance; "Used in scenes" list.
  - Tab **References ✓/none**: the existing "Create from text" / "Use reference image" choices and progress bar, then `ReferenceGallery` (its main-image control is the chosen reference).
- [ ] **Step 1:** Rewrite `Environments.tsx`; `npx tsc --noEmit` and `npm run lint` → no new errors.
- [ ] **Step 2: Browser check:** Environments view lists the 6 environments as cards grouped by tier; editing Local Kiosk's Description and Fixed features persists after reload with Manual badges; References tab shows the two create options and the gallery.
- [ ] **Step 3: Commit** `git commit -am "Environments page works like Characters: cards, profile and references"`

### Task 7: Docs and whole-branch verification

**Files:**
- Modify: `backend/README.md` (Objects and Environments section: profile fields, object sheet endpoints, what the storyboard sends)

- [ ] **Step 1:** Write the README section.
- [ ] **Step 2:** Run the full backend suite, `npx tsc --noEmit`, `npm run lint` → all pass / no new errors.
- [ ] **Step 3:** Confirm with the user before any paid generation; if agreed, generate a Tamucola sheet, regenerate one scene's storyboard, and check its prompt contains the PROPS profile line and its references include the object sheet.
- [ ] **Step 4: Commit** `git commit -am "Document object and environment profiles and object sheets"`
