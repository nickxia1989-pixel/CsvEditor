import {
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent
} from "react";
import { AlertTriangle, FileText, X } from "lucide-react";
import type { CsvTab } from "../types";

export type TabDropPlacement = "before" | "after";
const TAB_DRAG_THRESHOLD_PX = 6;

type TabStripProps = {
  tabs: CsvTab[];
  activeTabId: string | null;
  onActivate(id: string): void;
  onClose(id: string): void;
  onContextMenu?(tab: CsvTab, point: { x: number; y: number }): void;
  onReorder?(draggedId: string, targetId: string, placement: TabDropPlacement): void;
};

type DragMarker = {
  draggedId: string;
  targetId: string;
  placement: TabDropPlacement;
  indicator: {
    left: number;
    top: number;
    height: number;
  };
};

type DragSession = {
  pointerId: number;
  draggedId: string;
  startX: number;
  startY: number;
  dragging: boolean;
};

export function TabStrip({ tabs, activeTabId, onActivate, onClose, onContextMenu, onReorder }: TabStripProps) {
  const tabStripRef = useRef<HTMLDivElement | null>(null);
  const dragSessionRef = useRef<DragSession | null>(null);
  const suppressClickRef = useRef(false);
  const [draggingTabId, setDraggingTabId] = useState<string | null>(null);
  const [dragMarker, setDragMarker] = useState<DragMarker | null>(null);

  if (tabs.length === 0) {
    return <div className="tab-strip empty-tabs">未打开 CSV</div>;
  }

  const beginPointerDrag = (event: ReactPointerEvent<HTMLDivElement>, tabId: string) => {
    if (!onReorder || event.button !== 0 || (event.target as HTMLElement | null)?.closest(".tab-close")) {
      return;
    }
    dragSessionRef.current = {
      pointerId: event.pointerId,
      draggedId: tabId,
      startX: event.clientX,
      startY: event.clientY,
      dragging: false
    };
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };

  const movePointerDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const session = dragSessionRef.current;
    if (!session || session.pointerId !== event.pointerId) {
      return;
    }
    event.preventDefault();
    const movedDistance = Math.hypot(event.clientX - session.startX, event.clientY - session.startY);
    if (!session.dragging && movedDistance < TAB_DRAG_THRESHOLD_PX) {
      return;
    }
    session.dragging = true;
    suppressClickRef.current = true;
    setDraggingTabId(session.draggedId);
    const marker = getDropMarker(event.clientX, event.clientY, session.draggedId, tabStripRef.current);
    if (!marker) {
      setDragMarker(null);
      return;
    }
    setDragMarker(marker);
  };

  const endPointerDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const session = dragSessionRef.current;
    if (!session || session.pointerId !== event.pointerId) {
      return;
    }
    const marker = dragMarker;
    if (session.dragging && marker && marker.draggedId !== marker.targetId) {
      onReorder?.(marker.draggedId, marker.targetId, marker.placement);
    }
    dragSessionRef.current = null;
    setDraggingTabId(null);
    setDragMarker(null);
    try {
      event.currentTarget.releasePointerCapture?.(event.pointerId);
    } catch {
      // Pointer capture can already be released by the browser when the pointer leaves the window.
    }
    window.setTimeout(() => {
      suppressClickRef.current = false;
    }, 0);
  };

  return (
    <div className="tab-strip" ref={tabStripRef} role="tablist" aria-label="Open CSV tabs">
      {dragMarker ? (
        <span
          className="tab-drop-indicator"
          aria-hidden="true"
          style={{
            left: dragMarker.indicator.left,
            top: dragMarker.indicator.top,
            height: dragMarker.indicator.height
          }}
        />
      ) : null}
      {tabs.map((tab) => (
        <div
          key={tab.id}
          data-tab-id={tab.id}
          className={[
            "tab",
            tab.id === activeTabId ? "active" : "",
            tab.dirty ? "dirty" : "",
            draggingTabId === tab.id ? "dragging" : "",
            dragMarker?.targetId === tab.id && dragMarker.placement === "before" ? "drop-before" : "",
            dragMarker?.targetId === tab.id && dragMarker.placement === "after" ? "drop-after" : ""
          ]
            .filter(Boolean)
            .join(" ")}
          onClick={(event) => {
            if (suppressClickRef.current) {
              event.preventDefault();
              event.stopPropagation();
              return;
            }
            onActivate(tab.id);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              onActivate(tab.id);
            }
          }}
          onContextMenu={(event: ReactMouseEvent<HTMLDivElement>) => {
            if (!onContextMenu) {
              return;
            }
            event.preventDefault();
            onContextMenu(tab, { x: event.clientX, y: event.clientY });
          }}
          onPointerDown={(event) => beginPointerDrag(event, tab.id)}
          onPointerMove={movePointerDrag}
          onPointerUp={endPointerDrag}
          onPointerCancel={endPointerDrag}
          title={tab.path}
          role="tab"
          tabIndex={0}
          aria-selected={tab.id === activeTabId}
          aria-label={`${tab.name}${tab.dirty ? "未保存" : ""}${tab.externalChanged ? "磁盘冲突" : ""}`}
        >
          <FileText size={14} />
          <span className="tab-name">{tab.name}</span>
          {tab.externalChanged ? <AlertTriangle size={14} className="tab-alert" /> : null}
          {tab.dirty ? <span className="dirty-dot" aria-label="未保存" /> : null}
          <button
            type="button"
            className="tab-close"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              onClose(tab.id);
            }}
            aria-label={`关闭 ${tab.name}`}
          >
            <X size={13} />
          </button>
        </div>
      ))}
    </div>
  );
}

