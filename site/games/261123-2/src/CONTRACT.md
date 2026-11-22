# ほくほく！おちばあつめでやきいも — shared contract (read fully before coding)

A wordless, one-finger, photoreal 3D web game for a 5-year-old (iPhone / iPad Safari).
Autumn back garden. Rake fallen leaves into a pile → bury sweet potatoes → light it → fan the fire →
dig the roasted potatoes out → break them open (steam, surprise colour inside) and eat. Then the wind
drops a new carpet of leaves and you may start again.

**Look: photoreal, "ordinary real things".** PBR materials, the photo textures in `G.tex`, soft sun
shadows, natural proportions and muted real colours. NOT toy-like, NOT low-poly, NOT cartoon, nothing
glowing neon, nothing floating UI-like. No text, digits, arrows or overlay UI anywhere. No animals,
no people (the player is an unseen first person).

Everything ships as ONE html file (`index.html`), built by `node tools/build.mjs`. No network at
runtime, no external files. Only dependency: three r170 (`import * as THREE from 'three'`), core only —
**no `examples/jsm` addons** (not vendored; write what you need).

## Files / ownership (touch only your own file)

| file | owner | content |
|---|---|---|
| `src/main.js`, `src/shell.html` | ENGINE | renderer, loop, quality, input, camera rig, hints, save, fallback, texture loading |
| `src/audio.js` | AUDIO | all sound, synthesised with Web Audio |
| `src/world.js` | WORLD | garden, light, tree, stone ring, zaru tray, potato basket, time of day |
| `src/leaves.js` | LEAVES | loose leaves, sweeping, falling leaves, the pile (mound) incl. burning to ash, acorns, the rake |
| `src/fire.js` | FIRE | flames, smoke, sparks, embers light, ash puffs, steam; the lighter and the uchiwa fan |
| `src/potato.js` | POTATO | sweet potatoes raw/roasted/halves/bites, the tongs |
| `src/story.js` | STORY (phase 2) | stage machine wiring everything, hint timing, save/restore |
| `src/stub.js`, `src/assets.gen.js`, `tools/*`, `assets/*` | director | do not edit |

Every module: `export function create(G) { ...; return api; }` — `api.update(dt)` is called every frame.
Modules must not touch DOM events, `requestAnimationFrame`, or `localStorage` (ENGINE does).
Modules read other modules only through `G.<name>` at call time (never at `create` time, except
`G.world.anchors` which LEAVES/FIRE/POTATO may read in `create`; WORLD is created first).
Creation order: audio, world, leaves, fire, potato, story. Update order: story, world, leaves, fire,
potato, then engine internals (rig, hints), then render.

## Building / looking at your work

```
node tools/build.mjs --dev world          # only main.js + listed modules are real, the rest are no-op stubs
node tools/build.mjs --dev world,leaves   # -> prints the output html path (in the scratchpad, never in the repo)
node tools/shot.mjs <that.html> /tmp/.../scratchpad/dev/x.png --eval "G.leaves.reset({count:200})" --wait 2500
```
`window.G` exists in every build so `--eval` can drive your module. `--size 1180x820` for landscape.
In a dev build with a stubbed world, ENGINE adds a plain ground + light so things are visible.
`src/main.js` is being written at the same time as your module by another agent. Write your module
first; when you want to look at it and the dev build fails because of *someone else's* file, wait a
minute and retry (a few times). If it still fails, finish with only `node --check`-level sanity and say so.
Do not write tests, test harnesses or extra tooling. Do not run the full build / commit / push — the director does.
Look at 1–3 screenshots of your own module at 390x844 and fix what looks unreal or broken. That is all.

## World conventions

Metres, Y up. The leaf pile / fire is at the origin. The player looks from +Z toward −Z.
Sun comes from the back-left: direction *to* the sun ≈ normalize(−0.55, 0.70, −0.30) (warm, low-ish).

Layout (x, z on the ground):
- fire ring: centre (0,0), stones on radius 0.80, pile mound max radius 0.55, max height 0.42
- leaf play area: ellipse centre (0, 0.05), radii x 1.30, z 1.45 (leaves must also stay out of the shelf objects)
- tree trunk: (−1.55, −2.30), radius ≈ 0.30; canopy/branches overhead (y 2.6–3.8) above the back half
- foreground "shelf" (z 1.1–1.7): zaru serving tray centre (−0.62, 1.22) radius 0.27;
  potato basket centre (0.62, 1.22) radius 0.25; uchiwa rests at (−0.14, 1.45) handle toward +Z;
  tongs rest at (0.08, 1.40) lying along Z; lighter rests at (0.26, 1.40) lying along Z, tip toward −Z
