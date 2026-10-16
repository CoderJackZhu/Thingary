#import <Foundation/Foundation.h>
#import <LocalAuthentication/LocalAuthentication.h>
#include <stdlib.h>
#include <string.h>

int thingary_auth_available(void) {
    @autoreleasepool {
        LAContext *context = [LAContext new];
        return [context canEvaluatePolicy:LAPolicyDeviceOwnerAuthentication error:nil] ? 1 : 0;
    }
}

// Called only on a Rust blocking worker. DeviceOwnerAuthentication permits
// the system login-password fallback; no credential enters Thingary.
char *thingary_auth(const char *reason) {
    @autoreleasepool {
        LAContext *context = [LAContext new];
        if (![context canEvaluatePolicy:LAPolicyDeviceOwnerAuthentication error:nil]) {
            return strdup("这台 Mac 没有设置登录密码或 Touch ID");
        }
        dispatch_semaphore_t done = dispatch_semaphore_create(0);
        __block NSString *result = @"身份验证未完成，请重试。";
        NSString *message = reason ? [NSString stringWithUTF8String:reason] : @"解锁物谱";
        [context evaluatePolicy:LAPolicyDeviceOwnerAuthentication localizedReason:message reply:^(BOOL success, NSError *error) {
            if (success) result = @"";
            else if (error.code == LAErrorUserCancel || error.code == LAErrorAppCancel || error.code == LAErrorSystemCancel) result = @"已取消身份验证，请点解锁重试。";
            else if (error.code == LAErrorAuthenticationFailed) result = @"身份验证未通过，请重试。";
            else result = @"暂时无法验证身份，请重试或使用系统登录密码。";
            dispatch_semaphore_signal(done);
        }];
        if (dispatch_semaphore_wait(done, dispatch_time(DISPATCH_TIME_NOW, 120 * NSEC_PER_SEC)) != 0) {
            [context invalidate];
            return strdup("身份验证已超时，请点解锁重试。");
        }
        return strdup(result.UTF8String);
    }
}
