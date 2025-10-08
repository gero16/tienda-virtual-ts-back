#!/bin/bash

# Script de prueba para el sistema de cupones
# Asegúrate de tener curl y jq instalados

API_URL="https://poppy-shop-production.up.railway.app"

echo "🎟️  Script de Prueba - Sistema de Cupones"
echo "=========================================="
echo ""

# Colores
GREEN='\033[0;32m'
RED='\033[0;31m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # Sin color

print_success() {
  echo -e "${GREEN}✅ $1${NC}"
}

print_error() {
  echo -e "${RED}❌ $1${NC}"
}

print_info() {
  echo -e "${BLUE}ℹ️  $1${NC}"
}

print_warning() {
  echo -e "${YELLOW}⚠️  $1${NC}"
}

# 1. Crear cupón de prueba
echo "1️⃣  Creando cupón de prueba..."
echo "----------------------------------------"
print_info "Creando cupón: PRUEBA10 (10% de descuento)"

response=$(curl -s -X POST "$API_URL/api/cupones/crear" \
  -H "Content-Type: application/json" \
  -d '{
    "codigo": "PRUEBA10",
    "descripcion": "Cupón de prueba - 10% de descuento",
    "tipo_descuento": "porcentaje",
    "valor_descuento": 10,
    "usos_maximos": 100,
    "limite_por_usuario": 1
  }')

if echo "$response" | jq -e '.success' > /dev/null 2>&1; then
  print_success "Cupón PRUEBA10 creado exitosamente"
else
  print_warning "El cupón PRUEBA10 ya existe o hubo un error"
fi
echo ""

# 2. Listar cupones
echo "2️⃣  Listando todos los cupones..."
echo "----------------------------------------"
cupones=$(curl -s "$API_URL/api/cupones/listar")
echo "$cupones" | jq '.cupones[] | {codigo: .codigo, descuento: .valor_descuento, tipo: .tipo_descuento, activo: .activo, usos: .usos_actuales}'
echo ""

# 3. Validar cupón
echo "3️⃣  Validando cupón PRUEBA10..."
echo "----------------------------------------"
print_info "Simulando compra de $1000"

validacion=$(curl -s -X POST "$API_URL/api/cupones/validar" \
  -H "Content-Type: application/json" \
  -d '{
    "codigo": "PRUEBA10",
    "monto_compra": 1000,
    "email_usuario": "test@example.com"
  }')

if echo "$validacion" | jq -e '.valido' > /dev/null 2>&1; then
  print_success "Cupón válido!"
  echo "$validacion" | jq '{descuento: .descuento, monto_final: .monto_final}'
else
  print_error "Cupón inválido o error"
  echo "$validacion" | jq '.error'
fi
echo ""

# 4. Crear más cupones de ejemplo
echo "4️⃣  Creando cupones de ejemplo adicionales..."
echo "----------------------------------------"

# Cupón de verano
print_info "Creando VERANO2026..."
curl -s -X POST "$API_URL/api/cupones/crear" \
  -H "Content-Type: application/json" \
  -d '{
    "codigo": "VERANO2026",
    "descripcion": "Descuento especial de verano 2026",
    "tipo_descuento": "porcentaje",
    "valor_descuento": 25,
    "fecha_fin": "2026-03-31",
    "usos_maximos": 200,
    "monto_minimo_compra": 500
  }' > /dev/null 2>&1

if [ $? -eq 0 ]; then
  print_success "VERANO2026 creado (25% OFF, mínimo $500)"
else
  print_warning "VERANO2026 ya existe"
fi

# Cupón de monto fijo
print_info "Creando FIJO500..."
curl -s -X POST "$API_URL/api/cupones/crear" \
  -H "Content-Type: application/json" \
  -d '{
    "codigo": "FIJO500",
    "descripcion": "$500 de descuento en compras grandes",
    "tipo_descuento": "monto_fijo",
    "valor_descuento": 500,
    "monto_minimo_compra": 2000,
    "usos_maximos": 50
  }' > /dev/null 2>&1

if [ $? -eq 0 ]; then
  print_success "FIJO500 creado ($500 OFF, mínimo $2000)"
else
  print_warning "FIJO500 ya existe"
fi

echo ""

# 5. Listar cupones finales
echo "5️⃣  Lista final de cupones:"
echo "----------------------------------------"
final_cupones=$(curl -s "$API_URL/api/cupones/listar")
count=$(echo "$final_cupones" | jq '.count')
print_success "Total de cupones: $count"
echo ""
echo "$final_cupones" | jq -r '.cupones[] | "🎟️  \(.codigo) - \(.descripcion) - \(.valor_descuento)\(if .tipo_descuento == "porcentaje" then "%" else " UYU" end) - Usos: \(.usos_actuales)/\(.usos_maximos // "∞")"'
echo ""

print_success "Script completado!"
echo ""
print_info "Próximos pasos:"
echo "1. Ve a /admin/cupones para gestionar cupones"
echo "2. Crea nuevos cupones personalizados"
echo "3. Prueba aplicarlos en /checkout"
echo "4. ¡Disfruta tu sistema de cupones!"
