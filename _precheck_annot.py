#!/usr/bin/env python3
# -*- coding: utf-8 -*-
import ast, importlib.util, os, sys

ROOT = r'D:/CC泄露源码分析'
ANNOT_DIR = os.path.join(ROOT, 'scripts', '_annot')

MAPPING = {
    'src_utils_deepLink_terminalLauncher_ts': 'src/utils/deepLink/terminalLauncher.ts',
    'src_utils_queryHelpers_ts': 'src/utils/queryHelpers.ts',
    'src_utils_sessionRestore_ts': 'src/utils/sessionRestore.ts',
    'src_utils_messageQueueManager_ts': 'src/utils/messageQueueManager.ts',
    'src_utils_model_modelOptions_ts': 'src/utils/model/modelOptions.ts',
    'src_utils_claudeInChrome_common_ts': 'src/utils/claudeInChrome/common.ts',
    'src_utils_fastMode_ts': 'src/utils/fastMode.ts',
    'src_utils_gitDiff_ts': 'src/utils/gitDiff.ts',
    'src_utils_gracefulShutdown_ts': 'src/utils/gracefulShutdown.ts',
    'src_utils_claudeInChrome_chromeNativeHost_ts': 'src/utils/claudeInChrome/chromeNativeHost.ts',
}

VALID_POS = {'before', 'after', 'after_block'}
errors = []

def slug_of(rel):
    return rel.replace('/', '_').replace('.', '_').replace('-', '_')

for slug, rel in MAPPING.items():
    if slug_of(rel) != slug:
        errors.append('slug 推导不一致: %s -> %s (期望 %s)' % (rel, slug_of(rel), slug))

for slug, rel in MAPPING.items():
    fname = slug + '_p1.py'
    fpath = os.path.join(ANNOT_DIR, fname)
    if not os.path.exists(fpath):
        errors.append('缺少数据文件: %s' % fname)
        continue
    try:
        src = open(fpath, encoding='utf-8').read()
        ast.parse(src)
    except SyntaxError as e:
        errors.append('%s: ast.parse 失败: %s' % (fname, e))
        continue
    try:
        spec = importlib.util.spec_from_file_location(fname[:-3], fpath)
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        items = mod.ANNOTATIONS
    except Exception as e:
        errors.append('%s: 加载失败: %s' % (fname, e))
        continue
    sp = os.path.join(ROOT, 'source', rel)
    if not os.path.exists(sp):
        errors.append('%s: 源文件不存在 %s' % (fname, sp))
        continue
    with open(sp, encoding='utf-8') as f:
        nlines = sum(1 for _ in f)
    seen = set()
    for idx, t in enumerate(items):
        if not (isinstance(t, tuple) and len(t) == 3):
            errors.append('%s: 第 %d 条不是三元组: %r' % (fname, idx, t))
            continue
        lineno, pos, text = t
        if pos not in VALID_POS:
            errors.append('%s: 第 %d 条 pos 非法: %r' % (fname, idx, pos))
        if not isinstance(lineno, int) or lineno < 1 or lineno > nlines:
            errors.append('%s: 第 %d 条行号越界: %r (源文件 %d 行)' % (fname, idx, lineno, nlines))
        if not isinstance(text, str):
            errors.append('%s: 第 %d 条文本非字符串' % (fname, idx))
        else:
            if '"' in text or '\\' in text:
                errors.append('%s: 第 %d 条文本含禁用字符 (双引号或反斜杠): %r' % (fname, idx, text[:40]))
            if "'''" in text:
                errors.append('%s: 第 %d 条文本含三连单引号' % (fname, idx))
        key = (lineno, pos)
        if key in seen:
            errors.append('%s: 重复锚点 (行号,pos): %r' % (fname, key))
        seen.add(key)
    print('  %s: %d 锚点, 源文件 %d 行, OK' % (fname, len(items), nlines))

print()
if errors:
    print('预检失败 (%d 处):' % len(errors))
    for e in errors:
        print('  - ' + e)
    sys.exit(1)
else:
    print('预检全部通过（%d 个数据文件）。' % len(MAPPING))
