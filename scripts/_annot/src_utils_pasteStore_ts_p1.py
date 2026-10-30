ANNOTATIONS = [
    (8, 'after', '''粘贴缓存目录名：跨会话持久化的 paste-cache 目录。'''),
    (23, 'after', '''hashPastedText 收尾：取内容 sha256 前 16 位作文件名，导出以便调用方先同步拿哈希。'''),
    (53, 'after', '''storePastedText 收尾：内容寻址，同哈希即同内容覆盖安全，文件权限 0600。'''),
    (70, 'after', '''retrievePastedText 收尾：读不到或出错返回 null，ENOENT 属预期不告警。'''),
    (104, 'after', '''cleanupOldPastes 收尾：按修改时间清理早于截止日的 .txt 文件，逐文件错误忽略。'''),
]
