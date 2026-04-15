-- Tables site vitrine LEGA
CREATE TABLE IF NOT EXISTS site_config (
    id SERIAL PRIMARY KEY,
    key TEXT UNIQUE NOT NULL,
    value TEXT,
    value_json JSONB,
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    updated_by TEXT DEFAULT 'manual'
);

CREATE TABLE IF NOT EXISTS site_translations (
    id SERIAL PRIMARY KEY,
    lang TEXT NOT NULL,
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(lang, key)
);

CREATE TABLE IF NOT EXISTS site_sections (
    id SERIAL PRIMARY KEY,
    name TEXT UNIQUE NOT NULL,
    display_name TEXT,
    position INTEGER,
    enabled BOOLEAN DEFAULT true,
    config JSONB
);

CREATE TABLE IF NOT EXISTS site_products (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title TEXT NOT NULL,
    category TEXT,
    brand TEXT,
    model TEXT,
    year INTEGER,
    hours INTEGER,
    price NUMERIC(10,2),
    currency TEXT DEFAULT 'EUR',
    location TEXT,
    description TEXT,
    specs JSONB,
    images JSONB,
    status TEXT DEFAULT 'available'
        CHECK (status IN ('available','sold','reserved','new','archived')),
    source_url TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS site_audit_log (
    id SERIAL PRIMARY KEY,
    action TEXT NOT NULL,
    field TEXT,
    old_value TEXT,
    new_value TEXT,
    done_by TEXT DEFAULT 'manual',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Config initiale
INSERT INTO site_config (key, value) VALUES
('site_name',       'LEGA Trading'),
('slogan_fr',       'Équipements qui font bouger le monde'),
('slogan_pt',       'Equipamentos que movem o mundo'),
('slogan_en',       'Equipment that moves the world'),
('slogan_es',       'Equipos que mueven el mundo'),
('slogan_de',       'Ausrüstung, die die Welt bewegt'),
('slogan_it',       'Attrezzature che muovono il mondo'),
('slogan_ru',       'Техника, которая двигает мир'),
('slogan_ar',       'معدات تحرك العالم'),
('phone',           '00351 912 406 089'),
('email',           'escritorio.ai.lega@gmail.com'),
('address',         'Rua Santo António, 120 — Vila Nova de Famalicão, Portugal'),
('color_primary',   '#1B3F6E'),
('color_secondary', '#E8641E'),
('font',            'Inter'),
('stat_machines',   '400+'),
('stat_langues',    '8'),
('stat_pays',       '15+'),
('stat_support',    '24/7')
ON CONFLICT (key) DO NOTHING;

-- Sections
INSERT INTO site_sections (name, display_name, position, enabled) VALUES
('hero',      'Hero + image principale', 1, true),
('stats',     'Barre de statistiques',   2, true),
('search',    'Recherche rapide',        3, true),
('catalogue', 'Catalogue produits',      4, true),
('ai_banner', 'Bandeau assistante IA',   5, true),
('contact',   'Formulaire de contact',   6, true),
('footer',    'Pied de page',            7, true)
ON CONFLICT (name) DO NOTHING;

-- Agent site_manager (premium, trial jamais automatique)
INSERT INTO agent_registry
  (name, display_name, model, capabilities, avg_latency_sec, ram_cost_mb, is_premium, price_monthly_eur)
VALUES
  ('site_manager', 'Gestionnaire Site Web', 'gemma4:e2b',
   ARRAY['modifier_textes','changer_couleurs','update_coordonnees',
         'activer_sections','modifier_traductions','update_catalogue'],
   30, 7200, true, 49)
ON CONFLICT (name) DO NOTHING;
