#import <Foundation/Foundation.h>
#import <AppKit/AppKit.h>
#import <CoreBluetooth/CoreBluetooth.h>
#import <CoreGraphics/CoreGraphics.h>
#import <IOKit/hid/IOHIDManager.h>
#import <IOKit/hid/IOHIDKeys.h>
#import <Carbon/Carbon.h>
#import "ATVVADPCM.h"
#import <unistd.h>

static NSString * const ATVVServiceUUID = @"AB5E0001-5A21-4F05-BC7D-AF01F617B664";
static NSString * const ATVVCommandUUID = @"AB5E0002-5A21-4F05-BC7D-AF01F617B664";
static NSString * const ATVVAudioUUID = @"AB5E0003-5A21-4F05-BC7D-AF01F617B664";
static NSString * const ATVVControlUUID = @"AB5E0004-5A21-4F05-BC7D-AF01F617B664";
static const int kRemoteVendorID = 0x18D1;
static const int kRemoteProductID = 0x9450;
static const int64_t kSyntheticKeyMarker = 0x564F4B4945;
static NSObject *gOutputLock;

@class RemoteHelper;

static void Emit(NSString *type, NSDictionary *fields) {
    if (!gOutputLock) gOutputLock = [NSObject new];
    NSMutableDictionary *object = fields ? [fields mutableCopy] : [NSMutableDictionary new];
    object[@"type"] = type;
    NSError *error = nil;
    NSData *json = [NSJSONSerialization dataWithJSONObject:object options:NSJSONWritingSortedKeys error:&error];
    if (!json) return;
    NSMutableData *line = [json mutableCopy];
    const uint8_t newline = '\n';
    [line appendBytes:&newline length:1];
    @synchronized (gOutputLock) {
        [[NSFileHandle fileHandleWithStandardOutput] writeData:line];
    }
}

static void Log(NSString *message) {
    NSData *data = [[message stringByAppendingString:@"\n"] dataUsingEncoding:NSUTF8StringEncoding];
    [[NSFileHandle fileHandleWithStandardError] writeData:data];
}

@interface RemoteHelper : NSObject <CBCentralManagerDelegate, CBPeripheralDelegate>
@property(nonatomic, strong) CBCentralManager *central;
@property(nonatomic, strong) CBPeripheral *peripheral;
@property(nonatomic, strong) CBCharacteristic *commandCharacteristic;
@property(nonatomic, strong) CBCharacteristic *audioCharacteristic;
@property(nonatomic, strong) CBCharacteristic *controlCharacteristic;
@property(nonatomic, strong) NSTimer *keepAliveTimer;
@property(nonatomic, strong) NSDictionary *keyboardConfig;
@property(nonatomic, strong) NSDictionary *buttonMappings;
@property(nonatomic, assign) IOHIDManagerRef hidManager;
@property(nonatomic, assign) CFMachPortRef eventTap;
@property(nonatomic, assign) CFRunLoopSourceRef eventTapSource;
@property(nonatomic, assign) NSInteger capsVersion;
@property(nonatomic, assign) NSInteger codec;
@property(nonatomic, assign) NSInteger frameSize;
@property(nonatomic, assign) uint8_t streamID;
@property(nonatomic, assign) uint16_t sequence;
@property(nonatomic, assign) NSInteger predictor;
@property(nonatomic, assign) NSInteger stepIndex;
@property(nonatomic, assign) BOOL isStreaming;
@property(nonatomic, assign) BOOL keepCaptureOpen;
@property(nonatomic, assign) BOOL voiceButtonPressed;
@property(nonatomic, assign) BOOL escapeCancelActive;
@property(nonatomic, assign) BOOL escapeCancelDown;
@property(nonatomic, assign) BOOL appSwitcherActive;
@property(nonatomic, assign) BOOL appSwitcherCommandDown;
@property(nonatomic, assign) BOOL appSwitcherEscapeDown;
@property(nonatomic, assign) NSUInteger appSwitcherGeneration;
@property(nonatomic, assign) BOOL keyboardTriggerDown;
@property(nonatomic, assign) BOOL keyboardModifierPhysicalDown;
@property(nonatomic, assign) BOOL filePickerOpen;
@property(nonatomic, assign) BOOL hasPendingSyncBeforeStart;
@property(nonatomic, assign) BOOL stopped;
@property(nonatomic, strong) NSString *lastUsage;
@property(nonatomic, assign) NSInteger scanRetryCount;
@property(nonatomic, assign) BOOL scanRetryScheduled;
@property(nonatomic, assign) BOOL audioNotificationReady;
@property(nonatomic, assign) BOOL controlNotificationReady;
@property(nonatomic, assign) BOOL capabilityRequestOutstanding;
@property(nonatomic, assign) BOOL pendingMicrophoneOpen;
@property(nonatomic, assign) NSUInteger capabilityHandshakeGeneration;
@property(nonatomic, assign) BOOL connectAttemptPending;
@property(nonatomic, assign) NSUInteger connectAttemptGeneration;
@property(nonatomic, strong) NSNumber *previous8kSample;

- (void)handleReportID:(uint32_t)reportID data:(NSData *)data;
- (BOOL)handleKeyboardType:(CGEventType)type event:(CGEventRef)event;
- (void)handleCommand:(NSDictionary *)message;
- (void)postTarget:(NSString *)target;
- (void)postStringAndEnter:(NSString *)text;
- (void)sendFocusMainChatShortcutToApplication:(NSString *)bundleId attempt:(NSUInteger)attempt;
- (void)postKeyCode:(uint16_t)keyCode modifiers:(NSArray<NSString *> *)modifiers;
- (void)postKeyCodeWithoutText:(uint16_t)keyCode keyDown:(BOOL)down flags:(CGEventFlags)flags;
- (void)postOptionLShortcutWithoutText;
- (void)postKeyCode:(uint16_t)keyCode keyDown:(BOOL)down flags:(CGEventFlags)flags;
- (void)beginAppSwitcher;
- (void)beginAppSwitcherWithDirection:(NSInteger)direction;
- (void)finishAppSwitcher:(BOOL)commit;
- (void)restartAppSwitcherTimeout;
- (void)chooseFileForButton:(NSString *)buttonId pickerId:(NSString *)pickerId;
- (NSArray<NSDictionary *> *)installedApplications;
- (void)resetATVVState;
- (void)requestCapabilitiesIfReady;
- (void)failCurrentPeripheral:(NSString *)message;
- (void)retryScan;
@end

static void HIDInputReportCallback(
    void *context, IOReturn result, void *sender, IOHIDReportType type,
    uint32_t reportID, uint8_t *report, CFIndex reportLength
) {
    if (!context || result != kIOReturnSuccess || reportLength <= 0) return;
    RemoteHelper *helper = (__bridge RemoteHelper *)context;
    [helper handleReportID:reportID data:[NSData dataWithBytes:report length:(NSUInteger)reportLength]];
}

static void HIDDeviceMatchedCallback(void *context, IOReturn result, void *sender, IOHIDDeviceRef device) {
    if (result == kIOReturnSuccess) {
        Emit(@"hid_connected", @{@"vendorId": @(kRemoteVendorID), @"productId": @(kRemoteProductID)});
    }
}

static void HIDDeviceRemovedCallback(void *context, IOReturn result, void *sender, IOHIDDeviceRef device) {
    Emit(@"hid_disconnected", @{});
}

static CGEventRef KeyboardEventCallback(
    CGEventTapProxy proxy, CGEventType type, CGEventRef event, void *refcon
) {
    if (!refcon) return event;
    RemoteHelper *helper = (__bridge RemoteHelper *)refcon;
    return [helper handleKeyboardType:type event:event] ? NULL : event;
}

@implementation RemoteHelper

- (instancetype)init {
    self = [super init];
    if (!self) return nil;
    _keyboardConfig = @{@"enabled": @YES, @"key": @"Fn", @"modifiers": @[], @"captureCancelOnly": @NO};
    _buttonMappings = @{};
    _central = [[CBCentralManager alloc] initWithDelegate:self queue:dispatch_get_main_queue()];
    [self startInputReader];
    Emit(@"helper_started", @{@"vendorId": @(kRemoteVendorID), @"productId": @(kRemoteProductID)});
    return self;
}

- (void)start {
    if (self.central.state == CBManagerStatePoweredOn) [self discoverRemote];
    Emit(@"applications", @{ @"applications": [self installedApplications] });
}

