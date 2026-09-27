# GrooveStar key art: Nova, posed from her game clips, with each game's props
# and venue lighting, rendered in Cycles.
#   blender -b -P keyart.py -- <game> <card|wide> <out.png> [scale] [samples]
import os, bpy, sys, math, random
from mathutils import Vector, Matrix
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import *

argv = sys.argv[sys.argv.index("--") + 1:]
GAME, VIEW, OUT = argv[0], argv[1], argv[2]
SCALE = float(argv[3]) if len(argv) > 3 else 1.0
SAMPLES = int(argv[4]) if len(argv) > 4 else 128
MOVES = os.path.join(os.path.dirname(os.path.abspath(__file__)), "../../../public/models/nova-moves.glb")
random.seed(11)

scn = reset()
W, H = (1200, 1800) if VIEW == "card" else (2400, 1350)
render_setup(scn, int(W * SCALE), int(H * SCALE), samples=SAMPLES, look="AgX - Punchy", exposure=0.0)


# ---------------------------------------------------------------- nova --
CLIP_FILES = {
    "D22": 22, "D23": 23, "D24": 24, "D63": 63, "D65": 65, "D67": 67, "D68": 68, "D69": 69, "D70": 70,
    "D71": 71, "D72": 72, "D73": 73, "D75": 75, "D76": 76, "D77": 77, "D78": 78, "D79": 79, "D80": 80,
    "D81": 81, "D83": 83, "Slash": 219, "SlashL": 97, "BladeSpin": 91, "JabL": 191, "JabR": 192,
    "HookL": 193, "Uppercut": 194, "BoxBounce": 87, "PunchPose": 376, "Sprint": 509, "RunFast": 16,
    "Jump": 463, "Slide": 516, "Swing": 323, "Throw": 239, "Victory": 412, "VictoryCheer": 59,
    "FistPump": 403, "JumpOpen": 460, "SpinJump": 397, "Wave": 28,
}
MESHY = os.path.expanduser(os.environ.get("GROOVESTAR_NOVA_SRC", "~/Claude-Pro/groovestar-primetime/meshy")).rstrip("/") + "/"


