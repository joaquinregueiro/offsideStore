-- Siembra de los catalogos controlados (product-specification.md §4.3).
--
-- POR QUE HACE FALTA: `listings` tiene `club_id`, `brand_id`, `season_id`,
-- `competition_id`, `national_team_id` y `country_id`, pero las seis tablas
-- estaban VACIAS. Sin filas no hay nada que elegir al publicar ni nada que
-- facetar al buscar: la busqueda facetada —que la documentacion llama el
-- diferencial central— no podia construirse.
--
-- ALCANCE: §4.3 marca la siembra como 🟡 HIPOTESIS ("los clubes, selecciones y
-- marcas mas frecuentes de Argentina + principales ligas/copas
-- internacionales"). La lista concreta la aprobo el owner el 2026-09-08. No es
-- una decision tomada desde el codigo.
--
-- ⚠️ LOS ALIAS NO SON DECORACION. PS-024 los exige: "River = River Plate =
-- CARP, resueltos al construir el indice y al parsear la query". El Service de
-- busqueda los mete en `search_vector`, que es exactamente el motivo por el que
-- DEC-042 decidio que el vector NO fuera una columna generada: una columna
-- generada no puede leer otra tabla.
--
-- ⚠️ ESTO NO ES `catalog_change_requests`. DEC-041 define como se dan de alta
-- items NUEVOS —propuesta, revision, aprobacion— y sigue sin implementarse. Esto
-- es la carga inicial, que es otra cosa.
--
-- IDEMPOTENTE por `slug`, que es UNIQUE en las seis tablas.

-- === CLUBES ===
INSERT INTO clubs (name, slug, aliases)
SELECT * FROM (VALUES
  ('River Plate','river-plate',ARRAY['River','CARP','Millonario','Riber']),
  ('Boca Juniors','boca-juniors',ARRAY['Boca','CABJ','Xeneize']),
  ('Racing Club','racing-club',ARRAY['Racing','Academia']),
  ('Independiente','independiente',ARRAY['CAI','Rojo','Independiente de Avellaneda']),
  ('San Lorenzo','san-lorenzo',ARRAY['CASLA','Ciclon','San Lorenzo de Almagro']),
  ('Velez Sarsfield','velez-sarsfield',ARRAY['Velez','Fortin']),
  ('Huracan','huracan',ARRAY['Globo','Quemero']),
  ('Estudiantes de La Plata','estudiantes-la-plata',ARRAY['Estudiantes','Pincha','EDLP']),
  ('Gimnasia y Esgrima La Plata','gimnasia-la-plata',ARRAY['Gimnasia','Lobo','GELP']),
  ('Newells Old Boys','newells-old-boys',ARRAY['Newells','NOB','Leproso']),
  ('Rosario Central','rosario-central',ARRAY['Central','Canalla']),
  ('Colon','colon',ARRAY['Colon de Santa Fe','Sabalero']),
  ('Union','union',ARRAY['Union de Santa Fe','Tatengue']),
  ('Talleres','talleres',ARRAY['Talleres de Cordoba','Matador']),
  ('Belgrano','belgrano',ARRAY['Belgrano de Cordoba','Pirata']),
  ('Instituto','instituto',ARRAY['Instituto de Cordoba','Gloria']),
  ('Lanus','lanus',ARRAY['Granate']),
  ('Banfield','banfield',ARRAY['Taladro']),
  ('Argentinos Juniors','argentinos-juniors',ARRAY['Argentinos','Bicho']),
  ('Platense','platense',ARRAY['Calamar']),
  ('Tigre','tigre',ARRAY['Matador de Victoria']),
  ('Defensa y Justicia','defensa-y-justicia',ARRAY['Defensa','Halcon']),
  ('Godoy Cruz','godoy-cruz',ARRAY['Tomba','Expreso']),
  ('Atletico Tucuman','atletico-tucuman',ARRAY['Decano']),
  ('Central Cordoba','central-cordoba',ARRAY['Central Cordoba de Santiago','Ferroviario']),
  ('Barracas Central','barracas-central',ARRAY['Guapo']),
  ('Sarmiento','sarmiento',ARRAY['Sarmiento de Junin','Verde']),
  ('Independiente Rivadavia','independiente-rivadavia',ARRAY['Lepra mendocina']),
  ('Deportivo Riestra','deportivo-riestra',ARRAY['Riestra']),
  ('Aldosivi','aldosivi',ARRAY['Tiburon']),
  ('Ferro Carril Oeste','ferro-carril-oeste',ARRAY['Ferro','Verdolaga']),
  ('Chacarita Juniors','chacarita-juniors',ARRAY['Chacarita','Funebrero']),
  ('Quilmes','quilmes',ARRAY['Cervecero']),
  ('All Boys','all-boys',ARRAY['Albo']),
  ('Nueva Chicago','nueva-chicago',ARRAY['Chicago','Torito']),
  ('Temperley','temperley',ARRAY['Gasolero']),
  ('Almagro','almagro',ARRAY['Tricolor']),
  ('Arsenal','arsenal',ARRAY['Arsenal de Sarandi','Arse'])
) AS nuevos(name, slug, aliases)
WHERE NOT EXISTS (SELECT 1 FROM clubs c WHERE c.slug = nuevos.slug);

-- === SELECCIONES ===
INSERT INTO national_teams (name, slug, aliases)
SELECT * FROM (VALUES
  ('Argentina','argentina',ARRAY['Seleccion Argentina','Albiceleste','AFA']),
  ('Brasil','brasil',ARRAY['Brazil','Verdeamarela','Canarinha']),
  ('Uruguay','uruguay',ARRAY['Celeste','Charrua']),
  ('Chile','chile',ARRAY['La Roja']),
  ('Colombia','colombia',ARRAY['Cafetera']),
  ('Peru','peru',ARRAY['Blanquirroja']),
  ('Paraguay','paraguay',ARRAY['Albirroja','Guarani']),
  ('Ecuador','ecuador',ARRAY['Tricolor ecuatoriana']),
  ('Bolivia','bolivia',ARRAY['Verde']),
  ('Venezuela','venezuela',ARRAY['Vinotinto']),
  ('Mexico','mexico',ARRAY['Tri']),
  ('Espana','espana',ARRAY['Spain','Roja','Furia']),
  ('Italia','italia',ARRAY['Italy','Azzurri']),
  ('Alemania','alemania',ARRAY['Germany','Mannschaft']),
  ('Francia','francia',ARRAY['France','Bleus']),
  ('Inglaterra','inglaterra',ARRAY['England','Three Lions']),
  ('Paises Bajos','paises-bajos',ARRAY['Holanda','Netherlands','Naranja Mecanica']),
  ('Portugal','portugal',ARRAY['Selecao das Quinas']),
  ('Belgica','belgica',ARRAY['Belgium','Diablos Rojos']),
  ('Croacia','croacia',ARRAY['Croatia','Vatreni']),
  ('Camerun','camerun',ARRAY['Cameroon','Leones Indomables']),
  ('Nigeria','nigeria',ARRAY['Super Eagles']),
  ('Senegal','senegal',ARRAY['Leones de Teranga']),
  ('Japon','japon',ARRAY['Japan','Samurai Blue']),
  ('Estados Unidos','estados-unidos',ARRAY['USA','United States'])
) AS nuevos(name, slug, aliases)
WHERE NOT EXISTS (SELECT 1 FROM national_teams n WHERE n.slug = nuevos.slug);

-- === MARCAS ===
INSERT INTO brands (name, slug, aliases)
SELECT * FROM (VALUES
  ('adidas','adidas',ARRAY['Adidas']),
  ('Nike','nike',NULL::text[]),
  ('Puma','puma',NULL::text[]),
  ('Umbro','umbro',NULL::text[]),
  ('Topper','topper',NULL::text[]),
  ('Penalty','penalty',NULL::text[]),
  ('Kappa','kappa',NULL::text[]),
  ('Le Coq Sportif','le-coq-sportif',ARRAY['Le Coq','LeCoq']),
  ('Reebok','reebok',NULL::text[]),
  ('Lotto','lotto',NULL::text[]),
  ('Fila','fila',NULL::text[]),
  ('Charly','charly',NULL::text[]),
  ('Athleta','athleta',NULL::text[]),
  ('Olympikus','olympikus',NULL::text[]),
  ('Joma','joma',NULL::text[]),
  ('Macron','macron',NULL::text[]),
  ('Uhlsport','uhlsport',NULL::text[]),
  ('New Balance','new-balance',ARRAY['NB'])
) AS nuevos(name, slug, aliases)
WHERE NOT EXISTS (SELECT 1 FROM brands b WHERE b.slug = nuevos.slug);

-- === COMPETICIONES ===
INSERT INTO competitions (name, slug, aliases)
SELECT * FROM (VALUES
  ('Liga Profesional','liga-profesional',ARRAY['Liga','Torneo local','Primera Division']),
  ('Copa de la Liga Profesional','copa-de-la-liga',ARRAY['Copa de la Liga']),
  ('Copa Argentina','copa-argentina',NULL::text[]),
  ('Supercopa Argentina','supercopa-argentina',NULL::text[]),
  ('Copa Libertadores','copa-libertadores',ARRAY['Libertadores']),
  ('Copa Sudamericana','copa-sudamericana',ARRAY['Sudamericana']),
  ('Recopa Sudamericana','recopa-sudamericana',ARRAY['Recopa']),
  ('Copa Mundial de la FIFA','mundial',ARRAY['Mundial','World Cup','Copa del Mundo']),
  ('Copa America','copa-america',NULL::text[]),
  ('Finalissima','finalissima',NULL::text[]),
  ('UEFA Champions League','champions-league',ARRAY['Champions','UCL','Copa de Europa']),
  ('Premier League','premier-league',ARRAY['Premier']),
  ('LaLiga','laliga',ARRAY['La Liga','Liga espanola']),
  ('Serie A','serie-a',ARRAY['Calcio']),
  ('Bundesliga','bundesliga',NULL::text[]),
  ('Ligue 1','ligue-1',NULL::text[])
) AS nuevos(name, slug, aliases)
WHERE NOT EXISTS (SELECT 1 FROM competitions co WHERE co.slug = nuevos.slug);

-- === PAISES ===
-- Para `listings.country_id`, que el ERD describe como pais de FABRICACION.
INSERT INTO countries (name, slug, iso_code)
SELECT * FROM (VALUES
  ('Argentina','argentina','AR'), ('Brasil','brasil','BR'), ('Uruguay','uruguay','UY'),
  ('Chile','chile','CL'), ('Colombia','colombia','CO'), ('Peru','peru','PE'),
  ('Paraguay','paraguay','PY'), ('Ecuador','ecuador','EC'), ('Bolivia','bolivia','BO'),
  ('Venezuela','venezuela','VE'), ('Mexico','mexico','MX'), ('Estados Unidos','estados-unidos','US'),
  ('Espana','espana','ES'), ('Italia','italia','IT'), ('Alemania','alemania','DE'),
  ('Francia','francia','FR'), ('Reino Unido','reino-unido','GB'), ('Paises Bajos','paises-bajos','NL'),
  ('Portugal','portugal','PT'), ('Belgica','belgica','BE'), ('Croacia','croacia','HR'),
  ('Suiza','suiza','CH'), ('Austria','austria','AT'), ('Polonia','polonia','PL'),
  ('Turquia','turquia','TR'), ('Marruecos','marruecos','MA'), ('Tunez','tunez','TN'),
  ('Egipto','egipto','EG'), ('Sudafrica','sudafrica','ZA'), ('China','china','CN'),
  ('Vietnam','vietnam','VN'), ('Indonesia','indonesia','ID'), ('Tailandia','tailandia','TH'),
  ('India','india','IN'), ('Bangladesh','bangladesh','BD'), ('Pakistan','pakistan','PK'),
  ('Camboya','camboya','KH'), ('Japon','japon','JP'), ('Corea del Sur','corea-del-sur','KR'),
  ('Australia','australia','AU')
) AS nuevos(name, slug, iso_code)
WHERE NOT EXISTS (SELECT 1 FROM countries p WHERE p.slug = nuevos.slug);

-- === TEMPORADAS ===
--
-- Se GENERAN en vez de listarlas: son una serie regular y escribir 130 filas a
-- mano es una invitacion a que falte una.
--
-- Dos formas conviven a proposito, porque las camisetas usan las dos: el ano
-- suelto ("1986", tipico de mundiales y del futbol argentino de esa epoca) y la
-- temporada cruzada ("1996-97", habitual en Europa y en el futbol argentino
-- moderno). El alias corto —"96/97"— es como la gente escribe.
INSERT INTO seasons (name, slug, label, aliases)
SELECT anio::text, anio::text, anio::text, NULL::text[]
  FROM generate_series(1960, 2027) AS anio
 WHERE NOT EXISTS (SELECT 1 FROM seasons s WHERE s.slug = anio::text);

INSERT INTO seasons (name, slug, label, aliases)
SELECT anio || '-' || right((anio + 1)::text, 2),
       anio || '-' || right((anio + 1)::text, 2),
       anio || '-' || right((anio + 1)::text, 2),
       ARRAY[right(anio::text, 2) || '/' || right((anio + 1)::text, 2)]
  FROM generate_series(1960, 2026) AS anio
 WHERE NOT EXISTS (
   SELECT 1 FROM seasons s WHERE s.slug = anio || '-' || right((anio + 1)::text, 2)
 );
