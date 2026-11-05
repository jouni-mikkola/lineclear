# The README film's scene, for Blender, headless: `bun run media` runs
#   blender -b --factory-startup -P scripts/film/line.py -- --parts <parts.json> --out <dir> [--frame <n>,<n>]
# It builds Lineclear's railway picture language (docs/brand.md) in 3D and renders each frame as a PNG. Every size,
# colour and curve comes from parts.json, which bun run media writes from ui/brand (tokens.css, rail.ts) and
# scripts/film (motion.json, story.json): nothing here is a brand value of its own. The captions are laid over the
# frames afterwards, in the tokens' font.
import json
import math
import os
import sys

import bpy

args = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
opt = {args[i][2:]: args[i + 1] for i in range(0, len(args) - 1, 2) if args[i].startswith("--")}
P = json.load(open(opt["parts"]))
OUT = opt["out"]
ONLY = [int(f) for f in opt["frame"].split(",")] if "frame" in opt else None
INK = P["ink"]
FPS = P["story"]["fps"]
W, H = P["story"]["size"]
LENGTH = P["length"]
PART = P["parts"]


# Curves: the cubic beziers of motion.json, solved for y at x as CSS does.
def bezier(c):
    x1, y1, x2, y2 = c

    def at(p0, p1, s):
        return 3 * p0 * (1 - s) ** 2 * s + 3 * p1 * (1 - s) * s ** 2 + s ** 3

    def ease(x):
        if x <= 0:
            return 0.0
        if x >= 1:
            return 1.0
        lo, hi = 0.0, 1.0
        for _ in range(40):
            mid = (lo + hi) / 2
            if at(x1, x2, mid) < x:
                lo = mid
            else:
                hi = mid
        return at(y1, y2, (lo + hi) / 2)

    return ease


EASE = {k: bezier(v) for k, v in P["ease"].items()}
QUICK = P["ms"]["quick"] / 1000
LONG = P["ms"]["long"] / 1000


def prog(t, a, dur, ease="inOut"):
    """How far a move from `a` lasting `dur` seconds is at `t`, eased, 0 to 1."""
    return EASE[ease]((t - a) / dur) if dur > 0 else float(t >= a)


def lin(hex_):
    """A token's sRGB hex as the linear colour Blender's shaders take."""
    h = hex_.lstrip("#")
    out = []
    for i in (0, 2, 4):
        c = int(h[i:i + 2], 16) / 255
        out.append(c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4)
    return (*out, 1.0)


def mix(a, b, k):
    return tuple(a[i] + (b[i] - a[i]) * k for i in range(4))


# The scene: empty, Cycles on the CPU so it renders the same on any machine, the colours as written.
scene = bpy.context.scene
for o in list(bpy.data.objects):
    bpy.data.objects.remove(o)
scene.render.engine = "CYCLES"
scene.cycles.device = "CPU"
scene.cycles.samples = int(P.get("samples", 4))
scene.cycles.use_denoising = True
# A few samples and a quick denoise: the parts are flat colours, so this looks clean at a few seconds a frame.
scene.cycles.denoising_prefilter = "FAST"
scene.cycles.denoising_quality = "FAST"
scene.cycles.max_bounces = 4
scene.render.resolution_x, scene.render.resolution_y = W, H
scene.render.resolution_percentage = 100
scene.render.fps = FPS
scene.render.use_persistent_data = True
scene.render.image_settings.file_format = "PNG"
scene.render.image_settings.color_mode = "RGB"
scene.view_settings.view_transform = "Standard"
scene.view_settings.look = "None"
world = bpy.data.worlds.new("world")
scene.world = world
world.use_nodes = True
world.node_tree.nodes["Background"].inputs[0].default_value = lin(INK["base"])
world.node_tree.nodes["Background"].inputs[1].default_value = 0.25


def material(name, colour, glow=0.0, rough=0.6):
    """A part's material: its token colour, lit by the scene, with `glow` of its own light so the colour holds."""
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    # Its own light shows on it but lights nothing else, so the render stays fast.
    m.cycles.emission_sampling = "NONE"
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = lin(colour)
    b.inputs["Roughness"].default_value = rough
    b.inputs["Emission Color"].default_value = lin(colour)
    b.inputs["Emission Strength"].default_value = glow
    return m


def paint(m, colour, glow=None):
    b = m.node_tree.nodes["Principled BSDF"]
    c = colour if isinstance(colour, tuple) else lin(colour)
    b.inputs["Base Color"].default_value = c
    b.inputs["Emission Color"].default_value = c
    if glow is not None:
        b.inputs["Emission Strength"].default_value = glow


