# -*- coding: utf-8 -*-
ANNOTATIONS = [
    (20, 'before', 'PackageManagerAutoUpdater：走系统包管理器（brew、winget、apk）安装时的更新检查器。它只提示不自动升级——升级命令交给用户执行。Props 里的 isUpdating 等回调解耦自更早版本，本实现未用到，接口比实现宽。'),
    (25, 'before', '两个状态：updateAvailable 控制是否渲染提示，packageManager 决定给出哪家的升级命令。'),
    (28, 'before', 'checkForUpdates 进哨兵槽（整个生命周期同一引用，供 useInterval 稳定轮询）：禁用即返回；渠道与包管理器并行获取；再查 GCS 上的最新版本。'),
    (30, 'before', 'false 或 false 恒为假的死代码——编译器内联 feature flag 的残迹，原来源代码里是某个发布渠道的条件判断。'),
    (38, 'before', 'maxVersion 封顶逻辑：配置了版本上限且最新版超过上限时，把目标压到上限；若当前版本已达上限则直接跳过——企业环境用 maxVersion 锁版本，自动更新不得越界。'),
    (47, 'before', 'hasUpdate 三条件：有最新版、当前版本严格小于它、且不在跳过名单（shouldSkipVersion 屏蔽已知有问题的版本）。'),
    (71, 'before', 'useEffect 首次检查加 useInterval 每 30 分钟轮询——检查是轻量的版本号比对，30 分钟一次对用户无感。'),
    (76, 'before', '升级命令按包管理器三分支：homebrew、winget、apk 各自的确切命令，未知管理器给通用文案兜底——宁可说「用你的包管理器更新」也不给错误命令。'),
    (87, 'before', '提示行 warning 色加 truncate 换行裁剪——长命令在窄终端下截断而不换行，避免撑乱布局。'),
]
