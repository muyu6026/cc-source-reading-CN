# -*- coding: utf-8 -*-
ANNOTATIONS = [
    (7, 'before', 'IdleReturnAction 四值：continue 继续当前会话、clear 以新会话发出消息、dismiss 只关弹窗不做决定、never 不再询问。'),
    (13, 'before', '空闲返回弹窗：检测到用户离开一段时间后回来，提示「要不要趁机开新会话」——旧上下文越长越慢越贵，这是省 token 的入口。'),
    (20, 'before', '两个格式化各自独立记忆化：时长与 token 数是仅有的两个动态入参，其余全为静态。'),
    (41, 'before', 'onCancel 映射为 dismiss：Esc 关闭弹窗既不继续也不清理，下次空闲仍会询问（never 才是永久关闭）。'),
    (49, 'before', '说明文案进常量槽：点明清上下文的两个收益——省用量、更快。只劝一次，选择权留给用户。'),
    (76, 'before', '选项数组三个：continue、clear、never。注意 dismiss 不在选项里——它是 Esc 专属的第四态，界面上不引导用户选它。'),
    (104, 'before', 'formatIdleDuration 三档：不足一分钟显示小于 1m；不足一小时只显分钟；跨小时显小时加余分钟，余数为零则只显小时。文案密度与空闲时长成正比。'),
]
