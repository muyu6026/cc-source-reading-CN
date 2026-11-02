# -*- coding: utf-8 -*-
import re

README = 'README.md'
with open(README, encoding='utf-8') as f:
    lines = f.readlines()

line = lines[7]  # 0-indexed -> line 8
# update file count and line count
line = line.replace('已批注 **1073 个源码文件 / 342,476 行**',
                    '已批注 **1083 个源码文件 / 342,847 行**')
# append batch-95 link (after batch-94 link, before the trailing '；')
marker = 'utils 第 94 批](annotated-索引与进度.md#utils-第-94-批小文件十件套44-39-行档51-锚点)；'
add = ('utils 第 94 批](annotated-索引与进度.md#utils-第-94-批小文件十件套44-39-行档51-锚点)；'
       ' **utils 小文件十件套（39→35 行档，34 锚点）** 见 '
       '[utils 第 95 批](annotated-索引与进度.md#utils-第-95-批小文件十件套39-35-行档34-锚点)；')
assert marker in line, 'batch-94 link marker not found'
line = line.replace(marker, add, 1)

lines[7] = line
with open(README, 'w', encoding='utf-8') as f:
    f.writelines(lines)
print('README line 8 updated.')