- (void)startInputReader {
    __weak RemoteHelper *weakSelf = self;
    dispatch_async(dispatch_get_global_queue(QOS_CLASS_USER_INITIATED, 0), ^{
        NSMutableData *buffer = [NSMutableData data];
        uint8_t chunk[2048];
        ssize_t count = 0;
        while ((count = read(STDIN_FILENO, chunk, sizeof(chunk))) > 0) {
            [buffer appendBytes:chunk length:(NSUInteger)count];
            uint8_t *bytes = (uint8_t *)buffer.mutableBytes;
            NSUInteger start = 0;
            for (NSUInteger i = 0; i < buffer.length; i++) {
                if (bytes[i] != '\n') continue;
                NSData *line = [buffer subdataWithRange:NSMakeRange(start, i - start)];
                start = i + 1;
                NSDictionary *message = [NSJSONSerialization JSONObjectWithData:line options:0 error:nil];
                if (![message isKindOfClass:[NSDictionary class]]) continue;
                dispatch_async(dispatch_get_main_queue(), ^{
                    [weakSelf handleCommand:message];
                });
            }
            if (start > 0) [buffer replaceBytesInRange:NSMakeRange(0, start) withBytes:NULL length:0];
        }
    });
}

- (void)handleCommand:(NSDictionary *)message {
    NSString *type = message[@"type"];
    if ([type isEqualToString:@"configure"]) {
        NSDictionary *config = message[@"config"];
        if (![config isKindOfClass:[NSDictionary class]]) return;
        NSDictionary *trigger = config[@"keyboardTrigger"];
        NSDictionary *mappings = config[@"buttonMappings"];
        NSString *hidSource = [config[@"hidSource"] isKindOfClass:[NSString class]] ? config[@"hidSource"] : @"iokit";
        if ([trigger isKindOfClass:[NSDictionary class]]) self.keyboardConfig = trigger;
        if ([mappings isKindOfClass:[NSDictionary class]]) self.buttonMappings = mappings;
        if ([hidSource isEqualToString:@"iokit"]) [self startHID];
        else [self stopHID];
        [self restartKeyboardTap];
        Emit(@"configured", @{@"captureCancelOnly": @([self.keyboardConfig[@"captureCancelOnly"] boolValue])});
    } else if ([type isEqualToString:@"ensure_capture"]) {
        self.keepCaptureOpen = YES;
        [self startKeepAliveTimer];
        if (!self.isStreaming) [self openMicrophone];
    } else if ([type isEqualToString:@"stop_capture"]) {
        self.keepCaptureOpen = NO;
        self.pendingMicrophoneOpen = NO;
        [self.keepAliveTimer invalidate];
        self.keepAliveTimer = nil;
        [self closeMicrophoneForcefully];
    } else if ([type isEqualToString:@"set_escape_cancel"]) {
        BOOL enabled = [message[@"enabled"] boolValue];
        if (self.escapeCancelActive != enabled) {
            self.escapeCancelActive = enabled;
            self.escapeCancelDown = NO;
            [self restartKeyboardTap];
        }
        if (!enabled) Emit(@"keyboard_escape_cancel_ready", @{@"enabled": @NO});
    } else if ([type isEqualToString:@"app_switcher_commit"]) {
        [self finishAppSwitcher:YES];
    } else if ([type isEqualToString:@"app_switcher_cancel"]) {
        [self finishAppSwitcher:NO];
    } else if ([type isEqualToString:@"post_key"]) {
        NSString *target = message[@"target"];
        if ([target isEqualToString:@"typeTextAndEnter"]) {
            NSString *text = message[@"text"];
            [self postStringAndEnter:[text isKindOfClass:[NSString class]] ? text : @""];
        } else if ([target isKindOfClass:[NSString class]]) [self postTarget:target];
        else if ([message[@"keyCode"] respondsToSelector:@selector(integerValue)]) {
            [self postKeyCode:[message[@"keyCode"] unsignedShortValue] modifiers:message[@"modifiers"] ?: @[]];
        }
    } else if ([type isEqualToString:@"choose_file"]) {
        NSString *buttonId = message[@"buttonId"];
        NSString *pickerId = message[@"pickerId"];
        if ([buttonId isKindOfClass:[NSString class]] && [pickerId isKindOfClass:[NSString class]]) {
            [self chooseFileForButton:buttonId pickerId:pickerId];
        }
    } else if ([type isEqualToString:@"shutdown"]) {
        [self shutdown];
    }
}

- (NSArray<NSDictionary *> *)installedApplications {
    NSMutableArray<NSURL *> *roots = [NSMutableArray new];
    for (NSString *path in NSSearchPathForDirectoriesInDomains(NSApplicationDirectory,
            NSLocalDomainMask | NSSystemDomainMask | NSUserDomainMask, YES)) {
        NSURL *url = [NSURL fileURLWithPath:path isDirectory:YES];
        if ([[NSFileManager defaultManager] fileExistsAtPath:url.path]) [roots addObject:url];
    }
    NSURL *coreServicesApps = [NSURL fileURLWithPath:@"/System/Library/CoreServices/Applications" isDirectory:YES];
    if ([[NSFileManager defaultManager] fileExistsAtPath:coreServicesApps.path]) [roots addObject:coreServicesApps];

    NSMutableDictionary<NSString *, NSDictionary *> *byBundleId = [NSMutableDictionary new];
    NSDirectoryEnumerationOptions options = NSDirectoryEnumerationSkipsHiddenFiles | NSDirectoryEnumerationSkipsPackageDescendants;
    for (NSURL *root in roots) {
        NSDirectoryEnumerator<NSURL *> *enumerator = [[NSFileManager defaultManager]
            enumeratorAtURL:root includingPropertiesForKeys:@[NSURLIsDirectoryKey]
            options:options errorHandler:^BOOL(NSURL *url, NSError *error) { return YES; }];
        for (NSURL *url in enumerator) {
            if ([url.pathExtension.lowercaseString isEqualToString:@"app"]) {
                NSBundle *bundle = [NSBundle bundleWithURL:url];
                NSDictionary *info = bundle.infoDictionary ?: @{};
                NSString *bundleId = [info[@"CFBundleIdentifier"] isKindOfClass:[NSString class]] ? info[@"CFBundleIdentifier"] : bundle.bundleIdentifier;
                if (bundleId.length > 0 && bundleId.length <= 255 &&
                    [bundleId rangeOfString:@"[^A-Za-z0-9.-]" options:NSRegularExpressionSearch].location == NSNotFound) {
                    NSString *name = [info[@"CFBundleDisplayName"] isKindOfClass:[NSString class]] ? info[@"CFBundleDisplayName"] : nil;
                    if (name.length == 0) name = [info[@"CFBundleName"] isKindOfClass:[NSString class]] ? info[@"CFBundleName"] : nil;
                    if (name.length == 0) name = url.lastPathComponent.stringByDeletingPathExtension;
                    if (!byBundleId[bundleId]) byBundleId[bundleId] = @{@"bundleId": bundleId, @"name": name};
                }
                [enumerator skipDescendants];
            } else if (enumerator.level >= 5) {
                [enumerator skipDescendants];
            }
        }
    }
    return [[byBundleId allValues] sortedArrayUsingComparator:^NSComparisonResult(NSDictionary *a, NSDictionary *b) {
        return [a[@"name"] localizedCaseInsensitiveCompare:b[@"name"]];
    }];
}

- (void)chooseFileForButton:(NSString *)buttonId pickerId:(NSString *)pickerId {
    if (self.filePickerOpen) {
        Emit(@"file_picker_error", @{@"buttonId": buttonId, @"pickerId": pickerId, @"message": @"已有一个文件选择窗口打开。"});
        return;
    }
    self.filePickerOpen = YES;
    NSOpenPanel *panel = [NSOpenPanel openPanel];
    panel.canChooseFiles = YES;
    panel.canChooseDirectories = NO;
    panel.allowsMultipleSelection = NO;
    panel.prompt = @"选择文件";
    panel.message = @"选择遥控器按键要打开的文件";
    [NSApp activateIgnoringOtherApps:YES];
    [panel beginWithCompletionHandler:^(NSModalResponse result) {
        self.filePickerOpen = NO;
        if (result == NSModalResponseOK && panel.URL.isFileURL) {
            Emit(@"file_selected", @{@"buttonId": buttonId, @"pickerId": pickerId,
                @"path": panel.URL.path ?: @"", @"name": panel.URL.lastPathComponent ?: @""});
        } else {
            Emit(@"file_picker_cancelled", @{@"buttonId": buttonId, @"pickerId": pickerId});
        }
    }];
}

