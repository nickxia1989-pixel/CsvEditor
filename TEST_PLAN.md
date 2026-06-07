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
| 目录树 | 筛选 | Component/App test + Browser smoke | 搜索会递归加载未展开目录下的 CSV，命中项和父目录可见 |
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
| 冻结 | 默认冻结到 C3、冻结到指定格、取消冻结 | Browser smoke + Grid/App tests | 新 CSV 默认冻结 2 行 / 2 列，取消后刷新仍保持取消；冻结区域滚动时保持可见且不抖动、不遮挡 |
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

## Verification Run - 2026-06-05 Field-Level Format Preservation

- CSV save hardening: source row metadata now stores raw field slices, so editing one field in a row preserves unchanged neighboring fields exactly instead of reserializing the whole row. This specifically covers rows like `34,测试lilifute ,测试`, where changing `34` must not turn the untouched trailing-space field into `"测试lilifute "`.
- IME safety hardening: printable keydown events from the hidden `Grid keyboard input` no longer preempt text insertion; text editing is seeded by the proxy input/change or composition path, while Arrow/Enter/Ctrl shortcuts still bubble to grid navigation and commands.
- `npm test`: 8 files / 76 tests passed after adding same-row CSV format preservation, changed-field escaping with raw neighbor preservation, source-field history cloning, and keyboard-proxy printable keydown regressions.
- `npm run build`: passed TypeScript checks and Vite production build.
- `npm run check:tables`: read-only parsed `D:\2D_AI_WORKING\Tables`, 1154 CSV files, 235904 rows, max 294 columns, UTF-8 1151 / GB18030 3.
- `git diff --check`: passed with only Git CRLF conversion warnings.
- Browser smoke at `http://127.0.0.1:5173/`: sample `monster.csv` loaded; proxy-focused ArrowRight moved selection, pressing `K` opened an editor with `K`, Enter committed and returned focus to `Grid keyboard input`; grid viewport stayed `931 x 512`; console error log was empty.

## Verification Run - 2026-06-05 Header Selection View Stability

- Selection hardening: row/column/corner header selection now suppresses only that selection-change auto-scroll, so choosing a whole row or column does not pull the viewport back to the first selected cell. Normal cell navigation and selection changes still scroll focused cells into view.
- `npm test`: 8 files / 78 tests passed after adding regressions for header selection preserving viewport scroll and normal selection still scrolling to the focused cell.
- `npm run build`: passed TypeScript checks and Vite production build.
- `npm run check:tables`: read-only parsed `D:\2D_AI_WORKING\Tables`, 1154 CSV files, 235904 rows, max 294 columns, UTF-8 1151 / GB18030 3.
- `git diff --check`: passed with only Git CRLF conversion warnings.
- Browser smoke at `http://127.0.0.1:5173/`: using coordinate clicks to avoid test-tool auto-scroll, sample `monster.csv` stayed at `scrollTop=360 / scrollLeft=280` after selecting visible column `D` and visible row `18`; selected labels became `D1` and `A18`; console error log was empty.

## Verification Run - 2026-06-05 Ctrl+A Select All

- Excel shortcut hardening: `Ctrl+A` / `Meta+A` from the grid keyboard path now selects the used CSV range, reports `已全选已用区域`, and suppresses the resulting selection auto-scroll so the current viewport stays stable.
- `npm test`: 8 files / 80 tests passed after adding regressions for keyboard-proxy `Ctrl+A` selection and scroll preservation.
- `npm run build`: passed TypeScript checks and Vite production build.
- `npm run check:tables`: read-only parsed `D:\2D_AI_WORKING\Tables`, 1154 CSV files, 235904 rows, max 294 columns, UTF-8 1151 / GB18030 3.
- `git diff --check`: passed with only Git CRLF conversion warnings.
- Browser smoke at `http://127.0.0.1:5173/`: sample `monster.csv` was scrolled to `scrollTop=360 / scrollLeft=280`, visible cell `D18` was clicked to focus `Grid keyboard input`, then `Ctrl+A` selected `4 x 7`; selected label became `A1`, viewport remained `360 / 280`, and console error log was empty.

## Verification Run - 2026-06-05 Ctrl+X Cut

- Excel shortcut hardening: `Ctrl+X` / `Meta+X` now writes the selected TSV range to the clipboard and only clears the selected range after that write succeeds. If browser clipboard permission is unavailable, the selection is not cleared and the status reports the failure.
- `npm test`: 8 files / 83 tests passed after adding regressions for successful cut, failed cut without clearing, and cut while focus is on `Grid keyboard input`.
- `npm run build`: passed TypeScript checks and Vite production build.
- `npm run check:tables`: read-only parsed `D:\2D_AI_WORKING\Tables`, 1154 CSV files, 235904 rows, max 294 columns, UTF-8 1151 / GB18030 3.
- `git diff --check`: passed with only Git CRLF conversion warnings.
- Browser smoke at `http://127.0.0.1:5173/`: sample `monster.csv` loaded; ArrowRight and typing through `Grid keyboard input` still opened editing, Enter returned focus to the proxy, grid stayed `931 x 512`, and console error log was empty. Native clipboard shortcut injection remains disabled in this browser automation environment, so `Ctrl+X` success/failure semantics are covered by component tests.

