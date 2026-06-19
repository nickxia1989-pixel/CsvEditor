import { useEffect, useMemo, useRef, type KeyboardEvent, type MouseEvent, type UIEvent } from "react";
import { AlertTriangle, Clock3, FileText, Loader2, Search, X } from "lucide-react";
import type { GlobalSearchProgress, GlobalSearchResult, GlobalSearchSnapshot } from "../types";

type GlobalSearchOverlayProps = {
  query: string;
  snapshot: GlobalSearchSnapshot | null;
  history: GlobalSearchSnapshot[];
  selectedHistoryId: string | null;
  selectedResultId: string | null;
  resultsScrollTop: number;
  searching: boolean;
  progress: GlobalSearchProgress;
  canSearch: boolean;
  onQueryChange(query: string): void;
  onRunSearch(query: string): void;
  onSelectHistory(id: string): void;
  onDeleteHistory(id: string): void;
  onOpenResult(result: GlobalSearchResult): void;
  onResultsScroll(snapshotId: string, scrollTop: number): void;
  onClose(): void;
};

export function GlobalSearchOverlay({
  query,
  snapshot,
  history,
  selectedHistoryId,
  selectedResultId,
  resultsScrollTop,
  searching,
  progress,
  canSearch,
  onQueryChange,
  onRunSearch,
  onSelectHistory,
  onDeleteHistory,
  onOpenResult,
  onResultsScroll,
  onClose
}: GlobalSearchOverlayProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const resultsRef = useRef<HTMLDivElement | null>(null);
  const hasQuery = query.trim().length > 0;
  const statusText = useMemo(() => describeSearchStatus(snapshot, searching, progress), [progress, searching, snapshot]);

  useEffect(() => {
    const input = inputRef.current;
    input?.focus({ preventScroll: true });
    input?.select();
  }, []);

  useEffect(() => {
    const results = resultsRef.current;
    if (results) {
      results.scrollTop = resultsScrollTop;
    }
  }, [resultsScrollTop, snapshot?.id]);

  const handleResultsScroll = (event: UIEvent<HTMLDivElement>) => {
    if (!snapshot) {
      return;
    }
    onResultsScroll(snapshot.id, event.currentTarget.scrollTop);
  };

  const runSearch = () => {
    if (!hasQuery || searching || !canSearch) {
      return;
    }
    onRunSearch(query);
  };

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
      runSearch();
    }
  };

  const handleScrimMouseDown = (event: MouseEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget) {
      onClose();
    }
  };

  return (
    <div className="global-search-scrim" onMouseDown={handleScrimMouseDown}>
      <section className="global-search-panel" role="dialog" aria-label="全表搜索" aria-modal="true">
        <header className="global-search-header">
          <div>
            <h2>全表搜索</h2>
            <span>{statusText}</span>
          </div>
          <button className="icon-button" type="button" onClick={onClose} title="关闭全表搜索" aria-label="关闭全表搜索">
            <X size={17} />
          </button>
        </header>

        <div className="global-search-input-row">
          <label className="global-search-input">
            <Search size={17} />
            <input
              ref={inputRef}
              value={query}
              onChange={(event) => onQueryChange(event.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="输入内容，搜索当前目录下所有 CSV"
              aria-label="全表搜索内容"
            />
            {searching ? <Loader2 size={16} className="spin" aria-label="正在全表搜索" /> : null}
          </label>
          <button className="primary-button" type="button" disabled={!hasQuery || searching || !canSearch} onClick={runSearch}>
            搜索
          </button>
        </div>

        <div className="global-search-layout">
          <aside className="global-search-history" aria-label="全表搜索历史">
            <div className="global-search-section-title">
              <Clock3 size={15} />
              <span>最近记录</span>
            </div>
            <div className="global-search-history-list">
              {history.length > 0 ? (
                history.map((entry) => (
                  <div key={entry.id} className="global-search-history-slot">
                    <button
                      type="button"
                      className={`global-search-history-item ${entry.id === selectedHistoryId ? "active" : ""}`}
                      onClick={() => onSelectHistory(entry.id)}
                      title={`${entry.query} - ${entry.rootPath}`}
                    >
                      <span className="global-search-history-query">{entry.query}</span>
                      <span className="global-search-history-meta">
                        {entry.results.length} 项 / {entry.matchedFileCount} 表
                      </span>
                      <span className="global-search-history-time">{formatDateTime(entry.createdAt)}</span>
                    </button>
                    <button
                      type="button"
                      className="global-search-history-delete"
                      onClick={() => onDeleteHistory(entry.id)}
                      title={`删除搜索记录 ${entry.query}`}
                      aria-label={`删除搜索记录 ${entry.query}`}
                    >
                      <X size={14} />
                    </button>
                  </div>
                ))
              ) : (
                <div className="global-search-empty compact">暂无搜索记录</div>
              )}
            </div>
          </aside>

          <main className="global-search-results-pane">
            <div className="global-search-section-title">
              <FileText size={15} />
              <span>搜索结果</span>
            </div>
            <div
              ref={resultsRef}
              className="global-search-results"
              role="list"
              aria-label="全表搜索结果"
              onScroll={handleResultsScroll}
            >
              {snapshot && snapshot.results.length > 0 ? (
                snapshot.results.map((result) => (
                  <button
                    key={result.id}
                    type="button"
                    className={`global-search-result ${result.id === selectedResultId ? "active" : ""}`}
                    role="listitem"
                    onClick={() => onOpenResult(result)}
                    aria-label={`${result.preview || "(空白)"} ID ${displayPrimaryKey(result)} 字段 ${displayFieldName(result)} ${result.relativePath} ${result.cell}`}
                    title={`${result.filePath} ${result.cell}`}
                  >
                    <span className="global-search-result-content">
                      <span className="global-search-result-preview">
                        {renderHighlightedText(result.preview || "(空白)", snapshot.query)}
                      </span>
                      <span className="global-search-result-keyline">
                        <span className="global-search-result-key-meta table">
                          <span className="global-search-result-key-label">表格</span>
                          <span className="global-search-result-key-value">
                            {renderHighlightedText(result.fileName, snapshot.query)}
                          </span>
                        </span>
                        <span className="global-search-result-key-meta id">
                          <span className="global-search-result-key-label">ID</span>
                          <span className="global-search-result-key-value">
                            {renderHighlightedText(displayPrimaryKey(result), snapshot.query)}
                          </span>
                        </span>
                        <span className="global-search-result-key-meta field">
                          <span className="global-search-result-key-label">字段</span>
                          <span className="global-search-result-key-value">
                            {renderHighlightedText(displayFieldName(result), snapshot.query)}
                          </span>
                        </span>
                      </span>
                    </span>
                  </button>
                ))
              ) : (
                <div className="global-search-empty">
                  {searching
                    ? "正在搜索..."
                    : snapshot
                      ? "没有匹配内容"
                      : canSearch
                        ? "输入内容后搜索当前目录下所有 CSV。"
                        : "先选择一个包含 CSV 的目录。"}
                </div>
              )}
            </div>
            {snapshot && snapshot.errors.length > 0 ? (
              <div className="global-search-errors" role="status">
                <AlertTriangle size={15} />
                <span>{snapshot.errors.length} 个表格读取失败，结果中已跳过。</span>
              </div>
            ) : null}
          </main>
        </div>
      </section>
    </div>
  );
}

function renderHighlightedText(text: string, query: string) {
  const normalizedQuery = query.trim();
  if (!normalizedQuery) {
    return text;
  }
  const lowerText = text.toLowerCase();
  const lowerQuery = normalizedQuery.toLowerCase();
  const parts: Array<{ text: string; matched: boolean }> = [];
  let cursor = 0;
  let matchIndex = lowerText.indexOf(lowerQuery, cursor);
  while (matchIndex >= 0) {
    if (matchIndex > cursor) {
      parts.push({ text: text.slice(cursor, matchIndex), matched: false });
    }
    parts.push({ text: text.slice(matchIndex, matchIndex + normalizedQuery.length), matched: true });
    cursor = matchIndex + normalizedQuery.length;
    matchIndex = lowerText.indexOf(lowerQuery, cursor);
  }
  if (cursor < text.length) {
    parts.push({ text: text.slice(cursor), matched: false });
  }
  return parts.map((part, index) =>
    part.matched ? <mark key={index}>{part.text}</mark> : <span key={index}>{part.text}</span>
  );
}

function displayPrimaryKey(result: GlobalSearchResult): string {
  return result.primaryKey.trim() || "(空)";
}

function displayFieldName(result: GlobalSearchResult): string {
  return result.fieldName.trim() || "(无字段名)";
}

function describeSearchStatus(
  snapshot: GlobalSearchSnapshot | null,
  searching: boolean,
  progress: GlobalSearchProgress
): string {
  if (searching) {
    if (progress.phase === "loading") {
      return "正在载入目录...";
    }
    return `正在搜索 ${progress.scannedFiles}/${progress.totalFiles} 个表格`;
  }
  if (!snapshot) {
    return "搜索当前目录下所有 CSV，并保留最近 50 次结果";
  }
  return `${snapshot.results.length} 项 / ${snapshot.matchedFileCount} 个表格 / 已扫描 ${snapshot.searchedFileCount} 个`;
}

function formatDateTime(timestamp: number): string {
  if (!Number.isFinite(timestamp)) {
    return "";
  }
  return new Date(timestamp).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}
