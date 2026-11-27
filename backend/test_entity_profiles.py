import unittest
from unittest.mock import MagicMock

from services.entity_profiles import (
    ENVIRONMENT_PROFILE_FIELDS,
    OBJECT_PROFILE_FIELDS,
    apply_profile_changes,
    describe_environment_details,
    describe_object,
)


class ProfileChangeTests(unittest.TestCase):
    def test_profile_change_is_stored_and_marked_manual(self) -> None:
        metadata = apply_profile_changes({}, OBJECT_PROFILE_FIELDS, {"size": "330 ml"})
        self.assertEqual(metadata["profile"]["size"], "330 ml")
        self.assertIs(metadata["manual_overrides"]["size"], True)

    def test_blank_value_removes_field_and_override(self) -> None:
        start = {"profile": {"size": "330 ml"}, "manual_overrides": {"size": True, "name": True}}
        metadata = apply_profile_changes(start, OBJECT_PROFILE_FIELDS, {"size": "  "})
        self.assertNotIn("size", metadata["profile"])
        self.assertNotIn("size", metadata["manual_overrides"])
        self.assertIs(metadata["manual_overrides"]["name"], True)

    def test_none_value_removes_field_and_override(self) -> None:
        start = {"profile": {"look": "blue paint"}, "manual_overrides": {"look": True}}
        metadata = apply_profile_changes(start, ENVIRONMENT_PROFILE_FIELDS, {"look": None})
        self.assertNotIn("look", metadata["profile"])
        self.assertNotIn("look", metadata["manual_overrides"])

    def test_unknown_field_is_rejected(self) -> None:
        with self.assertRaises(ValueError):
            apply_profile_changes({}, OBJECT_PROFILE_FIELDS, {"price": "1"})

    def test_existing_metadata_is_kept(self) -> None:
        start = {"sources": ["script"], "source_sluglines": ["INT. KIOSK - DAY"]}
        metadata = apply_profile_changes(start, OBJECT_PROFILE_FIELDS, {"shape": "tall bottle"})
        self.assertEqual(metadata["sources"], ["script"])
        self.assertEqual(metadata["source_sluglines"], ["INT. KIOSK - DAY"])

    def test_input_metadata_is_not_mutated(self) -> None:
        start = {"profile": {"size": "330 ml"}, "manual_overrides": {"size": True}}
        apply_profile_changes(start, OBJECT_PROFILE_FIELDS, {"size": None})
        self.assertEqual(start["profile"], {"size": "330 ml"})


class DescribeTests(unittest.TestCase):
    def test_describe_object_orders_fields(self) -> None:
        prop = {"name": "Tamucola", "description": None, "metadata": {"profile": {"colors": "green glass", "size": "330 ml"}}}
        self.assertEqual(describe_object(prop), "Tamucola: 330 ml; green glass")

    def test_describe_object_puts_description_first(self) -> None:
        prop = {"name": "Tamucola", "description": "a soda bottle", "metadata": {"profile": {"material": "glass"}}}
        self.assertEqual(describe_object(prop), "Tamucola: a soda bottle; glass")

    def test_describe_object_name_only(self) -> None:
        self.assertEqual(describe_object({"name": "Tamucola"}), "Tamucola")

    def test_describe_environment_details(self) -> None:
        environment = {
            "description": "Small wooden kiosk",
            "metadata": {"profile": {"look": "blue paint", "fixed_features": "Tamucola fridge on the left"}},
        }
        self.assertEqual(
            describe_environment_details(environment),
            "Small wooden kiosk; blue paint; always: Tamucola fridge on the left",
        )

    def test_describe_environment_details_empty(self) -> None:
        self.assertEqual(describe_environment_details({"description": None, "metadata": {}}), "")


class ObjectResponseTests(unittest.TestCase):
    def test_object_response_lists_profile_overrides(self) -> None:
        from routers.story import _object_profile_response

        response = _object_profile_response({
            "id": "o1",
            "name": "T",
            "metadata": {"profile": {"size": "330 ml"}, "manual_overrides": {"size": True}},
        })
        self.assertEqual(response.profile["size"], "330 ml")
        self.assertIn("size", response.manual_override_fields)
        for field in OBJECT_PROFILE_FIELDS:
            self.assertIn(field, response.profile)


