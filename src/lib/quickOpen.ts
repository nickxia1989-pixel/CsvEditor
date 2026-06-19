import type { CsvFileRef } from "./fileRefs";
import type { CsvTab, TreeNode } from "../types";

export type QuickOpenCandidate = {
  id: string;
  name: string;
  path: string;
  fileRef: CsvFileRef;
  tabId?: string;
  open: boolean;
  active: boolean;
  dirty: boolean;
  externalChanged: boolean;
  score: number;
};

type CandidateDraft = Omit<QuickOpenCandidate, "id" | "score"> & {
  originalIndex: number;
};

export function buildQuickOpenCandidates(
  tabs: CsvTab[],
  root: TreeNode | null,
  query: string,
  recentTabIds: string[] = [],
  activeTabId: string | null = null
): QuickOpenCandidate[] {
  const normalizedQuery = normalizeSearchText(query);
  const candidatesByPath = new Map<string, CandidateDraft>();
  const recentRank = new Map(recentTabIds.map((id, index) => [id, index]));
  let originalIndex = 0;

  [...tabs].sort((left, right) => {
    const leftRank = recentRank.get(left.id) ?? Number.MAX_SAFE_INTEGER;
    const rightRank = recentRank.get(right.id) ?? Number.MAX_SAFE_INTEGER;
    return leftRank - rightRank || tabs.indexOf(left) - tabs.indexOf(right);
  }).forEach((tab) => {
    candidatesByPath.set(normalizePathKey(tab.path), {
      name: tab.name,
      path: tab.path,
      fileRef: tab.fileRef,
      tabId: tab.id,
      open: true,
      active: tab.id === activeTabId,
      dirty: tab.dirty,
      externalChanged: tab.externalChanged,
      originalIndex
    });
    originalIndex += 1;
  });

  if (root) {
    for (const node of collectTreeFileNodes(root)) {
      if (!node.fileRef) {
        continue;
      }
      const key = normalizePathKey(node.path);
      const existing = candidatesByPath.get(key);
      if (existing) {
        candidatesByPath.set(key, {
          ...existing,
          name: existing.name || node.name,
          path: existing.path || node.path,
          fileRef: existing.fileRef ?? node.fileRef
        });
      } else {
        candidatesByPath.set(key, {
          name: node.name,
          path: node.path,
          fileRef: node.fileRef,
          open: false,
          active: false,
          dirty: false,
          externalChanged: false,
          originalIndex
        });
        originalIndex += 1;
      }
    }
  }

  return [...candidatesByPath.entries()]
    .flatMap(([id, draft]) => {
      const score = normalizedQuery ? scoreCandidate(draft, normalizedQuery) : 0;
      if (score === null) {
        return [];
      }
      return [{ ...draft, id, score }];
    })
    .sort((left, right) => {
      if (normalizedQuery) {
        return right.score - left.score || Number(right.open) - Number(left.open) || comparePath(left.path, right.path);
      }
      return Number(right.open) - Number(left.open) || left.originalIndex - right.originalIndex || comparePath(left.path, right.path);
    });
}

export function collectTreeFileNodes(root: TreeNode): TreeNode[] {
  const files: TreeNode[] = [];
  visitTree(root, files);
  return files;
}

function visitTree(node: TreeNode, files: TreeNode[]): void {
  if (node.kind === "file") {
    files.push(node);
    return;
  }
  node.children?.forEach((child) => visitTree(child, files));
}

function scoreCandidate(candidate: CandidateDraft, normalizedQuery: string): number | null {
  const terms = normalizedQuery.split(/\s+/).filter(Boolean);
  let totalScore = 0;
  for (const term of terms) {
    const nameScore = scoreText(normalizeSearchText(candidate.name), term, 520);
    const pathScore = scoreText(normalizeSearchText(candidate.path), term, 0);
    const bestScore = Math.max(nameScore ?? Number.NEGATIVE_INFINITY, pathScore ?? Number.NEGATIVE_INFINITY);
    if (!Number.isFinite(bestScore)) {
      return null;
    }
    totalScore += bestScore;
  }
  return totalScore + (candidate.open ? 90 : 0) + (candidate.active ? 35 : 0) - candidate.originalIndex * 0.01;
}

function scoreText(text: string, query: string, bonus: number): number | null {
  if (!text || !query) {
    return null;
  }
  if (text === query) {
    return 10000 + bonus;
  }
  if (text.startsWith(query)) {
    return 9000 + bonus - text.length * 0.5;
  }
  const segmentIndex = findSegmentStart(text, query);
  if (segmentIndex >= 0) {
    return 7800 + bonus - segmentIndex * 2 - text.length * 0.2;
  }
  const containsIndex = text.indexOf(query);
  if (containsIndex >= 0) {
    return 6500 + bonus - containsIndex * 2 - text.length * 0.15;
  }

  const fuzzy = scoreFuzzy(text, query);
  return fuzzy === null ? null : fuzzy + bonus;
}

function scoreFuzzy(text: string, query: string): number | null {
  let textIndex = 0;
  let firstMatch = -1;
  let previousMatch = -1;
  let gapPenalty = 0;
  let contiguousBonus = 0;

  for (const char of query) {
    const found = text.indexOf(char, textIndex);
    if (found < 0) {
      return null;
    }
    if (firstMatch < 0) {
      firstMatch = found;
    }
    if (previousMatch >= 0) {
      const gap = found - previousMatch - 1;
      gapPenalty += gap;
      if (gap === 0) {
        contiguousBonus += 18;
      }
    }
    previousMatch = found;
    textIndex = found + 1;
  }

  return 4300 + contiguousBonus - firstMatch * 5 - gapPenalty * 12 - text.length * 0.1;
}

function findSegmentStart(text: string, query: string): number {
  for (let index = 1; index < text.length; index += 1) {
    if ((text[index - 1] === "/" || text[index - 1] === "-" || text[index - 1] === "_" || text[index - 1] === ".") && text.startsWith(query, index)) {
      return index;
    }
  }
  return -1;
}

function normalizeSearchText(value: string): string {
  return value.trim().replace(/\\/g, "/").replace(/\s+/g, " ").toLowerCase();
}

function normalizePathKey(path: string): string {
  return path.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}

function comparePath(left: string, right: string): number {
  return left.localeCompare(right, "zh-CN", { numeric: true, sensitivity: "base" });
}
