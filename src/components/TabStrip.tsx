import { AlertTriangle, FileText, X } from "lucide-react";
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

  return (
    <div className="tab-strip" role="tablist" aria-label="Open CSV tabs">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          className={`tab ${tab.id === activeTabId ? "active" : ""} ${tab.dirty ? "dirty" : ""}`}
          onClick={() => onActivate(tab.id)}
          title={tab.path}
          role="tab"
          aria-selected={tab.id === activeTabId}
        >
          <FileText size={14} />
          <span className="tab-name">{tab.name}</span>
          {tab.externalChanged ? <AlertTriangle size={14} className="tab-alert" /> : null}
          {tab.dirty ? <span className="dirty-dot" aria-label="未保存" /> : null}
          <span
            className="tab-close"
            role="button"
            tabIndex={0}
            onClick={(event) => {
              event.stopPropagation();
              onClose(tab.id);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.stopPropagation();
                onClose(tab.id);
              }
            }}
            aria-label={`关闭 ${tab.name}`}
          >
            <X size={13} />
          </span>
        </button>
      ))}
    </div>
  );
}
