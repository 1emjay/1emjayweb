import * as THREE from '../vendor/three.module.min.js';

const canvas = document.querySelector('#stage');
const cornerEffectElement = document.querySelector('#corner-effect');

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x020203);

const camera = new THREE.OrthographicCamera();
camera.position.set(0, 0, 700);
camera.lookAt(0, 0, 0);

const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  powerPreference: 'high-performance',
});

renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const viewport = {
  width: 1,
  height: 1,
  left: -0.5,
  right: 0.5,
  top: 0.5,
  bottom: -0.5,
};

const palette = ['#ff7a1a', '#00e6d2', '#ffcf38', '#ff4d8d', '#8cff5a', '#b48cff'];
let accentIndex = 0;

const construction = createConstructionObject();
scene.add(construction.group);

const ambient = new THREE.HemisphereLight(0xffffff, 0x09090d, 1.55);
scene.add(ambient);

const keyLight = new THREE.DirectionalLight(0xffffff, 2.7);
keyLight.position.set(-160, 230, 360);
keyLight.castShadow = true;
keyLight.shadow.camera.left = -420;
keyLight.shadow.camera.right = 420;
keyLight.shadow.camera.top = 280;
keyLight.shadow.camera.bottom = -280;
scene.add(keyLight);

const rimLight = new THREE.PointLight(0x00e6d2, 1.4, 750, 1.5);
rimLight.position.set(240, -160, 290);
scene.add(rimLight);

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const velocity = new THREE.Vector2(1, 0.72).normalize();
const bounds = new THREE.Box3();
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const clock = new THREE.Clock();
const cornerRun = {
  active: false,
  source: 'auto',
  startTime: 0,
  duration: 0.8,
  corner: { x: 1, y: 1 },
  start: new THREE.Vector3(),
  target: new THREE.Vector3(),
  rotation: new THREE.Euler(),
};
let currentSpeed = 150;
let lastAccentSwap = 0;
let nextNaturalCornerAt = Infinity;

resize();
window.addEventListener('resize', resize, { passive: true });
window.visualViewport?.addEventListener('resize', resize, { passive: true });
canvas.addEventListener('pointerdown', handlePointerDown);
canvas.addEventListener('pointermove', handlePointerMove);
canvas.addEventListener('pointerleave', () => {
  canvas.style.cursor = 'default';
});
scheduleNaturalCorner(clock.elapsedTime, true);
renderer.setAnimationLoop(render);

function render() {
  const elapsed = clock.elapsedTime;
  const delta = Math.min(clock.getDelta(), 0.04);
  const motionScale = getMotionScale();

  if (!cornerRun.active) {
    construction.group.rotation.x = Math.sin(elapsed * 0.7) * 0.18;
    construction.group.rotation.y = 0.26 + Math.sin(elapsed * 0.82) * 0.36;
    construction.group.rotation.z = Math.sin(elapsed * 0.52) * 0.08;
  }

  construction.equalizerBars.forEach((bar, index) => {
    const wave = Math.sin(elapsed * 4.8 + index * 0.85) * 0.5 + 0.5;
    bar.scale.y = 0.36 + wave * 0.94;
  });

  if (!cornerRun.active && elapsed >= nextNaturalCornerAt) {
    startCornerRun('auto', elapsed);
  }

  if (cornerRun.active) {
    updateCornerRun(elapsed);
  } else {
    construction.group.position.x += velocity.x * currentSpeed * delta * motionScale;
    construction.group.position.y += velocity.y * currentSpeed * delta * motionScale;
    clampToViewport(elapsed);
  }

  rimLight.color.set(palette[accentIndex]);
  renderer.render(scene, camera);
}

function resize() {
  const width = Math.max(1, Math.floor(window.visualViewport?.width || window.innerWidth));
  const height = Math.max(1, Math.floor(window.visualViewport?.height || window.innerHeight));
  const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);

  viewport.width = width;
  viewport.height = height;
  viewport.left = -width / 2;
  viewport.right = width / 2;
  viewport.top = height / 2;
  viewport.bottom = -height / 2;

  camera.left = viewport.left;
  camera.right = viewport.right;
  camera.top = viewport.top;
  camera.bottom = viewport.bottom;
  camera.near = -1000;
  camera.far = 1000;
  camera.updateProjectionMatrix();

  renderer.setPixelRatio(pixelRatio);
  renderer.setSize(width, height, false);

  const preferredScale = THREE.MathUtils.clamp(Math.min(width / 760, height / 430), 0.24, 0.86);
  const maximumScale = Math.min(width / 610, height / 330, 0.86);
  construction.group.scale.setScalar(Math.max(0.18, Math.min(preferredScale, maximumScale)));

  if (cornerRun.active) {
    cornerRun.target.copy(getCornerTarget(cornerRun.corner));
  }

  currentSpeed = THREE.MathUtils.clamp(Math.min(width, height) * 0.34, 104, 190);
  clampToViewport(clock.elapsedTime, true);
}

