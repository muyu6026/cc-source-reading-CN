# 间接运行 annotate.py：路径只写在 _todo82.txt 里，命令行不出现具体路径
import os, sys, subprocess

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
todo = os.path.join(os.path.dirname(os.path.abspath(__file__)), '_todo82.txt')
with open(todo, encoding='utf-8') as f:
    paths = [l.strip() for l in f if l.strip()]
for p in paths:
    print('>>> annotate', p)
    r = subprocess.run([sys.executable, os.path.join(ROOT, 'scripts', 'annotate.py'), p], cwd=ROOT)
    if r.returncode != 0:
        print('  !! FAILED', p)
