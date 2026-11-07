# 批注数据：src/commands/plan/index.ts
ANNOTATIONS = [
    (1, 'after', '''`/plan` 命令的注册入口，用于进入计划模式或查看当前会话计划。'''),
    (7, 'after', '''`argumentHint` 取值 `[open|<description>]`：带 `open` 进入计划模式，或给一段描述让模型先拟定计划。'''),
    (9, 'after', '''`type` 取值 `local-jsx`，真正的计划编辑器在 `plan.tsx` 中懒加载。'''),
]
