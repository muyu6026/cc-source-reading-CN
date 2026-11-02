# -*- coding: utf-8 -*-
import ast, importlib.util, os, sys

SRC_ROOT = os.path.join(os.path.dirname(__file__), '..', '..', 'source')
ANNOT_DIR = os.path.dirname(__file__)

# (slug, relative source path)
FILES = [
    ('src_utils_settings_managedPath_ts', 'src/utils/settings/managedPath.ts'),
    ('src_utils_swarm_constants_ts', 'src/utils/swarm/constants.ts'),
    ('src_utils_shell_shellProvider_ts', 'src/utils/shell/shellProvider.ts'),
    ('src_utils_cwd_ts', 'src/utils/cwd.ts'),
    ('src_utils_settings_allErrors_ts', 'src/utils/settings/allErrors.ts'),
    ('src_utils_controlMessageCompat_ts', 'src/utils/controlMessageCompat.ts'),
    ('src_utils_bash_specs_srun_ts', 'src/utils/bash/specs/srun.ts'),
    ('src_utils_tempfile_ts', 'src/utils/tempfile.ts'),
    ('src_utils_computerUse_inputLoader_ts', 'src/utils/computerUse/inputLoader.ts'),
    ('src_utils_semanticBoolean_ts', 'src/utils/semanticBoolean.ts'),
]

VALID_POS = {'before', 'after', 'after_block'}
fail = 0
total_anchors = 0

def load(slug):
    p = os.path.join(ANNOT_DIR, slug + '_p1.py')
    spec = importlib.util.spec_from_file_location(slug, p)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m

def block_interior_lines(src_lines):
    inside = False
    res = set()
    for i, ln in enumerate(src_lines, start=1):
        if not inside:
            idx = ln.find('/*')
            if idx != -1:
                after = ln[idx+2:]
                if '*/' in after:
                    continue
                inside = True
                continue
        else:
            res.add(i)
            if '*/' in ln:
                inside = False
            continue
    return res

for slug, rel in FILES:
    m = load(slug)
    annots = m.ANNOTATIONS
    total_anchors += len(annots)
    sp = os.path.join(SRC_ROOT, rel)
    with open(sp, encoding='utf-8') as f:
        src = f.read()
    src_lines = src.split('\n')
    nlines = len(src_lines)
    # ast check on the DATA FILE (.py), not the .ts source
    dp = os.path.join(ANNOT_DIR, slug + '_p1.py')
    try:
        ast.parse(open(dp, encoding='utf-8').read())
    except SyntaxError as e:
        print(f'FAIL {slug}: data-file ast.parse error {e}')
        fail += 1
    interior = block_interior_lines(src_lines)
    seen = set()
    for tup in annots:
        if not (isinstance(tup, tuple) and len(tup) == 3):
            print(f'FAIL {rel}: bad tuple {tup!r}')
            fail += 1
            continue
        ln, pos, text = tup
        if pos not in VALID_POS:
            print(f'FAIL {rel}: pos {pos!r} invalid')
            fail += 1
        if not (1 <= ln <= nlines):
            print(f'FAIL {rel}: line {ln} out of range (1..{nlines})')
            fail += 1
        if (ln, pos) in seen:
            print(f'FAIL {rel}: duplicate anchor (line {ln}, {pos})')
            fail += 1
        seen.add((ln, pos))
        if '"' in text or '\\' in text:
            print(f'FAIL {rel}: line {ln} text contains " or backslash')
            fail += 1
        if (ln, pos) != (1, 'after') and ln in interior:
            line_txt = src_lines[ln-1]
            is_open = ('/*' in line_txt and '*/' not in line_txt.split('/*',1)[1])
            is_close = ('*/' in line_txt)
            if not (is_open or is_close):
                print(f'FAIL {rel}: anchor line {ln} ({pos}) lands inside /* */ block')
                fail += 1

print(f'\nTOTAL anchors: {total_anchors}, FAIL files/checks: {fail}')
sys.exit(1 if fail else 0)
