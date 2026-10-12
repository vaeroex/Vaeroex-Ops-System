-- Reduce the published Executive Intelligence base subscription price.
-- Historical billing and legal acceptance receipts remain immutable.
do $$
declare
  v_updated integer;
begin
  update public.subscription_plans
  set monthly_price_cents = 25000,
      updated_at = now()
  where slug = 'vaeroex'
    and monthly_price_cents = 50000;

  get diagnostics v_updated = row_count;
  if v_updated <> 1 then
    raise exception 'Expected exactly one $500 Vaeroex plan before the $250 price change';
  end if;
end;
$$;
