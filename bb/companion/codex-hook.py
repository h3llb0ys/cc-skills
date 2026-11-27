#!/usr/bin/env python3
"""Delegate Companion memory checkpoints to a live local BB plugin lease."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time


def delegated(raw: bytes, directory: Path) -> bool:
    try:
        payload = json.loads(raw)
        session_id = payload["session_id"]
        name = hashlib.sha256(session_id.encode()).hexdigest()
        path = directory / (name + ".json")
        marker = json.loads(path.read_text())
        if int(marker["expiresAt"]) <= time.time() * 1000 or int(marker["pid"]) <= 1:
            return False
        os.kill(int(marker["pid"]), 0)
        turn_id = payload["turn_id"]
        if not isinstance(turn_id, str) or not turn_id or len(turn_id) > 200:
            return False
        fd, temporary = tempfile.mkstemp(prefix=path.name + ".", dir=directory)
        try:
            with os.fdopen(fd, "w") as stream:
                stream.write(turn_id)
            os.replace(temporary, str(path) + ".ack")
        finally:
            Path(temporary).unlink(missing_ok=True)
        return True
    except (OSError, ValueError, TypeError, KeyError, AttributeError):
        return False


def main() -> int:
    directory, *command = sys.argv[1:]
    raw = sys.stdin.buffer.read()
    if command[-2:] == ["--event", "stop"] and delegated(raw, Path(directory)):
        payload = json.loads(raw)
        payload["stop_hook_active"] = True
        subprocess.run(command, input=json.dumps(payload).encode(), stdout=subprocess.DEVNULL, check=False)
        print("{}")
        return 0
    return subprocess.run(command, input=raw, check=False).returncode


if __name__ == "__main__":
    raise SystemExit(main())
