import * as THREE from 'three';

/**
 * The winch cable: a line from the Hauler's bumper to what it hooked, with a small hook at the far
 * end. It goes from dull to bright as the pull gets harder. One per winch that is running.
 */
export class WinchCable {
  private readonly geo = new THREE.BufferGeometry();
  private readonly mat = new THREE.LineBasicMaterial({ color: 0xffd23f, toneMapped: false, fog: false });
  private readonly line: THREE.Line;
  private readonly hook: THREE.Mesh;

  constructor(private readonly scene: THREE.Scene) {
    this.geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
    this.line = new THREE.Line(this.geo, this.mat);
    this.line.frustumCulled = false;
    this.hook = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffd23f, toneMapped: false, fog: false }));
    scene.add(this.line, this.hook);
  }

  set(from: THREE.Vector3, to: THREE.Vector3, pulling: boolean): void {
    const a = this.geo.getAttribute('position') as THREE.BufferAttribute;
    a.setXYZ(0, from.x, from.y, from.z);
    a.setXYZ(1, to.x, to.y, to.z);
    a.needsUpdate = true;
    this.hook.position.copy(to);
    this.mat.color.setHex(pulling ? 0xfff3b0 : 0xb89a30);
  }

  dispose(): void {
    this.scene.remove(this.line, this.hook);
    this.geo.dispose();
    this.mat.dispose();
  }
}
