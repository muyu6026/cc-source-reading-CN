#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""批注数据文件预检（第 90 批）。"""
import ast
import io
import os
import sys
import importlib.util

ROOT = 'D:/CC泄露源码分析'
ANNOT_DIR = os.path.join(ROOT, 'scripts', '_annot')

PAIRS = [
    ('src_utils_browser_ts', 'src/utils/browser.ts'),
    ('src_utils_process_ts', 'src/utils/process.ts'),
    ('src_utils_hooks_registerFrontmatterHooks_ts', 'src/utils/hooks/registerFrontmatterHooks.ts'),
    ('src_utils_xdg_ts', 'src/utils/xdg.ts'),
    ('src_utils_sessionUrl_ts', 'src/utils/sessionUrl.ts'),
    ('src_utils_model_antModels_ts', 'src/utils/model/antModels.ts'),
    ('src_utils_hooks_registerSkillHooks_ts', 'src/utils/hooks/registerSkillHooks.ts'),
    ('src_utils_computerUse_common_ts', 'src/utils/computerUse/common.ts'),
    ('src_utils_permissions_bashClassifier_ts', 'src/utils/permissions/bashClassifier.ts'),
    ('src_utils_settings_pluginOnlyPolicy_ts', 'src/utils/settings/pluginOnlyPolicy.ts'),
]

POS_OK = {'before', 'after', 'after_block'}


def load(path):
    spec = importlib.util.spec_from_file_location('mod_' + str(abs(hash(path))), path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod.ANNOTATIONS


def block_interior_lines(src_lines):
    """返回「块注释内部续行」与「块注释闭合行 */」集合。"""
    interior = set()
    closing = set()
    in_block = False
    for i, line in enumerate(src_lines, 1):
        has_open = '/*' in line
        has_close = '*/' in line
        if in_block and not has_close:
            # 整行处于块注释内部（续行）
            interior.add(i)
        elif in_block and has_close:
            closing.add(i)
        if has_open:
            in_block = True
        if has_close:
            in_block = False
    return interior, closing


def main():
    total_fail = 0
    total_anchors = 0
    for slug, rel in PAIRS:
        fpath = os.path.join(ANNOT_DIR, slug + '_p1.py')
        if not os.path.exists(fpath):
            print('MISSING DATA', slug)
            total_fail += 1
            continue
        src_path = os.path.join(ROOT, 'source', rel)
        with open(src_path, 'r', encoding='utf-8') as fh:
            src_lines = fh.read().splitlines()
        n = len(src_lines)
        try:
            anns = load(fpath)
        except Exception as e:  # noqa
            print('LOAD ERROR', slug, e)
            total_fail += 1
            continue
        # ast.parse
        try:
            with open(fpath, 'r', encoding='utf-8') as fh:
                ast.parse(fh.read())
        except SyntaxError as e:
            print('AST FAIL', slug, e)
            total_fail += 1
            continue
        interior, closing = block_interior_lines(src_lines)
        seen = set()
        fails = 0
        for tup in anns:
            total_anchors += 1
            if len(tup) != 3:
                print('BAD TUPLE', slug, tup)
                fails += 1
                continue
            line, pos, text = tup
            if pos not in POS_OK:
                print('BAD POS', slug, line, pos)
                fails += 1
            if not (1 <= line <= n):
                print('BAD LINE', slug, line, 'max', n)
                fails += 1
            if (line, pos) in seen:
                print('DUP ANCHOR', slug, line, pos)
                fails += 1
            seen.add((line, pos))
            if '"' in text or '\\' in text:
                print('QUOTE/BACKSLASH', slug, line, repr(text[:30]))
                fails += 1
            if line in interior:
                print('BLOCK INTERIOR', slug, line)
                fails += 1
            if pos == 'after' and line in closing:
                print('AFTER ON CLOSING */', slug, line)
                fails += 1
        if fails:
            total_fail += fails
            print('  -> %s: %d problems' % (slug, fails))
        else:
            print('OK', slug, '%d anchors' % len(anns))
    print('==== total anchors=%d  fails=%d ====' % (total_anchors, total_fail))
    sys.exit(1 if total_fail else 0)


if __name__ == '__main__':
    main()