- (void)startHID {
    if (self.hidManager) return;
    IOHIDManagerRef manager = IOHIDManagerCreate(kCFAllocatorDefault, kIOHIDOptionsTypeNone);
    NSDictionary *matching = @{
        [NSString stringWithUTF8String:kIOHIDVendorIDKey]: @(kRemoteVendorID),
        [NSString stringWithUTF8String:kIOHIDProductIDKey]: @(kRemoteProductID)
    };
    IOHIDManagerSetDeviceMatching(manager, (__bridge CFDictionaryRef)matching);
    void *context = (__bridge void *)self;
    IOHIDManagerRegisterDeviceMatchingCallback(manager, HIDDeviceMatchedCallback, context);
    IOHIDManagerRegisterDeviceRemovalCallback(manager, HIDDeviceRemovedCallback, context);
    IOHIDManagerRegisterInputReportCallback(manager, HIDInputReportCallback, context);
    IOHIDManagerScheduleWithRunLoop(manager, CFRunLoopGetMain(), kCFRunLoopCommonModes);
    IOReturn result = IOHIDManagerOpen(manager, kIOHIDOptionsTypeSeizeDevice);
    if (result == kIOReturnSuccess) {
        self.hidManager = manager;
        Emit(@"hid_listening", @{});
    } else {
        Log([NSString stringWithFormat:@"IOHIDManagerOpen failed: 0x%08X", (uint32_t)result]);
        Emit(@"permission_required", @{@"permission": @"input-monitoring"});
        IOHIDManagerUnscheduleFromRunLoop(manager, CFRunLoopGetMain(), kCFRunLoopCommonModes);
        CFRelease(manager);
    }
}

- (void)stopHID {
    if (!self.hidManager) return;
    IOHIDManagerUnscheduleFromRunLoop(self.hidManager, CFRunLoopGetMain(), kCFRunLoopCommonModes);
    IOHIDManagerClose(self.hidManager, kIOHIDOptionsTypeNone);
    CFRelease(self.hidManager);
    self.hidManager = NULL;
    self.lastUsage = nil;
    Emit(@"hid_disabled", @{});
}

- (void)handleReportID:(uint32_t)reportID data:(NSData *)data {
    if (reportID != 0x01 || data.length == 0) return;
    const uint8_t *bytes = data.bytes;
    NSUInteger offset = bytes[0] == (uint8_t)reportID ? 1 : 0;
    if (offset >= data.length) return;
    uint8_t usage = bytes[offset];
    if (usage == 0) {
        if (self.lastUsage) {
            Emit(@"button_up", @{@"buttonId": self.lastUsage});
            self.lastUsage = nil;
        }
        return;
    }
    NSString *buttonID = [NSString stringWithFormat:@"%02X", usage];
    if ([self.lastUsage isEqualToString:buttonID]) return;
    if (self.lastUsage) Emit(@"button_up", @{@"buttonId": self.lastUsage});
    self.lastUsage = buttonID;
    Emit(@"button_down", @{@"buttonId": buttonID});
}

- (void)centralManagerDidUpdateState:(CBCentralManager *)central {
    switch (central.state) {
        case CBManagerStatePoweredOn:
            Emit(@"bluetooth_ready", @{});
            [self discoverRemote];
            break;
        case CBManagerStateUnauthorized:
            Emit(@"permission_required", @{@"permission": @"bluetooth"});
            break;
        case CBManagerStatePoweredOff:
            [central stopScan];
            [self.keepAliveTimer invalidate];
            self.keepAliveTimer = nil;
            self.keepCaptureOpen = NO;
            [self resetATVVState];
            self.peripheral = nil;
            Emit(@"bluetooth_off", @{});
            break;
        case CBManagerStateUnsupported:
            Emit(@"unsupported_platform", @{});
            break;
        default:
            break;
    }
}

- (void)discoverRemote {
    if (self.stopped || self.central.state != CBManagerStatePoweredOn || self.peripheral) return;
    CBUUID *service = [CBUUID UUIDWithString:ATVVServiceUUID];
    NSArray<CBPeripheral *> *connected = [self.central retrieveConnectedPeripheralsWithServices:@[service]];
    for (CBPeripheral *candidate in connected) {
        if ([candidate.name localizedCaseInsensitiveContainsString:@"Chromecast Remote"]) {
            [self connectPeripheral:candidate];
            return;
        }
    }
    if (connected.count > 0) {
        Log(@"Found an ATVV device, but its name does not match Chromecast Remote.");
    }
    [self.central scanForPeripheralsWithServices:@[service] options:@{CBCentralManagerScanOptionAllowDuplicatesKey: @NO}];
    Emit(@"scanning", @{});
}

- (BOOL)isChromecastRemote:(CBPeripheral *)peripheral {
    return [peripheral.name localizedCaseInsensitiveContainsString:@"Chromecast Remote"];
}

- (void)centralManager:(CBCentralManager *)central didDiscoverPeripheral:(CBPeripheral *)peripheral
     advertisementData:(NSDictionary<NSString *,id> *)advertisementData RSSI:(NSNumber *)RSSI {
    NSString *advertisedName = [advertisementData[CBAdvertisementDataLocalNameKey] isKindOfClass:[NSString class]]
        ? advertisementData[CBAdvertisementDataLocalNameKey] : @"";
    BOOL matchesName = [self isChromecastRemote:peripheral] ||
        [advertisedName localizedCaseInsensitiveContainsString:@"Chromecast Remote"];
    if (self.stopped || self.peripheral || !matchesName) return;
    [central stopScan];
    [self connectPeripheral:peripheral];
}

- (void)resetATVVState {
    self.capabilityHandshakeGeneration++;
    self.connectAttemptGeneration++;
    self.connectAttemptPending = NO;
    self.capabilityRequestOutstanding = NO;
    self.audioNotificationReady = NO;
    self.controlNotificationReady = NO;
    self.commandCharacteristic = nil;
    self.audioCharacteristic = nil;
    self.controlCharacteristic = nil;
    self.capsVersion = 0;
    self.codec = 0;
    self.frameSize = 0;
    self.streamID = 0;
    self.sequence = 0;
    self.predictor = 0;
    self.stepIndex = 0;
    self.isStreaming = NO;
    self.voiceButtonPressed = NO;
    self.pendingMicrophoneOpen = NO;
    self.hasPendingSyncBeforeStart = NO;
    self.previous8kSample = nil;
}

- (void)connectPeripheral:(CBPeripheral *)peripheral {
    if (self.peripheral == peripheral) return;
    if (self.peripheral) [self.central cancelPeripheralConnection:self.peripheral];
    [self resetATVVState];
    self.peripheral = peripheral;
    peripheral.delegate = self;
    if (peripheral.state == CBPeripheralStateConnected) {
        self.connectAttemptPending = NO;
        self.connectAttemptGeneration++;
        self.scanRetryCount = 0;
        Emit(@"ble_connected", @{@"name": peripheral.name ?: @"Chromecast Voice Remote"});
        [peripheral discoverServices:@[[CBUUID UUIDWithString:ATVVServiceUUID]]];
        return;
    }
    self.connectAttemptPending = YES;
    NSUInteger generation = ++self.connectAttemptGeneration;
    [self.central connectPeripheral:peripheral options:nil];
    Emit(@"connecting", @{@"name": peripheral.name ?: @"Chromecast Voice Remote"});
    __weak RemoteHelper *weakSelf = self;
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(15 * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
        RemoteHelper *helper = weakSelf;
        if (!helper || helper.stopped || !helper.connectAttemptPending ||
            helper.connectAttemptGeneration != generation || helper.peripheral != peripheral) return;
        helper.connectAttemptPending = NO;
        Emit(@"device_error", @{@"message": @"Bluetooth connection timed out; retrying"});
        [helper.central cancelPeripheralConnection:peripheral];
        helper.peripheral = nil;
        [helper resetATVVState];
        [helper retryScan];
    });
}

- (void)centralManager:(CBCentralManager *)central didConnectPeripheral:(CBPeripheral *)peripheral {
    if (peripheral != self.peripheral || self.stopped) return;
    self.connectAttemptPending = NO;
    self.connectAttemptGeneration++;
    self.scanRetryCount = 0;
    Emit(@"ble_connected", @{@"name": peripheral.name ?: @"Chromecast Voice Remote"});
    [peripheral discoverServices:@[[CBUUID UUIDWithString:ATVVServiceUUID]]];
}

- (void)centralManager:(CBCentralManager *)central didFailToConnectPeripheral:(CBPeripheral *)peripheral
                 error:(NSError *)error {
    if (peripheral != self.peripheral) return;
    [self resetATVVState];
    Emit(@"device_error", @{@"message": error.localizedDescription ?: @"Bluetooth connection failed"});
    self.peripheral = nil;
    [self retryScan];
}

- (void)centralManager:(CBCentralManager *)central didDisconnectPeripheral:(CBPeripheral *)peripheral
                 error:(NSError *)error {
    if (peripheral != self.peripheral) return;
    [self.keepAliveTimer invalidate];
    self.keepAliveTimer = nil;
    self.keepCaptureOpen = NO;
    [self resetATVVState];
    self.peripheral = nil;
    Emit(@"ble_disconnected", @{@"message": error.localizedDescription ?: @""});
    if (!self.stopped) [self retryScan];
}

