import type { Volumes } from '../../shared/audio-model';
import type { GameAudio } from '../audio/game-audio';

const SLIDERS: Array<[keyof Volumes, string]> = [
  ['master', 'Master'],
  ['engine', 'Engines'],
  ['effects', 'Effects'],
  ['ambience', 'Ambience'],
];

/** A speaker button in the corner that opens volume sliders. Settings are remembered. */
export class AudioPanel {
  private readonly root = document.createElement('div');
  private readonly button = document.createElement('button');
  private readonly box = document.createElement('div');
  private readonly muteBtn = document.createElement('button');
  private readonly inputs = new Map<keyof Volumes, HTMLInputElement>();

  constructor(private readonly audio: GameAudio) {
    const css = document.createElement('style');
    css.textContent = `
      .snd{position:fixed;top:14px;left:14px;font:13px/1.4 system-ui,sans-serif;color:#fff;z-index:5}
      .snd > button{font:inherit;color:#fff;background:#10151cb8;border:1px solid #ffffff2a;border-radius:999px;padding:7px 12px;cursor:pointer;backdrop-filter:blur(6px)}
      .snd .box{display:none;margin-top:8px;width:210px;background:#10151cd0;border:1px solid #ffffff22;border-radius:12px;padding:10px 12px;backdrop-filter:blur(6px)}
      .snd.open .box{display:block}
      .snd label{display:flex;align-items:center;justify-content:space-between;gap:10px;margin:7px 0}
      .snd input[type=range]{width:110px;accent-color:#3a7bd5}
      .snd .mute{font:inherit;color:#fff;background:#ffffff1f;border:0;border-radius:8px;padding:5px 10px;cursor:pointer;margin-top:4px}
      .snd .hint{opacity:.65;font-size:12px;margin-top:6px}
    `;
    document.head.appendChild(css);
    this.root.className = 'snd';
    this.root.addEventListener('keydown', (e) => e.stopPropagation());

    this.button.type = 'button';
    this.button.setAttribute('aria-label', 'Sound settings');
    this.button.addEventListener('click', () => {
      this.root.classList.toggle('open');
      this.sync();
    });

    this.box.className = 'box';
    const vols = audio.getVolumes();
    for (const [key, label] of SLIDERS) {
      const row = document.createElement('label');
      const text = document.createElement('span');
      text.textContent = label;
      const input = document.createElement('input');
      input.type = 'range';
      input.min = '0';
      input.max = '100';
      input.value = String(Math.round(vols[key] * 100));
      input.addEventListener('input', () => audio.setVolume(key, Number(input.value) / 100));
      this.inputs.set(key, input);
      row.append(text, input);
      this.box.append(row);
    }
    this.muteBtn.type = 'button';
    this.muteBtn.className = 'mute';
    this.muteBtn.addEventListener('click', () => {
      audio.toggleMute();
      this.sync();
    });
    const hint = document.createElement('div');
    hint.className = 'hint';
    hint.textContent = 'M also mutes.';
    this.box.append(this.muteBtn, hint);

    this.root.append(this.button, this.box);
    document.body.appendChild(this.root);
    this.sync();
  }

  /** Call after anything outside the panel changes the sound state (the M key). */
  sync(): void {
    const muted = this.audio.isMuted;
    this.button.textContent = muted ? '🔇 Sound' : '🔊 Sound';
    this.muteBtn.textContent = muted ? 'Unmute' : 'Mute';
    const vols = this.audio.getVolumes();
    for (const [key, input] of this.inputs) input.value = String(Math.round(vols[key] * 100));
  }
}
