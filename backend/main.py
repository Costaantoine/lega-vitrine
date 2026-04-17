import asyncpg
import asyncio
import json
import logging
import os
import re
import uuid
from datetime import datetime, timezone
from pathlib import Path

import aiofiles
import httpx
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

UPLOAD_DIR = Path("/app/uploads")
UPLOAD_DIR.mkdir(exist_ok=True)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

DB_URL = os.getenv("DATABASE_URL", "postgresql://bvi_user:BviSecure2026!@bvi-db:5432/bvi_db")
BVI_API_URL = os.getenv("BVI_API_URL", "http://bvi-api-1:8000")

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
async def get_products(category: str = None, status: str = None, limit: int = 50, offset: int = 0):
    conn = await db_connect()
    try:
        where = []
        vals = []
        i = 1
        if category:
            where.append(f"category=${i}"); vals.append(category); i += 1
        if status:
            where.append(f"status=${i}"); vals.append(status); i += 1
        clause = f"WHERE {' AND '.join(where)}" if where else ""
        vals += [limit, offset]
        rows = await conn.fetch(
            f"SELECT * FROM site_products {clause} ORDER BY created_at DESC LIMIT ${i} OFFSET ${i+1}",
            *vals
        )
        total = await conn.fetchval(f"SELECT COUNT(*) FROM site_products {clause}", *vals[:-2])
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


@app.on_event("startup")
async def startup():
    asyncio.create_task(tob_scraper_cron())
    logger.info("LEGA Site API started — cron scraper tob.pt actif")
