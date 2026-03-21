-- ============================================
-- WMS PROFESIONAL - Schema Modular
-- PostgreSQL Database Schema
-- ============================================
-- Sistema diseñado para soportar múltiples módulos:
-- - Core (usuarios, roles, configuraciones)
-- - DropScan (escaneo de guías)
-- - Inventory (gestión de inventario) - Futuro
-- - Track (rastreo) - Futuro
-- - Validate (validación) - Futuro
-- - Dispatch (despacho) - Futuro
-- ============================================

-- Eliminar tablas si existen (solo para desarrollo)
DROP TABLE IF EXISTS alertas_duplicados CASCADE;
DROP TABLE IF EXISTS guias CASCADE;
DROP TABLE IF EXISTS sesiones_escaneo CASCADE;
DROP TABLE IF EXISTS tarimas CASCADE;
DROP TABLE IF EXISTS configuraciones CASCADE;
DROP TABLE IF EXISTS usuarios CASCADE;
DROP TABLE IF EXISTS roles CASCADE;

-- ============================================
-- MÓDULO CORE - USUARIOS Y ROLES
-- ============================================

CREATE TABLE roles (
  id SERIAL PRIMARY KEY,
  nombre VARCHAR(50) UNIQUE NOT NULL,
  descripcion TEXT,
  permisos JSONB NOT NULL DEFAULT '{}',
  activo BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE roles IS 'Roles del sistema con permisos modulares';
COMMENT ON COLUMN roles.permisos IS 'JSON con permisos por módulo: {dropscan: {dashboard: "lectura", escaneo: "escritura"}, inventory: {...}}';

CREATE TABLE usuarios (
  id SERIAL PRIMARY KEY,
  codigo VARCHAR(20) UNIQUE NOT NULL,
  nombre_completo VARCHAR(100) NOT NULL,
  email VARCHAR(100) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  rol_id INTEGER REFERENCES roles(id) ON DELETE SET NULL,
  estado VARCHAR(20) DEFAULT 'ACTIVO' CHECK (estado IN ('ACTIVO', 'INACTIVO', 'SUSPENDIDO')),
  permisos_override JSONB,
  google_id VARCHAR(255),
  avatar_url TEXT,
  ultimo_acceso TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE usuarios IS 'Usuarios del sistema WMS';
COMMENT ON COLUMN usuarios.google_id IS 'ID de Google OAuth (opcional)';
COMMENT ON COLUMN usuarios.permisos_override IS 'Permisos específicos que sobreescriben los del rol';

CREATE INDEX idx_usuarios_email ON usuarios(email);
CREATE INDEX idx_usuarios_codigo ON usuarios(codigo);
CREATE INDEX idx_usuarios_rol_id ON usuarios(rol_id);
CREATE INDEX idx_usuarios_estado ON usuarios(estado);
CREATE INDEX idx_usuarios_google_id ON usuarios(google_id);

-- ============================================
-- MÓDULO CORE - CONFIGURACIONES COMPARTIDAS
-- ============================================

CREATE TABLE configuraciones (
  id SERIAL PRIMARY KEY,
  modulo VARCHAR(50) NOT NULL,
  tipo VARCHAR(50) NOT NULL,
  codigo VARCHAR(50) NOT NULL,
  nombre VARCHAR(100) NOT NULL,
  descripcion TEXT,
  config_json JSONB,
  activo BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(modulo, tipo, codigo)
);

COMMENT ON TABLE configuraciones IS 'Configuraciones compartidas entre módulos';
COMMENT ON COLUMN configuraciones.modulo IS 'Módulo al que pertenece: dropscan, inventory, dispatch, etc.';
COMMENT ON COLUMN configuraciones.tipo IS 'Tipo de configuración: empresa, canal, ubicacion, transportista, etc.';
COMMENT ON COLUMN configuraciones.config_json IS 'Configuración adicional específica del tipo';

CREATE INDEX idx_configuraciones_modulo ON configuraciones(modulo);
CREATE INDEX idx_configuraciones_tipo ON configuraciones(tipo);
CREATE INDEX idx_configuraciones_codigo ON configuraciones(codigo);
CREATE INDEX idx_configuraciones_activo ON configuraciones(activo);

-- Ejemplos de uso:
-- modulo='dropscan', tipo='empresa', codigo='DHL', nombre='DHL Express'
-- modulo='dropscan', tipo='canal', codigo='BODEGA-A', nombre='Bodega A'
-- modulo='inventory', tipo='ubicacion', codigo='A001', nombre='Almacén A - Rack 001'
-- modulo='dispatch', tipo='transportista', codigo='TRP001', nombre='Transportes Unidos'

-- ============================================
-- MÓDULO DROPSCAN - ESCANEO DE GUÍAS
-- ============================================

CREATE TABLE tarimas (
  id SERIAL PRIMARY KEY,
  codigo VARCHAR(50) UNIQUE NOT NULL,
  empresa_id INTEGER REFERENCES configuraciones(id) ON DELETE RESTRICT NOT NULL,
  canal_id INTEGER REFERENCES configuraciones(id) ON DELETE RESTRICT NOT NULL,
  operador_id INTEGER REFERENCES usuarios(id) ON DELETE RESTRICT NOT NULL,
  estado VARCHAR(20) DEFAULT 'EN_PROCESO' CHECK (estado IN ('EN_PROCESO', 'COMPLETA', 'CANCELADA')),
  cantidad_guias INTEGER DEFAULT 0 CHECK (cantidad_guias >= 0 AND cantidad_guias <= 100),
  fecha_inicio TIMESTAMP NOT NULL,
  fecha_cierre TIMESTAMP,
  tiempo_armado_segundos INTEGER,
  bloqueada BOOLEAN DEFAULT false,
  bloqueada_por INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  bloqueada_fecha TIMESTAMP,
  bloqueada_razon TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT chk_fecha_cierre CHECK (fecha_cierre IS NULL OR fecha_cierre >= fecha_inicio)
);

COMMENT ON TABLE tarimas IS 'Tarimas de 100 guías - Módulo DropScan';
COMMENT ON COLUMN tarimas.codigo IS 'Código autogenerado (ej: TAR-20260304-001)';

CREATE INDEX idx_tarimas_empresa ON tarimas(empresa_id);
CREATE INDEX idx_tarimas_canal ON tarimas(canal_id);
CREATE INDEX idx_tarimas_operador ON tarimas(operador_id);
CREATE INDEX idx_tarimas_estado ON tarimas(estado);
CREATE INDEX idx_tarimas_fecha_inicio ON tarimas(fecha_inicio);
CREATE INDEX idx_tarimas_bloqueada ON tarimas(bloqueada);

CREATE TABLE guias (
  id SERIAL PRIMARY KEY,
  codigo_guia VARCHAR(100) NOT NULL,
  tarima_id INTEGER REFERENCES tarimas(id) ON DELETE CASCADE NOT NULL,
  posicion INTEGER NOT NULL CHECK (posicion >= 1 AND posicion <= 100),
  operador_id INTEGER REFERENCES usuarios(id) ON DELETE RESTRICT NOT NULL,
  timestamp_escaneo TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE guias IS 'Guías escaneadas en cada tarima - Módulo DropScan';

CREATE UNIQUE INDEX idx_guias_codigo_tarima ON guias(codigo_guia, tarima_id);
CREATE INDEX idx_guias_tarima ON guias(tarima_id);
CREATE INDEX idx_guias_codigo ON guias(codigo_guia);
CREATE INDEX idx_guias_timestamp ON guias(timestamp_escaneo);

CREATE TABLE sesiones_escaneo (
  id SERIAL PRIMARY KEY,
  operador_id INTEGER REFERENCES usuarios(id) ON DELETE RESTRICT NOT NULL,
  empresa_id INTEGER REFERENCES configuraciones(id) ON DELETE RESTRICT NOT NULL,
  canal_id INTEGER REFERENCES configuraciones(id) ON DELETE RESTRICT NOT NULL,
  tarima_actual_id INTEGER REFERENCES tarimas(id) ON DELETE SET NULL,
  fecha_inicio TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  fecha_fin TIMESTAMP,
  tarimas_completadas INTEGER DEFAULT 0,
  total_guias INTEGER DEFAULT 0,
  alertas_duplicados INTEGER DEFAULT 0,
  activa BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE sesiones_escaneo IS 'Sesiones de escaneo de operadores - Módulo DropScan';

CREATE INDEX idx_sesiones_operador ON sesiones_escaneo(operador_id);
CREATE INDEX idx_sesiones_activa ON sesiones_escaneo(activa);

CREATE TABLE alertas_duplicados (
  id SERIAL PRIMARY KEY,
  codigo_guia VARCHAR(100) NOT NULL,
  tarima_id INTEGER REFERENCES tarimas(id) ON DELETE CASCADE NOT NULL,
  operador_id INTEGER REFERENCES usuarios(id) ON DELETE RESTRICT NOT NULL,
  guia_original_id INTEGER REFERENCES guias(id) ON DELETE SET NULL,
  tarima_original_id INTEGER REFERENCES tarimas(id) ON DELETE SET NULL,
  timestamp_alerta TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE alertas_duplicados IS 'Registro de intentos de escaneo duplicado - Módulo DropScan';

CREATE INDEX idx_alertas_tarima ON alertas_duplicados(tarima_id);
CREATE INDEX idx_alertas_timestamp ON alertas_duplicados(timestamp_alerta);

-- ============================================
-- MÓDULO INVENTORY - GESTIÓN DE INVENTARIO (FUTURO)
-- ============================================

-- Estas tablas se crearán durante la migración del módulo Inventory

-- CREATE TABLE productos (
--   id SERIAL PRIMARY KEY,
--   codigo VARCHAR(100) UNIQUE NOT NULL,
--   sku VARCHAR(100),
--   nombre VARCHAR(200),
--   ubicacion_id INTEGER REFERENCES configuraciones(id),
--   stock INTEGER DEFAULT 0,
--   estado VARCHAR(20),
--   almacen VARCHAR(50),
--   actualizado_at TIMESTAMP,
--   created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
-- );

-- CREATE TABLE pallets (
--   id SERIAL PRIMARY KEY,
--   codigo VARCHAR(50) UNIQUE NOT NULL,
--   categoria VARCHAR(20) CHECK (categoria IN ('ok', 'blocked', 'nowms')),
--   estado VARCHAR(20) DEFAULT 'EN_PROCESO',
--   cantidad_cajas INTEGER DEFAULT 0,
--   operador_id INTEGER REFERENCES usuarios(id),
--   fecha_creacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
--   fecha_envio TIMESTAMP
-- );

-- CREATE TABLE cajas_pallet (
--   id SERIAL PRIMARY KEY,
--   pallet_id INTEGER REFERENCES pallets(id) ON DELETE CASCADE,
--   producto_id INTEGER REFERENCES productos(id),
--   codigo_caja VARCHAR(100),
--   ubicacion_destino VARCHAR(50),
--   posicion INTEGER,
--   timestamp_escaneo TIMESTAMP DEFAULT CURRENT_TIMESTAMP
-- );

-- ============================================
-- MÓDULO VALIDATE - VALIDACIÓN (FUTURO)
-- ============================================

-- CREATE TABLE sesiones_validacion (
--   id SERIAL PRIMARY KEY,
--   operador_id INTEGER REFERENCES usuarios(id),
--   fecha_inicio TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
--   fecha_fin TIMESTAMP,
--   total_validaciones INTEGER DEFAULT 0,
--   codigos_validos INTEGER DEFAULT 0,
--   codigos_invalidos INTEGER DEFAULT 0,
--   activa BOOLEAN DEFAULT true
-- );

-- CREATE TABLE validaciones (
--   id SERIAL PRIMARY KEY,
--   sesion_id INTEGER REFERENCES sesiones_validacion(id),
--   codigo VARCHAR(100),
--   es_valido BOOLEAN,
--   producto_id INTEGER REFERENCES productos(id),
--   timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
-- );

-- ============================================
-- MÓDULO DISPATCH - DESPACHO (FUTURO)
-- ============================================

-- CREATE TABLE ordenes_despacho (
--   id SERIAL PRIMARY KEY,
--   numero_orden VARCHAR(50) UNIQUE NOT NULL,
--   destino VARCHAR(100),
--   horario VARCHAR(50),
--   referencia VARCHAR(100),
--   tracking VARCHAR(100),
--   cantidad_cajas INTEGER,
--   cantidad_despachar INTEGER,
--   porcentaje_surtido DECIMAL(5,2),
--   estatus VARCHAR(50),
--   calidad VARCHAR(50),
--   estado VARCHAR(20) DEFAULT 'PENDIENTE',
--   fecha_orden DATE,
--   created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
-- );

-- CREATE TABLE validaciones_despacho (
--   id SERIAL PRIMARY KEY,
--   orden_id INTEGER REFERENCES ordenes_despacho(id),
--   operador_id INTEGER REFERENCES usuarios(id),
--   conductor VARCHAR(100),
--   unidad VARCHAR(50),
--   folio_id INTEGER REFERENCES folios(id),
--   fecha_validacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
--   observaciones TEXT
-- );

-- CREATE TABLE folios (
--   id SERIAL PRIMARY KEY,
--   codigo VARCHAR(50) UNIQUE NOT NULL,
--   destino VARCHAR(100),
--   conductor VARCHAR(100),
--   unidad VARCHAR(50),
--   horario_inicial VARCHAR(50),
--   horario_final VARCHAR(50),
--   cantidad_ordenes INTEGER DEFAULT 0,
--   cantidad_cajas INTEGER DEFAULT 0,
--   fecha_creacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
--   operador_id INTEGER REFERENCES usuarios(id)
-- );

-- ============================================
-- FUNCIONES Y TRIGGERS
-- ============================================

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_roles_updated_at BEFORE UPDATE ON roles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_usuarios_updated_at BEFORE UPDATE ON usuarios
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_configuraciones_updated_at BEFORE UPDATE ON configuraciones
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_tarimas_updated_at BEFORE UPDATE ON tarimas
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_sesiones_updated_at BEFORE UPDATE ON sesiones_escaneo
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Función para calcular tiempo de armado al cerrar tarima
CREATE OR REPLACE FUNCTION calcular_tiempo_armado()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.estado = 'COMPLETA' AND OLD.estado != 'COMPLETA' THEN
    NEW.tiempo_armado_segundos = EXTRACT(EPOCH FROM (NEW.fecha_cierre - NEW.fecha_inicio))::INTEGER;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_calcular_tiempo_armado BEFORE UPDATE ON tarimas
  FOR EACH ROW EXECUTE FUNCTION calcular_tiempo_armado();

-- ============================================
-- DATOS INICIALES
-- ============================================

-- Roles con sistema de 5 niveles y permisos modulares
INSERT INTO roles (nombre, descripcion, permisos) VALUES
('Administrador', 'Acceso total al sistema', '{
  "global": {
    "dashboard": "total",
    "administracion": "total"
  },
  "dropscan": {
    "dashboard": "total",
    "escaneo": "total",
    "historial": "total",
    "reportes": "total"
  }
}'::jsonb),

('Jefe', 'Supervisor de operaciones', '{
  "global": {
    "dashboard": "lectura",
    "administracion": "sin_acceso"
  },
  "dropscan": {
    "dashboard": "lectura",
    "escaneo": "gestion",
    "historial": "gestion",
    "reportes": "escritura"
  }
}'::jsonb),

('Operador', 'Operador de escaneo', '{
  "global": {
    "dashboard": "lectura",
    "administracion": "sin_acceso"
  },
  "dropscan": {
    "dashboard": "lectura",
    "escaneo": "escritura",
    "historial": "lectura",
    "reportes": "sin_acceso"
  }
}'::jsonb),

('Usuario', 'Solo consulta', '{
  "global": {
    "dashboard": "lectura",
    "administracion": "sin_acceso"
  },
  "dropscan": {
    "dashboard": "lectura",
    "escaneo": "sin_acceso",
    "historial": "lectura",
    "reportes": "lectura"
  }
}'::jsonb);

-- Usuario administrador inicial
-- Password: admin123 (CAMBIAR EN PRODUCCIÓN)
-- Hash bcrypt: $2b$10$rKZLvVZGxVqKfXKGxVqKfOxVqKfXKGxVqKfXKGxVqKfXKGxVqKfXK
INSERT INTO usuarios (codigo, nombre_completo, email, password_hash, rol_id, estado) VALUES
('ADM001', 'Administrador Sistema', 'admin@wms.com', '$2b$10$rKZLvVZGxVqKfXKGxVqKfOxVqKfXKGxVqKfXKGxVqKfXKGxVqKfXK', 1, 'ACTIVO');

-- Configuraciones iniciales para DropScan
INSERT INTO configuraciones (modulo, tipo, codigo, nombre, descripcion, activo) VALUES
-- Empresas de paquetería
('dropscan', 'empresa', 'DHL', 'DHL Express', 'Empresa de paquetería internacional', true),
('dropscan', 'empresa', 'FEDEX', 'FedEx', 'Empresa de paquetería y logística', true),
('dropscan', 'empresa', 'UPS', 'UPS', 'United Parcel Service', true),
('dropscan', 'empresa', 'ESTAFETA', 'Estafeta', 'Empresa mexicana de paquetería', true),

-- Canales de escaneo
('dropscan', 'canal', 'BODEGA-A', 'Bodega A', 'Bodega principal - Línea 1', true),
('dropscan', 'canal', 'BODEGA-B', 'Bodega B', 'Bodega secundaria - Línea 2', true),
('dropscan', 'canal', 'LINEA-1', 'Línea 1', 'Línea de escaneo 1', true),
('dropscan', 'canal', 'LINEA-2', 'Línea 2', 'Línea de escaneo 2', true);

-- Configuraciones para futuros módulos (ejemplos)
-- INSERT INTO configuraciones (modulo, tipo, codigo, nombre, descripcion, activo) VALUES
-- ('inventory', 'ubicacion', 'A001', 'Almacén A - Rack 001', 'Ubicación en almacén principal', true),
-- ('dispatch', 'transportista', 'TRP001', 'Transportes Unidos', 'Transportista principal', true);

-- ============================================
-- VISTAS ÚTILES
-- ============================================

-- Vista de tarimas con información completa
CREATE OR REPLACE VIEW v_tarimas_completas AS
SELECT 
  t.id,
  t.codigo,
  t.estado,
  t.cantidad_guias,
  t.fecha_inicio,
  t.fecha_cierre,
  t.tiempo_armado_segundos,
  t.bloqueada,
  e.nombre as empresa_nombre,
  e.codigo as empresa_codigo,
  c.nombre as canal_nombre,
  c.codigo as canal_codigo,
  u.nombre_completo as operador_nombre,
  u.codigo as operador_codigo,
  ub.nombre_completo as bloqueada_por_nombre
FROM tarimas t
JOIN configuraciones e ON t.empresa_id = e.id AND e.tipo = 'empresa'
JOIN configuraciones c ON t.canal_id = c.id AND c.tipo = 'canal'
JOIN usuarios u ON t.operador_id = u.id
LEFT JOIN usuarios ub ON t.bloqueada_por = ub.id;

-- Vista de guías con información completa
CREATE OR REPLACE VIEW v_guias_completas AS
SELECT 
  g.id,
  g.codigo_guia,
  g.posicion,
  g.timestamp_escaneo,
  t.codigo as tarima_codigo,
  t.estado as tarima_estado,
  e.nombre as empresa_nombre,
  c.nombre as canal_nombre,
  u.nombre_completo as operador_nombre
FROM guias g
JOIN tarimas t ON g.tarima_id = t.id
JOIN configuraciones e ON t.empresa_id = e.id AND e.tipo = 'empresa'
JOIN configuraciones c ON t.canal_id = c.id AND c.tipo = 'canal'
JOIN usuarios u ON g.operador_id = u.id;

-- Vista de métricas diarias
CREATE OR REPLACE VIEW v_metricas_diarias AS
SELECT 
  DATE(t.fecha_inicio) as fecha,
  COUNT(DISTINCT t.id) as total_tarimas,
  COUNT(DISTINCT CASE WHEN t.estado = 'COMPLETA' THEN t.id END) as tarimas_completadas,
  COUNT(DISTINCT CASE WHEN t.estado = 'EN_PROCESO' THEN t.id END) as tarimas_en_proceso,
  COUNT(g.id) as total_guias,
  COUNT(a.id) as total_alertas,
  AVG(t.tiempo_armado_segundos) as tiempo_promedio_segundos
FROM tarimas t
LEFT JOIN guias g ON t.id = g.tarima_id
LEFT JOIN alertas_duplicados a ON t.id = a.tarima_id
GROUP BY DATE(t.fecha_inicio);

-- ============================================
-- FIN DEL SCHEMA
-- ============================================
