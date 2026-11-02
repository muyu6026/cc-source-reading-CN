p = 'README.md'
s = open(p, encoding='utf-8').read()

# 1) refresh progress numbers (real figures from check-coverage.py src)
s = s.replace('**1063 个源码文件 / 342,071 行**', '**1073 个源码文件 / 342,476 行**')

# 2) append batch 94 link right after the batch 93 link (before the line-ending ；)
anchor = '](annotated-索引与进度.md#utils-第-93-批小文件十件套51-45-行档49-锚点)；'
new_tail = anchor + ' **utils 小文件十件套（44→39 行档，51 锚点）** 见 [utils 第 94 批](annotated-索引与进度.md#utils-第-94-批小文件十件套44-39-行档51-锚点)；'
assert s.count(anchor) == 1, f'anchor count={s.count(anchor)}'
s = s.replace(anchor, new_tail, 1)

open(p, 'w', encoding='utf-8').write(s)
print('README line 8 patched.')