class EnvironmentResponseTests(unittest.TestCase):
    def test_environment_response_reads_script_metadata_and_profile(self) -> None:
        from routers.story import _environment_profile_response

        response = _environment_profile_response({
            "id": "e1",
            "name": "Local Kiosk",
            "description": "Small wooden kiosk",
            "tags": ["shop"],
            "metadata": {
                "source": "script",
                "location_types": ["EXT"],
                "time_of_day_values": ["DAY"],
                "source_scene_ids": ["s1", "s2"],
                "source_sluglines": ["EXT. LOCAL KIOSK - DAY"],
                "scene_count": 2,
                "profile": {"lighting": "hard noon sun"},
                "manual_overrides": {"lighting": True, "description": True},
            },
        }, "https://img/kiosk.jpg")
        self.assertEqual(response.primary_image_url, "https://img/kiosk.jpg")
        self.assertEqual(response.location_types, ["EXT"])
        self.assertEqual(response.scene_count, 2)
        self.assertEqual(response.profile, {"look": None, "lighting": "hard noon sun", "fixed_features": None})
        self.assertEqual(sorted(response.manual_override_fields), ["description", "lighting"])


class EnvironmentReextractionTests(unittest.TestCase):
    """Running "Extract from script" again must not wipe what the user typed in."""

    def test_reextraction_keeps_profile_and_manual_description(self) -> None:
        from routers.story import _persist_script_environments

        existing = {
            "id": "e1",
            "description": "Small wooden kiosk",
            "metadata": {
                "source": "script",
                "script_key": "local kiosk",
                "profile": {"look": "blue paint"},
                "manual_overrides": {"look": True, "description": True},
            },
        }
        supabase = MagicMock()
        table = supabase.table.return_value
        table.select.return_value.eq.return_value.execute.return_value.data = [existing]

        _persist_script_environments(supabase, "p1", [{
            "name": "Local Kiosk",
            "source_scene_ids": ["s1"],
            "source_sluglines": ["EXT. LOCAL KIOSK - DAY"],
            "location_types": ["EXT"],
            "time_of_day_values": ["DAY"],
        }])

        values = table.update.call_args.args[0]
        self.assertNotIn("description", values)
        self.assertEqual(values["metadata"]["profile"], {"look": "blue paint"})
        self.assertEqual(values["metadata"]["manual_overrides"], {"look": True, "description": True})
        self.assertEqual(values["metadata"]["source_scene_ids"], ["s1"])


class _FakeQuery:
    """Just enough of the postgrest builder: filters by ``eq``, records ``update``."""

    def __init__(self, db: "_FakeSupabase", table: str) -> None:
        self.db, self.table, self.filters, self.values, self.single = db, table, [], None, False

    def select(self, *_args, **_kwargs):
        return self

    def eq(self, column, value):
        self.filters.append((column, value))
        return self

    def in_(self, column, values):
        self.filters.append((column, tuple(values)))
        return self

    def order(self, *_args, **_kwargs):
        return self

    def maybe_single(self):
        self.single = True
        return self

    def update(self, values):
        self.values = values
        return self

    def _matches(self, row: dict) -> bool:
        for column, value in self.filters:
            if column == "metadata->>source":
                actual = (row.get("metadata") or {}).get("source")
            else:
                actual = row.get(column)
            if isinstance(value, tuple):
                if actual not in value:
                    return False
            elif actual != value:
                return False
        return True

    def execute(self):
        rows = [row for row in self.db.rows[self.table] if self._matches(row)]
        if self.values is not None:
            self.db.updates.append((self.table, self.values))
            for row in rows:
                row.update(self.values)
        result = MagicMock()
        result.data = (rows[0] if rows else None) if self.single else rows
        return result


class _FakeSupabase:
    def __init__(self, **rows: list[dict]) -> None:
        self.rows = {"assets": [], **rows}
        self.updates: list[tuple[str, dict]] = []

    def table(self, name: str) -> _FakeQuery:
        return _FakeQuery(self, name)