## Verification Run - 2026-06-05 Clipboard State Cleanup

- Copy-state hardening: every new copy or cut attempt now clears the previous copied-cell highlight first. A failed clipboard write no longer leaves stale dashed outlines that make an old selection look like the current copied range.
- `npm test`: 8 files / 85 tests passed after adding regressions for failed copy and failed cut clearing stale copied highlights without clearing data.
- `npm run build`: passed TypeScript checks and Vite production build.
- `npm run check:tables`: read-only parsed `D:\2D_AI_WORKING\Tables`, 1154 CSV files, 235904 rows, max 294 columns, UTF-8 1151 / GB18030 3.
- `git diff --check`: passed with only Git CRLF conversion warnings.
- Browser smoke at `http://127.0.0.1:5173/`: sample `monster.csv` loaded; ArrowRight and typing through `Grid keyboard input` still opened editing, Enter returned focus to the proxy, copied-cell count stayed `0` without an active copy, grid stayed `931 x 512`, and console error log was empty.

## Verification Run - 2026-06-05 Quoted TSV Paste

- Paste hardening: TSV clipboard parsing now uses a structured tab-delimited parser, so Excel-style quoted values with embedded tabs, embedded newlines, or escaped quotes paste into the intended cells instead of being split into extra rows or columns.
- `npm test`: 8 files / 87 tests passed after adding parser and GridEditor regressions for quoted TSV paste.
- `npm run build`: passed TypeScript checks and Vite production build.
- `npm run check:tables`: read-only parsed `D:\2D_AI_WORKING\Tables`, 1154 CSV files, 235904 rows, max 294 columns, UTF-8 1151 / GB18030 3.
- `git diff --check`: passed with only Git CRLF conversion warnings.
- Browser smoke at `http://127.0.0.1:5173/`: sample `monster.csv` loaded; ArrowRight and typing through `Grid keyboard input` still opened editing, Enter returned focus to the proxy, grid stayed `931 x 512`, and console error log was empty.

## Verification Run - 2026-06-05 Quoted TSV Copy

- Copy hardening: copied and cut TSV now use structured tab-delimited serialization, so cells containing tabs, newlines, or double quotes are quoted and escaped for Excel-compatible clipboard round trips.
- `npm test`: 8 files / 89 tests passed after adding `matrixToTsv` round-trip coverage and GridEditor copy coverage for complex cell values.
- `npm run build`: passed TypeScript checks and Vite production build.
- `npm run check:tables`: read-only parsed `D:\2D_AI_WORKING\Tables`, 1154 CSV files, 235904 rows, max 294 columns, UTF-8 1151 / GB18030 3.
- `git diff --check`: passed with only Git CRLF conversion warnings.
- Browser smoke at `http://127.0.0.1:5173/`: sample `monster.csv` loaded; ArrowRight and typing through `Grid keyboard input` still opened editing, Enter returned focus to the proxy, grid stayed `931 x 512`, and console error log was empty.

## Verification Run - 2026-06-05 Locked Cut Guard

- Locking hardening: `Ctrl+X` / `Meta+X` now refuses to cut when the selected range contains any locked cell. It does not write clipboard data, does not clear cells, and reports `选区包含锁定格，不能剪切`, avoiding partial-cut states where locked cells remain but the UI says cut succeeded.
- `npm test`: 8 files / 90 tests passed after adding a locked-cell cut regression.
- `npm run build`: passed TypeScript checks and Vite production build.
- `npm run check:tables`: read-only parsed `D:\2D_AI_WORKING\Tables`, 1154 CSV files, 235904 rows, max 294 columns, UTF-8 1151 / GB18030 3.
- `git diff --check`: passed with only Git CRLF conversion warnings.
- Browser smoke at `http://127.0.0.1:5173/`: sample `monster.csv` loaded; ArrowRight and typing through `Grid keyboard input` still opened editing, Enter returned focus to the proxy, grid stayed `931 x 512`, and console error log was empty.

## Verification Run - 2026-06-05 Recursive Tree Search And C3 Freeze

- Directory search hardening: typing in the left search box now recursively loads unopened local subdirectories and renders matching descendants even when their parent folder is collapsed, so CSV files under unopened folders can be found directly.
- Default freeze update: newly opened CSV tabs now default to `冻结 2 行 / 2 列`, matching an automatic freeze point of C3.
- `npm test`: 8 files / 91 tests passed after adding coverage for recursive search through unopened folders and updating default freeze assertions.
- `npm run build`: passed TypeScript checks and Vite production build.
- `npm run check:tables`: read-only parsed `D:\2D_AI_WORKING\Tables`, 1154 CSV files, 235915 rows, max 294 columns, UTF-8 1151 / GB18030 3.
- `git diff --check`: passed with only Git CRLF conversion warnings.
- Browser smoke at `http://127.0.0.1:5173/`: sample tree loaded; left search placeholder showed `搜索全部 CSV`; searching `skill` showed `skill.csv`; clearing search by keyboard restored `monster.csv` and `skill.csv`; opening a sample CSV showed `冻结 2 行 / 2 列`; grid viewport stayed within the workspace and console error log was empty.

