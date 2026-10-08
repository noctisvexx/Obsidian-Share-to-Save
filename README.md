# Share to Save

Obsidian 网页剪藏插件。本开发分支优先在 Android 上解析公开内容，直接保存
Markdown 和附件；电脑只用于桌面剪藏或可选失败兜底，不要求电脑一直开机。

当前是待最终验收的候选版，不是已经宣布发布的稳定版。插件 ID `share-to-save`、
名称 `Share to Save`、版本 `5.4.4` 和原作者信息保持不变。

## 安装与更新

1. 备份 Vault，尤其是笔记、附件和任务目录。
2. 从本分支安装包获取 `main.js`、`manifest.json`、`styles.css`，安装到
   Android 或桌面 Vault 的 `.obsidian/plugins/share-to-save/`。
3. 已有安装只替换这三个文件，保留 `data.json` 和所有任务文件；启用插件或
   更新后重启 Obsidian。最低 Obsidian 版本为 1.8.7，不表示所有版本都经过真机测试。
4. Android 可独立使用。需要桌面兜底时，在电脑安装同一版本并同步 Vault。

源码仓库不一定跟踪生成的 main.js；从源码安装需先构建。Android 沙盒存储的安装
需使用现有 Vault 文件管理方式。iOS 分享入口尚未真机验收；不再支持旧说明中
“只在电脑安装并扫描 Markdown 分享目录”的流程。

## 使用与设置

Android 分享链接到 Obsidian 后，选择本插件保存网页；也可在插件输入框粘贴
链接。桌面使用插件按钮或命令输入网址。在设置的“剪藏任务”或“查看剪藏任务”
命令中查看状态、错误及附件警告，手动重试失败任务；中断任务可在租约到期后重试。

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
`sts_id` 用于重试去重；删除保存的笔记后主动重新分享可以再次剪藏。移动笔记
或删除 sts_id 可能导致识别失效。附件按内容哈希复用，不自动清理旧附件。
失败任务保留；旧 `toBeSaved_*.json` 只在确认迁移副本后移除。普通 Markdown、
Web Clipper 笔记不用于发现任务，也不会被转换或删除。处理具体任务时会只读
检查输出目录的 sts_id，这不是全库扫描。

现有文字/图片分享不是登录浏览器内容提取。`obsidian://share-to-save` 可打开
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
| Instagram | 公开帖子、轮播及视频封面；先前真机失败已针对请求头修复，在线通过，Android 仍待复测 |

视频默认只保存封面、文案和原链接，不下载播放文件。B站字幕优先中文官方/AI，
再尝试其他语言，不翻译、不总结；清理格式及相邻完全重复片段，按连续语句和
停顿分段，在简介后保存为 `## 视频字幕`。新增请求总等待上限 4 秒。
无字幕、需要登录或接口失败不会影响原视频剪藏。

## 已知限制与安全

- 登录墙、年龄验证、验证码及反机器人页面不是正文，任务失败并保留，不绕过限制。
  桌面兜底不自动拥有浏览器 Cookie，也不保证能解决访问限制。
- 浏览器扩展、已授权页面主动提取及结构化内容包导入尚未实现，列为后续计划。
- 图片失败可能保留远程链接并记录警告；保存成功不等于附件全部离线可用。
- 文件同步不是分布式事务。任务锁、确认文件和稳定 ID 降低重复风险，但两台
  离线设备同时处理后仍可能同步冲突，不能承诺绝不重复。
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

MIT，保留 [chenxiccc 的原始版权声明](LICENSE)。在原项目基础上增量开发，
不使用商业应用源码。第三方许可见 [THIRDPARTY.md](THIRDPARTY.md) 和
[完整许可文本](THIRD_PARTY_NOTICES.txt)。

## English Summary

This candidate development branch clips public content on Android first, with
optional desktop fallback. Install the built main.js, manifest.json and styles.css
into .obsidian/plugins/share-to-save/ on each device. Preserve existing settings
and tasks when updating. Sync notes, attachments and the complete isolated task
folder using your existing Vault sync. Failed tasks are retained and retryable.
Existing Markdown is never used for task discovery. Authenticated browser
extraction is a future design, not an implemented feature. Login/age/CAPTCHA
restrictions are not bypassed. Android coverage and remaining dependency risks
are detailed in the final report; this is not an unconditional stable release.
