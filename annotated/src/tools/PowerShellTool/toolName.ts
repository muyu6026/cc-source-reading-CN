// Here to break circular dependency from prompt.ts
// 独立两行文件只为打破循环依赖：prompt.ts 要引用工具名常量，而工具名不能反向 import prompt（那里有函数体）。
export const POWERSHELL_TOOL_NAME = 'PowerShell' as const
