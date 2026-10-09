-- Simplified fixture boundaries for the launch area (not official SCB polygons).
-- Söderhamn kommun (2180) and Gävleborg län (21). Replace with open boundary data later.

INSERT INTO "regions" ("id", "name", "kind", "code", "boundary") VALUES
  (
    '22222222-2222-4222-8222-222222222201',
    'Söderhamn',
    'municipality',
    '2180',
    ST_GeogFromText('SRID=4326;MULTIPOLYGON(((16.85 61.15, 17.35 61.15, 17.35 61.45, 16.85 61.45, 16.85 61.15)))')
  ),
  (
    '22222222-2222-4222-8222-222222222202',
    'Gävleborg',
    'county',
    '21',
    ST_GeogFromText('SRID=4326;MULTIPOLYGON(((15.5 60.5, 18.0 60.5, 18.0 62.5, 15.5 62.5, 15.5 60.5)))')
  )
ON CONFLICT ("code") DO NOTHING;
