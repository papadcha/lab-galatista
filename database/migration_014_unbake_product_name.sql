-- ============================================================
--  MIGRATION 014 — Un-bake σύνθετο όνομα προϊόντος
--  Ημερομηνία: 2026-07-03
--  Αναιρέσιμη με: rollback_014.sql (SET name = material_type || ' ' || d_min/d_max)
-- ============================================================
--
--  Πρόβλημα: το `tbl_products.name` έπρεπε να είναι πάντα το ωμό
--  material_type (πχ "3Α", "ΑΜΜΟΣ") — η σύνθεση με d_min/d_max
--  ("3Α 0/31.5") γίνεται μόνο στο display layer
--  (App.formatProduct() στο frontend, _build_product_name() στο
--  backend PDF rendering). Το migration_005 (και το add_product/
--  update_product πριν από αυτό το fix) έγραφαν το σύνθετο string
--  απευθείας στο name — οπότε κάθε προϊόν που είχε επεξεργαστεί
--  ποτέ από τις Ρυθμίσεις κατέληγε με name="3Α 0/31.5", και το
--  formatProduct() το ξαναπρόσθετε από πάνω → "3Α 0/31.5 0/31.5".
--
--  Fix: επαναφορά name = material_type για κάθε γραμμή όπου το
--  material_type έχει ήδη τιμή (δηλαδή έχει περάσει ποτέ από
--  add_product/update_product). Γραμμές που δεν έχουν επεξεργαστεί
--  ποτέ (material_type IS NULL) δεν επηρεάζονται — το name τους
--  ήταν ήδη ωμό.
-- ============================================================

UPDATE tbl_products
   SET name = material_type
 WHERE material_type IS NOT NULL
   AND name != material_type;
