# -*- coding: utf-8 -*-
"""批次 70 运行器：逐个调用 annotate.py，路径从 _todo70.txt 读取（避开命令行 shell 过滤）。"""
import os
import subprocess
import sys

ROOT = 'D:/CC泄露源码分析'
ANNOT_DIR = os.path.join(ROOT, 'scripts', '_annot')
ANNOTATE = os.path.join(ROOT, 'scripts', 'annotate.py')
TODO = os.path.join(ANNOT_DIR, '_todo70.txt')
PY = sys.executable


def main():
    with open(TODO, encoding='utf-8') as f:
        rels = [line.strip() for line in f if line.strip()]
    for rel in rels:
        print('=== %s ===' % rel)
        r = subprocess.run([PY, ANNOTATE, rel], cwd=ROOT)
        if r.returncode != 0:
            raise SystemExit('annotate 失败: %s' % rel)


if __name__ == '__main__':
    main()
