# 数据文件：src/components/ManagedSettingsSecurityDialog/utils.ts
# slug = src_components_ManagedSettingsSecurityDialog_utils_ts
ANNOTATIONS = [
    (8, 'after', '''从危险 shell 设置常量推导出成员类型，保证后续只用常量里的键'''),
    (10, 'before', '''危险设置的聚合结构：危险 shell 设置、不在白名单的环境变量、是否含 hooks'''),
    (24, 'before', '''从 settings 抽取危险设置：空对象直接返回全空结构，避免上层判空'''),
    (37, 'after', '''遍历危险 shell 设置常量，只保留有非空字符串值的项'''),
    (50, 'after', '''环境变量是否危险以「不在安全白名单」为准：把键转大写后查 SAFE_ENV_VARS 集合'''),
    (62, 'after', '''是否有 hooks：存在、非空对象且键数大于 0 才算'''),
    (75, 'before', '''判断是否含任何危险设置：任一类别非空即为真'''),
    (87, 'before', '''比较新旧设置：仅当危险设置发生变化（新增或改动）才需要重新弹确认框'''),
    (105, 'after', '''把新旧危险设置序列化成 JSON 再比较字符串，任一不同即视为变化'''),
    (123, 'before', '''格式化为展示用的名称列表（只列名称不列值）：shell 设置、环境变量、hooks 三类依次追加'''),
]
