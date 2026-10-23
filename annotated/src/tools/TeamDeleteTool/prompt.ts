// getPrompt：TeamDelete 操作手册。
export function getPrompt(): string {
// 手册三件事：删哪两个目录（teams/{name}/ 与 tasks/{name}/）、清会话上下文；**IMPORTANT 段把前置条件说死——有活跃队员时 TeamDelete 会失败，必须先 requestShutdown 逐个关**；队名自动从会话上下文取，不需要（也不接受）参数。
  return `
# TeamDelete

Remove team and task directories when the swarm work is complete.

This operation:
- Removes the team directory (\`~/.claude/teams/{team-name}/\`)
- Removes the task directory (\`~/.claude/tasks/{team-name}/\`)
- Clears team context from the current session

**IMPORTANT**: TeamDelete will fail if the team still has active members. Gracefully terminate teammates first, then call TeamDelete after all teammates have shut down.

Use this when all teammates have finished their work and you want to clean up the team resources. The team name is automatically determined from the current session's team context.
`.trim()
}