## Verification Run - 2026-06-05 Column Format Preservation

- CSV save hardening: inserting, deleting, and appending columns now updates source-row field metadata, so untouched raw fields keep their original quoting and trailing spaces instead of falling back to full-row reserialization.
- `npm test -- src/App.test.tsx`: 1 file / 29 tests passed after adding column insert/delete/append save-format regressions.
- `npm test`: 8 files / 94 tests passed.
- `npm run build`: passed TypeScript checks and Vite production build.
- `npm run check:tables`: read-only parsed `D:\2D_AI_WORKING\Tables`, 1154 CSV files, 235915 rows, max 294 columns, UTF-8 1151 / GB18030 3.
- `git diff --check`: passed with only Git CRLF conversion warnings.
- Browser smoke at `http://127.0.0.1:5173/`: sample `monster.csv` opened, default `冻结 2 行 / 2 列` remained visible, grid viewport stayed inside the workspace, and console error log was empty.

## Verification Run - 2026-06-05 Widened Row Format Preservation

- CSV save hardening: changing a virtual new column now preserves original raw fields for the existing row prefix and only serializes the new or changed field, avoiding full-row reserialization when a row gets wider through direct edit or paste.
- `npm test -- src/lib/csv.test.ts`: 1 file / 16 tests passed after adding widened-row source-field preservation coverage.
- `npm test -- src/App.test.tsx`: 1 file / 30 tests passed after adding a virtual-new-column save-format regression.
- `npm test`: 8 files / 96 tests passed.
- `npm run build`: passed TypeScript checks and Vite production build.
- `npm run check:tables`: read-only parsed `D:\2D_AI_WORKING\Tables`, 1154 CSV files, 235915 rows, max 294 columns, UTF-8 1151 / GB18030 3.
- `git diff --check`: passed with only Git CRLF conversion warnings.
- Browser smoke at `http://127.0.0.1:5173/`: sample `monster.csv` opened, default `冻结 2 行 / 2 列` remained visible, grid viewport stayed inside the workspace, and console error log was empty.

## Verification Run - 2026-06-05 Extended Keyboard Navigation

- Keyboard hardening: `Home`, `End`, `PageUp`, `PageDown`, and `Ctrl/Meta + Arrow` now move or extend the grid selection directly instead of letting the browser scroll the grid viewport.
- `npm test -- src/components/GridEditor.test.tsx`: 1 file / 33 tests passed after adding navigation regressions for Home/End/Page keys, Ctrl/Meta edge jumps, and Shift range extension.
- `npm test`: 8 files / 99 tests passed.
- `npm run build`: passed TypeScript checks and Vite production build.
- `npm run check:tables`: read-only parsed `D:\2D_AI_WORKING\Tables`, 1154 CSV files, 235915 rows, max 294 columns, UTF-8 1151 / GB18030 3.
- `git diff --check`: passed with only Git CRLF conversion warnings.
- Browser smoke at `http://127.0.0.1:5173/`: sample `monster.csv` opened; selecting `B2`, pressing `End` moved the active cell to `G2`, pressing `Ctrl+ArrowDown` moved to `G4`, grid scroll stayed at `0 / 0`, and console error log was empty.

## Verification Run - 2026-06-05 Copied State Cleanup On Edits

- Copy-state hardening: the copied-cell highlight now clears when the user mutates the grid through Delete/Backspace, paste, the formula bar, row/column insert/delete, append row/column, or find/replace actions. This prevents a stale copied outline from surviving after the sheet has already changed.
- `npm test -- src/components/GridEditor.test.tsx`: 1 file / 36 tests passed after adding regressions for Delete, formula-bar edits, structural edits, and paste clearing stale copied highlights.
- `npm test`: 8 files / 102 tests passed.
- `npm run build`: passed TypeScript checks and Vite production build.
- `npm run check:tables`: read-only parsed `D:\2D_AI_WORKING\Tables`, 1154 CSV files, 235915 rows, max 294 columns, UTF-8 1151 / GB18030 3.
- `git diff --check`: passed with only Git CRLF conversion warnings.
- Browser smoke at `http://127.0.0.1:5174/` because 5173 was already occupied: sample tree loaded; searching `skill` showed `skill.csv`; clearing search by keyboard restored the full sample tree; opening `monster.csv` showed `冻结 2 行 / 2 列`; formula-bar editing marked the tab dirty; grid viewport measured `948 x 529`; console error log was empty. The temporary dev service was stopped after verification.

## Verification Run - 2026-06-05 Commit Edit On Pointer Selection

