# Guide de déploiement LEGA sur Coolify (Hostinger VPS)

## Architecture cible

| Service | Domaine | Port interne |
|---------|---------|-------------|
| lega-frontend (Next.js) | `lega.pt` | 3000 |
| lega-backend (FastAPI) | `lega.pt/api` | 8000 |
| bvi-api (FastAPI) | `api.lega.pt` | 8000 |
| bvi-dashboard (Next.js) | `admin.lega.pt` | 3000 |
| bvi-shop (Next.js) | `shop.lega.pt` | 3000 |
| bvi-db (PostgreSQL) | interne uniquement | 5432 |
| bvi-searxng | interne uniquement | 8080 |

---

## Étape 0 — Prérequis sur le nouveau VPS Hostinger

### 0.1 Installer Coolify

```bash
curl -fsSL https://cdn.coollabs.io/coolify/install.sh | bash
```

### 0.2 Créer le réseau Docker partagé (une seule fois)

Ce réseau permet à lega-backend d'accéder à la base PostgreSQL du BVI.

```bash
docker network create bvi_bvi-net
```

### 0.3 Créer le volume partagé pour les docs (une seule fois)

```bash
docker volume create bvi_bvi-docs
```

### 0.4 Configurer les DNS

Pointer ces enregistrements A vers l'IP du VPS Hostinger :

```
lega.pt        → <IP_HOSTINGER>
api.lega.pt    → <IP_HOSTINGER>
admin.lega.pt  → <IP_HOSTINGER>
shop.lega.pt   → <IP_HOSTINGER>
```

---

## Étape 1 — Déployer le repo BVI (Costaantoine/lega)

### 1.1 Dans Coolify : créer un nouveau projet

1. **Coolify UI** → Projects → New Project → Nom : `LEGA BVI`

### 1.2 Ajouter une ressource Docker Compose

1. Resources → New → Docker Compose
2. Source : **GitHub** → `Costaantoine/lega`
3. Branch : `main`
4. Compose file : `docker-compose.coolify.yml`
5. Build method : **Remote** (build sur le VPS)

### 1.3 Variables d'environnement BVI

Dans l'interface Coolify, ajouter ces variables :

| Variable | Description | Exemple |
|----------|-------------|---------|
| `POSTGRES_USER` | Utilisateur PostgreSQL | `bvi_user` |
| `POSTGRES_PASSWORD` | Mot de passe DB | `[VOTRE_MDP]` |
| `POSTGRES_DB` | Nom de la base | `bvi_db` |
| `DATABASE_URL` | URL complète PostgreSQL | `postgresql://bvi_user:[MDP]@db:5432/bvi_db` |
| `JWT_SECRET` | Clé JWT BVI | `[GÉNÉRER: openssl rand -hex 32]` |
| `DASHSCOPE_API_KEY` | Clé API Alibaba DashScope | `[VOTRE_CLÉ]` |
| `DASHSCOPE_BASE_URL` | URL DashScope | `https://dashscope-intl.aliyuncs.com/compatible-mode/v1` |
| `OLLAMA_BASE_URL` | URL Ollama local | `http://host.docker.internal:11434` |
| `TELEGRAM_BOT_TOKEN` | Token bot Telegram | `[VOTRE_TOKEN]` |
| `TELEGRAM_CHAT_ID` | Chat ID Telegram | `8070870984` |
| `ADMIN_USER` | Login admin BVI | `admin` |
| `ADMIN_PASS` | Mot de passe admin | `[VOTRE_MDP]` |
| `SMTP_FROM` | Email expéditeur | `escritorio.ai.lega@gmail.com` |
| `SMTP_HOST` | Serveur SMTP | `smtp.gmail.com` |
| `SMTP_PORT` | Port SMTP | `587` |
| `SMTP_PASSWORD` | Mot de passe SMTP (App Password Gmail) | `[VOTRE_MDP]` |
| `SITE_MANAGEMENT_MODE` | Mode gestion site | `manual` |
| `AGENT_API_KEY` | Clé API agent (laisser vide si non utilisé) | `` |
| `TTS_ENABLED` | Activer TTS | `false` |
| `AVATAR_ENABLED` | Activer avatar | `false` |
| `AIIA_ENDPOINT` | Endpoint AIIA | `` |
| `BRIEF_HOUR` | Heure brief matinal | `7` |
| `BRIEF_MINUTE` | Minute brief matinal | `0` |
| `CLIENT_DOMAIN` | Domaine client | `lega.pt` |
| `CLIENT_NAME` | Nom du client | `LEGA` |
| `SEARXNG_URL` | URL SearXNG interne | `http://searxng:8080` |
| `CORS_ORIGINS` | Origines CORS autorisées | `["*"]` |
| `NEXT_PUBLIC_BVI_API_URL` | URL publique API BVI (dashboard) | `https://api.lega.pt/api` |
| `NEXT_PUBLIC_BVI_WS_URL` | URL WebSocket BVI (dashboard) | `wss://api.lega.pt/ws` |

