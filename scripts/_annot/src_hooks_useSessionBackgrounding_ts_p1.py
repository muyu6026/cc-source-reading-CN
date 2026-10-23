# -*- coding: utf-8 -*-
ANNOTATIONS = [
    (33, 'after', '''// 返回唯一的挂起处理函数：Ctrl+B 把当前会话挂后台或把前台会话重新挂起。'''),
    (41, 'after', '''// Ctrl+B 入口：若已有 foregroundedTaskId（正在前台查看某后台任务），
// 则重新挂起它；否则发起一次后台查询（onBackgroundQuery）。'''),
    (60, 'after', '''// 重新挂起后清空主视图的消息、loading 态与 abort 控制器，
// 让前台视图回到空闲。'''),
    (89, 'after', '''// 没有前台任务、或前台任务不是 local_agent 类型时，
// 直接清前台态并重置消息同步游标。'''),
    (97, 'after', '''// 仅当后台任务消息数量真正变化时才回写主视图，
// 避免每轮 effect 都触发冗余渲染。'''),
    (121, 'after', '''// 运行中的任务检测 Escape 中止信号（abortController.signal.aborted），
// 一旦中止立即清前台态，把控制权交还用户。'''),
    (127, 'after', '''// 任务仍在运行：主视图进入 loading，并把 abort 控制器
// 切换为前台任务自己的控制器，使 Escape 能中止后台任务。'''),
]