- (void)peripheral:(CBPeripheral *)peripheral didDiscoverServices:(NSError *)error {
    if (peripheral != self.peripheral) return;
    CBUUID *target = [CBUUID UUIDWithString:ATVVServiceUUID];
    CBService *service = nil;
    for (CBService *candidate in peripheral.services) {
        if ([candidate.UUID isEqual:target]) { service = candidate; break; }
    }
    if (error || !service) {
        [self failCurrentPeripheral:error.localizedDescription ?: @"ATVV service was not found after connection"];
        return;
    }
    [peripheral discoverCharacteristics:@[
        [CBUUID UUIDWithString:ATVVCommandUUID],
        [CBUUID UUIDWithString:ATVVAudioUUID],
        [CBUUID UUIDWithString:ATVVControlUUID]
    ] forService:service];
}

- (void)peripheral:(CBPeripheral *)peripheral didDiscoverCharacteristicsForService:(CBService *)service error:(NSError *)error {
    if (peripheral != self.peripheral) return;
    if (error) {
        [self failCurrentPeripheral:error.localizedDescription ?: @"ATVV characteristic discovery failed"];
        return;
    }
    for (CBCharacteristic *characteristic in service.characteristics) {
        NSString *uuid = characteristic.UUID.UUIDString.uppercaseString;
        if ([uuid isEqualToString:ATVVCommandUUID]) {
            self.commandCharacteristic = characteristic;
            if (characteristic.properties & (CBCharacteristicPropertyNotify | CBCharacteristicPropertyIndicate)) {
                [peripheral setNotifyValue:YES forCharacteristic:characteristic];
            }
        } else if ([uuid isEqualToString:ATVVAudioUUID]) {
            self.audioCharacteristic = characteristic;
            [peripheral setNotifyValue:YES forCharacteristic:characteristic];
        } else if ([uuid isEqualToString:ATVVControlUUID]) {
            self.controlCharacteristic = characteristic;
            [peripheral setNotifyValue:YES forCharacteristic:characteristic];
        }
    }
    if (!self.commandCharacteristic || !self.audioCharacteristic || !self.controlCharacteristic) {
        [self failCurrentPeripheral:@"ATVV command/audio/control characteristics are incomplete"];
        return;
    }
    self.audioNotificationReady = self.audioCharacteristic.isNotifying;
    self.controlNotificationReady = self.controlCharacteristic.isNotifying;
    NSUInteger generation = ++self.capabilityHandshakeGeneration;
    __weak RemoteHelper *weakSelf = self;
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(8 * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
        RemoteHelper *helper = weakSelf;
        if (!helper || helper.stopped || helper.capabilityHandshakeGeneration != generation || helper.capsVersion != 0) return;
        [helper failCurrentPeripheral:@"ATVV notifications or capability negotiation timed out; reconnecting to the remote"];
    });
    [self requestCapabilitiesIfReady];
}

- (void)peripheral:(CBPeripheral *)peripheral didUpdateNotificationStateForCharacteristic:(CBCharacteristic *)characteristic error:(NSError *)error {
    if (peripheral != self.peripheral) return;
    if (error) {
        [self failCurrentPeripheral:error.localizedDescription ?: @"ATVV notification setup failed"];
        return;
    }
    if (characteristic == self.audioCharacteristic) self.audioNotificationReady = characteristic.isNotifying;
    if (characteristic == self.controlCharacteristic) self.controlNotificationReady = characteristic.isNotifying;
    [self requestCapabilitiesIfReady];
}

- (void)requestCapabilitiesIfReady {
    if (self.stopped || self.capabilityRequestOutstanding || self.capsVersion != 0 ||
        !self.peripheral || !self.commandCharacteristic || !self.audioNotificationReady || !self.controlNotificationReady) return;
    self.capabilityRequestOutstanding = YES;
    [self writeCommand:[NSData dataWithBytes:(uint8_t[]){0x0A,0x01,0x00,0x00,0x03,0x03} length:6]];
}

- (void)failCurrentPeripheral:(NSString *)message {
    Emit(@"device_error", @{@"message": message ?: @"ATVV connection failed"});
    if (self.peripheral) [self.central cancelPeripheralConnection:self.peripheral];
    else [self retryScan];
}

- (void)peripheral:(CBPeripheral *)peripheral didUpdateValueForCharacteristic:(CBCharacteristic *)characteristic error:(NSError *)error {
    if (peripheral != self.peripheral) return;
    if (error || characteristic.value.length == 0) {
        if (error) Emit(@"device_error", @{@"message": error.localizedDescription ?: @"Bluetooth notification failed"});
        return;
    }
    NSString *uuid = characteristic.UUID.UUIDString.uppercaseString;
    if ([uuid isEqualToString:ATVVAudioUUID]) [self decodeAudio:characteristic.value];
    else [self handleControl:characteristic.value];
}

- (void)handleControl:(NSData *)data {
    if (data.length == 0) return;
    const uint8_t *b = data.bytes;
    switch (b[0]) {
        case 0x00: {
            self.isStreaming = NO;
            self.pendingMicrophoneOpen = NO;
            uint8_t reason = data.length > 1 ? b[1] : 0;
            if (self.voiceButtonPressed) {
                self.voiceButtonPressed = NO;
                Emit(@"voice_release", @{@"reason": @(reason)});
            }
            Emit(@"audio_stop", @{@"reason": @(reason)});
            if (self.keepCaptureOpen) [self openMicrophone];
            break;
        }
        case 0x04: {
            if (data.length < 2) return;
            uint8_t reason = b[1];
            if (self.capsVersion == 0x0100 && data.length >= 4) {
                self.codec = b[2];
                self.streamID = b[3];
            }
            self.isStreaming = YES;
            if (self.keepCaptureOpen) [self startKeepAliveTimer];
            if (!self.hasPendingSyncBeforeStart) {
                self.sequence = 0;
                self.predictor = 0;
                self.stepIndex = 0;
            }
            self.hasPendingSyncBeforeStart = NO;
            self.previous8kSample = nil;
            if (reason == 0x03) {
                self.voiceButtonPressed = YES;
                Emit(@"voice_press", @{@"reason": @(reason)});
            }
            Emit(@"audio_start", @{
                @"reason": @(reason),
                @"streamId": @(self.streamID),
                @"sampleRate": @(self.codec == 0x02 ? 16000 : 8000)
            });
            break;
        }
        case 0x08:
            Emit(@"start_search", @{});
            if (!self.isStreaming) [self openMicrophone];
            break;
        case 0x0A:
            if (self.capsVersion == 0x0100 && data.length >= 7) {
                self.codec = b[1];
                self.sequence = (uint16_t)b[2] << 8 | b[3];
                self.predictor = (int16_t)((uint16_t)b[4] << 8 | b[5]);
                self.stepIndex = MIN(88, b[6]);
                self.hasPendingSyncBeforeStart = !self.isStreaming;
                self.previous8kSample = nil;
                Emit(@"audio_sync", @{@"sequence": @(self.sequence), @"sampleRate": @(self.codec == 0x02 ? 16000 : 8000)});
            }
            break;
        case 0x0B:
            [self parseCapabilities:data];
            break;
        case 0x0C: {
            NSUInteger code = data.length >= 3 ? ((NSUInteger)b[1] << 8) | b[2] : 65535;
            Emit(@"mic_open_error", @{@"code": @(code)});
            break;
        }
        default:
            break;
    }
}

- (void)parseCapabilities:(NSData *)data {
    if (data.length < 3) return;
    const uint8_t *b = data.bytes;
    uint16_t version = (uint16_t)b[1] << 8 | b[2];
    uint8_t codecs = 0;
    if (version == 0x0004 && data.length >= 9) {
        self.capsVersion = 0x0004;
        codecs = b[4];
        self.frameSize = (uint16_t)b[5] << 8 | b[6];
    } else if (version == 0x0100 && data.length >= 7) {
        self.capsVersion = 0x0100;
        codecs = b[3];
        self.frameSize = (uint16_t)b[5] << 8 | b[6];
    } else {
        [self failCurrentPeripheral:@"Unsupported ATVV protocol version"];
        return;
    }
    if (codecs & 0x02) self.codec = 0x02;
    else if (codecs & 0x01) self.codec = 0x01;
    else {
        self.capsVersion = 0;
        [self failCurrentPeripheral:@"Remote does not advertise supported ADPCM codecs"];
        return;
    }
    self.predictor = 0;
    self.stepIndex = 0;
    self.sequence = 0;
    self.capabilityRequestOutstanding = NO;
    self.capabilityHandshakeGeneration++;
    Emit(@"device_ready", @{
        @"protocolVersion": self.capsVersion == 0x0100 ? @"1.0" : @"0.4",
        @"sampleRate": @(self.codec == 0x02 ? 16000 : 8000),
        @"frameSize": @(self.frameSize)
    });
    if (self.pendingMicrophoneOpen || self.keepCaptureOpen) [self openMicrophone];
}

