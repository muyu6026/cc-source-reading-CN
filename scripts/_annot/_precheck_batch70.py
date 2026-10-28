# -*- coding: utf-8 -*-
"""批次 70 批注数据预检：slug↔路径 1:1、pos 合法、行号在范围内、无重复锚点、文本无 " 与 \\、可 import（ast 通过）。"""
import importlib.util
import os

ROOT = 'D:/CC泄露源码分析'
ANNOT_DIR = os.path.join(ROOT, 'scripts', '_annot')

REL = [
    'src/utils/context.ts',
    'src/utils/plugins/officialMarketplaceGcs.ts',
    'src/utils/computerUse/computerUseLock.ts',
    'src/utils/plugins/refresh.ts',
    'src/utils/hooks/execPromptHook.ts',
    'src/utils/suggestions/slackChannelSuggestions.ts',
    'src/utils/mcpValidation.ts',
    'src/utils/plugins/pluginFlagging.ts',
    'src/utils/codeIndexing.ts',
    'src/utils/bash/prefix.ts',
]


def slug_of(rel):
    return rel.replace('/', '_').replace('.', '_').replace('-', '_')


def source_lines(rel):
    sp = os.path.join(ROOT, 'source', rel)
    with open(sp, encoding='utf-8') as f:
        return len(f.read().split('\n'))


def main():
    problems = []
    total = 0
    for rel in REL:
        s = slug_of(rel)
        data_file = os.path.join(ANNOT_DIR, s + '_p1.py')
        if not os.path.exists(data_file):
            problems.append('缺少数据文件: %s' % data_file)
            continue
        spec = importlib.util.spec_from_file_location(s + '_p1', data_file)
        mod = importlib.util.module_from_spec(spec)
        try:
            spec.loader.exec_module(mod)
        except Exception as e:
            problems.append('%s import 失败: %s' % (rel, e))
            continue
        ann = getattr(mod, 'ANNOTATIONS', None)
        if not isinstance(ann, list):
            problems.append('%s ANNOTATIONS 不是 list' % rel)
            continue
        nlines = source_lines(rel)
        seen = set()
        for entry in ann:
            if not (isinstance(entry, tuple) and len(entry) == 3):
                problems.append('%s 条目格式错误: %r' % (rel, entry))
                continue
            line, pos, text = entry
            if pos not in ('before', 'after'):
                problems.append('%s 行 %s pos 非法: %r' % (rel, line, pos))
            if not (isinstance(line, int) and 1 <= line <= nlines):
                problems.append('%s 行号越界: %s (文件 %d 行)' % (rel, line, nlines))
            if (line, pos) in seen:
                problems.append('%s 重复锚点: (%s,%s)' % (rel, line, pos))
            seen.add((line, pos))
            if '"' in text or '\\' in text:
                problems.append('%s 行 %s 文本含非法字符 " 或 \\' % (rel, line))
            if not isinstance(text, str) or not text.strip():
                problems.append('%s 行 %s 文本为空' % (rel, line))
        total += len(ann)
        print('  %-55s %3d 锚点 / %d 源行  OK' % (rel, len(ann), nlines))
    print('合计: %d 锚点, %d 文件' % (total, len(REL)))
    if problems:
        print('PRECHECK 失败:')
        for p in problems:
            print('  - ' + p)
        raise SystemExit(1)
    print('PRECHECK OK')


if __name__ == '__main__':
    main()
