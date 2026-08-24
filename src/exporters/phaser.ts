import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ExportInput, ExportedFile, Exporter } from "../types.js";

export const phaserExporter: Exporter = {
  id: "phaser",
  async export(input: ExportInput): Promise<ExportedFile[]> {
    await mkdir(input.outDir, { recursive: true });
    const atlas = {
      textures: [
        {
          image: input.sheetFileName,
          format: "RGBA8888",
          size: input.manifest.meta.size,
          scale: 1,
          frames: Object.fromEntries(
            input.manifest.frames.map((f) => [
              f.filename.replace(/\.png$/, ""),
              {
                frame: f.frame,
                rotated: false,
                trimmed: f.trimmed,
                spriteSourceSize: f.spriteSourceSize,
                sourceSize: f.sourceSize,
                anchor: {
                  x: f.anchor.x / f.frame.w,
                  y: f.anchor.y / f.frame.h,
                },
              },
            ]),
          ),
        },
      ],
    };
    const anims = input.manifest.meta.frameTags.map((tag) => ({
      key: tag.name,
      type: "frame",
      frames: input.manifest.frames.slice(tag.from, tag.to + 1).map((f) => ({
        key: input.asset.id,
        frame: f.filename.replace(/\.png$/, ""),
      })),
      frameRate: input.manifest.meta.fps,
      repeat: tag.loop ? -1 : 0,
    }));

    const atlasPath = join(input.outDir, `${input.asset.id}.phaser.json`);
    const snippetPath = join(input.outDir, `${input.asset.id}.phaser.js`);
    const snippet = `// Phaser 3 — drop the sheet + this atlas next to your game.
this.load.atlas("${input.asset.id}", "${input.sheetFileName}", "${input.asset.id}.phaser.json");
// after load:
${anims
  .map(
    (a) =>
      `this.anims.create(${JSON.stringify(a, null, 2)});`,
  )
  .join("\n")}
`;
    await writeFile(atlasPath, JSON.stringify(atlas, null, 2));
    await writeFile(snippetPath, snippet);
    return [
      { path: atlasPath, contents: JSON.stringify(atlas, null, 2) },
      { path: snippetPath, contents: snippet },
    ];
  },
};
