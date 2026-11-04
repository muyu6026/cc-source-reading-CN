# -*- coding: utf-8 -*-
ANNOTATIONS = [
    (12, 'before', 'DevChannelsDialog：用 --dangerously-load-development-channels 启动时的强制确认弹窗。error 红色标题，两种退出路径都走优雅关停。'),
    (20, 'before', 'onChange：accept 放行由 onAccept 处理；exit 同步优雅退出码 1——用户明确拒绝加载，非零码让启动脚本知道没启动成功。'),
    (39, 'before', 'handleEscape 引用文件尾 _temp（gracefulShutdownSync 码 0）：Esc 也退出但退出码为 0——区分「主动选择退出」（1）与「只是关掉弹窗」(0)，脚本可据此分流。'),
    (42, 'before', '两条警告进同一哨兵槽：第一条明说此选项仅供本地渠道开发，不要用来运行从网上下载的渠道——开发渠道没有审批与沙箱，等价于直接执行第三方代码。第二条指路 --channels 加载已审批列表。'),
    (52, 'before', '渠道清单展示：插件渠道显示 plugin 加名字加市场，服务器渠道显示 server 加名字——来源可辨识，用户知道自己到底在批准什么。'),
    (68, 'before', '两选项进哨兵槽：确认文案强调「我在做本地开发」——让用户在按下去之前自我确认使用场景。'),
    (99, 'before', '_temp2 渲染渠道名，_temp 是 Esc 处理器——两个提取函数都无闭包依赖，纯常量引用。'),
]
