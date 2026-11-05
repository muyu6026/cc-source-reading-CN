import type { CompanionBones, Eye, Hat, Species } from './types.js'
import {
  axolotl,
  blob,
  cactus,
  capybara,
  cat,
  chonk,
  dragon,
  duck,
  ghost,
  goose,
  mushroom,
  octopus,
  owl,
  penguin,
  rabbit,
  robot,
  snail,
  turtle,
} from './types.js'

// 每个精灵五行高、十二列宽——宽度是占位符替换成单字符之后的值
// 每种生物三帧，用于待机时的小动作：眨眼、摆尾、冒烟
// 第零行是帽子槽：前两帧必须留空，第三帧可以拿它放烟雾或天线
// Each sprite is 5 lines tall, 12 wide (after {E}→1char substitution).
// Multiple frames per species for idle fidget animation.
// Line 0 is the hat slot — must be blank in frames 0-1; frame 2 may use it.
// 主体表以物种为键：键用的是从类型模块导入的常量，所以物种清单改动会在编译期暴露
const BODIES: Record<Species, string[][]> = {
// 鸭子这一族用括号与尖括号画嘴，第三帧把尾巴加长一点当作抖动
  [duck]: [
    [
      '            ',
      '    __      ',
      '  <({E} )___  ',
      '   (  ._>   ',
      '    `--´    ',
    ],
    [
      '            ',
      '    __      ',
      '  <({E} )___  ',
      '   (  ._>   ',
      '    `--´~   ',
    ],
    [
      '            ',
      '    __      ',
      '  <({E} )___  ',
      '   (  .__>  ',
      '    `--´    ',
    ],
  ],
// 鹅的帧间差别只在眼睛左右移动一格：很小的位移就能读出动静
  [goose]: [
    [
      '            ',
      '     ({E}>    ',
      '     ||     ',
      '   _(__)_   ',
      '    ^^^^    ',
    ],
    [
      '            ',
      '    ({E}>     ',
      '     ||     ',
      '   _(__)_   ',
      '    ^^^^    ',
    ],
    [
      '            ',
      '     ({E}>>   ',
      '     ||     ',
      '   _(__)_   ',
      '    ^^^^    ',
    ],
  ],
// 团子靠身体的宽窄变化模拟呼吸：帧一是最宽的一帧
  [blob]: [
    [
      '            ',
      '   .----.   ',
      '  ( {E}  {E} )  ',
      '  (      )  ',
      '   `----´   ',
    ],
    [
      '            ',
      '  .------.  ',
      ' (  {E}  {E}  ) ',
      ' (        ) ',
      '  `------´  ',
    ],
    [
      '            ',
      '    .--.    ',
      '   ({E}  {E})   ',
      '   (    )   ',
      '    `--´    ',
    ],
  ],
// 猫第三帧把耳朵的斜杠换成横线，等于一次眨眼抖动
  [cat]: [
    [
      '            ',
      '   /\\_/\\    ',
      '  ( {E}   {E})  ',
      '  (  ω  )   ',
      '  (")_(")   ',
    ],
    [
      '            ',
      '   /\\_/\\    ',
      '  ( {E}   {E})  ',
      '  (  ω  )   ',
      '  (")_(")~  ',
    ],
    [
      '            ',
      '   /\\-/\\    ',
      '  ( {E}   {E})  ',
      '  (  ω  )   ',
      '  (")_(")   ',
    ],
  ],
// 龙第三帧用波浪号在头顶画烟，所以这一族的帽子会被挡住——渲染时会先判空再放帽子
  [dragon]: [
    [
      '            ',
      '  /^\\  /^\\  ',
      ' <  {E}  {E}  > ',
      ' (   ~~   ) ',
      '  `-vvvv-´  ',
    ],
    [
      '            ',
      '  /^\\  /^\\  ',
      ' <  {E}  {E}  > ',
      ' (        ) ',
      '  `-vvvv-´  ',
    ],
    [
      '   ~    ~   ',
      '  /^\\  /^\\  ',
      ' <  {E}  {E}  > ',
      ' (   ~~   ) ',
      '  `-vvvv-´  ',
    ],
  ],
// 章鱼第三帧把头抬高一格，触手方向按奇偶帧反转
  [octopus]: [
    [
      '            ',
      '   .----.   ',
      '  ( {E}  {E} )  ',
      '  (______)  ',
      '  /\\/\\/\\/\\  ',
    ],
    [
      '            ',
      '   .----.   ',
      '  ( {E}  {E} )  ',
      '  (______)  ',
      '  \\/\\/\\/\\/  ',
    ],
    [
      '     o      ',
      '   .----.   ',
      '  ( {E}  {E} )  ',
      '  (______)  ',
      '  /\\/\\/\\/\\  ',
    ],
  ],
// 猫头鹰第三帧把一只眼睛换成横线，另一只仍是原来的眼睛字符
  [owl]: [
    [
      '            ',
      '   /\\  /\\   ',
      '  (({E})({E}))  ',
      '  (  ><  )  ',
      '   `----´   ',
    ],
    [
      '            ',
      '   /\\  /\\   ',
      '  (({E})({E}))  ',
      '  (  ><  )  ',
      '   .----.   ',
    ],
    [
      '            ',
      '   /\\  /\\   ',
      '  (({E})(-))  ',
      '  (  ><  )  ',
      '   `----´   ',
    ],
  ],
// 企鹅第三帧整体上移一行，底部用波浪号当水花
  [penguin]: [
    [
      '            ',
      '  .---.     ',
      '  ({E}>{E})     ',
      ' /(   )\\    ',
      '  `---´     ',
    ],
    [
      '            ',
      '  .---.     ',
      '  ({E}>{E})     ',
      ' |(   )|    ',
      '  `---´     ',
    ],
    [
      '  .---.     ',
      '  ({E}>{E})     ',
      ' /(   )\\    ',
      '  `---´     ',
      '   ~ ~      ',
    ],
  ],
// 乌龟第三帧把壳从下划线换成等号，表示缩进壳里
  [turtle]: [
    [
      '            ',
      '   _,--._   ',
      '  ( {E}  {E} )  ',
      ' /[______]\\ ',
      '  ``    ``  ',
    ],
    [
      '            ',
      '   _,--._   ',
      '  ( {E}  {E} )  ',
      ' /[______]\\ ',
      '   ``  ``   ',
    ],
    [
      '            ',
      '   _,--._   ',
      '  ( {E}  {E} )  ',
      ' /[======]\\ ',
      '  ``    ``  ',
    ],
  ],
// 蜗牛的眼睛长在触角顶端，所以占位符在身体外侧而不在脸上
  [snail]: [
    [
      '            ',
      ' {E}    .--.  ',
      '  \\  ( @ )  ',
      '   \\_`--´   ',
      '  ~~~~~~~   ',
    ],
    [
      '            ',
      '  {E}   .--.  ',
      '  |  ( @ )  ',
      '   \\_`--´   ',
      '  ~~~~~~~   ',
    ],
    [
      '            ',
      ' {E}    .--.  ',
      '  \\  ( @  ) ',
      '   \\_`--´   ',
      '   ~~~~~~   ',
    ],
  ],
// 幽灵每帧下摆的波浪方向不同，第三帧头顶再加两点
  [ghost]: [
    [
      '            ',
      '   .----.   ',
      '  / {E}  {E} \\  ',
      '  |      |  ',
      '  ~`~``~`~  ',
    ],
    [
      '            ',
      '   .----.   ',
      '  / {E}  {E} \\  ',
      '  |      |  ',
      '  `~`~~`~`  ',
    ],
    [
      '    ~  ~    ',
      '   .----.   ',
      '  / {E}  {E} \\  ',
      '  |      |  ',
      '  ~~`~~`~~  ',
    ],
  ],
// 美西螈靠两侧的花括号当外鳃，帧间只是左右翻转
  [axolotl]: [
    [
      '            ',
      '}~(______)~{',
      '}~({E} .. {E})~{',
      '  ( .--. )  ',
      '  (_/  \\_)  ',
    ],
    [
      '            ',
      '~}(______){~',
      '~}({E} .. {E}){~',
      '  ( .--. )  ',
      '  (_/  \\_)  ',
    ],
    [
      '            ',
      '}~(______)~{',
      '}~({E} .. {E})~{',
      '  (  --  )  ',
      '  ~_/  \\_~  ',
    ],
  ],
// 水豚第二帧改成大写字母的眼睛，第三帧头顶加波浪并把耳朵换个字母
  [capybara]: [
    [
      '            ',
      '  n______n  ',
      ' ( {E}    {E} ) ',
      ' (   oo   ) ',
      '  `------´  ',
    ],
    [
      '            ',
      '  n______n  ',
      ' ( {E}    {E} ) ',
      ' (   Oo   ) ',
      '  `------´  ',
    ],
    [
      '    ~  ~    ',
      '  u______n  ',
      ' ( {E}    {E} ) ',
      ' (   oo   ) ',
      '  `------´  ',
    ],
  ],
// 仙人掌的帧间差别是两侧小臂的高低，眼睛嵌在主干里
  [cactus]: [
    [
      '            ',
      ' n  ____  n ',
      ' | |{E}  {E}| | ',
      ' |_|    |_| ',
      '   |    |   ',
    ],
    [
      '            ',
      '    ____    ',
      ' n |{E}  {E}| n ',
      ' |_|    |_| ',
      '   |    |   ',
    ],
    [
      ' n        n ',
      ' |  ____  | ',
      ' | |{E}  {E}| | ',
      ' |_|    |_| ',
      '   |    |   ',
    ],
  ],
// 机器人第三帧在头顶加星号当指示灯，第二帧把胸口的方括号改成横线
  [robot]: [
    [
      '            ',
      '   .[||].   ',
      '  [ {E}  {E} ]  ',
      '  [ ==== ]  ',
      '  `------´  ',
    ],
    [
      '            ',
      '   .[||].   ',
      '  [ {E}  {E} ]  ',
      '  [ -==- ]  ',
      '  `------´  ',
    ],
    [
      '     *      ',
      '   .[||].   ',
      '  [ {E}  {E} ]  ',
      '  [ ==== ]  ',
      '  `------´  ',
    ],
  ],
// 兔子第二帧把耳朵里的斜杠换成竖线，第三帧眼睛换成点
  [rabbit]: [
    [
      '            ',
      '   (\\__/)   ',
      '  ( {E}  {E} )  ',
      ' =(  ..  )= ',
      '  (")__(")  ',
    ],
    [
      '            ',
      '   (|__/)   ',
      '  ( {E}  {E} )  ',
      ' =(  ..  )= ',
      '  (")__(")  ',
    ],
    [
      '            ',
      '   (\\__/)   ',
      '  ( {E}  {E} )  ',
      ' =( .  . )= ',
      '  (")__(")  ',
    ],
  ],
// 蘑菇第三帧的孢子点上移两格，伞面本身不变
  [mushroom]: [
    [
      '            ',
      ' .-o-OO-o-. ',
      '(__________)',
      '   |{E}  {E}|   ',
      '   |____|   ',
    ],
    [
      '            ',
      ' .-O-oo-O-. ',
      '(__________)',
      '   |{E}  {E}|   ',
      '   |____|   ',
    ],
    [
      '   . o  .   ',
      ' .-o-OO-o-. ',
      '(__________)',
      '   |{E}  {E}|   ',
      '   |____|   ',
    ],
  ],
// 胖猫第三帧把尾巴的斜杠换成波浪号
  [chonk]: [
    [
      '            ',
      '  /\\    /\\  ',
      ' ( {E}    {E} ) ',
      ' (   ..   ) ',
      '  `------´  ',
    ],
    [
      '            ',
      '  /\\    /|  ',
      ' ( {E}    {E} ) ',
      ' (   ..   ) ',
      '  `------´  ',
    ],
    [
      '            ',
      '  /\\    /\\  ',
      ' ( {E}    {E} ) ',
      ' (   ..   ) ',
      '  `------´~ ',
    ],
  ],
}

