"use client";

import { Pause, Play, RotateCcw } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { EasterEggRunStart, EasterEggRunSubmission } from "@/lib/easter-egg/contracts";
import {
  buildCourseObjects,
  calculateEasterEggScore,
  difficultyTierAtTick,
  EASTER_EGG_RULESET,
  expectedRunProgress,
  runnerSpeedAtTick
} from "@/lib/easter-egg/rules";
import type { EasterEggCourseObjectPlan, EasterEggDifficultyTierId } from "@/lib/easter-egg/rules";

type EndlessRunnerGameProps = {
  run: EasterEggRunStart;
  onFinished: (result: Omit<EasterEggRunSubmission, "runId">) => void;
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
  const [difficulty, setDifficulty] = useState(difficultyTierAtTick(0));

  useEffect(() => {
    let disposed = false;
    finishedRef.current = false;

    async function mountGame() {
      const Phaser = await import("phaser");
      if (disposed || !hostRef.current) return;

      class RunnerScene extends Phaser.Scene {
        private runner!: import("phaser").Types.Physics.Arcade.SpriteWithDynamicBody;
        private hazards!: import("phaser").Physics.Arcade.Group;
        private platforms!: import("phaser").Physics.Arcade.Group;
        private worldObjects: Array<{
          plan: EasterEggCourseObjectPlan;
          bodyObject: import("phaser").GameObjects.Rectangle;
          visual: import("phaser").GameObjects.Container;
        }> = [];
        private tick = 0;
        private nextObjectIndex = 0;
        private courseObjects = buildCourseObjects(run.seed, 216_000);
        private hazardClearTicks = this.courseObjects.filter((object) => object.kind === "hazard").map((object) => object.clearTick).sort((left, right) => left - right);
        private platformClearTicks = this.courseObjects.filter((object) => object.kind === "platform").map((object) => object.clearTick).sort((left, right) => left - right);
        private clearedHazards = 0;
        private clearedPlatforms = 0;
        private currentTier: EasterEggDifficultyTierId = 1;

        constructor() {
          super("runner");
        }

        preload() {
          this.load.svg("runner", "/easter-egg/runner.svg", { width: 54, height: 60 });
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
          this.hazards = this.physics.add.group({ allowGravity: false, immovable: true });
          this.platforms = this.physics.add.group({ allowGravity: false, immovable: true });
          this.physics.add.collider(this.runner, ground);
          this.physics.add.collider(this.runner, this.hazards, () => this.finishRun());
          this.physics.add.collider(
            this.runner,
            this.platforms,
            undefined,
            (runnerObject, platformObject) => {
              const runnerBody = (runnerObject as { body?: import("phaser").Physics.Arcade.Body }).body
                || runnerObject as import("phaser").Physics.Arcade.Body;
              const platformBody = (platformObject as { body?: import("phaser").Physics.Arcade.Body }).body
                || platformObject as import("phaser").Physics.Arcade.Body;
              const landingTolerance = Math.max(10, Math.abs(runnerBody.velocity.y) / EASTER_EGG_RULESET.fixedTicksPerSecond + 4);
              return runnerBody.velocity.y >= 0 && runnerBody.bottom <= platformBody.top + landingTolerance;
            }
          );
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
          const progress = expectedRunProgress(run.seed, this.tick);
          const finalScore = calculateEasterEggScore(this.tick, progress.hazardCount);
          this.physics.pause();
          this.runner.setTint(0xfb7185);
          setStatus(`Run over. Final score ${finalScore}.`);
          setScore(finalScore);
          setFinished(true);
          onFinished({ activeTickCount: this.tick, ...progress, score: finalScore });
        }

        private addHazardText(
          container: import("phaser").GameObjects.Container,
          x: number,
          y: number,
          value: string,
          size = 7
        ) {
          const text = this.add.text(x, y, value, {
            color: "#fff7ed",
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
            fontSize: `${size}px`,
            fontStyle: "bold",
            align: "center"
          }).setOrigin(0.5);
          container.add(text);
        }

        private createHazardVisual(plan: EasterEggCourseObjectPlan, x: number) {
          const centerY = plan.bottomY - plan.visualHeight / 2;
          const container = this.add.container(x, centerY);
          const graphics = this.add.graphics();
          const left = -plan.visualWidth / 2;
          const top = -plan.visualHeight / 2;
          const right = plan.visualWidth / 2;
          const bottom = plan.visualHeight / 2;
          const danger = 0xfb7185;
          const light = 0xfff7ed;
          const dark = 0x190b18;
          const panel = plan.fill;

          graphics.lineStyle(2, danger, 1);
          switch (plan.visualKind) {
            case "email-inbox":
              graphics.fillStyle(panel, 1).fillRoundedRect(left + 2, top + 8, plan.visualWidth - 4, plan.visualHeight - 10, 4);
              graphics.strokeRoundedRect(left + 2, top + 8, plan.visualWidth - 4, plan.visualHeight - 10, 4);
              graphics.lineBetween(left + 5, top + 11, 0, top + 20).lineBetween(0, top + 20, right - 5, top + 11);
              graphics.fillStyle(danger, 1).fillCircle(right - 6, top + 6, 6);
              this.addHazardText(container, right - 6, top + 6, "!", 8);
              break;
            case "spreadsheet":
              graphics.fillStyle(0x052e2b, 1).fillRoundedRect(left + 1, top + 1, plan.visualWidth - 2, plan.visualHeight - 2, 3);
              graphics.strokeRoundedRect(left + 1, top + 1, plan.visualWidth - 2, plan.visualHeight - 2, 3);
              graphics.lineStyle(1, 0x5eead4, 0.75);
              for (let row = 1; row < 4; row += 1) graphics.lineBetween(left + 4, top + 4 + row * 6, right - 4, top + 4 + row * 6);
              for (let column = 1; column < 3; column += 1) graphics.lineBetween(left + 4 + column * 12, top + 4, left + 4 + column * 12, bottom - 4);
              graphics.fillStyle(danger, 0.9).fillRect(left + 17, top + 10, 12, 6);
              this.addHazardText(container, 4, 1, "#REF!", 6);
              break;
            case "printer":
              graphics.fillStyle(0x334155, 1).fillRoundedRect(left + 3, top + 14, plan.visualWidth - 6, 24, 4);
              graphics.strokeRoundedRect(left + 3, top + 14, plan.visualWidth - 6, 24, 4);
              graphics.fillStyle(light, 1).fillRect(left + 10, top + 1, plan.visualWidth - 20, 19);
              graphics.lineStyle(1, 0x64748b, 1).lineBetween(left + 13, top + 7, right - 13, top + 7).lineBetween(left + 13, top + 11, right - 10, top + 11);
              graphics.fillStyle(danger, 1).fillCircle(right - 9, top + 25, 3);
              graphics.fillStyle(0x0f172a, 1).fillRect(left + 10, bottom - 8, plan.visualWidth - 20, 8);
              this.addHazardText(container, 0, bottom - 4, "JAM", 6);
              break;
            case "coffee":
              graphics.fillStyle(0x78350f, 1).fillRoundedRect(left + 3, top + 6, plan.visualWidth - 13, plan.visualHeight - 8, 4);
              graphics.strokeRoundedRect(left + 3, top + 6, plan.visualWidth - 13, plan.visualHeight - 8, 4);
              graphics.lineStyle(3, danger, 1).strokeCircle(right - 8, top + 15, 7);
              graphics.fillStyle(0xfbbf24, 0.65).fillEllipse(left + 5, bottom - 3, 23, 5);
              graphics.lineStyle(1, light, 0.8).lineBetween(left + 7, top + 3, left + 10, top - 2).lineBetween(left + 15, top + 3, left + 18, top - 2);
              break;
            case "kpi-chart":
              graphics.fillStyle(0x172554, 1).fillRoundedRect(left + 2, top + 2, plan.visualWidth - 4, plan.visualHeight - 4, 4);
              graphics.strokeRoundedRect(left + 2, top + 2, plan.visualWidth - 4, plan.visualHeight - 4, 4);
              graphics.lineStyle(1, 0x64748b, 0.8).lineBetween(left + 9, bottom - 12, right - 7, bottom - 12).lineBetween(left + 9, top + 11, left + 9, bottom - 12);
              graphics.lineStyle(4, danger, 1).beginPath().moveTo(left + 12, top + 18).lineTo(-2, 0).lineTo(right - 10, bottom - 19).strokePath();
              graphics.fillStyle(danger, 1).fillTriangle(right - 15, bottom - 20, right - 6, bottom - 14, right - 7, bottom - 25);
              this.addHazardText(container, 0, top + 8, "KPI", 7);
              break;
            case "meeting-calendar":
              graphics.fillStyle(0x431407, 1).fillRoundedRect(left + 2, top + 4, plan.visualWidth - 4, plan.visualHeight - 6, 4);
              graphics.strokeRoundedRect(left + 2, top + 4, plan.visualWidth - 4, plan.visualHeight - 6, 4);
              graphics.fillStyle(danger, 1).fillRect(left + 3, top + 5, plan.visualWidth - 6, 9);
              graphics.lineStyle(3, light, 1).lineBetween(left + 15, top, left + 15, top + 9).lineBetween(right - 15, top, right - 15, top + 9);
              this.addHazardText(container, 0, 7, "MEETING", 7);
              break;
            case "receipts":
              graphics.fillStyle(0xfef3c7, 1).fillRect(left + 10, top + 1, plan.visualWidth - 17, plan.visualHeight - 4);
              graphics.fillStyle(0xfffbeb, 1).fillRect(left + 4, top + 7, plan.visualWidth - 17, plan.visualHeight - 10);
              graphics.lineStyle(2, danger, 1).strokeRect(left + 4, top + 7, plan.visualWidth - 17, plan.visualHeight - 10);
              graphics.lineStyle(1, 0x92400e, 0.8);
              for (let row = 0; row < 4; row += 1) graphics.lineBetween(left + 10, top + 15 + row * 6, right - 18, top + 15 + row * 6);
              this.addHazardText(container, -2, bottom - 6, "$$", 7);
              break;
            case "compliance-warning":
              graphics.fillStyle(0xf59e0b, 1).fillTriangle(0, top + 2, left + 2, bottom - 2, right - 2, bottom - 2);
              graphics.lineStyle(3, danger, 1).strokeTriangle(0, top + 2, left + 2, bottom - 2, right - 2, bottom - 2);
              graphics.fillStyle(dark, 1).fillRect(-2, top + 25, 4, 24).fillCircle(0, bottom - 15, 3);
              this.addHazardText(container, 0, bottom - 7, "POLICY", 6);
              break;
            case "deadline-folder":
              graphics.fillStyle(0x4c0519, 1).fillRoundedRect(left + 2, top + 18, plan.visualWidth - 4, plan.visualHeight - 20, 4);
              graphics.fillStyle(0x9f1239, 1).fillRect(left + 7, top + 8, 27, 16);
              graphics.lineStyle(3, danger, 1).strokeRoundedRect(left + 2, top + 18, plan.visualWidth - 4, plan.visualHeight - 20, 4);
              graphics.lineStyle(2, light, 0.7).strokeRect(left + 9, top + 38, plan.visualWidth - 18, 30);
              this.addHazardText(container, 0, top + 53, "EOD", 13);
              this.addHazardText(container, 0, bottom - 15, "DUE", 7);
              break;
            case "quick-call":
              graphics.fillStyle(0x3b0764, 1).fillRoundedRect(left + 2, top + 2, plan.visualWidth - 4, plan.visualHeight - 11, 8);
              graphics.strokeRoundedRect(left + 2, top + 2, plan.visualWidth - 4, plan.visualHeight - 11, 8);
              graphics.fillTriangle(left + 15, bottom - 11, left + 8, bottom - 1, left + 27, bottom - 10);
              this.addHazardText(container, 2, -3, "QUICK CALL?", 7);
              break;
            case "loading-spinner":
              graphics.fillStyle(0x1e1b4b, 1).fillRoundedRect(left + 2, top + 3, plan.visualWidth - 4, plan.visualHeight - 6, 8);
              graphics.strokeRoundedRect(left + 2, top + 3, plan.visualWidth - 4, plan.visualHeight - 6, 8);
              for (let index = 0; index < 8; index += 1) {
                const angle = (Math.PI * 2 * index) / 8;
                graphics.fillStyle(index < 3 ? danger : 0x818cf8, index < 3 ? 1 : 0.45).fillCircle(left + 15 + Math.cos(angle) * 8, Math.sin(angle) * 8, 2);
              }
              this.addHazardText(container, 14, 0, "LOADING", 6);
              break;
            case "sticky-note":
              graphics.fillStyle(0xfacc15, 1).fillRect(left + 3, top + 2, plan.visualWidth - 6, plan.visualHeight - 5);
              graphics.lineStyle(2, danger, 1).strokeRect(left + 3, top + 2, plan.visualWidth - 6, plan.visualHeight - 5);
              graphics.fillStyle(0xfef08a, 1).fillTriangle(right - 13, top + 2, right - 3, top + 2, right - 3, top + 12);
              this.addHazardText(container, 0, -4, "CIRCLE", 7);
              this.addHazardText(container, 0, 6, "BACK", 7);
              break;
            case "laptop-update":
              graphics.fillStyle(0x172554, 1).fillRoundedRect(left + 7, top + 1, plan.visualWidth - 14, plan.visualHeight - 12, 4);
              graphics.lineStyle(3, danger, 1).strokeRoundedRect(left + 7, top + 1, plan.visualWidth - 14, plan.visualHeight - 12, 4);
              graphics.fillStyle(0x1e293b, 1).fillTriangle(left + 1, bottom - 4, right - 1, bottom - 4, right - 9, bottom - 12);
              graphics.lineStyle(2, 0x67e8f9, 1).strokeCircle(0, top + 14, 7).lineBetween(4, top + 9, 8, top + 9).lineBetween(8, top + 9, 8, top + 13);
              this.addHazardText(container, 0, 9, "UPDATE", 6);
              break;
            case "notification-tower":
              for (let index = 0; index < 5; index += 1) {
                const y = bottom - 15 - index * 20;
                graphics.fillStyle(index % 2 === 0 ? 0x4c0519 : 0x172554, 1).fillRoundedRect(left + 3 + (index % 2) * 3, y - 9, plan.visualWidth - 9, 18, 4);
                graphics.lineStyle(2, danger, 1).strokeRoundedRect(left + 3 + (index % 2) * 3, y - 9, plan.visualWidth - 9, 18, 4);
                graphics.fillStyle(danger, 1).fillCircle(right - 7, y - 6, 5);
              }
              this.addHazardText(container, right - 7, top + 7, "99+", 6);
              break;
          }
          container.addAt(graphics, 0);
          return container;
        }

        private createPlatformVisual(plan: EasterEggCourseObjectPlan, x: number, centerY: number) {
          const container = this.add.container(x, centerY);
          const graphics = this.add.graphics();
          graphics.fillStyle(0x0e7490, 1).fillRoundedRect(-plan.visualWidth / 2, -plan.visualHeight / 2, plan.visualWidth, plan.visualHeight, 4);
          graphics.lineStyle(3, 0x67e8f9, 1).strokeRoundedRect(-plan.visualWidth / 2, -plan.visualHeight / 2, plan.visualWidth, plan.visualHeight, 4);
          graphics.lineStyle(2, 0xa5f3fc, 0.8);
          for (let xOffset = -plan.visualWidth / 2 + 16; xOffset < plan.visualWidth / 2 - 12; xOffset += 32) {
            graphics.lineBetween(xOffset, 3, xOffset + 6, -3).lineBetween(xOffset + 6, -3, xOffset + 12, 3);
          }
          container.add(graphics);
          const label = this.add.text(0, 0, "SAFE STEP", {
            color: "#cffafe",
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
            fontSize: "8px",
            fontStyle: "bold"
          }).setOrigin(0.5);
          container.add(label);
          return container;
        }

        private spawnObject(plan: EasterEggCourseObjectPlan) {
          const centerY = plan.kind === "platform" ? plan.topY + plan.height / 2 : plan.bottomY - plan.height / 2;
          const spawnX = EASTER_EGG_RULESET.spawnX + plan.xOffset;
          const bodyObject = this.add.rectangle(
            spawnX,
            centerY,
            plan.width,
            plan.height,
            plan.kind === "platform" ? plan.fill : 0xffffff,
            plan.kind === "platform" ? 0.92 : 0.001
          );
          this.physics.add.existing(bodyObject);
          const body = bodyObject.body as import("phaser").Physics.Arcade.Body;
          body.setAllowGravity(false);
          body.setImmovable(true);
          body.setSize(plan.width, plan.height, true);
          if (plan.kind === "platform") {
            body.checkCollision.down = false;
            body.checkCollision.left = false;
            body.checkCollision.right = false;
            body.checkCollision.up = true;
            this.platforms.add(bodyObject);
          } else {
            this.hazards.add(bodyObject);
          }
          const visual = plan.kind === "platform"
            ? this.createPlatformVisual(plan, spawnX, centerY)
            : this.createHazardVisual(plan, spawnX);
          this.worldObjects.push({ plan, bodyObject, visual });
        }

        update() {
          if (finishedRef.current) return;
          this.tick += 1;
          while (this.courseObjects[this.nextObjectIndex]?.spawnTick === this.tick) {
            this.spawnObject(this.courseObjects[this.nextObjectIndex]);
            this.nextObjectIndex += 1;
          }

          const speed = runnerSpeedAtTick(this.tick);
          for (let index = this.worldObjects.length - 1; index >= 0; index -= 1) {
            const object = this.worldObjects[index];
            const body = object.bodyObject.body as import("phaser").Physics.Arcade.Body;
            body.setVelocityX(-speed);
            object.visual.x = object.bodyObject.x;
            if (object.bodyObject.x < -140) {
              object.visual.destroy();
              object.bodyObject.destroy();
              this.worldObjects.splice(index, 1);
            }
          }

          const tier = difficultyTierAtTick(this.tick);
          if (tier.id !== this.currentTier) {
            this.currentTier = tier.id;
            setDifficulty(tier);
            setStatus(`${tier.label}. The calendar has discovered ambition.`);
          }
          while (this.hazardClearTicks[this.clearedHazards] <= this.tick) this.clearedHazards += 1;
          while (this.platformClearTicks[this.clearedPlatforms] <= this.tick) this.clearedPlatforms += 1;
          const nextScore = calculateEasterEggScore(this.tick, this.clearedHazards);
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
        <div className="min-w-32 text-left sm:text-right">
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">Difficulty</p>
          <p className="mt-1 text-sm font-semibold text-amber-200" aria-live="polite">{difficulty.label}</p>
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
      <p className="text-xs text-slate-400">Press Space, click the game, or tap to jump. Land on cyan SAFE STEP platforms and avoid red-edged workplace hazards. The game pauses when this tab is hidden.</p>
    </div>
  );
}
