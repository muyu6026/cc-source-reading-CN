# -*- coding: utf-8 -*-
"""第 84 批数据文件预检：结构、行号、锚点位置、文本字符、块注释内部。"""
import ast
import importlib.util
import io
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
ANNOT = os.path.join(ROOT, 'scripts', '_annot')

FILES = [
    'src/utils/intl.ts',
    'src/utils/backgroundHousekeeping.ts',
    'src/utils/settings/applySettingsChange.ts',
    'src/utils/sliceAnsi.ts',
    'src/utils/sanitization.ts',
    'src/utils/bash/specs/pyright.ts',
    'src/utils/idePathConversion.ts',
    'src/utils/undercover.ts',
    'src/utils/execFileNoThrowPortable.ts',
    'src/utils/caCertsConfig.ts',
]

POS = {'before', 'after', 'after_block'}
errors = []
total_anchors = 0


def slug_of(rel):
    return rel.replace('/', '_').replace('.', '_').replace('-', '_') + '_p1'


def block_interior(lines):
    inside = set()
    open_at = None
    for i, line in enumerate(lines, start=1):
        s = line.strip()
        if open_at is None:
            if s.startswith('/*') and not s.endswith('*/'):
                open_at = i
        else:
            if s.endswith('*/'):
                open_at = None
                continue
            inside.add(i)
    return inside


for rel in FILES:
    src = os.path.join(ROOT, 'source', rel)
    if not os.path.exists(src):
        errors.append('源文件不存在: %s' % rel)
        continue
    lines = io.open(src, encoding='utf-8', newline='').read().split('\n')
    while lines and lines[-1] == '':
        lines.pop()
    n = len(lines)

    slug = slug_of(rel)
    data = os.path.join(ANNOT, slug + '.py')
    if not os.path.exists(data):
        errors.append('数据文件不存在: %s.py' % slug)
        continue

    try:
        ast.parse(io.open(data, encoding='utf-8').read())
    except SyntaxError as e:
        errors.append('%s 语法错误: %s' % (slug, e))
        continue

    spec = importlib.util.spec_from_file_location(slug, data)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    ann = list(getattr(mod, 'ANNOTATIONS', []))

    seen = set()
    inside = block_interior(lines)
    for item in ann:
        if not (isinstance(item, tuple) and len(item) == 3):
            errors.append('%s 条目形状错误: %r' % (slug, item))
            continue
        lineno, pos, text = item
        if pos not in POS:
            errors.append('%s 位置非法 %r (行 %r)' % (slug, pos, lineno))
        if not (isinstance(lineno, int) and 1 <= lineno <= n):
            errors.append('%s 行号越界 %r (共 %d 行)' % (slug, lineno, n))
            continue
        if (lineno, pos) in seen:
            errors.append('%s 重复锚点 (%d, %s)' % (slug, lineno, pos))
        seen.add((lineno, pos))
        if '"' in text:
            errors.append('%s 行 %d 文本含英文双引号' % (slug, lineno))
        if '\\' in text:
            errors.append('%s 行 %d 文本含反斜杠' % (slug, lineno))
        if lineno in inside:
            errors.append('%s 行 %d 落在块注释内部' % (slug, lineno))
    total_anchors += len(ann)
    print('%-58s %3d 行源 / %2d 锚点' % (rel, n, len(ann)))

print('')
if errors:
    print('预检失败 %d 项:' % len(errors))
    for e in errors:
        print('  - ' + e)
    sys.exit(1)
print('预检通过：%d 个文件，%d 个锚点' % (len(FILES), total_anchors))
