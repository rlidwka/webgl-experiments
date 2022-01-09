import * as THREE from 'three'
import { GLTFLoader } from './node_modules/three/examples/jsm/loaders/GLTFLoader.js'
import { ConvexGeometry } from './node_modules/three/examples/jsm/geometries/ConvexGeometry.js'
import { OrbitControls } from './node_modules/three/examples/jsm/controls/OrbitControls.js';
import { Line2 } from './node_modules/three/examples/jsm/lines/Line2.js';
import { LineMaterial } from './node_modules/three/examples/jsm/lines/LineMaterial.js';
import { LineGeometry } from './node_modules/three/examples/jsm/lines/LineGeometry.js';
import './node_modules/knockout/build/output/knockout-latest.js'

const fuel_types = {
  h2:     { text: 'H₂',     color: '#ffffff', melt:  14.01, boil:  20.28 },
  o2:     { text: 'O₂',     color: '#f40200', melt:  54.36, boil:  90.19 },
  h2o:    { text: 'H₂O',    color: '#2389da', melt: 273.15, boil: 373.15 },
  ch4:    { text: 'CH₄',    color: '#007035', melt:  90.55, boil: 111.51 },
  c2h4:   { text: 'C₂H₄',   color: '#3e3e3e', melt: 104.15, boil: 169.00 },
  c2h5oh: { text: 'C₂H₅OH', color: '#76d2c3', melt: 159.05, boil: 351.65 },
  n2h4:   { text: 'N₂H₄',   color: '#2063ff', melt: 275.15, boil: 386.65 },
  nh3:    { text: 'NH₃',    color: '#908905', melt: 195.40, boil: 239.81 }
}

let active_popovers = new Set()
let models = {}

function Vec3(x, y, z) {
  return new THREE.Vector3(x, y, z)
}

await Promise.all([ 'engine', 'tank', 'stairs' ].map(file => {
  return new Promise(resolve => {
    new GLTFLoader()
      .load(`models/${file}.glb`, function (gltf) {
        models[file] = gltf
        resolve()
      })
  })
}))

class Popover {
  constructor(cls) {
    this.element = document.getElementsByClassName(cls)[0]
    this.data = {}
    this.init()
    ko.applyBindings(this.data, this.element)
  }

  show(x, y) {
    this.element.classList.add('show')
    this.element.style.left = x + 'px'
    this.element.style.top = y + 'px'
    active_popovers.add(this)
  }

  hide() {
    this.element.classList.remove('show')
    active_popovers.delete(this)
  }
}

let tank_popover = new class TankPopover extends Popover {
  constructor() {
    super('popover-tank')
    this.assign = () => {}
  }

  init() {
    this.data.contents    = ko.observable()
    this.data.temperature = ko.observable()
    this.data.full        = ko.observable()
    this.data.matter_class = ko.computed(() => {
      let type = fuel_types[this.data.contents()]
      let temp = this.data.temperature() + 273.15
      if (type) {
        if (temp >= type.boil) return 'icon-cloud'
        if (temp >= type.melt) return 'icon-droplet'
        return 'icon-cube'
      }
    })

    this.data.contents_text = ko.computed(() => fuel_types[this.data.contents()]?.text)

    this.data.fill  = () => this.fill()
    this.data.empty = () => this.empty()

    this.data.fuel_types = ko.observableArray(
      Object.entries(fuel_types).map(([ name, value ]) => ({ name, value: value.text }))
    )
  }

  reset(liquid) {
    this.data.contents(liquid?.type)
    this.data.temperature(liquid?.temperature ?? 20)
    this.data.full(Boolean(liquid?.type))
  }

  fill() {
    if (!this.data.contents()) return
    this.data.full(true)
    this.assign({
      type: this.data.contents(),
      temperature: this.data.temperature()
    })
  }

  empty() {
    this.data.full(false)
    this.assign(null)
  }
}

function vec2str(vec) {
  return `${vec.x}:${vec.y}:${vec.z}`
}

