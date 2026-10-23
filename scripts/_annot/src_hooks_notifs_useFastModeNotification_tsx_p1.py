# -*- coding: utf-8 -*-
# 批注数据：src/hooks/notifs/useFastModeNotification.tsx
# fast mode 四类事件通知：组织开关/超额拒绝/冷却开始/冷却结束

ANNOTATIONS = [
    (8, 'before', '''// 四类事件各一个通知 key，互不覆盖；冷却开始/结束用
// invalidates 互相关联（见下）。'''),

    (12, 'after', '''// fast mode 通知总装。三个 effect 分别订阅：组织级开关变化、
// 超额被拒、冷却开始/结束。所有 effect 都以 getIsRemoteMode 远程模式
// 静默退出——远程会话由别的渠道展示这些状态。'''),

    (29, 'before', '''// 组织管理员开关 fast mode：打开时提示「可用了」，
// 关闭时若本地还在用 fastMode，顺手把 appState 里的开关拨回去，
// 保持 UI 状态与服务端一致。'''),

    (101, 'before', '''// 冷却开始：算出「还有多久恢复」，文案由 getCooldownMessage
// 按原因（过载/限流）生成。'''),

    (108, 'before', '''// invalidates 互斥键：冷却开始通知会顶掉冷却结束通知
// （反之亦然），保证同一时刻只有一条相关通知在列。'''),

    (114, 'before', '''// 冷却结束：恢复文案用 fastMode 色。两个订阅在 cleanup 里
// 成对退订，防止 effect 重跑后旧回调双触发。'''),

    (139, 'before', '''// 两个匿名 reducer 都是把 fastMode 置 false
// （组织关闭 / 超额被拒两条路径殊途同归）。'''),

    (154, 'before', '''// 冷却文案工厂：overloaded 与 rate_limit 两种原因的措辞。
// switch 无 default——CooldownReason 联合类型在编译期收口。'''),
]
