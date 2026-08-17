# ESP-IDF Toolbox

一款面向 Windows 的独立 ESP-IDF 图形工具箱，将常用的工程、构建、烧录、串口监视和配置功能集中在一个中文桌面应用中。无需依赖 VS Code 即可使用。

> 本项目不是 Espressif 官方产品，也不代表 Espressif Systems。ESP-IDF、相关工具及部分 Webview 界面的版权归各自权利人所有。

## 主要功能

- 自动发现或手动选择 ESP-IDF 安装目录
- 打开、创建和切换 ESP-IDF 工程
- 选择目标芯片并运行构建、完整清理和重新配置
- UART、JTAG 和 DFU 烧录工作流
- 多实例运行，分别操作不同工程和设备
- 串口监视、发送文本或十六进制数据、保留历史输出
- 图形化 SDK 配置编辑器与字符版 `menuconfig`
- 分区表、NVS、固件大小分析和其他 Espressif 工具界面
- ESP Component Registry 浏览与 `idf.py add-dependency` 日志
- 任务停止、彩色日志、完成提示音和环境诊断

## 下载

请前往 [Releases](https://github.com/luocuiyu/ESP-IDF-Toolbox/releases) 下载：

- `Setup.exe`：推荐的 Windows 安装版，可选择安装目录，并创建桌面和开始菜单快捷方式
- `portable.exe`：无需安装的 Windows 便携单文件版（按需提供）

安装版支持中英文安装向导；已经安装旧版本时，可以直接运行新版安装包覆盖升级。建议始终使用最新版本。

## 使用要求

- Windows 10 或 Windows 11（x64）
- 已安装可用的 ESP-IDF 环境
- 对应开发板的 USB 串口/JTAG 驱动

首次启动后选择 ESP-IDF 安装目录和工程目录。软件配置保存在自身用户配置目录，不会向工程写入工具箱专用配置文件。

### 环境与路径发现

程序不会依赖开发者电脑上的固定盘符或目录。它会依次检查：

- 官方 `~/.espressif/idf-env.json` 和 `esp_idf.json`
- 系统的 `IDF_PATH` 与 `IDF_TOOLS_PATH`
- 曾通过程序手动选择并保存的 ESP-IDF 目录
- ESP-IDF 目录的相邻父目录中可用的 `python_env`

如果源码目录和工具目录安装在不同位置，手动选择 ESP-IDF 后，程序会继续提示选择包含 `python_env` 的 `IDF_TOOLS_PATH`。切换到另一台电脑时，失效的旧工程、串口和 ESP-IDF 路径不会强行覆盖当前电脑检测到的有效环境。

当前发布的可执行文件面向 Windows 10/11 x64。“通用”指不绑定盘符、用户名、ESP-IDF 版本或安装目录，可在满足依赖的 Windows 电脑上使用；macOS/Linux 尚未提供正式安装包。

## 从源码运行

需要 Node.js 20 或更高版本。

```powershell
npm install
npm run dev
```

构建前端和 Electron 主进程：

```powershell
npm run build
```

生成 Windows x64 安装包：

```powershell
npm run dist
```

按需生成便携单文件版：

```powershell
npm run dist:portable
```

ESP-IDF 由用户单独安装，本仓库不会捆绑 ESP-IDF 工具链。

## 项目结构

- `src/`：Vue 用户界面
- `electron/`：Electron 主进程、预加载桥接和 ESP-IDF 调用
- `public/espressif/`：经独立适配的 Espressif Webview 资源
- `THIRD-PARTY-NOTICES.txt`：第三方组件和版权说明
- `LICENSES/`：第三方许可证全文

## 开源许可

本项目自行编写的代码使用 [MIT License](LICENSE)。

仓库内由 Espressif ESP-IDF VS Code 扩展改编或随附的资源继续遵循 Apache License 2.0；Codicons 等第三方内容遵循其各自许可证。详情见 [THIRD-PARTY-NOTICES.txt](THIRD-PARTY-NOTICES.txt)。MIT 许可证不会覆盖第三方材料。

## 反馈

发现问题时，请在 [GitHub Issues](https://github.com/luocuiyu/ESP-IDF-Toolbox/issues) 中附上：

- 工具箱版本
- ESP-IDF 版本和目标芯片
- 烧录方式及串口/JTAG 信息
- 去除隐私内容后的完整任务日志
