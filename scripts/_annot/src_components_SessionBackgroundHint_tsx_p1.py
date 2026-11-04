# -*- coding: utf-8 -*-
ANNOTATIONS = [
    (19, 'before', '文件头块注释：ctrl+b 采用双击模式——第一次按下只显示提示，800 毫秒内第二次才真正把会话转后台；且仅在加载中且无前台任务时激活，因为 bash 与代理任务的前台/后台切换同样占用 ctrl+b，任务优先。'),
    (27, 'before', 'SessionBackgroundHint：_c(10) 五段缓存，大部分槽是函数与上下文对象，可见输出只有第 93 行的一行提示。'),
    (36, 'before', 'useDoublePress 把双击逻辑封装成 hook：第一次触发 setShowSessionHint 显示提示，第二次触发 onBackgroundSession。_temp 是空的第一击回调。'),
    (39, 'before', 'handleBackground 三层判定：环境变量禁用直接返回；有前台任务则 backgroundAll 全部转后台（首次使用时写全局配置标记，下次不再引导）；否则走会话级双击后台。'),
    (50, 'before', 'isEnvTruthy 加字面量 false 恒为假——这是构建期把某个 feature 常量内联成 false 的痕迹：会话级后台功能在此构建里被裁掉，代码结构保留但分支永不执行。读反编译产物时见到字面量布尔判断，先怀疑 feature flag。'),
    (64, 'before', 'hasForeground 用 useAppState 订阅前台任务状态：它同时驱动第 73 行的键位激活条件与 backgroundAll 分支——订阅而非挂载读取，任务启停会实时改变 ctrl+b 的语义。'),
    (73, 'before', '键位激活条件：有前台任务，或（会话后台开启且正在加载）。isLoading 为假时 ctrl+b 完全不响应——没有可后台的东西。'),
    (87, 'before', 'tmux 特判：tmux 的 ctrl+b 是前缀键，真实按键变成连按两次，提示文案相应改成 ctrl+b ctrl+b——快捷键提示必须还原用户手指的真实动作。'),
    (88, 'before', '不在加载中或提示未显示时渲染 null：提示只在「第一次按过、等第二次」的窗口期可见，800 毫秒超时后自动消失。'),
]
