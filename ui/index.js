(() => {
  "use strict";
  const defaults = {
    configVersion: 8,
    hidSource: "iokit",
    appSwitcherNavigation: true,
    fallbackAudioInputId: "",
    keyboardTrigger: {enabled: true, key: "Fn", modifiers: [], captureCancelOnly: false},
    buttonMappings: {
      "03":"arrowUp","04":"arrowDown","05":"arrowLeft","06":"arrowRight",
      "07":"sendEnter","0B":"cancelRecording","0A":"showDesktop","0E":"none",
      "08":"mute","0F":"none","01":"lockScreen","11":"none","0C":"volumeUp","0D":"volumeDown"
    },
    customTextByButton: {}
  };
  const buttons = [
    {id:"03", label:"方向上"}, {id:"04", label:"方向下"},
    {id:"05", label:"方向左"}, {id:"06", label:"方向右"},
    {id:"07", label:"确认"}, {id:"0B", label:"返回"},
    {id:"0A", label:"Home"},
    {id:"0E", label:"YouTube"}, {id:"08", label:"静音"},
    {id:"0F", label:"Netflix"}, {id:"01", label:"电源"},
    {id:"11", label:"信源"}, {id:"0C", label:"音量＋"}, {id:"0D", label:"音量－"}
  ];
  const buttonNames = {
    "03":"方向上", "04":"方向下", "05":"方向左", "06":"方向右",
    "07":"确认", "0B":"返回", "0A":"Home", "0E":"YouTube",
    "08":"静音", "0F":"Netflix", "01":"电源", "11":"信源",
    "0C":"音量＋", "0D":"音量－"
  };
  const targetGroups = [
    {label:"常用单键", options:[
      ["none","不操作"],
      ["arrowUp","方向上"],["arrowDown","方向下"],["arrowLeft","方向左"],["arrowRight","方向右"],
      ["return","Enter 键"],["escape","Escape"],["delete","Delete"],["tab","Tab"],["space","空格"],
      ["home","Home"],["end","End"],["pageUp","Page Up"],["pageDown","Page Down"]
    ]},
    {label:"常用组合键", options:[
      ["lockScreen","锁定屏幕（⌃⌘Q）"],["commandSpace","Spotlight（⌘Space）"],
      ["commandA","全选（⌘A）"],["commandC","复制（⌘C）"],["commandV","粘贴（⌘V）"],
      ["commandZ","撤销（⌘Z）"],["commandS","保存（⌘S）"],["commandW","关闭窗口（⌘W）"],
      ["commandQ","退出应用（⌘Q）"]
    ]},
    {label:"语音与系统操作", options:[
      ["sendEnter","向 Vokie 发送 Enter"],["cancelRecording","取消并舍弃当前录音"],
      ["showDesktop","显示桌面（Fn+F11）"],["appSwitcher","遥控器应用切换器"],
      ["volumeUp","系统音量＋"],["volumeDown","系统音量－"],["mute","系统静音"]
    ]},
    {label:"自定义操作", options:[
      ["customKey","录入自定义键盘按键…"],["openApp","打开 App…"],["openFile","打开文件…"],
      ["typeText","输入字符串并发送 Enter"]
    ]}
  ];
  const modifierLabels = [["command","⌘ Command"],["option","⌥ Option"],["control","⌃ Control（左/右）"],["shift","⇧ Shift"],["fn","Fn"]];
  const functionKeys = Array.from({length:12}, (_,i)=>"F"+(i+1));
  const standaloneModifierKeys = new Set([
    "LeftCommand","RightCommand","LeftOption","RightOption",
    "LeftControl","RightControl","LeftShift","RightShift","Fn"
  ]);
  const keyChoiceGroups = [
    {label:"功能键", keys:functionKeys},
    {label:"字母（需搭配修饰键）", keys:Array.from("ABCDEFGHIJKLMNOPQRSTUVWXYZ")},
    {label:"数字（需搭配修饰键）", keys:Array.from("0123456789")},
    {label:"常用键", keys:["Space","Return","Escape","Tab"]},
    {label:"修饰键（可单独触发）", keys:Array.from(standaloneModifierKeys)}
  ];
  const keyChoices = keyChoiceGroups.flatMap(group => group.keys);
  const keyLabels = {
    LeftCommand:"左 Command（单独按）", RightCommand:"右 Command（单独按）",
    LeftOption:"左 Option（单独按）", RightOption:"右 Option（单独按）",
    LeftControl:"左 Control（单独按）", RightControl:"右 Control（单独按）",
    LeftShift:"左 Shift（单独按）", RightShift:"右 Shift（单独按）",
    Fn:"Fn（单独按）", Space:"空格", Return:"Enter",
    ArrowUp:"↑", ArrowDown:"↓", ArrowLeft:"←", ArrowRight:"→",
    Backspace:"Delete", ForwardDelete:"Fn+Delete", PageUp:"Page Up", PageDown:"Page Down"
  };
  const $ = id => document.getElementById(id);
  let currentConfig = structuredClone(defaults);
  let dirty = false;
  let loading = false;
  let refreshPending = false;
  let pendingConfig = null;
  let runtimeConfig = structuredClone(defaults);
  let runtimeConfigLoaded = false;
  let captureBusy = false;
  let captureActive = false;
  let captureCompleting = false;
  let captureTimer = null;
  let captureCancelPollTimer = null;
  let captureCancelPollPending = false;
  let captureCancelGeneration = 0;
  let savedRuntimeConfig = null;
  let dirtyBeforeCapture = false;
  let filePickerBusy = false;
  let mappingCapture = null;
  let mappingCaptureTimer = null;
  let applicationChoices = [];
  let applicationSignature = "";
  let audioInputChoices = [];
  let audioInputsLoaded = false;
  let audioInputsBusy = false;
  const applicationByButton = Object.create(null);
  const focusMainChatByButton = Object.create(null);
  const fileByButton = Object.create(null);
  const textByButton = Object.create(null);
  const shortcutByButton = Object.create(null);
  const heldModifiers = new Set();
  let pendingStandaloneKey = null;
  const heldModifierCodes = new Set();

  const modifierGlyphs = {command:"⌘", option:"⌥", control:"⌃", shift:"⇧", fn:"Fn"};
  const modifierCodes = {
    MetaLeft:{modifier:"command",triggerKey:"LeftCommand"}, MetaRight:{modifier:"command",triggerKey:"RightCommand"},
    AltLeft:{modifier:"option",triggerKey:"LeftOption"}, AltRight:{modifier:"option",triggerKey:"RightOption"},
    ControlLeft:{modifier:"control",triggerKey:"LeftControl"}, ControlRight:{modifier:"control",triggerKey:"RightControl"},
    ShiftLeft:{modifier:"shift",triggerKey:"LeftShift"}, ShiftRight:{modifier:"shift",triggerKey:"RightShift"},
    Fn:{modifier:"fn",triggerKey:"Fn"}
  };

  function mergedConfig(config) {
    return {
      configVersion: Number.isInteger(config?.configVersion) ? config.configVersion : defaults.configVersion,
      hidSource: config?.hidSource || defaults.hidSource,
      appSwitcherNavigation: config?.appSwitcherNavigation ?? defaults.appSwitcherNavigation,
      fallbackAudioInputId: typeof config?.fallbackAudioInputId === "string" ? config.fallbackAudioInputId : defaults.fallbackAudioInputId,
      keyboardTrigger: {...defaults.keyboardTrigger, ...(config?.keyboardTrigger || {})},
      buttonMappings: {...defaults.buttonMappings, ...(config?.buttonMappings || {})},
      customTextByButton: {...(config?.customTextByButton || {})}
    };
  }

  function selectedModifiers() {
    return Array.from($("modifierList").querySelectorAll("input:checked"), input=>input.dataset.modifier);
  }

  function displayKey(key) {
    return (keyLabels[key] || key).replace(/（单独按）$/, "");
  }

  function hotkeyLabel(key, modifiers) {
    return [...modifiers.map(name => modifierGlyphs[name] || name), displayKey(key)].join(" + ");
  }

  function updateCaptureField() {
    if (!captureActive && !captureBusy) {
      $("triggerCapture").value = hotkeyLabel($("triggerKey").value, selectedModifiers());
    }
  }

  function setCaptureLocked(locked) {
    const controlsLocked = locked || filePickerBusy || !!mappingCapture;
    $("hidEnabled").disabled = controlsLocked;
    $("appSwitcherNavigation").disabled = controlsLocked;
    $("triggerEnabled").disabled = controlsLocked;
    $("triggerKey").disabled = controlsLocked || !$("triggerEnabled").checked;
    $("modifierList").querySelectorAll("input").forEach(input => {
      input.disabled = controlsLocked || !$("triggerEnabled").checked || standaloneModifierKeys.has($("triggerKey").value);
    });
    $("saveButton").disabled = controlsLocked;
    $("captureTriggerButton").disabled = controlsLocked;
    updateMappingControlLocks();
  }

  function updateMappingControlLocks() {
    const controlsLocked = captureBusy || filePickerBusy || !!mappingCapture;
    const directSwitcher = $("appSwitcherNavigation").checked;
    document.querySelectorAll("select[data-button-id], .mapping-detail select, .mapping-detail button, .mapping-detail input").forEach(control => {
      const buttonId = control.dataset.buttonId || control.dataset.appId || control.closest("[data-button-detail]")?.dataset.buttonDetail;
      const directDirection = directSwitcher && ["05", "06"].includes(buttonId);
      const activeCaptureButton = mappingCapture && buttonId === mappingCapture.buttonId && control.dataset.mappingCaptureButton === "true";
      control.disabled = (controlsLocked && !activeCaptureButton) || directDirection;
    });
  }

  function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function eventHasModifier(event, name) {
    const stateName = ({command:"Meta", option:"Alt", control:"Control", shift:"Shift", fn:"Fn"})[name];
    try { return !!event.getModifierState?.(stateName); } catch { return false; }
  }

  function setHeldModifierCode(code, isDown) {
    if (isDown) heldModifierCodes.add(code);
    else heldModifierCodes.delete(code);
    heldModifiers.clear();
    for (const heldCode of heldModifierCodes) {
      const info = modifierCodes[heldCode];
      if (info) heldModifiers.add(info.modifier);
    }
  }

  function modifiersFromEvent(event) {
    const flags = {
      command: event.metaKey || eventHasModifier(event, "command"),
      option: event.altKey || eventHasModifier(event, "option"),
      control: event.ctrlKey || eventHasModifier(event, "control"),
      shift: event.shiftKey || eventHasModifier(event, "shift"),
      fn: eventHasModifier(event, "fn")
    };
    return modifierLabels.map(([name]) => name).filter(name => flags[name] || heldModifiers.has(name));
  }

  function preventCapturedKey(event) {
    event.preventDefault();
    event.stopPropagation();
    if (typeof event.stopImmediatePropagation === "function") event.stopImmediatePropagation();
  }

  function isEscapeKey(event) {
    // `key` and `code` are the standard identifiers. Keep legacy aliases as
    // fallbacks because embedded webviews can report Escape as `Esc` or only
    // expose the DOM key code.
    return event.key === "Escape" || event.key === "Esc" || event.code === "Escape" ||
      event.keyCode === 27 || event.which === 27;
  }

  function capturePreview() {
    const modifiers = modifierLabels.map(([name]) => name).filter(name => heldModifiers.has(name));
    $("triggerCapture").value = modifiers.length ? `${modifiers.map(name=>modifierGlyphs[name]).join(" + ")} + 按主键` : "请按一个键或组合键…";
  }

  function normalizeCapturedKey(event) {
    const code = event.code || "";
    if (/^Key[A-Z]$/.test(code)) return code.slice(3);
    if (/^Digit[0-9]$/.test(code)) return code.slice(5);
    if (/^F(?:[1-9]|1[0-2])$/.test(code)) return code;
    if (code === "Space") return "Space";
    if (code === "Enter" || event.key === "Enter") return "Return";
    if (code === "Escape" || event.key === "Escape") return "Escape";
    if (code === "Tab" || event.key === "Tab") return "Tab";
    return null;
  }

  function normalizeMappingKey(event) {
    const code = event.code || "";
    if (/^Key[A-Z]$/.test(code)) return code.slice(3);
    if (/^Digit[0-9]$/.test(code)) return code.slice(5);
    if (/^F(?:[1-9]|1[0-2])$/.test(code)) return code;
    const common = {
      Space:"Space", Enter:"Return", Escape:"Escape", Tab:"Tab",
      Backspace:"Backspace", Delete:"ForwardDelete", Home:"Home", End:"End",
      PageUp:"PageUp", PageDown:"PageDown", ArrowUp:"ArrowUp", ArrowDown:"ArrowDown",
      ArrowLeft:"ArrowLeft", ArrowRight:"ArrowRight"
    };
    return common[code] || null;
  }

  function shortcutModifiersFromEvent(event, state) {
    const flags = {
      command:event.metaKey || eventHasModifier(event, "command"),
      option:event.altKey || eventHasModifier(event, "option"),
      control:event.ctrlKey || eventHasModifier(event, "control"),
      shift:event.shiftKey || eventHasModifier(event, "shift"),
      fn:eventHasModifier(event, "fn")
    };
    for (const code of state.heldCodes) {
      const info = modifierCodes[code];
      if (info) flags[info.modifier] = true;
    }
    return modifierLabels.map(([name]) => name).filter(name => flags[name]);
  }

  function mappingShortcutLabel(shortcut) {
    if (!shortcut) return "尚未录入";
    return hotkeyLabel(shortcut.key, shortcut.modifiers || []);
  }

  function finishMappingCapture(shortcut) {
    if (!mappingCapture) return;
    const {buttonId} = mappingCapture;
    clearTimeout(mappingCaptureTimer);
    mappingCaptureTimer = null;
    window.removeEventListener("keydown", onMappingCaptureKeyDown, true);
    window.removeEventListener("keyup", onMappingCaptureKeyUp, true);
    mappingCapture = null;
    if (shortcut) {
      shortcutByButton[buttonId] = {key:shortcut.key, modifiers:[...new Set(shortcut.modifiers || [])]};
      dirty = true;
    }
    updateMappingDetail(buttonId, "customKey");
    setCaptureLocked(false);
    setMessage(shortcut
      ? `已录入 ${mappingShortcutLabel(shortcutByButton[buttonId])}；保存设置后生效。`
      : "已取消按键录入，原映射未更改。");
  }

  function onMappingCaptureKeyDown(event) {
    const state = mappingCapture;
    if (!state) return;
    preventCapturedKey(event);
    if (event.repeat) return;
    const modifierInfo = modifierCodes[event.code || ""];
    if (modifierInfo) {
      const firstModifier = state.heldCodes.size === 0;
      state.heldCodes.add(event.code);
      state.pendingStandaloneKey = firstModifier ? modifierInfo.triggerKey : null;
      updateMappingDetail(state.buttonId, "customKey");
      updateMappingControlLocks();
      return;
    }
    const key = normalizeMappingKey(event);
    if (!key) {
      setMessage("这个按键暂不支持。可录入 A–Z、0–9、F1–F12、方向/导航键、空格、Enter、Escape、Tab，或单独按左/右修饰键和 Fn。", true);
      return;
    }
    const modifiers = shortcutModifiersFromEvent(event, state);
    finishMappingCapture({key, modifiers});
  }

  function onMappingCaptureKeyUp(event) {
    const state = mappingCapture;
    if (!state) return;
    preventCapturedKey(event);
    const modifierInfo = modifierCodes[event.code || ""];
    if (!modifierInfo) return;
    state.heldCodes.delete(event.code);
    if (state.pendingStandaloneKey === modifierInfo.triggerKey && state.heldCodes.size === 0) {
      finishMappingCapture({key:modifierInfo.triggerKey, modifiers:[]});
      return;
    }
    updateMappingDetail(state.buttonId, "customKey");
    updateMappingControlLocks();
  }

  function startMappingCapture(buttonId) {
    if (captureBusy || filePickerBusy || mappingCapture) return;
    mappingCapture = {buttonId, heldCodes:new Set(), pendingStandaloneKey:null};
    setCaptureLocked(true);
    window.addEventListener("keydown", onMappingCaptureKeyDown, true);
    window.addEventListener("keyup", onMappingCaptureKeyUp, true);
    updateMappingDetail(buttonId, "customKey");
    updateMappingControlLocks();
    setMessage(`请按下要映射的单键或组合键；Esc 可作为映射，点“取消录入”结束。`);
    mappingCaptureTimer = setTimeout(() => finishMappingCapture(null), 30000);
  }

  function serializeMappingShortcut(shortcut) {
    return `shortcut:${shortcut.modifiers.length ? shortcut.modifiers.join("+") : "none"}:${shortcut.key}`;
  }

  async function restoreRuntimeConfig() {
    const restore = savedRuntimeConfig;
    if (!restore) return;
    try {
      await window.vokiePlugin.configure(restore);
      await delay(200);
      runtimeConfig = structuredClone(restore);
    } finally {
      savedRuntimeConfig = null;
      captureBusy = false;
      captureCompleting = false;
      captureActive = false;
      $("captureTriggerButton").disabled = false;
      $("captureTriggerButton").textContent = "录入快捷键";
      $("saveButton").disabled = false;
      setCaptureLocked(false);
      $("triggerCapture").classList.remove("capturing");
      updateCaptureField();
      refreshState(false);
    }
  }

  async function finishCapture({accepted=false, message="已取消录入"}={}) {
    if (!captureBusy || captureCompleting) return;
    captureCompleting = true;
    captureActive = false;
    clearTimeout(captureTimer);
    captureTimer = null;
    clearInterval(captureCancelPollTimer);
    captureCancelPollTimer = null;
    window.removeEventListener("keydown", onCaptureKeyDown, true);
    window.removeEventListener("keyup", onCaptureKeyUp, true);
    heldModifiers.clear();
    heldModifierCodes.clear();
    pendingStandaloneKey = null;
    $("triggerCapture").classList.remove("capturing");
    $("captureTriggerButton").disabled = true;
    $("captureTriggerButton").textContent = "正在恢复…";

    if (accepted) {
      dirty = true;
      $("triggerEnabled").checked = true;
      updateTriggerDisabled();
      updateCaptureField();
    } else {
      dirty = dirtyBeforeCapture;
      updateCaptureField();
    }

    let restoreError = null;
    try {
      await restoreRuntimeConfig();
    } catch (error) {
      restoreError = error;
      // The captured value remains in the form. Saving it again can re-enable
      // the newly selected shortcut if the temporary restore request failed.
      captureBusy = false;
      captureCompleting = false;
      captureActive = false;
      savedRuntimeConfig = null;
      $("captureTriggerButton").disabled = false;
      $("captureTriggerButton").textContent = "录入快捷键";
      updateCaptureField();
      refreshState(false);
    }
    if (restoreError) {
      setMessage(`${accepted ? "快捷键已录入，请保存。" : message} 但恢复旧快捷键失败：${restoreError.message || restoreError}`, true);
    } else {
      setMessage(message);
    }
  }

  function onCaptureKeyDown(event) {
    if (!captureActive) return;
    preventCapturedKey(event);
    if (event.repeat) return;

    if (isEscapeKey(event)) {
      void finishCapture({message:"已按 Escape 取消录入，旧快捷键已恢复。"});
      return;
    }

    const code = event.code || "";
    const modifierInfo = modifierCodes[code];
    if (modifierInfo) {
      const firstModifier = heldModifierCodes.size === 0;
      setHeldModifierCode(code, true);
      pendingStandaloneKey = firstModifier ? modifierInfo.triggerKey : null;
      if (pendingStandaloneKey) {
        $("triggerCapture").value = `${displayKey(pendingStandaloneKey)}（松开以录入）`;
      } else {
        capturePreview();
      }
      return;
    }

    const key = normalizeCapturedKey(event);
    if (!key) {
      setMessage("这个按键暂不支持。可录入 F1–F12、A–Z、0–9、空格、Enter、Tab，或单独按左/右 Command、Option、Control、Shift、Fn。Escape 用于取消录入。", true);
      return;
    }
    pendingStandaloneKey = null;
    const modifiers = modifiersFromEvent(event);
    if (/^[A-Z0-9]$/.test(key) && modifiers.length === 0) {
      setMessage("字母和数字需搭配修饰键，请按住 Command、Option、Control 或 Shift 再按主键。", true);
      return;
    }

    $("triggerKey").value = key;
    $("modifierList").querySelectorAll("input").forEach(input => {
      input.checked = modifiers.includes(input.dataset.modifier);
    });
    setMessage(`已识别 ${hotkeyLabel(key, modifiers)}，正在恢复原快捷键…`);
    void finishCapture({accepted:true, message:`快捷键 ${hotkeyLabel(key, modifiers)} 已录入，请保存后生效。`});
  }

  function onCaptureKeyUp(event) {
    if (!captureActive) return;
    preventCapturedKey(event);
    // Some webviews suppress or rewrite the keydown for Escape. Treat its
    // keyup as a second cancellation path; finishCapture is guarded against
    // duplicate completion if keydown was already delivered.
    if (isEscapeKey(event)) {
      void finishCapture({message:"已按 Escape 取消录入，旧快捷键已恢复。"});
      return;
    }
    const code = event.code || "";
    const modifierInfo = modifierCodes[code];
    if (!modifierInfo) return;
    setHeldModifierCode(code, false);
    if (pendingStandaloneKey === modifierInfo.triggerKey && heldModifierCodes.size === 0) {
      const key = pendingStandaloneKey;
      pendingStandaloneKey = null;
      $("triggerKey").value = key;
      $("modifierList").querySelectorAll("input").forEach(input => { input.checked = false; });
      setMessage(`已识别 ${displayKey(key)}，正在恢复原快捷键…`);
      void finishCapture({accepted:true, message:`快捷键 ${displayKey(key)} 已录入，请保存后生效。`});
      return;
    }
    capturePreview();
  }

  async function pollNativeCaptureCancel() {
    if (!captureActive || captureCancelPollPending) return;
    captureCancelPollPending = true;
    try {
      const response = await window.vokiePlugin.getState();
      const device = response.state?.extensions?.chromecastVoiceRemote?.device || {};
      const generation = Number(device.captureCancelGeneration) || 0;
      if (captureActive && generation > captureCancelGeneration) {
        captureCancelGeneration = generation;
        void finishCapture({message:"已按键盘 Escape 取消录入，旧快捷键已恢复。"});
      }
    } catch {
      // The DOM keyboard listener remains as a fallback if host polling fails.
    } finally {
      captureCancelPollPending = false;
    }
  }

  function configSignature(config) {
    const trigger = {...defaults.keyboardTrigger, ...(config?.keyboardTrigger || {})};
    const mappings = {...defaults.buttonMappings, ...(config?.buttonMappings || {})};
    return JSON.stringify([
      Number.isInteger(config?.configVersion) ? config.configVersion : defaults.configVersion,
      config?.hidSource || defaults.hidSource,
      config?.appSwitcherNavigation ?? defaults.appSwitcherNavigation,
      config?.fallbackAudioInputId || "",
      !!trigger.enabled,
      trigger.key,
      [...(trigger.modifiers || [])].sort(),
      Object.keys(mappings).sort().map(id => [id, mappings[id]]),
      config?.customTextByButton || {}
    ]);
  }

  function setMessage(message, error=false) {
    $("message").textContent = message;
    $("message").dataset.error = error ? "true" : "false";
  }
  function option(select, value, label) {
    const item = document.createElement("option");
    item.value = value; item.textContent = label; select.append(item);
  }
  function renderAudioInputChoices(selectedId) {
    const select = $("fallbackAudioInput");
    const selected = typeof selectedId === "string" ? selectedId : "";
    select.replaceChildren();
    option(select, "", "不启用备用麦克风");
    const selectedDevice = audioInputChoices.find(device => device.deviceId === selected);
    if (selected && !selectedDevice) {
      option(select, selected, "保存的麦克风暂不可用，请重新选择");
    }
    audioInputChoices.forEach((device, index) => {
      const label = typeof device.label === "string" && device.label.trim()
        ? device.label.trim()
        : `音频输入 ${index + 1}`;
      option(select, device.deviceId, label);
    });
    select.value = selected;
    if (select.value !== selected) select.value = "";
    if (selectedDevice) {
      const label = selectedDevice.label?.trim() || "已选麦克风";
      $("audioInputStatus").textContent = `已选择“${label}”；遥控器语音通道未就绪时，键盘快捷键将使用它。`;
    } else if (!audioInputsLoaded) {
      $("audioInputStatus").textContent = "正在读取 Mac 麦克风…";
    } else if (selected) {
      $("audioInputStatus").textContent = "保存的麦克风不在此 Mac 的设备列表中，请重新选择。";
    } else if (!audioInputChoices.length) {
      $("audioInputStatus").textContent = "Vokie 当前没有返回可用麦克风；检查 Mac 音频输入后刷新列表。";
    } else {
      $("audioInputStatus").textContent = "选择并保存一个备用麦克风；没有遥控器时，电脑快捷键会使用它。";
    }
  }
  async function refreshAudioInputs() {
    if (audioInputsBusy) return;
    audioInputsBusy = true;
    $("refreshAudioInputsButton").disabled = true;
    const selected = audioInputsLoaded ? $("fallbackAudioInput").value : currentConfig.fallbackAudioInputId;
    $("audioInputStatus").textContent = "正在读取 Mac 麦克风…";
    try {
      const response = await window.vokiePlugin.getAudioInputs({transport:"system"});
      audioInputChoices = (Array.isArray(response.devices) ? response.devices : [])
        .filter(device => device && device.transport === "system" && device.available !== false && typeof device.deviceId === "string" && device.deviceId.length > 0);
      audioInputsLoaded = true;
      renderAudioInputChoices(selected);
    } catch (error) {
      audioInputsLoaded = true;
      audioInputChoices = [];
      renderAudioInputChoices(selected);
      $("audioInputStatus").textContent = `无法读取麦克风列表：${error.message || error}`;
    } finally {
      audioInputsBusy = false;
      $("refreshAudioInputsButton").disabled = false;
    }
  }
  function parseStoredMapping(buttonId, value) {
    if (typeof value !== "string") return {kind:"none"};
    const shortcutMatch = value.match(/^shortcut:(none|(?:command|option|control|shift|fn)(?:\+(?:command|option|control|shift|fn))*):([A-Za-z0-9][A-Za-z0-9]*)$/);
    if (shortcutMatch) {
      return {
        kind:"customKey",
        key:shortcutMatch[2],
        modifiers:shortcutMatch[1] === "none" ? [] : shortcutMatch[1].split("+")
      };
    }
    if (/^key:(?:[A-Z]|[0-9])$/.test(value)) return {kind:"customKey", key:value.slice(4), modifiers:[]};
    if (/^F(?:[1-9]|1[0-2])$/.test(value)) return {kind:"customKey", key:value, modifiers:[]};
    if (value.startsWith("openAppFocus:")) return {kind:"openApp", bundleId:value.slice("openAppFocus:".length), focusMainChat:true};
    // Older plugin builds stored this target after mistaking Chat Bar launch
    // for focusing the main ChatGPT composer. Keep the app choice, but retire
    // the extra shortcut because it starts a separate chat.
    if (value.startsWith("openAppChatBar:")) return {kind:"openApp", bundleId:value.slice("openAppChatBar:".length)};
    if (value.startsWith("openApp:")) return {kind:"openApp", bundleId:value.slice("openApp:".length)};
    if (value.startsWith("openFile:")) return {kind:"openFile", path:value.slice("openFile:".length)};
    if (value.startsWith(`pickFile:${buttonId}:`)) return {kind:"openFile", path:""};
    return {kind:value};
  }
  function updateMappingDetail(buttonId, mode) {
    const detail = document.querySelector(`[data-button-detail="${buttonId}"]`);
    if (!detail) return;
    detail.replaceChildren();
    if (mode === "openApp") {
      const picker = document.createElement("select");
      picker.dataset.appId = buttonId;
      picker.setAttribute("aria-label", `${buttonNames[buttonId]} 打开应用`);
      option(picker, "", applicationChoices.length ? "选择已安装的 App…" : "暂未发现应用");
      const selected = applicationByButton[buttonId] || "";
      if (selected && !applicationChoices.some(app => app.bundleId === selected)) {
        option(picker, selected, `未在列表中找到：${selected}`);
      }
      for (const app of applicationChoices) option(picker, app.bundleId, app.name);
      picker.value = selected;
      picker.addEventListener("change", () => {
        applicationByButton[buttonId] = picker.value;
        if (picker.value !== "com.openai.codex" && picker.value !== "com.openai.chatgpt") delete focusMainChatByButton[buttonId];
        if (!loading) dirty = true;
        updateMappingDetail(buttonId, "openApp");
      });
      detail.append(picker);
      const bundleId = picker.value || "";
      if (bundleId === "com.openai.codex" || bundleId === "com.openai.chatgpt") {
        const focusLabel = document.createElement("label");
        focusLabel.className = "check mapping-focus-option";
        const focusCheckbox = document.createElement("input");
        focusCheckbox.type = "checkbox";
        focusCheckbox.checked = focusMainChatByButton[buttonId] === true;
        focusCheckbox.setAttribute("aria-label", `${buttonNames[buttonId]}打开后聚焦 ChatGPT 主聊天`);
        focusCheckbox.addEventListener("change", () => {
          focusMainChatByButton[buttonId] = focusCheckbox.checked;
          if (!loading) dirty = true;
        });
        focusLabel.append(focusCheckbox, document.createTextNode("打开后发送 ⌥+L，尝试聚焦聊天输入框"));
        const hint = document.createElement("span");
        hint.className = "mapping-file-name mapping-focus-note";
        hint.textContent = "受 macOS 键盘事件处理限制，聚焦时可能会额外输入一个「¬」符号，不影响使用；实际效果也会因 ChatGPT 当前页面而异。";
        detail.append(focusLabel, hint);
      }
    } else if (mode === "openFile") {
      const pickerButton = document.createElement("button");
      pickerButton.type = "button";
      pickerButton.className = "secondary";
      pickerButton.textContent = "选择文件…";
      pickerButton.addEventListener("click", () => { void requestFilePicker(buttonId); });
      const selectedPath = fileByButton[buttonId] || "";
      const selectedName = selectedPath.split("/").filter(Boolean).at(-1) || "尚未选择文件";
      const label = document.createElement("span");
      label.className = "mapping-file-name";
      label.textContent = selectedName;
      label.title = selectedPath;
      detail.append(pickerButton, label);
    } else if (mode === "typeText") {
      const input = document.createElement("input");
      input.type = "text";
      input.autocomplete = "off";
      input.spellcheck = false;
      input.maxLength = 128;
      input.placeholder = "输入要发送的字符串";
      input.setAttribute("aria-label", `${buttonNames[buttonId]} 自定义输入内容`);
      input.value = textByButton[buttonId] || "";
      input.addEventListener("input", () => {
        textByButton[buttonId] = input.value;
        if (!loading) dirty = true;
      });
      const note = document.createElement("span");
      note.className = "mapping-file-name";
      note.textContent = "按键时输入这段字符串并发送 Enter；最多 128 个字符，不含换行。内容以明文保存在 Vokie 插件设置中。少数 App 可能无法接收系统模拟的 Unicode 文字输入。";
      detail.append(input, note);
    } else if (mode === "customKey") {
      const shortcut = shortcutByButton[buttonId];
      const preview = document.createElement("input");
      preview.type = "text";
      preview.readOnly = true;
      preview.value = mappingCapture?.buttonId === buttonId ? "请按下按键…" : mappingShortcutLabel(shortcut);
      preview.setAttribute("aria-label", `${buttonNames[buttonId]} 自定义键盘映射`);
      const captureButton = document.createElement("button");
      captureButton.type = "button";
      captureButton.className = "secondary";
      captureButton.dataset.buttonId = buttonId;
      captureButton.dataset.mappingCaptureButton = "true";
      const isCapturing = mappingCapture?.buttonId === buttonId;
      captureButton.textContent = isCapturing ? "取消录入" : "录入按键…";
      captureButton.addEventListener("click", () => {
        if (mappingCapture?.buttonId === buttonId) finishMappingCapture(null);
        else startMappingCapture(buttonId);
      });
      const note = document.createElement("span");
      note.className = "mapping-file-name";
      note.textContent = "按下要发送的按键；支持组合键和单独修饰键。";
      detail.append(preview, captureButton, note);
    }
  }

  function buildControls() {
    const triggerKey = $("triggerKey");
    for (const group of keyChoiceGroups) {
      const optgroup = document.createElement("optgroup");
      optgroup.label = group.label;
      for (const key of group.keys) option(optgroup, key, keyLabels[key] || key);
      triggerKey.append(optgroup);
    }
    for (const [name,label] of modifierLabels) {
      const wrapper = document.createElement("label");
      wrapper.className = "check";
      const input = document.createElement("input");
      input.type = "checkbox"; input.value = name; input.dataset.modifier = name;
      wrapper.append(input, document.createTextNode(label));
      $("modifierList").append(wrapper);
    }
    const rows = $("mappingRows");
    for (const button of buttons) {
      if (button.id === "05") rows.append($("appSwitcherRowTemplate").content.cloneNode(true));
      if (button.id === "0A") rows.append($("voiceButtonRowTemplate").content.cloneNode(true));
      const row = document.createElement("div");
      row.className = "map-row";
      const label = document.createElement("strong");
      label.textContent = button.label;
      row.append(label);
      const controls = document.createElement("div");
      controls.className = "mapping-control";
      const select = document.createElement("select");
      select.dataset.buttonId = button.id;
      select.setAttribute("aria-label", button.label + " 映射");
      for (const group of targetGroups) {
        const optgroup = document.createElement("optgroup");
        optgroup.label = group.label;
        for (const [value,text] of group.options) option(optgroup, value, text);
        select.append(optgroup);
      }
      const detail = document.createElement("div");
      detail.className = "mapping-detail";
      detail.dataset.buttonDetail = button.id;
      select.addEventListener("change", () => {
        updateMappingDetail(button.id, select.value);
        updateMappingControlLocks();
        if (!loading) dirty = true;
      });
      controls.append(select, detail);
      row.append(controls);
      rows.append(row);
    }
    $("triggerEnabled").addEventListener("change", () => { dirty = true; updateTriggerDisabled(); });
    $("triggerKey").addEventListener("change", () => { dirty = true; updateTriggerDisabled(); });
    $("modifierList").addEventListener("change", () => { dirty = true; updateCaptureField(); });
    $("hidEnabled").addEventListener("change", () => { dirty = true; });
    $("appSwitcherNavigation").addEventListener("change", () => { dirty = true; updateMappingControlLocks(); });
    $("fallbackAudioInput").addEventListener("change", () => {
      dirty = true;
      renderAudioInputChoices($("fallbackAudioInput").value);
    });
    $("refreshAudioInputsButton").addEventListener("click", () => { void refreshAudioInputs(); });
    $("saveButton").addEventListener("click", saveConfig);
    updateTriggerDisabled();
  }
  function updateTriggerDisabled() {
    const enabled = $("triggerEnabled").checked;
    const locked = captureBusy;
    $("triggerKey").disabled = locked || !enabled;
    const key = $("triggerKey").value;
    const standaloneModifier = standaloneModifierKeys.has(key);
    const needsModifier = /^[A-Z0-9]$/.test(key);
    $("modifierList").querySelectorAll("input").forEach(input => {
      if (standaloneModifier) input.checked = false;
      input.disabled = locked || !enabled || standaloneModifier;
    });
    $("triggerKeyHint").textContent = needsModifier
      ? "字母和数字请搭配至少一个修饰键（如 ⌃+K），避免普通打字触发。"
      : standaloneModifier
        ? "所选修饰键可单独作为触发键；若要设置组合，请把 F 键、常用键、字母或数字设为主键，再勾选修饰键。"
        : "可选 F1–F12、常用键，或与修饰键组合使用的字母和数字。";
    updateCaptureField();
  }
  function applyConfig(config) {
    const merged = mergedConfig(config);
    loading = true;
    currentConfig = merged;
    renderAudioInputChoices(merged.fallbackAudioInputId);
    for (const button of buttons) textByButton[button.id] = merged.customTextByButton[button.id] || "";
    $("hidEnabled").checked = merged.hidSource !== "disabled";
    $("appSwitcherNavigation").checked = merged.appSwitcherNavigation;
    $("triggerEnabled").checked = !!merged.keyboardTrigger.enabled;
    $("triggerKey").value = keyChoices.includes(merged.keyboardTrigger.key) ? merged.keyboardTrigger.key : "Fn";
    $("modifierList").querySelectorAll("input").forEach(input => {
      input.checked = merged.keyboardTrigger.modifiers.includes(input.dataset.modifier);
    });
    document.querySelectorAll("select[data-button-id]").forEach(select => {
      const buttonId = select.dataset.buttonId;
      const parsed = parseStoredMapping(buttonId, merged.buttonMappings[buttonId] || "none");
      select.value = Array.from(select.options).some(item => item.value === parsed.kind) ? parsed.kind : "none";
      if (parsed.kind === "openApp") {
        applicationByButton[buttonId] = parsed.bundleId;
        focusMainChatByButton[buttonId] = parsed.focusMainChat === true;
      } else {
        delete applicationByButton[buttonId];
        delete focusMainChatByButton[buttonId];
      }
      if (parsed.kind === "customKey") shortcutByButton[buttonId] = {key:parsed.key, modifiers:parsed.modifiers || []};
      else delete shortcutByButton[buttonId];
      if (parsed.kind === "openFile") fileByButton[buttonId] = parsed.path;
      else delete fileByButton[buttonId];
      updateMappingDetail(buttonId, select.value);
    });
    updateMappingControlLocks();
    updateTriggerDisabled();
    loading = false;
    updateCaptureField();
  }
  async function refreshState() {
    if (refreshPending) return;
    refreshPending = true;
    try {
      const response = await window.vokiePlugin.getState();
      const state = response.state || {};
      const ext = state.extensions?.chromecastVoiceRemote || {};
      const device = ext.device || {};
      const nextApplications = Array.isArray(device.applications) ? device.applications : [];
      const nextApplicationSignature = JSON.stringify(nextApplications.map(app => [app.bundleId, app.name]));
      if (nextApplicationSignature !== applicationSignature) {
        applicationSignature = nextApplicationSignature;
        applicationChoices = nextApplications;
        document.querySelectorAll("select[data-button-id]").forEach(select => updateMappingDetail(select.dataset.buttonId, select.value));
      }
      if (ext.config && (!captureBusy || !savedRuntimeConfig) && !mappingCapture) {
        runtimeConfig = mergedConfig(ext.config);
        runtimeConfigLoaded = true;
      }
      if (!dirty && (!captureBusy || !savedRuntimeConfig) && !mappingCapture && ext.config) {
        if (pendingConfig && configSignature(ext.config) === configSignature(pendingConfig)) pendingConfig = null;
        if (!pendingConfig) applyConfig(ext.config);
      }
      $("errorText").textContent = device.actionError || ext.lastError || "";
    } catch (error) {
      if (!runtimeConfigLoaded) $("errorText").textContent = "无法读取插件设置，请确认设备插件已启用。";
    } finally {
      refreshPending = false;
    }
  }
  async function saveConfig() {
    if (captureBusy || mappingCapture) {
      setMessage("请先完成或取消键盘录入，再保存设置。", true);
      return;
    }
    const buttonMappings = {...currentConfig.buttonMappings};
    const customTextByButton = {};
    try {
      document.querySelectorAll("select[data-button-id]").forEach(select => {
        const buttonId = select.dataset.buttonId;
        if (select.value === "openApp") {
          const bundleId = applicationByButton[buttonId] || "";
          if (!bundleId) throw new Error(`请为“${buttonNames[buttonId]}”选择一个 App。`);
          buttonMappings[buttonId] = focusMainChatByButton[buttonId]
            ? `openAppFocus:${bundleId}`
            : `openApp:${bundleId}`;
        } else if (select.value === "openFile") {
          const filePath = fileByButton[buttonId] || "";
          if (!filePath) throw new Error(`请先为“${buttonNames[buttonId]}”选择一个文件。`);
          buttonMappings[buttonId] = `openFile:${filePath}`;
        } else if (select.value === "typeText") {
          const text = textByButton[buttonId] || "";
          if (text.length < 1 || text.length > 128 || /[\u0000-\u001F\u007F-\u009F\u2028\u2029]/.test(text)) {
            throw new Error(`请为“${buttonNames[buttonId]}”输入 1 到 128 个字符，不要包含换行或控制字符。`);
          }
          buttonMappings[buttonId] = "typeText";
          customTextByButton[buttonId] = text;
        } else if (select.value === "customKey") {
          const shortcut = shortcutByButton[buttonId];
          if (!shortcut) throw new Error(`请为“${buttonNames[buttonId]}”录入一个键盘按键或组合键。`);
          buttonMappings[buttonId] = serializeMappingShortcut(shortcut);
        } else {
          buttonMappings[buttonId] = select.value;
        }
      });
    } catch (error) {
      setMessage(error.message || String(error), true);
      return;
    }
    const modifiers = Array.from($("modifierList").querySelectorAll("input:checked"), input=>input.dataset.modifier);
    if ($("triggerEnabled").checked && /^[A-Z0-9]$/.test($("triggerKey").value) && modifiers.length === 0) {
      setMessage("字母或数字触发键需要至少一个修饰键，避免普通打字时误触。", true);
      return;
    }
    const config = {
      configVersion: defaults.configVersion,
      hidSource: $("hidEnabled").checked ? "iokit" : "disabled",
      appSwitcherNavigation: $("appSwitcherNavigation").checked,
      fallbackAudioInputId: $("fallbackAudioInput").value,
      keyboardTrigger: {enabled:$("triggerEnabled").checked, key:$("triggerKey").value, modifiers},
      buttonMappings,
      customTextByButton
    };
    $("saveButton").disabled = true;
    setMessage("正在等待 Vokie 确认设置…");
    try {
      await window.vokiePlugin.configure(config);
      currentConfig = config;
      runtimeConfig = structuredClone(config);
      runtimeConfigLoaded = true;
      pendingConfig = config;
      applyConfig(config);
      dirty = false;
      setMessage("设置已保存");
      await refreshState(false);
    } catch (error) {
      setMessage("保存失败；旧设置仍然有效。 " + (error.message || error), true);
    } finally {
      $("saveButton").disabled = false;
    }
  }

  async function waitForFilePicker(buttonId, pickerId) {
    const deadline = Date.now() + 120000;
    while (Date.now() < deadline) {
      const response = await window.vokiePlugin.getState();
      const state = response.state || {};
      const device = state.extensions?.chromecastVoiceRemote?.device || {};
      const result = device.filePicker;
      if (result?.buttonId === buttonId && result?.pickerId === pickerId && result.status !== "pending") return result;
      await delay(600);
    }
    throw new Error("等待系统文件选择窗口超时。请重试，或确认设备插件仍在运行。");
  }

  async function requestFilePicker(buttonId) {
    if (filePickerBusy || captureBusy || mappingCapture) return;
    const wasDirty = dirty;
    const pickerId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    const requestConfig = structuredClone(currentConfig);
    requestConfig.buttonMappings[buttonId] = `pickFile:${buttonId}:${pickerId}`;
    filePickerBusy = true;
    setCaptureLocked(false);
    setMessage(`正在为“${buttonNames[buttonId]}”打开系统文件选择窗口…`);
    let requestSent = false;
    try {
      await window.vokiePlugin.configure(requestConfig);
      requestSent = true;
      const result = await waitForFilePicker(buttonId, pickerId);
      if (result.status !== "selected" || !result.path.startsWith("/")) {
        const restoreConfig = structuredClone(currentConfig);
        await window.vokiePlugin.configure(restoreConfig);
        setMessage(result.status === "cancelled" ? "已取消选择，没有更改文件映射。" : (result.message || "文件选择未完成。"), result.status === "error");
        return;
      }

      const finalConfig = structuredClone(currentConfig);
      finalConfig.buttonMappings[buttonId] = `openFile:${result.path}`;
      await window.vokiePlugin.configure(finalConfig);
      currentConfig = finalConfig;
      runtimeConfig = structuredClone(finalConfig);
      runtimeConfigLoaded = true;
      pendingConfig = finalConfig;
      fileByButton[buttonId] = result.path;
      const select = document.querySelector(`select[data-button-id="${buttonId}"]`);
      if (select) {
        select.value = "openFile";
        updateMappingDetail(buttonId, "openFile");
      }
      dirty = wasDirty;
      if (!wasDirty) applyConfig(finalConfig);
      setMessage(`已为“${buttonNames[buttonId]}”保存文件：${result.name || result.path.split("/").at(-1)}`);
    } catch (error) {
      if (requestSent) {
        try { await window.vokiePlugin.configure(structuredClone(currentConfig)); }
        catch (restoreError) {
          setMessage(`文件选择失败：${error.message || error}；恢复原设置也失败：${restoreError.message || restoreError}`, true);
          return;
        }
      }
      setMessage(`文件选择失败：${error.message || error}`, true);
    } finally {
      filePickerBusy = false;
      setCaptureLocked(captureBusy);
      if (!captureBusy) $("saveButton").disabled = false;
      await refreshState(false);
    }
  }

  async function startCapture() {
    if (captureBusy || filePickerBusy || mappingCapture) return;
    captureBusy = true;
    captureActive = false;
    captureCompleting = false;
    dirtyBeforeCapture = dirty;
    heldModifiers.clear();
    heldModifierCodes.clear();
    pendingStandaloneKey = null;
    $("captureTriggerButton").disabled = true;
    $("captureTriggerButton").textContent = "准备录入…";
    $("saveButton").disabled = true;
    setCaptureLocked(true);
    setMessage("正在暂时停用旧快捷键…");

    try {
      if (!runtimeConfigLoaded) {
        await refreshState(false);
        for (let attempt=0; !runtimeConfigLoaded && refreshPending && attempt<40; attempt++) await delay(50);
        if (!runtimeConfigLoaded) await refreshState(false);
      }
      if (!runtimeConfigLoaded) throw new Error("尚未读取到插件设置，请稍后重试。");
      savedRuntimeConfig = structuredClone(runtimeConfig);
      const stateResponse = await window.vokiePlugin.getState();
      const device = stateResponse.state?.extensions?.chromecastVoiceRemote?.device || {};
      captureCancelGeneration = Number(device.captureCancelGeneration) || 0;
      const suspended = structuredClone(savedRuntimeConfig);
      suspended.keyboardTrigger = {
        enabled:true,
        key:"Escape",
        modifiers:["command","option","control","shift","fn"],
        captureCancelOnly:true
      };
      await window.vokiePlugin.configure(suspended);
      // Wait for the native helper to confirm its Escape-only event tap before
      // presenting capture as ready. The web view listener remains a fallback.
      await delay(100);
      let nativeCancelReady = false;
      let nativeCancelPermissionRequired = false;
      let captureCancelConfigAccepted = false;
      let nativeCancelHelperConfigured = false;
      let nativeCancelError = "";
      for (let attempt = 0; attempt < 18 && !nativeCancelReady && !nativeCancelPermissionRequired; attempt++) {
        try {
          const captureState = await window.vokiePlugin.getState();
          const extension = captureState.state?.extensions?.chromecastVoiceRemote || {};
          const device = extension.device || {};
          const trigger = extension.config?.keyboardTrigger || {};
          nativeCancelReady = device.captureCancelReady === true;
          nativeCancelPermissionRequired = device.keyboardTrigger === "permission-required";
          nativeCancelHelperConfigured = device.captureCancelHelperConfigured === true;
          captureCancelConfigAccepted = trigger.captureCancelOnly === true ||
            (trigger.enabled === true && trigger.key === "Escape" &&
              ["command","option","control","shift","fn"].every(name => trigger.modifiers?.includes(name)) &&
              new Set(trigger.modifiers || []).size === 5);
          nativeCancelError = typeof extension.lastError === "string" ? extension.lastError : "";
        } catch {}
        if (!nativeCancelReady && !nativeCancelPermissionRequired) await delay(100);
      }

      captureActive = true;
      $("triggerCapture").classList.add("capturing");
      $("triggerCapture").value = "请按快捷键；按 Esc 取消…";
      $("captureTriggerButton").disabled = false;
      $("captureTriggerButton").textContent = "取消录入";
      window.addEventListener("keydown", onCaptureKeyDown, true);
      window.addEventListener("keyup", onCaptureKeyUp, true);
      $("triggerCapture").focus();
      captureCancelPollTimer = setInterval(() => { void pollNativeCaptureCancel(); }, 100);
      void pollNativeCaptureCancel();
      setMessage(nativeCancelReady
        ? "正在录入快捷键；系统级 Esc 监听已就绪。按 Esc 或点“取消录入”退出。"
        : nativeCancelPermissionRequired
          ? "系统未授予输入监控权限。请在“隐私与安全性 → 输入监控”允许 Vokie，然后重试；也可点“取消录入”退出。"
          : !captureCancelConfigAccepted
            ? "Vokie 未确认临时 Esc 监听设置；请点“取消录入”退出，并重新打开插件设置页后重试。"
            : !nativeCancelHelperConfigured
              ? "Vokie 已接收 Esc 监听设置，但辅助程序未确认；请点“取消录入”退出后重新启用插件。"
            : nativeCancelError
              ? `Esc 系统监听启动失败：${nativeCancelError}。请检查输入监控权限，或点“取消录入”退出。`
              : "Esc 系统监听尚未就绪；请点“取消录入”退出后重试，或检查输入监控权限。");
      captureTimer = setTimeout(() => {
        void finishCapture({message:"录入超时，旧快捷键已恢复。"});
      }, 30000);
    } catch (error) {
      const reason = error.message || String(error);
      if (savedRuntimeConfig) {
        try {
          await restoreRuntimeConfig();
        } catch (restoreError) {
          captureBusy = false;
          captureCompleting = false;
          savedRuntimeConfig = null;
          $("captureTriggerButton").disabled = false;
          $("captureTriggerButton").textContent = "录入快捷键";
          $("saveButton").disabled = false;
          setCaptureLocked(false);
          setMessage(`快捷键录入未启动：${reason}；恢复旧设置也失败：${restoreError.message || restoreError}`, true);
          return;
        }
      } else {
        captureBusy = false;
        captureCompleting = false;
        $("captureTriggerButton").disabled = false;
        $("captureTriggerButton").textContent = "录入快捷键";
        $("saveButton").disabled = false;
        setCaptureLocked(false);
      }
      setMessage(`快捷键录入未启动：${reason}`, true);
    }
  }

  $("captureTriggerButton").addEventListener("click", () => {
    if (captureActive) void finishCapture({message:"已取消录入，旧快捷键已恢复。"});
    else if (!captureBusy) void startCapture();
  });
  window.addEventListener("pagehide", () => {
    if (mappingCapture) {
      clearTimeout(mappingCaptureTimer);
      mappingCaptureTimer = null;
      window.removeEventListener("keydown", onMappingCaptureKeyDown, true);
      window.removeEventListener("keyup", onMappingCaptureKeyUp, true);
      mappingCapture = null;
    }
    // Best-effort protection if the plugin settings view is closed mid-capture.
    if (captureBusy && savedRuntimeConfig) {
      window.vokiePlugin.configure(savedRuntimeConfig).catch(() => {});
    }
  });

  buildControls();
  applyConfig(defaults);
  void refreshState().then(() => refreshAudioInputs());
  setInterval(() => refreshState(false), 6000);
})();
