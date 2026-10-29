# 预检脚本：第 74 批 15 个数据文件
# ROOT 用本文件所在目录上溯三层（scripts/_annot -> scripts -> 仓库根）
import os
import ast
import importlib.util

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# slug -> source 相对路径（与 annotate.py 的 slug 计算保持一致）
TARGETS = {
    'src_utils_editor_ts': 'src/utils/editor.ts',
    'src_utils_groupToolUses_ts': 'src/utils/groupToolUses.ts',
    'src_utils_mtls_ts': 'src/utils/mtls.ts',
    'src_utils_truncate_ts': 'src/utils/truncate.ts',
    'src_utils_queryContext_ts': 'src/utils/queryContext.ts',
    'src_utils_plugins_loadPluginOutputStyles_ts': 'src/utils/plugins/loadPluginOutputStyles.ts',
    'src_utils_detectRepository_ts': 'src/utils/detectRepository.ts',
    'src_utils_plugins_pluginDirectories_ts': 'src/utils/plugins/pluginDirectories.ts',
    'src_utils_agentContext_ts': 'src/utils/agentContext.ts',
    'src_utils_headlessProfiler_ts': 'src/utils/headlessProfiler.ts',
    'src_utils_diff_ts': 'src/utils/diff.ts',
    'src_utils_plugins_headlessPluginInstall_ts': 'src/utils/plugins/headlessPluginInstall.ts',
    'src_utils_windowsPaths_ts': 'src/utils/windowsPaths.ts',
    'src_utils_treeify_ts': 'src/utils/treeify.ts',
    'src_utils_deepLink_parseDeepLink_ts': 'src/utils/deepLink/parseDeepLink.ts',
}

ANNOT_DIR = os.path.join(ROOT, 'scripts', '_annot')
POS_OK = {'before', 'after', 'after_block'}

total = 0
problems = 0
for slug, rel in TARGETS.items():
    data_file = os.path.join(ANNOT_DIR, slug + '_p1.py')
    src_file = os.path.join(ROOT, 'source', rel)
    if not os.path.exists(data_file):
        print('MISSING 数据文件:', data_file); problems += 1; continue
    if not os.path.exists(src_file):
        print('MISSING 源文件:', src_file); problems += 1; continue
    with open(src_file, encoding='utf-8') as f:
        src_len = len(f.read().split('\n'))
        if src_len and src_len > 0 and f:
            pass
    # 行数口径：与 annotate.py 一致（split('\n')，末尾空串不计入）
    with open(src_file, encoding='utf-8', newline='') as f:
        raw = f.read()
    lines = raw.split('\n')
    if lines and lines[-1] == '':
        src_len = len(lines) - 1
    else:
        src_len = len(lines)
    try:
        spec = importlib.util.spec_from_file_location(slug, data_file)
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        ann = mod.ANNOTATIONS
    except Exception as e:
        print('LOAD ERROR %s: %s' % (slug, e)); problems += 1; continue
    # ast.parse 整文件
    try:
        with open(data_file, encoding='utf-8') as f:
            ast.parse(f.read())
    except SyntaxError as e:
        print('AST ERROR %s: %s' % (slug, e)); problems += 1; continue
    seen = set()
    file_problems = 0
    for item in ann:
        if not (isinstance(item, tuple) and len(item) == 3):
            print('BAD ITEM %s: %r' % (slug, item)); file_problems += 1; continue
        ln, pos, text = item
        if pos not in POS_OK:
            print('BAD POS %s line %s: %s' % (slug, ln, pos)); file_problems += 1
        if not (1 <= ln <= src_len):
            print('BAD LINE %s: %s (源文件 %d 行)' % (slug, ln, src_len)); file_problems += 1
        if (ln, pos) in seen:
            print('DUP ANCHOR %s: (%s,%s)' % (slug, ln, pos)); file_problems += 1
        seen.add((ln, pos))
        if '"' in text or '\\' in text:
            print('FORBIDDEN CHAR %s line %s: 含英文双引号或反斜杠' % (slug, ln)); file_problems += 1
    if file_problems:
        problems += file_problems
        print('  %s: %d 处问题' % (slug, file_problems))
    else:
        print('OK %s (%d 锚点, 源 %d 行)' % (slug, len(ann), src_len))
    total += len(ann)

print('---')
print('合计锚点: %d, 问题文件/项: %d' % (total, problems))
if problems:
    raise SystemExit('预检未通过')
