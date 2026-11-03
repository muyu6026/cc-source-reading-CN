# -*- coding: utf-8 -*-
ANNOTATIONS = [
    (36, 'before', '''按需惰性加载特性门控工具（REVIEW_ARTIFACT / WORKFLOW / MONITOR）：特性未开启时对应组件置空。'''),
    (47, 'before', '''permissionComponentForTool：按工具类型映射到对应的权限请求子组件。'''),
    (83, 'before', '''PermissionRequestProps：权限请求通用属性（确认/拒绝回调、粘底栏等）。'''),
    (102, 'before', '''ToolUseConfirm：一次工具调用的确认上下文，含输入、结果、各类回调。'''),
    (128, 'before', '''getNotificationMessage：根据工具类型拼出通知栏的提示文案。'''),
    (145, 'after_block', '''TODO：此逻辑应迁移到 Tool.renderPermissionRequest。'''),
    (146, 'before', '''PermissionRequest：统一入口，根据工具分派到具体子组件并注册中断快捷键。'''),
    (180, 'after', '''注册中断快捷键（app:interrupt），用户交互时取消当前确认与拒绝。'''),
    (190, 'after', '''若需关注权限提示，启动一个超时通知。'''),
    (192, 'before', '''根据工具选出对应的权限子组件类型。'''),
    (202, 'before', '''渲染选中的权限子组件，透传确认/拒绝/verbose 等属性。'''),
]
