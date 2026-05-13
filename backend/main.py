import asyncpg
import asyncio
import hashlib
import json
import logging
import os
import re
import secrets
import smtplib
import uuid
from datetime import datetime, timedelta, timezone
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from pathlib import Path

import aiofiles
import httpx
import jwt
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

UPLOAD_DIR = Path("/app/uploads")
UPLOAD_DIR.mkdir(exist_ok=True)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

DB_URL = os.getenv("DATABASE_URL", "postgresql://bvi_user:BviSecure2026!@bvi-db:5432/bvi_db")
BVI_API_URL = os.getenv("BVI_API_URL", "http://bvi-api-1:8000")

DOCS_PATH = Path(os.getenv("DOCS_BASE_PATH", "/app/docs"))
SITE_BASE_URL = os.getenv("SITE_BASE_URL", "http://76.13.141.221:8003")
TELEGRAM_BOT_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN", "")
TELEGRAM_CHAT_ID = os.getenv("TELEGRAM_CHAT_ID", "")
SMTP_FROM = os.getenv("SMTP_FROM", "")
SMTP_HOST = os.getenv("SMTP_HOST", "smtp.gmail.com")
SMTP_PORT = int(os.getenv("SMTP_PORT", "587"))
SMTP_PASSWORD = os.getenv("SMTP_PASSWORD", "")
JWT_SECRET_CLIENT = os.getenv("JWT_SECRET_CLIENT", "lega-client-secret-2026")

app = FastAPI(title="LEGA Site API", version="1.0.0")
app.mount("/uploads", StaticFiles(directory="/app/uploads"), name="uploads")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


async def db_connect():
    return await asyncpg.connect(DB_URL)


# ── Notifications ─────────────────────────────────────────────────────────────

async def notify_telegram(text: str) -> None:
    if not TELEGRAM_BOT_TOKEN:
        return
    try:
        url = f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendMessage"
        async with httpx.AsyncClient(timeout=10.0) as c:
            await c.post(url, json={"chat_id": TELEGRAM_CHAT_ID, "text": text, "parse_mode": "Markdown"})
    except Exception as e:
        logger.warning(f"Telegram notify error: {e}")


def _smtp_send(to_addr: str, subject: str, html_body: str) -> None:
    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = SMTP_FROM
    msg["To"] = to_addr
    msg.attach(MIMEText(html_body, "html", "utf-8"))
    with smtplib.SMTP(SMTP_HOST, SMTP_PORT, timeout=20) as s:
        s.ehlo(); s.starttls(); s.login(SMTP_FROM, SMTP_PASSWORD)
        s.sendmail(SMTP_FROM, [to_addr], msg.as_string())


async def send_email(to_addr: str, subject: str, html_body: str) -> None:
    if not (SMTP_FROM and SMTP_PASSWORD):
        return
    loop = asyncio.get_event_loop()
    try:
        await loop.run_in_executor(None, _smtp_send, to_addr, subject, html_body)
    except Exception as e:
        logger.error(f"Email error to {to_addr}: {e}")


# ── Pydantic ──────────────────────────────────────────────────────────────────

class ProductCreate(BaseModel):
    title: str
    category: str = "machines_tp"
    brand: str = None
    model: str = None
    year: int = None
    hours: int = None
    price: float = None
    currency: str = "EUR"
    location: str = None
    description: str = None
    specs: dict = {}
    images: list = []
    status: str = "available"
    source_url: str = None

class ConfigUpdate(BaseModel):
    value: str
    updated_by: str = "manual"

class TranslationUpdate(BaseModel):
    lang: str
    key: str
    value: str

class TranslationsBulkUpdate(BaseModel):
    lang: str
    translations: dict  # {key: value}

class SectionUpdate(BaseModel):
    enabled: bool = None
    position: int = None
    config: dict = None


# ── Health ────────────────────────────────────────────────────────────────────

@app.get("/api/site/health")
async def health():
    return {"status": "ok", "service": "lega-site-api", "version": "1.0.0"}


# ── Config ────────────────────────────────────────────────────────────────────

@app.get("/api/site/config")
async def get_config():
    conn = await db_connect()
    try:
        rows = await conn.fetch("SELECT key, value, value_json, updated_at, updated_by FROM site_config ORDER BY key")
        return [dict(r) for r in rows]
    finally:
        await conn.close()

