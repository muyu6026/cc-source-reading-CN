ANNOTATIONS = [
    (1, 'before', '''getExitWorktreeToolPrompt：整段工具提示词。'''),
    (2, 'before', '''提示词把 scope 说在最前面：只动本会话 EnterWorktree 建的 worktree，手建的、历史会话的一律不碰；在 EnterWorktree 之外调用就是 **no-op**——明说「不做任何文件系统改动」，防止模型拿它当通用「返回上级目录」工具用。'''),
    (31, 'after', '''收尾三段：keep/remove 的语义差别、discard_changes 的确认协议（工具列改动 → 与人确认 → 带 true 重调）、以及退出后 EnterWorktree 可再次建新 worktree（状态已复原，不是一次性工具）。'''),
]
