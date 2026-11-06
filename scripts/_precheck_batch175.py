#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""批 175 预检：加载 15 个数据文件，逐一断言格式与行界。

断言项：
  · slug 与源文件路径一一对应（数据文件名 = <slug>_p1.py）
  · pos ∈ {before, after, after_block}
  · 1 <= 行号 <= 源文件行数
  · 无重复锚点 (行号, pos)
  · 文本无英文双引号 " 与反斜杠 \
  · ast.parse 整文件通过
"""
import ast
import importlib.util
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ANNOT_DIR = os.path.join(ROOT, 'scripts', '_annot')

FILES = [
    'src/commands/rate-limit-options/index.ts',
    'src/commands/reload-plugins/index.ts',
    'src/commands/heapdump/heapdump.ts',
    'src/commands/extra-usage/extra-usage.tsx',
    'src/commands/thinkback-play/index.ts',
    'src/commands/stickers/stickers.ts',
    'src/commands/extra-usage/extra-usage-noninteractive.ts',
    'src/commands/color/index.ts',
    'src/commands/session/index.ts',
    'src/commands/model/index.ts',
    'src/commands/upgrade/index.ts',
    'src/commands/compact/index.ts',
    'src/commands/copy/index.ts',
    'src/commands/remote-env/index.ts',
    'src/constants/errorIds.ts',
]

VALID_POS = {'before', 'after', 'after_block'}


def slug_of(rel):
    return rel.replace('/', '_').replace('.', '_').replace('-', '_')


def src_lines(rel):
    p = os.path.join(ROOT, 'source', rel)
    with open(p, encoding='utf-8', newline='') as fh:
        return fh.read().split('\n')


def main():
    total = 0
    for rel in FILES:
        slug = slug_of(rel)
        name = slug + '_p1.py'
        path = os.path.join(ANNOT_DIR, name)
        if not os.path.exists(path):
            print('FAIL 缺少数据文件: %s' % name)
            sys.exit(1)
        spec = importlib.util.spec_from_file_location(name[:-3], path)
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        ann = mod.ANNOTATIONS

        # ast.parse 整文件
        src_text = open(path, encoding='utf-8').read()
        try:
            ast.parse(src_text)
        except SyntaxError as e:
            print('FAIL ast.parse 失败 %s: %s' % (name, e))
            sys.exit(1)

        lines = src_lines(rel)
        n = len(lines)
        seen = set()
        for item in ann:
            if not (isinstance(item, tuple) and len(item) == 3):
                print('FAIL 条目格式错误 %s: %r' % (name, item))
                sys.exit(1)
            lineno, pos, text = item
            if pos not in VALID_POS:
                print('FAIL pos 非法 %s: %r' % (name, item))
                sys.exit(1)
            if not (1 <= lineno <= n):
                print('FAIL 行号越界 %s: %r (文件 %d 行)' % (name, item, n))
                sys.exit(1)
            if (lineno, pos) in seen:
                print('FAIL 重复锚点 %s: %r' % (name, (lineno, pos)))
                sys.exit(1)
            seen.add((lineno, pos))
            if '"' in text or '\\' in text:
                print('FAIL 文本含禁字符 %s: %r' % (name, text))
                sys.exit(1)
        total += len(ann)
        print('OK   %-55s %2d 锚点 / 源 %d 行' % (rel, len(ann), n))
    print('=== 预检通过：%d 个文件 / %d 锚点 ===' % (len(FILES), total))


if __name__ == '__main__':
    main()
