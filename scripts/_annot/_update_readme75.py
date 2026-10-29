# -*- coding: utf-8 -*-
import io

ROOT = 'D:/CC泄露源码分析'
p = ROOT + '/README.md'
s = io.open(p, encoding='utf-8').read()

# 1. 进度数字
s = s.replace('已批注 **857 个源码文件 / 321,361 行**',
              '已批注 **868 个源码文件 / 323,185 行**')
s = s.replace('按行数覆盖 **62.6%**', '按行数覆盖 **63.0%**')

# 2. 在 74 批链接后追加 75 批链接
anchor = '见 [utils 第 74 批](annotated-索引与进度.md#utils-第-74-批小文件十五件套183-170-行档168-锚点)；'
assert anchor in s, 'anchor not found in README'
newlink = (anchor +
           '**utils 小文件十一件套（170→164 行档，113 锚点）** 见 '
           '[utils 第 75 批](annotated-索引与进度.md#utils-第-75-批小文件十一件套170164-行档113-锚点)；')
s = s.replace(anchor, newlink, 1)

io.open(p, 'w', encoding='utf-8').write(s)
print('README 更新完成：868 个文件 / 323,185 行 / 63.0% ，已追加第 75 批链接')
