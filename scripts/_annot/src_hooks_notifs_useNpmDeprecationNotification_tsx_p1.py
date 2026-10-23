# -*- coding: utf-8 -*-
# 批注数据：src/hooks/notifs/useNpmDeprecationNotification.tsx
# npm 安装方式弃用警告：一次性提示迁移到原生安装器

ANNOTATIONS = [
    (5, 'before', '''// 固定文案：npm 安装方式已停止维护，引导 claude install。'''),

    (9, 'before', '''// 三处短路：bundled 模式 / 显式关闭安装检查 /
// development 安装（自己就是开发者，不需要提示）。'''),

    (10, 'after', '''// DISABLE_INSTALLATION_CHECKS 环境变量可静音整个检查。'''),

    (17, 'before', '''// 15s 长停留：这条迁移提示值得用户停下来读。'''),
]
