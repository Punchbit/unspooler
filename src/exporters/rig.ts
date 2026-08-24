import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { CORE_CLIPS } from "../rig/animations/index.js";
import { HUMANOID } from "../rig/skeleton.js";
import type {
  AnimationClip,
  BoneName,
  Facing,
  RigManifest,
  SkeletonSpec,
} from "../rig/types.js";
import type { ExportedFile } from "../types.js";

export interface RigExportInput {
  assetId: string;
  rig: RigManifest;
  atlas: Buffer;
  outDir: string;
  skeleton?: SkeletonSpec;
  clips?: Record<string, AnimationClip>;
}

/** Write the rig manifest + parts atlas — the source of truth for runtimes. */
export async function exportRigGeneric(input: RigExportInput): Promise<ExportedFile[]> {
  await mkdir(input.outDir, { recursive: true });
  const atlasPath = join(input.outDir, input.rig.atlas);
  const manifestPath = join(input.outDir, `${input.assetId}.rig.json`);
  await writeFile(atlasPath, input.atlas);
  const json = JSON.stringify(input.rig, null, 2);
  await writeFile(manifestPath, json);
  return [
    { path: atlasPath, contents: input.atlas },
    { path: manifestPath, contents: json },
  ];
}

/* --------------------------------- godot -------------------------------- */

/**
 * Godot 4 Skeleton2D scene: Bone2D hierarchy, one Sprite2D per part with an
 * atlas region, and an AnimationPlayer with a library of the character's
 * clips as bone rotation/position tracks. Equipment attaches in-engine by
 * parenting a Sprite2D to the matching bone node.
 */
export async function exportGodotRig(input: RigExportInput): Promise<ExportedFile[]> {
  const skeleton = input.skeleton ?? HUMANOID;
  const clips = { ...CORE_CLIPS, ...(input.clips ?? {}) };
  const rig = input.rig;
  const facing: Facing = rig.facings.down ? "down" : (Object.keys(rig.facings)[0] as Facing);
  const art = rig.facings[facing];
  if (!art) throw new Error(`Rig for ${input.assetId} has no facings to export.`);
  const px = rig.pixelHeight;

  const bonePath = new Map<BoneName, string>();
  for (const bone of skeleton.bones) {
    bonePath.set(
      bone.name,
      bone.parent ? `${bonePath.get(bone.parent)}/${sanitize(bone.name)}` : sanitize(bone.name),
    );
  }

  const subResources: string[] = [];
  const animRefs: string[] = [];
  for (const name of rig.animations) {
    const clip = clips[name];
    if (!clip) continue;
    const id = `anim_${sanitize(name)}`;
    const lengthSec = clip.durationMs / 1000;
    const tracks: string[] = [];
    let ti = 0;
    for (const [boneName, track] of Object.entries(clip.tracks)) {
      const path = bonePath.get(boneName as BoneName);
      if (!path || !track) continue;
      if (track.rotation?.length) {
        const times = track.rotation.map((k) => (k.t * lengthSec).toFixed(4)).join(", ");
        const values = track.rotation.map((k) => k.value.toFixed(5)).join(", ");
        const ones = track.rotation.map(() => "1").join(", ");
        tracks.push(
          `tracks/${ti}/type = "value"
tracks/${ti}/imported = false
tracks/${ti}/enabled = true
tracks/${ti}/path = NodePath("Skeleton2D/${path}:rotation")
tracks/${ti}/interp = 1
tracks/${ti}/loop_wrap = ${clip.loop}
tracks/${ti}/keys = {
"times": PackedFloat32Array(${times}),
"transitions": PackedFloat32Array(${ones}),
"update": 0,
"values": [${values}]
}`,
        );
        ti++;
      }
      if (track.position?.length) {
        const bone = skeleton.bones.find((b) => b.name === boneName)!;
        const times = track.position.map((k) => (k.t * lengthSec).toFixed(4)).join(", ");
        const values = track.position
          .map(
            (k) =>
              `Vector2(${((bone.position.x + k.value.x) * px).toFixed(2)}, ${((bone.position.y + k.value.y) * px).toFixed(2)})`,
          )
          .join(", ");
        const ones = track.position.map(() => "1").join(", ");
        tracks.push(
          `tracks/${ti}/type = "value"
tracks/${ti}/imported = false
tracks/${ti}/enabled = true
tracks/${ti}/path = NodePath("Skeleton2D/${path}:position")
tracks/${ti}/interp = 1
tracks/${ti}/loop_wrap = ${clip.loop}
tracks/${ti}/keys = {
"times": PackedFloat32Array(${times}),
"transitions": PackedFloat32Array(${ones}),
"update": 0,
"values": [${values}]
}`,
        );
        ti++;
      }
    }
    subResources.push(
      `[sub_resource type="Animation" id="${id}"]
resource_name = "${name}"
length = ${lengthSec.toFixed(3)}
loop_mode = ${clip.loop ? 1 : 0}
${tracks.join("\n")}`,
    );
    animRefs.push(`&"${name}": SubResource("${id}")`);
  }

  subResources.push(
    `[sub_resource type="AnimationLibrary" id="lib"]
_data = {
${animRefs.join(",\n")}
}`,
  );

  const nodes: string[] = [
    `[node name="${sanitize(input.assetId)}" type="Node2D"]`,
    `[node name="Skeleton2D" type="Skeleton2D" parent="."]`,
  ];
  for (const bone of skeleton.bones) {
    const parent = bone.parent
      ? `Skeleton2D/${bonePath.get(bone.parent)}`.replace(/\/$/, "")
      : "Skeleton2D";
    nodes.push(
      `[node name="${sanitize(bone.name)}" type="Bone2D" parent="${parent}"]
position = Vector2(${(bone.position.x * px).toFixed(2)}, ${(bone.position.y * px).toFixed(2)})
rest = Transform2D(1, 0, 0, 1, ${(bone.position.x * px).toFixed(2)}, ${(bone.position.y * px).toFixed(2)})`,
    );
  }
  for (const part of skeleton.drawOrder[facing]) {
    const frame = art.parts[part];
    if (!frame) continue;
    const spec = skeleton.parts.find((p) => p.name === part)!;
    const path = bonePath.get(spec.bone)!;
    nodes.push(
      `[node name="${sanitize(part)}" type="Sprite2D" parent="Skeleton2D/${path}"]
texture = ExtResource("1")
centered = false
offset = Vector2(${(-frame.pivot.x).toFixed(2)}, ${(-frame.pivot.y).toFixed(2)})
region_enabled = true
region_rect = Rect2(${frame.frame.x}, ${frame.frame.y}, ${frame.frame.w}, ${frame.frame.h})
z_index = ${skeleton.drawOrder[facing].indexOf(part)}
z_as_relative = false`,
    );
  }
  nodes.push(
    `[node name="AnimationPlayer" type="AnimationPlayer" parent="."]
libraries = {
"": SubResource("lib")
}
autoplay = "idle"`,
  );

  const tscn = `[gd_scene load_steps=${subResources.length + 2} format=3]

[ext_resource type="Texture2D" path="res://${rig.atlas}" id="1"]

${subResources.join("\n\n")}

${nodes.join("\n\n")}
`;

  await mkdir(input.outDir, { recursive: true });
  const path = join(input.outDir, `${input.assetId}.rig.tscn`);
  await writeFile(path, tscn);
  return [{ path, contents: tscn }];
}

