import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { place, displayName } from './layout.js'

const stage = document.getElementById('stage'), tag = document.getElementById('tag'), list = document.getElementById('list')
const found = document.getElementById('found'), status = document.getElementById('status'), labelsBox = document.getElementById('labels')
const STILL = matchMedia('(prefers-reduced-motion: reduce)').matches
const MOON = new THREE.Vector3(30, 45, 30).normalize()   // same side as the moonlight baked into the island
const SKY_LOW = '0.0135, 0.021, 0.042', SKY_HIGH = '0.0016, 0.003, 0.009', LABELS = 14

const people = await fetch('names.json', { cache: 'no-store' }).then(r => r.json()).catch(() => [])
const live = people.filter(c => !c.removed), taken = new Set(people.map(c => c.n))
document.getElementById('pop').textContent = `Population ${live.length}`

// The list and search work with or without WebGL.
let flyTo = () => {}
function row(c) {
  const li = document.createElement('li'), b = document.createElement('button'), n = document.createElement('b')
  n.textContent = `#${c.n} `
  b.append(n, displayName(c.name))
  b.onclick = () => { showCitizen(c); stage.scrollIntoView({ behavior: STILL ? 'auto' : 'smooth' }) }
  li.append(b)
  return li
}
function showCitizen(c) { tag.textContent = `#${c.n}  ${displayName(c.name)}`; flyTo(c.n) }
list.append(...live.map(row))
document.getElementById('q').addEventListener('input', e => {
  const q = e.target.value.trim().replace(/^@/, '').toLowerCase()
  const hits = q ? live.filter(c => c.name.toLowerCase().includes(q)) : live
  list.replaceChildren(...hits.map(row))
  if (!q) { found.textContent = ''; return }
  const exact = live.find(c => c.name.toLowerCase() === q)
  if (exact) { showCitizen(exact); found.textContent = `Found you. You are number ${exact.n}.` }
  else found.textContent = hits.length ? '' : 'Not on the map yet. New names go up within 24 hours of your comment.'
})

function glowTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 128
  const g = c.getContext('2d'), r = g.createRadialGradient(64, 64, 0, 64, 64, 64)
  r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(.18, 'rgba(255,255,255,.55)'); r.addColorStop(.5, 'rgba(255,255,255,.12)'); r.addColorStop(1, 'rgba(255,255,255,0)')
  g.fillStyle = r; g.fillRect(0, 0, 128, 128)
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace
  return t
}

