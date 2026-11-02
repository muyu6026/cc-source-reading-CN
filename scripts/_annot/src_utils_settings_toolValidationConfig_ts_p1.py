# 批注数据：src/utils/settings/toolValidationConfig.ts
ANNOTATIONS = [
    (8, 'after', '''定义工具校验配置类型。三类字段：filePatternTools 接受文件通配符（如 *.ts、src/**）；bashPrefixTools 接受星号任意位置与旧式冒号前缀；customValidation 为个别工具提供定制校验函数。'''),
    (26, 'after', '''导出唯一配置实例。多数工具无需特殊配置，这里只登记少数有格式要求的工具。'''),
    (43, 'after', '''WebSearch 的定制校验：内容里出现星号或问号即判非法，提示改用精确检索词。'''),
    (56, 'after', '''WebFetch 的定制校验：必须使用 domain:主机名 形式，URL 或裸主机名一律拒绝。'''),
    (91, 'after', '''判断某工具是否按文件通配符解析参数。'''),
    (96, 'after', '''判断某工具是否按 Bash 通配符（星号任意位置）解析参数。'''),
    (101, 'after', '''按工具名取出对应的定制校验函数；可能不存在，调用方需自行判空。'''),
]
