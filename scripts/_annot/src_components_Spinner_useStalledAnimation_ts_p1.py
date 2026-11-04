# -*- coding: utf-8 -*-
# annotations for src/components/Spinner/useStalledAnimation.ts (76 lines)
ANNOTATIONS = [
    (6, 'before', 'useStalledAnimation：token 停流后把 spinner 渐变成红色的动画，时钟由父组件传入，所以终端失焦时会一起变慢'),
    (15, 'after', '五个 ref：上次 token 时间、上次响应长度、挂载时间、当前平滑强度、上次平滑时间'),
    (22, 'after', '渲染期直接改 ref：长度增长即视为有新 token，重置计时并把强度归零——这是渲染副作用，靠「只在变长时触发」保证幂等'),
    (31, 'after', '有活跃工具时不算卡顿：把 lastTokenTime 顶到当前，工具在跑的时候不该变红'),
    (34, 'after', '已有内容时算距上次 token 的时长；内容还是空时用挂载时间——首个 token 到来前同样在计时'),
    (42, 'after', '超过 3 秒且无活跃工具才判为卡顿'),
    (44, 'after', '强度在 3 到 5 秒之间线性升到 1（除以 2000 再夹到 1）'),
    (48, 'after', '平滑过渡只在需要渐变时做：按 50 毫秒一帧补算，最多补 steps 次'),
    (55, 'after', '差值小于 0.01 直接吸附：避免无限逼近永远到不了目标'),
    (59, 'after', '每帧逼近 10%：指数逼近，快而不生硬'),
    (64, 'after', '无需渐变时直接对齐：减动效或强度为 0 都不要中间态'),
    (70, 'after', '减动效模式用瞬时强度：不做平滑，尊重系统偏好'),
]