def mesh_box(name, size, at, mat, bevel=0.0):
    bpy.ops.mesh.primitive_cube_add(size=1, location=at)
    o = bpy.context.object
    o.name = name
    o.scale = size
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if bevel > 0:
        mod = o.modifiers.new("round", "BEVEL")
        mod.width = bevel
        mod.segments = 5
        mod.limit_method = "NONE"
    o.data.materials.append(mat)
    for p in o.data.polygons:
        p.use_smooth = bevel > 0
    return o


def cylinder(name, r, depth, at, mat, verts=48):
    bpy.ops.mesh.primitive_cylinder_add(radius=r, depth=depth, location=at, vertices=verts)
    o = bpy.context.object
    o.name = name
    o.data.materials.append(mat)
    return o


def sphere(name, r, at, mat):
    bpy.ops.mesh.primitive_uv_sphere_add(radius=r, location=at, segments=24, ring_count=12)
    o = bpy.context.object
    o.name = name
    o.data.materials.append(mat)
    bpy.ops.object.shade_smooth()
    return o


# Paths: a track is a list of points, each piece a straight line or a cubic bezier, sampled finely so a train can
# run along it at an even speed.
def cubic(p0, p1, p2, p3, n=32):
    pts = []
    for i in range(1, n + 1):
        s = i / n
        u = 1 - s
        pts.append(tuple(u ** 3 * p0[k] + 3 * u * u * s * p1[k] + 3 * u * s * s * p2[k] + s ** 3 * p3[k] for k in range(2)))
    return pts


class Path:
    def __init__(self, pts):
        self.pts = pts
        self.len = [0.0]
        for a, b in zip(pts, pts[1:]):
            self.len.append(self.len[-1] + math.dist(a, b))

    @property
    def total(self):
        return self.len[-1]

    def at(self, d):
        """The point `d` along the path and the heading there."""
        d = max(0.0, min(d, self.total))
        for i in range(1, len(self.pts)):
            if self.len[i] >= d or i == len(self.pts) - 1:
                a, b = self.pts[i - 1], self.pts[i]
                seg = self.len[i] - self.len[i - 1] or 1
                k = (d - self.len[i - 1]) / seg
                return (a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k), math.atan2(b[1] - a[1], b[0] - a[0])

    def dist_to_x(self, x):
        """How far along the path it first reaches `x`."""
        for i in range(1, len(self.pts)):
            if self.pts[i][0] >= x:
                a, b = self.pts[i - 1], self.pts[i]
                k = (x - a[0]) / ((b[0] - a[0]) or 1)
                return self.len[i - 1] + (self.len[i] - self.len[i - 1]) * k
        return self.total


RAIL = PART["rail"]
TIE = RAIL["w"] * 3


def rail(name, path, colour, w=None, z=0.0, ties=True):
    """A rail: a tube along the path with its sleepers under it. It lays itself as `lay` goes from 0 to 1."""
    w = w or RAIL["w"]
    cu = bpy.data.curves.new(name, "CURVE")
    cu.dimensions = "3D"
    cu.bevel_depth = w / 2
    cu.bevel_resolution = 4
    sp = cu.splines.new("POLY")
    sp.points.add(len(path.pts) - 1)
    for p, (x, y) in zip(sp.points, path.pts):
        p.co = (x, y, z + w / 2 + 1.2, 1)
    o = bpy.data.objects.new(name, cu)
    scene.collection.objects.link(o)
    o.data.materials.append(material(name, colour, glow=0.25, rough=0.45))
    sleepers = []
    if ties:
        tm = material(name + "-ties", INK["line"], glow=0.2, rough=0.8)
        d = RAIL["gap"] / 2
        while d < path.total:
            (x, y), h = path.at(d)
            s = mesh_box(name + "-tie", (RAIL["tie"], TIE, 1.2), (x, y, z + 0.6), tm)
            s.rotation_euler.z = h
            sleepers.append((d, s))
            d += RAIL["gap"]
    return {"curve": cu, "path": path, "ties": sleepers}


def lay(r, k):
    r["curve"].bevel_factor_end = max(0.0, min(1.0, k))
    r["curve"].bevel_factor_start = 0.0
    edge = k * r["path"].total
    for d, s in r["ties"]:
        s.hide_render = d > edge


# The layout, in the design's px: the signal box on the left, a spine from it to three project tracks, each with
# three stations and a signal before its junction, all three joining the main line on the right.
Y = [150.0, 0.0, -150.0]
SPINE_X = -390.0
ST_X = [-280.0, -150.0, -20.0]
SIG_X = 110.0
JUNCTION = (300.0, 0.0)
MAIN_END = 600.0
BOX = (-490.0, 0.0)

