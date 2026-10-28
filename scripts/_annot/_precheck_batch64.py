# 预检脚本（第 64 批）：校验本批 10 份数据文件
import ast
import importlib.util
import os
import sys

ROOT = 'D:/CC泄露源码分析'
ANNOT_DIR = os.path.join(ROOT, 'scripts', '_annot')
SOURCE_DIR = os.path.join(ROOT, 'source')

# slug -> 源文件相对路径（source/ 下）
FILES = {
    'src_utils_plugins_installCounts_ts': 'src/utils/plugins/installCounts.ts',
    'src_utils_messages_mappers_ts': 'src/utils/messages/mappers.ts',
    'src_utils_memoryFileDetection_ts': 'src/utils/memoryFileDetection.ts',
    'src_utils_telemetry_pluginTelemetry_ts': 'src/utils/telemetry/pluginTelemetry.ts',
    'src_utils_plugins_loadPluginHooks_ts': 'src/utils/plugins/loadPluginHooks.ts',
    'src_utils_filePersistence_filePersistence_ts': 'src/utils/filePersistence/filePersistence.ts',
    'src_utils_slowOperations_ts': 'src/utils/slowOperations.ts',
    'src_utils_plugins_pluginAutoupdate_ts': 'src/utils/plugins/pluginAutoupdate.ts',
    'src_utils_git_gitConfigParser_ts': 'src/utils/git/gitConfigParser.ts',
    'src_utils_json_ts': 'src/utils/json.ts',
}

VALID_POS = {'before', 'after', 'after_block'}
NG_CHARS = set('"\\')  # 英文双引号、反斜杠

errors = []


def load(slug):
    name = slug + '_p1.py'
    path = os.path.join(ANNOT_DIR, name)
    if not os.path.exists(path):
        errors.append('缺失数据文件: %s' % name)
        return None
    try:
        with open(path, encoding='utf-8') as f:
            ast.parse(f.read())
    except SyntaxError as e:
        errors.append('%s: ast.parse 失败: %s' % (name, e))
        return None
    spec = importlib.util.spec_from_file_location(slug, path)
    mod = importlib.util.module_from_spec(spec)
    try:
        spec.loader.exec_module(mod)
    except Exception as e:  # noqa
        errors.append('%s: 执行失败: %r' % (name, e))
        return None
    return getattr(mod, 'ANNOTATIONS', None)


total_ann = 0
for slug, rel in FILES.items():
    src = os.path.join(SOURCE_DIR, rel)
    if not os.path.exists(src):
        errors.append('源文件不存在: %s' % rel)
        continue
    n_lines = len(open(src, encoding='utf-8').read().splitlines())
    ann = load(slug)
    if ann is None:
        continue
    seen = set()
    for tup in ann:
        if not (isinstance(tup, tuple) and len(tup) == 3):
            errors.append('%s: 元组格式错误: %r' % (slug, tup))
            continue
        line, pos, text = tup
        if pos not in VALID_POS:
            errors.append('%s: 非法 pos=%r (行 %s)' % (slug, pos, line))
        if not (isinstance(line, int) and 1 <= line <= n_lines):
            errors.append('%s: 行号越界 %s (文件 %d 行)' % (slug, line, n_lines))
        if not isinstance(text, str):
            errors.append('%s: 文本非字符串 (行 %s)' % (slug, line))
        else:
            bad = [c for c in text if c in NG_CHARS]
            if bad:
                errors.append('%s: 文本含禁用字符 %r (行 %s)' % (slug, bad, line))
        if (line, pos) in seen:
            errors.append('%s: 重复锚点 (行 %s, %s)' % (slug, line, pos))
        seen.add((line, pos))
        total_ann += 1
    print('  %-50s %3d 锚点 / 源 %d 行  OK' % (rel, len(ann), n_lines))

print('合计 %d 锚点' % total_ann)
if errors:
    print('=== 预检失败 %d 项 ===' % len(errors))
    for e in errors:
        print('  -', e)
    sys.exit(1)
print('=== 预检全部通过 ===')
