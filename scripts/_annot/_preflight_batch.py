#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""批量预检本批 10 个数据文件。"""
import ast
import importlib.util
import io
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
ANNOT_DIR = os.path.join(ROOT, 'scripts', '_annot')

# (相对路径, slug)
PAIRS = [
    ('src/utils/theme.ts', 'src_utils_theme_ts'),
    ('src/utils/plugins/mcpPluginIntegration.ts', 'src_utils_plugins_mcpPluginIntegration_ts'),
    ('src/utils/doctorDiagnostic.ts', 'src_utils_doctorDiagnostic_ts'),
    ('src/utils/model/model.ts', 'src_utils_model_model_ts'),
    ('src/utils/handlePromptSubmit.ts', 'src_utils_handlePromptSubmit_ts'),
    ('src/utils/processUserInput/processUserInput.ts', 'src_utils_processUserInput_processUserInput_ts'),
    ('src/utils/cleanup.ts', 'src_utils_cleanup_ts'),
    ('src/utils/markdownConfigLoader.ts', 'src_utils_markdownConfigLoader_ts'),
    ('src/utils/conversationRecovery.ts', 'src_utils_conversationRecovery_ts'),
    ('src/utils/plugins/pluginInstallationHelpers.ts', 'src_utils_plugins_pluginInstallationHelpers_ts'),
]

POS = {'before', 'after', 'after_block'}
VALID = True


def load(modname):
    path = os.path.join(ANNOT_DIR, modname + '.py')
    spec = importlib.util.spec_from_file_location(modname, path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


for rel, slug in PAIRS:
    modname = slug + '_p1'
    src = os.path.join(ROOT, 'source', rel)
    with io.open(src, encoding='utf-8') as f:
        nlines = len(f.read().split('\n'))
        if nlines and f is not None:
            pass
    # 重新精确算行数（与 wc -l 对齐：去掉末尾空串）
    with io.open(src, encoding='utf-8', newline='') as f:
        raw = f.read().split('\n')
    if raw and raw[-1] == '':
        nlines = len(raw) - 1
    else:
        nlines = len(raw)

    try:
        mod = load(modname)
    except Exception as e:
        print(f'  ✗ {modname}: 加载/执行失败 -> {e!r}')
        VALID = False
        continue

    # ast 解析整文件
    try:
        with io.open(os.path.join(ANNOT_DIR, modname + '.py'), encoding='utf-8') as f:
            ast.parse(f.read())
    except SyntaxError as e:
        print(f'  ✗ {modname}: ast.parse 失败 -> {e}')
        VALID = False
        continue

    ann = mod.ANNOTATIONS
    seen = set()
    n = len(ann)
    for item in ann:
        if not (isinstance(item, tuple) and len(item) == 3):
            print(f'  ✗ {modname}: 非法条目 {item!r}')
            VALID = False
            continue
        ln, pos, text = item
        # 行号
        if not isinstance(ln, int) or not (1 <= ln <= nlines):
            print(f'  ✗ {modname}: 行号越界 {ln} (文件 {nlines} 行)')
            VALID = False
        # pos
        if pos not in POS:
            print(f'  ✗ {modname} 行 {ln}: pos={pos!r} 非法')
            VALID = False
        # 文本不含 " 或 \
        if '"' in text or '\\' in text:
            bad = [c for c in text if c in '"\\']
            print(f'  ✗ {modname} 行 {ln}: 文本含非法字符 {bad}')
            VALID = False
        # 重复锚点
        key = (ln, pos)
        if key in seen:
            print(f'  ✗ {modname}: 重复锚点 (行 {ln}, {pos})')
            VALID = False
        seen.add(key)

    print(f'  ✓ {modname}: {n} 锚点, 源文件 {nlines} 行, slug={slug}')

print()
print('预检通过 ✅' if VALID else '预检失败 ❌')
sys.exit(0 if VALID else 1)
