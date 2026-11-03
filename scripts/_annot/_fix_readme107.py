# -*- coding: utf-8 -*-
# 刷新 README 第 8 行：进度数字 1168→1172、357,422→360,066、69%→70%，并追加第 107 批链接
import io

path = 'README.md'
with io.open(path, encoding='utf-8') as f:
    lines = f.read().split('\n')

old = lines[7]
assert '1168 个源码文件 / 357,422 行' in old, 'progress numbers not found'
assert '按行数覆盖 **69%**' in old, 'percent not found'

new = old.replace('1168 个源码文件 / 357,422 行', '1172 个源码文件 / 360,066 行')
new = new.replace('按行数覆盖 **69%**', '按行数覆盖 **70%**')
tail = ' · **components 第 107 批：选择组件、后台任务总管、MCP 远程服务器菜单（2,644 行，93 锚点）** 见 [components 第 107 批](annotated-索引与进度.md#components-第-107-批选择组件后台任务总管mcp-远程服务器菜单2644-行93-锚点)。'
assert new.endswith(')。'), 'unexpected ending: ' + new[-40:]
new = new + tail
lines[7] = new

with io.open(path, 'w', encoding='utf-8', newline='') as f:
    f.write('\n'.join(lines))
print('README line 8 updated:', len(new), 'chars')