@app.get("/api/site/config/{key}")
async def get_config_key(key: str):
    conn = await db_connect()
    try:
        row = await conn.fetchrow("SELECT key, value, value_json FROM site_config WHERE key=$1", key)
        if not row:
            raise HTTPException(status_code=404, detail="Clé introuvable")
        return dict(row)
    finally:
        await conn.close()

@app.put("/api/site/config/{key}")
async def update_config(key: str, body: ConfigUpdate):
    conn = await db_connect()
    try:
        await conn.execute(
            "INSERT INTO site_config (key, value, updated_by) VALUES ($1, $2, $3) "
            "ON CONFLICT (key) DO UPDATE SET value=$2, updated_by=$3, updated_at=NOW()",
            key, body.value, body.updated_by
        )
        await conn.execute(
            "INSERT INTO site_audit_log (action, field, new_value, done_by) VALUES ($1,$2,$3,$4)",
            "config_update", key, body.value, body.updated_by
        )
        return {"ok": True, "key": key, "value": body.value}
    finally:
        await conn.close()


# ── Sections ──────────────────────────────────────────────────────────────────

@app.get("/api/site/sections")
async def get_sections():
    conn = await db_connect()
    try:
        rows = await conn.fetch("SELECT * FROM site_sections ORDER BY position")
        return [dict(r) for r in rows]
    finally:
        await conn.close()

@app.patch("/api/site/sections/{name}")
async def update_section(name: str, body: SectionUpdate):
    conn = await db_connect()
    try:
        updates = []
        vals = []
        i = 1
        if body.enabled is not None:
            updates.append(f"enabled=${i}"); vals.append(body.enabled); i += 1
        if body.position is not None:
            updates.append(f"position=${i}"); vals.append(body.position); i += 1
        if body.config is not None:
            updates.append(f"config=${i}"); vals.append(json.dumps(body.config)); i += 1
        if not updates:
            raise HTTPException(status_code=400, detail="Rien à modifier")
        vals.append(name)
        await conn.execute(
            f"UPDATE site_sections SET {', '.join(updates)} WHERE name=${i}", *vals
        )
        return {"ok": True}
    finally:
        await conn.close()


# ── Translations ──────────────────────────────────────────────────────────────

@app.get("/api/site/translations/{lang}")
async def get_translations(lang: str):
    conn = await db_connect()
    try:
        rows = await conn.fetch("SELECT key, value FROM site_translations WHERE lang=$1", lang)
        return {r["key"]: r["value"] for r in rows}
    finally:
        await conn.close()

@app.put("/api/site/translations")
async def upsert_translation(body: TranslationUpdate):
    conn = await db_connect()
    try:
        await conn.execute(
            "INSERT INTO site_translations (lang, key, value) VALUES ($1,$2,$3) "
            "ON CONFLICT (lang, key) DO UPDATE SET value=$3, updated_at=NOW()",
            body.lang, body.key, body.value
        )
        return {"ok": True}
    finally:
        await conn.close()

@app.put("/api/site/translations/bulk")
async def upsert_translations_bulk(body: TranslationsBulkUpdate):
    conn = await db_connect()
    try:
        async with conn.transaction():
            for key, value in body.translations.items():
                await conn.execute(
                    "INSERT INTO site_translations (lang, key, value) VALUES ($1,$2,$3) "
                    "ON CONFLICT (lang, key) DO UPDATE SET value=$3, updated_at=NOW()",
                    body.lang, key, str(value)
                )
        return {"ok": True, "updated": len(body.translations)}
    finally:
        await conn.close()


# ── Produits ──────────────────────────────────────────────────────────────────

@app.get("/api/site/products")
async def get_products(category: str = None, status: str = None, q: str = None, limit: int = 50, offset: int = 0):
    conn = await db_connect()
    try:
        where = []
        vals = []
        i = 1
        if category:
            where.append(f"category=${i}"); vals.append(category); i += 1
        if status:
            where.append(f"status=${i}"); vals.append(status); i += 1
        if q:
            where.append(f"(title ILIKE ${i} OR brand ILIKE ${i+1} OR model ILIKE ${i+2})")
            vals.extend([f"%{q}%", f"%{q}%", f"%{q}%"]); i += 3
        clause = f"WHERE {' AND '.join(where)}" if where else ""
        count_vals = vals.copy()
        vals += [limit, offset]
        rows = await conn.fetch(
            f"SELECT * FROM site_products {clause} ORDER BY created_at DESC LIMIT ${i} OFFSET ${i+1}",
            *vals
        )
        total = await conn.fetchval(f"SELECT COUNT(*) FROM site_products {clause}", *count_vals)
        return {"total": total, "items": [dict(r) for r in rows]}
    finally:
        await conn.close()

