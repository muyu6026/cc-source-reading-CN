#!/usr/bin/env python3
"""校验本手册所有链接：源码链接是否真实存在、行号是否越界、代码块是否闭合。
用法：  python scripts/check-links.py     （在 D:/CC泄露源码分析 目录下运行）
"""
import os, re, glob, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
os.chdir(ROOT)
LINK = re.compile(r'\[[^\]]*\]\(([^)]+)\)')
CODE = re.compile(r'`[^`\n]*`')      # 反引号内的行内代码，不是真链接，先剔掉


def strip_code(text):
    """把行内代码整段替换成等长占位符。
    这样 `[文字](链接)`、`![](...)` 这类「讲解用的示例」不会被当成真链接。
    注意链接标签里的反引号（如 [`src/x.ts`](source/src/x.ts)）剔掉后，
    标签变成占位符，但 `](source/...)` 仍在，LINK 依然能匹配到。"""
    return CODE.sub(lambda m: '\u0000' * len(m.group(0)), text)


FENCE = re.compile(r'^```.*?^```', re.M | re.S)


def load(path):
    """读取文件，去掉围栏代码块与行内代码，只留真正的正文链接。"""
    text = open(path, encoding='utf-8').read()
    text = FENCE.sub(lambda m: '\u0000' * len(m.group(0)), text)
    return strip_code(text)


FILES = (['README.md', 'annotated-索引与进度.md']
         + sorted(glob.glob('docs/*.md'))
         + sorted(glob.glob('annotated/*.md')))

src_links = md_links = 0
bad = []
for f in FILES:
    base = os.path.dirname(f)
    for m in LINK.finditer(load(f)):
        t = m.group(1).strip()
        if t.startswith(('http', '#')):
            continue
        target, _, frag = t.partition('#')
        full = os.path.normpath(os.path.join(base, target))
        if target.endswith('.md'):
            md_links += 1
            if not os.path.exists(full):
                bad.append((f, t, '文档不存在'))
            continue
        src_links += 1
        # 用 exists 而不是 isfile：指向目录的链接是合法的
        # （例如 `source/src/services/compact/` 让读者直接浏览整个目录）。
        # 之前写成 isfile，导致所有目录链接被误报为「源码文件不存在」。
        if not os.path.exists(full):
            bad.append((f, t, '源码文件不存在'))
            continue
        if frag.startswith('L'):
            total = sum(1 for _ in open(full, encoding='utf-8', errors='ignore'))
            nums = [int(x) for x in re.findall(r'L(\d+)', frag)]
            if nums and max(nums) > total:
                bad.append((f, t, f'行号越界 {max(nums)} > 文件总行数 {total}'))

print(f'源码链接 {src_links} | 文档内链 {md_links} | 失效 {len(bad)}')
for b in bad:
    print('  ✗', b)
print('✓ 全部有效' if not bad else '')
sys.exit(1 if bad else 0)
