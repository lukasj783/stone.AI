"""Start the Celery workers for "Generate All Scenes at Once".

    python run_storyboard_workers.py

Needs Redis running at REDIS_URL (default redis://localhost:6379/0). Starts two workers:

* images: renders storyboard frames. STORYBOARD_BATCH_CONCURRENCY (default 30) is how many
  frames are generated at the same time across the whole project. Raise it if your WaveSpeed
  plan allows more parallel requests; frames that hit WaveSpeed's rate limit wait and retry.
* plans: plans each scene's shot list with the language model. STORYBOARD_PLAN_CONCURRENCY
  (default 10) scenes are planned at once; their frames start rendering as soon as each is ready.

Thread pools are used so the workers also run on Windows. Stop both with Ctrl+C.
"""

import os
import subprocess
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parent


def _concurrency(name: str, default: int) -> int:
    try:
        return max(1, int(os.getenv(name, str(default))))
    except ValueError:
        return default


def _worker(name: str, queue: str, concurrency: int) -> list[str]:
    return [
        sys.executable, "-m", "celery", "-A", "core.celery_app", "worker",
        "--pool=threads", f"--concurrency={concurrency}", "-Q", queue,
        "-n", f"{name}@%h", "--loglevel=INFO",
    ]


def main() -> int:
    sys.path.insert(0, str(BACKEND))
    from core.config import _load_env_file  # read backend/.env the same way the API does

    _load_env_file()
    images = _concurrency("STORYBOARD_BATCH_CONCURRENCY", 30)
    plans = _concurrency("STORYBOARD_PLAN_CONCURRENCY", 10)
    print(f"Storyboard workers: {images} frames at once, {plans} scenes planned at once.")
    processes = [
        subprocess.Popen(_worker("storyboard-images", "storyboard-image", images), cwd=BACKEND),
        subprocess.Popen(_worker("storyboard-plans", "storyboard-plan", plans), cwd=BACKEND),
    ]
    try:
        return max(process.wait() for process in processes)
    except KeyboardInterrupt:
        for process in processes:
            process.terminate()
        return 0


if __name__ == "__main__":
    raise SystemExit(main())
