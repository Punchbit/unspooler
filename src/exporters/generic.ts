import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { manifestToJson } from "../manifest.js";
import type { ExportInput, ExportedFile, Exporter } from "../types.js";

export const genericExporter: Exporter = {
  id: "generic",
  async export(input: ExportInput): Promise<ExportedFile[]> {
    await mkdir(input.outDir, { recursive: true });
    const sheetPath = join(input.outDir, input.sheetFileName);
    const manifestPath = join(input.outDir, input.sheetFileName.replace(/\.png$/i, ".json"));
    await writeFile(sheetPath, input.sheet);
    const json = manifestToJson(input.manifest);
    await writeFile(manifestPath, json);
    return [
      { path: sheetPath, contents: input.sheet },
      { path: manifestPath, contents: json },
    ];
  },
};
