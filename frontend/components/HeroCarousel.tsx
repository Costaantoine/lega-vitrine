"use client";
import { useState, useEffect, useRef, useCallback } from "react";

interface HeroImage {
  id: number;
  url: string;
  alt_text: string;
  position: number;
}

interface HeroData {
  images: HeroImage[];
  interval_ms: number;
}

interface HeroCarouselProps {
  siteBase: string;
  children: React.ReactNode; // contenu texte/CTA superposé
}

const FALLBACK = "https://images.unsplash.com/photo-1747004175907-e64576ba2e22?w=1600&q=80";
const FADE_MS = 600;

const assetUrl = (siteBase: string, v: string) =>
  v.startsWith("http") ? v : `${siteBase}${v}`;

export default function HeroCarousel({ siteBase, children }: HeroCarouselProps) {
  const [data, setData]       = useState<HeroData>({ images: [], interval_ms: 3000 });
  const [current, setCurrent] = useState(0);
  const [visible, setVisible] = useState(true); // pour le cross-fade
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const api = siteBase.replace(/\/$/, "").replace(/\/api\/site$/, "") + "/api/site/hero-images";
    fetch(api)
      .then(r => r.json())
      .then((d: HeroData) => setData(d))
      .catch(() => {});
  }, [siteBase]);

  const advance = useCallback((images: HeroImage[]) => {
    if (images.length < 2) return;
    setVisible(false);
    setTimeout(() => {
      setCurrent(c => (c + 1) % images.length);
      setVisible(true);
    }, FADE_MS);
  }, []);

  useEffect(() => {
    if (data.images.length < 2) return;
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => advance(data.images), data.interval_ms);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [data, advance]);

  const images = data.images;
  const bgUrl  = images.length > 0 ? assetUrl(siteBase, images[current].url) : FALLBACK;
  const altTxt = images.length > 0 ? (images[current].alt_text || "Hero") : "Hero";

  return (
    <section
      id="home"
      style={{
        position: "relative",
        color: "#fff",
        padding: "100px 24px 80px",
        textAlign: "center",
        minHeight: 480,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        overflow: "hidden",
      }}
    >
      {/* Fond animé */}
      <div
        aria-label={altTxt}
        style={{
          position: "absolute", inset: 0,
          backgroundImage: `linear-gradient(rgba(0,0,0,0.45) 0%, rgba(0,0,0,0.25) 100%), url('${bgUrl}')`,
          backgroundSize: "cover",
          backgroundPosition: "center",
          backgroundRepeat: "no-repeat",
          opacity: visible ? 1 : 0,
          transition: `opacity ${FADE_MS}ms ease-in-out`,
          zIndex: 0,
        }}
      />

      {/* Contenu */}
      <div style={{ position: "relative", zIndex: 1, width: "100%" }}>
        {children}
      </div>

      {/* Indicateurs (points) — uniquement si plusieurs images */}
      {images.length > 1 && (
        <div
          style={{
            position: "absolute", bottom: 18, left: 0, right: 0,
            display: "flex", justifyContent: "center", gap: 8, zIndex: 2,
          }}
        >
          {images.map((_, i) => (
            <button
              key={i}
              onClick={() => {
                if (timerRef.current) clearInterval(timerRef.current);
                setVisible(false);
                setTimeout(() => { setCurrent(i); setVisible(true); }, FADE_MS);
              }}
              aria-label={`Image ${i + 1}`}
              style={{
                width: i === current ? 22 : 8, height: 8,
                borderRadius: 4, border: "none", cursor: "pointer",
                background: i === current ? "#fff" : "rgba(255,255,255,0.4)",
                transition: "all 0.3s",
                padding: 0,
              }}
            />
          ))}
        </div>
      )}
    </section>
  );
}
