'use client';
import { useEffect, useState, useRef } from 'react';

interface HeroImage { id: number; url: string; alt_text: string; position: number; }
interface HeroData  { images: HeroImage[]; interval_ms: number; }

export default function HeroCarousel({
  siteBase,
  colorPrimary = '#1B3F6E',
  colorSecondary = '#E8641E',
  children,
}: {
  siteBase: string;
  colorPrimary?: string;
  colorSecondary?: string;
  children: React.ReactNode;
}) {
  const [images, setImages]         = useState<HeroImage[]>([]);
  const [intervalMs, setIntervalMs] = useState(3000);
  const [activeIndex, setActiveIndex] = useState(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const base = siteBase.replace(/\/$/, '').replace(/\/api\/site$/, '');

  const resolveUrl = (url: string) =>
    url.startsWith('http') ? url : `${base}${url}`;

  useEffect(() => {
    fetch(`${base}/api/site/hero-images`)
      .then(r => r.json())
      .then((d: HeroData) => {
        setImages(d.images || []);
        setIntervalMs(d.interval_ms || 3000);
      })
      .catch(() => {});
  }, [siteBase]);

  const startInterval = (ms: number, count: number) => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    if (count <= 1) return;
    intervalRef.current = setInterval(() => {
      setActiveIndex(prev => (prev + 1) % count);
    }, ms);
  };

  useEffect(() => {
    startInterval(intervalMs, images.length);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [images, intervalMs]);

  const goTo = (i: number) => {
    setActiveIndex(i);
    startInterval(intervalMs, images.length);
  };

  return (
    <section
      id="home"
      style={{
        position: 'relative', color: '#fff',
        padding: '100px 24px 80px', textAlign: 'center',
        minHeight: 480, display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
        background: colorPrimary,
      }}
    >
      {images.map((img, i) => (
        <div
          key={img.id}
          style={{
            position: 'absolute', inset: 0,
            opacity: i === activeIndex ? 1 : 0,
            transition: 'opacity 800ms ease-in-out',
            zIndex: i === activeIndex ? 1 : 0,
          }}
        >
          <img
            src={resolveUrl(img.url)}
            alt={img.alt_text || ''}
            style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
          />
          <div style={{
            position: 'absolute', inset: 0,
            background: 'linear-gradient(rgba(0,0,0,0.45) 0%, rgba(0,0,0,0.25) 100%)',
          }} />
        </div>
      ))}

      <div style={{ position: 'relative', zIndex: 10, width: '100%' }}>
        {children}
      </div>

      {images.length > 1 && (
        <div style={{
          position: 'absolute', bottom: 18, left: 0, right: 0,
          display: 'flex', justifyContent: 'center', gap: 8, zIndex: 20,
        }}>
          {images.map((_, i) => (
            <button
              key={i}
              onClick={() => goTo(i)}
              style={{
                width: i === activeIndex ? 22 : 8, height: 8,
                borderRadius: 4, border: 'none', cursor: 'pointer',
                background: i === activeIndex ? colorSecondary : 'rgba(255,255,255,0.4)',
                transition: 'all 300ms ease', padding: 0,
              }}
            />
          ))}
        </div>
      )}
    </section>
  );
}