function sanitize(name: string): string {
  return name.replace(/[^a-zA-Z0-9_.-]/g, "_").replace(/\./g, "_");
}

/* ---------------------------------- css --------------------------------- */

/**
 * Self-contained HTML rig player: embeds the skeleton, clips, and manifest,
 * renders the bone pose to a canvas, and binds WASD + J (attack) / K (jump).
 * Drop next to the atlas PNG and open in a browser — no dependencies.
 */
export async function exportCssRig(input: RigExportInput): Promise<ExportedFile[]> {
  const skeleton = input.skeleton ?? HUMANOID;
  const clips: Record<string, AnimationClip> = {};
  for (const name of input.rig.animations) {
    const clip = { ...CORE_CLIPS, ...(input.clips ?? {}) }[name];
    if (clip) clips[name] = clip;
  }
  const data = JSON.stringify({
    rig: input.rig,
    skeleton: {
      bones: skeleton.bones,
      parts: skeleton.parts,
      drawOrder: skeleton.drawOrder,
      slots: skeleton.slots,
    },
    clips,
  });

  const html = `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<title>${input.assetId} — unspooler rig</title>
<style>
  body { margin:0; background:#151820; color:#dfe3ec; font:13px/1.5 system-ui, sans-serif; display:flex; flex-direction:column; align-items:center; gap:8px; padding:16px; }
  canvas { background:#1d2230; border-radius:8px; image-rendering:pixelated; }
  .hint { opacity:.7 }
</style>
</head>
<body>
<h3>${input.assetId}</h3>
<canvas id="c" width="480" height="480"></canvas>
<div class="hint">WASD move · hold to run · J attack · K jump</div>
<script>
const DATA = ${data};
const atlas = new Image();
atlas.src = ${JSON.stringify(input.rig.atlas)};

function lerp(a,b,k){return a+(b-a)*k}
function sampleTrack(frames,t,loop,zero){
  if(!frames||!frames.length) return zero;
  const val=f=>f.value, first=frames[0], last=frames[frames.length-1];
  const mix=(a,b,k)=>typeof a==="number"?lerp(a,b,k):{x:lerp(a.x,b.x,k),y:lerp(a.y,b.y,k)};
  if(t<=first.t){ if(!loop) return val(first); const span=first.t+(1-last.t); return span<=0?val(first):mix(val(last),val(first),(t+(1-last.t))/span); }
  if(t>=last.t){ if(!loop) return val(last); const span=first.t+(1-last.t); return span<=0?val(last):mix(val(last),val(first),(t-last.t)/span); }
  for(let i=0;i<frames.length-1;i++){const a=frames[i],b=frames[i+1];
    if(t>=a.t&&t<=b.t){const k=b.t===a.t?0:(t-a.t)/(b.t-a.t);return mix(val(a),val(b),k)}}
  return val(last);
}
function samplePose(clip,timeMs){
  let phase=0;
  if(clip){const raw=timeMs/clip.durationMs; phase=clip.loop?raw-Math.floor(raw):Math.min(1,Math.max(0,raw));}
  const pose={};
  for(const bone of DATA.skeleton.bones){
    const tr=clip?clip.tracks[bone.name]:null;
    const rot=tr?sampleTrack(tr.rotation,phase,clip.loop,0):0;
    const off=tr?sampleTrack(tr.position,phase,clip.loop,{x:0,y:0}):{x:0,y:0};
    const lx=bone.position.x+off.x, ly=bone.position.y+off.y;
    if(!bone.parent){pose[bone.name]={x:lx,y:ly,rotation:rot};continue}
    const p=pose[bone.parent], c=Math.cos(p.rotation), s=Math.sin(p.rotation);
    pose[bone.name]={x:p.x+lx*c-ly*s, y:p.y+lx*s+ly*c, rotation:p.rotation+rot};
  }
  return pose;
}
function facingFor(dir){
  if(dir==="up")return{facing:"up",flip:false};
  if(dir==="down")return{facing:"down",flip:false};
  return{facing:"side",flip:dir.includes("right")};
}
const held=new Set();
addEventListener("keydown",e=>held.add(e.key.toLowerCase()));
addEventListener("keyup",e=>held.delete(e.key.toLowerCase()));

const ctx=document.getElementById("c").getContext("2d");
let px=0,py=0,dir="down",state="idle",stateTime=0,lockUntil=0,time=0,last=performance.now();
function tick(now){
  const dt=Math.min(50,now-last); last=now; time+=dt;
  let ax=0,ay=0;
  if(held.has("a"))ax-=1; if(held.has("d"))ax+=1; if(held.has("w"))ay-=1; if(held.has("s"))ay+=1;
  const prev=state;
  if(time>=lockUntil){
    if(held.has("j")&&DATA.clips.attack){state="attack";lockUntil=time+DATA.clips.attack.durationMs}
    else if(held.has("k")&&DATA.clips.jump){state="jump";lockUntil=time+DATA.clips.jump.durationMs}
    else{
      const mag=Math.hypot(ax,ay);
      if(mag>0){
        dir=Math.abs(ax)>Math.abs(ay)?(ax<0?"left":"right"):(ay<0?"up":"down");
        const run=held.has("shift")&&DATA.clips.run;
        state=run?"run":"walk";
        const speed=(run?170:100)*dt/1000;
        px+=ax/mag*speed; py+=ay/mag*speed;
      } else state="idle";
    }
  }
  stateTime=state===prev?stateTime+dt:0;
  render();
  requestAnimationFrame(tick);
}
function render(){
  const c=ctx.canvas; ctx.clearRect(0,0,c.width,c.height);
  const clip=DATA.clips[state]||DATA.clips.idle;
  const pose=samplePose(clip,stateTime);
  const {facing,flip}=facingFor(dir);
  const art=DATA.rig.facings[facing]||DATA.rig.facings.down;
  if(!art||!atlas.complete)return;
  const scale=(c.height*0.55)/DATA.rig.pixelHeight;
  const ox=c.width/2+px, oy=c.height*0.72+py;
  for(const partName of DATA.skeleton.drawOrder[facing]){
    const frame=art.parts[partName]; if(!frame)continue;
    const spec=DATA.skeleton.parts.find(p=>p.name===partName);
    const wt=pose[spec.bone]; if(!wt)continue;
    ctx.save();
    ctx.translate(ox+(flip?-1:1)*wt.x*DATA.rig.pixelHeight*scale, oy+wt.y*DATA.rig.pixelHeight*scale);
    ctx.rotate((flip?-1:1)*wt.rotation);
    if(flip)ctx.scale(-1,1);
    ctx.drawImage(atlas,frame.frame.x,frame.frame.y,frame.frame.w,frame.frame.h,
      -frame.pivot.x*scale,-frame.pivot.y*scale,frame.frame.w*scale,frame.frame.h*scale);
    ctx.restore();
  }
}
requestAnimationFrame(tick);
</script>
</body>
</html>
`;

  await mkdir(input.outDir, { recursive: true });
  const path = join(input.outDir, `${input.assetId}.rig.html`);
  await writeFile(path, html);
  return [{ path, contents: html }];
}
