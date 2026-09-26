"""Original GrooveStar cast: authored lofted clothing, articulated anatomy and rig.
Run: blender --background --python tools/kinetic/build_cast.py
No external meshes, textures, motion, or likenesses are used.
"""
import bpy, math, os
from mathutils import Vector
ROOT=os.path.abspath(os.path.join(os.path.dirname(__file__),'../..'))
OUT=os.path.join(ROOT,'public/models'); os.makedirs(OUT,exist_ok=True)
CAST=[('nova','#ae6e4a','#f35d42','#171917','afro'),('blaze','#d7a27a','#cf502f','#262b28','crop'),('luna','#edc9ac','#b5bad3','#343847','bob'),('kiko','#8e5838','#d7ef70','#343a2d','buns'),('rex','#c38c66','#b5c6a1','#1c2721','cap'),('velvet','#b87866','#365ff5','#efebe0','tail'),('midnight','#927362','#303944','#171917','hood'),('sol','#be7950','#d4b55d','#eeeae1','sweep')]
BONES={
'Hips':((0,0,0.95),(0,0,1.12),None),'Spine':((0,0,1.12),(0,0,1.31),'Hips'),'Chest':((0,0,1.31),(0,0,1.51),'Spine'),
'Neck':((0,0,1.51),(0,0,1.60),'Chest'),'Head':((0,0,1.60),(0,0,1.91),'Neck'),
}
for side,s in [('L',1),('R',-1)]:
 BONES.update({f'UpperArm{side}':((s*.235,0,1.46),(s*.45,0,1.18),'Chest'),f'LowerArm{side}':((s*.45,0,1.18),(s*.57,-.015,.91),f'UpperArm{side}'),f'Hand{side}':((s*.57,-.015,.91),(s*.62,-.02,.79),f'LowerArm{side}'),f'Thigh{side}':((s*.115,0,.98),(s*.135,0,.56),'Hips'),f'Shin{side}':((s*.135,0,.56),(s*.145,-.015,.15),f'Thigh{side}'),f'Foot{side}':((s*.145,-.015,.15),(s*.145,-.17,.075),f'Shin{side}')})
def rgba(h):
 def linear(v):return v/12.92 if v<=.04045 else ((v+.055)/1.055)**2.4
 return tuple(linear(int(h[i:i+2],16)/255) for i in (1,3,5))+(1,)
def mat(name,col,rough=.75,metal=0):
 m=bpy.data.materials.new(name);m.diffuse_color=rgba(col);m.use_nodes=True
 p=m.node_tree.nodes.get('Principled BSDF');p.inputs['Base Color'].default_value=rgba(col);p.inputs['Roughness'].default_value=rough;p.inputs['Metallic'].default_value=metal
 return m
def bind(o,bone,material):
 o.data.materials.append(material)
 vg=o.vertex_groups.new(name=bone);vg.add(list(range(len(o.data.vertices))),1,'REPLACE')
 mod=o.modifiers.new('Character rig','ARMATURE');mod.object=rig
 o.parent=rig
 for f in o.data.polygons:f.use_smooth=True
 return o
def ell(name,loc,scale,material,bone='Head',seg=20,rings=12):
 bpy.ops.mesh.primitive_uv_sphere_add(segments=seg,ring_count=rings,location=loc);o=bpy.context.object;o.name=name;o.scale=scale
 bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
 return bind(o,bone,material)
def box(name,loc,scale,material,bone,bev=.035):
 bpy.ops.mesh.primitive_cube_add(size=1,location=loc);o=bpy.context.object;o.name=name;o.scale=scale;bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
 b=o.modifiers.new('Tailored edge','BEVEL');b.width=bev;b.segments=3;bpy.context.view_layer.objects.active=o;bpy.ops.object.modifier_apply(modifier=b.name)
 return bind(o,bone,material)
