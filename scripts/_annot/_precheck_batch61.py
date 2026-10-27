# -*- coding: utf-8 -*-
"""Batch 61 precheck: validate 15 annotation data files before annotate.py."""
import importlib.util
import ast
import sys
import os

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
ANNOT_DIR = os.path.join(ROOT, 'scripts', '_annot')
SOURCE_DIR = os.path.join(ROOT, 'source')

# slug -> relative source path
MAPPING = {
    'src_utils_attribution_ts': 'src/utils/attribution.ts',
    'src_utils_task_TaskOutput_ts': 'src/utils/task/TaskOutput.ts',
    'src_utils_permissions_PermissionUpdate_ts': 'src/utils/permissions/PermissionUpdate.ts',
    'src_utils_plugins_lspPluginIntegration_ts': 'src/utils/plugins/lspPluginIntegration.ts',
    'src_utils_readFileInRange_ts': 'src/utils/readFileInRange.ts',
    'src_utils_markdown_ts': 'src/utils/markdown.ts',
    'src_utils_swarm_It2SetupPrompt_tsx': 'src/utils/swarm/It2SetupPrompt.tsx',
    'src_utils_plugins_lspRecommendation_ts': 'src/utils/plugins/lspRecommendation.ts',
    'src_utils_swarm_backends_ITermBackend_ts': 'src/utils/swarm/backends/ITermBackend.ts',
    'src_utils_frontmatterParser_ts': 'src/utils/frontmatterParser.ts',
    'src_utils_shell_prefix_ts': 'src/utils/shell/prefix.ts',
    'src_utils_log_ts': 'src/utils/log.ts',
    'src_utils_status_tsx': 'src/utils/status.tsx',
    'src_utils_releaseNotes_ts': 'src/utils/releaseNotes.ts',
    'src_utils_swarm_backends_PaneBackendExecutor_ts': 'src/utils/swarm/backends/PaneBackendExecutor.ts',
}

VALID_POS = {'before', 'after', 'after_block'}
errors = []
total_anchors = 0


def load_module(path):
    spec = importlib.util.spec_from_file_location('datamod', path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


for slug, rel in MAPPING.items():
    fname = f'{slug}_p1.py'
    fpath = os.path.join(ANNOT_DIR, fname)
    if not os.path.exists(fpath):
        errors.append(f'MISSING data file: {fname}')
        continue
    # slug <-> path one-to-one
    # ast.parse whole file
    try:
        with open(fpath, encoding='utf-8') as f:
            src = f.read()
        ast.parse(src)
    except SyntaxError as e:
        errors.append(f'AST PARSE FAIL {fname}: {e}')
        continue
    # load
    try:
        mod = load_module(fpath)
    except Exception as e:
        errors.append(f'IMPORT FAIL {fname}: {e!r}')
        continue
    if not hasattr(mod, 'ANNOTATIONS'):
        errors.append(f'NO ANNOTATIONS in {fname}')
        continue
    annots = mod.ANNOTATIONS
    if not isinstance(annots, list):
        errors.append(f'ANNOTATIONS not list in {fname}')
        continue
    # source line count
    spath = os.path.join(SOURCE_DIR, rel)
    if not os.path.exists(spath):
        errors.append(f'SOURCE MISSING for {slug}: {rel}')
        continue
    with open(spath, encoding='utf-8') as f:
        line_count = sum(1 for _ in f)
    seen = set()
    for i, a in enumerate(annots):
        if not isinstance(a, tuple) or len(a) != 3:
            errors.append(f'{fname}[{i}] not (line,pos,text): {a!r}')
            continue
        ln, pos, text = a
        if not isinstance(ln, int):
            errors.append(f'{fname}[{i}] line not int: {ln!r}')
        elif not (1 <= ln <= line_count):
            errors.append(f'{fname}[{i}] line {ln} out of range (1..{line_count})')
        if pos not in VALID_POS:
            errors.append(f'{fname}[{i}] bad pos: {pos!r}')
        if not isinstance(text, str):
            errors.append(f'{fname}[{i}] text not str')
        else:
            if '"' in text:
                errors.append(f'{fname}[{i}] text contains double-quote')
            if '\\' in text:
                errors.append(f'{fname}[{i}] text contains backslash')
        key = (ln, pos)
        if key in seen:
            errors.append(f'{fname}[{i}] duplicate anchor (line={ln}, pos={pos})')
        seen.add(key)
        total_anchors += 1

print(f'Data files checked: {len(MAPPING)}')
print(f'Total anchors: {total_anchors}')
if errors:
    print(f'FAILURES ({len(errors)}):')
    for e in errors:
        print('  -', e)
    sys.exit(1)
else:
    print('ALL PRECHECKS PASSED')
