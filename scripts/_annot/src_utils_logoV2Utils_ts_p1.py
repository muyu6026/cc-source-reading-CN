ANNOTATIONS = [
    (16, 'after', '''logoV2Utils 是 LogoV2 启动界面的布局与文案工具集：负责依据终端宽度选择布局模式、计算面板尺寸、截断路径与欢迎语、收集版本/工作目录/计费信息，以及格式化最近发布说明。'''),
    (22, 'after', '''布局常量：左侧最大宽度、用户名长度上限、边框/分隔/内容内边距等固定数值，供后续尺寸计算复用。'''),
    (35, 'after', '''getLayoutMode：按终端列数决定横向或紧凑布局，阈值约 70 列。'''),
    (75, 'after', '''calculateLayoutDimensions：根据最优左宽与可用空间计算左右面板宽度与总宽，超界时回退重算右宽。'''),
    (92, 'after', '''calculateOptimalLeftWidth：取欢迎语、工作目录、模型行三者显示宽度的最大值并加内边距，约束在左侧上限内。'''),
    (102, 'after', '''formatWelcomeMessage：用户名缺失或过长时回退为通用欢迎语，否则拼接用户名。'''),
    (180, 'after', '''truncatePath：宽度感知的中段省略算法，保留首尾路径段、按需保留中间段，正确处理 CJK 与单段情形。'''),
    (219, 'after', '''getRecentActivity：异步预加载最近会话并缓存 Promise，过滤掉侧链、当前会话与无效摘要；失败返回空。'''),
    (267, 'after', '''getLogoDisplayData：汇总展示所需的版本、工作目录、计费类型与智能体名，演示版与正式版路径不同。'''),
    (305, 'after', '''formatModelAndBilling：模型与计费宽度超界时折成两行分别截断，否则单行拼接。'''),
    (350, 'after', '''getRecentReleaseNotesSync：蚂蚁内部用构建期打包的提交，外部用户读已存储的更新日志，取最近若干版本说明。'''),
]
