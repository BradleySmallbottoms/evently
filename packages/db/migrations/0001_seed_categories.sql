INSERT INTO "categories" ("id", "slug", "parent_id", "name_sv", "name_en") VALUES
  ('11111111-1111-4111-8111-111111111101', 'music', NULL, 'Musik', 'Music'),
  ('11111111-1111-4111-8111-111111111102', 'culture', NULL, 'Kultur', 'Culture'),
  ('11111111-1111-4111-8111-111111111103', 'sports', NULL, 'Sport', 'Sports'),
  ('11111111-1111-4111-8111-111111111104', 'social', NULL, 'Socialt', 'Social'),
  ('11111111-1111-4111-8111-111111111105', 'family', NULL, 'Familj', 'Family'),
  ('11111111-1111-4111-8111-111111111106', 'food', NULL, 'Mat & dryck', 'Food & drink')
ON CONFLICT ("slug") DO NOTHING;
