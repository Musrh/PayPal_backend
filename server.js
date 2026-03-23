// server.js - PayPal + Firestore sécurisé
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import paypal from "@paypal/checkout-server-sdk";
import admin from "firebase-admin";

dotenv.config();
const app = express();
app.use(cors({ origin: "*" }));
app.use(express.json());

// ================= FIREBASE =================
if (!process.env.FIREBASE_SERVICE_ACCOUNT) {
  console.error("❌ FIREBASE_SERVICE_ACCOUNT manquant !");
  process.exit(1);
}

const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();
console.log("✅ Firebase connecté");

// ================= PAYPAL =================
if (!process.env.PAYPAL_CLIENT_ID || !process.env.PAYPAL_CLIENT_SECRET) {
  console.error("❌ PayPal credentials manquants !");
  process.exit(1);
}

const paypalEnv =
  process.env.PAYPAL_ENV === "production"
    ? new paypal.core.LiveEnvironment(process.env.PAYPAL_CLIENT_ID, process.env.PAYPAL_CLIENT_SECRET)
    : new paypal.core.SandboxEnvironment(process.env.PAYPAL_CLIENT_ID, process.env.PAYPAL_CLIENT_SECRET);

const paypalClient = new paypal.core.PayPalHttpClient(paypalEnv);

// ================= CREATE PAYPAL ORDER =================
app.post("/create-paypal-order", async (req, res) => {
  try {
    const { items, email, adresseLivraison } = req.body;
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

    // 🔹 Enregistrer temporairement la commande
    await db.collection("pendingOrders").doc(order.result.id).set({
      email,
      items,
      adresse: adresseLivraison,
      montant: total,
      createdAt: new Date(),
    });

    res.json({ id: order.result.id, url: approveUrl });
  } catch (err) {
    console.error("❌ PayPal create order error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ================= CAPTURE PAYPAL ORDER =================
app.post("/capture-paypal-order", async (req, res) => {
  try {
    const { orderId } = req.body;
    if (!orderId) return res.status(400).json({ error: "orderId manquant" });

    const request = new paypal.orders.OrdersCaptureRequest(orderId);
    request.requestBody({});
    const capture = await paypalClient.execute(request);

    if (capture.result.status === "COMPLETED") {
      // 🔹 Récupérer la commande temporaire
      const pendingSnap = await db.collection("pendingOrders").doc(orderId).get();
      if (!pendingSnap.exists) throw new Error("Commande temporaire introuvable");

      const { email, items, adresse, montant } = pendingSnap.data();

      // 🔹 Enregistrer la commande finale
      await db.collection("commandes").add({
        email,
        items,
        montant,
        adresse,
        paymentMethod: "paypal",
        orderId,
        status: "paid",
        createdAt: new Date(),
      });

      // 🔹 Supprimer la commande temporaire
      await db.collection("pendingOrders").doc(orderId).delete();

      console.log("✅ Commande PayPal finalisée et enregistrée :", orderId);
      return res.json({ success: true });
    }

    res.status(400).json({ error: "Paiement non complété" });
  } catch (err) {
    console.error("❌ PayPal capture error:", err);
    res.status(500).json({ error: err.message });
  }
});

// 🚀 START SERVER
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`🚀 Serveur PayPal en ligne sur port ${PORT}`));
