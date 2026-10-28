# 批 69 预检：验证 10 份数据文件
import os, sys, ast, importlib.util

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
ANNOT_DIR = os.path.join(ROOT, 'scripts', '_annot')

# slug -> source 相对路径（与文件名一一对应）
MAP = {
    'src_utils_claudeInChrome_setupPortable_ts': 'src/utils/claudeInChrome/setupPortable.ts',
    'src_utils_sessionStart_ts': 'src/utils/sessionStart.ts',
    'src_utils_modelCost_ts': 'src/utils/modelCost.ts',
    'src_utils_secureStorage_macOsKeychainStorage_ts': 'src/utils/secureStorage/macOsKeychainStorage.ts',
    'src_utils_bash_parser_ts': 'src/utils/bash/parser.ts',
    'src_utils_permissions_shellRuleMatching_ts': 'src/utils/permissions/shellRuleMatching.ts',
    'src_utils_readEditContext_ts': 'src/utils/readEditContext.ts',
    'src_utils_dxt_zip_ts': 'src/utils/dxt/zip.ts',
    'src_utils_notebook_ts': 'src/utils/notebook.ts',
    'src_utils_sideQuery_ts': 'src/utils/sideQuery.ts',
}

VALID_POS = {'before', 'after', 'after_block'}
errors = []

for slug, rel in MAP.items():
    fname = slug + '_p1.py'
    fpath = os.path.join(ANNOT_DIR, fname)
    if not os.path.exists(fpath):
        errors.append('MISSING %s' % fname)
        continue
    # ast.parse 整文件
    try:
        src_text = open(fpath, encoding='utf-8').read()
        ast.parse(src_text)
    except SyntaxError as e:
        errors.append('AST %s: %s' % (fname, e))
        continue
    # importlib 执行
    spec = importlib.util.spec_from_file_location(slug, fpath)
    mod = importlib.util.module_from_spec(spec)
    try:
        spec.loader.exec_module(mod)
    except Exception as e:
        errors.append('EXEC %s: %s' % (fname, e))
        continue
    ann = getattr(mod, 'ANNOTATIONS', None)
    if not isinstance(ann, list):
        errors.append('NO-ANN %s' % fname)
        continue
    # 源文件行数（split('\n') 口径与 annotate.py 对齐）
    sp = os.path.join(ROOT, 'source', rel)
    with open(sp, encoding='utf-8') as f:
        nlines = len(f.read().split('\n'))
    seen = set()
    for tup in ann:
        if not (isinstance(tup, tuple) and len(tup) == 3):
            errors.append('TUPLE %s: %r' % (fname, tup))
            continue
        lineno, pos, text = tup
        if pos not in VALID_POS:
            errors.append('POS %s L%d: %r' % (fname, lineno, pos))
        if not (1 <= lineno <= nlines):
            errors.append('LINE %s: %d not in [1,%d]' % (fname, lineno, nlines))
        if (lineno, pos) in seen:
            errors.append('DUP %s: (%d,%s)' % (fname, lineno, pos))
        seen.add((lineno, pos))
        if '"' in text or '\\' in text:
            errors.append('CHAR %s L%d: forbidden " or \\' % (fname, lineno))
        if not isinstance(text, str):
            errors.append('TEXT %s L%d: not str' % (fname, lineno))

if errors:
    print('PRECHECK FAILED:')
    for e in errors:
        print('  -', e)
    sys.exit(1)

total = 0
for slug in MAP:
    fpath = os.path.join(ANNOT_DIR, slug + '_p1.py')
    spec = importlib.util.spec_from_file_location(slug, fpath)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    total += len(mod.ANNOTATIONS)
print('PRECHECK OK: 10 files, slug<->path 1:1, pos valid, line bounds ok, no dup, no forbidden chars, ast.parse pass')
print('total anchors =', total)