- (NSArray<NSNumber *> *)decodeBytes:(NSData *)data {
    NSMutableArray<NSNumber *> *output = [NSMutableArray arrayWithCapacity:data.length * 2];
    const uint8_t *bytes = data.bytes;
    ATVVADPCMState state = {(int32_t)self.predictor, (int)self.stepIndex};
    for (NSUInteger i = 0; i < data.length; i++) {
        [output addObject:@(ATVVADPCMDecodeNibble((bytes[i] >> 4) & 0x0F, &state))];
        [output addObject:@(ATVVADPCMDecodeNibble(bytes[i] & 0x0F, &state))];
    }
    self.predictor = state.predictor;
    self.stepIndex = state.stepIndex;
    return output;
}

- (void)decodeAudio:(NSData *)data {
    if (!self.isStreaming || self.codec == 0) return;
    NSArray<NSNumber *> *samples = nil;
    uint16_t frameSequence = self.sequence;
    if (self.capsVersion == 0x0004) {
        if (data.length != self.frameSize || data.length < 6) return;
        const uint8_t *b = data.bytes;
        frameSequence = (uint16_t)b[0] << 8 | b[1];
        self.predictor = (int16_t)((uint16_t)b[3] << 8 | b[4]);
        self.stepIndex = MIN(88, b[5]);
        NSMutableArray<NSNumber *> *frame = [NSMutableArray arrayWithObject:@((int16_t)self.predictor)];
        NSData *payload = [data subdataWithRange:NSMakeRange(6, data.length - 6)];
        [frame addObjectsFromArray:[self decodeBytes:payload]];
        samples = frame;
    } else {
        samples = [self decodeBytes:data];
        self.sequence++;
    }
    [self emitPCMSamples:samples sequence:frameSequence inputRate:(self.codec == 0x02 ? 16000 : 8000)];
}

- (void)emitPCMSamples:(NSArray<NSNumber *> *)samples sequence:(uint16_t)sequence inputRate:(NSInteger)inputRate {
    if (samples.count == 0) return;
    NSMutableArray<NSNumber *> *output = [NSMutableArray arrayWithCapacity:inputRate == 8000 ? samples.count * 2 : samples.count];
    if (inputRate == 16000) {
        [output addObjectsFromArray:samples];
    } else {
        NSMutableData *inputData = [NSMutableData dataWithLength:samples.count * sizeof(int16_t)];
        int16_t *input = inputData.mutableBytes;
        for (NSUInteger i = 0; i < samples.count; i++) input[i] = (int16_t)samples[i].shortValue;
        NSMutableData *outputData = [NSMutableData dataWithLength:samples.count * 2 * sizeof(int16_t)];
        int16_t previous = self.previous8kSample ? self.previous8kSample.shortValue : 0;
        bool hasPrevious = self.previous8kSample != nil;
        size_t outputCount = ATVVUpsampleLinear8k(input, samples.count, outputData.mutableBytes, &previous, &hasPrevious);
        self.previous8kSample = hasPrevious ? @(previous) : nil;
        const int16_t *upsampled = outputData.bytes;
        for (size_t i = 0; i < outputCount; i++) [output addObject:@(upsampled[i])];
    }
    NSMutableData *pcm = [NSMutableData dataWithLength:output.count * 2];
    uint8_t *bytes = pcm.mutableBytes;
    for (NSUInteger i = 0; i < output.count; i++) {
        uint16_t bits = (uint16_t)(int16_t)output[i].shortValue;
        bytes[i * 2] = (uint8_t)(bits & 0xFF);
        bytes[i * 2 + 1] = (uint8_t)((bits >> 8) & 0xFF);
    }
    Emit(@"audio_frame", @{
        @"sequence": @(sequence),
        @"sampleRate": @16000,
        @"pcmBase64": [pcm base64EncodedStringWithOptions:0]
    });
}

- (void)openMicrophone {
    if (!self.commandCharacteristic || !self.peripheral || self.capsVersion == 0 || self.codec == 0) {
        self.pendingMicrophoneOpen = YES;
        Log(@"ATVV microphone request deferred until capability negotiation completes.");
        return;
    }
    if (self.isStreaming) return;
    self.pendingMicrophoneOpen = NO;
    self.predictor = 0;
    self.stepIndex = 0;
    self.sequence = 0;
    self.previous8kSample = nil;
    uint8_t bytesV04[] = {0x0C, 0x00, (uint8_t)self.codec};
    uint8_t bytesV10[] = {0x0C, 0x00};
    NSData *command = self.capsVersion == 0x0004
        ? [NSData dataWithBytes:bytesV04 length:sizeof(bytesV04)]
        : [NSData dataWithBytes:bytesV10 length:sizeof(bytesV10)];
    [self writeCommand:command];
    Emit(@"mic_open_requested", @{});
}

- (void)closeMicrophoneForcefully {
    self.pendingMicrophoneOpen = NO;
    if (!self.commandCharacteristic) return;
    uint8_t bytesV04[] = {0x0D};
    uint8_t bytesV10[] = {0x0D, self.streamID};
    NSData *command = self.capsVersion == 0x0004
        ? [NSData dataWithBytes:bytesV04 length:sizeof(bytesV04)]
        : [NSData dataWithBytes:bytesV10 length:sizeof(bytesV10)];
    [self writeCommand:command];
    self.isStreaming = NO;
    Emit(@"mic_close_requested", @{});
}

- (void)writeCommand:(NSData *)data {
    if (!self.peripheral || !self.commandCharacteristic) return;
    CBCharacteristicWriteType type = (self.commandCharacteristic.properties & CBCharacteristicPropertyWrite)
        ? CBCharacteristicWriteWithResponse
        : CBCharacteristicWriteWithoutResponse;
    [self.peripheral writeValue:data forCharacteristic:self.commandCharacteristic type:type];
}

- (void)startKeepAliveTimer {
    if (self.keepAliveTimer) return;
    __weak RemoteHelper *weakSelf = self;
    self.keepAliveTimer = [NSTimer scheduledTimerWithTimeInterval:4.0 repeats:YES block:^(NSTimer *timer) {
        RemoteHelper *helper = weakSelf;
        if (!helper.keepCaptureOpen || !helper.isStreaming || helper.capsVersion == 0) return;
        if (helper.capsVersion == 0x0004) {
            uint8_t b[] = {0x0C, 0x00, (uint8_t)helper.codec};
            [helper writeCommand:[NSData dataWithBytes:b length:sizeof(b)]];
        } else {
            uint8_t b[] = {0x0E, helper.streamID};
            [helper writeCommand:[NSData dataWithBytes:b length:sizeof(b)]];
        }
    }];
}

- (void)retryScan {
    if (self.stopped || self.central.state != CBManagerStatePoweredOn || self.scanRetryScheduled) return;
    self.scanRetryCount = MIN(self.scanRetryCount + 1, 5);
    NSTimeInterval delay = MIN(16.0, pow(2.0, self.scanRetryCount - 1));
    self.scanRetryScheduled = YES;
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(delay * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
        self.scanRetryScheduled = NO;
        if (!self.stopped && self.central.state == CBManagerStatePoweredOn) [self discoverRemote];
    });
}

- (uint16_t)keyCodeForName:(NSString *)name {
    NSString *upper = name.uppercaseString;
    NSDictionary<NSString *, NSNumber *> *functions = @{
        @"F1": @0x7A, @"F2": @0x78, @"F3": @0x63, @"F4": @0x76,
        @"F5": @0x60, @"F6": @0x61, @"F7": @0x62, @"F8": @0x64,
        @"F9": @0x65, @"F10": @0x6D, @"F11": @0x67, @"F12": @0x6F
    };
    if (functions[upper]) return functions[upper].unsignedShortValue;
    NSDictionary<NSString *, NSNumber *> *letters = @{
        @"A": @0x00, @"B": @0x0B, @"C": @0x08, @"D": @0x02, @"E": @0x0E,
        @"F": @0x03, @"G": @0x05, @"H": @0x04, @"I": @0x22, @"J": @0x26,
        @"K": @0x28, @"L": @0x25, @"M": @0x2E, @"N": @0x2D, @"O": @0x1F,
        @"P": @0x23, @"Q": @0x0C, @"R": @0x0F, @"S": @0x01, @"T": @0x11,
        @"U": @0x20, @"V": @0x09, @"W": @0x0D, @"X": @0x07, @"Y": @0x10, @"Z": @0x06
    };
    if (letters[upper]) return letters[upper].unsignedShortValue;
    NSDictionary<NSString *, NSNumber *> *digits = @{
        @"0": @0x1D, @"1": @0x12, @"2": @0x13, @"3": @0x14, @"4": @0x15,
        @"5": @0x17, @"6": @0x16, @"7": @0x1A, @"8": @0x1C, @"9": @0x19
    };
    if (digits[upper]) return digits[upper].unsignedShortValue;
    NSDictionary<NSString *, NSNumber *> *other = @{
        @"SPACE": @0x31, @"RETURN": @0x24, @"ESCAPE": @0x35,
        @"TAB": @0x30, @"BACKSPACE": @0x33, @"FORWARDDELETE": @0x75,
        @"HOME": @0x73, @"END": @0x77, @"PAGEUP": @0x74, @"PAGEDOWN": @0x79,
        @"ARROWUP": @0x7E, @"ARROWDOWN": @0x7D, @"ARROWLEFT": @0x7B, @"ARROWRIGHT": @0x7C,
        @"LEFTCOMMAND": @0x37, @"RIGHTCOMMAND": @0x36,
        @"LEFTOPTION": @0x3A, @"RIGHTOPTION": @0x3D,
        @"LEFTCONTROL": @0x3B, @"RIGHTCONTROL": @0x3E,
        @"LEFTSHIFT": @0x38, @"RIGHTSHIFT": @0x3C,
        @"FN": @0x3F
    };
    return other[upper] ? other[upper].unsignedShortValue : UINT16_MAX;
}

