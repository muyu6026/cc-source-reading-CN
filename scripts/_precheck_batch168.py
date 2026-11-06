# -*- coding: utf-8 -*-
# 第 168 批预检：载入 15 个数据文件，逐项断言
import importlib.util, ast, sys, os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ANNOT_DIR = os.path.join(ROOT, 'scripts', '_annot')

MAP = [
    ('src_projectOnboardingState_ts', 'src/projectOnboardingState.ts'),
    ('src_commands_sandbox_toggle_sandbox_toggle_tsx', 'src/commands/sandbox-toggle/sandbox-toggle.tsx'),
    ('src_commands_logout_logout_tsx', 'src/commands/logout/logout.tsx'),
    ('src_tasks_pillLabel_ts', 'src/tasks/pillLabel.ts'),
    ('src_bridge_pollConfigDefaults_ts', 'src/bridge/pollConfigDefaults.ts'),
    ('src_vim_motions_ts', 'src/vim/motions.ts'),
    ('src_skills_bundled_remember_ts', 'src/skills/bundled/remember.ts'),
    ('src_bridge_inboundMessages_ts', 'src/bridge/inboundMessages.ts'),
    ('src_skills_bundled_stuck_ts', 'src/skills/bundled/stuck.ts'),
    ('src_skills_bundled_index_ts', 'src/skills/bundled/index.ts'),
    ('src_remote_remotePermissionBridge_ts', 'src/remote/remotePermissionBridge.ts'),
    ('src_state_selectors_ts', 'src/state/selectors.ts'),
    ('src_tasks_LocalShellTask_killShellTasks_ts', 'src/tasks/LocalShellTask/killShellTasks.ts'),
    ('src_constants_product_ts', 'src/constants/product.ts'),
    ('src_skills_bundled_claudeApiContent_ts', 'src/skills/bundled/claudeApiContent.ts'),
]

VALID_POS = {'before', 'after', 'after_block'}
errors = []


def load(slug):
    path = os.path.join(ANNOT_DIR, slug + '_p1.py')
    spec = importlib.util.spec_from_file_location(slug, path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return path, mod


total_anchors = 0
for slug, rel in MAP:
    path, mod = load(slug)
    with open(path, encoding='utf-8') as f:
        src_text = f.read()
    try:
        ast.parse(src_text)
    except SyntaxError as e:
        errors.append(f'{slug}: ast.parse 失败 {e}')
    if not hasattr(mod, 'ANNOTATIONS'):
        errors.append(f'{slug}: 缺 ANNOTATIONS')
        continue
    anns = mod.ANNOTATIONS
    src_path = os.path.join(ROOT, 'source', rel)
    with open(src_path, encoding='utf-8') as f:
        nlines = sum(1 for _ in f)
    seen = set()
    for tup in anns:
        if not (isinstance(tup, tuple) and len(tup) == 3):
            errors.append(f'{slug}: 锚点格式错 {tup!r}')
            continue
        ln, pos, text = tup
        total_anchors += 1
        if pos not in VALID_POS:
            errors.append(f'{slug}: 非法 pos {pos} @行{ln}')
        if not (1 <= ln <= nlines):
            errors.append(f'{slug}: 行号越界 {ln} (源共 {nlines} 行)')
        if '"' in text or '\\' in text:
            errors.append(f'{slug}: 文本含禁字符 @行{ln}: {text[:30]}')
        key = (ln, pos)
        if key in seen:
            errors.append(f'{slug}: 重复锚点 (行{ln},{pos})')
        seen.add(key)

print(f'数据文件数: {len(MAP)}  锚点总数: {total_anchors}')
if errors:
    print('预检失败：')
    for e in errors:
        print('  -', e)
    sys.exit(1)
else:
    print('预检全部通过：slug 映射、pos、行界、重复、禁字符、ast.parse 均 OK')
