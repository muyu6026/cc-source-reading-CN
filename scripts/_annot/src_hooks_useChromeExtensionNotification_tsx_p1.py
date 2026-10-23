# -*- coding: utf-8 -*-
ANNOTATIONS = [
    (7, 'after', '''// CLI 参数解析：--chrome 强制开、--no-chrome 强制关、都不给则 undefined 走默认。'''),
    (16, 'after', '''// 本 hook 只是壳：把 compute 逻辑 _temp 委托给 useStartupNotification 基座，\n// 复用其「一次性计算 + 远程门控」的通用流程。'''),
    (24, 'after', '''// 注：if (true && !isClaudeAISubscriber()) 里的 true && 是 feature flag 移除后的残留恒真短路，\n// 已无开关意义（与构建环境泄漏的恒假条件不同类，但同样值得清理）。'''),
    (32, 'after', '''// 扩展未装且不在 Homespace 环境时弹「未检测到扩展」提示（带安装链接），5 秒低优。'''),
]
