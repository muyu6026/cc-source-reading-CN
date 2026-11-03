# -*- coding: utf-8 -*-
ANNOTATIONS = [
    (22, 'after', '''Props 类型：暴露是否正在更新、成功提示开关、verbose 等控制项。'''),
    (35, 'after', '''versions 保存当前与最新版本号（可能为空），hasLocalInstall 标记是否存在本地安装。'''),
    (47, 'after', '''用 ref 保存最新的 isUpdating，让记忆化的 checkForUpdates 总是读到当前值，
避免 30 分钟定时触发时拿到陈旧闭包而并发启动第二次安装。'''),
    (161, 'after', '''checkForUpdates 核心：读取版本与通道，处理服务端最大版本封顶（kill switch），
按检测到的安装类型选择本地或全局更新方式，并记录成功/失败事件。'''),
    (169, 'after', '''每 30 分钟检查一次更新。'''),
    (197, 'after', '''组件返回状态展示：检测中、安装成功、或失败（提示 claude doctor / npm 命令）。'''),
]