@app.get("/api/site/products/{product_id}")
async def get_product(product_id: str):
    conn = await db_connect()
    try:
        row = await conn.fetchrow("SELECT * FROM site_products WHERE id=$1", uuid.UUID(product_id))
        if not row:
            raise HTTPException(status_code=404, detail="Produit introuvable")
        return dict(row)
    finally:
        await conn.close()

@app.post("/api/site/products")
async def create_product(p: ProductCreate):
    conn = await db_connect()
    try:
        row = await conn.fetchrow(
            """INSERT INTO site_products
               (title, category, brand, model, year, hours, price, currency,
                location, description, specs, images, status, source_url)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
               RETURNING id""",
            p.title, p.category, p.brand, p.model, p.year, p.hours, p.price,
            p.currency, p.location, p.description,
            json.dumps(p.specs), json.dumps(p.images), p.status, p.source_url
        )
        return {"id": str(row["id"])}
    finally:
        await conn.close()

@app.post("/api/site/products/{product_id}/upload")
async def upload_product_image(product_id: str, file: UploadFile = File(...)):
    ext = Path(file.filename).suffix.lower()
    if ext not in {".jpg", ".jpeg", ".png", ".webp"}:
        raise HTTPException(status_code=400, detail="Format non supporté")
    fname = f"{uuid.uuid4()}{ext}"
    fpath = UPLOAD_DIR / fname
    async with aiofiles.open(fpath, "wb") as f:
        await f.write(await file.read())
    url = f"/uploads/{fname}"
    conn = await db_connect()
    try:
        row = await conn.fetchrow("SELECT images FROM site_products WHERE id=$1", uuid.UUID(product_id))
        if not row:
            raise HTTPException(status_code=404, detail="Produit introuvable")
        imgs = json.loads(row["images"] or "[]")
        imgs.append(url)
        await conn.execute("UPDATE site_products SET images=$1, updated_at=NOW() WHERE id=$2",
                           json.dumps(imgs), uuid.UUID(product_id))
    finally:
        await conn.close()
    return {"url": url}

@app.put("/api/site/products/{product_id}")
async def update_product(product_id: str, p: ProductCreate):
    conn = await db_connect()
    try:
        await conn.execute(
            """UPDATE site_products SET title=$1, category=$2, brand=$3, model=$4,
               year=$5, hours=$6, price=$7, currency=$8, location=$9, description=$10,
               specs=$11, images=$12, status=$13, source_url=$14, updated_at=NOW()
               WHERE id=$15""",
            p.title, p.category, p.brand, p.model, p.year, p.hours, p.price,
            p.currency, p.location, p.description,
            json.dumps(p.specs), json.dumps(p.images), p.status, p.source_url,
            uuid.UUID(product_id)
        )
        return {"ok": True, "id": product_id}
    finally:
        await conn.close()

@app.delete("/api/site/products/{product_id}")
async def delete_product(product_id: str):
    conn = await db_connect()
    try:
        await conn.execute(
            "UPDATE site_products SET status='archived', updated_at=NOW() WHERE id=$1",
            uuid.UUID(product_id)
        )
        return {"ok": True}
    finally:
        await conn.close()

@app.patch("/api/site/products/{product_id}/status")
async def patch_product_status(product_id: str, body: dict):
    valid = {"available", "sold", "reserved", "new", "archived"}
    status = body.get("status")
    if status not in valid:
        raise HTTPException(status_code=400, detail=f"Status invalide. Valeurs: {valid}")
    conn = await db_connect()
    try:
        await conn.execute(
            "UPDATE site_products SET status=$1, updated_at=NOW() WHERE id=$2",
            status, uuid.UUID(product_id)
        )
        return {"ok": True, "status": status}
    finally:
        await conn.close()


# ── Config bulk + upload ──────────────────────────────────────────────────────

@app.post("/api/site/config/bulk")
async def bulk_update_config(body: dict):
    """body = {"key1": "val1", "key2": "val2", ...}"""
    conn = await db_connect()
    try:
        for key, value in body.items():
            await conn.execute(
                "INSERT INTO site_config (key, value, updated_by) VALUES ($1,$2,'dashboard') "
                "ON CONFLICT (key) DO UPDATE SET value=$2, updated_by='dashboard', updated_at=NOW()",
                key, str(value)
            )
        return {"ok": True, "updated": len(body)}
    finally:
        await conn.close()

