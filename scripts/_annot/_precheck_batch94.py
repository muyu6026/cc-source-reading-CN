import os
import sys
import importlib.util

ROOT = 'D:/CC泄露源码分析'
ANNOT_DIR = os.path.join(ROOT, 'scripts', '_annot')

# (slug, relative source path)
PAIRS = [
    ('src_utils_agentSwarmsEnabled_ts', 'src/utils/agentSwarmsEnabled.ts'),
    ('src_utils_lockfile_ts', 'src/utils/lockfile.ts'),
    ('src_utils_signal_ts', 'src/utils/signal.ts'),
    ('src_utils_model_providers_ts', 'src/utils/model/providers.ts'),
    ('src_utils_permissions_PermissionRule_ts', 'src/utils/permissions/PermissionRule.ts'),
    ('src_utils_hyperlink_ts', 'src/utils/hyperlink.ts'),
    ('src_utils_unaryLogging_ts', 'src/utils/unaryLogging.ts'),
    ('src_utils_permissions_autoModeState_ts', 'src/utils/permissions/autoModeState.ts'),
    ('src_utils_telemetry_skillLoadedEvent_ts', 'src/utils/telemetry/skillLoadedEvent.ts'),
    ('src_utils_timeouts_ts', 'src/utils/timeouts.ts'),
]

POS_OK = {'before', 'after', 'after_block'}
problems = 0
total_anchors = 0


def load(slug):
    path = os.path.join(ANNOT_DIR, slug + '_p1.py')
    spec = importlib.util.spec_from_file_location(slug, path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def block_scan(lines):
    """Return (interior_lines, close_lines). Open line and close line are exempt."""
    in_block = False
    interior = set()
    close_lines = set()
    for i, line in enumerate(lines, 1):
        if not in_block:
            if '/*' in line:
                in_block = True
                if '*/' in line:
                    in_block = False  # single-line block
                # open line exempt
            # normal line
        else:
            if '*/' in line:
                in_block = False
                close_lines.add(i)  # close line exempt for 'before'
            else:
                interior.add(i)
    return interior, close_lines


for slug, rel in PAIRS:
    src = os.path.join(ROOT, 'source', rel)
    with open(src, encoding='utf-8') as f:
        src_lines = f.read().splitlines()
    n = len(src_lines)
    interior, close_lines = block_scan(src_lines)

    mod = load(slug)
    ann = mod.ANNOTATIONS
    total_anchors += len(ann)
    seen = set()
    for ln, pos, txt in ann:
        tag = f'[{slug}] line {ln} {pos}'
        if pos not in POS_OK:
            print(f'  BAD POS {tag}'); problems += 1
        if not (1 <= ln <= n):
            print(f'  BAD LINE {tag} (file has {n} lines)'); problems += 1
        if '"' in txt or '\\' in txt:
            print(f'  BAD CHAR {tag} (contains " or backslash)'); problems += 1
        if (ln, pos) in seen:
            print(f'  DUP {tag}'); problems += 1
        seen.add((ln, pos))
        if ln in interior:
            print(f'  INSIDE BLOCK {tag}'); problems += 1
        if pos == 'after' and ln in close_lines:
            print(f'  AFTER-CLOSE {tag} (rule 8)'); problems += 1
    print(f'  ok {slug}: {len(ann)} anchors, {n} src lines, interior={sorted(interior)}')

print(f'\nTOTAL anchors={total_anchors}, problems={problems}')
sys.exit(1 if problems else 0)
