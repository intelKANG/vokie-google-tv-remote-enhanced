# Vokie Google TV Remote Enhanced

Google TV 遥控器（增强插件）是一款可导入 Vokie 的 macOS 外接设备插件。它为 Google Chromecast Voice Remote 添加语音输入、遥控器按键映射和应用切换功能。

本插件只用于 Vokie 的“设置 → 设备实验室 → 添加更多设备”，目标设备限定为 Google Chromecast Voice Remote（USB VID `0x18D1`、PID `0x9450`）。其他 Chromecast / Google 遥控器没有在参考项目中验证，本插件也不声称支持它们。

## 功能介绍

- 使用遥控器语音键，或电脑键盘快捷键，开始与结束 Vokie 语音输入。
- 遥控器蓝牙语音通道可用时优先从遥控器收音；否则使用设置中选定的 Mac 麦克风。
- 为方向、确认、返回、Home、YouTube、电源、音量等实体按键配置系统操作、常用键盘键、组合键、App、文件或自定义字符串。
- 使用遥控器左右键选择后台 App；默认快捷键为已启用的 Fn 键，可在设置中更改。

## 安装与使用

1. 在 macOS“系统设置 → 蓝牙”中配对并连接 Chromecast Voice Remote。
2. 在 Vokie 中打开“设置 → 设备实验室 → 添加更多设备”，选择本插件文件夹。
3. 启用插件，按提示授予所需的蓝牙、输入监控和辅助功能权限。
4. 插件快捷键默认开启并设为 Fn。按一下开始、再按一下结束；长按不会改变操作。需要时可在设置页改键。
5. 首次使用电脑键盘快捷键或遥控器不可用时，请在插件设置中选择备用 Mac 麦克风，并允许 Vokie 访问麦克风。

### 语音输入须知

1. **使用前请关闭 Vokie 自带的“免提”快捷键。**如需用电脑键盘触发录音，请启用并设置本插件的快捷键。
2. 本插件键盘快捷键按一下开始、再按一下结束；长按不会改变操作。请勿将同一组合键同时绑定给 Vokie 自带的语音快捷键，以免 Vokie 同时收到两次录音请求。本插件会接管所设快捷键。
3. 遥控器蓝牙语音连接正常时，默认使用遥控器收音；未连接或语音通道不可用时，使用你在插件设置中选定的 Mac 麦克风。

电脑快捷键的初始设置为 Fn，并默认开启。升级时，插件会把旧的默认设置（关闭、F9）更新为 Fn；已自定义过的快捷键会保留。

## 已核对的接口

