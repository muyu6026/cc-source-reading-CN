# -*- coding: utf-8 -*-
import ast, importlib.util, os, sys

SRC_ROOT = os.path.join(os.path.dirname(__file__), '..', '..', 'source')
ANNOT_DIR = os.path.dirname(__file__)

# (slug, relative source path)
FILES = [
    ('src_utils_permissions_classifierShared_ts', 'src/utils/permissions/classifierShared.ts'),
    ('src_utils_envValidation_ts', 'src/utils/envValidation.ts'),
    ('src_utils_execSyncWrapper_ts', 'src/utils/execSyncWrapper.ts'),
    ('src_utils_task_outputFormatting_ts', 'src/utils/task/outputFormatting.ts'),
    ('src_utils_cachePaths_ts', 'src/utils/cachePaths.ts'),
    ('src_utils_settings_internalWrites_ts', 'src/utils/settings/internalWrites.ts'),
    ('src_utils_task_sdkProgress_ts', 'src/utils/task/sdkProgress.ts'),
    ('src_utils_semanticNumber_ts', 'src/utils/semanticNumber.ts'),
    ('src_utils_modifiers_ts', 'src/utils/modifiers.ts'),
    ('src_utils_permissions_PermissionResult_ts', 'src/utils/permissions/PermissionResult.ts'),
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
    """Return set of 1-based line numbers that lie strictly INSIDE a /* */ block."""
    inside = False
    res = set()
    for i, ln in enumerate(src_lines, start=1):
        stripped = ln.strip()
        if not inside:
            # detect block start
            idx = ln.find('/*')
            if idx != -1:
                # if same line also has */ it's a single-line block; treat interior as none
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
    # ast check on the DATA FILE (the .py), not the .ts source
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
        # block interior detection (skip exemption: line 1 after, and block open/close lines)
        if (ln, pos) != (1, 'after') and ln not in interior:
            # also exempt: if line is a block-open (contains /* not closed) or block-close (contains */)
            line_txt = src_lines[ln-1]
            is_open = ('/*' in line_txt and '*/' not in line_txt.split('/*',1)[1])
            is_close = ('*/' in line_txt)
            if ln in interior and not (is_open or is_close):
                # truly interior
                print(f'FAIL {rel}: anchor line {ln} ({pos}) lands inside /* */ block')
                fail += 1

print(f'\nTOTAL anchors: {total_anchors}, FAIL files/checks: {fail}')
sys.exit(1 if fail else 0)
