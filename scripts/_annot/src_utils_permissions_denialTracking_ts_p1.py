ANNOTATIONS = [
    (1, 'after', '''文件级：权限分类器的拒绝追踪基础设施——统计连续拒绝与累计拒绝次数，决定何时回退到向用户提问。'''),
    (7, 'before', '''DenialTrackingState 类型：只含 consecutiveDenials（连续拒绝）与 totalDenials（累计拒绝）两个计数。'''),
    (12, 'before', '''DENIAL_LIMITS：连续拒绝上限 3、累计拒绝上限 20，超过即触发回退提问。'''),
    (17, 'before', '''createDenialTrackingState：初始化两个计数都为 0。'''),
    (24, 'before', '''recordDenial：返回新状态，连续与累计计数各加一（不可变更新，返回新对象）。'''),
    (32, 'before', '''recordSuccess：只要连续拒绝不为 0 就把连续计数清零（累计保留），记录一次成功后不再连续告警。'''),
    (45, 'after', '''shouldFallbackToPrompting 收尾：连续拒绝达上限或累计拒绝达上限时返回 true，提示应回退提问。'''),
]
