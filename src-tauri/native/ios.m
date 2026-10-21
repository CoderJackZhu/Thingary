// iOS-only platform services. This translation unit never links AppKit.
#import <UIKit/UIKit.h>
#import <PhotosUI/PhotosUI.h>
#import <WebKit/WebKit.h>
#import <LocalAuthentication/LocalAuthentication.h>
#import <UserNotifications/UserNotifications.h>
#import <ImageIO/ImageIO.h>
#import <UniformTypeIdentifiers/UniformTypeIdentifiers.h>
#include <stdlib.h>
#include <string.h>

void thingary_free(void *bytes) { free(bytes); }

// Querying the biometric type never prompts. An unrecognized biometric type
// uses the generic device-owner/password verification name.
int thingary_auth_method(void) {
    @autoreleasepool {
        LAContext *context = [LAContext new];
        [context canEvaluatePolicy:LAPolicyDeviceOwnerAuthenticationWithBiometrics error:nil];
        if (context.biometryType == LABiometryTypeFaceID) return 2;
        if (context.biometryType == LABiometryTypeTouchID) return 1;
        return 0;
    }
}

// 1 invalid/unsupported; 2 dimensions; 3 corrupt/encode/allocation failure.
// Produce an orientation-correct bounded PNG preview; never rewrite the original.
int thingary_preview(const unsigned char *bytes, size_t count, unsigned char **output, size_t *length) {
    @autoreleasepool {
        *output = NULL; *length = 0;
        NSData *data = [NSData dataWithBytesNoCopy:(void *)bytes length:count freeWhenDone:NO];
        NSDictionary *readOptions = @{(__bridge NSString *)kCGImageSourceShouldCache: @NO};
        CGImageSourceRef source = CGImageSourceCreateWithData((__bridge CFDataRef)data, (__bridge CFDictionaryRef)readOptions);
        if (!source) return 1;
        NSString *type = (__bridge NSString *)CGImageSourceGetType(source);
        if (![@[UTTypeJPEG.identifier, UTTypePNG.identifier, UTTypeWebP.identifier, UTTypeHEIC.identifier, UTTypeHEIF.identifier] containsObject:type ?: @""]) { CFRelease(source); return 1; }
        size_t index = CGImageSourceGetPrimaryImageIndex(source);
        NSDictionary *props = CFBridgingRelease(CGImageSourceCopyPropertiesAtIndex(source, index, NULL));
        NSNumber *width = props[(__bridge NSString *)kCGImagePropertyPixelWidth];
        NSNumber *height = props[(__bridge NSString *)kCGImagePropertyPixelHeight];
        if (![width isKindOfClass:NSNumber.class] || ![height isKindOfClass:NSNumber.class]) { CFRelease(source); return 3; }
        long long w = width.longLongValue, h = height.longLongValue;
        if (w <= 0 || h <= 0 || w > 12000 || h > 12000 || w * h > 40000000) { CFRelease(source); return 2; }
        NSDictionary *options = @{(__bridge NSString *)kCGImageSourceCreateThumbnailFromImageAlways: @YES,
            (__bridge NSString *)kCGImageSourceCreateThumbnailWithTransform: @YES,
            (__bridge NSString *)kCGImageSourceThumbnailMaxPixelSize: @960,
            (__bridge NSString *)kCGImageSourceShouldCacheImmediately: @YES};
        CGImageRef thumbnail = CGImageSourceCreateThumbnailAtIndex(source, index, (__bridge CFDictionaryRef)options);
        BOOL complete = CGImageSourceGetStatusAtIndex(source, index) == kCGImageStatusComplete;
        CFRelease(source);
        if (!thumbnail || !complete) { if (thumbnail) CGImageRelease(thumbnail); return 3; }
        NSMutableData *png = [NSMutableData data];
        CGImageDestinationRef dest = CGImageDestinationCreateWithData((__bridge CFMutableDataRef)png, (__bridge CFStringRef)UTTypePNG.identifier, 1, NULL);
        if (!dest) { CGImageRelease(thumbnail); return 3; }
        CGImageDestinationAddImage(dest, thumbnail, NULL);
        BOOL ok = CGImageDestinationFinalize(dest);
        CFRelease(dest); CGImageRelease(thumbnail);
        if (!ok || png.length == 0 || png.length > 4 * 1024 * 1024) return 3;
        void *copy = malloc(png.length);
        if (!copy) return 3;
        memcpy(copy, png.bytes, png.length);
        *output = copy; *length = png.length;
        return 0;
    }
}

