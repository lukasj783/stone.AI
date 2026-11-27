import unittest
from unittest import mock

import httpx

from services import storyboard_batch as batches
from services import storyboard_generation as sg
from services.wavespeed_service import WaveSpeedServiceError


class SceneSelectionTests(unittest.TestCase):
    def test_scenes_whose_shots_all_have_images_are_skipped(self) -> None:
        include, skipped = batches.scenes_needing_storyboard(
            ["done", "partial", "new"],
            {"done": ["d1", "d2"], "partial": ["p1", "p2"]},
            {"d1", "d2", "p1"},
        )
        self.assertEqual(include, ["partial", "new"])
        self.assertEqual(skipped, ["done"])

    def test_estimate_counts_missing_frames_and_an_average_shot_list_for_new_scenes(self) -> None:
        by_scene = {"done": ["d1", "d2", "d3", "d4"], "partial": ["p1", "p2"]}
        imaged = {"d1", "d2", "d3", "d4", "p1"}
        # partial needs 1 frame; "new" gets the average planned size (4 + 2) / 2 = 3.
        self.assertEqual(batches.estimate_images(["partial", "new"], by_scene, imaged), 4)

    def test_estimate_uses_a_default_when_nothing_is_planned_yet(self) -> None:
        self.assertEqual(batches.estimate_images(["a", "b"], {}, set()), 2 * batches.DEFAULT_SHOTS_PER_SCENE)


class StatusTests(unittest.TestCase):
    def test_scene_state_follows_the_job_phase(self) -> None:
        self.assertEqual(batches.scene_state("queued", None), "queued")
        self.assertEqual(batches.scene_state("running", "planning"), "planning")
        self.assertEqual(batches.scene_state("running", "rendering"), "rendering")
        self.assertEqual(batches.scene_state("failed", "rendering"), "failed")

    def test_batch_runs_until_every_scene_ends(self) -> None:
        self.assertEqual(batches.batch_outcome(["queued", "queued"]), "queued")
        self.assertEqual(batches.batch_outcome(["complete", "rendering"]), "running")
        self.assertEqual(batches.batch_outcome(["complete", "failed"]), "complete")
        self.assertEqual(batches.batch_outcome(["failed", "cancelled"]), "failed")

    def test_scene_job_outcome_counts_failed_frames(self) -> None:
        self.assertEqual(sg.scene_job_outcome(["complete", "in_progress"]), ("running", None))
        self.assertEqual(sg.scene_job_outcome(["complete", "complete"]), ("complete", None))
        self.assertEqual(sg.scene_job_outcome(["complete", "failed"]), ("failed", "1 storyboard frame failed"))
        self.assertEqual(sg.scene_job_outcome([]), ("running", None))


class RetryRuleTests(unittest.TestCase):
    def test_rate_limits_and_outages_are_retried(self) -> None:
        self.assertTrue(batches.is_retryable(WaveSpeedServiceError("busy", status=429)))
        self.assertTrue(batches.is_retryable(WaveSpeedServiceError("down", status=503)))

    def test_blocked_content_is_not_retried_and_does_not_stop_the_batch(self) -> None:
        blocked = WaveSpeedServiceError("blocked", code=1200)
        self.assertFalse(batches.is_retryable(blocked))
        self.assertFalse(batches.stops_batch(blocked))

    def test_running_out_of_credit_stops_the_batch(self) -> None:
        broke = WaveSpeedServiceError("no credit", code=1407)
        self.assertFalse(batches.is_retryable(broke))
        self.assertTrue(batches.stops_batch(broke))

    def test_retry_delay_grows_and_is_capped(self) -> None:
        with mock.patch.object(batches.random, "uniform", return_value=1.0):
            self.assertEqual(batches.retry_delay_seconds(0), 8.0)
            self.assertEqual(batches.retry_delay_seconds(2), 32.0)
            self.assertEqual(batches.retry_delay_seconds(10), 120.0)


