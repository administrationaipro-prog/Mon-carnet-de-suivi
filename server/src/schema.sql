-- Schéma V0.3 — Optimisation de sa production
-- Idempotent : peut être rejoué. Toutes les tables métier portent farm_id
-- et sont protégées par Row-Level Security (FORCE) en plus des contrôles API.


create table if not exists schema_meta (key text primary key, value text not null);

create table if not exists territories (
  code text primary key,                 -- code ISO 3166 (MQ, GP, BB…)
  name_fr text not null,
  name_en text not null,
  timezone text not null,
  language text not null default 'fr',
  active boolean not null default false
);

create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  email_verified_at timestamptz,
  password_hash text not null,
  first_name text not null,
  last_name text not null,
  lang text not null default 'fr' check (lang in ('fr','en')),
  status text not null default 'active' check (status in ('active','suspended','deleted')),
  platform_role text not null default 'none' check (platform_role in ('none','admin','validator','analyst')),
  mfa_secret text,
  mfa_enabled boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists validator_territories (
  user_id uuid not null references users(id) on delete cascade,
  territory_code text not null references territories(code),
  primary key (user_id, territory_code)
);

create table if not exists sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  token_hash text not null unique,
  mfa_verified boolean not null default false,
  user_agent text,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create table if not exists auth_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id) on delete cascade,
  kind text not null check (kind in ('verify_email','reset_password')),
  token_hash text not null unique,
  expires_at timestamptz not null,
  used_at timestamptz
);

create table if not exists login_attempts (
  id bigserial primary key,
  email text not null,
  ip text,
  success boolean not null,
  at timestamptz not null default now()
);
create index if not exists login_attempts_email_at on login_attempts(email, at);

create table if not exists outbox_emails (
  id bigserial primary key,
  to_email text not null,
  subject text not null,
  body text not null,
  created_at timestamptz not null default now()
);
-- Suivi d’envoi (Brevo) : pending → sent | failed ; « logged » = aucun fournisseur configuré.
-- Les courriels existants avant cette évolution passent en « logged » : jamais renvoyés (liens périmés).
alter table outbox_emails add column if not exists status text not null default 'logged';
alter table outbox_emails alter column status set default 'pending';
alter table outbox_emails add column if not exists attempts integer not null default 0;
alter table outbox_emails add column if not exists next_attempt_at timestamptz not null default now();
alter table outbox_emails add column if not exists sent_at timestamptz;
alter table outbox_emails add column if not exists last_error text;
alter table outbox_emails add column if not exists provider_id text;
create index if not exists outbox_pending on outbox_emails(next_attempt_at) where status = 'pending';