int thingary_auth_available(void) {
    @autoreleasepool {
        LAContext *context = [LAContext new];
        return [context canEvaluatePolicy:LAPolicyDeviceOwnerAuthentication error:nil] ? 1 : 0;
    }
}

// Blocking worker only. iOS's system passcode fallback never enters Thingary.
char *thingary_auth(const char *reason) {
    @autoreleasepool {
        if (NSThread.isMainThread) return strdup("请在后台工作线程请求身份验证");
        LAContext *context = [LAContext new];
        if (![context canEvaluatePolicy:LAPolicyDeviceOwnerAuthentication error:nil]) {
            return strdup("这台 iPhone 没有设置设备密码或面容／触控 ID");
        }
        dispatch_semaphore_t done = dispatch_semaphore_create(0);
        __block NSString *result = @"身份验证未完成，请重试。";
        NSString *message = reason ? [NSString stringWithUTF8String:reason] : @"解锁物谱";
        [context evaluatePolicy:LAPolicyDeviceOwnerAuthentication localizedReason:message reply:^(BOOL success, NSError *error) {
            @synchronized (context) {
                if (success) result = @"";
                else if (error.code == LAErrorUserCancel || error.code == LAErrorAppCancel || error.code == LAErrorSystemCancel) result = @"已取消身份验证，请点解锁重试。";
                else if (error.code == LAErrorAuthenticationFailed) result = @"身份验证未通过，请重试。";
                else result = @"暂时无法验证身份，请重试或使用设备密码。";
            }
            dispatch_semaphore_signal(done);
        }];
        if (dispatch_semaphore_wait(done, dispatch_time(DISPATCH_TIME_NOW, 120 * NSEC_PER_SEC)) != 0) {
            [context invalidate];
            return strdup("身份验证已超时，请点解锁重试。");
        }
        @synchronized (context) { return strdup(result.UTF8String); }
    }
}

static NSArray<UIWindow *> *thingary_windows(void) {
    NSMutableArray *windows = [NSMutableArray array];
    for (UIScene *scene in UIApplication.sharedApplication.connectedScenes) {
        if ([scene isKindOfClass:UIWindowScene.class]) {
            [windows addObjectsFromArray:((UIWindowScene *)scene).windows];
        }
    }
    // Fallback for the pre-scene app delegate path; scene-owned windows are
    // already collected above and must not be duplicated.
    id<UIApplicationDelegate> delegate = UIApplication.sharedApplication.delegate;
    if ([delegate respondsToSelector:@selector(window)] && delegate.window && ![windows containsObject:delegate.window]) [windows addObject:delegate.window];
    return windows;
}
static UIViewController *thingary_presenter(void) {
    for (UIWindow *window in thingary_windows()) {
        if (!window.isKeyWindow || !window.rootViewController || window.hidden) continue;
        UIViewController *controller = window.rootViewController;
        while (controller.presentedViewController && !controller.presentedViewController.isBeingDismissed) {
            controller = controller.presentedViewController;
        }
        return controller;
    }
    return nil;
}

