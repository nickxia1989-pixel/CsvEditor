import { useEffect, useRef, type WheelEvent as ReactWheelEvent } from "react";
import { AlertTriangle, FileText } from "lucide-react";
import type { CsvTab } from "../types";

type TabSwitcherOverlayProps = {
  tabs: CsvTab[];
  selectedTabId: string;
  originTabId: string;
  onHighlight(id: string): void;
  onSelect(id: string): void;
};

export function TabSwitcherOverlay({
  tabs,
  selectedTabId,
  originTabId,
  onHighlight,
  onSelect
}: TabSwitcherOverlayProps) {
  const selectedOptionRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    const selectedOption = selectedOptionRef.current;
    if (typeof selectedOption?.scrollIntoView !== "function") {
      return;
    }
    selectedOption.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [selectedTabId, tabs]);

  if (tabs.length === 0) {
    return null;
  }

  const handlePanelWheel = (event: ReactWheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.scrollTop += getWheelDelta(event.deltaY, event.deltaMode, event.currentTarget.clientHeight);
    event.currentTarget.scrollLeft += getWheelDelta(event.deltaX, event.deltaMode, event.currentTarget.clientWidth);
  };

  return (
    <div className="tab-switcher-scrim">
      <div
        className="tab-switcher-panel"
        role="listbox"
        aria-label="打开的表格"
        aria-activedescendant={`tab-switcher-option-${selectedTabId}`}
        onWheel={handlePanelWheel}
      >
        {tabs.map((tab) => {
          const selected = tab.id === selectedTabId;
          return (
            <button
              key={tab.id}
              id={`tab-switcher-option-${tab.id}`}
              type="button"
              className={`tab-switcher-option ${selected ? "selected" : ""}`}
              role="option"
              aria-selected={selected}
              aria-label={`${tab.name}${tab.dirty ? " 未保存" : ""}${tab.externalChanged ? " 磁盘冲突" : ""} ${tab.path}`}
              ref={selected ? selectedOptionRef : null}
              onMouseEnter={() => onHighlight(tab.id)}
              onFocus={() => onHighlight(tab.id)}
              onClick={() => onSelect(tab.id)}
            >
              <FileText size={16} />
              <span className="tab-switcher-copy">
                <span className="tab-switcher-name">
                  <span className="tab-switcher-title-text">{tab.name}</span>
                  {tab.id === originTabId ? <span className="tab-switcher-current">当前</span> : null}
                </span>
                <span className="tab-switcher-path">{tab.path}</span>
              </span>
              {tab.externalChanged ? <AlertTriangle size={15} className="tab-switcher-alert" /> : null}
              {tab.dirty ? <span className="tab-switcher-dirty" aria-label="未保存" /> : null}
            </button>
          );
        })}
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
