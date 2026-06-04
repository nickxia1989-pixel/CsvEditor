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
});