- Editing workflow hardening: when an inline cell editor is active, clicking another cell, a row header, a column header, or the corner select-all header now commits the edit before changing selection. This matches the expected spreadsheet behavior where clicking elsewhere accepts the current edit instead of leaving a stale editor behind.
- `npm test -- src/components/GridEditor.test.tsx`: 1 file / 38 tests passed after adding regressions for clicking another cell and selecting a header while editing.
- `npm test`: 8 files / 104 tests passed.
- `npm run build`: passed TypeScript checks and Vite production build.
- `npm run check:tables`: read-only parsed `D:\2D_AI_WORKING\Tables`, 1154 CSV files, 235915 rows, max 294 columns, UTF-8 1151 / GB18030 3.
- `git diff --check`: passed with only Git CRLF conversion warnings.
- Browser smoke at `http://127.0.0.1:5174/` because 5173 was already occupied: sample `monster.csv` opened; double-clicking `A1`, changing it to `Header Edited`, and directly clicking `C3` committed `A1`, removed the inline editor, moved the selected label to `C3`, marked `未保存 1`, kept `冻结 2 行 / 2 列`, measured the grid at `948 x 529`, and produced 0 console errors. The temporary dev service was stopped after verification.

## Verification Run - 2026-06-05 Ctrl+S From Inline Editor

- Save workflow hardening: pressing `Ctrl+S` / `Meta+S` while an inline cell editor is active now commits the current editor value before requesting save. This prevents stale saves where the visible draft value has not reached the tab data yet.
- `npm test -- src/components/GridEditor.test.tsx`: 1 file / 39 tests passed after adding a regression for inline-editor `Ctrl+S` committing before save request.
- `npm test -- src/App.test.tsx`: 1 file / 31 tests passed after adding a writable-file regression proving `Ctrl+S` saves the edited inline value.
- `npm test`: 8 files / 106 tests passed.
- `npm run build`: passed TypeScript checks and Vite production build.
- `npm run check:tables`: read-only parsed `D:\2D_AI_WORKING\Tables`, 1154 CSV files, 235915 rows, max 294 columns, UTF-8 1151 / GB18030 3.
- `git diff --check`: passed with only Git CRLF conversion warnings.
- Browser smoke at `http://127.0.0.1:5174/` because 5173 was already occupied: sample `monster.csv` opened; double-clicking `A1`, changing it to `Header Ctrl Save`, and pressing `Ctrl+S` in the inline editor committed A1, removed the editor, marked `未保存 1`, kept `冻结 2 行 / 2 列`, measured the grid at `948 x 529`, and produced 0 console errors. The sample source is read-only, so actual write correctness is covered by the App integration test. The temporary dev service was stopped after verification.

## Verification Run - 2026-06-05 Locked Cell Skip Feedback

- Locking UX hardening: paste and clear operations now report how many locked cells were skipped, so partial operations no longer say only `已粘贴` or `已清空选区` when protected cells were left unchanged.
- `npm test -- src/App.test.tsx`: 1 file / 33 tests passed after adding writable-file regressions for locked-cell paste and locked-column clear. The saved files prove only unlocked cells changed.
- `npm test`: 8 files / 108 tests passed.
- `npm run build`: passed TypeScript checks and Vite production build.
- `npm run check:tables`: read-only parsed `D:\2D_AI_WORKING\Tables`, 1154 CSV files, 235915 rows, max 294 columns, UTF-8 1151 / GB18030 3.
- `git diff --check`: passed with only Git CRLF conversion warnings.
- Browser smoke at `http://127.0.0.1:5174/` because 5173 was already occupied: sample `monster.csv` opened; locking `A1`, selecting column A, and pressing Delete changed the status to `已清空选区，跳过锁定 1 个`, marked the tab dirty, kept `冻结 2 行 / 2 列`, measured the grid at `948 x 529`, and produced 0 console errors. The temporary dev service was stopped after verification.

## Verification Run - 2026-06-05 Inline Draft Dirty Protection And Tab Scroll Memory

- Unsaved-state hardening: editing an inline cell now marks the active tab as dirty before the edit is committed, and external actions such as tab activation, tab close, refresh, toolbar save, and save-all first ask the grid to commit any active inline edit before continuing.
- View-state hardening: each open tab now remembers its grid scroll position independently, so switching tabs restores the previous vertical and horizontal viewport instead of snapping back to the selected cell.
- `npm test -- src/App.test.tsx`: 1 file / 37 tests passed after adding regressions for toolbar save of an uncommitted inline edit, unload/close protection for an uncommitted inline edit, and per-tab grid scroll restoration.
- `npm test -- src/components/GridEditor.test.tsx`: 1 file / 39 tests passed after wiring the new draft-dirty callback into component tests.
- `npm test`: 8 files / 112 tests passed.
- `npm run build`: passed TypeScript checks and Vite production build.
- `npm run check:tables`: read-only parsed `D:\2D_AI_WORKING\Tables`, 1154 CSV files, 235915 rows, max 294 columns, UTF-8 1151 / GB18030 3.
- `git diff --check`: passed with only Git CRLF conversion warnings.
- Browser smoke at `http://127.0.0.1:5173/`: sample `monster.csv` and `skill.csv` opened; scrolling them to `scrollTop/scrollLeft` `620/260` and `240/120`, then switching tabs, restored each tab to its own saved viewport; the grid measured `948 x 529`, `冻结 2 行 / 2 列` remained visible, and console error log was empty. The sample source is read-only, so toolbar write correctness is covered by the App integration test.

