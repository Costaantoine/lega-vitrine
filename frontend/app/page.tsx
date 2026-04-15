"use client";
import { useState, useEffect, useCallback } from "react";

// ── Config ─────────────────────────────────────────────────────────────────
const SITE_API = process.env.NEXT_PUBLIC_SITE_API_URL || "http://76.13.141.221:8003/api/site";
const BVI_WS   = process.env.NEXT_PUBLIC_BVI_WS_URL   || "ws://76.13.141.221:8002/ws/stream";

const LANGS = [
  { code: "pt", label: "PT", dir: "ltr" },
  { code: "fr", label: "FR", dir: "ltr" },
  { code: "en", label: "EN", dir: "ltr" },
  { code: "es", label: "ES", dir: "ltr" },
  { code: "de", label: "DE", dir: "ltr" },
  { code: "it", label: "IT", dir: "ltr" },
  { code: "ru", label: "RU", dir: "ltr" },
  { code: "ar", label: "AR", dir: "rtl" },
];

const CATEGORIES = ["machines_tp", "trucks", "trailers", "vans"];

// Couleurs
const C1 = "#1B3F6E"; // bleu marine
const C2 = "#E8641E"; // orange

// ── i18n ───────────────────────────────────────────────────────────────────
type Dict = Record<string, string>;
const cache: Record<string, Dict> = {};

async function loadLocale(lang: string): Promise<Dict> {
  if (cache[lang]) return cache[lang];
  try {
    const r = await fetch(`/locales/${lang}.json`);
    const d = await r.json();
    cache[lang] = d;
    return d;
  } catch {
    return {};
  }
}

// ── Types ──────────────────────────────────────────────────────────────────
interface SiteConfig { [key: string]: string }
interface Product {
  id: string; title: string; category: string; brand: string; model: string;
  year: number; hours: number; price: number; currency: string;
  location: string; description: string; images: string[]; status: string;
}

// ── Styles helper ──────────────────────────────────────────────────────────
const s = (styles: React.CSSProperties): React.CSSProperties => styles;

