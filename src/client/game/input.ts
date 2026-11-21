import { approach, deadzone, type DriveInput } from '../../shared/driving';

/** Keyboard + gamepad. Keyboard steering ramps so taps are gentle and holds are full lock. */
export class InputDevices {
  private keys = new Set<string>();
  private steerSmooth = 0;
  private pressed = new Set<string>();

  constructor() {
    addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement) return;
      if (!this.keys.has(e.code)) this.pressed.add(e.code);
      this.keys.add(e.code);
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());
  }

  isDown(code: string): boolean {
    return this.keys.has(code);
  }

  /** True once per physical key press. */
  wasPressed(code: string): boolean {
    return this.pressed.delete(code);
  }

  private pad(): Gamepad | null {
    const pads = navigator.getGamepads?.() ?? [];
    for (const p of pads) if (p?.connected) return p;
    return null;
  }

  read(dt: number): DriveInput {
    const k = (...codes: string[]): boolean => codes.some((c) => this.keys.has(c));
    let throttle = (k('KeyW', 'ArrowUp') ? 1 : 0) - (k('KeyS', 'ArrowDown') ? 1 : 0);
    let steerTarget = (k('KeyD', 'ArrowRight') ? 1 : 0) - (k('KeyA', 'ArrowLeft') ? 1 : 0);
    let handbrake = k('Space');

    const pad = this.pad();
    if (pad) {
      const rt = pad.buttons[7]?.value ?? 0;
      const lt = pad.buttons[6]?.value ?? 0;
      if (rt > 0.05 || lt > 0.05) throttle = rt - lt;
      const ax = deadzone(pad.axes[0] ?? 0);
      if (ax !== 0) {
        this.steerSmooth = ax;
        steerTarget = ax;
      }
      handbrake = handbrake || (pad.buttons[0]?.pressed ?? false);
    }

    const padSteering = pad !== null && deadzone(pad.axes[0] ?? 0) !== 0;
    if (!padSteering) {
      const rate = steerTarget === 0 ? 7 : Math.sign(this.steerSmooth) !== Math.sign(steerTarget) ? 9 : 4.5;
      this.steerSmooth = approach(this.steerSmooth, steerTarget, rate, dt);
    }
    return { throttle, steer: this.steerSmooth, handbrake };
  }
}
