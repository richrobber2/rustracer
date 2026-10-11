"""Build CC0 MakeHuman body GLBs plus spring-cage data; no Blender dependency.

Usage: python scripts/prepare-human-models.py MPFB_CHECKOUT SYSTEM_ASSETS_DIRECTORY MHX2_CHECKOUT
The checkout supplies the CC0 base mesh, adult targets, and default rig/weights.
The system assets directory supplies the diffuse skin textures and eyes.
The MHX2 checkout supplies the anatomical surface data; see its asset-license clarification.
"""
from pathlib import Path
import sys, json, gzip, struct, hashlib, subprocess
from collections import defaultdict
import numpy as np
from scipy import sparse
from scipy.spatial import cKDTree

ROOT = Path(__file__).resolve().parents[1]
SOURCE = Path(sys.argv[1])
ASSETS = Path(sys.argv[2])
ANATOMY = Path(sys.argv[3]) / "import_runtime_mhx2/data/hm8/genitalia"
OUT = ROOT / 'public' / 'bodies'
OUT.mkdir(parents=True, exist_ok=True)
(ROOT / '.sites-runtime').mkdir(exist_ok=True)
DATA = SOURCE / 'src/mpfb/data'
raw, uvs, quads, quad_uv, groups = [], [], [], [], defaultdict(set)
group = ''
for line in (DATA / '3dobjs/base.obj').read_text().splitlines():
    a = line.split()
    if not a: continue
    if a[0] == 'v': raw.append([float(x) for x in a[1:4]])
    elif a[0] == 'vt': uvs.append([float(x) for x in a[1:3]])
    elif a[0] == 'g': group = a[1]
    elif a[0] == 'f':
        f = [int(x.split('/')[0]) - 1 for x in a[1:]]
        groups[group].update(f)
        if group == 'body':
            quads.append(f)
            quad_uv.append([int(x.split('/')[1]) - 1 for x in a[1:]])
raw, uvs, quads = np.array(raw), np.array(uvs), np.array(quads)
quad_uv = uvs[np.array(quad_uv)]
n = int(quads.max()) + 1
assert n == 13380 and len(quads) == 13378

def subdivide(quads, quad_uv, n):
    # One Catmull-Clark subdivision of the joined surface.
    edge_faces, neighbors, vf = defaultdict(list), defaultdict(set), defaultdict(list)
    for f, q in enumerate(quads):
        for a, b in zip(q, np.roll(q, -1)):
            edge_faces[tuple(sorted((int(a), int(b))))].append(f)
            neighbors[a].add(b); neighbors[b].add(a); vf[a].append(f)
    edges = list(edge_faces)
    edge_ids = {e: i for i, e in enumerate(edges)}
    face_matrix = sparse.csr_matrix((np.full(quads.size, .25), (np.repeat(np.arange(len(quads)), 4), quads.ravel())), shape=(len(quads), n))
    rows, cols, vals = [], [], []
    def add(row, col, value): rows.append(row); cols.append(col); vals.append(value)
    for i in range(n):
        boundary = [j for j in neighbors[i] if len(edge_faces[tuple(sorted((i, int(j))))]) == 1]
        if boundary:
            add(i, i, .75)
            for j in boundary: add(i, j, .25 / len(boundary))
        else:
            degree = len(neighbors[i])
            add(i, i, (degree - 3) / degree + 1 / degree)
            for j in neighbors[i]: add(i, j, 1 / degree ** 2)
            for f in vf[i]:
                for j in quads[f]: add(i, j, 1 / (4 * degree ** 2))
    for e, (a, b) in enumerate(edges):
        row = n + e; adjacent = edge_faces[(a, b)]
        if len(adjacent) == 2:
            add(row, a, .25); add(row, b, .25)
            for f in adjacent:
                for j in quads[f]: add(row, j, .0625)
        else:
            add(row, a, .5); add(row, b, .5)
    offset = n + len(edges)
    for f, q in enumerate(quads):
        for j in q: add(offset + f, j, .25)
    subdivision = sparse.csr_matrix((vals, (rows, cols)), shape=(offset + len(quads), n))
    assert np.allclose(np.asarray(subdivision.sum(axis=1)).ravel(), 1)

    new_quads, new_uv = [], []
    for f, (q, uv) in enumerate(zip(quads, quad_uv)):
        center = uv.mean(axis=0)
        for j, v in enumerate(q):
            nxt, prev = (j + 1) % 4, (j - 1) % 4
            new_quads.append([v, n + edge_ids[tuple(sorted((int(v), int(q[nxt]))))], offset + f, n + edge_ids[tuple(sorted((int(q[prev]), int(v))))]])
            new_uv.append([uv[j], (uv[j] + uv[nxt]) * .5, center, (uv[prev] + uv[j]) * .5])
    new_quads, new_uv = np.array(new_quads), np.array(new_uv)
    # Split only UV seams. Keep canonical indices to smooth normals across seams later.
    render_lookup, render_ids, render_uv, render_quads = {}, [], [], []
    for q, uv in zip(new_quads, new_uv):
        rq = []
        for v, t in zip(q, uv):
            key = (int(v), round(float(t[0]), 7), round(float(t[1]), 7))
            if key not in render_lookup:
                render_lookup[key] = len(render_ids); render_ids.append(int(v)); render_uv.append(t)
            rq.append(render_lookup[key])
        render_quads.append(rq)
    render_ids, render_uv, render_quads = np.array(render_ids), np.array(render_uv), np.array(render_quads)
    triangles = np.concatenate([render_quads[:, [0, 1, 2]], render_quads[:, [0, 2, 3]]])
    canonical_triangles = np.concatenate([new_quads[:, [0, 1, 2]], new_quads[:, [0, 2, 3]]])

    return subdivision, render_ids, render_uv, triangles, canonical_triangles, edges