@app.post("/api/site/upload")
async def upload_site_asset(file: UploadFile = File(...), asset_type: str = "logo"):
    """Upload logo or hero image — stores URL in site_config."""
    ext = Path(file.filename).suffix.lower()
    if ext not in {".jpg", ".jpeg", ".png", ".webp", ".svg"}:
        raise HTTPException(400, "Format non supporté (jpg/png/webp/svg)")
    fname = f"{asset_type}_{uuid.uuid4().hex[:8]}{ext}"
    fpath = UPLOAD_DIR / fname
    async with aiofiles.open(fpath, "wb") as f:
        await f.write(await file.read())
    url = f"/uploads/{fname}"
    conn = await db_connect()
    try:
        await conn.execute(
            "INSERT INTO site_config (key, value, updated_by) VALUES ($1,$2,'dashboard') "
            "ON CONFLICT (key) DO UPDATE SET value=$2, updated_at=NOW()",
            asset_type, url
        )
    finally:
        await conn.close()
    return {"ok": True, "url": url, "asset_type": asset_type}

# ── Audit log ─────────────────────────────────────────────────────────────────

@app.get("/api/site/audit")
async def get_audit(limit: int = 50):
    conn = await db_connect()
    try:
        rows = await conn.fetch(
            "SELECT * FROM site_audit_log ORDER BY created_at DESC LIMIT $1", limit
        )
        return [dict(r) for r in rows]
    finally:
        await conn.close()


# ── Import tob.pt (manuel) ────────────────────────────────────────────────────

@app.post("/api/site/import/tob")
async def import_from_tob(body: dict = {}):
    """Import manuel tob.pt — délègue à _scrape_tob_once."""
    max_items = body.get("max_items", 200)
    return await _scrape_tob_once(max_items=max_items)

# ── Contact / devis ───────────────────────────────────────────────────────────

class ContactRequest(BaseModel):
    name: str
    email: str
    phone: str = None
    lang: str = "fr"
    product_id: str = None
    message: str = ""

@app.post("/api/site/contact")
async def submit_contact(req: ContactRequest):
    conn = await db_connect()
    try:
        await conn.execute(
            "INSERT INTO site_audit_log (action, field, new_value, done_by) VALUES ($1,$2,$3,$4)",
            "contact_form", req.email,
            f"name={req.name} | phone={req.phone} | product={req.product_id} | msg={req.message[:200]}",
            "visitor"
        )
    finally:
        await conn.close()
    return {"ok": True, "message": "Demande enregistrée"}


# ── Cron scraper tob.pt ───────────────────────────────────────────────────────

TOB_SCRAPE_INTERVAL_H = int(os.getenv("TOB_SCRAPE_INTERVAL_H", "24"))

async def _scrape_tob_once(max_items: int = 200) -> dict:
    """Scrape tob.pt et insère les nouveaux produits. Retourne un résumé."""
    listing_url = "https://www.tob.pt/pt/machinery.aspx"
    base_url = "https://www.tob.pt"
    inserted = []
    errors = []

    async with httpx.AsyncClient(
        timeout=30.0,
        follow_redirects=True,
        headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"}
    ) as client:
        try:
            resp = await client.get(listing_url)
            if resp.status_code != 200:
                return {"ok": False, "inserted": 0, "errors": [f"tob.pt HTTP {resp.status_code}"]}
            html = resp.text
        except Exception as e:
            return {"ok": False, "inserted": 0, "errors": [f"Connexion tob.pt: {str(e)[:100]}"]}

        all_ids = re.findall(r'Detail\.aspx\?MaquinaID=(\d+)', html)
        seen_ids: dict = {}
        for mid in all_ids:
            seen_ids.setdefault(mid, None)
        maquina_ids = list(seen_ids.keys())

        brands = re.findall(r'class="post-title">([^<]+)</h2>', html)
        models = re.findall(r'class="post-meta">\s*Modelo:\s*([^<\n]+?)(?:\s*$|\s*<)', html, re.MULTILINE)
        years_raw = re.findall(r'class="meta-spacer">/</span>\s*(\d{4})', html)

        conn = await db_connect()
        try:
            seen = set()
            for i, mid in enumerate(maquina_ids[:max_items]):
                if mid in seen:
                    continue
                seen.add(mid)

                brand = brands[i].strip() if i < len(brands) else ""
                model = models[i].strip() if i < len(models) else ""
                year = None
                if i < len(years_raw):
                    try:
                        y = int(years_raw[i])
                        if 1970 <= y <= 2030:
                            year = y
                    except ValueError:
                        pass

                title = f"{brand} {model}".strip() or f"Machine tob.pt #{mid}"
                source_url = f"{base_url}/pt/Detail.aspx?MaquinaID={mid}"
                image_url = f"{base_url}/Handler.ashx?MaquinaID={mid}&Size=S"

                existing = await conn.fetchval(
                    "SELECT id FROM site_products WHERE source_url=$1", source_url
                )
                if existing:
                    continue

                # Générer référence unique : prefix 3 lettres + numéro séquentiel
                prefix = (brand[:3].upper() if brand else "MAC")
                total_count = await conn.fetchval("SELECT COUNT(*) FROM site_products") or 0
                ref_candidate = f"{prefix}-{str(total_count + 1).zfill(3)}"
                while await conn.fetchval("SELECT 1 FROM site_products WHERE reference=$1", ref_candidate):
                    total_count += 1
                    ref_candidate = f"{prefix}-{str(total_count + 1).zfill(3)}"

                pid = await conn.fetchval(
                    """INSERT INTO site_products
                       (title, category, brand, model, year, currency, status,
                        source_url, images, description, reference)
                       VALUES ($1,'machines_tp',$2,$3,$4,'EUR','available',$5,$6,$7,$8)
                       RETURNING id""",
                    title, brand or None, model or None, year,
                    source_url,
                    json.dumps([image_url]),
                    f"Importé depuis tob.pt (MaquinaID={mid}). Prix sur demande.",
                    ref_candidate,
                )
                inserted.append({"id": str(pid), "title": title, "reference": ref_candidate})
                logger.info(f"[tob-cron] nouveau: {title} ({mid})")
        finally:
            await conn.close()

    return {"ok": True, "inserted": len(inserted), "errors": errors}


