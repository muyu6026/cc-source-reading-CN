# source: src/utils/secureStorage/index.ts
ANNOTATIONS = [
    (1, 'before', '''按当前运行平台挑选安全的凭据存储实现：macOS 走 Keychain 并以明文做兜底，Linux 暂时直接用明文（注释里说待加 libsecret 支持）。'''),
    (17, 'after', '''函数返回：macOS 用 createFallbackStorage(macOsKeychainStorage, plainTextStorage) 做双保险，其余平台直接返回 plainTextStorage。'''),
]
