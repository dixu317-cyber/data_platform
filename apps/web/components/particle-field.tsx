"use client";

import { useEffect, useRef } from "react";
import { useTheme } from "./theme-provider";

type P = { x: number; y: number; vx: number; vy: number; r: number; a: number };

export function ParticleField() {
  const ref = useRef<HTMLCanvasElement>(null);
  const { theme } = useTheme();

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    let w = 0;
    let h = 0;
    let dpr = Math.min(window.devicePixelRatio || 1, 2);
    let particles: P[] = [];
    let raf = 0;
    const mouse = { x: -9999, y: -9999 };

    const readColors = () => {
      const cs = getComputedStyle(document.documentElement);
      const rgb = cs.getPropertyValue("--particle").trim() || "181,114,42";
      return rgb;
    };
    let rgb = readColors();

    const resize = () => {
      w = window.innerWidth;
      h = window.innerHeight;
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      canvas.style.width = w + "px";
      canvas.style.height = h + "px";
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const count = Math.min(60, Math.floor((w * h) / 30000));
      particles = Array.from({ length: count }, () => ({
        x: Math.random() * w,
        y: Math.random() * h,
        vx: (Math.random() - 0.5) * 0.22,
        vy: (Math.random() - 0.5) * 0.22,
        r: Math.random() * 1.3 + 0.5,
        a: Math.random() * 0.22 + 0.08
      }));
    };

    const linkDist = 130;

    const draw = () => {
      ctx.clearRect(0, 0, w, h);

      // connecting lines
      for (let i = 0; i < particles.length; i++) {
        const p = particles[i];
        for (let j = i + 1; j < particles.length; j++) {
          const q = particles[j];
          const dx = p.x - q.x;
          const dy = p.y - q.y;
          const d2 = dx * dx + dy * dy;
          if (d2 < linkDist * linkDist) {
            const o = (1 - Math.sqrt(d2) / linkDist) * 0.06;
            ctx.strokeStyle = `rgba(${rgb},${o})`;
            ctx.lineWidth = 0.6;
            ctx.beginPath();
            ctx.moveTo(p.x, p.y);
            ctx.lineTo(q.x, q.y);
            ctx.stroke();
          }
        }
      }

      // particles
      for (const p of particles) {
        p.x += p.vx;
        p.y += p.vy;

        // gentle mouse repulsion
        const mdx = p.x - mouse.x;
        const mdy = p.y - mouse.y;
        const md2 = mdx * mdx + mdy * mdy;
        if (md2 < 13000) {
          const f = (1 - Math.sqrt(md2) / 114) * 0.6;
          p.x += (mdx / (Math.sqrt(md2) || 1)) * f;
          p.y += (mdy / (Math.sqrt(md2) || 1)) * f;
        }

        if (p.x < -20) p.x = w + 20;
        if (p.x > w + 20) p.x = -20;
        if (p.y < -20) p.y = h + 20;
        if (p.y > h + 20) p.y = -20;

        const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r * 4);
        g.addColorStop(0, `rgba(${rgb},${p.a * 0.7})`);
        g.addColorStop(1, `rgba(${rgb},0)`);
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r * 4, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = `rgba(${rgb},${Math.min(0.55, p.a + 0.18)})`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fill();
      }

      raf = requestAnimationFrame(draw);
    };

    const onMove = (e: MouseEvent) => {
      mouse.x = e.clientX;
      mouse.y = e.clientY;
    };
    const onLeave = () => {
      mouse.x = -9999;
      mouse.y = -9999;
    };

    resize();
    window.addEventListener("resize", resize);
    if (!reduce) {
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseout", onLeave);
      draw();
    } else {
      // static single frame
      draw();
      cancelAnimationFrame(raf);
    }

    // refresh color when theme changes (data-theme attr)
    const obs = new MutationObserver(() => {
      rgb = readColors();
    });
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseout", onLeave);
      obs.disconnect();
    };
  }, []);

  // re-read colors immediately on theme switch via key
  useEffect(() => {
    const cs = getComputedStyle(document.documentElement);
    void cs.getPropertyValue("--particle");
  }, [theme]);

  return <canvas ref={ref} className="particle-canvas" aria-hidden />;
}
