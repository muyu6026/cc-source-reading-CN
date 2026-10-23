ANNOTATIONS = [
    (1, 'before', '''getEnterWorktreeToolPrompt：整段工具提示词。'''),
    (2, 'before', '''提示词核心就一句：**只在用户明确说出 worktree 时用**。建分支、切分支、修 bug、做功能全部走普通 git 流程——模型最爱把「隔离工作环境」自作主张升级成 worktree，这里用三条 When NOT to Use 把路堵死。'''),
    (29, 'after', '''末尾交代 name 参数与两种落盘方式：git 仓库内建在 .claude/worktrees/ 下（基于 HEAD 开新分支）；仓库外则委托 WorktreeCreate/WorktreeRemove hooks 做 VCS 无关的隔离——非 git 项目也能用同一套工具语义。'''),
]
