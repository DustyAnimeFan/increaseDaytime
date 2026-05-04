import { world, system } from "@minecraft/server";

// === CUSTOM SETTINGS ===
const DAY_MULTIPLIER = 3;             // higher = longer day (slower time progression)
const ENABLE_AUTO_ENFORCER = true;     // keep vanilla doDayLightCycle off
const DEBUG_MODE = false;

// === INTERNAL CONSTANTS ===
const DAY_TICKS = 24000;
const NIGHT_START_TICK = 12542;        // your chosen boundary for "day" vs "night"
const SLEEP_FADE_TICKS = 100;          // 5 seconds @ 20 tps
const SLEEP_COOLDOWN_TICKS = 40;       // prevent rapid re-trigger loops
const ENFORCER_PERIOD_TICKS = 40;      // how often we re-assert gamerule

// tolerate brief Bedrock sleep-state jitter while fading
const INTERRUPT_GRACE_TICKS = 2;       // cancel only if threshold is lost for > this many consecutive ticks

// Cache overworld dimension
const overworld = world.getDimension("overworld");

function debugLog(msg) {
  if (DEBUG_MODE) world.sendMessage(msg);
}

function isDayTime(t) {
  return t >= 0 && t < NIGHT_START_TICK;
}

// === STATE ===
let dayAccumulator = 0;
let sleepCooldown = 0;

let lastPhaseIsDay = undefined;
let statusLogTimer = 0;
let enforcerTimer = 0;

// Sleep latch state
let sleepLatched = false;
let sleepLatchTimer = -1;
let sleepCommandSource = undefined;

// consecutive ticks threshold has been lost while latched
let lostThresholdTicks = 0;

function enforceDaylightCycleOff() {
  if (!ENABLE_AUTO_ENFORCER) return;

  try {
    if (world.gameRules.doDayLightCycle) {
      world.gameRules.doDayLightCycle = false;
      debugLog("[TimeManager] Auto-Enforcer: Disabled vanilla doDayLightCycle.");
    }
  } catch {
    // ignore permission/restricted-execution issues
  }
}

