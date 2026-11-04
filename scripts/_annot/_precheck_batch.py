# -*- coding: utf-8 -*-
import os, sys, importlib.util, ast

ROOT = 'D:/CC泄露源码分析'
ANNOT_DIR = os.path.join(ROOT, 'scripts', '_annot')
SOURCE_DIR = os.path.join(ROOT, 'source')

# (relative path under source/)
FILES = [
    'src/cli/handlers/plugins.ts',
    'src/cli/structuredIO.ts',
    'src/types/generated/events_mono/claude_code/v1/claude_code_internal_event.ts',
    'src/tasks/RemoteAgentTask/RemoteAgentTask.tsx',
]

POS_ALLOWED = {'before', 'after', 'after_block'}
errors = []

def slug_of(rel):
    return rel.replace('/', '_').replace('.', '_').replace('-', '_')

for rel in FILES:
    slug = slug_of(rel)
    src = os.path.join(SOURCE_DIR, rel)
    if not os.path.exists(src):
        errors.append(f'[{rel}] 源文件不存在: {src}')
        continue
    with open(src, encoding='utf-8') as f:
        src_lines = f.read().split('\n')
    nlines = len(src_lines) - (1 if src_lines and src_lines[-1] == '' else 0)
    cands = sorted(
        fn for fn in os.listdir(ANNOT_DIR)
        if fn.startswith(slug + '_p') and fn.endswith('.py')
    )
    if not cands:
        errors.append(f'[{rel}] 找不到数据文件 {slug}_p*.py')
        continue
    items = []
    for fn in cands:
        path = os.path.join(ANNOT_DIR, fn)
        try:
            spec = importlib.util.spec_from_file_location(fn[:-3], path)
            mod = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(mod)
            data = mod.ANNOTATIONS
        except Exception as e:
            errors.append(f'[{rel}] 数据文件 {fn} 加载失败: {e!r}')
            continue
        try:
            ast.parse(open(path, encoding='utf-8').read())
        except Exception as e:
            errors.append(f'[{rel}] 数据文件 {fn} ast.parse 失败: {e!r}')
        if not isinstance(data, list):
            errors.append(f'[{rel}] {fn} ANNOTATIONS 不是列表')
            continue
        items.extend(data)
    seen = set()
    for idx, tup in enumerate(items):
        if not (isinstance(tup, tuple) and len(tup) == 3):
            errors.append(f'[{rel}] 第 {idx} 条不是三元组: {tup!r}')
            continue
        lineno, pos, text = tup
        if pos not in POS_ALLOWED:
            errors.append(f'[{rel}] 第 {idx} 条 pos={pos!r} 非法')
        if not (isinstance(lineno, int) and 1 <= lineno <= nlines):
            errors.append(f'[{rel}] 第 {idx} 条 行号 {lineno} 越界 (1..{nlines})')
        if not isinstance(text, str):
            errors.append(f'[{rel}] 第 {idx} 条 文本非字符串')
        else:
            if '"' in text:
                errors.append(f'[{rel}] 第 {idx} 条 文本含英文双引号')
            if '\\' in text:
                errors.append(f'[{rel}] 第 {idx} 条 文本含反斜杠')
        if (lineno, pos) in seen:
            errors.append(f'[{rel}] 重复锚点 (行 {lineno}, {pos})')
        seen.add((lineno, pos))
    print(f'[{rel}] slug={slug} 锚点 {len(items)} 个, 源行数 {nlines}')

if errors:
    print('\n=== 预检失败 ===')
    for e in errors:
        print(' -', e)
    sys.exit(1)
else:
    print('\n=== 预检全部通过 ===')
