#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""第 176 批预检：加载 15 份数据文件，断言锚点合法性。"""
import ast
import importlib.util
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'source')  # annotate.py 用 os.path.join(ROOT,'source',rel)
ANNOT = os.path.join(ROOT, 'scripts', '_annot')

REL = [
    'src/commands/install-github-app/CheckGitHubStep.tsx',
    'src/commands/login/index.ts',
    'src/commands/review/ultrareviewEnabled.ts',
    'src/commands/privacy-settings/index.ts',
    'src/commands/branch/index.ts',
    'src/commands/keybindings/index.ts',
    'src/commands/btw/index.ts',
    'src/commands/rewind/index.ts',
    'src/commands/thinkback/index.ts',
    'src/commands/hooks/hooks.tsx',
    'src/commands/effort/index.ts',
    'src/commands/install-github-app/index.ts',
    'src/commands/rewind/rewind.ts',
    'src/skills/bundled/verifyContent.ts',
    'src/commands/chrome/index.ts',
]

POS = {'before', 'after', 'after_block'}
fails = []


def slug_of(rel):
    return rel.replace('/', '_').replace('.', '_').replace('-', '_')


def load(rel):
    slug = slug_of(rel)
    files = [f for f in os.listdir(ANNOT)
             if f.startswith(slug + '_p') and f.endswith('.py')]
    if not files:
        fails.append(f'{rel}: 找不到 {slug}_p*.py')
        return None, slug, 0
    anns = []
    for name in sorted(files):
        path = os.path.join(ANNOT, name)
        # 1) ast.parse 整文件
        try:
            with open(path, 'r', encoding='utf-8') as fh:
                src = fh.read()
            ast.parse(src, filename=name)
        except SyntaxError as e:
            fails.append(f'{name}: ast.parse 失败 {e}')
            continue
        # 2) slug 文件名一致性（去掉 _pN.py）
        base = name[:-3]  # strip .py
        idx = base.rfind('_p')
        core = base[:idx] if idx != -1 else base
        if core != slug:
            fails.append(f'{name}: 文件名 slug「{core}」≠ 路径 slug「{slug}」')
        # 3) importlib 加载
        spec = importlib.util.spec_from_file_location(name[:-3], path)
        mod = importlib.util.module_from_spec(spec)
        try:
            spec.loader.exec_module(mod)
        except Exception as e:
            fails.append(f'{name}: 加载失败 {e!r}')
            continue
        if not hasattr(mod, 'ANNOTATIONS'):
            fails.append(f'{name}: 缺 ANNOTATIONS')
            continue
        anns.extend(mod.ANNOTATIONS)
    # 源文件行数
    sp = os.path.join(SRC, rel)
    with open(sp, 'r', encoding='utf-8') as fh:
        n = sum(1 for _ in fh)
    return anns, slug, n


for rel in REL:
    anns, slug, nlines = load(rel)
    if anns is None:
        continue
    seen = set()
    for item in anns:
        if not (isinstance(item, tuple) and len(item) == 3):
            fails.append(f'{rel}: 元素格式错误 {item!r}')
            continue
        ln, pos, txt = item
        if pos not in POS:
            fails.append(f'{rel}: pos 非法 {pos!r} @L{ln}')
        if not (1 <= ln <= nlines):
            fails.append(f'{rel}: 行号越界 L{ln} (文件 {nlines} 行)')
        if not isinstance(txt, str) or ('"' in txt) or ('\\' in txt):
            fails.append(f'{rel}: 文本含禁字符 " 或 \\ @L{ln}: {txt[:20]!r}')
        key = (ln, pos)
        if key in seen:
            fails.append(f'{rel}: 重复锚点 (L{ln},{pos})')
        seen.add(key)

if fails:
    print(f'PRECHECK FAIL ({len(fails)})')
    for f in fails:
        print(' -', f)
    sys.exit(1)
print(f'PRECHECK OK: {len(REL)} 文件，锚点全部合法')
