ANNOTATIONS = [
    (1, 'after', '''文件级说明：在 main.tsx 顶层并行触发 macOS 钥匙串读取，与导入期重叠以隐藏约 65 毫秒开销。'''),
    (23, 'after', '''超时常数：预取子进程 10 秒上限。'''),
    (39, 'after', '''legacyApiKeyPrefetch 状态：null 表示未开始，{stdout:null} 表示已完成但无键，便于同步读取器只信任完成的预取。'''),
    (63, 'after', '''spawnSecurity 收尾：退出码 44（未找到）视为有效空结果，超时则不打缓存让同步路径重试。'''),
    (89, 'after', '''startKeychainPrefetch 收尾：两个子进程各自并行，非 darwin 或裸模式为空操作。'''),
    (98, 'after', '''ensureKeychainPrefetchCompleted 收尾：在 preAction 阶段与 MDM 设置加载一起等待，几乎零额外成本。'''),
    (108, 'after', '''getLegacyApiKeyPrefetchResult 收尾：在同步 execSync 回退前消费预取结果。'''),
    (116, 'after', '''clearLegacyApiKeyPrefetch 收尾：与同步读取缓存失效一起清空，避免陈旧预取遮蔽新写入。'''),
]
