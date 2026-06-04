import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import type { BrowserDirectoryHandle, BrowserFileHandle } from "./lib/fileRefs";

class MockFileHandle implements BrowserFileHandle {
  kind = "file" as const;
  name: string;
  private text: string;
  private modified = 1;

  constructor(name: string, text: string) {
    this.name = name;
    this.text = text;
  }

  async getFile(): Promise<File> {
    const encoded = new TextEncoder().encode(this.text);
    return {
      name: this.name,
      lastModified: this.modified,
      size: encoded.byteLength,
      arrayBuffer: async () => encoded.buffer
    } as File;
  }

  async queryPermission(): Promise<PermissionState> {
    return "granted";
  }

  async createWritable() {
    return {
      write: async (text: string) => {
        this.text = text;
        this.modified += 1;
      },
      close: async () => undefined
    };
  }

  getText(): string {
    return this.text;
  }

  externalWrite(text: string): void {
    this.text = text;
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
  Reflect.deleteProperty(window, "showDirectoryPicker");
});

describe("App local directory flow", () => {
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

    fireEvent.click(screen.getByRole("button", { name: "锁定选区" }));

    expect(screen.getByLabelText("Selected cell value")).toBeDisabled();
    expect(screen.getByText("已锁定")).toBeInTheDocument();

    fireEvent.keyDown(screen.getByRole("grid", { name: "CSV grid" }), { key: "Delete" });

    expect(screen.getByText("未保存 0")).toBeInTheDocument();
    expect(screen.getByLabelText("Selected cell value")).toHaveValue("ID");
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
});
