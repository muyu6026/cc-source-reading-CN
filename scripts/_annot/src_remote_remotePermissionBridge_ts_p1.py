# -*- coding: utf-8 -*-
ANNOTATIONS = [
    (1, 'before', '''远端权限桥接：为远端模式构造合成助理消息与工具桩'''),
    (2, 'after', '''导入 randomUUID 生成消息唯一标识'''),
    (3, 'after', '''导入 SDKControlPermissionRequest 权限请求类型'''),
    (4, 'after', '''导入 Tool 工具接口类型'''),
    (5, 'after', '''导入 AssistantMessage 助理消息类型'''),
    (6, 'after', '''导入 jsonStringify 用于工具桩渲染'''),
    (12, 'after', '''createSyntheticAssistantMessage：为远端权限请求造一个合成助理消息'''),
    (16, 'after', '''远端模式没有真实助理消息（工具调用跑在 CCR 容器），需合成'''),
    (36, 'after', '''usage 全填 0（合成消息不计量真实消耗）'''),
    (53, 'after', '''createToolStub：为本端未加载的工具（如远端 MCP 工具）造最小桩'''),
    (56, 'after', '''桩的 inputSchema 为空对象，isEnabled 恒真'''),
    (59, 'after', '''renderToolUseMessage：最多取输入前 3 个键值对做简要渲染'''),
    (71, 'after', '''call 返回空数据，needsPermissions 恒真以走兜底权限请求'''),
]
