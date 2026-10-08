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

WRAPPER = Path(__file__).resolve().parents[3] / 'scripts/live/isolated-audio.sh'

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


class WrapperInvocation:
    """Own one real Bash process and the fake tools' records for that run."""

    def __init__(self, tools, events, args, overrides):
        self.events = events
        env = dict(os.environ, PATH=str(tools) + os.pathsep + os.environ['PATH'],
                   EVENTS=str(events))
        # Deliberately hostile inherited routes must be replaced for all tools.
        env.update(PULSE_SERVER='unix:/desktop', PIPEWIRE_REMOTE='desktop',
                   XDG_RUNTIME_DIR='/desktop', DBUS_SESSION_BUS_ADDRESS='unix:path=/desktop')
        env.update(overrides)
        self.process = subprocess.Popen(['/bin/bash', str(WRAPPER), *args],
                                        env=env, stdout=subprocess.PIPE,
                                        stderr=subprocess.PIPE, text=True)

    def calls(self, name):
        return [json.loads(path.read_text()) for path in self.events.glob(name + '.*.json')]

    def wait(self, timeout=8):
        stdout, stderr = self.process.communicate(timeout=timeout)
        return subprocess.CompletedProcess(self.process.args, self.process.returncode,
                                           stdout, stderr)

    def stop(self):
        # Assertion failures and timeouts must not leave the wrapper or its fakes running.
        if self.process.poll() is None:
            self.process.kill()
        for name in ('fixture', 'bun', 'owned-child', 'pipewire', 'pipewire-pulse', 'wireplumber'):
            for call in self.calls(name):
                try:
                    os.kill(call['pid'], signal.SIGKILL)
                except ProcessLookupError:
                    pass
        # The fixture and its child can inherit these pipes. Kill them before
        # draining output, otherwise cleanup after a timeout blocks forever.
        self.process.communicate()


class IsolatedAudioWrapperTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.tools = self.root / 'bin'
        self.tools.mkdir()
        for name in ('pipewire', 'pipewire-pulse', 'wireplumber', 'pw-dump',
                     'pactl', 'cp', 'bun', 'parec', 'pacat', 'fixture', 'owned-child'):
            tool = self.tools / name
            tool.write_text('#!' + sys.executable + '\n' + TOOL)
            tool.chmod(0o700)

    def start(self, args, **env):
        # Records outlive each process and remain separate across subtest invocations.
        events = Path(tempfile.mkdtemp(prefix='events-', dir=self.root))
        # Bash can be killed before its EXIT trap; keep its mktemp graph test-owned.
        run = WrapperInvocation(self.tools, events, args, dict(env, TMPDIR=str(self.root)))
        self.addCleanup(run.stop)
        return run

    def run_wrapper(self, args=None, **env):
        if args is None:
            args = ['--', 'fixture', 'an argument with spaces']
        run = self.start(args, **env)
        return run, run.wait()

    def assert_private_services(self, run):
        for name in ('pipewire', 'pipewire-pulse', 'wireplumber'):
            calls = run.calls(name)
            self.assertEqual(len(calls), 1, name)
            env = calls[0]['env']
            runtime = Path(env['XDG_RUNTIME_DIR'])
            self.assertEqual(env['PIPEWIRE_RUNTIME_DIR'], str(runtime))
            self.assertEqual(env['PIPEWIRE_REMOTE'], 'pipewire-0')
            self.assertEqual(env['PULSE_SERVER'], 'unix:' + str(runtime / 'pulse/native'))
            self.assertEqual(env['DBUS_SESSION_BUS_ADDRESS'], 'unix:path=' + str(runtime / 'nonexistent-dbus'))
            self.assertEqual(env['PIPEWIRE_NO_SYSTEM_CONFIG'], '1')
        manager = run.calls('wireplumber')[0]
        self.assertEqual(manager['args'], ['-c', '/usr/share/wireplumber/wireplumber.conf', '-p', 'policy'])

    def assert_released(self, run):
        for name in ('pipewire', 'pipewire-pulse', 'wireplumber'):
            call = run.calls(name)[0]
            with self.assertRaises(ProcessLookupError):
                os.kill(call['pid'], 0)
            runtime = Path(call['env']['XDG_RUNTIME_DIR'])
            self.assertFalse(runtime.parent.exists())

    def wait_for_fixture(self, run):
        deadline = time.monotonic() + 5
        while not (run.events / 'fixture-ready').exists():
            if time.monotonic() > deadline or run.process.poll() is not None:
                self.fail('fixture failed to become ready')
            time.sleep(.01)

    def assert_not_running(self, pid):
        # An orphan can remain a zombie until the host's init reaps it.
        stat = Path('/proc') / str(pid) / 'stat'
        self.assertTrue(not stat.exists() or stat.read_text().split()[2] == 'Z')

    def test_custom_command_uses_verified_private_environment(self):
        # Non-node objects are irrelevant; only the two scheduling drivers are allowed.
        graph = [{'type': 'PipeWire:Interface:Node', 'info': {'props': {'node.name': name}}}
                 for name in ('Dummy-Driver', 'Freewheel-Driver')]
        graph.append({'type': 'PipeWire:Interface:Client'})
        run, result = self.run_wrapper(GRAPH=json.dumps(graph))
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('Pre-test graph nodes:', result.stdout)
        fixture = run.calls('fixture')[0]
        self.assertEqual(fixture['args'], ['an argument with spaces'])
        self.assertEqual(fixture['env']['BRUV_LIVE_ISOLATED'], '1')
        self.assertEqual(fixture['env']['PULSE_SERVER'], run.calls('pipewire')[0]['env']['PULSE_SERVER'])
        self.assert_private_services(run)
        self.assert_released(run)

    def test_default_acceptance_dispatch_and_arguments_are_unchanged(self):
        run, result = self.run_wrapper(['--provider'])
        self.assertEqual(result.returncode, 0, result.stderr)
        call = run.calls('bun')[0]
        self.assertEqual(call['args'], ['scripts/live/acceptance.ts', '--provider'])
        self.assertEqual(call['env']['BRUV_LIVE_ISOLATED'], '1')
        self.assertFalse(run.calls('fixture'))
        self.assert_private_services(run)
        self.assert_released(run)

    def test_command_failure_preserves_status_and_prints_service_logs(self):
        run, result = self.run_wrapper(FIXTURE_STATUS='23')
        self.assertEqual(result.returncode, 23)
        for name in ('core', 'pulse', 'manager'):
            self.assertIn('Private ' + name + ' log:', result.stderr)
        self.assert_private_services(run)
        self.assert_released(run)

    def test_graph_contamination_prevents_command_dispatch(self):
        cases = [dict(GRAPH=json.dumps([{'type': 'PipeWire:Interface:Node', 'info': {'props': {'node.name': 'alsa_input'}}}])),
                 dict(SINKS='[{"name":"desktop"}]'), dict(SOURCES='[{"name":"desktop"}]')]
        for env in cases:
            with self.subTest(env=env):
                run, result = self.run_wrapper(**env)
                self.assertNotEqual(result.returncode, 0)
                self.assertFalse(run.calls('fixture'))
                self.assert_private_services(run)
                self.assert_released(run)

    def test_startup_exit_skips_command_and_releases_other_services(self):
        run, result = self.run_wrapper(EARLY_EXIT='pipewire-pulse')
        self.assertEqual(result.returncode, 1, result.stderr)
        self.assertIn('Private audio service exited', result.stderr)
        self.assertFalse(run.calls('fixture'))
        self.assert_private_services(run)
        self.assert_released(run)

    def test_sigterm_escalates_fixture_children_and_services(self):
        run = self.start(['--', 'fixture'], WAIT_FOR_SIGNAL='1', STUBBORN='1')
        self.wait_for_fixture(run)
        run.process.terminate()
        result = run.wait(timeout=5)
        self.assertEqual(result.returncode, 143, result.stderr)
        self.assert_private_services(run)
        self.assert_released(run)
        # The wrapper must wait its direct fixture; the grandchild may be a zombie.
        with self.assertRaises(ProcessLookupError):
            os.kill(run.calls('fixture')[0]['pid'], 0)
        self.assert_not_running(run.calls('owned-child')[0]['pid'])

    def test_harness_timeout_cleanup_stops_process_tree_and_removes_private_graph(self):
        run = self.start(['--', 'fixture'], WAIT_FOR_SIGNAL='1', STUBBORN='1')
        self.wait_for_fixture(run)
        graph_root = Path(run.calls('pipewire')[0]['env']['XDG_RUNTIME_DIR']).parent
        self.assertEqual(graph_root.parent, self.root)
        with self.assertRaises(subprocess.TimeoutExpired):
            run.wait(timeout=.01)
        run.stop()
        self.assertEqual(run.process.returncode, -signal.SIGKILL)
        with self.assertRaises(ProcessLookupError):
            os.kill(run.process.pid, 0)
        for name in ('fixture', 'owned-child', 'pipewire', 'pipewire-pulse', 'wireplumber'):
            calls = run.calls(name)
            self.assertEqual(len(calls), 1, name)
            self.assert_not_running(calls[0]['pid'])
        # SIGKILL bypassed Bash's EXIT trap. Test teardown owns the leftover graph.
        self.assertTrue(graph_root.exists())
        self.doCleanups()
        self.assertFalse(graph_root.exists())
        self.assertFalse(self.root.exists())

    def test_empty_custom_command_is_rejected_before_allocation(self):
        run, result = self.run_wrapper(['--'])
        self.assertEqual(result.returncode, 1)
        self.assertIn('Expected a command after --', result.stderr)
        self.assertEqual(list(run.events.iterdir()), [])


if __name__ == '__main__':
    unittest.main()
