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

- `portable.exe`：Windows 便携单文件版
- `folder.zip`：解压后直接运行的文件夹版

建议优先使用最新版本。历史版本仅用于回溯和兼容性测试。

## 使用要求

- Windows 10 或 Windows 11（x64）
- 已安装可用的 ESP-IDF 环境
- 对应开发板的 USB 串口/JTAG 驱动

首次启动后选择 ESP-IDF 安装目录和工程目录。软件配置保存在自身用户配置目录，不会向工程写入工具箱专用配置文件。

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

生成 Windows x64 便携版：

```powershell
npm run dist
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