class SingleSceneFlowTests(unittest.TestCase):
    """generate_scene_storyboard now plans with prepare_scene_storyboard and renders shot by shot."""

    SHOTS = [
        {"id": "s2", "shot_number": 2, "sort_order": 1, "prompt": "two", "status": "in_progress", "metadata": {}},
        {"id": "s1", "shot_number": 1, "sort_order": 0, "prompt": "one", "status": "in_progress", "metadata": {}},
    ]

    def test_reused_storyboard_is_returned_without_rendering(self) -> None:
        existing = sg.GenerateStoryboardResponse(scene_id="scene", status="complete", reused=True, frames=[])
        with mock.patch.object(sg, "prepare_scene_storyboard", return_value=existing), \
                mock.patch.object(sg, "render_storyboard_shot") as render:
            self.assertIs(sg.generate_scene_storyboard("project", "scene"), existing)
        render.assert_not_called()

    def test_frames_render_and_a_failed_frame_makes_the_result_partial(self) -> None:
        prepared = sg.PreparedSceneStoryboard("job", "llm", list(self.SHOTS), list(self.SHOTS))

        def render(project_id, scene_id, job_id, shot, **_):
            if shot["id"] == "s2":
                raise RuntimeError("model error")
            return "http://img/s1.jpg"

        with mock.patch.object(sg, "prepare_scene_storyboard", return_value=prepared), \
                mock.patch.object(sg, "render_storyboard_shot", side_effect=render), \
                mock.patch.object(sg, "mark_shot_failed") as mark_failed, \
                mock.patch.object(sg, "refresh_scene_job", return_value="failed"):
            response = sg.generate_scene_storyboard("project", "scene")

        mark_failed.assert_called_once_with("s2")
        self.assertEqual(response.status, "partial")
        self.assertEqual(response.generation_job_id, "job")
        self.assertEqual([frame.shot_id for frame in response.frames], ["s1", "s2"])
        self.assertEqual(response.frames[0].image_url, "http://img/s1.jpg")
        self.assertEqual(response.frames[1].status, "failed")

    def test_render_uses_the_prompt_styled_at_planning_time(self) -> None:
        shot = {"id": "s1", "sort_order": 0, "prompt": "raw", "metadata": {
            "styled_prompt": "raw, in watercolor", "image_references": ["http://ref/a.jpg"],
        }}
        image_response = mock.Mock(images=["http://out/s1.png"])
        with mock.patch.object(sg, "generate_provider_images", return_value=image_response) as generate, \
                mock.patch.object(sg, "load_project_visual_style") as load_style, \
                mock.patch.object(sg, "_persist_frame_image", return_value="http://stored/s1.jpg") as persist:
            url = sg.render_storyboard_shot("project", "scene", "job", shot)

        self.assertEqual(url, "http://stored/s1.jpg")
        load_style.assert_not_called()
        request = generate.call_args.args[0]
        self.assertEqual(request.prompt, "raw, in watercolor")
        self.assertEqual(request.image_input, ["http://ref/a.jpg"])
        persist.assert_called_once_with("project", "scene", "job", shot, "http://out/s1.png", 0)


class RunnerChoiceTests(unittest.TestCase):
    def setUp(self) -> None:
        batches._runner_cache = None
        self.addCleanup(setattr, batches, "_runner_cache", None)

    def _choose(self, redis_up: bool, workers_up: bool) -> str:
        with mock.patch.object(batches, "_redis_reachable", return_value=redis_up), \
                mock.patch.object(batches, "_celery_storyboard_workers_running", return_value=workers_up):
            return batches.choose_runner()

    def test_celery_when_redis_and_workers_are_running(self) -> None:
        self.assertEqual(self._choose(True, True), batches.RUNNER_CELERY)

    def test_fallback_when_redis_is_down(self) -> None:
        self.assertEqual(self._choose(False, True), batches.RUNNER_LOCAL)

    def test_fallback_when_redis_runs_but_no_worker_listens(self) -> None:
        self.assertEqual(self._choose(True, False), batches.RUNNER_LOCAL)

    def test_answer_is_remembered_briefly(self) -> None:
        self.assertEqual(self._choose(False, False), batches.RUNNER_LOCAL)
        self.assertEqual(self._choose(True, True), batches.RUNNER_LOCAL)


