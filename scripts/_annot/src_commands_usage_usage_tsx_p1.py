# 批注数据：src/commands/usage/usage.tsx
ANNOTATIONS = [
    (1, 'after', '''`/usage` 命令的本地 JSX 渲染入口，复用设置组件并默认打开「用量」页签。'''),
    (3, 'after', '''用 `LocalJSXCommandCall` 类型注解 `call`，约束其参数顺序与命令入口契约保持一致。'''),
    (6, 'after', '''复用 `Settings` 组件，以 `defaultTab` 取值 `Usage` 直接定位用量页，`onClose` 接 `onDone` 关闭命令。'''),
]