async def tob_scraper_cron():
    """Lance un scrape tob.pt toutes les TOB_SCRAPE_INTERVAL_H heures."""
    logger.info(f"[tob-cron] démarré — intervalle {TOB_SCRAPE_INTERVAL_H}h")
    while True:
        try:
            result = await _scrape_tob_once()
            logger.info(f"[tob-cron] scrape terminé — {result.get('inserted', 0)} nouveaux produits")
        except Exception as e:
            logger.error(f"[tob-cron] erreur: {e}")
        await asyncio.sleep(TOB_SCRAPE_INTERVAL_H * 3600)


@app.post("/api/site/scraper/run")
async def run_scraper_now(body: dict = {}):
    """Déclenche un scrape immédiat de tob.pt (sans attendre le cron)."""
    max_items = body.get("max_items", 200)
    result = await _scrape_tob_once(max_items=max_items)
    return result


# ── Documentation — liste arborescente ───────────────────────────────────────

def _build_docs_tree(base: Path, current: Path) -> dict:
    node: dict = {"name": current.name, "path": str(current.relative_to(base)), "type": "directory", "children": []}
    for item in sorted(current.iterdir()):
        if item.name.startswith("."):
            continue
        if item.is_dir():
            node["children"].append(_build_docs_tree(base, item))
        elif item.suffix.lower() in {".pdf", ".md", ".txt"}:
            node["children"].append({
                "name": item.name,
                "path": str(item.relative_to(base)),
                "type": "file",
                "ext": item.suffix.lower(),
            })
    return node


@app.get("/api/site/docs")
async def get_docs_list():
    if not DOCS_PATH.exists():
        return {"tree": []}
    root = _build_docs_tree(DOCS_PATH, DOCS_PATH)
    return {"tree": root["children"]}


@app.get("/api/site/docs/content")
async def get_doc_content(path: str):
    safe = (DOCS_PATH / path.lstrip("/")).resolve()
    if not str(safe).startswith(str(DOCS_PATH.resolve())):
        raise HTTPException(400, "Chemin invalide")
    if not safe.exists():
        raise HTTPException(404, "Document introuvable")
    if safe.suffix.lower() == ".pdf":
        return {"type": "pdf", "name": safe.name, "size": safe.stat().st_size, "path": path}
    if safe.suffix.lower() in {".md", ".txt"}:
        content = safe.read_text(encoding="utf-8")
        return {"type": "text", "name": safe.name, "content": content, "path": path}
    raise HTTPException(400, "Format non supporté")


# ── Documentation — demandes de téléchargement ────────────────────────────────

class DocDownloadReq(BaseModel):
    doc_path: str
    client_name: str
    client_email: str
    client_company: str = None
    motif: str = None


