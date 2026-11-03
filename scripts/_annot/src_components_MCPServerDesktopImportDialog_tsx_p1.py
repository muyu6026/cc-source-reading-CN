# -*- coding: utf-8 -*-
ANNOTATIONS = [
    (18, 'after', '''Props 类型：servers 为待导入的服务端配置、scope 决定写入哪个配置、onDone 收尾。'''),
    (61, 'after', '''挂载时调用 getAllMcpConfigs 拉取已有配置，写入 existingServers 状态。'''),
    (71, 'after', '''collisions 计算与已有配置重名的项，用于提示用户将被加数字后缀。'''),
    (90, 'after', '''onSubmit 将选中的服务器逐个写入指定 scope：
重名时自动追加 _1、_2 等数字后缀避免覆盖，最后回调 done(导入数量)。'''),
    (110, 'after', '''done 负责打印导入结果（成功条数或『未导入』），再优雅退出进程。'''),
    (161, 'after', '''组装多选列表，defaultValue 预选未冲突的服务器。'''),
    (202, 'after', '''组件返回『从 Claude Desktop 导入 MCP』对话框，含说明与快捷键提示。'''),
]
