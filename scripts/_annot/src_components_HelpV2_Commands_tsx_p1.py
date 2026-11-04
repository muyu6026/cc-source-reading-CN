# -*- coding: utf-8 -*-
# annotations for src/components/HelpV2/Commands.tsx (82 lines)
ANNOTATIONS = [
    (17, 'before', '帮助页的命令清单：宽度固定，可见条数按终端高度换算'),
    (31, 'after', 'maxWidth 等于 columns 减 10：给行首缩进与图标留出固定宽度'),
    (32, 'after', 'visibleCount 由高度算：maxHeight 减 10 再除 2 向下取整——每条命令占两行（名字与描述）'),
    (35, 'after', '用 Set 去重：源码注释说明自定义命令可能在用户级与项目级同名出现，只保留第一条'),
    (41, 'after', '描述用 truncate 并按显示宽度截断（第三参为 true）：中英混排时按字符数截会错位'),
    (54, 'after', '先去重、再按名字 localeCompare 排序，最后映射成 Select 选项'),
    (63, 'before', '渲染的缓存依赖把八个输入逐个列出：清单里任何一项变化都要重算'),
    (64, 'after', '空清单只显示 emptyMessage；否则标题加 Select，并开 disableSelection/hideIndexes/compact-vertical 把它当纯展示列表用'),
    (79, 'before', '_temp 即按命令名排序的比较器'),
]