ground = material("ground", INK["base"], rough=0.9)
bpy.ops.mesh.primitive_plane_add(size=6000, location=(0, 0, -6))
bpy.context.object.data.materials.append(ground)
board = mesh_box("board", (1240, 520, 6), (40, 0, -3), material("board", INK["raised"], glow=0.15, rough=0.85), bevel=18)


def track_path(y):
    pts = [(SPINE_X, y)]
    pts += [(SIG_X + 70, y)]
    pts += cubic((SIG_X + 70, y), (SIG_X + 140, y), (JUNCTION[0] - 70, 0), JUNCTION)
    pts += [(MAIN_END, 0.0)]
    return Path(pts)


TRACKS = [track_path(y) for y in Y]
# Each track's rail stops at the junction; the main line from there is its own, brighter rail.
track_rails = []
for i, y in enumerate(Y):
    p = TRACKS[i]
    cut = [pt for pt in p.pts if pt[0] <= JUNCTION[0] + 0.01]
    track_rails.append(rail(f"track{i}", Path(cut), INK["line2"]))
spine = rail("spine", Path([(BOX[0] + 40, 0.0), (SPINE_X, 0.0), (SPINE_X, Y[0])]), INK["line2"])
spine_down = rail("spine-down", Path([(SPINE_X, 0.0), (SPINE_X, Y[2])]), INK["line2"])
main = rail("main", Path([JUNCTION, (MAIN_END, 0.0)]), INK["fg2"], w=RAIL["w"] * 1.5)

# The signal box: a cabin on a base, its roof in the accent, its windows lit while it writes.
BOXP = PART["box"]
bw, bh = BOXP["w"] * 1.6, BOXP["h"] * 1.6
cabin = mesh_box("cabin", (bw, bh, bh * 0.9), (BOX[0], BOX[1], bh * 0.45), material("cabin", INK["raised"], glow=0.2), bevel=3)
roof_m = material("roof", INK["accent"], glow=0.5, rough=0.5)
bpy.ops.mesh.primitive_cone_add(vertices=4, radius1=bw * 0.78, depth=bh * 0.45, location=(BOX[0], BOX[1], bh * 0.9 + bh * 0.22))
roof = bpy.context.object
roof.rotation_euler.z = math.pi / 4
roof.scale = (1.0, bh / bw, 1.0)
roof.data.materials.append(roof_m)
win_m = material("windows", INK["fg"], glow=0.0, rough=0.3)
windows = [mesh_box(f"window{k}", (bw * 0.18, 1.0, bh * 0.28), (BOX[0] + (k - 1) * bw * 0.27, BOX[1] - bh / 2 - 0.4, bh * 0.52), win_m) for k in range(3)]
box_parts = [cabin, roof, *windows]

# Stations: a ring on the track, its middle the base colour until its step merges.
STP = PART["station"]
stations = []
for i, y in enumerate(Y):
    row = []
    for j, x in enumerate(ST_X):
        ring_m = material(f"ring{i}{j}", INK["line2"], glow=0.4)
        fill_m = material(f"fill{i}{j}", INK["base"], glow=0.2)
        ring = cylinder(f"station{i}{j}", STP["r"] * 1.3, 5, (x, y, 4.5), ring_m)
        fill = cylinder(f"station{i}{j}-in", STP["r"] * 1.3 - STP["ring"] * 1.3, 5.4, (x, y, 4.7), fill_m)
        row.append((ring, fill, ring_m, fill_m))
    stations.append(row)

# Signals: a mast beside the track before the junction, a dark head, one lamp facing you.
SG = PART["signal"]
signals = []
for i, y in enumerate(Y):
    sx, sy = SIG_X, y + 22
    mast = cylinder(f"mast{i}", 1.4, SG["mast"] * 1.6, (sx, sy, SG["mast"] * 0.8), material(f"mast{i}", INK["fg3"]), verts=16)
    head = mesh_box(f"head{i}", (SG["w"] * 1.4, 9, SG["h"] * 1.4), (sx, sy, SG["mast"] * 1.6 + SG["h"] * 0.7), material(f"head{i}", INK["dark"], rough=0.4), bevel=3)
    lamp_m = material(f"lamp{i}", INK["line"], glow=0.0, rough=0.2)
    lamp = sphere(f"lamp{i}", SG["lamp"] * 1.4, (sx, sy - 4.6, SG["mast"] * 1.6 + SG["h"] * 0.9), lamp_m)
    signals.append({"parts": [mast, head, lamp], "lamp": lamp_m})

