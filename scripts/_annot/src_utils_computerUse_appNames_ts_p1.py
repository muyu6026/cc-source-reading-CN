# -*- coding: utf-8 -*-
slug = 'src_utils_computerUse_appNames_ts'
ANNOTATIONS = [
    (1, 'after', '''文件总述：过滤并净化已安装 App 数据，供 request_access 工具的 description 使用；移植自 Cowork 的 appNames.ts。两块关注点：噪声过滤（Spotlight 会列出磁盘上每一个 bundle，包括 XPC 助手、守护进程、输入法）与提示注入加固（App 名是攻击者可控制的，谁都能发布任意名字的 App）。'''),
    (20, 'after', '''InstalledAppLike 类型：描述 listInstalledApps 返回的最小形状——bundleId、displayName、path 三项只读字段。'''),
    (22, 'after_block', '''噪声过滤小节的视觉分隔行，下面开始 PATH 白名单逻辑。'''),
    (36, 'after', '''PATH_ALLOWLIST：只展示这些根目录下的 App。/System/Library 的子路径（CoreServices、PrivateFrameworks、输入法）是系统管道，锚定已知好根而非黑名单每个垃圾子路径，因为新 macOS 版本会不断加更多。'''),
    (51, 'after', '''NAME_PATTERN_BLOCKLIST：即便在 /Applications 下，也按显示名模式剔除后台服务（Helper/Agent/Service/Uninstaller/Updater，以及以句点开头的项）。正则匹配关键字位于行尾或紧接左括号前的位置，例如 Slack Helper (GPU) 会被剔除，而 Service Desk 因 Service 后接空格 D 而保留。'''),
    (97, 'after', '''ALWAYS_KEEP_BUNDLE_IDS：CU 自动化常要的 App，若已安装则绕过路径检查与数量上限；用 bundleId（与区域设置无关）而非显示名，保持条目少于 30 个，每条都是 description 里保证出现的 token。'''),
    (99, 'after_block', '''提示注入加固小节分隔行：下面讨论如何防止恶意 App 名通过工具描述注入提示。'''),
    (110, 'after', '''APP_NAME 净化三件套：允许的字符集覆盖 Unicode 字母、组合附加符、数字、下划线、空格、点、&、单引号、括号、加号、减号（用 Unicode 属性而非 ASCII 专用写法，否则会丢弃带变音的外文名与中文名）；用单个空格而非空白类（避免换行被当成空格从而放过多行注入）；最大长度 40；最大数量 50。依然禁止引号、尖括号、反引号、管道符、冒号。'''),
    (121, 'after', '''isUserFacingPath：判断路径是否落在白名单根下（含按 homeDir 按需拼接的 ~/Applications）。'''),
    (125, 'after', '''isNoisyName：用 NAME_PATTERN_BLOCKLIST 命中即视为噪声名。'''),
    (148, 'after', '''sanitizeCore：长度裁剪、去首尾空白、去重、排序；对可信 bundleId 跳过字符过滤，避免本地化的特殊标点把合法名误删。'''),
    (157, 'after', '''sanitizeAppNames：超过 50 个时截断并在末尾补「… and N more」。'''),
    (161, 'after', '''sanitizeTrustedNames：可信名不过字符过滤。'''),
    (196, 'after', '''filterAppsForDescription：对外主入口，把 installed 分流为 alwaysKept（可信，绕过路径与字符过滤）与 rest（按路径与噪声名过滤），两套各自净化后合并去重返回。'''),
]
