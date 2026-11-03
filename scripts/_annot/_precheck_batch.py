# -*- coding: utf-8 -*-
"""批量预检：校验本批 15 个批注数据文件。"""
import importlib.util
import os
import sys

ROOT = 'D:/CC泄露源码分析'
ANNOT_DIR = os.path.join(ROOT, 'scripts', '_annot')

# (相对 source/ 的路径, slug)
FILES = [
    ('src/components/FeedbackSurvey/usePostCompactSurvey.tsx',
     'src_components_FeedbackSurvey_usePostCompactSurvey_tsx'),
    ('src/components/permissions/FilePermissionDialog/FilePermissionDialog.tsx',
     'src_components_permissions_FilePermissionDialog_FilePermissionDialog_tsx'),
    ('src/components/MCPServerDesktopImportDialog.tsx',
     'src_components_MCPServerDesktopImportDialog_tsx'),
    ('src/components/hooks/ViewHookMode.tsx',
     'src_components_hooks_ViewHookMode_tsx'),
    ('src/components/AutoUpdater.tsx',
     'src_components_AutoUpdater_tsx'),
    ('src/components/agents/generateAgent.ts',
     'src_components_agents_generateAgent_ts'),
    ('src/components/SessionPreview.tsx',
     'src_components_SessionPreview_tsx'),
    ('src/components/NativeAutoUpdater.tsx',
     'src_components_NativeAutoUpdater_tsx'),
    ('src/components/sandbox/SandboxOverridesTab.tsx',
     'src_components_sandbox_SandboxOverridesTab_tsx'),
    ('src/components/DesktopHandoff.tsx',
     'src_components_DesktopHandoff_tsx'),
    ('src/components/HighlightedCode/Fallback.tsx',
     'src_components_HighlightedCode_Fallback_tsx'),
    ('src/components/StructuredDiff.tsx',
     'src_components_StructuredDiff_tsx'),
    ('src/components/HighlightedCode.tsx',
     'src_components_HighlightedCode_tsx'),
    ('src/components/TeleportError.tsx',
     'src_components_TeleportError_tsx'),
    ('src/components/permissions/FilePermissionDialog/usePermissionHandler.ts',
     'src_components_permissions_FilePermissionDialog_usePermissionHandler_ts'),
]

VALID_POS = ('before', 'after', 'after_block')
errors = []
checked = 0

for rel, slug in FILES:
    # 1) slug 与源文件路径一一对应
    src = os.path.join(ROOT, 'source', rel)
    if not os.path.exists(src):
        errors.append('MISSING SOURCE: %s (slug=%s)' % (rel, slug))
        continue
    # 源文件行数（按真实代码行算，与 annotate.py splitlines 口径一致：去掉末尾空串）
    with open(src, encoding='utf-8') as f:
        raw = f.read().split('\n')
    if raw and raw[-1] == '':
        raw = raw[:-1]
    src_lines = len(raw)

    # 2) 数据文件存在
    data_file = os.path.join(ANNOT_DIR, slug + '_p1.py')
    if not os.path.exists(data_file):
        errors.append('MISSING DATAFILE: %s' % data_file)
        continue

    # 3) importlib 加载（同时验证 ast.parse 通过）
    spec = importlib.util.spec_from_file_location(slug + '_p1', data_file)
    mod = importlib.util.module_from_spec(spec)
    try:
        spec.loader.exec_module(mod)
    except Exception as e:
        errors.append('LOAD FAIL %s: %r' % (slug, e))
        continue

    if not hasattr(mod, 'ANNOTATIONS') or not isinstance(mod.ANNOTATIONS, list):
        errors.append('NO ANNOTATIONS: %s' % slug)
        continue

    seen = set()
    for entry in mod.ANNOTATIONS:
        checked += 1
        # 4) 元组形状 (line, pos, text)
        if not (isinstance(entry, tuple) and len(entry) == 3):
            errors.append('BAD ENTRY %s: %r' % (slug, entry))
            continue
        line, pos, text = entry
        # 5) pos 合法
        if pos not in VALID_POS:
            errors.append('BAD POS %s L%d: %r' % (slug, line, pos))
        # 6) 行号范围
        if not (1 <= line <= src_lines):
            errors.append('BAD LINE %s L%d (src has %d)' % (slug, line, src_lines))
        # 7) 无重复锚点
        key = (line, pos)
        if key in seen:
            errors.append('DUP ANCHOR %s L%d %s' % (slug, line, pos))
        seen.add(key)
        # 8) 文本无英文双引号 / 反斜杠
        if '"' in text or '\\' in text:
            errors.append('QUOTE/BACKSLASH %s L%d: %r' % (slug, line, text[:40]))
        # 9) 文本为字符串
        if not isinstance(text, str):
            errors.append('BAD TEXT %s L%d' % (slug, line))

print('已校验锚点总数: %d' % checked)
if errors:
    print('=== 预检失败 %d 项 ===' % len(errors))
    for e in errors:
        print(' -', e)
    sys.exit(1)
else:
    print('预检全部通过：%d 个文件 / %d 个锚点' % (len(FILES), checked))
