import importlib.util
import ast
import os
import sys

SRC_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', 'source'))

SLUG_TO_PATH = {
    'src_components_ThinkingToggle_tsx': 'src/components/ThinkingToggle.tsx',
    'src_components_SkillImprovementSurvey_tsx': 'src/components/SkillImprovementSurvey.tsx',
    'src_components_shell_ShellProgressMessage_tsx': 'src/components/shell/ShellProgressMessage.tsx',
    'src_components_permissions_rules_WorkspaceTab_tsx': 'src/components/permissions/rules/WorkspaceTab.tsx',
    'src_components_ManagedSettingsSecurityDialog_ManagedSettingsSecurityDialog_tsx': 'src/components/ManagedSettingsSecurityDialog/ManagedSettingsSecurityDialog.tsx',
    'src_components_design_system_Divider_tsx': 'src/components/design-system/Divider.tsx',
    'src_components_ValidationErrorsList_tsx': 'src/components/ValidationErrorsList.tsx',
    'src_components_permissions_useShellPermissionFeedback_ts': 'src/components/permissions/useShellPermissionFeedback.ts',
    'src_components_permissions_BashPermissionRequest_bashToolUseOptions_tsx': 'src/components/permissions/BashPermissionRequest/bashToolUseOptions.tsx',
    'src_components_permissions_AskUserQuestionPermissionRequest_SubmitQuestionsView_tsx': 'src/components/permissions/AskUserQuestionPermissionRequest/SubmitQuestionsView.tsx',
    'src_components_hooks_SelectMatcherMode_tsx': 'src/components/hooks/SelectMatcherMode.tsx',
    'src_components_ManagedSettingsSecurityDialog_utils_ts': 'src/components/ManagedSettingsSecurityDialog/utils.ts',
    'src_components_agents_new_agent_creation_wizard_steps_GenerateStep_tsx': 'src/components/agents/new-agent-creation/wizard-steps/GenerateStep.tsx',
    'src_components_AutoModeOptInDialog_tsx': 'src/components/AutoModeOptInDialog.tsx',
    'src_components_mcp_MCPToolListView_tsx': 'src/components/mcp/MCPToolListView.tsx',
}

VALID_POS = {'before', 'after', 'after_block'}
DATA_DIR = os.path.join(os.path.dirname(__file__))

errors = []
ok = 0

for slug, rel in SLUG_TO_PATH.items():
    fname = slug + '_p1.py'
    fpath = os.path.join(DATA_DIR, fname)
    if not os.path.exists(fpath):
        errors.append(f'[MISSING FILE] {fname}')
        continue
    spec = importlib.util.spec_from_file_location(slug, fpath)
    mod = importlib.util.module_from_spec(spec)
    try:
        spec.loader.exec_module(mod)
    except Exception as e:
        errors.append(f'[IMPORT FAIL] {fname}: {e!r}')
        continue
    if not hasattr(mod, 'ANNOTATIONS'):
        errors.append(f'[NO ANNOTATIONS] {fname}')
        continue
    # ast.parse the whole file
    try:
        with open(fpath, 'r', encoding='utf-8') as f:
            ast.parse(f.read())
    except SyntaxError as e:
        errors.append(f'[AST FAIL] {fname}: {e}')
        continue
    # source line count
    src_path = os.path.join(SRC_ROOT, rel)
    if not os.path.exists(src_path):
        errors.append(f'[SRC MISSING] {rel}')
        continue
    with open(src_path, 'r', encoding='utf-8') as f:
        nlines = sum(1 for _ in f)
    seen = set()
    for entry in mod.ANNOTATIONS:
        if not (isinstance(entry, tuple) and len(entry) == 3):
            errors.append(f'[BAD ENTRY] {fname}: {entry!r}')
            continue
        ln, pos, text = entry
        if pos not in VALID_POS:
            errors.append(f'[BAD POS] {fname}: line {ln} pos={pos!r}')
        if not (isinstance(ln, int) and 1 <= ln <= nlines):
            errors.append(f'[BAD LINE] {fname}: line {ln} (src has {nlines})')
        if not isinstance(text, str):
            errors.append(f'[BAD TEXT] {fname}: line {ln} text not str')
        else:
            if '"' in text:
                errors.append(f'[FORBIDDEN "] {fname}: line {ln}')
            if '\\' in text:
                errors.append(f'[FORBIDDEN \\] {fname}: line {ln}')
        key = (ln, pos)
        if key in seen:
            errors.append(f'[DUP ANCHOR] {fname}: ({ln},{pos})')
        seen.add(key)
    ok += 1

total_anchors = 0
for slug in SLUG_TO_PATH:
    fpath = os.path.join(DATA_DIR, slug + '_p1.py')
    spec = importlib.util.spec_from_file_location('reload_' + slug, fpath)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    total_anchors += len(m.ANNOTATIONS)

print(f'Loaded OK: {ok}/{len(SLUG_TO_PATH)}')
print(f'Total anchors: {total_anchors}')

if errors:
    print('=== ERRORS ===')
    for e in errors:
        print(e)
    sys.exit(1)
else:
    print('ALL PREFLIGHT CHECKS PASSED')