let pipe_mgr = new class PipeManager {
  constructor() {
    this.start = null
    this.mesh = null
  }

  click(pos, vox) {
    if (vox?.contains instanceof Stairs) {
      vox.contains.click()
      this.start && this.start.vox.contains.highlight(0xa3f0ff)
      return
    }

    let plist = vox?.contains?.can_connect?.(pos)
    if (!plist) return
    if (!plist.size) return

    this.reset_mesh()

    if (!this.start) {
      this.start = { pos, vox }
      this.from_set = plist
      vox.contains.highlight(0xa3f0ff)
      highlighted.delete(vox.contains)
      return
    }

    if (this.start.vox?.contains === vox?.contains) {
      this.start = null
      return
    }

    let to_set = vox.contains.can_connect(pos)
    if (!to_set) return

    let path = pipe_mgr.pathfind(this.from_set, to_set, this.start.vox.contains, vox.contains)
    if (!path) return

    this.start = null
    new Pipe(path).do_place(ship)
    ship_draw()
  }

  reset_mesh() {
    if (this.mesh) {
      scene.remove(this.mesh)
      this.mesh = null
    }
  }

  reset_all() {
    this.reset_mesh()
    this.start?.vox?.contains?.highlight?.(false)
    this.start = null
  }

  move(pos, vox) {
    this.reset_mesh()

    if (vox?.contains) {
      if (vox?.contains instanceof Stairs) {
        vox.contains.highlight(0x00aa00)
        highlighted.add(vox.contains)
      } else if (vox.contains.can_connect?.(pos)?.size) {
        vox.contains.highlight(this.start ? 0xa3f0ff : 0x00aa00)
        highlighted.add(vox.contains)
        renderer.domElement.style.cursor = 'pointer'
      }
    }

    if (!vox?.deck) return
    if (!this.start) return

    renderer.domElement.style.cursor = 'grabbing'
    this.start.vox.contains.highlight(0xa3f0ff)
    highlighted.delete(this.start.vox.contains)

    if (vox.contains?.equals(this.start.vox.contains)) return

    let to_set = new Set()

    if (vox.contains) {
      to_set = vox.contains?.can_connect(pos)
    } else {
      for (let dx of [ -.25, .25 ]) 
        for (let dy of [ -.25, .25 ])
          for (let dz of [ -.25, .25 ]) {
            if (!vox.contains || vox.pipes[vec2str(Vec3(dx, dy, dz))]) continue
            to_set.add(vec2str(Vec3(pos.x + dx, pos.y + dy, pos.z + dz)))
          }
    }

    let path = pipe_mgr.pathfind(this.from_set, to_set, this.start.vox.contains, vox.contains)
    if (!path) return

    this.mesh = new Pipe(path).draw(path)
    scene.add(this.mesh)
  }

  is_free(pos_f, to_set, from, to) {
    if (to_set.has(vec2str(pos_f))) return true

    let pos = pos_f.clone().round()
    let vox = ship.maybe_voxel(pos.x, pos.y, pos.z)
    if (!vox) return false
    if (!vox.deck) return false
    if (vox.contains && vox.contains !== from && vox.contains !== to) return false
    if (vox.pipes[vec2str(pos_f.clone().sub(pos))]) return false
    return true
  }

  get_adjacent(pos_f, to_set, from, to) {
    let pos = pos_f.clone().round()
    let result = new Set()
    let vec

    vec = Vec3(pos_f.x - .5, pos_f.y, pos_f.z)
    if (this.is_free(vec, to_set, from, to)) result.add(vec)
    vec = Vec3(pos_f.x + .5, pos_f.y, pos_f.z)
    if (this.is_free(vec, to_set, from, to)) result.add(vec)

    vec = Vec3(pos_f.x, pos_f.y - .5, pos_f.z)
    if (this.is_free(vec, to_set, from, to)) result.add(vec)
    vec = Vec3(pos_f.x, pos_f.y + .5, pos_f.z)
    if (this.is_free(vec, to_set, from, to)) result.add(vec)

    vec = Vec3(pos_f.x, pos_f.y, pos_f.z - .5)
    if (this.is_free(vec, to_set, from, to)) result.add(vec)
    vec = Vec3(pos_f.x, pos_f.y, pos_f.z + .5)
    if (this.is_free(vec, to_set, from, to)) result.add(vec)

    return result
  }

  pathfind(from_set, to_set, from, to) {
    let visited = new Set()
    let tentative = new Set()
    let distances = new Map()
    let previous = new Map()
    let found_s

    for (let from_f_s of from_set) {
      distances.set(from_f_s, 0)
      previous.set(from_f_s, null)
      tentative.add(from_f_s)
    }

    while (tentative.size > 0) {
      let current_s = null
      let currdist = Infinity

      for (let t of tentative) {
        let d = distances.get(t)
        if (d < currdist) {
          current_s = t
          currdist = d
        }
      }

      if (to_set.has(current_s)) {
        found_s = current_s
        break
      }

      let current = Vec3(...current_s.split(':').map(Number))

      for (let vec of this.get_adjacent(current, to_set, from, to)) {
        let s = vec2str(vec)
        let vecdist = distances.has(s) ? distances.get(s) : Infinity
        if (vecdist > currdist + 1) {
          distances.set(s, currdist + 1)
          previous.set(s, current_s)
          tentative.add(s)
        }
      }

      tentative.delete(vec2str(current))
      visited.add(vec2str(current))
    }

    if (!found_s) return null

    let result = []
    let backtrack_curr = found_s

    while (backtrack_curr) {
      result.push(Vec3(...backtrack_curr.split(':').map(Number)))
      backtrack_curr = previous.get(backtrack_curr)
    }
    return result
  }
}

class Pipe {
  constructor(path) {
    this.draw_id = 0
    this.path = path
  }

  do_place(ship) {
    for (let p of this.path) {
      let vec = p.clone().round()
      ship.get_voxel(vec.x, vec.y, vec.z).drawables.add(this)
      ship.get_voxel(vec.x, vec.y, vec.z).pipes[vec2str(p.clone().sub(vec))] = this
    }
  }

  do_remove() {
    for (let p of this.path) {
      let vec = p.clone().round()
      ship.get_voxel(vec.x, vec.y, vec.z).drawables.delete(this)
      delete ship.get_voxel(vec.x, vec.y, vec.z).pipes[vec2str(p.clone().sub(vec))]
    }
  }

  draw(id = 0, vec = null) {
    if (id && id === this.draw_id) return

    this.draw_id = id

    let geometry = new LineGeometry()

    let positions = []
    let colors = []

    for (let v of this.path) {
      positions.push(v.x, v.y, v.z)
      colors.push(1, 1, 1)
    }

    positions = positions.map(x => {
      let rx = Math.round(x)
      return rx + (x - rx) / 2
    })

    geometry.setPositions(positions)
    geometry.setColors(colors)

    let material = new LineMaterial({
      color: 0x888888,
      linewidth: .05,
      vertexColors: true,
      alphaToCoverage: true,
      worldUnits: true
    })

    return new Line2(geometry, material)
  }
}

class Ship {
  constructor() {
    // coordinates are: [ z, x, y ]
    this._voxels = {}
    this.level = 0
  }

  get_voxel(x, y, z) {
    this._voxels[z] ??= {}
    this._voxels[z][x] ??= {}
    this._voxels[z][x][y] ??= { drawables: new Set(), pipes: {} }
    return this._voxels[z][x][y]
  }

  maybe_voxel(x, y, z) {
    return this._voxels[z]?.[x]?.[y]
  }

