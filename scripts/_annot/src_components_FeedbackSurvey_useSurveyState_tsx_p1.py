# -*- coding: utf-8 -*-
ANNOTATIONS = [
    (5, 'before', 'SurveyState 六态：closed、open、thanks、transcript_prompt（追问是否分享转录）、submitting（上传中）、submitted（已分享）。问卷与转录分享串联成一条状态机。'),
    (14, 'before', 'useSurveyState：问卷生命周期 hook。回调全部由调用方注入——本 hook 只管状态迁移，打点与上传都在外面。'),
    (30, 'before', 'appearanceId 存 ref：每次打开问卷生成新 UUID——同一次展示里的所有打点（展示、选择、转录分享）用同一 id 串联成漏斗；ref 而非 state，异步回调里读取不用担心闭包过期。'),
    (32, 'before', 'showThanksThenClose：感谢页显示 hideThanksAfterMs 毫秒后回 closed 并清空上次响应。setTimeout 预填两个 setter 作参数——编译器产物省去一层闭包的写法。'),
    (39, 'before', 'showSubmittedThenClose：分享成功的收尾，submitted 态同样定时回 closed。与 thanks 态分开——「谢谢参与」与「已成功分享」给用户的心理确认不同。'),
    (43, 'before', 'open：只在 closed 态可开，防重复打开；每次打开换新 appearanceId 并触发 onOpen 打点。'),
    (51, 'before', 'handleSelect 返回布尔值告知调用方是否进入了转录追问（外层要据此切换视图）。关键顺序：先把响应写进 state 与 ref 双写（ref 供后续异步上传用）、再发问卷打点、最后分流——打点永远先于界面变化，丢不了。'),
    (56, 'before', '三分支：dismissed 直接关且不留痕；shouldShowTranscriptPrompt 判定该响应值得追问转录（通常是差评）则进 transcript_prompt 态；否则谢幕。'),
    (68, 'before', 'handleTranscriptSelect：yes 进 submitting 异步上传——成功进 submitted、失败或异常都回退到 thanks（分享失败不报错，感谢参与）；no 与 dont_ask_again 也上报打点后直接谢幕。任何路径都有明确终态，状态机无死角。'),
]
