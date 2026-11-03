# -*- coding: utf-8 -*-
import ast, importlib.util, os, sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SRC_ROOT = os.path.join(ROOT, 'source')
DATA_DIR = os.path.join(ROOT, 'scripts', '_annot')

PAIRS = [
    ('src_components_Settings_Config_tsx_p1.py', 'src/components/Settings/Config.tsx'),
    ('src_components_LogSelector_tsx_p1.py', 'src/components/LogSelector.tsx'),
]

POS = {'before', 'after', 'after_block'}
fail = 0
total = 0

for data_name, rel in PAIRS:
    path = os.path.join(DATA_DIR, data_name)
    slug = rel.replace('/', '_').replace('.', '_').replace('-', '_')
    if not data_name.startswith(slug):
        print('FAIL slug mismatch:', data_name, 'expected prefix', slug)
        fail += 1
        continue

    src_path = os.path.join(SRC_ROOT, rel)
    with open(src_path, encoding='utf-8') as f:
        src_lines = f.read().split('\n')
    n = len(src_lines)

    # data file itself must be valid python
    with open(path, encoding='utf-8') as f:
        code = f.read()
    try:
        ast.parse(code)
    except SyntaxError as e:
        print('FAIL ast:', data_name, e)
        fail += 1
        continue

    spec = importlib.util.spec_from_file_location('m_' + slug, path)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    anns = m.ANNOTATIONS

    # block comment interior lines (1-based)
    inside = set()
    in_block = False
    for i, line in enumerate(src_lines, 1):
        s = line.strip()
        if not in_block:
            if s.startswith('/*'):
                if s.endswith('*/') and len(s) > 3:
                    continue
                in_block = True
                if '*/' in s[2:]:
                    in_block = False
                continue
        else:
            if '*/' in s:
                in_block = False
            else:
                inside.add(i)

    seen = set()
    for lineno, pos, text in anns:
        total += 1
        if pos not in POS:
            print('FAIL pos:', data_name, lineno, pos)
            fail += 1
        if not (1 <= lineno <= n):
            print('FAIL range:', data_name, lineno, 'max', n)
            fail += 1
        if (lineno, pos) in seen:
            print('FAIL dup:', data_name, lineno, pos)
            fail += 1
        seen.add((lineno, pos))
        if '"' in text or '\\' in text:
            print('FAIL quote/backslash:', data_name, lineno)
            fail += 1
        if lineno in inside and pos in ('after', 'before', 'after_block'):
            s = src_lines[lineno - 1].strip()
            if not (s.startswith('/*') or s.endswith('*/')):
                print('FAIL inside block comment:', data_name, lineno, '|', s[:60])
                fail += 1
    print('OK', data_name, len(anns), 'anchors')

print('TOTAL', total, 'anchors, FAIL', fail)
sys.exit(1 if fail else 0)