def load_nova(action, seconds, loc=(0, 0, 0), rot=0.0, airborne=False):
    """Import Meshy's skinned clip for `action` and pose it at `seconds`,
    then move the hips over `loc` so root motion doesn't drift the frame."""
    import os
    action = os.environ.get("KA_ACTION", action)
    seconds = float(os.environ.get("KA_T", seconds))
    rot = float(os.environ.get("KA_ROT", rot))
    path = MESHY + "anim2/a%d.glb" % CLIP_FILES[action]
    bpy.ops.import_scene.gltf(filepath=path)
    for o in list(bpy.data.objects):
        if o.name.startswith("Icosphere"):
            bpy.data.objects.remove(o)
    arm = next(o for o in bpy.data.objects if o.type == "ARMATURE")
    body = next(o for o in bpy.data.objects if o.type == "MESH" and o.parent == arm)
    scn.frame_set(int(round(seconds * scn.render.fps)))
    bpy.context.view_layer.update()
    arm.rotation_euler[2] += rot
    bpy.context.view_layer.update()
    hips = arm.matrix_world @ arm.pose.bones["Hips"].head
    arm.location.x += loc[0] - hips.x
    arm.location.y += loc[1] - hips.y
    bpy.context.view_layer.update()
    # feet on the floor (a jump keeps its height)
    if not airborne:
        low = min((arm.matrix_world @ arm.pose.bones[n].head).z for n in ("LeftToeBase", "RightToeBase", "LeftFoot", "RightFoot"))
        arm.location.z += loc[2] - low + 0.02
    bpy.context.view_layer.update()
    for m in body.data.materials:
        b = next((n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED"), None)
        if b:
            b.inputs["Roughness"].default_value = 0.55
            if "Specular IOR Level" in b.inputs:
                b.inputs["Specular IOR Level"].default_value = 0.35
            if "Sheen Weight" in b.inputs:
                b.inputs["Sheen Weight"].default_value = 0.25
            if "Emission Strength" in b.inputs:
                b.inputs["Emission Strength"].default_value = 0.0
    return arm, body


def bone(arm, name, tail=False):
    pb = arm.pose.bones[name]
    m = arm.matrix_world @ (pb.tail if tail else pb.head)
    return Vector(m)


def place(obj, at, direction, up=Vector((0, 0, 1))):
    """Point obj's local +Z along direction, centered at `at`."""
    d = direction.normalized()
    q = d.to_track_quat("Z", "Y")
    obj.matrix_world = Matrix.Translation(at) @ q.to_matrix().to_4x4()


# ------------------------------------------------------------- materials --
def glow(name, color, strength):
    return emit(name, color, strength)


def glossy(name, color, rough=0.25, metal=0.0, coat=0.6):
    m = mat(name, color, rough, metal)
    b = next(n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    if "Coat Weight" in b.inputs:
        b.inputs["Coat Weight"].default_value = coat
        b.inputs["Coat Roughness"].default_value = 0.08
    return m


def cyl(name, r, h, m, verts=32):
    bpy.ops.mesh.primitive_cylinder_add(vertices=verts, radius=r, depth=h)
    o = bpy.context.object
    o.name = name
    o.data.materials.append(m)
    return o


def sphere(name, r, m, loc=(0, 0, 0), seg=48):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=seg, ring_count=seg // 2, radius=r, location=loc)
    o = bpy.context.object
    o.name = name
    bpy.ops.object.shade_smooth()
    o.data.materials.append(m)
    return o


def capsule(name, r, length, m):
    """Blade-like capsule along +Z from 0 to length."""
    bpy.ops.mesh.primitive_cylinder_add(vertices=32, radius=r, depth=length, location=(0, 0, length / 2))
    o = bpy.context.object
    for z in (0, length):
        bpy.ops.mesh.primitive_uv_sphere_add(segments=32, ring_count=16, radius=r, location=(0, 0, z))
        s = bpy.context.object
        s.select_set(True)
        o.select_set(True)
        bpy.context.view_layer.objects.active = o
        bpy.ops.object.join()
    bpy.ops.object.shade_smooth()
    o.name = name
    o.data.materials.append(m)
    return o


def saber(hand_pos, direction, color, length=1.05):
    """A lightsaber: dark hilt at the fist, white-hot core in a colored glow."""
    g = []
    d = direction.normalized()
    hilt = cyl("hilt", 0.022, 0.24, glossy("hiltm", (0.05, 0.05, 0.06), 0.3, 0.9))
    place(hilt, hand_pos, d)
    emitter = cyl("emitter", 0.027, 0.03, glow("emit", color, 20))
    place(emitter, hand_pos + d * 0.12, d)
    core = capsule("core", 0.009, length, glow("core", (1, 1, 1), 60))
    place(core, hand_pos + d * 0.13, d)
    sheath = capsule("sheath", 0.022, length, glow("sheath", color, 16))
    place(sheath, hand_pos + d * 0.13, d)
    sheath.visible_shadow = False
    core.visible_shadow = False
    # light from the blade itself
    l = bpy.data.lights.new("bladelight", "POINT")
    l.energy = 140
    l.color = color
    l.shadow_soft_size = 0.4
    lo = link(bpy.data.objects.new("bladelight", l))
    lo.location = hand_pos + d * (0.13 + length * 0.5)
    return g


def neon_cube(loc, color, size=0.42, rot=(0.3, 0.5, 0.2), split=None):
    body = glossy("cubebody", tuple(c * 0.35 for c in color), 0.18, 0.2, 0.9)
    edge = glow("cubeedge", color, 14)
    arrow = glow("arrow", (1, 1, 1), 12)

    def one(offset, s):
        bpy.ops.mesh.primitive_cube_add(size=1, location=(0, 0, 0))
        c = bpy.context.object
        c.scale = s
        bpy.ops.object.transform_apply(scale=True)
        bev = c.modifiers.new("b", "BEVEL")
        bev.width = size * 0.12
        bev.segments = 4
        c.data.materials.append(body)
        # glowing edges: a wireframe shell
        bpy.ops.mesh.primitive_cube_add(size=1, location=(0, 0, 0))
        e = bpy.context.object
        e.scale = tuple(x * 1.01 for x in s)
        bpy.ops.object.transform_apply(scale=True)
        wf = e.modifiers.new("w", "WIREFRAME")
        wf.thickness = size * 0.05
        e.data.materials.append(edge)
        e.parent = c
        c.location = offset
        return c

    parts = []
    if split is None:
        c = one(Vector((0, 0, 0)), (size, size, size))
        # arrow chevron on the front face
        bpy.ops.mesh.primitive_plane_add(size=size * 0.55, location=(0, -size * 0.51, 0), rotation=(math.pi / 2, 0, 0))
        a = bpy.context.object
        a.data.materials.append(arrow)
        bpy.ops.object.mode_set(mode="EDIT")
        bpy.ops.object.mode_set(mode="OBJECT")
        a.parent = c
        parts.append(c)
    else:
        gap = split
        for s in (-1, 1):
            parts.append(one(Vector((s * (size / 4 + gap), 0, 0)), (size / 2, size, size)))
    holder = bpy.data.objects.new("cube", None)
    link(holder)
    for p in parts:
        p.parent = holder
    holder.location = loc
    holder.rotation_euler = rot
    return holder


# ----------------------------------------------------------- environment --
def floor(color=(0.01, 0.008, 0.02), rough=0.12):
    bpy.ops.mesh.primitive_plane_add(size=80, location=(0, 0, 0))
    f = bpy.context.object
    f.data.materials.append(glossy("floor", color, rough, 0.3, 0.5))
    return f


def beams(colors, z=7.5, y=6.0, spread=9.0, n=6, power=16000, angle=6, target_z=0.0, target_y=1.0):
    for i in range(n):
        x = (i / max(1, n - 1) - 0.5) * spread
        c = colors[i % len(colors)]
        spot("beam%d" % i, (x, y, z), (x * 0.25, target_y, target_z), c, power, angle=angle, blend=0.15, radius=0.02)


def bokeh(colors, n=60, area_=(-9, 9, 6, 16, 0.5, 7), size=(0.05, 0.14), strength=30):
    x0, x1, y0, y1, z0, z1 = area_
    for i in range(n):
        c = colors[i % len(colors)]
        sphere("bk", random.uniform(*size), glow("bk%d" % i, c, strength * random.uniform(0.4, 1.0)), loc=(random.uniform(x0, x1), random.uniform(y0, y1), random.uniform(z0, z1)), seg=12)


def led_wall(colors, loc=(0, 9, 3.5), size=(16, 7), rays=14, power=3.0):
    """A sunburst LED wall behind the stage."""
    bpy.ops.mesh.primitive_plane_add(size=1, location=loc, rotation=(math.pi / 2, 0, 0))
    p = bpy.context.object
    p.scale = (size[0], size[1], 1)
    m = bpy.data.materials.new("ledwall")
    m.use_nodes = True
    nt = m.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    tc = nt.nodes.new("ShaderNodeTexCoord")
    sep = nt.nodes.new("ShaderNodeSeparateXYZ")
    nt.links.new(tc.outputs["Generated"], sep.inputs[0])
    # angle around the center
    sx = nt.nodes.new("ShaderNodeMath"); sx.operation = "SUBTRACT"; sx.inputs[1].default_value = 0.5
    sy = nt.nodes.new("ShaderNodeMath"); sy.operation = "SUBTRACT"; sy.inputs[1].default_value = 0.5
    nt.links.new(sep.outputs[0], sx.inputs[0]); nt.links.new(sep.outputs[1], sy.inputs[0])
    sy2 = nt.nodes.new("ShaderNodeMath"); sy2.operation = "MULTIPLY"; sy2.inputs[1].default_value = size[1] / size[0]
    nt.links.new(sy.outputs[0], sy2.inputs[0])
    at = nt.nodes.new("ShaderNodeMath"); at.operation = "ARCTAN2"
    nt.links.new(sy2.outputs[0], at.inputs[0]); nt.links.new(sx.outputs[0], at.inputs[1])
    mul = nt.nodes.new("ShaderNodeMath"); mul.operation = "MULTIPLY"; mul.inputs[1].default_value = rays / (2 * math.pi)
    nt.links.new(at.outputs[0], mul.inputs[0])
    fr = nt.nodes.new("ShaderNodeMath"); fr.operation = "FRACT"
    nt.links.new(mul.outputs[0], fr.inputs[0])
    st = nt.nodes.new("ShaderNodeMath"); st.operation = "GREATER_THAN"; st.inputs[1].default_value = 0.5
    nt.links.new(fr.outputs[0], st.inputs[0])
    mix = nt.nodes.new("ShaderNodeMix"); mix.data_type = "RGBA"
    mix.inputs[6].default_value = (*colors[0], 1)
    mix.inputs[7].default_value = (*colors[1], 1)
    nt.links.new(st.outputs[0], mix.inputs[0])
    # radial falloff
    ln = nt.nodes.new("ShaderNodeVectorMath"); ln.operation = "LENGTH"
    comb = nt.nodes.new("ShaderNodeCombineXYZ")
    nt.links.new(sx.outputs[0], comb.inputs[0]); nt.links.new(sy2.outputs[0], comb.inputs[1])
    nt.links.new(comb.outputs[0], ln.inputs[0])
    fall = nt.nodes.new("ShaderNodeMapRange")
    fall.inputs[1].default_value = 0.0; fall.inputs[2].default_value = 0.6
    fall.inputs[3].default_value = 1.0; fall.inputs[4].default_value = 0.15
    nt.links.new(ln.outputs["Value"], fall.inputs[0])
    em = nt.nodes.new("ShaderNodeEmission")
    nt.links.new(mix.outputs[2], em.inputs[0])
    sm = nt.nodes.new("ShaderNodeMath"); sm.operation = "MULTIPLY"; sm.inputs[1].default_value = power
    nt.links.new(fall.outputs[0], sm.inputs[0])
    nt.links.new(sm.outputs[0], em.inputs[1])
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    nt.links.new(em.outputs[0], out.inputs[0])
    p.data.materials.append(m)
    return p


def compositor(bloom=0.8, threshold=1.0):
    nt = getattr(scn, "compositing_node_group", None)
    if nt is None and hasattr(scn, "compositing_node_group"):
        nt = bpy.data.node_groups.new("Compositor", "CompositorNodeTree")
        scn.compositing_node_group = nt
    elif nt is None:
        scn.use_nodes = True
        nt = scn.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    rl = nt.nodes.new("CompositorNodeRLayers")
    gl = nt.nodes.new("CompositorNodeGlare")
    for k, v in (("glare_type", "BLOOM"), ("threshold", threshold), ("mix", 0.0), ("size", 8), ("quality", "HIGH")):
        try:
            setattr(gl, k, v)
        except Exception as e:
            print("glare attr", k, e)
    for sock in gl.inputs:
        print("glare input", sock.name)
    for name, v in (("Threshold", threshold), ("Strength", bloom), ("Size", 0.7), ("Type", "Bloom"), ("Quality", "High")):
        if name in gl.inputs:
            try:
                gl.inputs[name].default_value = v
            except Exception as e:
                print("glare input err", name, e)
    try:
        out = nt.nodes.new("CompositorNodeComposite")
        nt.links.new(gl.outputs[0], out.inputs[0])
    except Exception:
        if not any(i.in_out == "OUTPUT" for i in nt.interface.items_tree):
            nt.interface.new_socket("Image", in_out="OUTPUT", socket_type="NodeSocketColor")
        out = nt.nodes.new("NodeGroupOutput")
        nt.links.new(gl.outputs[0], out.inputs[0])
    nt.links.new(rl.outputs[0], gl.inputs[0])


# ----------------------------------------------------------------- games --
def key_lights(rimA, rimB, key=(1.0, 0.93, 0.86), key_power=260, rim_power=520, target=(0, 0, 1.0)):
    area("key", (-1.5, -3.8, 2.7), target, key, key_power * 1.6, 1.8)
    area("rimL", (-2.6, 2.4, 2.8), target, rimA, rim_power, 0.8)
    area("rimR", (2.6, 2.2, 2.6), target, rimB, rim_power, 0.8)
    area("fill", (2.8, -3.0, 0.6), target, (0.55, 0.5, 1.0), 60, 2.0)


def truss(y=6.0, z=6.2, width=12):
    m = glossy("truss", (0.02, 0.02, 0.025), 0.4, 0.8, 0)
    box("trussbar", (width, 0.25, 0.25), (0, y, z), m)
    box("trussbar2", (width, 0.25, 0.25), (0, y + 0.6, z), m)


def glow_disc(loc, radius, color, strength, falloff=2.0, rot=(math.pi / 2, 0, 0)):
    """A soft radial glow card (emission fading to the rim)."""
    bpy.ops.mesh.primitive_circle_add(vertices=96, radius=radius, fill_type="TRIFAN", location=loc, rotation=rot)
    o = bpy.context.object
    m = bpy.data.materials.new("glowdisc")
    m.use_nodes = True
    nt = m.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    tc = nt.nodes.new("ShaderNodeTexCoord")
    ln = nt.nodes.new("ShaderNodeVectorMath"); ln.operation = "LENGTH"
    nt.links.new(tc.outputs["Object"], ln.inputs[0])
    mr = nt.nodes.new("ShaderNodeMapRange")
    mr.inputs[1].default_value = 0.0; mr.inputs[2].default_value = radius
    mr.inputs[3].default_value = 1.0; mr.inputs[4].default_value = 0.0
    nt.links.new(ln.outputs["Value"], mr.inputs[0])
    pw = nt.nodes.new("ShaderNodeMath"); pw.operation = "POWER"; pw.inputs[1].default_value = falloff
    nt.links.new(mr.outputs[0], pw.inputs[0])
    sm = nt.nodes.new("ShaderNodeMath"); sm.operation = "MULTIPLY"; sm.inputs[1].default_value = strength
    nt.links.new(pw.outputs[0], sm.inputs[0])
    em = nt.nodes.new("ShaderNodeEmission")
    em.inputs[0].default_value = (*color, 1)
    nt.links.new(sm.outputs[0], em.inputs[1])
    tr = nt.nodes.new("ShaderNodeBsdfTransparent")
    add = nt.nodes.new("ShaderNodeAddShader")
    nt.links.new(em.outputs[0], add.inputs[0]); nt.links.new(tr.outputs[0], add.inputs[1])
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    nt.links.new(add.outputs[0], out.inputs[0])
    try:
        m.surface_render_method = "BLENDED"
    except Exception:
        pass
    o.data.materials.append(m)
    o.visible_shadow = False
    return o


def neon_ring(loc, radius, color, strength, thick=0.05, segs=128, rot=(math.pi / 2, 0, 0)):
    bpy.ops.mesh.primitive_torus_add(major_radius=radius, minor_radius=thick, major_segments=segs, minor_segments=12, location=loc, rotation=rot)
    o = bpy.context.object
    o.data.materials.append(glow("ring", color, strength))
    o.visible_shadow = False
    return o


def game_dance():
    world(scn, (0.001, 0.0005, 0.003), 1.0, volume=0.006, anisotropy=0.7)
    arm, body = load_nova("D79", 2.0)
    floor((0.004, 0.003, 0.01), 0.14)
    magenta, gold, cyan = (1.0, 0.08, 0.5), (1.0, 0.62, 0.1), (0.1, 0.75, 1.0)
    # portal behind her: a soft magenta bloom, a gold ring and a thin cyan ring
    glow_disc((0, 3.4, 1.55), 2.2, magenta, 1.1, falloff=2.2)
    neon_ring((0, 3.0, 1.55), 1.32, gold, 16, 0.035)
    neon_ring((0, 3.05, 1.55), 1.5, cyan, 9, 0.012)
    neon_ring((0, 3.1, 1.55), 1.14, magenta, 8, 0.01)
    truss(6.4, 5.6, 14)
    cols = [magenta, cyan, gold]
    for i, x in enumerate([-5.5, -3.2, -1.1, 1.1, 3.2, 5.5]):
        spot("beam%d" % i, (x, 6.2, 5.2), (x * 0.15, 0.5, 0.0), cols[i % 3], 90000, angle=3.5, blend=0.1, radius=0.02)
    key_lights(cyan, magenta, key_power=300, rim_power=1100, target=(0, 0, 1.1))
    # far bokeh
    random.seed(3)
    for i in range(70):
        c = cols[i % 3]
        sphere("bk", random.uniform(0.04, 0.1), glow("bk%d" % i, c, random.uniform(8, 25)), loc=(random.uniform(-9, 9), random.uniform(8, 16), random.uniform(0.5, 7)), seg=12)
    cols = [(1, 0.15, 0.55), (0.15, 0.8, 1), (1, 0.75, 0.15), (1, 1, 1)]
    for i in range(200):
        bpy.ops.mesh.primitive_plane_add(size=0.045, location=(random.uniform(-3.2, 3.2), random.uniform(-2.8, 3.0), random.uniform(0.1, 4.2)), rotation=(random.random() * 6, random.random() * 6, random.random() * 6))
        c = bpy.context.object
        c.scale = (1, 0.5, 1)
        c.data.materials.append(glossy("cf%d" % (i % 4), cols[i % 4], 0.3, 0.7, 0))
    return arm, (0, 0, 1.0)


def portal(colors, center_z=1.55, y=3.0, r=1.32, glow_col=None, glow_k=1.1):
    a, b, c = colors
    glow_disc((0, y + 0.4, center_z), r * 1.66, glow_col or a, glow_k, falloff=2.2)
    neon_ring((0, y, center_z), r, b, 16, 0.035)
    neon_ring((0, y + 0.05, center_z), r * 1.14, c, 9, 0.012)
    neon_ring((0, y + 0.1, center_z), r * 0.86, a, 8, 0.01)


def stage_common(cols, beams_power=90000):
    truss(6.4, 5.6, 14)
    for i, x in enumerate([-5.5, -3.2, -1.1, 1.1, 3.2, 5.5]):
        spot("beam%d" % i, (x, 6.2, 5.2), (x * 0.15, 0.5, 0.0), cols[i % len(cols)], beams_power, angle=3.5, blend=0.1, radius=0.02)
    random.seed(3)
    for i in range(70):
        c = cols[i % len(cols)]
        sphere("bk", random.uniform(0.04, 0.1), glow("bk%d" % i, c, random.uniform(8, 25)), loc=(random.uniform(-9, 9), random.uniform(8, 16), random.uniform(0.5, 7)), seg=12)


def sparks(at, color, n=40, spread=0.6, length=(0.05, 0.16), strength=30):
    m = glow("spark", color, strength)
    for i in range(n):
        d = Vector((random.uniform(-1, 1), random.uniform(-1, 1), random.uniform(-1, 1))).normalized()
        L = random.uniform(*length)
        o = cyl("sp", 0.004, L, m, verts=6)
        place(o, Vector(at) + d * random.uniform(0.05, spread), d)
        o.visible_shadow = False


def game_blade():
    world(scn, (0.0008, 0.0008, 0.003), 1.0, volume=0.006, anisotropy=0.7)
    arm, body = load_nova("BladeSpin", 1.42, rot=-0.55)
    floor((0.003, 0.003, 0.008), 0.1)
    blue, red, white = (0.1, 0.38, 1.0), (1.0, 0.08, 0.22), (0.85, 0.9, 1.0)
    # twin portal: blue and red rings, tilted like a square gate
    glow_disc((0, 3.4, 1.45), 2.3, (0.25, 0.05, 0.5), 1.0, falloff=2.2)
    bpy.ops.mesh.primitive_torus_add(major_radius=1.55, minor_radius=0.03, major_segments=4, minor_segments=8, location=(0, 3.0, 1.45), rotation=(math.pi / 2, math.pi / 4, 0))
    bpy.context.object.data.materials.append(glow("sq1", blue, 18))
    bpy.ops.mesh.primitive_torus_add(major_radius=1.8, minor_radius=0.02, major_segments=4, minor_segments=8, location=(0, 3.3, 1.45), rotation=(math.pi / 2, math.pi / 4 + 0.35, 0))
    bpy.context.object.data.materials.append(glow("sq2", red, 14))
    for i in range(6):
        bpy.ops.mesh.primitive_torus_add(major_radius=2.2 + i * 0.05, minor_radius=0.015, major_segments=4, minor_segments=6, location=(0, 5 + i * 2.6, 1.8), rotation=(math.pi / 2, math.pi / 4 + i * 0.18, 0))
        bpy.context.object.data.materials.append(glow("tun%d" % i, red if i % 2 else blue, 6 - i * 0.7))
    stage_common([blue, red, white])
    for side, col in (("Left", blue), ("Right", red)):
        hand = bone(arm, side + "Hand")
        fore = bone(arm, side + "ForeArm")
        d = (hand - fore).normalized()
        if side == "Left":
            blade_dir = (d * 0.45 + Vector((0, -0.35, 0.85))).normalized()
        else:
            blade_dir = (d * 0.3 + Vector((-0.75, -0.55, 0.35))).normalized()
        saber(hand + d * 0.03, blade_dir, col)
    neon_cube((0.95, -1.1, 2.05), red, 0.3, rot=(0.5, 0.2, 0.8), split=0.07)
    sparks((0.95, -1.1, 2.05), (1.0, 0.6, 0.4), 36, 0.35)
    neon_cube((-1.05, 0.6, 2.6), blue, 0.26, rot=(0.2, -0.5, 0.3))
    key_lights(blue, red, key_power=200, rim_power=1200, target=(0, 0, 1.0))
    return arm, (0, 0, 0.95)


def glove(hand, fore, color):
    d = (hand - fore).normalized()
    m = glossy("glove", color, 0.28, 0.0, 0.7)
    wm = glossy("cuff", (0.95, 0.95, 0.95), 0.4, 0.0, 0.3)
    center = hand + d * 0.07
    g = sphere("glovebody", 0.105, m, loc=center)
    place(g, center, d)
    g.scale = (1.0, 0.85, 1.25)
    t = sphere("thumb", 0.045, m, loc=center)
    t.location = center + Vector((0, -0.07, 0)) + d * 0.02
    c = cyl("cuff", 0.07, 0.1, wm)
    place(c, hand - d * 0.04, d)
    return g


def game_box():
    world(scn, (0.002, 0.0008, 0.0006), 1.0, volume=0.006, anisotropy=0.7)
    arm, body = load_nova("JabR", 0.5, rot=-0.6)
    floor((0.008, 0.003, 0.003), 0.14)
    red, gold, white = (1.0, 0.1, 0.06), (1.0, 0.6, 0.08), (1.0, 0.95, 0.9)
    # ring ropes glowing behind her
    glow_disc((0, 3.4, 1.5), 2.3, (0.6, 0.05, 0.02), 1.2, falloff=2.2)
    for k, z in enumerate([0.55, 1.0, 1.45]):
        o = cyl("rope", 0.025, 9, glow("rope%d" % k, red if k != 1 else white, 10 if k != 1 else 6))
        o.rotation_euler = (0, math.pi / 2, 0)
        o.location = (0, 2.6, z)
    for x in (-3.2, 3.2):
        post = cyl("post", 0.09, 1.9, glossy("post", (0.05, 0.05, 0.06), 0.3, 0.8))
        post.location = (x, 2.6, 0.95)
    neon_ring((0, 3.1, 1.6), 1.35, gold, 14, 0.03)
    stage_common([red, gold, white])
    for side in ("Left", "Right"):
        glove(bone(arm, side + "Hand"), bone(arm, side + "ForeArm"), (0.8, 0.02, 0.04))
    # impact burst at the leading fist
    lh, rh = bone(arm, "LeftHand"), bone(arm, "RightHand")
    lead = lh if lh.y < rh.y else rh
    sparks(lead + Vector((0.25, -0.45, -0.1)), (1.0, 0.75, 0.3), 36, 0.3, (0.05, 0.16), 40)
    glow_disc(lead + Vector((0.25, -0.5, -0.1)), 0.22, (1.0, 0.7, 0.3), 5, falloff=3, rot=(math.pi / 2, 0, 0))
    key_lights((1.0, 0.55, 0.2), (1.0, 0.1, 0.2), key_power=300, rim_power=1000, target=(0, 0, 1.1))
    return arm, (0, 0, 1.0)


def coin(loc, rot):
    o = cyl("coin", 0.075, 0.014, glossy("gold", (1.0, 0.62, 0.12), 0.18, 1.0, 0.2), verts=40)
    o.location = loc
    o.rotation_euler = rot
    return o


def game_rush():
    world(scn, (0.0015, 0.001, 0.003), 1.0, volume=0.006, anisotropy=0.7)
    arm, body = load_nova("JumpOpen", 1.65, rot=0.0, airborne=True)
    floor((0.01, 0.008, 0.012), 0.08)
    gold, orange, cyan = (1.0, 0.65, 0.1), (1.0, 0.3, 0.05), (0.1, 0.75, 1.0)
    # speed tunnel: rectangles rushing toward the camera
    glow_disc((0, 3.4, 1.5), 2.3, (0.6, 0.22, 0.02), 1.1, falloff=2.2)
    for i in range(7):
        bpy.ops.mesh.primitive_torus_add(major_radius=1.6 + i * 0.25, minor_radius=0.018, major_segments=4, minor_segments=6, location=(0, 2.4 + i * 2.0, 1.6), rotation=(math.pi / 2, math.pi / 4, 0))
        bpy.context.object.data.materials.append(glow("sq%d" % i, gold if i % 2 else cyan, 12 - i))
    stage_common([gold, orange, cyan])
    # speed lines streaming past
    m = glow("streak", (1.0, 0.85, 0.6), 12)
    for i in range(46):
        x, z = random.uniform(-2.8, 2.8), random.uniform(0.1, 3.6)
        if abs(x) < 0.7 and z < 2.0:
            continue
        o = cyl("streak", 0.006, random.uniform(0.6, 2.2), m, verts=6)
        o.rotation_euler = (math.pi / 2, 0, 0)
        o.location = (x, random.uniform(-1.5, 3), z)
    for p in [(-0.95, -1.2, 2.5), (0.9, -0.9, 2.75), (-0.75, -0.6, 1.2), (1.05, -1.3, 1.5), (0.35, -1.6, 3.1)]:
        c = coin(p, (random.uniform(0.6, 1.4), random.uniform(0, 3), random.uniform(0, 3)))
        c.scale = (1.4, 1.4, 1.4)
    key_lights(cyan, orange, key_power=320, rim_power=1000, target=(0, 0, 1.7))
    return arm, (0, 0, bone(arm, "Hips").z + 0.05)


def fruit(kind, loc, r, rot=(0, 0, 0), half=None):
    """Stylized fruit; half = None or +1/-1 for a sliced half with flesh."""
    if kind == "melon":
        rind = mat("melonrind", (0.05, 0.35, 0.08), 0.35)
        # stripes
        nt = rind.node_tree
        b = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
        wv = nt.nodes.new("ShaderNodeTexWave"); wv.inputs["Scale"].default_value = 3.0; wv.inputs["Distortion"].default_value = 4.0
        wv.wave_type = "BANDS"; wv.bands_direction = "Z"
        rp = nt.nodes.new("ShaderNodeValToRGB")
        rp.color_ramp.elements[0].color = (0.02, 0.18, 0.04, 1); rp.color_ramp.elements[1].color = (0.12, 0.5, 0.12, 1)
        nt.links.new(wv.outputs["Fac"], rp.inputs[0]); nt.links.new(rp.outputs[0], b.inputs["Base Color"])
        flesh = glossy("melonflesh", (0.95, 0.08, 0.15), 0.25, 0, 0.8)
    elif kind == "orange":
        rind = glossy("orangerind", (1.0, 0.35, 0.02), 0.45, 0, 0.3)
        flesh = glossy("orangeflesh", (1.0, 0.55, 0.05), 0.3, 0, 0.6)
    elif kind == "lime":
        rind = glossy("limerind", (0.25, 0.8, 0.05), 0.4, 0, 0.3)
        flesh = glossy("limeflesh", (0.75, 1.0, 0.3), 0.3, 0, 0.6)
    else:
        rind = glossy("berryrind", (0.45, 0.05, 0.8), 0.3, 0, 0.5)
        flesh = glossy("berryflesh", (0.9, 0.5, 1.0), 0.3, 0, 0.6)
    o = sphere(kind, r, rind, loc=loc, seg=48)
    if half:
        bis = o.modifiers.new("half", "BOOLEAN")
        bpy.ops.mesh.primitive_cube_add(size=r * 2.4, location=(loc[0] + half * r * 1.2, loc[1], loc[2]))
        cut = bpy.context.object
        cut.hide_render = True
        bis.object = cut
        bis.operation = "DIFFERENCE"
        bpy.ops.mesh.primitive_circle_add(vertices=48, radius=r * 0.96, fill_type="NGON", location=loc, rotation=(0, math.pi / 2, 0))
        disc = bpy.context.object
        disc.data.materials.append(flesh)
        disc.parent = o
        disc.matrix_parent_inverse = o.matrix_world.inverted()
    o.rotation_euler = rot
    return o


def juice(at, color, n=30, spread=0.5):
    m = glossy("juice", color, 0.05, 0, 1.0)
    for i in range(n):
        d = Vector((random.uniform(-1, 1), random.uniform(-0.6, 0.6), random.uniform(-0.5, 1))).normalized()
        o = sphere("drop", random.uniform(0.006, 0.016), m, loc=Vector(at) + d * random.uniform(0.08, spread), seg=16)
        o.scale = (1, 1, 2.2)
        o.rotation_euler = d.to_track_quat("Z", "Y").to_euler()


def game_fruit():
    world(scn, (0.002, 0.0012, 0.0006), 1.0, volume=0.006, anisotropy=0.7)
    arm, body = load_nova("Slash", 0.68, rot=-0.3)
    floor((0.012, 0.006, 0.003), 0.2)
    warm, lime, pink = (1.0, 0.55, 0.15), (0.45, 1.0, 0.15), (1.0, 0.2, 0.5)
    glow_disc((0, 3.4, 1.5), 2.3, (0.7, 0.3, 0.05), 1.2, falloff=2.2)
    neon_ring((0, 3.0, 1.55), 1.32, warm, 14, 0.035)
    neon_ring((0, 3.05, 1.55), 1.5, lime, 8, 0.012)
    stage_common([warm, lime, pink])
    # a blade of light swept from the raised hand
    hand = bone(arm, "LeftHand") if bone(arm, "LeftHand").z > bone(arm, "RightHand").z else bone(arm, "RightHand")
    cd = bpy.data.curves.new("slash", "CURVE")
    cd.dimensions = "3D"
    cd.bevel_depth = 0.018
    cd.bevel_resolution = 4
    sp = cd.splines.new("POLY")
    pts = []
    for i in range(48):
        a = -1.1 + i * 0.05
        pts.append(hand + Vector((math.sin(a) * 1.0 + 0.1, -0.35, math.cos(a) * 1.0 - 0.95)))
    sp.points.add(len(pts) - 1)
    for i, p in enumerate(pts):
        sp.points[i].co = (p.x, p.y, p.z, 1)
        sp.points[i].radius = 0.15 + 1.1 * (i / len(pts))
    co = link(bpy.data.objects.new("slash", cd))
    co.data.materials.append(glow("slashm", (1.0, 0.93, 0.75), 22))
    co.visible_shadow = False
    fruit("melon", (0.45, -1.1, 1.62), 0.16, rot=(0.25, 0, -1.2), half=1)
    fruit("melon", (0.72, -1.08, 1.5), 0.16, rot=(0.1, 0.3, 1.6), half=-1)
    juice((0.58, -1.1, 1.56), (0.95, 0.04, 0.12), 26, 0.4)
    fruit("orange", (0.72, -0.5, 0.72), 0.11, rot=(0.2, 0, 0.4))
    fruit("orange", (-0.85, -1.0, 2.3), 0.15, rot=(0.4, 0.2, 0))
    fruit("lime", (-0.95, -0.4, 0.75), 0.12, rot=(0.1, 0.2, 0))
    fruit("berry", (1.0, -0.3, 2.6), 0.1, rot=(0.1, 0.2, 0))
    key_lights(warm, pink, key_power=320, rim_power=950, target=(0, 0, 1.1))
    return arm, (0, 0, 1.0)


def racket(hand, fore):
    """Racket in the fist: handle along the forearm line, oval head beyond it,
    real strings (thin bars) so it never reads as a paddle."""
    d = (hand - fore).normalized()
    frame_m = glossy("racketframe", (0.1, 0.95, 0.45), 0.25, 0.3, 0.8)
    handle = cyl("handle", 0.017, 0.22, glossy("grip", (0.04, 0.04, 0.05), 0.6))
    place(handle, hand + d * 0.06, d)
    head_c = hand + d * 0.34
    holder = bpy.data.objects.new("rackethead", None)
    link(holder)
    bpy.ops.mesh.primitive_torus_add(major_radius=0.13, minor_radius=0.011, major_segments=56, minor_segments=10)
    ring = bpy.context.object
    ring.scale = (1, 1.3, 1)
    ring.data.materials.append(frame_m)
    ring.parent = holder
    sm = glossy("strings", (0.92, 0.96, 1.0), 0.35, 0, 0)
    for i in range(-5, 6):
        x = i * 0.022
        half = 0.169 * math.sqrt(max(0.0, 1 - (x / 0.13) ** 2))
        st = cyl("str", 0.0012, half * 2, sm, verts=6)
        st.rotation_euler = (math.pi / 2, 0, 0)
        st.location = (x, 0, 0)
        st.parent = holder
    for j in range(-7, 8):
        y = j * 0.022
        half = 0.13 * math.sqrt(max(0.0, 1 - (y / 0.169) ** 2))
        st = cyl("str", 0.0012, half * 2, sm, verts=6)
        st.rotation_euler = (0, math.pi / 2, 0)
        st.location = (0, y, 0)
        st.parent = holder
    # head plane: long axis continues the handle, strings face the camera
    z = Vector((0, -1, 0))
    yax = (d - z * d.dot(z)).normalized()
    xax = yax.cross(z)
    holder.matrix_world = Matrix.Translation(head_c) @ Matrix((xax, yax, z)).transposed().to_4x4()
    return head_c


def game_tennis():
    world(scn, (0.0008, 0.0015, 0.002), 1.0, volume=0.006, anisotropy=0.7)
    arm, body = load_nova("Slash", 0.45, rot=0.9)
    floor((0.004, 0.01, 0.012), 0.12)
    lime, cyan, white = (0.55, 1.0, 0.1), (0.1, 0.85, 1.0), (1, 1, 1)
    glow_disc((0, 3.4, 1.5), 2.3, (0.05, 0.4, 0.35), 1.1, falloff=2.2)
    neon_ring((0, 3.0, 1.55), 1.32, lime, 14, 0.035)
    neon_ring((0, 3.05, 1.55), 1.5, cyan, 8, 0.012)
    stage_common([lime, cyan, white])
    hands = [bone(arm, "RightHand"), bone(arm, "LeftHand")]
    fores = [bone(arm, "RightForeArm"), bone(arm, "LeftForeArm")]
    k = 0 if hands[0].x < hands[1].x else 1
    head = racket(hands[k], fores[k])
    # the ball leaving the strings, with a short streak
    ball_at = head + Vector((0.32, -0.55, 0.12))
    sphere("ball", 0.06, glow("ballm", (0.85, 1.0, 0.2), 8), loc=ball_at)
    tm = glow("balltrail", (0.7, 1.0, 0.25), 3)
    for i in range(1, 14):
        sphere("tr", 0.055 * (1 - i / 15), tm, loc=ball_at - Vector((0.05, -0.08, 0.012)) * i, seg=12).visible_shadow = False
    key_lights(cyan, lime, key_power=320, rim_power=950, target=(0, 0, 1.1))
    return arm, (0, 0, 1.0)


def pin(loc, rot=(0, 0, 0), s=1.0):
    prof = [(0.0, 0.0), (0.028, 0.0), (0.034, 0.03), (0.045, 0.1), (0.048, 0.15), (0.04, 0.22), (0.022, 0.28), (0.02, 0.31), (0.028, 0.35), (0.026, 0.38), (0.0, 0.39)]
    me = bpy.data.meshes.new("pinprof")
    verts = [(x * s, 0, z * s) for x, z in prof]
    edges = [(i, i + 1) for i in range(len(verts) - 1)]
    me.from_pydata(verts, edges, [])
    o = bpy.data.objects.new("pin", me)
    link(o)
    sc = o.modifiers.new("lathe", "SCREW")
    sc.axis = "Z"
    sc.steps = 32
    sc.render_steps = 32
    m = glossy("pinm", (0.95, 0.95, 0.95), 0.2, 0, 0.8)
    o.data.materials.append(m)
    o.location = loc
    o.rotation_euler = rot
    bpy.context.view_layer.objects.active = o
    bpy.ops.object.shade_smooth()
    # red neck stripe
    st = cyl("stripe", 0.0235 * s, 0.018 * s, glow("pinstripe", (1.0, 0.1, 0.2), 2), verts=24)
    st.location = (0, 0, 0.31 * s)
    st.parent = o
    return o


def galaxy_ball(loc, r):
    m = bpy.data.materials.new("galaxy")
    m.use_nodes = True
    nt = m.node_tree
    b = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
    nz = nt.nodes.new("ShaderNodeTexNoise"); nz.inputs["Scale"].default_value = 4; nz.inputs["Detail"].default_value = 8
    rp = nt.nodes.new("ShaderNodeValToRGB")
    rp.color_ramp.elements[0].color = (0.02, 0.0, 0.08, 1); rp.color_ramp.elements[1].color = (0.5, 0.1, 0.9, 1)
    e = rp.color_ramp.elements.new(0.6); e.color = (0.05, 0.3, 0.9, 1)
    nt.links.new(nz.outputs["Fac"], rp.inputs[0]); nt.links.new(rp.outputs[0], b.inputs["Base Color"])
    vo = nt.nodes.new("ShaderNodeTexVoronoi"); vo.inputs["Scale"].default_value = 60
    st = nt.nodes.new("ShaderNodeMath"); st.operation = "LESS_THAN"; st.inputs[1].default_value = 0.05
    nt.links.new(vo.outputs["Distance"], st.inputs[0])
    sm = nt.nodes.new("ShaderNodeMath"); sm.operation = "MULTIPLY"; sm.inputs[1].default_value = 12
    nt.links.new(st.outputs[0], sm.inputs[0])
    b.inputs["Emission Color"].default_value = (1, 1, 1, 1)
    nt.links.new(sm.outputs[0], b.inputs["Emission Strength"])
    b.inputs["Roughness"].default_value = 0.08
    if "Coat Weight" in b.inputs:
        b.inputs["Coat Weight"].default_value = 1.0
    return sphere("bball", r, m, loc=loc, seg=64)


def game_bowl():
    world(scn, (0.0015, 0.0006, 0.004), 1.0, volume=0.006, anisotropy=0.7)
    arm, body = load_nova("Throw", 2.03, rot=-0.45)
    floor((0.006, 0.003, 0.012), 0.06)
    violet, cyan, gold = (0.55, 0.15, 1.0), (0.1, 0.8, 1.0), (1.0, 0.7, 0.2)
    glow_disc((0, 3.4, 1.4), 2.3, (0.35, 0.05, 0.6), 1.3, falloff=2.2)
    neon_ring((0, 3.0, 1.45), 1.32, violet, 14, 0.035)
    neon_ring((0, 3.05, 1.45), 1.5, cyan, 8, 0.012)
    # stars
    for i in range(120):
        sphere("star", random.uniform(0.004, 0.012), glow("st", (1, 1, 1), 30), loc=(random.uniform(-4, 4), random.uniform(3.5, 9), random.uniform(0.2, 5)), seg=8)
    stage_common([violet, cyan, gold])
    hands = [bone(arm, "RightHand"), bone(arm, "LeftHand")]
    k = 0 if hands[0].z < hands[1].z else 1
    galaxy_ball(hands[k] + Vector((0, -0.14, -0.04)), 0.14)
    # pins exploding in the distance
    for i in range(6):
        pin((0.9 + random.uniform(-0.5, 0.5), 1.4 + random.uniform(-0.3, 0.6), random.uniform(0.0, 1.0)), (random.uniform(-1.2, 1.2), random.uniform(-1.2, 1.2), random.uniform(0, 6)), 1.6)
    sparks((1.0, 1.5, 0.6), gold, 40, 0.6)
    key_lights(cyan, violet, key_power=320, rim_power=1000, target=(0, 0, 0.9))
    return arm, (0, 0, 0.85)


GAMES = {"dance": game_dance, "blade": game_blade, "box": game_box, "rush": game_rush, "fruit": game_fruit, "tennis": game_tennis, "bowl": game_bowl}
arm, target = GAMES[GAME]()

# camera per view
hips = bone(arm, "Hips")
# frame the whole silhouette: center on head, hips and both hands
pts = [bone(arm, n) for n in ("Head", "Hips", "LeftHand", "RightHand")]
cx = sum(p.x for p in pts) / 4 * 0.7 + hips.x * 0.3
cy = sum(p.y for p in pts) / 4 * 0.7 + hips.y * 0.3
aim_at = Vector((cx, cy, target[2]))
hips = Vector((cx, cy, hips.z))
if VIEW == "card":
    camera((hips.x + 0.45, hips.y - 5.0, 0.55), aim_at + Vector((0, 0, 0.08)), lens=74, dof=5.05, fstop=2.8)
else:
    camera((hips.x - 0.9, hips.y - 6.4, 0.75), aim_at + Vector((-1.55, 0, 0.1)), lens=42, dof=6.45, fstop=3.2)
compositor(bloom=0.7, threshold=1.2)
save(scn, OUT)
