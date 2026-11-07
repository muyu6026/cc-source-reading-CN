#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""第 178 批预检：校验 15 个 commands 批注数据文件。

断言项：
  · slug 与源文件路径一一对应（由 rel 反推 slug 应相等）
  · pos ∈ {before, after, after_block}
  · 1 ≤ 行号 ≤ 源文件行数
  · 无重复锚点 (行号, pos)
  · 文本不含英文双引号 " 与反斜杠 \
  · 整文件 ast.parse 通过
"""
import ast
import io
import os
import sys
import importlib.util

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ANNOT_DIR = os.path.join(ROOT, 'scripts', '_annot')

# (相对路径, slug) —— 本批 15 份
PAIRS = [
    ('src/commands/release-notes/index.ts', 'src_commands_release_notes_index_ts'),
    ('src/commands/stickers/index.ts', 'src_commands_stickers_index_ts'),
    ('src/commands/tasks/index.ts', 'src_commands_tasks_index_ts'),
    ('src/commands/logout/index.ts', 'src_commands_logout_index_ts'),
    ('src/commands/theme/index.ts', 'src_commands_theme_index_ts'),
    ('src/commands/memory/index.ts', 'src_commands_memory_index_ts'),
    ('src/commands/help/index.ts', 'src_commands_help_index_ts'),
    ('src/commands/agents/index.ts', 'src_commands_agents_index_ts'),
    ('src/commands/stats/index.ts', 'src_commands_stats_index_ts'),
    ('src/commands/skills/index.ts', 'src_commands_skills_index_ts'),
    ('src/commands/permissions/permissions.tsx', 'src_commands_permissions_permissions_tsx'),
    ('src/commands/desktop/desktop.tsx', 'src_commands_desktop_desktop_tsx'),
    ('src/commands/usage/index.ts', 'src_commands_usage_index_ts'),
    ('src/commands/diff/diff.tsx', 'src_commands_diff_diff_tsx'),
    ('src/commands/skills/skills.tsx', 'src_commands_skills_skills_tsx'),
]

POS = {'before', 'after', 'after_block'}
errors = []
total_ann = 0


def src_line_count(rel):
    p = os.path.join(ROOT, 'source', rel)
    with io.open(p, encoding='utf-8', newline='') as f:
        return len(f.read().split('\n'))


def load(rel):
    slug = rel.replace('/', '_').replace('.', '_').replace('-', '_')
    path = os.path.join(ANNOT_DIR, slug + '_p1.py')
    spec = importlib.util.spec_from_file_location(slug, path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return slug, mod.ANNOTATIONS


for rel, expected_slug in PAIRS:
    slug, ann = load(rel)
    if slug != expected_slug:
        errors.append('slug 不匹配: 期望 %s 实得 %s (rel=%s)' % (expected_slug, slug, rel))
    # ast.parse 整文件
    path = os.path.join(ANNOT_DIR, slug + '_p1.py')
    try:
        ast.parse(io.open(path, encoding='utf-8').read())
    except SyntaxError as e:
        errors.append('%s ast.parse 失败: %s' % (slug, e))
    n = src_line_count(rel)
    seen = set()
    for lineno, pos, text in ann:
        total_ann += 1
        if pos not in POS:
            errors.append('%s 非法 pos: %r' % (slug, pos))
        if not (1 <= lineno <= n):
            errors.append('%s 行号越界: %d (文件 %d 行)' % (slug, lineno, n))
        if (lineno, pos) in seen:
            errors.append('%s 重复锚点: (%d,%s)' % (slug, lineno, pos))
        seen.add((lineno, pos))
        if '"' in text or '\\' in text:
            errors.append('%s 含禁字符（" 或 \\）: 行 %d' % (slug, lineno))

print('校验 %d 个数据文件，%d 处锚点。' % (len(PAIRS), total_ann))
if errors:
    print('❌ 发现 %d 处问题：' % len(errors))
    for e in errors:
        print('  -', e)
    sys.exit(1)
print('✅ 预检全部通过（slug 对应、pos、行界、重复、禁字符、ast.parse）。')
