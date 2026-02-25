import { JsonPatchOp } from "../../types/song";

export const collectAffectedPaths = (ops: JsonPatchOp[]): string[] => {
  const seen = new Set<string>();
  const paths: string[] = [];
  for (const op of ops) {
    if (!seen.has(op.path)) {
      seen.add(op.path);
      paths.push(op.path);
    }
  }
  return paths;
};

export const summarizePatchOps = (ops: JsonPatchOp[]): string => {
  if (ops.length === 0) {
    return "No changes";
  }
  if (ops.length === 1) {
    return `${ops[0].op} ${ops[0].path}`;
  }
  return `${ops.length} edits across ${collectAffectedPaths(ops).length} paths`;
};

