# 批注数据：src/utils/permissions/PermissionPromptToolResultSchema.ts
# slug: src_utils_permissions_PermissionPromptToolResultSchema_ts
ANNOTATIONS = [
    (13, 'after', '''本模块定义「权限提示工具」结果的结构（Zod schema）并把结果规整成内部的 PermissionDecision；SDK 主机可能传畸形数据，这里用 .catch 兜底而非整体拒绝。'''),
    (26, 'after', '''定义权限提示工具的输入 schema：工具名、工具输入、可选的 tool_use_id。'''),
    (28, 'after', '''由 schema 推导出的输入类型。'''),
    (30, 'after', '''权限结果的 Zod schema：作为真实 PermissionDecision 类型的子集来维护。'''),
    (42, 'after', '''决策分类字段（user_temporary/user_permanent/user_reject），可选；畸形值兜底为 undefined 而非拒绝整个决策（与下方 updatedPermissions 同一模式）。'''),
    (63, 'after', '''allow 结果 schema：含 behavior=allow、updatedInput、可选的 updatedPermissions（SDK 主机传畸形项时忽略而非拒绝，见 issue #29440）、toolUseID、decisionClassification。'''),
    (73, 'after', '''deny 结果 schema：含 behavior=deny、message、可选的 interrupt、toolUseID、decisionClassification。'''),
    (77, 'after', '''输出 schema 为 allow/deny 两种结果之一的联合类型。'''),
    (79, 'after', '''由输出 schema 推导的类型。'''),
    (89, 'after', '''把权限提示工具的结果规整成内部 PermissionDecision；参数含 tool、原始 input、toolUseContext。'''),
    (95, 'after', '''允许分支：若有 updatedPermissions 就写回 appState 并持久化。'''),
    (107, 'after', '''移动端从推送通知回应的客户端没有原始工具输入，会发空对象满足 schema；空对象当作「用原始输入」，避免工具在零参数下运行。'''),
    (111, 'after', '''据此决定使用更新后的输入还是原始输入（空对象时用原始）。'''),
    (117, 'after', '''拒绝且要求中断时，记日志并中止当前控制器。'''),
    (123, 'after', '''其余情况（deny 不中断）返回带 decisionReason 的结果。'''),
]
