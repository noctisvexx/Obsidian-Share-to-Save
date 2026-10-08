# share-to-clipper

Obsidian 网页剪藏插件。本开发分支优先在 Android 上解析公开内容，直接保存
Markdown 和附件；电脑只用于桌面剪藏或可选失败兜底，不要求电脑一直开机。

这是由 **noctis** 维护的独立 fork，基于 **chenxiccc** 的
[Obsidian Share to Save](https://github.com/chenxiccc/obsidian-share-to-save)
增量开发，不是原作者发布的版本，也不表示原作者认可本分支的改动。
[本项目仓库](https://github.com/noctisvexx/Obsidian-Share-to-Save)。

插件显示名称和独立 ID 均为 `share-to-clipper`，作者为 `noctis`，
与原插件市场更新隔离；版本暂为 `5.4.4`。笔记/附件目录及任务标识不更名。
当前仍为待最终验收的候选版，尚未宣布正式发布。

## 安装与更新

1. 备份 Vault，尤其是笔记、附件和任务目录。
2. 从本分支安装包获取 `main.js`、`manifest.json`、`styles.css`，安装到
   Android 或桌面 Vault 的 `.obsidian/plugins/share-to-clipper/`。
3. 已有安装只替换这三个文件，保留 `data.json` 和所有任务文件；启用插件或
   更新后重启 Obsidian。最低 Obsidian 版本为 1.8.7，不表示所有版本都经过真机测试。
4. Android 可独立使用。需要桌面兜底时，在电脑安装同一版本并同步 Vault。

旧 share-to-save 安装不是本插件的更新目标。测试 Vault 中先停用旧插件，再启用
新插件；不要同时运行两个版本。首次使用独立 ID 时设置不会自动复制，需要重新
配置保存/任务目录。旧笔记、附件及任务不自动迁移或删除；旧手机任务可在选择其
任务目录后手动重试。快捷方式改用下方新 URI。

源码仓库不一定跟踪生成的 main.js；从源码安装需先构建。Android 沙盒存储的安装
需使用现有 Vault 文件管理方式。iOS 分享入口尚未真机验收；不再支持旧说明中
“只在电脑安装并扫描 Markdown 分享目录”的流程。

## 使用与设置

Android 分享链接到 Obsidian 后，选择本插件保存网页；也可在插件输入框粘贴
链接。桌面使用插件按钮或命令输入网址。在设置的“剪藏任务”或“查看剪藏任务”
命令中查看尚未完成的任务及错误，手动重试失败任务；中断任务可在租约到期后重试。
成功会即时提示并清理任务，不保留成功历史；附件未全部下载时在保存提示中提醒。

| 设置 | 默认与含义 |
| --- | --- |
| 笔记目录 | `Share-to-Save` |
| 任务目录 | `_ShareToSave/queue`，必须独立于笔记目录 |
| 附件位置 | 遵循 Obsidian 默认附件位置，或指定自定义 Vault 目录 |
| 自定义附件目录 | `_ShareToSave/attachments`，只在自定义策略下使用 |
| 手机优先解析 | 开启；关闭后显式分享排队等待桌面 |
| 桌面失败兜底 | 开启；关闭后不自动处理手机失败任务 |

使用现有 Vault 同步方式，同步笔记、附件及整个任务目录（包括确认文件）。
插件不提供独立同步服务。手机无空闲任务轮询，无启动全库任务扫描；桌面按
设置检查任务目录。建议只指定一台自动兜底电脑。

笔记优先用清理后的标题命名，同名以任务 ID 区分，不覆盖用户笔记。YAML 的
`sts_id` 仅保护同一任务的处理/失败重试，不用于永久链接去重。成功后再次主动
分享同一链接就是新任务，可保存另一篇笔记，无需先删除旧笔记。处理中重复分享
合并到尚未完成的任务；失败任务重试保留原 ID。移动失败任务已写出的笔记或删除
其 sts_id 可能导致重试识别失效。附件仍按内容哈希复用，不自动清理旧附件。
成功确认后清理任务 JSON、锁和临时确认文件；中断的清理及旧成功记录在下次显式
任务检查时恢复，不新增手机后台轮询。失败、未知及冲突任务保留，不建立永久
去重数据库。旧 `toBeSaved_*.json` 只在确认迁移副本后移除。普通 Markdown、
Web Clipper 笔记不用于发现任务，也不会被转换或删除。处理具体任务时会只读
检查输出目录的 sts_id，这不是全库扫描。

现有文字/图片分享不是登录浏览器内容提取。`obsidian://share-to-clipper` 可打开
输入框或传入 url/text，但没有结构化内容包导入或浏览器登录态接口。

## 平台与验证范围

| 平台 | 当前能力与限制 |
| --- | --- |
| 微信公众号、小红书 | 文章/文案、图片、元数据及短链；用户已基本 Android 真机验证，受限内容仍可能失败 |
| 普通网页 | 现有转换器和 Defuddle；用户验证了部分公开内容，不保证所有网站 |
| 知乎、Obsidian Publish | 保留专用转换流程，有自动化回归；Android 覆盖仍需分别确认 |
| B站 | 视频/动态、作者、简介、封面及可选字幕；匿名视频在线测试通过，真机字幕/动态待验收 |
| 抖音 | 公开页面数据中的文案、封面和图文；结构测试通过，用户样例返回验证页，不宣称成功 |
| X / Twitter | 公开推文、多图及公开长文/引用数据；部分链接在线通过，年龄限制明确失败；X Articles 不支持 |
| Instagram | 公开帖子、轮播及视频封面；请求头修复后用户已确认原链接 Android 真机剪藏正常，不代表所有帖子均可访问 |

视频默认只保存封面、文案和原链接，不下载播放文件。B站字幕优先中文官方/AI，
再尝试其他语言，不翻译、不总结；清理格式及相邻完全重复片段，按连续语句和
停顿分段，在简介后保存为 `## 视频字幕`。新增请求总等待上限 4 秒。
无字幕、需要登录或接口失败不会影响原视频剪藏。

## 已知限制与安全

- 登录墙、年龄验证、验证码及反机器人页面不是正文，任务失败并保留，不绕过限制。
  桌面兜底不自动拥有浏览器 Cookie，也不保证能解决访问限制。
- 浏览器扩展、已授权页面主动提取及结构化内容包导入尚未实现，列为后续计划。
- 图片失败可能保留远程链接并记录警告；保存成功不等于附件全部离线可用。
- 本插件现在按单手机使用简化任务生命周期，不做永久或跨设备链接去重。只在
  手机剪藏时可关闭桌面兜底、在同步工具中排除 `_ShareToSave/queue`，同时同步
  笔记和真实附件目录。排除整个 `_ShareToSave` 可能同时排除自定义附件。
  若仍需桌面失败兜底，必须同步未完成任务，且异步同步不保证绝不重复。
- 任务和笔记包含分享链接及正文，可能含平台必需参数。不要分享携带账户凭据的
  链接；插件没有读取浏览器 Cookie、密码或认证 Token 的功能。
- 依赖告警尚未清零，包括 Defuddle 及预打包 XML 组件的风险。不能将本候选版
  称为安全告警已解决；详见 [最终报告](FINAL_REPORT.md)。

## 开发与验收

使用 lockfile 安装：`npm ci`。执行 `npm test`、`npm run build`、
`npm run lint`；build 包含 TypeScript 检查。默认测试跳过联网样例；
`STS_LIVE_PLATFORM=1` 可开启对应在线测试。电脑在线/模拟测试不等于 Android
真机通过。[平台详情](PLATFORM_REPORT.md) · [vivo 清单与最终报告](FINAL_REPORT.md)。

## 许可证与致谢

沿用 MIT，保留 [chenxiccc 的原始版权声明](LICENSE)，同时标明 noctis 对新增和
修改部分的版权。当前维护者/插件作者是 noctis；上游项目作者仍是 chenxiccc。
不使用商业应用源码。第三方许可见 [THIRDPARTY.md](THIRDPARTY.md) 和
[完整许可文本](THIRD_PARTY_NOTICES.txt)。

## English Summary

This candidate development branch clips public content on Android first, with
optional desktop fallback. noctis is the current maintainer. It is an independent
fork of chenxiccc's Share to Save, not an upstream release. The original MIT
attribution is retained. Install the built main.js, manifest.json and styles.css
into .obsidian/plugins/share-to-clipper/ on each device. Disable the old
share-to-save plugin first. This independent ID does not automatically migrate
old settings. Preserve existing settings and unfinished tasks when updating.
Successful tasks and temporary acknowledgements are cleaned; another explicit
share is a new task. Failed tasks retain their IDs for safe retries. There is no
permanent URL dedup database. Phone-only users can sync just notes and attachments;
desktop fallback requires syncing unfinished tasks and still has sync limitations.
Existing Markdown is never used for task discovery. Authenticated browser
extraction is a future design, not an implemented feature. Login/age/CAPTCHA
restrictions are not bypassed. Android coverage and remaining dependency risks
are detailed in the final report; this is not an unconditional stable release.
