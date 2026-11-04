# -*- coding: utf-8 -*-
# annotations for src/components/BypassPermissionsModeDialog.tsx (87 lines)
ANNOTATIONS = [
    (12, 'before', '危险模式（Bypass Permissions）确认弹窗：进入前必须显式接受全部责任'),
    (24, 'after', '挂载即打点 shown：空依赖只求值一次，对应漏斗的「展示」环节'),
    (27, 'after', 'onChange 写成命名函数便于编译器缓存；参数被收窄成 accept 与 decline 两值'),
    (31, 'after', 'accept 路径三步：打点、写 userSettings 的 skipDangerousModePermissionPrompt、回调 onAccept——接受后不再重复警告'),
    (40, 'after', 'decline 直接 gracefulShutdownSync(1)：拒绝就以退出码 1 退出进程，不提供「稍后再说」'),
    (50, 'after', 'Esc 走 _temp2 用退出码 0：与选 decline 的退出码 1 区分开，便于区分主动退出与拒绝'),
    (53, 'after', '警告文案三段递进：不询问就执行危险命令 / 只应在网络受限且可恢复的沙箱里用 / 后果自负，末尾挂安全文档链接'),
    (60, 'after', '选项顺序 No 在前 Yes 在后：危险操作的默认光标落在安全项上'),
    (73, 'after', 'value_0 as accept|decline：Select 回调参数是 string，这里做一次类型断言收窄'),
]
