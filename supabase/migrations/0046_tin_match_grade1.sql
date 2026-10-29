-- Two things at once. Safe to run any number of times.
--
-- 1. A customer's TIN reaches their older sales under a SIMILAR name, not only
--    the identical one. "Mela Soap & Detergent", "Mela Soap and Detergent" and
--    "Mela soap  & Detergent PLC" are one buyer; so is "Betelheme Tigabu" and
--    "Betelhem Tigabu". Names are compared after normalising (case, "&"/"and",
--    punctuation, PLC / S.C / share company, spacing), and then allowed one or
--    two letters of typo. Only sales with NO TIN are filled, and only when
--    exactly one TIN matches — two buyers sharing a name are left alone, and a
--    TIN somebody set is never overwritten.
--
-- 2. Daily production can carry a Grade 1 part. Grade 1 is produced rarely and
--    sells at its own price, so it is kept apart: `production_reports.grade1`
--    holds { products, stock, delivered } (tonnes) for that day, and nothing
--    that adds up `products` sees it. Null means no Grade 1 that day.

/* ─────────────────────────── 1. Similar-name TINs ─────────────────────────── */

create extension if not exists fuzzystrmatch;  -- levenshtein()

-- The comparison form of a customer name.
create or replace function customer_name_key(name text) returns text
language sql immutable as $$
  select trim(regexp_replace(
           regexp_replace(
             regexp_replace(
               replace(replace(lower(coalesce(name, '')), '&', ' and '), '.', ''),
               '[^[:alnum:]]+', ' ', 'g'),
             '\m(plc|sc|share company)\M', ' ', 'g'),
           '\s+', ' ', 'g'))
$$;

-- Same buyer? Equal keys, or a typo apart: none under 5 letters, one under 8,
-- two from 8 up.
create or replace function customer_names_match(a text, b text) returns boolean
language sql immutable as $$
  with k as (select customer_name_key(a) as ka, customer_name_key(b) as kb)
  select ka <> '' and kb <> '' and (
           ka = kb
           or (least(length(ka), length(kb)) >= 5
               and greatest(length(ka), length(kb)) < 255
               and levenshtein(ka, kb) <= case when least(length(ka), length(kb)) < 8 then 1 else 2 end)
         )
    from k
$$;

-- Fill empty TINs from similar names. With p_tin, only the sales that would
-- take THAT TIN are filled (the bot, after a sale with one). Returns how many
-- rows changed.
create or replace function fill_customer_tins(p_tin text default null) returns integer
language plpgsql as $$
declare n integer;
begin
  with known as (
    select distinct customer, tin
      from sales_invoices
     where tin ~ '^[0-9]{10}$'
  ),
  candidates as (
    select s.id, k.tin
      from sales_invoices s
      join known k on customer_names_match(s.customer, k.customer)
     where s.tin is null
  ),
  single as (
    select id, min(tin) as tin
      from candidates
     group by id
    having count(distinct tin) = 1
  )
  update sales_invoices s
     set tin = single.tin, updated_at = now()
    from single
   where s.id = single.id
     and s.tin is null
     and (p_tin is null or single.tin = p_tin);
  get diagnostics n = row_count;
  return n;
end $$;

/* ─────────────────────────── 2. Grade 1 production ────────────────────────── */

alter table production_reports add column if not exists grade1 jsonb;  -- { products:{}, stock:{}, delivered:{} }
