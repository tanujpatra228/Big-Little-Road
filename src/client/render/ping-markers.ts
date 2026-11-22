import * as THREE from 'three';
import { PING_STYLES, distanceLabel, edgeIndicator, pingOpacity, type PingKind } from '../../shared/ping';
import { pingIconSvg } from '../ui/ping-icons';

/** One ping to show, already placed in the world by the caller. */
export interface MarkerView {
  /** Stable id: the sender. */
  key: string;
  kind: PingKind;
  name: string;
  x: number;
  y: number;
  z: number;
  ageMs: number;
  /** Metres from the viewer's own car. */
  distance: number;
}

interface Live {
  el: HTMLElement;
  label: HTMLElement;
  ptr: HTMLElement;
  beam: THREE.Mesh;
  ring: THREE.Mesh;
  material: THREE.MeshBasicMaterial;
  kind: PingKind;
}

const BEAM_HEIGHT = 3.4;

/**
 * Draws pings: a glowing beam and a pulsing ring on the ground, an icon with the sender's name and
 * the distance floating above it, and, when the spot is off screen or behind you, the icon slides to
 * the edge of the screen with an arrow pointing the way.
 */
export class PingMarkers {
  private readonly layer = document.createElement('div');
  private readonly live = new Map<string, Live>();
  private readonly v = new THREE.Vector3();
  private readonly beamGeo = new THREE.CylinderGeometry(0.05, 0.09, BEAM_HEIGHT, 8, 1, true).translate(0, BEAM_HEIGHT / 2, 0);
  private readonly ringGeo = new THREE.RingGeometry(0.55, 0.72, 40).rotateX(-Math.PI / 2);
  private clock = 0;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly camera: THREE.PerspectiveCamera,
  ) {
    const css = document.createElement('style');
    css.textContent = `
      .pinglayer{position:fixed;inset:0;pointer-events:none;overflow:hidden;z-index:20;font:600 12px system-ui,sans-serif;color:#fff;text-shadow:0 1px 3px #000c}
      .pinglayer .ping{position:absolute;left:0;top:0;will-change:transform,opacity}
      .pinglayer .ping .ico{width:38px;height:38px;margin:-19px 0 0 -19px;border-radius:50%;background:#10151ce6;border:3px solid var(--c);display:grid;place-items:center;color:var(--c);box-shadow:0 3px 12px #0008}
      .pinglayer .ping .lab{position:absolute;left:0;top:24px;transform:translateX(-50%);white-space:nowrap;background:#000a;padding:2px 8px;border-radius:999px}
      .pinglayer .ping .ptr{position:absolute;left:0;top:0;width:0;height:0}
      .pinglayer .ping .ptr::after{content:'';position:absolute;left:-7px;top:-38px;border:7px solid transparent;border-bottom:11px solid var(--c);border-top:0;display:none}
      .pinglayer .ping.edge .ptr::after{display:block}
      .pinglayer .ping.edge .ico{width:30px;height:30px;margin:-15px 0 0 -15px}
      .pinglayer .ping.edge .ico svg{width:18px;height:18px}
      .pinglayer .ping.edge .lab{display:none}
    `;
    document.head.appendChild(css);
    this.layer.className = 'pinglayer';
    document.body.appendChild(this.layer);
  }

  private create(m: MarkerView): Live {
    const style = PING_STYLES[m.kind];
    const el = document.createElement('div');
    el.className = 'ping';
    el.dataset.kind = m.kind;
    el.dataset.sender = m.key;
    el.style.setProperty('--c', style.color);
    const ptr = document.createElement('div');
    ptr.className = 'ptr';
    const ico = document.createElement('div');
    ico.className = 'ico';
    ico.innerHTML = pingIconSvg(m.kind, 22);
    const label = document.createElement('div');
    label.className = 'lab';
    el.append(ptr, ico, label);
    this.layer.appendChild(el);

    const material = new THREE.MeshBasicMaterial({ color: style.color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false, toneMapped: false });
    const beam = new THREE.Mesh(this.beamGeo, material);
    const ring = new THREE.Mesh(this.ringGeo, material);
    beam.renderOrder = ring.renderOrder = 8;
    this.scene.add(beam, ring);
    return { el, label, ptr, beam, ring, material, kind: m.kind };
  }

  private drop(l: Live): void {
    l.el.remove();
    this.scene.remove(l.beam, l.ring);
    l.material.dispose();
  }

  /** Call once per frame with every live ping (and nothing else: pings missing from the list are removed). */
  update(views: readonly MarkerView[], dt: number): void {
    this.clock += dt;
    const keep = new Set(views.map((m) => m.key));
    for (const [key, l] of this.live) {
      if (!keep.has(key)) {
        this.drop(l);
        this.live.delete(key);
      }
    }
    const w = innerWidth;
    const h = innerHeight;
    for (const m of views) {
      let l = this.live.get(m.key);
      if (l && l.kind !== m.kind) {
        this.drop(l);
        this.live.delete(m.key);
        l = undefined;
      }
      if (!l) {
        l = this.create(m);
        this.live.set(m.key, l);
      }
      const opacity = pingOpacity(m.kind, m.ageMs);

      // In the world: a beam up from the ground and a ring that pulses outward.
      l.beam.position.set(m.x, m.y, m.z);
      l.ring.position.set(m.x, m.y + 0.06, m.z);
      const pulse = (this.clock * 0.9 + m.ageMs * 0.001) % 1;
      l.ring.scale.setScalar(1 + pulse * 1.4);
      l.material.opacity = opacity * (0.55 - pulse * 0.25);

      // On screen: the icon above the beam, or an arrow at the edge.
      this.v.set(m.x, m.y + BEAM_HEIGHT + 0.3, m.z);
      const behind = this.v.clone().applyMatrix4(this.camera.matrixWorldInverse).z > 0;
      this.v.project(this.camera);
      const e = edgeIndicator(this.v.x, this.v.y, behind);
      const px = (e.x * 0.5 + 0.5) * w;
      const py = (-e.y * 0.5 + 0.5) * h;
      l.el.style.transform = `translate(${px.toFixed(1)}px, ${py.toFixed(1)}px)`;
      l.el.style.opacity = String(opacity.toFixed(3));
      l.el.classList.toggle('edge', !e.onScreen);
      l.ptr.style.transform = `rotate(${e.angle}rad)`;
      l.label.textContent = `${m.name} · ${distanceLabel(m.distance)}`;
    }
  }

  dispose(): void {
    for (const l of this.live.values()) this.drop(l);
    this.live.clear();
    this.beamGeo.dispose();
    this.ringGeo.dispose();
    this.layer.remove();
  }
}
