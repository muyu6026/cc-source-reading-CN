# 批注数据：src/components/permissions/SkillPermissionRequest/SkillPermissionRequest.tsx
# slug: src_components_permissions_SkillPermissionRequest_SkillPermissionRequest_tsx
ANNOTATIONS = [
    (1, 'after', '''引入 React 编译器运行时：本文件是 React Compiler 自动记忆化产物，不是手写源码。'''),
    (15, 'after', '''末尾导入 PermissionRuleExplanation：展示该权限命中的规则来源。'''),
    (17, 'after', '''SkillOptionValue：用户可选择的四种结果——同意、精确记住、前缀记住、拒绝。'''),
    (18, 'after', '''SkillPermissionRequest 组件：确认是否运行某个 Skill 的权限弹窗。'''),
    (35, 'after', '''先用 SkillTool 的输入 schema 解析工具输入，取出 skill 名称。'''),
    (36, 'after', '''若权限结果是 ask 且元数据带 command，记录命令行对象用于展示说明。'''),
    (48, 'after', '''usePermissionRequestLogging 统一上报本次权限请求的遥测事件。'''),
    (64, 'after', '''showAlwaysAllowOptions 决定是否展示「不再询问」类选项。'''),
    (78, 'after', '''alwaysAllowOptions：根据 skill 名是否含空格，生成精确或前缀两种「记住」选项。'''),
    (154, 'after', '''noOption 是「拒绝」选项，用于拼到选项列表末尾。'''),
    (163, 'after', '''options 把基础选项、记住选项、拒绝选项拼成最终选择列表。'''),
    (185, 'after', '''toolAnalyticsContext 提取工具名与是否 MCP，用于遥测。'''),
    (278, 'after', '''handleSelect：按用户选择执行同意/加规则/拒绝，并上报对应的 unary 事件。'''),
    (302, 'after', '''handleCancel：用户取消时上报拒绝事件并触发 onReject/onDone。'''),
    (303, 'after', '''标题用 Use skill「xxx」? 提示用户即将运行的 Skill 名称。'''),
    (359, 'after', '''返回组装好的权限弹窗：说明 + 命令描述 + 规则来源 + 选项列表。'''),
    (361, 'after', '''_temp 解析 skill 工具输入，失败时记日志并返回空串。'''),
]