rig = json.loads((DATA / 'rigs/standard/rig.default.json').read_text())
bones = list(rig)
bone_index = {name: i for i, name in enumerate(bones)}
weights = np.zeros((n, len(bones)))
for name, entries in json.loads((DATA / 'rigs/standard/weights.default.json').read_text())['weights'].items():
    if name not in bone_index: continue
    for v, w in entries:
        if v < n: weights[v, bone_index[name]] += w
empty = weights.sum(axis=1) == 0
weights[empty, bone_index['root']] = 1
weights /= weights.sum(axis=1)[:, None]

REGIONS = ['Head', 'Chest', 'Abdomen', 'Hips', 'Arms', 'Thighs', 'Calves', 'Hands / feet', 'Genital tissue']
def regions_for(points, height):
    x, y = np.abs(points[:, 0]), points[:, 1] / height
    r = np.full(len(points), 2, dtype=np.uint8)
    r[y > .79] = 0
    r[(y > .63) & (y <= .79)] = 1
    r[(y > .44) & (y <= .54)] = 3
    r[(y > .27) & (y <= .44)] = 5
    r[(y > .06) & (y <= .27)] = 6
    r[y <= .06] = 7
    r[(x > height * .11) & (y > .49) & (y < .79)] = 4
    r[(x > height * .245) & (y < .70)] = 7
    return r

def normals(points, faces):
    normal = np.zeros_like(points)
    cross = np.cross(points[faces[:, 1]] - points[faces[:, 0]], points[faces[:, 2]] - points[faces[:, 0]])
    for j in range(3): np.add.at(normal, faces[:, j], cross)
    normal /= np.maximum(np.linalg.norm(normal, axis=1)[:, None], 1e-12)
    return normal

