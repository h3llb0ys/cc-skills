from contextlib import closing
import io
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import client
import mm
import watches


ROOT, REPLY, CHANNEL, TEAM, OTHER = (ch * 26 for ch in "abcde")
URL = "https://mm.example/team/pl/"


def post(key, at, root="", channel=CHANNEL):
    return dict(id=key, create_at=at, edit_at=0, user_id=OTHER, root_id=root, channel_id=channel,
                message="Question?", file_ids=[])


class ApiTests(unittest.TestCase):
    def setUp(self):
        self.env = patch.dict(os.environ, MM_URL="https://mm.example", MM_COOKIE="MMAUTHTOKEN=dummy; MMCSRF=test",
                              MM_CONFIG="/unused")
        self.env.start()
        self.addCleanup(self.env.stop)
        self.api = client.Client()

    def test_cookie_origin_and_csrf(self):
        with patch.object(self.api.opener, "open", return_value=io.BytesIO(b"{}")) as send:
            with self.assertRaises(ValueError):
                self.api.thread("https://mm.example.evil/team/pl/" + ROOT)
            send.assert_not_called()
            self.api.api("users/ids", body=[OTHER])
            request = send.call_args.args[0]
            self.assertEqual(request.full_url, "https://mm.example/api/v4/users/ids")
            self.assertEqual(request.get_header("X-csrf-token"), "test")
            self.assertEqual(request.get_header("Cookie"), os.environ["MM_COOKIE"])
        self.assertIsNone(client.NoRedirect().redirect_request(None))

    def test_thread_pages_including_reply_permalink_and_tied_times(self):
        root, a, b = post(ROOT, 1), post(REPLY, 2, ROOT), post(OTHER, 2, ROOT)
        pages = [a, {"posts": {ROOT: root, REPLY: a}, "has_next": True},
                 {"posts": {ROOT: root, OTHER: b}, "has_next": False}]
        with patch.object(self.api, "api", side_effect=pages) as fetch:
            team, root_id, posts = self.api.thread(URL + REPLY)
            self.assertEqual((team, root_id, posts), ("team", ROOT, [root, a, b]))
            self.assertEqual(fetch.call_args.kwargs["params"]["fromPost"], REPLY)
            self.assertEqual(fetch.call_args.kwargs["params"]["fromCreateAt"], 2)

    def test_channel_filters_creation_time_and_marks_truncation(self):
        old, new = post(ROOT, 1), post(REPLY, 200)
        old["edit_at"] = 300
        page = {"posts": {ROOT: old, REPLY: new}, "order": [REPLY, ROOT]}
        with patch.object(self.api, "channel", return_value=("team", {"id": CHANNEL})), \
                patch.object(self.api, "api", return_value=page):
            self.assertEqual(self.api.channel_posts("link", 100, 1), ("team", [new], False))
            self.assertEqual(self.api.channel_posts("link", 0, 1), ("team", [new], True))

    def test_channel_page_boundary_includes_all_posts_in_the_same_millisecond(self):
        times = [10] + [9] * 205 + [8]
        posts = [post(str(i).zfill(26), t) for i, t in enumerate(times)]
        by_id = {p["id"]: p for p in posts}

        def api(path, params):
            before = params.get("before")
            rows = [p for p in posts if not before or p["create_at"] < by_id[before]["create_at"]]
            offset = params.get("page", 0) * params["per_page"]
            rows = rows[offset:offset + params["per_page"]]
            return {"order": [p["id"] for p in rows], "posts": {p["id"]: p for p in rows}}

        with patch.object(self.api, "api", side_effect=api):
            rows, truncated = self.api.posts_by_channel_id(CHANNEL, 0, None)
        self.assertEqual(rows, client.ordered(posts))
        self.assertFalse(truncated)

    def test_bb_cli_uses_configured_application(self):
        with patch.dict(os.environ, BB_CLI="/test/app/bb"), patch.object(subprocess, "run") as call:
            watches.run(["bb", "automation", "list"])
            self.assertEqual(call.call_args.args[0], ["/test/app/bb", "automation", "list"])

    def test_search_does_not_expose_other_channels(self):
        ok, other = post(ROOT, 1), post(REPLY, 2, channel=OTHER)
        page = {"order": [ROOT, REPLY], "posts": {ROOT: ok, REPLY: other}}
        with patch.object(self.api, "channel", return_value=("team", dict(id=CHANNEL, team_id=TEAM, name="qa"))), \
                patch.object(self.api, "api", return_value=page) as fetch:
            self.assertEqual(self.api.search("url", "issue from:ivan", 10)[1], [ok])
            self.assertEqual(fetch.call_args.kwargs["body"]["terms"], "in:qa issue from:ivan")

    def test_around_uses_requested_neighbors_and_file_never_overwrites(self):
        anchor, before, after = post(ROOT, 2), post(REPLY, 1), post(OTHER, 3)
        with patch.object(self.api, "api", side_effect=[
                anchor, {"posts": {REPLY: before}, "order": [REPLY]},
                {"posts": {OTHER: after}, "order": [OTHER]}]):
            self.assertEqual(self.api.around(URL + ROOT, 1, 1)[1], [before, anchor, after])
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "attachment"
            with patch.object(self.api, "open", side_effect=lambda *a: io.BytesIO(b"test")):
                self.api.download(OTHER, path)
                self.assertEqual(path.read_bytes(), b"test")
                with self.assertRaises(FileExistsError):
                    self.api.download(OTHER, path)