system.runInterval(() => {
  // ==========================================
  // 0) AUTO-ENFORCER (throttled)
  // ==========================================
  if (enforcerTimer-- <= 0) {
    enforcerTimer = ENFORCER_PERIOD_TICKS;
    enforceDaylightCycleOff();
  }

  // ==========================================
  // 1) READ TIME + PHASE
  // ==========================================
  const currentTime = world.getTimeOfDay();
  const phaseIsDay = isDayTime(currentTime);

  if (lastPhaseIsDay === undefined || lastPhaseIsDay !== phaseIsDay) {
    debugLog(
      `[TimeManager] ${phaseIsDay ? "SUNRISE" : "SUNSET"}. ` +
      `Mode: ${phaseIsDay ? `Slow-Motion (${DAY_MULTIPLIER}x)` : "Vanilla Speed"}`
    );
    lastPhaseIsDay = phaseIsDay;
    dayAccumulator = 0;
  }

  // ==========================================
  // 2) SLEEP MANAGER (latched + jitter fix + INTERRUPT SUPPORT)
  // ==========================================
  if (sleepCooldown > 0) sleepCooldown--;

  const players = overworld.getPlayers();
  let sleepingPlayers = 0;
  let anySleepingPlayer = undefined;

  for (const p of players) {
    let sleeping = false;
    try {
      sleeping = p.isSleeping;
    } catch {
      sleeping = false;
    }

    if (sleeping) {
      sleepingPlayers++;
      if (!anySleepingPlayer) anySleepingPlayer = p;
    }
  }

  let requiredPercentage = 100;
  try {
    requiredPercentage = world.gameRules.playersSleepingPercentage;
  } catch {
    requiredPercentage = 100;
  }

  const sleepPercent = players.length > 0 ? (sleepingPlayers / players.length) * 100 : 0;

  const thresholdCurrentlyMet =
    sleepCooldown === 0 &&
    players.length > 0 &&
    sleepingPlayers > 0 &&
    sleepPercent >= requiredPercentage;

  // Latch sleep once threshold is met (starts fade)
  if (!sleepLatched && thresholdCurrentlyMet) {
    sleepLatched = true;
    sleepLatchTimer = SLEEP_FADE_TICKS;
    sleepCommandSource = anySleepingPlayer;
    lostThresholdTicks = 0; // reset jitter counter on latch
    debugLog("[TimeManager] Threshold met! Latching sleep and starting 5-second fade...");
  }

  // --- INTERRUPT SUPPORT (vanilla-like, with tiny jitter grace) ---
  // While fade is running, keep checking if threshold is still met.
  // If players wake up (e.g., monsters hit them), cancel the latch.
  if (sleepLatched && sleepLatchTimer > 0) {
    // tolerate short threshold flicker
    if (!thresholdCurrentlyMet) lostThresholdTicks++;
    else lostThresholdTicks = 0;

    if (lostThresholdTicks > INTERRUPT_GRACE_TICKS) {
      debugLog("[TimeManager] Sleep interrupted (threshold lost). Canceling fade.");
      sleepLatched = false;
      sleepLatchTimer = -1;
      sleepCommandSource = undefined;
      sleepCooldown = SLEEP_COOLDOWN_TICKS; // prevents instant re-latch spam
      lostThresholdTicks = 0;
      // Do NOT return here; time engine continues normally if interrupted.
    } else {
      // Jitter fix: while fade is running, pause time engine
      sleepLatchTimer--;
      return;
    }
  }

  // Fade finished -> perform skip to next dawn (tick 0)
  if (sleepLatched && sleepLatchTimer === 0) {
    // apply same jitter grace check at completion tick
    if (!thresholdCurrentlyMet) lostThresholdTicks++;
    else lostThresholdTicks = 0;

    // Final safety check: if threshold dropped and stayed dropped, cancel.
    if (!thresholdCurrentlyMet && lostThresholdTicks > INTERRUPT_GRACE_TICKS) {
      debugLog("[TimeManager] Sleep interrupted at completion (threshold lost). Canceling.");
      sleepLatched = false;
      sleepLatchTimer = -1;
      sleepCommandSource = undefined;
      sleepCooldown = SLEEP_COOLDOWN_TICKS;
      lostThresholdTicks = 0;
    } else {
      const currentAbsolute = world.getAbsoluteTime();
      const nextDawnAbsolute = Math.ceil(currentAbsolute / DAY_TICKS) * DAY_TICKS;
      
      debugLog(`[TimeManager] Sleep complete. Advancing ${nextDawnAbsolute - currentAbsolute} ticks to DAWN (tick 0).`);

      world.setAbsoluteTime(nextDawnAbsolute);

      // Vanilla-like: ALWAYS clear weather after sleep (1-tick delayed).
      system.runTimeout(() => {
        try {
          if (sleepCommandSource && sleepCommandSource.isValid()) {
            sleepCommandSource.runCommand("weather clear");
          } else {
            overworld.runCommand("weather clear");
          }
        } catch (e) {
          debugLog(`[TimeManager] Weather clear failed: ${e}`);
        }
      }, 1);

      // Reset internal state
      dayAccumulator = 0;
      sleepCooldown = SLEEP_COOLDOWN_TICKS;
      sleepLatched = false;
      sleepLatchTimer = -1;
      sleepCommandSource = undefined;
      lostThresholdTicks = 0;

      // Explicit sunrise log (so you always get a "sunrise" after sleeping)
      debugLog(`[TimeManager] SUNRISE (after sleep). Mode: Slow-Motion (${DAY_MULTIPLIER}x)`);

      // After jumping to dawn, we are in day phase.
      // Keeping this avoids re-triggering the phase transition logger on the next tick.
      lastPhaseIsDay = true;
      return;
    }
  }

  // ==========================================
  // 3) DAY/NIGHT TIME ENGINE
  // ==========================================
  const nextTime = (currentTime + 1) % DAY_TICKS;

  if (phaseIsDay) {
    dayAccumulator++;
    if (dayAccumulator >= DAY_MULTIPLIER) {
      world.setTimeOfDay(nextTime);
      dayAccumulator = 0;
    }
  } else {
    world.setTimeOfDay(nextTime);
  }

  // ==========================================
  // 4) HEARTBEAT STATUS LOGGER
  // ==========================================
  statusLogTimer++;
  if (DEBUG_MODE && statusLogTimer >= 1200) {
    statusLogTimer = 0;

    let dayCycle = "err";
    try { dayCycle = String(world.gameRules.doDayLightCycle); } catch {}

    debugLog(
      `[STATUS] Time: ${currentTime} | Phase: ${phaseIsDay ? "DAY" : "NIGHT"} | ` +
      `Ticks: ${dayAccumulator}/${DAY_MULTIPLIER} | ` +
      `SleepCooldown: ${sleepCooldown} | SleepLatched: ${sleepLatched} | doDayLightCycle: ${dayCycle}`
    );
  }
}, 1);
