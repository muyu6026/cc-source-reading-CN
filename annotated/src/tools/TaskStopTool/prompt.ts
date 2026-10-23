export const TASK_STOP_TOOL_NAME = 'TaskStop'

export const DESCRIPTION = `
- Stops a running background task by its ID
- Takes a task_id parameter identifying the task to stop
- Returns a success or failure status
- Use this tool when you need to terminate a long-running task
`
// DESCRIPTION 与 TASK_STOP_TOOL_NAME 都在本文件导出——布局与其它三件套不同。
// DESCRIPTION 是四行要点式：停什么 / 收什么参数 / 回什么 / 什么时候用。
