// Skyward Run — controls.js
// One clear job: read the player's hands. Keyboard (W/S or arrows for pitch,
// A/D or arrows for roll, Shift/Ctrl or R/F for throttle, P pause, R restart,
// M music, Enter start) and mouse steering as a bonus. The game asks this
// class once a frame for a normalised input; it never reads keys itself.

export class Controls {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.mouseActive = false;
    this.mouseX = 0;
    this.mouseY = 0;
    this.mouseDown = false;
    // Callbacks the game wires up: pause, restart, music, start.
    this.onPause = null;
    this.onRestart = null;
    this.onMusic = null;
    this.onStart = null;
    this.onAnyKey = null;
    this.boundKeyDown = (e) => this.keyDown(e);
    this.boundKeyUp = (e) => this.keyUp(e);
    this.boundMouseMove = (e) => this.mouseMove(e);
    this.boundMouseDown = (e) => this.mouseButton(e, true);
    this.boundMouseUp = (e) => this.mouseButton(e, false);
  }

  attach() {
    window.addEventListener('keydown', this.boundKeyDown);
    window.addEventListener('keyup', this.boundKeyUp);
    this.canvas.addEventListener('mousemove', this.boundMouseMove);
    this.canvas.addEventListener('mousedown', this.boundMouseDown);
    window.addEventListener('mouseup', this.boundMouseUp);
  }

  detach() {
    window.removeEventListener('keydown', this.boundKeyDown);
    window.removeEventListener('keyup', this.boundKeyUp);
    this.canvas.removeEventListener('mousemove', this.boundMouseMove);
    this.canvas.removeEventListener('mousedown', this.boundMouseDown);
    window.removeEventListener('mouseup', this.boundMouseUp);
  }

  keyDown(e) {
    // Space and the arrows would scroll the page; the game owns them.
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' '].includes(e.key)) {
      e.preventDefault();
    }
    if (this.onAnyKey) this.onAnyKey();
    const k = e.key.toLowerCase();
    if (k === 'p' && !e.repeat) {
      if (this.onPause) this.onPause();
      return;
    }
    if (k === 'r' && !e.repeat) {
      if (this.onRestart) this.onRestart();
      return;
    }
    if (k === 'm' && !e.repeat) {
      if (this.onMusic) this.onMusic();
      return;
    }
    if (k === 'enter' && !e.repeat) {
      if (this.onStart) this.onStart();
      return;
    }
    this.keys.add(k);
  }

  keyUp(e) {
    this.keys.delete(e.key.toLowerCase());
  }

  mouseMove(e) {
    const rect = this.canvas.getBoundingClientRect();
    this.mouseX = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouseY = ((e.clientY - rect.top) / rect.height) * 2 - 1;
    this.mouseActive = true;
  }

  mouseButton(e, down) {
    if (e.button === 0) this.mouseDown = down;
  }

  // Normalised stick for this frame. Keyboard wins when it is held; otherwise
  // a held left mouse button steers toward the pointer. Throttle is a delta
  // the flight model integrates, so holding Shift spools the engine up.
  read() {
    let pitch = 0;
    let roll = 0;
    if (this.keys.has('w') || this.keys.has('arrowup')) pitch += 1;
    if (this.keys.has('s') || this.keys.has('arrowdown')) pitch -= 1;
    if (this.keys.has('a') || this.keys.has('arrowleft')) roll -= 1;
    if (this.keys.has('d') || this.keys.has('arrowright')) roll += 1;
    if (pitch === 0 && roll === 0 && this.mouseDown && this.mouseActive) {
      // Mouse steering: pointer above centre pulls up, right of centre banks right.
      pitch = -this.mouseY;
      roll = this.mouseX;
    }
    // R is restart (handled in keyDown), so throttle uses Shift / Ctrl / F.
    let throttleDelta = 0;
    if (this.keys.has('shift')) throttleDelta += 1;
    if (this.keys.has('control') || this.keys.has('f')) throttleDelta -= 1;
    return { pitch, roll, throttleDelta };
  }

  clear() {
    this.keys.clear();
    this.mouseDown = false;
  }
}
