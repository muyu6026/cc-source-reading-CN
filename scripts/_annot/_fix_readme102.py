# 刷新 README 第 8 行进度数字并追加第 102 批链接
path = 'README.md'
lines = open(path, encoding='utf-8').read().split('\n')
assert len(lines) >= 8, 'README 不足 8 行'
line = lines[7]

# 1. 进度数字
line = line.replace('1153 个源码文件 / 344,313 行', '1156 个源码文件 / 344,337 行')
# 2. 行覆盖百分比
line = line.replace('按行数覆盖 **67.1%**', '按行数覆盖 **67%**')
# 3. 追加第 102 批链接（接在 98 批链接之后）
anchor_98 = '见 [utils 第 98 批](annotated-索引与进度.md#utils-第-98-批小文件十件套26-22-行档46-锚点)。'
link_102 = ' · **utils 第 102 批：收尾清零（3 份 8 行小文件，6 锚点）** 见 [utils 第 102 批](annotated-索引与进度.md#utils-第-102-批收尾清零3-份-8-行小文件6-锚点)。'
if anchor_98 in line and link_102 not in line:
    line = line.replace(anchor_98, anchor_98 + link_102, 1)
else:
    print('WARN: 锚点 98 未找到或 102 已存在，未追加')

lines[7] = line
open(path, 'w', encoding='utf-8').write('\n'.join(lines))
print('README 行8 已刷新')
print('含 1156:', '1156 个源码文件 / 344,337 行' in lines[7])
print('含 67%:', '按行数覆盖 **67%**' in lines[7])
print('含 102 链接:', 'utils-第-102-批收尾清零3-份-8-行小文件6-锚点' in lines[7])
