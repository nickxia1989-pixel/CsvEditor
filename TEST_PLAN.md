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
| 布局 | 左侧侧栏拖拽宽度 | App test + Browser smoke | 鼠标拖拽限制在 240-520px，右侧工作区和目录树不重叠、不溢出 |
| 多标签 | 打开多个 CSV | App integration test | 已打开文件进入上方标签，重复打开只激活旧标签 |
| 多标签 | 未保存提示和关闭保护 | App integration test | 脏标签有标记，关闭/刷新前提示 |
| 表格显示 | 大 CSV 虚拟滚动 | Browser + sample stress data | 横纵滚动顺畅，表头/行号对齐 |
| 表格编辑 | 单元格、公式栏编辑 | Grid/App tests + Browser smoke | 修改写入选中格，状态变未保存 |
| 表格编辑 | 复制/粘贴 TSV | Grid test | 多格粘贴正确，锁定格跳过 |
| 表格编辑 | Excel 风格键盘和粘贴体验 | Grid/App tests + Browser smoke | 行列选择不跳末格，粘贴从选区左上角开始，单格可铺满目标区域，编辑回车后可直接继续输入 |
| 表格编辑 | Delete/Backspace 清空选区 | Grid test | 只清空未锁定格 |
| 表格编辑 | 键盘导航 | Grid test | 方向键、Tab、Enter/F2 行为稳定 |
| 锁定 | 锁定/解锁选区 | Grid/App tests | 锁定格不可编辑，删除行列受保护 |
| 缩放 | 放大/缩小格子 | Grid test + Browser smoke | 行高、列宽、表头同步缩放，布局不溢出 |
| 冻结 | 默认冻结到 B3、冻结到指定格、取消冻结 | Browser smoke + Grid/App tests | 新 CSV 默认冻结 2 行 / 1 列，取消后刷新仍保持取消；冻结区域滚动时保持可见且不抖动、不遮挡 |
| 行列操作 | 插入/删除/追加行列 | Grid/App tests | 数据和锁定格坐标同步移动 |
| 查找替换 | 查找上一处/下一处、替换 | Unit/Grid tests | 大小写不敏感，替换跳过锁定格 |
| 热刷新 | 干净页签自动刷新 | Tab model/App test | 每 5 秒检查外部变化并自动重读，不长期占用文件，顶部状态栏不显示热刷新轮询状态 |
| 热刷新 | 脏页签冲突提示 | Tab model/App test | 有未保存内容时只标记冲突，不覆盖本地编辑 |
| 保存 | 保存当前/全部保存 | App integration test | 写入前检查磁盘版本，未保存计数归零 |
| 保存 | 保留未改行 CSV 原始格式 | CSV/App tests | 未改行不因保存而改写引号、尾空格字段、`""` 空行或 EOF 换行 |
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

## Verification Run - 2026-06-04 Save And Tab Lifecycle

- `npm test`: 8 files / 50 tests passed.
- `npm run build`: passed TypeScript checks and Vite production build.
- `npm run check:tables`: read-only parsed `D:\2D_AI_WORKING\Tables`, 1154 CSV files, 235726 rows, max 294 columns, UTF-8 1151 / GB18030 3.
- Browser smoke at `http://127.0.0.1:5173/`: no console errors; rapid repeated opening of `monster.csv` kept one tab; closing an inactive `monster.csv` tab left `skill.csv` active.

## Verification Run - 2026-06-04 Refresh Search View Controls

- `npm test`: 8 files / 54 tests passed.
- `npm run build`: passed TypeScript checks and Vite production build.
- `npm run check:tables`: read-only parsed `D:\2D_AI_WORKING\Tables`, 1154 CSV files, 235726 rows, max 294 columns, UTF-8 1151 / GB18030 3.
- `git diff --check`: passed with only Git CRLF conversion warnings.
- Browser smoke at `http://127.0.0.1:5173/`: no console errors; sample tree loaded; duplicate `monster.csv` open kept one tab; find `wolf` jumped to `Forest Wolf`; replace changed it to `Forest Fox` and marked the tab dirty; read-only save stayed disabled with neutral styling; selecting `B2`, freezing, and zooming to 110% kept the grid viewport inside the workspace. Screenshot: `artifacts/csv-editor-refresh-find-freeze.png`.

## Verification Run - 2026-06-04 Frozen Pane Stability

