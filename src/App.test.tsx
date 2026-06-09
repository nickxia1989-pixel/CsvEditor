import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import type { BrowserDirectoryHandle, BrowserFileHandle, CsvDesktopApi } from "./lib/fileRefs";

class MockFileHandle implements BrowserFileHandle {
  kind = "file" as const;
  name: string;
  private bytes: Uint8Array;
  private modified = 1;

  constructor(name: string, data: string | Uint8Array) {
    this.name = name;
    this.bytes = typeof data === "string" ? new TextEncoder().encode(data) : new Uint8Array(data);
  }

  async getFile(): Promise<File> {
    const bytes = new Uint8Array(this.bytes);
    return {
      name: this.name,
      lastModified: this.modified,
      size: bytes.byteLength,
      arrayBuffer: async () => bytes.buffer
    } as File;
  }

  async queryPermission(): Promise<PermissionState> {
    return "granted";
  }

  async createWritable() {
    return {
      write: async (data: string | Uint8Array) => {
        this.bytes = typeof data === "string" ? new TextEncoder().encode(data) : new Uint8Array(data);
        this.modified += 1;
      },
      close: async () => undefined
    };
  }

  getText(encoding = "utf-8"): string {
    return new TextDecoder(encoding).decode(this.bytes);
  }

  getBytes(): Uint8Array {
    return new Uint8Array(this.bytes);
  }

  externalWrite(data: string | Uint8Array): void {
    this.bytes = typeof data === "string" ? new TextEncoder().encode(data) : new Uint8Array(data);
    this.modified += 1;
  }
}

class MockDirectoryHandle implements BrowserDirectoryHandle {
  kind = "directory" as const;
  name: string;
  private children: Array<[string, BrowserFileHandle | BrowserDirectoryHandle]>;

  constructor(name: string, children: Array<[string, BrowserFileHandle | BrowserDirectoryHandle]>) {
    this.name = name;
    this.children = children;
  }

  async *entries(): AsyncIterableIterator<[string, BrowserFileHandle | BrowserDirectoryHandle]> {
    for (const child of this.children) {
      yield child;
    }
  }
}

afterEach(() => {
  vi.restoreAllMocks();
  Reflect.deleteProperty(window, "showDirectoryPicker");
  Reflect.deleteProperty(window, "csvDesktop");
});

