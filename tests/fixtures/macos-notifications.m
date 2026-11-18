#import <Foundation/Foundation.h>
#import <UserNotifications/UserNotifications.h>
#include <assert.h>

@interface TestNotificationSettings : NSObject
@property NSInteger authorizationStatus;
@end
@implementation TestNotificationSettings
@end

@interface TestNotificationCenter : NSObject
@property id<UNUserNotificationCenterDelegate> delegate;
@property NSInteger status;
@property BOOL granted;
@property NSError *error;
@property NSInteger permissionRequests;
@property NSInteger scheduled;
+ (instancetype)currentNotificationCenter;
@end
@implementation TestNotificationCenter
+ (instancetype)currentNotificationCenter {
 static TestNotificationCenter *center;
 if(!center)center=[TestNotificationCenter new];
 return center;
}
- (void)requestAuthorizationWithOptions:(UNAuthorizationOptions)options completionHandler:(void (^)(BOOL,NSError *))completion {
 self.permissionRequests++;
 completion(self.granted,self.error);
}
- (void)getNotificationSettingsWithCompletionHandler:(void (^)(UNNotificationSettings *))completion {
 TestNotificationSettings *settings=[TestNotificationSettings new];
 settings.authorizationStatus=self.status;
 completion((UNNotificationSettings *)settings);
}
- (void)getPendingNotificationRequestsWithCompletionHandler:(void (^)(NSArray<UNNotificationRequest *> *))completion {
 completion(@[]);
}
- (void)removePendingNotificationRequestsWithIdentifiers:(NSArray<NSString *> *)identifiers {}
- (void)addNotificationRequest:(UNNotificationRequest *)request withCompletionHandler:(void (^)(NSError *))completion {
 self.scheduled++;
 completion(nil);
}
@end

#define UNUserNotificationCenter TestNotificationCenter
#include "../../src-tauri/native/notifications.m"
#undef UNUserNotificationCenter

int main(void) {
 @autoreleasepool {
  assert(NSBundle.mainBundle.bundleIdentifier);
  TestNotificationCenter *center=TestNotificationCenter.currentNotificationCenter;
  const char *plans="[{\"id\":\"thingary-fictional\",\"date\":\"2099-01-01\",\"title\":\"虚构提醒\",\"body\":\"测试\"}]";
  center.status=UNAuthorizationStatusNotDetermined;
  char *message=thingary_notifications(plans,0);
  assert(strstr(message,"尚未申请通知权限"));
  assert(center.permissionRequests==0&&center.scheduled==0);
  free(message);
  message=thingary_notifications("[]",1);
  assert(strstr(message,"尚未申请通知权限"));
  assert(center.permissionRequests==1&&center.scheduled==0);
  free(message);
  center.status=UNAuthorizationStatusDenied;
  message=thingary_notifications(plans,0);
  assert(strstr(message,"系统设置中允许通知"));
  assert(center.scheduled==0);
  free(message);
  center.error=[NSError errorWithDomain:@"Fictional" code:1 userInfo:@{NSLocalizedDescriptionKey:@"虚构服务失败"}];
  message=thingary_notifications("[]",1);
  assert(strstr(message,"虚构服务失败"));
  free(message);
  center.error=nil;
  center.granted=YES;
  center.status=UNAuthorizationStatusAuthorized;
  message=thingary_notifications("[]",1);
  assert(!strlen(message)&&center.scheduled==0);
  free(message);
  message=thingary_notifications(plans,0);
  assert(!strlen(message)&&center.scheduled==1);
  free(message);
  center.status=UNAuthorizationStatusProvisional;
  message=thingary_notifications(plans,0);
  assert(!strlen(message)&&center.scheduled==2);
  free(message);
  center.status=UNAuthorizationStatusNotDetermined;
  message=thingary_notifications("[]",0);
  assert(!strlen(message)&&center.scheduled==2);
  free(message);
  puts("macOS authorization and scheduling regression checks passed");
 }
 return 0;
}
