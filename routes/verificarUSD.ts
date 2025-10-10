import { Router, Request, Response } from "express";
import axios from "axios";
import colors from "colors";

const router = Router();

/**
 * Endpoint para verificar si tu cuenta de MercadoPago soporta USD
 */
router.get("/check-usd-support", async (req: Request, res: Response) => {
  try {
    const mpAccessToken = process.env.MP_ACCESS_TOKEN;

    if (!mpAccessToken) {
      return res.status(500).json({ 
        error: "MP_ACCESS_TOKEN no configurado" 
      });
    }

    console.log(colors.blue("\n🔍 Verificando soporte de USD en tu cuenta de MercadoPago..."));

    // 1. Obtener información de tu cuenta
    const userResponse = await axios.get(
      "https://api.mercadolibre.com/users/me",
      {
        headers: { Authorization: `Bearer ${mpAccessToken}` }
      }
    );

    const userId = userResponse.data.id;
    const userCountry = userResponse.data.country_id;
    const userNickname = userResponse.data.nickname;

    console.log(colors.cyan(`   👤 Usuario: ${userNickname}`));
    console.log(colors.cyan(`   🌍 País: ${userCountry}`));
    console.log(colors.cyan(`   🆔 User ID: ${userId}`));

    // 2. Consultar métodos de pago disponibles para tu país
    const paymentMethodsResponse = await axios.get(
      `https://api.mercadopago.com/sites/${userCountry}/payment_methods`,
      {
        headers: { Authorization: `Bearer ${mpAccessToken}` }
      }
    );

    // 3. Verificar si USD está disponible
    const metodosConUSD = paymentMethodsResponse.data.filter((method: any) => {
      return method.additional_info_needed && 
             method.additional_info_needed.includes("currency_id");
    });

    // 4. Intentar crear una preferencia de prueba con USD
    let soportaUSD = false;
    let errorUSD = null;

    try {
      const testPreference = {
        items: [{
          id: "test-usd",
          title: "Test USD Support",
          quantity: 1,
          unit_price: 10,
          currency_id: "USD"
        }],
        external_reference: `TEST-USD-${Date.now()}`
      };

      const preferenceResponse = await axios.post(
        "https://api.mercadopago.com/checkout/preferences",
        testPreference,
        {
          headers: { 
            Authorization: `Bearer ${mpAccessToken}`,
            "Content-Type": "application/json"
          }
        }
      );

      // Verificar qué moneda se creó realmente
      const monedaCreada = preferenceResponse.data.items[0]?.currency_id;
      
      if (monedaCreada === "USD") {
        soportaUSD = true;
        console.log(colors.green("   ✅ Tu cuenta SÍ soporta USD"));
      } else {
        soportaUSD = false;
        console.log(colors.yellow(`   ⚠️  Solicitaste USD pero se creó en ${monedaCreada}`));
        console.log(colors.yellow("   ⚠️  Tu cuenta NO soporta USD"));
      }

      // Borrar la preferencia de prueba (opcional)
      // No hay API para borrar preferencias, pero no importa, no se usará

    } catch (error: any) {
      soportaUSD = false;
      errorUSD = error.response?.data?.message || error.message;
      console.log(colors.red("   ❌ Error al crear preferencia con USD"));
      console.log(colors.red(`   ❌ ${errorUSD}`));
    }

    // 5. Preparar respuesta
    const resultado = {
      cuenta: {
        user_id: userId,
        nickname: userNickname,
        pais: userCountry
      },
      soporte_usd: soportaUSD,
      monedas_disponibles: soportaUSD ? ["UYU", "USD"] : ["UYU"],
      mensaje: soportaUSD 
        ? "✅ Tu cuenta SÍ puede cobrar en USD"
        : "❌ Tu cuenta NO puede cobrar en USD. Solo soporta UYU (pesos uruguayos).",
      recomendacion: soportaUSD 
        ? "Puedes usar Checkout Pro con USD sin problemas"
        : "Opciones: 1) Usar UYU (pesos), 2) Contactar a MercadoPago para habilitar USD, 3) Usar Stripe/PayPal para USD",
      error_usd: errorUSD
    };

    console.log(colors.green("\n📊 Resultado de la verificación:"));
    console.log(colors.green(JSON.stringify(resultado, null, 2)));

    return res.json(resultado);

  } catch (error: any) {
    console.error(colors.red("❌ Error verificando soporte de USD:"), error.response?.data || error.message);
    return res.status(500).json({ 
      error: "Error al verificar soporte de USD",
      details: error.response?.data || error.message
    });
  }
});

export default router;