create table if not exists notifications (
  id bigserial primary key,
  user_id uuid not null references users(id) on delete cascade,
  kind text not null,
  payload jsonb not null default '{}',
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists farms (
  id uuid primary key default gen_random_uuid(),
  territory_code text not null references territories(code),
  name text not null,
  locality text,
  objective text not null default 'mixed' check (objective in ('meat','reproduction','mixed')),
  conduct_system text,
  status text not null default 'active' check (status in ('active','suspended')),
  created_at timestamptz not null default now()
);

create table if not exists memberships (
  user_id uuid not null references users(id) on delete cascade,
  farm_id uuid not null references farms(id) on delete cascade,
  role text not null check (role in ('owner','collaborator','referent')),
  status text not null default 'active' check (status in ('active','revoked')),
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  primary key (user_id, farm_id)
);

create table if not exists invitations (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references farms(id) on delete cascade,
  email text not null,
  role text not null check (role in ('collaborator','referent')),
  invited_by uuid not null references users(id),
  status text not null default 'pending' check (status in ('pending','accepted','cancelled')),
  created_at timestamptz not null default now()
);

create table if not exists registration_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  status text not null default 'draft' check (status in ('draft','pending','info_requested','approved','rejected','suspended')),
  territory_code text not null references territories(code),
  farm_name text not null,
  locality text not null,
  production_type text not null,
  herd_size integer,
  message text,
  accepted_terms boolean not null default false,
  truthful_declaration boolean not null default false,
  assigned_to uuid references users(id),
  reviewer_id uuid references users(id),
  decision_reason text,
  farm_id uuid references farms(id),
  submitted_at timestamptz,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists registration_history (
  id bigserial primary key,
  request_id uuid not null references registration_requests(id) on delete cascade,
  actor_id uuid references users(id),
  from_status text,
  to_status text not null,
  reason text,
  at timestamptz not null default now()
);

create table if not exists breeds (
  code text primary key,
  label_fr text not null,
  label_en text not null,
  synonyms text[] not null default '{}',
  is_cross boolean not null default false
);

create table if not exists consents (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references farms(id) on delete cascade,
  purpose text not null check (purpose in ('collective_stats','technical_referent')),
  categories text[] not null,
  scope text not null default 'territory',
  policy_version text not null,
  granted_by uuid not null references users(id),
  granted_at timestamptz not null default now(),
  expires_at timestamptz,
  revoked_at timestamptz,
  revoked_by uuid references users(id)
);

create table if not exists admin_access_grants (
  id uuid primary key default gen_random_uuid(),
  admin_id uuid not null references users(id),
  farm_id uuid not null references farms(id) on delete cascade,
  justification text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create table if not exists settings (key text primary key, value jsonb not null);

create table if not exists audit_logs (
  id bigserial primary key,
  actor_id uuid,
  action text not null,
  resource text,
  resource_id text,
  farm_id uuid,
  result text not null default 'ok',
  details jsonb,
  ip text,
  at timestamptz not null default now()
);
create index if not exists audit_logs_at on audit_logs(at desc);

-- ===================== Données métier (farm-scoped) =====================

create table if not exists lots (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references farms(id) on delete cascade,
  name text not null,
  conduct_system text,
  created_at timestamptz not null default now(),
  unique (id, farm_id)
);

create table if not exists parcels (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references farms(id) on delete cascade,
  name text not null,
  area_ha numeric(10,3),
  occupation text not null default 'free' check (occupation in ('free','occupied','rest')),
  rest_since date,
  lot_id uuid,
  notes text,
  created_at timestamptz not null default now(),
  foreign key (lot_id, farm_id) references lots(id, farm_id)
);

create table if not exists animals (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references farms(id) on delete cascade,
  internal_id text not null,
  official_id text,
  name text,
  sex text not null check (sex in ('M','F')),
  birth_date date,
  breed_code text references breeds(code),
  breed_declared text,
  objective text check (objective in ('meat','reproduction')),
  status text not null default 'active' check (status in ('active','sold','dead','culled')),
  exit_date date,
  exit_reason text,
  sire_id uuid,
  dam_id uuid,
  sire_external text,
  dam_external text,
  parentage_source text check (parentage_source in ('observed','declared','dna','unknown')),
  parentage_certainty text check (parentage_certainty in ('certain','probable','uncertain')),
  lot_id uuid,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, farm_id),
  unique (farm_id, internal_id),
  foreign key (sire_id, farm_id) references animals(id, farm_id),
  foreign key (dam_id, farm_id) references animals(id, farm_id),
  foreign key (lot_id, farm_id) references lots(id, farm_id)
);
create unique index if not exists animals_official_unique on animals(farm_id, official_id) where official_id is not null;

create table if not exists births (
  animal_id uuid primary key,
  farm_id uuid not null,
  litter_size integer check (litter_size between 1 and 6),
  birth_weight_kg numeric(6,2) check (birth_weight_kg > 0),
  vitality text check (vitality in ('good','weak','assisted_survival')),
  colostrum text check (colostrum in ('yes','no','unknown')),
  assistance text check (assistance in ('none','light','heavy','vet')),
  foreign key (animal_id, farm_id) references animals(id, farm_id) on delete cascade
);

create table if not exists weighings (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null,
  animal_id uuid not null,
  date date not null,
  weight_kg numeric(7,2) not null check (weight_kg > 0),
  height_cm numeric(6,1) check (height_cm > 0),
  length_cm numeric(6,1) check (length_cm > 0),
  operator_id uuid references users(id),
  source text not null default 'manual' check (source in ('manual','offline_sync','import','demo')),
  client_uuid uuid unique,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (animal_id, farm_id) references animals(id, farm_id) on delete cascade
);
create index if not exists weighings_animal_date on weighings(animal_id, date);

create table if not exists feeding_events (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references farms(id) on delete cascade,
  animal_id uuid,
  lot_id uuid,
  feed text not null,
  quantity_kg numeric(10,3) not null check (quantity_kg >= 0),
  basis text not null default 'fresh' check (basis in ('fresh','dm')),
  kind text not null default 'distributed' check (kind in ('distributed','consumed')),
  frequency text,
  water text,
  start_date date not null,
  end_date date,
  cost_eur numeric(10,2) check (cost_eur >= 0),
  note text,
  author_id uuid references users(id),
  created_at timestamptz not null default now(),
  check (end_date is null or end_date >= start_date),
  foreign key (animal_id, farm_id) references animals(id, farm_id) on delete cascade,
  foreign key (lot_id, farm_id) references lots(id, farm_id) on delete cascade
);

create table if not exists health_events (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null,
  animal_id uuid not null,
  date date not null,
  type text not null check (type in ('observation','analysis','treatment','followup')),
  symptoms text,
  diagnosis_status text not null default 'none' check (diagnosis_status in ('none','suspected','confirmed')),
  diagnosis text,
  analysis_type text,
  analysis_result text,
  famacha integer check (famacha between 1 and 5),
  body_condition numeric(2,1) check (body_condition between 1 and 5),
  treatment text,
  product text,
  dose text,
  withdrawal_days integer check (withdrawal_days >= 0),
  followup_date date,
  author_id uuid references users(id),
  note text,
  created_at timestamptz not null default now(),
  foreign key (animal_id, farm_id) references animals(id, farm_id) on delete cascade
);

create table if not exists repro_events (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null,
  ewe_id uuid not null,
  type text not null check (type in ('mating','pregnancy_check','lambing','weaning','abortion')),
  date date not null,
  ram_id uuid,
  result text,
  born_alive integer check (born_alive >= 0),
  born_dead integer check (born_dead >= 0),
  weaned integer check (weaned >= 0),
  note text,
  author_id uuid references users(id),
  created_at timestamptz not null default now(),
  foreign key (ewe_id, farm_id) references animals(id, farm_id) on delete cascade,
  foreign key (ram_id, farm_id) references animals(id, farm_id)
);

-- Historique des corrections (audit des valeurs avant/après)
create table if not exists record_history (
  id bigserial primary key,
  farm_id uuid not null references farms(id) on delete cascade,
  table_name text not null,
  record_id uuid not null,
  actor_id uuid,
  action text not null,
  before jsonb,
  after jsonb,
  reason text,
  at timestamptz not null default now()
);

-- ===================== Boutique et stocks =====================

-- Fournisseurs partenaires et produits négociés par la plateforme (catalogue commun, géré par l'administrateur)
create table if not exists suppliers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  contact_name text,
  phone text,
  email text,
  territory_code text references territories(code),
  notes text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists products (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid not null references suppliers(id),
  name text not null,
  category text not null check (category in ('hay','grain','feed','mineral','bedding','health','other')),
  unit text not null,
  unit_weight_kg numeric(10,2) check (unit_weight_kg > 0),
  price_eur numeric(10,2) check (price_eur >= 0),
  -- quantité réservée par le fournisseur aux éleveurs de l'application ; ordered_quantity = commandes non annulées
  reserved_quantity integer not null default 0 check (reserved_quantity >= 0),
  ordered_quantity integer not null default 0 check (ordered_quantity >= 0),
  delivery_days integer not null default 7 check (delivery_days between 0 and 120),
  territory_code text references territories(code),
  description text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- Stocks de chaque exploitation (données privées, RLS)
create table if not exists stock_items (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references farms(id) on delete cascade,
  name text not null,
  category text not null check (category in ('hay','grain','feed','mineral','bedding','health','other')),
  unit text not null,
  consumption_qty numeric(10,3) check (consumption_qty > 0),
  consumption_days numeric(8,2) check (consumption_days > 0),
  alert_units numeric(10,3) not null default 1 check (alert_units >= 0),
  lead_days integer not null default 7 check (lead_days between 0 and 120),
  product_id uuid references products(id) on delete set null,
  last_alert_at timestamptz,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (id, farm_id)
);

create table if not exists stock_movements (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null,
  item_id uuid not null,
  type text not null check (type in ('count','in','out')),
  quantity numeric(10,3) not null check (quantity >= 0),
  date date not null,
  note text,
  order_id uuid,
  author_id uuid references users(id),
  created_at timestamptz not null default now(),
  foreign key (item_id, farm_id) references stock_items(id, farm_id) on delete cascade
);
create index if not exists stock_movements_item on stock_movements(item_id, date);

create table if not exists orders (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references farms(id) on delete cascade,
  product_id uuid not null references products(id),
  quantity integer not null check (quantity > 0),
  unit_price_eur numeric(10,2),
  status text not null default 'requested' check (status in ('requested','confirmed','delivered','cancelled')),
  note text,
  decision_note text,
  delivery_date date,
  requested_by uuid references users(id),
  handled_by uuid references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists orders_farm on orders(farm_id, created_at desc);


-- ===================== Vétérinaires, parasitisme, coproscopie =====================
alter table animals add column if not exists species text not null default 'ovine';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'animals_species_check') then
    alter table animals add constraint animals_species_check check (species in ('ovine','caprine'));
  end if;
end $$;
alter table farms add column if not exists ede_number text;

-- Profil vétérinaire : vérifié par l'administrateur (n° d'inscription à l'Ordre) avant toute signature
create table if not exists vet_profiles (
  user_id uuid primary key references users(id) on delete cascade,
  ordinal_number text not null,
  clinic text not null,
  territory_code text references territories(code),
  phone text,
  status text not null default 'pending' check (status in ('pending','verified','rejected','suspended')),
  decision_note text,
  decided_by uuid references users(id),
  decided_at timestamptz,
  created_at timestamptz not null default now()
);

-- Accès de consultation accordé par l'éleveur (portées, durée, révocable)
create table if not exists vet_access (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references farms(id) on delete cascade,
  vet_id uuid not null references users(id) on delete cascade,
  scopes text[] not null,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  granted_by uuid references users(id),
  created_at timestamptz not null default now()
);
create index if not exists vet_access_vet on vet_access(vet_id, expires_at);
create index if not exists vet_access_farm on vet_access(farm_id, expires_at);

-- Code à usage unique montré au vétérinaire sur place (15 min)
create table if not exists vet_access_codes (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references farms(id) on delete cascade,
  code_hash text not null,
  scopes text[] not null,
  duration_hours integer not null,
  created_by uuid references users(id),
  expires_at timestamptz not null,
  used_at timestamptz,
  used_by uuid references users(id),
  attempts integer not null default 0
);

-- Codes de confirmation de signature (SMS ou courriel)
create table if not exists sign_codes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  purpose text not null,
  target_id text not null,
  code_hash text not null,
  channel text not null,
  expires_at timestamptz not null,
  attempts integer not null default 0,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

-- Seuils parasitaires : valeurs par défaut tant qu'aucun avis vétérinaire signé
create table if not exists parasite_settings (
  farm_id uuid not null references farms(id) on delete cascade,
  species text not null check (species in ('ovine','caprine')),
  vals jsonb not null,
  comment text,
  vet_id uuid references users(id),
  vet_name text,
  vet_ordinal text,
  signature_png text,
  validated_at timestamptz,
  version integer not null default 1,
  primary key (farm_id, species)
);
create table if not exists parasite_settings_history (
  id bigserial primary key,
  farm_id uuid not null references farms(id) on delete cascade,
  species text not null,
  vals jsonb not null,
  comment text,
  vet_id uuid references users(id),
  vet_name text,
  vet_ordinal text,
  validated_at timestamptz not null,
  version integer not null
);

-- Examen parasitaire « 5 points » (FAMACHA, état corporel, diarrhée, mâchoire, nez)
create table if not exists parasite_exams (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null,
  animal_id uuid not null,
  date date not null,
  famacha smallint check (famacha between 1 and 5),
  bcs numeric(2,1) check (bcs between 1 and 5),
  dag smallint check (dag between 0 and 3),
  jaw_edema boolean not null default false,
  nasal boolean not null default false,
  decision text not null check (decision in ('treat','watch','none')),
  reasons text[] not null default '{}',
  note text,
  author_id uuid references users(id),
  created_at timestamptz not null default now(),
  foreign key (animal_id, farm_id) references animals(id, farm_id) on delete cascade
);
create index if not exists parasite_exams_farm_date on parasite_exams(farm_id, date desc);

-- Fichiers (PDF source du laboratoire, rapports signés) : stockés en base, empreinte SHA-256
create table if not exists files (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references farms(id) on delete cascade,
  kind text not null check (kind in ('copro_source','copro_signed')),
  name text not null,
  mime text not null,
  size integer not null,
  sha256 text not null,
  data bytea not null,
  uploaded_by uuid references users(id),
  created_at timestamptz not null default now()
);

create table if not exists copro_reports (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references farms(id) on delete cascade,
  number text not null unique,
  phase text not null default 'J0' check (phase in ('J0','J14','other')),
  parent_id uuid references copro_reports(id),
  species text not null default 'ovine' check (species in ('ovine','caprine')),
  sample_date date not null,
  sample_mode text,
  reason text,
  status text not null default 'draft' check (status in ('draft','signed')),
  vet_id uuid references users(id),
  lab_name text,
  lab_ref text,
  received_date date,
  method text,
  detection_limit integer,
  lab_comment text,
  interpretation text,
  source_file_id uuid references files(id),
  ai_extraction jsonb,
  signature_png text,
  signed_at timestamptz,
  signed_vet_name text,
  signed_vet_ordinal text,
  signed_clinic text,
  pdf_file_id uuid references files(id),
  content_hash text,
  farmer_ack_at timestamptz,
  farmer_ack_by uuid references users(id),
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists copro_results (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references copro_reports(id) on delete cascade,
  farm_id uuid not null,
  animal_id uuid,
  raw_label text,
  famacha smallint,
  bcs numeric(2,1),
  strongyles_epg integer check (strongyles_epg >= 0),
  nematodirus_epg integer check (nematodirus_epg >= 0),
  coccidia text,
  confidence text check (confidence in ('high','medium','low')),
  corrected boolean not null default false,
  position integer not null default 0,
  foreign key (animal_id, farm_id) references animals(id, farm_id)
);
create sequence if not exists copro_number_seq;

-- ===================== Row-Level Security =====================

create or replace function app_uid() returns uuid language sql stable as $$
  select nullif(current_setting('app.user_id', true), '')::uuid
$$;

-- Vétérinaire vérifié disposant d'un accès de consultation en cours
create or replace function app_vet_can(f uuid) returns boolean language sql stable as $$
  select exists (select 1 from vet_access va join vet_profiles vp on vp.user_id = va.vet_id join farms fa on fa.id = va.farm_id
                 where va.farm_id = f and va.vet_id = app_uid() and va.revoked_at is null and va.expires_at > now()
                   and vp.status = 'verified' and fa.status = 'active')
$$;

create or replace function app_can_read(f uuid) returns boolean language sql stable as $$
  select
    exists (select 1 from memberships m join farms fa on fa.id = m.farm_id
            where m.farm_id = f and m.user_id = app_uid() and m.status = 'active' and fa.status = 'active')
    or exists (select 1 from admin_access_grants g
               where g.farm_id = f and g.admin_id = app_uid() and g.expires_at > now())
    or app_vet_can(f)
    or (current_setting('app.ctx', true) = 'aggregate'
        and exists (select 1 from consents c join farms fa on fa.id = c.farm_id
                    where c.farm_id = f and fa.status = 'active' and c.purpose = 'collective_stats'
                      and c.revoked_at is null and (c.expires_at is null or c.expires_at > now())))
$$;

create or replace function app_can_write(f uuid) returns boolean language sql stable as $$
  select exists (select 1 from memberships m join farms fa on fa.id = m.farm_id
                 where m.farm_id = f and m.user_id = app_uid() and m.status = 'active'
                   and fa.status = 'active' and m.role in ('owner','collaborator'))
$$;

do $$
declare t text;
begin
  foreach t in array array['lots','parcels','animals','births','weighings','feeding_events','health_events','repro_events','record_history','stock_items','stock_movements']
  loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format('drop policy if exists p_read on %I', t);
    execute format('drop policy if exists p_insert on %I', t);
    execute format('drop policy if exists p_update on %I', t);
    execute format('drop policy if exists p_delete on %I', t);
    execute format('create policy p_read on %I for select using (app_can_read(farm_id))', t);
    execute format('create policy p_insert on %I for insert with check (app_can_write(farm_id))', t);
    execute format('create policy p_update on %I for update using (app_can_write(farm_id)) with check (app_can_write(farm_id))', t);
    execute format('create policy p_delete on %I for delete using (app_can_write(farm_id))', t);
  end loop;
end $$;

-- Service de stock (alertes planifiées, livraison d'une commande) : accès limité aux tables de stock,
-- uniquement dans une transaction ouverte par le serveur avec app.ctx = 'stock_service'.
do $$
declare t text;
begin
  foreach t in array array['stock_items','stock_movements']
  loop
    execute format('drop policy if exists p_stock_service on %I', t);
    execute format('create policy p_stock_service on %I for all using (current_setting(''app.ctx'', true) = ''stock_service'') with check (current_setting(''app.ctx'', true) = ''stock_service'')', t);
  end loop;
end $$;

create or replace function app_is_admin() returns boolean language sql stable as $$
  select exists (select 1 from users where id = app_uid() and platform_role = 'admin' and status = 'active')
$$;

-- Commandes : visibles par les membres de l'exploitation et par l'administrateur qui les traite
alter table orders enable row level security;
alter table orders force row level security;
drop policy if exists p_read on orders;
drop policy if exists p_insert on orders;
drop policy if exists p_update on orders;
create policy p_read on orders for select using (app_can_read(farm_id) or app_is_admin());
create policy p_insert on orders for insert with check (app_can_write(farm_id));
create policy p_update on orders for update using (app_can_write(farm_id) or app_is_admin()) with check (app_can_write(farm_id) or app_is_admin());


-- Parasitisme et coproscopie : lecture par l'exploitation (et le vétérinaire en consultation),
-- écriture par l'exploitation ou par le vétérinaire en consultation (signature contrôlée par l'API).
do $$
declare t text;
begin
  foreach t in array array['parasite_exams','parasite_settings','parasite_settings_history','files','copro_reports','copro_results']
  loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format('drop policy if exists p_read on %I', t);
    execute format('drop policy if exists p_write on %I', t);
    execute format('create policy p_read on %I for select using (app_can_read(farm_id))', t);
    execute format('create policy p_write on %I for all using (app_can_write(farm_id) or app_vet_can(farm_id)) with check (app_can_write(farm_id) or app_vet_can(farm_id))', t);
  end loop;
end $$;

-- Un rapport signé est figé : seule la prise de connaissance de l'éleveur peut encore être enregistrée.
create or replace function copro_signed_guard() returns trigger language plpgsql as $$
begin
  if tg_table_name = 'copro_reports' then
    if old.status = 'signed' and (tg_op = 'DELETE' or (to_jsonb(new) - 'farmer_ack_at' - 'farmer_ack_by' - 'updated_at')
                                      is distinct from (to_jsonb(old) - 'farmer_ack_at' - 'farmer_ack_by' - 'updated_at')) then
      raise exception 'report_signed' using errcode = '55000';
    end if;
  else
    if exists (select 1 from copro_reports r where r.status = 'signed'
               and r.id = case when tg_op = 'INSERT' then new.report_id else old.report_id end) then
      raise exception 'report_signed' using errcode = '55000';
    end if;
  end if;
  return coalesce(new, old);
end $$;
drop trigger if exists copro_reports_guard on copro_reports;
create trigger copro_reports_guard before update or delete on copro_reports for each row execute function copro_signed_guard();
drop trigger if exists copro_results_guard on copro_results;
create trigger copro_results_guard before insert or update or delete on copro_results for each row execute function copro_signed_guard();

-- Page publique « Vérifier un document » : uniquement les rapports signés, dans une transaction app.ctx = 'verify'
drop policy if exists p_verify on copro_reports;
create policy p_verify on copro_reports for select using (current_setting('app.ctx', true) = 'verify' and status = 'signed');

-- ===================== Référentiels =====================

insert into territories (code, name_fr, name_en, timezone, language, active) values
  ('MQ','Martinique','Martinique','America/Martinique','fr', true),
  ('GP','Guadeloupe','Guadeloupe','America/Guadeloupe','fr', true),
  ('BB','Barbade','Barbados','America/Barbados','en', false),
  ('LC','Sainte-Lucie','Saint Lucia','America/St_Lucia','en', false),
  ('DM','Dominique','Dominica','America/Dominica','en', false),
  ('TT','Trinité-et-Tobago','Trinidad and Tobago','America/Port_of_Spain','en', false),
  ('JM','Jamaïque','Jamaica','America/Jamaica','en', false)
on conflict (code) do nothing;

insert into breeds (code, label_fr, label_en, synonyms, is_cross) values
  ('BLACKBELLY','Black Belly','Barbados Blackbelly','{"Blackbelly","Barbados Black Belly","Tête noire"}', false),
  ('MARTINIK','Mouton Martinik','Martinik Hair Sheep','{"Martinik","Créole"}', false),
  ('SAINT_MARTIN','Saint-Martin','St. Croix / Saint-Martin','{"St Martin","Saint Martin","St. Croix"}', false),
  ('ILE_DE_FRANCE','Île-de-France','Île-de-France','{"IDF"}', false),
  ('DORPER','Dorper','Dorper','{}', false),
  ('BB_X_IDF','Black Belly × Île-de-France','Blackbelly × Île-de-France','{}', true),
  ('SM_X_IDF','Saint-Martin × Île-de-France','Saint-Martin × Île-de-France','{}', true),
  ('CROSS_OTHER','Autre croisement','Other cross','{}', true),
  ('UNKNOWN','Inconnue','Unknown','{}', false)
on conflict (code) do nothing;

insert into settings (key, value) values
  ('aggregation_min_farms', '5'),
  ('consent_policy_version', '"2026-11-v1"'),
  ('weighing_protocol_days', '[0,7,14,21,30,45,60,90,120]'),
  ('weighing_tolerance_days', '3'),
  ('interpolation_max_gap_days', '30'),
  ('inbreeding_warn_percent', '6.25'),
  ('inbreeding_max_percent', '12.5')
on conflict (key) do nothing;