// 帽子表与主体表分开：帽子只有一行，直接贴在帽子槽上
const HAT_LINES: Record<Hat, string> = {
// 无帽子是空串而不是空格串，渲染时用去空白判断是否为空
  none: '',
// 每顶帽子都是一行十二列，靠位置对齐而不是靠计算偏移
  crown: '   \\^^^/    ',
  tophat: '   [___]    ',
  propeller: '    -+-     ',
  halo: '   (   )    ',
  wizard: '    /^\\     ',
  beanie: '   (___)    ',
  tinyduck: '    ,>      ',
}

// 渲染入口：取帧、替换眼睛、贴帽子、必要时去掉空帽子槽
export function renderSprite(bones: CompanionBones, frame = 0): string[] {
  const frames = BODIES[bones.species]
// 帧号取模，调用方不必关心有几帧
  const body = frames[frame % frames.length]!.map(line =>
// 占位符替换成用户选的眼睛字符：这样同一套线稿能长出不同表情
    line.replaceAll('{E}', bones.eye),
  )
  const lines = [...body]
  // Only replace with hat if line 0 is empty (some fidget frames use it for smoke etc)
// 帽子只在第零行为空时贴：有些物种的抖动帧要用这一行放烟雾，不能被盖掉
  if (bones.hat !== 'none' && !lines[0]!.trim()) {
    lines[0] = HAT_LINES[bones.hat]
  }
// 没有帽子且整族第零行都空时把这一行删掉：卡片与浮空精灵里空一行很浪费
  // Drop blank hat slot — wastes a row in the Card and ambient sprite when
  // there's no hat and the frame isn't using it for smoke/antenna/etc.
  // Only safe when ALL frames have blank line 0; otherwise heights oscillate.
// 条件里那句整族都要检查是关键：只看当前帧会让不同帧的高度不一致，界面上会跳
  if (!lines[0]!.trim() && frames.every(f => !f[0]!.trim())) lines.shift()
  return lines
}

