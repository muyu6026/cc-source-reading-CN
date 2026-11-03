# -*- coding: utf-8 -*-
import io

p = 'README.md'
lines = io.open(p, encoding='utf-8').read().split('\n')
i = 7
old = lines[i]
assert '个源码文件 / 344,337 行' in old, old[:200]

new = old.replace('**1156 个源码文件 / 344,337 行**', '**1158 个源码文件 / 347,734 行**')
assert new != old
# 行覆盖百分比仍为 67%，不替换

seg = ' · **components 第 103 批：设置面板与历史选择器（3,397 行，73 锚点）** 见 [components 第 103 批](annotated-索引与进度.md#components-第-103-批设置面板与历史选择器1822--1575-行73-锚点)。'
if seg not in new:
    if new.rstrip().endswith('。'):
        new = new.rstrip()[:-1] + seg
    else:
        new = new + seg

lines[i] = new
io.open(p, 'w', encoding='utf-8', newline='\n').write('\n'.join(lines))
print('OK len', len(new))
