"use client";
import { useState, useEffect, useCallback, useRef } from "react";

const stripEmoji = (s: string) =>
  s.replace(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F700}-\u{1F77F}\u{1F780}-\u{1F7FF}\u{1F800}-\u{1F8FF}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{FE00}-\u{FE0F}\u{1F1E0}-\u{1F1FF}]/gu, "")
   .replace(/\s{2,}/g, " ").trim();

// ── Config ─────────────────────────────────────────────────────────────────
const SITE_API  = process.env.NEXT_PUBLIC_SITE_API_URL  || "http://76.13.141.221:8003/api/site";
const SITE_BASE = process.env.NEXT_PUBLIC_SITE_BASE_URL || "http://76.13.141.221:8003";
const BVI_WS    = process.env.NEXT_PUBLIC_BVI_WS_URL    || "ws://76.13.141.221:8002/ws/stream";

// Résout les URLs /uploads/... stockées en DB vers une URL absolue
const assetUrl = (v: string | undefined) =>
  v ? (v.startsWith("http") ? v : `${SITE_BASE}${v}`) : undefined;

const LANGS = [
  { code: "pt", label: "🇵🇹 PT", dir: "ltr" },
  { code: "fr", label: "🇫🇷 FR", dir: "ltr" },
  { code: "en", label: "🇬🇧 EN", dir: "ltr" },
  { code: "es", label: "🇪🇸 ES", dir: "ltr" },
  { code: "de", label: "🇩🇪 DE", dir: "ltr" },
  { code: "it", label: "🇮🇹 IT", dir: "ltr" },
  { code: "nl", label: "🇳🇱 NL", dir: "ltr" },
  { code: "zh", label: "🇨🇳 ZH", dir: "ltr" },
  { code: "ru", label: "🇷🇺 RU", dir: "ltr" },
  { code: "ar", label: "🇸🇦 AR", dir: "rtl" },
];

const CATEGORIES = ["machines_tp", "trucks", "trailers", "vans"];


// ── i18n ───────────────────────────────────────────────────────────────────
type Dict = Record<string, string>;
const cache: Record<string, Dict> = {};

