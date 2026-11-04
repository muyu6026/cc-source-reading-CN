# -*- coding: utf-8 -*-
"""把第 132 批小节写进索引，并刷新 README 与索引顶部的进度数字。"""
import io

ROOT = r'D:/CC泄露源码分析'
INDEX = ROOT + '/annotated-索引与进度.md'
README = ROOT + '/README.md'
SECTION = ROOT + '/scripts/_annot/_batch132_section.md'

section = open(SECTION, encoding='utf-8').read()

# 1) 索引：追加本批小节
txt = open(INDEX, encoding='utf-8').read()
if not txt.endswith('\n'):
    txt += '\n'
txt += '\n' + section
open(INDEX, 'w', encoding='utf-8', newline='').write(txt)

# 2) 索引顶部 components 进度行 245/389 -> 355/389
lines = open(INDEX, encoding='utf-8').read().split('\n')
updated_top = False
for i, ln in enumerate(lines):
    if '245/389' in ln:
        lines[i] = ln.replace('245/389', '355/389')
        updated_top = True
        break
open(INDEX, 'w', encoding='utf-8', newline='').write('\n'.join(lines))
print('索引顶部 components 行刷新:', updated_top)

# 3) README 第 8 行：进度数字 + 追加本批链接
rlines = open(README, encoding='utf-8').read().split('\n')
assert len(rlines) >= 8, 'README 不足 8 行'
old = rlines[7]
assert '1430 个源码文件 / 411,015 行' in old, 'README 第8行进度数字未命中，疑似被外部回退'
rlines[7] = old.replace('1430 个源码文件 / 411,015 行', '1445 个源码文件 / 411,767 行')
link = ('；**components batch 132: 15 files, 752 src / 863 annotated lines, 103 anchors** '
        '见 [components batch 132](annotated-索引与进度.md#components-batch-132-15-files-752-lines-103-anchors)。')
if link not in rlines[7]:
    rlines[7] = rlines[7].rstrip() + link
open(README, 'w', encoding='utf-8', newline='').write('\n'.join(rlines))
print('README 第8行已刷新并追加本批链接')
