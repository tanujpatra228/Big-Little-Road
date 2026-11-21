import * as THREE from 'three';
import { CARS, CAR_ORDER, cloneSpec, type CarRole, type CarSpec } from '../shared/cars';
import { generateTerrain, SPAWN } from '../shared/terrain';
import { generateBoulders } from '../shared/boulders';
import { createPhysicsWorld, FIXED_DT, initRapier, type PhysicsWorld } from './physics/world';
import { FLIP_RESET_SECONDS, Vehicle } from './physics/vehicle';
import { buildBoulderMesh, buildTerrainMesh } from './render/terrain-mesh';
import { buildGrass } from './render/grass';
import { CarMesh } from './render/car-mesh';
import { ChaseCam } from './render/chase-cam';
import { InputDevices } from './game/input';
import { createStage } from './render/stage';
import { runShowcase } from './game/showcase';
import { GameAudio } from './audio/game-audio';
import { AudioPanel } from './ui/audio-panel';
import { Hud } from './ui/hud';
import { CoopPanel, type PanelPlayer } from './ui/coop-panel';
import { RoomClient } from './net/room-client';
import { RemoteCar } from './net/remote-car';
import { TetherController } from './game/tether-controller';
import { nextPoseDelay } from '../shared/net/pose';
import { ROOM_CODE, type PlayerInfo } from '../shared/net/protocol';
import { TunePanel } from './ui/tune-panel';

const SEED = 20260;
const params = new URLSearchParams(location.search);

