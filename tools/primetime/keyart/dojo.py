# Fruit Slice backdrop: a lantern-lit night dojo wall.
#   blender -b -P dojo.py -- out.png [w h samples]
import os, bpy, sys, math, random
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import *

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
out = argv[0] if argv else "/tmp/dojo.png"
W = int(argv[1]) if len(argv) > 1 else 1920
H = int(argv[2]) if len(argv) > 2 else 1080
S = int(argv[3]) if len(argv) > 3 else 128
random.seed(7)
scn = reset()
render_setup(scn, W, H, samples=S, look="AgX - Medium High Contrast", exposure=-0.2)
world(scn, color=(0.004, 0.006, 0.014), strength=1.0, volume=0.012, anisotropy=0.2)


def wood(name, dark, mid, light, scale=(1, 1, 1), rough=0.55, grain=6.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    b = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
    tc = nt.nodes.new("ShaderNodeTexCoord")
    info = nt.nodes.new("ShaderNodeObjectInfo")
    mp = nt.nodes.new("ShaderNodeMapping")
    mp.inputs["Scale"].default_value = scale
    add = nt.nodes.new("ShaderNodeVectorMath")
    add.operation = "ADD"
    rnd = nt.nodes.new("ShaderNodeCombineXYZ")
    mul = nt.nodes.new("ShaderNodeMath")
    mul.operation = "MULTIPLY"
    mul.inputs[1].default_value = 37.0
    nt.links.new(info.outputs["Random"], mul.inputs[0])
    nt.links.new(mul.outputs[0], rnd.inputs[0])
    nt.links.new(mul.outputs[0], rnd.inputs[2])
    nt.links.new(tc.outputs["Object"], add.inputs[0])
    nt.links.new(rnd.outputs[0], add.inputs[1])
    nt.links.new(add.outputs[0], mp.inputs["Vector"])
    wave = nt.nodes.new("ShaderNodeTexWave")
    wave.wave_type = "BANDS"
    wave.bands_direction = "Z"
    wave.inputs["Scale"].default_value = grain
    wave.inputs["Distortion"].default_value = 2.2
    wave.inputs["Detail"].default_value = 3.0
    wave.inputs["Detail Scale"].default_value = 0.8
    noise = nt.nodes.new("ShaderNodeTexNoise")
    noise.inputs["Scale"].default_value = 3.0
    noise.inputs["Detail"].default_value = 8.0
    nt.links.new(mp.outputs[0], wave.inputs["Vector"])
    nt.links.new(mp.outputs[0], noise.inputs["Vector"])
    mix = nt.nodes.new("ShaderNodeMath")
    mix.operation = "MULTIPLY_ADD"
    mix.inputs[1].default_value = 0.35
    nt.links.new(wave.outputs["Fac"], mix.inputs[0])
    nt.links.new(noise.outputs["Fac"], mix.inputs[2])
    ramp = nt.nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.elements[0].position = 0.25
    ramp.color_ramp.elements[0].color = (*dark, 1)
    ramp.color_ramp.elements[1].position = 0.95
    ramp.color_ramp.elements[1].color = (*light, 1)
    e = ramp.color_ramp.elements.new(0.6)
    e.color = (*mid, 1)
    nt.links.new(mix.outputs[0], ramp.inputs["Fac"])
    nt.links.new(ramp.outputs["Color"], b.inputs["Base Color"])
    b.inputs["Roughness"].default_value = rough
    if "Coat Weight" in b.inputs:
        b.inputs["Coat Weight"].default_value = 0.15
        b.inputs["Coat Roughness"].default_value = 0.25
    bump = nt.nodes.new("ShaderNodeBump")
    bump.inputs["Strength"].default_value = 0.18
    nt.links.new(wave.outputs["Fac"], bump.inputs["Height"])
    nt.links.new(bump.outputs["Normal"], b.inputs["Normal"])
    return m


plank_mat = wood("planks", (0.05, 0.022, 0.011), (0.12, 0.055, 0.024), (0.19, 0.09, 0.04), scale=(6.0, 6.0, 0.18), grain=9.0)
beam_mat = wood("beams", (0.012, 0.006, 0.004), (0.035, 0.018, 0.01), (0.07, 0.035, 0.018), scale=(0.18, 6, 6), grain=8.0)
floor_mat = wood("floor", (0.03, 0.014, 0.007), (0.08, 0.04, 0.018), (0.15, 0.075, 0.035), scale=(6, 0.18, 6), grain=8.0, rough=0.3)

# the wall: vertical planks with tiny gaps and jitter
x = -6.0
while x < 6.0:
    w = 0.26 + random.random() * 0.08
    box("plank", (w - 0.012, 0.07, 5.4), (x + w / 2, random.uniform(-0.006, 0.006), 2.7), plank_mat, rot=(0, random.uniform(-0.004, 0.004), 0), bevel=0.004)
    x += w
# dark backing behind the gaps
box("backing", (12, 0.02, 5.6), (0, 0.06, 2.8), mat("back", (0.004, 0.002, 0.001), 0.9))
# beams: top header, lower rail and two posts
box("header", (12, 0.28, 0.42), (0, -0.14, 4.25), beam_mat, bevel=0.01)
box("rail", (12, 0.14, 0.12), (0, -0.08, 0.95), beam_mat, bevel=0.006)
for px in (-3.55, 3.55):
    box("post", (0.34, 0.3, 5.4), (px, -0.16, 2.7), beam_mat, bevel=0.01)
# floor boards running toward the camera
fx = -6.0
while fx < 6.0:
    w = 0.22 + random.random() * 0.06
    box("board", (w - 0.008, 5.0, 0.05), (fx + w / 2, -2.5, -0.025), floor_mat, bevel=0.003)
    fx += w

# round window with backlit shoji paper
bpy.ops.mesh.primitive_cylinder_add(vertices=96, radius=0.86, depth=0.09, location=(1.25, -0.08, 2.75), rotation=(math.pi / 2, 0, 0))
frame_ring = bpy.context.object
frame_ring.data.materials.append(beam_mat)
bool_cut = frame_ring.modifiers.new("cut", "BOOLEAN")
bpy.ops.mesh.primitive_cylinder_add(vertices=96, radius=0.76, depth=0.3, location=(1.25, -0.08, 2.75), rotation=(math.pi / 2, 0, 0))
cutter = bpy.context.object
bool_cut.object = cutter
cutter.hide_render = True
paper = mat("paper", (0.9, 0.95, 1.0), 0.8)
pb = next(n for n in paper.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
pb.inputs["Emission Color"].default_value = (0.35, 0.5, 1.0, 1)
pb.inputs["Emission Strength"].default_value = 1.0
bpy.ops.mesh.primitive_circle_add(vertices=96, radius=0.77, fill_type="NGON", location=(1.25, -0.045, 2.75), rotation=(math.pi / 2, 0, 0))
disc = bpy.context.object
disc.data.materials.append(paper)
lattice = mat("lattice", (0.02, 0.01, 0.006), 0.7)
for i in range(-3, 4):
    h = 2 * math.sqrt(max(0.0, 0.77 ** 2 - (i * 0.2) ** 2))
    box("lat", (0.022, 0.02, h), (1.25 + i * 0.2, -0.06, 2.75), lattice)
    box("lat", (h, 0.02, 0.022), (1.25, -0.06, 2.75 + i * 0.2), lattice)
# cool moonlight behind the paper
area("moon", (1.25, 0.9, 2.75), (1.25, 0, 2.75), (0.55, 0.7, 1.0), 60, 1.6)


def lantern(pos, s=1.0, power=180):
    px, py, pz = pos
    bpy.ops.mesh.primitive_uv_sphere_add(segments=48, ring_count=24, radius=0.27 * s, location=pos)
    o = bpy.context.object
    o.scale = (1, 1, 1.35)
    bpy.ops.object.shade_smooth()
    lm = mat("lanternpaper", (1.0, 0.55, 0.22), 0.7)
    b = next(n for n in lm.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    b.inputs["Emission Color"].default_value = (1.0, 0.28, 0.05, 1)
    b.inputs["Emission Strength"].default_value = 2.2
    # ribs
    wave = lm.node_tree.nodes.new("ShaderNodeTexWave")
    wave.bands_direction = "Z"
    wave.inputs["Scale"].default_value = 9.0
    ramp = lm.node_tree.nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.elements[0].position = 0.05
    ramp.color_ramp.elements[0].color = (0.45, 0.45, 0.45, 1)
    ramp.color_ramp.elements[1].position = 0.2
    ramp.color_ramp.elements[1].color = (1, 1, 1, 1)
    tc = lm.node_tree.nodes.new("ShaderNodeTexCoord")
    lm.node_tree.links.new(tc.outputs["Object"], wave.inputs["Vector"])
    lm.node_tree.links.new(wave.outputs["Fac"], ramp.inputs["Fac"])
    mult = lm.node_tree.nodes.new("ShaderNodeMath")
    mult.operation = "MULTIPLY"
    mult.inputs[1].default_value = 3.2
    lm.node_tree.links.new(ramp.outputs["Color"], mult.inputs[0])
    lm.node_tree.links.new(mult.outputs[0], b.inputs["Emission Strength"])
    o.data.materials.append(lm)
    cap = mat("cap", (0.02, 0.01, 0.01), 0.5)
    for dz in (-0.35 * s, 0.35 * s):
        bpy.ops.mesh.primitive_cylinder_add(vertices=32, radius=0.13 * s, depth=0.06 * s, location=(px, py, pz + dz))
        bpy.context.object.data.materials.append(cap)
    bpy.ops.mesh.primitive_cylinder_add(vertices=8, radius=0.006, depth=3, location=(px, py, pz + 0.35 * s + 1.5))
    bpy.context.object.data.materials.append(cap)
    o.visible_shadow = False
    point("lamp", (px, py, pz), (1.0, 0.55, 0.25), power, radius=0.2 * s)


lantern((-2.2, -0.9, 3.3), 1.0, 420)
lantern((3.0, -1.2, 3.45), 0.9, 330)
lantern((-4.3, -2.2, 3.65), 0.75, 200)
# neon wall washes: cyan under the header, magenta along the rail
box("ledtop", (7.0, 0.03, 0.03), (0, -0.33, 4.0), emit("cyan", (0.2, 0.85, 1.0), 6))
area("washtop", (0, -0.45, 3.95), (0, 0, 3.2), (0.25, 0.8, 1.0), 45, 7.0, 0.1)
box("ledrail", (7.0, 0.025, 0.025), (0, -0.17, 1.03), emit("mag", (1.0, 0.2, 0.7), 5))
area("washrail", (0, -0.3, 1.1), (0, 0, 1.8), (1.0, 0.25, 0.7), 22, 7.0, 0.1)
# a warm fill from below and a cool rim from the side keep the wall readable
area("fill", (0, -5.5, 0.3), (0, 0, 2.2), (1.0, 0.62, 0.35), 90, 5, 1)
area("coolside", (5.5, -2.0, 3.5), (0, 0, 2.0), (0.35, 0.5, 1.0), 110, 2)

camera((0, -7.0, 1.95), (0, 0, 2.05), lens=30, dof=7.0, fstop=5.6)
save(scn, out)