function handlePointerDown(event) {
  if (!isPointerOnSign(event)) {
    return;
  }

  event.preventDefault();
  startCornerRun('click', clock.elapsedTime);
}

function handlePointerMove(event) {
  canvas.style.cursor = isPointerOnSign(event) ? 'pointer' : 'default';
}

function isPointerOnSign(event) {
  const rect = canvas.getBoundingClientRect();
  pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -(((event.clientY - rect.top) / rect.height) * 2 - 1);
  raycaster.setFromCamera(pointer, camera);

  return raycaster.intersectObject(construction.group, true).length > 0;
}

function startCornerRun(source, elapsed) {
  if (cornerRun.active) {
    return;
  }

  const corner = currentDirectionCorner();
  cornerRun.active = true;
  cornerRun.source = source;
  cornerRun.startTime = elapsed;
  cornerRun.corner = corner;
  cornerRun.start.copy(construction.group.position);
  cornerRun.rotation.copy(construction.group.rotation);
  cornerRun.target.copy(getCornerTarget(corner));

  const distance = cornerRun.start.distanceTo(cornerRun.target);
  if (source === 'click') {
    cornerRun.duration = THREE.MathUtils.clamp(distance / 1400, 0.28, 0.68);
  } else {
    cornerRun.duration = Math.max(distance / (currentSpeed * getMotionScale()), 0.28);
  }
}

function updateCornerRun(elapsed) {
  const progress = THREE.MathUtils.clamp((elapsed - cornerRun.startTime) / cornerRun.duration, 0, 1);
  const travelProgress = cornerRun.source === 'click' ? easeInOutCubic(progress) : progress;

  construction.group.rotation.copy(cornerRun.rotation);
  construction.group.position.lerpVectors(cornerRun.start, cornerRun.target, travelProgress);

  if (progress >= 1) {
    finishCornerRun(elapsed);
  }
}

function finishCornerRun(elapsed) {
  snapToCorner(cornerRun.corner);
  velocity.set(-cornerRun.corner.x, -cornerRun.corner.y).normalize();
  cornerRun.active = false;
  lastAccentSwap = elapsed;
  setAccent((accentIndex + 1) % palette.length);
  playCornerEffect(cornerRun.corner, elapsed);
  scheduleNaturalCorner(elapsed);
}

function currentDirectionCorner() {
  return {
    x: velocity.x >= 0 ? 1 : -1,
    y: velocity.y >= 0 ? 1 : -1,
  };
}

function getCornerTarget(corner) {
  construction.group.updateMatrixWorld(true);
  bounds.setFromObject(construction.group);

  const leftOffset = bounds.min.x - construction.group.position.x;
  const rightOffset = bounds.max.x - construction.group.position.x;
  const bottomOffset = bounds.min.y - construction.group.position.y;
  const topOffset = bounds.max.y - construction.group.position.y;

  return new THREE.Vector3(
    corner.x > 0 ? viewport.right - rightOffset : viewport.left - leftOffset,
    corner.y > 0 ? viewport.top - topOffset : viewport.bottom - bottomOffset,
    construction.group.position.z,
  );
}

function snapToCorner(corner) {
  construction.group.position.copy(getCornerTarget(corner));
  construction.group.updateMatrixWorld(true);
}

function scheduleNaturalCorner(elapsed, first = false) {
  const minDelay = first ? 5.5 : 10;
  const maxDelay = first ? 8.5 : 17;
  const motionScale = reducedMotion ? 1.7 : 1;
  nextNaturalCornerAt = elapsed + (minDelay + Math.random() * (maxDelay - minDelay)) * motionScale;
}

function getMotionScale() {
  return reducedMotion ? 0.35 : 1;
}

function easeInOutCubic(value) {
  return value < 0.5
    ? 4 * value * value * value
    : 1 - Math.pow(-2 * value + 2, 3) / 2;
}

