import { describe, expect, it } from "vitest";
import {
  advanceTabSwitcherSession,
  buildTabSwitcherOrder,
  startTabSwitcherSession,
  updateRecentTabIds
} from "./tabSwitcher";

const tabs = [{ id: "first" }, { id: "second" }, { id: "third" }, { id: "fourth" }];

describe("tabSwitcher", () => {
  it("tracks recently used tabs with the active tab first and prunes closed tabs", () => {
    expect(updateRecentTabIds(["third", "closed", "first"], tabs, "second")).toEqual(["second", "third", "first"]);
    expect(updateRecentTabIds(["second", "third", "first"], tabs.slice(0, 2), "first")).toEqual(["first", "second"]);
  });

  it("builds a VS Code style MRU order before falling back to tab strip order", () => {
    expect(buildTabSwitcherOrder(tabs, "third", ["second", "first"])).toEqual([
      "third",
      "second",
      "first",
      "fourth"
    ]);
  });

  it("starts on the next or previous candidate relative to the active tab", () => {
    expect(startTabSwitcherSession(tabs, "third", ["third", "second", "first"], "next", "control")).toMatchObject({
      originTabId: "third",
      selectedTabId: "second",
      order: ["third", "second", "first", "fourth"]
    });
    expect(startTabSwitcherSession(tabs, "third", ["third", "second", "first"], "previous", "control")).toMatchObject({
      originTabId: "third",
      selectedTabId: "fourth"
    });
  });

  it("advances and wraps inside an existing switcher session", () => {
    const session = startTabSwitcherSession(tabs, "third", ["third", "second", "first"], "next", "control");
    expect(session).not.toBeNull();

    const advanced = advanceTabSwitcherSession(session!, "next");
    expect(advanced.selectedTabId).toBe("first");
    expect(advanceTabSwitcherSession(advanced, "previous").selectedTabId).toBe("second");
  });
});

