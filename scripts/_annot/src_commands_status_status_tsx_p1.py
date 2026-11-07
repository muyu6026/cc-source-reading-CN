# 批注数据：src/commands/status/status.tsx
ANNOTATIONS = [
    (1, 'after', '''`/status` 命令的本地 JSX 渲染入口，复用通用设置组件并直接定位到状态页签。'''),
    (3, 'after', '''`Settings` 是共享的设置面板组件，命令入口只负责选好默认页签再渲染，避免重复造 UI。'''),
    (7, 'after', '''复用同一个 `Settings` 组件，用 `defaultTab` 取值 `Status` 指定默认打开「状态」页签，`onClose` 接 `onDone` 关闭命令。'''),
]