class GLB:
    def __init__(self):
        self.binary = bytearray(); self.views = []; self.accessors = []
    def blob(self, value):
        while len(self.binary) % 4: self.binary.append(0)
        i = len(self.views); self.views.append({'buffer': 0, 'byteOffset': len(self.binary), 'byteLength': len(value)})
        self.binary.extend(value); return i
    def attribute(self, array, dtype, kind, bounds=False):
        arr = np.asarray(array, dtype=dtype)
        view = self.blob(arr.tobytes())
        item = {'bufferView': view, 'componentType': {np.dtype('<f4'): 5126, np.dtype('<u2'): 5123, np.dtype('<u4'): 5125}[arr.dtype], 'count': len(arr), 'type': kind}
        if bounds: item.update(min=arr.min(axis=0).tolist(), max=arr.max(axis=0).tolist())
        self.accessors.append(item); return len(self.accessors) - 1
    def save(self, path, doc):
        while len(self.binary) % 4: self.binary.append(0)
        doc.update(buffers=[{'byteLength': len(self.binary)}], bufferViews=self.views, accessors=self.accessors)
        text = json.dumps(doc, separators=(',', ':')).encode()
        text += b' ' * ((-len(text)) % 4)
        size = 12 + 8 + len(text) + 8 + len(self.binary)
        path.write_bytes(struct.pack('<III', 0x46546c67, 2, size) + struct.pack('<II', len(text), 0x4e4f534a) + text + struct.pack('<II', len(self.binary), 0x004e4942) + self.binary)

def anatomical_surface(sex, vertices):
    asset = json.loads((ANATOMY / ('penis.mxa' if sex == 'male' else 'vulva.mxa')).read_text())
    proxy, mesh = asset['proxy'], asset['mesh']
    delete = np.asarray(proxy['delete_verts'][:n], dtype=bool)
    keep = ~np.any(delete[quads], axis=1)
    qs, qs_uv = quads[keep].tolist(), quad_uv[keep].tolist()
    ps, ws = vertices[:n].tolist(), weights.tolist()
    mask = [0.] * n
    scales = np.array([abs(vertices[a, axis] - vertices[b, axis]) / distance for axis, (a, b, distance) in enumerate(proxy['bounding_box'][c] for c in ['x', 'y', 'z'])])
    mapping = []
    for refs, coeff, offset in proxy['fitting']:
        if refs[0] < n and coeff == [1, 0, 0] and offset == [0, 0, 0]:
            mapping.append(refs[0]); continue
        position = np.sum(vertices[refs] * np.asarray(coeff)[:, None], axis=0) + scales * offset
        mapping.append(len(ps)); ps.append(position.tolist()); mask.append(1.)
        # Inherit nearby pelvis/upper-leg support for new anatomical surface vertices.
        nearest = np.argmin(np.sum((vertices[:n] - position) ** 2, axis=1))
        ws.append(weights[nearest].tolist())
    uv = np.asarray(mesh['uv_coordinates'])
    for f, t in zip(mesh['faces'], mesh['uv_faces']):
        qs.append([mapping[i] for i in f]); qs_uv.append(uv[t].tolist())
    qs = np.asarray(qs); used = np.unique(qs); remap = np.full(len(ps), -1); remap[used] = np.arange(len(used))
    return np.asarray(ps)[used], remap[qs], np.asarray(qs_uv), np.asarray(ws)[used], np.asarray(mask)[used]

