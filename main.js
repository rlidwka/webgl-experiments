import * as THREE from 'three'
import { GLTFLoader } from './node_modules/three/examples/jsm/loaders/GLTFLoader.js'
import { ConvexGeometry } from './node_modules/three/examples/jsm/geometries/ConvexGeometry.js'
import { OrbitControls } from './node_modules/three/examples/jsm/controls/OrbitControls.js';
import './node_modules/knockout/build/output/knockout-latest.js'

const fuel_types = {
  h2:     { text: 'H₂',     color: '#ffffff' },
  o2:     { text: 'O₂',     color: '#f40200' },
  h2o:    { text: 'H₂O',    color: '#2389da' },
  ch4:    { text: 'CH₄',    color: '#007035' },
  c2h5oh: { text: 'C₂H₅OH', color: '#76d2c3' },
  n2h4:   { text: 'N₂H₄',   color: '#2063ff' },
  nh3:    { text: 'NH₃',    color: '#908905' }
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

class Ship {
  constructor() {
    // coordinates are: [ z, x, y ]
    this._voxels = []
    this.level = 0
  }

  get_voxel(x, y, z) {
    this._voxels[z] ??= {}
    this._voxels[z][x] ??= {}
    this._voxels[z][x][y] ??= { drawables: new Set() }
    return this._voxels[z][x][y]
  }

  maybe_voxel(x, y, z) {
    return this._voxels[z]?.[x]?.[y]
  }

  is_inside(x, y, z) {
    return !!this._voxels[z]?.[x]?.[y]?.deck
  }

  is_empty(x, y, z) {
    return !this._voxels[z]?.[x]?.[y]?.contains
  }

  each(fn) {
    let vec = Vec3()

    for (let z of Object.keys(this._voxels)) {
      if (z > this.level) continue
      z = +z
      for (let x of Object.keys(this._voxels[z])) {
        x = +x
        for (let y of Object.keys(this._voxels[z][x])) {
          vec.x = +x
          vec.y = +y
          vec.z = +z
          fn(this._voxels[z][x][y], vec)
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
      for (let drawable of vox.drawables) {
        let mesh = drawable.draw(draw_id, vec)?.[0]
        if (mesh) group.add(mesh)
      }
    })

    return group
  }
}


class Placeable {
  clone() {
    return new this.constructor()
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

    vec.add(this.offset)
    return vec
  }

  do_place(ship, vec) {
    vec = vec.clone().sub(this.offset)

    for (let dx = 0; dx < this.size; dx++) {
      for (let dy = 0; dy < this.size; dy++) {
        ship.get_voxel(vec.x + dx, vec.y + dy, vec.z).deck = this
        ship.get_voxel(vec.x + dx, vec.y + dy, vec.z).drawables.add(this)
      }
    }
  }

  draw(id = 0, vec = null) {
    if (!vec) {
      let geometry = new THREE.BoxGeometry(this.size, this.size, 1)
      let material = new THREE.MeshBasicMaterial()
      let mesh = new THREE.Mesh(geometry, material)

      return [ mesh, material ]
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

    return [ group ]
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
    if (!ship.is_inside(vec.x, vec.y, vec.z)) return null
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

    return [ stairs, material ]
  }
}

class Engine extends Placeable {
  constructor() {
    super()
    this.offset = Vec3(0, 1 - .22, 0)
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

    ship.get_voxel(vec.x, vec.y, vec.z).contains = this
    ship.get_voxel(vec.x, vec.y, vec.z).drawables.add(this)
    ship.get_voxel(vec.x, vec.y + 1, vec.z).contains = this
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

    return [ engine, material ]
  }
}

class Tank extends Placeable {
  constructor() {
    super()
    this.offset = Vec3(0, 0, 0)
    this.deferred = null
    this.liquid = null
  }

  can_place(ship, vec) {
    vec = vec.clone().sub(this.offset).round()
    if (!ship.is_inside(vec.x, vec.y, vec.z)) return null
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
    if (this.deferred) return this.deferred.click(ev)

    tank_popover.assign = value => {
      this.liquid = value
      ship_draw()
    }
    tank_popover.reset(this.liquid)
    tank_popover.show(ev.clientX, ev.clientY)
  }

  do_place(ship, vec) {
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

  link(ship, vec) {
    let v = ship.maybe_voxel(vec.x, vec.y - 1, vec.z)
    if (v?.contains instanceof this.constructor) {
      this.deferred = v.contains.deferred || v.contains
    }
  }

  unlink(ship) {
    if (this.deferred) this.liquid = this.deferred.liquid
    this.deferred = null
  }

  draw(id = 0, vec = null) {
    if (this.deferred) return

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

    return [ tank, material ]
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

for (let x=-2;x<=0;x++)
for (let y=-2;y<=0;y++)
for (let z=-2;z<=0;z++)
new Deck(1).do_place(ship, Vec3(x, y, z))

/*new Deck(1).do_place(ship, Vec3(0, 0, 0))
new Deck(1).do_place(ship, Vec3(1, 0, 0))
new Deck(1).do_place(ship, Vec3(0, 1, 0))
new Deck(1).do_place(ship, Vec3(1, 1, 0))
new Deck(1).do_place(ship, Vec3(1, 2, 0))
new Deck(1).do_place(ship, Vec3(0, 2, 0))
new Deck(1).do_place(ship, Vec3(2, 0, 0))
new Deck(1).do_place(ship, Vec3(3, 0, 0))
new Deck(1).do_place(ship, Vec3(-1, 0, 0))
new Tank().do_place(ship, Vec3(1, 0, 0))
//new Tank().do_place(ship, Vec3(1, 1, 0))
//new Tank().do_place(ship, Vec3(0, 1, 0))
//new Tank().do_place(ship, Vec3(1, 2, 0))
*/

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

let selected_material
let selected_mesh
let selected_placeable

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
    v?.contains?.click?.(ev)
    return
  }

  let free_pos = selected_placeable.can_place(ship, pos)

  if (free_pos) {
    selected_placeable.clone().do_place(ship, free_pos)
    ship_draw()
    selected_material.color.set(0xaa0000)
  }  
})

document.addEventListener('mousemove', ev => {
  if (ev.target !== renderer.domElement) return

  let pos = event_world_position(ev)

  if (!selected_placeable) {
    pos.round()
    let v = ship.maybe_voxel(pos.x, pos.y, pos.z)
    renderer.domElement.style.cursor = v?.contains?.click ? 'pointer' : 'default'
    return
  }

  renderer.domElement.style.cursor = 'grabbing'

  selected_mesh.visible = true

  let free_pos = selected_placeable.can_place(ship, pos)

  if (free_pos) {
    selected_material.color.set(0x00aa00)
    selected_mesh.position.copy(free_pos)
  } else {
    selected_material.color.set(0xaa0000)
    selected_mesh.position.copy(pos)
  }
})

function select_class(placeable_class, ...args) {
  return function () {
    if (selected_mesh) scene.remove(selected_mesh)

    selected_placeable = new placeable_class(...args)

    ;[ selected_mesh, selected_material ] = selected_placeable.draw()

    scene.add(selected_mesh)

    selected_material.opacity = 0.7
    selected_material.transparent = true
    selected_mesh.visible = false
  }
}

function select_element() {
  if (selected_placeable) {
    scene.remove(selected_mesh)
    selected_mesh = null
    selected_placeable = null
  }
}

let controls_fn = {
  'select': select_element,
  'block-1': select_class(Deck, 1),
  'block-2': select_class(Deck, 2),
  'block-3': select_class(Deck, 3),
  'engine': select_class(Engine),
  'tank': select_class(Tank),
  'level-up': select_class(Stairs, 1),
  'level-down': select_class(Stairs, -1),
}

document.getElementsByClassName('controls')[0].addEventListener('click', ev => {
  if (!ev.target.dataset.fn) return
  for (let x of Array.from(document.getElementsByClassName('controls')[0].getElementsByClassName('active'))) {
    x.classList.remove('active')
  }

  renderer.domElement.style.cursor = 'default'
  for (let x of Array.from(document.getElementsByClassName('show'))) x.classList.remove('show')

  controls_fn[ev.target.dataset.fn]()
  ev.target.classList.add('active')
})

//document.getElementsByClassName('icon-sort-alt-down')[0].click()

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
