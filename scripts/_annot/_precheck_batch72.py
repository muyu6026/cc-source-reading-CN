# -*- coding: utf-8 -*-
"""Batch 72 预检：加载 10 个 _p1.py 数据文件，断言各类不变量。"""
import ast
import io
import os
import importlib.util

ROOT = 'D:/CC泄露源码分析'
ANNOT_DIR = os.path.join(ROOT, 'scripts', '_annot')

PAIRS = [
    ('src_utils_computerUse_appNames_ts', 'src/utils/computerUse/appNames.ts'),
    ('src_utils_plugins_cacheUtils_ts', 'src/utils/plugins/cacheUtils.ts'),
    ('src_utils_authFileDescriptor_ts', 'src/utils/authFileDescriptor.ts'),
    ('src_utils_cronTasksLock_ts', 'src/utils/cronTasksLock.ts'),
    ('src_utils_startupProfiler_ts', 'src/utils/startupProfiler.ts'),
    ('src_utils_user_ts', 'src/utils/user.ts'),
    ('src_utils_claudeCodeHints_ts', 'src/utils/claudeCodeHints.ts'),
    ('src_utils_hooks_hookEvents_ts', 'src/utils/hooks/hookEvents.ts'),
    ('src_utils_jetbrains_ts', 'src/utils/jetbrains.ts'),
    ('src_utils_earlyInput_ts', 'src/utils/earlyInput.ts'),
]

VALID_POS = {'before', 'after', 'after_block'}
ok = True
total_anchors = 0

for slug, rel in PAIRS:
    path = os.path.join(ANNOT_DIR, slug + '_p1.py')
    if not os.path.exists(path):
        print('MISSING: %s' % path)
        ok = False
        continue
    # ast.parse 整文件
    with io.open(path, encoding='utf-8') as f:
        src_text = f.read()
    try:
        ast.parse(src_text)
    except SyntaxError as e:
        print('AST FAIL %s: %s' % (slug, e))
        ok = False
        continue
    # importlib 执行取变量
    spec = importlib.util.spec_from_file_location(slug, path)
    mod = importlib.util.module_from_spec(spec)
    try:
        spec.loader.exec_module(mod)
    except Exception as e:
        print('EXEC FAIL %s: %s' % (slug, e))
        ok = False
        continue
    if getattr(mod, 'slug', None) != slug:
        print('SLUG MISMATCH %s: got %r' % (slug, getattr(mod, 'slug', None)))
        ok = False
    ann = mod.ANNOTATIONS
    # 源文件行数
    with io.open(os.path.join(ROOT, 'source', rel), encoding='utf-8') as f:
        real = len(f.read().splitlines())
    seen = set()
    for item in ann:
        if not (isinstance(item, tuple) and len(item) == 3):
            print('BAD ITEM %s: %r' % (slug, item)); ok = False; continue
        line, pos, text = item
        if pos not in VALID_POS:
            print('BAD POS %s line %s: %r' % (slug, line, pos)); ok = False
        if not (isinstance(line, int) and 1 <= line <= real):
            print('BAD LINE %s: %s (file has %d lines)' % (slug, line, real)); ok = False
        if (line, pos) in seen:
            print('DUP ANCHOR %s: (%s,%s)' % (slug, line, pos)); ok = False
        seen.add((line, pos))
        if '"' in text or '\\' in text:
            print('FORBIDDEN CHAR %s line %s' % (slug, line)); ok = False
        if not isinstance(text, str) or not text.strip():
            print('EMPTY/ BAD TEXT %s line %s' % (slug, line)); ok = False
    total_anchors += len(ann)
    print('OK  %-40s %3d anchors, source %d lines' % (slug, len(ann), real))

print('---')
print('Total anchors: %d' % total_anchors)
print('RESULT:', 'PASS' if ok else 'FAIL')
raise SystemExit(0 if ok else 1)
