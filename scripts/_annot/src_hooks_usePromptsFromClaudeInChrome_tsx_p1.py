# -*- coding: utf-8 -*-
ANNOTATIONS = [
    (13, 'after', '''// Chrome 扩展发来的 prompt 通知走 JSON-RPC 2.0 的 notifications/message，\n// 用 zod 在运行时校验字段（prompt / image / tabId），image 限四种媒体类型。'''),
    (31, 'after', '''// 本 hook 双职责：① 监听 Chrome 扩展的 prompt 通知并入队成用户提示；\n// ② 把本地权限模式同步给扩展。React Compiler 编译产物，$ 是 memo 缓存槽。'''),
    (32, 'after', '''// React Compiler 注入的运行时：_c(6) 拿到 6 槽 memo 缓存，$[n] 命中则复用旧值，否则重算。'''),
    (51, 'after', '''// 权限模式翻译：本地 bypassPermissions 对应扩展的 skip_all_permission_checks，\n// 其余一律 ask（扩展侧不信任本地的 auto 兜底，避免未经确认就执行）。'''),
    (68, 'after', '''// 从 MCP clients 里挑出 type==='connected' 且 name 匹配 Chrome 扩展的那个 client。'''),
]
