#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""预检第 177 批 15 个数据文件的合法性与锚点。"""
import os
import ast
import importlib.util

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ANNOT_DIR = os.path.join(ROOT, 'scripts', '_annot')
SOURCE_DIR = os.path.join(ROOT, 'source')

# slug -> source/src 下相对路径（与 annotate.py 调用口径一致）
MAP = {
    'src_commands_exit_index_ts': 'src/commands/exit/index.ts',
    'src_commands_rename_index_ts': 'src/commands/rename/index.ts',
    'src_commands_mcp_index_ts': 'src/commands/mcp/index.ts',
    'src_commands_tag_index_ts': 'src/commands/tag/index.ts',
    'src_commands_status_index_ts': 'src/commands/status/index.ts',
    'src_commands_doctor_index_ts': 'src/commands/doctor/index.ts',
    'src_constants_turnCompletionVerbs_ts': 'src/constants/turnCompletionVerbs.ts',
    'src_commands_heapdump_index_ts': 'src/commands/heapdump/index.ts',
    'src_commands_files_index_ts': 'src/commands/files/index.ts',
    'src_commands_install_slack_app_index_ts': 'src/commands/install-slack-app/index.ts',
    'src_commands_agents_agents_tsx': 'src/commands/agents/agents.tsx',
    'src_commands_resume_index_ts': 'src/commands/resume/index.ts',
    'src_commands_permissions_index_ts': 'src/commands/permissions/index.ts',
    'src_commands_plugin_index_tsx': 'src/commands/plugin/index.tsx',
    'src_commands_help_help_tsx': 'src/commands/help/help.tsx',
}

VALID_POS = {'before', 'after', 'after_block'}
errors = []


def src_lines(rel):
    p = os.path.join(SOURCE_DIR, rel)
    with open(p, encoding='utf-8', newline='') as f:
        return f.read().split('\n')


ok = 0
for slug, rel in MAP.items():
    fname = slug + '_p1.py'
    fpath = os.path.join(ANNOT_DIR, fname)
    if not os.path.exists(fpath):
        errors.append('缺少数据文件: %s' % fname)
        continue
    # ast.parse 整文件
    try:
        with open(fpath, encoding='utf-8') as f:
            ast.parse(f.read())
    except SyntaxError as e:
        errors.append('%s: ast.parse 失败: %s' % (fname, e))
        continue
    # importlib 加载
    spec = importlib.util.spec_from_file_location(slug, fpath)
    mod = importlib.util.module_from_spec(spec)
    try:
        spec.loader.exec_module(mod)
    except Exception as e:
        errors.append('%s: 加载失败: %s' % (fname, e))
        continue
    if not hasattr(mod, 'ANNOTATIONS'):
        errors.append('%s: 无 ANNOTATIONS' % fname)
        continue
    # 源文件存在 + 行数
    sp = os.path.join(SOURCE_DIR, rel)
    if not os.path.exists(sp):
        errors.append('%s: 源文件不存在 %s' % (fname, rel))
        continue
    lines = src_lines(rel)
    n = len(lines)
    if n and lines[-1] == '':
        n -= 1  # 末尾空行不计
    seen = set()
    for item in mod.ANNOTATIONS:
        if not (isinstance(item, tuple) and len(item) == 3):
            errors.append('%s: 条目格式错误 %r' % (fname, item))
            continue
        ln, pos, text = item
        if pos not in VALID_POS:
            errors.append('%s: 非法 pos %r (行 %s)' % (fname, pos, ln))
        if not (isinstance(ln, int) and 1 <= ln <= n):
            errors.append('%s: 行号越界 %s (文件 %d 行)' % (fname, ln, n))
        if (ln, pos) in seen:
            errors.append('%s: 重复锚点 (%s,%s)' % (fname, ln, pos))
        seen.add((ln, pos))
        if '"' in text or '\\' in text:
            errors.append('%s: 文本含禁用字符 (行 %s): %r' % (fname, ln, text[:30]))
    print('  ✓ %-44s %2d 锚点 / 源 %d 行' % (fname, len(mod.ANNOTATIONS), n))
    ok += 1

print('\n数据文件校验通过 %d/%d' % (ok, len(MAP)))
if errors:
    print('❌ 错误：')
    for e in errors:
        print('  -', e)
    raise SystemExit(1)
print('全部预检通过 ✅')
