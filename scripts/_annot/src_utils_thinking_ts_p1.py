# -*- coding: utf-8 -*-
SOURCE_PATH = 'src/utils/thinking.ts'
ANNOTATIONS = [
    (13, 'after', '''ThinkingConfig 是思考模式的联合类型，三选一：adaptive 自适应、enabled 带预算令牌、disabled 关闭。'''),
    (24, 'after', '''isUltrathinkEnabled 用构建期 feature 开关加运行期 GrowthBook 灰度双重门控；构建标志控制外部包是否含此代码，GB 标志控制灰度放量。'''),
    (31, 'after', '''hasUltrathinkKeyword 用正则匹配单词 ultrathink（忽略大小写），检测文本里是否出现该关键词以触发深度思考。'''),
    (58, 'after', '''findThinkingTriggerPositions 返回所有 ultrathink 关键词的位置区间，供 UI 高亮或提示；每次调用都新建带 g 标志的正则，避免上次 test 调用泄漏 lastIndex 状态。'''),
    (68, 'after', '''RAINBOW_COLORS 与 RAINBOW_SHIMMER_COLORS 是彩虹色板的两套索引，按字符下标取色做「流光」效果。'''),
    (86, 'after', '''getRainbowColor 根据字符下标和是否开启 shimmer，从两套色板里循环取色。'''),
    (110, 'after', '''modelSupportsThinking 判定模型是否支持思考；三方覆盖优先，其次内部模型与 Provider 规则（1P/Foundry 看是否非 claude-3，3P 仅 Opus4 加与 Sonnet4 加）。'''),
    (144, 'after', '''modelSupportsAdaptiveThinking 判定是否支持自适应思考；4.6 系列直接用，其余 legacy 模型显式排除，未知模型在 1P/Foundry 默认开启。'''),
    (162, 'after', '''shouldEnableThinkingByDefault 默认开启思考；仅当环境变量设置了上限令牌且为 0，或用户显式关闭时才关。'''),
]
