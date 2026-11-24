import os
import stat
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from client import AuthError, Client
from connection import connection


class ConnectionTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.file = Path(temp.name) / "private/mm.env"
        env = patch.dict(os.environ, MM_CONFIG=str(self.file), MM_URL="", MM_COOKIE="")
        env.start()
        self.addCleanup(env.stop)
        self.data = {"url": "https://mm.example/company/", "cookie": "Cookie: MMAUTHTOKEN=fixture"}
        self.saved = {"url": "https://mm.example/company", "hasCookie": True}

    def test_save_is_shared_with_cli_and_only_public_fields_are_returned(self):
        self.assertEqual(connection("status"), {"url": "", "hasCookie": False})
        self.assertEqual(connection("save", self.data), self.saved)
        self.assertEqual(connection("status"), self.saved)
        self.assertEqual(stat.S_IMODE(self.file.stat().st_mode), 0o600)
        self.assertEqual(Client().base, self.saved["url"])
        self.assertEqual(Client().headers["Cookie"], "MMAUTHTOKEN=fixture")
        self.file.write_text("# retained\nOTHER=1\n" + self.file.read_text())
        connection("save", dict(self.data, cookie="MMCSRF=test; MMAUTHTOKEN=changed"))
        self.assertTrue(self.file.read_text().startswith("# retained\nOTHER=1\n"))
        self.assertEqual(Client().headers["X-CSRF-Token"], "test")

    def test_check_uses_form_values_without_saving_and_keeps_saved_cookie_on_its_site(self):
        connection("save", self.data)
        def me(client, path):
            self.assertEqual(path, "users/me")
            return {"id": "1", "username": "test-user"}
        with patch.object(Client, "api", autospec=True, side_effect=me) as api:
            self.assertEqual(connection("test", dict(self.data, cookie="")), {"username": "test-user"})
            self.assertEqual(api.call_args.args[0].headers["Cookie"], "MMAUTHTOKEN=fixture")
            connection("test", {"url": "https://other.example", "cookie": "session=other"})
            self.assertEqual(api.call_args.args[0].headers["Cookie"], "session=other")
            for action in ("save", "test"):
                with self.assertRaisesRegex(ValueError, "Введите cookie"):
                    connection(action, {"url": "https://other.example", "cookie": ""})
            self.assertEqual(api.call_count, 2)
        self.assertEqual(connection("status"), self.saved)
        self.assertEqual(Client().headers["Cookie"], "MMAUTHTOKEN=fixture")

    def test_environment_cookie_is_bound_to_its_explicit_site(self):
        connection("save", self.data)
        with patch.dict(os.environ, MM_COOKIE="session=other"):
            self.assertEqual(Client().headers["Cookie"], "MMAUTHTOKEN=fixture")
            with patch.dict(os.environ, MM_URL="https://other.example"):
                self.assertEqual(Client().headers["Cookie"], "session=other")
        with patch.dict(os.environ, MM_URL="https://other.example"):
            with self.assertRaises(AuthError):
                Client()

    def test_invalid_legacy_settings_allow_explicit_replacement(self):
        self.file.parent.mkdir()
        for old in ('MM_URL="unfinished', 'MM_URL=http://old.example'):
            self.file.write_text(old + "\nMM_COOKIE=old=value\nOTHER=1\n")
            self.assertEqual(connection("status"), {"url": "", "hasCookie": False, "needsRepair": True})
            with self.assertRaisesRegex(ValueError, "Введите cookie"):
                connection("save", dict(self.data, cookie=""))
            self.assertEqual(connection("save", self.data), self.saved)
            self.assertIn("OTHER=1", self.file.read_text())
            self.assertEqual(Client().headers["Cookie"], "MMAUTHTOKEN=fixture")

    def test_auth_failure_is_safe_and_bad_origin_is_rejected(self):
        with patch.object(Client, "api", side_effect=AuthError("sensitive")):
            with self.assertRaisesRegex(ValueError, "Сессия недействительна") as err:
                connection("test", self.data)
            self.assertNotIn("sensitive", str(err.exception))
        for url in ("http://mm.example", "https://a:b@mm.example", "https://mm.example/?session=private"):
            with self.assertRaises(ValueError):
                connection("save", dict(self.data, url=url))
        self.assertFalse(self.file.exists())
