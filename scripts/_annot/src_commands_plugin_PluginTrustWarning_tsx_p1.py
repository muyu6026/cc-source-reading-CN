# 源文件: src/commands/plugin/PluginTrustWarning.tsx
ANNOTATIONS = [
    (6, 'after', '''编译产物（React Compiler 生成）：插件信任警告组件入口函数。下文三段 if 各对应一个 memo 缓存槽。'''),
    (15, 'after', '''第一段 memo：customMessage 由 getPluginTrustMessage() 算出，命中哨兵才重算，否则复用 $[0]。'''),
    (25, 'after', '''第三段 memo：t2 是完整警告行——警告图标 + 一段信任提示文案 + 可选的自定义消息（customMessage 存在才拼接）。'''),
    (30, 'after', '''直接返回预计算好的 t2。三个 memo 槽 $[0..2] 让组件在 props 不变时跳过重复计算。'''),
]
