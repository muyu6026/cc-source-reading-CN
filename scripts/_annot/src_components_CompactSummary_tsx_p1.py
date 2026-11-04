# -*- coding: utf-8 -*-
ANNOTATIONS = [
    (10, 'before', 'Props：message 是承载摘要的用户消息（summarizeMetadata 挂在其上），screen 决定渲染形态——transcript 表示用户按 ctrl+o 展开的完整历史视图。'),
    (14, 'before', 'CompactSummary：上下文压缩后的占位消息。压缩有两种——旧式整体压缩（无 metadata）与带方向的从某处开始压缩（有 metadata），渲染分支按 metadata 有无二分。'),
    (20, 'before', 'isTranscriptMode 决定信息详略：聊天流里只显示标题行加展开提示，完整原文只在 transcript 视图显示——聊天流要省行数，历史视图要可回读。'),
    (23, 'before', 'getUserMessageText 取消息文本，空则回退空串。textContent 依赖 message 单值缓存，transcript 切换时复用。'),
    (30, 'before', 'metadata 分支：summarizeMetadata 存在说明这是带上下文的局部压缩（Summarize from here 功能），比旧式压缩多显示消息数、方向与用户上下文。'),
    (34, 'before', '黑圆点图标：minWidth 为 2 给缩进对齐留位，与普通用户消息的箭头图标同宽度——两种消息在左边线上对齐。'),
    (48, 'before', '摘要说明段：共压缩了多少条消息；direction 为 up_to 时表示压到此点为止，否则表示从此点开始；userContext 是用户压缩时附注的上下文，用弯引号包裹显示；末尾附 ctrl+o 展开提示。这一段两依赖（isTranscriptMode、metadata）整体缓存。'),
    (57, 'before', 'transcript 视图下渲染完整原文——原文存在消息本体里，聊天流不显示它。与第 48 行互斥：同一时刻只会渲染一个。'),
    (76, 'before', '无 metadata 的旧式分支：结构与上面平行但更简单。注意编译器没有复用上面的黑圆点槽——第 34 与 77 行是两个独立常量槽，相同的 JSX 在两分支里各存一份，因为两分支不同时渲染，复用反而引入跨分支依赖。'),
    (84, 'before', '旧式标题行的展开提示：依赖 isTranscriptMode 单值缓存。标题是 Compact summary 加粗。'),
    (100, 'before', 'transcript 模式渲染原文，与第 57 行同构——两个分支的 transcript 段也是各自独立的槽。整个组件没有跨分支共享的缓存，读时按分支各看各的。'),
]
