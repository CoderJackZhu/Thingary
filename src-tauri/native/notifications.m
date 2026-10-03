#import <Foundation/Foundation.h>
#import <UserNotifications/UserNotifications.h>
#include <stdlib.h>
#include <string.h>
#include <stdio.h>
@interface ThingaryNotificationDelegate : NSObject <UNUserNotificationCenterDelegate>
@end
@implementation ThingaryNotificationDelegate
- (void)userNotificationCenter:(UNUserNotificationCenter *)center willPresentNotification:(UNNotification *)notification withCompletionHandler:(void (^)(UNNotificationPresentationOptions))completionHandler {
 completionHandler(UNNotificationPresentationOptionBanner | UNNotificationPresentationOptionList | UNNotificationPresentationOptionSound);
}
@end
static ThingaryNotificationDelegate *notificationDelegate;
// Called off the main thread. Timeouts report failure; callbacks retain their own state.
char *thingary_notifications(const char *json, int ask) {
 @autoreleasepool { @try {
  UNUserNotificationCenter *center=UNUserNotificationCenter.currentNotificationCenter;
  static dispatch_once_t once; dispatch_once(&once, ^{notificationDelegate=[ThingaryNotificationDelegate new];center.delegate=notificationDelegate;});
#ifdef THINGARY_NOTIFICATION_ACCEPTANCE
  // Short delivery window is confined to the isolated acceptance identity and test builds.
  BOOL acceptance=[NSBundle.mainBundle.bundleIdentifier isEqualToString:@"local.thingary.u02.acceptance"] && getenv("THINGARY_REMINDER_TEST_SECONDS");
  if(acceptance){dispatch_semaphore_t read=dispatch_semaphore_create(0);[center getDeliveredNotificationsWithCompletionHandler:^(NSArray<UNNotification *> *items){fprintf(stderr,"U02 delivered=%lu\n",(unsigned long)items.count);fflush(stderr);dispatch_semaphore_signal(read);}];dispatch_semaphore_wait(read,dispatch_time(DISPATCH_TIME_NOW,5*NSEC_PER_SEC));}
#endif
  dispatch_semaphore_t auth=dispatch_semaphore_create(0);
  __block NSInteger status=0;__block NSString *authorizationError=nil;
  if(ask){[center requestAuthorizationWithOptions:(UNAuthorizationOptionAlert|UNAuthorizationOptionSound) completionHandler:^(BOOL granted,NSError *error){authorizationError=error.localizedDescription;status=error?-1:(granted?2:1);dispatch_semaphore_signal(auth);}];}
  else {[center getNotificationSettingsWithCompletionHandler:^(UNNotificationSettings *settings){status=settings.authorizationStatus;dispatch_semaphore_signal(auth);}];}
  if(dispatch_semaphore_wait(auth,dispatch_time(DISPATCH_TIME_NOW,15*NSEC_PER_SEC))!=0)return strdup(ask?"通知授权待确认，请在右上角系统提示中允许后重试":"通知服务未及时响应，请重试");
  if(ask&&authorizationError)return strdup([[NSString stringWithFormat:@"通知权限请求失败：%@",authorizationError] UTF8String]);
  if(ask)return strdup(status==2?"":status==1?"通知权限未开启，请在系统设置中允许物谱通知":"通知权限请求失败");
  NSData *data=[[NSString stringWithUTF8String:json] dataUsingEncoding:NSUTF8StringEncoding];
  NSArray *plans=[NSJSONSerialization JSONObjectWithData:data options:0 error:nil];
  if(![plans isKindOfClass:NSArray.class])return strdup("提醒计划无效");
  NSMutableSet *wanted=[NSMutableSet set];for(NSDictionary *p in plans)[wanted addObject:p[@"id"]];
  dispatch_semaphore_t got=dispatch_semaphore_create(0);
  [center getPendingNotificationRequestsWithCompletionHandler:^(NSArray<UNNotificationRequest *> *requests){NSMutableArray *remove=[NSMutableArray array];for(UNNotificationRequest *r in requests)if([r.identifier hasPrefix:@"thingary-"]&&![wanted containsObject:r.identifier])[remove addObject:r.identifier];[center removePendingNotificationRequestsWithIdentifiers:remove];dispatch_semaphore_signal(got);}];
  if(dispatch_semaphore_wait(got,dispatch_time(DISPATCH_TIME_NOW,5*NSEC_PER_SEC))!=0)return strdup("未能核对已安排的提醒");
  if(plans.count&&status!=UNAuthorizationStatusAuthorized&&status!=UNAuthorizationStatusProvisional)return strdup("通知权限未开启；提醒日期已保存，请在系统设置中允许通知");
  for(NSDictionary *p in plans){NSArray *parts=[p[@"date"] componentsSeparatedByString:@"-"];if(parts.count!=3)return strdup("提醒日期无效");NSDateComponents *components=[NSDateComponents new];components.year=[parts[0] integerValue];components.month=[parts[1] integerValue];components.day=[parts[2] integerValue];components.hour=9;components.calendar=NSCalendar.currentCalendar;components.timeZone=NSTimeZone.localTimeZone;
   NSDate *fire=[NSCalendar.currentCalendar dateFromComponents:components];if([fire compare:NSDate.date]!=NSOrderedDescending){[center removePendingNotificationRequestsWithIdentifiers:@[p[@"id"]]];continue;}
   UNMutableNotificationContent *content=[UNMutableNotificationContent new];content.title=p[@"title"];content.body=p[@"body"];content.sound=UNNotificationSound.defaultSound;
   UNNotificationTrigger *trigger=[UNCalendarNotificationTrigger triggerWithDateMatchingComponents:components repeats:NO];
#ifdef THINGARY_NOTIFICATION_ACCEPTANCE
   if(acceptance){NSTimeInterval seconds=MAX(10,atoi(getenv("THINGARY_REMINDER_TEST_SECONDS")));trigger=[UNTimeIntervalNotificationTrigger triggerWithTimeInterval:seconds repeats:NO];}
#endif
   UNNotificationRequest *request=[UNNotificationRequest requestWithIdentifier:p[@"id"] content:content trigger:trigger];
   dispatch_semaphore_t added=dispatch_semaphore_create(0);__block BOOL failed=NO;
   [center addNotificationRequest:request withCompletionHandler:^(NSError *error){failed=error!=nil;dispatch_semaphore_signal(added);}];
   if(dispatch_semaphore_wait(added,dispatch_time(DISPATCH_TIME_NOW,5*NSEC_PER_SEC))!=0||failed)return strdup("提醒尚未安排成功，请保持应用打开并重试");
  }
#ifdef THINGARY_NOTIFICATION_ACCEPTANCE
  if(acceptance){dispatch_semaphore_t read=dispatch_semaphore_create(0);[center getPendingNotificationRequestsWithCompletionHandler:^(NSArray<UNNotificationRequest *> *items){fprintf(stderr,"U02 pending=%lu\n",(unsigned long)items.count);fflush(stderr);dispatch_semaphore_signal(read);}];dispatch_semaphore_wait(read,dispatch_time(DISPATCH_TIME_NOW,5*NSEC_PER_SEC));}
#endif
  return strdup("");
 } @catch(NSException *e){return strdup("当前应用身份无法使用系统通知");} }
}