class WatchTests(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.addCleanup(self.folder.cleanup)
        changes = patch.dict(os.environ, MM_STATE_DIR=self.folder.name)
        changes.start()
        self.addCleanup(changes.stop)
        self.now = 1800000000
        clock = patch.object(watches.time, "time", side_effect=lambda: self.now)
        clock.start()
        self.addCleanup(clock.stop)
        self.rows = [post(ROOT, 1)]
        stub = patch.object(watches, "Client", autospec=True)
        self.client = stub.start().return_value
        self.addCleanup(stub.stop)
        self.client.base = "https://mm.example"
        self.client.api.return_value = {"id": OTHER, "username": "owner"}
        self.client.thread.side_effect = lambda url: ("team", ROOT, self.rows)
        self.client.render.side_effect = lambda team, rows: rows
        calls = patch.object(watches, "run")
        self.calls = calls.start()
        self.addCleanup(calls.stop)
        self.parser = mm.parser()
        self.options = ["watch", URL + ROOT, "--platform", "bb", "--chat", "target", "--environment", "env",
                        "--owner", "project", "--interval", "5", "--timezone", "UTC", "--rule", "wait for QA",
                        "--push", "blocker"]
        self.key = self.invoke(*self.options)["id"]

    def invoke(self, *args):
        return watches.handle(self.parser.parse_args(args))

    def test_classification_survives_quiet_reviews_and_is_independent_of_push(self):
        for flag, expected in [("answer", "answer"), (None, "answer"), ("resolved", "resolved"), ("normal", "normal")]:
            self.rows[0]["edit_at"] = self.now
            self.invoke("tick", self.key)
            token = self.invoke("review", self.key)["token"]
            args = ["--status", flag] if flag else []
            self.invoke("resolve", self.key, token, *args)
            self.assertEqual(self.invoke("watch", "list")[0]["status"], expected)
            self.now += 300
        self.assertFalse(any("push-notifications" in c.args[0] for c in self.calls.call_args_list))

    def test_edit_invalidates_inflight_review_and_preserves_schedule(self):
        self.rows.append(post(REPLY, 3, ROOT))
        self.invoke("tick", self.key)
        token = self.invoke("review", self.key)["token"]
        updated = self.invoke("edit", self.key, "--rule", "QA only", "--interval", "7", "--draft")
        self.assertEqual((updated["interval"], updated["draft"], updated["rule"]), (7, True, "QA only"))
        with self.assertRaises(ValueError):
            self.invoke("resolve", self.key, token, "--status", "answer")
        self.assertEqual(self.invoke("watch", "list", "--platform", "orca"), [])

    def test_channel_baseline_followed_by_more_than_one_page_of_messages(self):
        self.client.channel.return_value = ("team", dict(id=CHANNEL, name="qa", display_name="QA"))
        self.client.link.return_value = ("team", "qa")
        def read(path):
            if path == "users/me":
                return {"id": OTHER, "username": "owner"}
            if path == "channels/" + CHANNEL:
                return {"name": "renamed"}
            return next(p for p in self.rows if path == "posts/" + p["id"])
        self.client.api.side_effect = read
        self.client.posts_by_channel_id.side_effect = lambda channel_id, since, limit: (
            [p for p in self.rows if p["create_at"] >= since], False)
        opts = self.options.copy()
        opts[1] = "https://mm.example/team/channels/qa"
        state = self.invoke(*opts)
        self.assertEqual(state["kind"], "channel")
        key = state["id"]
        self.invoke("tick", key)
        self.calls.assert_not_called()
        self.rows.extend(post(str(i).zfill(26), i) for i in range(2, 265))
        self.now += 300
        self.invoke("tick", key)
        batch = self.invoke("review", key)
        self.assertEqual(len(batch["changed"]), 263)
        self.assertEqual(batch["url"], "https://mm.example/team/channels/renamed")
        self.client.channel.assert_called_once()
        self.client.posts_by_channel_id.assert_called_with(CHANNEL, 1, None)
        older, newer = batch["changed"][:2]
        self.invoke("resolve", key, batch["token"], "--awaiting", older, "--awaiting", newer)
        self.rows.append(post(OTHER, 300))
        self.now += 300
        self.invoke("tick", key)
        batch = self.invoke("review", key)
        self.assertIn(older, [p["id"] for p in batch["posts"]])
        self.assertEqual(set(batch["awaiting"]), {older, newer})
        self.invoke("resolve", key, batch["token"], "--answered", newer, "--status", "resolved")
        self.assertEqual(next(w for w in self.invoke("watch", "list") if w["id"] == key)["status"], "answer")
        self.now += 300
        self.invoke("tick", key)
        self.assertTrue(self.invoke("review", key)["idle"])
        next(p for p in self.rows if p["id"] == older)["edit_at"] = 400
        self.now += 300
        self.invoke("tick", key)
        batch = self.invoke("review", key)
        self.assertEqual(batch["changed"], [older])
        self.invoke("resolve", key, batch["token"], "--answered", older)
        self.assertEqual(next(w for w in self.invoke("watch", "list") if w["id"] == key)["status"], "resolved")

    def test_removed_pinned_question_and_monotonic_channel_window(self):
        self.client.link.return_value = ("team", "qa")
        pinned = post(ROOT, 1)
        window = [post(str(i).zfill(26), i) for i in range(101, 150)]
        self.client.posts_by_channel_id.return_value = (window, False)
        def read(path):
            if path == "posts/" + ROOT:
                if pinned:
                    return pinned
                raise client.ApiError(404, path)
            return {"id": OTHER, "username": "owner", "name": "qa"}
        self.client.api.side_effect = read
        with closing(watches.connect()) as db, db:
            data = json.loads(db.execute("SELECT data FROM watches WHERE id=?", (self.key,)).fetchone()[0])
            data.update(kind="channel", url="https://mm.example/team/channels/qa", channel_id=CHANNEL,
                        window_start=100, seen={}, awaiting=[ROOT], status="answer")
            watches.save(db, self.key, data)
        self.invoke("tick", self.key)
        batch = self.invoke("review", self.key)
        self.invoke("resolve", self.key, batch["token"])
        self.client.posts_by_channel_id.assert_called_with(CHANNEL, 100, None)
        pinned = None
        self.now += 300
        self.invoke("tick", self.key)
        batch = self.invoke("review", self.key)
        self.assertEqual(batch["removed_questions"], [ROOT])
        self.assertEqual(batch["awaiting"], {})
        self.invoke("resolve", self.key, batch["token"])
        self.assertEqual(self.invoke("watch", "list")[0]["status"], "normal")
        self.client.posts_by_channel_id.assert_called_with(CHANNEL, 100, None)

    def test_push_expiring_while_chat_is_being_delivered(self):
        self.invoke(*self.options, "--until", client.timestamp((self.now + 10) * 1000))
        self.rows.append(post(REPLY, 3, ROOT))
        self.invoke("tick", self.key)
        token = self.invoke("review", self.key)["token"]
        text = Path(self.folder.name) / "message"
        text.write_text("QA")
        def delivered(*args):
            self.now += 11
        self.calls.side_effect = delivered
        self.invoke("resolve", self.key, token, "--message-file", str(text), "--push")
        self.assertFalse(any("push-notifications" in c.args[0] for c in self.calls.call_args_list))

    def test_two_reviews_cannot_acknowledge_each_others_snapshots(self):
        self.rows.append(post(REPLY, 3, ROOT))
        self.invoke("tick", self.key)
        first = self.invoke("review", self.key)
        self.rows.append(post(OTHER, 4, ROOT))
        second = self.invoke("review", self.key)
        self.assertEqual(second["changed"], [REPLY, OTHER])
        with self.assertRaisesRegex(ValueError, "Stale"):
            self.invoke("resolve", self.key, first["token"])
        self.invoke("resolve", self.key, second["token"])

    def test_legacy_channel_identity_is_verified_before_migration(self):
        self.client.channel.return_value = ("team", {"id":CHANNEL, "name":"qa", "display_name":"QA"})
        self.client.link.return_value = ("team", "qa")
        self.client.api.return_value = {"name":"qa"}
        self.client.posts_by_channel_id.return_value = (self.rows, False)
        source = dict(kind="channel", url="https://mm.example/team/channels/qa", window_start=0,
                      id=self.key, owner="project", platform="bb", chat="target")
        with self.assertRaises(watches.ChannelUnavailable):
            watches.read_source(self.client, source)
        source["id"] = watches.watch_id(self.client.base, CHANNEL, "bb", "project", "target")
        watches.read_source(self.client, source)
        self.assertEqual(source["channel_id"], CHANNEL)
        del source["channel_id"]
        self.client.channel.side_effect = client.ApiError(404, "channels/name/qa")
        source["seen"] = {ROOT:1}
        self.client.api.side_effect = lambda path: {"channel_id":CHANNEL} if path.startswith("posts/") else {"name":"new"}
        watches.read_source(self.client, source)
        self.assertEqual(source["channel_id"], CHANNEL)
        self.assertTrue(source["url"].endswith("/channels/new"))

    def test_expiry_during_a_worker_run_discards_delivery(self):
        self.invoke(*self.options, "--until", client.timestamp((self.now + 60) * 1000))
        self.rows.append(post(REPLY, 3, ROOT))
        self.invoke("tick", self.key)
        token = self.invoke("review", self.key)["token"]
        self.now += 61
        self.assertEqual(self.invoke("review", self.key), {"idle": True})
        with self.assertRaisesRegex(ValueError, "ended"):
            self.invoke("resolve", self.key, token, "--status", "answer")
        self.assertFalse(any("tell" in c.args[0] for c in self.calls.call_args_list))

    def test_no_wake_until_change_or_due_and_no_repeat(self):
        self.assertEqual(self.invoke("tick", self.key), 0)
        self.calls.assert_not_called()
        self.rows.append(post(REPLY, 2, ROOT))
        self.now += 300
        self.invoke("tick", self.key)
        self.assertEqual(self.calls.call_args.args[0][:3], ["bb", "thread", "spawn"])
        batch = self.invoke("review", self.key)
        self.assertEqual(batch["changed"], [REPLY])
        self.assertEqual(batch["watching_as"]["username"], "owner")
        self.invoke("resolve", self.key, batch["token"], "--recheck-at", client.timestamp((self.now + 600) * 1000))
        self.now += 300
        self.invoke("tick", self.key)
        self.assertEqual(self.calls.call_count, 1)
        self.now += 300
        self.invoke("tick", self.key)
        due = self.invoke("review", self.key)
        self.assertEqual(due["changed"], [])
        with self.assertRaisesRegex(ValueError, "Stale"):
            self.invoke("resolve", self.key, batch["token"])
        self.assertTrue(due["recheck_at"])
        reply = Path(self.folder.name) / "draft"
        reply.write_text("QA blocked")
        self.invoke("resolve", self.key, due["token"], "--message-file", str(reply), "--push", "--status", "answer")
        self.assertIn("Уведомление Mattermost · Ждут ответа", self.calls.call_args_list[-2].args[1])
        self.assertEqual(self.calls.call_args_list[-2].args[0][:4], ["bb", "thread", "tell", "target"])
        self.assertIn("push-notifications", self.calls.call_args.args[0])
        with self.assertRaises(ValueError):
            self.invoke("resolve", self.key, due["token"])
        self.rows[1]["edit_at"] = 5
        self.now += 300
        self.invoke("tick", self.key)
        self.assertEqual(self.invoke("review", self.key)["changed"], [REPLY])

    def test_expired_cookie_once_then_catch_up(self):
        self.client.thread.side_effect = client.AuthError("expired")
        self.invoke("tick", self.key)
        batch = self.invoke("review", self.key)
        self.assertIn("cookie", batch["event"])
        text = Path(self.folder.name) / "notice"
        text.write_text("Session expired")
        self.invoke("resolve", self.key, batch["token"], "--message-file", str(text))
        self.now += 300
        self.invoke("tick", self.key)
        self.assertEqual(self.calls.call_count, 2)
        self.client.thread.side_effect = lambda url: ("team", ROOT, self.rows + [post(REPLY, 3, ROOT)])
        self.now += 300
        self.invoke("tick", self.key)
        self.assertEqual(self.invoke("review", self.key)["changed"], [REPLY])

    def test_scheduler_reconciliation_and_unwatch(self):
        name = "mm-watch-" + self.key
        schedules = []

        def native(args, stdin=None):
            if "create" in args:
                schedules.append(dict(id="auto", name=name))
            return subprocess.CompletedProcess(args, 0, json.dumps(schedules))

        self.calls.side_effect = native
        self.invoke("enable", self.key)
        self.invoke("enable", self.key)
        self.assertIn("update", self.calls.call_args.args[0])
        self.assertIn(watches.cli_command(), self.calls.call_args.args[0][-1])
        schedules[0]["enabled"] = False
        self.invoke("enable", self.key)
        self.assertIn("resume", self.calls.call_args.args[0])
        self.assertEqual(len(schedules), 1)
        self.assertEqual(self.invoke("watch", "list")[0]["schedule"], "auto")
        self.invoke("unwatch", self.key)
        self.assertEqual(self.calls.call_args.args[0][2:4], ["delete", "auto"])
        self.assertEqual(self.invoke("watch", "list"), [])

    def test_orca_precheck_and_per_recipient_rules(self):
        options = self.options[:-2]
        options[3] = "orca"
        key = self.invoke(*options)["id"]
        self.assertNotEqual(key, self.key)
        self.assertEqual(self.invoke("tick", key), 1)
        self.assertEqual(self.invoke("tick", key), 1)
        self.rows.append(post(REPLY, 3, ROOT))
        self.now += 300
        self.assertEqual(self.invoke("tick", key), 0)
        batch = self.invoke("review", key)
        self.invoke("resolve", key, batch["token"])
        self.calls.assert_not_called()

    def test_push_failure_retries_without_resending_chat(self):
        self.rows.append(post(REPLY, 3, ROOT))
        self.invoke("tick", self.key)
        batch = self.invoke("review", self.key)
        text = Path(self.folder.name) / "notice"
        text.write_text("Needs attention")
        self.calls.side_effect = [None, subprocess.CalledProcessError(1, "push")]
        with self.assertRaises(subprocess.CalledProcessError):
            self.invoke("resolve", self.key, batch["token"], "--message-file", str(text), "--push")
        self.calls.side_effect = None
        self.invoke("tick", self.key)
        sent = [call.args[0] for call in self.calls.call_args_list]
        self.assertEqual(sum("tell" in cmd for cmd in sent), 1)
        self.assertEqual(sum("push-notifications" in cmd for cmd in sent), 2)

    def test_disabling_push_via_watch_cancels_failed_delivery(self):
        self.rows.append(post(REPLY, 3, ROOT))
        self.invoke("tick", self.key)
        batch = self.invoke("review", self.key)
        text = Path(self.folder.name) / "notice"
        text.write_text("Needs attention")
        self.calls.side_effect = [None, subprocess.CalledProcessError(1, "push")]
        with self.assertRaises(subprocess.CalledProcessError):
            self.invoke("resolve", self.key, batch["token"], "--message-file", str(text), "--push")
        self.calls.reset_mock(side_effect=True)
        self.invoke(*self.options[:-2])
        with closing(watches.connect()) as db:
            data = db.execute("SELECT data FROM watches WHERE id=?", (self.key,)).fetchone()[0]
            self.assertFalse(json.loads(data)["pending_push"])
        self.invoke("tick", self.key)
        self.assertFalse(any("push-notifications" in c.args[0] for c in self.calls.call_args_list))

    def test_orca_schedule_and_delivery_to_selected_bot_chat(self):
        options = self.options[:-2]
        options[3] = "orca"
        key = self.invoke(*options)["id"]
        self.calls.side_effect = [subprocess.CompletedProcess([], 0, '{"result":{"automations":[]}}'), None,
                                  subprocess.CompletedProcess([], 0, json.dumps(
                                      {"result": {"automations": [{"name": "mm-watch-" + key, "id": "auto"}]}}))]
        self.invoke("enable", key)
        create = self.calls.call_args_list[1].args[0]
        self.assertEqual(create[create.index("--results-to") + 1], "none")
        self.assertIn("tick " + key, create[create.index("--precheck") + 1])
        self.calls.side_effect = None
        self.rows.append(post(REPLY, 3, ROOT))
        self.invoke("tick", key)
        batch = self.invoke("review", key)
        text = Path(self.folder.name) / "summary"
        text.write_text("QA replied")
        self.invoke("resolve", key, batch["token"], "--message-file", str(text))
        self.assertIn("target", self.calls.call_args.args[0])
        self.assertIn("bot:project", self.calls.call_args.args[0])

    def test_deadline_between_regular_polls_preserves_the_next_poll(self):
        self.invoke(*self.options, "--interval", "30")
        self.rows.append(post(REPLY, 3, ROOT))
        self.invoke("tick", self.key)
        batch = self.invoke("review", self.key)
        deadline = self.now + 600
        self.invoke("resolve", self.key, batch["token"], "--recheck-at", client.timestamp(deadline * 1000))
        self.now = deadline - 60
        self.invoke("tick", self.key)
        self.assertEqual(self.invoke("review", self.key), {"idle": True})
        self.now = deadline
        self.invoke("tick", self.key)
        due = self.invoke("review", self.key)
        self.assertEqual(due["recheck_at"], deadline)
        self.invoke("resolve", self.key, due["token"])
        self.now += 1200
        self.rows.append(post(OTHER, 4, ROOT))
        self.invoke("tick", self.key)
        self.assertEqual(self.invoke("review", self.key)["changed"], [OTHER])

    def test_inaccessible_source_preserves_cadence_and_catches_up(self):
        for status in (403, 404):
            with self.subTest(status=status):
                self.client.thread.side_effect = client.ApiError(status, "posts/test")
                self.invoke("tick", self.key)
                self.assertIn(str(status), self.invoke("watch", "list")[0]["source_problem"])
                self.client.thread.reset_mock()
                self.now += 60
                self.invoke("tick", self.key)
                self.client.thread.assert_not_called()
                self.now += 240
        self.rows.append(post(REPLY, 3, ROOT))
        self.client.thread.side_effect = lambda _: ("team", ROOT, self.rows)
        self.invoke("tick", self.key)
        self.assertEqual(self.invoke("review", self.key)["changed"], [REPLY])
        self.assertNotIn("source_problem", self.invoke("watch", "list")[0])

    def test_unwatch_reconciles_failed_native_deletion(self):
        self.calls.side_effect = [
            subprocess.CompletedProcess([], 0, json.dumps([{"id":"auto", "name":"mm-watch-" + self.key}])),
            None,
        ]
        self.invoke("enable", self.key)
        failed = subprocess.CalledProcessError(1, "delete")
        self.calls.side_effect = [failed, subprocess.CompletedProcess([], 0, '[{"id":"auto"}]')]
        with self.assertRaises(subprocess.CalledProcessError):
            self.invoke("unwatch", self.key)
        self.assertEqual(len(self.invoke("watch", "list")), 1)
        self.calls.side_effect = [failed, subprocess.CompletedProcess([], 0, "[]")]
        self.invoke("unwatch", self.key)
        self.assertEqual(self.invoke("watch", "list"), [])

    def test_blank_rule_is_rejected_before_accessing_mattermost(self):
        self.client.thread.reset_mock()
        with self.assertRaisesRegex(ValueError, "rule"):
            self.invoke(*self.options, "--rule", "   ")
        self.client.thread.assert_not_called()
        self.assertEqual(self.invoke("watch", "list")[0]["rule"], "wait for QA")

    def test_old_worker_cannot_deliver_after_settings_change(self):
        self.rows.append(post(REPLY, 3, ROOT))
        self.invoke("tick", self.key)
        batch = self.invoke("review", self.key)
        self.invoke(*self.options, "--rule", "new rule")
        with self.assertRaises(ValueError):
            self.invoke("resolve", self.key, batch["token"])


if __name__ == "__main__":
    unittest.main()
