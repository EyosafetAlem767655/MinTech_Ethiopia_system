-- The purchase request grows the columns a new-tool request is made of.
--
-- One guided flow now sits behind the 🛒 button, asking first which kind of
-- request it is. A damaged item is a claim with a photograph behind it and needs
-- nothing new. A new tool is a case: what it is, described; how many and in
-- what unit; why; for which department; and anything else worth saying. Those
-- four extra answers are what these columns hold — `title`, `quantity`, `kind`
-- and `justification` (the reason) were already here.
--
-- All nullable, and the insert lists them as optional (src/lib/insert.ts): a
-- request filed before this runs keeps its title, quantity, kind and reason.

alter table purchase_requests
  add column if not exists description text,   -- new tool: type, size, model, …
  add column if not exists unit        text,   -- 'pcs' | 'pack'
  add column if not exists department text,    -- requesting department key, or 'other'
  add column if not exists notes       text;   -- both kinds
