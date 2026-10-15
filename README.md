# Vokie - Google TV 遥控器插件（增强版）

## 关于 Vokie

Vokie 是 AI 语音输入与会议转写助手，可将自然口述整理成可直接使用的文字，也支持会议转写、摘要和行动项。感谢 Vokie 提供“设备实验室”和设备插件扩展能力，让 Chromecast Voice Remote 能接入现有语音输入流程，而不必另做一款应用。我们也推荐有语音输入或外设扩展需求的用户了解 [Vokie 官网](https://vokie.com/)。

## 插件功能

1. 使用遥控器语音键控制 Vokie：短按开始免提，再按一次结束；长按说话，松开后结束并转写。
2. 可设置电脑快捷键启动语音输入（默认 Fn）。遥控器语音通道就绪时使用遥控器麦克风，否则使用设置中选定的 Mac 麦克风。
3. 语音键以外的遥控器按键可自定义为系统功能、键盘按键或组合键、打开 App 或文件，或输入自定义文字并发送 Enter。打开 ChatGPT 后可选尝试聚焦输入框。
4. 左右键可用于 macOS 应用切换器，浏览并选择已打开的 App；关闭此功能后可自定义左右键。

## 下载与安装

[下载 macOS 插件压缩包](https://github.com/intelKANG/vokie-google-tv-remote-enhanced/releases/latest/download/vokie-google-tv-remote-enhanced-0.1.20-macos.zip)

1. 下载并解压压缩包。
2. 在 Vokie“设置 → 设备实验室 → 添加更多设备”中，选择解压后包含 `vokie.plugin.json` 的文件夹。
3. 按系统提示授予所需权限，并在 Vokie 中启用插件。

## 使用须知

- 使用前请关闭 Vokie 自带的“按住说话”和“免提”快捷键。
- 如需使用 Vokie 自带的“按住说话”，请另设一个快捷键。该功能使用 Mac 麦克风，不能调用遥控器麦克风。
- 插件目前仅支持 macOS 和 Chromecast Voice Remote（VID `0x18D1`、PID `0x9450`）；Windows 暂不支持。
- 自定义文字会以明文保存在插件设置中，请勿用于敏感密码。

## 致谢与建议

感谢 [VincentKingHsu/vRemoter](https://github.com/VincentKingHsu/vRemoter) 对 Chromecast Voice Remote 和 ATVV 蓝牙语音协议的公开研究。本插件据此核对设备与协议信息；双方没有合作或隶属关系。

感谢 Vokie 对设备插件扩展能力的支持。根据我们的使用体验，Vokie 登录需要手机号；希望未来增加邮箱等免手机号登录方式，为用户提供更多选择。

## 免责声明

本插件不是 Google、Vokie 或 vRemoter 的官方产品，也不代表其支持或背书。插件按现状提供，请在使用前确认按键映射、权限和目标应用行为。