@app.post("/api/site/docs/request")
async def create_doc_request(req: DocDownloadReq):
    conn = await db_connect()
    try:
        row = await conn.fetchrow(
            "INSERT INTO doc_download_requests (doc_path,client_name,client_email,client_company,motif) "
            "VALUES ($1,$2,$3,$4,$5) RETURNING id",
            req.doc_path, req.client_name, req.client_email, req.client_company, req.motif
        )
        rid = row["id"]
        await notify_telegram(
            f"📄 *Demande téléchargement doc #{rid}*\n"
            f"Fichier: `{req.doc_path}`\n"
            f"Client: {req.client_name} ({req.client_email})\n"
            f"Société: {req.client_company or 'N/A'}\n"
            f"Motif: {req.motif or 'N/A'}\n"
            f"Dashboard → http://76.13.141.221:3000"
        )
        await send_email(
            req.client_email,
            "LEGA.PT — Demande de téléchargement reçue",
            f"<p>Bonjour {req.client_name},</p>"
            f"<p>Votre demande de téléchargement pour <strong>{req.doc_path}</strong> a bien été reçue.</p>"
            f"<p>Notre équipe l'examinera et vous contactera sous 24h.</p>"
            f"<p>Cordialement,<br/><strong>L'équipe LEGA.PT</strong></p>"
        )
        return {"ok": True, "id": rid}
    finally:
        await conn.close()


@app.get("/api/site/docs/requests")
async def list_doc_requests(status: str = None):
    conn = await db_connect()
    try:
        if status:
            rows = await conn.fetch(
                "SELECT * FROM doc_download_requests WHERE status=$1 ORDER BY created_at DESC", status
            )
        else:
            rows = await conn.fetch("SELECT * FROM doc_download_requests ORDER BY created_at DESC")
        return [dict(r) for r in rows]
    finally:
        await conn.close()


@app.post("/api/site/docs/requests/{rid}/approve")
async def approve_doc_request(rid: int):
    conn = await db_connect()
    try:
        row = await conn.fetchrow("SELECT * FROM doc_download_requests WHERE id=$1", rid)
        if not row:
            raise HTTPException(404, "Demande introuvable")
        token = secrets.token_urlsafe(32)
        expires_at = datetime.now(timezone.utc) + timedelta(hours=24)
        await conn.execute(
            "UPDATE doc_download_requests SET status='approved', download_token=$1, "
            "token_expires_at=$2, reviewed_at=NOW() WHERE id=$3",
            token, expires_at, rid
        )
        dl_url = f"{SITE_BASE_URL}/api/site/docs/download/{token}"
        await send_email(
            row["client_email"],
            "LEGA.PT — Téléchargement approuvé",
            f"<p>Bonjour {row['client_name']},</p>"
            f"<p>Votre demande de téléchargement a été approuvée.</p>"
            f"<p><a href='{dl_url}' style='background:#1B3F6E;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:bold;'>Télécharger le document</a></p>"
            f"<p><em>Lien valable 24 heures.</em></p>"
            f"<p>Cordialement,<br/><strong>L'équipe LEGA.PT</strong></p>"
        )
        return {"ok": True, "token": token, "expires_at": expires_at.isoformat(), "download_url": dl_url}
    finally:
        await conn.close()


@app.post("/api/site/docs/requests/{rid}/reject")
async def reject_doc_request(rid: int, body: dict = {}):
    conn = await db_connect()
    try:
        row = await conn.fetchrow("SELECT * FROM doc_download_requests WHERE id=$1", rid)
        if not row:
            raise HTTPException(404, "Demande introuvable")
        await conn.execute(
            "UPDATE doc_download_requests SET status='rejected', reviewed_at=NOW() WHERE id=$1", rid
        )
        reason = body.get("reason", "")
        await send_email(
            row["client_email"],
            "LEGA.PT — Votre demande de téléchargement",
            f"<p>Bonjour {row['client_name']},</p>"
            f"<p>Nous ne sommes pas en mesure d'accéder à votre demande de téléchargement pour le moment.</p>"
            f"{f'<p>{reason}</p>' if reason else ''}"
            f"<p>N'hésitez pas à nous contacter directement pour plus d'informations.</p>"
            f"<p>Cordialement,<br/><strong>L'équipe LEGA.PT</strong></p>"
        )
        return {"ok": True}
    finally:
        await conn.close()


