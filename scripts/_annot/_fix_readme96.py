# -*- coding: utf-8 -*-
README = 'README.md'
with open(README, encoding='utf-8') as f:
    lines = f.readlines()

line = lines[7]  # line 8 (0-indexed)
line = line.replace('已批注 **1083 个源码文件 / 342,847 行**',
                    '已批注 **1093 个源码文件 / 343,164 行**')
marker = 'utils 第 95 批](annotated-索引与进度.md#utils-第-95-批小文件十件套39-35-行档34-锚点)；'
add = ('utils 第 95 批](annotated-索引与进度.md#utils-第-95-批小文件十件套39-35-行档34-锚点)；'
       ' **utils 小文件十件套（34→29 行档，26 锚点）** 见 '
       '[utils 第 96 批](annotated-索引与进度.md#utils-第-96-批小文件十件套34-29-行档26-锚点)；')
assert marker in line, 'batch-95 link marker not found'
line = line.replace(marker, add, 1)

lines[7] = line
with open(README, 'w', encoding='utf-8') as f:
    f.writelines(lines)
print('README line 8 updated.')