  clean_voxel(x, y, z) {
    let pipes = new Set()
    for (let p of Object.values(this._voxels[z][x][y].pipes)) pipes.add(p)
    for (let p of pipes) p.do_remove()

    if (this._voxels[z][x][y].contains) return
    if (this._voxels[z][x][y].drawables.size) return
    delete this._voxels[z][x][y]
    if (Object.keys(this._voxels[z][x]).length) return
    delete this._voxels[z][x]
    if (Object.keys(this._voxels[z]).length) return
    delete this._voxels[z]
  }

  is_inside(x, y, z) {
    return !!this._voxels[z]?.[x]?.[y]?.deck
  }

  is_empty(x, y, z) {
    let v = this._voxels[z]?.[x]?.[y]
    if (!v) return true
    if (v.contains) return false
    if (Object.keys(v.pipes).length !== 0) return false
    return true
  }

  each(fn) {
    let vec = Vec3()

    for (let z of Object.keys(this._voxels)) {
      z = +z
      for (let x of Object.keys(this._voxels[z])) {
        x = +x
        for (let y of Object.keys(this._voxels[z][x])) {
          vec.x = +x
          vec.y = +y
          vec.z = +z
          if (fn(this._voxels[z][x][y], vec) === false) return
        }
      }
    }
  }

  armor(vox, vec, dx, dy, dz) {
    if (vec.z + dz > ship.level) return
    if (this.maybe_voxel(vec.x + dx, vec.y + dy, vec.z + dz)) return

    let matrix = new THREE.Matrix3()

    if (dx) {
      matrix.set(
        0, 0, dx,
        1, 0, 0,
        0, 1, 0
      )
    } else if (dy) {
      matrix.set(
        0, 1, 0,
        0, 0, dy,
        1, 0, 0
      )
    } else if (dz) {
      matrix.set(
        1, 0, 0,
        0, 1, 0,
        0, 0, dz
      )
    }

    let points = []

    points.push(Vec3(-1, -1, 1))
    points.push(Vec3(1, -1, 1))
    points.push(Vec3(-1, 1, 1))
    points.push(Vec3(1, 1, 1))

    let vdiff = Vec3(dx, dy, dz)

    let check = (dx, dy) => {
      let vt = Vec3(dx, dy, 0).applyMatrix3(matrix).add(vec)
      if (!this.maybe_voxel(vt.x, vt.y, vt.z)?.deck) return false

      vt.add(vdiff)
      if (this.maybe_voxel(vt.x, vt.y, vt.z)) return false
      return true
    }

    let xn = false, yn = false, xp = false, yp = false
    if (check(0, -1)) {
      points.push(Vec3(-1, -3, 1))
      points.push(Vec3(1, -3, 1))
      yn = true
    }
    if (check(0, 1)) {
      points.push(Vec3(-1, 3, 1))
      points.push(Vec3(1, 3, 1))
      yp = true
    }
    if (check(-1, 0)) {
      points.push(Vec3(-3, 1, 1))
      points.push(Vec3(-3, -1, 1))
      xn = true
    }
    if (check(1, 0)) {
      points.push(Vec3(3, 1, 1))
      points.push(Vec3(3, -1, 1))
      xp = true
    }

    if (xn && yn && check(-1, -1)) {
      points.push(Vec3(-3, -3, 1))
    }
    if (xn && yp && check(-1, 1)) {
      points.push(Vec3(-3, 3, 1))
    }
    if (xp && yn && check(1, -1)) {
      points.push(Vec3(3, -3, 1))
    }
    if (xp && yp && check(1, 1)) {
      points.push(Vec3(3, 3, 1))
    }

    points.push(Vec3(-3, -3, 0))
    points.push(Vec3(3, -3, 0))
    points.push(Vec3(-3, 3, 0))
    points.push(Vec3(3, 3, 0))

    let geometry = new ConvexGeometry(points)

    let uv = []
    let position = geometry.attributes.position.array

    for (let i = 0; i < position.length; i += 3) {
      uv.push(position[i] / 6 + .5)
      uv.push(position[i + 1] / 6 + .5)
    }

    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));

    let material = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide })
    material.map = texture_hull

    let mesh = new THREE.Mesh(geometry, material)
    let t

    matrix = new THREE.Matrix4().setFromMatrix3(matrix)
    matrix.multiply(new THREE.Matrix4().makeScale(1/6, 1/6, 1/6))
    mesh.applyMatrix4(matrix)

    t = .5
    mesh.position.x = vec.x + dx*t
    mesh.position.y = vec.y + dy*t
    mesh.position.z = vec.z + dz*t

    return mesh
  }

  draw() {
    let group = new THREE.Group()

    this.each((vox, vec) => {
      if (vec.z > ship.level) return
      if (!vox.deck) return
      let mesh
      mesh = this.armor(vox, vec, 0, 0, 1)
      if (mesh) group.add(mesh)
      mesh = this.armor(vox, vec, 0, 0, -1)
      if (mesh) group.add(mesh)
      mesh = this.armor(vox, vec, 0, 1, 0)
      if (mesh) group.add(mesh)
      mesh = this.armor(vox, vec, 0, -1, 0)
      if (mesh) group.add(mesh)
      mesh = this.armor(vox, vec, 1, 0, 0)
      if (mesh) group.add(mesh)
      mesh = this.armor(vox, vec, -1, 0, 0)
      if (mesh) group.add(mesh)
    })

    let draw_id = Math.random()

    this.each((vox, vec) => {
      if (vec.z > ship.level) return
      for (let drawable of vox.drawables) {
        let mesh = drawable.draw(draw_id, vec)
        if (mesh) group.add(mesh)
      }
    })

    return group
  }
}


class Placeable {
  constructor() {
    this.mesh = null
    this.position = null
    this.matmap = new WeakMap()
  }

  clone() {
    return new this.constructor()
  }

