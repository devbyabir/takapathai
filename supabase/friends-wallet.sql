begin;

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
create schema if not exists takapathai_private;
revoke all on schema takapathai_private from public, anon, authenticated;

create table if not exists takapathai_private.wallets (
  user_id uuid primary key references auth.users (id),
  handle text not null unique check (handle ~ '^01[3-9][0-9]{8}$'),
  pin_hash text not null,
  balance bigint not null default 5000000 check (balance between 0 and 9007199254740991),
  failed_pin_attempts integer not null default 0,
  locked_until timestamptz
);

create table if not exists takapathai_private.transfers (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid not null references takapathai_private.wallets (user_id),
  recipient_id uuid not null references takapathai_private.wallets (user_id),
  request_id uuid not null,
  amount bigint not null check (amount between 1 and 9007199254740991),
  kind text not null default 'transfer' check (kind in ('transfer', 'cashout')),
  created_at timestamptz not null default now(),
  unique (sender_id, request_id),
  check (sender_id <> recipient_id)
);

-- Preserve balances, PINs and history from a previously installed phone version.
do $$
begin
  if exists (select 1 from information_schema.columns
             where table_schema = 'takapathai_private' and table_name = 'wallets' and column_name = 'phone') then
    alter table takapathai_private.wallets drop constraint wallets_phone_check;
    alter table takapathai_private.wallets rename column phone to handle;
    update takapathai_private.wallets set handle = '0' || substring(handle from 5);
    alter table takapathai_private.wallets add constraint wallets_handle_check check (handle ~ '^01[3-9][0-9]{8}$');
  end if;
end;
$$;
alter table takapathai_private.transfers add column if not exists kind text not null default 'transfer'
  check (kind in ('transfer', 'cashout'));
create index if not exists transfers_sender_id_created_at_idx on takapathai_private.transfers (sender_id, created_at desc);
create index if not exists transfers_recipient_id_created_at_idx on takapathai_private.transfers (recipient_id, created_at desc);
alter table takapathai_private.wallets enable row level security;
alter table takapathai_private.transfers enable row level security;

create table if not exists takapathai_private.lookup_limits (
  user_id uuid primary key references takapathai_private.wallets (user_id),
  window_start timestamptz not null,
  attempts integer not null
);
alter table takapathai_private.lookup_limits enable row level security;

drop function if exists public.takapathai_create_wallet(text);
drop function if exists public.takapathai_send(text, bigint, text, uuid);

create or replace function takapathai_private.google_user()
returns uuid
language sql stable set search_path = ''
as $$
  select i.user_id from auth.identities i
  where i.user_id = auth.uid() and i.provider = 'google'
  limit 1;
$$;
revoke all on function takapathai_private.google_user() from public, anon, authenticated;

create or replace function public.takapathai_create_wallet(p_handle text, p_pin text)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  actor_id uuid := takapathai_private.google_user();
begin
  if actor_id is null then
    raise exception 'Sign in with Google first.';
  end if;
  if p_handle is null or p_handle !~ '^01[3-9][0-9]{8}$' then
    raise exception 'Choose an 11-digit wallet username starting with 01.';
  end if;
  if p_pin is null or p_pin !~ '^[0-9]{4}$' then
    raise exception 'Choose a four-digit PIN.';
  end if;
  insert into takapathai_private.wallets (user_id, handle, pin_hash)
  values (actor_id, p_handle, extensions.crypt(p_pin, extensions.gen_salt('bf', 10)))
  on conflict (user_id) do nothing;
exception when unique_violation then
  raise exception 'That wallet username is already taken.';
end;
$$;

create or replace function public.takapathai_wallet()
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'handle', w.handle,
    'balance', w.balance,
    'transfers', coalesce((
      select jsonb_agg(to_jsonb(t) order by t.created_at desc, t.id desc)
      from (
        select x.id, x.amount, x.kind, x.created_at, x.sender_id = w.user_id as sent,
               right(other.handle, 4) as handle_suffix
        from takapathai_private.transfers x
        join takapathai_private.wallets other
          on other.user_id = case when x.sender_id = w.user_id then x.recipient_id else x.sender_id end
        where x.sender_id = w.user_id or x.recipient_id = w.user_id
        order by x.created_at desc, x.id desc
        limit 50
      ) t
    ), '[]'::jsonb)
  )
  from takapathai_private.wallets w
  where w.user_id = takapathai_private.google_user();
$$;

create or replace function public.takapathai_find_wallet(p_handle text)
returns boolean
language plpgsql security definer set search_path = ''
as $$
declare
  actor_id uuid := takapathai_private.google_user();
  bucket timestamptz := date_trunc('minute', clock_timestamp());
