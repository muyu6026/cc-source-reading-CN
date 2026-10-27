# -*- coding: utf-8 -*-
ANNOTATIONS = [
    (1, 'after', """MDM 企业配置强制读取，按「首个存在的源胜出」策略合并，优先级 remote → HKLM/plist → managed-settings.json → HKCU。"""),
    (98, 'after', """启动期尽量早触发 MDM/HKCU 的异步子进程读取，与模块加载并行，首个设置读取前 await。"""),
    (109, 'after', """等待在途的 MDM 加载完成，若尚未启动则先触发。"""),
    (126, 'after', """返回仅含管理员来源（macOS 受管目录 / Windows HKLM）的设置，不含用户级 HKCU。"""),
    (134, 'after', """读取用户级 HKCU 注册表，仅 Windows 有意义，其他平台返回空。"""),
    (147, 'after', """清空 MDM 与 HKCU 缓存并重置加载承诺，迫使下次刷新重新读取。"""),
    (172, 'after', """重新发起一次 MDM 子进程读取并解析，但不写缓存，由调用方决定是否应用。"""),
    (199, 'after', """把子进程 JSON 输出解析为 SettingsJson，先过滤非法权限规则再走 schema 校验，避免一条坏规则拖垮整份设置。"""),
    (222, 'after', """从 reg query 的标准输出里按正则抽取 REG_SZ / REG_EXPAND_SZ 字符串值，大小写不敏感。"""),
    (273, 'after', """把原始子进程输出转成 MDM/HKCU 结果并套用「首个源胜出」策略，按 remote→HKLM→managed 文件→HKCU 顺序短路。"""),
    (316, 'after', """同步廉价检查受管设置文件（managed-settings.json 或 drop-in 目录）是否存在且有内容，用于更高优先级文件存在时跳过 HKCU。"""),
]
