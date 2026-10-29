# 数据文件：src/utils/managedEnvConstants.ts
# 一个源文件 = 一个数据文件。锚点：(行号, 位置, 中文批注)
# 位置 ∈ {before, after, after_block}；中文用三引号，禁用英文双引号与反斜杠。

ANNOTATIONS = [
    (1, 'after', '''文件级：集中定义「宿主托管环境变量」与「安全环境变量」两份清单，决定远端托管配置能否覆盖用户设置、哪些变量可在信任对话框前安全应用。'''),
    (31, 'before', '''鉴权类变量（API Key / Token / Bearer），一旦被托管覆盖会把鉴权请求导向攻击者控制的体系。'''),
    (56, 'after', '''PROVIDER_MANAGED_ENV_VARS：由宿主托管的变量全集，用户 settings.json 中的同名变量不得覆盖它们。'''),
    (62, 'after', '''PROVIDER_MANAGED_ENV_PREFIXES：按前缀匹配（如 VERTEX_REGION_CLAUDE_*），随模型发布扩展而无需逐条维护清单。'''),
    (70, 'after', '''isProviderManagedEnvVar：先大小写归一，再走精确匹配加前缀匹配，判断某变量是否由宿主托管。'''),
    (82, 'after', '''DANGEROUS_SHELL_SETTINGS：能执行任意 shell 代码的危险设置项，远端托管设置这些会触发安全对话框。'''),
    (84, 'after', '''SAFE_ENV_VARS 权威说明（自动挪到块尾）：本清单是「安全变量」唯一真相来源；注释列举了三类攻击面——重定向到攻击者服务器、信任攻击者服务器、切换到攻击者控制的工程。'''),
    (133, 'before', '''遥测（OTEL）相关变量只允许追加头与协议，不能改端点，否则可能把遥测导向外部。'''),
    (182, 'before', '''VERTEX_REGION_CLAUDE_* 系列按具体模型登记区域覆盖变量。'''),
    (191, 'after', '''SAFE_ENV_VARS 集合收尾：含 Anthropic 默认模型变量、OTEL 遥测、Bash 超时、区域与遥测开关等，凡允许信任对话框前安全应用的变量都在此登记。'''),
]
