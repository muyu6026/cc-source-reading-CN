# -*- coding: utf-8 -*-
slug = 'src_utils_earlyInput_ts'
ANNOTATIONS = [
    (1, 'after', '''文件总述：早期输入捕获。在 REPL 完全初始化之前捕获终端键入，用户常敲 claude 后立刻开始输入，这些早期按键在启动期会丢失；本模块在 REPL 就绪后把缓冲交还。'''),
    (17, 'after', '''三个模块级状态：输入缓冲字符串、是否正在捕获的标志、可读事件处理器的引用（便于后续移除）。'''),
    (52, 'after', '''readableHandler：在原始模式下用 readable 事件循环读取 stdin 分块并交给 processChunk 处理。'''),
    (67, 'after', '''startCapturingEarlyInput：仅在交互 TTY 且非打印模式时才捕获，设原始模式并监听 readable 事件；无法设原始模式时静默放弃。'''),
    (84, 'after', '''Ctrl+C（码值 3）：停止捕获并立即退出（早期启动期关闭流程尚未初始化，故直接用 process.exit(130)）。'''),
    (136, 'after', '''processChunk：逐字符处理输入——Ctrl+C 退出、退格删掉最后一个字素簇、跳过转义序列与不可打印控制符、回车转成换行，其余可打印字符入缓冲。'''),
    (157, 'after', '''stopCapturingEarlyInput：移除 readable 监听器，但不重置 stdin 状态（交给 REPL 的 Ink 管理，避免干扰其自身的 stdin 设置）。'''),
    (169, 'after', '''consumeEarlyInput：取出并清空缓冲（自动停止捕获），返回前会做 trim。'''),
    (176, 'after', '''hasEarlyInput：不消费地判断是否存在早期输入。'''),
    (184, 'after', '''seedEarlyInput：预填提示输入，REPL 渲染时会显示为已输入内容，但不自动提交。'''),
    (191, 'after', '''isCapturingEarlyInput：查询是否正在捕获。'''),
]