describe("App local directory flow", () => {
  it("renders frameless desktop window controls and forwards button actions", async () => {
    const api: CsvDesktopApi = {
      pickDirectory: vi.fn(),
      listDirectory: vi.fn(),
      readFile: vi.fn(),
      writeFile: vi.fn(),
      getVersion: vi.fn(),
      getWindowState: vi.fn(async () => ({ maximized: false, fullscreen: false })),
      minimizeWindow: vi.fn(async () => undefined),
      toggleMaximizeWindow: vi.fn(async () => ({ maximized: true, fullscreen: false })),
      closeWindow: vi.fn(async () => undefined),
      onWindowStateChange: vi.fn(() => vi.fn())
    };
    Object.defineProperty(window, "csvDesktop", {
      configurable: true,
      value: api
    });

    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "最小化" }));
    fireEvent.click(screen.getByRole("button", { name: "最大化" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "还原" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "关闭" }));

    expect(api.minimizeWindow).toHaveBeenCalledTimes(1);
    expect(api.toggleMaximizeWindow).toHaveBeenCalledTimes(1);
    expect(api.closeWindow).toHaveBeenCalledTimes(1);
  });

  it("uses a hidden 5 second hot refresh interval", () => {
    const intervalSpy = vi.spyOn(window, "setInterval");

    render(<App />);

    expect(intervalSpy).toHaveBeenCalledWith(expect.any(Function), 5000);
    expect(screen.queryByText(/^热刷新/)).not.toBeInTheDocument();
  });

  it("keeps current file actions in the directory pane instead of the topbar", () => {
    const { container } = render(<App />);

    const directoryPane = container.querySelector(".directory-pane");
    expect(directoryPane).toContainElement(screen.getByRole("button", { name: "刷新" }));
    expect(directoryPane).toContainElement(screen.getByRole("button", { name: "保存" }));
    expect(directoryPane).toContainElement(screen.getByRole("button", { name: "全部保存" }));
    expect(container.querySelector(".topbar-actions")).not.toBeInTheDocument();
  });

  it("auto refreshes a clean tab when the disk version changes", async () => {
    const intervalSpy = vi.spyOn(window, "setInterval");
    const file = new MockFileHandle("auto-refresh-clean.csv", "A,B\n1,2");
    const root = new MockDirectoryHandle("Tables", [["auto-refresh-clean.csv", file]]);
    Object.defineProperty(window, "showDirectoryPicker", {
      configurable: true,
      value: vi.fn(async () => root)
    });

    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "选择目录" }));
    fireEvent.click(await screen.findByRole("button", { name: "auto-refresh-clean.csv" }));
    await waitFor(() => expect(screen.getByLabelText("Selected cell value")).toHaveValue("A"));
    const poll = intervalSpy.mock.calls.find((call) => call[1] === 5000)?.[0] as (() => Promise<void>) | undefined;
    expect(poll).toBeDefined();

    file.externalWrite("REMOTE,B\n1,2");
    await act(async () => {
      await poll?.();
    });

    await waitFor(() => expect(screen.getByLabelText("Selected cell value")).toHaveValue("REMOTE"));
    expect(screen.getByText("未保存 0")).toBeInTheDocument();
  });

  it("marks a clean tab as externally changed when auto refresh is paused", async () => {
    const intervalSpy = vi.spyOn(window, "setInterval");
    const file = new MockFileHandle("auto-refresh-paused.csv", "A,B\n1,2");
    const root = new MockDirectoryHandle("Tables", [["auto-refresh-paused.csv", file]]);
    Object.defineProperty(window, "showDirectoryPicker", {
      configurable: true,
      value: vi.fn(async () => root)
    });

    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "选择目录" }));
    fireEvent.click(await screen.findByRole("button", { name: "auto-refresh-paused.csv" }));
    await waitFor(() => expect(screen.getByLabelText("Selected cell value")).toHaveValue("A"));
    fireEvent.click(screen.getByRole("button", { name: "自动热刷" }));
    expect(screen.getByRole("button", { name: "热刷暂停" })).toBeInTheDocument();
    const poll = intervalSpy.mock.calls.find((call) => call[1] === 5000)?.[0] as (() => Promise<void>) | undefined;
    expect(poll).toBeDefined();

    file.externalWrite("REMOTE,B\n1,2");
    await act(async () => {
      await poll?.();
    });

    expect(screen.getByLabelText("Selected cell value")).toHaveValue("A");
    expect(screen.getByText("磁盘版本已变化。当前页签有未保存修改时不会自动覆盖。")).toBeInTheDocument();
    expect(screen.getByText("未保存 0")).toBeInTheDocument();
  });

  it("does not auto refresh over an uncommitted inline edit", async () => {
    const intervalSpy = vi.spyOn(window, "setInterval");
    const file = new MockFileHandle("auto-refresh-inline.csv", "A,B\n1,2");
    const root = new MockDirectoryHandle("Tables", [["auto-refresh-inline.csv", file]]);
    Object.defineProperty(window, "showDirectoryPicker", {
      configurable: true,
      value: vi.fn(async () => root)
    });

    const { container } = render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "选择目录" }));
    fireEvent.click(await screen.findByRole("button", { name: "auto-refresh-inline.csv" }));
    await waitFor(() => expect(screen.getByRole("gridcell", { name: "A1" })).toBeInTheDocument());

    fireEvent.doubleClick(screen.getByRole("gridcell", { name: "A1" }));
    const editor = await waitFor(() => {
      const input = container.querySelector(".cell-editor") as HTMLInputElement | null;
      expect(input).toBeInTheDocument();
      return input as HTMLInputElement;
    });
    fireEvent.change(editor, { target: { value: "INLINE_LOCAL" } });
    const poll = intervalSpy.mock.calls.find((call) => call[1] === 5000)?.[0] as (() => Promise<void>) | undefined;
    expect(poll).toBeDefined();

    file.externalWrite("REMOTE,B\n1,2");
    await act(async () => {
      await poll?.();
    });

    expect(editor).toHaveValue("INLINE_LOCAL");
    expect(screen.getByLabelText("Selected cell value")).toHaveValue("A");
    expect(screen.getByText("磁盘版本已变化。当前页签有未保存修改时不会自动覆盖。")).toBeInTheDocument();
    expect(screen.getByText("未保存 1")).toBeInTheDocument();
  });

  it("resizes the sidebar with a pointer and clamps to bounds", async () => {
    render(<App />);

    const resizer = screen.getByRole("separator", { name: "调整侧边栏宽度" });
    const appFrame = resizer.closest(".app-frame");

    expect(resizer).toHaveAttribute("aria-valuenow", "310");

    fireEvent.pointerDown(resizer, { clientX: 310 });
    await waitFor(() => expect(appFrame).toHaveClass("resizing-sidebar"));

    fireEvent.pointerMove(window, { clientX: 430 });
    await waitFor(() => expect(resizer).toHaveAttribute("aria-valuenow", "430"));

    fireEvent.pointerMove(window, { clientX: -100 });
    await waitFor(() => expect(resizer).toHaveAttribute("aria-valuenow", "240"));

    fireEvent.pointerMove(window, { clientX: 900 });
    await waitFor(() => expect(resizer).toHaveAttribute("aria-valuenow", "520"));

    fireEvent.pointerUp(window);
    await waitFor(() => expect(appFrame).not.toHaveClass("resizing-sidebar"));

    fireEvent.doubleClick(resizer);
    expect(resizer).toHaveAttribute("aria-valuenow", "310");
  });

  it("does not leave the app in resize mode after an immediate pointer release", () => {
    render(<App />);

    const resizer = screen.getByRole("separator", { name: "调整侧边栏宽度" });
    const appFrame = resizer.closest(".app-frame");

    fireEvent.pointerDown(resizer, { button: 0, clientX: 310 });
    fireEvent.pointerUp(window);

    expect(appFrame).not.toHaveClass("resizing-sidebar");
    expect(resizer).toHaveAttribute("aria-valuenow", "310");
  });

  it("ignores non-primary pointer buttons on the sidebar resizer", () => {
    render(<App />);

    const resizer = screen.getByRole("separator", { name: "调整侧边栏宽度" });
    const appFrame = resizer.closest(".app-frame");

    fireEvent.pointerDown(resizer, { button: 2, clientX: 310 });
    fireEvent.pointerMove(window, { clientX: 430 });

    expect(appFrame).not.toHaveClass("resizing-sidebar");
    expect(resizer).toHaveAttribute("aria-valuenow", "310");
  });

  it("supports keyboard sidebar resizing shortcuts", () => {
    render(<App />);

    const resizer = screen.getByRole("separator", { name: "调整侧边栏宽度" });

    fireEvent.keyDown(resizer, { key: "ArrowRight" });
    expect(resizer).toHaveAttribute("aria-valuenow", "330");

    fireEvent.keyDown(resizer, { key: "ArrowRight", shiftKey: true });
    expect(resizer).toHaveAttribute("aria-valuenow", "390");

    fireEvent.keyDown(resizer, { key: "ArrowLeft" });
    expect(resizer).toHaveAttribute("aria-valuenow", "370");

    fireEvent.keyDown(resizer, { key: "Home" });
    expect(resizer).toHaveAttribute("aria-valuenow", "240");

    fireEvent.keyDown(resizer, { key: "End" });
    expect(resizer).toHaveAttribute("aria-valuenow", "520");
  });

  it("opens a CSV from a picked directory and marks edits as dirty", async () => {
    const file = new MockFileHandle("monster.csv", "ID,Name\n1001,Slime");
    const root = new MockDirectoryHandle("Tables", [
      ["monster", new MockDirectoryHandle("monster", [["monster.csv", file]])]
    ]);
    Object.defineProperty(window, "showDirectoryPicker", {
      configurable: true,
      value: vi.fn(async () => root)
    });

    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "选择目录" }));
    expect(await screen.findByRole("button", { name: "monster" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "monster" }));
    expect(await screen.findByRole("button", { name: "monster.csv" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "monster.csv" }));
    await waitFor(() => expect(screen.getByLabelText("Selected cell value")).toHaveValue("ID"));
    expect(screen.getByRole("tab", { name: /monster\.csv/ })).toBeInTheDocument();
    expect(screen.getByText("冻结 2 行 / 2 列")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Selected cell value"), { target: { value: "ID_EDIT" } });

    await waitFor(() => expect(screen.getByText("未保存 1")).toBeInTheDocument());
    expect(screen.getByRole("tab", { name: "monster.csv未保存" })).toBeInTheDocument();
  });

  it("saves every dirty writable tab", async () => {
    const first = new MockFileHandle("first.csv", "ID,Name\n1,Alpha");
    const second = new MockFileHandle("second.csv", "ID,Name\n2,Beta");
    const root = new MockDirectoryHandle("Tables", [
      ["first.csv", first],
      ["second.csv", second]
    ]);
    Object.defineProperty(window, "showDirectoryPicker", {
      configurable: true,
      value: vi.fn(async () => root)
    });

    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "选择目录" }));
    expect(await screen.findByRole("button", { name: "first.csv" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "first.csv" }));
    await waitFor(() => expect(screen.getByLabelText("Selected cell value")).toHaveValue("ID"));
    fireEvent.change(screen.getByLabelText("Selected cell value"), { target: { value: "ID_A" } });

    fireEvent.click(screen.getByRole("button", { name: "second.csv" }));
    await waitFor(() => expect(screen.getByLabelText("Selected cell value")).toHaveValue("ID"));
    fireEvent.change(screen.getByLabelText("Selected cell value"), { target: { value: "ID_B" } });

    await waitFor(() => expect(screen.getByText("未保存 2")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "全部保存" }));

    await waitFor(() => expect(screen.getByText("未保存 0")).toBeInTheDocument());
    expect(first.getText()).toContain("ID_A,Name");
    expect(second.getText()).toContain("ID_B,Name");
  });

  it("finds CSV files inside unopened subdirectories when filtering", async () => {
    const deepFile = new MockFileHandle("rare_monster.csv", "ID,Name\n9001,Rare");
    const root = new MockDirectoryHandle("Tables", [
      [
        "monster",
        new MockDirectoryHandle("monster", [
          ["common.csv", new MockFileHandle("common.csv", "ID,Name\n1,Common")],
          ["hidden", new MockDirectoryHandle("hidden", [["rare_monster.csv", deepFile]])]
        ])
      ],
      ["npc.csv", new MockFileHandle("npc.csv", "ID,Name\n1,Npc")]
    ]);
    Object.defineProperty(window, "showDirectoryPicker", {
      configurable: true,
      value: vi.fn(async () => root)
    });

    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "选择目录" }));
    expect(await screen.findByRole("button", { name: "monster" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "rare_monster.csv" })).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("搜索全部 CSV"), { target: { value: "rare_monster" } });

    expect(await screen.findByRole("button", { name: "hidden" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "rare_monster.csv" })).toBeInTheDocument();
  });

  it("preserves untouched CSV row formatting when saving an edit", async () => {
    const original = '34,测试lilifute ,测试\r\n""\r\n35,伊莉亚,测试\r\n';
    const file = new MockFileHandle("format.csv", original);
    const root = new MockDirectoryHandle("Tables", [["format.csv", file]]);
    Object.defineProperty(window, "showDirectoryPicker", {
      configurable: true,
      value: vi.fn(async () => root)
    });

    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "选择目录" }));
    fireEvent.click(await screen.findByRole("button", { name: "format.csv" }));
    await waitFor(() => expect(screen.getByRole("gridcell", { name: "A3" })).toBeInTheDocument());

    fireEvent.pointerDown(screen.getByRole("gridcell", { name: "A3" }), { clientX: 80, clientY: 130 });
    fireEvent.change(screen.getByLabelText("Selected cell value"), { target: { value: "350" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => expect(screen.getByText("未保存 0")).toBeInTheDocument());
    expect(file.getText()).toBe('34,测试lilifute ,测试\r\n""\r\n350,伊莉亚,测试\r\n');
  });

  it("preserves unchanged field formatting inside an edited CSV row", async () => {
    const original = '34,测试lilifute ,测试\r\n""\r\n35,伊莉亚,测试\r\n';
    const file = new MockFileHandle("same-row-format.csv", original);
    const root = new MockDirectoryHandle("Tables", [["same-row-format.csv", file]]);
    Object.defineProperty(window, "showDirectoryPicker", {
      configurable: true,
      value: vi.fn(async () => root)
    });

    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "选择目录" }));
    fireEvent.click(await screen.findByRole("button", { name: "same-row-format.csv" }));
    await waitFor(() => expect(screen.getByRole("gridcell", { name: "A1" })).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText("Selected cell value"), { target: { value: "340" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => expect(screen.getByText("未保存 0")).toBeInTheDocument());
    expect(file.getText()).toBe('340,测试lilifute ,测试\r\n""\r\n35,伊莉亚,测试\r\n');
  });

  it("preserves GB18030 bytes when saving a legacy encoded CSV", async () => {
    const original = new Uint8Array([
      0x49, 0x44, 0x2c, 0x4e, 0x61, 0x6d, 0x65, 0x0d, 0x0a,
      0x31, 0x2c, 0xd6, 0xd0, 0xce, 0xc4, 0x0d, 0x0a
    ]);
    const file = new MockFileHandle("gb18030.csv", original);
    const root = new MockDirectoryHandle("Tables", [["gb18030.csv", file]]);
    Object.defineProperty(window, "showDirectoryPicker", {
      configurable: true,
      value: vi.fn(async () => root)
    });

    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "选择目录" }));
    fireEvent.click(await screen.findByRole("button", { name: "gb18030.csv" }));
    await waitFor(() => expect(screen.getByText("2 行 / 2 列 / GB18030")).toBeInTheDocument());

    fireEvent.pointerDown(screen.getByRole("gridcell", { name: "A2" }), { clientX: 80, clientY: 80 });
    fireEvent.change(screen.getByLabelText("Selected cell value"), { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => expect(screen.getByText("未保存 0")).toBeInTheDocument());
    expect(file.getText("gb18030")).toBe("ID,Name\r\n2,中文\r\n");
    expect([...file.getBytes()]).toEqual([
      0x49, 0x44, 0x2c, 0x4e, 0x61, 0x6d, 0x65, 0x0d, 0x0a,
      0x32, 0x2c, 0xd6, 0xd0, 0xce, 0xc4, 0x0d, 0x0a
    ]);
  });

  it("saves the current inline editor value when pressing Ctrl+S", async () => {
    const file = new MockFileHandle("inline-save.csv", "ID,Name\n1,Alpha");
    const root = new MockDirectoryHandle("Tables", [["inline-save.csv", file]]);
    Object.defineProperty(window, "showDirectoryPicker", {
      configurable: true,
      value: vi.fn(async () => root)
    });

    const { container } = render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "选择目录" }));
    fireEvent.click(await screen.findByRole("button", { name: "inline-save.csv" }));
    await waitFor(() => expect(screen.getByRole("gridcell", { name: "A1" })).toBeInTheDocument());

    fireEvent.doubleClick(screen.getByRole("gridcell", { name: "A1" }));
    const editor = await waitFor(() => {
      const input = container.querySelector(".cell-editor") as HTMLInputElement | null;
      expect(input).toBeInTheDocument();
      return input as HTMLInputElement;
    });
    fireEvent.change(editor, { target: { value: "Edited ID" } });
    await waitFor(() => expect(screen.getByText("未保存 1")).toBeInTheDocument());
    fireEvent.keyDown(editor, { key: "s", ctrlKey: true });

    await waitFor(() => expect(screen.getByText("未保存 0")).toBeInTheDocument());
    expect(file.getText()).toBe("Edited ID,Name\n1,Alpha");
  });

  it("commits an active inline editor before the global Ctrl+S save handler", async () => {
    const file = new MockFileHandle("global-inline-save.csv", "ID,Name\n1,Alpha");
    const root = new MockDirectoryHandle("Tables", [["global-inline-save.csv", file]]);
    Object.defineProperty(window, "showDirectoryPicker", {
      configurable: true,
      value: vi.fn(async () => root)
    });

    const { container } = render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "选择目录" }));
    fireEvent.click(await screen.findByRole("button", { name: "global-inline-save.csv" }));
    await waitFor(() => expect(screen.getByRole("gridcell", { name: "A1" })).toBeInTheDocument());

    fireEvent.doubleClick(screen.getByRole("gridcell", { name: "A1" }));
    const editor = await waitFor(() => {
      const input = container.querySelector(".cell-editor") as HTMLInputElement | null;
      expect(input).toBeInTheDocument();
      return input as HTMLInputElement;
    });
    fireEvent.change(editor, { target: { value: "Global Saved ID" } });

    fireEvent.keyDown(window, { key: "s", ctrlKey: true });

    await waitFor(() => expect(screen.getByText("未保存 0")).toBeInTheDocument());
    expect(container.querySelector(".cell-editor")).not.toBeInTheDocument();
    expect(file.getText()).toBe("Global Saved ID,Name\n1,Alpha");
  });

  it("starts typing in the next selected cell immediately after Enter commits an inline edit", async () => {
    const file = new MockFileHandle("enter-next-type.csv", "ID,Name\n1,Alpha");
    const root = new MockDirectoryHandle("Tables", [["enter-next-type.csv", file]]);
    Object.defineProperty(window, "showDirectoryPicker", {
      configurable: true,
      value: vi.fn(async () => root)
    });

    const { container } = render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "选择目录" }));
    fireEvent.click(await screen.findByRole("button", { name: "enter-next-type.csv" }));
    await waitFor(() => expect(screen.getByRole("gridcell", { name: "A1" })).toBeInTheDocument());

    fireEvent.doubleClick(screen.getByRole("gridcell", { name: "A1" }));
    let editor = await waitFor(() => {
      const input = container.querySelector(".cell-editor") as HTMLInputElement | null;
      expect(input).toBeInTheDocument();
      return input as HTMLInputElement;
    });
    fireEvent.change(editor, { target: { value: "Edited ID" } });
    fireEvent.keyDown(editor, { key: "Enter" });

    await waitFor(() => expect(screen.getByText("A2")).toBeInTheDocument());
    const keyProxy = screen.getByLabelText("Grid keyboard input") as HTMLInputElement;
    fireEvent.change(keyProxy, { target: { value: "x" } });

    editor = container.querySelector(".cell-editor") as HTMLInputElement;
    expect(editor).toBeInTheDocument();
    expect(editor).toHaveValue("x");

    fireEvent.keyDown(editor, { key: "Enter" });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => expect(screen.getByText("未保存 0")).toBeInTheDocument());
    expect(file.getText()).toBe("Edited ID,Name\nx,Alpha");
  });

  it("undoes an active inline draft from the toolbar without leaving the tab dirty", async () => {
    const file = new MockFileHandle("undo-inline.csv", "ID,Name\n1,Alpha");
    const root = new MockDirectoryHandle("Tables", [["undo-inline.csv", file]]);
    Object.defineProperty(window, "showDirectoryPicker", {
      configurable: true,
      value: vi.fn(async () => root)
    });

    const { container } = render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "选择目录" }));
    fireEvent.click(await screen.findByRole("button", { name: "undo-inline.csv" }));
    await waitFor(() => expect(screen.getByRole("gridcell", { name: "A1" })).toBeInTheDocument());

    fireEvent.doubleClick(screen.getByRole("gridcell", { name: "A1" }));
    const editor = await waitFor(() => {
      const input = container.querySelector(".cell-editor") as HTMLInputElement | null;
      expect(input).toBeInTheDocument();
      return input as HTMLInputElement;
    });
    fireEvent.change(editor, { target: { value: "Edited ID" } });

    const undoButton = screen.getByRole("button", { name: "撤销" });
    expect(undoButton).toBeEnabled();
    fireEvent.click(undoButton);

    await waitFor(() => expect(screen.getByLabelText("Selected cell value")).toHaveValue("ID"));
    expect(container.querySelector(".cell-editor")).not.toBeInTheDocument();
    expect(screen.getByText("未保存 0")).toBeInTheDocument();
    expect(file.getText()).toBe("ID,Name\n1,Alpha");
  });

  it("saves an uncommitted inline editor value from the toolbar save button", async () => {
    const file = new MockFileHandle("toolbar-inline-save.csv", "ID,Name\n1,Alpha");
    const root = new MockDirectoryHandle("Tables", [["toolbar-inline-save.csv", file]]);
    Object.defineProperty(window, "showDirectoryPicker", {
      configurable: true,
      value: vi.fn(async () => root)
    });

    const { container } = render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "选择目录" }));
    fireEvent.click(await screen.findByRole("button", { name: "toolbar-inline-save.csv" }));
    await waitFor(() => expect(screen.getByRole("gridcell", { name: "A1" })).toBeInTheDocument());

    fireEvent.doubleClick(screen.getByRole("gridcell", { name: "A1" }));
    const editor = await waitFor(() => {
      const input = container.querySelector(".cell-editor") as HTMLInputElement | null;
      expect(input).toBeInTheDocument();
      return input as HTMLInputElement;
    });
    fireEvent.change(editor, { target: { value: "Edited ID" } });

    await waitFor(() => expect(screen.getByRole("tab", { name: "toolbar-inline-save.csv未保存" })).toBeInTheDocument());
    const saveButton = screen.getByRole("button", { name: "保存" });
    expect(saveButton).toBeEnabled();
    fireEvent.click(saveButton);

    await waitFor(() => expect(screen.getByText("未保存 0")).toBeInTheDocument());
    expect(file.getText()).toBe("Edited ID,Name\n1,Alpha");
  });

  it("saves an uncommitted inline editor value from the save-all button", async () => {
    const file = new MockFileHandle("save-all-inline.csv", "ID,Name\n1,Alpha");
    const root = new MockDirectoryHandle("Tables", [["save-all-inline.csv", file]]);
    Object.defineProperty(window, "showDirectoryPicker", {
      configurable: true,
      value: vi.fn(async () => root)
    });

    const { container } = render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "选择目录" }));
    fireEvent.click(await screen.findByRole("button", { name: "save-all-inline.csv" }));
    await waitFor(() => expect(screen.getByRole("gridcell", { name: "A1" })).toBeInTheDocument());

    fireEvent.doubleClick(screen.getByRole("gridcell", { name: "A1" }));
    const editor = await waitFor(() => {
      const input = container.querySelector(".cell-editor") as HTMLInputElement | null;
      expect(input).toBeInTheDocument();
      return input as HTMLInputElement;
    });
    fireEvent.change(editor, { target: { value: "Saved All ID" } });

    await waitFor(() => expect(screen.getByRole("tab", { name: "save-all-inline.csv未保存" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "全部保存" }));

    await waitFor(() => expect(screen.getByText("未保存 0")).toBeInTheDocument());
    expect(file.getText()).toBe("Saved All ID,Name\n1,Alpha");
  });

  it("commits an uncommitted inline editor value before grid structural edits", async () => {
    const file = new MockFileHandle("inline-structural.csv", "ID,Name\n1,Alpha");
    const root = new MockDirectoryHandle("Tables", [["inline-structural.csv", file]]);
    Object.defineProperty(window, "showDirectoryPicker", {
      configurable: true,
      value: vi.fn(async () => root)
    });

    const { container } = render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "选择目录" }));
    fireEvent.click(await screen.findByRole("button", { name: "inline-structural.csv" }));
    await waitFor(() => expect(screen.getByRole("gridcell", { name: "A1" })).toBeInTheDocument());

    fireEvent.doubleClick(screen.getByRole("gridcell", { name: "A1" }));
    const editor = await waitFor(() => {
      const input = container.querySelector(".cell-editor") as HTMLInputElement | null;
      expect(input).toBeInTheDocument();
      return input as HTMLInputElement;
    });
    fireEvent.change(editor, { target: { value: "Edited ID" } });
    fireEvent.click(screen.getByRole("button", { name: "插行" }));
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => expect(screen.getByText("未保存 0")).toBeInTheDocument());
    expect(file.getText()).toBe(",\nEdited ID,Name\n1,Alpha");
  });

  it("blocks browser unload for an uncommitted inline editor value", async () => {
    const file = new MockFileHandle("unload-inline.csv", "ID,Name\n1,Alpha");
    const root = new MockDirectoryHandle("Tables", [["unload-inline.csv", file]]);
    Object.defineProperty(window, "showDirectoryPicker", {
      configurable: true,
      value: vi.fn(async () => root)
    });

    const { container } = render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "选择目录" }));
    fireEvent.click(await screen.findByRole("button", { name: "unload-inline.csv" }));
    await waitFor(() => expect(screen.getByRole("gridcell", { name: "A1" })).toBeInTheDocument());

    fireEvent.doubleClick(screen.getByRole("gridcell", { name: "A1" }));
    const editor = await waitFor(() => {
      const input = container.querySelector(".cell-editor") as HTMLInputElement | null;
      expect(input).toBeInTheDocument();
      return input as HTMLInputElement;
    });
    fireEvent.change(editor, { target: { value: "Edited ID" } });
    await waitFor(() => expect(screen.getByText("未保存 1")).toBeInTheDocument());

    const unloadEvent = new Event("beforeunload", { cancelable: true }) as BeforeUnloadEvent;
    window.dispatchEvent(unloadEvent);

    expect(unloadEvent.defaultPrevented).toBe(true);
  });

  it("marks direct keyboard seeded inline edits as dirty before commit", async () => {
    const file = new MockFileHandle("keyboard-seed.csv", "ID,Name\n1,Alpha");
    const root = new MockDirectoryHandle("Tables", [["keyboard-seed.csv", file]]);
    Object.defineProperty(window, "showDirectoryPicker", {
      configurable: true,
      value: vi.fn(async () => root)
    });

    const { container } = render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "选择目录" }));
    fireEvent.click(await screen.findByRole("button", { name: "keyboard-seed.csv" }));
    await waitFor(() => expect(screen.getByRole("gridcell", { name: "A1" })).toBeInTheDocument());

    fireEvent.pointerDown(screen.getByRole("gridcell", { name: "A1" }));
    fireEvent.change(screen.getByLabelText("Grid keyboard input"), { target: { value: "K" } });

    await waitFor(() => {
      expect(container.querySelector(".cell-editor")).toHaveValue("K");
      expect(screen.getByRole("tab", { name: "keyboard-seed.csv未保存" })).toBeInTheDocument();
    });

    const unloadEvent = new Event("beforeunload", { cancelable: true }) as BeforeUnloadEvent;
    window.dispatchEvent(unloadEvent);

    expect(unloadEvent.defaultPrevented).toBe(true);
  });

  it("preserves raw field formatting when editing a virtual new column", async () => {
    const original = '34,"keep,comma",测试lilifute \r\n35,伊莉亚,测试\r\n';
    const file = new MockFileHandle("virtual-column-format.csv", original);
    const root = new MockDirectoryHandle("Tables", [["virtual-column-format.csv", file]]);
    Object.defineProperty(window, "showDirectoryPicker", {
      configurable: true,
      value: vi.fn(async () => root)
    });

    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "选择目录" }));
    fireEvent.click(await screen.findByRole("button", { name: "virtual-column-format.csv" }));
    await waitFor(() => expect(screen.getByRole("gridcell", { name: "D1" })).toBeInTheDocument());

    fireEvent.pointerDown(screen.getByRole("gridcell", { name: "D1" }), { clientX: 450, clientY: 70 });
    fireEvent.change(screen.getByLabelText("Selected cell value"), { target: { value: "added" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => expect(screen.getByText("未保存 0")).toBeInTheDocument());
    expect(file.getText()).toBe('34,"keep,comma",测试lilifute ,added\r\n35,伊莉亚,测试\r\n');
  });

  it("keeps source row formatting aligned after inserting a row", async () => {
    const original = '34,测试lilifute ,测试\r\n""\r\n35,伊莉亚,测试\r\n';
    const file = new MockFileHandle("insert-format.csv", original);
    const root = new MockDirectoryHandle("Tables", [["insert-format.csv", file]]);
    Object.defineProperty(window, "showDirectoryPicker", {
      configurable: true,
      value: vi.fn(async () => root)
    });

    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "选择目录" }));
    fireEvent.click(await screen.findByRole("button", { name: "insert-format.csv" }));
    await waitFor(() => expect(screen.getByRole("rowheader", { name: "Row 2" })).toBeInTheDocument());

    fireEvent.pointerDown(screen.getByRole("rowheader", { name: "Row 2" }));
    fireEvent.click(screen.getByRole("button", { name: "插行" }));
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => expect(screen.getByText("未保存 0")).toBeInTheDocument());
    expect(file.getText()).toBe('34,测试lilifute ,测试\r\n,,\r\n""\r\n35,伊莉亚,测试\r\n');
  });

  it("preserves raw field formatting after inserting a column", async () => {
    const original = '34,"keep,comma",测试lilifute \r\n35,伊莉亚,测试\r\n';
    const file = new MockFileHandle("insert-column-format.csv", original);
    const root = new MockDirectoryHandle("Tables", [["insert-column-format.csv", file]]);
    Object.defineProperty(window, "showDirectoryPicker", {
      configurable: true,
      value: vi.fn(async () => root)
    });

    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "选择目录" }));
    fireEvent.click(await screen.findByRole("button", { name: "insert-column-format.csv" }));
    await waitFor(() => expect(screen.getByRole("columnheader", { name: "Column B" })).toBeInTheDocument());

    fireEvent.pointerDown(screen.getByRole("columnheader", { name: "Column B" }));
    fireEvent.click(screen.getByRole("button", { name: "插列" }));
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => expect(screen.getByText("未保存 0")).toBeInTheDocument());
    expect(file.getText()).toBe('34,,"keep,comma",测试lilifute \r\n35,,伊莉亚,测试\r\n');
  });

  it("preserves raw field formatting after deleting a column", async () => {
    const original = '34,"keep,comma",测试lilifute \r\n35,伊莉亚,测试\r\n';
    const file = new MockFileHandle("delete-column-format.csv", original);
    const root = new MockDirectoryHandle("Tables", [["delete-column-format.csv", file]]);
    Object.defineProperty(window, "showDirectoryPicker", {
      configurable: true,
      value: vi.fn(async () => root)
    });

    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "选择目录" }));
    fireEvent.click(await screen.findByRole("button", { name: "delete-column-format.csv" }));
    await waitFor(() => expect(screen.getByRole("columnheader", { name: "Column B" })).toBeInTheDocument());

    fireEvent.pointerDown(screen.getByRole("columnheader", { name: "Column B" }));
    fireEvent.click(screen.getByRole("button", { name: "删列" }));
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => expect(screen.getByText("未保存 0")).toBeInTheDocument());
    expect(file.getText()).toBe('34,测试lilifute \r\n35,测试\r\n');
  });

  it("preserves raw field formatting after appending a column", async () => {
    const original = '34,"keep,comma",测试lilifute \r\n35,伊莉亚,测试\r\n';
    const file = new MockFileHandle("append-column-format.csv", original);
    const root = new MockDirectoryHandle("Tables", [["append-column-format.csv", file]]);
    Object.defineProperty(window, "showDirectoryPicker", {
      configurable: true,
      value: vi.fn(async () => root)
    });

    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "选择目录" }));
    fireEvent.click(await screen.findByRole("button", { name: "append-column-format.csv" }));
    await waitFor(() => expect(screen.getByRole("columnheader", { name: "Column C" })).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "增列" }));
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => expect(screen.getByText("未保存 0")).toBeInTheDocument());
    expect(file.getText()).toBe('34,"keep,comma",测试lilifute ,\r\n35,伊莉亚,测试,\r\n');
  });

  it("does not open duplicate tabs for the same CSV path", async () => {
    const first = new MockFileHandle("first.csv", "ID,Name\n1,Alpha");
    const second = new MockFileHandle("second.csv", "ID,Name\n2,Beta");
    const root = new MockDirectoryHandle("Tables", [
      ["first.csv", first],
      ["second.csv", second]
    ]);
    Object.defineProperty(window, "showDirectoryPicker", {
      configurable: true,
      value: vi.fn(async () => root)
    });

    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "选择目录" }));
    fireEvent.click(await screen.findByRole("button", { name: "first.csv" }));
    fireEvent.click(screen.getByRole("button", { name: "second.csv" }));
    fireEvent.click(screen.getByRole("button", { name: "first.csv" }));

    await waitFor(() => {
      expect(screen.getAllByRole("tab", { name: "first.csv" })).toHaveLength(1);
      expect(screen.getAllByRole("tab", { name: "second.csv" })).toHaveLength(1);
    });
    expect(screen.getByRole("tab", { name: "first.csv" })).toHaveAttribute("aria-selected", "true");
  });

  it("commits an active inline editor before opening another file from the tree", async () => {
    const first = new MockFileHandle("first.csv", "ID,Name\n1,Alpha");
    const second = new MockFileHandle("second.csv", "ID,Name\n2,Beta");
    const root = new MockDirectoryHandle("Tables", [
      ["first.csv", first],
      ["second.csv", second]
    ]);
    Object.defineProperty(window, "showDirectoryPicker", {
      configurable: true,
      value: vi.fn(async () => root)
    });

    const { container } = render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "选择目录" }));
    fireEvent.click(await screen.findByRole("button", { name: "first.csv" }));
    await waitFor(() => expect(screen.getByRole("gridcell", { name: "A1" })).toBeInTheDocument());

    fireEvent.doubleClick(screen.getByRole("gridcell", { name: "A1" }));
    const editor = await waitFor(() => {
      const input = container.querySelector(".cell-editor") as HTMLInputElement | null;
      expect(input).toBeInTheDocument();
      return input as HTMLInputElement;
    });
    fireEvent.change(editor, { target: { value: "Tree Open Draft" } });

    fireEvent.click(screen.getByRole("button", { name: "second.csv" }));

    await waitFor(() => expect(screen.getByRole("tab", { name: "second.csv" })).toHaveAttribute("aria-selected", "true"));
    expect(screen.getByRole("tab", { name: "first.csv未保存" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "first.csv未保存" }));
    await waitFor(() => expect(screen.getByRole("tab", { name: "first.csv未保存" })).toHaveAttribute("aria-selected", "true"));
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => expect(screen.getByText("未保存 0")).toBeInTheDocument());
    expect(first.getText()).toBe("Tree Open Draft,Name\n1,Alpha");
  });

  it("restores each tab scroll position when switching tabs", async () => {
    const makeCsv = (prefix: string) =>
      Array.from({ length: 80 }, (_, row) => `${prefix}${row},Name ${row},Value ${row}`).join("\n");
    const first = new MockFileHandle("first.csv", makeCsv("A"));
    const second = new MockFileHandle("second.csv", makeCsv("B"));
    const root = new MockDirectoryHandle("Tables", [
      ["first.csv", first],
      ["second.csv", second]
    ]);
    Object.defineProperty(window, "showDirectoryPicker", {
      configurable: true,
      value: vi.fn(async () => root)
    });

    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "选择目录" }));
    fireEvent.click(await screen.findByRole("button", { name: "first.csv" }));
    await waitFor(() => expect(screen.getByRole("gridcell", { name: "A1" })).toBeInTheDocument());

    const grid = screen.getByRole("grid", { name: "CSV grid" }) as HTMLDivElement;
    grid.scrollTop = 420;
    grid.scrollLeft = 180;
    fireEvent.scroll(grid);
    await waitFor(() => expect(screen.getByRole("rowheader", { name: "Row 14" })).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "second.csv" }));
    await waitFor(() => expect(screen.getByRole("tab", { name: "second.csv" })).toHaveAttribute("aria-selected", "true"));
    await waitFor(() => expect(grid.scrollTop).toBe(0));

    grid.scrollTop = 84;
    grid.scrollLeft = 60;
    fireEvent.scroll(grid);
    await waitFor(() => expect(screen.getByRole("rowheader", { name: "Row 9" })).toBeInTheDocument());

    fireEvent.click(screen.getByRole("tab", { name: "first.csv" }));
    await waitFor(() => expect(grid.scrollTop).toBe(420));
    expect(grid.scrollLeft).toBe(180);

    fireEvent.click(screen.getByRole("tab", { name: "second.csv" }));
    await waitFor(() => expect(grid.scrollTop).toBe(84));
    expect(grid.scrollLeft).toBe(60);
  });

  it("keeps a dirty tab open when close confirmation is cancelled", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const file = new MockFileHandle("close-safe.csv", "ID,Name\n1,Alpha");
    const root = new MockDirectoryHandle("Tables", [["close-safe.csv", file]]);
    Object.defineProperty(window, "showDirectoryPicker", {
      configurable: true,
      value: vi.fn(async () => root)
    });

    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "选择目录" }));
    fireEvent.click(await screen.findByRole("button", { name: "close-safe.csv" }));
    await waitFor(() => expect(screen.getByLabelText("Selected cell value")).toHaveValue("ID"));
    fireEvent.change(screen.getByLabelText("Selected cell value"), { target: { value: "ID_EDIT" } });
    await waitFor(() => expect(screen.getByText("未保存 1")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "关闭 close-safe.csv" }));

    await waitFor(() => expect(confirm).toHaveBeenCalledWith("close-safe.csv 有未保存修改，确认关闭？"));
    expect(screen.getByRole("tab", { name: "close-safe.csv未保存" })).toBeInTheDocument();
  });

  it("protects an uncommitted inline edit when closing the tab", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const file = new MockFileHandle("close-inline.csv", "ID,Name\n1,Alpha");
    const root = new MockDirectoryHandle("Tables", [["close-inline.csv", file]]);
    Object.defineProperty(window, "showDirectoryPicker", {
      configurable: true,
      value: vi.fn(async () => root)
    });

    const { container } = render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "选择目录" }));
    fireEvent.click(await screen.findByRole("button", { name: "close-inline.csv" }));
    await waitFor(() => expect(screen.getByLabelText("Selected cell value")).toHaveValue("ID"));

    fireEvent.doubleClick(screen.getByRole("gridcell", { name: "A1" }));
    const editor = await waitFor(() => {
      const input = container.querySelector(".cell-editor") as HTMLInputElement | null;
      expect(input).toBeInTheDocument();
      return input as HTMLInputElement;
    });
    fireEvent.change(editor, { target: { value: "Edited ID" } });
    await waitFor(() => expect(screen.getByRole("tab", { name: "close-inline.csv未保存" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "关闭 close-inline.csv" }));

    await waitFor(() => expect(confirm).toHaveBeenCalledWith("close-inline.csv 有未保存修改，确认关闭？"));
    expect(screen.getByRole("tab", { name: "close-inline.csv未保存" })).toBeInTheDocument();
  });

  it("closes a dirty tab when close confirmation is accepted", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const file = new MockFileHandle("close-confirm.csv", "ID,Name\n1,Alpha");
    const root = new MockDirectoryHandle("Tables", [["close-confirm.csv", file]]);
    Object.defineProperty(window, "showDirectoryPicker", {
      configurable: true,
      value: vi.fn(async () => root)
    });

    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "选择目录" }));
    fireEvent.click(await screen.findByRole("button", { name: "close-confirm.csv" }));
    await waitFor(() => expect(screen.getByLabelText("Selected cell value")).toHaveValue("ID"));
    fireEvent.change(screen.getByLabelText("Selected cell value"), { target: { value: "ID_EDIT" } });
    await waitFor(() => expect(screen.getByText("未保存 1")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "关闭 close-confirm.csv" }));

    await waitFor(() => expect(screen.queryByRole("tab", { name: /close-confirm\.csv/ })).not.toBeInTheDocument());
    expect(screen.getByText("未打开 CSV")).toBeInTheDocument();
  });

  it("blocks saving over a newer disk version when conflict confirmation is cancelled", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const file = new MockFileHandle("conflict.csv", "ID,Name\n1,Alpha");
    const root = new MockDirectoryHandle("Tables", [["conflict.csv", file]]);
    Object.defineProperty(window, "showDirectoryPicker", {
      configurable: true,
      value: vi.fn(async () => root)
    });

    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "选择目录" }));
    fireEvent.click(await screen.findByRole("button", { name: "conflict.csv" }));
    await waitFor(() => expect(screen.getByLabelText("Selected cell value")).toHaveValue("ID"));
    fireEvent.change(screen.getByLabelText("Selected cell value"), { target: { value: "LOCAL" } });
    await waitFor(() => expect(screen.getByText("未保存 1")).toBeInTheDocument());

    file.externalWrite("ID,Name\n1,Disk");
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => expect(confirm).toHaveBeenCalledWith("conflict.csv 在磁盘上已变化。保存会覆盖磁盘版本，是否继续？"));
    expect(file.getText()).toBe("ID,Name\n1,Disk");
    expect(screen.getByText("未保存 1")).toBeInTheDocument();
    expect(screen.getByText("磁盘版本已变化。当前页签有未保存修改时不会自动覆盖。")).toBeInTheDocument();
  });

  it("saves over a newer disk version when conflict confirmation is accepted", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const file = new MockFileHandle("conflict-accept.csv", "ID,Name\n1,Alpha");
    const root = new MockDirectoryHandle("Tables", [["conflict-accept.csv", file]]);
    Object.defineProperty(window, "showDirectoryPicker", {
      configurable: true,
      value: vi.fn(async () => root)
    });

    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "选择目录" }));
    fireEvent.click(await screen.findByRole("button", { name: "conflict-accept.csv" }));
    await waitFor(() => expect(screen.getByLabelText("Selected cell value")).toHaveValue("ID"));
    fireEvent.change(screen.getByLabelText("Selected cell value"), { target: { value: "LOCAL" } });
    file.externalWrite("ID,Name\n1,Disk");

    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => expect(screen.getByText("未保存 0")).toBeInTheDocument());
    expect(file.getText()).toContain("LOCAL,Name");
    expect(screen.queryByText("磁盘版本已变化。当前页签有未保存修改时不会自动覆盖。")).not.toBeInTheDocument();
  });

  it("does not dirty the tab when clearing an empty virtual cell", async () => {
    const file = new MockFileHandle("blank-safe.csv", "ID,Name\n1,Alpha");
    const root = new MockDirectoryHandle("Tables", [["blank-safe.csv", file]]);
    Object.defineProperty(window, "showDirectoryPicker", {
      configurable: true,
      value: vi.fn(async () => root)
    });

    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "选择目录" }));
    fireEvent.click(await screen.findByRole("button", { name: "blank-safe.csv" }));
    await waitFor(() => expect(screen.getByRole("gridcell", { name: "A5" })).toBeInTheDocument());

    fireEvent.pointerDown(screen.getByRole("gridcell", { name: "A5" }), { clientX: 80, clientY: 190 });
    fireEvent.keyDown(screen.getByRole("grid", { name: "CSV grid" }), { key: "Delete" });

    expect(screen.getByText("未保存 0")).toBeInTheDocument();
    expect(screen.getByText("2 行 / 2 列 / UTF-8")).toBeInTheDocument();
  });

  it("does not delete the last real row when deleting a virtual blank row", async () => {
    const file = new MockFileHandle("delete-safe.csv", "ID,Name\n1,Alpha");
    const root = new MockDirectoryHandle("Tables", [["delete-safe.csv", file]]);
    Object.defineProperty(window, "showDirectoryPicker", {
      configurable: true,
      value: vi.fn(async () => root)
    });

    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "选择目录" }));
    fireEvent.click(await screen.findByRole("button", { name: "delete-safe.csv" }));
    await waitFor(() => expect(screen.getByRole("gridcell", { name: "A5" })).toBeInTheDocument());

    fireEvent.pointerDown(screen.getByRole("gridcell", { name: "A5" }), { clientX: 80, clientY: 190 });
    fireEvent.click(screen.getByRole("button", { name: "删行" }));

    expect(screen.getByText("未保存 0")).toBeInTheDocument();
    expect(screen.getByText("2 行 / 2 列 / UTF-8")).toBeInTheDocument();
  });

  it("adds a new column at the max width for ragged rows", async () => {
    const file = new MockFileHandle("ragged.csv", "A,B\n1");
    const root = new MockDirectoryHandle("Tables", [["ragged.csv", file]]);
    Object.defineProperty(window, "showDirectoryPicker", {
      configurable: true,
      value: vi.fn(async () => root)
    });

    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "选择目录" }));
    fireEvent.click(await screen.findByRole("button", { name: "ragged.csv" }));
    await waitFor(() => expect(screen.getByLabelText("Selected cell value")).toHaveValue("A"));

    fireEvent.click(screen.getByRole("button", { name: "增列" }));
    await waitFor(() => expect(screen.getByText("未保存 1")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => expect(screen.getByText("未保存 0")).toBeInTheDocument());
    expect(file.getText()).toBe("A,B,\n1,,");
  });

  it("prevents editing and clearing a locked selected cell", async () => {
    const file = new MockFileHandle("locked.csv", "ID,Name\n1,Alpha");
    const root = new MockDirectoryHandle("Tables", [["locked.csv", file]]);
    Object.defineProperty(window, "showDirectoryPicker", {
      configurable: true,
      value: vi.fn(async () => root)
    });

    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "选择目录" }));
    fireEvent.click(await screen.findByRole("button", { name: "locked.csv" }));
    await waitFor(() => expect(screen.getByLabelText("Selected cell value")).toHaveValue("ID"));

    fireEvent.click(screen.getByRole("button", { name: "锁定" }));

    expect(screen.getByLabelText("Selected cell value")).toBeDisabled();
    expect(screen.getByText("已锁定")).toBeInTheDocument();

    fireEvent.keyDown(screen.getByRole("grid", { name: "CSV grid" }), { key: "Delete" });

    expect(screen.getByText("未保存 0")).toBeInTheDocument();
    expect(screen.getByLabelText("Selected cell value")).toHaveValue("ID");
  });

  it("reports locked cells skipped during paste", async () => {
    const file = new MockFileHandle("paste-locked.csv", "A,B\n1,2");
    const root = new MockDirectoryHandle("Tables", [["paste-locked.csv", file]]);
    Object.defineProperty(window, "showDirectoryPicker", {
      configurable: true,
      value: vi.fn(async () => root)
    });

    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "选择目录" }));
    fireEvent.click(await screen.findByRole("button", { name: "paste-locked.csv" }));
    await waitFor(() => expect(screen.getByLabelText("Selected cell value")).toHaveValue("A"));

    fireEvent.click(screen.getByRole("button", { name: "锁定" }));
    fireEvent.paste(screen.getByRole("grid", { name: "CSV grid" }), {
      clipboardData: {
        getData: () => "X\tY"
      }
    });

    expect(screen.getByText("已粘贴，跳过锁定 1 个")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(screen.getByText("未保存 0")).toBeInTheDocument());
    expect(file.getText()).toBe("A,Y\n1,2");
  });

  it("reports locked cells skipped while clearing a selected column", async () => {
    const file = new MockFileHandle("clear-locked.csv", "A,B\n1,2");
    const root = new MockDirectoryHandle("Tables", [["clear-locked.csv", file]]);
    Object.defineProperty(window, "showDirectoryPicker", {
      configurable: true,
      value: vi.fn(async () => root)
    });

    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "选择目录" }));
    fireEvent.click(await screen.findByRole("button", { name: "clear-locked.csv" }));
    await waitFor(() => expect(screen.getByLabelText("Selected cell value")).toHaveValue("A"));

    fireEvent.click(screen.getByRole("button", { name: "锁定" }));
    fireEvent.pointerDown(screen.getByRole("columnheader", { name: "Column A" }));
    fireEvent.keyDown(screen.getByRole("grid", { name: "CSV grid" }), { key: "Delete" });

    expect(screen.getByText("已清空选区，跳过锁定 1 个")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(screen.getByText("未保存 0")).toBeInTheDocument());
    expect(file.getText()).toBe("A,B\n,2");
  });

  it("clamps the selection after refreshing to a smaller disk version", async () => {
    const file = new MockFileHandle("refresh-shrink.csv", "A,B\n1,2\n3,4");
    const root = new MockDirectoryHandle("Tables", [["refresh-shrink.csv", file]]);
    Object.defineProperty(window, "showDirectoryPicker", {
      configurable: true,
      value: vi.fn(async () => root)
    });

    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "选择目录" }));
    fireEvent.click(await screen.findByRole("button", { name: "refresh-shrink.csv" }));
    await waitFor(() => expect(screen.getByRole("gridcell", { name: "B5" })).toBeInTheDocument());

    fireEvent.pointerDown(screen.getByRole("gridcell", { name: "B5" }), { clientX: 180, clientY: 190 });
    expect(screen.getByLabelText("Selected cell value")).toHaveValue("");

    file.externalWrite("Only\nRow");
    fireEvent.click(screen.getByRole("button", { name: "刷新" }));

    await waitFor(() => expect(screen.getByText("2 行 / 1 列 / UTF-8")).toBeInTheDocument());
    expect(screen.getByText("A2")).toBeInTheDocument();
    expect(screen.getByLabelText("Selected cell value")).toHaveValue("Row");
  });

  it("keeps local dirty edits when manual refresh is cancelled", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const file = new MockFileHandle("refresh-cancel.csv", "A,B\n1,2");
    const root = new MockDirectoryHandle("Tables", [["refresh-cancel.csv", file]]);
    Object.defineProperty(window, "showDirectoryPicker", {
      configurable: true,
      value: vi.fn(async () => root)
    });

    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "选择目录" }));
    fireEvent.click(await screen.findByRole("button", { name: "refresh-cancel.csv" }));
    await waitFor(() => expect(screen.getByLabelText("Selected cell value")).toHaveValue("A"));
    fireEvent.change(screen.getByLabelText("Selected cell value"), { target: { value: "LOCAL" } });
    file.externalWrite("REMOTE,B\n1,2");

    fireEvent.click(screen.getByRole("button", { name: "刷新" }));

    await waitFor(() => expect(confirm).toHaveBeenCalledWith("refresh-cancel.csv 有未保存修改。刷新会丢弃这些修改，是否继续？"));
    expect(screen.getByLabelText("Selected cell value")).toHaveValue("LOCAL");
    expect(screen.getByText("未保存 1")).toBeInTheDocument();
  });

  it("protects an uncommitted inline edit when manual refresh is cancelled", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const file = new MockFileHandle("refresh-inline-cancel.csv", "A,B\n1,2");
    const root = new MockDirectoryHandle("Tables", [["refresh-inline-cancel.csv", file]]);
    Object.defineProperty(window, "showDirectoryPicker", {
      configurable: true,
      value: vi.fn(async () => root)
    });

    const { container } = render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "选择目录" }));
    fireEvent.click(await screen.findByRole("button", { name: "refresh-inline-cancel.csv" }));
    await waitFor(() => expect(screen.getByRole("gridcell", { name: "A1" })).toBeInTheDocument());

    fireEvent.doubleClick(screen.getByRole("gridcell", { name: "A1" }));
    const editor = await waitFor(() => {
      const input = container.querySelector(".cell-editor") as HTMLInputElement | null;
      expect(input).toBeInTheDocument();
      return input as HTMLInputElement;
    });
    fireEvent.change(editor, { target: { value: "INLINE_LOCAL" } });
    file.externalWrite("REMOTE,B\n1,2");

    fireEvent.click(screen.getByRole("button", { name: "刷新" }));

    await waitFor(() =>
      expect(confirm).toHaveBeenCalledWith("refresh-inline-cancel.csv 有未保存修改。刷新会丢弃这些修改，是否继续？")
    );
    expect(screen.getByLabelText("Selected cell value")).toHaveValue("INLINE_LOCAL");
    expect(screen.getByText("未保存 1")).toBeInTheDocument();
  });

  it("reloads a dirty tab when manual refresh is confirmed", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const file = new MockFileHandle("refresh-confirm.csv", "A,B\n1,2");
    const root = new MockDirectoryHandle("Tables", [["refresh-confirm.csv", file]]);
    Object.defineProperty(window, "showDirectoryPicker", {
      configurable: true,
      value: vi.fn(async () => root)
    });

    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "选择目录" }));
    fireEvent.click(await screen.findByRole("button", { name: "refresh-confirm.csv" }));
    await waitFor(() => expect(screen.getByLabelText("Selected cell value")).toHaveValue("A"));
    fireEvent.change(screen.getByLabelText("Selected cell value"), { target: { value: "LOCAL" } });
    file.externalWrite("REMOTE,B\n1,2");

    fireEvent.click(screen.getByRole("button", { name: "刷新" }));

    await waitFor(() => expect(screen.getByLabelText("Selected cell value")).toHaveValue("REMOTE"));
    expect(screen.getByText("未保存 0")).toBeInTheDocument();
  });

  it("finds, replaces, replaces all, and saves the edited CSV", async () => {
    const file = new MockFileHandle("replace.csv", "ID,Name\n1,Forest Wolf\n2,Forest Wolf");
    const root = new MockDirectoryHandle("Tables", [["replace.csv", file]]);
    Object.defineProperty(window, "showDirectoryPicker", {
      configurable: true,
      value: vi.fn(async () => root)
    });

    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "选择目录" }));
    fireEvent.click(await screen.findByRole("button", { name: "replace.csv" }));
    await waitFor(() => expect(screen.getByLabelText("Selected cell value")).toHaveValue("ID"));

    fireEvent.change(screen.getByLabelText("查找"), { target: { value: "wolf" } });
    fireEvent.change(screen.getByLabelText("替换为"), { target: { value: "Fox" } });
    fireEvent.click(screen.getByRole("button", { name: "下一处" }));
    await waitFor(() => expect(screen.getByLabelText("Selected cell value")).toHaveValue("Forest Wolf"));

    fireEvent.click(screen.getByRole("button", { name: "替换" }));
    await waitFor(() => expect(screen.getByLabelText("Selected cell value")).toHaveValue("Forest Fox"));

    fireEvent.click(screen.getByRole("button", { name: "全部替换" }));
    await waitFor(() => expect(screen.getByText("已替换 1 处")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => expect(screen.getByText("未保存 0")).toBeInTheDocument());
    expect(file.getText()).toBe("ID,Name\n1,Forest Fox\n2,Forest Fox");
  });

  it("replaces only the current selected-range find results", async () => {
    const file = new MockFileHandle("range-replace.csv", "Wolf,Name\n1,Forest Wolf\n2,Forest Wolf");
    const root = new MockDirectoryHandle("Tables", [["range-replace.csv", file]]);
    Object.defineProperty(window, "showDirectoryPicker", {
      configurable: true,
      value: vi.fn(async () => root)
    });

    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "选择目录" }));
    fireEvent.click(await screen.findByRole("button", { name: "range-replace.csv" }));
    await waitFor(() => expect(screen.getByRole("gridcell", { name: "B2" })).toBeInTheDocument());

    fireEvent.pointerDown(screen.getByRole("gridcell", { name: "B2" }));
    fireEvent.change(screen.getByLabelText("查找"), { target: { value: "wolf" } });
    fireEvent.change(screen.getByLabelText("替换为"), { target: { value: "Fox" } });
    fireEvent.click(screen.getByLabelText("仅在选区查找"));
    fireEvent.click(screen.getByRole("button", { name: "替换结果" }));
    await waitFor(() => expect(screen.getByText("已替换结果 1 处")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => expect(screen.getByText("未保存 0")).toBeInTheDocument());
    expect(file.getText()).toBe("Wolf,Name\n1,Forest Fox\n2,Forest Wolf");
  });

  it("keeps cell colors out of CSV saves and clears them after closing the tab", async () => {
    const file = new MockFileHandle("colors.csv", "A,B\n1,2");
    const root = new MockDirectoryHandle("Tables", [["colors.csv", file]]);
    Object.defineProperty(window, "showDirectoryPicker", {
      configurable: true,
      value: vi.fn(async () => root)
    });

    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "选择目录" }));
    fireEvent.click(await screen.findByRole("button", { name: "colors.csv" }));
    await waitFor(() => expect(screen.getByRole("gridcell", { name: "B2" })).toBeInTheDocument());

    fireEvent.pointerDown(screen.getByRole("gridcell", { name: "B2" }));
    fireEvent.change(screen.getByLabelText("背景颜色"), { target: { value: "#fff3bf" } });

    await waitFor(() => expect(screen.getByRole("gridcell", { name: "B2" })).toHaveStyle("background-color: #fff3bf"));
    expect(screen.getByText("未保存 0")).toBeInTheDocument();
    expect(file.getText()).toBe("A,B\n1,2");

    fireEvent.click(screen.getByRole("button", { name: "关闭 colors.csv" }));
    await waitFor(() => expect(screen.queryByRole("grid", { name: "CSV grid" })).not.toBeInTheDocument());
    fireEvent.click(await screen.findByRole("button", { name: "colors.csv" }));
    await waitFor(() => expect(screen.getByRole("gridcell", { name: "B2" })).toBeInTheDocument());

    expect(screen.getByRole("gridcell", { name: "B2" })).not.toHaveStyle("background-color: #fff3bf");
    expect(screen.getByText("未保存 0")).toBeInTheDocument();
    expect(file.getText()).toBe("A,B\n1,2");
  });

  it("reopens the same file when it is clicked immediately after closing the only tab", async () => {
    const file = new MockFileHandle("reopen.csv", "A,B\n1,2");
    const root = new MockDirectoryHandle("Tables", [["reopen.csv", file]]);
    Object.defineProperty(window, "showDirectoryPicker", {
      configurable: true,
      value: vi.fn(async () => root)
    });

    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "选择目录" }));
    fireEvent.click(await screen.findByRole("button", { name: "reopen.csv" }));
    await waitFor(() => expect(screen.getByRole("gridcell", { name: "B2" })).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "关闭 reopen.csv" }));
    fireEvent.click(screen.getByRole("button", { name: "reopen.csv" }));

    await waitFor(() => expect(screen.getByRole("gridcell", { name: "B2" })).toBeInTheDocument());
    expect(screen.getByText("未保存 0")).toBeInTheDocument();
  });

  it("updates freeze and zoom controls without disturbing the selected cell", async () => {
    const file = new MockFileHandle("view-controls.csv", "A,B\n1,2");
    const root = new MockDirectoryHandle("Tables", [["view-controls.csv", file]]);
    Object.defineProperty(window, "showDirectoryPicker", {
      configurable: true,
      value: vi.fn(async () => root)
    });

    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "选择目录" }));
    fireEvent.click(await screen.findByRole("button", { name: "view-controls.csv" }));
    await waitFor(() => expect(screen.getByRole("gridcell", { name: "B2" })).toBeInTheDocument());

    fireEvent.pointerDown(screen.getByRole("gridcell", { name: "B2" }), { clientX: 180, clientY: 80 });
    expect(screen.getByLabelText("Selected cell value")).toHaveValue("2");

    fireEvent.click(screen.getByRole("button", { name: "冻结" }));
    expect(screen.getByText("冻结 1 行 / 1 列")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "放大格子" }));
    expect(screen.getByText("110%")).toBeInTheDocument();
    expect(screen.getByLabelText("Selected cell value")).toHaveValue("2");

    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(screen.getByText("冻结 0 行 / 0 列")).toBeInTheDocument();
  });

  it("keeps manual freeze cancellation after refreshing the file", async () => {
    const file = new MockFileHandle("freeze-cancel.csv", "A,B,C\n1,2,3\n4,5,6");
    const root = new MockDirectoryHandle("Tables", [["freeze-cancel.csv", file]]);
    Object.defineProperty(window, "showDirectoryPicker", {
      configurable: true,
      value: vi.fn(async () => root)
    });

    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "选择目录" }));
    fireEvent.click(await screen.findByRole("button", { name: "freeze-cancel.csv" }));
    await waitFor(() => expect(screen.getByText("冻结 2 行 / 2 列")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(screen.getByText("冻结 0 行 / 0 列")).toBeInTheDocument();

    file.externalWrite("A,B,C\n7,8,9\n4,5,6");
    fireEvent.click(screen.getByRole("button", { name: "刷新" }));

    await waitFor(() => expect(screen.getByLabelText("Selected cell value")).toHaveValue("A"));
    expect(screen.getByText("冻结 0 行 / 0 列")).toBeInTheDocument();
  });
});
