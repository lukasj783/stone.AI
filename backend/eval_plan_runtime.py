"""Measure how well real script plans fit the chosen runtime.

Runs the production planner (plan_script: one plan call plus the fit loop) through
the configured Gemini model for each project type at its
usual runtimes, several times each, and reports:

- first-try fit: how often the model's own plan already had the right scene count
  and no overlong scene,
- retries: extra model calls the fit loop needed,
- splits: plans that still needed scenes split in code,
- final fit: plans that end inside the scene-count range with no overlong scene.

This calls the real model (costs money). Usage, from backend/:
    python eval_plan_runtime.py [--runs 5] [--workers 6] [--out results.json]
"""

import argparse
import json
import statistics
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

from services.duration_budget import format_seconds, parse_duration_seconds, unit_count_range
from services.gemini_client import run_gemini
from services.script_config import build_engine_config
from services.script_generation import leaf_units, plan_script

FIXTURE = Path(__file__).parent / "test_fixtures" / "script_engine_config.json"

CASES = [
    ("feature_film", "30 min"),
    ("feature_film", "1 hr"),
    ("feature_film", "120 min"),
    ("short_film", "3 min"),
    ("short_film", "15 min"),
    ("music_video", "3 min"),
    ("documentary", "30 min"),
    ("advertisement", "30 sec"),
    ("explainer", "90 sec"),
    ("educational", "10 min"),
]

# Deliberately short sources: the runtime, not the source, should decide the scene count.
SOURCES = {
    "feature_film": "A retired lighthouse keeper discovers that the storms hitting her island are being "
                    "caused by a stranger who washed ashore. She must decide whether to hand him over to "
                    "the mainland authorities or help him finish what he came to do.",
    "short_film": "A boy tries to return a lost dog before his family moves away the next morning.",
    "music_video": "Song: an upbeat pop track about leaving a small town. Concept: the singer drives "
                   "through the town at dawn while memories play out in each place she passes.",
    "documentary": "The rise and decline of a family-run textile mill that employed half a town for "
                   "eighty years, told through former workers, archive footage and the empty building today.",
    "advertisement": "A reusable water bottle that keeps drinks cold for 24 hours. Audience: commuters. "
                     "Message: stay refreshed all day. Call to action: order online today.",
    "explainer": "How a mobile banking app lets small traders accept payments by QR code and track sales.",
    "educational": "Teach beginners how to add and subtract fractions with unlike denominators.",
}
CHARACTERS = {
    "feature_film": "- MARA: retired lighthouse keeper\n- THE STRANGER: man who washed ashore",
    "short_film": "- LEO: ten-year-old boy\n- BISCUIT: the lost dog",
    "music_video": "- THE SINGER: lead artist",
    "documentary": "- Former mill workers (interviewees)",
}


def run_case(type_config, duration: str, run: int, pacing: str = "") -> dict:
    target = parse_duration_seconds(duration)
    label = "Here is the outline:" if type_config.key in ("feature_film", "short_film") else "Here is the creative brief:"
    calls = 0

    def model(text: str) -> str:
        nonlocal calls
        calls += 1
        return run_gemini(text)

    started = time.monotonic()
    result = {"type": type_config.key, "duration": duration, "target_seconds": target, "run": run, "pacing": pacing}
    try:
        plan, report = plan_script(
            model,
            type_config,
            type_config.default_format,
            label,
            SOURCES[type_config.key],
            CHARACTERS.get(type_config.key, "- Elements inferred from the source material"),
            duration,
            pacing,
        )
    except Exception as error:  # record and keep going
        return {**result, "error": str(error), "calls": calls, "seconds": round(time.monotonic() - started, 1)}
    leaves = leaf_units(plan)
    first = next((a for a in report["attempts"] if "unit_count" in a), {})
    return {
        **result,
        "calls": calls,
        "seconds": round(time.monotonic() - started, 1),
        "range": report["unit_count_range"],
        "first_count": first.get("unit_count"),
        "first_model_seconds": first.get("model_seconds"),
        "first_fit": bool(first) and not first.get("problems"),
        "attempts": report["attempts"],
        "split_units": report["split_units"],
        "final_count": len(leaves),
        "final_seconds": round(sum(u.duration_seconds or 0 for u in leaves)),
        "longest_scene": max((u.duration_seconds or 0 for u in leaves), default=0),
        "max_scene": report["max_unit_seconds"],
        "fits": report["fits"],
        "retries": len(report["attempts"]) - 1,
        "target_count": report.get("target_unit_count"),
    }


