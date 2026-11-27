# Objects and Environments pages that work like Characters

Date: 2026-11-27 · Status: draft for approval

## Why

Storyboard frames drew the Tamucola bottle and the locations differently in every scene.
The cause, found in the project data: the project had no objects at all, none of its six
environments had an image or a description, 29 of 53 frames were drawn from text only,
and each frame's prompt described the bottle in its own words. Characters stay consistent
because each has a structured profile ("stays the same in every shot") and one approved
model sheet that every frame receives. Objects and environments have neither, and their
pages (a plain table plus a side panel) don't invite you to create them.

Goal: make the Objects and Environments pages work like the Characters page, so filling in
a profile and approving a reference is the obvious thing to do, and make the storyboard use
what is filled in.

## Goals

- Objects and Environments pages look and behave like Characters: cards grouped by
  importance tier (big image cards for major and medium, compact rows for minor and
  unranked), and a side panel with a header (image, name, tier, tags) and two tabs.
- **Objects (approach A): an object sheet.** One generated, approved image showing the
  object from several sides plus a close-up of its label or key detail, used by every
  storyboard frame that shows the object. Same flow as character sheets: generate from a
  prompt and optional reference photos, every generation kept as a candidate, the first
  approved automatically, any candidate can be approved later.
- **Environments (approach B): keep the per-angle gallery.** Its "Main image" is the chosen
  state (this already exists: `set_entity_primary_reference`). The tab shows the gallery
  with the main image first and clearly marked.
- Structured, editable profiles, each field marked Manual or From script like characters:
  - Object: size, shape, colours, material, label/branding, distinctive details.
  - Environment: description, look/architecture, lighting and colour palette, fixed
    features (things that must appear the same every time).
- The storyboard uses them: frames showing an object send its approved sheet and its
  profile text; the location line includes the environment's profile text.

## Non-goals

- No automatic checking of object sheets (character sheets are machine-checked for a face
  and four figures; an object sheet is approved by eye in this version).
- No "regenerate every storyboard scene" button. Existing frames must be regenerated per
  scene after adding sheets; a batch "regenerate all" is a separate follow-up.
- No environment sheet, and no change to how environment angles are generated.
- No change to the Characters page.

## Anti-goals (would be a failure even if it works)

- A profile field the storyboard ignores. Every field shown as "stays the same in every
  shot" must reach the frame prompt.
- A sheet that copies its own layout into frames (several bottles in one shot). The frame
  prompt must say the sheet shows ONE object several times, as it does for characters.
- Losing existing object reference images or environment galleries.

## Constraints

- No database migration: `props.metadata` and `environments.metadata` (JSONB) hold the
  profile fields and their manual overrides; object sheets are `assets` linked through
  `asset_links` with new roles, exactly like character sheets (`model_sheet`,
  `model_sheet_candidate`).
- Sheets are drawn by the same WaveSpeed storyboard edit models on a blank 16:9 canvas as
  character sheets (`services/character_sheet.py`), so a prompt-only sheet still works.
- The frame's reference budget (`STORYBOARD_MAX_REFERENCE_IMAGES`) is shared; an object
  sheet counts as one image.
- Matching an object to a frame stays as today: by name or tag in the shot text.

## Approaches considered

- **A. Same look plus a real sheet** (chosen for objects): most consistent, since one image
  fixes every side and the label together; needs new generate/approve endpoints.
- **B. Same look, keep the per-angle gallery with a chosen main image** (chosen for
  environments): little backend work; a place is better shown as separate wide and detail
  views than as one composite.
- Rejected: only restyling the pages. It would not change what the storyboard receives, so
  the inconsistency would remain.

## Design

### Shared page layout (frontend)

`Objects.tsx` and `Environments.tsx` are rebuilt on the Characters pattern:

```
┌ Header: title · New / Extract from script · Refresh · show/hide panel ┐
│ MAJOR  3 · key to the story          │ ┌ Panel ─────────────────────┐ │
│ [card][card][card]                   │ │ [img] Tamucola  MAJOR #1   │ │
│ MEDIUM 2                             │ │       tags · Preview       │ │
│ [card][card]                         │ │ [ Profile | Object sheet ✓]│ │
│ MINOR / UNRANKED                     │ │  fields (Manual/From script)│ │
│ [row][row][row]                      │ │  Importance · Script evidence│ │
└──────────────────────────────────────┴─┴────────────────────────────┴─┘
```

- Card: square image (object: approved sheet; environment: main image; else a placeholder
  with the initial), name, tier badge, a corner badge "Sheet" / "No sheet" (objects) or
  "Main image" / "No image" (environments).
- Shared pieces are extracted rather than copied where Characters already has them
  (tier grouping, card, compact row, Manual/From-script field, section heading) into
  `components/studio/workspace/entity/`; Characters keeps its own components.
- Environments keeps its existing generation choices (create from text, from an uploaded
  image) and the "Used in scenes" list, now inside the panel's References tab. Environments
  currently lists only script-sourced rows; that stays.

### Object profile and sheet (backend)

- Profile fields live in `props.metadata.profile` (`size`, `shape`, `colors`, `material`,
  `branding`, `details`), with `metadata.manual_overrides` extended per field. `GET/PATCH
  /api/story/objects` return and accept them; a field reset removes the override.
- New module `services/object_sheet.py`, modelled on `character_sheet.py` (and reusing its
  canvas, upload, storage and linking helpers, moved to a shared module where needed):
  - Layout asked of the model (16:9, plain light-grey background, flat light, no text):
    front, back, left side, three-quarter from slightly above, and one close-up of the
    label or key detail; same scale, one object.
  - Inputs: the object's profile and description, the project visual style, an optional
    direction, and up to four reference photos (e.g. a real product photo).
  - Every result is stored as an `object_sheet_candidate`; the first becomes the approved
    `object_sheet` automatically; approving another moves the role.
- Endpoints next to the character ones: `POST /api/images/object-sheet/generate` and
  `POST /api/images/object-sheet/approve`.
- Existing object gallery images stay and are offered as sheet reference photos.

### Environment profile (backend)

- `environments.description` becomes editable; `look`, `lighting`, `fixed_features` live
  in `environments.metadata.profile` with manual overrides, through new
  `GET/PATCH /api/story/environments` endpoints (the page currently reads Supabase
  directly; it moves to the API so overrides are handled in one place).

### Storyboard

- `_gather_scene_linked_entities` loads each object's approved sheet and profile, and each
  environment's profile.
- `build_frame_references`: an object with an approved sheet sends the sheet (labelled
  "object sheet: one object shown several times") first, then its detail image for
  close-ups; without a sheet the gallery is used as today.
- Frame prompt: `PROPS:` lists each object with its profile ("Tamucola: 330 ml glass
  bottle, green glass, red label with white logo, silver cap"); the reference note tells the
  model to draw the object once and never copy the sheet's layout. `LOCATION:` adds the
  environment's description, look, lighting and fixed features.

## Decided in the conversation

- Objects: approach A (approved sheet). Environments: approach B (gallery, main image).
- Pages resemble Characters: cards and tabbed profile panel.

## Calls made while writing this (please check)

- The object profile fields (size, shape, colours, material, branding, details) and the
  environment fields (description, look, lighting, fixed features).
- Object sheet layout: four views plus one label/detail close-up.
- No automatic sheet check in this version.
- Shared components go in a new `entity/` folder; Characters is left untouched.
- Environments move from direct Supabase reads to API endpoints.

## Left to the builder

- Exact card sizes, copy, empty states, and placeholder art.
- How the shared helpers are split out of `character_sheet.py`.
- Test layout, following the existing `backend/test_*.py` style.
