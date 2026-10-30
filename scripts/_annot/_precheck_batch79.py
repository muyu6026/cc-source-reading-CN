#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""第 79 批预检：10 个 utils 小文件数据文件一次性校验。"""
import os
import sys
import importlib.util

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))  # scripts/_annot -> scripts -> ROOT
ANNOT_DIR = os.path.join(ROOT, 'scripts', '_annot')
SOURCE_DIR = os.path.join(ROOT, 'source')

# (slug, 相对 source 的路径) —— 与 annotate.py 的 slug 推导一致
TARGETS = [
    ('src_utils_settings_mdm_rawRead_ts', 'src/utils/settings/mdm/rawRead.ts'),
    ('src_utils_mcpInstructionsDelta_ts', 'src/utils/mcpInstructionsDelta.ts'),
    ('src_utils_glob_ts', 'src/utils/glob.ts'),
    ('src_utils_swarm_teammateInit_ts', 'src/utils/swarm/teammateInit.ts'),
    ('src_utils_sessionTitle_ts', 'src/utils/sessionTitle.ts'),
    ('src_utils_swarm_backends_detection_ts', 'src/utils/swarm/backends/detection.ts'),
    ('src_utils_bash_shellQuoting_ts', 'src/utils/bash/shellQuoting.ts'),
    ('src_utils_ultraplan_keyword_ts', 'src/utils/ultraplan/keyword.ts'),
    ('src_utils_permissions_PermissionPromptToolResultSchema_ts', 'src/utils/permissions/PermissionPromptToolResultSchema.ts'),
    ('src_utils_plugins_pluginBlocklist_ts', 'src/utils/plugins/pluginBlocklist.ts'),
]

VALID_POS = {'before', 'after', 'after_block'}
errors = []
total_ann = 0


def load_module(slug):
    name = slug + '_p1.py'
    path = os.path.join(ANNOT_DIR, name)
    if not os.path.exists(path):
        errors.append('MISSING data file: %s' % name)
        return None
    spec = importlib.util.spec_from_file_location(name[:-3], path)
    mod = importlib.util.module_from_spec(spec)
    try:
        spec.loader.exec_module(mod)
    except Exception as e:  # noqa: BLE001
        errors.append('IMPORT FAIL %s: %r' % (name, e))
        return None
    return mod


for slug, rel in TARGETS:
    # slug 推导一致性
    expected = rel.replace('/', '_').replace('.', '_').replace('-', '_')
    if expected != slug:
        errors.append('SLUG MISMATCH: %s != expected %s' % (slug, expected))

    src = os.path.join(SOURCE_DIR, rel)
    if not os.path.exists(src):
        errors.append('SOURCE MISSING: %s' % rel)
        continue
    with open(src, 'r', encoding='utf-8') as f:
        content = f.read()
    lines = content.split('\n')
    if lines and lines[-1] == '':
        lines = lines[:-1]
    n = len(lines)

    mod = load_module(slug)
    if mod is None:
        continue
    if not hasattr(mod, 'ANNOTATIONS'):
        errors.append('NO ANNOTATIONS in %s' % slug)
        continue
    anns = mod.ANNOTATIONS
    total_ann += len(anns)
    seen = set()
    for tup in anns:
        if not (isinstance(tup, tuple) and len(tup) == 3):
            errors.append('%s: bad tuple %r' % (slug, tup))
            continue
        ln, pos, text = tup
        if pos not in VALID_POS:
            errors.append('%s line %s: bad pos %r' % (slug, ln, pos))
        if not isinstance(ln, int) or not (1 <= ln <= n):
            errors.append('%s: line %s out of range [1,%d]' % (slug, ln, n))
        key = (ln, pos)
        if key in seen:
            errors.append('%s: duplicate anchor %r' % (slug, key))
        seen.add(key)
        if '"' in text or '\\' in text:
            errors.append('%s line %s: forbidden char in text -> %r' % (slug, ln, text[:40]))

    # ast.parse 整文件
    import ast
    with open(os.path.join(ANNOT_DIR, slug + '_p1.py'), 'r', encoding='utf-8') as f:
        try:
            ast.parse(f.read())
        except SyntaxError as e:
            errors.append('AST FAIL %s: %s' % (slug, e))

print('目标文件数: %d' % len(TARGETS))
print('锚点总数: %d' % total_ann)
if errors:
    print('==== 预检失败 ====')
    for e in errors:
        print(' -', e)
    sys.exit(1)
print('==== 预检全部通过 ====')