def summarize(results: list[dict]) -> str:
    lines = [
        f"{'type':14} {'runtime':>8} {'range':>7} {'1st-try counts':<22} {'1st fit':>7} "
        f"{'retries':>7} {'split':>5} {'final counts':<22} {'fit':>4} {'total':>8}",
    ]
    for type_key, duration in CASES:
        rows = [r for r in results if r["type"] == type_key and r["duration"] == duration]
        if not rows:
            continue
        ok = [r for r in rows if "error" not in r]
        errors = len(rows) - len(ok)
        target = parse_duration_seconds(duration)
        assert target is not None, f"unreadable case duration: {duration}"
        low, high = unit_count_range(target, type_key, rows[0].get("pacing", ""))
        first = ",".join(str(r["first_count"]) for r in ok)
        final = ",".join(str(r["final_count"]) for r in ok)
        retries = sum(r["retries"] for r in ok)
        totals = {r["final_seconds"] for r in ok}
        total_text = format_seconds(next(iter(totals))) if len(totals) == 1 else "varies"
        lines.append(
            f"{type_key:14} {duration:>8} {f'{low}-{high}':>7} {first:<22} "
            f"{sum(r['first_fit'] for r in ok)}/{len(ok):<5} {retries:>7} "
            f"{sum(1 for r in ok if r['split_units']):>5} {final:<22} "
            f"{sum(r['fits'] for r in ok)}/{len(ok):<2} {total_text:>8}"
            + (f"  ({errors} errors)" if errors else "")
        )
    ok = [r for r in results if "error" not in r]
    if ok:
        lines.append("")
        lines.append(
            f"Overall: first-try fit {sum(r['first_fit'] for r in ok)}/{len(ok)}, "
            f"final fit {sum(r['fits'] for r in ok)}/{len(ok)}, "
            f"plans needing a retry {sum(1 for r in ok if r['retries'])}, "
            f"plans split in code {sum(1 for r in ok if r['split_units'])}, "
            f"model calls {sum(r['calls'] for r in results)}, "
            f"errors {len(results) - len(ok)}, "
            f"median time per plan {statistics.median(r['seconds'] for r in ok):.0f}s"
        )
    return "\n".join(lines)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--runs", type=int, default=5)
    parser.add_argument("--workers", type=int, default=6)
    parser.add_argument("--out", type=Path, default=None)
    parser.add_argument("--pacing", choices=["action", "comedy", "drama"], default="",
                        help="pacing for the film cases (other project types ignore it)")
    parser.add_argument("--films-only", action="store_true", help="only run the feature and short film cases")
    parser.add_argument("--long-only", action="store_true", help="only run cases of 45 minutes or more")
    args = parser.parse_args()

    config = build_engine_config(json.loads(FIXTURE.read_text(encoding="utf-8")))
    cases = [
        c for c in CASES
        if (not args.films_only or c[0] in ("feature_film", "short_film"))
        and (not args.long_only or (parse_duration_seconds(c[1]) or 0) >= 45 * 60)
    ]
    jobs = [
        (config.project_type(t), d, r, args.pacing if t in ("feature_film", "short_film") else "")
        for t, d in cases
        for r in range(1, args.runs + 1)
    ]
    results: list[dict] = []
    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        futures = [pool.submit(run_case, *job) for job in jobs]
        for done, future in enumerate(as_completed(futures), start=1):
            result = future.result()
            results.append(result)
            status = result.get("error") or (
                f"first {result['first_count']} -> final {result['final_count']} "
                f"({'fits' if result['fits'] else 'DOES NOT FIT'}, {result['calls']} calls)"
            )
            print(f"[{done}/{len(jobs)}] {result['type']} {result['duration']} #{result['run']}: {status}", flush=True)

    results.sort(key=lambda r: (CASES.index((r["type"], r["duration"])), r["run"]))
    if args.out:
        args.out.write_text(json.dumps(results, indent=2), encoding="utf-8")
    print()
    print(summarize(results))
    return 0


if __name__ == "__main__":
    sys.exit(main())
