ANNOTATIONS = [
    (1, 'before', '''文件级批注：`model.tsx` 实现「/model」命令的 UI 与逻辑——让用户在交互式选择器里切换主循环模型、显示模型与 effort 级别，并处理 Opus/Sonnet 的 1M 上下文可达性与 Fast mode 联动。本文件由 React Compiler 编译，运行时以 `_c` 缓存哨兵做惰性记忆化。'''),
    (17, 'after', '''依赖引入：React Compiler 运行时 `react/compiler-runtime`、chalk 着色、模型选择组件 `ModelPicker`，以及各类模型工具（别名、1M 可达性、校验、快模式）。'''),
    (114, 'after', '''`ModelPickerWrapper`：交互式模型选择容器。它读取当前模型、会话模型与快模式状态，渲染 `ModelPicker`，选择后写回 `AppState` 并按条件追加 Fast mode 与额外计费提示。'''),
    (138, 'after', '''`SetModelAndClose` 入口：以命令组件形式接收目标模型字符串，下方的 `useEffect` 里先做组织白名单、1M 可达性与别名校验，再写回 `mainLoopModel`。'''),
    (197, 'after', '''`handleModelChange` 收尾：先校验组织是否允许该模型，再查 1M 上下文是否对账号可用，最后走默认、别名、自定义校验三条路径，失败则回显可读错误。'''),
    (232, 'after', '''`SetModelAndClose` 收尾：校验通过后由 `useEffect` 触发模型切换并回显结果，按是否启用快模式追加 Fast mode 开/关与额外计费后缀。'''),
    (235, 'after', '''`isKnownAlias`：判断字符串是否属于预定义模型别名集合（大小写与空白不敏感）。'''),
    (239, 'after', '''`isOpus1mUnavailable`：当未开启 1M 访问且未启用合并、且模型名同时含 `opus` 与 `[1m]` 时，标记为不可用。'''),
    (245, 'after', '''`isSonnet1mUnavailable`：仅对 Sonnet 4.6 与 `[1m]` 变体做 1M 可用性拦截（Sonnet 4.5 的访问规则不同，故放过）。'''),
    (260, 'after', '''`ShowModelAndClose`：只读命令组件，展示当前模型（或 plan 模式的会话覆盖模型）与 effort 级别。'''),
    (292, 'after', '''`call`：命令入口，根据参数分流到内联帮助、帮助文本、设置模型或打开选择器四种情形。'''),
    (296, 'after', '''`renderModelLabel`：把模型标识渲染成可读标签，`null` 时回退到默认设置并标注「default」。'''),
]
