#!/usr/bin/env python3
# 预检脚本：校验本批 10 个数据文件的 slug↔path 对应、pos 合法、行号合法、无重复锚点、文本无英文双引号/反斜杠、ast.parse 通过。
import importlib.util
import os
import ast

ROOT = 'D:/CC泄露源码分析'
ANNOT_DIR = os.path.join(ROOT, 'scripts', '_annot')
SOURCE_DIR = os.path.join(ROOT, 'source')

VALID_POS = {'before', 'after', 'after_block'}

# 本批仅校验这 10 个新写的数据文件（避免误扫历史遗留文件）
BATCH_FILES = [
    'src_utils_sideQuestion_ts_p1.py',
    'src_utils_claudeDesktop_ts_p1.py',
    'src_utils_preflightChecks_tsx_p1.py',
    'src_utils_envDynamic_ts_p1.py',
    'src_utils_execFileNoThrow_ts_p1.py',
    'src_utils_platform_ts_p1.py',
    'src_utils_sessionState_ts_p1.py',
    'src_utils_swarm_spawnUtils_ts_p1.py',
    'src_utils_advisor_ts_p1.py',
    'src_utils_argumentSubstitution_ts_p1.py',
]

data_files = sorted(BATCH_FILES)

problems = []
loaded = 0
total_anchors = 0

for fn in data_files:
    path = os.path.join(ANNOT_DIR, fn)
    spec = importlib.util.spec_from_file_location(fn[:-3], path)
    mod = importlib.util.module_from_spec(spec)
    try:
        spec.loader.exec_module(mod)
    except Exception as e:
        problems.append(f'{fn}: 执行模块失败 {e!r}')
        continue
    loaded += 1

    # ast.parse 整文件
    try:
        with open(path, encoding='utf-8') as fh:
            ast.parse(fh.read())
    except SyntaxError as e:
        problems.append(f'{fn}: ast.parse 失败 {e}')
        continue

    source_path = getattr(mod, 'SOURCE_PATH', None)
    annotations = getattr(mod, 'ANNOTATIONS', None)
    if not source_path or not isinstance(annotations, list):
        problems.append(f'{fn}: 缺少 SOURCE_PATH 或 ANNOTATIONS')
        continue

    # slug ↔ path 1:1
    expected_fn = source_path.replace('/', '_').replace('.', '_').replace('-', '_') + '_p1.py'
    if expected_fn != fn:
        problems.append(f'{fn}: slug 不匹配，应为 {expected_fn}（SOURCE_PATH={source_path}）')

    src_file = os.path.join(SOURCE_DIR, source_path)
    if not os.path.exists(src_file):
        problems.append(f'{fn}: 源文件不存在 {source_path}')
        continue
    with open(src_file, encoding='utf-8') as fh:
        src_lines = fh.read().splitlines()
    n = len(src_lines)

    seen = set()
    for item in annotations:
        if not (isinstance(item, tuple) and len(item) == 3):
            problems.append(f'{fn}: 锚点格式错误 {item!r}')
            continue
        line, pos, text = item
        if pos not in VALID_POS:
            problems.append(f'{fn}: pos 非法 {pos!r} @ line {line}')
        if not (isinstance(line, int) and 1 <= line <= n):
            problems.append(f'{fn}: 行号越界 {line} (源共 {n} 行)')
        if not isinstance(text, str) or not text:
            problems.append(f'{fn}: 文本非法 @ line {line}')
        else:
            if '"' in text:
                problems.append(f'{fn}: 文本含英文双引号 @ line {line}')
            if '\\' in text:
                problems.append(f'{fn}: 文本含反斜杠 @ line {line}')
        key = (line, pos)
        if key in seen:
            problems.append(f'{fn}: 重复锚点 (line={line}, pos={pos})')
        seen.add(key)
        total_anchors += 1

print(f'加载数据文件: {loaded}/{len(data_files)}')
print(f'锚点总数: {total_anchors}')
if problems:
    print('=== 预检失败 ===')
    for p in problems:
        print(' -', p)
    raise SystemExit(1)
print('=== 预检全部通过 ===')