function clampToViewport(elapsed, force = false) {
  construction.group.updateMatrixWorld(true);
  bounds.setFromObject(construction.group);

  let bounced = false;

  if (bounds.min.x < viewport.left) {
    construction.group.position.x += viewport.left - bounds.min.x;
    velocity.x = Math.abs(velocity.x);
    bounced = true;
  }

  if (bounds.max.x > viewport.right) {
    construction.group.position.x -= bounds.max.x - viewport.right;
    velocity.x = -Math.abs(velocity.x);
    bounced = true;
  }

  if (bounds.min.y < viewport.bottom) {
    construction.group.position.y += viewport.bottom - bounds.min.y;
    velocity.y = Math.abs(velocity.y);
    bounced = true;
  }

  if (bounds.max.y > viewport.top) {
    construction.group.position.y -= bounds.max.y - viewport.top;
    velocity.y = -Math.abs(velocity.y);
    bounced = true;
  }

  if (bounced && (force || elapsed - lastAccentSwap > 0.12)) {
    lastAccentSwap = elapsed;
    setAccent((accentIndex + 1) % palette.length);
  }
}

function setAccent(nextIndex) {
  accentIndex = nextIndex;
  construction.paintTexture(palette[accentIndex]);

  construction.accentMaterials.forEach((material) => {
    material.color.set(palette[accentIndex]);
    if (material.emissive) {
      material.emissive.set(palette[accentIndex]);
    }
  });
}

function playCornerEffect(corner) {
  if (!cornerEffectElement) {
    return;
  }

  const rgb = hexToRgb(palette[accentIndex]);
  cornerEffectElement.style.setProperty('--burst-x', corner.x > 0 ? '100%' : '0%');
  cornerEffectElement.style.setProperty('--burst-y', corner.y > 0 ? '0%' : '100%');
  cornerEffectElement.style.setProperty('--burst-rgb', `${rgb.r}, ${rgb.g}, ${rgb.b}`);
  cornerEffectElement.classList.remove('is-active');
  void cornerEffectElement.offsetWidth;
  cornerEffectElement.classList.add('is-active');
}

function hexToRgb(hex) {
  const value = Number.parseInt(hex.slice(1), 16);

  return {
    r: (value >> 16) & 255,
    g: (value >> 8) & 255,
    b: value & 255,
  };
}

function createConstructionObject() {
  const group = new THREE.Group();
  const accentMaterials = [];
  const equalizerBars = [];
  const width = 420;
  const height = 176;
  const depth = 54;

  const paint = createSignTexture(palette[accentIndex]);
  const bodyMaterial = new THREE.MeshStandardMaterial({
    color: 0x111116,
    roughness: 0.42,
    metalness: 0.38,
  });

  const sideMaterial = new THREE.MeshStandardMaterial({
    color: 0x050507,
    roughness: 0.46,
    metalness: 0.62,
  });

  const faceMaterial = new THREE.MeshStandardMaterial({
    map: paint.texture,
    roughness: 0.58,
    metalness: 0.08,
  });

  const body = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), [
    sideMaterial,
    sideMaterial,
    sideMaterial,
    sideMaterial,
    faceMaterial,
    bodyMaterial,
  ]);
  body.castShadow = true;
  body.receiveShadow = true;
  group.add(body);

  const edgeMaterial = new THREE.LineBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.28,
  });
  const edges = new THREE.LineSegments(new THREE.EdgesGeometry(body.geometry), edgeMaterial);
  group.add(edges);

  const railMaterial = createAccentMaterial(palette[accentIndex], 0.9);
  accentMaterials.push(railMaterial);

  const topRail = new THREE.Mesh(new THREE.BoxGeometry(width + 18, 8, 10), railMaterial);
  topRail.position.set(0, height / 2 + 9, 3);
  const bottomRail = topRail.clone();
  bottomRail.position.y = -height / 2 - 9;
  group.add(topRail, bottomRail);

  for (let i = 0; i < 7; i += 1) {
    const barMaterial = createAccentMaterial(i % 2 === 0 ? palette[accentIndex] : '#ffffff', 0.72);
    if (i % 2 === 0) {
      accentMaterials.push(barMaterial);
    }

    const bar = new THREE.Mesh(new THREE.BoxGeometry(10, 48, 13), barMaterial);
    bar.position.set(-172 + i * 20, -50, depth / 2 + 11);
    bar.castShadow = true;
    equalizerBars.push(bar);
    group.add(bar);
  }

  const noteMaterial = createAccentMaterial('#ffffff', 0.5);
  const note = createMusicNote(noteMaterial);
  note.position.set(166, -36, depth / 2 + 15);
  note.rotation.z = -0.08;
  group.add(note);

  group.rotation.set(-0.08, 0.32, 0.04);
  group.position.set(-viewport.width * 0.17, viewport.height * 0.11, 0);

  return {
    group,
    equalizerBars,
    accentMaterials,
    paintTexture: paint.draw,
  };
}

