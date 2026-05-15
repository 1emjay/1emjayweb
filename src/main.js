import * as THREE from '../vendor/three.module.min.js';

const WORDMARK = '1emjay';
const CAPTION = 'coming soon';

const accentPalette = [
  '#ff5b54',
  '#5b6cff',
  '#e8b14a',
  '#6fbf9a',
  '#c875d6',
];
const inkColor = '#e6e0d4';
const inkMutedColor = 'rgba(230, 224, 212, 0.55)';
const frameColor = 'rgba(230, 224, 212, 0.65)';
const backgroundColor = 0x0a0a0c;

const canvas = document.querySelector('#stage');
const cornerEffectElement = document.querySelector('#corner-effect');

const scene = new THREE.Scene();
scene.background = new THREE.Color(backgroundColor);

const camera = new THREE.OrthographicCamera();
camera.position.set(0, 0, 700);
camera.lookAt(0, 0, 0);

const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  powerPreference: 'high-performance',
});
renderer.outputColorSpace = THREE.SRGBColorSpace;

const viewport = {
  width: 1,
  height: 1,
  left: -0.5,
  right: 0.5,
  top: 0.5,
  bottom: -0.5,
};

let accentIndex = Math.floor(Math.random() * accentPalette.length);

const mark = createMark();
scene.add(mark.group);

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
  speedScale: 1,
  start: new THREE.Vector3(),
  control: new THREE.Vector3(),
  target: new THREE.Vector3(),
};
let currentSpeed = 150;
let speedBoost = 1;
let lastAccentSwap = 0;
let nextNaturalCornerAt = Infinity;

await waitForFonts();
mark.repaint();

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

  if (!cornerRun.active && elapsed >= nextNaturalCornerAt) {
    startCornerRun('auto', elapsed);
  }

  if (cornerRun.active) {
    updateCornerRun(elapsed);
  } else {
    if (speedBoost > 1) {
      speedBoost = Math.max(1, speedBoost - 1.4 * delta);
    }
    const effectiveSpeed = currentSpeed * speedBoost;
    mark.group.position.x += velocity.x * effectiveSpeed * delta * motionScale;
    mark.group.position.y += velocity.y * effectiveSpeed * delta * motionScale;
    clampToViewport(elapsed);
  }

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

  const preferredScale = THREE.MathUtils.clamp(Math.min(width / 1400, height / 800), 0.22, 0.6);
  const maximumScale = Math.min(width / 1100, height / 600, 0.62);
  mark.group.scale.setScalar(Math.max(0.2, Math.min(preferredScale, maximumScale)));

  if (cornerRun.active) {
    cornerRun.target.copy(getCornerTarget(cornerRun.corner));
    computeBezierControl(cornerRun.start, cornerRun.target, velocity, cornerRun.control);
  }

  currentSpeed = THREE.MathUtils.clamp(Math.min(width, height) * 0.32, 96, 178);
  clampToViewport(clock.elapsedTime, true);
}

function handlePointerDown(event) {
  if (!isPointerOnMark(event)) {
    return;
  }

  event.preventDefault();
  startCornerRun('click', clock.elapsedTime);
}

function handlePointerMove(event) {
  canvas.style.cursor = isPointerOnMark(event) ? 'pointer' : 'default';
}

function isPointerOnMark(event) {
  const rect = canvas.getBoundingClientRect();
  pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -(((event.clientY - rect.top) / rect.height) * 2 - 1);
  raycaster.setFromCamera(pointer, camera);

  return raycaster.intersectObject(mark.group, true).length > 0;
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
  cornerRun.speedScale = source === 'click' ? 1.55 : 1;
  cornerRun.start.copy(mark.group.position);
  cornerRun.target.copy(getCornerTarget(corner));
  computeBezierControl(cornerRun.start, cornerRun.target, velocity, cornerRun.control);

  const arcLength = estimateBezierLength(cornerRun.start, cornerRun.control, cornerRun.target);
  const speed = currentSpeed * cornerRun.speedScale * getMotionScale();
  cornerRun.duration = Math.max(arcLength / speed, 0.18);
}

