# -*- coding: utf-8 -*-
# annotations for src/components/design-system/Pane.tsx (77 lines)
ANNOTATIONS = [
    (7, 'before', 'Pane 的 props：children 加可选边框色'),
    (15, 'before', 'doc 注释把三个组件的分工写清：Pane 是斜杠命令页的区域壳、Dialog 是会注册键位的确认框、Panel 是圆角卡片；Pane 内嵌 Dialog 要用 hideBorder 以免双框'),
    (39, 'after', '在 modal 槽里时不画自己的分隔线：外层 FullscreenLayout 的边框已是唯一框架，再画就双框'),
    (42, 'after', 'modal 内只保留 paddingX 1：边框省掉，内边距也收窄'),
    (52, 'after', '正常模式顶部一条 Divider 作为分隔：颜色由 color 传入'),
    (60, 'after', '内容区 paddingX 2：比 modal 内多一格，因为外面没有边框再撑'),
    (68, 'after', 'paddingTop 1：分隔线与内容之间留一行空隙'),
]
