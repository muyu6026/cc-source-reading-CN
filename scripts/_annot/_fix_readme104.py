# -*- coding: utf-8 -*-
import io

p = 'README.md'
lines = io.open(p, encoding='utf-8').read().split('\n')
i = 7
old = lines[i]
assert '**1158 个源码文件 / 347,734 行**' in old

new = old.replace('**1158 个源码文件 / 347,734 行**', '**1161 个源码文件 / 351,310 行**')
assert new != old

seg = ' · **components 第 104 批：统计面板、权限规则、MCP 询问（3,573 行，112 锚点）** 见 [components 第 104 批](annotated-索引与进度.md#components-第-104-批统计面板权限规则mcp-询问3573-行112-锚点)。'
if seg not in new:
    new = new.rstrip()
    if new.endswith('。'):
        new = new[:-1]
    new = new + seg

lines[i] = new
io.open(p, 'w', encoding='utf-8', newline='\n').write('\n'.join(lines))
print('OK len', len(new))
