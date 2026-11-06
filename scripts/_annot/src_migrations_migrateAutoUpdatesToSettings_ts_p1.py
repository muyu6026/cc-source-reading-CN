# -*- coding: utf-8 -*-
ANNOTATIONS = [
    (7, 'after', '''依赖：analytics 上报、全局配置、错误日志、设置读写（注意：首个 import 用的是 src/ 绝对前缀）'''),
    (8, 'before', '''迁移：将用户显式关闭的自动更新偏好迁移到 settings.json 环境变量（保留用户意图，同时让原生安装可自动更新）'''),
    (13, 'after', '''迁移主函数'''),
    (14, 'after', '''取全局配置'''),
    (23, 'after', '''仅当用户显式关闭自动更新、且非原生保护时才迁移'''),
    (26, 'after', '''读取现有 userSettings'''),
    (36, 'after', '''无论是否已存在都覆盖写入 DISABLE_AUTOUPDATER=1 以保用户意图'''),
    (44, 'after', '''立即生效：直接设置进程环境变量'''),
    (47, 'after', '''从全局配置移除 autoUpdates 字段'''),
    (55, 'after', '''catch：迁移失败时记录错误并上报'''),
    (60, 'after', '''catch 块结束'''),
]
