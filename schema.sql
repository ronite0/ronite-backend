create table if not exists tokens (
  address         text primary key,
  curve_address   text not null unique,
  creator         text not null,
  name            text not null,
  symbol          text not null,
  image_uri       text not null default '',
  description     text not null default '',
  twitter         text not null default '',
  telegram        text not null default '',
  website         text not null default '',
  created_at      bigint not null,
  migrated        boolean not null default false,
  dex_pool        text,
  updated_at      timestamptz not null default now()
);

create table if not exists trades (
  id             bigserial primary key,
  curve_address  text not null references tokens(curve_address),
  trader         text not null,
  is_buy         boolean not null,
  ron_amount     text not null,   -- stored as string: raw wei value can exceed JS safe-integer range
  token_amount   text not null,
  price_ron      double precision not null,
  timestamp      bigint not null,
  tx_hash        text not null,
  log_index      integer not null default 0,
  block_number   bigint not null,
  unique (tx_hash, log_index)
);
create index if not exists trades_curve_time_idx on trades (curve_address, timestamp);

-- Single-row table tracking how far the indexer has scanned, so a restart
-- resumes instead of re-scanning everything from the deploy block again.
create table if not exists indexer_state (
  id         int primary key default 1,
  last_block bigint not null,
  check (id = 1)
);
insert into indexer_state (id, last_block) values (1, 0)
  on conflict (id) do nothing;
