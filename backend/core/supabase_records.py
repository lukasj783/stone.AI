"""Boundary validators for Supabase payloads.

``postgrest`` types every response payload as a JSON union
(``Mapping[str, JSON] | Sequence[JSON] | bool | float | int | str | None``)
and ``maybe_single().execute()`` as ``Optional[SingleAPIResponse]``. Static
checkers therefore cannot prove that ``response.data`` is a row we can index
or that ``.data`` exists at all.

These helpers narrow the payload once, at the boundary, and every caller then
works with ``dict[str, Any]`` rows. They are real runtime checks too: a
malformed row is dropped instead of raising ``TypeError`` deep inside a query
builder.
"""

from collections.abc import Mapping, Sequence
from typing import Any


def as_record(value: Any) -> dict[str, Any] | None:
    """Return a shallow copy of a JSON object payload, or ``None`` when it is not a mapping."""
    if isinstance(value, Mapping):
        return dict(value)
    return None


def as_records(value: Any) -> list[dict[str, Any]]:
    """Return only the JSON object rows of a list payload.

    Non-list payloads and non-mapping rows are dropped, which matches the
    historical ``response.data or []`` behaviour while keeping element types
    usable by type checkers.
    """
    if not isinstance(value, Sequence) or isinstance(value, str | bytes | bytearray):
        return []
    return [dict(row) for row in value if isinstance(row, Mapping)]


def maybe_single_record(response: Any) -> dict[str, Any] | None:
    """Read the row out of a ``maybe_single()`` response.

    ``postgrest`` returns ``None`` from ``execute()`` when the query matched no
    rows, so the response object itself has to be guarded before ``.data``.
    """
    if response is None:
        return None
    return as_record(getattr(response, "data", None))
