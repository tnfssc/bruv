#!/usr/bin/env python3
"""Protocol smoke; optional virtual sink/source args for device isolation."""
import base64
from contextlib import contextmanager
import ctypes
import json
import math
import os
import select
import subprocess
import sys
import threading
import time


class Protocol:
    """Own the helper process and its newline-delimited response stream."""

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
            self.process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            self.process.kill()
            self.process.wait()
        try:
            assert self.process.returncode == 0, self.process.stderr.read().decode()
        finally:
            self.process.stdout.close()
            self.process.stderr.close()

    def command(self, **value):
        self.process.stdin.write((json.dumps(value) + '\n').encode())
        self.process.stdin.flush()

    def _next_event(self, deadline, kind):
        # Read bytes ourselves: select cannot see lines prefetched by readline.
        while b'\n' not in self.pending:
            remaining = deadline - time.monotonic()
            if remaining <= 0 or not select.select(
                [self.process.stdout], [], [], remaining,
            )[0]:
                raise AssertionError('missing ' + kind)
            chunk = os.read(self.process.stdout.fileno(), 65536)
            if not chunk:
                raise AssertionError('missing ' + kind + ' (helper closed stdout)')
            self.pending += chunk
        line, self.pending = self.pending.split(b'\n', 1)
        return json.loads(line)

    def read(self, kind, timeout=4):
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            event = self._next_event(deadline, kind)
            if event['type'] == 'error' and kind != 'error':
                raise AssertionError(event)
            if event['type'] == kind:
                return event
            if event['type'] == 'capture':
                assert kind != 'ready', 'capture preceded ready'
                assert len(base64.b64decode(event['data'])) == 640
        raise AssertionError('missing ' + kind)

    def reject(self, code, message, **command):
        self.command(**command)
        assert self.read('error') == {
            'type': 'error', 'code': code, 'message': message,
        }


def check_initial_commands(protocol):
    assert protocol.read('hello')['protocol'] == 1
    # Rejections leave generation zero and continuous capture intact for start.
    protocol.reject('protocol', 'Missing type')
    protocol.reject('protocol', 'Unknown command', type='unknown')
    protocol.reject('generation', 'Invalid generation', type='flush', generation=True)
    protocol.reject('generation', 'Flush generation must increase', type='flush', generation=0)
    protocol.reject('capture_gate', 'Invalid hold epoch', type='capture_gate', epoch='0')
    protocol.reject('state', 'Start audio before play', type='play', generation=0, data='AAAA')
    protocol.command(type='stop')
    protocol.read('stopped')


class PulseSampleSpec(ctypes.Structure):
    _fields_ = [
        ('format', ctypes.c_int),
        ('rate', ctypes.c_uint32),
        ('channels', ctypes.c_uint8),
    ]


@contextmanager
def synthetic_microphone(sink):
    """Inject 300ms of near-end audio while the scenario exercises playback."""
    lib = ctypes.CDLL('libpulse-simple.so.0')
    lib.pa_simple_new.restype = ctypes.c_void_p
    lib.pa_simple_new.argtypes = [
        ctypes.c_char_p, ctypes.c_char_p, ctypes.c_int, ctypes.c_char_p,
        ctypes.c_char_p, ctypes.POINTER(PulseSampleSpec), ctypes.c_void_p,
        ctypes.c_void_p, ctypes.POINTER(ctypes.c_int),
    ]
    lib.pa_simple_write.argtypes = [
        ctypes.c_void_p, ctypes.c_void_p, ctypes.c_size_t, ctypes.POINTER(ctypes.c_int),
    ]
    lib.pa_simple_free.argtypes = [ctypes.c_void_p]
    error = ctypes.c_int()
    stream = lib.pa_simple_new(
        None, b'bruv-live-test', 1, sink.encode(), b'synthetic near end',
        ctypes.byref(PulseSampleSpec(3, 16000, 1)), None, None, ctypes.byref(error),
    )
    assert stream, error.value
    failures = []

    def inject():
        try:
            frame = b''.join(
                int(8000 * math.sin(2 * math.pi * 440 * i / 16000)).to_bytes(
                    2, 'little', signed=True,
                )
                for i in range(160)
            )
            for _ in range(30):
                assert lib.pa_simple_write(stream, frame, len(frame), ctypes.byref(error)) == 0, error.value
        except Exception as failure:
            failures.append(failure)
        finally:
            lib.pa_simple_free(stream)

    feeder = threading.Thread(target=inject)
    feeder.start()
    try:
        yield
    finally:
        feeder.join(timeout=4)
        assert not feeder.is_alive(), 'microphone feeder did not finish'
        if failures:
            raise failures[0]


def wait_for_queued_audio(protocol):
    """played reports queue changes, not command acknowledgements."""
    deadline = time.monotonic() + 3
    while time.monotonic() < deadline:
        if protocol.read('played', timeout=deadline - time.monotonic())['queuedMs'] > 0:
            return
    raise AssertionError('no nonempty playback queue report')


def check_virtual_audio(protocol, source):
    protocol.command(type='start')
    protocol.read('ready')
    with synthetic_microphone(source.removesuffix('.monitor')):
        # 500ms remains queued beyond the helper's 100ms report cadence.
        pcm = base64.b64encode(b'\x00\x20' * 12000).decode()
        protocol.reject('play', 'Invalid PCM16 data or generation', type='play', generation=1, data=pcm)
        protocol.reject('play', 'Invalid PCM16 data or generation', type='play', generation=0, data='!!!!')
        protocol.command(type='play', generation=0, data=pcm)
        wait_for_queued_audio(protocol)
        protocol.command(type='flush', generation=1)
        protocol.reject('generation', 'Flush generation must increase', type='flush', generation=1)
        protocol.reject('play', 'Invalid PCM16 data or generation', type='play', generation=0, data=pcm)
        protocol.command(type='play', generation=1, data=pcm)
        wait_for_queued_audio(protocol)
        # Observe near-end audio while the 300ms microphone injection is live,
        # before draining playback (which takes longer than the injection).
        assert any(any(base64.b64decode(protocol.read('capture')['data'])) for _ in range(100))
        # Drain reports must reach zero without a new play command.
        deadline = time.monotonic() + 3
        while True:
            assert time.monotonic() < deadline, 'no playback drain report'
            if protocol.read('played')['queuedMs'] == 0:
                break
    protocol.command(type='stop')
    protocol.read('stopped')
    protocol.command(type='start')
    protocol.read('ready')
    protocol.command(type='stop')
    protocol.read('stopped')


def main(arguments):
    with Protocol(arguments) as protocol:
        check_initial_commands(protocol)
        if len(arguments) > 1:
            check_virtual_audio(protocol, arguments[arguments.index('--source') + 1])
        print('protocol OK')


if __name__ == '__main__':
    main(sys.argv[1:])
