# 批注数据：source/src/services/plugins/pluginCliCommands.ts
# 格式：(行号, 'before'/'after'/'after_block', '中文批注')
# 行号一律指 source/ 原文；批注正文不写反斜杠。
ANNOTATIONS = [
    (57, 'after',
     "handlePluginCommandError：所有插件 CLI 命令的统一错误出口。关键设计是「先发遥测再退出」——emit tengu_plugin_command_failed，dashboard 才能拿它和对应的成功事件算出成功率；否则失败是静默的，监控里只有成功没有失败。函数返回 never，结尾必 process.exit(1)。"),

    (106, 'after',
     "CLI 包装层的老套路：调 Op（纯逻辑）→ !success 就 throw 把 message 变成 Error → 打 tick → 发遥测 → process.exit(0)。六个命令（install/uninstall/enable/disable/disable-all/update）全是这个形状，差别只在遥测事件名和字段。本模块只管 CLI 副作用（console + exit），业务全在 pluginOperations.ts。"),

    (139, 'after',
     "遥测的 PII 路由约定：插件名 / 市场名走 _PROTO_ 前缀，落到带 PII 标签的 BQ 特权列；未脱敏的 plugin_id 以前会进 general-access 的 additional_metadata（所有用户可见），已废弃。命令名、scope 这类非敏感字段则用 AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS 断言「这不是代码也不是文件路径」，与 api/logging.ts 那套命名约束同源。"),

    (286, 'after',
     "disable-all 没有单个 plugin 参数，遥测事件 tengu_plugin_disabled_all_cli 也就不带 _PROTO_plugin_name 等字段——发个空对象即可。"),

    (303, 'after',
     "updatePluginCli 与其他命令的退出方式不同：用 writeToStdout 而非 console.log，用 gracefulShutdown(0) 而非 process.exit(0)。更新可能已经改动了磁盘状态，需要走优雅关闭（flush 日志、有序收尾）而不是硬退。"),

    (340, 'after',
     "alreadyUpToDate 时不发 tengu_plugin_updated_cli——没有发生真实更新，发出去会污染「更新频率」指标。"),
]
