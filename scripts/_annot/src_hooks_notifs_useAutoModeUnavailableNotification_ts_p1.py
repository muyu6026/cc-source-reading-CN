# -*- coding: utf-8 -*-
# 批注数据：src/hooks/notifs/useAutoModeUnavailableNotification.ts
# auto 模式不可用一次性提示：shift-tab 轮播绕过 auto 槽位时

ANNOTATIONS = [
    (13, 'after', '''// shift-tab 权限轮播从非 auto 模式绕回 default、且 auto 不可用
// （设置禁用/熔断/组织白名单）时，一次性提示原因。
// 启动时 defaultMode: auto 被静默降级的情况不归这里管
// （走 verifyAutoModeGateAccess → checkAndDisableAutoModeIfNeeded）。'''),

    (19, 'after', '''// 依赖 prevModeRef 做「上一次是什么模式」的跨渲染记忆，
// 才能识别「轮播绕了一圈回来」这个动作。'''),

    (26, 'after', '''// prevModeRef 初值取当前 mode——首帧不误判为「切换过」。'''),

    (32, 'before', '''// feature() 是编译期常量条件：没开 TRANSCRIPT_CLASSIFIER
// 的构建里这段代码整块消失（与恒假条件不同，这是有意的死代码消除）。'''),

    (36, 'before', '''// 四条件同时满足才算「绕过了 auto 槽位」：
// 落到 default + 上次不在 default + 上次也不在 auto
// + auto 当前不可用 + 用户主动开过 auto（opt-in）。'''),

    (48, 'before', '''// shownRef 一次性闸门：整个会话只提醒一次，
// 不跟着用户反复 shift-tab 刷屏。'''),
]