参考项目 [vRemoter](https://github.com/VincentKingHsu/vRemoter) 将 VID/PID `18D1:9450` 识别为 Chromecast Voice Remote，并分别使用：

- ATVV 蓝牙服务 `AB5E0001-5A21-4F05-BC7D-AF01F617B664` 及 command/audio/control 特征接收语音流；参考实现协商 ATVV 0.4 或 1.0，使用 ADPCM 8 kHz/16 kHz。
- macOS IOKit HID（report ID 1）读取实体方向键与功能键。参考代码指出语音键不是可靠的普通 HID 按键事件，语音手势应从 ATVV 控制流识别。
- BLE 候选同时要求 ATVV 服务和设备名包含 `Chromecast Remote`，对应参考项目的 BLE 名称筛选方式，避免把任意 ATVV 遥控器当作本型号。
- 在 macOS 上，系统会接管标准 BLE HID 服务；CoreBluetooth GATT 不一定能读到标准 HID report。因此本插件不把标准 HID GATT 当作实体按键回退；语音使用 CoreBluetooth ATVV，实体按键使用随包提供的 IOKit helper。

这些是基于参考实现的兼容性依据，不是 Google 官方规格保证。

## 按键操作

1. 使用前请关闭 Vokie 自带的“免提”快捷键。需要电脑键盘触发录音时，在插件设置中启用并设置快捷键。
2. 插件快捷键按一下开始、再按一下结束；长按不会改变操作。不要把同一快捷键同时绑定给 Vokie 自带的语音快捷键，否则两边可能同时申请录音。
3. 遥控器语音连接正常时，默认使用遥控器收音；遥控器未连接或语音通道不可用时，使用你在插件设置中选择的 Mac 麦克风。

- Google 助理键（语音键）：遥控器上带 Google 助理图标的按键。短按（小于 0.5 秒）进入免提模式，再按一次结束；长按至少 0.5 秒，松开后结束并转写。录音会话先请求 Vokie 接受；接受前收到的 PCM 只在内存中短暂缓冲，超限时丢弃最早音频。
- 键盘 Escape：录音进行时取消本次 Vokie 录音并舍弃已录内容，同时关闭遥控器 ATVV 麦克风流；其他时候，此录音取消功能不会拦截 Escape。快捷键录入期间 Escape 仍用于取消录入。录音取消通过 Vokie Plugin API 的 `session_cancel` 发送，不等同于正常停止并保留本次输入。
- Vokie 语音输入键盘快捷键：每次按下切换录音开始/结束，按住多久都不会改变此逻辑。遥控器语音通道就绪时使用遥控器麦克风；遥控器未连接或语音通道未就绪时，改用设置页中明确选定的 Mac 麦克风。每台 Mac 需在 Vokie 插件设置中选择并保存一次备用输入；插件会在每次备用录音前向 Vokie 核对该输入仍可用，不会默默改用列表中的其他麦克风。没有遥控器时，遥控器实体按键和语音键不能触发，但电脑键盘快捷键仍可使用备用麦克风。Vokie 需要获得 macOS 麦克风权限。录入成功会自动启用。支持单独的左/右 Command、Option、Control、Shift 和 Fn；字母和数字必须搭配至少一个修饰键，例如 Control+K，避免普通打字误触。录入时按 Escape 取消并恢复旧快捷键；若要把 Escape 本身设为触发键，请从主键列表选择。
- 返回键：默认取消当前录音并舍弃已录内容；可在按键映射中改选其他操作。
- Home：默认发送 macOS `Fn+F11` 显示桌面；可在按键映射中改选其他操作。
- 电源键：默认发送 macOS `Control+Command+Q` 锁定屏幕；映射仍可在设置页改成其他操作。Apple 将此组合键列为锁定屏幕快捷键（[Apple Support](https://support.apple.com/en-ie/102650)）。
- 确认键：默认向 Vokie 发送 `send_enter`；可在按键映射中改选其他操作。
- 所有可配置实体按键：共用同一套功能菜单，包含常用单键、常用组合键、Vokie 语音动作、系统音量、App、文件和字符串输入。A–Z、数字、F1–F12 等从“录入自定义键盘按键”直接录入，不单独铺在菜单中；支持单键、组合键及单独修饰键。自定义字符串最多 128 个字符，由插件的 macOS 原生辅助程序发送后再发送 Enter；字符串以明文保存在 Vokie 设置中，不支持换行或控制字符。文字通过 macOS Unicode 键盘事件输入，少数 App 可能忽略这类文字事件。打开文件会在设置页弹出 macOS 文件选择窗口，触发时由系统默认应用打开；文件被移动或删除后需要重新选择。App 列表扫描 macOS 的用户、系统、本地 Applications 和 CoreServices/Applications 目录，并通过 Launch Services 启动或切回所选 App。ChatGPT App 可额外选择发送 ⌥+L 尝试聚焦输入框；不同视图响应可能不同，需实际测试。⌥+Space 会打开 Chat Bar 并可开始新聊天，不用于聚焦当前对话。语音键本身通过 ATVV 工作，不在普通 HID 映射表内。
- macOS 应用切换器：可把任意可配置按键映射为“遥控器应用切换器”。按下后显示系统 `Command-Tab` 图标栏并保持选择状态；用遥控器左/右键移动高亮项，默认确认键切换到该 App，默认返回键取消。若更改确认/返回映射，按键会执行新映射并先退出当前切换器。30 秒无操作会自动取消以释放 Command。Apple 文档确认 App Switcher 支持在按住 Command 时用左右方向键浏览，并在释放 Command 后切换（[Apple Support](https://support.apple.com/en-au/guide/mac-help/mchlp2469/26/mac/26)）。
- 左右键直达模式：设置默认开启；开启后，第一次按左右键就会打开系统应用切换器并选取对应方向的相邻 App，之后继续按左右键移动；确认切换、返回或键盘 Escape 取消。启用期间 UI 会禁用左右键映射控件，Worker 也会优先接管左右键，不再向前台软件发送普通方向键；关闭即可恢复原来的方向键映射，仍可使用上面的单独打开按键方案。
- 蓝牙重连：遥控器断连后，插件会持续扫描并以最长 16 秒的间隔退避重试，不需要手动禁用/启用插件。每次重连都会清空旧 ATVV 能力状态；等音频和控制通知订阅就绪后再协商能力。连接尝试或 ATVV 协商超时会主动重置连接并重试，开麦请求会等协商完成后再发送。

## 安装与权限

1. 在 macOS 的“系统设置 → 蓝牙”中配对并连接该遥控器。
2. 在 Vokie 中打开“设置 → 设备实验室 → 添加更多设备”，选择本插件文件夹。
3. 启动插件后，按系统提示允许 Bluetooth、输入监控；若 macOS 阻止合成按键，再在“隐私与安全性 → 辅助功能”允许 Vokie/helper。
4. 在插件设置页等待 ATVV 显示“语音通道已就绪”；HID 的“已检测到遥控器”只表示 macOS 已匹配设备，按下实体按键后“最近收到”才会显示按键。若 ATVV 一直显示“正在查找遥控器语音通道”，说明实体按键通道可用但语音 GATT 通道仍未连接。

插件目前只声明支持 macOS（`darwin`），helper 已构建为 arm64 和 x86_64 通用二进制，最低系统版本设为 macOS 12。实体按键映射可切换为“关闭”；关闭后仍可使用 ATVV 语音连接，但不再读取遥控器的普通按键。

Vokie 1.6.0 的插件清单读取代码会丢弃 `worker.runtime`，随后直接启动 Worker 入口。为兼容此行为，入口同时是可执行的 macOS shell/JavaScript polyglot：先尝试用 Vokie 自带的 Node runtime（默认查找 `/Applications/Vokie.app` 或 `~/Applications/Vokie.app`），再回退到 `/opt/homebrew/bin/node` 或 `/usr/local/bin/node`。如果 Vokie 安装在自定义位置，可在启动 Vokie 前设置 `VOKIE_PLUGIN_HOST_EXECUTABLE` 指向其 `Contents/MacOS/Vokie`。导入器会保留入口文件的可执行权限；请从此文件夹导入。

## 验证范围与限制

- 本版的 16 项 Worker/音频检查通过；包结构检查和 Vokie v1 假 Host 握手检查通过。helper 已编译为 arm64 与 x86_64 通用二进制，并通过本机签名完整性检查。
- 本版尚未用真实遥控器与 Fn 实体键做端到端复测；左右键驱动 macOS 应用切换器的图标选择、确认和取消也需要在实际设备上验证。
- 全局键盘监听、文件选择、Launch Services 启动/激活已完成编译与接口检查；不同应用对输入和切换行为的响应可能不同。
- helper 使用本机 ad-hoc 签名，不是 Developer ID 签名，也未做公证。

## 版本记录

- `0.1.9` 将名称更新为“Google TV 遥控器（增强插件）”，并完善遥控器语音键的短按免提、再次按下结束和长按松开结束逻辑。
- `0.1.10` 默认开启“左右键选择应用”，并把该选项放在左右方向键前；在返回键与 Home 之间展示“Google 助理键（语音键）”说明。
- `0.1.11` 增加所选 Mac 麦克风备用输入；遥控器 ATVV 通道就绪时优先使用遥控器收音。
- `0.1.12` 将电脑快捷键设为按下切换开始/结束，按住不影响停止时机；当时按键事件会透传。
- `0.1.13` 补充关闭 Vokie 免提快捷键、键盘快捷键和收音来源说明。
- `0.1.14` 支持输入最多 128 个字符的自定义字符串并发送 Enter，可包含文字、空格和标点。
- `0.1.15` 默认启用 Fn 快捷键；由插件接管配置的快捷键，避免重复请求语音会话；将 `busy` 拒绝原因改为中文操作提示。
- `0.1.16` 补充对 Vokie 设备插件开放能力的介绍、推荐与感谢，并加入手机号登录门槛的改进建议。

## 故障排查

- **“Vokie 当前已有另一段语音输入正在进行” / `busy`：**Vokie 同一时间只接受一个语音会话。较早版本会把插件快捷键继续传给 Vokie；如果同一组合键也绑定了 Vokie 自带的语音快捷键，两边可能同时申请录音。本版由插件接管快捷键。若仍出现此提示，请先结束或取消其他正在进行的 Vokie 语音输入；插件不会自动重试，避免稍后意外开启录音。
- **键盘快捷键没有响应：**确认插件已启用，检查 macOS“隐私与安全性”中的辅助功能权限；首次使用备用麦克风时还需授予麦克风权限。

## 免责声明

本插件仅作为 Vokie 的外接设备插件使用，不是 Google、Vokie 或 vRemoter 的官方产品，也不代表这些项目的支持或背书。插件按现状提供，不保证在所有 macOS 设备、遥控器固件或应用中都能正常工作；使用者应自行确认权限、按键映射及目标应用行为。请勿将其用于紧急通信或其他必须保证可用的用途。

## 关于 Vokie

感谢 Vokie 提供“设备实验室”和设备插件扩展能力，让 Chromecast Voice Remote 可以接入 Vokie 现有的语音输入流程，而不必另做一款独立应用。我们认可这种开放方式，也推荐有桌面语音输入或外设扩展需求的用户了解 [Vokie 官网](https://vokie.com/)。

改进建议：以我们的使用体验，Vokie 登录需要手机号。希望未来提供邮箱等免手机号登录选项。将手机号设为必选门槛，会让不愿绑定或无法提供手机号的用户无法使用；开放的互联网产品也应给用户更多选择，降低使用门槛。

## 致谢

感谢 [VincentKingHsu/vRemoter](https://github.com/VincentKingHsu/vRemoter) 对 Chromecast Voice Remote 设备识别、ATVV 蓝牙语音服务及实体按键的公开研究资料。本插件据此核对设备和协议细节；vRemoter 项目采用 MIT License。此处致谢不代表双方存在合作或隶属关系。

## 参考资料

- [Vokie 官网](https://vokie.com/)
- [vRemoter README](https://github.com/VincentKingHsu/vRemoter/blob/main/README.md)
- [vRemoter MIT License](https://github.com/VincentKingHsu/vRemoter/blob/main/LICENSE)
- [Chromecast HID bridge](https://github.com/VincentKingHsu/vRemoter/blob/main/Sources/vRemote/ChromecastRemoteHIDBridge.swift)
- [ATVV protocol implementation](https://github.com/VincentKingHsu/vRemoter/blob/main/Sources/vRemote/ATVV/ATVVProtocol.swift)
- [Chromecast button definitions](https://github.com/VincentKingHsu/vRemoter/blob/main/Sources/vRemote/RemoteMappingSupport.swift)