@app.get("/api/site/docs/download/{token}")
async def download_with_token(token: str):
    conn = await db_connect()
    try:
        row = await conn.fetchrow(
            "SELECT * FROM doc_download_requests WHERE download_token=$1 AND status='approved'", token
        )
        if not row:
            raise HTTPException(404, "Lien invalide ou expiré")
        if row["token_expires_at"] < datetime.now(timezone.utc):
            raise HTTPException(410, "Lien expiré")
        doc = (DOCS_PATH / row["doc_path"].lstrip("/")).resolve()
        if not str(doc).startswith(str(DOCS_PATH.resolve())):
            raise HTTPException(400, "Chemin invalide")
        if not doc.exists():
            raise HTTPException(404, "Fichier introuvable sur le serveur")
        return FileResponse(path=str(doc), filename=doc.name, media_type="application/octet-stream")
    finally:
        await conn.close()


# ── Auth clients vitrine ──────────────────────────────────────────────────────

@app.post("/api/site/auth/register")
async def register_client(body: dict):
    email = (body.get("email") or "").lower().strip()
    password = body.get("password") or ""
    name = body.get("name") or ""
    company = body.get("company") or ""
    lang = body.get("lang") or "fr"
    if not email or not password:
        raise HTTPException(400, "Email et mot de passe requis")
    pw_hash = hashlib.sha256(password.encode()).hexdigest()
    conn = await db_connect()
    try:
        try:
            row = await conn.fetchrow(
                "INSERT INTO site_clients (email,name,company,password_hash,lang) "
                "VALUES ($1,$2,$3,$4,$5) RETURNING id",
                email, name, company, pw_hash, lang
            )
        except Exception:
            raise HTTPException(409, "Email déjà utilisé")
        return {"ok": True, "id": str(row["id"])}
    finally:
        await conn.close()


@app.post("/api/site/auth/login")
async def login_client(body: dict):
    email = (body.get("email") or "").lower().strip()
    password = body.get("password") or ""
    pw_hash = hashlib.sha256(password.encode()).hexdigest()
    conn = await db_connect()
    try:
        row = await conn.fetchrow(
            "SELECT id,name,email,company,lang FROM site_clients "
            "WHERE email=$1 AND password_hash=$2",
            email, pw_hash
        )
        if not row:
            raise HTTPException(401, "Email ou mot de passe incorrect")
        token = jwt.encode(
            {"sub": str(row["id"]), "email": row["email"], "exp": datetime.now(timezone.utc) + timedelta(days=30)},
            JWT_SECRET_CLIENT, algorithm="HS256"
        )
        return {
            "ok": True, "token": token,
            "client": {"id": str(row["id"]), "name": row["name"], "email": row["email"],
                       "company": row["company"], "lang": row["lang"]},
        }
    finally:
        await conn.close()


@app.get("/api/site/auth/verify")
async def verify_client_token(token: str):
    try:
        payload = jwt.decode(token, JWT_SECRET_CLIENT, algorithms=["HS256"])
        return {"ok": True, "client_id": payload["sub"], "email": payload["email"]}
    except Exception:
        raise HTTPException(401, "Token invalide ou expiré")


@app.on_event("startup")
async def startup():
    asyncio.create_task(tob_scraper_cron())

    conn = await db_connect()
    try:
        await conn.execute("""
            CREATE TABLE IF NOT EXISTS hero_images (
                id         SERIAL PRIMARY KEY,
                client_id  TEXT DEFAULT 'lega',
                url        TEXT NOT NULL,
                alt_text   TEXT DEFAULT '',
                position   INTEGER DEFAULT 0,
                is_active  BOOLEAN DEFAULT true,
                created_at TIMESTAMPTZ DEFAULT NOW()
            )
        """)
        # Valeur par défaut intervalle carrousel
        await conn.execute(
            "INSERT INTO site_config (key, value, updated_by) VALUES ('hero_interval_ms','3000','system') ON CONFLICT (key) DO NOTHING"
        )
        # Migrer l'image hero existante si présente
        existing_hero = await conn.fetchval("SELECT value FROM site_config WHERE key='hero'")
        if existing_hero:
            count = await conn.fetchval('SELECT COUNT(*) FROM hero_images')
            if count == 0:
                await conn.execute(
                    "INSERT INTO hero_images (url, alt_text, position) VALUES (\$1,'Hero image',0)",
                    existing_hero,
                )
        await conn.close()
    except Exception as e:
        logger.warning(f'hero_images table init failed: {e}')
    logger.info("LEGA Site API started — cron scraper tob.pt actif")


# ── Hero Images ───────────────────────────────────────────────────────────────

import aiofiles as _aiofiles_hero  # déjà importé mais alias pour clarté
from pathlib import Path as _PathHero

