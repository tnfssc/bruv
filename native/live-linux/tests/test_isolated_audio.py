"""Exercise the wrapper's dispatch and ownership without a desktop audio server."""
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
import time
import unittest

WRAPPER = Path(__file__).resolve().parents[3] / 'scripts/live-isolated-audio.sh'

# Each fake executable records its own invocation; actual bash, timeout, Python,
# ps and kill perform the wrapper's process and exit-status work.
TOOL = r'''
import json, os, pathlib, signal, subprocess, sys, time
name = pathlib.Path(sys.argv[0]).name
args = sys.argv[1:]
events = pathlib.Path(os.environ['EVENTS'])
env = {key: value for key, value in os.environ.items() if key.startswith(('XDG_', 'PIPEWIRE_', 'PULSE_', 'DBUS_', 'BRUV_LIVE_'))}
(events / (name + '.' + str(os.getpid()) + '.json')).write_text(json.dumps({'name': name, 'pid': os.getpid(), 'args': args, 'env': env}))
if name in ('pipewire', 'pipewire-pulse', 'wireplumber', 'owned-child'):
    if os.environ.get('EARLY_EXIT') == name:
        sys.exit(17)
    if os.environ.get('STUBBORN') == '1':
        signal.signal(signal.SIGTERM, signal.SIG_IGN)
    print(name + ' started', flush=True)
    while True: time.sleep(.01)
elif name in ('fixture', 'bun'):
    if os.environ.get('WAIT_FOR_SIGNAL') == '1':
        signal.signal(signal.SIGTERM, signal.SIG_IGN)
        child = subprocess.Popen(['owned-child'])
        while not (events / ('owned-child.' + str(child.pid) + '.json')).exists(): time.sleep(.01)
        (events / 'fixture-ready').touch()
        while True: time.sleep(.01)
    sys.exit(int(os.environ.get('FIXTURE_STATUS', '0')))
elif name == 'pactl':
    if args == ['info']:
        if os.environ.get('EARLY_EXIT'): sys.exit(1)
    elif args == ['-f', 'json', 'list', 'sinks']:
        print(os.environ.get('SINKS', '[]'))
    elif args == ['-f', 'json', 'list', 'sources']:
        print(os.environ.get('SOURCES', '[]'))
    else: sys.exit(91)
elif name == 'pw-dump':
    print(os.environ.get('GRAPH', '[]'))
elif name == 'cp':
    assert args[0] in ('/usr/share/pipewire/client.conf', '/usr/share/pipewire/pipewire.conf', '/usr/share/pipewire/pipewire-pulse.conf')
    pathlib.Path(args[1]).write_text('# fixture config\n')
else: sys.exit(92)
'''


class IsolatedAudioWrapperTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.events = self.root / 'events'
        self.events.mkdir()
        tools = self.root / 'bin'
        tools.mkdir()
        for name in ('pipewire', 'pipewire-pulse', 'wireplumber', 'pw-dump',
                     'pactl', 'cp', 'bun', 'parec', 'pacat', 'fixture', 'owned-child'):
            tool = tools / name
            tool.write_text('#!' + sys.executable + '\n' + TOOL)
            tool.chmod(0o700)
        self.env = dict(os.environ, PATH=str(tools) + os.pathsep + os.environ['PATH'],
                        EVENTS=str(self.events))
        # Deliberately hostile inherited routes must be replaced for all tools.
        self.env.update(PULSE_SERVER='unix:/desktop', PIPEWIRE_REMOTE='desktop',
                        XDG_RUNTIME_DIR='/desktop', DBUS_SESSION_BUS_ADDRESS='unix:path=/desktop')
        self.process = None
        self.addCleanup(self.stop_test_processes)

    def calls(self, name):
        return [json.loads(path.read_text()) for path in self.events.glob(name + '.*.json')]

    def stop_test_processes(self):
        if self.process and self.process.poll() is None:
            self.process.kill()
            self.process.communicate()
        for name in ('fixture', 'bun', 'owned-child', 'pipewire', 'pipewire-pulse', 'wireplumber'):
            for call in self.calls(name):
                try: os.kill(call['pid'], signal.SIGKILL)
                except ProcessLookupError: pass

    def start(self, args, **env):
        self.process = subprocess.Popen(['/bin/bash', str(WRAPPER), *args],
                                        env=dict(self.env, **env), stdout=subprocess.PIPE,
                                        stderr=subprocess.PIPE, text=True)
        return self.process

    def run_wrapper(self, args=None, **env):
        process = self.start(['--', 'fixture', 'an argument with spaces'] if args is None else args, **env)
        stdout, stderr = process.communicate(timeout=8)
        return process.returncode, stdout, stderr

    def assert_released(self):
        for name in ('pipewire', 'pipewire-pulse', 'wireplumber'):
            calls = self.calls(name)
            self.assertEqual(len(calls), 1, name)
            call = calls[0]
            with self.assertRaises(ProcessLookupError): os.kill(call['pid'], 0)
            env = call['env']
            runtime = Path(env['XDG_RUNTIME_DIR'])
            self.assertFalse(runtime.parent.exists())
            self.assertEqual(env['PIPEWIRE_RUNTIME_DIR'], str(runtime))
            self.assertEqual(env['PIPEWIRE_REMOTE'], 'pipewire-0')
            self.assertEqual(env['PULSE_SERVER'], 'unix:' + str(runtime / 'pulse/native'))
            self.assertEqual(env['DBUS_SESSION_BUS_ADDRESS'], 'unix:path=' + str(runtime / 'nonexistent-dbus'))
            self.assertEqual(env['PIPEWIRE_NO_SYSTEM_CONFIG'], '1')
        manager = self.calls('wireplumber')[0]
        self.assertEqual(manager['args'], ['-c', '/usr/share/wireplumber/wireplumber.conf', '-p', 'policy'])

    def test_custom_command_uses_verified_private_environment(self):
        # Non-node objects are irrelevant; only the two scheduling drivers are allowed.
        graph = [{'type': 'PipeWire:Interface:Node', 'info': {'props': {'node.name': name}}}
                 for name in ('Dummy-Driver', 'Freewheel-Driver')]
        graph.append({'type': 'PipeWire:Interface:Client'})
        status, stdout, stderr = self.run_wrapper(GRAPH=json.dumps(graph))
        self.assertEqual(status, 0, stderr)
        self.assertIn('Pre-test graph nodes:', stdout)
        fixture = self.calls('fixture')[0]
        self.assertEqual(fixture['args'], ['an argument with spaces'])
        self.assertEqual(fixture['env']['BRUV_LIVE_ISOLATED'], '1')
        self.assertEqual(fixture['env']['PULSE_SERVER'], self.calls('pipewire')[0]['env']['PULSE_SERVER'])
        self.assert_released()

    def test_default_acceptance_dispatch_and_arguments_are_unchanged(self):
        status, _, stderr = self.run_wrapper(['--provider'])
        self.assertEqual(status, 0, stderr)
        call = self.calls('bun')[0]
        self.assertEqual(call['args'], ['scripts/live-acceptance.ts', '--provider'])
        self.assertEqual(call['env']['BRUV_LIVE_ISOLATED'], '1')
        self.assertFalse(self.calls('fixture'))
        self.assert_released()

    def test_command_failure_preserves_status_and_prints_service_logs(self):
        status, _, stderr = self.run_wrapper(FIXTURE_STATUS='23')
        self.assertEqual(status, 23)
        for name in ('core', 'pulse', 'manager'):
            self.assertIn('Private ' + name + ' log:', stderr)
        self.assert_released()

    def test_graph_contamination_prevents_command_dispatch(self):
        cases = [dict(GRAPH=json.dumps([{'type': 'PipeWire:Interface:Node', 'info': {'props': {'node.name': 'alsa_input'}}}])),
                 dict(SINKS='[{"name":"desktop"}]'), dict(SOURCES='[{"name":"desktop"}]')]
        for env in cases:
            with self.subTest(env=env):
                # Each case needs separate invocation records.
                for path in self.events.iterdir(): path.unlink()
                status, _, _ = self.run_wrapper(**env)
                self.assertNotEqual(status, 0)
                self.assertFalse(self.calls('fixture'))
                self.assert_released()

    def test_startup_exit_skips_command_and_releases_other_services(self):
        status, _, stderr = self.run_wrapper(EARLY_EXIT='pipewire-pulse')
        self.assertEqual(status, 1, stderr)
        self.assertIn('Private audio service exited', stderr)
        self.assertFalse(self.calls('fixture'))
        self.assert_released()

    def test_sigterm_escalates_fixture_children_and_services(self):
        process = self.start(['--', 'fixture'], WAIT_FOR_SIGNAL='1', STUBBORN='1')
        deadline = time.monotonic() + 5
        while not (self.events / 'fixture-ready').exists():
            if time.monotonic() > deadline or process.poll() is not None:
                self.fail('fixture failed to become ready')
            time.sleep(.01)
        process.terminate()
        _, stderr = process.communicate(timeout=5)
        self.assertEqual(process.returncode, 143, stderr)
        self.assert_released()
        # A killed grandchild may remain a zombie until the host's init reaps it.
        # It must not still be running; the direct fixture must have been waited.
        with self.assertRaises(ProcessLookupError): os.kill(self.calls('fixture')[0]['pid'], 0)
        child = self.calls('owned-child')[0]['pid']
        stat = Path('/proc') / str(child) / 'stat'
        self.assertTrue(not stat.exists() or stat.read_text().split()[2] == 'Z')

    def test_empty_custom_command_is_rejected_before_allocation(self):
        status, _, stderr = self.run_wrapper(['--'])
        self.assertEqual(status, 1)
        self.assertIn('Expected a command after --', stderr)
        self.assertEqual(list(self.events.iterdir()), [])


if __name__ == '__main__':
    unittest.main()
