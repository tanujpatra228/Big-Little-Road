import * as THREE from 'three';

let texture: THREE.CanvasTexture | null = null;

/** A soft round glow, used for flashes and sparks. Built once. */
export function glow(): THREE.CanvasTexture {
  if (!texture) {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d')!;
    const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.35, 'rgba(255,236,170,0.7)');
    grad.addColorStop(1, 'rgba(255,200,100,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 128);
    texture = new THREE.CanvasTexture(c);
    texture.colorSpace = THREE.SRGBColorSpace;
  }
  return texture;
}
