# 预检脚本 · 第 82 批：对 10 个数据文件做断言
import os, sys, importlib.util, ast

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
ANNOT_DIR = os.path.join(ROOT, 'scripts', '_annot')

PAIRS = [
  ('src/utils/settings/toolValidationConfig.ts', 'src_utils_settings_toolValidationConfig_ts'),
  ('src/utils/inProcessTeammateHelpers.ts', 'src_utils_inProcessTeammateHelpers_ts'),
  ('src/utils/fileRead.ts', 'src_utils_fileRead_ts'),
  ('src/utils/permissions/getNextPermissionMode.ts', 'src_utils_permissions_getNextPermissionMode_ts'),
  ('src/utils/model/deprecation.ts', 'src_utils_model_deprecation_ts'),
  ('src/utils/bufferedWriter.ts', 'src_utils_bufferedWriter_ts'),
  ('src/utils/processUserInput/processTextPrompt.ts', 'src_utils_processUserInput_processTextPrompt_ts'),
  ('src/utils/agentId.ts', 'src_utils_agentId_ts'),
  ('src/utils/git/gitignore.ts', 'src_utils_git_gitignore_ts'),
  ('src/utils/subprocessEnv.ts', 'src_utils_subprocessEnv_ts'),
]

errors = []
for rel, slug in PAIRS:
    data_file = os.path.join(ANNOT_DIR, slug + '_p1.py')
    if not os.path.exists(data_file):
        errors.append('MISSING data file: ' + data_file)
        continue
    with open(data_file, encoding='utf-8') as f:
        src_txt = f.read()
    try:
        ast.parse(src_txt)
    except SyntaxError as e:
        errors.append('AST FAIL %s: %s' % (slug, e))
        continue
    spec = importlib.util.spec_from_file_location(slug, data_file)
    mod = importlib.util.module_from_spec(spec)
    try:
        spec.loader.exec_module(mod)
    except Exception as e:
        errors.append('EXEC FAIL %s: %r' % (slug, e))
        continue
    ann = getattr(mod, 'ANNOTATIONS', None)
    if ann is None:
        errors.append('NO ANNOTATIONS in ' + slug)
        continue
    src_path = os.path.join(ROOT, 'source', rel)
    with open(src_path, encoding='utf-8') as f:
        lines = f.read().split('\n')
    nlines = len(lines)
    seen = set()
    for item in ann:
        if not (isinstance(item, tuple) and len(item) == 3):
            errors.append('%s: bad item %r' % (slug, item))
            continue
        line, pos, text = item
        if pos not in ('before', 'after', 'after_block'):
            errors.append('%s: bad pos %s at line %s' % (slug, pos, line))
        if not (1 <= line <= nlines):
            errors.append('%s: line %s out of range (1..%s)' % (slug, line, nlines))
        if (line, pos) in seen:
            errors.append('%s: duplicate anchor (line=%s, pos=%s)' % (slug, line, pos))
        seen.add((line, pos))
        if '"' in text or '\\' in text:
            errors.append('%s: forbidden char in text at line %s: %r' % (slug, line, text[:40]))
        if not isinstance(text, str):
            errors.append('%s: text not str at line %s' % (slug, line))

if errors:
    print('PRECHECK FAILED:')
    for e in errors:
        print('  -', e)
    sys.exit(1)
print('PRECHECK OK: %d files, all anchors valid' % len(PAIRS))
