#!/bin/bash

# Script de prueba para el sistema de descuentos
# Asegúrate de tener curl instalado

API_URL="https://poppy-shop-production.up.railway.app"

echo "🎯 Script de Prueba - Sistema de Descuentos"
echo "=========================================="
echo ""

# Función para imprimir con colores
print_success() {
  echo -e "\033[0;32m✅ $1\033[0m"
}

print_error() {
  echo -e "\033[0;31m❌ $1\033[0m"
}

print_info() {
  echo -e "\033[0;34mℹ️  $1\033[0m"
}

# 1. Listar productos con descuento
echo "1️⃣  Listando productos con descuento..."
echo "----------------------------------------"
response=$(curl -s "$API_URL/api/descuentos/listar")
echo "$response" | jq '.'
echo ""

# 2. Ejemplo de aplicar descuento (descomenta y ajusta los IDs)
echo "2️⃣  Ejemplo: Aplicar descuento del 15%"
echo "----------------------------------------"
print_info "Para aplicar descuento, descomenta la siguiente línea y ajusta los product_ids:"
echo '# curl -X POST "$API_URL/api/descuentos/aplicar" \'
echo '#   -H "Content-Type: application/json" \'
echo '#   -d '"'"'{"product_ids": ["MLA_TU_PRODUCTO_ID"], "porcentaje": 15}'"'"' | jq '"'"'.'"'"
echo ""

# 3. Ejemplo de quitar descuento (descomenta y ajusta los IDs)
echo "3️⃣  Ejemplo: Quitar descuento"
echo "----------------------------------------"
print_info "Para quitar descuento, descomenta la siguiente línea y ajusta los product_ids:"
echo '# curl -X POST "$API_URL/api/descuentos/quitar" \'
echo '#   -H "Content-Type: application/json" \'
echo '#   -d '"'"'{"product_ids": ["MLA_TU_PRODUCTO_ID"]}'"'"' | jq '"'"'.'"'"
echo ""

# 4. Obtener todos los productos
echo "4️⃣  Obteniendo primeros 5 productos disponibles..."
echo "----------------------------------------"
productos=$(curl -s "$API_URL/ml/productos")
echo "$productos" | jq '.[0:5] | .[] | {ml_id: .ml_id, title: .title, price: .price, descuento: .descuento}'
echo ""

print_success "Script completado!"
print_info "Puedes usar este script para probar el sistema de descuentos"
print_info "Recuerda: Reemplaza 'MLA_TU_PRODUCTO_ID' con un ID real de producto"
