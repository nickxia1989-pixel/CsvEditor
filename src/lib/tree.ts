import { makeLocalFileRef, makeSampleFileRef, type BrowserDirectoryHandle } from "./fileRefs";
import type { TreeNode } from "../types";

export function createLocalRoot(handle: BrowserDirectoryHandle): TreeNode {
  return {
    id: handle.name,
    name: handle.name,
    path: handle.name,
    kind: "directory",
    directoryHandle: handle,
    expanded: true
  };
}

export async function loadLocalChildren(node: TreeNode): Promise<TreeNode[]> {
  if (!node.directoryHandle) {
    return [];
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

export type SampleManifest = {
  name: string;
  files: Array<{ path: string; url: string }>;
};

export async function loadSampleTree(): Promise<TreeNode> {
  const response = await fetch("/sample/manifest.json", { cache: "no-store" });
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
    insertSampleFile(root, file.path.split("/"), file.url);
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