class LocalRunnerTests(unittest.TestCase):
    def setUp(self) -> None:
        from services import storyboard_local_runner as runner_module

        self.module = runner_module
        self.runner = runner_module.LocalStoryboardRunner()

    def test_plan_step_queues_renders_on_the_same_runner(self) -> None:
        def plan_step(job_id, attempt, queue_render, retry_later):
            queue_render(job_id, "shot-1")

        with mock.patch.object(self.module, "run_plan_step", side_effect=plan_step), \
                mock.patch.object(self.runner, "render") as render:
            self.runner._run_plan("job", 0)
        render.assert_called_once_with("job", "shot-1")

    def test_busy_provider_schedules_the_next_attempt(self) -> None:
        def render_step(job_id, shot_id, attempt, retry_later):
            retry_later(RuntimeError("busy"), 12.0)

        with mock.patch.object(self.module, "run_render_step", side_effect=render_step), \
                mock.patch.object(self.runner, "_later") as later:
            self.runner._run_render("job", "shot", 2)
        later.assert_called_once_with(12.0, self.runner.render, "job", "shot", 3)

    def test_a_crashed_render_marks_its_frame_failed(self) -> None:
        with mock.patch.object(self.module, "run_render_step", side_effect=RuntimeError("database down")), \
                mock.patch.object(self.module, "mark_shot_failed") as mark_failed:
            self.runner._run_render("job", "shot", 0)
        mark_failed.assert_called_once_with("shot")

    def test_a_crashed_plan_marks_its_scene_failed(self) -> None:
        with mock.patch.object(self.module, "run_plan_step", side_effect=RuntimeError("boom")), \
                mock.patch.object(self.module.batches, "set_job_failed") as set_failed:
            self.runner._run_plan("job", 0)
        set_failed.assert_called_once()
        self.assertEqual(set_failed.call_args.args[0], "job")

    def test_runner_only_knows_batches_it_started(self) -> None:
        self.runner.track("b1", ["job"])
        self.assertFalse(self.runner.is_live("b1"), "nothing queued yet")
        self.runner._begin("job")
        self.assertTrue(self.runner.is_live("b1"))
        self.assertFalse(self.runner.is_live("b2"))

    def _drain(self) -> None:
        plans, images = self.runner._pools()
        plans.shutdown(wait=True)
        images.shutdown(wait=True)

    def test_batch_stays_live_while_a_frame_renders_and_ends_when_none_are_left(self) -> None:
        seen: list[bool] = []

        def render_step(job_id, shot_id, attempt, retry_later):
            seen.append(self.runner.is_live("b1"))

        self.runner.track("b1", ["job"])
        with mock.patch.object(self.module, "run_render_step", side_effect=render_step):
            self.runner.render("job", "shot")
            self._drain()
        self.assertEqual(seen, [True])
        self.assertFalse(self.runner.is_live("b1"))

    def test_a_frame_that_died_leaves_no_live_work(self) -> None:
        # Offline: the render crashes and even marking the frame failed can't reach the database.
        self.runner.track("b1", ["job"])
        with mock.patch.object(self.module, "run_render_step", side_effect=RuntimeError("getaddrinfo failed")), \
                mock.patch.object(self.module, "mark_shot_failed", side_effect=RuntimeError("getaddrinfo failed")):
            self.runner.render("job", "shot")
            self._drain()
        self.assertFalse(self.runner.is_live("b1"))

    def test_a_scheduled_retry_keeps_the_batch_live(self) -> None:
        def render_step(job_id, shot_id, attempt, retry_later):
            retry_later(RuntimeError("busy"), 30.0)

        self.runner.track("b1", ["job"])
        with mock.patch.object(self.module, "run_render_step", side_effect=render_step), \
                mock.patch.object(self.module.threading, "Timer") as timer:
            self.runner.render("job", "shot")
            self._drain()
        timer.return_value.start.assert_called_once()
        self.assertTrue(self.runner.is_live("b1"))

        # When the timer fires the frame is queued again, then the waiting retry is no longer counted.
        fire = timer.call_args.args[1]
        job_id, _action, *rest = timer.call_args.kwargs["args"]
        render = mock.Mock()
        fire(job_id, render, *rest)
        render.assert_called_once_with("job", "shot", 1)
        self.assertFalse(self.runner.is_live("b1"))