- backdrop photo: a curved wall ≈ 8.5 m behind/around (−Z side)

`G.world.anchors` (THREE.Vector3 unless noted): `pile`, `zaru`, `basket`, `treeBase`, `uchiwaRest`,
`tongsRest`, `lighterRest`, `canopy` = `{center:Vector3(−0.3,3.3,−0.5), rx:1.7, rz:1.4}` (where leaves fall from).

## G — the shared context (ENGINE provides)

```
G.THREE, G.renderer, G.scene, G.camera        // PerspectiveCamera, moved only by G.rig
G.dev                                          // true in --dev builds
G.quality = { low, particles (1 or 0.5), shadows }   // may flip to low at runtime; read it live
G.time = { t, dt }                             // seconds; dt clamped to 0.05
G.tex.<name>                                   // decoded THREE.Texture, sRGB, mipmapped, anisotropy 4
   tiling (RepeatWrapping): ground leaflitter ash bark stone weave potato_skin potato_roast flesh_yellow flesh_purple flesh_orange
   clamped: backdrop(1280x731) branch(1024x490 RGBA cutout of a maple branch, branch base at the RIGHT edge)
            zaru(512 RGBA top-down round bamboo tray) leaves(768x512 RGBA atlas)
   leaves atlas = 3 cols x 2 rows of 256px cells, each one leaf, stem pointing DOWN (−v):
      row 0 (top):    0 red maple, 1 orange maple, 2 yellow ginkgo
      row 1 (bottom): 3 brown maple/oak, 4 golden zelkova, 5 red-orange cherry
   If you need another repeat/offset: `const t = G.tex.x.clone(); t.repeat.set(..); t.needsUpdate = true`.
G.util.normalFrom(tex, strength=2)             // normal map derived from luminance (cached), same wrap/repeat as tex
G.util.softDot                                  // shared CanvasTexture: white soft radial falloff (halos, smoke, puffs)
G.util.noiseTex                                 // shared 256px tiling RGBA value-noise texture (RepeatWrapping) for shaders
G.util.rand(a=0,b=1), G.util.damp(cur, target, lambda, dt), G.util.clamp, G.util.lerp, G.util.smooth(e0,e1,x)

G.input = {                                     // ONE finger only; extra touches are ignored by ENGINE
  down, justDown, justUp,                       // booleans for this frame
  x, y,                                         // NDC −1..1
  px, py,                                       // CSS pixels
  ray,                                          // THREE.Ray from the camera through the finger (valid while down and on justUp)
  ground,                                       // Vector3: ray ∩ plane y=0 (clamped to 6 m from origin)
  vx, vz, speed,                                // ground-plane finger velocity m/s (smoothed ~60 ms); 0 when not down
  dragPx,                                       // CSS px travelled since down
  heldFor,                                      // seconds since down
  idle,                                         // seconds since the last pointer activity (down/move/up)
}
G.pick(object3DOrArray) -> {object, point, distance} | null     // raycast with G.input.ray (recursive)
G.rayPlaneY(y, outVec3) -> outVec3                               // finger ray ∩ horizontal plane
G.pxDist(worldVec3) -> CSS px between the finger and the projected point (generous hit tests: use >= 60 px radii)
G.toScreen(worldVec3, out) -> {x,y} CSS px

G.rig.shot(spec, seconds=1.6)   // guided camera move (eased). spec = { target:[x,y,z], fit:{w, d}, pitch, yaw=0, fov=50 }
                                // keeps the ground rectangle w (along X) x d (along Z) centred on target fully in view
                                // in ANY aspect ratio (portrait phone … landscape tablet); re-fits on resize/rotation.
                                // pitch = degrees below horizontal; may be [portrait, landscape].
G.rig.nudge(amount)             // tiny organic camera shake impulse (0..1)

G.hint.halo(targetObject3DOrVector3, radius) -> { set(k 0..1), dispose() }
        // a soft, warm, pulsing pool of light hugging the ground/object (reads as a sunbeam, not UI)
G.hint.finger.show(points /* Vector3[] world path */, { loop=true, speed=0.9 /* m/s */, tap=false })
G.hint.finger.hide()            // translucent skin-toned finger that presses down, traces the path, lifts, repeats
G.save.data, G.save.commit()    // plain JSON object persisted by ENGINE (throttled, never throws)
G.audio, G.world, G.leaves, G.fire, G.potato, G.story
```

