#!/usr/bin/env python3
"""Unplug a test-only virtual source; stop must not wait on blocked Pulse I/O."""
import json
import os
import select
import subprocess
import sys
import time


class RemovalHelper:
    """Own the helper lifetime and buffered responses during an unplug test."""

    def __init__(self, command):
        self.process = subprocess.Popen(
            command, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
        self.pending = b''

    def __enter__(self):
        return self

    def __exit__(self, *exception):
        self.process.stdin.close()
        try:
            self.process.wait(timeout=3)
        except subprocess.TimeoutExpired:
            self.process.kill()
            self.process.wait()
        try:
            assert self.process.returncode == 0, self.process.stderr.read().decode()
        finally:
            self.process.stdout.close()
            self.process.stderr.close()

    def command(self, kind):
        self.process.stdin.write((json.dumps({'type': kind}) + '\n').encode())
        self.process.stdin.flush()

    def read(self, kind, timeout=4):
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            if b'\n' not in self.pending:
                remaining = max(0, deadline - time.monotonic())
                if not select.select([self.process.stdout], [], [], remaining)[0]:
                    break
                chunk = os.read(self.process.stdout.fileno(), 65536)
                if not chunk:
                    raise AssertionError('missing ' + kind + ' (helper closed stdout)')
                self.pending += chunk
                continue
            line, self.pending = self.pending.split(b'\n', 1)
            event = json.loads(line)
            # Device errors and capture can precede stopped after an unplug.
            # Neither substitutes for the requested acknowledgement.
            if event['type'] == kind:
                return event
        raise AssertionError('missing ' + kind)


def check_source_removal(helper, module):
    helper.read('hello')
    helper.command('start')
    helper.read('ready')
    subprocess.run(['pactl', 'unload-module', module], check=True)
    # Pulse/PipeWire may reroute instead of reporting device failure. Either
    # way, require a stopped response, not just silence or helper termination.
    start = time.monotonic()
    helper.command('stop')
    helper.read('stopped', timeout=2)
    assert time.monotonic() - start < 2
    print('source-removal stop OK (server may have rerouted source)')


def main(arguments):
    binary, mic, sink, module = arguments
    with RemovalHelper([binary, '--source', mic, '--sink', sink]) as helper:
        check_source_removal(helper, module)


if __name__ == '__main__':
    main(sys.argv[1:])
