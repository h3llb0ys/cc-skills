"""Connection settings shared by the BB form, CLI and local scheduler."""

import json
import os
import tempfile
from http.cookies import CookieError
from urllib.error import URLError

from client import ApiError, AuthError, Client, config_path, read_config, site_url


def connection(action, data=None):
    path = config_path()
    lines = path.read_text().splitlines(keepends=True) if path.exists() else []
    try:
        config = read_config(lines)
        saved_url = site_url(config["MM_URL"]) if config.get("MM_URL") else ""
        saved_cookie = config.get("MM_COOKIE", "") if saved_url else ""
    except ValueError:
        # A hand-edited configuration can be replaced through the settings form.
        if action == "status":
            return {"url": "", "hasCookie": False, "needsRepair": True}
        saved_url, saved_cookie = "", ""
    if action == "status":
        return {"url": saved_url, "hasCookie": bool(saved_cookie)}

    url = site_url(data["url"])
    cookie = data["cookie"].strip()
    if cookie.lower().startswith("cookie:"):
        cookie = cookie[7:].strip()
    if not cookie:
        if url != saved_url or not saved_cookie:
            raise ValueError("Введите cookie для этого адреса")
        cookie = saved_cookie
    if "=" not in cookie or not cookie.isascii() or not cookie.isprintable():
        raise ValueError("Введите значение заголовка Cookie в одну строку")
    try:
        client = Client((url, cookie))
    except CookieError:
        raise ValueError("Некорректный формат cookie") from None
    if action == "test":
        try:
            user = client.api("users/me")
        except AuthError:
            raise ValueError("Сессия недействительна. Обновите cookie.") from None
        except ApiError as err:
            raise ValueError(f"Mattermost вернул HTTP {err.status}") from None
        except (OSError, URLError):
            raise ValueError("Не удалось подключиться. Проверьте адрес, сеть и сертификат.") from None
        except ValueError:
            raise ValueError("Сервер не вернул данные пользователя Mattermost") from None
        if not isinstance(user, dict) or not user.get("id") or not isinstance(user.get("username"), str) or not user["username"]:
            raise ValueError("Сервер не вернул данные пользователя Mattermost")
        return {"username": user["username"]}

    if action != "save":
        raise ValueError("Unknown connection operation")
    if (url, cookie) != (saved_url, saved_cookie):
        path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        other = "".join(line for line in lines if line.partition("=")[0].strip() not in ("MM_URL", "MM_COOKIE"))
        fd, tmp = tempfile.mkstemp(dir=path.parent)
        try:
            with os.fdopen(fd, "w") as out:
                out.write(other)
                if other and not other.endswith("\n"):
                    out.write("\n")
                out.write(f"MM_URL={json.dumps(url)}\nMM_COOKIE={json.dumps(cookie)}\n")
            os.replace(tmp, path)
        finally:
            if os.path.exists(tmp):
                os.unlink(tmp)
    return {"url": url, "hasCookie": True}
