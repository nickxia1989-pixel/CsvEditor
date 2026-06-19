export type TabSwitchDirection = "next" | "previous";
export type TabSwitcherModifierKey = "control" | "meta";

export type TabSwitcherSession = {
  originTabId: string;
  selectedTabId: string;
  order: string[];
  modifierKey: TabSwitcherModifierKey;
};

type TabLike = {
  id: string;
};

export function updateRecentTabIds(current: string[], tabs: TabLike[], activeTabId: string | null): string[] {
  const openIds = new Set(tabs.map((tab) => tab.id));
  const next = current.filter((id) => id !== activeTabId && openIds.has(id));
  if (activeTabId && openIds.has(activeTabId)) {
    next.unshift(activeTabId);
  }
  return next;
}

export function buildTabSwitcherOrder(tabs: TabLike[], activeTabId: string | null, recentTabIds: string[]): string[] {
  const openIds = new Set(tabs.map((tab) => tab.id));
  const order: string[] = [];
  const add = (id: string | null) => {
    if (id && openIds.has(id) && !order.includes(id)) {
      order.push(id);
    }
  };

  add(activeTabId);
  recentTabIds.forEach(add);
  tabs.forEach((tab) => add(tab.id));
  return order;
}

export function startTabSwitcherSession(
  tabs: TabLike[],
  activeTabId: string | null,
  recentTabIds: string[],
  direction: TabSwitchDirection,
  modifierKey: TabSwitcherModifierKey
): TabSwitcherSession | null {
  if (!activeTabId) {
    return null;
  }
  const order = buildTabSwitcherOrder(tabs, activeTabId, recentTabIds);
  if (order.length < 2 || !order.includes(activeTabId)) {
    return null;
  }

  const selectedTabId = direction === "next" ? order[1] : order[order.length - 1];
  return {
    originTabId: activeTabId,
    selectedTabId,
    order,
    modifierKey
  };
}

export function advanceTabSwitcherSession(
  session: TabSwitcherSession,
  direction: TabSwitchDirection
): TabSwitcherSession {
  if (session.order.length === 0) {
    return session;
  }
  const currentIndex = Math.max(0, session.order.indexOf(session.selectedTabId));
  const delta = direction === "next" ? 1 : -1;
  const nextIndex = (currentIndex + delta + session.order.length) % session.order.length;
  return {
    ...session,
    selectedTabId: session.order[nextIndex]
  };
}

