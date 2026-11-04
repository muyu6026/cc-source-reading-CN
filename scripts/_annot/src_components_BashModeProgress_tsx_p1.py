# -*- coding: utf-8 -*-
ANNOTATIONS = [
    (13, 'before', '''Bash 模式进度区：把用户输入回显为 bash-input 消息，并在有进度时渲染 shell 进度。'''),
    (20, 'after', '''先把原始输入包成 `<bash-input>…</bash-input>` 文本交给用户输入消息组件。'''),
    (55, 'after', '''有进度时走 `ShellProgressMessage`，无进度回退到 `BashTool` 的进度渲染。'''),
]
