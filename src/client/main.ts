import * as THREE from 'three';
import { CARS, CAR_ORDER, cloneSpec, type CarRole, type CarSpec } from '../shared/cars';
import { generateTerrain, SPAWN } from '../shared/terrain';
import { generateBoulders } from '../shared/boulders';
import { createPhysicsWorld, FIXED_DT, initRapier, type PhysicsWorld } from './physics/world';
import { FLIP_RESET_SECONDS, Vehicle } from './physics/vehicle';
import { buildBoulderMesh, buildTerrainMesh } from './render/terrain-mesh';
import { buildGrass } from './render/grass';
import { CarTransformer } from './render/car-transformer';
import { ChaseCam } from './render/chase-cam';
import { OrbitCam } from './render/orbit-cam';
import { BatteryView } from '../shared/battery';
import { RescueController } from './game/rescue';
import { MissionController } from './game/missions';
import { MissionPanel } from './ui/mission-panel';
import { MISSIONS } from '../shared/missions';
import { isRampPose } from '../shared/tether';
import { SignalController } from './game/signal';
import { PerfPanel } from './ui/perf-panel';
import { AutoQualityController } from './game/auto-quality';
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
import { PingController } from './game/pings';
import { buildTerrace } from './render/terrace';
import { Fireworks } from './render/fireworks';
import { GOALS, GOAL_COOLDOWN_MS, goalById, reached } from '../shared/goals';
import { CrawlController } from './game/crawl';
import { ToolsController } from './game/tools';
import { DeadSignalController } from './game/deadsignal';
import { DEAD_CAR } from '../shared/goals';
import { PlacedObjects } from './render/placed-objects';
import { ToolboxBar } from './ui/toolbox-bar';
import { hasLowRange } from '../shared/gear';
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
  const terrace = buildTerrace();
  scene.add(terrace.group);
  const fireworks = new Fireworks(scene);
  let celebrateUntil = 0;

  const chase = new ChaseCam(camera, terrain);
  const orbit = new OrbitCam(camera, terrain, stage.renderer.domElement);
  const autoQ = new AutoQualityController(stage, grass);
  const perf = new PerfPanel(stage, grass, autoQ, params.has('perf'));
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
  let xform: CarTransformer;
  let gravity = 9.81;
  /** The team battery as this player sees it. Only used in a room; alone, nitro uses a personal tank. */
  const battery = new BatteryView();
  const nitroSource = (): { level: number; locked: boolean } | null => {
    if (net.status !== 'on' || !battery.known) return null;
    const b = battery.at(performance.now());
    return { level: b.level, locked: b.locked };
  };

  /** Put a fresh car at a spot, upright and still. Used for the first spawn, resets and teleports. */
  const spawn = (r: CarRole, x: number, z: number, yaw: number): void => {
    if (vehicle) vehicle.dispose();
    const changed = role !== r;
    role = r;
    if (changed) net.sendCar(r);
    vehicle = new Vehicle(pw, specs[r], x, z, yaw);
    vehicle.nitroSource = nitroSource;
    signal?.reset(); // a teleport or reset: forget old inputs
    rescue?.reset();
    if (xform) xform.reset(specs[r]);
    else {
      xform = new CarTransformer(scene, specs[r]);
      xform.onStart = () => audio.transform();
    }
    chase.snap();
    tune?.show(specs[r]);
  };

  /** Change car where you are: same speed, spin and steering, with the transformation animation. */
  const switchCar = (r: CarRole): void => {
    if (r === role) return;
    const v = vehicle.body.linvel();
    vehicle = Vehicle.transformFrom(pw, vehicle, specs[r]);
    role = r;
    net.sendCar(r);
    xform.transformTo(specs[r], { x: v.x, z: v.z });
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

  const hud = new Hud(switchCar);

  // ---- Multiplayer: every browser drives its own car; the room just relays poses.
  const remotes = new Map<string, RemoteCar>();
  const roster = new Map<string, PlayerInfo>();
  let forcePose = false; // re-announce ourselves when someone joins, so parked cars appear
  let lastPoseAt = 0;
  let stillForMs = 0;
  let hornSent = false;
  let nitroSent = false;
  let wasBoosting = false;

  /** Radio range: shared by the whole room, local when playing alone. */
  let signalRule = false;
  const refreshPanel = (): void => {
    const players: PanelPlayer[] = [...roster.values()].map((p) => ({ ...p, self: p.id === net.selfId, rtt: p.id === net.selfId ? net.rttMs : 0 }));
    panel.render({
      status: net.status,
      code: net.code,
      max: 4,
      players,
      lag: net.lagMs,
      signal: signalRule,
      missions: { list: MISSIONS.map((m) => ({ id: m.id, name: m.name, minPlayers: m.minPlayers })), running: missions.running ? missions.info!.id : null },
    });
  };
  const addRemote = (p: PlayerInfo): void => {
    roster.set(p.id, p);
    if (p.id === net.selfId) return;
    const existing = remotes.get(p.id);
    if (existing) existing.setRole(p.role);
    else {
      const rc = new RemoteCar(scene, pw, p);
      rc.onTransform = () => {
        const to = rc.position.clone().sub(camera.position);
        const d = to.length();
        const dir = new THREE.Vector3();
        camera.getWorldDirection(dir);
        const right = new THREE.Vector3().crossVectors(dir, camera.up).normalize();
        audio.transform(1 / (1 + d / 16), d > 0.01 ? to.normalize().dot(right) : 0);
      };
      remotes.set(p.id, rc);
    }
  };
  const net: RoomClient = new RoomClient(
    {
      welcome(id, code, list, props, bat, rules, mission, toolsInfo) {
        tether.onWelcome(props);
        toolsCtl.receive(toolsInfo);
        missions.onWelcome(mission, performance.now());
        applySignalRule(rules?.signal ?? false);
        if (bat) battery.receive(bat, performance.now());
        else battery.reset();
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
        pings.onLeave(id);
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
      nitro(id, on) {
        const rc = remotes.get(id);
        if (!rc) return;
        rc.setNitro(on);
        if (!on) return;
        const to = rc.position.clone().sub(camera.position);
        const d = to.length();
        const dir = new THREE.Vector3();
        camera.getWorldDirection(dir);
        const right = new THREE.Vector3().crossVectors(dir, camera.up).normalize();
        audio.whoosh(0.8 / (1 + d / 14), d > 0.01 ? to.normalize().dot(right) : 0);
      },
      prop(info) {
        tether.onProp(info);
      },
      goal(id, by) {
        celebrate(id, by === net.selfId ? 'You made it up.' : `${roster.get(by)?.name ?? 'A teammate'} made it up.`);
      },
      ping(id, kind, x, z) {
        pings.onRemote(id, kind, x, z, performance.now());
      },
      battery(info) {
        battery.receive(info, performance.now());
      },
      mission(info, event, by, reason) {
        missions.onMessage(info, event, by, reason, performance.now());
        refreshPanel();
      },
      charge(by, ok, x, z, wait, reason) {
        const mine = by === net.selfId;
        if (!ok) {
          if (mine) hud.toast('Cannot charge', wait ? `${reason ?? ''} ${wait} s.` : reason ?? '', 2600);
          return;
        }
        audio.ping('battery', mine ? 0.7 : 0.4, 0);
        const near = deadSignal.onCharge(x, z, missions.running && missions.info?.id === 'deadsignal');
        hud.toast(near ? 'The lost car is waking up' : 'Team battery topped up', `${mine ? 'Your' : (roster.get(by)?.name ?? 'A') + "'s"} Relay charged it`, 2400);
      },
      tools(info, event, by, kind, reason) {
        toolsCtl.receive(info, event, by, kind, reason);
      },
      rules(on, by) {
        applySignalRule(on);
        const who = by === net.selfId ? 'You' : roster.get(by)?.name ?? 'Someone';
        hud.toast(on ? 'Radio range ON' : 'Radio range off', on ? `${who} turned it on. Stay near the base or a Relay truck.` : `${who} turned it off.`, 4200);
      },
      status() {
        if (net.status !== 'on') battery.reset(); // out of the room: back to the personal tank
        if (net.status === 'off') {
          applySignalRule(false);
          missions.onWelcome(null, performance.now());
          toolsCtl.reset();
        }
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
  /** Fireworks, fanfare and a message, for everyone in the room. */
  const celebrate = (id: string, who: string): void => {
    const g = goalById(id);
    if (!g) return;
    if (!g.missionOnly) celebrateUntil = performance.now() + 12000; // the terrace's own glow
    fireworks.launch(new THREE.Vector3(g.x, g.missionOnly ? terrain.heightAt(g.x, g.z) + 1 : g.minY, g.z));
    audio.fanfare();
    hud.toast(`${g.name} reached!`, who);
  };
  const goalFiredAt = new Map<string, number>();
  const tether = new TetherController({ scene, pw, terrain, net: () => net, vehicle: () => vehicle, role: () => role, remotes: () => remotes, audio });
  const signal = new SignalController({ scene, terrain, remotes: () => remotes, role: () => role, selfId: () => (net.status === 'on' ? net.selfId : 'me'), vehicle: () => vehicle, audio, beacons: () => toolsCtl.placed, nameOf: (id) => roster.get(id)?.name ?? 'A teammate' });
  const deadSignal = new DeadSignalController(scene, terrain);
  const rescue = new RescueController({
    vehicle: () => vehicle,
    remotes: () => remotes,
    // A flipped car asks the team for help, once, by itself (only in a room: alone there is no one to ask).
    onFlipped: () => {
      if (net.status === 'on') pings.send('tow', performance.now());
    },
  });
  const missions = new MissionController({
    net: () => net,
    selfId: () => (net.status === 'on' ? net.selfId : 'me'),
    vehicle: () => vehicle,
    flags: {
      // The Terrace: both ends of the plank hooked, then the plank set down as the ramp against the wall.
      // Dead Signal: coverage out to the lost car, and the Relay's charge next to it.
      'far-linked': () => signal.strengthAt(DEAD_CAR.x, DEAD_CAR.z) >= 0.25,
      'car-revived': () => deadSignal.isRevived,
      'plank-held': () => tether.plank.state.holders.every(Boolean),
      'plank-ramp': () => !tether.plank.state.holders[0] && !tether.plank.state.holders[1] && isRampPose(tether.plank.state.pose),
    },
    celebrate: (goalId, who) => celebrate(goalId, who),
    toast: (title, sub, ms) => hud.toast(title, sub, ms),
    nameOf: (id) => roster.get(id)?.name ?? 'A teammate',
    audio,
  });
  const placedObjects = new PlacedObjects(scene, terrain);
  const toolsCtl: ToolsController = new ToolsController({
    net: () => net,
    selfId: () => (net.status === 'on' ? net.selfId : 'me'),
    vehicle: () => vehicle,
    toast: (title, sub, ms) => hud.toast(title, sub, ms),
    nameOf: (id) => roster.get(id)?.name ?? 'A teammate',
    audio,
    onChange: () => placedObjects.sync(toolsCtl.placed),
  });
  const toolbar = new ToolboxBar((slot) => toolsCtl.select(slot), (slot) => String(slot + 4));
  const crawl = new CrawlController({
    scene,
    terrain,
    boulders,
    role: () => role,
    vehicle: () => vehicle,
    mission: () => ({ active: missions.running && missions.info?.id === 'rockcrawl', stage: missions.info?.stage ?? 0 }),
    toast: (title, sub, ms) => hud.toast(title, sub, ms),
    onLost: () => missions.reportReset(),
  });
  const missionPanel = new MissionPanel();
  const applySignalRule = (on: boolean): void => {
    signalRule = on;
    signal.setEnabled(on);
    refreshPanel();
  };
  const pings = new PingController({
    scene,
    camera,
    terrain,
    net: () => net,
    selfId: () => (net.status === 'on' ? net.selfId : 'me'),
    vehicle: () => vehicle,
    remotes: () => remotes,
    nameOf: (id) => roster.get(id)?.name ?? 'Player',
    audio,
    isDown: (c) => input.isDown(c),
    wasPressed: (c) => input.wasPressed(c),
  });
  const panel: CoopPanel = new CoopPanel({
    async start() {
      try {
        net.connect(await net.create());
      } catch {
        panel.render({ status: 'failed', code: '', max: 4, players: [] });
      }
    },
    startMission(id) {
      missions.start(id);
    },
    abortMission() {
      missions.abort();
    },
    setSignal(on) {
      if (net.status === 'on') net.sendRules(on); // the room tells everyone, us included
      else applySignalRule(on);
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
    switchCar,
    get xform() { return xform; },
    audio,
    get net() { return net; },
    celebrate,
    remotes,
    get tether() { return tether; },
    pings,
    camera,
    stage,
    grass,
    autoQ,
    battery,
    signal,
    rescue,
    missions,
    crawl,
    deadSignal,
    tools: toolsCtl,
    placedObjects,
    scene,
    boulders,
    get orbit() { return orbit; },
    spawn,
  };

  let last = performance.now();
  let acc = 0;
  stage.renderer.setAnimationLoop((now) => {
    const rawDt = (now - last) / 1000;
    const frame = Math.min(0.1, rawDt);
    last = now;
    acc += frame;
    const cpuStart = performance.now();

    CAR_ORDER.forEach((r, i) => {
      if (input.wasPressed(`Digit${i + 1}`)) switchCar(r);
    });
    if (params.has('debug') && input.wasPressed('KeyK')) vehicle.debugFlip();
    if (input.wasPressed('KeyR')) {
      if (vehicle.flippedFor >= FLIP_RESET_SECONDS || params.has('debug') || params.has('tune')) {
        vehicle.resetUpright();
        missions.reportReset();
      }
    }

    // Other players' cars first, so their solid stand-ins and hitches are current for this frame.
    for (const r of remotes.values()) r.update(performance.now(), frame);
    if (input.wasPressed('KeyV')) {
      if (orbit.active) {
        orbit.leave();
        chase.snap();
        hud.toast('Chase camera', 'V for the orbit camera', 1800);
      } else {
        orbit.enter(chase.heading, chase.distance, chase.height);
        hud.toast('Orbit camera', 'Drag to look around, wheel to zoom, V to go back', 3200);
      }
    }
    if (input.wasPressed('KeyG')) {
      if (!hasLowRange(role)) hud.toast('No low range', 'The Hauler and the Relay have it. Press 2 or 3.', 2200);
      else hud.toast(vehicle.toggleGear() === 'low' ? 'Low range' : 'High range', vehicle.gear === 'low' ? 'Slow and strong: for picking your way through rocks' : 'Full speed', 1600);
    }
    for (let i = 0; i < 6; i++) if (input.wasPressed(`Digit${i + 4}`)) toolsCtl.select(i);
    if (input.wasPressed('KeyB')) {
      if (net.status !== 'on') hud.toast('Charging needs a team', 'Join a room: the Relay tops up the team battery.', 2400);
      else if (role !== 'relay') hud.toast('Only the Relay can charge', 'Press 3 for the Relay truck.', 2400);
      else net.sendCharge();
    }
    if (input.wasPressed('KeyE')) toolsCtl.drop();
    if (input.wasPressed('KeyX')) toolsCtl.pickUp();
    if (input.wasPressed('KeyF')) tether.toggle();
    if (input.wasPressed('KeyT')) tether.requestReset();
    const rope = tether.update();
    pings.update(performance.now(), frame);
    signal.update(frame);
    rescue.update(frame);
    missions.update(performance.now());
    crawl.update(frame);
    missionPanel.update(missions.view(performance.now()), performance.now(), missions.completedAt);
    hud.rescueText = rescue.text;
    hud.setSignal(signal.enabled ? { strength: signal.strength, quality: signal.quality, lag: signal.lag } : null);
    // Reached a goal? Online the room announces it to everyone; alone we celebrate straight away.
    const here = vehicle.body.translation();
    for (const g of missions.running ? [] : GOALS.filter((x) => !x.missionOnly)) {
      if (!reached(g, here.x, here.y, here.z) || performance.now() - (goalFiredAt.get(g.id) ?? -1e9) < GOAL_COOLDOWN_MS) continue;
      goalFiredAt.set(g.id, performance.now());
      if (net.status === 'on') net.sendGoal(g.id);
      else celebrate(g.id, 'You made it up.');
    }
    terrace.update(now / 1000, Math.max(0, Math.min(1, (celebrateUntil - performance.now()) / 2000)));
    fireworks.update(frame);
    hud.setPrompt(tether.prompt ?? crawl.warn ?? toolsCtl.prompt());
    deadSignal.update(missions.info?.id === 'deadsignal', missions.info?.id === 'deadsignal' && missions.info.status === 'complete', frame);
    hud.setTeamLinks(signal.team());
    toolbar.update(toolsCtl.tools.slots, toolsCtl.selected);
    placedObjects.update(frame);
    hud.setGear(hasLowRange(role) ? (vehicle.gear === 'low' ? 'LOW RANGE (G)' : 'HIGH RANGE (G for low)') : null, vehicle.gear === 'low');

    if (input.jumpPressed() && !signal.cutOff) vehicle.requestJump();
    let steps = 0;
    while (acc >= FIXED_DT && steps < 5) {
      vehicle.pushPlanar(rope.x, rope.z, FIXED_DT);
      rescue.step(FIXED_DT);
      vehicle.step(signal.filter(input.read(FIXED_DT), FIXED_DT, vehicle.forwardSpeed()), FIXED_DT);
      pw.world.step();
      vehicle.afterPhysics();
      const hard = tether.constrain(FIXED_DT);
      vehicle.changeVelocity(hard.x, hard.z);
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
    if (vehicle.consumeHop()) audio.jump();
    const hit = vehicle.consumeImpact();
    if (hit) audio.impact(hit, vehicle.surface);
    audio.update(
      { role, speed: vehicle.speed, throttle: drive.throttle, surface: vehicle.surface, groundedWheels: vehicle.grounded, braking: vehicle.braking, boost: vehicle.nitro.active ? vehicle.nitro.blend : 0 },
      frame,
    );

    // Network: poses at 10 Hz while moving, 2 Hz when nearly still, none once parked.
    const boosting = vehicle.nitro.active;
    if (boosting && !wasBoosting) audio.whoosh();
    wasBoosting = boosting;
    if (boosting !== nitroSent) {
      nitroSent = boosting;
      net.sendNitro(boosting);
      battery.selfBoost(boosting, performance.now()); // our own boost shows at once; the room's snapshot confirms it
    }
    hud.setTeamBattery(net.status === 'on' && battery.known ? battery.at(performance.now()).boosters : null);
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
    xform.update(vehicle, pose, frame);
    const boostNow = vehicle.nitro.active ? vehicle.nitro.blend : 0;
    if (orbit.active) orbit.update(pose, frame, boostNow, input.look());
    else chase.update(pose, vehicle.speed, frame, boostNow);
    stage.followSun(new THREE.Vector3(pose.x, pose.y, pose.z));
    hud.setAudio(!audio.running ? 'locked' : audio.isMuted ? 'muted' : 'on');
    hud.update(vehicle, role, frame, stage.quality());
    grass.update(now / 1000, camera);
    const submitStart = performance.now();
    stage.renderer.info.reset();
    stage.render(frame);
    perf.frame(frame, submitStart - cpuStart, performance.now() - submitStart);
    autoQ.frame(rawDt);
  });
}

void boot();
