# 数据文件：src/utils/envUtils.ts

ANNOTATIONS = [
    (1, 'before', '''文件级：汇集与环境变量相关的工具函数——配置主目录解析、布尔 / 选项判断、裸模式判定、env 解析、AWS / Vertex 区域推导。'''),
    (14, 'after', '''getClaudeConfigHomeDir：memoize 缓存的配置主目录，优先 CLAUDE_CONFIG_DIR，否则回退 ~/.claude，并以 NFC 归一化；缓存键绑定该环境变量以便测试取到新值。'''),
    (18, 'after', '''getTeamsDir：在 Claude 配置主目录下取 teams 子目录路径。'''),
    (30, 'after', '''hasNodeOption：按空白切分 NODE_OPTIONS 并精确匹配某 flag，避免误判。'''),
    (37, 'after', '''isEnvTruthy：把环境变量值归一化后判断是否「真」（1 / true / yes / on）。'''),
    (47, 'after', '''isEnvDefinedFalsy：判断变量是否「显式设为假」（0 / false / no / off），未定义返回 false。'''),
    (65, 'after', '''isBareMode：裸模式（--bare / CLAUDE_CODE_SIMPLE）跳过钩子、LSP、插件同步、凭据读取等，约 30 处门控共用本判定；直接查 argv 是因部分门控早于 main 设置环境变量。'''),
    (90, 'after', '''parseEnvVars：把 KEY=VALUE 形式的字符串数组解析成对象，缺值则报错提示正确写法。'''),
    (98, 'after', '''getAWSRegion：返回 AWS 区域，依次取 AWS_REGION / AWS_DEFAULT_REGION，默认 us-east-1。'''),
    (105, 'after', '''getDefaultVertexRegion：返回默认 Vertex 区域，取 CLOUD_ML_REGION，默认 us-east5。'''),
    (113, 'after', '''shouldMaintainProjectWorkingDir：判断是否应在每条命令后把工作目录复位到原 cwd。'''),
    (123, 'after', '''isRunningOnHomespace：判断是否在 Homespace（内部云环境）运行，需 USER_TYPE 与 COO 标记同时满足。'''),
    (147, 'after', '''isInProtectedNamespace：保守判定是否运行在受保护（特权或 ASL3+）命名空间，信号模糊时宁可报受保护；外部构建会 DCE 掉该分支。'''),
    (183, 'after', '''getVertexRegionForModel：按模型前缀匹配区域覆盖变量（更具体前缀优先），取不到则用默认 Vertex 区域；VERTEX_REGION_OVERRIDES 定义前缀到环境变量映射。'''),
]
