# -*- coding: utf-8 -*-
# 第 167 批：src/context/voice.tsx 批注数据（编译器产物）
ANNOTATIONS = [
    (1, 'after', '''依赖：React Compiler 运行时、React 核心 hook、外部 store；voice 状态存在独立 store 里。'''),
    (10, 'after', '''VoiceState 类型：idle、recording、processing 三态加错误、临时稿、音量、预热标志。'''),
    (17, 'after', '''DEFAULT_STATE：把五字段初始化，预热关闭、音量空数组。'''),
    (19, 'after', '''VoiceContext：用 React Context 把 store 向下传，初始为 null。'''),
    (22, 'after', '''Props：组件只收 children。'''),
    (39, 'after', '''VoiceProvider：编译器产物，把 children 包进 Provider，store 用 useState 惰性创建。'''),
    (49, 'after', '''useVoiceStore：取 store，没命中 Provider 就抛错提醒必须在 Provider 内使用。'''),
    (69, 'after', '''useVoiceState：订阅状态切片，靠 Object.is 比对只在选中值变化时重渲染。'''),
    (78, 'after', '''useSetVoiceState：返回 store.setState，引用稳定、不会触发重渲染。'''),
    (87, 'after', '''useGetVoiceState：返回 getState，供事件回调里同步读最新值（同一 tick 内可读到刚写的值）。'''),
]