type TabRectEntry = {
  element: HTMLElement;
  id: string;
  rect: DOMRect;
};

function getDropMarker(clientX: number, clientY: number, draggedId: string, container: HTMLElement | null): DragMarker | null {
  if (!container) {
    return null;
  }
  const entries = Array.from(container.querySelectorAll<HTMLElement>(".tab"))
    .map((element) => ({
      element,
      id: element.dataset.tabId ?? "",
      rect: element.getBoundingClientRect()
    }))
    .filter((entry) => entry.id && entry.id !== draggedId && entry.rect.width > 0 && entry.rect.height > 0);

  if (entries.length === 0) {
    return null;
  }

  const row = findClosestTabRow(entries, clientY);
  const slotIndex = findInsertionSlot(row, clientX);
  const beforeEntry = slotIndex > 0 ? row[slotIndex - 1] : null;
  const afterEntry = slotIndex < row.length ? row[slotIndex] : null;
  const target = afterEntry ?? beforeEntry;
  if (!target) {
    return null;
  }
  const placement: TabDropPlacement = afterEntry ? "before" : "after";
  return {
    draggedId,
    targetId: target.id,
    placement,
    indicator: getDropIndicator(beforeEntry, afterEntry, container)
  };
}

function findClosestTabRow(entries: TabRectEntry[], clientY: number): TabRectEntry[] {
  const rows: TabRectEntry[][] = [];
  for (const entry of [...entries].sort((left, right) => left.rect.top - right.rect.top || left.rect.left - right.rect.left)) {
    const row = rows.find((candidate) => Math.abs(candidate[0].rect.top - entry.rect.top) < Math.min(candidate[0].rect.height, entry.rect.height) / 2);
    if (row) {
      row.push(entry);
    } else {
      rows.push([entry]);
    }
  }

  const closestRow = rows.reduce((best, row) => {
    const rowTop = Math.min(...row.map((entry) => entry.rect.top));
    const rowBottom = Math.max(...row.map((entry) => entry.rect.bottom));
    const rowCenter = (rowTop + rowBottom) / 2;
    const bestTop = Math.min(...best.map((entry) => entry.rect.top));
    const bestBottom = Math.max(...best.map((entry) => entry.rect.bottom));
    const bestCenter = (bestTop + bestBottom) / 2;
    return Math.abs(clientY - rowCenter) < Math.abs(clientY - bestCenter) ? row : best;
  }, rows[0]);

  return [...closestRow].sort((left, right) => left.rect.left - right.rect.left);
}

function findInsertionSlot(row: TabRectEntry[], clientX: number): number {
  for (let index = 0; index < row.length; index += 1) {
    const center = row[index].rect.left + row[index].rect.width / 2;
    if (clientX < center) {
      return index;
    }
  }
  return row.length;
}

function getDropIndicator(
  beforeEntry: TabRectEntry | null,
  afterEntry: TabRectEntry | null,
  container: HTMLElement
): DragMarker["indicator"] {
  const containerRect = container?.getBoundingClientRect();
  const anchorRect = afterEntry?.rect ?? beforeEntry?.rect;
  const left =
    beforeEntry && afterEntry
      ? (beforeEntry.rect.right + afterEntry.rect.left) / 2
      : afterEntry
        ? afterEntry.rect.left - 4
        : (beforeEntry?.rect.right ?? 0) + 4;
  const top = (anchorRect?.top ?? containerRect.top) - containerRect.top - 3;
  return {
    left: Math.round(left - containerRect.left),
    top: Math.round(top),
    height: Math.max(26, Math.round((anchorRect?.height ?? 30) + 6))
  };
}