# Trains: one per track, the accent body with its head lamp, nose along the track.
TR = PART["train"]
trains = []
for i in range(3):
    body = mesh_box(f"train{i}", (TR["w"] * 1.3, TR["h"] * 1.3, 11), (0, 0, 0), material(f"train{i}", INK["accent"], glow=0.35, rough=0.4), bevel=TR["h"] * 0.5)
    head = sphere(f"trainlamp{i}", TR["lamp"] * 1.5, (TR["w"] * 0.62, 0, 6), material(f"trainlamp{i}", INK["fg"], glow=6.0))
    head.parent = body
    trains.append({"body": body, "lamp": head})

# Requests: a lit spark that runs from the signal box to its project's track.
sparks = [sphere(f"spark{i}", 5, (0, 0, 0), material(f"spark{i}", INK["accent"], glow=12.0)) for i in range(3)]
# A merge: a green ring that spreads where the train joins the main line.
pulse_m = material("pulse", INK["clear"], glow=4.0)
bpy.ops.mesh.primitive_torus_add(major_radius=14, minor_radius=1.6, location=(JUNCTION[0] + 40, 0, 4))
pulse = bpy.context.object
pulse.data.materials.append(pulse_m)

# Light: one soft key light from the top left, so the parts stand off the board.
sun = bpy.data.lights.new("sun", "SUN")
sun.energy = 2.2
sun.angle = math.radians(14)
so = bpy.data.objects.new("sun", sun)
scene.collection.objects.link(so)
so.rotation_euler = (math.radians(38), math.radians(-18), math.radians(-30))

cam_d = bpy.data.cameras.new("camera")
cam_d.lens = 32
cam = bpy.data.objects.new("camera", cam_d)
scene.collection.objects.link(cam)
scene.camera = cam
cam_d.clip_end = 20000

# The story. Each track: its train's stops along the track (by x), and when the signal goes grey, then clear or
# amber. The middle one waits for you at its signal until you answer.
SC = P["story"]["scenes"]
S = [s["at"] for s in SC]
REQ = [S[1] + 0.25 + i * 0.35 for i in range(3)]
ARRIVE = [r + 1.0 for r in REQ]
STOP = SIG_X - 34
PLAN = [
    # (time, x) where the train is at each time; between them it glides along the track.
    [(S[2] + 0.1, ST_X[0]), (S[2] + 1.0, ST_X[1]), (S[2] + 1.9, ST_X[2]), (S[2] + 2.6, STOP), (S[3] + 0.2, MAIN_END + 60)],
    [(S[2] + 0.4, ST_X[0]), (S[2] + 1.3, ST_X[1]), (S[2] + 2.2, ST_X[2]), (S[3] - 0.3, STOP), (S[4] + 0.9, MAIN_END + 60)],
    [(S[2] + 0.7, ST_X[0]), (S[2] + 1.6, ST_X[1]), (S[2] + 2.5, ST_X[2]), (S[3] + 0.5, STOP), (S[3] + 1.6, MAIN_END + 60)],
]
MOVE = 0.8
# Each signal: grey while its step is checked, then green, or amber for the one that asks you.
ASPECTS = [
    [(S[2] + 2.6, "check"), (S[3] - 0.1, "clear")],
    [(S[3] - 0.3, "check"), (S[3] + 0.2, "caution"), (S[4] + 0.4, "clear")],
    [(S[3] + 0.5, "check"), (S[3] + 1.2, "clear")],
]
LAMP = {"off": (INK["line"], 0.0), "check": (INK["fg2"], 1.2), "caution": (INK["caution"], 2.2), "clear": (INK["clear"], 1.8)}


def aspect_at(i, t):
    a = "off"
    for when, look in ASPECTS[i]:
        if t >= when:
            a = look
    return a


def train_x(i, t):
    plan = PLAN[i]
    if t < ARRIVE[i]:
        return None
    x = ST_X[0] - 60
    if t < plan[0][0]:
        return x + 60 * prog(t, ARRIVE[i], 0.5, "out")
    x = plan[0][1]
    for (t0, x0), (t1, x1) in zip(plan, plan[1:]):
        dur = MOVE if x1 <= STOP else 1.4
        start = t1 - dur
        if t >= start:
            x = x0 + (x1 - x0) * prog(t, start, dur, "inOut" if x1 <= STOP else "in")
    return x


