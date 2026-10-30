import ast
import importlib.util
import os
import sys

ROOT = 'D:/CC泄露源码分析'
SOURCE_DIR = os.path.join(ROOT, 'source')
ANNOT_DIR = os.path.join(ROOT, 'scripts', '_annot')

# slug -> source relative path (the 15 files of batch 81)
MAPPING = {
    'src_utils_swarm_reconnection_ts': 'src/utils/swarm/reconnection.ts',
    'src_utils_suggestions_shellHistoryCompletion_ts': 'src/utils/suggestions/shellHistoryCompletion.ts',
    'src_utils_model_configs_ts': 'src/utils/model/configs.ts',
    'src_utils_model_modelCapabilities_ts': 'src/utils/model/modelCapabilities.ts',
    'src_utils_staticRender_tsx': 'src/utils/staticRender.tsx',
    'src_utils_secureStorage_keychainPrefetch_ts': 'src/utils/secureStorage/keychainPrefetch.ts',
    'src_utils_caCerts_ts': 'src/utils/caCerts.ts',
    'src_utils_plugins_orphanedPluginFilter_ts': 'src/utils/plugins/orphanedPluginFilter.ts',
    'src_utils_secureStorage_macOsKeychainHelpers_ts': 'src/utils/secureStorage/macOsKeychainHelpers.ts',
    'src_utils_shell_powershellDetection_ts': 'src/utils/shell/powershellDetection.ts',
    'src_utils_swarm_teammateLayoutManager_ts': 'src/utils/swarm/teammateLayoutManager.ts',
    'src_utils_computerUse_mcpServer_ts': 'src/utils/computerUse/mcpServer.ts',
    'src_utils_ghPrStatus_ts': 'src/utils/ghPrStatus.ts',
    'src_utils_pasteStore_ts': 'src/utils/pasteStore.ts',
    'src_utils_imageValidation_ts': 'src/utils/imageValidation.ts',
}

VALID_POS = {'before', 'after', 'after_block'}
errors = []
total_anchors = 0
seen_slugs = set()

for slug, rel in MAPPING.items():
    seen_slugs.add(slug)
    data_file = os.path.join(ANNOT_DIR, slug + '_p1.py')
    if not os.path.exists(data_file):
        errors.append(f'MISSING data file: {data_file}')
        continue
    # load module
    spec = importlib.util.spec_from_file_location(slug, data_file)
    mod = importlib.util.module_from_spec(spec)
    try:
        spec.loader.exec_module(mod)
    except Exception as e:
        errors.append(f'LOAD FAIL {slug}: {e!r}')
        continue
    if not hasattr(mod, 'ANNOTATIONS'):
        errors.append(f'NO ANNOTATIONS in {slug}')
        continue
    anns = mod.ANNOTATIONS
    # source line count
    src_path = os.path.join(SOURCE_DIR, rel)
    with open(src_path, 'r', encoding='utf-8') as f:
        lines = f.read().splitlines()
    n = len(lines)
    # ast parse
    try:
        with open(data_file, 'r', encoding='utf-8') as f:
            ast.parse(f.read())
    except SyntaxError as e:
        errors.append(f'AST FAIL {slug}: {e}')
        continue
    seen_anchor = set()
    for tup in anns:
        if not (isinstance(tup, tuple) and len(tup) == 3):
            errors.append(f'BAD TUPLE {slug}: {tup!r}')
            continue
        line, pos, text = tup
        total_anchors += 1
        # pos valid
        if pos not in VALID_POS:
            errors.append(f'BAD POS {slug} line {line}: {pos}')
        # line range
        if not (1 <= line <= n):
            errors.append(f'BAD LINE {slug}: {line} (file has {n} lines)')
        # no " or backslash
        if '"' in text or '\\' in text:
            errors.append(f'QUOTE/BACKSLASH {slug} line {line}: {text[:40]!r}')
        # duplicate anchor
        key = (line, pos)
        if key in seen_anchor:
            errors.append(f'DUP ANCHOR {slug}: {key}')
        seen_anchor.add(key)

# verify each annotated source file actually exists and no extra data files
for slug, rel in MAPPING.items():
    if not os.path.exists(os.path.join(SOURCE_DIR, rel)):
        errors.append(f'SOURCE MISSING {slug}: {rel}')

print(f'Validated {len(MAPPING)} data files, {total_anchors} anchors.')
if errors:
    print('ERRORS:')
    for e in errors:
        print('  -', e)
    sys.exit(1)
else:
    print('PRECHECK OK — all assertions passed.')
