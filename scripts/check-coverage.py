#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""按子目录统计批注覆盖率：已做/总数、已做行数/总行数、未做清单。

为什么需要它：`annotated-索引与进度.md` 里出现过「✅ 完成」但实际只做了
三分之一的情况（`services/` 130 份里只做了 35 份就标完成）。
所以「进度」这件事一律交给脚本算，不手数、不凭印象。

用法：
    python scripts/check-coverage.py                  # 默认看 src/services
    python scripts/check-coverage.py src/components   # 看别的目录
"""
import collections
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def walk(root):
    """返回 root 下所有文件的相对路径（用 / 分隔，跨平台可比）。"""
    out = set()
    for dp, _, fn in os.walk(root):
        for f in fn:
            full = os.path.join(dp, f)
            out.add(os.path.relpath(full, root).replace(os.sep, '/'))
    return out


def nlines(p):
    # 与 `wc -l` 同口径：不把「文件末尾换行」算成一行
    with open(p, encoding='utf-8') as f:
        return sum(1 for _ in f)


rel_dir = sys.argv[1].strip('/') if len(sys.argv) > 1 else 'src/services'
SRC = os.path.join(ROOT, 'source', rel_dir)
ANN = os.path.join(ROOT, 'annotated', rel_dir)

if not os.path.isdir(SRC):
    sys.exit('目录不存在：%s' % SRC)

src = walk(SRC)
ann = walk(ANN) if os.path.isdir(ANN) else set()
done = src & ann
miss = src - ann
extra = ann - src

print('目录：%s' % rel_dir)
print('source 文件 %d · annotated 已有 %d · 缺失 %d' % (len(src), len(done), len(miss)))
if extra:
    print('多余（annotated 里有、source 里没有）%d: %s' % (len(extra), sorted(extra)[:5]))


def group(rel):
    parts = rel.split('/')
    return parts[0] if len(parts) > 1 else '(根目录)'


g = collections.defaultdict(lambda: [0, 0, 0, 0])  # 总文件, 总行, 完成文件, 完成行
for r in src:
    n = nlines(os.path.join(SRC, r))
    k = group(r)
    g[k][0] += 1
    g[k][1] += n
    if r in done:
        g[k][2] += 1
        g[k][3] += n

print()
print('%-28s %12s %14s  状态' % ('子目录', '文件', '行数'))
# 按「还剩多少行」降序排：最该补的排在最上面
for k in sorted(g, key=lambda x: -(g[x][1] - g[x][3])):
    t, tl, d, dl = g[k]
    flag = 'OK ' if d == t else ('-- ' if d == 0 else '.. ')
    print('%-28s %4d/%-4d %6d/%-7d %s' % (k, d, t, dl, tl, flag))

tot_files = sum(v[0] for v in g.values())
tot_lines = sum(v[1] for v in g.values())
done_files = sum(v[2] for v in g.values())
done_lines = sum(v[3] for v in g.values())
print()
print('合计: %d/%d 文件, %d/%d 行 (%d%%)'
      % (done_files, tot_files, done_lines, tot_lines,
         done_lines * 100 // tot_lines if tot_lines else 0))
print()
print('--- 未做文件（按行数降序，前 40）---')
for r in sorted(miss, key=lambda r: -nlines(os.path.join(SRC, r)))[:40]:
    print('%6d  %s' % (nlines(os.path.join(SRC, r)), r))
