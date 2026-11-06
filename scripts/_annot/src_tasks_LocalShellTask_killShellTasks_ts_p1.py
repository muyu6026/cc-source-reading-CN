# -*- coding: utf-8 -*-
ANNOTATIONS = [
    (1, 'before', '''纯函数（非 React）的 LocalShellTask 终止助手：供 runAgent 杀掉代理作用域的 bash 任务'''),
    (16, 'after', '''killTask：终止单个本地 shell 任务'''),
    (18, 'after', '''仅当任务运行中且确为本地 shell 任务才处理'''),
    (22, 'after', '''调用底层 shell 命令的 kill 与 cleanup'''),
    (30, 'after', '''取消清理回调并清除超时定时器'''),
    (35, 'after', '''写回任务状态为 killed 并清空 shellCommand 等字段'''),
    (45, 'after', '''顺带驱逐该任务的落盘输出'''),
    (53, 'after', '''killShellTasksForAgent：杀掉某代理产生的全部运行中的 bash 任务'''),
    (58, 'after', '''遍历所有任务，匹配 agentId + 运行中 + 本地 shell 者逐个终止'''),
    (71, 'after', '''清掉发给该代理的排队通知（其查询循环已退出，不会消费）'''),
    (75, 'after', '''按 agentId 过滤并移除所有排队的命令通知'''),
]
