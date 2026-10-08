# Compiled terminal proof: build dist/bruv first; retained fixture HOME, no network configuration.
import json
import os
import pathlib
import pty
import re
import select
import subprocess
import tempfile
import time


def seed_offline_task(home):
    repo = home / "repo"
    repo.mkdir()
    root = home / ".bruv" / "remote"
    grants = root / "capability-grants"
    grants.mkdir(parents=True)
    task = {
        "taskId": "proof1",
        "host": "unreachable.invalid",
        "ownerId": "owner1",
        "epoch": "epoch1",
        "prompt": "Offline proof task",
        "repoPath": str(repo),
        "outcome": "accepted",
        "events": [],
        "task": {"state": "done"},
    }
    (root / "state.json").write_text(json.dumps({"tasks": {"proof1": task}}))
    (grants / "grant_proof.json").write_text(json.dumps({
        "id": "grant_proof",
        "taskId": "proof1",
        "repoRoot": str(repo),
        "kinds": ["repo.read"],
    }))
    return grants


def fixture_environment(home):
    # Allowlist process inputs: no inherited credentials, config or SDK state.
    env = {
        "PATH": os.environ.get("PATH", os.defpath),
        "HOME": str(home),
        "TERM": "xterm-256color",
        "NO_COLOR": "1",
    }
    for key, path in {
        "XDG_CONFIG_HOME": home / "config",
        "XDG_CACHE_HOME": home / "cache",
        "XDG_DATA_HOME": home / "data",
        "BRUV_CODING_AGENT_DIR": home / ".bruv" / "agent",
        "PI_CODING_AGENT_DIR": home / ".pi" / "agent",
        "TMPDIR": home / "tmp",
    }.items():
        path.mkdir(parents=True)
        env[key] = str(path)
    return env


def prove_offline_revocation(master, grants):
    # Transcript and paced input belong to this one terminal journey.
    transcript = bytearray()

    def read(seconds=1):
        end = time.monotonic() + seconds
        while time.monotonic() < end:
            ready, _, _ = select.select([master], [], [], 0.1)
            if ready:
                try:
                    transcript.extend(os.read(master, 65536))
                except OSError:
                    break

    def text():
        return re.sub(r"\x1b\[[0-9;?]*[ -/]*[@-~]", "", transcript.decode(errors="replace"))

    def send(key, seconds=0.6):
        for byte in key:
            os.write(master, bytes([byte]))
            time.sleep(0.09)
        read(seconds)

    grant = grants / "grant_proof.json"
    revoked = grants / "grant_proof.revoked"
    read(3)
    send(b"\x1b[B" * 4 + b"\r", 1.2)  # do not trust this session
    send(b"/remote\r", 1.5)
    assert "Offline proof task" in text() and grant.exists(), "offline inbox missing"
    send(b"\r")  # task
    assert "Local capabilities" in text(), "offline action missing"
    send(b"Local\r")  # filter capability action
    assert "Revoke: repo.read" in text(), "grant not visible"
    send(b"Revoke\r")  # filter revoke
    assert "Revoke local capability for this task?" in text(), "confirmation missing"
    assert not revoked.exists(), "revoked before confirmation"
    send(b"\r", 1.2)  # confirm
    assert revoked.exists() and "Owner not notified" in text(), "durable local revoke / honest status missing"
    print("PASS compiled terminal: offline task -> local capability -> confirm -> durable revoke; owner not notified")


def main():
    binary = os.path.abspath("dist/bruv")
    home = pathlib.Path(tempfile.mkdtemp(prefix="bruv-remote-pty-"))
    print(f"Retained PTY fixture: {home}", flush=True)
    grants = seed_offline_task(home)
    env = fixture_environment(home)
    master, slave = pty.openpty()
    process = None
    try:
        try:
            process = subprocess.Popen(
                [binary, "--offline", "--no-approve", "--model", "openai/gpt-4o-mini"],
                stdin=slave,
                stdout=slave,
                stderr=slave,
                env=env,
                start_new_session=True,
            )
        finally:
            os.close(slave)
        prove_offline_revocation(master, grants)
    finally:
        try:
            if process is not None:
                process.terminate()
                process.wait(timeout=5)
        finally:
            os.close(master)
        # Keep fixture files for inspection; never remove HOME/config/SDK state.


if __name__ == "__main__":
    main()
