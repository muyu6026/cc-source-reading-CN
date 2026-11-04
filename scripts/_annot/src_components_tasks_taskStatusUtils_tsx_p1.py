# -*- coding: utf-8 -*-
ANNOTATIONS = [
    (1, 'before', '任务状态展示的共享工具集：图标、颜色、队员活动文案、页脚隐藏判定四件套，供任务面板与状态条等处共用——同一状态在所有界面上必须长一个样。'),
    (16, 'before', 'isTerminalStatus：completed、failed、killed 三种终态。轮询逻辑用它判断是否停止刷新。'),
    (23, 'before', 'getTaskStatusIcon 优先级链：出错大于等待审批大于请求关停大于运行态（空闲显省略号、忙碌显播放）大于终态，最后落到普通圆点。状态标志优先于 status 字段——附加信息比基础状态更能说明当前卡在哪。'),
    (50, 'before', 'getTaskStatusColor 与图标同构映射：killed 显 warning 而非 error——用户主动杀掉的任务不是故障。killed 的图标和 error 同为叉号，颜色是两者唯一的区别。'),
    (77, 'before', 'describeTeammateActivity 三级兜底：stopping、awaiting approval、idle 三个显式态优先；然后最近活动摘要（collapseReadSearch 把连续读搜折叠成一句话）、最后活动描述、working 文案依次回退——宁可显示笼统的 working 也不留空白。'),
    (93, 'before', 'shouldHideTasksFooter：spinner 树激活且所有可见任务都是 in_process 队友时隐藏任务页脚——队友已在树的节点里显示，页脚再列一遍是重复。注释强调与 BackgroundTaskStatus 用同一套过滤谓词，防止两处判定漂移后出现「树里没有、页脚有」的幽灵任务。'),
    (99, 'before', 'external 与 ant 的比较被编译期内联成字面量——特性常量（区分发行版本）的痕迹，正式构建里该分支恒假或恒真由构建期决定。'),
]
