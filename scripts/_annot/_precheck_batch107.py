# -*- coding: utf-8 -*-
# 第 107 批预检：slug 对应、pos 合法、行号范围、重复锚点、禁字符、数据文件 ast.parse
import ast
import importlib.util
import os
import sys

FILES = [
    ('src/components/CustomSelect/select.tsx', 'src_components_CustomSelect_select_tsx'),
    ('src/components/CustomSelect/use-select-navigation.ts', 'src_components_CustomSelect_use-select-navigation_ts'),
    ('src/components/tasks/BackgroundTasksDialog.tsx', 'src_components_tasks_BackgroundTasksDialog_tsx'),
    ('src/components/mcp/MCPRemoteServerMenu.tsx', 'src_components_mcp_MCPRemoteServerMenu_tsx'),
]

fail = 0
total = 0
for rel, slug in FILES:
    src_path = os.path.join('source', rel)
    data_path = f'scripts/_annot/{slug}_p1.py'
    if not os.path.isfile(src_path):
        print(f'FAIL {rel}: source missing')
        fail += 1
        continue
    if not os.path.isfile(data_path):
        print(f'FAIL {rel}: data file missing')
        fail += 1
        continue
    with open(src_path, encoding='utf-8') as f:
        src_text = f.read()
    src_lines = src_text.split('\n')
    nlines = len(src_lines)
    with open(data_path, encoding='utf-8') as f:
        data_text = f.read()
    try:
        ast.parse(data_text)
    except SyntaxError as e:
        print(f'FAIL {data_path}: ast.parse error {e}')
        fail += 1
        continue
    spec = importlib.util.spec_from_file_location(slug, data_path)
    mod = importlib.util.module_from_spec(spec)
    try:
        spec.loader.exec_module(mod)
    except Exception as e:
        print(f'FAIL {data_path}: load error {e}')
        fail += 1
        continue
    anns = getattr(mod, 'ANNOTATIONS', None)
    if not isinstance(anns, list):
        print(f'FAIL {data_path}: ANNOTATIONS not list')
        fail += 1
        continue
    seen = set()
    n = len(anns)
    total += n
    for item in anns:
        if not (isinstance(item, tuple) and len(item) in (3,)):
            print(f'FAIL {data_path}: bad tuple {item!r}')
            fail += 1
            continue
        ln, pos, txt = item
        if pos not in ('before', 'after', 'after_block'):
            print(f'FAIL {data_path}: bad pos {pos} at line {ln}')
            fail += 1
        if not (1 <= ln <= nlines):
            print(f'FAIL {data_path}: line {ln} out of range 1..{nlines}')
            fail += 1
        if (ln, pos) in seen:
            print(f'FAIL {data_path}: duplicate anchor ({ln},{pos})')
            fail += 1
        seen.add((ln, pos))
        if '"' in txt or '\\' in txt:
            print(f'FAIL {data_path}: forbidden char in text at line {ln}')
            fail += 1
        # 块注释内部检测：锚点行不能位于 /* */ 块的严格内部（首行/尾行豁免）
        if 1 <= ln <= len(src_lines):
            depth = 0
            for i in range(ln - 1):
                line = src_lines[i]
                j = 0
                while j < len(line):
                    if depth == 0 and line.startswith('/*', j):
                        depth += 1
                        j += 2
                    elif depth > 0 and line.startswith('*/', j):
                        depth -= 1
                        j += 2
                    else:
                        j += 1
            if depth > 0:
                cur = src_lines[ln - 1]
                if '/*' not in cur and '*/' not in cur:
                    print(f'FAIL {data_path}: anchor line {ln} inside block comment')
                    fail += 1
    print(f'OK {slug}: {n} anchors, source {nlines} lines')
print(f'TOTAL {total} anchors, {fail} failures')
sys.exit(1 if fail else 0)
