# CSV Workspace Editor Test Plan

## Scope

目标是验证本地浏览器 CSV 编辑器的基础可用性、显示布局和交互一致性。测试过程中只读使用 `D:\2D_AI_WORKING\Tables`，不得写入真实表格目录。

## Test Matrix

| Area | Requirement | Test Method | Expected Result |
| --- | --- | --- | --- |
| 启动关闭 | 双击/命令行启动 | `start-editor.bat`, `npm run start:editor` | 服务启动到 `http://127.0.0.1:5173/`，日志可查 |
| 启动关闭 | 双击/命令行关闭 | `stop-editor.bat`, `npm run stop:editor` | 关闭被脚本启动或接管的 dev server |
| 目录选择 | Chrome/Edge 选择本地目录 | Browser manual smoke | 左侧加载目录，读模式不锁文件 |
| 目录树 | 大目录滚动 | Browser + synthetic large tree | 文件列表可滚轮滚动、拖 scrollbar、搜索后仍可滚动 |
| 目录树 | 懒加载展开/折叠 | Component test + Browser smoke | 目录展开只加载该层，折叠不丢子节点 |
| 目录树 | 筛选 | Component test + Browser smoke | 已加载节点按名称/路径筛选，父目录保留 |
| 多标签 | 打开多个 CSV | App integration test | 已打开文件进入上方标签，重复打开只激活旧标签 |
| 多标签 | 未保存提示和关闭保护 | App integration test | 脏标签有标记，关闭/刷新前提示 |
| 表格显示 | 大 CSV 虚拟滚动 | Browser + sample stress data | 横纵滚动顺畅，表头/行号对齐 |
| 表格编辑 | 单元格、公式栏编辑 | Grid/App tests + Browser smoke | 修改写入选中格，状态变未保存 |
| 表格编辑 | 复制/粘贴 TSV | Grid test | 多格粘贴正确，锁定格跳过 |
| 表格编辑 | Delete/Backspace 清空选区 | Grid test | 只清空未锁定格 |
| 表格编辑 | 键盘导航 | Grid test | 方向键、Tab、Enter/F2 行为稳定 |
| 锁定 | 锁定/解锁选区 | Grid/App tests | 锁定格不可编辑，删除行列受保护 |
| 缩放 | 放大/缩小格子 | Grid test + Browser smoke | 行高、列宽、表头同步缩放，布局不溢出 |
| 冻结 | 冻结到指定格 | Browser smoke | 冻结区域滚动时保持可见且不遮挡 |
| 行列操作 | 插入/删除/追加行列 | Grid/App tests | 数据和锁定格坐标同步移动 |
| 查找替换 | 查找上一处/下一处、替换 | Unit/Grid tests | 大小写不敏感，替换跳过锁定格 |
| 热刷新 | 干净页签自动刷新 | Tab model/App test | 外部变化自动重读，不长期占用文件 |
| 热刷新 | 脏页签冲突提示 | Tab model/App test | 有未保存内容时只标记冲突，不覆盖本地编辑 |
| 保存 | 保存当前/全部保存 | App integration test | 写入前检查磁盘版本，未保存计数归零 |
| 编码 | UTF-8/GB18030/BOM | Unit test + table scan | 自动识别常见中文表，保存保留 BOM |
| 真实表扫描 | Tables 只读解析 | `npm run check:tables` | 所有 CSV 可解析，统计最大行列和编码 |
| 构建质量 | 单元测试和生产构建 | `npm test`, `npm run build` | 全部通过，无 TypeScript/构建错误 |

## Browser Smoke Checklist

1. 启动服务并打开首页。
2. 点击 `样例`，展开目录树，打开两个 CSV。
3. 验证标签切换、关闭按钮、未保存标记。
4. 编辑公式栏和网格单元格。
5. 测试方向键、Tab、Enter/F2、Delete、复制/粘贴。
6. 测试锁定选区后编辑、清空、删除行列。
7. 测试缩放、列宽拖拽、冻结、横纵滚动。
8. 测试查找、上一处/下一处、替换、全部替换。
9. 测试刷新、自动热刷开关、保存按钮状态。
10. 检查控制台 error、主要视口截图和移动到极端滚动位置后的布局。

## Verification Run - 2026-06-04

- `npm test`: 8 files / 31 tests passed.
- `npm run build`: passed TypeScript checks and Vite production build.
- `npm run check:tables`: read-only parsed `D:\2D_AI_WORKING\Tables`, 1154 CSV files, 235726 rows, max 294 columns, UTF-8 1151 / GB18030 3.
- Browser smoke at `http://127.0.0.1:5173/`: no console errors; sample directory loads; multi-row toolbar stays inside viewport; grid body remains constrained to the visible workspace; A1 to B2 drag selection produced `选区 2 x 2`; zoom, column resize, and grid scroll changed expected geometry.

## Verification Run - 2026-06-04 Edge Editing

- `npm test`: 8 files / 41 tests passed.
- `npm run build`: passed TypeScript checks and Vite production build.
- `npm run check:tables`: read-only parsed `D:\2D_AI_WORKING\Tables`, 1154 CSV files, 235726 rows, max 294 columns, UTF-8 1151 / GB18030 3.
- Browser smoke at `http://127.0.0.1:5173/`: no console errors; sample CSV stayed `未保存 0` after deleting a virtual empty cell; column header B selected `选区 4 x 1`; row header 2 selected `选区 1 x 7`; corner header selected `选区 4 x 7`.

## Verification Run - 2026-06-04 State Consistency

- `npm test`: 8 files / 45 tests passed.
- `npm run build`: passed TypeScript checks and Vite production build.
- `npm run check:tables`: read-only parsed `D:\2D_AI_WORKING\Tables`, 1154 CSV files, 235726 rows, max 294 columns, UTF-8 1151 / GB18030 3.
- Browser smoke at `http://127.0.0.1:5173/`: no console errors; double-click inline editor appeared on `monster.csv`, then cleared after switching to `skill.csv`; bottom grid status displayed tab operation status. Browser automation cannot inject native Ctrl+C in this environment, so clipboard success/failure behavior is covered by component tests.

## Current Known Gaps

- Chrome/Edge 原生目录选择弹窗无法在当前自动化环境里直接选择真实目录，仍需要人工点一次目录授权；授权后功能可通过只读 `npm run check:tables` 和浏览器样例流程覆盖主要行为。
- 浏览器烟测已覆盖页面布局、工具栏换行、表格拖拽选区、缩放、列宽拖拽和滚动；大目录树滚动用组件级 synthetic large tree 自动化覆盖。
