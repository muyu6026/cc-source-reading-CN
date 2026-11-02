ANNOTATIONS = [
    (1, 'before', """模块总述：权限规则相关的 zod schema 与类型再导出。具体类型定义被抽到 `src/types/permissions.ts` 以打破 import 环，这里只做 schema 构造与兼容再导出。"""),
    (9, 'after', """引入 lazySchema：把 zod schema 的构造延迟到首次使用时，避免启动期一次性求值所有 schema 带来的开销。"""),
    (25, 'before', """permissionBehaviorSchema：权限行为三态枚举——`allow` 放行、`deny` 拒绝、`ask` 强制向用户弹确认。"""),
    (35, 'before', """permissionRuleValueSchema：规则值形状，含 `toolName` 与可选 `ruleContent`，具体工具在自身的 `checkPermissions` 里自定义语义。"""),
]
