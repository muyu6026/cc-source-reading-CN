// 本文件是模型选择器，也是全仓「一个下拉框要管两件事」的典型样本：它同时选模型与选推理强度（effort），而两者的取值空间又互相依赖——某个模型支持不支持强度、支持不支持最高档，都会改变界面元素。文件里三种值需要分清：界面上的哨兵值（表示不指定偏好）、用户真正选的模型串、以及从模型串解析出来的规范化模型名。三者的转换散在四个小函数里，读的时候建议先看末尾那四个纯函数，再回来看组件，会顺很多。
import { c as _c } from "react/compiler-runtime";
import capitalize from 'lodash-es/capitalize.js';
import * as React from 'react';
import { useCallback, useMemo, useState } from 'react';
import { useExitOnCtrlCDWithKeybindings } from 'src/hooks/useExitOnCtrlCDWithKeybindings.js';
import { type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS, logEvent } from 'src/services/analytics/index.js';
import { FAST_MODE_MODEL_DISPLAY, isFastModeAvailable, isFastModeCooldown, isFastModeEnabled } from 'src/utils/fastMode.js';
import { Box, Text } from '../ink.js';
import { useKeybindings } from '../keybindings/useKeybinding.js';
import { useAppState, useSetAppState } from '../state/AppState.js';
import { convertEffortValueToLevel, type EffortLevel, getDefaultEffortForModel, modelSupportsEffort, modelSupportsMaxEffort, resolvePickerEffortPersistence, toPersistableEffort } from '../utils/effort.js';
import { getDefaultMainLoopModel, type ModelSetting, modelDisplayString, parseUserSpecifiedModel } from '../utils/model/model.js';
import { getModelOptions } from '../utils/model/modelOptions.js';
import { getSettingsForSource, updateSettingsForSource } from '../utils/settings/settings.js';
import { ConfigurableShortcutHint } from './ConfigurableShortcutHint.js';
import { Select } from './CustomSelect/index.js';
import { Byline } from './design-system/Byline.js';
import { KeyboardShortcutHint } from './design-system/KeyboardShortcutHint.js';
import { Pane } from './design-system/Pane.js';
import { effortLevelToSymbol } from './EffortIndicator.js';
// 属性表：初始值、会话级模型（可能是计划模式临时设的）、选择与取消回调、是否作为独立命令全屏显示、是否显示快速模式提示、自定义表头文案、以及是否跳过设置落盘。全部可选或可空，说明这个组件被多处复用——命令面板里、安装向导里、以及计划模式的入口里。
export type Props = {
  initial: string | null;
  sessionModel?: ModelSetting;
  onSelect: (model: string | null, effort: EffortLevel | undefined) => void;
  onCancel?: () => void;
  isStandaloneCommand?: boolean;
  showFastModeNotice?: boolean;
  /** Overrides the dim header line below "Select model". */
  headerText?: string;
// 这段注释解释了跳过落盘的唯一原因：安装向导里的模型选择属于项目级（写进被安装项目的设置文件），不应该泄漏到用户的全局设置。所以「写不写全局设置」这件事必须由调用方决定，而不是组件自己判断——这也是为什么这个开关是布尔量而不是「落盘目标」枚举，后者会让组件知道太多。
  /**
   * When true, skip writing effortLevel to userSettings on selection.
   * Used by the assistant installer wizard where the model choice is
   * project-scoped (written to the assistant's .claude/settings.json via
   * install.ts) and should not leak to the user's global ~/.claude/settings.
   */
  skipSettingsWrite?: boolean;
};
// 哨兵值：界面需要表达「不指定偏好」这个第三态，但下拉框的值只能是字符串，于是用一个不可能与真实模型名冲突的字符串代替。它在本文件出现了五次以上，是全文件最需要留意的常量。
const NO_PREFERENCE = '__NO_PREFERENCE__';
export function ModelPicker(t0) {
  const $ = _c(82);
  const {
    initial,
    sessionModel,
    onSelect,
    onCancel,
    isStandaloneCommand,
    showFastModeNotice,
    headerText,
    skipSettingsWrite
  } = t0;
  const setAppState = useSetAppState();
  const exitState = useExitOnCtrlCDWithKeybindings();
// 空初始值被翻成哨兵值，之后所有比较都用哨兵值。这一步看似多余（直接判空不就行了），但下拉框的选中值是字符串，必须先把空归一成哨兵，后面才有唯一的「无偏好」表示。
  const initialValue = initial === null ? NO_PREFERENCE : initial;
  const [focusedValue, setFocusedValue] = useState(initialValue);
  const isFastMode = useAppState(_temp);
  const [hasToggledEffort, setHasToggledEffort] = useState(false);
  const effortValue = useAppState(_temp2);
  let t1;
  if ($[0] !== effortValue) {
    t1 = effortValue !== undefined ? convertEffortValueToLevel(effortValue) : undefined;
    $[0] = effortValue;
    $[1] = t1;
  } else {
    t1 = $[1];
  }
// 强度状态的初值来自全局状态：全局里存的是原始数值，这里翻成等级。之所以要有全局状态与本地状态两份，是因为用户可能在弹窗里来回拨动却最终取消——本地状态是草稿，全局只在确认时被写。
  const [effort, setEffort] = useState(t1);
  const t2 = isFastMode ?? false;
  let t3;
  if ($[2] !== t2) {
    t3 = getModelOptions(t2);
    $[2] = t2;
    $[3] = t3;
  } else {
    t3 = $[3];
  }
  const modelOptions = t3;
  let t4;
// 这一段处理「当前模型不在预设列表里」的情况：用户在别处用命令行参数指定了一个自定义模型名，选择器必须把它显示出来，否则用户会以为自己的选择丢了。做法是把当前模型追加成一个额外选项，标签用规范化显示名，描述写「当前模型」。用带标签的块而不是提前返回，是编译产物的固定写法。
  bb0: {
// 判定条件两段：初始值非空，且预设列表里没有同值项。这个条件下才追加，否则会出现两个同名项。
    if (initial !== null && !modelOptions.some(opt => opt.value === initial)) {
      let t5;
      if ($[4] !== initial) {
        t5 = modelDisplayString(initial);
        $[4] = initial;
        $[5] = t5;
      } else {
        t5 = $[5];
      }
      let t6;
      if ($[6] !== initial || $[7] !== t5) {
        t6 = {
          value: initial,
          label: t5,
          description: "Current model"
        };
        $[6] = initial;
        $[7] = t5;
        $[8] = t6;
      } else {
        t6 = $[8];
      }
      let t7;
      if ($[9] !== modelOptions || $[10] !== t6) {
        t7 = [...modelOptions, t6];
        $[9] = modelOptions;
        $[10] = t6;
        $[11] = t7;
      } else {
        t7 = $[11];
      }
      t4 = t7;
      break bb0;
    }
    t4 = modelOptions;
  }
// 到这里选项数组已经完整（预设加可能的当前模型）。注意下面还要再映射一次——那次映射的作用是把「值为空」的预设项翻成哨兵值。两次映射分开，是因为前者要保留原始值做判断，后者才需要哨兵。
  const optionsWithInitial = t4;
  let t5;
  if ($[12] !== optionsWithInitial) {
    t5 = optionsWithInitial.map(_temp3);
    $[12] = optionsWithInitial;
    $[13] = t5;
  } else {
    t5 = $[13];
  }
  const selectOptions = t5;
  let t6;
// 初始聚焦值：如果初始值在选项里就用它，否则退到第一项。这个回退很关键——用户上次选的模型可能已经被下架，此时不能让聚焦落在不存在的项上。
  if ($[14] !== initialValue || $[15] !== selectOptions) {
    t6 = selectOptions.some(_ => _.value === initialValue) ? initialValue : selectOptions[0]?.value ?? undefined;
    $[14] = initialValue;
    $[15] = selectOptions;
    $[16] = t6;
  } else {
    t6 = $[16];
  }
  const initialFocusValue = t6;
// 可见条数封顶十，多出来的部分在下面用一句「还有 N 个」提示。封顶而不是全量渲染，是为了让弹窗高度可控；提示行则是为了让用户知道列表被截断了，而不是以为只有十项。
  const visibleCount = Math.min(10, selectOptions.length);
  const hiddenCount = Math.max(0, selectOptions.length - visibleCount);
  let t7;
  if ($[17] !== focusedValue || $[18] !== selectOptions) {
    t7 = selectOptions.find(opt_1 => opt_1.value === focusedValue)?.label;
    $[17] = focusedValue;
    $[18] = selectOptions;
    $[19] = t7;
  } else {
    t7 = $[19];
  }
  const focusedModelName = t7;
  let focusedSupportsEffort;
  let t8;
// 从聚焦项反查模型名，再据此算出两个能力位：是否支持强度、是否支持最高档。这两个位决定强度行的文案与左右键是否有效。注意反查是每次聚焦变化都做，因为它依赖的是一串解析（可能是别名、可能是缩写），不能纯靠字符串相等判断。
  if ($[20] !== focusedValue) {
    const focusedModel = resolveOptionModel(focusedValue);
    focusedSupportsEffort = focusedModel ? modelSupportsEffort(focusedModel) : false;
    t8 = focusedModel ? modelSupportsMaxEffort(focusedModel) : false;
    $[20] = focusedValue;
    $[21] = focusedSupportsEffort;
    $[22] = t8;
  } else {
    focusedSupportsEffort = $[21];
    t8 = $[22];
  }
  const focusedSupportsMax = t8;
  let t9;
  if ($[23] !== focusedValue) {
    t9 = getDefaultEffortLevelForOption(focusedValue);
    $[23] = focusedValue;
    $[24] = t9;
  } else {
    t9 = $[24];
  }
  const focusedDefaultEffort = t9;
// 显示用强度：当前是最高档但聚焦的模型不支持最高档时，显示成高档。这是纯粹的表现层钳制——状态里仍然是最高档，只是不该在一个不支持它的模型旁边显示出来。等到用户切回支持的模型，显示会自己恢复。这种「状态不动、只在显示时钳制」的做法比在切换时改状态安全，后者会把用户的意图弄丢。
  const displayEffort = effort === "max" && !focusedSupportsMax ? "high" : effort;
  let t10;
// 聚焦处理带一个补默认值的副作用：如果用户从没手动调过强度，且全局本来就没设强度，那么切到新模型时把强度设成该模型的默认值。这个「没调过才补」的判断避免了覆盖用户的显式选择。
  if ($[25] !== effortValue || $[26] !== hasToggledEffort) {
    t10 = value => {
      setFocusedValue(value);
      if (!hasToggledEffort && effortValue === undefined) {
        setEffort(getDefaultEffortLevelForOption(value));
      }
    };
    $[25] = effortValue;
    $[26] = hasToggledEffort;
    $[27] = t10;
  } else {
    t10 = $[27];
  }
  const handleFocus = t10;
  let t11;
// 左右键循环强度：不支持强度的模型直接返回（连事件都不消费），其余情况在当前值上循环，并把「用户调过」标记置真。循环函数还处理了「当前值不在可选档位里」的情况——比如用户刚从支持最高档的模型切到不支持的模型，此时当前值是最高档，循环必须能落回一个合法档位。
  if ($[28] !== focusedDefaultEffort || $[29] !== focusedSupportsEffort || $[30] !== focusedSupportsMax) {
    t11 = direction => {
      if (!focusedSupportsEffort) {
        return;
      }
      setEffort(prev => cycleEffortLevel(prev ?? focusedDefaultEffort, direction, focusedSupportsMax));
      setHasToggledEffort(true);
    };
    $[28] = focusedDefaultEffort;
    $[29] = focusedSupportsEffort;
    $[30] = focusedSupportsMax;
    $[31] = t11;
  } else {
    t11 = $[31];
  }
  const handleCycleEffort = t11;
  let t12;
  if ($[32] !== handleCycleEffort) {
// 两个方向键各自映射到一个动作名，再整体挂到「模型选择器」这个键位上下文上。用动作名而不是硬编码按键，是为了让用户可以在配置文件里改键。
    t12 = {
      "modelPicker:decreaseEffort": () => handleCycleEffort("left"),
      "modelPicker:increaseEffort": () => handleCycleEffort("right")
    };
    $[32] = handleCycleEffort;
    $[33] = t12;
  } else {
    t12 = $[33];
  }
  let t13;
  if ($[34] === Symbol.for("react.memo_cache_sentinel")) {
    t13 = {
      context: "ModelPicker"
    };
    $[34] = t13;
  } else {
    t13 = $[34];
  }
  useKeybindings(t12, t13);
  let t14;
// 选中处理分三段。第一段无条件埋点，记录最终的强度。第二段处理落盘：只有在没被要求跳过时才写全局设置与全局状态，而且要先算「该持久化成什么」——这个计算考虑了三件事：当前草稿强度、该模型的默认强度、全局原有强度、以及用户是否手动调过。第三段才是真正的回调。
  if ($[35] !== effort || $[36] !== hasToggledEffort || $[37] !== onSelect || $[38] !== setAppState || $[39] !== skipSettingsWrite) {
    t14 = function handleSelect(value_0) {
      logEvent("tengu_model_command_menu_effort", {
        effort: effort as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
      });
// 落盘细节：先把强度解析成「应该持久化的值」，再翻成可持久化形态，只有结果非空才写。这一步链式转换的原因是不该把「明确的高档」与「跟随默认」混为一谈——后者不该在设置文件里留下痕迹，否则以后换模型时用户会被旧的显式值钉住。
      if (!skipSettingsWrite) {
        const effortLevel = resolvePickerEffortPersistence(effort, getDefaultEffortLevelForOption(value_0), getSettingsForSource("userSettings")?.effortLevel, hasToggledEffort);
        const persistable = toPersistableEffort(effortLevel);
        if (persistable !== undefined) {
          updateSettingsForSource("userSettings", {
            effortLevel: persistable
          });
        }
        setAppState(prev_0 => ({
          ...prev_0,
          effortValue: effortLevel
        }));
      }
// 回调时传的强度还有个条件：只有用户真的调过、且选中的模型支持强度，才把强度传出去；否则传空表示「用默认」。这个判断让下游不必区分「用户显式选了高档」与「这个模型本来就默认高档」。
      const selectedModel = resolveOptionModel(value_0);
      const selectedEffort = hasToggledEffort && selectedModel && modelSupportsEffort(selectedModel) ? effort : undefined;
      if (value_0 === NO_PREFERENCE) {
        onSelect(null, selectedEffort);
        return;
      }
      onSelect(value_0, selectedEffort);
    };
    $[35] = effort;
    $[36] = hasToggledEffort;
    $[37] = onSelect;
    $[38] = setAppState;
    $[39] = skipSettingsWrite;
    $[40] = t14;
  } else {
    t14 = $[40];
  }
  const handleSelect = t14;
  let t15;
  if ($[41] === Symbol.for("react.memo_cache_sentinel")) {
    t15 = <Text color="remember" bold={true}>Select model</Text>;
    $[41] = t15;
  } else {
    t15 = $[41];
  }
// 表头文案：调用方可覆盖，默认文案说明了三件事——切换影响本次与未来会话、以及其它模型名要走命令行参数。这类默认文案通常承担了「界面之外还有一条路」的告知职责。
  const t16 = headerText ?? "Switch between Claude models. Applies to this session and future Claude Code sessions. For other/previous model names, specify with --model.";
  let t17;
  if ($[42] !== t16) {
    t17 = <Text dimColor={true}>{t16}</Text>;
    $[42] = t16;
    $[43] = t17;
  } else {
    t17 = $[43];
  }
  let t18;
// 会话级模型提示：只在计划模式临时设过模型时出现，并且明确写了「选一个模型就会撤销它」。这是一条防误操作的说明——否则用户会困惑为什么选了之后计划模式的模型失效了。
  if ($[44] !== sessionModel) {
    t18 = sessionModel && <Text dimColor={true}>Currently using {modelDisplayString(sessionModel)} for this session (set by plan mode). Selecting a model will undo this.</Text>;
    $[44] = sessionModel;
    $[45] = t18;
  } else {
    t18 = $[45];
  }
  let t19;
  if ($[46] !== t17 || $[47] !== t18) {
    t19 = <Box marginBottom={1} flexDirection="column">{t15}{t17}{t18}</Box>;
    $[46] = t17;
    $[47] = t18;
    $[48] = t19;
  } else {
    t19 = $[48];
  }
// 取消回调可缺省，缺省时给一个空函数。这样下拉框不必处理空回调，组件本身也不要求在只读场景下必须传取消。
  const t20 = onCancel ?? _temp4;
  let t21;
// 下拉框：同时传初始值与初始聚焦值，可见条数用上面算的上限。两个值分开传的原因在注释里没有明说但可以从行为推出——初始值是「选中项」，聚焦值是「光标位置」，用户可能选中一个但把光标停在别处。
  if ($[49] !== handleFocus || $[50] !== handleSelect || $[51] !== initialFocusValue || $[52] !== initialValue || $[53] !== selectOptions || $[54] !== t20 || $[55] !== visibleCount) {
    t21 = <Box flexDirection="column"><Select defaultValue={initialValue} defaultFocusValue={initialFocusValue} options={selectOptions} onChange={handleSelect} onFocus={handleFocus} onCancel={t20} visibleOptionCount={visibleCount} /></Box>;
    $[49] = handleFocus;
    $[50] = handleSelect;
    $[51] = initialFocusValue;
    $[52] = initialValue;
    $[53] = selectOptions;
    $[54] = t20;
    $[55] = visibleCount;
    $[56] = t21;
  } else {
    t21 = $[56];
  }
  let t22;
// 超出可见条数时的提示行，缩进三格与选项文字对齐。用省略号字符而不是三个点，是为了在等宽字体里占一个字符宽度。
  if ($[57] !== hiddenCount) {
    t22 = hiddenCount > 0 && <Box paddingLeft={3}><Text dimColor={true}>and {hiddenCount} more…</Text></Box>;
    $[57] = hiddenCount;
    $[58] = t22;
  } else {
    t22 = $[58];
  }
  let t23;
  if ($[59] !== t21 || $[60] !== t22) {
    t23 = <Box flexDirection="column" marginBottom={1}>{t21}{t22}</Box>;
    $[59] = t21;
    $[60] = t22;
    $[61] = t23;
  } else {
    t23 = $[61];
  }
  let t24;
// 强度行是两条完全不同的分支：支持强度时显示档位符号、档位名、是否默认、以及左右键提示；不支持时显示一个压暗的符号加一句「不支持，因为某某模型」。后者把模型名带出来，是因为用户此时最可能的疑问是「为什么不支持」，答案就在模型上。
  if ($[62] !== displayEffort || $[63] !== focusedDefaultEffort || $[64] !== focusedModelName || $[65] !== focusedSupportsEffort) {
    t24 = <Box marginBottom={1} flexDirection="column">{focusedSupportsEffort ? <Text dimColor={true}><EffortLevelIndicator effort={displayEffort} />{" "}{capitalize(displayEffort)} effort{displayEffort === focusedDefaultEffort ? " (default)" : ""}{" "}<Text color="subtle">← → to adjust</Text></Text> : <Text color="subtle"><EffortLevelIndicator effort={undefined} /> Effort not supported{focusedModelName ? ` for ${focusedModelName}` : ""}</Text>}</Box>;
    $[62] = displayEffort;
    $[63] = focusedDefaultEffort;
    $[64] = focusedModelName;
    $[65] = focusedSupportsEffort;
    $[66] = t24;
  } else {
    t24 = $[66];
  }
  let t25;
// 快速模式提示有四种状态：功能未开启则完全不显示；要求显示提示且功能开启则说明「已开启且仅某模型可用，切换会关掉」；功能可用且不在冷却期则提示如何开启；其余情况不显示。四层嵌套三元读起来很难，但它把四种互斥状态压在一个表达式里，改起来比四个分支更不容易漏。
  if ($[67] !== showFastModeNotice) {
    t25 = isFastModeEnabled() ? showFastModeNotice ? <Box marginBottom={1}><Text dimColor={true}>Fast mode is <Text bold={true}>ON</Text> and available with{" "}{FAST_MODE_MODEL_DISPLAY} only (/fast). Switching to other models turn off fast mode.</Text></Box> : isFastModeAvailable() && !isFastModeCooldown() ? <Box marginBottom={1}><Text dimColor={true}>Use <Text bold={true}>/fast</Text> to turn on Fast mode ({FAST_MODE_MODEL_DISPLAY} only).</Text></Box> : null : null;
    $[67] = showFastModeNotice;
    $[68] = t25;
  } else {
    t25 = $[68];
  }
  let t26;
  if ($[69] !== t19 || $[70] !== t23 || $[71] !== t24 || $[72] !== t25) {
    t26 = <Box flexDirection="column">{t19}{t23}{t24}{t25}</Box>;
    $[69] = t19;
    $[70] = t23;
    $[71] = t24;
    $[72] = t25;
    $[73] = t26;
  } else {
    t26 = $[73];
  }
  let t27;
  if ($[74] !== exitState || $[75] !== isStandaloneCommand) {
    t27 = isStandaloneCommand && <Text dimColor={true} italic={true}>{exitState.pending ? <>Press {exitState.keyName} again to exit</> : <Byline><KeyboardShortcutHint shortcut="Enter" action="confirm" /><ConfigurableShortcutHint action="select:cancel" context="Select" fallback="Esc" description="exit" /></Byline>}</Text>;
    $[74] = exitState;
    $[75] = isStandaloneCommand;
    $[76] = t27;
  } else {
    t27 = $[76];
  }
  let t28;
  if ($[77] !== t26 || $[78] !== t27) {
    t28 = <Box flexDirection="column">{t26}{t27}</Box>;
    $[77] = t26;
    $[78] = t27;
    $[79] = t28;
  } else {
    t28 = $[79];
  }
  const content = t28;
// 作为命令全屏显示时，内容外面套一层带配色的面板；作为嵌入式弹窗时不套。这一个分支决定了两处复用时的视觉差异，其余完全一致。
  if (!isStandaloneCommand) {
    return content;
  }
  let t29;
  if ($[80] !== content) {
    t29 = <Pane color="permission">{content}</Pane>;
    $[80] = content;
    $[81] = t29;
  } else {
    t29 = $[81];
  }
  return t29;
}
// 默认的取消回调是空函数：作为嵌入式弹窗时不传取消时，取消键什么也不做（由外层容器负责关闭），而不是抛错或崩溃。
function _temp4() {}
function _temp3(opt_0) {
  return {
    ...opt_0,
    value: opt_0.value === null ? NO_PREFERENCE : opt_0.value
  };
}
function _temp2(s_0) {
  return s_0.effortValue;
}
function _temp(s) {
  return isFastModeEnabled() ? s.fastMode : false;
}
// 解析选项值：哨兵值翻成主循环的默认模型，真实值走用户指定模型解析。所有「这个选项到底对应哪个模型」的问题最终都汇到这里，包括能力判断与默认强度。
function resolveOptionModel(value?: string): string | undefined {
  if (!value) return undefined;
  return value === NO_PREFERENCE ? getDefaultMainLoopModel() : parseUserSpecifiedModel(value);
}
function EffortLevelIndicator(t0) {
  const $ = _c(5);
  const {
    effort
  } = t0;
  const t1 = effort ? "claude" : "subtle";
  const t2 = effort ?? "low";
  let t3;
  if ($[0] !== t2) {
    t3 = effortLevelToSymbol(t2);
    $[0] = t2;
    $[1] = t3;
  } else {
    t3 = $[1];
  }
  let t4;
  if ($[2] !== t1 || $[3] !== t3) {
    t4 = <Text color={t1}>{t3}</Text>;
    $[2] = t1;
    $[3] = t3;
    $[4] = t4;
  } else {
    t4 = $[4];
  }
  return t4;
}
// 强度循环：可选档位随「是否支持最高档」变化；当前值不在档位表里时钳到高档；右移取模加一、左移取模减一。取模是让循环首尾相接的关键，否则到顶或到底就卡住。
function cycleEffortLevel(current: EffortLevel, direction: 'left' | 'right', includeMax: boolean): EffortLevel {
  const levels: EffortLevel[] = includeMax ? ['low', 'medium', 'high', 'max'] : ['low', 'medium', 'high'];
  // If the current level isn't in the cycle (e.g. 'max' after switching to a
  // non-Opus model), clamp to 'high'.
  const idx = levels.indexOf(current);
  const currentIndex = idx !== -1 ? idx : levels.indexOf('high');
  if (direction === 'right') {
    return levels[(currentIndex + 1) % levels.length]!;
  } else {
    return levels[(currentIndex - 1 + levels.length) % levels.length]!;
  }
}
// 某选项的默认强度：解析出模型、查该模型的默认强度、翻成等级；查不到就用高档兜底。兜底值选高档而不是中档，说明产品上倾向于「默认给足算力」。
function getDefaultEffortLevelForOption(value?: string): EffortLevel {
  const resolved = resolveOptionModel(value) ?? getDefaultMainLoopModel();
  const defaultValue = getDefaultEffortForModel(resolved);
  return defaultValue !== undefined ? convertEffortValueToLevel(defaultValue) : 'high';
}
// 原文件此处有一行 39048 字符的 sourceMappingURL（base64 source map），
// 它只用于把编译产物映射回源码，对理解逻辑没有帮助，这里省略不抄。