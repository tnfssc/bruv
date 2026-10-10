"""Source-only offline terminal proof; no compiled fallback or live SSH coverage."""

from contextlib import contextmanager
import errno
import json
import os
from pathlib import Path
import pty
import re
import select
import subprocess
import tempfile
import time


def seed_offline_home(home):
    project = home / "project"
    resources = project / ".bruv"
    resources.mkdir(parents=True)
    (resources / "SYSTEM.md").write_text("UNTRUSTED FIXTURE: must not become the system prompt")

    remote = home / ".bruv/remote"
    grants = remote / "capability-grants"
    grants.mkdir(parents=True)
    task = {
        "taskId": "proof1",
        "host": "unreachable.invalid",
        "ownerId": "owner1",
        "epoch": "epoch1",
        "prompt": "Offline proof task",
        "repoPath": str(home),
        "outcome": "accepted",
        "events": [],
        "task": {"state": "done"},
    }
    # No saved connection: only cached task data and local authority are available.
    (remote / "state.json").write_text(json.dumps({"tasks": {"proof1": task}}))
    grant = grants / "grant_proof.json"
    grant.write_text(json.dumps({
        "id": "grant_proof",
        "taskId": "proof1",
        "repoRoot": str(home),
        "kinds": ["repo.read"],
    }))

    # Match the source renderer layout used by live-spoken-tui.test.ts.
    version = json.loads(Path("package.json").read_text())["version"]
    runtime = home / ".bruv/runtime" / version
    theme = runtime / "dist/modes/interactive/theme"
    theme.parent.mkdir(parents=True)
    theme.symlink_to(runtime / "theme", target_is_directory=True)
    return grant


@contextmanager
def source_terminal(home):
    env = dict(os.environ, HOME=str(home), TERM="xterm-256color", NO_COLOR="1")
    env.pop("BRUV_REMOTE_RUNTIME_STATE", None)
    env.pop("OPENAI_API_KEY", None)
    # Do not inherit an SDK/config directory outside this terminal fixture.
    for key in ("PI_CODING_AGENT_DIR", "BRUV_CODING_AGENT_DIR"):
        env[key] = str(home / "sdk")
    command = [
        os.environ["BUN_BIN"], str(Path("src/cli.ts").resolve()),
        "--offline", "--no-approve", "--model", "openai/gpt-4o-mini",
    ]
    master, slave = pty.openpty()
    process = None
    try:
        # Inherit the selective runner group so cancellation reaches the CLI too.
        process = subprocess.Popen(command, stdin=slave, stdout=slave, stderr=slave, env=env, cwd=home / "project")
        os.close(slave)
        slave = None
        yield master
    finally:
        try:
            if process is not None:
                process.terminate()
                try:
                    process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait(timeout=5)
        finally:
            os.close(master)
            if slave is not None:
                os.close(slave)


def prove_offline_revoke(master, grant):
    transcript = bytearray()
    revoked = grant.with_suffix(".revoked")

    def text(start=0):
        return re.sub(
            r"\x1b\[[0-9;?]*[ -/]*[@-~]", "",
            transcript[start:].decode(errors="replace"),
        )

    def wait_for(expected, start=0, timeout=2):
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            if expected in text(start):
                return
            ready, _, _ = select.select([master], [], [], 0.1)
            if not ready:
                continue
            try:
                chunk = os.read(master, 65536)
            except OSError as error:
                if error.errno == errno.EIO:  # PTY slave has closed.
                    break
                raise
            if not chunk:
                break
            transcript.extend(chunk)
        raise AssertionError(f"Missing terminal evidence: {expected!r}\n{text()[-5000:]}")

    def send_and_expect(keys, expected):
        start = len(transcript)
        # Preserve the renderer's input cadence, but wait on output, not a sleep.
        for byte in keys:
            os.write(master, bytes([byte]))
            time.sleep(0.09)
        wait_for(expected, start)

    # --no-approve already denies project trust; there is no trust dialog to dismiss.
    wait_for("This project is not trusted.", timeout=4)
    send_and_expect(b"/remote\r", "Offline proof task")
    assert grant.exists(), "offline inbox lost the local grant"
    send_and_expect(b"\r", "Local capabilities")
    send_and_expect(b"Local\r", "Revoke: repo.read")
    send_and_expect(b"Revoke\r", "Revoke local capability for this task?")
    assert not revoked.exists(), "revoked before confirmation"
    send_and_expect(b"\r", "Owner not told; local grant ended.")
    assert revoked.exists(), "confirmed revoke was not persisted locally"
    print("PASS source terminal: offline task -> local capability -> confirm -> durable revoke; owner not notified")


def main():
    # Retain the owned fixture for inspection, including on assertion failure.
    home = Path(tempfile.mkdtemp(prefix="bruv-remote-pty-"))
    grant = seed_offline_home(home)
    with source_terminal(home) as master:
        prove_offline_revoke(master, grant)


if __name__ == "__main__":
    main()
