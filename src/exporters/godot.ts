import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ExportInput, ExportedFile, Exporter } from "../types.js";

export const godotExporter: Exporter = {
  id: "godot",
  async export(input: ExportInput): Promise<ExportedFile[]> {
    await mkdir(input.outDir, { recursive: true });
    const texturePath = `res://${input.sheetFileName}`;
    const subs: string[] = [];
    const animations: string[] = [];
    let subId = 0;

    for (const tag of input.manifest.meta.frameTags) {
      const frames = input.manifest.frames.slice(tag.from, tag.to + 1);
      const refs: string[] = [];
      for (const frame of frames) {
        const id = `atlas_${subId++}`;
        subs.push(`[sub_resource type="AtlasTexture" id="${id}"]
atlas = ExtResource("1")
region = Rect2(${frame.frame.x}, ${frame.frame.y}, ${frame.frame.w}, ${frame.frame.h})
`);
        refs.push(`{
"duration": 1.0,
"texture": SubResource("${id}")
}`);
      }
      animations.push(`{
"frames": [${refs.join(", ")}],
"loop": ${tag.loop},
"name": &"${tag.name}",
"speed": ${input.manifest.meta.fps}.0
}`);
    }

    const tres = `[gd_resource type="SpriteFrames" load_steps=${subs.length + 2} format=3]

[ext_resource type="Texture2D" path="${texturePath}" id="1"]

${subs.join("\n")}
[resource]
animations = [${animations.join(", ")}]
`;
    const path = join(input.outDir, `${input.asset.id}.tres`);
    await writeFile(path, tres);
    return [{ path, contents: tres }];
  },
};
