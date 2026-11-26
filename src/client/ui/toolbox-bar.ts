import { ITEMS, SLOTS, type ItemKind } from '../../shared/toolbox';

const letters: Record<ItemKind, string> = { beacon: 'B', stake: 'S', cone: 'C' };

/** The six slots along the bottom of the screen. The first key is for slot 1 (4 on the keyboard). */
export class ToolboxBar {
  private readonly root = document.createElement('div');
  private readonly cells: HTMLElement[] = [];
  private readonly hint = document.createElement('div');
  private last = '';

  constructor(
    private readonly onPick: (slot: number) => void,
    /** The keyboard key for each slot, for the label. */
    keyLabel: (slot: number) => string,
  ) {
    const css = document.createElement('style');
    css.textContent = `
      .toolbar{position:fixed;left:50%;bottom:92px;transform:translateX(-50%);display:flex;flex-direction:column;align-items:center;gap:4px;z-index:15;font:600 11px system-ui,sans-serif;color:#fff;text-shadow:0 1px 3px #000a;pointer-events:none}
      .toolbar .row{display:flex;gap:6px}
      .toolbar .slot{position:relative;width:44px;height:44px;border-radius:10px;background:#0009;border:2px solid #fff3;display:grid;place-items:center;pointer-events:auto;cursor:pointer}
      .toolbar .slot.sel{border-color:#ffd23f;background:#000c}
      .toolbar .slot .k{position:absolute;left:4px;top:1px;font-size:9px;opacity:.7}
      .toolbar .slot .it{width:22px;height:22px;border-radius:50%;display:grid;place-items:center;font-size:12px;font-weight:800;color:#10151c;background:var(--c)}
      .toolbar .slot.empty .it{display:none}
      .toolbar .hint{opacity:.7;font-weight:500;background:#0006;padding:1px 10px;border-radius:999px}
    `;
    document.head.appendChild(css);
    this.root.className = 'toolbar';
    const row = document.createElement('div');
    row.className = 'row';
    for (let i = 0; i < SLOTS; i++) {
      const c = document.createElement('div');
      c.className = 'slot empty';
      c.innerHTML = `<span class="k">${keyLabel(i)}</span><span class="it"></span>`;
      c.onclick = () => this.onPick(i);
      row.appendChild(c);
      this.cells.push(c);
    }
    this.hint.className = 'hint';
    this.hint.textContent = 'E drop  ·  X pick up';
    this.root.append(row, this.hint);
    document.body.appendChild(this.root);
  }

  /** Redraws only when something changed. */
  update(slots: ReadonlyArray<ItemKind | null>, selected: number): void {
    const key = slots.map((s) => s ?? '-').join(',') + `|${selected}`;
    if (key === this.last) return;
    this.last = key;
    this.cells.forEach((c, i) => {
      const kind = slots[i] ?? null;
      c.classList.toggle('empty', !kind);
      c.classList.toggle('sel', i === selected);
      const it = c.querySelector('.it') as HTMLElement;
      if (kind) {
        it.textContent = letters[kind];
        it.style.setProperty('--c', '#' + ITEMS[kind].color.toString(16).padStart(6, '0'));
        c.title = ITEMS[kind].label;
      } else c.title = 'Empty';
    });
  }

  setHint(text: string): void {
    this.hint.textContent = text;
  }
}
