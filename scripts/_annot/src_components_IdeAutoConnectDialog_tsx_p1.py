ANNOTATIONS = [
    (1, 'after', '''IdeAutoConnectDialog 提供是否启用自动连接 IDE 的开关对话框，以及它的反向版本（禁用自动连接）；两个对话框都只在终端不受支持时才出现。'''),
    (10, 'after', '''IdeAutoConnectDialogProps 只需一个 onComplete 关闭回调。'''),
    (72, 'after', '''IdeAutoConnectDialog 让用户选 yes/no：选 yes 就把 autoConnectIde 写入配置并标记对话框已展示，再关闭；底部提示还能去 /config 或加 --ide 改设置。'''),
    (76, 'after', '''shouldShowAutoConnectDialog 的判定：终端不受支持、且还没启用自动连接、且欢迎框还没展示过，才弹出。'''),
    (79, 'after', '''IdeDisableAutoConnectDialogProps 多一个 onComplete 回传是否禁用的布尔。'''),
    (143, 'after', '''IdeDisableAutoConnectDialog 默认聚焦 no：选 yes 才把 autoConnectIde 置 false 并回传 true，取消则回传 false；标题提示也能在 /config 里改。'''),
    (149, 'after', '''_temp 是禁用时的配置写入：把 autoConnectIde 设为 false。'''),
    (153, 'after', '''shouldShowDisableAutoConnectDialog 的判定：终端不受支持且已经启用了自动连接时，才提示用户是否禁用。'''),
]
