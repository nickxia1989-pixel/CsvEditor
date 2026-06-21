# CsvEditor 项目规则

## 交付前验证

每次修改功能或测试后，准备交付前必须刷新 Windows release，并验证刷新后的打包版。

标准流程：

1. 运行 `npm run dist:desktop`，重新生成 `release\CSV Workspace Editor`。
2. 运行 `npm run desktop:smoke -- --exe "release\CSV Workspace Editor\CSV Workspace Editor.exe"`，用打包后的 Windows 版执行桌面烟测。
3. 只有上述打包与打包版烟测都通过后，才算可以交付。

注意：Windows release 的交付物是整个 `release\CSV Workspace Editor` 目录，不是单独的 exe 文件。
