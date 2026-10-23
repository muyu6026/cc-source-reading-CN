# -*- coding: utf-8 -*-
ANNOTATIONS = [
    (21, 'after', '''// 块注释：ctrl+c/d 退出采用基于时间的双按机制（首次显示「再按一次退出」，超时内二次退出）；不用 chord 系统因首次按下需触发中断；键硬编码不可重绑；onInterrupt 让 feature 先处理中断。'''),
    (50, 'after', '''// 注入 useKeybindingsHook 避免 import 循环；isActive 默认 true，嵌入 TextInput 聚焦时设 false（子 useInput 先于父 useKeybindings 跑，否则同一按键父子 handler 双发）。'''),
    (57, 'after', '''// exitFn = onExit ?? exit：自定义退出处理器优先，否则用全局 useApp().exit。'''),
    (69, 'after', '''// ctrl+c 与 ctrl+d 各一个 double-press handler：首次置 pending（显示「再按一次退出」），超时内二次调用 exitFn 真正退出。'''),
    (82, 'after', '''// handleInterrupt 先让 feature 经 onInterrupt 处理（返回 true 短路），否则走 ctrl+c double-press；handleExit 直接走 ctrl+d double-press。'''),
    (92, 'after', '''// 注册 app:interrupt / app:exit 到 Global context；isActive 可关，避免嵌入 TextInput 时父子 handler 双发（child 先跑）。'''),
]
