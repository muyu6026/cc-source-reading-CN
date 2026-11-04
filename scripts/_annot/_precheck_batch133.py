#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Batch 133 预检（components 收尾）：加载每个数据文件，断言结构与行号合法。"""
import os
import ast
import importlib.util

ROOT = 'D:/CC泄露源码分析'
ANNOT_DIR = os.path.join(ROOT, 'scripts', '_annot')

TARGETS = [
    'src/components/ui/OrderedListItem.tsx',
    'src/components/sandbox/SandboxConfigTab.tsx',
    'src/components/memory/MemoryUpdateNotification.tsx',
    'src/components/OffscreenFreeze.tsx',
    'src/components/permissions/FilePermissionDialog/ideDiffConfig.ts',
    'src/components/MessageModel.tsx',
    'src/components/FilePathLink.tsx',
    'src/components/EffortIndicator.ts',
    'src/components/ToolUseLoader.tsx',
    'src/components/StructuredDiff/colorDiff.ts',
    'src/components/MemoryUsageIndicator.tsx',
    'src/components/shell/ExpandShellOutputContext.tsx',
    'src/components/Spinner/ShimmerChar.tsx',
    'src/components/tasks/renderToolActivity.tsx',
    'src/components/Spinner/useShimmerAnimation.ts',
    'src/components/design-system/color.ts',
    'src/components/StructuredDiffList.tsx',
    'src/components/SentryErrorBoundary.ts',
    'src/components/agents/types.ts',
    'src/components/permissions/utils.ts',
    'src/components/agents/AgentNavigationFooter.tsx',
    'src/components/wizard/WizardNavigationFooter.tsx',
    'src/components/HelpV2/General.tsx',
    'src/components/agents/utils.ts',
    'src/components/FallbackToolUseRejectedMessage.tsx',
    'src/components/PressEnterToContinue.tsx',
    'src/components/MCPServerDialogCopy.tsx',
    'src/components/InterruptedByUser.tsx',
    'src/components/wizard/useWizard.ts',
    'src/components/Spinner/index.ts',
    'src/components/wizard/index.ts',
    'src/components/mcp/index.ts',
    'src/components/CustomSelect/index.ts',
    'src/components/Spinner/teammateSelectHint.ts',
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
