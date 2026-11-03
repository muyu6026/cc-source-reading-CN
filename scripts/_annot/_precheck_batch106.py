# 预检脚本：批 106（4 文件）
import importlib.util, ast, os, sys

ROOT = 'D:/CC泄露源码分析'
ANNOT_DIR = os.path.join(ROOT, 'scripts', '_annot')

PAIRS = [
    ('src_components_MessageSelector_tsx', 'src/components/MessageSelector.tsx'),
    ('src_components_agents_AgentsMenu_tsx', 'src/components/agents/AgentsMenu.tsx'),
    ('src_components_permissions_ExitPlanModePermissionRequest_ExitPlanModePermissionRequest_tsx', 'src/components/permissions/ExitPlanModePermissionRequest/ExitPlanModePermissionRequest.tsx'),
    ('src_components_teams_TeamsDialog_tsx', 'src/components/teams/TeamsDialog.tsx'),
]

VALID_POS = {'before', 'after', 'after_block'}
ok = True

for slug, rel in PAIRS:
    path = os.path.join(ANNOT_DIR, slug + '_p1.py')
    src_path = os.path.join(ROOT, 'source', rel)
    if not os.path.exists(path):
        print(f'MISSING data file: {path}'); ok = False; continue
    if not os.path.exists(src_path):
        print(f'MISSING source: {src_path}'); ok = False; continue
    # ast.parse the data file itself
    try:
        src_text = open(path, encoding='utf-8').read()
        ast.parse(src_text)
    except SyntaxError as e:
        print(f'AST FAIL {slug}: {e}'); ok = False; continue
    # load module
    spec = importlib.util.spec_from_file_location(slug, path)
    mod = importlib.util.module_from_spec(spec)
    try:
        spec.loader.exec_module(mod)
    except Exception as e:
        print(f'LOAD FAIL {slug}: {e}'); ok = False; continue
    if not hasattr(mod, 'ANNOTATIONS'):
        print(f'NO ANNOTATIONS {slug}'); ok = False; continue
    ann = mod.ANNOTATIONS
    src_lines = open(src_path, encoding='utf-8').read().splitlines()
    src_len = len(src_lines)
    seen = set()
    n = 0
    for item in ann:
        n += 1
        if not (isinstance(item, tuple) and len(item) == 3):
            print(f'BAD ITEM {slug}: {item!r}'); ok = False; break
        line, pos, text = item
        if pos not in VALID_POS:
            print(f'BAD POS {slug}: line {line} pos {pos!r}'); ok = False; break
        if not isinstance(line, int) or not (1 <= line <= src_len):
            print(f'BAD LINE {slug}: {line} (source has {src_len} lines)'); ok = False; break
        if not isinstance(text, str):
            print(f'BAD TEXT {slug}: line {line}'); ok = False; break
        if '"' in text:
            print(f'QUOTE in {slug} line {line}: {text[:40]!r}'); ok = False; break
        if '\\' in text:
            print(f'BACKSLASH in {slug} line {line}: {text[:40]!r}'); ok = False; break
        key = (line, pos)
        if key in seen:
            print(f'DUP ANCHOR {slug}: {key}'); ok = False; break
        seen.add(key)
    else:
        print(f'OK {slug}: {n} anchors, source {src_len} lines, rel {rel}')

print('ALL OK' if ok else 'PRECHECK FAILED')
sys.exit(0 if ok else 1)
