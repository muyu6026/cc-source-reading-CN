#!/usr/bin/env python3
# 刷新 README 第 8 行进度数字并追加第 97 批链接
path = 'README.md'
lines = open(path, encoding='utf-8').read().split('\n')
assert len(lines) >= 8, 'README 不足 8 行'
line8 = lines[7]
# 替换进度数字：1093 个源码文件 / 343,164 行 -> 1103 个源码文件 / 343,438 行
assert '1093 个源码文件 / 343,164 行' in line8, '未找到旧进度串'
new = line8.replace('1093 个源码文件 / 343,164 行', '1103 个源码文件 / 343,438 行')
# 66% 不变
# 追加本批链接（锚点用 GitHub slug：utils 第 97 批小文件十件套29-26 行档37 锚点）
link = ' · **utils 第 97 批小文件十件套（29→26 行档，37 锚点）** 见 [utils 第 97 批](annotated-索引与进度.md#utils-第-97-批小文件十件套29-26-行档37-锚点)。'
assert link not in new, '链接已存在'
new = new + link
lines[7] = new
open(path, 'w', encoding='utf-8').write('\n'.join(lines))
print('README line8 updated:')
print(new[-300:])
