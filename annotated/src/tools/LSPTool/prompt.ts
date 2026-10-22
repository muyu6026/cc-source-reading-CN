export const LSP_TOOL_NAME = 'LSP' as const

// 工具名就是 LSP 三个字母——代码智能工具的用户面名字走编辑器术语，而不是 XxxTool 后缀惯例。
export const DESCRIPTION = `Interact with Language Server Protocol (LSP) servers to get code intelligence features.

Supported operations:
- goToDefinition: Find where a symbol is defined
- findReferences: Find all references to a symbol
- hover: Get hover information (documentation, type info) for a symbol
- documentSymbol: Get all symbols (functions, classes, variables) in a document
- workspaceSymbol: Search for symbols across the entire workspace
- goToImplementation: Find implementations of an interface or abstract method
- prepareCallHierarchy: Get call hierarchy item at a position (functions/methods)
- incomingCalls: Find all functions/methods that call the function at a position
- outgoingCalls: Find all functions/methods called by the function at a position

All operations require:
- filePath: The file to operate on
- line: The line number (1-based, as shown in editors)
- character: The character offset (1-based, as shown in editors)

Note: LSP servers must be configured for the file type. If no server is available, an error will be returned.`
// 描述把九个操作、必需参数、1-based 坐标约定和「需配置服务器」前提全部讲清——这是给模型的操作手册，模型据此自行选择操作与判断失败原因。
