# -*- coding: utf-8 -*-
"""第 91 批：逐个调用 annotate.py，避免命令行路径过滤。"""
import io
import os
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
todo = os.path.join(ROOT, 'scripts', '_annot', '_todo91.txt')

with io.open(todo, encoding='utf-8') as f:
    files = [ln.strip() for ln in f if ln.strip()]

fail = 0
for rel in files:
    print('==> ' + rel)
    r = subprocess.run(
        [sys.executable, os.path.join(ROOT, 'scripts', 'annotate.py'), rel],
        cwd=ROOT,
        capture_output=True,
        text=True,
        encoding='utf-8',
        errors='replace',
    )
    out = (r.stdout or '') + (r.stderr or '')
    print(out.rstrip())
    if r.returncode != 0:
        print('FAIL rc=%d' % r.returncode)
        fail += 1
    if '⟳' in out:
        print('WARN 出现外移标记，需确认落点: ' + rel)
    if '⚠' in out:
        print('WARN 出现告警: ' + rel)

print('----')
print('完成 %d 份，失败 %d' % (len(files), fail))
sys.exit(1 if fail else 0)
