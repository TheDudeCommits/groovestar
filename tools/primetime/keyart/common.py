# Shared Blender helpers for GrooveStar key art and plates.
import os, bpy, math, random
from mathutils import Vector, Euler

NOVA = os.path.join(os.path.dirname(os.path.abspath(__file__)), "../../../public/models/nova-pt.glb")


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    return bpy.context.scene


def render_setup(scn, w, h, samples=128, look="AgX - Punchy", exposure=0.0, gpu=True):
    scn.render.engine = "CYCLES"
    if gpu:
        prefs = bpy.context.preferences.addons["cycles"].preferences
        prefs.compute_device_type = "METAL"
        try:
            prefs.refresh_devices()
        except Exception:
            prefs.get_devices()
        for d in prefs.devices:
            d.use = d.type == "METAL"
        scn.cycles.device = "GPU"
    scn.cycles.samples = samples
    scn.cycles.use_denoising = True
    scn.render.resolution_x = w
    scn.render.resolution_y = h
    scn.render.resolution_percentage = 100
    scn.view_settings.view_transform = "AgX"
    try:
        scn.view_settings.look = look
    except Exception as e:
        print("look", e)
    scn.view_settings.exposure = exposure
    scn.render.film_transparent = False
    scn.render.image_settings.file_format = "PNG"


def world(scn, color=(0.0, 0.0, 0.0), strength=1.0, volume=0.0, anisotropy=0.3):
    w = bpy.data.worlds.new("W")
    scn.world = w
    w.use_nodes = True
    nt = w.node_tree
    bg = next(n for n in nt.nodes if n.type == "BACKGROUND")
    bg.inputs[0].default_value = (*color, 1)
    bg.inputs[1].default_value = strength
    if volume > 0:
        vol = nt.nodes.new("ShaderNodeVolumePrincipled")
        vol.inputs["Density"].default_value = volume
        vol.inputs["Anisotropy"].default_value = anisotropy
        out = next(n for n in nt.nodes if n.type == "OUTPUT_WORLD")
        nt.links.new(vol.outputs[0], out.inputs["Volume"])
    return w


def mat(name, color=(0.8, 0.8, 0.8), rough=0.5, metal=0.0, emission=None, strength=0.0, alpha=1.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = next(n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    b.inputs["Base Color"].default_value = (*color, 1)
    b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = metal
    if emission is not None:
        b.inputs["Emission Color"].default_value = (*emission, 1)
        b.inputs["Emission Strength"].default_value = strength
    if alpha < 1:
        b.inputs["Alpha"].default_value = alpha
    return m


def emit(name, color, strength):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    e = nt.nodes.new("ShaderNodeEmission")
    e.inputs[0].default_value = (*color, 1)
    e.inputs[1].default_value = strength
    o = nt.nodes.new("ShaderNodeOutputMaterial")
    nt.links.new(e.outputs[0], o.inputs[0])
    return m


def link(obj, scn=None):
    (scn or bpy.context.scene).collection.objects.link(obj)
    return obj


def aim(obj, target):
    d = Vector(target) - obj.location
    obj.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()


def area(name, loc, target, color, power, size=1.0, size_y=None, shape="RECTANGLE"):
    l = bpy.data.lights.new(name, "AREA")
    l.energy = power
    l.color = color
    l.shape = shape
    l.size = size
    if shape in ("RECTANGLE", "ELLIPSE"):
        l.size_y = size_y if size_y else size
    o = link(bpy.data.objects.new(name, l))
    o.location = loc
    aim(o, target)
    return o


def spot(name, loc, target, color, power, angle=20, blend=0.3, radius=0.05):
    l = bpy.data.lights.new(name, "SPOT")
    l.energy = power
    l.color = color
    l.spot_size = math.radians(angle)
    l.spot_blend = blend
    l.shadow_soft_size = radius
    o = link(bpy.data.objects.new(name, l))
    o.location = loc
    aim(o, target)
    return o


def point(name, loc, color, power, radius=0.1):
    l = bpy.data.lights.new(name, "POINT")
    l.energy = power
    l.color = color
    l.shadow_soft_size = radius
    o = link(bpy.data.objects.new(name, l))
    o.location = loc
    return o


def camera(loc, target, lens=50, dof=None, fstop=2.8, sensor=36):
    c = bpy.data.cameras.new("cam")
    c.lens = lens
    c.sensor_width = sensor
    o = link(bpy.data.objects.new("cam", c))
    o.location = loc
    aim(o, target)
    bpy.context.scene.camera = o
    if dof:
        c.dof.use_dof = True
        c.dof.focus_distance = dof
        c.dof.aperture_fstop = fstop
    return o


def box(name, size, loc, material, rot=(0, 0, 0), bevel=0.0):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc, rotation=rot)
    o = bpy.context.object
    o.name = name
    o.scale = size
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if bevel > 0:
        m = o.modifiers.new("bev", "BEVEL")
        m.width = bevel
        m.segments = 3
    o.data.materials.append(material)
    return o


def nova(action, frame, loc=(0, 0, 0), rot_z=0.0, soft_spec=True):
    bpy.ops.import_scene.gltf(filepath=NOVA)
    for o in list(bpy.data.objects):
        if o.name.startswith("Icosphere"):
            bpy.data.objects.remove(o)
    arm = next(o for o in bpy.data.objects if o.type == "ARMATURE")
    act = bpy.data.actions[action]
    arm.animation_data_create()
    arm.animation_data.action = act
    try:
        if act.slots:
            arm.animation_data.action_slot = act.slots[0]
    except Exception as e:
        print("slot", e)
    bpy.context.scene.frame_set(frame)
    arm.location = loc
    arm.rotation_euler[2] += rot_z
    body = next(o for o in bpy.data.objects if o.type == "MESH" and o.parent == arm)
    if soft_spec:
        for m in body.data.materials:
            b = next((n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED"), None)
            if b:
                b.inputs["Roughness"].default_value = 0.6
                if "Specular IOR Level" in b.inputs:
                    b.inputs["Specular IOR Level"].default_value = 0.3
    return arm, body


def save(scn, path):
    scn.render.filepath = path
    bpy.ops.render.render(write_still=True)
    print("SAVED", path)
