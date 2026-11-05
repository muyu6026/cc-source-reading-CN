# -*- coding: utf-8 -*-
"""第 144 批数据文件预检（单文件巨兽）。"""
import os
import ast
import importlib.util

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
ANNOT_DIR = os.path.join(ROOT, 'scripts', '_annot')
BATCH = [
    ('src/bootstrap/state.ts', 'src_bootstrap_state_ts'),
]
VALID_POS = {'before', 'after', 'after_block'}
errors = []
total_ann = 0

for rel, slug in BATCH:
    calc = rel.replace('/', '_').replace('.', '_').replace('-', '_')
    if calc != slug:
        errors.append(f'[slug] {rel}: 推导 {calc} != 数据 {slug}')
    data_file = os.path.join(ANNOT_DIR, slug + '_p1.py')
    if not os.path.exists(data_file):
        errors.append(f'[file] 缺失数据文件: {slug}_p1.py')
        continue
    try:
        src_text = open(data_file, encoding='utf-8').read()
        ast.parse(src_text)
    except SyntaxError as e:
        errors.append(f'[ast] {slug}: {e}')
        continue
    try:
        spec = importlib.util.spec_from_file_location(slug + '_p1', data_file)
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        anns = mod.ANNOTATIONS
    except Exception as e:
        errors.append(f'[import] {slug}: {e!r}')
        continue
    src_path = os.path.join(ROOT, 'source', rel)
    if not os.path.exists(src_path):
        errors.append(f'[src] 源文件不存在: {rel}')
        continue
    n_lines = sum(1 for _ in open(src_path, encoding='utf-8'))
    src_lines = open(src_path, encoding='utf-8').read().split('\n')
    seen = set()
    last_ln = 0
    for item in anns:
        if not (isinstance(item, tuple) and len(item) == 3):
            errors.append(f'[shape] {slug}: {item!r}')
            continue
        ln, pos, text = item
        total_ann += 1
        if pos not in VALID_POS:
            errors.append(f'[pos] {slug} L{ln}: pos={pos!r}')
        if not (isinstance(ln, int) and 1 <= ln <= n_lines):
            errors.append(f'[line] {slug}: 行号 {ln} 超出范围 1..{n_lines}')
        if ln < last_ln:
            errors.append(f'[order] {slug} L{ln}: 锚点未升序（上一处 L{last_ln}）')
        last_ln = max(last_ln, ln)
        if not isinstance(text, str):
            errors.append(f'[text] {slug} L{ln}: 文本非字符串')
        else:
            if '"' in text:
                errors.append(f'[quote] {slug} L{ln}: 含英文双引号')
            if '\\' in text:
                errors.append(f'[backslash] {slug} L{ln}: 含反斜杠')
            if '\n' in text:
                errors.append(f'[newline] {slug} L{ln}: 文本含换行')
            if len(text) > 260:
                errors.append(f'[len] {slug} L{ln}: 文本 {len(text)} 字过长')
        key = (ln, pos)
        if key in seen:
            errors.append(f'[dup] {slug}: 锚点重复 (L{ln},{pos})')
        seen.add(key)
        # 落位合理性：before 不能在块注释内部；after 不能落进多行字符串
        cur = src_lines[ln - 1] if ln - 1 < len(src_lines) else ''
        nxt = src_lines[ln] if ln < len(src_lines) else ''
        prev = src_lines[ln - 2] if ln >= 2 else ''
        if pos == 'before':
            if cur.strip().startswith('*/') or cur.strip().startswith('*'):
                errors.append(f'[bslot] {slug} L{ln}: before 落在块注释内部: {cur.strip()[:40]}')
        if pos == 'after':
            if nxt.strip().startswith('}') and not cur.strip().endswith((';', '{', '}', ',')):
                errors.append(f'[aslot] {slug} L{ln}: after 落在语句与闭括号之间: {cur.strip()[:40]}')

print(f'校验文件数: {len(BATCH)}，锚点总数: {total_ann}')
if errors:
    print(f'❌ 失败 {len(errors)} 项:')
    for e in errors:
        print('  -', e)
    raise SystemExit(1)
print('✅ 全部预检通过')
