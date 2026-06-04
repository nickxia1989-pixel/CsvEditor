# CSV Workspace Editor

浏览器版 CSV 一站式查看和编辑器，面向本地表格目录。

## Run

```bash
npm install
npm run dev
```

打开 `http://127.0.0.1:5173/`。本地目录选择依赖 Chromium 的 File System Access API，请使用 Chrome 或 Edge。

## Features

- 选择本地目录，左侧懒加载目录树，只列出 CSV 文件。
- 多 CSV 页签，上方显示未保存标记和磁盘冲突提示。
- 虚拟滚动表格，支持单元格编辑、公式栏编辑、复制/粘贴 TSV、增行、增列。
- 支持锁定选区，锁定格不能编辑。
- 支持格子缩放、列宽拖拽、冻结到当前格。
- 每 2 秒检查已打开 CSV 的磁盘版本：干净页签自动刷新，未保存页签只标记冲突，不覆盖本地编辑。
- 保存时才申请写权限；读取和热刷新不会长期占用 CSV 文件。

## Verify

```bash
npm test
npm run build
```

`样例`按钮会打开内置只读样例目录，用于快速检查 UI，不会修改任何外部表格目录。
