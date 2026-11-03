# -*- coding: utf-8 -*-
ANNOTATIONS = [
    (14, 'after_block', '''内联 require 打破循环依赖：sessionStorage → commands → exit → ExitFlow → 此处。'''),
    (17, 'before', '''recordWorktreeExit：惰性 require 后调用 saveWorktreeState(null) 记录退出。'''),
    (23, 'before', '''Props 类型：退出完成回调、取消回调。'''),
    (29, 'before', '''WorktreeExitDialog：处理 worktree 退出时「保留还是移除」的交互。'''),
    (38, 'before', '''首个副作用：加载未提交改动与待弹出提交数。'''),
    (57, 'after', '''无改动也无提交时静默清理，直接移除 worktree。'''),
    (83, 'before', '''第二个副作用：状态变为 done 时回调 onDone 通知上层。'''),
    (88, 'before', '''无有效 worktree 会话时直接回调失败。'''),
    (97, 'before', '''handleSelect：按用户选择执行「保留 / 移除」并切换状态。'''),
    (111, 'after', '''保留且含 tmux 会话时，提示用户可重新 attach。'''),
    (181, 'before', '''根据是否未提交 / 有提交拼出不同的副标题文案。'''),
    (227, 'before', '''渲染：用 Dialog 包住选项列表；Escape 退回会话、选择项触发处理。'''),
]
