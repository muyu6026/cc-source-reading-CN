# -*- coding: utf-8 -*-
# annotations for src/components/RemoteCallout.tsx (76 lines)
ANNOTATIONS = [
    (13, 'before', '远程控制首次提示：只在没看过、桥接已启用、且已登录时出现一次'),
    (16, 'after', 'onDoneRef 转发：两个 useCallback 都是空依赖，回调最新值靠 ref 读'),
    (18, 'after', '取消即 dismiss：Esc 不改变任何配置'),
    (23, 'after', '挂载即写 remoteDialogSeen：先标记后交互，保证只弹一次'),
    (25, 'after', '写配置用函数式更新并提前 return current：已是 true 就不再产生新对象，避免无谓写盘'),
    (32, 'after','选择后透传 enable 或 dismiss'),
    (36, 'after', '两个选项都带 description：说明做什么（开安全连接）与后果（随时可用斜杠命令关掉）'),
    (46, 'after', '正文两段：能做什么（网页或 app 接着用）加怎么退出（再跑一次远程命令）'),
    (68, 'before', 'shouldShowRemoteCallout 三段判据：已看过、桥接未启用、无 accessToken，任一成立即不显示'),
]
