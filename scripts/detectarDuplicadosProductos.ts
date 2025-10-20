import 'dotenv/config';
import mongoose from 'mongoose';
import colors from 'colors';
import fs from 'fs';
import path from 'path';
import Producto from '../models/Producto';

type ProductoMin = {
  _id: string;
  ml_id?: string;
  permalink?: string;
  title?: string;
};

type GrupoDuplicados = {
  key: string;
  count: number;
  ids: string[];
  ml_ids: string[];
  titles: string[];
  permalinks: string[];
};

function normalizeMlu(value?: string): string {
  if (!value) return '';
  return value.toUpperCase().replace(/-/g, '').trim();
}

function normalizePermalink(value?: string): string {
  if (!value) return '';
  const base = value.split('?')[0] || '';
  return base.trim().toLowerCase();
}

function normalizeTitle(value?: string): string {
  if (!value) return '';
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

function detectDuplicates(
  productos: ProductoMin[],
  field: 'ml_id' | 'permalink' | 'title'
): GrupoDuplicados[] {
  const groups = new Map<string, GrupoDuplicados>();

  for (const p of productos) {
    let key = '';
    if (field === 'ml_id') key = normalizeMlu(p.ml_id);
    if (field === 'permalink') key = normalizePermalink(p.permalink);
    if (field === 'title') key = normalizeTitle(p.title);

    if (!key) continue;

    if (!groups.has(key)) {
      groups.set(key, {
        key,
        count: 0,
        ids: [],
        ml_ids: [],
        titles: [],
        permalinks: []
      });
    }

    const g = groups.get(key)!;
    g.count += 1;
    g.ids.push(String(p._id));
    if (p.ml_id) g.ml_ids.push(p.ml_id);
    if (p.title) g.titles.push(p.title);
    if (p.permalink) g.permalinks.push(p.permalink);
  }

  const result = Array.from(groups.values())
    .filter(g => g.count >= 2)
    .sort((a, b) => b.count - a.count);

  return result;
}

async function main() {
  console.log(colors.blue('\n============================================='));
  console.log(colors.blue('  🔍 Detector de Duplicados de Productos (BD)'));
  console.log(colors.blue('=============================================\n'));

  const mongoUri = process.env.MONGODB_CNN as string;
  if (!mongoUri) {
    console.error(colors.red('❌ MONGODB_CNN no está definido en variables de entorno'));
    process.exit(1);
  }

  try {
    await mongoose.connect(mongoUri);
    console.log(colors.green('✅ Conectado a MongoDB'));
  } catch (err) {
    console.error(colors.red('❌ Error conectando a MongoDB:'), err);
    process.exit(1);
  }

  try {
    const total = await Producto.countDocuments();
    console.log(colors.yellow(`📊 Total de productos: ${total}`));

    const productos: ProductoMin[] = await Producto.find({}, {
      _id: 1,
      ml_id: 1,
      permalink: 1,
      title: 1
    }).lean();

    console.log(colors.cyan('🔎 Analizando duplicados por ml_id (MLU)...'));
    const dupMlu = detectDuplicates(productos, 'ml_id');
    console.log(colors.cyan('🔎 Analizando duplicados por permalink...'));
    const dupPermalink = detectDuplicates(productos, 'permalink');
    console.log(colors.cyan('🔎 Analizando duplicados por title...'));
    const dupTitle = detectDuplicates(productos, 'title');

    const resumen = {
      total_productos: total,
      duplicados: {
        ml_id: {
          grupos: dupMlu.length,
          total_items_en_grupos: dupMlu.reduce((acc, g) => acc + g.count, 0),
          top5: dupMlu.slice(0, 5)
        },
        permalink: {
          grupos: dupPermalink.length,
          total_items_en_grupos: dupPermalink.reduce((acc, g) => acc + g.count, 0),
          top5: dupPermalink.slice(0, 5)
        },
        title: {
          grupos: dupTitle.length,
          total_items_en_grupos: dupTitle.reduce((acc, g) => acc + g.count, 0),
          top5: dupTitle.slice(0, 5)
        }
      }
    };

    // Imprimir resumen en consola
    console.log(colors.yellow('\n📋 Resumen de duplicados:'));
    console.log(colors.yellow(`   • ml_id: ${resumen.duplicados.ml_id.grupos} grupos (items en grupos: ${resumen.duplicados.ml_id.total_items_en_grupos})`));
    console.log(colors.yellow(`   • permalink: ${resumen.duplicados.permalink.grupos} grupos (items en grupos: ${resumen.duplicados.permalink.total_items_en_grupos})`));
    console.log(colors.yellow(`   • title: ${resumen.duplicados.title.grupos} grupos (items en grupos: ${resumen.duplicados.title.total_items_en_grupos})`));

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const reportsDir = path.join(__dirname, 'reports');
    try {
      if (!fs.existsSync(reportsDir)) fs.mkdirSync(reportsDir, { recursive: true });
      const filePath = path.join(reportsDir, `duplicados-productos-${timestamp}.json`);
      fs.writeFileSync(filePath, JSON.stringify({ resumen, dupMlu, dupPermalink, dupTitle }, null, 2));
      console.log(colors.green(`\n💾 Reporte guardado en: ${filePath}`));
    } catch (fsErr) {
      console.log(colors.red('⚠️ No se pudo guardar el reporte en disco:'), fsErr);
    }

    console.log(colors.green('\n✅ Análisis completado\n'));
    await mongoose.disconnect();
    process.exit(0);
  } catch (err: any) {
    console.error(colors.red('\n❌ Error durante el análisis:'), err?.message || err);
    try { await mongoose.disconnect(); } catch {}
    process.exit(1);
  }
}

// Ejecutar si es llamado directamente
main();


