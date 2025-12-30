#!/usr/bin/env python3
import http.server
import socketserver
import os

PORT = 3000
HOST = "localhost"

class DebugHTTPRequestHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        super().end_headers()

    def do_GET(self):
        print(f"🔍 GET {self.path}")
        super().do_GET()

    def log_message(self, format, *args):
        pass

def run_server():
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    
    with socketserver.TCPServer((HOST, PORT), DebugHTTPRequestHandler) as httpd:
        print('\n' + '=' * 60)
        print('🚀 SERVIDOR DE DESARROLLO WMS')
        print('=' * 60)
        print(f'\n📍 Servidor corriendo en: http://{HOST}:{PORT}')
        print(f'🔧 Debug Mode: Activa manualmente en consola del navegador\n')
        print('📱 Aplicaciones disponibles:')
        print(f'   • Principal:    http://{HOST}:{PORT}/')
        print(f'   • Dispatch:     http://{HOST}:{PORT}/apps/dispatch/')
        print(f'   • Validador:    http://{HOST}:{PORT}/apps/validador/')
        print(f'   • Inventario:   http://{HOST}:{PORT}/apps/inventario/')
        print(f'   • Track:        http://{HOST}:{PORT}/apps/track/')
        print('\n💡 Para activar Debug Mode:')
        print('   1. Abre consola del navegador (F12)')
        print('   2. Ejecuta: DebugMode.enable()')
        print('   3. Recarga la página (F5)')
        print('\n   • Presiona Ctrl+C para detener el servidor')
        print('\n' + '=' * 60 + '\n')
        
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print('\n\n👋 Servidor detenido')
            httpd.shutdown()

if __name__ == '__main__':
    run_server()
