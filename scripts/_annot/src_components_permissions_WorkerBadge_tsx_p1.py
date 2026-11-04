# 批注数据：source/src/components/permissions/WorkerBadge.tsx
ANNOTATIONS = [
    (6, 'before', '''组件入参：工人名称 name 与代表其颜色的 color 字符串。'''),
    (15, 'before', '''块注释说明：渲染带颜色的徽章显示权限请求来自哪个集群工人；函数把颜色转成 ink 色并渲染「● @名称」。'''),
    (23, 'after', '''将传入颜色字符串转换为 ink 可用的颜色值。'''),
    (32, 'after', '''渲染加粗的名称文本，前缀 @ 表示工人身份。'''),
    (40, 'after', '''横向排列黑圈与名称，整体套上转换后的 ink 颜色。'''),
    (47, 'after', '''返回组装好的彩色徽章节点。'''),
]
