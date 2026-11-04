#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Batch 127 预检：加载每个数据文件，断言结构与行号合法。"""
import os
import ast
import importlib.util

ROOT = 'D:/CC泄露源码分析'
ANNOT_DIR = os.path.join(ROOT, 'scripts', '_annot')

TARGETS = [
    'src/components/FeedbackSurvey/submitTranscriptShare.ts',
    'src/components/hooks/SelectHookMode.tsx',
    'src/components/LogoV2/Feed.tsx',
    'src/components/permissions/rules/RemoveWorkspaceDirectory.tsx',
    'src/components/agents/validateAgent.ts',
    'src/components/SessionBackgroundHint.tsx',
    'src/components/FeedbackSurvey/FeedbackSurveyView.tsx',
    'src/components/tasks/taskStatusUtils.tsx',
    'src/components/DevChannelsDialog.tsx',
    'src/components/permissions/WorkerPendingPermission.tsx',
    'src/components/PackageManagerAutoUpdater.tsx',
    'src/components/TeleportRepoMismatchDialog.tsx',
    'src/components/agents/new-agent-creation/wizard-steps/TypeStep.tsx',
    'src/components/ChannelDowngradeDialog.tsx',
    'src/components/FeedbackSurvey/useSurveyState.tsx',
]

POS = {'before', 'after', 'after_block'}


def slug_of(rel):
    return rel.replace('/', '_').replace('.', '_').replace('-', '_')


def main():
    errors = []
    total_ann = 0
    for rel in TARGETS:
        slug = slug_of(rel)
        fname = slug + '_p1.py'
        fpath = os.path.join(ANNOT_DIR, fname)
        if not os.path.exists(fpath):
            errors.append('MISSING %s (%s)' % (fname, rel))
            continue
        # 加载模块
        try:
            spec = importlib.util.spec_from_file_location(slug, fpath)
            mod = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(mod)
            ann = mod.ANNOTATIONS
        except Exception as e:
            errors.append('LOAD-FAIL %s: %r' % (fname, e))
            continue
        # ast.parse 整文件
        try:
            ast.parse(open(fpath, encoding='utf-8').read())
        except Exception as e:
            errors.append('AST-FAIL %s: %r' % (fname, e))
            continue
        # 源文件行数
        spath = os.path.join(ROOT, 'source', rel)
        if not os.path.exists(spath):
            errors.append('SOURCE-MISSING %s' % rel)
            continue
        src_lines = len(open(spath, encoding='utf-8').read().split('\n'))
        seen = set()
        for item in ann:
            if not (isinstance(item, tuple) and len(item) == 3):
                errors.append('BAD-ITEM %s: %r' % (fname, item))
                break
            ln, pos, text = item
            if pos not in POS:
                errors.append('BAD-POS %s line %s pos=%r' % (fname, ln, pos))
            if not (1 <= ln <= src_lines):
                errors.append('BAD-LINE %s line %s (file has %d)' % (fname, ln, src_lines))
            if (ln, pos) in seen:
                errors.append('DUP-ANCHOR %s (%s,%s)' % (fname, ln, pos))
            seen.add((ln, pos))
            if '"' in text or '\\' in text:
                errors.append('BAD-CHAR %s line %s: 含英文双引号或反斜杠' % (fname, ln))
        total_ann += len(ann)
        print('OK %-90s %3d 锚点 / 源 %d 行' % (rel, len(ann), src_lines))
    print('---')
    print('合计 %d 个源文件，%d 处锚点' % (len(TARGETS), total_ann))
    if errors:
        print('预检失败：')
        for e in errors:
            print('  ' + e)
        raise SystemExit(1)
    print('预检全部通过 ✅')


if __name__ == '__main__':
    main()
