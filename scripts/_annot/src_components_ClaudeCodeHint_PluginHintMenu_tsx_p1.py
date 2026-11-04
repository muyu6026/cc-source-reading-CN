# -*- coding: utf-8 -*-
# annotations for src/components/ClaudeCodeHint/PluginHintMenu.tsx (78 lines)
ANNOTATIONS = [
    (12, 'before', '30 秒自动关闭：与 LSP 插件推荐弹窗同一套策略，忽略算 no'),
    (20, 'after', 'onResponseRef 转发最新回调，定时器只在挂载时装一次'),
    (23, 'after', '超时调 onResponse 传 no：setTimeout 第三参把 ref 传进去，回调里读 current'),
    (26, 'before', 'onSelect 只显式处理 yes 与 disable，其余落 default 当 no——比枚举三个值更耐新增值'),
    (35, 'after', 'default 兜底成 no：新增值默认按拒绝处理，保守'),
    (38, 'after', '三个选项：安装（名字加粗）、不装、不装且不再提示——第三条才是真正的关闭开关'),
    (54, 'after', '文案点明是哪个命令触发的推荐：sourceCommand 加粗，用户能对上刚才的操作'),
    (66, 'after', 'pluginDescription 可选：没有就不渲染这一行'),
    (73, 'after', 'onCancel 等价于选 no：Esc 不算 disable，下次还会提示'),
]
