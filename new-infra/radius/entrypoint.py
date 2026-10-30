import os
import pathlib
import re
import subprocess
import sys


def quote(value):
    if any(c in value for c in '\r\n\x00'):
        raise ValueError('RADIUS configuration values must not contain control characters')
    return '"' + value.replace('\\', '\\\\').replace('"', '\\"').replace('$', '\\$') + '"'


def main():
    config = pathlib.Path('/etc/freeradius/3.0')
    values = {}
    for key in ('DB_HOST', 'DB_NAME', 'DB_USER', 'DB_PASSWORD'):
        value = os.environ.get(key, '')
        if not value:
            raise ValueError(key + ' is required')
        values[key] = quote(value)
    template = (config / 'mods-available/triva_sql').read_text()
    rendered = re.sub(r'@@(DB_HOST|DB_NAME|DB_USER|DB_PASSWORD)@@', lambda m: values[m[1]], template)
    path = config / 'mods-available/triva_sql'
    path.write_text(rendered)
    path.chmod(0o640)
    os.chown(path, 0, __import__('grp').getgrnam('freerad').gr_gid)
    (config / 'clients.conf').write_text('')
    subprocess.run(['freeradius', '-C'], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    os.execvp('freeradius', ['freeradius', '-f', '-l', 'stdout'])


if __name__ == '__main__':
    try:
        main()
    except (ValueError, subprocess.CalledProcessError):
        print('RADIUS configuration validation failed; check required DB settings, migrations and NAS registrations.', file=sys.stderr)
        sys.exit(1)
