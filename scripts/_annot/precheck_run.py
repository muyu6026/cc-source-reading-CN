# -*- coding: utf-8 -*-
"""本批（components 剩余前 15）数据文件预检。"""
import os
import ast
import importlib.util

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
ANNOT_DIR = os.path.join(ROOT, 'scripts', '_annot')
BATCH = [
    ('src/components/StatusNotices.tsx', 'src_components_StatusNotices_tsx'),
    ('src/components/LogoV2/Opus1mMergeNotice.tsx', 'src_components_LogoV2_Opus1mMergeNotice_tsx'),
    ('src/components/KeybindingWarnings.tsx', 'src_components_KeybindingWarnings_tsx'),
    ('src/components/agents/new-agent-creation/wizard-steps/ModelStep.tsx', 'src_components_agents_new_agent_creation_wizard_steps_ModelStep_tsx'),
    ('src/components/CtrlOToExpand.tsx', 'src_components_CtrlOToExpand_tsx'),
    ('src/components/LogoV2/AnimatedAsterisk.tsx', 'src_components_LogoV2_AnimatedAsterisk_tsx'),
    ('src/components/CustomSelect/option-map.ts', 'src_components_CustomSelect_option_map_ts'),
    ('src/components/CostThresholdDialog.tsx', 'src_components_CostThresholdDialog_tsx'),
    ('src/components/permissions/WorkerBadge.tsx', 'src_components_permissions_WorkerBadge_tsx'),
    ('src/components/mcp/utils/reconnectHelpers.tsx', 'src_components_mcp_utils_reconnectHelpers_tsx'),
    ('src/components/DevBar.tsx', 'src_components_DevBar_tsx'),
    ('src/components/ExitFlow.tsx', 'src_components_ExitFlow_tsx'),
    ('src/components/ContextSuggestions.tsx', 'src_components_ContextSuggestions_tsx'),
    ('src/components/sandbox/SandboxDoctorSection.tsx', 'src_components_sandbox_SandboxDoctorSection_tsx'),
    ('src/components/FastIcon.tsx', 'src_components_FastIcon_tsx'),
]
VALID_POS = {'before', 'after', 'after_block'}
errors = []
total_ann = 0

for rel, slug in BATCH:
    # 1. slug 推导一致性
    calc = rel.replace('/', '_').replace('.', '_').replace('-', '_')
    if calc != slug:
        errors.append(f'[slug] {rel}: 推导 {calc} != 数据 {slug}')
    # 2. 数据文件存在
    data_file = os.path.join(ANNOT_DIR, slug + '_p1.py')
    if not os.path.exists(data_file):
        errors.append(f'[file] 缺失数据文件: {slug}_p1.py')
        continue
    # 3. ast.parse 整文件
    try:
        src_text = open(data_file, encoding='utf-8').read()
        ast.parse(src_text)
    except SyntaxError as e:
        errors.append(f'[ast] {slug}: {e}')
        continue
    # 4. importlib 加载
    try:
        spec = importlib.util.spec_from_file_location(slug + '_p1', data_file)
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        anns = mod.ANNOTATIONS
    except Exception as e:
        errors.append(f'[import] {slug}: {e!r}')
        continue
    # 5. 源文件行数
    src_path = os.path.join(ROOT, 'source', rel)
    if not os.path.exists(src_path):
        errors.append(f'[src] 源文件不存在: {rel}')
        continue
    n_lines = sum(1 for _ in open(src_path, encoding='utf-8'))
    # 6. 逐条校验
    seen = set()
    for item in anns:
        if not (isinstance(item, tuple) and len(item) == 3):
            errors.append(f'[shape] {slug}: {item!r}')
            continue
        ln, pos, text = item
        total_ann += 1
        if pos not in VALID_POS:
            errors.append(f'[pos] {slug} L{ln}: pos={pos!r}')
        if not (isinstance(ln, int) and 1 <= ln <= n_lines):
            errors.append(f'[line] {slug}: 行号 {ln} 超出范围 1..{n_lines}')
        if not isinstance(text, str):
            errors.append(f'[text] {slug} L{ln}: 文本非字符串')
        else:
            if '"' in text:
                errors.append(f'[quote] {slug} L{ln}: 含英文双引号')
            if '\\' in text:
                errors.append(f'[backslash] {slug} L{ln}: 含反斜杠')
        key = (ln, pos)
        if key in seen:
            errors.append(f'[dup] {slug}: 锚点重复 (L{ln},{pos})')
        seen.add(key)

print(f'校验文件数: {len(BATCH)}，锚点总数: {total_ann}')
if errors:
    print(f'❌ 失败 {len(errors)} 项:')
    for e in errors:
        print('  -', e)
    raise SystemExit(1)
print('✅ 全部预检通过')
