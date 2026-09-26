"""Run the handoff section 6 checks serially against a committed T21 HEAD."""
import datetime
import json
import pathlib
import re
import subprocess

root = pathlib.Path(__file__).resolve().parents[3]
head = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=root, text=True).strip()
branch = subprocess.check_output(['git', 'branch', '--show-current'], cwd=root, text=True).strip()
assert branch == 'codex/t21-p0-acceptance', branch
assert subprocess.run(['git', 'diff', '--quiet'], cwd=root).returncode == 0
assert subprocess.run(['git', 'diff', '--cached', '--quiet'], cwd=root).returncode == 0
out = pathlib.Path('/tmp/possio-t21/final-checks')
out.mkdir(parents=True, exist_ok=True)
commands = [
    ('ui', ['npm', 'run', 'test:ui']),
    ('rust', ['npm', 'test']),
    ('demo', ['npm', 'run', 'test:demo']),
    ('check', ['npm', 'run', 'check']),
    ('web-build', ['npm', 'run', 'build']),
    ('debug-build', ['npm', 'run', 'tauri', '--', 'build', '--debug', '--config', '.local/t06b.conf.json', '--bundles', 'app']),
    ('release-build', ['npm', 'run', 'tauri', '--', 'build', '--config', '.local/t21-release.conf.json', '--bundles', 'app']),
    ('diff-check', ['git', 'diff', '--check']),
]
results = []
for name, command in commands:
    assert subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=root, text=True).strip() == head
    start = datetime.datetime.now().astimezone().isoformat()
    print('START', name, start, flush=True)
    with (out / f'{name}.log').open('w') as log:
        log.write(f'HEAD {head}\nCOMMAND {command!r}\nSTART {start}\n')
        log.flush()
        result = subprocess.run(command, cwd=root, stdout=log, stderr=subprocess.STDOUT)
    content = (out / f'{name}.log').read_text()
    passed = None
    if name == 'ui':
        matches = re.findall(r'# pass (\d+)', content)
        passed = int(matches[-1]) if matches else None
    elif name in ('rust', 'demo'):
        passed = sum(map(int, re.findall(r'test result: ok\. (\d+) passed;', content)))
    entry = {'name': name, 'command': command, 'exit_code': result.returncode, 'passed': passed,
             'start': start, 'end': datetime.datetime.now().astimezone().isoformat()}
    results.append(entry)
    (out / 'summary.json').write_text(json.dumps({'head': head, 'branch': branch, 'checks': results}, indent=2) + '\n')
    lines = ['# T21 final HEAD checks', '', f'HEAD: `{head}`', '', '| Command | Exit | Passed | Log |', '|---|---|---|---|']
    lines.extend(f"| `{' '.join(r['command'])}` | {r['exit_code']} | {r['passed'] if r['passed'] is not None else '—'} | [{r['name']}]({r['name']}.log) |" for r in results)
    (out / 'summary.md').write_text('\n'.join(lines) + '\n')
    print('DONE', name, 'exit', result.returncode, 'passed', passed, flush=True)
raise SystemExit(0 if all(r['exit_code'] == 0 for r in results) else 1)
