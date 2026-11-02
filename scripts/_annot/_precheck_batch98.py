import ast
import importlib.util
import os
import sys

ROOT = 'D:/CC泄露源码分析'
ANNOT_DIR = os.path.join(ROOT, 'scripts', '_annot')
SOURCE_ROOT = os.path.join(ROOT, 'source')

PAIRS = {
    'src_utils_autoModeDenials_ts': 'src/utils/autoModeDenials.ts',
    'src_utils_ink_ts': 'src/utils/ink.ts',
    'src_utils_plugins_officialMarketplace_ts': 'src/utils/plugins/officialMarketplace.ts',
    'src_utils_model_aliases_ts': 'src/utils/model/aliases.ts',
    'src_utils_cleanupRegistry_ts': 'src/utils/cleanupRegistry.ts',
    'src_utils_computerUse_swiftLoader_ts': 'src/utils/computerUse/swiftLoader.ts',
    'src_utils_extraUsage_ts': 'src/utils/extraUsage.ts',
    'src_utils_standaloneAgent_ts': 'src/utils/standaloneAgent.ts',
    'src_utils_zodToJsonSchema_ts': 'src/utils/zodToJsonSchema.ts',
    'src_utils_bundledMode_ts': 'src/utils/bundledMode.ts',
}


def load_module(slug):
    path = os.path.join(ANNOT_DIR, slug + '_p1.py')
    spec = importlib.util.spec_from_file_location(slug, path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def source_lines(rel):
    with open(os.path.join(SOURCE_ROOT, rel), encoding='utf-8') as f:
        return f.read().splitlines()


def block_interior_lines(lines):
    interior = set()
    in_block = False
    for i, ln in enumerate(lines, start=1):
        s = ln.strip()
        if in_block:
            interior.add(i)
            if s.endswith('*/'):
                in_block = False
        else:
            if s.startswith('/*') and not s.endswith('*/'):
                in_block = True
    return interior


fails = 0
total_anchors = 0
for slug, rel in PAIRS.items():
    path = os.path.join(ANNOT_DIR, slug + '_p1.py')
    if not os.path.exists(path):
        print(f'MISSING data file: {slug}')
        fails += 1
        continue
    with open(path, encoding='utf-8') as f:
        src = f.read()
    try:
        ast.parse(src)
    except SyntaxError as e:
        print(f'AST FAIL {slug}: {e}')
        fails += 1
        continue
    mod = load_module(slug)
    ann = mod.ANNOTATIONS
    srclines = source_lines(rel)
    n = len(srclines)
    interior = block_interior_lines(srclines)
    seen = set()
    for item in ann:
        total_anchors += 1
        if len(item) != 3:
            print(f'BAD ITEM {slug}: {item}')
            fails += 1
            continue
        line, pos, text = item
        if pos not in ('before', 'after', 'after_block'):
            print(f'BAD POS {slug}: {item}')
            fails += 1
        if not (1 <= line <= n):
            print(f'BAD LINE {slug}: line {line} not in 1..{n}')
            fails += 1
        if (line, pos) in seen:
            print(f'DUP ANCHOR {slug}: {(line, pos)}')
            fails += 1
        seen.add((line, pos))
        if '"' in text or '\\' in text:
            print(f'QUOTE/BACKSLASH {slug}: line {line}')
            fails += 1
        if line in interior:
            print(f'BLOCK INTERIOR {slug}: line {line}')
            fails += 1
    print(f'OK {slug}: {len(ann)} anchors, source {n} lines')

print(f'\nTOTAL anchors={total_anchors}, fails={fails}')
sys.exit(1 if fails else 0)
