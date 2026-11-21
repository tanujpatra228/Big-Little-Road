import type { CarSpec } from '../../shared/cars';

type Key = 'mass' | 'comDrop' | 'enginePower' | 'topSpeed' | 'frictionSlip' | 'sideFriction' | 'suspensionStiffness' | 'suspensionCompression' | 'suspensionRelaxation' | 'suspensionRest' | 'maxSteer' | 'steerFalloffSpeed' | 'brakeForce' | 'angularDamping';

const FIELDS: Array<[Key, number]> = [
  ['mass', 1], ['comDrop', 0.02], ['enginePower', 5], ['topSpeed', 1], ['frictionSlip', 0.2], ['sideFriction', 0.1],
  ['suspensionStiffness', 1], ['suspensionCompression', 0.2], ['suspensionRelaxation', 0.2], ['suspensionRest', 0.02],
  ['maxSteer', 0.02], ['steerFalloffSpeed', 1], ['brakeForce', 1], ['angularDamping', 0.2],
];

/** Live tuning for playtests. Enabled with ?tune. Editing respawns the car in place. */
export class TunePanel {
  private readonly root = document.createElement('div');
  private readonly inputs = new Map<Key, HTMLInputElement>();
  private readonly out = document.createElement('textarea');

  constructor(private onChange: (spec: CarSpec) => void, private getGravity: () => number, private setGravity: (g: number) => void) {
    Object.assign(this.root.style, {
      position: 'fixed', left: '12px', top: '12px', width: '230px', maxHeight: '90vh', overflow: 'auto',
      background: '#000b', color: '#fff', font: '12px system-ui', padding: '8px', borderRadius: '8px',
    });
    this.root.addEventListener('keydown', (e) => e.stopPropagation());
    const title = document.createElement('div');
    title.textContent = 'Tuning (active car)';
    title.style.fontWeight = '700';
    this.root.appendChild(title);
    const g = this.row('gravity', 0.5, this.getGravity(), (v) => this.setGravity(v));
    void g;
    for (const [key, step] of FIELDS) {
      const input = this.row(key, step, 0, () => this.emit());
      this.inputs.set(key, input);
    }
    this.out.readOnly = true;
    Object.assign(this.out.style, { width: '100%', height: '70px', marginTop: '6px', fontSize: '10px' });
    this.root.appendChild(this.out);
    document.body.appendChild(this.root);
    this.current = null as unknown as CarSpec;
  }

  private current: CarSpec;

  private row(label: string, step: number, value: number, onInput: (v: number) => void): HTMLInputElement {
    const wrap = document.createElement('label');
    Object.assign(wrap.style, { display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '2px 0' });
    const span = document.createElement('span');
    span.textContent = label;
    const input = document.createElement('input');
    input.type = 'number';
    input.step = String(step);
    input.value = String(value);
    input.style.width = '80px';
    input.addEventListener('change', () => onInput(Number(input.value)));
    wrap.append(span, input);
    this.root.appendChild(wrap);
    return input;
  }

  show(spec: CarSpec): void {
    this.current = spec;
    for (const [key] of FIELDS) {
      const input = this.inputs.get(key);
      if (input) input.value = String(Math.round(spec[key] * 1000) / 1000);
    }
    this.out.value = JSON.stringify(Object.fromEntries(FIELDS.map(([k]) => [k, spec[k]])));
  }

  private emit(): void {
    const next = JSON.parse(JSON.stringify(this.current)) as CarSpec;
    for (const [key] of FIELDS) {
      const input = this.inputs.get(key);
      if (input && Number.isFinite(Number(input.value))) next[key] = Number(input.value);
    }
    this.show(next);
    this.onChange(next);
  }
}
