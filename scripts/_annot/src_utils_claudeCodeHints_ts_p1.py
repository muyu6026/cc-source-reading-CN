# -*- coding: utf-8 -*-
slug = 'src_utils_claudeCodeHints_ts'
ANNOTATIONS = [
    (1, 'after', '''文件总述：Claude Code hints 协议。运行在 Claude Code 下的 CLI 与 SDK 可通过向 stderr 输出自闭合的 <claude-code-hint /> 标签（被 shell 工具并到 stdout）来提示安装某插件；本端扫描工具输出、在送达模型前剥离这些标签，并向用户弹出安装提示——不推断、不主动执行。文件同时提供解析器与一个单槽的待处理提示存储（React 经 useSyncExternalStore 订阅）。'''),
    (21, 'after', '''ClaudeCodeHintType：当前仅定义 plugin 一种提示类型。'''),
    (39, 'after', '''ClaudeCodeHint 结构：spec 版本、类型鉴别符、负载值（plugin 时为 name@marketplace 形式）、来源命令首 token。'''),
    (42, 'after', '''SUPPORTED_VERSIONS：本端认识的 spec 版本（仅 1）。'''),
    (45, 'after', '''SUPPORTED_TYPES：本端支持的类型集合。'''),
    (53, 'after', '''HINT_TAG_RE：整行锚定的自闭合标签匹配（多行模式），容忍行首尾空白，避免把日志里引用该标签的句子误当成提示。'''),
    (61, 'after', '''ATTR_RE：属性解析，支持 key=「value」与 key=value 两种，值含空白或引号须用带引号形式；引号形式不支持转义序列。'''),
    (120, 'after', '''extractClaudeCodeHints：扫描输出、剥离提示标签、返回解析结果；模型只看到剥离后的文本，提示是仅本端使用的旁路通道。'''),
    (128, 'after', '''parseAttrs：把标签体的属性组装成字典。'''),
    (134, 'after', '''firstCommandToken：取命令首个空白前 token 作为来源命令，便于用户核对提示与推荐插件是否一致。'''),
    (159, 'after', '''setPendingHint：单槽写入，本会话已展示过则变 no-op（防止每次调用都堆积）。'''),
    (173, 'after', '''markShownThisSession：翻转每会话一次的展示标志，仅在对话框真正弹出时调用。'''),
    (193, 'after', '''_test：导出内部函数供单元测试使用。'''),
]
