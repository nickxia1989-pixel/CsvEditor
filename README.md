# CSV Workspace Editor

面向大型游戏项目的本地 CSV 工作台。它不是一个通用表格玩具，而是为了在 AI 时代和 AI 一起编辑海量配置表而设计：策划、程序和 AI 代理可以同时围绕同一批 CSV 工作，编辑器负责浏览、搜索、校验、热刷新和冲突提示。

核心目标很简单：解决用 Excel 打开 CSV 时，AI 或脚本想同时改表就必须先关闭 Excel 的痛点。CSV Workspace Editor 不长期占用文件，干净页签会自动刷新磁盘变化，未保存页签会保留本地编辑并标记冲突，让你可以一边查看和手改，一边让 AI 在后台批量改表。

相比 VS Code 里的同类 CSV 插件，它更像一个面向游戏配置目录的专用编辑器：目录树、多页签、左右分栏、全表搜索、筛选、冻结、批量行列操作、收藏、路径复制、编码保护和桌面端烟测都围绕日常配表工作流设计。

## 适合什么场景

- 大型 2D/MMO/数值项目中，`Tables/` 目录下有大量 CSV 配置表。
- AI 代理、脚本或批处理会直接修改 CSV 文件，希望编辑器能实时反映变化。
- 需要比纯文本 diff 更直观地浏览、筛选、查找和编辑配置。
- 不希望 Excel 锁文件，也不希望每次 AI 改表后反复关闭、重开表格。
- 希望本地离线工作，不把项目配置上传到云端服务。

## 核心能力

### AI 协作友好的自动刷新

- 每 5 秒检查已打开 CSV 的磁盘版本。
- 干净页签在磁盘变化后自动热刷新，适合观察 AI 或脚本的改表结果。
- 有未保存修改的页签不会被覆盖，只会标记磁盘冲突。
- 保存前再次检查磁盘版本，避免把 AI 刚写入的结果误覆盖。
- 读取和热刷新不会长期占用 CSV 文件，写入时才短暂申请写权限。

### 面向项目目录的浏览体验

- 选择一个本地目录后，左侧以树形结构浏览全部 CSV。
- 支持收藏常用表格，快速回到高频配置。
- 记录上次打开的目录和页签，下次启动可自动恢复工作现场。
- 支持复制文件全路径：文件树右键、页签右键、工具区按钮都可以复制。
- 支持多页签，页签可拖拽排序，当前页签视觉高亮。
- 支持左右分栏，同时对照两张不同表格。

### 比文本编辑器更完整的表格编辑

- 虚拟滚动表格，适合较大的 CSV。
- 单元格编辑、顶部编辑栏编辑、复制/粘贴 TSV。
- 撤销/重做、插入/删除行列、追加行列。
- 拖拽列宽，支持缩放。
- 支持锁定选区，锁定格不可编辑。
- 支持冻结到当前格，便于查看大表。
- 支持类似 Excel 的列筛选，筛选后保留原始行号，并标记隐藏行断点。
- 支持自动热刷开关，必要时可暂停自动应用磁盘变化。

### 为查表和定位设计的搜索

- 当前表查找/替换在侧边栏中完成，支持跳转结果。
- 全表搜索会扫描当前目录下所有 CSV，并实时刷出结果。
- 全表搜索结果按“命中内容、表格名、主键 ID、字段名”展示，方便快速判断是不是要找的配置。
- 主键 ID 默认取命中行第一列，字段名默认取命中列第二行，贴合常见游戏配置表结构。
- 全表搜索记录会保留最近结果，重新打开面板后会恢复选中项和滚动位置。
- 某一组全表搜索历史可以手动删除。
- 支持快速打开文件，适合在大量表格中快速跳转。

### 保存语义和编码保护

- 打开时在 UTF-8 与 GB18030 之间选择更可靠的解码结果，降低旧项目中文乱码风险。
- 保存时保留 UTF-8 BOM、原始换行风格和 CSV 结构语义。
- 对不齐列宽、尾部分隔符等 CSV 细节做了保护，避免编辑一格导致整表格式被无意义改写。
- 保存前有磁盘版本冲突检查，减少多人或 AI 并发修改时的误覆盖。

### 桌面端优先

- 提供 Electron 桌面版，直接读写本地目录，不依赖外部浏览器。
- Windows 打包产物是完整目录：

```text
release\CSV Workspace Editor
```

- Windows 可执行文件路径：

```text
release\CSV Workspace Editor\CSV Workspace Editor.exe
```

- macOS 打包产物是 `.app`：

```text
release-mac/CSV Workspace Editor.app
```

## 推荐工作流

1. 打开游戏项目的配置表目录，例如 `Tables/`。
2. 在编辑器中查看、筛选、搜索和手工调整关键表。
3. 让 AI 代理或脚本在后台修改 CSV 文件。
4. 干净页签会自动刷新，你可以直接看到 AI 改表结果。
5. 如果你正在手改某张表，编辑器会保留你的改动并提示磁盘冲突。
6. 用全表搜索、快速打开、复制路径等功能，把问题表和具体字段快速交给 AI 继续处理。

## 快速开始

### 使用桌面版

#### Windows

双击根目录的 `start-desktop.bat`。

脚本会优先打开已打包的桌面程序；如果还没有打包产物，会回退到本地 Electron 启动方式。

生成或刷新 Windows 桌面版：

```powershell
npm run dist:win
```

旧命令仍然保留，等价于 Windows 打包：

```powershell
npm run dist:desktop
```

#### macOS

生成或刷新 macOS 桌面版：

```bash
npm run dist:mac
```

生成后可以直接打开：

```bash
open "release-mac/CSV Workspace Editor.app"
```

当前 macOS 产物用于本机和内部测试，尚未做开发者签名和 notarization；如果要发给其他 Mac 用户，后续还需要补签名发布流程。

### 使用浏览器开发版

```powershell
npm install
npm run dev
```

然后打开：

```text
http://127.0.0.1:5173/
```

浏览器版选择本地目录依赖 Chromium 的 File System Access API，请使用 Chrome 或 Edge。

也可以使用根目录脚本：

```powershell
npm run start:editor
npm run stop:editor
```

## 常用命令

```powershell
npm test
npm run build
npm run desktop:smoke
npm run dist:win
node scripts\desktop-smoke.cjs --exe "release\CSV Workspace Editor\CSV Workspace Editor.exe"
```

macOS 打包和已打包产物烟测：

```bash
npm run dist:mac
node scripts/desktop-smoke.cjs --app "release-mac/CSV Workspace Editor.app"
```

`npm run desktop:smoke` 会启动真实 Electron 窗口做端到端烟测，覆盖目录打开、编辑保存、热刷新、筛选、搜索、全表搜索、快速打开、左右分栏、收藏、复制路径和关键视觉状态。

## 当前状态

项目仍在快速迭代中，功能重点是大型游戏 CSV 工作流、AI 协作改表、桌面端稳定性和表格编辑体验。它优先服务本地配置目录，不追求替代 Excel 的所有通用电子表格能力。
