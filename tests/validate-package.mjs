import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {spawnSync} from "node:child_process";
import {fileURLToPath} from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "vokie.plugin.json"), "utf8"));
assert.match(manifest.id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
assert.equal(manifest.apiVersion, "1");
assert.equal(manifest.version, "0.1.21");
assert.equal("runtime" in manifest.worker, false, "Vokie 1.6.0 drops worker.runtime while normalizing the manifest");
assert.deepEqual(manifest.platforms, ["darwin"]);
assert.ok(manifest.transports.includes("ble") && manifest.transports.includes("hid"));
assert.ok(manifest.permissions.includes("bluetooth") && manifest.permissions.includes("microphone") && manifest.permissions.includes("native-helper"));

const paths = [
  manifest.worker.entrypoint,
  manifest.ui.entrypoint,
  manifest.icon,
  "ui/index.js",
  "assets/vokie-plugin-sdk.js",
  "native/ATVVADPCM.h",
  "tests/adpcm-test.c",
  "assets/helper/ChromecastVoiceRemoteHelper.app/Contents/Info.plist",
  "assets/helper/ChromecastVoiceRemoteHelper.app/Contents/MacOS/ChromecastVoiceRemoteHelper"
];
for (const relative of paths) {
  const absolute = path.resolve(root, relative);
  assert.ok(absolute.startsWith(root + path.sep), relative + " escapes package");
  assert.ok(fs.existsSync(absolute), relative + " is missing");
}
const icon = fs.readFileSync(path.join(root, manifest.icon), "utf8");
assert.match(icon, /<svg[^>]*viewBox="0 0 128 128"/);
const html = fs.readFileSync(path.join(root, manifest.ui.entrypoint), "utf8");
assert.match(html, /vokie-plugin-sdk\.js/);
assert.match(html, /index\.js/);
assert.match(html, /id="appSwitcherNavigation"/);
assert.match(html, /id="appSwitcherRowTemplate"/);
assert.match(html, /id="voiceButtonRowTemplate"/);
assert.match(html, /Google 助理键（语音键）/);
assert.match(html, /固定功能：遥控器语音输入/);
assert.match(html, /\.mapping-detail \{ display:grid/);
assert.match(html, /mapping-detail \.check input\[type="checkbox"\]/);
assert.match(html, /mapping-detail \.mapping-focus-option \{ justify-self:stretch; width:100%; \}/);
assert.doesNotMatch(html, /遥控器语音键支持短按免提与长按松开发送；其他按键均可自定义/);
assert.match(html, /本插件电脑快捷键（免提，可使用遥控器麦克风）/);
assert.match(html, /关闭 Vokie 自带的“按住说话”和“免提”快捷键/);
assert.match(html, /其他快捷键无需修改/);
assert.match(html, /电脑快捷键仅支持免提/);
assert.match(html, /按一下开始输入，再按一下结束并转写/);
assert.match(html, /设置另一个与本插件不同的快捷键/);
assert.match(html, /使用 Mac 当前麦克风，不能调用遥控器麦克风/);
assert.doesNotMatch(html, /键盘快捷键.*长按/);
assert.doesNotMatch(html, /本插件仅用于 Vokie/);
assert.doesNotMatch(html, /感谢 Vokie 提供设备实验室/);
assert.doesNotMatch(html, /登录需要手机号/);
assert.match(html, /遥控器语音连接正常时使用遥控器麦克风/);
assert.match(html, /不可用时使用下方选择的 Mac 麦克风/);
assert.match(html, /id="fallbackAudioInput"/);
assert.match(html, /录音中按 Esc 可取消并舍弃本次内容/);
assert.match(html, /短按进入免提，再按一次结束；长按（≥0\.5 秒）松开后结束并转写/);
assert.match(html, /参考项目致谢/);
assert.match(html, /VincentKingHsu\/vRemoter/);
assert.match(html, /遥控器不可用时的 Mac 麦克风/);
assert.match(html, /id="hidEnabled"/);
assert.match(html, /summary>手动选择主键与修饰键/);
assert.doesNotMatch(html, /status-grid|runtimeStatus|bleStatus|hidStatus|刷新状态/);
const ui = fs.readFileSync(path.join(root, "ui/index.js"), "utf8");
assert.match(ui, /vokiePlugin\.getState/);
assert.match(ui, /vokiePlugin\.configure/);
assert.match(ui, /vokiePlugin\.getAudioInputs/);
assert.match(ui, /event\.code === "Escape"/);
assert.match(ui, /requestFilePicker/);
assert.match(ui, /openApp/);
assert.match(ui, /openAppFocus/);
assert.match(ui, /focusMainChatByButton/);
assert.match(ui, /picker\.value/);
assert.match(ui, /if \(bundleId === "com\.openai\.codex" \|\| bundleId === "com\.openai\.chatgpt"\)/);
assert.match(ui, /尝试聚焦聊天输入框/);
assert.match(ui, /openAppChatBar/); // Legacy settings are parsed for migration.
assert.doesNotMatch(ui, /唤出 ChatGPT 输入栏|chatBarByButton/);
assert.match(ui, /openFile/);
assert.match(ui, /appSwitcherNavigation: true/);
assert.match(ui, /keyboardTrigger: \{enabled: true, key: "Fn"/);
assert.match(ui, /button\.id === "05"\) rows\.append\(\$\("appSwitcherRowTemplate"\)/);
assert.match(ui, /button\.id === "0A"\) rows\.append\(\$\("voiceButtonRowTemplate"\)/);
assert.match(ui, /appSwitcherNavigation/);
assert.match(ui, /lockScreen/);
assert.match(ui, /输入字符串并发送 Enter/);
assert.match(ui, /输入要发送的字符串/);
assert.match(ui, /最多 128 个字符/);
assert.doesNotMatch(ui, /输入要发送的数字/);
assert.match(ui, /customTextByButton/);
assert.match(ui, /targetGroups/);
assert.match(ui, /normalizeMappingKey/);
assert.match(ui, /serializeMappingShortcut/);
assert.match(ui, /hidSource: \$\("hidEnabled"\)\.checked \? "iokit" : "disabled"/);
assert.match(ui, /control\.closest\("\[data-button-detail\]"\)/);
const worker = fs.readFileSync(path.join(root, manifest.worker.entrypoint), "utf8");
assert.match(worker, /^#!\/bin\/sh\n':' \/\/;/);
assert.ok((fs.statSync(path.join(root, manifest.worker.entrypoint)).mode & 0o111) !== 0, "worker entrypoint must be executable for Vokie's direct spawn path");
assert.match(worker, /plugin_hello/);
assert.doesNotMatch(worker, /from\s+["']electron["']/);
const info = fs.readFileSync(path.join(root, "assets/helper/ChromecastVoiceRemoteHelper.app/Contents/Info.plist"), "utf8");
assert.match(info, /NSBluetoothAlwaysUsageDescription/);
const helperSource = fs.readFileSync(path.join(root, "native/ChromecastVoiceRemoteHelper.m"), "utf8");
for (const key of ["LEFTCOMMAND", "RIGHTCOMMAND", "LEFTOPTION", "RIGHTOPTION", "LEFTCONTROL", "RIGHTCONTROL", "LEFTSHIFT", "RIGHTSHIFT", "FN"]) {
  assert.match(helperSource, new RegExp(`@"${key}"`), `native helper must map ${key}`);
}
assert.match(helperSource, /openApplicationAtURL/);
assert.doesNotMatch(helperSource, /AXUIElement|focusInputInApplication/);
assert.doesNotMatch(helperSource, /sendChatBarShortcutToApplication|openAppChatBar|postKeyCode:0x31 modifiers:@\[@"option"\]/);
assert.match(helperSource, /CGEventKeyboardSetUnicodeString\(event, 0, NULL\)/);
assert.match(helperSource, /\[self postKeyCode:0x3A keyDown:YES flags:optionFlags\]/);
assert.match(helperSource, /\[self postKeyCodeWithoutText:0x25 keyDown:YES flags:optionFlags\]/);
assert.match(helperSource, /\[self postKeyCodeWithoutText:0x25 keyDown:NO flags:optionFlags\]/);
assert.match(helperSource, /\[self postKeyCode:0x3A keyDown:NO flags:0\]/);
assert.match(helperSource, /\[self postOptionLShortcutWithoutText\]/);
assert.match(helperSource, /beginWithCompletionHandler/);
assert.match(helperSource, /beginAppSwitcherWithDirection/);
assert.match(helperSource, /Emit\(@"voice_release"/);
assert.match(helperSource, /Emit\(@"keyboard_trigger_down"/);
assert.match(helperSource, /Emit\(@"keyboard_trigger_up"/);
assert.match(helperSource, /self\.keyboardTriggerDown = YES;\s*Emit\(@"keyboard_trigger_down", @\{\}\);\s*return YES;/);
assert.match(helperSource, /appSwitcherLeft/);
assert.match(helperSource, /appSwitcherRight/);
assert.match(helperSource, /@"lockScreen": @\[@0x0C, @\[@"control", @"command"\]\]/);
assert.match(helperSource, /hasPrefix:@"shortcut:"/);
assert.match(helperSource, /didUpdateNotificationStateForCharacteristic/);
assert.match(helperSource, /requestCapabilitiesIfReady/);
assert.match(helperSource, /connectAttemptPending/);
assert.match(helperSource, /peripheral\.state == CBPeripheralStateConnected/);
assert.match(helperSource, /postStringAndEnter/);
assert.match(helperSource, /CGEventKeyboardSetUnicodeString/);
assert.match(helperSource, /self\.scanRetryCount = MIN/);
assert.match(helperSource, /reconnecting to the remote/);
assert.doesNotMatch(helperSource, /Could not reconnect after five attempts/);
assert.match(helperSource, /pendingMicrophoneOpen/);
const architectures = spawnSync("lipo", ["-archs", path.join(root, "assets/helper/ChromecastVoiceRemoteHelper.app/Contents/MacOS/ChromecastVoiceRemoteHelper")], {encoding:"utf8"});
assert.equal(architectures.status, 0, architectures.stderr);
assert.match(architectures.stdout, /arm64/);
assert.match(architectures.stdout, /x86_64/);
console.log("Package structure, direct-spawn Worker launcher, v1 manifest, paths, UI SDK, icon, Bluetooth usage declaration, and universal macOS helper: OK");
