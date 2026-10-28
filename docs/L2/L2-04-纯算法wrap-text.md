# L2-04 · 一个纯算法：`wrap-text`

> **课时号**：L2-04　**标题**：一个纯算法 `wrap-text`　**⏱ 时长**：35 分钟（读 22 + 动手 13）
> **前置课时**：[L0-06 联合类型与三值状态机](../L0/L0-06-联合类型三值状态机.md)、[L0-07 函数也是值](../L0/L0-07-函数也是值.md)、[L1-03 一个 9 行的校验函数与早返回](../L1/L1-03-九行校验函数与早返回.md)（`truncate` 开头那三行提前返回，就是 L1-03 的手艺）
> **本课目标**：拿到纯函数，先说清「收什么、还什么」，再动眼睛看实现——顺序不能反
> **教材清单**：
> - A：批注版 [`annotated/src/ink/wrap-text.ts`](../../annotated/src/ink/wrap-text.ts)（142 行，主教材）
> - B：原文 [`source/src/ink/wrap-text.ts`](../../source/src/ink/wrap-text.ts)（74 行，逻辑相同、无讲解）
> - C：[`source/src/utils/sliceAnsi.ts`](../../source/src/utils/sliceAnsi.ts)（第 26–30 行是签名，被 `sliceFit` 调用）
> - D：[`annotated/src/ink/dom.ts`](../../annotated/src/ink/dom.ts#L519-L520)（第 519–520 行，谁在调它）
>
> 行号说明：路线图的「74 行」指**原文**；批注版插了中文讲解，膨胀到 142 行。下文行号一律用批注版。

## 1. 先看签名：它收什么、还什么

```ts
// annotated/src/ink/wrap-text.ts:102-106
export default function wrapText(
  text: string,
  maxWidth: number,
  wrapType: Styles['textWrap'],
): string {
```

| 位置 | 名字 | 类型 | 一句话 |
| --- | --- | --- | --- |
| 参数 1 | `text` | `string` | 要排版的文字（可能已含 `\n`） |
| 参数 2 | `maxWidth` | `number` | 一行的**列数**（终端格子），不是字符个数 |
| 参数 3 | `wrapType` | `Styles['textWrap']` | 折行还是截断、按哪个位置 |
| 返回值 | —— | `string` | **还是字符串**，只是中间多了 `\n` |

第一个会猜错的地方：**返回的不是 `string[]`，是 `string`**。折行不是「给你行数组」，而是「把 `\n` 插进原串再还你」——下游 `output.write` 本来就按换行切段，返回数组反而要多一次 join。第三个参数展开在 [`annotated/src/ink/styles.ts`](../../annotated/src/ink/styles.ts#L113-L121)：

```ts
// annotated/src/ink/styles.ts:113-121
  readonly textWrap?:
    | 'wrap'
    | 'wrap-trim'
    | 'end'
    | 'middle'
    | 'truncate-end'
    | 'truncate'
    | 'truncate-middle'
    | 'truncate-start'
```

八个字面量，且属性**可选**（`textWrap?`），所以真实类型是「八个值 + `undefined`」——记住这点，第 124 行的 `wrapType!` 才有解释。它还是个标准**纯函数**：没有 `this`、没有 `await`、没有 `Date.now()`、没有 IO，同样三参数跑一万次都是同一结果，所以不需要任何上下文就能读透。

## 2. 三个输入输出例子（先自己推，再看答案）

拿纸写出你预期的输出，再看结果。差在哪，就是你还没读懂的地方。

- **例 1**：`"the quick brown fox jumps"`，宽 10，`wrap` → `"the quick \nbrown fox \njumps"`
- **例 2**：`"supercalifragilisticexpialidocious"`，宽 10，`wrap` → `"supercalif\nragilistic\nexpialidoc\nious"`
- **例 3**：`"abcdefghij"`，宽 5，`truncate-middle` → `"ab…ij"`

例 1 的第一行是 `"the quick "`——**行尾那个空格被保留了**，10 格算满，因为 `wrap` 传的是 `trim: false`（第 109 行）。例 2 从**单词中间**断开，是后面第 4 节的主角。例 3 是 2 + 1 + 2 = 5 格，一格不多。

> 出处：例 1、2 是我在本机用仓库 `source/node_modules` 里的 `wrap-ansi` 实跑的结果（命令见第 7 节）；例 3 是按第 79–84 行下标算术代入的**教学示例**——纯 ASCII 下 `sliceAnsi` 等价于 `String.slice`，可以手算验证。

## 3. 精读正文

### 3.1 第 23 行：省略号只用一个字符

```ts
// annotated/src/ink/wrap-text.ts:23
const ELLIPSIS = '…'
```

第 19–22 行的理由：`...` 占 3 格，而 `columns === 1` 时连一个字都放不下。单字符省略号宽度正好 1，「只留一格」这个极端值才有意义——这是**为一个边界值改常量**的典型。

### 3.2 第 39–42 行：宽字符的一格溢出

```ts
// annotated/src/ink/wrap-text.ts:39-42
function sliceFit(text: string, start: number, end: number): string {
  const s = sliceAnsi(text, start, end)
  return stringWidth(s) > end - start ? sliceAnsi(text, start, end - 1) : s
}
```

四行做一件事：切完量一下，超了就少切一格。因为 `sliceAnsi` 按**显示宽度**切，不是按字符个数；一个汉字占 2 格，切点落在汉字中间时它没法把字劈开，只能把整个字给你——于是多出 1 格，整行超宽、后面所有列错位。第 37–38 行注释解释了「只重试一次就够」：宽字符最宽 2，一次切分最多溢出 1。代价可以推演：`"中文中文"`（宽 8）用 `truncate-end`、`columns = 6`，`sliceFit(0, 5)` 拿到 `"中文中"` 宽 6 > 5，退回 `end = 4`，最终 `"中文…"` 只有 5 格——**宁可少一格，也不许溢出一格**。

### 3.3 第 53–57 行：三个提前返回

```ts
// annotated/src/ink/wrap-text.ts:53-57
  if (columns < 1) return ''
  if (columns === 1) return ELLIPSIS

  const length = stringWidth(text)
  if (length <= columns) return text
```

- `columns < 1`：一格放不下，空串（省略号也要 1 格，给不了）。
- `columns === 1`：1 格全给省略号，**原文一个字不给**。
- `length <= columns`：本来就不用截，原样返回，**不加**省略号。

放在 `truncate()` 开头而不是每个分支里重复，是为了三种位置共享同一套边界。顺带注意第 56 行量的是 `stringWidth(text)` 而不是 `text.length`——`"中文中文"` 长度 4、宽度 8。

### 3.4 第 64–90 行：三种位置的下标算术

`text = "abcdefghij"`（`length = 10`），`columns = 5`：

| 分支 | 公式（逐字来自代码） | 代入 | 结果 |
| --- | --- | --- | --- |
| `start` | `ELLIPSIS + sliceFit(text, length - columns + 1, length)` | 起点 `10-5+1=6` | `…ghij` |
| `middle` | `half = floor(columns/2)`；左 `0..half`；右 `length-(columns-half)+1..length` | `half=2`，右起点 `8` | `ab…ij` |
| `end` | `sliceFit(text, 0, columns - 1) + ELLIPSIS` | `0..4` | `abcd…` |

那个 `+1` 是**给省略号留位**：占满 `columns` 格，其中 1 格是省略号，正文只能取 `columns-1` 格。`middle` 的注释（第 67–77 行）还算了偶数宽度：宽 4 时 `half=2`，右边只取 1 格，成「左 2 + 省略号 + 右 1」——左多一格是故意的，开头辨识度更高。三个分支都用 `sliceFit` 而非裸 `sliceAnsi`，因为切点都可能撞上宽字符（第 88–89 行）。

### 3.5 第 107–119 行：两个 wrap 分支只差一个布尔

```ts
// annotated/src/ink/wrap-text.ts:107-112
  if (wrapType === 'wrap') {
    return wrapAnsi(text, maxWidth, {
      trim: false,
      hard: true,
    })
  }
```

第 114–119 行的 `wrap-trim` 分支逐字相同，只把 `trim` 换成 `true`。真正要紧的是**两个分支都有**的 `hard: true`，下一节专讲。

### 3.6 第 124–138 行：截断分派与兜底

```ts
// annotated/src/ink/wrap-text.ts:124-138
  if (wrapType!.startsWith('truncate')) {
    let position: 'end' | 'middle' | 'start' = 'end'

    if (wrapType === 'truncate-middle') {
      position = 'middle'
    }

    if (wrapType === 'truncate-start') {
      position = 'start'
    }

    return truncate(text, maxWidth, position)
  }

  return text
```

三个读点：`wrapType!` 是非空断言（类型里带 `undefined`，此处已排除前两个字符串，作者选择断言而不是给默认值）；用 `startsWith('truncate')` 而不是列三个 `===`，于是 `'truncate'` 和 `'truncate-end'` 都落进来、默认 `position = 'end'`；最后的 `return text` 是兜底（第 139–141 行注释：类型上不该到这里，运行时可能绕过类型）。

**这里有个真缺口**：类型里的 `'end'` 和 `'middle'` 既不是 `wrap`，也不以 `truncate` 开头，会直接掉进兜底——**不折也不截**。全仓 grep 的结果是这两个值只出现在 `Text.tsx` 的样式表里、没有调用方传它们（见第 7 节），所以现在是死值，不是线上 bug；但读代码要能看出这个缺口，而不是假设「类型里有就一定实现了」。

## 4. 一个单词比整行还宽，它怎么办

答案就是第 110、117 行的 `hard: true`。`wrap-ansi` 默认是**软折**：只在空格处断行，遇到没有空格的一整串，宁可让这行超宽，也不从词中间劈开。实跑对比：

```
hard: true  → ["supercalif","ragilistic","expialidoc","ious"]   每行 10 格
hard: false → ["supercalifragilisticexpialidocious"]             一行 34 格
```

所以第 93–97 行注释说 `hard: true` 不能省。后果有两层：渲染阶段 `setCellAt` 有越界检查，超出的字符被**静默丢掉**（第 881 行的 `maxWidth` 用 `Math.min` 夹过一次，但测量阶段没有这个夹子）；更麻烦的是**行数算错**——yoga 拿到的宽度是「最长行宽度」，一旦超过容器，父容器溢出，后面所有节点坐标跟着偏。

一句话：**软折是审美（尽量在词边界断），硬折是正确性（不许超过给定宽度）**，终端里正确性优先。顺带记一个跨文件矛盾：[`annotated/src/ink/measure-text.ts`](../../annotated/src/ink/measure-text.ts#L114) 的注释说「文本没有空格、无法折行时 wrap-ansi 也无能为力」——那是按 `hard: false` 写的旧假设，而 `wrap-text.ts` 已经传了 `hard: true`。读到这种不一致，正确态度是**信代码、记注释**，并顺手确认调用链上到底传了哪个值。

## 5. 核心问题（路线图原卡片）

**卡片原文**：「读法：先看它的输入（一段文字 + 宽度）和输出（多行），再想『如果我自己写会怎么写』，最后对比它的写法。自测：说出它怎么处理『一个单词比整行还宽』的情况。」

**完整解答**：

1. **输入**：`text: string`、`maxWidth: number`（列数，不是字符数）、`wrapType`（八个字面量之一，可空）。
2. **输出**：`string`——不是数组，折行靠插入 `\n` 完成。
3. **「我自己会怎么写」**：多半会 `split(' ')` 再累加长度、超长就 `slice`。这个思路会漏三件事：ANSI 转义序列不占宽度、CJK 字符占 2 格、样式要在每行重新开合。作者的取舍是**折行交给 `wrap-ansi`（它管 SGR），截断自己做（要管宽字符边界和省略号占位）**。
4. **超宽单词**：`hard: true`（第 110、117 行），从词中间硬切，保证每行不超 `maxWidth`。
5. **截断路径不折行**：`truncate-*` 永远返回**一行**，因为截断的语义就是「只留一行」。这也是 [`annotated/src/ink/render-node-to-output.ts`](../../annotated/src/ink/render-node-to-output.ts#L509) 只用 `textWrap !== 'wrap' && textWrap !== 'wrap-trim'` 就把截断模式排除在「软换行标记」之外的原因。

## 6. 常见误读

**一、以为返回 `string[]`。** 第 106 行明写 `string`。所有「行」都是 `\n` 分隔出来的，所以调用方总要 `.split('\n')`（`render-node-to-output.ts` 第 519 行正是这么写的）。

**二、以为 `hard: true` 是「硬折行／不折行」。** 它说的是「**允许从单词中间断开**」；取 `false` 不是「不折」，而是「只在空格处折」，超长单词整行超宽。hard 修饰的是断词方式，不是换行开关。

**三、以为八个类型值都有分支。** `'end'`、`'middle'` 掉进 `return text`——那不是「默认截断」，是「什么都不做」。把「类型允许」当成「实现覆盖」，是读函数时的高频错误。

## 7. 动手验证

**7.1 `hard: true` 出现在哪几行**

```bash
grep -n "hard: true" annotated/src/ink/wrap-text.ts
```

```
110:      hard: true,
117:      hard: true,
```

两处，正好对应 `wrap` 与 `wrap-trim`——**没有第三处**，说明截断路径完全不经过 `wrap-ansi`。

**7.2 亲手跑一次，看硬折与软折的差别**

```bash
cd source && node --input-type=module -e "import w from 'wrap-ansi'; console.log(JSON.stringify(w('supercalifragilisticexpialidocious',10,{hard:true,trim:false}).split('\n'))); console.log(JSON.stringify(w('supercalifragilisticexpialidocious',10,{hard:false,trim:false}).split('\n')))"
```

```
["supercalif","ragilistic","expialidoc","ious"]
["supercalifragilisticexpialidocious"]
```

第一行 4 段、每段 10 格；第二行一整段 34 格。这就是 `hard` 的全部含义。

**7.3 谁在调它**

```bash
grep -n "import wrapText\|const wrappedText\|wrapped: wrapText\|wrapText(orig" annotated/src/ink/dom.ts annotated/src/ink/render-node-to-output.ts
```

```
annotated/src/ink/dom.ts:29:import wrapText from './wrap-text.js'
annotated/src/ink/dom.ts:520:  const wrappedText = wrapText(text, width, textWrap)
annotated/src/ink/render-node-to-output.ts:18:import wrapText from './wrap-text.js'
annotated/src/ink/render-node-to-output.ts:511:      wrapped: wrapText(plainText, maxWidth, textWrap),
annotated/src/ink/render-node-to-output.ts:519:    const pieces = wrapText(orig, maxWidth, textWrap).split('\n')
```

三个调用点：`dom.ts` 第 520 行（测量高度）、`render-node-to-output.ts` 第 511 行与第 519 行（真正绘制）。**同一段文字会被折两次**，参数必须一致，否则「算出来的高度」和「画出来的内容」对不上。

**7.4 类型里有几个值、实现里有几个分支**

```bash
grep -rn "textWrap: '" annotated/src/ink/components/Text.tsx
```

```
annotated/src/ink/components/Text.tsx:92:    textWrap: 'end'
annotated/src/ink/components/Text.tsx:98:    textWrap: 'middle'
annotated/src/ink/components/Text.tsx:104:    textWrap: 'truncate-end'
annotated/src/ink/components/Text.tsx:122:    textWrap: 'truncate-start'
```

（八条输出我只摘了四条。）八个值齐全，但 `'end'`／`'middle'` 在 `wrap-text.ts` 里没有分支。再往前查一层：`grep -rn "wrap=\"end\"" annotated/src` 无输出（本机跑过），说明确实没人传。

## 8. 合书自测

**1.** `wrapText` 返回什么类型？为什么不是 `string[]`？

<details><summary>参考答案</summary>
`string`。折行只是在原串里插 `\n`，下游 `output.write` 本来就按换行切段，返回数组反而多一次 join。所以调用方总要先 `.split('\n')`。
</details>

**2.** `columns === 1` 时，三种位置分别返回什么？为什么？

<details><summary>参考答案</summary>
都返回 `'…'`。第 54 行在进入任何位置分支之前就返回了：1 格全给省略号，不给原文——因为根本放不下「原文 + 省略号」。
</details>

**3.** `"abcdefghij"` 用 `truncate-start`、宽 5，结果是什么？下标怎么算？

<details><summary>参考答案</summary>
`'…ghij'`。起点 `length - columns + 1 = 10 - 5 + 1 = 6`，取 `[6, 10)` 得 `"ghij"`，前面拼省略号。`+1` 是给省略号留的一格。
</details>

**4.** 34 字符无空格长串、宽 10，`wrap` 输出几行？去掉 `hard: true` 呢？

<details><summary>参考答案</summary>
保留 `hard: true` 是 4 行（10+10+10+4）；去掉后只有 1 行、34 格宽，后果是溢出视口、行数算错、后续节点坐标全偏。所以它是正确性要求，不是风格选项。
</details>

**5.** 类型里的 `'end'` 传进来会发生什么？

<details><summary>参考答案</summary>
落到最后一行 `return text`：不折也不截。因为它不等于 `'wrap'`／`'wrap-trim'`，也不以 `'truncate'` 开头。目前仓库里没有调用方传它。
</details>

## 9. 下一步

- **下一课时**：[L2-05 · 一个交互原语：`useDoublePress`](./L2-05-交互原语useDoublePress.md)——从纯函数换到有状态的 hook，看它怎么用两个 `ref` 记住按键时间。
- **回看地基**：联合类型与字面量 → [`L0-06`](../L0/L0-06-联合类型三值状态机.md)；`default export` → [`L0-03`](../L0/L0-03-export的两种面孔.md)。
- **想追它的调用方**：[`docs/12-UI与多智能体.md`](../12-UI与多智能体.md)。
