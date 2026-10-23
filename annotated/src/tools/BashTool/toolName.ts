// Here to break circular dependency from prompt.ts
// 两行文件，唯一存在理由是打破循环依赖：prompt.ts 要用工具名字符串，而 BashTool.ts 又要 import prompt.ts 的 getSimplePrompt。把常量搬到独立模块，两边都能 import。
export const BASH_TOOL_NAME = 'Bash'
