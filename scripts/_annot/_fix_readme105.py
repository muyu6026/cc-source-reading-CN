# -*- coding: utf-8 -*-
import io

p = 'README.md'
with io.open(p, encoding='utf-8') as f:
    text = f.read()

lines = text.split('\n')
i = 7
line = lines[i]

old_prog = '已批注 **1161 个源码文件 / 351,310 行**'
new_prog = '已批注 **1164 个源码文件 / 354,308 行**'
assert old_prog in line, '进度数字未命中'
line = line.replace(old_prog, new_prog)

assert '按行数覆盖 **67%**' in line, '百分比未命中'
line = line.replace('按行数覆盖 **67%**', '按行数覆盖 **69%**')

link = ' · **components 第 105 批：虚拟列表、滚动总控、远程会话详情（2,995 行，118 锚点）** 见 [components 第 105 批](annotated-索引与进度.md#components-第-105-批虚拟列表滚动总控远程会话详情2995-行118-锚点)'
assert 'components 第 105 批' not in line
assert line.rstrip().endswith('。'), line[-40:]
line = line.rstrip()[:-1] + link + '。'

lines[i] = line
with io.open(p, 'w', encoding='utf-8', newline='') as f:
    f.write('\n'.join(lines))
print('README 第 8 行已刷新')
