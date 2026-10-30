ANNOTATIONS = [
    (1, 'after', '''文件级说明：keychainPrefetch 与 macOsKeychainStorage 共享的轻量辅助，严禁拖入 execa 等重依赖以免破坏预取优化。'''),
    (27, 'after', '''CREDENTIALS_SERVICE_SUFFIX：OAuth 凭据项与旧 API 密钥项的分隔后缀，改动会孤立既有凭据故不可变。'''),
    (41, 'after', '''getMacOsKeychainStorageServiceName 收尾：对非默认配置目录追加路径哈希后缀，默认目录不加以保向后兼容。'''),
    (49, 'after', '''getUsername 收尾：环境变量优先，失败回退固定用户名。'''),
    (69, 'after', '''缓存 TTL 与状态对象：30 秒跨进程陈旧窗口足够（OAuth 按小时过期），用对象包裹因 ES 模块 let 不能跨边界写。'''),
    (85, 'after', '''keychainCacheState 收尾：含缓存、代际号（使新结果不被陈旧子进程覆盖）、在途读取去重。'''),
    (91, 'after', '''clearKeychainCache 收尾：失效时递增代际号并清空在途 promise。'''),
    (111, 'after', '''primeKeychainCacheFromPrefetch 收尾：仅当缓存未被触碰才写入，已被同步读或更新抢占则丢弃此预取。'''),
]