async function loadLocale(lang: string): Promise<Dict> {
  if (cache[lang]) return cache[lang];
  // 1. Essayer la DB (traductions éditables depuis le dashboard CMS)
  try {
    const r = await fetch(`${SITE_API}/translations/${lang}`);
    if (r.ok) {
      const d = await r.json();
      if (Object.keys(d).length > 0) {
        cache[lang] = d;
        return d;
      }
    }
  } catch { /* fallback fichier statique */ }
  // 2. Fallback : fichier statique /locales/{lang}.json
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
  location: string; description: string; images: string[]; status: string; reference: string;
}
interface DocNode { name: string; path: string; type: "file"|"directory"; ext?: string; children?: DocNode[] }
interface DocContent { type: "text"|"pdf"; name: string; content?: string; path: string; size?: number }
interface SiteClient { id: string; name: string; email: string; company?: string; lang: string }

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
  const [prodOffset, setProdOffset] = useState(0);
  const [hasMore, setHasMore]       = useState(false);
  const PROD_LIMIT = 12;
  const [chatOpen, setChatOpen]   = useState(false);
  const [chatMsgs, setChatMsgs]   = useState<{role:string; text:string; streaming?:boolean}[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [ttsEnabled, setTtsEnabled] = useState(false);
  const ttsEnabledRef = useRef(false);
  const audioCtxRef  = useRef<AudioContext|null>(null);
  const audioQueueRef = useRef<AudioBuffer[]>([]);
  const audioPlayingRef = useRef(false);
  const [ws, setWs]               = useState<WebSocket|null>(null);
  const [leaStatus, setLeaStatus] = useState<'waiting'|'thinking'|'done'|null>(null);
  const [leaThinkText, setLeaThinkText] = useState('');
  const [contactForm, setContactForm] = useState({ name:"", email:"", phone:"", message:"" });
  const [contactSent, setContactSent] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<Product|null>(null);
  const [quoteProductId, setQuoteProductId] = useState<string|null>(null);
  const [quoteProductTitle, setQuoteProductTitle] = useState<string|null>(null);
  // Docs + auth
  const [client, setClient]           = useState<SiteClient|null>(null);
  const [docsView, setDocsView]       = useState(false);
  const [loginOpen, setLoginOpen]     = useState(false);
  const [loginMode, setLoginMode]     = useState<"login"|"register">("login");
  const [loginForm, setLoginForm]     = useState({email:"",password:"",name:"",company:""});
  const [loginError, setLoginError]   = useState("");
  const [docsTree, setDocsTree]       = useState<DocNode[]>([]);
  const [selectedDoc, setSelectedDoc] = useState<DocNode|null>(null);
  const [docContent, setDocContent]   = useState<DocContent|null>(null);
  const [dlReqOpen, setDlReqOpen]     = useState(false);
  const [dlReqForm, setDlReqForm]     = useState({client_name:"",client_email:"",client_company:"",motif:""});
  const [dlReqSent, setDlReqSent]     = useState(false);

  // Sync TTS ref
  useEffect(() => { ttsEnabledRef.current = ttsEnabled; }, [ttsEnabled]);

  // Restaurer session client
  useEffect(() => {
    try {
      const sc = localStorage.getItem("lega_client");
      if (sc) { setClient(JSON.parse(sc)); }
    } catch {}
  }, []);

  // Pré-remplir form download quand client connecté
  useEffect(() => {
    if (client) setDlReqForm(f => ({ ...f, client_name: client.name||"", client_email: client.email, client_company: client.company||"" }));
  }, [client]);

  const loadDocsTree = async () => {
    try { const d = await (await fetch(`${SITE_API}/docs`)).json(); setDocsTree(d.tree||[]); } catch {}
  };
  const loadDocContent = async (node: DocNode) => {
    setSelectedDoc(node); setDocContent(null);
    try { const d = await (await fetch(`${SITE_API}/docs/content?path=${encodeURIComponent(node.path)}`)).json(); setDocContent(d); } catch {}
  };
  const openDocs = () => {
    if (!client) { setLoginOpen(true); return; }
    setDocsView(true);
    if (docsTree.length === 0) loadDocsTree();
    setTimeout(() => document.getElementById("docs")?.scrollIntoView({ behavior: "smooth" }), 100);
  };
  const loginClient = async () => {
    setLoginError("");
    try {
      const r = await fetch(`${SITE_API}/auth/login`, { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({email:loginForm.email,password:loginForm.password}) });
      if (!r.ok) { setLoginError("Email ou mot de passe incorrect"); return; }
      const d = await r.json();
      setClient(d.client); localStorage.setItem("lega_client", JSON.stringify(d.client));
      setLoginOpen(false); setDocsView(true); loadDocsTree();
      setTimeout(() => document.getElementById("docs")?.scrollIntoView({ behavior: "smooth" }), 200);
    } catch { setLoginError("Erreur de connexion"); }
  };
  const registerClient = async () => {
    setLoginError("");
    try {
      const r = await fetch(`${SITE_API}/auth/register`, { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify(loginForm) });
      if (!r.ok) { const e = await r.json(); setLoginError(e.detail||"Erreur d'inscription"); return; }
      await loginClient();
    } catch { setLoginError("Erreur d'inscription"); }
  };
  const submitDlReq = async () => {
    if (!selectedDoc) return;
    try { await fetch(`${SITE_API}/docs/request`, { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({doc_path:selectedDoc.path,...dlReqForm}) }); setDlReqSent(true); } catch {}
  };

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
  const fetchProducts = useCallback((offset = 0, append = false) => {
    // Quand un filtre catégorie est actif, on charge tout d'un coup (pas de pagination)
    const limit = catFilter ? 999 : PROD_LIMIT;
    let url = `${SITE_API}/products?limit=${limit}&offset=${offset}&status=available`;
    if (catFilter) url += `&category=${catFilter}`;
    fetch(url)
      .then(r => r.json())
      .then(d => {
        const items = d.items || [];
        const tot   = d.total || 0;
        setProducts(prev => append ? [...prev, ...items] : items);
        setTotal(tot);
        const nextOffset = offset + items.length;
        setProdOffset(nextOffset);
        setHasMore(!catFilter && nextOffset < tot);
      })
      .catch(() => {});
  }, [catFilter]);

  useEffect(() => { setProdOffset(0); fetchProducts(0, false); }, [catFilter]); // eslint-disable-line react-hooks/exhaustive-deps

  const WELCOME: Record<string, string> = {
    fr: "Bonjour, je suis Léa. Comment puis-je vous aider ?",
    pt: "Olá, sou a Léa. Como posso ajudá-lo?",
    en: "Hello, I am Léa. How can I help you?",
    es: "Hola, soy Léa. ¿En qué puedo ayudarle?",
    de: "Hallo, ich bin Léa. Wie kann ich Ihnen helfen?",
    it: "Buongiorno, sono Léa. Come posso aiutarla?",
    nl: "Hallo, ik ben Léa. Hoe kan ik u helpen?",
    zh: "您好，我是Léa。请问有什么可以帮您？",
    ru: "Здравствуйте, я Лея. Чем могу помочь?",
    ar: "مرحباً، أنا ليا. كيف يمكنني مساعدتك؟",
  };

  // WS chat
  const openChat = () => {
    if (!chatOpen) {
      setChatOpen(true);
      setChatMsgs([{ role: "assistant", text: WELCOME[lang] || WELCOME["fr"] }]);
    }
    if (ws?.readyState === WebSocket.OPEN) return;
    if (ws) { try { ws.close(); } catch {} setWs(null); }
    const sid = `lega-vitrine-${Date.now()}`;
    const socket = new WebSocket(`${BVI_WS}?session_id=${sid}&preferred_agent=standardiste`);
    const handleDisconnect = () => setWs(null);
    socket.onclose = handleDisconnect;
    socket.onerror = handleDisconnect;
    const playNext = (ctx: AudioContext) => {
      if (audioPlayingRef.current || audioQueueRef.current.length === 0) return;
      audioPlayingRef.current = true;
      const buf = audioQueueRef.current.shift()!;
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.connect(ctx.destination);
      src.onended = () => { audioPlayingRef.current = false; playNext(ctx); };
      src.start(0);
    };

    socket.onmessage = (e) => {
      try {
        const d = JSON.parse(e.data);

        if (d.type === "text_chunk") {
          const chunk = stripEmoji(d.payload || "");
          if (!chunk) return;
          setLeaStatus(s => s === "waiting" ? "thinking" : s);
          setLeaThinkText("Léa rédige sa réponse...");
          setChatMsgs(prev => {
            const last = prev[prev.length - 1];
            if (last?.streaming) return [...prev.slice(0,-1), { ...last, text: last.text + chunk }];
            return [...prev, { role: "assistant", text: chunk, streaming: true }];
          });
          return;
        }

        if (d.type === "audio_chunk") {
          if (!ttsEnabledRef.current) return;
          try {
            if (!audioCtxRef.current) audioCtxRef.current = new AudioContext();
            const ctx = audioCtxRef.current;
            const bytes = Uint8Array.from(atob(d.payload), c => c.charCodeAt(0));
            ctx.decodeAudioData(bytes.buffer.slice(0), buf => {
              audioQueueRef.current.push(buf);
              playNext(ctx);
            });
          } catch {}
          return;
        }

        if (d.type !== "agent_response") return;
        // Ignorer le greeting Tony — ce chat affiche uniquement Léa
        if (d.metadata?.agent === "tony") return;
        setLeaStatus("done");
        setTimeout(() => setLeaStatus(null), 350);
        const raw = d.payload || d.message || d.direct_response || "";
        setChatMsgs(prev => {
          const last = prev[prev.length - 1];
          if (last?.streaming) return [...prev.slice(0,-1), { ...last, streaming: false }];
          if (!raw) return prev;
          return [...prev, { role: "assistant", text: stripEmoji(raw) }];
        });
      } catch {}
    };
    setWs(socket);
  };

  const sendChat = () => {
    if (!chatInput.trim()) return;
    if (!ws || ws.readyState !== WebSocket.OPEN) { openChat(); return; }
    setChatMsgs(prev => [...prev, { role: "user", text: chatInput }]);
    ws.send(JSON.stringify({ payload: chatInput, lang, preferred_agent: "lea", canal: "web" }));
    setChatInput("");
    setLeaStatus("waiting");
    setLeaThinkText("");
  };

  const sendContact = async () => {
    try {
      await fetch(`${SITE_API}/contact`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...contactForm, lang, product_id: quoteProductId }),
      });
      setContactSent(true);
    } catch {}
  };

  const T = (k: string) => t[k] || k;
  const slogan = cfg[`slogan_${lang}`] || cfg["slogan_pt"] || "Equipamentos que movem o mundo";
  const C1 = cfg["color_primary"] || "#1B3F6E";
  const C2 = cfg["color_secondary"] || "#E8641E";

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
          {assetUrl(cfg["logo"]) ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img src={assetUrl(cfg["logo"])} alt="LEGA.PT" style={s({ height: 36, objectFit: "contain" })} />
          ) : (
            <span style={s({ fontWeight: 800, fontSize: 22, letterSpacing: "-0.5px" })}>
              <span style={s({ color: C2 })}>LEGA</span>.PT
            </span>
          )}
          <div style={s({ display: "flex", gap: 8, marginInlineStart: 24 })}>
            {["nav_home","nav_catalogue","nav_contact"].map(k => (
              <a key={k} href={`#${k.split("_")[1]}`}
                style={s({ color: "rgba(255,255,255,0.8)", textDecoration: "none", fontSize: 14, padding: "6px 12px", borderRadius: 6, transition: "background 0.15s" })}>
                {T(k)}
              </a>
            ))}
            <button onClick={openDocs} style={s({ color: docsView ? "#fff" : "rgba(255,255,255,0.8)", background: docsView ? C2 : "rgba(255,255,255,0.12)", border: "none", fontSize: 14, padding: "6px 12px", borderRadius: 6, cursor: "pointer", fontWeight: docsView ? 700 : 400 })}>
              {client ? "📄 Docs" : "📄 Documentation"}
            </button>
            {client && (
              <span style={s({ color: "rgba(255,255,255,0.6)", fontSize: 12, marginInlineStart: 4 })}>
                {client.name || client.email}
                <button onClick={() => { setClient(null); localStorage.removeItem("lega_client"); setDocsView(false); }}
                  style={s({ background: "none", border: "none", color: "rgba(255,255,255,0.5)", cursor: "pointer", fontSize: 11, marginInlineStart: 6 })}>✕</button>
              </span>
            )}
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
        background: `linear-gradient(rgba(0,0,0,0.45) 0%, rgba(0,0,0,0.25) 100%), url('${assetUrl(cfg["hero"]) || "https://images.unsplash.com/photo-1747004175907-e64576ba2e22?w=1600&q=80"}') center/cover no-repeat`,
        color: "#fff", padding: "100px 24px 80px", textAlign: "center",
        minHeight: 480, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
      })}>
        <h1 style={s({ fontSize: "clamp(28px, 5vw, 52px)", fontWeight: 800, margin: "0 0 16px", lineHeight: 1.15, maxWidth: 700 })}>
          {cfg["site_name"] || "LEGA.PT"}
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
        <p style={s({ color: "#64748b", marginBottom: 28 })}>
          {products.length < total
            ? `${products.length} / ${total} annonces`
            : `${total} annonces disponibles`}
        </p>

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
            <button onClick={() => fetchProducts(0, false)}
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
          <>
            <div style={s({ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 20 })}>
              {products.map(p => (
                <ProductCard key={p.id} product={p} t={T} c1={C1} c2={C2}
                  onClick={() => setSelectedProduct(p)} />
              ))}
            </div>
            {hasMore && (
              <div style={s({ textAlign: "center", marginTop: 32 })}>
                <button onClick={() => fetchProducts(prodOffset, true)}
                  style={s({ padding: "12px 40px", background: C1, color: "#fff", border: "none",
                    borderRadius: 8, fontWeight: 700, fontSize: 15, cursor: "pointer" })}>
                  {T("load_more") || "Charger plus"} ({total - products.length})
                </button>
              </div>
            )}
          </>
        )}
      </section>

      {/* ── DOCUMENTATION ───────────────────────────────────────────────── */}
      {docsView && client && (
        <section id="docs" style={s({ maxWidth: 1200, margin: "0 auto", padding: "60px 24px" })}>
          <h2 style={s({ fontSize: 28, fontWeight: 700, color: C1, marginBottom: 8 })}>Documentation technique</h2>
          <p style={s({ color: "#64748b", marginBottom: 28 })}>Connecté : {client.name || client.email}</p>
          <div style={s({ display: "grid", gridTemplateColumns: "280px 1fr", gap: 24, minHeight: 500 })}>
            {/* Arborescence */}
            <div style={s({ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 12, padding: 16, overflowY: "auto" })}>
              <div style={s({ fontWeight: 700, fontSize: 13, color: C1, marginBottom: 12, textTransform: "uppercase", letterSpacing: "0.06em" })}>Documents</div>
              <DocTree nodes={docsTree} onSelect={loadDocContent} selected={selectedDoc} c2={C2} />
            </div>
            {/* Visionneuse */}
            <div style={s({ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 12, padding: 24, overflowY: "auto" })}>
              {!selectedDoc && <div style={s({ color: "#94a3b8", textAlign: "center", paddingTop: 80, fontSize: 15 })}>Sélectionnez un document dans l&apos;arborescence</div>}
              {selectedDoc && !docContent && <div style={s({ color: "#94a3b8", textAlign: "center", paddingTop: 80 })}>Chargement…</div>}
              {docContent && (
                <>
                  <div style={s({ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20, flexWrap: "wrap", gap: 8 })}>
                    <h3 style={s({ margin: 0, fontSize: 18, fontWeight: 700, color: C1 })}>{docContent.name}</h3>
                    <button onClick={() => { setDlReqOpen(true); setDlReqSent(false); }}
                      style={s({ background: C2, color: "#fff", border: "none", padding: "8px 18px", borderRadius: 8, fontWeight: 700, cursor: "pointer", fontSize: 13 })}>
                      Demander le téléchargement
                    </button>
                  </div>
                  {docContent.type === "text" && docContent.content && (
                    <pre style={s({ whiteSpace: "pre-wrap", fontFamily: "inherit", fontSize: 14, lineHeight: 1.7, color: "#334155", margin: 0 })}>{docContent.content}</pre>
                  )}
                  {docContent.type === "pdf" && (
                    <div style={s({ background: "#f1f5f9", borderRadius: 8, padding: 24, textAlign: "center", color: "#475569" })}>
                      <div style={s({ fontSize: 48, marginBottom: 12 })}>📄</div>
                      <p>Fichier PDF ({docContent.size ? `${Math.round(docContent.size/1024)} Ko` : ""})</p>
                      <p style={s({ fontSize: 13 })}>Cliquez sur &quot;Demander le téléchargement&quot; pour recevoir ce document.</p>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </section>
      )}
      {!docsView && (
        <section style={s({ background: "#f1f5f9", padding: "40px 24px", textAlign: "center" })}>
          <p style={s({ color: "#475569", fontSize: 15, margin: "0 0 16px" })}>Accédez à notre documentation technique complète (manuels, fiches machines, réglementation)</p>
          <button onClick={openDocs} style={s({ background: C1, color: "#fff", border: "none", padding: "12px 28px", borderRadius: 8, fontWeight: 700, cursor: "pointer" })}>
            {client ? "Voir la documentation" : "Se connecter pour accéder aux docs"}
          </button>
        </section>
      )}

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
            {quoteProductTitle && (
              <div style={s({ background: "#eff6ff", border: "1px solid #bfdbfe", borderRadius: 8, padding: "10px 14px", fontSize: 14, color: "#1e40af", display: "flex", justifyContent: "space-between", alignItems: "center" })}>
                <span>📋 <strong>{T("quote_for")} :</strong> {quoteProductTitle}</span>
                <button onClick={() => { setQuoteProductId(null); setQuoteProductTitle(null); setContactForm(prev => ({ ...prev, message: "" })); }}
                  style={s({ background: "none", border: "none", cursor: "pointer", color: "#64748b", fontSize: 16 })}>✕</button>
              </div>
            )}
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
        <strong style={s({ color: "#fff" })}>LEGA.PT</strong> © {new Date().getFullYear()} — {T("footer_rights")}
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
            <span style={s({ fontWeight: 700, fontSize: 14 })}>Léa — LEGA.PT</span>
            <div style={s({ display: "flex", gap: 8, alignItems: "center" })}>
              <button onClick={() => {
                if (!audioCtxRef.current) audioCtxRef.current = new AudioContext();
                setTtsEnabled(v => !v);
              }}
                title={ttsEnabled ? "Couper le son" : "Activer le son"}
                style={s({ background: ttsEnabled ? "rgba(255,255,255,0.25)" : "rgba(255,255,255,0.1)", border: "none", color: "#fff", cursor: "pointer", fontSize: 15, borderRadius: 6, padding: "3px 7px" })}>
                {ttsEnabled ? "🔊" : "🔇"}
              </button>
              <button onClick={() => setChatOpen(false)}
                style={s({ background: "none", border: "none", color: "#fff", cursor: "pointer", fontSize: 18 })}>✕</button>
            </div>
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
          {/* ── Indicateur Léa ── */}
          <style>{`
            @keyframes lea-dot{0%,80%,100%{opacity:.2;transform:scale(.8)}40%{opacity:1;transform:scale(1)}}
            @keyframes lea-spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}
            @keyframes lea-fade{from{opacity:1}to{opacity:0}}
            .lea-dot{display:inline-block;width:6px;height:6px;border-radius:50%;background:#E8641E;margin:0 2px;animation:lea-dot 1.4s ease-in-out infinite}
            .lea-dot:nth-child(2){animation-delay:.2s}.lea-dot:nth-child(3){animation-delay:.4s}
            .lea-spin{display:inline-block;animation:lea-spin 1s linear infinite}
            .lea-fade{animation:lea-fade 350ms ease forwards}
          `}</style>
          {leaStatus && (
            <div className={leaStatus === "done" ? "lea-fade" : ""}
              style={s({ padding:"6px 12px", borderTop:"1px solid #f1f5f9",
                display:"flex", alignItems:"center", gap:8, fontSize:11, color:"#94a3b8",
                background:"#fafafa", minHeight:30 })}>
              {leaStatus === "waiting" ? (
                <>
                  <span className="lea-dot"/><span className="lea-dot"/><span className="lea-dot"/>
                  <span style={s({marginLeft:4})}>Léa reçoit votre message...</span>
                </>
              ) : (
                <>
                  <span className="lea-spin" style={s({fontSize:13})}>⚙️</span>
                  <span>{leaThinkText || "Léa rédige sa réponse..."}</span>
                </>
              )}
            </div>
          )}

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
          onQuote={() => {
            setQuoteProductId(selectedProduct.id);
            setQuoteProductTitle(selectedProduct.title);
            setContactForm(prev => ({ ...prev, message: `${T("quote_ref_prefix")} ${selectedProduct.title} (${selectedProduct.year || ""}${selectedProduct.hours ? ` — ${selectedProduct.hours.toLocaleString()}h` : ""})` }));
            setSelectedProduct(null);
            setTimeout(() => document.getElementById("contact")?.scrollIntoView({ behavior: "smooth" }), 100);
          }} />
      )}

      {/* ── MODAL LOGIN CLIENT ──────────────────────────────────────────── */}
      {loginOpen && (
        <div style={s({ position:"fixed",inset:0,background:"rgba(0,0,0,0.6)",zIndex:400,display:"flex",alignItems:"center",justifyContent:"center",padding:16 })} onClick={() => setLoginOpen(false)}>
          <div style={s({ background:"#fff",borderRadius:16,padding:32,maxWidth:400,width:"100%",boxShadow:"0 8px 40px rgba(0,0,0,0.2)" })} onClick={e => e.stopPropagation()}>
            <h3 style={s({ margin:"0 0 4px",fontSize:20,fontWeight:700,color:C1 })}>{loginMode==="login" ? "Connexion" : "Créer un compte"}</h3>
            <p style={s({ color:"#64748b",fontSize:13,margin:"0 0 20px" })}>Accès à la documentation technique LEGA</p>
            {loginMode==="register" && <>
              <input placeholder="Nom complet" value={loginForm.name} onChange={e=>setLoginForm(f=>({...f,name:e.target.value}))} style={s({width:"100%",padding:"10px 12px",border:"1px solid #e2e8f0",borderRadius:8,fontSize:14,marginBottom:10,boxSizing:"border-box"})} />
              <input placeholder="Société" value={loginForm.company} onChange={e=>setLoginForm(f=>({...f,company:e.target.value}))} style={s({width:"100%",padding:"10px 12px",border:"1px solid #e2e8f0",borderRadius:8,fontSize:14,marginBottom:10,boxSizing:"border-box"})} />
            </>}
            <input type="email" placeholder="Email" value={loginForm.email} onChange={e=>setLoginForm(f=>({...f,email:e.target.value}))} style={s({width:"100%",padding:"10px 12px",border:"1px solid #e2e8f0",borderRadius:8,fontSize:14,marginBottom:10,boxSizing:"border-box"})} />
            <input type="password" placeholder="Mot de passe" value={loginForm.password} onChange={e=>setLoginForm(f=>({...f,password:e.target.value}))} onKeyDown={e=>e.key==="Enter"&&(loginMode==="login"?loginClient():registerClient())} style={s({width:"100%",padding:"10px 12px",border:"1px solid #e2e8f0",borderRadius:8,fontSize:14,marginBottom:10,boxSizing:"border-box"})} />
            {loginError && <p style={s({color:"#ef4444",fontSize:13,margin:"0 0 10px"})}>{loginError}</p>}
            <button onClick={loginMode==="login"?loginClient:registerClient} style={s({width:"100%",padding:"12px",background:C1,color:"#fff",border:"none",borderRadius:8,fontWeight:700,fontSize:15,cursor:"pointer",marginBottom:12})}>
              {loginMode==="login" ? "Se connecter" : "Créer le compte"}
            </button>
            <p style={s({textAlign:"center",fontSize:13,color:"#64748b",margin:0})}>
              {loginMode==="login" ? "Pas encore de compte ? " : "Déjà un compte ? "}
              <button onClick={()=>{setLoginMode(loginMode==="login"?"register":"login");setLoginError("");}} style={s({background:"none",border:"none",color:C2,cursor:"pointer",fontWeight:700,fontSize:13})}>
                {loginMode==="login" ? "Créer un compte" : "Se connecter"}
              </button>
            </p>
          </div>
        </div>
      )}

      {/* ── MODAL DEMANDE TÉLÉCHARGEMENT ─────────────────────────────────── */}
      {dlReqOpen && (
        <div style={s({ position:"fixed",inset:0,background:"rgba(0,0,0,0.6)",zIndex:400,display:"flex",alignItems:"center",justifyContent:"center",padding:16 })} onClick={() => setDlReqOpen(false)}>
          <div style={s({ background:"#fff",borderRadius:16,padding:32,maxWidth:440,width:"100%",boxShadow:"0 8px 40px rgba(0,0,0,0.2)" })} onClick={e => e.stopPropagation()}>
            {dlReqSent ? (
              <div style={s({textAlign:"center",padding:"20px 0"})}>
                <div style={s({fontSize:48,marginBottom:12})}>✅</div>
                <h3 style={s({color:C1,margin:"0 0 8px"})}>Demande envoyée</h3>
                <p style={s({color:"#64748b",fontSize:14})}>Notre équipe examinera votre demande et vous contactera sous 24h.</p>
                <button onClick={()=>setDlReqOpen(false)} style={s({marginTop:16,padding:"10px 24px",background:C1,color:"#fff",border:"none",borderRadius:8,fontWeight:700,cursor:"pointer"})}>Fermer</button>
              </div>
            ) : (
              <>
                <h3 style={s({margin:"0 0 4px",fontSize:18,fontWeight:700,color:C1})}>Demander le téléchargement</h3>
                <p style={s({color:"#64748b",fontSize:13,margin:"0 0 20px"})}>{selectedDoc?.name}</p>
                <input placeholder="Nom complet *" value={dlReqForm.client_name} onChange={e=>setDlReqForm(f=>({...f,client_name:e.target.value}))} style={s({width:"100%",padding:"10px 12px",border:"1px solid #e2e8f0",borderRadius:8,fontSize:14,marginBottom:10,boxSizing:"border-box"})} />
                <input type="email" placeholder="Email *" value={dlReqForm.client_email} onChange={e=>setDlReqForm(f=>({...f,client_email:e.target.value}))} style={s({width:"100%",padding:"10px 12px",border:"1px solid #e2e8f0",borderRadius:8,fontSize:14,marginBottom:10,boxSizing:"border-box"})} />
                <input placeholder="Société" value={dlReqForm.client_company} onChange={e=>setDlReqForm(f=>({...f,client_company:e.target.value}))} style={s({width:"100%",padding:"10px 12px",border:"1px solid #e2e8f0",borderRadius:8,fontSize:14,marginBottom:10,boxSizing:"border-box"})} />
                <textarea placeholder="Motif de la demande" value={dlReqForm.motif} onChange={e=>setDlReqForm(f=>({...f,motif:e.target.value}))} rows={3} style={s({width:"100%",padding:"10px 12px",border:"1px solid #e2e8f0",borderRadius:8,fontSize:14,marginBottom:16,resize:"vertical",boxSizing:"border-box"})} />
                <div style={s({display:"flex",gap:8})}>
                  <button onClick={()=>setDlReqOpen(false)} style={s({flex:1,padding:"11px",border:"1px solid #e2e8f0",borderRadius:8,background:"#fff",cursor:"pointer",fontWeight:600})}>Annuler</button>
                  <button onClick={submitDlReq} style={s({flex:2,padding:"11px",background:C2,color:"#fff",border:"none",borderRadius:8,fontWeight:700,cursor:"pointer"})}>Envoyer la demande</button>
                </div>
              </>
            )}
          </div>
        </div>
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
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
          <div style={{ fontSize: 11, color: c2, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em" }}>
            {t(`cat_${p.category}`) || p.category}
          </div>
          {p.reference && <span style={{ fontSize: 10, fontFamily: "monospace", color: "#94a3b8", background: "#f1f5f9", padding: "2px 6px", borderRadius: 4 }}>{p.reference}</span>}
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

// ── DocTree ──────────────────────────────────────────────────────────────────
function DocTree({ nodes, onSelect, selected, c2, depth=0 }:
  { nodes: DocNode[]; onSelect:(n:DocNode)=>void; selected:DocNode|null; c2:string; depth?:number }) {
  return (
    <div style={{ marginLeft: depth*12 }}>
      {nodes.map(n => (
        <div key={n.path}>
          {n.type === "directory" ? (
            <>
              <div style={{ fontSize:13, fontWeight:600, color:"#475569", padding:"5px 4px", display:"flex", alignItems:"center", gap:6 }}>
                <span>&#128193;</span>{n.name}
              </div>
              {n.children && n.children.length > 0 && (
                <DocTree nodes={n.children} onSelect={onSelect} selected={selected} c2={c2} depth={depth+1} />
              )}
            </>
          ) : (
            <button onClick={() => onSelect(n)} style={{
              display:"block", width:"100%", textAlign:"left", padding:"5px 8px",
              border:"none", borderRadius:6, cursor:"pointer", fontSize:13,
              background: selected?.path===n.path ? c2 : "transparent",
              color: selected?.path===n.path ? "#fff" : "#334155",
              marginBottom:2,
            }}>
              {n.ext===".pdf" ? "\uD83D\uDCC4" : "\uD83D\uDCDD"} {n.name}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
