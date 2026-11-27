"""Structured profiles for objects (props) and environments.

A profile is a handful of short text fields kept in the row's ``metadata["profile"]``. A field the
user typed is marked in ``metadata["manual_overrides"]`` like character fields are, so the page can
show "Manual" and a reset removes both the value and the mark. No migration: it is all metadata JSONB.
"""

from __future__ import annotations

OBJECT_PROFILE_FIELDS = ("size", "shape", "colors", "material", "branding", "details")
ENVIRONMENT_PROFILE_FIELDS = ("look", "lighting", "fixed_features")


def _clean(value: object) -> str | None:
    if not isinstance(value, str):
        return None
    text = " ".join(value.strip().split())
    return text or None


def _profile(metadata: object) -> dict:
    profile = metadata.get("profile") if isinstance(metadata, dict) else None
    return profile if isinstance(profile, dict) else {}


def profile_values(metadata: dict | None, fields: tuple[str, ...]) -> dict[str, str | None]:
    """Every field as a key, ``None`` where nothing is set."""
    profile = _profile(metadata)
    return {field: _clean(profile.get(field)) for field in fields}


def apply_profile_changes(
    metadata: dict | None,
    fields: tuple[str, ...],
    changes: dict[str, str | None],
) -> dict:
    """Return new metadata with ``changes`` applied; blank or ``None`` clears a field and its override."""
    unknown = [key for key in changes if key not in fields]
    if unknown:
        raise ValueError(f"Unknown profile field: {', '.join(sorted(unknown))}")
    updated = dict(metadata or {})
    profile = dict(_profile(updated))
    overrides = dict(updated.get("manual_overrides") or {}) if isinstance(updated.get("manual_overrides"), dict) else {}
    for field, raw in changes.items():
        value = _clean(raw)
        if value is None:
            profile.pop(field, None)
            overrides.pop(field, None)
        else:
            profile[field] = value
            overrides[field] = True
    updated["profile"] = profile
    updated["manual_overrides"] = overrides
    return updated


def describe_object(prop: dict) -> str:
    """``"Name: description; size; shape; ..."`` from whatever is filled in, or just the name."""
    name = _clean(prop.get("name")) or "Object"
    values = profile_values(prop.get("metadata"), OBJECT_PROFILE_FIELDS)
    parts = [_clean(prop.get("description")), *(values[field] for field in OBJECT_PROFILE_FIELDS)]
    details = [part for part in parts if part]
    return f"{name}: {'; '.join(details)}" if details else name


def describe_environment_details(environment: dict) -> str:
    """Description, look, lighting and the fixed features, or ``""`` when none is filled in."""
    values = profile_values(environment.get("metadata"), ENVIRONMENT_PROFILE_FIELDS)
    fixed = values["fixed_features"]
    parts = [
        _clean(environment.get("description")),
        values["look"],
        values["lighting"],
        f"always: {fixed}" if fixed else None,
    ]
    return "; ".join(part for part in parts if part)