function updateCornerRun(elapsed) {
  const progress = THREE.MathUtils.clamp((elapsed - cornerRun.startTime) / cornerRun.duration, 0, 1);
  const u = 1 - progress;
  const t = progress;
  mark.group.position.x =
    u * u * cornerRun.start.x + 2 * u * t * cornerRun.control.x + t * t * cornerRun.target.x;
  mark.group.position.y =
    u * u * cornerRun.start.y + 2 * u * t * cornerRun.control.y + t * t * cornerRun.target.y;

  if (progress >= 1) {
    finishCornerRun(elapsed);
  }
}

function finishCornerRun(elapsed) {
  snapToCorner(cornerRun.corner);
  velocity.set(-cornerRun.corner.x, -cornerRun.corner.y).normalize();
  speedBoost = cornerRun.speedScale;
  cornerRun.active = false;
  lastAccentSwap = elapsed;
  setAccent((accentIndex + 1) % accentPalette.length);
  playCornerEffect(cornerRun.corner);
  scheduleNaturalCorner(elapsed);
}

function currentDirectionCorner() {
  return {
    x: velocity.x >= 0 ? 1 : -1,
    y: velocity.y >= 0 ? 1 : -1,
  };
}

function getCornerTarget(corner) {
  mark.group.updateMatrixWorld(true);
  bounds.setFromObject(mark.group);

  const leftOffset = bounds.min.x - mark.group.position.x;
  const rightOffset = bounds.max.x - mark.group.position.x;
  const bottomOffset = bounds.min.y - mark.group.position.y;
  const topOffset = bounds.max.y - mark.group.position.y;

  return new THREE.Vector3(
    corner.x > 0 ? viewport.right - rightOffset : viewport.left - leftOffset,
    corner.y > 0 ? viewport.top - topOffset : viewport.bottom - bottomOffset,
    mark.group.position.z,
  );
}

function snapToCorner(corner) {
  mark.group.position.copy(getCornerTarget(corner));
  mark.group.updateMatrixWorld(true);
}

function scheduleNaturalCorner(elapsed, first = false) {
  const minDelay = first ? 6 : 12;
  const maxDelay = first ? 10 : 22;
  const motionScale = reducedMotion ? 1.8 : 1;
  nextNaturalCornerAt = elapsed + (minDelay + Math.random() * (maxDelay - minDelay)) * motionScale;
}

function getMotionScale() {
  return reducedMotion ? 0.35 : 1;
}

function computeBezierControl(start, target, currentVelocity, out) {
  const dx = target.x - start.x;
  const dy = target.y - start.y;
  const dist = Math.hypot(dx, dy);

  if (dist < 1) {
    out.copy(target);
    return out;
  }

  const dotVD = currentVelocity.x * dx + currentVelocity.y * dy;
  const minOffset = dist * 0.32;
  const maxOffset = dist * 0.95;

  let offset;
  if (dotVD <= dist * 0.05) {
    offset = dist * 0.5;
  } else {
    offset = THREE.MathUtils.clamp((dist * dist) / (2 * dotVD), minOffset, maxOffset);
  }

  out.set(start.x + currentVelocity.x * offset, start.y + currentVelocity.y * offset, start.z);
  return out;
}

function estimateBezierLength(P0, P1, P2) {
  const samples = 12;
  let length = 0;
  let prevX = P0.x;
  let prevY = P0.y;
  for (let i = 1; i <= samples; i += 1) {
    const t = i / samples;
    const u = 1 - t;
    const x = u * u * P0.x + 2 * u * t * P1.x + t * t * P2.x;
    const y = u * u * P0.y + 2 * u * t * P1.y + t * t * P2.y;
    length += Math.hypot(x - prevX, y - prevY);
    prevX = x;
    prevY = y;
  }
  return length;
}

