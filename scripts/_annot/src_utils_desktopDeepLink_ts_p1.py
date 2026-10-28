# -*- coding: utf-8 -*-
# 批注：src/utils/desktopDeepLink.ts
ANNOTATIONS = [
    (11, 'after', '桌面端最低兼容版本，低于此版本无法承接会话接力'),
    (13, 'before', '判断是否开发模式：除 NODE_ENV 外，还要看可执行路径是否落在各 build 目录里'),
    (35, 'before', '拼出接力深链：claude://resume?session=&cwd=，开发模式改用 claude-dev 协议'),
    (50, 'before', '判断桌面端是否安装：macOS 查 Claude.app、Linux 查 xdg 处理器、Windows 查注册表协议项；开发模式直接当已装'),
    (89, 'before', '读取已装桌面端版本：macOS 读 plist、Windows 在 Squirrel 安装目录里挑最高的 app-X.Y.Z'),
    (129, 'before', '桌面端安装状态三态：未安装 / 版本过旧 / 就绪'),
    (137, 'before', '综合判断是否安装并校验版本兼容性，版本探不到时按就绪放行'),
    (161, 'after', '通过版本校验即就绪；探不到版本时前面已提前按就绪放行'),
    (168, 'before', '按平台机制打开深链：macOS 用 open、Linux 用 xdg-open、Windows 用 cmd start，开发模式用 AppleScript 路由到运行中的 Electron'),
    (206, 'before', '对外入口：确认桌面端已装后拼深链并打开，返回成功与否与深链地址'),
    (75, 'after', 'Windows 下查询注册表中 claude 协议项是否存在来判断安装'),
]
