import importlib.util
import ast
import os

ROOT = 'D:/CC泄露源码分析'
ANNOT_DIR = os.path.join(ROOT, 'scripts', '_annot')
SOURCE_DIR = os.path.join(ROOT, 'source')

FILES = {
    'src_utils_logoV2Utils_ts': 'src/utils/logoV2Utils.ts',
    'src_utils_ultraplan_ccrSession_ts': 'src/utils/ultraplan/ccrSession.ts',
    'src_utils_deepLink_registerProtocol_ts': 'src/utils/deepLink/registerProtocol.ts',
    'src_utils_plugins_loadPluginAgents_ts': 'src/utils/plugins/loadPluginAgents.ts',
    'src_utils_env_ts': 'src/utils/env.ts',
    'src_utils_plugins_pluginStartupCheck_ts': 'src/utils/plugins/pluginStartupCheck.ts',
    'src_utils_swarm_backends_InProcessBackend_ts': 'src/utils/swarm/backends/InProcessBackend.ts',
    'src_utils_hooks_execAgentHook_ts': 'src/utils/hooks/execAgentHook.ts',
    'src_utils_nativeInstaller_packageManagers_ts': 'src/utils/nativeInstaller/packageManagers.ts',
    'src_utils_computerUse_wrapper_tsx': 'src/utils/computerUse/wrapper.tsx',
    'src_utils_mcp_elicitationValidation_ts': 'src/utils/mcp/elicitationValidation.ts',
    'src_utils_ansiToPng_ts': 'src/utils/ansiToPng.ts',
    'src_utils_effort_ts': 'src/utils/effort.ts',
    'src_utils_swarm_spawnInProcess_ts': 'src/utils/swarm/spawnInProcess.ts',
    'src_utils_bash_ParsedCommand_ts': 'src/utils/bash/ParsedCommand.ts',
}

POSITIONS = {'before', 'after', 'after_block'}
errors = []
total_anchors = 0

for slug, rel in FILES.items():
    path = os.path.join(ANNOT_DIR, f'{slug}_p1.py')
    if not os.path.exists(path):
        errors.append(f'MISSING data file: {path}')
        continue
    # ast.parse the data file itself
    try:
        with open(path, 'r', encoding='utf-8') as f:
            src_text = f.read()
        ast.parse(src_text)
    except SyntaxError as e:
        errors.append(f'AST-FAIL {slug}: {e}')
        continue
    # import via importlib
    spec = importlib.util.spec_from_file_location(slug, path)
    mod = importlib.util.module_from_spec(spec)
    try:
        spec.loader.exec_module(mod)
    except Exception as e:
        errors.append(f'IMPORT-FAIL {slug}: {e!r}')
        continue
    if not hasattr(mod, 'ANNOTATIONS'):
        errors.append(f'NO ANNOTATIONS {slug}')
        continue
    anns = mod.ANNOTATIONS
    # source line count
    src_path = os.path.join(SOURCE_DIR, rel)
    with open(src_path, 'r', encoding='utf-8') as f:
        nlines = sum(1 for _ in f)
    seen = set()
    for tup in anns:
        total_anchors += 1
        if not (isinstance(tup, tuple) and len(tup) == 3):
            errors.append(f'{slug}: bad tuple {tup!r}')
            continue
        ln, pos, text = tup
        if pos not in POSITIONS:
            errors.append(f'{slug}: bad pos {pos} at line {ln}')
        if not (isinstance(ln, int) and 1 <= ln <= nlines):
            errors.append(f'{slug}: line {ln} out of range [1,{nlines}]')
        if not isinstance(text, str):
            errors.append(f'{slug}: text not str at line {ln}')
        else:
            if '"' in text or '\\' in text:
                errors.append(f'{slug}: forbidden char in text at line {ln}: {text[:30]!r}')
        key = (ln, pos)
        if key in seen:
            errors.append(f'{slug}: duplicate anchor {key}')
        seen.add(key)

print(f'Files loaded: {len(FILES)}')
print(f'Total anchors: {total_anchors}')
if errors:
    print(f'ERRORS ({len(errors)}):')
    for e in errors:
        print('  -', e)
    raise SystemExit(1)
else:
    print('PRECHECK OK')
