# -*- coding: utf-8 -*-
# annotations for src/components/shell/ShellTimeDisplay.tsx (74 lines)
ANNOTATIONS = [
    (9, 'before', 'ShellTimeDisplay：在 shell 任务后显示耗时与超时，两者都没有就不渲染'),
    (15, 'after', '两个输入都缺时返回 null：没有时间信息就不占位'),
    (20, 'after', '超时时间用 hideTrailingZeros：30s 而不是 30.000s'),
    (29, 'after', '只有超时没有耗时（还没开始跑）：显示 timeout 括号段'),
    (41, 'after', '耗时按秒传入，这里乘 1000 转毫秒交给 formatDuration'),
    (52, 'after', '两者都有时用中间点连接：耗时与 timeout 超时'),
    (63, 'after', '只有耗时时：圆括号包一层'),
]
