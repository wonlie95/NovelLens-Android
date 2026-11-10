# 小说伴读 Android

Android 日语阅读助手，支持原文译文对照、圈词查询、可编辑生词本、彩色标记、复习、离线汉字注音、日语朗读及 TXT、EPUB、PDF 导入，与 Windows 1.11 共享核心界面。朗读使用手机系统的日语语音引擎，需安装日语离线语音包；暂停后从语音引擎报告的位置继续。

## 构建

需要 JDK 21、Android SDK 35 和 Gradle 8.11.1。在 `android/local.properties` 中设置 `sdk.dir`，然后在 `android` 目录运行 `gradle assembleRelease`。构建出的未签名 APK 需要自行签名才能安装；发布签名密钥不包含在仓库中。

翻译、词典及 EPUB/PDF 解析组件需要网络；免费服务可能受限流或接口变化影响。

本项目代码以 MIT 许可发布。Noto Sans JP 字体采用 SIL Open Font License（`shared/OFL.txt`）；kuromoji.js 和词典许可见 `shared/kuromoji-LICENSE.txt` 与 `shared/kuromoji-NOTICE.md`。
