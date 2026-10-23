// 一个 prompt.ts 装三样东西：工具名常量、DESCRIPTION（工具描述，进工具列表给模型选工具用）、PROMPT（调用时的操作手册）。
export const LIST_MCP_RESOURCES_TOOL_NAME = 'ListMcpResourcesTool'

// DESCRIPTION 带 server 字段说明和两个用法示例——每个资源对象都标注来源服务器，多服务器混合罗列时模型才知道各是谁家的。
export const DESCRIPTION = `
Lists available resources from configured MCP servers.
Each resource object includes a 'server' field indicating which server it's from.

Usage examples:
- List all resources from all servers: \`listMcpResources\`
- List resources from a specific server: \`listMcpResources({ server: "myserver" })\`
`

// PROMPT 与 DESCRIPTION 同构但更细：参数语义 + 不传 server 时的全量行为。
export const PROMPT = `
List available resources from configured MCP servers.
Each returned resource will include all standard MCP resource fields plus a 'server' field 
indicating which server the resource belongs to.

Parameters:
- server (optional): The name of a specific MCP server to get resources from. If not provided,
  resources from all servers will be returned.
`
// 模板字符串收尾。
