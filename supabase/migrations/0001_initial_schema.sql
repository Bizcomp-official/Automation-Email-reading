-- FC Address Intelligence — initial schema

create extension if not exists pg_trgm;

-- Batches: one uploaded email
create table if not exists batches (
  id            uuid primary key default gen_random_uuid(),
  batch_code    text not null unique,
  source        text not null check (source in ('email', 'rpa', 'manual')),
  email_subject text,
  email_from    text,
  received_at   timestamptz,
  status        text not null default 'processing' check (status in ('processing', 'done', 'error')),
  created_at    timestamptz not null default now()
);

-- Orders: one circuit/customer found in a batch
create table if not exists orders (
  id                  uuid primary key default gen_random_uuid(),
  batch_id            uuid not null references batches(id) on delete cascade,
  seq                 integer not null default 1,
  customer_name       text,
  company_name        text,
  circuit_order_type  text,
  old_circuit         text,
  product_package     text,
  speed               text,
  store_code          text,
  branch_name         text,
  coordinator_name    text,
  coordinator_phone   text,
  source_ref          text,
  ai_status           text not null default 'missing' check (ai_status in ('correct','missing','suspicious','incorrect')),
  created_at          timestamptz not null default now()
);

create index if not exists orders_batch_id_idx on orders(batch_id);
create index if not exists orders_customer_search_idx on orders using gin(
  to_tsvector('simple', coalesce(customer_name,'') || ' ' || coalesce(company_name,''))
);

-- Addresses: split Thai installation address
create table if not exists addresses (
  id                 uuid primary key default gen_random_uuid(),
  order_id           uuid not null references orders(id) on delete cascade,
  house_no           text,
  moo                text,
  building           text,
  floor              text,
  room               text,
  soi                text,
  road               text,
  subdistrict        text,
  district           text,
  province           text,
  postcode           text,
  latitude           numeric(10,7),
  longitude          numeric(10,7),
  input_format       text check (input_format in ('google_maps_link','lat_long','plain_text')),
  geocode_confidence numeric(4,3)
);

create index if not exists addresses_order_id_idx on addresses(order_id);

-- Field validations: per-field AI assessment
create table if not exists field_validations (
  id          uuid primary key default gen_random_uuid(),
  order_id    uuid not null references orders(id) on delete cascade,
  field_name  text not null,
  value       text,
  status      text not null check (status in ('correct','missing','suspicious','incorrect','suggested')),
  ai_note     text,
  confidence  numeric(4,3)
);

create index if not exists field_validations_order_id_idx on field_validations(order_id);

-- Reviews: IS manual verification
create table if not exists reviews (
  id          uuid primary key default gen_random_uuid(),
  order_id    uuid not null unique references orders(id) on delete cascade,
  is_status   text not null default 'pending' check (is_status in ('pending','verified','flagged')),
  reviewer    text,
  note        text,
  reviewed_at timestamptz
);

create index if not exists reviews_order_id_idx on reviews(order_id);

-- Enable RLS (row-level security) — service role bypasses it
alter table batches enable row level security;
alter table orders enable row level security;
alter table addresses enable row level security;
alter table field_validations enable row level security;
alter table reviews enable row level security;
