# -*- coding: utf-8 -*-
# 第 167 批：src/constants/xml.ts 批注数据
ANNOTATIONS = [
    (1, 'after', '''本文件集中定义消息里用的 XML 标签名：命令或技能元数据、终端输入输出、任务通知等。'''),
    (5, 'after', '''命令元数据三标签：command-name、command-message、command-args。'''),
    (13, 'after', '''终端输出标签组：bash 与本地命令的 input、stdout、stderr、caveat，区分真用户提示与终端活动。'''),
    (23, 'after', '''TERMINAL_OUTPUT_TAGS：把六个终端标签聚成常量数组，判断「这是终端输出而非用户提示」时直接 includes。'''),
    (25, 'after', '''TICK_TAG：心跳或计时标签。'''),
    (36, 'after', '''任务通知标签组：task-notification 领衔，附 task-id、tool-use-id、type、output-file、status、summary、reason、worktree 等。'''),
    (41, 'after', '''ULTRAPLAN_TAG：远程并行规划会话的包裹标签。'''),
    (45, 'after', '''REMOTE_REVIEW_TAG：远端 slash review 结果标签，本地轮询器据此抽取。'''),
    (49, 'after', '''REMOTE_REVIEW_PROGRESS_TAG：run_hunt 心跳每约十秒把进度写进这个标签，本地解析最新值。'''),
    (52, 'after', '''TEAMMATE_MESSAGE_TAG：swarm 队友间通信标签。'''),
    (56, 'after', '''CHANNEL_MESSAGE_TAG：外部频道消息标签。'''),
    (59, 'after', '''CROSS_SESSION_MESSAGE_TAG：跨会话 UDS 消息（另一个 Claude 会话的收件箱）标签。'''),
    (63, 'after', '''FORK_BOILERPLATE_TAG：fork 子进程首条消息里规则模板的包裹标签，渲染时折叠只留指令。'''),
    (66, 'after', '''FORK_DIRECTIVE_PREFIX：指令文本前缀，生成端与解析端必须保持一致。'''),
    (69, 'after', '''COMMON_HELP_ARGS：help、-h、--help 三种求助写法。'''),
    (86, 'after', '''COMMON_INFO_ARGS：list、show、status 等一打查询写法，命中即当作「要看当前状态」。'''),
]
