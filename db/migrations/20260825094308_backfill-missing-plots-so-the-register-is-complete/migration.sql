-- Complete the plot register.
--
-- The register held 122 plots running 6–131 (plus 7A), with ten numbers absent:
-- 1–5 below the range, and 8, 9, 10, 11, 13 as gaps inside it. The estate is
-- numbered 1–131, so those ten were simply never recorded rather than not
-- existing. This adds them, giving 131 numbered plots plus 7A = 132.
--
-- They come in as Unregistered with no owner and no 2025 balance. That matters
-- financially: only Occupied plots count toward the monthly fee, so the target,
-- the arrears and the fund balance are all unchanged by this. What changes is
-- the plot count and the Unregistered tally — the register now shows the whole
-- estate, including the plots nobody has been recorded against yet.
--
-- sort_order is set from the plot number so this data reads sensibly on its
-- own, but nothing depends on it: display order is derived from the number
-- itself in shape.ts.
--
-- ON CONFLICT DO NOTHING makes this safe to re-run, and safe if a committee
-- member happens to have added one of these by hand first.

INSERT INTO plots (house_no, owner, status, bf_2025, sort_order) VALUES
  ('1',  NULL, 'Unregistered', NULL, 1),
  ('2',  NULL, 'Unregistered', NULL, 2),
  ('3',  NULL, 'Unregistered', NULL, 3),
  ('4',  NULL, 'Unregistered', NULL, 4),
  ('5',  NULL, 'Unregistered', NULL, 5),
  ('8',  NULL, 'Unregistered', NULL, 8),
  ('9',  NULL, 'Unregistered', NULL, 9),
  ('10', NULL, 'Unregistered', NULL, 10),
  ('11', NULL, 'Unregistered', NULL, 11),
  ('13', NULL, 'Unregistered', NULL, 13)
ON CONFLICT (house_no) DO NOTHING;