## Verification Run - 2026-06-05 Quoted Multiline Newline Preservation

- CSV save hardening: row-separator detection now counts record separators outside quoted fields first. Quoted multiline cell contents no longer bias the saved file toward the wrong newline style when a neighboring row or field is edited.
- `npm test -- src/lib/csv.test.ts`: 1 file / 18 tests passed after adding regressions for LF rows with quoted CRLF content and CRLF rows with quoted LF content.
- `npm test`: 8 files / 114 tests passed.
- `npm run build`: passed TypeScript checks and Vite production build.
- `npm run check:tables`: read-only parsed `D:\2D_AI_WORKING\Tables`, 1154 CSV files, 235915 rows, max 294 columns, UTF-8 1151 / GB18030 3.
- `git diff --check`: passed with only Git CRLF conversion warnings.

## Verification Run - 2026-06-06 Keyboard Seed Draft Dirty

- Keyboard edit hardening: when typing directly into the selected cell starts an inline editor from the hidden keyboard proxy or an IME composition commit, the seeded first character now immediately marks the active tab as an unsaved draft before any second keystroke or explicit commit.
- Keyboard navigation coverage: `Enter` / `F2` from the hidden keyboard proxy now has direct regression coverage for opening the selected cell editor, and arrow keys from the grid viewport assert `preventDefault` plus selection movement rather than browser scrolling.
- `npm test -- src/components/GridEditor.test.tsx`: 1 file / 41 tests passed after asserting keyboard-proxy and IME-seeded editors report draft dirty state immediately, proxy `Enter/F2` open editing, and viewport arrow keys move selection without default scrolling.
- `npm test -- src/App.test.tsx`: 1 file / 39 tests passed after adding unload-protection coverage for a direct keyboard-seeded inline edit and save-all coverage for an uncommitted inline editor value.
- `npm test`: 8 files / 118 tests passed.
- `npm run build`: passed TypeScript checks and Vite production build.
- `npm run check:tables`: read-only parsed `D:\2D_AI_WORKING\Tables`, 1154 CSV files, 235915 rows, max 294 columns, UTF-8 1151 / GB18030 3.
- `git diff --check`: passed with only Git CRLF conversion warnings.

## Verification Run - 2026-06-06 Copy Visual And Refresh Draft Guard

- Copy-state visual hardening: copied cells now use a light blue fill, a strong inset border, and a dashed inner frame. The focused copied cell keeps the normal focus border while still showing the copied range.
- Refresh safety coverage: added an App regression for an uncommitted inline cell edit followed by manual refresh. Cancelling the refresh confirmation keeps the local draft visible and preserves the unsaved marker.
- `npm test -- src/App.test.tsx`: 1 file / 40 tests passed.
- `npm test`: 8 files / 119 tests passed.
- `npm run build`: passed TypeScript checks and Vite production build.
- `npm run check:tables`: read-only parsed `D:\2D_AI_WORKING\Tables`, 1154 CSV files, 235915 rows, max 294 columns, UTF-8 1151 / GB18030 3.
- `git diff --check`: passed with only Git CRLF conversion warnings.
- Browser smoke at `http://127.0.0.1:5173/`: sample tree and `monster.csv` opened, grid measured `931 x 512`, loaded CSS contained the new `.grid-cell.copied`, `.grid-cell.copied::after`, and `.grid-cell.copied.focus` rules, and console error log was empty. The current Browser automation blocks native `Ctrl+C`, so actual copied-state activation remains covered by component tests.

## Verification Run - 2026-06-06 Hot Refresh Draft And Pause Guard

- Hot-refresh safety hardening: automatic disk polling now treats an active uncommitted inline edit as local dirty state, so an external disk update marks a conflict instead of silently applying the new file over the editing context.
- Auto-refresh toggle hardening: when a clean tab has `自动热刷` paused, disk changes now mark the tab as externally changed instead of being applied automatically.
- `npm test -- src/App.test.tsx`: 1 file / 43 tests passed after adding clean auto-refresh, paused auto-refresh, and active inline-draft polling regressions.
- `npm test`: 8 files / 122 tests passed.
- `npm run build`: passed TypeScript checks and Vite production build.
- `npm run check:tables`: read-only parsed `D:\2D_AI_WORKING\Tables`, 1154 CSV files, 235915 rows, max 294 columns, UTF-8 1151 / GB18030 3.
- `git diff --check`: passed with only Git CRLF conversion warnings.

## Verification Run - 2026-06-06 Native Clipboard Event Copy Cut

