import {
  isDesktopDirectoryHandle,
  listDesktopDirectory,
  makeDesktopFileRef,
  makeLocalFileRef,
  makeSampleFileRef,
  type DirectoryHandle
} from "./fileRefs";
import type { TreeNode } from "../types";

export function createLocalRoot(handle: DirectoryHandle): TreeNode {
  return {
    id: isDesktopDirectoryHandle(handle) ? handle.path : handle.name,
    name: handle.name,
    path: isDesktopDirectoryHandle(handle) ? handle.path : handle.name,
    kind: "directory",
    directoryHandle: handle,
    expanded: true
  };
}

export async function loadLocalChildren(node: TreeNode): Promise<TreeNode[]> {
  if (!node.directoryHandle) {
    return [];
  }
  if (isDesktopDirectoryHandle(node.directoryHandle)) {
    const entries = await listDesktopDirectory(node.directoryHandle);
    return sortTreeNodes(
      entries.flatMap((entry): TreeNode[] => {
        if (entry.kind === "directory") {
          return [
            {
              id: entry.path,
              name: entry.name,
              path: entry.path,
              kind: "directory",
              directoryHandle: {
                source: "desktop",
                kind: "directory",
                name: entry.name,
                path: entry.path
              },
              expanded: false
            }
          ];
        }
        if (entry.name.toLowerCase().endsWith(".csv")) {
          return [
            {
              id: entry.path,
              name: entry.name,
              path: entry.path,
              kind: "file",
              fileRef: makeDesktopFileRef(entry)
            }
          ];
        }
        return [];
      })
    );
  }

  const children: TreeNode[] = [];
  for await (const [name, handle] of node.directoryHandle.entries()) {
    const path = `${node.path}/${name}`;
    if (handle.kind === "directory") {
      children.push({
        id: path,
        name,
        path,
        kind: "directory",
        directoryHandle: handle,
        expanded: false
      });
    } else if (name.toLowerCase().endsWith(".csv")) {
      children.push({
        id: path,
        name,
        path,
        kind: "file",
        fileRef: makeLocalFileRef(handle, path)
      });
    }
  }
  return sortTreeNodes(children);
}

export async function loadLocalDescendants(node: TreeNode): Promise<TreeNode> {
  if (node.kind !== "directory") {
    return node;
  }

  try {
    const children = node.loaded ? node.children ?? [] : await loadLocalChildren(node);
    const loadedChildren = await Promise.all(
      children.map((child) => (child.kind === "directory" ? loadLocalDescendants(child) : Promise.resolve(child)))
    );
    return {
      ...node,
      children: loadedChildren,
      loaded: true,
      loading: false,
      error: undefined
    };
  } catch (error) {
    return {
      ...node,
      loading: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

export function hasUnloadedLocalDirectory(node: TreeNode): boolean {
  if (node.kind !== "directory") {
    return false;
  }
  if (node.directoryHandle && !node.loaded && !node.error) {
    return true;
  }
  return Boolean(node.children?.some(hasUnloadedLocalDirectory));
}

export function mergeLoadedNodeState(current: TreeNode, loaded: TreeNode): TreeNode {
  if (current.id !== loaded.id || current.kind !== loaded.kind) {
    return current;
  }
  const currentChildren = new Map(current.children?.map((child) => [child.id, child]) ?? []);
  const children = loaded.children?.map((child) => {
    const existing = currentChildren.get(child.id);
    return existing ? mergeLoadedNodeState(existing, child) : child;
  });
  return {
    ...loaded,
    expanded: current.expanded ?? loaded.expanded,
    children
  };
}

export async function reloadLoadedLocalTree(node: TreeNode): Promise<TreeNode> {
  if (node.kind !== "directory") {
    return node;
  }

  try {
    const currentChildren = new Map(node.children?.map((child) => [child.id, child]) ?? []);
    const children = node.directoryHandle ? await loadLocalChildren(node) : node.children ?? [];
    const reloadedChildren = await Promise.all(
      children.map((child) => {
        const existing = currentChildren.get(child.id);
        if (child.kind !== "directory" || !existing) {
          return Promise.resolve(child);
        }
        const nextChild = {
          ...child,
          expanded: existing.expanded ?? child.expanded,
          loaded: existing.loaded,
          children: existing.children
        };
        return existing.loaded ? reloadLoadedLocalTree(nextChild) : Promise.resolve(nextChild);
      })
    );
    return {
      ...node,
      children: reloadedChildren,
      loaded: true,
      loading: false,
      error: undefined
    };
  } catch (error) {
    return {
      ...node,
      loading: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

export type SampleManifest = {
  name: string;
  files: Array<{ path: string; url: string }>;
};

export async function loadSampleTree(): Promise<TreeNode> {
  const response = await fetch(resolveAppAssetUrl("/sample/manifest.json"), { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`样例目录读取失败: ${response.status}`);
  }
  const manifest = (await response.json()) as SampleManifest;
  const root: TreeNode = {
    id: manifest.name,
    name: manifest.name,
    path: manifest.name,
    kind: "directory",
    children: [],
    loaded: true,
    expanded: true
  };

  for (const file of manifest.files) {
    insertSampleFile(root, file.path.split("/"), resolveAppAssetUrl(file.url));
  }
  return root;
}

function insertSampleFile(root: TreeNode, parts: string[], url: string): void {
  let cursor = root;
  let path = root.path;
  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index];
    path = `${path}/${part}`;
    const isFile = index === parts.length - 1;
    cursor.children ??= [];
    let next = cursor.children.find((child) => child.name === part);
    if (!next) {
      next = isFile
        ? {
            id: path,
            name: part,
            path,
            kind: "file",
            fileRef: makeSampleFileRef(part, path, url)
          }
        : {
            id: path,
            name: part,
            path,
            kind: "directory",
            children: [],
            loaded: true,
            expanded: true
          };
      cursor.children.push(next);
      cursor.children = sortTreeNodes(cursor.children);
    }
    cursor = next;
  }
}

function resolveAppAssetUrl(url: string): string {
  if (/^[a-z]+:/i.test(url)) {
    return url;
  }
  if (typeof window !== "undefined" && window.location.protocol === "file:") {
    return new URL(url.replace(/^\/+/, ""), window.location.href).toString();
  }
  return url;
}

export function updateNode(root: TreeNode, id: string, updater: (node: TreeNode) => TreeNode): TreeNode {
  if (root.id === id) {
    return updater(root);
  }
  if (!root.children) {
    return root;
  }
  return {
    ...root,
    children: root.children.map((child) => updateNode(child, id, updater))
  };
}

export function sortTreeNodes(nodes: TreeNode[]): TreeNode[] {
  return [...nodes].sort((left, right) => {
    if (left.kind !== right.kind) {
      return left.kind === "directory" ? -1 : 1;
    }
    return left.name.localeCompare(right.name, "zh-CN", { numeric: true });
  });
}
