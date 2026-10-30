# -*- coding: utf-8 -*-
"""第 80 批：实算全仓与 utils 覆盖率（与 check-coverage.py 同口径）。"""
import os
import collections

ROOT = 'D:/CC泄露源码分析'


def walk(root):
    out = set()
    for dp, _, fn in os.walk(root):
        for f in fn:
            full = os.path.join(dp, f)
            out.add(os.path.relpath(full, root).replace(os.sep, '/'))
    return out


def nlines(p):
    with open(p, encoding='utf-8') as f:
        return sum(1 for _ in f)


def compute(rel_dir):
    SRC = os.path.join(ROOT, 'source', rel_dir)
    ANN = os.path.join(ROOT, 'annotated', rel_dir)
    src = walk(SRC)
    ann = walk(ANN) if os.path.isdir(ANN) else set()
    done = src & ann
    tot_files = len(src)
    done_files = len(done)
    tot_lines = sum(nlines(os.path.join(SRC, r)) for r in src)
    done_lines = sum(nlines(os.path.join(SRC, r)) for r in done)
    pct = done_lines * 100.0 / tot_lines if tot_lines else 0.0
    return tot_files, done_files, tot_lines, done_lines, pct


tf, df, tl, dl, pct = compute('src')
print('全仓 src: %d/%d 文件, %d/%d 行, %.1f%%' % (df, tf, dl, tl, pct))

tf2, df2, tl2, dl2, pct2 = compute('src/utils')
print('utils: %d/%d 文件, %d/%d 行, %.1f%%' % (df2, tf2, dl2, tl2, pct2))
print('utils 剩余缺失: %d 文件' % (tf2 - df2))