async function start() {
  const canvas = document.getElementById('gl')
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' })
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 3.1

  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(36, 1, .1, 1600)
  const [world, gltf, groundMap, fixedMap] = await Promise.all([
    fetch('world.json').then(r => r.json()),
    new GLTFLoader().loadAsync('island.glb'),
    new THREE.TextureLoader().loadAsync('ground.jpg'),
    new THREE.TextureLoader().loadAsync('fixed.jpg'),
  ])
  const toThree = ([x, y, z]) => new THREE.Vector3(x, z, -y)   // Blender is z-up
  const seaY = world.seaZ, lampAt = toThree(world.lamp)

  // Light is baked into the model, so nothing here computes shadows.
  for (const m of [groundMap, fixedMap]) { m.colorSpace = THREE.SRGBColorSpace; m.flipY = false; m.anisotropy = renderer.capabilities.getMaxAnisotropy() }
  const OFF = new THREE.Color(.012, .016, .026), ON = new THREE.Color(1.15, .56, .17)
  const windows = {}
  let ground
  gltf.scene.traverse(o => {
    if (!o.isMesh) return
    if (o.name.startsWith('ground')) { ground = o; o.material = new THREE.MeshBasicMaterial({ map: groundMap }) }
    else if (/^Pane\d+/.test(o.name)) { const n = +o.name.match(/\d+/)[0]; windows[n] = new THREE.Box3().setFromObject(o).getCenter(new THREE.Vector3()); o.material = new THREE.MeshBasicMaterial({ color: taken.has(n) && !people[n - 1]?.removed ? ON : OFF }) }
    else o.material = new THREE.MeshBasicMaterial({ map: fixedMap })
  })
  scene.add(gltf.scene)

  // Sky and sea share one horizon colour, so the join cannot be seen.
  const sky = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, uniforms: { moon: { value: MOON } },
    vertexShader: 'varying vec3 d; void main(){ d = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }',
    fragmentShader: `varying vec3 d; uniform vec3 moon;
      void main(){ vec3 n = normalize(d); float m = dot(n, moon);
        vec3 c = mix(vec3(${SKY_LOW}), vec3(${SKY_HIGH}), smoothstep(0., .55, n.y));
        c += vec3(.16, .2, .3) * pow(max(m, 0.), 24.) + vec3(.5, .5, .42) * pow(max(m, 0.), 300.);
        c += vec3(2.6, 2.5, 2.2) * smoothstep(.99935, .9996, m);
        gl_FragColor = vec4(c, 1.);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  })
  scene.add(new THREE.Mesh(new THREE.SphereGeometry(1200, 32, 20), sky))

  const sea = new THREE.ShaderMaterial({
    uniforms: { t: { value: 0 }, moon: { value: MOON } },
    vertexShader: 'varying vec3 w; void main(){ vec4 p = modelMatrix * vec4(position, 1.); w = p.xyz; gl_Position = projectionMatrix * viewMatrix * p; }',
    fragmentShader: `varying vec3 w; uniform float t; uniform vec3 moon;
      vec2 wave(vec2 p, vec2 dir, float f, float s, float a){ return dir * a * f * cos(dot(p, dir) * f + t * s); }
      void main(){ vec2 p = w.xz; vec2 g = wave(p, vec2(.8, .6), 1.3, .9, .03) + wave(p, vec2(-.6, .8), 2.4, 1.3, .016) + wave(p, vec2(.3, -.95), 5.1, 1.9, .008) + wave(p, vec2(.95, .3), 11., 2.6, .0035);
        vec3 v = normalize(cameraPosition - w); float dist = length(cameraPosition - w);
        g *= exp(-dist * .04);   // far ripples only shimmer
        vec3 n = normalize(vec3(-g.x, 1., -g.y)), r = reflect(-v, n);
        float fres = pow(1. - max(dot(v, n), 0.), 4.);
        vec3 c = mix(vec3(.0025, .007, .015), vec3(${SKY_LOW}) * 1.1, fres);
        c += vec3(.75, .74, .64) * pow(max(dot(r, moon), 0.), 180.);
        c = mix(c, vec3(${SKY_LOW}), smoothstep(90., 900., dist));
        gl_FragColor = vec4(c, 1.);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  })
  const seaMesh = new THREE.Mesh(new THREE.CircleGeometry(1100, 64).rotateX(-Math.PI / 2), sea); seaMesh.position.y = seaY; scene.add(seaMesh)

  const starPos = []
  for (let i = 0; i < 900; i++) { const v = new THREE.Vector3().randomDirection(); v.y = Math.abs(v.y) + .03; v.normalize().multiplyScalar(1100); starPos.push(v.x, v.y, v.z) }
  const stars = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(starPos, 3))
  scene.add(new THREE.Points(stars, new THREE.PointsMaterial({ color: new THREE.Color(.5, .55, .7), size: 1.5, sizeAttenuation: false, depthWrite: false })))

  const glow = glowTexture(), additive = { map: glow, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }
  const lampGlow = new THREE.Sprite(new THREE.SpriteMaterial({ ...additive, color: new THREE.Color(3, 2.1, 1.2) })); lampGlow.position.copy(lampAt); lampGlow.scale.setScalar(4.2); scene.add(lampGlow)
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(.28, 16, 12), new THREE.MeshBasicMaterial({ color: new THREE.Color(14, 10, 6) })); bulb.position.copy(lampAt); scene.add(bulb)

  // The rotating beam: a cone that fades along its length and is softer towards its edges.
  const beamGeo = new THREE.ConeGeometry(2.8, 36, 32, 1, true).translate(0, -18, 0).rotateZ(Math.PI / 2)
  const beam = new THREE.Mesh(beamGeo, new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    vertexShader: 'varying float l; varying vec3 n, v; void main(){ l = position.x / 36.; vec4 p = modelViewMatrix * vec4(position, 1.); n = normalize(normalMatrix * normal); v = normalize(-p.xyz); gl_Position = projectionMatrix * p; }',
    fragmentShader: `varying float l; varying vec3 n, v;
      void main(){ float edge = pow(abs(dot(normalize(n), normalize(v))), 2.2), fade = pow(1. - clamp(l, 0., 1.), 2.2);
        gl_FragColor = vec4(vec3(.62, .5, .32) * edge * fade * .2, 1.);
        #include <colorspace_fragment>
      }`,
  }))
  beam.position.copy(lampAt); scene.add(beam)

  // Where each number lives. Numbers past the ten built houses wait as lanterns at their exact plot until the island grows.
  const houseAt = n => world.houses[n] ? toThree(world.houses[n].pos) : null
  const ray = new THREE.Raycaster()
  function plot(n) {
    const known = houseAt(n)
    if (known) return known
    const p = place(n), at = new THREE.Vector3(p.x, 60, -p.z)
    ray.set(at, new THREE.Vector3(0, -1, 0))
    const hit = ray.intersectObject(ground)[0]
    at.y = Math.max(hit ? hit.point.y : seaY, seaY) + .55
    return at
  }
  const spots = live.map(c => ({ n: c.n, text: `#${c.n}  ${displayName(c.name)}`, short: `#${c.n} ${displayName(c.name)}`, citizen: c, at: plot(c.n) }))
  const HOUSES = Object.keys(world.houses).map(Number)
  for (const n of HOUSES) if (!taken.has(n)) spots.push({ n, text: `#${n} open`, short: `#${n} open`, at: houseAt(n) })

  const lit = spots.filter(s => s.citizen)
  if (lit.length) {
    const pos = lit.flatMap(s => {   // the glow hangs just in front of the window, on the lighthouse side
      const w = windows[s.n], a = w ? w.clone().addScaledVector(new THREE.Vector3(w.x, 0, w.z).normalize(), -.28) : s.at
      return [a.x, a.y, a.z]
    })
    const g = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
    scene.add(new THREE.Points(g, new THREE.PointsMaterial({ map: glow, color: new THREE.Color(1, .52, .18), size: 2.6, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true })))
  }

  const labels = Array.from({ length: LABELS }, () => { const d = document.createElement('div'); d.className = 'label'; labelsBox.append(d); return d })

  const controls = new OrbitControls(camera, canvas)
  controls.enablePan = false; controls.enableDamping = true; controls.dampingFactor = .07
  controls.minDistance = 2.6; controls.maxDistance = 70; controls.maxPolarAngle = 1.5
  controls.autoRotate = !STILL; controls.autoRotateSpeed = .28
  const HOME_TARGET = new THREE.Vector3(0, 1.2, 0), HOME_CAM = new THREE.Vector3(-15, 10.5, 17.5)
  controls.target.copy(HOME_TARGET)
  camera.position.copy(STILL ? HOME_CAM : new THREE.Vector3(-58, 40, 70))

  // One move at a time: the intro, or a flight to a house. Touching the map cancels it.
  let move = STILL ? null : { from: camera.position.clone(), to: HOME_CAM.clone(), fromT: HOME_TARGET.clone(), toT: HOME_TARGET.clone(), t: 0, len: 4.2 }
  function goTo(to, toT, len) {
    if (STILL) { camera.position.copy(to); controls.target.copy(toT); return }
    move = { from: camera.position.clone(), to, fromT: controls.target.clone(), toT, t: 0, len }
  }
  flyTo = n => {
    const s = spots.find(x => x.n === n); if (!s) return
    const out = new THREE.Vector3(s.at.x, 0, s.at.z).normalize()   // doors and windows face the lighthouse, so the camera looks from that side
    const side = new THREE.Vector3(-out.z, 0, out.x)
    controls.autoRotate = false
    goTo(s.at.clone().addScaledVector(out, houseAt(n) ? -4.3 : 4.6).addScaledVector(side, 3.1).setY(s.at.y + 1.9), s.at.clone().setY(s.at.y + .55), 1.9)
  }
  canvas.addEventListener('pointerdown', () => { move = null; controls.autoRotate = false })
  canvas.addEventListener('wheel', () => { move = null; controls.autoRotate = false }, { passive: true })

  // A tap picks the nearest number on screen, so small houses and lanterns stay easy to hit.
  const screen = new THREE.Vector3()
  function toScreen(at, w, h) { screen.copy(at).project(camera); return { x: (screen.x + 1) / 2 * w, y: (1 - screen.y) / 2 * h, front: screen.z < 1 } }
  let down = null
  canvas.addEventListener('pointerdown', e => { down = [e.clientX, e.clientY] })
  canvas.addEventListener('pointerup', e => {
    if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 8) return
    const r = canvas.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top
    let best = null, bestD = 34
    for (const s of spots) { const p = toScreen(s.at, r.width, r.height), d = Math.hypot(p.x - x, p.y - y); if (p.front && d < bestD) { best = s; bestD = d } }
    if (best) { tag.textContent = best.text; flyTo(best.n) } else tag.textContent = ''
  })

  function resize() {
    const w = stage.clientWidth, h = stage.clientHeight
    renderer.setSize(w, h, false); camera.aspect = w / h
    camera.fov = w < h ? 46 : 36   // portrait phones need a wider lens to fit the island
    camera.updateProjectionMatrix()
  }
  new ResizeObserver(resize).observe(stage); resize()

  const place2 = new THREE.Vector3()
  function drawLabels() {
    const w = stage.clientWidth, h = stage.clientHeight, placed = []
    const near = spots.map(s => [s, camera.position.distanceToSquared(s.at)]).sort((a, b) => (b[0].citizen ? 1 : 0) - (a[0].citizen ? 1 : 0) || a[1] - b[1])
    let used = 0
    for (const [s] of near) {
      if (used === LABELS) break
      place2.copy(s.at); place2.y += houseAt(s.n) ? 1.55 : .4
      const p = toScreen(place2, w, h), half = Math.min(s.short.length * 3.4 + 8, 85)
      if (!p.front || p.x < 0 || p.x > w || p.y < 120 || p.y > h) continue
      if (placed.some(q => Math.abs(q.x - p.x) < q.half + half && Math.abs(q.y - p.y) < 22)) continue   // nearest wins, the rest wait until the camera comes closer
      placed.push({ x: p.x, y: p.y, half })
      const d = labels[used++]
      if (d.textContent !== s.short) { d.textContent = s.short; d.classList.toggle('open', !s.citizen) }
      d.style.display = 'block'; d.style.transform = `translate(-50%, -100%) translate(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px)`
    }
    for (let i = used; i < LABELS; i++) labels[i].style.display = 'none'
  }

  // Nothing renders while the map is scrolled away or the tab is hidden.
  let visible = true
  new IntersectionObserver(([e]) => { visible = e.isIntersecting }, { threshold: .02 }).observe(stage)
  const clock = new THREE.Clock(), ease = x => 1 - Math.pow(1 - x, 3)
  renderer.setAnimationLoop(() => {
    if (!visible || document.hidden) { clock.getDelta(); return }
    const dt = Math.min(clock.getDelta(), .1), t = clock.elapsedTime
    sea.uniforms.t.value = t
    beam.rotation.y = STILL ? .9 : t * .32
    lampGlow.scale.setScalar(4.2 + (STILL ? 0 : Math.sin(t * 1.7) * .12))
    if (move) {
      move.t = Math.min(move.t + dt / move.len, 1); const k = ease(move.t)
      camera.position.lerpVectors(move.from, move.to, k); controls.target.lerpVectors(move.fromT, move.toT, k)
      if (move.t === 1) move = null
    }
    controls.update(dt)
    renderer.render(scene, camera)
    drawLabels()
  })
  status.remove()
}

start().catch(e => {
  console.error(e)
  // No WebGL or a failed download: the still map, the list and the search still work.
  stage.classList.add('flat')
  status.textContent = ''
})
