#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""批注数据文件预检：在真正注入前校验结构合法性。

用法：
    python scripts/_annot/_precheck.py src/utils/worktree.ts src/utils/... [ ... ]

校验项：
    · 每个相对路径能定位到 scripts/_annot/<slug>_p*.py（slug↔source 一一对应）
    · 每个 ANNOTATIONS 元素是 (int, str, str)
    · pos ∈ {before, after, after_block}
    · 1 ≤ line ≤ 源文件行数
    · 同一文件内 (line, pos) 不重复
    · 批注文本不含 " 与 \（会破坏 ast.parse 与渲染）
    · 整个数据文件能 ast.parse 通过
"""
import ast
import importlib.util
import io
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
ANNOT_DIR = os.path.join(ROOT, 'scripts', '_annot')
VALID_POS = {'before', 'after', 'after_block'}


def source_lines(rel):
    p = os.path.join(ROOT, 'source', rel)
    with io.open(p, encoding='utf-8', newline='') as f:
        return f.read().split('\n')


def main():
    rels = sys.argv[1:]
    if not rels:
        raise SystemExit('用法: python scripts/_annot/_precheck.py <relpath> [...]')
    slugs_seen = {}
    ok = True
    for rel in rels:
        slug = rel.replace('/', '_').replace('.', '_').replace('-', '_')
        if slug in slugs_seen:
            print('✗ slug 冲突：%s 同时对应 %s 与 %s' % (slug, slugs_seen[slug], rel))
            ok = False
            continue
        slugs_seen[slug] = rel

        candidates = sorted(
            f for f in os.listdir(ANNOT_DIR)
            if f.startswith(slug + '_p') and f.endswith('.py')
        )
        if not candidates:
            print('✗ 找不到批注数据：%s_p*.py（%s）' % (slug, rel))
            ok = False
            continue

        lines = source_lines(rel)
        n = len(lines)
        seen = set()
        total = 0
        for name in candidates:
            path = os.path.join(ANNOT_DIR, name)
            # 整文件 ast.parse
            with io.open(path, encoding='utf-8') as f:
                src = f.read()
            try:
                ast.parse(src)
            except SyntaxError as e:
                print('✗ %s 语法错误：%s' % (name, e))
                ok = False
                continue
            spec = importlib.util.spec_from_file_location(name[:-3], path)
            mod = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(mod)
            for item in mod.ANNOTATIONS:
                total += 1
                if not (isinstance(item, tuple) and len(item) == 3):
                    print('✗ %s 元素格式错误：%r' % (name, item))
                    ok = False
                    continue
                line, pos, text = item
                if not isinstance(line, int) or not isinstance(pos, str) or not isinstance(text, str):
                    print('✗ %s 元素类型错误：%r' % (name, item))
                    ok = False
                    continue
                if pos not in VALID_POS:
                    print('✗ %s 非法 pos=%r（行 %d）' % (name, pos, line))
                    ok = False
                if line < 1 or line > n:
                    print('✗ %s 行号越界：%d（文件 %d 行）' % (name, line, n))
                    ok = False
                key = (line, pos)
                if key in seen:
                    print('✗ %s 重复锚点：(%d, %s)' % (name, line, pos))
                    ok = False
                seen.add(key)
                if '"' in text or '\\' in text:
                    print('✗ %s 批注含非法字符 " 或 \\（行 %d）：%s'
                          % (name, line, text[:40]))
                    ok = False
        print('· %s → %d 个锚点，源文件 %d 行，%s'
              % (rel, total, n, '通过' if ok else '存在问题'))
    if not ok:
        raise SystemExit('预检未通过')
    print('✓ 全部预检通过')


if __name__ == '__main__':
    main()
