import type { CsvTab, CsvTabHistorySnapshot } from "../types";

const MAX_HISTORY_ITEMS = 50;

export function snapshotTab(tab: CsvTab): CsvTabHistorySnapshot {
  return {
    data: tab.data.map((row) => [...row]),
    lockedCells: [...tab.lockedCells],
    selection: { ...tab.selection },
    colWidths: { ...tab.colWidths },
    dirty: tab.dirty
  };
}

export function pushUndo(tab: CsvTab): CsvTab {
  return {
    ...tab,
    undoStack: [...tab.undoStack.slice(-(MAX_HISTORY_ITEMS - 1)), snapshotTab(tab)],
    redoStack: []
  };
}

export function undoTab(tab: CsvTab): CsvTab {
  const snapshot = tab.undoStack[tab.undoStack.length - 1];
  if (!snapshot) {
    return tab;
  }
  return restoreSnapshot(
    {
      ...tab,
      undoStack: tab.undoStack.slice(0, -1),
      redoStack: [...tab.redoStack.slice(-(MAX_HISTORY_ITEMS - 1)), snapshotTab(tab)]
    },
    snapshot,
    "已撤销"
  );
}

export function redoTab(tab: CsvTab): CsvTab {
  const snapshot = tab.redoStack[tab.redoStack.length - 1];
  if (!snapshot) {
    return tab;
  }
  return restoreSnapshot(
    {
      ...tab,
      undoStack: [...tab.undoStack.slice(-(MAX_HISTORY_ITEMS - 1)), snapshotTab(tab)],
      redoStack: tab.redoStack.slice(0, -1)
    },
    snapshot,
    "已重做"
  );
}

export function clearHistory(tab: CsvTab): CsvTab {
  return {
    ...tab,
    undoStack: [],
    redoStack: []
  };
}

function restoreSnapshot(tab: CsvTab, snapshot: CsvTabHistorySnapshot, status: string): CsvTab {
  return {
    ...tab,
    data: snapshot.data.map((row) => [...row]),
    lockedCells: [...snapshot.lockedCells],
    selection: { ...snapshot.selection },
    colWidths: { ...snapshot.colWidths },
    dirty: snapshot.dirty,
    status
  };
}
