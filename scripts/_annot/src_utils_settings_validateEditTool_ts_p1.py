ANNOTATIONS = [
    (1, 'after', '''文件级：校验 settings 文件编辑结果是否符合 SettingsSchema，供 FileEditTool 复用、避免重复逻辑。'''),
    (14, 'before', '''validateInputForSettingsFileEdit：入参是文件路径、原文、以及返回编辑后内容的闭包；只对 Claude settings 文件做校验。'''),
    (27, 'after', '''若编辑前的文件已不符合 schema，则放行编辑（不阻断），否则要求编辑后也必须合法。'''),
    (45, 'after', '''收尾：编辑后仍合法返回 null；不合法则返回携带 message 与 errorCode=10 的失败结果（message 里附完整 schema 与反例提示）。'''),
]
