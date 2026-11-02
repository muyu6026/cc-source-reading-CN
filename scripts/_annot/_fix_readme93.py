import io

P = 'README.md'
lines = open(P, encoding='utf-8').read().split('\n')
line = lines[7]

line = line.replace(
    '已批注 **1053 个源码文件 / 341,598 行**',
    '已批注 **1063 个源码文件 / 342,071 行**',
)
line = line.replace('按行数覆盖 **66.6%**', '按行数覆盖 **66%**')

tail = ('**utils 小文件十件套（51→45 行档，49 锚点）** '
        '见 [utils 第 93 批](annotated-索引与进度.md#utils-第-93-批小文件十件套51-45-行档49-锚点)；')
if tail not in line:
    idx = line.rfind('；')
    if idx != -1 and line[idx + 1:].lstrip().startswith('。'):
        line = line[:idx + 1] + tail + line[idx + 1:]
    else:
        line = line.rstrip() + ' ' + tail

lines[7] = line
open(P, 'w', encoding='utf-8').write('\n'.join(lines))
print('README line 8 updated')
print('has 1063:', '1063 个源码文件' in line)
print('has 66%:', '66%' in line)
print('has b93 link:', 'utils-第-93-批' in line)
