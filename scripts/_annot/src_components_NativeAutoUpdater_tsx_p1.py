# -*- coding: utf-8 -*-
ANNOTATIONS = [
    (42, 'after', '''getErrorType 按错误信息关键字把更新失败归类（超时、校验和、权限、磁盘、网络等），方便埋点区分。'''),
    (50, 'after', '''Props 类型与 AutoUpdater 一致：暴露更新状态、结果、成功提示与 verbose 开关。'''),
    (94, 'after', '''若当前版本已超过服务端最大允许版本，记录提示信息（maxVersionIssue）并展示警告横幅。'''),
    (154, 'after', '''checkForUpdates 调用原生安装器 installLatest 完成更新：
处理锁竞争（lockFailed 静默跳过）、记录成功/最新/失败事件，finally 中复位 isUpdating。'''),
    (162, 'after', '''每 30 分钟检查一次更新。'''),
    (192, 'after', '''组件返回状态展示：检测中、安装成功、失败提示，以及超过最大版本时的回滚提醒。'''),
]
