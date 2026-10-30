import pathlib
import re
import socket
import subprocess
import time

import psycopg2


with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as probe:
    probe.connect(('postgres', 5432))
    source_ip = probe.getsockname()[0]
with psycopg2.connect(connect_timeout=10) as connection:
    with connection.cursor() as cursor:
        cursor.execute('UPDATE nas SET nasname = %s WHERE id = 1', (source_ip,))
        cursor.execute('UPDATE omada_sites SET "controllerIp" = %s WHERE id = %s', (source_ip, 'site-1'))
pathlib.Path('/tmp/nas-ready').touch()
print('Fixture NAS registered; waiting for RADIUS startup')


def request(username, password):
    packet = f'User-Name = "{username}"\nUser-Password = "{password}"\nMessage-Authenticator = 0x00\n'
    result = subprocess.run(['radclient', '-x', '-r', '1', '-t', '2', 'radius:1812', 'auth', 'isolated-radius-test'], input=packet, text=True, capture_output=True)
    return result.stdout + result.stderr


for attempt in range(60):
    accepted = request('triva_0000000000000001', 'test-password')
    if 'Received Access-Accept' in accepted:
        break
    time.sleep(1)
else:
    raise SystemExit('FAIL: valid active credentials were not accepted')

match = re.search(r'Session-Timeout = (\d+)', accepted)
assert match and 0 < int(match[1]) <= 300, 'Timeout must use remaining session lifetime, not the original package duration'

for label, username, password in [
    ('wrong password', 'triva_0000000000000001', 'wrong'),
    ('expired session', 'triva_0000000000000002', 'test-password'),
    ('disabled user', 'triva_0000000000000003', 'test-password'),
    ('foreign NAS source', 'triva_0000000000000004', 'test-password'),
    ('unpaid session', 'triva_0000000000000005', 'test-password'),
    ('unknown user', 'triva_0000000000000099', 'test-password'),
    ('invalid username', 'invalid-user', 'test-password'),
]:
    assert 'Received Access-Reject' in request(username, password), 'FAIL: ' + label
    print('PASS:', label)

accounting = subprocess.run(['radclient', '-r', '1', '-t', '3', 'radius:1813', 'acct', 'isolated-radius-test'], input='User-Name = "triva_0000000000000001"\nAcct-Status-Type = Start\nAcct-Session-Id = "lab-test"\n', text=True, capture_output=True)
assert accounting.returncode == 0, 'Accounting listener did not acknowledge packet'
print('PASS: authentication, remaining timeout and accounting acknowledgement')
