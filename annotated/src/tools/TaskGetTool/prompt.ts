export const DESCRIPTION = 'Get a task by ID from the task list'
// DESCRIPTION 与 PROMPT 同文件导出。

// PROMPT 大模板字符串（模型操作手册）。内部是纯文案，逐行锚点会被模板字符串保护机制外移到段尾。
export const PROMPT = `Use this tool to retrieve a task by its ID from the task list.

## When to Use This Tool

- When you need the full description and context before starting work on a task
- To understand task dependencies (what it blocks, what blocks it)
- After being assigned a task, to get complete requirements

## Output

Returns full task details:
- **subject**: Task title
- **description**: Detailed requirements and context
- **status**: 'pending', 'in_progress', or 'completed'
- **blocks**: Tasks waiting on this one to complete
- **blockedBy**: Tasks that must complete before this one can start

## Tips

- After fetching a task, verify its blockedBy list is empty before beginning work.
- Use TaskList to see all tasks in summary form.
`
// 使用场景三条：动手前拿完整需求 / 弄清依赖方向 / 被派活后核对判据。
// Output 一节逐字段解释，与 TaskGetTool.ts 的 outputSchema 一一对应。
// Tips 第一条是硬规矩：动手前先确认 blockedBy 为空，否则很可能在做一件还被堵着的事。
