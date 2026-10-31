# kanmod

坎巴拉太空计划 1（KSP 1）的本地模组管理器。Windows 安装器自带运行环境，不需要安装 Node.js；数据全部保存在本机。

官网：https://11ly322.github.io/kanmod/

![kanmod](https://img.shields.io/badge/version-0.0.2-e11d2e) ![Windows](https://img.shields.io/badge/Windows-10%2F11-1b1719) ![Node](https://img.shields.io/badge/Node.js-%E2%89%A5%2020.11-1b1719)

## 功能

- **KSP 实例检测**：扫描 Steam 库、常见安装目录，也可以手动选择包含 `GameData` 的游戏目录；自动读取 KSP 版本。
- **CKAN 模组索引**：从官方 CKAN-meta 或自定义 tar.gz / zip / JSON 导入索引，本地缓存，离线可查。
- **依赖解析与前置安装**：递归解析硬依赖、版本范围、虚拟 provides，生成安装顺序，只选择兼容版本。
- **多下载源回退**：CKAN 直链 → 镜像前缀 → GitHub Releases → SpaceDock；失败时保留每次尝试记录。下载支持 SHA256 校验。
- **安全安装**：按 CKAN `install` 规则落到 GameData / Ships / Missions 等位置；覆盖前备份；写盘失败回滚；卸载移动到回收站。
- **问题诊断**：检查缺失前置、版本约束、冲突、KSP 兼容性、重复 DLL、安装记录漂移，并读取 `KSP.log` / `output_log.txt` / `Player.log` 的异常。自动修复只处理安全的依赖安装/兼容更新，冲突移除必须确认。
- **模组关联**：依赖图、被依赖、推荐、冲突，以及模组简介页的一键跳转。
- **中文翻译**：打开英文模组简介时自动翻译简介；完整说明可手动翻译。支持 Google / MyMemory 在线翻译、本地缓存和演示内置翻译。机器翻译仅供参考。
- **本地 Web UI**：白底红色点缀，中文界面，支持键盘导航。仅监听 `127.0.0.1`，启动令牌保护 API。

## 运行环境

- Windows 10 / 11
- 使用安装器时不需要安装 Node.js；从源码运行需要 Node.js 20.11 或更高版本
- KSP 1（Steam、GOG 或手动安装均可）
- 可选：Microsoft Edge（用于独立窗口模式，没有则使用默认浏览器）

## 安装与启动

从 [Releases](https://github.com/11ly322/kanmod/releases) 下载 `kanmod-setup-0.0.2.exe`，双击安装。安装器会创建桌面和开始菜单快捷方式；启动后 `kanmod.exe` 在后台运行本地服务并自动打开界面，不再需要保持命令行窗口。

```text
默认安装位置  %LOCALAPPDATA%\Programs\kanmod
数据目录      %LOCALAPPDATA%\kanmod\data
停止服务      kanmod.exe --stop
```

安装包自带 Node.js 运行时，不会修改系统环境变量。卸载时退出 kanmod 后删除安装目录即可，数据目录会保留。

### 无法连接本地服务

1. 从桌面或开始菜单重新打开 **kanmod**，不要直接访问旧的端口地址。
2. 如果浏览器提示连接失败，先运行 `kanmod.exe --stop`，再重新打开。
3. 检查 `%LOCALAPPDATA%\kanmod\data\launcher.log`；服务地址也会写入同目录的 `last-url.txt`。
4. 端口 `4173` 被其他程序占用时，kanmod 会自动换端口；始终使用启动时打开的地址。

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

安装版默认使用 `%LOCALAPPDATA%\kanmod\data`；从源码运行时默认使用项目的 `.data/`。可用环境变量 `KANMOD_DATA_DIR` 覆盖：

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

官方 CKAN 索引：

```text
https://github.com/KSP-CKAN/CKAN-meta/archive/refs/heads/master.tar.gz
```

下载失败时可添加 GitHub 加速镜像，或在“设置 → 索引源”中导入自定义索引。索引只包含元数据；模组文件从 CKAN、SpaceDock、GitHub 等地址下载。

## 开发

```powershell
npm test          # 12 项单元测试
npm run check     # 语法检查
```

项目结构：

```text
bin/kanmod.js        源码启动器
server.js            本地 HTTP API、认证、SSE、静态 UI
src/ksp/             KSP 检测、版本、GameData 扫描
src/catalog/         CKAN 规范化、索引加载、依赖解析、下载源
src/installer.js     安装/卸载/回滚
src/diagnostics.js   依赖与日志诊断
src/translate.js     翻译与缓存
src/downloads.js     多源下载
public/              原生 ES module SPA（无构建步骤）
packaging/           Windows EXE 启动器与安装器（C#，无第三方依赖）
test/                Node 内置测试
```

## 构建 Windows 安装器

需要 Windows 自带的 .NET Framework 4.8 编译器，不需要安装额外的打包工具：

```powershell
powershell -ExecutionPolicy Bypass -File packaging\build.ps1
```

产物位于 `.artifacts/build/kanmod-setup-0.0.2.exe`。安装器把应用和 Node.js 运行时释放到 `%LOCALAPPDATA%\Programs\kanmod`，数据单独保存在 `%LOCALAPPDATA%\kanmod\data`。

## 已知限制

- 安装器未做代码签名，Windows SmartScreen 可能提示“未知发布者”；请核对下载来源为本仓库 Releases。
- 当前版本只实现 KSP 1；KSP 2 的目录与元数据格式不同。
- CurseForge 需要 API Key，配置项已保留，但尚未接入其下载 API。
- 在线翻译依赖第三方公开端点，可能限流或不可用；失败会在界面显示并允许重试。
- 无法在本仓库的离线构建环境中验证真实 KSP 安装；安装、卸载、诊断链路通过内置演示环境与单元测试验证。

## 许可

MIT，见 [LICENSE](LICENSE)。
