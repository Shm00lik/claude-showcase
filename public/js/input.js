// Keyboard + gamepad -> {fwd, turn}. A / left = positive turn (CCW).
const keys = new Set();
const dead = v => (Math.abs(v) < 0.1 ? 0 : v);
let enabled = false;

const typing = e => /^(INPUT|TEXTAREA|SELECT)$/.test(e.target?.tagName);
addEventListener('keydown', e => {
  if (!enabled || typing(e) || e.ctrlKey || e.metaKey || e.altKey) return;
  keys.add(e.code);
  if (e.code.startsWith('Arrow') || e.code === 'Space') e.preventDefault();
});
addEventListener('keyup', e => keys.delete(e.code));
export const clearInput = () => keys.clear();
export const setInputEnabled = on => { enabled = on; if (!on) keys.clear(); };

export function readInput() {
  if (!enabled || !document.hasFocus() || document.hidden) return { fwd: 0, turn: 0 };
  let fwd = (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0) - (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0);
  let turn = (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0) - (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0);
  const pad = [...(navigator.getGamepads?.() || [])].find(p => p && p.connected && p.mapping === 'standard');
  if (pad) {
    const gf = dead(-(pad.axes[1] || 0)), gt = dead(-(pad.axes[2] || 0));
    if (gf) fwd = gf;
    if (gt) turn = gt;
  }
  return { fwd: Math.max(-1, Math.min(1, fwd)), turn: Math.max(-1, Math.min(1, turn)) };
}
