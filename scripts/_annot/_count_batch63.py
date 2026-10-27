# -*- coding: utf-8 -*-
import os

ROOT = 'D:/CC泄露源码分析'
src = os.path.join(ROOT, 'source', 'src')
ann = os.path.join(ROOT, 'annotated', 'src')
total = 0
files = 0
for dp, _, fn in os.walk(src):
    for f in fn:
        if not f.endswith(('.ts', '.tsx')):
            continue
        sp = os.path.join(dp, f)
        rel = os.path.relpath(sp, src).replace('\\', '/')
        if os.path.exists(os.path.join(ann, rel)):
            files += 1
            with open(sp, encoding='utf-8') as fh:
                total += len(fh.read().splitlines())
print('files', files, 'lines', total)
print('pct %.1f' % (total / 513237 * 100))