// 帧数查询单独导出，界面用它驱动待机动画
export function spriteFrameCount(species: Species): number {
  return BODIES[species].length
}

// 表情行是另一套更紧凑的画法：用于列表项等只有一行的位置
export function renderFace(bones: CompanionBones): string {
  const eye: Eye = bones.eye
// 按物种分支，每个分支把眼睛字符嵌进各自的括号结构里
  switch (bones.species) {
// 鸭子与鹅共用一个表情：它们的脸本来就一样，区别在身体
    case duck:
    case goose:
      return `(${eye}>`
    case blob:
      return `(${eye}${eye})`
    case cat:
      return `=${eye}ω${eye}=`
    case dragon:
      return `<${eye}~${eye}>`
    case octopus:
      return `~(${eye}${eye})~`
    case owl:
      return `(${eye})(${eye})`
    case penguin:
      return `(${eye}>)`
    case turtle:
      return `[${eye}_${eye}]`
    case snail:
      return `${eye}(@)`
    case ghost:
      return `/${eye}${eye}\\`
    case axolotl:
      return `}${eye}.${eye}{`
    case capybara:
      return `(${eye}oo${eye})`
    case cactus:
      return `|${eye}  ${eye}|`
    case robot:
      return `[${eye}${eye}]`
    case rabbit:
      return `(${eye}..${eye})`
    case mushroom:
      return `|${eye}  ${eye}|`
    case chonk:
      return `(${eye}.${eye})`
  }
}
