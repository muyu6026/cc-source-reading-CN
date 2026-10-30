# -*- coding: utf-8 -*-
"""第 80 批预检：15 个 utils 小文件数据文件一次性校验。"""
import os
import sys
import importlib.util
import ast

ROOT = 'D:/CC泄露源码分析'
ANNOT_DIR = os.path.join(ROOT, 'scripts', '_annot')
SOURCE_DIR = os.path.join(ROOT, 'source')

# (slug, 相对 source 的路径) —— 与 annotate.py 的 slug 推导一致
TARGETS = [
    ('src_utils_filePersistence_outputsScanner_ts', 'src/utils/filePersistence/outputsScanner.ts'),
    ('src_utils_computerUse_toolRendering_tsx', 'src/utils/computerUse/toolRendering.tsx'),
    ('src_utils_appleTerminalBackup_ts', 'src/utils/appleTerminalBackup.ts'),
    ('src_utils_streamJsonStdoutGuard_ts', 'src/utils/streamJsonStdoutGuard.ts'),
    ('src_utils_deepLink_banner_ts', 'src/utils/deepLink/banner.ts'),
    ('src_utils_plugins_pluginIdentifier_ts', 'src/utils/plugins/pluginIdentifier.ts'),
    ('src_utils_shell_powershellProvider_ts', 'src/utils/shell/powershellProvider.ts'),
    ('src_utils_systemPrompt_ts', 'src/utils/systemPrompt.ts'),
    ('src_utils_autoRunIssue_tsx', 'src/utils/autoRunIssue.tsx'),
    ('src_utils_mcp_dateTimeParser_ts', 'src/utils/mcp/dateTimeParser.ts'),
    ('src_utils_screenshotClipboard_ts', 'src/utils/screenshotClipboard.ts'),
    ('src_utils_warningHandler_ts', 'src/utils/warningHandler.ts'),
    ('src_utils_QueryGuard_ts', 'src/utils/QueryGuard.ts'),
    ('src_utils_teleport_environments_ts', 'src/utils/teleport/environments.ts'),
    ('src_utils_systemTheme_ts', 'src/utils/systemTheme.ts'),
]

VALID_POS = {'before', 'after', 'after_block'}
errors = []
total_ann = 0


def load_module(slug):
    name = slug + '_p1.py'
    path = os.path.join(ANNOT_DIR, name)
    if not os.path.exists(path):
        errors.append('MISSING data file: %s' % name)
        return None
    spec = importlib.util.spec_from_file_location(name[:-3], path)
    mod = importlib.util.module_from_spec(spec)
    try:
        spec.loader.exec_module(mod)
    except Exception as e:  # noqa: BLE001
        errors.append('IMPORT FAIL %s: %r' % (name, e))
        return None
    return mod


for slug, rel in TARGETS:
    expected = rel.replace('/', '_').replace('.', '_').replace('-', '_')
    if expected != slug:
        errors.append('SLUG MISMATCH: %s != expected %s' % (slug, expected))

    src = os.path.join(SOURCE_DIR, rel)
    if not os.path.exists(src):
        errors.append('SOURCE MISSING: %s' % rel)
        continue
    with open(src, 'r', encoding='utf-8') as f:
        content = f.read()
    lines = content.split('\n')
    if lines and lines[-1] == '':
        lines = lines[:-1]
    n = len(lines)

    mod = load_module(slug)
    if mod is None:
        continue
    if not hasattr(mod, 'ANNOTATIONS'):
        errors.append('NO ANNOTATIONS in %s' % slug)
        continue
    anns = mod.ANNOTATIONS
    total_ann += len(anns)
    seen = set()
    for tup in anns:
        if not (isinstance(tup, tuple) and len(tup) == 3):
            errors.append('%s: bad tuple %r' % (slug, tup))
            continue
        ln, pos, text = tup
        if pos not in VALID_POS:
            errors.append('%s line %s: bad pos %r' % (slug, ln, pos))
        if not isinstance(ln, int) or not (1 <= ln <= n):
            errors.append('%s: line %s out of range [1,%d]' % (slug, ln, n))
        key = (ln, pos)
        if key in seen:
            errors.append('%s: duplicate anchor %r' % (slug, key))
        seen.add(key)
        if '"' in text or '\\' in text:
            errors.append('%s line %s: forbidden char in text -> %r' % (slug, ln, text[:40]))

    with open(os.path.join(ANNOT_DIR, slug + '_p1.py'), 'r', encoding='utf-8') as f:
        try:
            ast.parse(f.read())
        except SyntaxError as e:
            errors.append('AST FAIL %s: %s' % (slug, e))

print('目标文件数: %d' % len(TARGETS))
print('锚点总数: %d' % total_ann)
if errors:
    print('==== 预检失败 ====')
    for e in errors:
        print(' -', e)
    sys.exit(1)
print('==== 预检全部通过 ====')
