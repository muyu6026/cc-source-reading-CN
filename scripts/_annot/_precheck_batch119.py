# -*- coding: utf-8 -*-
import importlib.util, os, ast

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
ANNOT = os.path.join(ROOT, 'scripts', '_annot')
SRC = os.path.join(ROOT, 'source')

# slug -> source 相对路径（components 子树，本批 15 份）
MAPPING = {
    'src_components_Spinner_TeammateSpinnerLine_tsx': 'src/components/Spinner/TeammateSpinnerLine.tsx',
    'src_components_WorktreeExitDialog_tsx': 'src/components/WorktreeExitDialog.tsx',
    'src_components_permissions_SedEditPermissionRequest_SedEditPermissionRequest_tsx': 'src/components/permissions/SedEditPermissionRequest/SedEditPermissionRequest.tsx',
    'src_components_tasks_AsyncAgentDetailDialog_tsx': 'src/components/tasks/AsyncAgentDetailDialog.tsx',
    'src_components_permissions_AskUserQuestionPermissionRequest_PreviewBox_tsx': 'src/components/permissions/AskUserQuestionPermissionRequest/PreviewBox.tsx',
    'src_components_agents_AgentDetail_tsx': 'src/components/agents/AgentDetail.tsx',
    'src_components_permissions_PermissionRequest_tsx': 'src/components/permissions/PermissionRequest.tsx',
    'src_components_FeedbackSurvey_useMemorySurvey_tsx': 'src/components/FeedbackSurvey/useMemorySurvey.tsx',
    'src_components_CustomSelect_SelectMulti_tsx': 'src/components/CustomSelect/SelectMulti.tsx',
    'src_components_mcp_McpParsingWarnings_tsx': 'src/components/mcp/McpParsingWarnings.tsx',
    'src_components_wizard_WizardProvider_tsx': 'src/components/wizard/WizardProvider.tsx',
    'src_components_permissions_FilePermissionDialog_useFilePermissionDialog_ts': 'src/components/permissions/FilePermissionDialog/useFilePermissionDialog.ts',
    'src_components_mcp_MCPToolDetailView_tsx': 'src/components/mcp/MCPToolDetailView.tsx',
    'src_components_permissions_hooks_ts': 'src/components/permissions/hooks.ts',
    'src_components_permissions_rules_RecentDenialsTab_tsx': 'src/components/permissions/rules/RecentDenialsTab.tsx',
}

VALID_POS = ('before', 'after', 'after_block')
errors = []

# 1) slug 与源文件一一对应：MAPPING 必须都存在
for slug, rel in MAPPING.items():
    src_path = os.path.join(SRC, rel)
    if not os.path.exists(src_path):
        errors.append('源文件缺失: %s' % rel)
        continue
    data_path = os.path.join(ANNOT, slug + '_p1.py')
    if not os.path.exists(data_path):
        errors.append('数据文件缺失: %s_p1.py' % slug)
        continue
    # 2) ast.parse 整文件
    try:
        src_text = open(data_path, encoding='utf-8').read()
        ast.parse(src_text)
    except SyntaxError as e:
        errors.append('%s: ast.parse 失败: %s' % (slug, e))
        continue
    # 行数口径对齐 wc -l
    raw = open(src_path, encoding='utf-8').read()
    parts = raw.split('\n')
    nlines = len(parts) - 1 if parts and parts[-1] == '' else len(parts)
    # 3) 加载并执行模块
    try:
        spec = importlib.util.spec_from_file_location(slug, data_path)
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        anns = mod.ANNOTATIONS
    except Exception as e:
        errors.append('%s: 执行失败: %s' % (slug, e))
        continue
    seen = set()
    for item in anns:
        if not (isinstance(item, tuple) and len(item) == 3):
            errors.append('%s: 非三元组 %r' % (slug, item))
            continue
        ln, pos, text = item
        if pos not in VALID_POS:
            errors.append('%s: 非法 pos %r @ %s' % (slug, pos, ln))
        if not (1 <= ln <= nlines):
            errors.append('%s: 行号越界 %s (共 %d)' % (slug, ln, nlines))
        if (ln, pos) in seen:
            errors.append('%s: 重复锚点 (%s,%s)' % (slug, ln, pos))
        seen.add((ln, pos))
        if '"' in text or '\\' in text:
            errors.append('%s: 文本含禁用字符 @ %s: %s' % (slug, ln, repr(text[:24])))

if errors:
    print('预检失败，%d 处：' % len(errors))
    for e in errors:
        print('  - ' + e)
    raise SystemExit(1)
print('预检通过：%d 个数据文件，所有锚点合法。' % len(MAPPING))
