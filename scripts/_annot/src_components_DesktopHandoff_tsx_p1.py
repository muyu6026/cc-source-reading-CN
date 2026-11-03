# -*- coding: utf-8 -*-
ANNOTATIONS = [
    (20, 'after', '''getDownloadUrl 按平台返回桌面版下载地址（win32 走 exe，其余走 darwin dmg）。'''),
    (26, 'after', '''DesktopHandoffState 是组件状态机：checking / prompt-download / flushing / opening / success / error。'''),
    (66, 'after', '''useInput 监听任意键：错误态直接结束；prompt-download 态按 y/n 决定下载还是放弃。'''),
    (109, 'after', '''useEffect 挂载时执行交接流程：检测安装状态→刷写会话→唤起桌面端→成功则延时回调并优雅退出。'''),
    (185, 'after', '''组件主体按状态返回不同视图（错误提示、下载确认、或各阶段加载文案）。'''),
    (192, 'after', '''_temp 为空实现，作为取消路径的兜底回调。'''),
]
