import * as THREE from 'three'
import { GLTFLoader } from './node_modules/three/examples/jsm/loaders/GLTFLoader.js'
import { OrbitControls } from './node_modules/three/examples/jsm/controls/OrbitControls.js';
import './node_modules/knockout/build/output/knockout-latest.js'

const fuel_types = {
  h2:     { text: 'H₂' },
  o2:     { text: 'O₂' },
  h2o:    { text: 'H₂O' },
  ch4:    { text: 'CH₄' },
  c2h5oh: { text: 'C₂H₅OH' },
  n2h4:   { text: 'N₂H₄' },
  nh3:    { text: 'NH₃' }
}

let active_popovers = new Set()
let models = {}

await Promise.all([ 'engine', 'tank' ].map(file => {
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
  }

  get_voxel(z, x, y) {
    this._voxels[z] ??= {}
    this._voxels[z][x] ??= {}
    this._voxels[z][x][y] ??= { drawables: new Set() }
    return this._voxels[z][x][y]
  }

  maybe_voxel(z, x, y) {
    return this._voxels[z]?.[x]?.[y]
  }

  is_inside(z, x, y) {
    return !!this._voxels[z]?.[x]?.[y]?.inside
  }

  is_empty(z, x, y) {
    return !this._voxels[z]?.[x]?.[y]?.contains
  }

  each(fn) {
    let vec = new THREE.Vector3()

    for (let z of Object.keys(this._voxels)) {
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

  draw() {
    let group = new THREE.Group()
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
}

class Floor extends Placeable {
  constructor(size) {
    super()
    this.size = size
    this.offset = new THREE.Vector3(this.size / 2 - .5, this.size / 2 - .5, 0)
  }

  verify(ship, vec) {
    vec = vec.clone().sub(this.offset).round()

    for (let dx = 0; dx < this.size; dx++) {
      for (let dy = 0; dy < this.size; dy++) {
        if (ship.is_inside(vec.z, vec.x + dx, vec.y + dy)) return null
        if (!ship.is_empty(vec.z, vec.x + dx, vec.y + dy)) return null
      }
    }

    let borders = false
    LOOP: for (let d = 0; d < this.size; d++) {
      if (ship.is_inside(vec.z, vec.x + d, vec.y - 1) ||
          ship.is_inside(vec.z, vec.x + d, vec.y + this.size) ||
          ship.is_inside(vec.z, vec.x - 1, vec.y + d) ||
          ship.is_inside(vec.z, vec.x + this.size, vec.y + d)) {
        borders = true
        break LOOP
      }
    }

    if (!borders) return null

    vec.add(this.offset)
    return vec
  }

  place(ship, vec) {
    vec = vec.clone().sub(this.offset)

    for (let dx = 0; dx < this.size; dx++) {
      for (let dy = 0; dy < this.size; dy++) {
        ship.get_voxel(vec.z, vec.x + dx, vec.y + dy).inside = true
        ship.get_voxel(vec.z, vec.x + dx, vec.y + dy).drawables.add(this)
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
    let material = new THREE.MeshBasicMaterial({ color: 0xffffff })
    material.map = texture
    let material_beam = new THREE.MeshBasicMaterial({ color: 0x777777 })
    material_beam.map = texture_beam

    let { x, y, z } = vec

    let geometry = new THREE.BoxGeometry()
    let cube = new THREE.Mesh(geometry, material)
    group.add(cube)
    cube.position.x = x
    cube.position.y = y
    cube.position.z = z - .5 + .1
    cube.scale.z = .1

    if (!ship.maybe_voxel(z, x, y - 1)?.inside) {
      let cube = new THREE.Mesh(geometry, material_beam)
      group.add(cube)
      cube.position.x = x
      cube.position.y = y - .5 + .05
      cube.position.z = z
      cube.scale.y = .1
    }

    if (!ship.maybe_voxel(z, x, y + 1)?.inside) {
      let cube = new THREE.Mesh(geometry, material_beam)
      group.add(cube)
      cube.position.x = x
      cube.position.y = y + .5 - .05
      cube.position.z = z
      cube.scale.y = .1
    }

    if (!ship.maybe_voxel(z, x - 1, y)?.inside) {
      let cube = new THREE.Mesh(geometry, material_beam)
      group.add(cube)
      cube.position.x = x - .5 + .05
      cube.position.y = y
      cube.position.z = z
      cube.scale.x = .1
      if (ship.maybe_voxel(z, x, y - 1)?.inside) {
        cube.scale.y += .1
        cube.position.y -= .05
      }
      if (ship.maybe_voxel(z, x, y + 1)?.inside) {
        cube.scale.y += .1
        cube.position.y += .05
      }
    }

    if (!ship.maybe_voxel(z, x + 1, y)?.inside) {
      let cube = new THREE.Mesh(geometry, material_beam)
      group.add(cube)
      cube.position.x = x + .5 - .05
      cube.position.y = y
      cube.position.z = z
      cube.scale.x = .1
      if (ship.maybe_voxel(z, x, y - 1)?.inside) {
        cube.scale.y += .1
        cube.position.y -= .05
      }
      if (ship.maybe_voxel(z, x, y + 1)?.inside) {
        cube.scale.y += .1
        cube.position.y += .05
      }
    }

    return [ group, material ]
  }
}

class Engine extends Placeable {
  constructor() {
    super()
    this.offset = new THREE.Vector3(0, 1 - .22, 0)
  }

  verify(ship, vec) {
    vec = vec.clone().sub(this.offset).round()

    if (!ship.is_inside(vec.z, vec.x, vec.y + 1)) return null
    if (ship.is_inside(vec.z, vec.x, vec.y)) return null

    if (!ship.is_empty(vec.z, vec.x, vec.y + 1)) return null
    if (!ship.is_empty(vec.z, vec.x, vec.y)) return null

    vec.add(this.offset)
    return vec
  }

  place(ship, vec) {
    vec = vec.clone().sub(this.offset)

    ship.get_voxel(vec.z, vec.x, vec.y).contains = this
    ship.get_voxel(vec.z, vec.x, vec.y).drawables.add(this)
    ship.get_voxel(vec.z, vec.x, vec.y + 1).contains = this
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
    this.offset = new THREE.Vector3(0, 0, 0)
    this.deferred = null
    this.liquid = null
  }

  verify(ship, vec) {
    vec = vec.clone().sub(this.offset).round()
    if (!ship.is_inside(vec.z, vec.x, vec.y)) return null
    if (!ship.is_empty(vec.z, vec.x, vec.y)) return null
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

  place(ship, vec) {
    vec = vec.clone().sub(this.offset)

    ship.get_voxel(vec.z, vec.x, vec.y).contains = this
    ship.get_voxel(vec.z, vec.x, vec.y).drawables.add(this)

    ship.each((vox, vec) => {
      if (vox.contains instanceof this.constructor) vox.contains.unlink()
    })

    ship.each((vox, vec) => {
      if (vox.contains instanceof this.constructor) vox.contains.link(ship, vec)
    })
  }

  link(ship, vec) {
    let v = ship.maybe_voxel(vec.z, vec.x, vec.y - 1)
    if (v?.contains instanceof this.constructor) {
      this.deferred = v.contains.deferred || v.contains
    }
  }

  unlink(ship) {
    if (this.deferred) this.deferred.liquid = this.liquid
    this.deferred = null
  }

  draw(id = 0, vec = null) {
    if (this.deferred) return

    let height = 0

    if (vec) {
      for (let dy = 1; ; dy++) {
        let v = ship.maybe_voxel(vec.z, vec.x, vec.y + dy)
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
        mesh.position.z += height * 2
        mesh.scale.y *= 1 + height * 2
        mesh.visible = !!this.liquid
        return
      }

      mesh.material = material
    })

    return [ tank, material ]








/*

    let height = 0

    if (vec) {
      for (let dy = 1; ; dy++) {
        let v = ship.maybe_voxel(vec.z, vec.x, vec.y + dy)
        if (!(v?.contains instanceof this.constructor)) break
        height++
      }
    }

    let geometry = new THREE.BoxGeometry(0, 0, 0)
    let material = new THREE.MeshBasicMaterial()

    let tank_geometry = new THREE.CylinderGeometry(.3, .3, .7 + height, 30)

    let mesh = new THREE.Group()

    if (vec) {
      material = new THREE.MeshBasicMaterial({ color: 0x996000 })
      material.map = texture_alum
    }

    let spacer = new THREE.Mesh(geometry, material)

    if (vec) {
      material = new THREE.MeshBasicMaterial({ color: 0xffffff })
      material.map = texture_alum
    }

    let tank = new THREE.Mesh(tank_geometry, material)

    mesh.add(spacer)
    mesh.add(tank)

    if (vec) {
      mesh.position.add(this.offset)
      mesh.position.add(vec)
      mesh.position.y += height / 2
    }

    return [ mesh, material ]*/
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


let scene = new THREE.Scene()
let camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000)

const light = new THREE.AmbientLight(0x404040, 2);
scene.add(light);

let ship = new Ship()
new Floor(1).place(ship, new THREE.Vector3(0, 0, 0))
new Floor(1).place(ship, new THREE.Vector3(1, 0, 0))
new Floor(1).place(ship, new THREE.Vector3(0, 1, 0))
new Floor(1).place(ship, new THREE.Vector3(1, 1, 0))
new Floor(1).place(ship, new THREE.Vector3(1, 2, 0))
new Floor(1).place(ship, new THREE.Vector3(0, 2, 0))
new Floor(1).place(ship, new THREE.Vector3(2, 0, 0))
new Floor(1).place(ship, new THREE.Vector3(3, 0, 0))
new Floor(1).place(ship, new THREE.Vector3(-1, 0, 0))
new Tank().place(ship, new THREE.Vector3(1, 0, 0))
new Tank().place(ship, new THREE.Vector3(1, 1, 0))
new Tank().place(ship, new THREE.Vector3(0, 1, 0))
new Tank().place(ship, new THREE.Vector3(1, 2, 0))

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

let	controls = new OrbitControls(camera, renderer.domElement)
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
  let pos = new THREE.Vector3()
  let vec = new THREE.Vector3()

  vec.set(
    (ev.clientX / window.innerWidth) * 2 - 1,
    -(ev.clientY / window.innerHeight) * 2 + 1,
    0.5)

  vec.unproject(camera)

  vec.sub(camera.position).normalize()

  let distance = -camera.position.z / vec.z //- .5

  pos.copy(camera.position).add(vec.multiplyScalar(distance))
  //pos.z -= .5

  return pos
}

document.addEventListener('click', ev => {
  if (ev.target !== renderer.domElement) return
  for (let x of Array.from(document.getElementsByClassName('show'))) x.classList.remove('show')

  let pos = event_world_position(ev)

  if (!selected_placeable) {
    pos.round()
    let v = ship.maybe_voxel(pos.z, pos.x, pos.y)
    v?.contains?.click?.(ev)
    return
  }

  let free_pos = selected_placeable.verify(ship, pos)

  if (free_pos) {
    selected_placeable.place(ship, free_pos)
    ship_draw()
    selected_material.color.set(0xaa0000)
  }  
})

document.addEventListener('mousemove', ev => {
  if (ev.target !== renderer.domElement) return

  let pos = event_world_position(ev)

  if (!selected_placeable) {
    pos.round()
    let v = ship.maybe_voxel(pos.z, pos.x, pos.y)
    renderer.domElement.style.cursor = v?.contains?.click ? 'pointer' : 'default'
    return
  }

  renderer.domElement.style.cursor = 'grabbing'

  selected_mesh.visible = true

  let free_pos = selected_placeable.verify(ship, pos)

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
  'block-1': select_class(Floor, 1),
  'block-2': select_class(Floor, 2),
  'block-3': select_class(Floor, 3),
  'engine': select_class(Engine),
  'tank': select_class(Tank),
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

//document.getElementsByClassName('icon-water')[0].click()

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


/*new GLTFLoader()
  .load('models/engine.glb', function (gltf) {
 gltf.scene.rotation.x = Math.PI / 2
 gltf.scene.scale.x = .6
 gltf.scene.scale.y = .6
 gltf.scene.scale.z = .6
 gltf.scene.position.y -= .22
            scene.add( gltf.scene );
  })

/*        new GLTFLoader()
          .load( 'models/untitled.glb', function ( gltf ) {
            scene.add( gltf.scene );
          } );

const light = new THREE.AmbientLight( 0x404040, 10 ); // soft white light
scene.add( light );*/


/*	function ( object ) {
  					object.traverse( function ( child ) {
console.log(child)
						if ( child.isMesh ) child.material.map = texture_alum

					} );

		scene.add( object );
	},*/
