# -*- coding: utf-8 -*-
ANNOTATIONS = [
    (1, 'before', '''本文件定义 shell 类型与 ShellProvider 接口：目前仅支持 bash 与 powershell 两种，DEFAULT_HOOK_SHELL 默认 bash；ShellProvider 抽象出「构造执行命令串、取 spawn 参数、取额外环境变量」三类与具体 shell 相关的能力。'''),
    (5, 'before', '''ShellProvider 类型：用结构化对象描述一种 shell 的运作方式。buildExecCommand 负责拼出含快照、会话环境、禁用 extglob、pwd 追踪的完整命令串；getSpawnArgs 返回 spawn 用的参数数组；getEnvironmentOverrides 可异步做初始化（如 bash 的 tmux socket 准备）。'''),
]