def loft(name,a,b,profile,material,bone,n=16):
 a,b=Vector(a),Vector(b);direction=(b-a).normalized();basis=direction.cross(Vector((0,1,0))).normalized();other=direction.cross(basis).normalized()
 vs=[]
 for t,rx,ry in profile:
  c=a.lerp(b,t)
  for k in range(n):
   q=2*math.pi*k/n;vs.append(c+basis*rx*math.cos(q)+other*ry*math.sin(q))
 fs=[]
 for j in range(len(profile)-1):
  for k in range(n):fs.append((j*n+k,j*n+(k+1)%n,(j+1)*n+(k+1)%n,(j+1)*n+k))
 fs.extend([tuple(reversed(range(n))),tuple((len(profile)-1)*n+k for k in range(n))])
 mesh=bpy.data.meshes.new(name);mesh.from_pydata(vs,[],fs);mesh.update();o=bpy.data.objects.new(name,mesh);bpy.context.collection.objects.link(o);bind(o,bone,material);return o
for ident,skincol,accentcol,pantscol,hairtype in CAST:
 bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
 skin=mat('skin',skincol);accent=mat('accent',accentcol);pants=mat('pants',pantscol);cream=mat('cream','#eeeae1');ink=mat('ink','#171917');hair=mat('hair','#241f1b');sole=mat('sole','#e4dfd1');metal=mat('hardware','#92968a',.25,.8);secondary=mat('secondary','#365ff5' if ident!='velvet' else '#d7ef70')
 bpy.ops.object.armature_add(enter_editmode=True,location=(0,0,0));rig=bpy.context.object;rig.name='GrooveStar_'+ident
 rig.data.edit_bones.remove(rig.data.edit_bones[0]);eb={}
 for name,(h,t,p) in BONES.items():
  bone=rig.data.edit_bones.new(name);bone.head=h;bone.tail=t
  if p:bone.parent=eb[p]
  eb[name]=bone
 bpy.ops.object.mode_set(mode='OBJECT')
 # Tailored cropped technical jacket: a shaped solid, not capsule anatomy.
 torso=loft('Technical jacket',(0,0,1.02),(0,0,1.5),[(0,.16,.12),(.1,.18,.125),(.45,.185,.14),(.82,.23,.145),(1,.17,.11)],cream,'Chest',24)
 # Blend jacket's lower rings across spine to retain a continuous torso.
 torso.vertex_groups.clear()
 groups={n:torso.vertex_groups.new(name=n) for n in ['Hips','Spine','Chest']}
 for v in torso.data.vertices:
  z=v.co.z
  if z<1.18:groups['Hips'].add([v.index],max(0,(1.18-z)/.16),'REPLACE');groups['Spine'].add([v.index],min(1,(z-1.02)/.16),'REPLACE')
  elif z<1.34:groups['Spine'].add([v.index],1-(z-1.18)/.16,'REPLACE');groups['Chest'].add([v.index],(z-1.18)/.16,'REPLACE')
  else:groups['Chest'].add([v.index],1,'REPLACE')
 box('Asymmetric chest panel',(.097,-.131,1.32),(.165,.025,.25),accent,'Chest',.015)
 box('Utility pocket',(-.08,-.145,1.32),(.104,.025,.094),ink,'Chest',.01)
 box('Pocket zip',(-.079,-.16,1.34),(.075,.009,.008),metal,'Chest',.002)
 box('Center zipper',(0,-.149,1.285),(.013,.012,.31),ink,'Chest',.003)
 box('Collar',(0,-.005,1.514),(.21,.175,.075),accent,'Neck',.026)
 for i in range(3):box('Chest identity bar '+str(i),(.09,-.152,1.405-i*.018),(.065,.007,.007),cream,'Chest',.002)
 loft('Anatomical neck',(0,0,1.49),(0,0,1.65),[(0,.07,.064),(1,.065,.064)],skin,'Neck')
 for side,s in [('L',1),('R',-1)]:
  upper=BONES['UpperArm'+side];lower=BONES['LowerArm'+side]
  loft('Oversized sleeve '+side,upper[0],upper[1],[(0,.116,.104),(.25,.111,.1),(.7,.084,.085),(1,.068,.07)],accent if side=='L' else cream,'UpperArm'+side)
  ell('Elbow '+side,lower[0],(.061,.063,.063),skin,'LowerArm'+side)
  loft('Forearm '+side,lower[0],lower[1],[(0,.061,.064),(.3,.062,.065),(.85,.043,.045),(1,.041,.042)],skin,'LowerArm'+side)
  loft('Wrist wrap '+side,Vector(lower[0]).lerp(Vector(lower[1]),.8),lower[1],[(0,.047,.048),(1,.044,.046)],ink,'LowerArm'+side)
  hand=BONES['Hand'+side];h=ell('Palm '+side,Vector(hand[0]).lerp(Vector(hand[1]),.45),(.048,.035,.073),skin,'Hand'+side);h.rotation_euler[1]=-s*.32
  for i in range(4):
   x=s*(.589+i*.015);o=ell('Finger '+side+str(i),(x,-.024,.79+(abs(1.4-i))*.009),(.011,.015,.045),skin,'Hand'+side,12,8);o.rotation_euler[1]=-s*.2
  ell('Thumb '+side,(s*.551,-.035,.837),(.021,.027,.039),skin,'Hand'+side,12,8)
  thigh=BONES['Thigh'+side];shin=BONES['Shin'+side]
  leg=loft('Continuous technical trouser '+side,thigh[0],shin[1],[(0,.109,.112),(.12,.113,.11),(.34,.099,.098),(.48,.081,.09),(.57,.079,.088),(.72,.072,.076),(.94,.055,.059),(1,.057,.06)],pants,'Thigh'+side,24)
  leg.vertex_groups.clear()
  upper=leg.vertex_groups.new(name='Thigh'+side);lower=leg.vertex_groups.new(name='Shin'+side)
  for v in leg.data.vertices:
   blend=max(0,min(1,(.65-v.co.z)/.18))
   upper.add([v.index],1-blend,'REPLACE');lower.add([v.index],blend,'REPLACE')
  box('Cargo pocket '+side,(s*.211,-.035,.815),(.037,.146,.155),accent,'Thigh'+side,.012)
  loft('Sock '+side,(s*.145,-.015,.17),(s*.145,-.015,.09),[(0,.059,.06),(1,.061,.062)],cream,'Shin'+side)
  shoe=box('Sculpted sneaker '+side,(s*.145,-.074,.077),(.16,.3,.119),cream,'Foot'+side,.048)
  box('Sneaker sole '+side,(s*.145,-.08,.032),(.17,.323,.053),sole,'Foot'+side,.025)
  box('Heel accent '+side,(s*.145,.045,.082),(.163,.043,.069),accent,'Foot'+side,.014)
  for j in range(3):box('Lace '+side+str(j),(s*.145,-.08-j*.026,.139),(.071,.009,.008),ink,'Foot'+side,.004)
 loft('Trouser waistband',(0,0,.96),(0,0,1.055),[(0,.208,.109),(1,.167,.118)],pants,'Hips',24)
 # Sculpted face silhouette, ears, projecting nose, eyelids and brows.
 ell('Sculpted skull',(0,-.007,1.733),(.116,.106,.15),skin)
 ell('Jaw',(0,-.015,1.657),(.086,.082,.062),skin)
 for s in [-1,1]:
  ell('Ear', (s*.112,-.001,1.731),(.025,.017,.04),skin,seg=12,rings=10)
  ell('Eye white',(s*.046,-.102,1.75),(.025,.009,.012),cream,seg=16,rings=8)
  ell('Iris',(s*.047,-.110,1.749),(.009,.005,.010),ink,seg=12,rings=8)
  brow=box('Eyebrow',(s*.047,-.104,1.78),(.052,.013,.012),hair,'Head',.005);brow.rotation_euler[1]=s*.07
 ell('Nose',(0,-.11,1.724),(.019,.027,.03),skin,seg=12,rings=8)
 box('Mouth',(0,-.091,1.678),(.044,.008,.008),hair,'Head',.004)
 ell('Hair cap',(0,.006,1.813),(.121,.109,.089),hair)
 if hairtype=='afro':
  for row in range(3):
   for i in range(12):
    q=i*math.tau/12;rr=.10*math.sin((row+1)*math.pi/4.5)
    ell('Curl', (rr*math.cos(q),rr*math.sin(q)+.008,1.815+row*.034),(.044,.045,.052),hair,seg=10,rings=8)
 elif hairtype in ['bob','hood']:
  for s in [-1,1]:ell('Hair sides',(s*.109,.015,1.73),(.038,.087,.145),hair if hairtype=='bob' else ink)
  if hairtype=='hood':ell('Hood back',(0,.089,1.727),(.138,.071,.188),ink)
 elif hairtype=='buns':
  for s in [-1,1]:ell('Hair bun',(s*.109,.02,1.862),(.059,.059,.061),hair)
 elif hairtype=='tail':
  ell('Ponytail',(0,.132,1.724),(.055,.054,.152),hair)
 elif hairtype=='cap':
  ell('Cap crown',(0,.009,1.837),(.129,.113,.057),ink)
  box('Cap brim',(0,-.091,1.819),(.22,.173,.015),accent,'Head',.035)
 else:
  for i in range(6):ell('Swept hair',(-.08+i*.03,-.027,1.846+i*.006),(.043,.071,.038),hair)
 # Rigged motions, authored from deliberate key poses. No borrowed motion data.
 # Merge meshes by material while retaining skin weights. This reduces draw calls.
 by_material={}
 for o in list(bpy.context.scene.objects):
  if o.type=='MESH':by_material.setdefault(o.data.materials[0].name,[]).append(o)
 for name,objects in by_material.items():
  bpy.ops.object.select_all(action='DESELECT')
  for o in objects:o.select_set(True)
  bpy.context.view_layer.objects.active=objects[0];bpy.ops.object.join();objects[0].name='Wardrobe_'+name
 for action,duration in [('Idle',2),('Run',.8),('Dance',2),('Guard',2),('Celebrate',2)]:
  rig.animation_data_create();act=bpy.data.actions.new(action);rig.animation_data.action=act
  for f in range(0,int(duration*30)+1,5):
   t=f/30;p=t/duration*math.tau
   for bn in rig.pose.bones:bn.rotation_mode='XYZ';bn.rotation_euler=(0,0,0);bn.location=(0,0,0)
   rig.pose.bones['Hips'].location.z=.012*math.sin(p*2)
   rig.pose.bones['Chest'].rotation_euler.y=.02*math.sin(p)
   for side,s in [('L',1),('R',-1)]:
    if action=='Run':
     rig.pose.bones['Thigh'+side].rotation_euler.x=.6*math.sin(p)*s
     rig.pose.bones['Shin'+side].rotation_euler.x=-.5*max(0,-math.sin(p)*s)
     rig.pose.bones['UpperArm'+side].rotation_euler.x=-.55*math.sin(p)*s
     rig.pose.bones['LowerArm'+side].rotation_euler.x=-.9
    elif action=='Dance':
     rig.pose.bones['UpperArm'+side].rotation_euler.y=s*(.2+.7*math.sin(p+s))
     rig.pose.bones['LowerArm'+side].rotation_euler.x=-.4-.4*math.sin(p)
     rig.pose.bones['Chest'].rotation_euler.y=.12*math.sin(p)
    elif action=='Guard':
     rig.pose.bones['UpperArm'+side].rotation_euler.x=-.45
     rig.pose.bones['LowerArm'+side].rotation_euler.x=-1.7
    elif action=='Celebrate':
     rig.pose.bones['UpperArm'+side].rotation_euler.y=s*1.8
     rig.pose.bones['LowerArm'+side].rotation_euler.x=-.3
   for bn in rig.pose.bones:
    bn.keyframe_insert('rotation_euler',frame=f);bn.keyframe_insert('location',frame=f)
  track=rig.animation_data.nla_tracks.new();track.name=action;track.strips.new(action,0,act)
 rig.animation_data.action=None
 for tr in rig.animation_data.nla_tracks:tr.mute=True
 bpy.context.scene.frame_set(0)
 for bn in rig.pose.bones:bn.rotation_euler=(0,0,0);bn.location=(0,0,0)
 bpy.ops.wm.save_as_mainfile(filepath=os.path.join(ROOT,'tools/kinetic/cast-source.blend')) if ident=='nova' else None
 bpy.ops.export_scene.gltf(filepath=os.path.join(OUT,ident+'.glb'),export_format='GLB',export_yup=True,export_animations=True,export_animation_mode='ACTIONS',export_skins=True)
 print('CAST_EXPORTED',ident)
print('All eight original characters exported')
