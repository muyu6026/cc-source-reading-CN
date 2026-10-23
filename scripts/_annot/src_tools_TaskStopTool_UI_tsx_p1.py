ANNOTATIONS = [
    (6, 'after', r'''Output 类型从 TaskStopTool.js 导入——渲染层与工具层靠类型契约连接，不靠运行时。'''),
    (9, 'after', r'''renderToolUseMessage 返回空串：调用气泡（正在停止…）不显示任何正文。'''),
    (11, 'after', r'''两个截断常量：最多 2 行、最多 160 字符宽——停掉的后台命令可能是一整段脚本，全显示会撑爆对话流。'''),
    (22, 'after', r'''truncateCommand 双重截断：先砍行数再砍显示宽度，最后 trim。verbose 模式下调用方绕过它看全文。'''),
    (27, 'after', r'''renderToolResultMessage(output, progressMessages, {verbose})：verbose 由 UI 层传人，决定截断还是全显。'''),
    (30, 'after', r'''恒假条件 "external" === 'ant'：疑似泄漏构建把 process.env.USER_TYPE 替换成了字面量 "external"，与 'ant' 比永远为 false——这个「ant 用户不渲染」的分支被砌死了，等价于所有人都不走该分支。'''),
    (33, 'after', r'''suffix 逻辑：命令被截断时才加省略号，结尾统一缀 ' · stopped'。'''),
    (39, 'after', r'''MessageResponse 包 Text——走统一 markdown 渲染通道，命令里的特殊字符不会冲破 UI。'''),
]