// Register once on the main thread. Protect snapshots when background cover
// or idle authentication is enabled. No library is accessed.
static BOOL privacyCoverEnabled = YES; // conservative until persisted preferences arrive
static NSMapTable<UIWindow *, UIView *> *privacyCovers;
static WKWebView *thingary_webview(UIView *view) {
    if ([view isKindOfClass:WKWebView.class]) return (WKWebView *)view;
    for (UIView *child in view.subviews) { WKWebView *found = thingary_webview(child); if (found) return found; }
    return nil;
}
static void thingary_lifecycle(UIWindow *window, BOOL away, void (^completion)(void)) {
    WKWebView *webview = thingary_webview(window.rootViewController.view);
    if (!webview) { if (completion) completion(); return; }
    NSString *script = away ? @"window.dispatchEvent(new Event('thingary-ios-away'))" : @"window.dispatchEvent(new Event('thingary-ios-return'))";
    [webview evaluateJavaScript:script completionHandler:^(id result, NSError *error) { (void)result; (void)error; if (completion) completion(); }];
}
static NSMutableArray *privacyObservers;
static NSArray<UIWindow *> *thingary_scene_windows(id object) {
    return [object isKindOfClass:UIWindowScene.class] ? ((UIWindowScene *)object).windows : @[];
}
static void thingary_cover_windows(NSArray<UIWindow *> *windows) {
    for (UIWindow *window in windows) {
        thingary_lifecycle(window, YES, nil);
        if (!privacyCoverEnabled || [privacyCovers objectForKey:window]) continue;
        // The opaque base prevents any readable content or sensitive fields
        // leaking through a translucent system material.
        UIView *base = [[UIView alloc] initWithFrame:window.bounds];
        base.backgroundColor = UIColor.systemBackgroundColor;
        base.autoresizingMask = UIViewAutoresizingFlexibleWidth | UIViewAutoresizingFlexibleHeight;
        UIVisualEffectView *blur = [[UIVisualEffectView alloc] initWithEffect:[UIBlurEffect effectWithStyle:UIBlurEffectStyleSystemMaterial]];
        blur.frame = base.bounds;
        blur.autoresizingMask = base.autoresizingMask;
        [base addSubview:blur];
        [window addSubview:base];
        [privacyCovers setObject:base forKey:window];
    }
}
static void thingary_reveal_windows(NSArray<UIWindow *> *windows) {
    for (UIWindow *window in windows) {
        thingary_lifecycle(window, NO, ^{
            if (window.windowScene && window.windowScene.activationState != UISceneActivationStateForegroundActive) return;
            [[privacyCovers objectForKey:window] removeFromSuperview];
            [privacyCovers removeObjectForKey:window];
        });
    }
}
void thingary_ios_set_privacy_cover(int enabled) {
    dispatch_async(dispatch_get_main_queue(), ^{ privacyCoverEnabled = enabled != 0; });
}
void thingary_ios_init(void) {
    NSCAssert(NSThread.isMainThread, @"iOS initialization must run on the main thread");
    static dispatch_once_t once;
    dispatch_once(&once, ^{
        privacyCovers = [NSMapTable weakToStrongObjectsMapTable];
        privacyObservers = [NSMutableArray array];
        NSNotificationCenter *center = NSNotificationCenter.defaultCenter;
        for (NSNotificationName name in @[UISceneWillDeactivateNotification, UISceneDidEnterBackgroundNotification]) {
            [privacyObservers addObject:[center addObserverForName:name object:nil queue:NSOperationQueue.mainQueue usingBlock:^(NSNotification *note) {
                thingary_cover_windows(thingary_scene_windows(note.object));
            }]];
        }
        [privacyObservers addObject:[center addObserverForName:UISceneDidActivateNotification object:nil queue:NSOperationQueue.mainQueue usingBlock:^(NSNotification *note) {
            // Revealing one scene must not reveal another scene still in the
            // app switcher or background. UIKit owns each scene's state.
            if ([note.object isKindOfClass:UIWindowScene.class] && ((UIWindowScene *)note.object).activationState == UISceneActivationStateForegroundActive) {
                thingary_reveal_windows(thingary_scene_windows(note.object));
            }
        }]];
        // Application notifications remain a fallback for authentication,
        // system interruption and the legacy non-scene lifecycle.
        for (NSNotificationName name in @[UIApplicationWillResignActiveNotification, UIApplicationDidEnterBackgroundNotification]) {
            [privacyObservers addObject:[center addObserverForName:name object:nil queue:NSOperationQueue.mainQueue usingBlock:^(NSNotification *note) {
                (void)note;
                thingary_cover_windows(thingary_windows());
            }]];
        }
        [privacyObservers addObject:[center addObserverForName:UIApplicationDidBecomeActiveNotification object:nil queue:NSOperationQueue.mainQueue usingBlock:^(NSNotification *note) {
            (void)note;
            NSMutableArray *active = [NSMutableArray array];
            for (UIWindow *window in thingary_windows()) {
                if (!window.windowScene || window.windowScene.activationState == UISceneActivationStateForegroundActive) [active addObject:window];
            }
            thingary_reveal_windows(active);
        }]];
        // Setup can happen after a scene has already become inactive.
        for (UIWindow *window in thingary_windows()) {
            if (window.windowScene && window.windowScene.activationState != UISceneActivationStateForegroundActive) thingary_cover_windows(@[window]);
        }
    });
}