- Clipboard hardening: grid copy and cut now use the browser `copy` / `cut` event `clipboardData` instead of depending on `navigator.clipboard.writeText` permission. This keeps Ctrl+C/Ctrl+X closer to native spreadsheet behavior and still works when focus is on the hidden keyboard proxy.
- `npm test -- src/components/GridEditor.test.tsx`: 1 file / 41 tests passed after moving copy/cut regressions to native clipboard events.
- `npm test`: 8 files / 122 tests passed.
- `npm run build`: passed TypeScript checks and Vite production build.
- `npm run check:tables`: read-only parsed `D:\2D_AI_WORKING\Tables`, 1154 CSV files, 235915 rows, max 294 columns, UTF-8 1151 / GB18030 3.
- `git diff --check`: passed with only Git CRLF conversion warnings.
- `svn diff --summarize D:\2D_AI_WORKING\Tables\npc.csv` and `svn status D:\2D_AI_WORKING\Tables\npc.csv`: both produced no output in the current working copy, so the previously mentioned local `npc.csv` format-noise diff is not currently present.
- Browser smoke at `http://127.0.0.1:5173/`: sample tree and `monster.csv` opened, grid measured `931 x 512`, 350 grid cells rendered, status showed `4 行 / 7 列 | 选区 1 x 1 | 冻结 2 行 / 2 列 | 已打开`, and console error log was empty. The Browser automation environment still blocks native Ctrl+C injection, so actual clipboard-event payload behavior is covered by component tests.

## Verification Run - 2026-06-06 Inline Editor Double Click Guard

- Inline editing hardening: double-clicks inside the active cell editor now stay inside the input, preserving the current draft and leaving browser text selection behavior intact instead of bubbling to the outer cell and reopening the editor from the old cell value.
- `npm test -- src/components/GridEditor.test.tsx`: 1 file / 42 tests passed after adding a regression for double-clicking inside the inline editor with an unsaved draft.
- `npm test`: 8 files / 123 tests passed.
- `npm run build`: passed TypeScript checks and Vite production build.
- `npm run check:tables`: read-only parsed `D:\2D_AI_WORKING\Tables`, 1154 CSV files, 235915 rows, max 294 columns, UTF-8 1151 / GB18030 3.
- `git diff --check`: passed with only Git CRLF conversion warnings.
- Browser smoke at `http://127.0.0.1:5173/`: sample tree and `monster.csv` opened, grid measured `931 x 512`, status showed `4 行 / 7 列 | 选区 1 x 1 | 冻结 2 行 / 2 列 | 已打开`, and console error log was empty.

## Verification Run - 2026-06-06 Inline Draft Before Structural Tools

- Structural edit hardening: grid toolbar actions that mutate the sheet now commit an active inline editor before running. This prevents a row/column insert from happening before the draft reaches tab data, which previously could write the edited value into the newly inserted blank row.
- `npm test -- src/App.test.tsx`: 1 file / 44 tests passed after adding a regression for editing A1, clicking `插行` without manually committing, saving, and preserving both the inserted row and the edited original row.
- `npm test`: 8 files / 124 tests passed.
- `npm run build`: passed TypeScript checks and Vite production build.
- `npm run check:tables`: read-only parsed `D:\2D_AI_WORKING\Tables`, 1154 CSV files, 235915 rows, max 294 columns, UTF-8 1151 / GB18030 3.
- `git diff --check`: passed with only Git CRLF conversion warnings.
- Browser smoke at `http://127.0.0.1:5173/`: sample tree and `monster.csv` opened, grid measured `931 x 512`, status showed `4 行 / 7 列 | 选区 1 x 1 | 冻结 2 行 / 2 列 | 已打开`, and console error log was empty.

## Verification Run - 2026-06-06 Find Uses Inline Draft

- Find hardening: `下一处` / `上一处` now search a temporary data view that includes the active inline editor draft, then commit that draft. This prevents find navigation from ignoring text that is visibly being edited but has not yet reached tab data.
- `npm test -- src/components/GridEditor.test.tsx`: 1 file / 43 tests passed after adding a regression where an inline draft creates the only matching `wolf` cell.
- `npm test`: 8 files / 125 tests passed.
- `npm run build`: passed TypeScript checks and Vite production build.
- `npm run check:tables`: read-only parsed `D:\2D_AI_WORKING\Tables`, 1154 CSV files, 235915 rows, max 294 columns, UTF-8 1151 / GB18030 3.
- `git diff --check`: passed with only Git CRLF conversion warnings.
- Browser smoke at `http://127.0.0.1:5173/`: sample tree and `monster.csv` opened, find controls were present, grid measured `931 x 512`, status showed `4 行 / 7 列 | 选区 1 x 1 | 冻结 2 行 / 2 列 | 已打开`, and console error log was empty.

## Verification Run - 2026-06-06 Keyboard Proxy and Legacy Encoding

