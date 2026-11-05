import importlib.util
import ast
import os
import sys

SRC_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', 'source'))

SLUG_TO_PATH = {
    'src_commands_install_github_app_ApiKeyStep_tsx': 'src/commands/install-github-app/ApiKeyStep.tsx',
    'src_types_generated_events_mono_growthbook_v1_growthbook_experiment_event_ts': 'src/types/generated/events_mono/growthbook/v1/growthbook_experiment_event.ts',
    'src_schemas_hooks_ts': 'src/schemas/hooks.ts',
    'src_context_stats_tsx': 'src/context/stats.tsx',
    'src_skills_bundledSkills_ts': 'src/skills/bundledSkills.ts',
    'src_constants_outputStyles_ts': 'src/constants/outputStyles.ts',
    'src_types_command_ts': 'src/types/command.ts',
    'src_commands_tag_tag_tsx': 'src/commands/tag/tag.tsx',
    'src_server_directConnectManager_ts': 'src/server/directConnectManager.ts',
    'src_commands_install_github_app_ChooseRepoStep_tsx': 'src/commands/install-github-app/ChooseRepoStep.tsx',
}

VALID_POS = {'before', 'after', 'after_block'}
DATA_DIR = os.path.join(os.path.dirname(__file__))

errors = []
ok = 0

for slug, rel in SLUG_TO_PATH.items():
    fname = slug + '_p1.py'
    fpath = os.path.join(DATA_DIR, fname)
    if not os.path.exists(fpath):
        errors.append('[MISSING FILE] ' + fname)
        continue
    spec = importlib.util.spec_from_file_location(slug, fpath)
    mod = importlib.util.module_from_spec(spec)
    try:
        spec.loader.exec_module(mod)
    except Exception as e:
        errors.append('[IMPORT FAIL] ' + fname + ': ' + repr(e))
        continue
    if not hasattr(mod, 'ANNOTATIONS'):
        errors.append('[NO ANNOTATIONS] ' + fname)
        continue
    try:
        with open(fpath, 'r', encoding='utf-8') as f:
            ast.parse(f.read())
    except SyntaxError as e:
        errors.append('[AST FAIL] ' + fname + ': ' + str(e))
        continue
    src_path = os.path.join(SRC_ROOT, rel)
    if not os.path.exists(src_path):
        errors.append('[SRC MISSING] ' + rel)
        continue
    with open(src_path, 'r', encoding='utf-8') as f:
        nlines = sum(1 for _ in f)
    seen = set()
    for entry in mod.ANNOTATIONS:
        if not (isinstance(entry, tuple) and len(entry) == 3):
            errors.append('[BAD ENTRY] ' + fname + ': ' + repr(entry))
            continue
        ln, pos, text = entry
        if pos not in VALID_POS:
            errors.append('[BAD POS] ' + fname + ': line ' + str(ln) + ' pos=' + repr(pos))
        if not (isinstance(ln, int) and 1 <= ln <= nlines):
            errors.append('[BAD LINE] ' + fname + ': line ' + str(ln) + ' (src has ' + str(nlines) + ')')
        if not isinstance(text, str):
            errors.append('[BAD TEXT] ' + fname + ': line ' + str(ln) + ' text not str')
        else:
            if '"' in text:
                errors.append('[FORBIDDEN "] ' + fname + ': line ' + str(ln))
            if '\\' in text:
                errors.append('[FORBIDDEN \\] ' + fname + ': line ' + str(ln))
        key = (ln, pos)
        if key in seen:
            errors.append('[DUP ANCHOR] ' + fname + ': (' + str(ln) + ',' + pos + ')')
        seen.add(key)
    ok += 1

total_anchors = 0
for slug in SLUG_TO_PATH:
    fpath = os.path.join(DATA_DIR, slug + '_p1.py')
    spec = importlib.util.spec_from_file_location('reload_' + slug, fpath)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    total_anchors += len(m.ANNOTATIONS)

print('Loaded OK: ' + str(ok) + '/' + str(len(SLUG_TO_PATH)))
print('Total anchors: ' + str(total_anchors))

if errors:
    print('=== ERRORS ===')
    for e in errors:
        print(e)
    sys.exit(1)
else:
    print('ALL PREFLIGHT CHECKS PASSED')
