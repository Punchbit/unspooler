import type { Exporter } from "../types.js";
import { cssExporter } from "./css.js";
import { genericExporter } from "./generic.js";
import { godotExporter } from "./godot.js";
import { phaserExporter } from "./phaser.js";

const registry = new Map<string, Exporter>([
  [genericExporter.id, genericExporter],
  [phaserExporter.id, phaserExporter],
  [godotExporter.id, godotExporter],
  [cssExporter.id, cssExporter],
]);

export function registerExporter(exporter: Exporter): void {
  registry.set(exporter.id, exporter);
}

export function getExporter(id: string): Exporter {
  const found = registry.get(id);
  if (!found) {
    throw new Error(`Unknown exporter "${id}". Built-ins: ${[...registry.keys()].join(", ")}`);
  }
  return found;
}

export function listExporters(): Exporter[] {
  return [...registry.values()];
}

export { cssExporter, genericExporter, godotExporter, phaserExporter };
