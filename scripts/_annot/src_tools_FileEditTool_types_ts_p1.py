ANNOTATIONS = [
    (6, 'before',
     "schema 全部用 `lazySchema` 包一层，而不是直接 `z.object(...)`。原因：zod 的 schema 构造在模块加载时就执行，工具多达几十个、每个又有嵌套结构，会在启动时白花几十毫秒；`lazySchema` 把构造推迟到**第一次取 schema**（真正需要校验参数时）。`localSchema`/`lazySchema` 这层薄壳在仓里到处可见，就是为启动速度。这里还用 `strictObject`——多传字段直接报错，而不是静默丢弃，能逼模型改正参数形状。"),
    (15, 'before',
     "`replace_all` 是 `semanticBoolean(...)` 而不是裸 `z.boolean()`。因为这个字段模型经常传字符串（`true` / `false` / `yes`「是」）。`semanticBoolean` 在 `preprocess` 阶段把这些都转成布尔，同时**对外仍声明为 boolean**——所以 `describe` 里写的语义和实际接受范围不完全一致，是故意的宽容。`.default(false).optional()` 两者都要写：`default` 管缺省值，`optional` 管类型上允许不传。"),
    (24, 'after',
     "类型用的是 `z.output` 而不是 `z.input`。注释解释了为什么必须区分：有了 `semanticBoolean` 这层 `preprocess`，输入侧类型是 `unknown`（预处理函数接受任何东西），输出侧才是干净的 `boolean`。工具内部拿到的永远是解析后的值，所以 `FileEditInput` 必须取 `output`——否则 `replace_all` 的类型会变成 `unknown`，到处都是断言。"),
    (30, 'before',
     "`FileEdit` 是**运行时**类型，和 `FileEditInput` 的区别只有一点：`replace_all` 在这里是必填的 `boolean`。为什么要单独一个类型——下游（patch 计算、沙箱判断、等价比较）拿到的编辑对象都已经过归一化，不该再为「可能没传」做分支。类型系统在这里扮演的是「归一化完成」的凭证。"),
]
