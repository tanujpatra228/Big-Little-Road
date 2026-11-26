import type { MissionView } from '../game/missions';

const fmt = (ms: number): string => {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

/**
 * The mission on screen: a checklist of the stages with the current one open and a clock, and, when it
 * is finished, a results card with the stars and what earned each one.
 */
export class MissionPanel {
  private readonly root = document.createElement('div');
  private readonly head = document.createElement('div');
  private readonly clock = document.createElement('span');
  private readonly body = document.createElement('div');
  private readonly card = document.createElement('div');
  private signature = '';
  private cardUntil = 0;

  constructor() {
    const css = document.createElement('style');
    css.textContent = `
      .mission{position:fixed;left:14px;top:58px;width:268px;z-index:25;background:#10151cd9;color:#fff;border:1px solid #fff2;border-radius:10px;padding:10px 12px;font:13px/1.4 system-ui,sans-serif;display:none;pointer-events:none}
      .mission.on{display:block}
      .mission .head{display:flex;justify-content:space-between;align-items:baseline;gap:8px;font-weight:700;margin-bottom:6px}
      .mission .head .clock{font:600 13px ui-monospace,Menlo,Consolas,monospace;opacity:.9}
      .mission .stage{margin:5px 0;opacity:.45}
      .mission .stage.current{opacity:1}
      .mission .stage.done{opacity:.6}
      .mission .stage .t{font-weight:600}
      .mission .stage.done .t::before{content:'\\2713  ';color:#6dff9e}
      .mission .stage.current .t::before{content:'\\25B6  ';color:#ffd23f}
      .mission .stage.todo .t::before{content:'\\25CB  '}
      .mission .obj{margin:3px 0 0 18px;font-size:12px;opacity:.9}
      .mission .obj.done{opacity:.6;text-decoration:line-through}
      .missioncard{position:fixed;left:50%;top:22%;transform:translateX(-50%) scale(.92);z-index:35;background:#10151cf2;color:#fff;border:2px solid #ffd23f;border-radius:16px;padding:16px 28px;text-align:center;font:14px/1.5 system-ui,sans-serif;opacity:0;pointer-events:none;transition:opacity .3s,transform .3s}
      .missioncard.on{opacity:1;transform:translateX(-50%) scale(1)}
      .missioncard h3{margin:0 0 4px;font-size:20px;color:#ffd23f}
      .missioncard .stars{font-size:38px;letter-spacing:6px;color:#ffd23f;margin:2px 0 6px}
      .missioncard .stars .off{color:#ffffff33}
      .missioncard ul{list-style:none;margin:6px 0 0;padding:0;text-align:left;display:inline-block}
      .missioncard li.off{opacity:.45}
    `;
    document.head.appendChild(css);
    this.root.className = 'mission';
    this.head.className = 'head';
    this.head.append(document.createElement('span'), this.clock);
    this.clock.className = 'clock';
    this.root.append(this.head, this.body);
    this.card.className = 'missioncard';
    document.body.append(this.root, this.card);
  }

  /** Call every frame. `view` is null when no mission is on. `now` is performance.now(). */
  update(view: MissionView | null, now: number, completedAt: number): void {
    if (!view) {
      this.root.classList.remove('on');
      this.card.classList.remove('on');
      this.signature = '';
      return;
    }
    this.root.classList.add('on');
    this.clock.textContent = fmt(view.elapsedMs);
    const sig = JSON.stringify([view.def.id, view.status, view.resets, view.stages.map((s) => [s.state, s.objectives.map((o) => [o.done, o.have])])]);
    if (sig !== this.signature) {
      this.signature = sig;
      (this.head.firstChild as HTMLElement).textContent = view.def.name + (view.status === 'complete' ? ' (done)' : '');
      this.body.replaceChildren();
      for (const st of view.stages) {
        const el = document.createElement('div');
        el.className = `stage ${st.state}`;
        const t = document.createElement('div');
        t.className = 't';
        t.textContent = st.title;
        el.appendChild(t);
        if (st.state === 'current') {
          for (const o of st.objectives) {
            const line = document.createElement('div');
            line.className = `obj${o.done ? ' done' : ''}`;
            line.textContent = o.text + (!o.done && o.have > 0 ? ` (${o.have} so far)` : '');
            el.appendChild(line);
          }
        }
        this.body.appendChild(el);
      }
      if (view.resets > 0 && view.status === 'running') {
        const r = document.createElement('div');
        r.className = 'obj';
        r.textContent = `Resets: ${view.resets} (no-reset star lost)`;
        this.body.appendChild(r);
      }
    }

    // The results card, for a few seconds after finishing.
    if (view.result && completedAt > 0 && now - completedAt < 14000) {
      if (!this.card.classList.contains('on')) {
        const r = view.result;
        this.card.replaceChildren();
        const h = document.createElement('h3');
        h.textContent = `${view.def.name} complete!`;
        const stars = document.createElement('div');
        stars.className = 'stars';
        for (let i = 0; i < 3; i++) {
          const s = document.createElement('span');
          s.textContent = '★';
          if (i >= r.stars) s.className = 'off';
          stars.appendChild(s);
        }
        const time = document.createElement('div');
        time.textContent = `Time ${fmt(view.elapsedMs)}`;
        const list = document.createElement('ul');
        for (const [text, ok] of [
          ['Finished', true],
          [`Under ${fmt(r.parSeconds * 1000)}`, r.time],
          ['No resets', r.clean],
        ] as const) {
          const li = document.createElement('li');
          li.textContent = `${ok ? '★' : '☆'} ${text}`;
          if (!ok) li.className = 'off';
          list.appendChild(li);
        }
        this.card.append(h, stars, time, list);
        this.card.classList.add('on');
      }
    } else this.card.classList.remove('on');
  }
}
