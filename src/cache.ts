import { mkdir, readFile, writeFile, access } from "node:fs/promises";
import { join } from "node:path";
import { hashInputs } from "./hash.js";
import type { ProjectState } from "./types.js";

export class Cache {
  constructor(readonly root: string) {}

  key(parts: Record<string, unknown>): string {
    return hashInputs(parts);
  }

  dir(key: string): string {
    return join(this.root, "cache", key);
  }

  async has(key: string, file = "output.bin"): Promise<boolean> {
    try {
      await access(join(this.dir(key), file));
      return true;
    } catch {
      return false;
    }
  }

  async read(key: string, file = "output.bin"): Promise<Buffer | null> {
    try {
      return await readFile(join(this.dir(key), file));
    } catch {
      return null;
    }
  }

  async write(key: string, data: Buffer, file = "output.bin"): Promise<string> {
    const dir = this.dir(key);
    await mkdir(dir, { recursive: true });
    const dest = join(dir, file);
    await writeFile(dest, data);
    return dest;
  }

  async writeJson(key: string, value: unknown, file = "meta.json"): Promise<void> {
    const dir = this.dir(key);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, file), JSON.stringify(value, null, 2));
  }

  takePath(assetId: string, kind: string, name: string): string {
    return join(this.root, "takes", assetId, kind, name);
  }

  async saveTake(assetId: string, kind: string, name: string, data: Buffer): Promise<string> {
    const dest = this.takePath(assetId, kind, name);
    await mkdir(join(dest, ".."), { recursive: true });
    await writeFile(dest, data);
    return dest;
  }
}

const EMPTY_STATE: ProjectState = { selected: {} };

export class StateStore {
  constructor(readonly root: string) {}

  private get file(): string {
    return join(this.root, "state.json");
  }

  async load(): Promise<ProjectState> {
    try {
      const raw = JSON.parse(await readFile(this.file, "utf8")) as ProjectState;
      return { selected: raw.selected ?? {} };
    } catch {
      return structuredClone(EMPTY_STATE);
    }
  }

  async save(state: ProjectState): Promise<void> {
    await mkdir(this.root, { recursive: true });
    await writeFile(this.file, JSON.stringify(state, null, 2));
  }
}
