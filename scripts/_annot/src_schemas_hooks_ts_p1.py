ANNOTATIONS = [
    (1, 'after', '本文件把 hook 相关的 Zod 校验 schema 抽到独立模块，专门解决 settings/types.ts 与 plugins/schemas.ts 之间的循环依赖'),
    (16, 'after_block', '共享的「if 条件」字段 schema：使用权限规则语法（例如「Bash(git *)」）在生成前过滤该 hook 是否触发'),
    (19, 'before', '条件字段 schema 的懒加载工厂，避免在依赖环中过早求值'),
    (31, 'before', '内部工厂：统一构建四类 hook（命令、提示、HTTP、代理）的 schema'),
    (67, 'before', '提示型 hook：把用户输入交给 LLM 评估，使用占位符承载 hook 输入'),
    (97, 'before', 'HTTP 型 hook：把 hook 输入 JSON 通过 POST 发到指定 URL'),
    (128, 'before', '代理型（子代理验证）hook：这里刻意不加转换函数，原因见上方注释'),
    (176, 'before', '对外导出的命令型 hook schema：用判别联合聚合前面四类 schema'),
    (194, 'before', 'matcher 配置 schema：一个 hook 事件可以挂多个匹配器，每个匹配器再挂一组 hook'),
    (211, 'before', '顶层 hooks 配置 schema：以事件名为键的部分记录（并非所有事件都要定义）'),
    (222, 'after', '从 schema 反向推断出的公共类型导出，供其余模块复用（命令型、各子类型、matcher）'),
]
