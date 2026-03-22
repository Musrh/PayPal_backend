
// server.js
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import paypal from "@paypal/checkout-server-sdk";

dotenv.config();
const app = express();
app.use(cors({ origin: "*" }));
app.use(express.json());

// ✅ Configuration PayPal
const paypalEnv =
  process.env.PAYPAL_ENV === "production"
    ? new paypal.core.LiveEnvironment(process.env.PAYPAL_CLIENT_ID, process.env.PAYPAL_CLIENT_SECRET)
    : new paypal.core.SandboxEnvironment(process.env.PAYPAL_CLIENT_ID, process.env.PAYPAL_CLIENT_SECRET);

const paypalClient = new paypal.core.PayPalHttpClient(paypalEnv);

// 🔹 Créer un ordre PayPal
app.post("/create-paypal-order", async (req, res) => {
  try {
    const { items } = req.body;
    if (!items || !items.length) return res.status(400).json({ error: "Aucun item fourni" });

    const total = items.reduce((sum, i) => sum + i.prix * i.quantity, 0).toFixed(2);

    const request = new paypal.orders.OrdersCreateRequest();
    request.prefer("return=representation");
    request.requestBody({
      intent: "CAPTURE",
      purchase_units: [{ amount: { currency_code: "EUR", value: total } }],
      application_context: {
        return_url: "https://wellshoppings.com/#/paypal-success",
        cancel_url: "https://wellshoppings.com/#/paypal-cancel",
        brand_name: "WellShoppings",
        user_action: "PAY_NOW",
      },
    });

    const order = await paypalClient.execute(request);
    const approveUrl = order.result.links.find(l => l.rel === "approve").href;

    res.json({ id: order.result.id, url: approveUrl });
  } catch (err) {
    console.error("❌ PayPal create order error:", err);
    res.status(500).json({ error: err.message });
  }
});

// 🔹 Capturer un ordre PayPal
app.post("/capture-paypal-order", async (req, res) => {
  try {
    const { orderId } = req.body;
    if (!orderId) return res.status(400).json({ error: "orderId manquant" });

    const request = new paypal.orders.OrdersCaptureRequest(orderId);
    request.requestBody({});
    const capture = await paypalClient.execute(request);

    if (capture.result.status === "COMPLETED") {
      console.log("✅ Paiement PayPal complété :", capture.result.id);
      res.json({ success: true, capture: capture.result });
    } else {
      res.status(400).json({ error: "Paiement non complété" });
    }
  } catch (err) {
    console.error("❌ PayPal capture error:", err);
    res.status(500).json({ error: err.message });
  }
});

// 🚀 Démarrer le serveur
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`🚀 Serveur PayPal en ligne sur port ${PORT}`));
