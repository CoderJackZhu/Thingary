#import <AppKit/AppKit.h>
#import <ImageIO/ImageIO.h>
#import <UniformTypeIdentifiers/UniformTypeIdentifiers.h>
#include <stdlib.h>
#include <string.h>

// Called only on the AppKit main thread. Ownership of the copied path passes to Rust.
char *possio_pick_image(void) {
    @autoreleasepool {
        NSOpenPanel *panel = [NSOpenPanel openPanel];
        panel.title = @"选择物品图片";
        panel.prompt = @"选择图片";
        panel.canChooseFiles = YES;
        panel.canChooseDirectories = NO;
        panel.allowsMultipleSelection = NO;
        panel.allowedContentTypes = @[UTTypeJPEG, UTTypePNG, UTTypeWebP, UTTypeHEIC, UTTypeHEIF];
        if ([panel runModal] != NSModalResponseOK) return NULL;
        return strdup(panel.URL.fileSystemRepresentation);
    }
}
void possio_free(void *bytes) { free(bytes); }
// 1 invalid/unsupported; 2 dimensions; 3 corrupt/encode/allocation failure.
// Produce an orientation-correct bounded PNG preview; never rewrite the original.
int possio_preview(const unsigned char *bytes, size_t count, unsigned char **output, size_t *length) {
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

// Backup panels. Called only on the AppKit main thread; returns NULL when cancelled.
char *possio_pick_backup_save(const char *suggested) {
    @autoreleasepool {
        NSSavePanel *panel = [NSSavePanel savePanel];
        panel.title = @"保存完整备份";
        panel.prompt = @"保存备份";
        panel.nameFieldStringValue = [NSString stringWithUTF8String:suggested];
        UTType *type = [UTType typeWithFilenameExtension:@"possio"];
        if (type) panel.allowedContentTypes = @[type];
        panel.canCreateDirectories = YES;
        if ([panel runModal] != NSModalResponseOK) return NULL;
        return strdup(panel.URL.fileSystemRepresentation);
    }
}
char *possio_pick_backup_open(void) {
    @autoreleasepool {
        NSOpenPanel *panel = [NSOpenPanel openPanel];
        panel.title = @"选择要恢复的备份";
        panel.prompt = @"检查备份";
        panel.canChooseFiles = YES;
        panel.canChooseDirectories = NO;
        panel.allowsMultipleSelection = NO;
        UTType *type = [UTType typeWithFilenameExtension:@"possio"];
        if (type) panel.allowedContentTypes = @[type];
        if ([panel runModal] != NSModalResponseOK) return NULL;
        return strdup(panel.URL.fileSystemRepresentation);
    }
}
