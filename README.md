# kanmod

坎巴拉太空计划 1（KSP 1）的本地模组管理器。Windows 安装器自带运行环境，不需要安装 Node.js；数据全部保存在本机。

官网：https://11ly322.github.io/kanmod/

![kanmod](https://img.shields.io/badge/version-0.1.0-e11d2e) ![Windows](https://img.shields.io/badge/Windows-10%2F11-1b1719) ![Node](https://img.shields.io/badge/Node.js-%E2%89%A5%2020.11-1b1719)

## 功能

- **KSP 实例检测**：扫描 Steam 库、常见安装目录，也可以手动选择包含 `GameData` 的游戏目录；自动读取 KSP 版本。
- **社区模组索引**：支持社区 `.ckan` 元数据索引，也可导入 tar.gz / zip / JSON，本地缓存，离线可查。
- **依赖解析与前置安装**：递归解析硬依赖、版本范围、虚拟 provides，生成安装顺序，只选择兼容版本；自动解析前置依赖可在设置中关闭。
- **多下载源回退**：索引直链 → 镜像前缀 → GitHub Releases → SpaceDock；失败时保留每次尝试记录。下载支持 SHA256 校验。
- **安全安装**：按 `.ckan` 的 install 规则落到 GameData / Ships / Missions 等位置；覆盖前备份；写盘失败回滚；卸载移动到回收站。
- **模组管理**：禁用（移动到 `KSP/DisabledMods`，不会继续被加载）、启用、删除到回收站；快捷更新管理器可勾选或全部更新，已安装页支持批量禁用/启用/删除；不会直接删除游戏文件。
- **图片与筛选**：模组简介页从 SpaceDock、索引说明与 GitHub README 检索展示图片，经本地代理缓存；模组库可按标签、体积筛选，已安装页可按全部/可更新/已禁用/手动安装筛选。
- **CurseForge 浏览**：配置 API Key 后可检索 KSP 项目，查看封面、截图、说明，并自动翻译标题与说明；下载与安装请前往项目页。
- **游戏启动**：检测到 KSP 实例后可在软件内直接启动游戏。
- **模组包与缓存**：导出/导入 `.ckan` 模组包，生成依赖安装计划；查看并清理下载、图片、翻译缓存。
- **应用更新**：安装器内置独立更新程序，开始菜单提供「更新 kanmod」；设置页也可检查 GitHub 最新版本。更新会保留安装目录中的游戏模组与数据。
- **问题诊断**：检查缺失前置、版本约束、冲突、KSP 兼容性、重复 DLL、安装记录漂移，并读取 `KSP.log` / `output_log.txt` / `Player.log` 的异常。自动修复只处理安全的依赖安装/兼容更新，冲突移除必须确认。
- **模组关联**：依赖图、被依赖、推荐、冲突，以及模组简介页的一键跳转。
- **中文翻译**：自动翻译英文模组的标题与简介，标签使用本地词典；完整说明可手动翻译。支持 Google / MyMemory 在线翻译、本地缓存和演示内置翻译。机器翻译仅供参考。
- **本地 Web UI**：白底红色点缀，中文界面，支持键盘导航。仅监听 `127.0.0.1`，启动令牌保护 API。

## 运行环境

- Windows 10 / 11
- 使用安装器时不需要安装 Node.js；从源码运行需要 Node.js 20.11 或更高版本
- KSP 1（Steam、GOG 或手动安装均可）
- 可选：Microsoft Edge（用于独立窗口模式，没有则使用默认浏览器）

## 安装与启动

从 [Releases](https://github.com/11ly322/kanmod/releases) 下载 `kanmod-setup-0.1.0.exe`，双击安装。安装器会创建桌面和开始菜单快捷方式；启动后 `kanmod.exe` 在后台运行本地服务并自动打开界面，不再需要保持命令行窗口。

```text
默认安装位置  第一个非 C 盘的 \Programs\kanmod（可在安装器里修改）
数据目录      <安装目录>\data
停止服务      kanmod.exe --stop
更新          开始菜单 → 更新 kanmod，或应用内 设置 → 检查更新
卸载          开始菜单 → 卸载 kanmod，或 Windows 设置 → 应用
```

安装包自带 Node.js 运行时，不会修改系统环境变量。**程序、模组数据、缓存、备份和回收站都在安装目录内**；默认优先选择非 C 盘，卸载程序会停止服务并删除整个安装目录，C 盘不会留下用户数据。

安装器使用 `asInvoker` 清单，不会请求管理员权限；安装目录及其中的文件归当前 Windows 用户所有。覆盖安装会先结束旧的 kanmod 守护/启动/更新进程，再替换程序文件，并保留 `data` 目录。若目录仍被其他程序占用，安装器会短暂重试并给出明确提示，不会把整个分区改成管理员所有。

从 0.0.3 升级时，旧数据会从 `%LOCALAPPDATA%\kanmod\data` 自动迁移到新安装目录，迁移成功后清理旧目录。

### 无法连接本地服务

1. 从桌面或开始菜单重新打开 **kanmod**，不要直接访问旧的端口地址。
2. kanmod 由后台守护进程托管，服务异常退出会自动重启；页面断线后也会自动重试，不需要反复刷新。
3. 如果浏览器提示连接失败，先运行 `kanmod.exe --stop`，再重新打开。
4. 检查 `launcher.log` 与 `supervisor.log`（位于数据目录）；服务地址也会写入同目录的 `last-url.txt`。
5. 端口 `4173` 被其他程序占用时，kanmod 会自动换端口；始终使用启动时打开的地址。

### 从源码运行

```powershell
npm start          # 启动后自动打开窗口
npm run demo       # 离线演示，不需要安装 KSP
```

### 离线演示

没有安装 KSP 也可以完整体验。演示会创建临时 KSP 目录、示例模组、日志和内置索引：

```powershell
npm run demo
```

演示数据位于 `D:\kanmod\.data\demo\`。使用 `npm run demo -- --fresh` 重建。

### 常用参数

```text
node bin/kanmod.js --demo --fresh --no-open
node bin/kanmod.js --port=4180
node bin/kanmod.js --no-open
node bin/kanmod.js --help
```

## 数据目录

安装版默认使用 `<安装目录>\data`；从源码运行时默认使用项目的 `.data/`。可用环境变量 `KANMOD_DATA_DIR` 覆盖：

```text
data/
  config.json              实例、索引源、安装与网络设置
  runtime.json             运行中的服务地址、端口和 PID
  last-url.txt             最近一次启动地址
  launcher.log             EXE 启动器错误日志
  token                    本地 API 启动令牌
  instances/<id>/registry.json
  downloads/               下载缓存
  backups/                 覆盖前备份
  trash/                   卸载回收站
  demo/                    演示环境
  translations/            翻译缓存
```

## 网络与索引

社区 `.ckan` 索引源：

```text
https://github.com/KSP-CKAN/CKAN-meta/archive/refs/heads/master.tar.gz
```

下载失败时可添加 GitHub 加速镜像，或在“设置 → 索引源”中导入自定义索引。索引只包含元数据；模组文件从索引直链、SpaceDock、GitHub 等地址下载。CurseForge 项目通过官方 API 只读浏览，下载与安装请前往项目页。

## 开发

```powershell
npm test          # 24 项单元测试
npm run test:e2e  # 48 项 HTTP 端到端测试（演示实例）
npm run check     # 语法检查
```

项目结构：

```text
bin/kanmod.js        源码启动器与守护进程
server.js            薄门面：再导出本地服务
src/server/app.js    服务组装：路由分发、认证、SSE、静态 UI
src/server/http.js   HTTP 基础：请求体、Cookie、错误、静态文件
src/server/router.js 轻量路由表（字符串 / 正则匹配）
src/server/routes/api.js 全部 API 路由处理器
src/server/services.js   领域服务：实例、安装、诊断、翻译、缓存
src/version.js       版本单一来源
src/ksp/             KSP 检测、版本、GameData 扫描
src/catalog/         .ckan 规范化、索引加载、依赖解析、下载源
src/installer.js     安装/卸载/回滚
src/diagnostics.js   依赖与日志诊断
src/translate.js     翻译与缓存
src/tagTranslations.js 标签中文词典
src/curseforge.js    CurseForge 只读检索与详情映射
src/downloads.js     多源下载
public/app.js        SPA 外壳：渲染、启动、事件绑定
public/js/core.js    状态、API 客户端、通用组件
public/js/views.js   视图渲染
public/js/actions.js 数据加载与交互动作
public/styles.css    全部样式（白底红点缀）
packaging/           Windows EXE 启动器、安装器与安装核心（C#，无第三方依赖）
test/                Node 内置测试（单元 + 端到端）
```

## 构建 Windows 安装器

需要 Windows 自带的 .NET Framework 4.8 编译器，不需要安装额外的打包工具：

```powershell
powershell -ExecutionPolicy Bypass -File packaging\build.ps1
```

产物位于 `.artifacts/build/kanmod-setup-0.1.0.exe`。安装器把应用、Node.js 运行时、启动器、卸载器和数据全部放在用户选择的安装目录；默认优先选择非 C 盘。安装器会写入 HKCU 卸载注册项并创建“卸载 kanmod”快捷方式。

## 已知限制

- 安装器未做代码签名，Windows SmartScreen 可能提示“未知发布者”；请核对下载来源为本仓库 Releases。
- 当前版本只实现 KSP 1；KSP 2 的目录与元数据格式不同。
- 已用真实 KSP 1.12.5 实例做过只读扫描验证；未在真实游戏内执行批量禁用、更新或删除，建议首次操作前保留 `GameData` 备份。
- CurseForge 通过官方 API 只读浏览，需要 API Key；不通过其 API 下载或安装项目。
- 在线翻译依赖第三方公开端点，可能限流或不可用；失败会在界面显示并允许重试。

## 许可

MIT，见 [LICENSE](LICENSE)。