class EnvironmentEndpointTests(unittest.TestCase):
    def _kiosk(self) -> dict:
        return {
            "id": "e1", "project_id": "p1", "name": "Local Kiosk", "description": None, "tags": [],
            "primary_asset_id": "a1", "metadata": {"source": "script", "source_scene_ids": ["s1"], "scene_count": 1},
        }

    def _run(self, coroutine_factory, db: _FakeSupabase):
        import asyncio
        from unittest.mock import patch

        with patch("routers.story.get_supabase_client", return_value=db):
            return asyncio.run(coroutine_factory())

    def test_list_returns_script_environments_with_their_main_image(self) -> None:
        from routers.story import list_environments

        manual = {**self._kiosk(), "id": "e2", "name": "Moon", "metadata": {"source": "manual"}}
        db = _FakeSupabase(environments=[self._kiosk(), manual], assets=[{"id": "a1", "url": "https://img/k.jpg"}])
        result = self._run(lambda: list_environments("p1"), db)
        self.assertEqual([environment.id for environment in result], ["e1"])
        self.assertEqual(result[0].primary_image_url, "https://img/k.jpg")

    def test_patch_stores_description_and_profile_as_manual(self) -> None:
        from routers.story import update_environment
        from schemas.script import UpdateEnvironmentPayload

        db = _FakeSupabase(environments=[self._kiosk()])
        payload = UpdateEnvironmentPayload(
            project_id="p1", description="Small wooden kiosk", profile={"fixed_features": "fridge on the left"},
        )
        result = self._run(lambda: update_environment("e1", payload), db)
        self.assertEqual(result.description, "Small wooden kiosk")
        self.assertEqual(result.profile["fixed_features"], "fridge on the left")
        self.assertEqual(sorted(result.manual_override_fields), ["description", "fixed_features"])
        self.assertEqual(db.rows["environments"][0]["metadata"]["source_scene_ids"], ["s1"])

    def test_patch_clearing_description_removes_its_manual_mark(self) -> None:
        from routers.story import update_environment
        from schemas.script import UpdateEnvironmentPayload

        kiosk = self._kiosk()
        kiosk["description"] = "Small wooden kiosk"
        kiosk["metadata"]["manual_overrides"] = {"description": True}
        db = _FakeSupabase(environments=[kiosk])
        result = self._run(lambda: update_environment("e1", UpdateEnvironmentPayload(project_id="p1", description="  ")), db)
        self.assertIsNone(result.description)
        self.assertNotIn("description", result.manual_override_fields)

    def test_patch_rejects_unknown_profile_field_with_400(self) -> None:
        from fastapi import HTTPException
        from routers.story import update_environment
        from schemas.script import UpdateEnvironmentPayload

        db = _FakeSupabase(environments=[self._kiosk()])
        with self.assertRaises(HTTPException) as caught:
            self._run(lambda: update_environment("e1", UpdateEnvironmentPayload(project_id="p1", profile={"size": "x"})), db)
        self.assertEqual(caught.exception.status_code, 400)
        self.assertEqual(db.updates, [])

    def test_patch_unknown_environment_is_404(self) -> None:
        from fastapi import HTTPException
        from routers.story import update_environment
        from schemas.script import UpdateEnvironmentPayload

        db = _FakeSupabase(environments=[self._kiosk()])
        with self.assertRaises(HTTPException) as caught:
            self._run(lambda: update_environment("nope", UpdateEnvironmentPayload(project_id="p1", description="x")), db)
        self.assertEqual(caught.exception.status_code, 404)


class ObjectEndpointTests(unittest.TestCase):
    def test_patch_object_profile_keeps_other_fields(self) -> None:
        import asyncio
        from unittest.mock import patch
        from routers.story import update_object
        from schemas.script import UpdateObjectPayload

        prop = {"id": "o1", "project_id": "p1", "name": "Tamucola", "description": None, "tags": [],
                "metadata": {"sources": ["script"], "profile": {"size": "330 ml"}, "manual_overrides": {"size": True}}}
        db = _FakeSupabase(props=[prop])
        payload = UpdateObjectPayload(project_id="p1", profile={"colors": "green glass", "size": ""})
        with patch("routers.story.get_supabase_client", return_value=db):
            result = asyncio.run(update_object("o1", payload))
        self.assertEqual(result.profile["colors"], "green glass")
        self.assertIsNone(result.profile["size"])
        self.assertIn("colors", result.manual_override_fields)
        self.assertNotIn("size", result.manual_override_fields)

    def test_patch_object_unknown_profile_field_is_400(self) -> None:
        import asyncio
        from unittest.mock import patch
        from fastapi import HTTPException
        from routers.story import update_object
        from schemas.script import UpdateObjectPayload

        db = _FakeSupabase(props=[{"id": "o1", "project_id": "p1", "name": "T", "metadata": {}}])
        with patch("routers.story.get_supabase_client", return_value=db), self.assertRaises(HTTPException) as caught:
            asyncio.run(update_object("o1", UpdateObjectPayload(project_id="p1", profile={"price": "1"})))
        self.assertEqual(caught.exception.status_code, 400)


if __name__ == "__main__":
    unittest.main()