function createAccentMaterial(color, intensity) {
  return new THREE.MeshStandardMaterial({
    color,
    emissive: color,
    emissiveIntensity: intensity,
    roughness: 0.28,
    metalness: 0.2,
  });
}

function createMusicNote(material) {
  const note = new THREE.Group();

  const head = new THREE.Mesh(new THREE.TorusGeometry(14, 4.2, 12, 36), material);
  head.scale.set(1.18, 0.78, 1);
  note.add(head);

  const stem = new THREE.Mesh(new THREE.BoxGeometry(7, 58, 8), material);
  stem.position.set(14, 34, 0);
  note.add(stem);

  const flag = new THREE.Mesh(new THREE.BoxGeometry(36, 7, 8), material);
  flag.position.set(30, 64, 0);
  flag.rotation.z = -0.24;
  note.add(flag);

  return note;
}

function createSignTexture(initialAccent) {
  const textureCanvas = document.createElement('canvas');
  textureCanvas.width = 1024;
  textureCanvas.height = 430;

  const context = textureCanvas.getContext('2d');
  const texture = new THREE.CanvasTexture(textureCanvas);
  texture.anisotropy = 8;
  texture.colorSpace = THREE.SRGBColorSpace;

  function draw(accent = initialAccent) {
    const width = textureCanvas.width;
    const height = textureCanvas.height;

    context.clearRect(0, 0, width, height);

    const background = context.createLinearGradient(0, 0, width, height);
    background.addColorStop(0, '#0f1015');
    background.addColorStop(0.56, '#050507');
    background.addColorStop(1, '#15151b');
    context.fillStyle = background;
    context.fillRect(0, 0, width, height);

    drawHazardBand(context, 0, 82, width, accent);
    drawHazardBand(context, height - 82, 82, width, accent);

    context.fillStyle = 'rgba(255, 255, 255, 0.06)';
    context.fillRect(0, 82, width, 2);
    context.fillRect(0, height - 84, width, 2);

    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.shadowColor = accent;
    context.shadowBlur = 20;
    context.fillStyle = '#f7f3e9';
    context.font = '900 76px Arial, Helvetica, sans-serif';
    context.fillText('UNDER', width / 2, 164);

    context.shadowBlur = 26;
    context.font = `${fitText(context, 'CONSTRUCTION', 810, 94, 48)}px Arial Black, Arial, Helvetica, sans-serif`;
    context.fillText('CONSTRUCTION', width / 2, 252);

    context.shadowBlur = 0;
    context.fillStyle = accent;
    context.fillRect(264, 312, 496, 8);

    context.fillStyle = 'rgba(247, 243, 233, 0.64)';
    context.font = '700 28px Arial, Helvetica, sans-serif';
    context.fillText('COMING SOON', width / 2, 354);

    texture.needsUpdate = true;
  }

  draw(initialAccent);

  return { texture, draw };
}

function drawHazardBand(context, y, height, width, accent) {
  context.fillStyle = accent;
  context.fillRect(0, y, width, height);

  context.save();
  context.beginPath();
  context.rect(0, y, width, height);
  context.clip();
  context.fillStyle = '#050507';

  for (let x = -width; x < width * 2; x += 112) {
    context.beginPath();
    context.moveTo(x, y + height);
    context.lineTo(x + 56, y + height);
    context.lineTo(x + 130, y);
    context.lineTo(x + 74, y);
    context.closePath();
    context.fill();
  }

  context.restore();
}

function fitText(context, text, maxWidth, maxSize, minSize) {
  let size = maxSize;
  do {
    context.font = `900 ${size}px Arial Black, Arial, Helvetica, sans-serif`;
    if (context.measureText(text).width <= maxWidth) {
      return size;
    }
    size -= 2;
  } while (size >= minSize);

  return minSize;
}
