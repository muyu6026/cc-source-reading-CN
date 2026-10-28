#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""批 67 预检：逐文件加载批注数据并断言。

- slug 与源文件路径一一对应
- pos ∈ {before, after, after_block}
- 1 <= 行号 <= 源文件行数
- 无重复锚点 (行号, pos)
- 文本无英文双引号 " 和反斜杠 \
- ast.parse 整文件通过
"""
import ast
import io
import os
import importlib.util
import sys

ROOT = 'D:/CC泄露源码分析'
ANNOT_DIR = os.path.join(ROOT, 'scripts', '_annot')

# (相对路径, slug) 一一对应
TARGETS = [
    ('src/utils/suggestions/directoryCompletion.ts', 'src_utils_suggestions_directoryCompletion_ts'),
    ('src/utils/claudeInChrome/toolRendering.tsx', 'src_utils_claudeInChrome_toolRendering_tsx'),
    ('src/utils/settings/permissionValidation.ts', 'src_utils_settings_permissionValidation_ts'),
    ('src/utils/tokens.ts', 'src_utils_tokens_ts'),
    ('src/utils/bash/shellCompletion.ts', 'src_utils_bash_shellCompletion_ts'),
    ('src/utils/shell/bashProvider.ts', 'src_utils_shell_bashProvider_ts'),
    ('src/utils/telemetry/bigqueryExporter.ts', 'src_utils_telemetry_bigqueryExporter_ts'),
    ('src/utils/permissions/permissionExplainer.ts', 'src_utils_permissions_permissionExplainer_ts'),
    ('src/utils/sessionFileAccessHooks.ts', 'src_utils_sessionFileAccessHooks_ts'),
    ('src/utils/swarm/backends/it2Setup.ts', 'src_utils_swarm_backends_it2Setup_ts'),
]

POS = {'before', 'after', 'after_block'}


def source_line_count(rel):
    p = os.path.join(ROOT, 'source', rel)
    if not os.path.exists(p):
        return None
    text = io.open(p, encoding='utf-8', newline='').read()
    lines = [ln[:-1] if ln.endswith('\r') else ln for ln in text.split('\n')]
    return len(lines) - 1 if lines and lines[-1] == '' else len(lines)


def load(rel, slug):
    # 允许 _p1/_p2 分片
    cands = sorted(f for f in os.listdir(ANNOT_DIR)
                   if f.startswith(slug + '_p') and f.endswith('.py'))
    if not cands:
        raise SystemExit('找不到数据文件: %s_p*.py' % slug)
    items = []
    for name in cands:
        path = os.path.join(ANNOT_DIR, name)
        spec = importlib.util.spec_from_file_location(name[:-3], path)
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        items.extend(mod.ANNOTATIONS)
    return cands, items


def main():
    total_ok = 0
    total_anchors = 0
    for rel, slug in TARGETS:
        # slug 与路径对应
        expect = rel.replace('/', '_').replace('.', '_').replace('-', '_')
        if expect != slug:
            print('  ✗ slug 不匹配: %s 期望 %s 实际 %s' % (rel, expect, slug))
            sys.exit(1)
        cands, items = load(rel, slug)
        # ast.parse 整文件
        for name in cands:
            src = io.open(os.path.join(ANNOT_DIR, name), encoding='utf-8').read()
            try:
                ast.parse(src)
            except SyntaxError as e:
                print('  ✗ ast.parse 失败 %s: %s' % (name, e))
                sys.exit(1)
        n = source_line_count(rel)
        if n is None:
            print('  ✗ 源文件不存在: %s' % rel)
            sys.exit(1)
        seen = set()
        for tup in items:
            if not (isinstance(tup, tuple) and len(tup) == 3):
                print('  ✗ 条目格式错误 %s: %r' % (slug, tup))
                sys.exit(1)
            ln, pos, txt = tup
            if pos not in POS:
                print('  ✗ 非法 pos %s 文件 %s 行 %s' % (pos, slug, ln))
                sys.exit(1)
            if not (1 <= ln <= n):
                print('  ✗ 行号越界 %s 行 %d (文件共 %d 行)' % (slug, ln, n))
                sys.exit(1)
            if (ln, pos) in seen:
                print('  ✗ 重复锚点 %s 行 %d pos %s' % (slug, ln, pos))
                sys.exit(1)
            seen.add((ln, pos))
            if '"' in txt or '\\' in txt:
                print('  ✗ 文本含非法字符("或\\) %s 行 %d: %r' % (slug, ln, txt[:40]))
                sys.exit(1)
        total_anchors += len(items)
        total_ok += 1
        print('  ✓ %-55s 行数 %3d  锚点 %2d' % (rel, n, len(items)))
    print('\n预检通过：%d/%d 文件，共 %d 锚点' % (total_ok, len(TARGETS), total_anchors))


if __name__ == '__main__':
    main()
