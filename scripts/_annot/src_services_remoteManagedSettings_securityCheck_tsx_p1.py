ANNOTATIONS = [
    (12, 'after',
     "三值结果类型：approved（用户批准）/ rejected（用户拒绝）/ no_check_needed（无需检查）。\n"
     "第三种不是失败态——大多数拉取根本走不到对话框（没有危险设置、或危险设置没变）。"),

    (22, 'before',
     "checkManagedSettingsSecurity 是「远程设置应用到本地前」的最后一道人工闸门。\n"
     "它只回答一个问题：这批新设置里有没有**新出现或新变化**的危险项（权限、env 一类）需要用户点头。\n"
     "注意它不阻止「不危险的设置」自动生效——只有危险变更才弹窗。"),

    (31, 'after',
     "三道短路，任何一道命中就不弹窗：\n"
     "1) 新设置里没有危险项；\n"
     "2) 有危险项但和缓存里的完全一样（没变）——每次启动都重弹同一个对话框是骚扰；\n"
     "3) 非交互模式（-p、管道、CI）——没人能点按钮，弹也白弹（与 trust dialog 行为保持一致）。"),

    (39, 'after',
     "弹窗前发遥测 tengu_managed_settings_security_dialog_shown。接受/拒绝各自也有事件（见下）——\n"
     "三个事件凑一起才能算「弹了 N 次、用户接受了多少」的转化率。"),

    (61, 'after',
     "阻塞对话框用 render() 同步起一棵临时 Ink 树：AppStateProvider（读当前状态）→\n"
     "KeybindingSetup（对话框要响应按键）→ ManagedSettingsSecurityDialog。\n"
     "两层 render 嵌套是因为要等 render 返回 unmount 才能在 onAccept/onReject 里拆树——\n"
     "所以外层包了个 async IIFE，resolve 走 void（fire-and-forget）。\n"
     "getBaseRenderOptions(false) 传入表示不全屏。"),

    (73, 'after',
     "handleSecurityCheckResult 是 index.ts 里那个 if (!handle...) 的判断：\n"
     "用户拒绝 → gracefulShutdownSync(1) 直接退出进程（远程推送了危险设置且用户不认，\n"
     "继续跑等于违反用户意愿），返回 false 让调用方也别 apply。\n"
     "approved 和 no_check_needed 都返回 true 放行。\n"
     "（文件末尾的 sourcemap 注释是编译产物，本项目有意省略不批注。）"),
]
