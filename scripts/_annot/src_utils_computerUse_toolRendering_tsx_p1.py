# 批注数据：src/utils/computerUse/toolRendering.tsx
# slug: src_utils_computerUse_toolRendering_tsx
ANNOTATIONS = [
    (5, 'after', '''computer-use 工具的渲染覆盖层：为 mcp__computer-use__* 系列工具提供用户可见名称与消息渲染逻辑，拼接进 client.ts 的默认工具对象，覆盖默认显示。'''),
    (17, 'after', '''CuToolInput：computer-use 工具输入的本地类型定义，包含坐标、文本、应用列表、区域、方向、时长等可选字段。'''),
    (20, 'after', '''fmtCoord：把坐标数组格式化为「(x, y)」字符串，未提供时返回空串。'''),
    (36, 'after', '''RESULT_SUMMARY：动作名到简短结果文字的映射表，用于在结果区显示一行弱化摘要（如「Captured」「Clicked」）。'''),
    (51, 'after', '''getComputerUseMCPRenderingOverrides 签名：返回覆盖对象，包含 userFacingName、renderToolUseMessage、renderToolResultMessage 三个函数，供 MCP 工具渲染使用。'''),
    (122, 'after', '''renderToolResultMessage：verbose 或输出非对象时返回 null，否则取 RESULT_SUMMARY 显示一行弱化摘要。'''),
    (124, 'after', '''getComputerUseMCPRenderingOverrides 收尾：返回上述覆盖对象，使 computer-use 工具在 UI 上呈现更友好的名称与摘要。'''),
]
