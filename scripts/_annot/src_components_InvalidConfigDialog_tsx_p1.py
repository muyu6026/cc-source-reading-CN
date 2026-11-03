ANNOTATIONS = [
    (1, 'after', '''InvalidConfigDialog 处理配置文件 JSON 非法的极端情况：即使配置读不出来，也要能弹出一个可操作的对话框让用户选择退出或重置。'''),
    (14, 'after', '''InvalidConfigHandlerProps 只传一个解析错误对象。'''),
    (20, 'after', '''InvalidConfigDialogProps 需要文件路径、错误描述，以及退出/重置两个回调。'''),
    (22, 'after', '''InvalidConfigDialog 的注释说明：当 Claude 配置文件包含非法 JSON 时展示这个对话框。'''),
    (113, 'after', '''InvalidConfigDialog 组件把文件路径、错误描述、选项列表（Exit and fix manually / Reset with default configuration）拼进一个 error 色的 Dialog；handleSelect 按选择调用 onExit 或 onReset。'''),
    (116, 'after', '''showInvalidConfigDialog 的注释说明：用硬编码主题名避免与 getGlobalConfig 形成循环依赖，这样即使配置文件有 JSON 语法错误也能显示对话框。'''),
    (120, 'after', '''SAFE_ERROR_THEME_NAME 固定为 dark，作为错误对话框的兜底主题，绝不依赖配置读取。'''),
    (155, 'after', '''showInvalidConfigDialog 用 render 把 InvalidConfigDialog 挂进 AppStateProvider + KeybindingSetup 里渲染：用户选退出就卸载并 process.exit(1)，选重置就写回默认配置再卸载并 process.exit(0)。'''),
]