  highlight(color = null) {
    let material = new THREE.MeshBasicMaterial({ color })

    material.opacity = 0.7
    material.transparent = true

    this.mesh.traverse(mesh => {
      if (mesh.type !== 'Mesh') return
      if (color) {
        if (!this.matmap.has(mesh)) this.matmap.set(mesh, mesh.material)
        mesh.material = material
      } else {
        if (this.matmap.has(mesh)) mesh.material = this.matmap.get(mesh)
      }
    })
  }

  equals(x) {
    return this === x
  }
}

class Deck extends Placeable {
  constructor(size) {
    super()
    this.size = size
    this.floor = true
    this.offset = Vec3(this.size / 2 - .5, this.size / 2 - .5, 0)
  }

  clone() {
    return new this.constructor(this.size)
  }

  can_place(ship, vec) {
    vec = vec.clone().sub(this.offset).round()

    if (Object.keys(ship._voxels).length) {
      for (let dx = 0; dx < this.size; dx++) {
        for (let dy = 0; dy < this.size; dy++) {
          if (ship.is_inside(vec.x + dx, vec.y + dy, vec.z)) return null
          if (!ship.is_empty(vec.x + dx, vec.y + dy, vec.z)) return null
        }
      }

      let borders = false
      LOOP: for (let d = 0; d < this.size; d++) {
        if (ship.is_inside(vec.x + d, vec.y - 1, vec.z) ||
            ship.is_inside(vec.x + d, vec.y + this.size, vec.z) ||
            ship.is_inside(vec.x - 1, vec.y + d, vec.z) ||
            ship.is_inside(vec.x + this.size, vec.y + d, vec.z)) {
          borders = true
          break LOOP
        }
      }

      if (!borders) return null
    }

    vec.add(this.offset)
    return vec
  }

  do_place(ship, vec) {
    vec = vec.clone().sub(this.offset)

    for (let dx = 0; dx < this.size; dx++) {
      for (let dy = 0; dy < this.size; dy++) {
        let d = this.clone()
        d.position = Vec3(vec.x + dx, vec.y + dy, vec.z)
        ship.get_voxel(vec.x + dx, vec.y + dy, vec.z).deck = d
        ship.get_voxel(vec.x + dx, vec.y + dy, vec.z).drawables.add(d)
      }
    }
  }

  can_remove() {
    if (this.dfs_cache?.result) return this.dfs_cache.result
    let any, count = 0

    ship.each((vox, vec) => {
      if (vox.deck && vox.deck !== this) {
        any = vox.deck
        count++
      }
    })

    let traversed = new Set()

    let dfs = (deck, dx, dy, dz) => {
      let v = ship.maybe_voxel(deck.position.x + dx, deck.position.y + dy, deck.position.z + dz)
      if (!v?.deck || v.deck === this) return
      if (traversed.has(v.deck)) return
      traversed.add(v.deck)
      dfs(v.deck, 0, 0, 1)
      dfs(v.deck, 0, 1, 0)
      dfs(v.deck, 1, 0, 0)
      dfs(v.deck, 0, 0, -1)
      dfs(v.deck, 0, -1, 0)
      dfs(v.deck, -1, 0, 0)
    }

    if (!any) return true

    dfs(any, 0, 0, 0)
    this.dfs_cache = { result: count === traversed.size }

    return count === traversed.size
  }

  do_remove() {
    let vec = this.position
    delete ship.get_voxel(vec.x, vec.y, vec.z).deck
    ship.get_voxel(vec.x, vec.y, vec.z).drawables.delete(this)
    ship.clean_voxel(vec.x, vec.y, vec.z)
    if (!(ship.level in ship._voxels)) {
      if ((ship.level + 1) in ship._voxels) ship.level++
      if ((ship.level - 1) in ship._voxels) ship.level--
    }

    let upper = ship.maybe_voxel(vec.x, vec.y, vec.z + 1)?.deck
    if (upper) upper.floor = true
  }

  draw(id = 0, vec = null) {
    this.dfs_cache = null
    if (!vec) {
      let geometry = new THREE.BoxGeometry(this.size, this.size, 1)
      let material = new THREE.MeshBasicMaterial()
      let mesh = new THREE.Mesh(geometry, material)
      this.mesh = mesh

      return mesh
    }

    let group = new THREE.Group()

    let material_beam1 = new THREE.MeshBasicMaterial({ color: 0x777777 })
    material_beam1.map = texture_beam
    material_beam1.polygonOffset = true
    material_beam1.polygonOffsetFactor = -.01

    let material_beam2 = new THREE.MeshBasicMaterial({ color: 0x777777 })
    material_beam2.map = texture_beam

    let { x, y, z } = vec
    let geometry = new THREE.BoxGeometry()

    if (this.floor) {
      let material = new THREE.MeshBasicMaterial({ color: 0xffffff })
      material.map = texture
      material.polygonOffset = true
      material.polygonOffsetFactor = .01
      let cube = new THREE.Mesh(geometry, material)
      group.add(cube)
      cube.position.x = x
      cube.position.y = y
      cube.position.z = z - .5 + .1
      cube.scale.z = .1
    }

    let upins = false//!!ship.maybe_voxel(x, y, z + 1)?.deck

    if (!ship.maybe_voxel(x, y - 1, z)?.deck) {
      let cube = new THREE.Mesh(geometry, material_beam1)
      group.add(cube)
      cube.position.x = x
      cube.position.y = y - .5 + .05
      cube.position.z = z + (upins ? .05 : 0)
      cube.scale.y = .1
      cube.scale.z = (upins ? 1.1 : 1)
    }

    if (!ship.maybe_voxel(x, y + 1, z)?.deck) {
      let cube = new THREE.Mesh(geometry, material_beam1)
      group.add(cube)
      cube.position.x = x
      cube.position.y = y + .5 - .05
      cube.position.z = z + (upins ? .05 : 0)
      cube.scale.y = .1
      cube.scale.z = (upins ? 1.1 : 1)
    }

    if (!ship.maybe_voxel(x - 1, y, z)?.deck) {
      let cube = new THREE.Mesh(geometry, material_beam2)
      group.add(cube)
      cube.position.x = x - .5 + .05
      cube.position.y = y
      cube.position.z = z + (upins ? .05 : 0)
      cube.scale.x = .1
      cube.scale.z = (upins ? 1.1 : 1)
      if (ship.maybe_voxel(x, y - 1, z)?.deck) {
        cube.scale.y += .1
        cube.position.y -= .05
      }
      if (ship.maybe_voxel(x, y + 1, z)?.deck) {
        cube.scale.y += .1
        cube.position.y += .05
      }
    }

    if (!ship.maybe_voxel(x + 1, y, z)?.deck) {
      let cube = new THREE.Mesh(geometry, material_beam2)
      group.add(cube)
      cube.position.x = x + .5 - .05
      cube.position.y = y
      cube.position.z = z + (upins ? .05 : 0)
      cube.scale.x = .1
      cube.scale.z = (upins ? 1.1 : 1)
      if (ship.maybe_voxel(x, y - 1, z)?.deck) {
        cube.scale.y += .1
        cube.position.y -= .05
      }
      if (ship.maybe_voxel(x, y + 1, z)?.deck) {
        cube.scale.y += .1
        cube.position.y += .05
      }
    }

    this.mesh = group
    return group
  }
}