function clampToViewport(elapsed, force = false) {
  mark.group.updateMatrixWorld(true);
  bounds.setFromObject(mark.group);

  let bounced = false;

  if (bounds.min.x < viewport.left) {
    mark.group.position.x += viewport.left - bounds.min.x;
    velocity.x = Math.abs(velocity.x);
    bounced = true;
  }

  if (bounds.max.x > viewport.right) {
    mark.group.position.x -= bounds.max.x - viewport.right;
    velocity.x = -Math.abs(velocity.x);
    bounced = true;
  }

  if (bounds.min.y < viewport.bottom) {
    mark.group.position.y += viewport.bottom - bounds.min.y;
    velocity.y = Math.abs(velocity.y);
    bounced = true;
  }

  if (bounds.max.y > viewport.top) {
    mark.group.position.y -= bounds.max.y - viewport.top;
    velocity.y = -Math.abs(velocity.y);
    bounced = true;
  }

  if (bounced && (force || elapsed - lastAccentSwap > 0.14)) {
    lastAccentSwap = elapsed;
    setAccent((accentIndex + 1) % accentPalette.length);
  }
}

function setAccent(nextIndex) {
  accentIndex = nextIndex;
}

function playCornerEffect(corner) {
  if (!cornerEffectElement) {
    return;
  }

  const rgb = hexToRgb(accentPalette[accentIndex]);
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

async function waitForFonts() {
  if (!document.fonts) {
    return;
  }

  try {
    await Promise.all([
      document.fonts.load("700 188px 'Space Grotesk'"),
      document.fonts.load("400 32px 'Space Grotesk'"),
    ]);
  } catch (err) {
    // Font failed to load — fall back to whatever the canvas resolves.
  }
}

function createMark() {
  const group = new THREE.Group();

  const planeWidth = 720;
  const planeHeight = 260;
  const textureWidth = 1440;
  const textureHeight = 520;

  const textureCanvas = document.createElement('canvas');
  textureCanvas.width = textureWidth;
  textureCanvas.height = textureHeight;
  const ctx = textureCanvas.getContext('2d');

  const texture = new THREE.CanvasTexture(textureCanvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = renderer.capabilities.getMaxAnisotropy();

  const planeMaterial = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
  });
  const plane = new THREE.Mesh(
    new THREE.PlaneGeometry(planeWidth, planeHeight),
    planeMaterial,
  );
  group.add(plane);

  function drawRoundedRect(context, x, y, w, h, r) {
    context.beginPath();
    context.moveTo(x + r, y);
    context.lineTo(x + w - r, y);
    context.quadraticCurveTo(x + w, y, x + w, y + r);
    context.lineTo(x + w, y + h - r);
    context.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    context.lineTo(x + r, y + h);
    context.quadraticCurveTo(x, y + h, x, y + h - r);
    context.lineTo(x, y + r);
    context.quadraticCurveTo(x, y, x + r, y);
    context.closePath();
  }

  function repaint() {
    ctx.clearRect(0, 0, textureWidth, textureHeight);

    const lineWidth = 6;
    const inset = lineWidth / 2 + 4;
    ctx.strokeStyle = frameColor;
    ctx.lineWidth = lineWidth;
    drawRoundedRect(
      ctx,
      inset,
      inset,
      textureWidth - inset * 2,
      textureHeight - inset * 2,
      22,
    );
    ctx.stroke();

    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';

    ctx.fillStyle = inkColor;
    ctx.font = "700 188px 'Space Grotesk', system-ui, sans-serif";
    ctx.fillText(WORDMARK, textureWidth / 2, textureHeight / 2 + 32);

    ctx.fillStyle = inkMutedColor;
    ctx.font = "400 32px 'Space Grotesk', system-ui, sans-serif";
    if ('letterSpacing' in ctx) {
      ctx.letterSpacing = '8px';
    }
    ctx.fillText(CAPTION.toUpperCase(), textureWidth / 2, textureHeight / 2 + 100);
    if ('letterSpacing' in ctx) {
      ctx.letterSpacing = '0px';
    }

    texture.needsUpdate = true;
  }

  return { group, plane, repaint };
}
