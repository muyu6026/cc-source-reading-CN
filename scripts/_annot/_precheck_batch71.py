import importlib.util
import ast
import os

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
ANNOT_DIR = os.path.join(ROOT, 'scripts', '_annot')

# slug -> 源文件相对路径（与 annotate.py 的 source/ 镜像一致）
TABLE = {
    'src_utils_concurrentSessions_ts': 'src/utils/concurrentSessions.ts',
    'src_utils_fullscreen_ts': 'src/utils/fullscreen.ts',
    'src_utils_settings_constants_ts': 'src/utils/settings/constants.ts',
    'src_utils_transcriptSearch_ts': 'src/utils/transcriptSearch.ts',
    'src_utils_streamlinedTransform_ts': 'src/utils/streamlinedTransform.ts',
    'src_utils_mcpWebSocketTransport_ts': 'src/utils/mcpWebSocketTransport.ts',
    'src_utils_managedEnv_ts': 'src/utils/managedEnv.ts',
    'src_utils_permissions_permissionRuleParser_ts': 'src/utils/permissions/permissionRuleParser.ts',
    'src_utils_heatmap_ts': 'src/utils/heatmap.ts',
    'src_utils_statusNoticeDefinitions_tsx': 'src/utils/statusNoticeDefinitions.tsx',
}

ALLOWED_POS = {'before', 'after', 'after_block'}
errors = []

for slug, relpath in TABLE.items():
    data_path = os.path.join(ANNOT_DIR, slug + '_p1.py')
    if not os.path.exists(data_path):
        errors.append(f'MISSING data file: {data_path}')
        continue
    # ast.parse 整文件
    try:
        with open(data_path, 'r', encoding='utf-8') as f:
            src = f.read()
        ast.parse(src)
    except SyntaxError as e:
        errors.append(f'AST FAIL {slug}: {e}')
        continue
    # importlib 执行模块
    spec = importlib.util.spec_from_file_location(slug, data_path)
    mod = importlib.util.module_from_spec(spec)
    try:
        spec.loader.exec_module(mod)
    except Exception as e:
        errors.append(f'EXEC FAIL {slug}: {e!r}')
        continue
    if not hasattr(mod, 'ANNOTATIONS'):
        errors.append(f'NO ANNOTATIONS {slug}')
        continue
    anno = mod.ANNOTATIONS
    # 校验每个三元组结构
    if not isinstance(anno, list):
        errors.append(f'BAD TYPE {slug}: ANNOTATIONS not list')
        continue
    src_path = os.path.join(ROOT, 'source', relpath)
    with open(src_path, 'r', encoding='utf-8') as f:
        lines = f.read().splitlines()
    n = len(lines)
    seen = set()
    for item in anno:
        if not (isinstance(item, tuple) and len(item) == 3):
            errors.append(f'{slug}: bad tuple {item!r}')
            continue
        line, pos, text = item
        if pos not in ALLOWED_POS:
            errors.append(f'{slug}: bad pos {pos} @ line {line}')
        if not (isinstance(line, int) and 1 <= line <= n):
            errors.append(f'{slug}: line {line} out of range [1,{n}]')
        if not isinstance(text, str):
            errors.append(f'{slug}: text not str @ line {line}')
        else:
            if '"' in text:
                errors.append(f'{slug}: double-quote in text @ line {line}')
            if '\\' in text:
                errors.append(f'{slug}: backslash in text @ line {line}')
        key = (line, pos)
        if key in seen:
            errors.append(f'{slug}: duplicate anchor {key}')
        seen.add(key)

if errors:
    print('PRECHECK FAILED:')
    for e in errors:
        print('  -', e)
    raise SystemExit(1)
print(f'PRECHECK OK: {len(TABLE)} data files, all invariants satisfied.')