def apply(t):
    # Laying the line: from the box out, each track in turn, along the layout's x.
    lay(spine, prog(t, 0.2, 0.9, "out"))
    lay(spine_down, prog(t, 0.35, 0.8, "out"))
    for i, r in enumerate(track_rails):
        lay(r, prog(t, 0.6 + i * 0.18, 1.6, "out"))
    lay(main, prog(t, 1.6, 0.9, "out"))
    for i, row in enumerate(stations):
        for j, (ring, fill, ring_m, fill_m) in enumerate(row):
            seen = prog(t, 0.8 + i * 0.18 + j * 0.25, LONG * 2, "out")
            for o in (ring, fill):
                o.scale = (max(seen, 0.001),) * 3
            x = train_x(i, t)
            passed = x is not None and x > ST_X[j] + 30
            at_it = x is not None and abs(x - ST_X[j]) < 30
            ring_c = INK["clear"] if passed else INK["fg"] if at_it else INK["line2"]
            paint(ring_m, ring_c, 1.2 if passed or at_it else 0.4)
            paint(fill_m, INK["clear"] if passed else INK["base"], 1.2 if passed else 0.2)
    for i, s in enumerate(signals):
        seen = prog(t, 1.4 + i * 0.15, LONG * 2, "out")
        for o in s["parts"]:
            o.scale = (max(seen, 0.001),) * 3
        colour, glow = LAMP[aspect_at(i, t)]
        # amber breathes slowly while it waits for you, as the views' lamp does
        if aspect_at(i, t) == "caution":
            glow *= 0.75 + 0.25 * math.cos((t - ASPECTS[i][1][0]) * 2 * math.pi / 1.4)
        paint(s["lamp"], colour, glow)
    # The box writes while requests leave it: its windows light up.
    writing = 1.0 if S[1] <= t < REQ[2] + 0.4 else 0.25 if t >= 0.4 else 0.0
    paint(win_m, INK["fg"], writing * 3.0)
    box_in = prog(t, 0.0, LONG * 2, "out")
    for o in box_parts:
        o.scale = (max(box_in, 0.001),) * 3 if o is not cabin else (max(box_in, 0.001),) * 3
    roof.scale = (box_in, box_in * bh / bw, box_in)
    # Requests: out of the box, along the spine, onto the track, where each becomes a train.
    for i, sp in enumerate(sparks):
        k = prog(t, REQ[i], ARRIVE[i] - REQ[i], "inOut")
        route = Path([(BOX[0] + 40, 0.0), (SPINE_X, 0.0), (SPINE_X, Y[i]), (ST_X[0] - 60, Y[i])])
        (x, y), _ = route.at(k * route.total)
        sp.location = (x, y, 10)
        sp.hide_render = not (REQ[i] <= t < ARRIVE[i] + 0.05)
    for i, tr in enumerate(trains):
        x = train_x(i, t)
        body = tr["body"]
        if x is None or x >= MAIN_END + 20:
            body.hide_render = tr["lamp"].hide_render = True
            continue
        body.hide_render = tr["lamp"].hide_render = False
        p = TRACKS[i]
        (px, py), h = p.at(p.dist_to_x(x))
        body.location = (px, py, 9)
        body.rotation_euler.z = h
        grow = prog(t, ARRIVE[i] - 0.05, LONG, "out")
        body.scale = (max(grow, 0.001),) * 3
    # The green ring where a train joins the main line.
    joins = [plan[-1][0] - 1.4 * 0.45 for plan in PLAN]
    k = max((prog(t, j, 0.7, "out") if j <= t < j + 0.7 else 0.0) for j in joins)
    pulse.scale = (1 + 1.6 * k,) * 3
    pulse.hide_render = k <= 0 or k >= 1
    paint(pulse_m, INK["clear"], 4.0 * (1 - k))
    # The camera drifts a little toward the line as the story goes on, and back for the loop.
    d = 0.5 - 0.5 * math.cos(2 * math.pi * t / LENGTH)
    cam.location = (40 - 30 * d, -900 + 70 * d, 860 - 60 * d)
    look = (20.0, 10.0, 0.0)
    dx, dy, dz = look[0] - cam.location.x, look[1] - cam.location.y, look[2] - cam.location.z
    cam.rotation_euler = (math.atan2(math.hypot(dx, dy), -dz), 0, math.atan2(dy, dx) - math.pi / 2)


os.makedirs(OUT, exist_ok=True)
frames = ONLY if ONLY is not None else range(int(round(LENGTH * FPS)))
for f in frames:
    # A frame already in OUT stays: a render that stopped goes on where it was. Each frame is written whole, then named.
    done = os.path.join(OUT, f"{f:04d}.png")
    if ONLY is None and os.path.exists(done):
        continue
    apply(f / FPS)
    scene.render.filepath = os.path.join(OUT, f"part-{f:04d}.png")
    bpy.ops.render.render(write_still=True)
    os.replace(scene.render.filepath, done)
    print(f"frame {f}", flush=True)