class Stairs extends Placeable {
  constructor(direction) {
    super()
    this.direction = direction
    this.offset = Vec3(0, .1, -.2)
    this.level = 0
  }

  clone() {
    return new this.constructor(this.direction)
  }

  click(ev) {
    if (ship.level === this.level) {
      ship.level += this.direction
    } else if (ship.level > this.level) {
      ship.level--
    } else if (ship.level < this.level) {
      ship.level++
    }
    ship_draw()
  }

  can_place(ship, vec) {
    vec = vec.clone().sub(this.offset).round()
    vec.z = ship.level

    let vox

    vox = ship.maybe_voxel(vec.x, vec.y, vec.z)
    if (!vox?.deck) return null
    if (!vox?.deck?.floor) return null
    if (!ship.is_empty(vec.x, vec.y, vec.z)) return null

    if (ship.is_inside(vec.x, vec.y, vec.z + this.direction)) return null
    if (!ship.is_empty(vec.x, vec.y, vec.z + this.direction)) return null

    vec.add(this.offset)
    if (this.direction < 0) vec.z--
    return vec
  }

  do_place(ship, vec) {
    vec = vec.clone().sub(this.offset)
    if (this.direction < 0) vec.z++
    this.position = vec

    let deck = new Deck(1)
    deck.do_place(ship, Vec3(vec.x, vec.y, vec.z + this.direction))

    ship.get_voxel(vec.x, vec.y, vec.z + (this.direction < 0 ? 0 : 1)).deck.floor = false

    this.level = vec.z
    ship.get_voxel(vec.x, vec.y, vec.z).contains = this
    ship.get_voxel(vec.x, vec.y, vec.z + this.direction).contains = this
    ship.get_voxel(vec.x, vec.y, vec.z + (this.direction < 0 ? -1 : 0)).drawables.add(this)

    ship.level += this.direction
    document.getElementsByClassName('icon-block-1')[0].click()
  }

  can_remove() {
    return true
  }

  do_remove() {
    let vec = this.position
    delete ship.get_voxel(vec.x, vec.y, vec.z).contains
    ship.get_voxel(vec.x, vec.y, vec.z).drawables.delete(this)
    ship.clean_voxel(vec.x, vec.y, vec.z)
    delete ship.get_voxel(vec.x, vec.y, vec.z + this.direction).contains
    ship.get_voxel(vec.x, vec.y, vec.z + this.direction).drawables.delete(this)
    ship.clean_voxel(vec.x, vec.y, vec.z + this.direction)
  }

  draw(id = 0, vec = null) {
    let stairs = models.stairs.scene.clone()

    stairs.scale.x = .4
    stairs.scale.y = 1.2
    stairs.scale.z = .4
    stairs.rotation.x = Math.PI / 2

    if (vec) {
      stairs.position.add(this.offset)
      stairs.position.add(vec)
    }

    let material = new THREE.MeshBasicMaterial()
    material.color.set(0x888888)
    material.map = texture_alum

    stairs.traverse(mesh => {
      if (mesh.type !== 'Mesh') return
      mesh.material = material
    })

    this.mesh = stairs

    return stairs
  }
}

class Engine extends Placeable {
  constructor() {
    super()
    this.offset = Vec3(0, 1 - .22, 0)
  }

  can_connect(vec) {
    let res = new Set()

    if (!vec.clone().add(Vec3(0, -1, 0)).equals(this.position)) return res
    let vox = ship.get_voxel(vec.x, vec.y, vec.z)

    for (let dx of [ -.25, .25 ]) 
      for (let dy of [ -.25, .25 ])
        for (let dz of [ -.25, .25 ]) {
          if (vox.pipes[vec2str(Vec3(dx, dy, dz))]) continue
          res.add(vec2str(Vec3(vec.x + dx, vec.y + dy, vec.z + dz)))
        }

    return res
  }

  can_place(ship, vec) {
    vec = vec.clone().sub(this.offset).round()

    if (!ship.is_inside(vec.x, vec.y + 1, vec.z)) return null
    if (ship.is_inside(vec.x, vec.y, vec.z)) return null

    if (!ship.is_empty(vec.x, vec.y + 1, vec.z)) return null
    if (!ship.is_empty(vec.x, vec.y, vec.z)) return null

    vec.add(this.offset)
    return vec
  }

