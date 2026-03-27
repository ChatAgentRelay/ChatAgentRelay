import { ROOT_DIR } from "./constants";

export function resolveRepoPath(relativePath: string): string {
  return new URL(relativePath, ROOT_DIR).pathname;
}
