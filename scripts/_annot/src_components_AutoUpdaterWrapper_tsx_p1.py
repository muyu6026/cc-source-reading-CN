# -*- coding: utf-8 -*-
# annotations for src/components/AutoUpdaterWrapper.tsx (91 lines)
ANNOTATIONS = [
    (19, 'before', '自动更新器包装：检测安装类型后分派三个更新器之一（包管理器/原生/标准）'),
    (29, 'after', '两个状态初始为 null：null 表示「还没检测完」，区别于 false 的「检测完不是」——三态设计'),
    (36, 'after', 'feature flag「SKIP_DETECTION_WHEN_AUTOUPDATES_DISABLED」是构建期内联常量 + isAutoUpdaterDisabled 运行时判断组合：用户显式禁用自动更新时跳过检测'),
    (40, 'after', 'getCurrentInstallationType 异步检测：native 则 setUseNativeInstaller(true)，package-manager 则 setIsPackageManager(true)，两者都 false 走标准 AutoUpdater'),
    (55, 'after', '检测未完成（任一仍为 null）渲染 null：避免闪现错误的更新器'),
    (58, 'before', '包管理器安装优先分派 PackageManagerAutoUpdater'),
    (74, 'after', '非包管理器时按 useNativeInstaller 选 Native 或标准更新器——变量命名 Updater 首字母大写以便作为 JSX 组件使用'),
    (77, 'after', '三个更新器共享同一组 props：更新状态回调接口统一，包装层只负责选型'),
]