  do_place(ship, vec) {
    vec = vec.clone().sub(this.offset)
    this.position = vec

    ship.get_voxel(vec.x, vec.y, vec.z).contains = this
    ship.get_voxel(vec.x, vec.y, vec.z).drawables.add(this)
    ship.get_voxel(vec.x, vec.y + 1, vec.z).contains = this
  }

  can_remove() {
    return true
  }

  do_remove() {
    let vec = this.position
    delete ship.get_voxel(vec.x, vec.y, vec.z).contains
    ship.get_voxel(vec.x, vec.y, vec.z).drawables.delete(this)
    delete ship.get_voxel(vec.x, vec.y + 1, vec.z).contains
    ship.clean_voxel(vec.x, vec.y, vec.z)
    ship.clean_voxel(vec.x, vec.y + 1, vec.z)
  }

  draw(id = 0, vec = null) {
    let engine = models.engine.scene.clone()

    engine.rotation.x = Math.PI / 2
    engine.scale.x = .6
    engine.scale.y = .6
    engine.scale.z = .6

    if (vec) {
      engine.position.add(this.offset)
      engine.position.add(vec)
    }

    let material = new THREE.MeshBasicMaterial()

    if (!vec) {
      engine.traverse(mesh => {
        if (mesh.type !== 'Mesh') return
        mesh.material = material
      })
    }

    this.mesh = engine

    return engine
  }
}

class Tank extends Placeable {
  constructor() {
    super()
    this.offset = Vec3(0, 0, 0)
    this.prev = null
    this.next = null
    this.liquid = null
  }

  equals(x) {
    if (!(x instanceof this.constructor)) return false
    let a = this
    let b = x

    while (a.next) a = a.next
    while (b.next) b = b.next
    return a === b
  }

  can_connect(vec) {
    let res = new Set()

    if (!vec.equals(this.position)) return res
    let vox = ship.get_voxel(vec.x, vec.y, vec.z)

    for (let dx of [ -.25, .25 ]) 
      for (let dy of [ -.25, .25 ])
        for (let dz of [ -.25 ]) {
          if (vox.pipes[vec2str(Vec3(dx, dy, dz))]) continue
          res.add(vec2str(Vec3(vec.x + dx, vec.y + dy, vec.z + dz)))
        }

    return res
  }

  can_place(ship, vec) {
    vec = vec.clone().sub(this.offset).round()
    let vox = ship.maybe_voxel(vec.x, vec.y, vec.z)
    if (!vox?.deck) return null
    if (!vox?.deck?.floor) return null
    if (!ship.is_empty(vec.x, vec.y, vec.z)) return null

    let t1 = ship.maybe_voxel(vec.x, vec.y - 1, vec.z)
    let t2 = ship.maybe_voxel(vec.x, vec.y + 1, vec.z)
    if (t1?.contains instanceof this.constructor && t2?.contains instanceof this.constructor) {
      if (t1.contains.liquid && t1.contains.liquid.type !== t2.contains.liquid.type) {
        return null
      }
    }

    vec.add(this.offset)
    return vec
  }

  click(ev) {
    if (this.next) return this.next.click(ev)

    tank_popover.assign = value => {
      this.liquid = value
      ship_draw()
    }
    tank_popover.reset(this.liquid)
    tank_popover.show(ev.clientX, ev.clientY)
  }

  do_place(ship, vec) {
    this.position = vec
    vec = vec.clone().sub(this.offset)

    ship.get_voxel(vec.x, vec.y, vec.z).contains = this
    ship.get_voxel(vec.x, vec.y, vec.z).drawables.add(this)

    ship.each((vox, vec) => {
      if (vox.contains instanceof this.constructor) vox.contains.unlink()
    })

    ship.each((vox, vec) => {
      if (vox.contains instanceof this.constructor) vox.contains.link(ship, vec)
    })

    let next = ship.maybe_voxel(vec.x, vec.y + 1, vec.z)
    if (next?.contains instanceof this.constructor) {
      this.liquid = next.contains.liquid
    }
  }

  can_remove() {
    return true
  }

  do_remove() {
    if (this.next) return this.next.do_remove()

    let vec = this.position
    delete ship.get_voxel(vec.x, vec.y, vec.z).contains
    ship.get_voxel(vec.x, vec.y, vec.z).drawables.delete(this)
    ship.clean_voxel(vec.x, vec.y, vec.z)

    if (this.prev) {
      this.prev.next = null
      this.prev.do_remove()
    }
    this.unlink()
  }

  link(ship, vec) {
    let v = ship.maybe_voxel(vec.x, vec.y - 1, vec.z)
    if (v?.contains instanceof this.constructor) {
      this.next = v.contains
      v.contains.prev = this
    }
  }

  unlink(ship) {
    if (this.next) this.liquid = this.next.liquid
    this.prev = null
    this.next = null
  }

  highlight(color = null) {
    if (this.next) return this.next.highlight(color)
    super.highlight(color)
  }

