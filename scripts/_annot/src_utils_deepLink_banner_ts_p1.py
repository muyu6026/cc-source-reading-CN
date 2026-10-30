# 批注数据：src/utils/deepLink/banner.ts
# slug: src_utils_deepLink_banner_ts
ANNOTATIONS = [
    (1, 'after', '''深链来源横幅：当会话由外部 claude-cli:// 深链打开时，构建警示文字提示用户当前工作目录与来源，防范伪造提示词与钓鱼目录。'''),
    (22, 'after', '''STALE_FETCH_WARN_MS：判定仓库 fetch 过期的阈值，7 天。'''),
    (30, 'after', '''LONG_PREFILL_THRESHOLD：预填提示词超过此字符数（1000）时，横幅改为明确提示「滚动审阅整段提示」，避免恶意尾部被挤出屏幕。'''),
    (41, 'after', '''DeepLinkBannerInfo：横幅所需信息结构，包含工作目录、预填长度、仓库 slug、上次 fetch 时间等可选字段。'''),
    (75, 'after', '''buildDeepLinkBanner：组装多行警示，始终显示工作目录；有仓库时补充分支与 fetch 年龄，有预填时提示用户审阅。'''),
    (90, 'after', '''readLastFetchTime 签名：读取 .git/FETCH_HEAD 的 mtime 作为上次 fetch 时间。'''),
    (102, 'after', '''readLastFetchTime 收尾：主仓库与公共目录的 FETCH_HEAD 都查，取较新者，使落在工作树时不会被误判为「从未 fetch」。'''),
    (112, 'after', '''mtimeOrUndefined：对单个路径 stat 并返回 mtime，失败返回 undefined。'''),
    (123, 'after', '''tildify：把家目录前缀的路径缩写为波浪号表示，便于在横幅中展示。'''),
]
