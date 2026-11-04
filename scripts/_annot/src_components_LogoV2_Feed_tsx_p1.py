# -*- coding: utf-8 -*-
ANNOTATIONS = [
    (6, 'before', 'FeedLine：一行文本加可选时间戳。Feed 是通用的事件流面板（后台任务输出、遥测流等共用），时间戳列是否出现由数据决定。'),
    (10, 'before', 'FeedConfig：customContent 允许调用方整体替换正文——自带宽度声明，因为 Feed 无法测量任意 ReactNode 的显示宽。'),
    (24, 'before', 'calculateFeedWidth：导出的宽度预计算。把「这个 Feed 最宽要多少列」从渲染期提到调用方——父组件先算宽再传 actualWidth，Box 宽度一次到位，杜绝渲染后发现放不下再改版面。宽度来源按内容形态三分支：自定义内容用自己的声明宽、空态用文案宽、列表用标题与各行宽的最大值。'),
    (39, 'before', '时间戳列宽一次算好所有行共用：maxTimestampWidth 取全列表最大——列对齐是按列算的，不是每行各自贴右。gap 固定两空格计入行宽。'),
    (46, 'before', '页脚最后参与 max 比较：Feed 的总宽必须容得下最宽的任何一层。'),
    (51, 'before', 'Feed 组件：_c(15) 四段缓存。actualWidth 由调用方用上面的预计算得出——计算与渲染分离成两个导出。'),
    (66, 'before', 'maxTimestampWidth 依赖 lines 单值记忆化，与 calculateFeedWidth 里的同名逻辑保持一致——两处算法必须同步改，否则预计算的宽度和实际渲染对不上。'),
    (83, 'before', '主体三分支：自定义内容优先（页脚仍可叠加）；无行且有 emptyMessage 显示空态；否则渲染行列表加页脚。'),
    (84, 'before', '每行文本宽度：实际宽减去时间戳列（列宽加两格间距），保底 10 列——极端窄终端下也不至于一个字都放不下。'),
    (85, 'before', '时间戳用 padEnd 对齐到列宽（不足补空格），文本 truncate 截断——先对齐再截断，列永远不会因截断而错位。'),
]
