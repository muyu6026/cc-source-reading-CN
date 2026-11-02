import io
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))

todo = io.open(os.path.join(HERE, '_todo92.txt'), encoding='utf-8').read().splitlines()
todo = [t.strip() for t in todo if t.strip()]

fail = 0
for rel in todo:
    print(f'--- {rel}')
    r = subprocess.run(
        [sys.executable, os.path.join(ROOT, 'scripts', 'annotate.py'), rel],
        cwd=ROOT,
        capture_output=True,
        text=True,
        encoding='utf-8',
    )
    out = (r.stdout or '') + (r.stderr or '')
    print(out.rstrip())
    if r.returncode != 0:
        fail += 1

print()
print(f'完成 {len(todo) - fail}/{len(todo)} 份，失败 {fail} 份')
sys.exit(1 if fail else 0)