- Keyboard hardening: cell/header/corner selections now focus and clear the hidden keyboard proxy immediately, selection changes clear stale proxy text, and inline-editor pointer use cancels any leftover grid drag state. This targets Enter-not-opening, arrow-key browser scrolling, IME first-letter loss, and text selection inside inline editors.
- Encoding hardening: saves now preserve the tab's decoded encoding. UTF-8 writes still use strings; GB18030 writes use a byte buffer generated from a safe reverse map and fail loudly for characters that cannot be encoded instead of silently converting the whole file to UTF-8.
- `npm test -- src/components/GridEditor.test.tsx`: 1 file / 45 tests passed after adding proxy focus and stale IME proxy regressions.
- `npm test -- src/App.test.tsx`: 1 file / 46 tests passed after adding end-to-end Enter-then-type and GB18030-save regressions.
- `npm test -- src/lib/textDecode.test.ts src/lib/fileRefs.test.ts`: 2 files / 9 tests passed.
- `npm test`: 8 files / 131 tests passed.
- `npm run build`: passed TypeScript checks and Vite production build.
- `npm run check:tables`: read-only parsed `D:\2D_AI_WORKING\Tables`, 1154 CSV files, 235915 rows, max 294 columns, UTF-8 1151 / GB18030 3.
- Read-only `svn diff "D:\2D_AI_WORKING\Tables\npc.csv"` produced no output during this run. Byte inspection showed UTF-8 BOM, CRLF row separators, and no UTF-8 replacement characters, so the currently visible local file did not show an active SVN diff corruption at the time of testing.
- Browser smoke at `http://127.0.0.1:5173/`: sample tree and `monster.csv` opened, selecting A1 focused `Grid keyboard input`, ArrowRight moved the selection to B1 with scroll still at 0/0, double-click editing B2 then Enter moved to B3, direct typing opened a B3 editor with `x`, grid measured `948 x 529`, and console error log was empty.

## Verification Run - 2026-06-06 Internal Clipboard Fallback

- Clipboard hardening: successful copy now also stores an editor-internal TSV buffer and keeps the copied border even if the browser does not expose writable `clipboardData`. Paste falls back to that internal buffer only while the copied border is still active, then clears the copied state after applying the paste.
- This targets the Excel workflow of copying a source cell/range, selecting a larger target range, then pressing paste when the browser/system clipboard event is unavailable or empty.
- `npm test -- src/components/GridEditor.test.tsx`: 1 file / 46 tests passed after updating unavailable-clipboard copy expectations and adding a regression where an empty paste event tiles the internally copied `ID` cell into a 2 x 2 target range from the selection top-left.
- `npm test`: 8 files / 132 tests passed.
- `npm run build`: passed TypeScript checks and Vite production build.
- `npm run check:tables`: read-only parsed `D:\2D_AI_WORKING\Tables`, 1154 CSV files, 235915 rows, max 294 columns, UTF-8 1151 / GB18030 3.
- Browser smoke at `http://127.0.0.1:5173/`: sample tree and `monster.csv` opened, ArrowRight moved selection without scrolling, double-click editing B2 then Enter moved to B3, direct keypress opened a B3 editor with `z`, grid measured `948 x 529`, and console error log was empty.

## Verification Run - 2026-06-06 Keyboard Clipboard Fallback

- Keyboard clipboard hardening: Ctrl+C and Ctrl+V now schedule a short internal fallback while still allowing native browser clipboard events to run first. If the native copy/paste event is missing, Ctrl+C creates the copied border and internal TSV buffer; Ctrl+V applies that buffer from the target selection's top-left and tiles into the selected range.
- This targets environments where keyboard shortcuts do not produce React `copy` / `paste` events even though the grid keyboard proxy owns focus.
- `npm test -- src/components/GridEditor.test.tsx`: 1 file / 48 tests passed after adding regressions for Ctrl+C without a native copy event and Ctrl+V without a native paste event.
- `npm test`: 8 files / 134 tests passed.
- `npm run build`: passed TypeScript checks and Vite production build.
- `npm run check:tables`: read-only parsed `D:\2D_AI_WORKING\Tables`, 1154 CSV files, 235915 rows, max 294 columns, UTF-8 1151 / GB18030 3.
- Browser smoke at `http://127.0.0.1:5173/`: sample tree and `monster.csv` opened, ArrowRight moved selection without scrolling, double-click editing B2 then Enter moved to B3, direct keypress opened a B3 editor with `z`, grid measured `948 x 529`, and console error log was empty.

## Verification Run - 2026-06-06 Toolbar Undo Active Draft