### 1.4 Déployer

Cliquer **Deploy** dans Coolify. Vérifier que les 5 services démarrent.

---

## Étape 2 — Déployer le repo LEGA-VITRINE (Costaantoine/lega-vitrine)

### 2.1 Dans Coolify : créer un nouveau projet

1. **Coolify UI** → Projects → New Project → Nom : `LEGA Vitrine`

### 2.2 Ajouter une ressource Docker Compose

1. Resources → New → Docker Compose
2. Source : **GitHub** → `Costaantoine/lega-vitrine`
3. Branch : `main`
4. Compose file : `docker-compose.coolify.yml`

### 2.3 Variables d'environnement LEGA-VITRINE

| Variable | Description | Valeur |
|----------|-------------|--------|
| `DATABASE_URL` | URL PostgreSQL du BVI | `postgresql://bvi_user:[MDP]@bvi-db-1:5432/bvi_db` |
| `BVI_API_URL` | URL interne de l'API BVI | `http://bvi-api-1:8000` |
| `SITE_BASE_URL` | URL publique du site | `https://lega.pt` |
| `TELEGRAM_BOT_TOKEN` | Token bot Telegram | `[VOTRE_TOKEN]` |
| `TELEGRAM_CHAT_ID` | Chat ID Telegram | `8070870984` |
| `SMTP_FROM` | Email expéditeur | `escritorio.ai.lega@gmail.com` |
| `SMTP_HOST` | Serveur SMTP | `smtp.gmail.com` |
| `SMTP_PORT` | Port SMTP | `587` |
| `SMTP_PASSWORD` | Mot de passe SMTP | `[VOTRE_MDP]` |
| `JWT_SECRET_CLIENT` | Clé JWT vitrine | `[GÉNÉRER: openssl rand -hex 32]` |
| `NEXT_PUBLIC_SITE_API_URL` | URL API site (navigateur) | `https://lega.pt/api/site` |
| `NEXT_PUBLIC_BVI_WS_URL` | URL WebSocket BVI (navigateur) | `wss://api.lega.pt/ws/stream` |

### 2.4 Déployer

Cliquer **Deploy**. Vérifier que frontend et backend démarrent.

---

## Étape 3 — Vérification post-déploiement

```bash
# Vérifier que tous les conteneurs tournent
docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"

# Tester le frontend
curl -I https://lega.pt

# Tester le backend API
curl https://lega.pt/api/site/health 2>/dev/null || curl https://lega.pt/api/

# Tester l'API BVI
curl https://api.lega.pt/health 2>/dev/null || curl https://api.lega.pt/

# Tester le dashboard
curl -I https://admin.lega.pt

# Vérifier les certificats SSL
echo | openssl s_client -connect lega.pt:443 2>/dev/null | grep "subject\|issuer"
```

---

## Ordre de déploiement recommandé

```
1. BVI (db + api + searxng) ─────────────────────► attendre que db soit healthy
2. BVI (dashboard + shop)   ─────────────────────► démarrent après api
3. LEGA-VITRINE backend     ─────────────────────► se connecte à bvi-db via réseau partagé
4. LEGA-VITRINE frontend    ─────────────────────► démarre après backend
```

---

## Connexion réseau entre les deux projets

Le backend LEGA doit accéder à la DB du BVI. Dans Coolify :

1. Le réseau `bvi_bvi-net` est créé par le projet BVI
2. Il est référencé comme `external` dans le compose LEGA-VITRINE
3. S'assurer que le projet BVI est déployé **avant** LEGA-VITRINE

Si Coolify renomme le réseau, vérifier avec :
```bash
docker network ls | grep bvi
```
Et adapter la valeur `name: bvi_bvi-net` dans `docker-compose.coolify.yml` si nécessaire.

---

## Problèmes courants

### "Network bvi_bvi-net not found"
```bash
docker network create bvi_bvi-net
```
Puis redéployer LEGA-VITRINE.

### "Volume bvi_bvi-docs not found"
```bash
docker volume create bvi_bvi-docs
```
Puis redéployer BVI pour qu'il monte les docs dans le volume.

### Frontend renvoie les pages du cache ancien
```bash
docker exec lega-vitrine-lega-frontend-1 rm -rf /app/.next/cache
docker restart lega-vitrine-lega-frontend-1
```

### Certificat SSL non généré
Vérifier que les DNS sont bien propagés avant le premier déploiement :
```bash
dig lega.pt +short
dig api.lega.pt +short
```
