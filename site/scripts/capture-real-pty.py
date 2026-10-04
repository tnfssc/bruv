"""Capture a real provider-free Bruv /settings screen. Linux + user/net namespaces required."""
import argparse, fcntl, os, pty, select, struct, subprocess, termios, time

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--binary', required=True)
parser.add_argument('--sandbox', default='/tmp/bruv-real-capture')
parser.add_argument('--output', required=True)
args = parser.parse_args()
root = os.path.abspath(args.sandbox)
os.makedirs(root + '/home', exist_ok=True)
os.makedirs(root + '/workspace', exist_ok=True)
master, slave = pty.openpty()
fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack('HHHH', 36, 110, 0, 0))
env = {'HOME': root + '/home', 'PATH': '/usr/bin:/bin', 'TERM': 'xterm-256color',
       'COLORTERM': 'truecolor', 'LANG': 'C.UTF-8'}
p = subprocess.Popen(['unshare', '--user', '--map-root-user', '--net', os.path.abspath(args.binary)],
                     cwd=root + '/workspace', env=env, stdin=slave, stdout=slave, stderr=slave,
                     start_new_session=True)
os.close(slave)
data = bytearray()
start = time.monotonic()
sent = False
try:
    while time.monotonic() - start < 7:
        if not sent and time.monotonic() - start > 3:
            os.write(master, b'/settings\r')
            sent = True
        if select.select([master], [], [], 0.1)[0]:
            try:
                chunk = os.read(master, 65536)
            except OSError:
                break
            data.extend(chunk)
            if b'\x1b[6n' in chunk:
                os.write(master, b'\x1b[1;1R')
    if p.poll() is not None and p.returncode != 0:
        raise RuntimeError('Isolated CLI exited with code ' + str(p.returncode))
    with open(args.output, 'wb') as output:
        output.write(data)
finally:
    p.terminate()
    try:
        p.wait(timeout=3)
    except subprocess.TimeoutExpired:
        p.kill()
        p.wait()
    os.close(master)
print('Captured', len(data), 'bytes; idle CLI terminated; PTY 110x36')
