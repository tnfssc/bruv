#!/usr/bin/env python3
"""Unread stdout must fail the helper, not block or silently drop events."""
import subprocess
import sys
import tempfile


def check_backpressure(helper_path):
    # Each missing-type command produces an error event. Preload the bounded
    # replay so feeding stdin cannot block the test's five-second exit check.
    with tempfile.TemporaryFile() as commands:
        commands.write(b'{}\n' * 20000)
        commands.seek(0)
        # Context exit reaps the child and closes both output pipes on failure too.
        with subprocess.Popen([helper_path], stdin=commands, stdout=subprocess.PIPE,
                              stderr=subprocess.PIPE) as helper:
            # Deliberately leave stdout unread until the child is reaped.
            try:
                assert helper.wait(timeout=5) == 74, 'stdout backpressure did not terminate the helper'
                assert b'backpressure' in helper.stderr.read()
            finally:
                if helper.poll() is None:
                    helper.kill()


if __name__ == '__main__':
    check_backpressure(sys.argv[1])
    print('backpressure OK')
