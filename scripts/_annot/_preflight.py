#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Step-5 预检：importlib 加载每个数据文件，断言格式与边界。"""
import ast
import glob
import importlib.util
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SRC = os.path.join(ROOT, 'source')
ANNOT_DIR = os.path.join(ROOT, 'scripts', '_annot')

TARGETS = [
    'src/utils/listSessionsImpl.ts',
    'src/utils/task/diskOutput.ts',
    'src/utils/hooks/sessionHooks.ts',
    'src/utils/plugins/officialMarketplaceStartupCheck.ts',
    'src/utils/betas.ts',
    'src/utils/statsCache.ts',
    'src/utils/nativeInstaller/pidLock.ts',
    'src/utils/tmuxSocket.ts',
    'src/utils/proxy.ts',
    'src/utils/imagePaste.ts',
    'src/utils/plugins/zipCache.ts',
    'src/utils/claudeInChrome/setup.ts',
    'src/utils/hooks/hooksConfigManager.ts',
    'src/utils/plugins/pluginOptionsStorage.ts',
    'src/utils/plans.ts',
]

VALID_POS = {'before', 'after', 'after_block'}


def line_count(path):
    with open(path, 'r', encoding='utf-8') as f:
        return sum(1 for _ in f)


def main():
    ok = 0
    fail = 0
    for rel in TARGETS:
        slug = rel.replace('/', '_').replace('.', '_').replace('-', '_')
        cands = sorted(
            f for f in os.listdir(ANNOT_DIR)
            if f.startswith(slug + '_p') and f.endswith('.py')
        )
        if not cands:
            print('  FAIL  %s — 找不到数据文件 %s_p*.py' % (rel, slug))
            fail += 1
            continue
        src_path = os.path.join(SRC, rel)
        if not os.path.exists(src_path):
            print('  FAIL  %s — source 不存在' % rel)
            fail += 1
            continue
        total = line_count(src_path)
        items = []
        errs = []
        for name in cands:
            p = os.path.join(ANNOT_DIR, name)
            try:
                src_text = open(p, encoding='utf-8').read()
                ast.parse(src_text)
            except SyntaxError as e:
                errs.append('%s: ast.parse 失败 %s' % (name, e))
                continue
            spec = importlib.util.spec_from_file_location(name[:-3], p)
            mod = importlib.util.module_from_spec(spec)
            try:
                spec.loader.exec_module(mod)
            except Exception as e:
                errs.append('%s: 导入失败 %s' % (name, e))
                continue
            if not hasattr(mod, 'ANNOTATIONS') or not isinstance(mod.ANNOTATIONS, list):
                errs.append('%s: 缺少 ANNOTATIONS 列表' % name)
                continue
            items.extend(mod.ANNOTATIONS)
        # 边界与格式检查
        seen = set()
        for tup in items:
            if not (isinstance(tup, (list, tuple)) and len(tup) == 3):
                errs.append('元组格式应为 (line,pos,text)：%r' % (tup,))
                continue
            line, pos, text = tup
            if pos not in VALID_POS:
                errs.append('非法 pos=%r @line%d' % (pos, line))
            if not (isinstance(line, int) and 1 <= line <= total):
                errs.append('行号越界 %d（文件 %d 行）' % (line, total))
            if not isinstance(text, str):
                errs.append('text 非字符串 @line%d' % line)
            else:
                if '"' in text:
                    errs.append('含双引号 @line%d' % line)
                if '\\' in text:
                    errs.append('含反斜杠 @line%d' % line)
            if line in seen:
                errs.append('重复锚点行号 %d' % line)
            seen.add(line)
        if errs:
            fail += 1
            print('  FAIL  %s（%d 锚点）' % (rel, len(items)))
            for e in errs[:12]:
                print('        · ' + e)
        else:
            ok += 1
            print('  OK    %-52s slug=%s  锚点 %2d  源 %d 行' % (rel, slug, len(items), total))
    print('\n预检 %d 个文件：通过 %d · 失败 %d' % (len(TARGETS), ok, fail))
    sys.exit(1 if fail else 0)


if __name__ == '__main__':
    main()
