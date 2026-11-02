# -*- coding: utf-8 -*-
"""按 _todo83.txt 顺序逐个调用 annotate.py。"""
import os
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
todo = os.path.join(ROOT, 'scripts', '_annot', '_todo83.txt')
rels = [ln.strip() for ln in open(todo, encoding='utf-8') if ln.strip()]

rc = 0
for rel in rels:
    print('=== ' + rel)
    p = subprocess.run([sys.executable, os.path.join(ROOT, 'scripts', 'annotate.py'), rel],
                       cwd=ROOT, capture_output=True, text=True, encoding='utf-8')
    sys.stdout.write(p.stdout)
    if p.returncode != 0:
        sys.stdout.write(p.stderr)
        rc = 1
sys.exit(rc)
