# -*- coding: utf-8 -*-
"""第 86 批数据文件预检。"""
import ast
import importlib.util
import io
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
ANNOT_DIR = os.path.join(ROOT, 'scripts', '_annot')
SRC_ROOT = os.path.join(ROOT, 'source')

FILES = [
    'src/utils/hooks/hookHelpers.ts',
    'src/utils/claudeInChrome/prompt.ts',
    'src/utils/which.ts',
    'src/utils/teamDiscovery.ts',
    'src/utils/formatBriefTimestamp.ts',
    'src/utils/settings/mdm/constants.ts',
    'src/utils/awsAuthStatusManager.ts',
    'src/utils/permissions/dangerousPatterns.ts',
    'src/utils/settings/settingsCache.ts',
    'src/utils/toolPool.ts',
]

POS_OK = {'before', 'after', 'after_block'}


def slug_of(rel):
    return rel.replace('/', '_').replace('.', '_').replace('-', '_') + '_p1.py'


def block_comment_lines(text):
    """返回落在 /* */ 块注释内部的行号集合（不含 /** 起始行与 */ 结束行）。"""
    inner = set()
    depth = 0
    start = None
    for i, line in enumerate(text.splitlines(), 1):
        stripped = line.strip()
        if depth == 0 and '/*' in line:
            depth = 1
            start = i
            # 单行块注释
            if '*/' in line[line.index('/*') + 2:]:
                depth = 0
            continue
        if depth == 1:
            if '*/' in line:
                depth = 0
                continue
            inner.add(i)
    return inner


fail = 0
total_anchors = 0
for rel in FILES:
    src_path = os.path.join(SRC_ROOT, rel)
    with io.open(src_path, encoding='utf-8') as f:
        src_text = f.read()
    src_lines = src_text.splitlines()
    n_lines = len(src_lines)

    slug = slug_of(rel)
    data_path = os.path.join(ANNOT_DIR, slug)
    if not os.path.exists(data_path):
        print('FAIL 缺数据文件: ' + slug)
        fail += 1
        continue

    # ast.parse 整文件
    with io.open(data_path, encoding='utf-8') as f:
        code = f.read()
    try:
        ast.parse(code)
    except SyntaxError as e:
        print('FAIL ast.parse %s: %s' % (slug, e))
        fail += 1
        continue

    spec = importlib.util.spec_from_file_location('m_' + slug[:-3], data_path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    anns = getattr(mod, 'ANNOTATIONS', None)
    if not anns:
        print('FAIL 无 ANNOTATIONS: ' + slug)
        fail += 1
        continue

    inner = block_comment_lines(src_text)
    seen = set()
    for item in anns:
        if len(item) != 3:
            print('FAIL 元组长度 %s: %r' % (slug, item))
            fail += 1
            continue
        ln, pos, txt = item
        if pos not in POS_OK:
            print('FAIL pos 非法 %s: %r' % (slug, pos))
            fail += 1
        if not isinstance(ln, int) or ln < 1 or ln > n_lines:
            print('FAIL 行号越界 %s: %r (max %d)' % (slug, ln, n_lines))
            fail += 1
        if (ln, pos) in seen:
            print('FAIL 重复锚点 %s: (%d,%s)' % (slug, ln, pos))
            fail += 1
        seen.add((ln, pos))
        if '"' in txt or '\\' in txt:
            print('FAIL 文本含引号或反斜杠 %s (%d): %s' % (slug, ln, txt[:40]))
            fail += 1
        if ln in inner:
            print('FAIL 锚点落块注释内部 %s (%d,%s)' % (slug, ln, pos))
            fail += 1
        total_anchors += 1

    print('OK  %-52s 源 %3d 行  锚点 %d' % (rel, n_lines, len(anns)))

print('----')
print('文件 %d 份，锚点合计 %d，失败 %d' % (len(FILES), total_anchors, fail))
sys.exit(1 if fail else 0)
