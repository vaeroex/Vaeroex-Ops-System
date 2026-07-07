update public.subscription_plans
set monthly_price_cents = 50000,
    description = 'Operations Intelligence for executives, business owners, CEOs, COOs, and operations leaders who need private Business Memory, evidence-backed recommendations, and leadership decision support.',
    features_json = '[
      "Private Business Workspace",
      "Business Memory",
      "Operations Intelligence",
      "KPI Intelligence",
      "Evidence-backed recommendations",
      "Executive brief generation",
      "Ask Vaeroex",
      "File analysis & imports",
      "Continuous platform improvements",
      "Leadership decision support",
      "Business Health Score",
      "Profit Leak Detector",
      "Security Features",
      "Help Center"
    ]'::jsonb,
    updated_at = now()
where slug = 'vaeroex';