  draw(id = 0, vec = null) {
    if (this.next) return

    let height = 0

    if (vec) {
      for (let dy = 1; ; dy++) {
        let v = ship.maybe_voxel(vec.x, vec.y + dy, vec.z)
        if (!(v?.contains instanceof this.constructor)) break
        height++
      }
    }

    let tank = models.tank.scene.clone()

    tank.rotation.x = Math.PI / 2
    tank.scale.x = .25
    tank.scale.y = .25
    tank.scale.z = .25
    tank.position.z = -.1
    tank.position.y += height / 2

    if (vec) {
      tank.position.add(this.offset)
      tank.position.add(vec)
    }

    let material = new THREE.MeshBasicMaterial()
    material.color.set(0x888888)
    material.map = texture_alum

    tank.traverse(mesh => {
      if (mesh.type !== 'Mesh') return

      if (mesh.name === 'side-1') {
        mesh.position.z += height * 2
      }

      if (mesh.name === 'side-2') {
        mesh.position.z -= height * 2
      }

      if (mesh.name === 'base') {
        mesh.position.z += height * 2
        mesh.scale.y *= 1 + height * 2
      }

      if (mesh.name === 'material') {
        let material = new THREE.MeshBasicMaterial()
        if (this.liquid) {
          material.color.set(fuel_types[this.liquid.type].color)
        }

        mesh.material = material
        mesh.position.z += height * 2
        mesh.scale.y *= 1 + height * 2
        mesh.visible = !!this.liquid
        return
      }

      mesh.material = material
    })

    this.mesh = tank

    return tank
  }
}


  const texture = new THREE.TextureLoader().load('/textures/metal.jpg')
  texture.wrapS = THREE.RepeatWrapping
  texture.wrapT = THREE.RepeatWrapping
  texture.repeat.set(2, 2)

  const texture_beam = new THREE.TextureLoader().load('/textures/metal_beam.jpg')
  texture_beam.wrapS = THREE.RepeatWrapping
  texture_beam.wrapT = THREE.RepeatWrapping
  texture_beam.repeat.set(2, 2)

  const texture_alum = new THREE.TextureLoader().load('/textures/aluminium.jpg')
  texture_beam.wrapS = THREE.RepeatWrapping
  texture_beam.wrapT = THREE.RepeatWrapping
  texture_beam.repeat.set(1, 1)

  const texture_gl = new THREE.TextureLoader().load('/textures/uv_grid_opengl.jpg')
  texture_beam.wrapS = THREE.RepeatWrapping
  texture_beam.wrapT = THREE.RepeatWrapping
  texture_beam.repeat.set(1, 1)

  const texture_hull = new THREE.TextureLoader().load('/textures/hull.jpg')
  texture_beam.wrapS = THREE.RepeatWrapping
  texture_beam.wrapT = THREE.RepeatWrapping
  texture_beam.repeat.set(1, 1)


let scene = new THREE.Scene()
let camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000)

const light = new THREE.AmbientLight(0x404040, 2);
scene.add(light);

let ship = new Ship()
window._ship = ship

/*for (let x=-2;x<=0;x++)
for (let y=-2;y<=0;y++)
for (let z=-2;z<=0;z++)
new Deck(1).do_place(ship, Vec3(x, y, z))
new Tank().do_place(ship, Vec3(1, 1, 0))
//new Tank().do_place(ship, Vec3(0, 1, 0))
//new Tank().do_place(ship, Vec3(1, 2, 0))
*/

  new Deck(1).do_place(ship, Vec3(0, 0, 0))
  new Deck(1).do_place(ship, Vec3(1, 0, 0))
  new Deck(1).do_place(ship, Vec3(0, 1, 0))
  new Deck(1).do_place(ship, Vec3(1, 1, 0))
  new Deck(1).do_place(ship, Vec3(1, 2, 0))
  new Deck(1).do_place(ship, Vec3(0, 2, 0))
  new Deck(1).do_place(ship, Vec3(2, 0, 0))
  new Deck(1).do_place(ship, Vec3(-1, 3, 0))
  new Deck(1).do_place(ship, Vec3(3, 0, 0))
  new Deck(1).do_place(ship, Vec3(0, 3, 0))
  new Deck(1).do_place(ship, Vec3(1, 3, 0))
  new Deck(1).do_place(ship, Vec3(2, 3, 0))
  new Deck(1).do_place(ship, Vec3(3, 1, 0))
  new Deck(1).do_place(ship, Vec3(3, 2, 0))
  new Deck(1).do_place(ship, Vec3(3, 3, 0))
  new Deck(1).do_place(ship, Vec3(-1, 0, 0))
  new Deck(1).do_place(ship, Vec3(-1, 1, 0))
  new Deck(1).do_place(ship, Vec3(-1, 2, 0))
  new Deck(1).do_place(ship, Vec3(-2, 0, 0))
  new Deck(1).do_place(ship, Vec3(-2, 1, 0))
  new Deck(1).do_place(ship, Vec3(-2, 2, 0))
  new Tank().do_place(ship, Vec3(1, 0, 0))
  new Tank().do_place(ship, Vec3(1, 1, 0))
  new Tank().do_place(ship, Vec3(0, 2, 0))
  new Tank().do_place(ship, Vec3(1, 2, 0))
  new Engine().do_place(ship, Vec3(-1, -0.21999999999999997, 0))


function ship_draw() {
  if (ship_group) scene.remove(ship_group)
  ship_group = ship.draw()
  scene.add(ship_group)
}

let ship_group
ship_draw()

let renderer = new THREE.WebGLRenderer()
renderer.setSize(window.innerWidth, window.innerHeight)
document.body.appendChild(renderer.domElement)

let controls = new OrbitControls(camera, renderer.domElement)
controls.enableDamping = true
controls.minDistance = 1
controls.maxDistance = 10
controls.target.set(0, 0.5, 0)
controls.update()

let selected_mesh
let selected_placeable
let selected_action
let highlighted = new Set()

camera.position.z = 5

function animate() {
  requestAnimationFrame(animate)
  renderer.render(scene, camera)
  controls.update()
}
animate()


function event_world_position(ev) {
  let pos = Vec3()
  let vec = Vec3()
  let zoffset = ship.level

  vec.set(
    (ev.clientX / window.innerWidth) * 2 - 1,
    -(ev.clientY / window.innerHeight) * 2 + 1,
    0.5)

  vec.unproject(camera)

  vec.sub(camera.position).normalize()

  let distance = (zoffset - camera.position.z) / vec.z

  pos.copy(camera.position).add(vec.multiplyScalar(distance))

  return pos
}

