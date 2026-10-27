# -*- coding: utf-8 -*-
import importlib.util, os

ROOT = 'D:/CC泄露源码分析'
DATA_DIR = os.path.join(ROOT, 'scripts', '_annot')
SRC_DIR = os.path.join(ROOT, 'source')

FILES = [
    ('src_utils_powershell_staticPrefix_ts', 'src/utils/powershell/staticPrefix.ts'),
    ('src_utils_settings_mdm_settings_ts', 'src/utils/settings/mdm/settings.ts'),
    ('src_utils_skills_skillChangeDetector_ts', 'src/utils/skills/skillChangeDetector.ts'),
    ('src_utils_swarm_backends_types_ts', 'src/utils/swarm/backends/types.ts'),
    ('src_utils_hooks_AsyncHookRegistry_ts', 'src/utils/hooks/AsyncHookRegistry.ts'),
    ('src_utils_format_ts', 'src/utils/format.ts'),
    ('src_utils_cron_ts', 'src/utils/cron.ts'),
    ('src_utils_task_framework_ts', 'src/utils/task/framework.ts'),
    ('src_utils_agenticSessionSearch_ts', 'src/utils/agenticSessionSearch.ts'),
    ('src_utils_plugins_dependencyResolver_ts', 'src/utils/plugins/dependencyResolver.ts'),
]

VALID = {'before', 'after', 'after_block'}


def load(modname):
    path = os.path.join(DATA_DIR, modname + '.py')
    spec = importlib.util.spec_from_file_location(modname, path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


ok = True
for slug, rel in FILES:
    src = os.path.join(SRC_DIR, rel)
    with open(src, encoding='utf-8') as f:
        n = len(f.read().splitlines())
    mod = load(slug)
    ann = mod.ANNOTATIONS
    # type check
    if not isinstance(ann, list):
        print(f'FAIL {slug}: ANNOTATIONS not a list'); ok = False
    seen = set()
    for item in ann:
        if not (isinstance(item, tuple) and len(item) == 3):
            print(f'FAIL {slug}: bad tuple {item!r}'); ok = False; continue
        line, pos, text = item
        if pos not in VALID:
            print(f'FAIL {slug}: bad pos {pos!r}'); ok = False
        if not (1 <= line <= n):
            print(f'FAIL {slug}: line {line} out of [1,{n}]'); ok = False
        if (line, pos) in seen:
            print(f'FAIL {slug}: dup anchor {(line, pos)}'); ok = False
        seen.add((line, pos))
        if '"' in text or '\\' in text:
            print(f'FAIL {slug}: line {line} contains quote/backslash'); ok = False
    # ast.parse whole file
    path = os.path.join(DATA_DIR, slug + '.py')
    with open(path, encoding='utf-8') as f:
        code = f.read()
    try:
        compile(code, path, 'exec')
    except SyntaxError as e:
        print(f'FAIL {slug}: syntax error {e}'); ok = False
    print(f'OK {slug}: {len(ann)} anchors, src {n} lines')

print('ALL OK' if ok else 'HAS FAILURES')
