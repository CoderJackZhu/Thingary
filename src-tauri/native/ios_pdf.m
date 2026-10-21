// An isolated WebKit print surface. No scripts, remote resources or persistent
// website data. UIKit/WebKit operations and cleanup all stay on the main queue.
#import <UIKit/UIKit.h>
#import <WebKit/WebKit.h>
#include <stdlib.h>
#include <string.h>

@interface ThingaryReportRenderer : UIPrintPageRenderer
@end
@implementation ThingaryReportRenderer
- (CGRect)paperRect { return CGRectMake(0, 0, 595.28, 841.89); }
- (CGRect)printableRect { return CGRectInset(self.paperRect, 28, 28); }
@end

@interface ThingaryPDF : NSObject <WKNavigationDelegate>
@property(nonatomic, strong) WKWebView *view;
@property(nonatomic, strong) dispatch_semaphore_t done;
@property(nonatomic, copy) NSString *path;
@property(nonatomic, copy) NSString *message;
@property(nonatomic) BOOL finished;
- (void)finish:(NSString *)message;
@end
@implementation ThingaryPDF
- (void)finish:(NSString *)message {
    if (self.finished) return;
    self.finished = YES;
    self.message = message;
    [self.view stopLoading];
    self.view.navigationDelegate = nil;
    [self.view removeFromSuperview];
    self.view = nil;
    dispatch_semaphore_signal(self.done);
}
- (void)webView:(WKWebView *)view didFailNavigation:(WKNavigation *)navigation withError:(NSError *)error { [self finish:@"报告加载失败，请重试"]; }
- (void)webView:(WKWebView *)view didFailProvisionalNavigation:(WKNavigation *)navigation withError:(NSError *)error { [self finish:@"报告加载失败，请重试"]; }
- (void)webViewWebContentProcessDidTerminate:(WKWebView *)view { [self finish:@"报告渲染被系统中断，请重试"]; }
- (void)webView:(WKWebView *)view didFinishNavigation:(WKNavigation *)navigation {
    if (self.finished) return;
    [view layoutIfNeeded];
    // The print formatter applies the report's @media print rules and repeats
    // page layout at A4 size. It avoids a single very tall PDF page.
    UIPrintPageRenderer *renderer = [ThingaryReportRenderer new];
    CGRect paper = renderer.paperRect;
    [renderer addPrintFormatter:view.viewPrintFormatter startingAtPageAtIndex:0];
    NSInteger pages = renderer.numberOfPages;
    if (pages <= 0 || pages > 200) { [self finish:@"报告页数超出可导出范围"]; return; }
    NSMutableData *pdf = [NSMutableData data];
    UIGraphicsBeginPDFContextToData(pdf, paper, nil);
    [renderer prepareForDrawingPages:NSMakeRange(0, pages)];
    for (NSInteger index = 0; index < pages; index++) {
        UIGraphicsBeginPDFPage();
        [renderer drawPageAtIndex:index inRect:paper];
    }
    UIGraphicsEndPDFContext();
    NSError *error;
    BOOL saved = pdf.length > 0 && pdf.length <= 32 * 1024 * 1024 && [pdf writeToFile:self.path options:NSDataWritingAtomic error:&error];
    [self finish:saved ? @"" : @"PDF 未保存，请检查可用空间并重试"];
}
@end

char *thingary_ios_render_pdf(const char *html, const char *path) {
    @autoreleasepool {
        if (NSThread.isMainThread) return strdup("{\"status\":\"error\",\"message\":\"请在后台导出报告\"}");
        ThingaryPDF *operation = [ThingaryPDF new];
        operation.done = dispatch_semaphore_create(0);
        operation.path = [NSString stringWithUTF8String:path];
        NSString *body = [NSString stringWithUTF8String:html];
        dispatch_async(dispatch_get_main_queue(), ^{
            WKWebViewConfiguration *config = [WKWebViewConfiguration new];
            config.websiteDataStore = WKWebsiteDataStore.nonPersistentDataStore;
            config.defaultWebpagePreferences.allowsContentJavaScript = NO;
            operation.view = [[WKWebView alloc] initWithFrame:CGRectMake(-10000, 0, 794, 1123) configuration:config];
            operation.view.navigationDelegate = operation;
            operation.view.accessibilityElementsHidden = YES;
            // This CSP precedes every caller-controlled byte. Even malformed
            // report HTML cannot enable remote requests or script execution.
            NSString *policy = @"<meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; style-src 'unsafe-inline'; img-src data:\">";
            [operation.view loadHTMLString:[policy stringByAppendingString:body] baseURL:nil];
        });
        if (dispatch_semaphore_wait(operation.done, dispatch_time(DISPATCH_TIME_NOW, 45 * NSEC_PER_SEC)) != 0) {
            dispatch_async(dispatch_get_main_queue(), ^{
                [operation finish:@"PDF 导出超时，请重试"];
                // A slow synchronous print may finish after the worker timed
                // out. Remove only this operation's private temporary file.
                [NSFileManager.defaultManager removeItemAtPath:operation.path error:nil];
            });
            return strdup("{\"status\":\"error\",\"message\":\"PDF 导出超时，请重试\"}");
        }
        NSDictionary *result = operation.message.length ? @{@"status":@"error", @"message":operation.message} : @{@"status":@"completed"};
        NSData *data = [NSJSONSerialization dataWithJSONObject:result options:0 error:nil];
        return strdup([[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding].UTF8String);
    }
}
