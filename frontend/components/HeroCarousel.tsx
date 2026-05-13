"use client";
import { useState, useEffect, useRef } from "react";

interface HeroImage { id: number; url: string; alt_text: string; position: number; }
interface HeroData  { images: HeroImage[]; interval_ms: number; }

const FALLBACK = "https://images.unsplash.com/photo-1747004175907-e64576ba2e22?w=1600&q=80";
const FADE_MS  = 600;

export default function HeroCarousel({
  siteBase,
  children,
}: {
  siteBase: string;
  children: React.ReactNode;
}) {
  const [images, setImages]       = useState<HeroImage[]>([]);
  const [intervalMs, setIntervalMs] = useState(3000);
  const [current, setCurrent]     = useState(0);
  const [visible, setVisible]     = useState(true);

  // Refs pour éviter les stale closures dans setInterval
  const imagesRef     = useRef<HeroImage[]>([]);
  const currentRef    = useRef(0);
  const timerRef      = useRef<ReturnType<typeof setInterval> | null>(null);
  const fadingRef     = useRef(false);

  // Charger les images depuis l'API
  useEffect(() => {
    const base = siteBase.replace(/\/$/, "").replace(/\/api\/site$/, "");
    fetch(base + "/api/site/hero-images")
      .then(r => r.json())
      .then((d: HeroData) => {
        setImages(d.images || []);
        imagesRef.current = d.images || [];
        setIntervalMs(d.interval_ms || 3000);
      })
      .catch(() => {});
  }, [siteBase]);

  // Démarrer / redémarrer l'intervalle quand images ou intervalle changent
  useEffect(() => {
    if (imagesRef.current.length < 2) return;

    const tick = () => {
      if (fadingRef.current) return; // skip si transition en cours
      fadingRef.current = true;
      setVisible(false);
      setTimeout(() => {
        const next = (currentRef.current + 1) % imagesRef.current.length;
        currentRef.current = next;
        setCurrent(next);
        setVisible(true);
        fadingRef.current = false;
      }, FADE_MS);
    };

    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(tick, intervalMs);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [images, intervalMs]); // re-démarre si la liste ou l'intervalle change

  const bgUrl  = images.length > 0
    ? (images[current].url.startsWith("http") ? images[current].url : `${siteBase.replace(/\/api\/site$/, "")}${images[current].url}`)
    : FALLBACK;

  return (
    <section
      id="home"
      style={{
        position: "relative", color: "#fff",
        padding: "100px 24px 80px", textAlign: "center",
        minHeight: 480, display: "flex", flexDirection: "column",
        alignItems: "center", justifyContent: "center", overflow: "hidden",
      }}
    >
      {/* Fond avec cross-fade */}
      <div
        style={{
          position: "absolute", inset: 0,
          backgroundImage: `linear-gradient(rgba(0,0,0,0.45) 0%,rgba(0,0,0,0.25) 100%),url('${bgUrl}')`,
          backgroundSize: "cover", backgroundPosition: "center",
          opacity: visible ? 1 : 0,
          transition: `opacity ${FADE_MS}ms ease-in-out`,
          zIndex: 0,
        }}
      />

      {/* Contenu */}
      <div style={{ position: "relative", zIndex: 1, width: "100%" }}>
        {children}
      </div>

      {/* Indicateurs */}
      {images.length > 1 && (
        <div style={{ position: "absolute", bottom: 18, left: 0, right: 0, display: "flex", justifyContent: "center", gap: 8, zIndex: 2 }}>
          {images.map((_, i) => (
            <button key={i}
              onClick={() => {
                if (timerRef.current) clearInterval(timerRef.current);
                fadingRef.current = true;
                setVisible(false);
                setTimeout(() => {
                  currentRef.current = i;
                  setCurrent(i);
                  setVisible(true);
                  fadingRef.current = false;
                  // Repartir avec le même intervalle
                  timerRef.current = setInterval(() => {
                    if (fadingRef.current) return;
                    fadingRef.current = true;
                    setVisible(false);
                    setTimeout(() => {
                      const next = (currentRef.current + 1) % imagesRef.current.length;
                      currentRef.current = next;
                      setCurrent(next);
                      setVisible(true);
                      fadingRef.current = false;
                    }, FADE_MS);
                  }, intervalMs);
                }, FADE_MS);
              }}
              style={{
                width: i === current ? 22 : 8, height: 8,
                borderRadius: 4, border: "none", cursor: "pointer",
                background: i === current ? "#fff" : "rgba(255,255,255,0.4)",
                transition: "all 0.3s", padding: 0,
              }}
            />
          ))}
        </div>
      )}
    </section>
  );
}
