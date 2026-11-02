ANNOTATIONS = [
    (1, 'after', """本文件实现 XDG 基础目录规范，供 Claude CLI 原生安装器把组件放到合适的系统目录（状态/缓存/数据/用户 bin）。"""),
    (20, 'after', """`resolveOptions` 统一解析可选参数：允许测试时注入 `env` 与 `homedir`，缺省回落到 `process.env` 与实际家目录。"""),
    (32, 'after', """`getXDGStateHome` 返回 XDG 状态目录，默认 `~/.local/state`，可用 `XDG_STATE_HOME` 覆盖。"""),
    (42, 'after', """`getXDGCacheHome` 返回 XDG 缓存目录，默认 `~/.cache`，可用 `XDG_CACHE_HOME` 覆盖。"""),
    (52, 'after', """`getXDGDataHome` 返回 XDG 数据目录，默认 `~/.local/share`，可用 `XDG_DATA_HOME` 覆盖。"""),
    (62, 'after', """`getUserBinDir` 返回用户 bin 目录 `~/.local/bin`（虽不是严格 XDG 但遵循同一约定），仅支持 `homedir` 覆盖。"""),
]