Attention convention: every touchable thing has `setAttention(k)` (0..1). At k>0 the owner module
makes it "ask to be touched" in a physical way: a gentle rocking/wobble/bounce at ~1.2 Hz scaled by k,
never floating, never glowing by itself. (The warm light pool comes from `G.hint.halo`, driven by STORY.)

Response rule: anything touched must visibly move and sound within 100 ms.
Robustness rule: every API must be safe to call at any time, in any order, repeatedly, with dt up to 0.05
(spamming taps, releasing anywhere, calling `reset` mid-animation). Nothing may throw; clamp everything.
Performance: iPad at 30 fps. Use `InstancedMesh`/`Points` for anything numerous, no per-frame allocations
in hot loops, shadow casters kept few (leaves cast shadows only when `G.quality.shadows`), particle caps
scaled by `G.quality.particles`. Draw calls for the whole game should stay under ~120.

## AUDIO — `G.audio` (src/audio.js)

All synthesised (noise + filters + oscillators + short envelopes); warm, soft, never harsh or startling.
`unlock()` is called by ENGINE on the first touch; every method is a silent no-op before that or if
Web Audio is unavailable. ENGINE calls `suspend()` / `resume()` on page hide/show.

```
unlock(), suspend(), resume()
rustle(k)        // call every frame while leaves are being pushed, k 0..1 = how hard; dry leaf crackle-swish, decays by itself
leafIn(frac)     // one leaf joined the pile: tiny soft kalimba-like pluck, pitch climbs with frac 0..1 (rate-limit internally ~14/s)
pat()            // a single leaf landing softly
gust(seconds)    // wind through trees whoosh
treeShake()      // branch rattle + leaf shiver
roll()           // acorn clicking/rolling on soil (short)
thud(k=1)        // soft object set down on leaves/ground
tok()            // bamboo/wood knock (basket, zaru, rake)
rummage()        // potato pushed into dry leaves (crunchy rustle + muffled thump)
lighterClick()   // piezo click-click
ignite()         // soft "fwoomp"
fire(k)          // continuous fire bed: call every frame with 0..1 (0 = silent); crackles + low roar scale with k
ember(k)         // continuous faint ember ticking 0..1
fan(k)           // one fan stroke whoosh, k = strength 0..1
pop()            // acorn "pachin!" pop
hiss()           // short smoke/steam hiss
ashPuff()        // soft powdery "pof"
tongs()          // light metallic clink
crackOpen()      // roasted potato breaking open: soft dry skin crack + steamy "hof"
bite()           // soft munch (2 quick chews)
cue()            // very gentle two-note "look here" (hint level 1)
chime(n)         // success sparkle; n = 0,1,2… steps up a pentatonic scale
finale()         // ~8 s gentle, slow, warm melody (lullaby-like), ends softly
```

## WORLD — `G.world` (src/world.js)

Builds: ground (ground texture + normal map, ~1.5 m per tile, slightly uneven tint so tiling is not obvious,
radius ≥ 9 m, fades into warm haze/fog toward the backdrop), curved backdrop wall with the `backdrop` photo
(unlit/toned, bottom edge hidden by haze + a low dark hedge line so there is no visible seam), sky/fog colour,
sun `DirectionalLight` with soft shadows (shadow frustum just covering x −3..3, z −3.5..2.6; 1024–2048 map),
hemisphere fill, a small procedural environment map (PMREM of a gradient sky scene) so PBR looks right,
ACES tone mapping is set by ENGINE. Tree: bark trunk with root flare at `treeBase`, going out of frame.
Branches: 4–6 alpha-cutout planes of `G.tex.branch` overhead (alphaTest, double sided, cast shadows →
real dappled light on the ground, slow sway). Stone ring: ~11 irregular real-looking stones (displaced
icospheres, `stone` texture + normal map) on radius 0.80, darker scorched bare soil disc inside (decal).
Zaru tray at `anchors.zaru` (shallow dish, `zaru` texture projected top-down, real thickness/rim).
Potato basket at `anchors.basket` (round woven bowl ~0.25 radius, 0.13 high, `weave` texture + normal).

