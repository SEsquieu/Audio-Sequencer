import { JsonPatchOp } from "../types/song";

const clone = <T>(value: T): T => {
  if (typeof structuredClone === "function") {
    return structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value)) as T;
};

const decodePathToken = (token: string): string => token.replace(/~1/g, "/").replace(/~0/g, "~");

const toTokens = (path: string): string[] => {
  if (!path.startsWith("/")) {
    throw new Error(`Invalid patch path: ${path}`);
  }
  return path.split("/").slice(1).map(decodePathToken);
};

const getParent = (root: unknown, tokens: string[]): { parent: any; key: string } => {
  if (tokens.length === 0) {
    throw new Error("Root path operations are not supported");
  }

  let node: any = root;
  for (let i = 0; i < tokens.length - 1; i += 1) {
    const token = tokens[i];
    if (!(token in node)) {
      throw new Error(`Path segment not found: ${token}`);
    }
    node = node[token];
  }

  return { parent: node, key: tokens[tokens.length - 1] };
};

const getValueAtPath = (root: unknown, path: string): unknown => {
  const tokens = toTokens(path);
  let node: any = root;
  for (const token of tokens) {
    if (node == null || !(token in node)) {
      return undefined;
    }
    node = node[token];
  }
  return clone(node);
};

export const applyPatch = <T>(state: T, ops: JsonPatchOp[]): T => {
  const next = clone(state);

  for (const op of ops) {
    const tokens = toTokens(op.path);
    const { parent, key } = getParent(next, tokens);

    if (Array.isArray(parent)) {
      const index = key === "-" ? parent.length : Number(key);
      if (Number.isNaN(index)) {
        throw new Error(`Invalid array index: ${key}`);
      }

      if (op.op === "add") {
        parent.splice(index, 0, clone(op.value));
      } else if (op.op === "remove") {
        parent.splice(index, 1);
      } else {
        parent[index] = clone(op.value);
      }
      continue;
    }

    if (op.op === "remove") {
      delete parent[key];
      continue;
    }

    parent[key] = clone(op.value);
  }

  return next;
};

export const invertPatch = <T>(stateBefore: T, ops: JsonPatchOp[]): JsonPatchOp[] => {
  let working = clone(stateBefore);
  const inverse: JsonPatchOp[] = [];

  for (const op of ops) {
    if (op.op === "add") {
      inverse.unshift({ op: "remove", path: op.path });
    } else if (op.op === "remove") {
      const oldValue = getValueAtPath(working, op.path);
      inverse.unshift({ op: "add", path: op.path, value: oldValue });
    } else {
      const oldValue = getValueAtPath(working, op.path);
      inverse.unshift({ op: "replace", path: op.path, value: oldValue });
    }

    working = applyPatch(working, [op]);
  }

  return inverse;
};
