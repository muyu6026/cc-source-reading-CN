#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""实算全仓批注进度（第 64 批后）。

口径与历史一致：
  - 分子 = annotated/src 下所有文件行数之和（含插入的中文注释行）
  - 分母 = source/src 下所有文件行数之和
  - 文件数 = annotated/src 下文件数
  - utils 已做 = annotated/src/utils 下文件数
"""
import os

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def walk(root):
    out = []
    for dp, _, fn in os.walk(root):
        for f in fn:
            out.append(os.path.join(dp, f))
    return out


def nlines(p):
    with open(p, encoding='utf-8') as f:
        return sum(1 for _ in f)


SRC = os.path.join(ROOT, 'source', 'src')
ANN = os.path.join(ROOT, 'annotated', 'src')

src_files = walk(SRC)
ann_files = walk(ANN)

src_lines = sum(nlines(p) for p in src_files)
# 分子 = 已批注文件对应的【源文件行数】之和（不含我们插入的中文注释行，
# 与 README 历史口径一致：742 文件 / 295,062 行 / 57.5%）。
def rel_ann(p):
    return os.path.relpath(p, ANN).replace(os.sep, '/')

covered_src_lines = 0
for p in ann_files:
    sp = os.path.join(SRC, rel_ann(p))
    if os.path.exists(sp):
        covered_src_lines += nlines(sp)

total_src = len(src_files)
total_ann = len(ann_files)
pct = covered_src_lines / src_lines * 100 if src_lines else 0

# utils 子树
utils_src = [p for p in src_files if os.path.join('src', 'utils') in p.replace(ROOT + os.sep, '').replace(os.sep, '/')]
utils_ann = [p for p in ann_files if '/utils/' in p.replace(ROOT + os.sep, '').replace(os.sep, '/') or p.replace(ROOT + os.sep, '').replace(os.sep, '/').endswith('utils')]
# 上面的判断不稳，直接用相对路径前缀统计
def rel(p):
    return os.path.relpath(p, ANN if p in ann_files else SRC).replace(os.sep, '/')

utils_ann_count = sum(1 for p in ann_files if rel(p).startswith('src/utils/') or rel(p).startswith('utils/'))
utils_src_count = sum(1 for p in src_files if rel(p).startswith('src/utils/') or rel(p).startswith('utils/'))

print('源文件总数    : %d' % total_src)
print('已批注文件数  : %d' % total_ann)
print('还剩          : %d' % (total_src - total_ann))
print('源总行数      : %d' % src_lines)
print('已批注源行数  : %d' % covered_src_lines)
print('按行数覆盖    : %.1f%%' % pct)
print('utils 已做    : %d / %d' % (utils_ann_count, utils_src_count))