- `npm test`: 8 files / 55 tests passed.
- `npm run build`: passed TypeScript checks and Vite production build.
- `npm run check:tables`: read-only parsed `D:\2D_AI_WORKING\Tables`, 1154 CSV files, 235726 rows, max 294 columns, UTF-8 1151 / GB18030 3.
- `git diff --check`: passed with only Git CRLF conversion warnings.
- Grid component regression: frozen rows/columns use viewport CSS scroll variables; frozen corner, frozen row cells, and frozen column cells keep separate transform paths while normal cells remain untransformed.
- Browser smoke at `http://127.0.0.1:5173/`: clean run after `2026-06-04T12:12:52Z` produced 0 new console errors; after freezing `B2` and scrolling to `scrollLeft=520 / scrollTop=260`, CSS vars matched scroll state, frozen row/column alignment deltas were 0, and visible frozen cells hit themselves (`F1`, `A11`) instead of being covered by ordinary scrolled cells. Screenshot: `artifacts/csv-editor-freeze-scroll-clean.png`.
- Browser multi-freeze smoke: clean run after `2026-06-04T12:14:44Z` produced 0 new console errors; after freezing `D4` (`3 行 / 3 列`) and scrolling to `scrollLeft=640 / scrollTop=300`, CSS vars matched scroll state, frozen row/column alignment deltas were 0, and visible frozen cells hit themselves (`I3`, `C15`).

## Verification Run - 2026-06-04 Refresh Interval And Sticky Default Freeze

- `npm test`: 8 files / 57 tests passed after adding coverage for hidden 5s hot refresh interval, default B3 freeze, and manual freeze cancellation persistence.
- `npm run build`: passed TypeScript checks and Vite production build.
- `npm run check:tables`: read-only parsed `D:\2D_AI_WORKING\Tables`, 1154 CSV files, 235899 rows, max 294 columns, UTF-8 1151 / GB18030 3.
- `git diff --check`: passed with only Git CRLF conversion warnings.
- Browser smoke at `http://127.0.0.1:5173/`: clean run produced 0 new console errors; opening `monster.csv` showed `冻结 2 行 / 1 列`, top status text did not contain `热刷新`, sticky freeze layers reported `position: sticky`, A1 had no transform, and 50 samples during scroll to `scrollLeft=700 / scrollTop=320` showed A1 max left/top delta `0 / 0`. Screenshot: `artifacts/csv-editor-sticky-default-b3.png`.

## Verification Run - 2026-06-04 Resizable Compact Layout

- `npm test`: 8 files / 59 tests passed after adding pointer and keyboard coverage for the resizable sidebar.
- `npm run build`: passed TypeScript checks and Vite production build.
- `npm run check:tables`: read-only parsed `D:\2D_AI_WORKING\Tables`, 1154 CSV files, 235899 rows, max 294 columns, UTF-8 1151 / GB18030 3.
- `git diff --check`: passed with only Git CRLF conversion warnings.
- Browser smoke at `http://127.0.0.1:5173/`: clean run produced 0 new console errors; side bar widths clamped at `240px` and `520px`, plus a mid-width drag, without overlap; right toolbar stayed to one compact horizontal row and the grid viewport remained inside the workspace with about `529px` visible height. Find, edit, dirty marker, lock/unlock, zoom, and grid scroll all worked. Screenshot: `artifacts/csv-editor-resizable-compact-layout.png`.

## Verification Run - 2026-06-04 Resize Lifecycle Review Fix

- `npm test`: 8 files / 61 tests passed after adding regressions for immediate pointer release and non-primary pointer buttons on the sidebar resizer.
- `npm run build`: passed TypeScript checks and Vite production build.
- `npm run check:tables`: read-only parsed `D:\2D_AI_WORKING\Tables`, 1154 CSV files, 235899 rows, max 294 columns, UTF-8 1151 / GB18030 3.
- `git diff --check`: passed with only Git CRLF conversion warnings.
- Browser smoke at `http://127.0.0.1:5173/`: clean run produced 0 new console errors; clicking the divider did not leave resize mode active, dragging to `520px` and `240px` released cleanly, no sidebar/workspace overlap occurred, and grid scroll still worked. Screenshot: `artifacts/csv-editor-resize-review.png`.

## Verification Run - 2026-06-05 Grid Basics And CSV Format