begin
  if p_handle is null or p_handle !~ '^01[3-9][0-9]{8}$'
     or not exists (select 1 from takapathai_private.wallets w where w.user_id = actor_id) then
    return false;
  end if;
  insert into takapathai_private.lookup_limits as limits (user_id, window_start, attempts)
  values (actor_id, bucket, 1)
  on conflict (user_id) do update
  set window_start = greatest(limits.window_start, excluded.window_start),
      attempts = case when limits.window_start < excluded.window_start then 1 else limits.attempts + 1 end
  where limits.window_start < excluded.window_start or limits.attempts < 20;
  if not found then
    raise exception 'Too many wallet lookups. Try again in a minute.';
  end if;
  return exists (select 1 from takapathai_private.wallets w
                 where w.handle = p_handle and w.user_id <> actor_id);
end;
$$;

create or replace function public.takapathai_send(p_handle text, p_amount bigint, p_pin text, p_request_id uuid, p_kind text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  actor_id uuid := takapathai_private.google_user();
  receiver_id uuid;
  sender takapathai_private.wallets%rowtype;
  previous takapathai_private.transfers%rowtype;
  transfer_id uuid;
begin
  if actor_id is null or p_handle is null or p_handle !~ '^01[3-9][0-9]{8}$'
    or p_kind is null or p_kind not in ('transfer', 'cashout')
    or p_amount is null or p_amount not between 1 and 9007199254740991
    or p_pin is null or p_pin !~ '^[0-9]{4}$' or p_request_id is null then
    return jsonb_build_object('error', 'Enter a valid wallet username, amount and PIN.');
  end if;

  select w.user_id into receiver_id from takapathai_private.wallets w where w.handle = p_handle;
  -- Acquire both locks in the same order even for simultaneous transfers in opposite directions.
  perform 1 from takapathai_private.wallets w
  where w.user_id in (actor_id, receiver_id) order by w.user_id for update;
  select w.* into sender from takapathai_private.wallets w where w.user_id = actor_id;
  if not found then
    return jsonb_build_object('error', 'Finish setting up your wallet first.');
  end if;

  select t.* into previous from takapathai_private.transfers t
  where t.sender_id = actor_id and t.request_id = p_request_id;
  if found then
    if previous.recipient_id is distinct from receiver_id or previous.amount <> p_amount or previous.kind <> p_kind then
      return jsonb_build_object('error', 'Start a new transfer for the changed details.');
    end if;
    return jsonb_build_object('id', previous.id);
  end if;

  if sender.locked_until > clock_timestamp() then
    return jsonb_build_object('error', 'Too many PIN attempts. Try again in 15 minutes.');
  end if;
  if extensions.crypt(p_pin, sender.pin_hash) <> sender.pin_hash then
    if sender.locked_until is not null then sender.failed_pin_attempts := 0; end if;
    update takapathai_private.wallets w
    set failed_pin_attempts = sender.failed_pin_attempts + 1,
        locked_until = case when sender.failed_pin_attempts >= 4 then clock_timestamp() + interval '15 minutes' end
    where w.user_id = actor_id;
    return jsonb_build_object('error', 'Incorrect PIN.');
  end if;
  update takapathai_private.wallets w set failed_pin_attempts = 0, locked_until = null where w.user_id = actor_id;

  if receiver_id is null then
    return jsonb_build_object('error', 'This username has no TakaPathai wallet.');
  end if;
  if actor_id = receiver_id then
    return jsonb_build_object('error', 'Enter a friend’s number.');
  end if;
  if sender.balance < p_amount then
    return jsonb_build_object('error', 'You don’t have enough demo balance.');
  end if;
  if exists (select 1 from takapathai_private.wallets w
    where w.user_id = receiver_id and w.balance > 9007199254740991 - p_amount) then
    return jsonb_build_object('error', 'The recipient’s demo balance would exceed its limit.');
  end if;

  update takapathai_private.wallets w set balance = w.balance - p_amount where w.user_id = actor_id;
  update takapathai_private.wallets w set balance = w.balance + p_amount where w.user_id = receiver_id;
  insert into takapathai_private.transfers (sender_id, recipient_id, request_id, amount, kind)
  values (actor_id, receiver_id, p_request_id, p_amount, p_kind)
  returning id into transfer_id;
  return jsonb_build_object('id', transfer_id);
end;
$$;

revoke all on function public.takapathai_create_wallet(text, text) from public, anon, authenticated;
revoke all on function public.takapathai_wallet() from public, anon, authenticated;
revoke all on function public.takapathai_find_wallet(text) from public, anon, authenticated;
revoke all on function public.takapathai_send(text, bigint, text, uuid, text) from public, anon, authenticated;
grant execute on function public.takapathai_create_wallet(text, text) to authenticated;
grant execute on function public.takapathai_wallet() to authenticated;
grant execute on function public.takapathai_find_wallet(text) to authenticated;
grant execute on function public.takapathai_send(text, bigint, text, uuid, text) to authenticated;

commit;