- Undo hardening: the toolbar undo button now treats a dirty inline editor draft as undoable even when the committed history stack is still empty. Clicking it commits the visible draft into the sheet history, then immediately applies undo so the cell returns to its prior value without leaving the tab dirty.
- Redo toolbar clicks now also explicitly commit any active inline editor before running, keeping toolbar actions out of browser blur-order edge cases.
- `npm test -- src/components/GridEditor.test.tsx`: 1 file / 49 tests passed after adding a regression that edits A1 inline, enables the disabled-by-history undo button, and verifies `onSetCell` runs before `onUndo`.
- `npm test -- src/App.test.tsx`: 1 file / 47 tests passed after adding an end-to-end writable-file regression where editing A1 inline and pressing toolbar undo restores `ID`, removes the editor, keeps `未保存 0`, and leaves the file bytes unchanged.
- `npm test`: 8 files / 136 tests passed.
- `npm run build`: passed TypeScript checks and Vite production build.
- `npm run check:tables`: read-only parsed `D:\2D_AI_WORKING\Tables`, 1154 CSV files, 235915 rows, max 294 columns, UTF-8 1151 / GB18030 3.
- Browser smoke at `http://127.0.0.1:5173/`: sample tree and `monster.csv` opened, ArrowRight moved selection without scrolling, double-click editing B2 then Enter moved to B3, direct keypress opened a B3 editor with `z`, grid measured `948 x 529`, and console error log was empty.

## Verification Run - 2026-06-06 Global Ctrl+S Active Draft

- Save hardening: the window-level Ctrl+S / Meta+S handler now uses the same active-edit commit path as toolbar save. This prevents a focused or event-routing edge case from saving tab data before a visible inline editor draft reaches the model.
- `npm test -- src/App.test.tsx`: 1 file / 48 tests passed after adding a writable-file regression where an active inline draft receives a global `window` Ctrl+S and the saved bytes include the draft value.
- `npm test`: 8 files / 137 tests passed.
- `npm run build`: passed TypeScript checks and Vite production build.
- `npm run check:tables`: read-only parsed `D:\2D_AI_WORKING\Tables`, 1154 CSV files, 235915 rows, max 294 columns, UTF-8 1151 / GB18030 3.
- Browser smoke at `http://127.0.0.1:5173/`: sample tree and `monster.csv` opened, ArrowRight moved selection without scrolling, double-click editing B2 then Enter moved to B3, direct keypress opened a B3 editor with `z`, grid measured `948 x 529`, and console error log was empty.

## Verification Run - 2026-06-06 Ctrl+X Internal Fallback

- Clipboard hardening: Ctrl+X now matches the existing Ctrl+C/Ctrl+V keyboard fallback path. If the browser does not emit a native `cut` event, the selected TSV is kept in the editor-internal clipboard, the selected range is cleared, locked cells are still protected, and the cut buffer can be pasted later inside the editor.
- `npm test -- src/components/GridEditor.test.tsx`: 1 file / 51 tests passed after adding regressions for Ctrl+X without a native `cut` event and for locked-cell protection on that fallback path.
- `npm test`: 8 files / 139 tests passed.
- `npm run build`: passed TypeScript checks and Vite production build.
- Browser smoke at `http://127.0.0.1:5173/`: sample tree and `monster.csv` opened, non-clipboard keyboard/editing flow passed through A1 selection, ArrowRight, B2 double-click edit, Enter commit to B3, grid measured `948 x 529`, and console error log was empty. The in-app browser automation layer blocked native clipboard shortcut injection, so Ctrl+X/C/V fallback behavior is covered by component tests.

## Verification Run - 2026-06-07 Synchronous Grid Focus

- Keyboard focus hardening: requests to return focus to the grid keyboard proxy now focus synchronously and also retry after React layout. This narrows the race where a very fast keypress after Enter, F2/Escape, or viewport focus could land on the grid container instead of the keyboard proxy, which is especially visible with pinyin IME first-letter input.
- `npm test -- src/components/GridEditor.test.tsx`: 1 file / 52 tests passed after adding regressions for immediate focus after Enter commit and synchronous focus handoff when the grid viewport itself receives focus.
- `npm test`: 8 files / 140 tests passed.
- `npm run build`: passed TypeScript checks and Vite production build.
- `npm run check:tables`: read-only parsed `D:\2D_AI_WORKING\Tables`, 1154 CSV files, 235915 rows, max 294 columns, UTF-8 1151 / GB18030 3.
- Browser smoke at `http://127.0.0.1:5173/`: sample tree and `monster.csv` opened, B2 double-click edit accepted keyboard input, Enter committed to B3, immediate `q` opened a B3 editor with value `q`, grid measured `948 x 529`, and console error log was empty.
- Read-only SVN check for `D:\2D_AI_WORKING\Tables\npc.csv`: `svn diff` and `svn status` produced no output, so the previously mentioned local unsubmitted diff/corruption state is not currently reproducible from that file on this working copy.

## Current Known Gaps

- Chrome/Edge 原生目录选择弹窗无法在当前自动化环境里直接选择真实目录，仍需要人工点一次目录授权；授权后功能可通过只读 `npm run check:tables` 和浏览器样例流程覆盖主要行为。
- 浏览器烟测已覆盖页面布局、工具栏换行、表格拖拽选区、缩放、列宽拖拽和滚动；大目录树滚动用组件级 synthetic large tree 自动化覆盖。
- 当前浏览器自动化环境禁用了原生 Ctrl+C/Ctrl+V 注入；复制态和粘贴定位/铺展由组件级自动化覆盖，真实浏览器 smoke 覆盖了不依赖系统剪贴板的键盘编辑与选择行为。