- `svn diff D:\2D_AI_WORKING\Tables\npc.csv`: read-only investigation showed current working-copy format noise consistent with full-row reserialization: an untouched-looking trailing-space field became quoted, `""` empty-record rows became blank rows, and EOF newline state changed.
- `npm test`: 8 files / 67 tests passed after adding coverage for row/column focus anchors, top-left paste starts, target-range paste tiling, copied-cell visual state, inline-editor pointer handling, keyboard edit start, Enter focus recovery, and untouched CSV row preservation.
- `npm run build`: passed TypeScript checks and Vite production build.
- `npm run check:tables`: read-only parsed `D:\2D_AI_WORKING\Tables`, 1154 CSV files, 235904 rows, max 294 columns, UTF-8 1151 / GB18030 3.
- `git diff --check`: passed with only Git CRLF conversion warnings.
- Browser smoke at `http://127.0.0.1:5173/`: clean run produced 0 new console errors; ArrowRight moved selection from `B2` to `C2` without scrolling, column/row header selection focused `B1`/`A2` instead of the last cell, double-click editor stayed active while dragging inside the input, and after editing `B2` then pressing Enter, typing immediately opened editing on `B3`.

## Verification Run - 2026-06-05 IME Keyboard Proxy

- `npm test`: 8 files / 69 tests passed after adding regressions for the hidden keyboard input proxy, arrow-key bubbling from the proxy, and IME composition commit opening the inline editor with the committed text.
- `npm run build`: passed TypeScript checks and Vite production build.
- `npm run check:tables`: read-only parsed `D:\2D_AI_WORKING\Tables`, 1154 CSV files, 235904 rows, max 294 columns, UTF-8 1151 / GB18030 3.
- `git diff --check`: passed with only Git CRLF conversion warnings.
- Browser smoke at `http://127.0.0.1:5173/`: clean run produced 0 new console errors; after selecting `B2`, focus moved to the hidden `Grid keyboard input`, ArrowRight moved to `C2` without scrolling, typing `K` opened the editor, Enter committed and moved to `C3`, and typing `N` immediately opened editing on `C3`.

## Verification Run - 2026-06-05 Review Fixes

- Review finding: CSV raw-row preservation metadata was still indexed only by row number, so insert/delete row operations could desynchronize `sourceRows` and cause untouched rows to be reserialized on save. Fixed by moving/removing source-row metadata with row operations and snapshotting it in undo/redo history.
- Review finding: the hidden keyboard input proxy changed the event target for copy/paste shortcuts, so Ctrl+C/Ctrl+V needed direct proxy-target coverage. Added component regressions for copying and tiled paste while focus is on `Grid keyboard input`.
- `npm test`: 8 files / 72 tests passed.
- `npm run build`: passed TypeScript checks and Vite production build.
- `npm run check:tables`: read-only parsed `D:\2D_AI_WORKING\Tables`, 1154 CSV files, 235904 rows, max 294 columns, UTF-8 1151 / GB18030 3.
- `git diff --check`: passed with only Git CRLF conversion warnings.
- Browser smoke at `http://127.0.0.1:5173/`: clean run produced 0 console errors; sample `monster.csv` loaded; ArrowRight moved selection through the keyboard proxy, typing `K` opened editing, Enter committed and returned focus to `Grid keyboard input`; sidebar drag changed width from `310px` to `430px`, grid resized from `931px` to `811px` wide without document-level horizontal overflow. Native clipboard shortcut injection remains disabled in this browser automation environment, so proxy Ctrl+C/Ctrl+V is covered by component tests.

## Current Known Gaps

- Chrome/Edge 原生目录选择弹窗无法在当前自动化环境里直接选择真实目录，仍需要人工点一次目录授权；授权后功能可通过只读 `npm run check:tables` 和浏览器样例流程覆盖主要行为。
- 浏览器烟测已覆盖页面布局、工具栏换行、表格拖拽选区、缩放、列宽拖拽和滚动；大目录树滚动用组件级 synthetic large tree 自动化覆盖。
- 当前浏览器自动化环境禁用了原生 Ctrl+C/Ctrl+V 注入；复制态和粘贴定位/铺展由组件级自动化覆盖，真实浏览器 smoke 覆盖了不依赖系统剪贴板的键盘编辑与选择行为。
