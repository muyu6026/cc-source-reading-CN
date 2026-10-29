import os, sys, ast, importlib.util

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
ANNOT_DIR = HERE
SOURCE_DIR = os.path.join(ROOT, 'source')

MAPPING = {
    'src_utils_managedEnvConstants_ts': 'src/utils/managedEnvConstants.ts',
    'src_utils_hooks_fileChangedWatcher_ts': 'src/utils/hooks/fileChangedWatcher.ts',
    'src_utils_terminalPanel_ts': 'src/utils/terminalPanel.ts',
    'src_utils_mcpOutputStorage_ts': 'src/utils/mcpOutputStorage.ts',
    'src_utils_promptEditor_ts': 'src/utils/promptEditor.ts',
    'src_utils_powershell_dangerousCmdlets_ts': 'src/utils/powershell/dangerousCmdlets.ts',
    'src_utils_genericProcessUtils_ts': 'src/utils/genericProcessUtils.ts',
    'src_utils_exampleCommands_ts': 'src/utils/exampleCommands.ts',
    'src_utils_envUtils_ts': 'src/utils/envUtils.ts',
    'src_utils_promptShellExecution_ts': 'src/utils/promptShellExecution.ts',
}

POS = {'before', 'after', 'after_block'}
errors = []

for slug, rel in MAPPING.items():
    data_path = os.path.join(ANNOT_DIR, slug + '_p1.py')
    if not os.path.exists(data_path):
        errors.append('%s: 数据文件缺失 %s' % (slug, data_path))
        continue
    with open(data_path, encoding='utf-8') as f:
        src = f.read()
    try:
        ast.parse(src)
    except SyntaxError as e:
        errors.append('%s: ast.parse 失败 %s' % (slug, e))
        continue
    spec = importlib.util.spec_from_file_location(slug, data_path)
    mod = importlib.util.module_from_spec(spec)
    try:
        spec.loader.exec_module(mod)
    except Exception as e:
        errors.append('%s: 执行失败 %s' % (slug, e))
        continue
    if not hasattr(mod, 'ANNOTATIONS') or not isinstance(mod.ANNOTATIONS, list):
        errors.append('%s: 缺少 ANNOTATIONS 列表' % slug)
        continue
    source_path = os.path.join(SOURCE_DIR, rel)
    if not os.path.exists(source_path):
        errors.append('%s: 源文件缺失 %s' % (slug, source_path))
        continue
    with open(source_path, encoding='utf-8') as f:
        nlines = len(f.read().split('\n'))
    seen = set()
    for item in mod.ANNOTATIONS:
        if not (isinstance(item, tuple) and len(item) == 3):
            errors.append('%s: 条目格式错误 %r' % (slug, item))
            continue
        line, pos, text = item
        if not isinstance(line, int) or not isinstance(pos, str) or not isinstance(text, str):
            errors.append('%s: 类型错误 %r' % (slug, item))
            continue
        if pos not in POS:
            errors.append('%s: 非法位置 %s' % (slug, pos))
        if not (1 <= line <= nlines):
            errors.append('%s: 行号越界 %d (文件 %d 行)' % (slug, line, nlines))
        if (line, pos) in seen:
            errors.append('%s: 重复锚点 %r' % (slug, (line, pos)))
        seen.add((line, pos))
        if '"' in text or '\\' in text:
            errors.append('%s: 文本含禁用字符 (line=%d) -> %s' % (slug, line, text[:30]))

if errors:
    print('PRECHECK FAILED:')
    for e in errors:
        print('  -', e)
    sys.exit(1)
print('PRECHECK OK: %d 数据文件全部通过' % len(MAPPING))
