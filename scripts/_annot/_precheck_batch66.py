# 第 66 批预检：校验 10 个数据文件的锚点合法性
import io
import ast
import os
import importlib.util
import sys

# 本预检脚本位于 scripts/_annot/ 下，比 annotate.py 深一层，需 dirname 三次到项目根
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
ANNOT_DIR = os.path.join(ROOT, 'scripts', '_annot')
SOURCE_DIR = os.path.join(ROOT, 'source')

TARGETS = [
    ('src/utils/contextAnalysis.ts', 'src_utils_contextAnalysis_ts_p1.py'),
    ('src/utils/ansiToSvg.ts', 'src_utils_ansiToSvg_ts_p1.py'),
    ('src/utils/hooks/hooksSettings.ts', 'src_utils_hooks_hooksSettings_ts_p1.py'),
    ('src/utils/memoize.ts', 'src_utils_memoize_ts_p1.py'),
    ('src/utils/debug.ts', 'src_utils_debug_ts_p1.py'),
    ('src/utils/hooks/skillImprovement.ts', 'src_utils_hooks_skillImprovement_ts_p1.py'),
    ('src/utils/model/bedrock.ts', 'src_utils_model_bedrock_ts_p1.py'),
    ('src/utils/plugins/reconciler.ts', 'src_utils_plugins_reconciler_ts_p1.py'),
    ('src/utils/doctorContextWarnings.ts', 'src_utils_doctorContextWarnings_ts_p1.py'),
    ('src/utils/settings/validation.ts', 'src_utils_settings_validation_ts_p1.py'),
]

VALID_POS = {'before', 'after', 'after_block'}
errors = []
total_anchors = 0

for rel, fname in TARGETS:
    path = os.path.join(ANNOT_DIR, fname)
    if not os.path.exists(path):
        errors.append(f'[缺文件] {fname}')
        continue
    # ast 解析
    try:
        src_text = io.open(path, encoding='utf-8').read()
        ast.parse(src_text)
    except SyntaxError as e:
        errors.append(f'[ast 失败] {fname}: {e}')
        continue
    # 加载 ANNOTATIONS
    spec = importlib.util.spec_from_file_location(fname[:-3], path)
    mod = importlib.util.module_from_spec(spec)
    try:
        spec.loader.exec_module(mod)
    except Exception as e:
        errors.append(f'[加载失败] {fname}: {e}')
        continue
    if not hasattr(mod, 'ANNOTATIONS'):
        errors.append(f'[无 ANNOTATIONS] {fname}')
        continue
    ann = mod.ANNOTATIONS
    # slug 对应
    slug = rel.replace('/', '_').replace('.', '_').replace('-', '_')
    stem = fname[:-3]  # 去 .py
    if stem != slug + '_p1':
        errors.append(f'[slug 不匹配] {fname}: 期望 {slug}_p1，实为 {stem}')
    # 源文件行数
    sp = os.path.join(SOURCE_DIR, rel)
    if not os.path.exists(sp):
        errors.append(f'[源文件缺失] {rel}')
        continue
    with io.open(sp, encoding='utf-8', newline='') as fh:
        raw = fh.read().split('\n')
    lines = [ln[:-1] if ln.endswith('\r') else ln for ln in raw]
    nlines = len(lines)
    seen = set()
    for entry in ann:
        if not (isinstance(entry, tuple) and len(entry) == 3):
            errors.append(f'[格式错] {fname}: 条目 {entry!r}')
            continue
        ln, pos, text = entry
        if not isinstance(ln, int) or not isinstance(text, str):
            errors.append(f'[类型错] {fname}: {entry!r}')
            continue
        if pos not in VALID_POS:
            errors.append(f'[位置错] {fname} 行{ln}: {pos}')
        if not (1 <= ln <= nlines):
            errors.append(f'[行号越界] {fname}: 行{ln}（文件 {nlines} 行）')
        if ln in seen:
            errors.append(f'[重复锚点] {fname}: 行{ln} 出现两次')
        seen.add(ln)
        if '"' in text or '\\' in text:
            errors.append(f'[禁用字符] {fname} 行{ln}: 含 " 或 \\')
        total_anchors += 1

print(f'校验目标数：{len(TARGETS)}，锚点总数：{total_anchors}')
if errors:
    print('❌ 发现 %d 处问题：' % len(errors))
    for e in errors:
        print('  -', e)
    sys.exit(1)
print('✅ 全部预检通过')
