# -*- coding: utf-8 -*-
"""第 76 批数据文件预检：importlib 加载 + 硬断言。"""
import ast
import importlib.util
import os

HERE = os.path.abspath(__file__)
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(HERE)))
SOURCE_DIR = os.path.join(ROOT, 'source')
ANNOT_DIR = os.path.join(ROOT, 'scripts', '_annot')

VALID_POS = {'before', 'after', 'after_block'}

BATCH_FILES = [
    'src_utils_thinking_ts_p1.py',
    'src_utils_plugins_parseMarketplaceInput_ts_p1.py',
    'src_utils_localInstaller_ts_p1.py',
    'src_utils_githubRepoPathMapping_ts_p1.py',
    'src_utils_model_validateModel_ts_p1.py',
    'src_utils_debugFilter_ts_p1.py',
    'src_utils_plugins_pluginVersioning_ts_p1.py',
    'src_utils_model_agent_ts_p1.py',
    'src_utils_path_ts_p1.py',
    'src_utils_permissions_bypassPermissionsKillswitch_ts_p1.py',
]
batch_files = sorted(BATCH_FILES)

errors = []
path_to_slugs = {}

for name in batch_files:
    path = os.path.join(ANNOT_DIR, name)
    spec = importlib.util.spec_from_file_location(name[:-3], path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)

    # 整文件 ast 解析
    with open(path, encoding='utf-8') as fh:
        src_text = fh.read()
    try:
        ast.parse(src_text)
    except SyntaxError as e:
        errors.append(f'{name}: ast.parse 失败 -> {e}')
        continue

    if not hasattr(mod, 'SOURCE_PATH'):
        errors.append(f'{name}: 缺 SOURCE_PATH')
        continue
    sp = mod.SOURCE_PATH
    slug = sp.replace('/', '_').replace('.', '_').replace('-', '_')
    stem = name[:-3]  # 去掉 .py
    if not stem.endswith('_p1'):
        errors.append(f'{name}: 文件名不以 _p1 结尾')
        continue
    if stem[:-3] != slug:
        errors.append(f'{name}: slug={stem[:-3]} 与 SOURCE_PATH 推导 {slug} 不一致')
        continue

    src_file = os.path.join(SOURCE_DIR, sp)
    if not os.path.exists(src_file):
        errors.append(f'{name}: 源文件不存在 {sp}')
        continue
    with open(src_file, encoding='utf-8') as fh:
        num_lines = len(fh.read().split('\n'))

    path_to_slugs.setdefault(sp, []).append(name)

    seen = set()
    for item in mod.ANNOTATIONS:
        if not isinstance(item, tuple) or len(item) != 3:
            errors.append(f'{name}: 条目格式错误 {item!r}')
            continue
        line, pos, text = item
        if pos not in VALID_POS:
            errors.append(f'{name}: pos 非法 {pos!r} @line {line}')
        if not (1 <= line <= num_lines):
            errors.append(f'{name}: 行号越界 {line} (文件 {num_lines} 行)')
        if (line, pos) in seen:
            errors.append(f'{name}: 重复锚点 ({line},{pos})')
        seen.add((line, pos))
        if '"' in text or '\\' in text:
            errors.append(f'{name}: 文本含英文双引号或反斜杠 @line {line}: {text[:30]!r}')

# slug↔path 1:1
for sp, slugs in path_to_slugs.items():
    if len(slugs) != 1:
        errors.append(f'{sp}: 对应数据文件数 {len(slugs)}（应为 1）: {slugs}')

if errors:
    print('PRECHECK FAIL (%d 处):' % len(errors))
    for e in errors:
        print('  - ' + e)
    raise SystemExit(1)

print('PRECHECK OK: %d 个数据文件全部通过' % len(batch_files))
for name in batch_files:
    spec = importlib.util.spec_from_file_location(name[:-3],
        os.path.join(ANNOT_DIR, name))
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    print('  %-55s %2d 锚点  %s' % (name, len(m.ANNOTATIONS), m.SOURCE_PATH))
