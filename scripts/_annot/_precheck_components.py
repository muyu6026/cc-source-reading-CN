# -*- coding: utf-8 -*-
"""预检本批 15 个 components 数据文件。"""
import os, sys, importlib.util, ast

ROOT = 'D:/CC泄露源码分析'
ANNOT_DIR = os.path.join(ROOT, 'scripts', '_annot')

# slug -> source 相对路径（source/ 之下）
MAP = {
    'src_components_LogoV2_VoiceModeNotice_tsx': 'src/components/LogoV2/VoiceModeNotice.tsx',
    'src_components_CustomSelect_select_option_tsx': 'src/components/CustomSelect/select-option.tsx',
    'src_components_agents_ModelSelector_tsx': 'src/components/agents/ModelSelector.tsx',
    'src_components_permissions_PermissionRequestTitle_tsx': 'src/components/permissions/PermissionRequestTitle.tsx',
    'src_components_wizard_WizardDialogLayout_tsx': 'src/components/wizard/WizardDialogLayout.tsx',
    'src_components_MessageTimestamp_tsx': 'src/components/MessageTimestamp.tsx',
    'src_components_Spinner_FlashingChar_tsx': 'src/components/Spinner/FlashingChar.tsx',
    'src_components_mcp_CapabilitiesSection_tsx': 'src/components/mcp/CapabilitiesSection.tsx',
    'src_components_agents_new_agent_creation_wizard_steps_ToolsStep_tsx': 'src/components/agents/new-agent-creation/wizard-steps/ToolsStep.tsx',
    'src_components_LogoV2_FeedColumn_tsx': 'src/components/LogoV2/FeedColumn.tsx',
    'src_components_IdeStatusIndicator_tsx': 'src/components/IdeStatusIndicator.tsx',
    'src_components_LogoV2_EmergencyTip_tsx': 'src/components/LogoV2/EmergencyTip.tsx',
    'src_components_ConfigurableShortcutHint_tsx': 'src/components/ConfigurableShortcutHint.tsx',
    'src_components_App_tsx': 'src/components/App.tsx',
    'src_components_BashModeProgress_tsx': 'src/components/BashModeProgress.tsx',
}

VALID_POS = {'before', 'after', 'after_block'}
problems = []

for slug, rel in MAP.items():
    fn = slug + '_p1.py'
    path = os.path.join(ANNOT_DIR, fn)
    if not os.path.exists(path):
        problems.append('%s: 数据文件缺失' % fn)
        continue
    # ast.parse 整文件
    try:
        src_text = open(path, encoding='utf-8').read()
        ast.parse(src_text)
    except Exception as e:
        problems.append('%s: ast.parse 失败 %s' % (fn, e))
        continue
    # 源文件行数
    src_path = os.path.join(ROOT, 'source', rel)
    if not os.path.exists(src_path):
        problems.append('%s: 源文件不存在 %s' % (fn, src_path))
        continue
    with open(src_path, encoding='utf-8') as f:
        src_lines = f.read().split('\n')
    nlines = len(src_lines) - 1 if src_lines and src_lines[-1] == '' else len(src_lines)
    # importlib 加载
    spec = importlib.util.spec_from_file_location(fn[:-3], path)
    mod = importlib.util.module_from_spec(spec)
    try:
        spec.loader.exec_module(mod)
    except Exception as e:
        problems.append('%s: 执行失败 %s' % (fn, e))
        continue
    ann = mod.ANNOTATIONS
    seen = set()
    for item in ann:
        if not (isinstance(item, tuple) and len(item) == 3):
            problems.append('%s: 非法条目 %r' % (fn, item))
            continue
        ln, pos, text = item
        if pos not in VALID_POS:
            problems.append('%s: pos 非法 %r' % (fn, pos))
        if not isinstance(ln, int) or ln < 1 or ln > nlines:
            problems.append('%s: 行号越界 %s (文件 %d 行)' % (fn, ln, nlines))
        if not isinstance(text, str):
            problems.append('%s: 文本非字符串' % fn)
        else:
            if '"' in text:
                problems.append('%s: 含英文双引号 行 %s' % (fn, ln))
            if '\\' in text:
                problems.append('%s: 含反斜杠 行 %s' % (fn, ln))
        if (ln, pos) in seen:
            problems.append('%s: 重复锚点 (%s,%s)' % (fn, ln, pos))
        seen.add((ln, pos))

if problems:
    print('PRECHECK FAIL (%d):' % len(problems))
    for p in problems:
        print('  -', p)
    sys.exit(1)
print('PRECHECK OK: 15 个数据文件全部通过（slug 映射、pos、行号、重复锚点、引号/反斜杠、ast.parse）')
