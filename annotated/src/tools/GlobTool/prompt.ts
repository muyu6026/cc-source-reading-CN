export const GLOB_TOOL_NAME = 'Glob'

export const DESCRIPTION = `- Fast file pattern matching tool that works with any codebase size
- Supports glob patterns like "**/*.js" or "src/**/*.ts"
- Returns matching file paths sorted by modification time
- Use this tool when you need to find files by name patterns
- When you are doing an open ended search that may require multiple rounds of globbing and grepping, use the Agent tool instead`
// 工具描述里的两条行为约定值得注意：「按修改时间排序」是给模型的检索策略暗示（优先看最近改动的文件）；最后一条把开放式搜索导向 Agent 工具——单轮 glob/grep 便宜，多轮搜索让子代理去做，避免主对话被中间结果塞满。
