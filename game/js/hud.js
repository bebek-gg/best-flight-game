// Skyward Run — hud.js
// One clear job: the instruments. The HUD is a DOM overlay (numbers, bars,
// a compass strip and a canvas attitude indicator) that this class refreshes
// every frame from the aircraft and mission state. It draws nothing in the
// 3D scene and never touches the flight model.

import { headingDegrees, compassPoint, clamp } from './config.js';

export class Hud {
  constructor(root) {
    this.root = root;
    this.el = {};
    const ids = ['alt', 'speed', 'heading', 'compass', 'throttle', 'throttleBar',
      'fuel', 'fuelBar', 'vspeed', 'score', 'timer', 'objective', 'message',
      'sortie', 'rings'];
    for (const id of ids) this.el[id] = root.querySelector('#hud-' + id);
    this.attitude = root.querySelector('#hud-attitude');
    this.attCtx = this.attitude ? this.attitude.getContext('2d') : null;
    this.messageTimer = 0;
  }

  // mission: { name, objective, score, timeLeft, ringsHit, ringsTotal, sortie }
  // ac: the Aircraft instance.
  update(ac, mission, dt) {
    if (!this.el.alt) return;
    const altFt = ac.altitudeAgl() * 3.28084;
    const speedKt = ac.speed * 1.94384;
    const hdg = headingDegrees(ac.heading);
    this.el.alt.textContent = String(Math.round(altFt));
    this.el.speed.textContent = String(Math.round(speedKt));
    this.el.heading.textContent = String(Math.round(hdg)).padStart(3, '0') + '° ' + compassPoint(hdg);
    this.el.throttle.textContent = String(Math.round(ac.throttle * 100)) + '%';
    this.el.throttleBar.style.width = (ac.throttle * 100).toFixed(0) + '%';
    this.el.fuel.textContent = String(Math.round(ac.fuel)) + '%';
    this.el.fuelBar.style.width = ac.fuel.toFixed(0) + '%';
    this.el.fuelBar.classList.toggle('low', ac.fuel < 25);
    const vsFpm = ac.verticalSpeed * 196.85;
    this.el.vspeed.textContent = (vsFpm >= 0 ? '+' : '') + String(Math.round(vsFpm));
    this.el.score.textContent = String(mission.score);
    const t = Math.max(0, mission.timeLeft);
    const mm = String(Math.floor(t / 60));
    const ss = String(Math.floor(t % 60)).padStart(2, '0');
    this.el.timer.textContent = mm + ':' + ss;
    this.el.timer.classList.toggle('low', t < 30);
    this.el.objective.textContent = mission.objective;
    this.el.sortie.textContent = 'SORTIE ' + mission.sortie + ' — ' + mission.name;
    this.el.rings.textContent = mission.ringsTotal > 0
      ? 'RINGS ' + mission.ringsHit + '/' + mission.ringsTotal
      : 'LAND ON THE RUNWAY';
    if (this.messageTimer > 0) {
      this.messageTimer -= dt;
      if (this.messageTimer <= 0) this.el.message.textContent = '';
    }
    this.drawAttitude(ac);
    this.drawCompass(hdg);
  }

  showMessage(text, seconds) {
    if (!this.el.message) return;
    this.el.message.textContent = text;
    this.messageTimer = seconds || 3;
  }

  // Artificial horizon: a canvas with a sky/ground split that rolls with the
  // aircraft and slides with pitch, plus a fixed centre marker.
  drawAttitude(ac) {
    const ctx = this.attCtx;
    if (!ctx) return;
    const w = this.attitude.width;
    const h = this.attitude.height;
    const cx = w / 2;
    const cy = h / 2;
    ctx.clearRect(0, 0, w, h);
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, 46, 0, Math.PI * 2);
    ctx.clip();
    ctx.translate(cx, cy);
    ctx.rotate(-ac.roll);
    const pitchPx = clamp(ac.pitch * 90, -40, 40);
    ctx.translate(0, pitchPx);
    ctx.fillStyle = '#3f8fd2';
    ctx.fillRect(-60, -60, 120, 60);
    ctx.fillStyle = '#8a6b42';
    ctx.fillRect(-60, 0, 120, 60);
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.lineWidth = 1;
    for (const dy of [-30, -15, 15, 30]) {
      ctx.beginPath();
      ctx.moveTo(-28, dy);
      ctx.lineTo(28, dy);
      ctx.stroke();
    }
    ctx.restore();
    ctx.strokeStyle = '#f2f2e8';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cx, cy, 46, 0, Math.PI * 2);
    ctx.stroke();
    // Fixed aircraft marker: wings and a centre dot.
    ctx.strokeStyle = '#ffd24a';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(cx - 26, cy);
    ctx.lineTo(cx - 8, cy);
    ctx.moveTo(cx + 8, cy);
    ctx.lineTo(cx + 26, cy);
    ctx.moveTo(cx, cy - 8);
    ctx.lineTo(cx, cy + 8);
    ctx.stroke();
  }

  // A scrolling compass strip: tick marks and cardinal letters around the
  // current heading, so the pilot can steer by the strip alone. Labels are
  // every 30 degrees — closer than that they collide into an unreadable mash.
  drawCompass(hdg) {
    const strip = this.el.compass;
    if (!strip) return;
    const width = strip.clientWidth || 220;
    const pxPerDeg = 1.6;
    const half = width / pxPerDeg / 2;
    let html = '';
    const start = Math.floor((hdg - half) / 30) * 30;
    for (let d = start; d <= hdg + half + 30; d += 30) {
      const norm = ((d % 360) + 360) % 360;
      const x = width / 2 + (d - hdg) * pxPerDeg;
      if (x < -10 || x > width + 10) continue;
      const label = norm % 90 === 0
        ? ['N', 'E', 'S', 'W'][Math.round(norm / 90) % 4]
        : String(norm);
      html += '<span style="left:' + x.toFixed(0) + 'px">' + label + '</span>';
    }
    strip.innerHTML = html;
  }
}
