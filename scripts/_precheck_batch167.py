# -*- coding: utf-8 -*-
# 第 167 批预检：载入 14 个数据文件，逐项断言
import importlib.util, ast, sys, os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ANNOT_DIR = os.path.join(ROOT, 'scripts', '_annot')

MAP = [
    ('src_query_tokenBudget_ts', 'src/query/tokenBudget.ts'),
    ('src_commands_color_color_ts', 'src/commands/color/color.ts'),
    ('src_skills_bundled_loop_ts', 'src/skills/bundled/loop.ts'),
    ('src_commands_commit_ts', 'src/commands/commit.ts'),
    ('src_commands_export_export_tsx', 'src/commands/export/export.tsx'),
    ('src_commands_memory_memory_tsx', 'src/commands/memory/memory.tsx'),
    ('src_server_createDirectConnectSession_ts', 'src/server/createDirectConnectSession.ts'),
    ('src_context_voice_tsx', 'src/context/voice.tsx'),
    ('src_commands_rename_rename_ts', 'src/commands/rename/rename.ts'),
    ('src_assistant_sessionHistory_ts', 'src/assistant/sessionHistory.ts'),
    ('src_constants_xml_ts', 'src/constants/xml.ts'),
    ('src_ink_ts', 'src/ink.ts'),
    ('src_commands_mcp_mcp_tsx', 'src/commands/mcp/mcp.tsx'),
    ('src_commands_install_github_app_ErrorStep_tsx', 'src/commands/install-github-app/ErrorStep.tsx'),
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
    # 1. ast.parse whole file
    with open(path, encoding='utf-8') as f:
        src_text = f.read()
    try:
        ast.parse(src_text)
    except SyntaxError as e:
        errors.append(f'{slug}: ast.parse 失败 {e}')
    # 2. ANNOTATIONS 存在
    if not hasattr(mod, 'ANNOTATIONS'):
        errors.append(f'{slug}: 缺 ANNOTATIONS')
        continue
    anns = mod.ANNOTATIONS
    # 3. 源文件行数
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
