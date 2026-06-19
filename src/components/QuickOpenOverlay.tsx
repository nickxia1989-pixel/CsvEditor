import { useEffect, useRef, type KeyboardEvent, type MouseEvent, type WheelEvent } from "react";
import { AlertTriangle, FileText, Loader2, Search } from "lucide-react";
import type { QuickOpenCandidate } from "../lib/quickOpen";

type QuickOpenOverlayProps = {
  query: string;
  candidates: QuickOpenCandidate[];
  selectedId: string | null;
  loading: boolean;
  onQueryChange(query: string): void;
  onHighlight(id: string): void;
  onMoveSelection(delta: number): void;
  onSelectEdge(edge: "first" | "last"): void;
  onOpen(id?: string): void;
  onClose(): void;
};

export function QuickOpenOverlay({
  query,
  candidates,
  selectedId,
  loading,
  onQueryChange,
  onHighlight,
  onMoveSelection,
  onSelectEdge,
  onOpen,
  onClose
}: QuickOpenOverlayProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const selectedOptionRef = useRef<HTMLButtonElement | null>(null);
  const lastMousePositionRef = useRef<string | null>(null);
  const selectedIndex = candidates.findIndex((candidate) => candidate.id === selectedId);
  const selectedOptionDomId = selectedIndex >= 0 ? `quick-open-option-${selectedIndex}` : undefined;

  useEffect(() => {
    const input = inputRef.current;
    input?.focus({ preventScroll: true });
    input?.select();
  }, []);

  useEffect(() => {
    const selectedOption = selectedOptionRef.current;
    if (typeof selectedOption?.scrollIntoView !== "function") {
      return;
    }
    selectedOption.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [selectedId, candidates]);

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      event.stopPropagation();
      onOpen();
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      event.stopPropagation();
      onMoveSelection(1);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      event.stopPropagation();
      onMoveSelection(-1);
      return;
    }
    if (event.key === "PageDown") {
      event.preventDefault();
      event.stopPropagation();
      onMoveSelection(8);
      return;
    }
    if (event.key === "PageUp") {
      event.preventDefault();
      event.stopPropagation();
      onMoveSelection(-8);
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key === "Home") {
      event.preventDefault();
      event.stopPropagation();
      onSelectEdge("first");
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key === "End") {
      event.preventDefault();
      event.stopPropagation();
      onSelectEdge("last");
    }
  };

  const handlePanelWheel = (event: WheelEvent<HTMLDivElement>) => {
    const list = listRef.current;
    if (!list) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    list.scrollTop += getWheelDelta(event.deltaY, event.deltaMode, list.clientHeight);
    list.scrollLeft += getWheelDelta(event.deltaX, event.deltaMode, list.clientWidth);
  };

  const handleScrimMouseDown = (event: MouseEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget) {
      onClose();
    }
  };

  const handleOptionMouseMove = (id: string, event: MouseEvent<HTMLButtonElement>) => {
    const position = `${event.clientX}:${event.clientY}`;
    if (lastMousePositionRef.current === position) {
      return;
    }
    lastMousePositionRef.current = position;
    onHighlight(id);
  };

  return (
    <div className="quick-open-scrim" onMouseDown={handleScrimMouseDown}>
      <div className="quick-open-panel" role="dialog" aria-label="快速打开文件" onWheel={handlePanelWheel}>
        <label className="quick-open-input">
          <Search size={16} />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            onKeyDown={handleKeyDown}
            role="combobox"
            aria-label="快速打开文件"
            aria-expanded="true"
            aria-controls="quick-open-results"
            aria-activedescendant={selectedOptionDomId}
            aria-autocomplete="list"
            placeholder="输入文件名以打开"
          />
          {loading ? <Loader2 size={15} className="spin" aria-label="正在加载文件" /> : null}
        </label>

        <div
          ref={listRef}
          id="quick-open-results"
          className="quick-open-results"
          role="listbox"
          aria-label="快速打开文件结果"
        >
          {candidates.map((candidate, index) => {
            const selected = candidate.id === selectedId;
            return (
              <button
                key={candidate.id}
                id={`quick-open-option-${index}`}
                type="button"
                className={`quick-open-option ${selected ? "selected" : ""}`}
                role="option"
                aria-selected={selected}
                aria-label={`${candidate.name}${candidate.open ? " 已打开" : ""}${candidate.dirty ? " 未保存" : ""}${candidate.externalChanged ? " 磁盘变更" : ""} ${candidate.path}`}
                ref={selected ? selectedOptionRef : null}
                onMouseMove={(event) => handleOptionMouseMove(candidate.id, event)}
                onFocus={() => onHighlight(candidate.id)}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => onOpen(candidate.id)}
              >
                <FileText size={16} />
                <span className="quick-open-copy">
                  <span className="quick-open-name">
                    <span className="quick-open-title-text">{candidate.name}</span>
                    {candidate.active ? <span className="quick-open-badge">当前</span> : null}
                    {candidate.open && !candidate.active ? <span className="quick-open-badge">已打开</span> : null}
                  </span>
                  <span className="quick-open-path">{candidate.path}</span>
                </span>
                {candidate.externalChanged ? <AlertTriangle size={15} className="quick-open-alert" /> : null}
                {candidate.dirty ? <span className="quick-open-dirty" aria-label="未保存" /> : null}
              </button>
            );
          })}
          {candidates.length === 0 ? (
            <div className="quick-open-empty" role="status">
              {loading ? "正在加载文件..." : query.trim() ? "没有匹配文件" : "没有可打开的 CSV 文件"}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function getWheelDelta(delta: number, deltaMode: number, pageSize: number): number {
  if (deltaMode === 1) {
    return delta * 16;
  }
  if (deltaMode === 2) {
    return delta * pageSize;
  }
  return delta;
}