HERO_UPLOAD_DIR = Path("/app/uploads/hero")
HERO_UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

@app.get("/api/site/hero-images")
async def get_hero_images():
    """Retourne la liste des images Hero actives triées par position + intervalle carrousel."""
    conn = await db_connect()
    try:
        rows = await conn.fetch(
            "SELECT id, url, alt_text, position FROM hero_images WHERE is_active=true ORDER BY position ASC"
        )
        cfg_row = await conn.fetchrow("SELECT value FROM site_config WHERE key='hero_interval_ms'")
        interval_ms = int(cfg_row["value"]) if cfg_row else 3000
        return {"images": [dict(r) for r in rows], "interval_ms": interval_ms}
    finally:
        await conn.close()


@app.post("/admin/hero-images")
async def add_hero_image(file: UploadFile = File(...), alt_text: str = ""):
    """Upload une image Hero."""
    ext = Path(file.filename or "").suffix.lower()
    if ext not in {".jpg", ".jpeg", ".png", ".webp"}:
        raise HTTPException(400, "Format non supporté (jpg/png/webp)")
    fname = f"hero_{uuid.uuid4().hex[:12]}{ext}"
    fpath = HERO_UPLOAD_DIR / fname
    async with aiofiles.open(fpath, "wb") as f:
        await f.write(await file.read())
    url = f"/uploads/hero/{fname}"
    conn = await db_connect()
    try:
        max_pos = await conn.fetchval("SELECT COALESCE(MAX(position),0) FROM hero_images") or 0
        row = await conn.fetchrow(
            "INSERT INTO hero_images (url, alt_text, position) VALUES ($1,$2,$3) RETURNING id, url, alt_text, position",
            url, alt_text, max_pos + 1,
        )
        return {"ok": True, **dict(row)}
    finally:
        await conn.close()


@app.put("/admin/hero-images/reorder")
async def reorder_hero_images(body: list):
    """Met à jour l'ordre. Body : [{id, position}, ...]"""
    conn = await db_connect()
    try:
        for item in body:
            await conn.execute("UPDATE hero_images SET position=$1 WHERE id=$2", item["position"], item["id"])
        return {"ok": True}
    finally:
        await conn.close()


@app.put("/admin/hero-images/{image_id}")
async def update_hero_image(image_id: int, body: dict):
    """Modifie alt_text ou is_active."""
    fields, params = [], []
    if "is_active" in body:
        fields.append(f"is_active=${len(params)+1}"); params.append(body["is_active"])
    if "alt_text" in body:
        fields.append(f"alt_text=${len(params)+1}"); params.append(body["alt_text"])
    if not fields:
        raise HTTPException(400, "Rien à modifier")
    params.append(image_id)
    conn = await db_connect()
    try:
        row = await conn.fetchrow(
            f"UPDATE hero_images SET {','.join(fields)} WHERE id=${len(params)} RETURNING id, is_active", *params
        )
        if not row:
            raise HTTPException(404, "Image introuvable")
        return {"ok": True, "id": row["id"], "is_active": row["is_active"]}
    finally:
        await conn.close()


@app.delete("/admin/hero-images/{image_id}")
async def delete_hero_image(image_id: int):
    """Supprime une image Hero."""
    conn = await db_connect()
    try:
        row = await conn.fetchrow("DELETE FROM hero_images WHERE id=$1 RETURNING url", image_id)
        if not row:
            raise HTTPException(404, "Image introuvable")
        url = row["url"]
        if url.startswith("/uploads/hero/"):
            fpath = Path("/app") / url.lstrip("/")
            if fpath.exists():
                fpath.unlink()
        return {"ok": True, "deleted_id": image_id}
    finally:
        await conn.close()


@app.put("/admin/site-config/hero-interval")
async def update_hero_interval(body: dict):
    """Met à jour l'intervalle du carrousel Hero en ms."""
    value_ms = int(body.get("value_ms", 3000))
    if value_ms < 1000 or value_ms > 30000:
        raise HTTPException(400, "Intervalle entre 1000ms et 30000ms")
    conn = await db_connect()
    try:
        await conn.execute(
            "INSERT INTO site_config (key, value, updated_by) VALUES ('hero_interval_ms',$1,'dashboard') "
            "ON CONFLICT (key) DO UPDATE SET value=$1, updated_at=NOW()",
            str(value_ms),
        )
        return {"ok": True, "hero_interval_ms": value_ms}
    finally:
        await conn.close()
