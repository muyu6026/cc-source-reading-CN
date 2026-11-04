# -*- coding: utf-8 -*-
ANNOTATIONS = [
    (8, 'before', 'pathFromToolUse：鸭子类型探测——不检查工具类型，只看它有没有 getPath 函数。调用包在 try 里，工具自己的实现抛错就返回 null，权限弹窗绝不因工具 bug 而崩溃。'),
    (19, 'before', 'FilesystemPermissionRequest：文件系统类工具（读/写/编辑）的统一权限弹窗入口。按工具能否给出路径分流到文件专用弹窗或通用兜底弹窗。'),
    (31, 'before', 'path 与 userFacingName 各自记忆化：路径解析和工具展示名都是纯函数调用，依赖不同的字段就分开缓存。'),
    (49, 'before', 'isReadOnly 决定弹窗性质：只读工具标题是 Read file、操作类型 read；可写工具是 Edit file 与 write。同一组件承载读写两类确认，差异全部收进两个派生值。'),
    (53, 'before', 'path 为 null 直接早退到 FallbackPermissionRequest：工具没实现 getPath 就享受不到文件弹窗的路径级规则展示（允许编辑这个文件之类的选项），退回通用三选项。能力探测加优雅降级。'),
    (71, 'before', 'renderToolUseMessage：让工具自己渲染参数预览——权限弹窗不认识每个工具的参数结构，只提供主题与 verbose 配置。依赖四个值记忆化。'),
    (85, 'before', 'content：工具展示名加参数预览，拼成函数调用形态的一行——用户看到的就是即将执行的那次调用本身。'),
    (96, 'before', 'FilePermissionDialog 承接一切：parseInput 传的是恒等转换 _temp（文件尾定义）——文件弹窗要求的 parseInput 签名在这里无需真正转换。completionType 固定 tool_use_single。'),
]