- (BOOL)isModifierTriggerKey:(NSString *)key {
    static NSSet<NSString *> *modifierKeys;
    static dispatch_once_t onceToken;
    dispatch_once(&onceToken, ^{
        modifierKeys = [NSSet setWithArray:@[
            @"LeftCommand", @"RightCommand", @"LeftOption", @"RightOption",
            @"LeftControl", @"RightControl", @"LeftShift", @"RightShift", @"Fn"
        ]];
    });
    return [modifierKeys containsObject:key];
}

- (CGEventFlags)flagsForModifiers:(NSArray<NSString *> *)modifiers {
    CGEventFlags flags = 0;
    for (NSString *name in modifiers) {
        NSString *modifier = name.lowercaseString;
        if ([modifier isEqualToString:@"command"] || [modifier isEqualToString:@"cmd"]) flags |= kCGEventFlagMaskCommand;
        else if ([modifier isEqualToString:@"option"] || [modifier isEqualToString:@"alt"]) flags |= kCGEventFlagMaskAlternate;
        else if ([modifier isEqualToString:@"control"] || [modifier isEqualToString:@"ctrl"]) flags |= kCGEventFlagMaskControl;
        else if ([modifier isEqualToString:@"shift"]) flags |= kCGEventFlagMaskShift;
        else if ([modifier isEqualToString:@"fn"]) flags |= kCGEventFlagMaskSecondaryFn;
    }
    return flags;
}

- (void)restartKeyboardTap {
    if (self.keyboardTriggerDown) Emit(@"keyboard_trigger_up", @{});
    if (self.eventTap) CGEventTapEnable(self.eventTap, false);
    if (self.eventTapSource) CFRunLoopRemoveSource(CFRunLoopGetMain(), self.eventTapSource, kCFRunLoopCommonModes);
    if (self.eventTapSource) CFRelease(self.eventTapSource);
    if (self.eventTap) CFRelease(self.eventTap);
    self.eventTapSource = NULL;
    self.eventTap = NULL;
    self.keyboardTriggerDown = NO;
    self.keyboardModifierPhysicalDown = NO;
    self.escapeCancelDown = NO;
    BOOL captureCancelOnly = [self.keyboardConfig[@"captureCancelOnly"] boolValue];
    BOOL keyboardTriggerEnabled = [self.keyboardConfig[@"enabled"] boolValue];
    BOOL listenConfiguredTrigger = keyboardTriggerEnabled || captureCancelOnly;
    if (!listenConfiguredTrigger && !self.escapeCancelActive && !self.appSwitcherActive) return;
    NSString *key = captureCancelOnly ? @"Escape" : (self.keyboardConfig[@"key"] ?: @"Fn");
    if (listenConfiguredTrigger && [self keyCodeForName:key] == UINT16_MAX) {
        Emit(@"keyboard_trigger_error", @{@"message": @"Unsupported keyboard shortcut key"});
        return;
    }
    CGEventMask mask = CGEventMaskBit(kCGEventKeyDown)
        | CGEventMaskBit(kCGEventKeyUp)
        | CGEventMaskBit(kCGEventFlagsChanged);
    self.eventTap = CGEventTapCreate(
        kCGSessionEventTap, kCGHeadInsertEventTap, kCGEventTapOptionDefault,
        mask, KeyboardEventCallback, (__bridge void *)self
    );
    if (!self.eventTap) {
        NSString *source = self.appSwitcherActive ? @"app-switcher" :
            self.escapeCancelActive ? @"escape-cancel" : @"keyboard-trigger";
        Emit(@"permission_required", @{
            @"permission": @"accessibility",
            @"source": source,
            @"message": @"Allow Vokie or its plugin helper in System Settings > Privacy & Security > Accessibility to use global keyboard controls."
        });
        return;
    }
    self.eventTapSource = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, self.eventTap, 0);
    if (self.eventTapSource) {
        CFRunLoopAddSource(CFRunLoopGetMain(), self.eventTapSource, kCFRunLoopCommonModes);
        CGEventTapEnable(self.eventTap, true);
        if (listenConfiguredTrigger) {
            Emit(@"keyboard_trigger_ready", @{@"key": key, @"captureCancelOnly": @(captureCancelOnly)});
        }
        if (self.escapeCancelActive) Emit(@"keyboard_escape_cancel_ready", @{@"enabled": @YES});
    }
}

- (BOOL)handleKeyboardType:(CGEventType)type event:(CGEventRef)event {
    if (CGEventGetIntegerValueField(event, kCGEventSourceUserData) == kSyntheticKeyMarker) return NO;
    if (type == kCGEventTapDisabledByTimeout || type == kCGEventTapDisabledByUserInput) {
        if (self.keyboardTriggerDown) Emit(@"keyboard_trigger_up", @{});
        self.keyboardTriggerDown = NO;
        self.escapeCancelDown = NO;
        NSString *configuredKey = self.keyboardConfig[@"key"] ?: @"Fn";
        self.keyboardModifierPhysicalDown = [self isModifierTriggerKey:configuredKey] &&
            CGEventSourceKeyState(kCGEventSourceStateCombinedSessionState, (CGKeyCode)[self keyCodeForName:configuredKey]);
        if (self.eventTap) CGEventTapEnable(self.eventTap, true);
        return NO;
    }
    uint16_t eventKeyCode = (uint16_t)CGEventGetIntegerValueField(event, kCGKeyboardEventKeycode);
    uint16_t escapeKeyCode = [self keyCodeForName:@"Escape"];
    if (self.appSwitcherEscapeDown && type == kCGEventKeyUp && eventKeyCode == escapeKeyCode) {
        self.appSwitcherEscapeDown = NO;
        return YES;
    }
    if (self.appSwitcherActive && eventKeyCode == escapeKeyCode) {
        if (type == kCGEventKeyDown) {
            if (!self.appSwitcherEscapeDown) {
                self.appSwitcherEscapeDown = YES;
                [self finishAppSwitcher:NO];
            }
            return YES;
        }
        if (type == kCGEventKeyUp) {
            BOOL consumeRelease = self.appSwitcherEscapeDown;
            self.appSwitcherEscapeDown = NO;
            return consumeRelease;
        }
    }
    if (self.escapeCancelActive &&
        eventKeyCode == escapeKeyCode) {
        if (type == kCGEventKeyDown) {
            if (!self.escapeCancelDown) {
                self.escapeCancelDown = YES;
                Emit(@"keyboard_cancel_session", @{});
            }
            return YES;
        }
        if (type == kCGEventKeyUp) {
            BOOL consumeRelease = self.escapeCancelDown;
            self.escapeCancelDown = NO;
            return consumeRelease;
        }
    }
    if ([self.keyboardConfig[@"captureCancelOnly"] boolValue]) {
        if (CGEventGetIntegerValueField(event, kCGKeyboardEventKeycode) != [self keyCodeForName:@"Escape"]) return NO;
        if (type == kCGEventKeyDown) {
            if (!self.keyboardTriggerDown) {
                self.keyboardTriggerDown = YES;
                Emit(@"keyboard_capture_cancel", @{});
            }
            return YES;
        }
        if (type == kCGEventKeyUp) {
            BOOL consumeRelease = self.keyboardTriggerDown;
            self.keyboardTriggerDown = NO;
            return consumeRelease;
        }
        return NO;
    }
    if (![self.keyboardConfig[@"enabled"] boolValue]) return NO;
    NSString *key = self.keyboardConfig[@"key"] ?: @"Fn";
    uint16_t code = [self keyCodeForName:key];
    if (code == UINT16_MAX || CGEventGetIntegerValueField(event, kCGKeyboardEventKeycode) != code) return NO;
    if ([self isModifierTriggerKey:key]) {
        if (type != kCGEventFlagsChanged) return NO;
        BOOL isDown = CGEventSourceKeyState(kCGEventSourceStateCombinedSessionState, (CGKeyCode)code);
        if (isDown == self.keyboardModifierPhysicalDown) return NO;
        self.keyboardModifierPhysicalDown = isDown;
        if (!isDown) {
            BOOL consumeRelease = self.keyboardTriggerDown;
            if (consumeRelease) Emit(@"keyboard_trigger_up", @{});
            self.keyboardTriggerDown = NO;
            return consumeRelease;
        }
        self.keyboardTriggerDown = YES;
        Emit(@"keyboard_trigger_down", @{});
        return YES;
    }
    if (type == kCGEventKeyUp) {
        BOOL consumeRelease = self.keyboardTriggerDown;
        if (consumeRelease) Emit(@"keyboard_trigger_up", @{});
        self.keyboardTriggerDown = NO;
        return consumeRelease;
    }
    if (type != kCGEventKeyDown) return NO;
    NSArray<NSString *> *modifiers = self.keyboardConfig[@"modifiers"] ?: @[];
    CGEventFlags expected = [self flagsForModifiers:modifiers];
    CGEventFlags actual = CGEventGetFlags(event);
    if (expected != 0 && (actual & expected) != expected) return NO;
    if (self.keyboardTriggerDown) return YES;
    self.keyboardTriggerDown = YES;
    Emit(@"keyboard_trigger_down", @{});
    return YES;
}

