"use client";

import { Pause, Play, RotateCcw } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { EasterEggRunStart } from "@/lib/easter-egg/contracts";
import {
  buildObstaclePlan,
  calculateEasterEggScore,
  clearedObstacleCount,
  EASTER_EGG_RULESET,
  runnerSpeedAtTick
} from "@/lib/easter-egg/rules";

type EndlessRunnerGameProps = {
  run: EasterEggRunStart;
  onFinished: (result: { activeTickCount: number; obstacleCount: number; score: number }) => void;
  onRestart: () => void;
};

export default function EndlessRunnerGame({ run, onFinished, onRestart }: EndlessRunnerGameProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const gameRef = useRef<import("phaser").Game | null>(null);
  const sceneRef = useRef<import("phaser").Scene | null>(null);
  const jumpRef = useRef<(() => void) | null>(null);
  const finishedRef = useRef(false);
  const [paused, setPaused] = useState(false);
  const [finished, setFinished] = useState(false);
  const [status, setStatus] = useState("Run started. Jump over the warning signs.");
  const [score, setScore] = useState(0);

  useEffect(() => {
    let disposed = false;
    finishedRef.current = false;

    async function mountGame() {
      const Phaser = await import("phaser");
      if (disposed || !hostRef.current) return;

      class RunnerScene extends Phaser.Scene {
        private runner!: import("phaser").Types.Physics.Arcade.SpriteWithDynamicBody;
        private obstacles!: import("phaser").Physics.Arcade.Group;
        private tick = 0;
        private nextObstacleIndex = 0;
        private obstaclePlan = buildObstaclePlan(run.seed, 216_000);

        constructor() {
          super("runner");
        }

        preload() {
          this.load.svg("runner", "/easter-egg/runner.svg", { width: 54, height: 60 });
          this.load.svg("obstacle", "/easter-egg/obstacle.svg", { width: 36, height: 60 });
        }

        create() {
          this.cameras.main.setBackgroundColor("#07111f");
          const ground = this.add.rectangle(400, 312, 800, 8, 0x22d3ee, 0.7);
          this.physics.add.existing(ground, true);
          this.add.rectangle(400, 337, 800, 50, 0x0f1d2f, 1);
          this.add.text(24, 22, "THE QUARTER NEVER ENDS", {
            color: "#f8fafc",
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
            fontSize: "15px"
          }).setAlpha(0.72);
          this.runner = this.physics.add.sprite(112, 308, "runner").setOrigin(0.5, 1);
          this.runner.setCollideWorldBounds(true);
          this.runner.body.setSize(34, 54).setOffset(10, 5);
          this.obstacles = this.physics.add.group({ allowGravity: false, immovable: true });
          this.physics.add.collider(this.runner, ground);
          this.physics.add.collider(this.runner, this.obstacles, () => this.finishRun());
          this.input.keyboard?.on("keydown-SPACE", this.jump, this);
          this.input.on("pointerdown", this.jump, this);
          jumpRef.current = this.jump.bind(this);
        }

        private jump() {
          if (this.runner.body.blocked.down || this.runner.body.touching.down || this.runner.y >= 308) {
            this.runner.setVelocityY(EASTER_EGG_RULESET.jumpVelocity);
          }
        }

        private finishRun() {
          if (finishedRef.current) return;
          finishedRef.current = true;
          const obstacleCount = clearedObstacleCount(run.seed, this.tick);
          const finalScore = calculateEasterEggScore(this.tick, obstacleCount);
          this.physics.pause();
          this.runner.setTint(0xfb7185);
          setStatus(`Run over. Final score ${finalScore}.`);
          setScore(finalScore);
          setFinished(true);
          onFinished({ activeTickCount: this.tick, obstacleCount, score: finalScore });
        }

        update() {
          if (finishedRef.current) return;
          this.tick += 1;
          const plan = this.obstaclePlan[this.nextObstacleIndex];
          if (plan && plan.spawnTick === this.tick) {
            const obstacle = this.obstacles.create(850, 310, "obstacle") as import("phaser").Types.Physics.Arcade.SpriteWithDynamicBody;
            obstacle.setOrigin(0.5, 1).setDisplaySize(plan.width, plan.height);
            obstacle.body.setSize(plan.width * 0.72, plan.height * 0.86).setOffset(plan.width * 0.14, plan.height * 0.12);
            obstacle.setVelocityX(-runnerSpeedAtTick(this.tick));
            this.nextObstacleIndex += 1;
          }
          for (const child of this.obstacles.getChildren()) {
            const obstacle = child as import("phaser").Types.Physics.Arcade.SpriteWithDynamicBody;
            obstacle.setVelocityX(-runnerSpeedAtTick(this.tick));
            if (obstacle.x < -80) obstacle.destroy();
          }
          const obstacleCount = clearedObstacleCount(run.seed, this.tick);
          const nextScore = calculateEasterEggScore(this.tick, obstacleCount);
          if (this.tick % 6 === 0) setScore(nextScore);
        }
      }

      gameRef.current = new Phaser.Game({
        type: Phaser.AUTO,
        parent: hostRef.current,
        width: 800,
        height: 360,
        transparent: false,
        render: { antialias: true, pixelArt: false },
        scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
        physics: {
          default: "arcade",
          arcade: { gravity: { x: 0, y: EASTER_EGG_RULESET.gravity }, fixedStep: true, fps: EASTER_EGG_RULESET.fixedTicksPerSecond }
        },
        fps: { target: EASTER_EGG_RULESET.fixedTicksPerSecond, forceSetTimeOut: false },
        scene: RunnerScene
      });
      sceneRef.current = gameRef.current.scene.getScene("runner");
    }

    void mountGame();
    return () => {
      disposed = true;
      jumpRef.current = null;
      sceneRef.current = null;
      gameRef.current?.destroy(true);
      gameRef.current = null;
    };
  }, [onFinished, run]);

  const setGamePaused = useCallback((nextPaused: boolean, reason = "") => {
    const scene = sceneRef.current;
    if (!scene || finishedRef.current) return;
    if (nextPaused) {
      scene.scene.pause();
      setStatus(reason || "Run paused.");
    } else {
      scene.scene.resume();
      setStatus("Run resumed.");
    }
    setPaused(nextPaused);
  }, []);

  useEffect(() => {
    function handleVisibility() {
      if (document.hidden) setGamePaused(true, "Run paused while this tab is hidden.");
    }
    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, [setGamePaused]);

  return (
    <div className="space-y-3" aria-busy={!finished && !paused}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-cyan-300">Current score</p>
          <p className="font-mono text-3xl font-bold text-white" aria-live="polite">{score.toLocaleString()}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => setGamePaused(!paused)} disabled={finishedRef.current} className="inline-flex min-h-11 items-center gap-2 rounded-md border border-white/20 px-3 py-2 text-sm font-semibold text-white hover:border-cyan-300 hover:bg-cyan-950/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300 disabled:opacity-40">
            {paused ? <Play className="h-4 w-4" aria-hidden="true" /> : <Pause className="h-4 w-4" aria-hidden="true" />}
            {paused ? "Resume" : "Pause"}
          </button>
          <button type="button" onClick={onRestart} disabled={!finished} className="grid h-11 w-11 place-items-center rounded-md border border-white/20 text-white hover:border-cyan-300 hover:bg-cyan-950/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300 disabled:cursor-not-allowed disabled:opacity-40" aria-label="Restart game" title="Restart">
            <RotateCcw className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      </div>

      <div className="relative aspect-[20/9] w-full overflow-hidden rounded-md border border-cyan-300/25 bg-[#07111f] focus-within:ring-2 focus-within:ring-cyan-300" role="application" aria-label="Vaeroex endless runner game">
        <div ref={hostRef} className="absolute inset-0" />
        <button type="button" className="absolute inset-0 z-10 cursor-pointer bg-transparent text-transparent focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-inset focus-visible:ring-cyan-300 disabled:cursor-default" onClick={() => jumpRef.current?.()} aria-label="Jump. You can also press Space." disabled={paused || finished}>Jump</button>
        {paused ? <div className="pointer-events-none absolute inset-0 z-20 grid place-items-center bg-slate-950/70 text-lg font-semibold text-white">Paused</div> : null}
      </div>
      <p className="text-sm text-slate-300" aria-live="polite">{status}</p>
      <p className="text-xs text-slate-400">Press Space, click the game, or tap to jump. The game pauses when this tab is hidden.</p>
    </div>
  );
}