async function boot(): Promise<void> {
  await initRapier();
  const stage = createStage(params);
  if (params.has('showcase')) {
    runShowcase(stage, params);
    return;
  }
  const { scene, camera } = stage;
  const terrain = generateTerrain(SEED);
  const boulders = generateBoulders(terrain);
  const pw: PhysicsWorld = createPhysicsWorld(terrain, boulders);
  scene.add(buildTerrainMesh(terrain), buildBoulderMesh(boulders));
  const grass = buildGrass(terrain);
  scene.add(grass.group);

  const chase = new ChaseCam(camera, terrain);
  const input = new InputDevices();

  // Browsers only start audio after a gesture, so unlock on the first key, click or touch.
  const audio = new GameAudio();
  const audioPanel = new AudioPanel(audio);
  const unlock = (): void => audio.unlock();
  for (const ev of ['keydown', 'pointerdown', 'touchstart'] as const) addEventListener(ev, unlock, { passive: true });

  const specs: Record<CarRole, CarSpec> = {
    scout: cloneSpec(CARS.scout),
    hauler: cloneSpec(CARS.hauler),
    relay: cloneSpec(CARS.relay),
  };
  let role: CarRole = 'scout';
  let vehicle: Vehicle;
  let mesh: CarMesh;
  let gravity = 9.81;

  const spawn = (r: CarRole, x: number, z: number, yaw: number): void => {
    if (vehicle) {
      vehicle.dispose();
      scene.remove(mesh.group);
    }
    const changed = role !== r;
    role = r;
    if (changed) net.sendCar(r);
    vehicle = new Vehicle(pw, specs[r], x, z, yaw);
    mesh = new CarMesh(specs[r]);
    scene.add(mesh.group);
    chase.snap();
    tune?.show(specs[r]);
  };

  const respawnInPlace = (): void => {
    const t = vehicle.body.translation();
    const q = vehicle.body.rotation();
    const yaw = Math.atan2(2 * (q.w * q.y + q.x * q.z), 1 - 2 * (q.y * q.y + q.z * q.z));
    spawn(role, t.x, t.z, yaw);
  };

  const tune = params.has('tune')
    ? new TunePanel(
        (spec) => {
          specs[role] = spec;
          respawnInPlace();
        },
        () => gravity,
        (g) => {
          gravity = g;
          pw.world.gravity = { x: 0, y: -g, z: 0 };
        },
      )
    : null;

  const hud = new Hud((r) => {
    const t = vehicle.body.translation();
    const q = vehicle.body.rotation();
    const yaw = Math.atan2(2 * (q.w * q.y + q.x * q.z), 1 - 2 * (q.y * q.y + q.z * q.z));
    spawn(r, t.x, t.z, yaw);
  });

  // ---- Multiplayer: every browser drives its own car; the room just relays poses.
  const remotes = new Map<string, RemoteCar>();
  const roster = new Map<string, PlayerInfo>();
  let forcePose = false; // re-announce ourselves when someone joins, so parked cars appear
  let lastPoseAt = 0;
  let stillForMs = 0;
  let hornSent = false;

  const refreshPanel = (): void => {
    const players: PanelPlayer[] = [...roster.values()].map((p) => ({ ...p, self: p.id === net.selfId, rtt: p.id === net.selfId ? net.rttMs : 0 }));
    panel.render({ status: net.status, code: net.code, max: 4, players, lag: net.lagMs });
  };
  const addRemote = (p: PlayerInfo): void => {
    roster.set(p.id, p);
    if (p.id === net.selfId) return;
    const existing = remotes.get(p.id);
    if (existing) existing.setRole(p.role);
    else remotes.set(p.id, new RemoteCar(scene, pw, p));
  };
  const net: RoomClient = new RoomClient(
    {
      welcome(id, code, list, props) {
        tether.onWelcome(props);
        roster.clear();
        for (const r of remotes.values()) r.dispose();
        remotes.clear();
        for (const p of list) addRemote(p);
        forcePose = true;
        // Line up on the patio by slot instead of stacking on one spot.
        const slot = Number(id.slice(1));
        const t = vehicle.body.translation();
        if (Math.hypot(t.x - SPAWN.x, t.z - SPAWN.z) < 6) spawn(role, SPAWN.x + (slot - 2.5) * 3, SPAWN.z, 0);
        const url = new URL(location.href);
        url.searchParams.set('room', code);
        history.replaceState(null, '', url);
        refreshPanel();
      },
      join(p) {
        addRemote(p);
        forcePose = true;
        refreshPanel();
      },
      leave(id) {
        remotes.get(id)?.dispose();
        remotes.delete(id);
        roster.delete(id);
        refreshPanel();
      },
      pose(id, frame, at) {
        remotes.get(id)?.push(frame, at);
      },
      car(id, r) {
        const p = roster.get(id);
        if (p) roster.set(id, { ...p, role: r });
        remotes.get(id)?.setRole(r);
        refreshPanel();
      },
      horn(id, on) {
        const rc = remotes.get(id);
        if (!on || !rc) return;
        const to = rc.position.clone().sub(camera.position);
        const d = to.length();
        const dir = new THREE.Vector3();
        camera.getWorldDirection(dir);
        const right = new THREE.Vector3().crossVectors(dir, camera.up).normalize();
        audio.remoteHorn(rc.role, 1 / (1 + d / 18), d > 0.01 ? to.normalize().dot(right) : 0);
      },
      prop(info) {
        tether.onProp(info);
      },
      ping() {},
      status() {
        if (net.status === 'off') {
          tether.onOffline();
          for (const r of remotes.values()) r.dispose();
          remotes.clear();
          roster.clear();
        }
        refreshPanel();
      },
    },
    { name: () => panel.name, role: () => role },
  );
  const tether = new TetherController({ scene, pw, terrain, net: () => net, vehicle: () => vehicle, role: () => role, remotes: () => remotes, audio });
  const panel: CoopPanel = new CoopPanel({
    async start() {
      try {
        net.connect(await net.create());
      } catch {
        panel.render({ status: 'failed', code: '', max: 4, players: [] });
      }
    },
    leave() {
      net.leave();
      const url = new URL(location.href);
      url.searchParams.delete('room');
      history.replaceState(null, '', url);
    },
  });
  window.setInterval(() => net.status === 'on' && panel.setRtt(net.rttMs), 2000); // ping readout only; no rebuild
  const joinCode = params.get('room')?.toUpperCase() ?? '';
  spawn('scout', SPAWN.x, SPAWN.z, 0); // after the net setup: spawn() tells the room about car changes
  if (ROOM_CODE.test(joinCode)) net.connect(joinCode);

  addEventListener('resize', () => stage.resize());

  // Test hook for automated runs.
  (window as unknown as { __blr: unknown }).__blr = {
    get vehicle() { return vehicle; },
    get role() { return role; },
    audio,
    get net() { return net; },
    remotes,
    get tether() { return tether; },
    spawn,
  };

  let last = performance.now();
  let acc = 0;
  stage.renderer.setAnimationLoop((now) => {
    const frame = Math.min(0.1, (now - last) / 1000);
    last = now;
    acc += frame;

    CAR_ORDER.forEach((r, i) => {
      if (input.wasPressed(`Digit${i + 1}`)) {
        const t = vehicle.body.translation();
        const q = vehicle.body.rotation();
        const yaw = Math.atan2(2 * (q.w * q.y + q.x * q.z), 1 - 2 * (q.y * q.y + q.z * q.z));
        spawn(r, t.x, t.z, yaw);
      }
    });
    if (input.wasPressed('KeyR')) {
      if (vehicle.flippedFor >= FLIP_RESET_SECONDS || params.has('debug') || params.has('tune')) vehicle.resetUpright();
    }

    // Other players' cars first, so their solid stand-ins and hitches are current for this frame.
    for (const r of remotes.values()) r.update(performance.now(), frame);
    if (input.wasPressed('KeyF')) tether.toggle();
    const rope = tether.update();
    hud.setPrompt(tether.prompt);

    let steps = 0;
    while (acc >= FIXED_DT && steps < 5) {
      vehicle.pushPlanar(rope.x, rope.z, FIXED_DT);
      vehicle.step(input.read(FIXED_DT), FIXED_DT);
      pw.world.step();
      vehicle.afterPhysics();
      acc -= FIXED_DT;
      steps++;
    }
    if (steps === 5) acc = 0;
    if (vehicle.isOutOfBounds()) spawn(role, SPAWN.x, SPAWN.z, 0);

    const drive = input.read(0);
    if (input.wasPressed('KeyM')) {
      audio.toggleMute();
      audioPanel.sync();
    }
    audio.horn(input.isDown('KeyH'));
    const hit = vehicle.consumeImpact();
    if (hit) audio.impact(hit, vehicle.surface);
    audio.update(
      { role, speed: vehicle.speed, throttle: drive.throttle, surface: vehicle.surface, groundedWheels: vehicle.grounded, braking: vehicle.braking },
      frame,
    );

    // Network: poses at 10 Hz while moving, 2 Hz when nearly still, none once parked.
    const horning = input.isDown('KeyH');
    if (horning !== hornSent) {
      hornSent = horning;
      net.sendHorn(horning);
    }
    if (net.status === 'on') {
      stillForMs = Math.abs(vehicle.speed) < 0.4 ? stillForMs + frame * 1000 : 0;
      const delay = nextPoseDelay(vehicle.speed, stillForMs);
      if (forcePose || (delay !== null && now - lastPoseAt >= delay)) {
        const t = vehicle.body.translation();
        const q = vehicle.body.rotation();
        net.sendPose({ x: t.x, y: t.y, z: t.z, qx: q.x, qy: q.y, qz: q.z, qw: q.w, v: vehicle.speed, steer: vehicle.wheelState(0).steer });
        lastPoseAt = now;
        forcePose = false;
      }
    }
    const pose = vehicle.pose(acc / FIXED_DT);
    mesh.update(vehicle, pose, frame);
    chase.update(pose, vehicle.speed, frame);
    stage.followSun(new THREE.Vector3(pose.x, pose.y, pose.z));
    hud.setAudio(!audio.running ? 'locked' : audio.isMuted ? 'muted' : 'on');
    hud.update(vehicle, role, frame, stage.quality());
    grass.update(now / 1000, camera);
    stage.render(frame);
  });
}

void boot();
