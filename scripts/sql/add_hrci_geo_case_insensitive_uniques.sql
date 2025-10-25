-- Creates case-insensitive unique indexes to prevent duplicate names differing only by case/whitespace.
-- IMPORTANT: Run only after resolving any existing duplicates; otherwise creation will fail.

-- States: unique on lower(trim(name))
CREATE UNIQUE INDEX IF NOT EXISTS hrcstate_name_ci_unique
  ON "HrcState" ((lower(btrim(name))));

-- Districts: unique per state on lower(trim(name))
CREATE UNIQUE INDEX IF NOT EXISTS hrcdistrict_state_name_ci_unique
  ON "HrcDistrict" ("stateId", (lower(btrim(name))));

-- Mandals: unique per district on lower(trim(name))
CREATE UNIQUE INDEX IF NOT EXISTS hrcmandal_district_name_ci_unique
  ON "HrcMandal" ("districtId", (lower(btrim(name))));
