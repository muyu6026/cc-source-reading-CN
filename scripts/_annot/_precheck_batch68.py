# -*- coding: utf-8 -*-
# 批 68 预检：逐个 import 数据文件，断言 slug↔path 1:1、pos 合法、
# 1≤line≤源文件行数、无重复 (line,pos)、文本无 " 或 \、整文件 ast.parse 通过。
import os, sys, importlib.util, ast

ROOT = 'D:/CC泄露源码分析'
ANNOT_DIR = os.path.join(ROOT, 'scripts', '_annot')
SRC = os.path.join(ROOT, 'source')

TARGETS = {
    'src_utils_hooks_execHttpHook_ts': 'src/utils/hooks/execHttpHook.ts',
    'src_utils_shell_specPrefix_ts': 'src/utils/shell/specPrefix.ts',
    'src_utils_asciicast_ts': 'src/utils/asciicast.ts',
    'src_utils_errors_ts': 'src/utils/errors.ts',
    'src_utils_desktopDeepLink_ts': 'src/utils/desktopDeepLink.ts',
    'src_utils_contextSuggestions_ts': 'src/utils/contextSuggestions.ts',
    'src_utils_background_remote_preconditions_ts': 'src/utils/background/remote/preconditions.ts',
    'src_utils_stringUtils_ts': 'src/utils/stringUtils.ts',
    'src_utils_errorLogSink_ts': 'src/utils/errorLogSink.ts',
    'src_utils_permissions_shadowedRuleDetection_ts': 'src/utils/permissions/shadowedRuleDetection.ts',
}

def real_len(seq):
    return len(seq) - 1 if seq and seq[-1] == '' else len(seq)

ok = True
total = 0
for slug, rel in TARGETS.items():
    path = os.path.join(ANNOT_DIR, slug + '_p1.py')
    if not os.path.exists(path):
        print('MISSING', slug); ok = False; continue
    spec = importlib.util.spec_from_file_location(slug, path)
    mod = importlib.util.module_from_spec(spec)
    try:
        spec.loader.exec_module(mod)
    except Exception as e:
        print('IMPORT FAIL', slug, repr(e)); ok = False; continue
    try:
        ast.parse(open(path, encoding='utf-8').read())
    except Exception as e:
        print('AST FAIL', slug, repr(e)); ok = False; continue
    with open(os.path.join(SRC, rel), encoding='utf-8') as f:
        nlines = real_len(f.read().split('\n'))
    ann = mod.ANNOTATIONS
    seen = set()
    for t in ann:
        if len(t) != 3:
            print('BAD TUPLE', slug, t); ok = False; continue
        ln, pos, txt = t
        if pos not in ('before', 'after', 'after_block'):
            print('BAD POS', slug, t); ok = False
        if not (1 <= ln <= nlines):
            print('BAD LINE', slug, t, 'nlines=', nlines); ok = False
        if (ln, pos) in seen:
            print('DUP ANCHOR', slug, (ln, pos)); ok = False
        seen.add((ln, pos))
        if '"' in txt or '\\' in txt:
            print('QUOTE/BACKSLASH', slug, t); ok = False
    total += len(ann)
    print('OK', slug, 'ann=', len(ann), 'src_lines=', nlines)

print('TOTAL ANN', total)
print('ALL OK' if ok else 'HAS FAILURES')
sys.exit(0 if ok else 1)
