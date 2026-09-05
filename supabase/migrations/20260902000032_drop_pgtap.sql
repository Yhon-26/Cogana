-- Elimina la extensión pgTAP de la base de datos. pgTAP se instaló de forma
-- manual en el stack remoto para ejecutar las pruebas RLS, pero no debe residir
-- en producción: añade superficie de ataque y la versión instalada es
-- incompatible con PostgreSQL 17 (columnas pg_proc.proisagg y
-- pg_tablespace.spclocation eliminadas).
--
-- En el entorno de pruebas (`supabase test db`), el CLI instala pgTAP después
-- de aplicar las migraciones sobre una base recién creada, por lo que este
-- DROP con IF EXISTS es un no-op y las pruebas siguen funcionando.

drop extension if exists pgtap cascade;
