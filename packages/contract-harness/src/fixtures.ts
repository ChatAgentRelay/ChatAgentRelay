import { readdir, readFile } from "node:fs/promises";
import { FIXTURE_DIR_PATH } from "./constants";
import { resolveRepoPath } from "./paths";
import type { CanonicalEvent } from "./types";

export type LoadedFixture = {
  fileName: string;
  event: CanonicalEvent;
};

export async function loadFirstExecutablePathFixtures(): Promise<LoadedFixture[]> {
  const fixtureDirectory = resolveRepoPath(FIXTURE_DIR_PATH);
  const fileNames = (await readdir(fixtureDirectory)).filter((fileName) => fileName.endsWith(".json")).sort();

  return Promise.all(
    fileNames.map(async (fileName) => {
      const filePath = `${fixtureDirectory}/${fileName}`;
      const contents = await readFile(filePath, "utf8");
      const event = JSON.parse(contents) as CanonicalEvent;

      return {
        fileName,
        event,
      };
    }),
  );
}
