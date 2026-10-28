#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""列出 source/src/utils 下尚缺批注、按源行数降序的文件（前 20）。"""
import os
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SRC = os.path.join(ROOT, 'source', 'src', 'utils')
ANN = os.path.join(ROOT, 'annotated', 'src', 'utils')

def walk(root):
    out = set()
    for dp, _, fn in os.walk(root):
        for f in fn:
            out.add(os.path.relpath(os.path.join(dp, f), root).replace(os.sep, '/'))
    return out

def nlines(p):
    with open(p, encoding='utf-8') as f:
        return sum(1 for _ in f)

src = walk(SRC)
ann = walk(ANN) if os.path.isdir(ANN) else set()
miss = sorted(src - ann, key=lambda r: (nlines(os.path.join(SRC, r)), r), reverse=True)
print('utils 缺失总数:', len(miss))
for r in miss[:20]:
    print('%5d  %s' % (nlines(os.path.join(SRC, r)), r))