export default function LegaSite() {
  const [lang, setLang] = useState("pt");
  const [dir, setDir]   = useState<"ltr"|"rtl">("ltr");
  const [t, setT]       = useState<Dict>({});
  const [cfg, setCfg]   = useState<SiteConfig>({});
  const [products, setProducts] = useState<Product[]>([]);
  const [total, setTotal]       = useState(0);
  const [catFilter, setCatFilter] = useState("");
  const [searchQ, setSearchQ]     = useState("");
  const [chatOpen, setChatOpen]   = useState(false);
  const [chatMsgs, setChatMsgs]   = useState<{role:string; text:string}[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [ws, setWs]               = useState<WebSocket|null>(null);
  const [contactForm, setContactForm] = useState({ name:"", email:"", phone:"", message:"" });
  const [contactSent, setContactSent] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<Product|null>(null);

  // Charger langue
  useEffect(() => {
    loadLocale(lang).then(setT);
    const found = LANGS.find(l => l.code === lang);
    setDir((found?.dir ?? "ltr") as "ltr"|"rtl");
    document.documentElement.lang = lang;
    document.documentElement.dir  = found?.dir ?? "ltr";
  }, [lang]);

  // Charger config site
  useEffect(() => {
    fetch(`${SITE_API}/config`)
      .then(r => r.json())
      .then((rows: {key:string; value:string}[]) => {
        const map: SiteConfig = {};
        rows.forEach(r => { map[r.key] = r.value; });
        setCfg(map);
      })
      .catch(() => {});
  }, []);

  // Charger produits
  const fetchProducts = useCallback(() => {
    let url = `${SITE_API}/products?limit=12&status=available`;
    if (catFilter) url += `&category=${catFilter}`;
    fetch(url)
      .then(r => r.json())
      .then(d => { setProducts(d.items || []); setTotal(d.total || 0); })
      .catch(() => {});
  }, [catFilter]);

  useEffect(() => { fetchProducts(); }, [fetchProducts]);

  // WS chat
  const openChat = () => {
    setChatOpen(true);
    if (ws) return;
    const sid = `lega-vitrine-${Date.now()}`;
    const socket = new WebSocket(`${BVI_WS}?session_id=${sid}&preferred_agent=standardiste`);
    socket.onmessage = (e) => {
      try {
        const d = JSON.parse(e.data);
        const text = d.message || d.direct_response || d.result || JSON.stringify(d);
        setChatMsgs(prev => [...prev, { role: "assistant", text }]);
      } catch {}
    };
    setWs(socket);
  };

  const sendChat = () => {
    if (!chatInput.trim() || !ws) return;
    setChatMsgs(prev => [...prev, { role: "user", text: chatInput }]);
    ws.send(JSON.stringify({ message: chatInput, lang }));
    setChatInput("");
  };

  const sendContact = async () => {
    try {
      await fetch(`${SITE_API}/contact`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...contactForm, lang }),
      });
      setContactSent(true);
    } catch {}
  };

  const T = (k: string) => t[k] || k;
  const slogan = cfg[`slogan_${lang}`] || cfg["slogan_pt"] || "Equipamentos que movem o mundo";

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <div dir={dir} style={s({ minHeight: "100vh", background: "#f8fafc" })}>

      {/* ── NAVBAR ──────────────────────────────────────────────────────── */}
      <nav style={s({
        background: C1, color: "#fff", padding: "0 24px",
        display: "flex", alignItems: "center", justifyContent: "space-between",
        height: 64, position: "sticky", top: 0, zIndex: 100,
        boxShadow: "0 2px 12px rgba(0,0,0,0.3)",
      })}>
        <div style={s({ display: "flex", alignItems: "center", gap: 16 })}>
          <span style={s({ fontWeight: 800, fontSize: 22, letterSpacing: "-0.5px" })}>
            <span style={s({ color: C2 })}>LEGA</span> Trading
          </span>
          <div style={s({ display: "flex", gap: 8, marginInlineStart: 24 })}>
            {["nav_home","nav_catalogue","nav_contact"].map(k => (
              <a key={k} href={`#${k.split("_")[1]}`}
                style={s({ color: "rgba(255,255,255,0.8)", textDecoration: "none", fontSize: 14, padding: "6px 12px", borderRadius: 6, transition: "background 0.15s" })}>
                {T(k)}
              </a>
            ))}
          </div>
        </div>
        <div style={s({ display: "flex", alignItems: "center", gap: 8 })}>
          {LANGS.map(l => (
            <button key={l.code} onClick={() => setLang(l.code)}
              style={s({
                padding: "4px 8px", border: "none", borderRadius: 4, cursor: "pointer", fontSize: 12, fontWeight: 600,
                background: lang === l.code ? C2 : "rgba(255,255,255,0.12)",
                color: lang === l.code ? "#fff" : "rgba(255,255,255,0.7)",
              })}>
              {l.label}
            </button>
          ))}
        </div>
      </nav>

      {/* ── HERO ────────────────────────────────────────────────────────── */}
      <section id="home" style={s({
        background: `linear-gradient(rgba(27,63,110,0.72) 0%, rgba(27,63,110,0.5) 100%), url('https://images.unsplash.com/photo-1504307651254-35680f356dfd?w=1600&q=80') center/cover no-repeat`,
        color: "#fff", padding: "100px 24px 80px", textAlign: "center",
        minHeight: 480, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
      })}>
        <h1 style={s({ fontSize: "clamp(28px, 5vw, 52px)", fontWeight: 800, margin: "0 0 16px", lineHeight: 1.15, maxWidth: 700 })}>
          {cfg["site_name"] || "LEGA Trading"}
        </h1>
        <p style={s({ fontSize: "clamp(16px, 2.5vw, 22px)", margin: "0 0 36px", opacity: 0.92, maxWidth: 600 })}>
          {slogan}
        </p>
        <div style={s({ display: "flex", gap: 12, flexWrap: "wrap", justifyContent: "center" })}>
          <a href="#catalogue" style={s({
            background: C2, color: "#fff", padding: "14px 32px", borderRadius: 8,
            fontWeight: 700, fontSize: 16, textDecoration: "none",
          })}>
            {T("hero_cta")}
          </a>
          <a href="#contact" style={s({
            background: "rgba(255,255,255,0.15)", color: "#fff", padding: "14px 32px", borderRadius: 8,
            fontWeight: 700, fontSize: 16, textDecoration: "none", border: "2px solid rgba(255,255,255,0.4)",
          })}>
            {T("hero_cta_contact")}
          </a>
        </div>
      </section>

      {/* ── STATS ───────────────────────────────────────────────────────── */}
      <section style={s({ background: C2, color: "#fff", padding: "28px 24px" })}>
        <div style={s({ maxWidth: 1000, margin: "0 auto", display: "flex", justifyContent: "space-around", flexWrap: "wrap", gap: 16 })}>
          {[
            { val: cfg["stat_machines"] || "400+", label: T("stat_machines") },
            { val: cfg["stat_langues"] || "8",     label: T("stat_langs") },
            { val: cfg["stat_pays"] || "15+",      label: T("stat_countries") },
            { val: cfg["stat_support"] || "24/7",  label: T("stat_support") },
          ].map((s, i) => (
            <div key={i} style={{ textAlign: "center" }}>
              <div style={{ fontSize: 32, fontWeight: 800, lineHeight: 1 }}>{s.val}</div>
              <div style={{ fontSize: 13, opacity: 0.9, marginTop: 4, textTransform: "uppercase", letterSpacing: "0.08em" }}>{s.label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ── CATALOGUE ───────────────────────────────────────────────────── */}
      <section id="catalogue" style={s({ maxWidth: 1200, margin: "0 auto", padding: "60px 24px" })}>
        <h2 style={s({ fontSize: 28, fontWeight: 700, color: C1, marginBottom: 8 })}>
          {T("nav_catalogue")}
        </h2>
        <p style={s({ color: "#64748b", marginBottom: 28 })}>{total} annonces disponibles</p>

        {/* Filtres */}
        <div style={s({ display: "flex", gap: 12, marginBottom: 32, flexWrap: "wrap" })}>
          <select value={catFilter} onChange={e => setCatFilter(e.target.value)}
            style={s({ padding: "10px 14px", border: `1px solid #e2e8f0`, borderRadius: 8, fontSize: 14, color: "#1e293b", background: "#fff" })}>
            <option value="">{T("cat_all")}</option>
            {CATEGORIES.map(c => (
              <option key={c} value={c}>{T(`cat_${c}`)}</option>
            ))}
          </select>
          <div style={s({ display: "flex", flex: 1, gap: 0, minWidth: 240 })}>
            <input
              type="text" value={searchQ} onChange={e => setSearchQ(e.target.value)}
              placeholder={T("search_placeholder")}
              style={s({ flex: 1, padding: "10px 14px", border: `1px solid #e2e8f0`, borderRadius: "8px 0 0 8px", fontSize: 14 })}
            />
            <button onClick={fetchProducts}
              style={s({ padding: "10px 20px", background: C1, color: "#fff", border: "none", borderRadius: "0 8px 8px 0", fontWeight: 600, cursor: "pointer" })}>
              {T("search_btn")}
            </button>
          </div>
        </div>

        {/* Grille produits */}
        {products.length === 0 ? (
          <div style={s({ textAlign: "center", padding: "60px 0", color: "#94a3b8" })}>
            <div style={s({ fontSize: 48, marginBottom: 12 })}>🚜</div>
            <p>Chargement du catalogue...</p>
          </div>
        ) : (
          <div style={s({ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 20 })}>
            {products.map(p => (
              <ProductCard key={p.id} product={p} t={T} c1={C1} c2={C2}
                onClick={() => setSelectedProduct(p)} />
            ))}
          </div>
        )}
      </section>

      {/* ── AI BANNER ───────────────────────────────────────────────────── */}
      <section style={s({
        background: `linear-gradient(135deg, ${C1} 0%, #0f2a50 100%)`,
        color: "#fff", padding: "48px 24px", textAlign: "center",
      })}>
        <div style={s({ maxWidth: 600, margin: "0 auto" })}>
          <div style={s({ fontSize: 40, marginBottom: 12 })}>🤖</div>
          <h3 style={s({ fontSize: 22, fontWeight: 700, margin: "0 0 8px" })}>{T("ai_banner_title")}</h3>
          <p style={s({ margin: "0 0 24px", opacity: 0.85 })}>{T("ai_banner_sub")}</p>
          <button onClick={openChat}
            style={s({ background: C2, color: "#fff", border: "none", padding: "14px 32px", borderRadius: 8, fontWeight: 700, fontSize: 16, cursor: "pointer" })}>
            💬 Chat IA
          </button>
        </div>
      </section>

      {/* ── CONTACT ─────────────────────────────────────────────────────── */}
      <section id="contact" style={s({ maxWidth: 700, margin: "0 auto", padding: "60px 24px" })}>
        <h2 style={s({ fontSize: 28, fontWeight: 700, color: C1, marginBottom: 32 })}>{T("contact_title")}</h2>
        {contactSent ? (
          <div style={s({ background: "#dcfce7", border: "1px solid #86efac", borderRadius: 10, padding: "20px 24px", color: "#166534", fontWeight: 600 })}>
            ✅ {T("contact_success")}
          </div>
        ) : (
          <div style={s({ display: "flex", flexDirection: "column", gap: 16 })}>
            {(["contact_name","contact_email","contact_phone"] as const).map(k => (
              <input key={k}
                placeholder={T(k)}
                value={contactForm[k.replace("contact_","") as keyof typeof contactForm] || ""}
                onChange={e => setContactForm(prev => ({ ...prev, [k.replace("contact_","")]: e.target.value }))}
                style={s({ padding: "12px 14px", border: "1px solid #e2e8f0", borderRadius: 8, fontSize: 14 })}
              />
            ))}
            <textarea
              placeholder={T("contact_message")} rows={4} value={contactForm.message}
              onChange={e => setContactForm(prev => ({ ...prev, message: e.target.value }))}
              style={s({ padding: "12px 14px", border: "1px solid #e2e8f0", borderRadius: 8, fontSize: 14, resize: "vertical" })}
            />
            <button onClick={sendContact}
              style={s({ padding: "14px", background: C1, color: "#fff", border: "none", borderRadius: 8, fontWeight: 700, fontSize: 16, cursor: "pointer" })}>
              {T("contact_send")}
            </button>
          </div>
        )}

        {/* Infos contact */}
        <div style={s({ marginTop: 40, display: "flex", flexDirection: "column", gap: 10, color: "#475569", fontSize: 14 })}>
          <div>📞 <strong>{cfg["phone"]}</strong></div>
          <div>✉️ <strong>{cfg["email"]}</strong></div>
          <div>📍 {cfg["address"]}</div>
          <div>🕐 {T("footer_hours")}</div>
          <div>🏛️ {T("footer_nif")} : PT 510 245 447</div>
        </div>
      </section>

      {/* ── FOOTER ──────────────────────────────────────────────────────── */}
      <footer style={s({ background: C1, color: "rgba(255,255,255,0.7)", padding: "24px", textAlign: "center", fontSize: 13 })}>
        <strong style={s({ color: "#fff" })}>LEGA Trading</strong> © {new Date().getFullYear()} — {T("footer_rights")}
      </footer>

      {/* ── CHAT WIDGET ─────────────────────────────────────────────────── */}
      {!chatOpen && (
        <button onClick={openChat}
          style={s({
            position: "fixed", bottom: 28, insetInlineEnd: 28, zIndex: 200,
            background: C2, color: "#fff", border: "none", borderRadius: "50%",
            width: 60, height: 60, fontSize: 26, cursor: "pointer",
            boxShadow: "0 4px 20px rgba(232,100,30,0.5)",
          })}>💬</button>
      )}
      {chatOpen && (
        <div style={s({
          position: "fixed", bottom: 28, insetInlineEnd: 28, zIndex: 200,
          width: 340, height: 480, background: "#fff",
          borderRadius: 16, boxShadow: "0 8px 40px rgba(0,0,0,0.2)",
          display: "flex", flexDirection: "column", overflow: "hidden",
          border: `2px solid ${C2}`,
        })}>
          <div style={s({ background: C1, color: "#fff", padding: "14px 16px", display: "flex", justifyContent: "space-between", alignItems: "center" })}>
            <span style={s({ fontWeight: 700 })}>🤖 LEGA IA</span>
            <button onClick={() => setChatOpen(false)}
              style={s({ background: "none", border: "none", color: "#fff", cursor: "pointer", fontSize: 18 })}>✕</button>
          </div>
          <div style={s({ flex: 1, overflowY: "auto", padding: 12, display: "flex", flexDirection: "column", gap: 8 })}>
            {chatMsgs.length === 0 && (
              <div style={s({ color: "#94a3b8", fontSize: 13, textAlign: "center", marginTop: 20 })}>
                {T("ai_chat_placeholder")}
              </div>
            )}
            {chatMsgs.map((m, i) => (
              <div key={i} style={s({
                maxWidth: "85%", padding: "8px 12px", borderRadius: 10, fontSize: 13, lineHeight: 1.4,
                alignSelf: m.role === "user" ? "flex-end" : "flex-start",
                background: m.role === "user" ? C2 : "#f1f5f9",
                color: m.role === "user" ? "#fff" : "#1e293b",
              })}>
                {m.text}
              </div>
            ))}
          </div>
          <div style={s({ padding: "10px 12px", borderTop: "1px solid #e2e8f0", display: "flex", gap: 8 })}>
            <input
              value={chatInput} onChange={e => setChatInput(e.target.value)}
              onKeyDown={e => e.key === "Enter" && sendChat()}
              placeholder={T("ai_chat_placeholder")}
              style={s({ flex: 1, padding: "8px 12px", border: "1px solid #e2e8f0", borderRadius: 8, fontSize: 13 })}
            />
            <button onClick={sendChat}
              style={s({ padding: "8px 14px", background: C2, color: "#fff", border: "none", borderRadius: 8, cursor: "pointer", fontWeight: 700 })}>
              ➤
            </button>
          </div>
        </div>
      )}

      {/* ── MODAL PRODUIT ───────────────────────────────────────────────── */}
      {selectedProduct && (
        <ProductModal product={selectedProduct} t={T} c1={C1} c2={C2}
          onClose={() => setSelectedProduct(null)}
          onQuote={() => { setSelectedProduct(null); document.getElementById("contact")?.scrollIntoView({ behavior: "smooth" }); }} />
      )}
    </div>
  );
}

// ── ProductCard ─────────────────────────────────────────────────────────────
function ProductCard({ product: p, t, c1, c2, onClick }:
  { product: Product; t: (k:string)=>string; c1:string; c2:string; onClick:()=>void }) {
  const imgs = Array.isArray(p.images) ? p.images : (typeof p.images === "string" ? JSON.parse(p.images||"[]") : []);
  const thumb = imgs[0] || `https://images.unsplash.com/photo-1504307651254-35680f356dfd?w=400&q=60`;
  return (
    <div onClick={onClick} style={{
      background: "#fff", borderRadius: 12, overflow: "hidden",
      boxShadow: "0 1px 4px rgba(0,0,0,0.08)", cursor: "pointer",
      transition: "transform 0.15s, box-shadow 0.15s",
      border: "1px solid #e2e8f0",
    }}
      onMouseOver={e => { (e.currentTarget as HTMLDivElement).style.transform = "translateY(-3px)"; (e.currentTarget as HTMLDivElement).style.boxShadow = "0 8px 24px rgba(0,0,0,0.12)"; }}
      onMouseOut={e => { (e.currentTarget as HTMLDivElement).style.transform = ""; (e.currentTarget as HTMLDivElement).style.boxShadow = "0 1px 4px rgba(0,0,0,0.08)"; }}
    >
      <div style={{ height: 180, background: "#f1f5f9", overflow: "hidden" }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={thumb} alt={p.title} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
      </div>
      <div style={{ padding: "14px 16px" }}>
        <div style={{ fontSize: 11, color: c2, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 4 }}>
          {t(`cat_${p.category}`) || p.category}
        </div>
        <h3 style={{ margin: "0 0 8px", fontSize: 15, fontWeight: 700, color: "#1e293b", lineClamp: 2 }}>{p.title}</h3>
        <div style={{ display: "flex", gap: 12, fontSize: 12, color: "#64748b", marginBottom: 12 }}>
          {p.year && <span>📅 {p.year}</span>}
          {p.hours && <span>⏱ {p.hours.toLocaleString()}h</span>}
          {p.location && <span>📍 {p.location}</span>}
        </div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span style={{ fontSize: 18, fontWeight: 800, color: c1 }}>
            {p.price ? `${p.price.toLocaleString()} ${p.currency || "€"}` : "Sur demande"}
          </span>
          <span style={{
            fontSize: 11, padding: "3px 8px", borderRadius: 4, fontWeight: 600,
            background: p.status === "available" ? "#dcfce7" : p.status === "reserved" ? "#fef9c3" : "#f1f5f9",
            color: p.status === "available" ? "#166534" : p.status === "reserved" ? "#854d0e" : "#475569",
          }}>
            {t(`status_${p.status}`) || p.status}
          </span>
        </div>
      </div>
    </div>
  );
}

// ── ProductModal ─────────────────────────────────────────────────────────────
function ProductModal({ product: p, t, c1, c2, onClose, onQuote }:
  { product: Product; t:(k:string)=>string; c1:string; c2:string; onClose:()=>void; onQuote:()=>void }) {
  const imgs = Array.isArray(p.images) ? p.images : (typeof p.images === "string" ? JSON.parse(p.images||"[]") : []);
  const thumb = imgs[0] || `https://images.unsplash.com/photo-1504307651254-35680f356dfd?w=800&q=80`;
  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 300,
      display: "flex", alignItems: "center", justifyContent: "center", padding: 16,
    }} onClick={onClose}>
      <div style={{
        background: "#fff", borderRadius: 16, maxWidth: 640, width: "100%",
        maxHeight: "90vh", overflowY: "auto",
      }} onClick={e => e.stopPropagation()}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={thumb} alt={p.title} style={{ width: "100%", height: 280, objectFit: "cover", borderRadius: "16px 16px 0 0" }} />
        <div style={{ padding: 24 }}>
          <div style={{ fontSize: 12, color: c2, fontWeight: 700, textTransform: "uppercase", marginBottom: 4 }}>
            {t(`cat_${p.category}`) || p.category}
          </div>
          <h2 style={{ margin: "0 0 16px", fontSize: 22, fontWeight: 800, color: "#1e293b" }}>{p.title}</h2>
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap", fontSize: 14, color: "#475569", marginBottom: 16 }}>
            {p.brand && <span><strong>Marque :</strong> {p.brand}</span>}
            {p.model && <span><strong>Modèle :</strong> {p.model}</span>}
            {p.year  && <span><strong>Année :</strong> {p.year}</span>}
            {p.hours && <span><strong>Heures :</strong> {p.hours.toLocaleString()}h</span>}
            {p.location && <span>📍 {p.location}</span>}
          </div>
          {p.description && <p style={{ color: "#475569", lineHeight: 1.6, marginBottom: 20 }}>{p.description}</p>}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
            <span style={{ fontSize: 26, fontWeight: 800, color: c1 }}>
              {p.price ? `${p.price.toLocaleString()} ${p.currency || "€"}` : "Sur demande"}
            </span>
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={onClose}
                style={{ padding: "10px 20px", border: "1px solid #e2e8f0", borderRadius: 8, background: "#fff", cursor: "pointer" }}>
                ✕ Fermer
              </button>
              <button onClick={onQuote}
                style={{ padding: "10px 24px", background: c2, color: "#fff", border: "none", borderRadius: 8, fontWeight: 700, cursor: "pointer" }}>
                {t("btn_quote")}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
