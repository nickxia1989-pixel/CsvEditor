import { AlertTriangle, FileText, X } from "lucide-react";
import type { WheelEvent as ReactWheelEvent } from "react";
import type { CsvTab } from "../types";

type TabStripProps = {
  tabs: CsvTab[];
  activeTabId: string | null;
  onActivate(id: string): void;
  onClose(id: string): void;
};

export function TabStrip({ tabs, activeTabId, onActivate, onClose }: TabStripProps) {
  if (tabs.length === 0) {
    return <div className="tab-strip empty-tabs">未打开 CSV</div>;
  }

  const handleWheel = (event: ReactWheelEvent<HTMLDivElement>) => {
    const element = event.currentTarget;
    if (element.scrollWidth <= element.clientWidth) {
      return;
    }

    const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
    if (delta === 0) {
      return;
    }

    event.preventDefault();
    element.scrollLeft += delta;
  };

  return (
    <div className="tab-strip" role="tablist" aria-label="Open CSV tabs" onWheel={handleWheel}>
      {tabs.map((tab) => (
        <div
          key={tab.id}
          className={`tab ${tab.id === activeTabId ? "active" : ""} ${tab.dirty ? "dirty" : ""}`}
          onClick={() => onActivate(tab.id)}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              onActivate(tab.id);
            }
          }}
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
