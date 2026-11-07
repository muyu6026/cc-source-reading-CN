ANNOTATIONS = [
    (1, 'after', """`import * as React` 取全部命名，供 JSX 与节点类型使用。"""),
    (2, 'after', """`LocalJSXCommandContext` 是命令运行期上下文类型，来自命令类型模块。"""),
    (3, 'after', """渲染组件是 `SkillsMenu`，命令只负责装配它。"""),
    (4, 'after', """`LocalJSXCommandOnDone` 约束退出回调的形状。"""),
    (5, 'after', """`call` 异步返回 React 节点，形参为退出回调与运行期上下文。"""),
    (6, 'after', """渲染技能菜单，传入退出回调与命令列表（取自 `context.options.commands`）。"""),
]