```
anchors                                  // see above
setTimeOfDay(k)                          // 0 bright mid-afternoon … 0.5 golden hour … 1 warm sunset glow (still readable!). Eases internally (~2 s)
spot(posVec3 | null, strength=1, radius=0.9)   // attention: a soft sunbeam pool on the ground at pos + ≤12 % dimming elsewhere; eases
shakeTree(power=1)                       // trunk shudder + branches whip for ~0.7 s
treeHit(ray) -> boolean                  // generous: finger ray hits trunk or branches
zaru: { object3D, setAttention(k) }      // tray rocks slightly
basket: { object3D, setAttention(k) }
update(dt)
```

## LEAVES — `G.leaves` (src/leaves.js)

Loose leaves: one `InstancedMesh` (slightly cupped/curled quad, 2x2 segments, atlas UV per instance via
instanced attribute, alphaTest ~0.5, double sided, MeshStandardMaterial w/ slight per-instance tint and
size 0.11–0.17 m), lying nearly flat with random yaw and a few degrees of tilt, overlapping naturally.
They must look like real fallen leaves in sun: correct shadows on the ground, slight translucency feel.

Sweeping (the core toy — make it feel great): `sweep(active, point, vx, vz)` is called by STORY every
frame of the sweep stage. While `active`, the rake head follows `point` (the finger's ground point) with
≤ 80 ms lag; the head is drawn ~0.10 m "above" the finger on screen (toward −Z) so the finger does not
hide it; the handle comes toward the player/up, leaning with the motion. Leaves within the head's
footprint (≈ 0.50 m wide across the motion, 0.22 m deep) are pushed along with the finger velocity, tumble,
lift a few cm, flutter, and rustle (`G.audio.rustle(k)`); faster strokes throw leaves further and higher.
Assist for a 5-year-old: pushed leaves are biased ~25 % toward the pile; any leaf whose centre comes within
0.62 m of the origin is *absorbed*: it hops onto the mound (short arc, lands on the mound surface and stays
as a pile leaf), `G.audio.leafIn(frac)`. Leaves never leave the play ellipse (soft wall) and are pushed out of
the shelf objects (circles r 0.32 at zaru & basket). When released the rake stays lying where it was left.
The first touch must move the rake to the finger within 100 ms even if the finger is not on the rake.

Pile: a soft irregular mound mesh (`leaflitter` texture + normal map) that grows with `pileFraction`
(radius 0.22→0.55, height 0.07→0.42) and is covered by up to ~140 instanced pile leaves sitting on its
surface at natural angles. `setBurn(k)`: 0 fresh → 0.5 leaves curling, edges black, mound darkening →
1 a low (30 % height) bed of pale grey ash (`ash` texture) with black flakes; pile leaf instances char
(per-instance colour → black → grey, shrink, crumble away progressively from the centre outward).
`setEmber(k)`: orange ember glow breathing between the ash (emissive noise mask), 0 none.

Acorns: 4 small realistic acorns (lathe nut + rough cap) half hidden under leaves. The rake rolls them
(`G.audio.roll()`); rolled into the ring they join the pile.

```
reset({ count = 210 (≈130 when G.quality.low), pileStart = 0.10, keepPile = false })
     // (re)scatter loose leaves over the play ellipse (not inside r 0.7 of the origin, not under shelf objects),
     // pile at pileStart. keepPile=true: keep the current mound state (used for the finale).
sweep(active, pointVec3, vx, vz)
rake: { object3D, setAttention(k) }      // realistic bamboo "kumade" leaf rake: long bamboo pole (≈1.5 m), fan of ~17 thin curved bamboo tines (≈0.45 m wide), wire binding
pileFraction                              // getter 0..1 = gathered / total
looseCount                                // getter
absorbedTotal                             // getter, monotonically increasing counter
gatherAll(seconds=2)                      // a breeze carries every remaining loose leaf into the pile (curving, tumbling paths)
dropLeaves(n, seconds=3)                  // n leaves flutter down from the canopy (pendulum sway, tumbling) and land as loose leaves in the play ellipse
dropLeafOnPile(cb)                        // ONE leaf drifts slowly down (≈2.2 s) and lands on the very top of the pile, then cb()
rustlePile(power=1)                       // pile leaves hop and resettle (tap / potato pushed in); returns nothing
pile: { topY /* getter: current top height */, radius /* getter */ }
pileHit(ray) -> boolean                   // generous (sphere r ≈ 0.7 around the pile)
setBurn(k), setEmber(k)
acornsInPile                              // getter
popAcorn() -> Vector3 | null              // one acorn in the pile pops: it is flung out in an arc, lands charred outside the ring; returns where it popped
hintPath() -> [fromVec3, toVec3]          // from the densest remaining loose-leaf cluster to the pile (for the finger hint)
getState() -> plain JSON, setState(s)     // enough to restore: fraction, burn, ember (loose leaves are re-scattered to match)
update(dt)
```

## FIRE — `G.fire` (src/fire.js)

Flames: realistic bonfire flames from the pile — several crossed/billboard quads with a custom
ShaderMaterial (scrolling `G.util.noiseTex`, teardrop mask, yellow-white core → orange → transparent red
tips, additive, depthWrite off), flickering tongues that lean with the wind; `setLevel(k)` scales count/height
(0 none, 0.15 small licking flame at the front base, 1 lively ~0.8 m bonfire). A warm flickering
`PointLight` (no shadows) lights leaves/ground/stones, intensity follows the level.
Smoke: soft lit grey-blue billboards (softDot × noise), rising, widening, fading, bending with the wind,
`setSmoke(k)`. Sparks: tiny bright orange points with gravity-less upward wobble and fade.
Ash puff: pale grey dust burst that settles. Steam: thin white wisps rising and curling (for hot potatoes).
All particles pooled; caps: smoke ≤ 70, sparks ≤ 90, ash ≤ 60, steam ≤ 60 (× `G.quality.particles`).

```
ignite(posVec3)                 // small flame is born at pos (front base of the pile) and spreads to the pile centre over ~1.5 s
setLevel(k)                     // target flame level 0..1 (eases ~0.4 s)
setSmoke(k)                     // 0..1
setWind(k)                      // fan wind 0..1: flames flare taller/brighter, lean away from the player (−Z), more sparks
setBaseY(y)                     // height of the burning surface (pile top sinks while burning)
sparks(posVec3, n=10, power=1)
ashPuff(posVec3, power=1)
steamAt(posVec3OrObject3D, rate=1) -> { setRate(k), stop() }   // continuous wisps following the object
steamBurst(posVec3, power=1)    // big soft "hof" of steam
smokeFace()                     // gag: one fat smoke puff rolls toward the camera, greys the view for ~1 s, clears (never fully opaque)
level                           // getter current flame level
lighter: { object3D, setAttention(k), hold(pointVec3), release(), setFlame(on), tip /* getter world Vector3 */, hit(ray) -> boolean }
     // long-reach gas lighter (≈0.26 m: coloured plastic grip w/ trigger, slim metal tube). hold(): lifts to the finger's
     // ground point (≈0.12 m above ground, tip aimed at the pile), smooth; release(): lies down where it is (flat on the ground)
     // or stays; setFlame(true) shows a small steady flame at the tip.
uchiwa: { object3D, setAttention(k), fan(active, pointVec3, vx, vz) -> wind 0..1, hit(ray) -> boolean }
     // classic round Japanese paper fan (uchiwa): bamboo handle + ribs showing through the paper; draw the paper with a
     // procedural canvas texture (off-white washi, soft indigo gradient band, thin radial rib shadows) — real, plain.
     // fan(true,…): the fan stands upright between the player and the fire (around z ≈ 0.95, following the finger's x a little)
     // and swings with the finger motion (rotation follows finger velocity → real flapping); every stroke: G.audio.fan(k).
     // returns the current wind (rises with stroke speed/reversals, decays in ~0.8 s). fan(false,…): it is laid down flat.
update(dt)
```

## POTATO — `G.potato` (src/potato.js)

Sweet potatoes (satsumaimo): believable irregular spindle shapes (not perfect lathes: bent axis, lumpy
cross-section, tapered ends with a root nub), 0.16–0.22 m long, `potato_skin` texture + normal map, slightly
dusty satin. Three per round, each with a secret flesh variety: `yellow`, `purple`, `orange` (shuffled).
From round 2 on, one of them is comically big (≈1.5×).
Roasted look: `potato_roast` texture, darker, matte, ash dust. Broken open: two halves; the broken faces are
rough, fluffy, slightly domed surfaces with the `flesh_*` texture, a thin dark skin rim; moist highlights.
Bites: each bite visibly removes a chunk from a half (e.g. shorten/scallop the half with a ragged flesh cap).
Tongs: plain steel fire tongs (two long thin springy strips joined at one end, ≈0.4 m), resting at `anchors.tongsRest`.

```
reset(round=1)                       // 3 raw potatoes lying naturally in the basket (overlapping, different angles)
count = 3
state(i) -> 'basket'|'held'|'buried'|'ash'|'tongs'|'zaru'|'open'|'eaten'
variety(i) -> 'yellow'|'purple'|'orange'
setAttention(i, k)                   // i = index, or −1 for all currently relevant ones
pickRaw(ray) -> i | −1               // generous: nearest raw potato in the basket within ~70 px of the finger
hold(i, pointVec3)                   // raw potato follows the finger (lifted ≈0.18 m above ground, slight swing lag)
dropRaw(i)                           // back to its place in the basket (soft arc + G.audio.tok())
bury(i)                              // dives nose-first into the pile at its own slot and disappears under the leaves (≈0.5 s)
buriedCount
roastAll()                           // buried ones become roasted (still hidden)
revealInAsh(k)                       // 0..1: roasted potatoes sit half-buried in the ash bed at 3 well separated slots (inside r 0.3), dusted with ash
pickAsh(ray) -> i | −1               // generous
grab(i, pointVec3)                   // tongs fly to it and grip (≤100 ms to start moving); potato + tongs follow the finger, lifted ≈0.22 m
toZaru(i)                            // tongs carry it onto its slot on the zaru, set it down, tongs go back to rest (G.audio.tok())
toAsh(i)                             // set back in its ash slot (no penalty)
onZaruCount
tongs: { object3D, setAttention(k) }
pickWhole(ray) -> i | −1             // roasted, unbroken potato on the zaru
breakDrag(i, amount)                 // 0..1 while the finger drags: the two halves bend/hinge apart like breaking by hand; a crack opens, light steam
breakOpen(i)                         // snap: halves separate and settle side by side on the zaru, flesh faces tilted up toward the camera
breakCancel(i)                       // springs back closed
pickHalf(ray) -> { i, h } | null     // a half that still has bites left
bite(i, h) -> bitesLeft              // the half rises toward the camera (bottom-centre of the view), a bite disappears (G.audio.bite()),
                                     // it settles back smaller; after the last bite only a scrap of skin remains on the zaru
BITES_PER_HALF = 2
halfPos(i, h, outVec3)               // world position of a half's flesh face (for steam)
eatenCount                           // potatoes fully eaten
getState(), setState(s)
update(dt)
```

## STORY — stage flow (src/story.js, phase 2; here so everyone knows the context)

| stage | the one action | camera `rig.shot` |
|---|---|---|
| `sweep`  | drag on the ground: rake leaves into the ring | target (0,0,0.15) fit 2.9×3.3 pitch [44,52] |
| `bury`   | drag each potato from the basket into the pile (×3) | target (0,0.1,0.55) fit 2.0×2.6 pitch 44 |
| `light`  | drag the lighter to the pile | same as bury |
| `fan`    | swipe left-right: fan the fire with the uchiwa | target (0,0.25,0.3) fit 1.9×2.4 pitch [32,38] |
| `dig`    | drag each roasted potato from the ash to the zaru (×3) | target (−0.2,0.05,0.6) fit 1.9×2.2 pitch 48 |
| `eat`    | drag across a potato to break it; tap the halves to eat (×3) | target zaru, fit 0.95×0.95 pitch 50 |
| `finale` | (watch) wind brings the leaves down again, soft melody | target (0,0.6,−0.3) fit 3.2×3.4 pitch [28,34] |

Hints: stage start → `world.spot` on the goal + halo and `setAttention(0.5)` on the one active thing.
idle ≥ 4 s → attention 1 + `audio.cue()`. idle ≥ 8 s → `hint.finger.show(path)` until touched.
No fail states, no timers, no scores. Releasing a dragged thing anywhere else just puts it back.
