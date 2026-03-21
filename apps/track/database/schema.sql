-- ============================================
-- Sistema de Trazabilidad de Guías (Track)
-- PostgreSQL Database Schema
-- ============================================

-- Eliminar tablas si existen (solo para desarrollo)
DROP TABLE IF EXISTS alertas_duplicados CASCADE;
DROP TABLE IF EXISTS guias CASCADE;
DROP TABLE IF EXISTS sesiones_escaneo CASCADE;
DROP TABLE IF EXISTS tarimas CASCADE;
DROP TABLE IF EXISTS canales CASCADE;
DROP TABLE IF EXISTS empresas_paqueteria CASCADE;
DROP TABLE IF EXISTS usuarios CASCADE;
DROP TABLE IF EXISTS roles CASCADE;

-- ============================================
-- TABLA: roles
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

COMMENT ON TABLE roles IS 'Roles de usuario con permisos por módulo';
COMMENT ON COLUMN roles.permisos IS 'JSON con permisos por módulo: {dashboard: "lectura", escaneo: "escritura", ...}';

-- ============================================
-- TABLA: usuarios
-- ============================================
CREATE TABLE usuarios (
  id SERIAL PRIMARY KEY,
  codigo VARCHAR(20) UNIQUE NOT NULL,
  nombre_completo VARCHAR(100) NOT NULL,
  email VARCHAR(100) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  rol_id INTEGER REFERENCES roles(id) ON DELETE SET NULL,
  estado VARCHAR(20) DEFAULT 'ACTIVO' CHECK (estado IN ('ACTIVO', 'INACTIVO', 'SUSPENDIDO')),
  permisos_override JSONB,
  ultimo_acceso TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE usuarios IS 'Usuarios del sistema';
COMMENT ON COLUMN usuarios.codigo IS 'Código único del usuario (ej: USR001)';
COMMENT ON COLUMN usuarios.permisos_override IS 'Permisos específicos que sobreescriben los del rol';

CREATE INDEX idx_usuarios_email ON usuarios(email);
CREATE INDEX idx_usuarios_codigo ON usuarios(codigo);
CREATE INDEX idx_usuarios_rol_id ON usuarios(rol_id);
CREATE INDEX idx_usuarios_estado ON usuarios(estado);

-- ============================================
-- TABLA: empresas_paqueteria
-- ============================================
CREATE TABLE empresas_paqueteria (
  id SERIAL PRIMARY KEY,
  codigo VARCHAR(20) UNIQUE NOT NULL,
  nombre VARCHAR(100) NOT NULL,
  descripcion TEXT,
  activo BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE empresas_paqueteria IS 'Empresas de paquetería destino (DHL, FedEx, etc.)';

CREATE INDEX idx_empresas_codigo ON empresas_paqueteria(codigo);
CREATE INDEX idx_empresas_activo ON empresas_paqueteria(activo);

-- ============================================
-- TABLA: canales
-- ============================================
CREATE TABLE canales (
  id SERIAL PRIMARY KEY,
  codigo VARCHAR(20) UNIQUE NOT NULL,
  nombre VARCHAR(100) NOT NULL,
  descripcion TEXT,
  activo BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE canales IS 'Canales de escaneo (Bodega A, Línea 1, etc.)';

CREATE INDEX idx_canales_codigo ON canales(codigo);
CREATE INDEX idx_canales_activo ON canales(activo);

-- ============================================
-- TABLA: tarimas
-- ============================================
CREATE TABLE tarimas (
  id SERIAL PRIMARY KEY,
  codigo VARCHAR(50) UNIQUE NOT NULL,
  empresa_id INTEGER REFERENCES empresas_paqueteria(id) ON DELETE RESTRICT NOT NULL,
  canal_id INTEGER REFERENCES canales(id) ON DELETE RESTRICT NOT NULL,
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

COMMENT ON TABLE tarimas IS 'Tarimas de 100 guías';
COMMENT ON COLUMN tarimas.codigo IS 'Código autogenerado (ej: TAR-20260304-001)';
COMMENT ON COLUMN tarimas.tiempo_armado_segundos IS 'Tiempo total de armado en segundos';

CREATE INDEX idx_tarimas_empresa ON tarimas(empresa_id);
CREATE INDEX idx_tarimas_canal ON tarimas(canal_id);
CREATE INDEX idx_tarimas_operador ON tarimas(operador_id);
CREATE INDEX idx_tarimas_estado ON tarimas(estado);
CREATE INDEX idx_tarimas_fecha_inicio ON tarimas(fecha_inicio);
CREATE INDEX idx_tarimas_fecha_cierre ON tarimas(fecha_cierre);
CREATE INDEX idx_tarimas_bloqueada ON tarimas(bloqueada);

-- ============================================
-- TABLA: guias
-- ============================================
CREATE TABLE guias (
  id SERIAL PRIMARY KEY,
  codigo_guia VARCHAR(100) NOT NULL,
  tarima_id INTEGER REFERENCES tarimas(id) ON DELETE CASCADE NOT NULL,
  posicion INTEGER NOT NULL CHECK (posicion >= 1 AND posicion <= 100),
  operador_id INTEGER REFERENCES usuarios(id) ON DELETE RESTRICT NOT NULL,
  timestamp_escaneo TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE guias IS 'Guías escaneadas en cada tarima';
COMMENT ON COLUMN guias.posicion IS 'Posición dentro de la tarima (1-100)';

CREATE UNIQUE INDEX idx_guias_codigo_tarima ON guias(codigo_guia, tarima_id);
CREATE INDEX idx_guias_tarima ON guias(tarima_id);
CREATE INDEX idx_guias_codigo ON guias(codigo_guia);
CREATE INDEX idx_guias_timestamp ON guias(timestamp_escaneo);
CREATE INDEX idx_guias_operador ON guias(operador_id);

-- ============================================
-- TABLA: sesiones_escaneo
-- ============================================
CREATE TABLE sesiones_escaneo (
  id SERIAL PRIMARY KEY,
  operador_id INTEGER REFERENCES usuarios(id) ON DELETE RESTRICT NOT NULL,
  empresa_id INTEGER REFERENCES empresas_paqueteria(id) ON DELETE RESTRICT NOT NULL,
  canal_id INTEGER REFERENCES canales(id) ON DELETE RESTRICT NOT NULL,
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

COMMENT ON TABLE sesiones_escaneo IS 'Sesiones de escaneo de operadores';

CREATE INDEX idx_sesiones_operador ON sesiones_escaneo(operador_id);
CREATE INDEX idx_sesiones_activa ON sesiones_escaneo(activa);
CREATE INDEX idx_sesiones_fecha_inicio ON sesiones_escaneo(fecha_inicio);

-- ============================================
-- TABLA: alertas_duplicados
-- ============================================
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

COMMENT ON TABLE alertas_duplicados IS 'Registro de intentos de escaneo duplicado';

CREATE INDEX idx_alertas_tarima ON alertas_duplicados(tarima_id);
CREATE INDEX idx_alertas_timestamp ON alertas_duplicados(timestamp_alerta);
CREATE INDEX idx_alertas_operador ON alertas_duplicados(operador_id);

-- ============================================
-- FUNCIONES Y TRIGGERS
-- ============================================

-- Función para actualizar updated_at automáticamente
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Triggers para updated_at
CREATE TRIGGER update_roles_updated_at BEFORE UPDATE ON roles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_usuarios_updated_at BEFORE UPDATE ON usuarios
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_empresas_updated_at BEFORE UPDATE ON empresas_paqueteria
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_canales_updated_at BEFORE UPDATE ON canales
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

-- Roles predefinidos con sistema de 5 niveles
INSERT INTO roles (nombre, descripcion, permisos) VALUES
('Administrador', 'Acceso total al sistema', '{
  "dashboard": "total",
  "escaneo": "total",
  "historial": "total",
  "busqueda": "total",
  "reportes": "total",
  "configuracion": "total",
  "administracion": "total"
}'::jsonb),

('Jefe', 'Supervisor de operaciones', '{
  "dashboard": "lectura",
  "escaneo": "gestion",
  "historial": "gestion",
  "busqueda": "lectura",
  "reportes": "escritura",
  "configuracion": "escritura",
  "administracion": "sin_acceso"
}'::jsonb),

('Operador', 'Operador de escaneo', '{
  "dashboard": "lectura",
  "escaneo": "escritura",
  "historial": "lectura",
  "busqueda": "lectura",
  "reportes": "sin_acceso",
  "configuracion": "sin_acceso",
  "administracion": "sin_acceso"
}'::jsonb),

('Usuario', 'Solo consulta', '{
  "dashboard": "lectura",
  "escaneo": "sin_acceso",
  "historial": "lectura",
  "busqueda": "lectura",
  "reportes": "lectura",
  "configuracion": "sin_acceso",
  "administracion": "sin_acceso"
}'::jsonb);

-- Usuario administrador inicial (password: admin123 - CAMBIAR EN PRODUCCIÓN)
-- Hash bcrypt de "admin123": $2b$10$rKZLvVZGxVqKfXKGxVqKfOxVqKfXKGxVqKfXKGxVqKfXKGxVqKfXK
INSERT INTO usuarios (codigo, nombre_completo, email, password_hash, rol_id, estado) VALUES
('ADM001', 'Administrador Sistema', 'admin@track.com', '$2b$10$rKZLvVZGxVqKfXKGxVqKfOxVqKfXKGxVqKfXKGxVqKfXKGxVqKfXK', 1, 'ACTIVO');

-- Empresas de paquetería de ejemplo
INSERT INTO empresas_paqueteria (codigo, nombre, descripcion, activo) VALUES
('DHL', 'DHL Express', 'Empresa de paquetería internacional', true),
('FEDEX', 'FedEx', 'Empresa de paquetería y logística', true),
('UPS', 'UPS', 'United Parcel Service', true),
('ESTAFETA', 'Estafeta', 'Empresa mexicana de paquetería', true);

-- Canales de escaneo de ejemplo
INSERT INTO canales (codigo, nombre, descripcion, activo) VALUES
('BODEGA-A', 'Bodega A', 'Bodega principal - Línea 1', true),
('BODEGA-B', 'Bodega B', 'Bodega secundaria - Línea 2', true),
('LINEA-1', 'Línea 1', 'Línea de escaneo 1', true),
('LINEA-2', 'Línea 2', 'Línea de escaneo 2', true);

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
JOIN empresas_paqueteria e ON t.empresa_id = e.id
JOIN canales c ON t.canal_id = c.id
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
JOIN empresas_paqueteria e ON t.empresa_id = e.id
JOIN canales c ON t.canal_id = c.id
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

COMMENT ON VIEW v_tarimas_completas IS 'Vista con información completa de tarimas';
COMMENT ON VIEW v_guias_completas IS 'Vista con información completa de guías';
COMMENT ON VIEW v_metricas_diarias IS 'Vista con métricas agregadas por día';

-- ============================================
-- PERMISOS (ajustar según usuario de aplicación)
-- ============================================

-- Crear usuario de aplicación (ejemplo)
-- CREATE USER track_app WITH PASSWORD 'secure_password';
-- GRANT CONNECT ON DATABASE track_dev TO track_app;
-- GRANT USAGE ON SCHEMA public TO track_app;
-- GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO track_app;
-- GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO track_app;
-- GRANT SELECT ON ALL TABLES IN SCHEMA public TO track_app;

-- ============================================
-- FIN DEL SCHEMA
-- ============================================
