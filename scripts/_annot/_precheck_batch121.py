# -*- coding: utf-8 -*-
import importlib.util, os, sys

BASE = 'D:/CC泄露源码分析'
SOURCE = os.path.join(BASE, 'source')
ANNOT = os.path.join(BASE, 'scripts', '_annot')

mapping = {
  'src_components_HelpV2_HelpV2_ts': 'src/components/HelpV2/HelpV2.tsx',
  'src_components_Passes_Passes_ts': 'src/components/Passes/Passes.tsx',
  'src_components_mcp_MCPAgentServerMenu_ts': 'src/components/mcp/MCPAgentServerMenu.tsx',
  'src_components_permissions_FileEditPermissionRequest_FileEditPermissionRequest_ts': 'src/components/permissions/FileEditPermissionRequest/FileEditPermissionRequest.tsx',
  'src_components_FileEditToolDiff_ts': 'src/components/FileEditToolDiff.tsx',
  'src_components_permissions_rules_AddPermissionRules_ts': 'src/components/permissions/rules/AddPermissionRules.tsx',
  'src_components_permissions_AskUserQuestionPermissionRequest_use_multiple_choice_state_ts': 'src/components/permissions/AskUserQuestionPermissionRequest/use-multiple-choice-state.ts',
  'src_components_TokenWarning_ts': 'src/components/TokenWarning.tsx',
  'src_components_agents_AgentEditor_ts': 'src/components/agents/AgentEditor.tsx',
  'src_components_permissions_AskUserQuestionPermissionRequest_QuestionNavigationBar_ts': 'src/components/permissions/AskUserQuestionPermissionRequest/QuestionNavigationBar.tsx',
  'src_components_mcp_MCPStdioServerMenu_ts': 'src/components/mcp/MCPStdioServerMenu.tsx',
  'src_components_permissions_FilePermissionDialog_permissionOptions_ts': 'src/components/permissions/FilePermissionDialog/permissionOptions.tsx',
  'src_components_FeedbackSurvey_FeedbackSurvey_ts': 'src/components/FeedbackSurvey/FeedbackSurvey.tsx',
  'src_components_DesktopUpsell_DesktopUpsellStartup_ts': 'src/components/DesktopUpsell/DesktopUpsellStartup.tsx',
  'src_components_FileEditToolUseRejectedMessage_ts': 'src/components/FileEditToolUseRejectedMessage.tsx',
}

errors = []
for slug, rel in mapping.items():
    path = os.path.join(ANNOT, slug + '_p1.py')
    spec = importlib.util.spec_from_file_location(slug, path)
    mod = importlib.util.module_from_spec(spec)
    try:
        spec.loader.exec_module(mod)
    except Exception as e:
        errors.append(f'{slug}: import/ast.parse failed: {e!r}')
        continue
    A = getattr(mod, 'ANNOTATIONS', None)
    if not isinstance(A, list):
        errors.append(f'{slug}: ANNOTATIONS missing or not a list')
        continue
    src = os.path.join(SOURCE, rel)
    with open(src, encoding='utf-8') as f:
        nlines = sum(1 for _ in f)
    seen = set()
    for item in A:
        if not (isinstance(item, tuple) and len(item) == 3):
            errors.append(f'{slug}: bad item {item!r}')
            continue
        ln, pos, text = item
        if pos not in ('before', 'after', 'after_block'):
            errors.append(f'{slug}: bad pos {pos!r} at line {ln}')
        if not (1 <= ln <= nlines):
            errors.append(f'{slug}: line {ln} out of range (1..{nlines})')
        if (ln, pos) in seen:
            errors.append(f'{slug}: dup anchor ({ln},{pos})')
        seen.add((ln, pos))
        if '"' in text or '\\' in text:
            errors.append(f'{slug}: forbidden char in text at line {ln}: {text!r}')
    print(f'{slug}: OK {len(A)} anchors, src lines={nlines}')

if errors:
    print('\nERRORS:')
    for e in errors:
        print(' ', e)
    sys.exit(1)
print('\nALL OK')
