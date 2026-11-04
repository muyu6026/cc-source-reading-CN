# -*- coding: utf-8 -*-
# annotations for src/components/TeammateViewHeader.tsx (82 lines)
ANNOTATIONS = [
    (14, 'before', '查看某个队友转录时的页头：名字着色、任务描述、退出提示'),
    (16, 'after', 'useAppState 只取 viewedTeammate 切片：选择器粒度细，其它状态变化不触发本组件重渲染'),
    (17, 'after', '没有在查看任何队友时返回 null'),
    (22, 'after', 'toInkColor 把 agent 的颜色名转成 ink 可用的颜色值'),
    (38, 'after', '@名字加粗着色：一眼看出当前看的是谁'),
    (47, 'after', '中间点分隔加 esc to return 提示：退出路径随手可查'),
    (62, 'after', '第二行暗色显示该队友收到的原始 prompt'),
    (70, 'after', 'OffscreenFreeze 包裹：滚出屏幕后冻结重渲染，省掉不可见区域的更新开销'),
]
