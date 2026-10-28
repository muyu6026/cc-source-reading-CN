#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""批注预检（第 64 批）：校验 10 份数据文件。

检查项：
  1. 文件名 slug == rel_path 推导 slug（数据文件归属正确）
  2. 每个条目是 (int, pos, str) 三元组，pos ∈ {before, after, after_block}
  3. 1 <= 行号 <= 源文件行数
  4. 同一文件内无重复行号锚点
  5. 中文文本不含英文双引号 " 与反斜杠 \
  6. 整个数据文件 ast.parse 通过
"""
import ast
import importlib.util
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
ANNOT_DIR = os.path.join(ROOT, 'scripts', '_annot')
SRC = os.path.join(ROOT, 'source')

BATCH = [
    ('src_utils_bash_shellQuote_ts', 'src/utils/bash/shellQuote.ts'),
    ('src_utils_heapDumpService_ts', 'src/utils/heapDumpService.ts'),
    ('src_utils_queryProfiler_ts', 'src/utils/queryProfiler.ts'),
    ('src_utils_pdf_ts', 'src/utils/pdf.ts'),
    ('src_utils_permissions_permissionsLoader_ts', 'src/utils/permissions/permissionsLoader.ts'),
    ('src_utils_hooks_ssrfGuard_ts', 'src/utils/hooks/ssrfGuard.ts'),
    ('src_utils_bash_bashPipeCommand_ts', 'src/utils/bash/bashPipeCommand.ts'),
    ('src_utils_claudeInChrome_mcpServer_ts', 'src/utils/claudeInChrome/mcpServer.ts'),
    ('src_utils_teleport_gitBundle_ts', 'src/utils/teleport/gitBundle.ts'),
    ('src_utils_teammate_ts', 'src/utils/teammate.ts'),
]

POS_OK = {'before', 'after', 'after_block'}
BAD_CHARS = set('"\\')


def slug_of(rel):
    return rel.replace('/', '_').replace('.', '_').replace('-', '_')


def nlines(p):
    with open(p, encoding='utf-8') as f:
        return sum(1 for _ in f)


def main():
    total = 0
    problems = 0
    for slug, rel in BATCH:
        if slug_of(rel) != slug:
            print('  ✗ slug 不匹配: %s -> %s (期望 %s)' % (rel, slug_of(rel), slug))
            problems += 1
        path = os.path.join(SRC, rel)
        if not os.path.exists(path):
            print('  ✗ 源文件不存在: %s' % path)
            problems += 1
            continue
        n = nlines(path)
        # ast.parse 整份数据文件
        data_path = os.path.join(ANNOT_DIR, slug + '_p1.py')
        if not os.path.exists(data_path):
            print('  ✗ 数据文件缺失: %s' % data_path)
            problems += 1
            continue
        src_text = open(data_path, encoding='utf-8').read()
        try:
            ast.parse(src_text)
        except SyntaxError as e:
            print('  ✗ %s ast.parse 失败: %s' % (slug, e))
            problems += 1
            continue
        # importlib 加载
        spec = importlib.util.spec_from_file_location(slug, data_path)
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        items = mod.ANNOTATIONS
        seen = set()
        file_problems = 0
        for entry in items:
            if not (isinstance(entry, tuple) and len(entry) == 3):
                print('  ✗ %s 条目格式错误: %r' % (slug, entry))
                file_problems += 1
                continue
            ln, pos, text = entry
            if not isinstance(ln, int):
                print('  ✗ %s 行号非 int: %r' % (slug, entry))
                file_problems += 1
            if pos not in POS_OK:
                print('  ✗ %s 非法 pos=%r (行 %d)' % (slug, pos, ln))
                file_problems += 1
            if ln < 1 or ln > n:
                print('  ✗ %s 行号越界 %d (文件 %d 行)' % (slug, ln, n))
                file_problems += 1
            if ln in seen:
                print('  ✗ %s 重复锚点 行 %d' % (slug, ln))
                file_problems += 1
            seen.add(ln)
            if not isinstance(text, str):
                print('  ✗ %s 文本非 str 行 %d' % (slug, ln))
                file_problems += 1
            else:
                bad = [c for c in text if c in BAD_CHARS]
                if bad:
                    print('  ✗ %s 行 %d 含禁用字符 %r: %s' % (slug, ln, bad, text[:30]))
                    file_problems += 1
        total += len(items)
        problems += file_problems
        flag = 'OK' if file_problems == 0 else 'FAIL(%d)' % file_problems
        print('  [%s] %-45s 锚点 %2d / 源 %d 行' % (flag, slug, len(items), n))
    print('=' * 60)
    print('合计 %d 个锚点，问题 %d 处' % (total, problems))
    sys.exit(1 if problems else 0)


if __name__ == '__main__':
    main()
