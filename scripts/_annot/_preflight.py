#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""本批预检：importlib 加载 10 个数据文件，断言结构与保真度约束。"""
import ast
import importlib.util
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
ANNOT_DIR = os.path.join(ROOT, 'scripts', '_annot')

# slug -> source 相对路径（相对 source/）
MAP = {
    'src_bridge_jwtUtils_ts': 'src/bridge/jwtUtils.ts',
    'src_commands_init_ts': 'src/commands/init.ts',
    'src_cli_remoteIO_ts': 'src/cli/remoteIO.ts',
    'src_keybindings_resolver_ts': 'src/keybindings/resolver.ts',
    'src_commands_security_review_ts': 'src/commands/security-review.ts',
    'src_keybindings_KeybindingContext_tsx': 'src/keybindings/KeybindingContext.tsx',
    'src_commands_btw_btw_tsx': 'src/commands/btw/btw.tsx',
    'src_context_notifications_tsx': 'src/context/notifications.tsx',
    'src_keybindings_schema_ts': 'src/keybindings/schema.ts',
    'src_constants_oauth_ts': 'src/constants/oauth.ts',
}

VALID_POS = {'before', 'after', 'after_block'}
errors = []


def load(slug):
    path = os.path.join(ANNOT_DIR, slug + '_p1.py')
    spec = importlib.util.spec_from_file_location(slug, path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod.ANNOTATIONS


def src_lines(rel):
    with open(os.path.join(ROOT, 'source', rel), encoding='utf-8') as f:
        return f.read().split('\n')


total = 0
for slug, rel in MAP.items():
    fpath = os.path.join(ANNOT_DIR, slug + '_p1.py')
    if not os.path.exists(fpath):
        errors.append(f'[{slug}] 数据文件不存在')
        continue
    try:
        ast.parse(open(fpath, encoding='utf-8').read())
    except SyntaxError as e:
        errors.append(f'[{slug}] ast.parse 失败: {e}')
        continue
    try:
        ann = load(slug)
    except Exception as e:
        errors.append(f'[{slug}] 加载失败: {e!r}')
        continue
    lines = src_lines(rel)
    n = len(lines)
    if lines and lines[-1] == '':
        n -= 1
    seen = set()
    for entry in ann:
        if not (isinstance(entry, tuple) and len(entry) == 3):
            errors.append(f'[{slug}] 锚点格式错误: {entry!r}')
            continue
        ln, pos, text = entry
        total += 1
        if pos not in VALID_POS:
            errors.append(f'[{slug}] 非法 pos={pos} @行{ln}')
        if not (1 <= ln <= n):
            errors.append(f'[{slug}] 行号越界 {ln}（文件 {n} 行）')
        if (ln, pos) in seen:
            errors.append(f'[{slug}] 重复锚点 ({ln},{pos})')
        seen.add((ln, pos))
        if '"' in text:
            errors.append(f'[{slug}] 文本含英文双引号 @行{ln}')
        if '\\' in text:
            errors.append(f'[{slug}] 文本含反斜杠 @行{ln}')

print(f'预检完成：10 个数据文件，{total} 个锚点')
if errors:
    print(f'发现 {len(errors)} 处错误：')
    for e in errors:
        print('  -', e)
    sys.exit(1)
print('全部通过：slug 一一对应、pos 合法、行号在范围内、无重复锚点、文本无英文引号/反斜杠、ast.parse 通过')
