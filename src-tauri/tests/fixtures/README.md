# 合成图片夹具

`camera.png` 是程序生成的 480×320 几何相机图案，不含真实照片、人物或设备元数据。`camera.heic` 用本机 `sips -s format heic camera.png --out camera.heic` 转换，用于 ImageIO 读取、原字节保留和原生选择器测试。JPEG/WebP 及 EXIF 方向样例在测试中从 PNG 即时生成。