static char *thingary_json(NSDictionary *value) {
    NSData *data = [NSJSONSerialization dataWithJSONObject:value options:0 error:nil];
    if (!data) return strdup("{\"status\":\"error\",\"message\":\"原生结果无法读取\"}");
    return strdup([[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding].UTF8String);
}
static NSDictionary *thingary_error(NSString *message) {
    return @{@"status": @"error", @"message": message ?: @"原生操作未完成，请重试"};
}

@interface ThingaryFileOperation : NSObject <UIDocumentPickerDelegate, PHPickerViewControllerDelegate, UIAdaptivePresentationControllerDelegate>
@property(nonatomic, strong) dispatch_semaphore_t done;
@property(nonatomic, strong) NSDictionary *result;
@property(nonatomic, strong) UIViewController *controller;
@property(nonatomic, copy) NSString *kind;
@property(nonatomic) BOOL finished;
- (void)finish:(NSDictionary *)result;
@end
// Accessed only on the main thread; retains delegates through callbacks.
static ThingaryFileOperation *activeFileOperation;
@implementation ThingaryFileOperation
- (instancetype)init {
    if ((self = [super init])) _done = dispatch_semaphore_create(0);
    return self;
}
- (void)finish:(NSDictionary *)result {
    NSCAssert(NSThread.isMainThread, @"file callbacks must run on main");
    if (self.finished) return;
    self.finished = YES;
    self.result = result;
    self.controller = nil;
    if (activeFileOperation == self) activeFileOperation = nil;
    dispatch_semaphore_signal(self.done);
}
- (void)picker:(PHPickerViewController *)picker didFinishPicking:(NSArray<PHPickerResult *> *)results {
    [picker dismissViewControllerAnimated:YES completion:nil];
    PHPickerResult *selected = results.firstObject;
    if (!selected) { [self finish:@{@"status": @"cancelled"}]; return; }
    NSItemProvider *provider = selected.itemProvider;
    // The system photo picker grants only the chosen photo. Preserve HEIC and
    // orientation metadata; the shared ImageIO bridge creates the thumbnail.
    [provider loadFileRepresentationForTypeIdentifier:UTTypeImage.identifier completionHandler:^(NSURL *source, NSError *error) {
        if (!source || error) {
            dispatch_async(dispatch_get_main_queue(), ^{ [self finish:thingary_error(@"无法读取所选照片，请确认原图已下载并重试")]; });
            return;
        }
        NSURL *directory = [NSURL fileURLWithPath:[NSTemporaryDirectory() stringByAppendingPathComponent:NSUUID.UUID.UUIDString] isDirectory:YES];
        NSURL *target = [directory URLByAppendingPathComponent:source.lastPathComponent];
        NSFileManager *files = NSFileManager.defaultManager;
        NSError *copyError;
        BOOL copied = [files createDirectoryAtURL:directory withIntermediateDirectories:YES attributes:nil error:&copyError] && [files copyItemAtURL:source toURL:target error:&copyError];
        dispatch_async(dispatch_get_main_queue(), ^{
            if (!copied || self.finished) [files removeItemAtURL:directory error:nil];
            [self finish:copied ? @{@"status":@"selected", @"path":target.path} : thingary_error(@"无法暂存照片，请检查可用空间")];
        });
    }];
}
- (void)documentPickerWasCancelled:(UIDocumentPickerViewController *)controller {
    [self finish:@{@"status": @"cancelled"}];
}
- (void)presentationControllerDidDismiss:(UIPresentationController *)controller {
    [self finish:@{@"status": @"cancelled"}];
}
- (void)documentPicker:(UIDocumentPickerViewController *)controller didPickDocumentsAtURLs:(NSArray<NSURL *> *)urls {
    NSURL *source = urls.firstObject;
    if (!source || !source.isFileURL) { [self finish:thingary_error(@"请选择一个本地文件")]; return; }
    NSString *name = source.lastPathComponent.lowercaseString;
    BOOL valid = NO;
    if ([self.kind isEqualToString:@"backup"]) valid = [name hasSuffix:@".thingary"] || [name hasSuffix:@".thingary.age"];
    else if ([self.kind isEqualToString:@"workbook"]) valid = [name hasSuffix:@".xlsx"];
    else if ([self.kind isEqualToString:@"key"]) valid = [name hasSuffix:@".txt"];
    else if ([self.kind isEqualToString:@"image"]) valid = [@[@"jpg", @"jpeg", @"png", @"webp", @"heic", @"heif"] containsObject:source.pathExtension.lowercaseString];
    if (!valid) { [self finish:thingary_error(@"所选文件类型与当前导入操作不符")]; return; }
    // Never copy a potentially large backup on UIKit's main thread. Retain
    // the imported URL until this owned copy has completed.
    dispatch_async(dispatch_get_global_queue(QOS_CLASS_USER_INITIATED, 0), ^{
        NSDictionary *result;
        NSURL *root = [NSURL fileURLWithPath:[NSTemporaryDirectory() stringByAppendingPathComponent:@"thingary-imports"] isDirectory:YES];
        NSURL *directory = [root URLByAppendingPathComponent:NSUUID.UUID.UUIDString isDirectory:YES];
        NSURL *target = [directory URLByAppendingPathComponent:source.lastPathComponent];
        NSFileManager *files = NSFileManager.defaultManager;
        BOOL scoped = [source startAccessingSecurityScopedResource];
        NSNumber *regular;
        NSError *error;
        BOOL copied = NO;
        if (![source getResourceValue:&regular forKey:NSURLIsRegularFileKey error:&error] || !regular.boolValue) {
            result = thingary_error(@"请选择一个普通文件，不能选择文件夹或链接");
        } else if (![files createDirectoryAtURL:directory withIntermediateDirectories:YES attributes:@{NSFileProtectionKey:NSFileProtectionCompleteUntilFirstUserAuthentication} error:&error]) {
            result = thingary_error(@"无法暂存导入文件，请检查可用空间");
        } else {
            copied = [files copyItemAtURL:source toURL:target error:&error];
            result = copied ? @{@"status": @"selected", @"path": target.path} : thingary_error(@"无法读取所选文件，请确认文件已下载到本机并重试");
        }
        if (scoped) [source stopAccessingSecurityScopedResource];
        dispatch_async(dispatch_get_main_queue(), ^{
            if (!copied || self.finished) {
                // This private UUID directory belongs only to this operation.
                dispatch_async(dispatch_get_global_queue(QOS_CLASS_UTILITY, 0), ^{ [files removeItemAtURL:directory error:nil]; });
            }
            // On success keep the copy until the OS purges temporary storage;
            // inspection owns a checked snapshot before restore confirmation.
            [self finish:result];
        });
    });
}
@end

static char *thingary_wait_operation(ThingaryFileOperation *operation) {
    if (dispatch_semaphore_wait(operation.done, dispatch_time(DISPATCH_TIME_NOW, 180 * NSEC_PER_SEC)) != 0) {
        // Do not synchronously wait for a stalled UIKit thread after timeout.
        // The queued cleanup retains its operation and ignores late callbacks.
        dispatch_async(dispatch_get_main_queue(), ^{
            if (!operation.finished) {
                [operation.controller dismissViewControllerAnimated:NO completion:nil];
                [operation finish:thingary_error(@"文件操作等待超时，请重试")];
            }
        });
        return thingary_json(thingary_error(@"文件操作等待超时，请重试"));
    }
    // finish writes result before signaling the semaphore, and never mutates
    // it again. The blocking caller owns operation throughout this read.
    return thingary_json(operation.result ?: thingary_error(@"文件操作未返回结果，请重试"));
}

// Worker-only synchronous facade; UIKit presentation and callbacks stay on main.
char *thingary_ios_pick(const char *kind) {
    @autoreleasepool {
        if (NSThread.isMainThread) return thingary_json(thingary_error(@"请在后台工作线程打开文件选择器"));
        NSString *selection = kind ? [NSString stringWithUTF8String:kind] : @"";
        if (![@[@"backup", @"workbook", @"key", @"image"] containsObject:selection]) return thingary_json(thingary_error(@"不支持此文件选择类型"));
        ThingaryFileOperation *operation = [ThingaryFileOperation new];
        operation.kind = selection;
        dispatch_async(dispatch_get_main_queue(), ^{
            if (activeFileOperation) { [operation finish:thingary_error(@"请先完成或取消已打开的文件操作")]; return; }
            UIViewController *presenter = thingary_presenter();
            if (!presenter || UIApplication.sharedApplication.applicationState != UIApplicationStateActive) {
                [operation finish:thingary_error(@"请返回物谱后再选择文件")]; return;
            }
            activeFileOperation = operation;
            if ([selection isEqualToString:@"image"]) {
                PHPickerConfiguration *config = [PHPickerConfiguration new];
                config.filter = PHPickerFilter.imagesFilter;
                config.selectionLimit = 1;
                config.preferredAssetRepresentationMode = PHPickerConfigurationAssetRepresentationModeCurrent;
                PHPickerViewController *picker = [[PHPickerViewController alloc] initWithConfiguration:config];
                picker.delegate = operation;
                operation.controller = picker;
                [presenter presentViewController:picker animated:YES completion:nil];
                picker.presentationController.delegate = operation;
                return;
            }
            // Public data permits .thingary and compound .thingary.age even
            // when no other app has registered those custom extensions.
            NSArray<UTType *> *types = [selection isEqualToString:@"image"] ? @[UTTypeImage] : @[UTTypeData];
            UIDocumentPickerViewController *picker = [[UIDocumentPickerViewController alloc] initForOpeningContentTypes:types asCopy:YES];
            picker.allowsMultipleSelection = NO;
            picker.delegate = operation;
            picker.directoryURL = [NSFileManager.defaultManager URLsForDirectory:NSDocumentDirectory inDomains:NSUserDomainMask].firstObject;
            operation.controller = picker;
            [presenter presentViewController:picker animated:YES completion:nil];
            picker.presentationController.delegate = operation;
        });
        return thingary_wait_operation(operation);
    }
}

// Rust validates and canonicalizes a regular file inside app Documents first.
char *thingary_ios_share(const char *path) {
    @autoreleasepool {
        if (NSThread.isMainThread) return thingary_json(thingary_error(@"请在后台工作线程打开分享面板"));
        NSString *filename = path ? [NSString stringWithUTF8String:path] : @"";
        NSURL *url = [NSURL fileURLWithPath:filename];
        if (!url || ![NSFileManager.defaultManager isReadableFileAtPath:filename]) return thingary_json(thingary_error(@"导出文件不存在或无法读取"));
        ThingaryFileOperation *operation = [ThingaryFileOperation new];
        dispatch_async(dispatch_get_main_queue(), ^{
            if (activeFileOperation) { [operation finish:thingary_error(@"请先完成或取消已打开的文件操作")]; return; }
            UIViewController *presenter = thingary_presenter();
            if (!presenter || UIApplication.sharedApplication.applicationState != UIApplicationStateActive) {
                [operation finish:thingary_error(@"请返回物谱后再分享文件")]; return;
            }
            activeFileOperation = operation;
            UIActivityViewController *share = [[UIActivityViewController alloc] initWithActivityItems:@[url] applicationActivities:nil];
            share.completionWithItemsHandler = ^(UIActivityType type, BOOL completed, NSArray *returned, NSError *error) {
                (void)type; (void)returned;
                dispatch_async(dispatch_get_main_queue(), ^{
                    [operation finish:error ? thingary_error(@"分享未完成，请返回物谱重试") : @{@"status": completed ? @"completed" : @"cancelled"}];
                });
            };
            operation.controller = share;
            UIPopoverPresentationController *popover = share.popoverPresentationController;
            popover.sourceView = presenter.view;
            popover.sourceRect = CGRectMake(CGRectGetMidX(presenter.view.bounds), CGRectGetMaxY(presenter.view.bounds) - 1, 1, 1);
            popover.permittedArrowDirections = UIPopoverArrowDirectionAny;
            [presenter presentViewController:share animated:YES completion:nil];
            share.presentationController.delegate = operation;
        });
        return thingary_wait_operation(operation);
    }
}

char *thingary_ios_open_url(const char *url) {
    @autoreleasepool {
        if (NSThread.isMainThread) return strdup("请在后台工作线程打开链接");
        NSString *text = url ? [NSString stringWithUTF8String:url] : @"";
        NSURL *destination = [NSURL URLWithString:text];
        if (!destination) return strdup("链接无效");
        dispatch_semaphore_t done = dispatch_semaphore_create(0);
        __block BOOL opened = NO;
        dispatch_async(dispatch_get_main_queue(), ^{
            [UIApplication.sharedApplication openURL:destination options:@{} completionHandler:^(BOOL success) { opened = success; dispatch_semaphore_signal(done); }];
        });
        if (dispatch_semaphore_wait(done, dispatch_time(DISPATCH_TIME_NOW, 10 * NSEC_PER_SEC)) != 0) return strdup("打开链接超时，请重试");
        return strdup(opened ? "" : "无法打开链接，请手动在设置或浏览器中打开");
    }
}

@interface ThingaryIOSNotificationDelegate : NSObject <UNUserNotificationCenterDelegate>
@end
@implementation ThingaryIOSNotificationDelegate
- (void)userNotificationCenter:(UNUserNotificationCenter *)center willPresentNotification:(UNNotification *)notification withCompletionHandler:(void (^)(UNNotificationPresentationOptions))completionHandler {
    completionHandler(UNNotificationPresentationOptionBanner | UNNotificationPresentationOptionList | UNNotificationPresentationOptionSound);
}
@end
static ThingaryIOSNotificationDelegate *notificationDelegate;

// Blocking reminder worker only; same JSON Plan contract as the desktop bridge.
// A conservative 64-request budget is shared with unmanaged app notifications.
char *thingary_notifications(const char *json, int ask) {
    @autoreleasepool { @try {
        if (NSThread.isMainThread) return strdup("请在后台工作线程安排提醒");
        UNUserNotificationCenter *center = UNUserNotificationCenter.currentNotificationCenter;
        static dispatch_once_t once;
        dispatch_once(&once, ^{
            notificationDelegate = [ThingaryIOSNotificationDelegate new];
            center.delegate = notificationDelegate;
        });
        dispatch_semaphore_t auth = dispatch_semaphore_create(0);
        __block NSInteger status = UNAuthorizationStatusNotDetermined;
        __block NSString *authorizationError;
        if (ask) {
            [center requestAuthorizationWithOptions:(UNAuthorizationOptionAlert | UNAuthorizationOptionSound) completionHandler:^(BOOL granted, NSError *error) {
                authorizationError = error.localizedDescription;
                status = error ? -1 : (granted ? UNAuthorizationStatusAuthorized : UNAuthorizationStatusDenied);
                dispatch_semaphore_signal(auth);
            }];
        } else {
            [center getNotificationSettingsWithCompletionHandler:^(UNNotificationSettings *settings) {
                status = settings.authorizationStatus;
                dispatch_semaphore_signal(auth);
            }];
        }
        if (dispatch_semaphore_wait(auth, dispatch_time(DISPATCH_TIME_NOW, 15 * NSEC_PER_SEC)) != 0) return strdup(ask ? "通知授权待确认，请在系统提示中选择后重试" : "通知服务未及时响应，请重试");
        if (ask) {
            if (authorizationError) return strdup("通知权限请求失败，请重试");
            return strdup(status == UNAuthorizationStatusAuthorized ? "" : "通知权限未开启，请在“设置 › 通知 › 物谱”中允许通知");
        }
        NSData *data = json ? [[NSString stringWithUTF8String:json] dataUsingEncoding:NSUTF8StringEncoding] : nil;
        id decoded = data ? [NSJSONSerialization JSONObjectWithData:data options:0 error:nil] : nil;
        if (![decoded isKindOfClass:NSArray.class]) return strdup("提醒计划无效");
        NSCalendar *calendar = [NSCalendar calendarWithIdentifier:NSCalendarIdentifierGregorian];
        calendar.timeZone = NSTimeZone.localTimeZone;
        NSMutableArray<NSDictionary *> *future = [NSMutableArray array];
        NSMutableSet<NSString *> *ids = [NSMutableSet set];
        for (id value in (NSArray *)decoded) {
            if (![value isKindOfClass:NSDictionary.class]) return strdup("提醒计划无效");
            NSDictionary *plan = value;
            NSString *identifier = plan[@"id"], *date = plan[@"date"], *title = plan[@"title"], *body = plan[@"body"];
            if (![identifier isKindOfClass:NSString.class] || ![identifier hasPrefix:@"thingary-"] || [ids containsObject:identifier] || ![date isKindOfClass:NSString.class] || ![title isKindOfClass:NSString.class] || ![body isKindOfClass:NSString.class]) return strdup("提醒计划无效");
            [ids addObject:identifier];
            NSRegularExpression *format = [NSRegularExpression regularExpressionWithPattern:@"^[0-9]{4}-[0-9]{2}-[0-9]{2}$" options:0 error:nil];
            if ([format numberOfMatchesInString:date options:0 range:NSMakeRange(0, date.length)] != 1) return strdup("提醒日期无效");
            NSArray *parts = [date componentsSeparatedByString:@"-"];
            NSDateComponents *components = [NSDateComponents new];
            components.year = [parts[0] integerValue]; components.month = [parts[1] integerValue]; components.day = [parts[2] integerValue]; components.hour = 9;
            components.calendar = calendar; components.timeZone = NSTimeZone.localTimeZone;
            if (![components isValidDateInCalendar:calendar]) return strdup("提醒日期无效");
            NSDate *fire = [calendar dateFromComponents:components];
            if ([fire compare:NSDate.date] != NSOrderedDescending) continue;
            [future addObject:@{@"plan":plan, @"components":components, @"fire":fire}];
        }
        [future sortUsingComparator:^NSComparisonResult(NSDictionary *a, NSDictionary *b) {
            NSComparisonResult dateOrder = [a[@"fire"] compare:b[@"fire"]];
            return dateOrder != NSOrderedSame ? dateOrder : [a[@"plan"][@"id"] compare:b[@"plan"][@"id"]];
        }];
        dispatch_semaphore_t got = dispatch_semaphore_create(0);
        __block NSArray<UNNotificationRequest *> *pending;
        [center getPendingNotificationRequestsWithCompletionHandler:^(NSArray<UNNotificationRequest *> *requests) { pending = requests; dispatch_semaphore_signal(got); }];
        if (dispatch_semaphore_wait(got, dispatch_time(DISPATCH_TIME_NOW, 5 * NSEC_PER_SEC)) != 0) return strdup("未能核对已安排的提醒");
        NSUInteger unmanaged = 0;
        for (UNNotificationRequest *request in pending) if (![request.identifier hasPrefix:@"thingary-"]) unmanaged++;
        NSUInteger capacity = unmanaged < 64 ? 64 - unmanaged : 0;
        NSUInteger count = MIN(capacity, future.count);
        NSArray *selected = [future subarrayWithRange:NSMakeRange(0, count)];
        NSMutableSet *wanted = [NSMutableSet set];
        for (NSDictionary *item in selected) [wanted addObject:item[@"plan"][@"id"]];
        NSMutableArray *remove = [NSMutableArray array];
        for (UNNotificationRequest *request in pending) if ([request.identifier hasPrefix:@"thingary-"] && ![wanted containsObject:request.identifier]) [remove addObject:request.identifier];
        [center removePendingNotificationRequestsWithIdentifiers:remove];
        if (future.count && status != UNAuthorizationStatusAuthorized && status != UNAuthorizationStatusProvisional) return strdup("通知权限未开启；提醒日期已保存，请在“设置 › 通知 › 物谱”中允许通知");
        for (NSDictionary *item in selected) {
            NSDictionary *plan = item[@"plan"];
            UNMutableNotificationContent *content = [UNMutableNotificationContent new];
            content.title = plan[@"title"]; content.body = plan[@"body"]; content.sound = UNNotificationSound.defaultSound;
            UNCalendarNotificationTrigger *trigger = [UNCalendarNotificationTrigger triggerWithDateMatchingComponents:item[@"components"] repeats:NO];
            UNNotificationRequest *request = [UNNotificationRequest requestWithIdentifier:plan[@"id"] content:content trigger:trigger];
            dispatch_semaphore_t added = dispatch_semaphore_create(0);
            __block BOOL failed = NO;
            [center addNotificationRequest:request withCompletionHandler:^(NSError *error) { failed = error != nil; dispatch_semaphore_signal(added); }];
            if (dispatch_semaphore_wait(added, dispatch_time(DISPATCH_TIME_NOW, 5 * NSEC_PER_SEC)) != 0 || failed) return strdup("提醒尚未安排成功，请返回应用后重试");
        }
        if (future.count > count) return strdup([[NSString stringWithFormat:@"iOS 提醒队列容量有限：已安排最近 %lu 条，另有 %lu 条待后续打开物谱时补排；提醒日期已保留。", (unsigned long)count, (unsigned long)(future.count-count)] UTF8String]);
        return strdup("");
    } @catch (NSException *exception) { return strdup("当前应用身份无法使用系统通知"); } }
}
