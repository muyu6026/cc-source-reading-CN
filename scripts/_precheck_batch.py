#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""批处理预检：加载本批每个数据文件并做完整性校验。"""
import importlib.util
import os
import sys
import ast

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ANNOT_DIR = os.path.join(ROOT, 'scripts', '_annot')
SRC_DIR = os.path.join(ROOT, 'source')

# (slug, rel_path)
PAIRS = [
    ('src_commands_passes_passes_tsx', 'src/commands/passes/passes.tsx'),
    ('src_commands_statusline_tsx', 'src/commands/statusline.tsx'),
    ('src_commands_context_index_ts', 'src/commands/context/index.ts'),
    ('src_commands_cost_cost_ts', 'src/commands/cost/cost.ts'),
    ('src_commands_terminalSetup_index_ts', 'src/commands/terminalSetup/index.ts'),
    ('src_plugins_bundled_index_ts', 'src/plugins/bundled/index.ts'),
    ('src_commands_cost_index_ts', 'src/commands/cost/index.ts'),
    ('src_replLauncher_tsx', 'src/replLauncher.tsx'),
    ('src_migrations_migrateReplBridgeEnabledToRemoteControlAtStartup_ts', 'src/migrations/migrateReplBridgeEnabledToRemoteControlAtStartup.ts'),
    ('src_commands_version_ts', 'src/commands/version.ts'),
    ('src_costHook_ts', 'src/costHook.ts'),
    ('src_commands_passes_index_ts', 'src/commands/passes/index.ts'),
    ('src_commands_voice_index_ts', 'src/commands/voice/index.ts'),
    ('src_commands_remote_setup_index_ts', 'src/commands/remote-setup/index.ts'),
    ('src_commands_files_files_ts', 'src/commands/files/files.ts'),
]

POS = {'before', 'after', 'after_block'}
FORBIDDEN = ('"', '\\')
errors = 0


def load(slug):
    path = os.path.join(ANNOT_DIR, slug + '_p1.py')
    spec = importlib.util.spec_from_file_location(slug, path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return path, mod


for slug, rel in PAIRS:
    # slug 与 rel 一一对应
    expect = rel.replace('/', '_').replace('.', '_').replace('-', '_')
    if slug != expect:
        print(f'✗ slug 不匹配: {slug} != {expect} (来自 {rel})')
        errors += 1
        continue
    src = os.path.join(SRC_DIR, rel)
    if not os.path.exists(src):
        print(f'✗ 源文件不存在: {src}')
        errors += 1
        continue
    with open(src, encoding='utf-8') as f:
        nlines = sum(1 for _ in f)
    path, mod = load(slug)
    # ast.parse 整文件
    try:
        with open(path, encoding='utf-8') as f:
            ast.parse(f.read())
    except SyntaxError as e:
        print(f'✗ ast.parse 失败 {slug}: {e}')
        errors += 1
        continue
    anns = mod.ANNOTATIONS
    seen = set()
    for tup in anns:
        if not (isinstance(tup, tuple) and len(tup) == 3):
            print(f'✗ 锚点格式错误 {slug}: {tup!r}')
            errors += 1
            continue
        ln, pos, text = tup
        if pos not in POS:
            print(f'✗ pos 非法 {slug} 行{ln}: {pos}')
            errors += 1
        if not (1 <= ln <= nlines):
            print(f'✗ 行号越界 {slug}: {ln} (文件 {nlines} 行)')
            errors += 1
        if any(ch in text for ch in FORBIDDEN):
            print(f'✗ 含禁字符 {slug} 行{ln}: {text[:30]!r}')
            errors += 1
        key = (ln, pos)
        if key in seen:
            print(f'✗ 重复锚点 {slug}: {key}')
            errors += 1
        seen.add(key)

print(f'\n共 {len(PAIRS)} 个数据文件，锚点总数 {sum(len(load(s)[1].ANNOTATIONS) for s,_ in PAIRS)}')
print('预检通过 ✅' if errors == 0 else f'预检发现 {errors} 处错误 ❌')
sys.exit(1 if errors else 0)
