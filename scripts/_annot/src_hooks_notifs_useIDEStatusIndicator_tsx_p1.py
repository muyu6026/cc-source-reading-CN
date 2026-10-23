# -*- coding: utf-8 -*-
# 批注数据：src/hooks/notifs/useIDEStatusIndicator.tsx
# 五态互斥分流（连接/断开/JetBrains/安装失败/提示）+ 全局计数上限

ANNOTATIONS = [
    (11, 'before', '''// 提示最多出现 5 次：hasShownHintRef 管本次会话，全局 config 的
// ideHintShownCount 管跨会话，双保险避免每次启动都弹。'''),

    (17, 'after', '''// IDE 状态指示器。四个 useEffect 各管一条通知，靠前置布尔量
// （shouldShowIdeSelection / shouldShowConnected / showIDEInstallError /
// showJetBrainsInfo）做互斥分流，每个 effect 内都是「条件不满足就
// removeNotification」的清理模式，不满足时自动撤通知。'''),

    (41, 'after', '''// JetBrains 系 IDE 单独一路：它们的连接状态不能靠 MCP 客户端判断，
// 走 ideInstallationStatus.ideType 识别，文案也不同。'''),

    (43, 'before', '''// 有选中文件或有选中文本行时才显示「当前选区」，
// 否则退化为单纯的「已连接」状态。'''),

    (58, 'before', '''// 双重去重：会话内 ref 防同一挂载周期重复弹，
// 全局计数防跨会话每天启动都骚扰。'''),

    (61, 'before', '''// setTimeout 用参数透传而非闭包捕获——闭包会引用当轮渲染的
// addNotification/hasShownHintRef，3 秒后闭包里的引用可能过期；
// 传参写法拿到的始终是最初那份，与 effect 清理 clearTimeout 配对。'''),

    (174, 'before', '''// 提示本体：JSX 通知，低优先级（low），不自动倒计时消失。'''),

    (180, 'before', '''// 每次真正展示后把全局计数 +1（config 更新用 immutable 展开）。'''),
]
