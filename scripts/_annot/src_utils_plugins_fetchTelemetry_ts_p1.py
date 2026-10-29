# 数据文件：src/utils/plugins/fetchTelemetry.ts
# 中文批注锚点（行号以 Read 输出为准）。文本禁止英文双引号与反斜杠。
SOURCE_REL = 'src/utils/plugins/fetchTelemetry.ts'

ANNOTATIONS = [
    (19, 'after', '导入遥测上报与官方市场名常量，用于统计插件/市场网络拉取。'),
    (29, 'after', '两类枚举：拉取来源（安装计数、市场克隆、插件克隆等）与拉取结果（成功、失败、命中缓存）。'),
    (46, 'after', '公开主机白名单：只按名上报这些公共主机，企业内部或自托管主机统一归为 other，避免泄漏内部主机名。'),
    (68, 'after', 'extractHost：从 URL 或 git 规格里抽出主机名并按白名单归类，无法解析或本地路径归为 unknown。'),
    (77, 'after', 'isOfficialRepo：判断是否指向官方插件仓库（GitHub 投诉过的那个），便于在面板里把「我们的问题」和用户市场分开。'),
    (96, 'after', 'logPluginFetch：上报一次拉取遥测，字段只含受限枚举与主机名，不含代码、路径或原始报错，与既有隐私口径一致。'),
    (135, 'after', 'classifyFetchError：把错误归到稳定的桶（DNS、超时、连接重置、鉴权、未找到、TLS、非法结构、其它），控制维度基数；DNS 判定排在超时前以免被改写后的措辞误分类。'),
]