- (void)postKeyCode:(uint16_t)keyCode keyDown:(BOOL)down flags:(CGEventFlags)flags {
    CGEventRef event = CGEventCreateKeyboardEvent(NULL, (CGKeyCode)keyCode, down);
    if (!event) return;
    CGEventSetFlags(event, flags);
    CGEventSetIntegerValueField(event, kCGEventSourceUserData, kSyntheticKeyMarker);
    CGEventPost(kCGHIDEventTap, event);
    CFRelease(event);
}

- (void)postKeyCode:(uint16_t)keyCode modifiers:(NSArray<NSString *> *)modifiers {
    CGEventFlags flags = [self flagsForModifiers:modifiers];
    for (NSNumber *down in @[@YES, @NO]) {
        [self postKeyCode:keyCode keyDown:down.boolValue flags:flags];
    }
}

- (void)postKeyCodeWithoutText:(uint16_t)keyCode keyDown:(BOOL)down flags:(CGEventFlags)flags {
    CGEventRef event = CGEventCreateKeyboardEvent(NULL, (CGKeyCode)keyCode, down);
    if (!event) return;
    CGEventSetFlags(event, flags);
    // Keep the physical keycode and modifier state for shortcut matching, but
    // explicitly clear translated text on the printable L down/up events.
    CGEventKeyboardSetUnicodeString(event, 0, NULL);
    CGEventSetIntegerValueField(event, kCGEventSourceUserData, kSyntheticKeyMarker);
    CGEventPost(kCGHIDEventTap, event);
    CFRelease(event);
}

- (void)postOptionLShortcutWithoutText {
    CGEventFlags optionFlags = kCGEventFlagMaskAlternate;

    // Reproduce the same state transitions as a physical Option+L chord. Merely
    // setting the Option flag on L does not send an Option key-down/up event,
    // which can make some app frameworks treat L as ordinary text instead of
    // dispatching the registered shortcut.
    [self postKeyCode:0x3A keyDown:YES flags:optionFlags];
    [self postKeyCodeWithoutText:0x25 keyDown:YES flags:optionFlags];
    [self postKeyCodeWithoutText:0x25 keyDown:NO flags:optionFlags];
    [self postKeyCode:0x3A keyDown:NO flags:0];
}

- (BOOL)postUnicodeChunk:(NSString *)chunk {
    if (chunk.length == 0) return YES;
    CGEventRef keyDown = CGEventCreateKeyboardEvent(NULL, 0, true);
    CGEventRef keyUp = CGEventCreateKeyboardEvent(NULL, 0, false);
    if (!keyDown || !keyUp) {
        if (keyDown) CFRelease(keyDown);
        if (keyUp) CFRelease(keyUp);
        return NO;
    }
    UniChar unicodeUnits[16];
    [chunk getCharacters:unicodeUnits range:NSMakeRange(0, chunk.length)];
    CGEventKeyboardSetUnicodeString(keyDown, (UniCharCount)chunk.length, unicodeUnits);
    CGEventSetIntegerValueField(keyDown, kCGEventSourceUserData, kSyntheticKeyMarker);
    CGEventSetIntegerValueField(keyUp, kCGEventSourceUserData, kSyntheticKeyMarker);
    CGEventPost(kCGHIDEventTap, keyDown);
    CGEventPost(kCGHIDEventTap, keyUp);
    CFRelease(keyDown);
    CFRelease(keyUp);
    return YES;
}

- (void)postStringAndEnter:(NSString *)text {
    if (text.length == 0) {
        Emit(@"action_error", @{@"message": @"此按键没有设置要输入的字符串。"});
        return;
    }
    NSMutableCharacterSet *lineOrControlCharacters = [[NSCharacterSet controlCharacterSet] mutableCopy];
    [lineOrControlCharacters formUnionWithCharacterSet:[NSCharacterSet newlineCharacterSet]];
    if (text.length > 128 || [text rangeOfCharacterFromSet:lineOrControlCharacters].location != NSNotFound) {
        Emit(@"action_error", @{@"message": @"字符串最多 128 个字符，且不能包含换行或控制字符。"});
        return;
    }
    NSUInteger offset = 0;
    while (offset < text.length) {
        NSUInteger chunkLength = MIN((NSUInteger)16, text.length - offset);
        if (offset + chunkLength < text.length) {
            unichar last = [text characterAtIndex:offset + chunkLength - 1];
            unichar next = [text characterAtIndex:offset + chunkLength];
            BOOL splitsSurrogatePair = last >= 0xD800 && last <= 0xDBFF && next >= 0xDC00 && next <= 0xDFFF;
            if (splitsSurrogatePair) chunkLength--;
        }
        NSString *chunk = [text substringWithRange:NSMakeRange(offset, chunkLength)];
        if (![self postUnicodeChunk:chunk]) {
            Emit(@"action_error", @{@"message": @"无法发送输入字符串。"});
            return;
        }
        offset += chunkLength;
    }
    [self postKeyCode:0x24 modifiers:@[]];
    Emit(@"action_done", @{});
}

- (void)restartAppSwitcherTimeout {
    NSUInteger generation = ++self.appSwitcherGeneration;
    __weak RemoteHelper *weakSelf = self;
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(30 * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
        RemoteHelper *helper = weakSelf;
        if (!helper || helper.stopped || !helper.appSwitcherActive || helper.appSwitcherGeneration != generation) return;
        [helper finishAppSwitcher:NO];
    });
}

- (void)beginAppSwitcherWithDirection:(NSInteger)direction {
    if (self.appSwitcherActive) return;
    self.appSwitcherActive = YES;
    self.appSwitcherEscapeDown = NO;
    [self restartKeyboardTap];
    [self postKeyCode:0x37 keyDown:YES flags:kCGEventFlagMaskCommand];
    self.appSwitcherCommandDown = YES;
    NSArray<NSString *> *modifiers = direction < 0 ? @[@"command", @"shift"] : @[@"command"];
    [self postKeyCode:0x30 modifiers:modifiers];
    Emit(@"app_switcher_state", @{@"active": @YES, @"escapeCancelAvailable": @(self.eventTap != NULL)});
    [self restartAppSwitcherTimeout];
}

- (void)beginAppSwitcher {
    [self beginAppSwitcherWithDirection:0];
}

- (void)finishAppSwitcher:(BOOL)commit {
    if (!self.appSwitcherActive) return;
    if (!commit) [self postKeyCode:0x35 modifiers:@[@"command"]];
    if (self.appSwitcherCommandDown) {
        [self postKeyCode:0x37 keyDown:NO flags:0];
        self.appSwitcherCommandDown = NO;
    }
    self.appSwitcherActive = NO;
    self.appSwitcherGeneration++;
    Emit(@"app_switcher_state", @{@"active": @NO, @"escapeCancelAvailable": @NO});
    if (!self.stopped) {
        __weak RemoteHelper *weakSelf = self;
        dispatch_async(dispatch_get_main_queue(), ^{
            RemoteHelper *helper = weakSelf;
            if (helper && !helper.stopped) [helper restartKeyboardTap];
        });
    }
}