document.addEventListener('click', ev => {
  if (ev.target !== renderer.domElement) return
  for (let x of Array.from(document.getElementsByClassName('show'))) x.classList.remove('show')

  let pos = event_world_position(ev)

  if (!selected_placeable) {
    pos.round()
    let v = ship.maybe_voxel(pos.x, pos.y, pos.z)
    if (!selected_action) {
      v?.contains?.click?.(ev)
    } else if (selected_action === 'remove') {
      if (v?.contains) {
        if (v.contains.can_remove?.(pos)) {
          v.contains.do_remove()
          highlighted = new Set()
          ship_draw()
        }
      } else if (v?.deck) {
        if (v.deck.can_remove?.(pos)) {
          v.deck.do_remove()
          highlighted = new Set()
          ship_draw()
        }
      }
    } else if (selected_action === 'pipe') {
      pipe_mgr.click(pos, v)
      /*if (v?.contains) {
        if (v.contains.can_connect?.(pos)?.size) {
          pipe_mgr.click(pos, v)
        }
      }*/
    }
    return
  }

  let free_pos = selected_placeable.can_place(ship, pos)

  if (free_pos) {
    selected_placeable.clone().do_place(ship, free_pos)
    ship_draw()
    selected_placeable.highlight(0xaa0000)
  }  
})

document.addEventListener('mousemove', ev => {
  for (let h of highlighted) h.highlight(false)
  highlighted = new Set()

  if (ev.target !== renderer.domElement) return

  let pos = event_world_position(ev)

  if (!selected_placeable) {
    renderer.domElement.style.cursor = 'default'
    pos.round()
    let v = ship.maybe_voxel(pos.x, pos.y, pos.z)
    if (!selected_action && v?.contains?.click) {
      highlighted.add(v.contains)
      v.contains.highlight(0xa3f0ff)
      renderer.domElement.style.cursor = 'pointer'
    } else if (selected_action === 'remove') {
      if (v?.contains) {
        if (v.contains.can_remove?.(pos)) {
          highlighted.add(v.contains)
          v.contains.highlight(0xaa0000)
          renderer.domElement.style.cursor = 'pointer'
        }
      } else if (v?.deck) {
        if (v.deck.can_remove?.(pos)) {
          highlighted.add(v.deck)
          v.deck.highlight(0xaa0000)
          renderer.domElement.style.cursor = 'pointer'
        }
      }
    } else if (selected_action === 'pipe') {
      //ship.each((vox, vec) => {
      //  if (!vox.contains?.can_connect) return
      //  vox.contains.highlight(0x00aa00)
      //  highlighted.add(vox.contains)
      //})
      pipe_mgr.move(pos, v)
    }
    return
  }

  renderer.domElement.style.cursor = 'grabbing'

  selected_mesh.visible = true

  let free_pos = selected_placeable.can_place(ship, pos)

  if (free_pos) {
    selected_placeable.highlight(0x00aa00)
    selected_mesh.position.copy(free_pos)
  } else {
    selected_placeable.highlight(0xaa0000)
    selected_mesh.position.copy(pos)
  }
})

function select_class(placeable_class, ...args) {
  return function () {
    if (selected_mesh) scene.remove(selected_mesh)

    selected_placeable = new placeable_class(...args)

    selected_mesh = selected_placeable.draw()

    scene.add(selected_mesh)

    selected_mesh.visible = false
  }
}

function select_action(action) {
  return function () {
    if (selected_placeable) {
      scene.remove(selected_mesh)
      selected_mesh = null
      selected_placeable = null
    }

    selected_action = action
  }
}

let controls_fn = {
  'select':     select_action(null),
  'remove':     select_action('remove'),
  'pipe':       select_action('pipe'),
  'block-1':    select_class(Deck, 1),
  'block-2':    select_class(Deck, 2),
  'block-3':    select_class(Deck, 3),
  'engine':     select_class(Engine),
  'tank':       select_class(Tank),
  'level-up':   select_class(Stairs, 1),
  'level-down': select_class(Stairs, -1),
}

document.getElementsByClassName('controls')[0].addEventListener('click', ev => {
  if (!ev.target.dataset.fn) return

  pipe_mgr.reset_all()

  for (let x of Array.from(document.getElementsByClassName('controls')[0].getElementsByClassName('active'))) {
    x.classList.remove('active')
  }

  renderer.domElement.style.cursor = 'default'
  for (let x of Array.from(document.getElementsByClassName('show'))) x.classList.remove('show')

  controls_fn[ev.target.dataset.fn]()
  ev.target.classList.add('active')
})

document.getElementsByClassName('icon-exchange')[0].click()

document.addEventListener('keydown', ev => {
  let action = false

  if (ev.key === 'ArrowLeft') {
    camera.position.x -= .2
    action = true
  } else if (ev.key === 'ArrowRight') {
    camera.position.x += .2
    action = true
  } else if (ev.key === 'ArrowUp') {
    camera.position.y -= .2
    action = true
  } else if (ev.key === 'ArrowDown') {
    camera.position.y += .2
    action = true
  } else if (ev.code === 'Escape') {
    action = true
  }

  if (action) {
    renderer.domElement.style.cursor = 'default'
    for (let x of active_popovers) x.hide()
  }
})

document.addEventListener('wheel', ev => {
  if (ev.target !== renderer.domElement) return
  renderer.domElement.style.cursor = 'default'
  for (let x of active_popovers) x.hide()
  camera.position.z += ev.deltaY / 200
})

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight
  camera.updateProjectionMatrix()
  renderer.setSize(window.innerWidth, window.innerHeight)
})

//scene.add(pipe_mgr.draw(pipe_mgr.pathfind(Vec3(.25,.25,.25), Vec3(-.25,1.75,-.25))))
//scene.add(pipe_mgr.draw([Vec3(.25,.25,.25), Vec3(-.25,1.75,-.25)]))
