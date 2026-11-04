# -*- coding: utf-8 -*-
ANNOTATIONS = [
    (12, 'before', 'DecisionReasonStrings：权限解释的归一化形状——reasonString 是主句，configString 是「去哪改」的提示，themeColor 存在时主句按主题色渲染纯文本而非 Ansi。'),
    (21, 'before', 'stringsForDecisionReason：把六种 PermissionDecisionReason 归一成上面三元组的纯函数。展示层所有分支判断收在这里，组件本体只剩渲染。'),
    (25, 'before', '分类器原因（BASH_CLASSIFIER 或 TRANSCRIPT_CLASSIFIER 特性开启时）：auto-mode 分类器给 error 红色——它是自动批准链路上要求人工确认的环节，视觉上要显眼。'),
    (34, 'before', '其他分类器：分类器名加粗、无主题色、无 configString——分类器阈值不是用户可配置项，不存在「去哪改」的提示。reasonString 里内嵌换行，Ansi 渲染时原样输出两行。'),
    (39, 'before', '规则原因：规则值经 permissionRuleValueToString 还原成 Bash 开头这类可读形式加粗显示。configString 按 source 分流——policySettings 是企业策略下发的，用户改不了，所以不给 /permissions 提示。'),
    (44, 'before', 'hook 原因：附加可选的原因文本与来源标签（方括号暗色），configString 指向 /hooks。hook 名加粗便于在多 hook 环境里定位。'),
    (53, 'before', 'safetyCheck 与 other 合并处理：只显示原始 reason，无配置提示——这两类原因的处置方式在触发侧已经定型。'),
    (59, 'before', 'workingDir 原因：工作目录外操作被拦，提示 /permissions 调整规则。default 返回 null——未知原因类型宁可不给解释也不编一句。'),
    (68, 'before', '组件本体：_c(11) 四段缓存。permissionMode 从全局状态读取，仅用于第 89 行的主题色兜底判断。'),
    (89, 'before', 'themeColor 兜底：hook 原因加 auto 权限模式时用 warning 色——auto 模式下 hook 拦截是用户唯一的安全阀，黄色警示。stringsForDecisionReason 已给的色（如分类器红）优先。'),
    (92, 'before', '渲染分流：有 themeColor 走 ThemedText 纯文本；否则走 Ansi 组件——reasonString 里嵌着 chalk 加粗转义序列，Ansi 解析后按序渲染。两条路径产出的段进同一记忆槽。'),
    (101, 'before', 'configString 暗色小字渲染在主句下方——「为什么拦」与「去哪改」一上一下，权限弹窗的信息架构就此完成。'),
]