manifest = {'source': 'MakeHuman / MPFB', 'anatomySource': 'https://github.com/makehumancommunity/mhx2-makehuman-exchange', 'anatomyCommit': subprocess.check_output(['git', '-C', str(ANATOMY), 'rev-parse', 'HEAD'], text=True).strip(), 'sourceCommit': subprocess.check_output(['git', '-C', str(SOURCE), 'rev-parse', 'HEAD'], text=True).strip(), 'license': 'CC0-1.0', 'units': 'meters', 'models': {}}
for sex in ['female', 'male']:
    vertices = raw.copy()
    # Adult shape, with equal interpolation of the three source ancestry targets.
    for ancestry in ['african', 'asian', 'caucasian']:
        target = np.loadtxt(gzip.open(DATA / f'targets/macrodetails/{ancestry}-{sex}-young.target.gz', 'rt'), ndmin=2)
        vertices[target[:, 0].astype(int)] += target[:, 1:] / 3
    # The average-muscle/average-weight universal target is intentionally empty.
    vertices *= .1
    vertices[:, 1] -= vertices[:n, 1].min()
    height = float(vertices[:n, 1].max())
    body_vertices, body_quads, body_uv, body_weights, genital_mask = anatomical_surface(sex, vertices)
    subdivision, render_ids, render_uv, triangles, canonical_triangles, edges = subdivide(body_quads, body_uv, len(body_vertices))
    points = subdivision @ body_vertices
    surface_genital = np.asarray(subdivision @ genital_mask)
    sub_weights = np.asarray(subdivision @ body_weights)
    joint_ids = np.argsort(sub_weights, axis=1)[:, -4:]
    joint_weights = np.take_along_axis(sub_weights, joint_ids, axis=1)
    joint_weights /= joint_weights.sum(axis=1)[:, None]
    normal = normals(points, canonical_triangles)
    base_regions = regions_for(body_vertices, height)
    base_regions[genital_mask > .1] = 8
    # Spatial clusters include region IDs, avoiding connections across adjacent limbs.
    keys = np.column_stack([np.floor(body_vertices / np.where(base_regions == 8, .008, .035)[:, None]).astype(int), base_regions])
    unique_keys, assignment = np.unique(keys, axis=0, return_inverse=True)
    count = np.bincount(assignment)
    cage = np.column_stack([np.bincount(assignment, weights=body_vertices[:, axis]) / count for axis in range(3)])
    cage_normals = np.column_stack([np.bincount(assignment, weights=normals(body_vertices, np.concatenate([body_quads[:, [0, 1, 2]], body_quads[:, [0, 2, 3]]]))[:, axis]) / count for axis in range(3)])
    cage_normals /= np.maximum(np.linalg.norm(cage_normals, axis=1)[:, None], 1e-8)
    cage_regions = unique_keys[:, 3]
    cage_genital = np.bincount(assignment, weights=genital_mask) / count
    springs = sorted({tuple(sorted((int(assignment[a]), int(assignment[b])))) for a, b in edges if assignment[a] != assignment[b]})
    # Four nearest particles in the same region smoothly drive the detailed surface.
    surface_regions = regions_for(points, height)
    surface_regions[surface_genital > .1] = 8
    influence_ids = np.zeros((len(points), 4), dtype=np.uint16)
    influence_weights = np.zeros((len(points), 4))
    for region in range(len(REGIONS)):
        ids = np.flatnonzero(cage_regions == region); ids = ids if len(ids) >= 4 else np.arange(len(cage))
        affected = np.flatnonzero(surface_regions == region)
        distance, nearest = cKDTree(cage[ids]).query(points[affected], k=4)
        influence_ids[affected] = ids[nearest]
        w = 1 / np.maximum(distance, .004) ** 3
        influence_weights[affected] = w / w.sum(axis=1)[:, None]
    doc = {'asset': {'version': '2.0', 'generator': 'Rustracer / CC0 MakeHuman conversion', 'copyright': 'CC0 MakeHuman assets; see ATTRIBUTION.txt'}, 'scene': 0, 'scenes': [{'nodes': [0]}], 'nodes': [{'name': sex.title() + ' body', 'children': [1, 2 + bone_index['root']]}, {'name': 'Skin', 'mesh': 0, 'skin': 0}], 'meshes': [], 'materials': [{'name': 'Skin', 'pbrMetallicRoughness': {'baseColorFactor': [1, 1, 1, 1], 'metallicFactor': 0, 'roughnessFactor': .65}, 'doubleSided': False}]}
    glb = GLB()
    attr = {
        'POSITION': glb.attribute(points[render_ids], '<f4', 'VEC3', True),
        'NORMAL': glb.attribute(normal[render_ids], '<f4', 'VEC3'),
        'TEXCOORD_0': glb.attribute(np.column_stack([render_uv[:, 0], 1 - render_uv[:, 1]]), '<f4', 'VEC2'),
        'JOINTS_0': glb.attribute(joint_ids[render_ids], '<u2', 'VEC4'),
        'WEIGHTS_0': glb.attribute(joint_weights[render_ids], '<f4', 'VEC4'),
        '_CAGE_INDEX': glb.attribute(influence_ids[render_ids], '<u2', 'VEC4'),
        '_CAGE_WEIGHT': glb.attribute(influence_weights[render_ids], '<f4', 'VEC4'),
        '_GENITAL_WEIGHT': glb.attribute(surface_genital[render_ids].reshape(-1, 1), '<f4', 'SCALAR'),
        '_WELD_INDEX': glb.attribute(render_ids.reshape(-1, 1), '<u4', 'SCALAR'),
    }
    doc['meshes'].append({'primitives': [{'attributes': attr, 'indices': glb.attribute(triangles.ravel(), '<u4', 'SCALAR'), 'material': 0}]})
    skin_path = ASSETS / f'skins/young_caucasian_{sex}/young_lightskinned_{sex}_diffuse.png'
    if skin_path.exists():
        doc['images'] = [{'bufferView': glb.blob(skin_path.read_bytes()), 'mimeType': 'image/png'}]
        doc['textures'] = [{'source': 0}]
        doc['materials'][0]['pbrMetallicRoughness']['baseColorTexture'] = {'index': 0}
    else:
        doc['materials'][0]['pbrMetallicRoughness']['baseColorFactor'] = [.58, .35, .24, 1]
    def bone_point(info):
        if info['strategy'] == 'CUBE': ids = list(groups[info['cube_name']])
        elif info['strategy'] == 'VERTEX': ids = [info['vertex_index']]
        else: ids = info['vertex_indices']
        return vertices[ids].mean(axis=0)
    heads = np.array([bone_point(rig[name]['head']) for name in bones])
    inverse = np.repeat(np.eye(4)[None], len(bones), axis=0)
    inverse[:, :3, 3] = -heads
    for name, head in zip(bones, heads):
        parent = rig[name].get('parent')
        translation = head - heads[bone_index[parent]] if parent else head
        node = {'name': name, 'translation': translation.tolist()}
        children = [2 + bone_index[child] for child in bones if rig[child].get('parent') == name]
        if children: node['children'] = children
        doc['nodes'].append(node)
    doc['skins'] = [{'name': 'MakeHuman 163-bone rig', 'joints': list(range(2, 2 + len(bones))), 'skeleton': 2 + bone_index['root'], 'inverseBindMatrices': glb.attribute(inverse.transpose(0, 2, 1).reshape(-1, 16), '<f4', 'MAT4')}]
    # Fit the CC0 eye asset from its explicit base-mesh vertex references.
    eye_dir = ASSETS / 'eyes/low-poly'
    if (eye_dir / 'low-poly.mhclo').exists():
        mapping_text = (eye_dir / 'low-poly.mhclo').read_text().split('verts 0', 1)[1]
        eye_map = [int(x.strip()) for x in mapping_text.splitlines() if x.strip().isdigit()]
        eye_pos = vertices[eye_map]
        eye_uv, eye_faces, eye_face_uv = [], [], []
        for line in (eye_dir / 'low-poly.obj').read_text().splitlines():
            a = line.split()
            if not a: continue
            if a[0] == 'vt': eye_uv.append([float(x) for x in a[1:3]])
            elif a[0] == 'f':
                ids = [int(x.split('/')[0]) - 1 for x in a[1:]]
                ts = [int(x.split('/')[1]) - 1 for x in a[1:]]
                for i in range(1, len(ids) - 1):
                    eye_faces.append([ids[0], ids[i], ids[i + 1]])
                    eye_face_uv.append([ts[0], ts[i], ts[i + 1]])
        eye_faces, eye_uv = np.array(eye_faces), np.array(eye_uv)
        eye_norm = normals(eye_pos, eye_faces)
        ev = eye_pos[eye_faces.ravel()]
        et = eye_uv[np.array(eye_face_uv).ravel()]; et[:, 1] = 1 - et[:, 1]
        joints = np.zeros((len(ev), 4), dtype=np.uint16)
        joints[:, 0] = np.where(ev[:, 0] >= 0, bone_index['eye.L'], bone_index['eye.R'])
        ew = np.zeros((len(ev), 4)); ew[:, 0] = 1
        attrs = {'POSITION': glb.attribute(ev, '<f4', 'VEC3', True), 'NORMAL': glb.attribute(eye_norm[eye_faces.ravel()], '<f4', 'VEC3'), 'TEXCOORD_0': glb.attribute(et, '<f4', 'VEC2'), 'JOINTS_0': glb.attribute(joints, '<u2', 'VEC4'), 'WEIGHTS_0': glb.attribute(ew, '<f4', 'VEC4')}
        texture_index = len(doc.setdefault('textures', []))
        image_index = len(doc.setdefault('images', []))
        doc['images'].append({'bufferView': glb.blob((ASSETS / 'eyes/materials/brown_eye.png').read_bytes()), 'mimeType': 'image/png'})
        doc['textures'].append({'source': image_index})
        doc['materials'].append({'name': 'Eyes', 'pbrMetallicRoughness': {'baseColorTexture': {'index': texture_index}, 'metallicFactor': 0, 'roughnessFactor': .28}})
        doc['meshes'].append({'primitives': [{'attributes': attrs, 'material': 1}]})
        doc['nodes'][0]['children'].append(len(doc['nodes']))
        doc['nodes'].append({'name': 'Eyes', 'mesh': 1, 'skin': 0})
    # Eyeballs are separate rigid meshes in the tissue experiment.
    eye_centers = [vertices[list(groups[name])].mean(axis=0).tolist() for name in ['joint-l-eye', 'joint-r-eye']]
    cage_doc = {'positions': np.round(cage, 6).ravel().tolist(), 'normals': np.round(cage_normals, 6).ravel().tolist(), 'edges': np.array(springs).ravel().tolist(), 'regions': cage_regions.tolist(), 'genitalWeights': np.round(cage_genital, 6).tolist(), 'genitalAnchor': np.round(points[surface_genital > .1].max(axis=0) * [0, 1, 0] + points[surface_genital > .1].mean(axis=0) * [0, 0, 1], 6).tolist(), 'regionNames': REGIONS, 'height': height, 'sex': sex, 'eyes': eye_centers, 'canonicalVertices': len(points), 'model': 'Anchored surface spring network; not a volumetric anatomical tissue model.'}
    (OUT / f'{sex}-cage.json').write_text(json.dumps(cage_doc, separators=(',', ':')))
    glb.save(OUT / f'{sex}.glb', doc)
    # Small geometry-only file for offline model inspection.
    np.savez(ROOT / '.sites-runtime' / f'{sex}-qa.npz', points=points, triangles=canonical_triangles)
    manifest['models'][sex] = {'heightMeters': height, 'vertices': len(render_ids), 'triangles': len(triangles), 'particles': len(cage), 'springs': len(springs), 'bones': len(bones), 'textured': skin_path.exists(), 'anatomy': 'MHX2 joined external genital mesh', 'genitalParticles': int(np.sum(cage_regions == 8)), 'sha256': hashlib.sha256((OUT / f'{sex}.glb').read_bytes()).hexdigest()}
    print(sex, manifest['models'][sex], flush=True)
(OUT / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
(OUT / 'CC0-1.0.txt').write_text((SOURCE / 'LICENSE.ASSETS.md').read_text())
(OUT / 'ATTRIBUTION.txt').write_text('Male and female body assets derived from MakeHuman / MPFB.\nSource: https://github.com/makehumancommunity/mpfb2\nCommit: ' + manifest['sourceCommit'] + '\nLicense: CC0 1.0 Universal (body mesh, adult shape targets, rig, weights).\nSkin textures: MakeHuman system assets, CC0.\nhttps://static.makehumancommunity.org/assets/assetpacks/makehuman_system_assets.html\nModified: adult shapes interpolated, units converted to meters, Catmull-Clark subdivision, glTF conversion, simulation cage.\nAdditional external anatomy: MHX2 / Thomas Larsson, penis.mxa and vulva.mxa.\nSource: https://github.com/makehumancommunity/mhx2-makehuman-exchange\nAsset license clarification: https://thomasmakehuman.wordpress.com/license-information/ (extra importer content released CC0).\nOriginal historical license metadata is retained in the upstream sources.\nThe simulation parameters and regions are illustrative and have not been calibrated to measured human tissue.\n')
