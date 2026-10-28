# L0-10 · `class` 与 `private`：全仓唯一必须懂的一处

> **课时号**：L0-10　**标题**：`class` 与 `private`——只有这一处要用　**⏱ 时长**：20 分钟（精读 14 + 动手 6）
> **前置课时**：[L0-07 函数也是值](./L0-07-函数也是值.md)
> **本课目标**：能读懂一个最小 `class`；知道 `private` 拦住的是谁、拦不住谁
> **教材清单**：
> - A：批注版 [`annotated/src/ink/events/event.ts`](../../annotated/src/ink/events/event.ts)（全 39 行，对应原文 11 行）
> - B：原文 [`source/src/ink/events/event.ts`](../../source/src/ink/events/event.ts#L1-L11)（第 1–11 行）
> - C：子类 [`source/src/ink/events/terminal-event.ts`](../../source/src/ink/events/terminal-event.ts#L19-L62)（第 19、28、55–62 行，看 `extends` / `override`）
> - D：导出点 [`source/src/ink.ts`](../../source/src/ink.ts#L66)（第 66 行）
>
> 行号说明：批注版在原文中间插了中文注释，所以同一句代码在两份文件里的行号不同。下文标「批注版 Lxx」指文件 A，标「原文 Lxx」指文件 B。

---

## 1. 先回答：为什么全仓几乎不用 `class`

51 万行源码绝大多数是「一堆导出函数」，`class` 屈指可数，本课时这 11 行是全仓最值得读的一处。用 `class` 而不是函数的理由，批注版第 19–22 行写得很直白：

> 因为 `EventEmitter` 只需要知道一件事：还要不要继续叫下一个监听者。

换句话说：**这里需要一个「对象」，它自带一小块状态（停没停），这块状态只能通过两个方法进出。** 「一堆函数 + 一个对象」也能做，但状态散在外面，谁都能改。

---

## 2. 精读正文

### 2.1 文件头：先看家族树

批注版第 5–14 行是一张**图**（每行都以 `//` 开头，不是会执行的代码）：

```ts
// 批注版 L5-L14
//       Event（本文件，11 行）
//         ├─ InputEvent           按键（旧的 useInput 路径）
//         ├─ ClickEvent           点击（hit-test.ts 里手写冒泡）
//         └─ TerminalFocusEvent   终端窗口失焦/获焦（DECSET 1004）
//
//       TerminalEvent（新的，DOM 风格）
//         ├─ KeyboardEvent        onKeyDown
//         └─ FocusEvent           onFocus / onBlur
```

读法：`Event` 是旧那套的根，三个类从它派生；`TerminalEvent` 是新那套的根。**两套并存**，不是一套。

子类都能在源码里核实（`grep "extends Event"` 的实际结果）：

| 文件 | 行 | 类 |
| --- | --- | --- |
| `click-event.ts` | 10 | `class ClickEvent extends Event` |
| `input-event.ts` | 192 | `class InputEvent extends Event` |
| `terminal-event.ts` | 19 | `class TerminalEvent extends Event` |
| `terminal-focus-event.ts` | 12 | `class TerminalFocusEvent extends Event` |

批注版第 16–17 行补了一句判断：terminal-event.ts 的类注释写着它 `extends Event`「so existing event types ... can migrate later」——**也就是迁移做了一半**。

念法：「新的类也继承了旧基类，理由是『以后老的事件类型能迁过来』——说明作者打算统一，但没做完。」**这解释了基类为什么这么薄**：它要同时服务两套设计，只能保留两者都同意的最小契约。

### 2.2 批注版 19–22 行：为什么只有一个方法

批注版 19–22 行的原话是：

> 为什么基类只有这一个方法？因为 `EventEmitter`（`emitter.ts`）只需要知道一件事：还要不要继续叫下一个监听者。它不需要 bubbles、不需要 preventDefault、不需要 target。把契约压到最小，两套继承线才能共用同一个 emitter。

`EventEmitter` 派发时大概是「循环叫监听者，谁喊停就 break」（示意）。所以它只需要问一句「停了吗」。`bubbles`、`preventDefault`、`target` 属于冒泡和默认行为，是新那套才需要的，不该塞进旧基类。

### 2.3 第 23 行：`export class Event {`

```ts
// 原文 L1／批注版 L23
export class Event {
```

- `export` —— 别的文件可以 import 它。
- `class` —— 声明一张**造对象的模板**。
- `Event` —— 类名，习惯大驼峰。
- `{` —— 类体开始。

念法：「导出一个叫 `Event` 的类。」**`class` 和函数的差别**：函数是「给参数、出结果」；类是「先造对象，对象自带数据和方法」，用的时候要 `new Event()`。

### 2.4 第 24 行：`private _didStopImmediatePropagation = false`

```ts
// 原文 L2／批注版 L24
  private _didStopImmediatePropagation = false
```

| 片段 | 名字 | 作用 |
| --- | --- | --- |
| `private` | 访问修饰符 | 只允许类内部访问，外部访问编译报错 |
| `_didStopImmediatePropagation` | 字段名 | 存「有没有喊过立即停」 |
| `= false` | 初值 | 一开始当然没停 |

**`private` 拦住的是编译器，不是运行时。** 它只在你写代码时把关：`event._didStopImmediatePropagation` 会标红。但编译成 JS 后，它就是对象上一个普通属性。

这不是猜测。仓库带着打包产物 `source/cli.js`，`grep -o "_didStopImmediatePropagation" source/cli.js | wc -l` 的实际输出是 `3`，产物里它是这样（节选）：

```js
class AL{_didStopImmediatePropagation=!1;didStopImmediatePropagation(){return this._didStopImmediatePropagation}...
```

类名被压缩成 `AL`，`private` 字样消失，字段名原样保留。**结论：`private` 是写代码时的约定，不是运行时的锁。**

**`_` 前缀干什么？** 它和 `private` 是两套习惯叠在一起：`private` 是 TypeScript 语法（编译器检查），`_` 是 JS 世界的老约定（「这是内部字段，别碰」）。为什么要叠？因为产物里 `private` 会消失而 `_` 还在，正好补上那一层。整个 `source/src/ink/events/` 目录里 `private _` 出现 **6 次**，是这个目录的固定写法。

**对照组**：仓库里还有另一种写法。`source/src/hooks/useTasksV2.ts` 第 31 行起用的是 `#tasks`、`#hidden`、`#watcher` 这样的 `#` 前缀，那是 JavaScript 语言本身的**真私有字段**——运行时外部访问会直接抛错，不像 `private` 只是编译期检查。`events/event.ts` 没用它，沿用的是 `private` + `_` 的老写法。两种都达到「别让人碰」的目的，只是年代不同；看到 `#` 不用慌，把它当「更硬的 private」即可。

### 2.5 批注版 25–28 行：为什么不直接公开字段

批注版 25–28 行解释了这个设计：布尔标志加 getter 而不是 public 字段——外部只能问「停没停」，不能直接改；而且 `TerminalEvent` 里还有第二个标志 `_propagationStopped`，那个才是「别往祖先走」，两个概念必须分开记（见 terminal-event.ts:59）。

两件事：**① 外部能问不能改**，想改必须走方法，方法里可以顺手做别的事；**② 两个标志不能混**——「立即停」和「别往上冒泡」是两个概念。第二点可在源码核实：`terminal-event.ts` 第 28 行是第二个标志，第 55–62 行写清了两者关系：

```ts
// source/src/ink/events/terminal-event.ts:55-62
  stopPropagation(): void {
    this._propagationStopped = true
  }

  override stopImmediatePropagation(): void {
    super.stopImmediatePropagation()
    this._propagationStopped = true
  }
```

`stopPropagation()` 只置自己的标志（「别再往祖先走」）；`stopImmediatePropagation()` 先 `super.` 调父类、再置自己（「立即停」**蕴含**「不往上走」）。**如果父类字段是 public，子类就可能只置一个、忘了另一个。** 这就是封装的实际价值：不是洁癖，是**把必须成对发生的两件事锁在一起**。

### 2.6 第 30–32 行：读方法

```ts
// 原文 L4-L6／批注版 L30-L32
  didStopImmediatePropagation(): boolean {
    return this._didStopImmediatePropagation
  }
```

`didStopImmediatePropagation()` 方法名就是一句问句；`(): boolean` 是「收 0 个参数、返回布尔值」；`this` 指「当前这个对象自己」，类里碰自己的字段必须带 `this.`；`return` 把私有字段的值交出去。念法：「返回『有没有喊过立即停』，**只读不改**。」

### 2.7 第 34–38 行：写方法

```ts
// 原文 L8-L11／批注版 L34-L38
  stopImmediatePropagation(): void {
    this._didStopImmediatePropagation = true
  }
}
```

`: void` 表示「不返回东西」；`this._... = true` 是唯一合法的修改点（在类内部）；最后的 `}` 结束类。批注版 35–36 行补充：`TerminalEvent` 覆写它时会**两个都置**，因为对它来说「立即停」必然蕴含「不往上走」。

11 行读完，压成一句：**一个只记一件事的对象——`stopImmediatePropagation()` 把它标成「停」，别人只能通过 `didStopImmediatePropagation()` 来问。**

### 2.8 class 语法最小地图

| 语法 | 出现位置 | 中文念法 |
| --- | --- | --- |
| `class X { }` | 第 23 行 | 声明一个叫 X 的类 |
| 字段 `name = 值` | 第 24 行 | 每个对象自带 name，初值是… |
| 方法 `m() { }` | 第 30、34 行 | X 对象会做 m 这件事 |
| `this` | 第 31、37 行 | 当前这个对象自己 |
| `extends X` | 四个子类 | 继承 X，白拿它的字段和方法 |
| `override` | `terminal-event.ts:59` | 我在故意覆写父类方法 |
| `private` | 第 24 行 | 只准类内部用（编译期） |

---

## 3. 三个问题

### 问题 1：`private` 拦住了谁？

拦住的是**编译器的类型检查**，不是运行时。

- 外部写 `event._didStopImmediatePropagation`，TypeScript 报错「属性是私有的」。
- 编译后没有任何运行时检查，字段照样在对象上（打包产物里 `grep` 到 3 处就是证据）。
- 它也不是加密、不是安全边界，`as any` 或纯 JS 一样能改。

一句话：`private` 是「团队约定 + 编辑器把关」，不是「锁」。

### 问题 2：为什么字段名前面加 `_`？

三个原因：**历史约定**（TypeScript 的 `private` 普及前，JS 社区用 `_` 表示「内部字段」）；**双保险**（`private` 只在编译期生效，`_` 在读代码时就提醒你，压缩后 `private` 消失而 `_` 还在）；**区分同名概念**（`_didStopImmediatePropagation` 是字段，`didStopImmediatePropagation` 是方法，多了下划线不会撞名）。

注意：`_` 本身没有语法作用，写 `_x` 和 `x` 对编译器一样，它只给人看。

### 问题 3：既然一个读一个写，为什么不直接暴露字段？

因为读和写的权限不一样，写的时候还可能要顺手做别的事。

- **读要开放**：`EventEmitter` 每叫一个监听者都要问一次，高频且无害。
- **写要收敛**：只有真的调了 `stopImmediatePropagation()` 才该置位；字段公开的话，任何一行都能偷偷置 `true`，事件系统就乱了。而且 `TerminalEvent` 覆写后要同时置两个标志（第 59–62 行），外部直接改字段就绕过了「两个一起置」的逻辑。

这就是封装的收益：**把必须一起发生的动作关在方法里**，外部只能表达意图，不能直接改状态。

---

## 4. 常见误读

**误读 1：以为 `private` 是真私有，运行时访问不到。** 编译后它消失，字段是普通属性。它是「编译期检查 + 团队约定」。

**误读 2：以为 `_` 是语法。** `_x` 和 `x` 对编译器完全一样，作用只是「让人看见就知道是内部字段」。

**误读 3：以为读这个类要先学完面向对象。** 这里只有「一个字段 + 两个方法」，没有构造函数、没有抽象类。前置知识只有 `this` 和「对象自带数据」。

---

## 5. 动手验证

下面是**实际跑出来的输出**。

```bash
grep -c "class " source/src/ink/events/event.ts
grep -rn "extends Event" source/src/ink/events
grep -n "private _" source/src/ink/events/terminal-event.ts
grep -o "_didStopImmediatePropagation" source/cli.js | wc -l
```

```
1
source/src/ink/events/click-event.ts:10:export class ClickEvent extends Event {
source/src/ink/events/input-event.ts:192:export class InputEvent extends Event {
source/src/ink/events/terminal-event.ts:19:export class TerminalEvent extends Event {
source/src/ink/events/terminal-focus-event.ts:12:export class TerminalFocusEvent extends Event {
25:  private _target: EventTarget | null = null
26:  private _currentTarget: EventTarget | null = null
27:  private _eventPhase: EventPhase = 'none'
28:  private _propagationStopped = false
29:  private _defaultPrevented = false
3
```

第一条：这个文件里只有 1 个 `class`，它有 4 个子类。中间五行是「私有字段 + `_` 前缀」的密集写法。最后那个 `3` 是打包产物里的出现次数——**`private` 字段名在压缩后依然存在**，这是「编译期限定」最硬的证据。

---

## 6. 合书自测

**1.** `class` 和「一堆函数 + 一个对象」的区别是什么？

<details><summary>参考答案</summary>
类是造对象的模板，把**数据**和**操作数据的方法**绑在一起。一堆函数加一个对象也能做到同样的事，但状态是裸露的，谁都能改。这里用 `class` 的唯一理由是「对象要自带一小块只能通过方法进出的状态」。
</details>

**2.** `private` 在编译后会变成什么？

<details><summary>参考答案</summary>
什么都不变——关键字消失，字段变成普通属性，运行时没有检查。`source/cli.js` 里还能 `grep` 到 `_didStopImmediatePropagation`（3 处），就是证据。
</details>

**3.** 第 30 行的 `didStopImmediatePropagation()` 和第 34 行的 `stopImmediatePropagation()` 差在哪？

<details><summary>参考答案</summary>
前者是「问」，返回 `boolean`，只读字段；后者是「通知」，返回 `void`，把字段置 `true`。名字只差一个 `did`，一个是查询一个是动作。
</details>

**4.** 为什么 `TerminalEvent` 覆写 `stopImmediatePropagation()` 时要先 `super.` 再置自己的标志？

<details><summary>参考答案</summary>
因为「立即停」对它必然蕴含「不往上冒泡」。`super.` 置父类的 `_didStopImmediatePropagation`，下一行置自己的 `_propagationStopped`，两个概念各记一份、同时更新。只置一个，`EventEmitter` 和冒泡逻辑就会得到互相矛盾的答案。
</details>

**5.** 这个基类为什么只有一个方法、一个字段？

<details><summary>参考答案</summary>
因为唯一的消费者 `EventEmitter` 只需要知道「还要不要叫下一个监听者」。`bubbles`、`preventDefault`、`target` 属于新的 DOM 风格事件，放进基类会逼旧那套接受用不上的概念。
</details>

---

## 7. 下一步

- 下一课时：[L0-11 · 为什么 `import` 写 `.js` 但文件是 `.ts`](L0-11-import写js的真相.md)。
- 回到路线图：[`docs/00-零基础学习路线.md`](../00-零基础学习路线.md) 的 L0-10 卡片。
- 想接着看这套事件系统在 UI 里怎么跑：[`docs/12-UI与多智能体.md`](../12-UI与多智能体.md)。
- 语法卡住了回讲义：[`00a-TypeScript地基.md` §2 语法逐条](../00a-TypeScript地基.md)。