class OfflineStepTests(unittest.TestCase):
    """Losing the internet while talking to the database retries the step instead of dropping it."""

    def setUp(self) -> None:
        from services import storyboard_batch_jobs as jobs

        self.jobs = jobs
        self.offline = httpx.ConnectError("[Errno 11001] getaddrinfo failed")

    def test_render_step_retries_when_the_database_is_unreachable(self) -> None:
        retry_later = mock.Mock()
        with mock.patch.object(self.jobs.batches, "load_job", side_effect=self.offline):
            self.jobs.run_render_step("job", "shot", 0, retry_later)
        retry_later.assert_called_once()
        self.assertIs(retry_later.call_args.args[0], self.offline)

    def test_render_step_gives_up_after_its_last_attempt(self) -> None:
        with mock.patch.object(self.jobs.batches, "load_job", side_effect=self.offline), \
                self.assertRaises(httpx.ConnectError):
            self.jobs.run_render_step("job", "shot", self.jobs.RENDER_MAX_RETRIES, mock.Mock())

    def test_render_step_retries_when_saving_progress_fails_after_the_frame(self) -> None:
        retry_later = mock.Mock()
        job = {"id": "job", "status": "running", "storyboard_batch_id": "b1", "model": "m", "settings": {}}
        shot = {"id": "shot", "project_id": "p", "scene_id": "s", "status": "in_progress", "metadata": {}}
        supabase = mock.Mock()
        supabase.table.return_value.select.return_value.eq.return_value.limit.return_value.execute.return_value.data = [shot]
        with mock.patch.object(self.jobs.batches, "load_job", return_value=job), \
                mock.patch.object(self.jobs, "require_supabase_client", return_value=supabase), \
                mock.patch.object(self.jobs, "render_storyboard_shot", return_value="https://img"), \
                mock.patch.object(self.jobs, "refresh_scene_job", side_effect=self.offline):
            self.jobs.run_render_step("job", "shot", 0, retry_later)
        retry_later.assert_called_once()

    def test_plan_step_retries_when_the_database_is_unreachable(self) -> None:
        retry_later = mock.Mock()
        with mock.patch.object(self.jobs.batches, "load_job", side_effect=self.offline):
            self.jobs.run_plan_step("job", 0, mock.Mock(), retry_later)
        retry_later.assert_called_once()

    def test_other_database_errors_are_not_retried(self) -> None:
        with mock.patch.object(self.jobs.batches, "load_job", side_effect=ValueError("bad row")), \
                self.assertRaises(ValueError):
            self.jobs.run_render_step("job", "shot", 0, mock.Mock())


class InterruptedBatchTests(unittest.TestCase):
    """A fallback batch left 'running' by a backend restart is reported as stopped."""

    def _status(self, runner: str, live: bool):
        from routers import storyboard_batches as router

        running = {"runner": runner, "status": "running"}
        stopped = {"runner": runner, "status": "cancelled"}
        with mock.patch.object(router.batches, "batch_status", side_effect=[running, stopped]) as status, \
                mock.patch.object(router.batches, "cancel_batch") as cancel, \
                mock.patch.object(router.local_runner, "is_live", return_value=live):
            result = router._status("b1", "p1")
        return result, cancel, status

    def test_restarted_backend_stops_its_fallback_batch(self) -> None:
        result, cancel, _ = self._status(batches.RUNNER_LOCAL, live=False)
        cancel.assert_called_once()
        self.assertIn("restarted", cancel.call_args.args[1])
        self.assertEqual(result["status"], "cancelled")

    def test_fallback_batch_this_backend_is_running_continues(self) -> None:
        result, cancel, _ = self._status(batches.RUNNER_LOCAL, live=True)
        cancel.assert_not_called()
        self.assertEqual(result["status"], "running")

    def test_celery_batches_are_never_stopped_by_a_backend_restart(self) -> None:
        _, cancel, _ = self._status(batches.RUNNER_CELERY, live=False)
        cancel.assert_not_called()


if __name__ == "__main__":
    unittest.main()
