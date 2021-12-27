import * as THREE from 'three'
import { GLTFLoader } from './node_modules/three/examples/jsm/loaders/GLTFLoader.js'
import './node_modules/knockout/build/output/knockout-latest.js'

let active_popovers = new Set()

class Popover {
  constructor(cls) {
    this.element = document.getElementsByClassName(cls)[0]
    this.data = {}
    this.init()
    ko.applyBindings(this.data, this.element)
  }

  show(x, y) {
    this.reset()
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
  }

  init() {
    this.data.contents = ko.observable()
    this.data.temperature = ko.observable()
  }

  reset() {
    this.data.contents(null)
    this.data.temperature(10)
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
    this._voxels[z][x][y] ??= {}
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

  draw() {
    let group = new THREE.Group()
    let vec = new THREE.Vector3()
    let material = new THREE.MeshBasicMaterial({ color: 0xffffff })
    material.map = texture
    let material_beam = new THREE.MeshBasicMaterial({ color: 0x777777 })
    material_beam.map = texture_beam

    for (let z of Object.keys(this._voxels)) {
      z = +z
      for (let x of Object.keys(this._voxels[z])) {
        x = +x
        for (let y of Object.keys(this._voxels[z][x])) {
          y = +y
          if (!this._voxels[z][x][y].inside) continue

          let geometry = new THREE.BoxGeometry()
          let cube = new THREE.Mesh(geometry, material)
          group.add(cube)
          cube.position.x = x
          cube.position.y = y
          cube.position.z = z - .5 + .1
          cube.scale.z = .1

          if (!this._voxels[z][x][y - 1]?.inside) {
            let cube = new THREE.Mesh(geometry, material_beam)
            group.add(cube)
            cube.position.x = x
            cube.position.y = y - .5 + .05
            cube.position.z = z
            cube.scale.y = .1
          }

          if (!this._voxels[z][x][y + 1]?.inside) {
            let cube = new THREE.Mesh(geometry, material_beam)
            group.add(cube)
            cube.position.x = x
            cube.position.y = y + .5 - .05
            cube.position.z = z
            cube.scale.y = .1
          }

          if (!this._voxels[z][x - 1]?.[y]?.inside) {
            let cube = new THREE.Mesh(geometry, material_beam)
            group.add(cube)
            cube.position.x = x - .5 + .05
            cube.position.y = y
            cube.position.z = z
            cube.scale.x = .1
            if (this._voxels[z][x][y - 1]?.inside) {
              cube.scale.y += .1
              cube.position.y -= .05
            }
            if (this._voxels[z][x][y + 1]?.inside) {
              cube.scale.y += .1
              cube.position.y += .05
            }
          }

          if (!this._voxels[z][x + 1]?.[y]?.inside) {
            let cube = new THREE.Mesh(geometry, material_beam)
            group.add(cube)
            cube.position.x = x + .5 - .05
            cube.position.y = y
            cube.position.z = z
            cube.scale.x = .1
            if (this._voxels[z][x][y - 1]?.inside) {
              cube.scale.y += .1
              cube.position.y -= .05
            }
            if (this._voxels[z][x][y + 1]?.inside) {
              cube.scale.y += .1
              cube.position.y += .05
            }
          }
        }
      }
    }

    for (let z of Object.keys(this._voxels)) {
      z = +z
      for (let x of Object.keys(this._voxels[z])) {
        x = +x
        for (let y of Object.keys(this._voxels[z][x])) {
          y = +y
          if (!this._voxels[z][x][y].draw) continue
          let mesh = this._voxels[z][x][y].contains.draw(new THREE.Vector3(x, y, z))[0]
          group.add(mesh)
        }
      }
    }

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
      }
    }
  }

  draw(vec = null) {
    let geometry = new THREE.BoxGeometry(this.size, this.size, 1)
    let material = new THREE.MeshBasicMaterial()
    let mesh = new THREE.Mesh(geometry, material)

    return [ mesh, material ]
  }
}

class Engine extends Placeable {
  constructor() {
    super()
    this.offset = new THREE.Vector3(0, .65, 0)
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
    ship.get_voxel(vec.z, vec.x, vec.y).draw = true
    ship.get_voxel(vec.z, vec.x, vec.y + 1).contains = this
  }

  draw(vec = null) {
    let geometry = new THREE.BoxGeometry(.7, .5, .7)
    let material = new THREE.MeshBasicMaterial()

    let nozzle_geometry = new THREE.ConeGeometry(.4, 1.2, 30)

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

    let nozzle = new THREE.Mesh(nozzle_geometry, material)
    nozzle.position.y -= .35

    mesh.add(spacer)
    mesh.add(nozzle)

    if (vec) {
      mesh.position.add(this.offset)
      mesh.position.add(vec)
    }

    return [ mesh, material ]
  }
}

class Tank extends Placeable {
  constructor() {
    super()
    this.offset = new THREE.Vector3(0, 0, 0)
  }

  verify(ship, vec) {
    vec = vec.clone().sub(this.offset).round()
    if (!ship.is_inside(vec.z, vec.x, vec.y)) return null
    if (!ship.is_empty(vec.z, vec.x, vec.y)) return null
    vec.add(this.offset)
    return vec
  }

  click(ev) {
    tank_popover.show(ev.clientX, ev.clientY)
  }

  place(ship, vec) {
    vec = vec.clone().sub(this.offset)

    ship.get_voxel(vec.z, vec.x, vec.y).contains = this
    ship.get_voxel(vec.z, vec.x, vec.y).draw = true

    for (let dy = 1; ; dy++) {
      let v = ship.maybe_voxel(vec.z, vec.x, vec.y + dy)
      if (!(v?.contains instanceof this.constructor)) break
      v.draw = false
    }

    for (let dy = -1; ; dy--) {
      let v = ship.maybe_voxel(vec.z, vec.x, vec.y + dy)
      if (!(v?.contains instanceof this.constructor)) break
      ship.get_voxel(vec.z, vec.x, vec.y + dy + 1).draw = false
    }
  }

  draw(vec = null) {
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

    return [ mesh, material ]
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

let ship = new Ship()
ship.get_voxel(0, 0, 0).inside = true
ship.get_voxel(0, 1, 0).inside = true
ship.get_voxel(0, 0, 1).inside = true
ship.get_voxel(0, 1, 1).inside = true
ship.get_voxel(0, 1, 2).inside = true
ship.get_voxel(0, 0, 2).inside = true
new Tank().place(ship, new THREE.Vector3(1, 1, 0))

let ship_group = ship.draw()
scene.add(ship_group)

let renderer = new THREE.WebGLRenderer()
renderer.setSize(window.innerWidth, window.innerHeight)
document.body.appendChild(renderer.domElement)

let selected_material
let selected_mesh
let selected_placeable

camera.position.z = 5

function animate() {
	requestAnimationFrame(animate)
	renderer.render(scene, camera)
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
    scene.remove(ship_group)
    ship_group = ship.draw()
    scene.add(ship_group)
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
