#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Batch 156 预检：逐个加载数据文件并做硬断言。"""
import ast
import importlib.util
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
ANNOT_DIR = os.path.join(ROOT, 'scripts', '_annot')
SRC = os.path.join(ROOT, 'source')

# (源文件相对路径, 数据文件名)
PAIRS = [
    ('src/commands/model/model.tsx', 'src_commands_model_model_tsx_p1.py'),
    ('src/commands/branch/branch.ts', 'src_commands_branch_branch_ts_p1.py'),
    ('src/memdir/teamMemPaths.ts', 'src_memdir_teamMemPaths_ts_p1.py'),
    ('src/types/hooks.ts', 'src_types_hooks_ts_p1.py'),
    ('src/commands/compact/compact.ts', 'src_commands_compact_compact_ts_p1.py'),
    ('src/upstreamproxy/upstreamproxy.ts', 'src_upstreamproxy_upstreamproxy_ts_p1.py'),
    ('src/commands/chrome/chrome.tsx', 'src_commands_chrome_chrome_tsx_p1.py'),
    ('src/skills/bundled/loremIpsum.ts', 'src_skills_bundled_loremIpsum_ts_p1.py'),
    ('src/cli/transports/HybridTransport.ts', 'src_cli_transports_HybridTransport_ts_p1.py'),
    ('src/commands/mcp/addCommand.ts', 'src_commands_mcp_addCommand_ts_p1.py'),
]

POS_OK = {'before', 'after', 'after_block'}
errors = []


def load(rel, name):
    path = os.path.join(ANNOT_DIR, name)
    spec = importlib.util.spec_from_file_location(name[:-3], path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


for rel, name in PAIRS:
    expected_slug = rel.replace('/', '_').replace('.', '_').replace('-', '_') + '_p1'
    if not name.startswith(expected_slug):
        errors.append(f'{name}: slug 与源路径不匹配（期望前缀 {expected_slug}）')
    src_path = os.path.join(SRC, rel)
    if not os.path.exists(src_path):
        errors.append(f'{rel}: source 文件不存在')
        continue
    lines = sum(1 for _ in open(src_path, encoding='utf-8'))
    try:
        mod = load(rel, name)
    except Exception as e:
        errors.append(f'{name}: 加载失败 {e!r}')
        continue
    # ast.parse 整文件
    try:
        ast.parse(open(os.path.join(ANNOT_DIR, name), encoding='utf-8').read())
    except SyntaxError as e:
        errors.append(f'{name}: ast.parse 失败 {e}')
    ann = mod.ANNOTATIONS
    seen = set()
    for tup in ann:
        if not (isinstance(tup, tuple) and len(tup) == 3):
            errors.append(f'{name}: 锚点格式错误 {tup!r}')
            continue
        ln, pos, text = tup
        if pos not in POS_OK:
            errors.append(f'{name}: pos 非法 {pos!r} @行{ln}')
        if not (1 <= ln <= lines):
            errors.append(f'{name}: 行号越界 {ln}（文件 {lines} 行）')
        if (ln, pos) in seen:
            errors.append(f'{name}: 重复锚点 ({ln},{pos})')
        seen.add((ln, pos))
        if '"' in text or '\\' in text:
            errors.append(f'{name}: 文本含禁用字符（双引号或反斜杠）@行{ln} -> {text[:30]!r}')

print('预检完成：%d 个数据文件' % len(PAIRS))
if errors:
    print('发现 %d 个问题：' % len(errors))
    for e in errors:
        print('  ✗', e)
    sys.exit(1)
print('✓ 全部通过')
