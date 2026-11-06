# -*- coding: utf-8 -*-
# 第 169 批预检：载入 15 个数据文件，逐项断言
import importlib.util, ast, sys, os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ANNOT_DIR = os.path.join(ROOT, 'scripts', '_annot')

MAP = [
    ('src_commands_install_github_app_WarningsStep_tsx', 'src/commands/install-github-app/WarningsStep.tsx'),
    ('src_bridge_flushGate_ts', 'src/bridge/flushGate.ts'),
    ('src_cli_handlers_agents_ts', 'src/cli/handlers/agents.ts'),
    ('src_skills_bundled_simplify_ts', 'src/skills/bundled/simplify.ts'),
    ('src_constants_systemPromptSections_ts', 'src/constants/systemPromptSections.ts'),
    ('src_migrations_migrateSonnet45ToSonnet46_ts', 'src/migrations/migrateSonnet45ToSonnet46.ts'),
    ('src_commands_rename_generateSessionName_ts', 'src/commands/rename/generateSessionName.ts'),
    ('src_commands_install_github_app_CreatingStep_tsx', 'src/commands/install-github-app/CreatingStep.tsx'),
    ('src_commands_createMovedToPluginCommand_ts', 'src/commands/createMovedToPluginCommand.ts'),
    ('src_commands_context_context_tsx', 'src/commands/context/context.tsx'),
    ('src_keybindings_shortcutFormat_ts', 'src/keybindings/shortcutFormat.ts'),
    ('src_context_QueuedMessageContext_tsx', 'src/context/QueuedMessageContext.tsx'),
    ('src_entrypoints_sdk_coreTypes_ts', 'src/entrypoints/sdk/coreTypes.ts'),
    ('src_migrations_migrateAutoUpdatesToSettings_ts', 'src/migrations/migrateAutoUpdatesToSettings.ts'),
    ('src_commands_reload_plugins_reload_plugins_ts', 'src/commands/reload-plugins/reload-plugins.ts'),
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
