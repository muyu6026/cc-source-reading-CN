# source: src/utils/plugins/officialMarketplaceGcs.ts
ANNOTATIONS = [
    (29, 'after', '''GCS 下载基址：与本地二进制同一公共桶（原生安装器也用这个原始 GCS URL），按 base repo SHA 内容寻址。'''),
    (34, 'after', '''归档内路径前缀：zip 里的条目都以 marketplaces/claude-plugins-official/ 开头，解压到笔记本安装时要把这段剥掉。'''),
    (50, 'after', '''幂等拉取官方市场：先比对 .gcs-sha 哨兵，仅在新 SHA 时下载约 3.5MB 的 zip 并解压；失败返回 null 由调用方决定回退 git。'''),
    (57, 'after', '''防御式校验：解析后拒绝落在市场缓存目录之外的任何路径（防损坏的 known_marketplaces.json 指向用户工程）。'''),
    (70, 'after', '''先等滚动空闲再联网，避免与滚动帧抢事件循环（启动期 fire-and-forget，几百毫秒延迟用户无感）。'''),
    (81, 'after', '''第一步取 latest 指针（约 40 字节，Cache-Control 短），每次启动都打，成本低。'''),
    (94, 'after', '''第二步读 .gcs-sha 哨兵；命中即视为已是最新，直接 noop 返回（不重复下载）。'''),
    (107, 'after', '''第三步下载 zip 到临时目录再原子交换；解压中途崩溃只留 .staging（下次清理），而不是半写的安装位置。'''),
    (118, 'after', '''fflate 不暴露 exec 位，于是自行解析 zip 中央目录恢复 Unix 权限，使 GCS 路径与 git 克隆的 +x 对齐（否则 Unix 上 sh 调用脚本会 EACCES）。'''),
    (131, 'after', '''仅当某条目带可执行位才 chmod，普通文件跳过以省系统调用；吞掉 EPERM/ENOTSUP（丢 +x 优于中断解压）。'''),
    (143, 'after', '''原子交换：删旧 + 改名；交换瞬间安装位置不存在，作为后台刷新可接受（崩溃则下次启动重试）。'''),
    (159, 'after', '''finally 里上报 tengu_plugin_remote_fetch 遥测（source 为 marketplace_gcs），所有字符串均为静态枚举或 git SHA，不含代码/路径/隐私。'''),
    (196, 'after', '''把失败归入稳定遥测桶（timeout/network/http_*/fs_*/zip_parse/empty_latest/other），以便决定是否翻 git 回退开关。'''),
]