- (void)postTarget:(NSString *)target {
    if ([target isEqualToString:@"appSwitcher"]) {
        [self beginAppSwitcher];
        return;
    }
    if ([target isEqualToString:@"appSwitcherLeft"] || [target isEqualToString:@"appSwitcherRight"]) {
        if (!self.appSwitcherActive) {
            [self beginAppSwitcherWithDirection:[target isEqualToString:@"appSwitcherLeft"] ? -1 : 1];
        } else {
            uint16_t keyCode = [target isEqualToString:@"appSwitcherLeft"] ? 0x7B : 0x7C;
            [self postKeyCode:keyCode modifiers:@[@"command"]];
            [self restartAppSwitcherTimeout];
        }
        return;
    }
    if (self.appSwitcherActive && [target isEqualToString:@"arrowLeft"]) {
        [self postKeyCode:0x7B modifiers:@[@"command"]];
        [self restartAppSwitcherTimeout];
        return;
    }
    if (self.appSwitcherActive && [target isEqualToString:@"arrowRight"]) {
        [self postKeyCode:0x7C modifiers:@[@"command"]];
        [self restartAppSwitcherTimeout];
        return;
    }
    if (self.appSwitcherActive) return;
    BOOL focusMainChatAfterLaunch = [target hasPrefix:@"openAppFocus:"];
    if (focusMainChatAfterLaunch || [target hasPrefix:@"openApp:"]) {
        NSString *prefix = focusMainChatAfterLaunch ? @"openAppFocus:" : @"openApp:";
        NSString *bundleId = [target substringFromIndex:prefix.length];
        if (focusMainChatAfterLaunch &&
            ![@[@"com.openai.codex", @"com.openai.chatgpt"] containsObject:bundleId]) {
            Emit(@"action_error", @{@"message": @"⌥+L 聚焦只支持 ChatGPT App。"});
            return;
        }
        NSWorkspace *workspace = [NSWorkspace sharedWorkspace];
        NSURL *appURL = [workspace URLForApplicationWithBundleIdentifier:bundleId];
        if (!appURL) {
            Emit(@"action_error", @{@"message": [NSString stringWithFormat:@"找不到应用 %@。请重新选择应用。", bundleId]});
            return;
        }
        NSWorkspaceOpenConfiguration *configuration = [NSWorkspaceOpenConfiguration configuration];
        configuration.activates = YES;
        [workspace openApplicationAtURL:appURL configuration:configuration completionHandler:^(NSRunningApplication *application, NSError *error) {
            if (error) Emit(@"action_error", @{@"message": [NSString stringWithFormat:@"打开应用失败：%@", error.localizedDescription ?: bundleId]});
            else if (focusMainChatAfterLaunch) {
                dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(0.8 * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
                    [self sendFocusMainChatShortcutToApplication:bundleId attempt:0];
                });
            } else Emit(@"action_done", @{});
        }];
        return;
    }
    if ([target hasPrefix:@"openFile:"]) {
        NSString *path = [target substringFromIndex:@"openFile:".length];
        BOOL isDirectory = NO;
        if (![path hasPrefix:@"/"] || ![[NSFileManager defaultManager] fileExistsAtPath:path isDirectory:&isDirectory] || isDirectory) {
            Emit(@"action_error", @{@"message": [NSString stringWithFormat:@"文件不存在或不是文件：%@", path.lastPathComponent ?: path]});
            return;
        }
        NSURL *url = [NSURL fileURLWithPath:path];
        if (![[NSWorkspace sharedWorkspace] openURL:url]) {
            Emit(@"action_error", @{@"message": [NSString stringWithFormat:@"无法打开文件：%@", path.lastPathComponent ?: path]});
        } else Emit(@"action_done", @{});
        return;
    }
    if ([target hasPrefix:@"key:"]) {
        uint16_t keyCode = [self keyCodeForName:[target substringFromIndex:4]];
        if (keyCode != UINT16_MAX) [self postKeyCode:keyCode modifiers:@[]];
        return;
    }
    if ([target hasPrefix:@"shortcut:"]) {
        NSArray<NSString *> *parts = [target componentsSeparatedByString:@":"];
        if (parts.count == 3) {
            uint16_t keyCode = [self keyCodeForName:parts[2]];
            NSArray<NSString *> *modifiers = [parts[1] isEqualToString:@"none"]
                ? @[] : [parts[1] componentsSeparatedByString:@"+"];
            if (keyCode != UINT16_MAX) [self postKeyCode:keyCode modifiers:modifiers];
        }
        return;
    }
    NSDictionary<NSString *, NSArray *> *targets = @{
        @"arrowUp": @[@0x7E, @[]], @"arrowDown": @[@0x7D, @[]],
        @"arrowLeft": @[@0x7B, @[]], @"arrowRight": @[@0x7C, @[]],
        @"return": @[@0x24, @[]], @"escape": @[@0x35, @[]],
        @"delete": @[@0x33, @[]], @"tab": @[@0x30, @[]], @"space": @[@0x31, @[]],
        @"home": @[@0x73, @[]], @"end": @[@0x77, @[]], @"pageUp": @[@0x74, @[]],
        @"pageDown": @[@0x79, @[]], @"showDesktop": @[@0x67, @[@"fn"]],
        @"lockScreen": @[@0x0C, @[@"control", @"command"]],
        @"commandSpace": @[@0x31, @[@"command"]], @"commandA": @[@0x00, @[@"command"]],
        @"commandC": @[@0x08, @[@"command"]], @"commandV": @[@0x09, @[@"command"]],
        @"commandZ": @[@0x06, @[@"command"]], @"commandS": @[@0x01, @[@"command"]],
        @"commandW": @[@0x0D, @[@"command"]], @"commandQ": @[@0x0C, @[@"command"]],
        @"F1": @[@0x7A, @[]], @"F2": @[@0x78, @[]], @"F3": @[@0x63, @[]],
        @"F4": @[@0x76, @[]], @"F5": @[@0x60, @[]], @"F6": @[@0x61, @[]],
        @"F7": @[@0x62, @[]], @"F8": @[@0x64, @[]], @"F9": @[@0x65, @[]],
        @"F10": @[@0x6D, @[]], @"F11": @[@0x67, @[]], @"F12": @[@0x6F, @[]]
    };
    NSArray *item = targets[target];
    if (item.count == 2) {
        [self postKeyCode:[item[0] unsignedShortValue] modifiers:item[1]];
        return;
    }
    if ([target isEqualToString:@"volumeUp"] || [target isEqualToString:@"volumeDown"] || [target isEqualToString:@"mute"]) {
        int32_t key = [target isEqualToString:@"volumeUp"] ? 0 : [target isEqualToString:@"volumeDown"] ? 1 : 7;
        int32_t states[] = {0xA, 0xB};
        for (NSUInteger i = 0; i < 2; i++) {
            int32_t state = states[i];
            int data1 = (key << 16) | (state << 8);
            NSEvent *event = [NSEvent otherEventWithType:NSEventTypeSystemDefined
                location:NSZeroPoint modifierFlags:0 timestamp:0 windowNumber:0 context:nil
                subtype:8 data1:data1 data2:-1];
            CGEventRef cgEvent = event.CGEvent;
            if (cgEvent) CGEventPost(kCGHIDEventTap, cgEvent);
        }
    }
}

- (void)sendFocusMainChatShortcutToApplication:(NSString *)bundleId attempt:(NSUInteger)attempt {
    if (self.stopped) return;
    NSRunningApplication *frontmost = [NSWorkspace sharedWorkspace].frontmostApplication;
    if (![frontmost.bundleIdentifier isEqualToString:bundleId]) {
        if (attempt < 20) {
            dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(0.25 * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
                [self sendFocusMainChatShortcutToApplication:bundleId attempt:attempt + 1];
            });
        } else {
            Emit(@"action_error", @{@"message": @"ChatGPT 未切到前台，未发送 ⌥+L。"});
        }
        return;
    }
    [self postOptionLShortcutWithoutText];
    Emit(@"action_done", @{@"message": @"已向 ChatGPT 发送 ⌥+L。"});
}

- (void)shutdown {
    if (self.stopped) return;
    self.stopped = YES;
    if (self.appSwitcherActive) [self finishAppSwitcher:NO];
    self.keepCaptureOpen = NO;
    [self.keepAliveTimer invalidate];
    self.keepAliveTimer = nil;
    [self closeMicrophoneForcefully];
    [self.central stopScan];
    if (self.peripheral) [self.central cancelPeripheralConnection:self.peripheral];
    if (self.eventTap) CGEventTapEnable(self.eventTap, false);
    if (self.eventTapSource) {
        CFRunLoopRemoveSource(CFRunLoopGetMain(), self.eventTapSource, kCFRunLoopCommonModes);
        CFRelease(self.eventTapSource);
        self.eventTapSource = NULL;
    }
    if (self.eventTap) {
        CFRelease(self.eventTap);
        self.eventTap = NULL;
    }
    [self stopHID];
    Emit(@"helper_stopped", @{});
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(0.1 * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
        exit(0);
    });
}

@end

int main(void) {
    @autoreleasepool {
        gOutputLock = [NSObject new];
        [NSApplication sharedApplication];
        [NSApp setActivationPolicy:NSApplicationActivationPolicyAccessory];
        RemoteHelper *helper = [RemoteHelper new];
        [helper start];
        [NSApp run];
    }
    return 0;
}
